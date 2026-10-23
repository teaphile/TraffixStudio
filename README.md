# TRAFFIX STUDIO

An independent, browser-based microscopic traffic simulation workspace inspired by the PTV Vissim modelling workflow. It runs entirely on plain HTML, CSS, ES modules and canvas — no build step, no framework, no external services.

> **TRAFFIX STUDIO is an original educational project. It is not affiliated with, endorsed by or compatible with PTV Group. “Vissim” is a trademark of PTV Group. This repository contains no proprietary PTV code, assets or file-format implementations, and its results are not a substitute for a calibrated professional Vissim model.**

---

## Highlights

- **Network editor** — draw junctions and multi-point links, reshape geometry, assign lanes, lane width, speed, priority and display options. Undo/redo, duplication, multi-select, context menus and an object explorer.
- **Microscopic traffic engine** — IDM car-following, MOBIL-inspired lane changes, class-specific driver behaviour, conflict-aware junction turns and deterministic seeded randomness.
- **Demand** — time-windowed vehicle inputs, per-class composition, explicit routes and stochastic destination choice.
- **Signal control** — fixed-time and vehicle-actuated controllers, amber/all-red intervals, min/max green, pedestrian walk phases, per-controller offsets, right-turn-on-red option.
- **Pedestrians and transit** — crossing demand with queuing and vehicle yielding; bus lines with headway, route, stops and dwell time.
- **Evaluation** — warm-up-aware trips and KPIs, link/class/detector tables, time series, batch replications, run comparison, CSV export and a printable report.
- **2D and 3D views** — canvas plan view with lane geometry and live vehicles; procedural 3D city with orbit camera, time-of-day lighting and live traffic.
- **Project workflow** — browser autosave, JSON project import/export, GeoJSON network import, validation checks and keyboard-driven editing.

## Quick start

**Requirements:** Node.js 18 or newer and a modern browser with ES-module support.

```bash
cd traffix-studio
npm start
```

Open **http://localhost:4173**.

`npm start` only serves static files; there is no compilation or package installation step.

The **Riverside Boulevard** demo loads on first launch. It contains 14 links, 8 junctions, 2 signal controllers, 2 pedestrian crossings, 4 loop detectors, 6 vehicle inputs and a bus line. Press **Space** to run, or scrub the timeline to the end for an instant complete run.

### Tests

```bash
npm test
```

The suite exercises project validation, GeoJSON conversion, network geometry/routing, signal timing, seeded determinism and a full 900 s simulation run.

**Reference demo result** (seed `2026`, Node.js): 467 vehicles spawned (376 inside the measurement window), 413 trips completed (322 measured), 54 active at the end, 1,610 veh/h measured throughput, 47.5 s mean delay, 25.0 km/h mean speed, 38-vehicle maximum queue, 47 measured pedestrian crossings, 13.2 s mean pedestrian kerb wait, 5.04 lane-km and 238.1 veh-km VMT. The model step is 0.1 s and the 900 s run takes about one second outside the browser. These fixture values are asserted by the test suite.

## Using the workspace

### Modes

| Mode | Key | Purpose |
| --- | --- | --- |
| Network | `1` | Draw and edit links, junctions, signals, crossings and detectors. |
| Demand | `2` | Inspect inputs, routes and vehicle classes; select a source link to add demand. |
| Signal Control | `4` | Select controllers and edit phases, offsets and timing plans. |
| 3D View | `3` | Orbit the procedural city and watch the live simulation. |
| Evaluation | `5` / `E` | KPIs, network tables, vehicle classes, detectors, time series and recorded runs. |

### Typical workflow

1. **Draw the network.** Choose the Link tool (`L`) and click to place a polyline. Open endpoints become junctions automatically. The Junction tool (`N`) creates a node directly; the Select tool (`V`) drags nodes and waypoints.
2. **Add demand.** Select a source link and use **Add input** in the inspector. Set volume, active time window, route and class composition. Vehicle classes are editable under Demand.
3. **Control junctions.** With the Signal tool (`G`), click a junction to create a controller and signal heads on incoming links. Edit phases, durations, amber/all-red, min/max green and offsets; switch a controller to actuated mode if desired.
4. **Add pedestrians, detectors and transit.** Place crossings (`C`) and detectors (`D`) on links. A crossing attached to a controller receives its walk interval. Bus lines and stops are configured in the Demand inspector.
5. **Run.** Press **Space** to play at the selected speed, **S** for a one-second step, or **R** to restart. Move the timeline head to scrub. Completed runs are recorded automatically for evaluation.
6. **Evaluate.** Open Evaluation (`E`) for the dashboard, export CSV or print the report. Use **Batch replications** (`Shift+B`) to run 1–30 seeds and compare them in the **Runs** tab.
7. **Save or exchange.** Projects autosave in this browser. `Ctrl+S` saves immediately; File → Export project JSON produces a portable file. GeoJSON linework can seed a new network.

### Controls

| Action | Shortcut |
| --- | --- |
| Run / pause | `Space` |
| Single step (1 s) | `S` |
| Restart simulation | `R` |
| Evaluation | `E` |
| Batch replications | `Shift+B` |
| Validate model | `Shift+V` |
| Select / junction / link / signal / detector / crossing | `V` / `N` / `L` / `G` / `D` / `C` |
| Fit network | `F` |
| Toggle grid / labels / turn paths | `Shift+G` / `Shift+L` / `Shift+T` |
| Network / demand / 3D / control / evaluation mode | `1` / `2` / `3` / `4` / `5` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) |
| Save / open / new project | `Ctrl+S` / `Ctrl+O` / `Ctrl+N` |
| Duplicate / select all / delete | `Ctrl+D` / `Ctrl+A` / `Del` |
| Deselect | `Esc` |
| Find object | `/` |
| Zoom in / out | `+` / `-` |
| Shortcut reference | `?` |

**3D camera:** drag to orbit, `Shift`-drag (or middle-drag) to pan, scroll to zoom. The time-of-day slider changes the scene lighting.

## Project data and files

- **Autosave:** the current project is persisted to `localStorage` under `traffix-studio.project.v1`; UI preferences use `traffix-studio.ui.v1`. No project data leaves the browser.
- **Project JSON:** the native format is the plain object described by `createEmptyProject()` in `js/core/project.js`. Imports pass through `validateProject()`, which supplies defaults, repairs missing nodes and rejects malformed payloads.
- **GeoJSON:** `LineString`, `MultiLineString`, `Point` and `MultiPoint` features are supported. `lanes`, `speed`/`speed_limit`, `name` and `highway` properties are read where present. Longitude/latitude coordinates are projected to a local metric plane. The import creates geometry only — demand, control plans and calibration are not implied.
- **Results CSV:** exports summary KPIs, link performance, vehicle classes, detector statistics and the full time series.
- **Recorded runs:** kept in memory for the session (up to 80); export the project or CSV if you need to retain results.

## Architecture

```text
traffix-studio/
├── index.html              UI shell and static markup
├── css/app.css             Dark workspace theme, panels, modals, print layout
├── server.js               Dependency-free static server (port 4173)
├── js/
│   ├── main.js             Boot entry point
│   ├── icons.js            Inline SVG icon set
│   ├── core/
│   │   ├── utils.js        PRNG, geometry helpers, formatting, CSV
│   │   ├── geometry.js     Centreline sampling, offsets, turn curves
│   │   ├── project.js      Schema, defaults, demo model, validation
│   │   ├── network.js      Runtime graph, lanes, connectors, routing
│   │   ├── signals.js      Fixed-time, actuated and offset control
│   │   ├── simulation.js   Microscopic engine and vehicle lifecycle
│   │   ├── evaluation.js   KPIs, time series, detectors, emissions
│   │   └── storage.js      localStorage persistence
│   └── ui/
│       ├── app.js          Application state, playback, history, commands
│       ├── editor.js       2D canvas editor and live rendering
│       ├── view3d.js       Procedural 3D renderer and camera
│       ├── inspector.js    Context-sensitive property editors
│       ├── analysis.js     Evaluation dashboard
│       ├── charts.js       Canvas chart primitives
│       ├── dialogs.js      Modals, quick start, feature coverage
│       ├── explorer.js     Object tree and filtering
│       ├── fileops.js      Project/GeoJSON import, JSON/CSV export
│       └── interactions.js DOM event wiring and inspector actions
└── test/engine.test.mjs    Dependency-free core test suite
```

The editable project object is the single source of truth. `Network` derives lane geometry, turn paths and routing from it; `Simulation` owns runtime vehicles, signals and measurement state; UI modules read the project and simulation snapshots. Structural edits invalidate the simulation and recorded network state.

## Simulation model

- **Car following:** Intelligent Driver Model (IDM) with class-specific desired speed, acceleration, deceleration, minimum gap, headway and driver heterogeneity.
- **Lane changes:** MOBIL-inspired gap checks with turn-lane preparation and animated lateral movement. There is no full MOBIL politeness/acceleration optimisation.
- **Junctions:** vehicles reserve conflict-safe turn paths; entry into the downstream link requires a safe gap. Unsignalised priority is deliberately simplified (see `FEATURES.md`).
- **Signals:** cyclic phase plans with green, amber and all-red windows. Fixed plans use a controller offset; actuated plans extend/shorten green against approach demand within min/max bounds. Pedestrian walk intervals follow the controlling phase.
- **Pedestrians:** crossing arrivals are generated from the configured flow, queue at the kerb, cross during walk intervals and cause vehicles to yield while on the road.
- **Transit:** bus vehicles spawn on a line route at the configured headway, stop at line stops and dwell for the configured time. There is no timetable or passenger boarding model.
- **Measurement:** warm-up time is excluded from trip-level statistics, pedestrian crossings and kerb wait, link travel times and detector flow. Network speed, distance, VMT, fuel and emissions cover all vehicles active inside the measurement window. Time series are sampled at the configured interval. Fuel, CO₂ and NOₓ (grams) are compact speed/acceleration-based estimates, not certified emissions models.
- **Determinism:** a seeded `mulberry32` PRNG drives arrivals, destinations, driver attributes and lane decisions. The same project and seed reproduce the same run.

## Limitations

TRAFFIX STUDIO is an independent learning tool, not a PTV Vissim replacement. In particular:

- No `.inpx`/`.inp` import/export, COM automation or PTV model compatibility.
- No dynamic assignment, OD matrices, matrix estimation or calibrated route choice.
- No Viswalk-scale pedestrian crowd model, social forces or BIM/CAD import.
- No NEMA/SC detector logic, transit signal priority, rail or detailed priority-rank calibration.
- Results depend on plausible default parameters, not on local calibration or field data.

See [`FEATURES.md`](FEATURES.md) for the detailed implemented / simplified / excluded matrix, and the in-app **Help → Feature coverage** dialog.

## License and trademark

Project code is released under the MIT license. “Vissim” and “PTV” are trademarks of PTV Group. This project is independent and is not affiliated with, endorsed by or sponsored by PTV Group.
