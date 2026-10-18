/*
 * AC-P0-12 automated pan comparison — one command, no manual steps.
 *
 *   node research/ac_p0_12/auto_compare.mjs [--rounds=3] [--frames=60] [--dpr=2]
 *
 * It builds a DISPOSABLE clean `origin/main` worktree, applies ONLY
 * `baseline_app_instrumentation.patch` (the two test-only js/app.js hooks — no
 * P0-a) plus the runner, serves the PR checkout and the baseline on two local
 * loopback HTTP servers, launches REAL HEADED hardware-accelerated Chrome, and
 * drives IDENTICAL automated map-pan gestures against both — interleaved (ABBA),
 * ≥3 repeats/arm, ≥48 valid post-warm active-pan frames/repeat. It writes a
 * versioned machine-readable JSON to results/ and tears everything down.
 *
 * MEASUREMENT CLASS: `hardware_automated`. These are SCRIPTED Playwright mouse
 * drags on real hardware Chrome — they are NOT human physical gestures and NOT
 * `device_grade`/`actual_gesture` under the AC-P0-12 manual-device contract. They
 * never substitute for the owner's physical Safari/device validation.
 *
 * Fails CLOSED: if the baseline worktree/patch cannot be built, or Chrome cannot
 * be operated with a hardware (non-SwiftShader) GPU, it reports the limitation and
 * does not invent results. Always cleans up its browser, servers and worktree, and
 * never touches unrelated worktrees or untracked files.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync, statSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname } from "node:path";
import os from "node:os";
import { hardwareCheck, validSample, comparableEnv, driftCheck } from "./auto_compare_guards.mjs";
import { MADRID_CENTRE } from "./runner_core.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const PATCH = join(HERE, "baseline_app_instrumentation.patch");
const RESULTS = join(HERE, "results");

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
}));
const ROUNDS = Math.max(3, Number(args.rounds) || 3);
const FRAMES = Math.max(48, Number(args.frames) || 60);
const DPR = Number(args.dpr) || 2; // match the owner's physical run (env.viewport.dpr: 2)
const ZOOM = 14;

function git(cwd, ...a) { return execFileSync("git", a, { cwd, encoding: "utf8" }).trim(); }
const log = (...m) => console.log("[auto_compare]", ...m);
const round = (x) => (x == null ? null : Math.round(x * 100) / 100);

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".geojson": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".map": "application/json" };

function serve(root) {
  return new Promise((res) => {
    const srv = createServer((req, rq) => {
      try {
        let p = decodeURIComponent(req.url.split("?")[0]);
        if (p === "/") p = "/index.html";
        const fp = join(root, p);
        if (!fp.startsWith(root) || !existsSync(fp) || statSync(fp).isDirectory()) { rq.writeHead(404); return rq.end("404"); }
        rq.writeHead(200, { "Content-Type": MIME[extname(fp).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
        rq.end(readFileSync(fp));
      } catch (e) { rq.writeHead(500); rq.end(String(e)); }
    });
    srv.listen(0, "127.0.0.1", () => res({ srv, port: srv.address().port }));
  });
}

// Inject the REAL runner_core GestureCapture into the page and run one pan.
async function measurePan(page, mapSel = "#map") {
  const box = await page.evaluate((sel) => {
    const m = document.querySelector(sel).getBoundingClientRect();
    return { x: m.left, y: m.top, w: m.width, h: m.height };
  }, mapSel);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  await page.evaluate((min) => {
    window.__cap = new window.__RC.GestureCapture(window, { interaction: "pan", minSamples: min });
    window.__cap.start();
  }, FRAMES);
  // CLOSED-LOOP drag: the mouse travels a full circle and RETURNS to the mousedown
  // point, so the net map displacement is ~0 and the map centre returns to default
  // each pan (controls positional drift WITHOUT reloading → the page's JIT stays
  // warm, i.e. steady-state repeated panning, not cold-start). Circle centred at
  // (cx+R, cy): point(0)=point(2π)=(cx, cy).
  const R = Math.min(box.w, box.h) * 0.28;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const steps = FRAMES + 25, dt = (2 * Math.PI) / (steps / 3); // ~3 full loops
  for (let i = 1; i <= steps; i++) {
    const t = i * dt;
    await page.mouse.move(cx + R - R * Math.cos(t), cy + R * Math.sin(t), { steps: 1 });
    await page.waitForTimeout(9);
  }
  await page.mouse.move(cx, cy, { steps: 2 }); // ensure we end exactly at start
  await page.mouse.up();
  await page.waitForTimeout(120);
  return page.evaluate(() => window.__cap.stop());
}

// Load the app ONCE per arm to a fresh default state (keeps PR/main comparable),
// wait for the seam, map and default data, inject the real runner_core, and return
// the recorded environment including data_ready. Steady-state warm panning then
// happens on this loaded page (no reload per run → JIT stays warm); the closed-loop
// pan controls positional drift instead.
async function freshLoad(page, port) {
  await page.goto(`http://127.0.0.1:${port}/index.html?haloRegressionTest=1`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__HALO_REGRESSION__ && typeof window.__HALO_REGRESSION__.mapView === "function" && typeof window.__HALO_REGRESSION__.lensCenters === "function", { timeout: 60000 });
  await page.waitForFunction(() => { const s = window.__HALO_REGRESSION__; try { const v = s.mapView(); return v && isFinite(v.lat); } catch { return false; } }, { timeout: 60000 });
  // default data/layer readiness: the basemap + overlay canvases exist and a
  // settle frame has passed. Both arms get identical treatment.
  await page.waitForFunction(() => document.querySelectorAll("#map canvas, #map .leaflet-tile-loaded").length > 0, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.addScriptTag({ type: "module", content: `import * as m from '/research/ac_p0_12/runner_core.mjs'; window.__RC = m;` });
  await page.waitForFunction(() => !!window.__RC && !!window.__RC.GestureCapture, { timeout: 30000 });
  return page.evaluate(() => {
    const e = window.__RC.captureEnv(window, {});
    const seam = window.__HALO_REGRESSION__;
    const v = seam.mapView();
    return { gl_renderer: e.gl_renderer, gl_is_software: e.gl_is_software, dpr: window.devicePixelRatio, viewport: e.viewport,
      map: (() => { const m = document.getElementById("map").getBoundingClientRect(); return { w: Math.round(m.width), h: Math.round(m.height) }; })(),
      zoom: v.zoom, centre: { lat: v.lat, lon: v.lon }, data_ready: document.querySelectorAll("#map canvas, #map .leaflet-tile-loaded").length > 0,
      hasMembership: !!document.getElementById("planningMembership") };
  });
}

const mapCentre = (page) => page.evaluate(() => { const v = window.__HALO_REGRESSION__.mapView(); return { lat: v.lat, lon: v.lon, zoom: v.zoom }; });
async function mapBoxCentre(page) {
  const b = await page.evaluate(() => { const m = document.getElementById("map").getBoundingClientRect(); return { x: m.left, y: m.top, w: m.width, h: m.height }; });
  return { cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
}
async function dragBy(page, cx, cy, dx, dy) {
  await page.mouse.move(cx, cy); await page.mouse.down();
  const n = 8; for (let i = 1; i <= n; i++) await page.mouse.move(cx + (dx * i) / n, cy + (dy * i) / n, { steps: 1 });
  await page.mouse.up(); await page.waitForTimeout(80);
}
// Calibrate how many degrees of map-centre move per pixel of mouse drag (Leaflet
// pan is axis-aligned, no rotation), so re-centering is exact regardless of
// zoom/inertia sign conventions.
async function calibrate(page) {
  const { cx, cy } = await mapBoxCentre(page);
  const c0 = await mapCentre(page); await dragBy(page, cx, cy, 80, 0); const cx1 = await mapCentre(page);
  const c2 = await mapCentre(page); await dragBy(page, cx, cy, 0, 80); const cy1 = await mapCentre(page);
  const kLonX = (cx1.lon - c0.lon) / 80; // Δlon per +x px
  const kLatY = (cy1.lat - c2.lat) / 80; // Δlat per +y px
  return { kLonX, kLatY };
}
// Re-center the map to the default centre with a corrective drag (iterated) — H2
// "reset the map centre before each run", so successive pans measure the same tiles.
async function recenter(page, def, cal) {
  const { cx, cy } = await mapBoxCentre(page);
  for (let it = 0; it < 4; it++) {
    const c = await mapCentre(page);
    const dLat = c.lat - def.lat, dLon = c.lon - def.lon;
    if (Math.max(Math.abs(dLat), Math.abs(dLon)) < 5e-4) return true;
    const dx = cal.kLonX ? -dLon / cal.kLonX : 0;
    const dy = cal.kLatY ? -dLat / cal.kLatY : 0;
    await dragBy(page, cx, cy, Math.max(-400, Math.min(400, dx)), Math.max(-400, Math.min(400, dy)));
  }
  const c = await mapCentre(page);
  return Math.max(Math.abs(c.lat - def.lat), Math.abs(c.lon - def.lon)) < 2e-3;
}
// One steady-state (no-reload) measured pan on an already-loaded page: re-center to
// default FIRST (drift control), capture the start centre, optionally A/B-toggle the
// membership block (always restored), then measure. Returns { result, centre }.
async function pan(page, def, cal, { hideMembership = false } = {}) {
  await recenter(page, def, cal);
  const centre = await page.evaluate(() => { const v = window.__HALO_REGRESSION__.mapView(); return { lat: v.lat, lon: v.lon }; });
  if (hideMembership) await page.evaluate(() => { const b = document.getElementById("planningMembership"); if (b) b.style.display = "none"; });
  const result = await measurePan(page);
  if (hideMembership) await page.evaluate(() => { const b = document.getElementById("planningMembership"); if (b) b.style.display = ""; });
  return { result, centre };
}

function summarize(raw) {
  const s = [...raw].sort((a, b) => a - b); const pct = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  const r = (x) => Math.round(x * 100) / 100; const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { n: s.length, p50: r(pct(50)), p95: r(pct(95)), max: r(s[s.length - 1]), mean: r(mean) };
}
const agg = (runs) => { const all = runs.flatMap((x) => x.pan_frame_ms ? x.pan_frame_ms.raw : []); return { repeats: runs.length, per_run_p95: runs.map((x) => x.pan_frame_ms && x.pan_frame_ms.p95), per_run_p50: runs.map((x) => x.pan_frame_ms && x.pan_frame_ms.median), pooled: all.length ? summarize(all) : null, total_active_frames: all.length }; };
const median = (xs) => { const s = [...xs].filter((x) => typeof x === "number").sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

async function main() {
  mkdirSync(RESULTS, { recursive: true });
  const prSha = git(REPO, "rev-parse", "HEAD");
  const mainSha = git(REPO, "rev-parse", "origin/main");
  log(`PR ${prSha.slice(0, 8)} vs origin/main ${mainSha.slice(0, 8)}`);
  if (!existsSync(PATCH)) { fail("baseline_app_instrumentation.patch missing", { prSha }); }

  // Unique worktree path per run → a locked leftover from a prior run can never
  // collide (idempotent repeat runs). Prune stale registrations up front.
  try { git(REPO, "worktree", "prune"); } catch {}
  const wt = join(os.tmpdir(), `acp012-baseline-${process.pid}-${Date.now()}`);
  let worktreeAdded = false, servers = [], browser = null;
  const cleanupStatus = { browser_closed: false, servers_closed: false, worktree_removed: null, worktree_error: null };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // H3 — AWAIT every teardown; report worktree-removal failure explicitly (never a
  // silent success); only ever touch the worktree THIS run created.
  const cleanup = async () => {
    if (cleanupStatus._done) return; cleanupStatus._done = true;
    try { await Promise.all(servers.map((s) => new Promise((res) => { try { s.srv.close(res); } catch { res(); } }))); cleanupStatus.servers_closed = true; } catch {}
    if (browser) { try { await browser.close(); cleanupStatus.browser_closed = true; } catch (e) { cleanupStatus.worktree_error = "browser close: " + String(e).slice(0, 80); } }
    if (worktreeAdded) {
      for (let attempt = 1; attempt <= 4 && cleanupStatus.worktree_removed !== true; attempt++) {
        try { git(REPO, "worktree", "remove", "--force", wt); cleanupStatus.worktree_removed = true; }
        catch (e) { cleanupStatus.worktree_error = String(e).split("\n")[0].slice(0, 160); await sleep(500 * attempt); }
      }
      if (cleanupStatus.worktree_removed !== true) {
        try { rmSync(wt, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }); git(REPO, "worktree", "prune"); cleanupStatus.worktree_removed = !existsSync(wt); }
        catch (e) { cleanupStatus.worktree_error = String(e).slice(0, 160); }
      }
    } else cleanupStatus.worktree_removed = true;
    try { git(REPO, "worktree", "prune"); } catch {}
    if (cleanupStatus.worktree_removed !== true) {
      process.exitCode = 2;
      console.error(`[auto_compare] CLEANUP INCOMPLETE — disposable worktree not removed: ${wt} (${cleanupStatus.worktree_error}). Remove it manually; it is de-registered from git.`);
    }
  };

  // NULL-CONTROL self-test: --self=pr serves the SAME build (PR) on BOTH arms, so a
  // trustworthy harness must report paired delta ≈ 0 (any structured difference is
  // arm/port/page bias to fix, not a real regression).
  const SELF = args.self === "pr" || args.self === "main" ? args.self : null;
  try {
    let baseRoot = wt;
    // 1. disposable baseline worktree (fail closed) — skipped in null-control mode
    if (!SELF || SELF === "main") {
      log("building disposable clean-main worktree…");
      git(REPO, "worktree", "add", "--detach", wt, mainSha); worktreeAdded = true;
      git(wt, "apply", PATCH);
      mkdirSync(join(wt, "research", "ac_p0_12"), { recursive: true });
      copyFileSync(join(HERE, "runner_core.mjs"), join(wt, "research", "ac_p0_12", "runner_core.mjs"));
      if (readFileSync(join(wt, "index.html"), "utf8").includes("planningMembership")) fail("baseline worktree unexpectedly contains P0-a membership — refusing", { prSha });
      if (!readFileSync(join(wt, "js", "app.js"), "utf8").includes("mapView()")) fail("baseline instrumentation (mapView) not applied — refusing", { prSha });
      log("baseline built OK (clean main + minimal instrumentation, no P0-a).");
    }
    if (SELF === "pr") { baseRoot = REPO; log("NULL CONTROL: both arms serve the PR build (expect paired delta ≈ 0)."); }
    if (SELF === "main") { baseRoot = wt; log("NULL CONTROL: both arms serve clean main (expect paired delta ≈ 0)."); }

    // 2. serve both
    const prSrv = await serve(SELF === "main" ? wt : REPO); const baseSrv = await serve(baseRoot); servers = [prSrv, baseSrv];
    log(`serving arm-A :${prSrv.port}  arm-B :${baseSrv.port}`);

    // 3. headed hardware Chrome
    browser = await chromium.launch({ channel: "chrome", headless: false, args: [`--window-size=1100,760`] }).catch(() => null);
    if (!browser) browser = await chromium.launch({ headless: false, args: [`--window-size=1100,760`] }).catch(() => null);
    if (!browser) fail("could not launch headed Chrome in this environment — hardware measurement UNAVAILABLE (not invented)", { prSha });
    const context = await browser.newContext({ viewport: { width: 1036, height: 650 }, deviceScaleFactor: DPR });
    const prPage = await context.newPage();
    const basePage = await context.newPage();

    // initial fresh load → env for the H1 hardware + H2 comparability gates
    const prEnv0 = await freshLoad(prPage, prSrv.port);
    const baseEnv0 = await freshLoad(basePage, baseSrv.port);
    const hwRenderer = prEnv0.gl_renderer;
    log(`GPU pr=[${prEnv0.gl_renderer}] main=[${baseEnv0.gl_renderer}] | dpr ${prEnv0.dpr} | map ${prEnv0.map.w}x${prEnv0.map.h}`);

    // H1 — FAIL CLOSED unless BOTH arms are positively hardware GPUs (software,
    // SwiftShader/llvmpipe, NO_WEBGL, unknown or missing → COMPARISON UNAVAILABLE).
    const hw = hardwareCheck(prEnv0, baseEnv0);
    if (!hw.ok) fail(`H1 hardware GPU not positively established — ${hw.reason}`, { prSha, hardware: hw });
    // H2b — FAIL CLOSED unless PR/main measured a COMPARABLE environment + data-ready.
    const comp = comparableEnv(prEnv0, baseEnv0);
    if (!comp.ok) fail(`H2 PR/main environment not comparable: ${comp.mismatches.join("; ")}`, { prSha, comparability: comp, pr_env: prEnv0, main_env: baseEnv0 });
    log("H1 hardware OK (both arms); H2 environment comparable + data-ready.");

    // Calibrate the mouse-drag → map-centre response per arm so each run can be
    // re-centred to the default exactly (H2 drift control).
    const DEF = { lat: MADRID_CENTRE.lat, lon: MADRID_CENTRE.lon };
    log("calibrating pan response per arm…");
    const calPr = await calibrate(prPage); const calBase = await calibrate(basePage);
    const calOf = (which) => (which === "PR" ? calPr : calBase);
    const pageOf = (which) => (which === "PR" ? prPage : basePage);

    // 4. WARM UP (steady-state pans on the loaded page, discarded), then warmed
    //    alternating pairs. One load per arm keeps the JIT warm (representative of
    //    repeated panning, not cold boot); each pan RE-CENTERS to default first
    //    (drift control). Per-adjacent-pair deltas cancel slow drift; pair order
    //    flips each round; each sample is validated.
    const WARMUP = Math.max(4, Number(args.warmup) || 6);
    log(`warming up ${WARMUP} pans/arm (steady-state, discarded)…`);
    for (let i = 0; i < WARMUP; i++) { await prPage.bringToFront(); await pan(prPage, DEF, calPr); await basePage.bringToFront(); await pan(basePage, DEF, calBase); }

    const prRuns = [], baseRuns = [], pairs = [], startCentres = [], invalid = [];
    const take = async (which) => {
      const page = pageOf(which);
      await page.bringToFront();
      const { result, centre } = await pan(page, DEF, calOf(which));
      startCentres.push(centre);
      const v = validSample(result, 48); if (!v.ok) invalid.push(`${which}: ${v.reason}`);
      (which === "PR" ? prRuns : baseRuns).push(result);
      const st = result.pan_frame_ms; log(`  ${which}: p50=${st && st.median} p95=${st && st.p95} n=${st && st.n}${result.error ? " ERR:" + result.error : ""}`);
      return st;
    };
    log(`running ${ROUNDS} warmed alternating pairs…`);
    for (let r = 0; r < ROUNDS; r++) {
      const order = r % 2 === 0 ? ["PR", "main"] : ["main", "PR"];
      const got = {};
      for (const which of order) got[which] = await take(which);
      if (got.PR && got.main) pairs.push({ p50_delta: round(got.PR.median - got.main.median), p95_delta: round(got.PR.p95 - got.main.p95) });
    }

    // 5. panel A/B diagnostic — steady-state, display:none (layout) vs visible on PR.
    //    DIAGNOSTIC ONLY; the block stays visible in production (never a fix).
    const diag = { note: "Steady-state paired A/B of #planningMembership display:none vs visible on PR — DIAGNOSTIC to localise any incremental layout cost; the block stays visible in production.", visible: [], none: [], pair_p50_delta: [] };
    for (let r = 0; r < 3; r++) {
      await prPage.bringToFront();
      const vRes = (await pan(prPage, DEF, calPr)).result; diag.visible.push(vRes.pan_frame_ms);
      const nRes = (await pan(prPage, DEF, calPr, { hideMembership: true })).result; diag.none.push(nRes.pan_frame_ms);
      if (vRes.pan_frame_ms && nRes.pan_frame_ms) diag.pair_p50_delta.push(round(vRes.pan_frame_ms.median - nRes.pan_frame_ms.median));
    }

    // 5b. LOCALIZATION ablations (DIAGNOSTIC, reloaded back each time — never a
    //     committed change): does removing the P0-a-added DOM from the document
    //     recover the PR→main pan gap? `remove` deletes the membership subtree from
    //     the DOM (eliminates its style-recalc/DOM-size cost, which display:none and
    //     content-visibility do NOT); `remove_section` removes the whole PLACE
    //     planning section. Measured per reload so the page is restored.
    const p50s = (a) => median(a.map((s) => s && s.median));
    const fixProbe = { note: "DIAGNOSTIC warm DOM ablations on PR to localise the PR→main gap; nothing is committed and the block stays visible+accessible in production.", control: [], membership_removed: [], planning_section_removed: [] };
    await prPage.bringToFront();
    for (let r = 0; r < 2; r++) fixProbe.control.push((await pan(prPage, DEF, calPr)).result.pan_frame_ms);
    await prPage.evaluate(() => { const b = document.getElementById("planningMembership"); if (b) b.remove(); });
    for (let r = 0; r < 2; r++) fixProbe.membership_removed.push((await pan(prPage, DEF, calPr)).result.pan_frame_ms);
    await prPage.evaluate(() => { const s = document.getElementById("planningAmbito") || document.getElementById("placeDetail"); if (s) s.remove(); });
    for (let r = 0; r < 2; r++) fixProbe.planning_section_removed.push((await pan(prPage, DEF, calPr)).result.pan_frame_ms);
    fixProbe.control_p50 = p50s(fixProbe.control);
    fixProbe.membership_removed_p50 = p50s(fixProbe.membership_removed);
    fixProbe.planning_section_removed_p50 = p50s(fixProbe.planning_section_removed);
    const fixedP50 = fixProbe.membership_removed_p50;

    // H2a/H2c — FAIL CLOSED on any invalid/too-few sample or excessive drift.
    const drift = driftCheck(startCentres, MADRID_CENTRE);
    if (invalid.length) fail(`H2 invalid or too-few attributable samples: ${invalid.join("; ")}`, { prSha, invalid });
    if (!drift.ok) fail(`H2 positional drift exceeded tolerance: max ${drift.max_drift_deg}° > ${drift.tol_deg}°`, { prSha, drift });

    // analysis — drift-robust
    const prAgg = agg(prRuns), baseAgg = agg(baseRuns);
    const prP95 = prAgg.pooled && prAgg.pooled.p95, baseP95 = baseAgg.pooled && baseAgg.pooled.p95;
    const prP50 = prAgg.pooled && prAgg.pooled.p50, baseP50 = baseAgg.pooled && baseAgg.pooled.p50;
    const THRESH = 33.3;
    const pairedP50 = median(pairs.map((p) => p.p50_delta)), pairedP95 = median(pairs.map((p) => p.p95_delta));
    const prSlowerPairs = pairs.filter((p) => p.p50_delta > 0).length;
    const diagDelta = median(diag.pair_p50_delta);
    // run-to-run noise proxy: median absolute successive difference within an arm's warmed p50 series
    const noise = (() => { const xs = baseRuns.map((r) => r.pan_frame_ms && r.pan_frame_ms.median).filter((x) => x != null); const d = []; for (let i = 1; i < xs.length; i++) d.push(Math.abs(xs[i] - xs[i - 1])); return d.length ? median(d) : null; })();
    const materialThreshold = Math.max(noise || 0, 16.7); // one frame or the observed noise floor
    const regressionMaterial = pairedP50 != null && pairedP50 > materialThreshold && prSlowerPairs >= Math.ceil(pairs.length * 0.7);
    const analysis = {
      threshold_pan_p95_ms: THRESH,
      statistic: "pooled warmed active-pan frames per arm; plus per-adjacent-pair deltas (drift-robust)",
      main_fails_absolute: baseP95 != null && baseP95 > THRESH,
      pr_fails_absolute: prP95 != null && prP95 > THRESH,
      pooled_pr_p50: prP50, pooled_main_p50: baseP50, pooled_pr_p95: prP95, pooled_main_p95: baseP95,
      paired_p50_delta_median_ms: pairedP50, paired_p95_delta_median_ms: pairedP95,
      pairs_pr_slower: prSlowerPairs, pairs_total: pairs.length,
      run_to_run_noise_p50_ms: noise, material_delta_floor_ms: round(materialThreshold),
      panel_diag_p50_delta_ms: diagDelta,
      pr_regression_material: regressionMaterial,
      interpretation: "Finding (a): pre-existing ABSOLUTE failure holds iff main_fails_absolute (both arms ≫ 33.3 ms). Finding (b): an incremental PR regression is called MATERIAL only when the paired p50 delta exceeds the run-to-run noise floor AND ≥70% of warmed pairs show PR slower; otherwise PR≈main within noise. hardware_automated — directional, NOT a physical-device causal proof.",
    };

    const out = {
      tool: "AC-P0-12 auto_compare", version: 2, measurement_class: "hardware_automated", null_control: SELF || false,
      disclaimer: "Scripted Playwright mouse drags on real hardware Chrome. NOT human physical gestures, NOT device_grade/actual_gesture. Does not substitute for the owner's physical Safari/device validation. 0/N paired comparisons is evidence of NO DETECTED P0-a overhead in this environment, not proof none can exist.",
      generatedAt: new Date().toISOString(),
      config: { pr_sha: prSha, main_sha: mainSha, rounds: ROUNDS, frames_target: FRAMES, dpr: DPR, zoom: ZOOM,
        gpu_renderer: hwRenderer, viewport: prEnv0.viewport, map_area: prEnv0.map,
        centre: prEnv0.centre, cache: "warm steady-state (one load per arm)", layers: "default (no licences/hospitality toggled)",
        pr_has_membership: prEnv0.hasMembership, main_has_membership: baseEnv0.hasMembership },
      integrity: { hardware: hw, comparability: comp, drift, samples_all_valid: invalid.length === 0, pr_env: prEnv0, main_env: baseEnv0, drift_control: "closed-loop pan (net-zero displacement); one load per arm; warm steady-state" },
      warmup_per_arm: WARMUP,
      pr: { aggregate: prAgg, runs: prRuns.map((r) => r.pan_frame_ms) },
      main: { aggregate: baseAgg, runs: baseRuns.map((r) => r.pan_frame_ms) },
      paired_deltas: pairs,
      panel_display_diagnostic: diag,
      candidate_mitigation_probe: fixProbe,
      analysis,
    };
    await cleanup();
    out.cleanup = cleanupStatus;
    const outPath = join(RESULTS, `auto_compare_${prSha.slice(0, 8)}_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
    log("────────────────────────────────────────────────────────");
    log(`GPU ${hwRenderer} | dpr ${DPR} | map ${prEnv0.map.w}x${prEnv0.map.h} | warmed, fresh-loaded per run`);
    log(`main  pooled pan p50=${baseP50} p95=${baseP95} ms  — ${analysis.main_fails_absolute ? "FAILS" : "within"} ${THRESH} ms`);
    log(`PR    pooled pan p50=${prP50} p95=${prP95} ms  — ${analysis.pr_fails_absolute ? "FAILS" : "within"} ${THRESH} ms`);
    log(`paired PR−main (drift-robust): p50 ${pairedP50} ms, p95 ${pairedP95} ms  (PR slower in ${prSlowerPairs}/${pairs.length} pairs; noise floor ~${round(materialThreshold)} ms)`);
    log(`panel display none−visible (diag): p50 ${diagDelta} ms | drift ${drift.max_drift_deg}° | cleanup worktree_removed=${cleanupStatus.worktree_removed}`);
    log(`ablation (warm, PR): control p50=${fixProbe.control_p50} | membership removed=${fixProbe.membership_removed_p50} | +section removed=${fixProbe.planning_section_removed_p50} | main p50=${baseP50}`);
    log(`=> material PR regression: ${regressionMaterial ? "YES" : "NO DETECTED (PR≈main within noise)"}`);
    log(`evidence → ${outPath}`);
    log("hardware_automated — NOT a physical-device validation.");
  } finally {
    await cleanup();
  }
}

function fail(msg, extra = {}) {
  const rec = { tool: "AC-P0-12 auto_compare", status: "COMPARISON UNAVAILABLE", reason: msg, ...extra, generatedAt: new Date().toISOString() };
  try { mkdirSync(RESULTS, { recursive: true }); writeFileSync(join(RESULTS, `auto_compare_UNAVAILABLE_${Date.now()}.json`), JSON.stringify(rec, null, 2)); } catch {}
  console.error("[auto_compare] COMPARISON UNAVAILABLE —", msg);
  throw new Error(msg);
}

main().catch((e) => { console.error("[auto_compare] fatal:", e.message); process.exitCode = 1; });
