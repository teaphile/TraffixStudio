# Feature coverage

This document is an honest map of what **TRAFFIX STUDIO** implements, what it deliberately simplifies, and what it does not attempt. TRAFFIX STUDIO is an original, independent project — not a PTV Vissim build or a compatible replacement.

**Status key:** ✅ implemented · ◐ implemented with a deliberate simplification · ○ not included

## Module matrix

| Area | Status | What is present |
| --- | --- | --- |
| Project and file workflow | ✅ | New project, Riverside demo, browser autosave, JSON import/export, GeoJSON network import, CSV results export, print report. |
| Network editing | ✅ | Junction and link creation, multi-point link geometry, lane counts (1–8), lane width, speed, type, display flags, duplicate/delete, multi-select, undo/redo. |
| Network graph | ✅ | Derived centreline and lane geometry, turn curves, lane offsets, shortest-path routing, source/sink detection, connectivity checks. |
| Demand | ✅ | Time-windowed inputs, volume, per-class composition, explicit routes, stochastic destination choice, class editing. |
| Car following | ✅ | IDM with desired speed, acceleration, deceleration, minimum gap, headway, reaction and driver heterogeneity. |
| Lane changing | ◐ | MOBIL-inspired front/rear gap checks, turn-lane preparation and lateral animation. No full MOBIL politeness/acceleration optimisation or mandatory route lanes. |
| Junction control | ◐ | Conflict-aware turn reservation and downstream entry gaps; stop-controlled nodes; signalised nodes. Priority ranks are not calibrated (see below). |
| Signals | ✅ | Fixed-time and vehicle-actuated controllers, phase green/amber/all-red, min/max green, offsets, pedestrian walk phases, right-turn-on-red option. |
| Signal coordination | ◐ | Controllers share a cycle clock and can be offset for a green wave. No automatic bandwidth optimisation or network-wide plan generator. |
| Pedestrians | ◐ | Crossing demand, kerb queues, walk intervals, vehicle yielding, pedestrian kerb wait and queue statistics. No social-force or Viswalk-scale crowd model. |
| Public transport | ◐ | Bus lines with route, headway, stops and dwell time. No timetable, passenger boarding/alighting or transit signal priority. |
| Detectors | ✅ | Inductive loop, radar and video labels; lane-specific position/length; count, flow and occupancy statistics. Detection logic is the same simple presence/crossing model for all three labels. |
| Evaluation | ✅ | Warm-up-aware KPIs, link and class tables, detector statistics, time series, run recording, batch seeds, run comparison, CSV and print. |
| Emissions | ◐ | Fuel, CO₂ and NOₓ estimates from speed and acceleration. Compact engineering model, not a certified emissions tool. |
| 2D visualisation | ✅ | Lane geometry, road markings, crossings, detectors, signals, labels, turn paths, live vehicles and pedestrians, grid, pan/zoom. |
| 3D visualisation | ◐ | Procedural city, roads, buildings, trees, signals and live vehicle boxes; orbit/pan/zoom; time-of-day palette. No WebGL, imported BIM/CAD or dynamic shadows. |
| Validation | ✅ | Structural checks for links, nodes, duplicate IDs, dangling crossings/detectors/signals/routes/transit references, demand, controller cycles, geometry and disconnected components. |
| Batch and comparison | ✅ | 1–30 replications with sequential seeds, progress feedback, comparison tab and per-run deletion. |
| PTV compatibility | ○ | No `.inpx`/`.inp`, COM automation, proprietary formats or PTV model internals. |

## Implemented in detail

### Network and demand

- **Nodes:** junction, boundary and priority labels; editable coordinates and radius. Moving a junction updates the endpoints of connected links.
- **Links:** two or more geometry points, 1–8 lanes, lane width, speed limit, priority, attraction, grade, sidewalk and visibility flags, and link type labels.
- **Editing:** create with tools, drag nodes/waypoints, double-click a link to add a waypoint, context menus, duplication, multi-select, delete with dependency cleanup and undo/redo.
- **Routing:** per-destination shortest path with turn penalties. The project setting offers **shortest travel time**, **shortest distance** and **uniform stochastic destination** modes. Inputs can override routing with an explicit route.
- **Demand inputs:** active time window, volume, route and weighted vehicle-class composition. The demo uses six inputs across the boundary links.
- **Vehicle classes:** editable name, colour, category, dimensions, desired speed, acceleration, deceleration, minimum gap, headway, reaction, behaviour label and weight.
- **Validation:** missing links/nodes, duplicate IDs, bad geometry, empty/negative controller phases, dangling crossings, detectors, signal heads, routes and transit stops, zero cycles, missing inputs and disconnected components are reported as errors or warnings.

### Traffic engine

- **Determinism:** every random decision uses a seeded `mulberry32` generator. The same project and seed reproduce the same run, which the test suite checks.
- **IDM car following:** class-specific parameters plus per-driver desired-speed and headway variation.
- **Gap-safe junctions:** a vehicle about to turn reserves a turn path. Conflicting transitions at the same node are held unless the movement is a safe follow-on. Downstream entry requires a minimum gap.
- **Stop control:** a node with control `stop` creates an all-way stop constraint with a short dwell before proceeding.
- **Signals:** fixed-time plans follow the cycle + offset clock. Actuated plans use approach demand, min green, max green and a 3 s gap-out rule. Amber and all-red are explicit phase fields.
- **Pedestrians:** arrivals are generated from the configured flow; queues are limited to prevent unbounded growth. A linked controller supplies the walk interval. Vehicles yield while pedestrians are on the carriageway. Disabling **Vehicles yield at crossings** makes pedestrians wait for a gap at uncontrolled crossings.
- **Transit:** line vehicles are injected independently of normal demand, follow the configured route, stop at matching stops and dwell. Buses are visually distinct and counted as a vehicle class.
- **Right turn on red:** optional; a right-turning vehicle may proceed on red only when no pedestrian crossing is blocking the movement.
- **Detectors:** a vehicle crossing the detector position increments the count; occupancy is sampled from presence in a short detection window.
- **Emissions:** fuel rate combines idle, rolling, aerodynamic and acceleration terms, scaled by vehicle category; CO₂ and NOₓ are derived estimates.

### Measurement and reporting

- **Warm-up handling:** trip-level travel, delay, stops and stopped time exclude warm-up trips. Pedestrian crossings and kerb queue wait, link travel-time samples and detector flow also use only activity after warm-up. Link entered/exited totals are retained, while flow and the displayed “window” columns use post-warm-up counters.
- **Network exposure:** mean network speed, distance, VMT, fuel, CO₂ and NOₓ include every vehicle active during the measurement window, including vehicles that entered before warm-up. Emissions are reported as CO₂ in kilograms and NOₓ in grams.
- **KPIs:** spawned/completed trips, throughput, mean travel time, mean delay, mean speed, stopped time, stops, max/current queue, distance, VMT, lane-km, fuel, CO₂, NOₓ, pedestrian crossings, pedestrian kerb wait and pedestrian queue.
- **Tables:** per-link entered/exited/flow/travel/delay/speed/density/queue; per-class share, delay, speed, stops, distance and fuel; per-detector count/flow/occupancy.
- **Time series:** active vehicles, post-warm-up cohort size, sampled mean speed, queue, interval throughput and pedestrian counts at the configured interval.
- **Runs:** completed simulations are recorded in memory for the session. Batch replications use sequential seeds and can be compared and deleted.
- **Exports:** project JSON, results CSV and browser print layout.

### 2D and 3D

- **2D:** canvas-rendered network with lane offsets, markings, stop lines, crossings, detectors, signal heads, turn paths, labels, selection highlighting and a live simulation overlay.
- **3D:** lightweight painter's-algorithm renderer. It creates roads, lane markings, crossings, buildings, windows, trees, signal poles, clouds and a skyline from the project geometry. The camera supports orbit, pan and zoom; the time-of-day slider changes the sky/lighting palette.
- **Performance:** no WebGL or external 3D library. The 3D scene is rebuilt when the network changes, while vehicles are drawn from live simulation state each frame.

## Deliberately simplified

These areas are functional but **must not be presented as calibrated professional models**:

1. **Junction priority and gap acceptance.** Conflict checks and downstream gaps prevent most collisions, and stop nodes work. There is no priority-rank calibration, right-of-way hierarchy, unsignalised critical-gap distribution or dedicated yield model. The link `priority` field is stored for documentation but does not override conflict reservations.
2. **Signal head movements.** A controller's phase references green links. Movement labels on individual heads are stored for documentation; the engine evaluates the link state, not separate through/left/right displays.
3. **Coordination.** Offsets provide coordinated plans. The `coordinated` checkbox marks intent; there is no automatic green-wave optimiser, cycle-split optimiser or network plan generator.
4. **Lane changing.** The heuristic is inspired by MOBIL but is not a complete implementation: there is no explicit politeness factor, acceleration-based safety criterion or mandatory lane assignment beyond turn preparation.
5. **Pedestrians.** Crossing flow, queues and walk phases are simulated. This is not a social-force or Viswalk-compatible crowd model; there are no waiting areas, stairs, platforms or detailed walking networks.
6. **Transit.** Buses follow routes and dwell at stops. There is no public-transport timetable, passenger demand, boarding time, vehicle capacity or transit signal priority.
7. **Emissions and fuel.** Estimates are comparative indicators only. They are not COPERT/MOVES/ HBEFA implementations and are not suitable for regulatory reporting.
8. **Routing and assignment.** Destination choice is stochastic or attraction-weighted; explicit routes are supported. There is no dynamic assignment, OD matrix, matrix estimation, equilibrium route choice or time-dependent route cost feedback.
9. **Calibration.** Defaults are plausible engineering values, not calibrated to a city, corridor or field dataset. Validation does not prove operational realism.
10. **3D.** The scene is procedural and illustrative. Buildings are not real footprints, and there is no BIM/CAD import, material system, shadow mapping or WebGL pipeline.

## Not included

- PTV Vissim `.inpx`/`.inp` project files, PTV COM automation, proprietary libraries or model internals.
- Dynamic traffic assignment, OD matrices, matrix estimation and route-choice calibration.
- Viswalk pedestrian dynamics, crowd simulation, social forces and detailed pedestrian infrastructure.
- NEMA/SC controller emulation, detector logic cards, transit signal priority, railway or tram modelling.
- Imported BIM, CAD, GIS scene assets or signal-head geometry.
- Multi-user collaboration, server-side simulation jobs or cloud storage.
- Guaranteed city-scale performance. The bundled 14-link demo runs a 900 s simulation in roughly one second under Node.js; larger networks and browser rendering will be slower.

## Verification

`npm test` runs 12 dependency-free core tests covering:

- deterministic utility helpers and CSV escaping;
- demo project counts and defaults;
- project import validation and node reconstruction;
- duplicate-ID and dangling-reference validation;
- lane geometry, turn classification, routing modes and graph connectivity;
- fixed-time and coordinated signal phase windows plus actuated progression;
- seeded simulation determinism;
- pedestrian yield behaviour;
- a full 900 s demo run with finite KPI checks;
- partial-run finalisation between sampling instants;
- GeoJSON linework/property conversion and shared junction handling;
- empty-project validation warnings.

The test fixture asserts the documented demo result: 467 spawned (376 in window), 413 completed (322 in window), 54 active, 1,610 veh/h throughput, 38 maximum queue, 25.0 km/h mean speed, 47 measured pedestrian crossings and 13.2 s mean pedestrian kerb wait at seed 2026. Changing engine parameters can change these numbers; update the fixture, README and this document together if the model is intentionally retuned.
