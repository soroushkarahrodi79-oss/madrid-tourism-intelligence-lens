// Planning-ámbito MEMBERSHIP (LENS_INTERSECT_AMBITO) interaction benchmark
// (UX-I1 / P0-a, #95).
//
// UX-D1 (#93) §5.5 withdrew the "no new computation" claim: promoting the
// `ambitosIntersecting` membership answer out of the closed `Detail` disclosure
// into the always-visible PLACE planning section means the 724-polygon
// circle-intersection scan runs on every Lens drag / radius input, where before
// it ran zero times (the query returned early while `#placeDetail` was closed).
// "Measure first, then apply the minimum the measurement justifies." This script
// is that measurement.
//
// TWO ARMS, both on the SAME build:
//
//   1. CPU-ONLY PROXY (Node, no browser): the raw cost of one
//      `ambitosIntersecting` scan against the committed artifacts, at the default
//      radius (900 m) and the maximum radius (5000 m), centre jittered per call
//      to defeat any caching. This reproduces UX-D1 §5.5's order-of-magnitude
//      figures. It is NOT a device measurement and NOT interaction-to-paint.
//
//   2. SCRIPTED LENS MOVEMENT (headless Chromium, script + layout proxy): median
//      ms per interaction along a fixed pixel path, driven by 120 synchronous
//      __HALO_REGRESSION__.moveLens() calls through the production refresh(),
//      each followed by a forced layout flush, over seven warmed runs, with
//      --disable-gpu. This is NOT an actual pointer/touch drag, NOT a rendered
//      frame-rate and NOT drag-event timing — it is a DOM/layout proxy for
//      comparing scheduling strategies on the same build.
//      Measured in two sub-arms that isolate the coalescing strategy:
//        a. PROMOTED, NO COALESCING  — every move runs the scan (the naive cost
//           of promotion: the regression the strategy must avoid).
//        b. PROMOTED, COALESCED (shipped) — the membership scan is deferred while
//           the Lens is moving (honest "Updating…" pending state) and settles
//           once on release; the per-drag cost excludes the scan.
//      The marginal (a − b) is the per-interaction cost the coalescing removes.
//
// SCOPE. Arm 2 measures script + layout only on a headless desktop; it does NOT
// establish rendering frame-rate or performance on real mobile devices. Those
// are AC-P0-12 device-grade measurements and are reported separately as
// NOT TESTED / release-validation-pending when no supported device is available.
//
// Usage:  node scripts/benchmark_ambito_membership.mjs [--root <dir>] [--json]
//                                                       [--cpu-only]
// Exit code is always 0: this is a measurement, not a pass/fail gate (the gate is
// AC-P0-12 on real devices). It prints the numbers for the PR to quote.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const rootArg = args.includes("--root") ? args[args.indexOf("--root") + 1] : null;
const asJson = args.includes("--json");
const cpuOnly = args.includes("--cpu-only");
const ROOT = path.resolve(rootArg || path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));

const DEFAULT_CENTRE = { lon: -3.69, lat: 40.4149 }; // app.js defaults.A
const RADII = [900, 2000, 5000]; // default, mid, maximum (js/lens.js LENS_RADIUS)

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

// ---------------------------------------------------------- Arm 1: CPU proxy
async function cpuProxy() {
  const module = await import(pathToFileURL(path.join(ROOT, "js", "planning-ambito.js")).href);
  const index = module.createPlanningIndex({
    geometry: JSON.parse(fs.readFileSync(path.join(ROOT, "data", "planning", "madrid_ambitos.geojson"), "utf8")),
    state: JSON.parse(fs.readFileSync(path.join(ROOT, "data", "planning", "madrid_ambito_state.json"), "utf8")),
  });
  if (!index) throw new Error("planning index unavailable (artifacts missing?)");
  const ambitos = index.counts.ambitos;

  const rows = [];
  for (const radiusM of RADII) {
    const iterations = radiusM >= 5000 ? 200 : 400;
    // Warm-up.
    for (let i = 0; i < 50; i += 1) index.ambitosIntersecting(DEFAULT_CENTRE.lon, DEFAULT_CENTRE.lat, radiusM);
    const samples = [];
    for (let i = 0; i < iterations; i += 1) {
      // Jitter the centre each call (≈ a drag) so no identity cache could help.
      const lon = DEFAULT_CENTRE.lon + (Math.random() - 0.5) * 0.004;
      const lat = DEFAULT_CENTRE.lat + (Math.random() - 0.5) * 0.004;
      const t0 = performance.now();
      index.ambitosIntersecting(lon, lat, radiusM);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    rows.push({
      radiusM,
      iterations,
      median: +percentile(samples, 50).toFixed(3),
      p95: +percentile(samples, 95).toFixed(3),
      max: +samples[samples.length - 1].toFixed(3),
    });
  }
  // The containing query, for the ~200× contrast UX-D1 §5.5 draws.
  for (let i = 0; i < 50; i += 1) index.ambitoContaining(DEFAULT_CENTRE.lon, DEFAULT_CENTRE.lat);
  const containing = [];
  for (let i = 0; i < 400; i += 1) {
    const lon = DEFAULT_CENTRE.lon + (Math.random() - 0.5) * 0.004;
    const lat = DEFAULT_CENTRE.lat + (Math.random() - 0.5) * 0.004;
    const t0 = performance.now();
    index.ambitoContaining(lon, lat);
    containing.push(performance.now() - t0);
  }
  containing.sort((a, b) => a - b);
  return {
    ambitos,
    node: process.version,
    rows,
    containing: { median: +percentile(containing, 50).toFixed(3), p95: +percentile(containing, 95).toFixed(3) },
  };
}

// -------------------------------------- Arm 2: scripted Lens movement (proxy)
async function scriptedLensMovement() {
  const { chromium } = await import("playwright");
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
  // Always tear down the browser and the server, even if a step throws, so the
  // process exits instead of hanging on an open handle.
  const shutdown = async () => {
    try { await browser.close(); } catch { /* already closed */ }
    await new Promise((resolve) => server.close(resolve));
  };
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
    page.setDefaultTimeout(20000);
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return route.abort();
      return route.continue();
    });
    await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
    await page.waitForFunction(() => {
      const s = document.getElementById("planningAmbito");
      return s && !s.hasAttribute("hidden") && s.dataset.state && s.dataset.state !== "loading";
    });
    // Pin the map over central Madrid, where the default Lens intersects ámbitos.
    await page.evaluate(() => { map.setView([40.4149, -3.69], 14, { animate: false }); });
    await page.waitForTimeout(400);

  // One pass = N lens moves along a fixed pixel circle. When `coalesced`, the
  // move loop runs inside a begin/end interaction so the shipped coalescing
  // defers the scan; otherwise every move runs the scan (naive promotion).
  const pass = (coalesced) => page.evaluate((coalesced) => {
    const N = 120, cx = 720, cy = 450, r = 170;
    if (coalesced) window.__HALO_REGRESSION__.beginPlanningMembershipInteraction();
    const t0 = performance.now();
    for (let i = 0; i < N; i += 1) {
      const x = cx + r * Math.cos(i * 0.25), y = cy + r * Math.sin(i * 0.25);
      window.__HALO_REGRESSION__.moveLens("A", x, y);
      void document.body.offsetHeight;
    }
    const perMove = (performance.now() - t0) / N;
    let settle = 0;
    if (coalesced) {
      const s0 = performance.now();
      window.__HALO_REGRESSION__.endPlanningMembershipInteraction();
      void document.body.offsetHeight;
      settle = performance.now() - s0;
    }
    return { perMove, settle };
  }, coalesced);

  const run = async (coalesced) => {
    await pass(coalesced); await pass(coalesced); // warm
    const perMove = [], settle = [];
    for (let i = 0; i < 7; i += 1) { const s = await pass(coalesced); perMove.push(s.perMove); settle.push(s.settle); }
    perMove.sort((a, b) => a - b); settle.sort((a, b) => a - b);
    return {
      median: +perMove[Math.floor(perMove.length / 2)].toFixed(3),
      p95: +percentile(perMove, 95).toFixed(3),
      settleMedian: +settle[Math.floor(settle.length / 2)].toFixed(3),
    };
  };

    const naive = await run(false);
    const coalesced = await run(true);
    return { viewport: "1440x900 headless, script+layout proxy (not a pointer drag, not FPS)", naive, coalesced, marginal: +(naive.median - coalesced.median).toFixed(3) };
  } finally {
    await shutdown();
  }
}

// ------------------------------------------------------------------- report
const cpu = await cpuProxy();
let drag = null;
if (!cpuOnly) {
  try { drag = await scriptedLensMovement(); }
  catch (error) { drag = { error: String(error && error.message || error) }; }
}

if (asJson) {
  console.log(JSON.stringify({ cpu, drag }, null, 2));
} else {
  const ms = (x) => `${x.toFixed(2)} ms`;
  console.log(`Planning-ámbito membership benchmark — ${cpu.ambitos} ámbitos, Node ${cpu.node}`);
  console.log("");
  console.log("Arm 1 — CPU-ONLY PROXY of ambitosIntersecting (NOT a device, NOT interaction-to-paint):");
  for (const row of cpu.rows) {
    console.log(`  r=${String(row.radiusM).padStart(4)} m (${row.iterations}x): median ${ms(row.median)}  p95 ${ms(row.p95)}  max ${ms(row.max)}`);
  }
  console.log(`  ambitoContaining (contrast): median ${ms(cpu.containing.median)}  p95 ${ms(cpu.containing.p95)}`);
  console.log("");
  if (drag && !drag.error) {
    console.log(`Arm 2 — SCRIPTED LENS MOVEMENT, ${drag.viewport} (median ms/interaction):`);
    console.log(`  PROMOTED, no coalescing (scan every move): median ${ms(drag.naive.median)}  p95 ${ms(drag.naive.p95)}`);
    console.log(`  PROMOTED, coalesced (shipped)            : median ${ms(drag.coalesced.median)}  p95 ${ms(drag.coalesced.p95)}  (+1 settle scan ${ms(drag.coalesced.settleMedian)} on release)`);
    console.log(`  marginal per-interaction removed by coalescing: ${ms(drag.marginal)}`);
    console.log("  NOTE: script+layout on a headless desktop; NOT rendering FPS and NOT a mobile device (AC-P0-12).");
  } else if (drag) {
    console.log(`Arm 2 — SCRIPTED LENS MOVEMENT: not run (${drag.error})`);
  } else {
    console.log("Arm 2 — SCRIPTED LENS MOVEMENT: skipped (--cpu-only)");
  }
}
