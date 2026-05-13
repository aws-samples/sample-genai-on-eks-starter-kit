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
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/key"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/gpu-hunter/pkg/models"
	"github.com/gpu-hunter/pkg/tui/table"
)

// DataFetcher is a function type for fetching GPU instances
type DataFetcher func(ctx context.Context, region string) ([]models.GPUInstance, error)

// LookupFetcher is a function type for looking up instance across regions
type LookupFetcher func(ctx context.Context, instanceType string) (*models.InstanceTypeGlobalInfo, error)

// ProbeFetcher is a function type for probing capacity by launching instances
type ProbeFetcher func(ctx context.Context, instanceType string, capacityType string) (*models.ProbeResults, error)

// Messages for async operations
type (
	// InstancesLoadedMsg is sent when instances are loaded
	InstancesLoadedMsg struct {
		Instances []models.GPUInstance
		Region    string
	}

	// LookupLoadedMsg is sent when lookup results are loaded
	LookupLoadedMsg struct {
		Result *models.InstanceTypeGlobalInfo
	}

	// ProbeLoadedMsg is sent when probe results are loaded
	ProbeLoadedMsg struct {
		Results *models.ProbeResults
	}

	// ErrorMsg is sent when an error occurs
	ErrorMsg struct {
		Err error
	}

	// LoadingTickMsg for animation
	LoadingTickMsg struct{}
)

// PrefixExpander is a function type for expanding instance type prefixes
type PrefixExpander func(ctx context.Context, prefix string) ([]string, error)

// App wraps the model with data fetching capability
type App struct {
	Model
	fetcher        DataFetcher
	lookupFetcher  LookupFetcher
	probeFetcher   ProbeFetcher
	prefixExpander PrefixExpander
	ctx            context.Context
	spinner        spinner.Model
	loadingFrame   int

	// Generic tables for different views
	regionTable    *table.Table
	lookupTable    *table.Table
	aggregateTable *table.Table
}

// NewApp creates a new TUI application with data fetching
func NewApp(ctx context.Context, fetcher DataFetcher, initialRegion string) App {
	m := NewModel()
	m.SetCurrentRegion(initialRegion)

	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("205"))

	// Initialize tables with default columns
	regionTable := table.New(table.RegionViewColumns(true, false))
	lookupTable := table.New(table.LookupViewColumns())
	aggregateTable := table.New(table.AggregateViewColumns())

	return App{
		Model:          m,
		fetcher:        fetcher,
		ctx:            ctx,
		spinner:        s,
		regionTable:    regionTable,
		lookupTable:    lookupTable,
		aggregateTable: aggregateTable,
	}
}

// SetLookupFetcher sets the lookup fetcher function
func (a *App) SetLookupFetcher(fetcher LookupFetcher) {
	a.lookupFetcher = fetcher
}

// SetPrefixExpander sets the prefix expander function
func (a *App) SetPrefixExpander(expander PrefixExpander) {
	a.prefixExpander = expander
}

// SetProbeFetcher sets the probe fetcher function
func (a *App) SetProbeFetcher(fetcher ProbeFetcher) {
	a.probeFetcher = fetcher
}

// Init initializes the Bubble Tea model
func (a App) Init() tea.Cmd {
	return a.spinner.Tick
}

// fetchData returns a command to fetch instances from AWS
func (a App) fetchData() tea.Cmd {
	return func() tea.Msg {
		if a.fetcher == nil {
			return ErrorMsg{Err: fmt.Errorf("no data fetcher configured")}
		}

		instances, err := a.fetcher(a.ctx, a.currentRegion)
		if err != nil {
			return ErrorMsg{Err: err}
		}

		return InstancesLoadedMsg{
			Instances: instances,
			Region:    a.currentRegion,
		}
	}
}

// Update handles messages and updates the model
func (a App) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		if a.loading {
			return a, nil
		}
		return a.handleKeyPress(msg)

	case tea.WindowSizeMsg:
		a.SetSize(msg.Width, msg.Height)
		// Update table sizes
		visibleRows := msg.Height - 8
		if visibleRows < 5 {
			visibleRows = 5
		}
		a.regionTable.SetSize(msg.Width, visibleRows)
		a.lookupTable.SetSize(msg.Width, visibleRows)
		a.aggregateTable.SetSize(msg.Width, visibleRows)
		return a, nil

	case InstancesLoadedMsg:
		a.SetInstances(msg.Instances)
		// Convert to unified data and update region table
		data := make([]models.InstanceRegionData, len(a.filteredInstances))
		for i, inst := range a.filteredInstances {
			data[i] = models.FromGPUInstance(inst, a.currentRegion)
		}
		a.regionTable.SetData(data)
		a.SetLoading(false, "")
		return a, nil

	case LookupLoadedMsg:
		a.SetLookupResult(msg.Result)
		// Convert to unified data for lookup table
		specs := models.ExtractSpecs(msg.Result)
		var data []models.InstanceRegionData
		for _, ri := range msg.Result.RegionInfo {
			if ri.Available {
				data = append(data, models.FromRegionInstanceInfo(ri, msg.Result.InstanceType, specs))
			}
		}
		a.lookupTable.SetData(data)
		a.SetLoading(false, "")
		a.SetViewMode(ViewLookup)
		return a, nil

	case MultipleLookupLoadedMsg:
		if len(msg.Results) > 0 {
			a.SetMultipleLookupResults(msg.Results)
			// Convert to unified data for aggregate table
			var data []models.InstanceRegionData
			for _, result := range msg.Results {
				specs := models.ExtractSpecs(result)
				for _, ri := range result.RegionInfo {
					if ri.Available {
						data = append(data, models.FromRegionInstanceInfo(ri, result.InstanceType, specs))
					}
				}
			}
			a.aggregateTable.SetData(data)
		}
		a.SetLoading(false, "")
		a.SetViewMode(ViewLookupAggregate)
		return a, nil

	case ProbeLoadedMsg:
		a.SetProbeResults(msg.Results)
		a.SetLoading(false, "")
		a.SetViewMode(ViewProbe)
		return a, nil

	case PrefixExpandedMsg:
		a.SetLoading(false, "")
		if len(msg.InstanceTypes) == 1 {
			a.SetLoading(true, fmt.Sprintf("Looking up %s across all regions...", msg.InstanceTypes[0]))
			return a, tea.Batch(a.spinner.Tick, a.fetchLookup(msg.InstanceTypes[0]))
		}
		a.SetInstanceTypeOptions(msg.InstanceTypes, msg.Prefix)
		return a, nil

	case ErrorMsg:
		a.SetError(msg.Err.Error())
		a.SetLoading(false, "")
		return a, nil

	case spinner.TickMsg:
		if a.loading {
			var cmd tea.Cmd
			a.spinner, cmd = a.spinner.Update(msg)
			a.loadingFrame++
			cmds = append(cmds, cmd)
		}
		return a, tea.Batch(cmds...)
	}

	return a, tea.Batch(cmds...)
}

// handleKeyPress handles keyboard input
func (a App) handleKeyPress(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if key.Matches(msg, a.keys.Quit) && a.viewMode == ViewMainMenu {
		return a, tea.Quit
	}

	switch a.viewMode {
	case ViewMainMenu:
		return a.handleMainMenuKeys(msg)
	case ViewTable:
		return a.handleTableKeys(msg)
	case ViewDetail:
		return a.handleDetailKeys(msg)
	case ViewRegionSelect:
		return a.handleRegionKeys(msg)
	case ViewHelp:
		return a.handleHelpKeys(msg)
	case ViewFilter:
		return a.handleFilterKeys(msg)
	case ViewLookup:
		return a.handleLookupKeys(msg)
	case ViewLookupInput:
		return a.handleLookupInputKeys(msg)
	case ViewInstanceSelect:
		return a.handleInstanceSelectKeys(msg)
	case ViewLookupAggregate:
		return a.handleAggregateKeys(msg)
	case ViewProbe:
		return a.handleProbeKeys(msg)
	case ViewProbeInput:
		return a.handleProbeInputKeys(msg)
	}

	return a, nil
}

// handleMainMenuKeys handles keys in main menu view
func (a App) handleMainMenuKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, a.keys.Up):
		a.MoveMainMenuUp()
	case key.Matches(msg, a.keys.Down):
		a.MoveMainMenuDown()
	case key.Matches(msg, a.keys.Enter):
		switch a.MainMenuCursor() {
		case 0: // Browse by Region
			a.SetViewMode(ViewRegionSelect)
		case 1: // Lookup
			a.StartLookupInput("")
		case 2: // Probe
			a.StartProbeInput("")
		}
	case key.Matches(msg, a.keys.Quit):
		return a, tea.Quit
	}
	return a, nil
}

// handleTableKeys handles keys in table view
func (a App) handleTableKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, a.keys.Up):
		a.regionTable.MoveUp()
		a.cursor = a.regionTable.Cursor()
	case key.Matches(msg, a.keys.Down):
		a.regionTable.MoveDown()
		a.cursor = a.regionTable.Cursor()
	case key.Matches(msg, a.keys.PageUp):
		a.regionTable.PageUp()
		a.cursor = a.regionTable.Cursor()
	case key.Matches(msg, a.keys.PageDown):
		a.regionTable.PageDown()
		a.cursor = a.regionTable.Cursor()
	case key.Matches(msg, a.keys.Home):
		a.regionTable.GoToTop()
		a.cursor = a.regionTable.Cursor()
	case key.Matches(msg, a.keys.End):
		a.regionTable.GoToBottom()
		a.cursor = a.regionTable.Cursor()
	case key.Matches(msg, a.keys.Enter):
		if a.SelectedInstance() != nil {
			a.SetViewMode(ViewDetail)
		}
	case key.Matches(msg, a.keys.Filter):
		a.SetViewMode(ViewFilter)
		a.filterInput.Focus()
		return a, nil
	case key.Matches(msg, a.keys.ClearFilter):
		a.ClearFilter()
		a.updateRegionTableData()
	case key.Matches(msg, a.keys.Sort):
		a.CycleSort()
		a.updateRegionTableData()
	case key.Matches(msg, a.keys.SortDirection):
		a.ToggleSortDirection()
		a.updateRegionTableData()
	case key.Matches(msg, a.keys.SortPrice):
		a.SetSort(SortByPrice)
		a.updateRegionTableData()
	case key.Matches(msg, a.keys.SortScore):
		a.SetSort(SortByScore)
		a.updateRegionTableData()
	case key.Matches(msg, a.keys.SortInterrupt):
		a.SetSort(SortByInterrupt)
		a.updateRegionTableData()
	case key.Matches(msg, a.keys.SortSavings):
		a.SetSort(SortBySavings)
		a.updateRegionTableData()
	case key.Matches(msg, a.keys.SortName):
		a.SetSort(SortByName)
		a.updateRegionTableData()
	case key.Matches(msg, a.keys.Region):
		a.SetViewMode(ViewRegionSelect)
	case key.Matches(msg, a.keys.TypeToggle):
		a.ToggleAccelType()
		a.updateRegionTableData()
	case key.Matches(msg, a.keys.Help):
		a.SetViewMode(ViewHelp)
	case key.Matches(msg, a.keys.Wide):
		a.ToggleWideMode()
		// Update columns for wide mode
		a.regionTable = table.New(table.RegionViewColumns(a.showScores, a.wideMode))
		a.regionTable.SetSize(a.width, a.visibleRows)
		a.updateRegionTableData()
	case key.Matches(msg, a.keys.SpotScore):
		a.ToggleSpotScores()
		a.regionTable = table.New(table.RegionViewColumns(a.showScores, a.wideMode))
		a.regionTable.SetSize(a.width, a.visibleRows)
		a.updateRegionTableData()
	case key.Matches(msg, a.keys.FilterNvidia):
		a.SetManufacturer("nvidia")
		a.updateRegionTableData()
	case key.Matches(msg, a.keys.FilterAMD):
		a.SetManufacturer("amd")
		a.updateRegionTableData()
	case key.Matches(msg, a.keys.FilterAll):
		a.SetManufacturer("")
		a.updateRegionTableData()
	case key.Matches(msg, a.keys.Lookup):
		prefill := ""
		if inst := a.SelectedInstance(); inst != nil {
			prefill = inst.InstanceType
		}
		a.StartLookupInput(prefill)
		return a, nil
	case key.Matches(msg, a.keys.Probe):
		if inst := a.SelectedInstance(); inst != nil {
			a.SetLoading(true, fmt.Sprintf("Probing %s capacity (spot + on-demand)...", inst.InstanceType))
			return a, tea.Batch(a.spinner.Tick, a.fetchProbe(inst.InstanceType, "both"))
		}
		return a, nil
	case key.Matches(msg, a.keys.Refresh):
		a.SetLoading(true, fmt.Sprintf("Refreshing data from %s...", a.currentRegion))
		return a, tea.Batch(a.spinner.Tick, a.fetchData())
	case key.Matches(msg, a.keys.Escape):
		a.SetViewMode(ViewMainMenu)
		return a, nil
	}

	return a, nil
}

// updateRegionTableData updates the region table with current filtered data
func (a *App) updateRegionTableData() {
	data := make([]models.InstanceRegionData, len(a.filteredInstances))
	for i, inst := range a.filteredInstances {
		data[i] = models.FromGPUInstance(inst, a.currentRegion)
	}
	a.regionTable.SetData(data)
	a.regionTable.SetCursor(a.cursor)
}

// handleDetailKeys handles keys in detail view
func (a App) handleDetailKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, a.keys.Escape), key.Matches(msg, a.keys.Quit):
		a.SetViewMode(ViewTable)
	}
	return a, nil
}

// handleRegionKeys handles keys in region selector
func (a App) handleRegionKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, a.keys.Up):
		a.MoveRegionUp()
	case key.Matches(msg, a.keys.Down):
		a.MoveRegionDown()
	case key.Matches(msg, a.keys.Enter):
		newRegion := a.SelectRegion()
		a.SetViewMode(ViewTable)
		a.SetLoading(true, fmt.Sprintf("Loading instances from %s...", newRegion))
		return a, tea.Batch(a.spinner.Tick, a.fetchData())
	case key.Matches(msg, a.keys.Escape), key.Matches(msg, a.keys.Quit):
		a.SetViewMode(ViewMainMenu)
	}
	return a, nil
}

// handleHelpKeys handles keys in help view
func (a App) handleHelpKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, a.keys.Escape), key.Matches(msg, a.keys.Help), key.Matches(msg, a.keys.Quit):
		a.SetViewMode(ViewTable)
	}
	return a, nil
}

// handleFilterKeys handles keys in filter input
func (a App) handleFilterKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, a.keys.Escape):
		a.SetViewMode(ViewTable)
		return a, nil
	case key.Matches(msg, a.keys.Enter):
		a.SetFilter(a.filterInput.Value())
		a.updateRegionTableData()
		a.SetViewMode(ViewTable)
		return a, nil
	case key.Matches(msg, a.keys.FilterColumn):
		a.CycleFilterColumn()
		return a, nil
	default:
		var cmd tea.Cmd
		a.filterInput, cmd = a.filterInput.Update(msg)
		return a, cmd
	}
}

// handleLookupKeys handles keys in lookup view
func (a App) handleLookupKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, a.keys.Escape), key.Matches(msg, a.keys.Quit):
		a.SetViewMode(ViewMainMenu)
	case key.Matches(msg, a.keys.Up):
		a.lookupTable.MoveUp()
	case key.Matches(msg, a.keys.Down):
		a.lookupTable.MoveDown()
	}
	return a, nil
}

// handleLookupInputKeys handles keys in lookup input view
func (a App) handleLookupInputKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, a.keys.Escape):
		a.SetViewMode(ViewMainMenu)
		return a, nil
	case key.Matches(msg, a.keys.Enter):
		input := a.GetLookupInputValue()
		if input != "" {
			if !strings.Contains(input, ".") {
				a.SetLoading(true, fmt.Sprintf("Finding %s.* instance types...", input))
				a.SetViewMode(ViewMainMenu)
				return a, tea.Batch(a.spinner.Tick, a.expandPrefix(input))
			}
			a.SetLoading(true, fmt.Sprintf("Looking up %s across all regions...", input))
			a.SetViewMode(ViewMainMenu)
			return a, tea.Batch(a.spinner.Tick, a.fetchLookup(input))
		}
		a.SetViewMode(ViewMainMenu)
		return a, nil
	default:
		var cmd tea.Cmd
		lookupInput := a.LookupInput()
		*lookupInput, cmd = lookupInput.Update(msg)
		return a, cmd
	}
}

// handleAggregateKeys handles keys in aggregate lookup view
func (a App) handleAggregateKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, a.keys.Escape), key.Matches(msg, a.keys.Quit):
		a.SetViewMode(ViewMainMenu)
	case key.Matches(msg, a.keys.Up):
		a.aggregateTable.MoveUp()
	case key.Matches(msg, a.keys.Down):
		a.aggregateTable.MoveDown()
	}
	return a, nil
}

// handleProbeKeys handles keys in probe results view
func (a App) handleProbeKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, a.keys.Escape), key.Matches(msg, a.keys.Quit):
		a.SetViewMode(ViewMainMenu)
	}
	return a, nil
}

// handleProbeInputKeys handles keys in probe input view
func (a App) handleProbeInputKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, a.keys.Escape):
		a.SetViewMode(ViewMainMenu)
		return a, nil
	case key.Matches(msg, a.keys.Enter):
		input := a.GetProbeInputValue()
		if input != "" {
			a.SetLoading(true, fmt.Sprintf("Probing %s capacity across all regions...", input))
			a.SetViewMode(ViewMainMenu)
			return a, tea.Batch(a.spinner.Tick, a.fetchProbe(input, "both"))
		}
		a.SetViewMode(ViewMainMenu)
		return a, nil
	default:
		var cmd tea.Cmd
		probeInput := a.ProbeInput()
		*probeInput, cmd = probeInput.Update(msg)
		return a, cmd
	}
}

// handleInstanceSelectKeys handles keys in instance type selection view
func (a App) handleInstanceSelectKeys(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch {
	case key.Matches(msg, a.keys.Escape), key.Matches(msg, a.keys.Quit):
		a.SetViewMode(ViewMainMenu)
	case key.Matches(msg, a.keys.Up):
		a.MoveInstanceSelectUp()
	case key.Matches(msg, a.keys.Down):
		a.MoveInstanceSelectDown()
	case key.Matches(msg, a.keys.Enter):
		if a.IsAllSelected() {
			options := a.InstanceTypeOptions()
			prefix := a.InstanceSelectPrefix()
			a.SetLoading(true, fmt.Sprintf("Looking up all %s.* instances across all regions...", prefix))
			a.SetViewMode(ViewMainMenu)
			return a, tea.Batch(a.spinner.Tick, a.fetchMultipleLookups(options))
		}
		selected := a.SelectedInstanceTypeOption()
		if selected != "" {
			a.SetLoading(true, fmt.Sprintf("Looking up %s across all regions...", selected))
			a.SetViewMode(ViewMainMenu)
			return a, tea.Batch(a.spinner.Tick, a.fetchLookup(selected))
		}
	}
	return a, nil
}

// fetchLookup returns a command to lookup instance across regions
func (a App) fetchLookup(instanceType string) tea.Cmd {
	return func() tea.Msg {
		if a.lookupFetcher == nil {
			return ErrorMsg{Err: fmt.Errorf("lookup not available")}
		}

		result, err := a.lookupFetcher(a.ctx, instanceType)
		if err != nil {
			return ErrorMsg{Err: err}
		}

		return LookupLoadedMsg{Result: result}
	}
}

// fetchProbe returns a command to probe capacity by launching instances
func (a App) fetchProbe(instanceType, capacityType string) tea.Cmd {
	return func() tea.Msg {
		if a.probeFetcher == nil {
			return ErrorMsg{Err: fmt.Errorf("probe not available")}
		}

		results, err := a.probeFetcher(a.ctx, instanceType, capacityType)
		if err != nil {
			return ErrorMsg{Err: err}
		}

		return ProbeLoadedMsg{Results: results}
	}
}

// PrefixExpandedMsg is sent when prefix expansion completes
type PrefixExpandedMsg struct {
	InstanceTypes []string
	Prefix        string
}

// expandPrefix returns a command to expand a prefix to matching instance types
func (a App) expandPrefix(prefix string) tea.Cmd {
	return func() tea.Msg {
		if a.prefixExpander == nil {
			return ErrorMsg{Err: fmt.Errorf("prefix expansion not available")}
		}

		instanceTypes, err := a.prefixExpander(a.ctx, prefix)
		if err != nil {
			return ErrorMsg{Err: err}
		}

		return PrefixExpandedMsg{InstanceTypes: instanceTypes, Prefix: prefix}
	}
}

// MultipleLookupLoadedMsg is sent when multiple lookups complete
type MultipleLookupLoadedMsg struct {
	Results []*models.InstanceTypeGlobalInfo
}

// fetchMultipleLookups returns a command to lookup multiple instance types
func (a App) fetchMultipleLookups(instanceTypes []string) tea.Cmd {
	return func() tea.Msg {
		if a.lookupFetcher == nil {
			return ErrorMsg{Err: fmt.Errorf("lookup not available")}
		}

		var results []*models.InstanceTypeGlobalInfo
		for _, it := range instanceTypes {
			result, err := a.lookupFetcher(a.ctx, it)
			if err != nil {
				continue
			}
			results = append(results, result)
		}

		if len(results) == 0 {
			return ErrorMsg{Err: fmt.Errorf("no results found")}
		}

		return MultipleLookupLoadedMsg{Results: results}
	}
}

// View renders the UI
func (a App) View() string {
	if !a.ready {
		return "Initializing..."
	}

	if a.loading {
		return a.renderLoadingView()
	}

	var content string

	switch a.viewMode {
	case ViewMainMenu:
		content = a.renderMainMenuView()
	case ViewTable:
		content = a.renderTableView()
	case ViewDetail:
		content = a.renderDetailView()
	case ViewRegionSelect:
		content = a.renderRegionSelector()
	case ViewHelp:
		content = a.renderHelpView()
	case ViewFilter:
		content = a.renderFilterView()
	case ViewLookup:
		content = a.renderLookupView()
	case ViewLookupInput:
		content = a.renderLookupInputView()
	case ViewInstanceSelect:
		content = a.renderInstanceSelectView()
	case ViewLookupAggregate:
		content = a.renderAggregateView()
	case ViewProbe:
		content = a.renderProbeView()
	case ViewProbeInput:
		content = a.renderProbeInputView()
	}

	return content
}

// renderLoadingView renders a fun loading animation
func (a App) renderLoadingView() string {
	var b strings.Builder

	padding := strings.Repeat("\n", a.height/5)
	b.WriteString(padding)

	sparkles := []string{"✨", "💫", "⭐", "🌟"}
	sparkle := sparkles[(a.loadingFrame/4)%len(sparkles)]
	title := lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("205")).
		Render(sparkle + " GPU Hunter " + sparkle)
	b.WriteString(centerText(title, a.width))
	b.WriteString("\n\n")

	spinnerLine := a.spinner.View() + " " + a.loadingMsg
	b.WriteString(centerText(spinnerLine, a.width))
	b.WriteString("\n\n")

	runner := "🏃"
	dust := "💨"
	frameIdx := (a.loadingFrame / 5) % 12

	warehouseBox := `╔════════════════════════════╗
║    🎮 GPU WAREHOUSE 🎮     ║
║  [📦] [📦] [📦] [📦] [📦]  ║
╚════════════════════════════╝`

	var runnerLine string
	var boxLine3 string

	switch frameIdx {
	case 0:
		runnerLine = "              " + runner + dust
		boxLine3 = "║  [📦] [📦] [📦] [📦] [📦]  ║"
	case 1:
		runnerLine = "        " + runner + dust
		boxLine3 = "║  [📦] [📦] [📦] [📦] [📦]  ║"
	case 2:
		runnerLine = "    " + runner + dust
		boxLine3 = "║  [📦] [📦] [📦] [📦] [📦]  ║"
	case 3:
		runnerLine = runner + dust
		boxLine3 = "║  [📦] [📦] [📦] [📦] [📦]  ║"
	case 4:
		runnerLine = ""
		warehouseBox = `╔════════════════════════════╗
║    🎮 GPU WAREHOUSE  ` + runner + `🔍  ║
║  [📦] [📦] [📦] [📦] [📦]  ║
╚════════════════════════════╝`
	case 5:
		runnerLine = ""
		boxLine3 = "║  [📦] [📦] [📦] [📦] [" + runner + "]  ║"
		warehouseBox = "╔════════════════════════════╗\n║    🎮 GPU WAREHOUSE 🎮     ║\n" + boxLine3 + "\n╚════════════════════════════╝"
	case 6:
		runnerLine = ""
		boxLine3 = "║  [📦] [📦] [📦] [" + runner + "] [✅]  ║"
		warehouseBox = "╔════════════════════════════╗\n║    🎮 GPU WAREHOUSE 🎮     ║\n" + boxLine3 + "\n╚════════════════════════════╝"
	case 7:
		runnerLine = ""
		boxLine3 = "║  [📦] [📦] [" + runner + "] [✅] [✅]  ║"
		warehouseBox = "╔════════════════════════════╗\n║    🎮 GPU WAREHOUSE 🎮     ║\n" + boxLine3 + "\n╚════════════════════════════╝"
	case 8:
		runnerLine = ""
		boxLine3 = "║  [📦] [" + runner + "] [✅] [✅] [✅]  ║"
		warehouseBox = "╔════════════════════════════╗\n║    🎮 GPU WAREHOUSE 🎮     ║\n" + boxLine3 + "\n╚════════════════════════════╝"
	case 9:
		runnerLine = ""
		boxLine3 = "║  [" + runner + "] [✅] [✅] [✅] [✅]  ║"
		warehouseBox = "╔════════════════════════════╗\n║    🎮 GPU WAREHOUSE 🎮     ║\n" + boxLine3 + "\n╚════════════════════════════╝"
	case 10:
		runnerLine = ""
		warehouseBox = "╔════════════════════════════╗\n║     🎯 FOUND GPUS! 🎯      ║\n║  [🎮] [🎮] [🎮] [🎮] [🎮]  ║\n╚════════════════════════════╝\n          🎉" + runner + "🎉"
	case 11:
		runnerLine = ""
		warehouseBox = "╔════════════════════════════╗\n║    ✨ FOUND GPUS! ✨       ║\n║  [🎮] [🎮] [🎮] [🎮] [🎮]  ║\n╚════════════════════════════╝\n          🏆" + runner + "🏆"
	}

	animStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("39"))
	lines := strings.Split(warehouseBox, "\n")
	boxWidth := 30

	if frameIdx < 4 && runnerLine != "" {
		skyLine := strings.Repeat(" ", boxWidth)
		runnerPositions := []int{boxWidth - 4, boxWidth - 10, boxWidth - 16, boxWidth - 22}
		pos := runnerPositions[frameIdx]
		if pos < 0 {
			pos = 0
		}
		runnerStr := runner + dust
		if pos+len(runnerStr) <= boxWidth {
			skyLine = skyLine[:pos] + runnerStr + skyLine[pos+len(runnerStr):]
		} else {
			skyLine = skyLine[:pos] + runnerStr
		}
		b.WriteString(centerText(animStyle.Render(skyLine), a.width))
		b.WriteString("\n")
	}

	for _, line := range lines {
		styledLine := animStyle.Render(line)
		b.WriteString(centerText(styledLine, a.width))
		b.WriteString("\n")
	}

	b.WriteString("\n")

	var messages []string
	if frameIdx < 4 {
		messages = []string{"🏃 Sprinting to AWS data centers...", "💨 Running as fast as possible...", "🌐 Connecting to the cloud...", "🚀 Almost at the warehouse..."}
	} else if frameIdx < 10 {
		messages = []string{"🔍 Searching through instance types...", "📦 Opening boxes of GPUs...", "💰 Checking spot prices...", "📊 Analyzing interruption rates..."}
	} else {
		messages = []string{"🎉 Found some great GPUs!", "✨ Preparing your results..."}
	}
	msgIdx := (a.loadingFrame / 8) % len(messages)
	msgStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("245")).Italic(true)
	b.WriteString(centerText(msgStyle.Render(messages[msgIdx]), a.width))

	return b.String()
}

// centerText centers text within a given width
func centerText(text string, width int) string {
	textLen := lipgloss.Width(text)
	if textLen >= width {
		return text
	}
	padding := (width - textLen) / 2
	return strings.Repeat(" ", padding) + text
}

// renderTableView renders the main table view using the generic table component
func (a App) renderTableView() string {
	var b strings.Builder

	// Header
	header := a.styles.HeaderTitle.Render("🎮 GPU Hunter") + " " +
		a.styles.HeaderInfo.Render(fmt.Sprintf("Region: %s | %d instances", a.currentRegion, len(a.filteredInstances)))
	b.WriteString(a.styles.Header.Width(a.width).Render(header))
	b.WriteString("\n")

	// Status bar
	statusParts := []string{}
	if a.filterText != "" {
		statusParts = append(statusParts, a.styles.StatusFilter.Render(fmt.Sprintf("Filter: %s", a.filterText)))
	}
	if a.accelType != TypeAll {
		statusParts = append(statusParts, a.styles.StatusType.Render(fmt.Sprintf("Type: %s", a.accelType)))
	}
	if a.manufacturer != "" {
		statusParts = append(statusParts, a.styles.StatusType.Render(fmt.Sprintf("Mfr: %s", a.manufacturer)))
	}
	sortDir := "↑"
	if !a.sortAsc {
		sortDir = "↓"
	}
	statusParts = append(statusParts, a.styles.StatusSort.Render(fmt.Sprintf("Sort: %s %s", a.sortColumn, sortDir)))
	b.WriteString(a.styles.StatusBar.Render(strings.Join(statusParts, " | ")))
	b.WriteString("\n")

	// Table using generic table component
	b.WriteString(a.regionTable.Render())

	// Footer
	footer := a.styles.FooterKey.Render("↑↓") + a.styles.FooterDesc.Render(" nav  ") +
		a.styles.FooterKey.Render("Enter") + a.styles.FooterDesc.Render(" detail  ") +
		a.styles.FooterKey.Render("/") + a.styles.FooterDesc.Render(" filter  ") +
		a.styles.FooterKey.Render("s") + a.styles.FooterDesc.Render(" sort  ") +
		a.styles.FooterKey.Render("r") + a.styles.FooterDesc.Render(" region  ") +
		a.styles.FooterKey.Render("l") + a.styles.FooterDesc.Render(" lookup  ") +
		a.styles.FooterKey.Render("p") + a.styles.FooterDesc.Render(" probe  ") +
		a.styles.FooterKey.Render("?") + a.styles.FooterDesc.Render(" help  ") +
		a.styles.FooterKey.Render("q") + a.styles.FooterDesc.Render(" quit")
	b.WriteString(a.styles.Footer.Width(a.width).Render(footer))

	return b.String()
}

// renderLookupView renders the lookup view using the generic table component
func (a App) renderLookupView() string {
	var b strings.Builder

	if a.lookupResult == nil {
		return "No lookup result"
	}

	// Header with instance info
	header := a.styles.HeaderTitle.Render("🔍 Instance Lookup: " + a.lookupResult.InstanceType)
	b.WriteString(a.styles.Header.Width(a.width).Render(header))
	b.WriteString("\n")

	// Instance specs
	specs := fmt.Sprintf("%s %s × %d | %d GB | %d vCPU | %d GB RAM",
		a.lookupResult.AcceleratorType,
		a.lookupResult.AcceleratorName,
		a.lookupResult.AcceleratorCount,
		a.lookupResult.AcceleratorMemoryGB,
		a.lookupResult.VCPU,
		a.lookupResult.MemoryGB)
	b.WriteString(a.styles.StatusBar.Render(specs))
	b.WriteString("\n")

	// Table using generic table component
	b.WriteString(a.lookupTable.Render())

	// Footer
	footer := a.styles.FooterKey.Render("↑↓") + a.styles.FooterDesc.Render(" nav  ") +
		a.styles.FooterKey.Render("Esc") + a.styles.FooterDesc.Render(" back")
	b.WriteString(a.styles.Footer.Width(a.width).Render(footer))

	return b.String()
}

// renderAggregateView renders the aggregate lookup view using the generic table component
func (a App) renderAggregateView() string {
	var b strings.Builder

	// Header
	header := a.styles.HeaderTitle.Render("🔍 Multi-Instance Lookup")
	results := a.MultipleLookupResults()
	if len(results) > 0 {
		header += " " + a.styles.HeaderInfo.Render(fmt.Sprintf("(%d instance types)", len(results)))
	}
	b.WriteString(a.styles.Header.Width(a.width).Render(header))
	b.WriteString("\n")

	// Table using generic table component
	b.WriteString(a.aggregateTable.Render())

	// Footer
	footer := a.styles.FooterKey.Render("↑↓") + a.styles.FooterDesc.Render(" nav  ") +
		a.styles.FooterKey.Render("Esc") + a.styles.FooterDesc.Render(" back")
	b.WriteString(a.styles.Footer.Width(a.width).Render(footer))

	return b.String()
}

// renderProbeView renders the probe results view
func (a App) renderProbeView() string {
	var b strings.Builder

	results := a.ProbeResults()
	if results == nil {
		return "No probe results"
	}

	// Header
	header := a.styles.HeaderTitle.Render("🚀 Probe Results: " + results.InstanceType)
	b.WriteString(a.styles.Header.Width(a.width).Render(header))
	b.WriteString("\n")

	// Summary bar
	summaryStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
	summary := fmt.Sprintf("Capacity: %s | Regions: %d | Success: %d/%d",
		results.CapacityType,
		len(results.Regions),
		results.SuccessCount,
		results.TotalProbes)
	b.WriteString(summaryStyle.Render(summary))
	b.WriteString("\n\n")

	// Results
	passStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("42")).Bold(true)
	failStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("196")).Bold(true)
	regionStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("39"))
	capacityStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("245"))
	detailStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("250"))

	for _, r := range results.Results {
		var status string
		if r.Success {
			status = passStyle.Render("✓ PASS")
		} else {
			status = failStyle.Render("✗ FAIL")
		}

		line := fmt.Sprintf("%s %s %s %s",
			status,
			regionStyle.Render(r.Region),
			capacityStyle.Render(fmt.Sprintf("(%s)", r.CapacityType)),
			detailStyle.Render(r.Reason))
		b.WriteString(line)
		b.WriteString("\n")
	}

	// Footer
	b.WriteString("\n")
	footer := a.styles.FooterKey.Render("Esc") + a.styles.FooterDesc.Render(" back")
	b.WriteString(a.styles.Footer.Width(a.width).Render(footer))

	return b.String()
}

// renderMainMenuView renders the main menu
func (a App) renderMainMenuView() string {
	var b strings.Builder

	// Header
	title := a.styles.HelpTitle.Render("🎮 GPU Hunter")
	b.WriteString(title)
	b.WriteString("\n\n")

	subtitle := lipgloss.NewStyle().Foreground(lipgloss.Color("245")).Render("What would you like to do?")
	b.WriteString(subtitle)
	b.WriteString("\n\n")

	// Menu options
	options := []struct {
		emoji string
		label string
		desc  string
	}{
		{"🌍", "Browse by Region", "Explore GPU instances in a specific AWS region"},
		{"🔍", "Lookup Instance", "Search for an instance type across all regions"},
		{"🚀", "Probe Capacity", "Test actual capacity by launching instances"},
	}

	for i, opt := range options {
		style := a.styles.RegionItem
		if i == a.mainMenuCursor {
			style = a.styles.RegionSelected
		}
		line := fmt.Sprintf("%s  %s", opt.emoji, opt.label)
		b.WriteString(style.Render(line))
		b.WriteString("\n")
		if i == a.mainMenuCursor {
			descStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("245")).Italic(true).PaddingLeft(4)
			b.WriteString(descStyle.Render(opt.desc))
			b.WriteString("\n")
		}
	}

	b.WriteString("\n")
	footer := a.styles.FooterKey.Render("↑↓") + a.styles.FooterDesc.Render(" select  ") +
		a.styles.FooterKey.Render("Enter") + a.styles.FooterDesc.Render(" confirm  ") +
		a.styles.FooterKey.Render("q") + a.styles.FooterDesc.Render(" quit")
	b.WriteString(footer)

	return a.styles.RegionList.Render(b.String())
}

// renderProbeInputView renders the probe input
func (a App) renderProbeInputView() string {
	var b strings.Builder

	title := a.styles.FilterPrompt.Render("🚀 Probe instance type: ")
	b.WriteString(title)
	b.WriteString(a.probeInput.View())
	b.WriteString("\n")
	b.WriteString(a.styles.FooterDesc.Render("Enter instance type (e.g., g5.xlarge) to probe capacity across all regions"))

	return a.styles.Filter.Render(b.String())
}

// renderDetailView renders the detail view for a selected instance
func (a App) renderDetailView() string {
	inst := a.SelectedInstance()
	if inst == nil {
		return "No instance selected"
	}

	var b strings.Builder

	title := a.styles.DetailTitle.Render("📋 Instance Details: " + inst.InstanceType)
	b.WriteString(title)
	b.WriteString("\n\n")

	// Details
	details := []struct{ label, value string }{
		{"Type", inst.AcceleratorType},
		{"Accelerator", inst.AcceleratorName},
		{"Count", fmt.Sprintf("%d", inst.AcceleratorCount)},
		{"Memory", fmt.Sprintf("%d GB", inst.AcceleratorMemoryGB)},
		{"Manufacturer", inst.Manufacturer},
		{"vCPU", fmt.Sprintf("%d", inst.VCPU)},
		{"Instance Memory", fmt.Sprintf("%d GB", inst.MemoryGB)},
		{"Spot Price", fmt.Sprintf("$%.4f/hr", inst.SpotPrice)},
		{"On-Demand Price", fmt.Sprintf("$%.4f/hr", inst.OnDemandPrice)},
		{"Savings", fmt.Sprintf("%d%%", inst.SavingsPercent)},
		{"Interruption Rate", inst.InterruptionRate},
		{"Spot Score", fmt.Sprintf("%d/10", inst.SpotScore)},
		{"Available Zones", fmt.Sprintf("%d (%s)", inst.ZoneCount, strings.Join(inst.AvailableZones, ", "))},
	}

	for _, d := range details {
		line := a.styles.DetailLabel.Render(d.label+":") + " " + a.styles.DetailValue.Render(d.value)
		b.WriteString(line)
		b.WriteString("\n")
	}

	b.WriteString("\n")
	footer := a.styles.FooterKey.Render("Esc") + a.styles.FooterDesc.Render(" back")
	b.WriteString(footer)

	return a.styles.Detail.Render(b.String())
}

// renderRegionSelector renders the region selection view
func (a App) renderRegionSelector() string {
	var b strings.Builder

	title := a.styles.HelpTitle.Render("🌍 Select Region")
	b.WriteString(title)
	b.WriteString("\n\n")

	for i, region := range a.regions {
		style := a.styles.RegionItem
		if i == a.regionCursor {
			style = a.styles.RegionSelected
		}
		b.WriteString(style.Render(region))
		b.WriteString("\n")
	}

	b.WriteString("\n")
	footer := a.styles.FooterKey.Render("↑↓") + a.styles.FooterDesc.Render(" select  ") +
		a.styles.FooterKey.Render("Enter") + a.styles.FooterDesc.Render(" confirm  ") +
		a.styles.FooterKey.Render("Esc") + a.styles.FooterDesc.Render(" cancel")
	b.WriteString(footer)

	return a.styles.RegionList.Render(b.String())
}

// renderHelpView renders the help overlay
func (a App) renderHelpView() string {
	var b strings.Builder

	title := a.styles.HelpTitle.Render("⌨️  Keyboard Shortcuts")
	b.WriteString(title)
	b.WriteString("\n\n")

	sections := []struct {
		title string
		keys  []struct{ key, desc string }
	}{
		{
			title: "Navigation",
			keys: []struct{ key, desc string }{
				{"↑/↓, j/k", "Move up/down"},
				{"PgUp/PgDn", "Page up/down"},
				{"Home/End", "Go to top/bottom"},
				{"Enter", "View details"},
			},
		},
		{
			title: "Filtering & Sorting",
			keys: []struct{ key, desc string }{
				{"/", "Filter instances"},
				{"Esc", "Clear filter"},
				{"s", "Cycle sort column"},
				{"S", "Toggle sort direction"},
				{"1-5", "Sort by specific column"},
			},
		},
		{
			title: "Views",
			keys: []struct{ key, desc string }{
				{"r", "Change region"},
				{"l", "Lookup instance globally"},
				{"t", "Toggle GPU/Neuron"},
				{"w", "Toggle wide mode"},
				{"c", "Toggle spot scores"},
			},
		},
		{
			title: "Other",
			keys: []struct{ key, desc string }{
				{"R", "Refresh data"},
				{"?", "Toggle help"},
				{"q", "Quit"},
			},
		},
	}

	for _, section := range sections {
		b.WriteString(a.styles.HelpSection.Render(section.title))
		b.WriteString("\n")
		for _, k := range section.keys {
			b.WriteString(a.styles.HelpKey.Render(k.key))
			b.WriteString(a.styles.HelpDesc.Render(k.desc))
			b.WriteString("\n")
		}
		b.WriteString("\n")
	}

	footer := a.styles.FooterKey.Render("Esc/?") + a.styles.FooterDesc.Render(" close help")
	b.WriteString(footer)

	return a.styles.Help.Render(b.String())
}

// renderFilterView renders the filter input
func (a App) renderFilterView() string {
	var b strings.Builder

	prompt := a.styles.FilterPrompt.Render(fmt.Sprintf("Filter by %s: ", a.filterColumn))
	b.WriteString(prompt)
	b.WriteString(a.filterInput.View())
	b.WriteString("\n")
	b.WriteString(a.styles.FooterDesc.Render("Tab to change column, Enter to apply, Esc to cancel"))

	return a.styles.Filter.Render(b.String())
}

// renderLookupInputView renders the lookup input
func (a App) renderLookupInputView() string {
	var b strings.Builder

	title := a.styles.FilterPrompt.Render("🔍 Lookup instance type: ")
	b.WriteString(title)
	b.WriteString(a.lookupInput.View())
	b.WriteString("\n")
	b.WriteString(a.styles.FooterDesc.Render("Enter full type (p4d.24xlarge) or prefix (p4d) to search"))

	return a.styles.Filter.Render(b.String())
}

// renderInstanceSelectView renders the instance type selection view
func (a App) renderInstanceSelectView() string {
	var b strings.Builder

	title := a.styles.HelpTitle.Render(fmt.Sprintf("📋 Select %s.* Instance Type", a.instanceSelectPrefix))
	b.WriteString(title)
	b.WriteString("\n\n")

	// "All" option
	style := a.styles.RegionItem
	if a.instanceSelectCursor == 0 {
		style = a.styles.RegionSelected
	}
	b.WriteString(style.Render(fmt.Sprintf("[ ALL ] - Lookup all %d instance types", len(a.instanceTypeOptions))))
	b.WriteString("\n")

	// Individual options
	for i, opt := range a.instanceTypeOptions {
		style := a.styles.RegionItem
		if i+1 == a.instanceSelectCursor {
			style = a.styles.RegionSelected
		}
		b.WriteString(style.Render(opt))
		b.WriteString("\n")
	}

	b.WriteString("\n")
	footer := a.styles.FooterKey.Render("↑↓") + a.styles.FooterDesc.Render(" select  ") +
		a.styles.FooterKey.Render("Enter") + a.styles.FooterDesc.Render(" confirm  ") +
		a.styles.FooterKey.Render("Esc") + a.styles.FooterDesc.Render(" cancel")
	b.WriteString(footer)

	return a.styles.RegionList.Render(b.String())
}

// StartLoading starts the loading state with a message
func (a *App) StartLoading(msg string) tea.Cmd {
	a.SetLoading(true, msg)
	return tea.Batch(a.spinner.Tick, a.fetchData())
}

// Unused import fix
var _ = time.Now
