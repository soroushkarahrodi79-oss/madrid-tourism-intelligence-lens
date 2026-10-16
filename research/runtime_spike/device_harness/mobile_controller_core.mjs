// K12 iPad one-page benchmark controller — PURE CORE (no DOM, no browser APIs).
//
// The controller UI (ipad_controller.html) is a thin shell over these functions;
// everything that decides completeness, comparability, device-grade, resume and
// export lives here so it can be unit-tested under `node --test`
// (tests/mobile_controller.test.mjs) without a browser.
//
// WHY A CONTROLLER AT ALL. iPad Safari cannot run Playwright, so the device-grade
// iPad route (device_harness/IPAD.md) is a manual walk through 38 individual Safari
// URLs, each downloading its own JSON. This controller automates that walk on ONE
// page: it drives the SAME harness pages (same payloads, thresholds, pairs — from
// suite.mjs), one visible foreground navigation at a time, keeps every completed
// measurement in localStorage between navigations, resumes after an interruption,
// and exports ONE consolidated JSON in the SAME shape run_device.mjs emits.
//
// FAIL-CLOSED is the whole point. A scenario that times out or errors stays
// INCOMPLETE and is recorded as such — never silently skipped, never invented. An
// unresponsive scenario (the 10 000-polygon Leaflet case) cannot destroy prior
// measurements: prior results live in the session object, which the hung page
// never writes. Device-grade requires an explicit physical-device attestation from
// the owner; it is NOT inferred from the user-agent string.

import { scenarioComplete, deviceGradeOf, GPU_VENDOR, SOFTWARE_OR_GENERIC } from "./grade.mjs";
import { buildSuite, scenarioId, pageBasename } from "./suite.mjs";

// localStorage keys (same origin shared across the controller page and every
// harness page served from the repo root).
export const STORAGE = {
  session: "k12:controller:session",
  handoff: "k12:controller:handoff",
};

// One retry for a HARD interruption only (tab closed / crashed with no result
// written). A watchdog timeout or a page error is a definitive INCOMPLETE and is
// never retried — a repeated 2-minute timeout is the finding, not a transient.
export const MAX_ATTEMPTS = 2;

// ── session lifecycle ────────────────────────────────────────────────────────

export function createSession({ suite = "full", meta = {} } = {}) {
  const scenarios = buildSuite(suite).map((s) => ({
    page: s.page,
    q: s.q,
    engine: s.engine,
    comparative: s.comparative,
    pairKey: s.pairKey,
    id: scenarioId(s),
    status: "pending", // pending | running | complete | incomplete
    attempts: 0,
    result: null, // the window.__K12__ object once complete
    error: null, // reason string once incomplete
  }));
  return {
    spike: "K12 runtime decision",
    measurement: "ipad_controller_run",
    route: "ipad_safari_one_page_controller",
    suite,
    meta: {
      device_label: meta.device_label || "",
      cache: meta.cache || "unknown",
      network: meta.network || "unknown",
      reps: Number(meta.reps) || 40,
      timeout_ms: Number(meta.timeout_ms) || 150000,
      attested: meta.attested === true,
      attested_at: meta.attested === true ? meta.attested_at || new Date().toISOString() : null,
      userAgent: meta.userAgent || null,
    },
    createdAt: new Date().toISOString(),
    scenarios,
  };
}

export function nextPending(session) {
  const i = session.scenarios.findIndex((s) => s.status === "pending");
  return i === -1 ? null : i;
}

export function runningIndex(session) {
  const i = session.scenarios.findIndex((s) => s.status === "running");
  return i === -1 ? null : i;
}

// Mark a scenario dispatched (about to navigate). Persist BEFORE navigating so an
// interruption mid-scenario is detectable on the next controller load.
export function markDispatched(session, idx) {
  const s = session.scenarios[idx];
  if (!s) throw new Error(`markDispatched: bad index ${idx}`);
  s.status = "running";
  s.attempts += 1;
  s.dispatchedAt = new Date().toISOString();
  return session;
}

// Fold a returned measurement (or error) from a harness page into the session.
// envelope: { idx, id?, result? , error? }.
export function applyHandoff(session, envelope) {
  if (!envelope || typeof envelope.idx !== "number") return session;
  const s = session.scenarios[envelope.idx];
  if (!s) return session; // stale/out-of-range → ignore (reconcile will retry)
  // Guard against a stale handoff left by a different queue position.
  if (envelope.id && envelope.id !== s.id) return session;

  if (envelope.error) {
    // Definitive failure (watchdog timeout or page error) → INCOMPLETE, no retry.
    s.status = "incomplete";
    s.result = null;
    s.error = String(envelope.error);
    return session;
  }
  const r = envelope.result;
  const c = scenarioComplete(r);
  if (c.ok) {
    s.status = "complete";
    s.result = r;
    s.error = null;
  } else {
    // A result came back but is missing required metrics → INCOMPLETE, fail closed.
    s.status = "incomplete";
    s.result = r || null;
    s.error = c.why || "incomplete result";
  }
  return session;
}

// On controller (re)load: any scenario still 'running' with no folded result was
// HARD-interrupted (no handoff written). Retry once, else mark incomplete. This is
// what preserves completed work across an interruption while never skipping.
export function reconcileOnResume(session) {
  for (const s of session.scenarios) {
    if (s.status !== "running") continue;
    if (s.attempts < MAX_ATTEMPTS) {
      s.status = "pending"; // re-queue for one retry
    } else {
      s.status = "incomplete";
      s.error = `interrupted before result after ${s.attempts} attempt(s)`;
    }
  }
  return session;
}

export function progress(session) {
  const total = session.scenarios.length;
  const complete = session.scenarios.filter((s) => s.status === "complete").length;
  const incomplete = session.scenarios.filter((s) => s.status === "incomplete").length;
  const pending = session.scenarios.filter((s) => s.status === "pending").length;
  const running = session.scenarios.filter((s) => s.status === "running").length;
  return { total, complete, incomplete, pending, running, done: complete + incomplete };
}

// Finished = nothing left to dispatch (every scenario reached a terminal state).
export function isFinished(session) {
  return session.scenarios.every((s) => s.status === "complete" || s.status === "incomplete");
}

// ── device-grade for the iPad Safari route (fail-closed) ─────────────────────
//
// Distinct from grade.mjs deviceGradeOf, which is the Playwright LAPTOP gate and
// hard-requires a chrome|msedge channel launched headed — neither of which exists
// on Safari. For the manual Safari route the device identity is certified by an
// EXPLICIT owner attestation, NOT by the user-agent string (iPadOS Safari reports a
// "Macintosh" UA in desktop mode, so UA cannot prove an iPad). We still require a
// positively-identified hardware GPU and a human label, and we record the UA for
// audit without using it to infer the device.
export function ipadDeviceGradeOf(result, opts = {}) {
  const e = (result && result.env) || {};
  const gl = String(e.gl_renderer || "").trim();
  const label = opts.label || "";
  const attested = opts.attested === true;

  const software = Boolean(e.gl_is_software) || SOFTWARE_OR_GENERIC.test(gl);
  const hasVendorToken = GPU_VENDOR.test(gl);
  const hasRealGpu = !software && hasVendorToken;
  const hasLabel = Boolean(label) && !/container|unlabelled/i.test(label);
  const hasUA = Boolean(e.userAgent) && e.userAgent !== "unknown";

  const basis = {
    gl_renderer: gl,
    gl_is_software: software,
    has_gpu_vendor_token: hasVendorToken,
    has_real_gpu: hasRealGpu,
    has_human_label: hasLabel,
    has_ua: hasUA,
    ua_recorded_not_used_for_inference: true,
    physically_attested: attested,
    route: "ipad_safari",
  };
  // Attestation is REQUIRED and is the device-identity signal (not the UA).
  return { device_grade: hasRealGpu && hasLabel && hasUA && attested, basis };
}

// ── consolidated export (same shape as run_device.mjs output) ────────────────

export function buildConsolidated(session, now = new Date().toISOString()) {
  const scn = session.scenarios;
  const attested = session.meta.attested === true;

  // results[]: completed → the stored measurement (+pairKey/comparative, like the
  // runner); incomplete → an error stub matching run_device's stub shape.
  const results = scn.map((s) => {
    if (s.status === "complete" && s.result) {
      return { ...s.result, pairKey: s.pairKey, comparative: s.comparative };
    }
    return {
      scenario: s.id,
      query: s.q,
      engine: s.engine,
      pairKey: s.pairKey,
      comparative: s.comparative,
      error: s.error || "incomplete (no result)",
    };
  });

  const completeness = scn.map((s) => {
    const c = s.status === "complete" && s.result ? scenarioComplete(s.result) : { ok: false, why: s.error || "incomplete" };
    return { scenario: s.id, pairKey: s.pairKey, engine: s.engine, complete: c.ok, reason: c.ok ? null : c.why };
  });
  const allComplete = completeness.length > 0 && completeness.every((c) => c.complete);

  // comparability: every comparative pairKey needs BOTH engines complete.
  const pairMap = {};
  for (const c of completeness) {
    const s = scn.find((x) => x.pairKey === c.pairKey);
    if (!s || !s.comparative) continue;
    pairMap[c.pairKey] = pairMap[c.pairKey] || {};
    pairMap[c.pairKey][c.engine] = c.complete;
  }
  const comparability = Object.entries(pairMap).map(([pairKey, engines]) => ({
    pairKey, leaflet: !!engines.leaflet, maplibre: !!engines.maplibre, comparable: !!engines.leaflet && !!engines.maplibre,
  }));
  const allComparable = comparability.length > 0 && comparability.every((p) => p.comparable);

  // device-grade across every completed, env-bearing result (fail-closed; requires
  // attestation). If nothing completed, not device-grade.
  const graded = scn.filter((s) => s.status === "complete" && s.result && s.result.env)
    .map((s) => ipadDeviceGradeOf(s.result, { label: session.meta.device_label, attested }));
  const deviceGrade = attested && graded.length > 0 && graded.every((g) => g.device_grade);
  const sampleBasis = graded[0]?.basis || null;

  const isDeviceValidation = allComplete && deviceGrade && allComparable;
  const firstEnv = results.find((r) => r.env)?.env || null;

  return {
    spike: "K12 runtime decision",
    measurement: "ipad_controller_run",
    route: "ipad_safari_one_page_controller",
    suite: session.suite,
    device_label: session.meta.device_label || "(none supplied)",
    complete: allComplete,
    comparable: allComparable,
    is_device_grade: deviceGrade,
    run_kind: isDeviceValidation ? "DEVICE_VALIDATION" : "NON_DEVICE / INCOMPLETE — not a device benchmark",
    attestation: {
      physically_attested: attested,
      attested_at: session.meta.attested_at || null,
      method: "explicit owner confirmation in the controller UI",
      note: "A real iPad is NOT inferred from the user-agent; this flag is the device-identity signal and the run is not device-grade without it.",
    },
    device_grade_basis: sampleBasis,
    device_grade_rule:
      "iPad Safari route fails CLOSED: needs a hardware GPU vendor token (not SwiftShader/llvmpipe/NO_WEBGL/generic) AND a real UA AND a human device_label AND an explicit physical-device attestation. The UA is recorded for audit but is NOT used to infer the device.",
    launch: {
      channel: "safari",
      headed: true,
      browser_version: firstEnv?.userAgent || session.meta.userAgent || null,
      launch_error: null,
    },
    verified_config: {
      gl_renderer: sampleBasis?.gl_renderer ?? null,
      userAgent: firstEnv?.userAgent ?? session.meta.userAgent ?? null,
      viewport: firstEnv?.viewport ?? null,
      channel: "safari",
      headed: true,
    },
    expected_scenarios: scn.length,
    obtained_scenarios: results.filter((r) => r && !r.error).length,
    completeness,
    comparability,
    generated_at: now,
    results,
  };
}

// ── pure URL builder for a scenario dispatch (testable without DOM) ──────────
//
// origin: e.g. "http://192.168.1.20:8000" (the repo-root static server).
// returnTo: the controller page's own URL (where the harness page navigates back).
export function buildScenarioUrl(origin, scenario, { idx, returnTo, deviceLabel, cache, network, reps, timeoutMs }) {
  const base = `${String(origin).replace(/\/$/, "")}/${scenario.page}`;
  const p = new URLSearchParams(scenario.q);
  p.set("device_label", deviceLabel || "");
  p.set("cache", cache || "");
  p.set("network", network || "");
  p.set("reps", String(reps || 40));
  p.set("auto", "1");
  // controller handoff params (read by the rum.js bridge):
  p.set("k12ctl", "1");
  p.set("k12idx", String(idx));
  p.set("k12id", scenario.id || scenarioId(scenario));
  p.set("k12ret", returnTo || "");
  p.set("k12timeout", String(timeoutMs || 150000));
  return `${base}?${p.toString()}`;
}

export { scenarioId, pageBasename };
