import { barChart, donutChart, lineChart } from './charts.js';
import { icon } from '../icons.js';
import {
  escapeHtml as esc, fmtClock, fmtClockTenths, fmtFixed, fmtNum, fmtPct,
} from '../core/utils.js';

const measuredSpawn = (entry) => entry.spawnedMeasured ?? entry.spawned;
const measuredCount = (entry) => entry.countMeasured ?? entry.count;
const measuredEntered = (entry) => entry.enteredMeasured ?? entry.entered;
const measuredExited = (entry) => entry.exitedMeasured ?? entry.exited;

export function renderAnalysis(app) {
  const results = app.currentResults();
  const tab = app.analysisTab || 'overview';
  if (!results) {
    return `<div class="empty-chart" style="height:420px">${icon('chart')}<b>No simulation results yet</b><span>Run the model or open a recorded run to populate the evaluation workspace.</span>
      <button class="btn primary" style="margin-top:8px" data-action="toggle-play">${icon('play')} Run simulation</button></div>`;
  }
  let html = '';
  switch (tab) {
    case 'network': html = networkTab(app, results); break;
    case 'classes': html = classesTab(app, results); break;
    case 'detectors': html = detectorsTab(app, results); break;
    case 'series': html = seriesTab(app, results); break;
    case 'compare': html = compareTab(app, results); break;
    default: html = overviewTab(app, results);
  }
  return html;
}

export function drawAnalysisCharts(app) {
  const results = app.currentResults();
  if (!results) return;
  const series = results.series || [];
  const s = results.summary;
  const tab = app.analysisTab || 'overview';
  const canvas = (id) => document.getElementById(id);

  if (tab === 'overview') {
    lineChart(canvas('an-speed'), series, [
      { key: 'meanSpeed', label: 'Sampled mean speed', color: '#22d3ee', unit: ' km/h', area: true },
    ], { xKey: 't', xUnit: 's', yUnit: '', xLabel: 'Simulation time', xFormat: (t) => fmtClock(t) });
    lineChart(canvas('an-queue'), series, [
      { key: 'queue', label: 'Queue', color: '#fbbf24', unit: ' veh', area: true },
    ], { xKey: 't', xUnit: 's', xLabel: 'Simulation time', xFormat: (t) => fmtClock(t) });
    lineChart(canvas('an-flow'), series, [
      { key: 'active', label: 'Active vehicles', color: '#60a5fa', unit: ' veh' },
      { key: 'measuredActive', label: 'Post-warm-up cohort', color: '#34d399', unit: ' veh' },
    ], { xKey: 't', xUnit: 's', xLabel: 'Simulation time', xFormat: (t) => fmtClock(t) });
    const classes = (results.classes || []).filter((c) => measuredSpawn(c) > 0);
    donutChart(canvas('an-mix'), classes.map((c) => ({ label: c.name, value: measuredSpawn(c), color: c.color })), {
      centerValue: fmtNum(classes.reduce((sum, c) => sum + measuredSpawn(c), 0)),
      centerLabel: 'spawns',
    });
    barChart(canvas('an-delay-bars'), [...(results.links || [])].sort((a, b) => b.delay - a.delay).slice(0, 10).map((l) => ({
      label: l.id, value: l.delay, color: '#22d3ee',
    })), { horizontal: true, format: (v) => `${fmtFixed(v, 1)} s` });
    barChart(canvas('an-class-delay'), (results.classes || []).filter((c) => c.completed > 0).map((c) => ({
      label: c.name, value: c.avgDelay, color: c.color,
    })), { horizontal: true, format: (v) => `${fmtFixed(v, 1)} s` });
    void s;
  } else if (tab === 'network') {
    const links = [...(results.links || [])];
    barChart(canvas('an-link-flow'), links.sort((a, b) => b.flow - a.flow).slice(0, 14).map((l) => ({
      label: l.id, value: l.flow, color: '#60a5fa',
    })), { horizontal: true, format: (v) => `${fmtNum(v)} veh/h` });
    barChart(canvas('an-link-delay'), [...links].sort((a, b) => b.delay - a.delay).slice(0, 14).map((l) => ({
      label: l.id, value: l.delay, color: '#fbbf24',
    })), { horizontal: true, format: (v) => `${fmtFixed(v, 1)} s` });
    lineChart(canvas('an-link-speed'), series, [
      { key: 'meanSpeed', label: 'Sampled mean speed', color: '#22d3ee', area: true, unit: ' km/h' },
    ], { xKey: 't', xUnit: 's', xLabel: 'Simulation time', xFormat: (t) => fmtClock(t) });
    void links;
  } else if (tab === 'classes') {
    const classes = (results.classes || []).filter((c) => measuredSpawn(c) > 0);
    donutChart(canvas('an-class-mix'), classes.map((c) => ({ label: c.name, value: measuredSpawn(c), color: c.color })), {
      centerValue: fmtNum(classes.reduce((sum, c) => sum + measuredSpawn(c), 0)), centerLabel: 'spawns',
    });
    barChart(canvas('an-class-delay2'), classes.filter((c) => c.completed > 0).map((c) => ({
      label: c.name, value: c.avgDelay, color: c.color,
    })), { horizontal: true, format: (v) => `${fmtFixed(v, 1)} s` });
    barChart(canvas('an-class-speed'), classes.map((c) => ({
      label: c.name, value: c.avgSpeed, color: c.color,
    })), { horizontal: true, max: Math.max(1, ...classes.map((c) => c.avgSpeed)) * 1.1, format: (v) => `${fmtFixed(v, 1)} km/h` });
  } else if (tab === 'detectors') {
    const dets = results.detectors || [];
    barChart(canvas('an-det-flow'), dets.map((d) => ({
      label: d.id, value: d.flow, color: '#22d3ee',
    })), { horizontal: true, format: (v) => `${fmtNum(v)}/h` });
    barChart(canvas('an-det-occ'), dets.map((d) => ({
      label: d.id, value: d.occupancy * 100, color: '#a78bfa',
    })), { horizontal: true, format: (v) => `${fmtFixed(v, 1)}%` });
  } else if (tab === 'series') {
    lineChart(canvas('an-series-speed'), series, [
      { key: 'meanSpeed', label: 'Sampled mean speed', color: '#22d3ee', area: true, unit: ' km/h' },
    ], { xKey: 't', xUnit: 's', xLabel: 'Simulation time', xFormat: (t) => fmtClock(t) });
    lineChart(canvas('an-series-queue'), series, [
      { key: 'queue', label: 'Queue', color: '#fbbf24', area: true, unit: ' veh' },
      { key: 'throughput', label: 'Throughput', color: '#34d399', unit: ' veh/h' },
    ], { xKey: 't', xUnit: 's', xLabel: 'Simulation time', xFormat: (t) => fmtClock(t) });
    lineChart(canvas('an-series-active'), series, [
      { key: 'active', label: 'Active vehicles', color: '#60a5fa', unit: ' veh' },
      { key: 'peds', label: 'Pedestrians active', color: '#f472b6', unit: ' peds' },
    ], { xKey: 't', xUnit: 's', xLabel: 'Simulation time', xFormat: (t) => fmtClock(t) });
  }
}

// ------------------------------------------------------------------ KPI bits
function kpi(label, value, unit, sub, cls = '') {
  return `<div class="kpi-card ${cls}"><div class="k-label">${esc(label)}</div><div class="k-value">${value}<small>${esc(unit || '')}</small></div><div class="k-sub">${esc(sub || '')}</div></div>`;
}

function overviewTab(app, r) {
  const s = r.summary;
  const runLabel = app.analysisRunId === 'live' ? 'live simulation' : 'recorded run';
  return `
    <div class="kpi-grid">
      ${kpi('Completed trips', fmtNum(s.completedMeasured || s.completed), 'veh', `${fmtNum(s.spawnedMeasured || s.spawned)} releases in window`, 'cyan')}
      ${kpi('Throughput', fmtNum(s.throughput), 'veh/h', 'measured window', 'green')}
      ${kpi('Mean delay', fmtFixed(s.avgDelay, 1), 's', 'per completed trip', s.avgDelay > 45 ? 'amber' : '')}
      ${kpi('Mean speed', fmtFixed(s.avgSpeed, 1), 'km/h', 'network space mean', 'cyan')}
      ${kpi('Maximum queue', fmtNum(s.maxQueue), 'veh', `${fmtNum(s.queueNow)} queued now`, s.maxQueue > 30 ? 'amber' : '')}
      ${kpi('CO₂ estimate', fmtFixed(s.co2, 1), 'kg', `${fmtFixed(s.fuel, 1)} L fuel`, '')}
    </div>
    <div class="dash-grid">
      <div class="dash-card">
        <div class="dash-card-head"><h3>Sampled mean speed</h3><span>${esc(runLabel)}</span></div>
        <div class="chart-wrap"><canvas id="an-speed"></canvas></div>
      </div>
      <div class="dash-card">
        <div class="dash-card-head"><h3>Queue length</h3><span>vehicles</span></div>
        <div class="chart-wrap"><canvas id="an-queue"></canvas></div>
      </div>
    </div>
    <div class="dash-grid three">
      <div class="dash-card">
        <div class="dash-card-head"><h3>Active vehicles</h3><span><i class="dot blue"></i>All <i class="dot green"></i>Post-warm-up</span></div>
        <div class="chart-wrap short"><canvas id="an-flow"></canvas></div>
      </div>
      <div class="dash-card">
        <div class="dash-card-head"><h3>Vehicle mix</h3><span>measured spawns</span></div>
        <div class="chart-wrap short"><canvas id="an-mix"></canvas></div>
      </div>
      <div class="dash-card">
        <div class="dash-card-head"><h3>Emissions and exposure</h3><span>estimates</span></div>
        <div class="stat-grid">
          <div class="stat-cell"><span>CO₂</span><b>${fmtFixed(s.co2, 1)} <em>kg</em></b></div>
          <div class="stat-cell"><span>NOₓ</span><b>${fmtFixed(s.nox, 1)} <em>g</em></b></div>
          <div class="stat-cell"><span>VMT</span><b>${fmtFixed(s.vmt, 1)} <em>veh-km</em></b></div>
          <div class="stat-cell"><span>Pedestrians</span><b>${fmtNum(s.pedsCrossed)} <em>crossed</em></b></div>
          <div class="stat-cell"><span>Ped wait</span><b>${fmtFixed(s.pedDelay, 1)} <em>s</em></b></div>
          <div class="stat-cell"><span>Lane km</span><b>${fmtFixed(s.laneKm, 2)} <em>km</em></b></div>
        </div>
      </div>
    </div>
    <div class="dash-grid three">
      <div class="dash-card">
        <div class="dash-card-head"><h3>Link delay ranking</h3><span>average seconds</span></div>
        <div class="chart-wrap short"><canvas id="an-delay-bars"></canvas></div>
      </div>
      <div class="dash-card">
        <div class="dash-card-head"><h3>Delay by vehicle class</h3><span>average seconds</span></div>
        <div class="chart-wrap short"><canvas id="an-class-delay"></canvas></div>
      </div>
      <div class="dash-card">
        <div class="dash-card-head"><h3>Measurement window</h3><span>${esc(r.complete ? 'complete' : 'partial')}</span></div>
        <div class="stat-grid">
          <div class="stat-cell"><span>Window start</span><b>${fmtClock(r.window.start)}</b></div>
          <div class="stat-cell"><span>Window end</span><b>${fmtClock(r.window.end)}</b></div>
          <div class="stat-cell"><span>Measured trips</span><b>${fmtNum(s.completedMeasured)}</b></div>
          <div class="stat-cell"><span>Seed</span><b>${fmtNum(r.seed)}</b></div>
          <div class="stat-cell"><span>Mean trip time</span><b>${fmtFixed(s.avgTravel, 1)} <em>s avg</em></b></div>
          <div class="stat-cell"><span>Stops</span><b>${fmtFixed(s.avgStops, 2)} <em>avg</em></b></div>
        </div>
      </div>
    </div>
    <div class="dash-card" style="margin-top:12px">
      <div class="dash-card-head"><h3>Highest-delay links</h3><span>top 8</span></div>
      ${linkTable([...r.links].sort((a, b) => b.delay - a.delay).slice(0, 8), true)}
    </div>
    <div class="report-note"><b>Measurement window:</b> trip and pedestrian completion statistics only include trips and pedestrians released after ${fmtClock(r.warmup)}. Pedestrian delay is kerb queue wait. Network speed, distance and emissions cover every vehicle active inside the window. The simulation ends at ${fmtClock(r.duration)}. Emissions are engineering estimates from speed and acceleration, not regulatory measurements.</div>
  `;
}

function networkTab(app, r) {
  const links = r.links || [];
  return `
    <div class="kpi-grid">
      ${kpi('Network length', fmtFixed(links.reduce((s, l) => s + l.length, 0) / 1000, 2), 'km', 'all links', 'cyan')}
      ${kpi('Lane kilometres', fmtFixed(r.summary.laneKm, 2), 'km', 'supply', '')}
      ${kpi('Entered', fmtNum(links.reduce((s, l) => s + measuredEntered(l), 0)), 'veh', 'entries in window', '')}
      ${kpi('Exited', fmtNum(links.reduce((s, l) => s + measuredExited(l), 0)), 'veh', 'exits in window', 'green')}
      ${kpi('Max queue', fmtNum(r.summary.maxQueue), 'veh', 'network-wide', 'amber')}
      ${kpi('VMT', fmtFixed(r.summary.vmt, 1), 'veh-km', 'vehicle travel', '')}
    </div>
    <div class="dash-grid">
      <div class="dash-card">
        <div class="dash-card-head"><h3>Link flow</h3><span>measured window</span></div>
        <div class="chart-wrap"><canvas id="an-link-flow"></canvas></div>
      </div>
      <div class="dash-card">
        <div class="dash-card-head"><h3>Link delay</h3><span>average seconds</span></div>
        <div class="chart-wrap"><canvas id="an-link-delay"></canvas></div>
      </div>
    </div>
    <div class="dash-card" style="margin-bottom:12px">
      <div class="dash-card-head"><h3>Network speed profile</h3><span>km/h</span></div>
      <div class="chart-wrap short"><canvas id="an-link-speed"></canvas></div>
    </div>
    <div class="dash-card">
      <div class="dash-card-head"><h3>Link performance</h3><span>${links.length} links</span></div>
      ${linkTable(links, false)}
    </div>
    <div class="report-note">Flow and entered/exited counts use the measurement window. Average speed is based on individual link travel times; delay is travel time above free-flow time.</div>
  `;
}

function linkTable(links, compact) {
  if (!links.length) return `<div class="empty-chart" style="height:110px">${icon('route')}<span>No link measurements.</span></div>`;
  const maxFlow = Math.max(1, ...links.map((l) => l.flow));
  return `<div class="table-wrap"><table class="data-table">
    <thead><tr><th>Link</th><th>Name</th>${compact ? '' : '<th class="num">Length</th><th class="num">Lanes</th>'}<th class="num">Entered (win.)</th><th class="num">Flow</th><th class="num">Avg speed</th><th class="num">Delay</th><th class="num">Queue max</th>${compact ? '' : '<th class="num" title="vehicles per lane-kilometre">Density</th>'}
      <th>Relative flow</th></tr></thead>
    <tbody>${links.map((l) => `<tr>
      <td class="row-name">${esc(l.id)}</td><td>${esc(l.name)}</td>
      ${compact ? '' : `<td class="num">${fmtFixed(l.length, 0)} m</td><td class="num">${l.lanes}</td>`}
      <td class="num">${fmtNum(measuredEntered(l))}</td>
      <td class="num">${fmtNum(l.flow)}</td>
      <td class="num">${fmtFixed(l.avgSpeed, 1)}</td>
      <td class="num">${fmtFixed(l.delay, 1)}</td>
      <td class="num">${fmtNum(l.maxQueue)}</td>
      ${compact ? '' : `<td class="num">${fmtFixed(l.density, 1)}</td>`}
      <td class="bar-cell"><div class="bar-track"><i style="width:${Math.max(1, l.flow / maxFlow * 100)}%"></i></div></td>
    </tr>`).join('')}</tbody>
    <tfoot><tr class="total"><td colspan="${compact ? 2 : 4}">Total / mean</td><td class="num">${fmtNum(links.reduce((s, l) => s + measuredEntered(l), 0))}</td><td class="num">${fmtNum(links.reduce((s, l) => s + l.flow, 0))}</td><td></td><td class="num">${fmtFixed(links.reduce((s, l) => s + l.delay, 0) / links.length, 1)}</td><td class="num">${fmtNum(Math.max(...links.map((l) => l.maxQueue)))}</td>${compact ? '' : '<td></td>'}<td></td></tr></tfoot>
  </table></div>`;
}

function classesTab(app, r) {
  const classes = r.classes || [];
  const total = classes.reduce((s, c) => s + measuredSpawn(c), 0);
  return `
    <div class="kpi-grid">
      ${kpi('Classes observed', fmtNum(classes.filter((c) => measuredSpawn(c) > 0).length), 'classes', `of ${classes.length} defined`, 'cyan')}
      ${kpi('Vehicles released', fmtNum(total), 'veh', 'in window', '')}
      ${kpi('Passenger cars', fmtPct(classes.filter((c) => c.category === 'car').reduce((s, c) => s + measuredSpawn(c), 0) / Math.max(1, total), 1), '', 'mode share', 'green')}
      ${kpi('Heavy vehicles', fmtPct(classes.filter((c) => c.category === 'truck' || c.category === 'bus').reduce((s, c) => s + measuredSpawn(c), 0) / Math.max(1, total), 1), '', 'mode share', 'amber')}
      ${kpi('Mean delay', fmtFixed(classes.filter((c) => c.completed).reduce((s, c) => s + c.avgDelay, 0) / Math.max(1, classes.filter((c) => c.completed).length), 1), 's', 'class average', '')}
      ${kpi('Mean speed', fmtFixed(classes.filter((c) => c.avgSpeed > 0).reduce((s, c) => s + c.avgSpeed, 0) / Math.max(1, classes.filter((c) => c.avgSpeed > 0).length), 1), 'km/h', 'class average', 'cyan')}
    </div>
    <div class="dash-grid three">
      <div class="dash-card">
        <div class="dash-card-head"><h3>Vehicle mix</h3><span>measured spawns</span></div>
        <div class="chart-wrap"><canvas id="an-class-mix"></canvas></div>
      </div>
      <div class="dash-card">
        <div class="dash-card-head"><h3>Average delay</h3><span>seconds</span></div>
        <div class="chart-wrap"><canvas id="an-class-delay2"></canvas></div>
      </div>
      <div class="dash-card">
        <div class="dash-card-head"><h3>Average speed</h3><span>km/h</span></div>
        <div class="chart-wrap"><canvas id="an-class-speed"></canvas></div>
      </div>
    </div>
    <div class="dash-card">
      <div class="dash-card-head"><h3>Class performance</h3><span>measurement window</span></div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Class</th><th>Category</th><th class="num">Share</th><th class="num">Spawned (win.)</th><th class="num">Completed</th><th class="num">Avg delay</th><th class="num">Avg speed</th><th class="num">Avg stops</th><th class="num" title="vehicle-kilometres">Distance</th><th class="num">Fuel</th></tr></thead>
        <tbody>${classes.map((c) => `<tr><td class="row-name"><i class="swatch-dot" style="background:${esc(c.color)};margin-right:5px"></i>${esc(c.name)}</td><td>${esc(c.category)}</td><td class="num">${fmtPct(c.share, 1)}</td><td class="num">${fmtNum(measuredSpawn(c))}</td><td class="num">${fmtNum(c.completed)}</td><td class="num">${fmtFixed(c.avgDelay, 1)}</td><td class="num">${fmtFixed(c.avgSpeed, 1)}</td><td class="num">${fmtFixed(c.avgStops, 2)}</td><td class="num">${fmtFixed(c.distance / 1000, 2)} km</td><td class="num">${fmtFixed(c.fuel, 1)} L</td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="report-note">Spawn, share and trip indicators cover the measurement window. Distance and fuel describe all class vehicles active inside that window. Vehicle classes use an IDM car-following model with class-specific dimensions, acceleration, desired speed and behaviour multipliers. Bicycle and motorcycle results are indicative rather than calibrated against field data.</div>
  `;
}

function detectorsTab(app, r) {
  const dets = r.detectors || [];
  if (!dets.length) return `<div class="empty-chart" style="height:420px">${icon('detector')}<b>No detectors configured</b><span>Place loop detectors on links to measure flow and occupancy.</span></div>`;
  return `
    <div class="kpi-grid">
      ${kpi('Detectors', fmtNum(dets.length), 'active', 'network', 'cyan')}
      ${kpi('Total count', fmtNum(dets.reduce((s, d) => s + measuredCount(d), 0)), 'veh', 'crossings in window', '')}
      ${kpi('Mean flow', fmtNum(dets.reduce((s, d) => s + d.flow, 0) / dets.length), 'veh/h', 'per detector', 'green')}
      ${kpi('Mean occupancy', fmtPct(dets.reduce((s, d) => s + d.occupancy, 0) / dets.length, 1), '', 'time occupied', 'amber')}
      ${kpi('Busiest', dets.slice().sort((a, b) => b.flow - a.flow)[0]?.id || '—', '', 'detector', '')}
      ${kpi('Window', fmtClock(r.window.length), '', 'measured', '')}
    </div>
    <div class="dash-grid">
      <div class="dash-card"><div class="dash-card-head"><h3>Detector flow</h3><span>veh/h</span></div><div class="chart-wrap"><canvas id="an-det-flow"></canvas></div></div>
      <div class="dash-card"><div class="dash-card-head"><h3>Occupancy</h3><span>percent of time</span></div><div class="chart-wrap"><canvas id="an-det-occ"></canvas></div></div>
    </div>
    <div class="dash-card">
      <div class="dash-card-head"><h3>Detector measurements</h3><span>${dets.length} loops</span></div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Detector</th><th>Name</th><th>Link</th><th class="num">Lane</th><th>Type</th><th class="num">Count (win.)</th><th class="num">Flow</th><th class="num">Occupancy</th></tr></thead>
        <tbody>${dets.map((d) => `<tr><td class="row-name">${esc(d.id)}</td><td>${esc(d.name)}</td><td>${esc(d.linkId)}</td><td class="num">${(d.lane ?? 0) + 1}</td><td>${esc(d.type)}</td><td class="num">${fmtNum(measuredCount(d))}</td><td class="num">${fmtNum(d.flow)}</td><td class="num">${fmtPct(d.occupancy, 1)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="report-note">Count and flow use detector crossings inside the measurement window. Detection is event-based at the detector position. Occupancy is sampled every two simulated seconds and is an approximation of loop occupancy, not a raw controller input.</div>
  `;
}

function seriesTab(app, r) {
  const series = r.series || [];
  return `
    <div class="dash-grid">
      <div class="dash-card"><div class="dash-card-head"><h3>Sampled mean speed</h3><span>km/h</span></div><div class="chart-wrap"><canvas id="an-series-speed"></canvas></div></div>
      <div class="dash-card"><div class="dash-card-head"><h3>Queue and throughput</h3><span>veh / veh/h</span></div><div class="chart-wrap"><canvas id="an-series-queue"></canvas></div></div>
    </div>
    <div class="dash-card" style="margin-bottom:12px"><div class="dash-card-head"><h3>Active vehicles and pedestrians</h3><span><i class="dot blue"></i>All <i class="dot green"></i>Post-warm-up <i class="dot pink"></i>Pedestrians</span></div><div class="chart-wrap short"><canvas id="an-series-active"></canvas></div></div>
    <div class="dash-card">
      <div class="dash-card-head"><h3>Time-series samples</h3><span>last ${Math.min(40, series.length)} of ${series.length}</span></div>
      <div class="table-wrap" style="max-height:340px"><table class="data-table">
        <thead><tr><th class="num">Time</th><th class="num">Active</th><th class="num">Post-warm-up</th><th class="num">Sampled mean speed</th><th class="num">Queue</th><th class="num">Throughput</th><th class="num">Peds active</th><th class="num">Ped queue</th></tr></thead>
        <tbody>${series.slice(-40).reverse().map((row) => `<tr><td class="num">${fmtClockTenths(row.t)}</td><td class="num">${fmtNum(row.active)}</td><td class="num">${fmtNum(row.measuredActive)}</td><td class="num">${fmtFixed(row.meanSpeed, 1)}</td><td class="num">${fmtNum(row.queue)}</td><td class="num">${fmtNum(row.throughput)}</td><td class="num">${fmtNum(row.peds)}</td><td class="num">${fmtNum(row.pedQueue)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="report-note">Samples are written every ${fmtNum(app.project.settings.measurementInterval)} simulated seconds. Throughput is the measured completion rate for the preceding interval.</div>
  `;
}

function compareTab(app, r) {
  const runs = app.runs || [];
  const chips = `<div class="run-chip-list" style="margin-bottom:12px">
    <button class="run-chip ${app.analysisRunId === 'live' ? 'active' : ''}" data-arun="live">${icon('play')} Live / current</button>
    ${runs.map((run) => `<button class="run-chip ${app.analysisRunId === run.id ? 'active' : ''}" data-arun="${esc(run.id)}">${esc(run.name)}</button>`).join('')}
  </div>`;
  if (!runs.length) {
    return `${chips}<div class="empty-chart" style="height:360px">${icon('beaker')}<b>No recorded runs</b><span>Finished or batch simulations are stored here for comparison.</span>
      <button class="btn primary" style="margin-top:8px" data-action="batch">${icon('beaker')} Run batch replications</button></div>`;
  }
  const rows = runs.map((run) => {
    const s = run.results.summary;
    return `<tr class="${run.id === app.analysisRunId ? 'total' : ''}">
      <td class="row-name">${esc(run.name)}</td><td class="num">${fmtNum(run.seed)}</td>
      <td class="num">${fmtNum(s.completedMeasured)}</td><td class="num">${fmtNum(s.throughput)}</td>
      <td class="num">${fmtFixed(s.avgDelay, 1)}</td><td class="num">${fmtFixed(s.avgSpeed, 1)}</td>
      <td class="num">${fmtNum(s.maxQueue)}</td><td class="num">${fmtFixed(s.co2, 1)}</td>
      <td class="num">${fmtFixed(s.pedsCrossed, 0)}</td>
      <td><button class="link-btn" data-arun="${esc(run.id)}">View</button></td>
    </tr>`;
  }).join('');
  const measured = runs.map((x) => x.results.summary);
  const mean = (key) => measured.reduce((s, x) => s + x[key], 0) / Math.max(1, measured.length);
  const sd = (key) => {
    const m = mean(key);
    return Math.sqrt(measured.reduce((s, x) => s + (x[key] - m) ** 2, 0) / Math.max(1, measured.length - 1));
  };
  const selected = app.analysisRunId === 'live' ? r : runs.find((run) => run.id === app.analysisRunId)?.results || r;
  return `
    ${chips}
    <div class="dash-grid three">
      <div class="dash-card"><div class="dash-card-head"><h3>Recorded runs</h3><span>${runs.length}</span></div>
        <div class="stat-grid">
          <div class="stat-cell"><span>Mean throughput</span><b>${fmtNum(mean('throughput'))} <em>veh/h</em></b></div>
          <div class="stat-cell"><span>Std. deviation</span><b>${fmtNum(sd('throughput'))} <em>veh/h</em></b></div>
          <div class="stat-cell"><span>Mean delay</span><b>${fmtFixed(mean('avgDelay'), 1)} <em>s</em></b></div>
          <div class="stat-cell"><span>Delay std. dev.</span><b>${fmtFixed(sd('avgDelay'), 1)} <em>s</em></b></div>
        </div>
      </div>
      <div class="dash-card"><div class="dash-card-head"><h3>Selected run</h3><span>${esc(app.analysisRunId === 'live' ? 'live' : selected.runAt ? 'recorded' : 'current')}</span></div>
        <div class="stat-grid">
          <div class="stat-cell"><span>Completed</span><b>${fmtNum(selected.summary.completedMeasured)}</b></div>
          <div class="stat-cell"><span>Mean speed</span><b>${fmtFixed(selected.summary.avgSpeed, 1)} <em>km/h</em></b></div>
          <div class="stat-cell"><span>Max queue</span><b>${fmtNum(selected.summary.maxQueue)}</b></div>
          <div class="stat-cell"><span>CO₂</span><b>${fmtFixed(selected.summary.co2, 1)} <em>kg</em></b></div>
        </div>
      </div>
      <div class="dash-card"><div class="dash-card-head"><h3>Replications</h3><span>batch</span></div>
        <p class="section-hint">Run the model with independent seeds to estimate stochastic variability.</p>
        <div class="btn-row"><button class="btn primary" data-action="batch">${icon('beaker')} Batch replications…</button></div>
      </div>
    </div>
    <div class="dash-card" style="margin-top:12px">
      <div class="dash-card-head"><h3>Run comparison</h3><span>stored in this session</span></div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Run</th><th class="num">Seed</th><th class="num">Completed</th><th class="num">Throughput</th><th class="num">Delay</th><th class="num">Speed</th><th class="num">Max queue</th><th class="num">CO₂</th><th class="num">Peds</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>
    <div class="report-note">Runs are kept in memory for this browser session. Export each run to CSV for archival analysis. Network edits do not retroactively change stored results.</div>
  `;
}
