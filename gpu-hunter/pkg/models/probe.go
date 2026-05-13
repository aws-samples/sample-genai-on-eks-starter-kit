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

// ProbeCapacityType represents the capacity type to probe
type ProbeCapacityType string

const (
	ProbeCapacityTypeSpot     ProbeCapacityType = "spot"
	ProbeCapacityTypeOnDemand ProbeCapacityType = "on-demand"
)

// ProbeRequest contains parameters for a capacity probe
type ProbeRequest struct {
	InstanceType string            // e.g., "g5.xlarge"
	Region       string            // e.g., "us-east-1"
	Zone         string            // Specific zone or empty for any
	CapacityType ProbeCapacityType // spot or on-demand
}

// ProbeResult contains the result of a single probe attempt
type ProbeResult struct {
	InstanceType  string            `json:"instanceType"`
	Region        string            `json:"region"`
	Zone          string            `json:"zone,omitempty"`           // Zone where it succeeded (or last tried)
	CapacityType  ProbeCapacityType `json:"capacityType"`
	Success       bool              `json:"success"`
	InstanceID    string            `json:"instanceId,omitempty"`     // If launched (for logging)
	ErrorCode     string            `json:"errorCode,omitempty"`
	ErrorMessage  string            `json:"errorMessage,omitempty"`
	Reason        string            `json:"reason,omitempty"`         // Human-readable
	Duration      string            `json:"duration,omitempty"`       // How long the probe took
	FailedZones   []string          `json:"failedZones,omitempty"`    // Zones that were tried and failed
	UntestedZones []string          `json:"untestedZones,omitempty"`  // Zones not tested (stopped after success)
}

// ProbeResults aggregates multiple probe results
type ProbeResults struct {
	Timestamp    string            `json:"timestamp"`
	InstanceType string            `json:"instanceType"`
	Regions      []string          `json:"regions"`
	CapacityType string            `json:"capacityType"` // "spot", "on-demand", or "both"
	Results      []ProbeResult     `json:"results"`
	TotalProbes  int               `json:"totalProbes"`
	SuccessCount int               `json:"successCount"`
	FailureCount int               `json:"failureCount"`
}
