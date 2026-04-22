// Stocktopus Chart — candlestick + volume + SMA/EMA + MACD + RSI + news markers + tooltip

(function () {
    'use strict';

    var container = document.getElementById('chart-container');
    if (!container) return;
    var symbol = container.dataset.symbol;
    if (!symbol) return;

    // ── Persisted State ──
    var RANGE_KEY = 'stocktopus-chart-range';
    var defaultRange = localStorage.getItem(RANGE_KEY) || '1M';
    var toggleState = JSON.parse(localStorage.getItem('stocktopus-chart-toggles') || '{}');

    var EOD_RANGES = {
        '1W': { fetch: 30, view: 7 }, '1M': { fetch: 90, view: 30 },
        '3M': { fetch: 180, view: 90 }, '6M': { fetch: 365, view: 180 },
    };
    var INTRADAY_RANGES = {
        '1m': { interval: '1min', fetchDays: 1, viewDays: 1, scrollDays: 1 },
        '5m': { interval: '5min', fetchDays: 3, viewDays: 1, scrollDays: 2 },
        '15m': { interval: '15min', fetchDays: 5, viewDays: 2, scrollDays: 5 },
        '30m': { interval: '30min', fetchDays: 10, viewDays: 3, scrollDays: 7 },
        '1h': { interval: '1hour', fetchDays: 20, viewDays: 5, scrollDays: 10 },
        '4h': { interval: '4hour', fetchDays: 60, viewDays: 15, scrollDays: 30 },
    };
    var AUTO_REFRESH_INTERVALS = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800 };

    var currentRange = null, isIntraday = false, loadedFrom = null;
    var isLoadingMore = false, autoRefresh = true, autoRefreshTimer = null;
    var allCandles = [], allVolumes = [];

    // ── Chart ──
    var chart = LightweightCharts.createChart(container, {
        layout: { background: { color: '#0a0a0a' }, textColor: '#888888', fontFamily: "'SF Mono','Consolas',monospace", fontSize: 11 },
        grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal, vertLine: { color: '#555', style: 2 }, horzLine: { color: '#555', style: 2 } },
        rightPriceScale: { borderColor: '#2a2a2a', scaleMargins: { top: 0.05, bottom: 0.25 } },
        timeScale: { borderColor: '#2a2a2a', timeVisible: true, secondsVisible: false, rightOffset: 5 },
        handleScroll: true, handleScale: true,
    });
    window._stocktopusChart = chart;

    // ── Main Series ──
    var candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
        upColor: '#00cc66', downColor: '#ff4444', wickUpColor: '#00cc66', wickDownColor: '#ff4444', borderVisible: false,
    });
    var volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
        priceFormat: { type: 'volume' }, priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, drawTicks: false });

    // ── Indicator Series (created lazily) ──
    var sma20Series = null, sma50Series = null, sma200Series = null;
    var ema20Series = null, ema50Series = null;
    var macdLineSeries = null, macdSignalSeries = null, macdHistSeries = null;
    var rsiSeries = null, rsi70Line = null, rsi30Line = null;
    var newsMarkers = null;

    // ── Indicator Calculations ──
    function calcSMA(data, period) {
        var result = [];
        for (var i = period - 1; i < data.length; i++) {
            var sum = 0;
            for (var j = i - period + 1; j <= i; j++) sum += data[j].close;
            result.push({ time: data[i].time, value: sum / period });
        }
        return result;
    }

    function calcEMA(data, period) {
        if (data.length < period) return [];
        var k = 2 / (period + 1);
        var sum = 0;
        for (var i = 0; i < period; i++) sum += data[i].close;
        var prev = sum / period;
        var result = [{ time: data[period - 1].time, value: prev }];
        for (var i = period; i < data.length; i++) {
            prev = data[i].close * k + prev * (1 - k);
            result.push({ time: data[i].time, value: prev });
        }
        return result;
    }

    function calcMACD(data) {
        if (data.length < 26) return { line: [], signal: [], hist: [] };
        var ema12 = calcEMAValues(data, 12);
        var ema26 = calcEMAValues(data, 26);
        if (ema12.length === 0 || ema26.length === 0) return { line: [], signal: [], hist: [] };
        var macdLine = [];
        // EMA12 starts at index 11, EMA26 starts at index 25
        // Align: for each EMA26 value at index i, the matching EMA12 is at i + 14
        for (var i = 0; i < ema26.length; i++) {
            var dataIdx = i + 25; // corresponding index in original data
            if (dataIdx >= data.length) break;
            macdLine.push({ time: data[dataIdx].time, value: ema12[i + 14] - ema26[i] });
        }
        // Signal line = 9-period EMA of MACD
        var signal = calcEMAFromValues(macdLine, 9);
        var hist = [];
        var sigOffset = macdLine.length - signal.length;
        for (var i = 0; i < signal.length; i++) {
            var val = macdLine[sigOffset + i].value - signal[i].value;
            hist.push({ time: signal[i].time, value: val, color: val >= 0 ? 'rgba(0,204,102,0.5)' : 'rgba(255,68,68,0.5)' });
        }
        return { line: macdLine, signal: signal, hist: hist };
    }

    function calcRSI(data, period) {
        if (data.length < period + 1) return [];
        var gains = 0, losses = 0;
        for (var i = 1; i <= period; i++) {
            var diff = data[i].close - data[i - 1].close;
            if (diff > 0) gains += diff; else losses -= diff;
        }
        var avgGain = gains / period, avgLoss = losses / period;
        var result = [{ time: data[period].time, value: avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss) }];
        for (var i = period + 1; i < data.length; i++) {
            var diff = data[i].close - data[i - 1].close;
            avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
            avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
            result.push({ time: data[i].time, value: avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss) });
        }
        return result;
    }

    function calcEMAValues(data, period) {
        if (data.length < period) return [];
        var k = 2 / (period + 1);
        var sum = 0;
        for (var i = 0; i < period; i++) sum += data[i].close;
        var prev = sum / period;
        var result = [prev];
        for (var i = period; i < data.length; i++) {
            prev = data[i].close * k + prev * (1 - k);
            result.push(prev);
        }
        return result;
    }

    function calcEMAFromValues(data, period) {
        if (data.length < period) return [];
        var k = 2 / (period + 1);
        var sum = 0;
        for (var i = 0; i < period; i++) sum += data[i].value;
        var prev = sum / period;
        var result = [{ time: data[period - 1].time, value: prev }];
        for (var i = period; i < data.length; i++) {
            prev = data[i].value * k + prev * (1 - k);
            result.push({ time: data[i].time, value: prev });
        }
        return result;
    }

    // ── Indicator Toggle ──
    function isOn(name) { return !!toggleState[name]; }

    function toggle(name) {
        toggleState[name] = !toggleState[name];
        localStorage.setItem('stocktopus-chart-toggles', JSON.stringify(toggleState));
        updateToggleButtons();
        updateIndicators();
    }

    window._stocktopusToggle = toggle;

    function updateToggleButtons() {
        document.querySelectorAll('.chart-toggle').forEach(function (btn) {
            btn.classList.toggle('active', isOn(btn.dataset.indicator));
        });
    }

    document.querySelectorAll('.chart-toggle').forEach(function (btn) {
        btn.onclick = function () { toggle(btn.dataset.indicator); };
    });

    function updateIndicators() {
        // Remove old series
        [sma20Series, sma50Series, sma200Series, ema20Series, ema50Series,
         macdLineSeries, macdSignalSeries, macdHistSeries, rsiSeries].forEach(function (s) {
            if (s) { try { chart.removeSeries(s); } catch (e) {} }
        });
        sma20Series = sma50Series = sma200Series = ema20Series = ema50Series = null;
        macdLineSeries = macdSignalSeries = macdHistSeries = rsiSeries = null;

        if (allCandles.length < 2) return;

        // SMA
        if (isOn('sma')) {
            sma20Series = chart.addSeries(LightweightCharts.LineSeries, { color: '#ffcc00', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'SMA20' });
            sma50Series = chart.addSeries(LightweightCharts.LineSeries, { color: '#ff6699', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'SMA50' });
            sma200Series = chart.addSeries(LightweightCharts.LineSeries, { color: '#cc66ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'SMA200' });
            sma20Series.setData(calcSMA(allCandles, 20));
            sma50Series.setData(calcSMA(allCandles, 50));
            if (allCandles.length >= 200) sma200Series.setData(calcSMA(allCandles, 200));
        }

        // EMA
        if (isOn('ema')) {
            ema20Series = chart.addSeries(LightweightCharts.LineSeries, { color: '#00cccc', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA20' });
            ema50Series = chart.addSeries(LightweightCharts.LineSeries, { color: '#4499ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA50' });
            ema20Series.setData(calcEMA(allCandles, 20));
            ema50Series.setData(calcEMA(allCandles, 50));
        }

        // MACD
        if (isOn('macd')) {
            var macd = calcMACD(allCandles);
            macdHistSeries = chart.addSeries(LightweightCharts.HistogramSeries, { priceScaleId: 'macd', priceLineVisible: false, lastValueVisible: false, title: 'MACD' });
            macdLineSeries = chart.addSeries(LightweightCharts.LineSeries, { color: '#4499ff', lineWidth: 1, priceScaleId: 'macd', priceLineVisible: false, lastValueVisible: false });
            macdSignalSeries = chart.addSeries(LightweightCharts.LineSeries, { color: '#ff6699', lineWidth: 1, priceScaleId: 'macd', priceLineVisible: false, lastValueVisible: false });
            chart.priceScale('macd').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 }, drawTicks: false });
            macdHistSeries.setData(macd.hist);
            macdLineSeries.setData(macd.line);
            macdSignalSeries.setData(macd.signal);
        }

        // RSI
        if (isOn('rsi')) {
            rsiSeries = chart.addSeries(LightweightCharts.LineSeries, { color: '#cc66ff', lineWidth: 1, priceScaleId: 'rsi', priceLineVisible: false, lastValueVisible: false, title: 'RSI' });
            chart.priceScale('rsi').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, drawTicks: false });
            rsiSeries.setData(calcRSI(allCandles, 14));
            // Add 70/30 lines
            rsiSeries.createPriceLine({ price: 70, color: '#ff444466', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
            rsiSeries.createPriceLine({ price: 30, color: '#00cc6666', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        }

        // News markers
        if (isOn('news')) {
            loadNewsMarkers();
        }
    }

    // ── News Markers + Reader ──
    var newsDataByDate = {}; // date -> array of news items

    function loadNewsMarkers() {
        if (allCandles.length < 2) return;

        var firstDate = typeof allCandles[0].time === 'string'
            ? allCandles[0].time
            : new Date(allCandles[0].time * 1000).toISOString().slice(0, 10);
        var lastDate = typeof allCandles[allCandles.length - 1].time === 'string'
            ? allCandles[allCandles.length - 1].time
            : new Date(allCandles[allCandles.length - 1].time * 1000).toISOString().slice(0, 10);

        var candleDates = {};
        allCandles.forEach(function (c) {
            var dk = typeof c.time === 'string' ? c.time : new Date(c.time * 1000).toISOString().slice(0, 10);
            if (!candleDates[dk]) candleDates[dk] = c.time;
        });

        fetch('/api/news/stock?symbol=' + symbol + '&limit=100&from=' + firstDate + '&to=' + lastDate)
            .then(function (r) { return r.json(); })
            .then(function (news) {
                if (!news || news.length === 0) return;

                newsDataByDate = {};
                news.forEach(function (n) {
                    var dk = (n.date || '').slice(0, 10);
                    if (!newsDataByDate[dk]) newsDataByDate[dk] = [];
                    newsDataByDate[dk].push(n);
                });

                var markers = [];
                var seen = {};
                Object.keys(newsDataByDate).forEach(function (dk) {
                    if (candleDates[dk] && !seen[dk]) {
                        seen[dk] = true;
                        var count = newsDataByDate[dk].length;
                        markers.push({
                            time: candleDates[dk],
                            position: 'aboveBar',
                            color: '#ffcc00',
                            shape: 'circle',
                            text: count + ' article' + (count > 1 ? 's' : ''),
                        });
                    }
                });

                if (markers.length > 0) {
                    markers.sort(function (a, b) { return a.time < b.time ? -1 : 1; });
                    if (newsMarkers) { try { newsMarkers.detach(); } catch (e) {} }
                    try {
                        newsMarkers = LightweightCharts.createSeriesMarkers(candleSeries, markers);
                    } catch (e) {
                        console.error('Marker error:', e);
                    }
                }
            })
            .catch(function () {});
    }

    // Click on chart → check if near a news marker date → show news list
    chart.subscribeCrosshairMove(function (param) {
        // handled in tooltip section
    });

    chart.subscribeClick(function (param) {
        if (!param || !param.time || !isOn('news')) return;
        var dk = typeof param.time === 'string' ? param.time : new Date(param.time * 1000).toISOString().slice(0, 10);
        var articles = newsDataByDate[dk];
        if (articles && articles.length > 0) {
            showNewsPanel(articles, dk);
        }
    });

    function showNewsPanel(articles, date) {
        var panel = document.getElementById('chart-news-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'chart-news-panel';
            panel.className = 'chart-news-panel';
            container.parentNode.insertBefore(panel, container.nextSibling);
        }

        var html = '<div class="cnp-header"><span>News for ' + date + '</span><button class="cnp-close" onclick="document.getElementById(\'chart-news-panel\').remove()">&#10005;</button></div>';
        html += '<div class="cnp-list">';
        articles.forEach(function (a, i) {
            html += '<div class="cnp-item" data-url="' + encodeURIComponent(a.url || '') + '" onclick="window._openArticle(this.dataset.url)">'
                + '<span class="cnp-title">' + (a.title || '').replace(/</g, '&lt;') + '</span>'
                + '<span class="cnp-meta">' + (a.source || '') + '</span>'
                + '</div>';
        });
        html += '</div>';
        html += '<div id="cnp-reader" class="cnp-reader"></div>';
        panel.innerHTML = html;
    }

    window._openArticle = function (encodedUrl) {
        var url = decodeURIComponent(encodedUrl);
        var reader = document.getElementById('cnp-reader');
        if (!reader) return;
        reader.innerHTML = '<p style="color:var(--text-muted)">Loading article...</p>';

        fetch('/api/article?url=' + encodeURIComponent(url))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.error) {
                    reader.innerHTML = '<p style="color:var(--red)">' + data.error + '</p><a href="' + url + '" target="_blank" style="color:var(--blue)">Open in browser</a>';
                    return;
                }
                var html = '<h2 class="cnp-article-title">' + (data.title || '').replace(/</g, '&lt;') + '</h2>';
                html += '<div class="cnp-article-meta">' + (data.wordCount || 0) + ' words</div>';
                html += '<div class="cnp-article-body">';
                (data.paragraphs || []).forEach(function (p) {
                    var tag = p.tag === 'h1' || p.tag === 'h2' || p.tag === 'h3' ? p.tag : 'p';
                    html += '<' + tag + '>' + p.text.replace(/</g, '&lt;') + '</' + tag + '>';
                });
                html += '</div>';
                reader.innerHTML = html;
            })
            .catch(function () {
                reader.innerHTML = '<p style="color:var(--red)">Failed to load</p><a href="' + url + '" target="_blank" style="color:var(--blue)">Open in browser</a>';
            });
    };

    // ── Crosshair Tooltip ──
    var tooltipEl = document.getElementById('chart-tooltip');

    chart.subscribeCrosshairMove(function (param) {
        if (!tooltipEl) return;
        if (!param || !param.time || param.seriesData.size === 0) {
            tooltipEl.classList.add('hidden');
            return;
        }

        var candle = param.seriesData.get(candleSeries);
        if (!candle) { tooltipEl.classList.add('hidden'); return; }

        var chgClass = candle.close >= candle.open ? 'price-up' : 'price-down';
        tooltipEl.innerHTML = '<span class="tt-sym">' + symbol + '</span>'
            + ' O:<span class="' + chgClass + '">' + candle.open.toFixed(2) + '</span>'
            + ' H:<span class="' + chgClass + '">' + candle.high.toFixed(2) + '</span>'
            + ' L:<span class="' + chgClass + '">' + candle.low.toFixed(2) + '</span>'
            + ' C:<span class="' + chgClass + '">' + candle.close.toFixed(2) + '</span>';

        tooltipEl.classList.remove('hidden');
    });

    // ── Range Buttons ──
    function setActiveRangeBtn(range) {
        var bar = document.getElementById('chart-range-bar');
        if (bar) bar.querySelectorAll('.chart-range-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.range === range); });
    }
    var rangeBar = document.getElementById('chart-range-bar');
    if (rangeBar) rangeBar.querySelectorAll('.chart-range-btn').forEach(function (btn) { btn.onclick = function () { setRange(btn.dataset.range); }; });

    // ── Auto-Refresh ──
    var autoRefreshBtn = document.getElementById('chart-auto-refresh');
    if (autoRefreshBtn) {
        autoRefreshBtn.onclick = function () { autoRefresh = !autoRefresh; autoRefreshBtn.classList.toggle('active', autoRefresh); if (autoRefresh) scheduleAutoRefresh(); else clearAutoRefresh(); };
    }
    function updateAutoRefreshVisibility() { if (autoRefreshBtn) autoRefreshBtn.style.display = AUTO_REFRESH_INTERVALS[currentRange] ? '' : 'none'; }
    function scheduleAutoRefresh() {
        clearAutoRefresh();
        if (!autoRefresh || !currentRange) return;
        var secs = AUTO_REFRESH_INTERVALS[currentRange];
        if (!secs) return;
        var now = Math.floor(Date.now() / 1000);
        var delay = ((secs - (now % secs)) * 1000) + 3000;
        autoRefreshTimer = setTimeout(function () { refreshLatest(); scheduleAutoRefresh(); }, delay);
    }
    function clearAutoRefresh() { if (autoRefreshTimer) { clearTimeout(autoRefreshTimer); autoRefreshTimer = null; } }
    function refreshLatest() {
        if (!isIntraday || !currentRange) return;
        var cfg = INTRADAY_RANGES[currentRange]; if (!cfg) return;
        var today = fmtDate(new Date());
        fetch('/api/chart/intraday/' + cfg.interval + '/' + symbol + '?from=' + today + '&to=' + today)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || data.length === 0) return;
                mergeData(data.map(function (d) { return { time: parseTime(d.date), open: d.open, high: d.high, low: d.low, close: d.close }; }),
                    data.map(function (d) { return { time: parseTime(d.date), value: d.volume, color: d.close >= d.open ? 'rgba(0,204,102,0.3)' : 'rgba(255,68,68,0.3)' }; }));
                applyData();
            }).catch(function () {});
    }

    // ── Set Range ──
    function setRange(range) {
        localStorage.setItem(RANGE_KEY, range);
        setActiveRangeBtn(range);
        currentRange = range; allCandles = []; allVolumes = []; loadedFrom = null;
        isIntraday = !!INTRADAY_RANGES[range];
        chart.timeScale().applyOptions({ timeVisible: isIntraday });
        updateAutoRefreshVisibility(); clearAutoRefresh();
        if (newsMarkers) { try { newsMarkers.detach(); } catch (e) {} newsMarkers = null; }
        if (isIntraday) { loadIntraday(range); if (autoRefresh) scheduleAutoRefresh(); }
        else { loadEOD(range); }
    }
    window._stocktopusSetRange = setRange;

    // ── Data Loading ──
    function loadEOD(range) {
        var s = EOD_RANGES[range] || { fetch: 30, view: 7 };
        var to = new Date(), from = new Date(); from.setDate(from.getDate() - s.fetch);
        fetchData('/api/chart/eod/' + symbol + '?from=' + fmtDate(from) + '&to=' + fmtDate(to), false, s.view);
    }
    function loadIntraday(range) {
        var c = INTRADAY_RANGES[range]; if (!c) return;
        var to = new Date(), from = new Date(); from.setDate(from.getDate() - c.fetchDays);
        fetchData('/api/chart/intraday/' + c.interval + '/' + symbol + '?from=' + fmtDate(from) + '&to=' + fmtDate(to), true, c.viewDays);
    }

    function fetchData(url, intra, viewDays) {
        fetch(url).then(function (r) { return r.json(); }).then(function (data) {
            if (!data || data.length === 0) return;
            mergeData(data.map(function (d) { return { time: intra ? parseTime(d.date) : d.date, open: d.open, high: d.high, low: d.low, close: d.close }; }),
                data.map(function (d) { return { time: intra ? parseTime(d.date) : d.date, value: d.volume, color: d.close >= d.open ? 'rgba(0,204,102,0.3)' : 'rgba(255,68,68,0.3)' }; }));
            applyData();
            if (allCandles.length > 0) loadedFrom = allCandles[0].time;
            if (viewDays) {
                if (intra) { chart.timeScale().fitContent(); }
                else {
                    var vf = new Date(); vf.setDate(vf.getDate() - viewDays);
                    chart.timeScale().setVisibleRange({ from: fmtDate(vf), to: fmtDate(new Date()) });
                }
            }
            isLoadingMore = false;
        }).catch(function (e) { console.error('Chart error:', e); isLoadingMore = false; });
    }

    function applyData() {
        candleSeries.setData(allCandles);
        volumeSeries.setData(allVolumes);
        updateIndicators();
    }

    // ── Data Merge ──
    function mergeData(nc, nv) {
        var idx = {}; allCandles.forEach(function (c, i) { idx[JSON.stringify(c.time)] = i; });
        nc.forEach(function (c, i) { var k = JSON.stringify(c.time); if (k in idx) { allCandles[idx[k]] = c; allVolumes[idx[k]] = nv[i]; } else { allCandles.push(c); allVolumes.push(nv[i]); idx[k] = allCandles.length - 1; } });
        var ts = function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; };
        allCandles.sort(ts); allVolumes.sort(ts);
    }

    // ── Lazy Scroll ──
    chart.timeScale().subscribeVisibleLogicalRangeChange(function (lr) {
        if (!lr || isLoadingMore || !loadedFrom) return;
        if (lr.from < 5) loadMore();
    });
    function loadMore() {
        if (isLoadingMore || !loadedFrom) return;
        isLoadingMore = true;
        if (isIntraday) {
            var c = INTRADAY_RANGES[currentRange]; if (!c) { isLoadingMore = false; return; }
            var to = new Date(loadedFrom * 1000); to.setDate(to.getDate() - 1);
            var from = new Date(to); from.setDate(from.getDate() - c.scrollDays);
            fetchData('/api/chart/intraday/' + c.interval + '/' + symbol + '?from=' + fmtDate(from) + '&to=' + fmtDate(to), true, 0);
        } else {
            var s = EOD_RANGES[currentRange] || { fetch: 30 };
            var to = new Date(loadedFrom); to.setDate(to.getDate() - 1);
            var from = new Date(to); from.setDate(from.getDate() - s.fetch);
            fetchData('/api/chart/eod/' + symbol + '?from=' + fmtDate(from) + '&to=' + fmtDate(to), false, 0);
        }
    }

    // ── Helpers ──
    function fmtDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    function parseTime(s) { return Math.floor(new Date(s.replace(' ', 'T') + 'Z').getTime() / 1000); }
    function resizeChart() { chart.resize(container.clientWidth, container.clientHeight); }
    window.addEventListener('resize', resizeChart); resizeChart();

    // ── Init ──
    updateToggleButtons();
    setActiveRangeBtn(defaultRange);
    currentRange = defaultRange;
    isIntraday = !!INTRADAY_RANGES[defaultRange];
    updateAutoRefreshVisibility();
    if (isIntraday) { chart.timeScale().applyOptions({ timeVisible: true }); loadIntraday(defaultRange); if (autoRefresh) scheduleAutoRefresh(); }
    else { loadEOD(defaultRange); }
})();
