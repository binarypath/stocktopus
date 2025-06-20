package main

import (
	"fmt"

	"stocktopus/internal/config"
	"stocktopus/internal/provider"
	"stocktopus/internal/screener"
)

func main() {
	fmt.Println("Starting Stocktopus...")

	// Load configuration
	cfg := config.Load()

	// Initialize a data provider. We start with the mock provider.
	// In the future, we could choose a provider based on the config.
	provider := provider.NewMockProvider()

	// Initialize the screener with the chosen provider and config
	appScreener := screener.New(cfg, provider)

	// Run the screener
	// This will be a blocking call that starts the main application loop.
	if err := appScreener.Run(); err != nil {
		fmt.Printf("Application error: %v\n", err)
	}
}
