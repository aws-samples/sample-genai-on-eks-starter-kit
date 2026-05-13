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
	"strings"
	"text/tabwriter"

	"github.com/gpu-hunter/pkg/models"
	"github.com/gpu-hunter/pkg/providers/lookup"
	"github.com/spf13/cobra"
)

var lookupCmd = &cobra.Command{
	Use:   "lookup <instance-type>",
	Short: "Look up a specific instance type across all AWS regions",
	Long: `Look up detailed information about a specific GPU or Neuron instance type
across all AWS regions. This shows pricing, availability, spot scores,
and interruption rates for each region where the instance is available.

Examples:
  gpu-hunter lookup p4d.24xlarge
  gpu-hunter lookup inf2.xlarge --output json
  gpu-hunter lookup g5.xlarge --spot-score`,
	Args: cobra.ExactArgs(1),
	RunE: runLookup,
}

var (
	lookupOutput     string
	lookupSpotScore  bool
)

func init() {
	lookupCmd.Flags().StringVarP(&lookupOutput, "output", "o", "table", "Output format: table, json, wide")
	lookupCmd.Flags().BoolVarP(&lookupSpotScore, "spot-score", "s", false, "Fetch spot placement scores (slower)")
}

func runLookup(cmd *cobra.Command, args []string) error {
	ctx := context.Background()
	instanceType := args[0]

	fmt.Printf("🔍 Looking up %s across all AWS regions...\n\n", instanceType)

	// Create lookup provider
	provider := lookup.NewProvider(lookupSpotScore)

	// Lookup instance across all regions
	result, err := provider.LookupInstance(ctx, instanceType, nil)
	if err != nil {
		return fmt.Errorf("lookup failed: %w", err)
	}

	// Output based on format
	switch lookupOutput {
	case "json":
		return outputLookupJSON(result)
	case "wide":
		return outputLookupWideTable(result)
	default:
		return outputLookupTable(result)
	}
}

func outputLookupJSON(result *models.InstanceTypeGlobalInfo) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	return encoder.Encode(result)
}

func outputLookupTable(result *models.InstanceTypeGlobalInfo) error {
	// Print instance header
	fmt.Printf("Instance: %s", result.InstanceType)
	if result.AcceleratorType != "" {
		fmt.Printf(" (%s - %s %s)", result.AcceleratorType, result.Manufacturer, result.AcceleratorName)
	}
	fmt.Println()

	if result.AcceleratorCount > 0 {
		fmt.Printf("Accelerators: %dx %s", result.AcceleratorCount, result.AcceleratorName)
		if result.AcceleratorMemoryGB > 0 {
			fmt.Printf(" (%d GB total)", result.AcceleratorMemoryGB*result.AcceleratorCount)
		}
		fmt.Println()
	}

	if result.VCPU > 0 {
		fmt.Printf("vCPU: %d | Memory: %d GB\n", result.VCPU, result.MemoryGB)
	}
	fmt.Println()

	// Print table
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "REGION\tSPOT $/HR\tOD $/HR\tSAVE%\tINTERRUPT\tZONES\tSCORE")
	fmt.Fprintln(w, "------\t---------\t-------\t-----\t---------\t-----\t-----")

	for _, ri := range result.RegionInfo {
		if !ri.Available {
			continue
		}

		spotPrice := "-"
		if ri.SpotPrice > 0 {
			spotPrice = fmt.Sprintf("$%.2f", ri.SpotPrice)
		}

		odPrice := "-"
		if ri.OnDemandPrice > 0 {
			odPrice = fmt.Sprintf("$%.2f", ri.OnDemandPrice)
		}

		savings := "-"
		if ri.SavingsPercent > 0 {
			savings = fmt.Sprintf("%d%%", ri.SavingsPercent)
		}

		score := "-"
		if ri.SpotScore > 0 {
			score = fmt.Sprintf("%d/10", ri.SpotScore)
		}

		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%d\t%s\n",
			ri.Region,
			spotPrice,
			odPrice,
			savings,
			ri.InterruptionRate,
			ri.ZoneCount,
			score,
		)
	}
	w.Flush()

	// Print summary
	fmt.Println()
	if result.BestSpotRegion != "" {
		fmt.Printf("🏆 Best Spot Region: %s ($%.2f/hr)\n", result.BestSpotRegion, result.BestSpotPrice)
	}
	fmt.Printf("📊 Available in %d/%d regions\n", result.AvailableRegions, result.TotalRegionsQueried)

	return nil
}

func outputLookupWideTable(result *models.InstanceTypeGlobalInfo) error {
	// Print instance header
	fmt.Printf("Instance: %s", result.InstanceType)
	if result.AcceleratorType != "" {
		fmt.Printf(" (%s - %s %s)", result.AcceleratorType, result.Manufacturer, result.AcceleratorName)
	}
	fmt.Println()

	if result.AcceleratorCount > 0 {
		fmt.Printf("Accelerators: %dx %s", result.AcceleratorCount, result.AcceleratorName)
		if result.AcceleratorMemoryGB > 0 {
			fmt.Printf(" (%d GB total)", result.AcceleratorMemoryGB*result.AcceleratorCount)
		}
		fmt.Println()
	}

	if result.VCPU > 0 {
		fmt.Printf("vCPU: %d | Memory: %d GB\n", result.VCPU, result.MemoryGB)
	}
	fmt.Println()

	// Print wide table with zones
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "REGION\tSPOT $/HR\tOD $/HR\tSAVE%\tINTERRUPT\tSCORE\tAVAILABLE ZONES")
	fmt.Fprintln(w, "------\t---------\t-------\t-----\t---------\t-----\t---------------")

	for _, ri := range result.RegionInfo {
		if !ri.Available {
			continue
		}

		spotPrice := "-"
		if ri.SpotPrice > 0 {
			spotPrice = fmt.Sprintf("$%.2f", ri.SpotPrice)
		}

		odPrice := "-"
		if ri.OnDemandPrice > 0 {
			odPrice = fmt.Sprintf("$%.2f", ri.OnDemandPrice)
		}

		savings := "-"
		if ri.SavingsPercent > 0 {
			savings = fmt.Sprintf("%d%%", ri.SavingsPercent)
		}

		score := "-"
		if ri.SpotScore > 0 {
			score = fmt.Sprintf("%d/10", ri.SpotScore)
		}

		zones := strings.Join(ri.AvailableZones, ", ")
		if len(zones) > 50 {
			zones = zones[:47] + "..."
		}

		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
			ri.Region,
			spotPrice,
			odPrice,
			savings,
			ri.InterruptionRate,
			score,
			zones,
		)
	}
	w.Flush()

	// Print summary
	fmt.Println()
	if result.BestSpotRegion != "" {
		fmt.Printf("🏆 Best Spot Region: %s ($%.2f/hr)\n", result.BestSpotRegion, result.BestSpotPrice)
	}
	fmt.Printf("📊 Available in %d/%d regions\n", result.AvailableRegions, result.TotalRegionsQueried)

	return nil
}