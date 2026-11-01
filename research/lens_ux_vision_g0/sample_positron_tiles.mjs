// LENS-UX-VISION-G0 — regenerate the measured CARTO Positron background palette.
//
// Fetches production basemap tiles, decodes them in a headless Chromium page
// (PNG decoding is the browser's job; this repository has no image dependency)
// and writes the dominant-colour palette and luminance summary that
// color_analysis.mjs consumes.
//
// It reads only. It opens no application page, changes no repository asset and
// writes nothing outside results/.
//
//   CARTO_BASEMAP_KEY=... node research/lens_ux_vision_g0/sample_positron_tiles.mjs
//   CARTO_BASEMAP_KEY=... node research/lens_ux_vision_g0/sample_positron_tiles.mjs --style dark_all --out results/dark_all_palette.json
//
// PIN VERIFICATION. By default the run is checked against the pinned inputs of
// an existing palette (--expect, default results/positron_palette_20261101.json):
// if the deployment has moved on, the run ABORTS rather than silently producing
// a palette that looks like the pinned one but describes a different build.
// Pass --accept-new-deployment to record a genuinely new deployment, which makes
// re-pinning a deliberate act.
//
// OUTPUT SAFETY. --out is constrained to this gate's results/ directory and will
// not overwrite an existing file unless --force is given, so a re-run cannot
// quietly destroy committed evidence.
//
// THE KEY IS NEVER WRITTEN ANYWHERE. It is read from the environment, used to
// build request URLs inside the page, and the recorded url_template is redacted.
// Do not pass it on the command line, where it would land in shell history.
//
// Without the key the public deployment's basemap silently falls back to
// OpenStreetMap (js/app.js createCartoBasemap, see issue #155), so a keyless run
// would measure the wrong basemap entirely. This script refuses rather than
// measure something it cannot identify.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, isAbsolute, basename } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };

const KEY = process.env.CARTO_BASEMAP_KEY || "";
const STYLE = flag("style", "light_all");
const RESULTS_DIR = resolve(HERE, "results");
const OUT = resolve(RESULTS_DIR, flag("out", `positron_palette_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json`).replace(/^results[\/]/, ""));
const EXPECT = flag("expect", resolve(RESULTS_DIR, "positron_palette_20261101.json"));
const ACCEPT_NEW = argv.includes("--accept-new-deployment");
const FORCE = argv.includes("--force");
const FULL_PIXEL = argv.includes("--full-pixel-contrast");
const SITE = "https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens";

// Checked first: measuring the wrong basemap is a scientific error, whereas a
// bad output path is only an operational one. Reporting the lesser problem first
// would hide the greater.
if (!KEY) {
  console.error("CARTO_BASEMAP_KEY is not set.");
  console.error("Without it the app serves OpenStreetMap, not Positron (issue #155), so this");
  console.error("measurement would describe a different basemap. Refusing to produce a");
  console.error("palette that would be labelled Positron but measured from something else.");
  process.exit(2);
}

// Output safety: stay inside this gate's results/ and never clobber silently.
const rel = relative(RESULTS_DIR, OUT);
if (rel.startsWith("..") || isAbsolute(rel)) {
  console.error(`--out must stay inside ${RESULTS_DIR}; got ${OUT}`);
  process.exit(2);
}
if (existsSync(OUT) && !FORCE) {
  console.error(`${OUT} already exists. Refusing to overwrite committed evidence.`);
  console.error(`Choose a different --out, or pass --force if you intend to replace it.`);
  console.error(`Note: the default filename is date-stamped, so a second run on the same day`);
  console.error(`lands on the same path by design — name the re-run explicitly.`);
  process.exit(2);
}

const SITES = [
  { name: "dense_sol",         lat: 40.41690, lon: -3.70330, class: "dense_urban" },
  { name: "dense_salamanca",   lat: 40.42750, lon: -3.68300, class: "dense_urban" },
  { name: "park_retiro",       lat: 40.41500, lon: -3.68300, class: "park_heavy" },
  { name: "park_casacampo",    lat: 40.41800, lon: -3.74700, class: "park_heavy" },
  { name: "sparse_villaverde", lat: 40.34300, lon: -3.69800, class: "sparse" },
  { name: "sparse_vicalvaro",  lat: 40.40300, lon: -3.60700, class: "sparse" },
];
const ZOOMS = [12, 14, 16, 17];
const TOP_N = 22;

// Mirrors CANDIDATES in color_analysis.mjs. Kept here so --full-pixel-contrast
// produces exactly the estimator the audit report and issues #149/#150 quote.
const SHIPPED = { museum: "#9d72ff", info: "#c79cff", stay: "#3da8ff", bike: "#54e2b5", rail: "#ffd166" };
const CANDIDATES_FOR_FULL_PIXEL = {
  A_shipped: { colours: SHIPPED, outline: null },
  B_contrast_adjusted: { colours: { museum: "#7952B3", info: "#963D7D", stay: "#146EAA", bike: "#087A65", rail: "#8A6010" }, outline: null },
  C_shipped_hues_dark_outline: { colours: SHIPPED, outline: "#16222f" },
};

// Pin the deployed evidence this measurement belongs to, so the palette can
// never be read as describing a different build than the one it was taken from.
async function pinDeployment() {
  const grab = async (path) => {
    const r = await fetch(`${SITE}/${path}`);
    if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    return { sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length, buf };
  };
  const manifest = await grab("data/deployment_manifest.json");
  const poi = await grab("data/runtime_poi.json").catch(() => null);
  const m = JSON.parse(manifest.buf.toString("utf8"));
  if (m.build_state !== "pass") {
    throw new Error(`deployment build_state is "${m.build_state}", not "pass" — refusing to measure a degraded build`);
  }
  return {
    app_commit: m.commit,
    pages_deployment_workflow_run: String(m.workflow_run),
    deployment_manifest_sha256: manifest.sha256,
    runtime_poi_sha256: poi ? poi.sha256 : null,
    deployment_build_state: m.build_state,
    deployment_generated_at: m.generated_at,
  };
}

const tileXY = (lat, lon, z) => {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [
    Math.floor(((lon + 180) / 360) * n),
    Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
  ];
};

const pinned = await pinDeployment();
console.error(`observed app commit ${pinned.app_commit.slice(0, 7)} (build_state ${pinned.deployment_build_state})`);

// Verify, do not merely record. A palette that silently describes a different
// build than the one it is compared against is worse than no palette.
let pinVerification = { mode: "unverified", expected_from: null, differences: [] };
if (ACCEPT_NEW) {
  pinVerification = { mode: "accepted_new_deployment", expected_from: null, differences: [],
    note: "Operator passed --accept-new-deployment: this palette deliberately re-pins to a newer build." };
  console.error("--accept-new-deployment: recording a new deployment pin without comparison.");
} else if (existsSync(EXPECT)) {
  const prior = JSON.parse(readFileSync(EXPECT, "utf8")).pinned_inputs || {};
  const FIELDS = ["app_commit", "pages_deployment_workflow_run", "deployment_manifest_sha256",
                  "runtime_poi_sha256", "deployment_build_state"];
  const diffs = FIELDS
    .filter((f) => prior[f] !== undefined && prior[f] !== null && pinned[f] !== prior[f])
    .map((f) => ({ field: f, expected: prior[f], observed: pinned[f] }));
  pinVerification = {
    mode: diffs.length ? "mismatch" : "verified",
    expected_from: basename(EXPECT),
    differences: diffs,
  };
  if (diffs.length) {
    console.error(`
DEPLOYMENT MOVED since ${pinVerification.expected_from}:`);
    for (const d of diffs) {
      const fmt = (v) => (typeof v === "string" && v.length > 16 ? `${v.slice(0, 12)}...` : String(v));
      console.error(`  ${d.field}
    expected ${fmt(d.expected)}
    observed ${fmt(d.observed)}`);
    }
    console.error(`
The audit figures in docs/LENS_UX_VISION_G0_AUDIT.md are pinned to the expected`);
    console.error(`build. Measuring a different one and writing it under the same contract would`);
    console.error(`make the report cite numbers taken from another deployment.`);
    console.error(`Re-run with --accept-new-deployment --out <new file> to re-pin deliberately.`);
    process.exit(3);
  }
  console.error(`pin verified against ${pinVerification.expected_from}: all ${FIELDS.length} fields match`);
} else {
  console.error(`no --expect baseline at ${EXPECT}; recording pins unverified`);
}

const targets = [];
for (const s of SITES) for (const z of ZOOMS) {
  const [x, y] = tileXY(s.lat, s.lon, z);
  targets.push({ site: s.name, z, x, y });
}

// Imported here, not at module scope, so the key check above reports first when
// dependencies are not installed.
const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
// A blank CARTO-origin document, so tile fetches are same-origin and the canvas
// is not tainted. No application page is opened.
await page.goto("https://basemaps.cartocdn.com/", { waitUntil: "domcontentloaded" }).catch(() => {});

const measured = await page.evaluate(async ({ targets, style, key, topN }) => {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const relL = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
  const counts = new Map();
  const perTile = [];
  const bgSample = [];
  let pixelsTotal = 0;
  let globalLmin = Infinity, globalLmax = -Infinity;
  const errors = [];
  for (const t of targets) {
    const url = `https://basemaps.cartocdn.com/rastertiles/${style}/${t.z}/${t.x}/${t.y}.png?key=${encodeURIComponent(key)}`;
    try {
      const r = await fetch(url);
      if (!r.ok) { errors.push({ ...t, status: r.status }); continue; }
      const bmp = await createImageBitmap(await r.blob());
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      const Ls = [];
      const uniq = new Set();
      for (let i = 0; i < d.length; i += 4) {
        const px = [d[i], d[i + 1], d[i + 2]];
        const k = px.join(",");
        counts.set(k, (counts.get(k) || 0) + 1);
        uniq.add(k);
        Ls.push(relL(px));
      }
      pixelsTotal += Ls.length;
      // Sub-sample for the full-pixel contrast pass, matching the stride the
      // 2026-11-01 run used so the two are comparable.
      if (fullPixel) for (let i = 0; i < d.length; i += 4 * 7) bgSample.push([d[i], d[i + 1], d[i + 2]]);
      Ls.sort((a, b) => a - b);
      const q = (p) => Ls[Math.floor(p * (Ls.length - 1))];
      globalLmin = Math.min(globalLmin, Ls[0]);
      globalLmax = Math.max(globalLmax, Ls[Ls.length - 1]);
      perTile.push({
        site: t.site, z: t.z,
        Lmean: +(Ls.reduce((a, b) => a + b, 0) / Ls.length).toFixed(4),
        L50: +q(0.5).toFixed(4), L05: +q(0.05).toFixed(4), uniq: uniq.size,
      });
    } catch (e) { errors.push({ ...t, error: String(e) }); }
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([k, v]) => {
    const rgb = k.split(",").map(Number);
    return {
      hex: "#" + rgb.map((x) => x.toString(16).padStart(2, "0")).join(""),
      rgb, pct: +((100 * v) / total).toFixed(2),
    };
  });

  // --full-pixel-contrast: the estimator the audit report and issues quote.
  // color_analysis.mjs cannot derive this from the 22-colour palette, so it is
  // measured here or not at all.
  let fullPixelResult = null;
  if (fullPixel && bgSample.length) {
    const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const cr = (a, b) => { const la = relL(a), lb = relL(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
    const mix = (c, bg, al) => [0, 1, 2].map((i) => al * c[i] + (1 - al) * bg[i]);
    const stats = (fn) => {
      const rs = bgSample.map(fn).sort((a, b) => a - b);
      const q2 = (p) => +rs[Math.floor(p * (rs.length - 1))].toFixed(2);
      return { min: q2(0), p05: q2(0.05), median: q2(0.5), p95: q2(0.95), max: q2(1),
               pctAreaBelow3: +((100 * rs.filter((r) => r < 3).length) / rs.length).toFixed(1) };
    };
    fullPixelResult = { sampled_background_pixels: bgSample.length, candidates: {} };
    for (const [candId, cand] of Object.entries(candidates)) {
      fullPixelResult.candidates[candId] = {};
      for (const [layer, hexv] of Object.entries(cand.colours)) {
        const c = hex2rgb(hexv);
        const edgeFn = cand.outline
          ? (bg) => cr(hex2rgb(cand.outline), bg)
          : (bg) => cr(mix(c, bg, 0.95), bg);
        fullPixelResult.candidates[candId][layer] = {
          hex: hexv, fill: stats((bg) => cr(mix(c, bg, 0.78), bg)), edge: stats(edgeFn),
        };
      }
    }
  }
  return { top, perTile, pixelsTotal, errors, fullPixelResult,
           globalLmin: +globalLmin.toFixed(4), globalLmax: +globalLmax.toFixed(4),
           coveragePct: +top.reduce((s, c) => s + c.pct, 0).toFixed(1) };
}, { targets, style: STYLE, key: KEY, topN: TOP_N, fullPixel: FULL_PIXEL, candidates: CANDIDATES_FOR_FULL_PIXEL });

await browser.close();

if (measured.errors.length) {
  console.error(`${measured.errors.length} tile(s) failed:`, JSON.stringify(measured.errors.slice(0, 5)));
}
if (!measured.perTile.length) {
  console.error("no tiles decoded — refusing to write an empty palette");
  process.exit(1);
}

const Lmeans = measured.perTile.map((t) => t.Lmean);
const L50s = measured.perTile.map((t) => t.L50);
const L05s = measured.perTile.map((t) => t.L05);
const uniqs = measured.perTile.map((t) => t.uniq);
const rng = (a) => [Math.min(...a), Math.max(...a)];

const out = {
  contract_version: "1.0.0",
  measured_at: new Date().toISOString(),
  basemap: {
    provider: "CARTO", style: STYLE, label: STYLE === "light_all" ? "Positron" : STYLE,
    url_template: `https://basemaps.cartocdn.com/rastertiles/${STYLE}/{z}/{x}/{y}.png?key=<redacted>`,
    retina: false,
    note: "Tiles fetched with the production key from the environment. The key is never recorded here or anywhere in this directory.",
  },
  pinned_inputs: pinned,
  pin_verification: pinVerification,
  sampling: {
    sites: SITES, zooms: ZOOMS,
    tiles_sampled: measured.perTile.length,
    tile_size_px: 256,
    pixels_total: measured.pixelsTotal,
    fetch_errors: measured.errors.length,
  },
  luminance_summary: {
    note: "WCAG relative luminance of raw tile pixels, per site and zoom.",
    relative_luminance_global_min: measured.globalLmin,
    relative_luminance_global_max: measured.globalLmax,
    extrema_note: "Global min/max over every sampled pixel. The 22-colour palette cannot reproduce these: it drops the rare dark tail (labels, road casing).",
    relative_luminance_mean_range: rng(Lmeans),
    relative_luminance_median_range: rng(L50s),
    relative_luminance_p05_range: rng(L05s),
    distinct_colours_per_tile_range: rng(uniqs),
    per_tile: measured.perTile,
  },
  palette: {
    note: "Dominant colours across all sampled tiles, by share of total pixels. This is the background set color_analysis.mjs composites markers over.",
    coverage_pct: measured.coveragePct,
    colours: measured.top,
  },
};

if (measured.fullPixelResult) {
  out.full_pixel_reference = {
    note: "Contrast computed over INDIVIDUAL sampled background pixels, not the 22-colour weighted palette. These are the figures the audit report and issues #149/#150 quote. color_analysis.mjs cannot recompute them from the committed palette.",
    measured_at: out.measured_at,
    method: `In-page over ${measured.perTile.length} decoded tiles; marker composited per js/app.js addMarker() (fill a=0.78, stroke a=0.95); WCAG relative-luminance contrast.`,
    sampled_background_pixels: measured.fullPixelResult.sampled_background_pixels,
    regenerable_by: "research/lens_ux_vision_g0/sample_positron_tiles.mjs --full-pixel-contrast (requires CARTO_BASEMAP_KEY)",
    candidates: measured.fullPixelResult.candidates,
    not_measured: [],
  };
} else {
  out.full_pixel_reference_absent = "Run with --full-pixel-contrast to record the per-pixel estimator the audit report quotes.";
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");
console.error(`wrote ${OUT} — ${measured.perTile.length} tiles, ${measured.pixelsTotal.toLocaleString("en-US")} px, ${measured.coveragePct}% coverage`);
