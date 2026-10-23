import { clamp } from './utils.js';

/**
 * Measurement layer. Collects trip, link, class, detector and pedestrian
 * indicators plus emissions estimates. Warm-up trips are excluded from
 * trip-level statistics.
 */
export class Evaluation {
  constructor(project, network, opts = {}) {
    this.project = project;
    this.network = network;
    this.duration = Math.max(1, Number(opts.duration ?? project.settings.duration) || 900);
    this.warmup = clamp(Number(opts.warmup ?? project.settings.warmup) || 0, 0, this.duration);
    this.interval = Math.max(5, project.settings.measurementInterval || 30);
    this.now = 0;
    this.spawned = 0;
    this.completed = 0;
    this.spawnedMeasured = 0;
    this.completedMeasured = 0;
    this.active = 0;
    this.vehicleSeconds = 0;
    this.distance = 0;
    this.travelSum = 0;
    this.delaySum = 0;
    this.stopsSum = 0;
    this.stoppedTimeSum = 0;
    this.fuel = 0;
    this.co2 = 0;
    this.nox = 0;
    this.pedsCrossed = 0;
    this.pedDelaySum = 0;
    this.pedQueued = 0;
    this.pedActive = 0;
    this.maxQueue = 0;
    this.queueNow = 0;
    this.lastSampleT = 0;
    this.lastQueueT = 0;
    this.lastIntervalCompleted = 0;
    this.currentMeanSpeed = 0;
    this.currentMeasuredActive = 0;
    this.timeseries = [];
    this.linkStats = new Map();
    this.classStats = new Map();
    this.detectorStats = new Map();
    this.vehicleClassTrips = new Map();

    for (const link of project.links) {
      this.linkStats.set(link.id, {
        id: link.id, name: link.name || link.id, length: network.lengthOf(link.id),
        lanes: link.lanes || 1, speed: link.speed || 50,
        entered: 0, exited: 0, enteredMeasured: 0, exitedMeasured: 0,
        travelSum: 0, travelCount: 0, delaySum: 0, distance: 0,
        speedSum: 0, speedSamples: 0, queueSum: 0, queueSamples: 0, queueMax: 0,
        occSum: 0, occSamples: 0,
      });
    }
    for (const cls of project.classes) {
      this.classStats.set(cls.id, {
        id: cls.id, name: cls.name, color: cls.color, category: cls.category,
        spawned: 0, spawnedMeasured: 0, completed: 0, travelSum: 0, delaySum: 0, stopsSum: 0,
        distance: 0, vehicleSeconds: 0, fuel: 0, speedSum: 0, speedSamples: 0,
      });
    }
    for (const detector of project.detectors) {
      this.detectorStats.set(detector.id, {
        id: detector.id, name: detector.name || detector.id, linkId: detector.linkId,
        lane: detector.lane, type: detector.type || 'loop',
        count: 0, countMeasured: 0, occupancy: 0, samples: 0, lastCount: 0,
      });
    }
  }

  onSpawn(vehicle, t) {
    this.spawned++;
    const measured = t >= this.warmup - 1e-6;
    vehicle.measured = measured;
    const cs = this.classStats.get(vehicle.classId);
    if (cs) {
      cs.spawned++;
      if (measured) cs.spawnedMeasured++;
    }
    if (measured) this.spawnedMeasured++;
  }

  onEnterLink(vehicle, linkId, t) {
    const ls = this.linkStats.get(linkId);
    if (ls) {
      ls.entered++;
      if (t >= this.warmup - 1e-6) ls.enteredMeasured++;
    }
    vehicle.linkEnterTime = t;
  }

  onExitLink(vehicle, linkId, t) {
    const ls = this.linkStats.get(linkId);
    if (!ls) return;
    const measured = t >= this.warmup - 1e-6;
    ls.exited++;
    if (measured) ls.exitedMeasured++;
    if (!measured || (vehicle.linkEnterTime ?? t) < this.warmup - 1e-6) return;
    const travel = Math.max(0.1, t - vehicle.linkEnterTime);
    ls.travelSum += travel;
    ls.travelCount++;
    const free = this.network.lengthOf(linkId) / Math.max(3, this.network.speedMs(linkId));
    ls.delaySum += Math.max(0, travel - free);
    ls.speedSum += (this.network.lengthOf(linkId) / travel) * 3.6;
    ls.speedSamples++;
  }

  onArrive(vehicle, t) {
    this.completed++;
    const travel = Math.max(0.1, t - vehicle.spawnTime);
    const delay = Math.max(0, travel - (vehicle.freeFlowTime || 0));
    const cs = this.classStats.get(vehicle.classId);
    if (vehicle.measured) {
      this.completedMeasured++;
      this.travelSum += travel;
      this.delaySum += delay;
      this.stopsSum += vehicle.stops || 0;
      this.stoppedTimeSum += vehicle.stoppedTime || 0;
      if (cs) {
        cs.completed++;
        cs.travelSum += travel;
        cs.delaySum += delay;
        cs.stopsSum += vehicle.stops || 0;
      }
      const key = vehicle.classId;
      this.vehicleClassTrips.set(key, (this.vehicleClassTrips.get(key) || 0) + 1);
    }
    if (cs && vehicle.measured) {
      cs.speedSum += this.network.routeLength(vehicle.route) / Math.max(1, travel) * 3.6;
      cs.speedSamples++;
    }
  }

  onDetectorPass(vehicle, detector, t = this.now) {
    const ds = this.detectorStats.get(detector.id);
    if (!ds) return;
    ds.count++;
    if (t >= this.warmup - 1e-6) ds.countMeasured++;
  }

  onPedSpawn(ped, t = this.now) {
    ped.measured = t >= this.warmup - 1e-6;
    this.pedActive++;
  }

  onPedComplete(ped, t) {
    this.pedActive = Math.max(0, this.pedActive - 1);
    if (!ped.measured) return;
    this.pedsCrossed++;
    const arrived = ped.queuedAt ?? ped.spawnedAt ?? t;
    const released = ped.spawnedAt ?? t;
    this.pedDelaySum += Math.max(0, released - arrived);
  }

  setPedQueue(n) { this.pedQueued = n; }

  /** Called once per engine step. */
  tick(dt, t, vehicles, pedsActive = 0, pedsQueued = 0) {
    this.now = t;
    this.active = vehicles.length;
    this.pedActive = pedsActive;
    this.pedQueued = pedsQueued;
    const measured = t >= this.warmup;

    if (measured) {
      let currentQueue = 0;
      for (const v of vehicles) {
        if (v.transition || v.finished) continue;
        const speedKmh = v.v * 3.6;
        const rate = vehicleFuelRate(v, speedKmh);
        const dFuel = rate / 3600 * dt;
        v.fuel = (v.fuel || 0) + dFuel;
        this.fuel += dFuel;
        this.distance += v.v * dt;
        this.vehicleSeconds += dt;
        const ls = this.linkStats.get(v.linkId);
        if (ls) ls.distance += v.v * dt;
        const cs = this.classStats.get(v.classId);
        if (cs) {
          cs.fuel += dFuel;
          cs.distance += v.v * dt;
          cs.vehicleSeconds += dt;
        }
        if (v.v < 0.6) v.stoppedSlowTime = (v.stoppedSlowTime || 0) + dt;
        if (v.v < 1.4) {
          const len = this.network.lengthOf(v.linkId);
          if (v.s > len * 0.2) currentQueue++;
        }
        if (v.v < 0.6 && !v.wasStopped) { v.stops = (v.stops || 0) + 1; v.wasStopped = true; v.stoppedTime = (v.stoppedTime || 0) + dt; }
        else if (v.v < 0.6) v.stoppedTime = (v.stoppedTime || 0) + dt;
        else v.wasStopped = false;
      }
      this.queueNow = currentQueue;
      this.maxQueue = Math.max(this.maxQueue, currentQueue);

      if (t - this.lastQueueT >= 2) {
        const dtq = t - this.lastQueueT;
        this.lastQueueT = t;
        const perLink = new Map();
        for (const v of vehicles) {
          if (v.transition || v.finished) continue;
          if (!perLink.has(v.linkId)) perLink.set(v.linkId, { total: 0, q: 0 });
          const e = perLink.get(v.linkId);
          e.total++;
          if (v.v < 1.4) e.q++;
        }
        for (const [linkId, ls] of this.linkStats) {
          const e = perLink.get(linkId) || { total: 0, q: 0 };
          ls.occSum += e.total;
          ls.occSamples++;
          ls.queueSum += e.q;
          ls.queueSamples++;
          ls.queueMax = Math.max(ls.queueMax, e.q);
        }
        for (const ds of this.detectorStats.values()) {
          const d = this.project.detectors.find((x) => x.id === ds.id);
          if (!d) continue;
          const len = this.network.lengthOf(d.linkId);
          const pos = clamp(d.pos, 0, 1) * len;
          let occ = 0;
          for (const v of vehicles) {
            if (v.linkId !== d.linkId || v.transition) continue;
            if ((d.lane === null || d.lane === undefined || d.lane === v.lane) && Math.abs(v.s - pos) < (d.length || 2) / 2 + 1.5) occ++;
          }
          ds.occupancy += (occ > 0 ? 1 : 0) * dtq;
          ds.samples += dtq;
        }
      }

      let speedSum = 0, speedCount = 0, measuredCount = 0;
      for (const v of vehicles) {
        if (v.transition) continue;
        speedSum += v.v * 3.6; speedCount++;
        if (v.measured) measuredCount++;
      }
      this.currentMeanSpeed = speedCount ? speedSum / speedCount : 0;
      this.currentMeasuredActive = measuredCount;

      if (t - this.lastSampleT >= this.interval || this.lastSampleT === 0) {
        const first = this.lastSampleT === 0;
        const step = Math.max(1, t - this.lastSampleT);
        this.timeseries.push({
          t,
          active: vehicles.length,
          measuredActive: measuredCount,
          meanSpeed: this.currentMeanSpeed,
          queue: currentQueue,
          throughput: first ? 0 : Math.max(0, this.completedMeasured - this.lastIntervalCompleted) / step * 3600,
          peds: pedsActive,
          pedQueue: pedsQueued,
        });
        this.lastSampleT = t;
        this.lastIntervalCompleted = this.completedMeasured;
      }

      // Emissions accumulators
      this.co2 = this.fuel * 2.31;
      this.nox = this.fuel * 7.6;
    }

    this.lastQueueT = Math.max(this.lastQueueT, 0);
  }

  updateQueueFromVehicles(vehicles) {
    let q = 0;
    for (const v of vehicles) if (!v.transition && v.v < 1.4) q++;
    this.queueNow = q;
    this.maxQueue = Math.max(this.maxQueue, q);
  }

  finalize(now = this.now, complete = false) {
    const end = Math.min(now, this.duration);
    const window = Math.max(0, end - this.warmup);
    const speed = this.vehicleSeconds > 0 ? (this.distance / this.vehicleSeconds) * 3.6 : this._fleetSpeed();
    const links = [...this.linkStats.values()].map((ls) => {
      const avgTravel = ls.travelCount ? ls.travelSum / ls.travelCount : 0;
      const avgQueue = ls.queueSamples ? ls.queueSum / ls.queueSamples : 0;
      const avgOcc = ls.occSamples ? ls.occSum / ls.occSamples : 0;
      const density = (avgOcc / Math.max(1, (ls.length / 1000) * ls.lanes));
      return {
        id: ls.id, name: ls.name, length: ls.length, lanes: ls.lanes, speed: ls.speed,
        entered: ls.entered, exited: ls.exited,
        enteredMeasured: ls.enteredMeasured, exitedMeasured: ls.exitedMeasured,
        flow: window > 0 ? ls.exitedMeasured / window * 3600 : 0,
        avgTravel, delay: avgTravel ? Math.max(0, avgTravel - ls.length / Math.max(3, ls.speed / 3.6)) : 0,
        avgSpeed: ls.speedSamples ? ls.speedSum / ls.speedSamples : 0,
        density, maxQueue: ls.queueMax, avgQueue,
        vmt: ls.distance / 1000,
      };
    });
    const classes = [...this.classStats.values()].map((cs) => ({
      id: cs.id, name: cs.name, color: cs.color, category: cs.category,
      spawned: cs.spawned, spawnedMeasured: cs.spawnedMeasured,
      completed: cs.completed,
      share: this.spawnedMeasured ? cs.spawnedMeasured / this.spawnedMeasured : 0,
      avgTravel: cs.completed ? cs.travelSum / cs.completed : 0,
      avgDelay: cs.completed ? cs.delaySum / cs.completed : 0,
      avgStops: cs.completed ? cs.stopsSum / cs.completed : 0,
      avgSpeed: cs.vehicleSeconds > 0 ? cs.distance / cs.vehicleSeconds * 3.6 : 0,
      distance: cs.distance, fuel: cs.fuel, trips: cs.completed,
    }));
    const detectors = [...this.detectorStats.values()].map((ds) => ({
      id: ds.id, name: ds.name, linkId: ds.linkId, lane: ds.lane, type: ds.type,
      count: ds.count, countMeasured: ds.countMeasured,
      flow: window > 0 ? ds.countMeasured / window * 3600 : 0,
      occupancy: ds.samples > 0 ? ds.occupancy / ds.samples : 0,
    }));
    const summary = {
      spawned: this.spawned,
      spawnedMeasured: this.spawnedMeasured,
      completed: this.completed,
      completedMeasured: this.completedMeasured,
      active: this.active,
      throughput: window > 0 ? this.completedMeasured / window * 3600 : 0,
      avgTravel: this.completedMeasured ? this.travelSum / this.completedMeasured : 0,
      avgDelay: this.completedMeasured ? this.delaySum / this.completedMeasured : 0,
      avgStops: this.completedMeasured ? this.stopsSum / this.completedMeasured : 0,
      avgSpeed: speed,
      stoppedTime: this.completedMeasured ? this.stoppedTimeSum / this.completedMeasured : 0,
      distance: this.distance / 1000,
      fuel: this.fuel,
      co2: this.co2,
      nox: this.nox,
      pedsCrossed: this.pedsCrossed,
      pedDelay: this.pedsCrossed ? this.pedDelaySum / this.pedsCrossed : 0,
      pedQueue: this.pedQueued,
      maxQueue: this.maxQueue,
      queueNow: this.queueNow,
      vmt: links.reduce((s, l) => s + l.vmt, 0),
      networkLength: this.project.links.reduce((s, l) => s + this.network.lengthOf(l.id), 0),
      laneKm: this.project.links.reduce((s, l) => s + this.network.lengthOf(l.id) * l.lanes, 0) / 1000,
    };
    const series = this.timeseries.length ? [...this.timeseries] : [];
    const lastSample = series[series.length - 1];
    if (!lastSample || lastSample.t < now - 1) {
      // Keep the latest point representative instead of appending a zero-speed
      // artefact when evaluation is queried between sampling instants.
      const since = lastSample ? Math.max(1, now - lastSample.t) : 1;
      series.push({
        t: now,
        active: this.active,
        measuredActive: this.currentMeasuredActive,
        meanSpeed: this.currentMeanSpeed,
        queue: this.queueNow,
        throughput: lastSample
          ? Math.max(0, this.completedMeasured - this.lastIntervalCompleted) / since * 3600
          : 0,
        peds: this.pedActive,
        pedQueue: this.pedQueued,
      });
    }
    return {
      runAt: new Date().toISOString(),
      complete,
      seed: this.project.settings.seed,
      duration: this.duration,
      warmup: this.warmup,
      window: { start: this.warmup, end, length: window },
      summary, links, classes, detectors, series,
      project: { name: this.project.meta.name, linkCount: this.project.links.length, nodeCount: this.project.nodes.length },
    };
  }

  _fleetSpeed() {
    let sum = 0, n = 0;
    for (const ls of this.linkStats.values()) if (ls.speedSamples) { sum += ls.speedSum / ls.speedSamples; n++; }
    return n ? sum / n : 0;
  }
}

function vehicleFuelRate(v, speedKmh) {
  const cat = v.classCategory;
  let factor = 1;
  if (cat === 'truck') factor = 2.6;
  else if (cat === 'bus') factor = 3.1;
  else if (cat === 'moto') factor = 0.48;
  else if (cat === 'bike') factor = 0.02;
  const idle = 0.55;
  const rolling = 0.0019 * speedKmh * speedKmh;
  const aero = 0.00000013 * speedKmh ** 4;
  const accel = Math.max(0, v.acc || 0) * 2.0 * Math.min(1, speedKmh / 35);
  return (idle + rolling + aero + accel) * factor;
}
