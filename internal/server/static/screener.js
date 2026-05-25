(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const form = $('screener-form');
    const meta = $('screener-results-meta');
    const tbody = $('screener-table').querySelector('tbody');

    let lastResults = [];
    let sortKey = null;
    let sortDir = 1; // 1 asc, -1 desc

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await runScreen();
    });

    $('screener-reset').addEventListener('click', () => {
        form.reset();
        tbody.innerHTML = '<tr><td colspan="10" class="empty-state">Filters reset. Press <kbd>Run Screen</kbd>.</td></tr>';
        meta.textContent = 'no screen run yet';
        lastResults = [];
    });

    async function runScreen() {
        const params = new URLSearchParams();
        const fd = new FormData(form);
        for (const [k, v] of fd.entries()) {
            const trimmed = String(v).trim();
            if (trimmed !== '') params.set(k, trimmed);
        }

        meta.textContent = 'running…';
        tbody.innerHTML = '<tr><td colspan="10" class="empty-state">Loading…</td></tr>';

        const t0 = performance.now();
        let res;
        try {
            res = await fetch(`/api/screener?${params.toString()}`);
        } catch (err) {
            meta.textContent = `network error: ${err.message}`;
            return;
        }
        if (!res.ok) {
            const body = await res.text();
            meta.textContent = `HTTP ${res.status}`;
            tbody.innerHTML = `<tr><td colspan="10" class="empty-state">${escape(body)}</td></tr>`;
            return;
        }
        const data = await res.json();
        const elapsed = (performance.now() - t0) / 1000;
        lastResults = Array.isArray(data) ? data : [];
        meta.textContent = `${lastResults.length} result${lastResults.length === 1 ? '' : 's'} · ${elapsed.toFixed(1)}s`;
        renderRows();
    }

    function renderRows() {
        if (!lastResults.length) {
            tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No matches. Loosen a filter.</td></tr>';
            return;
        }
        const rows = sortKey ? [...lastResults].sort(byKey(sortKey, sortDir)) : lastResults;
        tbody.innerHTML = rows.map((r) => {
            const sign = (n) => n > 0 ? 'paper-pnl-pos' : (n < 0 ? 'paper-pnl-neg' : '');
            const pct = (n) => (n >= 0 ? '+' : '') + n.toFixed(2);
            return `<tr>
                <td><a href="/security/${encodeURIComponent(r.symbol)}">${escape(r.symbol)}</a></td>
                <td title="${escape(r.companyName)}">${truncate(escape(r.companyName), 28)}</td>
                <td>${escape(r.sector || '')}</td>
                <td class="num">${fmt(r.price)}</td>
                <td class="num ${sign(r.changeFromOpen)}">${pct(r.changeFromOpen)}</td>
                <td class="num ${sign(r.changeFromPrevDay)}">${pct(r.changeFromPrevDay)}</td>
                <td class="num ${sign(r.changeVsMarket)}">${pct(r.changeVsMarket)}</td>
                <td class="num">${fmtCompact(r.volume)}</td>
                <td class="num">${fmtCompact(r.marketCap)}</td>
                <td class="num">${(r.beta || 0).toFixed(2)}</td>
            </tr>`;
        }).join('');
    }

    // Click a header to sort by that column.
    $('screener-table').querySelectorAll('thead th').forEach((th, idx) => {
        const keys = ['symbol', 'companyName', 'sector', 'price', 'changeFromOpen', 'changeFromPrevDay', 'changeVsMarket', 'volume', 'marketCap', 'beta'];
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
            const k = keys[idx];
            if (sortKey === k) sortDir = -sortDir;
            else { sortKey = k; sortDir = 1; }
            renderRows();
        });
    });

    function byKey(key, dir) {
        return (a, b) => {
            const av = a[key], bv = b[key];
            if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
            return String(av || '').localeCompare(String(bv || '')) * dir;
        };
    }

    function escape(s) {
        return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
    function fmt(n) {
        if (n == null || isNaN(n)) return '—';
        return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function fmtCompact(n) {
        if (n == null || isNaN(n) || n === 0) return '—';
        const abs = Math.abs(n);
        if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T';
        if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
        if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
        if (abs >= 1e3) return (n / 1e3).toFixed(2) + 'K';
        return n.toFixed(0);
    }
})();
