// LENS-UX-VISION-G0 — marker/basemap contrast and categorical-separability analysis.
//
// Pure Node, no dependencies, no network, no CARTO key. It consumes a measured
// background palette (results/positron_palette_*.json, produced by
// sample_positron_tiles.mjs) and evaluates the acceptance criterion stated in
// issue #150.
//
// This script reads only. It renders nothing and changes no application asset.
//
//   node research/lens_ux_vision_g0/color_analysis.mjs
//   node research/lens_ux_vision_g0/color_analysis.mjs --palette <path> --json
//
// WHAT IT CAN AND CANNOT DO — read before citing it.
//
//   * It computes contrast over the 22-colour AREA-WEIGHTED palette. That is an
//     approximation. It is NOT the full per-pixel pass whose figures the audit
//     report and issues #149/#150 quote, and it cannot reproduce those figures:
//     the palette drops the rare dark tail. The recorded full-pixel results are
//     carried in the palette file under `full_pixel_reference` and reported here
//     side by side, with the divergence checked against a declared tolerance.
//   * It evaluates ONE basemap — the one the palette file was measured from
//     (normally CARTO Positron `light_all`, the product default). #150's
//     criterion spans three basemaps. The other two are reported as NOT
//     EVALUATED rather than silently folded into a pass.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const PALETTE_PATH = resolve(flag("palette", resolve(HERE, "results/positron_palette_20261101.json")));
const AS_JSON = argv.includes("--json");

// ---------------------------------------------------- colour primitives
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const unlin = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const relL = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
const contrast = (a, b) => {
  const la = relL(a), lb = relL(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const contrastL = (la, lb) => (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
const blend = (c, bg, a) => [0, 1, 2].map((i) => a * c[i] + (1 - a) * bg[i]);

function rgb2lab(p) {
  const r = lin(p[0]), g = lin(p[1]), b = lin(p[2]);
  let X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  let Y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b);
  let Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > Math.pow(6 / 29, 3) ? Math.cbrt(t) : t / (3 * Math.pow(6 / 29, 2)) + 4 / 29);
  X = f(X); Y = f(Y); Z = f(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
function ciede2000(c1, c2) {
  const [L1, a1, b1] = c1, [L2, a2, b2] = c2;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hf = (x, y) => { if (x === 0 && y === 0) return 0; const d = Math.atan2(y, x) * 180 / Math.PI; return d < 0 ? d + 360 : d; };
  const h1p = hf(a1p, b1), h2p = hf(a2p, b2);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * Math.PI / 360);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp;
  if (C1p * C2p === 0) hbp = h1p + h2p;
  else { hbp = (h1p + h2p) / 2; if (Math.abs(h1p - h2p) > 180) hbp += (h1p + h2p < 360 ? 180 : -180); }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * Math.PI / 180) + 0.24 * Math.cos(2 * hbp * Math.PI / 180)
          + 0.32 * Math.cos((3 * hbp + 6) * Math.PI / 180) - 0.20 * Math.cos((4 * hbp - 63) * Math.PI / 180);
  const dTh = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTh * Math.PI / 180) * Rc;
  return Math.sqrt(Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh));
}

// Machado, Oliveira & Fernandes (2009), severity 1.0, applied in linear RGB.
// SCREENING ONLY. These matrices model a dichromat's confusion lines; they are
// not evidence of what any person with a colour-vision deficiency perceives.
const CVD = {
  protanopia:   [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia:   [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
function simulate(p, type) {
  if (type === "grayscale") { const y = unlin(relL(p)); return [y, y, y]; }
  const M = CVD[type], v = [lin(p[0]), lin(p[1]), lin(p[2])];
  return M.map((row) => unlin(Math.max(0, Math.min(1, row[0] * v[0] + row[1] * v[1] + row[2] * v[2]))));
}

// ------------------------------------------------- subject under test
// Mirrors js/app.js: LAYER_COLOR and addMarker(). Keep in step with the app.
const SHIPPED = { museum: "#9d72ff", info: "#c79cff", stay: "#3da8ff", bike: "#54e2b5", rail: "#ffd166" };
const FILL_ALPHA = 0.78;
const STROKE_ALPHA = 0.95;

const CANDIDATES = [
  { id: "A_shipped", colours: SHIPPED, outline: null,
    note: "Current production palette (js/app.js LAYER_COLOR)." },
  { id: "B_contrast_adjusted", outline: null,
    colours: { museum: "#7952B3", info: "#963D7D", stay: "#146EAA", bike: "#087A65", rail: "#8A6010" },
    note: "Contrast-adjusted categorical palette. NOT RECOMMENDED: see #152 — it collapses grayscale separability and worsens deuteranopia." },
  { id: "C_shipped_hues_dark_outline", colours: SHIPPED, outline: "#16222f",
    note: "Recommended in #150. Shipped hues unchanged; opaque dark outline (Light --text token) supplies detectability." },
];

// #150's acceptance criterion, in full: >=3:1 edge contrast across >=99% of
// sampled tile area, on all three basemaps. Both halves are enforced below.
const WCAG_NON_TEXT_MIN = 3.0;
const MIN_AREA_COVERAGE_PCT = 99.0;
const MAX_AREA_BELOW_PCT = 100 - MIN_AREA_COVERAGE_PCT;
const REQUIRED_BASEMAPS = ["light_all", "dark_all", "satellite"];
// Drift detector for the weighted approximation against the recorded full-pixel
// pass. Set just above the largest divergence observed on 2026-11-01 (0.12, on
// B_contrast_adjusted/info) so that a future palette re-measurement which moves
// the approximation materially fails the run. It is NOT a claim that the two
// estimators agree to 0.15 in general.
const APPROXIMATION_TOLERANCE = 0.15;
const APPROXIMATION_OBSERVED_MAX_20261101 = 0.12;

// --------------------------------------------------------- analysis
const palette = JSON.parse(readFileSync(PALETTE_PATH, "utf8"));
const BG = palette.palette.colours.map((c) => ({ rgb: c.rgb, w: c.pct }));
const totalW = BG.reduce((s, b) => s + b.w, 0);
const MEASURED_BASEMAP = palette.basemap.style;
const GLOBAL_LMIN = palette.luminance_summary?.relative_luminance_global_min ?? null;

function weighted(fn) {
  const rows = BG.map((b) => ({ w: b.w, v: fn(b.rgb) })).sort((x, y) => x.v - y.v);
  let acc = 0, median = rows[0].v;
  for (const r of rows) { acc += r.w; if (acc >= totalW / 2) { median = r.v; break; } }
  const below = rows.filter((r) => r.v < WCAG_NON_TEXT_MIN).reduce((s, r) => s + r.w, 0) / totalW * 100;
  return {
    min: +rows[0].v.toFixed(2),
    median: +median.toFixed(2),
    max: +rows[rows.length - 1].v.toFixed(2),
    pctAreaBelowMin: +below.toFixed(1),
    pctAreaAtOrAboveMin: +(100 - below).toFixed(1),
  };
}

const modal = BG[0].rgb;
const report = {
  contract_version: "2.0.0",
  generated_at: new Date().toISOString(),
  palette_source: {
    file: PALETTE_PATH.replace(/\\/g, "/").split("/").slice(-1)[0],
    basemap_style: MEASURED_BASEMAP,
    ...palette.pinned_inputs,
  },
  estimator: {
    kind: "area_weighted_palette_approximation",
    background_colours: BG.length,
    coverage_pct_of_sampled_area: palette.palette.coverage_pct,
    caveat: "Approximation. It does not reproduce the full per-pixel figures quoted in the audit report and issues; see full_pixel_reconciliation.",
  },
  criterion: {
    source: "issue #150",
    edge_contrast_min: WCAG_NON_TEXT_MIN,
    min_area_coverage_pct: MIN_AREA_COVERAGE_PCT,
    required_basemaps: REQUIRED_BASEMAPS,
    basemaps_evaluated: [MEASURED_BASEMAP],
    basemaps_not_evaluated: REQUIRED_BASEMAPS.filter((b) => b !== MEASURED_BASEMAP),
    scope_warning: "This run evaluates one basemap. The criterion is not satisfied in full until every required basemap has its own measured palette.",
  },
  candidates: {},
};

for (const cand of CANDIDATES) {
  const entry = { note: cand.note, outline: cand.outline, colours: cand.colours, layers: {} };
  for (const [layer, hex] of Object.entries(cand.colours)) {
    const c = hex2rgb(hex);
    // The detectable edge is the opaque outline where one exists, otherwise the
    // marker's own stroke composited at STROKE_ALPHA.
    const edgeOf = cand.outline
      ? (bg) => contrast(hex2rgb(cand.outline), bg)
      : (bg) => contrast(blend(c, bg, STROKE_ALPHA), bg);
    entry.layers[layer] = {
      hex,
      fill_vs_tile: weighted((bg) => contrast(blend(c, bg, FILL_ALPHA), bg)),
      edge_vs_tile: weighted(edgeOf),
    };
    if (cand.outline) {
      entry.layers[layer].fill_vs_outline =
        +contrast(blend(c, hex2rgb(cand.outline), FILL_ALPHA), hex2rgb(cand.outline)).toFixed(2);
    }
  }

  // An opaque outline's contrast depends only on the background pixel, so its
  // true worst case over the FULL pixel set is bounded by the observed global
  // luminance extremum. This is a derived bound, not a measurement.
  if (cand.outline && GLOBAL_LMIN !== null) {
    const lOutline = relL(hex2rgb(cand.outline));
    entry.worst_case_bound_full_pixel = {
      value: +contrastL(GLOBAL_LMIN, lOutline).toFixed(2),
      derivation: `contrast(outline ${cand.outline}, darkest observed tile pixel L=${GLOBAL_LMIN})`,
      kind: "derived_bound_not_measurement",
    };
  }

  const keys = Object.keys(cand.colours);
  const labOf = (k, sim) => {
    const composited = blend(hex2rgb(cand.colours[k]), modal, FILL_ALPHA);
    return rgb2lab(sim ? simulate(composited, sim) : composited);
  };
  const pairsFor = (sim) => {
    const labs = Object.fromEntries(keys.map((k) => [k, labOf(k, sim)]));
    const out = {};
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        out[`${keys[i]}|${keys[j]}`] = +ciede2000(labs[keys[i]], labs[keys[j]]).toFixed(1);
      }
    }
    return out;
  };
  entry.deltaE2000_normal_vision = pairsFor(null);
  entry.worst_pair_normal_vision = Object.entries(entry.deltaE2000_normal_vision).sort((a, b) => a[1] - b[1])[0];
  entry.cvd_simulated = {};
  for (const sim of ["protanopia", "deuteranopia", "tritanopia", "grayscale"]) {
    const pp = Object.entries(pairsFor(sim)).sort((a, b) => a[1] - b[1]);
    entry.cvd_simulated[sim] = {
      worst_pairs: pp.slice(0, 3),
      pairs_below_deltaE_10: pp.filter((p) => p[1] < 10).length,
      total_pairs: pp.length,
    };
  }

  // Both halves of the criterion, reported separately so a median-only pass can
  // never be mistaken for a coverage pass.
  const failMedian = Object.entries(entry.layers).filter(([, v]) => v.edge_vs_tile.median < WCAG_NON_TEXT_MIN);
  const failArea = Object.entries(entry.layers).filter(([, v]) => v.edge_vs_tile.pctAreaBelowMin > MAX_AREA_BELOW_PCT);
  entry.verdict = {
    basemap: MEASURED_BASEMAP,
    failing_median: failMedian.map(([k]) => k),
    failing_area_coverage: failArea.map(([k]) => k),
    meets_criterion_on_this_basemap: failMedian.length === 0 && failArea.length === 0,
    meets_criterion_on_all_required_basemaps: false,
    all_basemaps_note: `Only ${MEASURED_BASEMAP} was measured. ${REQUIRED_BASEMAPS.filter((b) => b !== MEASURED_BASEMAP).join(" and ")} are NOT EVALUATED.`,
  };
  report.candidates[cand.id] = entry;
}

// ---------------------------- reconciliation against the full-pixel pass
const fpr = palette.full_pixel_reference;
const reconciliation = { available: Boolean(fpr), tolerance: APPROXIMATION_TOLERANCE, rows: [], within_tolerance: true };
if (fpr) {
  reconciliation.note = fpr.note;
  reconciliation.sampled_background_pixels = fpr.sampled_background_pixels;
  for (const [candId, layers] of Object.entries(fpr.candidates)) {
    for (const [layer, ref] of Object.entries(layers)) {
      const approx = report.candidates[candId]?.layers?.[layer]?.edge_vs_tile;
      if (!approx) continue;
      const delta = +(approx.median - ref.edge.median).toFixed(2);
      const ok = Math.abs(delta) <= APPROXIMATION_TOLERANCE;
      if (!ok) reconciliation.within_tolerance = false;
      reconciliation.rows.push({
        candidate: candId, layer,
        full_pixel_edge_median: ref.edge.median,
        weighted_edge_median: approx.median,
        delta, within_tolerance: ok,
        full_pixel_pct_area_below_3: ref.edge.pctAreaBelow3,
        weighted_pct_area_below_3: approx.pctAreaBelowMin,
      });
    }
  }
  reconciliation.max_abs_delta = +Math.max(...reconciliation.rows.map((r) => Math.abs(r.delta))).toFixed(2);
  reconciliation.direction = "weighted approximation runs high (optimistic); the full-pixel figures are the conservative ones";
  reconciliation.observed_max_delta_20261101 = APPROXIMATION_OBSERVED_MAX_20261101;
  reconciliation.not_measured = fpr.not_measured;
}
report.full_pixel_reconciliation = reconciliation;

// ----------------------------------------------------------- output
if (AS_JSON) {
  console.log(JSON.stringify(report, null, 1));
} else {
  const c = report.criterion;
  console.log(`LENS-UX-VISION-G0 — marker contrast vs CARTO ${MEASURED_BASEMAP}`);
  console.log(`palette: ${report.palette_source.file}  app commit: ${(report.palette_source.app_commit || "?").slice(0, 7)}`);
  console.log(`estimator: ${report.estimator.kind} (${BG.length} colours, ${report.estimator.coverage_pct_of_sampled_area}% of sampled area)`);
  console.log(`criterion (#150): edge >= ${WCAG_NON_TEXT_MIN}:1 across >= ${MIN_AREA_COVERAGE_PCT}% of tile area, on ${REQUIRED_BASEMAPS.join(", ")}`);
  console.log(`evaluated here: ${c.basemaps_evaluated.join(", ")}   NOT EVALUATED: ${c.basemaps_not_evaluated.join(", ")}\n`);
  for (const [id, e] of Object.entries(report.candidates)) {
    console.log(`=== ${id}${e.outline ? ` (outline ${e.outline})` : ""} ===`);
    console.log(`    ${e.note}`);
    console.log(`    layer     hex       fill_med  edge_med  edge_min  %area>=3:1  verdict`);
    for (const [k, v] of Object.entries(e.layers)) {
      const okM = v.edge_vs_tile.median >= WCAG_NON_TEXT_MIN;
      const okA = v.edge_vs_tile.pctAreaBelowMin <= MAX_AREA_BELOW_PCT;
      const tag = okM && okA ? "ok" : !okM && !okA ? "FAIL median+area" : !okM ? "FAIL median" : "FAIL area";
      console.log(`    ${k.padEnd(9)} ${v.hex.padEnd(9)} ${String(v.fill_vs_tile.median).padEnd(9)} ` +
                  `${String(v.edge_vs_tile.median).padEnd(9)} ${String(v.edge_vs_tile.min).padEnd(9)} ` +
                  `${String(v.edge_vs_tile.pctAreaAtOrAboveMin).padEnd(11)} ${tag}`);
    }
    if (e.worst_case_bound_full_pixel) {
      console.log(`    full-pixel worst-case bound: ${e.worst_case_bound_full_pixel.value}:1  (${e.worst_case_bound_full_pixel.kind})`);
    }
    console.log(`    worst dE2000 (normal vision): ${e.worst_pair_normal_vision[0]} = ${e.worst_pair_normal_vision[1]}`);
    for (const [sim, cv] of Object.entries(e.cvd_simulated)) {
      console.log(`      ${sim.padEnd(13)} worst ${cv.worst_pairs.map((p) => `${p[0]}=${p[1]}`).join("  ")}` +
                  `   | pairs dE<10: ${cv.pairs_below_deltaE_10}/${cv.total_pairs}`);
    }
    const v = e.verdict;
    console.log(`    on ${MEASURED_BASEMAP}: ${v.meets_criterion_on_this_basemap ? "meets criterion" :
      `does NOT meet criterion (median: ${v.failing_median.join(",") || "ok"}; area: ${v.failing_area_coverage.join(",") || "ok"})`}`);
    console.log(`    all required basemaps: NOT ESTABLISHED — ${v.all_basemaps_note}\n`);
  }
  if (reconciliation.available) {
    console.log(`=== reconciliation: weighted approximation vs recorded full-pixel pass ===`);
    console.log(`    ${reconciliation.sampled_background_pixels.toLocaleString("en-US")} background pixels; tolerance ${APPROXIMATION_TOLERANCE}`);
    console.log(`    cand/layer                    full-pixel   weighted   delta`);
    for (const r of reconciliation.rows) {
      console.log(`    ${(r.candidate + "/" + r.layer).padEnd(29)} ${String(r.full_pixel_edge_median).padEnd(12)} ` +
                  `${String(r.weighted_edge_median).padEnd(10)} ${r.delta >= 0 ? "+" : ""}${r.delta}${r.within_tolerance ? "" : "  OUT OF TOLERANCE"}`);
    }
    console.log(`    max |delta| = ${reconciliation.max_abs_delta}; ${reconciliation.direction}`);
    console.log(`    no full-pixel reference for: ${reconciliation.not_measured.join(", ")}\n`);
  }
  const dark = palette.dark_basemap_control;
  if (dark) {
    console.log(`=== control: same shipped palette over CARTO ${dark.style} ===`);
    console.log(`    ${Object.entries(dark.stroke_contrast_median).map(([k, v]) => `${k}=${v}`).join("  ")}`);
    console.log(`    Evidence of dark-basemap origin. This control is a SUMMARY, not a full palette,`);
    console.log(`    so it does not discharge the ${dark.style} half of #150's criterion.\n`);
  }
}

// ------------------------------------------------------------- gate
// The shipped palette is expected to fail today; that is the finding in #150,
// not a regression, so it does not fail the run. The run fails if the
// recommended candidate stops meeting EITHER half of the criterion on the
// measured basemap, or if the approximation drifts from the recorded
// full-pixel pass beyond tolerance.
const failures = [];
const rec = report.candidates.C_shipped_hues_dark_outline.verdict;
if (rec.failing_median.length) failures.push(`candidate C below ${WCAG_NON_TEXT_MIN}:1 median — ${rec.failing_median.join(", ")}`);
if (rec.failing_area_coverage.length) failures.push(`candidate C below ${MIN_AREA_COVERAGE_PCT}% area coverage — ${rec.failing_area_coverage.join(", ")}`);
if (reconciliation.available && !reconciliation.within_tolerance) {
  failures.push(`weighted approximation diverges from the recorded full-pixel pass by more than ${APPROXIMATION_TOLERANCE} (max ${reconciliation.max_abs_delta})`);
}
if (failures.length) {
  for (const f of failures) console.error(`ERROR: ${f}`);
  process.exit(1);
}
if (!AS_JSON) {
  const a = report.candidates.A_shipped.verdict;
  console.log(`Shipped palette does not meet #150's criterion on ${MEASURED_BASEMAP} ` +
              `(median: ${a.failing_median.join(", ")}; area: ${a.failing_area_coverage.join(", ")}) — the finding, not a regression.`);
  console.log(`Candidate C meets both halves on ${MEASURED_BASEMAP}. The other required basemaps remain unevaluated.`);
}
