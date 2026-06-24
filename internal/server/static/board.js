// Ideas Board — React Flow island (M2 + M3 vim navigation).
// ESM via CDN (import map in board.html); served by the app so /api is same-origin.
//
// Vim nav (issue #158): a board→chart→visual state machine.
//   board mode  : h/j/k/l move the selection between nodes; Enter focuses a chart.
//   chart mode  : a candle cursor — h/l ±1, H/L ±5, {count}l/{count}h ±count.
//   visual mode : v anchors; h/l extends a candle range (analysed-window render);
//                 Enter analyses exactly that window → pins a way-to-trade card.
//   Esc steps back out (visual→chart→board).
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position,
  useNodesState, useEdgesState, addEdge, useReactFlow,
} from '@xyflow/react';
import { createChart } from 'lightweight-charts';
import htm from 'htm';

const html = htm.bind(React.createElement);
const ymd = (d) => d.toISOString().slice(0, 10);
const yearsAgo = (n) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d; };
const usd = (v) => '$' + Math.round(v).toLocaleString();

// Registry so the board-level keydown handler can drive a focused chart's cursor.
const chartReg = new Map(); // nodeId -> { len, barData, applyCursor, clearCursor, applyRange, clearRange }

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

// Shared: fire the backtest for a symbol+window, pin/refresh a way-to-trade card.
async function runAnalysis(rf, srcId, symbol, from, to) {
  const src = rf.getNode(srcId);
  const cardId = srcId + '-wtt';
  const pos = { x: (src?.position.x || 0) + 620, y: (src?.position.y || 0) };
  rf.setNodes((ns) => ns.filter((n) => n.id !== cardId).concat(
    { id: cardId, type: 'waytotrade', position: pos, data: { loading: true, symbol, from, to } }));
  rf.setEdges((es) => es.filter((x) => x.id !== 'e-' + cardId).concat(
    { id: 'e-' + cardId, source: srcId, target: cardId, animated: true, label: 'analyze',
      style: { stroke: '#ff9a1a', strokeWidth: 1.8, filter: 'drop-shadow(0 0 4px rgba(255,154,26,.7))' } }));
  try {
    const r = await fetch(`/api/backtest/optimal-entry/${encodeURIComponent(symbol)}?from=${from}&to=${to}&horizon=10`);
    const res = await r.json();
    rf.setNodes((ns) => ns.map((n) => (n.id === cardId ? { ...n, data: { ...res, loading: false } } : n)));
  } catch (err) {
    rf.setNodes((ns) => ns.map((n) => (n.id === cardId ? { ...n, data: { error: String(err) } } : n)));
  }
}

function ChartNode({ id, data }) {
  const ref = useRef(null);
  const rf = useReactFlow();
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, { ...baseChartOpts, width: 520, height: 300 });
    const s = chart.addCandlestickSeries({ upColor: '#0c8', downColor: '#e55', wickUpColor: '#0c8', wickDownColor: '#e55', borderVisible: false });
    let barData = [];
    fetch(`/api/chart/eod/${encodeURIComponent(data.symbol)}?from=${ymd(yearsAgo(1))}&to=${ymd(new Date())}`)
      .then((r) => (r.ok ? r.json() : [])).then((rows) => {
        if (!Array.isArray(rows) || !rows.length) return;
        barData = rows.map((b) => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close }));
        s.setData(barData);
        chart.timeScale().fitContent();
        chartReg.set(id, {
          len: barData.length, barData,
          applyCursor(i) { const b = barData[i]; if (b) chart.setCrosshairPosition(b.close, b.time, s); },
          clearCursor() { try { chart.clearCrosshairPosition(); } catch (e) {} },
          applyRange(a, b) {
            const lo = Math.min(a, b), hi = Math.max(a, b);
            s.setData(barData.map((bar, idx) => {
              const inR = idx >= lo && idx <= hi;
              const c = inR ? (bar.close >= bar.open ? '#0c8' : '#e55') : '#2b3340';
              return { ...bar, color: c, borderColor: c, wickColor: c };
            }));
          },
          clearRange() { s.setData(barData.map((b) => ({ ...b }))); },
        });
      }).catch(() => {});
    return () => { chartReg.delete(id); try { chart.remove(); } catch (e) {} };
  }, [data.symbol, id]);

  const analyzeAll = useCallback((e) => {
    e.stopPropagation();
    runAnalysis(rf, id, data.symbol, ymd(yearsAgo(1)), ymd(new Date()));
  }, [id, data.symbol, rf]);

  return html`<div class="node chart">
    <div class="node-hdr"><span>${data.symbol} · 1Y</span>
      <span class="analyze-btn" title="backtest the whole window" onClick=${analyzeAll}>⌖ analyze</span></div>
    <div ref=${ref} class="chart-box"></div>
    <${Handle} type="target" position=${Position.Left} />
    <${Handle} type="source" position=${Position.Right} />
  </div>`;
}

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
      <div class="wtt-sub">$10k walk · ${data.from} → ${data.to}</div>
      <div class="wtt-stat"><span>optimal entry</span><span class="b">${opt.date} @ $${(opt.entryPrice || 0).toFixed(2)}</span></div>
      <div class="wtt-stat"><span>vs buy &amp; hold</span><span>${usd(data.buyHoldEquity || 0)}</span></div>
      <div class="wtt-stat"><span>hindsight</span><span>${usd(data.hindsightEquity || 0)} (${Math.round(end / (data.hindsightEquity || end) * 100)}%)</span></div>
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
  { id: 'n1', type: 'note', position: { x: 1500, y: 96 }, data: { text: 'vim: h/j/k/l select · Enter focus a chart · h/l move the candle cursor (H/L ±5, 10l ±10) · v visual-select a window · Enter analyses it.' } },
];
const initialEdges = [
  { id: 'e-wl-c1', source: 'wl', target: 'c1', label: 'drives', animated: true,
    style: { stroke: '#2db8ff', strokeWidth: 1.8, filter: 'drop-shadow(0 0 4px rgba(45,184,255,.7))' } },
];

function Board() {
  const rf = useReactFlow();
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const onConnect = useCallback((p) => setEdges((es) => addEdge({ ...p, animated: true, style: { stroke: '#2db8ff', strokeWidth: 1.8 } }, es)), [setEdges]);

  const [moving, setMoving] = useState(false);
  const hideT = useRef(null);
  const onMoveStart = useCallback(() => { clearTimeout(hideT.current); setMoving(true); }, []);
  const onMoveEnd = useCallback(() => { hideT.current = setTimeout(() => setMoving(false), 900); }, []);

  // ── vim state machine ──
  const st = useRef({ mode: 'board', selId: null, focusId: null, cursor: 0, anchor: -1, count: '' });
  const [hud, setHud] = useState({ mode: 'board', info: 'h/j/k/l to select' });
  const barInfo = (reg, i) => { const b = reg.barData[i]; return b ? `${b.time} @ $${b.close}` : ''; };

  const moveSel = useCallback((dir) => {
    const ns = rf.getNodes(); if (!ns.length) return;
    const cur = ns.find((n) => n.id === st.current.selId);
    let pick;
    if (!cur) pick = ns[0];
    else {
      let best = null, bestd = Infinity;
      for (const n of ns) {
        if (n.id === cur.id) continue;
        const dx = n.position.x - cur.position.x, dy = n.position.y - cur.position.y;
        let ok = false, primary = 0, secondary = 0;
        if (dir === 'right') { ok = dx > 1; primary = dx; secondary = Math.abs(dy); }
        else if (dir === 'left') { ok = dx < -1; primary = -dx; secondary = Math.abs(dy); }
        else if (dir === 'down') { ok = dy > 1; primary = dy; secondary = Math.abs(dx); }
        else { ok = dy < -1; primary = -dy; secondary = Math.abs(dx); }
        if (!ok) continue;
        const d = primary + secondary * 2;
        if (d < bestd) { bestd = d; best = n; }
      }
      pick = best || cur;
    }
    st.current.selId = pick.id;
    rf.setNodes((all) => all.map((n) => ({ ...n, selected: n.id === pick.id })));
    setHud({ mode: 'board', info: 'selected ' + (pick.data.symbol || pick.type) + ' · Enter to focus' });
  }, [rf]);

  const focusSelected = useCallback(() => {
    const s = st.current; const n = rf.getNode(s.selId); if (!n) return;
    if (n.type === 'chart' && chartReg.has(s.selId)) {
      const reg = chartReg.get(s.selId);
      s.mode = 'chart'; s.focusId = s.selId; s.cursor = reg.len - 1;
      reg.applyCursor(s.cursor);
      rf.fitView({ nodes: [{ id: s.selId }], duration: 300, padding: 0.3 });
      setHud({ mode: 'chart', info: barInfo(reg, s.cursor) + ' · v to select' });
    }
  }, [rf]);

  const analyzeRange = useCallback(() => {
    const s = st.current; const reg = chartReg.get(s.focusId); if (!reg) return;
    const lo = Math.min(s.anchor, s.cursor), hi = Math.max(s.anchor, s.cursor);
    const from = reg.barData[lo].time, to = reg.barData[hi].time;
    const n = rf.getNode(s.focusId);
    runAnalysis(rf, s.focusId, n.data.symbol, from, to);
    reg.clearRange(); s.mode = 'chart';
    setHud({ mode: 'chart', info: `analysed ${from} → ${to}` });
  }, [rf]);

  useEffect(() => {
    function onKey(e) {
      const s = st.current, k = e.key;
      if ((s.mode === 'chart' || s.mode === 'visual') && /^[0-9]$/.test(k)) {
        if (!(k === '0' && s.count === '')) { s.count += k; setHud({ mode: s.mode, info: 'count ' + s.count }); e.preventDefault(); return; }
      }
      const step = (key) => { const n = parseInt(s.count || '0', 10) || 0; s.count = ''; return n > 0 ? n : ((key === 'H' || key === 'L') ? 5 : 1); };
      switch (k) {
        case 'h': case 'H': case 'l': case 'L': {
          const dir = (k === 'h' || k === 'H') ? -1 : 1;
          if (s.mode === 'board') { moveSel(dir > 0 ? 'right' : 'left'); e.preventDefault(); return; }
          const reg = chartReg.get(s.focusId); if (!reg) return;
          s.cursor = Math.max(0, Math.min(reg.len - 1, s.cursor + dir * step(k)));
          if (s.mode === 'visual') reg.applyRange(s.anchor, s.cursor);
          reg.applyCursor(s.cursor);
          setHud({ mode: s.mode, info: barInfo(reg, s.cursor) });
          e.preventDefault(); return;
        }
        case 'j': case 'k':
          if (s.mode === 'board') { moveSel(k === 'j' ? 'down' : 'up'); e.preventDefault(); }
          return;
        case 'Enter':
          if (s.mode === 'board') { focusSelected(); e.preventDefault(); }
          else if (s.mode === 'visual') { analyzeRange(); e.preventDefault(); }
          return;
        case 'v':
          if (s.mode === 'chart') {
            s.mode = 'visual'; s.anchor = s.cursor;
            const reg = chartReg.get(s.focusId); if (reg) reg.applyRange(s.anchor, s.cursor);
            setHud({ mode: 'visual', info: 'select a window · Enter to analyse' });
            e.preventDefault();
          }
          return;
        case 'Escape': {
          const reg = chartReg.get(s.focusId);
          if (s.mode === 'visual') { if (reg) reg.clearRange(); s.mode = 'chart'; setHud({ mode: 'chart', info: 'v to select' }); }
          else if (s.mode === 'chart') { if (reg) reg.clearCursor(); s.mode = 'board'; s.focusId = null; setHud({ mode: 'board', info: 'h/j/k/l to select' }); }
          e.preventDefault(); return;
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moveSel, focusSelected, analyzeRange]);

  const modeColor = { board: '#cdd7e1', chart: '#2db8ff', visual: '#ff9a1a' }[hud.mode];
  return html`<${React.Fragment}>
    <div class="vimhud"><span class="vmode" style=${{ color: modeColor }}>${hud.mode.toUpperCase()}</span> ${hud.info}</div>
    <${ReactFlow}
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
    <//>
  <//>`;
}

createRoot(document.getElementById('root')).render(html`<${ReactFlowProvider}><${Board} /><//>`);
