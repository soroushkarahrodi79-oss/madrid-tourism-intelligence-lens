# Runtime Decision Spike (K12)

**Issue:** [#74](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/74) · Part of #62 · Gate K §11A–D, §20
**Branch base:** `origin/main` @ `cf85a9b` (K11 / PR #88 merged)
**Nature:** Measurement spike. **Decide, do not migrate.** No library is adopted here.

> **Gate verdict: PARTIAL — device criteria MEASURED on a physical iPad M3
> (DEVICE_VALIDATION). Owner decision recorded 2026-10-17: KEEP Leaflet (A = GO);
> MapLibre stays NOT YET. PR #89 remains Draft per owner instruction.**
> Every environment-independent measurement was always complete and reproducible.
> The acceptance criteria that require *real-device graphics performance*
> (interaction-to-paint, frame time, the Leaflet ceiling crossing, the MapLibre
> comparison) were originally **UNVERIFIED** — the spike first ran in a cloud Linux
> VM whose WebGL renderer is **SwiftShader (software)**. They are now **measured on
> real hardware**: a complete, device-grade **iPad M3 / Safari** run (38/38, 19/19
> comparable, `DEVICE_VALIDATION`) and a partial **Windows / Intel UHD 620** run
> (37/38). **§12 is the evidence-based assessment.** No number in this document is a
> software-rasterised, fabricated or emulated device result. The gate stays PARTIAL
> only because the architectural decision is the **owner's** to confirm (PR #89 is
> Draft); the physical-device criteria themselves are closed for the iPad.

---

## 1. Executive decision summary

| # | Technology | Verdict | One-line basis |
|---|---|---|---|
| **A** | Keep current stack (Leaflet + vanilla JS, no build) | **GO** | Real payload is 2.11 MB gzip; existing canvas renderers handle it. No rewrite justified. |
| **B** | MapLibre GL JS | **NOT YET** (evidence-grounded) | Device-measured (§12): at the **real** data volume Leaflet meets all thresholds on iPad M3 (pan p95 ≤ 30 ms) and neither engine wins universally; MapLibre's advantage appears only at polygon densities ≥ **2 000** (above today's ~724 ámbitos) or on weak integrated-GPU laptops. Trigger (§6.3) not crossed at current load. |
| **C** | DuckDB-WASM | **NO-GO** | Outputs verified identical to plain JS; plain JS is **4.5× faster warm** and needs none of DuckDB's **6.93 MB gzip** engine + multi-second init. |
| **D** | PMTiles | **NOT YET** (slaved to B) | Not decidable independently of MapLibre; it presupposes a vector renderer the product does not have. |
| **D** | GeoParquet | **NO-GO** | No browser consumer without DuckDB-WASM (C = NO-GO); builder-side win is modest and already beaten by partitioning. |

**The real win is not on this list.** Partitioning `madrid_domestic_origins.json`
by month would cut the **feature-equivalent** initial-load transfer by **72.4 %**
(250 KB → 69 KB gzip) — the honest figure, because the CITY *Monthly origin
dynamics* view compares a month to its **exact previous month**, so a
functionally-equivalent first load needs the latest **and** the previous month
(§7.3). A latest-month-only load is lighter still (87.2 %, 32 KB) but is **not**
feature-equivalent — it breaks Dynamics — so it is not a general user-visible
claim. Either way the win is a data-pipeline change, **not** a renderer or query
engine, and the architecture is right.

**Final recommendation (now device-grounded):** keep the current architecture.
Do not adopt MapLibre, PMTiles, DuckDB-WASM or GeoParquet now. The physical iPad M3
run (§12) **confirms** this: at the real data volume Leaflet meets every interaction
threshold on a modern device and B's trigger (§6.3) is **not** crossed. Open a
separate data-pipeline issue for origins partitioning. **Revisit B only if the
roadmap commits to** (i) ámbito/polygon layers materially denser than today
(> ~2 000 simultaneous polygons), where Leaflet pan degrades and MapLibre stays flat,
or (ii) a hard support floor of weak integrated-GPU laptops, where Leaflet already
fails the real-payload pan threshold (§12). Remaining decision blockers: §12.

---

## 2. Current architecture baseline (measured on `cf85a9b`)

### 2.1 Measurement host

All container measurements in this document were taken on:

| | |
|---|---|
| CPU | Intel Xeon @ 2.10 GHz, **4 vCPU** (shared cloud VM) |
| Memory | 15.7 GB |
| Runtime | Node v22.22.0 |
| GPU | **none — WebGL = `ANGLE … SwiftShader` (software rasteriser)** |
| Commit | `cf85a9b` |

Byte sizes and record/vertex counts are hardware-independent. Timings labelled
*CPU-only* are valid as relative comparisons on this host but are **not**
mid-range-laptop or iPad numbers.

### 2.2 Deployed data footprint

`research/runtime_spike/results/baseline_inventory.json` — **16 data files,
24.23 MB raw / 2.11 MB gzip total.**

| Artifact | Kind | Count | Raw | gzip | brotli | Parse (CPU) |
|---|---|---|---|---|---|---|
| `geography/madrid_admin.geojson` | spatial | 153 feat / 31,648 vtx | 2.47 MB | 243 KB | 89 KB | 11 ms |
| `planning/madrid_ambitos.geojson` | spatial | **724 feat / 140,507 vtx** | 3.33 MB | **916 KB** | 526 KB | 23 ms |
| `planning/madrid_urban_licences.json` | tabular | **11,265 rec** | 5.00 MB | 283 KB | 192 KB | 16 ms |
| `destination/madrid_domestic_origins.json` | tabular | 14,811 rec / 7 mo | 3.54 MB | 250 KB | 86 KB | 10 ms |
| `callejero/madrid_ndp_crosswalk.json` | lookup | — | 6.42 MB | 290 KB | 180 KB | 16 ms |

**Corrections to the issue's planning figures** (the point of a measurement
spike): the ámbito layer is **724 features / 140,507 vertices**, not the
estimated "+765 polygons"; the licence layer is **11,265 records**, not
"~11,500". #68 (PR #82) and #71 (PR #85) are both merged and their artifacts are
physically present, so this baseline is **real, not synthetic**.

### 2.3 The `42773bc` historical baseline (for comparison)

| Quantity | `42773bc` | `cf85a9b` (now) |
|---|---|---|
| Admin geography | 153 feat / 31,648 vtx / 2.53 MB | **153 / 31,648 / 2.47 MB** (unchanged) |
| Planning polygons | 0 | **724 / 140,507 vtx** |
| Operational points | 1,470 POI | **11,265** licences |
| Total footprint | 6.6 MB | **24.23 MB raw / 2.11 MB gzip** |
| Renderer | Leaflet 1.9.x, `preferCanvas`, per-pane `L.canvas()` | **identical** |

### 2.4 Rendering & delivery architecture (as audited in `js/app.js`)

- **Leaflet 1.9.x, vendored** at `assets/leaflet/leaflet.js` — no CDN, no build
  step, no npm runtime dependency.
- `L.map(..., { preferCanvas: true })` + **five dedicated `L.canvas()`
  renderers** on `createPane()` panes (lattice, active-area, planning, licence,
  hospitality); the licence renderer uses a zoom-dependent hit `tolerance`.
- Basemaps are **raster** `L.tileLayer` (CARTO light/satellite/dark via a
  deploy-time key, OSM fallback); satellite is a 3-layer Esri composite.
- **Leaflet API surface actually used** (from `js/`): `L.map`, `L.tileLayer`,
  `L.geoJSON`, `L.canvas`, `L.layerGroup`, `L.circleMarker`, `L.circle`,
  `L.marker`, `L.rectangle`, `L.tooltip`, `L.divIcon`, `L.latLng`, `L.DomEvent`;
  methods `addTo/addLayer/removeLayer`, `createPane/getPane`,
  `setStyle/setRadius/setLatLng` (the Lens recompute path),
  `bindTooltip/bindPopup`, `getBounds/getZoom/setView/panTo/fitBounds`,
  `eachLayer`, `remove`. ~17 constructors, ~20 methods.
- Analytical models are **pure functions** with their own tests
  (`js/urban-licences.js`, `js/planning-ambito.js`, `js/ambito-change.js`) —
  this spike imports them directly as the plain-JS baseline (§5).

---

## 3. Methodology

### 3.1 Principles

- **Measure, don't estimate.** Every verdict cites a committed JSON figure.
- **Same payload on every stack.** Leaflet and MapLibre render the *same* real
  ámbito + licence data; DuckDB-WASM and plain JS run on the *same* records.
- **Deterministic by construction.** Byte sizes, counts and seeded synthetic
  geometry (mulberry32) reproduce exactly on any machine.
- **Full cost, not just the happy number.** Library/engine bytes, WASM payload,
  init time and migration effort are in scope.
- **Label the host on every timing.** CPU-only container numbers are never
  dressed up as device numbers.

### 3.2 Thresholds, defined before interpretation

`research/runtime_spike/device_harness/thresholds.json` (full UX rationale there):

| Metric | Good | Acceptable | Why |
|---|---|---|---|
| First Contentful Paint | ≤ 1.8 s | ≤ 3.0 s | Web Vitals; static-site FCP is HTML+CSS+Leaflet bound |
| Map-ready (data+build+settle) | ≤ 3.5 s | ≤ 5.0 s | wait before the Lens works; partitioning targets this |
| **Interaction-to-paint (Lens drag), p95** | ≤ 100 ms | **≤ 150 ms** | lens must feel attached to the pointer; **primary ceiling metric** |
| **Pan frame time, p95** | ≤ 16.7 ms (60 fps) | **≤ 33.3 ms (30 fps)** | below 30 fps touch panning stutters, worst on iPad |
| JS heap | report-only | flag > 500 MB | coarse; tablet-stability signal, not a gate |

**What these metrics actually measure (methodological honesty):**
- **FCP** is the Paint Timing API first-contentful-paint of the *harness page*
  (HTML + CSS + vendored Leaflet / MapLibre JS) — a proxy for the app's static
  shell, not the full production script graph.
- **Map-ready** is *not* the Lighthouse **TTI** metric (main-thread quiet
  window). It is wall time from run start until data is fetched/parsed and
  layers are built (one settling frame). It is named `map_ready_ms`, not TTI, to
  avoid the loaded term.
- **Interaction-to-paint** is a **double-rAF proxy**: time from the Lens state
  mutation until the callback of the *second* `requestAnimationFrame` runs (after
  the intervening frame composited). It is **not** a true paint timestamp (that
  needs the Event Timing / LoAF APIs) and it is **frame-quantised**, so on a fast
  path it floors near one frame interval. The harness therefore ALSO captures the
  **synchronous analytical recompute time** separately (`interaction_recompute_ms`)
  — see §3.2a.

### 3.2a Renderer-only vs full-Lens latency

The harness runs each interaction scenario in two modes, so renderer cost and
analytical cost are never conflated:
- **`recompute=renderer`** moves only the Lens overlay circle (renderer-only
  latency). Moving a circle does **not** run any analytical model.
- **`recompute=full`** additionally runs the **production** analytical recompute
  the real Lens triggers on pointer move — `licencesInLens(...)` +
  `createPlanningIndex(...).ambitosIntersecting(...)`, imported from `js/` without
  editing it — and records its synchronous time as `interaction_recompute_ms`.

**The Leaflet ceiling** is the synthetic feature count at which
interaction-to-paint p95 first exceeds **150 ms**, or pan-frame p95 first
exceeds **33.3 ms**, on a real device. **That count is the MapLibre trigger.**

### 3.3 What ran where

| Measurement | Where | Status |
|---|---|---|
| Artifact inventory, compression, counts | container | **done, deterministic** |
| Origins partitioning (bytes + parse) | container | **done, deterministic** |
| DuckDB-WASM vs plain JS (correctness + CPU timing + payload) | container | **done; init/query are CPU-only** |
| Leaflet CPU scaling (parse/serialise/cull) | container | **done; CPU-only, not paint** |
| GeoParquet builder-side bytes — tabular **and** geometry | container (pyarrow 26.0.0 + shapely 2.2.0) | **done, deterministic** |
| PMTiles real MVT tiling + per-viewport transfer | container (geojson-vt + vt-pbf) | **done, deterministic**; tippecanoe cross-check deferred |
| DuckDB-WASM query shapes 1–3 (in-circle, date-window, edition-diff) | container | **done; correctness verified, CPU timing** |
| DuckDB-WASM shape 4 (ámbito containment, `ST_Contains`) | container | **UNVERIFIED** — spatial extension fetch blocked; plain-JS side done |
| Harness repeatability (end-to-end run) | container | **done** — labelled non-device, SwiftShader, `complete` gate |
| FCP / map-ready / interaction-to-paint / frame time on real payload | **device** | **UNVERIFIED — harness ready** |
| Leaflet ceiling crossing (the trigger count) | **device** | **UNVERIFIED — harness ready** |
| MapLibre vs Leaflet, same payload + ceiling series | **device** | **UNVERIFIED — harness ready** |

---

## 4. Leaflet-canvas ceiling (§2)

### 4.1 CPU component — measured (container)

`research/runtime_spike/results/leaflet_cpu_scaling.json`. Synthetic geometry,
seeded mulberry32, polygon vertex budget = **194 v/feature** (the real ámbito
average, 140,507 / 724). This measures the **CPU work that scales with feature
count** — GeoJSON parse/serialise and a per-feature style+cull pass. It is
**not** the GPU paint cost and **not** the interaction ceiling.

| Polygons | Vertices | Raw payload | Parse (CPU) |
|---|---|---|---|
| 765 | 149,175 | 5.7 MB | 71 ms |
| 2,000 | 390,000 | 15.0 MB | 148 ms |
| **5,675** (parcel scale, `MCPG_Madrid_Crece`) | 1,106,625 | **42.5 MB** | **562 ms** |
| 10,000 | 1,950,000 | 74.8 MB | 783 ms |

| Points | Parse (CPU) |
|---|---|
| 11,500 | 17 ms |
| 25,000 | 26 ms |
| 50,000 | 49 ms |

**Reading:** points are cheap to parse at every tested level (≤ 49 ms at
50 k) — their ceiling will be paint/overdraw, which is a device question.
Polygons at **parcel scale (5,675)** already cost **~0.56 s of parse alone**,
before a single pixel is painted, and the raw payload is **42.5 MB** (16.6 MB
gzip). That is a real, hardware-independent signal that the "load the whole
GeoJSON" approach degrades at parcel scale regardless of the renderer — but it
is a *load/parse* ceiling, distinct from the *interaction* ceiling.

### 4.2 Interaction/paint ceiling — MEASURED (device, §12)

The count at which **interaction-to-paint p95 > 150 ms** or **pan-frame p95 >
33.3 ms** could not be measured in the SwiftShader VM; `device_harness/leaflet_ceiling.html`
generates the identical synthetic geometry in-browser and measures both metrics
across the full count series. It has now been run on two physical devices (§12):

- **iPad M3 / Safari** — Leaflet polygon **pan p95** crosses 33.3 ms at **2 000
  polygons** (24 → **53** → 144 → 251 ms at 765 / 2 000 / 5 675 / 10 000); MapLibre
  never crosses (17 → 26 ms). Point layers do not cross on iPad up to 50 000.
- **Windows / Intel UHD 620** — Leaflet polygon pan is over threshold at the
  **smallest** count (469 ms at 765) and **times out** at 10 000; MapLibre stays
  ≤ 44.7 ms.

The crossing is the MapLibre trigger (§6.3). The current product renders **~724
ámbitos** — below the 2 000-polygon iPad crossing.

The real-payload harness also separates **renderer-only** from **full-Lens**
latency (§3.2a). In the container smoke run the full-Lens *synchronous
recompute* over the real payload (production `licencesInLens` +
`ambitosIntersecting`) measured ≈ 5 ms median on this VM CPU — a CPU-only proxy,
not a device figure, but it establishes that the analytical recompute is a
single-digit-millisecond cost at today's load and is captured distinctly from
the frame-quantised paint proxy. The device run supplies the real
interaction-to-paint and frame-time curves.

---

## 5. DuckDB-WASM vs plain JS (§4) — NO-GO, measured

`research/runtime_spike/results/duckdb_wasm.json`. The plain-JS baseline is the
**production code itself** (`licencesInLens`, `defaultWindow` from
`js/urban-licences.js`), not a reimplementation. DuckDB-WASM ran the equivalent
SQL on the same 11,265 records on the same host CPU.

### 5.1 Correctness verified first

The Haversine metric (`R = 6,371,000 m`, `≤ radiusM`) was replicated exactly in
SQL. Output sets were compared **before** timing. **All four issue-#74 query
shapes are now covered** (shapes 1–3 benchmarked in DuckDB; shape 4's DuckDB
side is UNVERIFIED, see below):

| Query shape | JS result | DuckDB result | Identical? |
|---|---|---|---|
| 1. In-circle (1.5 km @ Sol) | 1,554 recs | 1,554 recs | **yes** |
| 2. In-circle + date window (trailing 12 mo) | 527 recs | 527 recs | **yes** |
| 3. Edition-to-edition diff (724 ámbitos) | 113 changed | 113 changed | **yes** |
| 4. Ámbito containment (500 pts × 724 poly) | 146 hits | — | **UNVERIFIED** (DuckDB spatial ext blocked) |

Shape 3 uses a deterministic perturbed "previous" edition (the artifact ships one
edition per family, so there is no second time-edition); it verifies the diff
*shape* (changed-code set) is identical, while noting the full production
classification (`auditEditionPair` comparability/cosmetic/S1-S2 semantics) stays
JS-only — porting it to SQL is a cost, not a win.

### 5.2 Cost comparison

| | plain JS (production fn) | DuckDB-WASM |
|---|---|---|
| Engine transfer to boot | **0** (already loaded) | **6.93 MB gzip** (`duckdb-eh.wasm` 34 MB raw → 6.75 MB gzip + glue) |
| Init / instantiate | 0 | ~0.97 s instantiate-only; 9.7 s create+instantiate+connect in this run *(CPU-only, variable)* |
| Table load (11,265 rows) | 0 | 0.52 s |
| **Warm in-circle query, median** | **1.68 ms** | **7.56 ms** |
| Warm date-window query, median | 1.16 ms | — |
| Warm edition-diff, median | **0.04 ms** | **0.70 ms** |
| Containment (500 pts × 724 poly), median | **6.1 ms** | UNVERIFIED (spatial ext) |

(Init/query millisecond figures are CPU-only and vary run-to-run; one later run
measured init 1.5 s, in-circle warm 4.8 ms. The verdict rests on the payload and
the consistent order-of-magnitude gap, not on any single millisecond.)

**Reading:** plain JS answers every covered shape in **single-digit
milliseconds** with nothing to download and no init. DuckDB-WASM returns the
*same answer* several× slower per warm query, and only after transferring **~3.3×
the app's entire 2.11 MB gzip data footprint** as engine bytes and paying
seconds of init. On the two shapes the issue flagged:

- **Edition-to-edition diff** — measured: identical 113-code result, plain JS
  **0.04 ms** vs DuckDB **0.70 ms**. The production `auditEditionPair`'s rich
  classification stays JS-only; porting it to SQL is a *cost*, not a win.
- **Ámbito containment** — plain JS (`createPlanningIndex().ambitoContaining`,
  the production point-in-polygon) does 500 points × 724 polygons in **6.1 ms**.
  DuckDB needs the **spatial extension** (`ST_Contains`), whose `INSTALL spatial`
  requires a network fetch that is **blocked in this container** (so the DuckDB
  side is UNVERIFIED) — and which would ADD payload on top of the 6.93 MB engine,
  compounding the payload objection for zero capability the product lacks.

**Trigger to revisit (numeric):** a query the product genuinely cannot serve in
plain JS within the interaction budget — e.g. arbitrary user-drawn-polygon
spatial joins over **> 100,000** features, or licence history exceeding
**~500,000** rows where linear JS scans push interaction-to-paint over the
150 ms line on a real device. **Remaining uncertainty:** none material at this
scale; the result is robust (identical outputs, order-of-magnitude cost gap).

---

## 6. MapLibre GL JS (§3) — NOT YET (now device-measured, §12)

### 6.1 Gain — MEASURED (device, §12)

A bounded, disposable prototype (`maplibre_proto/maplibre_prototype.html`) is
built for strict **parity** with the Leaflet harnesses (review #3): the **same**
real ámbito + licence payload, the **same** viewport, zoom, Lens interaction and
pan sweep, the **same** RUM engine, the **same** `recompute=renderer|full`
modes (running the identical production models), **and** the **same** synthetic
ceiling series (`kind=polygon|point&count=…`, identical mulberry32 seeds) so the
Leaflet ceiling and the MapLibre ceiling are measured on byte-identical geometry.

**Matched layer sets (device micro-gate).** Every comparative scenario runs the
**same** layer set on both engines — `ambito`, `ambito,licence`, and
`ambito,licence,admin` (the MapLibre prototype renders an `admin` line layer so
the three-layer workload is genuinely equivalent). The runner pairs each Leaflet
scenario with its MapLibre twin by a `pairKey` and **refuses a device-validation
verdict unless both engines completed every comparative pair** (`comparable`
gate). A Leaflet `ambito,licence,admin` scenario is never compared against a
MapLibre `ambito,licence` one.

**Readiness barriers.** MapLibre's GeoJSON sources parse and tile on a worker
*after* `addSource`, so the prototype awaits `map 'idle'` **and**
`isSourceLoaded()` for every source before any measurement is accepted; Leaflet
adds its canvas layers synchronously and settles one frame. Each result records
its `readiness_barrier`, and a scenario with none is counted incomplete.

**Fidelity caveat (do not overstate).** `recompute=full` runs **two** production
pure models (`licencesInLens` + `createPlanningIndex().ambitosIntersecting`),
recorded as `interaction_recompute_ms`. This is the analytical **core**, not the
entire production Lens pipeline, which additionally rebuilds the panel DOM, the
radial halo, evidence/scope state, the area profile and i18n on each move. The
harness measures the two models; it does not claim to reproduce the full view
update.

It could not be measured in the SwiftShader VM, but it **has** now been measured on
real hardware (§12). The result: **at the current real data volume MapLibre shows no
decisive advantage** — on the iPad M3 both engines sit within the 33.3 ms pan
threshold for all 12 real-payload pairs (Leaflet ≤ 30 ms, MapLibre ≤ 26 ms) and
neither is a universal winner. MapLibre's advantage is **real but conditional**: it
stays flat as polygon count scales (17 → 26 ms to 10 000) while Leaflet degrades and
crosses at 2 000, and on the weak Intel laptop Leaflet already fails the real-payload
pan threshold while MapLibre is far closer to it. The verdict stays **NOT YET**
because the trigger (§6.3) is not crossed at the data volume the product renders
today; §12 states the remaining decision blockers.

### 6.2 Migration cost — enumerated (this is decidable now)

| Cost | Detail |
|---|---|
| View layer | `js/app.js` is **7,809 lines** of Leaflet-coupled view code (the issue's "3,752" is stale). The Leaflet API surface (§2.4) must be re-expressed: `createPane` + per-pane `L.canvas` → MapLibre style layers + z-ordering; `setStyle/setRadius/setLatLng` Lens updates → GeoJSON source `setData`; raster `L.tileLayer` → a vector (or raster) style. |
| Tests | **7 Playwright browser suites** (`browser-tests/*.browser.mjs`) assert against the production Leaflet DOM/canvas; all would need rewriting against MapLibre's canvas. |
| No-build property | MapLibre is an npm/CDN dependency; adopting it ends the vendored, zero-dependency, no-build-step property that Gate K §11I calls an asset for reproducibility — or requires vendoring a large WebGL bundle. |
| Basemap | CARTO **raster** tiles (deploy-time key) would move to a **vector style**, changing the key arrangement and the satellite/light story. |
| Deployment | GitHub Pages static hosting is preserved either way, but a vector style adds a style/sprite/glyph hosting decision. |

### 6.3 Trigger (numeric, measurable)

Adopt MapLibre only when **both** hold, measured on a real mid-range laptop
**and** iPad:

1. The Leaflet ceiling (§4.2) crossing — interaction-to-paint p95 > 150 ms or
   pan-frame p95 > 33 ms — falls **at or below a feature count the roadmap
   actually requires** (e.g. parcel scale, 5,675 polygons); **and**
2. the MapLibre prototype shows interaction-to-paint p95 and pan-frame p95
   **inside** the thresholds at that same count on the same devices.

The §4.1 CPU evidence (0.56 s parse at 5,675 polygons) is a **leading
indicator** that parcel scale is where this becomes live. **Device evidence (§12):**
condition 1 is met on the iPad at **2 000 polygons** and condition 2 holds there too
(MapLibre pan p95 17 ms) — **but only in the synthetic ceiling**, above the ~724
ámbitos the product actually renders. At the real payload neither condition fires on
the iPad (Leaflet is inside the thresholds). On the weak Intel laptop condition 1
fires at the real payload, but MapLibre is only marginally inside 33.3 ms there, so
the trigger is not cleanly satisfied. **Net: the trigger is not crossed at the
current data volume on a capable device; it would fire if the roadmap pushes polygon
density past ~2 000, or if weak integrated-GPU laptops become a hard support floor.**

---

## 7. PMTiles & GeoParquet (§4), and the real payload problem (§5)

### 7.1 PMTiles — NOT YET (slaved to MapLibre)

`research/runtime_spike/results/pmtiles.json`. **Real MVT tiles were generated**
(geojson-vt + vt-pbf, z10–15) — not merely an input baseline:

| Layer | whole-layer gzip | tiled archive z10–15 gzip | per-viewport @ z14 (5×3 tiles) |
|---|---|---|---|
| ámbito polygons | 916 KB | 763 KB | **15 tiles, 19 KB gzip** |
| licence points | 155 KB | 1,063 KB | 15 tiles, 64 KB gzip |

**Reading:** PMTiles' real win is per-viewport transfer at the default zoom —
the ámbito layer drops from a 916 KB whole-layer fetch to **~19 KB** of visible
tiles. But (a) for the point layer the tiled archive is *larger* than the whole
layer (tiles duplicate features across zooms), and (b) this win only materialises
with a **vector renderer**. PMTiles is therefore **not decidable independently of
MapLibre (§6)** — the verdict is slaved to B. (geojson-vt's simplification
differs from tippecanoe's; the exact tippecanoe cross-check command is in the
result JSON.) **Trigger:** MapLibre goes GO **and** a single vector layer exceeds
~2 MB gzip whole-layer (parcel scale).

### 7.2 GeoParquet — NO-GO

`research/runtime_spike/results/geoparquet.json` (pyarrow 26.0.0 + shapely 2.2.0).
Both tabular **and geometry** (WKB column) now measured:

| Artifact | kind | source gzip | GeoParquet/Parquet zstd |
|---|---|---|---|
| urban_licences | tabular | 288 KB | 270 KB (−6 %) |
| domestic_origins | tabular | 252 KB | **108 KB (−57 %)** |
| **ámbitos** | **geometry** | **922 KB** | **1,909 KB (+107 %, worse)** |
| admin | geometry | 249 KB | 275 KB (+10 %, worse) |

Three findings: (1) **no browser consumer reads Parquet/GeoParquet without a
WASM reader** (DuckDB-WASM or parquet-wasm), so GeoParquet is gated behind C =
NO-GO. (2) For **geometry** — the case that would matter for a spatial app —
GeoParquet (full-precision WKB float64) is **~2× LARGER** than gzipped GeoJSON:
it *inflates* the spatial payload, it does not reduce it. (3) Its only benefit is
builder-side bytes for highly-columnar *tabular* data (origins −57 %), which the
cheaper month-partitioning already covers. **No justified consumer exists;
closed.**

### 7.3 Origins partitioning — the actual win (no new technology)

`research/runtime_spike/results/partitioning.json`. `madrid_domestic_origins.json`
splits cleanly by `source_month` into 7 self-describing partitions + a tiny
index.

Equivalent-functionality scenarios are reported **separately** (review #5),
because the CITY *Monthly origin dynamics* view compares a source month to its
**exact previous calendar month** (`js/domestic-origin-dynamics.js`
`NO_ADJACENT_PRIOR_MONTH`). A latest-month-only load therefore **breaks
Dynamics**; the feature-equivalent first load needs latest **+ previous**:

| Scenario | Supports | Initial transfer (gzip) | Initial parse (CPU) | Saving vs A |
|---|---|---|---|---|
| **A** status quo (whole file) | everything | 250 KB | 19.1 ms | — |
| **B1** index + latest month | single-month views **only — NOT Dynamics** | **32 KB** | 1.7 ms | −87.2 % (not feature-equivalent) |
| **B2** index + latest + previous | adds Dynamics' default comparison | **69 KB** | 3.4 ms | **−72.4 %** (the honest general figure) |

The **general, user-visible claim is B2: −72.4 %** (250 KB → 69 KB). B1's
−87.2 % applies only where Dynamics is not shown. Partition overhead (eager-all
vs whole file): **negligible** (−7 KB). Caching: a new monthly edition
invalidates only that month's file + the index, not the whole multi-MB artifact.
**This is a data-pipeline change and is out of K12 scope** — reported as a
finding, implemented by a future issue, touching `data/` builders which this
spike must not modify.

> Nuance worth stating: the "3.71 MB tabular problem" is **250 KB over the wire**
> after gzip. Partitioning's value is dominated by **parse time and
> cache granularity on weak devices**, not raw transferred megabytes. The
> single heaviest *transferred* artifact is in fact `madrid_ambitos.geojson`
> (**916 KB gzip**) — geometry compresses poorly — which partitioning does not
> touch and which only §4/§6 (the renderer question) addresses.

---

## 8. Verdict table with triggers (§6/§8)

| Tech | Verdict | Measured evidence | Numeric trigger to change it | Remaining uncertainty |
|---|---|---|---|---|
| **A** Current stack | **GO** | 2.11 MB gzip total; existing canvas renderers; **iPad M3 real-payload pan p95 ≤ 30 ms, all 12 pairs within 33.3 ms** (§12); §2 | Any device-measured interaction-to-paint p95 > 150 ms on the shipped payload | **Confirmed on iPad M3**; weak Intel laptop fails real-payload pan (§12) |
| **B** MapLibre | **NOT YET** | Migration cost §6.2 (7,809-line view layer, 7 Playwright suites, no-build loss); **gain now device-measured (§12): no decisive advantage at the real payload (≤724 ámbitos); flat as polygons scale while Leaflet crosses at 2,000** | Device pan p95 > 33.3 ms (or itp p95 > 150 ms) at a required feature count **and** MapLibre inside those thresholds at that count, on laptop + iPad — **met only at ≥ 2,000 polygons (iPad) or on weak integrated-GPU laptops**, both above/outside today's load | Roadmap polygon density > ~2,000 and target device floor (§12) are the open decisions, not the measurement |
| **C** DuckDB-WASM | **NO-GO** | 4 shapes: shapes 1–3 identical outputs, JS faster warm (e.g. edition-diff 0.04 vs 0.70 ms); 6.93 MB gzip engine; §5 | > 100 k-feature arbitrary spatial joins, or > 500 k rows pushing JS over 150 ms on device | Shape-4 (containment) DuckDB side UNVERIFIED (spatial ext fetch blocked); plain-JS side done (6.1 ms) |
| **D** PMTiles | **NOT YET** | Real MVT tiling measured: ámbito per-viewport 19 KB vs 916 KB whole-layer; slaved to B; §7.1 | B = GO **and** a vector layer > ~2 MB gzip whole-layer | tippecanoe archive cross-check (geojson-vt simplification differs) |
| **D** GeoParquet | **NO-GO** | Geometry measured: ámbito GeoParquet 1,909 KB vs 922 KB GeoJSON gzip (**+107 %**, inflates); no reader-less browser consumer; §7.2 | C flips to GO **and** a builder-cost or payload case parquet uniquely solves | None material |

---

## 9. Evidence index

All figures above trace to committed JSON under `research/runtime_spike/results/`:

- `baseline_inventory.json` — §2.2 footprint, counts, compression
- `partitioning.json` — §7.3
- `duckdb_wasm.json` — §5 (correctness + timings + payload)
- `leaflet_cpu_scaling.json` — §4.1
- `geoparquet.json` — §7.2
- `pmtiles.json` — §7.1 + tippecanoe procedure
- `container_smoke_<suite>.json` — harness repeatability proof (labelled non-device)
- **`ipad/K12_iPad_M3_Safari_2026-10-17.json`** — §12 first COMPLETE device validation (iPad M3 / Safari, 38/38, `DEVICE_VALIDATION`)
- **`windows/K12_Windows_Prueba1.json`** — §12 partial Windows observation (Intel UHD 620, 37/38)
- `controller_smoke_builtin_browser_NEGATIVE/…` — a non-iPad controller export kept as an integrity negative example (refused device-grade)

Re-run everything via `research/runtime_spike/README.md`.

---

## 10. Device completion protocol (closes the UNVERIFIED criteria)

The owner has a mid-range laptop and a physical iPad. To convert this PARTIAL
gate to PASS:

1. **Laptop — real installed Chrome/Edge, headed, not emulation:**
   ```
   cd research/runtime_spike && npm install
   node device_harness/run_device.mjs --suite=full --channel=chrome --headed \
        --label="<make/model/OS/browser>" --require-device
   ```
   `--channel=chrome` (or `msedge`) launches the **real installed browser**, not
   Playwright's bundled headless Chromium; `--headed` runs it on-screen so the GPU
   path is the real one. `--require-device` makes the run **EXIT NON-ZERO** unless
   it is positively device-grade, and it also exits non-zero if **any** scenario
   is missing/errored/incomplete (`complete:false`) or any comparative pair lacks
   both engines (`comparable:false`). Device-grade **fails closed**: it needs a
   hardware-GPU vendor token in `gl_renderer` (not SwiftShader/llvmpipe/NO_WEBGL/
   generic), a real UA, your `--label`, a real channel, AND headed — inspect
   `device_grade_basis` and `launch` in the output. Confirm `is_device_grade:true`,
   `complete:true` and `comparable:true`, then commit `results/device_run_full.json`.
2. **iPad (physical, Safari):** serve the repo from the laptop
   (`python -m http.server 8000`) and open the **one-page controller** in iPad
   Safari:
   ```
   http://<laptop-lan-ip>:8000/research/runtime_spike/device_harness/ipad_controller.html
   ```
   It runs the **same** 38-scenario matrix (from the shared `device_harness/suite.mjs`,
   so it cannot drift from the laptop run), one visible foreground page at a time,
   preserves every measurement between navigations, resumes after interruption, and
   exports **one** consolidated JSON in the same shape as the laptop runner. It
   **fails closed**: a timed-out or errored scenario (e.g. 10 000 polygons) is
   recorded INCOMPLETE, never skipped, and never destroys prior measurements; a
   sparse or fabricated handoff (a lone `p95` with no raw samples) cannot satisfy
   completeness. It requires an explicit **physical-device attestation** that is
   **required but not sufficient**: the run is refused device-grade when the
   *observed* environment (platform/browser/GPU) contradicts an iPad Safari run
   (Windows/Android/Linux/ChromeOS, a Chromium/Edge/Firefox/Claude browser, a
   software or non-Apple GPU), and the export records the observed environment rather
   than a hardcoded Safari channel. A real iPad is still never inferred from the
   user-agent (iPadOS desktop mode reports "Macintosh"); the UA/GPU only refute an
   impossible claim. The older one-URL-per-scenario walk in
   [`device_harness/IPAD.md`](../research/runtime_spike/device_harness/IPAD.md) remains
   valid as a fallback. iPad **cannot** run Playwright; these manual paths are the
   only device-grade iPad routes. A desktop browser in an iPad viewport is **not** a
   substitute and must not be recorded as iPad.

   > **First physical observation (Windows, PARTIAL).** The first real device run
   > exists and is preserved unchanged at
   > [`results/windows/K12_Windows_Prueba1.json`](../research/runtime_spike/results/windows/K12_Windows_Prueba1.json)
   > (Win 11 / Chrome 154 / Intel UHD 620, device-grade hardware). It completed
   > **37/38** scenarios; Leaflet at 10 000 polygons timed out at 120 s while MapLibre
   > completed, so the runner correctly reported `complete:false`, `comparable:false` —
   > **not** a DEVICE_VALIDATION. See `results/windows/README.md`. The gate stays
   > PARTIAL; one Windows run where all 38 scenarios complete is still required.
3. For each run record: device, OS, browser, viewport, cold vs warm cache,
   network, repetitions, median, p95 (the harness records all of these).
4. Read the Leaflet ceiling crossing (§4.2) and evaluate B's trigger (§6.3).
   Update §8 and Gate K §11 with the device figures.

**Status:** step 2 (iPad) is **done** — a complete `DEVICE_VALIDATION` on a physical
iPad M3 / Safari (§12). Step 1 (laptop) has a **partial** Windows run (37/38; the
Leaflet 10 000-polygon cell timed out). The device criteria are therefore **closed on
the iPad** and the ceiling/trigger are now evaluated against real figures (§12). The
gate stays **PARTIAL only because the architectural decision is the owner's**; it is
not a software-rasterised limitation any more. **Do not** mark PASS from a container
run, and do not merge PR #89 without explicit owner approval.

---

## 11. Known measurement limitations

- **No GPU / no device:** container WebGL is SwiftShader; all paint, frame-time
  and MapLibre-vs-Leaflet comparisons are deferred to the device harness.
- **Interaction-to-paint is a double-rAF proxy**, frame-quantised, not a true
  paint timestamp; the harness captures the synchronous analytical recompute
  (`interaction_recompute_ms`) separately so the two are never conflated, and
  distinguishes `recompute=renderer` from `recompute=full`.
- **Map-ready ≠ Lighthouse TTI**; FCP is the harness page's, a static-shell proxy.
- **DuckDB init is CPU-only and variable** (0.97 s instantiate-only; 1.5–9.7 s
  create+instantiate+connect across runs); the verdict rests on payload and
  per-query cost, not on init precision.
- **DuckDB shape-4 (containment)** DuckDB side is UNVERIFIED: `INSTALL spatial`
  requires a network fetch blocked in this container. The plain-JS production
  point-in-polygon side is measured (6.1 ms / 500 pts × 724 poly).
- **Synthetic polygons** are convex-ish blobs at the real average vertex budget;
  they stress vertex throughput, not concave/hole topology or street-network
  clustering. The ceiling is therefore order-of-magnitude, not exact.
- **PMTiles** tiles are real MVT (geojson-vt + vt-pbf); tippecanoe's own
  simplification/output would differ — the cross-check command is recorded.
- **GeoParquet geometry** uses a shapely-WKB column (not full geopandas); the
  measured inflation (+107 % vs gzipped GeoJSON) is sufficient for the NO-GO.
- **Network** in the container is proxied and not device-representative; the CDN
  for MapLibre and the DuckDB spatial extension endpoint are blocked here.
- **Device-grade fails closed.** A run certifies as device-grade only with a
  hardware-GPU vendor token (not SwiftShader/llvmpipe/NO_WEBGL/generic), a real
  UA, a human `--label`, a real browser `--channel` (chrome|msedge) and `--headed`.
  Playwright's bundled headless Chromium never qualifies; the container smoke run
  is therefore always non-device, and any incomplete or non-comparable run is
  refused a device-validation verdict.
- **Recompute fidelity is the analytical core, not the whole Lens.**
  `interaction_recompute_ms` covers two production models only; the full
  production Lens view update (panel/halo/evidence/area-profile/i18n) is larger
  and is not claimed here.

---

## 12. Device evidence — MEASURED (iPad M3 Safari + Windows)

Two physical runs now exist, preserved byte-identical and independently audited (all
88 iPad stat objects recompute exactly from their own `raw` samples; the verdict
re-derives identically through the hardened controller core).

- **iPad M3 / Safari** — `ipad/K12_iPad_M3_Safari_2026-10-17.json`
  (SHA-256 `6603144d…`). `DEVICE_VALIDATION`: 38/38 complete, 19/19 comparable,
  `is_device_grade:true`, Apple GPU + Safari, provenance consistent.
- **Windows / Intel UHD 620** — `windows/K12_Windows_Prueba1.json`. Partial (37/38):
  Leaflet 10 000-polygon timed out; device-grade hardware but not a validation.

### 12.1 Synthetic ceiling — pan p95 (ms), threshold 33.3

| polygons | iPad Leaflet | iPad MapLibre | Win Leaflet | Win MapLibre |
| --- | --- | --- | --- | --- |
| 765   | 24  | 17 | 469.6 | 29.7 |
| 2 000  | **53** | 17 | 898.9 | 27.6 |
| 5 675  | **144** | 21 | 2080.7 | 32.5 |
| 10 000 | **251** | 26 | timeout | 44.7 |

Points (11 500 / 25 000 / 50 000) do not cross on iPad (17 / 19 / 28 ms Leaflet).
**iPad Leaflet polygon pan crosses 33.3 ms at 2 000 polygons; MapLibre never crosses.**
The pattern is identical on both devices; the iPad M3 is ~10–20× faster in absolute
terms. The product renders **~724 ámbitos today — below the 2 000 crossing.**

### 12.2 Real payload (≤724 ámbitos, ~11 265 licences) — iPad pan p95

All **12 real-payload pairs are within 33.3 ms on the iPad for both engines**
(Leaflet max **30 ms**, MapLibre max **26 ms**); `interaction_to_paint_ms.p95`
≈ 33–34 ms for both (the double-rAF proxy floors near two 60 fps frames — not lag).
**Neither engine is a universal winner** (e.g. `ambito|light` Leaflet 17 vs MapLibre
20–25 ms; `ambito,licence,admin|satellite|renderer` Leaflet 30 vs MapLibre 25 ms).
On the weak Intel laptop, by contrast, Leaflet real-payload pan was **143–311 ms**
(failing) and MapLibre **35–46 ms** (marginally over on the 3-layer sets).

### 12.3 Assessment

The device evidence **confirms A = GO** at the current data volume on a modern device
and shows **B's trigger (§6.3) is not crossed today**: MapLibre's advantage is real
but materialises only (i) at polygon densities ≥ ~2 000 (above the ~724 ámbitos
shipped) or (ii) on weak integrated-GPU laptops, where Leaflet fails the real-payload
pan threshold but MapLibre itself is only marginally inside it. Keep Leaflet.

### 12.4 Remaining decision blockers (owner's call — PR #89 stays Draft)

1. **Future polygon density.** Will any view render **> ~2 000 simultaneous
   ámbito-class polygons**? If no, Leaflet suffices indefinitely on modern devices.
   If yes (e.g. parcel-scale overlays), the trigger fires → adopt MapLibre.
2. **Target device floor.** Is the **weak integrated-GPU laptop** class (Intel UHD
   620 and similar) a hard support requirement? There Leaflet already fails the
   real-payload 33.3 ms pan; MapLibre is better but not comfortably inside it — so
   neither engine is clean, and this needs an explicit product decision.
3. **Warm cache / cellular not measured.** Both device runs are **cold cache, wifi,
   single session**; `map_ready`/FCP are cold-start proxies.
4. **Readiness barriers are not engine-equivalent.** Leaflet does not await raster
   tiles; MapLibre awaits `idle` + `isSourceLoaded()`. So `map_ready`/FCP are not
   strictly comparable between engines (the interaction/pan metrics, identical
   workload, are).
5. **Not full Lens fidelity.** The harness measures two production pure models, not
   the full per-move Lens view update (panel/halo/evidence/area-profile/i18n), which
   is larger for both engines equally.
6. **`interaction_to_paint_ms` is a double-rAF proxy**, frame-quantised, **not a true
   paint timestamp** — hence the ~33 ms floor regardless of engine.

**Architectural decision — RECORDED (owner-approved 2026-10-17):** **keep the current
Leaflet + vanilla-JS stack (A = GO); hold MapLibre at NOT YET.** The first complete
physical device validation shows the current architecture meets every interaction
threshold at the real data volume on a modern iPad, and the MapLibre migration cost
(§6.2) is not repaid at today's load. Revisit only when blocker 1 or blocker 2
resolves toward denser polygons or a weak-GPU support floor. **PR #89 remains Draft
per owner instruction** — this records the decision; it does not merge the spike.

---

*Generated as part of K12. No measurement, device result or PASS verdict in this
document is fabricated or emulated.*
