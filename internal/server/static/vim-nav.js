// vim-nav.js — declarative vim navigation core (region model).
//
// Pages mark navigable structure with:
//   data-vim-region  on a container; its descendants carrying
//                    data-vim-item form one navigable region.
//   data-vim-axis    "x" (horizontal: tab strips, the company panel) or
//                    "y" (vertical: content lists / columns). Default "y"
//                    for data-vim-region. Legacy data-vim-row containers
//                    are treated as axis="x" regions for back-compat.
//   data-vim-role    "tabs" marks the tab-strip region — the target of
//                    numbered jumps (1-9) and the row-glow.
//   data-vim-scroll  on a content region whose body scrolls: j/k scroll
//                    it a step when there's no next item, so the bottom /
//                    off-screen elements are always reachable.
//   data-vim-item    each navigable element (DOM order).
//   data-vim-action  Enter behaviour: click|navigate|open-reader|
//                    open-external|toggle|none (default click).
//
// One rule, two shapes:
//   axis "x": h/l move the cursor WITHIN the region (across tabs);
//             j/k cross to the region below/above (regions are stacked).
//   axis "y": j/k move WITHIN the region (down a list / scroll); at the
//             edge they cross to the adjacent stacked region; h/l switch
//             to a horizontally-adjacent column region (set explicitly via
//             data-vim-col-group; no-op when there is none).
//
// Bespoke per-view handlers in terminal.js still run for non-nav keys
// (g graph-jump, a :add, d/y/p row ops) — handleKey returns true only
// when the core claimed the input.

(function () {
    'use strict';

    var regions = [];        // [{el, axis, role, scroll, group, items, cur}]
    var curR = -1;           // current region index; -1 = nothing selected
    var curI = -1;           // current item index within the region

    var SELECTED_CLASS = 'vim-selected';
    var TAB_STRIP_SEL = '#info-tabs, #fin-sub-tabs, #sec-filters, #news-sub-tabs, #news-tabs, .economics-tabs, [data-vim-role="tabs"]';

    function regionContainers() {
        return document.querySelectorAll('[data-vim-region], [data-vim-row]');
    }

    function buildRegions() {
        regions = [];
        var els = regionContainers();
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (!isVisible(el)) continue;
            // Legacy data-vim-row defaults to a horizontal region so existing
            // tab-strip pages behave byte-identically; data-vim-region defaults
            // to a vertical column.
            var axis = el.getAttribute('data-vim-axis');
            if (!axis) axis = el.hasAttribute('data-vim-region') ? 'y' : 'x';
            var role = el.getAttribute('data-vim-role') || '';
            var scroll = el.hasAttribute('data-vim-scroll');
            var group = el.getAttribute('data-vim-col-group') || '';

            var items = [];
            var walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, {
                acceptNode: function (node) {
                    if (node === el) return NodeFilter.FILTER_SKIP;
                    // Don't descend into nested regions — their items are theirs.
                    if (node.hasAttribute('data-vim-region') || node.hasAttribute('data-vim-row')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    if (node.hasAttribute('data-vim-item') && isVisible(node)) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_SKIP;
                },
            });
            var n;
            while ((n = walker.nextNode())) items.push(n);
            // A region with no inner items represents itself — the container IS
            // the navigable unit (tabular <tr> rows). Scroll regions are allowed
            // to have zero items (pure scroll surface).
            if (items.length === 0 && !scroll) items = [el];
            regions.push({ el: el, axis: axis, role: role, scroll: scroll, group: group, items: items, cur: 0 });
        }
    }

    function isVisible(el) {
        for (var cur = el; cur && cur !== document.body; cur = cur.parentElement) {
            var s = window.getComputedStyle(cur);
            if (s && s.display === 'none') return false;
        }
        return true;
    }

    function clearSelection() {
        var sel = '[data-vim-region].' + SELECTED_CLASS + ', [data-vim-region] .' + SELECTED_CLASS
            + ', [data-vim-row].' + SELECTED_CLASS + ', [data-vim-row] .' + SELECTED_CLASS;
        document.querySelectorAll(sel).forEach(function (el) {
            el.classList.remove(SELECTED_CLASS);
        });
        syncTabRowGlow(false);
    }

    // Tab strips get .tab-row-focused while the cursor is in them — drives
    // the orange (primary) / cyan (sub) row glow.
    function syncTabRowGlow(active) {
        var activeEl = null;
        if (active !== false && curR >= 0 && regions[curR]) activeEl = regions[curR].el;
        document.querySelectorAll(TAB_STRIP_SEL).forEach(function (el) {
            el.classList.toggle('tab-row-focused', el === activeEl);
        });
    }

    // Broadcast the resolved selection so pages can react without polling.
    function emitSelect(el) {
        try {
            document.dispatchEvent(new CustomEvent('vimnav:select', { detail: { el: el || null } }));
        } catch (e) { /* non-fatal */ }
    }

    function currentItemEl() {
        if (curR < 0 || curR >= regions.length) return null;
        var r = regions[curR];
        if (curI < 0 || curI >= r.items.length) return null;
        return r.items[curI];
    }

    function applySelection() {
        clearSelection();
        var el = currentItemEl();
        if (!el) { syncTabRowGlow(true); emitSelect(null); return; }
        el.classList.add(SELECTED_CLASS);
        // Tab strips live in fixed chrome — scrolling them shifts labels.
        if (!el.closest(TAB_STRIP_SEL)) {
            el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
        syncTabRowGlow(true);
        emitSelect(el);
    }

    // The "home" region for cold-start and gg: the tab strip if the page has
    // one (so a fresh page's first h/l walks the tabs, and the company panel
    // above them is reached with k), else the first region.
    function defaultRegionIndex() {
        for (var i = 0; i < regions.length; i++) {
            if (regions[i].role === 'tabs') return i;
        }
        return 0;
    }

    function selectFirst() {
        buildRegions();
        if (!regions.length) return;
        curR = defaultRegionIndex(); curI = 0; regions[curR].cur = 0;
        applySelection();
    }

    function selectLast() {
        buildRegions();
        if (!regions.length) return;
        curR = regions.length - 1;
        curI = Math.max(0, regions[curR].items.length - 1);
        regions[curR].cur = curI;
        applySelection();
    }

    function ensureCursorInBounds() {
        if (curR < 0 || curR >= regions.length) { curR = defaultRegionIndex(); curI = 0; return false; }
        if (curI < 0 || curI >= regions[curR].items.length) { curI = 0; return false; }
        return true;
    }

    // Move to a stacked-adjacent region (delta +1 = below/next, -1 = above).
    function crossRegion(delta) {
        var nr = curR + delta;
        if (nr < 0 || nr >= regions.length) return false;
        curR = nr;
        var r = regions[nr];
        curI = Math.min(Math.max(r.cur || 0, 0), Math.max(0, r.items.length - 1));
        r.cur = curI;
        return true;
    }

    // Scroll an element a step; returns false at the edge.
    function scrollElStep(el, delta) {
        if (!el) return false;
        var step = Math.max(40, Math.round(el.clientHeight * 0.85));
        var before = el.scrollTop;
        var max = el.scrollHeight - el.clientHeight;
        var target = Math.min(Math.max(before + delta * step, 0), max);
        if (target === before) return false;
        el.scrollTop = target;
        return true;
    }

    function scrollRegionStep(r, delta) { return scrollElStep(r.el, delta); }

    // Last-resort scroll so the bottom / off-screen content is always
    // reachable: when j/k can move no further through regions, scroll the
    // active content surface. Prefers a visible [data-vim-scroll], then the
    // standard content containers.
    function scrollFallback(delta) {
        var candidates = document.querySelectorAll('[data-vim-scroll], #info-content, .info-content, .terminal-body');
        for (var i = 0; i < candidates.length; i++) {
            var el = candidates[i];
            if (isVisible(el) && el.scrollHeight > el.clientHeight + 1) {
                return scrollElStep(el, delta);
            }
        }
        return false;
    }

    function moveVertical(delta) {
        buildRegions();
        if (!regions.length) return false;
        ensureCursorInBounds();
        var r = regions[curR];
        if (r.axis === 'y') {
            var ni = curI + delta;
            if (ni >= 0 && ni < r.items.length) { curI = ni; r.cur = ni; applySelection(); return true; }
            // At the item edge: scroll the region, else cross, else fall back
            // to scrolling the page content so the bottom stays reachable.
            if (r.scroll && scrollRegionStep(r, delta)) { applySelection(); return true; }
            if (crossRegion(delta)) { applySelection(); return true; }
            scrollFallback(delta);
            return true;
        }
        // axis x: j/k cross stacked regions; at the edge, scroll content.
        if (crossRegion(delta)) { applySelection(); return true; }
        scrollFallback(delta);
        return true;
    }

    function moveHorizontal(delta) {
        buildRegions();
        if (!regions.length) return false;
        ensureCursorInBounds();
        var r = regions[curR];
        if (r.axis === 'x') {
            var ni = curI + delta;
            if (ni >= 0 && ni < r.items.length) { curI = ni; r.cur = ni; applySelection(); }
            return true;
        }
        // axis y: h/l switch to a horizontally-adjacent column in the same
        // col-group. (No column groups yet → no-op; wired with the two-pane
        // migration.)
        if (r.group) {
            var step = delta > 0 ? 1 : -1;
            for (var k = curR + step; k >= 0 && k < regions.length; k += step) {
                if (regions[k].group === r.group) { crossRegion(k - curR); applySelection(); break; }
            }
        }
        return true;
    }

    // w/b — linearised across every item of every region.
    function wordForward() {
        buildRegions();
        if (!regions.length) return false;
        ensureCursorInBounds();
        var r = regions[curR];
        if (curI < r.items.length - 1) { curI++; r.cur = curI; }
        else if (curR < regions.length - 1) { curR++; curI = 0; regions[curR].cur = 0; }
        applySelection();
        return true;
    }

    function wordBack() {
        buildRegions();
        if (!regions.length) return false;
        ensureCursorInBounds();
        if (curI > 0) { curI--; regions[curR].cur = curI; }
        else if (curR > 0) { curR--; curI = Math.max(0, regions[curR].items.length - 1); regions[curR].cur = curI; }
        applySelection();
        return true;
    }

    // Numbered jump → the tab-strip region (data-vim-role="tabs", or the
    // first region as a fallback). Keeps "2 → Financials" working even when
    // the company panel is region 0.
    function numericJump(n) {
        buildRegions();
        if (!regions.length) return false;
        var tabsR = -1;
        for (var i = 0; i < regions.length; i++) {
            if (regions[i].role === 'tabs') { tabsR = i; break; }
        }
        if (tabsR < 0) tabsR = 0;
        var r = regions[tabsR];
        if (n < 1 || n > r.items.length) return true;
        curR = tabsR; curI = n - 1; r.cur = curI;
        applySelection();
        activate();
        return true;
    }

    function activate() {
        var el = currentItemEl();
        if (!el) return false;
        var action = el.getAttribute('data-vim-action') || 'click';
        switch (action) {
            case 'none':
                return true;
            case 'click':
                el.click();
                return true;
            case 'toggle':
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
            case 'open-external':
                var extUrl = el.getAttribute('data-vim-url') ||
                             (el.querySelector('a') && el.querySelector('a').href) || '';
                if (extUrl) window.open(extUrl, '_blank', 'noopener,noreferrer');
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

    // The gate: any declarative region means VimNav owns directional keys.
    function hasActiveGrid() {
        return document.querySelector('[data-vim-region], [data-vim-row]') !== null;
    }

    // Selection snapshot for per-view command keys (d/y/p/c/x/a/w) that used
    // to read bespoke indices. region = data-vim-role or '' for the region.
    function getSelected() {
        var el = currentItemEl();
        if (!el) return null;
        var r = regions[curR];
        return { el: el, region: (r && r.role) || '', axis: (r && r.axis) || '', index: curI };
    }

    var NUMERIC_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

    function handleKey(key, e) {
        if (!hasActiveGrid()) return false;
        switch (key) {
            case 'j': if (e) e.preventDefault(); moveVertical(1); return true;
            case 'k': if (e) e.preventDefault(); moveVertical(-1); return true;
            case 'l': if (e) e.preventDefault(); moveHorizontal(1); return true;
            case 'h': if (e) e.preventDefault(); moveHorizontal(-1); return true;
            case 'w': if (e) e.preventDefault(); wordForward(); return true;
            case 'b': if (e) e.preventDefault(); wordBack(); return true;
            case 'Enter':
                if (curR < 0) return false;
                if (e) e.preventDefault();
                activate();
                return true;
        }
        if (NUMERIC_KEYS.indexOf(key) >= 0) {
            if (e) e.preventDefault();
            numericJump(parseInt(key, 10));
            return true;
        }
        // g / gg / G handled by terminal.js (500ms gg timer coexists with
        // per-view graph-jump).
        return false;
    }

    function reset() {
        var prevEl = currentItemEl();
        buildRegions();
        if (prevEl && document.contains(prevEl)) {
            for (var i = 0; i < regions.length; i++) {
                var idx = regions[i].items.indexOf(prevEl);
                if (idx >= 0) { curR = i; curI = idx; regions[i].cur = idx; applySelection(); return; }
            }
        }
        curR = -1; curI = -1;
        clearSelection();
        emitSelect(null);
    }

    var resetTimer = null;
    function scheduleReset() {
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(function () { resetTimer = null; reset(); }, 50);
    }

    function observeMutations() {
        // Observe the whole content area: column pages re-render their lists
        // (#quote-body, #ideas-list, #news-cards) outside #info-content, so a
        // narrow target would miss those repaints. Body is the safe superset;
        // the class-mutation skip below keeps it cheap.
        var target = document.querySelector('.terminal-body') || document.body;
        if (!target) return;
        var observer = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                if (mutations[i].type === 'attributes' && mutations[i].attributeName === 'class') continue;
                scheduleReset();
                return;
            }
        });
        observer.observe(target, { childList: true, subtree: true, attributes: false });
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
        getSelected: getSelected,
        _state: function () { return { row: curR, col: curI, gridSize: regions.length }; },
    };
})();
