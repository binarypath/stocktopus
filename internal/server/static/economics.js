// /economics page — Calendar (FMP releases) + Catalog (FRED curated, drill
// down by central bank).
//
// Vim model:
//   h / l       → switch tabs (or go back from indicator list to CB list)
//   j / k       → row navigation
//   /           → focus the visible tab's filter input (per-view binding)
//   a           → prefill :add COUNTRY.CODE in cmd-bar, stay on page
//   p / g       → slide-in chart preview (5y / full) in the article-reader
//                 pane shared with financials
//   Enter       → no-op for now (reserved for future drill-in)
(function () {
    // ── State ──
    var activeTab = 'calendar';

    var calendarRows = [];
    var calendarFiltered = [];
    var calendarFilter = '';
    var calendarImpact = 'all';

    // Catalog drill-down state.
    //   level: 'cb' (central-bank list) | 'indicators' (one CB's indicator list)
    var catalogLevel = 'cb';
    var catalogCBs = [];
    var catalogCountry = '';

    var catalogRows = [];
    var catalogFiltered = [];
    var catalogFilter = '';

    // Selection is owned by vim-nav.js via the .vim-selected class on a
    // [data-vim-row] element. Page-specific hooks read the selected row
    // through helpers below; no per-list integer indices kept here.

    function $(id) { return document.getElementById(id); }
    function escapeHTML(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function fmt(num, units) {
        if (num === null || num === undefined || isNaN(num)) return '—';
        var n = Number(num);
        var abs = Math.abs(n);
        var s = abs >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 })
              : abs >= 10   ? n.toFixed(1)
                            : n.toFixed(2);
        return units && units !== 'Index' ? s + ' ' + units : s;
    }

    // ── Tab switching ──

    function switchTab(name) {
        activeTab = name;
        document.querySelectorAll('#economics-tabs .economics-tab').forEach(function (btn) {
            var on = btn.dataset.tab === name;
            // Dual-write legacy + design-system active class so both
            // selectors stay in sync during migration.
            btn.classList.toggle('active', on);
            btn.classList.toggle('st-tab--active', on);
        });
        $('economics-calendar-panel').classList.toggle('hidden', name !== 'calendar');
        $('economics-catalog-panel').classList.toggle('hidden', name !== 'catalog');
    }

    // ── Calendar filter directive parsing ──
    //
    // Tokens prefixed with ':' are *directives*; everything else is free-text
    // event match. Repeating a directive type keeps the last one (so typing
    // `:high :low` filters to Low — same UX as a vim mode switch).
    //
    //   :high :medium :low :all  → impact filter
    //   :us :uk :eu :jp …        → country filter (ISO-2)
    //   free text                → contained in event/country/impact

    function parseCalendarFilter(s) {
        var impact = null;
        var country = null;
        var freeParts = [];
        s.split(/\s+/).forEach(function (tok) {
            if (!tok) return;
            if (tok[0] === ':') {
                var rest = tok.slice(1).toLowerCase();
                if (rest === 'high' || rest === 'medium' || rest === 'low' || rest === 'all') {
                    impact = rest === 'all' ? 'all' : rest.charAt(0).toUpperCase() + rest.slice(1);
                } else if (rest.length >= 2 && rest.length <= 3) {
                    country = rest.toUpperCase();
                }
            } else {
                freeParts.push(tok.toLowerCase());
            }
        });
        return { impact: impact, country: country, free: freeParts.join(' ').trim() };
    }

    // ── Calendar tab ──

    function loadCalendar() {
        fetch('/api/economics/calendar')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                calendarRows = Array.isArray(data) ? data : [];
                var now = new Date();
                calendarRows.sort(function (a, b) {
                    var da = new Date(a.date), db = new Date(b.date);
                    var afut = da >= now, bfut = db >= now;
                    if (afut !== bfut) return afut ? -1 : 1;
                    return afut ? da - db : db - da;
                });
                renderCalendar();
            })
            .catch(function () {
                $('economics-calendar-body').innerHTML =
                    '<tr><td colspan="8" class="empty-state">Calendar unavailable.</td></tr>';
            });
    }

    function renderCalendar() {
        var spec = parseCalendarFilter(calendarFilter);
        // Directive impact overrides the badge selection (latest write wins);
        // if neither is set, use the badge state.
        var impact = spec.impact || calendarImpact;

        calendarFiltered = calendarRows.filter(function (r) {
            if (impact !== 'all' && r.impact !== impact) return false;
            if (spec.country && (r.country || '').toUpperCase() !== spec.country) return false;
            if (spec.free) {
                var hay = ((r.country || '') + ' ' + (r.event || '') + ' ' + (r.impact || '')).toLowerCase();
                if (hay.indexOf(spec.free) < 0) return false;
            }
            return true;
        });

        // Reflect directive-driven impact in the badge row so the UI doesn't lie.
        if (spec.impact) {
            document.querySelectorAll('.economics-badge').forEach(function (b) {
                b.classList.toggle('active', b.dataset.impact === impact);
            });
        }

        var tbody = $('economics-calendar-body');
        if (calendarFiltered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No matching releases.</td></tr>';
            return;
        }

        var html = '';
        for (var i = 0; i < calendarFiltered.length; i++) {
            var r = calendarFiltered[i];
            var surprise = '', surpriseClass = '';
            if (r.actual !== null && r.estimate !== null && !isNaN(r.actual) && !isNaN(r.estimate)) {
                var d = r.actual - r.estimate;
                surprise = (d >= 0 ? '+' : '') + d.toFixed(2);
                surpriseClass = d > 0 ? 'pos' : (d < 0 ? 'neg' : '');
            }
            var impactClass = 'impact-' + (r.impact || 'Low').toLowerCase();
            html += '<tr class="economics-row" data-vim-row data-idx="' + i + '">'
                + '<td class="economics-date">' + escapeHTML(r.date || '') + '</td>'
                + '<td class="economics-country">' + escapeHTML(r.country || '') + '</td>'
                + '<td class="economics-event">' + escapeHTML(r.event || '') + '</td>'
                + '<td class="economics-impact ' + impactClass + '">' + escapeHTML(r.impact || '') + '</td>'
                + '<td class="num">' + fmt(r.previous, r.unit) + '</td>'
                + '<td class="num">' + fmt(r.estimate, r.unit) + '</td>'
                + '<td class="num">' + fmt(r.actual, r.unit) + '</td>'
                + '<td class="num ' + surpriseClass + '">' + surprise + '</td>'
                + '</tr>';
        }
        tbody.innerHTML = html;
    }

    // ── Catalog tab — level 1: central bank list ──

    function loadCentralBanks() {
        fetch('/api/economics/central-banks')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                catalogCBs = Array.isArray(data) ? data : [];
                renderCentralBanks();
            })
            .catch(function () {
                $('economics-cb-list').innerHTML = '<p class="empty-state">Central banks unavailable.</p>';
            });
    }

    function renderCentralBanks() {
        if (catalogCBs.length === 0) {
            $('economics-cb-list').innerHTML = '<p class="empty-state">No central banks configured.</p>';
            return;
        }
        // Tile layout — sidesteps the table sticky-header tangle entirely
        // and reads as "pick a central bank" rather than "row 1 of N".
        var html = '<div class="economics-cb-tiles">';
        catalogCBs.forEach(function (cb, i) {
            html += '<button type="button" class="economics-cb-tile economics-row" '
                + 'data-vim-row data-vim-action="click" data-idx="' + i + '" '
                + 'data-country="' + escapeHTML(cb.country) + '">'
                + '<span class="cb-tile-country">' + escapeHTML(cb.country) + '</span>'
                + '<span class="cb-tile-name">' + escapeHTML(cb.name) + '</span>'
                + '<span class="cb-tile-count">' + cb.indicators + ' indicators</span>'
                + '</button>';
        });
        html += '</div>';
        $('economics-cb-list').innerHTML = html;
    }

    function enterCentralBank(country, displayName) {
        catalogCountry = country;
        catalogLevel = 'indicators';
        $('economics-cb-list').classList.add('hidden');
        $('economics-cb-detail').classList.remove('hidden');
        $('economics-cb-title').textContent = displayName + ' — ' + country;
        catalogFilter = '';
        $('economics-catalog-filter').value = '';
        loadCatalog(country);
    }

    function backToCentralBanks() {
        catalogLevel = 'cb';
        catalogCountry = '';
        $('economics-cb-list').classList.remove('hidden');
        $('economics-cb-detail').classList.add('hidden');
    }

    // ── Catalog tab — level 2: indicator list for one CB ──

    function loadCatalog(country) {
        fetch('/api/economics/catalog?country=' + encodeURIComponent(country))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                catalogRows = Array.isArray(data) ? data : [];
                renderCatalog();
            })
            .catch(function () {
                $('economics-catalog-host').innerHTML = '<p class="empty-state">Catalog unavailable.</p>';
            });
    }

    function renderCatalog() {
        var f = catalogFilter.toLowerCase();
        catalogFiltered = catalogRows.filter(function (r) {
            if (!f) return true;
            return (
                r.code.toLowerCase().includes(f) ||
                r.name.toLowerCase().includes(f) ||
                r.category.toLowerCase().includes(f)
            );
        });

        var groups = {};
        var order = [];
        catalogFiltered.forEach(function (row, i) {
            row._idx = i;
            if (!groups[row.category]) { groups[row.category] = []; order.push(row.category); }
            groups[row.category].push(row);
        });

        var html = '';
        if (catalogFiltered.length === 0) {
            html = '<p class="empty-state">No matching indicators.</p>';
        } else {
            html += '<table class="economics-table economics-catalog-table"><thead><tr>'
                + '<th>Identifier</th><th>Indicator</th><th>Frequency</th><th class="num">Latest</th><th>As of</th>'
                + '</tr></thead><tbody>';
            for (var i = 0; i < order.length; i++) {
                var cat = order[i];
                html += '<tr class="economics-cat-row"><td colspan="5">' + escapeHTML(cat) + '</td></tr>';
                groups[cat].forEach(function (r) {
                    html += '<tr class="economics-row economics-catalog-row" '
                        + 'data-vim-row data-idx="' + r._idx + '"'
                        + ' data-identifier="' + escapeHTML(r.identifier) + '"'
                        + ' data-code="' + escapeHTML(r.code) + '">'
                        + '<td class="economics-code">' + escapeHTML(r.identifier) + '</td>'
                        + '<td>' + escapeHTML(r.name) + '</td>'
                        + '<td>' + escapeHTML(r.frequency) + '</td>'
                        + '<td class="num">' + (r.hasCache ? fmt(r.latestValue, r.units) : '—') + '</td>'
                        + '<td>' + escapeHTML(r.latestDate || '') + '</td>'
                        + '</tr>';
                });
            }
            html += '</tbody></table>';
        }
        $('economics-catalog-host').innerHTML = html;
    }

    // ── Slide-in chart preview (article-reader pane) ──

    var ecoChart = null;
    function disposeEcoChart() {
        if (ecoChart) { try { ecoChart.remove(); } catch (e) {} ecoChart = null; }
    }

    // Memoise fetched series for the session — re-pressing 'p' on the same
    // indicator shouldn't re-hit the server (or worse, a live FRED roundtrip
    // when the prefetcher hasn't reached this code yet).
    var seriesCache = {};

    function openPreviewForIdentifier(identifier, window5y) {
        if (!identifier) return;
        if (seriesCache[identifier]) {
            renderPreview(seriesCache[identifier], identifier, window5y);
            return;
        }
        fetch('/api/economics/series/' + encodeURIComponent(identifier))
            .then(function (r) { if (!r.ok) throw new Error('preview load failed'); return r.json(); })
            .then(function (es) {
                seriesCache[identifier] = es;
                renderPreview(es, identifier, window5y);
            })
            .catch(function () { renderPreviewError(identifier); });
    }

    function renderPreviewError(identifier) {
        var reader = $('article-reader');
        if (!reader) return;
        $('reader-title').textContent = identifier + ' — data unavailable';
        $('reader-body').innerHTML = '<p class="empty-state">No data — verify FRED_API_KEY is set and the prefetcher has warmed.</p>';
        reader.dataset.mode = 'eco-chart';
        reader.classList.remove('hidden');
    }

    function renderPreview(es, identifier, window5y) {
        var reader = $('article-reader');
        if (!reader || !es) return;
        var rangeLabel = window5y ? '5y' : 'full';
        $('reader-title').textContent = identifier + ' — ' + (es.title || identifier) + ' (' + rangeLabel + ')';

        var obs = es.observations || [];
        if (window5y) {
            var cutoff = new Date();
            cutoff.setFullYear(cutoff.getFullYear() - 5);
            var cutoffISO = cutoff.toISOString().slice(0, 10);
            obs = obs.filter(function (o) { return o.date >= cutoffISO; });
        }

        if (obs.length === 0) {
            $('reader-body').innerHTML = '<p class="empty-state">No observations.</p>';
            reader.dataset.mode = 'eco-chart';
            reader.classList.remove('hidden');
            return;
        }

        $('reader-body').innerHTML =
            '<div id="eco-chart-host" style="width:100%;height:320px"></div>'
            + '<div class="eco-chart-meta">'
            +   '<span>units: ' + escapeHTML(es.units || '') + '</span>'
            +   '<span>freq: ' + escapeHTML(es.frequency || '') + '</span>'
            +   '<span>updated: ' + escapeHTML(es.sourceUpdatedAt || '') + '</span>'
            + '</div>';

        // Show the slide-in BEFORE creating the chart — lightweight-charts
        // measures its host element to lay out, and a still-display:none
        // ancestor reports 0×0. Result was an empty pane on the first 'p'.
        var wasHidden = reader.classList.contains('hidden');
        reader.dataset.mode = 'eco-chart';
        reader.classList.remove('hidden');

        disposeEcoChart();
        if (!window.LightweightCharts) {
            $('reader-body').textContent = 'lightweight-charts not loaded';
            return;
        }

        // Paint synchronously when the reader was already visible (re-pressing
        // 'p' on another indicator) so the chart shows up in the same frame;
        // only defer when the reader was just unhidden, since the layout box
        // hasn't been computed yet.
        var paint = function () {
            var host = $('eco-chart-host');
            if (!host) return;
            ecoChart = window.LightweightCharts.createChart(host, {
                layout: { background: { color: '#0a0a0a' }, textColor: '#888888', fontFamily: "'SF Mono','Consolas',monospace", fontSize: 10, attributionLogo: false },
                grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
                rightPriceScale: { borderColor: '#2a2a2a' },
                timeScale: { borderColor: '#2a2a2a' },
                crosshair: { mode: 1 },
            });
            var series = ecoChart.addSeries(LightweightCharts.LineSeries, { color: '#4499ff', lineWidth: 2 });
            series.setData(obs.map(function (o) { return { time: o.date, value: o.value }; }));
            ecoChart.timeScale().fitContent();
        };
        if (wasHidden) requestAnimationFrame(paint);
        else paint();
    }

    function closeEcoPreview() {
        var reader = $('article-reader');
        if (!reader) return false;
        if (reader.dataset.mode !== 'eco-chart') return false;
        disposeEcoChart();
        reader.classList.add('hidden');
        delete reader.dataset.mode;
        return true;
    }

    // ── Public vim hooks ──
    //
    // Selection is managed declaratively by vim-nav.js — it applies
    // .vim-selected to the active [data-vim-row]. These hooks just read
    // the selected row's data attributes; no per-list state lives here.

    function selectedCatalogRow() {
        var sel = document.querySelector('.economics-catalog-row.vim-selected');
        return sel || null;
    }

    window._economicsAddCmd = function () {
        if (activeTab !== 'catalog' || catalogLevel !== 'indicators') return null;
        var row = selectedCatalogRow();
        if (!row) return null;
        var identifier = row.getAttribute('data-identifier');
        return identifier ? ':add ' + identifier : null;
    };

    // Toggle behavior: if the eco-chart slide-in is already open for the same
    // identifier+range, pressing 'p' again closes it. Otherwise (closed, or
    // open on a different indicator/range) it (re)opens.
    var lastPreviewKey = null;
    window._economicsOpenPreview = function (rangeKey) {
        if (activeTab !== 'catalog' || catalogLevel !== 'indicators') return false;
        var row = selectedCatalogRow();
        if (!row) return false;
        var identifier = row.getAttribute('data-identifier');
        if (!identifier) return false;
        var key = identifier + ':' + (rangeKey || '5y');
        var reader = $('article-reader');
        var openOnSame = reader && !reader.classList.contains('hidden')
            && reader.dataset.mode === 'eco-chart'
            && lastPreviewKey === key;
        if (openOnSame) {
            closeEcoPreview();
            lastPreviewKey = null;
            return true;
        }
        lastPreviewKey = key;
        openPreviewForIdentifier(identifier, rangeKey !== 'full');
        return true;
    };

    window._economicsClosePreview = function () {
        var closed = closeEcoPreview();
        if (closed) lastPreviewKey = null;
        return closed;
    };

    // Selected-row identifier exposed for the `g` keybinding's navigation hop.
    window._economicsSelectedIdentifier = function () {
        if (activeTab !== 'catalog' || catalogLevel !== 'indicators') return null;
        var row = selectedCatalogRow();
        return row ? row.getAttribute('data-identifier') : null;
    };

    // ── Wiring ──

    window._economicsInit = function () {
        // Tab buttons
        document.querySelectorAll('#economics-tabs .economics-tab').forEach(function (btn) {
            btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
        });

        // Impact badges
        document.querySelectorAll('.economics-badge').forEach(function (btn) {
            btn.addEventListener('click', function () {
                calendarImpact = btn.dataset.impact;
                document.querySelectorAll('.economics-badge').forEach(function (b) {
                    b.classList.toggle('active', b === btn);
                });
                renderCalendar();
            });
        });

        // Live filters
        $('economics-calendar-filter').addEventListener('input', function (e) {
            calendarFilter = e.target.value; renderCalendar();
        });
        $('economics-catalog-filter').addEventListener('input', function (e) {
            catalogFilter = e.target.value; renderCatalog();
        });
        // Enter in either filter input commits the query and returns to normal
        // mode, so the user can j/k through the filtered list without a
        // second keystroke. Escape stays bound globally — that one bails out
        // of insert mode anywhere.
        function exitFilter(e) {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            e.target.blur();
        }
        $('economics-calendar-filter').addEventListener('keydown', exitFilter);
        $('economics-catalog-filter').addEventListener('keydown', exitFilter);

        // Click handlers — CB tile (mouse path; keyboard goes through
        // vim-nav's data-vim-action="click" which fires the same handler).
        // Catalog-row clicks are no-op now: vim-nav owns row selection.
        $('economics-cb-list').addEventListener('click', function (e) {
            var tile = e.target.closest('.economics-cb-tile');
            if (tile) {
                var cb = catalogCBs[parseInt(tile.dataset.idx, 10)];
                if (cb) enterCentralBank(cb.country, cb.name);
            }
        });
        $('economics-cb-back').addEventListener('click', backToCentralBanks);

        loadCalendar();
        loadCentralBanks();
    };

    // Per-view filter focus (driven by terminal.js's `/` rebind).
    window._economicsFocusFilter = function () {
        var input = activeTab === 'calendar'
            ? $('economics-calendar-filter')
            : (catalogLevel === 'indicators' ? $('economics-catalog-filter') : null);
        if (input) {
            input.focus();
            input.select();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', window._economicsInit);
    } else {
        window._economicsInit();
    }
})();
