// K12 device-harness runner.
//
// Drives the harness HTML pages in a Chromium build and collects each page's
// window.__K12__ result into one JSON file. It is the AUTOMATION for the
// laptop/desktop class: run it with Playwright pointed at a REAL Chrome/Edge on
// a mid-range laptop and the output is a laptop-class result.
//
// Run on this container it still works, but the container has NO GPU
// (SwiftShader): every result then carries env.gl_is_software=true and
// is_device_grade=false, and the output file is tagged CONTAINER_SMOKE_TEST.
// Such a run PROVES the harness is repeatable; it is NOT a device benchmark and
// must never be reported as one.
//
//   node device_harness/run_device.mjs --suite=smoke   (a few scenarios; CI/smoke)
//   node device_harness/run_device.mjs --suite=full --label="Dell XPS13 i5 / Win11 / Chrome"
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
const LABEL = args.label || "CONTAINER (no GPU)";
const REPS = Number(args.reps || 40);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".geojson": "application/json", ".png": "image/png" };

function serve(root) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(root, u);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end("nf"); return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  });
}

const base = "research/runtime_spike/device_harness";
const proto = "research/runtime_spike/maplibre_proto";
const SUITES = {
  smoke: [
    { page: `${base}/leaflet_baseline.html`, q: "layers=ambito&basemap=light&auto=1" },
    { page: `${base}/leaflet_baseline.html`, q: "layers=ambito,licence,admin&basemap=light&auto=1" },
    { page: `${base}/leaflet_ceiling.html`, q: "kind=polygon&count=2000&auto=1" },
    { page: `${base}/leaflet_ceiling.html`, q: "kind=point&count=25000&auto=1" },
    { page: `${proto}/maplibre_prototype.html`, q: "layers=ambito&basemap=light&auto=1" },
  ],
  full: [
    // §1/§3 scenarios 1–8 on the real payload, light + satellite
    ...["admin", "ambito", "licence", "ambito,licence,admin"].flatMap((layers) =>
      ["light", "satellite"].map((bm) => ({ page: `${base}/leaflet_baseline.html`, q: `layers=${layers}&basemap=${bm}&auto=1` })),
    ),
    // §2 ceiling series
    ...[765, 2000, 5675, 10000].map((c) => ({ page: `${base}/leaflet_ceiling.html`, q: `kind=polygon&count=${c}&auto=1` })),
    ...[11500, 25000, 50000].map((c) => ({ page: `${base}/leaflet_ceiling.html`, q: `kind=point&count=${c}&auto=1` })),
    // §3 MapLibre same payload
    ...["ambito", "ambito,licence"].flatMap((layers) =>
      ["light", "satellite"].map((bm) => ({ page: `${proto}/maplibre_prototype.html`, q: `layers=${layers}&basemap=${bm}&auto=1` })),
    ),
  ],
};

const { srv, port } = await serve(ROOT);
const origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const results = [];
let software = null;

for (const s of SUITES[SUITE]) {
  const url = `${origin}/${s.page}?${s.q}&device_label=${encodeURIComponent(LABEL)}&reps=${REPS}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const label = `${path.basename(s.page)}?${s.q}`;
  try {
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => window.__K12__, null, { timeout: 90000 });
    const r = await page.evaluate(() => window.__K12__);
    software = r.env.gl_is_software;
    results.push(r);
    console.log(
      `ok  ${label}  itp.p95=${r.interaction_to_paint_ms?.p95}ms pan.p95=${r.pan_frame_ms?.p95}ms fcp=${r.first_contentful_paint_ms}ms heap=${r.js_heap_mb}MB`,
    );
  } catch (e) {
    results.push({ scenario: label, error: String(e).split("\n")[0] });
    console.log(`ERR ${label}  ${String(e).split("\n")[0]}`);
  }
  await page.close();
}

await browser.close();
srv.close();

const device_grade = software === false;
const out = {
  spike: "K12 runtime decision",
  measurement: "device_harness_run",
  run_kind: device_grade ? "DEVICE" : "CONTAINER_SMOKE_TEST — not a device benchmark",
  is_device_grade: device_grade,
  device_label: LABEL,
  suite: SUITE,
  caveat: device_grade
    ? "Results reflect the machine Playwright ran on."
    : "Software rasteriser (SwiftShader) detected: interaction/paint/frame numbers are NOT device-representative. This file only proves the harness runs end-to-end and is repeatable.",
  generated_at: new Date().toISOString(),
  results,
};
const outName = device_grade ? `device_run_${SUITE}.json` : `container_smoke_${SUITE}.json`;
const outPath = path.join(ROOT, "research/runtime_spike/results", outName);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\n${out.run_kind}\n→ ${path.relative(ROOT, outPath)}`);
process.exit(0);
