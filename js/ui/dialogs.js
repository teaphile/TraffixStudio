import { icon } from '../icons.js';
import { escapeHtml as esc, fmtClock, fmtNum } from '../core/utils.js';

export function openModal(app, opts = {}) {
  const root = document.getElementById('modal-root');
  if (!root) return null;
  root.classList.remove('hidden');
  root.innerHTML = `
    <div class="modal ${opts.size || ''}" role="dialog" aria-modal="true" aria-label="${esc(opts.title || 'Dialog')}">
      <div class="modal-head">
        <div>
          <h2>${esc(opts.title || '')}</h2>
          ${opts.subtitle ? `<p>${esc(opts.subtitle)}</p>` : ''}
        </div>
        <button class="icon-btn" data-modal-close title="Close">${icon('close')}</button>
      </div>
      <div class="modal-body">${opts.body || ''}</div>
      ${opts.footer ? `<div class="modal-foot">${opts.footer}</div>` : ''}
    </div>`;
  root.onclick = (e) => {
    if (e.target === root) closeModal(app);
  };
  root.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModal(app));
  app.modal = root;
  opts.onMount?.(root);
  return root;
}

export function closeModal(app) {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.classList.add('hidden');
  root.innerHTML = '';
  app.modal = null;
}

// ------------------------------------------------------------------ new project
export function showNewProject(app) {
  openModal(app, {
    title: 'New project',
    subtitle: 'Create a blank network or start from the bundled Riverside demo.',
    size: 'small',
    body: `
      <div class="form-section">
        <div class="form-field"><label>Project name</label><input id="new-project-name" value="Untitled Network" spellcheck="false" /></div>
      </div>
      <div class="form-section">
        <h3>Starting point</h3>
        <label class="check-row" style="border:1px solid var(--line);border-radius:7px;padding:9px;margin-bottom:6px"><input type="radio" name="new-template" value="empty" checked /> <span><b>Empty network</b><br><small class="muted">Start with no links and build your own corridor.</small></span></label>
        <label class="check-row" style="border:1px solid var(--line);border-radius:7px;padding:9px"><input type="radio" name="new-template" value="demo" /> <span><b>Riverside demo</b><br><small class="muted">14 links, two signalised junctions, bus line and crossings.</small></span></label>
      </div>`,
    footer: `<span class="left">Current project is kept in undo history.</span>
      <button class="btn ghost" data-modal-close>Cancel</button>
      <button class="btn primary" id="create-project-btn">${icon('plus')} Create project</button>`,
    onMount(root) {
      root.querySelector('#create-project-btn').addEventListener('click', () => {
        const name = root.querySelector('#new-project-name').value.trim() || 'Untitled Network';
        const template = root.querySelector('input[name="new-template"]:checked')?.value || 'empty';
        closeModal(app);
        app.createNewProject(name, template);
      });
    },
  });
}

// ---------------------------------------------------------------------- batch
export function showBatch(app) {
  const s = app.project.settings;
  const root = openModal(app, {
    title: 'Batch replications',
    subtitle: 'Repeat the simulation with independent random seeds and compare variability.',
    body: `
      <div class="form-grid">
        <div class="form-field"><label>Number of runs</label><input id="batch-count" type="number" min="1" max="30" step="1" value="${Math.max(1, Math.min(30, s.batchRuns || 3))}" /></div>
        <div class="form-field"><label>Base seed</label><input id="batch-seed" type="number" min="1" max="999999" step="1" value="${s.seed || 2026}" /></div>
        <div class="form-field"><label>Duration</label><input value="${fmtClock(s.duration)}" readonly /></div>
        <div class="form-field"><label>Warm-up</label><input value="${fmtClock(s.warmup)}" readonly /></div>
      </div>
      <div class="report-note" style="margin-top:12px"><b>Runtime note:</b> each replication runs the full microscopic model in the browser. A 15-minute demo run typically takes a few seconds. The workspace stays responsive between replications.</div>
      <div id="batch-progress" class="hidden" style="margin-top:14px">
        <div class="field-row"><label id="batch-status">Preparing…</label><span class="mono" id="batch-percent">0%</span></div>
        <div class="progress-line"><i id="batch-bar" style="width:0%"></i></div>
        <div class="stat-grid" id="batch-live" style="margin-top:10px"></div>
      </div>`,
    footer: `<span class="left" id="batch-foot">Seeds <b>${s.seed || 2026}</b> to <b>${(s.seed || 2026) + Math.max(1, s.batchRuns || 3) - 1}</b></span>
      <button class="btn ghost" data-modal-close>Close</button>
      <button class="btn primary" id="batch-start">${icon('beaker')} Start batch</button>`,
    onMount(modal) {
      const start = modal.querySelector('#batch-start');
      start.addEventListener('click', async () => {
        const runs = Math.max(1, Math.min(30, Number(modal.querySelector('#batch-count').value) || 3));
        const seed = Math.max(1, Number(modal.querySelector('#batch-seed').value) || s.seed || 2026);
        start.disabled = true;
        start.innerHTML = `${icon('beaker')} Running…`;
        modal.querySelector('#batch-progress').classList.remove('hidden');
        try {
          await app.startBatch({ runs, seed }, (done, total, latest) => {
            const pct = total ? Math.round(done / total * 100) : 0;
            const status = modal.querySelector('#batch-status');
            const percent = modal.querySelector('#batch-percent');
            const bar = modal.querySelector('#batch-bar');
            const live = modal.querySelector('#batch-live');
            if (status) status.textContent = done < total ? `Replication ${done + 1} of ${total}…` : 'Batch complete';
            if (percent) percent.textContent = `${pct}%`;
            if (bar) bar.style.width = `${pct}%`;
            if (live && latest) {
              const sm = latest.summary;
              live.innerHTML = `
                <div class="stat-cell"><span>Completed</span><b>${fmtNum(sm.completedMeasured)}</b></div>
                <div class="stat-cell"><span>Throughput</span><b>${fmtNum(sm.throughput)} <em>veh/h</em></b></div>
                <div class="stat-cell"><span>Mean delay</span><b>${sm.avgDelay.toFixed(1)} <em>s</em></b></div>
                <div class="stat-cell"><span>Mean speed</span><b>${sm.avgSpeed.toFixed(1)} <em>km/h</em></b></div>`;
            }
          });
          const foot = modal.querySelector('#batch-foot');
          if (foot) foot.innerHTML = '<b class="text-green">Batch complete.</b> Results are available in the Runs tab.';
          start.innerHTML = `${icon('chart')} Open comparison`;
          start.disabled = false;
          start.onclick = () => {
            closeModal(app);
            app.openAnalysis('compare');
          };
        } catch (err) {
          console.error(err);
          start.disabled = false;
          start.innerHTML = `${icon('beaker')} Retry batch`;
          app.toast('Batch failed', err?.message || String(err), 'error');
        }
      });
    },
  });
  return root;
}

// ----------------------------------------------------------------- validation
export function showValidation(app) {
  const issues = app.network.validate();
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warn').length;
  const ok = errors === 0;
  const rows = issues.length
    ? issues.map((i) => `<div class="feature-row">
        <span style="color:${i.level === 'error' ? 'var(--red)' : 'var(--amber)'};margin-top:1px">${icon(i.level === 'error' ? 'warning' : 'info')}</span>
        <span><b>${i.level === 'error' ? 'Error' : 'Warning'}</b><span>${esc(i.text)}</span></span>
      </div>`).join('')
    : `<div class="feature-row"><span style="color:var(--green)">${icon('check')}</span><span><b>No structural issues found</b><span>Links, inputs, routes, controllers and references passed the built-in checks.</span></span></div>`;
  const counts = app.project.links.length
    ? `${app.project.links.length} links · ${app.project.nodes.length} nodes · ${app.project.inputs.length} inputs · ${app.project.signalControllers.length} controllers`
    : 'The network has no links.';
  openModal(app, {
    title: 'Model validation',
    subtitle: 'Structural checks for links, demand, controllers, references and connectivity.',
    body: `
      <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="kpi-card ${errors ? 'red' : 'green'}"><div class="k-label">Errors</div><div class="k-value">${errors}</div><div class="k-sub">must fix</div></div>
        <div class="kpi-card ${warnings ? 'amber' : 'green'}"><div class="k-label">Warnings</div><div class="k-value">${warnings}</div><div class="k-sub">review</div></div>
        <div class="kpi-card ${ok ? 'green' : 'cyan'}"><div class="k-label">Status</div><div class="k-value" style="font-size:15px">${ok ? 'Ready' : 'Review'}</div><div class="k-sub">${ok ? 'safe to simulate' : 'simulation can still run'}</div></div>
      </div>
      <div class="feature-list" style="margin-top:12px">${rows}</div>
      <div class="report-note">${esc(counts)}. Validation is intentionally lightweight; it does not prove that a model is calibrated or operationally realistic.</div>`,
    footer: `<button class="btn ghost" data-modal-close>Close</button><button class="btn primary" id="revalidate-btn">${icon('check')} Run again</button>`,
    onMount(root) {
      root.querySelector('#revalidate-btn').addEventListener('click', () => showValidation(app));
    },
  });
}

// ------------------------------------------------------------------ quickstart
export function showQuickstart(app) {
  const steps = [
    ['Draw the network', 'Pick the Link tool (L) and click twice. Junctions are created automatically at open endpoints. Drag junction or waypoint handles to reshape geometry.', 'road'],
    ['Add demand', 'Select a source link, open the inspector and choose “Add input”. Set volume and the vehicle-class composition.', 'car'],
    ['Control the junctions', 'Use the Signal tool (G) on a junction to create a controller and heads for every incoming link. Edit phases in the inspector.', 'signal'],
    ['Add pedestrians and detectors', 'Place crossings and loop detectors from the toolbar. Crossings linked to a controller receive a walk interval.', 'crosswalk'],
    ['Run and evaluate', 'Press Space to run, then open Evaluation (E) for KPIs, time series and link tables. Record replications with Batch.', 'chart'],
    ['Explore 3D', 'Switch to 3D View (3). Drag to orbit, Shift-drag to pan, scroll to zoom, and move the time-of-day slider.', 'cube'],
  ];
  openModal(app, {
    title: 'Quick start guide',
    subtitle: 'A five-minute path from an empty canvas to evaluation results.',
    size: 'wide',
    body: `
      <div class="guide-grid">${steps.map(([title, text, ic], i) => `<div class="guide-card"><div class="num">${i + 1}</div><b>${icon(ic)} ${title}</b><p>${text}</p></div>`).join('')}</div>
      <div class="report-note" style="margin-top:13px"><b>Tip:</b> load the Riverside demo from <span class="mono">File → Load demo network</span>. It contains two coordinated signalised junctions, 14 links, a bus line, two pedestrian crossings and four detectors.</div>`,
    footer: `<button class="btn ghost" data-modal-close>Close</button><button class="btn primary" data-action="load-demo">${icon('route')} Load demo</button>`,
  });
}

// ------------------------------------------------------------------- features
export function showFeatures(app) {
  const implemented = [
    ['Network editor', 'Links, junctions, waypoints, lane geometry, lane widths, priorities and display controls.'],
    ['Demand', 'Time-windowed vehicle inputs, class composition, explicit routes and stochastic destination choice.'],
    ['Car following', 'IDM with class-specific acceleration, deceleration, desired speed, minimum gap and driver heterogeneity.'],
    ['Lane changing', 'MOBIL-inspired gap acceptance and turn-lane preparation.'],
    ['Signal control', 'Fixed-time, vehicle-actuated and offset-coordinated controllers with amber/all-red and pedestrian phases.'],
    ['Junctions', 'Conflict-aware turn paths and gap-safe entry into downstream links.'],
    ['Pedestrians', 'Crossing demand, walk intervals, yielding vehicles and pedestrian kerb-wait statistics.'],
    ['Public transport', 'Bus lines with headway, route, stops and dwell time.'],
    ['Detectors', 'Loop/radar/video objects with counts, flow and occupancy statistics.'],
    ['Evaluation', 'Trips, delay, speed, throughput, queues, link/class/detector tables, time series and emission estimates.'],
    ['3D view', 'Procedural 3D city, roads, buildings, trees, signals and live vehicle boxes with an orbit camera.'],
    ['Workflow', 'Undo/redo, autosave, JSON project import/export, GeoJSON network import, CSV results export, batch replications and print.'],
  ];
  const simplified = [
    ['Junction priority', 'Conflict checks prevent most simultaneous crossing movements, but there is no full priority-rank calibration or unsignalised gap-acceptance model.'],
    ['Calibration', 'Parameters are physically plausible defaults, not calibrated to a specific city or to PTV Vissim.'],
    ['Emissions', 'Fuel/CO₂/NOₓ are speed/acceleration estimates from a compact engineering model.'],
    ['3D', 'Procedural visualisation only — no imported BIM, CAD or signal-head geometry.'],
  ];
  const excluded = [
    'PTV Vissim .inpx/.inp project files, COM automation and proprietary model internals.',
    'Dynamic assignment, OD matrices, matrix estimation and route-choice calibration.',
    'Viswalk-scale pedestrian dynamics, social forces and crowd simulation.',
    'SC/ATC detector logic, NEMA controller emulation, transit signal priority and rail.',
  ];
  openModal(app, {
    title: 'Feature coverage',
    subtitle: 'An honest map of what this independent studio implements.',
    size: 'wide',
    body: `
      <div class="disclaimer" style="margin-bottom:14px"><b>Independent project.</b> TRAFFIX STUDIO is an original browser implementation inspired by the microscopic traffic modelling workflow. It is not affiliated with, endorsed by, or compatible with PTV Group or PTV Vissim.</div>
      <div class="form-section"><h3>Implemented</h3><div class="feature-list">${implemented.map(([t, d]) => `<div class="feature-row"><span style="color:var(--green)">${icon('check')}</span><span><b>${t}</b><span>${d}</span></span></div>`).join('')}</div></div>
      <div class="form-section"><h3>Deliberately simplified</h3><div class="feature-list">${simplified.map(([t, d]) => `<div class="feature-row"><span style="color:var(--amber)">${icon('info')}</span><span><b>${t}</b><span>${d}</span></span></div>`).join('')}</div></div>
      <div class="form-section"><h3>Not included</h3><div class="feature-list">${excluded.map((d) => `<div class="feature-row"><span style="color:var(--muted-2)">${icon('close')}</span><span><span>${d}</span></span></div>`).join('')}</div></div>`,
    footer: `<button class="btn ghost" data-modal-close>Close</button><button class="btn primary" data-action="show-about">${icon('info')} About</button>`,
  });
}

// ------------------------------------------------------------------ shortcuts
export function showShortcuts(app) {
  const rows = [
    ['Run / pause', 'Space'], ['Single step', 'S'], ['Restart simulation', 'R'],
    ['Evaluation', 'E'], ['Batch replications', 'Shift+B'], ['Validate model', 'Shift+V'],
    ['Select tool', 'V'], ['Junction tool', 'N'], ['Link tool', 'L'],
    ['Signal tool', 'G'], ['Detector tool', 'D'], ['Crossing tool', 'C'],
    ['Fit network', 'F'], ['Grid', 'Shift+G'], ['Labels', 'Shift+L'],
    ['Turn paths', 'Shift+T'], ['3D view', '3'], ['Network mode', '1'],
    ['Demand mode', '2'], ['Signal control', '4'], ['Delete selection', 'Del'],
    ['Undo', 'Ctrl Z'], ['Redo', 'Ctrl Y'], ['Save project', 'Ctrl S'],
    ['Open project', 'Ctrl O'], ['New project', 'Ctrl N'], ['Duplicate', 'Ctrl D'],
    ['Select all links', 'Ctrl A'], ['Deselect', 'Esc'], ['Find object', '/'],
    ['Zoom in / out', '+ / −'], ['Quick start', '?'],
  ];
  openModal(app, {
    title: 'Keyboard shortcuts',
    subtitle: 'Editor and simulation controls.',
    body: `<div class="shortcut-table">${rows.map(([a, b]) => `<div class="shortcut-row"><span>${a}</span><kbd>${b}</kbd></div>`).join('')}</div>`,
    footer: `<button class="btn ghost" data-modal-close>Close</button>`,
  });
  void app;
}

// ---------------------------------------------------------------------- about
export function showAbout(app) {
  openModal(app, {
    title: 'About TRAFFIX STUDIO',
    subtitle: 'An independent microscopic traffic simulation workspace.',
    size: 'small',
    body: `
      <div class="about-hero">
        <div class="logo-box"><svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#0b131b" stroke="#20303f"/><path d="M14 46 28 18h8l14 28h-8l-3-6H25l-3 6z" fill="#22d3ee"/><path d="M28 34h8l-4-9z" fill="#0b131b"/></svg></div>
        <div><h3>TRAFFIX <span>STUDIO</span></h3><p>Version 1.0 · browser edition</p></div>
      </div>
      <p style="font-size:10.5px;color:var(--muted);line-height:1.7">A dependency-free traffic modelling studio: network editing, microscopic simulation, signal control, pedestrians, transit, evaluation and a procedural 3D city view. Built with plain HTML, CSS, ES modules and canvas.</p>
      <div class="disclaimer" style="margin-top:13px"><b>Not affiliated with PTV Group.</b> “Vissim” is a trademark of PTV Group. This project is an original, independent implementation created for learning and experimentation. It does not contain proprietary PTV code, assets or file formats, and results are not a substitute for a calibrated professional Vissim model.</div>
      <div class="stat-grid" style="margin-top:13px">
        <div class="stat-cell"><span>Engine</span><b>IDM + MOBIL</b></div>
        <div class="stat-cell"><span>Signals</span><b>Fixed / actuated</b></div>
        <div class="stat-cell"><span>Rendering</span><b>Canvas 2D / 3D</b></div>
        <div class="stat-cell"><span>Dependencies</span><b>None</b></div>
      </div>`,
    footer: `<button class="btn ghost" data-modal-close>Close</button><button class="btn primary" data-action="show-features">${icon('layers')} Feature coverage</button>`,
  });
  void app;
}
