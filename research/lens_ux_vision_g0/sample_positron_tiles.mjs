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
//   CARTO_BASEMAP_KEY=... node research/lens_ux_vision_g0/sample_positron_tiles.mjs --style dark_all --out results/dark.json
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
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };

const KEY = process.env.CARTO_BASEMAP_KEY || "";
const STYLE = flag("style", "light_all");
const OUT = resolve(HERE, flag("out", `results/positron_palette_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json`));
const SITE = "https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens";

if (!KEY) {
  console.error("CARTO_BASEMAP_KEY is not set.");
  console.error("Without it the app serves OpenStreetMap, not Positron (issue #155), so this");
  console.error("measurement would describe a different basemap. Refusing to produce a");
  console.error("palette that would be labelled Positron but measured from something else.");
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
console.error(`pinned to app commit ${pinned.app_commit.slice(0, 7)} (build_state ${pinned.deployment_build_state})`);

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
  let pixelsTotal = 0;
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
      Ls.sort((a, b) => a - b);
      const q = (p) => Ls[Math.floor(p * (Ls.length - 1))];
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
  return { top, perTile, pixelsTotal, errors, coveragePct: +top.reduce((s, c) => s + c.pct, 0).toFixed(1) };
}, { targets, style: STYLE, key: KEY, topN: TOP_N });

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
  sampling: {
    sites: SITES, zooms: ZOOMS,
    tiles_sampled: measured.perTile.length,
    tile_size_px: 256,
    pixels_total: measured.pixelsTotal,
    fetch_errors: measured.errors.length,
  },
  luminance_summary: {
    note: "WCAG relative luminance of raw tile pixels, per site and zoom.",
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

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");
console.error(`wrote ${OUT} — ${measured.perTile.length} tiles, ${measured.pixelsTotal.toLocaleString("en-US")} px, ${measured.coveragePct}% coverage`);
