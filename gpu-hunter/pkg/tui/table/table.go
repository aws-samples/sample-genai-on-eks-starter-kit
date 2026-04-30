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

package table

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/gpu-hunter/pkg/models"
)

// Column defines a table column with its properties
type Column struct {
	Header    string
	MinWidth  int
	Weight    float64 // Relative weight for width distribution
	Getter    func(row models.InstanceRegionData) string
	StyleFunc func(value string, selected bool, styles *Styles) lipgloss.Style
}

// Styles holds the table styling configuration
type Styles struct {
	Header      lipgloss.Style
	HeaderCell  lipgloss.Style
	Row         lipgloss.Style
	RowAlt      lipgloss.Style
	Selected    lipgloss.Style
	Price       lipgloss.Style
	Savings     lipgloss.Style
	TypeGPU     lipgloss.Style
	TypeNeuron  lipgloss.Style
	InterruptLow    lipgloss.Style
	InterruptMedium lipgloss.Style
	InterruptHigh   lipgloss.Style
}

// DefaultStyles returns default table styles
func DefaultStyles() *Styles {
	return &Styles{
		Header: lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#E5E7EB")).
			Background(lipgloss.Color("#374151")).
			Padding(0, 1),
		HeaderCell: lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#E5E7EB")).
			Padding(0, 1),
		Row: lipgloss.NewStyle().
			Foreground(lipgloss.Color("#E5E7EB")).
			Padding(0, 1),
		RowAlt: lipgloss.NewStyle().
			Foreground(lipgloss.Color("#E5E7EB")).
			Background(lipgloss.Color("#111827")).
			Padding(0, 1),
		Selected: lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("#FFFFFF")).
			Background(lipgloss.Color("#7C3AED")).
			Padding(0, 1),
		Price: lipgloss.NewStyle().
			Foreground(lipgloss.Color("#10B981")).
			Padding(0, 1),
		Savings: lipgloss.NewStyle().
			Foreground(lipgloss.Color("#10B981")).
			Padding(0, 1),
		TypeGPU: lipgloss.NewStyle().
			Foreground(lipgloss.Color("#8B5CF6")).
			Padding(0, 1),
		TypeNeuron: lipgloss.NewStyle().
			Foreground(lipgloss.Color("#06B6D4")).
			Padding(0, 1),
		InterruptLow: lipgloss.NewStyle().
			Foreground(lipgloss.Color("#10B981")).
			Padding(0, 1),
		InterruptMedium: lipgloss.NewStyle().
			Foreground(lipgloss.Color("#F97316")).
			Padding(0, 1),
		InterruptHigh: lipgloss.NewStyle().
			Foreground(lipgloss.Color("#EF4444")).
			Padding(0, 1),
	}
}

// Table represents a generic table renderer
type Table struct {
	columns     []Column
	data        []models.InstanceRegionData
	cursor      int
	offset      int
	visibleRows int
	width       int
	styles      *Styles
}

// New creates a new table with the given columns
func New(columns []Column) *Table {
	return &Table{
		columns:     columns,
		data:        []models.InstanceRegionData{},
		cursor:      0,
		offset:      0,
		visibleRows: 20,
		width:       120,
		styles:      DefaultStyles(),
	}
}

// SetData sets the table data
func (t *Table) SetData(data []models.InstanceRegionData) {
	t.data = data
	if t.cursor >= len(t.data) {
		t.cursor = max(0, len(t.data)-1)
	}
}

// SetSize sets the table dimensions
func (t *Table) SetSize(width, visibleRows int) {
	t.width = width
	t.visibleRows = visibleRows
}

// SetStyles sets custom styles
func (t *Table) SetStyles(styles *Styles) {
	t.styles = styles
}

// SetCursor sets the cursor position
func (t *Table) SetCursor(cursor int) {
	t.cursor = cursor
	t.adjustOffset()
}

// SetOffset sets the scroll offset
func (t *Table) SetOffset(offset int) {
	t.offset = offset
}

// Cursor returns the current cursor position
func (t *Table) Cursor() int {
	return t.cursor
}

// Offset returns the current scroll offset
func (t *Table) Offset() int {
	return t.offset
}

// Data returns the table data
func (t *Table) Data() []models.InstanceRegionData {
	return t.data
}

// SelectedRow returns the currently selected row, or nil if none
func (t *Table) SelectedRow() *models.InstanceRegionData {
	if t.cursor >= 0 && t.cursor < len(t.data) {
		return &t.data[t.cursor]
	}
	return nil
}

// MoveUp moves the cursor up
func (t *Table) MoveUp() {
	if t.cursor > 0 {
		t.cursor--
		t.adjustOffset()
	}
}

// MoveDown moves the cursor down
func (t *Table) MoveDown() {
	if t.cursor < len(t.data)-1 {
		t.cursor++
		t.adjustOffset()
	}
}

// PageUp moves up by a page
func (t *Table) PageUp() {
	t.cursor -= t.visibleRows
	if t.cursor < 0 {
		t.cursor = 0
	}
	t.offset = t.cursor
}

// PageDown moves down by a page
func (t *Table) PageDown() {
	t.cursor += t.visibleRows
	if t.cursor >= len(t.data) {
		t.cursor = len(t.data) - 1
	}
	if t.cursor < 0 {
		t.cursor = 0
	}
	t.offset = t.cursor - t.visibleRows + 1
	if t.offset < 0 {
		t.offset = 0
	}
}

// GoToTop moves to the first row
func (t *Table) GoToTop() {
	t.cursor = 0
	t.offset = 0
}

// GoToBottom moves to the last row
func (t *Table) GoToBottom() {
	t.cursor = len(t.data) - 1
	if t.cursor < 0 {
		t.cursor = 0
	}
	t.offset = t.cursor - t.visibleRows + 1
	if t.offset < 0 {
		t.offset = 0
	}
}

// adjustOffset ensures the cursor is visible
func (t *Table) adjustOffset() {
	if t.cursor < t.offset {
		t.offset = t.cursor
	}
	if t.cursor >= t.offset+t.visibleRows {
		t.offset = t.cursor - t.visibleRows + 1
	}
}

// calculateColumnWidths calculates column widths based on available space
func (t *Table) calculateColumnWidths() []int {
	numCols := len(t.columns)
	if numCols == 0 {
		return nil
	}

	// Calculate total weight
	totalWeight := 0.0
	for _, col := range t.columns {
		totalWeight += col.Weight
	}

	// Available width (terminal width minus spacing between columns)
	spacing := numCols - 1
	availableWidth := t.width - spacing - 2 // -2 for margins

	if availableWidth < 80 {
		availableWidth = 80
	}

	// Calculate widths proportionally
	widths := make([]int, numCols)
	for i, col := range t.columns {
		widths[i] = int(float64(availableWidth) * col.Weight / totalWeight)
		if widths[i] < col.MinWidth {
			widths[i] = col.MinWidth
		}
	}

	return widths
}

// Render renders the table as a string
func (t *Table) Render() string {
	if len(t.data) == 0 {
		return t.styles.Row.Render("No data to display.")
	}

	var b strings.Builder
	widths := t.calculateColumnWidths()

	// Render header
	b.WriteString(t.renderHeader(widths))
	b.WriteString("\n")

	// Render visible rows
	endIdx := t.offset + t.visibleRows
	if endIdx > len(t.data) {
		endIdx = len(t.data)
	}

	for i := t.offset; i < endIdx; i++ {
		row := t.data[i]
		isSelected := i == t.cursor
		isAlt := i%2 == 1
		b.WriteString(t.renderRow(row, widths, isSelected, isAlt))
		b.WriteString("\n")
	}

	// Scroll indicator
	if len(t.data) > t.visibleRows {
		scrollInfo := fmt.Sprintf(" [%d-%d of %d] ", t.offset+1, endIdx, len(t.data))
		b.WriteString(lipgloss.NewStyle().Foreground(lipgloss.Color("241")).Render(scrollInfo))
		b.WriteString("\n")
	}

	return b.String()
}

// renderHeader renders the table header
func (t *Table) renderHeader(widths []int) string {
	var cells []string
	for i, col := range t.columns {
		width := widths[i]
		header := col.Header
		if len(header) > width {
			header = header[:width-1] + "…"
		}
		cell := t.styles.HeaderCell.Width(width).Render(header)
		cells = append(cells, cell)
	}
	return t.styles.Header.Render(strings.Join(cells, " "))
}

// renderRow renders a single table row
func (t *Table) renderRow(row models.InstanceRegionData, widths []int, selected bool, alt bool) string {
	var cells []string
	for i, col := range t.columns {
		width := widths[i]
		value := col.Getter(row)

		// Truncate if needed
		if len(value) > width {
			value = value[:width-1] + "…"
		}

		// Determine style
		var style lipgloss.Style
		if selected {
			style = t.styles.Selected.Width(width)
		} else if col.StyleFunc != nil {
			style = col.StyleFunc(value, selected, t.styles).Width(width)
		} else if alt {
			style = t.styles.RowAlt.Width(width)
		} else {
			style = t.styles.Row.Width(width)
		}

		cells = append(cells, style.Render(value))
	}
	return strings.Join(cells, " ")
}

// Helper functions

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// InterruptStyle returns the appropriate style for an interruption rate
func InterruptStyle(rate string, selected bool, styles *Styles) lipgloss.Style {
	if selected {
		return styles.Selected
	}
	switch rate {
	case "<5%", "5-10%":
		return styles.InterruptLow
	case "10-15%", "15-20%":
		return styles.InterruptMedium
	default:
		return styles.InterruptHigh
	}
}

// TypeStyle returns the appropriate style for instance type (GPU/Neuron)
func TypeStyle(instanceType string, selected bool, styles *Styles) lipgloss.Style {
	if selected {
		return styles.Selected
	}
	if instanceType == "Neuron" {
		return styles.TypeNeuron
	}
	return styles.TypeGPU
}

// PriceStyle returns the price style
func PriceStyle(value string, selected bool, styles *Styles) lipgloss.Style {
	if selected {
		return styles.Selected
	}
	return styles.Price
}

// SavingsStyle returns the savings style
func SavingsStyle(value string, selected bool, styles *Styles) lipgloss.Style {
	if selected {
		return styles.Selected
	}
	return styles.Savings
}