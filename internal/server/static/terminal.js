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

    // ── Commands ──

    const COMMANDS = {
        watchlist:  { path: '/watchlist',       needsSecurity: false, usage: 'watchlist',           desc: 'real-time price table for tracked securities' },
        graph:      { path: '/stock/{symbol}',  needsSecurity: true,  usage: 'graph <SECURITY>',    desc: 'show stock price chart for SECURITY' },
        info:       { path: '/security/{symbol}', needsSecurity: true, usage: 'info <SECURITY>',     desc: 'deep-dive company fundamentals for SECURITY' },
        news:       { path: '/news',            needsSecurity: false, usage: 'news [SECURITY]',     desc: 'market news — optionally filter by security', optionalSecurity: true },
        screener:   { path: '/screener',        needsSecurity: false, usage: 'screener',            desc: 'filter and scan stocks by criteria' },
        debug:      { path: '/debug',           needsSecurity: false, usage: 'debug',               desc: 'live server log console' },
    };

    function parseCommand(input) {
        const parts = input.trim().split(/\s+/);
        return { command: (parts[0] || '').toLowerCase(), args: parts.slice(1) };
    }

    // ── View Router ──

    async function navigate(command, security) {
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

        let path = cmd.path;
        if (cmd.needsSecurity) {
            resolved = resolved.toUpperCase();
            path = path.replace('{symbol}', resolved);
            setSecurity(resolved);
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

            // Execute any <script> tags in the loaded fragment (in order)
            var scripts = Array.from(container.querySelectorAll('script'));
            (function loadNext(i) {
                if (i >= scripts.length) return;
                var old = scripts[i];
                var s = document.createElement('script');
                if (old.src) {
                    s.src = old.src;
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

            history.pushState({ view: command, security: resolved }, '', path);

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

    // ── View Lifecycle ──

    function onViewEnter(view) {
        clearVimSelection();
        if (view === 'watchlist') initWatchlist();
        if (view === 'news') initNews();
        if (view === 'graph') initGraph();
        if (view === 'debug') initDebug();
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
            subscribedSecurities.forEach(function (sym) {
                ws.send(JSON.stringify({ type: 'subscribe', topic: 'quote:' + sym }));
            });
            // Resubscribe watchlist symbols
            resubscribeWatchlists();
            // Resubscribe to active news topic
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

    function initWatchlist() {
        const form = document.getElementById('add-security-form');
        if (form) {
            form.onsubmit = function (e) {
                e.preventDefault();
                const input = document.getElementById('wl-security-input');
                const sec = input.value.trim().toUpperCase();
                if (!sec) {
                    input.value = '';
                    return;
                }
                subscribeSecurity(sec);
                addToWatchlist(getActiveWatchlistId(), sec);
                input.value = '';
            };
        }

        // Fetch batch quotes immediately
        fetchWatchlistQuotes();
    }

    function fetchWatchlistQuotes() {
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
        fetch('/api/watchlists')
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

    function resubscribeWatchlists() {
        if (watchlistData.length > 0) {
            watchlistData.forEach(function (wl) {
                (wl.symbols || []).forEach(function (sym) {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'subscribe', topic: 'quote:' + sym }));
                    }
                });
            });
        }
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

        // Show/hide rows based on active watchlist
        var visibleCount = 0;
        tbody.querySelectorAll('tr').forEach(function (row) {
            var sym = row.querySelector('[data-symbol]');
            var symbol = sym ? sym.dataset.symbol : '';
            var inList = activeSymbols.indexOf(symbol) >= 0;
            row.style.display = inList ? '' : 'none';
            if (inList) visibleCount++;
        });

        if (empty) {
            empty.style.display = visibleCount > 0 ? 'none' : '';
            empty.textContent = visibleCount > 0 ? '' : 'No securities in this watchlist — use :watch to add';
        }
    }

    function getActiveWatchlistId() {
        return activeWatchlistId || (watchlistData.length > 0 ? watchlistData[0].id : 1);
    }

    function addToWatchlist(watchlistId, symbol) {
        fetch('/api/watchlists/' + (watchlistId || getActiveWatchlistId()) + '/symbols', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol: symbol }),
        }).then(function () {
            loadWatchlists(); // refresh
        }).catch(function (err) { console.error('Watch error:', err); });
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
                if (dropdownIndex >= 0 && items[dropdownIndex]) {
                    selectSecurity(items[dropdownIndex].dataset.symbol);
                } else {
                    const sec = input.value.trim().toUpperCase();
                    if (sec) selectSecurity(sec);
                }
                dropdown.classList.add('hidden');
            } else if (e.key === 'Escape') {
                dropdown.classList.add('hidden');
                document.getElementById('cmd-input').focus();
            }
        });

        input.addEventListener('blur', function () {
            setTimeout(function () { dropdown.classList.add('hidden'); }, 150);
        });
    }

    function selectSecurity(sec) {
        setSecurity(sec);
        // If on a security-dependent view, refresh it
        const cmd = COMMANDS[currentView];
        if (cmd && cmd.needsSecurity) {
            navigate(currentView, sec);
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
        if (!results || results.length === 0) {
            dropdown.classList.add('hidden');
            return;
        }
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
                if (cmdDropdownIndex >= 0 && items[cmdDropdownIndex]) {
                    var item = items[cmdDropdownIndex];
                    if (item.dataset.symbol) {
                        input.value = item.dataset.cmd + ' ' + item.dataset.symbol;
                    } else {
                        acceptCmdCompletion(item.dataset.cmd);
                    }
                } else if (items.length === 1) {
                    acceptCmdCompletion(items[0].dataset.cmd);
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                // If dropdown is visible and a security result is highlighted, execute it
                if (!dropdown.classList.contains('hidden') && cmdDropdownIndex >= 0 && items[cmdDropdownIndex]) {
                    var item = items[cmdDropdownIndex];
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

                    // :watch or :watch SYMBOL — add to watchlist
                    if (colonLower === 'watch' || colonLower.startsWith('watch ')) {
                        var watchArg = colonCmd.substring(5).trim().toUpperCase();
                        var watchSym = watchArg || selectedSecurity;
                        if (watchSym) {
                            addToWatchlist(getActiveWatchlistId(), watchSym);
                            subscribeSecurity(watchSym);
                            flashError('Added ' + watchSym + ' to watchlist');
                        } else {
                            flashError('Select a security first (s key)');
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

                    input.value = '';
                    enterNormalMode();
                    return;
                }

                commandHistory.push(raw);
                historyIndex = commandHistory.length;
                input.value = '';

                const parsed = parseCommand(raw);
                // If command not recognized, treat input as a security and go to info
                if (!COMMANDS[parsed.command]) {
                    var sec = raw.toUpperCase();
                    setSecurity(sec);
                    onViewLeave(currentView);
                    navigate('info', sec);
                    return;
                }
                const security = parsed.args[0] || '';
                onViewLeave(currentView);
                navigate(parsed.command, security);
            } else if (e.key === 'Escape') {
                if (!dropdown.classList.contains('hidden')) {
                    hideCmdDropdown();
                    e.stopPropagation();
                }
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
        var raw = value.trim();
        var parts = raw.split(/\s+/);
        var cmdPart = parts[0].toLowerCase();

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
            return !cmdPart || name.startsWith(cmdPart);
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

    function renderCmdSecurityDropdown(results, cmdName) {
        var dropdown = document.getElementById('cmd-dropdown');
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

    // ── Per-View Vim Handlers ──

    var vimHandlers = {
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
            }
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
                return this.getActiveTab() === 'financials' && window._infoFinSubTabs && window._infoFinSubTabs().length > 0;
            },
            isNewsTab: function () { return this.getActiveTab() === 'news'; },
            isSectorTab: function () { return this.getActiveTab() === 'sector'; },
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
                        var subTabs = window._infoFinSubTabs();
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
                var subTabs = document.getElementById('fin-sub-tabs');
                if (mainTabs) mainTabs.classList.toggle('tab-row-focused', this._focus === 'main');
                if (subTabs) subTabs.classList.toggle('tab-row-focused', this._focus === 'sub');
            },
            jumpToTab: function (n) {
                this._focus = 'main';
                if (window._infoJumpToTab) window._infoJumpToTab(n);
                this._highlightFocus();
            },
            jumpToSubTab: function (n) {
                if (this.hasSubTabs() && window._infoFinJumpToSub) {
                    this._focus = 'sub';
                    window._infoFinJumpToSub(n);
                    this._highlightFocus();
                }
            },
            refresh: function () {
                if (window._infoRefresh) window._infoRefresh();
            },
            activate: function () {
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
        }
    };

    // ── Global Keydown ──

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
                // Normal mode: close reader first, then focus command bar
                var reader = document.getElementById('article-reader');
                if (reader && !reader.classList.contains('hidden')) {
                    reader.classList.add('hidden');
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

        switch (e.key) {
            case '/':
                e.preventDefault();
                document.getElementById('cmd-input').focus();
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
                if (handler && handler.move) handler.move(e.key);
                return;
            case 'Enter':
                e.preventDefault();
                if (handler && handler.activate) handler.activate();
                return;
            case 'g':
                e.preventDefault();
                if (handler && handler.sectorNav) handler.sectorNav('graph');
                else if (handler && handler.graph) handler.graph();
                return;
            case 'r':
                e.preventDefault();
                if (handler && handler.refresh) handler.refresh();
                return;
            case '?':
                e.preventDefault();
                if (window._infoToggleHelp) window._infoToggleHelp();
                return;
            case 'i':
                if (handler && handler.sectorNav && handler.isSectorTab && handler.isSectorTab()) { e.preventDefault(); handler.sectorNav('info'); return; }
                if (handler && handler.jumpToSubTab) { e.preventDefault(); handler.jumpToSubTab(0); }
                return;
            case 'b':
                if (handler && handler.jumpToSubTab) { e.preventDefault(); handler.jumpToSubTab(1); }
                return;
            case 'c':
                if (handler && handler.jumpToSubTab) { e.preventDefault(); handler.jumpToSubTab(2); }
                return;
            case '1': case '2': case '3': case '4': case '5': case '6':
                if (handler && handler.jumpToTab) {
                    e.preventDefault();
                    handler.jumpToTab(parseInt(e.key) - 1);
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
        if (reader) reader.classList.add('hidden');
    };

    // ── Browser History ──

    window.addEventListener('popstate', function (e) {
        if (e.state && e.state.view) {
            onViewLeave(currentView);
            navigate(e.state.view, e.state.security);
        }
    });

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

        // Fetch profile
        fetch('/api/security/' + symbol + '/profile')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.length) return;
                var p = data[0];
                var nameEl = document.getElementById('cpanel-name');
                var priceEl = document.getElementById('cpanel-price');
                var changeEl = document.getElementById('cpanel-change');
                if (nameEl) nameEl.textContent = p.companyName || '';
                if (priceEl) priceEl.textContent = p.price ? p.price.toFixed(2) : '';
                if (changeEl) {
                    var chg = p.change || 0;
                    var chgPct = p.changePercentage || 0;
                    changeEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + ' (' + chgPct.toFixed(2) + '%)';
                    changeEl.className = 'cpanel-change ' + (chg >= 0 ? 'price-up' : 'price-down');
                }
            });

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
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (!data || data.length < 2) return;
                    var first = data[0].close;
                    var last = data[data.length - 1].close;
                    var color = last >= first ? '#00cc66' : '#ff4444';

                    var chart = LightweightCharts.createChart(spark, {
                        width: 160, height: 40,
                        layout: { background: { color: 'transparent' }, textColor: 'transparent' },
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
        connectWS();
        onViewEnter(currentView);
        updateClock();
        setInterval(updateClock, 1000);

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
