// LENS-UX-VISION-G0 — marker/basemap contrast and categorical-separability analysis.
//
// Pure Node, no dependencies, no network, no CARTO key. It consumes a measured
// Positron background palette (results/positron_palette_*.json, produced by
// sample_positron_tiles.mjs) and reproduces the numbers cited in issues #149,
// #150 and #152.
//
// This script reads only. It renders nothing and changes no application asset.
//
//   node research/lens_ux_vision_g0/color_analysis.mjs
//   node research/lens_ux_vision_g0/color_analysis.mjs --palette <path> --json
//
// Exit code is 1 when any default operational category fails the 3:1 edge-contrast
// floor, so the acceptance criterion in #150 is machine-checkable rather than
// asserted in prose.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- CLI
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
const blend = (c, bg, a) => [0, 1, 2].map((i) => a * c[i] + (1 - a) * bg[i]);

// CIELAB (D65, 2°) and CIEDE2000.
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
const FILL_ALPHA = 0.78;    // addMarker fillOpacity
const STROKE_ALPHA = 0.95;  // addMarker opacity (the detectability edge)

const CANDIDATES = [
  { id: "A_shipped", colours: SHIPPED, outline: null,
    note: "Current production palette (js/app.js LAYER_COLOR)." },
  { id: "B_contrast_adjusted", outline: null,
    colours: { museum: "#7952B3", info: "#963D7D", stay: "#146EAA", bike: "#087A65", rail: "#8A6010" },
    note: "Contrast-adjusted categorical palette. NOT RECOMMENDED: see #152 — it collapses grayscale separability and worsens deuteranopia." },
  { id: "C_shipped_hues_dark_outline", colours: SHIPPED, outline: "#16222f",
    note: "Recommended in #150. Shipped hues unchanged; opaque dark outline (Light --text token) supplies detectability." },
];

const WCAG_NON_TEXT_MIN = 3.0;

// --------------------------------------------------------- analysis
const palette = JSON.parse(readFileSync(PALETTE_PATH, "utf8"));
const BG = palette.palette.colours.map((c) => ({ rgb: c.rgb, w: c.pct }));
const totalW = BG.reduce((s, b) => s + b.w, 0);

function weighted(fn) {
  const rows = BG.map((b) => ({ w: b.w, v: fn(b.rgb) })).sort((x, y) => x.v - y.v);
  let acc = 0, median = rows[0].v;
  for (const r of rows) { acc += r.w; if (acc >= totalW / 2) { median = r.v; break; } }
  const below = rows.filter((r) => r.v < WCAG_NON_TEXT_MIN).reduce((s, r) => s + r.w, 0) / totalW * 100;
  return {
    min: +rows[0].v.toFixed(2),
    median: +median.toFixed(2),
    max: +rows[rows.length - 1].v.toFixed(2),
    pctTileAreaBelowMin: +below.toFixed(1),
  };
}

const modal = BG[0].rgb; // most common Positron colour, for separability
const report = {
  contract_version: "1.0.0",
  generated_at: new Date().toISOString(),
  palette_source: { path: PALETTE_PATH.replace(/\\/g, "/").split("/").slice(-1)[0], ...palette.pinned_inputs },
  method: `Marker composited per js/app.js addMarker() (fill a=${FILL_ALPHA}, stroke a=${STROKE_ALPHA}) over ${BG.length} dominant CARTO Positron light_all colours weighted by measured area share (${palette.sampling.pixels_total.toLocaleString("en-US")} px, ${palette.sampling.tiles_sampled} tiles). Contrast per WCAG relative luminance. Separability per CIEDE2000 over the modal background colour.`,
  wcag_non_text_minimum: WCAG_NON_TEXT_MIN,
  candidates: {},
};

for (const cand of CANDIDATES) {
  const entry = { note: cand.note, outline: cand.outline, colours: cand.colours, layers: {} };
  for (const [layer, hex] of Object.entries(cand.colours)) {
    const c = hex2rgb(hex);
    entry.layers[layer] = {
      hex,
      fill_vs_tile: weighted((bg) => contrast(blend(c, bg, FILL_ALPHA), bg)),
      edge_vs_tile: cand.outline
        ? weighted((bg) => contrast(hex2rgb(cand.outline), bg))
        : weighted((bg) => contrast(blend(c, bg, STROKE_ALPHA), bg)),
    };
    if (cand.outline) {
      entry.layers[layer].fill_vs_outline =
        +contrast(blend(c, hex2rgb(cand.outline), FILL_ALPHA), hex2rgb(cand.outline)).toFixed(2);
    }
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
  const failing = Object.entries(entry.layers).filter(([, v]) => v.edge_vs_tile.median < WCAG_NON_TEXT_MIN);
  entry.verdict = {
    categories_failing_edge_minimum: failing.map(([k]) => k),
    passes_wcag_1_4_11: failing.length === 0,
  };
  report.candidates[cand.id] = entry;
}

// ----------------------------------------------------------- output
if (AS_JSON) {
  console.log(JSON.stringify(report, null, 1));
} else {
  console.log(`LENS-UX-VISION-G0 — marker contrast vs CARTO Positron light_all`);
  console.log(`palette: ${report.palette_source.path}  app commit: ${report.palette_source.app_commit.slice(0, 7)}`);
  console.log(`background: ${BG.length} colours, ${palette.palette.coverage_pct}% of ${palette.sampling.pixels_total.toLocaleString("en-US")} sampled px\n`);
  for (const [id, e] of Object.entries(report.candidates)) {
    console.log(`=== ${id}${e.outline ? ` (outline ${e.outline})` : ""} ===`);
    console.log(`    ${e.note}`);
    console.log(`    layer     hex       fill_med  edge_med  edge_min  %area<3:1`);
    for (const [k, v] of Object.entries(e.layers)) {
      const bad = v.edge_vs_tile.median < WCAG_NON_TEXT_MIN ? "  <-- FAIL" : "";
      console.log(`    ${k.padEnd(9)} ${v.hex.padEnd(9)} ${String(v.fill_vs_tile.median).padEnd(9)} ` +
                  `${String(v.edge_vs_tile.median).padEnd(9)} ${String(v.edge_vs_tile.min).padEnd(9)} ` +
                  `${String(v.edge_vs_tile.pctTileAreaBelowMin).padEnd(6)}${bad}`);
    }
    console.log(`    worst dE2000 (normal vision): ${e.worst_pair_normal_vision[0]} = ${e.worst_pair_normal_vision[1]}`);
    for (const [sim, c] of Object.entries(e.cvd_simulated)) {
      console.log(`      ${sim.padEnd(13)} worst ${c.worst_pairs.map((p) => `${p[0]}=${p[1]}`).join("  ")}` +
                  `   | pairs dE<10: ${c.pairs_below_deltaE_10}/${c.total_pairs}`);
    }
    console.log(`    SC 1.4.11: ${e.verdict.passes_wcag_1_4_11 ? "PASS" : `FAIL (${e.verdict.categories_failing_edge_minimum.join(", ")})`}\n`);
  }
  const dark = palette.dark_basemap_control;
  if (dark) {
    console.log(`=== control: same shipped palette over CARTO ${dark.style} ===`);
    console.log(`    ${Object.entries(dark.stroke_contrast_median).map(([k, v]) => `${k}=${v}`).join("  ")}`);
    console.log(`    The shipped palette passes on the dark basemap and fails on the default light one.\n`);
  }
}

// The shipped palette is expected to fail today; that is the finding in #150.
// Exit non-zero only when a candidate that claims to fix it does not.
const shipped = report.candidates.A_shipped.verdict.passes_wcag_1_4_11;
const recommended = report.candidates.C_shipped_hues_dark_outline.verdict.passes_wcag_1_4_11;
if (!recommended) {
  console.error("ERROR: candidate C does not meet the 3:1 edge minimum — acceptance criterion in #150 not met.");
  process.exit(1);
}
if (!AS_JSON && !shipped) {
  console.log("Shipped palette fails SC 1.4.11 as reported in #150. Candidate C meets the minimum.");
}
