// K12 iPad one-page benchmark controller — executable regression for the PURE
// CORE (research/runtime_spike/device_harness/mobile_controller_core.mjs) and the
// shared scenario matrix (suite.mjs). Run by CI via `node --test`.
//
// Covers: matrix integrity, session/dispatch, resume, incomplete pairs, fail-closed
// errors/timeouts, measurement integrity (reject sparse/fabricated stats),
// observed-environment parsing + iPad-Safari consistency, device-grade that is
// attestation-required-but-not-sufficient, whole-run provenance blockers, export
// shape + correctness (incl. the real Windows run and the real Windows/Claude-Chrome
// controller smoke as a NEGATIVE example that must be is_device_grade:false).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSuite, SUITES, scenarioId } from "../research/runtime_spike/device_harness/suite.mjs";
import {
  STORAGE, MAX_ATTEMPTS, MIN_SAMPLES, createSession, nextPending, runningIndex, markDispatched,
  applyHandoff, reconcileOnResume, progress, isFinished, buildConsolidated,
  buildScenarioUrl, ipadDeviceGradeOf, observedEnvironment, ipadConsistency,
  recomputeStats, statOk, controllerScenarioComplete,
} from "../research/runtime_spike/device_harness/mobile_controller_core.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const WIN_CLAUDE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Claude/2.37 Chrome/152.0.0.0 Safari/537.36 MSIX";
const ANGLE_INTEL = "ANGLE (Intel, Intel(R) UHD Graphics 620, Direct3D11)";

// A full, internally-consistent stats object (as rum.js stats() emits). Summaries
// are derived from `raw` with the same algorithm, so statOk accepts it.
function mkStat(center, n = 40) {
  const raw = [];
  for (let i = 0; i < n; i++) raw.push(Math.round((center + (i % 5) * 0.3) * 100) / 100);
  return { ...recomputeStats(raw), raw };
}

// A COMPLETE measurement with full sample distributions and a real device env
// (default: a real iPad Safari / Apple GPU environment).
function completeResult(scenario, { gl = "Apple GPU", ua = IPAD_UA, itp = 40, pan = 20 } = {}) {
  return {
    spike: "K12 runtime decision",
    scenario,
    renderer: "leaflet",
    env: {
      device_label: "iPad-Air / iPadOS / Safari",
      userAgent: ua,
      viewport: { w: 1180, h: 820, dpr: 2 },
      gl_renderer: gl,
      gl_is_software: /swiftshader|software|llvmpipe/i.test(gl),
      is_device_grade: true,
    },
    first_contentful_paint_ms: 300,
    readiness_barrier: "leaflet: ...",
    interaction_to_paint_ms: mkStat(itp),
    pan_frame_ms: mkStat(pan),
  };
}

const attestedMeta = { device_label: "iPad-Air / iPadOS / Safari", attested: true };

// ── matrix integrity (shared source of truth) ───────────────────────────────

test("full suite is 38 scenarios across 19 comparative pairs, both engines each", () => {
  const full = buildSuite("full");
  assert.equal(full.length, 38);
  const pairs = new Map();
  for (const s of full) {
    assert.equal(s.comparative, true);
    pairs.set(s.pairKey, (pairs.get(s.pairKey) || new Set()).add(s.engine));
  }
  assert.equal(pairs.size, 19);
  for (const [, engines] of pairs) assert.ok(engines.has("leaflet") && engines.has("maplibre"));
});

test("smoke suite is a strict subset shape (6 scenarios)", () => {
  assert.equal(buildSuite("smoke").length, 6);
  assert.equal(SUITES.smoke.length, 6);
});

test("unknown suite throws", () => assert.throws(() => buildSuite("nope")));

test("scenarioId matches the run_device completeness string form", () => {
  const s = buildSuite("full").find((x) => x.pairKey === "ceil|polygon|10000" && x.engine === "leaflet");
  assert.equal(scenarioId(s), "leaflet:leaflet_ceiling.html?kind=polygon&count=10000");
});

// ── session + dispatch ───────────────────────────────────────────────────────

test("createSession starts every scenario pending and captures attestation meta", () => {
  const s = createSession({ suite: "full", meta: attestedMeta });
  assert.equal(s.scenarios.length, 38);
  assert.ok(s.scenarios.every((x) => x.status === "pending" && x.attempts === 0 && x.result === null));
  assert.equal(s.meta.attested, true);
  assert.ok(s.meta.attested_at);
  assert.equal(s.measurement, "ipad_controller_run");
});

test("attested=false is recorded as not attested (never silently true)", () => {
  const s = createSession({ suite: "smoke", meta: { device_label: "x" } });
  assert.equal(s.meta.attested, false);
  assert.equal(s.meta.attested_at, null);
});

test("markDispatched flips to running and counts the attempt; nextPending advances", () => {
  const s = createSession({ suite: "smoke", meta: attestedMeta });
  assert.equal(nextPending(s), 0);
  markDispatched(s, 0);
  assert.equal(s.scenarios[0].status, "running");
  assert.equal(s.scenarios[0].attempts, 1);
  assert.equal(runningIndex(s), 0);
  assert.equal(nextPending(s), 1);
});

// ── handoff folding ──────────────────────────────────────────────────────────

test("applyHandoff with a complete, full-stat result marks the scenario complete", () => {
  const s = createSession({ suite: "smoke", meta: attestedMeta });
  markDispatched(s, 0);
  applyHandoff(s, { idx: 0, id: s.scenarios[0].id, result: completeResult(s.scenarios[0].id) });
  assert.equal(s.scenarios[0].status, "complete");
  assert.ok(Array.isArray(s.scenarios[0].result.interaction_to_paint_ms.raw));
});

test("applyHandoff fails closed on an error (watchdog timeout) — incomplete", () => {
  const s = createSession({ suite: "smoke", meta: attestedMeta });
  markDispatched(s, 0);
  applyHandoff(s, { idx: 0, id: s.scenarios[0].id, error: "controller watchdog timeout (150000 ms) — scenario did not complete" });
  assert.equal(s.scenarios[0].status, "incomplete");
  assert.match(s.scenarios[0].error, /watchdog timeout/);
  assert.equal(s.scenarios[0].result, null);
});

test("applyHandoff REJECTS a sparse/fabricated envelope (only a p95) — incomplete, raw retained", () => {
  const s = createSession({ suite: "smoke", meta: attestedMeta });
  markDispatched(s, 0);
  const sparse = {
    env: completeResult("x").env, first_contentful_paint_ms: 300, readiness_barrier: "leaflet: ...",
    interaction_to_paint_ms: { p95: 42.1 }, pan_frame_ms: { p95: 88.3 },
  };
  applyHandoff(s, { idx: 0, id: s.scenarios[0].id, result: sparse });
  assert.equal(s.scenarios[0].status, "incomplete");
  assert.match(s.scenarios[0].error, /raw samples|sparse/);
  assert.ok(s.scenarios[0].result, "raw result retained for audit, not discarded");
});

test("applyHandoff fails closed on a result missing required metrics", () => {
  const s = createSession({ suite: "smoke", meta: attestedMeta });
  markDispatched(s, 0);
  const bad = completeResult(s.scenarios[0].id);
  delete bad.pan_frame_ms;
  applyHandoff(s, { idx: 0, id: s.scenarios[0].id, result: bad });
  assert.equal(s.scenarios[0].status, "incomplete");
});

test("applyHandoff ignores a stale envelope whose id does not match the queue slot", () => {
  const s = createSession({ suite: "smoke", meta: attestedMeta });
  markDispatched(s, 0);
  applyHandoff(s, { idx: 0, id: "some:other.html?x=1", result: completeResult("x") });
  assert.equal(s.scenarios[0].status, "running");
});

// ── measurement integrity ─────────────────────────────────────────────────────

test("statOk accepts a full consistent stat and rejects sparse/mismatched/short ones", () => {
  assert.equal(statOk(mkStat(40)).ok, true);
  assert.equal(statOk({ p95: 42.1 }).ok, false); // sparse
  assert.equal(statOk({ n: 3, raw: [1, 2, 3], min: 1, median: 2, p95: 3, max: 3, mean: 2 }).ok, false); // n < MIN_SAMPLES
  const good = mkStat(40);
  assert.equal(statOk({ ...good, p95: good.p95 + 5 }).ok, false); // summary inconsistent with raw
  assert.equal(statOk({ ...good, raw: good.raw.slice(0, good.n - 1) }).ok, false); // n/raw mismatch
});

test("controllerScenarioComplete requires full stats AND a numeric FCP (null FCP stays incomplete, not fabricated)", () => {
  const r = completeResult("x");
  assert.equal(controllerScenarioComplete(r).ok, true);
  assert.equal(controllerScenarioComplete({ ...r, first_contentful_paint_ms: null }).ok, false);
  assert.equal(controllerScenarioComplete({ ...r, interaction_to_paint_ms: { p95: 1 } }).ok, false);
});

test("MIN_SAMPLES floor is enforced", () => {
  assert.equal(statOk(mkStat(40, MIN_SAMPLES)).ok, true);
  assert.equal(statOk(mkStat(40, MIN_SAMPLES - 1)).ok, false);
});

// ── observed-environment parsing ───────────────────────────────────────────────

test("observedEnvironment classifies platform/browser/GPU", () => {
  const ip = observedEnvironment({ userAgent: IPAD_UA, gl_renderer: "Apple GPU" });
  assert.deepEqual([ip.platform, ip.browser, ip.gpu_family], ["ios_ipados", "safari", "apple"]);
  const win = observedEnvironment({ userAgent: WIN_CLAUDE_UA, gl_renderer: ANGLE_INTEL });
  assert.equal(win.platform, "windows");
  assert.equal(win.browser, "claude");
  assert.equal(win.is_chromium, true);
  assert.equal(win.gpu_family, "intel");
  assert.equal(win.angle_non_apple, true);
});

test("ipadConsistency accepts iPadOS desktop-mode (Macintosh UA + Safari + Apple GPU) — no literal 'iPad' required", () => {
  const c = ipadConsistency({ userAgent: IPAD_DESKTOP_UA, gl_renderer: "Apple GPU" });
  assert.equal(c.ok, true, c.blockers.join("; "));
});

test("ipadConsistency rejects Windows, Android, Linux, Chromium and non-Apple GPUs", () => {
  assert.equal(ipadConsistency({ userAgent: WIN_CLAUDE_UA, gl_renderer: ANGLE_INTEL }).ok, false);
  assert.equal(ipadConsistency({ userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537", gl_renderer: "Adreno (TM) 740" }).ok, false);
  assert.equal(ipadConsistency({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537", gl_renderer: "Mesa Intel" }).ok, false);
  // Chrome on a Mac with an Apple GPU is still not Safari
  assert.equal(ipadConsistency({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537", gl_renderer: "Apple GPU" }).ok, false);
});

// ── device-grade: attestation required but NOT sufficient ──────────────────────

test("ipadDeviceGradeOf: Apple GPU + iPad Safari + label + attestation → device-grade", () => {
  assert.equal(ipadDeviceGradeOf(completeResult("x"), { label: "iPad-Air", attested: true }).device_grade, true);
});

test("ipadDeviceGradeOf fails closed WITHOUT attestation even on a real iPad", () => {
  const r = ipadDeviceGradeOf(completeResult("x"), { label: "iPad-Air", attested: false });
  assert.equal(r.device_grade, false);
  assert.equal(r.basis.physically_attested, false);
});

test("ipadDeviceGradeOf fails closed when attestation CONTRADICTS the environment (Windows/Chrome/Intel)", () => {
  const r = ipadDeviceGradeOf(completeResult("x", { gl: ANGLE_INTEL, ua: WIN_CLAUDE_UA }), { label: "pretend iPad", attested: true });
  assert.equal(r.device_grade, false, "attestation must not override an impossible environment");
  assert.equal(r.basis.environment_consistent_with_ipad_safari, false);
  assert.ok(r.basis.blockers.length > 0);
});

test("ipadDeviceGradeOf fails closed on a software renderer and on a missing label", () => {
  assert.equal(ipadDeviceGradeOf(completeResult("x"), { label: "", attested: true }).device_grade, false);
  const soft = completeResult("x", { gl: "SwiftShader" });
  soft.env.gl_is_software = true;
  assert.equal(ipadDeviceGradeOf(soft, { label: "iPad", attested: true }).device_grade, false);
});

// ── resume after interruption ──────────────────────────────────────────────────

test("reconcileOnResume retries a hard-interrupted scenario once, then marks it incomplete", () => {
  const s = createSession({ suite: "smoke", meta: attestedMeta });
  markDispatched(s, 0);
  reconcileOnResume(s);
  assert.equal(s.scenarios[0].status, "pending");
  markDispatched(s, 0);
  reconcileOnResume(s);
  assert.equal(s.scenarios[0].status, "incomplete");
  assert.equal(s.scenarios[0].attempts, MAX_ATTEMPTS);
});

test("an unresponsive scenario never destroys previously completed measurements", () => {
  const s = createSession({ suite: "smoke", meta: attestedMeta });
  markDispatched(s, 0);
  applyHandoff(s, { idx: 0, id: s.scenarios[0].id, result: completeResult(s.scenarios[0].id) });
  markDispatched(s, 1);
  applyHandoff(s, { idx: 1, id: s.scenarios[1].id, error: "controller watchdog timeout (150000 ms) — scenario did not complete" });
  reconcileOnResume(s);
  assert.equal(s.scenarios[0].status, "complete");
  assert.ok(s.scenarios[0].result.pan_frame_ms.raw);
  assert.equal(s.scenarios[1].status, "incomplete");
});

test("progress and isFinished track terminal states", () => {
  const s = createSession({ suite: "smoke", meta: attestedMeta });
  for (let i = 0; i < s.scenarios.length; i++) {
    markDispatched(s, i);
    applyHandoff(s, { idx: i, id: s.scenarios[i].id, result: completeResult(s.scenarios[i].id) });
  }
  assert.equal(progress(s).complete, s.scenarios.length);
  assert.equal(isFinished(s), true);
});

// ── export correctness ────────────────────────────────────────────────────────

function fillAll(session, mut = () => null) {
  for (let i = 0; i < session.scenarios.length; i++) {
    const sc = session.scenarios[i];
    markDispatched(session, i);
    const special = mut(sc, i);
    if (special) applyHandoff(session, { idx: i, id: sc.id, ...special });
    else applyHandoff(session, { idx: i, id: sc.id, result: completeResult(sc.id) });
  }
  return session;
}

test("buildConsolidated: a complete, attested, iPad-consistent run is a DEVICE_VALIDATION", () => {
  const out = buildConsolidated(fillAll(createSession({ suite: "full", meta: attestedMeta })));
  assert.equal(out.complete, true);
  assert.equal(out.comparable, true);
  assert.equal(out.is_device_grade, true);
  assert.equal(out.run_kind, "DEVICE_VALIDATION");
  assert.equal(out.provenance.consistent, true);
  assert.equal(out.attestation.environment_consistent_with_claim, true);
});

test("buildConsolidated never hardcodes a 'safari' channel; launch reports observed env", () => {
  const out = buildConsolidated(fillAll(createSession({ suite: "full", meta: attestedMeta })));
  assert.equal(JSON.stringify(out.launch).includes('"channel":"safari"'), false);
  assert.equal(out.launch.observed_browser, "safari"); // observed, because this env IS iPad Safari
  assert.equal(out.launch.observed_platform, "ios_ipados");
  assert.equal(out.launch.intended_route, "ipad_safari_one_page_controller");
});

test("buildConsolidated: one failed Leaflet cell → NOT complete, NOT comparable, pair flagged, nothing dropped", () => {
  const out = buildConsolidated(
    fillAll(createSession({ suite: "full", meta: attestedMeta }), (sc) =>
      sc.pairKey === "ceil|polygon|10000" && sc.engine === "leaflet"
        ? { error: "controller watchdog timeout (150000 ms) — scenario did not complete" }
        : null),
  );
  assert.equal(out.complete, false);
  assert.equal(out.comparable, false);
  assert.equal(out.results.length, 38);
  assert.equal(out.obtained_scenarios, 37);
  const pair = out.comparability.find((p) => p.pairKey === "ceil|polygon|10000");
  assert.deepEqual([pair.leaflet, pair.maplibre, pair.comparable], [false, true, false]);
  assert.equal(out.comparability.filter((p) => p.comparable).length, 18);
});

test("buildConsolidated flags whole-run provenance disagreement across scenarios", () => {
  const out = buildConsolidated(
    fillAll(createSession({ suite: "full", meta: attestedMeta }), (sc, i) =>
      i === 0 ? { result: completeResult(sc.id, { gl: ANGLE_INTEL, ua: WIN_CLAUDE_UA }) } : null),
  );
  assert.equal(out.provenance.consistent, false);
  assert.equal(out.is_device_grade, false);
  assert.ok(out.provenance.blockers.some((b) => /disagree/.test(b)));
});

test("buildConsolidated is not device-grade when attestation is absent (even if all complete)", () => {
  const s = createSession({ suite: "full", meta: { device_label: "iPad", attested: false } });
  const out = buildConsolidated(fillAll(s));
  assert.equal(out.complete, true);
  assert.equal(out.is_device_grade, false);
  assert.notEqual(out.run_kind, "DEVICE_VALIDATION");
});

// ── export correctness against the REAL preserved Windows observation ─────────

test("buildConsolidated reproduces the real Windows run's completeness & comparability verdict", () => {
  const file = path.resolve(HERE, "../research/runtime_spike/results/windows/K12_Windows_Prueba1.json");
  const win = JSON.parse(fs.readFileSync(file, "utf8"));
  const byKeyEngine = new Map();
  for (const r of win.results) byKeyEngine.set(`${r.pairKey}|${r.renderer || r.engine}`, r);
  const s = createSession({ suite: "full", meta: attestedMeta });
  for (let i = 0; i < s.scenarios.length; i++) {
    const sc = s.scenarios[i];
    const r = byKeyEngine.get(`${sc.pairKey}|${sc.engine}`);
    markDispatched(s, i);
    if (r && !r.error) applyHandoff(s, { idx: i, id: sc.id, result: r });
    else applyHandoff(s, { idx: i, id: sc.id, error: r?.error || "missing in source" });
  }
  const out = buildConsolidated(s);
  assert.equal(out.complete, win.complete);
  assert.equal(out.comparable, win.comparable);
  assert.equal(out.obtained_scenarios, win.obtained_scenarios);
  const mineByPair = new Map(out.comparability.map((p) => [p.pairKey, p.comparable]));
  for (const p of win.comparability) assert.equal(mineByPair.get(p.pairKey), p.comparable);
});

// ── NEGATIVE example: the real Windows / Claude-Chrome controller smoke ───────
// This file was exported by the buggy controller and reports is_device_grade:true
// on a Windows/Claude/Intel environment. The fixed core must refuse to certify it.

test("the built-in-browser controller smoke is REFUSED device-grade and its sparse cell rejected", () => {
  const file = path.resolve(
    HERE, "../research/runtime_spike/results/controller_smoke_builtin_browser_NEGATIVE/K12_iPad_Built-in-browser_smoke_Chrome_2026-10-16.json",
  );
  const neg = JSON.parse(fs.readFileSync(file, "utf8"));
  // the file itself carries the bug we are fixing (preserved as evidence)
  assert.equal(neg.is_device_grade, true, "fixture preserves the original (wrong) verdict");
  assert.equal(neg.obtained_scenarios, 30, "fixture preserves the original 30/38 status");

  // rebuild through the FIXED core
  const byKeyEngine = new Map();
  for (const r of neg.results) byKeyEngine.set(`${r.pairKey}|${r.renderer || r.engine}`, r);
  const s = createSession({ suite: "full", meta: { device_label: neg.device_label, attested: true, userAgent: neg.verified_config.userAgent } });
  for (let i = 0; i < s.scenarios.length; i++) {
    const sc = s.scenarios[i];
    const r = byKeyEngine.get(`${sc.pairKey}|${sc.engine}`);
    markDispatched(s, i);
    if (r && !r.error) applyHandoff(s, { idx: i, id: sc.id, result: r });
    else applyHandoff(s, { idx: i, id: sc.id, error: r?.error || "missing in source" });
  }
  const out = buildConsolidated(s);

  assert.equal(out.is_device_grade, false, "MUST be false: Windows/Claude/Intel is not iPad Safari");
  assert.notEqual(out.run_kind, "DEVICE_VALIDATION");
  assert.equal(out.provenance.consistent, false);
  assert.ok(out.provenance.blockers.some((b) => /windows/i.test(b)));
  assert.ok(out.provenance.blockers.some((b) => /chromium|claude/i.test(b)));
  assert.ok(out.provenance.blockers.some((b) => /apple gpu/i.test(b)));
  assert.equal(JSON.stringify(out.launch).includes('"channel":"safari"'), false);

  // the synthetic sparse scenario 0 is rejected; the 29 real measurements retained
  assert.equal(out.completeness[0].complete, false);
  assert.match(out.completeness[0].reason, /raw samples|sparse/);
  assert.equal(out.results.length, 38, "nothing invented");
  const withRaw = out.results.filter((r) => r.interaction_to_paint_ms && Array.isArray(r.interaction_to_paint_ms.raw)).length;
  assert.equal(withRaw, 29, "all 29 real measurements retained");
});

// ── POSITIVE example: the real iPad M3 Safari device validation ───────────────
// The first complete physical iPad run must pass the hardened validator: every
// stat recomputes from its raw samples, and the verdict re-derives as a
// DEVICE_VALIDATION (Apple GPU + Safari + attestation + consistent environment).

test("the real iPad M3 Safari run is a verified DEVICE_VALIDATION with consistent stats", () => {
  const file = path.resolve(HERE, "../research/runtime_spike/results/ipad/K12_iPad_M3_Safari_2026-10-17.json");
  const ipad = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(ipad.run_kind, "DEVICE_VALIDATION");

  // every stat object is internally consistent (no sparse/fabricated metric)
  let checked = 0;
  for (const r of ipad.results) {
    for (const k of ["interaction_to_paint_ms", "pan_frame_ms", "interaction_recompute_ms"]) {
      const st = r[k];
      if (st && Array.isArray(st.raw)) {
        checked++;
        assert.equal(statOk(st).ok, true, `${r.scenario} ${k}: ${statOk(st).why}`);
      }
    }
  }
  assert.ok(checked >= 76, `expected many stat objects, got ${checked}`);

  // re-derive the verdict through the fixed core
  const byKeyEngine = new Map();
  for (const r of ipad.results) byKeyEngine.set(`${r.pairKey}|${r.renderer || r.engine}`, r);
  const s = createSession({ suite: "full", meta: { device_label: ipad.device_label, attested: true, userAgent: ipad.verified_config.userAgent } });
  for (let i = 0; i < s.scenarios.length; i++) {
    const sc = s.scenarios[i];
    const r = byKeyEngine.get(`${sc.pairKey}|${sc.engine}`);
    markDispatched(s, i);
    if (r && !r.error) applyHandoff(s, { idx: i, id: sc.id, result: r });
    else applyHandoff(s, { idx: i, id: sc.id, error: "missing" });
  }
  const out = buildConsolidated(s);
  assert.equal(out.complete, true);
  assert.equal(out.comparable, true);
  assert.equal(out.is_device_grade, true);
  assert.equal(out.run_kind, "DEVICE_VALIDATION");
  assert.equal(out.provenance.consistent, true);
  assert.deepEqual([out.provenance.observed.browser, out.provenance.observed.gpu_family], ["safari", "apple"]);
  assert.equal(out.obtained_scenarios, 38);
  assert.equal(out.comparability.filter((p) => p.comparable).length, 19);
});

test("iPad Leaflet polygon pan crosses 33.3 ms at 2000 while MapLibre stays under (evidence check)", () => {
  const file = path.resolve(HERE, "../research/runtime_spike/results/ipad/K12_iPad_M3_Safari_2026-10-17.json");
  const ipad = JSON.parse(fs.readFileSync(file, "utf8"));
  const pan = (pairKey, engine) => {
    const r = ipad.results.find((x) => x.pairKey === pairKey && (x.renderer || x.engine) === engine);
    return r?.pan_frame_ms?.p95;
  };
  assert.ok(pan("ceil|polygon|765", "leaflet") <= 33.3, "Leaflet under at 765");
  assert.ok(pan("ceil|polygon|2000", "leaflet") > 33.3, "Leaflet crosses at 2000");
  for (const c of [765, 2000, 5675, 10000]) {
    assert.ok(pan(`ceil|polygon|${c}`, "maplibre") <= 33.3, `MapLibre under at ${c}`);
  }
});

// ── pure URL builder ───────────────────────────────────────────────────────────

test("buildScenarioUrl preserves the payload query and adds fail-closed controller params", () => {
  const sc = buildSuite("full").find((x) => x.pairKey === "ceil|polygon|10000" && x.engine === "leaflet");
  const url = buildScenarioUrl("http://192.168.1.20:8000/", sc, {
    idx: 7, returnTo: "http://192.168.1.20:8000/research/runtime_spike/device_harness/ipad_controller.html",
    deviceLabel: "iPad Air", cache: "cold", network: "wifi", reps: 40, timeoutMs: 150000,
  });
  const u = new URL(url);
  assert.equal(u.origin, "http://192.168.1.20:8000");
  assert.ok(u.pathname.endsWith("/research/runtime_spike/device_harness/leaflet_ceiling.html"));
  assert.equal(u.searchParams.get("kind"), "polygon");
  assert.equal(u.searchParams.get("count"), "10000");
  assert.equal(u.searchParams.get("auto"), "1");
  assert.equal(u.searchParams.get("k12ctl"), "1");
  assert.equal(u.searchParams.get("k12idx"), "7");
  assert.equal(u.searchParams.get("k12timeout"), "150000");
  assert.equal(u.searchParams.get("device_label"), "iPad Air");
  assert.ok(u.searchParams.get("k12ret").includes("ipad_controller.html"));
});

test("handoff storage key is the exact string the rum.js bridge writes", () => {
  assert.equal(STORAGE.handoff, "k12:controller:handoff");
  assert.equal(STORAGE.session, "k12:controller:session");
});
