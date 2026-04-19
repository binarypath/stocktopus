# stocktopus Development Guidelines

## Project Overview
Bloomberg terminal-style stock monitoring web app. Go backend with HTML/JS frontend, real-time WebSocket quotes, and FMP (Financial Modeling Prep) data provider.

## Technologies
- Go 1.23, net/http with ServeMux routing
- WebSocket via `github.com/coder/websocket`
- HTML templates with SPA fragment rendering (`X-Fragment: true` header)
- Vanilla JS (no frameworks), CSS
- FMP stable API for quotes, news, and search

## Project Structure
```
cmd/stocktopus/          # Entry point
internal/
  hub/                   # WebSocket pub-sub hub
  news/                  # FMP news + search client
  poller/                # Demand-based quote poller
  provider/              # Stock provider interface + FMP/Polygon/AlphaVantage implementations
  server/                # HTTP server, routes, templates, static assets
  model/                 # Data models (Quote, NewsItem, etc.)
tests/
  e2e/                   # E2E smoke tests (build tag: e2e)
  contract/              # Provider contract tests
worklog/                 # Development notes
```

## Commands
```
make build    # Build to bin/stocktopus
make dev      # Build and run
make test     # Unit tests (excludes e2e)
make smoke    # E2E smoke tests (requires STOCK_API_KEY)
make clean    # Remove bin/
```

## Environment Variables
- `STOCK_API_KEY` — FMP API key (required for dev and smoke tests)
- `STOCK_PROVIDER` — Provider name, defaults to "fmp"

## Code Style
- Go: follow standard conventions, `go fmt`, `go vet`
- JS: vanilla, no frameworks, IIFE pattern in terminal.js
- CSS: CSS custom properties, monospace terminal aesthetic

## Rules
- **No attribution** on commits or PRs — do not add Co-Authored-By lines
- **Always run `make smoke` before pushing** — verify nothing is broken
- UI uses the term "Security" (not "Symbol") in all user-facing text
- Internal Go code and WebSocket protocol still use "symbol" for data model fields
