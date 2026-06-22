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

```bash
cd docs/design-system-export/production
python3 -m http.server 8765
# open http://localhost:8765/preview-avgo-overview.html
```

## Live app vs this export

| Topic | Export kit | Live repo (current) |
|-------|------------|---------------------|
| Tron layer | Separate `tron.css` | Merged at end of `style.css` |
| Info nav | Orange numbered primary tabs; sub-tabs blue band | **Blue menu band** on primary + sub (`.info-panel`) |
| Overview | Stat grid + 1:3 columns; no price chart in AVGO mock | Chart panel + same columns (`info.js`) |
| Spec doc | `INTEGRATION.md` + previews | `docs/design-language.md` |

Structural items called out in `INTEGRATION.md` but **not** in CSS alone: `.st-tabfolder`, stat YoY comparison rows, contextual footer help map.

## Canonical written spec

Implementation rules and rollout phases: [`../design-language.md`](../design-language.md).
