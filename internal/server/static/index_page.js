// index_page.js — /index/{symbol} page (^DJI, ^GSPC, ^IXIC). Mirrors
// the shape of etf.js / crypto.js. Tabs: Overview, Components, Movers,
// News, AI Analysis. Filename is index_page.js (not index.js) to keep
// it visually distinct from any /static/index.html bundling that
// might exist downstream.

(function () {
    var container = document.getElementById('info-content');
    if (!container) return;
    var symbol = container.dataset.symbol;
    var currentTab = 'overview';

    function esc(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function pct(n) {
        if (n == null || isNaN(n)) return '—';
        return (+n).toFixed(2) + '%';
    }

    function pctClass(n) {
        if (n == null || isNaN(n)) return '';
        return n >= 0 ? 'price-up' : 'price-down';
    }

    function fmtVol(n) {
        if (!n) return '—';
        if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
        if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
        return n.toFixed(0);
    }

    function fmtPrice(n) {
        if (n == null || isNaN(n)) return '—';
        if (n >= 10000) return n.toFixed(0);
        if (n >= 100) return n.toFixed(2);
        return n.toFixed(2);
    }

    // ── Tab Switching ──

    var tabsEl = document.getElementById('info-tabs');
    if (tabsEl) {
        tabsEl.querySelectorAll('.info-tab').forEach(function (tab) {
            tab.onclick = function () {
                tabsEl.querySelectorAll('.info-tab').forEach(function (t) { t.classList.remove('active'); });
                tab.classList.add('active');
                loadTab(tab.dataset.tab);
            };
        });
    }

    window._infoJumpToTab = function (n) {
        var allTabs = tabsEl.querySelectorAll('.info-tab');
        if (n < allTabs.length) allTabs[n].click();
    };

    function loadTab(tab) {
        currentTab = tab;
        container.innerHTML = '<p class="empty-state">Loading...</p>';
        try {
            switch (tab) {
                case 'overview': loadOverview(); break;
                case 'components': loadComponents(); break;
                case 'movers': loadMovers(); break;
                case 'news': loadNews(); break;
                case 'ai': loadAI(); break;
            }
        } catch (e) {
            console.error('Index tab load error:', tab, e);
            container.innerHTML = '<p class="empty-state">Failed to load ' + tab + '</p>';
        }
    }

    // ── Cached constituents (shared between Components + Movers) ──

    var _constituentsCache = null;
    function fetchConstituents() {
        if (_constituentsCache) return Promise.resolve(_constituentsCache);
        return fetch('/api/security/' + encodeURIComponent(symbol) + '/index-constituents')
            .then(function (r) { return r.json(); })
            .then(function (rows) {
                _constituentsCache = rows || [];
                return _constituentsCache;
            })
            .catch(function () { return []; });
    }

    // ── Overview ──

    function loadOverview() {
        Promise.all([
            fetch('/api/security/' + encodeURIComponent(symbol) + '/quote').then(function (r) { return r.json(); }).catch(function () { return []; }),
            fetch('/api/historical/price/' + encodeURIComponent(symbol)).then(function (r) { return r.json(); }).catch(function () { return []; }),
            fetchConstituents(),
        ]).then(function (results) {
            var q = (results[0] && results[0][0]) || {};
            var hist = results[1] || [];
            var components = results[2] || [];

            var price = q.price;
            var ch1d = q.changePercentage;
            var chYTD = pctChangeFromHistoryYTD(hist);
            var ch1Y = pctChangeFromHistory(hist, 252);

            var html = '';
            html += '<div class="crypto-header">';
            html += '<span class="crypto-name">' + esc(q.name || symbol) + '</span>';
            html += '<span class="crypto-exchange">INDEX</span>';
            html += '</div>';

            html += '<div class="crypto-price-row">';
            html += '<span class="crypto-price">' + fmtPrice(price) + '</span>';
            html += '<span class="crypto-change ' + pctClass(ch1d) + '">1d ' + pct(ch1d) + '</span>';
            html += '<span class="crypto-change ' + pctClass(chYTD) + '">YTD ' + pct(chYTD) + '</span>';
            html += '<span class="crypto-change ' + pctClass(ch1Y) + '">1y ' + pct(ch1Y) + '</span>';
            html += '</div>';

            html += '<div class="crypto-stats">';
            html += statCell('Components', components.length || '—');
            html += statCell('Day Range', q.dayLow && q.dayHigh ? fmtPrice(q.dayLow) + ' – ' + fmtPrice(q.dayHigh) : '—');
            html += statCell('52W Range', q.yearLow && q.yearHigh ? fmtPrice(q.yearLow) + ' – ' + fmtPrice(q.yearHigh) : '—');
            html += statCell('Volume', fmtVol(q.volume));
            html += statCell('50-day Avg', q.priceAvg50 ? fmtPrice(q.priceAvg50) : '—');
            html += statCell('200-day Avg', q.priceAvg200 ? fmtPrice(q.priceAvg200) : '—');
            html += '</div>';

            // Graph row — per the user's vim spec, the chart is its own
            // row-level element on the Overview tab. Pressing Enter on
            // it jumps to /graph/{sym}.
            html += '<div id="index-chart-1y" class="crypto-chart" data-vim-row data-vim-action="navigate" data-vim-href="/graph/' + encodeURIComponent(symbol) + '"></div>';

            container.innerHTML = html;
            renderOverviewChart(hist);
            if (window.VimNav) window.VimNav.reset();
        }).catch(function (err) {
            console.error('Index overview error:', err);
            container.innerHTML = '<p class="empty-state">Failed to load overview</p>';
        });
    }

    function statCell(label, value) {
        return '<div class="crypto-stat"><span class="crypto-stat-label">' + esc(label) + '</span><span class="crypto-stat-value">' + esc(String(value)) + '</span></div>';
    }

    function pctChangeFromHistory(hist, daysAgo) {
        if (!hist || hist.length <= daysAgo) return null;
        var latest = hist[0].price;
        var past = hist[daysAgo].price;
        if (!past) return null;
        return ((latest - past) / past) * 100;
    }

    function pctChangeFromHistoryYTD(hist) {
        if (!hist || hist.length === 0) return null;
        var latest = hist[0];
        var year = (latest.date || '').slice(0, 4);
        if (!year) return null;
        var yearStart = null;
        for (var i = hist.length - 1; i >= 0; i--) {
            if ((hist[i].date || '').slice(0, 4) === year) {
                yearStart = hist[i];
                break;
            }
        }
        if (!yearStart || !yearStart.price) return null;
        return ((latest.price - yearStart.price) / yearStart.price) * 100;
    }

    function renderOverviewChart(hist) {
        var el = document.getElementById('index-chart-1y');
        if (!el || !window.LightweightCharts || !hist || hist.length === 0) return;
        var slice = hist.slice(0, Math.min(252, hist.length));
        var data = slice.map(function (d) { return { time: d.date, value: d.price }; }).reverse();
        var chart = LightweightCharts.createChart(el, {
            width: el.clientWidth, height: 240,
            layout: { background: { color: 'transparent' }, textColor: '#9ca3af', attributionLogo: false },
            grid: { vertLines: { color: 'rgba(60,60,60,0.3)' }, horzLines: { color: 'rgba(60,60,60,0.3)' } },
            rightPriceScale: { borderColor: 'rgba(80,80,80,0.5)' },
            timeScale: { borderColor: 'rgba(80,80,80,0.5)' },
        });
        var first = data[0].value, last = data[data.length - 1].value;
        var color = last >= first ? '#00cc66' : '#ff4444';
        var series = chart.addSeries(LightweightCharts.AreaSeries, {
            lineColor: color,
            topColor: color === '#00cc66' ? 'rgba(0, 204, 102, 0.2)' : 'rgba(255, 68, 68, 0.2)',
            bottomColor: 'transparent', lineWidth: 1, priceLineVisible: false,
        });
        series.setData(data);
        chart.timeScale().fitContent();
    }

    // ── Components ──

    function loadComponents() {
        fetchConstituents().then(function (rows) {
            if (!rows || rows.length === 0) {
                container.innerHTML = '<p class="empty-state">No constituents data — try ^DJI, ^GSPC, or ^IXIC</p>';
                return;
            }
            var html = '<div class="sector-section-title">Components (' + rows.length + ')</div>';
            html += '<table class="fin-table peer-table"><thead><tr>';
            html += '<th>Ticker</th><th>Name</th><th>Sector</th><th>Sub-Sector</th><th>Added</th>';
            html += '</tr></thead><tbody>';
            rows.forEach(function (r) {
                // Each table row is a vim-nav row container; td cells
                // are the column items walked by w/b/h/l. Enter on any
                // cell triggers the row's click → /security/{sym}.
                html += '<tr class="peer-row" data-symbol="' + esc(r.symbol) + '" data-vim-row data-vim-action="navigate" data-vim-href="/security/' + encodeURIComponent(r.symbol) + '">';
                html += '<td><span class="sym-link">' + esc(r.symbol) + '</span></td>';
                html += '<td>' + esc(r.name || '') + '</td>';
                html += '<td>' + esc(r.sector || '') + '</td>';
                html += '<td>' + esc(r.subSector || '') + '</td>';
                html += '<td>' + esc(r.dateFirstAdded || '') + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
            container.innerHTML = html;

            container.querySelectorAll('.peer-row').forEach(function (row) {
                row.onclick = function () {
                    var sym = row.dataset.symbol;
                    if (sym) window.location.href = '/security/' + sym;
                };
            });
            if (window.VimNav) window.VimNav.reset();
        });
    }

    // ── Movers ──

    // FMP's batch-quote tops out around ~50 rows per call, so chunk
    // the constituent list and merge. Sequential keeps the request
    // rate low; the index pages aren't on the hot path.
    function loadMovers() {
        container.innerHTML = '<p class="empty-state">Fetching today’s constituent quotes…</p>';
        fetchConstituents().then(function (rows) {
            if (!rows || rows.length === 0) {
                container.innerHTML = '<p class="empty-state">No constituents — movers unavailable</p>';
                return;
            }
            var syms = rows.map(function (r) { return r.symbol; });
            // Map ticker → display name for the rendered table.
            var nameBySym = {};
            rows.forEach(function (r) { nameBySym[r.symbol] = r.name || ''; });

            chunkedBatchQuote(syms, 50).then(function (quotes) {
                quotes.sort(function (a, b) { return (b.changePercentage || 0) - (a.changePercentage || 0); });
                var gainers = quotes.slice(0, 5);
                var losers = quotes.slice(-5).reverse();

                var html = '';
                html += '<div class="sector-section-title">Top Gainers</div>';
                html += renderMoversTable(gainers, nameBySym);
                html += '<div class="sector-section-title">Top Losers</div>';
                html += renderMoversTable(losers, nameBySym);
                container.innerHTML = html;

                container.querySelectorAll('.peer-row').forEach(function (row) {
                    row.onclick = function () {
                        var sym = row.dataset.symbol;
                        if (sym) window.location.href = '/security/' + sym;
                    };
                });
                if (window.VimNav) window.VimNav.reset();
            });
        });
    }

    function chunkedBatchQuote(symbols, chunkSize) {
        var chunks = [];
        for (var i = 0; i < symbols.length; i += chunkSize) {
            chunks.push(symbols.slice(i, i + chunkSize));
        }
        // Sequential, not parallel — FMP has rate caps and this isn't
        // perf-critical (the page is rarely the hot path).
        var out = [];
        return chunks.reduce(function (p, chunk) {
            return p.then(function () {
                return fetch('/api/batch-quote?symbols=' + chunk.join(','))
                    .then(function (r) { return r.json(); })
                    .then(function (rows) { if (rows && rows.length) out = out.concat(rows); });
            });
        }, Promise.resolve()).then(function () { return out; });
    }

    function renderMoversTable(rows, nameBySym) {
        if (!rows || rows.length === 0) return '<p class="empty-state">—</p>';
        var html = '<table class="fin-table peer-table"><thead><tr>';
        html += '<th>Ticker</th><th>Name</th><th>Price</th><th>Change</th>';
        html += '</tr></thead><tbody>';
        rows.forEach(function (q) {
            html += '<tr class="peer-row" data-symbol="' + esc(q.symbol) + '" data-vim-row data-vim-action="navigate" data-vim-href="/security/' + encodeURIComponent(q.symbol) + '">';
            html += '<td><span class="sym-link">' + esc(q.symbol) + '</span></td>';
            html += '<td>' + esc(nameBySym[q.symbol] || q.name || '') + '</td>';
            html += '<td>$' + fmtPrice(q.price) + '</td>';
            html += '<td class="' + pctClass(q.changePercentage) + '">' + pct(q.changePercentage) + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
        return html;
    }

    // ── News ──

    var NEWS_CATS = [
        { key: 'general', label: 'General' },
        { key: 'articles', label: 'Articles' },
        { key: 'stock', label: 'Stock' },
    ];
    var activeNewsCat = 'general';

    function loadNews() {
        // Sub-tab row: its own data-vim-row so j from main tabs lands here,
        // and h/l (or w/b) walks across the categories.
        var html = '<div class="news-sub-tabs" id="news-sub-tabs" data-vim-row>';
        NEWS_CATS.forEach(function (c) {
            html += '<button class="info-sub-tab' + (c.key === activeNewsCat ? ' active' : '') + '" data-cat="' + esc(c.key) + '" data-vim-item>' + esc(c.label) + '</button>';
        });
        html += '</div><div id="news-cards" class="news-cards"><p class="empty-state">Loading...</p></div>';
        container.innerHTML = html;

        container.querySelectorAll('.info-sub-tab').forEach(function (tab) {
            tab.onclick = function () {
                container.querySelectorAll('.info-sub-tab').forEach(function (t) { t.classList.remove('active'); });
                tab.classList.add('active');
                activeNewsCat = tab.dataset.cat;
                loadNewsCategory(activeNewsCat);
            };
        });
        loadNewsCategory(activeNewsCat);
    }

    function loadNewsCategory(cat) {
        var listEl = document.getElementById('news-cards');
        listEl.innerHTML = '<p class="empty-state">Loading...</p>';
        // Index symbols rarely tag in symbol-filtered feeds, so go
        // straight to the broad feed.
        var url = '/api/news/' + cat + '?limit=20';
        fetch(url).then(function (r) { return r.json(); }).then(renderNewsList).catch(function () {
            listEl.innerHTML = '<p class="empty-state">Failed to load news</p>';
        });
    }

    function renderNewsList(items) {
        var listEl = document.getElementById('news-cards');
        if (!items || items.length === 0) {
            listEl.innerHTML = '<p class="empty-state">No news</p>';
            if (window.VimNav) window.VimNav.reset();
            return;
        }
        var html = '';
        items.forEach(function (n) {
            var url = n.url || '#';
            var d = n.publishedDate ? new Date(n.publishedDate).toLocaleString() : '';
            var title = (n.title || '—').replace(/"/g, '&quot;');
            // Each article is its own self-navigable row — Enter opens
            // the reader. The reader takes over all keys while open
            // (terminal.js gates VimNav off when the reader is open).
            html += '<div class="news-card" data-vim-row data-vim-action="open-reader" data-vim-url="' + esc(url) + '" data-vim-title="' + esc(title) + '">';
            html += '<div class="news-card-title"><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(n.title || '—') + '</a></div>';
            html += '<div class="news-card-meta"><span>' + esc(n.site || n.publisher || '') + '</span><span>' + esc(d) + '</span></div>';
            if (n.text || n.snippet) {
                html += '<div class="news-card-snippet">' + esc((n.text || n.snippet).slice(0, 240)) + '…</div>';
            }
            html += '</div>';
        });
        listEl.innerHTML = html;
        if (window.VimNav) window.VimNav.reset();
    }

    // ── AI Analysis ──

    function loadAI() {
        Promise.all([
            fetch('/api/trading/cost').then(function (r) { return r.json(); }).catch(function () { return { available: false }; }),
            fetch('/api/security/' + encodeURIComponent(symbol) + '/trading/result').then(function (r) { return r.json(); }).then(function (d) { return d && d.status !== 'none' ? d : null; }).catch(function () { return null; }),
        ]).then(function (results) {
            var costInfo = results[0];
            var tradingResult = results[1];

            // Each card is a row of one item — j/k between cards, Enter
            // triggers click (button) or toggle (analyst card with body).
            // The trading-header row's vim-item is the Run button itself;
            // renderTradingButton emits data-vim-item on the <button>.
            var html = '<div class="trading-header trading-vim-item" data-trading-vim="btn" data-vim-row>';
            html += '<span class="ai-section-title" style="margin:0">Deep Analysis — Multi-Agent Pipeline</span>';
            html += renderTradingButton(costInfo, tradingResult);
            html += '</div>';

            if (tradingResult && tradingResult.analystReports && tradingResult.analystReports.length > 0) {
                html += renderTradingResultLite(tradingResult);
            } else {
                html += '<p class="empty-state">No analysis yet. SEC + competitor analysts are skipped for indices.</p>';
            }
            container.innerHTML = html;
            wireTradingButton();
            if (tradingResult && !isFinished(tradingResult)) pollTradingStatus();
            if (window.VimNav) window.VimNav.reset();
        });
    }

    function isFinished(result) {
        return result && result.finishedAt && !result.finishedAt.startsWith('0001');
    }

    function renderTradingButton(costInfo, tradingResult) {
        var isRunning = tradingResult && !isFinished(tradingResult) && tradingResult.startedAt;
        var costStr = costInfo && costInfo.available ? 'Est. $' + costInfo.estimatedCost.toFixed(3) : '';
        var html = '';
        if (isRunning) {
            html += '<button class="trading-btn trading-btn-running" disabled data-vim-item>'
                + '<span class="spinner" style="width:12px;height:12px;display:inline-block"></span> Running…</button>';
        } else {
            html += '<button class="trading-btn" id="trading-analyze-btn" data-vim-item>&#129302; Run Deep Analysis</button>';
        }
        if (costStr) html += '<span class="trading-cost">' + esc(costStr) + '</span>';
        if (isFinished(tradingResult) && tradingResult.totalCostUsd !== undefined) {
            html += '<span class="trading-actual-cost">Actual: $' + tradingResult.totalCostUsd.toFixed(4) + '</span>';
        }
        return html;
    }

    function wireTradingButton() {
        var btn = document.getElementById('trading-analyze-btn');
        if (!btn) return;
        btn.onclick = function () {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;display:inline-block"></span> Starting…';
            fetch('/api/security/' + encodeURIComponent(symbol) + '/trading/analyze', { method: 'POST' })
                .then(function (r) { return r.json(); })
                .then(function (resp) {
                    if (resp.status === 'started' || resp.status === 'already_running') pollTradingStatus();
                })
                .catch(function () { btn.disabled = false; btn.textContent = 'Run Deep Analysis'; });
        };
    }

    var tradingPollInterval = null;
    function pollTradingStatus() {
        if (tradingPollInterval) clearInterval(tradingPollInterval);
        tradingPollInterval = setInterval(function () {
            if (currentTab !== 'ai') { clearInterval(tradingPollInterval); return; }
            fetch('/api/security/' + encodeURIComponent(symbol) + '/trading/result')
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (result) {
                    if (!result) return;
                    if (isFinished(result)) {
                        clearInterval(tradingPollInterval);
                        loadAI();
                    }
                });
        }, 3000);
    }

    function renderTradingResultLite(result) {
        var html = '<div class="trading-analysts">';
        result.analystReports.forEach(function (r) {
            var outlookClass = r.outlook === 'bullish' ? 'price-up' : r.outlook === 'bearish' ? 'price-down' : '';
            // Whole card is the navigable item AND the row. Enter toggles
            // its expanded state via data-vim-toggle-class. Each card
            // sits in its own row so j/k walks between them.
            html += '<div class="trading-analyst-card trading-vim-item" data-vim-row data-vim-action="toggle" data-vim-toggle-class="trading-panel-open">';
            html += '<div class="trading-analyst-header">';
            html += '<span class="trading-analyst-name">' + esc(r.analyst) + '</span>';
            html += '<span class="trading-analyst-outlook ' + outlookClass + '">' + esc(r.outlook || 'neutral') + '</span>';
            html += '</div>';
            html += '<div class="trading-analyst-body">';
            if (r.summary) html += '<p class="ai-text">' + esc(r.summary) + '</p>';
            if (r.keyPoints && r.keyPoints.length) {
                html += '<ul class="ai-list">';
                r.keyPoints.forEach(function (p) { html += '<li>' + esc(p) + '</li>'; });
                html += '</ul>';
            }
            html += '</div></div>';
        });
        html += '</div>';
        return html;
    }

    // ── Init ──

    loadTab('overview');
})();
