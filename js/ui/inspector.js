import { icon } from '../icons.js';
import {
  escapeHtml as esc, fmtClock, fmtDistance, fmtFixed, fmtNum, fmtPct,
} from '../core/utils.js';

const TYPE_META = {
  node: { label: 'Junction', icon: 'node' },
  link: { label: 'Link', icon: 'road' },
  controller: { label: 'Signal controller', icon: 'controller' },
  head: { label: 'Signal head', icon: 'signal' },
  crosswalk: { label: 'Pedestrian crossing', icon: 'crosswalk' },
  detector: { label: 'Detector', icon: 'detector' },
  input: { label: 'Vehicle input', icon: 'car' },
  route: { label: 'Route', icon: 'route' },
  pt: { label: 'Transit line', icon: 'bus' },
  class: { label: 'Vehicle class', icon: 'car' },
  run: { label: 'Evaluation run', icon: 'chart' },
  multi: { label: 'Selection', icon: 'layers' },
};

const SIGNAL_COLORS = { green: '#34d399', yellow: '#fbbf24', red: '#f87171' };

export function renderInspector(app) {
  const sel = app.selection;
  if (!sel) return projectInspector(app);
  if (sel.type === 'multi') return multiInspector(app);
  const entity = app.findEntity(sel.type, sel.id);
  if (!entity) return emptyInspector('Object not found', 'It may have been deleted. Select another object in the network.');
  switch (sel.type) {
    case 'node': return nodeInspector(app, entity);
    case 'link': return linkInspector(app, entity);
    case 'controller': return controllerInspector(app, entity);
    case 'head': return headInspector(app, entity);
    case 'crosswalk': return crosswalkInspector(app, entity);
    case 'detector': return detectorInspector(app, entity);
    case 'input': return inputInspector(app, entity);
    case 'route': return routeInspector(app, entity);
    case 'pt': return ptInspector(app, entity);
    case 'class': return classInspector(app, entity);
    case 'run': return runInspector(app, entity);
    default: return emptyInspector('Unknown selection', 'This object type cannot be inspected.');
  }
}

// ------------------------------------------------------------------ header
function header(type, entity) {
  const meta = TYPE_META[type] || TYPE_META.node;
  return `<div class="insp-section">
    <div class="insp-type">
      <div class="type-ic">${icon(meta.icon)}</div>
      <div><b>${esc(entity?.name || meta.label)}</b><small>${esc(meta.label)} · ${esc(entity?.id || '')}</small></div>
    </div>
  </div>`;
}

function section(title, body, extra = '') {
  return `<div class="insp-section"><div class="insp-section-title"><span>${title}</span>${extra}</div>${body}</div>`;
}

function emptyInspector(title, text) {
  return `<div class="insp-empty"><div class="big-ic">${icon('cursor')}</div><b>${esc(title)}</b><p>${esc(text)}</p></div>`;
}

// ------------------------------------------------------------------ fields
function attrs(opts = {}) {
  const out = [];
  out.push(`data-scope="${opts.scope || 'entity'}"`);
  out.push(`data-path="${opts.path || ''}"`);
  out.push(`data-dtype="${opts.dtype || 'text'}"`);
  if (opts.phaseId) out.push(`data-phase-id="${opts.phaseId}"`);
  if (opts.classId) out.push(`data-class-id="${opts.classId}"`);
  if (opts.index !== undefined) out.push(`data-index="${opts.index}"`);
  if (opts.soft) out.push('data-soft="1"');
  if (opts.scale !== undefined) out.push(`data-scale="${opts.scale}"`);
  return out.join(' ');
}

function numField(label, path, value, opts = {}) {
  return `<div class="field"><label>${label}</label>
    <input class="inp" type="number" ${attrs({ ...opts, path, dtype: 'number' })}
      value="${Number.isFinite(Number(value)) ? Number(value) : 0}"
      ${opts.min !== undefined ? `min="${opts.min}"` : ''}
      ${opts.max !== undefined ? `max="${opts.max}"` : ''}
      step="${opts.step ?? 1}" />
    ${opts.hint ? `<div class="form-hint">${opts.hint}</div>` : ''}</div>`;
}

function textField(label, path, value, opts = {}) {
  return `<div class="field"><label>${label}</label>
    <input class="inp" type="text" ${attrs({ ...opts, path })} value="${esc(value ?? '')}" ${opts.readonly ? 'readonly' : ''} /></div>`;
}

function colorField(label, path, value, opts = {}) {
  return `<div class="field-row"><label>${label}</label>
    <input type="color" ${attrs({ ...opts, path, soft: opts.soft ?? true })} value="${esc(value || '#22d3ee')}" /></div>`;
}

function selectField(label, path, value, options, opts = {}) {
  const list = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return `<div class="field"><label>${label}</label>
    <select class="inp" ${attrs({ ...opts, path, dtype: 'text' })}>
      ${list.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select></div>`;
}

function checkRow(label, path, checked, opts = {}) {
  return `<label class="check-row"><input type="checkbox" ${attrs({ ...opts, path, dtype: 'boolean' })} ${checked ? 'checked' : ''} /> ${label}</label>`;
}

function rangeField(label, path, value, min, max, step, unit, opts = {}) {
  return `<div class="field"><label>${label}</label>
    <div class="range-row">
      <input type="range" ${attrs({ ...opts, path, dtype: 'number' })} min="${min}" max="${max}" step="${step}" value="${value}" data-live="1" />
      <span class="range-val">${fmtFixed(value, step >= 1 ? 0 : 1)}${unit || ''}</span>
    </div></div>`;
}

function fieldPair(a, b) {
  return `<div class="field-pair">${a}${b}</div>`;
}

function statGrid(items) {
  return `<div class="stat-grid">${items.map(([k, v, sub]) => `<div class="stat-cell"><span>${esc(k)}</span><b>${v}${sub ? ` <em>${esc(sub)}</em>` : ''}</b></div>`).join('')}</div>`;
}

function btn(label, act, opts = {}) {
  const cls = opts.cls || 'btn ghost small';
  return `<button class="${cls}" data-iact="${act}" ${opts.id ? `data-id="${opts.id}"` : ''} ${opts.index !== undefined ? `data-index="${opts.index}"` : ''}>${opts.icon ? icon(opts.icon) : ''}${label}</button>`;
}

function linkOptions(project) {
  return project.links.map((l) => ({ value: l.id, label: `${l.id} · ${l.name}` }));
}
function nodeOptions(project) {
  return project.nodes.map((n) => ({ value: n.id, label: `${n.id} · ${n.name}` }));
}
function controllerOptions(project) {
  return [{ value: '', label: 'No controller' }, ...project.signalControllers.map((c) => ({ value: c.id, label: `${c.id} · ${c.name}` }))];
}

// ------------------------------------------------------------------ project
function projectInspector(app) {
  const p = app.project;
  const net = app.network;
  const settings = p.settings;
  const counts = {
    nodes: p.nodes.length, links: p.links.length,
    lanes: p.links.reduce((s, l) => s + (l.lanes || 1), 0),
    controllers: p.signalControllers.length, heads: p.signalHeads.length,
    crossings: p.crosswalks.length, detectors: p.detectors.length,
    inputs: p.inputs.length, routes: p.routes.length, pt: p.ptLines.length,
  };
  const sim = app.sim;
  const snap = sim?.getSnapshot?.();
  return `
    ${section('PROJECT', `
      ${textField('Project name', 'meta.name', p.meta.name, { scope: 'project', soft: true })}
      <div class="field"><label>Description</label><textarea class="inp" rows="3" style="height:58px;padding:6px 8px;resize:vertical" ${attrs({ scope: 'project', path: 'meta.description', soft: true })}>${esc(p.meta.description || '')}</textarea></div>
      <div class="chip-row"><span class="chip">${icon('layers')} ${p.links.length} links</span><span class="chip">${icon('node')} ${p.nodes.length} nodes</span><span class="chip">${icon('route')} ${fmtFixed(p.links.reduce((s, l) => s + net.lengthOf(l.id) * (l.lanes || 1), 0) / 1000, 2)} lane-km</span></div>
    `)}

    ${section('SIMULATION', `
      ${fieldPair(numField('Duration', 'settings.duration', settings.duration, { scope: 'project', min: 30, max: 86400, step: 30, hint: 'seconds' }), numField('Warm-up', 'settings.warmup', settings.warmup, { scope: 'project', min: 0, max: 7200, step: 30, hint: 'seconds' }))}
      ${fieldPair(numField('Time step', 'settings.step', settings.step, { scope: 'project', min: 0.02, max: 0.5, step: 0.01, hint: 'seconds' }), numField('Seed', 'settings.seed', settings.seed, { scope: 'project', min: 1, max: 999999, step: 1 }))}
      ${fieldPair(numField('Measure interval', 'settings.measurementInterval', settings.measurementInterval, { scope: 'project', min: 5, max: 300, step: 5, hint: 'seconds' }), numField('Batch runs', 'settings.batchRuns', settings.batchRuns, { scope: 'project', min: 1, max: 30, step: 1 }))}
      ${selectField('Routing', 'settings.routing', settings.routing, [
        { value: 'shortest', label: 'Shortest travel time' },
        { value: 'distance', label: 'Shortest distance' },
        { value: 'random', label: 'Stochastic destination' },
      ], { scope: 'project' })}
      ${checkRow('Lane changing (MOBIL)', 'settings.laneChanging', settings.laneChanging !== false, { scope: 'project' })}
      ${checkRow('Vehicles yield at crossings', 'settings.pedestrianYield', settings.pedestrianYield !== false, { scope: 'project' })}
      ${checkRow('Right turn on red', 'settings.rightTurnOnRed', settings.rightTurnOnRed === true, { scope: 'project' })}
    `)}

    ${section('NETWORK STATE', `
      ${statGrid([
        ['Links', fmtNum(counts.links), `${counts.lanes} lanes`],
        ['Signals', fmtNum(counts.heads), `${counts.controllers} controllers`],
        ['Crossings', fmtNum(counts.crossings), `${counts.detectors} detectors`],
        ['Demand', fmtNum(p.inputs.reduce((s, i) => s + Number(i.volume || 0), 0)), 'veh/h'],
      ])}
      ${snap ? `<div class="divider"></div>${statGrid([
        ['Running', fmtNum(snap.active), 'vehicles'],
        ['Completed (win.)', fmtNum(sim?.evaluation?.completedMeasured || 0), 'trips'],
        ['Current speed', fmtFixed(snap.avgSpeed, 1), 'km/h'],
        ['Queue', fmtNum(snap.queue), 'vehicles'],
      ])}` : ''}
      <div class="btn-row">
        ${btn('Fit network', 'fit', { icon: 'fit' })}
        ${btn('Validate model', 'validate', { icon: 'check' })}
        ${btn('Evaluation', 'analysis', { icon: 'chart' })}
      </div>
      <div class="insp-note"><b>Independent implementation.</b> TRAFFIX STUDIO is not affiliated with PTV Group and does not read or write proprietary Vissim file formats.</div>
    `)}

    ${section('DISPLAY', `
      <div class="btn-row">
        ${btn(`Grid ${app.editor.grid ? 'on' : 'off'}`, 'toggle-grid', { icon: 'grid' })}
        ${btn(`Labels ${app.editor.labels ? 'on' : 'off'}`, 'toggle-labels', { icon: 'eye' })}
        ${btn(`Turn paths ${app.editor.connectors ? 'on' : 'off'}`, 'toggle-connectors', { icon: 'route' })}
      </div>
      <div class="insp-note">Use the mouse wheel to zoom, drag empty canvas or hold Space to pan. In 3D view, drag to orbit and Shift-drag to pan.</div>
    `)}
  `;
}

// ------------------------------------------------------------------- node
function nodeInspector(app, node) {
  const net = app.network;
  const incoming = net.incomingOf(node.id);
  const outgoing = net.outgoingOf(node.id);
  const controller = app.project.signalControllers.find((c) => c.phases.some((ph) => incoming.some((l) => ph.green?.includes(l.id))));
  const occupied = app.sim?.vehicles.filter((v) => incoming.some((l) => l.id === v.linkId) || outgoing.some((l) => l.id === v.linkId)).length || 0;
  return `
    ${header('node', node)}
    ${section('GEOMETRY', `
      ${textField('Name', 'name', node.name, { soft: true })}
      ${fieldPair(numField('X coordinate', 'x', node.x, { step: 0.1, hint: 'metres' }), numField('Y coordinate', 'y', node.y, { step: 0.1, hint: 'metres' }))}
      ${fieldPair(selectField('Type', 'type', node.type, ['junction', 'boundary', 'priority'], { soft: true }), selectField('Control', 'control', node.control, ['priority', 'signal', 'stop'], { soft: true }))}
      ${numField('Junction radius', 'radius', node.radius || 14, { min: 3, max: 80, step: 1, hint: 'metres' })}
    `)}
    ${section('CONNECTIONS', `
      ${statGrid([
        ['Incoming', fmtNum(incoming.length), 'links'],
        ['Outgoing', fmtNum(outgoing.length), 'links'],
        ['On approach', fmtNum(occupied), 'vehicles'],
        ['Controller', controller ? controller.id : '—', controller ? 'assigned' : 'none'],
      ])}
      <div class="chip-row">${incoming.map((l) => `<span class="chip">${icon('road')} ${l.id}</span>`).join('')}${outgoing.map((l) => `<span class="chip">${icon('arrowRight')} ${l.id}</span>`).join('')}</div>
      <div class="btn-row">
        ${btn('Focus', 'focus', { icon: 'target' })}
        ${btn(controller ? 'Edit signals' : 'Add signal control', 'node-controller', { icon: 'signal' })}
        ${btn('Delete junction', 'delete', { icon: 'trash', cls: 'btn danger small' })}
      </div>
      <div class="insp-note">Moving a junction updates the first and last geometry point of every connected link.</div>
    `)}
  `;
}

// ------------------------------------------------------------------- link
function linkInspector(app, link) {
  const net = app.network;
  const len = net.lengthOf(link.id);
  const inputs = app.project.inputs.filter((i) => i.linkId === link.id);
  const heads = app.project.signalHeads.filter((h) => h.linkId === link.id);
  const detectors = app.project.detectors.filter((d) => d.linkId === link.id);
  const crossings = app.project.crosswalks.filter((c) => c.linkId === link.id);
  const stats = app.sim?.evaluation.linkStats.get(link.id);
  const active = app.sim?.vehicles.filter((v) => v.linkId === link.id).length || 0;
  return `
    ${header('link', link)}
    ${section('GEOMETRY & CAPACITY', `
      ${textField('Name', 'name', link.name, { soft: true })}
      <div class="field-pair">
        <div class="field"><label>From</label><input class="inp" value="${esc(app.network.node(link.from)?.name || link.from)}" readonly /></div>
        <div class="field"><label>To</label><input class="inp" value="${esc(app.network.node(link.to)?.name || link.to)}" readonly /></div>
      </div>
      ${fieldPair(numField('Lanes', 'lanes', link.lanes, { min: 1, max: 8, step: 1 }), numField('Lane width', 'laneWidth', link.laneWidth || 3.4, { min: 2, max: 6, step: 0.1, hint: 'm' }))}
      ${fieldPair(numField('Speed limit', 'speed', link.speed, { min: 5, max: 160, step: 5, hint: 'km/h' }), numField('Priority', 'priority', link.priority, { min: 0, max: 10, step: 1 }))}
      ${selectField('Type', 'type', link.type, ['arterial', 'street', 'highway', 'ramp', 'connector'], { soft: true })}
      ${fieldPair(numField('Attraction', 'attraction', link.attraction ?? 1, { min: 0, max: 5, step: 0.1 }), numField('Grade', 'grade', link.grade || 0, { min: -15, max: 15, step: 0.5, hint: '%' }))}
      ${checkRow('Sidewalk', 'sidewalk', link.sidewalk !== false, { soft: true })}
      ${checkRow('Visible in plan', 'display', link.display !== false, { soft: true })}
    `)}
    ${section('OPERATIONS', `
      ${statGrid([
        ['Length', fmtDistance(len), ''],
        ['Active', fmtNum(active), 'veh'],
        ['Entered (win.)', fmtNum(stats?.enteredMeasured || 0), 'veh'],
        ['Exited (win.)', fmtNum(stats?.exitedMeasured || 0), 'veh'],
        ['Queue max', fmtNum(stats?.queueMax || 0), 'veh'],
        ['Free flow', fmtFixed(len / Math.max(2, net.speedMs(link.id)), 1), 's'],
      ])}
      <div class="chip-row">
        ${inputs.length ? inputs.map((i) => `<span class="chip" style="border-color:rgba(34,211,238,.3)">${icon('car')} ${i.id} · ${fmtNum(i.volume)}/h</span>`).join('') : '<span class="chip">No input</span>'}
        ${heads.length ? heads.map((h) => `<span class="chip" style="border-color:rgba(52,211,153,.3)">${icon('signal')} ${h.id}</span>`).join('') : ''}
      </div>
      <div class="btn-row">
        ${btn('Focus', 'focus', { icon: 'target' })}
        ${btn('Add input', 'link-input', { icon: 'car' })}
        ${btn('Signal head', 'link-signal', { icon: 'signal' })}
        ${btn('Detector', 'link-detector', { icon: 'detector' })}
        ${btn('Crossing', 'link-crosswalk', { icon: 'crosswalk' })}
      </div>
      <div class="btn-row">${btn('Duplicate link', 'duplicate', { icon: 'copy' })}${btn('Delete link', 'delete', { icon: 'trash', cls: 'btn danger small' })}</div>
      <div class="insp-note">${detectors.length} detector${detectors.length === 1 ? '' : 's'} · ${crossings.length} crossing${crossings.length === 1 ? '' : 's'} · ${link.points.length} geometry points. Double-click the link in plan view to add a waypoint.</div>
    `)}
  `;
}

// -------------------------------------------------------------- controller
function controllerInspector(app, controller) {
  const sys = app.sim?.signalSystem;
  const info = sys?.phaseInfoFor(controller.id);
  const cycle = controller.phases.reduce((s, ph) => s + (ph.duration || 0) + (ph.yellow || 0) + (ph.allRed || 0), 0);
  const windows = sys?.phaseWindows(controller) || [];
  const heads = app.project.signalHeads.filter((h) => h.controllerId === controller.id);
  const phaseCards = controller.phases.map((ph, i) => {
    const active = info?.phaseIndex === i;
    const greenLinks = app.project.links;
    return `<div class="phase-card ${active ? 'active' : ''}">
      <div class="phase-top">
        <span class="phase-num">${i + 1}</span>
        <b>${esc(ph.name || `Phase ${i + 1}`)}</b>
        <span class="phase-time">${fmtNum(ph.duration)}s + ${fmtNum(ph.yellow)}s</span>
        ${controller.phases.length > 1 ? `<button class="link-btn" style="color:var(--red)" data-iact="phase-delete" data-id="${controller.id}" data-index="${i}" title="Delete phase">${icon('trash')}</button>` : ''}
      </div>
      <div class="phase-visual">
        <span class="g" style="flex:${Math.max(0.1, ph.duration)}"></span>
        <span class="y" style="flex:${Math.max(0.1, ph.yellow)}"></span>
        <span class="r" style="flex:${Math.max(0.1, ph.allRed)}"></span>
      </div>
      <div style="margin-top:8px">
        ${textField('Phase name', 'name', ph.name, { scope: 'phase', phaseId: ph.id, soft: true })}
        ${fieldPair(numField('Green', 'duration', ph.duration, { scope: 'phase', phaseId: ph.id, min: 1, max: 240, step: 1, hint: 's' }), numField('Amber', 'yellow', ph.yellow, { scope: 'phase', phaseId: ph.id, min: 0, max: 20, step: 0.5, hint: 's' }))}
        ${fieldPair(numField('All red', 'allRed', ph.allRed, { scope: 'phase', phaseId: ph.id, min: 0, max: 20, step: 0.5, hint: 's' }), numField('Max green', 'maxGreen', ph.maxGreen ?? 45, { scope: 'phase', phaseId: ph.id, min: 1, max: 240, step: 1, hint: 'actuated' }))}
        ${numField('Min green', 'minGreen', ph.minGreen ?? 8, { scope: 'phase', phaseId: ph.id, min: 1, max: 120, step: 1, hint: 'actuated' })}
        ${checkRow('Pedestrian walk phase', 'ped', ph.ped === true, { scope: 'phase', phaseId: ph.id })}
        <div class="insp-section-title" style="margin-top:10px">Green link movements</div>
        <div class="phase-check-list">
          ${greenLinks.map((l) => `<label><input type="checkbox" data-scope="phase" data-path="green" data-phase-id="${ph.id}" data-green-link="${l.id}" ${(ph.green || []).includes(l.id) ? 'checked' : ''} /> ${esc(l.id)} · ${esc(l.name)}</label>`).join('')}
        </div>
      </div>
    </div>`;
  }).join('');

  return `
    ${header('controller', controller)}
    ${section('PLAN', `
      ${textField('Name', 'name', controller.name, { soft: true })}
      ${fieldPair(selectField('Mode', 'mode', controller.mode, [
        { value: 'fixed', label: 'Fixed-time' },
        { value: 'actuated', label: 'Vehicle actuated' },
      ]), numField('Offset', 'offset', controller.offset || 0, { min: 0, max: 600, step: 1, hint: 's' }))}
      ${checkRow('Coordinated plan', 'coordinated', controller.coordinated === true)}
      ${statGrid([
        ['Cycle', fmtNum(cycle), 'seconds'],
        ['Phases', fmtNum(controller.phases.length), ''],
        ['Heads', fmtNum(heads.length), 'controlled'],
        ['Live stage', info ? `${info.stage.toUpperCase()} · ${fmtNum(info.remaining)}s` : '—', ''],
      ])}
      <div class="te-bar" style="margin-top:10px">
        ${windows.map((w) => {
          const ph = w.phase;
          return `<span class="te-seg" style="flex:${Math.max(0.1, ph.duration)};background:#22c55e" title="Green ${ph.name}"></span>
            <span class="te-seg" style="flex:${Math.max(0.1, ph.yellow)};background:#f59e0b" title="Amber"></span>
            <span class="te-seg" style="flex:${Math.max(0.1, ph.allRed)};background:#334155;color:#94a3b8" title="All red"></span>`;
        }).join('')}
      </div>
      <div class="te-legend"><span>Cycle start</span><span>${fmtNum(cycle)}s</span></div>
    `)}
    ${section('PHASES', `<div class="phase-strip">${phaseCards}</div>
      <div class="btn-row">${btn('Add phase', 'phase-add', { icon: 'plus', cls: 'btn ghost small' })}${btn('Delete controller', 'delete', { icon: 'trash', cls: 'btn danger small' })}</div>
      <div class="insp-note">Fixed-time plans follow the cycle clock with the configured offset. Actuated plans extend green up to max green while demand is present and switch after a 3 s gap.</div>
    `)}
    ${section('LIVE SIGNALS', `
      <div class="live-signal-grid">
        ${heads.map((h) => {
          const st = app.signalStateFor(h.linkId) || 'red';
          return `<div class="live-signal"><i class="sig ${st === 'yellow' ? 'amber' : st}"></i><span>${esc(h.linkId)}</span><span style="margin-left:auto;color:${SIGNAL_COLORS[st] || '#64748b'}">${st.toUpperCase()}</span></div>`;
        }).join('') || '<div class="section-hint">No signal heads assigned.</div>'}
      </div>
    `)}
  `;
}

// ------------------------------------------------------------------- head
function headInspector(app, head) {
  const state = app.signalStateFor(head.linkId);
  const link = app.network.link(head.linkId);
  return `
    ${header('head', head)}
    ${section('SIGNAL HEAD', `
      ${textField('Name', 'name', head.name, { soft: true })}
      ${selectField('Controller', 'controllerId', head.controllerId, controllerOptions(app.project), { soft: true })}
      ${selectField('Link', 'linkId', head.linkId, linkOptions(app.project), { soft: true })}
      ${rangeField('Position on link', 'pos', Math.round((head.pos ?? 0.955) * 100), 50, 99.5, 0.5, '%', { scale: 0.01 })}
      ${selectField('Movement', 'movement', head.movement || 'all', [
        { value: 'all', label: 'All movements' },
        { value: 'through', label: 'Through only' },
        { value: 'left', label: 'Left turn only' },
        { value: 'right', label: 'Right turn only' },
      ], { soft: true })}
      <div class="field-row"><label>Live state</label><span class="badge ${state === 'green' ? 'green' : state === 'yellow' ? 'amber' : 'red'}">${esc(state || 'uncontrolled')}</span></div>
      ${link ? `<div class="insp-note">${esc(link.name)} · stop line at ${fmtDistance((head.pos ?? 0.955) * app.network.lengthOf(link.id))}.</div>` : ''}
      <div class="btn-row">${btn('Focus', 'focus', { icon: 'target' })}${btn('Delete head', 'delete', { icon: 'trash', cls: 'btn danger small' })}</div>
    `)}
  `;
}

// -------------------------------------------------------------- crosswalk
function crosswalkInspector(app, cw) {
  const rt = app.sim?.crosswalkRuntime.find((r) => r.cw.id === cw.id);
  const walking = app.sim ? app.sim.signalSystem.isPedWalk(cw) : true;
  return `
    ${header('crosswalk', cw)}
    ${section('CROSSING', `
      ${textField('Name', 'name', cw.name, { soft: true })}
      ${selectField('Link', 'linkId', cw.linkId, linkOptions(app.project), { soft: true })}
      ${rangeField('Position on link', 'pos', Math.round((cw.pos ?? 0.95) * 100), 2, 99, 0.5, '%', { scale: 0.01 })}
      ${fieldPair(numField('Width', 'width', cw.width, { min: 1.5, max: 20, step: 0.5, hint: 'm' }), numField('Ped flow', 'pedFlow', cw.pedFlow, { min: 0, max: 3000, step: 10, hint: 'p/h' }))}
      ${fieldPair(numField('Walking speed', 'speed', cw.speed, { min: 0.5, max: 3, step: 0.05, hint: 'm/s' }), selectField('Controller', 'controllerId', cw.controllerId || '', controllerOptions(app.project), { soft: true }))}
      ${statGrid([
        ['Walk signal', walking ? 'WALK' : 'WAIT', ''],
        ['Waiting', fmtNum(rt?.queue.length || 0), 'peds'],
        ['On crossing', fmtNum(app.sim?.peds.filter((p) => p.crosswalkId === cw.id).length || 0), 'peds'],
        ['Controller', cw.controllerId || 'uncontrolled', ''],
      ])}
      <div class="btn-row">${btn('Focus', 'focus', { icon: 'target' })}${btn('Delete crossing', 'delete', { icon: 'trash', cls: 'btn danger small' })}</div>
      <div class="insp-note">Vehicles yield at the crossing while pedestrians are on the carriageway. A linked signal controller provides a pedestrian walk interval.</div>
    `)}
  `;
}

// --------------------------------------------------------------- detector
function detectorInspector(app, d) {
  const stats = app.sim?.evaluation.detectorStats.get(d.id);
  const result = app.currentResults?.()?.detectors.find((x) => x.id === d.id);
  return `
    ${header('detector', d)}
    ${section('DETECTOR', `
      ${textField('Name', 'name', d.name, { soft: true })}
      ${selectField('Type', 'type', d.type || 'loop', [
        { value: 'loop', label: 'Inductive loop' },
        { value: 'radar', label: 'Radar' },
        { value: 'video', label: 'Video' },
      ], { soft: true })}
      ${selectField('Link', 'linkId', d.linkId, linkOptions(app.project), { soft: true })}
      ${fieldPair(numField('Lane', 'lane', d.lane, { min: 0, max: 7, step: 1, hint: '0-based' }), numField('Length', 'length', d.length, { min: 0.5, max: 20, step: 0.5, hint: 'm' }))}
      ${rangeField('Position on link', 'pos', Math.round((d.pos ?? 0.5) * 100), 1, 99, 0.5, '%', { scale: 0.01 })}
      ${statGrid([
        ['Count (win.)', fmtNum(stats?.countMeasured ?? result?.countMeasured ?? stats?.count ?? result?.count ?? 0), 'veh'],
        ['Flow', fmtFixed(result?.flow || 0, 0), 'veh/h'],
        ['Occupancy', fmtPct(result?.occupancy || 0, 1), ''],
        ['Type', d.type || 'loop', ''],
      ])}
      <div class="btn-row">${btn('Focus', 'focus', { icon: 'target' })}${btn('Delete detector', 'delete', { icon: 'trash', cls: 'btn danger small' })}</div>
    `)}
  `;
}

// ------------------------------------------------------------------ input
function inputInspector(app, input) {
  const classes = app.project.classes;
  const total = Object.values(input.composition || {}).reduce((s, v) => s + Number(v || 0), 0);
  const routes = [{ value: '', label: 'Automatic shortest path' }, ...app.project.routes.map((r) => ({ value: r.id, label: `${r.id} · ${r.name}` }))];
  return `
    ${header('input', input)}
    ${section('VEHICLE INPUT', `
      ${textField('Name', 'name', input.name, { soft: true })}
      ${selectField('Entry link', 'linkId', input.linkId, linkOptions(app.project), { soft: true })}
      ${fieldPair(numField('Volume', 'volume', input.volume, { min: 0, max: 6000, step: 10, hint: 'veh/h' }), selectField('Route', 'routeId', input.routeId || '', routes, { soft: true }))}
      ${fieldPair(numField('Active from', 'from', input.from, { min: 0, max: 86400, step: 10, hint: 's' }), numField('Active to', 'to', input.to, { min: 0, max: 86400, step: 10, hint: 's' }))}
      <div class="insp-note">Random arrivals use an exponential headway around ${fmtFixed(3600 / Math.max(1, input.volume), 1)} s. The input is disabled when the entry lane is occupied.</div>
    `)}
    ${section('COMPOSITION', `
      ${classes.map((c) => `<div class="field-row" style="margin-bottom:5px">
        <label><i class="swatch-dot" style="background:${esc(c.color)};margin-right:5px"></i>${esc(c.name)}</label>
        <input class="inp" style="width:74px;flex:0 0 74px" type="number" min="0" max="100" step="1"
          data-scope="composition" data-class-id="${c.id}" data-path="composition.${c.id}" data-dtype="number"
          value="${Number(input.composition?.[c.id] || 0)}" />
      </div>`).join('')}
      <div class="field-row" style="border-top:1px solid var(--line-soft);padding-top:7px"><label>Total share</label><span class="mono ${Math.abs(total - 100) > 0.5 ? 'text-amber' : 'text-green'}">${fmtNum(total)}%</span></div>
      <div class="btn-row">${btn('Focus', 'focus', { icon: 'target' })}${btn('Delete input', 'delete', { icon: 'trash', cls: 'btn danger small' })}</div>
      <div class="insp-note">Shares are relative weights; they do not need to sum to exactly 100%.</div>
    `)}
  `;
}

// ------------------------------------------------------------------ route
function routeInspector(app, route) {
  const chain = route.links || [];
  const warnings = [];
  for (let i = 1; i < chain.length; i++) {
    const a = app.network.link(chain[i - 1]);
    const b = app.network.link(chain[i]);
    if (a && b && a.to !== b.from) warnings.push(`${chain[i - 1]} does not connect to ${chain[i]}`);
  }
  const choices = linkOptions(app.project).filter((o) => !chain.includes(o.value));
  return `
    ${header('route', route)}
    ${section('ROUTE', `
      ${textField('Name', 'name', route.name, { soft: true })}
      ${colorField('Colour', 'color', route.color)}
      <div class="insp-section-title">Link sequence</div>
      <div class="phase-strip">
        ${chain.map((id, i) => {
          const link = app.project.links.find((l) => l.id === id);
          return `<div class="phase-card" style="padding:5px 7px">
            <div class="phase-top"><span class="phase-num">${i + 1}</span><b>${esc(id)}</b><span class="phase-time">${esc(link?.name || 'missing')}</span>
              <button class="link-btn" data-iact="route-down" data-id="${route.id}" data-index="${i}" title="Move down">↓</button>
              <button class="link-btn" data-iact="route-up" data-id="${route.id}" data-index="${i}" title="Move up">↑</button>
              <button class="link-btn" style="color:var(--red)" data-iact="route-remove" data-id="${route.id}" data-index="${i}">✕</button>
            </div>
          </div>`;
        }).join('') || '<div class="section-hint">No links in this route yet.</div>'}
      </div>
      <div class="field-row" style="margin-top:8px">
        <select class="inp" id="route-add-select" ${choices.length ? '' : 'disabled'}>
          ${choices.map((o) => `<option value="${o.value}">${esc(o.label)}</option>`).join('') || '<option>All links added</option>'}
        </select>
        <button class="btn ghost small" data-iact="route-add" data-id="${route.id}" ${choices.length ? '' : 'disabled'}>${icon('plus')} Add</button>
      </div>
      ${warnings.length ? `<div class="insp-note" style="color:var(--amber)">${warnings.map(esc).join('<br>')}</div>` : '<div class="insp-note">Consecutive links are connected.</div>'}
      <div class="btn-row">${btn('Focus first link', 'focus', { icon: 'target' })}${btn('Duplicate route', 'duplicate', { icon: 'copy' })}${btn('Delete route', 'delete', { icon: 'trash', cls: 'btn danger small' })}</div>
    `)}
  `;
}

// --------------------------------------------------------------------- pt
function ptInspector(app, line) {
  const route = line.route || [];
  const stops = line.stops || [];
  return `
    ${header('pt', line)}
    ${section('TRANSIT LINE', `
      ${textField('Name', 'name', line.name, { soft: true })}
      ${fieldPair(colorField('Colour', 'color', line.color), selectField('Class', 'classId', line.classId, app.project.classes.map((c) => ({ value: c.id, label: c.name })), { soft: true }))}
      ${fieldPair(numField('Headway', 'headway', line.headway, { min: 30, max: 3600, step: 10, hint: 'seconds' }), numField('Dwell time', 'dwell', line.dwell, { min: 0, max: 180, step: 1, hint: 'seconds' }))}
      <div class="insp-section-title">Route links</div>
      <div class="phase-strip">
        ${route.map((id, i) => `<div class="phase-card" style="padding:5px 7px"><div class="phase-top"><span class="phase-num">${i + 1}</span><b>${esc(id)}</b><span class="phase-time">${esc(app.network.link(id)?.name || 'missing')}</span>
          <button class="link-btn" data-iact="pt-route-down" data-id="${line.id}" data-index="${i}">↓</button>
          <button class="link-btn" data-iact="pt-route-up" data-id="${line.id}" data-index="${i}">↑</button>
          <button class="link-btn" style="color:var(--red)" data-iact="pt-route-remove" data-id="${line.id}" data-index="${i}">✕</button></div></div>`).join('') || '<div class="section-hint">Add links to define the line.</div>'}
      </div>
      <div class="field-row" style="margin-top:8px">
        <select class="inp" id="pt-add-link">
          ${app.project.links.filter((l) => !route.includes(l.id)).map((l) => `<option value="${l.id}">${esc(l.id)} · ${esc(l.name)}</option>`).join('') || '<option>All links added</option>'}
        </select>
        <button class="btn ghost small" data-iact="pt-add-link" data-id="${line.id}">${icon('plus')} Add</button>
      </div>
    `)}
    ${section('STOPS', `
      ${stops.map((st, i) => `<div class="phase-card" style="margin-bottom:5px">
        <div class="phase-top"><span class="phase-num">${i + 1}</span><b>${esc(st.name || `Stop ${i + 1}`)}</b>
          <button class="link-btn" style="color:var(--red)" data-iact="pt-stop-remove" data-id="${line.id}" data-index="${i}">✕</button></div>
        <div class="field-pair" style="margin-top:6px">
          <div class="field"><label>Name</label><input class="inp" data-scope="ptstop" data-path="name" data-index="${i}" data-dtype="text" value="${esc(st.name || '')}" /></div>
          <div class="field"><label>Link</label><select class="inp" data-scope="ptstop" data-path="linkId" data-index="${i}" data-dtype="text">${app.project.links.map((l) => `<option value="${l.id}" ${l.id === st.linkId ? 'selected' : ''}>${esc(l.id)}</option>`).join('')}</select></div>
        </div>
        <div class="range-row"><input type="range" data-scope="ptstop" data-path="pos" data-index="${i}" data-dtype="number" data-scale="0.01" data-live="1" min="2" max="98" step="0.5" value="${Math.round((st.pos ?? 0.5) * 100)}" /><span class="range-val">${Math.round((st.pos ?? 0.5) * 100)}%</span></div>
      </div>`).join('') || '<div class="section-hint">No stops. Buses will run through without dwelling.</div>'}
      <div class="btn-row">
        ${btn('Add stop', 'pt-add-stop', { icon: 'plus' })}
        ${btn('Focus', 'focus', { icon: 'target' })}
        ${btn('Delete line', 'delete', { icon: 'trash', cls: 'btn danger small' })}
      </div>
    `)}
  `;
}

// ------------------------------------------------------------------ class
function classInspector(app, cls) {
  const cs = app.sim?.evaluation.classStats.get(cls.id);
  const result = app.currentResults?.()?.classes.find((c) => c.id === cls.id);
  return `
    ${header('class', cls)}
    ${section('VEHICLE CLASS', `
      ${textField('Name', 'name', cls.name, { soft: true })}
      ${fieldPair(selectField('Category', 'category', cls.category, ['car', 'truck', 'bus', 'moto', 'bike'], { soft: true }), colorField('Colour', 'color', cls.color))}
      ${fieldPair(numField('Length', 'length', cls.length, { min: 0.5, max: 30, step: 0.1, hint: 'm' }), numField('Width', 'width', cls.width, { min: 0.3, max: 3.5, step: 0.05, hint: 'm' }))}
      ${fieldPair(numField('Height', 'height', cls.height, { min: 0.5, max: 5, step: 0.05, hint: 'm' }), numField('Max speed', 'maxSpeed', cls.maxSpeed, { min: 5, max: 200, step: 1, hint: 'km/h' }))}
      ${fieldPair(numField('Acceleration', 'accel', cls.accel, { min: 0.1, max: 8, step: 0.1, hint: 'm/s²' }), numField('Deceleration', 'decel', cls.decel, { min: 0.1, max: 10, step: 0.1, hint: 'm/s²' }))}
      ${fieldPair(numField('Minimum gap', 'minGap', cls.minGap, { min: 0.2, max: 10, step: 0.1, hint: 'm' }), numField('Headway', 'headway', cls.headway, { min: 0.3, max: 4, step: 0.05, hint: 's' }))}
      ${fieldPair(numField('Reaction', 'reaction', cls.reaction, { min: 0.2, max: 3, step: 0.05, hint: 's' }), selectField('Behaviour', 'behavior', cls.behavior, ['normal', 'cautious', 'aggressive'], { soft: true }))}
      ${numField('Assignment weight', 'weight', cls.weight, { min: 0, max: 10, step: 0.1 })}
    `)}
    ${section('OBSERVED', `
      ${statGrid([
        ['Spawned (win.)', fmtNum(result?.spawnedMeasured ?? cs?.spawnedMeasured ?? 0), 'veh'],
        ['Completed (win.)', fmtNum(result?.completed ?? cs?.completed ?? 0), 'trips'],
        ['Mean delay', fmtFixed(result?.avgDelay || 0, 1), 's'],
        ['Mean speed', fmtFixed(result?.avgSpeed || 0, 1), 'km/h'],
      ])}
      <div class="btn-row">${btn('Duplicate class', 'duplicate', { icon: 'copy' })}${btn('Delete class', 'delete', { icon: 'trash', cls: 'btn danger small' })}</div>
      ${app.project.classes.length <= 1 ? '<div class="insp-note" style="color:var(--amber)">At least one vehicle class is recommended.</div>' : ''}
    `)}
  `;
}

// -------------------------------------------------------------------- run
function runInspector(app, run) {
  const r = run.results;
  const s = r.summary;
  return `
    ${header('run', { name: run.name, id: run.id })}
    ${section('SUMMARY', `
      ${statGrid([
        ['Completed (win.)', fmtNum(s.completedMeasured), 'trips'],
        ['Throughput', fmtNum(s.throughput), 'veh/h'],
        ['Mean delay', fmtFixed(s.avgDelay, 1), 's'],
        ['Mean speed', fmtFixed(s.avgSpeed, 1), 'km/h'],
        ['Max queue', fmtNum(s.maxQueue), 'veh'],
        ['CO₂', fmtFixed(s.co2, 1), 'kg'],
      ])}
      <div class="btn-row">${btn('Open evaluation', 'run-open', { icon: 'chart' })}${btn('Compare', 'run-compare', { icon: 'layers' })}${btn('Delete run', 'run-delete', { icon: 'trash', cls: 'btn danger small' })}</div>
      <div class="insp-note">Seed ${esc(r.seed)} · ${fmtClock(r.duration)} run · ${esc(r.runAt ? new Date(r.runAt).toLocaleString() : '')}</div>
    `)}
  `;
}

// ------------------------------------------------------------------- multi
function multiInspector(app) {
  const items = app.selection.items || [];
  return `
    <div class="insp-section">
      <div class="insp-type"><div class="type-ic">${icon('layers')}</div><div><b>${items.length} objects selected</b><small>MULTI-SELECTION</small></div></div>
      <div class="phase-strip" style="max-height:260px;overflow:auto">
        ${items.slice(0, 80).map((it) => {
          const ent = app.findEntity(it.type, it.id);
          return `<div class="phase-card" style="padding:5px 7px"><div class="phase-top"><span class="phase-num">${esc((TYPE_META[it.type]?.label || it.type).slice(0, 1))}</span><b>${esc(ent?.name || it.id)}</b><span class="phase-time">${esc(it.type)}</span></div></div>`;
        }).join('')}
      </div>
      ${items.length > 80 ? `<div class="insp-note">Showing the first 80 of ${items.length} objects.</div>` : ''}
      <div class="btn-row">${btn('Duplicate all', 'duplicate', { icon: 'copy' })}${btn('Delete all', 'delete', { icon: 'trash', cls: 'btn danger small' })}${btn('Clear', 'deselect', { icon: 'close' })}</div>
    </div>
  `;
}
