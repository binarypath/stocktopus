// Stocktopus Chart — EOD + intraday candlestick with volume and lazy history loading

(function () {
    'use strict';

    var container = document.getElementById('chart-container');
    if (!container) return;

    var symbol = container.dataset.symbol;
    if (!symbol) return;

    // ── Persisted Range ──

    var RANGE_KEY = 'stocktopus-chart-range';
    var defaultRange = localStorage.getItem(RANGE_KEY) || '1M';

    // ── Range Config ──

    // EOD ranges: fetch more than shown, with lazy scroll-back
    var EOD_RANGES = {
        '1W': { fetch: 30, view: 7 },
        '1M': { fetch: 90, view: 30 },
        '3M': { fetch: 180, view: 90 },
        '6M': { fetch: 365, view: 180 },
    };

    // Intraday ranges: interval name for API, how many days to fetch/show
    var INTRADAY_RANGES = {
        '1m':  { interval: '1min',  fetchDays: 1,  viewDays: 1,  scrollDays: 1 },
        '5m':  { interval: '5min',  fetchDays: 3,  viewDays: 1,  scrollDays: 2 },
        '15m': { interval: '15min', fetchDays: 5,  viewDays: 2,  scrollDays: 5 },
        '30m': { interval: '30min', fetchDays: 10, viewDays: 3,  scrollDays: 7 },
        '1h':  { interval: '1hour', fetchDays: 20, viewDays: 5,  scrollDays: 10 },
        '4h':  { interval: '4hour', fetchDays: 60, viewDays: 15, scrollDays: 30 },
    };

    var currentRange = null;
    var isIntraday = false;
    var loadedFrom = null;
    var isLoadingMore = false;
    var autoRefresh = true;
    var autoRefreshTimer = null;

    // Intervals under 1 hour that support auto-refresh
    var AUTO_REFRESH_INTERVALS = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800 };

    // ── All loaded data ──

    var allCandles = [];
    var allVolumes = [];

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
            timeVisible: true,
            secondsVisible: false,
            rightOffset: 5,
        },
        handleScroll: true,
        handleScale: true,
    });

    window._stocktopusChart = chart;

    // ── Series ──

    var candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
        upColor: '#00cc66',
        downColor: '#ff4444',
        wickUpColor: '#00cc66',
        wickDownColor: '#ff4444',
        borderVisible: false,
    });

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

    // ── Auto-Refresh Button ──

    var autoRefreshBtn = document.getElementById('chart-auto-refresh');
    if (autoRefreshBtn) {
        autoRefreshBtn.onclick = function () {
            autoRefresh = !autoRefresh;
            autoRefreshBtn.classList.toggle('active', autoRefresh);
            if (autoRefresh) {
                scheduleAutoRefresh();
            } else {
                clearAutoRefresh();
            }
        };
    }

    function updateAutoRefreshVisibility() {
        if (autoRefreshBtn) {
            autoRefreshBtn.style.display = AUTO_REFRESH_INTERVALS[currentRange] ? '' : 'none';
        }
    }

    function scheduleAutoRefresh() {
        clearAutoRefresh();
        if (!autoRefresh || !currentRange) return;

        var intervalSecs = AUTO_REFRESH_INTERVALS[currentRange];
        if (!intervalSecs) return;

        // Calculate ms until the next clock boundary + 3s buffer
        var now = new Date();
        var epochSecs = Math.floor(now.getTime() / 1000);
        var remainder = epochSecs % intervalSecs;
        var delayMs = ((intervalSecs - remainder) * 1000) + 3000;

        console.log('Auto-refresh scheduled in', Math.round(delayMs / 1000) + 's for', currentRange);

        autoRefreshTimer = setTimeout(function () {
            console.log('Auto-refreshing', symbol, currentRange);
            refreshLatest();
            scheduleAutoRefresh();
        }, delayMs);
    }

    function clearAutoRefresh() {
        if (autoRefreshTimer) {
            clearTimeout(autoRefreshTimer);
            autoRefreshTimer = null;
        }
    }

    function refreshLatest() {
        if (!isIntraday || !currentRange) return;
        var cfg = INTRADAY_RANGES[currentRange];
        if (!cfg) return;

        // Fetch just today's data and merge
        var today = formatDate(new Date());
        fetch('/api/chart/intraday/' + cfg.interval + '/' + symbol + '?from=' + today + '&to=' + today)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || data.length === 0) return;

                mergeData(data.map(function (d) {
                    return { time: parseIntradayTime(d.date), open: d.open, high: d.high, low: d.low, close: d.close };
                }), data.map(function (d) {
                    return { time: parseIntradayTime(d.date), value: d.volume, color: d.close >= d.open ? 'rgba(0, 204, 102, 0.3)' : 'rgba(255, 68, 68, 0.3)' };
                }));

                setChartData();
            })
            .catch(function (err) { console.error('Auto-refresh error:', err); });
    }

    // ── Set Range ──

    function setRange(range) {
        localStorage.setItem(RANGE_KEY, range);
        setActiveRangeBtn(range);
        currentRange = range;
        allCandles = [];
        allVolumes = [];
        loadedFrom = null;
        isIntraday = !!INTRADAY_RANGES[range];

        // Toggle time visibility based on type
        chart.timeScale().applyOptions({
            timeVisible: isIntraday,
        });

        updateAutoRefreshVisibility();
        clearAutoRefresh();

        if (isIntraday) {
            loadIntraday(range);
            if (autoRefresh) scheduleAutoRefresh();
        } else {
            loadEOD(range);
        }
    }

    window._stocktopusSetRange = setRange;

    // ── EOD Loading ──

    function loadEOD(range) {
        var span = EOD_RANGES[range] || { fetch: 30, view: 7 };
        var to = new Date();
        var from = new Date();
        from.setDate(from.getDate() - span.fetch);

        fetchEODAndRender(formatDate(from), formatDate(to), span.view);
    }

    function fetchEODAndRender(fromStr, toStr, viewDays) {
        fetch('/api/chart/eod/' + symbol + '?from=' + fromStr + '&to=' + toStr)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || data.length === 0) return;

                mergeData(data.map(function (d) {
                    return { time: d.date, open: d.open, high: d.high, low: d.low, close: d.close };
                }), data.map(function (d) {
                    return { time: d.date, value: d.volume, color: d.close >= d.open ? 'rgba(0, 204, 102, 0.3)' : 'rgba(255, 68, 68, 0.3)' };
                }));

                setChartData();
                loadedFrom = allCandles[0].time;

                if (viewDays) {
                    var viewFrom = new Date();
                    viewFrom.setDate(viewFrom.getDate() - viewDays);
                    chart.timeScale().setVisibleRange({ from: formatDate(viewFrom), to: formatDate(new Date()) });
                }

                isLoadingMore = false;
            })
            .catch(function (err) { console.error('EOD error:', err); isLoadingMore = false; });
    }

    // ── Intraday Loading ──

    function loadIntraday(range) {
        var cfg = INTRADAY_RANGES[range];
        if (!cfg) return;

        var to = new Date();
        var from = new Date();
        from.setDate(from.getDate() - cfg.fetchDays);

        fetchIntradayAndRender(cfg.interval, formatDate(from), formatDate(to), cfg.viewDays);
    }

    function fetchIntradayAndRender(interval, fromStr, toStr, viewDays) {
        fetch('/api/chart/intraday/' + interval + '/' + symbol + '?from=' + fromStr + '&to=' + toStr)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || data.length === 0) return;

                mergeData(data.map(function (d) {
                    return { time: parseIntradayTime(d.date), open: d.open, high: d.high, low: d.low, close: d.close };
                }), data.map(function (d) {
                    return { time: parseIntradayTime(d.date), value: d.volume, color: d.close >= d.open ? 'rgba(0, 204, 102, 0.3)' : 'rgba(255, 68, 68, 0.3)' };
                }));

                setChartData();
                if (allCandles.length > 0) loadedFrom = allCandles[0].time;

                if (viewDays) {
                    chart.timeScale().fitContent();
                }

                isLoadingMore = false;
            })
            .catch(function (err) { console.error('Intraday error:', err); isLoadingMore = false; });
    }

    // Parse "2026-04-21 13:55:00" to Unix timestamp for Lightweight Charts
    function parseIntradayTime(dateStr) {
        var d = new Date(dateStr.replace(' ', 'T') + 'Z');
        return Math.floor(d.getTime() / 1000);
    }

    // ── Data Merge ──

    function mergeData(newCandles, newVolumes) {
        // Build index of existing data by time
        var existingIdx = {};
        allCandles.forEach(function (c, i) { existingIdx[JSON.stringify(c.time)] = i; });

        newCandles.forEach(function (c, i) {
            var key = JSON.stringify(c.time);
            if (key in existingIdx) {
                // Update existing candle (e.g. current minute updating)
                var idx = existingIdx[key];
                allCandles[idx] = c;
                allVolumes[idx] = newVolumes[i];
            } else {
                allCandles.push(c);
                allVolumes.push(newVolumes[i]);
                existingIdx[key] = allCandles.length - 1;
            }
        });

        // Sort
        var timeSort = function (a, b) {
            var ta = typeof a.time === 'number' ? a.time : a.time;
            var tb = typeof b.time === 'number' ? b.time : b.time;
            return ta < tb ? -1 : ta > tb ? 1 : 0;
        };
        allCandles.sort(timeSort);
        allVolumes.sort(timeSort);
    }

    function setChartData() {
        candleSeries.setData(allCandles);
        volumeSeries.setData(allVolumes);
    }

    // ── Lazy Loading on Scroll Left ──

    chart.timeScale().subscribeVisibleLogicalRangeChange(function (logicalRange) {
        if (!logicalRange || isLoadingMore || !loadedFrom) return;
        if (logicalRange.from < 5) {
            loadMoreHistory();
        }
    });

    function loadMoreHistory() {
        if (isLoadingMore || !loadedFrom) return;
        isLoadingMore = true;

        if (isIntraday) {
            var cfg = INTRADAY_RANGES[currentRange];
            if (!cfg) { isLoadingMore = false; return; }
            // loadedFrom is a unix timestamp for intraday
            var toDate = new Date(loadedFrom * 1000);
            toDate.setDate(toDate.getDate() - 1);
            var fromDate = new Date(toDate);
            fromDate.setDate(fromDate.getDate() - cfg.scrollDays);
            fetchIntradayAndRender(cfg.interval, formatDate(fromDate), formatDate(toDate), 0);
        } else {
            var span = EOD_RANGES[currentRange] || { fetch: 30 };
            var to = new Date(loadedFrom);
            to.setDate(to.getDate() - 1);
            var from = new Date(to);
            from.setDate(from.getDate() - span.fetch);
            fetchEODAndRender(formatDate(from), formatDate(to), 0);
        }
    }

    // ── Helpers ──

    function formatDate(d) {
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

    function resizeChart() {
        chart.resize(container.clientWidth, container.clientHeight);
    }

    window.addEventListener('resize', resizeChart);
    resizeChart();

    // ── Default Load ──

    setActiveRangeBtn(defaultRange);
    currentRange = defaultRange;
    isIntraday = !!INTRADAY_RANGES[defaultRange];
    updateAutoRefreshVisibility();
    if (isIntraday) {
        chart.timeScale().applyOptions({ timeVisible: true });
        loadIntraday(defaultRange);
        if (autoRefresh) scheduleAutoRefresh();
    } else {
        loadEOD(defaultRange);
    }
})();
