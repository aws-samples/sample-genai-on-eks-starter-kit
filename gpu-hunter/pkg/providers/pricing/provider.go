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

package pricing

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"
	"github.com/aws/aws-sdk-go-v2/service/pricing"
	pricingtypes "github.com/aws/aws-sdk-go-v2/service/pricing/types"

	awsclient "github.com/gpu-hunter/pkg/aws"
	"github.com/gpu-hunter/pkg/models"
)

// Provider retrieves pricing information for instance types
type Provider struct {
	client *awsclient.Client
}

// NewProvider creates a new pricing provider
func NewProvider(client *awsclient.Client) *Provider {
	return &Provider{
		client: client,
	}
}

// SpotPriceInfo contains spot price information for a zone
type SpotPriceInfo struct {
	Zone  string
	Price float64
}

// GetSpotPrices retrieves current spot prices for the given instance types
func (p *Provider) GetSpotPrices(ctx context.Context, instanceTypes []string) (map[string][]SpotPriceInfo, error) {
	prices := make(map[string][]SpotPriceInfo)

	// Convert to EC2 instance types
	var ec2InstanceTypes []ec2types.InstanceType
	for _, it := range instanceTypes {
		ec2InstanceTypes = append(ec2InstanceTypes, ec2types.InstanceType(it))
	}

	paginator := ec2.NewDescribeSpotPriceHistoryPaginator(p.client.EC2, &ec2.DescribeSpotPriceHistoryInput{
		InstanceTypes: ec2InstanceTypes,
		ProductDescriptions: []string{
			"Linux/UNIX",
			"Linux/UNIX (Amazon VPC)",
		},
		StartTime: aws.Time(time.Now()),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, err
		}

		for _, sph := range page.SpotPriceHistory {
			instanceType := string(sph.InstanceType)
			zone := aws.ToString(sph.AvailabilityZone)
			priceStr := aws.ToString(sph.SpotPrice)

			price, err := strconv.ParseFloat(priceStr, 64)
			if err != nil {
				continue
			}

			prices[instanceType] = append(prices[instanceType], SpotPriceInfo{
				Zone:  zone,
				Price: price,
			})
		}
	}

	return prices, nil
}

// GetOnDemandPrices retrieves on-demand prices for the given instance types
func (p *Provider) GetOnDemandPrices(ctx context.Context, instanceTypes []string) (map[string]float64, error) {
	prices := make(map[string]float64)

	// Determine currency based on region
	currency := "USD"
	if strings.HasPrefix(p.client.Region, "cn-") {
		currency = "CNY"
	}

	for _, instanceType := range instanceTypes {
		price, err := p.getOnDemandPrice(ctx, instanceType, currency)
		if err != nil {
			// Log error but continue with other instance types
			continue
		}
		if price > 0 {
			prices[instanceType] = price
		}
	}

	return prices, nil
}

// getOnDemandPrice retrieves the on-demand price for a single instance type
func (p *Provider) getOnDemandPrice(ctx context.Context, instanceType, currency string) (float64, error) {
	input := &pricing.GetProductsInput{
		ServiceCode: aws.String("AmazonEC2"),
		Filters: []pricingtypes.Filter{
			{
				Field: aws.String("regionCode"),
				Type:  pricingtypes.FilterTypeTermMatch,
				Value: aws.String(p.client.Region),
			},
			{
				Field: aws.String("instanceType"),
				Type:  pricingtypes.FilterTypeTermMatch,
				Value: aws.String(instanceType),
			},
			{
				Field: aws.String("operatingSystem"),
				Type:  pricingtypes.FilterTypeTermMatch,
				Value: aws.String("Linux"),
			},
			{
				Field: aws.String("preInstalledSw"),
				Type:  pricingtypes.FilterTypeTermMatch,
				Value: aws.String("NA"),
			},
			{
				Field: aws.String("tenancy"),
				Type:  pricingtypes.FilterTypeTermMatch,
				Value: aws.String("Shared"),
			},
			{
				Field: aws.String("capacitystatus"),
				Type:  pricingtypes.FilterTypeTermMatch,
				Value: aws.String("Used"),
			},
		},
		MaxResults: aws.Int32(10),
	}

	output, err := p.client.Pricing.GetProducts(ctx, input)
	if err != nil {
		return 0, err
	}

	return p.parseOnDemandPrice(output.PriceList, currency), nil
}

// priceItem represents the structure of AWS pricing data
type priceItem struct {
	Product struct {
		Attributes struct {
			InstanceType string `json:"instanceType"`
		} `json:"attributes"`
	} `json:"product"`
	Terms struct {
		OnDemand map[string]struct {
			PriceDimensions map[string]struct {
				PricePerUnit map[string]string `json:"pricePerUnit"`
			} `json:"priceDimensions"`
		} `json:"OnDemand"`
	} `json:"terms"`
}

// parseOnDemandPrice extracts the price from AWS pricing API response
func (p *Provider) parseOnDemandPrice(priceList []string, currency string) float64 {
	for _, priceJSON := range priceList {
		var item priceItem
		if err := json.Unmarshal([]byte(priceJSON), &item); err != nil {
			continue
		}

		for _, term := range item.Terms.OnDemand {
			for _, dimension := range term.PriceDimensions {
				if priceStr, ok := dimension.PricePerUnit[currency]; ok {
					price, err := strconv.ParseFloat(priceStr, 64)
					if err == nil && price > 0 {
						return price
					}
				}
			}
		}
	}
	return 0
}

// GetPricesForInstance retrieves spot and on-demand prices for a single instance type
func (p *Provider) GetPricesForInstance(ctx context.Context, instanceType string) (spotPrice float64, onDemandPrice float64, err error) {
	// Get spot price
	spotPrices, err := p.GetSpotPrices(ctx, []string{instanceType})
	if err != nil {
		// Continue without spot price
		spotPrice = 0
	} else if spotInfos, ok := spotPrices[instanceType]; ok && len(spotInfos) > 0 {
		// Find best (lowest) spot price
		bestPrice := spotInfos[0].Price
		for _, info := range spotInfos {
			if info.Price < bestPrice {
				bestPrice = info.Price
			}
		}
		spotPrice = bestPrice
	}

	// Get on-demand price
	odPrices, err := p.GetOnDemandPrices(ctx, []string{instanceType})
	if err != nil {
		// Continue without on-demand price
		onDemandPrice = 0
	} else if price, ok := odPrices[instanceType]; ok {
		onDemandPrice = price
	}

	return spotPrice, onDemandPrice, nil
}

// EnrichWithPricing adds pricing information to instance type info
func (p *Provider) EnrichWithPricing(ctx context.Context, instances []models.InstanceTypeInfo) error {
	// Collect instance types
	var instanceTypes []string
	for _, it := range instances {
		instanceTypes = append(instanceTypes, it.InstanceType)
	}

	// Get spot prices
	spotPrices, err := p.GetSpotPrices(ctx, instanceTypes)
	if err != nil {
		return err
	}

	// Get on-demand prices
	onDemandPrices, err := p.GetOnDemandPrices(ctx, instanceTypes)
	if err != nil {
		return err
	}

	// Enrich instances with pricing
	for i := range instances {
		it := &instances[i]

		// Add on-demand price
		if price, ok := onDemandPrices[it.InstanceType]; ok {
			it.OnDemandPrice = price
		}

		// Add spot prices
		if spotInfos, ok := spotPrices[it.InstanceType]; ok {
			var zoneOfferings []models.ZoneOffering
			var bestSpotPrice float64 = -1

			for _, spotInfo := range spotInfos {
				zoneOfferings = append(zoneOfferings, models.ZoneOffering{
					Zone:      spotInfo.Zone,
					Available: true,
					SpotPrice: spotInfo.Price,
				})

				if bestSpotPrice < 0 || spotInfo.Price < bestSpotPrice {
					bestSpotPrice = spotInfo.Price
				}
			}

			it.ZoneOfferings = zoneOfferings
			if bestSpotPrice > 0 {
				it.SpotPrice = bestSpotPrice
			}
		}
	}

	return nil
}