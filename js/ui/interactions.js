import { closeModal, showAbout, showBatch, showFeatures, showNewProject, showQuickstart, showShortcuts, showValidation } from './dialogs.js';
import { exportProjectFile, exportResultsCsv, pickProjectFile, printReport } from './fileops.js';
import { makeDetector, makeInput, makeCrosswalk, nextPhaseId, nextEntityId } from '../core/project.js';
import { fmtNum } from '../core/utils.js';

/** Wire all DOM events that are not owned by the editor canvas. */
export function installInteractions(app) {
  const $ = (sel) => document.querySelector(sel);

  // ------------------------------------------------------------- menu bar
  document.querySelectorAll('.menu').forEach((menu) => {
    menu.querySelector('.menu-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = menu.classList.contains('open');
      document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
      if (!open) menu.classList.add('open');
    });
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu')) document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
  });

  // --------------------------------------------------------------- modes
  document.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => app.setMode(btn.dataset.mode));
  });
  document.querySelectorAll('[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => app.setTool(btn.dataset.tool));
  });
  $('#btn-2d')?.addEventListener('click', () => app.setMode('network'));
  $('#btn-3d')?.addEventListener('click', () => app.setMode('3d'));
  $('#btn-canvas-3d')?.addEventListener('click', () => app.setMode(app.mode === '3d' ? 'network' : '3d'));
  $('#btn-fit')?.addEventListener('click', () => app.editor.fit());
  $('#btn-fit-float')?.addEventListener('click', () => { app.setMode(app.mode === '3d' ? '3d' : 'network', { silent: true }); app.editor.fit(); });
  $('#btn-zoom-in')?.addEventListener('click', () => app.editor.zoomIn());
  $('#btn-zoom-out')?.addEventListener('click', () => app.editor.zoomOut());
  $('#btn-canvas-grid')?.addEventListener('click', () => toggleDisplay(app, 'grid'));
  $('#brand-home')?.addEventListener('click', () => {
    app.clearSelection();
    app.setMode('network');
    app.editor.fit();
    app.toast('Project', `${app.project.meta.name} · ${app.project.links.length} links`, 'info');
  });

  // ------------------------------------------------------------- project
  const title = $('#project-name');
  title?.addEventListener('change', () => {
    const name = title.value.trim() || 'Untitled Network';
    if (name === app.project.meta.name) return;
    app.checkpoint('Rename project');
    app.project.meta.name = name;
    title.value = name;
    document.title = `${name} · TRAFFIX STUDIO`;
    app.afterFieldChange({ structural: false, refreshExplorer: false });
  });
  title?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') title.blur();
    if (e.key === 'Escape') { title.value = app.project.meta.name; title.blur(); }
  });

  $('#speed-select')?.addEventListener('change', (e) => {
    app.speed = Math.max(0.5, Number(e.target.value) || 1);
    app.ui.speed = app.speed;
    app.persistUi();
    app.updateHud();
  });

  // -------------------------------------------------------------- search
  const search = $('#search-input');
  search?.addEventListener('input', () => {
    app.explorerQuery = search.value;
    app.renderExplorer();
  });
  search?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { search.value = ''; app.explorerQuery = ''; app.renderExplorer(); search.blur(); }
  });

  // ------------------------------------------------------------- explorer
  const explorer = $('#explorer');
  explorer?.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-tree-toggle]');
    if (toggle) {
      const key = toggle.dataset.treeToggle;
      const set = new Set(app.ui.collapsed || []);
      if (set.has(key)) set.delete(key); else set.add(key);
      app.ui.collapsed = [...set];
      app.persistUi();
      app.renderExplorer();
      return;
    }
    const row = e.target.closest('[data-select-type]');
    if (!row) return;
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    app.select(row.dataset.selectType, row.dataset.selectId, additive);
  });
  explorer?.addEventListener('dblclick', (e) => {
    const row = e.target.closest('[data-select-type]');
    if (!row) return;
    app.focusEntity(row.dataset.selectType, row.dataset.selectId);
  });

  // ------------------------------------------------------------- timeline
  const track = $('#tl-track');
  const scrub = (e) => {
    if (app.mode === '3d') app.setMode('network', { silent: true });
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    app.scrubTo(ratio * (app.project.settings.duration || 900));
  };
  track?.addEventListener('pointerdown', (e) => {
    track.setPointerCapture?.(e.pointerId);
    track.dataset.scrubbing = '1';
  });
  track?.addEventListener('pointerup', (e) => {
    if (track.dataset.scrubbing !== '1') return;
    delete track.dataset.scrubbing;
    scrub(e);
  });

  // ------------------------------------------------------------- inspector
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-iact]');
    if (!btn) return;
    e.preventDefault();
    handleInspectorAction(app, btn.dataset.iact, {
      id: btn.dataset.id,
      index: btn.dataset.index !== undefined ? Number(btn.dataset.index) : undefined,
      el: btn,
    });
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('input[type="range"][data-path]')) return; // handled by input + final change below
    if (el.matches('[data-path], [data-green-link]')) handleFieldEdit(app, el, true);
  });
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.matches('input[type="range"][data-path]')) handleFieldEdit(app, el, false);
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('input[type="range"][data-path]')) handleFieldEdit(app, el, true);
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.matches('[data-path]')) app._liveFieldKey = null;
  });

  // ---------------------------------------------------------------- file
  const fileInput = $('#file-input');
  fileInput?.addEventListener('change', async () => {
    await app.handleFile(fileInput.files?.[0]);
  });

  // ----------------------------------------------------------- analysis
  const analysis = $('#analysis-overlay');
  const tabs = $('#analysis-tabs');
  tabs?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-atab]');
    if (!btn) return;
    app.analysisTab = btn.dataset.atab;
    app.refreshAnalysis();
  });
  $('#btn-close-analysis')?.addEventListener('click', () => app.closeAnalysis());
  analysis?.addEventListener('click', (e) => {
    if (e.target === analysis) app.closeAnalysis();
    const chip = e.target.closest('[data-arun]');
    if (chip) {
      app.analysisRunId = chip.dataset.arun;
      app.refreshAnalysis();
    }
  });

  // --------------------------------------------------------- side actions
  $('#btn-add-context')?.addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    app.showAddMenu(r.right + 6, r.bottom + 4);
  });
  $('#btn-inspector-more')?.addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    app.showInspectorMenu(r.left - 150, r.bottom + 4);
  });

  // -------------------------------------------------------- global action
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.tagName === 'BUTTON' && el.disabled) return;
    const action = el.dataset.action;
    if (!action) return;
    e.preventDefault();
    document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
    runAction(app, action, el);
  });
}

function toggleDisplay(app, key) {
  if (key === 'grid') { app.editor.toggleGrid(); app.ui.grid = app.editor.grid; }
  if (key === 'labels') { app.editor.toggleLabels(); app.ui.labels = app.editor.labels; }
  if (key === 'connectors') { app.editor.toggleConnectors(); app.ui.connectors = app.editor.connectors; }
  app.persistUi();
  app.refreshPanels(false);
}

function runAction(app, action, el) {
  switch (action) {
    case 'new-project': showNewProject(app); break;
    case 'open-project': pickProjectFile(app, 'project'); break;
    case 'import-geojson': pickProjectFile(app, 'geojson'); break;
    case 'save-project': app.saveProjectToStorage(true); break;
    case 'load-demo': closeModal(app); app.loadDemo(); break;
    case 'export-project': exportProjectFile(app); break;
    case 'export-results': exportResultsCsv(app); break;
    case 'print-report': printReport(app); break;
    case 'undo': app.undo(); break;
    case 'redo': app.redo(); break;
    case 'duplicate': app.duplicateSelection(); break;
    case 'delete': app.deleteSelection(); break;
    case 'select-all': app.selectAll(); break;
    case 'deselect': app.clearSelection(); break;
    case 'fit': app.editor.fit(); break;
    case 'toggle-grid': toggleDisplay(app, 'grid'); break;
    case 'toggle-labels': toggleDisplay(app, 'labels'); break;
    case 'toggle-connectors': toggleDisplay(app, 'connectors'); break;
    case 'mode-3d': app.setMode('3d'); break;
    case 'show-shortcuts': showShortcuts(app); break;
    case 'show-quickstart': showQuickstart(app); break;
    case 'show-features': showFeatures(app); break;
    case 'show-about': showAbout(app); break;
    case 'toggle-play': app.togglePlay(); break;
    case 'step': app.stepSim(); break;
    case 'reset-sim': app.resetSimulation(); break;
    case 'batch': closeModal(app); showBatch(app); break;
    case 'open-analysis': app.openAnalysis('overview'); break;
    case 'check-model': showValidation(app); break;
    default: console.warn('Unknown action', action, el);
  }
}

// ------------------------------------------------------------------ fields
function handleFieldEdit(app, el, final) {
  if (el.dataset.greenLink) {
    const phase = resolveTarget(app, el);
    if (!phase) return;
    const linkId = el.dataset.greenLink;
    if (final) {
      app.checkpoint(`Edit ${phase.name || 'phase'} movements`);
      const set = new Set(phase.green || []);
      if (el.checked) set.add(linkId); else set.delete(linkId);
      phase.green = [...set];
      app.afterFieldChange({ structural: true });
    }
    return;
  }

  const path = el.dataset.path;
  if (!path) return;
  const scope = el.dataset.scope || 'entity';
  const target = resolveTarget(app, el);
  if (!target) return;

  const isRange = el.type === 'range';
  const key = `${scope}:${target.id || 'project'}:${el.dataset.phaseId || ''}:${el.dataset.index ?? ''}:${path}`;
  if (isRange && !final) {
    if (app._liveFieldKey !== key) {
      app.checkpoint(`Edit ${labelFor(el)}`);
      app._liveFieldKey = key;
    }
  } else if (final && (!isRange || app._liveFieldKey !== key)) {
    app.checkpoint(`Edit ${labelFor(el)}`);
  }

  const dtype = el.dataset.dtype || 'text';
  let value;
  if (el.type === 'checkbox') value = el.checked;
  else if (dtype === 'number') {
    const scale = Number(el.dataset.scale || 1);
    let numeric = Number(el.value);
    if (!Number.isFinite(numeric)) return;
    if (final) {
      const min = el.min === '' ? -Infinity : Number(el.min);
      const max = el.max === '' ? Infinity : Number(el.max);
      if (Number.isFinite(min)) numeric = Math.max(min, numeric);
      if (Number.isFinite(max)) numeric = Math.min(max, numeric);
      if (el.value !== '' && Number(el.value) !== numeric) el.value = String(numeric);
    }
    value = numeric * scale;
  } else value = el.value;

  setPath(target, path, value);
  if (isRange) {
    const out = el.closest('.range-row')?.querySelector('.range-val');
    if (out) out.textContent = `${el.value}%`;
  }
  if (scope === 'entity' && app.selection?.type === 'node' && (path === 'x' || path === 'y')) {
    app.syncNodeGeometry(target);
  }

  app.afterFieldChange({
    structural: app.fieldIsStructural(scope, path),
    live: !final,
    field: el,
  });
  if (final) app._liveFieldKey = null;
}

function resolveTarget(app, el) {
  const scope = el.dataset.scope || 'entity';
  if (scope === 'project') return app.project;
  if (scope === 'phase') {
    const selected = app.selection?.type === 'controller' ? app.findEntity('controller', app.selection.id) : null;
    const controller = selected || app.project.signalControllers.find((c) => (c.phases || []).some((ph) => ph.id === el.dataset.phaseId));
    return controller?.phases.find((ph) => ph.id === el.dataset.phaseId) || null;
  }
  if (scope === 'composition') {
    return app.selection?.type === 'input' ? app.findEntity('input', app.selection.id) : null;
  }
  if (scope === 'ptstop') {
    const line = app.selection?.type === 'pt' ? app.findEntity('pt', app.selection.id) : null;
    return line?.stops?.[Number(el.dataset.index)] || null;
  }
  if (app.selection?.type === 'multi' || !app.selection) return null;
  return app.findEntity(app.selection.type, app.selection.id);
}

function setPath(obj, path, value) {
  if (!obj) return;
  const parts = path.split('.');
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cursor[parts[i]] || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
}

function labelFor(el) {
  return el.closest('.field')?.querySelector('label')?.textContent?.trim()
    || el.closest('.field-row')?.querySelector('label')?.textContent?.trim()
    || el.dataset.path || 'property';
}

// ------------------------------------------------------------- inspector acts
function handleInspectorAction(app, act, data) {
  const sel = app.selection;
  switch (act) {
    case 'focus': {
      if (!sel || sel.type === 'multi') return;
      app.focusEntity(sel.type, sel.id);
      return;
    }
    case 'delete': app.deleteSelection(); return;
    case 'duplicate': app.duplicateSelection(); return;
    case 'deselect': app.clearSelection(); return;
    case 'fit': app.editor.fit(); return;
    case 'validate': showValidation(app); return;
    case 'analysis': app.openAnalysis('overview'); return;
    case 'toggle-grid': toggleDisplay(app, 'grid'); return;
    case 'toggle-labels': toggleDisplay(app, 'labels'); return;
    case 'toggle-connectors': toggleDisplay(app, 'connectors'); return;
    case 'node-controller': {
      if (sel?.type !== 'node') return;
      app.editor._createControllerForNode(sel.id);
      return;
    }
    case 'link-input': {
      const link = selectedLink(app);
      if (!link) return;
      app.checkpoint('Add vehicle input');
      const input = makeInput(app.project, link.id);
      app.project.inputs.push(input);
      app.afterGeometryChange({ select: { type: 'input', id: input.id }, resetSim: true });
      app.toast('Demand', `${input.name} added to ${link.name}.`, 'success');
      return;
    }
    case 'link-signal': {
      const link = selectedLink(app);
      if (!link) return;
      app.editor._createSignal(link, 0.955);
      return;
    }
    case 'link-detector': {
      const link = selectedLink(app);
      if (!link) return;
      app.editor._createDetector(link, 0.7, 0);
      return;
    }
    case 'link-crosswalk': {
      const link = selectedLink(app);
      if (!link) return;
      app.editor._createCrosswalk(link, 0.82);
      return;
    }
    case 'phase-add': {
      const controller = data.id ? app.findEntity('controller', data.id) : (sel?.type === 'controller' ? app.findEntity('controller', sel.id) : null);
      if (!controller) return;
      app.checkpoint('Add signal phase');
      const id = nextPhaseId(controller);
      const incoming = app.network.incomingOf(app.project.nodes.find((n) => (controller.phases || []).some((ph) => (ph.green || []).some((lid) => app.network.link(lid)?.to === n.id)))?.id) || [];
      controller.phases.push({
        id, name: `Phase ${controller.phases.length + 1}`, duration: 20, yellow: 3, allRed: 1,
        green: incoming.map((l) => l.id).filter((lid) => !controller.phases.some((ph) => ph.green?.includes(lid))),
        ped: false, minGreen: 8, maxGreen: 40,
      });
      app.afterFieldChange({ structural: true });
      app.toast('Signal control', 'Phase added. Assign green movements in the inspector.', 'success');
      return;
    }
    case 'phase-delete': {
      const controller = data.id ? app.findEntity('controller', data.id) : null;
      if (!controller || controller.phases.length <= 1) return;
      app.checkpoint('Delete signal phase');
      controller.phases.splice(data.index, 1);
      app.afterFieldChange({ structural: true });
      return;
    }
    case 'route-add': {
      if (sel?.type !== 'route') return;
      const route = app.findEntity('route', sel.id);
      const linkId = document.getElementById('route-add-select')?.value;
      if (!route || !linkId || route.links.includes(linkId)) return;
      app.checkpoint('Add link to route');
      route.links.push(linkId);
      app.afterFieldChange({ structural: true, refreshExplorer: false });
      return;
    }
    case 'route-up': return moveItem(app, sel, 'links', data.index, -1, 'Move route link');
    case 'route-down': return moveItem(app, sel, 'links', data.index, 1, 'Move route link');
    case 'route-remove': {
      if (sel?.type !== 'route') return;
      const route = app.findEntity('route', sel.id);
      if (!route) return;
      app.checkpoint('Remove route link');
      route.links.splice(data.index, 1);
      app.afterFieldChange({ structural: true, refreshExplorer: false });
      return;
    }
    case 'pt-add-link': {
      if (sel?.type !== 'pt') return;
      const line = app.findEntity('pt', sel.id);
      const linkId = document.getElementById('pt-add-link')?.value;
      if (!line || !linkId || line.route.includes(linkId)) return;
      app.checkpoint('Add link to transit line');
      line.route.push(linkId);
      app.afterFieldChange({ structural: true, refreshExplorer: false });
      return;
    }
    case 'pt-route-up': return moveItem(app, sel, 'route', data.index, -1, 'Move transit link');
    case 'pt-route-down': return moveItem(app, sel, 'route', data.index, 1, 'Move transit link');
    case 'pt-route-remove': {
      if (sel?.type !== 'pt') return;
      const line = app.findEntity('pt', sel.id);
      if (!line) return;
      app.checkpoint('Remove transit link');
      line.route.splice(data.index, 1);
      app.afterFieldChange({ structural: true, refreshExplorer: false });
      return;
    }
    case 'pt-add-stop': {
      if (sel?.type !== 'pt') return;
      const line = app.findEntity('pt', sel.id);
      if (!line) return;
      const linkId = line.route[line.route.length - 1] || line.stops[line.stops.length - 1]?.linkId || app.project.links[0]?.id;
      if (!linkId) { app.toast('Transit', 'Add a link to the line before adding a stop.', 'warn'); return; }
      app.checkpoint('Add transit stop');
      line.stops.push({ linkId, pos: 0.5, name: `Stop ${line.stops.length + 1}` });
      app.afterFieldChange({ structural: true, refreshExplorer: false });
      return;
    }
    case 'pt-stop-remove': {
      if (sel?.type !== 'pt') return;
      const line = app.findEntity('pt', sel.id);
      if (!line) return;
      app.checkpoint('Remove transit stop');
      line.stops.splice(data.index, 1);
      app.afterFieldChange({ structural: true, refreshExplorer: false });
      return;
    }
    case 'run-open': {
      if (sel?.type !== 'run') return;
      app.analysisRunId = sel.id;
      app.openAnalysis('overview');
      return;
    }
    case 'run-compare': app.openAnalysis('compare'); return;
    case 'run-delete': {
      if (sel?.type !== 'run') return;
      app.deleteRun(sel.id);
      return;
    }
    default: console.warn('Unknown inspector action', act);
  }
}

function selectedLink(app) {
  return app.selection?.type === 'link' ? app.findEntity('link', app.selection.id) : null;
}

function moveItem(app, sel, field, index, direction, label) {
  if (!sel || !['route', 'pt'].includes(sel.type)) return;
  const entity = app.findEntity(sel.type, sel.id);
  if (!entity?.[field]) return;
  const next = index + direction;
  if (next < 0 || next >= entity[field].length) return;
  app.checkpoint(label);
  [entity[field][index], entity[field][next]] = [entity[field][next], entity[field][index]];
  app.afterFieldChange({ structural: true, refreshExplorer: false });
}

/** Called by the keyboard layer for add-menu type actions. */
export function addNodeAt(app, x, y) {
  app.editor._createNode(x, y);
}

export function newRouteForSelection(app) {
  app.checkpoint('New route');
  const sel = app.selection?.type === 'link' ? app.selection.id : null;
  const route = {
    id: nextEntityId(app.project, 'routes', 'R'),
    name: `Route ${nextEntityId(app.project, 'routes', 'R')}`,
    color: '#22d3ee',
    links: sel ? [sel] : [],
  };
  // Use a clean sequential name rather than duplicating the id.
  route.name = `Route ${route.id.replace(/^R/, '')}`;
  app.project.routes.push(route);
  app.afterGeometryChange({ select: { type: 'route', id: route.id }, resetSim: true });
}

export function newClassForSelection(app) {
  app.checkpoint('New vehicle class');
  const id = nextEntityId(app.project, 'classes', 'VC_');
  const cls = {
    id, name: `Class ${id.replace(/^VC_?/, '')}`, category: 'car', color: '#94a3b8',
    length: 4.5, width: 1.8, height: 1.5, maxSpeed: 55, accel: 2.5, decel: 4.8,
    minGap: 2, headway: 1.2, reaction: 1, behavior: 'normal', weight: 1,
  };
  app.project.classes.push(cls);
  app.afterGeometryChange({ select: { type: 'class', id }, resetSim: true });
}

export function newPtLineForSelection(app) {
  app.checkpoint('New transit line');
  const id = nextEntityId(app.project, 'ptLines', 'PT');
  const line = {
    id, name: `Line ${id.replace(/^PT/, '')}`, color: '#34d399', classId: app.project.classes.find((c) => c.category === 'bus')?.id || app.project.classes[0]?.id,
    headway: 600, dwell: 12, route: [], stops: [],
  };
  if (app.selection?.type === 'link') line.route.push(app.selection.id);
  app.project.ptLines.push(line);
  app.afterGeometryChange({ select: { type: 'pt', id }, resetSim: true });
}

export function deleteDetectorAt(app, id) {
  const d = app.findEntity('detector', id);
  if (!d) return;
  app.checkpoint('Delete detector');
  app.project.detectors = app.project.detectors.filter((x) => x.id !== id);
  app.afterGeometryChange({ select: null, resetSim: true });
}

export function inspectorAddInput(app, linkId) {
  const link = app.network.link(linkId);
  if (!link) return;
  app.checkpoint('Add input');
  const input = makeInput(app.project, linkId);
  app.project.inputs.push(input);
  app.afterGeometryChange({ select: { type: 'input', id: input.id }, resetSim: true });
}

export function inspectorAddDetector(app, linkId) {
  const link = app.network.link(linkId);
  if (!link) return;
  app.checkpoint('Add detector');
  const d = makeDetector(app.project, linkId, 0.6, 0);
  app.project.detectors.push(d);
  app.afterGeometryChange({ select: { type: 'detector', id: d.id }, resetSim: true });
}

export function inspectorAddCrosswalk(app, linkId) {
  const link = app.network.link(linkId);
  if (!link) return;
  app.checkpoint('Add crossing');
  const cw = makeCrosswalk(app.project, linkId, 0.82, null);
  app.project.crosswalks.push(cw);
  app.afterGeometryChange({ select: { type: 'crosswalk', id: cw.id }, resetSim: true });
}

export function quickSummary(app) {
  const s = app.currentResults()?.summary;
  if (!s) return 'No results yet';
  return `${fmtNum(s.completedMeasured)} trips · ${fmtNum(s.throughput)} veh/h · ${s.avgDelay.toFixed(1)} s delay`;
}
