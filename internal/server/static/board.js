// Ideas Board — React Flow island (M2 scaffold).
// No build step yet: React + React Flow + lightweight-charts load as ESM from a
// CDN via the import map in board.html. Served by the app, so /api is same-origin.
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position,
  useNodesState, useEdgesState, addEdge, useReactFlow,
} from '@xyflow/react';
import { createChart } from 'lightweight-charts';
import htm from 'htm';

const html = htm.bind(React.createElement);
const ymd = (d) => d.toISOString().slice(0, 10);
const yearsAgo = (n) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d; };
const usd = (v) => '$' + Math.round(v).toLocaleString();

const baseChartOpts = {
  layout: { background: { color: 'transparent' }, textColor: '#7f8c9b', fontFamily: "'Fira Code',monospace", fontSize: 10, attributionLogo: false },
  grid: { vertLines: { color: '#101720' }, horzLines: { color: '#101720' } },
  rightPriceScale: { borderColor: '#1b232d' },
  timeScale: { borderColor: '#1b232d', fixLeftEdge: true, fixRightEdge: true },
  handleScroll: false, handleScale: false,
};

function rebasePct(rows, valueKey, fromStr) {
  const out = []; let base = null;
  for (const r of rows) {
    const date = (r.date || '').slice(0, 10);
    if (!date || date < fromStr) continue;
    const v = Number(r[valueKey]); if (!isFinite(v)) continue;
    if (base === null) { if (v === 0) continue; base = v; }
    out.push({ time: date, value: ((v - base) / Math.abs(base)) * 100 });
  }
  return out;
}

// ── Price chart node — with an "analyze" trigger that fires the backtest ──
function ChartNode({ id, data }) {
  const ref = useRef(null);
  const rf = useReactFlow();
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, { ...baseChartOpts, width: 520, height: 300 });
    const s = chart.addCandlestickSeries({ upColor: '#0c8', downColor: '#e55', wickUpColor: '#0c8', wickDownColor: '#e55', borderVisible: false });
    fetch(`/api/chart/eod/${encodeURIComponent(data.symbol)}?from=${ymd(yearsAgo(1))}&to=${ymd(new Date())}`)
      .then((r) => (r.ok ? r.json() : [])).then((rows) => {
        if (Array.isArray(rows) && rows.length) {
          s.setData(rows.map((b) => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close })));
          chart.timeScale().fitContent();
        }
      }).catch(() => {});
    return () => { try { chart.remove(); } catch (e) {} };
  }, [data.symbol]);

  // fire the deterministic backtest over the visible (1Y) window, pin a card
  const analyze = useCallback(async (e) => {
    e.stopPropagation();
    const from = ymd(yearsAgo(1)), to = ymd(new Date());
    const src = rf.getNode(id);
    const cardId = id + '-wtt';
    const pos = { x: (src?.position.x || 0) + 600, y: (src?.position.y || 0) };
    rf.setNodes((ns) => ns.filter((n) => n.id !== cardId).concat(
      { id: cardId, type: 'waytotrade', position: pos, data: { loading: true, symbol: data.symbol } }));
    rf.setEdges((es) => es.filter((x) => x.id !== 'e-' + cardId).concat(
      { id: 'e-' + cardId, source: id, target: cardId, animated: true, label: 'analyze',
        style: { stroke: '#ff9a1a', strokeWidth: 1.8, filter: 'drop-shadow(0 0 4px rgba(255,154,26,.7))' } }));
    try {
      const r = await fetch(`/api/backtest/optimal-entry/${encodeURIComponent(data.symbol)}?from=${from}&to=${to}&horizon=10`);
      const res = await r.json();
      rf.setNodes((ns) => ns.map((n) => (n.id === cardId ? { ...n, data: { ...res, loading: false } } : n)));
    } catch (err) {
      rf.setNodes((ns) => ns.map((n) => (n.id === cardId ? { ...n, data: { error: String(err) } } : n)));
    }
  }, [id, data.symbol, rf]);

  return html`<div class="node chart">
    <div class="node-hdr"><span>${data.symbol} · 1Y</span>
      <span class="analyze-btn" title="backtest optimal entry over this window" onClick=${analyze}>⌖ analyze</span></div>
    <div ref=${ref} class="chart-box"></div>
    <${Handle} type="target" position=${Position.Left} />
    <${Handle} type="source" position=${Position.Right} />
  </div>`;
}

// ── The live "way-to-trade" card — real backtest result ──
function WayToTradeNode({ data }) {
  let body;
  if (data.error) body = html`<div class="wtt-row err">error: ${data.error}</div>`;
  else if (data.loading) body = html`<div class="wtt-big">analysing…</div>`;
  else {
    const end = data.policy?.endEquity ?? data.startCash;
    const ret = (end / data.startCash - 1) * 100;
    const opt = data.optimal || {};
    body = html`<div>
      <div class="wtt-big">${usd(end)} <span class=${ret >= 0 ? 'up' : 'dn'}>${(ret >= 0 ? '+' : '') + ret.toFixed(1)}%</span></div>
      <div class="wtt-sub">$10k policy walk over the window</div>
      <div class="wtt-stat"><span>optimal entry</span><span class="b">${opt.date} @ $${(opt.entryPrice || 0).toFixed(2)}</span></div>
      <div class="wtt-stat"><span>vs buy &amp; hold</span><span>${usd((data.buyHoldEquity || 0))}</span></div>
      <div class="wtt-stat"><span>hindsight ceiling</span><span>${usd((data.hindsightEquity || 0))} (${Math.round(end / (data.hindsightEquity || end) * 100)}%)</span></div>
      <div class="wtt-stat"><span>decisions</span><span>${(data.policy?.trace || []).length}</span></div>
    </div>`;
  }
  return html`<div class="node wtt">
    <div class="node-hdr"><span>way to trade${data.symbol ? ' · ' + data.symbol : ''}</span><span>⠿</span></div>
    <div class="wtt-body">${body}</div>
    <${Handle} type="target" position=${Position.Left} />
  </div>`;
}

function ComparisonNode({ data }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const fromStr = ymd(yearsAgo(data.years || 3));
    const chart = createChart(ref.current, { ...baseChartOpts, width: 560, height: 320 });
    data.series.forEach((sp) => {
      const url = sp.kind === 'economic'
        ? `/api/historical/economic/${encodeURIComponent(sp.id)}`
        : `/api/chart/eod/${encodeURIComponent(sp.id)}?from=${fromStr}&to=${ymd(new Date())}`;
      const line = chart.addLineSeries({ color: sp.color, lineWidth: 2, priceLineVisible: false,
        priceFormat: { type: 'custom', formatter: (v) => (v >= 0 ? '+' : '') + v.toFixed(0) + '%', minMove: 0.1 } });
      fetch(url).then((r) => (r.ok ? r.json() : [])).then((rows) => {
        if (!Array.isArray(rows) || !rows.length) return;
        line.setData(rebasePct(rows, sp.kind === 'economic' ? 'value' : 'close', fromStr));
        chart.timeScale().fitContent();
      }).catch(() => {});
    });
    return () => { try { chart.remove(); } catch (e) {} };
  }, []);
  return html`<div class="node comp">
    <div class="node-hdr"><span>comparison · rebased % · ${data.years || 3}Y</span><span>⠿</span></div>
    <div ref=${ref} class="chart-box" style=${{ width: '560px', height: '320px' }}></div>
    <div class="legend">${data.series.map((s) => html`<span key=${s.id} style=${{ color: s.color }}>● ${s.label}</span>`)}</div>
    <${Handle} type="target" position=${Position.Left} />
  </div>`;
}

function WatchlistNode({ data }) {
  return html`<div class="node wl">
    <div class="node-hdr"><span>watchlist · ${data.name}</span><span>⠿</span></div>
    <div class="wl-body">${data.symbols.map((s) => html`<div class="wl-row" key=${s}>${s}</div>`)}</div>
    <${Handle} type="source" position=${Position.Right} />
  </div>`;
}

function NoteNode({ data }) {
  return html`<div class="node note">
    <div class="node-hdr"><span>note</span><span>⠿</span></div>
    <div class="note-body">${data.text}</div>
    <${Handle} type="target" position=${Position.Left} />
  </div>`;
}

const nodeTypes = { chart: ChartNode, waytotrade: WayToTradeNode, comparison: ComparisonNode, watchlist: WatchlistNode, note: NoteNode };

const initialNodes = [
  { id: 'wl', type: 'watchlist', position: { x: 16, y: 120 }, data: { name: 'Mega-cap', symbols: ['AAPL', 'MSFT', 'NVDA'] } },
  { id: 'c1', type: 'chart', position: { x: 320, y: 64 }, data: { symbol: 'AAPL' } },
  { id: 'cmp', type: 'comparison', position: { x: 320, y: 432 }, data: { years: 5, series: [
        { label: '10Y Treasury (DGS10)', color: '#2db8ff', kind: 'economic', id: 'US.DGS10' },
        { label: 'Unemployment (UNRATE)', color: '#ff9a1a', kind: 'economic', id: 'US.UNRATE' },
        { label: 'AAPL', color: '#00cc66', kind: 'price', id: 'AAPL' } ] } },
  { id: 'n1', type: 'note', position: { x: 1500, y: 96 }, data: { text: '⌖ analyze on a chart fires the $10k backtest → pins a live way-to-trade card. The watchlist drives the chart; a screen feeds the watchlist.' } },
];
const initialEdges = [
  { id: 'e-wl-c1', source: 'wl', target: 'c1', label: 'drives', animated: true,
    style: { stroke: '#2db8ff', strokeWidth: 1.8, filter: 'drop-shadow(0 0 4px rgba(45,184,255,.7))' } },
];

function Board() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const onConnect = useCallback((p) => setEdges((es) => addEdge({ ...p, animated: true, style: { stroke: '#2db8ff', strokeWidth: 1.8 } }, es)), [setEdges]);
  const [moving, setMoving] = useState(false);
  const hideT = useRef(null);
  const onMoveStart = useCallback(() => { clearTimeout(hideT.current); setMoving(true); }, []);
  const onMoveEnd = useCallback(() => { hideT.current = setTimeout(() => setMoving(false), 900); }, []);
  return html`<${ReactFlow}
      nodes=${nodes} edges=${edges}
      onNodesChange=${onNodesChange} onEdgesChange=${onEdgesChange} onConnect=${onConnect}
      nodeTypes=${nodeTypes}
      fitView snapToGrid snapGrid=${[16, 16]} minZoom=${0.2} maxZoom=${4}
      onMoveStart=${onMoveStart} onMoveEnd=${onMoveEnd}
      proOptions=${{ hideAttribution: true }}
      defaultEdgeOptions=${{ animated: true, style: { stroke: '#2db8ff', strokeWidth: 1.6 } }}>
    <${Background} color="#1b232d" gap=${26} />
    <${Controls} showInteractive=${false} />
    ${moving ? html`<${MiniMap} pannable zoomable nodeColor=${() => '#2db8ff'} maskColor="rgba(6,7,10,.7)" />` : null}
  <//>`;
}

createRoot(document.getElementById('root')).render(html`<${Board} />`);
