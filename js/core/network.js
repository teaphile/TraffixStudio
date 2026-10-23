import { sampleCenterline, pointAtDistance, offsetPolyline, turnCurve, projectPointToPolyline, boundsOfPoints } from './geometry.js';
import { clamp, dist, distanceToPolyline, weightedChoice, wrapAngle } from './utils.js';

/**
 * Runtime network graph. Owns derived lane geometry, turn movements and
 * shortest-path routing. The editable project remains the source of truth.
 */
export class Network {
  constructor(project) {
    this.project = project;
    this.nodes = new Map();
    this.links = new Map();
    this.classes = new Map();
    this.geometry = new Map();
    this.lanes = new Map();
    this.outgoing = new Map();
    this.incoming = new Map();
    this.headsByLink = new Map();
    this.crosswalksByLink = new Map();
    this.detectorsByLink = new Map();
    this.pathCache = new Map();
    this.connectors = [];
    this.connectorIndex = new Map();
    this.rebuild();
  }

  rebuild() {
    const p = this.project;
    this.nodes = new Map(p.nodes.map((n) => [n.id, n]));
    this.links = new Map(p.links.map((l) => [l.id, l]));
    this.classes = new Map(p.classes.map((c) => [c.id, c]));
    this.geometry.clear();
    this.lanes.clear();
    this.outgoing.clear();
    this.incoming.clear();
    this.headsByLink.clear();
    this.crosswalksByLink.clear();
    this.detectorsByLink.clear();
    this.pathCache.clear();
    this.connectors = [];
    this.connectorIndex.clear();

    for (const n of p.nodes) {
      this.outgoing.set(n.id, []);
      this.incoming.set(n.id, []);
    }

    for (const link of p.links) {
      if (!this.geometry.has(link.from)) { /* boundary node may be missing */ }
      const center = sampleCenterline(link.points, 1.5);
      const laneWidth = link.laneWidth || 3.4;
      const half = (link.lanes * laneWidth) / 2;
      const laneGeos = [];
      for (let lane = 0; lane < link.lanes; lane++) {
        const offset = half - laneWidth / 2 - lane * laneWidth;
        const poly = offsetPolyline(center, offset);
        laneGeos.push({ offset, geo: sampleCenterline(poly, 1.5) });
      }
      const width = link.lanes * laneWidth;
      this.geometry.set(link.id, {
        center, laneGeos, width, laneWidth,
        startHeading: center.length ? pointAtDistance(center, 0).heading : 0,
        endHeading: center.length ? pointAtDistance(center, center.length).heading : 0,
      });
      this.lanes.set(link.id, link.lanes);
      if (this.outgoing.has(link.from)) this.outgoing.get(link.from).push(link);
      if (this.incoming.has(link.to)) this.incoming.get(link.to).push(link);
    }

    for (const head of p.signalHeads) {
      if (!this.headsByLink.has(head.linkId)) this.headsByLink.set(head.linkId, []);
      this.headsByLink.get(head.linkId).push(head);
    }
    for (const cw of p.crosswalks) {
      if (!this.crosswalksByLink.has(cw.linkId)) this.crosswalksByLink.set(cw.linkId, []);
      this.crosswalksByLink.get(cw.linkId).push(cw);
    }
    for (const d of p.detectors) {
      if (!this.detectorsByLink.has(d.linkId)) this.detectorsByLink.set(d.linkId, []);
      this.detectorsByLink.get(d.linkId).push(d);
    }

    this._buildConnectors();
  }

  _buildConnectors() {
    for (const node of this.project.nodes) {
      const inc = this.incoming.get(node.id) || [];
      const out = this.outgoing.get(node.id) || [];
      for (const from of inc) {
        for (const to of out) {
          if (from.id === to.id) continue;
          const turn = this.turnType(from.id, to.id);
          if (turn === 'uturn') continue;
          const fromLanes = Math.max(1, Math.round(from.lanes));
          const toLanes = Math.max(1, Math.round(to.lanes));
          const laneSet = new Set();
          for (let fl = 0; fl < fromLanes; fl++) {
            const tl = this.targetLaneForTurn(to, turn, fl, toLanes);
            const key = `${fl}:${tl}`;
            if (laneSet.has(key)) continue;
            laneSet.add(key);
            const path = this.buildTurnPath(from.id, fl, to.id, tl);
            const c = { nodeId: node.id, fromLink: from.id, toLink: to.id, fromLane: fl, toLane: tl, turn, path, length: pathGeoLength(path) };
            this.connectors.push(c);
            this.connectorIndex.set(`${from.id}:${to.id}:${fl}`, c);
          }
        }
      }
    }
  }

  link(id) { return this.links.get(id); }
  node(id) { return this.nodes.get(id); }
  vehicleClass(id) { return this.classes.get(id); }
  get length() { return this.links.size; }

  width(linkId) {
    const l = this.links.get(linkId);
    return l ? l.lanes * (l.laneWidth || 3.4) : 0;
  }

  lengthOf(linkId) {
    const g = this.geometry.get(linkId);
    return g ? g.center.length : 0;
  }

  speedMs(linkId) {
    const l = this.links.get(linkId);
    return l ? (l.speed || 50) / 3.6 : 13.9;
  }

  /** World position on a lane, including optional lateral shift. */
  position(linkId, lane, s, lateral = 0) {
    const g = this.geometry.get(linkId);
    if (!g) return { x: 0, y: 0, heading: 0, nx: 0, ny: 1 };
    const laneIdx = clamp(Math.round(lane), 0, g.laneGeos.length - 1);
    const lg = g.laneGeos[laneIdx] || g.laneGeos[0];
    const pt = pointAtDistance(lg.geo, s);
    return {
      x: pt.x + pt.nx * lateral,
      y: pt.y + pt.ny * lateral,
      heading: pt.heading,
      nx: pt.nx, ny: pt.ny,
      laneOffset: lg.offset,
    };
  }

  centerPosition(linkId, s) {
    const g = this.geometry.get(linkId);
    if (!g) return { x: 0, y: 0, heading: 0, nx: 0, ny: 1 };
    return pointAtDistance(g.center, s);
  }

  laneOffset(linkId, lane) {
    const g = this.geometry.get(linkId);
    if (!g) return 0;
    return g.laneGeos[clamp(lane, 0, g.laneGeos.length - 1)]?.offset || 0;
  }

  lanePolyline(linkId, lane) {
    const g = this.geometry.get(linkId);
    if (!g) return [];
    return g.laneGeos[clamp(lane, 0, g.laneGeos.length - 1)]?.geo.points || [];
  }

  centerPolyline(linkId) {
    return this.geometry.get(linkId)?.center.points || [];
  }

  outgoingOf(nodeId) { return this.outgoing.get(nodeId) || []; }
  incomingOf(nodeId) { return this.incoming.get(nodeId) || []; }

  sources() {
    return this.project.links.filter((l) => {
      const node = this.nodes.get(l.from);
      return node?.type === 'boundary' || (this.incoming.get(l.from) || []).length === 0;
    });
  }

  sinks() {
    return this.project.links.filter((l) => {
      const node = this.nodes.get(l.to);
      return node?.type === 'boundary' || (this.outgoing.get(l.to) || []).length === 0;
    });
  }

  signalHeads(linkId) { return this.headsByLink.get(linkId) || []; }
  crosswalks(linkId) { return this.crosswalksByLink.get(linkId) || []; }
  detectors(linkId) { return this.detectorsByLink.get(linkId) || []; }

  turnType(fromId, toId) {
    const a = this.geometry.get(fromId);
    const b = this.geometry.get(toId);
    if (!a || !b) return 'through';
    let delta = wrapAngle(b.startHeading - a.endHeading);
    const deg = Math.abs(delta * 180 / Math.PI);
    if (deg > 145) return 'uturn';
    if (deg < 25) return 'through';
    return delta > 0 ? 'right' : 'left';
  }

  turnAngle(fromId, toId) {
    const a = this.geometry.get(fromId);
    const b = this.geometry.get(toId);
    if (!a || !b) return 0;
    return wrapAngle(b.startHeading - a.endHeading);
  }

  turnPenalty(fromId, toId) {
    const t = this.turnType(fromId, toId);
    return t === 'left' ? 5 : t === 'right' ? 2 : 0.5;
  }

  targetLaneForTurn(toLink, turn, sourceLane = 0, laneCount = null) {
    const n = laneCount || toLink.lanes || 1;
    if (turn === 'right') return 0;
    if (turn === 'left') return n - 1;
    return clamp(sourceLane, 0, n - 1);
  }

  preferredLane(linkId, nextLinkId) {
    const link = this.links.get(linkId);
    if (!link) return 0;
    const n = link.lanes || 1;
    if (!nextLinkId) return 0;
    const turn = this.turnType(linkId, nextLinkId);
    if (turn === 'right') return 0;
    if (turn === 'left') return n - 1;
    return null;
  }

  laneAllowed(linkId, lane, nextLinkId) {
    const link = this.links.get(linkId);
    if (!link) return true;
    if (!nextLinkId) return true;
    const turn = this.turnType(linkId, nextLinkId);
    if (turn === 'right') return lane === 0;
    if (turn === 'left') return lane === (link.lanes || 1) - 1;
    return true;
  }

  buildTurnPath(fromId, fromLane, toId, toLane) {
    const from = this.links.get(fromId);
    const to = this.links.get(toId);
    if (!from || !to) return [];
    const fl = clamp(fromLane, 0, (from.lanes || 1) - 1);
    const tl = clamp(toLane, 0, (to.lanes || 1) - 1);
    const fromS = this.lengthOf(fromId);
    const start = this.position(fromId, fl, fromS);
    const end = this.position(toId, tl, Math.min(3, this.lengthOf(toId) * 0.3));
    return turnCurve(start, start.heading, end, end.heading, 0.44);
  }

  /**
   * Choose the lane a vehicle should take when it enters `toLinkId` and will
   * subsequently leave onto `nextLinkId`. Straight movements preserve lane.
   */
  entryLane(fromLinkId, toLinkId, nextLinkId, fromLane = 0) {
    const link = this.links.get(toLinkId);
    if (!link) return 0;
    const n = link.lanes || 1;
    if (!nextLinkId) return clamp(fromLane, 0, n - 1);
    const turn = this.turnType(toLinkId, nextLinkId);
    if (turn === 'right') return 0;
    if (turn === 'left') return n - 1;
    return clamp(fromLane, 0, n - 1);
  }

  pathForTransition(fromId, fromLane, toId, toLane) {
    return this.buildTurnPath(fromId, fromLane, toId, toLane);
  }

  connector(fromId, toId, fromLane = 0) {
    return this.connectorIndex.get(`${fromId}:${toId}:${fromLane}`) || null;
  }

  /** Neighbouring links at the downstream node, optionally excluding U-turns. */
  nextLinks(linkId, allowUturn = false) {
    const link = this.links.get(linkId);
    if (!link) return [];
    const out = this.outgoing.get(link.to) || [];
    if (!out.length) return [];
    const filtered = out.filter((l) => l.id !== linkId && (allowUturn || l.to !== link.from));
    return filtered.length ? filtered : out.filter((l) => l.id !== linkId);
  }

  shortestPath(fromId, toId, allowUturn = false, mode = this.project.settings.routing || 'shortest') {
    if (!this.links.has(fromId) || !this.links.has(toId)) return null;
    if (fromId === toId) return [fromId];
    const key = `${fromId}>${toId}>${allowUturn ? 1 : 0}>${mode}`;
    if (this.pathCache.has(key)) return this.pathCache.get(key);
    const distances = new Map([[fromId, 0]]);
    const previous = new Map();
    const visited = new Set();
    const open = new Set([fromId]);
    let found = false;
    while (open.size) {
      let current = null, best = Infinity;
      for (const id of open) {
        const d = distances.get(id);
        if (d < best) { best = d; current = id; }
      }
      if (current === null) break;
      open.delete(current);
      if (visited.has(current)) continue;
      visited.add(current);
      if (current === toId) { found = true; break; }
      const link = this.links.get(current);
      if (!link) continue;
      for (const next of this.outgoing.get(link.to) || []) {
        if (next.id === current) continue;
        const uturn = next.to === link.from;
        if (uturn && !allowUturn) continue;
        const length = this.lengthOf(next.id);
        // `distance` compares metres (with a small turn-length penalty);
        // `shortest` and `random` compare free-flow seconds.
        const cost = mode === 'distance'
          ? length + this.turnPenalty(current, next.id) * 8
          : length / Math.max(3, this.speedMs(next.id)) + this.turnPenalty(current, next.id);
        const nd = best + cost;
        if (nd < (distances.get(next.id) ?? Infinity)) {
          distances.set(next.id, nd);
          previous.set(next.id, current);
          open.add(next.id);
        }
      }
    }
    let result = null;
    if (found) {
      result = [toId];
      let cur = toId;
      let guard = 0;
      while (cur !== fromId && guard++ < 500) {
        cur = previous.get(cur);
        if (!cur) { result = null; break; }
        result.unshift(cur);
      }
    }
    this.pathCache.set(key, result);
    return result;
  }

  /** Weighted destination choice; path costs follow `settings.routing`. */
  chooseRoute(fromId, rng) {
    const from = this.links.get(fromId);
    if (!from) return [fromId];
    const mode = this.project.settings.routing || 'shortest';
    let candidates = this.sinks().filter((dest) => {
      if (dest.id === fromId) return false;
      if (dest.from === from.from) return false; // immediate U-turn
      return true;
    });
    if (!candidates.length) candidates = this.sinks().filter((d) => d.id !== fromId);
    if (!candidates.length) return [fromId];
    const paths = new Map();
    const weights = candidates.map((d) => {
      const path = this.shortestPath(fromId, d.id, false, mode);
      paths.set(d.id, path);
      if (!path) return 0;
      if (mode === 'random') return 1;
      const length = path.reduce((s, id) => s + this.lengthOf(id), 0);
      return Math.max(0.05, (d.attraction || 1) * (1 + Math.min(2, length / 1200)));
    });
    const viable = candidates.filter((_, i) => weights[i] > 0);
    if (!viable.length) return [fromId];
    const dest = weightedChoice(rng, viable, (d) => {
      const i = candidates.indexOf(d);
      return weights[i];
    });
    return paths.get(dest.id) || this.shortestPath(fromId, dest.id, false, mode) || [fromId];
  }

  routeFreeFlowTime(route) {
    if (!route || !route.length) return 0;
    let t = 0;
    for (let i = 0; i < route.length; i++) {
      t += this.lengthOf(route[i]) / Math.max(2, this.speedMs(route[i]));
      if (i < route.length - 1) t += this.turnPenalty(route[i], route[i + 1]);
    }
    return t;
  }

  routeLength(route) {
    return (route || []).reduce((s, id) => s + this.lengthOf(id), 0);
  }

  nearestLink(x, y, maxDistance = Infinity) {
    let best = null;
    for (const link of this.project.links) {
      const pts = this.centerPolyline(link.id);
      const hit = distanceToPolyline(x, y, pts);
      if (hit.distance < maxDistance && (!best || hit.distance < best.distance)) {
        const proj = projectPointToPolyline(x, y, pts);
        best = { link, s: proj.s, distance: hit.distance, x: hit.x, y: hit.y };
      }
    }
    return best;
  }

  nearestLane(linkId, x, y) {
    const g = this.geometry.get(linkId);
    if (!g) return 0;
    const centerHit = projectPointToPolyline(x, y, g.center.points);
    const pt = pointAtDistance(g.center, centerHit.s);
    const lateral = (x - pt.x) * pt.nx + (y - pt.y) * pt.ny;
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < g.laneGeos.length; i++) {
      const d = Math.abs(lateral - g.laneGeos[i].offset);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  nearestNode(x, y, maxDist = Infinity) {
    let best = null;
    for (const n of this.project.nodes) {
      const d = dist(x, y, n.x, n.y);
      if (d < maxDist && (!best || d < best.distance)) best = { node: n, distance: d };
    }
    return best;
  }

  nodeAt(x, y, maxDist = 14) {
    return this.nearestNode(x, y, maxDist);
  }

  bounds() {
    const pts = [];
    for (const l of this.project.links) pts.push(...l.points);
    for (const n of this.project.nodes) pts.push({ x: n.x, y: n.y });
    if (!pts.length) return { minX: -100, minY: -100, maxX: 100, maxY: 100, width: 200, height: 200 };
    return boundsOfPoints(pts, 30);
  }

  connectedComponents() {
    const adj = new Map();
    for (const l of this.project.links) {
      if (!adj.has(l.from)) adj.set(l.from, new Set());
      if (!adj.has(l.to)) adj.set(l.to, new Set());
      adj.get(l.from).add(l.to);
      adj.get(l.to).add(l.from);
    }
    const seen = new Set();
    const comps = [];
    for (const n of this.project.nodes) {
      if (seen.has(n.id)) continue;
      const stack = [n.id], comp = [];
      seen.add(n.id);
      while (stack.length) {
        const cur = stack.pop(); comp.push(cur);
        for (const nb of adj.get(cur) || []) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
      }
      comps.push(comp);
    }
    return comps;
  }

  validate() {
    const issues = [];
    const p = this.project;
    const linkIds = new Set(p.links.map((l) => l.id));
    const controllerIds = new Set(p.signalControllers.map((c) => c.id));
    const classIds = new Set(p.classes.map((c) => c.id));
    const routeIds = new Set(p.routes.map((r) => r.id));
    const duplicateCheck = (label, collection) => {
      const seen = new Set();
      for (const item of collection) {
        if (seen.has(item.id)) issues.push({ level: 'error', text: `${label} ${item.id} is defined more than once.` });
        seen.add(item.id);
      }
    };
    duplicateCheck('Node', p.nodes);
    duplicateCheck('Link', p.links);
    duplicateCheck('Controller', p.signalControllers);
    duplicateCheck('Signal head', p.signalHeads);
    duplicateCheck('Crossing', p.crosswalks);
    duplicateCheck('Detector', p.detectors);
    duplicateCheck('Input', p.inputs);
    duplicateCheck('Route', p.routes);
    duplicateCheck('Transit line', p.ptLines);
    duplicateCheck('Vehicle class', p.classes);

    if (!p.links.length) issues.push({ level: 'error', text: 'Network has no links.' });
    if (!p.inputs.length) issues.push({ level: 'warn', text: 'No vehicle inputs are defined.' });
    if (!p.classes.length) issues.push({ level: 'error', text: 'No vehicle classes are defined.' });
    if (!this.sinks().length) issues.push({ level: 'warn', text: 'No sink links: vehicles will leave at the end of their route.' });
    if (p.settings.duration <= 0) issues.push({ level: 'error', text: 'Simulation duration must be greater than zero.' });
    if (p.settings.warmup >= p.settings.duration) issues.push({ level: 'warn', text: 'Warm-up is at least as long as the simulation, so the measurement window is empty.' });
    for (const l of p.links) {
      if (!this.nodes.has(l.from)) issues.push({ level: 'warn', text: `Link ${l.id} references missing node ${l.from}.` });
      if (!this.nodes.has(l.to)) issues.push({ level: 'warn', text: `Link ${l.id} references missing node ${l.to}.` });
      if (!l.points || l.points.length < 2) issues.push({ level: 'error', text: `Link ${l.id} has fewer than two geometry points.` });
      else if (!l.points.every((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y))) issues.push({ level: 'error', text: `Link ${l.id} has a non-finite geometry coordinate.` });
      else if (this.lengthOf(l.id) < 0.5) issues.push({ level: 'error', text: `Link ${l.id} has zero length.` });
      if (l.from === l.to) issues.push({ level: 'warn', text: `Link ${l.id} starts and ends at the same node.` });
      if (!this.outgoing.get(l.from)?.length) issues.push({ level: 'warn', text: `Link ${l.id} starts at a node with no outgoing movement.` });
    }
    for (const c of p.signalControllers) {
      if (!c.phases.length) issues.push({ level: 'error', text: `Controller ${c.name} has no phases.` });
      const total = c.phases.reduce((s, ph) => s + Math.max(0, ph.duration || 0) + Math.max(0, ph.yellow || 0) + Math.max(0, ph.allRed || 0), 0);
      if (total <= 0) issues.push({ level: 'error', text: `Controller ${c.name} has a zero-length cycle.` });
      const phaseIds = new Set();
      for (const ph of c.phases) {
        if (phaseIds.has(ph.id)) issues.push({ level: 'error', text: `Controller ${c.name} has duplicate phase ${ph.id}.` });
        phaseIds.add(ph.id);
        if (ph.duration < 0 || ph.yellow < 0 || ph.allRed < 0) issues.push({ level: 'warn', text: `Controller ${c.name} phase ${ph.name} has a negative interval.` });
        for (const linkId of ph.green || []) {
          if (!linkIds.has(linkId)) issues.push({ level: 'warn', text: `Controller ${c.name} phase ${ph.name} references missing link ${linkId}.` });
        }
      }
    }
    for (const h of p.signalHeads) {
      if (!controllerIds.has(h.controllerId)) issues.push({ level: 'error', text: `Signal ${h.name} references missing controller ${h.controllerId}.` });
      if (!linkIds.has(h.linkId)) issues.push({ level: 'warn', text: `Signal ${h.name} references missing link ${h.linkId}.` });
      if (!(h.pos >= 0 && h.pos <= 1)) issues.push({ level: 'warn', text: `Signal ${h.name} position must be between 0 and 1.` });
    }
    for (const cw of p.crosswalks) {
      if (!linkIds.has(cw.linkId)) issues.push({ level: 'error', text: `Crossing ${cw.name} references missing link ${cw.linkId}.` });
      if (cw.controllerId && !controllerIds.has(cw.controllerId)) issues.push({ level: 'warn', text: `Crossing ${cw.name} references missing controller ${cw.controllerId}.` });
      if (!(cw.pos >= 0 && cw.pos <= 1)) issues.push({ level: 'warn', text: `Crossing ${cw.name} position must be between 0 and 1.` });
      if (cw.pedFlow < 0) issues.push({ level: 'warn', text: `Crossing ${cw.name} has a negative pedestrian flow.` });
    }
    for (const d of p.detectors) {
      const link = this.links.get(d.linkId);
      if (!link) issues.push({ level: 'error', text: `Detector ${d.name} references missing link ${d.linkId}.` });
      else if ((d.lane ?? 0) < 0 || (d.lane ?? 0) >= (link.lanes || 1)) issues.push({ level: 'warn', text: `Detector ${d.name} uses lane ${(d.lane ?? 0) + 1}, but ${d.linkId} has ${link.lanes || 1} lane(s).` });
      if (!(d.pos >= 0 && d.pos <= 1)) issues.push({ level: 'warn', text: `Detector ${d.name} position must be between 0 and 1.` });
    }
    for (const i of p.inputs) {
      if (!linkIds.has(i.linkId)) issues.push({ level: 'error', text: `Input ${i.name} references missing link ${i.linkId}.` });
      if (i.routeId && !routeIds.has(i.routeId)) issues.push({ level: 'warn', text: `Input ${i.name} references missing route ${i.routeId}; it will use automatic routing.` });
      if (i.volume < 0) issues.push({ level: 'error', text: `Input ${i.name} has a negative volume.` });
      else if (i.volume === 0) issues.push({ level: 'warn', text: `Input ${i.name} has zero volume.` });
      if (i.from < 0 || i.to < i.from) issues.push({ level: 'warn', text: `Input ${i.name} has an invalid active interval.` });
      for (const [classId, weight] of Object.entries(i.composition || {})) {
        if (!classIds.has(classId)) issues.push({ level: 'warn', text: `Input ${i.name} references missing vehicle class ${classId}.` });
        else if (weight < 0) issues.push({ level: 'warn', text: `Input ${i.name} gives ${classId} a negative share.` });
      }
    }
    for (const route of p.routes) {
      if (!route.links?.length) issues.push({ level: 'warn', text: `Route ${route.name} has no links.` });
      for (const linkId of route.links || []) if (!linkIds.has(linkId)) issues.push({ level: 'warn', text: `Route ${route.name} references missing link ${linkId}.` });
    }
    for (const line of p.ptLines) {
      if (!classIds.has(line.classId)) issues.push({ level: 'warn', text: `Transit line ${line.name} references missing vehicle class ${line.classId}.` });
      if (!line.route?.length) issues.push({ level: 'warn', text: `Transit line ${line.name} has no route.` });
      for (const linkId of line.route || []) if (!linkIds.has(linkId)) issues.push({ level: 'warn', text: `Transit line ${line.name} references missing link ${linkId}.` });
      for (const stop of line.stops || []) if (!linkIds.has(stop.linkId)) issues.push({ level: 'warn', text: `Transit stop ${stop.name || 'unnamed'} references missing link ${stop.linkId}.` });
      if (!(line.headway > 0)) issues.push({ level: 'warn', text: `Transit line ${line.name} needs a positive headway.` });
    }
    const comps = this.connectedComponents();
    if (comps.length > 1) issues.push({ level: 'warn', text: `Network has ${comps.length} disconnected components.` });
    return issues;
  }
}

function pathGeoLength(points) {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += dist(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
  return s;
}
