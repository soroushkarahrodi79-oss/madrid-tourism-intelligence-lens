// K12 iPad one-page benchmark controller — executable regression for the PURE
// CORE (research/runtime_spike/device_harness/mobile_controller_core.mjs) and the
// shared scenario matrix (suite.mjs). Run by CI via `node --test`.
//
// Covers: matrix integrity, session/dispatch, resume, incomplete pairs, fail-closed
// errors/timeouts, export shape + correctness (incl. a real-artifact parity check
// against the preserved Windows observation), and the fail-closed iPad device-grade.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSuite, SUITES, scenarioId } from "../research/runtime_spike/device_harness/suite.mjs";
import {
  STORAGE, MAX_ATTEMPTS, createSession, nextPending, runningIndex, markDispatched,
  applyHandoff, reconcileOnResume, progress, isFinished, buildConsolidated,
  buildScenarioUrl, ipadDeviceGradeOf,
} from "../research/runtime_spike/device_harness/mobile_controller_core.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// A measurement that satisfies grade.mjs scenarioComplete + a real device env.
function completeResult(scenario, { gl = "Apple GPU", itp = 40, pan = 20 } = {}) {
  return {
    spike: "K12 runtime decision",
    scenario,
    renderer: "leaflet",
    env: {
      device_label: "iPad-Air / iPadOS / Safari",
      userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605 Safari/604",
      viewport: { w: 1180, h: 820, dpr: 2 },
      gl_renderer: gl,
      gl_is_software: false,
      is_device_grade: true,
    },
    first_contentful_paint_ms: 300,
    readiness_barrier: "leaflet: ...",
    interaction_to_paint_ms: { p95: itp },
    pan_frame_ms: { p95: pan },
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
  for (const [, engines] of pairs) {
    assert.ok(engines.has("leaflet") && engines.has("maplibre"), "every pair has both engines");
  }
});

test("smoke suite is a strict subset shape (6 scenarios)", () => {
  assert.equal(buildSuite("smoke").length, 6);
  assert.equal(SUITES.smoke.length, 6);
});

test("unknown suite throws", () => {
  assert.throws(() => buildSuite("nope"));
});

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
  assert.equal(nextPending(s), 1, "a running scenario is skipped by nextPending");
});

// ── handoff folding ──────────────────────────────────────────────────────────

test("applyHandoff with a complete result marks the scenario complete", () => {
  const s = createSession({ suite: "smoke", meta: attestedMeta });
  markDispatched(s, 0);
  applyHandoff(s, { idx: 0, id: s.scenarios[0].id, result: completeResult(s.scenarios[0].id) });
  assert.equal(s.scenarios[0].status, "complete");
  assert.ok(s.scenarios[0].result);
});

test("applyHandoff fails closed on an error (watchdog timeout) — incomplete, no retry flag", () => {
  const s = createSession({ suite: "smoke", meta: attestedMeta });
  markDispatched(s, 0);
  applyHandoff(s, { idx: 0, id: s.scenarios[0].id, error: "controller watchdog timeout (150000 ms) — scenario did not complete" });
  assert.equal(s.scenarios[0].status, "incomplete");
  assert.match(s.scenarios[0].error, /watchdog timeout/);
  assert.equal(s.scenarios[0].result, null);
});

test("applyHandoff fails closed on a result missing required metrics", () => {
  const s = createSession({ suite: "smoke", meta: attestedMeta });
  markDispatched(s, 0);
  const bad = completeResult(s.scenarios[0].id);
  delete bad.pan_frame_ms; // required metric missing
  applyHandoff(s, { idx: 0, id: s.scenarios[0].id, result: bad });
  assert.equal(s.scenarios[0].status, "incomplete");
  assert.match(s.scenarios[0].error, /pan_frame_ms/);
});

test("applyHandoff ignores a stale envelope whose id does not match the queue slot", () => {
  const s = createSession({ suite: "smoke", meta: attestedMeta });
  markDispatched(s, 0);
  applyHandoff(s, { idx: 0, id: "some:other.html?x=1", result: completeResult("x") });
  assert.equal(s.scenarios[0].status, "running", "mismatched id → not folded");
});

// ── resume after interruption ─────────────────────────────────────────────────

test("reconcileOnResume retries a hard-interrupted scenario once, then marks it incomplete", () => {
  const s = createSession({ suite: "smoke", meta: attestedMeta });
  markDispatched(s, 0); // attempts=1, running, then tab killed (no handoff)
  reconcileOnResume(s);
  assert.equal(s.scenarios[0].status, "pending", "first interruption → re-queued for retry");
  markDispatched(s, 0); // attempts=2, running, killed again
  reconcileOnResume(s);
  assert.equal(s.scenarios[0].status, "incomplete");
  assert.equal(s.scenarios[0].attempts, MAX_ATTEMPTS);
  assert.match(s.scenarios[0].error, /interrupted before result/);
});

test("an unresponsive scenario never destroys previously completed measurements", () => {
  const s = createSession({ suite: "smoke", meta: attestedMeta });
  // scenario 0 completes
  markDispatched(s, 0);
  applyHandoff(s, { idx: 0, id: s.scenarios[0].id, result: completeResult(s.scenarios[0].id) });
  // scenario 1 hangs → watchdog error
  markDispatched(s, 1);
  applyHandoff(s, { idx: 1, id: s.scenarios[1].id, error: "controller watchdog timeout (150000 ms) — scenario did not complete" });
  // reconcile (simulating a later reload) must not touch terminal states
  reconcileOnResume(s);
  assert.equal(s.scenarios[0].status, "complete", "prior measurement preserved");
  assert.ok(s.scenarios[0].result.interaction_to_paint_ms);
  assert.equal(s.scenarios[1].status, "incomplete");
});

test("progress and isFinished track terminal states", () => {
  const s = createSession({ suite: "smoke", meta: attestedMeta });
  for (let i = 0; i < s.scenarios.length; i++) {
    markDispatched(s, i);
    applyHandoff(s, { idx: i, id: s.scenarios[i].id, result: completeResult(s.scenarios[i].id) });
  }
  const pr = progress(s);
  assert.equal(pr.complete, s.scenarios.length);
  assert.equal(pr.done, s.scenarios.length);
  assert.equal(isFinished(s), true);
});

// ── device-grade (fail-closed, Safari route) ──────────────────────────────────

test("ipadDeviceGradeOf: real GPU + label + attestation → device-grade", () => {
  const r = ipadDeviceGradeOf(completeResult("x"), { label: "iPad-Air", attested: true });
  assert.equal(r.device_grade, true);
});

test("ipadDeviceGradeOf fails closed WITHOUT attestation even with a real GPU (UA never infers the device)", () => {
  const r = ipadDeviceGradeOf(completeResult("x"), { label: "iPad-Air", attested: false });
  assert.equal(r.device_grade, false);
  assert.equal(r.basis.physically_attested, false);
  assert.equal(r.basis.ua_recorded_not_used_for_inference, true);
});

test("ipadDeviceGradeOf fails closed on a software renderer and on a missing label", () => {
  const sw = ipadDeviceGradeOf(completeResult("x", { gl: "Apple GPU" }), { label: "", attested: true });
  assert.equal(sw.device_grade, false, "no label");
  const soft = completeResult("x");
  soft.env.gl_renderer = "SwiftShader";
  soft.env.gl_is_software = true;
  assert.equal(ipadDeviceGradeOf(soft, { label: "iPad", attested: true }).device_grade, false);
});

// ── export correctness ────────────────────────────────────────────────────────

test("buildConsolidated: a complete attested run is a DEVICE_VALIDATION", () => {
  const s = createSession({ suite: "full", meta: attestedMeta });
  for (let i = 0; i < s.scenarios.length; i++) {
    markDispatched(s, i);
    applyHandoff(s, { idx: i, id: s.scenarios[i].id, result: completeResult(s.scenarios[i].id) });
  }
  const out = buildConsolidated(s);
  assert.equal(out.expected_scenarios, 38);
  assert.equal(out.obtained_scenarios, 38);
  assert.equal(out.complete, true);
  assert.equal(out.comparable, true);
  assert.equal(out.is_device_grade, true);
  assert.equal(out.run_kind, "DEVICE_VALIDATION");
  assert.equal(out.results.length, 38);
  assert.equal(out.attestation.physically_attested, true);
});

test("buildConsolidated: one failed Leaflet cell → NOT complete, NOT comparable, pair flagged, nothing dropped", () => {
  const s = createSession({ suite: "full", meta: attestedMeta });
  for (let i = 0; i < s.scenarios.length; i++) {
    markDispatched(s, i);
    const sc = s.scenarios[i];
    if (sc.pairKey === "ceil|polygon|10000" && sc.engine === "leaflet") {
      applyHandoff(s, { idx: i, id: sc.id, error: "controller watchdog timeout (150000 ms) — scenario did not complete" });
    } else {
      applyHandoff(s, { idx: i, id: sc.id, result: completeResult(sc.id) });
    }
  }
  const out = buildConsolidated(s);
  assert.equal(out.complete, false);
  assert.equal(out.comparable, false);
  assert.equal(out.run_kind, "NON_DEVICE / INCOMPLETE — not a device benchmark");
  assert.equal(out.results.length, 38, "incomplete scenario is still present (never skipped)");
  assert.equal(out.obtained_scenarios, 37);
  const pair = out.comparability.find((p) => p.pairKey === "ceil|polygon|10000");
  assert.deepEqual([pair.leaflet, pair.maplibre, pair.comparable], [false, true, false]);
  const comparablePairs = out.comparability.filter((p) => p.comparable).length;
  assert.equal(comparablePairs, 18, "18/19 pairs comparable");
  const stub = out.results.find((r) => r.pairKey === "ceil|polygon|10000" && r.engine === "leaflet");
  assert.match(stub.error, /watchdog timeout/);
});

test("buildConsolidated is not device-grade when attestation is absent (even if all complete)", () => {
  const s = createSession({ suite: "full", meta: { device_label: "iPad", attested: false } });
  for (let i = 0; i < s.scenarios.length; i++) {
    markDispatched(s, i);
    applyHandoff(s, { idx: i, id: s.scenarios[i].id, result: completeResult(s.scenarios[i].id) });
  }
  const out = buildConsolidated(s);
  assert.equal(out.complete, true);
  assert.equal(out.is_device_grade, false);
  assert.notEqual(out.run_kind, "DEVICE_VALIDATION");
});

// ── export correctness against the REAL preserved Windows observation ─────────
// Uses the actual completed measurements from the physical Windows run as realistic
// per-scenario payloads to prove the controller's aggregation reproduces the exact
// completeness/comparability verdict the independent runner recorded. (Route/engine
// agnostic — this validates folding + aggregation, not the device identity.)

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

  assert.equal(out.complete, win.complete, "complete verdict matches the runner");
  assert.equal(out.comparable, win.comparable, "comparable verdict matches the runner");
  assert.equal(out.obtained_scenarios, win.obtained_scenarios);
  assert.equal(out.expected_scenarios, win.expected_scenarios);

  // the single failed pair matches, and every other pair stays comparable
  const mineByPair = new Map(out.comparability.map((p) => [p.pairKey, p.comparable]));
  for (const p of win.comparability) {
    assert.equal(mineByPair.get(p.pairKey), p.comparable, `pair ${p.pairKey} comparability matches`);
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

// ── storage key contract shared with the rum.js bridge ────────────────────────

test("handoff storage key is the exact string the rum.js bridge writes", () => {
  assert.equal(STORAGE.handoff, "k12:controller:handoff");
  assert.equal(STORAGE.session, "k12:controller:session");
});
