# Stocktopus Design System — export kit

Source: `Stocktopus Design System (3).zip` (2026-06-21). Static preview pages + Tron overlay for side‑by‑side comparison with the live app.

## Contents (`production/`)

| File | Purpose |
|------|---------|
| `INTEGRATION.md` | How to ship `tron.css` (Option A: second `<link>`; Option B: merge into `style.css`) |
| `_real-style.css` | Snapshot of app `style.css` at export time (~99k) |
| `tron.css` | Tron glow / panel overlay (now merged into live `internal/server/static/style.css`) |
| `tweaks-panel.jsx` | React tweaks UI for Overview density / focus / stat highlight experiments |
| `preview-*.html` | Full-page mocks (open in browser; toggle **tron ON/OFF** where provided) |

### Preview pages

- `preview-avgo-overview.html` — AVGO Overview (stat grid + Key People / profile)
- `preview-avgo-estimates.html`, `preview-avgo-news.html`, `preview-avgo-ai.html`
- `preview-financials.html`, `preview-goog-sec.html`
- `preview-screener.html`, `preview-ideas.html`, `preview-graph.html`
- `preview-info.html`, `preview-overview.html`, `preview-news.html`, `preview-news-page.html`

## View locally

Static previews under `production/` all use the **Live + Tron** stack:

| Stack | Link order |
|-------|------------|
| **Live + Tron** | 1. `../../../internal/server/static/style.css` (live base) → 2. `tron.css` (`id="tron"`, glow overlay) |

`_real-style.css` remains in the kit as a frozen snapshot for diffing only — no preview links it.

Previews with a **tron ON/OFF** button disable the second `<link>` for A/B comparison. Open a `preview-*.html` file directly in the browser, or use a static file server if you prefer.

**Authoritative check:** run the app and verify in-browser — not a separate Python static server:

```bash
make dev
# open http://localhost:8080/news  (full-page news)
# open http://localhost:8080/      (security info → News tab for sub-tab layout)
```

## Keeping previews current

When you change news or info-panel templates, tab markup, or nav rules in [`style.css`](../../../internal/server/static/style.css):

1. Update the matching `preview-*.html` under `production/` so classes and DOM structure mirror the live template.
2. Keep the **live + Tron** stack for news previews: live `style.css` first, then `tron.css` (see table above). Do not snapshot CSS into the export kit unless intentionally capturing a point-in-time baseline.
3. Verify with `make dev` at http://localhost:8080 (routes below), then spot-check the static preview if you edited one.

| Preview | Live route / template | Nav pattern |
|---------|----------------------|-------------|
| `preview-news-page.html` | `GET /news` → `internal/server/templates/news.html` | `.info-panel` primary nav — `.news-tabs.info-tabs` (orange) |
| `preview-news.html` | Security page → Info → News tab (`info.js`) | Orange `.info-tabs` + cyan `.news-sub-tabs` |
| `preview-avgo-news.html` | Same as above (AVGO mock, numbered tab keys) | Orange primary + cyan `.news-sub-tabs` |
| `preview-info.html` | Security info panel chrome | `.info-panel` primary + sub tabs |
| `preview-overview.html` | Crypto security → Info → Overview (`crypto.html`) | `.info-panel` primary tabs |
| `preview-avgo-overview.html` | Security → Info → Overview (AVGO) | Stat grid + chart + Key People / profile |
| `preview-avgo-estimates.html` | Info → Estimates | Primary + table |
| `preview-avgo-ai.html` | Info → AI Analysis | Primary + content band |
| `preview-financials.html` | Info → Financial Modeling | Primary + fin table |
| `preview-goog-sec.html` | Security page (GOOG) | Full info-panel composition |
| `preview-graph.html` | `GET /{symbol}` chart → `stock.html` | `page-header` + `chart-range-bar` |
| `preview-ideas.html` | `GET /ideas` | Two-pane + comparative chart |
| `preview-screener.html` | `GET /screener` | Filters + results split |

## Live app vs this export

| Topic | Export kit | Live repo (current) |
|-------|------------|---------------------|
| Tron layer | Separate `tron.css` | Merged at end of `style.css` |
| Info nav | Orange numbered primary tabs; sub-tabs blue band | **Blue menu band** on primary + sub (`.info-panel`) |
| Overview | Stat grid + chart + 1:3 columns (AVGO mock) | Chart panel + same columns (`info.js`) |
| Spec doc | `INTEGRATION.md` + previews | `docs/design-language.md` |

Structural items called out in `INTEGRATION.md` but **not** in CSS alone: `.st-tabfolder`, stat YoY comparison rows, contextual footer help map.

## Canonical written spec

Implementation rules and rollout phases: [`../design-language.md`](../design-language.md).
