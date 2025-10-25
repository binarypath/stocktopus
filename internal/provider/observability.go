package provider

import (
	"context"
	"log/slog"
	"stocktopus/internal/model"
	"time"
)

// ObservableProvider wraps a StockProvider with structured logging and metrics
// Logs all API calls with provider name, operation, symbol(s), duration, and errors
type ObservableProvider struct {
	provider StockProvider
	logger   *slog.Logger
}

// NewObservableProvider creates a provider wrapper with observability
func NewObservableProvider(provider StockProvider, logger *slog.Logger) *ObservableProvider {
	if logger == nil {
		logger = slog.Default()
	}

	return &ObservableProvider{
		provider: provider,
		logger:   logger.With(slog.String("provider", provider.Name())),
	}
}

// GetQuote implements StockProvider with logging
func (o *ObservableProvider) GetQuote(ctx context.Context, symbol string) (*model.Quote, error) {
	start := time.Now()

	o.logger.Debug("fetching quote",
		slog.String("operation", "GetQuote"),
		slog.String("symbol", symbol))

	quote, err := o.provider.GetQuote(ctx, symbol)
	duration := time.Since(start)

	if err != nil {
		o.logger.Error("failed to fetch quote",
			slog.String("operation", "GetQuote"),
			slog.String("symbol", symbol),
			slog.Duration("duration", duration),
			slog.Any("error", err))
		return nil, err
	}

	o.logger.Info("fetched quote",
		slog.String("operation", "GetQuote"),
		slog.String("symbol", symbol),
		slog.Duration("duration", duration),
		slog.Float64("price", quote.Price),
		slog.Int64("volume", quote.Volume))

	return quote, nil
}

// GetQuotes implements StockProvider with logging
func (o *ObservableProvider) GetQuotes(ctx context.Context, symbols []string) ([]*model.Quote, error) {
	start := time.Now()

	o.logger.Debug("fetching quotes",
		slog.String("operation", "GetQuotes"),
		slog.Int("count", len(symbols)),
		slog.Any("symbols", symbols))

	quotes, err := o.provider.GetQuotes(ctx, symbols)
	duration := time.Since(start)

	if err != nil {
		o.logger.Error("failed to fetch quotes",
			slog.String("operation", "GetQuotes"),
			slog.Int("count", len(symbols)),
			slog.Duration("duration", duration),
			slog.Any("error", err))
		return nil, err
	}

	// Count successful quotes
	successCount := 0
	for _, q := range quotes {
		if q != nil {
			successCount++
		}
	}

	o.logger.Info("fetched quotes",
		slog.String("operation", "GetQuotes"),
		slog.Int("requested", len(symbols)),
		slog.Int("received", successCount),
		slog.Duration("duration", duration))

	return quotes, nil
}

// Name implements StockProvider
func (o *ObservableProvider) Name() string {
	return o.provider.Name()
}

// HealthCheck implements StockProvider with logging
func (o *ObservableProvider) HealthCheck(ctx context.Context) error {
	start := time.Now()

	o.logger.Debug("checking provider health",
		slog.String("operation", "HealthCheck"))

	err := o.provider.HealthCheck(ctx)
	duration := time.Since(start)

	if err != nil {
		o.logger.Error("health check failed",
			slog.String("operation", "HealthCheck"),
			slog.Duration("duration", duration),
			slog.Any("error", err))
		return err
	}

	o.logger.Info("health check passed",
		slog.String("operation", "HealthCheck"),
		slog.Duration("duration", duration))

	return nil
}
