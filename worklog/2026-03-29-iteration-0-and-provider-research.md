# Worklog: 2026-03-29 -- Iteration 0 Complete + Provider Research

## Iteration 0: Scaffolding -- DONE

### Built
- `internal/server/` -- HTTP server with Go 1.22 mux, template rendering, static files
- Templates: `layout.html` (nav, HTMX, dark CSS), `watchlist.html`, `stock.html`, `screener.html`, `feed.html`
- Vendored HTMX 2.0.4 + WebSocket extension into `internal/server/static/`
- Dark terminal theme CSS (green/red prices, monospace, dark backgrounds)
- `Makefile` with dev, build, test, clean targets
- Server tests: health endpoint, redirect, watchlist page rendering
- Graceful shutdown with SIGINT/SIGTERM handling

### Cleaned Up
- Deleted `internal/tui/` (empty Bubble Tea stub)
- Deleted `internal/vm/` (empty Lua VM stub)
- Deleted `internal/model/view.go` (legacy UI model referencing deleted Stock struct)
- Removed legacy `Stock` struct from `internal/model/stock.go`
- Removed legacy `MarketDataProvider` interface from `internal/provider/provider.go`
- Simplified `internal/app/app.go` (removed dead code, now uses StockProvider)
- Rewrote `cmd/stocktopus/main.go` to start HTTP server

### Verified
- `go build ./...` -- clean
- `go test ./...` -- all passing (including 3 new server tests)
- Server serves pages at localhost:8080, health returns JSON, all routes work

## Provider Research Results

### Recommendation: FMP as default provider ($14/mo Starter plan)

Covers all 4 Phase 1 data types from a single API key:
- Real-time quotes (not delayed on Starter)
- Historical OHLCV data
- Fundamentals (P/E, EPS, market cap, income statements, balance sheets)
- News (filterable by symbol)
- 300 calls/min rate limit

### No WebSocket on $14 plan
- WebSocket requires FMP $49+/mo
- Polling at 5-10s intervals is sufficient for Phase 1
- Can add Tiingo (free) for IEX WebSocket streaming later

### Other providers evaluated
- Polygon: $29/mo, great WebSocket, but fundamentals are thin on Starter
- Twelve Data: $29/mo, no news endpoint
- Alpha Vantage: $49.99/mo, no news, no WebSocket, gutted free tier
- Tiingo: ~$10/mo, no fundamentals, no news, but free IEX streaming
- IEX Cloud: effectively dead for new signups
- Alpaca: free but requires brokerage account, no fundamentals, no news
- Yahoo/yfinance: free but unofficial, unreliable, TOS issues

### BYOD strategy
- Ship FMP as default/recommended provider
- Support Polygon, Twelve Data as optional upgrades
- Users bring their own API keys

## Next Steps
- Iteration 1: WebSocket hub + live watchlist with real-time quote updates
