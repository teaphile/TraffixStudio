import { clamp } from './utils.js';

const mod = (n, m) => ((n % m) + m) % m;

/**
 * Fixed-time, coordinated and actuated signal control.
 * A controller owns a cyclic phase plan; each phase has a green interval,
 * an amber interval and an all-red clearance interval.
 */
export class SignalSystem {
  constructor(project, network) {
    this.project = project;
    this.network = network;
    this.controllers = new Map();
    this.byController = new Map();
    this.states = new Map();
    this.walk = new Map();
    this.phaseInfo = new Map();
    this.controlledLinks = new Set();
    this.headByLink = new Map();
    this.crosswalkController = new Map();

    for (const c of project.signalControllers) {
      const phases = c.phases || [];
      const links = new Set();
      for (const ph of phases) for (const id of ph.green || []) links.add(id);
      this.byController.set(c.id, c);
      this.controllers.set(c.id, {
        controller: c, phase: 0, stage: 'green', elapsed: 0, gap: 0,
        initialized: false, links,
        cycle: phases.reduce((s, ph) => s + (ph.duration || 0) + (ph.yellow || 0) + (ph.allRed || 0), 0),
      });
      for (const id of links) this.controlledLinks.add(id);
      const rt = this.controllers.get(c.id);
      for (const head of project.signalHeads.filter((h) => h.controllerId === c.id)) {
        this.controlledLinks.add(head.linkId);
        rt.links.add(head.linkId);
        if (!this.headByLink.has(head.linkId)) this.headByLink.set(head.linkId, head);
      }
      for (const cw of project.crosswalks.filter((x) => x.controllerId === c.id)) {
        this.crosswalkController.set(cw.id, c.id);
      }
    }
    for (const cw of project.crosswalks) {
      if (!cw.controllerId) this.walk.set(cw.id, true);
    }
    this.update(0, 0, null);
  }

  cycleLength(controller) {
    return (controller.phases || []).reduce((s, ph) => s + (ph.duration || 0) + (ph.yellow || 0) + (ph.allRed || 0), 0);
  }

  /** Phase windows relative to cycle start. */
  phaseWindows(controller) {
    let cursor = 0;
    return (controller.phases || []).map((ph, index) => {
      const start = cursor;
      const greenEnd = start + (ph.duration || 0);
      const yellowEnd = greenEnd + (ph.yellow || 0);
      const end = yellowEnd + (ph.allRed || 0);
      cursor = end;
      return { index, phase: ph, start, greenEnd, yellowEnd, end };
    });
  }

  update(t, dt, sim = null) {
    const states = new Map();
    const walk = new Map();
    const phaseInfo = new Map();

    for (const [id, rt] of this.controllers) {
      const c = rt.controller;
      if (!c.phases || !c.phases.length) continue;
      const cycle = this.cycleLength(c);
      if (cycle <= 0) continue;

      if (c.mode === 'actuated' && sim) {
        this._stepActuated(rt, dt, sim);
        const ph = c.phases[rt.phase];
        if (!ph) continue;
        const isGreen = rt.stage === 'green';
        const isYellow = rt.stage === 'yellow';
        for (const linkId of rt.links) {
          if ((isGreen || isYellow) && (ph.green || []).includes(linkId)) {
            states.set(linkId, isYellow ? 'yellow' : 'green');
          } else if (!states.has(linkId)) {
            states.set(linkId, 'red');
          }
        }
        if (isGreen && ph.ped) {
          for (const cw of this.project.crosswalks) if (cw.controllerId === id) walk.set(cw.id, true);
        }
        phaseInfo.set(id, {
          phaseIndex: rt.phase, stage: rt.stage, elapsed: rt.elapsed,
          duration: ph.duration || 0, yellow: ph.yellow || 0,
          remaining: this._remainingActuated(rt, ph), cycle,
        });
      } else {
        const local = mod(t + (c.offset || 0), cycle);
        const windows = this.phaseWindows(c);
        let active = windows[0];
        for (const w of windows) {
          if (local >= w.start && local < w.end) { active = w; break; }
        }
        const ph = active.phase;
        let stage = 'green';
        if (local >= active.greenEnd && local < active.yellowEnd) stage = 'yellow';
        else if (local >= active.yellowEnd) stage = 'allred';
        for (const linkId of rt.links) {
          if ((stage === 'green' || stage === 'yellow') && (ph.green || []).includes(linkId)) {
            states.set(linkId, stage === 'yellow' ? 'yellow' : 'green');
          } else if (!states.has(linkId)) {
            states.set(linkId, 'red');
          }
        }
        if (stage === 'green' && ph.ped) {
          for (const cw of this.project.crosswalks) if (cw.controllerId === id) walk.set(cw.id, true);
        }
        phaseInfo.set(id, {
          phaseIndex: active.index, stage, elapsed: local - active.start,
          duration: ph.duration || 0, yellow: ph.yellow || 0,
          remaining: active.end - local, cycle,
        });
      }
    }

    for (const cw of this.project.crosswalks) {
      if (!cw.controllerId) walk.set(cw.id, true);
    }

    this.states = states;
    this.walk = walk;
    this.phaseInfo = phaseInfo;
    this.time = t;
    return { states, walk, phaseInfo };
  }

  _stepActuated(rt, dt, sim) {
    const c = rt.controller;
    if (!rt.initialized) { rt.initialized = true; rt.elapsed = 0; rt.stage = 'green'; return; }
    const ph = c.phases[rt.phase];
    if (!ph) return;
    rt.elapsed += dt;

    if (rt.stage === 'green') {
      const currentDemand = this._hasDemand(ph.green || [], sim);
      rt.gap = currentDemand ? 0 : rt.gap + dt;
      const otherDemand = c.phases.some((other, i) => i !== rt.phase && this._hasDemand(other.green || [], sim));
      const minGreen = ph.minGreen ?? Math.min(12, ph.duration || 8);
      const maxGreen = ph.maxGreen ?? Math.max(ph.duration || 30, 45);
      if (rt.elapsed >= maxGreen || (rt.elapsed >= minGreen && rt.gap >= 3 && otherDemand)) {
        rt.stage = 'yellow'; rt.elapsed = 0; rt.gap = 0;
      }
    } else if (rt.stage === 'yellow') {
      if (rt.elapsed >= (ph.yellow || 3)) { rt.stage = 'allred'; rt.elapsed = 0; }
    } else if (rt.stage === 'allred') {
      if (rt.elapsed >= (ph.allRed || 1)) {
        rt.phase = (rt.phase + 1) % c.phases.length;
        rt.stage = 'green'; rt.elapsed = 0; rt.gap = 0;
      }
    }
  }

  _remainingActuated(rt, ph) {
    if (rt.stage === 'green') return Math.max(0, (ph.maxGreen || 45) - rt.elapsed);
    if (rt.stage === 'yellow') return Math.max(0, (ph.yellow || 3) - rt.elapsed);
    return Math.max(0, (ph.allRed || 1) - rt.elapsed);
  }

  _hasDemand(linkIds, sim) {
    if (!sim || !sim.vehicles || !linkIds.length) return false;
    for (const v of sim.vehicles) {
      if (v.transition || v.finished) continue;
      if (!linkIds.includes(v.linkId)) continue;
      const len = this.network.lengthOf(v.linkId);
      if (v.s > len - 95 && v.v < v.v0 * 0.98) return true;
    }
    return false;
  }

  stateForLink(linkId) {
    return this.states.get(linkId) || null;
  }

  isPedWalk(crosswalk) {
    if (!crosswalk) return true;
    if (!crosswalk.controllerId) return true;
    return this.walk.get(crosswalk.id) === true;
  }

  phaseInfoFor(controllerId) {
    return this.phaseInfo.get(controllerId) || null;
  }

  currentPhaseIndex(controllerId) {
    return this.phaseInfo.get(controllerId)?.phaseIndex ?? 0;
  }

  nextGreenIn(controllerId) {
    const info = this.phaseInfo.get(controllerId);
    if (!info) return null;
    return info.remaining;
  }

  /** Convenience plan view for the UI. */
  plan(controller, t = 0) {
    const windows = this.phaseWindows(controller);
    const cycle = windows.length ? windows[windows.length - 1].end : 0;
    const info = this.phaseInfoFor(controller.id);
    return { windows, cycle, info };
  }

  stateCounts(t = 0) {
    const counts = { green: 0, yellow: 0, red: 0 };
    const local = this.phaseInfo.size ? this.states : this.update(t, 0, null).states;
    for (const [, st] of local) counts[st] = (counts[st] || 0) + 1;
    return counts;
  }
}
