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
        'gross-margin':   'Calculated: grossProfit ÷ revenue × 100 — percentage retained after cost of goods sold',
        'net-margin':     'Calculated: netIncome ÷ revenue × 100 — percentage retained after all expenses',
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
        'sg-a':           'Selling, General & Administrative — operating costs not tied to production (sales, marketing, rent, management)',
        'operating-margin':'Calculated: operatingIncome ÷ revenue × 100 — profitability from core operations before interest and taxes',
        'interest-expense':'Cost of borrowing — interest paid on debt, bonds, credit facilities',
        'income-before-tax':'Profit before income tax is deducted — shows pre-tax earning power',
        'income-tax':     'Corporate income tax paid to government — reveals effective tax rate',
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

    function applyHelpState() {
        document.querySelectorAll('.help-tip').forEach(function (el) {
            el.classList.toggle('hidden', !helpVisible);
        });
        var indicator = document.getElementById('help-indicator');
        if (indicator) indicator.classList.toggle('hidden', !helpVisible);
    }

    function toggleHelp() {
        helpVisible = !helpVisible;
        applyHelpState();
    }

    // Re-apply help state whenever container content changes (new tab loaded)
    new MutationObserver(function () {
        if (helpVisible) applyHelpState();
    }).observe(container, { childList: true, subtree: true });

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

    // mdInline renders a tiny subset of markdown safely: **bold** → <strong>.
    // The LLM frequently emits "**Trend Direction:** …" as bullet preamble;
    // without rendering those asterisks land as literal text. We escape
    // first, then promote escaped `**…**` runs to <strong>.
    function mdInline(s) {
        return esc(s || '').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }

    // mdBlock splits multi-line LLM prose into paragraphs and runs mdInline
    // on each one. Use for fields the LLM emits as several `**Heading:**`
    // paragraphs separated by newlines (analyst reasoning, plan rationale).
    // Single-line input falls through as a single <p>.
    function mdBlock(s) {
        var parts = String(s || '').split(/\n+/).map(function (p) { return p.trim(); }).filter(Boolean);
        if (parts.length === 0) return '';
        return parts.map(function (p) { return '<p>' + mdInline(p) + '</p>'; }).join('');
    }

    // classifyKeyPoint scans a bullet's text for sentiment cues and returns
    // 'bearish' / 'bullish' / 'neutral'. Used to re-bucket analyst key
    // points at render time — the server-side pipeline categorises a whole
    // analyst's points by overall score, so a mixed report ends up dumping
    // bearish observations into the green Opportunities list. We score word
    // hits per side and let the dominant cue win.
    var BEARISH_RE = /\b(downtrend|bearish|weak(?:ness|ening|er)?|falling|fell|drop(?:ped|s|ping)?|decline|declining|declined|lower(?: high)?|breakdown|breaks? down|oversold|sell(?:ing)? pressure|headwind|capitulation|negative|deteriorat\w*|loss|losses|risk(?:s|y)?|below|short(?:ing)?|underperform\w*|miss(?:ed|es)?)\b/i;
    var BULLISH_RE = /\b(uptrend|bullish|strong(?:er|est)?|strength(?:ening)?|rising|rises|rose|rally|rallied|rallying|gain(?:s|ed|ing)?|advance|advancing|breakout|breaks? out|overbought|buying pressure|tailwind|positive|improv\w*|opportunity|opportunities|above|long|outperform\w*|beat|beats|beaten)\b/i;
    function classifyKeyPoint(text) {
        var t = String(text || '');
        var bear = (t.match(new RegExp(BEARISH_RE.source, 'gi')) || []).length;
        var bull = (t.match(new RegExp(BULLISH_RE.source, 'gi')) || []).length;
        if (bear > bull) return 'bearish';
        if (bull > bear) return 'bullish';
        return 'neutral';
    }

    // partitionKeyPoints takes the server's risks + opportunities arrays
    // and re-buckets per-point based on textual sentiment. Anything neutral
    // stays in whichever list the server placed it.
    function partitionKeyPoints(risks, opps) {
        risks = risks || [];
        opps = opps || [];
        var outRisks = [];
        var outOpps = [];
        var classifyInto = function (pt, origin) {
            var cls = classifyKeyPoint(pt);
            if (cls === 'bearish') outRisks.push(pt);
            else if (cls === 'bullish') outOpps.push(pt);
            else if (origin === 'risk') outRisks.push(pt);
            else outOpps.push(pt);
        };
        risks.forEach(function (p) { classifyInto(p, 'risk'); });
        opps.forEach(function (p) { classifyInto(p, 'opp'); });
        return { risks: outRisks, opportunities: outOpps };
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
        // Warm the SEC filings + people extraction cache so the Key People strip
        // populates on first visit. Fire-and-forget — the handler is idempotent.
        fetch('/api/security/' + symbol + '/sec-filings?limit=1').catch(function () {});

        Promise.all([
            fetch('/api/security/' + symbol + '/profile').then(function (r) { return r.json(); }),
            fetch('/api/security/' + symbol + '/metrics').then(function (r) { return r.json(); }),
            fetch('/api/security/' + symbol + '/key-people').then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
        ]).then(function (results) {
            var profile = results[0] && results[0][0] ? results[0][0] : {};
            var metricsData = results[1] || {};
            var metrics = metricsData.metrics && metricsData.metrics[0] ? metricsData.metrics[0] : {};
            var ratios = metricsData.ratios && metricsData.ratios[0] ? metricsData.ratios[0] : {};
            var people = (results[2] || []).filter(function (p) { return p.isCurrent; });

            var html = '<div class="info-overview">';

            // ── Top: dense Key Indicators block (8 wide × 2 rows) ──
            html += '<div class="info-grid info-grid-dense">';
            html += stat('Market Cap', fmt(profile.marketCap));
            html += stat('P/E (TTM)', ratios.priceToEarningsRatioTTM ? ratios.priceToEarningsRatioTTM.toFixed(2) : '—');
            html += stat('EPS (TTM)', profile.eps ? profile.eps.toFixed(2) : '—');
            html += stat('Dividend', profile.lastDividend ? '$' + profile.lastDividend.toFixed(2) : '—');
            html += stat('Beta', profile.beta ? profile.beta.toFixed(3) : '—');
            html += stat('52W Range', profile.range || '—');
            html += stat('Volume', fmt(profile.volume));
            html += stat('Avg Volume', fmt(profile.averageVolume));
            html += stat('EV/EBITDA', metrics.evToEBITDA ? metrics.evToEBITDA.toFixed(2) : '—');
            html += stat('EV/Sales', metrics.evToSales ? metrics.evToSales.toFixed(2) : '—');
            html += stat('Current Ratio', ratios.currentRatioTTM ? ratios.currentRatioTTM.toFixed(2) : '—');
            html += stat('Debt/Equity', ratios.debtToEquityRatioTTM ? ratios.debtToEquityRatioTTM.toFixed(2) : '—');
            html += stat('ROE', pct(ratios.returnOnEquityTTM));
            html += stat('Gross Margin', pct(ratios.grossProfitMarginTTM));
            html += stat('Net Margin', pct(ratios.netProfitMarginTTM));
            html += stat('P/B', ratios.priceToBookRatioTTM ? ratios.priceToBookRatioTTM.toFixed(2) : '—');
            html += '</div>';

            // ── Below: Key People (left) + Company description (right) ──
            html += '<div class="info-overview-top">';

            // Left: Key People — dedup across forms (form4 / 10-K / DEF 14A);
            // single row per person so longer titles aren't truncated.
            html += '<div class="info-overview-left">';
            if (people && people.length) {
                var seenKP = {};
                var dedup = people.filter(function (p) {
                    var key = (p.name || '').toLowerCase() + '|' + (p.title || '').toLowerCase();
                    if (seenKP[key]) return false;
                    seenKP[key] = true;
                    return true;
                });
                dedup.sort(function (a, b) {
                    var aOfficer = (a.eventType === 'director') ? 1 : 0;
                    var bOfficer = (b.eventType === 'director') ? 1 : 0;
                    if (aOfficer !== bOfficer) return aOfficer - bOfficer;
                    return (a.name || '').localeCompare(b.name || '');
                });
                var top = dedup.slice(0, 14);
                html += '<div class="info-people-header">Key People <span class="info-people-meta">' + dedup.length + ' on file · <a href="/security/' + esc(symbol) + '#sec" class="info-people-more">timeline →</a></span></div>';
                html += '<ul class="info-people-list">';
                top.forEach(function (p) {
                    var roleClass = 'kp-event-' + (p.eventType || 'other');
                    html += '<li class="info-people-row">';
                    html += '<span class="kp-event ' + roleClass + '">' + esc(p.eventType || 'officer') + '</span>';
                    html += '<span class="info-people-name">' + esc(p.name) + '</span>';
                    html += '<span class="info-people-title">' + esc(p.title || '') + '</span>';
                    html += '</li>';
                });
                if (dedup.length > top.length) {
                    html += '<li class="info-people-more-row"><a href="/security/' + esc(symbol) + '#sec">+ ' + (dedup.length - top.length) + ' more on the SEC tab</a></li>';
                }
                html += '</ul>';
            } else {
                html += '<div class="info-people-header">Key People</div>';
                html += '<p class="empty-state info-people-empty">No leadership data extracted yet.</p>';
            }
            html += '</div>';

            // Right: Company description + meta
            html += '<div class="info-overview-right">';
            html += '<div class="info-overview-meta">';
            if (profile.sector || profile.industry) {
                html += '<span class="info-overview-meta-item">' + esc(profile.sector || '') + (profile.industry ? ' / ' + esc(profile.industry) : '') + '</span>';
            }
            if (profile.ceo) html += '<span class="info-overview-meta-item">CEO: ' + esc(profile.ceo) + '</span>';
            if (profile.fullTimeEmployees) html += '<span class="info-overview-meta-item">' + esc(profile.fullTimeEmployees) + ' employees</span>';
            if (profile.exchange) html += '<span class="info-overview-meta-item">' + esc(profile.exchange) + '</span>';
            if (profile.website) html += '<span class="info-overview-meta-item"><a href="' + esc(profile.website) + '" target="_blank" rel="noopener">' + esc(profile.website) + '</a></span>';
            html += '</div>';
            if (profile.description) {
                html += '<p class="info-description">' + esc(profile.description) + '</p>';
            }
            html += '</div>';

            html += '</div>'; // close info-overview-top

            html += '</div>';
            container.innerHTML = html;

            // If we got nothing back the extraction is probably still running on
            // the server. Poll briefly so the strip fills in without a refresh.
            if (!people || !people.length) pollKeyPeople(symbol, currentTab);
        }).catch(function () {
            container.innerHTML = '<p class="empty-state">Failed to load overview</p>';
        });
    }

    var overviewPollTimer = null;
    function pollKeyPeople(forSymbol, forTab) {
        if (overviewPollTimer) clearInterval(overviewPollTimer);
        var attempts = 0;
        overviewPollTimer = setInterval(function () {
            attempts++;
            // Stop polling if the user has navigated away from this overview
            if (currentTab !== forTab || symbol !== forSymbol || attempts > 20) {
                clearInterval(overviewPollTimer); overviewPollTimer = null; return;
            }
            fetch('/api/security/' + forSymbol + '/key-people').then(function (r) { return r.ok ? r.json() : []; })
                .then(function (rows) {
                    var current = (rows || []).filter(function (p) { return p.isCurrent; });
                    if (current.length === 0) return;
                    // Got something — re-render the overview to show it.
                    clearInterval(overviewPollTimer); overviewPollTimer = null;
                    if (currentTab === forTab && symbol === forSymbol) loadOverview();
                });
        }, 3000);
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
                history.replaceState(history.state, '', location.pathname + '#financials-' + btn.dataset.ftype);
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

    // Financial table row vim navigation
    var finSelectedRow = -1;
    window._finGetRows = function () { return Array.from(document.querySelectorAll('.fin-row')); };
    window._finGetSelectedRow = function () { return finSelectedRow; };
    window._finSelectRow = function (idx) {
        var rows = window._finGetRows();
        if (rows.length === 0) return;
        idx = Math.max(0, Math.min(idx, rows.length - 1));
        finSelectedRow = idx;
        rows.forEach(function (r, i) { r.classList.toggle('vim-selected', i === idx); });
        rows[idx].scrollIntoView({ block: 'nearest' });
    };
    window._finClearRow = function () {
        var rows = window._finGetRows();
        rows.forEach(function (r) { r.classList.remove('vim-selected'); });
        finSelectedRow = -1;
    };

    // ── Financials Preview Chart Slide-in ──

    var finChart = null;

    function disposeFinChart() {
        if (finChart) {
            try { finChart.remove(); } catch (e) {}
            finChart = null;
        }
    }

    function buildFinSeries(rows, finKey, format) {
        var pts = [];
        rows.forEach(function (d) {
            var v;
            if (format === 'calc') {
                var parts = String(finKey).split('/');
                var num = d[parts[0]], den = d[parts[1]];
                if (num != null && den != null && den !== 0) {
                    v = (num / den) * 100;
                }
            } else {
                v = d[finKey];
            }
            if (v != null) {
                var year = String(d.fiscalYear || d.date || '').substring(0, 4);
                if (year) pts.push({ time: year + '-12-31', value: Number(v) });
            }
        });
        pts.sort(function (a, b) { return a.time < b.time ? -1 : 1; });
        return pts;
    }

    function fmtAxisValue(v) {
        var abs = Math.abs(v);
        if (abs >= 1e12) return (v / 1e12).toFixed(1) + 'T';
        if (abs >= 1e9)  return (v / 1e9).toFixed(1) + 'B';
        if (abs >= 1e6)  return (v / 1e6).toFixed(1) + 'M';
        if (abs >= 1e3)  return (v / 1e3).toFixed(1) + 'k';
        return Number(v).toFixed(2);
    }

    window._finOpenChart = function () {
        if (finSelectedRow < 0) return;
        var rows = window._finGetRows();
        if (finSelectedRow >= rows.length) return;
        var row = rows[finSelectedRow];

        var label  = row.dataset.finLabel || 'Metric';
        var finKey = row.dataset.finKey || '';
        var format = row.dataset.finFormat || '';
        var type   = window._finCurrentType || 'income';
        var data   = (window._finData && window._finData[type]) || [];

        var series = buildFinSeries(data, finKey, format);

        var reader = document.getElementById('article-reader');
        var readerTitle = document.getElementById('reader-title');
        var readerBody = document.getElementById('reader-body');
        if (!reader || !readerBody) return;
        reader.classList.remove('hidden');
        reader.dataset.mode = 'fin-chart';
        if (readerTitle) readerTitle.textContent = label + ' — 5y';

        if (series.length === 0) {
            readerBody.innerHTML = '<p class="empty-state">No data points for this metric.</p>';
            return;
        }

        readerBody.innerHTML = '<div id="fin-chart-host" style="width:100%;height:280px"></div>'
            + '<div class="fin-chart-points" id="fin-chart-points"></div>';

        // Render values list below the chart, colored to match the chart segments
        var isPct = format === 'calc';
        var pointsEl = document.getElementById('fin-chart-points');
        pointsEl.innerHTML = series.map(function (p, i) {
            var year = p.time.substring(0, 4);
            var val = isPct ? p.value.toFixed(1) + '%' : fmtAxisValue(p.value);
            var dirClass = '';
            if (i > 0) {
                var prev = series[i - 1].value;
                if (p.value > prev) dirClass = ' price-up';
                else if (p.value < prev) dirClass = ' price-down';
            }
            return '<div class="fin-chart-point"><span class="fin-chart-year">' + year + '</span><span class="fin-chart-val' + dirClass + '">' + val + '</span></div>';
        }).join('');

        // Build the line chart — one LineSeries per year-over-year segment so
        // each segment is colored green (up) or red (down) vs the previous year.
        disposeFinChart();
        var host = document.getElementById('fin-chart-host');
        if (!window.LightweightCharts || !host) return;

        finChart = LightweightCharts.createChart(host, {
            layout: { background: { color: '#0a0a0a' }, textColor: '#888888', fontFamily: "'SF Mono','Consolas',monospace", fontSize: 10, attributionLogo: false },
            grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
            rightPriceScale: { borderColor: '#2a2a2a' },
            timeScale: { borderColor: '#2a2a2a', timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
            handleScale: false,
            handleScroll: false,
        });
        var priceFormat = isPct
            ? { type: 'custom', formatter: function (v) { return v.toFixed(1) + '%'; }, minMove: 0.1 }
            : { type: 'custom', formatter: fmtAxisValue, minMove: 0.01 };

        var GREEN = '#00cc66', RED = '#ff4444', NEUTRAL = '#888888';
        if (series.length === 1) {
            // Just one data point — single series, neutral colour, marker at the point.
            var solo = finChart.addSeries(LightweightCharts.LineSeries, {
                color: NEUTRAL, lineWidth: 2, priceFormat: priceFormat,
                pointMarkersVisible: true,
            });
            solo.setData(series);
        } else {
            for (var i = 1; i < series.length; i++) {
                var prev = series[i - 1].value;
                var curr = series[i].value;
                var color = curr > prev ? GREEN : (curr < prev ? RED : NEUTRAL);
                var seg = finChart.addSeries(LightweightCharts.LineSeries, {
                    color: color, lineWidth: 2, priceFormat: priceFormat,
                });
                seg.setData([series[i - 1], series[i]]);
            }
        }
        finChart.timeScale().fitContent();
    };

    window._finCloseChart = function () {
        var reader = document.getElementById('article-reader');
        if (!reader) return;
        if (reader.dataset.mode !== 'fin-chart') return false;
        disposeFinChart();
        reader.classList.add('hidden');
        delete reader.dataset.mode;
        return true;
    };

    window._finIsChartOpen = function () {
        var reader = document.getElementById('article-reader');
        return !!(reader && !reader.classList.contains('hidden') && reader.dataset.mode === 'fin-chart');
    };

    var FIN_EXPLAINERS = {
        income: 'The income statement shows how much money the company earned (revenue), what it cost to earn it (expenses), and what was left over (profit). Read top to bottom: revenue minus costs gives gross profit, minus operating expenses gives operating income, minus interest and taxes gives net income. Margins show these as percentages of revenue — higher is better, and the trend matters more than the absolute number.',
        balance: 'The balance sheet is a snapshot of what the company owns (assets), what it owes (liabilities), and what belongs to shareholders (equity) at a single point in time. Assets = Liabilities + Equity, always. Key things to watch: cash vs debt levels, whether goodwill is a large portion of assets (acquisition risk), and whether equity is growing or shrinking over time.',
        cashflow: 'The cash flow statement tracks actual cash moving in and out of the business, split into three activities. Operating: cash from the core business (the most important). Investing: cash spent on assets, acquisitions, or received from sales. Financing: cash from borrowing/repaying debt, issuing stock, or paying dividends. Free cash flow (operating minus CapEx) is what the company can actually return to shareholders.',
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
                // Cache for the chart slide-in (key by type so switching sub-tabs gets the right rows)
                window._finData = window._finData || {};
                window._finData[type] = data;
                window._finCurrentType = type;

                var html = '';
                if (FIN_EXPLAINERS[type]) {
                    var hiddenClass = helpVisible ? '' : ' hidden';
                    html += '<p class="fin-explainer help-tip' + hiddenClass + '">' + FIN_EXPLAINERS[type] + '</p>';
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

                html += '<table class="fin-table"><thead><tr><th></th>';
                data.forEach(function (d) {
                    html += '<th>' + (d.fiscalYear || d.date || '').substring(0, 4) + '</th>';
                });
                html += '</tr></thead><tbody>';

                rows.forEach(function (row, rowIdx) {
                    var field = row[0].toLowerCase().replace(/[^a-z0-9]/g, '-');
                    var tip = HELP[field] ? '<span class="help-tip hidden">' + esc(HELP[field]) + '</span>' : '';
                    var format = row[2] || '';
                    var finKey = format === 'calc' ? row[3] + '/' + row[4] : (row[1] || '');
                    html += '<tr class="fin-row" data-fin-idx="' + rowIdx + '" data-fin-key="' + esc(finKey) + '" data-fin-label="' + esc(row[0]) + '" data-fin-format="' + format + '">';
                    html += '<td class="fin-label">' + row[0] + tip + '</td>';
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
                finSelectedRow = -1;
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

    // ── News tab — sub-tabs mirror the /news page, scoped to this security ──

    var NEWS_CATS = [
        { key: 'press-releases', label: 'Press Releases' },
        { key: 'articles',       label: 'Articles' },
        { key: 'stock',          label: 'Stock' },
        { key: 'crypto',         label: 'Crypto' },
        { key: 'forex',          label: 'Forex' },
        { key: 'general',        label: 'General' },
    ];
    var newsCurrent = 'press-releases'; // remembered across re-entries

    function loadNews() {
        var subHtml = '<div class="info-sub-tabs" id="news-sub-tabs">';
        NEWS_CATS.forEach(function (c) {
            var active = c.key === newsCurrent ? ' active' : '';
            subHtml += '<button class="info-sub-tab' + active + '" data-cat="' + c.key + '">'
                + c.label + '</button>';
        });
        subHtml += '</div><div id="news-cards-host" class="news-cards-host"></div>';
        container.innerHTML = subHtml;

        container.querySelectorAll('#news-sub-tabs .info-sub-tab').forEach(function (btn) {
            btn.onclick = function () {
                container.querySelectorAll('#news-sub-tabs .info-sub-tab').forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                newsCurrent = btn.dataset.cat;
                loadNewsCategory(newsCurrent);
            };
        });

        loadNewsCategory(newsCurrent);
    }

    // Expose for the vim sub-tab navigation in terminal.js
    window._infoNewsSubTabs = function () {
        return Array.from(document.querySelectorAll('#news-sub-tabs .info-sub-tab'));
    };
    window._infoNewsJumpToSub = function (n) {
        var tabs = window._infoNewsSubTabs();
        if (n >= 0 && n < tabs.length) tabs[n].click();
    };

    function loadNewsCategory(category) {
        var host = document.getElementById('news-cards-host');
        if (!host) return;
        host.innerHTML = '<p class="empty-state">Loading...</p>';

        var url = '/api/news/' + category + '?symbol=' + encodeURIComponent(symbol) + '&limit=20';
        fetch(url)
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (items) {
                if (!Array.isArray(items) || items.length === 0) {
                    host.innerHTML = '<p class="empty-state">No ' + esc(category) + ' news for ' + esc(symbol) + '</p>';
                    return;
                }
                host.innerHTML = '<div class="news-cards" id="info-news-cards">' +
                    items.map(function (item) {
                        var date = item.date ? new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
                        var text = item.text || '';
                        var div = document.createElement('div');
                        div.innerHTML = text;
                        var plain = div.textContent || div.innerText || '';
                        if (plain.length > 220) plain = plain.substring(0, 220) + '…';
                        return '<div class="news-card news-unread">'
                            + '<div class="news-card-title"><a href="' + esc(item.url) + '" onclick="event.preventDefault();if(window._openReader)window._openReader(this.href,this.textContent)">' + esc(item.title) + '</a></div>'
                            + '<div class="news-card-meta"><span>' + esc(item.source || '') + '</span><span>' + date + '</span></div>'
                            + '<div class="news-card-text">' + esc(plain) + '</div>'
                            + '</div>';
                    }).join('') + '</div>';
            })
            .catch(function () { host.innerHTML = '<p class="empty-state">Failed to load news</p>'; });
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
                            layout: { background: { color: 'transparent' }, textColor: 'transparent', attributionLogo: false },
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
            layout: { background: { color: '#0a0a0a' }, textColor: '#888', fontFamily: "'SF Mono',monospace", fontSize: 10, attributionLogo: false },
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
    var secView = 'filings'; // 'filings' | 'people'

    function loadSEC() {
        // Preserve vim sub-tab focus highlight across re-renders
        var prevSubTabs = document.getElementById('sec-filters');
        var hadFocus = !!(prevSubTabs && prevSubTabs.classList.contains('tab-row-focused'));

        container.innerHTML = '<p class="empty-state">Loading SEC filings...</p>';

        // Fetch form types (once), filings, and key people in parallel
        var formTypesP = secFormTypes
            ? Promise.resolve(secFormTypes)
            : fetch('/api/sec-form-types').then(function (r) { return r.json(); }).then(function (types) { secFormTypes = types; return types; });

        Promise.all([
            formTypesP,
            fetch('/api/security/' + symbol + '/sec-filings').then(function (r) { return r.json(); }),
            fetch('/api/security/' + symbol + '/key-people').then(function (r) { return r.json(); }).catch(function () { return []; }),
        ]).then(function (results) {
            var types = results[0] || [];
            var filings = results[1] || [];
            var people = results[2] || [];

            // Build type lookup
            var typeMap = {};
            types.forEach(function (t) { typeMap[t.formType] = t; });

            // Category filters (only meaningful in filings view)
            var categories = [
                { key: '', label: 'All' },
                { key: 'periodic', label: 'Periodic' },
                { key: 'event', label: 'Events' },
                { key: 'ownership', label: 'Ownership' },
                { key: 'proxy', label: 'Proxy' },
                { key: 'registration', label: 'Registration' },
            ];

            var html = '<div class="sec-view">';

            // Sub-tab row: category filters + Key People view switcher
            html += '<div class="info-sub-tabs" id="sec-filters">';
            categories.forEach(function (cat) {
                var active = (secView === 'filings' && secFilter === cat.key) ? ' active' : '';
                html += '<button class="info-sub-tab' + active + '" data-cat="' + cat.key + '" data-view="filings">' + cat.label + '</button>';
            });
            // Visual separator + Key People view switcher
            html += '<span class="sec-tab-sep" aria-hidden="true">|</span>';
            var peopleActive = secView === 'people' ? ' active' : '';
            html += '<button class="info-sub-tab' + peopleActive + '" data-view="people">Key People</button>';
            html += '</div>';

            if (secView === 'filings') {
                // Filing count
                var filteredFilings = secFilter ? filings.filter(function (f) {
                    var t = typeMap[f.formType];
                    return t && t.category === secFilter;
                }) : filings;

                html += '<div class="sec-count">' + filteredFilings.length + ' filings</div>';

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
            } else {
                // Key People timeline (wrapped so polling can replace just this slice)
                html += '<div id="kp-content">' + renderKeyPeopleTimeline(people) + '</div>';
            }

            html += '</div>';
            container.innerHTML = html;

            // Restore vim sub-tab focus highlight across re-renders
            if (hadFocus) {
                var newSubTabs = document.getElementById('sec-filters');
                if (newSubTabs) newSubTabs.classList.add('tab-row-focused');
            }

            // Wire sub-tab buttons
            container.querySelectorAll('#sec-filters .info-sub-tab').forEach(function (btn) {
                btn.onclick = function () {
                    if (btn.dataset.view === 'people') {
                        secView = 'people';
                    } else {
                        secView = 'filings';
                        secFilter = btn.dataset.cat;
                    }
                    secSelectedRow = -1;
                    loadSEC();
                };
            });

            // Background extraction can take 30s+ per filing. Poll while on the people view
            // so freshly-extracted rows appear without a manual refresh.
            stopKeyPeoplePolling();
            if (secView === 'people') {
                startKeyPeoplePolling(people.length);
            }
        }).catch(function () {
            container.innerHTML = '<p class="empty-state">Failed to load SEC filings</p>';
        });
    }

    var kpPollInterval = null;
    var kpLastCount = 0;
    var kpStableTicks = 0;

    function stopKeyPeoplePolling() {
        if (kpPollInterval) {
            clearInterval(kpPollInterval);
            kpPollInterval = null;
        }
        kpStableTicks = 0;
    }

    function startKeyPeoplePolling(initialCount) {
        kpLastCount = initialCount;
        kpStableTicks = 0;
        var maxTicks = 75; // ~5 min at 4s intervals
        var ticks = 0;
        kpPollInterval = setInterval(function () {
            ticks++;
            // Bail out if we're no longer on the SEC tab / people view
            if (currentTab !== 'sec' || secView !== 'people') { stopKeyPeoplePolling(); return; }
            if (ticks > maxTicks) { stopKeyPeoplePolling(); return; }

            fetch('/api/security/' + symbol + '/key-people')
                .then(function (r) { return r.ok ? r.json() : []; })
                .then(function (people) {
                    if (currentTab !== 'sec' || secView !== 'people') { stopKeyPeoplePolling(); return; }
                    var n = (people || []).length;
                    var kpEl = document.getElementById('kp-content');
                    if (kpEl && n !== kpLastCount) {
                        kpEl.innerHTML = renderKeyPeopleTimeline(people);
                        kpLastCount = n;
                        kpStableTicks = 0;
                    } else {
                        kpStableTicks++;
                    }
                    // Stop after 6 polls (~24s) with no change — extraction has settled
                    if (kpStableTicks >= 6 && kpLastCount > 0) {
                        stopKeyPeoplePolling();
                    }
                })
                .catch(function () { /* keep polling */ });
        }, 4000);
    }

    // Reject extraction garbage: XBRL element names, legal entities, category labels.
    // Mirror of looksLikeRealPerson in people.go so old rows in the DB don't render.
    function isRealPerson(name) {
        if (!name) return false;
        name = String(name).trim();
        if (name.length < 3 || name.length > 60) return false;
        if (name.indexOf(' ') < 0) return false;
        var lower = name.toLowerCase();
        var entitySuffixes = [' inc', ' inc.', ' llc', ' l.l.c.', ' corp', ' corp.', ' co.', ' company', ' trust', ' bank', ' n.a.', ' n.a', ' l.p.', ' lp', ' plc', ' ltd', ' ltd.'];
        for (var i = 0; i < entitySuffixes.length; i++) {
            if (lower.endsWith(entitySuffixes[i])) return false;
        }
        var blocked = ['board of directors', 'compensation committee', 'audit committee', 'named executive', 'principal executive', 'non-employee director', 'initial purchaser', 'registered holder', 'beneficial owner'];
        if (blocked.indexOf(lower) >= 0) return false;
        var words = name.split(/\s+/);
        for (var j = 0; j < words.length; j++) {
            var w = words[j].replace(/^[(),.;:'"]+|[(),.;:'"]+$/g, '');
            if (w.length > 22) return false;
        }
        return true;
    }

    function renderKeyPeopleTimeline(people) {
        if (!people || people.length === 0) {
            return '<p class="empty-state">No leadership data extracted yet. Key people are pulled from 10-K (Item 10), DEF 14A proxy statements, and 8-K (Item 5.02 changes).</p>';
        }

        people = people.filter(function (p) { return isRealPerson(p.name); });

        var current = people.filter(function (p) { return p.isCurrent; });
        var events = people.filter(function (p) { return !p.isCurrent; });

        // Dedup current by name+title (DEF 14A and 10-K may both list the same exec)
        var seen = {};
        current = current.filter(function (p) {
            var key = (p.name || '').toLowerCase() + '|' + (p.title || '').toLowerCase();
            if (seen[key]) return false;
            seen[key] = true;
            return true;
        });

        // Newest first for events
        events.sort(function (a, b) { return (b.eventDate || '').localeCompare(a.eventDate || ''); });

        var html = '';
        var rowIdx = 0;

        if (current.length > 0) {
            // Sort: officers first then directors, alphabetical within
            current.sort(function (a, b) {
                var aRole = a.eventType === 'director' ? 1 : 0;
                var bRole = b.eventType === 'director' ? 1 : 0;
                if (aRole !== bRole) return aRole - bRole;
                return (a.name || '').localeCompare(b.name || '');
            });

            html += '<div class="kp-section-header">Current Leadership <span class="kp-section-meta">' + current.length + ' people</span></div>';
            html += '<table class="fin-table kp-current-table"><thead><tr>';
            html += '<th>Name</th><th>Title</th><th>Role</th><th>As of</th><th>Source</th>';
            html += '</tr></thead><tbody>';
            current.forEach(function (p) {
                var roleClass = 'kp-event-' + (p.eventType || 'other');
                var asOf = (p.asOfDate || '').substring(0, 10) || (p.eventDate || '').substring(0, 10) || '—';
                var form = p.formType ? '<span class="kp-form-badge">' + esc(p.formType) + '</span>' : '';
                html += '<tr class="kp-row" data-idx="' + (rowIdx++) + '" data-link="' + esc(p.source || '') + '">';
                html += '<td class="kp-name">' + esc(p.name || '—') + '</td>';
                html += '<td class="kp-title">' + esc(p.title || '') + '</td>';
                html += '<td><span class="kp-event ' + roleClass + '">' + esc(p.eventType || 'officer') + '</span></td>';
                html += '<td class="kp-date">' + esc(asOf) + ' ' + form + '</td>';
                html += '<td>';
                if (p.source) {
                    html += '<a class="kp-link" href="' + esc(p.source) + '" target="_blank" rel="noopener">&#8599;</a>';
                }
                html += '</td></tr>';
            });
            html += '</tbody></table>';
        }

        if (events.length > 0) {
            html += '<div class="kp-section-header">Recent Changes <span class="kp-section-meta">' + events.length + ' event' + (events.length === 1 ? '' : 's') + '</span></div>';
            html += '<ul class="kp-timeline">';
            events.forEach(function (p) {
                var date = (p.eventDate || '').substring(0, 10) || '—';
                var evt = (p.eventType || '').toLowerCase();
                var evtClass = 'kp-event-' + (evt || 'other');
                html += '<li class="kp-row" data-idx="' + (rowIdx++) + '" data-link="' + esc(p.source || '') + '">';
                html += '<span class="kp-date">' + esc(date) + '</span>';
                html += '<span class="kp-event ' + evtClass + '">' + esc(p.eventType || 'change') + '</span>';
                html += '<span class="kp-name">' + esc(p.name || '—') + '</span>';
                html += '<span class="kp-title">' + esc(p.title || '') + '</span>';
                if (p.source) {
                    html += '<a class="kp-link" href="' + esc(p.source) + '" target="_blank" rel="noopener">&#8599;</a>';
                }
                html += '</li>';
            });
            html += '</ul>';
        }

        if (current.length === 0 && events.length === 0) {
            html = '<p class="empty-state">No leadership data extracted yet.</p>';
        }
        return html;
    }

    // Expose for vim — sec-row in filings view, kp-row in key-people view
    window._secGetRows = function () { return Array.from(document.querySelectorAll('.sec-row, .kp-row')); };
    window._secGetSelectedRow = function () { return secSelectedRow; };
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
        secView = 'filings';
        secSelectedRow = -1;
        loadSEC();
    };

    // ── AI Analysis ──

    function loadAI() {
        container.innerHTML = '<p class="empty-state">Loading AI analysis...</p>';
        // Reset vim selection so the first j-into-content always lands on the
        // Run Deep Analysis button, regardless of where the user left off on
        // a previous visit to this tab. Without this, leaving the tab with an
        // analyst card selected and coming back makes the next j skip past
        // the button. Closes #68.
        tradingPanelIdx = -1;

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
            html += '<div class="trading-header trading-vim-item" data-trading-vim="btn" tabindex="0">';
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
                            return '<div class="' + cls + '">' + icon + ' ' + esc(s.name) + '</div>';
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
                    html += '<div class="' + cls + '">' + icon + ' ' + esc(s.name) + '</div>';
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

                html += '<div class="trading-analyst-card trading-vim-item" data-analyst-idx="' + idx + '">';
                html += '<div class="trading-analyst-header" tabindex="0">';
                html += '<span class="trading-analyst-name">' + esc(report.analyst) + '</span>';
                html += '<span class="trading-analyst-outlook ' + outlookClass + '">' + esc(report.outlook || 'neutral') + '</span>';
                html += '<div class="trading-score-bar"><div class="trading-score-fill" style="width:' + scoreBar + '%"></div></div>';
                html += '</div>';

                html += '<div class="trading-analyst-body">';
                if (report.summary) {
                    html += '<p class="ai-text">' + mdInline(report.summary) + '</p>';
                }
                if (report.reasoning) {
                    html += '<div class="trading-reasoning">' + mdBlock(report.reasoning) + '</div>';
                }
                if (report.keyPoints && report.keyPoints.length > 0) {
                    html += '<ul class="ai-list">';
                    report.keyPoints.forEach(function (p) { html += '<li>' + mdInline(p) + '</li>'; });
                    html += '</ul>';
                }
                if (report.sources && report.sources.length > 0) {
                    html += '<div class="trading-sources">';
                    report.sources.forEach(function (s) { html += '<span class="trading-source">' + esc(s) + '</span>'; });
                    html += '</div>';
                }
                html += '</div></div>';
            });
            html += '</div>';
        }

        // Investment plan (from research debate)
        if (result.investmentPlan && result.investmentPlan.rating) {
            var plan = result.investmentPlan;
            var ratingClass = 'rating-' + plan.rating.toLowerCase();
            html += '<div class="trading-analyst-card trading-plan-card trading-vim-item" data-analyst-idx="plan">';
            html += '<div class="trading-analyst-header" tabindex="0">';
            html += '<span class="trading-analyst-name">Research Verdict</span>';
            html += '<span class="trading-rating ' + ratingClass + '">' + esc(plan.rating) + '</span>';
            if (plan.debateRounds) html += '<span class="trading-plan-rounds">' + plan.debateRounds + ' rounds</span>';
            html += '</div>';
            html += '<div class="trading-analyst-body">';

            // Bull vs Bear side by side
            var hasBull = plan.bullArguments && plan.bullArguments.length > 0;
            var hasBear = plan.bearArguments && plan.bearArguments.length > 0;
            if (hasBull || hasBear) {
                html += '<div class="trading-arguments">';
                if (hasBull) {
                    html += '<div class="trading-arg-col">';
                    html += '<span class="trading-arg-label price-up">Bull Case</span>';
                    html += '<ul class="ai-list">';
                    plan.bullArguments.forEach(function (a) { html += '<li>' + mdInline(a) + '</li>'; });
                    html += '</ul></div>';
                }
                if (hasBear) {
                    html += '<div class="trading-arg-col">';
                    html += '<span class="trading-arg-label price-down">Bear Case</span>';
                    html += '<ul class="ai-list">';
                    plan.bearArguments.forEach(function (a) { html += '<li>' + mdInline(a) + '</li>'; });
                    html += '</ul></div>';
                }
                html += '</div>';
            }

            if (plan.keyActions && plan.keyActions.length > 0) {
                html += '<div class="trading-actions"><span class="trading-arg-label">Key Actions</span>';
                html += '<ul class="ai-list">';
                plan.keyActions.forEach(function (a) { html += '<li>' + mdInline(a) + '</li>'; });
                html += '</ul></div>';
            }

            // Rationale — collapsible, skip if it looks like raw JSON
            if (plan.rationale && plan.rationale.charAt(0) !== '{' && plan.rationale.charAt(0) !== '[') {
                html += '<details class="trading-rationale"><summary>Rationale</summary>';
                html += '<div class="ai-text">' + mdBlock(plan.rationale) + '</div>';
                html += '</details>';
            }

            html += '</div></div>'; // close trading-analyst-body + trading-analyst-card
        }

        // Footer — cost + timestamp
        if (finished) {
            html += '<div class="trading-meta">';
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
        return Array.from(document.querySelectorAll('.trading-vim-item'));
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
        // Button card: trigger the analyze button click
        if (panels[idx].dataset.tradingVim === 'btn') {
            var btn = document.getElementById('trading-analyze-btn');
            if (btn && !btn.disabled) btn.click();
            return;
        }
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

        // Key Risks / Opportunities — re-bucket per-point because the
        // server tags by overall analyst score, so a mixed technical
        // report dumps "downtrend"/"bearish" observations into the green
        // Opportunities list (see partitionKeyPoints).
        var buckets = partitionKeyPoints(data.keyRisks, data.opportunities);
        if (buckets.risks.length > 0) {
            html += '<div class="ai-section">';
            html += '<div class="ai-section-title">Key Risks</div>';
            html += '<ul class="ai-list ai-risks">';
            buckets.risks.forEach(function (r) { html += '<li>' + mdInline(r) + '</li>'; });
            html += '</ul></div>';
        }
        if (buckets.opportunities.length > 0) {
            html += '<div class="ai-section">';
            html += '<div class="ai-section-title">Opportunities</div>';
            html += '<ul class="ai-list ai-opps">';
            buckets.opportunities.forEach(function (o) { html += '<li>' + mdInline(o) + '</li>'; });
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
        history.replaceState(history.state, '', location.pathname + '#' + tab);
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
