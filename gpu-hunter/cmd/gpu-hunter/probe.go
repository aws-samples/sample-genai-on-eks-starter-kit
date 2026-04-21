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
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"

	awsclient "github.com/gpu-hunter/pkg/aws"
	"github.com/gpu-hunter/pkg/models"
	"github.com/gpu-hunter/pkg/providers/lookup"
	"github.com/gpu-hunter/pkg/providers/probe"
)

var probeCmd = &cobra.Command{
	Use:   "probe <instance-type>",
	Short: "Probe real capacity by launching and terminating test instances",
	Long: `Probe tests real EC2 capacity availability by actually launching instances
and immediately terminating them upon success.

WARNING: This command will:
- Launch real EC2 instances (you may incur minimal charges)
- Require sufficient service quotas
- Count against your account limits

The probe command helps verify that capacity is actually available,
not just reported as available by the Spot Placement Score API.

Examples:
  # Probe spot capacity for a specific instance type in us-east-1
  gpu-hunter probe g5.xlarge --capacity spot

  # Probe on-demand capacity
  gpu-hunter probe g5.xlarge --capacity on-demand

  # Probe both spot and on-demand
  gpu-hunter probe p4d.24xlarge --capacity both

  # Probe across specific regions
  gpu-hunter probe g6.xlarge --capacity spot --regions us-east-1,us-west-2

  # Probe all available regions for an instance type
  gpu-hunter probe g6.xlarge --capacity on-demand --all-regions

  # Preview what would be probed without launching
  gpu-hunter probe g5.xlarge --capacity spot --all-regions --dry-run`,
	Args: cobra.ExactArgs(1),
	RunE: runProbe,
}

var (
	probeCapacityType string
	probeRegions      []string
	probeAllRegions   bool
	probeOutput       string
	probeConcurrency  int
	probeDryRun       bool
)

func init() {
	probeCmd.Flags().StringVarP(&probeCapacityType, "capacity", "c", "spot",
		"Capacity type to probe: spot, on-demand, both")
	probeCmd.Flags().StringSliceVarP(&probeRegions, "regions", "r", nil,
		"Regions to probe (comma-separated). If not specified, probes us-east-1")
	probeCmd.Flags().BoolVarP(&probeAllRegions, "all-regions", "a", false,
		"Probe all regions where the instance type is available")
	probeCmd.Flags().StringVarP(&probeOutput, "output", "o", "table",
		"Output format: table, json")
	probeCmd.Flags().IntVar(&probeConcurrency, "concurrency", 5,
		"Maximum concurrent probes")
	probeCmd.Flags().BoolVar(&probeDryRun, "dry-run", false,
		"Show what would be probed without actually launching instances")
}

func runProbe(cmd *cobra.Command, args []string) error {
	ctx := context.Background()
	instanceType := args[0]

	// Validate capacity type
	capacityType := strings.ToLower(probeCapacityType)
	switch capacityType {
	case "spot", "on-demand", "ondemand", "both":
		// Valid
		if capacityType == "ondemand" {
			capacityType = "on-demand"
		}
	default:
		return fmt.Errorf("invalid capacity type: %s (must be spot, on-demand, or both)", probeCapacityType)
	}

	// Determine regions to probe
	var regionsToProbe []string
	if probeAllRegions {
		// Find all regions where the instance type is available
		fmt.Fprintf(os.Stderr, "🌍 Finding available regions for %s...\n", instanceType)
		provider := lookup.NewProvider(false)
		result, err := provider.LookupInstance(ctx, instanceType, nil)
		if err != nil {
			return fmt.Errorf("failed to lookup instance regions: %w", err)
		}
		for _, ri := range result.RegionInfo {
			if ri.Available {
				regionsToProbe = append(regionsToProbe, ri.Region)
			}
		}
		if len(regionsToProbe) == 0 {
			return fmt.Errorf("instance type %s is not available in any region", instanceType)
		}
		fmt.Fprintf(os.Stderr, "   Found %d regions: %s\n", len(regionsToProbe), strings.Join(regionsToProbe, ", "))
	} else if len(probeRegions) > 0 {
		regionsToProbe = probeRegions
	} else {
		// Default to us-east-1
		regionsToProbe = []string{"us-east-1"}
	}

	// Sort regions for consistent output
	sort.Strings(regionsToProbe)

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

	// Dry run - just show what would be probed
	if probeDryRun {
		fmt.Printf("\n🔍 Dry run: would probe %d capacity configuration(s):\n\n", len(requests))
		for _, req := range requests {
			fmt.Printf("  • %s in %s (%s)\n", req.InstanceType, req.Region, req.CapacityType)
		}
		fmt.Printf("\nTo actually run these probes, remove the --dry-run flag.\n")
		fmt.Printf("\n⚠️  WARNING: Running probes will launch real EC2 instances.\n")
		fmt.Printf("   You may incur charges and must have sufficient quotas.\n")
		return nil
	}

	// Execute probes
	fmt.Fprintf(os.Stderr, "\n🚀 Probing %d capacity configuration(s) (concurrency: %d)...\n\n",
		len(requests), probeConcurrency)

	results := executeProbes(ctx, requests, probeConcurrency, capacityType)

	// Output results
	switch probeOutput {
	case "json":
		return outputProbeJSON(results)
	default:
		return outputProbeTable(results)
	}
}

func executeProbes(ctx context.Context, requests []models.ProbeRequest, concurrency int, capacityTypeStr string) *models.ProbeResults {
	results := &models.ProbeResults{
		Timestamp:    time.Now().UTC().Format(time.RFC3339),
		InstanceType: requests[0].InstanceType,
		CapacityType: capacityTypeStr,
		TotalProbes:  len(requests),
	}

	// Collect unique regions
	regionSet := make(map[string]bool)
	for _, req := range requests {
		regionSet[req.Region] = true
	}
	for r := range regionSet {
		results.Regions = append(results.Regions, r)
	}
	sort.Strings(results.Regions)

	// Execute probes with concurrency control
	resultsChan := make(chan *models.ProbeResult, len(requests))
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup

	for _, req := range requests {
		wg.Add(1)
		go func(r models.ProbeRequest) {
			defer wg.Done()
			sem <- struct{}{}        // Acquire
			defer func() { <-sem }() // Release

			result := executeSingleProbe(ctx, r)
			resultsChan <- result

			// Print progress
			status := "✓"
			color := "\033[32m" // Green
			if !result.Success {
				status = "✗"
				color = "\033[31m" // Red
			}
			reset := "\033[0m"
			fmt.Fprintf(os.Stderr, "%s%s%s %s in %s (%s): %s\n",
				color, status, reset, r.InstanceType, r.Region, r.CapacityType, result.Reason)
		}(req)
	}

	go func() {
		wg.Wait()
		close(resultsChan)
	}()

	// Collect results
	for result := range resultsChan {
		results.Results = append(results.Results, *result)
		if result.Success {
			results.SuccessCount++
		} else {
			results.FailureCount++
		}
	}

	// Sort results by region, then capacity type for consistent output
	sort.Slice(results.Results, func(i, j int) bool {
		if results.Results[i].Region != results.Results[j].Region {
			return results.Results[i].Region < results.Results[j].Region
		}
		return results.Results[i].CapacityType < results.Results[j].CapacityType
	})

	return results
}

func executeSingleProbe(ctx context.Context, req models.ProbeRequest) *models.ProbeResult {
	client, err := awsclient.NewClient(ctx, req.Region)
	if err != nil {
		return &models.ProbeResult{
			InstanceType: req.InstanceType,
			Region:       req.Region,
			CapacityType: req.CapacityType,
			Success:      false,
			ErrorCode:    "ClientCreationFailed",
			ErrorMessage: err.Error(),
			Reason:       "Failed to create AWS client for region",
		}
	}

	provider := probe.NewProvider(client)
	result, err := provider.ProbeCapacity(ctx, req)
	if err != nil {
		return &models.ProbeResult{
			InstanceType: req.InstanceType,
			Region:       req.Region,
			CapacityType: req.CapacityType,
			Success:      false,
			ErrorCode:    "ProbeError",
			ErrorMessage: err.Error(),
			Reason:       "Probe execution failed",
		}
	}

	return result
}

func outputProbeJSON(results *models.ProbeResults) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(results)
}

func outputProbeTable(results *models.ProbeResults) error {
	fmt.Println()

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "INSTANCE TYPE\tREGION\tCAPACITY\tSTATUS\tDETAILS")
	fmt.Fprintln(w, "-------------\t------\t--------\t------\t-------")

	for _, r := range results.Results {
		status := "PASS"
		if !r.Success {
			status = "FAIL"
		}

		// Build details string
		details := r.Reason

		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n",
			r.InstanceType, r.Region, r.CapacityType, status, details)
	}
	w.Flush()

	// Summary
	fmt.Println()
	if results.SuccessCount == results.TotalProbes {
		fmt.Printf("📊 Summary: %d/%d probes successful ✓\n", results.SuccessCount, results.TotalProbes)
	} else if results.SuccessCount == 0 {
		fmt.Printf("📊 Summary: %d/%d probes successful ✗\n", results.SuccessCount, results.TotalProbes)
	} else {
		fmt.Printf("📊 Summary: %d/%d probes successful\n", results.SuccessCount, results.TotalProbes)
	}

	return nil
}
