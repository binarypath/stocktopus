package model

import (
	"fmt"
	"strings"
)

// UiModel represents the UI state for displaying stock data
// LEGACY: This is deprecated - TUI package should handle view logic
type UiModel struct {
	stocks    []Stock // Using legacy Stock struct
	isLoading bool
	err       error
}

// View renders the UI model as a string
// LEGACY: This should be moved to TUI package
func (m UiModel) View() string {
	// If there's an error, just show that
	if m.err != nil {
		return fmt.Sprintf("Error: %v\n", m.err)
	}

	// If we're loading, show a loading message
	if m.isLoading {
		return "Scanning for stocks..."
	}

	// Loop through the stocks and build the string for our view
	var b strings.Builder
	b.WriteString("Matching Stocks:\n\n")
	for _, stock := range m.stocks {
		b.WriteString(fmt.Sprintf("  %s: %.2f\n", stock.Ticker, stock.Price))
	}
	b.WriteString("\nPress 'q' to quit.")

	return b.String()
}
