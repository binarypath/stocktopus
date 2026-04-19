// Stocktopus Chart — EOD candlestick with volume

(function () {
    'use strict';

    var container = document.getElementById('chart-container');
    if (!container) return;

    var symbol = container.dataset.symbol;
    if (!symbol) return;

    // ── Persisted Range ──

    var RANGE_KEY = 'stocktopus-chart-range';
    var defaultRange = localStorage.getItem(RANGE_KEY) || '1M';

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
        loadRange(range);
    }

    // Expose for vim : commands
    window._stocktopusSetRange = setRange;

    // ── Data Loading ──

    function loadRange(range) {
        var to = new Date();
        var from = new Date();

        switch (range) {
            case '1W': from.setDate(from.getDate() - 7); break;
            case '1M': from.setMonth(from.getMonth() - 1); break;
            case '3M': from.setMonth(from.getMonth() - 3); break;
            case '6M': from.setMonth(from.getMonth() - 6); break;
        }

        var fromStr = formatDate(from);
        var toStr = formatDate(to);

        fetch('/api/chart/eod/' + symbol + '?from=' + fromStr + '&to=' + toStr)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || data.length === 0) return;

                var candles = data.map(function (d) {
                    return { time: d.date, open: d.open, high: d.high, low: d.low, close: d.close };
                });

                var volumes = data.map(function (d) {
                    var color = d.close >= d.open ? 'rgba(0, 204, 102, 0.3)' : 'rgba(255, 68, 68, 0.3)';
                    return { time: d.date, value: d.volume, color: color };
                });

                candleSeries.setData(candles);
                volumeSeries.setData(volumes);
                chart.timeScale().fitContent();
            })
            .catch(function (err) {
                console.error('Chart data error:', err);
            });
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
    loadRange(defaultRange);
})();
