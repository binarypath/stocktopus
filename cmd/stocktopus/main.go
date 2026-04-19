package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"stocktopus/internal/hub"
	"stocktopus/internal/news"
	"stocktopus/internal/poller"
	"stocktopus/internal/provider"
	"stocktopus/internal/provider/alphavantage"
	"stocktopus/internal/provider/financialmodelingprep"
	"stocktopus/internal/provider/polygon"
	"stocktopus/internal/server"
)

func main() {
	// Debug broadcaster captures all logs for the /debug console
	debug := server.NewDebugBroadcaster()
	debugWriter := &server.DebugLogWriter{Debug: debug}

	handler := slog.NewTextHandler(debugWriter, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	})
	logger := slog.New(handler)
	slog.SetDefault(logger)

	// Create provider
	apiKey := os.Getenv("STOCK_API_KEY")
	providerName := os.Getenv("STOCK_PROVIDER")
	if providerName == "" {
		providerName = "fmp"
	}

	p, err := createProvider(providerName, apiKey)
	if err != nil {
		slog.Error("failed to create provider", "provider", providerName, "error", err)
		os.Exit(1)
	}

	// Health check
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := p.HealthCheck(ctx); err != nil {
		slog.Warn("provider health check failed (continuing anyway)", "error", err)
	} else {
		slog.Info("provider ready", "name", p.Name())
	}

	// Hub
	h := hub.New(logger)
	go h.Run()

	// Poller
	interval := 15 * time.Second
	poll := poller.New(p, h, interval, logger)

	appCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go poll.Run(appCtx)

	// Server
	// News client
	newsClient := news.New(apiKey, "https://financialmodelingprep.com")

	srv, err := server.New(server.Config{Port: 8080, Host: "localhost"}, h, debug, poll, newsClient, logger)
	if err != nil {
		slog.Error("failed to create server", "error", err)
		os.Exit(1)
	}

	go func() {
		if err := srv.Start(); err != nil {
			slog.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	<-appCtx.Done()
	slog.Info("shutdown signal received")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown error", "error", err)
		os.Exit(1)
	}

	slog.Info("server stopped")
}

func createProvider(name, apiKey string) (provider.StockProvider, error) {
	switch name {
	case "fmp":
		return provider.Create("fmp", financialmodelingprep.Config{
			APIKey:  apiKey,
			Timeout: 30 * time.Second,
		})
	case "polygon":
		return provider.Create("polygon", polygon.Config{
			APIKey:  apiKey,
			Timeout: 30 * time.Second,
			Options: map[string]string{"adjusted": "true"},
		})
	case "alphavantage":
		return provider.Create("alphavantage", alphavantage.Config{
			APIKey:  apiKey,
			Timeout: 30 * time.Second,
		})
	default:
		return provider.Create(name, nil)
	}
}
