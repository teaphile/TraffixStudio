import {
  clamp, dist, distanceToPolyline, fmtNum, fmtSpeed,
} from '../core/utils.js';
import { projectPointToPolyline } from '../core/geometry.js';
import {
  makeController, makeCrosswalk, makeDetector, makeSignalHead, nextEntityId,
} from '../core/project.js';
import { View3D } from './view3d.js';

const TYPE_LABEL = {
  node: 'Junction', link: 'Link', controller: 'Signal controller', head: 'Signal head',
  crosswalk: 'Pedestrian crossing', detector: 'Detector', input: 'Vehicle input',
  class: 'Vehicle class', route: 'Route', pt: 'Public transport line',
};

const SIGNAL_COLORS = { green: '#34d399', yellow: '#fbbf24', red: '#f87171' };

export class Editor {
  constructor(app) {
    this.app = app;
    this.canvas = document.getElementById('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.grid = app.ui.grid !== false;
    this.labels = app.ui.labels !== false;
    this.connectors = app.ui.connectors === true;
    this.pointer = { x: 0, y: 0, wx: 0, wy: 0, inside: false };
    this.hover = null;
    this.dragging = null;
    this.panning = null;
    this.draft = null;
    this.pendingCheckpoint = null;
    this.dpr = 1;
    this.width = 1;
    this.height = 1;
    this.fps = 60;
    this._lastFrame = performance.now();
    this.view3d = new View3D(app);
    this._bind();
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(document.getElementById('viewport'));
    this.resize();
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    c.addEventListener('pointermove', (e) => this._onPointerMove(e));
    c.addEventListener('pointerup', (e) => this._onPointerUp(e));
    c.addEventListener('pointerleave', () => { this.pointer.inside = false; this.hover = null; });
    c.addEventListener('pointerenter', () => { this.pointer.inside = true; });
    c.addEventListener('wheel', (e) => {
      if (this.app.mode === '3d') { this.view3d.onWheel(e); return; }
      e.preventDefault();
      const { x, y } = this._mouse(e);
      const factor = Math.exp(-e.deltaY * 0.0012);
      this.zoomAt(x, y, factor);
    }, { passive: false });
    c.addEventListener('dblclick', (e) => this._onDoubleClick(e));
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.app.mode === '3d') return;
      const { x, y } = this._mouse(e);
      const w = this.screenToWorld(x, y);
      const hit = this.hitTest(w.x, w.y);
      this.app.showContextMenu(e.clientX, e.clientY, hit);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this._typing(e)) this.space = true;
    });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.space = false; });
  }

  _typing(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  resize() {
    const viewport = document.getElementById('viewport');
    const rect = viewport.getBoundingClientRect();
    this.width = Math.max(10, rect.width);
    this.height = Math.max(10, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.view3d.resize(this.width, this.height, this.dpr);
  }

  fit() {
    const b = this.app.network.bounds();
    const pad = 90;
    const zx = (this.width - pad * 2) / Math.max(40, b.width);
    const zy = (this.height - pad * 2 - 55) / Math.max(40, b.height);
    this.camera.zoom = clamp(Math.min(zx, zy), 0.045, 6);
    this.camera.x = (b.minX + b.maxX) / 2;
    this.camera.y = (b.minY + b.maxY) / 2 + 12 / this.camera.zoom;
    this.view3d.fit();
    this.app.updateZoomReadout();
  }

  centerOn(x, y) {
    this.camera.x = x; this.camera.y = y;
  }

  zoomAt(sx, sy, factor) {
    const before = this.screenToWorld(sx, sy);
    this.camera.zoom = clamp(this.camera.zoom * factor, 0.04, 10);
    const after = this.screenToWorld(sx, sy);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
    this.app.updateZoomReadout();
  }

  zoomIn() { this.zoomAt(this.width / 2, this.height / 2, 1.3); }
  zoomOut() { this.zoomAt(this.width / 2, this.height / 2, 1 / 1.3); }

  _mouse(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  screenToWorld(sx, sy) {
    return {
      x: this.camera.x + (sx - this.width / 2) / this.camera.zoom,
      y: this.camera.y + (sy - this.height / 2) / this.camera.zoom,
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.camera.x) * this.camera.zoom + this.width / 2,
      y: (wy - this.camera.y) * this.camera.zoom + this.height / 2,
    };
  }

  // ------------------------------------------------------------- hit testing
  hitTest(wx, wy) {
    const net = this.app.network;
    const tol = 10 / this.camera.zoom;

    for (const head of this.app.project.signalHeads) {
      const link = net.link(head.linkId);
      if (!link) continue;
      const len = net.lengthOf(link.id);
      const pos = net.position(link.id, 0, clamp(head.pos, 0, 1) * len);
      const off = net.width(link.id) / 2 + 3;
      const hx = pos.x + pos.nx * off;
      const hy = pos.y + pos.ny * off;
      if (dist(wx, wy, hx, hy) < tol + 2) return { type: 'head', id: head.id, entity: head, x: hx, y: hy };
    }

    for (const cw of this.app.project.crosswalks) {
      const link = net.link(cw.linkId);
      if (!link) continue;
      const p = net.centerPosition(link.id, clamp(cw.pos, 0, 1) * net.lengthOf(link.id));
      const hit = distanceToPolyline(wx, wy, [{ x: p.x + p.nx * 20, y: p.y + p.ny * 20 }, { x: p.x - p.nx * 20, y: p.y - p.ny * 20 }]);
      if (hit.distance < tol) return { type: 'crosswalk', id: cw.id, entity: cw, x: p.x, y: p.y };
    }

    for (const d of this.app.project.detectors) {
      const link = net.link(d.linkId);
      if (!link) continue;
      const p = net.position(link.id, d.lane ?? 0, clamp(d.pos, 0, 1) * net.lengthOf(link.id));
      if (dist(wx, wy, p.x, p.y) < tol) return { type: 'detector', id: d.id, entity: d, x: p.x, y: p.y };
    }

    for (const n of this.app.project.nodes) {
      if (dist(wx, wy, n.x, n.y) < Math.max(8, (n.radius || 12) * 0.8) + 4 / this.camera.zoom) {
        return { type: 'node', id: n.id, entity: n, x: n.x, y: n.y };
      }
    }

    let bestLink = null;
    for (const l of this.app.project.links) {
      const pts = net.centerPolyline(l.id);
      if (!pts.length) continue;
      const hit = distanceToPolyline(wx, wy, pts);
      const width = net.width(l.id);
      if (hit.distance < width / 2 + 7 / this.camera.zoom) {
        if (!bestLink || hit.distance < bestLink.distance) {
          const proj = projectPointToPolyline(wx, wy, pts);
          bestLink = { type: 'link', id: l.id, entity: l, x: hit.x, y: hit.y, distance: hit.distance, s: proj.s, index: proj.index };
        }
      }
    }
    if (bestLink) return bestLink;
    return null;
  }

  // --------------------------------------------------------------- pointer IO
  _onPointerDown(e) {
    if (this.app.mode === '3d') { this.view3d.onPointerDown(e); return; }
    const { x, y } = this._mouse(e);
    const w = this.screenToWorld(x, y);
    this.pointer = { x, y, wx: w.x, wy: w.y, inside: true };
    try { this.canvas.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }

    if (e.button === 1 || this.space || (e.button === 0 && e.altKey)) {
      this.panning = { x, y, camX: this.camera.x, camY: this.camera.y };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;

    const tool = this.app.tool;
    if (tool === 'select') {
      const hit = this.hitTest(w.x, w.y);
      if (hit) {
        this.app.select(hit.type, hit.id);
        if (hit.type === 'node') {
          this.dragging = { kind: 'node', nodeId: hit.id, start: w, orig: { x: hit.entity.x, y: hit.entity.y }, moved: false };
          this.pendingCheckpoint = 'Move junction';
        } else if (hit.type === 'link') {
          const handle = this._linkHandleAt(hit.entity, x, y);
          if (handle) {
            this.dragging = { kind: 'point', linkId: hit.id, index: handle.index, start: w, orig: { ...handle.point }, moved: false };
            this.pendingCheckpoint = 'Move geometry point';
          }
        }
      } else {
        this.app.clearSelection();
        this.panning = { x, y, camX: this.camera.x, camY: this.camera.y };
        this.canvas.style.cursor = 'grabbing';
      }
      return;
    }

    if (tool === 'link') {
      const snap = this.app.network.nearestNode(w.x, w.y, 20 / this.camera.zoom);
      const start = this.draft?.start || null;
      const point = snap ? { x: snap.node.x, y: snap.node.y, nodeId: snap.node.id } : { x: w.x, y: w.y, nodeId: null };
      if (!start) {
        this.draft = { start: point, current: point };
      } else {
        if (dist(start.x, start.y, point.x, point.y) < 3) { this.app.toast('Draw', 'Link is too short.', 'warn'); return; }
        this._createLink(start, point);
        this.draft = null;
      }
      return;
    }

    if (tool === 'node') {
      this._createNode(w.x, w.y);
      return;
    }

    const hit = this.hitTest(w.x, w.y);
    if (tool === 'signal') {
      if (!hit || (hit.type !== 'link' && hit.type !== 'node')) { this.app.toast('Signal', 'Click a link or junction to place a signal.', 'warn'); return; }
      if (hit.type === 'node') {
        const incoming = this.app.network.incomingOf(hit.id);
        if (!incoming.length) { this.app.toast('Signal', 'This junction has no incoming links.', 'warn'); return; }
        this._createControllerForNode(hit.id);
      } else {
        this._createSignal(hit.entity, clamp(hit.s / this.app.network.lengthOf(hit.id), 0.5, 0.995));
      }
      return;
    }
    if (tool === 'detector') {
      if (!hit || hit.type !== 'link') { this.app.toast('Detector', 'Click a link to place a detector.', 'warn'); return; }
      const lane = this.app.network.nearestLane(hit.id, w.x, w.y);
      this._createDetector(hit.entity, clamp(hit.s / this.app.network.lengthOf(hit.id), 0.02, 0.98), lane);
      return;
    }
    if (tool === 'crosswalk') {
      if (!hit || hit.type !== 'link') { this.app.toast('Crossing', 'Click a link to place a pedestrian crossing.', 'warn'); return; }
      this._createCrosswalk(hit.entity, clamp(hit.s / this.app.network.lengthOf(hit.id), 0.05, 0.99));
      return;
    }
    if (tool === 'delete') {
      if (hit) { this.app.select(hit.type, hit.id); this.app.deleteSelection(); }
    }
  }

  _onPointerMove(e) {
    if (this.app.mode === '3d') { this.view3d.onPointerMove(e); return; }
    const { x, y } = this._mouse(e);
    const w = this.screenToWorld(x, y);
    this.pointer = { x, y, wx: w.x, wy: w.y, inside: true };
    this.app.setCoords(w.x, w.y);

    if (this.view3d?.isDragging) {
      this.view3d.onPointerMove(e);
      return;
    }

    if (this.panning) {
      this.camera.x = this.panning.camX - (x - this.panning.x) / this.camera.zoom;
      this.camera.y = this.panning.camY - (y - this.panning.y) / this.camera.zoom;
      return;
    }

    if (this.dragging) {
      if (!this.dragging.moved) {
        this.dragging.moved = true;
        if (this.pendingCheckpoint) { this.app.checkpoint(this.pendingCheckpoint); this.pendingCheckpoint = null; }
      }
      if (this.dragging.kind === 'node') {
        const node = this.app.project.nodes.find((n) => n.id === this.dragging.nodeId);
        if (node) {
          const dx = w.x - this.dragging.start.x;
          const dy = w.y - this.dragging.start.y;
          node.x = Math.round((this.dragging.orig.x + dx) * 10) / 10;
          node.y = Math.round((this.dragging.orig.y + dy) * 10) / 10;
          for (const link of this.app.project.links) {
            if (link.from === node.id) { link.points[0].x = node.x; link.points[0].y = node.y; }
            if (link.to === node.id) {
              const last = link.points[link.points.length - 1];
              last.x = node.x; last.y = node.y;
            }
          }
          for (const head of this.app.project.signalHeads) {
            const l = this.app.project.links.find((x2) => x2.id === head.linkId);
            if (l && l.to === node.id) { /* head moves with link geometry */ }
          }
          this.app.rebuildNetwork(false);
          this.app.refreshPanels(false);
        }
      } else if (this.dragging.kind === 'point') {
        const link = this.app.project.links.find((l) => l.id === this.dragging.linkId);
        if (link && link.points[this.dragging.index]) {
          const pt = link.points[this.dragging.index];
          pt.x = Math.round(w.x * 10) / 10;
          pt.y = Math.round(w.y * 10) / 10;
          this.app.rebuildNetwork(false);
        }
      }
      return;
    }

    if (this.draft) {
      const snap = this.app.network.nearestNode(w.x, w.y, 20 / this.camera.zoom);
      this.draft.current = snap ? { x: snap.node.x, y: snap.node.y, nodeId: snap.node.id } : { x: w.x, y: w.y, nodeId: null };
      this.draft.snap = snap;
      return;
    }

    const hit = this.hitTest(w.x, w.y);
    this.hover = hit;
    const cursors = { select: hit ? 'pointer' : 'default', link: 'crosshair', node: 'crosshair', signal: 'crosshair', detector: 'crosshair', crosswalk: 'crosshair', delete: hit ? 'not-allowed' : 'default' };
    this.canvas.style.cursor = this.space ? 'grab' : (cursors[this.app.tool] || 'default');
    this.app.setHover(hit);
  }

  _onPointerUp(e) {
    if (this.app.mode === '3d') { this.view3d.onPointerUp(e); return; }
    if (this.panning) { this.panning = null; this.canvas.style.cursor = this.space ? 'grab' : 'default'; return; }
    if (this.dragging) {
      const moved = this.dragging.moved;
      this.dragging = null;
      this.pendingCheckpoint = null;
      if (moved) {
        this.app.invalidateSimulation();
        this.app.afterGeometryChange();
      }
    }
  }

  _onDoubleClick(e) {
    if (this.app.mode === '3d' || this.app.tool !== 'select') return;
    const { x, y } = this._mouse(e);
    const w = this.screenToWorld(x, y);
    const hit = this.hitTest(w.x, w.y);
    if (hit?.type === 'link') {
      const pts = this.app.network.centerPolyline(hit.id);
      const proj = projectPointToPolyline(w.x, w.y, pts);
      this.app.checkpoint('Add geometry point');
      hit.entity.points.splice(proj.index + 1, 0, { x: Math.round(w.x * 10) / 10, y: Math.round(w.y * 10) / 10 });
      this.app.afterGeometryChange();
      this.app.toast('Geometry', 'Waypoint inserted. Drag it to shape the link.', 'success');
    }
  }

  _linkHandleAt(link, sx, sy) {
    const tol = 10;
    const points = link.points;
    for (let i = 0; i < points.length; i++) {
      const p = this.worldToScreen(points[i].x, points[i].y);
      if (Math.hypot(p.x - sx, p.y - sy) < tol) return { index: i, point: points[i] };
    }
    return null;
  }

  // ------------------------------------------------------------- create ops
  _createNode(x, y) {
    this.app.checkpoint('Add junction');
    const id = nextEntityId(this.app.project, 'nodes', 'N');
    const node = {
      id, name: `Junction ${id.replace(/^N_?/, '')}`, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10,
      type: 'junction', control: 'priority', radius: 14,
    };
    this.app.project.nodes.push(node);
    this.app.afterGeometryChange({ select: { type: 'node', id } });
    this.app.toast('Network', `Junction ${node.name} added.`, 'success');
  }

  _createLink(start, end) {
    this.app.checkpoint('Add link');
    const p = this.app.project;
    let startNodeId = start.nodeId;
    let endNodeId = end.nodeId;
    if (!startNodeId) {
      startNodeId = nextEntityId(p, 'nodes', 'N');
      p.nodes.push({ id: startNodeId, name: `Junction ${startNodeId.replace(/^N_?/, '')}`, x: start.x, y: start.y, type: 'boundary', control: 'priority', radius: 9 });
    }
    if (!endNodeId) {
      endNodeId = nextEntityId(p, 'nodes', 'N');
      p.nodes.push({ id: endNodeId, name: `Junction ${endNodeId.replace(/^N_?/, '')}`, x: end.x, y: end.y, type: 'boundary', control: 'priority', radius: 9 });
    }
    if (startNodeId === endNodeId) { this.app.toast('Network', 'A link needs two different junctions.', 'warn'); return; }
    const id = nextEntityId(p, 'links', 'L');
    const link = {
      id, name: `Link ${id.replace(/^L/, '')}`, from: startNodeId, to: endNodeId,
      points: [{ x: start.x, y: start.y }, { x: end.x, y: end.y }],
      lanes: 2, laneWidth: 3.4, speed: 50, priority: 1, type: 'street', grade: 0,
      sidewalk: true, attraction: 1, display: true,
    };
    p.links.push(link);
    this.app.afterGeometryChange({ select: { type: 'link', id } });
    this.app.toast('Network', `Link ${link.name} created (${Math.round(dist(start.x, start.y, end.x, end.y))} m).`, 'success');
  }

  _findControllerForNode(nodeId) {
    const incoming = new Set(this.app.network.incomingOf(nodeId).map((l) => l.id));
    for (const c of this.app.project.signalControllers) {
      if (c.phases.some((ph) => (ph.green || []).some((id) => incoming.has(id)))) return c;
    }
    return null;
  }

  _createControllerForNode(nodeId) {
    let controller = this._findControllerForNode(nodeId);
    this.app.checkpoint('Add signal controller');
    if (!controller) {
      controller = makeController(this.app.project, { nodeId, name: `${this.app.network.node(nodeId)?.name || nodeId} signals` });
      this.app.project.signalControllers.push(controller);
    }
    const incoming = this.app.network.incomingOf(nodeId);
    for (const link of incoming) {
      if (!this.app.project.signalHeads.some((h) => h.linkId === link.id)) {
        this.app.project.signalHeads.push(makeSignalHead(this.app.project, link.id, controller.id, 0.955));
      }
    }
    const node = this.app.network.node(nodeId);
    if (node) node.control = 'signal';
    this.app.afterGeometryChange({ select: { type: 'controller', id: controller.id }, resetSim: true });
    this.app.toast('Signal control', `Signal controller “${controller.name}” is now controlling ${incoming.length} approaches.`, 'success');
  }

  _createSignal(link, pos) {
    this.app.checkpoint('Add signal head');
    let controller = this._findControllerForNode(link.to);
    if (!controller) {
      controller = makeController(this.app.project, { nodeId: link.to, name: `${this.app.network.node(link.to)?.name || 'Junction'} signals` });
      this.app.project.signalControllers.push(controller);
    }
    const head = makeSignalHead(this.app.project, link.id, controller.id, pos);
    this.app.project.signalHeads.push(head);
    const node = this.app.network.node(link.to);
    if (node) node.control = 'signal';
    if (!controller.phases.some((ph) => ph.green.includes(link.id))) {
      controller.phases[0].green.push(link.id);
    }
    this.app.afterGeometryChange({ select: { type: 'head', id: head.id }, resetSim: true });
    this.app.toast('Signal control', `Signal head placed on ${link.name}.`, 'success');
  }

  _createDetector(link, pos, lane) {
    this.app.checkpoint('Add detector');
    const detector = makeDetector(this.app.project, link.id, pos, lane);
    this.app.project.detectors.push(detector);
    this.app.afterGeometryChange({ select: { type: 'detector', id: detector.id }, resetSim: true });
    this.app.toast('Detector', `${detector.name} placed on ${link.name}, lane ${lane + 1}.`, 'success');
  }

  _createCrosswalk(link, pos) {
    this.app.checkpoint('Add crossing');
    let controllerId = null;
    const head = this.app.project.signalHeads.find((h) => h.linkId === link.id);
    if (head) controllerId = head.controllerId;
    const cw = makeCrosswalk(this.app.project, link.id, pos, controllerId);
    this.app.project.crosswalks.push(cw);
    this.app.afterGeometryChange({ select: { type: 'crosswalk', id: cw.id }, resetSim: true });
    this.app.toast('Pedestrians', `${cw.name} added${controllerId ? ' with a pedestrian phase' : ' (uncontrolled)'}.`, 'success');
  }

  // ------------------------------------------------------------------ render
  render(now = performance.now()) {
    if (this.app.mode === '3d') {
      this.view3d.render(now);
      return;
    }
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const bg = ctx.createLinearGradient(0, 0, 0, this.height);
    bg.addColorStop(0, '#070b10');
    bg.addColorStop(1, '#080d13');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    this._drawGrid(ctx);
    this._drawJunctionBases(ctx);
    this._drawLinks(ctx);
    this._drawConnectors(ctx);
    this._drawCrosswalks(ctx);
    this._drawDetectors(ctx);
    this._drawNodes(ctx);
    this._drawSignals(ctx);
    if (this.app.sim) this._drawSimulation(ctx);
    this._drawDemandOverlay(ctx);
    this._drawSelectionHandles(ctx);
    this._drawDraft(ctx);
    ctx.restore();

    this._drawScaleBar(ctx);
    this._drawHoverTooltip(ctx);
    this._drawEmptyHint(ctx);
  }

  _drawGrid(ctx) {
    if (!this.grid) return;
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(this.width, this.height);
    let spacing = 10;
    while (spacing * this.camera.zoom < 38) spacing *= 2;
    while (spacing * this.camera.zoom > 120) spacing /= 2;
    const x0 = Math.floor(topLeft.x / spacing) * spacing;
    const y0 = Math.floor(topLeft.y / spacing) * spacing;
    const x1 = bottomRight.x + spacing;
    const y1 = bottomRight.y + spacing;

    ctx.lineWidth = 1 / this.camera.zoom;
    for (let x = x0; x <= x1; x += spacing) {
      const major = Math.abs(x % (spacing * 5)) < spacing * 0.01;
      ctx.strokeStyle = major ? 'rgba(122,148,172,.085)' : 'rgba(122,148,172,.035)';
      ctx.beginPath(); ctx.moveTo(x, topLeft.y); ctx.lineTo(x, bottomRight.y); ctx.stroke();
    }
    for (let y = y0; y <= y1; y += spacing) {
      const major = Math.abs(y % (spacing * 5)) < spacing * 0.01;
      ctx.strokeStyle = major ? 'rgba(122,148,172,.085)' : 'rgba(122,148,172,.035)';
      ctx.beginPath(); ctx.moveTo(topLeft.x, y); ctx.lineTo(bottomRight.x, y); ctx.stroke();
    }
    if (spacing * this.camera.zoom > 55) {
      ctx.fillStyle = 'rgba(116,140,162,.24)';
      ctx.font = `${8 / this.camera.zoom}px "SF Mono", monospace`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      for (let x = x0; x <= x1; x += spacing * 5) {
        for (let y = y0; y <= y1; y += spacing * 5) {
          ctx.fillText(`${Math.round(x)}, ${Math.round(y)}`, x + 2 / this.camera.zoom, y - 2 / this.camera.zoom);
        }
      }
    }
  }

  _drawJunctionBases(ctx) {
    for (const node of this.app.project.nodes) {
      if (node.type === 'boundary') continue;
      const r = (node.radius || 16) * 0.86;
      ctx.fillStyle = '#1c2530';
      roundRect(ctx, node.x - r, node.y - r, r * 2, r * 2, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,145,168,.16)';
      ctx.lineWidth = 1 / this.camera.zoom;
      ctx.stroke();
    }
  }

  _drawLinks(ctx) {
    const net = this.app.network;
    const z = this.camera.zoom;
    const selected = this.app.selection?.type === 'link' ? this.app.selection.id : null;
    for (const link of this.app.project.links) {
      if (link.display === false) continue;
      const pts = net.centerPolyline(link.id);
      if (pts.length < 2) continue;
      const width = net.width(link.id);
      const path = new Path2D();
      path.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);

      if (link.sidewalk !== false) {
        ctx.strokeStyle = '#18222c';
        ctx.lineWidth = width + 7.5;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.stroke(path);
      }
      if (link.id === selected) {
        ctx.strokeStyle = 'rgba(34,211,238,.28)';
        ctx.lineWidth = width + 5;
        ctx.stroke(path);
      }
      ctx.strokeStyle = link.type === 'arterial' ? '#242e39' : '#212a34';
      ctx.lineWidth = width;
      ctx.stroke(path);
      ctx.strokeStyle = 'rgba(255,255,255,.025)';
      ctx.lineWidth = width * .7;
      ctx.stroke(path);

      // Edge lines
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(203,213,225,.24)';
      ctx.lineWidth = 1.1 / z;
      for (const side of [-1, 1]) {
        const edge = this._offsetPath(pts, side * width / 2);
        ctx.beginPath();
        edge.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.stroke();
      }

      // Lane dividers
      ctx.strokeStyle = 'rgba(226,232,240,.34)';
      ctx.lineWidth = 1.1 / z;
      ctx.setLineDash([7 / z, 8 / z]);
      for (let lane = 1; lane < link.lanes; lane++) {
        const offset = width / 2 - lane * (link.laneWidth || 3.4);
        const line = this._offsetPath(pts, offset);
        ctx.beginPath();
        line.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.stroke();
      }
      ctx.setLineDash([]);

      this._drawLaneArrows(ctx, link, pts);
      if (this.labels) this._drawLinkLabel(ctx, link, pts);
    }
  }

  _offsetPath(pts, offset) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      out.push({ x: pts[i].x - dy / l * offset, y: pts[i].y + dx / l * offset });
    }
    return out;
  }

  _drawLaneArrows(ctx, link, pts) {
    const net = this.app.network;
    const z = this.camera.zoom;
    const len = net.lengthOf(link.id);
    if (z < 0.22) return;
    const step = Math.max(45, len / Math.max(1, Math.ceil(len / 65)));
    for (let lane = 0; lane < link.lanes; lane++) {
      for (let s = Math.min(35, len * .2); s < len - 8; s += step) {
        const p = net.position(link.id, lane, s);
        const size = Math.min(3.2, 12 / z);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.heading);
        ctx.fillStyle = 'rgba(226,232,240,.28)';
        ctx.beginPath();
        ctx.moveTo(size, 0); ctx.lineTo(-size * .7, -size * .62); ctx.lineTo(-size * .2, 0); ctx.lineTo(-size * .7, size * .62);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  }

  _drawLinkLabel(ctx, link, pts) {
    const z = this.camera.zoom;
    if (z < 0.28) return;
    const mid = this.app.network.centerPosition(link.id, this.app.network.lengthOf(link.id) / 2);
    const label = `${link.name}`;
    const sub = `${link.lanes} ln · ${link.speed} km/h`;
    const font = Math.min(12, 10 / z);
    ctx.font = `600 ${font}px Inter, sans-serif`;
    const w = Math.max(ctx.measureText(label).width, ctx.measureText(sub).width * .8);
    const h = font * 2.35;
    const x = mid.x - w / 2 - 6 / z;
    const y = mid.y - h / 2 - 8 / z;
    ctx.fillStyle = 'rgba(7,13,19,.78)';
    roundRect(ctx, x, y, w + 12 / z, h, 3 / z); ctx.fill();
    ctx.strokeStyle = 'rgba(120,145,168,.16)'; ctx.lineWidth = 1 / z; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(232,238,245,.9)';
    ctx.font = `600 ${font}px Inter, sans-serif`;
    ctx.fillText(label, mid.x, y + 3 / z);
    ctx.fillStyle = 'rgba(125,143,162,.85)';
    ctx.font = `${font * .78}px "SF Mono", monospace`;
    ctx.fillText(sub, mid.x, y + font + 4.5 / z);
  }

  _drawConnectors(ctx) {
    if (!this.connectors) return;
    const z = this.camera.zoom;
    const sel = this.app.selection?.type === 'link' ? this.app.selection.id : null;
    for (const c of this.app.network.connectors) {
      const related = c.fromLink === sel || c.toLink === sel;
      if (!related && z < 0.5) continue;
      ctx.strokeStyle = related ? 'rgba(34,211,238,.55)' : 'rgba(148,163,184,.13)';
      ctx.lineWidth = related ? 1.6 / z : 0.8 / z;
      ctx.beginPath();
      c.path.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.stroke();
    }
  }

  _drawCrosswalks(ctx) {
    const net = this.app.network;
    const z = this.camera.zoom;
    const selected = this.app.selection?.type === 'crosswalk' ? this.app.selection.id : null;
    for (const cw of this.app.project.crosswalks) {
      const link = net.link(cw.linkId);
      if (!link) continue;
      const len = net.lengthOf(link.id);
      const p = net.centerPosition(link.id, clamp(cw.pos, 0, 1) * len);
      const width = net.width(link.id);
      const cwWidth = cw.width || 4;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.heading);
      const stripe = 0.65;
      const gap = 0.65;
      for (let x = -cwWidth / 2; x < cwWidth / 2; x += stripe + gap) {
        ctx.fillStyle = selected === cw.id ? 'rgba(34,211,238,.9)' : 'rgba(232,238,245,.62)';
        ctx.fillRect(x, -width / 2, stripe, width);
      }
      ctx.strokeStyle = selected === cw.id ? 'rgba(34,211,238,.9)' : 'rgba(232,238,245,.2)';
      ctx.lineWidth = 1.2 / z;
      ctx.strokeRect(-cwWidth / 2, -width / 2, cwWidth, width);
      ctx.restore();
    }
  }

  _drawDetectors(ctx) {
    const net = this.app.network;
    const z = this.camera.zoom;
    const selected = this.app.selection?.type === 'detector' ? this.app.selection.id : null;
    for (const d of this.app.project.detectors) {
      const link = net.link(d.linkId);
      if (!link) continue;
      const len = net.lengthOf(link.id);
      const lane = d.lane ?? 0;
      const p = net.position(link.id, lane, clamp(d.pos, 0, 1) * len);
      const w = link.laneWidth || 3.4;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.heading);
      ctx.strokeStyle = selected === d.id ? '#22d3ee' : 'rgba(34,211,238,.7)';
      ctx.fillStyle = selected === d.id ? 'rgba(34,211,238,.35)' : 'rgba(34,211,238,.16)';
      ctx.lineWidth = 1.4 / z;
      const l = d.length || 2;
      ctx.fillRect(-l / 2, -w / 2, l, w);
      ctx.strokeRect(-l / 2, -w / 2, l, w);
      ctx.restore();
      if (z > 0.7) {
        ctx.fillStyle = 'rgba(34,211,238,.75)';
        ctx.font = `${8 / z}px "SF Mono", monospace`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(d.id, p.x + 3 / z, p.y - 2 / z);
      }
    }
  }

  _drawNodes(ctx) {
    const z = this.camera.zoom;
    const selected = this.app.selection?.type === 'node' ? this.app.selection.id : null;
    for (const node of this.app.project.nodes) {
      const r = node.type === 'boundary' ? 6 : (node.radius || 14) * .8;
      if (node.type !== 'boundary') {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 2.5, 0, Math.PI * 2);
        ctx.strokeStyle = selected === node.id ? 'rgba(34,211,238,.95)' : 'rgba(148,163,184,.25)';
        ctx.lineWidth = 1.4 / z;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#0c141c';
        ctx.fill();
        ctx.strokeStyle = 'rgba(148,163,184,.3)';
        ctx.lineWidth = 1 / z;
        ctx.stroke();
      }
      if (selected === node.id) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 7, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(34,211,238,.3)';
        ctx.lineWidth = 2 / z;
        ctx.stroke();
      }
      if (this.labels && (z > 0.3 || selected === node.id)) {
        ctx.font = `${Math.min(11, 9 / z)}px Inter, sans-serif`;
        const w = ctx.measureText(node.name).width;
        const fh = Math.min(12, 10 / z);
        ctx.fillStyle = 'rgba(7,13,19,.72)';
        roundRect(ctx, node.x - w / 2 - 4 / z, node.y - r - fh - 6 / z, w + 8 / z, fh + 4 / z, 3 / z);
        ctx.fill();
        ctx.fillStyle = 'rgba(185,198,212,.78)';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(node.name, node.x, node.y - r - 3 / z);
      }
    }
  }

  _drawSignals(ctx) {
    const z = this.camera.zoom;
    const net = this.app.network;
    for (const head of this.app.project.signalHeads) {
      const link = net.link(head.linkId);
      if (!link) continue;
      const len = net.lengthOf(link.id);
      const p = net.position(link.id, 0, clamp(head.pos, 0, 1) * len);
      const off = net.width(link.id) / 2 + 3.4;
      const hx = p.x + p.nx * off;
      const hy = p.y + p.ny * off;
      const state = this.app.signalStateFor(link.id);
      const color = SIGNAL_COLORS[state] || '#64748b';
      const size = 9 / z;
      const selected = this.app.selection?.type === 'head' && this.app.selection.id === head.id;

      // pole
      ctx.strokeStyle = 'rgba(148,163,184,.45)';
      ctx.lineWidth = 1.2 / z;
      ctx.beginPath();
      ctx.moveTo(p.x + p.nx * net.width(link.id) / 2, p.y + p.ny * net.width(link.id) / 2);
      ctx.lineTo(hx, hy);
      ctx.stroke();

      ctx.save();
      ctx.translate(hx, hy);
      ctx.fillStyle = '#0b131b';
      roundRect(ctx, -size * .48, -size * 1.08, size * .96, size * 2.16, size * .3);
      ctx.fill();
      ctx.strokeStyle = selected ? '#22d3ee' : 'rgba(148,163,184,.4)';
      ctx.lineWidth = 1.3 / z;
      ctx.stroke();
      const activeIdx = state === 'red' ? 0 : state === 'yellow' ? 1 : state === 'green' ? 2 : -1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(0, -size * .68 + i * size * .68, size * .26, 0, Math.PI * 2);
        ctx.fillStyle = i === activeIdx ? color : 'rgba(71,85,105,.35)';
        if (i === activeIdx) {
          ctx.shadowColor = color; ctx.shadowBlur = 7 / z;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    }
  }

  _drawSimulation(ctx) {
    const sim = this.app.sim;
    if (!sim) return;
    const z = this.camera.zoom;
    // pedestrians first
    for (const p of sim.peds) {
      const r = Math.max(1.1 / z, 0.75);
      ctx.fillStyle = '#f472b6';
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.lineWidth = .5 / z; ctx.stroke();
    }
    const sorted = [...sim.vehicles].sort((a, b) => a.s - b.s);
    for (const v of sorted) {
      if (v.finished) continue;
      const pose = sim.vehiclePose(v);
      const minL = 9 / z, minW = 4.5 / z;
      const L = Math.max(v.length, minL);
      const W = Math.max(v.width, minW);
      ctx.save();
      ctx.translate(pose.x, pose.y);
      ctx.rotate(pose.heading);
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      roundRect(ctx, -L / 2 + .5, -W / 2 + .8, L, W, Math.min(2.2, W * .3));
      ctx.fill();
      // body
      ctx.fillStyle = v.color || '#dbe7f3';
      roundRect(ctx, -L / 2, -W / 2, L, W, Math.min(2.2, W * .28));
      ctx.fill();
      // roof / windshield
      if (v.classCategory !== 'moto' && v.classCategory !== 'bike') {
        ctx.fillStyle = 'rgba(8,16,24,.55)';
        roundRect(ctx, -L * .28, -W * .38, L * .36, W * .76, Math.min(1.2, W * .2));
        ctx.fill();
        if (v.classCategory === 'bus') {
          ctx.fillStyle = 'rgba(232,238,245,.38)';
          for (let x = -L * .36; x < L * .32; x += L * .13) {
            ctx.fillRect(x, -W * .42, L * .055, W * .84);
          }
          ctx.fillStyle = v.color || '#34d399';
          ctx.fillRect(-L * .42, -W * .5, L * .84, W * .14);
        }
      }
      // brake lights
      if ((v.acc < -.25 || v.v < .3) && v.classCategory !== 'bike') {
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(-L / 2 + .1, -W / 2 + .2, .35, W * .22);
        ctx.fillRect(-L / 2 + .1, W / 2 - W * .22 - .2, .35, W * .22);
      }
      ctx.restore();
    }
  }

  _drawDemandOverlay(ctx) {
    if (this.app.mode !== 'demand') return;
    const net = this.app.network;
    const z = this.camera.zoom;
    for (const input of this.app.project.inputs) {
      const link = net.link(input.linkId);
      if (!link) continue;
      const p = net.position(link.id, 0, 8);
      const fs = Math.min(10, 9 / z);
      const text = `${input.id} · ${fmtNum(input.volume)} veh/h`;
      ctx.font = `600 ${fs}px "SF Mono", monospace`;
      const w = ctx.measureText(text).width + 18 / z;
      const h = fs + 12 / z;
      const x = p.x - 10 / z;
      const y = p.y - h - 12 / z;
      ctx.fillStyle = 'rgba(8,14,21,.88)';
      roundRect(ctx, x, y, w, h, 4 / z); ctx.fill();
      ctx.strokeStyle = 'rgba(34,211,238,.4)'; ctx.lineWidth = 1.2 / z; ctx.stroke();
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath(); ctx.arc(x + 7 / z, y + h / 2, 2.2 / z, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c7d5e2';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(text, x + 12 / z, y + h / 2 + .5 / z);
      // small arrow at link start
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.heading);
      ctx.fillStyle = 'rgba(34,211,238,.55)';
      ctx.beginPath(); ctx.moveTo(6 / z, 0); ctx.lineTo(-3 / z, -3 / z); ctx.lineTo(-3 / z, 3 / z); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  _drawSelectionHandles(ctx) {
    if (this.app.tool !== 'select' || this.app.selection?.type !== 'link') return;
    const link = this.app.project.links.find((l) => l.id === this.app.selection.id);
    if (!link) return;
    const z = this.camera.zoom;
    link.points.forEach((p, i) => {
      const end = i === 0 || i === link.points.length - 1;
      const r = (end ? 4.2 : 3.2) / z;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = end ? '#0b131b' : '#0b131b';
      ctx.fill();
      ctx.strokeStyle = end ? '#22d3ee' : 'rgba(34,211,238,.8)';
      ctx.lineWidth = 1.5 / z; ctx.stroke();
      if (!end) {
        ctx.beginPath(); ctx.arc(p.x, p.y, r * .35, 0, Math.PI * 2); ctx.fillStyle = '#22d3ee'; ctx.fill();
      }
    });
  }

  _drawDraft(ctx) {
    if (!this.draft) return;
    const z = this.camera.zoom;
    const a = this.draft.start, b = this.draft.current;
    ctx.strokeStyle = 'rgba(34,211,238,.9)';
    ctx.lineWidth = 2 / z;
    ctx.setLineDash([8 / z, 6 / z]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    for (const p of [a, b]) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 5 / z, 0, Math.PI * 2);
      ctx.fillStyle = '#0b131b'; ctx.fill();
      ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1.5 / z; ctx.stroke();
    }
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const text = `${fmtNum(dist(a.x, a.y, b.x, b.y))} m`;
    ctx.font = `600 ${10 / z}px "SF Mono", monospace`;
    const w = ctx.measureText(text).width + 10 / z;
    ctx.fillStyle = 'rgba(8,14,21,.9)';
    roundRect(ctx, mid.x - w / 2, mid.y - 20 / z, w, 14 / z, 3 / z); ctx.fill();
    ctx.fillStyle = '#67e8f9'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, mid.x, mid.y - 13 / z);
    if (b.nodeId) {
      const node = this.app.network.node(b.nodeId);
      if (node) {
        ctx.beginPath(); ctx.arc(node.x, node.y, 16 / z, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(34,211,238,.55)'; ctx.lineWidth = 1.5 / z; ctx.stroke();
      }
    }
  }

  _drawScaleBar(ctx) {
    if (this.app.mode === '3d') return;
    const targetPx = 90;
    const world = targetPx / this.camera.zoom;
    const pow = 10 ** Math.floor(Math.log10(world));
    const nice = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= world * .55) || pow * 10;
    const px = nice * this.camera.zoom;
    const x = this.width / 2 - px / 2;
    const y = this.height - 66;
    ctx.fillStyle = 'rgba(10,17,24,.78)';
    roundRect(ctx, x - 10, y - 14, px + 20, 27, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(148,163,184,.55)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 5); ctx.moveTo(x, y + 1); ctx.lineTo(x + px, y + 1);
    ctx.moveTo(x + px, y - 3); ctx.lineTo(x + px, y + 5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(185,198,212,.8)';
    ctx.font = '8.5px "SF Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, x + px / 2, y - 4);
  }

  _drawHoverTooltip(ctx) {
    if (!this.hover || this.dragging || this.panning || this.app.mode === '3d') return;
    if (!this.pointer.inside) return;
    const type = TYPE_LABEL[this.hover.type] || this.hover.type;
    const name = this.hover.entity?.name || this.hover.id;
    const x = this.pointer.x + 15, y = this.pointer.y + 16;
    const text = `${name}`;
    const sub = type;
    ctx.font = '600 10.5px Inter, sans-serif';
    const w1 = ctx.measureText(text).width;
    ctx.font = '8.5px "SF Mono", monospace';
    const w2 = ctx.measureText(sub).width;
    const w = Math.max(w1, w2) + 16;
    ctx.fillStyle = 'rgba(8,14,21,.92)';
    roundRect(ctx, x, y, w, 32, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(42,58,74,.8)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#e8eef5'; ctx.font = '600 10.5px Inter, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(text, x + 8, y + 6);
    ctx.fillStyle = '#64778a'; ctx.font = '8px "SF Mono", monospace';
    ctx.fillText(sub.toUpperCase(), x + 8, y + 20);
  }

  _drawEmptyHint(ctx) {
    if (this.app.project.links.length || this.app.mode === '3d') return;
    const cx = this.width / 2, cy = this.height / 2;
    ctx.fillStyle = 'rgba(232,238,245,.9)';
    ctx.font = '600 15px Inter, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Your network is empty', cx, cy - 20);
    ctx.fillStyle = '#7d8fa2';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText('Choose the Link tool (L) and click twice to draw a road.', cx, cy + 2);
    ctx.fillStyle = '#5c6f82';
    ctx.font = '10px Inter, sans-serif';
    ctx.fillText('Or load the demo network from File → Load demo network.', cx, cy + 22);
  }

  toggleGrid() { this.grid = !this.grid; }
  toggleLabels() { this.labels = !this.labels; }
  toggleConnectors() { this.connectors = !this.connectors; }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
