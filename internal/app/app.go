package app

import (
	"stocktopus/internal/provider"
)

type App struct {
	provider provider.StockProvider
}

func New(p provider.StockProvider) *App {
	return &App{provider: p}
}
