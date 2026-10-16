# K12 runtime decision spike — harnesses

Throwaway measurement harnesses for issue #74. **Nothing here is wired into the
production app** (`index.html`, `css/`, `js/`, `data/` are untouched), and a
guard test (`tests/test_k12_spike_guards.py`) enforces that. The conclusions
live in [`docs/RUNTIME_DECISION_SPIKE.md`](../../docs/RUNTIME_DECISION_SPIKE.md).

## Layout

```
research/runtime_spike/
  lib/measure.mjs            shared: byte sizes, timing stats, host descriptor, seeded PRNG
  baseline/inventory.mjs     §2  deployed footprint, counts, gzip/brotli, parse  (DETERMINISTIC)
  partitioning/partition_origins.mjs  §7.3  origins by-month partition transfer+parse (DETERMINISTIC)
  leaflet_ceiling/
    generate_synthetic.mjs   seeded synthetic polygons/points (mulberry32)
    cpu_scaling.mjs          §4.1  CPU parse/serialise/cull scaling  (CPU-only, NOT paint)
  duckdb_wasm/bench.mjs      §5  DuckDB-WASM vs production plain-JS models (correctness + CPU timing + payload)
  geoparquet/parquet_cost.py §7.2 builder-side Parquet bytes (pyarrow)  (DETERMINISTIC)
  pmtiles/tiling_cost.mjs    §7.1 tiling input baseline + tippecanoe procedure
  device_harness/
    thresholds.json          pre-registered thresholds + UX rationale
    rum.js                   renderer-agnostic RUM engine (FCP/TTI/interaction-to-paint/frame/memory)
    leaflet_baseline.html    §1/§3 scenarios on the REAL payload        (RUN ON DEVICE)
    leaflet_ceiling.html     §2   synthetic ceiling crossing            (RUN ON DEVICE)
    run_device.mjs           Playwright runner (laptop) / container smoke test
    IPAD.md                  physical-iPad manual procedure
  maplibre_proto/maplibre_prototype.html  §3 bounded MapLibre prototype (RUN ON DEVICE, needs network)
  results/                   committed JSON evidence
```

## Requirements

- **Node ≥ 20** (used v22).
- **npm deps (this folder only)**: `cd research/runtime_spike && npm install` —
  installs DuckDB-WASM, Playwright, geojson-vt, vt-pbf into *this folder's*
  `node_modules` (gitignored, **not** the production `package.json`). Needed by
  the DuckDB and PMTiles harnesses and the device runner. Playwright reuses the
  pre-installed Chromium via `PLAYWRIGHT_BROWSERS_PATH`; do not run
  `playwright install` in the container.
- **Python 3 + pyarrow + shapely** for the GeoParquet harness (tabular **and**
  geometry): `python3 -m pip install pyarrow shapely`.
- **tippecanoe** (optional, only for an exact archive cross-check — the harness
  already generates real MVT via geojson-vt/vt-pbf): `brew install tippecanoe`.

## Reproduce the container measurements (deterministic / CPU-only)

```
# from repo root — the pmtiles and duckdb harnesses need `npm install` in
# research/runtime_spike first; geoparquet needs `pip install pyarrow shapely`.
node research/runtime_spike/baseline/inventory.mjs
node research/runtime_spike/partitioning/partition_origins.mjs      # A / B1 / B2 scenarios
node research/runtime_spike/leaflet_ceiling/cpu_scaling.mjs
node research/runtime_spike/pmtiles/tiling_cost.mjs                 # real MVT (geojson-vt + vt-pbf)
python3 research/runtime_spike/geoparquet/parquet_cost.py           # tabular + geometry
node research/runtime_spike/duckdb_wasm/bench.mjs                   # 4 query shapes
```

Each writes/overwrites a file in `results/`. Byte figures and counts are
identical on any machine; `*_ms` timings depend on the host (recorded in each
file's `host` block).

> **Note on DuckDB-WASM under Node:** the `read_json_auto` scanner hangs in the
> node-blocking build in some VMs, so `bench.mjs` loads via `INSERT … VALUES`
> (core engine). This is a harness portability detail, not a result — the
> browser build reads JSON natively. The payload and per-query findings stand.

## Device measurements (the UNVERIFIED criteria)

These need a **real GPU and a real device**. A software rasteriser (SwiftShader,
as in CI/cloud containers) is explicitly **not** device-grade. **Device-grade is
not inferred from the absence of a SwiftShader string** — the runner requires a
positively identified hardware GPU, a real UA, AND a human-supplied `--label`
(see `device_grade_basis` in the output). Any missing/errored/incomplete scenario
sets `complete:false`; with `--require-device` the runner EXITS NON-ZERO unless
the run is both complete and device-grade.

Each harness page runs two interaction modes:
`recompute=renderer` (move the Lens overlay only — renderer-only latency) and
`recompute=full` (also run the production `licencesInLens` + `ambitosIntersecting`
recompute — full-Lens latency, captured as `interaction_recompute_ms`). The
MapLibre prototype takes the SAME real-payload params AND the SAME synthetic
ceiling series (`kind`/`count`) as Leaflet, for parity.

**Laptop (automated, real Chrome/Edge — not emulation):**
```
cd research/runtime_spike && npm install
node device_harness/run_device.mjs --suite=full --label="Dell XPS13 i5 / Win11 / Chrome 131" --require-device
# → results/device_run_full.json   (verify complete:true AND is_device_grade:true)
```

**Smoke test (any machine, proves the harness runs):**
```
node device_harness/run_device.mjs --suite=smoke
# → results/container_smoke_smoke.json  (MapLibre scenario needs network; marked incomplete in-container)
```

**iPad (manual, physical device):** see [`device_harness/IPAD.md`](device_harness/IPAD.md).

**Distinguishing device from emulation:** every result carries
`env.gl_renderer`, `env.gl_is_software` and `env.is_device_grade`. A result is a
genuine device observation **only** if `is_device_grade:true` *and* it came from
physical hardware (a desktop browser in an iPad viewport reports
`is_device_grade:true` but is **not** an iPad — the `device_label` and the
IPAD.md procedure are what certify a real iPad).
