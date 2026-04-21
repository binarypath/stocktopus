// Stocktopus Info — Security deep dive

(function () {
    'use strict';

    var container = document.getElementById('info-content');
    if (!container) return;

    var symbol = container.dataset.symbol;
    if (!symbol) return;

    // ── Help Text ──

    var HELP = {
        'market-cap':     'Total market value of all outstanding shares',
        'p-e--ttm-':      'Price-to-Earnings ratio (trailing 12 months) — how much investors pay per dollar of earnings',
        'eps--ttm-':      'Earnings Per Share — net income divided by shares outstanding',
        'dividend':       'Most recent annual dividend payment per share',
        'beta':           'Volatility relative to the market — 1.0 = moves with market, >1 = more volatile',
        '52w-range':      'Lowest and highest price over the past 52 weeks',
        'volume':         'Number of shares traded in the most recent session',
        'avg-volume':     'Average daily trading volume',
        'ev-ebitda':      'Enterprise Value / EBITDA — valuation metric comparing total company value to operating earnings',
        'ev-sales':       'Enterprise Value / Sales — valuation relative to revenue',
        'current-ratio':  'Current assets / current liabilities — ability to pay short-term obligations (>1 = healthy)',
        'debt-equity':    'Total debt / shareholder equity — financial leverage',
        'roe':            'Return on Equity — net income / equity — profitability of shareholder investment',
        'gross-margin':   'Gross profit / revenue — percentage retained after cost of goods',
        'net-margin':     'Net income / revenue — percentage retained after all expenses',
        'p-b':            'Price-to-Book — market price / book value per share',
        'revenue':        'Total income from business operations before any deductions',
        'cost-of-revenue':'Direct costs of producing goods/services sold',
        'gross-profit':   'Revenue minus cost of revenue',
        'r-d-expenses':   'Spending on research and development of new products',
        'operating-income':'Profit from core business operations before interest and taxes',
        'ebitda':         'Earnings Before Interest, Taxes, Depreciation & Amortization — operating profitability',
        'net-income':     'Total profit after all expenses, taxes, and interest',
        'eps':            'Earnings Per Share — net income divided by outstanding shares',
        'total-assets':   'Everything the company owns — cash, property, equipment, investments',
        'current-assets': 'Assets expected to be converted to cash within one year',
        'cash---equivalents':'Cash on hand and highly liquid short-term investments',
        'total-liabilities':'Everything the company owes — loans, bonds, payables',
        'current-liabilities':'Obligations due within one year',
        'long-term-debt': 'Debt obligations due after one year',
        'total-equity':   'Assets minus liabilities — shareholder ownership value',
        'retained-earnings':'Accumulated profits not distributed as dividends',
        'operating-cf':   'Cash generated from core business operations',
        'investing-cf':   'Cash spent on or received from investments, acquisitions, assets',
        'financing-cf':   'Cash from issuing/repaying debt, equity, dividends',
        'capex':          'Capital Expenditure — money spent on physical assets (property, equipment)',
        'free-cash-flow': 'Operating cash flow minus CapEx — cash available for dividends, buybacks, debt reduction',
        'dividends-paid': 'Total cash distributed to shareholders as dividends',
        'share-buyback':  'Cash spent repurchasing the company\'s own shares',
        'revenue-est':    'Analyst consensus forecast for total revenue — average with low–high range',
        'eps-est':        'Analyst consensus forecast for Earnings Per Share — average with low–high range',
        'ebitda-est':     'Analyst consensus forecast for EBITDA (operating earnings before depreciation)',
        'net-income-est': 'Analyst consensus forecast for total net profit',
    };

    var helpVisible = false;

    function toggleHelp() {
        helpVisible = !helpVisible;
        document.querySelectorAll('.help-tip').forEach(function (el) {
            el.classList.toggle('hidden', !helpVisible);
        });
        // Update help indicator
        var indicator = document.getElementById('help-indicator');
        if (indicator) indicator.classList.toggle('hidden', !helpVisible);
    }

    // Expose for vim
    window._infoToggleHelp = toggleHelp;

    // ── Number Formatting ──

    function fmt(n) {
        if (n == null || isNaN(n)) return '—';
        var abs = Math.abs(n);
        var str;
        if (abs >= 1e12) str = (n / 1e12).toFixed(2) + 'T';
        else if (abs >= 1e9) str = (n / 1e9).toFixed(2) + 'B';
        else if (abs >= 1e6) str = (n / 1e6).toFixed(2) + 'M';
        else if (abs >= 1e3) str = (n / 1e3).toFixed(1) + 'K';
        else str = n.toFixed(2);
        return n < 0 ? '<span class="price-down">' + str + '</span>' : str;
    }

    function pct(n) {
        if (n == null || isNaN(n)) return '—';
        return (n * 100).toFixed(2) + '%';
    }

    function esc(s) {
        if (!s) return '';
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ── Tab Switching ──

    var tabs = document.getElementById('info-tabs');
    if (tabs) {
        tabs.querySelectorAll('.info-tab').forEach(function (tab) {
            tab.onclick = function () {
                tabs.querySelectorAll('.info-tab').forEach(function (t) { t.classList.remove('active'); });
                tab.classList.add('active');
                loadTab(tab.dataset.tab);
            };
        });
    }

    // Expose for vim keybindings
    window._infoJumpToTab = function (n) {
        var allTabs = tabs.querySelectorAll('.info-tab');
        if (n < allTabs.length) allTabs[n].click();
    };

    // ── Sparkline ──

    function initSparkline() {
        var el = document.getElementById('info-sparkline');
        if (!el || !window.LightweightCharts) return;

        var from = new Date();
        from.setMonth(from.getMonth() - 6);
        var to = new Date();
        var fromStr = to.getFullYear() === from.getFullYear()
            ? from.toISOString().slice(0, 10)
            : from.toISOString().slice(0, 10);

        fetch('/api/chart/eod/' + symbol + '?from=' + from.toISOString().slice(0, 10) + '&to=' + to.toISOString().slice(0, 10))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || data.length < 2) return;

                var first = data[0].close;
                var last = data[data.length - 1].close;
                var color = last >= first ? '#00cc66' : '#ff4444';

                var chart = LightweightCharts.createChart(el, {
                    width: 200,
                    height: 50,
                    layout: { background: { color: 'transparent' }, textColor: 'transparent' },
                    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
                    rightPriceScale: { visible: false },
                    timeScale: { visible: false },
                    handleScroll: false,
                    handleScale: false,
                    crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
                });

                var series = chart.addSeries(LightweightCharts.AreaSeries, {
                    lineColor: color,
                    topColor: color.replace(')', ', 0.2)').replace('rgb', 'rgba'),
                    bottomColor: 'transparent',
                    lineWidth: 2,
                    priceLineVisible: false,
                    lastValueVisible: false,
                });

                series.setData(data.map(function (d) { return { time: d.date, value: d.close }; }));
                chart.timeScale().fitContent();
            });
    }

    // ── Load Header (profile price/change) ──

    function loadHeader() {
        fetch('/api/security/' + symbol + '/profile')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.length) return;
                var p = data[0];
                var nameEl = document.getElementById('info-company-name');
                var priceEl = document.getElementById('info-price');
                var changeEl = document.getElementById('info-change');
                if (nameEl) nameEl.textContent = p.companyName || '';
                if (priceEl) priceEl.textContent = p.price ? p.price.toFixed(2) : '';
                if (changeEl) {
                    var chg = p.change || 0;
                    var chgPct = p.changePercentage || 0;
                    changeEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + ' (' + chgPct.toFixed(2) + '%)';
                    changeEl.className = 'info-change ' + (chg >= 0 ? 'price-up' : 'price-down');
                }
            });
    }

    // ── Tab Loaders ──

    function loadTab(tab) {
        container.innerHTML = '<p class="empty-state">Loading...</p>';
        switch (tab) {
            case 'overview': loadOverview(); break;
            case 'financials': loadFinancials('income'); break;
            case 'estimates': loadEstimates(); break;
            case 'news': loadNews(); break;
            case 'ai': loadAI(); break;
        }
    }

    // ── Overview ──

    function loadOverview() {
        Promise.all([
            fetch('/api/security/' + symbol + '/profile').then(function (r) { return r.json(); }),
            fetch('/api/security/' + symbol + '/metrics').then(function (r) { return r.json(); }),
        ]).then(function (results) {
            var profile = results[0] && results[0][0] ? results[0][0] : {};
            var metricsData = results[1] || {};
            var metrics = metricsData.metrics && metricsData.metrics[0] ? metricsData.metrics[0] : {};
            var ratios = metricsData.ratios && metricsData.ratios[0] ? metricsData.ratios[0] : {};

            var html = '<div class="info-overview">';

            // Key stats grid
            html += '<div class="info-grid">';
            html += stat('Market Cap', fmt(profile.marketCap));
            html += stat('P/E (TTM)', ratios.priceToEarningsRatioTTM ? ratios.priceToEarningsRatioTTM.toFixed(2) : '—');
            html += stat('EPS (TTM)', profile.eps ? profile.eps.toFixed(2) : '—');
            html += stat('Dividend', profile.lastDividend ? '$' + profile.lastDividend.toFixed(2) : '—');
            html += stat('Beta', profile.beta ? profile.beta.toFixed(3) : '—');
            html += stat('52W Range', profile.range || '—');
            html += stat('Volume', fmt(profile.volume));
            html += stat('Avg Volume', fmt(profile.averageVolume));
            html += '</div>';

            // Metrics grid
            html += '<div class="info-grid">';
            html += stat('EV/EBITDA', metrics.evToEBITDA ? metrics.evToEBITDA.toFixed(2) : '—');
            html += stat('EV/Sales', metrics.evToSales ? metrics.evToSales.toFixed(2) : '—');
            html += stat('Current Ratio', ratios.currentRatioTTM ? ratios.currentRatioTTM.toFixed(2) : '—');
            html += stat('Debt/Equity', ratios.debtToEquityRatioTTM ? ratios.debtToEquityRatioTTM.toFixed(2) : '—');
            html += stat('ROE', pct(ratios.returnOnEquityTTM));
            html += stat('Gross Margin', pct(ratios.grossProfitMarginTTM));
            html += stat('Net Margin', pct(ratios.netProfitMarginTTM));
            html += stat('P/B', ratios.priceToBookRatioTTM ? ratios.priceToBookRatioTTM.toFixed(2) : '—');
            html += '</div>';

            // Company info
            html += '<div class="info-company">';
            html += '<div class="info-company-meta">';
            html += '<span>' + esc(profile.sector) + ' / ' + esc(profile.industry) + '</span>';
            html += '<span>CEO: ' + esc(profile.ceo) + '</span>';
            html += '<span>' + esc(profile.fullTimeEmployees) + ' employees</span>';
            html += '<span>' + esc(profile.exchange) + '</span>';
            if (profile.website) html += '<span><a href="' + esc(profile.website) + '" target="_blank" rel="noopener">' + esc(profile.website) + '</a></span>';
            html += '</div>';
            if (profile.description) {
                var desc = profile.description;
                html += '<p class="info-description">' + esc(desc) + '</p>';
            }
            html += '</div>';

            html += '</div>';
            container.innerHTML = html;
        }).catch(function () {
            container.innerHTML = '<p class="empty-state">Failed to load overview</p>';
        });
    }

    function stat(label, value) {
        var field = label.toLowerCase().replace(/[^a-z0-9]/g, '-');
        var tip = HELP[field] ? '<span class="help-tip hidden">' + esc(HELP[field]) + '</span>' : '';
        return '<div class="info-stat"><span class="info-stat-label">' + label + tip + '</span><span class="info-stat-value" data-field="' + field + '">' + value + '</span></div>';
    }

    // ── Financials ──

    var finSubTypes = [
        { key: 'income',   label: 'Income',        hotkey: 'i' },
        { key: 'balance',  label: 'Balance Sheet',  hotkey: 'b' },
        { key: 'cashflow', label: 'Cash Flow',      hotkey: 'c' },
    ];

    function loadFinancials(type) {
        // Sub-tab bar with keycap badges
        var subHtml = '<div class="info-sub-tabs" id="fin-sub-tabs">';
        finSubTypes.forEach(function (t, i) {
            var active = t.key === type ? ' active' : '';
            subHtml += '<button class="info-sub-tab' + active + '" data-ftype="' + t.key + '"><span class="tab-key">' + t.hotkey + '</span> ' + t.label + '</button>';
        });
        subHtml += '</div><div id="fin-table-container"><p class="empty-state">Loading...</p></div>';
        container.innerHTML = subHtml;

        container.querySelectorAll('.info-sub-tab').forEach(function (btn) {
            btn.onclick = function () {
                container.querySelectorAll('.info-sub-tab').forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                loadFinancialTable(btn.dataset.ftype);
            };
        });

        loadFinancialTable(type);
    }

    // Expose for vim sub-tab navigation
    window._infoFinSubTabs = function () {
        return Array.from(document.querySelectorAll('#fin-sub-tabs .info-sub-tab'));
    };
    window._infoFinJumpToSub = function (n) {
        var tabs = window._infoFinSubTabs();
        if (n >= 0 && n < tabs.length) tabs[n].click();
    };

    function loadFinancialTable(type) {
        var tc = document.getElementById('fin-table-container');
        if (!tc) return;
        tc.innerHTML = '<p class="empty-state">Loading...</p>';

        fetch('/api/security/' + symbol + '/financials?type=' + type)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || data.length === 0) {
                    tc.innerHTML = '<p class="empty-state">No data available</p>';
                    return;
                }

                var rows;
                if (type === 'income') {
                    rows = [
                        ['Revenue', 'revenue'],
                        ['Cost of Revenue', 'costOfRevenue'],
                        ['Gross Profit', 'grossProfit'],
                        ['R&D Expenses', 'researchAndDevelopmentExpenses'],
                        ['Operating Income', 'operatingIncome'],
                        ['EBITDA', 'ebitda'],
                        ['Net Income', 'netIncome'],
                        ['EPS', 'eps'],
                    ];
                } else if (type === 'balance') {
                    rows = [
                        ['Total Assets', 'totalAssets'],
                        ['Current Assets', 'totalCurrentAssets'],
                        ['Cash & Equivalents', 'cashAndCashEquivalents'],
                        ['Total Liabilities', 'totalLiabilities'],
                        ['Current Liabilities', 'totalCurrentLiabilities'],
                        ['Long-Term Debt', 'longTermDebt'],
                        ['Total Equity', 'totalStockholdersEquity'],
                        ['Retained Earnings', 'retainedEarnings'],
                    ];
                } else {
                    rows = [
                        ['Operating CF', 'operatingCashFlow'],
                        ['Investing CF', 'netCashUsedForInvestingActivities'],
                        ['Financing CF', 'netCashUsedProvidedByFinancingActivities'],
                        ['CapEx', 'capitalExpenditure'],
                        ['Free Cash Flow', 'freeCashFlow'],
                        ['Dividends Paid', 'dividendsPaid'],
                        ['Share Buyback', 'commonStockRepurchased'],
                    ];
                }

                var html = '<table class="fin-table"><thead><tr><th></th>';
                data.forEach(function (d) {
                    html += '<th>' + (d.fiscalYear || d.date || '').substring(0, 4) + '</th>';
                });
                html += '</tr></thead><tbody>';

                rows.forEach(function (row) {
                    var field = row[0].toLowerCase().replace(/[^a-z0-9]/g, '-');
                    var tip = HELP[field] ? '<span class="help-tip hidden">' + esc(HELP[field]) + '</span>' : '';
                    html += '<tr><td class="fin-label">' + row[0] + tip + '</td>';
                    data.forEach(function (d) {
                        html += '<td>' + fmt(d[row[1]]) + '</td>';
                    });
                    html += '</tr>';
                });

                html += '</tbody></table>';
                tc.innerHTML = html;
            })
            .catch(function () {
                tc.innerHTML = '<p class="empty-state">Failed to load financials</p>';
            });
    }

    // ── Estimates ──

    function loadEstimates() {
        fetch('/api/security/' + symbol + '/estimates')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || data.length === 0) {
                    container.innerHTML = '<p class="empty-state">No estimates available</p>';
                    return;
                }

                // Sort by date ascending
                data.sort(function (a, b) { return a.date.localeCompare(b.date); });

                var estCols = [
                    ['Year', ''],
                    ['Revenue Est', 'revenue-est'],
                    ['EPS Est', 'eps-est'],
                    ['EBITDA Est', 'ebitda-est'],
                    ['Net Income Est', 'net-income-est'],
                ];
                var html = '<table class="fin-table"><thead><tr>';
                estCols.forEach(function (col) {
                    var tip = col[1] && HELP[col[1]] ? '<span class="help-tip hidden">' + esc(HELP[col[1]]) + '</span>' : '';
                    html += '<th>' + col[0] + tip + '</th>';
                });
                html += '</tr></thead><tbody>';

                data.forEach(function (d) {
                    var year = (d.date || '').substring(0, 4);
                    html += '<tr>';
                    html += '<td class="fin-label">' + year + '</td>';
                    html += '<td>' + fmt(d.revenueAvg) + ' <span class="est-range">' + fmt(d.revenueLow) + '–' + fmt(d.revenueHigh) + '</span></td>';
                    html += '<td>' + (d.epsAvg != null ? d.epsAvg.toFixed(2) : '—') + ' <span class="est-range">' + (d.epsLow != null ? d.epsLow.toFixed(2) : '—') + '–' + (d.epsHigh != null ? d.epsHigh.toFixed(2) : '—') + '</span></td>';
                    html += '<td>' + fmt(d.ebitdaAvg) + '</td>';
                    html += '<td>' + fmt(d.netIncomeAvg) + '</td>';
                    html += '</tr>';
                });

                html += '</tbody></table>';
                container.innerHTML = html;
            })
            .catch(function () {
                container.innerHTML = '<p class="empty-state">Failed to load estimates</p>';
            });
    }

    // ── News (reuse existing pattern) ──

    function loadNews() {
        container.innerHTML = '<p class="empty-state">Loading...</p>';

        fetch('/api/news/press-releases?symbol=' + symbol + '&limit=20')
            .then(function (r) { return r.json(); })
            .then(function (items) {
                if (!items || items.length === 0) {
                    container.innerHTML = '<p class="empty-state">No news available for ' + symbol + '</p>';
                    return;
                }
                container.innerHTML = '<div class="news-cards" style="max-height:calc(100vh - 220px)">' +
                    items.map(function (item) {
                        var date = item.date ? new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
                        var text = item.text || '';
                        if (text.length > 200) text = text.substring(0, 200) + '...';
                        return '<div class="news-card news-unread">'
                            + '<div class="news-card-title"><a href="' + esc(item.url) + '" target="_blank" rel="noopener">' + esc(item.title) + '</a></div>'
                            + '<div class="news-card-meta"><span>' + esc(item.source) + '</span><span>' + date + '</span></div>'
                            + '<div class="news-card-text">' + esc(text) + '</div>'
                            + '</div>';
                    }).join('') + '</div>';
            })
            .catch(function () {
                container.innerHTML = '<p class="empty-state">Failed to load news</p>';
            });
    }

    // ── AI Analysis ──

    function loadAI() {
        container.innerHTML = '<p class="empty-state">Loading AI analysis...</p>';

        fetch('/api/security/' + symbol + '/intelligence')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                // Status response (pipeline running/pending) vs full analysis
                if (data.status && !data.summary) {
                    if (data.status === 'running' || data.status === 'pending') {
                        container.innerHTML = renderAIProgress(data);
                        pollAIStatus();
                        return;
                    }
                    if (data.status === 'failed') {
                        container.innerHTML = '<p class="empty-state">AI analysis failed: ' + esc(data.error || 'unknown') + '</p>';
                        return;
                    }
                }
                if (data.error && !data.summary) {
                    container.innerHTML = '<p class="empty-state">AI analysis unavailable: ' + esc(data.error) + '</p>';
                    return;
                }
                container.innerHTML = renderAIAnalysis(data);
            })
            .catch(function () {
                container.innerHTML = '<p class="empty-state">Failed to load AI analysis</p>';
            });
    }

    function pollAIStatus() {
        var pollInterval = setInterval(function () {
            fetch('/api/security/' + symbol + '/intelligence/status')
                .then(function (r) { return r.json(); })
                .then(function (status) {
                    if (status.status === 'complete') {
                        clearInterval(pollInterval);
                        // Fetch the full result
                        fetch('/api/security/' + symbol + '/intelligence')
                            .then(function (r) { return r.json(); })
                            .then(function (data) {
                                container.innerHTML = renderAIAnalysis(data);
                            });
                    } else if (status.status === 'failed') {
                        clearInterval(pollInterval);
                        container.innerHTML = '<p class="empty-state">AI analysis failed: ' + esc(status.error || 'unknown error') + '</p>';
                    } else {
                        // Update progress
                        container.innerHTML = renderAIProgress(status);
                    }
                });
        }, 2000);
    }

    function renderAIProgress(data) {
        var html = '<div class="ai-progress">';
        html += '<div class="ai-progress-header"><span class="spinner"></span> Analyzing ' + esc(symbol) + '...</div>';
        if (data.tasks) {
            html += '<div class="ai-tasks">';
            data.tasks.forEach(function (t) {
                var icon = t.status === 'complete' ? '&#10003;' : t.status === 'running' ? '&#9679;' : '&#9675;';
                var cls = 'ai-task ai-task-' + t.status;
                html += '<div class="' + cls + '">' + icon + ' ' + esc(t.id || t.type) + '</div>';
            });
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    function renderAIAnalysis(data) {
        var html = '<div class="ai-analysis">';

        // Summary
        if (data.summary) {
            html += '<div class="ai-section">';
            html += '<div class="ai-section-title">Executive Summary</div>';
            html += '<p class="ai-summary">' + esc(data.summary) + '</p>';
            html += '</div>';
        }

        // Scores row
        html += '<div class="ai-scores">';
        var sent = data.sentiment || 0;
        var risk = data.riskScore || 0;
        var conf = data.confidence ? data.confidence * 100 : 0;
        html += renderScore('Sentiment', sent, -1, 1, sent >= 0 ? 'price-up' : 'price-down');
        html += renderScore('Risk', risk, 0, 100, risk > 60 ? 'price-down' : 'price-up');
        html += renderScore('Confidence', conf, 0, 100, '');
        html += '</div>';

        // Key Risks
        if (data.keyRisks && data.keyRisks.length > 0) {
            html += '<div class="ai-section">';
            html += '<div class="ai-section-title">Key Risks</div>';
            html += '<ul class="ai-list ai-risks">';
            data.keyRisks.forEach(function (r) { html += '<li>' + esc(r) + '</li>'; });
            html += '</ul></div>';
        }

        // Opportunities
        if (data.opportunities && data.opportunities.length > 0) {
            html += '<div class="ai-section">';
            html += '<div class="ai-section-title">Opportunities</div>';
            html += '<ul class="ai-list ai-opps">';
            data.opportunities.forEach(function (o) { html += '<li>' + esc(o) + '</li>'; });
            html += '</ul></div>';
        }

        // Competitors
        if (data.competitors && data.competitors.length > 0) {
            html += '<div class="ai-section">';
            html += '<div class="ai-section-title">Competitors</div>';
            html += '<div class="ai-competitors">';
            data.competitors.forEach(function (c) {
                html += '<span class="ai-competitor">' + esc(c) + '</span>';
            });
            html += '</div></div>';
        }

        // Analysis details (if available)
        if (data.analysis) {
            var a = typeof data.analysis === 'string' ? JSON.parse(data.analysis) : data.analysis;
            if (a.sectorAnalysis) {
                html += '<div class="ai-section">';
                html += '<div class="ai-section-title">Sector Outlook</div>';
                html += '<p class="ai-text">' + esc(a.sectorAnalysis) + '</p>';
                html += '</div>';
            }
            if (a.technicalOutlook) {
                html += '<div class="ai-section">';
                html += '<div class="ai-section-title">Technical Outlook</div>';
                html += '<p class="ai-text">' + esc(a.technicalOutlook) + '</p>';
                html += '</div>';
            }
            if (a.catalysts && a.catalysts.length > 0) {
                html += '<div class="ai-section">';
                html += '<div class="ai-section-title">Catalysts</div>';
                html += '<ul class="ai-list">';
                a.catalysts.forEach(function (c) { html += '<li>' + esc(c) + '</li>'; });
                html += '</ul></div>';
            }
        }

        // Sources
        if (data.sources && data.sources.length > 0) {
            html += '<div class="ai-section">';
            html += '<div class="ai-section-title">Sources</div>';
            html += '<div class="ai-sources">';
            data.sources.forEach(function (s) {
                html += '<a href="' + esc(s) + '" target="_blank" rel="noopener" class="ai-source">' + esc(s.replace(/^https?:\/\//, '').substring(0, 40)) + '</a>';
            });
            html += '</div></div>';
        }

        // Meta
        html += '<div class="ai-meta">';
        if (data.modelVersion) html += '<span>Model: ' + esc(data.modelVersion) + '</span>';
        if (data.generatedAt) html += '<span>Generated: ' + new Date(data.generatedAt).toLocaleString() + '</span>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderScore(label, value, min, max, colorClass) {
        var pct = ((value - min) / (max - min)) * 100;
        var display = typeof value === 'number' ? value.toFixed(1) : '—';
        return '<div class="ai-score">'
            + '<div class="ai-score-label">' + label + '</div>'
            + '<div class="ai-score-value ' + colorClass + '">' + display + '</div>'
            + '<div class="ai-score-bar"><div class="ai-score-fill" style="width:' + Math.max(0, Math.min(100, pct)) + '%"></div></div>'
            + '</div>';
    }

    // ── Refresh ──

    var currentTab = 'overview';

    // Override loadTab to track current tab
    var _origLoadTab = loadTab;
    loadTab = function (tab) {
        currentTab = tab;
        _origLoadTab(tab);
    };

    function refresh() {
        // Snapshot current values
        var snapshot = {};
        container.querySelectorAll('[data-field]').forEach(function (el) {
            snapshot[el.dataset.field] = el.textContent;
        });

        // Also snapshot header
        var priceEl = document.getElementById('info-price');
        var changeEl = document.getElementById('info-change');
        var oldPrice = priceEl ? priceEl.textContent : '';
        var oldChange = changeEl ? changeEl.textContent : '';

        // Reload header
        loadHeader();

        // Reload current tab content
        loadTab(currentTab);

        // After a short delay for fetch to complete, check for changes and pulse
        setTimeout(function () {
            // Pulse header if changed
            if (priceEl && priceEl.textContent !== oldPrice) pulseEl(priceEl);
            if (changeEl && changeEl.textContent !== oldChange) pulseEl(changeEl);

            // Pulse changed stat values
            container.querySelectorAll('[data-field]').forEach(function (el) {
                var key = el.dataset.field;
                if (snapshot[key] !== undefined && snapshot[key] !== el.textContent) {
                    pulseEl(el);
                }
            });
        }, 800);
    }

    function pulseEl(el) {
        el.classList.add('info-pulse');
        setTimeout(function () { el.classList.remove('info-pulse'); }, 1500);
    }

    // Expose for vim
    window._infoRefresh = refresh;

    // ── Init ──

    loadHeader();
    initSparkline();
    loadTab('overview');
})();
