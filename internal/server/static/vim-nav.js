// vim-nav.js — declarative vim navigation core.
//
// Pages opt into vim nav by marking their DOM with two attributes:
//   data-vim-row     on a container; its descendants carrying
//                    data-vim-item become one horizontal row.
//   data-vim-item    on each navigable element.
//
// The core scans the DOM, builds a grid (rows × items), and handles
// the directional keys (j/k/h/l/w/b/1-9/Enter) plus gg/G top/bottom.
// Bespoke per-view handlers in terminal.js still run for non-nav keys
// (g for graph-jump, a for :add, d/y/p row ops, etc.) — the core
// returns true from handleKey only when it claimed the input.
//
// Selection state lives on this module (currentRow / currentCol) and
// is reflected on the DOM via the .vim-selected class. Calling reset()
// rebuilds the grid (used after page renders re-paint content).

(function () {
    'use strict';

    var grid = [];           // [{el, items: [...] }, ...]
    var currentRow = -1;     // -1 = nothing selected yet
    var currentCol = -1;

    var SELECTED_CLASS = 'vim-selected';

    function buildGrid() {
        grid = [];
        var rowEls = document.querySelectorAll('[data-vim-row]');
        for (var i = 0; i < rowEls.length; i++) {
            var rowEl = rowEls[i];
            // Skip rows that aren't visible — display:none parents shouldn't
            // contribute to the grid (e.g. inactive tab's content tree).
            if (!isVisible(rowEl)) continue;
            // Direct descendants with data-vim-item, in DOM order. We
            // intentionally don't descend through nested data-vim-row
            // containers — those are their own row.
            var items = [];
            var walker = document.createTreeWalker(rowEl, NodeFilter.SHOW_ELEMENT, {
                acceptNode: function (node) {
                    if (node === rowEl) return NodeFilter.FILTER_SKIP;
                    // Stop descending into nested rows — their items
                    // belong to that row, not this one.
                    if (node.hasAttribute('data-vim-row')) return NodeFilter.FILTER_REJECT;
                    if (node.hasAttribute('data-vim-item') && isVisible(node)) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_SKIP;
                },
            });
            var n;
            while ((n = walker.nextNode())) items.push(n);
            // A row with no inner items represents itself — the row IS
            // the navigable unit (tabular rows in tables, where each
            // <tr> is one record and h/l between cells isn't meaningful).
            // This makes j/k highlight the whole row instead of the
            // first cell.
            if (items.length === 0) items = [rowEl];
            grid.push({ el: rowEl, items: items });
        }
    }

    function isVisible(el) {
        // Skip elements hidden via display:none. visibility:hidden /
        // opacity:0 are allowed because they're occasionally used for
        // transition effects without removing the element from nav.
        for (var cur = el; cur && cur !== document.body; cur = cur.parentElement) {
            var s = window.getComputedStyle(cur);
            if (s && s.display === 'none') return false;
        }
        return true;
    }

    function clearSelection() {
        // Only clear .vim-selected from elements VimNav itself painted —
        // i.e. nodes inside a [data-vim-row] container, or row elements
        // themselves. Legacy per-view handlers (watchlist, screener, news
        // cards) set .vim-selected on plain rows that don't carry a
        // [data-vim-row] attribute; a blanket document-wide sweep would
        // wipe those every time the MutationObserver fires reset (mode
        // indicator updates, WS quote ticks, etc.), and the highlight
        // would seem to fade after a second or two.
        var sel = '[data-vim-row].' + SELECTED_CLASS + ', [data-vim-row] .' + SELECTED_CLASS;
        document.querySelectorAll(sel).forEach(function (el) {
            el.classList.remove(SELECTED_CLASS);
        });
    }

    function applySelection() {
        clearSelection();
        if (currentRow < 0 || currentRow >= grid.length) return;
        var row = grid[currentRow];
        if (currentCol < 0 || currentCol >= row.items.length) return;
        var el = row.items[currentCol];
        el.classList.add(SELECTED_CLASS);
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function selectFirst() {
        buildGrid();
        if (grid.length === 0) return;
        currentRow = 0;
        currentCol = 0;
        applySelection();
    }

    function selectLast() {
        buildGrid();
        if (grid.length === 0) return;
        currentRow = grid.length - 1;
        currentCol = grid[currentRow].items.length - 1;
        applySelection();
    }

    // Row down: move to row+1, column 0. j past the last row is a no-op
    // — by spec the page's last element is the bottom of nav.
    function moveDown() {
        buildGrid();
        if (grid.length === 0) return false;
        if (currentRow < 0) {
            currentRow = 0;
            currentCol = 0;
        } else if (currentRow < grid.length - 1) {
            currentRow++;
            currentCol = 0;
        } else {
            return true; // consumed but at end
        }
        applySelection();
        return true;
    }

    function moveUp() {
        buildGrid();
        if (grid.length === 0) return false;
        if (currentRow < 0) {
            currentRow = 0;
            currentCol = 0;
        } else if (currentRow > 0) {
            currentRow--;
            currentCol = 0;
        } else {
            return true;
        }
        applySelection();
        return true;
    }

    function moveRight() {
        buildGrid();
        if (grid.length === 0) return false;
        if (currentRow < 0) {
            currentRow = 0;
            currentCol = 0;
        } else {
            var row = grid[currentRow];
            if (currentCol < row.items.length - 1) currentCol++;
            else return true; // at end of row — by spec h/l doesn't wrap
        }
        applySelection();
        return true;
    }

    function moveLeft() {
        buildGrid();
        if (grid.length === 0) return false;
        if (currentRow < 0) {
            currentRow = 0;
            currentCol = 0;
        } else if (currentCol > 0) {
            currentCol--;
        } else {
            return true;
        }
        applySelection();
        return true;
    }

    // w — word forward. Linearised across all rows: end of row wraps
    // to next row's first item.
    function wordForward() {
        buildGrid();
        if (grid.length === 0) return false;
        if (currentRow < 0) {
            currentRow = 0;
            currentCol = 0;
        } else {
            var row = grid[currentRow];
            if (currentCol < row.items.length - 1) currentCol++;
            else if (currentRow < grid.length - 1) {
                currentRow++;
                currentCol = 0;
            } else return true;
        }
        applySelection();
        return true;
    }

    function wordBack() {
        buildGrid();
        if (grid.length === 0) return false;
        if (currentRow < 0) {
            currentRow = 0;
            currentCol = 0;
        } else if (currentCol > 0) {
            currentCol--;
        } else if (currentRow > 0) {
            currentRow--;
            currentCol = grid[currentRow].items.length - 1;
        } else return true;
        applySelection();
        return true;
    }

    // Numeric jump: select the nth tab. By convention the tab strip is
    // row 0 — every page that uses vim-nav puts data-vim-row on the
    // tab container first. This matches the long-standing "press 5 →
    // AI tab" affordance regardless of where the user currently is in
    // the page.
    function numericJump(n) {
        buildGrid();
        if (grid.length === 0) return false;
        var row = grid[0];
        if (n < 1 || n > row.items.length) return true;
        currentRow = 0;
        currentCol = n - 1;
        applySelection();
        // Fire the item's primary action — for tab strips that means
        // the tab actually switches, not just gets highlighted. Without
        // this, "press 2 → Financials tab" only paints a focus ring.
        activate();
        return true;
    }

    // Enter — fire the selected item's primary action.
    function activate() {
        if (currentRow < 0 || currentRow >= grid.length) return false;
        var row = grid[currentRow];
        if (currentCol < 0 || currentCol >= row.items.length) return false;
        var el = row.items[currentCol];
        var action = el.getAttribute('data-vim-action') || 'click';
        switch (action) {
            case 'none':
                return true;
            case 'click':
                el.click();
                return true;
            case 'toggle':
                // Toggle a collapsed/expanded state. Convention: the
                // element carries a sibling class to flip. Default is
                // .panel-open on the element itself.
                var cls = el.getAttribute('data-vim-toggle-class') || 'panel-open';
                el.classList.toggle(cls);
                return true;
            case 'open-reader':
                var url = el.getAttribute('data-vim-url') ||
                          (el.querySelector('a') && el.querySelector('a').href) || '';
                var title = el.getAttribute('data-vim-title') ||
                            (el.textContent || '').trim().slice(0, 200);
                if (url && window._openReader) window._openReader(url, title);
                return true;
            case 'navigate':
                var href = el.getAttribute('data-vim-href');
                if (href) window.location.href = href;
                return true;
            default:
                el.click();
                return true;
        }
    }

    // hasActiveGrid is the gate: if the page has any data-vim-row,
    // VimNav owns the directional keys. Otherwise it returns false
    // and terminal.js dispatches to legacy handlers untouched.
    function hasActiveGrid() {
        return document.querySelector('[data-vim-row]') !== null;
    }

    var NUMERIC_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

    function handleKey(key, e) {
        if (!hasActiveGrid()) {
            // No declarative nav on this page — let terminal.js's legacy
            // handler take the keys.
            return false;
        }
        switch (key) {
            case 'j':
                if (e) e.preventDefault();
                moveDown();
                return true;
            case 'k':
                if (e) e.preventDefault();
                moveUp();
                return true;
            case 'h':
                if (e) e.preventDefault();
                moveLeft();
                return true;
            case 'l':
                if (e) e.preventDefault();
                moveRight();
                return true;
            case 'w':
                if (e) e.preventDefault();
                wordForward();
                return true;
            case 'b':
                if (e) e.preventDefault();
                wordBack();
                return true;
            case 'Enter':
                if (currentRow < 0) return false;
                if (e) e.preventDefault();
                activate();
                return true;
        }
        if (NUMERIC_KEYS.indexOf(key) >= 0) {
            if (e) e.preventDefault();
            numericJump(parseInt(key, 10));
            return true;
        }
        // g / gg / G are handled by terminal.js so the gg-vs-legacy-g
        // 500ms timer can coexist with per-view graph-jump handlers.
        return false;
    }

    function reset() {
        // Called when a page repaints its content. We rebuild the grid
        // and try to preserve selection — if the previously selected
        // element survives the repaint we keep it; otherwise clear.
        var prevEl = null;
        if (currentRow >= 0 && grid[currentRow] && grid[currentRow].items[currentCol]) {
            prevEl = grid[currentRow].items[currentCol];
        }
        buildGrid();
        if (prevEl && document.contains(prevEl)) {
            // Find the new coordinates for the same element.
            for (var i = 0; i < grid.length; i++) {
                var idx = grid[i].items.indexOf(prevEl);
                if (idx >= 0) {
                    currentRow = i;
                    currentCol = idx;
                    applySelection();
                    return;
                }
            }
        }
        currentRow = -1;
        currentCol = -1;
        clearSelection();
    }

    // Auto-reset on DOM mutations to the main content area. Pages render
    // tab content via container.innerHTML = '...' — there's no clean way
    // to ask each render path to call reset() without scattering calls
    // through info.js, crypto.js, etc. A debounced MutationObserver on
    // #info-content (or document.body as a fallback) catches every paint
    // without per-page wiring.
    var resetTimer = null;
    function scheduleReset() {
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(function () {
            resetTimer = null;
            reset();
        }, 50);
    }

    function observeMutations() {
        var target = document.getElementById('info-content') || document.body;
        if (!target) return;
        var observer = new MutationObserver(function (mutations) {
            // Skip mutations that are just our own .vim-selected class
            // toggles — they'd trigger an infinite loop otherwise.
            for (var i = 0; i < mutations.length; i++) {
                var m = mutations[i];
                if (m.type === 'attributes' && m.attributeName === 'class') {
                    continue;
                }
                scheduleReset();
                return;
            }
        });
        observer.observe(target, {
            childList: true,
            subtree: true,
            attributes: false,
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observeMutations);
    } else {
        observeMutations();
    }

    window.VimNav = {
        handleKey: handleKey,
        reset: reset,
        selectFirst: selectFirst,
        selectLast: selectLast,
        hasActiveGrid: hasActiveGrid,
        // For debugging / tests.
        _state: function () {
            return { row: currentRow, col: currentCol, gridSize: grid.length };
        },
    };
})();
