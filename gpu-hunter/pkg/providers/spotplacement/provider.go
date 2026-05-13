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

package spotplacement

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	"github.com/aws/aws-sdk-go-v2/service/ec2/types"

	awsclient "github.com/gpu-hunter/pkg/aws"
	"github.com/gpu-hunter/pkg/models"
)

// Provider retrieves spot placement scores for instance types
type Provider struct {
	client *awsclient.Client
}

// NewProvider creates a new spot placement score provider
func NewProvider(client *awsclient.Client) *Provider {
	return &Provider{
		client: client,
	}
}

// SpotPlacementScore contains the score for an instance type in a region
type SpotPlacementScore struct {
	InstanceType string
	Region       string
	Zone         string // Empty for region-level scores
	Score        int    // 1-10, higher is better
}

// GetSpotPlacementScores retrieves spot placement scores for the given instance types
// The score indicates the likelihood of getting spot capacity (1-10, higher is better)
func (p *Provider) GetSpotPlacementScores(ctx context.Context, instanceTypes []string, targetCapacity int32) ([]SpotPlacementScore, error) {
	var scores []SpotPlacementScore

	// Build the request - InstanceTypes expects []string directly
	input := &ec2.GetSpotPlacementScoresInput{
		InstanceTypes:          instanceTypes,
		TargetCapacity:         aws.Int32(targetCapacity),
		TargetCapacityUnitType: types.TargetCapacityUnitTypeUnits,
		RegionNames:            []string{p.client.Region},
	}

	// Get region-level scores
	output, err := p.client.EC2.GetSpotPlacementScores(ctx, input)
	if err != nil {
		return nil, err
	}

	for _, score := range output.SpotPlacementScores {
		scores = append(scores, SpotPlacementScore{
			Region: aws.ToString(score.Region),
			Score:  int(aws.ToInt32(score.Score)),
		})
	}

	return scores, nil
}

// GetSpotPlacementScoresByZone retrieves spot placement scores at the availability zone level
func (p *Provider) GetSpotPlacementScoresByZone(ctx context.Context, instanceTypes []string, targetCapacity int32) ([]SpotPlacementScore, error) {
	var scores []SpotPlacementScore

	// Build the request with single AZ flag - InstanceTypes expects []string directly
	input := &ec2.GetSpotPlacementScoresInput{
		InstanceTypes:            instanceTypes,
		TargetCapacity:           aws.Int32(targetCapacity),
		TargetCapacityUnitType:   types.TargetCapacityUnitTypeUnits,
		RegionNames:              []string{p.client.Region},
		SingleAvailabilityZone:   aws.Bool(true),
	}

	output, err := p.client.EC2.GetSpotPlacementScores(ctx, input)
	if err != nil {
		return nil, err
	}

	for _, score := range output.SpotPlacementScores {
		scores = append(scores, SpotPlacementScore{
			Region: aws.ToString(score.Region),
			Zone:   aws.ToString(score.AvailabilityZoneId),
			Score:  int(aws.ToInt32(score.Score)),
		})
	}

	return scores, nil
}

// GetSpotScoreForInstance retrieves the spot placement score for a single instance type
func (p *Provider) GetSpotScoreForInstance(ctx context.Context, instanceType string) (int, error) {
	scores, err := p.GetSpotPlacementScores(ctx, []string{instanceType}, 1)
	if err != nil {
		return 0, err
	}
	if len(scores) > 0 {
		return scores[0].Score, nil
	}
	return 0, nil
}

// EnrichWithSpotScores adds spot placement scores to instance type info
func (p *Provider) EnrichWithSpotScores(ctx context.Context, instances []models.InstanceTypeInfo) error {
	// Process each instance type individually to get accurate scores
	for i := range instances {
		it := &instances[i]
		
		if !it.SupportsSpot {
			continue
		}

		// Get score for this specific instance type
		scores, err := p.GetSpotPlacementScores(ctx, []string{it.InstanceType}, 1)
		if err != nil {
			// Log error but continue with other instance types
			continue
		}

		if len(scores) > 0 {
			it.SpotScore = scores[0].Score
		}
	}

	return nil
}

// InterpretScore provides a human-readable interpretation of the spot placement score
func InterpretScore(score int) (emoji string, likelihood string, description string) {
	switch {
	case score >= 8:
		return "✅", "High", "Excellent chance of getting the requested capacity"
	case score >= 5:
		return "⚠️", "Medium", "Reasonable chance but may face some constraints"
	default:
		return "❌", "Low", "Difficult to get the full capacity, consider alternatives"
	}
}