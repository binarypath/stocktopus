# Changelog

All notable changes to Stocktopus.

This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and
[Conventional Commits](https://www.conventionalcommits.org/). Releases are cut
automatically by [release-please](https://github.com/googleapis/release-please)
on merge to `master`.

## [1.3.0](https://github.com/binarypath/stocktopus/compare/v1.2.0...v1.3.0) (2026-05-11)


### Features

* **economics:** /economics page (FRED catalog + FMP calendar) + sketchpad economic kind + full-size graphs ([#57](https://github.com/binarypath/stocktopus/issues/57)) ([7b64c31](https://github.com/binarypath/stocktopus/commit/7b64c31e66900f1be7d72ac6f2b70f52b7ec3d2d))


### Bug Fixes

* **ideas:** unify sketch selection colour + stop server-picked palette giving every foreign-page :add the same orange line ([#55](https://github.com/binarypath/stocktopus/issues/55)) ([b041c5e](https://github.com/binarypath/stocktopus/commit/b041c5e0e731f8e159fe3ad499a5e8382469c4c2))

## [1.2.0](https://github.com/binarypath/stocktopus/compare/v1.1.0...v1.2.0) (2026-05-10)


### Features

* overview redesign, sketch autocomplete polish, reader vim nav, focus-ring fix ([#53](https://github.com/binarypath/stocktopus/issues/53)) ([6786ade](https://github.com/binarypath/stocktopus/commit/6786ade85e28efa8534b3b10282b45a6936d7340))

## [1.1.0](https://github.com/binarypath/stocktopus/compare/v1.0.0...v1.1.0) (2026-05-10)


### Features

* vim QoL on /ideas + watchlist row ops + dedup WS subscriptions ([#51](https://github.com/binarypath/stocktopus/issues/51)) ([f7e43fd](https://github.com/binarypath/stocktopus/commit/f7e43fd290a2a1ebaefda6c782f1ede975b9f74e))

## 1.0.0 (2026-05-10)


### Features

* :watch &lt;name&gt; autocomplete adds picker selection to that list (idea [#5](https://github.com/binarypath/stocktopus/issues/5)) ([#46](https://github.com/binarypath/stocktopus/issues/46)) ([e221ac7](https://github.com/binarypath/stocktopus/commit/e221ac73eed4b0c303aa8788ee4377568ecc98a6))
* '-' goes back via browser history (idea [#4](https://github.com/binarypath/stocktopus/issues/4)) ([#47](https://github.com/binarypath/stocktopus/issues/47)) ([0a43d56](https://github.com/binarypath/stocktopus/commit/0a43d562b751888a74ce5c425b85b3be564c0938))
* AI company intelligence system ([#32](https://github.com/binarypath/stocktopus/issues/32)) ([22dcdc6](https://github.com/binarypath/stocktopus/commit/22dcdc6aae06e1c9e137d29e9e86e6cc39b703d3))
* chart indicators — SMA, EMA, MACD, RSI, news markers, tooltip ([#34](https://github.com/binarypath/stocktopus/issues/34)) ([5cd9673](https://github.com/binarypath/stocktopus/commit/5cd9673989c5c19b6f21fdb89a63ca65a78bc485))
* E2E smoke test suite ([#24](https://github.com/binarypath/stocktopus/issues/24)) ([dd96d44](https://github.com/binarypath/stocktopus/commit/dd96d443c8a480a497796ea2ee26df028e4822aa))
* EOD candlestick chart with TradingView Lightweight Charts ([#25](https://github.com/binarypath/stocktopus/issues/25)) ([ad49113](https://github.com/binarypath/stocktopus/commit/ad49113d3671ffac643cba3fd6c675f770cac694))
* equity indices page, /graph/ route, chart watermark ([#38](https://github.com/binarypath/stocktopus/issues/38)) ([0e88898](https://github.com/binarypath/stocktopus/commit/0e888980f0fd6a9a336be0c95f1fd02ced2b47cd))
* financials preview chart slide-in (idea [#3](https://github.com/binarypath/stocktopus/issues/3)) ([#45](https://github.com/binarypath/stocktopus/issues/45)) ([9179545](https://github.com/binarypath/stocktopus/commit/91795453a780ca5100dbbecd21465d5071392841))
* ideas sketchpad — comparative graphs across metrics (idea [#2](https://github.com/binarypath/stocktopus/issues/2)) ([#48](https://github.com/binarypath/stocktopus/issues/48)) ([d71526e](https://github.com/binarypath/stocktopus/commit/d71526e143ff8f0ffa7009887555535987390b17))
* insider-derived key people + Overview integration, semver via release-please ([#49](https://github.com/binarypath/stocktopus/issues/49)) ([dac94dc](https://github.com/binarypath/stocktopus/commit/dac94dc1df64c8e8ba9fba1d0a6436d3be748736))
* multi-agent trading analysis pipeline (phase 1) ([#39](https://github.com/binarypath/stocktopus/issues/39)) ([2eeb22d](https://github.com/binarypath/stocktopus/commit/2eeb22dd96f9c372c7b943e48b2d0722dececc17))
* news polling via hub with read/unread state and spinner ([#27](https://github.com/binarypath/stocktopus/issues/27)) ([aeea968](https://github.com/binarypath/stocktopus/commit/aeea9686ae59fb4df27300582811647b2093cd72))
* **provider:** implement pluggable provider model with three providers ([#21](https://github.com/binarypath/stocktopus/issues/21)) ([e3aba1a](https://github.com/binarypath/stocktopus/commit/e3aba1adc65ad2550fb8770051ce2d9285ba2fc5))
* quick-wins bundle + UX bug fixes ([#42](https://github.com/binarypath/stocktopus/issues/42)) ([1f1e10b](https://github.com/binarypath/stocktopus/commit/1f1e10b385c6d1650ba4211800748b61f960a1db))
* research debate + key people extraction (phase 2) ([#41](https://github.com/binarypath/stocktopus/issues/41)) ([3de9e2c](https://github.com/binarypath/stocktopus/commit/3de9e2ccb51a584647c5a1c132ca4a7cc6bb8b50))
* SEC filings tab + enhanced financials ([#40](https://github.com/binarypath/stocktopus/issues/40)) ([8e8c07f](https://github.com/binarypath/stocktopus/commit/8e8c07f8338d4340541587d540f5db4e4cab4e6a))
* SEC-compliant fetcher + 10-K/DEF 14A leadership snapshots ([#43](https://github.com/binarypath/stocktopus/issues/43)) ([dd491b1](https://github.com/binarypath/stocktopus/commit/dd491b1fb21ddc611872cfa0a79a181d782be6f0))
* sector intelligence, reader bot, company panel, article caching ([#35](https://github.com/binarypath/stocktopus/issues/35)) ([b34a8e2](https://github.com/binarypath/stocktopus/commit/b34a8e27459e907545a7f9f520196a082850c990))
* security autocomplete, news filtering, and infinite scroll ([#23](https://github.com/binarypath/stocktopus/issues/23)) ([5a96d91](https://github.com/binarypath/stocktopus/commit/5a96d91c05a6199378d19dcd43788f78b82b9117))
* security info deep dive with profile, financials, estimates, sparkline ([#30](https://github.com/binarypath/stocktopus/issues/30)) ([6dbb767](https://github.com/binarypath/stocktopus/commit/6dbb767e472c7421eb8b8753b3ce99583f0ea53f))
* vim keybindings, repo cleanup, README rewrite ([#26](https://github.com/binarypath/stocktopus/issues/26)) ([1f69311](https://github.com/binarypath/stocktopus/commit/1f69311e158b9179a4637d5b984509db3040e0a7))
* WebSocket watchlist, Bloomberg terminal UI, and news feed ([#22](https://github.com/binarypath/stocktopus/issues/22)) ([47f5673](https://github.com/binarypath/stocktopus/commit/47f5673ec92def7a40d2223733a2cedb830a6e83))
* wider chart view with lazy history loading ([#33](https://github.com/binarypath/stocktopus/issues/33)) ([1e0ea32](https://github.com/binarypath/stocktopus/commit/1e0ea3207ac4abd8c70ccf5c9d381a91c32861ea))


### Bug Fixes

* article text spacing, reader entity updates, background context ([#36](https://github.com/binarypath/stocktopus/issues/36)) ([4219dcd](https://github.com/binarypath/stocktopus/commit/4219dcd61964e99f9ebbeb33d080175d3beaad2d))
* news view uses selected security as default filter ([#31](https://github.com/binarypath/stocktopus/issues/31)) ([56e30b9](https://github.com/binarypath/stocktopus/commit/56e30b9ccf4b954d403f2c3667bd444369cbdf44))


### Performance Improvements

* extract leadership tables structurally to cut DEF 14A LLM input ~100x ([#44](https://github.com/binarypath/stocktopus/issues/44)) ([61193eb](https://github.com/binarypath/stocktopus/commit/61193eb3f34829306383fcf0f366d1f3e61687f4))
* NER entity extraction 10x faster — 30s to 2.8s ([#37](https://github.com/binarypath/stocktopus/issues/37)) ([ff28be4](https://github.com/binarypath/stocktopus/commit/ff28be4957d806ef5300d892b65e430c650616dc))

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
