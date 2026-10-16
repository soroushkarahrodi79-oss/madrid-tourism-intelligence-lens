// K12 device-harness — the comparative scenario matrix (single source of truth).
//
// Extracted from run_device.mjs so the Playwright laptop runner AND the one-page
// iPad controller (ipad_controller.html) build the EXACT same matrix from one
// definition. If this file changes, both routes change together — the iPad run
// can never silently drift from the laptop run, which is what makes their results
// pair 1-to-1.
//
// Each scenario: { page, q, engine, comparative, pairKey }.
//   * page  — repo-root-relative harness HTML path (served from the repo root on
//             both routes: Playwright's static server, and the iPad's
//             `python3 -m http.server 8000` at the repo root).
//   * q     — query string (layers/basemap/recompute, or kind/count).
//   * pairKey — ties a Leaflet scenario to its MapLibre twin for the comparability
//             gate. A pair is comparable only when BOTH engines complete.

export const LB = `research/runtime_spike/device_harness/leaflet_baseline.html`;
export const LC = `research/runtime_spike/device_harness/leaflet_ceiling.html`;
export const ML = `research/runtime_spike/maplibre_proto/maplibre_prototype.html`;

// Comparative real payload runs the SAME layers/zoom/basemap/recompute on BOTH
// engines (identical workload). Ceiling runs the SAME kind/count on both.
export const CMP_LAYERS = ["ambito", "ambito,licence", "ambito,licence,admin"];

export function realPair(layers, basemap, recompute) {
  const q = `layers=${layers}&basemap=${basemap}&recompute=${recompute}`;
  const pairKey = `real|${layers}|${basemap}|${recompute}`;
  return [
    { page: LB, q, engine: "leaflet", comparative: true, pairKey },
    { page: ML, q, engine: "maplibre", comparative: true, pairKey },
  ];
}

export function ceilPair(kind, count) {
  const q = `kind=${kind}&count=${count}`;
  const pairKey = `ceil|${kind}|${count}`;
  return [
    { page: LC, q, engine: "leaflet", comparative: true, pairKey },
    { page: ML, q, engine: "maplibre", comparative: true, pairKey },
  ];
}

export const SUITES = {
  smoke: [
    ...realPair("ambito", "light", "renderer"),
    ...realPair("ambito,licence,admin", "light", "full"),
    ...ceilPair("polygon", 2000),
  ],
  full: [
    // comparative real payload — matched layer sets on BOTH engines
    ...CMP_LAYERS.flatMap((ly) =>
      ["light", "satellite"].flatMap((bm) =>
        ["renderer", "full"].flatMap((rc) => realPair(ly, bm, rc)),
      ),
    ),
    // comparative ceiling series — matched kind/count on BOTH engines (MapLibre trigger)
    ...[765, 2000, 5675, 10000].flatMap((c) => ceilPair("polygon", c)),
    ...[11500, 25000, 50000].flatMap((c) => ceilPair("point", c)),
  ],
};

export function buildSuite(name) {
  const s = SUITES[name];
  if (!s) throw new Error(`unknown suite: ${name}`);
  return s;
}

// Basename of a page path without node:path, so this module runs unchanged in the
// browser (iPad controller) and under node (runner / tests).
export function pageBasename(page) {
  return String(page).split("/").pop();
}

// The canonical scenario id string, identical to the one run_device.mjs records in
// its `completeness[]` entries (`${engine}:${basename(page)}?${q}`), so a laptop
// file and an iPad file key their scenarios the same way.
export function scenarioId(s) {
  return `${s.engine}:${pageBasename(s.page)}?${s.q}`;
}
