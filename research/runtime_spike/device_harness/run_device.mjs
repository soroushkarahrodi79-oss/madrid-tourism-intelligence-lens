// K12 device-harness runner.
//
// Drives the harness HTML pages in a browser and collects each page's
// window.__K12__ result into one JSON file.
//
// RELIABILITY CONTRACT (reviews #2 / device micro-gate). A DEVICE-VALIDATION run
// is accepted only if ALL of the following hold, else the process EXITS NON-ZERO
// and the output is written as a non-device smoke file:
//   * complete       — every expected scenario ran and produced the required metrics;
//   * device_grade    — a positively-identified HARDWARE GPU (vendor token present,
//                       not SwiftShader/llvmpipe/NO_WEBGL/generic), a real UA, a
//                       human --label, AND a real browser channel (chrome|msedge)
//                       launched HEADED. Fails CLOSED when identity is unverified;
//   * comparable      — every comparative pairKey has BOTH engines present+complete.
// A bundled headless Chromium (Playwright default) is NOT accepted as device-grade.
//
//   # physical Windows laptop, real browser, headed:
//   node device_harness/run_device.mjs --suite=full --channel=chrome --headed \
//        --label="Dell XPS13 i5 / Win11 / Chrome 131" --require-device
//   # harness smoke (any machine; never device-grade):
//   node device_harness/run_device.mjs --suite=smoke
//
// iPad Safari cannot run Playwright — use device_harness/IPAD.md (manual).

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { scenarioComplete, deviceGradeOf } from "./grade.mjs";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=?(.*)$/);
    return m ? [m[1], m[2] || true] : [a, true];
  }),
);
const SUITE = args.suite || "smoke";
const LABEL = typeof args.label === "string" && args.label ? args.label : "";
const REQUIRE_DEVICE = Boolean(args["require-device"]);
const HEADED = Boolean(args.headed);
const CHANNEL = typeof args.channel === "string" && args.channel ? args.channel : "chromium";
const REPS = Number(args.reps || 40);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".geojson": "application/json", ".png": "image/png" };

function serve(root) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(root, u);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  });
}

const LB = `research/runtime_spike/device_harness/leaflet_baseline.html`;
const LC = `research/runtime_spike/device_harness/leaflet_ceiling.html`;
const ML = `research/runtime_spike/maplibre_proto/maplibre_prototype.html`;

// Comparative scenarios run the SAME layers/zoom/basemap/recompute on BOTH
// engines (identical workload). Ceiling runs the SAME kind/count on both.
// pairKey ties a Leaflet scenario to its MapLibre twin for the comparability gate.
const CMP_LAYERS = ["ambito", "ambito,licence", "ambito,licence,admin"];

function realPair(layers, basemap, recompute) {
  const q = `layers=${layers}&basemap=${basemap}&recompute=${recompute}`;
  const pairKey = `real|${layers}|${basemap}|${recompute}`;
  return [
    { page: LB, q, engine: "leaflet", comparative: true, pairKey },
    { page: ML, q, engine: "maplibre", comparative: true, pairKey },
  ];
}
function ceilPair(kind, count) {
  const q = `kind=${kind}&count=${count}`;
  const pairKey = `ceil|${kind}|${count}`;
  return [
    { page: LC, q, engine: "leaflet", comparative: true, pairKey },
    { page: ML, q, engine: "maplibre", comparative: true, pairKey },
  ];
}

const SUITES = {
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

const gradeOf = (r) => deviceGradeOf(r, { label: LABEL, channel: CHANNEL, headed: HEADED });

const { srv, port } = await serve(ROOT);
const origin = `http://127.0.0.1:${port}`;
let browser;
let launchError = null;
try {
  browser = await chromium.launch(CHANNEL === "chromium" ? { headless: !HEADED } : { channel: CHANNEL, headless: !HEADED });
} catch (e) {
  launchError = String(e).split("\n")[0];
}
const expected = SUITES[SUITE];
const results = [];
let browserVersion = null;

if (browser) {
  browserVersion = browser.version();
  for (const s of expected) {
    const url = `${origin}/${s.page}?${s.q}&device_label=${encodeURIComponent(LABEL)}&reps=${REPS}&auto=1`;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const label = `${s.engine}:${path.basename(s.page)}?${s.q}`;
    // Fail fast on an uncaught page error (e.g. MapLibre CDN unreachable) instead
    // of waiting out the full readiness timeout.
    let onPageError;
    const pageError = new Promise((_, reject) => {
      onPageError = (e) => reject(new Error("pageerror: " + e.message));
      page.on("pageerror", onPageError);
    });
    pageError.catch(() => {}); // a late rejection after the race must not be unhandled
    try {
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      await Promise.race([
        page.waitForFunction(() => window.__K12__, null, { timeout: 120000 }),
        pageError,
      ]);
      const r = await page.evaluate(() => window.__K12__);
      r.pairKey = s.pairKey;
      r.comparative = s.comparative;
      results.push(r);
      const c = scenarioComplete(r);
      console.log(`${c.ok ? "ok " : "INC"} ${label}  itp.p95=${r.interaction_to_paint_ms?.p95} recompute.med=${r.interaction_recompute_ms?.median ?? "-"} pan.p95=${r.pan_frame_ms?.p95} ready=${r.readiness_barrier ?? "-"}${c.ok ? "" : "  [" + c.why + "]"}`);
    } catch (e) {
      results.push({ scenario: label, query: s.q, engine: s.engine, pairKey: s.pairKey, comparative: s.comparative, error: String(e).split("\n")[0] });
      console.log(`ERR ${label}  ${String(e).split("\n")[0]}`);
    }
    if (onPageError) page.off("pageerror", onPageError);
    await page.close();
  }
  await browser.close();
}
srv.close();

// completeness
const completeness = expected.map((s, i) => {
  const r = results[i];
  const c = r ? scenarioComplete(r) : { ok: false, why: launchError || "browser launch failed" };
  return { scenario: `${s.engine}:${path.basename(s.page)}?${s.q}`, pairKey: s.pairKey, engine: s.engine, complete: c.ok, reason: c.ok ? null : c.why };
});
const allComplete = completeness.length > 0 && completeness.every((c) => c.complete);

// comparability: every comparative pairKey must have BOTH engines complete
const pairMap = {};
for (const c of completeness) {
  if (!expected.find((s) => s.pairKey === c.pairKey)?.comparative) continue;
  pairMap[c.pairKey] = pairMap[c.pairKey] || {};
  pairMap[c.pairKey][c.engine] = c.complete;
}
const comparability = Object.entries(pairMap).map(([pairKey, engines]) => ({
  pairKey, leaflet: !!engines.leaflet, maplibre: !!engines.maplibre, comparable: !!engines.leaflet && !!engines.maplibre,
}));
const allComparable = comparability.length > 0 && comparability.every((p) => p.comparable);

// device-grade
const grades = results.filter((r) => r && r.env).map(gradeOf);
const deviceGrade = grades.length > 0 && grades.every((g) => g.device_grade);
const sampleBasis = grades[0]?.basis || null;

const isDeviceValidation = allComplete && deviceGrade && allComparable;
const out = {
  spike: "K12 runtime decision",
  measurement: "device_harness_run",
  suite: SUITE,
  device_label: LABEL || "(none supplied)",
  complete: allComplete,
  comparable: allComparable,
  is_device_grade: deviceGrade,
  run_kind: isDeviceValidation ? "DEVICE_VALIDATION" : "NON_DEVICE / INCOMPLETE — not a device benchmark",
  device_grade_basis: sampleBasis,
  device_grade_rule: "fails CLOSED: needs a hardware GPU vendor token (not SwiftShader/llvmpipe/NO_WEBGL/generic) AND real UA AND human --label AND a real browser channel (chrome|msedge) launched HEADED. Absence of a SwiftShader string is NOT sufficient.",
  launch: { channel: CHANNEL, headed: HEADED, browser_version: browserVersion, launch_error: launchError },
  verified_config: {
    gl_renderer: sampleBasis?.gl_renderer ?? null,
    userAgent: results.find((r) => r.env)?.env?.userAgent ?? null,
    viewport: results.find((r) => r.env)?.env?.viewport ?? null,
    channel: CHANNEL, headed: HEADED, browser_version: browserVersion,
  },
  expected_scenarios: expected.length,
  obtained_scenarios: results.filter((r) => r && !r.error).length,
  completeness,
  comparability,
  generated_at: new Date().toISOString(),
  results,
};
const outName = isDeviceValidation ? `device_run_${SUITE}.json` : `container_smoke_${SUITE}.json`;
const outPath = path.join(ROOT, "research/runtime_spike/results", outName);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

console.log(`\n${out.run_kind}  complete=${allComplete} comparable=${allComparable} device_grade=${deviceGrade}`);
console.log(`→ ${path.relative(ROOT, outPath)}`);

let exitCode = 0;
if (!allComplete) { console.error(`BLOCKER: ${completeness.filter((c) => !c.complete).length} scenario(s) missing/failed/incomplete.`); exitCode = 1; }
if (!allComparable) { console.error("BLOCKER: some comparative pairs lack both engines (not comparable)."); exitCode = 1; }
if (REQUIRE_DEVICE && !deviceGrade) { console.error("BLOCKER: --require-device set but run is not device-grade (fails closed on GPU/channel/headed/label)."); exitCode = 1; }
process.exit(exitCode);
