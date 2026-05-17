// fund.js — /fund/{symbol} page. Mutual funds price once daily at NAV
// and FMP doesn't expose their holdings / sectors on our tier, so the
// page is a trimmed version of etf.js:
//   - Overview: NAV, daily Δ, YTD/1Y %, sector/industry/manager, 1Y chart
//   - News: Stock + Articles + General (no Forex/Crypto)
//   - AI Analysis: shared trading-pipeline UI (SEC analyst skipped server-side)
//
// No Holdings / Sectors tab — the endpoints return empty for funds.

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
                case 'news': loadNews(); break;
                case 'ai': loadAI(); break;
            }
        } catch (e) {
            console.error('Fund tab load error:', tab, e);
            container.innerHTML = '<p class="empty-state">Failed to load ' + tab + '</p>';
        }
    }

    // ── Overview ──

    function loadOverview() {
        Promise.all([
            fetch('/api/security/' + symbol + '/quote').then(function (r) { return r.json(); }).catch(function () { return []; }),
            fetch('/api/security/' + symbol + '/profile').then(function (r) { return r.json(); }).catch(function () { return []; }),
            fetch('/api/historical/price/' + symbol).then(function (r) { return r.json(); }).catch(function () { return []; }),
        ]).then(function (results) {
            var q = (results[0] && results[0][0]) || {};
            var p = (results[1] && results[1][0]) || {};
            var hist = results[2] || [];

            var nav = q.price;
            var ch1d = q.changePercentage;
            var chYTD = pctChangeFromHistoryYTD(hist);
            var ch1Y = pctChangeFromHistory(hist, 252);

            var html = '';
            html += '<div class="crypto-header">';
            html += '<span class="crypto-name">' + esc(p.companyName || q.name || symbol) + '</span>';
            html += '<span class="crypto-exchange">FUND</span>';
            html += '</div>';

            html += '<div class="crypto-price-row">';
            html += '<span class="crypto-price">$' + fmtPrice(nav) + '</span>';
            html += '<span class="crypto-change ' + pctClass(ch1d) + '">1d ' + pct(ch1d) + '</span>';
            html += '<span class="crypto-change ' + pctClass(chYTD) + '">YTD ' + pct(chYTD) + '</span>';
            html += '<span class="crypto-change ' + pctClass(ch1Y) + '">1y ' + pct(ch1Y) + '</span>';
            html += '</div>';

            html += '<div class="crypto-stats">';
            html += statCell('NAV', q.price ? '$' + fmtPrice(q.price) : '—');
            html += statCell('AUM', fmtBig(q.marketCap || p.marketCap));
            html += statCell('52W Range', q.yearLow && q.yearHigh ? '$' + fmtPrice(q.yearLow) + ' – $' + fmtPrice(q.yearHigh) : '—');
            html += statCell('Sector', p.sector || '—');
            html += statCell('Industry', p.industry || '—');
            html += statCell('Issuer', p.companyName ? extractIssuer(p.companyName) : '—');
            html += statCell('Listed on', p.exchange || q.exchange || '—');
            html += statCell('Currency', p.currency || '—');
            html += '</div>';

            html += '<div id="fund-chart-1y" class="crypto-chart"></div>';

            if (p.description) {
                html += '<div class="crypto-desc">' + esc(p.description) + '</div>';
            }

            container.innerHTML = html;
            renderOverviewChart(hist);
        }).catch(function (err) {
            console.error('Fund overview error:', err);
            container.innerHTML = '<p class="empty-state">Failed to load overview</p>';
        });
    }

    // extractIssuer pulls the asset manager out of a fund name when the
    // first word is the brand (e.g. "BlackRock High Yield K" → "BlackRock",
    // "Vanguard 500 Index Admiral" → "Vanguard"). Falls back to the full
    // name when ambiguous.
    function extractIssuer(name) {
        if (!name) return '';
        var first = name.split(/\s+/)[0];
        return first || name;
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
        var el = document.getElementById('fund-chart-1y');
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
                // Fund tickers rarely tag in symbol-filtered news;
                // fall back to the broad feed.
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
                html += '<p class="empty-state">No analysis yet. SEC + competitor analysts are skipped for mutual funds.</p>';
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
