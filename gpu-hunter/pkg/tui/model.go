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

import (
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/gpu-hunter/pkg/models"
)

// ViewMode represents the current view state
type ViewMode int

const (
	ViewMainMenu ViewMode = iota // Initial menu: Browse, Lookup, Probe
	ViewTable
	ViewDetail
	ViewRegionSelect
	ViewHelp
	ViewFilter
	ViewLookup          // Multi-region lookup view (single instance type)
	ViewLookupInput     // Input prompt for lookup
	ViewInstanceSelect  // Instance type selection (for prefix expansion)
	ViewLookupAggregate // Aggregated view for ALL sizes
	ViewProbe           // Probe capacity results view
	ViewProbeInput      // Input prompt for probe
)

// AcceleratorType represents the type filter
type AcceleratorType int

const (
	TypeAll AcceleratorType = iota
	TypeGPU
	TypeNeuron
)

func (t AcceleratorType) String() string {
	switch t {
	case TypeGPU:
		return "GPU"
	case TypeNeuron:
		return "Neuron"
	default:
		return "All"
	}
}

// SortColumn represents which column to sort by
type SortColumn int

const (
	SortByName SortColumn = iota
	SortByPrice
	SortByScore
	SortByInterrupt
	SortBySavings
)

func (s SortColumn) String() string {
	switch s {
	case SortByPrice:
		return "Price"
	case SortByScore:
		return "Score"
	case SortByInterrupt:
		return "Interrupt"
	case SortBySavings:
		return "Savings"
	default:
		return "Name"
	}
}

// FilterColumn represents which column to filter by
type FilterColumn int

const (
	FilterAll FilterColumn = iota
	FilterInstanceType
	FilterAccelerator
	FilterManufacturer
	FilterType // GPU/Neuron
)

func (f FilterColumn) String() string {
	switch f {
	case FilterInstanceType:
		return "Instance"
	case FilterAccelerator:
		return "Accelerator"
	case FilterManufacturer:
		return "Manufacturer"
	case FilterType:
		return "Type"
	default:
		return "All"
	}
}

// AllFilterColumns returns all available filter columns for cycling
func AllFilterColumns() []FilterColumn {
	return []FilterColumn{FilterAll, FilterInstanceType, FilterAccelerator, FilterManufacturer, FilterType}
}

// Model represents the application state
type Model struct {
	// UI state
	viewMode    ViewMode
	width       int
	height      int
	ready       bool
	wideMode    bool
	showScores  bool

	// Data
	instances        []models.GPUInstance
	filteredInstances []models.GPUInstance
	regions          []string
	selectedRegions  []string
	currentRegion    string

	// Table state
	cursor       int
	offset       int
	visibleRows  int

	// Filtering
	filterInput  textinput.Model
	filterText   string
	filterColumn FilterColumn
	accelType    AcceleratorType
	manufacturer string // "", "nvidia", "amd", "habana"

	// Sorting
	sortColumn   SortColumn
	sortAsc      bool

	// Main menu state
	mainMenuCursor int // 0=Browse, 1=Lookup, 2=Probe

	// Region selector state
	regionCursor int

	// Selected instance for detail view
	selectedInstance *models.GPUInstance

	// Lookup state
	lookupResult          *models.InstanceTypeGlobalInfo
	lookupResults         []*models.InstanceTypeGlobalInfo // For multiple lookups (ALL option)
	lookupCursor          int
	lookupOffset          int
	lookupInput           textinput.Model
	instanceTypeOptions   []string // For prefix expansion selection
	instanceSelectCursor  int
	instanceSelectPrefix  string // The prefix used for expansion (e.g., "g7e")
	aggregateCursor       int    // Cursor for aggregate view

	// Loading state
	loading      bool
	loadingMsg   string
	errorMsg     string

	// Probe state
	probeResults *models.ProbeResults
	probeInput   textinput.Model

	// Styles and keys
	styles *Styles
	keys   KeyMap
}

// NewModel creates a new application model
func NewModel() Model {
	ti := textinput.New()
	ti.Placeholder = "Filter instances..."
	ti.CharLimit = 50
	ti.Width = 30

	lookupTi := textinput.New()
	lookupTi.Placeholder = "e.g., g5.xlarge or g5"
	lookupTi.CharLimit = 50
	lookupTi.Width = 30

	probeTi := textinput.New()
	probeTi.Placeholder = "e.g., g5.xlarge"
	probeTi.CharLimit = 50
	probeTi.Width = 30

	return Model{
		viewMode:          ViewMainMenu, // Start with main menu
		instances:         []models.GPUInstance{},
		filteredInstances: []models.GPUInstance{},
		regions:           DefaultGPURegions(),
		selectedRegions:   DefaultGPURegions(),
		currentRegion:     "",
		cursor:            0,
		offset:            0,
		visibleRows:       20,
		filterInput:       ti,
		filterText:        "",
		filterColumn:      FilterAll,
		accelType:         TypeAll,
		manufacturer:      "",
		sortColumn:        SortByName,
		sortAsc:           true,
		mainMenuCursor:    0,
		regionCursor:      0,
		loading:           false,
		showScores:        true, // Show spot scores by default
		lookupCursor:      0,
		lookupOffset:      0,
		lookupInput:       lookupTi,
		probeInput:        probeTi,
		styles:            DefaultStyles(),
		keys:              DefaultKeyMap(),
	}
}

// DefaultGPURegions returns the default regions to query
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

// SetInstances updates the instance data
func (m *Model) SetInstances(instances []models.GPUInstance) {
	m.instances = instances
	m.applyFilters()
}

// applyFilters filters and sorts the instances based on current settings
func (m *Model) applyFilters() {
	filtered := make([]models.GPUInstance, 0, len(m.instances))

	for _, inst := range m.instances {
		// Filter by accelerator type
		if m.accelType == TypeGPU && inst.AcceleratorType != "GPU" {
			continue
		}
		if m.accelType == TypeNeuron && inst.AcceleratorType != "Neuron" {
			continue
		}

		// Filter by manufacturer
		if m.manufacturer != "" && inst.Manufacturer != m.manufacturer {
			continue
		}

		// Filter by text (using column-specific filter)
		if m.filterText != "" && !matchesFilterWithColumn(inst, m.filterText, m.filterColumn) {
			continue
		}

		filtered = append(filtered, inst)
	}

	// Sort
	sortInstances(filtered, m.sortColumn, m.sortAsc)

	m.filteredInstances = filtered

	// Reset cursor if out of bounds
	if m.cursor >= len(m.filteredInstances) {
		m.cursor = max(0, len(m.filteredInstances)-1)
	}
}

// matchesFilter checks if an instance matches the filter text
func matchesFilter(inst models.GPUInstance, filter string) bool {
	// Simple case-insensitive substring match
	lowerFilter := toLower(filter)
	return contains(toLower(inst.InstanceType), lowerFilter) ||
		contains(toLower(inst.AcceleratorName), lowerFilter) ||
		contains(toLower(inst.Manufacturer), lowerFilter)
}

// matchesFilterWithColumn checks if an instance matches the filter text for a specific column
func matchesFilterWithColumn(inst models.GPUInstance, filter string, col FilterColumn) bool {
	lowerFilter := toLower(filter)
	switch col {
	case FilterInstanceType:
		return contains(toLower(inst.InstanceType), lowerFilter)
	case FilterAccelerator:
		return contains(toLower(inst.AcceleratorName), lowerFilter)
	case FilterManufacturer:
		return contains(toLower(inst.Manufacturer), lowerFilter)
	case FilterType:
		return contains(toLower(inst.AcceleratorType), lowerFilter)
	default: // FilterAll
		return contains(toLower(inst.InstanceType), lowerFilter) ||
			contains(toLower(inst.AcceleratorName), lowerFilter) ||
			contains(toLower(inst.Manufacturer), lowerFilter) ||
			contains(toLower(inst.AcceleratorType), lowerFilter)
	}
}

// toLower converts string to lowercase (simple implementation)
func toLower(s string) string {
	result := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		result[i] = c
	}
	return string(result)
}

// contains checks if s contains substr
func contains(s, substr string) bool {
	if len(substr) == 0 {
		return true
	}
	if len(substr) > len(s) {
		return false
	}
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// sortInstances sorts the instances slice in place
func sortInstances(instances []models.GPUInstance, col SortColumn, asc bool) {
	// Simple bubble sort for now (can be optimized with sort.Slice)
	n := len(instances)
	for i := 0; i < n-1; i++ {
		for j := 0; j < n-i-1; j++ {
			shouldSwap := false
			switch col {
			case SortByName:
				shouldSwap = instances[j].InstanceType > instances[j+1].InstanceType
			case SortByPrice:
				shouldSwap = instances[j].SpotPrice > instances[j+1].SpotPrice
			case SortByScore:
				shouldSwap = instances[j].SpotScore < instances[j+1].SpotScore // Higher score first
			case SortByInterrupt:
				shouldSwap = interruptRank(instances[j].InterruptionRate) > interruptRank(instances[j+1].InterruptionRate)
			case SortBySavings:
				shouldSwap = instances[j].SavingsPercent < instances[j+1].SavingsPercent // Higher savings first
			}
			if !asc {
				shouldSwap = !shouldSwap
			}
			if shouldSwap {
				instances[j], instances[j+1] = instances[j+1], instances[j]
			}
		}
	}
}

// interruptRank converts interruption rate string to a sortable rank
func interruptRank(rate string) int {
	switch rate {
	case "<5%":
		return 1
	case "5-10%":
		return 2
	case "10-15%":
		return 3
	case "15-20%":
		return 4
	case ">20%":
		return 5
	default:
		return 6
	}
}

// Getters

// ViewMode returns the current view mode
func (m *Model) ViewMode() ViewMode {
	return m.viewMode
}

// Cursor returns the current cursor position
func (m *Model) Cursor() int {
	return m.cursor
}

// FilteredInstances returns the filtered instance list
func (m *Model) FilteredInstances() []models.GPUInstance {
	return m.filteredInstances
}

// SelectedInstance returns the currently selected instance
func (m *Model) SelectedInstance() *models.GPUInstance {
	if m.cursor >= 0 && m.cursor < len(m.filteredInstances) {
		return &m.filteredInstances[m.cursor]
	}
	return nil
}

// CurrentRegion returns the current region
func (m *Model) CurrentRegion() string {
	return m.currentRegion
}

// AccelType returns the current accelerator type filter
func (m *Model) AccelType() AcceleratorType {
	return m.accelType
}

// SortCol returns the current sort column
func (m *Model) SortCol() SortColumn {
	return m.sortColumn
}

// SortAscending returns whether sort is ascending
func (m *Model) SortAscending() bool {
	return m.sortAsc
}

// IsLoading returns whether data is loading
func (m *Model) IsLoading() bool {
	return m.loading
}

// FilterText returns the current filter text
func (m *Model) FilterText() string {
	return m.filterText
}

// WideMode returns whether wide mode is enabled
func (m *Model) WideMode() bool {
	return m.wideMode
}

// ShowScores returns whether spot scores are shown
func (m *Model) ShowScores() bool {
	return m.showScores
}

// Setters

// SetViewMode sets the current view mode
func (m *Model) SetViewMode(mode ViewMode) {
	m.viewMode = mode
}

// SetLoading sets the loading state
func (m *Model) SetLoading(loading bool, msg string) {
	m.loading = loading
	m.loadingMsg = msg
}

// SetError sets an error message
func (m *Model) SetError(msg string) {
	m.errorMsg = msg
}

// ClearError clears the error message
func (m *Model) ClearError() {
	m.errorMsg = ""
}

// SetSize sets the terminal size
func (m *Model) SetSize(width, height int) {
	m.width = width
	m.height = height
	m.visibleRows = height - 8 // Account for header, footer, borders
	if m.visibleRows < 5 {
		m.visibleRows = 5
	}
	m.ready = true
}

// Navigation

// MoveUp moves the cursor up
func (m *Model) MoveUp() {
	if m.cursor > 0 {
		m.cursor--
		if m.cursor < m.offset {
			m.offset = m.cursor
		}
	}
}

// MoveDown moves the cursor down
func (m *Model) MoveDown() {
	if m.cursor < len(m.filteredInstances)-1 {
		m.cursor++
		if m.cursor >= m.offset+m.visibleRows {
			m.offset = m.cursor - m.visibleRows + 1
		}
	}
}

// PageUp moves up by a page
func (m *Model) PageUp() {
	m.cursor -= m.visibleRows
	if m.cursor < 0 {
		m.cursor = 0
	}
	m.offset = m.cursor
}

// PageDown moves down by a page
func (m *Model) PageDown() {
	m.cursor += m.visibleRows
	if m.cursor >= len(m.filteredInstances) {
		m.cursor = len(m.filteredInstances) - 1
	}
	if m.cursor < 0 {
		m.cursor = 0
	}
	m.offset = m.cursor - m.visibleRows + 1
	if m.offset < 0 {
		m.offset = 0
	}
}

// GoToTop moves to the first item
func (m *Model) GoToTop() {
	m.cursor = 0
	m.offset = 0
}

// GoToBottom moves to the last item
func (m *Model) GoToBottom() {
	m.cursor = len(m.filteredInstances) - 1
	if m.cursor < 0 {
		m.cursor = 0
	}
	m.offset = m.cursor - m.visibleRows + 1
	if m.offset < 0 {
		m.offset = 0
	}
}

// Filtering

// SetFilter sets the filter text and reapplies filters
func (m *Model) SetFilter(text string) {
	m.filterText = text
	m.applyFilters()
}

// ClearFilter clears the filter
func (m *Model) ClearFilter() {
	m.filterText = ""
	m.filterInput.SetValue("")
	m.applyFilters()
}

// ToggleAccelType cycles through accelerator types
func (m *Model) ToggleAccelType() {
	m.accelType = (m.accelType + 1) % 3
	m.applyFilters()
}

// SetManufacturer sets the manufacturer filter
func (m *Model) SetManufacturer(mfr string) {
	m.manufacturer = mfr
	m.applyFilters()
}

// Sorting

// CycleSort cycles through sort columns
func (m *Model) CycleSort() {
	m.sortColumn = (m.sortColumn + 1) % 5
	m.applyFilters()
}

// SetSort sets the sort column
func (m *Model) SetSort(col SortColumn) {
	if m.sortColumn == col {
		m.sortAsc = !m.sortAsc
	} else {
		m.sortColumn = col
		m.sortAsc = true
	}
	m.applyFilters()
}

// ToggleSortDirection toggles between ascending and descending sort
func (m *Model) ToggleSortDirection() {
	m.sortAsc = !m.sortAsc
	m.applyFilters()
}

// Filter column methods

// FilterCol returns the current filter column
func (m *Model) FilterCol() FilterColumn {
	return m.filterColumn
}

// CycleFilterColumn cycles through filter columns
func (m *Model) CycleFilterColumn() {
	m.filterColumn = (m.filterColumn + 1) % 5
	// Update placeholder text based on column
	switch m.filterColumn {
	case FilterInstanceType:
		m.filterInput.Placeholder = "Filter by instance type..."
	case FilterAccelerator:
		m.filterInput.Placeholder = "Filter by accelerator..."
	case FilterManufacturer:
		m.filterInput.Placeholder = "Filter by manufacturer..."
	case FilterType:
		m.filterInput.Placeholder = "Filter by type (GPU/Neuron)..."
	default:
		m.filterInput.Placeholder = "Filter all columns..."
	}
	// Reapply filters if there's existing filter text
	if m.filterText != "" {
		m.applyFilters()
	}
}

// SetFilterColumn sets the filter column
func (m *Model) SetFilterColumn(col FilterColumn) {
	m.filterColumn = col
	m.applyFilters()
}

// Display toggles

// ToggleWideMode toggles wide mode
func (m *Model) ToggleWideMode() {
	m.wideMode = !m.wideMode
}

// ToggleSpotScores toggles spot score display
func (m *Model) ToggleSpotScores() {
	m.showScores = !m.showScores
}

// Region selection

// Regions returns available regions
func (m *Model) Regions() []string {
	return m.regions
}

// RegionCursor returns the region selector cursor
func (m *Model) RegionCursor() int {
	return m.regionCursor
}

// MoveRegionUp moves the region cursor up
func (m *Model) MoveRegionUp() {
	if m.regionCursor > 0 {
		m.regionCursor--
	}
}

// MoveRegionDown moves the region cursor down
func (m *Model) MoveRegionDown() {
	if m.regionCursor < len(m.regions)-1 {
		m.regionCursor++
	}
}

// SelectRegion selects the current region
func (m *Model) SelectRegion() string {
	if m.regionCursor >= 0 && m.regionCursor < len(m.regions) {
		m.currentRegion = m.regions[m.regionCursor]
	}
	return m.currentRegion
}

// SetCurrentRegion sets the current region
func (m *Model) SetCurrentRegion(region string) {
	m.currentRegion = region
	// Update region cursor to match
	for i, r := range m.regions {
		if r == region {
			m.regionCursor = i
			break
		}
	}
}

// Lookup methods

// LookupResult returns the current lookup result
func (m *Model) LookupResult() *models.InstanceTypeGlobalInfo {
	return m.lookupResult
}

// SetLookupResult sets the lookup result
func (m *Model) SetLookupResult(result *models.InstanceTypeGlobalInfo) {
	m.lookupResult = result
	m.lookupCursor = 0
	m.lookupOffset = 0
}

// SetMultipleLookupResults sets multiple lookup results (for ALL option)
func (m *Model) SetMultipleLookupResults(results []*models.InstanceTypeGlobalInfo) {
	m.lookupResults = results
	m.aggregateCursor = 0
}

// AggregateCursor returns the aggregate view cursor
func (m *Model) AggregateCursor() int {
	return m.aggregateCursor
}

// MoveAggregateUp moves the aggregate cursor up
func (m *Model) MoveAggregateUp() {
	if m.aggregateCursor > 0 {
		m.aggregateCursor--
	}
}

// MoveAggregateDown moves the aggregate cursor down
func (m *Model) MoveAggregateDown(totalRows int) {
	if totalRows > 0 && m.aggregateCursor < totalRows-1 {
		m.aggregateCursor++
	}
}

// SelectedAggregateResult returns the selected result from aggregate view
func (m *Model) SelectedAggregateResult() *models.InstanceTypeGlobalInfo {
	if m.lookupResults != nil && m.aggregateCursor >= 0 && m.aggregateCursor < len(m.lookupResults) {
		return m.lookupResults[m.aggregateCursor]
	}
	return nil
}

// MultipleLookupResults returns the multiple lookup results
func (m *Model) MultipleLookupResults() []*models.InstanceTypeGlobalInfo {
	return m.lookupResults
}

// LookupCursor returns the lookup cursor position
func (m *Model) LookupCursor() int {
	return m.lookupCursor
}

// MoveLookupUp moves the lookup cursor up
func (m *Model) MoveLookupUp() {
	if m.lookupCursor > 0 {
		m.lookupCursor--
		if m.lookupCursor < m.lookupOffset {
			m.lookupOffset = m.lookupCursor
		}
	}
}

// MoveLookupDown moves the lookup cursor down
func (m *Model) MoveLookupDown() {
	if m.lookupResult != nil && m.lookupCursor < len(m.lookupResult.RegionInfo)-1 {
		m.lookupCursor++
		if m.lookupCursor >= m.lookupOffset+m.visibleRows {
			m.lookupOffset = m.lookupCursor - m.visibleRows + 1
		}
	}
}

// StartLookupInput initializes the lookup input with optional pre-fill
func (m *Model) StartLookupInput(prefill string) {
	m.lookupInput.SetValue(prefill)
	m.lookupInput.Focus()
	m.viewMode = ViewLookupInput
}

// GetLookupInputValue returns the current lookup input value
func (m *Model) GetLookupInputValue() string {
	return m.lookupInput.Value()
}

// LookupInput returns the lookup input model for updates
func (m *Model) LookupInput() *textinput.Model {
	return &m.lookupInput
}

// SetInstanceTypeOptions sets the instance type options for selection
func (m *Model) SetInstanceTypeOptions(options []string, prefix string) {
	m.instanceTypeOptions = options
	m.instanceSelectPrefix = prefix
	m.instanceSelectCursor = 0
	m.viewMode = ViewInstanceSelect
}

// InstanceSelectPrefix returns the prefix used for expansion
func (m *Model) InstanceSelectPrefix() string {
	return m.instanceSelectPrefix
}

// IsAllSelected returns true if the "ALL" option is selected (cursor at 0)
func (m *Model) IsAllSelected() bool {
	return m.instanceSelectCursor == 0
}

// InstanceTypeOptions returns the current instance type options
func (m *Model) InstanceTypeOptions() []string {
	return m.instanceTypeOptions
}

// InstanceSelectCursor returns the instance selection cursor
func (m *Model) InstanceSelectCursor() int {
	return m.instanceSelectCursor
}

// MoveInstanceSelectUp moves the instance selection cursor up
func (m *Model) MoveInstanceSelectUp() {
	if m.instanceSelectCursor > 0 {
		m.instanceSelectCursor--
	}
}

// MoveInstanceSelectDown moves the instance selection cursor down
func (m *Model) MoveInstanceSelectDown() {
	// +1 because cursor 0 is ALL option, options are 1 to len(options)
	if m.instanceSelectCursor < len(m.instanceTypeOptions) {
		m.instanceSelectCursor++
	}
}

// SelectedInstanceTypeOption returns the currently selected instance type from options
// Returns empty string if ALL is selected (cursor 0)
func (m *Model) SelectedInstanceTypeOption() string {
	// Cursor 0 is ALL, so actual options start at cursor 1
	optionIndex := m.instanceSelectCursor - 1
	if optionIndex >= 0 && optionIndex < len(m.instanceTypeOptions) {
		return m.instanceTypeOptions[optionIndex]
	}
	return ""
}

// Main menu methods

// MainMenuCursor returns the main menu cursor
func (m *Model) MainMenuCursor() int {
	return m.mainMenuCursor
}

// MoveMainMenuUp moves the main menu cursor up
func (m *Model) MoveMainMenuUp() {
	if m.mainMenuCursor > 0 {
		m.mainMenuCursor--
	}
}

// MoveMainMenuDown moves the main menu cursor down
func (m *Model) MoveMainMenuDown() {
	if m.mainMenuCursor < 2 { // 3 options: Browse, Lookup, Probe
		m.mainMenuCursor++
	}
}

// Probe methods

// ProbeResults returns the current probe results
func (m *Model) ProbeResults() *models.ProbeResults {
	return m.probeResults
}

// SetProbeResults sets the probe results
func (m *Model) SetProbeResults(results *models.ProbeResults) {
	m.probeResults = results
}

// StartProbeInput initializes the probe input
func (m *Model) StartProbeInput(prefill string) {
	m.probeInput.SetValue(prefill)
	m.probeInput.Focus()
	m.viewMode = ViewProbeInput
}

// GetProbeInputValue returns the current probe input value
func (m *Model) GetProbeInputValue() string {
	return m.probeInput.Value()
}

// ProbeInput returns the probe input model for updates
func (m *Model) ProbeInput() *textinput.Model {
	return &m.probeInput
}

// Helper

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
