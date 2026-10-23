export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a || 1);
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const TAU = Math.PI * 2;

export function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

export function dist2(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export function angleDiff(a, b) {
  return wrapAngle(b - a);
}

/** Closest point on segment AB to P. */
export function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return { x: ax, y: ay, t: 0, distance: dist(px, py, ax, ay) };
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = clamp(t, 0, 1);
  const x = ax + dx * t, y = ay + dy * t;
  return { x, y, t, distance: dist(px, py, x, y) };
}

export function distanceToPolyline(px, py, points) {
  let best = { distance: Infinity };
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i], q = points[i + 1];
    const c = closestPointOnSegment(px, py, p.x, p.y, q.x, q.y);
    if (c.distance < best.distance) best = { ...c, index: i, point: { x: c.x, y: c.y } };
  }
  return best;
}

export function polylineLength(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += dist(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
  return sum;
}

export function bounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Small, fast, deterministic PRNG. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng, a, b) { return a + (b - a) * rng(); }
export function randInt(rng, a, b) { return Math.floor(a + (b - a + 1) * rng()); }
export function choice(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
export function weightedChoice(rng, items, weightFn = (x) => x.weight || 1) {
  let total = 0;
  for (const item of items) total += Math.max(0, weightFn(item));
  if (total <= 0) return items[0];
  let r = rng() * total;
  for (const item of items) {
    r -= Math.max(0, weightFn(item));
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}
export function gaussian(rng, mean = 0, sd = 1) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}
export function expRandom(rng, mean) { return -Math.log(1 - rng()) * mean; }

let __id = 1;
export function uid(prefix = 'ID') {
  return `${prefix}${__id++}`;
}
export function seedUid(start = 1) { __id = start; }

export const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtNum(v, digits = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return '∞';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function fmtFixed(v, digits = 1) {
  if (!Number.isFinite(v)) return '—';
  return Number(v).toFixed(digits);
}
export function fmtPct(v, digits = 0) { return `${(v * 100).toFixed(digits)}%`; }
export function fmtClock(seconds) {
  seconds = Math.max(0, seconds || 0);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
export function fmtClockTenths(seconds) {
  seconds = Math.max(0, seconds || 0);
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1).padStart(4, '0');
  return `${String(m).padStart(2, '0')}:${s}`;
}
export function fmtDuration(seconds) {
  seconds = Math.max(0, seconds || 0);
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
export function fmtSpeed(kmh) { return `${fmtFixed(kmh, 1)} km/h`; }
export function fmtDistance(m) {
  if (Math.abs(m) >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export function rgba(hex, a = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
export function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v) => clamp(Math.round(v + 255 * amount), 0, 255);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
export function mixHex(a, b, t) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  const c = (x, y) => Math.round(lerp(x, y, t));
  return `rgb(${c(ca.r, cb.r)},${c(ca.g, cb.g)},${c(ca.b, cb.b)})`;
}

export function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) target[key] = value;
    else if (value && typeof value === 'object' && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) deepMerge(target[key], value);
    else target[key] = value;
  }
  return target;
}

export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
}

export function debounce(fn, wait = 300) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function round(v, digits = 2) {
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

export function toRoman(n) {
  return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n - 1] || String(n);
}

export function csvEscape(v) {
  let s = String(v ?? '');
  // Prevent spreadsheet users from evaluating imported names as formulas.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(rows, headers) {
  const lines = [];
  if (headers) lines.push(headers.map(csvEscape).join(','));
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  return lines.join('\n');
}

export function avg(arr, fn = (x) => x) {
  if (!arr.length) return 0;
  let s = 0;
  for (const x of arr) s += fn(x);
  return s / arr.length;
}
export function stdev(arr, fn = (x) => x) {
  if (arr.length < 2) return 0;
  const m = avg(arr, fn);
  return Math.sqrt(arr.reduce((s, x) => s + (fn(x) - m) ** 2, 0) / (arr.length - 1));
}
