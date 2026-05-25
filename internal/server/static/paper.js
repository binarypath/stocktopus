(function () {
    'use strict';

    const state = {
        accounts: [],
        activeAccountId: null,
        debounceTimer: null,
        lastSizing: null,
    };

    const $ = (id) => document.getElementById(id);

    // --- account sidebar ------------------------------------------------

    async function loadAccounts() {
        const res = await fetch('/api/paper/accounts');
        state.accounts = await res.json();
        renderAccounts();
        if (state.accounts.length && !state.activeAccountId) {
            selectAccount(state.accounts[0].id);
        }
    }

    function renderAccounts() {
        const ul = $('paper-account-list');
        if (!state.accounts.length) {
            ul.innerHTML = '<li class="empty-state">No accounts yet. Click "+ New".</li>';
            return;
        }
        ul.innerHTML = state.accounts.map((a) => {
            const sel = a.id === state.activeAccountId ? ' selected' : '';
            const settled = a.settled ? ' · settled' : '';
            return `<li class="paper-account-item${sel}" data-id="${a.id}">
                <div class="paper-account-name">${escape(a.name)}</div>
                <div class="paper-account-meta">${a.baseCurrency} ${fmt(a.cashBalance)} · ${(a.riskPct * 100).toFixed(2)}%${settled}</div>
            </li>`;
        }).join('');
        ul.querySelectorAll('.paper-account-item').forEach((el) => {
            el.addEventListener('click', () => selectAccount(parseInt(el.dataset.id, 10)));
        });
    }

    function selectAccount(id) {
        state.activeAccountId = id;
        renderAccounts();
        renderAccountSummary();
        refreshTrades();
        previewSizing();
    }

    function renderAccountSummary() {
        const a = state.accounts.find((x) => x.id === state.activeAccountId);
        if (!a) {
            $('paper-account-summary').innerHTML = '';
            return;
        }
        $('paper-account-summary').innerHTML = `
            <div class="paper-summary-row"><span>Starting</span><span>${fmt(a.startingBalance)}</span></div>
            <div class="paper-summary-row"><span>Cash</span><span>${fmt(a.cashBalance)}</span></div>
            <div class="paper-summary-row"><span>Risk</span><span>${(a.riskPct * 100).toFixed(2)}%</span></div>
            <div class="paper-summary-row"><span>Settled</span><span>${a.settled ? 'yes' : 'no'}</span></div>
        `;
    }

    // --- new account modal (lightweight prompt for v1) ------------------

    $('paper-new-account').addEventListener('click', async () => {
        const name = prompt('Account name?');
        if (!name) return;
        const startingBalance = parseFloat(prompt('Starting balance (in base currency)?', '10000'));
        if (!(startingBalance > 0)) return alert('Invalid balance.');
        const riskPct = parseFloat(prompt('Risk per bid (e.g. 0.02 for 2%)?', '0.02'));
        if (!(riskPct > 0 && riskPct <= 1)) return alert('Risk must be between 0 and 1.');
        const currency = prompt('Base currency (USD/GBP/EUR)?', 'USD') || 'USD';
        const res = await fetch('/api/paper/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, baseCurrency: currency, startingBalance, riskPct }),
        });
        if (!res.ok) {
            alert(`Create failed: ${await res.text()}`);
            return;
        }
        const { id } = await res.json();
        await loadAccounts();
        selectAccount(id);
    });

    // --- ticket form ----------------------------------------------------

    $('paper-instrument').addEventListener('change', () => {
        const it = $('paper-instrument').value;
        const showMult = (it === 'future' || it === 'forex' || it === 'option');
        $('paper-multiplier-row').style.display = showMult ? '' : 'none';
        if (it === 'option') $('paper-multiplier').value = 100;
        else if (it === 'future') $('paper-multiplier').value = 50;
        else $('paper-multiplier').value = 1;
        previewSizing();
    });

    ['paper-entry', 'paper-stop', 'paper-side', 'paper-multiplier', 'paper-instrument'].forEach((id) => {
        $(id).addEventListener('input', () => {
            clearTimeout(state.debounceTimer);
            state.debounceTimer = setTimeout(previewSizing, 100);
        });
    });

    async function previewSizing() {
        const account = state.accounts.find((x) => x.id === state.activeAccountId);
        if (!account) return;
        const entry = parseFloat($('paper-entry').value);
        const stop = parseFloat($('paper-stop').value);
        if (!entry) {
            setSizingDisplay({ size: null, riskAmount: null, stopDistance: null, error: '' });
            return;
        }
        const payload = {
            instrumentType: $('paper-instrument').value,
            multiplier: parseFloat($('paper-multiplier').value) || 0,
            side: $('paper-side').value,
            entryPrice: entry,
            stopPrice: isNaN(stop) ? 0 : stop,
            accountSize: account.cashBalance,
            riskPct: account.riskPct,
        };
        const res = await fetch('/api/paper/sizing/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        setSizingDisplay(data);
    }

    function setSizingDisplay(data) {
        const sizeEl = $('paper-size-display');
        const riskEl = $('paper-risk-display');
        const distEl = $('paper-stopdist-display');
        const errEl = $('paper-sizing-error');
        if (data.error) {
            sizeEl.textContent = riskEl.textContent = distEl.textContent = '—';
            errEl.textContent = data.error;
            $('paper-submit').disabled = true;
            state.lastSizing = null;
            return;
        }
        errEl.textContent = '';
        if (data.size == null) {
            sizeEl.textContent = riskEl.textContent = distEl.textContent = '—';
            $('paper-submit').disabled = true;
            return;
        }
        sizeEl.textContent = data.size;
        riskEl.textContent = fmt(data.riskAmount);
        distEl.textContent = (data.stopDistance ?? 0).toFixed(4);
        $('paper-submit').disabled = !(data.size >= 1);
        state.lastSizing = data;
    }

    $('paper-ticket-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!state.activeAccountId) return alert('Select an account.');
        const target = parseFloat($('paper-target').value);
        const body = {
            accountId: state.activeAccountId,
            symbol: $('paper-symbol').value.trim().toUpperCase(),
            instrumentType: $('paper-instrument').value,
            multiplier: parseFloat($('paper-multiplier').value) || 0,
            side: $('paper-side').value,
            entryPrice: parseFloat($('paper-entry').value),
            stopPrice: parseFloat($('paper-stop').value),
            thesis: $('paper-thesis').value.trim(),
        };
        if (!isNaN(target) && target > 0) body.targetPrice = target;

        const res = await fetch('/api/paper/trades', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            alert(`Open failed: ${await res.text()}`);
            return;
        }
        $('paper-ticket-form').reset();
        $('paper-multiplier-row').style.display = 'none';
        setSizingDisplay({ size: null });
        refreshTrades();
    });

    // --- positions + journal --------------------------------------------

    async function refreshTrades() {
        if (!state.activeAccountId) return;
        const [openR, closedR] = await Promise.all([
            fetch(`/api/paper/trades/open?accountId=${state.activeAccountId}`),
            fetch(`/api/paper/trades/closed?accountId=${state.activeAccountId}&limit=50`),
        ]);
        renderOpenPositions(await openR.json());
        renderJournal(await closedR.json());
    }

    function renderOpenPositions(trades) {
        const tbody = $('paper-open-table').querySelector('tbody');
        if (!trades.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No open positions.</td></tr>';
            return;
        }
        tbody.innerHTML = trades.map((t) => `
            <tr>
                <td>${escape(t.symbol)}</td>
                <td>${t.side}</td>
                <td>${t.size}</td>
                <td>${t.entryPrice}</td>
                <td>${t.stopPrice}</td>
                <td>${t.targetPrice ?? '—'}</td>
                <td>${fmt(t.riskAmount)}</td>
                <td>${formatDate(t.openedAt)}</td>
                <td><button class="paper-btn-sm paper-close-btn" data-id="${t.id}">Close</button></td>
            </tr>
        `).join('');
        tbody.querySelectorAll('.paper-close-btn').forEach((btn) => {
            btn.addEventListener('click', () => closeTrade(parseInt(btn.dataset.id, 10)));
        });
    }

    async function closeTrade(id) {
        const exit = parseFloat(prompt('Exit price?'));
        if (!(exit > 0)) return;
        const reason = (prompt('Reason (stop/target/manual)?', 'manual') || '').toLowerCase();
        if (!['stop', 'target', 'manual'].includes(reason)) return alert('Reason must be stop, target, or manual.');
        const res = await fetch(`/api/paper/trades/${id}/close`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ exitPrice: exit, reason }),
        });
        if (!res.ok) {
            alert(`Close failed: ${await res.text()}`);
            return;
        }
        await loadAccounts();
        refreshTrades();
    }

    function renderJournal(trades) {
        const tbody = $('paper-journal-table').querySelector('tbody');
        if (!trades.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No closed trades yet.</td></tr>';
            return;
        }
        tbody.innerHTML = trades.map((t) => {
            const pnl = t.realizedPnl ?? 0;
            const r = t.riskAmount ? (pnl / t.riskAmount).toFixed(2) : '—';
            const reason = (t.status || '').replace('closed_', '');
            const pnlClass = pnl >= 0 ? 'paper-pnl-pos' : 'paper-pnl-neg';
            return `<tr>
                <td>${formatDate(t.closedAt)}</td>
                <td>${escape(t.symbol)}</td>
                <td>${t.side}</td>
                <td>${t.size}</td>
                <td>${t.entryPrice}</td>
                <td>${t.exitPrice ?? '—'}</td>
                <td class="${pnlClass}">${fmt(pnl)}</td>
                <td class="${pnlClass}">${r}R</td>
                <td>${reason}</td>
            </tr>`;
        }).join('');
    }

    // --- utils -----------------------------------------------------------

    function escape(s) {
        return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function fmt(n) {
        if (n == null || isNaN(n)) return '—';
        return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatDate(s) {
        if (!s) return '—';
        const d = new Date(s);
        if (isNaN(d.getTime())) return s;
        return d.toISOString().slice(0, 16).replace('T', ' ');
    }

    // --- bootstrap ------------------------------------------------------
    loadAccounts();
})();
