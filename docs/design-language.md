# Design Language

The reference for Stocktopus' design system: tokens in `:root`, `st-*` primitive classes, brand axes, ternary proportion. New UI work should sit on top of this layer rather than introducing parallel ad-hoc styling.

> **Status:** Phases 1–4 shipped in #139 and #141; Phase 4b layout-split + priority spacing pass and Phase 5 guardrail landed alongside this doc. The hex baseline in `internal/server/css_guard_test.go` ratchets one-way as stragglers migrate.

**Primary stylesheet:** `internal/server/static/style.css`. Brand colours, spacing atoms, motion durations, and emphasis percentages all live in the `:root` block at the top of the file — anything else outside `:root` is a candidate for the next ratchet.

**User preferences (non-negotiable direction):**
- Thin **bright** orange and blue **lines** (1–2px borders, rails, pane edges).
- **Opaque** (high-saturation) orange/blue **surfaces** for active/selected states — not washed-out 25% fills.
- **Saturation tweak upward** on brand orange/blue vs current tokens.
- Codify **regions** and **components** in CSS so all pages share one system.

---

## 1. Fragmentation audit (current state)

| Pattern | Where it diverges | Problem |
|--------|-------------------|---------|
| Active tab | `.info-tab.active`, `.info-sub-tab.active`, `.chart-range-btn.active`, `.economics-tab.active`, `.wl-tab-active`, `.screener-preset.active` | Orange vs blue, inset shadow vs plain border, opacity on watchlist tabs |
| Selection | `.vim-selected` (25% orange fill), `.pane-focused` (top orange line), `.reader-para.vim-selected` (outline), `.idx-spark-selected` | Different “selected” feel per page; some highlights drop after rerender |
| Focus ring | cmd-bar → orange; `.security-input` → blue; screener inputs → blue | No single focused-control language |
| Accent surfaces | Badges/chips use `rgba(..., 0.1–0.3)` at many opacities | Muddy panels instead of opaque brand blocks |
| Structure lines | Grey `--border` vs ad-hoc orange/blue | Brand lines not tokenized |
| Radius / density | `2px`, `3px`, `4px`, `6px` mixed | Subtle per-page inconsistency |

**Screenshots / pages reviewed:** Watchlist, Graph (AAPL chart), Info (tabs + SEC + Sector peer table), Ideas (multi-series chart), Screener, Economics (multi-window layout).

**What already works (keep and standardize):**
- Ideas chart: thin bright orange/blue series lines.
- Info sector table: orange left rail on selected row (align with global row selection).
- Monospace terminal aesthetic, dark backgrounds, green/red for market up/down only.

---

## 2. Design principles

### 2.1 Two brand axes (not five)

| Color | Meaning | Use for |
|-------|---------|---------|
| **Orange** | Primary workspace / navigation / “you are here” | Main tabs, active pane, cmd prompt, primary commands, section titles |
| **Blue** | Security identity / secondary nav / links | Symbol text, security input, sub-tabs, clickable tickers |

### 2.2 Market semantics (separate from brand)

| Color | Meaning |
|-------|---------|
| **Green** | Price/up/delta positive |
| **Red** | Price/down/delta negative |

Do **not** reuse green for non-market badges (e.g. entity types) when unifying — prefer neutral or blue/orange chips.

### 2.3 Two accent treatments

| Treatment | CSS intent | When to use |
|-----------|------------|-------------|
| **Line** | `1px` or `2px` solid `--accent-*-line` | Active tab border, selected row left rail, pane top edge, chart legend swatches |
| **Surface** | High-opacity fill (`color-mix` ~85–92% toward black, or dedicated solid token) | Active tab background, selected row background, mode chips, “CONNECTED”-style blocks |

**Avoid** `rgba(brand, 0.25)` for primary selection — reserve low alpha for **hover only**.

### 2.4 Duration / command tags

- Lowercase duration keys globally: `1d`, `1w`, `1m`, `6m`.
- Colon-wrapped subtle tags: `:live:`, `:1d:` (secondary text style, not primary price weight).

### 2.5 Ternary proportion system (1 · 3 · 1:3)

> **Philosophy:** Use **3** as the atomic unit of proportion; use **1:3** as the default structural ratio; treat **3:1** as the inverse for hero emphasis. Codify rhythm in CSS tokens—do not decorate with the number 3 arbitrarily.

| Pattern | Meaning in UI |
|---------|----------------|
| **1** | Line, rail, single stroke (thin orange/blue border) |
| **3** | Spacing atom (`--u: 3px`), surface weight, strong fill |
| **1 : 3** | Chrome : content (sidebar : main, filters : results) |
| **1/3** | Minor column (~25% width), hints, muted emphasis |
| **3/1** | Hero dominance (price vs tags, chart vs toolbar) |

**Commit:** ternary grid for spacing, hierarchy, and split layouts. **Avoid:** forcing chart columns or data tables into 1:3 when density needs flexibility—structure is ternary; data regions are fluid inside the **3fr** column.

Full token list and migration tables: **§12**.

---

## 3. Token layer (`:root`)

Add or replace in `style.css` `:root` block. Starting hex values (tune on one reference page during Phase 2):

```css
:root {
    /* ── Existing structure (keep or alias) ── */
    --bg-primary: #0a0a0a;
    --bg-secondary: #111111;
    --bg-tertiary: #1a1a1a;
    --border: #2a2a2a;
    --text-primary: #e0e0e0;
    --text-secondary: #888888;
    --text-muted: #555555;
    --font-mono: 'SF Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace;

    /* ── Market (unchanged semantics) ── */
    --green: #00cc66;
    --red: #ff4444;
    --yellow: #ccaa00;

    /* ── Brand accents (saturated; supersede --orange / --blue) ── */
    --accent-orange: #ff9a1a;   /* was #ff8800 */
    --accent-blue: #2db8ff;     /* was #4499ff */

    /* Aliases for gradual migration */
    --orange: var(--accent-orange);
    --blue: var(--accent-blue);

    /* Lines */
    --line-default: 1px solid var(--border);
    --line-accent-orange: 1px solid var(--accent-orange);
    --line-accent-blue: 1px solid var(--accent-blue);
    --rail-accent-orange: 2px solid var(--accent-orange);
    --rail-accent-blue: 2px solid var(--accent-blue);

    /* Surfaces (opaque-ish on dark bg) */
    --accent-orange-surface: color-mix(in srgb, var(--accent-orange) 18%, var(--bg-primary));
    --accent-orange-surface-strong: color-mix(in srgb, var(--accent-orange) 35%, var(--bg-primary));
    --accent-orange-surface-solid: color-mix(in srgb, var(--accent-orange) 88%, #000000);
    --accent-blue-surface: color-mix(in srgb, var(--accent-blue) 18%, var(--bg-primary));
    --accent-blue-surface-strong: color-mix(in srgb, var(--accent-blue) 35%, var(--bg-primary));
    --accent-blue-surface-solid: color-mix(in srgb, var(--accent-blue) 88%, #000000);

    /* Hover-only translucency */
    --accent-orange-hover: color-mix(in srgb, var(--accent-orange) 12%, transparent);
    --accent-blue-hover: color-mix(in srgb, var(--accent-blue) 12%, transparent);

    /* Selection */
    --select-row-bg: var(--accent-orange-surface-strong);
    --select-row-rail: var(--rail-accent-orange);
    --select-sub-row-bg: var(--accent-blue-surface-strong);
    --select-sub-row-rail: var(--rail-accent-blue);
    --pane-focus-line: 2px solid var(--accent-orange);

    /* Type scale */
    --text-xs: 10px;
    --text-sm: 11px;
    --text-md: 13px;
    --text-lg: 16px;

    /* Radius (two sizes only) */
    --radius-sm: 2px;
    --radius-md: 4px;
}
```

**Phase 1 task:** Replace scattered `rgba(255, 136, 0, …)` and `rgba(68, 153, 255, …)` with these tokens where possible without HTML changes. Add ternary tokens from **§12** in the same `:root` pass.

---

## 4. Primitive components (CSS classes)

Add a dedicated section in `style.css` (e.g. `/* ── Design system primitives (st-*) ── */`). Pages adopt by adding classes alongside existing ones during migration (dual-write), then remove legacy rules.

### 4.1 Tabs

```css
.st-tab-row {
    display: flex;
    gap: 4px;
    border-bottom: var(--line-default);
    padding-bottom: 8px;
    margin-bottom: 12px;
}

.st-tab {
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    padding: 4px 12px;
    cursor: pointer;
}

.st-tab:hover {
    color: var(--text-primary);
    background: var(--bg-tertiary);
}

.st-tab--active {
    color: var(--accent-orange);
    border: var(--line-accent-orange);
    background: var(--accent-orange-surface);
    box-shadow: inset 0 -2px 0 var(--accent-orange);
}

/* Secondary strip (sub-tabs, news sub-nav) */
.st-tab-row--blue .st-tab--active {
    color: var(--accent-blue);
    border: var(--line-accent-blue);
    background: var(--accent-blue-surface);
    box-shadow: inset 0 -2px 0 var(--accent-blue);
}
```

**Maps from:** `.info-tab`, `.info-sub-tab`, `.chart-range-btn`, `.economics-tab`, `.screener-preset` (preset variant may use smaller padding).

### 4.2 Table row selection

```css
.st-row-selected {
    background: var(--select-row-bg) !important;
    box-shadow: inset var(--select-row-rail) 0 0 0;
}

.st-row-selected--blue {
    background: var(--select-sub-row-bg) !important;
    box-shadow: inset var(--select-sub-row-rail) 0 0 0;
}
```

**Maps from:** `.vim-selected` on table rows, sector peer selection, screener result row selection. **Do not** use outline-only selection for rows.

**Sub-tab strips:** `.st-tab-row--blue .vim-selected` or `.st-row-selected--blue` inside `.info-sub-tabs`, `.news-sub-tabs`.

### 4.3 Pane focus (multi-column layouts)

```css
.st-pane-active {
    box-shadow: 0 -2px 0 1px var(--accent-orange);
}
```

**Maps from:** `.ideas-sidebar.pane-focused`, `.ideas-main.pane-focused`, `.screener-filters.pane-focused`, `.screener-results.pane-focused`.

### 4.4 Form controls

```css
.st-input {
    background: var(--bg-primary);
    color: var(--text-primary);
    border: var(--line-default);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-md);
    padding: 4px 8px;
    outline: none;
}

.st-input:focus {
    border-color: var(--accent-blue);
}
```

**Maps from:** screener filter inputs, add-security form inputs (watchlist may keep orange cmd-bar separate).

### 4.5 Chips / tags

```css
.st-chip {
    font-size: var(--text-xs);
    font-weight: 600;
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
}

.st-chip--orange {
    color: var(--accent-orange);
    background: var(--accent-orange-surface-solid);
    border-color: var(--accent-orange);
}

.st-chip--blue {
    color: var(--accent-blue);
    background: var(--accent-blue-surface-solid);
    border-color: var(--accent-blue);
}

.st-chip--muted {
    color: var(--text-secondary);
    background: var(--bg-tertiary);
    border-color: var(--border);
}
```

**Maps from:** `:live:`, `:1d:`, reader badges, kbd hints, footer mode chips (semantic variants).

### 4.6 Security link

```css
.st-link-sym {
    color: var(--accent-blue);
    font-weight: 700;
    cursor: pointer;
    text-decoration: none;
}

.st-link-sym:hover {
    text-decoration: underline;
}
```

**Maps from:** `.sym-link`, `.cpanel-sym`, `.idx-sym`, screener security column.

### 4.7 Section title

```css
.st-section-title {
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--accent-orange);
}
```

**Maps from:** `.screener-group h4`, filter group headers, page subheaders.

### 4.8 Shared table chrome

```css
.st-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
}

.st-table thead th {
    text-align: left;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 6px 8px;
    border-bottom: var(--line-default);
}

.st-table tbody td {
    padding: 6px 8px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
}

.st-table tbody tr:hover {
    background: var(--bg-secondary);
}
```

**Maps from:** `.quote-table`, `.screener-table`, `.fin-table`, peer comparison tables.

### 4.9 Market delta colors (existing — keep names)

```css
.price-up { color: var(--green); }
.price-down { color: var(--red); }
.price-flat { color: var(--text-secondary); }
```

Use for all signed numeric columns (watchlist changes, screener Δ columns, etc.).

---

## 5. Application regions (codified map)

| Region | DOM / class anchors | Primitives to apply |
|--------|---------------------|---------------------|
| **Shell** | `.terminal-header`, `.terminal-footer`, `.cmd-bar`, `.brand` | Orange brand text; cmd-bar focus = orange line; footer mode = `st-chip` semantic |
| **Watchlist** | `.watchlist`, `.quote-table`, `.wl-tab`, `.wl-spark-cell` | `st-table`, `st-link-sym`, `st-tab` for tabs; market colors for deltas; 6M sparkline label uses `price-up`/`price-down` |
| **Graph** | `.chart-range-bar`, `.chart-range-btn`, `.chart-toggle`, `.chart-container` | `st-tab` for range buttons; toggles: green only when “on” |
| **Info** | `.info-tabs`, `.info-sub-tabs`, `.company-panel`, peer/SEC tables | Orange `st-tab-row`; blue `st-tab-row--blue` for sub-tabs; `st-row-selected` on tables |
| **Ideas** | `.ideas-layout`, `.ideas-sidebar`, `.ideas-main`, `.ideas-chart-host` | `st-pane-active`; chart series colors = token orange/blue; legend swatches match |
| **Screener** | `.screener-layout`, `.screener-filters`, `#screener-table` | `st-input`, `st-section-title`, `st-pane-active`, `st-row-selected`, `price-up`/`price-down` on Δ columns |
| **Economics** | `.economics-layout`, `.economics-tab` | `st-tab` / `st-tab-row` |
| **Reader** | `#article-reader`, `.reader-*` | `st-chip` for entities; `st-row-selected` for paragraph nav |

---

## 6. Phased rollout

### Phase 1 — Tokens only (low risk)
- [ ] Add token block above to `:root`.
- [ ] Add ternary tokens from **§12** (`--u`, `--space-*`, `--layout-split`, `--emphasis-*`, `--duration-*`).
- [ ] Alias `--orange` / `--blue` to new accents.
- [ ] Replace top ~20 hardcoded `rgba(255, 136, 0, …)` / `rgba(68, 153, 255, …)` with tokens.
- [ ] Snap shell spacing to `--space-*` (header, footer, `.terminal-content`) per **§12.3**.
- [ ] No HTML/template changes.
- [ ] Visual smoke: header, watchlist, graph, info tabs.

### Phase 2 — Primitives + reference page
- [ ] Add all `.st-*` rules in one section.
- [ ] Dual-write on **Info page** (tabs + sector table + company panel) — best screenshot coverage.
- [ ] Acceptance: primary tab = orange line + surface; sub-tab = blue; selected peer row = left rail + surface.

### Phase 3 — Selection unification + highlight bug
- [ ] Consolidate `.vim-selected` row behavior under `.st-row-selected`.
- [ ] Remove conflicting outline-only row selection where redundant.
- [ ] Audit JS that rerenders tables/forms and strips focus/selection classes (reported: highlight lost after a few seconds).
- [ ] Files to check: `vim-nav.js`, `screener.js`, `terminal.js`, `ideas.js`, any polling/WebSocket row update paths.

### Phase 4 — Page sweep (order)
1. Graph toolbar (`.chart-range-btn`)
2. Watchlist (`.wl-tab`, `.quote-table`)
3. Screener (filters + results)
4. Ideas (sidebar list + panes)
5. Economics (`.economics-tab`)
6. Reader badges/chips

### Phase 4b — Ternary layout + spacing (can overlap Phase 2–4)
- [ ] Convert `.ideas-layout`, `.screener-layout`, `.debug-panels` to `grid-template-columns: var(--layout-split)` per **§12.4**.
- [ ] `.article-reader` → `width: min(33.333%, 450px)` per **§12.4**.
- [ ] Mechanical spacing pass: replace off-grid `px` values per **§12.5**.
- [ ] Unify `.vim-selected` emphasis to `--emphasis-1` / `--emphasis-2` per **§12.7**.

### Phase 5 — Guardrails
- [ ] Add `docs/design-language.md` (short pointer to this file + class list).
- [ ] CI/pre-commit: fail on new hex outside `:root` in `style.css` (optional grep).
- [ ] Remove deprecated duplicate rules after each page migrates.

---

## 7. Per-page acceptance checklist

### Shell
- [ ] Brand orange is saturated, readable on `#0a0a0a`.
- [ ] Cmd bar focus uses orange line token.
- [ ] Footer `NORMAL` / view label uses chip/surface tokens.

### Watchlist
- [ ] Tabs use `st-tab` (not per-tab opacity/color hacks).
- [ ] Table matches `st-table` header/body/hover.
- [ ] Symbol column uses `st-link-sym`.

### Graph
- [ ] Range buttons match Info primary tabs (orange active).
- [ ] No one-off active styles.

### Info
- [ ] Primary tabs orange; sub-tabs blue.
- [ ] Sector selected row: orange left rail + surface (not outline-only).
- [ ] Company panel symbol = blue, consistent with watchlist.

### Ideas
- [ ] Pane focus = top orange line (`st-pane-active`).
- [ ] Multi-series chart: orange + blue lines from tokens; legend matches.

### Screener
- [ ] Filter section titles = `st-section-title`.
- [ ] Inputs = `st-input` (blue focus).
- [ ] Δ columns use `price-up` / `price-down`.
- [ ] Row selection stable under refresh.

### Economics
- [ ] Tabs identical to Info primary tabs.

---

## 8. Chart-specific rules (Ideas + Graph)

| Element | Rule |
|---------|------|
| Series 1 | `--accent-orange` stroke |
| Series 2 | `--accent-blue` stroke |
| Series 3+ | `--text-secondary` or distinct neutral |
| Legend swatch | Same hex as series stroke |
| 6M sparkline (watchlist) | Stroke/fill from `price-up`/`price-down`; `6m` label same color |
| Active range (graph) | `st-tab--active` orange |

---

## 12. Ternary proportion system (1 · 3 · 1:3)

This section extends **§3** tokens and **§4** primitives. Implement in the same Phase 1 `:root` pass; apply layout and spacing migrations in Phase 4b (or alongside the Info reference page).

### 12.1 One-sentence rule

> *Stocktopus uses a ternary grid: spacing in threes, hierarchy in three levels (muted / secondary / primary), layout in 1:3 (chrome : content); brand accents express weight as line (1) vs. surface (3).*

### 12.2 `:root` tokens (add to `style.css`)

```css
:root {
    /* ── Ternary unit (spacing atom) ── */
    --u: 3px;
    --space-1: var(--u);                    /* 3 */
    --space-2: calc(var(--u) * 2);          /* 6 */
    --space-3: calc(var(--u) * 3);          /* 9 */
    --space-4: calc(var(--u) * 4);          /* 12 */
    --space-5: calc(var(--u) * 5);          /* 15 */
    --space-6: calc(var(--u) * 6);          /* 18 */
    --space-8: calc(var(--u) * 8);          /* 24 */
    --space-10: calc(var(--u) * 10);        /* 30 */
    --space-15: calc(var(--u) * 15);        /* 45 */

    /* ── 1 : 3 layout ── */
    --layout-chrome: 1fr;
    --layout-content: 3fr;
    --layout-split: var(--layout-chrome) var(--layout-content);

    /* ── Emphasis thirds (replace ad-hoc 0.25 / 0.15 fills) ── */
    --emphasis-1: 33%;
    --emphasis-2: 66%;
    --emphasis-3: 100%;

    /* ── Motion (×3 ms) ── */
    --duration-1: 90ms;
    --duration-2: 180ms;
    --duration-3: 270ms;

    /* ── Type: three chrome tiers + one hero ── */
    --text-1: 10px;    /* hints, labels, table headers */
    --text-2: 12px;    /* sidebars, secondary UI */
    --text-3: 13px;    /* body base (maps to --text-md) */
    --text-hero: 16px; /* price, symbol hero only */
    --line-height-tight: 1.333;  /* 4/3 */
    --line-height-body: 1.5;     /* 3/2 — keep as default */

    /* ── Radius on-grid (optional; prefer over 2px/4px mix) ── */
    --radius-sm: 3px;
    --radius-md: 6px;
}
```

**Aliases (gradual migration):** map existing `--text-xs` → `--text-1`, `--text-sm` → `--text-2`, `--text-md` → `--text-3`, `--text-lg` → `--text-hero`.

**Accent + emphasis pairing:**

| Role | Token | Use |
|------|-------|-----|
| Line (weight 1) | `--line-accent-orange`, `--rail-accent-orange` | Tab border, pane top, row rail |
| Surface (weight 3) | `--accent-orange-surface-solid`, `--emphasis-2` mix | Active tab, selected row, mode chip |
| Hover only | `--emphasis-1` mix or `--accent-orange-hover` | `:hover`, not primary selection |

### 12.3 Shell — snap chrome to the grid

| Selector | Current (approx.) | Target |
|----------|-------------------|--------|
| `.terminal-header` | `height: 44px`, `padding: 0 16px`, `gap: 12px` | `height: var(--space-15)` (45px), `padding: 0 var(--space-6)`, `gap: var(--space-4)` |
| `.terminal-footer` | `height: 24px`, `gap: 16px`, `padding: 0 12px` | `height: var(--space-8)` ✓, `gap: var(--space-6)`, `padding: 0 var(--space-4)` |
| `.terminal-content` | `padding: 16px` | `padding: var(--space-6)` (18px) |
| `.cmd-bar` | `padding: 6px 12px`, `gap: 8px`, `border-radius: 6px` | `padding: var(--space-2) var(--space-4)`, `gap: var(--space-3)`, `border-radius: var(--radius-md)` |
| `body` | `line-height: 1.5` | `line-height: var(--line-height-body)` |

### 12.4 Layout — enforce 1:3 for side panes

| Selector | Current | Target |
|----------|---------|--------|
| `.ideas-layout` | `display: flex`; `.ideas-sidebar { width: 240px }` | `display: grid; grid-template-columns: var(--layout-split);` — remove fixed 240px |
| `.screener-layout` | `display: flex`; `.screener-filters { width: 280px }` | Same `grid` + `--layout-split` |
| `.article-reader` | `width: 450px` | `width: min(33.333%, 450px);` (450 = 150×3; cap preserves today’s max) |
| `.debug-panels` | `grid-template-columns: 280px 1fr` | `grid-template-columns: var(--layout-split)` |
| `.info-overview-top` | `minmax(0, 1fr) minmax(0, 1.2fr)` | `minmax(0, 1fr) minmax(0, 3fr)` or `var(--layout-split)` |

**Do not force 1:3 on:** `#screener-table` column widths, chart canvas, `repeat(4, 1fr)` stat grids, `minmax(80px, 1fr)` auto-fit blocks.

### 12.5 Spacing migration — off-grid → `--space-*`

Replace ad-hoc values during component pass:

| Raw value | Replace with |
|-----------|----------------|
| `4px` | `var(--space-2)` (6px) — drop 4px family |
| `5px` | `var(--space-2)` |
| `8px` | `var(--space-3)` (9px) |
| `10px` | `var(--space-3)` or `var(--space-4)` |
| `14px`, `16px` | `var(--space-5)` (15px) or `var(--space-6)` (18px) |
| `20px`, `40px` (empty states) | `var(--space-6)`, multiples of `--space-*` |

**Priority sections:** `.cmd-*`, `.quote-table`, `.info-tab*`, `.screener-group`, `.ideas-sidebar-header`, `.economics-header`.

### 12.6 Typography — three tiers + hero

| Role | Token | Maps from |
|------|-------|-----------|
| Labels / hints / `th` | `--text-1` | `10px`, `11px` chrome |
| Sidebars / screener / ideas list | `--text-2` | `12px` |
| Body | `--text-3` | `13px` base |
| Price / `.cpanel-sym` | `--text-hero` | `16px` only |

**Rule:** no new `11px` / `14px` for chrome without mapping to a tier.

**Exception (documented):** `13px` body is not a multiple of 3; keep for readability unless product accepts `12px` or `15px` base (visual regression test required).

### 12.7 Selection — line (1) + surface (3)

Replace `.vim-selected` wash (`rgba(..., 0.25)`) with emphasis tokens:

```css
.vim-selected,
.st-row-selected {
    background: color-mix(
        in srgb,
        var(--accent-orange) var(--emphasis-2),
        var(--bg-primary)
    ) !important;
    box-shadow: inset var(--select-row-rail) 0 0 0;
}

.info-sub-tabs .vim-selected,
.news-sub-tabs .vim-selected,
.st-row-selected--blue {
    background: color-mix(
        in srgb,
        var(--accent-blue) var(--emphasis-2),
        var(--bg-primary)
    ) !important;
    box-shadow: inset var(--select-sub-row-rail) 0 0 0;
}
```

| State | Emphasis |
|-------|----------|
| Hover | `--emphasis-1` (33%) |
| Selected row / tab | `--emphasis-2` (66%) + rail |
| Solid chip / CONNECTED | `--accent-*-surface-solid` / `--emphasis-3` |

Optional: `.st-tab--active` inset bar `0 -3px 0` (ternary stroke) instead of `-2px`.

### 12.8 Motion — ×3 ms

| Current | Target |
|---------|--------|
| `transition: … 0.1s` | `var(--duration-1)` (90ms) |
| Medium interactions | `var(--duration-2)` (180ms) |
| `animation: flash-* 0.6s` | `calc(var(--duration-3) * 2)` (540ms) or keep 600ms as documented exception |

### 12.9 Grids already on “3” — codify, don’t fight

| Location | Note |
|----------|------|
| `repeat(3, 1fr)` (e.g. ~line 1272 in `style.css`) | Canonical multi-column pattern |
| `.article-reader` 450px | Document as `150 × 3` |
| `.info-grid` `repeat(4, 1fr)` | Optional later → `repeat(3, 1fr)` only if layout still works |

### 12.10 Out of scope for ternary pass

- TradingView / lightweight-charts internal dimensions
- Auto-fit `minmax(...)` data grids
- Forcing every `border-radius` to 3px without migrating `--radius-sm` / `--radius-md` globally

### 12.11 Ternary acceptance checklist

- [ ] All new padding/gap values use `--space-*` (multiples of 3px).
- [ ] Ideas + Screener use `--layout-split` (1:3), not fixed 240px / 280px sidebars.
- [ ] Reader panel uses `min(33.333%, 450px)`.
- [ ] Row selection uses rail + `--emphasis-2` background (not `0.25` rgba wash).
- [ ] Footer/header heights align to `--space-8` / `--space-15`.
- [ ] Transitions use `--duration-1` / `--duration-2` / `--duration-3`.
- [ ] Chrome typography uses only `--text-1`, `--text-2`, `--text-3`; hero uses `--text-hero`.

### 12.12 Implementation order (within CSS work)

1. Add §12.2 tokens to `:root` (with §3 brand tokens).
2. Shell (§12.3).
3. Layout grids (§12.4).
4. Selection/emphasis (§12.7).
5. Spacing grep pass (§12.5).
6. Typography tiers (§12.6).

---

## 9. Out of scope (unless explicitly requested)

- Changing TradingView/lightweight-charts internal canvas colors beyond wrapper/legend.
- Redesigning layout grids or adding new pages.
- Light theme.
- Renaming user-facing “Security” terminology.

---

## 10. Related handoff files

- `watchlist-reader-ui-handoff.md` — original feature/UI content changes.
- `watchlist-reader-ui-handoff-incremental.md` — follow-up items (screener, ideas, `1d` lowercase, etc.).

Implement design unification **in parallel** with incremental features where classes overlap; prefer adding `st-*` classes in templates during feature work rather than restyling twice.

---

## 11. Suggested first PR title

`refactor(ui): add design tokens, ternary grid, and st-* primitives (Info reference page)`
