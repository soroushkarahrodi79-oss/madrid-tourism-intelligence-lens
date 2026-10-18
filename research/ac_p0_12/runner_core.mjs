/*
 * AC-P0-12 device-validation runner — measurement core.
 *
 * TEST-ONLY. Not referenced by index.html, css/ or js/. It measures the REAL
 * PR #96 production application (index.html + js/app.js) by embedding it in a
 * same-origin iframe and driving its production interaction paths through the
 * already-existing, opt-in `window.__HALO_REGRESSION__` seam (gated by
 * ?haloRegressionTest=1). It changes no scientific contract, dataset, membership
 * semantic, UI layout or HATI behaviour; it only observes.
 *
 * This module is an ES module so it can be (a) imported by the browser runner
 * page and (b) imported by `node --test` for its pure functions. The DOM-driving
 * functions touch window/document ONLY when called, so importing under node is
 * safe.
 *
 * HONESTY CONTRACT (mirrors docs/RUNTIME_DECISION_SPIKE.md §3.2 / §11):
 *   - `interaction_to_paint_ms` is a DOUBLE-rAF PROXY (two frames), frame-quantised,
 *     NOT a true paint timestamp. On a fast path it floors near one frame interval.
 *   - `script_work_ms` is the SYNCHRONOUS wall time of the production interaction
 *     call (moveLensToLatLng / slider oninput → refresh()), captured separately so
 *     renderer/layout cost is never conflated with the frame-quantised proxy.
 *   - `pan_frame_ms` is the distribution of rAF frame deltas during a pan.
 *   - Every scenario carries `measurement_kind`:
 *       "actual_gesture"    — a physical pointer/touch gesture the owner performed.
 *       "automated_sequence"— the production interaction path driven in a loop
 *                             (NOT a physical gesture; reproducible proxy).
 *     The two are NEVER equated and a device PASS requires actual_gesture runs.
 */

// ── Pure, node-testable predicates ──────────────────────────────────────────

// Identical to js/app.js `isLoopbackOrPrivateLanHost` — keep in sync. The node
// test (tests/ac_p0_12_runner.test.mjs) tests THIS copy; the classic app.js
// script cannot be imported by node.
export function isLoopbackOrPrivateLanHost(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1") return true;
  if (h.startsWith("fe80:")) return true;
  if (/\.local$/.test(h)) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return false;
    if (o[0] === 127) return true;
    if (o[0] === 10) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 169 && o[1] === 254) return true;
    return false;
  }
  return false;
}

// Same device-grade GPU tokens the K12 harness uses (research/.../grade.mjs), so
// the two runners classify hardware identically.
export const GPU_VENDOR =
  /(apple|nvidia|geforce|amd|radeon|intel|iris|adreno|mali|powervr|qualcomm|vivante|videocore|m1|m2|m3|a1[0-9]|a[0-9]{2}\sgpu)/i;
export const SOFTWARE_OR_GENERIC =
  /(swiftshader|llvmpipe|software|microsoft basic|mesa offscreen|^no_webgl$|^unknown$|^$)/i;

export function summarize(samples) {
  const clean = (samples || []).filter((x) => typeof x === "number" && isFinite(x));
  if (!clean.length) return null;
  const s = [...clean].sort((a, b) => a - b);
  const pct = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const r = (x) => Math.round(x * 100) / 100;
  return { n: s.length, min: r(s[0]), median: r(pct(50)), p95: r(pct(95)), max: r(s[s.length - 1]), mean: r(mean), raw: s.map(r) };
}

// The exact signature js/app.js writes on #planningMembership.dataset.signature:
// each touched ámbito's code AND its containsCentre bit, plus the document lang.
// Recomputing it from the canonical model and comparing to the DOM proves the
// WHOLE displayed set (not just the ≤3 chips) is fresh after settle — no stale
// count, no stale "contains the Lens centre" mark.
export function membershipSignature(canonical, lang) {
  const touched = (canonical && canonical.touched) || [];
  return `${touched.map((e) => `${e.ambitoCode}:${e.containsCentre ? 1 : 0}`).join(",")}|${lang || ""}`;
}

// The three physical-gesture scenarios AC-P0-12 requires, by exact id. A global
// PASS needs all three present, attributed, sufficiently sampled and passing
// (R2). The interaction each one grades (R1): marker/radius are graded ONLY on
// interaction-to-paint; pan is graded ONLY on pan-frame time.
export const REQUIRED_ACTUAL_SCENARIOS = Object.freeze([
  "actual_gesture_marker_drag",
  "actual_gesture_radius",
  "actual_gesture_pan",
]);

export const INTERACTION_METRIC = Object.freeze({
  marker_drag: "interaction_to_paint_ms",
  radius_slider: "interaction_to_paint_ms",
  pan: "pan_frame_ms",
});

// R4 invariant: a stat object must recompute byte-for-byte from its stored `raw`
// array, and n must equal raw.length. Throws if not — used by the runner and the
// tests so a reported median/p95/max can never drift from the samples behind it.
export function assertStatsMatchRaw(stat, where = "stat") {
  if (stat == null) return true;
  if (!Array.isArray(stat.raw)) throw new Error(`${where}: no raw array to reproduce from`);
  if (stat.n !== stat.raw.length) throw new Error(`${where}: n=${stat.n} but raw.length=${stat.raw.length}`);
  const re = summarize(stat.raw);
  for (const k of ["n", "min", "median", "p95", "max"]) {
    if (re[k] !== stat[k]) throw new Error(`${where}: ${k} reported ${stat[k]} but recomputes from raw as ${re[k]}`);
  }
  return true;
}

// Pass/fail of ONE scenario against thresholds.json, SCOPED to the scenario's own
// interaction (R1). A marker/radius scenario is graded only on interaction-to-paint
// (≤150 ms); a pan scenario only on pan-frame p95 (≤33.3 ms). The map-pan ceiling
// is NEVER applied to a drag/radius window, and ITP is never applied to a pan.
// p95 ≤ acceptable passes; ≤ good is flagged good. A missing required metric is
// NOT a silent pass (graded=false → the complete-scenario gate treats it as
// incomplete). Freshness, where the scenario requires it, is part of its pass.
export function gradeScenario(scenario, thresholds) {
  const t = thresholds.thresholds || thresholds;
  const metricKey = INTERACTION_METRIC[scenario.interaction] || null;
  const checks = [];
  let graded = false;
  if (metricKey) {
    const m = scenario[metricKey];
    const tk = t[metricKey];
    if (m && typeof m.p95 === "number" && tk) {
      graded = true;
      checks.push({
        metric: `${metricKey}.p95`,
        value: m.p95,
        acceptable: tk.acceptable_p95,
        good: tk.good_p95,
        pass: m.p95 <= tk.acceptable_p95,
        is_good: m.p95 <= tk.good_p95,
      });
    }
  }
  const metricsPass = checks.every((c) => c.pass);
  // Freshness is required for marker/radius unless the scenario explicitly marks
  // it not-applicable (a pre-feature `main` baseline, or a pan which does not move
  // the Lens). freshness == null means "not checked for this interaction".
  const freshRequired = scenario.freshness != null && scenario.freshness.applicable !== false;
  const freshnessOk = !freshRequired || scenario.freshness.fresh === true;
  const enough = scenario.samples_ok !== false;
  return {
    graded,
    scored_metric: metricKey,
    checks,
    freshness_required: freshRequired,
    freshness_ok: freshnessOk,
    samples_ok: enough,
    pass: graded && metricsPass && freshnessOk && enough,
  };
}

// Owner-facing device-grade verdict. Unlike the Playwright K12 gate (which also
// requires a chrome/msedge channel), a physical iPad/iPhone run is MANUAL Safari,
// so the channel test is inappropriate here. AC-P0-12 device-grade = a real
// (non-software) GPU + a human device label + the measurement was an actual
// physical gesture + enough samples. Fails CLOSED and records its basis. A UA
// that plainly contradicts the owner's device-class claim refuses the grade.
export function deviceGradeFor(env, opts = {}) {
  const gl = String(env.gl_renderer || "").trim();
  const software = Boolean(env.gl_is_software) || SOFTWARE_OR_GENERIC.test(gl);
  // Safari may MASK the unmasked renderer (reporting a generic "WebKit WebGL"),
  // so a missing vendor token is not disqualifying on its own — but a software
  // rasteriser always is. We never claim a specific GPU we cannot read.
  const hasVendorToken = GPU_VENDOR.test(gl);
  const label = String(opts.label || "").trim();
  const hasLabel = Boolean(label) && !/^(unlabelled|container|test|todo)$/i.test(label);
  const hasUA = Boolean(env.userAgent) && env.userAgent !== "unknown";
  const actualGesture = opts.measurement_kind === "actual_gesture";
  const enoughSamples = opts.samples_ok !== false;
  const conflict = Boolean(opts.attestation_conflict);
  const basis = {
    gl_renderer: gl,
    gl_is_software: software,
    has_gpu_vendor_token: hasVendorToken,
    has_human_label: hasLabel,
    has_ua: hasUA,
    measurement_kind: opts.measurement_kind || "unknown",
    actual_gesture: actualGesture,
    enough_samples: enoughSamples,
    attestation_conflict: conflict,
  };
  return { device_grade: !software && hasUA && hasLabel && actualGesture && enoughSamples && !conflict, basis };
}

// Report-only device-class guess from UA + touch + viewport. It NEVER upgrades a
// claim to iPad/iPhone; it only flags a conflict with the owner's stated class so
// a desktop-in-an-iPad-viewport can never be recorded as a real tablet/phone.
export function observedDeviceClass(env) {
  const ua = String(env.userAgent || "");
  const touch = env.maxTouchPoints || 0;
  // iPadOS 13+ desktop mode reports "Macintosh"; touch points disambiguate.
  if (/iPhone/.test(ua)) return "phone";
  if (/iPad/.test(ua)) return "tablet";
  if (/Macintosh/.test(ua) && touch > 1) return "tablet"; // iPad in desktop mode
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "phone" : "tablet";
  if (/Windows|Macintosh|Linux|CrOS/.test(ua)) return "desktop";
  return "unknown";
}

export function detectAttestationConflict(claimedClass, env) {
  if (!claimedClass || claimedClass === "unknown") return false;
  const obs = observedDeviceClass(env);
  if (obs === "unknown") return false;
  // A desktop OS can never be a physical tablet/phone; a touch tablet/phone can
  // never be a desktop. Tablet↔phone is left to the owner's label (both are touch
  // Safari and the UA is not always decisive).
  const desktop = (c) => c === "desktop";
  if (desktop(obs) && !desktop(claimedClass)) return true;
  if (!desktop(obs) && desktop(claimedClass)) return true;
  return false;
}

// ── Browser-side environment capture ────────────────────────────────────────

function glRenderer(win) {
  try {
    const c = win.document.createElement("canvas");
    const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
    if (!gl) return "NO_WEBGL";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch (e) {
    return "unknown";
  }
}

export function captureEnv(win, opts = {}) {
  const nav = win.navigator || {};
  const gl = glRenderer(win);
  const software = SOFTWARE_OR_GENERIC.test(String(gl));
  const env = {
    device_label: String(opts.device_label || "").trim() || "UNLABELLED — set device label!",
    device_class_claimed: opts.device_class_claimed || "unknown",
    cache: opts.cache || "unknown",
    network: opts.network || "unknown",
    userAgent: nav.userAgent || "unknown",
    platform: nav.platform || null,
    maxTouchPoints: nav.maxTouchPoints || 0,
    viewport: { w: win.innerWidth, h: win.innerHeight, dpr: win.devicePixelRatio || 1 },
    deviceMemoryGB: nav.deviceMemory || null,
    hardwareConcurrency: nav.hardwareConcurrency || null,
    gl_renderer: gl,
    gl_is_software: software,
    measuredAt: new Date().toISOString(),
  };
  env.observed_device_class = observedDeviceClass(env);
  return env;
}

export function paintTimings(win) {
  const out = { first_paint_ms: null, first_contentful_paint_ms: null };
  try {
    for (const e of win.performance.getEntriesByType("paint")) {
      if (e.name === "first-paint") out.first_paint_ms = Math.round(e.startTime);
      if (e.name === "first-contentful-paint") out.first_contentful_paint_ms = Math.round(e.startTime);
    }
  } catch (e) {}
  return out;
}

export function heapMB(win) {
  try {
    if (win.performance && win.performance.memory) return Math.round((win.performance.memory.usedJSHeapSize / 1048576) * 10) / 10;
  } catch (e) {}
  return null;
}

// ── App readiness & membership reads (operate on the APP iframe window) ──────

export const MADRID_CENTRE = Object.freeze({ lat: 40.415, lon: -3.692, zoom: 14, label: "Puerta del Sol / centro" });
export const RADII = Object.freeze({ DEFAULT_M: 900, MAX_M: 5000 });

function nextPaint(win) {
  return new Promise((resolve) => {
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve(win.performance.now())));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// True when the embedded app exposes the P0-a membership surface. A clean `main`
// baseline has the seam + map but NO membership (the feature is not merged), so
// the runner runs in BASELINE mode there: same interaction measures, freshness
// N/A (R5). Never ported into `main`; detected, not assumed.
export function detectBaselineMode(win) {
  const seam = win.__HALO_REGRESSION__;
  const hasMembership =
    !!seam && typeof seam.planningMembershipNow === "function" &&
    !!win.document.getElementById("planningMembership");
  return !hasMembership;
}

// Resolve when the embedded app has booted and is interactive. In feature mode it
// also waits for the planning artifacts (membership computable); in baseline mode
// it waits only for the map to be readable (mapView). Returns { barrier,
// baseline_mode, has_map_view }.
export async function waitForAppReady(win, timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = win.__HALO_REGRESSION__;
    if (s && (typeof s.mapView === "function" || typeof s.lensCenters === "function")) break;
    await sleep(100);
  }
  const seam = win.__HALO_REGRESSION__;
  if (!seam) {
    throw new Error(
      "Seam __HALO_REGRESSION__ not present. The app must be served from a loopback or private-LAN host AND loaded with ?haloRegressionTest=1."
    );
  }
  const baseline = detectBaselineMode(win);
  const hasMapView = typeof seam.mapView === "function";
  if (!baseline) {
    while (Date.now() - t0 < timeoutMs) {
      if (seam.planningMembershipNow() != null) {
        return { barrier: "planningMembershipNow() non-null (planningState=ready) + one settling frame", baseline_mode: false, has_map_view: hasMapView };
      }
      await sleep(150);
    }
    throw new Error("Planning artifacts did not load within timeout (planningMembershipNow() stayed null).");
  }
  // baseline: wait for a readable map centre
  while (Date.now() - t0 < timeoutMs) {
    try { const v = hasMapView ? seam.mapView() : null; if (v && isFinite(v.lat) && isFinite(v.lon)) break; } catch (e) {}
    if (!hasMapView && typeof seam.lensCenters === "function") break; // map-centre attribution unavailable; still boot-ready
    await sleep(150);
  }
  return { barrier: "baseline (pre-feature main): map readable; no membership surface", baseline_mode: true, has_map_view: hasMapView };
}

export function readRenderedMembership(appDoc) {
  const block = appDoc.getElementById("planningMembership");
  if (!block) return null;
  const count = appDoc.getElementById("planningMembershipCount");
  const chips = [...appDoc.querySelectorAll("#planningMembershipChips > li")].map((li) => ({
    code: li.querySelector(".planning-touched-code")?.textContent.trim() || null,
    containsCentre: Boolean(li.querySelector(".planning-touched-centre")),
  }));
  return {
    hidden: block.hidden,
    state: block.dataset.state || null,
    busy: block.getAttribute("aria-busy"),
    signature: block.dataset.signature || "",
    countText: count ? count.textContent.trim() : "",
    chips,
  };
}

// Freshness after settle: the displayed set EQUALS the canonical ambitosIntersecting
// set right now. Compares the DOM signature (whole set, code:containsCentre + lang)
// against the signature recomputed from the canonical model — exact, not just the
// visible ≤3 chips. Also asserts the block is not stuck in the "updating" state.
export function checkFreshness(appWin) {
  const seam = appWin.__HALO_REGRESSION__;
  // Baseline / pre-feature main: the membership surface does not exist, so
  // freshness is N/A, never a failure (R5).
  if (typeof seam.planningMembershipNow !== "function" || !appWin.document.getElementById("planningMembership")) {
    return { applicable: false, fresh: null, note: "N/A (pre-feature main baseline — no membership surface)" };
  }
  const canonical = seam.planningMembershipNow();
  const dom = readRenderedMembership(appWin.document);
  const lang = appWin.document.documentElement.lang;
  const expected = membershipSignature(canonical, lang);
  const fresh =
    dom != null &&
    dom.state !== "updating" &&
    dom.busy !== "true" &&
    dom.signature === expected;
  return {
    applicable: true,
    fresh,
    expected_signature: expected,
    dom_signature: dom ? dom.signature : null,
    dom_state: dom ? dom.state : null,
    canonical_count: canonical ? canonical.count : null,
    document_lang: lang,
  };
}

// ── Automated-sequence scenarios (production interaction path; NOT a gesture) ─

// Jitter the Lens centre within ~±150 m of Madrid centre so every sample keeps
// intersecting ámbitos (a representative, non-degenerate membership scan) while
// staying a "Madrid-centre position".
function jitterCentre(i, reps) {
  const theta = (i / reps) * 2 * Math.PI;
  const dLat = 0.0013 * Math.sin(theta); // ~145 m N/S
  const dLon = 0.0017 * Math.cos(theta); // ~145 m E/W at this latitude
  return { lat: MADRID_CENTRE.lat + dLat, lon: MADRID_CENTRE.lon + dLon };
}

export async function runAutomatedMarkerDrag(appWin, { radiusM, reps = 48, onProgress } = {}) {
  const seam = appWin.__HALO_REGRESSION__;
  seam.setActive("A");
  setSliderValue(appWin, radiusM);
  await nextPaint(appWin);
  seam.moveLensToLatLng("A", MADRID_CENTRE.lat, MADRID_CENTRE.lon);
  await nextPaint(appWin);

  const lat = [];
  const work = [];
  seam.beginPlanningMembershipInteraction(); // mirror a real drag: pending while moving
  for (let i = 0; i < reps; i++) {
    const p = jitterCentre(i, reps);
    const t0 = appWin.performance.now();
    seam.moveLensToLatLng("A", p.lat, p.lon); // synchronous production refresh()
    const w = appWin.performance.now() - t0;
    await nextPaint(appWin);
    lat.push(appWin.performance.now() - t0);
    work.push(w);
    if (onProgress) onProgress(i + 1, reps);
  }
  seam.endPlanningMembershipInteraction(); // settle to exact canonical set
  await nextPaint(appWin);
  const freshness = checkFreshness(appWin);
  return finishScenario(appWin, {
    scenario: `automated_marker_drag_r${radiusM}`,
    label: `Automated marker drag · r=${radiusM} m`,
    measurement_kind: "automated_sequence",
    interaction: "marker_drag",
    radiusM,
    reps,
    lat,
    work,
    freshness,
  });
}

export async function runAutomatedRadiusSweep(appWin, { reps = 48, onProgress } = {}) {
  const seam = appWin.__HALO_REGRESSION__;
  const slider = appWin.document.getElementById("radiusSlider");
  seam.setActive("A");
  seam.moveLensToLatLng("A", MADRID_CENTRE.lat, MADRID_CENTRE.lon);
  await nextPaint(appWin);

  const lat = [];
  const work = [];
  const min = RADII.DEFAULT_M, max = RADII.MAX_M;
  for (let i = 0; i < reps; i++) {
    // Sweep default→max→default so both endpoints (900 and 5000) are exercised.
    const frac = i / (reps - 1);
    const tri = frac <= 0.5 ? frac * 2 : (1 - frac) * 2;
    const value = Math.round((min + tri * (max - min)) / 50) * 50;
    const t0 = appWin.performance.now();
    slider.value = String(value);
    slider.dispatchEvent(new appWin.Event("input", { bubbles: true })); // production oninput → refresh()
    const w = appWin.performance.now() - t0;
    await nextPaint(appWin);
    lat.push(appWin.performance.now() - t0);
    work.push(w);
    if (onProgress) onProgress(i + 1, reps);
  }
  slider.dispatchEvent(new appWin.Event("change", { bubbles: true })); // production onchange → settle
  await nextPaint(appWin);
  const freshness = checkFreshness(appWin);
  return finishScenario(appWin, {
    scenario: "automated_radius_sweep",
    label: "Automated radius-slider sweep · 900↔5000 m",
    measurement_kind: "automated_sequence",
    interaction: "radius_slider",
    radiusRange: [RADII.DEFAULT_M, RADII.MAX_M],
    reps,
    lat,
    work,
    freshness,
  });
}

function setSliderValue(appWin, value) {
  const slider = appWin.document.getElementById("radiusSlider");
  slider.value = String(value);
  slider.dispatchEvent(new appWin.Event("input", { bubbles: true }));
  slider.dispatchEvent(new appWin.Event("change", { bubbles: true }));
}

// ── Actual-gesture capture (physical pointer/touch; the device-grade path) ────
//
// R3 — a generic pointermove/mousemove is NOT proof of a marker drag, radius
// change or map pan. Every sample is ATTRIBUTED to a genuine change in the
// production state the gesture is supposed to move:
//   marker drag   → the active Lens centre actually moved (seam.lensCenters)
//   radius drag   → the radius slider value actually changed
//   map pan       → the Leaflet map centre actually moved (seam.mapView)
// Idle/compatibility/background events change none of these and are excluded. A
// single physical move fires pointermove+mousemove(+touchmove) compatibility
// events; the capture listens to ONE source only, so those are not double-counted.
// If reliable attribution is impossible (seam getter absent, no input support, or
// nothing ever moved) the scenario is recorded NOT TESTED / INCOMPLETE — never a
// fabricated sample.

export const EPS_DEG = 1e-7; // ~1.1 cm — well below any real drag/pan step
export function lensAnyMoved(a, b) {
  if (!a || !b) return false;
  for (const k of ["A", "B"]) {
    if (!a[k] || !b[k]) continue;
    if (Math.abs(a[k].lat - b[k].lat) > EPS_DEG || Math.abs(a[k].lon - b[k].lon) > EPS_DEG) return true;
  }
  return false;
}
export function mapMoved(a, b) {
  if (!a || !b) return false;
  return Math.abs(a.lat - b.lat) > EPS_DEG || Math.abs(a.lon - b.lon) > EPS_DEG || a.zoom !== b.zoom;
}
function readRadius(appWin) {
  const el = appWin.document.getElementById("radiusSlider");
  return el ? Number(el.value) : null;
}
function readMapCentre(seam) {
  try { return typeof seam.mapView === "function" ? seam.mapView() : null; } catch (e) { return null; }
}
function chooseMoveEvent(appWin) {
  if (appWin.PointerEvent) return "pointermove";
  if ("ontouchstart" in appWin || (appWin.navigator && appWin.navigator.maxTouchPoints > 0)) return "touchmove";
  return "mousemove";
}
const isVisible = (appWin) => {
  try { return appWin.document.visibilityState === "visible"; } catch (e) { return true; }
};

export class GestureCapture {
  constructor(appWin, { interaction, minSamples = 40, onProgress } = {}) {
    this.appWin = appWin;
    this.interaction = interaction; // "marker_drag" | "radius_slider" | "pan"
    this.minSamples = minSamples;
    this.onProgress = onProgress;
    this.lat = [];            // double-rAF ITP samples (marker/radius), one per genuine move
    this.allFrames = [];      // every rAF delta while visible — DIAGNOSTIC, never graded for drag/radius
    this.activePanFrames = []; // rAF deltas during a VERIFIED active pan (map centre moving)
    this.totalMoveEvents = 0;
    this.genuineMoves = 0;
    this.excludedIdle = 0;
    this.excludedHidden = 0;
    this.error = null;
    this._running = false;
    this._rafId = null;
    this._lastFrame = 0;
    this._pendingPaint = false;
    this._lastCentre = null;
    this._lastRadius = null;
    this._lastMoveMap = null;
    this._lastFrameMap = null;
    this._onMove = this._onMove.bind(this);
    this._tick = this._tick.bind(this);
  }
  start() {
    const w = this.appWin;
    const seam = w.__HALO_REGRESSION__;
    // Fail closed if attribution is impossible for this interaction (R3).
    if (this.interaction === "marker_drag" && typeof seam.lensCenters !== "function") {
      this.error = "marker attribution unavailable (seam.lensCenters absent) — NOT TESTED";
    } else if (this.interaction === "radius_slider" && !w.document.getElementById("radiusSlider")) {
      this.error = "radius attribution unavailable (#radiusSlider absent) — NOT TESTED";
    } else if (this.interaction === "pan" && typeof seam.mapView !== "function") {
      this.error = "map-centre attribution unavailable (seam.mapView absent) — NOT TESTED";
    }
    this._moveSource = chooseMoveEvent(w);
    this._lastCentre = typeof seam.lensCenters === "function" ? seam.lensCenters() : null;
    this._lastRadius = readRadius(w);
    this._lastMoveMap = readMapCentre(seam);
    this._lastFrameMap = this._lastMoveMap;
    this._running = true;
    this._lastFrame = w.performance.now();
    this._rafId = w.requestAnimationFrame(this._tick);
    // ONE move source only (dedupe compatibility streams). passive — never
    // preventDefault, so the real gesture is never altered.
    this._target = w.document;
    this._target.addEventListener(this._moveSource, this._onMove, { capture: true, passive: true });
  }
  _onMove() {
    if (!this._running) return;
    this.totalMoveEvents += 1;
    const w = this.appWin;
    if (!isVisible(w)) { this.excludedHidden += 1; return; }
    const seam = w.__HALO_REGRESSION__;
    if (this.interaction === "pan") {
      // Pan attribution is per-frame (below); here just track genuine map motion
      // for the move-count transparency fields.
      const cur = readMapCentre(seam);
      if (mapMoved(this._lastMoveMap, cur)) { this.genuineMoves += 1; this._lastMoveMap = cur; }
      else this.excludedIdle += 1;
      return;
    }
    // marker drag / radius: verify the real production state actually changed.
    let changed = false;
    if (this.interaction === "marker_drag") {
      const cur = typeof seam.lensCenters === "function" ? seam.lensCenters() : null;
      if (lensAnyMoved(this._lastCentre, cur)) { changed = true; this._lastCentre = cur; }
    } else if (this.interaction === "radius_slider") {
      const r = readRadius(w);
      if (r != null && r !== this._lastRadius) { changed = true; this._lastRadius = r; }
    }
    if (!changed) { this.excludedIdle += 1; return; }
    this.genuineMoves += 1;
    if (this._pendingPaint) return; // one double-rAF sample in flight at a time
    this._pendingPaint = true;
    const t0 = w.performance.now();
    w.requestAnimationFrame(() =>
      w.requestAnimationFrame(() => {
        this.lat.push(w.performance.now() - t0);
        this._pendingPaint = false;
        this._report();
      })
    );
  }
  _tick(now) {
    if (!this._running) return;
    const w = this.appWin;
    const d = now - this._lastFrame;
    this._lastFrame = now;
    if (!isVisible(w)) { this.excludedHidden += 1; this._rafId = w.requestAnimationFrame(this._tick); return; }
    if (d > 0 && d < 2000) {
      this.allFrames.push(d);
      if (this.interaction === "pan") {
        // A frame counts as a PAN sample only if the map centre actually moved
        // across it — this scopes the pan-frame metric to the real pan interval
        // (and captures inertia frames the pointer stream does not).
        const cur = readMapCentre(w.__HALO_REGRESSION__);
        if (mapMoved(this._lastFrameMap, cur)) this.activePanFrames.push(d);
        this._lastFrameMap = cur;
      }
    }
    if (this.interaction === "pan") this._report();
    this._rafId = w.requestAnimationFrame(this._tick);
  }
  _report() {
    if (!this.onProgress) return;
    const samples = this.interaction === "pan" ? this.activePanFrames.length : this.lat.length;
    this.onProgress({ samples, frames: this.allFrames.length, moves: this.genuineMoves, totalMoves: this.totalMoveEvents, min: this.minSamples });
  }
  get enough() {
    const samples = this.interaction === "pan" ? this.activePanFrames.length : this.lat.length;
    return samples >= this.minSamples;
  }
  stop() {
    this._running = false;
    const w = this.appWin;
    if (this._rafId) w.cancelAnimationFrame(this._rafId);
    if (this._target) this._target.removeEventListener(this._moveSource, this._onMove, { capture: true });
    const attribution = {
      move_source: this._moveSource,
      total_move_events: this.totalMoveEvents,
      genuine_moves: this.genuineMoves,
      excluded_idle_events: this.excludedIdle,
      excluded_hidden: this.excludedHidden,
    };
    const idFor = { marker_drag: "actual_gesture_marker_drag", radius_slider: "actual_gesture_radius", pan: "actual_gesture_pan" };
    const labelFor = { marker_drag: "Actual gesture · marker drag", radius_slider: "Actual gesture · radius drag", pan: "Actual gesture · map pan" };
    const base = {
      scenario: idFor[this.interaction],
      label: labelFor[this.interaction],
      measurement_kind: "actual_gesture",
      interaction: this.interaction,
      attribution,
    };
    // Fail closed: attribution impossible, or nothing genuine ever moved. For a
    // pan, "genuine" is a VERIFIED active-pan frame (the map centre moved across
    // it) — not a pointer event — so inertia frames with no pointer stream still
    // count and a pointer wiggle that never pans the map does not.
    const genuine = this.interaction === "pan" ? this.activePanFrames.length > 0 : this.genuineMoves > 0;
    if (this.error) return finishScenario(w, { ...base, error: this.error, samples_ok: false });
    if (!genuine) {
      const why = this.interaction === "pan" ? "the map centre never moved" : "no Lens/radius change";
      return finishScenario(w, { ...base, error: `no genuine ${this.interaction} detected (${why}) — NOT TESTED`, samples_ok: false, activePanFrames: this.activePanFrames, allFrames: this.allFrames });
    }
    if (this.interaction === "pan") {
      return finishScenario(w, { ...base, activePanFrames: this.activePanFrames, allFrames: this.allFrames, samples_ok: this.activePanFrames.length >= this.minSamples });
    }
    return finishScenario(w, {
      ...base,
      lat: this.lat,
      allFrames: this.allFrames,
      freshness: checkFreshness(w),
      samples_ok: this.lat.length >= this.minSamples,
    });
  }
}

// ── Scenario assembly ────────────────────────────────────────────────────────

// Drop the first sample of a measured array as warm-up (R4) BEFORE any statistic
// is computed, so the reported n, median, p95 and max always recompute byte-for-
// byte from the stored `raw` and n === raw.length. Never post-trim `raw`.
export function dropWarm(arr) {
  return Array.isArray(arr) && arr.length > 1 ? arr.slice(1) : arr || [];
}
function summarizeChecked(arr, where) {
  const s = arr && arr.length ? summarize(arr) : null;
  if (s) assertStatsMatchRaw(s, where);
  return s;
}

function finishScenario(appWin, s) {
  const out = {
    scenario: s.scenario,
    label: s.label,
    measurement_kind: s.measurement_kind,
    interaction: s.interaction,
    recorded_at: new Date().toISOString(),
  };
  if (s.radiusM != null) out.radiusM = s.radiusM;
  if (s.radiusRange) out.radiusRange = s.radiusRange;
  if (s.reps != null) out.reps = s.reps;
  if (s.attribution) out.attribution = s.attribution;
  if (s.error) out.error = s.error;

  const metricKey = INTERACTION_METRIC[s.interaction];
  // R1 — metrics are SCOPED to the interaction. Marker/radius grade ONLY on
  // interaction-to-paint; pan grades ONLY on pan-frame time. The other metric is
  // null here so it can never be graded against the wrong threshold, and any
  // whole-window frame data for a drag/radius capture is a NAMED, non-graded
  // diagnostic (`capture_frame_ms_diagnostic`), never a map-pan benchmark.
  if (metricKey === "interaction_to_paint_ms") {
    out.interaction_to_paint_ms = summarizeChecked(dropWarm(s.lat), "interaction_to_paint_ms");
    out.interaction_to_paint_method = "double-rAF proxy (two frames), one sample per genuine move; frame-quantised; not a true paint timestamp; first sample dropped as warm-up";
    out.pan_frame_ms = null;
    if (s.allFrames && s.allFrames.length) {
      out.capture_frame_ms_diagnostic = summarizeChecked(dropWarm(s.allFrames), "capture_frame_ms_diagnostic");
      out.capture_frame_ms_diagnostic_note =
        "DIAGNOSTIC ONLY — whole-capture rAF frame deltas including non-gesture/idle intervals. NOT a map-pan benchmark and NOT graded against the 33.3 ms pan ceiling (R1). Interpret the dedicated map-pan scenario for that.";
    } else {
      out.capture_frame_ms_diagnostic = null;
    }
  } else if (metricKey === "pan_frame_ms") {
    out.pan_frame_ms = summarizeChecked(dropWarm(s.activePanFrames), "pan_frame_ms");
    out.pan_frame_note = "rAF frame deltas recorded ONLY while the map centre was actually moving (verified active-pan interval); first delta dropped as warm-up";
    out.interaction_to_paint_ms = null;
    out.active_pan_frames = s.activePanFrames ? s.activePanFrames.length : 0;
    out.total_frames = s.allFrames ? s.allFrames.length : 0;
    if (s.allFrames && s.allFrames.length) {
      out.capture_frame_ms_diagnostic = summarizeChecked(dropWarm(s.allFrames), "capture_frame_ms_diagnostic");
      out.capture_frame_ms_diagnostic_note = "DIAGNOSTIC — all visible frames in the capture window (active + idle), for context only; the graded metric is pan_frame_ms over the active-pan interval.";
    }
  }

  // script_work only exists for automated sequences (the synchronous production
  // call time). Actual gestures do not own the call, so it is null there.
  out.script_work_ms = summarizeChecked(dropWarm(s.work), "script_work_ms");
  out.script_work_note =
    s.measurement_kind === "automated_sequence"
      ? "synchronous wall time of the production interaction call (moveLensToLatLng / slider oninput → refresh()); first sample dropped as warm-up"
      : "not captured for an actual gesture (the app owns the call; only interaction-to-paint and frame time are observed)";

  // Freshness: required for marker/radius in feature mode; N/A for a pan (the Lens
  // does not move) and for a pre-feature main baseline (R5).
  if (s.freshness) out.freshness = s.freshness;
  else if (s.interaction === "pan") out.freshness = { applicable: false, fresh: null, note: "N/A — a map pan does not move the Lens; membership is unchanged" };
  else out.freshness = null;

  out.js_heap_mb = heapMB(appWin);
  if (s.samples_ok != null) out.samples_ok = s.samples_ok;
  else {
    // Automated sequences do not pass an explicit count: ≥40 valid samples in the
    // scored metric after warm-up exclusion.
    const scored = metricKey ? out[metricKey] : null;
    out.samples_ok = (scored && scored.n ? scored.n : 0) >= 40;
  }
  return out;
}

// Build the final consolidated report object for download.
//
// R2 — the global verdict is PASS only when ALL THREE required actual-gesture
// scenarios (marker drag, radius drag, map pan) are present, correctly attributed,
// device-grade, sufficiently sampled, within their OWN threshold, and (for
// drag/radius) fresh after settle. Missing or under-sampled scenarios, missing
// scored metrics, or a failed freshness → INCOMPLETE / FAIL, never PASS, and never
// excused by the automated sequences.
//
// R5 — in a pre-feature `main` baseline (`baselineMode`) there is no membership,
// so freshness is N/A and the report is a BASELINE, not an AC-P0-12 gate verdict.
export function buildReport({ env, thresholds, scenarios, testCommit, deviceClass, baselineMode = false, comparisonStatus = null }) {
  const graded = scenarios.map((s) => ({ ...s, grade: gradeScenario(s, thresholds) }));
  const actual = graded.filter((s) => s.measurement_kind === "actual_gesture");
  const conflict = detectAttestationConflict(deviceClass, env);

  // Exactly the three required scenario ids, de-duplicated (a re-run overwrites).
  const byId = new Map();
  for (const s of actual) byId.set(s.scenario, s);
  const present = REQUIRED_ACTUAL_SCENARIOS.filter((id) => byId.has(id));
  const missing = REQUIRED_ACTUAL_SCENARIOS.filter((id) => !byId.has(id));
  const presentScenarios = present.map((id) => byId.get(id));
  const errored = presentScenarios.filter((s) => s.error);
  const underSampled = presentScenarios.filter((s) => s.samples_ok === false);
  const ungraded = presentScenarios.filter((s) => !s.grade.graded && !s.error);
  const allThree = missing.length === 0;
  const allGraded = allThree && presentScenarios.every((s) => s.grade.graded);
  const allPass = allThree && presentScenarios.every((s) => s.grade.pass);
  const allSampled = allThree && presentScenarios.every((s) => s.samples_ok !== false);

  const dg = deviceGradeFor(env, {
    label: env.device_label,
    measurement_kind: present.length ? "actual_gesture" : "automated_sequence",
    samples_ok: allSampled,
    attestation_conflict: conflict,
  });

  let verdict, verdict_reason;
  if (baselineMode) {
    const status = comparisonStatus || (dg.basis.gl_is_software ? "COMPARISON UNAVAILABLE" : "BASELINE RECORDED");
    verdict = `BASELINE (main) — ${status}`;
    verdict_reason =
      "Pre-feature main baseline: membership freshness is N/A and this is NOT an AC-P0-12 gate verdict. Compare its interaction-to-paint / pan-frame against the PR run; do not infer causation from either run alone.";
  } else if (conflict) {
    verdict = "REFUSED — ATTESTATION CONFLICT";
    verdict_reason = `The observed environment (${env.observed_device_class}) contradicts the declared device class (${deviceClass}); not recorded as a device validation.`;
  } else if (!allThree) {
    verdict = "INCOMPLETE — MISSING REQUIRED SCENARIOS";
    verdict_reason = `AC-P0-12 needs all three actual-gesture scenarios. Missing: ${missing.join(", ") || "none"}. Automated sequences do not substitute.`;
  } else if (errored.length) {
    verdict = "INCOMPLETE — SCENARIO NOT TESTED";
    verdict_reason = `A required scenario could not be attributed to a genuine interaction: ${errored.map((s) => `${s.scenario} (${s.error})`).join("; ")}.`;
  } else if (ungraded.length) {
    verdict = "INCOMPLETE — METRIC MISSING";
    verdict_reason = `A required scenario is missing its scored metric: ${ungraded.map((s) => s.scenario).join(", ")}.`;
  } else if (underSampled.length) {
    verdict = "INCOMPLETE — INSUFFICIENT SAMPLES";
    verdict_reason = `Below the sample target: ${underSampled.map((s) => s.scenario).join(", ")}. Keep the gesture going longer and re-run.`;
  } else if (!dg.device_grade) {
    verdict = "NOT DEVICE-GRADE";
    verdict_reason = "The environment did not certify as device-grade (software GPU or missing label). See device_grade.basis.";
  } else {
    verdict = allPass ? "PASS (this device)" : "FAIL (this device)";
    verdict_reason = allPass
      ? "All three actual-gesture scenarios are within their AC-P0-12 thresholds (marker/radius ≤150 ms interaction-to-paint + fresh after settle; map pan ≤33.3 ms frame p95), device-grade, ≥ sample target."
      : "At least one actual-gesture scenario exceeded its threshold or failed freshness. AC-P0-12 → HOLD / redesign for this device class.";
  }

  return {
    tool: "AC-P0-12 device-validation runner (research/ac_p0_12)",
    acceptance_criterion: "AC-P0-12 — interaction latency (marker/radius) + pan-frame time (map pan) + membership freshness after drag/radius settle",
    measures: baselineMode
      ? "a clean pre-feature main baseline (same interaction measures; NO P0-a membership) via the opt-in __HALO_REGRESSION__ seam"
      : "the REAL PR #96 production application (index.html + js/app.js) via the opt-in __HALO_REGRESSION__ seam",
    honesty:
      "Metrics are SCOPED per interaction: marker/radius graded on double-rAF interaction-to-paint only; map pan graded on rAF frame p95 over the verified active-pan interval only. Whole-capture frame deltas for a drag/radius window are a named diagnostic, never the map-pan ceiling. Every sample is attributed to a genuine Lens/radius/map change; idle and compatibility events are excluded. n equals raw.length and every stat recomputes from raw. actual_gesture and automated_sequence are reported separately and NEVER equated; a PASS requires all three actual_gesture scenarios.",
    test_commit: testCommit || null,
    declared_device_class: deviceClass || "unknown",
    baseline_mode: baselineMode,
    required_actual_scenarios: REQUIRED_ACTUAL_SCENARIOS,
    present_actual_scenarios: present,
    missing_actual_scenarios: missing,
    env,
    device_grade: dg,
    thresholds: thresholds.thresholds || thresholds,
    scenarios: graded,
    verdict,
    verdict_reason,
    generatedAt: new Date().toISOString(),
  };
}
