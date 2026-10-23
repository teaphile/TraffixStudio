import {
  createDemoProject, createEmptyProject, nextEntityId,
} from '../core/project.js';
import { Network } from '../core/network.js';
import { Simulation } from '../core/simulation.js';
import { SignalSystem } from '../core/signals.js';
import { fallbackProject, loadUi, saveUi, saveProject as persistProject } from '../core/storage.js';
import {
  clamp, deepClone, escapeHtml as esc, fmtClock, fmtClockTenths, fmtDuration, fmtNum,
} from '../core/utils.js';
import { hydrateIcons, icon } from '../icons.js';
import { Editor } from './editor.js';
import { renderInspector } from './inspector.js';
import { renderAnalysis, drawAnalysisCharts } from './analysis.js';
import { explorerTitle, renderExplorer, searchPlaceholder } from './explorer.js';
import {
  installInteractions, newClassForSelection, newPtLineForSelection, newRouteForSelection,
} from './interactions.js';
import { handlePickedFile, pickProjectFile } from './fileops.js';
import {
  closeModal, showBatch, showNewProject, showQuickstart, showShortcuts, showValidation,
} from './dialogs.js';

const TYPE_LABEL = {
  node: 'Junction', link: 'Link', controller: 'Signal controller', head: 'Signal head',
  crosswalk: 'Pedestrian crossing', detector: 'Detector', input: 'Vehicle input',
  route: 'Route', pt: 'Transit line', class: 'Vehicle class', run: 'Evaluation run', multi: 'Selection',
};

const TOOLS = new Set(['select', 'node', 'link', 'signal', 'detector', 'crosswalk', 'delete']);
const MODES = new Set(['network', 'demand', 'control', 'evaluation', '3d']);

const MODE_HINTS = {
  network: { icon: 'road', title: 'Network plan', text: 'Draw links, place signals and shape the corridor.' },
  demand: { icon: 'car', title: 'Demand & routing', text: 'Set vehicle inputs, class mix, routes and transit lines.' },
  control: { icon: 'signal', title: 'Signal control', text: 'Edit phases, offsets and live signal stages.' },
  evaluation: { icon: 'chart', title: 'Evaluation workspace', text: 'KPIs, time series and scenario comparison.' },
  '3d': { icon: 'cube', title: '3D city view', text: 'Orbit the procedural city and watch live traffic.' },
};

export class App {
  constructor() {
    const savedUi = loadUi() || {};
    this.ui = {
      grid: savedUi.grid !== false,
      labels: savedUi.labels !== false,
      connectors: savedUi.connectors === true,
      collapsed: Array.isArray(savedUi.collapsed) ? savedUi.collapsed : [],
      speed: Number(savedUi.speed) || 1,
    };

    this.project = fallbackProject();
    this.network = new Network(this.project);
    this.previewSignals = new SignalSystem(this.project, this.network);
    this.previewSignals.update(0, 0, null);

    this.sim = null;
    this.lastResults = null;
    this.runs = [];
    this.selection = null;
    this.revision = 1;
    this.running = false;
    this.speed = clamp(Number(this.ui.speed) || 1, 0.5, 30);
    this.mode = MODES.has(savedUi.mode) && savedUi.mode !== 'evaluation' ? savedUi.mode : 'network';
    this.tool = TOOLS.has(savedUi.tool) ? savedUi.tool : 'select';
    this.analysisRunId = 'live';
    this.analysisTab = 'overview';
    this.explorerQuery = '';

    this._history = { undo: [], redo: [] };
    this._dirty = false;
    this._saveTimer = 0;
    this._liveFieldKey = null;
    this._runSeq = 1;
    this._recordedSim = null;
    this._simRemainder = 0;
    this._lastFrame = performance.now();
    this._lastHud = 0;
    this._lastAnalysisRefresh = 0;
    this._fpsAvg = 60;
    this._fpsAt = 0;
    this._analysisReturn = 'network';
    this._contextHit = null;
    this._menuItems = [];
    this._bootTime = performance.now();

    this.editor = new Editor(this);
    this.editor.grid = this.ui.grid;
    this.editor.labels = this.ui.labels;
    this.editor.connectors = this.ui.connectors;

    installInteractions(this);
    this._bindExtra();
    this._bindKeyboard();
    this._start();

    window.traffixStudio = this;
  }

  // --------------------------------------------------------------- boot/UI
  _start() {
    hydrateIcons(document);
    const name = this.project.meta.name;
    const title = document.getElementById('project-name');
    if (title) title.value = name;
    document.title = `${name} · TRAFFIX STUDIO`;
    const speed = document.getElementById('speed-select');
    if (speed) speed.value = String(this.speed);

    this.setMode(this.mode, { silent: true, initial: true });
    this.setTool(this.tool, { silent: true });
    this.renderExplorer();
    this.renderInspector();
    this.updateFooter();
    this.updateHistoryButtons();
    this.updateHud();

    const tlWarmup = document.getElementById('tl-warmup');
    if (tlWarmup) tlWarmup.style.width = `${clamp(this.project.settings.warmup / Math.max(1, this.project.settings.duration) * 100, 0, 100)}%`;
    const tlDuration = document.getElementById('tl-duration');
    if (tlDuration) tlDuration.textContent = fmtClock(this.project.settings.duration);

    requestAnimationFrame(() => {
      const camera = loadUi()?.camera;
      const zoom = Number(camera?.zoom);
      if (camera && Number.isFinite(camera.x) && Number.isFinite(camera.y) && Number.isFinite(zoom) && zoom > 0) {
        this.editor.camera = { x: camera.x, y: camera.y, zoom: clamp(zoom, 0.04, 10) };
        this.updateZoomReadout();
      } else {
        this.editor.fit();
      }
      this.renderExplorer();
      this.renderInspector();
      this.editor.render(performance.now());
    });

    this._lastFrame = performance.now();
    requestAnimationFrame(this._loop.bind(this));

    window.addEventListener('pagehide', () => {
      if (this._dirty) this.saveProjectToStorage(false);
      this.persistUi();
    });
    window.addEventListener('beforeunload', () => {
      if (this._dirty) this.saveProjectToStorage(false);
    });
    window.addEventListener('resize', () => this.editor.resize());
  }

  _bindExtra() {
    document.addEventListener('pointerdown', (e) => {
      const menu = document.getElementById('context-menu');
      if (!menu || menu.classList.contains('hidden')) return;
      if (!e.target.closest('#context-menu')) this._hideContextMenu();
    });
    const menu = document.getElementById('context-menu');
    menu?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cmd]');
      if (!btn) return;
      e.stopPropagation();
      this._handleCommand(btn.dataset.cmd);
    });
  }

  _loop(now) {
    const frameMs = Math.max(1, now - this._lastFrame);
    const delta = Math.min(0.12, frameMs / 1000);
    this._lastFrame = now;

    if (this.running && this.sim && !this.sim.finished) {
      this._simRemainder += delta * this.speed;
      const steps = Math.min(240, Math.floor(this._simRemainder / this.sim.dt));
      if (steps > 0) {
        this._simRemainder -= steps * this.sim.dt;
        this.sim.step(steps);
        if (this.sim.finished) this._onSimFinished(this.sim);
      }
    }

    this.editor.render(now);

    if (now - this._lastHud > 100) {
      this._lastHud = now;
      this.updateHud();
      if (!document.getElementById('analysis-overlay')?.classList.contains('hidden')
        && this.analysisRunId === 'live' && this.running
        && now - this._lastAnalysisRefresh > 1800) {
        this._lastAnalysisRefresh = now;
        this.refreshAnalysis();
      }
    }

    if (now - this._fpsAt > 500) {
      this._fpsAvg = this._fpsAvg * 0.65 + (1000 / frameMs) * 0.35;
      const fps = document.getElementById('status-fps');
      if (fps) fps.textContent = `${Math.round(clamp(this._fpsAvg, 1, 144))} fps`;
      this._fpsAt = now;
    }

    requestAnimationFrame(this._loop.bind(this));
  }

  // ------------------------------------------------------------------ mode
  setMode(mode, opts = {}) {
    if (!MODES.has(mode)) return;
    if (mode === 'evaluation') {
      this.openAnalysis(this.analysisTab || 'overview', { fromMode: true });
      return;
    }
    if (this.mode === 'evaluation' && !opts.keepAnalysis) {
      const overlay = document.getElementById('analysis-overlay');
      if (overlay && !overlay.classList.contains('hidden')) overlay.classList.add('hidden');
    }
    this.mode = mode;
    this.updateModeUi();
    if (!opts.silent) {
      this.renderExplorer();
      this.renderInspector();
      this.persistUi();
    }
  }

  updateModeUi() {
    document.querySelectorAll('[data-mode]').forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === this.mode));
    document.querySelectorAll('[data-tool]').forEach((btn) => btn.classList.toggle('active', btn.dataset.tool === this.tool));
    const left = document.getElementById('left-title');
    if (left) left.textContent = explorerTitle(this.mode);
    const search = document.getElementById('search-input');
    if (search) search.placeholder = searchPlaceholder(this.mode);

    const hint = MODE_HINTS[this.mode] || MODE_HINTS.network;
    const hintEl = document.getElementById('mode-hint');
    if (hintEl) {
      hintEl.innerHTML = `<div class="hud-icon">${icon(hint.icon)}</div><div><b>${esc(hint.title)}</b><p>${esc(hint.text)}</p></div>`;
    }
    document.getElementById('view3d-tip')?.classList.toggle('hidden', this.mode !== '3d');
    document.getElementById('signal-legend')?.classList.toggle('hidden', this.mode === '3d');
    const tools = document.getElementById('tools');
    if (tools) {
      const disabled = this.mode === '3d';
      tools.style.opacity = disabled ? '.42' : '';
      tools.style.pointerEvents = disabled ? 'none' : '';
    }
    const btn2d = document.getElementById('btn-2d');
    const btn3d = document.getElementById('btn-3d');
    if (btn2d) btn2d.classList.toggle('active', this.mode !== '3d');
    if (btn3d) btn3d.classList.toggle('active', this.mode === '3d');
    const status = document.getElementById('status-mode');
    if (status) status.innerHTML = `${icon(hint.icon)} ${esc(explorerTitle(this.mode))}`;
    document.body.dataset.mode = this.mode;
    if (this.mode === '3d') {
      this.editor.view3d.syncTimeOfDay();
      this.editor.view3d.resize(this.editor.width, this.editor.height, this.editor.dpr);
      this.editor.view3d.fit();
    }
    this.updateHud();
  }

  setTool(tool, opts = {}) {
    if (!TOOLS.has(tool)) return;
    if (this.mode === '3d' || this.mode === 'evaluation') this.setMode('network', { silent: true });
    if (this.tool !== tool && this.editor) this.editor.draft = null;
    this.tool = tool;
    document.querySelectorAll('[data-tool]').forEach((btn) => btn.classList.toggle('active', btn.dataset.tool === tool));
    const cursors = { select: 'default', node: 'crosshair', link: 'crosshair', signal: 'crosshair', detector: 'crosshair', crosswalk: 'crosshair', delete: 'not-allowed' };
    this.editor.canvas.style.cursor = cursors[tool] || 'default';
    if (!opts.silent) {
      this.persistUi();
      const hints = {
        select: ['Select', 'Click objects to inspect. Drag junctions and waypoints to reshape geometry.'],
        node: ['Junction tool', 'Click the canvas to place a junction.'],
        link: ['Link tool', 'Click a start point, then click again to finish the link.'],
        signal: ['Signal tool', 'Click a link to place a signal head, or a junction to control all approaches.'],
        detector: ['Detector tool', 'Click a lane to place a loop detector.'],
        crosswalk: ['Crossing tool', 'Click a link to add a pedestrian crossing.'],
        delete: ['Delete tool', 'Click an object to remove it.'],
      };
      const [title, text] = hints[tool] || hints.select;
      const el = document.getElementById('mode-hint');
      if (el) el.innerHTML = `<div class="hud-icon">${icon(tool === 'select' ? 'cursor' : tool === 'node' ? 'node' : tool === 'link' ? 'road' : tool === 'signal' ? 'signal' : tool === 'detector' ? 'detector' : tool === 'crosswalk' ? 'crosswalk' : 'trash')}</div><div><b>${esc(title)}</b><p>${esc(text)}</p></div>`;
      this.setStatus(text);
    }
  }

  // ------------------------------------------------------------- rendering
  renderExplorer() {
    const el = document.getElementById('explorer');
    if (!el) return;
    el.innerHTML = renderExplorer(this);
    const search = document.getElementById('search-input');
    if (search && search.value !== this.explorerQuery) search.value = this.explorerQuery;
    this.updateFooter();
  }

  renderInspector() {
    const el = document.getElementById('inspector');
    if (!el) return;
    el.innerHTML = renderInspector(this);
    const eyebrow = document.getElementById('inspector-eyebrow');
    const title = document.getElementById('inspector-title');
    if (!this.selection) {
      if (eyebrow) eyebrow.textContent = 'PROJECT';
      if (title) title.textContent = 'Network settings';
    } else if (this.selection.type === 'multi') {
      if (eyebrow) eyebrow.textContent = 'SELECTION';
      if (title) title.textContent = `${this.selection.items.length} objects`;
    } else {
      const entity = this.findEntity(this.selection.type, this.selection.id);
      if (eyebrow) eyebrow.textContent = (TYPE_LABEL[this.selection.type] || 'OBJECT').toUpperCase();
      if (title) title.textContent = entity?.name || entity?.id || 'Object';
    }
    this.updateHistoryButtons();
    this.updateFooter();
  }

  refreshPanels(withExplorer = true) {
    if (withExplorer) this.renderExplorer();
    this.renderInspector();
    this.updateFooter();
    this.updateHud();
  }

  updateFooter() {
    const sim = this.sim;
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = String(value); };
    set('stat-links', this.project.links.length);
    set('stat-nodes', this.project.nodes.length);
    set('stat-veh', sim ? sim.vehicles.length : (this.lastResults?.summary?.active || 0));
    const total = this.project.links.length + this.project.nodes.length + this.project.signalHeads.length
      + this.project.crosswalks.length + this.project.detectors.length + this.project.inputs.length
      + this.project.routes.length + (this.project.ptLines?.length || 0) + this.project.classes.length;
    set('status-objects', `${fmtNum(total)} objects`);
  }

  updateHistoryButtons() {
    const undo = document.getElementById('btn-undo');
    const redo = document.getElementById('btn-redo');
    if (undo) undo.disabled = this._history.undo.length === 0;
    if (redo) redo.disabled = this._history.redo.length === 0;
  }

  updateZoomReadout() {
    const el = document.getElementById('zoom-readout');
    if (el) el.textContent = `${Math.round(this.editor.camera.zoom * 100)}%`;
  }

  setCoords(x, y) {
    const el = document.getElementById('status-coords');
    if (el) el.textContent = `x ${x.toFixed(1)} · y ${y.toFixed(1)}`;
  }

  setHover(hit) {
    if (!document.getElementById('status-message')) return;
    if (hit?.entity) {
      const meta = TYPE_LABEL[hit.type] || hit.type;
      this.setStatus(`${hit.entity.name || hit.id} · ${meta}${hit.type === 'link' ? ` · ${this.network.lengthOf(hit.id).toFixed(0)} m` : ''}`);
    } else {
      this.setStatus(this.running ? 'Simulation running' : 'Ready');
    }
  }

  setStatus(text) {
    const el = document.getElementById('status-message');
    if (el) el.textContent = text;
  }

  // ------------------------------------------------------------- history
  checkpoint(label = 'Edit') {
    try {
      this._history.undo.push({ label, project: deepClone(this.project) });
      if (this._history.undo.length > 70) this._history.undo.shift();
      this._history.redo = [];
      this.updateHistoryButtons();
    } catch (err) {
      console.warn('Could not create undo checkpoint:', err);
    }
  }

  undo() {
    if (!this._history.undo.length) { this.toast('Undo', 'Nothing to undo.', 'info'); return; }
    const entry = this._history.undo.pop();
    this._history.redo.push({ label: entry.label, project: deepClone(this.project) });
    this._restoreProject(entry.project);
    this.toast('Undo', entry.label, 'info');
  }

  redo() {
    if (!this._history.redo.length) { this.toast('Redo', 'Nothing to redo.', 'info'); return; }
    const entry = this._history.redo.pop();
    this._history.undo.push({ label: entry.label, project: deepClone(this.project) });
    this._restoreProject(entry.project);
    this.toast('Redo', entry.label, 'info');
  }

  _restoreProject(project) {
    this.project = deepClone(project);
    this._rebuildNetwork();
    this.sim = null;
    this.running = false;
    this.lastResults = null;
    this._recordedSim = null;
    this.selection = null;
    this.analysisRunId = 'live';
    this.revision++;
    this._syncProjectChrome();
    this.refreshPanels();
    this.updateHud();
    this.markDirty();
  }

  _syncProjectChrome() {
    const input = document.getElementById('project-name');
    if (input) input.value = this.project.meta.name;
    document.title = `${this.project.meta.name} · TRAFFIX STUDIO`;
    const tlWarmup = document.getElementById('tl-warmup');
    if (tlWarmup) {
      tlWarmup.style.width = `${clamp(this.project.settings.warmup / Math.max(1, this.project.settings.duration) * 100, 0, 100)}%`;
    }
    const tlDuration = document.getElementById('tl-duration');
    if (tlDuration) tlDuration.textContent = fmtClock(this.project.settings.duration);
  }

  // ------------------------------------------------------------ selection
  findEntity(type, id) {
    const p = this.project;
    switch (type) {
      case 'node': return p.nodes.find((x) => x.id === id) || null;
      case 'link': return p.links.find((x) => x.id === id) || null;
      case 'controller': return p.signalControllers.find((x) => x.id === id) || null;
      case 'head': return p.signalHeads.find((x) => x.id === id) || null;
      case 'crosswalk': return p.crosswalks.find((x) => x.id === id) || null;
      case 'detector': return p.detectors.find((x) => x.id === id) || null;
      case 'input': return p.inputs.find((x) => x.id === id) || null;
      case 'route': return p.routes.find((x) => x.id === id) || null;
      case 'pt': return (p.ptLines || []).find((x) => x.id === id) || null;
      case 'class': return p.classes.find((x) => x.id === id) || null;
      case 'run': return this.runs.find((x) => x.id === id) || null;
      default: return null;
    }
  }

  select(type, id, additive = false) {
    const entity = this.findEntity(type, id);
    if (!entity) return;
    if (additive) {
      let items = this.selection?.type === 'multi'
        ? [...this.selection.items]
        : this.selection ? [{ type: this.selection.type, id: this.selection.id }] : [];
      const idx = items.findIndex((it) => it.type === type && it.id === id);
      if (idx >= 0) items.splice(idx, 1); else items.push({ type, id });
      items = items.filter((it) => this.findEntity(it.type, it.id));
      this.selection = items.length === 0 ? null : items.length === 1 ? items[0] : { type: 'multi', items };
    } else {
      this.selection = { type, id };
    }
    this.renderInspector();
    this.renderExplorer();
    this.updateHud();
  }

  clearSelection() {
    this.selection = null;
    this.renderInspector();
    this.renderExplorer();
  }

  isSelected(type, id) {
    if (!this.selection) return false;
    if (this.selection.type === 'multi') return this.selection.items.some((it) => it.type === type && it.id === id);
    return this.selection.type === type && this.selection.id === id;
  }

  selectAll() {
    const items = this.project.links.map((l) => ({ type: 'link', id: l.id }));
    if (!items.length) { this.toast('Selection', 'There are no links to select.', 'warn'); return; }
    this.selection = { type: 'multi', items };
    this.renderInspector();
    this.renderExplorer();
    this.setStatus(`Selected ${items.length} links`);
  }

  focusEntity(type, id) {
    const entity = this.findEntity(type, id);
    if (!entity) return;
    if (this.mode === '3d') this.setMode('network', { silent: true });
    this.select(type, id);
    const point = this._entityCenter(type, entity);
    if (point) {
      this.editor.centerOn(point.x, point.y);
      if (this.editor.camera.zoom < 0.55) {
        this.editor.camera.zoom = 0.75;
        this.updateZoomReadout();
      }
    }
  }

  _entityCenter(type, entity) {
    if (!entity) return null;
    if (type === 'node') return { x: entity.x, y: entity.y };
    const linkId = type === 'link' ? entity.id : entity.linkId
      || (type === 'controller' ? this.project.signalHeads.find((h) => h.controllerId === entity.id)?.linkId : null)
      || (type === 'route' ? entity.links?.[0] : null)
      || (type === 'pt' ? entity.route?.[0] : null)
      || (type === 'input' ? entity.linkId : null);
    if (linkId && this.network.link(linkId)) {
      const len = this.network.lengthOf(linkId);
      const pos = this.network.centerPosition(linkId, len / 2);
      return { x: pos.x, y: pos.y };
    }
    return null;
  }

  // ------------------------------------------------------------- lifecycle
  _rebuildNetwork() {
    this.network = new Network(this.project);
    this.previewSignals = new SignalSystem(this.project, this.network);
    this.previewSignals.update(0, 0, null);
    this.revision++;
  }

  rebuildNetwork(render = true) {
    this._rebuildNetwork();
    if (render) this.refreshPanels();
  }

  invalidateSimulation() {
    this.sim = null;
    this.running = false;
    this.lastResults = null;
    this._recordedSim = null;
    this._simRemainder = 0;
    this.updateHud();
  }

  afterGeometryChange(opts = {}) {
    if (opts.resetSim !== false) this.invalidateSimulation();
    this._rebuildNetwork();
    this.revision++;
    if (Object.prototype.hasOwnProperty.call(opts, 'select')) {
      if (opts.select) this.selection = opts.select.type === 'multi' ? opts.select : { type: opts.select.type, id: opts.select.id };
      else this.selection = null;
    }
    this.markDirty();
    this.refreshPanels();
    this.updateHud();
    this._syncProjectChrome();
  }

  afterFieldChange(opts = {}) {
    const structural = opts.structural !== false;
    if (structural) {
      this.invalidateSimulation();
      this._rebuildNetwork();
      this.revision++;
    } else {
      this._rebuildNetwork();
      this.revision++;
    }
    this.markDirty();
    if (!opts.live) {
      if (opts.refreshExplorer !== false) this.renderExplorer();
      this.renderInspector();
    }
    this.updateFooter();
    this.updateHud();
    this._syncProjectChrome();
    if (!document.getElementById('analysis-overlay')?.classList.contains('hidden')) {
      this.refreshAnalysis();
    }
  }

  fieldIsStructural(scope, path) {
    if (scope === 'project') {
      return !path.startsWith('meta.');
    }
    if (scope === 'phase' || scope === 'composition' || scope === 'ptstop') return true;
    if (['name', 'color', 'display', 'sidewalk', 'description', 'type'].includes(path)) return false;
    return true;
  }

  syncNodeGeometry(node) {
    if (!node) return;
    for (const link of this.project.links) {
      if (link.from === node.id && link.points[0]) {
        link.points[0].x = node.x; link.points[0].y = node.y;
      }
      if (link.to === node.id && link.points.length) {
        const last = link.points[link.points.length - 1];
        last.x = node.x; last.y = node.y;
      }
    }
  }

  // --------------------------------------------------------------- storage
  markDirty() {
    this._dirty = true;
    this._setSaveState('Unsaved', true);
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveProjectToStorage(false), 1600);
  }

  _setSaveState(text, dirty = false) {
    const el = document.getElementById('save-state');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('dirty', dirty);
  }

  persistUi() {
    saveUi({
      grid: this.editor.grid,
      labels: this.editor.labels,
      connectors: this.editor.connectors,
      collapsed: this.ui.collapsed,
      speed: this.speed,
      mode: this.mode === 'evaluation' ? 'network' : this.mode,
      tool: this.tool,
      camera: { ...this.editor.camera },
    });
  }

  saveProjectToStorage(notify = false) {
    clearTimeout(this._saveTimer);
    this._setSaveState('Saving…');
    const ok = persistProject(this.project);
    this.persistUi();
    if (ok) {
      this._dirty = false;
      this._setSaveState('Saved');
      if (notify) this.toast('Project saved', `${this.project.meta.name} saved in this browser.`, 'success');
    } else {
      this._setSaveState('Save failed', true);
      if (notify) this.toast('Save failed', 'Browser storage is unavailable or full.', 'error');
    }
  }

  async handleFile(file) {
    await handlePickedFile(this, file);
    const input = document.getElementById('file-input');
    if (input) input.value = '';
  }

  adoptProject(project, opts = {}) {
    if (opts.history !== false) this.checkpoint(opts.label || `Open ${project.meta?.name || 'project'}`);
    this.project = project;
    this._rebuildNetwork();
    this.sim = null;
    this.running = false;
    this.lastResults = null;
    this._recordedSim = null;
    this.selection = null;
    this.analysisRunId = 'live';
    if (opts.clearRuns) this.runs = [];
    this.revision++;
    this._syncProjectChrome();
    this.setMode('network', { silent: true });
    if (opts.fit) this.editor.fit();
    this.refreshPanels();
    this.updateHud();
    this.markDirty();
    if (opts.message) this.toast('Project', opts.message, 'success');
  }

  createNewProject(name, template) {
    this.checkpoint('New project');
    const project = template === 'demo' ? createDemoProject() : createEmptyProject(name);
    project.meta.name = name || project.meta.name;
    this.adoptProject(project, {
      history: false, clearRuns: true, fit: true,
      message: template === 'demo' ? 'Riverside demo loaded into a new project.' : `“${project.meta.name}” created.`,
    });
  }

  loadDemo() {
    this.checkpoint('Load demo network');
    this.adoptProject(createDemoProject(), {
      history: false, clearRuns: true, fit: true,
      message: 'Riverside Boulevard loaded · 14 links and two signalised junctions.',
    });
    this.analysisTab = 'overview';
  }

  // ------------------------------------------------------------- simulation
  ensureSim() {
    if (this.sim && !this.sim.finished) return this.sim;
    this._newSimulation();
    return this.sim;
  }

  _newSimulation() {
    this.sim = new Simulation(this.project, { network: this.network });
    this.lastResults = null;
    this.running = false;
    this._recordedSim = null;
    this._simRemainder = 0;
    this.revision++;
  }

  togglePlay() {
    if (this.running) {
      this.running = false;
      this.setStatus('Simulation paused');
      this.updateHud();
      return;
    }
    if (this.sim?.finished) this._newSimulation();
    const sim = this.ensureSim();
    if (sim.finished) {
      this.toast('Simulation', 'The run is complete. Restart to simulate again.', 'info');
      return;
    }
    this.running = true;
    this._simRemainder = 0;
    this._lastFrame = performance.now();
    this.setStatus('Simulation running');
    this.updateHud();
  }

  stepSim(seconds = 1) {
    this.running = false;
    const sim = this.ensureSim();
    if (sim.finished) { this._newSimulation(); }
    const steps = Math.max(1, Math.round(seconds / sim.dt));
    this.sim.step(steps);
    if (this.sim.finished) this._onSimFinished(this.sim);
    this._simRemainder = 0;
    this.updateHud();
    this.updateFooter();
    this.setStatus(`Advanced ${seconds.toFixed(1)} s · t = ${fmtClock(this.sim.t)}`);
  }

  resetSimulation(opts = {}) {
    this.running = false;
    this.sim = null;
    this.lastResults = null;
    this._recordedSim = null;
    this._simRemainder = 0;
    this.revision++;
    this.updateHud();
    this.updateFooter();
    if (!opts.silent) this.setStatus('Simulation reset');
    if (this.selection) this.renderInspector();
  }

  scrubTo(seconds) {
    const duration = Math.max(5, this.project.settings.duration || 900);
    const target = clamp(Number(seconds) || 0, 0, duration);
    this.running = false;
    if (!this.sim || this.sim.finished || target + 0.001 < this.sim.t) {
      this._newSimulation();
    }
    const sim = this.ensureSim();
    if (target > sim.t) sim.runUntil(target);
    if (target >= duration - 0.001) {
      sim.runUntil(duration);
      if (!sim.finished) sim.finish();
      this._onSimFinished(sim, { quiet: true });
    }
    this.updateHud();
    this.updateFooter();
    this.setStatus(`Timeline scrubbed to ${fmtClock(target)}`);
  }

  _onSimFinished(sim, opts = {}) {
    this.running = false;
    this._simRemainder = 0;
    const results = sim.getResults();
    this.lastResults = results;
    if (this._recordedSim !== sim) {
      this._recordedSim = sim;
      const seq = this._runSeq++;
      const run = {
        id: `RUN${seq}`,
        name: `Run ${seq} · seed ${results.seed}`,
        seed: results.seed,
        runAt: results.runAt,
        results,
      };
      this.runs.push(run);
      if (this.runs.length > 80) this.runs.splice(0, this.runs.length - 80);
    }
    this.updateHud();
    this.updateFooter();
    if (!document.getElementById('inspector')?.contains(document.activeElement)) this.renderInspector();
    if (!document.getElementById('analysis-overlay')?.classList.contains('hidden')) this.refreshAnalysis();
    if (!opts.quiet) {
      const s = results.summary;
      this.toast('Run complete', `${fmtNum(s.completedMeasured)} measured trips · ${fmtNum(s.throughput)} veh/h · ${s.avgDelay.toFixed(1)} s mean delay`, 'success');
    }
  }

  updateHud() {
    const p = this.project;
    const duration = Math.max(5, p.settings.duration || 900);
    const warmup = clamp(p.settings.warmup || 0, 0, duration);
    const sim = this.sim;
    const results = this.lastResults;
    const t = sim ? sim.t : (results ? duration : 0);
    const active = sim ? sim.vehicles.length : (results?.summary?.active || 0);
    const completed = sim ? sim.evaluation.completedMeasured : (results?.summary?.completedMeasured ?? results?.summary?.completed ?? 0);
    const snap = sim?.getSnapshot?.();
    const throughput = results?.summary?.throughput || 0;

    const clock = document.getElementById('clock');
    if (clock) clock.textContent = fmtClockTenths(t);
    const tlStatus = document.getElementById('tl-status');
    const tlSub = document.getElementById('tl-sub');
    const tlTime = document.getElementById('tl-time');
    const tlDuration = document.getElementById('tl-duration');
    const fill = document.getElementById('tl-fill');
    const head = document.getElementById('tl-head');
    const pct = clamp(t / duration * 100, 0, 100);
    if (fill) fill.style.width = `${pct}%`;
    if (head) {
      head.style.left = `${pct}%`;
      head.classList.toggle('visible', Boolean(sim));
    }
    if (tlStatus) {
      tlStatus.textContent = this.running ? 'Running'
        : sim?.finished ? 'Complete'
          : sim ? `Paused · ${fmtClock(sim.t)}`
            : results ? 'Results available' : 'Not running';
    }
    if (tlSub) tlSub.textContent = `Warm-up ${fmtClock(warmup)} · Measure ${fmtClock(duration - warmup)}`;
    if (tlTime) tlTime.textContent = fmtClock(t);
    if (tlDuration) tlDuration.textContent = fmtClock(duration);
    const warm = document.getElementById('tl-warmup');
    if (warm) warm.style.width = `${clamp(warmup / duration * 100, 0, 100)}%`;

    const badge = document.getElementById('sim-badge');
    const badgeTitle = badge?.querySelector('b');
    const badgeSub = badge?.querySelector('small');
    if (badge) {
      badge.classList.toggle('running', this.running);
      badge.classList.toggle('paused', Boolean(sim) && !this.running && !sim.finished);
    }
    if (badgeTitle) {
      badgeTitle.textContent = this.running ? 'RUNNING'
        : sim?.finished ? 'COMPLETE'
          : sim ? 'PAUSED'
            : results ? 'COMPLETE' : 'READY';
    }
    if (badgeSub) {
      badgeSub.textContent = this.running
        ? `${fmtNum(active)} active · ${fmtNum(completed)} done`
        : sim?.finished
          ? `${fmtNum(completed)} trips · ${fmtNum(throughput)} veh/h`
          : sim ? `${fmtNum(active)} active · ${fmtClock(sim.t)}`
            : results ? `${fmtNum(results.summary.completedMeasured)} trips measured` : 'Network idle';
    }
    const play = document.getElementById('btn-play');
    if (play) {
      const state = this.running ? 'pause' : 'play';
      if (this._playState !== state) {
        play.innerHTML = icon(state);
        this._playState = state;
      }
      play.classList.toggle('running', this.running);
      play.title = this.running ? 'Pause (Space)' : 'Run / pause (Space)';
    }
    const veh = document.getElementById('stat-veh');
    if (veh) veh.textContent = fmtNum(sim ? active : (results?.summary?.active || 0));
    if (snap) {
      const status = document.getElementById('status-objects');
      if (status) status.textContent = `${fmtNum(active)} vehicles · ${fmtNum(snap.queue)} queue`;
    }
  }

  currentResults() {
    if (this.analysisRunId !== 'live') {
      const run = this.runs.find((r) => r.id === this.analysisRunId);
      return run?.results || this.lastResults || this.sim?.getResults() || null;
    }
    if (this.sim) return this.sim.getResults();
    return this.lastResults;
  }

  /** Current lamp colour for a link, using the live run or the plan preview. */
  signalStateFor(linkId) {
    const system = this.sim?.signalSystem || this.previewSignals;
    return system ? system.stateForLink(linkId) : null;
  }

  // --------------------------------------------------------------- analysis
  openAnalysis(tab = 'overview', opts = {}) {
    if (this.modal) closeModal(this);
    const overlay = document.getElementById('analysis-overlay');
    if (!overlay) return;
    if (this.mode !== 'evaluation') {
      this._analysisReturn = this.mode === '3d' ? 'network' : this.mode;
    }
    this.mode = 'evaluation';
    this.analysisTab = tab || 'overview';
    overlay.classList.remove('hidden');
    this.updateModeUi();
    this.refreshAnalysis();
    this.persistUi();
    if (!opts.fromMode) this.setStatus('Evaluation workspace');
  }

  closeAnalysis() {
    const overlay = document.getElementById('analysis-overlay');
    if (overlay) overlay.classList.add('hidden');
    const wasEval = this.mode === 'evaluation';
    if (wasEval) {
      this.mode = this._analysisReturn || 'network';
      this.updateModeUi();
      this.renderExplorer();
      this.renderInspector();
      this.persistUi();
    }
  }

  refreshAnalysis() {
    const overlay = document.getElementById('analysis-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    const content = document.getElementById('analysis-content');
    if (!content) return;
    const results = this.currentResults();
    const tag = document.getElementById('analysis-run-tag');
    if (tag) {
      if (this.analysisRunId === 'live') {
        tag.textContent = 'LIVE';
        tag.className = 'badge cyan';
      } else {
        const run = this.runs.find((r) => r.id === this.analysisRunId);
        tag.textContent = run ? run.name.split('·')[0].trim().toUpperCase() : 'RECORDED';
        tag.className = 'badge amber';
      }
    }
    const win = document.getElementById('analysis-window');
    if (win) {
      win.textContent = results
        ? `Measurement ${fmtClock(results.window.start)} – ${fmtClock(results.window.end)} · ${fmtClock(results.window.length)}`
        : 'No measurement window';
    }
    document.querySelectorAll('#analysis-tabs [data-atab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.atab === (this.analysisTab || 'overview'));
    });
    content.innerHTML = renderAnalysis(this);
    requestAnimationFrame(() => drawAnalysisCharts(this));
    this._lastAnalysisRefresh = performance.now();
  }

  deleteRun(id) {
    const run = this.runs.find((r) => r.id === id);
    if (!run) return;
    this.runs = this.runs.filter((r) => r.id !== id);
    if (this.analysisRunId === id) this.analysisRunId = 'live';
    if (this.selection?.type === 'run' && this.selection.id === id) this.selection = null;
    this.renderInspector();
    this.renderExplorer();
    if (!document.getElementById('analysis-overlay')?.classList.contains('hidden')) this.refreshAnalysis();
    this.toast('Evaluation', `Deleted ${run.name}.`, 'info');
  }

  async startBatch({ runs = 3, seed = this.project.settings.seed || 2026 } = {}, progress = null) {
    const count = clamp(Math.round(runs) || 3, 1, 30);
    const baseSeed = Math.max(1, Math.round(seed) || 2026);
    this.running = false;
    this._batchSeq = (this._batchSeq || 0) + 1;
    const batchNo = this._batchSeq;
    const added = [];
    for (let i = 0; i < count; i++) {
      await new Promise((resolve) => setTimeout(resolve, 18));
      const project = deepClone(this.project);
      project.settings.seed = baseSeed + i;
      const sim = new Simulation(project, { network: new Network(project) });
      sim.runUntil(project.settings.duration);
      if (!sim.finished) sim.finish();
      const results = sim.getResults();
      const run = {
        id: `B${Date.now().toString(36)}${i}`,
        name: `Batch ${batchNo} · R${i + 1} · seed ${baseSeed + i}`,
        seed: baseSeed + i,
        runAt: results.runAt,
        results,
      };
      this.runs.push(run);
      added.push(run);
      if (this.runs.length > 80) this.runs.splice(0, this.runs.length - 80);
      progress?.(i + 1, count, results);
    }
    if (added.length) this.analysisRunId = added[added.length - 1].id;
    this.project.settings.batchRuns = count;
    this.markDirty();
    this.renderExplorer();
    this.renderInspector();
    if (!document.getElementById('analysis-overlay')?.classList.contains('hidden')) this.refreshAnalysis();
    const mean = (key) => added.reduce((s, r) => s + r.results.summary[key], 0) / Math.max(1, added.length);
    this.toast('Batch complete', `${count} runs · mean ${fmtNum(mean('throughput'))} veh/h · ${mean('avgDelay').toFixed(1)} s delay`, 'success');
    return added;
  }

  // ----------------------------------------------------------------- menus
  _showMenu(x, y, items) {
    const menu = document.getElementById('context-menu');
    if (!menu) return;
    this._menuItems = items;
    menu.innerHTML = items.map((item) => {
      if (item.sep) return '<div class="menu-sep"></div>';
      if (item.header) return `<div class="ctx-head">${esc(item.header)}</div>`;
      return `<button data-cmd="${esc(item.cmd)}" class="${item.danger ? 'danger' : ''}" ${item.disabled ? 'disabled' : ''}>${item.icon ? icon(item.icon) : ''}${esc(item.label)}</button>`;
    }).join('');
    menu.classList.remove('hidden');
    menu.style.left = '0px';
    menu.style.top = '0px';
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - rect.height - 8))}px`;
  }

  _hideContextMenu() {
    document.getElementById('context-menu')?.classList.add('hidden');
  }

  showContextMenu(x, y, hit) {
    const canvas = this.editor.canvas;
    const rect = canvas.getBoundingClientRect();
    this._menuWorld = this.editor.screenToWorld(x - rect.left, y - rect.top);
    if (hit) this.select(hit.type, hit.id);
    const items = [];
    if (hit) {
      items.push({ header: `${TYPE_LABEL[hit.type] || hit.type} · ${hit.entity?.name || hit.id}` });
      items.push({ label: 'Focus in view', icon: 'target', cmd: 'focus' });
      items.push({ label: 'Duplicate', icon: 'copy', cmd: 'duplicate' });
      items.push({ label: 'Delete', icon: 'trash', cmd: 'delete', danger: true });
      items.push({ sep: true });
      if (hit.type === 'link') {
        items.push({ label: 'Add vehicle input', icon: 'car', cmd: 'add-input' });
        items.push({ label: 'Place signal head', icon: 'signal', cmd: 'add-signal' });
        items.push({ label: 'Place detector', icon: 'detector', cmd: 'add-detector' });
        items.push({ label: 'Add crossing', icon: 'crosswalk', cmd: 'add-crosswalk' });
      } else if (hit.type === 'node') {
        items.push({ label: 'Add signal control', icon: 'signal', cmd: 'add-controller' });
      } else if (hit.type === 'controller') {
        items.push({ label: 'Inspect phases', icon: 'settings', cmd: 'focus' });
      }
    } else {
      items.push({ header: 'Network' });
      items.push({ label: 'Add junction here', icon: 'node', cmd: 'add-junction' });
      items.push({ label: 'Draw link', icon: 'road', cmd: 'draw-link' });
      items.push({ sep: true });
      items.push({ label: 'New route', icon: 'route', cmd: 'new-route' });
      items.push({ label: 'New transit line', icon: 'bus', cmd: 'new-pt' });
      items.push({ label: 'New vehicle class', icon: 'car', cmd: 'new-class' });
    }
    items.push({ sep: true });
    items.push({ label: 'Validate model', icon: 'check', cmd: 'validate' });
    items.push({ label: 'Open evaluation', icon: 'chart', cmd: 'analysis' });
    this._showMenu(x, y, items);
  }

  showAddMenu(x, y) {
    const items = [{ header: 'Add to project' }];
    items.push({ label: 'Junction', icon: 'node', cmd: 'add-junction' });
    items.push({ label: 'Draw link', icon: 'road', cmd: 'draw-link' });
    items.push({ sep: true });
    if (this.selection?.type === 'link') {
      items.push({ label: 'Vehicle input', icon: 'car', cmd: 'add-input' });
      items.push({ label: 'Signal head', icon: 'signal', cmd: 'add-signal' });
      items.push({ label: 'Detector', icon: 'detector', cmd: 'add-detector' });
      items.push({ label: 'Pedestrian crossing', icon: 'crosswalk', cmd: 'add-crosswalk' });
      items.push({ sep: true });
    }
    if (this.selection?.type === 'node') {
      items.push({ label: 'Signal controller', icon: 'controller', cmd: 'add-controller' });
      items.push({ sep: true });
    }
    items.push({ label: 'Route', icon: 'route', cmd: 'new-route' });
    items.push({ label: 'Transit line', icon: 'bus', cmd: 'new-pt' });
    items.push({ label: 'Vehicle class', icon: 'layers', cmd: 'new-class' });
    this._showMenu(x, y, items);
  }

  showInspectorMenu(x, y) {
    if (!this.selection) {
      this._showMenu(x, y, [
        { header: 'Project' },
        { label: 'Fit network', icon: 'fit', cmd: 'fit' },
        { label: 'Validate model', icon: 'check', cmd: 'validate' },
        { label: 'Open evaluation', icon: 'chart', cmd: 'analysis' },
      ]);
      return;
    }
    this._showMenu(x, y, [
      { header: this.selection.type === 'multi' ? `${this.selection.items.length} selected objects` : (TYPE_LABEL[this.selection.type] || 'Object') },
      { label: 'Focus', icon: 'target', cmd: 'focus', disabled: this.selection.type === 'multi' },
      { label: 'Duplicate', icon: 'copy', cmd: 'duplicate' },
      { label: 'Delete', icon: 'trash', cmd: 'delete', danger: true },
      { sep: true },
      { label: `${this.editor.grid ? 'Hide' : 'Show'} grid`, icon: 'grid', cmd: 'toggle-grid' },
      { label: `${this.editor.labels ? 'Hide' : 'Show'} labels`, icon: 'eye', cmd: 'toggle-labels' },
      { label: `${this.editor.connectors ? 'Hide' : 'Show'} turn paths`, icon: 'route', cmd: 'toggle-connectors' },
    ]);
  }

  _handleCommand(cmd) {
    this._hideContextMenu();
    switch (cmd) {
      case 'focus': if (this.selection && this.selection.type !== 'multi') this.focusEntity(this.selection.type, this.selection.id); break;
      case 'duplicate': this.duplicateSelection(); break;
      case 'delete': this.deleteSelection(); break;
      case 'add-junction': {
        const p = this._menuWorld || { x: this.editor.camera.x, y: this.editor.camera.y };
        this.setTool('select', { silent: true });
        this.editor._createNode(p.x, p.y);
        break;
      }
      case 'draw-link': this.setTool('link'); break;
      case 'add-input': this.inspectorAction('link-input'); break;
      case 'add-signal': this.inspectorAction('link-signal'); break;
      case 'add-detector': this.inspectorAction('link-detector'); break;
      case 'add-crosswalk': this.inspectorAction('link-crosswalk'); break;
      case 'add-controller': this.inspectorAction('node-controller'); break;
      case 'new-route': newRouteForSelection(this); break;
      case 'new-pt': newPtLineForSelection(this); break;
      case 'new-class': newClassForSelection(this); break;
      case 'validate': showValidation(this); break;
      case 'analysis': this.openAnalysis('overview'); break;
      case 'fit': this.editor.fit(); break;
      case 'toggle-grid': this.toggleDisplay('grid'); break;
      case 'toggle-labels': this.toggleDisplay('labels'); break;
      case 'toggle-connectors': this.toggleDisplay('connectors'); break;
      default: break;
    }
  }

  inspectorAction(act) {
    const link = this.selection?.type === 'link' ? this.findEntity('link', this.selection.id) : null;
    if (act === 'link-input') this._addInputToSelectedLink();
    else if (act === 'link-signal') {
      if (link) this.editor._createSignal(link, 0.955);
    } else if (act === 'link-detector') {
      if (link) this.editor._createDetector(link, 0.7, 0);
    } else if (act === 'link-crosswalk') {
      if (link) this.editor._createCrosswalk(link, 0.82);
    } else if (act === 'node-controller') {
      const node = this.selection?.type === 'node' ? this.findEntity('node', this.selection.id) : null;
      if (!node) { this.toast('Signal control', 'Select a junction first.', 'warn'); return; }
      this.editor._createControllerForNode(node.id);
    }
  }

  _addInputToSelectedLink() {
    const link = this.selection?.type === 'link' ? this.findEntity('link', this.selection.id) : null;
    if (!link) { this.toast('Demand', 'Select a link before adding a vehicle input.', 'warn'); return; }
    this.checkpoint('Add vehicle input');
    const id = nextEntityId(this.project, 'inputs', 'VI');
    const input = {
      id, name: `Input ${id.replace(/^VI/, '')}`,
      linkId: link.id, volume: 500, from: 0, to: this.project.settings.duration,
      routeId: null, composition: { [this.project.classes.find((c) => c.category === 'car')?.id || this.project.classes[0]?.id]: 90 },
    };
    this.project.inputs.push(input);
    this.afterGeometryChange({ select: { type: 'input', id: input.id }, resetSim: true });
    this.toast('Demand', `${input.name} added to ${link.name}.`, 'success');
  }

  // ------------------------------------------------------------- delete/dup
  deleteSelection() {
    if (!this.selection) { this.toast('Delete', 'Select an object first.', 'warn'); return; }
    const items = this.selection.type === 'multi' ? [...this.selection.items] : [this.selection];
    const hasGeometry = items.some((it) => it.type !== 'run');
    if (hasGeometry) this.checkpoint('Delete selection');
    let deleted = 0;
    let skipped = 0;
    for (const item of items) {
      if (item.type === 'run') {
        if (this.runs.some((r) => r.id === item.id)) { this.deleteRun(item.id); deleted++; } else skipped++;
        continue;
      }
      if (this._deleteEntity(item.type, item.id)) deleted++; else skipped++;
    }
    if (deleted && hasGeometry) {
      this.selection = null;
      this.afterGeometryChange({ select: null, resetSim: true });
      this.toast('Deleted', `${deleted} object${deleted === 1 ? '' : 's'} removed${skipped ? ` · ${skipped} skipped` : ''}.`, 'success');
    } else if (deleted) {
      this.selection = null;
      this.renderInspector();
    } else if (skipped) {
      this.toast('Delete', 'No removable object was selected.', 'warn');
    }
  }

  _deleteEntity(type, id) {
    switch (type) {
      case 'node': return this._deleteNode(id);
      case 'link': return this._deleteLink(id);
      case 'controller': {
        if (!this.project.signalControllers.some((c) => c.id === id)) return false;
        this.project.signalHeads = this.project.signalHeads.filter((h) => h.controllerId !== id);
        for (const cw of this.project.crosswalks) if (cw.controllerId === id) cw.controllerId = null;
        this.project.signalControllers = this.project.signalControllers.filter((c) => c.id !== id);
        return true;
      }
      case 'head': {
        const before = this.project.signalHeads.length;
        this.project.signalHeads = this.project.signalHeads.filter((h) => h.id !== id);
        return this.project.signalHeads.length !== before;
      }
      case 'crosswalk': {
        const before = this.project.crosswalks.length;
        this.project.crosswalks = this.project.crosswalks.filter((c) => c.id !== id);
        return this.project.crosswalks.length !== before;
      }
      case 'detector': {
        const before = this.project.detectors.length;
        this.project.detectors = this.project.detectors.filter((d) => d.id !== id);
        return this.project.detectors.length !== before;
      }
      case 'input': {
        const before = this.project.inputs.length;
        this.project.inputs = this.project.inputs.filter((i) => i.id !== id);
        return this.project.inputs.length !== before;
      }
      case 'route': {
        const before = this.project.routes.length;
        this.project.routes = this.project.routes.filter((r) => r.id !== id);
        return this.project.routes.length !== before;
      }
      case 'pt': {
        const before = (this.project.ptLines || []).length;
        this.project.ptLines = (this.project.ptLines || []).filter((l) => l.id !== id);
        return this.project.ptLines.length !== before;
      }
      case 'class': return this._deleteClass(id);
      default: return false;
    }
  }

  _deleteLink(id) {
    const p = this.project;
    if (!p.links.some((l) => l.id === id)) return false;
    p.links = p.links.filter((l) => l.id !== id);
    p.signalHeads = p.signalHeads.filter((h) => h.linkId !== id);
    p.crosswalks = p.crosswalks.filter((c) => c.linkId !== id);
    p.detectors = p.detectors.filter((d) => d.linkId !== id);
    p.inputs = p.inputs.filter((i) => i.linkId !== id);
    for (const controller of p.signalControllers) {
      for (const phase of controller.phases || []) phase.green = (phase.green || []).filter((lid) => lid !== id);
    }
    for (const route of p.routes) route.links = (route.links || []).filter((lid) => lid !== id);
    for (const line of p.ptLines || []) {
      line.route = (line.route || []).filter((lid) => lid !== id);
      line.stops = (line.stops || []).filter((st) => st.linkId !== id);
    }
    return true;
  }

  _deleteNode(id) {
    const p = this.project;
    if (!p.nodes.some((n) => n.id === id)) return false;
    for (const link of [...p.links]) {
      if (link.from === id || link.to === id) this._deleteLink(link.id);
    }
    p.nodes = p.nodes.filter((n) => n.id !== id);
    return true;
  }

  _deleteClass(id) {
    const p = this.project;
    if (p.classes.length <= 1) {
      this.toast('Vehicle class', 'At least one vehicle class must remain.', 'warn');
      return false;
    }
    if (!p.classes.some((c) => c.id === id)) return false;
    p.classes = p.classes.filter((c) => c.id !== id);
    const fallback = p.classes[0]?.id;
    for (const input of p.inputs) {
      if (input.composition) delete input.composition[id];
    }
    for (const line of p.ptLines || []) if (line.classId === id) line.classId = fallback;
    return true;
  }

  duplicateSelection() {
    if (!this.selection) { this.toast('Duplicate', 'Select an object first.', 'warn'); return; }
    const items = this.selection.type === 'multi' ? [...this.selection.items] : [this.selection];
    const usable = items.filter((it) => it.type !== 'run');
    if (!usable.length) { this.toast('Duplicate', 'Recorded runs cannot be duplicated.', 'warn'); return; }
    this.checkpoint('Duplicate selection');
    const created = [];
    for (const item of usable) {
      const next = this._duplicateEntity(item.type, item.id);
      if (next) created.push(next);
    }
    if (!created.length) { this.toast('Duplicate', 'Nothing could be duplicated.', 'warn'); return; }
    const selection = created.length === 1 ? created[0] : { type: 'multi', items: created };
    this.selection = selection.type === 'multi' ? selection : { type: selection.type, id: selection.id };
    this.afterGeometryChange({ select: selection, resetSim: true });
    this.toast('Duplicated', `${created.length} object${created.length === 1 ? '' : 's'} created.`, 'success');
  }

  _duplicateEntity(type, id) {
    const p = this.project;
    const entity = this.findEntity(type, id);
    if (!entity) return null;
    const push = (collection, obj) => { p[collection].push(obj); return { type, id: obj.id }; };
    switch (type) {
      case 'link': {
        const newId = nextEntityId(p, 'links', 'L');
        const from = nextEntityId(p, 'nodes', 'N');
        p.nodes.push({ ...deepClone(p.nodes.find((n) => n.id === entity.from) || {}), id: from, x: (entity.points[0]?.x || 0) + 16, y: (entity.points[0]?.y || 0) + 16, name: `Junction ${from.replace(/^N/, '')}` });
        const to = nextEntityId(p, 'nodes', 'N');
        const lastPt = entity.points[entity.points.length - 1] || { x: 0, y: 0 };
        p.nodes.push({ ...deepClone(p.nodes.find((n) => n.id === entity.to) || {}), id: to, x: lastPt.x + 16, y: lastPt.y + 16, name: `Junction ${to.replace(/^N/, '')}` });
        const clone = deepClone(entity);
        clone.id = newId;
        clone.name = `${entity.name} copy`;
        clone.from = from;
        clone.to = to;
        clone.points = entity.points.map((pt) => ({ x: pt.x + 16, y: pt.y + 16 }));
        p.links.push(clone);
        return { type, id: newId };
      }
      case 'node': {
        const newId = nextEntityId(p, 'nodes', 'N');
        p.nodes.push({ ...deepClone(entity), id: newId, name: `${entity.name} copy`, x: entity.x + 20, y: entity.y + 20 });
        return { type, id: newId };
      }
      case 'controller': {
        const clone = deepClone(entity);
        clone.id = nextEntityId(p, 'signalControllers', 'SC');
        clone.name = `${entity.name} copy`;
        clone.phases = (clone.phases || []).map((ph) => ({ ...ph }));
        p.signalControllers.push(clone);
        return { type, id: clone.id };
      }
      case 'head': {
        const clone = deepClone(entity);
        clone.id = nextEntityId(p, 'signalHeads', 'SH');
        clone.name = `${entity.name} copy`;
        clone.pos = clamp((entity.pos || 0.955) + 0.02, 0.1, 0.995);
        p.signalHeads.push(clone);
        return { type, id: clone.id };
      }
      case 'crosswalk': {
        const clone = deepClone(entity);
        clone.id = nextEntityId(p, 'crosswalks', 'CW');
        clone.name = `${entity.name} copy`;
        clone.pos = clamp((entity.pos || 0.8) + 0.03, 0.02, 0.98);
        p.crosswalks.push(clone);
        return { type, id: clone.id };
      }
      case 'detector': {
        const clone = deepClone(entity);
        clone.id = nextEntityId(p, 'detectors', 'D');
        clone.name = `${entity.name} copy`;
        clone.pos = clamp((entity.pos || 0.6) + 0.03, 0.02, 0.98);
        p.detectors.push(clone);
        return { type, id: clone.id };
      }
      case 'input': {
        const clone = deepClone(entity);
        clone.id = nextEntityId(p, 'inputs', 'VI');
        clone.name = `${entity.name} copy`;
        p.inputs.push(clone);
        return { type, id: clone.id };
      }
      case 'route': {
        const clone = deepClone(entity);
        clone.id = nextEntityId(p, 'routes', 'R');
        clone.name = `${entity.name} copy`;
        clone.links = [...(clone.links || [])];
        p.routes.push(clone);
        return { type, id: clone.id };
      }
      case 'pt': {
        const clone = deepClone(entity);
        clone.id = nextEntityId(p, 'ptLines', 'PT');
        clone.name = `${entity.name} copy`;
        p.ptLines.push(clone);
        return { type, id: clone.id };
      }
      case 'class': {
        const clone = deepClone(entity);
        clone.id = nextEntityId(p, 'classes', 'VC_');
        clone.name = `${entity.name} copy`;
        p.classes.push(clone);
        return { type, id: clone.id };
      }
      default: return null;
    }
  }

  // -------------------------------------------------------------- keyboard
  _bindKeyboard() {
    const typing = (target) => target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    document.addEventListener('keydown', (e) => {
      const target = e.target;
      const isTyping = typing(target);
      const mod = e.ctrlKey || e.metaKey;

      if (e.key === 'Escape') {
        this._hideContextMenu();
        document.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
        const modal = document.getElementById('modal-root');
        if (modal && !modal.classList.contains('hidden')) { closeModal(this); return; }
        const overlay = document.getElementById('analysis-overlay');
        if (overlay && !overlay.classList.contains('hidden')) { this.closeAnalysis(); return; }
        if (!isTyping && this.editor?.draft) { this.editor.draft = null; this.setStatus('Link drawing cancelled'); return; }
        if (!isTyping) this.clearSelection();
        return;
      }

      if (mod) {
        const k = e.key.toLowerCase();
        if (k === 's') { e.preventDefault(); this.saveProjectToStorage(true); return; }
        if (isTyping) return;
        if (k === 'o') { e.preventDefault(); pickProjectFile(this, 'project'); return; }
        if (k === 'n') { e.preventDefault(); this.checkpoint('New project'); showNewProject(this); return; }
        if (k === 'd') { e.preventDefault(); this.duplicateSelection(); return; }
        if (k === 'a') { e.preventDefault(); this.selectAll(); return; }
        if (k === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
        if (k === 'y') { e.preventDefault(); this.redo(); return; }
        return;
      }
      if (isTyping) return;
      const modal = document.getElementById('modal-root');
      if (modal && !modal.classList.contains('hidden')) return;
      const overlay = document.getElementById('analysis-overlay');
      if (overlay && !overlay.classList.contains('hidden')) return;
      if (e.repeat) return;

      if (e.key === '?') { e.preventDefault(); showShortcuts(this); return; }
      if (e.key === '/') { e.preventDefault(); document.getElementById('search-input')?.focus(); return; }
      if (e.key === 'Space' || e.code === 'Space') { e.preventDefault(); this.togglePlay(); return; }
      if (e.key === '+' || e.key === '=') { this.editor.zoomIn(); return; }
      if (e.key === '-' || e.key === '_') { this.editor.zoomOut(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSelection(); return; }
      if (e.shiftKey) {
        const k = e.key.toUpperCase();
        if (k === 'G') { this.toggleDisplay('grid'); return; }
        if (k === 'L') { this.toggleDisplay('labels'); return; }
        if (k === 'T') { this.toggleDisplay('connectors'); return; }
        if (k === 'V') { showValidation(this); return; }
        if (k === 'B') { showBatch(this); return; }
      }
      switch (e.key.toLowerCase()) {
        case 'v': this.setTool('select'); break;
        case 'n': this.setTool('node'); break;
        case 'l': this.setTool('link'); break;
        case 'g': this.setTool('signal'); break;
        case 'd': this.setTool('detector'); break;
        case 'c': this.setTool('crosswalk'); break;
        case 's': this.stepSim(); break;
        case 'r': this.resetSimulation(); break;
        case 'e': this.openAnalysis('overview'); break;
        case 'f': this.editor.fit(); break;
        case '1': this.setMode('network'); break;
        case '2': this.setMode('demand'); break;
        case '3': this.setMode('3d'); break;
        case '4': this.setMode('control'); break;
        case '5': this.setMode('evaluation'); break;
        default: break;
      }
    });
  }

  onTimeOfDayChange(hour) {
    this.project.settings.timeOfDay = hour;
    this.markDirty();
  }

  save() { this.saveProjectToStorage(true); }

  toggleDisplay(key) {
    if (key === 'grid') { this.editor.toggleGrid(); this.ui.grid = this.editor.grid; }
    else if (key === 'labels') { this.editor.toggleLabels(); this.ui.labels = this.editor.labels; }
    else if (key === 'connectors') { this.editor.toggleConnectors(); this.ui.connectors = this.editor.connectors; }
    this.persistUi();
    this.renderInspector();
  }

  // ----------------------------------------------------------------- toast
  toast(title, message = '', kind = 'info') {
    const stack = document.getElementById('toasts');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = `<span>${icon(kind === 'success' ? 'check' : kind === 'warn' ? 'warning' : kind === 'error' ? 'close' : 'info')}</span><div><b></b><span></span></div>`;
    el.querySelector('b').textContent = title;
    el.querySelector('div span').textContent = message;
    stack.appendChild(el);
    while (stack.children.length > 4) stack.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 240);
    }, 3800);
  }
}
