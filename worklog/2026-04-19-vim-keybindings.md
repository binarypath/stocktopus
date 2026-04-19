# Worklog: 2026-04-19 -- Vim Keybindings

## Vim Modal Navigation

### Core system
- Modal input: Normal mode (keyboard nav) vs Insert mode (typing in inputs)
- Mode indicator in footer: green NORMAL / orange INSERT
- Escape toggles between modes — Insert→Normal blurs input, Normal→Insert focuses command bar
- Global keydown listener in capture phase to intercept before Vimium

### Watchlist
- j/k moves selection highlight through quote rows (orange outline)
- Enter navigates to info view for selected security
- g navigates to graph view for selected security

### Graph
- h/l scrolls chart left/right in time
- : enters command mode — :1w, :1m, :3m, :6m set chart range
- Chart range persisted in localStorage, restored on next visit
- Exposed chart instance and setRange on window for terminal.js integration

### News
- h/l navigates between tabs, skipping dimmed ones
- j/k highlights news cards with selection
- Enter opens selected article in new tab
- 1-6 number keys jump directly to tabs
- Tab labels show keycap badges ([1] Press Releases, [2] Articles, etc.)

### Debug
- j/k scrolls the log console

## Repo Cleanup
- Removed specs/001-generic-provider-model (outdated)
- Rewrote README.md with current architecture, mermaid diagram, keyboard reference
- Updated CLAUDE.md in previous commit
