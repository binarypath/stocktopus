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
        'gross-margin':   'Gross profit / revenue — percentage retained after cost of goods',
        'sg-a':           'Selling, General & Administrative — operating costs not tied to production (sales, marketing, rent, management)',
        'operating-margin':'Operating income / revenue — profitability from core operations before interest and taxes',
        'interest-expense':'Cost of borrowing — interest paid on debt, bonds, credit facilities',
        'income-before-tax':'Profit before income tax is deducted — shows pre-tax earning power',
        'income-tax':     'Corporate income tax paid to government — reveals effective tax rate',
        'net-margin':     'Net income / revenue — percentage retained after all expenses',
        'short-term-investments':'Securities or deposits maturing within one year — near-cash holdings',
        'net-receivables': 'Money owed by customers for goods/services delivered — adjusted for expected defaults',
        'inventory':      'Goods held for sale or in production — raw materials, work-in-progress, finished goods',
        'goodwill':       'Premium paid above fair value in acquisitions — reflects brand value, customer relationships, synergies',
        'intangible-assets':'Non-physical assets with value — patents, trademarks, copyrights, software, licenses',
        'short-term-debt':'Debt obligations due within one year — credit lines, commercial paper, current portion of long-term debt',
        'total-debt':     'All interest-bearing obligations — short-term + long-term debt combined',
        'd-a':            'Depreciation & Amortization — non-cash expense spreading cost of physical and intangible assets over useful life',
        'stock-based-comp':'Non-cash compensation — stock options, RSUs granted to employees, dilutes existing shareholders',
        'accounts-receivable':'Change in money owed by customers — increase means cash tied up, decrease means cash collected',
        'accounts-payable':'Change in money owed to suppliers — increase means delaying payments (preserving cash)',
        'debt-repayment': 'Principal payments on loans and bonds — cash used to reduce outstanding debt',
        'net-change-in-cash':'Total change in cash position — sum of operating + investing + financing cash flows',
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

    // ── Security Type Detection ──

    var securityType = 'stock'; // default

    function detectSecurityType(profile) {
        if (!profile) return 'stock';
        var ex = (profile.exchange || '').toUpperCase();
        if (ex === 'CRYPTO' || ex === 'CCC') return 'crypto';
        if (ex === 'FOREX') return 'forex';
        if ((profile.symbol || '').charAt(0) === '^') return 'index';
        if (profile.isEtf) return 'etf';
        return 'stock';
    }

    function applySecurityType(type) {
        securityType = type;
        var hideTabs = [];
        if (type === 'crypto' || type === 'forex' || type === 'index') {
            hideTabs = ['financials', 'estimates', 'sec'];
        }
        document.querySelectorAll('#info-tabs .info-tab').forEach(function (tab) {
            if (hideTabs.indexOf(tab.dataset.tab) >= 0) {
                tab.style.display = 'none';
            }
        });
    }

    // Detect type early from profile
    fetch('/api/security/' + symbol + '/profile')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data && data[0]) {
                applySecurityType(detectSecurityType(data[0]));
            }
        })
        .catch(function () {});

    // ── Company Panel (shared from terminal.js) ──

    function initCompanyPanel() {
        if (window._renderCompanyPanel) {
            window._renderCompanyPanel('company-panel', symbol);
        } else {
            // terminal.js may not have loaded yet (direct page load)
            setTimeout(initCompanyPanel, 100);
        }
    }

    // ── Tab Loaders ──

    function loadTab(tab) {
        container.innerHTML = '<p class="empty-state">Loading...</p>';
        try {
            switch (tab) {
                case 'overview': loadOverview(); break;
                case 'financials': loadFinancials('income'); break;
                case 'estimates': loadEstimates(); break;
                case 'news': loadNews(); break;
                case 'ai': loadAI(); break;
                case 'sector': loadSector(); break;
                case 'sec': loadSEC(); break;
            }
        } catch (e) {
            console.error('Tab load error:', tab, e);
            container.innerHTML = '<p class="empty-state">Failed to load ' + tab + '</p>';
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
                history.replaceState(null, '', location.pathname + '#financials-' + btn.dataset.ftype);
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
                        ['Gross Margin', '', 'calc', 'grossProfit', 'revenue'],
                        ['R&D Expenses', 'researchAndDevelopmentExpenses'],
                        ['SG&A', 'sellingGeneralAndAdministrativeExpenses'],
                        ['Operating Income', 'operatingIncome'],
                        ['Operating Margin', '', 'calc', 'operatingIncome', 'revenue'],
                        ['Interest Expense', 'interestExpense'],
                        ['Income Before Tax', 'incomeBeforeTax'],
                        ['Income Tax', 'incomeTaxExpense'],
                        ['EBITDA', 'ebitda'],
                        ['Net Income', 'netIncome'],
                        ['Net Margin', '', 'calc', 'netIncome', 'revenue'],
                        ['EPS', 'eps'],
                    ];
                } else if (type === 'balance') {
                    rows = [
                        ['Total Assets', 'totalAssets'],
                        ['Current Assets', 'totalCurrentAssets'],
                        ['Cash & Equivalents', 'cashAndCashEquivalents'],
                        ['Short-Term Investments', 'shortTermInvestments'],
                        ['Net Receivables', 'netReceivables'],
                        ['Inventory', 'inventory'],
                        ['Goodwill', 'goodwill'],
                        ['Intangible Assets', 'intangibleAssets'],
                        ['Total Liabilities', 'totalLiabilities'],
                        ['Current Liabilities', 'totalCurrentLiabilities'],
                        ['Short-Term Debt', 'shortTermDebt'],
                        ['Long-Term Debt', 'longTermDebt'],
                        ['Total Debt', 'totalDebt'],
                        ['Total Equity', 'totalStockholdersEquity'],
                        ['Retained Earnings', 'retainedEarnings'],
                    ];
                } else {
                    rows = [
                        ['Operating CF', 'operatingCashFlow'],
                        ['D&A', 'depreciationAndAmortization'],
                        ['Stock-Based Comp', 'stockBasedCompensation'],
                        ['Accounts Receivable', 'accountsReceivables'],
                        ['Accounts Payable', 'accountsPayables'],
                        ['Investing CF', 'netCashUsedForInvestingActivities'],
                        ['Financing CF', 'netCashUsedProvidedByFinancingActivities'],
                        ['Debt Repayment', 'debtRepayment'],
                        ['CapEx', 'capitalExpenditure'],
                        ['Free Cash Flow', 'freeCashFlow'],
                        ['Net Change in Cash', 'netChangeInCash'],
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
                    var format = row[2] || '';
                    html += '<tr><td class="fin-label">' + row[0] + tip + '</td>';
                    data.forEach(function (d) {
                        var val;
                        if (format === 'calc') {
                            // Calculated margin: row[3] is numerator field, row[4] is denominator field
                            var num = d[row[3]], den = d[row[4]];
                            val = (num != null && den != null && den !== 0) ? ((num / den) * 100).toFixed(1) + '%' : '—';
                        } else {
                            val = fmt(d[row[1]]);
                        }
                        html += '<td>' + val + '</td>';
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
                            + '<div class="news-card-title"><a href="' + esc(item.url) + '" onclick="event.preventDefault();if(window._openReader)window._openReader(this.href,this.textContent)">' + esc(item.title) + '</a></div>'
                            + '<div class="news-card-meta"><span>' + esc(item.source) + '</span><span>' + date + '</span></div>'
                            + '<div class="news-card-text">' + esc(text) + '</div>'
                            + '</div>';
                    }).join('') + '</div>';
            })
            .catch(function () {
                container.innerHTML = '<p class="empty-state">Failed to load news</p>';
            });
    }

    // ── Sector ──

    var subscribedSector = '';

    function unsubscribeSector() {
        if (subscribedSector && window._wsSend) {
            window._wsSend({ type: 'unsubscribe', topic: 'sector:' + subscribedSector });
            subscribedSector = '';
        }
    }

    var sectorPerfChart = null; // exposed for vim h/l

    function loadSector() {
        container.innerHTML = '<p class="empty-state">Loading sector data...</p>';

        Promise.all([
            fetch('/api/security/' + symbol + '/profile').then(function (r) { return r.json(); }),
            fetch('/api/security/' + symbol + '/peers').then(function (r) { return r.json(); }),
        ]).then(function (results) {
            var profile = results[0] && results[0][0] ? results[0][0] : {};
            var peers = results[1] || [];

            var sector = profile.sector || 'Unknown';
            var industry = profile.industry || '';

            if (sector !== 'Unknown' && window._wsSend) {
                unsubscribeSector();
                subscribedSector = sector;
                window._wsSend({ type: 'subscribe', topic: 'sector:' + sector });
            }

            var html = '<div class="sector-view">';

            // Sector header
            html += '<div class="sector-header">';
            html += '<span class="sector-name">' + esc(sector) + '</span>';
            if (industry) html += '<span class="sector-industry"> / ' + esc(industry) + '</span>';
            html += '<span class="sector-hint"> j/k nav · i info · g graph</span>';
            html += '</div>';

            // Peer comparison table with mini sparkline column
            if (peers.length > 0) {
                peers.sort(function (a, b) { return (b.mktCap || b.marketCap || 0) - (a.mktCap || a.marketCap || 0); });

                html += '<div class="sector-section-title">Peer Comparison</div>';
                html += '<table class="fin-table peer-table" id="peer-table"><thead><tr>';
                html += '<th>Security</th><th>Company</th><th>Price</th><th>Market Cap</th><th>1M</th>';
                html += '</tr></thead><tbody>';

                // Current company
                html += '<tr class="peer-row peer-current" data-symbol="' + esc(symbol) + '"><td><span class="sym-link">' + esc(symbol) + '</span></td>'
                    + '<td>' + esc(profile.companyName || '') + '</td>'
                    + '<td>' + (profile.price ? profile.price.toFixed(2) : '—') + '</td>'
                    + '<td>' + fmt(profile.marketCap) + '</td>'
                    + '<td><div class="peer-spark" data-spark-sym="' + esc(symbol) + '"></div></td></tr>';

                peers.forEach(function (p) {
                    var cap = p.mktCap || p.marketCap || 0;
                    html += '<tr class="peer-row" data-symbol="' + esc(p.symbol) + '"><td><span class="sym-link">' + esc(p.symbol) + '</span></td>'
                        + '<td>' + esc(p.companyName || '') + '</td>'
                        + '<td>' + (p.price ? p.price.toFixed(2) : '—') + '</td>'
                        + '<td>' + fmt(cap) + '</td>'
                        + '<td><div class="peer-spark" data-spark-sym="' + esc(p.symbol) + '"></div></td></tr>';
                });
                html += '</tbody></table>';
            }

            // Performance chart
            html += '<div class="sector-section-title">6M Performance Comparison</div>';
            html += '<div id="sector-perf-chart" class="sector-perf-chart"></div>';

            // Sector news
            html += '<div class="sector-section-title">Sector News</div>';
            html += '<div id="sector-news" class="sector-news"><p class="empty-state">Loading...</p></div>';

            html += '</div>';
            container.innerHTML = html;

            // Load mini sparklines
            loadPeerSparklines();

            // Load performance chart
            loadSectorPerfChart(symbol, peers.slice(0, 3));

            // Load sector news
            loadSectorNews(peers.slice(0, 5));

        }).catch(function (err) {
            console.error('Sector load error:', err);
            container.innerHTML = '<p class="empty-state">Failed to load sector data</p>';
        });
    }

    function loadPeerSparklines() {
        function tryRender() {
            if (!window.LightweightCharts) { setTimeout(tryRender, 200); return; }
            var from = new Date(); from.setMonth(from.getMonth() - 1);
            var fromStr = from.toISOString().slice(0, 10);
            var toStr = new Date().toISOString().slice(0, 10);

            document.querySelectorAll('.peer-spark').forEach(function (el) {
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
                            layout: { background: { color: 'transparent' }, textColor: 'transparent' },
                            grid: { vertLines: { visible: false }, horzLines: { visible: false } },
                            rightPriceScale: { visible: false }, timeScale: { visible: false },
                            handleScroll: false, handleScale: false,
                            crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
                        });
                        var series = chart.addSeries(LightweightCharts.AreaSeries, {
                            lineColor: color, topColor: color.replace(')', ',0.15)').replace('rgb', 'rgba'),
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

    function loadSectorPerfChart(mainSymbol, topPeers) {
        var chartEl = document.getElementById('sector-perf-chart');
        if (!chartEl || !window.LightweightCharts) {
            if (!window.LightweightCharts) setTimeout(function () { loadSectorPerfChart(mainSymbol, topPeers); }, 200);
            return;
        }

        var from = new Date(); from.setMonth(from.getMonth() - 6);
        var fromStr = from.toISOString().slice(0, 10);
        var toStr = new Date().toISOString().slice(0, 10);
        var allSymbols = [mainSymbol].concat(topPeers.map(function (p) { return p.symbol; }));
        var colors = ['#ffcc00', '#4499ff', '#ff6699', '#00cccc'];

        sectorPerfChart = LightweightCharts.createChart(chartEl, {
            width: chartEl.clientWidth, height: 200,
            layout: { background: { color: '#0a0a0a' }, textColor: '#888', fontFamily: "'SF Mono',monospace", fontSize: 10 },
            grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
            rightPriceScale: { borderColor: '#2a2a2a' },
            timeScale: { borderColor: '#2a2a2a', timeVisible: false },
            handleScroll: true, handleScale: true,
            crosshair: { vertLine: { color: '#555', style: 2 }, horzLine: { color: '#555', style: 2 } },
        });

        // Expose for vim
        window._sectorChart = sectorPerfChart;

        allSymbols.forEach(function (sym, i) {
            fetch('/api/chart/eod/' + sym + '?from=' + fromStr + '&to=' + toStr)
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (!data || data.length < 2) return;
                    var basePrice = data[0].close;
                    var series = sectorPerfChart.addSeries(LightweightCharts.LineSeries, {
                        color: colors[i % colors.length], lineWidth: i === 0 ? 2 : 1,
                        priceLineVisible: false, lastValueVisible: true, title: sym,
                    });
                    series.setData(data.map(function (d) {
                        return { time: d.date, value: ((d.close - basePrice) / basePrice) * 100 };
                    }));
                    if (i === 0) sectorPerfChart.timeScale().fitContent();
                }).catch(function () {});
        });

        window.addEventListener('resize', function () {
            if (sectorPerfChart) sectorPerfChart.resize(chartEl.clientWidth, 200);
        });
    }

    function loadSectorNews(peers) {
        var newsEl = document.getElementById('sector-news');
        if (!newsEl) return;

        var peerSymbols = peers.map(function (p) { return p.symbol; }).join(',');
        fetch('/api/news/stock?symbol=' + peerSymbols + '&limit=5')
            .then(function (r) { return r.json(); })
            .then(function (items) {
                if (!items || items.length === 0) {
                    newsEl.innerHTML = '<p class="empty-state">No sector news</p>';
                    return;
                }
                newsEl.innerHTML = items.map(function (n) {
                    var date = n.date ? new Date(n.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                    return '<div class="sector-news-item" data-url="' + esc(n.url || '') + '" data-title="' + esc(n.title || '') + '">'
                        + '<a href="' + esc(n.url) + '" onclick="event.preventDefault();if(window._openReader)window._openReader(this.href,this.textContent)">'
                        + esc(n.title) + '</a>'
                        + '<span class="sector-news-meta">' + esc(n.symbol || '') + ' · ' + esc(n.source || '') + ' · ' + date + '</span>'
                        + '</div>';
                }).join('');
            })
            .catch(function () { newsEl.innerHTML = '<p class="empty-state">Failed to load</p>'; });
    }

    // ── SEC Filings ──

    var secFormTypes = null; // cached form type reference data
    var secFilter = ''; // current form type filter
    var secSelectedRow = -1;

    function loadSEC() {
        container.innerHTML = '<p class="empty-state">Loading SEC filings...</p>';

        // Fetch form types (once) and filings in parallel
        var formTypesP = secFormTypes
            ? Promise.resolve(secFormTypes)
            : fetch('/api/sec-form-types').then(function (r) { return r.json(); }).then(function (types) { secFormTypes = types; return types; });

        Promise.all([
            formTypesP,
            fetch('/api/security/' + symbol + '/sec-filings').then(function (r) { return r.json(); }),
        ]).then(function (results) {
            var types = results[0] || [];
            var filings = results[1] || [];

            // Build type lookup
            var typeMap = {};
            types.forEach(function (t) { typeMap[t.formType] = t; });

            // Category filters
            var categories = [
                { key: '', label: 'All' },
                { key: 'periodic', label: 'Periodic' },
                { key: 'event', label: 'Events' },
                { key: 'ownership', label: 'Ownership' },
                { key: 'proxy', label: 'Proxy' },
                { key: 'registration', label: 'Registration' },
            ];

            var html = '<div class="sec-view">';

            // Filter badges
            html += '<div class="sec-filters" id="sec-filters">';
            categories.forEach(function (cat) {
                var active = secFilter === cat.key ? ' active' : '';
                html += '<button class="sec-filter-btn' + active + '" data-cat="' + cat.key + '">' + cat.label + '</button>';
            });
            html += '</div>';

            // Filing count
            var filteredFilings = secFilter ? filings.filter(function (f) {
                var t = typeMap[f.formType];
                return t && t.category === secFilter;
            }) : filings;

            html += '<div class="sec-count">' + filteredFilings.length + ' filings</div>';

            // Filings table
            if (filteredFilings.length > 0) {
                html += '<table class="fin-table sec-table" id="sec-table"><thead><tr>';
                html += '<th>Date</th><th>Form</th><th>Description</th><th>Link</th>';
                html += '</tr></thead><tbody>';
                filteredFilings.forEach(function (f, idx) {
                    var t = typeMap[f.formType] || {};
                    var catClass = 'sec-cat-' + (t.category || 'other');
                    var date = (f.filingDate || '').substring(0, 10);
                    html += '<tr class="sec-row" data-idx="' + idx + '" data-link="' + esc(f.link || f.finalLink || '') + '">';
                    html += '<td class="sec-date">' + date + '</td>';
                    html += '<td><span class="sec-badge ' + catClass + '">' + esc(f.formType) + '</span></td>';
                    html += '<td class="sec-desc">' + esc(t.title || f.formType) + '</td>';
                    html += '<td><a href="' + esc(f.link || f.finalLink || '') + '" target="_blank" rel="noopener" class="sec-link">&#8599;</a></td>';
                    html += '</tr>';
                });
                html += '</tbody></table>';
            } else {
                html += '<p class="empty-state">No filings found' + (secFilter ? ' for this category' : '') + '</p>';
            }

            html += '</div>';
            container.innerHTML = html;

            // Wire filter buttons
            container.querySelectorAll('.sec-filter-btn').forEach(function (btn) {
                btn.onclick = function () {
                    secFilter = btn.dataset.cat;
                    secSelectedRow = -1;
                    loadSEC();
                };
            });
        }).catch(function () {
            container.innerHTML = '<p class="empty-state">Failed to load SEC filings</p>';
        });
    }

    // Expose for vim
    window._secGetRows = function () { return Array.from(document.querySelectorAll('.sec-row')); };
    window._secSelectRow = function (idx) {
        var rows = window._secGetRows();
        if (rows.length === 0) return;
        idx = Math.max(0, Math.min(idx, rows.length - 1));
        secSelectedRow = idx;
        rows.forEach(function (r, i) { r.classList.toggle('vim-selected', i === idx); });
        rows[idx].scrollIntoView({ block: 'nearest' });
    };
    window._secActivate = function () {
        var rows = window._secGetRows();
        if (secSelectedRow >= 0 && secSelectedRow < rows.length) {
            var link = rows[secSelectedRow].dataset.link;
            if (link) window.open(link, '_blank');
        }
    };
    window._secCycleFilter = function () {
        var cats = ['', 'periodic', 'event', 'ownership', 'proxy', 'registration'];
        var idx = cats.indexOf(secFilter);
        secFilter = cats[(idx + 1) % cats.length];
        secSelectedRow = -1;
        loadSEC();
    };

    // ── AI Analysis ──

    function loadAI() {
        container.innerHTML = '<p class="empty-state">Loading AI analysis...</p>';

        // Fetch both existing intelligence and trading cost estimate in parallel
        Promise.all([
            fetch('/api/security/' + symbol + '/intelligence').then(function (r) { return r.json(); }),
            fetch('/api/trading/cost').then(function (r) { return r.json(); }).catch(function () { return { available: false }; }),
            fetch('/api/security/' + symbol + '/trading/result').then(function (r) { return r.json(); }).then(function (d) { return d && d.status !== 'none' ? d : null; }).catch(function () { return null; }),
        ]).then(function (results) {
            var data = results[0];
            var costInfo = results[1];
            var tradingResult = results[2];

            var html = '';

            // Deep Analysis heading with inline button + cost
            html += '<div class="trading-header">';
            html += '<span class="ai-section-title" style="margin:0">Deep Analysis — Multi-Agent Pipeline</span>';
            html += renderTradingButton(costInfo, tradingResult);
            html += '</div>';

            // Trading pipeline results (if available)
            if (tradingResult && tradingResult.analystReports && tradingResult.analystReports.length > 0) {
                html += renderTradingResult(tradingResult);
            }

            // Existing AI analysis
            if (data.status && !data.summary) {
                if (data.status === 'running' || data.status === 'pending') {
                    html += renderAIProgress(data);
                    container.innerHTML = html;
                    pollAIStatus();
                    return;
                }
                if (data.status === 'failed') {
                    html += '<p class="empty-state">AI analysis failed: ' + esc(data.error || 'unknown') + '</p>';
                    container.innerHTML = html;
                    return;
                }
            }
            if (!data.error || data.summary) {
                html += renderAIAnalysis(data);
            }

            container.innerHTML = html;
            wireCompetitorLinks();
            loadCompetitorScores();
            wireTradingButton();

            // Poll if trading analysis is running
            if (tradingResult && !isFinished(tradingResult)) {
                pollTradingStatus();
            }
        }).catch(function () {
            container.innerHTML = '<p class="empty-state">Failed to load AI analysis</p>';
        });
    }

    // ── Trading Pipeline UI ──

    function isFinished(result) {
        return result && result.finishedAt && !result.finishedAt.startsWith('0001');
    }

    function renderTradingButton(costInfo, tradingResult) {
        var isRunning = tradingResult && !isFinished(tradingResult) && tradingResult.startedAt;
        var costStr = costInfo && costInfo.available
            ? 'Est. $' + costInfo.estimatedCost.toFixed(3)
            : '';

        var html = '';
        if (isRunning) {
            html += '<button class="trading-btn trading-btn-running" disabled>'
                + '<span class="spinner" style="width:12px;height:12px;display:inline-block"></span> Running...</button>';
        } else {
            html += '<button class="trading-btn" id="trading-analyze-btn">'
                + '&#129302; Run Deep Analysis</button>';
        }
        if (costStr) html += '<span class="trading-cost">' + esc(costStr) + '</span>';

        // Show actual cost if we have a completed result
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
            btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;display:inline-block"></span> Starting...';
            fetch('/api/security/' + symbol + '/trading/analyze', { method: 'POST' })
                .then(function (r) { return r.json(); })
                .then(function (resp) {
                    if (resp.status === 'started' || resp.status === 'already_running') {
                        pollTradingStatus();
                    }
                })
                .catch(function () {
                    btn.disabled = false;
                    btn.textContent = '&#129302; Run Deep Analysis';
                });
        };
    }

    var tradingPollInterval = null;

    function stopTradingPolling() {
        if (tradingPollInterval) {
            clearInterval(tradingPollInterval);
            tradingPollInterval = null;
        }
    }

    function pollTradingStatus() {
        stopTradingPolling();
        tradingPollInterval = setInterval(function () {
            if (currentTab !== 'ai') { stopTradingPolling(); return; }
            fetch('/api/security/' + symbol + '/trading/result')
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (result) {
                    if (!result) return;
                    if (currentTab !== 'ai') { stopTradingPolling(); return; }

                    // Update progress stages
                    var stagesEl = document.getElementById('trading-stages');
                    if (stagesEl && result.stages) {
                        stagesEl.innerHTML = result.stages.map(function (s) {
                            var icon = s.status === 'complete' ? '&#10003;' :
                                       s.status === 'running' ? '&#9679;' :
                                       s.status === 'failed' ? '&#10007;' :
                                       s.status === 'skipped' ? '&#8212;' : '&#9675;';
                            var cls = 'trading-stage trading-stage-' + s.status;
                            var dur = s.duration ? ' (' + s.duration.toFixed(1) + 's)' : '';
                            return '<div class="' + cls + '">' + icon + ' ' + esc(s.name) + dur + '</div>';
                        }).join('');
                    }

                    // If complete, reload the full AI tab
                    if (isFinished(result)) {
                        stopTradingPolling();
                        loadAI();
                    }
                });
        }, 1500);
    }

    function renderTradingResult(result) {
        var finished = isFinished(result);
        var html = '<div class="trading-result">';

        // Pipeline stages — only show while running or if there are non-complete stages
        var hasIncomplete = result.stages && result.stages.some(function (s) {
            return s.status !== 'complete' && s.status !== 'skipped';
        });
        if (!finished || hasIncomplete) {
            html += '<div class="trading-stages" id="trading-stages">';
            if (result.stages) {
                result.stages.forEach(function (s) {
                    var icon = s.status === 'complete' ? '&#10003;' :
                               s.status === 'running' ? '&#9679;' :
                               s.status === 'failed' ? '&#10007;' :
                               s.status === 'skipped' ? '&#8212;' : '&#9675;';
                    var cls = 'trading-stage trading-stage-' + s.status;
                    var dur = s.duration ? ' (' + s.duration.toFixed(1) + 's)' : '';
                    html += '<div class="' + cls + '">' + icon + ' ' + esc(s.name) + dur + '</div>';
                });
            }
            html += '</div>';
        }

        // Analyst reports — 2-column grid
        if (result.analystReports && result.analystReports.length > 0) {
            html += '<div class="trading-analysts" id="trading-analysts">';
            result.analystReports.forEach(function (report, idx) {
                var outlookClass = report.outlook === 'bullish' ? 'price-up' :
                                   report.outlook === 'bearish' ? 'price-down' : '';
                var scoreBar = report.score ? Math.round((report.score + 1) / 2 * 100) : 50;

                html += '<div class="trading-analyst-card" data-analyst-idx="' + idx + '">';
                html += '<div class="trading-analyst-header" tabindex="0">';
                html += '<span class="trading-analyst-name">' + esc(report.analyst) + '</span>';
                html += '<span class="trading-analyst-outlook ' + outlookClass + '">' + esc(report.outlook || 'neutral') + '</span>';
                html += '<div class="trading-score-bar"><div class="trading-score-fill" style="width:' + scoreBar + '%"></div></div>';
                html += '</div>';

                html += '<div class="trading-analyst-body">';
                if (report.summary) {
                    html += '<p class="ai-text">' + esc(report.summary) + '</p>';
                }
                if (report.reasoning) {
                    html += '<div class="trading-reasoning">' + esc(report.reasoning) + '</div>';
                }
                if (report.keyPoints && report.keyPoints.length > 0) {
                    html += '<ul class="ai-list">';
                    report.keyPoints.forEach(function (p) { html += '<li>' + esc(p) + '</li>'; });
                    html += '</ul>';
                }
                if (report.sources && report.sources.length > 0) {
                    html += '<div class="trading-sources">';
                    report.sources.forEach(function (s) { html += '<span class="trading-source">' + esc(s) + '</span>'; });
                    if (report.duration) html += '<span class="trading-source">' + report.duration.toFixed(1) + 's</span>';
                    html += '</div>';
                }
                html += '</div></div>';
            });
            html += '</div>';
        }

        // Timing — compact footer
        if (finished) {
            var dur = (new Date(result.finishedAt) - new Date(result.startedAt)) / 1000;
            html += '<div class="trading-meta">';
            html += '<span>' + dur.toFixed(1) + 's</span>';
            html += '<span>$' + (result.totalCostUsd || 0).toFixed(4) + '</span>';
            html += '<span>' + new Date(result.finishedAt).toLocaleString() + '</span>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ── Trading Panel Vim Navigation ──

    var tradingPanelIdx = -1;

    function getTradingPanels() {
        return Array.from(document.querySelectorAll('.trading-analyst-card'));
    }

    function selectTradingPanel(idx) {
        var panels = getTradingPanels();
        if (panels.length === 0) return;
        idx = Math.max(0, Math.min(idx, panels.length - 1));
        tradingPanelIdx = idx;
        panels.forEach(function (p, i) {
            p.classList.toggle('trading-panel-selected', i === idx);
        });
        panels[idx].scrollIntoView({ block: 'nearest' });
    }

    function toggleTradingPanel(idx) {
        var panels = getTradingPanels();
        if (idx < 0 || idx >= panels.length) return;
        panels[idx].classList.toggle('trading-panel-open');
    }

    function deselectTradingPanels() {
        getTradingPanels().forEach(function (p) {
            p.classList.remove('trading-panel-selected');
        });
        tradingPanelIdx = -1;
    }

    window._tradingVimHandler = function (key) {
        var panels = getTradingPanels();
        if (panels.length === 0) return false;

        if (key === 'j') {
            if (tradingPanelIdx >= panels.length - 1) return false; // let parent handle
            selectTradingPanel(tradingPanelIdx + 1);
            return true;
        } else if (key === 'k') {
            if (tradingPanelIdx <= 0) {
                deselectTradingPanels();
                return false; // let parent move focus back to tabs
            }
            selectTradingPanel(tradingPanelIdx - 1);
            return true;
        } else if (key === 'Enter') {
            toggleTradingPanel(tradingPanelIdx);
            return true;
        }
        return false;
    };

    var aiPollInterval = null;

    function stopAIPolling() {
        if (aiPollInterval) {
            clearInterval(aiPollInterval);
            aiPollInterval = null;
        }
    }

    function pollAIStatus() {
        stopAIPolling();
        aiPollInterval = setInterval(function () {
            // Stop polling if we've left the AI tab
            if (currentTab !== 'ai') {
                stopAIPolling();
                return;
            }
            fetch('/api/security/' + symbol + '/intelligence/status')
                .then(function (r) { return r.json(); })
                .then(function (status) {
                    if (currentTab !== 'ai') { stopAIPolling(); return; }
                    if (status.status === 'complete') {
                        stopAIPolling();
                        fetch('/api/security/' + symbol + '/intelligence')
                            .then(function (r) { return r.json(); })
                            .then(function (data) {
                                if (currentTab !== 'ai') return;
                                container.innerHTML = renderAIAnalysis(data);
                                wireCompetitorLinks();
                                loadCompetitorScores();
                            });
                    } else if (status.status === 'failed') {
                        stopAIPolling();
                        if (currentTab === 'ai') {
                            container.innerHTML = '<p class="empty-state">AI analysis failed: ' + esc(status.error || 'unknown error') + '</p>';
                        }
                    } else {
                        if (currentTab === 'ai') {
                            container.innerHTML = renderAIProgress(status);
                        }
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

        // Competitors — loaded async with scores
        if (data.competitors && data.competitors.length > 0) {
            html += '<div class="ai-section">';
            html += '<div class="ai-section-title">Competitors</div>';
            html += '<div class="ai-competitors" id="ai-competitors">';
            data.competitors.forEach(function (c) {
                html += '<div class="ai-competitor-card" data-symbol="' + esc(c) + '" data-nav="security">'
                    + '<span class="ai-competitor-sym">' + esc(c) + '</span>'
                    + '<span class="ai-competitor-scores">loading...</span>'
                    + '</div>';
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

    function wireCompetitorLinks() {
        var cards = document.querySelectorAll('.ai-competitor-card[data-nav="security"]');
        cards.forEach(function (card) {
            card.addEventListener('click', function (e) {
                // Don't navigate if clicking the analyze button
                if (e.target.closest('.ai-analyze-btn')) return;
                var sym = card.dataset.symbol;
                if (sym && window._navigateToSecurity) {
                    window._navigateToSecurity(sym);
                }
            });
        });
    }

    window._triggerAnalysis = function (sym, btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner" style="width:10px;height:10px;display:inline-block"></span> analyzing...';
        fetch('/api/security/' + sym + '/intelligence')
            .then(function () {
                // Start polling for this competitor's completion
                setTimeout(loadCompetitorScores, 3000);
            });
    };

    function loadCompetitorScores() {
        var el = document.getElementById('ai-competitors');
        if (!el) return;

        fetch('/api/security/' + symbol + '/competitors')
            .then(function (r) { return r.json(); })
            .then(function (comps) {
                if (!comps || comps.length === 0) return;

                comps.forEach(function (c) {
                    var card = el.querySelector('[data-symbol="' + c.symbol + '"]');
                    if (!card) return;
                    var scoresEl = card.querySelector('.ai-competitor-scores');
                    if (!scoresEl) return;

                    if (c.status === 'ready') {
                        var sentClass = c.sentiment >= 0 ? 'price-up' : 'price-down';
                        var riskClass = c.riskScore > 60 ? 'price-down' : 'price-up';
                        scoresEl.innerHTML = '<span class="' + sentClass + '">S:' + c.sentiment.toFixed(1) + '</span>'
                            + ' <span class="' + riskClass + '">R:' + c.riskScore.toFixed(0) + '</span>';
                    } else if (c.status === 'pending') {
                        scoresEl.innerHTML = '<span class="spinner" style="width:10px;height:10px"></span> analyzing...';
                    } else {
                        scoresEl.innerHTML = '<button class="ai-analyze-btn" onclick="event.preventDefault();event.stopPropagation();window._triggerAnalysis(\'' + c.symbol + '\',this)">&#129302; analyze</button>';
                    }
                });

                // Poll again if any are still pending
                var hasPending = comps.some(function (c) { return c.status !== 'ready'; });
                if (hasPending) {
                    setTimeout(loadCompetitorScores, 5000);
                }
            });
    }

    // ── Refresh ──

    var currentTab = 'overview';

    // Override loadTab to track current tab and update URL hash
    var _origLoadTab = loadTab;
    loadTab = function (tab) {
        if (currentTab === 'sector' && tab !== 'sector') {
            unsubscribeSector();
        }
        if (currentTab === 'ai' && tab !== 'ai') {
            stopAIPolling();
            stopTradingPolling();
        }
        currentTab = tab;
        history.replaceState(null, '', location.pathname + '#' + tab);
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
        initCompanyPanel();

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

    initCompanyPanel();

    // Read initial tab from URL hash, default to overview
    var initTab = 'overview';
    var initSubTab = '';
    var hash = location.hash.replace('#', '');
    if (hash) {
        var parts = hash.split('-');
        var mainTab = parts[0];
        if (['overview', 'financials', 'estimates', 'news', 'ai', 'sector', 'sec'].indexOf(mainTab) >= 0) {
            initTab = mainTab;
            if (parts.length > 1) initSubTab = parts.slice(1).join('-');
        }
        var allTabs = document.querySelectorAll('#info-tabs .info-tab');
        allTabs.forEach(function (t) {
            t.classList.toggle('active', t.dataset.tab === initTab);
        });
    }
    if (initTab === 'financials' && initSubTab) {
        loadFinancials(initSubTab);
    } else {
        loadTab(initTab);
    }
})();
