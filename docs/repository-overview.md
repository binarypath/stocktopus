# Stocktopus Repository Overview

## What this project is
Stocktopus is a Bloomberg terminal-style stock monitoring web app.  
It serves HTML pages, pushes live quote/news updates over WebSockets, and pulls market data from Financial Modeling Prep (FMP).

## Core technologies
- **Backend:** Go (`net/http`, `http.ServeMux`, `log/slog`)
- **Realtime:** WebSockets via `github.com/coder/websocket`
- **Frontend:** Server-rendered HTML templates + vanilla JavaScript + CSS
- **Data provider:** FMP stable APIs (quotes, search, news, EOD chart data)
- **Testing:** Go unit tests, contract tests, and e2e smoke tests (`-tags e2e`)
- **CI:** GitHub Actions (`.github/workflows/go.yml`)

## High-level architecture
1. `cmd/stocktopus/main.go` wires dependencies (provider, hub, pollers, server).
2. `internal/server` exposes HTTP routes and WebSocket endpoints.
3. `internal/hub` manages pub/sub topics for connected clients.
4. `internal/poller` subscribes to quote topics and polls only active symbols.
5. `internal/newspoller` does the same pattern for news topics.
6. `internal/news` calls FMP for news/search/chart endpoints.
7. `internal/provider/*` implements quote providers behind one interface.

## How the codebase is organized
- `cmd/stocktopus/`  
  Entry point; startup, env-driven provider selection, graceful shutdown.

- `internal/server/`  
  HTTP server setup, route handlers, template rendering, static files, WebSocket handlers.

- `internal/hub/`  
  In-memory pub/sub broker for client subscriptions (`quote:*`, `news:*` topics).

- `internal/poller/`  
  Demand-based quote poller; fetches quotes for currently subscribed symbols and publishes HTML fragments.

- `internal/newspoller/`  
  Periodic news polling + publish mechanism for news topics.

- `internal/news/`  
  FMP client for:
  - security search (`/stable/search-symbol`, `/stable/search-name`)
  - news categories (`/stable/news/*`, `/stable/fmp-articles`)
  - historical EOD bars (`/stable/historical-price-eod/full`)

- `internal/provider/`  
  Provider abstraction (`StockProvider`) and registry/factory infrastructure.
  - Implementations: `financialmodelingprep/`, `polygon/`, `alphavantage/`

- `internal/model/`  
  Shared domain models (`Quote`, `NewsItem`, `OHLCV`).

- `tests/contract/`  
  Contract tests to verify provider implementations honor interface behavior.

- `tests/e2e/`  
  Smoke tests for routes, APIs, WebSocket behavior, and external provider integration.

- `docs/` and `worklog/`  
  Project notes, ideas, and development history.

## Runtime behavior in practice
- Browser requests pages/fragments from server routes.
- Browser opens `/ws` and subscribes to topics.
- Hub triggers pollers on first subscriber and stops on last unsubscribe.
- Pollers fetch data, format payloads, and publish to topic subscribers.
- Frontend updates view without full page reloads.

## Local commands and environment
- `make build` → build binary to `bin/stocktopus`
- `make dev` → build + run app
- `make test` → unit/integration tests
- `make smoke` → e2e smoke tests

Environment variables:
- `STOCK_API_KEY` (required for live data and smoke tests)
- `STOCK_PROVIDER` (defaults to `fmp`)
