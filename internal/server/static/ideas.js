// Ideas / Sketchpad — comparative graph of multiple metrics rebased to 100.
// Up to 3 series shown legibly; metrics persisted as named "sketches" owned
// by the global user.

(function () {
    'use strict';

    var SERIES_COLORS = ['#ff8800', '#4499ff', '#00cc66', '#bb88ff', '#ccaa00'];
    var MAX_SERIES = 3;

    var sidebarEl = document.getElementById('ideas-sidebar');
    var listEl = document.getElementById('ideas-list');
    var titleEl = document.getElementById('ideas-title');
    var metaEl = document.getElementById('ideas-meta');
    var hostEl = document.getElementById('ideas-chart-host');
    var legendEl = document.getElementById('ideas-legend');
    var emptyEl = document.getElementById('ideas-empty');
    var script = document.currentScript;
    var initialSketchID = (script && script.dataset.sketchId) ? script.dataset.sketchId : '';

    // ── State ──
    var currentSketch = null;     // {id, name, metrics: [...]}
    var seriesData = {};          // metricId/identifier → array of {date, value}
    var chart = null;
    var seriesByID = {};          // metricId → LineSeries handle (for cleanup)
    var sketches = [];            // sidebar list
    var listSelectedIdx = -1;

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmtAxisValue(v) {
        var abs = Math.abs(v);
        if (abs >= 1e12) return (v / 1e12).toFixed(1) + 'T';
        if (abs >= 1e9)  return (v / 1e9).toFixed(1) + 'B';
        if (abs >= 1e6)  return (v / 1e6).toFixed(1) + 'M';
        if (abs >= 1e3)  return (v / 1e3).toFixed(1) + 'k';
        if (abs >= 1)    return v.toFixed(2);
        return v.toFixed(4);
    }

    // ── Sidebar (saved sketches) ──

    function loadSketches() {
        return fetch('/api/sketches')
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (list) {
                sketches = list || [];
                renderSidebar();
                return sketches;
            })
            .catch(function () { return []; });
    }

    function renderSidebar() {
        var countEl = document.getElementById('ideas-sketch-count');
        if (countEl) countEl.textContent = sketches.length ? sketches.length + ' saved' : '';

        if (!sketches.length) {
            listEl.innerHTML = '<li class="empty-state">No saved sketches yet.</li>';
            return;
        }
        var defaultRow = '<li class="ideas-list-item' + (currentSketch && !currentSketch.id ? ' active' : '') + '" data-sketch-id="">'
            + '<span class="ideas-list-name">Default</span>'
            + '<span class="ideas-list-meta">scratchpad</span></li>';
        listEl.innerHTML = defaultRow + sketches.map(function (sk) {
            var active = currentSketch && currentSketch.id === sk.id ? ' active' : '';
            var when = sk.updatedAt ? new Date(sk.updatedAt).toLocaleDateString() : '';
            return '<li class="ideas-list-item' + active + '" data-sketch-id="' + sk.id + '">'
                + '<span class="ideas-list-name">' + esc(sk.name || '(untitled)') + '</span>'
                + '<span class="ideas-list-meta">' + esc(when) + '</span>'
                + '</li>';
        }).join('');

        Array.from(listEl.querySelectorAll('.ideas-list-item')).forEach(function (el) {
            el.onclick = function () {
                var sid = el.dataset.sketchId;
                navigateToSketch(sid);
            };
        });
    }

    function navigateToSketch(id) {
        var path = id ? '/ideas/' + id : '/ideas';
        if (id) localStorage.setItem('stocktopus-last-sketch', id);
        if (window.history && window.history.pushState) {
            history.pushState({ view: 'ideas', sketchId: id || '' }, '', path);
        }
        loadSketch(id);
    }

    // ── Sketch loading ──

    function loadSketch(id) {
        // Reset chart + state
        disposeChart();
        seriesData = {};
        seriesByID = {};
        seriesErrors = {};

        if (!id) {
            currentSketch = { id: 0, name: '', metrics: [] };
            renderSketch();
            return;
        }
        if (id) localStorage.setItem('stocktopus-last-sketch', String(id));
        return fetch('/api/sketches/' + id)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (sk) {
                if (!sk) {
                    // Sketch missing — clear last-used so we don't dead-end
                    // every future :add at this id.
                    localStorage.removeItem('stocktopus-last-sketch');
                    currentSketch = { id: 0, name: '', metrics: [] };
                    renderSketch();
                    return;
                }
                currentSketch = sk;
                renderSketch();
                return Promise.all((sk.metrics || []).map(fetchMetricData))
                    .then(rebuildChart);
            });
    }

    function renderSketch() {
        titleEl.textContent = (currentSketch && currentSketch.name) || 'Default Sketchpad';
        var n = (currentSketch.metrics || []).length;
        metaEl.textContent = n ? n + ' metric' + (n === 1 ? '' : 's') : 'no metrics yet';
        emptyEl.style.display = n ? 'none' : 'block';
        hostEl.style.display = n ? 'block' : 'none';
        renderLegend();
        renderSidebar();
        var notesEl = document.getElementById('ideas-notes-textarea');
        if (notesEl) notesEl.value = (currentSketch && currentSketch.notes) || '';
    }

    function renderLegend() {
        var metrics = (currentSketch && currentSketch.metrics) || [];
        if (!metrics.length) { legendEl.innerHTML = ''; return; }
        legendEl.innerHTML = metrics.map(function (m, i) {
            var data = seriesData[m.id] || [];
            var err = seriesErrors[m.id];
            var color = m.color || SERIES_COLORS[i % SERIES_COLORS.length];
            var labelHTML = '<span class="ideas-legend-swatch" style="background:' + esc(color) + '"></span>'
                + '<span class="ideas-legend-label">' + esc(m.label || m.identifier) + '</span>';
            var rightHTML;
            if (err) {
                rightHTML = '<span class="ideas-legend-err">' + esc(err) + '</span>';
            } else {
                var firstVal = data.length ? data[0].value : null;
                var lastVal = data.length ? data[data.length - 1].value : null;
                // Normalize by |firstVal| so sign reflects direction of change,
                // not the sign of (a/b) where both are negative.
                var pct = (firstVal != null && lastVal != null && firstVal !== 0)
                    ? ((lastVal - firstVal) / Math.abs(firstVal) * 100) : null;
                var pctClass = pct == null ? '' : (pct >= 0 ? 'price-up' : 'price-down');
                var pctStr = pct == null ? '—' : (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
                var lastStr = lastVal == null ? '—' : fmtAxisValue(lastVal);
                rightHTML = '<span class="ideas-legend-val">' + esc(lastStr) + '</span>'
                    + '<span class="ideas-legend-pct ' + pctClass + '">' + pctStr + '</span>';
            }
            return '<div class="ideas-legend-row' + (err ? ' ideas-legend-row-err' : '') + '" data-metric-id="' + m.id + '">'
                + labelHTML
                + rightHTML
                + '<button class="ideas-legend-del" data-metric-id="' + m.id + '" title="remove">×</button>'
                + '</div>';
        }).join('');

        Array.from(legendEl.querySelectorAll('.ideas-legend-del')).forEach(function (btn) {
            btn.onclick = function () { removeMetric(parseInt(btn.dataset.metricId, 10)); };
        });
    }

    // ── Data fetch ──

    var seriesErrors = {}; // metricId → human-readable error reason

    function fetchMetricData(m) {
        var url;
        if (m.kind === 'financial') {
            url = '/api/historical/financial/' + encodeURIComponent(m.identifier);
        } else {
            url = '/api/historical/' + encodeURIComponent(m.kind) + '/' + encodeURIComponent(m.identifier);
        }
        return fetch(url)
            .then(function (r) {
                if (!r.ok) {
                    return r.text().then(function (text) {
                        // FMP free tier returns 402 for commodities/forex/crypto historical.
                        // Surface that to the user instead of silently rendering nothing.
                        var reason = 'unavailable';
                        if (/Premium|subscription/i.test(text)) reason = 'premium FMP plan required';
                        else if (r.status === 502 || r.status === 503) reason = 'data source error';
                        else if (r.status === 404) reason = 'symbol not found';
                        seriesErrors[m.id] = reason;
                        return null;
                    });
                }
                seriesErrors[m.id] = null;
                return r.json();
            })
            .then(function (rows) {
                if (!Array.isArray(rows)) { seriesData[m.id] = []; return []; }
                var out = rows.map(function (row) {
                    var date = row.date || row.fiscalYear || '';
                    if (date && date.length > 10) date = date.substring(0, 10);
                    var v = row.value != null ? row.value :
                            row.price != null ? row.price :
                            row.close != null ? row.close : null;
                    return { date: date, value: Number(v) };
                }).filter(function (p) {
                    return p.date && !isNaN(p.value);
                });
                var cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 5);
                var cutoffStr = cutoff.toISOString().substring(0, 10);
                out = out.filter(function (p) { return p.date >= cutoffStr; });
                out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
                seriesData[m.id] = out;
                return out;
            })
            .catch(function () {
                seriesErrors[m.id] = 'fetch failed';
                seriesData[m.id] = [];
                return [];
            });
    }

    // ── Chart rendering ──

    function disposeChart() {
        if (chart) { try { chart.remove(); } catch (e) {} chart = null; }
        seriesByID = {};
    }

    function ensureChart() {
        if (chart) return chart;
        if (!window.LightweightCharts || !hostEl) return null;
        chart = LightweightCharts.createChart(hostEl, {
            layout: { background: { color: '#0a0a0a' }, textColor: '#888888', fontFamily: "'SF Mono','Consolas',monospace", fontSize: 11, attributionLogo: false },
            grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
            crosshair: { mode: LightweightCharts.CrosshairMode.Magnet, vertLine: { color: '#555', style: 2 }, horzLine: { color: '#555', style: 2 } },
            rightPriceScale: { borderColor: '#2a2a2a' },
            timeScale: { borderColor: '#2a2a2a', timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
        });
        return chart;
    }

    var firstSeries = null;
    var lastCrosshairValue = null;
    var priceLines = [];

    function rebuildChart() {
        var metrics = (currentSketch && currentSketch.metrics) || [];
        disposeChart();
        if (!metrics.length) { renderLegend(); return; }
        var c = ensureChart();
        if (!c) return;

        firstSeries = null;
        priceLines = [];
        metrics.slice(0, MAX_SERIES).forEach(function (m, i) {
            var data = seriesData[m.id] || [];
            if (data.length < 2) return;
            // Plot % change from start: (value - base) / |base| * 100.
            // 0 = baseline; +X% = improvement; -X% = decline. Works for any
            // sign — when base is negative (e.g. DJT operating income), a
            // larger loss correctly plots as more negative, not more positive.
            var base = data[0].value;
            if (!base) return;
            var absBase = Math.abs(base);
            var rebased = data.map(function (p) {
                return { time: p.date, value: ((p.value - base) / absBase) * 100 };
            });
            var color = m.color || SERIES_COLORS[i % SERIES_COLORS.length];
            var s = c.addSeries(LightweightCharts.LineSeries, {
                color: color,
                lineWidth: 2,
                priceFormat: { type: 'custom', formatter: function (v) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; }, minMove: 0.1 },
            });
            s.setData(rebased);
            seriesByID[m.id] = s;
            if (!firstSeries) firstSeries = s;
        });
        // Add a baseline at 0 to make "no change" visible.
        if (firstSeries) {
            firstSeries.createPriceLine({ price: 0, color: '#444', lineWidth: 1, lineStyle: 1, axisLabelVisible: false });
        }
        c.timeScale().fitContent();

        // Track the crosshair so 'h' can drop a horizontal line at the hovered price.
        c.subscribeCrosshairMove(function (param) {
            if (!param || !firstSeries) { lastCrosshairValue = null; return; }
            var v = param.seriesData && param.seriesData.get && param.seriesData.get(firstSeries);
            if (v && typeof v.value === 'number') {
                lastCrosshairValue = v.value;
            }
        });

        renderLegend();
    }

    // Drop a horizontal price line at the last crosshair value (or midpoint if
    // the user hasn't hovered the chart yet). Press 'h' again to add another.
    window._ideasDrawHline = function () {
        if (!chart || !firstSeries) return;
        var price = lastCrosshairValue;
        if (price == null) {
            // Default to the mid of the visible price range so the line is on screen.
            var range = firstSeries.priceScale ? firstSeries.priceScale().priceRange() : null;
            price = range ? (range.minValue + range.maxValue) / 2 : 100;
        }
        var line = firstSeries.createPriceLine({
            price: price,
            color: '#ff8800',
            lineWidth: 1,
            lineStyle: 2, // dashed
            axisLabelVisible: true,
            title: price.toFixed(1),
        });
        priceLines.push(line);
    };

    window._ideasClearLines = function () {
        if (!firstSeries) return;
        priceLines.forEach(function (line) { try { firstSeries.removePriceLine(line); } catch (e) {} });
        priceLines = [];
    };

    // ── Metric add / remove ──

    function ensureSketch() {
        if (currentSketch && currentSketch.id) return Promise.resolve(currentSketch);
        // Lazy-create the default sketch on first :add so we have a place to persist to.
        return fetch('/api/sketches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Untitled' }),
        }).then(function (r) { return r.json(); })
        .then(function (resp) {
            return fetch('/api/sketches/' + resp.id).then(function (r) { return r.json(); });
        }).then(function (sk) {
            currentSketch = sk;
            localStorage.setItem('stocktopus-last-sketch', String(sk.id));
            history.replaceState({ view: 'ideas', sketchId: String(sk.id) }, '', '/ideas/' + sk.id);
            return sk;
        });
    }

    function addMetric(parsed) {
        return ensureSketch().then(function (sk) {
            // Leave color empty so the server picks an unused palette entry —
            // single source of truth for colour selection.
            var body = { kind: parsed.kind, identifier: parsed.identifier, label: parsed.label || parsed.identifier };
            return fetch('/api/sketches/' + sk.id + '/metrics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }).then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
            .then(function () { return loadSketches(); })
            .then(function () { return loadSketch(sk.id); });
        });
    }

    function removeMetric(metricId) {
        if (!currentSketch || !currentSketch.id) return;
        fetch('/api/sketches/' + currentSketch.id + '/metrics/' + metricId, { method: 'DELETE' })
            .then(function () { return loadSketch(currentSketch.id); });
    }

    // ── :add parser — exposed for terminal.js ──
    //
    //   :add AAPL              → {kind:'price', identifier:'AAPL'}
    //   :add AAPL.revenue      → {kind:'financial', identifier:'AAPL.revenue'}
    //   :add GCUSD             → {kind:'commodity', identifier:'GCUSD'}    (heuristic)
    //   :add EURUSD            → {kind:'forex', identifier:'EURUSD'}
    //   :add BTCUSD            → {kind:'crypto', identifier:'BTCUSD'}
    //   :add (with selectedSecurity) → uses the picker's symbol as price
    //
    function parseAddArg(arg, fallbackSymbol) {
        var raw = (arg || '').trim();
        if (!raw) {
            if (!fallbackSymbol) return null;
            return { kind: 'price', identifier: fallbackSymbol, label: fallbackSymbol };
        }
        // Economic-catalog lookup runs FIRST — codes like "US.UNRATE" contain
        // a dot and would otherwise be misread as SYMBOL.field. Bare "UNRATE"
        // also resolves (v1 has one country). Server emits canonical "US.UNRATE".
        var econCat = window._econCatalog || {};
        var econHit = econCat[raw.toUpperCase()];
        if (econHit) {
            var ecoId = (econHit.identifier || (econHit.country + '.' + econHit.code)).toUpperCase();
            return { kind: 'economic', identifier: ecoId, label: econHit.name || ecoId };
        }
        // Tickers can contain periods (BRK.A, BRK.B, GOOG.L), so split on the
        // *rightmost* dot — everything after is the FMP field name (camelCase,
        // case-sensitive). Examples:
        //   AAPL.revenue              → AAPL + revenue
        //   BRK.A.researchExpenses    → BRK.A + researchExpenses
        var dot = raw.lastIndexOf('.');
        if (dot > 0 && dot < raw.length - 1) {
            var sym = raw.substring(0, dot).toUpperCase();
            var field = raw.substring(dot + 1); // preserve case
            return { kind: 'financial', identifier: sym + '.' + field, label: sym + ' ' + field };
        }
        var s = raw.toUpperCase();
        // Heuristic classification by suffix:
        //   USD-suffixed crypto (BTCUSD, ETHUSD), forex pairs (EURUSD, GBPUSD),
        //   commodity codes (GCUSD, CLUSD, SIUSD). No clean way to tell — try
        //   commodity for known codes, forex for currency pairs, otherwise stock.
        var commodityPrefixes = ['GC','SI','CL','NG','HG','PL','PA','BZ','HO','RB','ZC','ZW','ZS','KC','SB','CC','CT'];
        var forexCurrencies = ['USD','EUR','GBP','JPY','AUD','CAD','CHF','CNY','HKD','NZD','SEK','NOK','SGD','MXN'];
        if (s.length === 5 && s.endsWith('USD')) {
            var prefix = s.substring(0, s.length - 3);
            if (commodityPrefixes.indexOf(prefix) >= 0) {
                return { kind: 'commodity', identifier: s, label: s };
            }
        }
        if (s.length === 6) {
            var a = s.substring(0, 3), b = s.substring(3);
            if (forexCurrencies.indexOf(a) >= 0 && forexCurrencies.indexOf(b) >= 0) {
                return { kind: 'forex', identifier: s, label: a + '/' + b };
            }
            // Crypto pairs like BTCUSD, ETHUSD, SOLUSD — three-letter base + USD/USDT
            if (b === 'USD' || b === 'EUR') {
                return { kind: 'crypto', identifier: s, label: s };
            }
        }
        return { kind: 'price', identifier: s, label: s };
    }


    // ── Public hooks ──
    window._ideasAdd = function (arg, fallbackSymbol, toSketchName) {
        var parsed = parseAddArg(arg, fallbackSymbol);
        if (!parsed) return Promise.reject(new Error('no symbol'));
        // Wait for initial loadSketches/loadSketch to finish so we don't race
        // the default-sketchpad render against ensureSketch's POST.
        return initPromise.then(function () {
            if (toSketchName) {
                var target = matchSketchByName(toSketchName);
                if (target) {
                    // Add to the named sketch (might be different from current)
                    return addMetricToSketch(target.id, parsed).then(function () {
                        return navigateToSketch(String(target.id));
                    });
                }
                // Fall through if no name matched — silent: just add to current.
            }
            return addMetric(parsed);
        });
    };

    function matchSketchByName(name) {
        var lower = name.toLowerCase();
        var exact = sketches.find(function (sk) { return sk.name.toLowerCase() === lower; });
        if (exact) return exact;
        return sketches.find(function (sk) { return sk.name.toLowerCase().indexOf(lower) === 0; });
    }

    function addMetricToSketch(sketchID, parsed) {
        var body = { kind: parsed.kind, identifier: parsed.identifier, label: parsed.label || parsed.identifier };
        return fetch('/api/sketches/' + sketchID + '/metrics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then(function (r) { return r.ok ? r.json() : Promise.reject(r); });
    }

    window._ideasIsActive = function () {
        return document.getElementById('ideas-chart-host') != null;
    };

    // Used by terminal.js to autocomplete ":add ... to <sketch>" — exposes the
    // current sketches list (excluding the in-memory default scratchpad).
    window._ideasGetSketches = function () {
        return (sketches || []).slice();
    };

    // ── Three-pane vim navigation: list ↔ chart ↔ notes ──
    //
    // Pane state machine:
    //   focus = 'list'  → j/k navigate sketches sidebar; Enter loads
    //   focus = 'chart' → j/k navigate metrics in the legend; d removes
    //   focus = 'notes' → l from chart focuses the textarea (insert mode);
    //                     Esc returns to 'notes' state in normal mode
    //   h/l moves between panes; visual outline highlights the active one.
    var paneFocus = 'list';
    var metricSelectedIdx = -1;

    function highlightPane() {
        document.getElementById('ideas-sidebar').classList.toggle('pane-focused', paneFocus === 'list');
        document.getElementById('ideas-main').classList.toggle('pane-focused', paneFocus === 'chart');
        var notesPanel = document.getElementById('ideas-notes-panel');
        if (notesPanel) notesPanel.classList.toggle('pane-focused', paneFocus === 'notes');
    }

    function getMetricRows() {
        return Array.from(document.querySelectorAll('#ideas-legend .ideas-legend-row'));
    }
    function selectMetric(i) {
        var rows = getMetricRows();
        if (!rows.length) { metricSelectedIdx = -1; return; }
        metricSelectedIdx = Math.max(0, Math.min(i, rows.length - 1));
        rows.forEach(function (el, idx) { el.classList.toggle('vim-selected', idx === metricSelectedIdx); });
    }
    function clearMetricSelection() {
        getMetricRows().forEach(function (el) { el.classList.remove('vim-selected'); });
        metricSelectedIdx = -1;
    }

    window._ideasMove = function (dir) {
        if (dir === 'h' || dir === 'l') {
            // Cross-pane move
            var order = ['list', 'chart', 'notes'];
            var idx = order.indexOf(paneFocus);
            if (dir === 'l') idx = Math.min(idx + 1, order.length - 1);
            else idx = Math.max(idx - 1, 0);
            var newFocus = order[idx];
            if (newFocus === paneFocus) return;
            paneFocus = newFocus;
            // Keep selections intact when leaving — re-highlight on entry.
            if (paneFocus === 'chart') {
                if (metricSelectedIdx < 0) selectMetric(0);
                else selectMetric(metricSelectedIdx);
            } else {
                clearMetricSelection();
            }
            if (paneFocus === 'notes') {
                var ta = document.getElementById('ideas-notes-textarea');
                if (ta) ta.focus();
            }
            highlightPane();
            return;
        }
        if (dir === 'j' || dir === 'k') {
            if (paneFocus === 'list') {
                var items = Array.from(document.querySelectorAll('#ideas-list .ideas-list-item'));
                if (!items.length) return;
                if (dir === 'j') listSelectedIdx = Math.min(listSelectedIdx + 1, items.length - 1);
                else listSelectedIdx = Math.max(listSelectedIdx - 1, 0);
                items.forEach(function (el, i) { el.classList.toggle('vim-selected', i === listSelectedIdx); });
                if (items[listSelectedIdx]) items[listSelectedIdx].scrollIntoView({ block: 'nearest' });
            } else if (paneFocus === 'chart') {
                var rows = getMetricRows();
                if (!rows.length) return;
                var next = dir === 'j' ? metricSelectedIdx + 1 : metricSelectedIdx - 1;
                selectMetric(next);
            }
            // 'notes' pane intentionally ignores j/k — let the textarea handle keys
            // when focused (insert mode), or do nothing in normal mode.
        }
    };

    window._ideasActivate = function () {
        if (paneFocus === 'list') {
            var items = Array.from(document.querySelectorAll('#ideas-list .ideas-list-item'));
            if (listSelectedIdx >= 0 && listSelectedIdx < items.length) {
                navigateToSketch(items[listSelectedIdx].dataset.sketchId);
            }
        }
        // chart/notes have no Enter action right now — chart 'd' deletes,
        // notes is text-edit only.
    };

    window._ideasDeleteSelected = function () {
        if (paneFocus === 'list') return deleteSelectedSketch();
        if (paneFocus !== 'chart') return false;
        var rows = getMetricRows();
        if (metricSelectedIdx < 0 || metricSelectedIdx >= rows.length) return false;
        var metricId = parseInt(rows[metricSelectedIdx].dataset.metricId, 10);
        if (!metricId) return false;
        // Drop selection so the next render doesn't try to re-highlight a missing row
        var keepIdx = metricSelectedIdx;
        clearMetricSelection();
        removeMetric(metricId);
        // After re-render, snap selection to the row that took the deleted slot
        // (or the new last row if the deleted one was last).
        setTimeout(function () {
            var newRows = getMetricRows();
            if (!newRows.length) return;
            selectMetric(Math.min(keepIdx, newRows.length - 1));
        }, 100);
        return true;
    };

    // Delete the highlighted sketch from the sidebar. Skips the synthetic
    // "Default" row (data-sketch-id="") — that's the scratchpad and can't be
    // removed. Cursor stays on the same visual index after re-render so j/k
    // continue without surprise.
    function deleteSelectedSketch() {
        var items = Array.from(document.querySelectorAll('#ideas-list .ideas-list-item'));
        if (listSelectedIdx < 0 || listSelectedIdx >= items.length) return false;
        var row = items[listSelectedIdx];
        var sid = row.dataset.sketchId;
        if (!sid) {
            if (window._flash) window._flash('Default scratchpad can\'t be deleted');
            return true;
        }
        var name = row.querySelector('.ideas-list-name');
        var label = name ? name.textContent : sid;
        var wasLoaded = currentSketch && currentSketch.id && String(currentSketch.id) === String(sid);
        var keepIdx = listSelectedIdx;

        fetch('/api/sketches/' + sid, { method: 'DELETE' })
            .then(function (r) {
                if (!r.ok) throw new Error('delete ' + r.status);
                if (window._flash) window._flash('Deleted ' + label);
                if (wasLoaded) {
                    // The deleted sketch was the one on the chart — clear the
                    // canvas and drop the persisted "last sketch" pointer so
                    // we don't dead-end the next page load on a missing id.
                    localStorage.removeItem('stocktopus-last-sketch');
                    currentSketch = { id: 0, name: '', metrics: [] };
                }
                return loadSketches();
            })
            .then(function () {
                // Re-select the row that took the deleted slot, or move up
                // if the deleted row was the last.
                var newItems = Array.from(document.querySelectorAll('#ideas-list .ideas-list-item'));
                if (!newItems.length) return;
                listSelectedIdx = Math.min(keepIdx, newItems.length - 1);
                newItems.forEach(function (el, i) { el.classList.toggle('vim-selected', i === listSelectedIdx); });
                // If the deleted sketch was loaded, navigate to whatever now
                // sits at the cursor (could be Default if all customs are gone).
                if (wasLoaded && newItems[listSelectedIdx]) {
                    navigateToSketch(newItems[listSelectedIdx].dataset.sketchId);
                }
            })
            .catch(function () { if (window._flash) window._flash('Delete failed for ' + label); });
        return true;
    }

    window._ideasGetPaneFocus = function () { return paneFocus; };

    window._ideasToggleHelp = function () {
        var el = document.getElementById('ideas-help');
        if (el) el.classList.toggle('hidden');
    };

    // Expose the legacy single-pane fns for backward compat with terminal.js
    window._ideasMoveList = function (dir) { window._ideasMove(dir); };
    window._ideasActivateList = function () { window._ideasActivate(); };

    // Initial visual state
    highlightPane();

    window._ideasSave = function (name) {
        return ensureSketch().then(function (sk) {
            var newName = (name || '').trim() || sk.name || 'Untitled';
            return fetch('/api/sketches/' + sk.id, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName }),
            }).then(function () {
                currentSketch.name = newName;
                renderSketch();
                return loadSketches();
            });
        });
    };

    // ── Init ──

    // Notes textarea — debounced save to avoid hammering the server on each keystroke.
    var notesSaveTimer = null;
    var notesEl = document.getElementById('ideas-notes-textarea');
    if (notesEl) {
        notesEl.addEventListener('input', function () {
            clearTimeout(notesSaveTimer);
            notesSaveTimer = setTimeout(function () {
                if (!currentSketch || !currentSketch.id) return; // can't persist on default scratchpad
                fetch('/api/sketches/' + currentSketch.id + '/notes', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ notes: notesEl.value }),
                });
                if (currentSketch) currentSketch.notes = notesEl.value;
            }, 600);
        });
    }

    var initPromise = loadSketches().then(function () {
        return loadSketch(initialSketchID);
    });
})();
