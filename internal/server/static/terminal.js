// Stocktopus Terminal — command bar, view router, WebSocket manager, security selector

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
        if (view === 'debug') initDebug();
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
            setConnStatus(true);
            subscribedSecurities.forEach(function (sym) {
                ws.send(JSON.stringify({ type: 'subscribe', topic: 'quote:' + sym }));
            });
            // Resubscribe to active news topic
            if (newsCurrentTopic) {
                ws.send(JSON.stringify({ type: 'subscribe', topic: newsCurrentTopic }));
            }
        };

        ws.onclose = function () {
            setConnStatus(false);
            setTimeout(connectWS, 2000);
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
        el.textContent = connected ? 'CONNECTED' : 'DISCONNECTED';
        if (connected) {
            el.classList.add('connected');
        } else {
            el.classList.remove('connected');
        }
    }

    // ── Watchlist ──

    function initWatchlist() {
        const form = document.getElementById('add-security-form');
        if (form) {
            form.onsubmit = function (e) {
                e.preventDefault();
                const input = document.getElementById('wl-security-input');
                const sec = input.value.trim().toUpperCase();
                if (!sec || subscribedSecurities.has(sec)) {
                    input.value = '';
                    return;
                }
                subscribeSecurity(sec);
                input.value = '';
            };
        }

        // Resubscribe existing securities so rows repopulate
        subscribedSecurities.forEach(function (sym) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'subscribe', topic: 'quote:' + sym }));
            }
        });
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

        // If filtering by security, probe all tabs for results to dim empty ones
        if (newsFilterSecurity) {
            probeNewsTabs();
        }

        // Default: load first tab
        fetchNews('press-releases');
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
            if (newsFilterSecurity) {
                params += '&symbol=' + encodeURIComponent(newsFilterSecurity);
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
        if (newsFilterSecurity) {
            params += '&symbol=' + encodeURIComponent(newsFilterSecurity);
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
            + '<div class="news-card-title"><a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener">' + escapeHtml(item.title) + '</a></div>'
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

                // Handle : chart commands (e.g. :1w, :1m, :3m, :6m)
                if (raw.charAt(0) === ':') {
                    var chartCmd = raw.substring(1).toLowerCase();
                    var rangeMap = { '1w': '1W', '1m': '1M', '3m': '3M', '6m': '6M' };
                    if (rangeMap[chartCmd] && window._stocktopusSetRange) {
                        window._stocktopusSetRange(rangeMap[chartCmd]);
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
            getItems: function () { return document.querySelectorAll('#quote-body tr'); },
            move: function (dir) {
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
                if (link) window.open(link.href, '_blank', 'noopener');
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
                // Normal mode: Escape focuses command bar (enter insert)
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
                if (handler && handler.graph) handler.graph();
                return;
            case '1': case '2': case '3': case '4': case '5': case '6':
                if (handler && handler.jumpToTab) {
                    e.preventDefault();
                    handler.jumpToTab(parseInt(e.key) - 1);
                }
                return;
        }
    }, true); // capture phase — intercepts before Vimium and other extensions

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

    function init() {
        initCommandBar();
        initSecuritySelector();
        connectWS();
        onViewEnter(currentView);
        updateClock();
        setInterval(updateClock, 1000);

        // Set initial history state
        history.replaceState({ view: currentView, security: selectedSecurity }, '');
    }

    init();
})();
