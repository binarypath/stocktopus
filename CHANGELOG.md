# Changelog

All notable changes to Stocktopus.

This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and
[Conventional Commits](https://www.conventionalcommits.org/). Releases are cut
automatically by [release-please](https://github.com/googleapis/release-please)
on merge to `master`.

## [0.4.0] — 2026-05-10

Pre-automation snapshot. Captures the work merged before semver tagging was
enabled. Subsequent entries are generated automatically from PR titles.

### Features
- Bloomberg-terminal-inspired UI with vim-first keybindings
- Real-time WebSocket quote stream backed by FMP
- Watchlists with named lists, tabbed view, and `:watch <name>` autocomplete
- Security info pages — Overview, Financials, Estimates, News, AI Analysis, Sector, SEC
- Financials tab with j/k row nav, `p` slide-in chart preview, and `a`-prefilled `:add` to the sketchpad
- SEC filings tab with category filters and a Key People sub-tab (snapshot from 10-K / DEF 14A, timeline from 8-K Item 5.02)
- SEC-compliant filing fetcher with structural leadership-table extraction (~100× LLM speedup)
- Multi-agent trading analysis pipeline (4 analysts + bull/bear research debate)
- Equity indices page, sector intelligence page, news reader slide-in
- `/ideas` sketchpad — comparative graphs across stocks, financial fields, commodities, forex, crypto
- `-` for browser-history back navigation with sub-tab restoration
- Randomised per-process asset version cache buster (no manual `?v=N` bumps)
