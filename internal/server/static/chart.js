// Stocktopus Chart — EOD candlestick with volume and lazy history loading

(function () {
    'use strict';

    var container = document.getElementById('chart-container');
    if (!container) return;

    var symbol = container.dataset.symbol;
    if (!symbol) return;

    // ── Persisted Range ──

    var RANGE_KEY = 'stocktopus-chart-range';
    var defaultRange = localStorage.getItem(RANGE_KEY) || '1M';

    // How much data to fetch initially (wider than the selected period)
    var FETCH_SPANS = {
        '1W': { fetch: 30, view: 7 },    // fetch 1 month, show last week
        '1M': { fetch: 90, view: 30 },   // fetch 3 months, show last month
        '3M': { fetch: 180, view: 90 },  // fetch 6 months, show last 3 months
        '6M': { fetch: 365, view: 180 }, // fetch 1 year, show last 6 months
    };

    // Track loaded data boundaries for lazy loading
    var loadedFrom = null;   // earliest date loaded
    var currentRange = null; // current range key
    var isLoadingMore = false;

    // ── Create Chart ──

    var chart = LightweightCharts.createChart(container, {
        layout: {
            background: { color: '#0a0a0a' },
            textColor: '#888888',
            fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
            fontSize: 11,
        },
        grid: {
            vertLines: { color: '#1a1a1a' },
            horzLines: { color: '#1a1a1a' },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: { color: '#555555', style: LightweightCharts.LineStyle.Dashed },
            horzLine: { color: '#555555', style: LightweightCharts.LineStyle.Dashed },
        },
        rightPriceScale: {
            borderColor: '#2a2a2a',
            scaleMargins: { top: 0.05, bottom: 0.25 },
        },
        timeScale: {
            borderColor: '#2a2a2a',
            timeVisible: false,
            rightOffset: 5,
        },
        handleScroll: true,
        handleScale: true,
    });

    // Expose chart for vim keybindings
    window._stocktopusChart = chart;

    // ── Candlestick Series ──

    var candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
        upColor: '#00cc66',
        downColor: '#ff4444',
        wickUpColor: '#00cc66',
        wickDownColor: '#ff4444',
        borderVisible: false,
    });

    // ── Volume Series ──

    var volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
        drawTicks: false,
    });

    // ── All loaded data (sorted chronologically) ──

    var allCandles = [];
    var allVolumes = [];

    // ── Range Buttons ──

    function setActiveRangeBtn(range) {
        var rangeBar = document.getElementById('chart-range-bar');
        if (!rangeBar) return;
        rangeBar.querySelectorAll('.chart-range-btn').forEach(function (b) {
            b.classList.toggle('active', b.dataset.range === range);
        });
    }

    var rangeBar = document.getElementById('chart-range-bar');
    if (rangeBar) {
        rangeBar.querySelectorAll('.chart-range-btn').forEach(function (btn) {
            btn.onclick = function () {
                setRange(btn.dataset.range);
            };
        });
    }

    // ── Set Range (callable from vim : commands) ──

    function setRange(range) {
        localStorage.setItem(RANGE_KEY, range);
        setActiveRangeBtn(range);
        currentRange = range;
        allCandles = [];
        allVolumes = [];
        loadedFrom = null;
        loadRange(range);
    }

    // Expose for vim : commands
    window._stocktopusSetRange = setRange;

    // ── Data Loading ──

    function loadRange(range) {
        var span = FETCH_SPANS[range] || { fetch: 30, view: 7 };
        var to = new Date();
        var from = new Date();
        from.setDate(from.getDate() - span.fetch);

        fetchAndRender(formatDate(from), formatDate(to), true, span.view);
    }

    function fetchAndRender(fromStr, toStr, fitToView, viewDays) {
        fetch('/api/chart/eod/' + symbol + '?from=' + fromStr + '&to=' + toStr)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || data.length === 0) return;

                var newCandles = data.map(function (d) {
                    return { time: d.date, open: d.open, high: d.high, low: d.low, close: d.close };
                });
                var newVolumes = data.map(function (d) {
                    var color = d.close >= d.open ? 'rgba(0, 204, 102, 0.3)' : 'rgba(255, 68, 68, 0.3)';
                    return { time: d.date, value: d.volume, color: color };
                });

                // Merge with existing data, avoiding duplicates
                var existingDates = {};
                allCandles.forEach(function (c) { existingDates[c.time] = true; });

                newCandles.forEach(function (c, i) {
                    if (!existingDates[c.time]) {
                        allCandles.push(c);
                        allVolumes.push(newVolumes[i]);
                    }
                });

                // Sort chronologically
                allCandles.sort(function (a, b) { return a.time < b.time ? -1 : 1; });
                allVolumes.sort(function (a, b) { return a.time < b.time ? -1 : 1; });

                // Update loaded boundary
                loadedFrom = allCandles[0].time;

                // Set data
                candleSeries.setData(allCandles);
                volumeSeries.setData(allVolumes);

                if (fitToView && viewDays) {
                    // Scroll to show only the view period at the right edge
                    chart.timeScale().fitContent();
                    // Set visible range to the last N days
                    var viewFrom = new Date();
                    viewFrom.setDate(viewFrom.getDate() - viewDays);
                    chart.timeScale().setVisibleRange({
                        from: formatDate(viewFrom),
                        to: formatDate(new Date()),
                    });
                }

                isLoadingMore = false;
            })
            .catch(function (err) {
                console.error('Chart data error:', err);
                isLoadingMore = false;
            });
    }

    // ── Lazy Loading on Scroll Left ──

    chart.timeScale().subscribeVisibleLogicalRangeChange(function (logicalRange) {
        if (!logicalRange || isLoadingMore || !loadedFrom) return;

        // If the user has scrolled to show data near the left edge, load more
        if (logicalRange.from < 5) {
            loadMoreHistory();
        }
    });

    function loadMoreHistory() {
        if (isLoadingMore || !loadedFrom) return;
        isLoadingMore = true;

        var span = FETCH_SPANS[currentRange] || { fetch: 30 };
        var to = new Date(loadedFrom);
        to.setDate(to.getDate() - 1); // day before current earliest
        var from = new Date(to);
        from.setDate(from.getDate() - span.fetch);

        fetchAndRender(formatDate(from), formatDate(to), false, 0);
    }

    function formatDate(d) {
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

    // ── Resize ──

    function resizeChart() {
        chart.resize(container.clientWidth, container.clientHeight);
    }

    window.addEventListener('resize', resizeChart);
    resizeChart();

    // ── Default Load (from persisted range) ──

    setActiveRangeBtn(defaultRange);
    currentRange = defaultRange;
    loadRange(defaultRange);
})();
