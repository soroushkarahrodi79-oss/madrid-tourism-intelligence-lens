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

// Pass/fail of ONE scenario against thresholds.json. p95 at or below `acceptable`
// passes; at or below `good` is additionally flagged "good". Missing metric = no
// verdict for that metric (never a silent pass).
export function gradeScenario(scenario, thresholds) {
  const t = thresholds.thresholds || thresholds;
  const checks = [];
  const itp = scenario.interaction_to_paint_ms;
  if (itp && typeof itp.p95 === "number") {
    const acc = t.interaction_to_paint_ms.acceptable_p95;
    const good = t.interaction_to_paint_ms.good_p95;
    checks.push({ metric: "interaction_to_paint_ms.p95", value: itp.p95, acceptable: acc, good, pass: itp.p95 <= acc, is_good: itp.p95 <= good });
  }
  const pan = scenario.pan_frame_ms;
  if (pan && typeof pan.p95 === "number") {
    const acc = t.pan_frame_ms.acceptable_p95;
    const good = t.pan_frame_ms.good_p95;
    checks.push({ metric: "pan_frame_ms.p95", value: pan.p95, acceptable: acc, good, pass: pan.p95 <= acc, is_good: pan.p95 <= good });
  }
  const graded = checks.length > 0;
  const metricsPass = checks.every((c) => c.pass);
  // Freshness, when the scenario checked it, is part of the scenario's pass.
  const freshnessOk = scenario.freshness == null ? true : scenario.freshness.fresh === true;
  const enough = scenario.samples_ok !== false;
  return {
    graded,
    checks,
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

// Resolve when the embedded production app has booted AND the planning artifacts
// are loaded (membership is computable). Returns the readiness barrier string.
export async function waitForAppReady(win, timeoutMs = 60000) {
  const t0 = Date.now();
  // 1. seam present (app.js evaluated under ?haloRegressionTest=1 on a permitted host)
  while (Date.now() - t0 < timeoutMs) {
    if (win.__HALO_REGRESSION__ && typeof win.__HALO_REGRESSION__.planningMembershipNow === "function") break;
    await sleep(100);
  }
  const seam = win.__HALO_REGRESSION__;
  if (!seam || typeof seam.planningMembershipNow !== "function") {
    throw new Error(
      "Seam __HALO_REGRESSION__ not present. The app must be served from a loopback or private-LAN host AND loaded with ?haloRegressionTest=1."
    );
  }
  // 2. planning artifacts loaded (membership computable). planningMembershipNow()
  //    returns null until planningState === "ready".
  while (Date.now() - t0 < timeoutMs) {
    if (seam.planningMembershipNow() != null) return "planningMembershipNow() non-null (planningState=ready) + one settling frame";
    await sleep(150);
  }
  throw new Error("Planning artifacts did not load within timeout (planningMembershipNow() stayed null).");
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

// A live capture session the owner drives with a real finger/pointer. It records,
// on the APP window: (1) a double-rAF interaction-to-paint sample scheduled on
// each real pointer/touch move, and (2) every rAF frame delta for the pan-frame
// distribution. Stop when enough samples are collected (or on timeout).
export class GestureCapture {
  constructor(appWin, { interaction, minSamples = 40, onProgress } = {}) {
    this.appWin = appWin;
    this.interaction = interaction; // "marker_drag" | "radius_slider" | "pan"
    this.minSamples = minSamples;
    this.onProgress = onProgress;
    this.lat = [];
    this.frames = [];
    this.moveEvents = 0;
    this._running = false;
    this._rafId = null;
    this._lastFrame = 0;
    this._pendingPaint = false;
    this._onMove = this._onMove.bind(this);
    this._tick = this._tick.bind(this);
  }
  start() {
    const w = this.appWin;
    this._running = true;
    this._lastFrame = w.performance.now();
    this._rafId = w.requestAnimationFrame(this._tick);
    // Capture-phase listeners so we see the real gesture even if the app also
    // handles it. passive:true — we never preventDefault, so we never alter the
    // gesture. pointermove covers mouse+touch+pen; touchmove is a Safari fallback.
    const target = w.document;
    this._target = target;
    target.addEventListener("pointermove", this._onMove, { capture: true, passive: true });
    target.addEventListener("touchmove", this._onMove, { capture: true, passive: true });
    target.addEventListener("mousemove", this._onMove, { capture: true, passive: true });
  }
  _onMove() {
    if (!this._running) return;
    this.moveEvents += 1;
    // For pan, frame deltas are the metric; for drag/radius we also want itp.
    if (this.interaction !== "pan" && !this._pendingPaint) {
      this._pendingPaint = true;
      const w = this.appWin;
      const t0 = w.performance.now();
      w.requestAnimationFrame(() =>
        w.requestAnimationFrame(() => {
          this.lat.push(w.performance.now() - t0);
          this._pendingPaint = false;
          this._report();
        })
      );
    } else if (this.interaction === "pan") {
      this._report();
    }
  }
  _tick(now) {
    if (!this._running) return;
    const d = now - this._lastFrame;
    this._lastFrame = now;
    if (d > 0 && d < 2000) this.frames.push(d); // drop absurd gaps (tab blur)
    this._rafId = this.appWin.requestAnimationFrame(this._tick);
  }
  _report() {
    if (!this.onProgress) return;
    const primary = this.interaction === "pan" ? this.frames.length : this.lat.length;
    this.onProgress({ samples: primary, frames: this.frames.length, moves: this.moveEvents, min: this.minSamples });
  }
  get enough() {
    const primary = this.interaction === "pan" ? this.frames.length : this.lat.length;
    return primary >= this.minSamples;
  }
  stop() {
    this._running = false;
    const w = this.appWin;
    if (this._rafId) w.cancelAnimationFrame(this._rafId);
    this._target.removeEventListener("pointermove", this._onMove, { capture: true });
    this._target.removeEventListener("touchmove", this._onMove, { capture: true });
    this._target.removeEventListener("mousemove", this._onMove, { capture: true });
    // Pan has no interaction-to-paint (it is a continuous animation, not a
    // discrete recompute), so the frames ARE the metric. Drag/radius report both.
    const common = { moveEvents: this.moveEvents, frames: this.frames };
    if (this.interaction === "pan") {
      return finishScenario(w, {
        scenario: "actual_gesture_pan",
        label: "Actual gesture · map pan",
        measurement_kind: "actual_gesture",
        interaction: "pan",
        lat: null,
        work: null,
        frames: this.frames,
        samples_ok: this.frames.length >= this.minSamples,
      });
    }
    const freshness = checkFreshness(w);
    return finishScenario(w, {
      scenario: this.interaction === "radius_slider" ? "actual_gesture_radius" : "actual_gesture_marker_drag",
      label: this.interaction === "radius_slider" ? "Actual gesture · radius drag" : "Actual gesture · marker drag",
      measurement_kind: "actual_gesture",
      interaction: this.interaction,
      lat: this.lat,
      work: null,
      frames: this.frames,
      freshness,
      samples_ok: this.lat.length >= this.minSamples,
      ...common,
    });
  }
}

// ── Scenario assembly ────────────────────────────────────────────────────────

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
  if (s.moveEvents != null) out.move_events = s.moveEvents;
  out.interaction_to_paint_ms = s.lat && s.lat.length ? summarize(s.lat) : null;
  out.interaction_to_paint_method = "double-rAF proxy (two frames); frame-quantised; not a true paint timestamp";
  out.script_work_ms = s.work && s.work.length ? summarize(s.work) : null;
  out.script_work_note =
    s.measurement_kind === "automated_sequence"
      ? "synchronous wall time of the production interaction call (moveLensToLatLng / slider oninput → refresh())"
      : "not captured for an actual gesture (the app owns the call; only interaction-to-paint and frame time are observed)";
  out.pan_frame_ms = s.frames && s.frames.length ? summarize(s.frames) : null;
  out.pan_frame_note = "rAF frame deltas on the app window during the pan window; first delta dropped as warm";
  if (s.frames && s.frames.length) out.pan_frame_ms.raw = out.pan_frame_ms.raw.slice(1); // drop warm frame
  out.freshness = s.freshness || null;
  out.js_heap_mb = heapMB(appWin);
  const samplesOk =
    s.samples_ok != null
      ? s.samples_ok
      : s.interaction === "pan"
      ? (out.pan_frame_ms?.n || 0) >= 40
      : (out.interaction_to_paint_ms?.n || 0) >= 40;
  out.samples_ok = samplesOk;
  return out;
}

// Build the final consolidated report object for download.
export function buildReport({ env, thresholds, scenarios, testCommit, deviceClass }) {
  const graded = scenarios.map((s) => ({ ...s, grade: gradeScenario(s, thresholds) }));
  const actual = graded.filter((s) => s.measurement_kind === "actual_gesture");
  const conflict = detectAttestationConflict(deviceClass, env);
  const anyActual = actual.length > 0;
  const allActualGraded = anyActual && actual.every((s) => s.grade.graded);
  const allActualPass = anyActual && actual.every((s) => s.grade.pass);
  const minSamplesOk = anyActual && actual.every((s) => s.samples_ok !== false);
  const dg = deviceGradeFor(env, {
    label: env.device_label,
    measurement_kind: anyActual ? "actual_gesture" : "automated_sequence",
    samples_ok: minSamplesOk,
    attestation_conflict: conflict,
  });
  // The runner NEVER declares AC-P0-12 PASS from automated proxies alone, and
  // never from a non-device-grade environment. PASS is only reached when every
  // actual-gesture scenario is device-grade, graded, within thresholds, fresh,
  // and backed by ≥40 samples. Otherwise the verdict is explicit about why.
  let verdict, verdict_reason;
  if (!anyActual) {
    verdict = "INCOMPLETE — NO ACTUAL-GESTURE RUN";
    verdict_reason =
      "Only automated-sequence proxies were recorded. AC-P0-12 requires a physical pointer/touch gesture on the declared device; run the Actual gesture captures.";
  } else if (conflict) {
    verdict = "REFUSED — ATTESTATION CONFLICT";
    verdict_reason = `The observed environment (${env.observed_device_class}) contradicts the declared device class (${deviceClass}); not recorded as a device validation.`;
  } else if (!dg.device_grade) {
    verdict = "NOT DEVICE-GRADE";
    verdict_reason = "The environment did not certify as device-grade (software GPU, missing label, or too few samples). See device_grade.basis.";
  } else if (!allActualGraded) {
    verdict = "INCOMPLETE — METRICS MISSING";
    verdict_reason = "An actual-gesture scenario is missing a required metric (interaction-to-paint and/or pan frame time).";
  } else {
    verdict = allActualPass ? "PASS (this device)" : "FAIL (this device)";
    verdict_reason = allActualPass
      ? "Every actual-gesture scenario is within the AC-P0-12 thresholds, fresh after settle, device-grade, ≥40 samples."
      : "At least one actual-gesture scenario exceeded a threshold or failed freshness. AC-P0-12 → HOLD / redesign for this device class.";
  }
  return {
    tool: "AC-P0-12 device-validation runner (research/ac_p0_12)",
    acceptance_criterion: "AC-P0-12 — interaction latency + pan-frame + membership freshness after drag/radius settle",
    measures: "the REAL PR #96 production application (index.html + js/app.js) via the opt-in __HALO_REGRESSION__ seam",
    honesty:
      "interaction_to_paint_ms is a double-rAF proxy (frame-quantised, not a true paint timestamp); script_work_ms is the synchronous production call time; pan_frame_ms is rAF frame deltas. actual_gesture and automated_sequence are reported separately and NEVER equated; a PASS requires actual_gesture runs.",
    test_commit: testCommit || null,
    declared_device_class: deviceClass || "unknown",
    env,
    device_grade: dg,
    thresholds: thresholds.thresholds || thresholds,
    scenarios: graded,
    verdict,
    verdict_reason,
    generatedAt: new Date().toISOString(),
  };
}
