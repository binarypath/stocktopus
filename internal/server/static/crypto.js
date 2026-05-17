// crypto.js — info-page-equivalent JS for /crypto/{symbol}. Mirrors the
// shape of info.js (tab switching, content rendering, vim tabs via the
// shared terminal.js handler) but with crypto-shaped data:
//   - Overview: price, 24h/7d/30d %, volume, exchange, description
//   - News: only Crypto, Articles, General categories
//   - AI Analysis: shared trading pipeline (server-side gates SEC fetches)
//   - Peer Coins: curated top-10 with 1M sparklines
//
// Stock fundamentals tabs (Financials / Estimates / SEC / Sector) are
// dropped — they're meaningless for a coin.

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
        if (n >= 1000) return n.toFixed(2);
        if (n >= 1) return n.toFixed(4);
        return n.toFixed(6);
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
                case 'news': loadNews(); break;
                case 'ai': loadAI(); break;
                case 'peers': loadPeers(); break;
            }
        } catch (e) {
            console.error('Crypto tab load error:', tab, e);
            container.innerHTML = '<p class="empty-state">Failed to load ' + tab + '</p>';
        }
    }

    // ── Overview ──

    function loadOverview() {
        // Profile is usually empty for crypto, but try in case the coin is
        // a wrapped/tokenised security with metadata. Quote is the load-
        // bearing call — always returns a row for tradable symbols.
        Promise.all([
            fetch('/api/security/' + symbol + '/quote').then(function (r) { return r.json(); }).catch(function () { return []; }),
            fetch('/api/security/' + symbol + '/profile').then(function (r) { return r.json(); }).catch(function () { return []; }),
            fetch('/api/historical/price/' + symbol).then(function (r) { return r.json(); }).catch(function () { return []; }),
        ]).then(function (results) {
            var q = (results[0] && results[0][0]) || {};
            var p = (results[1] && results[1][0]) || {};
            // history is descending by date; index 0 = latest, 1 = -1d, …
            var hist = results[2] || [];

            var price = q.price;
            var ch24 = q.changePercentage;
            var ch7d = pctChangeFromHistory(hist, 7);
            var ch30d = pctChangeFromHistory(hist, 30);

            var html = '';
            html += '<div class="crypto-header">';
            html += '<span class="crypto-name">' + esc(q.name || p.companyName || symbol) + '</span>';
            html += '<span class="crypto-exchange">' + esc(q.exchange || p.exchange || 'CRYPTO') + '</span>';
            html += '</div>';

            html += '<div class="crypto-price-row">';
            html += '<span class="crypto-price">$' + fmtPrice(price) + '</span>';
            html += '<span class="crypto-change ' + pctClass(ch24) + '">24h ' + pct(ch24) + '</span>';
            html += '<span class="crypto-change ' + pctClass(ch7d) + '">7d ' + pct(ch7d) + '</span>';
            html += '<span class="crypto-change ' + pctClass(ch30d) + '">30d ' + pct(ch30d) + '</span>';
            html += '</div>';

            html += '<div class="crypto-stats">';
            html += statCell('Volume (24h)', fmtVol(q.volume));
            html += statCell('Day Range', q.dayLow && q.dayHigh ? '$' + fmtPrice(q.dayLow) + ' – $' + fmtPrice(q.dayHigh) : '—');
            html += statCell('52W Range', q.yearLow && q.yearHigh ? '$' + fmtPrice(q.yearLow) + ' – $' + fmtPrice(q.yearHigh) : '—');
            html += statCell('Market Cap', q.marketCap ? '$' + fmtVol(q.marketCap) : '—');
            html += statCell('50-day Avg', q.priceAvg50 ? '$' + fmtPrice(q.priceAvg50) : '—');
            html += statCell('200-day Avg', q.priceAvg200 ? '$' + fmtPrice(q.priceAvg200) : '—');
            html += '</div>';

            // Inline 1Y price chart so the page lands with a glance-level
            // context. Sketchpad / full chart is elsewhere via :graph.
            html += '<div id="crypto-chart-1y" class="crypto-chart"></div>';

            // Description from profile if FMP has one (rare for coins).
            if (p.description) {
                html += '<div class="crypto-desc">' + esc(p.description) + '</div>';
            }

            container.innerHTML = html;
            renderOverviewChart(hist);
        }).catch(function (err) {
            console.error('Crypto overview error:', err);
            container.innerHTML = '<p class="empty-state">Failed to load overview</p>';
        });
    }

    function statCell(label, value) {
        return '<div class="crypto-stat"><span class="crypto-stat-label">' + esc(label) + '</span><span class="crypto-stat-value">' + esc(value) + '</span></div>';
    }

    function pctChangeFromHistory(hist, daysAgo) {
        if (!hist || hist.length <= daysAgo) return null;
        var latest = hist[0].price;
        var past = hist[daysAgo].price;
        if (!past) return null;
        return ((latest - past) / past) * 100;
    }

    function renderOverviewChart(hist) {
        var el = document.getElementById('crypto-chart-1y');
        if (!el || !window.LightweightCharts || !hist || hist.length === 0) return;
        var slice = hist.slice(0, Math.min(365, hist.length));
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

    // ── News ──

    var NEWS_CATS = [
        { key: 'crypto', label: 'Crypto' },
        { key: 'articles', label: 'Articles' },
        { key: 'general', label: 'General' },
    ];
    var activeNewsCat = 'crypto';

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
        // crypto news is global by default; symbol filter narrows it.
        var url = '/api/news/' + cat + '?symbol=' + encodeURIComponent(symbol) + '&limit=20';
        fetch(url).then(function (r) { return r.json(); }).then(function (items) {
            if (!items || items.length === 0) {
                // Retry without symbol filter — crypto news rarely tags
                // individual coins; fall back to the broad feed.
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
                html += '<p class="empty-state">No analysis yet. SEC + competitor analysts are skipped for crypto.</p>';
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

    // ── Peer Coins ──

    // Curated top-10 by market cap. Static list — same pattern as the
    // sectorETFs map in fundamentals.go. Update as rankings shift.
    var PEER_COINS = [
        'BTCUSD', 'ETHUSD', 'SOLUSD', 'BNBUSD', 'XRPUSD',
        'ADAUSD', 'AVAXUSD', 'DOTUSD', 'MATICUSD', 'LINKUSD',
    ];

    function loadPeers() {
        var html = '<div class="sector-section-title">Top Coins by Market Cap</div>';
        html += '<table class="fin-table peer-table" id="peer-table"><thead><tr>';
        html += '<th>Coin</th><th>Name</th><th>Price</th><th>24h</th><th>Market Cap</th><th>1M</th>';
        html += '</tr></thead><tbody>';
        PEER_COINS.forEach(function (sym) {
            var isCurrent = sym === symbol;
            html += '<tr class="peer-row' + (isCurrent ? ' peer-current' : '') + '" data-symbol="' + esc(sym) + '">';
            html += '<td><span class="sym-link">' + esc(sym) + '</span></td>';
            html += '<td data-cell="name">—</td>';
            html += '<td data-cell="price">—</td>';
            html += '<td data-cell="ch24">—</td>';
            html += '<td data-cell="mcap">—</td>';
            html += '<td><div class="peer-spark" data-spark-sym="' + esc(sym) + '"></div></td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;

        // Click → navigate to that coin's crypto page.
        container.querySelectorAll('.peer-row').forEach(function (row) {
            row.onclick = function () {
                var sym = row.dataset.symbol;
                if (sym) window.location.href = '/crypto/' + sym;
            };
        });

        // Fill quotes in parallel — one fetch per coin keeps the code
        // simple and the request count tiny.
        PEER_COINS.forEach(function (sym) {
            fetch('/api/security/' + sym + '/quote')
                .then(function (r) { return r.json(); })
                .then(function (rows) {
                    if (!rows || !rows[0]) return;
                    var q = rows[0];
                    var row = container.querySelector('.peer-row[data-symbol="' + sym + '"]');
                    if (!row) return;
                    row.querySelector('[data-cell="name"]').textContent = q.name || '';
                    row.querySelector('[data-cell="price"]').textContent = '$' + fmtPrice(q.price);
                    var ch24 = q.changePercentage;
                    var chEl = row.querySelector('[data-cell="ch24"]');
                    chEl.textContent = pct(ch24);
                    chEl.classList.add(pctClass(ch24));
                    row.querySelector('[data-cell="mcap"]').textContent = q.marketCap ? '$' + fmtVol(q.marketCap) : '—';
                });
        });

        loadPeerSparklines();
    }

    function loadPeerSparklines() {
        function tryRender() {
            if (!window.LightweightCharts) { setTimeout(tryRender, 200); return; }
            var from = new Date(); from.setMonth(from.getMonth() - 1);
            var fromStr = from.toISOString().slice(0, 10);
            var toStr = new Date().toISOString().slice(0, 10);

            container.querySelectorAll('.peer-spark').forEach(function (el) {
                var sym = el.dataset.sparkSym;
                if (!sym) return;
                fetch('/api/chart/eod/' + sym + '?from=' + fromStr + '&to=' + toStr)
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        if (!data || data.length < 2) return;
                        var first = data[0].close, last = data[data.length - 1].close;
                        var color = last >= first ? '#00cc66' : '#ff4444';
                        var chart = LightweightCharts.createChart(el, {
                            width: 80, height: 24,
                            layout: { background: { color: 'transparent' }, textColor: 'transparent', attributionLogo: false },
                            grid: { vertLines: { visible: false }, horzLines: { visible: false } },
                            rightPriceScale: { visible: false }, timeScale: { visible: false },
                            handleScroll: false, handleScale: false,
                            crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
                        });
                        var series = chart.addSeries(LightweightCharts.AreaSeries, {
                            lineColor: color,
                            topColor: color === '#00cc66' ? 'rgba(0, 204, 102, 0.15)' : 'rgba(255, 68, 68, 0.15)',
                            bottomColor: 'transparent', lineWidth: 1,
                            priceLineVisible: false, lastValueVisible: false,
                        });
                        series.setData(data.map(function (d) { return { time: d.date, value: d.close }; }));
                        chart.timeScale().fitContent();
                    }).catch(function () {});
            });
        }
        tryRender();
    }

    // ── Init ──

    loadTab('overview');
})();
