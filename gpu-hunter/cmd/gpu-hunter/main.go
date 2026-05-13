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
	"time"

	"github.com/olekukonko/tablewriter"
	"github.com/spf13/cobra"

	awsclient "github.com/gpu-hunter/pkg/aws"
	"github.com/gpu-hunter/pkg/models"
	"github.com/gpu-hunter/pkg/providers/instancetype"
	"github.com/gpu-hunter/pkg/providers/interruption"
	"github.com/gpu-hunter/pkg/providers/pricing"
	"github.com/gpu-hunter/pkg/providers/spotplacement"
)

var (
	regions         []string
	outputFormat    string
	acceleratorType string
	showPricing     bool
	showSpotScore   bool
	allRegions      bool
	manufacturer    string
	sortBy          string
	minScore        int
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "gpu-hunter",
		Short: "Hunt for GPU and Neuron instance availability across AWS regions",
		Long: `GPU Hunter discovers GPU and Neuron instance types across AWS regions,
showing availability, pricing, interruption rates, and spot placement scores.

Inspired by Karpenter's instance type discovery capabilities.`,
		RunE: run,
	}

	rootCmd.Flags().StringSliceVarP(&regions, "regions", "r", awsclient.DefaultGPURegions(), "AWS regions to check (comma-separated)")
	rootCmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "Output format: table, json")
	rootCmd.Flags().StringVarP(&acceleratorType, "type", "t", "all", "Accelerator type: gpu, neuron, all")
	rootCmd.Flags().BoolVarP(&showPricing, "pricing", "p", true, "Show pricing information")
	rootCmd.Flags().BoolVarP(&showSpotScore, "spot-score", "s", false, "Show spot placement scores (slower)")
	rootCmd.Flags().BoolVarP(&allRegions, "all-regions", "a", false, "Check all enabled AWS regions")
	rootCmd.Flags().StringVarP(&manufacturer, "manufacturer", "m", "", "Filter by GPU manufacturer: nvidia, amd, habana")
	rootCmd.Flags().StringVar(&sortBy, "sort", "name", "Sort by: name, price, score, interruption, savings")
	rootCmd.Flags().IntVar(&minScore, "min-score", 0, "Filter by minimum spot placement score (1-10)")

	// Add subcommands
	rootCmd.AddCommand(tuiCmd)
	rootCmd.AddCommand(lookupCmd)
	rootCmd.AddCommand(probeCmd)

	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func run(cmd *cobra.Command, args []string) error {
	ctx := context.Background()

	// Get regions to check
	regionsToCheck := regions
	if allRegions {
		var err error
		regionsToCheck, err = awsclient.GetAllRegions(ctx)
		if err != nil {
			return fmt.Errorf("failed to get all regions: %w", err)
		}
	}

	fmt.Fprintf(os.Stderr, "🔍 Hunting for accelerator instances in %d regions...\n", len(regionsToCheck))

	// Fetch interruption data (single HTTP call, no AWS credentials needed)
	interruptionProvider := interruption.NewProvider()
	if err := interruptionProvider.FetchData(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "⚠️  Could not fetch interruption data: %v\n", err)
	} else {
		fmt.Fprintf(os.Stderr, "✓ Fetched spot interruption data from AWS Spot Advisor\n")
	}

	// Collect results from all regions
	var allResults []models.InstanceTypeInfo
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, region := range regionsToCheck {
		wg.Add(1)
		go func(region string) {
			defer wg.Done()

			results, err := huntRegion(ctx, region, interruptionProvider)
			if err != nil {
				fmt.Fprintf(os.Stderr, "⚠️  Error in %s: %v\n", region, err)
				return
			}

			mu.Lock()
			allResults = append(allResults, results...)
			mu.Unlock()

			fmt.Fprintf(os.Stderr, "✓ %s: found %d accelerator instance types\n", region, len(results))
		}(region)
	}

	wg.Wait()

	// Filter by accelerator type and other criteria
	filteredResults := filterResults(allResults)

	// Sort results
	sortResults(filteredResults)

	// Output results
	switch outputFormat {
	case "json":
		return outputJSON(filteredResults)
	default:
		return outputTable(filteredResults)
	}
}

func huntRegion(ctx context.Context, region string, interruptionProvider *interruption.Provider) ([]models.InstanceTypeInfo, error) {
	client, err := awsclient.NewClient(ctx, region)
	if err != nil {
		return nil, err
	}

	// Discover instance types
	itProvider := instancetype.NewProvider(client)
	instances, err := itProvider.DiscoverAcceleratorInstances(ctx)
	if err != nil {
		return nil, err
	}

	// Enrich with pricing if requested
	if showPricing {
		pricingProvider := pricing.NewProvider(client)
		if err := pricingProvider.EnrichWithPricing(ctx, instances); err != nil {
			// Log but don't fail
			fmt.Fprintf(os.Stderr, "⚠️  Pricing error in %s: %v\n", region, err)
		}
	}

	// Enrich with spot scores if requested
	if showSpotScore {
		spotProvider := spotplacement.NewProvider(client)
		if err := spotProvider.EnrichWithSpotScores(ctx, instances); err != nil {
			// Log but don't fail
			fmt.Fprintf(os.Stderr, "⚠️  Spot score error in %s: %v\n", region, err)
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

	return instances, nil
}

func filterResults(results []models.InstanceTypeInfo) []models.InstanceTypeInfo {
	var filtered []models.InstanceTypeInfo

	for _, r := range results {
		// Filter by accelerator type
		switch acceleratorType {
		case "gpu":
			if r.AcceleratorType != models.AcceleratorTypeGPU {
				continue
			}
		case "neuron":
			if r.AcceleratorType != models.AcceleratorTypeNeuron {
				continue
			}
		}

		// Filter by manufacturer
		if manufacturer != "" && r.GPU != nil {
			if !strings.EqualFold(r.GPU.Manufacturer, manufacturer) {
				continue
			}
		}

		// Filter by minimum spot score
		if minScore > 0 && r.SpotScore < minScore {
			continue
		}

		filtered = append(filtered, r)
	}

	return filtered
}

func sortResults(results []models.InstanceTypeInfo) {
	sort.Slice(results, func(i, j int) bool {
		// Primary sort by region
		if results[i].Region != results[j].Region {
			return results[i].Region < results[j].Region
		}

		// Secondary sort based on --sort flag
		switch sortBy {
		case "price":
			// Sort by spot price (ascending), 0 values go to end
			if results[i].SpotPrice == 0 && results[j].SpotPrice == 0 {
				return results[i].InstanceType < results[j].InstanceType
			}
			if results[i].SpotPrice == 0 {
				return false
			}
			if results[j].SpotPrice == 0 {
				return true
			}
			return results[i].SpotPrice < results[j].SpotPrice

		case "score":
			// Sort by spot score (descending), 0 values go to end
			if results[i].SpotScore == 0 && results[j].SpotScore == 0 {
				return results[i].InstanceType < results[j].InstanceType
			}
			if results[i].SpotScore == 0 {
				return false
			}
			if results[j].SpotScore == 0 {
				return true
			}
			return results[i].SpotScore > results[j].SpotScore

		case "interruption":
			// Sort by interruption rate (ascending - lower is better)
			iMin := getInterruptionMin(results[i])
			jMin := getInterruptionMin(results[j])
			if iMin == jMin {
				return results[i].InstanceType < results[j].InstanceType
			}
			// -1 (no data) goes to end
			if iMin == -1 {
				return false
			}
			if jMin == -1 {
				return true
			}
			return iMin < jMin

		case "savings":
			// Sort by savings percentage (descending)
			if results[i].Savings == results[j].Savings {
				return results[i].InstanceType < results[j].InstanceType
			}
			return results[i].Savings > results[j].Savings

		default: // "name"
			return results[i].InstanceType < results[j].InstanceType
		}
	})
}

func getInterruptionMin(it models.InstanceTypeInfo) int {
	if it.InterruptionRange == nil {
		return -1
	}
	return it.InterruptionRange.Min
}

func outputJSON(results []models.InstanceTypeInfo) error {
	output := models.HuntResult{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	// Group by region
	regionMap := make(map[string][]models.InstanceTypeInfo)
	for _, r := range results {
		regionMap[r.Region] = append(regionMap[r.Region], r)
	}

	for region, instances := range regionMap {
		gpuCount := 0
		neuronCount := 0
		for _, it := range instances {
			if it.AcceleratorType == models.AcceleratorTypeGPU {
				gpuCount++
			} else {
				neuronCount++
			}
		}

		output.Regions = append(output.Regions, models.RegionSummary{
			Region:        region,
			InstanceTypes: instances,
			TotalGPU:      gpuCount,
			TotalNeuron:   neuronCount,
		})
	}

	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(output)
}

func outputTable(results []models.InstanceTypeInfo) error {
	if len(results) == 0 {
		fmt.Println("No accelerator instances found.")
		return nil
	}

	// Group by region
	regionMap := make(map[string][]models.InstanceTypeInfo)
	for _, r := range results {
		regionMap[r.Region] = append(regionMap[r.Region], r)
	}

	// Get sorted region list
	var regionList []string
	for region := range regionMap {
		regionList = append(regionList, region)
	}
	sort.Strings(regionList)

	for _, region := range regionList {
		instances := regionMap[region]

		fmt.Printf("\n📍 Region: %s\n", region)
		fmt.Println(strings.Repeat("=", 140))

		table := tablewriter.NewWriter(os.Stdout)

		headers := []string{"Instance Type", "Type", "Accelerator", "Count", "Memory", "Zones", "Interrupt"}
		if showPricing {
			headers = append(headers, "Spot $/hr", "OD $/hr", "Savings")
		}
		if showSpotScore {
			headers = append(headers, "Score")
		}
		table.SetHeader(headers)

		table.SetBorder(false)
		table.SetHeaderAlignment(tablewriter.ALIGN_LEFT)
		table.SetAlignment(tablewriter.ALIGN_LEFT)
		table.SetCenterSeparator("")
		table.SetColumnSeparator("")
		table.SetRowSeparator("")
		table.SetHeaderLine(true)
		table.SetTablePadding("\t")

		for _, it := range instances {
			row := []string{
				it.InstanceType,
				string(it.AcceleratorType),
				getAcceleratorName(it),
				getAcceleratorCount(it),
				getAcceleratorMemory(it),
				fmt.Sprintf("%d", len(it.AvailableZones)),
				getInterruptionLabel(it),
			}

			if showPricing {
				spotPrice := "-"
				odPrice := "-"
				savings := "-"
				if it.SpotPrice > 0 {
					spotPrice = fmt.Sprintf("$%.2f", it.SpotPrice)
				}
				if it.OnDemandPrice > 0 {
					odPrice = fmt.Sprintf("$%.2f", it.OnDemandPrice)
				}
				if it.Savings > 0 {
					savings = fmt.Sprintf("%d%%", it.Savings)
				}
				row = append(row, spotPrice, odPrice, savings)
			}

			if showSpotScore {
				scoreStr := "-"
				if it.SpotScore > 0 {
					scoreStr = fmt.Sprintf("%d/10", it.SpotScore)
				}
				row = append(row, scoreStr)
			}

			table.Append(row)
		}

		table.Render()

		// Summary
		gpuCount := 0
		neuronCount := 0
		for _, it := range instances {
			if it.AcceleratorType == models.AcceleratorTypeGPU {
				gpuCount++
			} else {
				neuronCount++
			}
		}
		fmt.Printf("\n📊 Summary: %d GPU types, %d Neuron types\n", gpuCount, neuronCount)
	}

	return nil
}

func getAcceleratorName(it models.InstanceTypeInfo) string {
	if it.GPU != nil {
		return fmt.Sprintf("%s (%s)", it.GPU.Name, it.GPU.Manufacturer)
	}
	if it.Neuron != nil {
		return it.Neuron.Name
	}
	return "-"
}

func getAcceleratorCount(it models.InstanceTypeInfo) string {
	if it.GPU != nil {
		return fmt.Sprintf("%d", it.GPU.Count)
	}
	if it.Neuron != nil {
		return fmt.Sprintf("%d (%d cores)", it.Neuron.Count, it.Neuron.CoreCount)
	}
	return "-"
}

func getAcceleratorMemory(it models.InstanceTypeInfo) string {
	if it.GPU != nil && it.GPU.MemoryMiB > 0 {
		return fmt.Sprintf("%d GB", it.GPU.MemoryMiB/1024)
	}
	if it.Neuron != nil && it.Neuron.MemoryMiB > 0 {
		return fmt.Sprintf("%d GB", it.Neuron.MemoryMiB/1024)
	}
	return "-"
}

func getInterruptionLabel(it models.InstanceTypeInfo) string {
	if it.InterruptionRange == nil {
		return "-"
	}
	return it.InterruptionRange.Label
}