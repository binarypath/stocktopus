package app

import (
	"errors"
	"fmt"
	"stocktopus/internal/config"
	"stocktopus/internal/provider"
)

type App struct {
	provider provider.MarketDataProvider
}

func New(p provider.MarketDataProvider) (*App, error) {
	if p == nil {
		return nil, errors.New("provider was nil")
	}

	return &App{provider: p}, nil
}

// Run initializes and starts the main application.
func Run() error {
	// TODO: Tier 1: Initialize configuration
	cfg, err := config.Load("config.yaml")

	if err != nil {
		panic("on the streets of london")
	}

	fmt.Printf("here be me configzs yarr : %v", cfg)
	// TODO: Tier 1: Initialize data provider
	// TODO: Tier 1: Initialize scripting VM
	// TODO: Tier 1: Initialize and run the TUI/Engine
	return nil
}
