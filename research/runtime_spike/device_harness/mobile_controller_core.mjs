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

import { scenarioComplete, SOFTWARE_OR_GENERIC } from "./grade.mjs";
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
  const c = controllerScenarioComplete(r);
  if (c.ok) {
    s.status = "complete";
    s.result = r;
    s.error = null;
  } else {
    // A result came back but is missing metrics, or carries sparse/fabricated/
    // inconsistent sample distributions → INCOMPLETE, fail closed. The raw result
    // is retained for audit; it is never promoted to a complete measurement.
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

// ── observed-environment parsing (what the browser actually reported) ────────
//
// Attestation records what the owner CLAIMS. These helpers record what the run
// OBSERVED, so the two can be cross-checked. The claimed iPad-Safari route is
// rejected when the observed environment makes it impossible — a Windows/Android/
// Linux/ChromeOS platform, a Chromium/Claude/Edge/Firefox browser, a software
// renderer, or a non-Apple GPU (incl. Windows ANGLE/Direct3D). We do NOT require
// the literal word "iPad": iPadOS Safari in desktop mode reports a "Macintosh" UA,
// which is accepted when the GPU is Apple and the browser is Safari.
const DESKTOP_OS = /(windows nt|android|cros|\bx11\b|\blinux\b(?!.*android))/i;
const CHROMIUM_UA = /(chrome\/|crios\/|chromium\/|\bedg(a|ios)?\/|claude\/|opr\/|samsungbrowser\/|yabrowser\/)/i;
const FIREFOX_UA = /(firefox\/|fxios\/)/i;
const SAFARI_UA = /version\/[\d.]+.*safari/i;
const APPLE_GPU = /(apple\s*(gpu|m[123]|a[0-9]{1,2})|apple\b)/i;
const ANGLE_NON_APPLE = /angle\s*\((?!apple)/i; // Windows ANGLE (Intel/NVIDIA/AMD, Direct3D)

export function observedEnvironment(env = {}) {
  const ua = String(env.userAgent || "").trim();
  const gl = String(env.gl_renderer || "").trim();
  let platform = "unknown";
  if (/windows nt/i.test(ua)) platform = "windows";
  else if (/android/i.test(ua)) platform = "android";
  else if (/cros/i.test(ua)) platform = "chromeos";
  else if (/ipad|iphone|ipod/i.test(ua)) platform = "ios_ipados";
  else if (/macintosh|mac os x/i.test(ua)) platform = "macos_or_ipados_desktop";
  else if (/\blinux\b|x11/i.test(ua)) platform = "linux";

  let browser = "other";
  if (/claude\//i.test(ua)) browser = "claude";
  else if (/\bedg(a|ios)?\//i.test(ua)) browser = "edge";
  else if (/(chrome\/|crios\/|chromium\/)/i.test(ua)) browser = "chrome";
  else if (FIREFOX_UA.test(ua)) browser = "firefox";
  else if (SAFARI_UA.test(ua)) browser = "safari";

  const software = Boolean(env.gl_is_software) || SOFTWARE_OR_GENERIC.test(gl);
  let gpu_family = "other";
  if (software) gpu_family = "software";
  else if (APPLE_GPU.test(gl)) gpu_family = "apple";
  else if (/nvidia|geforce/i.test(gl)) gpu_family = "nvidia";
  else if (/amd|radeon/i.test(gl)) gpu_family = "amd";
  else if (/intel|iris/i.test(gl)) gpu_family = "intel";
  else if (/adreno/i.test(gl)) gpu_family = "adreno";
  else if (/mali/i.test(gl)) gpu_family = "mali";
  else if (/powervr/i.test(gl)) gpu_family = "powervr";

  return {
    userAgent: ua || null,
    gl_renderer: gl || null,
    platform,
    browser,
    is_chromium: browser === "chrome" || browser === "edge" || browser === "claude",
    gpu_family,
    angle_non_apple: ANGLE_NON_APPLE.test(gl),
    gl_is_software: software,
  };
}

// Is the observed environment compatible with a REAL iPad Safari run?
// Returns { ok, blockers:[...] }. Fail-closed: any contradiction is a blocker.
export function ipadConsistency(env = {}) {
  const o = observedEnvironment(env);
  const blockers = [];
  if (!o.userAgent) blockers.push("no user-agent recorded");
  if (DESKTOP_OS.test(o.userAgent || "")) blockers.push(`observed platform "${o.platform}" is not iPadOS (incompatible with an iPad Safari run)`);
  if (o.is_chromium) blockers.push(`observed browser "${o.browser}" is Chromium-based, not Safari`);
  if (o.browser === "firefox") blockers.push("observed browser is Firefox, not Safari");
  if (o.gl_is_software) blockers.push(`software renderer "${o.gl_renderer}" is not a device GPU`);
  if (o.angle_non_apple) blockers.push(`GPU "${o.gl_renderer}" is Windows ANGLE/Direct3D, not an Apple GPU`);
  if (!o.gl_is_software && o.gpu_family !== "apple") blockers.push(`GPU "${o.gl_renderer}" is "${o.gpu_family}", not an Apple GPU`);
  return { ok: blockers.length === 0, blockers, observed: o };
}

// ── measurement integrity (reject sparse / fabricated / inconsistent stats) ──
//
// rum.js stats() emits { n, min, median, p95, max, mean, raw:[...] } with
// raw.length === n and the percentiles computed by a fixed algorithm. A hand-made
// envelope like { p95: 42.1 } must NOT satisfy completeness. recomputeStats mirrors
// rum.js stats() exactly so a well-formed-but-fabricated stat whose summaries do not
// match its raw samples is also rejected.
export const MIN_SAMPLES = 10; // real runs use reps≈40 (interaction) / ≈59 (pan)

export function recomputeStats(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const s = [...raw].sort((a, b) => a - b);
  const pct = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const r = (x) => Math.round(x * 100) / 100;
  return { n: s.length, min: r(s[0]), median: r(pct(50)), p95: r(pct(95)), max: r(s[s.length - 1]), mean: r(mean) };
}

export function statOk(stat, { minSamples = MIN_SAMPLES } = {}) {
  if (!stat || typeof stat !== "object" || Array.isArray(stat)) return { ok: false, why: "metric is not a stats object" };
  const { n, raw } = stat;
  if (!Array.isArray(raw)) return { ok: false, why: "no raw samples (sparse/fabricated metric)" };
  if (typeof n !== "number" || raw.length !== n) return { ok: false, why: `sample count mismatch (n=${n}, raw=${raw.length})` };
  if (n < minSamples) return { ok: false, why: `too few samples (${n} < ${minSamples})` };
  if (!raw.every((x) => typeof x === "number" && isFinite(x))) return { ok: false, why: "non-finite raw sample" };
  for (const k of ["min", "median", "p95", "max", "mean"]) {
    if (typeof stat[k] !== "number" || !isFinite(stat[k])) return { ok: false, why: `missing/non-numeric ${k}` };
  }
  // the summaries must be the ones derivable from raw (fixed algorithm)
  const re = recomputeStats(raw);
  for (const k of ["min", "median", "p95", "max", "mean"]) {
    if (Math.abs(stat[k] - re[k]) > 0.011) return { ok: false, why: `${k} (${stat[k]}) inconsistent with raw samples (${re[k]})` };
  }
  return { ok: true };
}

// Completeness for the controller: the base metric/readiness gate (grade.mjs) PLUS
// real, internally-consistent sample distributions. first_contentful_paint_ms must
// be a finite number (a null/absent FCP stays legitimately INCOMPLETE — never
// fabricated). Used both when folding a handoff and when building the export.
export function controllerScenarioComplete(result) {
  const base = scenarioComplete(result);
  if (!base.ok) return base;
  if (typeof result.first_contentful_paint_ms !== "number" || !isFinite(result.first_contentful_paint_ms)) {
    return { ok: false, why: "first_contentful_paint_ms missing/non-numeric (legitimate incomplete — not fabricated)" };
  }
  const itp = statOk(result.interaction_to_paint_ms);
  if (!itp.ok) return { ok: false, why: `interaction_to_paint_ms: ${itp.why}` };
  const pan = statOk(result.pan_frame_ms);
  if (!pan.ok) return { ok: false, why: `pan_frame_ms: ${pan.why}` };
  return { ok: true };
}

// ── device-grade for the iPad Safari route (fail-closed) ─────────────────────
//
// Attestation is REQUIRED but NOT SUFFICIENT: it records what the owner claims,
// and it is rejected when the OBSERVED environment contradicts an iPad Safari run.
// A real iPad is still never inferred from the UA alone (iPadOS desktop-mode reports
// "Macintosh"); the UA/GPU are used only to REFUTE an impossible claim, never to
// manufacture one. Requires an Apple GPU, a human label, a real UA, attestation,
// and an environment consistent with iPad Safari.
export function ipadDeviceGradeOf(result, opts = {}) {
  const e = (result && result.env) || {};
  const gl = String(e.gl_renderer || "").trim();
  const label = opts.label || "";
  const attested = opts.attested === true;

  const cons = ipadConsistency(e);
  const o = cons.observed;
  const hasAppleGpu = o.gpu_family === "apple";
  const hasLabel = Boolean(label) && !/container|unlabelled/i.test(label);
  const hasUA = Boolean(e.userAgent) && e.userAgent !== "unknown";

  const basis = {
    gl_renderer: gl,
    gl_is_software: o.gl_is_software,
    observed_platform: o.platform,
    observed_browser: o.browser,
    gpu_family: o.gpu_family,
    has_apple_gpu: hasAppleGpu,
    has_human_label: hasLabel,
    has_ua: hasUA,
    physically_attested: attested,
    environment_consistent_with_ipad_safari: cons.ok,
    blockers: cons.blockers,
    route: "ipad_safari",
  };
  const device_grade = hasAppleGpu && hasLabel && hasUA && attested && cons.ok;
  return { device_grade, basis };
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
    const c = s.status === "complete" && s.result ? controllerScenarioComplete(s.result) : { ok: false, why: s.error || "incomplete" };
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
  // attestation AND an iPad-Safari-consistent observed environment). If nothing
  // completed, not device-grade.
  const gradedScns = scn.filter((s) => s.status === "complete" && s.result && s.result.env);
  const graded = gradedScns.map((s) => ipadDeviceGradeOf(s.result, { label: session.meta.device_label, attested }));

  // whole-run provenance: observe EVERY env-bearing result (complete or not) and
  // report incompatible environments as blockers. A run whose environments disagree
  // across scenarios, or whose observed environment contradicts the claimed iPad
  // Safari route, is NOT device-grade no matter what the owner attested.
  const envResults = results.filter((r) => r && r.env);
  const observedAll = envResults.map((r) => observedEnvironment(r.env));
  const firstEnv = envResults[0]?.env || null;
  const firstObserved = observedAll[0] || observedEnvironment({});
  const provenanceBlockers = [];
  const platforms = new Set(observedAll.map((o) => o.platform));
  const browsers = new Set(observedAll.map((o) => o.browser));
  const gpus = new Set(observedAll.map((o) => o.gpu_family));
  if (platforms.size > 1) provenanceBlockers.push(`environments disagree across scenarios: platforms {${[...platforms].join(", ")}}`);
  if (browsers.size > 1) provenanceBlockers.push(`environments disagree across scenarios: browsers {${[...browsers].join(", ")}}`);
  if (gpus.size > 1) provenanceBlockers.push(`environments disagree across scenarios: GPUs {${[...gpus].join(", ")}}`);
  if (firstEnv) provenanceBlockers.push(...ipadConsistency(firstEnv).blockers);
  // dedupe
  const blockers = [...new Set(provenanceBlockers)];

  const deviceGrade =
    attested && graded.length > 0 && graded.every((g) => g.device_grade) && blockers.length === 0;
  const sampleBasis = graded[0]?.basis || (firstEnv ? ipadDeviceGradeOf({ env: firstEnv }, { label: session.meta.device_label, attested }).basis : null);

  const isDeviceValidation = allComplete && deviceGrade && allComparable;

  return {
    spike: "K12 runtime decision",
    measurement: "ipad_controller_run",
    // the route the owner INTENDED to run (a protocol label), kept separate from
    // what was OBSERVED (`observed` below). Never asserts the browser was Safari.
    intended_route: "ipad_safari_one_page_controller",
    suite: session.suite,
    device_label: session.meta.device_label || "(none supplied)",
    complete: allComplete,
    comparable: allComparable,
    is_device_grade: deviceGrade,
    run_kind: isDeviceValidation ? "DEVICE_VALIDATION" : "NON_DEVICE / INCOMPLETE — not a device benchmark",
    attestation: {
      physically_attested: attested,
      attested_at: session.meta.attested_at || null,
      claimed_platform: "ipad_safari",
      method: "explicit owner confirmation in the controller UI",
      environment_consistent_with_claim: blockers.length === 0,
      note: "Attestation records the owner's claim. It is REQUIRED but NOT sufficient: it is rejected when the observed environment below contradicts an iPad Safari run. A real iPad is never inferred from the user-agent.",
    },
    provenance: {
      consistent: blockers.length === 0,
      blockers,
      observed: {
        platform: firstObserved.platform,
        browser: firstObserved.browser,
        gpu_family: firstObserved.gpu_family,
        gl_renderer: firstObserved.gl_renderer,
        userAgent: firstObserved.userAgent,
        distinct_platforms: [...platforms],
        distinct_browsers: [...browsers],
        distinct_gpus: [...gpus],
      },
    },
    device_grade_basis: sampleBasis,
    device_grade_rule:
      "iPad Safari route fails CLOSED: needs an Apple GPU (not software/ANGLE-Direct3D/other), a real UA, a human device_label, an explicit physical-device attestation, AND an observed environment consistent with iPad Safari (no Windows/Android/Linux/ChromeOS platform and no Chromium/Edge/Firefox/Claude browser). The UA/GPU are used only to REFUTE an impossible claim, never to infer a device.",
    launch: {
      intended_route: "ipad_safari_one_page_controller",
      observed_platform: firstObserved.platform,
      observed_browser: firstObserved.browser,
      observed_gl_renderer: firstObserved.gl_renderer,
      observed_user_agent: firstEnv?.userAgent || session.meta.userAgent || null,
      launch_error: null,
    },
    verified_config: {
      gl_renderer: firstObserved.gl_renderer,
      userAgent: firstEnv?.userAgent ?? session.meta.userAgent ?? null,
      viewport: firstEnv?.viewport ?? null,
      observed_platform: firstObserved.platform,
      observed_browser: firstObserved.browser,
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
