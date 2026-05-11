// Full-size economic indicator chart at /graph/{identifier}. Sibling to chart.js
// for OHLC tickers — economic series are line, not candle, and have no
// intraday/indicator toolbar.

(function () {
    'use strict';

    var host = document.getElementById('eco-graph-host');
    if (!host) return;
    var identifier = host.dataset.identifier;
    if (!identifier) return;

    var RANGE_YEARS = { '1Y': 1, '5Y': 5, '10Y': 10, 'MAX': 0 };
    var currentRange = '5Y';
    var fullSeries = null; // {observations, title, units, ...}
    var chart = null;
    var series = null;

    function disposeChart() {
        if (chart) { try { chart.remove(); } catch (e) {} chart = null; series = null; }
    }

    function waitForLib(cb) {
        if (window.LightweightCharts) cb();
        else setTimeout(function () { waitForLib(cb); }, 100);
    }

    function fetchSeries() {
        return fetch('/api/economics/series/' + encodeURIComponent(identifier))
            .then(function (r) {
                if (!r.ok) throw new Error('series ' + r.status);
                return r.json();
            });
    }

    function filterToRange(obs, range) {
        var years = RANGE_YEARS[range] || 0;
        if (!years) return obs;
        var cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - years);
        var iso = cutoff.toISOString().slice(0, 10);
        return obs.filter(function (o) { return o.date >= iso; });
    }

    function render() {
        if (!fullSeries) return;
        var obs = filterToRange(fullSeries.observations || [], currentRange);
        disposeChart();
        chart = window.LightweightCharts.createChart(host, {
            layout: { background: { color: '#0a0a0a' }, textColor: '#888888', fontFamily: "'SF Mono','Consolas',monospace", fontSize: 11, attributionLogo: false },
            grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
            rightPriceScale: { borderColor: '#2a2a2a' },
            timeScale: { borderColor: '#2a2a2a' },
            crosshair: { mode: 1 },
        });
        series = chart.addSeries(LightweightCharts.LineSeries, { color: '#4499ff', lineWidth: 2 });
        series.setData(obs.map(function (o) { return { time: o.date, value: o.value }; }));
        chart.timeScale().fitContent();
    }

    function setRange(range) {
        currentRange = range;
        document.querySelectorAll('#eco-graph-range .chart-range-btn').forEach(function (b) {
            b.classList.toggle('active', b.dataset.range === range);
        });
        render();
    }

    // ── Wiring ──

    document.querySelectorAll('#eco-graph-range .chart-range-btn').forEach(function (b) {
        if (b.dataset.default !== undefined) b.classList.add('active');
        b.addEventListener('click', function () { setRange(b.dataset.range); });
    });

    waitForLib(function () {
        fetchSeries()
            .then(function (es) {
                fullSeries = es;
                render();
            })
            .catch(function () {
                host.innerHTML = '<p class="empty-state">Series unavailable. Verify FRED_API_KEY and that the prefetcher has warmed.</p>';
            });
    });

    // Re-fit on window resize so the chart fills the viewport.
    window.addEventListener('resize', function () {
        if (chart) chart.timeScale().fitContent();
    });
})();
