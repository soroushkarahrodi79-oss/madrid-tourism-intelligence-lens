// LENS-UX-VISION-G0 — executable reproduction of the map's VISUAL claims.
//
// The contrast arithmetic is reproduced by color_analysis.mjs. This script
// reproduces the claims arithmetic cannot settle: how many cluster chips are on
// screen, how much of the viewport they cover, that two operational categories
// render identically, and the salience ratio between the dominant mark and the
// evidence. Those are the quantitative core of #149 and the reason its verdict
// is not a matter of taste.
//
//   node research/lens_ux_vision_g0/capture_map_evidence.mjs
//   node research/lens_ux_vision_g0/capture_map_evidence.mjs --screenshots --viewport 1366x768
//
// It opens the PUBLIC DEPLOYMENT read-only in headless Chromium. It changes no
// repository asset, submits nothing, stores no preference, and asserts the
// pinned deployment before measuring.
//
// SCREENSHOTS ARE OPT-IN (--screenshots) AND ARE NOT COMMITTED. Captures include
// live third-party basemap tiles: "(c) OpenStreetMap contributors (c) CARTO",
// OpenStreetMap data under ODbL. Redistributing them requires carrying that
// attribution, which is written into the metadata file beside every capture.
// The committed evidence is the measurement JSON, which carries no third-party
// imagery at all.
//
// LIMITATIONS, which bound every number this produces:
//   * Tile imagery is mutable; CARTO may re-render Positron at any time.
//   * Cluster census depends on viewport size and the restored map centre/zoom,
//     both recorded in the output. It is ONE view, not a survey of Madrid.
//   * Coverage is computed from bounding boxes of circular chips, so it
//     OVERSTATES painted area; it is an upper bound, reported as such.
//   * Headless Chromium is not the user's browser. Font availability and device
//     pixel ratio differ; see the typography finding in #151.
//   * It measures what the DOM reports, not what a person perceives.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative, isAbsolute, basename } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };

const RESULTS_DIR = resolve(HERE, "results");
const SHOTS = argv.includes("--screenshots");
const FORCE = argv.includes("--force");
const ACCEPT_NEW = argv.includes("--accept-new-deployment");
const EXPECT = flag("expect", resolve(RESULTS_DIR, "positron_palette_20261101.json"));
const [VW, VH] = String(flag("viewport", "1440x900")).split("x").map(Number);
const OUT = resolve(RESULTS_DIR, flag("out", `map_evidence_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json`).replace(/^results[\\/]/, ""));
const SITE = "https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens";

const ATTRIBUTION = "(c) OpenStreetMap contributors (c) CARTO. Basemap tiles by CARTO; " +
  "map data from OpenStreetMap, licensed under ODbL (https://opendatacommons.org/licenses/odbl/). " +
  "Any redistribution of captures from this script must carry this attribution.";

if (!Number.isFinite(VW) || !Number.isFinite(VH)) {
  console.error(`--viewport must look like 1440x900; got ${flag("viewport", "")}`); process.exit(2);
}
const rel = relative(RESULTS_DIR, OUT);
if (rel.startsWith("..") || isAbsolute(rel)) {
  console.error(`--out must stay inside ${RESULTS_DIR}; got ${OUT}`); process.exit(2);
}
if (existsSync(OUT) && !FORCE) {
  console.error(`${OUT} already exists. Refusing to overwrite committed evidence.`);
  console.error(`Choose a different --out, or pass --force if you intend to replace it.`);
  process.exit(2);
}

// ---- pin the deployment, and verify rather than merely record ----
const r = await fetch(`${SITE}/data/deployment_manifest.json`);
if (!r.ok) { console.error(`deployment manifest -> HTTP ${r.status}`); process.exit(1); }
const manifestBuf = Buffer.from(await r.arrayBuffer());
const manifest = JSON.parse(manifestBuf.toString("utf8"));
const observed = {
  app_commit: manifest.commit,
  pages_deployment_workflow_run: String(manifest.workflow_run),
  deployment_manifest_sha256: createHash("sha256").update(manifestBuf).digest("hex"),
  deployment_build_state: manifest.build_state,
};
if (manifest.build_state !== "pass") {
  console.error(`deployment build_state is "${manifest.build_state}" — refusing to measure a degraded build`);
  process.exit(1);
}
let pinVerification = { mode: "unverified", expected_from: null, differences: [] };
if (ACCEPT_NEW) {
  pinVerification = { mode: "accepted_new_deployment", expected_from: null, differences: [] };
} else if (existsSync(EXPECT)) {
  const prior = JSON.parse(readFileSync(EXPECT, "utf8")).pinned_inputs || {};
  const diffs = ["app_commit", "pages_deployment_workflow_run", "deployment_manifest_sha256", "deployment_build_state"]
    .filter((f) => prior[f] !== undefined && prior[f] !== null && observed[f] !== prior[f])
    .map((f) => ({ field: f, expected: prior[f], observed: observed[f] }));
  pinVerification = { mode: diffs.length ? "mismatch" : "verified", expected_from: basename(EXPECT), differences: diffs };
  if (diffs.length) {
    console.error(`DEPLOYMENT MOVED since ${basename(EXPECT)}:`);
    for (const d of diffs) console.error(`  ${d.field}: expected ${String(d.expected).slice(0, 12)}... observed ${String(d.observed).slice(0, 12)}...`);
    console.error(`The #149 figures are pinned to the expected build. Re-run with --accept-new-deployment --out <new file> to re-pin deliberately.`);
    process.exit(3);
  }
  console.error(`pin verified against ${basename(EXPECT)}`);
}

const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: VW, height: VH }, colorScheme: "light" });
await page.goto(SITE, { waitUntil: "networkidle" });
await page.waitForSelector(".leaflet-container", { timeout: 30000 });
await page.waitForTimeout(2500); // let tiles, clusters and panel content settle

const measured = await page.evaluate(() => {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const relL = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
  const cr = (a, b) => { const la = relL(a), lb = relL(b); return +(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05))).toFixed(2); };
  const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { rgb: v.slice(0, 3), a: v.length > 3 ? v[3] : 1 }; };

  const root = document.documentElement;
  const map = document.querySelector(".leaflet-container");
  const mapRect = map.getBoundingClientRect();
  const chips = [...document.querySelectorAll(".poi-cluster")];
  const byType = {};
  chips.forEach((c) => { const t = [...c.classList].find((x) => x.startsWith("cluster-")); byType[t] = (byType[t] || 0) + 1; });

  // Upper bound: bounding boxes of circular chips overstate painted area.
  let boxArea = 0;
  chips.forEach((c) => { const b = c.getBoundingClientRect(); if (b.width) boxArea += b.width * b.height; });

  // Do two cluster types render identically? Compare the properties that could
  // carry identity.
  const PROPS = ["backgroundColor", "color", "borderColor", "borderStyle", "borderWidth",
                 "boxShadow", "width", "height", "fontSize", "fontWeight", "borderRadius",
                 "backgroundImage", "clipPath", "maskImage"];
  const sig = (sel) => { const e = document.querySelector(sel); if (!e) return null; const s = getComputedStyle(e); return Object.fromEntries(PROPS.map((p) => [p, s[p]])); };
  const stay = sig(".poi-cluster.cluster-stay"), bike = sig(".poi-cluster.cluster-bike");
  const differing = stay && bike ? PROPS.filter((p) => stay[p] !== bike[p]) : null;

  // Salience: chip surface composited over a representative tile pixel, against
  // the weakest shipped marker (rail), composited the same way.
  const chipBg = stay ? parse(getComputedStyle(document.querySelector(".poi-cluster.cluster-stay")).backgroundColor) : null;
  const TILE = [237, 237, 237]; // #ededed, second most common Positron colour
  const comp = (c, a, bg) => [0, 1, 2].map((i) => Math.round(a * c[i] + (1 - a) * bg[i]));
  const chipCr = chipBg ? cr(comp(chipBg.rgb, chipBg.a, TILE), TILE) : null;
  const railCr = cr(comp([255, 209, 102], 0.95, TILE), TILE);

  const tiles = [...document.querySelectorAll("img.leaflet-tile")].map((i) => i.src);
  const hosts = {};
  tiles.forEach((t) => { try { const h = new URL(t).host; hosts[h] = (hosts[h] || 0) + 1; } catch (e) { /* ignore */ } });

  return {
    url: location.href,
    appearance: { resolved: root.dataset.appearance, preference: root.dataset.appearancePreference,
                  systemPrefersDark: matchMedia("(prefers-color-scheme: dark)").matches },
    basemap: { select: (document.getElementById("basemapSelect") || {}).value,
               tileHosts: hosts, tileCount: tiles.length,
               attribution: (document.querySelector(".leaflet-control-attribution") || {}).textContent || null,
               cartoKeyPresent: Boolean(window.RUNTIME_CONFIG && window.RUNTIME_CONFIG.CARTO_BASEMAP_KEY) },
    viewport: { w: innerWidth, h: innerHeight },
    mapRect: { w: Math.round(mapRect.width), h: Math.round(mapRect.height) },
    clusters: {
      total: chips.length, byType,
      viewportCoveragePctUpperBound: +((100 * boxArea) / (mapRect.width * mapRect.height)).toFixed(1),
      coverageMethod: "sum of chip bounding boxes / map area — overstates painted area for circular chips",
      stayVsBikeDifferingProperties: differing,
      stayVsBikeIdentical: differing ? differing.length === 0 : null,
      comparedProperties: PROPS,
    },
    salience: {
      tileReference: "#ededed",
      clusterContrastVsTile: chipCr,
      weakestMarkerContrastVsTile: railCr,
      ratio: chipCr && railCr ? +(chipCr / railCr).toFixed(1) : null,
      note: "Single representative tile colour, not the full distribution. color_analysis.mjs holds the distributional result.",
    },
    panels: (() => {
      const l = document.querySelector(".left"), p = document.querySelector(".panel");
      const g = (e) => e ? { renderedH: Math.round(e.getBoundingClientRect().height), contentH: e.scrollHeight,
                             belowFoldPct: Math.round(100 * (1 - e.clientHeight / e.scrollHeight)) } : null;
      // Panel content height is STATE-DEPENDENT. A fresh browser profile shows the
      // first-run tutorial card inside the analysis panel, which adds roughly
      // 225px. Recording the state is what makes the number citable.
      const tutorial = document.querySelector(".tutorial-card, .tutorial-intro, [class*='tutorial']:not(.tutorial-help)");
      const tutorialVisible = Boolean(tutorial && tutorial.getBoundingClientRect().height > 0);
      return {
        left: g(l), analysis: g(p),
        firstRunTutorialVisible: tutorialVisible,
        stateNote: tutorialVisible
          ? "Fresh profile: the first-run tutorial card is inside the analysis panel and inflates contentH."
          : "Tutorial dismissed or absent: this is the steady-state content height.",
      };
    })(),
  };
});

const files = [];
if (SHOTS) {
  mkdirSync(resolve(RESULTS_DIR, "captures"), { recursive: true });
  const shot = resolve(RESULTS_DIR, "captures", `map_${VW}x${VH}_${Date.now()}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  const buf = readFileSync(shot);
  files.push({ file: basename(shot), bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex"),
               viewport: `${VW}x${VH}`, attribution: ATTRIBUTION });
  console.error(`wrote capture ${shot} — NOT committed; see the attribution requirement in the metadata`);
}
await browser.close();

const out = {
  contract_version: "1.0.0",
  measured_at: new Date().toISOString(),
  tool: "research/lens_ux_vision_g0/capture_map_evidence.mjs",
  pinned_inputs: observed,
  pin_verification: pinVerification,
  requested_viewport: `${VW}x${VH}`,
  measurement: measured,
  screenshots: SHOTS ? files : [],
  attribution: ATTRIBUTION,
  limitations: [
    "Tile imagery is mutable; CARTO may re-render Positron at any time.",
    "One view at one viewport and the restored default centre/zoom — not a survey of Madrid.",
    "Cluster coverage is a bounding-box upper bound; circular chips paint less than their boxes.",
    "Headless Chromium is not the user's browser: font availability and device pixel ratio differ (#151).",
    "DOM measurement is not perception; no human has been tested (#153).",
    "Salience uses one representative tile colour; the distributional result is in color_analysis.mjs.",
  ],
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");

const c = measured.clusters;
console.error(`wrote ${OUT}`);
console.error(`  clusters: ${c.total} (${Object.entries(c.byType).map(([k, v]) => `${k}=${v}`).join(", ")})`);
console.error(`  viewport coverage (upper bound): ${c.viewportCoveragePctUpperBound}%`);
console.error(`  cluster types identical: ${c.stayVsBikeIdentical} (differing of ${c.comparedProperties.length}: ${c.stayVsBikeDifferingProperties?.join(", ") || "none"})`);
console.error(`  salience ratio cluster:weakest-marker = ${measured.salience.ratio}x`);
