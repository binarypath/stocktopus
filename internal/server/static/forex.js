// forex.js — /forex/{symbol} page. Tabs: Overview, News, AI, Central Banks.
//
// FX pairs on FMP follow strict <FROM><TO> 6-char format (USDGBP =
// USD + GBP), so we split the ticker on the client without a roundtrip.
// Central Banks cross-links into /economics for the two currencies'
// policy rates where we already have catalog coverage (USD/EUR/GBP).

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

    // FX rates carry small numbers (0.7504, 1.2356) — show 4 decimals
    // for legibility. Pip-level (5 decimals) is overkill for an at-a-
    // glance view.
    function fmtRate(n) {
        if (n == null || isNaN(n)) return '—';
        return n.toFixed(4);
    }

    function splitPair(sym) {
        if (!sym || sym.length !== 6) return { from: '', to: '' };
        return { from: sym.slice(0, 3).toUpperCase(), to: sym.slice(3, 6).toUpperCase() };
    }

    // Currency → /economics catalog handles. Limited to the central
    // banks we already cover (US Fed, ECB, BoE). Other currencies fall
    // through with a "no policy rate context" empty state.
    var CCY_TO_ECON = {
        USD: { country: 'US', rateId: 'US.FEDFUNDS', name: 'Federal Reserve', rateLabel: 'Fed Funds Rate' },
        EUR: { country: 'EZ', rateId: 'EZ.RATE',     name: 'European Central Bank', rateLabel: 'ECB Main Refi Rate' },
        GBP: { country: 'UK', rateId: 'UK.RATE',     name: 'Bank of England', rateLabel: 'Official Bank Rate' },
    };

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
                case 'central-banks': loadCentralBanks(); break;
            }
        } catch (e) {
            console.error('Forex tab load error:', tab, e);
            container.innerHTML = '<p class="empty-state">Failed to load ' + tab + '</p>';
        }
    }

    // ── Overview ──

    function loadOverview() {
        Promise.all([
            fetch('/api/security/' + symbol + '/quote').then(function (r) { return r.json(); }).catch(function () { return []; }),
            fetch('/api/historical/price/' + symbol).then(function (r) { return r.json(); }).catch(function () { return []; }),
        ]).then(function (results) {
            var q = (results[0] && results[0][0]) || {};
            var hist = results[1] || [];

            var pair = splitPair(symbol);
            var price = q.price;
            var ch1d = q.changePercentage;
            var chYTD = pctChangeFromHistoryYTD(hist);
            var ch1Y = pctChangeFromHistory(hist, 252);

            var html = '';
            html += '<div class="crypto-header">';
            html += '<span class="crypto-name">' + esc(pair.from + '/' + pair.to) + '</span>';
            html += '<span class="crypto-exchange">FOREX</span>';
            html += '</div>';

            html += '<div class="crypto-price-row">';
            html += '<span class="crypto-price">' + fmtRate(price) + '</span>';
            html += '<span class="crypto-change ' + pctClass(ch1d) + '">1d ' + pct(ch1d) + '</span>';
            html += '<span class="crypto-change ' + pctClass(chYTD) + '">YTD ' + pct(chYTD) + '</span>';
            html += '<span class="crypto-change ' + pctClass(ch1Y) + '">1y ' + pct(ch1Y) + '</span>';
            html += '</div>';

            html += '<div class="crypto-stats">';
            html += statCell('Day Range', q.dayLow && q.dayHigh ? fmtRate(q.dayLow) + ' – ' + fmtRate(q.dayHigh) : '—');
            html += statCell('52W Range', q.yearLow && q.yearHigh ? fmtRate(q.yearLow) + ' – ' + fmtRate(q.yearHigh) : '—');
            html += statCell('Previous Close', q.previousClose ? fmtRate(q.previousClose) : '—');
            html += statCell('50-day Avg', q.priceAvg50 ? fmtRate(q.priceAvg50) : '—');
            html += statCell('200-day Avg', q.priceAvg200 ? fmtRate(q.priceAvg200) : '—');
            html += statCell('Inverse', price ? fmtRate(1 / price) : '—');
            html += '</div>';

            html += '<div id="forex-chart-1y" class="crypto-chart"></div>';

            container.innerHTML = html;
            renderOverviewChart(hist);
        }).catch(function (err) {
            console.error('Forex overview error:', err);
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
        var el = document.getElementById('forex-chart-1y');
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

    // ── Central Banks ──

    function loadCentralBanks() {
        var pair = splitPair(symbol);
        var fromMeta = CCY_TO_ECON[pair.from];
        var toMeta = CCY_TO_ECON[pair.to];

        if (!fromMeta && !toMeta) {
            container.innerHTML = '<p class="empty-state">No policy-rate coverage for ' + esc(pair.from + '/' + pair.to) + ' yet. Currently support USD, EUR, GBP.</p>';
            return;
        }

        var html = '<div class="sector-section-title">Policy Rates</div>';
        html += '<table class="fin-table peer-table"><thead><tr>';
        html += '<th>Currency</th><th>Central Bank</th><th>Series</th><th>Latest</th><th>As of</th>';
        html += '</tr></thead><tbody>';
        [
            { ccy: pair.from, meta: fromMeta },
            { ccy: pair.to,   meta: toMeta },
        ].forEach(function (row) {
            if (!row.meta) {
                html += '<tr><td>' + esc(row.ccy) + '</td><td colspan="4" class="empty-state">No catalog coverage</td></tr>';
                return;
            }
            var m = row.meta;
            html += '<tr class="peer-row" data-rate-id="' + esc(m.rateId) + '">';
            html += '<td><span class="sym-link">' + esc(row.ccy) + '</span></td>';
            html += '<td>' + esc(m.name) + '</td>';
            html += '<td>' + esc(m.rateLabel) + '</td>';
            html += '<td data-cell="latest">—</td>';
            html += '<td data-cell="date">—</td>';
            html += '</tr>';
        });
        html += '</tbody></table>';
        html += '<p class="empty-state">Press <kbd>g</kbd> on a row, or click, to open the full series on /economics.</p>';
        container.innerHTML = html;

        // Click → /economics?country=... — same drill-down the /economics
        // page already understands.
        container.querySelectorAll('.peer-row').forEach(function (row) {
            row.onclick = function () {
                var rateId = row.dataset.rateId;
                if (!rateId) return;
                window.location.href = '/graph/' + encodeURIComponent(rateId);
            };
        });

        // Fill the rate values from the cached economics series.
        [fromMeta, toMeta].filter(Boolean).forEach(function (m) {
            fetch('/api/economics/series/' + encodeURIComponent(m.rateId))
                .then(function (r) { return r.json(); })
                .then(function (es) {
                    if (!es || !es.observations || es.observations.length === 0) return;
                    var last = es.observations[es.observations.length - 1];
                    var row = container.querySelector('.peer-row[data-rate-id="' + m.rateId + '"]');
                    if (!row) return;
                    row.querySelector('[data-cell="latest"]').textContent = last.value.toFixed(2) + '%';
                    row.querySelector('[data-cell="date"]').textContent = last.date;
                })
                .catch(function () {});
        });
    }

    // ── News ──

    var NEWS_CATS = [
        { key: 'forex', label: 'Forex' },
        { key: 'articles', label: 'Articles' },
        { key: 'general', label: 'General' },
    ];
    var activeNewsCat = 'forex';

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
        // Forex feeds rarely tag individual pairs; go broad.
        var url = '/api/news/' + cat + '?limit=20';
        fetch(url).then(function (r) { return r.json(); }).then(renderNewsList).catch(function () {
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
                html += '<p class="empty-state">No analysis yet. SEC + competitor analysts are skipped for forex.</p>';
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
