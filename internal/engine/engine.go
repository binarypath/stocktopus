package engine

import (
	"context"
	"stocktopus/internal/model"
	"stocktopus/internal/provider"
)

// Engine is the core event loop coordinator that manages stock screening
type Engine struct {
	provider provider.StockProvider
}

// New creates a new Engine instance with the given provider
func New(p provider.StockProvider) *Engine {
	return &Engine{
		provider: p,
	}
}

// FetchStocks fetches quotes for the given symbols using the configured provider
func (e *Engine) FetchStocks(ctx context.Context, symbols []string) ([]*model.Quote, error) {
	return e.provider.GetQuotes(ctx, symbols)
}
