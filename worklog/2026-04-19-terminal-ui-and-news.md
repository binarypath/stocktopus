# Worklog: 2026-04-19 -- Bloomberg Terminal UI + News Feature

## Terminal UI Overhaul

### Replaced navbar with Bloomberg terminal-style interface
- Command bar with `>` prompt — type commands like `graph AAPL`, `watchlist`, `news`
- Command autocomplete dropdown with usage and descriptions, filters as you type
- Security selector (top-right) with autocomplete from subscribed securities
- Keyboard shortcuts: `/` or `Esc` focuses command bar, `s` activates security selector
- Connection status badge (CONNECTED/DISCONNECTED)
- Footer with current view name + multi-timezone clocks (ET, UTC, UK, JST)

### SPA architecture
- Fragment rendering: server returns content-only when `X-Fragment: true` header is set
- Single persistent WebSocket across view switches
- All inline JS extracted from templates into `terminal.js`
- Browser history via `pushState` — back/forward works, refresh works

### Renamed "Symbol" → "Security" across all UI code
- Templates, CSS classes, JS variables, HTML IDs, placeholder text
- Internal Go model fields and WebSocket protocol left as-is

## News Feature

### FMP news client (`internal/news/news.go`)
- Fetches from 6 FMP stable API endpoints: stock-latest, crypto-latest, forex-latest, general-latest, press-releases, fmp-articles
- Unified `NewsItem` model normalizes different response shapes

### News view with tabbed interface
- 6 tabs: Press Releases, Articles, Stock, Crypto, Forex, General
- Lazy-loading: each tab fetches on click
- Press Releases tab filters by selected security when one is set
- News cards with title, source, date, symbol badge, text preview

### Server routes
- `GET /news` — news page (full or fragment)
- `GET /api/news/{category}` — JSON API with `symbol`, `limit`, `page` params

## FMP Provider Fix
- Migrated from legacy `/api/v3/quote/` to stable `/stable/quote` and `/stable/batch-quote`
- Fixed `changePercentage` field name (was `changesPercentage`)
- Fixed `marketCap` type: `int64` → `float64`

## Other
- `make dev` now builds before running
- Removed HTMX script tags from layout (no longer used)
