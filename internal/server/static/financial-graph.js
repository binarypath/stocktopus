// Full-size graph for a single financial-statement field at /graph/TICKER.field
// (e.g. /graph/AAPL.revenue). Renders the same colored-segments YoY style as
// the financials slide-in, but full-viewport — sibling to economic-graph.js.

(function () {
    'use strict';

    var host = document.getElementById('fin-graph-host');
    if (!host) return;
    var ticker = host.dataset.ticker;
    var field = host.dataset.field;
    if (!ticker || !field) return;

    function waitForLib(cb) {
        if (window.LightweightCharts) cb();
        else setTimeout(function () { waitForLib(cb); }, 100);
    }

    function fmtAxisValue(v) {
        if (v === null || v === undefined || isNaN(v)) return '—';
        var n = Number(v);
        var abs = Math.abs(n);
        if (abs >= 1e12) return (n / 1e12).toFixed(1) + 'T';
        if (abs >= 1e9)  return (n / 1e9).toFixed(1) + 'B';
        if (abs >= 1e6)  return (n / 1e6).toFixed(1) + 'M';
        if (abs >= 1e3)  return (n / 1e3).toFixed(1) + 'k';
        return n.toFixed(2);
    }

    function fetchSeries() {
        return fetch('/api/historical/financial/' + encodeURIComponent(ticker + '.' + field))
            .then(function (r) {
                if (!r.ok) throw new Error('series ' + r.status);
                return r.json();
            });
    }

    function render(data) {
        // Server returns rows in descending date order (newest first); the chart
        // wants ascending. Also coerce values to numbers and drop nulls.
        var series = (data || [])
            .filter(function (d) { return d.value !== null && d.value !== undefined; })
            .map(function (d) { return { time: d.date.slice(0, 10), value: Number(d.value) }; })
            .filter(function (d) { return !isNaN(d.value); })
            .sort(function (a, b) { return a.time < b.time ? -1 : 1; });

        if (series.length === 0) {
            host.innerHTML = '<p class="empty-state">No data points for this metric.</p>';
            return;
        }

        // YoY segments, same look as the slide-in: each (n-1 → n) edge colored
        // green if up, red if down, neutral if flat.
        var GREEN = '#00cc66', RED = '#ff4444', NEUTRAL = '#888888';
        var priceFormat = { type: 'custom', formatter: fmtAxisValue, minMove: 0.01 };

        var chart = window.LightweightCharts.createChart(host, {
            layout: { background: { color: '#0a0a0a' }, textColor: '#888888', fontFamily: "'SF Mono','Consolas',monospace", fontSize: 11, attributionLogo: false },
            grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
            rightPriceScale: { borderColor: '#2a2a2a' },
            timeScale: { borderColor: '#2a2a2a', timeVisible: false },
            crosshair: { mode: 1 },
        });

        if (series.length === 1) {
            var solo = chart.addSeries(LightweightCharts.LineSeries, {
                color: NEUTRAL, lineWidth: 2, priceFormat: priceFormat, pointMarkersVisible: true,
            });
            solo.setData(series);
        } else {
            for (var i = 1; i < series.length; i++) {
                var prev = series[i - 1].value, curr = series[i].value;
                var color = curr > prev ? GREEN : (curr < prev ? RED : NEUTRAL);
                var seg = chart.addSeries(LightweightCharts.LineSeries, {
                    color: color, lineWidth: 2, priceFormat: priceFormat,
                });
                seg.setData([series[i - 1], series[i]]);
            }
        }
        chart.timeScale().fitContent();

        // Year-by-year values strip below the chart — matches the slide-in's
        // fin-chart-points list so the page reads consistently.
        var pointsEl = document.getElementById('fin-graph-points');
        if (pointsEl) {
            pointsEl.innerHTML = series.map(function (p, i) {
                var year = p.time.substring(0, 4);
                var val = fmtAxisValue(p.value);
                var dirClass = '';
                if (i > 0) {
                    var prevVal = series[i - 1].value;
                    if (p.value > prevVal) dirClass = ' price-up';
                    else if (p.value < prevVal) dirClass = ' price-down';
                }
                return '<div class="fin-chart-point"><span class="fin-chart-year">' + year + '</span>'
                    + '<span class="fin-chart-val' + dirClass + '">' + val + '</span></div>';
            }).join('');
        }
    }

    waitForLib(function () {
        fetchSeries().then(render).catch(function () {
            host.innerHTML = '<p class="empty-state">Series unavailable.</p>';
        });
    });
})();
