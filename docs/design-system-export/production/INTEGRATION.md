# Stocktopus — Tron overlay integration

This applies the "terminal of the future" (Tron neon-glow) design system to the
**live Stocktopus app** with the smallest, safest change possible: one additive
stylesheet, `tron.css`, loaded after the existing `style.css`.

It overrides **paint only** (glow, ignite-on-active, a faint grid backdrop). It
changes no markup, no layout, no tokens you rely on — it *reuses* the tokens
already in `style.css` (`--accent-orange`, `--accent-blue`, `--green`, `--red`,
the surface/rail/emphasis/duration tokens) and adds a glow layer on top. Remove
the one `<link>` and the app is exactly as it was.

This matches the repo's own dual-write migration philosophy
(`design-language-unification.md`): add alongside, retire later.

---

## Option A — Drop-in overlay (recommended)

1. Copy **`tron.css`** into `internal/server/static/`.
2. In `internal/server/templates/layout.html`, add one line in `<head>`,
   **after** the existing stylesheet:

   ```html
   <link rel="stylesheet" href="/static/style.css?v={{.AssetVersion}}">
   <link rel="stylesheet" href="/static/tron.css?v={{.AssetVersion}}">  <!-- add this -->
   ```

3. Rebuild/run (`make dev`). Done — every view ignites.

To revert: delete the one line. Zero other footprint.

> Note on the CSS guard: `internal/server/css_guard_test.go` ratchets on raw hex
> *in `style.css`*. `tron.css` is a separate file, but it also introduces almost
> no raw hex (it builds glows from existing tokens via `color-mix`). The few
> literal whites in the neon-white stat treatment are intentional; if your guard
> scans all static CSS, add `tron.css` to its allowlist or fold those into a
> `--neon-white` token in `:root`.

---

## Option B — Bake into `style.css`

If you'd rather not ship a second file:

1. Move the `:root { … }` block from `tron.css` **into** the existing `:root` in
   `style.css` (it only *adds* tokens — `--glow-*`, `--text-glow-*`,
   `--rail-glow-*`, `--grid-*`, `--bg-deep`; and overrides `--yellow` to the
   hotter `#ffcc00`).
2. Paste the remaining rules into the relevant sections of `style.css` (the
   selectors already exist there — `.terminal-header`, `.st-tab`, `.vim-selected`,
   `.info-stat-value`, etc.), or append them as a new
   `/* ── Tron glow layer ── */` section at the end.
3. Run `make build` so the JS lint + css guard pass; add any new literal hex to
   the guard baseline.

---

## What changes, by region

| Region | Selector(s) | Effect |
|--------|-------------|--------|
| Canvas | `body`, `.terminal-content` | Deeper `#060709` + faint cyan grid + top glow well |
| Header | `.terminal-header::after`, `.brand` | Underlit cyan→amber glow rule; amber wordmark glow |
| Command bar | `.cmd-bar:focus-within`, `.cmd-prompt` | Amber bloom on focus |
| Selectors | `.security-input:focus`, `.conn-status.connected` | Cyan focus glow; green "connected" bloom |
| Tabs | `.st-tab--active`, `.info-tab.active`, `.economics-tab.active` | Amber underline bloom + text glow |
| Sub-tabs | `.info-sub-tab.active`, `.st-tab-row--blue` | Cyan underline bloom + text glow |
| Selection | `.vim-selected`, `.st-row-selected(.--blue)` | Glowing left rail (amber / cyan) |
| Panes | `.st-pane-active`, `.*.pane-focused` | Top-edge amber bloom |
| Identity | `.cpanel-sym`, `.idx-sym`, `.sym-link:hover` | Cyan symbol glow |
| Stats | `.info-stat-value`, `.info-stat:hover` | Neon-white value; cyan hover glow |
| Market | `.cpanel-change .price-up/down`, `.wl-spark-label` | Hero deltas glow green/red (table deltas stay matte for density) |
| Chips | `.st-chip--orange/--blue` | Colour-matched bloom |
| Tables | `.quote-table`, `.screener-table`, `.st-table` | Faint amber top edge |
| Inputs | `.st-input:focus`, screener/add-security inputs | Cyan focus glow |

---

## Structural upgrades (not in the overlay — need template/JS changes)

These came up in the design review and are worth doing, but they touch markup or
the render layer, so they're intentionally **not** in `tron.css`:

- **Stat cards with prior-year comparison** (`PY 2.10T ▲ +41.9%`, green when this
  year is higher, red when lower). Add a `.info-stat-cmp` row in the template and
  the `.st-stat-delta--up/--down` classes (see `molecules.css` in the design
  system). Pure CSS hooks are ready; the data wiring is yours.
- **Fundamentals table with FY-over-FY columns** (current year neon green/red vs
  prior year muted) — a `screener`/financials template change.
- **Tab "folder ownership"** (the active primary tab visually containing its blue
  sub-menu) — wrap the sub-tab strip in a `.st-tabfolder` container.
- **Contextual footer help** per view — `vim-nav.js` / `terminal.js` already know
  the active view; swap `.footer-help` text on view change (map in the design
  system's `Chrome.jsx`).

---

## Preview

Three A/B pages render **real Stocktopus markup** with the **real `style.css`** +
this overlay, each with a **tron ON/OFF** toggle (top-right):

- `preview-info.html` — security info (tabs + stat grid + peer table)
- `preview-overview.html` — crypto/overview page (nav + info panel + stats)
- `preview-graph.html` — graph page (company panel + range bar + toggles)

(`_real-style.css` is a copy of the app's `style.css` so the previews are
faithful; it is not part of the overlay you ship.)

## Latest refinements (panel + nav pass)

- **Rounded grey panel boxes** on all bordered containers (one radius, one
  border, one grey); tighter `--control-radius` on bars/inputs/pills.
- **Company panel** gets inner padding so the symbol isn't jammed in the corner;
  single line, never wraps.
- **Info / overview panel** gets inner padding (fixes left-edge crowding) and a
  clean horizontal cut-off at the rounded right edge.
- **Nav blends into the background** — removed the full-width baseline underline
  under tab/range rows and the heavy 50% pill fill; the active tab is brighter
  amber/cyan text with a short underline tick, sitting with equal breathing room
  between the panel above and below.
- **Selected row** is near-black with a thin neon left line (no heavy fill).

## Can't push the PR for you

I don't have write access to `binarypath/stocktopus`, so I can't open the PR
directly. Take these files (download below), drop them in per Option A, and the
suggested PR title is:

`feat(ui): add Tron glow overlay (tron.css) — ignite-on-active across all views`
