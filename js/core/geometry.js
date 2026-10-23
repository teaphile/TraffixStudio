import { clamp, dist, polylineLength } from './utils.js';

/**
 * Catmull-Rom sampled centreline. Two points produce a straight line; more
 * points are smoothed. Returns dense points with cumulative distance.
 */
export function sampleCenterline(points, spacing = 1.5) {
  const src = dedupe(points);
  if (src.length < 2) return { points: src.map((p) => ({ ...p })), length: 0 };
  let dense = [];
  if (src.length === 2) {
    const a = src[0], b = src[1];
    const len = dist(a.x, a.y, b.x, b.y);
    const n = Math.max(1, Math.ceil(len / spacing));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      dense.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  } else {
    const ext = [src[0], ...src, src[src.length - 1]];
    for (let i = 1; i < ext.length - 2; i++) {
      const p0 = ext[i - 1], p1 = ext[i], p2 = ext[i + 1], p3 = ext[i + 2];
      const segLen = dist(p1.x, p1.y, p2.x, p2.y);
      const n = Math.max(2, Math.ceil(segLen / spacing));
      for (let j = 0; j < n; j++) {
        const t = j / n;
        dense.push(catmull(p0, p1, p2, p3, t));
      }
    }
    dense.push({ ...src[src.length - 1] });
  }
  dense = dedupe(dense);
  const cumulative = [0];
  for (let i = 1; i < dense.length; i++) {
    cumulative.push(cumulative[i - 1] + dist(dense[i - 1].x, dense[i - 1].y, dense[i].x, dense[i].y));
  }
  return { points: dense, cumulative, length: cumulative[cumulative.length - 1] };
}

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

function dedupe(points) {
  const out = [];
  for (const p of points) {
    if (!out.length || dist(out[out.length - 1].x, out[out.length - 1].y, p.x, p.y) > 0.01) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** Point and tangent at distance s along a sampled polyline. */
export function pointAtDistance(geo, s) {
  const pts = geo.points;
  if (!pts.length) return { x: 0, y: 0, heading: 0, nx: 0, ny: 0 };
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, heading: 0, nx: 0, ny: 1 };
  const len = geo.length;
  s = clamp(s, 0, len);
  const cum = geo.cumulative;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const a = pts[lo], b = pts[Math.min(lo + 1, pts.length - 1)];
  const segLen = Math.max(1e-6, cum[Math.min(lo + 1, cum.length - 1)] - cum[lo]);
  const t = (s - cum[lo]) / segLen;
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  const dx = b.x - a.x, dy = b.y - a.y;
  const dl = Math.hypot(dx, dy) || 1;
  const heading = Math.atan2(dy, dx);
  return { x, y, heading, nx: -dy / dl, ny: dx / dl, dx: dx / dl, dy: dy / dl };
}

export function offsetPolyline(geo, offset) {
  const out = [];
  const pts = geo.points;
  for (let i = 0; i < pts.length; i++) {
    const p = pointAtDistance(geo, geo.cumulative ? geo.cumulative[i] : 0);
    out.push({ x: p.x + p.nx * offset, y: p.y + p.ny * offset });
  }
  return out;
}

export function buildLaneGeometry(centerline, offset, spacing = 1.5) {
  return sampleCenterline(offsetPolyline(centerline, offset), spacing);
}

export function cubicBezier(p0, p1, p2, p3, n = 16) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, mt = 1 - t;
    out.push({
      x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
      y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

export function turnCurve(start, startHeading, end, endHeading, strength = 0.42) {
  const d = dist(start.x, start.y, end.x, end.y);
  const c = Math.max(8, d * strength);
  const p1 = { x: start.x + Math.cos(startHeading) * c, y: start.y + Math.sin(startHeading) * c };
  const p2 = { x: end.x - Math.cos(endHeading) * c, y: end.y - Math.sin(endHeading) * c };
  return cubicBezier(start, p1, p2, end, Math.max(10, Math.ceil(d / 1.5)));
}

export function projectPointToPolyline(px, py, points) {
  let best = { distance: Infinity, s: 0, point: null, index: 0 };
  let acc = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    if (l2 < 1e-9) continue;
    let t = ((px - a.x) * dx + (py - a.y) * dy) / l2;
    t = clamp(t, 0, 1);
    const x = a.x + dx * t, y = a.y + dy * t;
    const d = Math.hypot(px - x, py - y);
    if (d < best.distance) best = { distance: d, s: acc + t * Math.sqrt(l2), point: { x, y }, index: i };
    acc += Math.sqrt(l2);
  }
  return best;
}

export function polylineMidpoint(points) {
  const geo = sampleCenterline(points, 2);
  return pointAtDistance(geo, geo.length / 2);
}

export function pathLength(points) {
  return polylineLength(points);
}

export function pointAtPath(points, s) {
  const geo = sampleCenterline(points, 1);
  return pointAtDistance(geo, s);
}

export function boundsOfPoints(points, pad = 0) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}
