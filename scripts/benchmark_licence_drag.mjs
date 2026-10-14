// Granted urban-licence layer — Lens-drag interaction benchmark gate (K9, #71).
//
// This is the reproducible benchmark that REPLACES the original acceptance
// criterion "interaction-to-paint on a Lens drag does not regress against commit
// 42773bc with the layer enabled" (issue #71), per the explicit amendment
// approved on 14 Oct 2026. The historical 42773bc comparison is retained as
// documented evidence (docs/URBAN_LICENCES_V1.md §17 and issue #71), but the
// enforceable gate is a same-build script-and-layout measurement:
//
//   * median per-interaction cost with the licence layer ENABLED  <= 10 ms
//   * median ADDITIONAL cost of enabling it, on the same build     <=  5 ms
//
// Method: headless Chromium, fixed viewport (1280x900, DPR 1), the map pinned to
// a fixed view, and a fixed pixel drag path driven through the production
// __HALO_REGRESSION__.moveLens primitive (each call runs the real refresh()),
// each followed by a forced layout flush (reading offsetHeight) — i.e. script +
// layout, the paint-inducing work. The metric is the median ms per interaction
// over several warmed passes. The licence window is set to the full register
// extent so the in-lens count scan runs over every resolved point (~11.3k), the
// worst case; the trailing-12-month default window is lighter.
//
// SCOPE OF THIS BENCHMARK. It measures script execution and layout only. It does
// NOT establish full rendering frame-rate (compositor/raster), nor performance on
// real mobile devices; those are deferred to K12 runtime assessment (#74 owns the
// runtime-stack decisions). A pass here means the interaction stays cheap in the
// script-and-layout phase, with comfortable headroom under one 60 fps frame.
//
// Usage:  node scripts/benchmark_licence_drag.mjs [--root <dir>] [--json]
// Exit code 0 when both thresholds are met, 1 otherwise. Requires the dev
// dependency `playwright` (the same one the browser tests use).

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ENABLED_MAX_MS = 10; // median, licence layer enabled
const MARGINAL_MAX_MS = 5; // median additional cost vs disabled, same build

const args = process.argv.slice(2);
const rootArg = args.includes("--root") ? args[args.indexOf("--root") + 1] : null;
const asJson = args.includes("--json");
const ROOT = path.resolve(rootArg || path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));

const MIME = {
  ".css": "text/css", ".geojson": "application/geo+json", ".html": "text/html",
  ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = path.resolve(ROOT, rel);
  if (!target.startsWith(ROOT)) { res.writeHead(403).end("Forbidden"); return; }
  fs.readFile(target, (err, content) => {
    if (err) { res.writeHead(404).end("Not found"); return; }
    res.writeHead(200, { "content-type": (MIME[path.extname(target)] || "application/octet-stream") + "; charset=utf-8" });
    res.end(content);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true, args: ["--disable-gpu"] });

// One pass = N lens moves along a fixed pixel circle, each running the real
// refresh() and forcing a synchronous layout flush. Returns ms per interaction.
async function measure(enableLicences) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })).newPage();
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return route.abort();
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));

  let markers = 0;
  if (enableLicences) {
    await page.evaluate(() => window.__HALO_REGRESSION__.enableLicences());
    await page.evaluate(() => window.__HALO_REGRESSION__.setLicenceWindow("2023-01-13", "2026-09-30"));
    markers = await page.evaluate(() => window.__HALO_REGRESSION__.licenceSnapshot().mapMarkers);
  }
  await page.evaluate(() => { map.setView([40.415, -3.692], 14, { animate: false }); });
  await page.waitForTimeout(400);

  const pass = () => page.evaluate(() => {
    const N = 120, cx = 640, cy = 450, r = 180;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const x = cx + r * Math.cos(i * 0.25), y = cy + r * Math.sin(i * 0.25);
      window.__HALO_REGRESSION__.moveLens("A", x, y);
      void document.body.offsetHeight; // force layout flush
    }
    return (performance.now() - t0) / N;
  });

  await pass(); await pass(); // warm up
  const samples = [];
  for (let i = 0; i < 7; i++) samples.push(await pass());
  samples.sort((a, b) => a - b);
  await page.context().close();
  return { median: samples[Math.floor(samples.length / 2)], min: samples[0], max: samples[samples.length - 1], markers };
}

const off = await measure(false);
const on = await measure(true);
await browser.close();
await new Promise((resolve) => server.close(resolve));

const enabledMedian = +on.median.toFixed(3);
const marginal = +(on.median - off.median).toFixed(3);
const enabledOk = enabledMedian <= ENABLED_MAX_MS;
const marginalOk = marginal <= MARGINAL_MAX_MS;
const pass = enabledOk && marginalOk;

if (asJson) {
  console.log(JSON.stringify({ off, on, enabledMedian, marginal, ENABLED_MAX_MS, MARGINAL_MAX_MS, enabledOk, marginalOk, pass }, null, 2));
} else {
  const ms = (x) => `${x.toFixed(2)} ms`;
  console.log("Lens-drag interaction benchmark (script + layout, median ms/interaction)");
  console.log(`  layer OFF            : ${ms(off.median)}  (range ${ms(off.min)}–${ms(off.max)})`);
  console.log(`  layer ON (${on.markers} pts) : ${ms(on.median)}  (range ${ms(on.min)}–${ms(on.max)})`);
  console.log(`  marginal (ON - OFF)  : ${ms(marginal)}`);
  console.log(`  gate: enabled <= ${ENABLED_MAX_MS} ms  -> ${enabledOk ? "PASS" : "FAIL"} (${ms(enabledMedian)})`);
  console.log(`  gate: marginal <= ${MARGINAL_MAX_MS} ms -> ${marginalOk ? "PASS" : "FAIL"} (${ms(marginal)})`);
  console.log(`  NOTE: script-and-layout only; does not establish rendering FPS or mobile-device performance (K12).`);
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
}
process.exit(pass ? 0 : 1);
