// Stocktopus Equity Indices page

(function () {
    'use strict';

    var container = document.getElementById('indices-container');
    if (!container) return;

    // Major indices to show by default (most important first)
    // Only indices available on our FMP plan (non-premium)
    var MAJOR_INDICES = [
        '^GSPC', '^DJI', '^IXIC', '^VIX', '^RUT',           // US
        '^FTSE', '^STOXX50E',                                 // Europe
        '^N225', '^HSI',                                       // Asia-Pacific
    ];

    // Exchange → timezone mapping for local time
    var EXCHANGE_TZ = {
        'SNP': 'America/New_York', 'DJI': 'America/New_York', 'NASDAQ': 'America/New_York',
        'NYQ': 'America/New_York', 'CBOE': 'America/Chicago',
        'LSE': 'Europe/London', 'XETRA': 'Europe/Berlin', 'PAR': 'Europe/Paris',
        'STO': 'Europe/Stockholm', 'AMS': 'Europe/Amsterdam',
        'JPX': 'Asia/Tokyo', 'HKSE': 'Asia/Hong_Kong', 'KSC': 'Asia/Seoul',
        'TAI': 'Asia/Taipei', 'ASX': 'Australia/Sydney', 'SGX': 'Asia/Singapore',
        'TSX': 'America/Toronto', 'SAO': 'America/Sao_Paulo', 'MEX': 'America/Mexico_City',
    };

    // Market hours (approximate, local time)
    var MARKET_HOURS = { open: 9, close: 16 };

    function getLocalTime(exchange) {
        var tz = EXCHANGE_TZ[exchange] || 'America/New_York';
        try {
            var now = new Date();
            var timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz, hour12: false });
            var hour = parseInt(now.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }));
            var day = now.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz });
            var isWeekend = day === 'Sat' || day === 'Sun';
            var isOpen = !isWeekend && hour >= MARKET_HOURS.open && hour < MARKET_HOURS.close;
            return { time: timeStr, open: isOpen };
        } catch (e) {
            return { time: '--:--', open: false };
        }
    }

    function fmt(n) {
        if (n == null || isNaN(n)) return '—';
        if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(1) + 'T';
        if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
        if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    function buildIndexSparkClusterHtml(symbol) {
        var specs = window.MINI_SPARK_SPECS || [];
        var hosts = specs.map(function (s) {
            return '<div class="wl-spark" data-range="' + s.key + '"></div>';
        }).join('');
        return '<div class="wl-sparks" data-spark-sym="' + esc(symbol) + '">' + hosts + '</div>';
    }

    function hydrateIndexSparks(symbol) {
        var cluster = document.querySelector('.wl-sparks[data-spark-sym="' + symbol + '"]');
        if (!cluster) return;
        var specs = window.MINI_SPARK_SPECS || [];
        function run() {
            if (!window.LightweightCharts || !window._loadMiniSpark) {
                setTimeout(run, 200);
                return;
            }
            specs.forEach(function (spec) {
                var host = cluster.querySelector('.wl-spark[data-range="' + spec.key + '"]');
                if (!host) return;
                window._loadMiniSpark(host, null, symbol, spec);
            });
        }
        run();
    }

    // Load indices
    fetch('/api/indices')
        .then(function (r) { return r.json(); })
        .then(function (allIndices) {
            if (!allIndices || allIndices.length === 0) {
                container.innerHTML = '<p class="empty-state">No indices available</p>';
                return;
            }

            // Build lookup
            var indexMap = {};
            allIndices.forEach(function (idx) { indexMap[idx.symbol] = idx; });

            // Filter to major indices that exist in the list
            var indices = MAJOR_INDICES.filter(function (s) { return indexMap[s]; }).map(function (s) { return indexMap[s]; });

            // Render table shell
            var html = '<table class="fin-table indices-table" id="indices-table"><thead><tr>';
            html += '<th>Index</th><th>Trend</th><th>Price</th><th>Change</th><th>% Change</th><th>Local Time</th>';
            html += '</tr></thead><tbody>';
            indices.forEach(function (idx) {
                var local = getLocalTime(idx.exchange);
                var statusClass = local.open ? 'idx-open' : 'idx-closed';
                var statusLabel = local.open ? 'O' : 'C';
                var safeId = idx.symbol.replace('^', '');
                html += '<tr class="idx-row" data-symbol="' + esc(idx.symbol) + '" data-exchange="' + esc(idx.exchange) + '">'
                    + '<td class="idx-name"><span class="idx-sym">' + esc(idx.symbol) + '</span> <span class="idx-label">' + esc(idx.name) + '</span></td>'
                    + '<td class="wl-spark-cell">' + buildIndexSparkClusterHtml(idx.symbol) + '</td>'
                    + '<td class="idx-price" id="price-' + safeId + '">—</td>'
                    + '<td class="idx-change" id="change-' + safeId + '">—</td>'
                    + '<td class="idx-pct" id="pct-' + safeId + '">—</td>'
                    + '<td class="idx-time"><span class="' + statusClass + '">' + statusLabel + '</span> ' + local.time + '</td>'
                    + '</tr>';
            });
            html += '</tbody></table>';
            container.innerHTML = html;

            // Fetch quotes for each index
            indices.forEach(function (idx) { fetchIndexQuote(idx.symbol); });

            // Load spark cluster (2d / 6M / 1y via MINI_SPARK_SPECS)
            indices.forEach(function (idx) { hydrateIndexSparks(idx.symbol); });

            // Update local times every minute
            setInterval(function () { updateLocalTimes(indices); }, 60000);
        })
        .catch(function (err) {
            container.innerHTML = '<p class="empty-state">Failed to load indices</p>';
        });

    function fetchIndexQuote(symbol) {
        // Use chart EOD for latest price — profile doesn't support indices
        fetch('/api/chart/eod/' + encodeURIComponent(symbol) + '?from=' + new Date(Date.now() - 7*86400000).toISOString().slice(0,10) + '&to=' + new Date().toISOString().slice(0,10))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || data.length < 1) return;
                // Latest day's data
                var latest = data[data.length - 1];
                var prev = data.length > 1 ? data[data.length - 2] : latest;
                var q = {
                    price: latest.close,
                    change: latest.close - prev.close,
                    changePercentage: ((latest.close - prev.close) / prev.close) * 100,
                };
                var chgClass = q.change >= 0 ? 'price-up' : 'price-down';
                var safeId = symbol.replace('^', '');
                var priceEl = document.getElementById('price-' + safeId);
                var changeEl = document.getElementById('change-' + safeId);
                var pctEl = document.getElementById('pct-' + safeId);
                if (priceEl) priceEl.textContent = fmt(q.price);
                if (priceEl) priceEl.className = 'idx-price ' + chgClass;
                if (changeEl) { changeEl.textContent = (q.change >= 0 ? '+' : '') + q.change.toFixed(2); changeEl.className = 'idx-change ' + chgClass; }
                if (pctEl) { pctEl.textContent = (q.changePercentage >= 0 ? '+' : '') + q.changePercentage.toFixed(2) + '%'; pctEl.className = 'idx-pct ' + chgClass; }
            })
            .catch(function () {});
    }

    function updateLocalTimes(indices) {
        indices.forEach(function (idx) {
            var row = document.querySelector('[data-symbol="' + idx.symbol + '"] .idx-time');
            if (row) {
                var local = getLocalTime(idx.exchange);
                var statusClass = local.open ? 'idx-open' : 'idx-closed';
                var statusLabel = local.open ? 'O' : 'C';
                row.innerHTML = '<span class="' + statusClass + '">' + statusLabel + '</span> ' + local.time;
            }
        });
    }
})();
