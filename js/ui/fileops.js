import {
  createEmptyProject, nextEntityId, validateProject,
} from '../core/project.js';
import {
  downloadText, fmtClock, fmtFixed, toCsv,
} from '../core/utils.js';

export function pickProjectFile(app, mode = 'project') {
  const input = document.getElementById('file-input');
  if (!input) return;
  input.value = '';
  input.dataset.mode = mode;
  input.accept = mode === 'geojson' ? '.geojson,.json,application/json' : '.json,.geojson,application/json';
  input.click();
}

export async function handlePickedFile(app, file) {
  if (!file) return;
  const mode = document.getElementById('file-input')?.dataset.mode || 'project';
  let text;
  try {
    text = await file.text();
  } catch (err) {
    app.toast('Import failed', `Could not read ${file.name}.`, 'error');
    return;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    app.toast('Import failed', 'The selected file is empty.', 'error');
    return;
  }
  let data;
  try {
    data = JSON.parse(trimmed);
  } catch (err) {
    app.toast('Import failed', `${file.name} is not valid JSON.`, 'error');
    return;
  }
  const isGeo = mode === 'geojson' || /FeatureCollection|Feature/.test(data?.type || '');
  if (isGeo) {
    try {
      const project = geoJsonToProject(app, data, file.name.replace(/\.[^.]+$/, ''));
      app.adoptProject(project, { message: `Imported ${project.links.length} links and ${project.nodes.length} junctions from ${file.name}.`, fit: true, clearRuns: true });
    } catch (err) {
      app.toast('GeoJSON import failed', err.message || String(err), 'error');
    }
    return;
  }
  try {
    const project = validateProject(data);
    app.adoptProject(project, { message: `Opened “${project.meta.name}”.`, fit: true, clearRuns: true });
  } catch (err) {
    app.toast('Project import failed', err.message || String(err), 'error');
  }
}

export function exportProjectFile(app) {
  const slug = slugify(app.project.meta.name || 'traffix-studio-project');
  downloadText(`${slug}.json`, JSON.stringify(app.project, null, 2), 'application/json');
  app.toast('Project exported', `${slug}.json downloaded.`, 'success');
}

export function exportResultsCsv(app) {
  const results = app.currentResults();
  if (!results) {
    app.toast('Nothing to export', 'Run the simulation or open a recorded run first.', 'warn');
    return;
  }
  const s = results.summary;
  const rows = [];
  const blank = () => rows.push([]);
  rows.push(['TRAFFIX STUDIO — evaluation export']);
  rows.push(['Project', app.project.meta.name]);
  rows.push(['Generated', new Date().toISOString()]);
  rows.push(['Run', app.analysisRunId === 'live' ? 'Live / current' : (app.runs.find((r) => r.id === app.analysisRunId)?.name || app.analysisRunId)]);
  rows.push(['Seed', results.seed]);
  rows.push(['Measurement window', `${fmtClock(results.window.start)} – ${fmtClock(results.window.end)} (${fmtClock(results.window.length)})`]);
  blank();
  rows.push(['SUMMARY']);
  rows.push(['Metric', 'Value', 'Unit']);
  const summary = [
    ['Spawned', s.spawned, 'vehicles'], ['Spawned in window', s.spawnedMeasured, 'vehicles'],
    ['Completed', s.completed, 'vehicles'], ['Completed in window', s.completedMeasured, 'vehicles'],
    ['Throughput', s.throughput, 'veh/h'], ['Mean speed', s.avgSpeed, 'km/h'],
    ['Mean travel time', s.avgTravel, 's'], ['Mean delay', s.avgDelay, 's'],
    ['Mean stops', s.avgStops, ''], ['Max queue', s.maxQueue, 'vehicles'],
    ['Fleet distance', s.distance, 'veh-km'], ['VMT', s.vmt, 'veh-km'],
    ['Fuel', s.fuel, 'L'], ['CO2', s.co2, 'kg'], ['NOx', s.nox, 'g'],
    ['Pedestrians crossed', s.pedsCrossed, 'peds (window)'], ['Pedestrian kerb wait', s.pedDelay, 's'],
    ['Pedestrian queue (end)', s.pedQueue, 'peds'],
  ];
  rows.push(...summary.map((r) => [r[0], roundCsv(r[1]), r[2]]));
  blank();
  rows.push(['LINK PERFORMANCE']);
  rows.push(['ID', 'Name', 'Length_m', 'Lanes', 'Speed_limit_kmh', 'Entered_total', 'Exited_total', 'Entered_window', 'Exited_window', 'Flow_veh_h', 'Avg_speed_kmh', 'Delay_s', 'Max_queue', 'Avg_queue', 'Density_veh_km_lane']);
  for (const l of results.links) rows.push([l.id, l.name, roundCsv(l.length), l.lanes, l.speed, l.entered, l.exited, l.enteredMeasured ?? l.entered, l.exitedMeasured ?? l.exited, roundCsv(l.flow), roundCsv(l.avgSpeed), roundCsv(l.delay), l.maxQueue, roundCsv(l.avgQueue), roundCsv(l.density)]);
  blank();
  rows.push(['VEHICLE CLASSES']);
  rows.push(['ID', 'Name', 'Category', 'Spawned_total', 'Spawned_window', 'Completed_window', 'Share_window', 'Avg_delay_s', 'Avg_speed_kmh', 'Avg_stops', 'Distance_veh_km', 'Fuel_L']);
  for (const c of results.classes) rows.push([c.id, c.name, c.category, c.spawned, c.spawnedMeasured ?? c.spawned, c.completed, roundCsv(c.share, 3), roundCsv(c.avgDelay), roundCsv(c.avgSpeed), roundCsv(c.avgStops, 2), roundCsv(c.distance / 1000, 3), roundCsv(c.fuel)]);
  blank();
  rows.push(['DETECTORS']);
  rows.push(['ID', 'Name', 'Link', 'Lane', 'Type', 'Count_total', 'Count_window', 'Flow_veh_h', 'Occupancy_fraction']);
  for (const d of results.detectors) rows.push([d.id, d.name, d.linkId, (d.lane ?? 0) + 1, d.type, d.count, d.countMeasured ?? d.count, roundCsv(d.flow), roundCsv(d.occupancy, 3)]);
  blank();
  rows.push(['TIME SERIES']);
  rows.push(['Time_s', 'Active', 'Post_warmup_active', 'Sampled_mean_speed_kmh', 'Queue', 'Throughput_veh_h', 'Pedestrians_active', 'Ped_queue']);
  for (const r of results.series) rows.push([r.t, r.active, r.measuredActive, roundCsv(r.meanSpeed), r.queue, roundCsv(r.throughput), r.peds, r.pedQueue]);

  const slug = slugify(app.project.meta.name || 'traffix-studio');
  downloadText(`${slug}-results.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  app.toast('Results exported', 'Evaluation CSV downloaded.', 'success');
}

export function printReport(app) {
  if (!app.currentResults()) {
    app.toast('Nothing to print', 'Run the simulation before printing a summary report.', 'warn');
    return;
  }
  app.openAnalysis('overview');
  app.toast('Report', 'Preparing print layout…', 'info');
  setTimeout(() => window.print(), 450);
}

// ---------------------------------------------------------------- GeoJSON
export function geoJsonToProject(app, data, fallbackName) {
  if (!data || typeof data !== 'object') throw new Error('GeoJSON payload is empty.');
  const features = data.type === 'FeatureCollection'
    ? (Array.isArray(data.features) ? data.features : [])
    : data.type === 'Feature' ? [data] : [{ type: 'Feature', geometry: data, properties: {} }];
  if (!features.length) throw new Error('GeoJSON contains no features.');

  const lines = [];
  const points = [];
  for (const feature of features) {
    const geometry = feature?.geometry;
    if (!geometry) continue;
    const props = feature.properties || {};
    if (geometry.type === 'LineString') lines.push({ coords: geometry.coordinates, props });
    else if (geometry.type === 'MultiLineString') {
      for (const coords of geometry.coordinates) lines.push({ coords, props });
    } else if (geometry.type === 'Point') points.push({ coord: geometry.coordinates, props });
    else if (geometry.type === 'MultiPoint') {
      for (const coord of geometry.coordinates) points.push({ coord, props });
    }
  }
  if (!lines.length && !points.length) throw new Error('No LineString or Point features were found.');

  let coords = [];
  for (const line of lines) coords = coords.concat(line.coords || []);
  for (const point of points) coords.push(point.coord);
  coords = coords.filter((c) => Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])));
  if (!coords.length) throw new Error('GeoJSON coordinates are invalid.');

  const latSpan = Math.max(...coords.map((c) => Number(c[1]))) - Math.min(...coords.map((c) => Number(c[1])));
  const lonSpan = Math.max(...coords.map((c) => Number(c[0]))) - Math.min(...coords.map((c) => Number(c[0])));
  const fractional = coords.some((c) => Math.abs(Number(c[0]) % 1) > 1e-6 || Math.abs(Number(c[1]) % 1) > 1e-6);
  const geographic = Math.max(lonSpan, latSpan) < 12
    && coords.every((c) => Math.abs(Number(c[0])) <= 180 && Math.abs(Number(c[1])) <= 90)
    && (fractional || Math.max(lonSpan, latSpan) < 0.2);

  const raw = coords.map((c) => ({ x: Number(c[0]), y: Number(c[1]) }));
  const local = geographic ? projectLonLat(raw) : raw.map((p) => ({ x: p.x, y: p.y }));
  const localByCoord = new Map();
  for (let i = 0; i < raw.length; i++) {
    const key = `${raw[i].x},${raw[i].y}`;
    if (!localByCoord.has(key)) localByCoord.set(key, local[i]);
  }
  const cx = (Math.min(...local.map((p) => p.x)) + Math.max(...local.map((p) => p.x))) / 2;
  const cy = (Math.min(...local.map((p) => p.y)) + Math.max(...local.map((p) => p.y))) / 2;
  const transform = (c) => {
    const point = localByCoord.get(`${Number(c[0])},${Number(c[1])}`) || { x: Number(c[0]), y: Number(c[1]) };
    return { x: Math.round((point.x - cx) * 10) / 10, y: Math.round((point.y - cy) * 10) / 10 };
  };

  const project = createEmptyProject(fallbackName || data.name || 'Imported GeoJSON network');
  project.meta.description = 'Network geometry imported from a GeoJSON file. Demand, signal plans and calibration are not implied by the import.';
  project.settings.description = project.meta.description;
  const nodeMap = new Map();
  const getNode = (coord, props = {}) => {
    const pt = transform(coord);
    const key = `${Math.round(pt.x)},${Math.round(pt.y)}`;
    if (nodeMap.has(key)) return nodeMap.get(key).id;
    const id = nextEntityId(project, 'nodes', 'N');
    const node = {
      id,
      name: props.name || props.node_name || `Junction ${id.replace(/^N/, '')}`,
      x: pt.x, y: pt.y,
      type: props.boundary ? 'boundary' : 'junction',
      control: 'priority', radius: 12,
    };
    project.nodes.push(node);
    nodeMap.set(key, node);
    return id;
  };

  for (const p of points) getNode(p.coord, p.props);
  for (const line of lines) {
    const coordsIn = (line.coords || []).filter((c) => Array.isArray(c) && c.length >= 2);
    if (coordsIn.length < 2) continue;
    const start = getNode(coordsIn[0], line.props);
    const end = getNode(coordsIn[coordsIn.length - 1], line.props);
    if (start === end) continue;
    const id = nextEntityId(project, 'links', 'L');
    const speed = Number(line.props.speed ?? line.props.speed_limit ?? line.props.maxspeed);
    const lanes = Number(line.props.lanes ?? line.props.lane_count);
    const highway = String(line.props.highway || line.props.type || '');
    const pointsOut = coordsIn.map((c) => transform(c));
    // Keep intermediate points, but force the first/last to the shared junction coords.
    const startNode = nodeMap.get(`${Math.round(pointsOut[0].x)},${Math.round(pointsOut[0].y)}`);
    const endNode = nodeMap.get(`${Math.round(pointsOut[pointsOut.length - 1].x)},${Math.round(pointsOut[pointsOut.length - 1].y)}`);
    if (startNode) pointsOut[0] = { x: startNode.x, y: startNode.y };
    if (endNode) pointsOut[pointsOut.length - 1] = { x: endNode.x, y: endNode.y };
    project.links.push({
      id,
      name: line.props.name || line.props.street || `Imported link ${id.replace(/^L/, '')}`,
      from: start, to: end,
      points: pointsOut,
      lanes: Number.isFinite(lanes) ? Math.max(1, Math.min(8, Math.round(lanes))) : 2,
      laneWidth: 3.4,
      speed: Number.isFinite(speed) ? Math.max(5, Math.min(160, Math.round(speed))) : (/motorway|trunk|primary/.test(highway) ? 70 : 50),
      priority: /motorway|trunk|primary/.test(highway) ? 3 : 1,
      type: /motorway|trunk/.test(highway) ? 'highway' : /primary|secondary/.test(highway) ? 'arterial' : 'street',
      grade: 0, sidewalk: true, attraction: 1, display: true,
    });
  }
  if (!project.links.length && !project.nodes.length) throw new Error('No usable geometry was produced.');
  return project;
}

function projectLonLat(points) {
  const lat0 = points.reduce((s, p) => s + p.y, 0) / points.length;
  const lon0 = points.reduce((s, p) => s + p.x, 0) / points.length;
  return points.map((p) => ({
    x: (p.x - lon0) * 111320 * Math.cos(lat0 * Math.PI / 180),
    y: -(p.y - lat0) * 110540,
  }));
}

function slugify(text) {
  return String(text || 'traffix-studio').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'traffix-studio';
}

function roundCsv(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return Number(n.toFixed(digits));
}
