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

package table

import (
	"fmt"

	"github.com/gpu-hunter/pkg/models"
)

// RegionViewColumns returns columns for the region view (multiple instances, single region)
// This is the main TUI table view
func RegionViewColumns(showScores bool, wideMode bool) []Column {
	cols := []Column{
		{
			Header:   "Instance Type",
			MinWidth: 12,
			Weight:   18,
			Getter:   func(r models.InstanceRegionData) string { return r.InstanceType },
		},
		{
			Header:    "Type",
			MinWidth:  4,
			Weight:    6,
			Getter:    func(r models.InstanceRegionData) string { return r.AcceleratorType },
			StyleFunc: TypeStyle,
		},
		{
			Header:   "Accelerator",
			MinWidth: 10,
			Weight:   20,
			Getter:   func(r models.InstanceRegionData) string { return r.AcceleratorName },
		},
		{
			Header:   "Cnt",
			MinWidth: 3,
			Weight:   4,
			Getter:   func(r models.InstanceRegionData) string { return fmt.Sprintf("%d", r.AcceleratorCount) },
		},
		{
			Header:   "AZ",
			MinWidth: 2,
			Weight:   3,
			Getter:   func(r models.InstanceRegionData) string { return fmt.Sprintf("%d", r.ZoneCount) },
		},
		{
			Header:    "Spot $/hr",
			MinWidth:  7,
			Weight:    9,
			Getter:    func(r models.InstanceRegionData) string { return formatPrice(r.SpotPrice) },
			StyleFunc: PriceStyle,
		},
		{
			Header:    "OD $/hr",
			MinWidth:  7,
			Weight:    9,
			Getter:    func(r models.InstanceRegionData) string { return formatPrice(r.OnDemandPrice) },
			StyleFunc: PriceStyle,
		},
		{
			Header:    "Save%",
			MinWidth:  5,
			Weight:    6,
			Getter:    func(r models.InstanceRegionData) string { return formatSavings(r.SavingsPercent) },
			StyleFunc: SavingsStyle,
		},
		{
			Header:    "Interrupt",
			MinWidth:  6,
			Weight:    10,
			Getter:    func(r models.InstanceRegionData) string { return r.InterruptionRate },
			StyleFunc: InterruptStyle,
		},
	}

	if showScores {
		cols = append(cols, Column{
			Header:   "Score",
			MinWidth: 5,
			Weight:   6,
			Getter:   func(r models.InstanceRegionData) string { return formatScore(r.SpotScore) },
		})
	}

	if wideMode {
		cols = append(cols,
			Column{
				Header:   "Mem",
				MinWidth: 4,
				Weight:   5,
				Getter:   func(r models.InstanceRegionData) string { return fmt.Sprintf("%dG", r.AcceleratorMemoryGB) },
			},
			Column{
				Header:   "vCPU",
				MinWidth: 4,
				Weight:   5,
				Getter:   func(r models.InstanceRegionData) string { return fmt.Sprintf("%d", r.VCPU) },
			},
		)
	}

	return cols
}

// LookupViewColumns returns columns for the lookup view (single instance, multiple regions)
func LookupViewColumns() []Column {
	return []Column{
		{
			Header:   "Region",
			MinWidth: 12,
			Weight:   16,
			Getter:   func(r models.InstanceRegionData) string { return r.Region },
		},
		{
			Header:    "Spot $/hr",
			MinWidth:  8,
			Weight:    9,
			Getter:    func(r models.InstanceRegionData) string { return formatPrice(r.SpotPrice) },
			StyleFunc: PriceStyle,
		},
		{
			Header:    "OD $/hr",
			MinWidth:  8,
			Weight:    9,
			Getter:    func(r models.InstanceRegionData) string { return formatPrice(r.OnDemandPrice) },
			StyleFunc: PriceStyle,
		},
		{
			Header:    "Save%",
			MinWidth:  6,
			Weight:    7,
			Getter:    func(r models.InstanceRegionData) string { return formatSavings(r.SavingsPercent) },
			StyleFunc: SavingsStyle,
		},
		{
			Header:    "Interrupt",
			MinWidth:  8,
			Weight:    10,
			Getter:    func(r models.InstanceRegionData) string { return r.InterruptionRate },
			StyleFunc: InterruptStyle,
		},
		{
			Header:   "Zones",
			MinWidth: 5,
			Weight:   6,
			Getter:   func(r models.InstanceRegionData) string { return fmt.Sprintf("%d", r.ZoneCount) },
		},
		{
			Header:   "Score",
			MinWidth: 6,
			Weight:   7,
			Getter:   func(r models.InstanceRegionData) string { return formatScore(r.SpotScore) },
		},
	}
}

// AggregateViewColumns returns columns for the aggregate view (multiple instances × multiple regions)
func AggregateViewColumns() []Column {
	return []Column{
		{
			Header:   "Instance Type",
			MinWidth: 14,
			Weight:   16,
			Getter:   func(r models.InstanceRegionData) string { return r.InstanceType },
		},
		{
			Header:   "Region",
			MinWidth: 12,
			Weight:   14,
			Getter:   func(r models.InstanceRegionData) string { return r.Region },
		},
		{
			Header:    "Spot $/hr",
			MinWidth:  8,
			Weight:    9,
			Getter:    func(r models.InstanceRegionData) string { return formatPrice(r.SpotPrice) },
			StyleFunc: PriceStyle,
		},
		{
			Header:    "OD $/hr",
			MinWidth:  8,
			Weight:    9,
			Getter:    func(r models.InstanceRegionData) string { return formatPrice(r.OnDemandPrice) },
			StyleFunc: PriceStyle,
		},
		{
			Header:    "Save%",
			MinWidth:  6,
			Weight:    7,
			Getter:    func(r models.InstanceRegionData) string { return formatSavings(r.SavingsPercent) },
			StyleFunc: SavingsStyle,
		},
		{
			Header:    "Interrupt",
			MinWidth:  8,
			Weight:    10,
			Getter:    func(r models.InstanceRegionData) string { return r.InterruptionRate },
			StyleFunc: InterruptStyle,
		},
		{
			Header:   "Zones",
			MinWidth: 5,
			Weight:   6,
			Getter:   func(r models.InstanceRegionData) string { return fmt.Sprintf("%d", r.ZoneCount) },
		},
		{
			Header:   "Score",
			MinWidth: 6,
			Weight:   7,
			Getter:   func(r models.InstanceRegionData) string { return formatScore(r.SpotScore) },
		},
	}
}

// CLITableColumns returns columns for CLI table output (similar to region view but for CLI)
func CLITableColumns(showPricing bool, showSpotScore bool) []Column {
	cols := []Column{
		{
			Header:   "Instance Type",
			MinWidth: 12,
			Weight:   18,
			Getter:   func(r models.InstanceRegionData) string { return r.InstanceType },
		},
		{
			Header:    "Type",
			MinWidth:  4,
			Weight:    6,
			Getter:    func(r models.InstanceRegionData) string { return r.AcceleratorType },
			StyleFunc: TypeStyle,
		},
		{
			Header:   "Accelerator",
			MinWidth: 10,
			Weight:   20,
			Getter:   func(r models.InstanceRegionData) string { return r.AcceleratorName },
		},
		{
			Header:   "Count",
			MinWidth: 5,
			Weight:   5,
			Getter:   func(r models.InstanceRegionData) string { return fmt.Sprintf("%d", r.AcceleratorCount) },
		},
		{
			Header:   "Memory",
			MinWidth: 6,
			Weight:   6,
			Getter:   func(r models.InstanceRegionData) string { return fmt.Sprintf("%d GB", r.AcceleratorMemoryGB) },
		},
		{
			Header:   "Zones",
			MinWidth: 5,
			Weight:   5,
			Getter:   func(r models.InstanceRegionData) string { return fmt.Sprintf("%d", r.ZoneCount) },
		},
		{
			Header:    "Interrupt",
			MinWidth:  8,
			Weight:    10,
			Getter:    func(r models.InstanceRegionData) string { return r.InterruptionRate },
			StyleFunc: InterruptStyle,
		},
	}

	if showPricing {
		cols = append(cols,
			Column{
				Header:    "Spot $/hr",
				MinWidth:  8,
				Weight:    9,
				Getter:    func(r models.InstanceRegionData) string { return formatPrice(r.SpotPrice) },
				StyleFunc: PriceStyle,
			},
			Column{
				Header:    "OD $/hr",
				MinWidth:  8,
				Weight:    9,
				Getter:    func(r models.InstanceRegionData) string { return formatPrice(r.OnDemandPrice) },
				StyleFunc: PriceStyle,
			},
			Column{
				Header:    "Savings",
				MinWidth:  7,
				Weight:    7,
				Getter:    func(r models.InstanceRegionData) string { return formatSavings(r.SavingsPercent) },
				StyleFunc: SavingsStyle,
			},
		)
	}

	if showSpotScore {
		cols = append(cols, Column{
			Header:   "Score",
			MinWidth: 6,
			Weight:   6,
			Getter:   func(r models.InstanceRegionData) string { return formatScore(r.SpotScore) },
		})
	}

	return cols
}

// Helper formatting functions

func formatPrice(price float64) string {
	if price <= 0 {
		return "-"
	}
	return fmt.Sprintf("$%.2f", price)
}

func formatSavings(savings int) string {
	if savings <= 0 {
		return "-"
	}
	return fmt.Sprintf("%d%%", savings)
}

func formatScore(score int) string {
	if score <= 0 {
		return "-"
	}
	return fmt.Sprintf("%d/10", score)
}