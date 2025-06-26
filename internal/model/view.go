package model

// UiModel holds the state for the terminal UI, including the list of stocks to display,
// loading state, and any error encountered.
type UiModel struct {
	stocks    []models.StockTick // List of stocks matching the screener criteria
	isLoading bool               // Indicates if data is currently being loaded
	err       error              // Holds any error encountered during processing
}

// View renders the current UI state as a string for display in the terminal.
func (m UiModel) View() string {
	// If there's an error, just show that
	if m.err != nil {
		return fmt.Sprintf("Error: %v\n", m.err)
	}

	// If we're loading, show a loading message
	if m.isLoading {
		return "Scanning for stocks..."
	}

	// Build the display string for the list of matching stocks
	var b strings.Builder
	b.WriteString("Matching Stocks:\n\n")
	for _, stock := range m.stocks {
		// Display each stock's ticker and price
		b.WriteString(fmt.Sprintf("  %s: %.2f\n", stock.Ticker, stock.Price))
	}
	b.WriteString("\nPress 'q' to quit.")

	return b.String()
}
