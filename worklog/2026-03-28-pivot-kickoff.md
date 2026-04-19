# Worklog: 2026-03-28 -- Pivot Kickoff

## Decision: Pivot to Open-Source Financial Terminal

Stocktopus is pivoting from a TUI-based stock screener to a web-based financial terminal -- "Bloomberg for the price of a retail data subscription."

## Key Decisions Made

### Architecture
- **Go backend** with WebSocket server for real-time data fan-out
- **Web frontend** (Svelte or Solid) -- fast, lightweight, no heavy frameworks
- **TradingView lightweight-charts** (or similar) for charting
- **WASM selectively** for client-side compute if needed later
- **Drop**: Bubble Tea TUI, Lua VM scripting

### Data Strategy
- Multiple providers active simultaneously -- different functions may use different providers
- WebSocket-first from providers where available, polling fallback at provider-set rate limits
- Quotes/snapshots, fundamentals, price history for Phase 1
- BYOD (Bring Your Own Data) -- users supply their own API keys
- Provider research still needed for fundamentals, news, analyst data

### Multi-Window / Multi-Monitor
- Each browser window is a WebSocket subscriber to the shared Go backend
- Pub/sub event model -- windows subscribe to topics (e.g., "quotes:AAPL")
- Backend is single source of truth, fan-out keeps all windows in sync
- No IPC/shared memory needed -- WebSocket handles it

### Phase 1 Screens
1. **Watchlist** -- live quotes table, real-time updates
2. **Single-stock view** -- chart + fundamentals deep dive
3. **Screener** -- filter/scan stocks by criteria
4. **Feed** -- news/events/alerts stream

### Open Source
- Public repo from day one
- Users bring their own API keys / data subscriptions
- The app is the framework, data is BYOD

## Existing Code Retained
- Provider interfaces and `StockProvider` abstraction
- Provider registry with self-registration pattern
- All 3 provider implementations (Polygon, Alpha Vantage, FMP)
- Middleware stack (rate limit, retry, circuit breaker, observability) Config loading, error handling, data normalization

## Existing Code Dropped
- `internal/tui/` -- Bubble Tea TUI (replaced by web frontend)
- `internal/vm/` -- Lua VM scripting (screening moves to backend/WASM)
- `internal/engine/` -- needs major rework for WebSocket event model

## Tech Stack Decisions (during planning)

- **Frontend: HTMX + Go templates** (not Svelte/Solid) -- server-side rendering, no Node.js, no build step, single binary. HTMX WebSocket extension swaps HTML fragments pushed from the server.
- **WebSocket: github.com/coder/websocket v2** -- modern, context-aware, actively maintained. gorilla/websocket is in maintenance mode.
- **Charting: TradingView lightweight-charts** -- 40KB, OHLCV-native, loaded via CDN or vendored JS. Small vanilla JS to initialize.
- **Start with Iteration 0** -- prove the build pipeline (Go serves HTML, HTMX loads, health endpoint works) before building features.

## Next Steps
- Execute Iteration 0: scaffolding
- Provider research for fundamentals and news data
