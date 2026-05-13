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

package instancetype

import (
	"context"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"

	awsclient "github.com/gpu-hunter/pkg/aws"
	"github.com/gpu-hunter/pkg/models"
)

// Provider discovers GPU and Neuron instance types
type Provider struct {
	client *awsclient.Client
}

// NewProvider creates a new instance type provider
func NewProvider(client *awsclient.Client) *Provider {
	return &Provider{
		client: client,
	}
}

// DiscoverAcceleratorInstances finds all GPU and Neuron instance types in the region
func (p *Provider) DiscoverAcceleratorInstances(ctx context.Context) ([]models.InstanceTypeInfo, error) {
	// Get all instance types
	instanceTypes, err := p.getInstanceTypes(ctx)
	if err != nil {
		return nil, err
	}

	// Get zone offerings
	offerings, err := p.getInstanceTypeOfferings(ctx)
	if err != nil {
		return nil, err
	}

	// Filter and convert to our model
	var results []models.InstanceTypeInfo
	for _, it := range instanceTypes {
		info := p.convertToInstanceTypeInfo(it, offerings)
		if info != nil {
			results = append(results, *info)
		}
	}

	return results, nil
}

// getInstanceTypes retrieves all instance types from EC2
func (p *Provider) getInstanceTypes(ctx context.Context) ([]ec2types.InstanceTypeInfo, error) {
	var instanceTypes []ec2types.InstanceTypeInfo

	paginator := ec2.NewDescribeInstanceTypesPaginator(p.client.EC2, &ec2.DescribeInstanceTypesInput{
		Filters: []ec2types.Filter{
			{
				Name:   aws.String("supported-virtualization-type"),
				Values: []string{"hvm"},
			},
			{
				Name:   aws.String("processor-info.supported-architecture"),
				Values: []string{"x86_64", "arm64"},
			},
		},
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		instanceTypes = append(instanceTypes, page.InstanceTypes...)
	}

	return instanceTypes, nil
}

// getInstanceTypeOfferings retrieves zone availability for instance types
func (p *Provider) getInstanceTypeOfferings(ctx context.Context) (map[ec2types.InstanceType][]string, error) {
	offerings := make(map[ec2types.InstanceType][]string)

	paginator := ec2.NewDescribeInstanceTypeOfferingsPaginator(p.client.EC2, &ec2.DescribeInstanceTypeOfferingsInput{
		LocationType: ec2types.LocationTypeAvailabilityZone,
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}

		for _, offering := range page.InstanceTypeOfferings {
			zone := aws.ToString(offering.Location)
			offerings[offering.InstanceType] = append(offerings[offering.InstanceType], zone)
		}
	}

	return offerings, nil
}

// convertToInstanceTypeInfo converts EC2 instance type info to our model
// Returns nil if the instance type doesn't have GPU or Neuron
func (p *Provider) convertToInstanceTypeInfo(info ec2types.InstanceTypeInfo, offerings map[ec2types.InstanceType][]string) *models.InstanceTypeInfo {
	// Check if this instance has GPU or Neuron
	hasGPU := info.GpuInfo != nil && len(info.GpuInfo.Gpus) > 0
	hasNeuron := info.NeuronInfo != nil && len(info.NeuronInfo.NeuronDevices) > 0

	if !hasGPU && !hasNeuron {
		return nil
	}

	result := &models.InstanceTypeInfo{
		InstanceType:   string(info.InstanceType),
		Region:         p.client.Region,
		VCPUs:          aws.ToInt32(info.VCpuInfo.DefaultVCpus),
		MemoryMiB:      aws.ToInt64(info.MemoryInfo.SizeInMiB),
		AvailableZones: offerings[info.InstanceType],
	}

	// Determine capacity types
	for _, uc := range info.SupportedUsageClasses {
		switch uc {
		case ec2types.UsageClassTypeOnDemand:
			result.SupportsOnDemand = true
		case ec2types.UsageClassTypeSpot:
			result.SupportsSpot = true
		}
	}

	// Extract GPU information
	if hasGPU {
		result.AcceleratorType = models.AcceleratorTypeGPU
		gpu := info.GpuInfo.Gpus[0] // Primary GPU
		
		var totalMemory int64
		var totalCount int32
		for _, g := range info.GpuInfo.Gpus {
			totalCount += aws.ToInt32(g.Count)
			if g.MemoryInfo != nil {
				totalMemory += int64(aws.ToInt32(g.MemoryInfo.SizeInMiB)) * int64(aws.ToInt32(g.Count))
			}
		}

		result.GPU = &models.GPUInfo{
			Name:         strings.ToLower(strings.ReplaceAll(aws.ToString(gpu.Name), " ", "-")),
			Manufacturer: strings.ToLower(aws.ToString(gpu.Manufacturer)),
			Count:        totalCount,
			MemoryMiB:    totalMemory,
		}
	}

	// Extract Neuron information
	if hasNeuron {
		result.AcceleratorType = models.AcceleratorTypeNeuron
		device := info.NeuronInfo.NeuronDevices[0] // Primary device

		var totalCount int32
		var totalCores int32
		for _, d := range info.NeuronInfo.NeuronDevices {
			totalCount += aws.ToInt32(d.Count)
			if d.CoreInfo != nil {
				totalCores += aws.ToInt32(d.Count) * aws.ToInt32(d.CoreInfo.Count)
			}
		}

		result.Neuron = &models.NeuronInfo{
			Name:      strings.ToLower(aws.ToString(device.Name)),
			Count:     totalCount,
			CoreCount: totalCores,
		}
	}

	return result
}

// GetGPUInstanceTypes returns only GPU instance types
func (p *Provider) GetGPUInstanceTypes(ctx context.Context) ([]models.InstanceTypeInfo, error) {
	all, err := p.DiscoverAcceleratorInstances(ctx)
	if err != nil {
		return nil, err
	}

	var gpuTypes []models.InstanceTypeInfo
	for _, it := range all {
		if it.AcceleratorType == models.AcceleratorTypeGPU {
			gpuTypes = append(gpuTypes, it)
		}
	}
	return gpuTypes, nil
}

// GetNeuronInstanceTypes returns only Neuron instance types
func (p *Provider) GetNeuronInstanceTypes(ctx context.Context) ([]models.InstanceTypeInfo, error) {
	all, err := p.DiscoverAcceleratorInstances(ctx)
	if err != nil {
		return nil, err
	}

	var neuronTypes []models.InstanceTypeInfo
	for _, it := range all {
		if it.AcceleratorType == models.AcceleratorTypeNeuron {
			neuronTypes = append(neuronTypes, it)
		}
	}
	return neuronTypes, nil
}