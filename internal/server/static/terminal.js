// Stocktopus Terminal — command bar, view router, WebSocket manager, security selector

window.onerror = function (msg, src, line, col, err) {
    console.error('JS error:', msg, 'at', src + ':' + line + ':' + col);
    var el = document.getElementById('conn-status');
    if (el) { el.textContent = 'JS ERROR'; el.style.color = '#ff4444'; el.style.borderColor = '#ff4444'; el.title = msg + ' at line ' + line; }
};

(function () {
    'use strict';

    // ── State ──

    let ws = null;
    let debugWs = null;
    const subscribedSecurities = new Set();
    let currentView = document.getElementById('view-container').dataset.view || 'watchlist';
    let selectedSecurity = localStorage.getItem('stocktopus-security') || '';
    const commandHistory = [];
    let historyIndex = -1;
    var wsRetryDelay = 1000;
    let newsFilterSecurity = '';
    var newsCurrentTopic = '';
    var newsSeenURLs = new Set();
    var newsReadURLs = new Set();
    // Economic catalog — keyed by full identifier ("US.UNRATE") AND by bare
    // code ("UNRATE") for v1 ergonomics where typing `:add unrate` should
    // still resolve. Populated by loadFredCodes on boot.
    var econCatalog = {};
    function loadFredCodes() {
        fetch('/api/economics/catalog').then(function (r) { return r.json(); })
            .then(function (rows) {
                if (!Array.isArray(rows)) return;
                rows.forEach(function (r) {
                    var id = (r.identifier || (r.country + '.' + r.code)).toUpperCase();
                    econCatalog[id] = r;
                    // Bare-code alias — only one country in v1 so unambiguous.
                    if (r.code) econCatalog[r.code.toUpperCase()] = r;
                });
                window._econCatalog = econCatalog;
            })
            .catch(function () { /* economics page is optional */ });
    }
    function lookupEcon(s) {
        return econCatalog[String(s).toUpperCase()];
    }

    // ── Commands ──

    const COMMANDS = {
        watchlist:  { path: '/watchlist',       needsSecurity: false, usage: 'watchlist',           desc: 'real-time price table for tracked securities' },
        graph:      { path: '/graph/{symbol}',   needsSecurity: true,  usage: 'graph <SECURITY>',    desc: 'show price chart for any security' },
        info:       { path: '/security/{symbol}', needsSecurity: true, usage: 'info <SECURITY>',     desc: 'deep-dive company fundamentals for SECURITY' },
        crypto:     { path: '/crypto/{symbol}',  needsSecurity: true, usage: 'crypto <SECURITY>',   desc: 'crypto coin info page', hidden: true },
        forex:      { path: '/forex/{symbol}',   needsSecurity: true, usage: 'forex <PAIR>',         desc: 'forex pair info page', hidden: true },
        index:      { path: '/index/{symbol}',   needsSecurity: true, usage: 'index <SYMBOL>',       desc: 'index info page', hidden: true },
        etf:        { path: '/etf/{symbol}',     needsSecurity: true, usage: 'etf <SYMBOL>',         desc: 'ETF info page', hidden: true },
        fund:       { path: '/fund/{symbol}',    needsSecurity: true, usage: 'fund <SYMBOL>',        desc: 'mutual fund info page', hidden: true },
        news:       { path: '/news',            needsSecurity: false, usage: 'news [SECURITY]',     desc: 'market news — optionally filter by security', optionalSecurity: true },
        ei:         { path: '/indices',          needsSecurity: false, usage: 'ei',                  desc: 'equity indices — global market overview' },
        ideas:      { path: '/ideas',           needsSecurity: false, usage: 'ideas',               desc: 'sketchpad — comparative graphs across metrics' },
        economics:  { path: '/economics',       needsSecurity: false, usage: 'economics',           desc: 'economic calendar + indicator catalog (FRED + FMP)', aliases: ['eco', 'econ'] },
        screener:   { path: '/screener',        needsSecurity: false, usage: 'screener',            desc: 'filter and scan stocks by criteria' },
        paper:      { path: '/paper',           needsSecurity: false, usage: 'paper',               desc: 'paper trading — ticket, positions, journal', aliases: ['pa', 'trade'] },
        debug:      { path: '/debug',           needsSecurity: false, usage: 'debug',               desc: 'live server log console' },
        analyze:    { path: '/security/{symbol}#ai', needsSecurity: true, usage: 'analyze <SECURITY>',  desc: 'run deep multi-agent trading analysis', aliases: ['az'] },
    };

    // ── Security-type routing ──
    //
    // Maps an FMP exchange code (+ symbol shape) to the right view name in
    // COMMANDS. Mirrors detectSecurityType() in info.js so server- and
    // client-initiated navigation pick the same path. Returns 'info' as a
    // safe default — the server's handleSecurity will 301 if it knows
    // better, so an unresolved type never strands the user.
    function viewForSecurity(exchange, symbol) {
        var ex = String(exchange || '').toUpperCase();
        if (ex === 'CRYPTO' || ex === 'CCC') return 'crypto';
        if (ex === 'FOREX') return 'forex';
        if (String(symbol || '').charAt(0) === '^') return 'index';
        return 'info';
    }

    // Cache of {symbol → view} seeded by every search result so subsequent
    // `info <SYMBOL>` calls (from the command bar, watchlist clicks, ideas
    // page, AI competitor cards, etc.) route through the correct view
    // without re-hitting search. Falls back to 'info' on miss; the server
    // 301 handles legacy URLs.
    var symbolViewCache = {};
    function rememberSymbolView(symbol, exchange) {
        if (!symbol) return;
        symbolViewCache[symbol.toUpperCase()] = viewForSecurity(exchange, symbol);
    }
    function viewForKnownSymbol(symbol) {
        if (!symbol) return 'info';
        return symbolViewCache[symbol.toUpperCase()] || 'info';
    }

    function parseCommand(input) {
        const parts = input.trim().split(/\s+/);
        return { command: (parts[0] || '').toLowerCase(), args: parts.slice(1) };
    }

    // ── View Router ──

    async function navigate(command, security, opts) {
        opts = opts || {};
        const cmd = COMMANDS[command];
        if (!cmd) {
            flashError('Unknown command: ' + command);
            return;
        }

        let resolved = security || selectedSecurity;
        if (cmd.needsSecurity && !resolved) {
            flashError(command + ' requires a security (e.g. ' + command + ' AAPL)');
            return;
        }

        // Special handling: analyze → navigate to info#ai and trigger trading analysis
        if (command === 'analyze') {
            resolved = resolved.toUpperCase();
            setSecurity(resolved);
            // Navigate to info page with AI tab
            await navigate('info', resolved);
            // Click the AI tab
            var aiTab = document.querySelector('#info-tabs .info-tab[data-tab="ai"]');
            if (aiTab) aiTab.click();
            // Trigger the analysis after a short delay for the AI tab to render
            setTimeout(function () {
                fetch('/api/security/' + resolved + '/trading/analyze', { method: 'POST' });
            }, 500);
            return;
        }

        let path = cmd.path;
        if (cmd.needsSecurity) {
            resolved = resolved.toUpperCase();
            path = path.replace('{symbol}', resolved);
            // skipSecurity is set when the "symbol" isn't a real ticker —
            // e.g. an economic identifier like US.UNRATE that shouldn't end
            // up in the security selector or WS subscriptions.
            if (!opts.skipSecurity) setSecurity(resolved);
        }
        // Caller-supplied explicit path wins over the COMMANDS template. Used
        // by executeIdeasAdd to land on /ideas/{lastId} instead of the default.
        if (opts.path) {
            path = opts.path;
        }

        // When going back via popstate the browser has already restored the
        // exact URL (including any sub-resource id like /ideas/5 or hash like
        // #financials-income). Use that directly so we don't lose the id by
        // re-templating cmd.path.
        if (opts.fromHistory) {
            path = location.pathname + location.search + location.hash;
        }

        // Handle optional security (e.g. news MSFT)
        if (cmd.optionalSecurity && security) {
            newsFilterSecurity = security.toUpperCase();
        } else if (cmd.optionalSecurity) {
            newsFilterSecurity = '';
        }

        try {
            const resp = await fetch(path, { headers: { 'X-Fragment': 'true' } });
            if (!resp.ok) throw new Error(resp.statusText);
            const html = await resp.text();

            const container = document.getElementById('view-container');
            container.innerHTML = html;
            container.dataset.view = command;
            currentView = command;

            // Execute any <script> tags in the loaded fragment (in order).
            // Copy *all* attributes so things like data-sketch-id come through to
            // the script — otherwise document.currentScript.dataset is empty.
            var scripts = Array.from(container.querySelectorAll('script'));
            (function loadNext(i) {
                if (i >= scripts.length) return;
                var old = scripts[i];
                var s = document.createElement('script');
                for (var a = 0; a < old.attributes.length; a++) {
                    s.setAttribute(old.attributes[a].name, old.attributes[a].value);
                }
                if (old.src) {
                    s.onload = function () { loadNext(i + 1); };
                    s.onerror = function () { loadNext(i + 1); };
                } else {
                    s.textContent = old.textContent;
                }
                old.replaceWith(s);
                if (!old.src) loadNext(i + 1);
            })(0);

            document.getElementById('current-view').textContent = command;
            document.title = 'Stocktopus — ' + command.charAt(0).toUpperCase() + command.slice(1);

            // Skip pushState when called from popstate — the browser has already
            // updated the URL; pushing again would corrupt the back history.
            if (!opts.fromHistory) {
                history.pushState({ view: command, security: resolved }, '', path);
            }

            onViewEnter(command);
        } catch (err) {
            flashError('Failed to load view: ' + err.message);
        }
    }

    function flashError(msg) {
        const cmdInput = document.getElementById('cmd-input');
        cmdInput.value = msg;
        cmdInput.style.color = 'var(--red)';
        setTimeout(() => {
            cmdInput.value = '';
            cmdInput.style.color = '';
        }, 2000);
    }
    // Exposed for per-view scripts (ideas.js etc.) that need to surface a
    // status string through the same cmd-bar flash without duplicating it.
    window._flash = flashError;

    // ── View Lifecycle ──

    function onViewEnter(view) {
        clearVimSelection();
        if (view === 'watchlist') initWatchlist();
        if (view === 'news') initNews();
        if (view === 'graph') initGraph();
        if (view === 'debug') initDebug();
        if (view === 'economics' && window._economicsInit) window._economicsInit();
    }

    function initGraph() {
        // Render company panel on graph page (no sparkline — chart IS the graph)
        var panel = document.getElementById('company-panel');
        if (panel && selectedSecurity && window._renderCompanyPanel) {
            window._renderCompanyPanel('company-panel', selectedSecurity);
        }
    }

    function onViewLeave(view) {
        if (view === 'debug' && debugWs) {
            debugWs.close();
            debugWs = null;
        }
        if (view === 'news') {
            unsubscribeNewsTopic();
        }
    }

    // ── WebSocket Manager (quotes) ──

    function connectWS() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(proto + '//' + location.host + '/ws');

        ws.onopen = function () {
            wsRetryDelay = 1000; // reset on successful connect
            setConnStatus(true);
            // subscribedSecurities is the single source of truth for which
            // quote topics this client cares about (loadWatchlists feeds it
            // every watchlist symbol via subscribeSecurity). One frame per
            // unique symbol — no duplicates.
            subscribedSecurities.forEach(function (sym) {
                ws.send(JSON.stringify({ type: 'subscribe', topic: 'quote:' + sym }));
            });
            if (newsCurrentTopic) {
                ws.send(JSON.stringify({ type: 'subscribe', topic: newsCurrentTopic }));
            }
        };

        ws.onclose = function () {
            setConnStatus(false);
            setTimeout(connectWS, wsRetryDelay);
            wsRetryDelay = Math.min(wsRetryDelay * 2, 30000); // backoff up to 30s
        };

        ws.onerror = function () { ws.close(); };

        ws.onmessage = function (event) {
            const msg = JSON.parse(event.data);
            if (msg.type === 'html' && msg.html) {
                handleQuoteHTML(msg.html);
            } else if (msg.type === 'news_update' && msg.payload) {
                handleNewsUpdate(msg.topic, msg.payload);
            }
        };
    }

    function setConnStatus(connected) {
        const el = document.getElementById('conn-status');
        if (!el) return;
        el.textContent = connected ? 'CONNECTED' : 'DISCONNECTED';
        if (connected) {
            el.classList.add('connected');
        } else {
            el.classList.remove('connected');
        }
    }

    // ── Watchlist ──

    var watchlistData = []; // cached watchlist data
    var activeWatchlistId = parseInt(localStorage.getItem('stocktopus-watchlist-id') || '0');
    var watchlistBuffer = ''; // last symbol cut via 'd' on a watchlist row, ready to paste with 'p'

    // Cache of saved sketches for cross-page :add autocomplete. Lazy-filled on
    // first ':add' keystroke so we don't fetch unconditionally on every load.
    var sketchesData = [];
    var sketchesLoaded = false;
    function ensureSketchesLoaded() {
        if (sketchesLoaded) return Promise.resolve(sketchesData);
        sketchesLoaded = true;
        return fetch('/api/sketches')
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (list) { sketchesData = list || []; return sketchesData; })
            .catch(function () { return []; });
    }

    function initWatchlist() {
        const form = document.getElementById('add-security-form');
        if (form) initWatchlistAddForm(form);

        // Re-render tabs (DOM is fresh on SPA navigation)
        renderWatchlistTabs();

        // Fetch batch quotes immediately
        fetchWatchlistQuotes();
    }

    function ensureWatchlistRow(symbol) {
        var tbody = document.getElementById('quote-body');
        if (!tbody) return null;
        var existing = document.getElementById('quote-' + symbol);
        if (existing) return existing;
        // Ghost row — emitted for symbols we have on disk but no quote data
        // for (e.g. an FMP plan that doesn't cover this exchange). Keeps the
        // row visible so the user can still `d` it from the watchlist.
        var html = '<tr id="quote-' + escapeHtml(symbol) + '" class="quote-row-ghost">'
            + '<td><span class="sym-link" data-symbol="' + escapeHtml(symbol) + '">' + escapeHtml(symbol) + '</span></td>'
            + '<td class="quote-na">—</td>'
            + '<td class="quote-na">—</td>'
            + '<td class="quote-na">—</td>'
            + '<td class="quote-na">no data</td>'
            + '<td></td>'
            + '</tr>';
        tbody.insertAdjacentHTML('beforeend', html);
        return document.getElementById('quote-' + symbol);
    }

    function fetchWatchlistQuotes() {
        // Seed ghost rows for every symbol in every watchlist before the
        // quote response comes back. Real quotes replace these in-place;
        // unreachable symbols simply stay as ghosts and remain deletable.
        var tbody = document.getElementById('quote-body');
        if (tbody) {
            var seen = {};
            (watchlistData || []).forEach(function (wl) {
                (wl.symbols || []).forEach(function (sym) {
                    if (!seen[sym]) { seen[sym] = true; ensureWatchlistRow(sym); }
                });
            });
            var empty = document.getElementById('empty-state');
            if (empty && Object.keys(seen).length > 0) empty.style.display = 'none';
        }

        fetch('/api/watchlists/quotes')
            .then(function (r) { return r.json(); })
            .then(function (quotes) {
                if (!quotes || quotes.length === 0) return;
                var tbody = document.getElementById('quote-body');
                if (!tbody) return;

                var empty = document.getElementById('empty-state');
                if (empty) empty.style.display = 'none';

                quotes.forEach(function (q) {
                    var chgClass = q.change >= 0 ? 'price-up' : 'price-down';
                    var chgPct = q.changePercentage ? q.changePercentage.toFixed(2) + '%' : '';
                    var chg = q.change ? (q.change >= 0 ? '+' : '') + q.change.toFixed(2) : '';
                    var vol = q.volume ? formatWatchlistVolume(q.volume) : '';
                    var updated = '';

                    var existing = document.getElementById('quote-' + q.symbol);
                    var html = '<tr id="quote-' + q.symbol + '">'
                        + '<td><span class="sym-link" data-symbol="' + q.symbol + '">' + q.symbol + '</span></td>'
                        + '<td class="' + chgClass + '">' + (q.price ? q.price.toFixed(2) : '') + '</td>'
                        + '<td class="' + chgClass + '">' + chg + '</td>'
                        + '<td class="' + chgClass + '">' + chgPct + '</td>'
                        + '<td>' + vol + '</td>'
                        + '<td>' + updated + '</td>'
                        + '</tr>';

                    if (existing) {
                        existing.outerHTML = html;
                    } else {
                        tbody.insertAdjacentHTML('beforeend', html);
                    }

                    // Subscribe for live updates
                    subscribeSecurity(q.symbol);
                });

                // Wire up clicks
                tbody.querySelectorAll('[data-symbol]').forEach(function (el) {
                    el.onclick = function (e) {
                        e.preventDefault();
                        navigate('graph', el.dataset.symbol);
                    };
                });

                // Add watchlist colors
                tbody.querySelectorAll('tr').forEach(function (row) {
                    var sym = row.querySelector('[data-symbol]');
                    if (sym) {
                        var colors = getWatchlistColors(sym.dataset.symbol);
                        if (colors.length > 0) {
                            row.style.borderLeft = '3px solid ' + colors[0];
                        }
                    }
                });

                // Filter to active watchlist
                filterWatchlistView();
            })
            .catch(function (err) { console.error('Watchlist quotes error:', err); });
    }

    function formatWatchlistVolume(v) {
        if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
        if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
        if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
        return v;
    }

    function loadWatchlists() {
        return fetch('/api/watchlists')
            .then(function (r) { return r.json(); })
            .then(function (lists) {
                watchlistData = lists || [];
                if (!activeWatchlistId && watchlistData.length > 0) {
                    activeWatchlistId = watchlistData[0].id;
                }
                watchlistData.forEach(function (wl) {
                    (wl.symbols || []).forEach(function (sym) {
                        subscribeSecurity(sym);
                    });
                });
                renderWatchlistTabs();
                renderWatchlistPicker();
            })
            .catch(function () {});
    }

    function renderWatchlistTabs() {
        var tabContainer = document.getElementById('watchlist-tabs');
        if (!tabContainer) return;

        tabContainer.innerHTML = watchlistData.map(function (wl) {
            var active = wl.id === activeWatchlistId ? ' wl-tab-active' : '';
            return '<span class="wl-tab' + active + '" data-id="' + wl.id + '" style="border-color:' + wl.color + ';color:' + wl.color + '">' + escapeHtml(wl.name) + ' (' + (wl.symbols ? wl.symbols.length : 0) + ')</span>';
        }).join('');

        tabContainer.querySelectorAll('.wl-tab').forEach(function (tab) {
            tab.onclick = function () {
                activeWatchlistId = parseInt(tab.dataset.id);
                localStorage.setItem('stocktopus-watchlist-id', activeWatchlistId);
                renderWatchlistTabs();
                renderWatchlistPicker();
                filterWatchlistView();
            };
        });
    }

    function renderWatchlistPicker() {
        var picker = document.getElementById('watchlist-picker');
        if (!picker) return;
        var active = watchlistData.find(function (wl) { return wl.id === activeWatchlistId; });
        if (active) {
            picker.textContent = active.name;
            picker.style.borderColor = active.color;
            picker.style.color = active.color;
        } else if (watchlistData.length > 0) {
            picker.textContent = watchlistData[0].name;
            picker.style.borderColor = watchlistData[0].color;
            picker.style.color = watchlistData[0].color;
        }
    }

    function filterWatchlistView() {
        var tbody = document.getElementById('quote-body');
        var empty = document.getElementById('empty-state');
        if (!tbody) return;

        var activeWl = watchlistData.find(function (wl) { return wl.id === activeWatchlistId; });
        var activeSymbols = activeWl && activeWl.symbols ? activeWl.symbols : [];
        var activeColor = activeWl ? activeWl.color : '#ff8800';

        // Show/hide rows based on active watchlist + paint borders with the active
        // list's color (so a symbol that lives in multiple lists picks up the
        // currently-viewed list's tone, not whichever list it was first added to).
        var visibleCount = 0;
        tbody.querySelectorAll('tr').forEach(function (row) {
            var sym = row.querySelector('[data-symbol]');
            var symbol = sym ? sym.dataset.symbol : '';
            var inList = activeSymbols.indexOf(symbol) >= 0;
            row.style.display = inList ? '' : 'none';
            if (inList) {
                row.style.borderLeft = '3px solid ' + activeColor;
                visibleCount++;
            }
        });

        if (empty) {
            empty.style.display = visibleCount > 0 ? 'none' : '';
            empty.textContent = visibleCount > 0 ? '' : 'No securities in this watchlist — use :watch to add';
        }
    }

    // Refresh the entire watchlist view after a mutation (delete / paste / copy).
    // Pulls fresh metadata, re-renders tabs, then re-fetches quotes which
    // repaint borders per the active list and hide rows that no longer fit.
    function refreshWatchlistView() {
        return fetch('/api/watchlists')
            .then(function (r) { return r.json(); })
            .then(function (lists) {
                watchlistData = lists || [];
                renderWatchlistTabs();
                renderWatchlistPicker();
                // Rebuild the row set from scratch so symbols removed from every
                // watchlist drop out of the table entirely instead of lingering.
                var tbody = document.getElementById('quote-body');
                if (tbody) tbody.innerHTML = '';
                fetchWatchlistQuotes();
            })
            .catch(function () {});
    }

    function getActiveWatchlistId() {
        return activeWatchlistId || (watchlistData.length > 0 ? watchlistData[0].id : 1);
    }

    function addToWatchlist(watchlistId, symbol) {
        return fetch('/api/watchlists/' + (watchlistId || getActiveWatchlistId()) + '/symbols', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol: symbol }),
        }).then(function (r) {
            if (!r.ok) {
                return r.json().then(function (body) {
                    flashError(body.error || 'Could not add ' + symbol);
                });
            }
            // Refresh tabs/picker first (so watchlistData is up to date),
            // then re-render the quote table — without this second call the
            // new symbol's row only appears on next page load.
            return loadWatchlists().then(fetchWatchlistQuotes);
        }).catch(function () { flashError('Add failed — server unreachable'); });
    }

    // initWatchlistAddForm wires the search-as-you-type dropdown on the
    // /watchlist page's "Add security" input. Mirrors the global security
    // selector pattern: typing shows matches, Enter / click commits, raw
    // unresolved text is refused (server-side validation also enforces this).
    function initWatchlistAddForm(form) {
        var input = document.getElementById('wl-security-input');
        var dropdown = document.getElementById('wl-security-dropdown');
        if (!input || !dropdown) return;

        var results = [];
        var hoverIdx = -1;

        function render() {
            if (document.activeElement !== input || results.length === 0) {
                dropdown.classList.add('hidden');
                return;
            }
            dropdown.innerHTML = results.map(function (r, i) {
                return '<div class="security-option' + (i === hoverIdx ? ' active' : '') + '"'
                    + ' data-symbol="' + escapeHtml(r.symbol) + '">'
                    + '<span class="sec-sym">' + escapeHtml(r.symbol) + '</span>'
                    + '<span class="sec-name">' + escapeHtml(r.name || '') + '</span>'
                    + '</div>';
            }).join('');
            dropdown.classList.remove('hidden');
        }

        function commit(symbol) {
            if (!symbol) return;
            subscribeSecurity(symbol);
            addToWatchlist(getActiveWatchlistId(), symbol);
            input.value = '';
            results = [];
            hoverIdx = -1;
            dropdown.classList.add('hidden');
        }

        // Exchange preference — push primary US listings to the top so that
        // Enter on "microsoft" doesn't accidentally pick a foreign listing
        // the user's FMP plan can't quote (MSF.BR etc.). Order is intentional:
        // NASDAQ + NYSE first, then BATS / AMEX / NMS, everything else last.
        var EXCHANGE_RANK = { 'NASDAQ': 0, 'NYSE': 0, 'BATS': 1, 'AMEX': 1, 'NMS': 1, 'NCM': 1, 'NGM': 1 };
        function rankResults(rows) {
            return rows.slice().sort(function (a, b) {
                var ra = EXCHANGE_RANK[a.exchange] != null ? EXCHANGE_RANK[a.exchange] : 9;
                var rb = EXCHANGE_RANK[b.exchange] != null ? EXCHANGE_RANK[b.exchange] : 9;
                return ra - rb;
            });
        }

        input.addEventListener('input', function () {
            var q = input.value.trim();
            if (!q) { results = []; hoverIdx = -1; render(); return; }
            searchSecurities(q, function (rows) {
                results = rankResults(Array.isArray(rows) ? rows : []);
                // No auto-highlight — accidental Enter on the input must NOT
                // commit a result the user hasn't actively chosen. Arrow keys
                // or click moves hoverIdx; raw Enter with no selection falls
                // through to the exact-match check in onsubmit.
                hoverIdx = -1;
                render();
            });
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown') {
                if (results.length === 0) return;
                e.preventDefault();
                hoverIdx = Math.min(hoverIdx + 1, results.length - 1);
                render();
            } else if (e.key === 'ArrowUp') {
                if (results.length === 0) return;
                e.preventDefault();
                hoverIdx = Math.max(hoverIdx - 1, 0);
                render();
            } else if (e.key === 'Escape') {
                results = []; hoverIdx = -1; dropdown.classList.add('hidden');
            }
        });

        // On submit (Enter or +), prefer the highlighted dropdown choice; if
        // none, accept raw text only when it exactly matches one of the
        // current results (covers typing "AAPL" and hitting Enter before
        // moving the cursor onto a row). Anything else: refuse — the server
        // would reject it anyway and the user should pick from the list.
        form.onsubmit = function (e) {
            e.preventDefault();
            var picked = null;
            if (hoverIdx >= 0 && hoverIdx < results.length) {
                picked = results[hoverIdx].symbol;
            } else {
                var raw = input.value.trim().toUpperCase();
                var exact = results.find(function (r) { return r.symbol.toUpperCase() === raw; });
                if (exact) picked = exact.symbol;
            }
            if (!picked) {
                flashError('Pick a match from the dropdown');
                return;
            }
            commit(picked);
        };

        dropdown.addEventListener('mousedown', function (e) {
            var opt = e.target.closest('.security-option');
            if (opt && opt.dataset.symbol) {
                e.preventDefault(); // keep input focused through the click
                commit(opt.dataset.symbol);
            }
        });

        input.addEventListener('blur', function () {
            // Hide on blur but with a short delay so a mousedown on the
            // dropdown still resolves the click before the dropdown vanishes.
            setTimeout(function () { dropdown.classList.add('hidden'); }, 150);
        });
    }

    function createWatchlist(name) {
        fetch('/api/watchlists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name }),
        }).then(function (r) { return r.json(); })
        .then(function (wl) {
            loadWatchlists();
            flashError('Watchlist "' + name + '" created');
        }).catch(function (err) { console.error('Create watchlist error:', err); });
    }

    function subscribeSecurity(sec) {
        if (subscribedSecurities.has(sec)) return; // already subscribed for this client
        subscribedSecurities.add(sec);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'subscribe', topic: 'quote:' + sec }));
        }
    }

    function handleQuoteHTML(html) {
        if (currentView !== 'watchlist') return;

        const temp = document.createElement('div');
        temp.innerHTML = html;
        const row = temp.firstElementChild;
        if (!row || !row.id) return;

        const existing = document.getElementById(row.id);
        const tbody = document.getElementById('quote-body');
        if (!tbody) return;

        if (existing) {
            existing.replaceWith(row);
            row.classList.add('flash');
            setTimeout(function () { row.classList.remove('flash'); }, 600);
        } else {
            tbody.appendChild(row);
            const empty = document.getElementById('empty-state');
            if (empty) empty.style.display = 'none';
        }

        // Wire up SPA click on security link
        row.querySelectorAll('[data-symbol]').forEach(function (el) {
            el.onclick = function (e) {
                e.preventDefault();
                navigate('graph', el.dataset.symbol);
            };
        });

        // Add watchlist color badge
        var sym = row.querySelector('[data-symbol]');
        if (sym) {
            var symName = sym.dataset.symbol;
            var colors = getWatchlistColors(symName);
            if (colors.length > 0) {
                row.style.borderLeft = '3px solid ' + colors[0];
            }
        }
    }

    function getWatchlistColors(symbol) {
        var colors = [];
        watchlistData.forEach(function (wl) {
            if ((wl.symbols || []).indexOf(symbol) >= 0) {
                colors.push(wl.color);
            }
        });
        return colors;
    }

    // ── Debug Console ──

    function initDebug() {
        if (debugWs) { debugWs.close(); debugWs = null; }

        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        debugWs = new WebSocket(proto + '//' + location.host + '/ws/debug');

        debugWs.onopen = function () { setConnStatus(true); };
        debugWs.onclose = function () {};
        debugWs.onerror = function () { debugWs.close(); };

        debugWs.onmessage = function (event) {
            const msg = JSON.parse(event.data);
            if (msg.type === 'html' && msg.html) {
                const entries = document.getElementById('log-entries');
                if (!entries) return;
                entries.insertAdjacentHTML('afterbegin', msg.html);
                while (entries.children.length > 500) {
                    entries.removeChild(entries.lastChild);
                }
                const autoscroll = document.getElementById('autoscroll');
                if (autoscroll && autoscroll.checked && entries.firstElementChild) {
                    entries.firstElementChild.scrollIntoView({ behavior: 'smooth' });
                }
            }
        };

        // Wire up clear button
        const clearBtn = document.getElementById('debug-clear');
        if (clearBtn) {
            clearBtn.onclick = function () {
                const entries = document.getElementById('log-entries');
                if (entries) entries.innerHTML = '';
            };
        }
    }

    // ── News ──

    var NEWS_CATEGORIES = ['press-releases', 'articles', 'stock', 'crypto', 'forex', 'general'];

    var newsCurrentCategory = '';
    var newsCurrentPage = 0;
    var newsLoading = false;
    var newsExhausted = false;
    var NEWS_PAGE_SIZE = 30;

    function initNews() {
        var tabs = document.getElementById('news-tabs');
        if (!tabs) return;

        // Show company panel if a security is selected
        var sym = getNewsSymbol();
        if (sym && window._renderCompanyPanel) {
            window._renderCompanyPanel('company-panel', sym);
        }

        tabs.querySelectorAll('.news-tab').forEach(function (tab) {
            tab.onclick = function () {
                if (tab.classList.contains('dimmed')) return;
                tabs.querySelectorAll('.news-tab').forEach(function (t) { t.classList.remove('active'); });
                tab.classList.add('active');
                fetchNews(tab.dataset.category);
            };
        });

        // Infinite scroll
        var container = document.getElementById('news-cards');
        if (container) {
            container.addEventListener('scroll', function () {
                if (newsLoading || newsExhausted) return;
                var threshold = container.scrollHeight - container.scrollTop - container.clientHeight;
                if (threshold < 200) {
                    fetchNewsNextPage();
                }
            });
        }

        // Probe tabs for results to dim empty ones when filtering by security
        if (getNewsSymbol()) {
            probeNewsTabs();
        }

        // Default: load first tab
        fetchNews('press-releases');
    }

    function getNewsSymbol() {
        return newsFilterSecurity || selectedSecurity || '';
    }

    function subscribeNewsTopic(category) {
        // Unsubscribe previous
        if (newsCurrentTopic && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'unsubscribe', topic: newsCurrentTopic }));
        }
        newsCurrentTopic = 'news:' + category;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'subscribe', topic: newsCurrentTopic }));
        }
    }

    function unsubscribeNewsTopic() {
        if (newsCurrentTopic && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'unsubscribe', topic: newsCurrentTopic }));
        }
        newsCurrentTopic = '';
    }

    function handleNewsUpdate(topic, items) {
        if (currentView !== 'news') return;
        // Only handle updates for the active tab
        var expectedTopic = 'news:' + newsCurrentCategory;
        if (topic !== expectedTopic) return;

        var container = document.getElementById('news-cards');
        if (!container) return;

        var newCards = [];
        for (var i = items.length - 1; i >= 0; i--) {
            var item = items[i];
            if (newsSeenURLs.has(item.url)) continue;
            newsSeenURLs.add(item.url);
            newCards.push(renderNewsCard(item));
        }

        if (newCards.length > 0) {
            container.insertAdjacentHTML('afterbegin', newCards.join(''));
        }
    }

    function probeNewsTabs() {
        var tabs = document.getElementById('news-tabs');
        if (!tabs) return;

        NEWS_CATEGORIES.forEach(function (cat) {
            var tab = tabs.querySelector('[data-category="' + cat + '"]');
            if (!tab) return;

            var params = 'limit=1';
            var sym = getNewsSymbol();
            if (sym) {
                params += '&symbol=' + encodeURIComponent(sym);
            }

            fetch('/api/news/' + cat + '?' + params)
                .then(function (r) { return r.json(); })
                .then(function (items) {
                    if (!items || items.length === 0) {
                        tab.classList.add('dimmed');
                    } else {
                        tab.classList.remove('dimmed');
                    }
                })
                .catch(function () {
                    tab.classList.add('dimmed');
                });
        });
    }

    function fetchNews(category) {
        newsCurrentCategory = category;
        newsCurrentPage = 0;
        newsLoading = false;
        newsExhausted = false;

        // Subscribe to live updates for this category
        subscribeNewsTopic(category);

        var container = document.getElementById('news-cards');
        if (!container) return;
        container.innerHTML = '<p class="empty-state">Loading...</p>';

        fetchNewsPage(category, 0, function (items) {
            if (!items || items.length === 0) {
                container.innerHTML = '<p class="empty-state">No news available</p>';
                newsExhausted = true;
                return;
            }
            items.forEach(function (item) { newsSeenURLs.add(item.url); });
            container.innerHTML = items.map(function (item) { return renderNewsCard(item); }).join('');
            if (items.length < NEWS_PAGE_SIZE) newsExhausted = true;
        });
    }

    function fetchNewsNextPage() {
        if (newsLoading || newsExhausted || !newsCurrentCategory) return;
        newsCurrentPage++;

        var container = document.getElementById('news-cards');
        if (!container) return;

        // Add loading indicator at bottom
        var loader = document.createElement('div');
        loader.className = 'news-loader';
        loader.id = 'news-loader';
        loader.textContent = 'Loading more...';
        container.appendChild(loader);

        fetchNewsPage(newsCurrentCategory, newsCurrentPage, function (items) {
            var el = document.getElementById('news-loader');
            if (el) el.remove();

            if (!items || items.length === 0) {
                newsExhausted = true;
                return;
            }
            items.forEach(function (item) { newsSeenURLs.add(item.url); });
            container.insertAdjacentHTML('beforeend', items.map(function (item) { return renderNewsCard(item); }).join(''));
            if (items.length < NEWS_PAGE_SIZE) newsExhausted = true;
        });
    }

    function markNewsRead(card) {
        card.classList.remove('news-unread');
        var url = card.dataset.url;
        if (url) newsReadURLs.add(url);
    }

    function showNewsSpinner(show) {
        var el = document.getElementById('news-spinner');
        if (el) el.classList.toggle('hidden', !show);
    }

    function fetchNewsPage(category, page, callback) {
        newsLoading = true;
        showNewsSpinner(true);
        var params = 'limit=' + NEWS_PAGE_SIZE + '&page=' + page;
        var sym = getNewsSymbol();
        if (sym) {
            params += '&symbol=' + encodeURIComponent(sym);
        }

        fetch('/api/news/' + category + '?' + params)
            .then(function (resp) { return resp.json(); })
            .then(function (items) {
                newsLoading = false;
                showNewsSpinner(false);
                callback(items);
            })
            .catch(function (err) {
                newsLoading = false;
                showNewsSpinner(false);
                callback([]);
            });
    }

    function renderNewsCard(item) {
        var unread = !newsReadURLs.has(item.url);
        var date = item.date ? new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        var text = item.text || '';
        // Strip HTML tags for articles that contain HTML content
        var div = document.createElement('div');
        div.innerHTML = text;
        var plainText = div.textContent || div.innerText || '';
        if (plainText.length > 300) plainText = plainText.substring(0, 300) + '...';

        var symbolBadge = item.symbol ? '<span class="news-symbol">' + escapeHtml(item.symbol) + '</span>' : '';
        var unreadClass = unread ? ' news-unread' : '';

        return '<div class="news-card' + unreadClass + '" data-url="' + escapeHtml(item.url) + '">'
            + '<div class="news-card-title"><a href="' + escapeHtml(item.url) + '" onclick="event.preventDefault();if(window._openReader)window._openReader(this.href,this.textContent)">' + escapeHtml(item.title) + '</a></div>'
            + '<div class="news-card-meta">'
            +   symbolBadge
            +   '<span>' + escapeHtml(item.source) + '</span>'
            +   '<span>' + date + '</span>'
            +   (item.author ? '<span>' + escapeHtml(item.author) + '</span>' : '')
            + '</div>'
            + '<div class="news-card-text">' + escapeHtml(plainText) + '</div>'
            + '</div>';
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ── Security Selector ──

    function setSecurity(sec) {
        selectedSecurity = sec.toUpperCase();
        localStorage.setItem('stocktopus-security', selectedSecurity);
        document.getElementById('security-input').value = selectedSecurity;
    }

    function initSecuritySelector() {
        const input = document.getElementById('security-input');
        const dropdown = document.getElementById('security-dropdown');
        let dropdownIndex = -1;

        if (selectedSecurity) input.value = selectedSecurity;

        input.addEventListener('input', function () {
            const query = input.value.trim();
            if (!query) {
                dropdown.classList.add('hidden');
                return;
            }
            searchSecurities(query, function (results) {
                renderSecurityDropdown(results, dropdown);
                dropdownIndex = -1;
            });
        });

        input.addEventListener('keydown', function (e) {
            const items = dropdown.querySelectorAll('.security-option');

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                dropdownIndex = Math.min(dropdownIndex + 1, items.length - 1);
                highlightDropdown(items, dropdownIndex);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                dropdownIndex = Math.max(dropdownIndex - 1, 0);
                highlightDropdown(items, dropdownIndex);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(searchTimer);
                if (dropdownIndex >= 0 && items[dropdownIndex]) {
                    selectSecurity(items[dropdownIndex].dataset.symbol);
                } else {
                    const sec = input.value.trim().toUpperCase();
                    if (sec) selectSecurity(sec);
                }
                dropdown.classList.add('hidden');
                enterNormalMode();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                clearTimeout(searchTimer);
                dropdown.classList.add('hidden');
                enterNormalMode();
            }
        });

        input.addEventListener('blur', function () {
            setTimeout(function () { dropdown.classList.add('hidden'); }, 150);
        });
    }

    function selectSecurity(sec) {
        setSecurity(sec);
        // Ensure security dropdown is hidden
        var dd = document.getElementById('security-dropdown');
        if (dd) dd.classList.add('hidden');
        // If on a security-dependent view, refresh it
        const cmd = COMMANDS[currentView];
        if (cmd && cmd.needsSecurity) {
            // Stock-info-like views route by detected type so `s ETHUSD`
            // from /security/AAPL goes to /crypto/ETHUSD, not /security/ETHUSD.
            // Other typed views (graph, analyze) stay on their own path.
            var nextView = currentView;
            if (currentView === 'info' || currentView === 'crypto' ||
                currentView === 'forex' || currentView === 'index' ||
                currentView === 'etf' || currentView === 'fund') {
                nextView = viewForKnownSymbol(sec);
            }
            onViewLeave(currentView);
            navigate(nextView, sec);
        } else {
            // Default: navigate to the type-appropriate info page.
            onViewLeave(currentView);
            navigate(viewForKnownSymbol(sec), sec);
        }
    }

    var searchTimer = null;

    function searchSecurities(query, callback) {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
            fetch('/api/search?q=' + encodeURIComponent(query))
                .then(function (r) { return r.json(); })
                .then(callback)
                .catch(function () { callback([]); });
        }, 200);
    }

    function renderSecurityDropdown(results, dropdown) {
        // Don't show dropdown if user has already moved on (e.g. hit Enter before a debounced search returned)
        var input = document.getElementById('security-input');
        if (!input || document.activeElement !== input) {
            dropdown.classList.add('hidden');
            return;
        }
        if (!results || results.length === 0) {
            dropdown.classList.add('hidden');
            return;
        }
        // Seed the type cache from search results so subsequent navigations
        // (Enter on a result, or :info on the same symbol later) route to
        // the type-specific page without re-hitting search.
        results.forEach(function (r) { rememberSymbolView(r.symbol, r.exchange); });
        dropdown.innerHTML = results.map(function (r) {
            return '<div class="security-option" data-symbol="' + escapeHtml(r.symbol) + '">'
                + '<span class="sec-sym">' + escapeHtml(r.symbol) + '</span>'
                + '<span class="sec-name">' + escapeHtml(r.name) + '</span>'
                + '<span class="sec-exchange">' + escapeHtml(r.exchange) + '</span>'
                + '</div>';
        }).join('');
        dropdown.classList.remove('hidden');

        dropdown.querySelectorAll('.security-option').forEach(function (el) {
            el.onmousedown = function (e) {
                e.preventDefault();
                selectSecurity(el.dataset.symbol);
                dropdown.classList.add('hidden');
            };
        });
    }

    function highlightDropdown(items, index) {
        items.forEach(function (el, i) {
            el.classList.toggle('active', i === index);
        });
    }

    // ── Command Bar ──

    let cmdDropdownIndex = -1;

    function initCommandBar() {
        const input = document.getElementById('cmd-input');
        const dropdown = document.getElementById('cmd-dropdown');

        input.addEventListener('focus', function () {
            filterAndShowCommands(input.value);
        });

        input.addEventListener('input', function () {
            filterAndShowCommands(input.value);
        });

        input.addEventListener('keydown', function (e) {
            const items = dropdown.querySelectorAll('.cmd-option');

            if (e.key === 'ArrowDown' && !dropdown.classList.contains('hidden')) {
                e.preventDefault();
                cmdDropdownIndex = Math.min(cmdDropdownIndex + 1, items.length - 1);
                highlightCmdDropdown(items, cmdDropdownIndex);
            } else if (e.key === 'ArrowUp' && !dropdown.classList.contains('hidden')) {
                e.preventDefault();
                if (cmdDropdownIndex > 0) {
                    cmdDropdownIndex--;
                    highlightCmdDropdown(items, cmdDropdownIndex);
                } else {
                    cmdDropdownIndex = -1;
                    highlightCmdDropdown(items, cmdDropdownIndex);
                }
            } else if (e.key === 'Tab' && !dropdown.classList.contains('hidden')) {
                e.preventDefault();
                var pickIdx = cmdDropdownIndex >= 0 ? cmdDropdownIndex : (items.length === 1 ? 0 : -1);
                if (pickIdx >= 0 && items[pickIdx]) {
                    var item = items[pickIdx];
                    if (item.dataset.watchlistName) {
                        input.value = ':watch ' + item.dataset.watchlistName;
                        hideCmdDropdown();
                    } else if (item.dataset.field) {
                        input.value = ':add ' + item.dataset.sym + '.' + item.dataset.field;
                        hideCmdDropdown();
                    } else if (item.dataset.sketchName) {
                        var existing = input.value;
                        var toI = existing.toLowerCase().lastIndexOf(' to ');
                        input.value = (toI > 0 ? existing.substring(0, toI + 4) : existing.replace(/\s+$/, '') + ' to ') + item.dataset.sketchName;
                        hideCmdDropdown();
                    } else if (item.dataset.symbol) {
                        input.value = item.dataset.cmd + ' ' + item.dataset.symbol;
                    } else {
                        acceptCmdCompletion(item.dataset.cmd);
                    }
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                // If dropdown is visible and a watchlist option is highlighted, execute the watch.
                if (!dropdown.classList.contains('hidden') && cmdDropdownIndex >= 0 && items[cmdDropdownIndex]) {
                    var item = items[cmdDropdownIndex];
                    if (item.dataset.field) {
                        // :add SYM.<field> — execute right away
                        hideCmdDropdown();
                        commandHistory.push(':add ' + item.dataset.sym + '.' + item.dataset.field);
                        historyIndex = commandHistory.length;
                        input.value = '';
                        enterNormalMode();
                        executeIdeasAdd(item.dataset.sym + '.' + item.dataset.field, '');
                        return;
                    }
                    if (item.dataset.sketchName || item.dataset.sketchCreate) {
                        // ":add <metric> to <sketch>" — combine current input + selection then execute.
                        // sketchCreate carries the typed name when no existing sketch matched.
                        var sketchTarget = item.dataset.sketchName || item.dataset.sketchCreate;
                        var existing = input.value;
                        var toIE = existing.toLowerCase().lastIndexOf(' to ');
                        var withTo = (toIE > 0 ? existing.substring(0, toIE + 4) : existing.replace(/\s+$/, '') + ' to ') + sketchTarget;
                        var afterColon = withTo.charAt(0) === ':' ? withTo.substring(1) : withTo;
                        var addArg2 = afterColon.toLowerCase().startsWith('add ') ? afterColon.substring(4) : afterColon;
                        var toI2 = addArg2.toLowerCase().lastIndexOf(' to ');
                        var metric2 = toI2 > 0 ? addArg2.substring(0, toI2).trim() : addArg2.trim();
                        var sketch2 = toI2 > 0 ? addArg2.substring(toI2 + 4).trim() : '';
                        hideCmdDropdown();
                        commandHistory.push(withTo);
                        historyIndex = commandHistory.length;
                        input.value = '';
                        enterNormalMode();
                        executeIdeasAdd(metric2, sketch2);
                        return;
                    }
                    if (item.dataset.watchlistName) {
                        hideCmdDropdown();
                        executeWatchCommand(parseInt(item.dataset.watchlistId, 10), item.dataset.watchlistName);
                        commandHistory.push(':watch ' + item.dataset.watchlistName);
                        historyIndex = commandHistory.length;
                        input.value = '';
                        enterNormalMode();
                        return;
                    }
                    if (item.dataset.symbol) {
                        hideCmdDropdown();
                        commandHistory.push(item.dataset.cmd + ' ' + item.dataset.symbol);
                        historyIndex = commandHistory.length;
                        input.value = '';
                        setSecurity(item.dataset.symbol);
                        onViewLeave(currentView);
                        navigate(item.dataset.cmd, item.dataset.symbol);
                        return;
                    }
                    acceptCmdCompletion(item.dataset.cmd);
                    return;
                }
                hideCmdDropdown();
                const raw = input.value.trim();
                if (!raw) return;

                // Handle : commands
                if (raw.charAt(0) === ':') {
                    var colonCmd = raw.substring(1);
                    var colonLower = colonCmd.toLowerCase();

                    // Chart range: :1, :5, :15, :30, :1h, :4h, :1w, :1m, :3m, :6m
                    var rangeMap = {
                        '1': '1m', '5': '5m', '15': '15m', '30': '30m',
                        '1h': '1h', '4h': '4h',
                        '1w': '1W', '1m': '1M', '3m': '3M', '6m': '6M',
                    };
                    if (rangeMap[colonLower] && window._stocktopusSetRange) {
                        window._stocktopusSetRange(rangeMap[colonLower]);
                        input.value = '';
                        enterNormalMode();
                        return;
                    }

                    // Indicator toggles: :sma, :ema, :macd, :rsi, :sn
                    var indicatorMap = { 'sma': 'sma', 'ema': 'ema', 'macd': 'macd', 'rsi': 'rsi', 'sn': 'news' };
                    if (indicatorMap[colonLower] && window._stocktopusToggle) {
                        window._stocktopusToggle(indicatorMap[colonLower]);
                        input.value = '';
                        enterNormalMode();
                        return;
                    }

                    // :watch — add picker selection to active watchlist
                    // :watch <WatchlistName> — add picker selection to that named watchlist
                    // :watch <SYMBOL> (legacy) — add SYMBOL to active watchlist when no name match
                    if (colonLower === 'watch' || colonLower.startsWith('watch ')) {
                        var watchArg = colonCmd.substring(5).trim();
                        if (!watchArg) {
                            // No arg — add picker selection to active watchlist
                            if (selectedSecurity) {
                                addToWatchlist(getActiveWatchlistId(), selectedSecurity);
                                subscribeSecurity(selectedSecurity);
                                flashError('Added ' + selectedSecurity + ' to watchlist');
                            } else {
                                flashError('Select a security first (s key)');
                            }
                        } else {
                            var target = resolveWatchTarget(watchArg);
                            if (target.type === 'watchlist') {
                                executeWatchCommand(target.id, target.name);
                            } else {
                                addToWatchlist(getActiveWatchlistId(), target.symbol);
                                subscribeSecurity(target.symbol);
                                flashError('Added ' + target.symbol + ' to watchlist');
                            }
                        }
                        input.value = '';
                        enterNormalMode();
                        return;
                    }

                    // :watchlist "Name" — create new watchlist
                    if (colonLower.startsWith('watchlist ')) {
                        var wlName = colonCmd.substring(10).trim().replace(/^["']|["']$/g, '');
                        if (wlName) createWatchlist(wlName);
                        input.value = '';
                        enterNormalMode();
                        return;
                    }

                    // :add <metric> [to <sketch>] — push a metric onto a sketchpad.
                    // Navigates to /ideas first if not already there.
                    if (colonLower === 'add' || colonLower.startsWith('add ')) {
                        var addArgRaw = colonCmd.substring(3).trim();
                        var toIdx = addArgRaw.toLowerCase().lastIndexOf(' to ');
                        var addMetric = addArgRaw, addToSketch = '';
                        if (toIdx > 0) {
                            addMetric = addArgRaw.substring(0, toIdx).trim();
                            addToSketch = addArgRaw.substring(toIdx + 4).trim();
                        }
                        input.value = '';
                        hideCmdDropdown();
                        enterNormalMode();
                        executeIdeasAdd(addMetric, addToSketch);
                        return;
                    }

                    // :save <name> — name + persist the current sketch
                    if (colonLower === 'save' || colonLower.startsWith('save ')) {
                        var saveName = colonCmd.substring(4).trim();
                        input.value = '';
                        hideCmdDropdown();
                        enterNormalMode();
                        if (window._ideasSave) window._ideasSave(saveName);
                        return;
                    }

                    // :cl — clear horizontal price lines on the sketchpad chart
                    if (colonLower === 'cl' || colonLower === 'clear') {
                        input.value = '';
                        hideCmdDropdown();
                        enterNormalMode();
                        if (window._ideasClearLines) window._ideasClearLines();
                        return;
                    }

                    input.value = '';
                    enterNormalMode();
                    return;
                }

                commandHistory.push(raw);
                historyIndex = commandHistory.length;
                input.value = '';

                const parsed = parseCommand(raw);
                // Resolve aliases
                var resolvedCmd = parsed.command;
                if (!COMMANDS[resolvedCmd]) {
                    // Check aliases
                    for (var cmdName in COMMANDS) {
                        var cmd = COMMANDS[cmdName];
                        if (cmd.aliases && cmd.aliases.indexOf(resolvedCmd) >= 0) {
                            resolvedCmd = cmdName;
                            break;
                        }
                    }
                }
                // If command not recognized, treat input as a security and go to info
                if (!COMMANDS[resolvedCmd]) {
                    var sec = raw.toUpperCase();
                    setSecurity(sec);
                    onViewLeave(currentView);
                    navigate('info', sec);
                    enterNormalMode();
                    return;
                }
                const security = parsed.args[0] || '';
                onViewLeave(currentView);
                navigate(resolvedCmd, security);
                enterNormalMode();
            } else if (e.key === 'Escape') {
                if (!dropdown.classList.contains('hidden')) {
                    hideCmdDropdown();
                    e.stopPropagation();
                }
                // Cancel any pending y/p row-op mode so the next :watch starts fresh.
                clearWatchOp();
            } else if (e.key === 'ArrowUp' && dropdown.classList.contains('hidden')) {
                e.preventDefault();
                if (historyIndex > 0) {
                    historyIndex--;
                    input.value = commandHistory[historyIndex];
                }
            } else if (e.key === 'ArrowDown' && dropdown.classList.contains('hidden')) {
                e.preventDefault();
                if (historyIndex < commandHistory.length - 1) {
                    historyIndex++;
                    input.value = commandHistory[historyIndex];
                } else {
                    historyIndex = commandHistory.length;
                    input.value = '';
                }
            }
        });

        input.addEventListener('blur', function () {
            setTimeout(hideCmdDropdown, 150);
        });
    }

    function renderCmdDropdown(matches) {
        const dropdown = document.getElementById('cmd-dropdown');
        if (matches.length === 0) {
            hideCmdDropdown();
            return;
        }
        dropdown.innerHTML = matches.map(function (name) {
            var cmd = COMMANDS[name];
            return '<div class="cmd-option" data-cmd="' + name + '">'
                + '<span class="cmd-option-usage">' + cmd.usage + '</span>'
                + '<span class="cmd-option-desc">' + cmd.desc + '</span>'
                + '</div>';
        }).join('');
        dropdown.classList.remove('hidden');
        cmdDropdownIndex = -1;

        dropdown.querySelectorAll('.cmd-option').forEach(function (el) {
            el.onmousedown = function (e) {
                e.preventDefault();
                acceptCmdCompletion(el.dataset.cmd);
            };
        });
    }

    function acceptCmdCompletion(name) {
        var input = document.getElementById('cmd-input');
        var cmd = COMMANDS[name];
        if (cmd.needsSecurity) {
            input.value = name + ' ';
        } else {
            input.value = name;
        }
        hideCmdDropdown();
        input.focus();
    }

    // Polls until ideas.js init has populated _ideasAdd. Used by the :add
    // handler to avoid a flat 100ms setTimeout race against the ideas init.
    function whenIdeasReady(fn) {
        var tries = 0;
        (function check() {
            if (window._ideasAdd) { fn(); return; }
            if (++tries > 40) return; // ~2s ceiling
            setTimeout(check, 50);
        })();
    }

    // Mirror of ideas.js's parseAddArg, kept in sync. Used when executing :add
    // from a foreign page where ideas.js isn't loaded.
    var SERIES_COLORS_FALLBACK = ['#ff8800', '#4499ff', '#00cc66', '#bb88ff', '#ccaa00'];
    function parseAddArgRemote(arg, fallbackSymbol) {
        var raw = (arg || '').trim();
        if (!raw) {
            if (!fallbackSymbol) return null;
            return { kind: 'price', identifier: fallbackSymbol, label: fallbackSymbol };
        }
        // Economic-catalog lookup runs FIRST — "US.UNRATE" contains a dot and
        // would otherwise be misread as SYMBOL.field. Bare "UNRATE" also
        // resolves (v1 has one country). Canonical form is "US.UNRATE".
        var econHit = lookupEcon(raw);
        if (econHit) {
            var ecoId = (econHit.identifier || (econHit.country + '.' + econHit.code)).toUpperCase();
            return { kind: 'economic', identifier: ecoId, label: econHit.name || ecoId };
        }
        var dot = raw.lastIndexOf('.');
        if (dot > 0 && dot < raw.length - 1) {
            var sym = raw.substring(0, dot).toUpperCase();
            var field = raw.substring(dot + 1);
            return { kind: 'financial', identifier: sym + '.' + field, label: sym + ' ' + field };
        }
        var s = raw.toUpperCase();
        var commodityPrefixes = ['GC','SI','CL','NG','HG','PL','PA','BZ','HO','RB','ZC','ZW','ZS','KC','SB','CC','CT'];
        var forexCurrencies = ['USD','EUR','GBP','JPY','AUD','CAD','CHF','CNY','HKD','NZD','SEK','NOK','SGD','MXN'];
        if (s.length === 5 && s.endsWith('USD')) {
            var prefix = s.substring(0, 2);
            if (commodityPrefixes.indexOf(prefix) >= 0) return { kind: 'commodity', identifier: s, label: s };
        }
        if (s.length === 6) {
            var a = s.substring(0, 3), b = s.substring(3);
            if (forexCurrencies.indexOf(a) >= 0 && forexCurrencies.indexOf(b) >= 0) return { kind: 'forex', identifier: s, label: a + '/' + b };
            if (b === 'USD' || b === 'EUR') return { kind: 'crypto', identifier: s, label: s };
        }
        return { kind: 'price', identifier: s, label: s };
    }

    // Add a parsed metric to a sketch by id. Colour is left empty so the
    // server can pick an unused one — the foreign-page path doesn't know the
    // sketch's current metric list, so client-side rotation would always
    // hand out the first palette colour.
    function postMetricToSketch(sketchID, parsed) {
        var body = { kind: parsed.kind, identifier: parsed.identifier, label: parsed.label || parsed.identifier };
        return fetch('/api/sketches/' + sketchID + '/metrics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    // Foreign-page :add path. Find or create the named sketch, append the
    // metric, and stay on the current page so the user can keep adding.
    function executeIdeasAddRemote(metric, fallback, sketchName) {
        var parsed = parseAddArgRemote(metric, fallback);
        if (!parsed) { flashError('No symbol given'); return; }
        ensureSketchesLoaded().then(function () {
            var lower = sketchName.toLowerCase();
            var match = sketchesData.find(function (sk) { return sk.name.toLowerCase() === lower; });
            if (!match) match = sketchesData.find(function (sk) { return sk.name.toLowerCase().indexOf(lower) === 0; });
            if (match) {
                postMetricToSketch(match.id, parsed)
                    .then(function () { flashError('Added ' + parsed.label + ' to ' + match.name); });
                return;
            }
            // Not found: create the sketch with the typed name then add.
            fetch('/api/sketches', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: sketchName }),
            }).then(function (r) { return r.json(); })
            .then(function (resp) { return postMetricToSketch(resp.id, parsed); })
            .then(function () {
                flashError('Idea "' + sketchName + '" created — added ' + parsed.label);
                // Refresh the local cache so subsequent :add tos see it
                sketchesLoaded = false;
                ensureSketchesLoaded();
            });
        });
    }

    // Common path for "execute :add <metric> [to <sketch>]". When the user
    // names a target sketch with `to`, stay on the current page and post via
    // the API. When no target is given, navigate them onto /ideas (the
    // last-used sketch) so they see what they just added.
    function executeIdeasAdd(metric, toSketch) {
        var fallback = selectedSecurity || '';
        if (toSketch) {
            executeIdeasAddRemote(metric, fallback, toSketch);
            return;
        }
        if (currentView !== 'ideas') {
            var lastId = localStorage.getItem('stocktopus-last-sketch');
            var ideasPath = lastId ? '/ideas/' + lastId : '/ideas';
            navigate('ideas', '', { path: ideasPath }).then(function () {
                whenIdeasReady(function () { window._ideasAdd(metric, fallback, toSketch); });
            });
        } else if (window._ideasAdd) {
            window._ideasAdd(metric, fallback, toSketch);
        }
    }

    function hideCmdDropdown() {
        var dropdown = document.getElementById('cmd-dropdown');
        dropdown.classList.add('hidden');
        cmdDropdownIndex = -1;
    }

    function highlightCmdDropdown(items, index) {
        items.forEach(function (el, i) {
            el.classList.toggle('active', i === index);
        });
    }

    function filterAndShowCommands(value) {
        // Only trim leading whitespace — keep trailing because we use it as a
        // signal: ":add SYMBOL.field to " (with trailing space) means "user
        // just finished typing 'to', show the sketch list with no prefix".
        var raw = (value || '').replace(/^\s+/, '');
        var parts = raw.trim().split(/\s+/);
        var cmdPart = parts[0].toLowerCase();

        // :watch <prefix> — autocomplete watchlist names (adds selectedSecurity to that list)
        if (raw.charAt(0) === ':') {
            var afterColon = raw.substring(1);
            var afterColonLower = afterColon.toLowerCase();
            if (afterColonLower === 'watch' || afterColonLower.startsWith('watch ')) {
                // Cancel any in-flight security autocomplete so a late response
                // for :wat / :watc doesn't override the watchlist dropdown.
                clearTimeout(searchTimer);
                var query = afterColonLower === 'watch' ? '' : afterColon.substring(6);
                renderCmdWatchlistDropdown(query);
                return;
            }

            // :add <metric> [to <sketch>] — autocomplete fields after a dot,
            // and saved sketches after " to " or " to" at the end.
            if (afterColonLower.startsWith('add ')) {
                clearTimeout(searchTimer);
                var addArg = afterColon.substring(4); // preserve case
                var lower = addArg.toLowerCase();
                var toIdx = lower.lastIndexOf(' to ');
                // Also catch the user mid-typing, before the trailing space lands:
                // ":add AAPL.revenue to" → empty prefix, show all sketches.
                if (toIdx < 0 && (lower.endsWith(' to') || lower === 'to')) {
                    renderCmdSketchDropdown('');
                    return;
                }
                if (toIdx >= 0) {
                    var sketchPrefix = addArg.substring(toIdx + 4);
                    renderCmdSketchDropdown(sketchPrefix);
                    return;
                }
                var dotIdx = addArg.lastIndexOf('.');
                if (dotIdx > 0 && dotIdx < addArg.length) {
                    var fieldPrefix = addArg.substring(dotIdx + 1);
                    renderCmdFieldDropdown(addArg.substring(0, dotIdx), fieldPrefix);
                    return;
                }
                hideCmdDropdown();
                return;
            }
        }

        // If we have a recognized command that accepts a security and there's a space,
        // switch to security autocomplete in the command dropdown
        var cmd = COMMANDS[cmdPart];
        if (parts.length >= 2 && cmd && (cmd.needsSecurity || cmd.optionalSecurity)) {
            var secQuery = parts.slice(1).join(' ');
            if (secQuery) {
                searchSecurities(secQuery, function (results) {
                    renderCmdSecurityDropdown(results, cmdPart);
                });
            } else {
                hideCmdDropdown();
            }
            return;
        }

        var matches = Object.keys(COMMANDS).filter(function (name) {
            if (!cmdPart || name.startsWith(cmdPart)) return true;
            var cmd2 = COMMANDS[name];
            if (cmd2.aliases) {
                return cmd2.aliases.some(function (a) { return a.startsWith(cmdPart); });
            }
            return false;
        });

        // If no commands match, fall back to security search
        if (matches.length === 0 && cmdPart) {
            searchSecurities(raw, function (results) {
                renderCmdSecurityDropdown(results, 'info');
            });
            return;
        }

        renderCmdDropdown(matches);
    }

    // Stashed when y/p on a watchlist row opens the picker. The :watch dropdown
    // and Enter handler read this to decide whether to copy (leave in source)
    // or move (also delete from source).
    var watchOpMode = null;       // null | 'copy' | 'move'
    var watchOpSourceSymbol = ''; // the row symbol that triggered y/p
    var watchOpSourceListId = 0;  // active watchlist id at the time

    function openWatchPicker(mode, symbol) {
        watchOpMode = mode;
        watchOpSourceSymbol = symbol;
        watchOpSourceListId = getActiveWatchlistId();
        var input = document.getElementById('cmd-input');
        input.value = ':watch ';
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        renderCmdWatchlistDropdown('');
    }

    function clearWatchOp() {
        watchOpMode = null;
        watchOpSourceSymbol = '';
        watchOpSourceListId = 0;
    }

    function renderCmdWatchlistDropdown(query) {
        var dropdown = document.getElementById('cmd-dropdown');
        var input = document.getElementById('cmd-input');
        var q = (query || '').toLowerCase();
        var matches = (watchlistData || []).filter(function (wl) {
            return !q || wl.name.toLowerCase().indexOf(q) >= 0;
        });
        // Prefix-matches first, then substring-matches; preserve declared order otherwise
        matches.sort(function (a, b) {
            var ap = a.name.toLowerCase().indexOf(q) === 0 ? 0 : 1;
            var bp = b.name.toLowerCase().indexOf(q) === 0 ? 0 : 1;
            if (ap !== bp) return ap - bp;
            return 0;
        });

        // Mode determines what the row description reads as. y/p stash sets
        // mode='copy'/'move' and watchOpSourceSymbol; default is 'add' which
        // uses the picker's selected security.
        var sym = watchOpMode ? watchOpSourceSymbol : (selectedSecurity || '');
        var verb = watchOpMode === 'copy' ? 'copy' : (watchOpMode === 'move' ? 'move' : 'add');
        var noSymLabel = 'no security selected — press s first';

        if (matches.length === 0) {
            dropdown.innerHTML = '<div class="cmd-option cmd-option-empty">No watchlist matches "' + escapeHtml(query) + '"</div>';
            dropdown.classList.remove('hidden');
            cmdDropdownIndex = -1;
            return;
        }

        dropdown.innerHTML = matches.map(function (wl) {
            var desc = sym ? verb + ' ' + sym + ' to ' + wl.name + ' watchlist' : noSymLabel;
            return '<div class="cmd-option cmd-watchlist-option" data-watchlist-id="' + wl.id + '" data-watchlist-name="' + escapeHtml(wl.name) + '">'
                + '<span class="cmd-option-usage" style="color:' + escapeHtml(wl.color || '#ff8800') + '">' + escapeHtml(verb) + ' ' + escapeHtml(wl.name) + '</span>'
                + '<span class="cmd-option-desc">' + escapeHtml(desc) + '</span>'
                + '</div>';
        }).join('');
        dropdown.classList.remove('hidden');
        cmdDropdownIndex = -1;

        dropdown.querySelectorAll('.cmd-watchlist-option').forEach(function (el) {
            el.onmousedown = function (e) {
                e.preventDefault();
                executeWatchCommand(parseInt(el.dataset.watchlistId, 10), el.dataset.watchlistName);
                input.value = '';
                hideCmdDropdown();
                enterNormalMode();
            };
        });
    }

    // Execute a watchlist command per current mode:
    //   default → add picker selection to <name>
    //   copy    → add the source row's symbol to <name>, leave it in source
    //   move    → add to <name>, then remove from source
    function executeWatchCommand(watchlistId, watchlistName) {
        // y/p modes use the stashed source symbol, not the picker selection.
        if (watchOpMode === 'copy' || watchOpMode === 'move') {
            var sym = watchOpSourceSymbol;
            var srcId = watchOpSourceListId;
            var mode = watchOpMode;
            addToWatchlist(watchlistId, sym);
            subscribeSecurity(sym);
            if (mode === 'move' && srcId && srcId !== watchlistId) {
                fetch('/api/watchlists/' + srcId + '/symbols/' + encodeURIComponent(sym), { method: 'DELETE' })
                    .then(function () { refreshWatchlistView(); });
                flashError('Moved ' + sym + ' to ' + watchlistName);
            } else {
                flashError((mode === 'copy' ? 'Copied ' : 'Added ') + sym + ' to ' + watchlistName);
                // Repaint borders + quote rows so the symbol picks up the destination
                // list's color when the user switches to that tab.
                if (currentView === 'watchlist') refreshWatchlistView();
            }
            clearWatchOp();
            return true;
        }
        if (!selectedSecurity) {
            flashError('No security selected — press s first');
            return false;
        }
        addToWatchlist(watchlistId, selectedSecurity);
        subscribeSecurity(selectedSecurity);
        flashError('Added ' + selectedSecurity + ' to ' + watchlistName);
        if (currentView === 'watchlist') refreshWatchlistView();
        return true;
    }

    // Resolve a `:watch <X>` argument: prefer matching a watchlist name (case-insensitive,
    // exact then prefix), fall back to treating X as a symbol added to the active list.
    function resolveWatchTarget(arg) {
        if (!arg) return null;
        var lower = arg.toLowerCase();
        var exact = (watchlistData || []).find(function (wl) { return wl.name.toLowerCase() === lower; });
        if (exact) return { type: 'watchlist', id: exact.id, name: exact.name };
        var prefix = (watchlistData || []).find(function (wl) { return wl.name.toLowerCase().indexOf(lower) === 0; });
        if (prefix) return { type: 'watchlist', id: prefix.id, name: prefix.name };
        return { type: 'symbol', symbol: arg.toUpperCase() };
    }

    // Field list for :add SYMBOL.<prefix> autocomplete. Mirrors the rows we
    // render on the Financials tab. Extending: add the new field name here.
    var FIN_FIELDS = [
        // Income
        'revenue', 'costOfRevenue', 'grossProfit', 'researchAndDevelopmentExpenses',
        'sellingGeneralAndAdministrativeExpenses', 'operatingIncome', 'interestExpense',
        'incomeBeforeTax', 'incomeTaxExpense', 'ebitda', 'netIncome', 'eps',
        // Balance
        'totalAssets', 'totalCurrentAssets', 'cashAndCashEquivalents', 'shortTermInvestments',
        'netReceivables', 'inventory', 'goodwill', 'intangibleAssets', 'totalLiabilities',
        'totalCurrentLiabilities', 'shortTermDebt', 'longTermDebt', 'totalDebt',
        'totalStockholdersEquity', 'retainedEarnings',
        // Cash flow
        'operatingCashFlow', 'depreciationAndAmortization', 'stockBasedCompensation',
        'accountsReceivables', 'accountsPayables', 'netCashUsedForInvestingActivities',
        'netCashUsedProvidedByFinancingActivities', 'debtRepayment', 'capitalExpenditure',
        'freeCashFlow', 'netChangeInCash', 'dividendsPaid', 'commonStockRepurchased',
        // Non-statement fundamentals (key-metrics + ratios)
        'peRatio', 'priceToSalesRatio', 'priceToBookRatio', 'enterpriseValue',
        'evToSales', 'evToEBITDA', 'evToOperatingCashFlow', 'evToFreeCashFlow',
        'returnOnEquity', 'returnOnAssets', 'returnOnCapitalEmployed',
        'debtToEquity', 'debtToAssets', 'currentRatio', 'quickRatio',
        'dividendYield', 'payoutRatio',
        'grossProfitMargin', 'operatingProfitMargin', 'netProfitMargin',
        // Daily history (own endpoint)
        'marketCap',
        // Computed: rolling 1Y daily beta vs SPY
        'beta',
    ];

    function renderCmdFieldDropdown(symPart, fieldPrefix) {
        var dropdown = document.getElementById('cmd-dropdown');
        var p = (fieldPrefix || '').toLowerCase();
        var matches = FIN_FIELDS.filter(function (f) {
            return !p || f.toLowerCase().indexOf(p) >= 0;
        });
        // Prefix matches first
        matches.sort(function (a, b) {
            var ap = a.toLowerCase().indexOf(p) === 0 ? 0 : 1;
            var bp = b.toLowerCase().indexOf(p) === 0 ? 0 : 1;
            return ap - bp;
        });
        if (!matches.length) { hideCmdDropdown(); return; }
        var symLabel = (symPart || 'SYMBOL').toUpperCase();
        dropdown.innerHTML = matches.slice(0, 12).map(function (f) {
            return '<div class="cmd-option cmd-field-option" data-cmd="add" data-sym="' + escapeHtml(symLabel) + '" data-field="' + escapeHtml(f) + '">'
                + '<span class="cmd-option-usage">add ' + escapeHtml(symLabel) + '.' + escapeHtml(f) + '</span>'
                + '<span class="cmd-option-desc">project ' + escapeHtml(f) + ' onto current sketch</span>'
                + '</div>';
        }).join('');
        dropdown.classList.remove('hidden');
        cmdDropdownIndex = -1;

        dropdown.querySelectorAll('.cmd-field-option').forEach(function (el) {
            el.onmousedown = function (e) {
                e.preventDefault();
                var input = document.getElementById('cmd-input');
                input.value = ':add ' + el.dataset.sym + '.' + el.dataset.field;
                hideCmdDropdown();
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            };
        });
    }

    function renderCmdSketchDropdown(prefix) {
        var dropdown = document.getElementById('cmd-dropdown');
        // Prefer the live ideas.js cache if we're on /ideas, otherwise the
        // terminal-level cache. ensureSketchesLoaded fills the latter on first
        // `:add` keystroke and re-renders when it lands.
        var sketches;
        if (window._ideasGetSketches) {
            sketches = window._ideasGetSketches();
        } else if (sketchesLoaded) {
            sketches = sketchesData;
        } else {
            ensureSketchesLoaded().then(function () { renderCmdSketchDropdown(prefix); });
            sketches = [];
        }
        var p = (prefix || '').toLowerCase();
        var matches = sketches.filter(function (sk) {
            return !p || (sk.name || '').toLowerCase().indexOf(p) >= 0;
        });
        // No matches and the user typed a prefix: hint that Enter creates a new
        // sketch with that name (idea-create path, B3).
        if (!matches.length) {
            if (p) {
                dropdown.innerHTML = '<div class="cmd-option cmd-sketch-create-option" data-sketch-create="' + escapeHtml(prefix) + '">'
                    + '<span class="cmd-option-usage">create "' + escapeHtml(prefix) + '"</span>'
                    + '<span class="cmd-option-desc">no match — Enter creates this sketch and adds the metric</span>'
                    + '</div>';
            } else {
                dropdown.innerHTML = '<div class="cmd-option cmd-option-empty">No saved sketches yet — Enter creates one with this name</div>';
            }
            dropdown.classList.remove('hidden');
            cmdDropdownIndex = -1;
            return;
        }
        // 5-recent cap when no prefix typed; loosens when filtering.
        var cap = p ? 12 : 5;
        dropdown.innerHTML = matches.slice(0, cap).map(function (sk) {
            return '<div class="cmd-option cmd-sketch-option" data-sketch-name="' + escapeHtml(sk.name) + '">'
                + '<span class="cmd-option-usage">to ' + escapeHtml(sk.name) + '</span>'
                + '<span class="cmd-option-desc">add to that saved sketch</span>'
                + '</div>';
        }).join('');
        dropdown.classList.remove('hidden');
        cmdDropdownIndex = -1;

        dropdown.querySelectorAll('.cmd-sketch-option').forEach(function (el) {
            el.onmousedown = function (e) {
                e.preventDefault();
                var input = document.getElementById('cmd-input');
                var existing = input.value;
                var toIdx = existing.toLowerCase().lastIndexOf(' to ');
                if (toIdx > 0) {
                    input.value = existing.substring(0, toIdx + 4) + el.dataset.sketchName;
                } else {
                    input.value = existing.replace(/\s+$/, '') + ' to ' + el.dataset.sketchName;
                }
                hideCmdDropdown();
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
            };
        });
    }

    function renderCmdSecurityDropdown(results, cmdName) {
        var dropdown = document.getElementById('cmd-dropdown');
        // Guard against stale debounced fires that come back after the user has
        // typed past the search prefix (e.g. now on :watch ...).
        var currentInput = document.getElementById('cmd-input');
        if (currentInput && currentInput.value.trim().toLowerCase().indexOf(':watch') === 0) {
            return;
        }
        if (!results || results.length === 0) {
            hideCmdDropdown();
            return;
        }
        dropdown.innerHTML = results.map(function (r) {
            return '<div class="cmd-option cmd-security-option" data-cmd="' + cmdName + '" data-symbol="' + escapeHtml(r.symbol) + '">'
                + '<span class="cmd-option-usage">' + escapeHtml(r.symbol) + '</span>'
                + '<span class="cmd-option-desc">' + escapeHtml(r.name) + ' · ' + escapeHtml(r.exchange) + '</span>'
                + '</div>';
        }).join('');
        dropdown.classList.remove('hidden');
        cmdDropdownIndex = -1;

        dropdown.querySelectorAll('.cmd-security-option').forEach(function (el) {
            el.onmousedown = function (e) {
                e.preventDefault();
                var input = document.getElementById('cmd-input');
                hideCmdDropdown();
                setSecurity(el.dataset.symbol);
                onViewLeave(currentView);
                navigate(el.dataset.cmd, el.dataset.symbol);
                input.value = '';
            };
        });
    }

    // ── Vim Mode ──

    var vimSelectedIndex = -1;
    var securityBeforeEdit = '';

    function isInsertMode() {
        var el = document.activeElement;
        return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    }

    function enterNormalMode() {
        if (document.activeElement) document.activeElement.blur();
        updateModeIndicator();
    }

    function updateModeIndicator() {
        var el = document.getElementById('vim-mode');
        if (!el) return;
        var mode = isInsertMode() ? 'insert' : 'normal';
        el.textContent = mode.toUpperCase();
        el.className = 'footer-mode ' + mode;
    }

    // Update indicator on focus/blur changes
    document.addEventListener('focusin', updateModeIndicator);
    document.addEventListener('focusout', function () {
        setTimeout(updateModeIndicator, 10);
    });

    function clearVimSelection() {
        document.querySelectorAll('.vim-selected').forEach(function (el) {
            el.classList.remove('vim-selected');
        });
        vimSelectedIndex = -1;
    }

    function vimSelect(items, index) {
        clearVimSelection();
        if (index < 0 || index >= items.length) return;
        vimSelectedIndex = index;
        items[index].classList.add('vim-selected');
        items[index].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    // ── Price preview slide-in ──
    //
    // Shared by /watchlist ('p' on a row) and the Sector tab on /security
    // ('p' on a peer row). Mirrors the financials preview pattern in info.js:
    // hijacks the article-reader slide-in, renders a 1-year EOD chart via
    // lightweight-charts, and disposes the chart on close so we don't leak.
    var pricePreviewChart = null;
    function disposePricePreviewChart() {
        if (pricePreviewChart) {
            try { pricePreviewChart.remove(); } catch (e) {}
            pricePreviewChart = null;
        }
    }

    window._closePricePreview = function () {
        var reader = document.getElementById('article-reader');
        if (!reader) return false;
        if (reader.dataset.mode !== 'price-chart') return false;
        disposePricePreviewChart();
        reader.classList.add('hidden');
        delete reader.dataset.mode;
        return true;
    };

    function openPricePreview(symbol) {
        if (!symbol) return;
        var reader = document.getElementById('article-reader');
        var readerTitle = document.getElementById('reader-title');
        var readerBody = document.getElementById('reader-body');
        if (!reader || !readerBody) return;
        reader.classList.remove('hidden');
        reader.dataset.mode = 'price-chart';
        if (readerTitle) readerTitle.textContent = symbol + ' — 1y';
        readerBody.innerHTML = '<div id="price-preview-host" style="width:100%;height:280px"></div>'
            + '<p id="price-preview-meta" class="empty-state" style="margin-top:8px"></p>';

        fetch('/api/historical/stock/' + encodeURIComponent(symbol))
            .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
            .then(function (rows) {
                if (!Array.isArray(rows) || rows.length === 0) {
                    readerBody.innerHTML = '<p class="empty-state">No price history for ' + symbol + '.</p>';
                    return;
                }
                // FMP returns descending — flip to ascending and trim to last
                // 252 trading days (~1y) so the preview stays snappy.
                var asc = rows.slice().reverse();
                if (asc.length > 252) asc = asc.slice(asc.length - 252);
                var series = asc.map(function (r) {
                    return { time: r.date, value: Number(r.price) };
                }).filter(function (p) { return p.time && !isNaN(p.value); });
                if (series.length === 0) {
                    readerBody.innerHTML = '<p class="empty-state">No usable points for ' + symbol + '.</p>';
                    return;
                }

                var host = document.getElementById('price-preview-host');
                if (!window.LightweightCharts || !host) return;
                disposePricePreviewChart();
                pricePreviewChart = LightweightCharts.createChart(host, {
                    layout: { background: { color: '#0a0a0a' }, textColor: '#888888', fontFamily: "'SF Mono','Consolas',monospace", fontSize: 10, attributionLogo: false },
                    grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
                    rightPriceScale: { borderColor: '#2a2a2a' },
                    timeScale: { borderColor: '#2a2a2a', timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
                    handleScale: false,
                    handleScroll: false,
                });
                var first = series[0].value;
                var last = series[series.length - 1].value;
                var color = last >= first ? '#00cc66' : '#ff4444';
                var line = pricePreviewChart.addSeries(LightweightCharts.LineSeries, {
                    color: color, lineWidth: 2,
                    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
                });
                line.setData(series);
                pricePreviewChart.timeScale().fitContent();

                var pct = first > 0 ? ((last - first) / first) * 100 : 0;
                var sign = pct >= 0 ? '+' : '';
                var meta = document.getElementById('price-preview-meta');
                if (meta) {
                    meta.textContent = symbol + ' · '
                        + series.length + 'd · '
                        + first.toFixed(2) + ' → ' + last.toFixed(2)
                        + ' (' + sign + pct.toFixed(1) + '%)';
                    meta.style.color = color;
                }
            })
            .catch(function () {
                readerBody.innerHTML = '<p class="empty-state">Failed to load price history for ' + symbol + '.</p>';
            });
    }

    // ── Per-View Vim Handlers ──

    var vimHandlers = {
        ideas: {
            move: function (dir) {
                if (window._ideasMove) window._ideasMove(dir);
            },
            activate: function () {
                if (window._ideasActivate) window._ideasActivate();
            },
            deleteSelected: function () {
                return window._ideasDeleteSelected ? window._ideasDeleteSelected() : false;
            },
            toggleHelp: function () {
                if (window._ideasToggleHelp) window._ideasToggleHelp();
            },
        },
        economics: {
            // Directional nav owned by vim-nav.js (see economics.html for the
            // data-vim-row markup). Per-view handler retains only the legacy
            // keys that fall through the core: `/` to focus filter, plus the
            // p/g/a handlers wired below via window._economicsOpenPreview etc.
            focusFilter: function () { if (window._economicsFocusFilter) window._economicsFocusFilter(); },
        },
        watchlist: {
            getItems: function () {
                // Only visible rows (filtered by active watchlist)
                var all = document.querySelectorAll('#quote-body tr');
                return Array.from(all).filter(function (row) {
                    return row.style.display !== 'none';
                });
            },
            move: function (dir) {
                if (dir === 'h' || dir === 'l') {
                    // Switch between watchlists
                    if (watchlistData.length <= 1) return;
                    var idx = watchlistData.findIndex(function (wl) { return wl.id === activeWatchlistId; });
                    if (dir === 'l') idx = Math.min(idx + 1, watchlistData.length - 1);
                    else idx = Math.max(idx - 1, 0);
                    activeWatchlistId = watchlistData[idx].id;
                    localStorage.setItem('stocktopus-watchlist-id', activeWatchlistId);
                    renderWatchlistTabs();
                    renderWatchlistPicker();
                    filterWatchlistView();
                    clearVimSelection();
                    return;
                }
                var items = this.getItems();
                if (items.length === 0) return;
                if (dir === 'j') vimSelectedIndex = Math.min(vimSelectedIndex + 1, items.length - 1);
                else if (dir === 'k') vimSelectedIndex = Math.max(vimSelectedIndex - 1, 0);
                vimSelect(items, vimSelectedIndex);
            },
            activate: function () {
                var items = this.getItems();
                if (vimSelectedIndex < 0 || vimSelectedIndex >= items.length) return;
                var sym = items[vimSelectedIndex].querySelector('[data-symbol]');
                if (sym) {
                    setSecurity(sym.dataset.symbol);
                    onViewLeave(currentView);
                    navigate('info', sym.dataset.symbol);
                }
            },
            graph: function () {
                var items = this.getItems();
                if (vimSelectedIndex < 0 || vimSelectedIndex >= items.length) return;
                var sym = items[vimSelectedIndex].querySelector('[data-symbol]');
                if (sym) {
                    setSecurity(sym.dataset.symbol);
                    onViewLeave(currentView);
                    navigate('graph', sym.dataset.symbol);
                }
            },
            // ── Vim row ops (idea #12) ──
            //
            // Vim-faithful cut/paste model:
            //   d → cut (delete from source list, store symbol in buffer)
            //   p → paste from buffer to the *current* watchlist
            //   y → yank to another list via picker (does not delete source);
            //       on confirm the dest list re-renders so the new color sticks
            _selectedSymbol: function () {
                var items = this.getItems();
                if (vimSelectedIndex < 0 || vimSelectedIndex >= items.length) return null;
                var el = items[vimSelectedIndex].querySelector('[data-symbol]');
                return el ? el.dataset.symbol : null;
            },
            deleteSelected: function () {
                var sym = this._selectedSymbol();
                if (!sym) return false;
                var wlId = getActiveWatchlistId();
                fetch('/api/watchlists/' + wlId + '/symbols/' + encodeURIComponent(sym), { method: 'DELETE' })
                    .then(function () {
                        watchlistBuffer = sym;
                        flashError('Cut ' + sym + ' — press P to paste into another watchlist');
                        refreshWatchlistView();
                    })
                    .catch(function () { flashError('Remove failed'); });
                return true;
            },
            yankSelected: function () {
                var sym = this._selectedSymbol();
                if (!sym) return false;
                openWatchPicker('copy', sym);
                return true;
            },
            pasteSelected: function () {
                if (!watchlistBuffer) {
                    flashError('Buffer empty — d on a row to cut first');
                    return true; // consume the keypress so we don't fall through
                }
                var sym = watchlistBuffer;
                var dest = getActiveWatchlistId();
                addToWatchlist(dest, sym);
                subscribeSecurity(sym);
                watchlistBuffer = '';
                var name = (watchlistData.find(function (wl) { return wl.id === dest; }) || {}).name || 'watchlist';
                flashError('Pasted ' + sym + ' into ' + name);
                // addToWatchlist already calls loadWatchlists internally, but it
                // doesn't repaint quote rows. Force a full refresh.
                refreshWatchlistView();
                return true;
            },
            openPreview: function () {
                var sym = this._selectedSymbol();
                if (!sym) return false;
                openPricePreview(sym);
                return true;
            },
        },
        graph: {
            move: function (dir) {
                var chart = window._stocktopusChart;
                if (!chart) return;
                var ts = chart.timeScale();
                if (dir === 'h') ts.scrollToPosition(ts.scrollPosition() - 3, false);
                else if (dir === 'l') ts.scrollToPosition(ts.scrollPosition() + 3, false);
            },
            activate: function () {}
        },
        news: {
            getItems: function () { return document.querySelectorAll('#news-cards .news-card'); },
            getAllTabs: function () { return Array.from(document.querySelectorAll('#news-tabs .news-tab')); },
            getTabs: function () {
                return this.getAllTabs().filter(function (t) {
                    return !t.classList.contains('dimmed');
                });
            },
            move: function (dir) {
                if (dir === 'h' || dir === 'l') {
                    // Tab navigation
                    var tabs = this.getTabs();
                    if (tabs.length === 0) return;
                    var activeIdx = tabs.findIndex(function (t) { return t.classList.contains('active'); });
                    if (dir === 'l') activeIdx = Math.min(activeIdx + 1, tabs.length - 1);
                    else activeIdx = Math.max(activeIdx - 1, 0);
                    tabs[activeIdx].click();
                    clearVimSelection();
                    return;
                }
                // Card navigation
                var items = this.getItems();
                if (items.length === 0) return;
                if (dir === 'j') vimSelectedIndex = Math.min(vimSelectedIndex + 1, items.length - 1);
                else if (dir === 'k') vimSelectedIndex = Math.max(vimSelectedIndex - 1, 0);
                vimSelect(items, vimSelectedIndex);
            },
            jumpToTab: function (n) {
                var tabs = this.getAllTabs();
                if (n < 0 || n >= tabs.length) return;
                var tab = tabs[n];
                if (tab.classList.contains('dimmed')) return;
                tab.click();
                clearVimSelection();
            },
            activate: function () {
                var items = this.getItems();
                if (vimSelectedIndex < 0 || vimSelectedIndex >= items.length) return;
                var card = items[vimSelectedIndex];
                markNewsRead(card);
                var link = card.querySelector('.news-card-title a');
                if (link && window._openReader) {
                    window._openReader(link.href, link.textContent);
                }
            }
        },
        info: {
            // focus: 'main' = main tabs, 'sub' = sub-tabs, 'content' = scrolling
            _focus: 'main',
            getAllTabs: function () { return Array.from(document.querySelectorAll('#info-tabs .info-tab')); },
            getActiveTab: function () {
                var el = document.querySelector('#info-tabs .info-tab.active');
                return el ? el.dataset.tab : '';
            },
            hasSubTabs: function () {
                var tab = this.getActiveTab();
                if (tab === 'financials') return window._infoFinSubTabs && window._infoFinSubTabs().length > 0;
                if (tab === 'sec') return this.getSECSubTabs().length > 0;
                if (tab === 'news') return window._infoNewsSubTabs && window._infoNewsSubTabs().length > 0;
                return false;
            },
            getSECSubTabs: function () {
                return Array.from(document.querySelectorAll('#sec-filters .info-sub-tab'));
            },
            isNewsTab: function () { return this.getActiveTab() === 'news'; },
            isSectorTab: function () { return this.getActiveTab() === 'sector'; },
            isAITab: function () { return this.getActiveTab() === 'ai'; },
            isSECTab: function () { return this.getActiveTab() === 'sec'; },
            isFinTab: function () { return this.getActiveTab() === 'financials'; },
            getNewsCards: function () { return document.querySelectorAll('#info-content .news-card'); },
            getSectorItems: function () {
                // Peer rows + news items as one navigable list
                var rows = Array.from(document.querySelectorAll('.peer-row'));
                var newsItems = Array.from(document.querySelectorAll('.sector-news-item'));
                return rows.concat(newsItems);
            },
            move: function (dir) {
                var hasSub = this.hasSubTabs();

                if (dir === 'k') {
                    // AI tab: trading panel navigation
                    if (this._focus === 'content' && this.isAITab()) {
                        if (window._tradingVimHandler && window._tradingVimHandler(dir)) return;
                        clearVimSelection();
                        this._focus = 'main';
                        this._highlightFocus();
                        return;
                    }
                    // If on news tab in content mode, navigate cards up
                    if (this._focus === 'content' && this.isNewsTab()) {
                        if (vimSelectedIndex > 0) {
                            var cards = this.getNewsCards();
                            vimSelectedIndex = Math.max(vimSelectedIndex - 1, 0);
                            vimSelect(cards, vimSelectedIndex);
                            return;
                        }
                        // At top of cards, move focus back to main tabs
                        clearVimSelection();
                        this._focus = 'main';
                        this._highlightFocus();
                        return;
                    }
                    // Sector tab: navigate items up
                    if (this._focus === 'content' && this.isSectorTab()) {
                        if (vimSelectedIndex > 0) {
                            var items = this.getSectorItems();
                            vimSelectedIndex = Math.max(vimSelectedIndex - 1, 0);
                            vimSelect(items, vimSelectedIndex);
                            return;
                        }
                        clearVimSelection();
                        this._focus = 'main';
                        this._highlightFocus();
                        return;
                    }
                    // Move up through layers: content → sub → main
                    if (this._focus === 'content') {
                        var content = document.getElementById('info-content');
                        if (content && content.scrollTop > 0) {
                            content.scrollTop -= 60;
                            return;
                        }
                        this._focus = hasSub ? 'sub' : 'main';
                    } else if (this._focus === 'sub') {
                        this._focus = 'main';
                    }
                    this._highlightFocus();
                    return;
                }
                if (dir === 'j') {
                    // Move down through layers: main → sub → content
                    if (this._focus === 'main' && hasSub) {
                        this._focus = 'sub';
                        this._highlightFocus();
                        return;
                    }
                    // Go straight to content (skip focus-only transition)
                    this._focus = 'content';
                    this._highlightFocus();
                    if (this.isAITab()) {
                        if (window._tradingVimHandler) window._tradingVimHandler(dir);
                        return;
                    }
                    if (this.isNewsTab()) {
                        var cards = this.getNewsCards();
                        if (cards.length > 0) {
                            vimSelectedIndex = Math.min(vimSelectedIndex + 1, cards.length - 1);
                            vimSelect(cards, vimSelectedIndex);
                        }
                    } else if (this.isSectorTab()) {
                        var items = this.getSectorItems();
                        if (items.length > 0) {
                            vimSelectedIndex = Math.min(vimSelectedIndex + 1, items.length - 1);
                            vimSelect(items, vimSelectedIndex);
                        }
                    } else {
                        var content = document.getElementById('info-content');
                        if (content) content.scrollTop += 60;
                    }
                    return;
                }
                if (dir === 'h' || dir === 'l') {
                    if (this._focus === 'sub' && hasSub) {
                        var subTabs;
                        if (this.isSECTab()) subTabs = this.getSECSubTabs();
                        else if (this.isNewsTab() && window._infoNewsSubTabs) subTabs = window._infoNewsSubTabs();
                        else subTabs = window._infoFinSubTabs ? window._infoFinSubTabs() : [];
                        var activeIdx = subTabs.findIndex(function (t) { return t.classList.contains('active'); });
                        if (dir === 'l') activeIdx = Math.min(activeIdx + 1, subTabs.length - 1);
                        else activeIdx = Math.max(activeIdx - 1, 0);
                        subTabs[activeIdx].click();
                        return;
                    }
                    // Main tabs
                    this._focus = 'main';
                    var tabs = this.getAllTabs();
                    if (tabs.length === 0) return;
                    var activeIdx = tabs.findIndex(function (t) { return t.classList.contains('active'); });
                    if (dir === 'l') activeIdx = Math.min(activeIdx + 1, tabs.length - 1);
                    else activeIdx = Math.max(activeIdx - 1, 0);
                    tabs[activeIdx].click();
                    this._highlightFocus();
                    return;
                }
            },
            _highlightFocus: function () {
                // Visual indicator of which tab row has focus
                var mainTabs = document.getElementById('info-tabs');
                var finSubTabs = document.getElementById('fin-sub-tabs');
                var secSubTabs = document.getElementById('sec-filters');
                var newsSubTabs = document.getElementById('news-sub-tabs');
                if (mainTabs) mainTabs.classList.toggle('tab-row-focused', this._focus === 'main');
                if (finSubTabs) finSubTabs.classList.toggle('tab-row-focused', this._focus === 'sub');
                if (secSubTabs) secSubTabs.classList.toggle('tab-row-focused', this._focus === 'sub');
                if (newsSubTabs) newsSubTabs.classList.toggle('tab-row-focused', this._focus === 'sub');
            },
            jumpToTab: function (n) {
                this._focus = 'main';
                if (window._infoJumpToTab) window._infoJumpToTab(n);
                this._highlightFocus();
            },
            jumpToSubTab: function (n) {
                if (!this.hasSubTabs()) return;
                this._focus = 'sub';
                // Route per active tab — different sub-tab universes per tab.
                if (this.isNewsTab() && window._infoNewsJumpToSub) window._infoNewsJumpToSub(n);
                else if (window._infoFinJumpToSub) window._infoFinJumpToSub(n);
                this._highlightFocus();
            },
            refresh: function () {
                if (window._infoRefresh) window._infoRefresh();
            },
            activate: function () {
                if (this.isSECTab()) {
                    if (window._secActivate) window._secActivate();
                    return;
                }
                if (this.isAITab()) {
                    if (window._tradingVimHandler) window._tradingVimHandler('Enter');
                    return;
                }
                if (this.isNewsTab()) {
                    var cards = this.getNewsCards();
                    if (vimSelectedIndex >= 0 && vimSelectedIndex < cards.length) {
                        var link = cards[vimSelectedIndex].querySelector('.news-card-title a');
                        if (link && window._openReader) window._openReader(link.href, link.textContent);
                    }
                } else if (this.isSectorTab()) {
                    var items = this.getSectorItems();
                    if (vimSelectedIndex >= 0 && vimSelectedIndex < items.length) {
                        var el = items[vimSelectedIndex];
                        // If it's a news item, open reader
                        if (el.dataset.url && window._openReader) {
                            window._openReader(el.dataset.url, el.dataset.title || '');
                        }
                        // If it's a peer row, go to info
                        else if (el.dataset.symbol && window._navigateToSecurity) {
                            window._navigateToSecurity(el.dataset.symbol);
                        }
                    }
                }
            },
            // Sector: i→info, g→graph for selected peer
            sectorNav: function (action) {
                if (!this.isSectorTab()) return;
                var items = this.getSectorItems();
                if (vimSelectedIndex < 0 || vimSelectedIndex >= items.length) return;
                var el = items[vimSelectedIndex];
                var sym = el.dataset.symbol;
                if (!sym) return;
                if (action === 'info' && window._navigateToSecurity) window._navigateToSecurity(sym);
                if (action === 'graph' && window._navigateToGraph) window._navigateToGraph(sym);
                if (action === 'preview') openPricePreview(sym);
            }
        },
        ei: {
            _colFocus: 'row', // 'row' or 'spark'
            getItems: function () {
                return Array.from(document.querySelectorAll('.idx-row'));
            },
            move: function (dir) {
                var items = this.getItems();
                if (items.length === 0) return;
                if (dir === 'j') vimSelectedIndex = Math.min(vimSelectedIndex + 1, items.length - 1);
                else if (dir === 'k') vimSelectedIndex = Math.max(vimSelectedIndex - 1, 0);
                else if (dir === 'h') this._colFocus = 'row';
                else if (dir === 'l') this._colFocus = 'spark';
                vimSelect(items, vimSelectedIndex);
                this._updateColHighlight(items);
            },
            _updateColHighlight: function (items) {
                // Remove all spark highlights
                document.querySelectorAll('.idx-spark-selected').forEach(function (el) {
                    el.classList.remove('idx-spark-selected');
                });
                if (this._colFocus === 'spark' && vimSelectedIndex >= 0 && items[vimSelectedIndex]) {
                    var sparkCell = items[vimSelectedIndex].querySelector('.idx-spark');
                    if (sparkCell) sparkCell.classList.add('idx-spark-selected');
                }
            },
            activate: function () {
                var items = this.getItems();
                if (vimSelectedIndex < 0 || vimSelectedIndex >= items.length) return;
                var sym = items[vimSelectedIndex].dataset.symbol;
                if (!sym) return;
                if (this._colFocus === 'spark') {
                    // Sparkline selected → open graph
                    setSecurity(sym);
                    if (window._navigateToGraph) window._navigateToGraph(sym);
                } else {
                    // Row selected → open index info page
                    setSecurity(sym);
                    if (window._navigateToSecurity) window._navigateToSecurity(sym);
                }
            }
        },
        debug: {
            move: function (dir) {
                var console = document.getElementById('debug-console');
                if (!console) return;
                if (dir === 'j') console.scrollTop += 60;
                else if (dir === 'k') console.scrollTop -= 60;
            },
            activate: function () {}
        },
        screener: {
            // Two-pane navigation: filters (left) and results (right).
            // j/k moves within the focused pane; h/l flips focus between them.
            // Enter focuses an input (filters) or opens /security/{sym} (results).
            // 'r' triggers the Run Screen button — refresh semantics.
            _focus: 'filters',
            _filterIdx: 0,
            _resultIdx: 0,
            getFilters: function () {
                return Array.from(document.querySelectorAll(
                    '#screener-form input:not([type=hidden]), #screener-form select, #screener-form button'
                ));
            },
            getResults: function () {
                return Array.from(document.querySelectorAll('#screener-table tbody tr'))
                    .filter(function (row) {
                        // Skip the empty-state placeholder row.
                        return !row.querySelector('.empty-state');
                    });
            },
            move: function (dir) {
                if (dir === 'h') {
                    this._focus = 'filters';
                    if (this._filterIdx < 0) this._filterIdx = 0;
                    this._applyFocus();
                    return;
                }
                if (dir === 'l') {
                    // Only move to results if there ARE results — otherwise
                    // h/l would silently do nothing and confuse the user.
                    if (this.getResults().length > 0) {
                        this._focus = 'results';
                        if (this._resultIdx < 0) this._resultIdx = 0;
                        this._applyFocus();
                    }
                    return;
                }
                if (this._focus === 'filters') {
                    var items = this.getFilters();
                    if (items.length === 0) return;
                    if (this._filterIdx < 0) this._filterIdx = 0;
                    if (dir === 'j') this._filterIdx = Math.min(this._filterIdx + 1, items.length - 1);
                    else if (dir === 'k') this._filterIdx = Math.max(this._filterIdx - 1, 0);
                } else {
                    var rows = this.getResults();
                    if (rows.length === 0) {
                        // Results emptied (e.g. reset) — fall back to filters.
                        this._focus = 'filters';
                        this._applyFocus();
                        return;
                    }
                    if (this._resultIdx < 0) this._resultIdx = 0;
                    if (dir === 'j') this._resultIdx = Math.min(this._resultIdx + 1, rows.length - 1);
                    else if (dir === 'k') this._resultIdx = Math.max(this._resultIdx - 1, 0);
                }
                this._applyFocus();
            },
            activate: function () {
                if (this._focus === 'filters') {
                    var items = this.getFilters();
                    var el = items[this._filterIdx];
                    if (!el) return;
                    if (el.tagName === 'BUTTON') {
                        el.click();
                    } else {
                        // Focus the input — user is now in insert mode editing
                        // the value. Escape returns to normal.
                        el.focus();
                        if (el.select) el.select();
                    }
                } else {
                    var rows = this.getResults();
                    var row = rows[this._resultIdx];
                    if (!row) return;
                    var link = row.querySelector('a[href]');
                    if (link) window.location.href = link.href;
                }
            },
            refresh: function () {
                // 'r' re-runs the screener.
                var btn = document.getElementById('screener-run');
                if (btn) btn.click();
            },
            _applyFocus: function () {
                document.querySelectorAll('.vim-selected').forEach(function (e) {
                    e.classList.remove('vim-selected');
                });
                var el;
                if (this._focus === 'filters') {
                    el = this.getFilters()[this._filterIdx];
                } else {
                    el = this.getResults()[this._resultIdx];
                }
                if (el) {
                    el.classList.add('vim-selected');
                    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                }
            },
        }
    };

    // ── Global Keydown ──

    // Pending 'g' for vim-style 'gg' detection. Single g fires the legacy
    // graph-jump after 500ms; second g within the window jumps to top of
    // page via VimNav.
    var pendingGTimer = null;

    // fireLegacyG runs the historical graph-jump dispatch — used both
    // when no vim-nav grid is present and on gg timeout.
    function fireLegacyG(handler) {
        if (currentView === 'economics' && window._economicsSelectedIdentifier) {
            var id = window._economicsSelectedIdentifier();
            if (id) { navigate('graph', id, { skipSecurity: true }); return; }
        }
        // Financials row → chart is now bound to 'c' (see case 'c' below).
        // 'g' on financials no longer triggers it — was confusing muscle-memory
        // alongside the page-level 'g' for graph-jump on other views.
        if (handler && handler.sectorNav) handler.sectorNav('graph');
        else if (handler && handler.graph) handler.graph();
    }

    // Use capture phase to intercept keys before browser extensions (e.g. Vimium)
    document.addEventListener('keydown', function (e) {
        var active = document.activeElement;
        var insert = isInsertMode();

        // Escape toggles: insert → normal, normal → insert (focus command bar)
        if (e.key === 'Escape') {
            e.preventDefault();
            if (insert) {
                // If in security input, restore previous value
                var secInput = document.getElementById('security-input');
                if (active === secInput) {
                    secInput.value = securityBeforeEdit;
                    document.getElementById('security-dropdown').classList.add('hidden');
                }
                // If in cmd input, close dropdown
                if (active === document.getElementById('cmd-input')) {
                    var dd = document.getElementById('cmd-dropdown');
                    if (!dd.classList.contains('hidden')) {
                        hideCmdDropdown();
                    }
                }
                enterNormalMode();
            } else {
                // Normal mode: close reader first, then focus command bar.
                // Dispatch the right close function by the reader's mode so
                // chart instances get disposed properly (memory leak otherwise).
                var reader = document.getElementById('article-reader');
                if (reader && !reader.classList.contains('hidden')) {
                    var mode = reader.dataset.mode;
                    if (mode === 'fin-chart' && window._finCloseChart) window._finCloseChart();
                    else if (mode === 'eco-chart' && window._economicsClosePreview) window._economicsClosePreview();
                    else if (mode === 'price-chart' && window._closePricePreview) window._closePricePreview();
                    else reader.classList.add('hidden');
                    return;
                }
                document.getElementById('cmd-input').focus();
            }
            return;
        }

        // In insert mode, let the input handle everything
        if (insert) return;

        // ── Normal Mode Keys ──

        var handler = vimHandlers[currentView];

        // Declarative vim-nav takes precedence whenever the page has any
        // [data-vim-row] elements. It owns j/k/h/l/w/b/G/1-9/Enter and
        // handles gg via a 500ms timer; legacy keys (g, a, d, y, p, etc.)
        // fall through so per-view handlers keep firing.
        //
        // Reader/dropdown modal hijacks remain below this point — they
        // take precedence over BOTH the new core and the legacy handlers.
        if (window.VimNav) {
            // Don't claim h/j/k/l when a modal hijacker would steal them
            // anyway. Currently only the article reader does this.
            var readerOpen = false;
            var readerEl = document.getElementById('article-reader');
            if (readerEl && !readerEl.classList.contains('hidden')) readerOpen = true;
            if (!readerOpen && window.VimNav.handleKey(e.key, e)) return;
        }

        switch (e.key) {
            case '/':
                // Per-vim convention `/` is a *filter*, not the command bar
                // (use `:` for that). Only views that expose a filter input
                // claim it; other views drop the key.
                if (handler && handler.focusFilter) {
                    e.preventDefault();
                    handler.focusFilter();
                }
                return;
            case 's':
                e.preventDefault();
                var secInput = document.getElementById('security-input');
                securityBeforeEdit = secInput.value;
                secInput.value = '';
                secInput.focus();
                return;
            case ':':
                e.preventDefault();
                var cmdInput = document.getElementById('cmd-input');
                cmdInput.value = ':';
                cmdInput.focus();
                // Move cursor after the colon
                cmdInput.setSelectionRange(1, 1);
                return;
            case 'h':
            case 'j':
            case 'k':
            case 'l':
                e.preventDefault();
                // When the article-reader slide-in is open, capture nav keys so
                // we don't move the underlying tabs. j scrolls the reader; once
                // the body is scrolled to the bottom, j/k cycle through the
                // ticker chips at the foot of the article. k unwinds back to
                // scrolling. h/l also cycle chips when in chip-selection mode.
                var readerEl = document.getElementById('article-reader');
                if (readerEl && !readerEl.classList.contains('hidden')) {
                    handleReaderNav(e.key);
                    return;
                }
                if (handler && handler.move) handler.move(e.key);
                return;
            case 'Enter':
                e.preventDefault();
                // Reader chip activation takes priority when a chip is selected.
                if (window._readerInChipMode && window._readerInChipMode()) {
                    if (window._readerActivate) window._readerActivate();
                    return;
                }
                if (handler && handler.activate) handler.activate();
                return;
            case 'g':
                // Two-key 'gg' jumps to the first navigable element when
                // the page has a declarative vim-nav grid; otherwise (or
                // on a non-g second key / timeout) the legacy g handler
                // below fires. 500ms is vim's default.
                e.preventDefault();
                if (window.VimNav && window.VimNav.hasActiveGrid()) {
                    if (pendingGTimer !== null) {
                        clearTimeout(pendingGTimer);
                        pendingGTimer = null;
                        window.VimNav.selectFirst();
                        return;
                    }
                    pendingGTimer = setTimeout(function () {
                        pendingGTimer = null;
                        fireLegacyG(handler);
                    }, 500);
                    return;
                }
                fireLegacyG(handler);
                return;
            case 'G':
                e.preventDefault();
                if (window.VimNav && window.VimNav.hasActiveGrid()) {
                    window.VimNav.selectLast();
                }
                return;
            case 'r':
                e.preventDefault();
                if (handler && handler.refresh) handler.refresh();
                return;
            case '?':
                e.preventDefault();
                // Per-view help toggles; falls back to the security-info help.
                if (handler && handler.toggleHelp) { handler.toggleHelp(); return; }
                if (window._infoToggleHelp) window._infoToggleHelp();
                return;
            case 'd':
                // View-level delete: ideas removes the focused metric, watchlist
                // removes the selected symbol from the active list (idea #12).
                if (handler && handler.deleteSelected) {
                    if (handler.deleteSelected()) e.preventDefault();
                }
                return;
            case 'y':
                // Watchlist: copy selected symbol to another list (idea #12).
                if (handler && handler.yankSelected) {
                    if (handler.yankSelected()) e.preventDefault();
                }
                return;
            case 'i':
                if (handler && handler.sectorNav && handler.isSectorTab && handler.isSectorTab()) { e.preventDefault(); handler.sectorNav('info'); return; }
                if (handler && handler.jumpToSubTab) { e.preventDefault(); handler.jumpToSubTab(0); }
                return;
            case 'b':
                if (handler && handler.jumpToSubTab) { e.preventDefault(); handler.jumpToSubTab(1); }
                return;
            case 'c':
                // Watchlist: 'c' charts the selected security (was 'g' until
                // declarative vim-nav landed; rebound so the key matches the
                // action — c for chart). 'g' / 'gg' now only do nav.
                if (currentView === 'watchlist' && handler && handler.graph) {
                    e.preventDefault();
                    handler.graph();
                    return;
                }
                // Sector peers (security info → Sector tab): chart the
                // highlighted peer row.
                if (handler && handler.isSectorTab && handler.isSectorTab() && handler.sectorNav) {
                    e.preventDefault();
                    handler.sectorNav('graph');
                    return;
                }
                // Financials tab: 'c' on a highlighted metric opens the full
                // chart page for that metric (was historically 'g', moved here
                // so the key matches the action — 'c' for chart).
                if (handler && handler.isFinTab && handler.isFinTab()) {
                    var finRow = document.querySelector('.fin-row.vim-selected');
                    if (finRow && selectedSecurity) {
                        var finKey = finRow.dataset.finKey || '';
                        if (finRow.dataset.finFormat !== 'calc' && finKey && finKey.indexOf('/') < 0) {
                            e.preventDefault();
                            navigate('graph', selectedSecurity + '.' + finKey, { skipSecurity: true });
                            return;
                        }
                    }
                }
                // Otherwise: 'c' jumps to sub-tab index 2 (existing behaviour).
                if (handler && handler.jumpToSubTab) { e.preventDefault(); handler.jumpToSubTab(2); }
                return;
            case 'f':
                if (handler && handler.isSECTab && handler.isSECTab()) {
                    e.preventDefault();
                    if (window._secCycleFilter) window._secCycleFilter();
                }
                return;
            case 'p':
                // Watchlist: 'p' opens a price chart slide-in for the
                // highlighted symbol. Cut/paste 'p' moved to capital 'P' so
                // 'p' = preview is consistent across listings.
                if (currentView === 'watchlist' && handler && handler.openPreview) {
                    if (handler.openPreview()) { e.preventDefault(); return; }
                }
                // Sector peers: preview the highlighted peer's price chart.
                if (handler && handler.isSectorTab && handler.isSectorTab() && handler.sectorNav) {
                    e.preventDefault();
                    handler.sectorNav('preview');
                    return;
                }
                // /economics catalog: open 5-year slide-in chart preview.
                if (currentView === 'economics' && window._economicsOpenPreview) {
                    if (window._economicsOpenPreview('5y')) { e.preventDefault(); return; }
                }
                // Financials chart slide-in: toggle on the selected row.
                if (handler && handler.isFinTab && handler.isFinTab()) {
                    e.preventDefault();
                    if (window._finIsChartOpen && window._finIsChartOpen()) {
                        window._finCloseChart();
                    } else if (window._finOpenChart) {
                        window._finOpenChart();
                    }
                    return;
                }
                // /news: open the article reader (slide-in preview) on the
                // highlighted card. Same effect as Enter, mapped to 'p' for
                // muscle-memory parity with the 'p = preview' convention used
                // on economics + financials.
                if (currentView === 'news' && handler && handler.activate) {
                    e.preventDefault();
                    handler.activate();
                    return;
                }
                return;
            case 'P':
                // Watchlist cut/paste — paste the yanked symbol into the
                // current list. Capital P mirrors vim's "paste before" and
                // frees lowercase p for the preview action above.
                if (handler && handler.pasteSelected) {
                    if (handler.pasteSelected()) e.preventDefault();
                }
                return;
            case '\\':
                // Drop a horizontal price line on the sketchpad chart at the last
                // hovered crosshair value (or midpoint if the user hasn't hovered).
                if (currentView === 'ideas' && window._ideasDrawHline) {
                    e.preventDefault();
                    window._ideasDrawHline();
                }
                return;
            case 'z':
                // Toggle the reader between its slide-in width and full-width
                // expanded mode (more comfortable reading).
                var rdr = document.getElementById('article-reader');
                if (rdr && !rdr.classList.contains('hidden')) {
                    e.preventDefault();
                    rdr.classList.toggle('reader-expanded');
                }
                return;
            case 'a':
                // 'a' on a highlighted Financials row prefills :add SYMBOL.field
                // in the command bar so the user can confirm + send to the sketchpad.
                if (handler && handler.isFinTab && handler.isFinTab()) {
                    var row = document.querySelector('.fin-row.vim-selected');
                    if (row) {
                        var key = row.dataset.finKey || '';
                        if (row.dataset.finFormat === 'calc' || !key || key.indexOf('/') >= 0) return;
                        if (!selectedSecurity) return;
                        e.preventDefault();
                        var cmdInput = document.getElementById('cmd-input');
                        cmdInput.value = ':add ' + selectedSecurity + '.' + key;
                        cmdInput.focus();
                        cmdInput.setSelectionRange(cmdInput.value.length, cmdInput.value.length);
                    }
                }
                // 'a' on /economics catalog row prefills :add COUNTRY.CODE so
                // the user can stack multiple :add commands without leaving
                // the catalog — same UX as financials.
                if (currentView === 'economics' && window._economicsAddCmd) {
                    var prefilled = window._economicsAddCmd();
                    if (prefilled) {
                        e.preventDefault();
                        var ci = document.getElementById('cmd-input');
                        ci.value = prefilled;
                        ci.focus();
                        ci.setSelectionRange(ci.value.length, ci.value.length);
                    }
                }
                // 'a' on /screener result row prefills :add SYMBOL so the user
                // can confirm with Enter and pin it to the current sketch.
                // Only fires when focus is on the results list (not the filter pane).
                if (currentView === 'screener' && handler && handler._focus === 'results') {
                    var sRows = handler.getResults ? handler.getResults() : [];
                    var sRow = sRows[handler._resultIdx];
                    if (sRow) {
                        var link = sRow.querySelector('a[href]');
                        if (link) {
                            // Extract symbol from /security/{SYM} link path.
                            var href = link.getAttribute('href') || '';
                            var sym = href.replace(/^\/security\//, '').toUpperCase();
                            if (sym) {
                                e.preventDefault();
                                var sci = document.getElementById('cmd-input');
                                sci.value = ':add ' + sym;
                                sci.focus();
                                sci.setSelectionRange(sci.value.length, sci.value.length);
                            }
                        }
                    }
                }
                return;
            case '1': case '2': case '3': case '4': case '5': case '6': case '7':
                if (handler && handler.jumpToTab) {
                    e.preventDefault();
                    handler.jumpToTab(parseInt(e.key) - 1);
                }
                return;
            case '-':
                // Browser history back: only if there's actually somewhere to go to.
                // Close any open reader/chart slide-in first to keep behaviour predictable.
                e.preventDefault();
                if (window._closeReader) window._closeReader();
                if (history.state && history.length > 1) {
                    history.back();
                }
                return;
        }
    }, true); // capture phase — intercepts before Vimium and other extensions

    // ── Shared Article Reader ──

    window._openReader = function (url, title) {
        var reader = document.getElementById('article-reader');
        var readerBody = document.getElementById('reader-body');
        var readerTitle = document.getElementById('reader-title');
        if (!reader || !readerBody) return;

        reader.classList.remove('hidden');
        if (readerTitle) readerTitle.textContent = title || 'Loading...';

        // Always show source link at top
        var sourceLink = '<div class="reader-source"><a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">&#8599; ' + escapeHtml(url.replace(/^https?:\/\//, '').substring(0, 50)) + '</a></div>';
        readerBody.innerHTML = sourceLink + '<p style="color:var(--text-muted)">Loading article...</p>';

        fetch('/api/article?url=' + encodeURIComponent(url))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var hasContent = data.paragraphs && data.paragraphs.length > 0 && !data.error;
                var minWords = hasContent ? data.wordCount || 0 : 0;

                // If extraction failed or too little content
                if (!hasContent || minWords < 30) {
                    if (readerTitle) readerTitle.textContent = title || 'Article';
                    readerBody.innerHTML = sourceLink
                        + '<p class="reader-unavailable">Article content unavailable — <a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">open in browser</a></p>'
                        + '<div class="reader-related" id="reader-related"></div>';
                    findRelatedCompanies(title || '', document.getElementById('reader-related'));
                    return;
                }

                if (readerTitle) readerTitle.textContent = data.title || title || '';

                var botLabel = data.bot ? '<span class="reader-bot">' + escapeHtml(data.bot) + '</span>' : '';

                var html = sourceLink;
                html += '<div class="reader-meta">' + minWords + ' words ' + botLabel + '</div>';

                // Article text
                html += '<div class="reader-content">';
                data.paragraphs.forEach(function (p) {
                    var tag = (p.tag === 'h1' || p.tag === 'h2' || p.tag === 'h3') ? p.tag : 'p';
                    html += '<' + tag + '>' + escapeHtml(p.text) + '</' + tag + '>';
                });
                html += '</div>';

                // LLM status + entity badges — populated async
                html += '<div class="reader-llm-status" id="reader-llm-status"><span class="spinner"></span> Analyzing with LLM...</div>';
                html += '<div class="reader-entities" id="reader-entities"></div>';

                // Related section
                html += '<div class="reader-related" id="reader-related"></div>';

                readerBody.innerHTML = html;

                // Async: fetch LLM entities in background
                fetchArticleEntities(url);
            })
            .catch(function () {
                readerBody.innerHTML = sourceLink
                    + '<p class="reader-unavailable">Failed to load — <a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">open in browser</a></p>'
                    + '<div class="reader-related" id="reader-related"></div>';
                findRelatedCompanies(title || '', document.getElementById('reader-related'));
            });
    };

    function findRelatedCompanies(text, container) {
        if (!container || !text) return;

        // Only extract multi-word proper nouns (company names) and explicit ticker patterns ($AAPL)
        // Single capitalized words are too noisy (Grow, Small, etc.)
        var companyNames = text.match(/[A-Z][a-z]+(?:[\s\-&][A-Z][a-z]+)+/g) || [];
        var dollarTickers = text.match(/\$[A-Z]{1,5}\b/g) || [];
        // Also look for "Inc.", "Corp.", "Ltd." preceded by a name
        var incNames = text.match(/[A-Z][\w\-]+(?:\s+[A-Z][\w\-]+)*\s+(?:Inc|Corp|Ltd|LLC|Co|Group|Holdings|Technologies|Platforms|Systems)/g) || [];

        var candidates = [];
        var seen = {};

        // Dollar tickers first (highest signal)
        dollarTickers.forEach(function (t) {
            t = t.replace('$', '');
            if (!seen[t]) { seen[t] = true; candidates.push(t); }
        });

        // Company names with Inc/Corp (high signal)
        incNames.forEach(function (n) {
            n = n.trim();
            if (n.length > 3 && !seen[n]) { seen[n] = true; candidates.push(n); }
        });

        // Multi-word proper nouns (medium signal, only 2+ words)
        companyNames.forEach(function (n) {
            n = n.trim();
            if (n.length > 5 && n.split(/\s+/).length >= 2 && !seen[n]) {
                seen[n] = true;
                candidates.push(n);
            }
        });

        if (candidates.length === 0) return;

        // Search top candidates via FMP API
        var searches = candidates.slice(0, 6).map(function (q) {
            return fetch('/api/search?q=' + encodeURIComponent(q))
                .then(function (r) { return r.json(); })
                .then(function (results) { return { query: q, results: results || [] }; })
                .catch(function () { return { query: q, results: [] }; });
        });

        Promise.all(searches).then(function (allResults) {
            var found = {};
            allResults.forEach(function (sr) {
                // Only take the first result per query (most relevant)
                var top = (sr.results || []).find(function (r) {
                    return r.symbol && r.exchange !== 'CRYPTO' && !found[r.symbol];
                });
                if (top) {
                    found[top.symbol] = { symbol: top.symbol, name: top.name || '', exchange: top.exchange || '' };
                }
            });

            var symbols = Object.values(found);
            if (symbols.length === 0) return;

            var html = '<div class="reader-related-title">Related Securities</div>';
            html += '<div class="reader-related-list">';
            symbols.forEach(function (s) {
                html += '<span class="reader-ticker" onclick="if(window._navigateToSecurity)window._navigateToSecurity(\'' + escapeHtml(s.symbol) + '\')">'
                    + escapeHtml(s.symbol)
                    + '<span class="reader-related-name">' + escapeHtml(s.name).substring(0, 30) + '</span>'
                    + '</span>';
            });
            html += '</div>';
            container.innerHTML = html;
        });
    }

    var activeEntityURL = ''; // track which URL is being fetched

    function fetchArticleEntities(url) {
        activeEntityURL = url;

        var relatedEl = document.getElementById('reader-related');

        // First: quick client-side FMP search from title
        var readerTitle = document.getElementById('reader-title');
        if (readerTitle && readerTitle.textContent) {
            findRelatedCompanies(readerTitle.textContent, relatedEl);
        }

        // Then: async LLM entity extraction (can take 30-60s)
        var entityController = new AbortController();
        setTimeout(function () { entityController.abort(); }, 120000); // 2 min timeout
        fetch('/api/article/entities?url=' + encodeURIComponent(url), { signal: entityController.signal })
            .then(function (r) {
                if (!r.ok) {
                    console.error('Entity fetch HTTP error:', r.status);
                    throw new Error('HTTP ' + r.status);
                }
                return r.json();
            })
            .then(function (data) {
                // Ignore if user opened a different article
                if (activeEntityURL !== url) return;

                var statusEl = document.getElementById('reader-llm-status');
                var el = document.getElementById('reader-entities');

                if (data.status === 'pending') {
                    if (statusEl) statusEl.innerHTML = '<span class="spinner"></span> Waiting for LLM (another request in progress)...';
                    setTimeout(function () {
                        if (activeEntityURL === url) fetchArticleEntities(url);
                    }, 5000);
                    return;
                }

                var hasEntities = (data.tickers && data.tickers.length > 0) ||
                    (data.companies && data.companies.length > 0) ||
                    (data.people && data.people.length > 0);

                console.log('LLM entities received:', data.tickers, data.companies, data.people, 'statusEl:', !!statusEl, 'entitiesEl:', !!el);

                if (statusEl) {
                    if (hasEntities) {
                        var count = (data.tickers || []).length + (data.companies || []).length +
                            (data.people || []).length + (data.sectors || []).length;
                        statusEl.innerHTML = '<span style="color:var(--green)">&#10003;</span> LLM found ' + count + ' entities';
                        setTimeout(function () { if (statusEl) statusEl.style.display = 'none'; }, 3000);
                    } else {
                        statusEl.innerHTML = '<span style="color:var(--text-muted)">&#10003;</span> LLM analysis complete (no entities found)';
                        setTimeout(function () { if (statusEl) statusEl.style.display = 'none'; }, 3000);
                    }
                }

                if (!hasEntities || !el) return;

                var html = '';
                (data.tickers || []).forEach(function (t) {
                    html += '<span class="reader-ticker" onclick="if(window._navigateToSecurity)window._navigateToSecurity(\'' + escapeHtml(t) + '\')">' + escapeHtml(t) + '</span>';
                });
                (data.companies || []).forEach(function (c) {
                    html += '<span class="reader-company-badge">' + escapeHtml(c) + '</span>';
                });
                (data.people || []).forEach(function (p) {
                    html += '<span class="reader-person-badge">' + escapeHtml(p) + '</span>';
                });
                (data.sectors || []).forEach(function (s) {
                    html += '<span class="reader-sector-badge">' + escapeHtml(s) + '</span>';
                });
                el.innerHTML = html;
            })
            .catch(function (err) {
                console.error('Entity fetch error:', err);
                var statusEl = document.getElementById('reader-llm-status');
                if (statusEl) {
                    statusEl.innerHTML = '<span style="color:var(--text-muted)">LLM unavailable: ' + (err.message || err) + '</span>';
                    setTimeout(function () { if (statusEl) statusEl.style.display = 'none'; }, 5000);
                }
            });
    }

    window._closeReader = function () {
        var reader = document.getElementById('article-reader');
        if (!reader) return;
        if (window._finCloseChart) window._finCloseChart();
        reader.classList.remove('reader-expanded');
        reader.classList.add('hidden');
        readerChipIdx = -1;
    };

    // ── Reader keyboard navigation ──
    //
    // Two modes inside the open reader, switched implicitly:
    //   1. scroll  → j/k scroll the body; h/l absorbed
    //   2. chip    → j/k/h/l move selection across the ticker chips at the
    //                bottom; Enter navigates to /security/<symbol>; further
    //                k off the first chip drops back to scroll mode.
    // Transition: once the body is at-bottom, the first j enters chip mode.
    var readerChipIdx = -1;

    function getReaderChips() {
        return Array.from(document.querySelectorAll('#article-reader .reader-ticker'));
    }
    function highlightChip(idx) {
        var chips = getReaderChips();
        if (!chips.length) return;
        idx = Math.max(0, Math.min(idx, chips.length - 1));
        readerChipIdx = idx;
        chips.forEach(function (el, i) { el.classList.toggle('vim-selected', i === idx); });
        chips[idx].scrollIntoView({ block: 'nearest' });
    }
    function clearChipSelection() {
        getReaderChips().forEach(function (el) { el.classList.remove('vim-selected'); });
        readerChipIdx = -1;
    }
    function handleReaderNav(key) {
        var body = document.getElementById('reader-body');
        if (!body) return;
        var chips = getReaderChips();
        var atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 4;

        if (readerChipIdx >= 0) {
            // chip mode
            if (key === 'j' || key === 'l') { highlightChip(readerChipIdx + 1); return; }
            if (key === 'k') {
                if (readerChipIdx === 0) {
                    clearChipSelection();
                    body.scrollBy({ top: -80, behavior: 'smooth' });
                } else {
                    highlightChip(readerChipIdx - 1);
                }
                return;
            }
            if (key === 'h') { highlightChip(readerChipIdx - 1); return; }
            return;
        }
        // scroll mode
        if (key === 'j') {
            if (atBottom && chips.length) { highlightChip(0); return; }
            body.scrollBy({ top: 80, behavior: 'smooth' });
            return;
        }
        if (key === 'k') { body.scrollBy({ top: -80, behavior: 'smooth' }); return; }
        // h/l absorbed in scroll mode (no main-tab nav)
    }
    function activateReaderChip() {
        var chips = getReaderChips();
        if (readerChipIdx < 0 || readerChipIdx >= chips.length) return false;
        var chip = chips[readerChipIdx];
        // The chip's onclick already calls _navigateToSecurity — fire it.
        chip.click();
        return true;
    }
    // Expose so the keydown handler can dispatch Enter to chip activation.
    window._readerActivate = activateReaderChip;
    window._readerInChipMode = function () { return readerChipIdx >= 0; };

    // ── Browser History ──

    window.addEventListener('popstate', function (e) {
        var view = e.state && e.state.view;
        var sec = e.state && e.state.security;
        if (!view) {
            // Fallback: infer view from URL pathname when state was wiped
            // (e.g. by a replaceState that didn't carry state forward).
            var inferred = inferViewFromPath(location.pathname);
            if (inferred) {
                view = inferred.view;
                sec = inferred.security;
            }
        }
        if (view) {
            onViewLeave(currentView);
            navigate(view, sec, { fromHistory: true });
        }
    });

    function inferViewFromPath(pathname) {
        for (var name in COMMANDS) {
            var c = COMMANDS[name];
            if (c.path === pathname) return { view: name, security: '' };
            if (c.needsSecurity) {
                var template = c.path; // e.g. /security/{symbol}
                var prefix = template.substring(0, template.indexOf('{'));
                if (prefix && pathname.indexOf(prefix) === 0) {
                    return { view: name, security: pathname.substring(prefix.length) };
                }
            }
        }
        return null;
    }

    // ── Clocks ──

    var ZONES = [
        { label: 'ET',  tz: 'America/New_York' },
        { label: 'UTC', tz: 'UTC' },
        { label: 'UK',  tz: 'Europe/London' },
        { label: 'JST', tz: 'Asia/Tokyo' },
    ];

    function updateClock() {
        var el = document.getElementById('clock');
        if (!el) return;
        var now = new Date();
        el.innerHTML = ZONES.map(function (z) {
            var time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: z.tz, hour12: false });
            return '<span class="tz-block"><span class="tz-label">' + z.label + '</span> ' + time + '</span>';
        }).join('');
    }

    // ── Init ──

    // Expose navigation for info.js competitor links
    window._navigateToSecurity = function (sym) {
        setSecurity(sym);
        onViewLeave(currentView);
        navigate('info', sym);
    };

    // Send a message via the main WebSocket
    window._wsSend = function (msg) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    };

    window._navigateToGraph = function (sym) {
        setSecurity(sym);
        onViewLeave(currentView);
        navigate('graph', sym);
    };

    // ── Shared Company Panel ──
    // Renders price, change, and sparkline into a container element.
    // Used by info and news views.
    window._renderCompanyPanel = function (containerId, symbol) {
        var el = document.getElementById(containerId);
        if (!el || !symbol) return;

        el.innerHTML = '<span class="cpanel-sym">' + symbol + '</span>'
            + '<span id="cpanel-name" class="cpanel-name"></span>'
            + '<span id="cpanel-price" class="cpanel-price"></span>'
            + '<span id="cpanel-change" class="cpanel-change"></span>'
            + '<div class="cpanel-spark-wrap"><span class="cpanel-spark-label">6M</span><div id="cpanel-spark" class="cpanel-spark"></div></div>';

        // Make sparkline clickable
        var spark = document.getElementById('cpanel-spark');
        if (spark) {
            spark.style.cursor = 'pointer';
            spark.title = 'Open chart';
            spark.addEventListener('click', function () {
                localStorage.setItem('stocktopus-chart-range', '6M');
                if (window._navigateToGraph) window._navigateToGraph(symbol);
            });
        }

        // Fetch profile — falls back to EOD data for indices
        fetch('/api/security/' + symbol + '/profile')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data && data.length) {
                    var p = data[0];
                    setCpanelData(p.companyName || '', p.price, p.change, p.changePercentage);
                } else {
                    // Profile empty (index/crypto) — use EOD data
                    fetchCpanelFromEOD(symbol);
                }
            })
            .catch(function () { fetchCpanelFromEOD(symbol); });

        function fetchCpanelFromEOD(sym) {
            var from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
            var to = new Date().toISOString().slice(0, 10);
            fetch('/api/chart/eod/' + encodeURIComponent(sym) + '?from=' + from + '&to=' + to)
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (eod) {
                    if (!Array.isArray(eod) || eod.length < 1) return;
                    var latest = eod[eod.length - 1];
                    var prev = eod.length > 1 ? eod[eod.length - 2] : latest;
                    var chg = latest.close - prev.close;
                    var pct = (chg / prev.close) * 100;
                    // Try to get name from index list
                    fetch('/api/indices')
                        .then(function (r) { return r.json(); })
                        .then(function (indices) {
                            var idx = (indices || []).find(function (i) { return i.symbol === sym; });
                            setCpanelData(idx ? idx.name : sym, latest.close, chg, pct);
                        })
                        .catch(function () { setCpanelData(sym, latest.close, chg, pct); });
                })
                .catch(function () {});
        }

        function setCpanelData(name, price, change, changePct) {
            var nameEl = document.getElementById('cpanel-name');
            var priceEl = document.getElementById('cpanel-price');
            var changeEl = document.getElementById('cpanel-change');
            if (nameEl) nameEl.textContent = name;
            if (priceEl) priceEl.textContent = price ? price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '';
            if (changeEl) {
                var chg = change || 0;
                var chgPct = changePct || 0;
                changeEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + ' (' + chgPct.toFixed(2) + '%)';
                changeEl.className = 'cpanel-change ' + (chg >= 0 ? 'price-up' : 'price-down');
            }
        }

        // Skip sparkline if container has no-spark class
        if (!spark || el.classList.contains('no-spark')) return;

        function renderSpark() {
            if (!window.LightweightCharts) {
                // Retry — library may still be loading from fragment script
                setTimeout(renderSpark, 200);
                return;
            }
            loadSparkData();
        }

        function loadSparkData() {
            var from = new Date();
            from.setMonth(from.getMonth() - 6);
            var to = new Date();
            fetch('/api/chart/eod/' + symbol + '?from=' + from.toISOString().slice(0, 10) + '&to=' + to.toISOString().slice(0, 10))
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (data) {
                    if (!Array.isArray(data) || data.length < 2) return;
                    var first = data[0].close;
                    var last = data[data.length - 1].close;
                    var color = last >= first ? '#00cc66' : '#ff4444';

                    var chart = LightweightCharts.createChart(spark, {
                        width: 160, height: 40,
                        layout: { background: { color: 'transparent' }, textColor: 'transparent', attributionLogo: false },
                        grid: { vertLines: { visible: false }, horzLines: { visible: false } },
                        rightPriceScale: { visible: false },
                        timeScale: { visible: false },
                        handleScroll: false, handleScale: false,
                        crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
                    });
                    var series = chart.addSeries(LightweightCharts.AreaSeries, {
                        lineColor: color,
                        topColor: color.replace(')', ', 0.2)').replace('rgb', 'rgba'),
                        bottomColor: 'transparent',
                        lineWidth: 2,
                        priceLineVisible: false, lastValueVisible: false,
                    });
                    series.setData(data.map(function (d) { return { time: d.date, value: d.close }; }));
                    chart.timeScale().fitContent();

                    // Colour the 6M label to match the sparkline
                    var label = document.querySelector('.cpanel-spark-label');
                    if (label) label.style.color = color;
                });
        }

        renderSpark();
    };

    function init() {
        initCommandBar();
        initSecuritySelector();
        loadWatchlists(); // load persisted watchlists early
        loadFredCodes();  // for :add UNRATE autocomplete + parser fast-path
        connectWS();
        onViewEnter(currentView);
        updateClock();
        setInterval(updateClock, 1000);

        // Mouse clicks on buttons leave them DOM-focused, which Chrome paints
        // as :focus-visible — leaks an orange outline that lingers after h/l
        // navigates elsewhere. Blur immediately so selection state is purely
        // class-driven (.active / .vim-selected).
        document.addEventListener('click', function (e) {
            var btn = e.target.closest('button, [tabindex]');
            if (btn) btn.blur();
        });

        // Set initial history state
        history.replaceState({ view: currentView, security: selectedSecurity }, '');
    }

    try {
        init();
    } catch (e) {
        console.error('terminal.js init failed:', e);
        var el = document.getElementById('conn-status');
        if (el) { el.textContent = 'JS ERROR'; el.style.color = '#ff4444'; el.style.borderColor = '#ff4444'; }
    }
})();
