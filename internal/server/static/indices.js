// Stocktopus Equity Indices page

(function () {
    'use strict';

    var container = document.getElementById('indices-container');
    if (!container) return;

    // Major indices to show by default (most important first)
    var MAJOR_INDICES = [
        '^GSPC', '^DJI', '^IXIC', '^VIX', '^RUT',           // US
        '^FTSE', '^GDAXI', '^FCHI', '^STOXX50E',             // Europe
        '^N225', '^HSI', '^AXJO', '^KS11', '^TWII', '^STI',  // Asia-Pacific
        '^GSPTSE', '^BVSP', '^MXX',                           // Americas
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
            html += '<th>Index</th><th>2D</th><th>Price</th><th>Change</th><th>% Change</th><th>Local Time</th>';
            html += '</tr></thead><tbody>';
            indices.forEach(function (idx) {
                var local = getLocalTime(idx.exchange);
                var statusClass = local.open ? 'idx-open' : 'idx-closed';
                var statusLabel = local.open ? 'O' : 'C';
                html += '<tr class="idx-row" data-symbol="' + esc(idx.symbol) + '" data-exchange="' + esc(idx.exchange) + '">'
                    + '<td class="idx-name"><span class="idx-sym">' + esc(idx.symbol) + '</span> <span class="idx-label">' + esc(idx.name) + '</span></td>'
                    + '<td><div class="idx-spark" data-spark-sym="' + esc(idx.symbol) + '"></div></td>'
                    + '<td class="idx-price" id="price-' + esc(idx.symbol) + '">—</td>'
                    + '<td class="idx-change" id="change-' + esc(idx.symbol) + '">—</td>'
                    + '<td class="idx-pct" id="pct-' + esc(idx.symbol) + '">—</td>'
                    + '<td class="idx-time"><span class="' + statusClass + '">' + statusLabel + '</span> ' + local.time + '</td>'
                    + '</tr>';
            });
            html += '</tbody></table>';
            container.innerHTML = html;

            // Fetch quotes for each index
            indices.forEach(function (idx) { fetchIndexQuote(idx.symbol); });

            // Load sparklines
            loadIndexSparklines(indices);

            // Update local times every minute
            setInterval(function () { updateLocalTimes(indices); }, 60000);
        })
        .catch(function (err) {
            container.innerHTML = '<p class="empty-state">Failed to load indices</p>';
        });

    function fetchIndexQuote(symbol) {
        fetch('/api/security/' + encodeURIComponent(symbol) + '/profile')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data[0]) return;
                var q = data[0];
                var chgClass = q.change >= 0 ? 'price-up' : 'price-down';
                var priceEl = document.getElementById('price-' + symbol);
                var changeEl = document.getElementById('change-' + symbol);
                var pctEl = document.getElementById('pct-' + symbol);
                if (priceEl) priceEl.textContent = fmt(q.price);
                if (priceEl) priceEl.className = 'idx-price ' + chgClass;
                if (changeEl) { changeEl.textContent = (q.change >= 0 ? '+' : '') + q.change.toFixed(2); changeEl.className = 'idx-change ' + chgClass; }
                if (pctEl) { pctEl.textContent = (q.changePercentage >= 0 ? '+' : '') + q.changePercentage.toFixed(2) + '%'; pctEl.className = 'idx-pct ' + chgClass; }
            })
            .catch(function () {});
    }

    function loadIndexSparklines(indices) {
        function tryRender() {
            if (!window.LightweightCharts) { setTimeout(tryRender, 200); return; }
            var from = new Date(); from.setDate(from.getDate() - 2);
            var fromStr = from.toISOString().slice(0, 10);
            var toStr = new Date().toISOString().slice(0, 10);

            document.querySelectorAll('.idx-spark').forEach(function (el) {
                var sym = el.dataset.sparkSym;
                if (!sym) return;
                fetch('/api/chart/eod/' + encodeURIComponent(sym) + '?from=' + fromStr + '&to=' + toStr)
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
