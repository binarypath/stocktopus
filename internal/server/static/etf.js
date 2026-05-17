// etf.js — /etf/{symbol} page. Mirrors the shape of crypto.js but with
// ETF-shaped tabs:
//   - Overview: price + NAV + expense ratio + AUM + dividend + inception
//   - Holdings: top underlyings with weight % and click-through
//   - Sectors: GICS allocation from etf/info's inline sectorsList
//   - News: Stock + Articles + General (drop Crypto / Forex — irrelevant)
//   - AI Analysis: shared trading-pipeline UI (server-side SEC-skip via #99)
//
// Stock fundamentals tabs (Financials / Estimates / SEC / Sector) are
// dropped — for a fund, holdings + sector breakdown play that role.

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

    function fmtBig(n) {
        if (n == null || isNaN(n) || !n) return '—';
        if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
        if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
        if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
        if (n >= 1e3) return '$' + (n / 1e3).toFixed(2) + 'K';
        return '$' + n.toFixed(0);
    }

    function fmtVol(n) {
        if (!n) return '—';
        if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
        return n.toFixed(0);
    }

    function fmtPrice(n) {
        if (n == null || isNaN(n)) return '—';
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
                case 'holdings': loadHoldings(); break;
                case 'sectors': loadSectors(); break;
                case 'news': loadNews(); break;
                case 'ai': loadAI(); break;
            }
        } catch (e) {
            console.error('ETF tab load error:', tab, e);
            container.innerHTML = '<p class="empty-state">Failed to load ' + tab + '</p>';
        }
    }

    // ── Cached info (shared between Overview + Sectors) ──

    var _infoCache = null;
    function fetchETFInfo() {
        if (_infoCache) return Promise.resolve(_infoCache);
        return fetch('/api/security/' + symbol + '/etf-info')
            .then(function (r) { return r.json(); })
            .then(function (rows) {
                _infoCache = (rows && rows[0]) || {};
                return _infoCache;
            })
            .catch(function () { return {}; });
    }

    // ── Overview ──

    function loadOverview() {
        Promise.all([
            fetch('/api/security/' + symbol + '/quote').then(function (r) { return r.json(); }).catch(function () { return []; }),
            fetchETFInfo(),
            fetch('/api/historical/price/' + symbol).then(function (r) { return r.json(); }).catch(function () { return []; }),
        ]).then(function (results) {
            var q = (results[0] && results[0][0]) || {};
            var info = results[1] || {};
            var hist = results[2] || [];

            var price = q.price;
            var ch24 = q.changePercentage;
            var chYTD = pctChangeFromHistoryYTD(hist);
            var ch1Y = pctChangeFromHistory(hist, 252);

            var html = '';
            html += '<div class="crypto-header">';
            html += '<span class="crypto-name">' + esc(info.name || q.name || symbol) + '</span>';
            html += '<span class="crypto-exchange">' + esc(info.etfCompany || q.exchange || 'ETF') + '</span>';
            html += '</div>';

            html += '<div class="crypto-price-row">';
            html += '<span class="crypto-price">$' + fmtPrice(price) + '</span>';
            html += '<span class="crypto-change ' + pctClass(ch24) + '">1d ' + pct(ch24) + '</span>';
            html += '<span class="crypto-change ' + pctClass(chYTD) + '">YTD ' + pct(chYTD) + '</span>';
            html += '<span class="crypto-change ' + pctClass(ch1Y) + '">1y ' + pct(ch1Y) + '</span>';
            html += '</div>';

            html += '<div class="crypto-stats">';
            html += statCell('NAV', info.nav ? '$' + info.nav.toFixed(2) : '—');
            html += statCell('AUM', fmtBig(info.assetsUnderManagement));
            html += statCell('Expense Ratio', info.expenseRatio != null ? info.expenseRatio.toFixed(2) + '%' : '—');
            html += statCell('Avg Volume', fmtVol(info.avgVolume));
            html += statCell('Holdings', info.holdingsCount || '—');
            html += statCell('Inception', info.inceptionDate || '—');
            html += statCell('Asset Class', info.assetClass || '—');
            html += statCell('Domicile', info.domicile || '—');
            html += '</div>';

            // 1Y price chart at the top so the page lands with at-a-glance
            // performance context, matching the crypto page.
            html += '<div id="etf-chart-1y" class="crypto-chart"></div>';

            if (info.description) {
                html += '<div class="crypto-desc">' + esc(info.description) + '</div>';
            }

            container.innerHTML = html;
            renderOverviewChart(hist);
        }).catch(function (err) {
            console.error('ETF overview error:', err);
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
        // Walk back to find the first trading day of the same year.
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
        var el = document.getElementById('etf-chart-1y');
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

    // ── Holdings ──

    function loadHoldings() {
        fetch('/api/security/' + symbol + '/etf-holdings')
            .then(function (r) { return r.json(); })
            .then(function (rows) {
                if (!rows || rows.length === 0) {
                    container.innerHTML = '<p class="empty-state">No holdings data</p>';
                    return;
                }
                // FMP returns ascending by weight in some plans, descending in
                // others — explicitly sort by weight desc so the top names
                // come first regardless.
                rows.sort(function (a, b) { return (b.weightPercentage || 0) - (a.weightPercentage || 0); });
                // Cap to the top 50 — full SPY list is ~500, beyond which
                // the table becomes noise. Show count in the heading.
                var top = rows.slice(0, 50);

                var html = '<div class="sector-section-title">Top Holdings (' + top.length + ' of ' + rows.length + ')</div>';
                html += '<table class="fin-table peer-table"><thead><tr>';
                html += '<th>#</th><th>Ticker</th><th>Name</th><th>Weight</th><th>Market Value</th>';
                html += '</tr></thead><tbody>';
                top.forEach(function (h, i) {
                    var sym = h.asset || h.symbol || '';
                    html += '<tr class="peer-row" data-symbol="' + esc(sym) + '">';
                    html += '<td>' + (i + 1) + '</td>';
                    html += '<td><span class="sym-link">' + esc(sym) + '</span></td>';
                    html += '<td>' + esc(h.name || '') + '</td>';
                    html += '<td>' + pct(h.weightPercentage) + '</td>';
                    html += '<td>' + fmtBig(h.marketValue) + '</td>';
                    html += '</tr>';
                });
                html += '</tbody></table>';
                container.innerHTML = html;

                // Click → /security/{ticker}. The server-side 301 routes
                // the user to the correct type page if it's a non-stock
                // (rare in equity-ETF holdings but works for bond / FX ETFs).
                container.querySelectorAll('.peer-row').forEach(function (row) {
                    row.onclick = function () {
                        var sym = row.dataset.symbol;
                        if (sym) window.location.href = '/security/' + sym;
                    };
                });
            })
            .catch(function () {
                container.innerHTML = '<p class="empty-state">Failed to load holdings</p>';
            });
    }

    // ── Sectors ──

    function loadSectors() {
        fetchETFInfo().then(function (info) {
            var sectors = info.sectorsList || [];
            if (sectors.length === 0) {
                container.innerHTML = '<p class="empty-state">No sector breakdown</p>';
                return;
            }
            sectors.sort(function (a, b) { return (b.exposure || 0) - (a.exposure || 0); });
            var html = '<div class="sector-section-title">GICS Sector Allocation</div>';
            html += '<table class="fin-table peer-table"><thead><tr>';
            html += '<th>Sector</th><th>Exposure</th><th>Bar</th>';
            html += '</tr></thead><tbody>';
            sectors.forEach(function (s) {
                var w = s.exposure || 0;
                html += '<tr><td>' + esc(s.industry) + '</td>';
                html += '<td>' + pct(w) + '</td>';
                html += '<td><div class="sector-bar"><div class="sector-bar-fill" style="width:' + Math.min(100, w * 2) + '%"></div></div></td></tr>';
            });
            html += '</tbody></table>';
            container.innerHTML = html;
        });
    }

    // ── News ──

    var NEWS_CATS = [
        { key: 'stock', label: 'Stock' },
        { key: 'articles', label: 'Articles' },
        { key: 'general', label: 'General' },
    ];
    var activeNewsCat = 'stock';

    function loadNews() {
        var html = '<div class="news-sub-tabs" id="news-sub-tabs">';
        NEWS_CATS.forEach(function (c) {
            html += '<button class="info-sub-tab' + (c.key === activeNewsCat ? ' active' : '') + '" data-cat="' + esc(c.key) + '">' + esc(c.label) + '</button>';
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
        var url = '/api/news/' + cat + '?symbol=' + encodeURIComponent(symbol) + '&limit=20';
        fetch(url).then(function (r) { return r.json(); }).then(function (items) {
            if (!items || items.length === 0) {
                // Broad-feed fallback (same as crypto.js) — ETF news is
                // often filed under the issuer rather than the ticker.
                fetch('/api/news/' + cat + '?limit=20')
                    .then(function (r) { return r.json(); })
                    .then(renderNewsList);
                return;
            }
            renderNewsList(items);
        }).catch(function () {
            listEl.innerHTML = '<p class="empty-state">Failed to load news</p>';
        });
    }

    function renderNewsList(items) {
        var listEl = document.getElementById('news-cards');
        if (!items || items.length === 0) {
            listEl.innerHTML = '<p class="empty-state">No news</p>';
            return;
        }
        var html = '';
        items.forEach(function (n) {
            var url = n.url || '#';
            var d = n.publishedDate ? new Date(n.publishedDate).toLocaleString() : '';
            html += '<div class="news-card">';
            html += '<div class="news-card-title"><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(n.title || '—') + '</a></div>';
            html += '<div class="news-card-meta"><span>' + esc(n.site || n.publisher || '') + '</span><span>' + esc(d) + '</span></div>';
            if (n.text || n.snippet) {
                html += '<div class="news-card-snippet">' + esc((n.text || n.snippet).slice(0, 240)) + '…</div>';
            }
            html += '</div>';
        });
        listEl.innerHTML = html;
    }

    // ── AI Analysis ──

    function loadAI() {
        Promise.all([
            fetch('/api/trading/cost').then(function (r) { return r.json(); }).catch(function () { return { available: false }; }),
            fetch('/api/security/' + symbol + '/trading/result').then(function (r) { return r.json(); }).then(function (d) { return d && d.status !== 'none' ? d : null; }).catch(function () { return null; }),
        ]).then(function (results) {
            var costInfo = results[0];
            var tradingResult = results[1];

            var html = '<div class="trading-header trading-vim-item" data-trading-vim="btn" tabindex="0">';
            html += '<span class="ai-section-title" style="margin:0">Deep Analysis — Multi-Agent Pipeline</span>';
            html += renderTradingButton(costInfo, tradingResult);
            html += '</div>';

            if (tradingResult && tradingResult.analystReports && tradingResult.analystReports.length > 0) {
                html += renderTradingResultLite(tradingResult);
            } else {
                html += '<p class="empty-state">No analysis yet. SEC + competitor analysts are skipped for ETFs.</p>';
            }
            container.innerHTML = html;
            wireTradingButton();
            if (tradingResult && !isFinished(tradingResult)) pollTradingStatus();
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
            html += '<button class="trading-btn trading-btn-running" disabled>'
                + '<span class="spinner" style="width:12px;height:12px;display:inline-block"></span> Running…</button>';
        } else {
            html += '<button class="trading-btn" id="trading-analyze-btn">&#129302; Run Deep Analysis</button>';
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
            fetch('/api/security/' + symbol + '/trading/analyze', { method: 'POST' })
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
            fetch('/api/security/' + symbol + '/trading/result')
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
            html += '<div class="trading-analyst-card trading-vim-item">';
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
