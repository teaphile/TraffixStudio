import { Network } from './network.js';
import { Evaluation } from './evaluation.js';
import { SignalSystem } from './signals.js';
import {
  clamp, dist, expRandom, mulberry32, randRange, weightedChoice,
} from './utils.js';

const CAR_COLORS = ['#dbe7f3', '#cbd5e1', '#94a3b8', '#f87171', '#60a5fa', '#f8fafc', '#334155', '#fbbf24', '#a78bfa'];

/**
 * Microscopic traffic simulator.
 * - IDM car-following with driver heterogeneity
 * - MOBIL-inspired lane changes
 * - conflict-safe junction transitions
 * - fixed / actuated signals, pedestrian phases
 * - bus stops and dwell time
 */
export class Simulation {
  constructor(project, opts = {}) {
    this.project = project;
    this.net = opts.network || new Network(project);
    this.seed = opts.seed ?? project.settings.seed ?? 1;
    this.rng = mulberry32(this.seed);
    this.dt = clamp(project.settings.step || 0.1, 0.02, 0.5);
    this.warmup = Math.max(0, project.settings.warmup || 0);
    this.duration = Math.max(5, project.settings.duration || 900);
    this.t = 0;
    this.finished = false;
    this.results = null;
    this.vehicles = [];
    this.peds = [];
    this.transitions = new Set();
    this.crosswalkBlocked = new Map();
    this.vehicleSeq = 0;
    this.pedSeq = 0;
    this.finishedVehicles = 0;
    this.signalSystem = new SignalSystem(project, this.net);
    this.evaluation = new Evaluation(project, this.net, { warmup: this.warmup, duration: this.duration });
    this.classMap = new Map(project.classes.map((c) => [c.id, c]));
    this.classCategory = new Map(project.classes.map((c) => [c.id, c.category]));

    this.inputRuntime = project.inputs.map((input) => ({
      input,
      timer: this._initialDelay(input.volume),
      active: input.volume > 0,
    }));

    this.crosswalkRuntime = project.crosswalks.map((cw) => {
      const link = this.net.link(cw.linkId);
      const width = link ? this.net.width(cw.linkId) : 7;
      return {
        cw, width, crossDistance: width + 4,
        queue: [], arrivals: 0,
        blocked: false,
      };
    });

    this.ptRuntime = (project.ptLines || []).map((line) => ({
      line, timer: 12 + this.rng() * 25, spawned: 0, lastSpawn: -Infinity,
    }));

    // Prime fixed-time signals for the editor preview.
    this.signalSystem.update(0, 0, null);
  }

  _initialDelay(volume) {
    if (!volume || volume <= 0) return Infinity;
    const mean = 3600 / volume;
    return Math.max(0.15, this.rng() * mean);
  }

  get time() { return this.t; }
  get activeVehicles() { return this.vehicles.length; }
  get isComplete() { return this.finished; }

  step(count = 1) {
    for (let i = 0; i < count; i++) {
      if (this.finished) break;
      this._stepOnce();
    }
    return this.getSnapshot();
  }

  runUntil(seconds) {
    const target = Math.min(seconds ?? this.duration, this.duration);
    let guard = 0;
    while (this.t < target && !this.finished && guard++ < 1000000) this._stepOnce();
    return this.getSnapshot();
  }

  _stepOnce() {
    const dt = this.dt;
    this.t = Math.min(this.duration, this.t + dt);
    this.signalSystem.update(this.t, dt, this);
    this._removeFinished();
    this._spawnVehicles(dt);
    this._spawnTransit(dt);
    this._updatePedestrians(dt);
    this._buildCrosswalkBlock();
    this._updateVehicles(dt);
    this._removeFinished();
    this.evaluation.tick(dt, this.t, this.vehicles, this.peds.length, this._pedQueueLength());
    if (this.t >= this.duration - 1e-9) this.finish();
  }

  _removeFinished() {
    if (!this.vehicles.some((v) => v.finished)) return;
    this.vehicles = this.vehicles.filter((v) => !v.finished);
  }

  _pedQueueLength() {
    return this.crosswalkRuntime.reduce((s, rt) => s + rt.queue.length, 0);
  }

  // ---------------------------------------------------------------- spawning
  _spawnVehicles(dt) {
    for (const rt of this.inputRuntime) {
      const input = rt.input;
      if (!input.volume || input.volume <= 0) continue;
      if (this.t < (input.from || 0) || this.t > (input.to ?? this.duration)) continue;
      rt.timer -= dt;
      let attempts = 0;
      while (rt.timer <= 0 && attempts++ < 8) {
        const spawned = this._trySpawnVehicle(input);
        if (!spawned) { rt.timer = 0.5; break; }
        rt.timer += expRandom(this.rng, 3600 / input.volume);
      }
    }
  }

  _trySpawnVehicle(input) {
    const link = this.net.link(input.linkId);
    if (!link) return false;
    const weights = Object.entries(input.composition || {}).filter(([id, w]) => w > 0 && this.classMap.has(id));
    let classId;
    if (weights.length) {
      classId = weightedChoice(this.rng, weights, ([, w]) => w)[0];
    } else {
      const cars = this.project.classes.filter((c) => c.category === 'car');
      classId = (cars[0] || this.project.classes[0])?.id;
    }
    const cls = this.classMap.get(classId);
    if (!cls) return false;

    let route = null;
    if (input.routeId) {
      const r = this.project.routes.find((x) => x.id === input.routeId);
      if (r && r.links?.length) {
        const idx = r.links.indexOf(input.linkId);
        route = idx >= 0 ? r.links.slice(idx) : null;
      }
    }
    if (!route) route = this.net.chooseRoute(link.id, this.rng);
    if (!route || !route.length) return false;

    const laneCandidates = [];
    if (route.length > 1) {
      const turn = this.net.turnType(link.id, route[1]);
      if (turn === 'right') laneCandidates.push(0);
      else if (turn === 'left') laneCandidates.push((link.lanes || 1) - 1);
      else for (let l = 0; l < (link.lanes || 1); l++) laneCandidates.push(l);
    } else {
      for (let l = 0; l < (link.lanes || 1); l++) laneCandidates.push(l);
    }
    const spawnS = Math.max(cls.length / 2 + 1.2, 2.5);
    let lane = null;
    let bestGap = -Infinity;
    for (const l of [...new Set(laneCandidates)]) {
      const gap = this._entryGap(link.id, l, spawnS, cls.length);
      if (gap > bestGap) { bestGap = gap; lane = l; }
      if (gap > 12) { lane = l; break; }
    }
    if (lane === null || bestGap < cls.length + 2.5) return false;

    const v = this._makeVehicle(cls, link.id, lane, spawnS, route, 0);
    v.v = Math.min(v.v0 * 0.65, 7.5);
    this.vehicles.push(v);
    this.evaluation.onSpawn(v, this.t);
    this.evaluation.onEnterLink(v, link.id, this.t);
    return true;
  }

  _entryGap(linkId, lane, s, length) {
    let gap = Infinity;
    for (const v of this.vehicles) {
      if (v.linkId !== linkId || v.lane !== lane || v.transition) continue;
      if (v.s + v.length / 2 > s - length / 2) {
        gap = Math.min(gap, (v.s - v.length / 2) - (s + length / 2));
      }
    }
    return gap;
  }

  _makeVehicle(cls, linkId, lane, s, route, routeIdx) {
    const link = this.net.link(linkId);
    const driver = cls.behavior === 'aggressive' ? randRange(this.rng, 1.02, 1.12)
      : cls.behavior === 'cautious' ? randRange(this.rng, 0.9, 1.0) : randRange(this.rng, 0.95, 1.06);
    const v0 = Math.min(cls.maxSpeed, (link?.speed || 50) * 1.04) / 3.6 * driver;
    const color = cls.category === 'car'
      ? (this.rng() < 0.55 ? cls.color : CAR_COLORS[Math.floor(this.rng() * CAR_COLORS.length)])
      : cls.color;
    const id = ++this.vehicleSeq;
    const veh = {
      id: `veh-${id}`, classId: cls.id, classCategory: cls.category,
      length: cls.length, width: cls.width, height: cls.height,
      color, lane, linkId, s, v: Math.min(v0, 9), v0, acc: 0,
      accel: cls.accel, decel: cls.decel, minGap: cls.minGap, headway: cls.headway * randRange(this.rng, 0.85, 1.15),
      route, routeIdx, nextLinkId: route[routeIdx + 1] || null,
      spawnTime: this.t, measured: this.t >= this.warmup - 1e-6,
      distance: 0, stops: 0, stoppedTime: 0, wasStopped: false,
      freeFlowTime: this.net.routeFreeFlowTime(route),
      transition: null, laneFrom: null, laneAnim: 0, laneAnimDur: 1.35,
      laneTimer: this.rng() * 1.4, stopCleared: false, stopTimer: 0,
      dwell: 0, servedStops: new Set(), nextStop: null, fuel: 0,
      isBus: cls.category === 'bus', ptLineId: null, x: null, y: null, heading: 0,
    };
    return veh;
  }

  _spawnTransit(dt) {
    for (const rt of this.ptRuntime) {
      const line = rt.line;
      const cls = this.classMap.get(line.classId);
      if (!cls || !line.route?.length) continue;
      if (this.t < 8) { rt.timer -= dt; continue; }
      rt.timer -= dt;
      if (rt.timer > 0) continue;
      if (this.t - rt.lastSpawn < Math.min(line.headway || 600, 30)) { rt.timer = 5; continue; }
      const first = line.route[0];
      const link = this.net.link(first);
      if (!link) { rt.timer = 30; continue; }
      const spawnS = cls.length / 2 + 1.5;
      let lane = 0;
      if (line.route.length > 1) {
        const turn = this.net.turnType(first, line.route[1]);
        lane = turn === 'left' ? (link.lanes || 1) - 1 : 0;
      }
      if (this._entryGap(first, lane, spawnS, cls.length) < cls.length + 3) { rt.timer = 4; continue; }
      const v = this._makeVehicle(cls, first, lane, spawnS, line.route, 0);
      v.isBus = true;
      v.ptLineId = line.id;
      v.color = line.color || cls.color;
      v.busStops = (line.stops || []).filter((st) => line.route.includes(st.linkId));
      v.servedStops = new Set();
      v.dwell = 0;
      v.nextStop = null;
      v.v = Math.min(8, v.v0);
      this.vehicles.push(v);
      this.evaluation.onSpawn(v, this.t);
      this.evaluation.onEnterLink(v, first, this.t);
      rt.spawned++;
      rt.lastSpawn = this.t;
      rt.timer += Math.max(30, line.headway || 600) * randRange(this.rng, 0.88, 1.12);
      this.evaluation.busTrips = (this.evaluation.busTrips || 0) + 1;
    }
  }

  // ------------------------------------------------------------- pedestrians
  _updatePedestrians(dt) {
    for (const rt of this.crosswalkRuntime) {
      const cw = rt.cw;
      const link = this.net.link(cw.linkId);
      if (!link) continue;
      const flow = cw.pedFlow || 0;
      rt.arrivals += flow / 3600 * dt;
      while (rt.arrivals >= 1) {
        rt.arrivals -= 1;
        if (rt.queue.length < 45) rt.queue.push({ at: this.t, side: this.rng() < 0.5 ? -1 : 1 });
      }
      const walk = this._pedestrianWalkAllowed(rt);
      if (walk && rt.queue.length) {
        let release = Math.min(rt.queue.length, 2 + Math.floor(this.rng() * 3));
        while (release-- > 0) {
          const q = rt.queue.shift();
          const width = rt.width;
          const startOffset = q.side * (width / 2 + 2.1);
          const ped = {
            id: ++this.pedSeq, crosswalkId: cw.id, linkId: cw.linkId,
            s: clamp(cw.pos, 0, 1) * this.net.lengthOf(cw.linkId),
            offset: startOffset, dir: -q.side, speed: (cw.speed || 1.25) * randRange(this.rng, 0.88, 1.12),
            spawnedAt: this.t, queuedAt: q.at, onRoad: false, x: 0, y: 0, heading: 0,
            width, crossDistance: rt.crossDistance,
          };
          this.peds.push(ped);
          this.evaluation.onPedSpawn(ped, this.t);
        }
      }
    }

    let active = [];
    for (const p of this.peds) {
      p.offset += p.dir * p.speed * dt;
      const half = p.width / 2 + 2.1;
      p.onRoad = Math.abs(p.offset) < p.width / 2 + 0.6;
      const c = this.net.centerPosition(p.linkId, p.s);
      p.x = c.x + c.nx * p.offset;
      p.y = c.y + c.ny * p.offset;
      p.heading = Math.atan2(c.ny * p.dir, c.nx * p.dir);
      if (Math.abs(p.offset) >= half) {
        this.evaluation.onPedComplete(p, this.t);
      } else {
        active.push(p);
      }
    }
    this.peds = active;
    this.evaluation.setPedQueue(this._pedQueueLength());
  }

  _buildCrosswalkBlock() {
    this.crosswalkBlocked.clear();
    for (const rt of this.crosswalkRuntime) {
      let blocked = false;
      for (const p of this.peds) {
        if (p.crosswalkId === rt.cw.id && p.onRoad) { blocked = true; break; }
      }
      rt.blocked = blocked;
      this.crosswalkBlocked.set(rt.cw.id, blocked);
    }
  }

  /**
   * A walk interval is controlled by the signal when one is assigned.
   * With "Pedestrians yield to traffic" disabled for an uncontrolled
   * crossing, waiting pedestrians only start when no vehicle is approaching.
   */
  _pedestrianWalkAllowed(rt) {
    const cw = rt.cw;
    if (!this.signalSystem.isPedWalk(cw)) return false;
    if (this.project.settings.pedestrianYield !== false) return true;
    if (cw.controllerId) return true;
    const len = this.net.lengthOf(cw.linkId);
    const at = clamp(cw.pos, 0, 1) * len;
    for (const v of this.vehicles) {
      if (v.finished || v.transition || v.linkId !== cw.linkId) continue;
      const front = v.s + v.length / 2;
      if (front <= at && at - front < 55 && v.v > 1.2) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- vehicles
  _updateVehicles(dt) {
    const groups = new Map();
    for (const v of this.vehicles) {
      if (v.finished) continue;
      if (v.transition) { this._updateTransition(v, dt); continue; }
      const key = `${v.linkId}|${v.lane}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(v);
    }
    for (const arr of groups.values()) arr.sort((a, b) => a.s - b.s);
    const leaderMap = new Map();
    for (const arr of groups.values()) {
      for (let i = 0; i < arr.length; i++) leaderMap.set(arr[i].id, arr[i + 1] || null);
    }

    for (const v of this.vehicles) {
      if (v.finished || v.transition) continue;
      const link = this.net.link(v.linkId);
      if (!link) { this._finishVehicle(v); continue; }

      if (v.dwell > 0) {
        v.dwell -= dt;
        v.v = 0;
        v.acc = 0;
        continue;
      }

      const leader = leaderMap.get(v.id) || null;
      const stop = this._stopConstraint(v);
      this._maybeTriggerBusStop(v);
      const acc = this._idm(v, leader, stop);
      v.acc = acc;
      const prevS = v.s;
      v.v = Math.max(0, v.v + acc * dt);
      if (v.v > v.v0 * 1.12) v.v = v.v0 * 1.12;
      v.s += v.v * dt;
      if (v.v < 0.03 && acc < 0) v.v = 0;
      if (v.s < 0.1) v.s = 0.1;
      v.distance += Math.max(0, v.s - prevS);
      v.x = null;
      if (v.laneAnim > 0) {
        v.laneAnim = Math.max(0, v.laneAnim - dt);
        if (v.laneAnim <= 0) v.laneFrom = null;
      }

      if (stop && Number.isFinite(stop.s)) {
        const limit = stop.s - v.length / 2;
        if (v.s > limit && v.s - prevS > 0 && stop.hard && prevS <= limit + 0.8) {
          v.s = Math.max(0.1, limit);
          v.v = 0;
        }
      }

      this._detect(v, prevS);
      if (this.project.settings.laneChanging !== false) this._laneChange(v, leader, dt);
      if (v.dwell <= 0) this._maybeStartTransition(v);
    }
  }

  _idm(v, leader, stop) {
    const v0 = Math.max(1, v.v0);
    const a = v.accel || 2.5;
    const b = v.decel || 4.5;
    let gap = Infinity;
    let leadSpeed = v.v;
    if (leader) {
      gap = leader.s - leader.length / 2 - (v.s + v.length / 2);
      leadSpeed = leader.v;
    }
    if (stop) {
      const stopGap = stop.s - (v.s + v.length / 2);
      if (stopGap < gap) { gap = stopGap; leadSpeed = 0; }
    }
    if (!Number.isFinite(gap)) gap = 1000;
    gap = Math.max(0.05, gap);

    const dv = v.v - leadSpeed;
    const sStar = v.minGap + Math.max(0, v.v * v.headway + (v.v * dv) / (2 * Math.sqrt(a * b)));
    let acc = a * (1 - Math.pow(v.v / v0, 4) - Math.pow(sStar / gap, 2));
    if (v.transition) acc = 0;
    if (gap < 2.2 && v.v > 0.8) acc = Math.min(acc, -b * 0.85);
    if (gap < 0.7) acc = Math.min(acc, -b * 1.7);
    return clamp(acc, -b * 1.8, a);
  }

  _stopConstraint(v) {
    const link = this.net.link(v.linkId);
    if (!link) return null;
    const len = this.net.lengthOf(v.linkId);
    const front = v.s + v.length / 2;
    let best = null;

    const signal = this.net.signalHeads(v.linkId)[0];
    if (signal) {
      const state = this.signalSystem.stateForLink(v.linkId);
      if (state === 'red' || state === 'yellow') {
        const stopS = clamp(signal.pos ?? 0.955, 0, 1) * len;
        const gap = stopS - front;
        const canStop = gap > (v.v * v.v) / (2 * (v.decel || 4.5)) + 1.5;
        let enforce = state === 'red';
        if (state === 'yellow') enforce = canStop;
        if (this.project.settings.rightTurnOnRed && v.routeIdx + 1 < v.route.length) {
          const next = v.route[v.routeIdx + 1];
          if (this.net.turnType(v.linkId, next) === 'right' && !this._crosswalkAheadBlocked(v)) enforce = false;
        }
        if (enforce && gap > -0.5 && stopS <= len - 0.5) best = { s: stopS, hard: true, reason: 'signal' };
      }
    }

    for (const cw of this.net.crosswalks(v.linkId)) {
      if (this.project.settings.pedestrianYield === false && !cw.controllerId) continue;
      if (!this.crosswalkBlocked.get(cw.id)) continue;
      const stopS = clamp(cw.pos, 0, 1) * len - (cw.width || 4) / 2 - 2.0;
      const gap = stopS - front;
      if (gap > -0.5 && stopS <= len - 0.2) {
        if (!best || stopS < best.s) best = { s: stopS, hard: false, reason: 'pedestrian' };
      }
    }

    const node = this.net.node(link.to);
    if (node && node.control === 'stop' && !v.stopCleared) {
      const stopS = Math.max(2, len - 2.0);
      const gap = stopS - front;
      if (gap < 2.2 && v.v < 0.5) {
        v.stopTimer += this.dt;
        if (v.stopTimer > 1.2) { v.stopCleared = true; v.stopTimer = 0; }
      }
      if (!v.stopCleared && gap > -0.5) best = { s: stopS, hard: true, reason: 'stop' };
    }

    if (v.isBus && v.busStops?.length) {
      for (let i = 0; i < v.busStops.length; i++) {
        if (v.servedStops.has(i)) continue;
        const st = v.busStops[i];
        if (st.linkId !== v.linkId) continue;
        const stopS = clamp(st.pos, 0, 1) * len;
        const gap = stopS - front;
        if (gap > -2 && gap < 120) {
          if (!best || stopS < best.s) best = { s: stopS, hard: true, reason: 'bus-stop' };
        }
        break;
      }
    }
    return best;
  }

  _crosswalkAheadBlocked(v) {
    for (const cw of this.net.crosswalks(v.linkId)) {
      if (this.crosswalkBlocked.get(cw.id)) return true;
    }
    return false;
  }

  _maybeTriggerBusStop(v) {
    if (!v.isBus || !v.busStops?.length || v.dwell > 0) return;
    const len = this.net.lengthOf(v.linkId);
    for (let i = 0; i < v.busStops.length; i++) {
      if (v.servedStops.has(i)) continue;
      const st = v.busStops[i];
      if (st.linkId !== v.linkId) continue;
      const stopS = clamp(st.pos, 0, 1) * len;
      const front = v.s + v.length / 2;
      if (v.v < 0.45 && front >= stopS - 4.5) {
        v.servedStops.add(i);
        const line = this.project.ptLines.find((l) => l.id === v.ptLineId);
        v.dwell = Math.max(5, line?.dwell || 12);
        v.v = 0;
      }
      break;
    }
  }

  _detect(v, prevS) {
    const dets = this.net.detectors(v.linkId);
    if (!dets.length) return;
    const len = this.net.lengthOf(v.linkId);
    for (const d of dets) {
      if (d.lane !== null && d.lane !== undefined && d.lane !== v.lane) continue;
      const at = clamp(d.pos, 0, 1) * len;
      if (prevS < at && v.s >= at) this.evaluation.onDetectorPass(v, d, this.t);
    }
  }

  _laneChange(v, leader, dt) {
    v.laneTimer -= dt;
    if (v.laneTimer > 0) return;
    v.laneTimer = randRange(this.rng, 1.1, 2.4);
    const link = this.net.link(v.linkId);
    if (!link || v.transition) return;
    const lanes = link.lanes || 1;
    if (lanes < 2) return;

    let target = null;
    if (v.routeIdx + 1 < v.route.length) {
      const preferred = this.net.preferredLane(v.linkId, v.route[v.routeIdx + 1]);
      if (preferred !== null && preferred !== v.lane) target = preferred;
    }
    if (target === null && leader) {
      const gap = leader.s - leader.length / 2 - (v.s + v.length / 2);
      if (gap < 24 && leader.v < v.v - 1.2) {
        const candidates = [v.lane - 1, v.lane + 1].filter((l) => l >= 0 && l < lanes);
        let bestScore = -Infinity;
        for (const l of candidates) {
          const m = this._laneGap(v, l);
          const score = Math.min(m.front, 90) + Math.min(m.rear, 60) - (l === 0 ? 0 : 2);
          if (m.front > 10 && m.rear > 8 && score > bestScore) { bestScore = score; target = l; }
        }
      }
    }
    if (target === null || target === v.lane) return;
    const m = this._laneGap(v, target);
    const minFront = 5 + v.v * 0.75;
    const minRear = 7 + v.v * 0.65;
    if (m.front < minFront || m.rear < minRear) return;

    v.laneFrom = v.lane;
    v.laneFromOffset = this.net.laneOffset(v.linkId, v.lane);
    v.lane = target;
    v.laneToOffset = this.net.laneOffset(v.linkId, target);
    v.laneAnim = v.laneAnimDur;
    v.laneTimer = randRange(this.rng, 2.0, 4.0);
  }

  _laneGap(v, lane) {
    let front = Infinity, rear = Infinity;
    for (const o of this.vehicles) {
      if (o === v || o.linkId !== v.linkId || o.lane !== lane || o.transition) continue;
      if (o.s >= v.s) {
        const gap = o.s - o.length / 2 - (v.s + v.length / 2);
        if (gap < front) front = gap;
      } else {
        const gap = (v.s - v.length / 2) - (o.s + o.length / 2);
        if (gap < rear) rear = gap;
      }
    }
    return { front, rear };
  }

  _maybeStartTransition(v) {
    const len = this.net.lengthOf(v.linkId);
    const front = v.s + v.length / 2;
    if (front < len - 0.6) return;
    if (v.routeIdx + 1 >= v.route.length) {
      if (front >= len - 0.2) this._finishVehicle(v);
      return;
    }
    const targetLinkId = v.route[v.routeIdx + 1];
    const targetLink = this.net.link(targetLinkId);
    if (!targetLink) { this._finishVehicle(v); return; }
    const nextNext = v.route[v.routeIdx + 2] || null;
    let entryLane = this.net.entryLane(v.linkId, targetLinkId, nextNext, v.lane);
    if (entryLane >= (targetLink.lanes || 1)) entryLane = (targetLink.lanes || 1) - 1;
    const targetStartGap = this._entryGap(targetLinkId, entryLane, v.length / 2 + 2, v.length);
    if (targetStartGap < v.length + 3) {
      v.s = Math.min(v.s, len - v.length / 2 - 0.08);
      v.v = 0;
      return;
    }
    const path = this.net.buildTurnPath(v.linkId, v.lane, targetLinkId, entryLane);
    if (!path.length) { v.s = Math.min(v.s, len - v.length / 2 - 0.08); v.v = 0; return; }
    const nodeId = this.net.link(v.linkId).to;
    if (this._junctionConflict(nodeId, path, v, targetLinkId)) {
      v.s = Math.min(v.s, len - v.length / 2 - 0.08);
      v.v = 0;
      return;
    }
    const turn = this.net.turnType(v.linkId, targetLinkId);
    const curveSpeed = turn === 'right' ? 6.8 : turn === 'left' ? 8.6 : 12.5;
    v.v = clamp(Math.max(v.v, turn === 'right' ? 5.2 : turn === 'left' ? 6.4 : 8.6), 0, curveSpeed);
    const sampled = samplePath(path);
    v.transition = {
      path, sampled, length: sampled.length,
      travel: 0, speed: v.v, nodeId,
      targetLinkId, targetLane: entryLane, nextRouteIdx: v.routeIdx + 1,
      turn,
    };
    this.transitions.add(v.id);
    this.evaluation.onExitLink(v, v.linkId, this.t);
    v.s = len;
  }

  _junctionConflict(nodeId, path, self, targetLinkId) {
    for (const other of this.vehicles) {
      if (other === self || !other.transition) continue;
      if (other.transition.nodeId !== nodeId) continue;
      const sameMovement = other.linkId === self.linkId
        && other.transition.targetLinkId === targetLinkId
        && other.lane === self.lane;
      if (sameMovement) {
        // Permit following vehicles into the junction once the leader has
        // cleared enough of the crossing path.
        if (other.transition.travel > other.length + 5 && other.transition.length - other.transition.travel > 3) continue;
        return true;
      }
      if (pathProximity(path, other.transition.path, 2.8)) return true;
    }
    return false;
  }

  _updateTransition(v, dt) {
    const tr = v.transition;
    tr.travel += v.v * dt;
    if (tr.travel >= tr.length - 0.05) {
      this._completeTransition(v);
      return;
    }
    const pt = pointOnSampledPath(tr.sampled, tr.travel);
    v.x = pt.x; v.y = pt.y; v.heading = pt.heading;
    v.acc = 0;
  }

  _completeTransition(v) {
    const tr = v.transition;
    const target = this.net.link(tr.targetLinkId);
    if (!target) { this._finishVehicle(v); return; }
    const last = tr.sampled.points[tr.sampled.points.length - 1];
    v.x = last.x; v.y = last.y;
    v.heading = last.heading;
    v.linkId = tr.targetLinkId;
    v.lane = Math.min(tr.targetLane, (target.lanes || 1) - 1);
    v.s = Math.max(v.length / 2 + 0.3, Math.min(3.2, this.net.lengthOf(v.linkId) * 0.5));
    v.routeIdx = tr.nextRouteIdx;
    v.nextLinkId = v.route[v.routeIdx + 1] || null;
    v.transition = null;
    this.transitions.delete(v.id);
    v.stopCleared = false;
    v.stopTimer = 0;
    v.laneFrom = null;
    v.laneAnim = 0;
    const targetClass = this.classMap.get(v.classId);
    v.v0 = Math.min(targetClass?.maxSpeed || 55, (target.speed || 50) * 1.04) / 3.6
      * (targetClass?.behavior === 'aggressive' ? 1.06 : targetClass?.behavior === 'cautious' ? 0.95 : 1.0);
    v.v = Math.min(v.v, Math.max(v.v0, 3));
    this.evaluation.onEnterLink(v, v.linkId, this.t);
  }

  _finishVehicle(v) {
    if (v.finished) return;
    v.finished = true;
    if (!v.transition) this.evaluation.onExitLink(v, v.linkId, this.t);
    this.evaluation.onArrive(v, this.t);
    this.finishedVehicles++;
    if (v.transition) this.transitions.delete(v.id);
  }

  finish() {
    if (this.finished) return this.results;
    this.finished = true;
    this.results = this.evaluation.finalize(this.t, true);
    return this.results;
  }

  getResults() {
    if (this.results) return this.results;
    return this.evaluation.finalize(this.t, this.finished);
  }

  getSnapshot() {
    const speeds = this.vehicles.filter((v) => !v.transition).map((v) => v.v * 3.6);
    return {
      time: this.t, active: this.vehicles.length, completed: this.evaluation.completedMeasured,
      peds: this.peds.length, finished: this.finished,
      avgSpeed: speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0,
      queue: this.evaluation.queueNow,
    };
  }

  /** Render position including the lane-change interpolation. */
  vehiclePose(v) {
    if (v.transition) {
      const pt = v.x !== null && v.y !== null ? { x: v.x, y: v.y, heading: v.heading } : pointOnSampledPath(v.transition.sampled, v.transition.travel);
      return { ...pt, nx: Math.cos(pt.heading + Math.PI / 2), ny: Math.sin(pt.heading + Math.PI / 2), laneMix: 1 };
    }
    let lateral = 0;
    if (v.laneAnim > 0 && v.laneFrom !== null && v.laneFrom !== undefined) {
      const t = clamp(1 - v.laneAnim / v.laneAnimDur, 0, 1);
      const ease = t * t * (3 - 2 * t);
      const fromOff = v.laneFromOffset ?? 0;
      const toOff = v.laneToOffset ?? this.net.laneOffset(v.linkId, v.lane);
      lateral = (fromOff - toOff) * (1 - ease);
    }
    const pos = this.net.position(v.linkId, v.lane, v.s, lateral);
    return { ...pos, laneMix: 1 };
  }

  /** Optional convenience for preview playback without UI. */
  static run(project, seconds = project.settings.duration) {
    const sim = new Simulation(project);
    sim.runUntil(seconds);
    if (!sim.finished) sim.finish();
    return sim.getResults();
  }
}

function samplePath(points) {
  let length = 0;
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    length += dist(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
    cum.push(length);
  }
  return { points, cum, length };
}

function pointOnSampledPath(sampled, s) {
  const { points, cum } = sampled;
  if (points.length === 1) return { x: points[0].x, y: points[0].y, heading: 0 };
  s = clamp(s, 0, sampled.length);
  let lo = 0, hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const a = points[lo], b = points[Math.min(lo + 1, points.length - 1)];
  const seg = Math.max(1e-6, cum[Math.min(lo + 1, cum.length - 1)] - cum[lo]);
  const t = clamp((s - cum[lo]) / seg, 0, 1);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    heading: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

function pathProximity(a, b, threshold) {
  const t2 = threshold * threshold;
  for (let i = 0; i < a.length; i += 2) {
    for (let j = 0; j < b.length; j += 2) {
      const dx = a[i].x - b[j].x, dy = a[i].y - b[j].y;
      if (dx * dx + dy * dy < t2) return true;
    }
  }
  return false;
}
