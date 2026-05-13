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

// AcceleratorType represents the type of accelerator
type AcceleratorType string

const (
	AcceleratorTypeGPU    AcceleratorType = "GPU"
	AcceleratorTypeNeuron AcceleratorType = "Neuron"
)

// GPUInfo contains information about a GPU
type GPUInfo struct {
	Name         string `json:"name"`
	Manufacturer string `json:"manufacturer"`
	Count        int32  `json:"count"`
	MemoryMiB    int64  `json:"memoryMiB"`
}

// NeuronInfo contains information about AWS Neuron devices
type NeuronInfo struct {
	Name       string `json:"name"`
	Count      int32  `json:"count"`
	CoreCount  int32  `json:"coreCount"`
	MemoryMiB  int64  `json:"memoryMiB"`
}

// InterruptionRange represents the interruption frequency range
type InterruptionRange struct {
	Label string `json:"label"` // "<5%", "5-10%", "10-15%", "15-20%", ">20%"
	Min   int    `json:"min"`   // Minimum percentage
	Max   int    `json:"max"`   // Maximum percentage
}

// ZoneOffering represents availability in a specific zone
type ZoneOffering struct {
	Zone         string  `json:"zone"`
	Available    bool    `json:"available"`
	SpotPrice    float64 `json:"spotPrice,omitempty"`
	SpotScore    int     `json:"spotScore,omitempty"` // 1-10 score from GetSpotPlacementScores
}

// InstanceTypeInfo contains comprehensive information about an instance type
type InstanceTypeInfo struct {
	InstanceType    string          `json:"instanceType"`
	Region          string          `json:"region"`
	AcceleratorType AcceleratorType `json:"acceleratorType"`
	
	// GPU information (if applicable)
	GPU *GPUInfo `json:"gpu,omitempty"`
	
	// Neuron information (if applicable)
	Neuron *NeuronInfo `json:"neuron,omitempty"`
	
	// Instance specifications
	VCPUs       int32 `json:"vcpus"`
	MemoryMiB   int64 `json:"memoryMiB"`
	
	// Pricing
	OnDemandPrice float64 `json:"onDemandPrice,omitempty"`
	SpotPrice     float64 `json:"spotPrice,omitempty"` // Best spot price across zones
	
	// Availability
	AvailableZones []string       `json:"availableZones"`
	ZoneOfferings  []ZoneOffering `json:"zoneOfferings,omitempty"`
	
	// Spot placement score (1-10, higher is better)
	SpotScore int `json:"spotScore,omitempty"`
	
	// Interruption rate from AWS Spot Advisor
	InterruptionRange *InterruptionRange `json:"interruptionRange,omitempty"`
	Savings           int                `json:"savings,omitempty"` // Savings percentage vs on-demand
	
	// Capacity types supported
	SupportsSpot     bool `json:"supportsSpot"`
	SupportsOnDemand bool `json:"supportsOnDemand"`
}

// RegionSummary contains a summary of GPU/Neuron availability in a region
type RegionSummary struct {
	Region        string             `json:"region"`
	InstanceTypes []InstanceTypeInfo `json:"instanceTypes"`
	TotalGPU      int                `json:"totalGPUTypes"`
	TotalNeuron   int                `json:"totalNeuronTypes"`
}

// HuntResult contains the complete result of a GPU hunt
type HuntResult struct {
	Regions   []RegionSummary `json:"regions"`
	Timestamp string          `json:"timestamp"`
}

// RegionInstanceInfo contains information about an instance type in a specific region
type RegionInstanceInfo struct {
	Region           string   `json:"region"`
	Available        bool     `json:"available"`
	SpotPrice        float64  `json:"spotPrice"`
	OnDemandPrice    float64  `json:"onDemandPrice"`
	SavingsPercent   int      `json:"savingsPercent"`
	InterruptionRate string   `json:"interruptionRate"`
	SpotScore        int      `json:"spotScore"`
	ZoneCount        int      `json:"zoneCount"`
	AvailableZones   []string `json:"availableZones"`
}

// InstanceTypeGlobalInfo contains global information about an instance type across all regions
type InstanceTypeGlobalInfo struct {
	InstanceType        string               `json:"instanceType"`
	AcceleratorType     string               `json:"acceleratorType"` // "GPU" or "Neuron"
	AcceleratorName     string               `json:"acceleratorName"`
	AcceleratorCount    int                  `json:"acceleratorCount"`
	AcceleratorMemoryGB int                  `json:"acceleratorMemoryGB"`
	Manufacturer        string               `json:"manufacturer"`
	VCPU                int                  `json:"vcpu"`
	MemoryGB            int                  `json:"memoryGB"`
	RegionInfo          []RegionInstanceInfo `json:"regionInfo"`
	BestSpotRegion      string               `json:"bestSpotRegion"`
	BestSpotPrice       float64              `json:"bestSpotPrice"`
	AvailableRegions    int                  `json:"availableRegions"`
	TotalRegionsQueried int                  `json:"totalRegionsQueried"`
}

// GPUInstance represents a simplified GPU instance for TUI display
type GPUInstance struct {
	InstanceType        string   `json:"instanceType"`
	AcceleratorType     string   `json:"acceleratorType"` // "GPU" or "Neuron"
	AcceleratorName     string   `json:"acceleratorName"`
	AcceleratorCount    int      `json:"acceleratorCount"`
	AcceleratorMemoryGB int      `json:"acceleratorMemoryGB"`
	Manufacturer        string   `json:"manufacturer"`
	VCPU                int      `json:"vcpu"`
	MemoryGB            int      `json:"memoryGB"`
	SpotPrice           float64  `json:"spotPrice"`
	OnDemandPrice       float64  `json:"onDemandPrice"`
	SavingsPercent      int      `json:"savingsPercent"`
	InterruptionRate    string   `json:"interruptionRate"` // "<5%", "5-10%", etc.
	SpotScore           int      `json:"spotScore"`        // 1-10
	ZoneCount           int      `json:"zoneCount"`
	AvailableZones      []string `json:"availableZones"`
}

// FromInstanceTypeInfo converts InstanceTypeInfo to GPUInstance for TUI
func FromInstanceTypeInfo(info InstanceTypeInfo) GPUInstance {
	inst := GPUInstance{
		InstanceType:    info.InstanceType,
		AcceleratorType: string(info.AcceleratorType),
		VCPU:            int(info.VCPUs),
		MemoryGB:        int(info.MemoryMiB / 1024),
		SpotPrice:       info.SpotPrice,
		OnDemandPrice:   info.OnDemandPrice,
		SavingsPercent:  info.Savings,
		SpotScore:       info.SpotScore,
		ZoneCount:       len(info.AvailableZones),
		AvailableZones:  info.AvailableZones,
	}

	// Set accelerator details
	if info.GPU != nil {
		inst.AcceleratorName = info.GPU.Name
		inst.AcceleratorCount = int(info.GPU.Count)
		inst.AcceleratorMemoryGB = int(info.GPU.MemoryMiB / 1024)
		inst.Manufacturer = info.GPU.Manufacturer
	} else if info.Neuron != nil {
		inst.AcceleratorName = info.Neuron.Name
		inst.AcceleratorCount = int(info.Neuron.Count)
		inst.AcceleratorMemoryGB = int(info.Neuron.MemoryMiB / 1024)
		inst.Manufacturer = "AWS"
	}

	// Set interruption rate
	if info.InterruptionRange != nil {
		inst.InterruptionRate = info.InterruptionRange.Label
	} else {
		inst.InterruptionRate = "-"
	}

	return inst
}
