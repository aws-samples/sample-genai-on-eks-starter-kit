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

package lookup

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"
	awsclient "github.com/gpu-hunter/pkg/aws"
	"github.com/gpu-hunter/pkg/models"
	"github.com/gpu-hunter/pkg/providers/interruption"
	"github.com/gpu-hunter/pkg/providers/pricing"
	"github.com/gpu-hunter/pkg/providers/spotplacement"
)

// AllAWSRegions returns all AWS regions to query
func AllAWSRegions() []string {
	return []string{
		// US regions
		"us-east-1",
		"us-east-2",
		"us-west-1",
		"us-west-2",
		// Europe regions
		"eu-west-1",
		"eu-west-2",
		"eu-west-3",
		"eu-central-1",
		"eu-central-2",
		"eu-north-1",
		"eu-south-1",
		"eu-south-2",
		// Asia Pacific regions
		"ap-northeast-1",
		"ap-northeast-2",
		"ap-northeast-3",
		"ap-southeast-1",
		"ap-southeast-2",
		"ap-southeast-3",
		"ap-southeast-4",
		"ap-south-1",
		"ap-south-2",
		"ap-east-1",
		// Other regions
		"sa-east-1",
		"ca-central-1",
		"ca-west-1",
		"me-south-1",
		"me-central-1",
		"af-south-1",
		"il-central-1",
	}
}

// Provider handles looking up instance types across regions
type Provider struct {
	interruptionProvider *interruption.Provider
	fetchSpotScores      bool
	concurrency          int
}

// NewProvider creates a new lookup provider
func NewProvider(fetchSpotScores bool) *Provider {
	return &Provider{
		interruptionProvider: interruption.NewProvider(),
		fetchSpotScores:      fetchSpotScores,
		concurrency:          10, // Max concurrent region queries
	}
}

// regionResult holds the result of querying a single region
type regionResult struct {
	region string
	info   *models.RegionInstanceInfo
	specs  *instanceSpecs
	err    error
}

// instanceSpecs holds the static specs of an instance type
type instanceSpecs struct {
	acceleratorType     string
	acceleratorName     string
	acceleratorCount    int
	acceleratorMemoryGB int
	manufacturer        string
	vcpu                int
	memoryGB            int
}

// IsPrefix checks if the input is a prefix (no size specified)
func IsPrefix(input string) bool {
	return !strings.Contains(input, ".")
}

// ExpandPrefix expands a prefix like "g7e" to all matching instance types
func (p *Provider) ExpandPrefix(ctx context.Context, prefix string) ([]string, error) {
	// Use us-east-1 as reference region for instance type discovery
	client, err := awsclient.NewClient(ctx, "us-east-1")
	if err != nil {
		return nil, fmt.Errorf("failed to create client: %w", err)
	}

	// Query all instance types matching the prefix
	ec2Client := client.EC2
	var instanceTypes []string
	var nextToken *string

	for {
		input := &ec2.DescribeInstanceTypesInput{
			NextToken: nextToken,
			Filters: []ec2types.Filter{
				{
					Name:   aws.String("instance-type"),
					Values: []string{prefix + ".*"},
				},
			},
		}

		output, err := ec2Client.DescribeInstanceTypes(ctx, input)
		if err != nil {
			return nil, fmt.Errorf("failed to describe instance types: %w", err)
		}

		for _, it := range output.InstanceTypes {
			instanceTypes = append(instanceTypes, string(it.InstanceType))
		}

		if output.NextToken == nil {
			break
		}
		nextToken = output.NextToken
	}

	if len(instanceTypes) == 0 {
		return nil, fmt.Errorf("no instance types found matching prefix: %s", prefix)
	}

	// Sort by size (xlarge, 2xlarge, etc.)
	sort.Slice(instanceTypes, func(i, j int) bool {
		return instanceSizeRank(instanceTypes[i]) < instanceSizeRank(instanceTypes[j])
	})

	return instanceTypes, nil
}

// instanceSizeRank returns a sortable rank for instance sizes
func instanceSizeRank(instanceType string) int {
	parts := strings.Split(instanceType, ".")
	if len(parts) < 2 {
		return 999
	}
	size := parts[1]

	sizeOrder := map[string]int{
		"xlarge":   3,
		"2xlarge":  4,
		"4xlarge":  5,
		"8xlarge":  6,
		"12xlarge": 7,
		"16xlarge": 8,
		"24xlarge": 9,
		"32xlarge": 10,
		"48xlarge": 11,
		"metal":    12,
	}

	if rank, ok := sizeOrder[size]; ok {
		return rank
	}
	return 999
}

// LookupInstance looks up a specific instance type across all regions
func (p *Provider) LookupInstance(ctx context.Context, instanceType string, regions []string) (*models.InstanceTypeGlobalInfo, error) {
	if len(regions) == 0 {
		regions = AllAWSRegions()
	}

	// Pre-fetch interruption data (it's global)
	p.interruptionProvider.FetchData(ctx)

	// Create result channel and semaphore for concurrency control
	results := make(chan regionResult, len(regions))
	sem := make(chan struct{}, p.concurrency)

	var wg sync.WaitGroup

	// Query each region in parallel
	for _, region := range regions {
		wg.Add(1)
		go func(r string) {
			defer wg.Done()

			// Acquire semaphore
			sem <- struct{}{}
			defer func() { <-sem }()

			info, specs, err := p.queryRegion(ctx, instanceType, r)
			results <- regionResult{
				region: r,
				info:   info,
				specs:  specs,
				err:    err,
			}
		}(region)
	}

	// Close results channel when all goroutines complete
	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect results
	var regionInfos []models.RegionInstanceInfo
	var specs *instanceSpecs
	availableCount := 0

	for result := range results {
		if result.err != nil {
			// Log error but continue - region might not support the instance type
			continue
		}

		if result.info != nil {
			regionInfos = append(regionInfos, *result.info)
			if result.info.Available {
				availableCount++
			}
		}

		// Capture specs from first successful result
		if specs == nil && result.specs != nil {
			specs = result.specs
		}
	}

	if len(regionInfos) == 0 {
		return nil, fmt.Errorf("instance type %s not found in any region", instanceType)
	}

	// Sort by spot price (lowest first), with unavailable regions at the end
	sort.Slice(regionInfos, func(i, j int) bool {
		if !regionInfos[i].Available && regionInfos[j].Available {
			return false
		}
		if regionInfos[i].Available && !regionInfos[j].Available {
			return true
		}
		return regionInfos[i].SpotPrice < regionInfos[j].SpotPrice
	})

	// Find best spot region
	var bestRegion string
	var bestPrice float64
	for _, ri := range regionInfos {
		if ri.Available && ri.SpotPrice > 0 {
			if bestRegion == "" || ri.SpotPrice < bestPrice {
				bestRegion = ri.Region
				bestPrice = ri.SpotPrice
			}
		}
	}

	// Build result
	result := &models.InstanceTypeGlobalInfo{
		InstanceType:        instanceType,
		RegionInfo:          regionInfos,
		BestSpotRegion:      bestRegion,
		BestSpotPrice:       bestPrice,
		AvailableRegions:    availableCount,
		TotalRegionsQueried: len(regions),
	}

	// Add specs if we got them
	if specs != nil {
		result.AcceleratorType = specs.acceleratorType
		result.AcceleratorName = specs.acceleratorName
		result.AcceleratorCount = specs.acceleratorCount
		result.AcceleratorMemoryGB = specs.acceleratorMemoryGB
		result.Manufacturer = specs.manufacturer
		result.VCPU = specs.vcpu
		result.MemoryGB = specs.memoryGB
	}

	return result, nil
}

// queryRegion queries a single region for instance type information
func (p *Provider) queryRegion(ctx context.Context, instanceType string, region string) (*models.RegionInstanceInfo, *instanceSpecs, error) {
	// Create AWS client for this region
	client, err := awsclient.NewClient(ctx, region)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create client for %s: %w", region, err)
	}

	// Get instance type info
	ec2Client := client.EC2
	describeInput := &ec2.DescribeInstanceTypesInput{
		InstanceTypes: []ec2types.InstanceType{ec2types.InstanceType(instanceType)},
	}

	describeOutput, err := ec2Client.DescribeInstanceTypes(ctx, describeInput)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to describe instance type in %s: %w", region, err)
	}

	if len(describeOutput.InstanceTypes) == 0 {
		// Instance type not available in this region
		return &models.RegionInstanceInfo{
			Region:    region,
			Available: false,
		}, nil, nil
	}

	instInfo := describeOutput.InstanceTypes[0]

	// Extract specs
	specs := &instanceSpecs{
		vcpu:     int(aws.ToInt32(instInfo.VCpuInfo.DefaultVCpus)),
		memoryGB: int(aws.ToInt64(instInfo.MemoryInfo.SizeInMiB) / 1024),
	}

	// Check for GPU
	if instInfo.GpuInfo != nil && len(instInfo.GpuInfo.Gpus) > 0 {
		gpu := instInfo.GpuInfo.Gpus[0]
		specs.acceleratorType = "GPU"
		specs.acceleratorName = aws.ToString(gpu.Name)
		specs.acceleratorCount = int(aws.ToInt32(gpu.Count))
		specs.manufacturer = aws.ToString(gpu.Manufacturer)
		if gpu.MemoryInfo != nil {
			specs.acceleratorMemoryGB = int(aws.ToInt32(gpu.MemoryInfo.SizeInMiB) / 1024)
		}
	}

	// Check for Neuron (inference accelerators)
	if instInfo.InferenceAcceleratorInfo != nil && len(instInfo.InferenceAcceleratorInfo.Accelerators) > 0 {
		neuron := instInfo.InferenceAcceleratorInfo.Accelerators[0]
		specs.acceleratorType = "Neuron"
		specs.acceleratorName = aws.ToString(neuron.Name)
		specs.acceleratorCount = int(aws.ToInt32(neuron.Count))
		specs.manufacturer = aws.ToString(neuron.Manufacturer)
	}

	// Get availability zones
	offeringsInput := &ec2.DescribeInstanceTypeOfferingsInput{
		LocationType: ec2types.LocationTypeAvailabilityZone,
		Filters: []ec2types.Filter{
			{
				Name:   aws.String("instance-type"),
				Values: []string{instanceType},
			},
		},
	}

	offeringsOutput, err := ec2Client.DescribeInstanceTypeOfferings(ctx, offeringsInput)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get offerings in %s: %w", region, err)
	}

	var zones []string
	for _, offering := range offeringsOutput.InstanceTypeOfferings {
		zones = append(zones, aws.ToString(offering.Location))
	}

	if len(zones) == 0 {
		return &models.RegionInstanceInfo{
			Region:    region,
			Available: false,
		}, specs, nil
	}

	// Get pricing
	pricingProvider := pricing.NewProvider(client)
	spotPrice, onDemandPrice, err := pricingProvider.GetPricesForInstance(ctx, instanceType)
	if err != nil {
		// Continue without pricing
		spotPrice = 0
		onDemandPrice = 0
	}

	// Calculate savings
	savingsPercent := 0
	if onDemandPrice > 0 && spotPrice > 0 {
		savingsPercent = int((1 - spotPrice/onDemandPrice) * 100)
	}

	// Get interruption rate
	interruptionRate := "-"
	if p.interruptionProvider.IsDataLoaded() {
		data := p.interruptionProvider.GetInterruptionRate(instanceType, region)
		if data != nil {
			interruptionRate = data.Range.Label
			if savingsPercent == 0 {
				savingsPercent = data.Savings
			}
		}
	}

	// Get spot score if requested
	spotScore := 0
	if p.fetchSpotScores {
		spotProvider := spotplacement.NewProvider(client)
		score, err := spotProvider.GetSpotScoreForInstance(ctx, instanceType)
		if err == nil {
			spotScore = score
		}
	}

	return &models.RegionInstanceInfo{
		Region:           region,
		Available:        true,
		SpotPrice:        spotPrice,
		OnDemandPrice:    onDemandPrice,
		SavingsPercent:   savingsPercent,
		InterruptionRate: interruptionRate,
		SpotScore:        spotScore,
		ZoneCount:        len(zones),
		AvailableZones:   zones,
	}, specs, nil
}