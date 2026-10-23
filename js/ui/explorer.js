import { icon } from '../icons.js';
import { escapeHtml as esc, fmtClock, fmtNum } from '../core/utils.js';

const TYPE_ICON = {
  node: 'node', link: 'road', controller: 'controller', head: 'signal',
  crosswalk: 'crosswalk', detector: 'detector', input: 'car', route: 'route',
  pt: 'bus', class: 'car', run: 'chart',
};

const MODE_LABEL = {
  network: 'Network',
  demand: 'Demand & routing',
  control: 'Signal control',
  evaluation: 'Evaluation',
  '3d': '3D city',
};

/** Build the left-hand project explorer. */
export function renderExplorer(app) {
  const p = app.project;
  const query = (app.explorerQuery || '').trim().toLowerCase();
  const mode = app.mode;
  const groups = [];

  const item = (type, entity, meta) => {
    const active = app.isSelected?.(type, entity.id) ? ' active' : '';
    const name = entity.name || entity.id;
    return `<button class="tree-item${active}" data-select-type="${esc(type)}" data-select-id="${esc(entity.id)}" data-focus="${esc(entity.id)}" title="${esc(name)}${meta ? ` · ${esc(meta)}` : ''}">
      <span class="ic">${icon(TYPE_ICON[type] || 'info')}</span>
      <span class="name">${esc(name)}</span>
      <span class="meta">${esc(meta || entity.id)}</span>
    </button>`;
  };

  const group = (key, label, iconName, items, metaFn, emptyText, extra = '') => {
    if (query && !label.toLowerCase().includes(query) && !items.some((x) => matchEntity(x, query, metaFn))) return;
    const visible = items.filter((x) => !query || matchEntity(x, query, metaFn) || label.toLowerCase().includes(query));
    const collapsed = app.ui.collapsed?.includes(key);
    groups.push(`<div class="tree-group${collapsed ? ' collapsed' : ''}" data-group="${esc(key)}">
      <button class="tree-label" data-tree-toggle="${esc(key)}">
        <span class="chev">${icon('chevronDown')}</span>
        <span class="ic">${icon(iconName)}</span>
        <span>${esc(label)}</span>
        <span class="count">${items.length}</span>
      </button>
      <div class="tree-items">
        ${visible.length ? visible.map((x) => item(...metaFn(x))).join('') : `<div class="section-hint">${esc(emptyText || 'No objects yet.')}</div>`}
        ${extra}
      </div>
    </div>`);
  };

  if (mode === 'evaluation') {
    const runs = app.runs || [];
    group('runs', 'Recorded runs', 'chart', runs,
      (r) => ['run', { id: r.id, name: r.name }, `${fmtNum(r.results?.summary?.throughput || 0)}/h`],
      'Run the model or start a batch to record results.');
    groups.push(`<div class="explorer-note"><b>Evaluation workspace</b>Open the full dashboard for KPIs, time series, link and class performance.</div>`);
  } else if (mode === 'demand') {
    group('inputs', 'Vehicle inputs', 'car', p.inputs,
      (i) => ['input', i, `${fmtNum(i.volume)}/h`], 'No vehicle inputs. Select a link to add one.');
    group('routes', 'Routes', 'route', p.routes,
      (r) => ['route', r, `${(r.links || []).length} links`], 'No explicit routes. Vehicles use shortest paths.');
    group('pt', 'Transit lines', 'bus', p.ptLines || [],
      (l) => ['pt', l, `${fmtNum(l.headway)}s`], 'No transit lines.');
    group('classes', 'Vehicle classes', 'layers', p.classes,
      (c) => ['class', c, c.category], 'No classes defined.');
  } else if (mode === 'control') {
    group('controllers', 'Signal controllers', 'controller', p.signalControllers,
      (c) => ['controller', c, `${c.mode} · ${cycleOf(c)}s`], 'No signal controllers. Use the Signal tool (G) on a junction.');
    group('heads', 'Signal heads', 'signal', p.signalHeads,
      (h) => ['head', h, h.linkId], 'No signal heads placed.');
    group('crossings', 'Pedestrian crossings', 'crosswalk', p.crosswalks,
      (c) => ['crosswalk', c, c.controllerId || 'uncontrolled'], 'No pedestrian crossings.');
  } else if (mode === '3d') {
    group('links', 'Road network', 'road', p.links,
      (l) => ['link', l, `${l.lanes} ln`], 'No roads to render.');
    group('controllers', 'Signal systems', 'controller', p.signalControllers,
      (c) => ['controller', c, c.mode], 'No signal controllers.');
    group('pt', 'Transit lines', 'bus', p.ptLines || [],
      (l) => ['pt', l, `${fmtNum(l.headway)}s`], 'No transit lines.');
    groups.push(`<div class="explorer-note"><b>Procedural city view</b>Buildings, trees and street furniture are generated deterministically from the road geometry.</div>`);
  } else {
    group('nodes', 'Junctions', 'node', p.nodes,
      (n) => ['node', n, n.type === 'boundary' ? 'boundary' : `${n.incoming || ''}${nodeDegree(app, n.id)} arms`], 'No junctions. Use the Junction tool (N).');
    group('links', 'Links', 'road', p.links,
      (l) => ['link', l, `${l.lanes} ln · ${l.speed}`], 'No links. Use the Link tool (L), then click twice.');
    group('controllers', 'Signal control', 'controller', p.signalControllers,
      (c) => ['controller', c, `${c.mode} · ${cycleOf(c)}s`], 'No controllers.');
    group('heads', 'Signal heads', 'signal', p.signalHeads,
      (h) => ['head', h, h.linkId], 'No signal heads.');
    group('crossings', 'Crossings', 'crosswalk', p.crosswalks,
      (c) => ['crosswalk', c, c.controllerId || 'uncontrolled'], 'No crossings.');
    group('detectors', 'Detectors', 'detector', p.detectors,
      (d) => ['detector', d, `${d.linkId} · L${(d.lane ?? 0) + 1}`], 'No detectors.');
  }

  if (!p.links.length && mode !== 'evaluation') {
    groups.unshift(`<div class="explorer-note"><b>Empty project</b>Draw two junctions with the Link tool, or load the Riverside demo from File → Load demo network.</div>`);
  }

  const result = groups.join('');
  if (query && !result) {
    return `<div class="explorer-empty">No objects match “${esc(app.explorerQuery)}”.</div>`;
  }
  return result;
}

export function explorerTitle(mode) {
  return MODE_LABEL[mode] || 'Network';
}

function cycleOf(controller) {
  return Math.round((controller.phases || []).reduce((s, ph) => s + (ph.duration || 0) + (ph.yellow || 0) + (ph.allRed || 0), 0));
}

function nodeDegree(app, nodeId) {
  return app.project.links.filter((l) => l.from === nodeId || l.to === nodeId).length;
}

function matchEntity(entity, query, metaFn) {
  if (!entity || typeof entity !== 'object') return false;
  const [, , meta] = metaFn(entity);
  return `${entity.id || ''} ${entity.name || ''} ${meta || ''}`.toLowerCase().includes(query);
}

export function searchPlaceholder(mode) {
  switch (mode) {
    case 'demand': return 'Filter demand objects…';
    case 'control': return 'Filter controllers and heads…';
    case 'evaluation': return 'Filter recorded runs…';
    case '3d': return 'Filter scene objects…';
    default: return 'Filter network objects…';
  }
}

/** Small helper used by the status bar. */
export function modeFootnote(app) {
  const p = app.project;
  const run = app.sim ? fmtClock(app.sim.t) : '0:00';
  return `${p.links.length} links · ${p.nodes.length} nodes · ${run}`;
}
