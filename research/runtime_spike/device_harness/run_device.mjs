// K12 device-harness runner.
//
// Drives the harness HTML pages in a Chromium build and collects each page's
// window.__K12__ result into one JSON file.
//
// RELIABILITY CONTRACT (review #2): a device-validation run is COMPLETE only if
// every expected scenario ran AND produced the required metrics. Any missing,
// errored, incomplete or non-comparable scenario sets complete=false and makes
// the process EXIT NON-ZERO. A SwiftShader string's ABSENCE is NOT sufficient to
// certify physical hardware: device-grade requires a positively-identified
// non-software GPU, a real UA, AND a non-placeholder, human-supplied
// device_label. Pass --require-device to HARD-FAIL a run that is not device-grade.
//
//   node device_harness/run_device.mjs --suite=smoke
//   node device_harness/run_device.mjs --suite=full --label="Dell XPS13 i5 / Win11 / Chrome 131" --require-device
//
// iPad Safari cannot run Playwright — use device_harness/IPAD.md (manual).

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

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

const base = "research/runtime_spike/device_harness";
const proto = "research/runtime_spike/maplibre_proto";
const lb = (q) => ({ page: `${base}/leaflet_baseline.html`, q });
const lc = (q) => ({ page: `${base}/leaflet_ceiling.html`, q });
const ml = (q) => ({ page: `${proto}/maplibre_prototype.html`, q });

const SUITES = {
  smoke: [
    lb("layers=ambito&basemap=light&recompute=renderer"),
    lb("layers=ambito,licence,admin&basemap=light&recompute=full"),
    lc("kind=polygon&count=2000"),
    ml("layers=ambito&basemap=light&recompute=renderer"),
  ],
  full: [
    // Leaflet real payload — renderer-only AND full-Lens, light + satellite (parity axis)
    ...["renderer", "full"].flatMap((rc) =>
      ["light", "satellite"].flatMap((bm) =>
        ["ambito", "licence", "ambito,licence,admin"].map((ly) => lb(`layers=${ly}&basemap=${bm}&recompute=${rc}`)),
      ),
    ),
    // Leaflet ceiling series (the MapLibre trigger)
    ...[765, 2000, 5675, 10000].map((c) => lc(`kind=polygon&count=${c}`)),
    ...[11500, 25000, 50000].map((c) => lc(`kind=point&count=${c}`)),
    // MapLibre — SAME real payload (renderer + full) AND the SAME ceiling series (parity)
    ...["renderer", "full"].flatMap((rc) => ["light", "satellite"].map((bm) => ml(`layers=ambito,licence&basemap=${bm}&recompute=${rc}`))),
    ...[765, 2000, 5675, 10000].map((c) => ml(`kind=polygon&count=${c}`)),
    ...[11500, 25000, 50000].map((c) => ml(`kind=point&count=${c}`)),
  ],
};

const REQUIRED_METRICS = ["interaction_to_paint_ms", "pan_frame_ms", "first_contentful_paint_ms"];

function scenarioComplete(r) {
  if (!r || r.error) return { ok: false, why: r?.error || "no result" };
  const missing = REQUIRED_METRICS.filter((k) => r[k] === undefined || r[k] === null);
  if (missing.length) return { ok: false, why: `missing metrics: ${missing.join(",")}` };
  return { ok: true };
}

// Device-grade: NOT merely "no swiftshader". Require a positively identified
// hardware GPU, a real UA, and a human-supplied device_label.
function deviceGradeOf(r) {
  const e = r.env || {};
  const gl = String(e.gl_renderer || "");
  const software = e.gl_is_software || /swiftshader|llvmpipe|software|microsoft basic/i.test(gl);
  const hasRealGpu = !software && gl !== "" && gl !== "unknown" && gl !== "NO_WEBGL";
  const hasLabel = Boolean(LABEL) && !/container|unlabelled/i.test(LABEL);
  const hasUA = Boolean(e.userAgent) && e.userAgent !== "unknown";
  const basis = { gl_renderer: gl, gl_is_software: software, has_real_gpu: hasRealGpu, has_human_label: hasLabel, has_ua: hasUA };
  return { device_grade: hasRealGpu && hasLabel && hasUA, basis };
}

const { srv, port } = await serve(ROOT);
const origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const expected = SUITES[SUITE];
const results = [];

for (const s of expected) {
  const url = `${origin}/${s.page}?${s.q}&device_label=${encodeURIComponent(LABEL)}&reps=${REPS}&auto=1`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const label = `${path.basename(s.page)}?${s.q}`;
  try {
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => window.__K12__, null, { timeout: 90000 });
    const r = await page.evaluate(() => window.__K12__);
    results.push(r);
    const c = scenarioComplete(r);
    console.log(`${c.ok ? "ok " : "INC"} ${label}  itp.p95=${r.interaction_to_paint_ms?.p95} recompute.med=${r.interaction_recompute_ms?.median ?? "-"} pan.p95=${r.pan_frame_ms?.p95} fcp=${r.first_contentful_paint_ms} heap=${r.js_heap_mb}${c.ok ? "" : "  [" + c.why + "]"}`);
  } catch (e) {
    results.push({ scenario: label, query: s.q, error: String(e).split("\n")[0] });
    console.log(`ERR ${label}  ${String(e).split("\n")[0]}`);
  }
  await page.close();
}
await browser.close();
srv.close();

// completeness + device-grade gate
const completeness = expected.map((s, i) => {
  const r = results[i];
  const c = scenarioComplete(r);
  return { scenario: `${path.basename(s.page)}?${s.q}`, complete: c.ok, reason: c.ok ? null : c.why };
});
const allComplete = completeness.every((c) => c.complete);
const grades = results.filter((r) => r && r.env).map(deviceGradeOf);
const deviceGrade = grades.length > 0 && grades.every((g) => g.device_grade);
const sampleBasis = grades[0]?.basis || null;

const out = {
  spike: "K12 runtime decision",
  measurement: "device_harness_run",
  suite: SUITE,
  device_label: LABEL || "(none supplied)",
  complete: allComplete,
  is_device_grade: deviceGrade,
  run_kind: deviceGrade && allComplete ? "DEVICE_VALIDATION" : deviceGrade ? "DEVICE_INCOMPLETE" : "NON_DEVICE / SMOKE — not a device benchmark",
  device_grade_basis: sampleBasis,
  device_grade_rule: "requires a positively identified hardware GPU AND a real UA AND a human-supplied device_label — absence of a SwiftShader string is NOT sufficient",
  verified_config: {
    gl_renderer: sampleBasis?.gl_renderer ?? null,
    userAgent: results.find((r) => r.env)?.env?.userAgent ?? null,
    viewport: results.find((r) => r.env)?.env?.viewport ?? null,
  },
  expected_scenarios: expected.length,
  obtained_scenarios: results.filter((r) => r && !r.error).length,
  completeness,
  generated_at: new Date().toISOString(),
  results,
};
const outName = deviceGrade ? `device_run_${SUITE}.json` : `container_smoke_${SUITE}.json`;
const outPath = path.join(ROOT, "research/runtime_spike/results", outName);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

console.log(`\n${out.run_kind}  complete=${allComplete} device_grade=${deviceGrade}`);
console.log(`→ ${path.relative(ROOT, outPath)}`);

// Blockers → non-zero exit.
let exitCode = 0;
if (!allComplete) { console.error(`BLOCKER: ${completeness.filter((c) => !c.complete).length} scenario(s) missing/failed/incomplete.`); exitCode = 1; }
if (REQUIRE_DEVICE && !deviceGrade) { console.error("BLOCKER: --require-device set but run is not device-grade (software GPU or no human device_label)."); exitCode = 1; }
process.exit(exitCode);
