import { clamp, escapeHtml as esc } from '../core/utils.js';

function prepare(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(40, rect.width);
  const h = Math.max(40, rect.height);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h, dpr };
}

function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    const m = Number.isFinite(min) ? min : 0;
    return [m];
  }
  const span = max - min;
  const step0 = span / Math.max(2, count);
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.01; v += step) ticks.push(Number(v.toFixed(8)));
  return ticks;
}

function fmtAxis(v, unit = '') {
  if (!Number.isFinite(v)) return '';
  if (Math.abs(v) >= 10000) return `${(v / 1000).toFixed(0)}k${unit}`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k${unit}`;
  if (Math.abs(v) >= 100) return `${Math.round(v)}${unit}`;
  if (Math.abs(v) >= 10) return `${v.toFixed(0)}${unit}`;
  if (v === 0) return `0${unit}`;
  return `${v.toFixed(1)}${unit}`;
}

function ensureTip(canvas) {
  const parent = canvas.parentElement;
  if (!parent) return null;
  parent.style.position = 'relative';
  let tip = parent.querySelector('.chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.style.cssText = 'position:absolute;pointer-events:none;background:#0b141dee;border:1px solid #2a3a4a;border-radius:6px;padding:6px 8px;font-size:9px;color:#c6d3df;z-index:9;display:none;white-space:nowrap;box-shadow:0 6px 18px #0008;font-family:var(--mono);line-height:1.55;';
    parent.appendChild(tip);
  }
  return tip;
}

function bindHover(canvas, meta) {
  if (canvas.__chartBound) return;
  canvas.__chartBound = true;
  const tip = ensureTip(canvas);
  canvas.addEventListener('pointermove', (e) => {
    const m = canvas.__chart;
    if (!m || !m.data?.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (!m.plot || x < m.plot.x || x > m.plot.x + m.plot.w) { if (tip) tip.style.display = 'none'; return; }
    const t = m.plot.xMin + (x - m.plot.x) / m.plot.w * (m.plot.xMax - m.plot.xMin);
    let idx = 0, best = Infinity;
    for (let i = 0; i < m.data.length; i++) {
      const d = Math.abs((m.data[i][m.xKey] ?? 0) - t);
      if (d < best) { best = d; idx = i; }
    }
    const row = m.data[idx];
    if (!row) return;
    const xValue = m.xFmt ? m.xFmt(row[m.xKey]) : fmtAxis(row[m.xKey]);
    const lines = [`<b style="color:#e8eef5">${esc(m.xLabel || 'x')}: ${esc(xValue)}</b>`];
    for (const s of m.series) {
      const v = row[s.key];
      lines.push(`<i style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${esc(s.color)};margin-right:4px"></i>${esc(s.label)}: <b>${Number.isFinite(v) ? v.toFixed(s.digits ?? 1) : '—'}${esc(s.unit || '')}</b>`);
    }
    tip.innerHTML = lines.join('<br>');
    tip.style.display = 'block';
    const left = clamp(x + 12, 6, rect.width - tip.offsetWidth - 6);
    const top = clamp(y - tip.offsetHeight - 10, 4, rect.height - tip.offsetHeight - 4);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  });
  canvas.addEventListener('pointerleave', () => { if (tip) tip.style.display = 'none'; });
}

/**
 * Multi-series line chart.
 * data: array of row objects. series: [{key,label,color,unit,area}]
 */
export function lineChart(canvas, data, series, options = {}) {
  if (!canvas) return;
  const { ctx, w, h } = prepare(canvas);
  const pad = { l: 44, r: 14, t: 14, b: 25 };
  const plot = { x: pad.l, y: pad.t, w: w - pad.l - pad.r, h: h - pad.t - pad.b };
  data = data || [];
  bindHover(canvas, data);

  let xMin = options.xMin ?? (data.length ? Math.min(...data.map((d) => d[options.xKey || 't'])) : 0);
  let xMax = options.xMax ?? (data.length ? Math.max(...data.map((d) => d[options.xKey || 't'])) : 1);
  if (xMin === xMax) xMax = xMin + 1;

  const all = [];
  for (const s of series) for (const row of data) if (Number.isFinite(row[s.key])) all.push(row[s.key]);
  let yMin = options.yMin ?? (all.length ? Math.min(0, Math.min(...all)) : 0);
  let yMax = options.yMax ?? (all.length ? Math.max(1, Math.max(...all) * 1.12) : 1);
  if (yMin === yMax) yMax = yMin + 1;

  const xScale = (v) => plot.x + (v - xMin) / (xMax - xMin) * plot.w;
  const yScale = (v) => plot.y + plot.h - (v - yMin) / (yMax - yMin) * plot.h;

  ctx.fillStyle = '#0a1118';
  ctx.fillRect(plot.x, plot.y, plot.w, plot.h);
  ctx.strokeStyle = '#1b2936';
  ctx.lineWidth = 1;
  ctx.font = '9px "SF Mono", Consolas, monospace';
  ctx.fillStyle = '#64778a';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const ticksY = niceTicks(yMin, yMax, 4);
  for (const t of ticksY) {
    const y = yScale(t);
    ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
    ctx.fillText(fmtAxis(t, options.yUnit || ''), plot.x - 6, y);
  }
  const ticksX = niceTicks(xMin, xMax, Math.max(3, Math.floor(plot.w / 80)));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of ticksX) {
    const x = xScale(t);
    ctx.strokeStyle = '#13212d';
    ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke();
    ctx.fillStyle = '#64778a';
    const label = options.xFormat ? options.xFormat(t) : (options.xUnit === 's' ? `${Math.round(t / 60)}m` : fmtAxis(t));
    ctx.fillText(label, x, plot.y + plot.h + 7);
  }
  if (options.xLabel) {
    ctx.fillStyle = '#4d6072'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText(options.xLabel, plot.x + plot.w, h - 2);
  }

  for (const s of series) {
    const pts = data.filter((d) => Number.isFinite(d[s.key])).map((d) => ({ x: xScale(d[options.xKey || 't']), y: yScale(d[s.key]) }));
    if (!pts.length) continue;
    if (s.area) {
      const grad = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.h);
      grad.addColorStop(0, hexA(s.color, .22));
      grad.addColorStop(1, hexA(s.color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, plot.y + plot.h);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.lineTo(pts[pts.length - 1].x, plot.y + plot.h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width || 1.8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();
    if (s.dots && pts.length < 80) {
      ctx.fillStyle = s.color;
      for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  canvas.__chart = {
    data, series, xKey: options.xKey || 't', xLabel: options.xLabel || 'Time', xFmt: options.xFormat,
    plot: { ...plot, xMin, xMax },
  };
}

export function barChart(canvas, items, options = {}) {
  if (!canvas) return;
  const { ctx, w, h } = prepare(canvas);
  const pad = { l: options.horizontal ? 108 : 44, r: 16, t: 12, b: options.horizontal ? 20 : 48 };
  const plot = { x: pad.l, y: pad.t, w: w - pad.l - pad.r, h: h - pad.t - pad.b };
  items = items || [];
  if (!items.length) return;
  const max = options.max ?? Math.max(...items.map((d) => d.value), 1);
  ctx.font = '9px "SF Mono", Consolas, monospace';
  ctx.strokeStyle = '#1b2936';
  ctx.fillStyle = '#0a1118';
  ctx.fillRect(plot.x, plot.y, plot.w, plot.h);

  if (options.horizontal) {
    const rowH = plot.h / items.length;
    items.forEach((it, i) => {
      const y = plot.y + i * rowH + rowH * .22;
      const bh = Math.max(3, rowH * .42);
      const bw = (it.value / max) * (plot.w - 34);
      ctx.fillStyle = it.color || '#22d3ee';
      roundRect(ctx, plot.x, y, Math.max(1, bw), bh, 2); ctx.fill();
      ctx.fillStyle = '#b9c6d4';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.font = '8.5px inter, sans-serif';
      ctx.fillText(trim(it.label, 17), plot.x - 7, y + bh / 2);
      ctx.fillStyle = '#7d8fa2';
      ctx.font = '8.5px "SF Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(options.format ? options.format(it.value) : fmtAxis(it.value), Math.min(plot.x + bw + 5, w - 26), y + bh / 2);
    });
  } else {
    const gap = Math.min(22, plot.w / items.length * .25);
    const bw = Math.max(2, (plot.w - gap * (items.length - 1)) / items.length);
    const ticks = niceTicks(0, max, 4);
    ticks.forEach((t) => {
      const y = plot.y + plot.h - (t / max) * plot.h;
      ctx.strokeStyle = '#13212d';
      ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
      ctx.fillStyle = '#64778a'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(fmtAxis(t), plot.x - 6, y);
    });
    items.forEach((it, i) => {
      const x = plot.x + i * (bw + gap);
      const bh = Math.max(1, (it.value / max) * plot.h);
      ctx.fillStyle = it.color || '#22d3ee';
      roundRect(ctx, x, plot.y + plot.h - bh, bw, bh, 2); ctx.fill();
      ctx.save();
      ctx.translate(x + bw / 2, plot.y + plot.h + 6);
      ctx.rotate(-Math.PI / 3.5);
      ctx.fillStyle = '#7d8fa2'; ctx.font = '8px inter, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(trim(it.label, 12), 0, 0);
      ctx.restore();
    });
  }
  canvas.__chart = null;
}

export function donutChart(canvas, items, options = {}) {
  if (!canvas) return;
  const { ctx, w, h } = prepare(canvas);
  const total = items.reduce((s, i) => s + i.value, 0);
  const cx = w * .34, cy = h / 2;
  const r = Math.min(w * .27, h * .38);
  const inner = r * .62;
  ctx.lineWidth = 1;
  if (!total) return;
  let angle = -Math.PI / 2;
  for (const it of items) {
    const span = (it.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, angle, angle + span - .02);
    ctx.arc(cx, cy, inner, angle + span - .02, angle, true);
    ctx.closePath();
    ctx.fillStyle = it.color;
    ctx.fill();
    angle += span;
  }
  ctx.fillStyle = '#e8eef5';
  ctx.font = '600 16px inter, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(options.centerValue || fmtAxis(total), cx, cy - 4);
  ctx.fillStyle = '#64778a';
  ctx.font = '8px inter, sans-serif';
  ctx.fillText(options.centerLabel || 'total', cx, cy + 12);
  let ly = cy - (items.length * 17) / 2 + 6;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const it of items) {
    ctx.fillStyle = it.color;
    ctx.beginPath(); ctx.arc(w * .7, ly, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b9c6d4';
    ctx.font = '9px inter, sans-serif';
    ctx.fillText(trim(it.label, 22), w * .7 + 9, ly);
    ctx.fillStyle = '#64778a';
    ctx.font = '8px "SF Mono", monospace';
    ctx.fillText(`${Math.round(it.value / total * 100)}%`, w - 16, ly);
    ly += 17;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function trim(s, n) { return s.length > n ? `${s.slice(0, n - 1)}…` : s; }
function hexA(hex, a) {
  if (!hex.startsWith('#')) return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
