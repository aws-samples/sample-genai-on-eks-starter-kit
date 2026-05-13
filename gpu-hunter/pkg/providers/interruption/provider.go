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

package interruption

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	// SpotAdvisorURL is the public AWS Spot Advisor data endpoint
	SpotAdvisorURL = "https://spot-bid-advisor.s3.amazonaws.com/spot-advisor-data.json"
	httpTimeout    = 10 * time.Second
)

// InterruptionRange represents the interruption frequency range
type InterruptionRange struct {
	Label string // "<5%", "5-10%", "10-15%", "15-20%", ">20%"
	Min   int    // Minimum percentage
	Max   int    // Maximum percentage
}

// InterruptionData contains interruption info for an instance type
type InterruptionData struct {
	InstanceType string
	Region       string
	Range        InterruptionRange
	Savings      int // Savings percentage vs on-demand
}

// Provider fetches interruption rate data from AWS Spot Advisor
type Provider struct {
	data *advisorData
}

// Internal types for parsing AWS Spot Advisor JSON
type advisorData struct {
	Ranges        []interruptionRange     `json:"ranges"`
	Regions       map[string]osTypes      `json:"spot_advisor"`
	InstanceTypes map[string]instanceType `json:"instance_types"`
}

type interruptionRange struct {
	Label string `json:"label"`
	Index int    `json:"index"`
	Max   int    `json:"max"`
}

type osTypes struct {
	Linux map[string]spotAdvice `json:"Linux"`
}

type spotAdvice struct {
	Range   int `json:"r"` // Index into ranges array
	Savings int `json:"s"` // Savings percentage
}

type instanceType struct {
	Cores int     `json:"cores"`
	EMR   bool    `json:"emr"`
	RAM   float32 `json:"ram_gb"`
}

// NewProvider creates a new interruption rate provider
func NewProvider() *Provider {
	return &Provider{}
}

// FetchData retrieves interruption data from AWS Spot Advisor
func (p *Provider) FetchData(ctx context.Context) error {
	client := &http.Client{Timeout: httpTimeout}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, SpotAdvisorURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to fetch spot advisor data: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("spot advisor API returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response body: %w", err)
	}

	var data advisorData
	if err := json.Unmarshal(body, &data); err != nil {
		return fmt.Errorf("failed to parse spot advisor data: %w", err)
	}

	p.data = &data
	return nil
}

// GetInterruptionRate returns the interruption rate for an instance type in a region
func (p *Provider) GetInterruptionRate(instanceType, region string) *InterruptionData {
	if p.data == nil {
		return nil
	}

	regionData, ok := p.data.Regions[region]
	if !ok {
		return nil
	}

	advice, ok := regionData.Linux[instanceType]
	if !ok {
		return nil
	}

	// Get the range info
	if advice.Range < 0 || advice.Range >= len(p.data.Ranges) {
		return nil
	}

	rangeInfo := p.data.Ranges[advice.Range]

	// Calculate min based on max (AWS provides max, we derive min)
	min := 0
	switch rangeInfo.Max {
	case 5:
		min = 0
	case 11:
		min = 6
	case 16:
		min = 12
	case 22:
		min = 17
	case 100:
		min = 23
	}

	return &InterruptionData{
		InstanceType: instanceType,
		Region:       region,
		Range: InterruptionRange{
			Label: rangeInfo.Label,
			Min:   min,
			Max:   rangeInfo.Max,
		},
		Savings: advice.Savings,
	}
}

// GetAllRegions returns all regions available in the spot advisor data
func (p *Provider) GetAllRegions() []string {
	if p.data == nil {
		return nil
	}

	regions := make([]string, 0, len(p.data.Regions))
	for region := range p.data.Regions {
		regions = append(regions, region)
	}
	return regions
}

// IsDataLoaded returns true if data has been fetched
func (p *Provider) IsDataLoaded() bool {
	return p.data != nil
}