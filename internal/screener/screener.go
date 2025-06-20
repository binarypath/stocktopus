package screener

import (
	"fmt"
	"os"
	"os/exec"
	"time"

	"stocktopus/internal/config"
	"stocktopus/internal/model"
	"stocktopus/internal/provider"
)

// Screener is the main application struct.
type Screener struct {
	config   *config.Config
	provider provider.MarketDataProvider
}

// New creates a new screener instance.
func New(cfg *config.Config, p provider.MarketDataProvider) *Screener {
	return &Screener{
		config:   cfg,
		provider: p,
	}
}

// Run starts the main application loop.
func (s *Screener) Run() error {
	// Using a ticker for periodic refreshes based on our config
	ticker := time.NewTicker(s.config.RefreshInterval)
	defer ticker.Stop()

	// Initial run right away before the first tick
	if err := s.refresh(); err != nil {
		return err
	}

	// Main loop
	for range ticker.C {
		if err := s.refresh(); err != nil {
			// In a real app, you might want more robust error handling
			// For now, we just print the error and continue.
			fmt.Printf("Error during refresh: %v\n", err)
		}
	}

	return nil
}

// refresh fetches, filters, and displays the stock data.
func (s *Screener) refresh() error {
	//clearConsole()
	fmt.Printf("Fetching data... (Last updated: %s)\n", time.Now().Format("15:04:05"))

	stocks, err := s.provider.FetchStocks()
	if err != nil {
		fmt.Printf("In Refresh() Error getting stocks %+v\n", err)

		return err
	}

	// --- FILTERING LOGIC ---
	// For now, we'll just filter for high volume stocks as an example.
	var filteredStocks []model.Stock
	for _, stock := range stocks {
		if stock.Volume > 40_000_000 { // Hardcoded parameter
			filteredStocks = append(filteredStocks, stock)
		}
	}

	// --- DISPLAY LOGIC ---

	fmt.Println("---------------------------------------------------------")
	fmt.Printf("%-10s %-15s %-15s %-15s %-15s %-15s\n", "TICKER", "PRICE", "VOLUME", "CHANGE (1D %)", "HIGH", "LOW")
	fmt.Println("---------------------------------------------------------")

	for _, stock := range filteredStocks {
		fmt.Printf("%-10s %-15.2f %-15d %-15.2f %-15.2f %-15.2f n",
			stock.Ticker, stock.Price, stock.Volume, stock.Change_1D_pct, stock.High, stock.Low)
	}
	fmt.Println("---------------------------------------------------------")

	return nil
}

// clearConsole clears the terminal screen.
func clearConsole() {
	// This is a simple, cross-platform way to clear the console.
	// It might not work in all terminal emulators.
	cmd := exec.Command("cmd", "/c", "cls") // For Windows
	if os.PathSeparator == '/' {
		cmd = exec.Command("clear") // For Linux/macOS
	}
	cmd.Stdout = os.Stdout
	cmd.Run()
}

func filterStocks(stocks []model.Stock) []model.Stock {
	var filteredStocks []model.Stock

	// for is both an iterator and a while loop
	for _, stock := range stocks {
		if stock.Volume >= 40_000_000 { // Our hardcoded parameter
			filteredStocks = append(filteredStocks, stock)
		}
	}

	return filteredStocks
}
