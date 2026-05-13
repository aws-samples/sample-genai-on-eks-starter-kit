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

package aws

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	"github.com/aws/aws-sdk-go-v2/service/pricing"
)

// Client wraps AWS SDK clients for EC2 and Pricing services
type Client struct {
	EC2     *ec2.Client
	Pricing *pricing.Client
	Region  string
}

// NewClient creates a new AWS client for the specified region
func NewClient(ctx context.Context, region string) (*Client, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, err
	}

	return &Client{
		EC2:     ec2.NewFromConfig(cfg),
		Pricing: newPricingClient(cfg),
		Region:  region,
	}, nil
}

// newPricingClient creates a pricing client configured for the appropriate region
// The pricing API is only available in specific regions
func newPricingClient(cfg aws.Config) *pricing.Client {
	// Pricing API doesn't have an endpoint in all regions
	pricingRegion := "us-east-1"
	if len(cfg.Region) > 0 {
		switch {
		case cfg.Region[:3] == "ap-":
			pricingRegion = "ap-south-1"
		case cfg.Region[:3] == "cn-":
			pricingRegion = "cn-northwest-1"
		case cfg.Region[:3] == "eu-":
			pricingRegion = "eu-central-1"
		}
	}

	pricingCfg := cfg.Copy()
	pricingCfg.Region = pricingRegion
	return pricing.NewFromConfig(pricingCfg)
}

// NewClientForRegion creates a new EC2 client for a different region using the same base config
func (c *Client) NewClientForRegion(ctx context.Context, region string) (*Client, error) {
	return NewClient(ctx, region)
}

// GetAllRegions returns a list of all enabled AWS regions
func GetAllRegions(ctx context.Context) ([]string, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion("us-east-1"))
	if err != nil {
		return nil, err
	}

	ec2Client := ec2.NewFromConfig(cfg)
	output, err := ec2Client.DescribeRegions(ctx, &ec2.DescribeRegionsInput{
		AllRegions: aws.Bool(false), // Only enabled regions
	})
	if err != nil {
		return nil, err
	}

	regions := make([]string, 0, len(output.Regions))
	for _, r := range output.Regions {
		if r.RegionName != nil {
			regions = append(regions, *r.RegionName)
		}
	}
	return regions, nil
}

// DefaultGPURegions returns a list of regions commonly used for GPU workloads
func DefaultGPURegions() []string {
	return []string{
		"us-east-1",
		"us-east-2",
		"us-west-1",
		"us-west-2",
		"eu-west-1",
		"eu-central-1",
		"ap-northeast-1",
		"ap-southeast-1",
		"ap-south-1",
	}
}