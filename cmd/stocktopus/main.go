package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"stocktopus/internal/config"
	"stocktopus/internal/engine"
	"stocktopus/internal/provider"
)

func main() {
	fmt.Println("Starting Stocktopus...")

	// Load configuration
	cfg, err := config.Load("")
	if err != nil {
		fmt.Printf("Failed to load config: %v\n", err)
		os.Exit(1)
	}

	// Create provider from registry using config
	// TODO: Get provider name and config from cfg
	// For now, use a placeholder to make it compile
	_ = cfg // TODO: Use cfg to get provider name and build provider config
	providerName := "polygon" // TODO: Read from config
	providerConfig := struct{}{} // TODO: Build from config

	p, err := provider.Create(providerName, providerConfig)
	if err != nil {
		fmt.Printf("Failed to create provider: %v\n", err)
		os.Exit(1)
	}

	// TODO: Wrap provider with middleware (rate limit, retry, circuit breaker, observability)

	// Health check with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := p.HealthCheck(ctx); err != nil {
		fmt.Printf("Provider health check failed: %v\n", err)
		os.Exit(1)
	}

	// Log active provider
	slog.Info("provider initialized", "name", p.Name())

	// Initialize engine with provider
	_ = engine.New(p)

	// TODO: Initialize TUI and start application loop
	fmt.Println("Provider initialized successfully. Ready to run (TUI not implemented yet).")
}
