import { deepClone, deepMerge, uid } from './utils.js';

export const PROJECT_VERSION = 1;

export const VEHICLE_CLASSES = [
  {
    id: 'VC_CAR', name: 'Car', category: 'car', color: '#dbe7f3',
    length: 4.5, width: 1.82, height: 1.48, maxSpeed: 62, accel: 2.7, decel: 5.2,
    minGap: 2.0, headway: 1.15, reaction: 0.9, behavior: 'normal', weight: 1,
  },
  {
    id: 'VC_TRUCK', name: 'Truck', category: 'truck', color: '#f4b860',
    length: 10.6, width: 2.5, height: 3.35, maxSpeed: 48, accel: 1.25, decel: 3.7,
    minGap: 3.0, headway: 1.55, reaction: 1.25, behavior: 'cautious', weight: 1,
  },
  {
    id: 'VC_BUS', name: 'City bus', category: 'bus', color: '#4ade80',
    length: 12.0, width: 2.55, height: 3.1, maxSpeed: 44, accel: 1.15, decel: 3.4,
    minGap: 3.5, headway: 1.7, reaction: 1.3, behavior: 'cautious', weight: 1,
  },
  {
    id: 'VC_MOTO', name: 'Motorcycle', category: 'moto', color: '#f472b6',
    length: 2.15, width: 0.82, height: 1.6, maxSpeed: 66, accel: 3.6, decel: 6.2,
    minGap: 1.35, headway: 0.95, reaction: 0.8, behavior: 'aggressive', weight: 1,
  },
  {
    id: 'VC_BIKE', name: 'Bicycle', category: 'bike', color: '#a78bfa',
    length: 1.75, width: 0.68, height: 1.7, maxSpeed: 24, accel: 1.4, decel: 4.0,
    minGap: 1.0, headway: 0.9, reaction: 0.75, behavior: 'normal', weight: 1,
  },
];

export const SIGNAL_COLORS = { green: '#34d399', yellow: '#fbbf24', red: '#f87171' };

/** Accept only plain hex colours from imported projects. */
export function normalizeColor(value, fallback = '#22d3ee') {
  const color = typeof value === 'string' ? value.trim() : '';
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ? color : fallback;
}

export function createEmptyProject(name = 'Untitled Network') {
  return {
    version: PROJECT_VERSION,
    meta: {
      name,
      description: 'Open traffic simulation project',
      author: 'TRAFFIX STUDIO',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    settings: {
      duration: 900,
      warmup: 300,
      step: 0.1,
      seed: 2026,
      timeOfDay: 8.5,
      routing: 'shortest',
      pedestrianYield: true,
      rightTurnOnRed: false,
      laneChanging: true,
      measurementInterval: 30,
      batchRuns: 3,
      description: '',
    },
    classes: deepClone(VEHICLE_CLASSES),
    nodes: [],
    links: [],
    signalControllers: [],
    signalHeads: [],
    crosswalks: [],
    detectors: [],
    inputs: [],
    routes: [],
    ptLines: [],
  };
}

export function createDemoProject() {
  const p = createEmptyProject('Riverside Boulevard');
  p.meta.description = 'Two coordinated signalised junctions on a four-lane boulevard, with crossings, a bus line and mixed traffic.';
  p.settings.duration = 900;
  p.settings.warmup = 180;
  p.settings.seed = 2026;

  p.nodes = [
    { id: 'N_W', name: 'West Gate', x: -430, y: 0, type: 'boundary', control: 'priority', radius: 10 },
    { id: 'N_J1', name: 'Oak Avenue Junction', x: -140, y: 0, type: 'junction', control: 'signal', radius: 24 },
    { id: 'N_J2', name: 'Pine Street Junction', x: 140, y: 0, type: 'junction', control: 'signal', radius: 24 },
    { id: 'N_E', name: 'East Gate', x: 430, y: 0, type: 'boundary', control: 'priority', radius: 10 },
    { id: 'N_N1', name: 'North Gate 1', x: -140, y: -250, type: 'boundary', control: 'priority', radius: 9 },
    { id: 'N_S1', name: 'South Gate 1', x: -140, y: 250, type: 'boundary', control: 'priority', radius: 9 },
    { id: 'N_N2', name: 'North Gate 2', x: 140, y: -250, type: 'boundary', control: 'priority', radius: 9 },
    { id: 'N_S2', name: 'South Gate 2', x: 140, y: 250, type: 'boundary', control: 'priority', radius: 9 },
  ];

  const mk = (id, name, from, to, points, lanes, speed, priority = 1, type = 'street') => ({
    id, name, from, to, points, lanes, laneWidth: 3.4, speed, priority,
    type, grade: 0, sidewalk: true, attraction: 1, display: true,
  });

  p.links = [
    mk('L1', 'West Boulevard EB', 'N_W', 'N_J1', [{ x: -430, y: 4 }, { x: -160, y: 4 }], 2, 55, 3, 'arterial'),
    mk('L2', 'Central Boulevard EB', 'N_J1', 'N_J2', [{ x: -120, y: 4 }, { x: 120, y: 4 }], 2, 52, 3, 'arterial'),
    mk('L3', 'East Boulevard EB', 'N_J2', 'N_E', [{ x: 160, y: 4 }, { x: 430, y: 4 }], 2, 55, 3, 'arterial'),
    mk('L8', 'West Boulevard WB', 'N_J1', 'N_W', [{ x: -120, y: -4 }, { x: -430, y: -4 }], 2, 55, 3, 'arterial'),
    mk('L9', 'Central Boulevard WB', 'N_J2', 'N_J1', [{ x: 120, y: -4 }, { x: -120, y: -4 }], 2, 52, 3, 'arterial'),
    mk('L10', 'East Boulevard WB', 'N_E', 'N_J2', [{ x: 430, y: -4 }, { x: 160, y: -4 }], 2, 55, 3, 'arterial'),
    mk('L4', 'Oak Avenue SB', 'N_N1', 'N_J1', [{ x: -144, y: -250 }, { x: -144, y: -20 }], 1, 42, 1, 'street'),
    mk('L5', 'Oak Avenue SB Out', 'N_J1', 'N_S1', [{ x: -144, y: 20 }, { x: -144, y: 250 }], 1, 42, 1, 'street'),
    mk('L11', 'Oak Avenue NB Out', 'N_J1', 'N_N1', [{ x: -136, y: -20 }, { x: -136, y: -250 }], 1, 42, 1, 'street'),
    mk('L12', 'Oak Avenue NB', 'N_S1', 'N_J1', [{ x: -136, y: 250 }, { x: -136, y: 20 }], 1, 42, 1, 'street'),
    mk('L6', 'Pine Street SB', 'N_N2', 'N_J2', [{ x: 136, y: -250 }, { x: 136, y: -20 }], 1, 42, 1, 'street'),
    mk('L7', 'Pine Street SB Out', 'N_J2', 'N_S2', [{ x: 136, y: 20 }, { x: 136, y: 250 }], 1, 42, 1, 'street'),
    mk('L13', 'Pine Street NB Out', 'N_J2', 'N_N2', [{ x: 144, y: -20 }, { x: 144, y: -250 }], 1, 42, 1, 'street'),
    mk('L14', 'Pine Street NB', 'N_S2', 'N_J2', [{ x: 144, y: 250 }, { x: 144, y: 20 }], 1, 42, 1, 'street'),
  ];
  p.links.find((l) => l.id === 'L5').name = 'Oak Avenue SB Out';
  p.links.find((l) => l.id === 'L1').attraction = 1.2;
  p.links.find((l) => l.id === 'L3').attraction = 1.4;
  p.links.find((l) => l.id === 'L10').attraction = 1.2;

  p.signalControllers = [
    {
      id: 'SC1', name: 'J1 · Oak Avenue', offset: 0, mode: 'fixed', coordinated: false,
      phases: [
        { id: 'P1', name: 'Boulevard green', duration: 34, yellow: 3, allRed: 1, green: ['L1', 'L9'], ped: false, minGreen: 10, maxGreen: 48 },
        { id: 'P2', name: 'Oak green', duration: 20, yellow: 3, allRed: 1, green: ['L4', 'L12'], ped: true, minGreen: 8, maxGreen: 36 },
      ],
    },
    {
      id: 'SC2', name: 'J2 · Pine Street', offset: 44, mode: 'fixed', coordinated: true,
      phases: [
        { id: 'P3', name: 'Boulevard green', duration: 34, yellow: 3, allRed: 1, green: ['L2', 'L10'], ped: false, minGreen: 10, maxGreen: 48 },
        { id: 'P4', name: 'Pine green', duration: 20, yellow: 3, allRed: 1, green: ['L6', 'L14'], ped: true, minGreen: 8, maxGreen: 36 },
      ],
    },
  ];

  p.signalHeads = [
    { id: 'SH1', name: 'J1 · WB', controllerId: 'SC1', linkId: 'L9', pos: 0.955, movement: 'all' },
    { id: 'SH2', name: 'J1 · EB', controllerId: 'SC1', linkId: 'L1', pos: 0.955, movement: 'all' },
    { id: 'SH3', name: 'J1 · SB', controllerId: 'SC1', linkId: 'L4', pos: 0.955, movement: 'all' },
    { id: 'SH4', name: 'J1 · NB', controllerId: 'SC1', linkId: 'L12', pos: 0.955, movement: 'all' },
    { id: 'SH5', name: 'J2 · WB', controllerId: 'SC2', linkId: 'L10', pos: 0.955, movement: 'all' },
    { id: 'SH6', name: 'J2 · EB', controllerId: 'SC2', linkId: 'L2', pos: 0.955, movement: 'all' },
    { id: 'SH7', name: 'J2 · SB', controllerId: 'SC2', linkId: 'L6', pos: 0.955, movement: 'all' },
    { id: 'SH8', name: 'J2 · NB', controllerId: 'SC2', linkId: 'L14', pos: 0.955, movement: 'all' },
  ];

  p.crosswalks = [
    { id: 'CW1', name: 'Oak Boulevard crossing', linkId: 'L1', pos: 0.978, width: 4.2, pedFlow: 130, speed: 1.25, controllerId: 'SC1' },
    { id: 'CW2', name: 'Pine Boulevard crossing', linkId: 'L2', pos: 0.975, width: 4.2, pedFlow: 110, speed: 1.25, controllerId: 'SC2' },
  ];

  p.detectors = [
    { id: 'D1', name: 'Loop · West EB', type: 'loop', linkId: 'L1', lane: 0, pos: 0.7, length: 2 },
    { id: 'D2', name: 'Loop · East WB', type: 'loop', linkId: 'L10', lane: 0, pos: 0.7, length: 2 },
    { id: 'D3', name: 'Loop · Central EB', type: 'loop', linkId: 'L2', lane: 0, pos: 0.5, length: 2 },
    { id: 'D4', name: 'Loop · Central WB', type: 'loop', linkId: 'L9', lane: 0, pos: 0.5, length: 2 },
  ];

  p.inputs = [
    { id: 'VI1', name: 'West gate EB', linkId: 'L1', volume: 560, from: 0, to: 900, routeId: null, composition: { VC_CAR: 84, VC_TRUCK: 9, VC_BUS: 2, VC_MOTO: 5 } },
    { id: 'VI2', name: 'East gate WB', linkId: 'L10', volume: 520, from: 0, to: 900, routeId: null, composition: { VC_CAR: 82, VC_TRUCK: 12, VC_BUS: 2, VC_MOTO: 4 } },
    { id: 'VI3', name: 'Oak north gate', linkId: 'L4', volume: 170, from: 0, to: 900, routeId: null, composition: { VC_CAR: 88, VC_TRUCK: 7, VC_BUS: 0, VC_MOTO: 5 } },
    { id: 'VI4', name: 'Oak south gate', linkId: 'L12', volume: 150, from: 0, to: 900, routeId: null, composition: { VC_CAR: 90, VC_TRUCK: 6, VC_BUS: 0, VC_MOTO: 4 } },
    { id: 'VI5', name: 'Pine north gate', linkId: 'L6', volume: 160, from: 0, to: 900, routeId: null, composition: { VC_CAR: 88, VC_TRUCK: 8, VC_BUS: 0, VC_MOTO: 4 } },
    { id: 'VI6', name: 'Pine south gate', linkId: 'L14', volume: 150, from: 0, to: 900, routeId: null, composition: { VC_CAR: 91, VC_TRUCK: 5, VC_BUS: 0, VC_MOTO: 4 } },
  ];

  p.routes = [
    { id: 'R1', name: 'West → East express', color: '#22d3ee', links: ['L1', 'L2', 'L3'] },
    { id: 'R2', name: 'East → West express', color: '#f59e0b', links: ['L10', 'L9', 'L8'] },
    { id: 'R3', name: 'Oak cross route', color: '#a78bfa', links: ['L4', 'L5'] },
  ];

  p.ptLines = [
    {
      id: 'PT1', name: 'Line 12 · Riverside', color: '#34d399', classId: 'VC_BUS',
      headway: 300, dwell: 14, route: ['L1', 'L2', 'L3'],
      stops: [
        { linkId: 'L1', pos: 0.55, name: 'West Gate' },
        { linkId: 'L2', pos: 0.55, name: 'Riverside Central' },
        { linkId: 'L3', pos: 0.55, name: 'East Gate' },
      ],
    },
  ];

  p.settings.description = p.meta.description;
  return p;
}

export function incomingLinks(project, nodeId) {
  return project.links.filter((l) => l.to === nodeId);
}
export function outgoingLinks(project, nodeId) {
  return project.links.filter((l) => l.from === nodeId);
}

export function nextEntityId(project, collection, prefix, start = 1) {
  let n = start;
  const ids = new Set((project[collection] || []).map((x) => x.id));
  while (ids.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function nextPhaseId(controller) {
  let n = 1;
  const ids = new Set(controller.phases.map((p) => p.id));
  while (ids.has(`P${n}`)) n++;
  return `P${n}`;
}

export function makeController(project, opts = {}) {
  const nodeId = opts.nodeId;
  const incoming = nodeId ? incomingLinks(project, nodeId).map((l) => l.id) : [];
  const id = nextEntityId(project, 'signalControllers', 'SC');
  return {
    id, name: opts.name || `Signal controller ${id.slice(2)}`,
    offset: 0, mode: 'fixed', coordinated: false,
    phases: [
      { id: 'P1', name: 'Main phase', duration: 30, yellow: 3, allRed: 1, green: incoming.slice(0, Math.max(1, Math.ceil(incoming.length / 2))), ped: false, minGreen: 8, maxGreen: 45 },
      { id: 'P2', name: 'Cross phase', duration: 20, yellow: 3, allRed: 1, green: incoming.slice(Math.max(1, Math.ceil(incoming.length / 2))), ped: true, minGreen: 8, maxGreen: 35 },
    ],
  };
}

export function makeCrosswalk(project, linkId, pos, controllerId = null) {
  const id = nextEntityId(project, 'crosswalks', 'CW');
  return { id, name: `Crossing ${id.slice(2)}`, linkId, pos, width: 4, pedFlow: 100, speed: 1.25, controllerId };
}

export function makeDetector(project, linkId, pos, lane = 0) {
  const id = nextEntityId(project, 'detectors', 'D');
  return { id, name: `Detector ${id.slice(1)}`, type: 'loop', linkId, lane, pos, length: 2 };
}

export function makeSignalHead(project, linkId, controllerId, pos = 0.955) {
  const id = nextEntityId(project, 'signalHeads', 'SH');
  return { id, name: `Signal ${id.slice(2)}`, controllerId, linkId, pos, movement: 'all' };
}

export function makeInput(project, linkId) {
  const id = nextEntityId(project, 'inputs', 'VI');
  const classes = project.classes || [];
  const car = classes.find((c) => c.category === 'car') || classes[0];
  const composition = {};
  if (car) composition[car.id] = 90;
  return { id, name: `Input ${id.slice(2)}`, linkId, volume: 500, from: 0, to: project.settings?.duration || 900, routeId: null, composition };
}

export function validateProject(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Project file is empty or invalid.');
  if (!Array.isArray(raw.links)) throw new Error('Project is missing a links array.');
  const base = createEmptyProject(raw.meta?.name || 'Imported network');
  const p = deepMerge(base, raw);
  p.version = PROJECT_VERSION;
  p.meta = { ...base.meta, ...(raw.meta || {}) };
  p.settings = { ...base.settings, ...(raw.settings || {}) };
  p.classes = Array.isArray(raw.classes) && raw.classes.some((c) => c && typeof c === 'object')
    ? raw.classes.filter((c) => c && typeof c === 'object').map((c) => {
      const baseClass = deepClone(VEHICLE_CLASSES.find((v) => v.category === c.category) || VEHICLE_CLASSES[0]);
      return { ...baseClass, ...c, color: normalizeColor(c.color, baseClass.color) };
    })
    : deepClone(VEHICLE_CLASSES);
  p.nodes = Array.isArray(raw.nodes) ? raw.nodes.filter((n) => n && typeof n === 'object' && n.id).map((n) => ({
    name: String(n.id), type: 'junction', control: 'priority', radius: 10, ...n,
    x: Number(n.x) || 0, y: Number(n.y) || 0,
  })) : [];
  p.links = raw.links.filter((l) => l && typeof l === 'object').map((l) => ({
    laneWidth: 3.4, priority: 1, type: 'street', grade: 0, sidewalk: true,
    attraction: 1, display: true, ...l,
    lanes: Math.min(8, Math.max(1, Math.round(Number(l.lanes) || 1))),
    points: (Array.isArray(l.points) ? l.points : []).filter((pt) => pt && typeof pt === 'object').map((pt) => ({ x: Number(pt.x) || 0, y: Number(pt.y) || 0 })),
  })).filter((l) => l.points.length >= 2);
  p.signalControllers = Array.isArray(raw.signalControllers) ? raw.signalControllers.filter((c) => c && typeof c === 'object').map((c) => ({
    offset: 0, mode: 'fixed', coordinated: false, phases: [], ...c,
    phases: (Array.isArray(c.phases) ? c.phases : []).filter((ph) => ph && typeof ph === 'object').map((ph) => ({
      duration: 30, yellow: 3, allRed: 1, green: [], ped: false, minGreen: 8, maxGreen: 45, ...ph,
      green: Array.isArray(ph.green) ? ph.green.filter((id) => typeof id === 'string') : [],
    })),
  })) : [];
  p.signalHeads = Array.isArray(raw.signalHeads) ? raw.signalHeads.filter((h) => h && typeof h === 'object').map((h) => ({ pos: 0.955, movement: 'all', ...h })) : [];
  p.crosswalks = Array.isArray(raw.crosswalks) ? raw.crosswalks.filter((c) => c && typeof c === 'object').map((c) => ({ width: 4, pedFlow: 100, speed: 1.25, controllerId: null, ...c })) : [];
  p.detectors = Array.isArray(raw.detectors) ? raw.detectors.filter((d) => d && typeof d === 'object').map((d) => ({ type: 'loop', lane: 0, pos: 0.5, length: 2, ...d })) : [];
  p.inputs = Array.isArray(raw.inputs) ? raw.inputs.filter((i) => i && typeof i === 'object').map((i) => ({ volume: 500, from: 0, to: p.settings.duration, routeId: null, composition: {}, ...i })) : [];
  p.routes = Array.isArray(raw.routes) ? raw.routes.filter((r) => r && typeof r === 'object').map((r) => ({ ...r, color: normalizeColor(r.color, '#22d3ee'), links: Array.isArray(r.links) ? r.links.filter((id) => typeof id === 'string') : [] })) : [];
  p.ptLines = Array.isArray(raw.ptLines) ? raw.ptLines.filter((l) => l && typeof l === 'object').map((l) => ({
    classId: 'VC_BUS', headway: 600, dwell: 12, route: [], stops: [], ...l,
    color: normalizeColor(l.color, '#34d399'),
    route: Array.isArray(l.route) ? l.route.filter((id) => typeof id === 'string') : [],
    stops: Array.isArray(l.stops) ? l.stops.filter((s) => s && typeof s === 'object') : [],
  })) : [];
  if (!p.nodes.length) {
    const seen = new Map();
    for (const link of p.links) {
      for (const [nodeKey, pointKey] of [['from', 'start'], ['to', 'end']]) {
        const nodeId = link[nodeKey];
        if (!nodeId || seen.has(nodeId)) continue;
        const pt = pointKey === 'start' ? link.points[0] : link.points[link.points.length - 1];
        seen.set(nodeId, true);
        p.nodes.push({ id: nodeId, name: nodeId, x: pt.x, y: pt.y, type: 'junction', control: 'priority', radius: 10 });
      }
    }
  }
  p.meta.modifiedAt = new Date().toISOString();
  return p;
}

export function projectCounts(project) {
  return {
    nodes: project.nodes.length,
    links: project.links.length,
    controllers: project.signalControllers.length,
    signals: project.signalHeads.length,
    crosswalks: project.crosswalks.length,
    detectors: project.detectors.length,
    inputs: project.inputs.length,
    routes: project.routes.length,
    ptLines: project.ptLines.length,
    classes: project.classes.length,
    lanes: project.links.reduce((s, l) => s + (l.lanes || 1), 0),
    roadLength: project.links.reduce((s, l) => s + polylineLengthSafe(l.points), 0),
  };
}

function polylineLengthSafe(points) {
  let sum = 0;
  for (let i = 1; i < (points?.length || 0); i++) sum += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return sum;
}

export function newRoute(project, opts = {}) {
  const id = nextEntityId(project, 'routes', 'R');
  return { id, name: opts.name || `Route ${id.slice(1)}`, color: opts.color || '#22d3ee', links: opts.links || [] };
}

export function newPtLine(project, opts = {}) {
  const id = nextEntityId(project, 'ptLines', 'PT');
  return {
    id, name: opts.name || `Line ${id.slice(2)}`, color: opts.color || '#34d399',
    classId: opts.classId || 'VC_BUS', headway: 600, dwell: 12,
    route: opts.route || [], stops: opts.stops || [],
  };
}

export function makeClass(project, opts = {}) {
  const id = nextEntityId(project, 'classes', 'VC');
  return {
    id, name: 'New class', category: 'car', color: '#94a3b8',
    length: 4.5, width: 1.8, height: 1.5, maxSpeed: 55, accel: 2.5, decel: 4.8,
    minGap: 2, headway: 1.2, reaction: 1, behavior: 'normal', weight: 1, ...opts,
  };
}

export { uid };
