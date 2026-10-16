# Runtime Decision Spike (K12)

**Issue:** [#74](https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens/issues/74) · Part of #62 · Gate K §11A–D, §20
**Branch base:** `origin/main` @ `cf85a9b` (K11 / PR #88 merged)
**Nature:** Measurement spike. **Decide, do not migrate.** No library is adopted here.

> **Gate verdict: PARTIAL / BLOCKED.**
> Every environment-independent measurement is complete and reproducible. The
> acceptance criteria that require *real-device graphics performance*
> (interaction-to-paint, frame time, the Leaflet ceiling crossing, the MapLibre
> comparison) are **UNVERIFIED**: this spike was executed in a cloud Linux VM
> whose WebGL renderer is **SwiftShader (software)** and which has no GPU, no
> touch device and no device-representative network. Software-rasterised paint
> numbers are not device numbers, and this document never presents them as such.
> Reproducible, automated harnesses are delivered so the owner can complete the
> device criteria on a mid-range laptop and a physical iPad; §10 is the exact
> protocol. Nothing below is a fabricated or emulated device result.

---

## 1. Executive decision summary

| # | Technology | Verdict | One-line basis |
|---|---|---|---|
| **A** | Keep current stack (Leaflet + vanilla JS, no build) | **GO** | Real payload is 2.11 MB gzip; existing canvas renderers handle it. No rewrite justified. |
| **B** | MapLibre GL JS | **NOT YET** | Migration cost is high and concrete; the gain is **unmeasured on real hardware**. Numeric trigger in §6. |
| **C** | DuckDB-WASM | **NO-GO** | Outputs verified identical to plain JS; plain JS is **4.5× faster warm** and needs none of DuckDB's **6.93 MB gzip** engine + multi-second init. |
| **D** | PMTiles | **NOT YET** (slaved to B) | Not decidable independently of MapLibre; it presupposes a vector renderer the product does not have. |
| **D** | GeoParquet | **NO-GO** | No browser consumer without DuckDB-WASM (C = NO-GO); builder-side win is modest and already beaten by partitioning. |

**The real win is not on this list.** Partitioning `madrid_domestic_origins.json`
by month cuts its initial-load transfer by **87.2 %** (250 KB → 32 KB gzip) and
its parse by **90.9 %**, with **no new technology** (§7). The single most
valuable finding of this spike is that the architecture is right and the
available performance work is a data-pipeline change, not a renderer or query
engine.

**Final recommendation:** keep the current architecture. Do not adopt MapLibre,
PMTiles, DuckDB-WASM or GeoParquet now. Open a separate data-pipeline issue for
origins partitioning. Re-run the device harnesses (§10) to close the UNVERIFIED
criteria and confirm B's trigger has not been crossed.

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
| Time to interactive map | ≤ 3.5 s | ≤ 5.0 s | wait before the Lens works; partitioning targets this |
| **Interaction-to-paint (Lens drag), p95** | ≤ 100 ms | **≤ 150 ms** | lens must feel attached to the pointer; **primary ceiling metric** |
| **Pan frame time, p95** | ≤ 16.7 ms (60 fps) | **≤ 33.3 ms (30 fps)** | below 30 fps touch panning stutters, worst on iPad |
| JS heap | report-only | flag > 500 MB | coarse; tablet-stability signal, not a gate |

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
| GeoParquet builder-side bytes | container (pyarrow 26.0.0) | **done, deterministic** |
| PMTiles input baseline | container | **done**; actual `.pmtiles` deferred (no tippecanoe) |
| Harness repeatability (end-to-end run) | container | **done** — labelled `CONTAINER_SMOKE_TEST`, SwiftShader |
| FCP / TTI / interaction-to-paint / frame time on real payload | **device** | **UNVERIFIED — harness ready** |
| Leaflet ceiling crossing (the trigger count) | **device** | **UNVERIFIED — harness ready** |
| MapLibre vs Leaflet on real payload | **device** | **UNVERIFIED — harness ready** |

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

### 4.2 Interaction/paint ceiling — UNVERIFIED (device)

The count at which **interaction-to-paint p95 > 150 ms** or **pan-frame p95 >
33 ms** cannot be measured here (SwiftShader). The harness
`device_harness/leaflet_ceiling.html` generates the identical synthetic
geometry in-browser and measures both metrics across the full count series. The
owner runs it per §10; the resulting crossing is the MapLibre trigger.
**No ceiling count is claimed in this document.**

---

## 5. DuckDB-WASM vs plain JS (§4) — NO-GO, measured

`research/runtime_spike/results/duckdb_wasm.json`. The plain-JS baseline is the
**production code itself** (`licencesInLens`, `defaultWindow` from
`js/urban-licences.js`), not a reimplementation. DuckDB-WASM ran the equivalent
SQL on the same 11,265 records on the same host CPU.

### 5.1 Correctness verified first

The Haversine metric (`R = 6,371,000 m`, `≤ radiusM`) was replicated exactly in
SQL. Output sets were compared **before** timing:

| Query shape | JS matches | DuckDB matches | Identical? |
|---|---|---|---|
| In-circle (1.5 km @ Sol) | 1,554 | 1,554 | **yes** |
| In-circle + date window (trailing 12 mo) | 527 | 527 | **yes** |

### 5.2 Cost comparison

| | plain JS (production fn) | DuckDB-WASM |
|---|---|---|
| Engine transfer to boot | **0** (already loaded) | **6.93 MB gzip** (`duckdb-eh.wasm` 34 MB raw → 6.75 MB gzip + glue) |
| Init / instantiate | 0 | ~0.97 s instantiate-only; 9.7 s create+instantiate+connect in this run *(CPU-only, variable)* |
| Table load (11,265 rows) | 0 | 0.52 s |
| **Warm in-circle query, median** | **1.68 ms** | **7.56 ms** |
| Warm date-window query, median | 1.16 ms | — |

**Reading:** plain JS answers the real query shapes in **under 2 ms** with
nothing to download and no init. DuckDB-WASM returns the *same answer* **~4.5×
slower per warm query**, and only after transferring **~3.3× the app's entire
2.11 MB gzip data footprint** as engine bytes and paying seconds of init. The
two remaining shapes:

- **Edition-to-edition diff** (~724 × 2 editions): the production
  `auditEditionPair`/`classifyAmbitoEditionPair` carry rich non-evaluative
  classification semantics. Porting them to SQL is a *cost*, not a win, and
  would create a second analytical semantics — the gate's long-standing concern.
  Plain JS already does this deterministically with tests.
- **Ámbito containment** (point-in-polygon over 724 polygons): trivial in plain
  JS (`ambitoContaining`); in DuckDB it needs the **spatial extension**
  (additional payload + `ST_Contains`), compounding the payload objection for
  zero capability the product lacks.

**Trigger to revisit (numeric):** a query the product genuinely cannot serve in
plain JS within the interaction budget — e.g. arbitrary user-drawn-polygon
spatial joins over **> 100,000** features, or licence history exceeding
**~500,000** rows where linear JS scans push interaction-to-paint over the
150 ms line on a real device. **Remaining uncertainty:** none material at this
scale; the result is robust (identical outputs, order-of-magnitude cost gap).

---

## 6. MapLibre GL JS (§3) — NOT YET

### 6.1 Gain — UNVERIFIED (device)

A bounded, disposable prototype (`maplibre_proto/maplibre_prototype.html`)
renders the **same** real ámbito + licence payload with the **same** RUM
harness and scenario shape as the Leaflet baseline. It could not be measured
here: MapLibre WebGL on SwiftShader is software-rendered (meaningless for a GPU
comparison) and the CDN it loads from is blocked in this container. **No
MapLibre-vs-Leaflet performance claim is made in this document.** The harness is
ready for the device run (§10).

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
indicator** that parcel scale is where this becomes live — but it is not the
paint ceiling, so it cannot by itself fire the trigger. **Remaining
uncertainty:** the entire gain side is unmeasured until the device run.

---

## 7. PMTiles & GeoParquet (§4), and the real payload problem (§5)

### 7.1 PMTiles — NOT YET (slaved to MapLibre)

`research/runtime_spike/results/pmtiles.json`. Input baseline (what would be
tiled): ámbito polygons **916 KB gzip** whole-layer, licence points **155 KB
gzip** whole-layer. PMTiles is a packaging format for tiles consumed by a
**vector renderer**; the app has none. It is therefore **not decidable
independently of MapLibre (§6)** — the verdict is slaved to B. At Madrid
extent and the default zoom the whole ámbito layer is visible, so PMTiles would
transfer a comparable first-paint volume; its win is at deep zoom over a far
larger corpus the product does not have. Actual `.pmtiles` bytes were **not
produced** (tippecanoe absent in the container); the exact command is recorded
in the result JSON for the device/CI follow-up. **Trigger:** MapLibre goes GO
**and** a single vector layer exceeds ~2 MB gzip whole-layer (parcel scale).

### 7.2 GeoParquet — NO-GO

`research/runtime_spike/results/geoparquet.json` (pyarrow 26.0.0):

| Artifact | JSON gzip | Parquet zstd | Parquet snappy |
|---|---|---|---|
| urban_licences | 288 KB | 270 KB (−6 %) | 354 KB (worse) |
| domestic_origins | 252 KB | **108 KB (−57 %)** | 128 KB |

Two findings: (1) **no browser consumer reads Parquet/GeoParquet without a WASM
reader** (DuckDB-WASM or parquet-wasm), so GeoParquet is gated behind C =
NO-GO; geometry→GeoParquet additionally needs geopandas/shapely builder-side.
(2) Its only measurable benefit — builder-side bytes — is modest for licences
and real for origins (−57 %), but the origins payload is **already** solved more
cheaply by partitioning (§7.3, 250 KB → 32 KB), which needs no reader and no new
format. **No justified consumer exists; closed.**

### 7.3 Origins partitioning — the actual win (no new technology)

`research/runtime_spike/results/partitioning.json`. `madrid_domestic_origins.json`
splits cleanly by `source_month` into 7 self-describing partitions + a tiny
index.

| Scenario | Initial transfer (gzip) | Initial parse (CPU) |
|---|---|---|
| **A** status quo (whole file up front) | 250 KB | 19.1 ms |
| **B** partitioned, lazy (index + latest month) | **32 KB** | **1.7 ms** |
| Saving (B vs A) | **−87.2 %** | **−90.9 %** |

Partition overhead (eager-all vs whole file): **negligible** (−7 KB; per-month
gzip sums slightly below the monolith). Caching: a new monthly edition
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
| **A** Current stack | **GO** | 2.11 MB gzip total; existing canvas renderers; §2 | Any device-measured interaction-to-paint p95 > 150 ms on the shipped payload | Device confirmation pending (§10) |
| **B** MapLibre | **NOT YET** | Migration cost §6.2 (7,809-line view layer, 7 Playwright suites, no-build loss); gain unmeasured | Device interaction-to-paint p95 > 150 ms or pan p95 > 33 ms at a required feature count (e.g. 5,675 parcels) **and** MapLibre inside those 150 ms / 33 ms thresholds at that count, on laptop + iPad | **Entire gain side unmeasured** until device run |
| **C** DuckDB-WASM | **NO-GO** | Identical outputs; JS 1.68 ms vs 7.56 ms warm; 6.93 MB gzip engine; §5 | > 100 k-feature arbitrary spatial joins, or > 500 k rows pushing JS over 150 ms on device | None material at this scale |
| **D** PMTiles | **NOT YET** | Slaved to B; §7.1 | B = GO **and** a vector layer > ~2 MB gzip whole-layer | Actual `.pmtiles` bytes not produced (tippecanoe) |
| **D** GeoParquet | **NO-GO** | No reader-less browser consumer; origins win beaten by partitioning; §7.2 | C flips to GO **and** a builder-cost or payload case parquet uniquely solves | None material |

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
- device runs (to be added by the owner): `device_run_<suite>.json`

Re-run everything via `research/runtime_spike/README.md`.

---

## 10. Device completion protocol (closes the UNVERIFIED criteria)

The owner has a mid-range laptop and a physical iPad. To convert this PARTIAL
gate to PASS:

1. **Laptop (real Chrome/Edge, not emulation):**
   ```
   cd research/runtime_spike && npm install
   node device_harness/run_device.mjs --suite=full --label="<make/model/OS/browser>"
   ```
   Confirm the output's `is_device_grade: true` (i.e. `gl_is_software: false`).
   Commit `results/device_run_full.json`.
2. **iPad (physical, Safari):** follow `device_harness/IPAD.md` — serve the repo
   (`python3 -m http.server`), open each harness URL in Safari, tap **download
   JSON**, transfer the files back. iPad **cannot** run Playwright; this manual
   path is the only device-grade iPad route. A desktop browser in an iPad
   viewport is **not** a substitute and must not be recorded as iPad.
3. For each run record: device, OS, browser, viewport, cold vs warm cache,
   network, repetitions, median, p95 (the harness records all of these).
4. Read the Leaflet ceiling crossing (§4.2) and evaluate B's trigger (§6.3).
   Update §8 and Gate K §11 with the device figures.

Until steps 1–2 are done on real hardware, the device criteria stay UNVERIFIED
and the gate stays PARTIAL. **Do not** mark PASS from a container run.

---

## 11. Known measurement limitations

- **No GPU / no device:** container WebGL is SwiftShader; all paint, frame-time
  and MapLibre-vs-Leaflet comparisons are deferred to the device harness.
- **DuckDB init is CPU-only and variable** (0.97 s instantiate-only vs 9.7 s
  create+instantiate+connect in the recorded run); the verdict rests on payload
  and per-query cost, not on init precision.
- **Synthetic polygons** are convex-ish blobs at the real average vertex budget;
  they stress vertex throughput, not concave/hole topology or street-network
  clustering. The ceiling is therefore order-of-magnitude, not exact.
- **PMTiles actual output bytes** not produced (tippecanoe absent); input
  baseline + procedure recorded instead.
- **GeoParquet geometry** not converted (needs geopandas/shapely); the tabular
  measurement is sufficient for the NO-GO.
- **Network** in the container is proxied and not device-representative; the CDN
  for MapLibre is blocked here.

*Generated as part of K12. No measurement, device result or PASS verdict in this
document is fabricated or emulated.*
