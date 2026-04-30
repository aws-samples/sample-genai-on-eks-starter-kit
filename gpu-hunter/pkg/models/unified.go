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

package models

// InstanceRegionData represents a unified data structure for instance information
// that can be used for both region-based views (multiple instances, single region)
// and lookup views (single instance, multiple regions).
type InstanceRegionData struct {
	// Instance identification
	InstanceType string `json:"instanceType"`
	Region       string `json:"region"`

	// Accelerator info
	AcceleratorType     string `json:"acceleratorType"` // "GPU" or "Neuron"
	AcceleratorName     string `json:"acceleratorName"`
	AcceleratorCount    int    `json:"acceleratorCount"`
	AcceleratorMemoryGB int    `json:"acceleratorMemoryGB"`
	Manufacturer        string `json:"manufacturer"`

	// Instance specs
	VCPU     int `json:"vcpu"`
	MemoryGB int `json:"memoryGB"`

	// Availability & Pricing
	Available        bool     `json:"available"`
	ZoneCount        int      `json:"zoneCount"`
	AvailableZones   []string `json:"availableZones"`
	SpotPrice        float64  `json:"spotPrice"`
	OnDemandPrice    float64  `json:"onDemandPrice"`
	SavingsPercent   int      `json:"savingsPercent"`
	InterruptionRate string   `json:"interruptionRate"` // "<5%", "5-10%", etc.
	SpotScore        int      `json:"spotScore"`        // 1-10
}

// FromGPUInstance converts a GPUInstance to InstanceRegionData
func FromGPUInstance(inst GPUInstance, region string) InstanceRegionData {
	return InstanceRegionData{
		InstanceType:        inst.InstanceType,
		Region:              region,
		AcceleratorType:     inst.AcceleratorType,
		AcceleratorName:     inst.AcceleratorName,
		AcceleratorCount:    inst.AcceleratorCount,
		AcceleratorMemoryGB: inst.AcceleratorMemoryGB,
		Manufacturer:        inst.Manufacturer,
		VCPU:                inst.VCPU,
		MemoryGB:            inst.MemoryGB,
		Available:           true,
		ZoneCount:           inst.ZoneCount,
		AvailableZones:      inst.AvailableZones,
		SpotPrice:           inst.SpotPrice,
		OnDemandPrice:       inst.OnDemandPrice,
		SavingsPercent:      inst.SavingsPercent,
		InterruptionRate:    inst.InterruptionRate,
		SpotScore:           inst.SpotScore,
	}
}

// FromRegionInstanceInfo converts RegionInstanceInfo to InstanceRegionData
// with instance specs provided separately (since RegionInstanceInfo doesn't have them)
func FromRegionInstanceInfo(ri RegionInstanceInfo, instanceType string, specs *InstanceSpecs) InstanceRegionData {
	data := InstanceRegionData{
		InstanceType:     instanceType,
		Region:           ri.Region,
		Available:        ri.Available,
		ZoneCount:        ri.ZoneCount,
		AvailableZones:   ri.AvailableZones,
		SpotPrice:        ri.SpotPrice,
		OnDemandPrice:    ri.OnDemandPrice,
		SavingsPercent:   ri.SavingsPercent,
		InterruptionRate: ri.InterruptionRate,
		SpotScore:        ri.SpotScore,
	}

	if specs != nil {
		data.AcceleratorType = specs.AcceleratorType
		data.AcceleratorName = specs.AcceleratorName
		data.AcceleratorCount = specs.AcceleratorCount
		data.AcceleratorMemoryGB = specs.AcceleratorMemoryGB
		data.Manufacturer = specs.Manufacturer
		data.VCPU = specs.VCPU
		data.MemoryGB = specs.MemoryGB
	}

	return data
}

// InstanceSpecs holds the static specs of an instance type (shared across regions)
type InstanceSpecs struct {
	AcceleratorType     string `json:"acceleratorType"`
	AcceleratorName     string `json:"acceleratorName"`
	AcceleratorCount    int    `json:"acceleratorCount"`
	AcceleratorMemoryGB int    `json:"acceleratorMemoryGB"`
	Manufacturer        string `json:"manufacturer"`
	VCPU                int    `json:"vcpu"`
	MemoryGB            int    `json:"memoryGB"`
}

// ExtractSpecs extracts InstanceSpecs from InstanceTypeGlobalInfo
func ExtractSpecs(info *InstanceTypeGlobalInfo) *InstanceSpecs {
	if info == nil {
		return nil
	}
	return &InstanceSpecs{
		AcceleratorType:     info.AcceleratorType,
		AcceleratorName:     info.AcceleratorName,
		AcceleratorCount:    info.AcceleratorCount,
		AcceleratorMemoryGB: info.AcceleratorMemoryGB,
		Manufacturer:        info.Manufacturer,
		VCPU:                info.VCPU,
		MemoryGB:            info.MemoryGB,
	}
}

// ToGPUInstance converts InstanceRegionData back to GPUInstance for compatibility
func (d InstanceRegionData) ToGPUInstance() GPUInstance {
	return GPUInstance{
		InstanceType:        d.InstanceType,
		AcceleratorType:     d.AcceleratorType,
		AcceleratorName:     d.AcceleratorName,
		AcceleratorCount:    d.AcceleratorCount,
		AcceleratorMemoryGB: d.AcceleratorMemoryGB,
		Manufacturer:        d.Manufacturer,
		VCPU:                d.VCPU,
		MemoryGB:            d.MemoryGB,
		SpotPrice:           d.SpotPrice,
		OnDemandPrice:       d.OnDemandPrice,
		SavingsPercent:      d.SavingsPercent,
		InterruptionRate:    d.InterruptionRate,
		SpotScore:           d.SpotScore,
		ZoneCount:           d.ZoneCount,
		AvailableZones:      d.AvailableZones,
	}
}