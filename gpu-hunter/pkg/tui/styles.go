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

package tui

import "github.com/charmbracelet/lipgloss"

// Color palette
var (
	// Primary colors
	primaryColor   = lipgloss.Color("#7C3AED") // Purple
	secondaryColor = lipgloss.Color("#10B981") // Green
	accentColor    = lipgloss.Color("#F59E0B") // Amber
	dangerColor    = lipgloss.Color("#EF4444") // Red
	warningColor   = lipgloss.Color("#F97316") // Orange

	// Neutral colors
	textColor       = lipgloss.Color("#E5E7EB")
	subtleColor     = lipgloss.Color("#9CA3AF")
	borderColor     = lipgloss.Color("#4B5563")
	highlightColor  = lipgloss.Color("#374151")
	backgroundColor = lipgloss.Color("#1F2937")

	// Status colors
	gpuColor    = lipgloss.Color("#8B5CF6") // Purple for GPU
	neuronColor = lipgloss.Color("#06B6D4") // Cyan for Neuron
)

// Styles holds all the application styles
type Styles struct {
	// App container
	App lipgloss.Style

	// Header styles
	Header      lipgloss.Style
	HeaderTitle lipgloss.Style
	HeaderInfo  lipgloss.Style

	// Table styles
	Table           lipgloss.Style
	TableHeader     lipgloss.Style
	TableHeaderCell lipgloss.Style
	TableRow        lipgloss.Style
	TableRowAlt     lipgloss.Style
	TableCell       lipgloss.Style
	TableSelected   lipgloss.Style

	// Column-specific styles
	InstanceName lipgloss.Style
	TypeGPU      lipgloss.Style
	TypeNeuron   lipgloss.Style
	Price        lipgloss.Style
	Savings      lipgloss.Style
	Score        lipgloss.Style

	// Interruption rate styles
	InterruptLow    lipgloss.Style
	InterruptMedium lipgloss.Style
	InterruptHigh   lipgloss.Style

	// Score styles
	ScoreHigh   lipgloss.Style
	ScoreMedium lipgloss.Style
	ScoreLow    lipgloss.Style

	// Footer styles
	Footer     lipgloss.Style
	FooterKey  lipgloss.Style
	FooterDesc lipgloss.Style

	// Filter/prompt styles
	Filter       lipgloss.Style
	FilterPrompt lipgloss.Style
	FilterInput  lipgloss.Style

	// Status bar
	StatusBar     lipgloss.Style
	StatusRegion  lipgloss.Style
	StatusType    lipgloss.Style
	StatusFilter  lipgloss.Style
	StatusSort    lipgloss.Style
	StatusLoading lipgloss.Style

	// Help overlay
	Help        lipgloss.Style
	HelpTitle   lipgloss.Style
	HelpKey     lipgloss.Style
	HelpDesc    lipgloss.Style
	HelpSection lipgloss.Style

	// Detail view
	Detail       lipgloss.Style
	DetailTitle  lipgloss.Style
	DetailLabel  lipgloss.Style
	DetailValue  lipgloss.Style
	DetailBorder lipgloss.Style

	// Region selector
	RegionList     lipgloss.Style
	RegionItem     lipgloss.Style
	RegionSelected lipgloss.Style
}

// DefaultStyles returns the default application styles
func DefaultStyles() *Styles {
	s := &Styles{}

	// App container
	s.App = lipgloss.NewStyle().
		Background(backgroundColor)

	// Header styles
	s.Header = lipgloss.NewStyle().
		BorderStyle(lipgloss.NormalBorder()).
		BorderBottom(true).
		BorderForeground(borderColor).
		Padding(0, 1).
		MarginBottom(0)

	s.HeaderTitle = lipgloss.NewStyle().
		Bold(true).
		Foreground(primaryColor)

	s.HeaderInfo = lipgloss.NewStyle().
		Foreground(subtleColor)

	// Table styles
	s.Table = lipgloss.NewStyle().
		BorderStyle(lipgloss.NormalBorder()).
		BorderForeground(borderColor)

	s.TableHeader = lipgloss.NewStyle().
		Bold(true).
		Foreground(textColor).
		Background(highlightColor).
		Padding(0, 1)

	s.TableHeaderCell = lipgloss.NewStyle().
		Bold(true).
		Foreground(textColor).
		Padding(0, 1)

	s.TableRow = lipgloss.NewStyle().
		Foreground(textColor).
		Padding(0, 1)

	s.TableRowAlt = lipgloss.NewStyle().
		Foreground(textColor).
		Background(lipgloss.Color("#111827")).
		Padding(0, 1)

	s.TableCell = lipgloss.NewStyle().
		Foreground(textColor).
		Padding(0, 1)

	s.TableSelected = lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("#FFFFFF")).
		Background(primaryColor).
		Padding(0, 1)

	// Column-specific styles
	s.InstanceName = lipgloss.NewStyle().
		Bold(true).
		Foreground(textColor)

	s.TypeGPU = lipgloss.NewStyle().
		Foreground(gpuColor)

	s.TypeNeuron = lipgloss.NewStyle().
		Foreground(neuronColor)

	s.Price = lipgloss.NewStyle().
		Foreground(secondaryColor)

	s.Savings = lipgloss.NewStyle().
		Foreground(secondaryColor)

	// Interruption rate styles
	s.InterruptLow = lipgloss.NewStyle().
		Foreground(secondaryColor) // Green for low interruption

	s.InterruptMedium = lipgloss.NewStyle().
		Foreground(warningColor) // Orange for medium

	s.InterruptHigh = lipgloss.NewStyle().
		Foreground(dangerColor) // Red for high

	// Score styles
	s.ScoreHigh = lipgloss.NewStyle().
		Foreground(secondaryColor) // Green for high score

	s.ScoreMedium = lipgloss.NewStyle().
		Foreground(accentColor) // Amber for medium

	s.ScoreLow = lipgloss.NewStyle().
		Foreground(dangerColor) // Red for low

	// Footer styles
	s.Footer = lipgloss.NewStyle().
		BorderStyle(lipgloss.NormalBorder()).
		BorderTop(true).
		BorderForeground(borderColor).
		Padding(0, 1).
		Foreground(subtleColor)

	s.FooterKey = lipgloss.NewStyle().
		Bold(true).
		Foreground(accentColor)

	s.FooterDesc = lipgloss.NewStyle().
		Foreground(subtleColor)

	// Filter styles
	s.Filter = lipgloss.NewStyle().
		BorderStyle(lipgloss.NormalBorder()).
		BorderForeground(primaryColor).
		Padding(0, 1)

	s.FilterPrompt = lipgloss.NewStyle().
		Foreground(primaryColor).
		Bold(true)

	s.FilterInput = lipgloss.NewStyle().
		Foreground(textColor)

	// Status bar
	s.StatusBar = lipgloss.NewStyle().
		Foreground(subtleColor).
		Padding(0, 1)

	s.StatusRegion = lipgloss.NewStyle().
		Foreground(secondaryColor).
		Bold(true)

	s.StatusType = lipgloss.NewStyle().
		Foreground(primaryColor)

	s.StatusFilter = lipgloss.NewStyle().
		Foreground(accentColor)

	s.StatusSort = lipgloss.NewStyle().
		Foreground(subtleColor)

	s.StatusLoading = lipgloss.NewStyle().
		Foreground(accentColor).
		Bold(true)

	// Help overlay
	s.Help = lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(primaryColor).
		Padding(1, 2).
		Background(backgroundColor)

	s.HelpTitle = lipgloss.NewStyle().
		Bold(true).
		Foreground(primaryColor).
		MarginBottom(1)

	s.HelpKey = lipgloss.NewStyle().
		Bold(true).
		Foreground(accentColor).
		Width(12)

	s.HelpDesc = lipgloss.NewStyle().
		Foreground(textColor)

	s.HelpSection = lipgloss.NewStyle().
		Bold(true).
		Foreground(secondaryColor).
		MarginTop(1).
		MarginBottom(0)

	// Detail view
	s.Detail = lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(primaryColor).
		Padding(1, 2)

	s.DetailTitle = lipgloss.NewStyle().
		Bold(true).
		Foreground(primaryColor).
		MarginBottom(1)

	s.DetailLabel = lipgloss.NewStyle().
		Foreground(subtleColor).
		Width(20)

	s.DetailValue = lipgloss.NewStyle().
		Foreground(textColor)

	s.DetailBorder = lipgloss.NewStyle().
		Foreground(borderColor)

	// Region selector
	s.RegionList = lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(primaryColor).
		Padding(1, 2)

	s.RegionItem = lipgloss.NewStyle().
		Foreground(textColor).
		Padding(0, 1)

	s.RegionSelected = lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("#FFFFFF")).
		Background(primaryColor).
		Padding(0, 1)

	return s
}

// Helper functions for conditional styling

// InterruptStyle returns the appropriate style for an interruption rate
func (s *Styles) InterruptStyle(rate string) lipgloss.Style {
	switch rate {
	case "<5%", "5-10%":
		return s.InterruptLow
	case "10-15%", "15-20%":
		return s.InterruptMedium
	default:
		return s.InterruptHigh
	}
}

// ScoreStyle returns the appropriate style for a spot placement score
func (s *Styles) ScoreStyle(score int) lipgloss.Style {
	switch {
	case score >= 8:
		return s.ScoreHigh
	case score >= 5:
		return s.ScoreMedium
	default:
		return s.ScoreLow
	}
}

// TypeStyle returns the appropriate style for instance type (GPU/Neuron)
func (s *Styles) TypeStyle(instanceType string) lipgloss.Style {
	if instanceType == "Neuron" {
		return s.TypeNeuron
	}
	return s.TypeGPU
}