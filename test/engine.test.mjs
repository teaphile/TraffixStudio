/**
 * TRAFFIX STUDIO — core engine tests.
 *
 * Runs without a DOM or any external test dependency:
 *   npm test
 */
import assert from 'node:assert/strict';

import {
  VEHICLE_CLASSES, createDemoProject, createEmptyProject, projectCounts, validateProject,
} from '../js/core/project.js';
import { Network } from '../js/core/network.js';
import { SignalSystem } from '../js/core/signals.js';
import { Simulation } from '../js/core/simulation.js';
import { geoJsonToProject } from '../js/ui/fileops.js';
import {
  clamp, fmtClock, mulberry32, polylineLength, toCsv,
} from '../js/core/utils.js';

const results = [];
let current = '';

async function test(name, fn) {
  current = name;
  const started = performance.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: performance.now() - started });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error, ms: performance.now() - started });
    console.error(`  ✗ ${name}`);
    console.error(`    ${error?.stack || error}`);
  }
}

const near = (actual, expected, tolerance = 1e-6, label = '') => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label || 'value'} expected ${expected} ± ${tolerance}, received ${actual}`,
  );
};

function assertFiniteNumbers(value, path = 'value') {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${path} must be finite, received ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertFiniteNumbers(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'runAt') continue;
      assertFiniteNumbers(entry, `${path}.${key}`);
    }
  }
}

// -------------------------------------------------------------------- tests
console.log('\nTRAFFIX STUDIO · engine test suite\n');

await test('utility helpers are deterministic and format correctly', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 20; i++) assert.equal(a(), b(), `PRNG diverged at draw ${i}`);
  assert.equal(clamp(12, 0, 10), 10);
  assert.equal(clamp(-2, 0, 10), 0);
  assert.equal(fmtClock(95), '1:35');
  assert.equal(fmtClock(3725), '1:02:05');
  near(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }]), 5);
  assert.equal(toCsv([['a,b', 'say "hi"'], ['plain', 2]]), '"a,b","say ""hi"""\nplain,2');
  assert.equal(toCsv([['=SUM(1,2)', '-42', 7]]), `"'=SUM(1,2)",'-42,7`);
});

await test('demo project matches the documented Riverside Boulevard setup', () => {
  const project = createDemoProject();
  const counts = projectCounts(project);
  assert.equal(project.meta.name, 'Riverside Boulevard');
  assert.equal(counts.nodes, 8);
  assert.equal(counts.links, 14);
  assert.equal(counts.controllers, 2);
  assert.equal(counts.signals, 8);
  assert.equal(counts.crosswalks, 2);
  assert.equal(counts.detectors, 4);
  assert.equal(counts.inputs, 6);
  assert.equal(counts.routes, 3);
  assert.equal(counts.ptLines, 1);
  assert.equal(counts.classes, VEHICLE_CLASSES.length);
  assert.equal(counts.lanes, 20);
  near(counts.roadLength, 3440, 1, 'road length');
  assert.equal(project.settings.warmup, 180);
  assert.equal(project.settings.duration, 900);
  assert.equal(project.settings.seed, 2026);
  assert.equal(project.signalControllers[0].phases.length, 2);
  assert.equal(project.ptLines[0].stops.length, 3);
});

await test('validateProject applies defaults, drops bad geometry and rebuilds nodes', () => {
  const raw = {
    version: 99,
    meta: { name: 'Import smoke test' },
    settings: { seed: 7 },
    links: [
      {
        id: 'L1', from: 'A', to: 'B', lanes: 2,
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      },
      {
        id: 'L2', from: 'B', to: 'C', lanes: 'x',
        points: [{ x: 100, y: 0 }],
      },
      {
        id: 'L3', from: 'B', to: 'C', lanes: 1,
        points: [{ x: 100, y: 0 }, { x: 100, y: 80 }, { x: 180, y: 80 }],
      },
    ],
    inputs: [{ id: 'VI1', name: 'Partial input', linkId: 'L1', volume: 250 }],
  };
  const project = validateProject(raw);
  assert.equal(project.meta.name, 'Import smoke test');
  assert.equal(project.version, 1);
  assert.equal(project.settings.seed, 7);
  assert.equal(project.settings.duration, 900, 'missing settings default to 900 s');
  assert.equal(project.links.length, 2, 'the one-point link must be dropped');
  assert.equal(project.links[0].laneWidth, 3.4);
  assert.equal(project.links[0].priority, 1);
  assert.equal(project.nodes.length, 3, 'A, B and C must be reconstructed');
  const a = project.nodes.find((n) => n.id === 'A');
  const c = project.nodes.find((n) => n.id === 'C');
  assert.deepEqual({ x: a.x, y: a.y }, { x: 0, y: 0 });
  assert.deepEqual({ x: c.x, y: c.y }, { x: 180, y: 80 });
  assert.equal(project.inputs[0].to, 900);
  assert.equal(project.inputs[0].composition && typeof project.inputs[0].composition, 'object');
  assert.equal(project.classes.length, VEHICLE_CLASSES.length);
  assert.throws(() => validateProject(null), /empty or invalid/i);
  assert.throws(() => validateProject({ settings: {} }), /links array/i);

  const hardened = validateProject({
    links: [null, { id: 'L1', from: 'A', to: 'B', points: [null, { x: 0, y: 0 }, { x: 20, y: 0 }] }],
    nodes: [null],
    classes: [null],
    signalControllers: [null, { id: 'SC1', phases: [null, { id: 'P1', duration: 12, green: 'L1' }] }],
    detectors: [null],
    routes: [null],
    ptLines: [null],
  });
  assert.equal(hardened.links.length, 1, 'malformed links must be ignored');
  assert.equal(hardened.nodes.length, 2, 'nodes rebuild from the remaining link');
  assert.equal(hardened.classes.length, VEHICLE_CLASSES.length, 'invalid classes fall back to defaults');
  assert.equal(hardened.signalControllers.length, 1);
  assert.equal(hardened.signalControllers[0].phases.length, 1);
  assert.deepEqual(hardened.signalControllers[0].phases[0].green, [], 'non-array green links are discarded');
  assert.equal(hardened.detectors.length, 0);

  const colors = validateProject({
    links: [{ id: 'L1', from: 'A', to: 'B', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] }],
    classes: [{ id: 'VC_CAR', name: 'Car', category: 'car', color: 'red; background:url(https://example.test)' }],
    routes: [{ id: 'R1', name: 'Route', color: 'url(https://example.test)', links: [] }],
    ptLines: [{ id: 'PT1', name: 'Line', color: 'not-a-colour', route: [], stops: [] }],
  });
  assert.equal(colors.classes[0].color, '#dbe7f3', 'class colour must fall back to its category palette');
  assert.equal(colors.routes[0].color, '#22d3ee', 'route colour must fall back to the default');
  assert.equal(colors.ptLines[0].color, '#34d399', 'transit colour must fall back to the default');
});

await test('network geometry, turns and shortest-path routing are consistent', () => {
  const project = createDemoProject();
  const net = new Network(project);
  assert.equal(net.links.size, 14);
  near(net.lengthOf('L1'), 270, 1, 'L1 length');
  near(net.lengthOf('L2'), 240, 1, 'L2 length');
  near(net.lengthOf('L3'), 270, 1, 'L3 length');
  near(net.lengthOf('L8'), 310, 1, 'L8 length');
  near(net.lengthOf('L10'), 270, 1, 'L10 length');
  near(net.lengthOf('L4'), 230, 1, 'L4 length');
  near(net.routeLength(['L1', 'L2', 'L3']), 780, 1, 'express route length');
  assert.equal(net.width('L1'), 6.8);
  assert.equal(net.outgoingOf('N_J1').length, 4);
  assert.equal(net.incomingOf('N_J1').length, 4);
  assert.equal(net.sources().length, 6);
  assert.equal(net.sinks().length, 6);
  assert.equal(net.turnType('L1', 'L2'), 'through');
  assert.equal(net.turnType('L1', 'L5'), 'right');
  assert.equal(net.preferredLane('L1', 'L2'), null);
  assert.equal(net.preferredLane('L1', 'L5'), 0);
  assert.equal(net.entryLane('L1', 'L2', 'L3', 1), 1);
  const path = net.shortestPath('L1', 'L3');
  assert.deepEqual(path, ['L1', 'L2', 'L3']);
  assert.equal(net.shortestPath('L1', 'L1')[0], 'L1');
  assert.ok(net.routeFreeFlowTime(path) > 30, 'free-flow time should be positive');
  assert.ok(net.connectedComponents().length === 1, 'demo network should be connected');
  const r1 = mulberry32(99);
  const r2 = mulberry32(99);
  assert.deepEqual(net.chooseRoute('L1', r1), net.chooseRoute('L1', r2));
  const chosen = net.chooseRoute('L1', mulberry32(99));
  assert.equal(chosen[0], 'L1');
  const endLink = net.link(chosen[chosen.length - 1]);
  assert.ok(net.sinks().some((l) => l.id === endLink.id), 'chosen route must end at a sink');
  for (const mode of ['shortest', 'distance', 'random']) {
    project.settings.routing = mode;
    const routed = new Network(project);
    const route = routed.chooseRoute('L1', mulberry32(17));
    assert.equal(route[0], 'L1', `${mode} route must start on the source link`);
    assert.ok(routed.sinks().some((l) => l.id === route[route.length - 1]), `${mode} route must end at a sink`);
    assert.ok(route.every((id) => routed.link(id)), `${mode} route must reference valid links`);
  }
  project.settings.routing = 'shortest';
  assert.equal(net.validate().filter((i) => i.level === 'error').length, 0);
});

await test('validation catches duplicate IDs and dangling references', () => {
  const project = createDemoProject();
  project.detectors.push({ ...project.detectors[0], id: project.detectors[0].id });
  project.detectors.push({ id: 'D9', name: 'Orphan loop', linkId: 'L404', lane: 9, pos: 2 });
  project.detectors.push({ id: 'D10', name: 'Wrong lane loop', linkId: 'L1', lane: 9, pos: 0.5 });
  project.crosswalks.push({ id: 'CW9', name: 'Orphan crossing', linkId: 'L404', pos: 0.5 });
  project.signalHeads.push({ id: 'SH9', name: 'Orphan signal', controllerId: 'SC404', linkId: 'L1', pos: 0.9 });
  project.inputs[0].routeId = 'R404';
  project.inputs[0].composition.VC404 = 10;
  project.routes.push({ id: 'R9', name: 'Broken route', links: ['L1', 'L404'] });
  project.ptLines[0].stops.push({ linkId: 'L404', pos: 0.5, name: 'Orphan stop' });
  project.settings.warmup = project.settings.duration;
  const net = new Network(project);
  const issues = net.validate();
  const text = issues.map((i) => `${i.level}:${i.text}`).join('\n');
  assert.match(text, /Detector D1 is defined more than once/i);
  assert.match(text, /Detector Orphan loop references missing link L404/i);
  assert.match(text, /lane 10/i);
  assert.match(text, /Crossing Orphan crossing references missing link L404/i);
  assert.match(text, /Signal Orphan signal references missing controller SC404/i);
  assert.match(text, /Input West gate EB references missing route R404/i);
  assert.match(text, /missing vehicle class VC404/i);
  assert.match(text, /Route Broken route references missing link L404/i);
  assert.match(text, /Transit stop Orphan stop references missing link L404/i);
  assert.match(text, /measurement window is empty/i);
  assert.ok(issues.some((i) => i.level === 'error' && /missing controller/i.test(i.text)));
});

await test('fixed-time and coordinated signal plans follow their phase windows', () => {
  const project = createDemoProject();
  const net = new Network(project);
  const signals = new SignalSystem(project, net);
  const sc1 = project.signalControllers.find((c) => c.id === 'SC1');
  assert.equal(signals.cycleLength(sc1), 62);
  assert.deepEqual(
    signals.phaseWindows(sc1).map((w) => [w.start, w.greenEnd, w.yellowEnd, w.end]),
    [[0, 34, 37, 38], [38, 58, 61, 62]],
  );

  signals.update(0, 0);
  assert.equal(signals.stateForLink('L1'), 'green');
  assert.equal(signals.stateForLink('L9'), 'green');
  assert.equal(signals.stateForLink('L4'), 'red');
  assert.equal(signals.phaseInfoFor('SC1').phaseIndex, 0);
  assert.equal(signals.isPedWalk(project.crosswalks[0]), false);

  signals.update(34, 0);
  assert.equal(signals.stateForLink('L1'), 'yellow');
  signals.update(37, 0);
  assert.equal(signals.stateForLink('L1'), 'red');
  assert.equal(signals.phaseInfoFor('SC1').stage, 'allred');
  signals.update(38, 0);
  assert.equal(signals.stateForLink('L4'), 'green');
  assert.equal(signals.isPedWalk(project.crosswalks[0]), true);
  signals.update(58, 0);
  assert.equal(signals.stateForLink('L4'), 'yellow');
  signals.update(61, 0);
  assert.equal(signals.stateForLink('L4'), 'red');

  // SC2 runs with a 44 s offset, so at t = 0 its cross phase is already green.
  signals.update(0, 0);
  assert.equal(signals.phaseInfoFor('SC2').phaseIndex, 1);
  assert.equal(signals.stateForLink('L6'), 'green');
  assert.equal(signals.stateForLink('L2'), 'red');
  assert.equal(signals.isPedWalk(project.crosswalks[1]), true);
  signals.update(18, 0);
  assert.equal(signals.stateForLink('L2'), 'green');
  assert.equal(signals.isPedWalk(project.crosswalks[1]), false);

  // Actuated control must leave green after maxGreen and eventually switch phase.
  project.signalControllers[0].mode = 'actuated';
  const actuated = new SignalSystem(project, net);
  const fakeSim = { vehicles: [] };
  for (let t = 0; t <= 80; t += 1) actuated.update(t, 1, fakeSim);
  const info = actuated.phaseInfoFor('SC1');
  assert.ok(info.phaseIndex >= 0 && info.phaseIndex < 2);
  assert.ok(Number.isFinite(info.remaining));
});

await test('short demo simulation is deterministic for a fixed seed', () => {
  const run = (seed) => {
    const project = createDemoProject();
    project.settings.seed = seed;
    project.settings.duration = 180;
    project.settings.warmup = 60;
    const sim = new Simulation(project);
    sim.runUntil(180);
    const r = sim.getResults();
    return { summary: r.summary, series: r.series, classes: r.classes, detectors: r.detectors };
  };
  const a = run(2026);
  const b = run(2026);
  const c = run(777);
  assert.deepEqual(a, b, 'same seed must reproduce identical results');
  assert.notDeepEqual(a.summary, c.summary, 'different seeds should change the microsimulation');
});

await test('pedestrian yield option remains stable in both modes', () => {
  const build = (yieldEnabled) => {
    const project = createDemoProject();
    project.settings.duration = 400;
    project.settings.warmup = 0;
    project.settings.seed = 2026;
    project.settings.pedestrianYield = yieldEnabled;
    project.crosswalks = [{
      id: 'CW1', name: 'Uncontrolled test crossing', linkId: 'L1',
      pos: 0.7, width: 4, pedFlow: 80, speed: 1.25, controllerId: null,
    }];
    return project;
  };

  const yielding = new Simulation(build(true));
  yielding.runUntil(400);
  const a = yielding.getResults().summary;
  assert.ok(a.pedsCrossed > 0, 'pedestrians must cross when vehicles yield');
  assert.ok(a.completed > 40, 'vehicles must keep completing trips');
  assert.ok(a.avgDelay >= 0 && Number.isFinite(a.avgDelay));

  const selfYield = new Simulation(build(false));
  selfYield.runUntil(400);
  const b = selfYield.getResults().summary;
  assert.ok(b.pedsCrossed > 0, 'waiting pedestrians must find a gap when they yield');
  assert.ok(b.completed > 40, 'vehicles must not stop unnecessarily when pedestrians yield');
  assert.ok(b.avgDelay >= 0 && Number.isFinite(b.avgDelay));
});

await test('full 900 s demo run produces finite, plausible KPIs and clean samples', () => {
  const project = createDemoProject();
  const sim = new Simulation(project);
  sim.runUntil(900);
  const r = sim.getResults();

  assert.equal(r.complete, true);
  assert.equal(sim.t, 900);
  assert.equal(r.window.start, 180);
  assert.equal(r.window.end, 900);
  assert.equal(r.window.length, 720);
  assert.equal(r.series.length, 25);
  near(r.series[0].t, 180, 0.2, 'first sample time');
  near(r.series[r.series.length - 1].t, 900, 0.2, 'final sample time');

  const s = r.summary;
  assert.ok(s.spawned >= 400 && s.spawned <= 550, `spawned out of range: ${s.spawned}`);
  assert.ok(s.completed >= 340 && s.completed <= 500, `completed out of range: ${s.completed}`);
  assert.ok(s.active >= 20 && s.active <= 90, `active out of range: ${s.active}`);
  assert.ok(s.throughput >= 1200 && s.throughput <= 2000, `throughput out of range: ${s.throughput}`);
  assert.ok(s.avgSpeed >= 12 && s.avgSpeed <= 45, `speed out of range: ${s.avgSpeed}`);
  near(s.avgSpeed, 25.0, 0.3, 'measured space-mean speed');
  assert.ok(s.avgDelay >= 10 && s.avgDelay <= 120, `delay out of range: ${s.avgDelay}`);
  assert.ok(s.maxQueue >= 10 && s.maxQueue <= 80, `queue out of range: ${s.maxQueue}`);
  assert.ok(s.pedsCrossed >= 30 && s.pedsCrossed <= 100, `pedestrians out of range: ${s.pedsCrossed}`);
  assert.ok(s.pedDelay >= 0 && s.pedDelay <= 120, `pedestrian kerb wait out of range: ${s.pedDelay}`);
  assert.ok(s.laneKm > 0 && s.laneKm < 10, `lane-km out of range: ${s.laneKm}`);
  assert.ok(s.co2 > 0 && s.nox > 0, 'emissions should be positive');
  near(s.laneKm, 5.04, 0.01, 'demo lane-km');
  near(s.vmt, s.distance, 0.001, 'VMT must equal integrated measured distance');
  assert.ok(s.completed <= s.spawned);
  assert.equal(s.active, 54);
  assert.equal(s.maxQueue, 38);
  assert.equal(s.pedsCrossed, 47);
  near(s.throughput, 1610, 5, 'measured throughput');
  near(s.pedDelay, 13.17, 0.05, 'measured pedestrian kerb wait');

  for (const link of r.links) {
    assert.ok(link.flow >= 0 && link.flow <= 2400, `${link.id} flow out of range`);
    assert.ok(link.enteredMeasured <= link.entered, `${link.id} measured entries exceed total`);
    assert.ok(link.exitedMeasured <= link.exited, `${link.id} measured exits exceed total`);
    near(link.flow, link.exitedMeasured / 720 * 3600, 1e-6, `${link.id} measured flow`);
  }
  for (const entry of r.classes) {
    assert.ok(entry.spawned >= entry.completed, `${entry.id} completed exceed spawned`);
    assert.ok(entry.spawnedMeasured <= entry.spawned, `${entry.id} measured spawns exceed total`);
  }
  near(r.classes.reduce((sum, entry) => sum + entry.share, 0), 1, 1e-9, 'class shares');
  assert.equal(r.classes.reduce((sum, entry) => sum + entry.spawnedMeasured, 0), s.spawnedMeasured);
  for (const detector of r.detectors) {
    assert.ok(detector.countMeasured <= detector.count, `${detector.id} measured count exceeds total`);
    assert.ok(detector.count >= 0);
    near(detector.flow, detector.countMeasured / 720 * 3600, 1e-6, `${detector.id} measured flow`);
  }
  const last = r.series[r.series.length - 1];
  assert.equal(last.active, s.active);
  assert.ok(last.meanSpeed > 0, 'last time-series speed must not be a zero artefact');
  assert.ok(last.throughput > 0, 'last sample throughput should be measured');
  assertFiniteNumbers(r, 'results');
});

await test('live evaluation between sampling instants stays representative', () => {
  const project = createDemoProject();
  project.settings.duration = 450;
  const sim = new Simulation(project);
  sim.runUntil(447);
  assert.equal(sim.finished, false);
  const r = sim.getResults();
  assert.equal(r.complete, false);
  const last = r.series[r.series.length - 1];
  near(last.t, 447, 0.2, 'final partial sample');
  assert.equal(last.active, sim.vehicles.length);
  assert.ok(last.meanSpeed > 0);
  assert.ok(Number.isFinite(last.throughput));
  assert.ok(Number.isFinite(r.summary.avgDelay));
  assertFiniteNumbers(r, 'partial results');
});

await test('GeoJSON import converts linework, properties and shared junctions', () => {
  const geo = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'Market Street', lanes: 3, speed: 60, highway: 'primary' },
        geometry: {
          type: 'LineString',
          coordinates: [[-122.4000, 37.7000], [-122.3995, 37.7000], [-122.3990, 37.7000]],
        },
      },
      {
        type: 'Feature',
        properties: { name: 'Side Street' },
        geometry: {
          type: 'LineString',
          coordinates: [[-122.3990, 37.7000], [-122.3990, 37.7010]],
        },
      },
    ],
  };
  const project = geoJsonToProject(null, geo, 'GeoJSON smoke test');
  assert.equal(project.meta.name, 'GeoJSON smoke test');
  assert.equal(project.links.length, 2);
  assert.equal(project.nodes.length, 3, 'the shared midpoint must become one junction');
  assert.equal(project.links[0].name, 'Market Street');
  assert.equal(project.links[0].lanes, 3);
  assert.equal(project.links[0].speed, 60);
  assert.equal(project.links[0].type, 'arterial');
  assert.equal(project.links[1].lanes, 2, 'defaults apply to missing properties');
  assert.equal(project.links[0].points.length, 3, 'intermediate geometry must be preserved');
  const shared = project.nodes.find((n) => n.id === project.links[0].to);
  assert.equal(shared.id, project.links[1].from);
  for (const link of project.links) {
    assert.equal(link.from === link.to, false);
    assert.ok(link.points.length >= 2);
    for (const point of link.points) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  }
  assert.throws(() => geoJsonToProject(null, { type: 'FeatureCollection', features: [] }), /no features/i);
  assert.throws(
    () => geoJsonToProject(null, { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } }] }),
    /no LineString or Point/i,
  );
  assert.throws(
    () => geoJsonToProject(null, { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [] } }),
    /coordinates are invalid/i,
  );
});

await test('empty project is valid but produces actionable warnings', () => {
  const project = createEmptyProject('Blank canvas');
  const net = new Network(project);
  const issues = net.validate();
  assert.ok(issues.some((i) => i.level === 'error' && /no links/i.test(i.text)));
  assert.ok(issues.some((i) => i.level === 'warn' && /vehicle inputs/i.test(i.text)));
  assert.equal(project.nodes.length, 0);
  assert.equal(project.links.length, 0);
});

// ------------------------------------------------------------------- report
const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
const elapsed = results.reduce((sum, r) => sum + r.ms, 0);
console.log(`\n${passed}/${results.length} tests passed · ${(elapsed / 1000).toFixed(2)} s\n`);
if (failed) process.exitCode = 1;
