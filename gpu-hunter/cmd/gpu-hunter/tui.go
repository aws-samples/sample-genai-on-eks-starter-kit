/*
Copyright 2024 gpu-hunter authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package main

import (
	"context"
	"fmt"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	awsclient "github.com/gpu-hunter/pkg/aws"
	"github.com/gpu-hunter/pkg/models"
	"github.com/gpu-hunter/pkg/providers/instancetype"
	"github.com/gpu-hunter/pkg/providers/interruption"
	"github.com/gpu-hunter/pkg/providers/lookup"
	"github.com/gpu-hunter/pkg/providers/pricing"
	"github.com/gpu-hunter/pkg/providers/probe"
	"github.com/gpu-hunter/pkg/providers/spotplacement"
	"github.com/gpu-hunter/pkg/tui"
	"github.com/spf13/cobra"
)

var tuiCmd = &cobra.Command{
	Use:   "tui",
	Short: "Launch interactive TUI for browsing GPU instances",
	Long: `Launch an interactive terminal user interface (TUI) for browsing
and filtering GPU and Neuron instances across AWS regions.

The TUI provides:
  - Real-time filtering and sorting
  - Region switching with live data refresh
  - Instance type filtering (GPU/Neuron)
  - Detailed instance information
  - Keyboard-driven navigation
  - Fun loading animations!

Example:
  gpu-hunter tui
  gpu-hunter tui --region us-west-2`,
	RunE: runTUI,
}

var (
	tuiRegion    string
	tuiSpotScore bool
)

func init() {
	tuiCmd.Flags().StringVarP(&tuiRegion, "region", "r", "us-east-1", "Initial AWS region")
	tuiCmd.Flags().BoolVarP(&tuiSpotScore, "spot-score", "s", false, "Fetch spot placement scores (slower)")
}

// createLookupFetcher creates a function that looks up an instance across all regions
func createLookupFetcher(fetchSpotScores bool) tui.LookupFetcher {
	return func(ctx context.Context, instanceType string) (*models.InstanceTypeGlobalInfo, error) {
		provider := lookup.NewProvider(fetchSpotScores)
		return provider.LookupInstance(ctx, instanceType, nil)
	}
}

// createPrefixExpander creates a function that expands instance type prefixes
func createPrefixExpander() tui.PrefixExpander {
	return func(ctx context.Context, prefix string) ([]string, error) {
		provider := lookup.NewProvider(false) // Don't need spot scores for prefix expansion
		return provider.ExpandPrefix(ctx, prefix)
	}
}

// createProbeFetcher creates a function that probes capacity by launching instances
func createProbeFetcher() tui.ProbeFetcher {
	return func(ctx context.Context, instanceType, capacityType string) (*models.ProbeResults, error) {
		// First, find all regions where this instance type is available
		lookupProvider := lookup.NewProvider(false)
		lookupResult, err := lookupProvider.LookupInstance(ctx, instanceType, nil)
		if err != nil {
			return nil, fmt.Errorf("failed to find regions: %w", err)
		}

		var regionsToProbe []string
		for _, ri := range lookupResult.RegionInfo {
			if ri.Available {
				regionsToProbe = append(regionsToProbe, ri.Region)
			}
		}

		if len(regionsToProbe) == 0 {
			return nil, fmt.Errorf("instance type %s is not available in any region", instanceType)
		}

		// Build probe requests
		var requests []models.ProbeRequest
		for _, region := range regionsToProbe {
			if capacityType == "both" {
				requests = append(requests,
					models.ProbeRequest{InstanceType: instanceType, Region: region, CapacityType: models.ProbeCapacityTypeSpot},
					models.ProbeRequest{InstanceType: instanceType, Region: region, CapacityType: models.ProbeCapacityTypeOnDemand},
				)
			} else if capacityType == "spot" {
				requests = append(requests, models.ProbeRequest{
					InstanceType: instanceType,
					Region:       region,
					CapacityType: models.ProbeCapacityTypeSpot,
				})
			} else {
				requests = append(requests, models.ProbeRequest{
					InstanceType: instanceType,
					Region:       region,
					CapacityType: models.ProbeCapacityTypeOnDemand,
				})
			}
		}

		// Execute probes with concurrency control
		results := &models.ProbeResults{
			Timestamp:    time.Now().UTC().Format(time.RFC3339),
			InstanceType: instanceType,
			Regions:      regionsToProbe,
			CapacityType: capacityType,
			TotalProbes:  len(requests),
		}

		resultsChan := make(chan *models.ProbeResult, len(requests))
		sem := make(chan struct{}, 5) // Max 5 concurrent probes
		var wg sync.WaitGroup

		for _, req := range requests {
			wg.Add(1)
			go func(r models.ProbeRequest) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				client, err := awsclient.NewClient(ctx, r.Region)
				if err != nil {
					resultsChan <- &models.ProbeResult{
						InstanceType: r.InstanceType,
						Region:       r.Region,
						CapacityType: r.CapacityType,
						Success:      false,
						ErrorCode:    "ClientError",
						Reason:       "Failed to create AWS client",
					}
					return
				}

				probeProvider := probe.NewProvider(client)
				result, _ := probeProvider.ProbeCapacity(ctx, r)
				resultsChan <- result
			}(req)
		}

		go func() {
			wg.Wait()
			close(resultsChan)
		}()

		for result := range resultsChan {
			results.Results = append(results.Results, *result)
			if result.Success {
				results.SuccessCount++
			} else {
				results.FailureCount++
			}
		}

		return results, nil
	}
}

// createDataFetcher creates a function that fetches GPU instances from AWS
func createDataFetcher(fetchSpotScores bool) tui.DataFetcher {
	// Pre-fetch interruption data once (it's global, not region-specific)
	interruptionProvider := interruption.NewProvider()
	interruptionProvider.FetchData(context.Background())

	return func(ctx context.Context, region string) ([]models.GPUInstance, error) {
		// Create AWS client for the specified region
		client, err := awsclient.NewClient(ctx, region)
		if err != nil {
			return nil, fmt.Errorf("failed to create AWS client for %s: %w", region, err)
		}

		// Discover instance types
		itProvider := instancetype.NewProvider(client)
		instances, err := itProvider.DiscoverAcceleratorInstances(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to discover instances in %s: %w", region, err)
		}

		// Enrich with pricing
		pricingProvider := pricing.NewProvider(client)
		if err := pricingProvider.EnrichWithPricing(ctx, instances); err != nil {
			// Log but don't fail - pricing is nice to have
			fmt.Printf("Warning: pricing error in %s: %v\n", region, err)
		}

		// Enrich with spot scores if requested
		if fetchSpotScores {
			spotProvider := spotplacement.NewProvider(client)
			if err := spotProvider.EnrichWithSpotScores(ctx, instances); err != nil {
				// Log but don't fail
				fmt.Printf("Warning: spot score error in %s: %v\n", region, err)
			}
		}

		// Enrich with interruption data
		if interruptionProvider.IsDataLoaded() {
			for i := range instances {
				data := interruptionProvider.GetInterruptionRate(instances[i].InstanceType, region)
				if data != nil {
					instances[i].InterruptionRange = &models.InterruptionRange{
						Label: data.Range.Label,
						Min:   data.Range.Min,
						Max:   data.Range.Max,
					}
					instances[i].Savings = data.Savings
				}
			}
		}

		// Convert to TUI model format
		tuiInstances := make([]models.GPUInstance, 0, len(instances))
		for _, inst := range instances {
			tuiInstances = append(tuiInstances, models.FromInstanceTypeInfo(inst))
		}

		return tuiInstances, nil
	}
}

func runTUI(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	// Create the data fetcher
	fetcher := createDataFetcher(tuiSpotScore)

	// Create the lookup fetcher
	lookupFetcher := createLookupFetcher(tuiSpotScore)

	// Create the prefix expander
	prefixExpander := createPrefixExpander()

	// Create the probe fetcher
	probeFetcher := createProbeFetcher()

	// Create app with all fetchers
	app := tui.NewApp(ctx, fetcher, tuiRegion)
	app.SetLookupFetcher(lookupFetcher)
	app.SetPrefixExpander(prefixExpander)
	app.SetProbeFetcher(probeFetcher)

	// Run TUI
	p := tea.NewProgram(app, tea.WithAltScreen())
	_, err := p.Run()
	return err
}
