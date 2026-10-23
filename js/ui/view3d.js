import {
  clamp, mixHex, mulberry32, shade,
} from '../core/utils.js';

/**
 * Lightweight procedural 3D perspective renderer.
 *
 * Everything is drawn with the 2D canvas API using a painter's algorithm:
 * road polygons, extruded buildings, street trees, signal poles and live
 * vehicle boxes. There is no WebGL dependency and no external 3D library.
 */
export class View3D {
  constructor(app) {
    this.app = app;
    this.canvas = document.getElementById('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.camera = { tx: 0, tz: 0, yaw: -0.30, pitch: 0.46, distance: 980 };
    this.drag = null;
    this.isDragging = false;
    this.sun = Number(app.project?.settings?.timeOfDay ?? 9);
    this.focal = 600;
    this.horizonY = 100;
    this.sceneryRevision = -1;
    this.scenery = emptyScenery();
    this._sunRange = document.getElementById('sun-range');
    if (this._sunRange) {
      this._sunRange.value = String(clamp(this.sun, 6, 21));
      this._sunRange.addEventListener('input', () => {
        this.setTimeOfDay(parseFloat(this._sunRange.value), true);
      });
    }
    this.fit();
  }

  resize(width, height, dpr = 1) {
    this.width = Math.max(10, width);
    this.height = Math.max(10, height);
    this.dpr = dpr || 1;
  }

  fit() {
    const b = this.app.network?.bounds() || { minX: -400, minY: -250, maxX: 400, maxY: 250, width: 800, height: 500 };
    const span = Math.max(b.width || 200, b.height || 200, 160);
    const aspect = clamp(this.width / Math.max(1, this.height), 0.85, 2.2);
    this.camera.tx = (b.minX + b.maxX) / 2;
    this.camera.tz = (b.minY + b.maxY) / 2;
    // Frame the network across roughly 80-85% of the viewport width, while
    // leaving enough headroom for the near edge of the road plane.
    this.camera.distance = clamp(span * (0.95 / aspect) + 50, 200, 4200);
    this.camera.pitch = 0.46;
    this.camera.yaw = -0.30;
  }

  setTimeOfDay(hour, notify = false) {
    this.sun = clamp(Number(hour) || 9, 6, 21);
    if (this._sunRange) this._sunRange.value = String(this.sun);
    if (notify) this.app.onTimeOfDayChange?.(this.sun);
  }

  syncTimeOfDay() {
    this.sun = clamp(Number(this.app.project?.settings?.timeOfDay ?? 9), 6, 21);
    if (this._sunRange) this._sunRange.value = String(this.sun);
  }

  onPointerDown(e) {
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
    this.drag = {
      x: e.clientX, y: e.clientY,
      yaw: this.camera.yaw, pitch: this.camera.pitch,
      tx: this.camera.tx, tz: this.camera.tz,
      pan: e.button === 1 || e.shiftKey,
    };
    this.isDragging = true;
    this.canvas.style.cursor = this.drag.pan ? 'move' : 'grabbing';
  }

  onPointerMove(e) {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    if (this.drag.pan) {
      const k = this.camera.distance * 0.0015;
      const right = { x: Math.cos(this.camera.yaw), z: -Math.sin(this.camera.yaw) };
      const forward = { x: -Math.sin(this.camera.yaw), z: -Math.cos(this.camera.yaw) };
      this.camera.tx = this.drag.tx - right.x * dx * k + forward.x * dy * k;
      this.camera.tz = this.drag.tz - right.z * dx * k + forward.z * dy * k;
    } else {
      this.camera.yaw = this.drag.yaw - dx * 0.006;
      this.camera.pitch = clamp(this.drag.pitch + dy * 0.0035, 0.08, 1.25);
    }
  }

  onPointerUp() {
    this.drag = null;
    this.isDragging = false;
    this.canvas.style.cursor = '';
  }

  onWheel(e) {
    e.preventDefault();
    this.camera.distance = clamp(this.camera.distance * Math.exp(e.deltaY * 0.0012), 60, 5200);
  }

  // --------------------------------------------------------------- rendering
  render(now = performance.now()) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    if (w < 4 || h < 4) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (this.app.revision !== this.sceneryRevision) {
      this.scenery = buildScenery(this.app);
      this.sceneryRevision = this.app.revision;
    }

    this.focal = h * 0.95;
    this._updateCamera();
    const palette = paletteFor(this.sun);
    const horizon = clamp(h * 0.52 - Math.tan(this.camera.pitch) * this.focal, h * 0.02, h * 0.84);
    this.horizonY = horizon;
    this._drawBackground(ctx, palette, horizon, now);

    const scene = [];
    for (const face of this.scenery.faces) this._projectFace(face, scene);
    for (const tree of this.scenery.trees) this._projectTree(tree, scene, palette);
    this._projectSignals(scene, palette);
    this._projectTraffic(scene, palette);
    scene.sort((a, b) => b.depth - a.depth);
    for (const item of scene) this._drawSceneItem(ctx, item, palette);

    // Atmospheric colour grade and lens vignette.
    if (palette.grade) {
      ctx.fillStyle = palette.grade;
      ctx.fillRect(0, 0, w, h);
    }
    const vignette = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,.34)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }

  _updateCamera() {
    const { tx, tz, yaw, pitch, distance } = this.camera;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    this.cam = {
      x: tx + Math.sin(yaw) * distance * cp,
      y: distance * sp + 9,
      z: tz + Math.cos(yaw) * distance * cp,
    };
    this.fwd = { x: -Math.sin(yaw) * cp, y: -sp, z: -Math.cos(yaw) * cp };
    this.right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
    this.up = {
      x: this.right.y * this.fwd.z - this.right.z * this.fwd.y,
      y: this.right.z * this.fwd.x - this.right.x * this.fwd.z,
      z: this.right.x * this.fwd.y - this.right.y * this.fwd.x,
    };
  }

  project(p) {
    const dx = p.x - this.cam.x;
    const dy = (p.y ?? 0) - this.cam.y;
    const dz = (p.z ?? p.y ?? 0) - this.cam.z;
    const z = dx * this.fwd.x + dy * this.fwd.y + dz * this.fwd.z;
    if (z <= 0.35) return null;
    const sx = dx * this.right.x + dy * this.right.y + dz * this.right.z;
    const sy = dx * this.up.x + dy * this.up.y + dz * this.up.z;
    const scale = this.focal / z;
    return {
      x: this.width / 2 + sx * scale,
      y: this.height * 0.52 - sy * scale,
      z, scale,
    };
  }

  _projectFace(face, scene) {
    if (face.hidden) return;
    const pts = [];
    let depth = 0;
    for (const wp of face.pts) {
      const p = this.project(wp);
      if (!p) return;
      pts.push(p);
      depth += p.z;
    }
    depth /= pts.length;
    scene.push({
      kind: 'poly', pts, depth: depth + (face.bias || 0),
      fill: face.fill, stroke: face.stroke, lineWidth: face.lineWidth || 1,
    });
  }

  _projectTree(tree, scene, palette) {
    const base = this.project({ x: tree.x, y: 0, z: tree.z });
    const top = this.project({ x: tree.x, y: tree.height, z: tree.z });
    if (!base || !top) return;
    scene.push({
      kind: 'tree', base, top, depth: top.z,
      radius: Math.max(2, top.scale * tree.radius),
      color: tree.color || palette.tree,
    });
  }

  _projectSignals(scene, palette) {
    for (const head of this.scenery.signals) {
      const state = this.app.signalStateFor?.(head.linkId) || 'red';
      const active = state === 'green' ? 2 : state === 'yellow' ? 1 : 0;
      const colors = ['#f87171', '#fbbf24', '#34d399'];
      for (let i = 0; i < 3; i++) {
        const p = this.project({ x: head.x, y: head.y + 0.55 - i * 0.5, z: head.z });
        if (!p) continue;
        scene.push({
          kind: 'lamp', x: p.x, y: p.y, r: Math.max(1.6, p.scale * 0.16),
          depth: p.z - 0.06, color: i === active ? colors[i] : '#3a4653',
          glow: i === active, halo: i === active ? colors[i] : null,
        });
      }
    }
  }

  _projectTraffic(scene, palette) {
    const sim = this.app.sim;
    if (!sim) return;
    for (const ped of sim.peds || []) {
      const base = { x: ped.x, y: 0.02, z: ped.y };
      this._boxFaces(scene, base.x, base.z, Math.cos(ped.heading || 0), Math.sin(ped.heading || 0),
        0.46, 0.46, 1.68, 0.04, '#f472b6', { depthBias: -0.05, small: true });
    }
    for (const v of sim.vehicles || []) {
      if (v.finished) continue;
      let pose;
      try { pose = sim.vehiclePose(v); } catch { continue; }
      const f = { x: Math.cos(pose.heading), z: Math.sin(pose.heading) };
      const color = v.color || '#dbe7f3';
      this._boxFaces(scene, pose.x, pose.y, f.x, f.z, v.length, v.width, Math.max(1.1, v.height || 1.5), 0.12, color, {
        depthBias: -0.08,
        roof: v.classCategory === 'bus' || v.classCategory === 'truck',
        category: v.classCategory,
      });
      // rear lights for braking vehicles
      if (v.classCategory !== 'bike' && (v.acc < -0.25 || v.v < 0.3)) {
        const rx = pose.x - f.x * v.length * 0.5;
        const rz = pose.y - f.z * v.length * 0.5;
        const side = { x: -f.z, z: f.x };
        for (const s of [-1, 1]) {
          const p = this.project({
            x: rx + side.x * v.width * 0.33 * s,
            y: 0.72,
            z: rz + side.z * v.width * 0.33 * s,
          });
          if (p) scene.push({ kind: 'lamp', x: p.x, y: p.y, r: Math.max(1, p.scale * 0.08), depth: p.z - 0.2, color: '#ef4444', glow: false });
        }
      }
    }
  }

  _boxFaces(scene, cx, cz, fx, fz, along, across, height, baseY, color, opts = {}) {
    const rx = -fz, rz = fx;
    const L = along / 2, W = across / 2;
    const b = [
      { x: cx - fx * L - rx * W, y: baseY, z: cz - fz * L - rz * W },
      { x: cx + fx * L - rx * W, y: baseY, z: cz + fz * L - rz * W },
      { x: cx + fx * L + rx * W, y: baseY, z: cz + fz * L + rz * W },
      { x: cx - fx * L + rx * W, y: baseY, z: cz - fz * L + rz * W },
    ];
    const t = b.map((p) => ({ x: p.x, y: baseY + height, z: p.z }));
    const bias = opts.depthBias || 0;
    this._addFace(scene, [t[0], t[1], t[2], t[3]], shade(color, 0.12), bias - 0.02);
    this._addFace(scene, [b[0], b[1], t[1], t[0]], shade(color, -0.28), bias);
    this._addFace(scene, [b[2], b[3], t[3], t[2]], shade(color, -0.22), bias);
    this._addFace(scene, [b[1], b[2], t[2], t[1]], shade(color, -0.08), bias);
    this._addFace(scene, [b[3], b[0], t[0], t[3]], shade(color, -0.14), bias);
    // dark windscreen strip on the leading face
    if (opts.category && opts.category !== 'moto' && opts.category !== 'bike') {
      const winY = baseY + height * 0.58;
      const winH = height * 0.23;
      const front = [
        { x: cx + fx * (L + 0.015) - rx * W * 0.8, y: winY, z: cz + fz * (L + 0.015) - rz * W * 0.8 },
        { x: cx + fx * (L + 0.015) + rx * W * 0.8, y: winY, z: cz + fz * (L + 0.015) + rz * W * 0.8 },
        { x: cx + fx * (L + 0.015) + rx * W * 0.8, y: winY + winH, z: cz + fz * (L + 0.015) + rz * W * 0.8 },
        { x: cx + fx * (L + 0.015) - rx * W * 0.8, y: winY + winH, z: cz + fz * (L + 0.015) - rz * W * 0.8 },
      ];
      this._addFace(scene, front, 'rgba(8,18,28,.78)', bias - 0.05);
    }
  }

  _projectFaceToScene(face, scene) {
    this._projectFace(face, scene);
  }

  _addFace(scene, points, fill, bias = 0) {
    this._projectFace({ pts: points, fill, bias, stroke: null }, scene);
  }

  // ------------------------------------------------------------- backdrop
  _drawBackground(ctx, palette, horizon, now) {
    const w = this.width;
    const h = this.height;
    const sky = ctx.createLinearGradient(0, 0, 0, Math.max(10, horizon));
    sky.addColorStop(0, palette.skyTop);
    sky.addColorStop(0.72, palette.skyMid);
    sky.addColorStop(1, palette.skyLow);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    this._drawSun(ctx, palette, horizon, now);
    this._drawClouds(ctx, palette, horizon);
    this._drawSkyline(ctx, palette, horizon);

    const ground = ctx.createLinearGradient(0, horizon, 0, h);
    ground.addColorStop(0, palette.groundFar);
    ground.addColorStop(0.35, palette.groundMid);
    ground.addColorStop(1, palette.groundNear);
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizon, w, h - horizon);

    const glow = ctx.createLinearGradient(0, horizon - 40, 0, horizon + 50);
    glow.addColorStop(0, 'rgba(255,255,255,0)');
    glow.addColorStop(0.72, palette.horizonGlow);
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, horizon - 40, w, 90);
  }

  _drawSun(ctx, palette, horizon, now) {
    const day = (this.sun - 6) / 15;
    const elevation = Math.sin(clamp(day, 0, 1) * Math.PI);
    if (elevation <= 0.02) return;
    const x = this.width * (0.12 + day * 0.76);
    const y = horizon - elevation * this.height * 0.58;
    const r = Math.max(16, this.height * 0.035);
    const glow = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 7);
    glow.addColorStop(0, palette.sunGlow);
    glow.addColorStop(0.35, hexA(palette.sunColor, 0.16));
    glow.addColorStop(1, hexA(palette.sunColor, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.sunColor;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawClouds(ctx, palette, horizon) {
    const w = this.width;
    const h = this.height;
    const y0 = horizon - h * 0.19;
    ctx.save();
    for (let i = 0; i < 5; i++) {
      const x = ((i * 227 + 90) % (w + 300)) - 100;
      const y = y0 + Math.sin(i * 2.4) * h * 0.075 - h * 0.04;
      const cw = w * (0.11 + (i % 3) * 0.035);
      const ch = cw * 0.19;
      const g = ctx.createRadialGradient(x, y, 0, x, y, cw);
      g.addColorStop(0, hexA(palette.cloud, 0.24));
      g.addColorStop(0.55, hexA(palette.cloud, 0.1));
      g.addColorStop(1, hexA(palette.cloud, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, cw, ch, -0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + cw * 0.42, y - ch * 0.7, cw * 0.52, ch * 0.8, 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawSkyline(ctx, palette, horizon) {
    const w = this.width;
    const offset = (this.camera.yaw * 150) % 90;
    const seed = 73;
    const rng = mulberry32(seed);
    ctx.save();
    ctx.fillStyle = palette.skyline;
    let x = -100 + offset;
    while (x < w + 100) {
      const bw = 22 + rng() * 55;
      const bh = 8 + rng() * 58;
      ctx.fillRect(x, horizon - bh, bw, bh + 2);
      if (rng() > 0.62) ctx.fillRect(x + bw * 0.18, horizon - bh - 10 - rng() * 18, bw * 0.28, 25);
      x += bw + 3 + rng() * 9;
    }
    ctx.fillStyle = palette.skylineFar;
    x = -60 - offset * 0.6;
    while (x < w + 80) {
      const bw = 40 + rng() * 80;
      const bh = 6 + rng() * 35;
      ctx.fillRect(x, horizon - bh, bw, bh + 2);
      x += bw + 5 + rng() * 13;
    }
    ctx.restore();
  }

  _drawSceneItem(ctx, item, palette) {
    if (item.kind === 'poly') {
      if (!item.pts.length) return;
      ctx.beginPath();
      ctx.moveTo(item.pts[0].x, item.pts[0].y);
      for (let i = 1; i < item.pts.length; i++) ctx.lineTo(item.pts[i].x, item.pts[i].y);
      ctx.closePath();
      ctx.fillStyle = item.fill;
      ctx.fill();
      if (item.stroke) {
        ctx.strokeStyle = item.stroke;
        ctx.lineWidth = item.lineWidth || 1;
        ctx.stroke();
      }
    } else if (item.kind === 'tree') {
      const { base, top } = item;
      ctx.strokeStyle = shade(palette.treeTrunk, -0.08);
      ctx.lineWidth = Math.max(1, top.scale * 0.18);
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(top.x, top.y + item.radius * 0.25);
      ctx.stroke();
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(top.x, top.y, item.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.06)';
      ctx.beginPath();
      ctx.arc(top.x - item.radius * 0.28, top.y - item.radius * 0.28, item.radius * 0.55, 0, Math.PI * 2);
      ctx.fill();
    } else if (item.kind === 'lamp') {
      if (item.glow) {
        ctx.save();
        ctx.shadowColor = item.halo || item.color;
        ctx.shadowBlur = Math.max(4, item.r * 4);
        ctx.fillStyle = item.color;
        ctx.beginPath();
        ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = item.color;
        ctx.beginPath();
        ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// --------------------------------------------------------------- scenery
function emptyScenery() {
  return { faces: [], trees: [], signals: [] };
}

function buildScenery(app) {
  const scenery = emptyScenery();
  const p = app.project;
  const net = app.network;
  if (!net) return scenery;
  const add = (pts, fill, opts = {}) => {
    scenery.faces.push({
      pts, fill,
      bias: opts.bias || 0,
      stroke: opts.stroke || null,
      lineWidth: opts.lineWidth || 1,
    });
  };
  const quad = (a, b, c, d, fill, opts) => add([a, b, c, d], fill, opts);
  const y = (v) => v;

  // Junction aprons.
  for (const node of p.nodes) {
    if (node.type === 'boundary') continue;
    const r = Math.max(7, (node.radius || 15) * 0.9);
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      pts.push({ x: node.x + Math.cos(a) * r, y: y(0.035), z: node.y + Math.sin(a) * r });
    }
    add(pts, '#252e38', { bias: 0.35 });
  }

  for (const link of p.links) {
    if (link.display === false) continue;
    const wide = net.width(link.id);
    const cw = link.laneWidth || 3.4;
    const pts = decimate(net.centerPolyline(link.id), 4.5);
    if (pts.length < 2) continue;

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const hw = wide / 2;
      const sw = link.sidewalk === false ? 0 : 2.1;
      if (sw > 0) {
        quad(
          { x: a.x + nx * hw, y: y(0.018), z: a.y + ny * hw },
          { x: b.x + nx * hw, y: y(0.018), z: b.y + ny * hw },
          { x: b.x + nx * (hw + sw), y: y(0.018), z: b.y + ny * (hw + sw) },
          { x: a.x + nx * (hw + sw), y: y(0.018), z: a.y + ny * (hw + sw) },
          '#2b3440', { bias: 0.3 },
        );
        quad(
          { x: a.x - nx * hw, y: y(0.018), z: a.y - ny * hw },
          { x: b.x - nx * hw, y: y(0.018), z: b.y - ny * hw },
          { x: b.x - nx * (hw + sw), y: y(0.018), z: b.y - ny * (hw + sw) },
          { x: a.x - nx * (hw + sw), y: y(0.018), z: a.y - ny * (hw + sw) },
          '#2b3440', { bias: 0.3 },
        );
        // curb faces
        quad(
          { x: a.x + nx * hw, y: y(0.02), z: a.y + ny * hw },
          { x: b.x + nx * hw, y: y(0.02), z: b.y + ny * hw },
          { x: b.x + nx * hw, y: y(0.13), z: b.y + ny * hw },
          { x: a.x + nx * hw, y: y(0.13), z: a.y + ny * hw },
          '#35414e', { bias: 0.1 },
        );
        quad(
          { x: a.x - nx * hw, y: y(0.02), z: a.y - ny * hw },
          { x: b.x - nx * hw, y: y(0.02), z: b.y - ny * hw },
          { x: b.x - nx * hw, y: y(0.13), z: b.y - ny * hw },
          { x: a.x - nx * hw, y: y(0.13), z: a.y - ny * hw },
          '#35414e', { bias: 0.1 },
        );
      }
      quad(
        { x: a.x + nx * hw, y: y(0.03), z: a.y + ny * hw },
        { x: b.x + nx * hw, y: y(0.03), z: b.y + ny * hw },
        { x: b.x - nx * hw, y: y(0.03), z: b.y - ny * hw },
        { x: a.x - nx * hw, y: y(0.03), z: a.y - ny * hw },
        link.type === 'arterial' ? '#222a34' : '#202832', { bias: 0.25 },
      );

      // edge lines
      for (const side of [-1, 1]) {
        const off = hw - 0.17;
        quad(
          { x: a.x + nx * off * side - nx * 0.08, y: y(0.045), z: a.y + ny * off * side - ny * 0.08 },
          { x: b.x + nx * off * side - nx * 0.08, y: y(0.045), z: b.y + ny * off * side - ny * 0.08 },
          { x: b.x + nx * off * side + nx * 0.08, y: y(0.045), z: b.y + ny * off * side + ny * 0.08 },
          { x: a.x + nx * off * side + nx * 0.08, y: y(0.045), z: a.y + ny * off * side + ny * 0.08 },
          'rgba(214,229,241,.37)', { bias: -0.2 },
        );
      }
    }

    // dashed lane separators
    const dense = net.centerPolyline(link.id);
    for (let lane = 1; lane < (link.lanes || 1); lane++) {
      const off = wide / 2 - lane * cw;
      for (let i = 0; i + 4 < dense.length; i += 8) {
        const a = dense[i], b = dense[i + 4];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        quad(
          { x: a.x + nx * off - nx * 0.07, y: y(0.05), z: a.y + ny * off - ny * 0.07 },
          { x: b.x + nx * off - nx * 0.07, y: y(0.05), z: b.y + ny * off - ny * 0.07 },
          { x: b.x + nx * off + nx * 0.07, y: y(0.05), z: b.y + ny * off + ny * 0.07 },
          { x: a.x + nx * off + nx * 0.07, y: y(0.05), z: a.y + ny * off + ny * 0.07 },
          'rgba(232,241,248,.45)', { bias: -0.28 },
        );
      }
    }
  }

  // Crossings and loop detectors.
  for (const cw of p.crosswalks) {
    const link = net.link(cw.linkId);
    if (!link) continue;
    const len = net.lengthOf(cw.linkId);
    const pos = net.centerPosition(cw.linkId, clamp(cw.pos, 0, 1) * len);
    const wide = net.width(cw.linkId);
    const f = { x: Math.cos(pos.heading), z: Math.sin(pos.heading) };
    const n = { x: -f.z, z: f.x };
    const stripe = 0.62;
    const gap = 0.68;
    const total = cw.width || 4;
    for (let x = -total / 2; x + stripe <= total / 2; x += stripe + gap) {
      const cx = pos.x + f.x * (x + stripe / 2);
      const cz = pos.y + f.z * (x + stripe / 2);
      add([
        { x: cx - f.x * stripe / 2 - n.x * wide / 2, y: y(0.062), z: cz - f.z * stripe / 2 - n.z * wide / 2 },
        { x: cx + f.x * stripe / 2 - n.x * wide / 2, y: y(0.062), z: cz + f.z * stripe / 2 - n.z * wide / 2 },
        { x: cx + f.x * stripe / 2 + n.x * wide / 2, y: y(0.062), z: cz + f.z * stripe / 2 + n.z * wide / 2 },
        { x: cx - f.x * stripe / 2 + n.x * wide / 2, y: y(0.062), z: cz - f.z * stripe / 2 + n.z * wide / 2 },
      ], 'rgba(224,236,246,.7)', { bias: -0.55 });
    }
  }

  for (const d of p.detectors) {
    const link = net.link(d.linkId);
    if (!link) continue;
    const len = net.lengthOf(d.linkId);
    const pos = net.position(d.linkId, d.lane ?? 0, clamp(d.pos, 0, 1) * len);
    const w = link.laneWidth || 3.4;
    const l = d.length || 2;
    const f = { x: Math.cos(pos.heading), z: Math.sin(pos.heading) };
    const n = { x: -f.z, z: f.x };
    add([
      { x: pos.x - f.x * l / 2 - n.x * w / 2, y: y(0.068), z: pos.y - f.z * l / 2 - n.z * w / 2 },
      { x: pos.x + f.x * l / 2 - n.x * w / 2, y: y(0.068), z: pos.y + f.z * l / 2 - n.z * w / 2 },
      { x: pos.x + f.x * l / 2 + n.x * w / 2, y: y(0.068), z: pos.y + f.z * l / 2 + n.z * w / 2 },
      { x: pos.x - f.x * l / 2 + n.x * w / 2, y: y(0.068), z: pos.y - f.z * l / 2 + n.z * w / 2 },
    ], 'rgba(34,211,238,.35)', { bias: -0.5, stroke: 'rgba(34,211,238,.6)' });
  }

  // Buildings, windows and trees along each street.
  const occupied = new Map();
  for (const link of p.links) {
    const len = net.lengthOf(link.id);
    if (len < 70) continue;
    const wide = net.width(link.id);
    for (const side of [-1, 1]) {
      const key = `${link.id}:${side}`;
      const used = [];
      const rng = mulberry32(hashString(`${link.id}:${side}:${p.nodes.length}`));
      let s = 48 + rng() * 26;
      while (s < len - 48) {
        const front = 15 + rng() * 15;
        const depth = 13 + rng() * 15;
        const widthB = 14 + rng() * 24;
        const gap = 7 + rng() * 10;
        const half = widthB / 2;
        if (used.some(([a, b]) => s + half > a - 4 && s - half < b + 4)) { s += 12; continue; }
        if (s - half < 40 || s + half > len - 40) { s += 15; continue; }
        used.push([s - half, s + half]);
        occupied.set(key, used);
        const pos = net.centerPosition(link.id, s);
        const off = wide / 2 + front + depth / 2;
        const bx = pos.x + pos.nx * off * side;
        const bz = pos.y + pos.ny * off * side;
        const height = 8 + rng() * 28 + (rng() > 0.88 ? 16 : 0);
        const f = { x: Math.cos(pos.heading), z: Math.sin(pos.heading) };
        // The road-facing side is opposite to the offset direction.
        addBuilding(add, bx, bz, f.x, f.z, widthB, depth, height, side, rng);
        if (height > 18 && rng() > 0.35) {
          const n = 1 + Math.floor(rng() * 3);
          for (let k = 0; k < n; k++) {
            const tx = bx + f.x * (rng() - 0.5) * widthB * 0.6;
            const tz = bz + f.z * (rng() - 0.5) * widthB * 0.6;
            scenery.trees.push({
              x: tx - pos.nx * side * (depth / 2 + 2.5),
              z: tz - pos.ny * side * (depth / 2 + 2.5),
              height: 4.2 + rng() * 3.2,
              radius: 1.6 + rng() * 1.2,
              color: pickTreeColor(rng),
            });
          }
        }
        s += widthB + gap;
      }
    }
    // sparse sidewalk trees
    const rng = mulberry32(hashString(`${link.id}:street-trees`));
    for (let s = 28; s < len - 28; s += 23 + rng() * 18) {
      const pos = net.centerPosition(link.id, s);
      const side = rng() > 0.5 ? 1 : -1;
      if (rng() > 0.48) {
        scenery.trees.push({
          x: pos.x + pos.nx * (net.width(link.id) / 2 + 3.1) * side,
          z: pos.y + pos.ny * (net.width(link.id) / 2 + 3.1) * side,
          height: 4 + rng() * 2.6,
          radius: 1.2 + rng() * 0.9,
          color: pickTreeColor(rng),
        });
      }
    }
  }

  // Signal poles and head boxes.
  for (const head of p.signalHeads) {
    const link = net.link(head.linkId);
    if (!link) continue;
    const len = net.lengthOf(head.linkId);
    const pos = net.position(head.linkId, 0, clamp(head.pos, 0, 1) * len);
    const off = net.width(head.linkId) / 2 + 2.2;
    const x = pos.x + pos.nx * off;
    const z = pos.y + pos.ny * off;
    const f = { x: Math.cos(pos.heading), z: Math.sin(pos.heading) };
    addPole(add, x, z, 5.1);
    const hx = x;
    const hz = z;
    addHead(add, hx, hz, f.x, f.z);
    scenery.signals.push({ x: hx, z: hz, y: 5.18, linkId: head.linkId });
  }

  return scenery;
}

function addBuilding(add, cx, cz, fx, fz, along, across, height, side, rng) {
  const rx = -fz, rz = fx;
  const L = along / 2, W = across / 2;
  const b = [
    { x: cx - fx * L - rx * W, y: 0, z: cz - fz * L - rz * W },
    { x: cx + fx * L - rx * W, y: 0, z: cz + fz * L - rz * W },
    { x: cx + fx * L + rx * W, y: 0, z: cz + fz * L + rz * W },
    { x: cx - fx * L + rx * W, y: 0, z: cz - fz * L + rz * W },
  ];
  const top = b.map((p) => ({ x: p.x, y: height, z: p.z }));
  const wall = pickWall(rng);
  const roof = shade(wall, 0.1);
  add([b[0], b[1], top[1], top[0]], shade(wall, -0.23), { bias: 0.02 });
  add([b[1], b[2], top[2], top[1]], shade(wall, -0.13), { bias: 0.01 });
  add([b[2], b[3], top[3], top[2]], shade(wall, -0.18), { bias: 0.03 });
  add([b[3], b[0], top[0], top[3]], shade(wall, -0.1), { bias: 0.01 });
  add(top, roof, { bias: 0.2 });
  // rooftop edge
  add([
    { x: top[0].x, y: top[0].y + 0.22, z: top[0].z },
    { x: top[1].x, y: top[1].y + 0.22, z: top[1].z },
    { x: top[2].x, y: top[2].y + 0.22, z: top[2].z },
    { x: top[3].x, y: top[3].y + 0.22, z: top[3].z },
  ], 'rgba(210,225,238,.12)', { bias: 0.15 });

  // windows on the road-facing facade
  const faceSide = -side; // +1 means the +r side of the box
  const cols = clamp(Math.floor(along / 3.7), 2, 5);
  const rows = clamp(Math.floor((height - 4.4) / 3.2), 1, 5);
  const startY = 2.8;
  const winW = Math.min(1.0, (along / cols) * 0.45);
  const winH = 1.15;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = -L + (c + 0.5) * (along / cols);
      const wy = startY + r * ((height - startY - 1.4) / Math.max(1, rows - 1 || 1));
      if (wy + winH > height - 0.7) continue;
      const lit = rng() > 0.42;
      const fill = lit ? `rgba(251,191,36,${0.3 + rng() * 0.42})` : 'rgba(23,38,52,.66)';
      const off = faceSide * (W + 0.03);
      add([
        { x: cx + fx * (u - winW / 2) + rx * off, y: wy, z: cz + fz * (u - winW / 2) + rz * off },
        { x: cx + fx * (u + winW / 2) + rx * off, y: wy, z: cz + fz * (u + winW / 2) + rz * off },
        { x: cx + fx * (u + winW / 2) + rx * off, y: wy + winH, z: cz + fz * (u + winW / 2) + rz * off },
        { x: cx + fx * (u - winW / 2) + rx * off, y: wy + winH, z: cz + fz * (u - winW / 2) + rz * off },
      ], fill, { bias: -0.1 });
    }
  }
}

function addPole(add, x, z, height) {
  const s = 0.11;
  add([
    { x: x - s, y: 0, z: z - s }, { x: x + s, y: 0, z: z - s },
    { x: x + s, y: height, z: z - s }, { x: x - s, y: height, z: z - s },
  ], '#2d3945');
  add([
    { x: x - s, y: 0, z: z + s }, { x: x + s, y: 0, z: z + s },
    { x: x + s, y: height, z: z + s }, { x: x - s, y: height, z: z + s },
  ], '#3a4754');
}

function addHead(add, x, z, fx, fz) {
  const rx = -fz * 0.24, rz = fx * 0.24;
  const y0 = 4.95, y1 = 6.46;
  add([
    { x: x - rx, y: y0, z: z - rz }, { x: x + rx, y: y0, z: z + rz },
    { x: x + rx, y: y1, z: z + rz }, { x: x - rx, y: y1, z: z - rz },
  ], '#111a22', { bias: -0.32 });
  add([
    { x: x - rx - fx * 0.11, y: y0, z: z - rz - fz * 0.11 },
    { x: x + rx - fx * 0.11, y: y0, z: z + rz - fz * 0.11 },
    { x: x + rx - fx * 0.11, y: y1, z: z + rz - fz * 0.11 },
    { x: x - rx - fx * 0.11, y: y1, z: z - rz - fz * 0.11 },
  ], '#1c2731', { bias: -0.34 });
}

function decimate(points, maxStep) {
  if (!points || points.length < 2) return points || [];
  const out = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length; i++) {
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= maxStep || i === points.length - 1) {
      out.push(points[i]);
      last = points[i];
    }
  }
  return out;
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickWall(rng) {
  const palette = ['#39424d', '#3e4650', '#424a55', '#4a4f58', '#333d48', '#50535a', '#3a464c'];
  return palette[Math.floor(rng() * palette.length)];
}

function pickTreeColor(rng) {
  const palette = ['#1d4538', '#24503d', '#1f3e35', '#2a5544'];
  return palette[Math.floor(rng() * palette.length)];
}

// ----------------------------------------------------------------- palette
const PALETTES = [
  {
    hour: 5, skyTop: '#060c18', skyMid: '#112033', skyLow: '#3b3c4b',
    groundFar: '#1c2a2a', groundMid: '#13201a', groundNear: '#0a120e',
    sunColor: '#ffb27b', sunGlow: 'rgba(255,148,85,.32)', cloud: '#8f8aa2',
    skyline: '#0b1520', skylineFar: '#0e1a25', horizonGlow: 'rgba(235,150,100,.12)',
    tree: '#1b3b30', treeTrunk: '#3a3025', grade: 'rgba(20,28,55,.18)',
  },
  {
    hour: 7.5, skyTop: '#0e2c4a', skyMid: '#295574', skyLow: '#bc8c75',
    groundFar: '#26352f', groundMid: '#1a2921', groundNear: '#0d1712',
    sunColor: '#ffd09b', sunGlow: 'rgba(255,190,125,.32)', cloud: '#dfd4cd',
    skyline: '#152230', skylineFar: '#1b2a38', horizonGlow: 'rgba(255,190,130,.14)',
    tree: '#204637', treeTrunk: '#48392a', grade: 'rgba(255,190,130,.035)',
  },
  {
    hour: 12, skyTop: '#16466c', skyMid: '#4a86a9', skyLow: '#c6d9e2',
    groundFar: '#33443c', groundMid: '#22332a', groundNear: '#111d17',
    sunColor: '#fff5d6', sunGlow: 'rgba(255,250,224,.28)', cloud: '#f2f6f8',
    skyline: '#1b2c3b', skylineFar: '#243746', horizonGlow: 'rgba(255,255,255,.13)',
    tree: '#28523f', treeTrunk: '#4b3c2c', grade: null,
  },
  {
    hour: 17.5, skyTop: '#10304e', skyMid: '#3b6079', skyLow: '#d99468',
    groundFar: '#2c3a34', groundMid: '#202b24', groundNear: '#0f1914',
    sunColor: '#ffcf8f', sunGlow: 'rgba(255,164,90,.34)', cloud: '#e7cfbf',
    skyline: '#172431', skylineFar: '#1f2e3b', horizonGlow: 'rgba(255,160,95,.16)',
    tree: '#214637', treeTrunk: '#443528', grade: 'rgba(255,150,80,.045)',
  },
  {
    hour: 19.5, skyTop: '#141228', skyMid: '#3b2c49', skyLow: '#b46b55',
    groundFar: '#2b292b', groundMid: '#1d1d21', groundNear: '#0d0f12',
    sunColor: '#ff9b63', sunGlow: 'rgba(255,116,64,.28)', cloud: '#c0a5ad',
    skyline: '#131420', skylineFar: '#1b1d2a', horizonGlow: 'rgba(255,110,70,.14)',
    tree: '#1b3b31', treeTrunk: '#3e3026', grade: 'rgba(70,40,60,.09)',
  },
  {
    hour: 22, skyTop: '#040812', skyMid: '#0a1422', skyLow: '#1b2a38',
    groundFar: '#131a1c', groundMid: '#0c1213', groundNear: '#05080a',
    sunColor: '#dbe6ff', sunGlow: 'rgba(190,214,255,.1)', cloud: '#5e6b83',
    skyline: '#080f18', skylineFar: '#0b131d', horizonGlow: 'rgba(140,180,220,.06)',
    tree: '#153127', treeTrunk: '#30271f', grade: 'rgba(6,12,30,.34)',
  },
];

function paletteFor(hour) {
  const h = clamp(hour, 4, 23);
  let a = PALETTES[0], b = PALETTES[PALETTES.length - 1];
  for (let i = 0; i < PALETTES.length - 1; i++) {
    if (h >= PALETTES[i].hour && h <= PALETTES[i + 1].hour) {
      a = PALETTES[i]; b = PALETTES[i + 1];
      break;
    }
  }
  const t = a === b ? 0 : clamp((h - a.hour) / (b.hour - a.hour), 0, 1);
  const out = {};
  for (const key of ['skyTop', 'skyMid', 'skyLow', 'groundFar', 'groundMid', 'groundNear', 'sunColor', 'skyline', 'skylineFar', 'tree', 'treeTrunk', 'cloud']) {
    out[key] = mixHex(a[key], b[key], t);
  }
  out.sunGlow = t < 0.5 ? a.sunGlow : b.sunGlow;
  out.horizonGlow = t < 0.5 ? a.horizonGlow : b.horizonGlow;
  out.grade = t < 0.5 ? a.grade : b.grade;
  return out;
}

function hexA(color, alpha) {
  if (!color) return 'transparent';
  if (color.startsWith('#')) {
    let h = color.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `,${alpha})`);
  return color;
}
