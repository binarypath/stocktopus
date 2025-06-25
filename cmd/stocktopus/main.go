package main

import (
	"fmt"

	"stocktopus/internal/app"
	"stocktopus/internal/config"
	"stocktopus/internal/provider"
)

func main() {
	fmt.Println("Starting Stocktopus...")

	// Load configuration
	cfg, err := config.Load("")

	if err != nil {
		panic(err.Error)
	}

	p, err := provider.New(cfg)
	app, err := app.New(p)
	// Initialize a data provider. We start with the mock provider.
	// In the future, we could choose a provider based on the config.

	if err := app.Run(); err != nil {
		fmt.Printf("Application error: %v\n", err)
	}
}
