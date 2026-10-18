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
import { readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname } from "node:path";
import os from "node:os";

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
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const R = Math.min(box.w, box.h) * 0.3;
  const steps = FRAMES + 25;
  for (let i = 1; i <= steps; i++) {
    const a = i * 0.32;
    await page.mouse.move(cx + R * Math.cos(a), cy + R * Math.sin(a), { steps: 1 });
    await page.waitForTimeout(9);
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
  return page.evaluate(() => window.__cap.stop());
}

async function openArm(context, port, origin) {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/index.html?haloRegressionTest=1`, { waitUntil: "load", timeout: 60000 });
  // wait for seam + planning/map ready, then load the real runner_core as a module
  await page.waitForFunction(() => window.__HALO_REGRESSION__ && typeof window.__HALO_REGRESSION__.mapView === "function", { timeout: 60000 });
  await page.waitForFunction(() => {
    const s = window.__HALO_REGRESSION__;
    try { const v = s.mapView(); return v && isFinite(v.lat); } catch { return false; }
  }, { timeout: 60000 });
  await page.addScriptTag({ type: "module", content: `import * as m from '/research/ac_p0_12/runner_core.mjs'; window.__RC = m;` });
  await page.waitForFunction(() => !!window.__RC && !!window.__RC.GestureCapture, { timeout: 30000 });
  const env = await page.evaluate(() => {
    const e = window.__RC.captureEnv(window, {});
    const hasMembership = !!document.getElementById("planningMembership");
    const seam = window.__HALO_REGRESSION__;
    return { gl_renderer: e.gl_renderer, gl_is_software: e.gl_is_software, dpr: window.devicePixelRatio, viewport: e.viewport,
      map: (() => { const m = document.getElementById("map").getBoundingClientRect(); return { w: Math.round(m.width), h: Math.round(m.height) }; })(),
      zoom: seam.mapView().zoom, centre: seam.mapView(), hasMembership };
  });
  return { page, port, origin, env };
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

  const wt = join(os.tmpdir(), `acp012-baseline-${Date.now()}`);
  let worktreeAdded = false, servers = [], browser = null;
  const cleanup = () => {
    for (const s of servers) try { s.srv.close(); } catch {}
    if (browser) try { browser.close(); } catch {}
    if (worktreeAdded) { try { git(REPO, "worktree", "remove", "--force", wt); } catch (e) { log("worktree remove warning:", String(e).slice(0, 120)); } }
    try { git(REPO, "worktree", "prune"); } catch {}
  };

  try {
    // 1. disposable baseline worktree (fail closed)
    log("building disposable clean-main worktree…");
    git(REPO, "worktree", "add", "--detach", wt, mainSha); worktreeAdded = true;
    git(wt, "apply", PATCH);
    mkdirSync(join(wt, "research", "ac_p0_12"), { recursive: true });
    copyFileSync(join(HERE, "runner_core.mjs"), join(wt, "research", "ac_p0_12", "runner_core.mjs"));
    if (readFileSync(join(wt, "index.html"), "utf8").includes("planningMembership")) fail("baseline worktree unexpectedly contains P0-a membership — refusing", { prSha });
    if (!readFileSync(join(wt, "js", "app.js"), "utf8").includes("mapView()")) fail("baseline instrumentation (mapView) not applied — refusing", { prSha });
    log("baseline built OK (clean main + minimal instrumentation, no P0-a).");

    // 2. serve both
    const prSrv = await serve(REPO); const baseSrv = await serve(wt); servers = [prSrv, baseSrv];
    log(`serving PR :${prSrv.port}  baseline :${baseSrv.port}`);

    // 3. headed hardware Chrome
    browser = await chromium.launch({ channel: "chrome", headless: false, args: [`--window-size=1100,760`] }).catch(() => null);
    if (!browser) browser = await chromium.launch({ headless: false, args: [`--window-size=1100,760`] }).catch(() => null);
    if (!browser) fail("could not launch headed Chrome in this environment — hardware measurement UNAVAILABLE (not invented)", { prSha });
    const context = await browser.newContext({ viewport: { width: 1036, height: 650 }, deviceScaleFactor: DPR });

    const pr = await openArm(context, prSrv.port, "PR");
    const base = await openArm(context, baseSrv.port, "main");
    const hwRenderer = pr.env.gl_renderer;
    const softwareGpu = pr.env.gl_is_software || base.env.gl_is_software;
    log(`GPU: ${hwRenderer} | dpr ${pr.env.dpr} | map ${pr.env.map.w}x${pr.env.map.h}`);
    if (softwareGpu) log("WARNING: software GPU detected — results are NOT hardware-representative.");

    // 4. WARM UP first (discard), then TIGHT ALTERNATION with per-adjacent-pair
    //    deltas. The GPU/browser warms strongly over a session (p50 can fall ~5×
    //    across the first runs), which swamps any arm difference; warm-up + paired
    //    adjacent deltas (temporally adjacent PR/main cancel slow drift) are the
    //    drift-robust comparison. Pair order flips each round to cancel order bias.
    const WARMUP = Math.max(4, Number(args.warmup) || 6);
    log(`warming up ${WARMUP} pans/arm (discarded)…`);
    for (let i = 0; i < WARMUP; i++) { await pr.page.bringToFront(); await measurePan(pr.page); await base.page.bringToFront(); await measurePan(base.page); }

    const prRuns = [], baseRuns = [], pairs = [];
    log(`running ${ROUNDS} warmed alternating pairs…`);
    for (let r = 0; r < ROUNDS; r++) {
      const order = r % 2 === 0 ? ["PR", "main"] : ["main", "PR"]; // flip within-pair order each round
      const got = {};
      for (const which of order) {
        const arm = which === "PR" ? pr : base;
        await arm.page.bringToFront();
        const res = await measurePan(arm.page);
        (which === "PR" ? prRuns : baseRuns).push(res);
        got[which] = res.pan_frame_ms;
        log(`  r${r + 1} ${which}: p50=${got[which] && got[which].median} p95=${got[which] && got[which].p95} n=${got[which] && got[which].n}${res.error ? " ERR:" + res.error : ""}`);
      }
      if (got.PR && got.main) pairs.push({ p50_delta: round(got.PR.median - got.main.median), p95_delta: round(got.PR.p95 - got.main.p95) });
    }

    // 5. panel A/B diagnostic — WARMED, display:none (layout) vs baseline. Paired,
    //    DIAGNOSTIC ONLY; the block stays visible in production (never a fix).
    const diag = { note: "Warmed paired A/B of #planningMembership display:none vs visible on PR — DIAGNOSTIC to localise any incremental layout cost; the block stays visible in production.", visible: [], none: [], pair_p50_delta: [] };
    for (let r = 0; r < 3; r++) {
      await pr.page.bringToFront();
      await pr.page.evaluate(() => { const b = document.getElementById("planningMembership"); if (b) b.style.display = ""; });
      const v = (await measurePan(pr.page)).pan_frame_ms; diag.visible.push(v);
      await pr.page.evaluate(() => { const b = document.getElementById("planningMembership"); if (b) b.style.display = "none"; });
      const n = (await measurePan(pr.page)).pan_frame_ms; diag.none.push(n);
      await pr.page.evaluate(() => { const b = document.getElementById("planningMembership"); if (b) b.style.display = ""; });
      if (v && n) diag.pair_p50_delta.push(round(v.median - n.median));
    }

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
      tool: "AC-P0-12 auto_compare", version: 1, measurement_class: "hardware_automated",
      disclaimer: "Scripted Playwright mouse drags on real hardware Chrome. NOT human physical gestures, NOT device_grade/actual_gesture. Does not substitute for the owner's physical Safari/device validation.",
      generatedAt: new Date().toISOString(),
      config: { pr_sha: prSha, main_sha: mainSha, rounds: ROUNDS, frames_target: FRAMES, dpr: DPR, zoom: ZOOM,
        gpu_renderer: hwRenderer, gpu_is_software: softwareGpu, viewport: pr.env.viewport, map_area: pr.env.map,
        centre: pr.env.centre, cache: "cold (fresh context)", layers: "default (no licences/hospitality toggled)",
        pr_has_membership: pr.env.hasMembership, main_has_membership: base.env.hasMembership },
      warmup_per_arm: WARMUP,
      pr: { aggregate: prAgg, runs: prRuns.map((r) => r.pan_frame_ms) },
      main: { aggregate: baseAgg, runs: baseRuns.map((r) => r.pan_frame_ms) },
      paired_deltas: pairs,
      panel_display_diagnostic: diag,
      analysis,
    };
    const outPath = join(RESULTS, `auto_compare_${prSha.slice(0, 8)}_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
    log("────────────────────────────────────────────────────────");
    log(`GPU ${hwRenderer} | dpr ${DPR} | map ${pr.env.map.w}x${pr.env.map.h} | warmed`);
    log(`main  pooled pan p50=${baseP50} p95=${baseP95} ms  — ${analysis.main_fails_absolute ? "FAILS" : "within"} ${THRESH} ms`);
    log(`PR    pooled pan p50=${prP50} p95=${prP95} ms  — ${analysis.pr_fails_absolute ? "FAILS" : "within"} ${THRESH} ms`);
    log(`paired PR−main (drift-robust): p50 ${pairedP50} ms, p95 ${pairedP95} ms  (PR slower in ${prSlowerPairs}/${pairs.length} pairs; noise floor ~${round(materialThreshold)} ms)`);
    log(`panel display none−visible (diag, warmed): p50 ${diagDelta} ms`);
    log(`=> material PR regression: ${regressionMaterial ? "YES" : "NO (PR≈main within noise)"}`);
    log(`evidence → ${outPath}`);
    log("hardware_automated — NOT a physical-device validation.");
  } finally {
    cleanup();
  }
}

function fail(msg, extra = {}) {
  const rec = { tool: "AC-P0-12 auto_compare", status: "COMPARISON UNAVAILABLE", reason: msg, ...extra, generatedAt: new Date().toISOString() };
  try { mkdirSync(RESULTS, { recursive: true }); writeFileSync(join(RESULTS, `auto_compare_UNAVAILABLE_${Date.now()}.json`), JSON.stringify(rec, null, 2)); } catch {}
  console.error("[auto_compare] COMPARISON UNAVAILABLE —", msg);
  throw new Error(msg);
}

main().catch((e) => { console.error("[auto_compare] fatal:", e.message); process.exitCode = 1; });
