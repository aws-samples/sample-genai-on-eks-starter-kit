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

package probe

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"
	"github.com/aws/smithy-go"

	awsclient "github.com/gpu-hunter/pkg/aws"
	"github.com/gpu-hunter/pkg/models"
)

// Error codes and their human-readable explanations
var capacityErrorCodes = map[string]string{
	"InsufficientInstanceCapacity":      "No capacity available for this instance type in the specified zone",
	"MaxSpotInstanceCountExceeded":      "Spot instance quota exceeded - request a quota increase",
	"VcpuLimitExceeded":                 "vCPU quota exceeded - request a quota increase",
	"UnfulfillableCapacity":             "Unable to fulfill capacity request at this time",
	"InsufficientFreeAddressesInSubnet": "Subnet has insufficient free IP addresses",
	"ReservationCapacityExceeded":       "Capacity reservation exhausted",
	"Unsupported":                       "Instance type not supported in this zone/region",
	"InstanceLimitExceeded":             "Instance limit exceeded - request a quota increase",
}

var authErrorCodes = map[string]string{
	"UnauthorizedOperation":                               "IAM permission denied - check ec2:RunInstances permission",
	"AuthFailure.ServiceLinkedRoleCreationNotPermitted":   "Cannot create Spot service-linked role - check IAM permissions",
	"AccessDenied":                                        "Access denied - check IAM permissions",
	"AuthFailure":                                         "Authentication failure - check AWS credentials",
}

// Provider handles capacity probing
type Provider struct {
	client *awsclient.Client
}

// NewProvider creates a new probe provider
func NewProvider(client *awsclient.Client) *Provider {
	return &Provider{client: client}
}

// ClassifyError returns a human-readable reason for the error
func ClassifyError(err error) (code string, reason string) {
	if err == nil {
		return "", ""
	}

	// Try to extract AWS API error
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		code = apiErr.ErrorCode()

		if reason, ok := capacityErrorCodes[code]; ok {
			return code, reason
		}
		if reason, ok := authErrorCodes[code]; ok {
			return code, reason
		}

		return code, apiErr.ErrorMessage()
	}

	// Fallback for wrapped errors - check error message
	errStr := err.Error()
	for errorCode, reason := range capacityErrorCodes {
		if strings.Contains(errStr, errorCode) {
			return errorCode, reason
		}
	}
	for errorCode, reason := range authErrorCodes {
		if strings.Contains(errStr, errorCode) {
			return errorCode, reason
		}
	}

	return "Unknown", err.Error()
}

// GetLatestAMI finds the latest Amazon Linux 2023 AMI for the region
func (p *Provider) GetLatestAMI(ctx context.Context, arch string) (string, error) {
	// Determine architecture pattern
	archPattern := "x86_64"
	if arch == "arm64" {
		archPattern = "arm64"
	}

	// Use Amazon Linux 2023 as it's available in all regions
	input := &ec2.DescribeImagesInput{
		Owners: []string{"amazon"},
		Filters: []ec2types.Filter{
			{
				Name:   aws.String("name"),
				Values: []string{fmt.Sprintf("al2023-ami-*-%s", archPattern)},
			},
			{
				Name:   aws.String("state"),
				Values: []string{"available"},
			},
			{
				Name:   aws.String("architecture"),
				Values: []string{archPattern},
			},
			{
				Name:   aws.String("virtualization-type"),
				Values: []string{"hvm"},
			},
		},
	}

	output, err := p.client.EC2.DescribeImages(ctx, input)
	if err != nil {
		return "", fmt.Errorf("failed to describe images: %w", err)
	}

	if len(output.Images) == 0 {
		return "", fmt.Errorf("no Amazon Linux 2023 AMI found in region %s for architecture %s", p.client.Region, archPattern)
	}

	// Sort by creation date and return the latest
	type imageWithDate struct {
		ImageID string
		Date    time.Time
	}
	var images []imageWithDate

	for _, img := range output.Images {
		if img.ImageId != nil && img.CreationDate != nil {
			creationDate, err := time.Parse(time.RFC3339, *img.CreationDate)
			if err == nil {
				images = append(images, imageWithDate{
					ImageID: *img.ImageId,
					Date:    creationDate,
				})
			}
		}
	}

	if len(images) == 0 {
		return "", fmt.Errorf("could not determine latest AMI")
	}

	// Sort by date descending
	sort.Slice(images, func(i, j int) bool {
		return images[i].Date.After(images[j].Date)
	})

	return images[0].ImageID, nil
}

// GetDefaultSubnet finds a subnet in the default VPC for the specified zone
func (p *Provider) GetDefaultSubnet(ctx context.Context, zone string) (string, error) {
	input := &ec2.DescribeSubnetsInput{
		Filters: []ec2types.Filter{
			{
				Name:   aws.String("default-for-az"),
				Values: []string{"true"},
			},
			{
				Name:   aws.String("availability-zone"),
				Values: []string{zone},
			},
		},
	}

	output, err := p.client.EC2.DescribeSubnets(ctx, input)
	if err != nil {
		return "", fmt.Errorf("failed to describe subnets: %w", err)
	}

	if len(output.Subnets) == 0 {
		return "", fmt.Errorf("no default subnet found in zone %s", zone)
	}

	return aws.ToString(output.Subnets[0].SubnetId), nil
}

// GetAllZones returns all availability zones in the region, sorted alphabetically
func (p *Provider) GetAllZones(ctx context.Context) ([]string, error) {
	input := &ec2.DescribeAvailabilityZonesInput{
		Filters: []ec2types.Filter{
			{
				Name:   aws.String("zone-type"),
				Values: []string{"availability-zone"},
			},
			{
				Name:   aws.String("state"),
				Values: []string{"available"},
			},
		},
	}

	output, err := p.client.EC2.DescribeAvailabilityZones(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("failed to describe availability zones: %w", err)
	}

	var zones []string
	for _, az := range output.AvailabilityZones {
		if az.ZoneName != nil {
			zones = append(zones, *az.ZoneName)
		}
	}

	sort.Strings(zones)
	return zones, nil
}

// ProbeCapacity attempts to launch an instance and immediately terminates it.
// If no zone is specified, it tries zones sequentially until one succeeds.
func (p *Provider) ProbeCapacity(ctx context.Context, req models.ProbeRequest) (*models.ProbeResult, error) {
	startTime := time.Now()
	result := &models.ProbeResult{
		InstanceType: req.InstanceType,
		Region:       req.Region,
		Zone:         req.Zone,
		CapacityType: req.CapacityType,
		Success:      false,
	}

	// Determine architecture based on instance type
	arch := "x86_64"
	if strings.HasPrefix(req.InstanceType, "g8g") || // Graviton GPU instances (future)
		strings.Contains(req.InstanceType, "g.") && strings.HasSuffix(req.InstanceType, "g") {
		arch = "arm64"
	}

	// Get AMI
	amiID, err := p.GetLatestAMI(ctx, arch)
	if err != nil {
		result.ErrorCode = "AMILookupFailed"
		result.ErrorMessage = err.Error()
		result.Reason = "Failed to find a valid AMI for launching"
		result.Duration = time.Since(startTime).Round(time.Millisecond).String()
		return result, nil
	}

	// Determine zones to try
	var zonesToTry []string
	if req.Zone != "" {
		// User specified a specific zone
		zonesToTry = []string{req.Zone}
	} else {
		// Get all zones in the region and try them sequentially
		allZones, err := p.GetAllZones(ctx)
		if err != nil {
			result.ErrorCode = "ZoneLookupFailed"
			result.ErrorMessage = err.Error()
			result.Reason = "Failed to get availability zones"
			result.Duration = time.Since(startTime).Round(time.Millisecond).String()
			return result, nil
		}
		zonesToTry = allZones
	}

	// Try each zone sequentially until one succeeds
	var failedZones []string
	var lastErrorCode, lastErrorMessage string
	_ = lastErrorMessage // May be used for detailed logging later

	for _, zone := range zonesToTry {
		// Get subnet for this zone
		subnetID, err := p.GetDefaultSubnet(ctx, zone)
		if err != nil {
			// No subnet in this zone, skip it
			failedZones = append(failedZones, zone)
			lastErrorCode = "SubnetLookupFailed"
			lastErrorMessage = err.Error()
			continue
		}

		// Try to launch in this zone
		success, instanceID, errorCode, errorMessage, reason := p.tryLaunchInZone(ctx, req, amiID, subnetID, zone)

		if success {
			// Success! Record the result
			result.Success = true
			result.Zone = zone
			result.InstanceID = instanceID
			result.Duration = time.Since(startTime).Round(time.Millisecond).String()
			result.FailedZones = failedZones

			// Calculate untested zones
			for i, z := range zonesToTry {
				if z == zone {
					result.UntestedZones = zonesToTry[i+1:]
					break
				}
			}

			// Build detailed reason message
			result.Reason = p.buildSuccessReason(zone, failedZones, result.UntestedZones)
			return result, nil
		}

		// Failed in this zone, try next
		failedZones = append(failedZones, zone)
		lastErrorCode = errorCode
		lastErrorMessage = errorMessage
		_ = reason // Individual zone failure reason
	}

	// All zones failed
	result.Duration = time.Since(startTime).Round(time.Millisecond).String()
	result.FailedZones = failedZones
	result.ErrorCode = lastErrorCode
	result.ErrorMessage = lastErrorMessage
	result.Reason = fmt.Sprintf("No capacity in any zone (tried: %s)", strings.Join(failedZones, ", "))

	return result, nil
}

// tryLaunchInZone attempts to launch an instance in a specific zone
func (p *Provider) tryLaunchInZone(ctx context.Context, req models.ProbeRequest, amiID, subnetID, zone string) (success bool, instanceID, errorCode, errorMessage, reason string) {
	runInput := &ec2.RunInstancesInput{
		ImageId:      aws.String(amiID),
		InstanceType: ec2types.InstanceType(req.InstanceType),
		MinCount:     aws.Int32(1),
		MaxCount:     aws.Int32(1),
		SubnetId:     aws.String(subnetID),
		TagSpecifications: []ec2types.TagSpecification{
			{
				ResourceType: ec2types.ResourceTypeInstance,
				Tags: []ec2types.Tag{
					{
						Key:   aws.String("Name"),
						Value: aws.String("gpu-hunter-probe"),
					},
					{
						Key:   aws.String("gpu-hunter-probe"),
						Value: aws.String("true"),
					},
					{
						Key:   aws.String("gpu-hunter-capacity-type"),
						Value: aws.String(string(req.CapacityType)),
					},
				},
			},
		},
	}

	// Add spot options if probing spot capacity
	if req.CapacityType == models.ProbeCapacityTypeSpot {
		runInput.InstanceMarketOptions = &ec2types.InstanceMarketOptionsRequest{
			MarketType: ec2types.MarketTypeSpot,
			SpotOptions: &ec2types.SpotMarketOptions{
				SpotInstanceType: ec2types.SpotInstanceTypeOneTime,
			},
		}
	}

	// Attempt to launch
	runOutput, err := p.client.EC2.RunInstances(ctx, runInput)
	if err != nil {
		code, rsn := ClassifyError(err)
		return false, "", code, err.Error(), rsn
	}

	// Launch succeeded
	if len(runOutput.Instances) > 0 && runOutput.Instances[0].InstanceId != nil {
		instID := *runOutput.Instances[0].InstanceId

		// Immediately terminate the instance
		_, terminateErr := p.client.EC2.TerminateInstances(ctx, &ec2.TerminateInstancesInput{
			InstanceIds: []string{instID},
		})
		if terminateErr != nil {
			return true, instID, "", "", fmt.Sprintf("Capacity available (WARNING: failed to terminate %s)", instID)
		}
		return true, instID, "", "", "Capacity available"
	}

	return false, "", "Unknown", "No instance returned", "Launch returned no instance"
}

// buildSuccessReason creates a detailed message about the probe result
func (p *Provider) buildSuccessReason(successZone string, failedZones, untestedZones []string) string {
	var parts []string

	parts = append(parts, fmt.Sprintf("PASS in %s", successZone))

	if len(failedZones) > 0 {
		parts = append(parts, fmt.Sprintf("failed: %s", strings.Join(failedZones, ", ")))
	}

	if len(untestedZones) > 0 {
		parts = append(parts, fmt.Sprintf("untested: %s", strings.Join(untestedZones, ", ")))
	}

	if len(parts) == 1 {
		return parts[0]
	}

	return fmt.Sprintf("%s (%s)", parts[0], strings.Join(parts[1:], "; "))
}

// IsCapacityError returns true if the error code indicates a capacity issue
func IsCapacityError(code string) bool {
	_, ok := capacityErrorCodes[code]
	return ok
}

// IsAuthError returns true if the error code indicates an authorization issue
func IsAuthError(code string) bool {
	_, ok := authErrorCodes[code]
	return ok
}
