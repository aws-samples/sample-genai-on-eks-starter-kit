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

import "github.com/charmbracelet/bubbles/key"

// KeyMap defines all the key bindings for the application
type KeyMap struct {
	// Navigation
	Up       key.Binding
	Down     key.Binding
	PageUp   key.Binding
	PageDown key.Binding
	Home     key.Binding
	End      key.Binding

	// Actions
	Enter  key.Binding
	Escape key.Binding
	Quit   key.Binding

	// Features
	Filter        key.Binding
	ClearFilter   key.Binding
	FilterColumn  key.Binding // Tab to cycle filter columns
	Sort          key.Binding
	SortDirection key.Binding // Toggle ascending/descending
	SortPrice     key.Binding
	SortScore     key.Binding
	SortInterrupt key.Binding
	SortSavings   key.Binding
	SortName      key.Binding
	Region        key.Binding
	TypeToggle    key.Binding
	Refresh       key.Binding
	Help          key.Binding
	Wide          key.Binding
	SpotScore     key.Binding
	Lookup        key.Binding // Lookup instance across all regions
	Probe         key.Binding // Probe capacity by launching instance

	// Manufacturer filters
	FilterNvidia key.Binding
	FilterAMD    key.Binding
	FilterAll    key.Binding
}

// DefaultKeyMap returns the default key bindings
func DefaultKeyMap() KeyMap {
	return KeyMap{
		// Navigation
		Up: key.NewBinding(
			key.WithKeys("up", "k"),
			key.WithHelp("↑/k", "up"),
		),
		Down: key.NewBinding(
			key.WithKeys("down", "j"),
			key.WithHelp("↓/j", "down"),
		),
		PageUp: key.NewBinding(
			key.WithKeys("pgup", "ctrl+u"),
			key.WithHelp("pgup", "page up"),
		),
		PageDown: key.NewBinding(
			key.WithKeys("pgdown", "ctrl+d"),
			key.WithHelp("pgdn", "page down"),
		),
		Home: key.NewBinding(
			key.WithKeys("home", "g"),
			key.WithHelp("home/g", "go to top"),
		),
		End: key.NewBinding(
			key.WithKeys("end", "G"),
			key.WithHelp("end/G", "go to bottom"),
		),

		// Actions
		Enter: key.NewBinding(
			key.WithKeys("enter"),
			key.WithHelp("enter", "view details"),
		),
		Escape: key.NewBinding(
			key.WithKeys("esc"),
			key.WithHelp("esc", "back/cancel"),
		),
		Quit: key.NewBinding(
			key.WithKeys("q", "ctrl+c"),
			key.WithHelp("q", "quit"),
		),

		// Features
		Filter: key.NewBinding(
			key.WithKeys("/"),
			key.WithHelp("/", "filter"),
		),
		ClearFilter: key.NewBinding(
			key.WithKeys("ctrl+u"),
			key.WithHelp("ctrl+u", "clear filter"),
		),
		Sort: key.NewBinding(
			key.WithKeys("s"),
			key.WithHelp("s", "cycle sort"),
		),
		SortPrice: key.NewBinding(
			key.WithKeys("P"),
			key.WithHelp("P", "sort by price"),
		),
		SortScore: key.NewBinding(
			key.WithKeys("S"),
			key.WithHelp("S", "sort by score"),
		),
		SortInterrupt: key.NewBinding(
			key.WithKeys("I"),
			key.WithHelp("I", "sort by interrupt"),
		),
		SortSavings: key.NewBinding(
			key.WithKeys("$"),
			key.WithHelp("$", "sort by savings"),
		),
		SortName: key.NewBinding(
			key.WithKeys("N"),
			key.WithHelp("N", "sort by name"),
		),
		Region: key.NewBinding(
			key.WithKeys("r"),
			key.WithHelp("r", "select region"),
		),
		TypeToggle: key.NewBinding(
			key.WithKeys("t"),
			key.WithHelp("t", "toggle type"),
		),
		Refresh: key.NewBinding(
			key.WithKeys("R", "ctrl+r"),
			key.WithHelp("R", "refresh"),
		),
		Help: key.NewBinding(
			key.WithKeys("?"),
			key.WithHelp("?", "help"),
		),
		Wide: key.NewBinding(
			key.WithKeys("w"),
			key.WithHelp("w", "wide mode"),
		),
		SpotScore: key.NewBinding(
			key.WithKeys("c"),
			key.WithHelp("c", "toggle spot scores"),
		),
		Lookup: key.NewBinding(
			key.WithKeys("l"),
			key.WithHelp("l", "lookup across regions"),
		),
		Probe: key.NewBinding(
			key.WithKeys("p"),
			key.WithHelp("p", "probe capacity"),
		),
		FilterColumn: key.NewBinding(
			key.WithKeys("tab"),
			key.WithHelp("tab", "cycle filter column"),
		),
		SortDirection: key.NewBinding(
			key.WithKeys("d"),
			key.WithHelp("d", "toggle sort direction"),
		),

		// Manufacturer filters
		FilterNvidia: key.NewBinding(
			key.WithKeys("1"),
			key.WithHelp("1", "NVIDIA only"),
		),
		FilterAMD: key.NewBinding(
			key.WithKeys("2"),
			key.WithHelp("2", "AMD only"),
		),
		FilterAll: key.NewBinding(
			key.WithKeys("0"),
			key.WithHelp("0", "all manufacturers"),
		),
	}
}

// ShortHelp returns keybindings to be shown in the mini help view
func (k KeyMap) ShortHelp() []key.Binding {
	return []key.Binding{
		k.Filter,
		k.Sort,
		k.Region,
		k.TypeToggle,
		k.Help,
		k.Quit,
	}
}

// FullHelp returns keybindings for the expanded help view
func (k KeyMap) FullHelp() [][]key.Binding {
	return [][]key.Binding{
		// Navigation
		{k.Up, k.Down, k.PageUp, k.PageDown, k.Home, k.End},
		// Actions
		{k.Enter, k.Escape, k.Quit},
		// Features
		{k.Filter, k.ClearFilter, k.Sort, k.Region, k.TypeToggle, k.Refresh},
		// Sorting
		{k.SortPrice, k.SortScore, k.SortInterrupt, k.SortSavings, k.SortName},
		// Filters
		{k.FilterNvidia, k.FilterAMD, k.FilterAll, k.Wide, k.SpotScore, k.Lookup},
	}
}

// HelpSections returns help organized by section for the help overlay
func (k KeyMap) HelpSections() []HelpSection {
	return []HelpSection{
		{
			Title: "Navigation",
			Keys: []HelpKey{
				{Key: "↑/k", Desc: "Move up"},
				{Key: "↓/j", Desc: "Move down"},
				{Key: "pgup/ctrl+u", Desc: "Page up"},
				{Key: "pgdn/ctrl+d", Desc: "Page down"},
				{Key: "home/g", Desc: "Go to top"},
				{Key: "end/G", Desc: "Go to bottom"},
				{Key: "enter", Desc: "View instance details"},
				{Key: "esc", Desc: "Back / Cancel"},
			},
		},
		{
			Title: "Filtering",
			Keys: []HelpKey{
				{Key: "/", Desc: "Open filter"},
				{Key: "tab", Desc: "Cycle filter column (in filter mode)"},
				{Key: "ctrl+u", Desc: "Clear filter"},
				{Key: "t", Desc: "Toggle GPU/Neuron/All"},
				{Key: "1", Desc: "NVIDIA only"},
				{Key: "2", Desc: "AMD only"},
				{Key: "0", Desc: "All manufacturers"},
			},
		},
		{
			Title: "Sorting",
			Keys: []HelpKey{
				{Key: "s", Desc: "Cycle sort column"},
				{Key: "d", Desc: "Toggle sort direction (asc/desc)"},
				{Key: "P", Desc: "Sort by price"},
				{Key: "S", Desc: "Sort by spot score"},
				{Key: "I", Desc: "Sort by interruption"},
				{Key: "$", Desc: "Sort by savings"},
				{Key: "N", Desc: "Sort by name"},
			},
		},
		{
			Title: "Display",
			Keys: []HelpKey{
				{Key: "r", Desc: "Select region"},
				{Key: "w", Desc: "Toggle wide mode"},
				{Key: "c", Desc: "Toggle spot scores"},
				{Key: "l", Desc: "Lookup across all regions"},
				{Key: "p", Desc: "Probe capacity (launch test)"},
				{Key: "R", Desc: "Refresh data"},
				{Key: "?", Desc: "Toggle help"},
				{Key: "q", Desc: "Quit"},
			},
		},
	}
}

// HelpSection represents a section in the help overlay
type HelpSection struct {
	Title string
	Keys  []HelpKey
}

// HelpKey represents a single key binding in help
type HelpKey struct {
	Key  string
	Desc string
}