/*
 * K12 device harness — Real User Monitoring (RUM) measurement engine.
 *
 * Renderer-agnostic. Each harness page supplies callbacks; this module drives a
 * reproducible interaction sequence and records the metrics defined in
 * thresholds.json. It runs identically under Playwright on a laptop (real Chrome)
 * and manually in iPad Safari — the SAME page, so device and emulation never get
 * confused: the result records navigator.userAgent, devicePixelRatio,
 * deviceMemory, hardwareConcurrency and a caller-supplied device_label.
 *
 * It measures wall-clock interaction-to-paint (via double-rAF) and frame times
 * during a pan. On a software-rasterising host (e.g. a cloud VM with SwiftShader)
 * these numbers are NOT representative of device GPU performance — the runner
 * stamps every result with the detected GL renderer so a reader can tell.
 *
 * THROWAWAY research harness — not referenced by index.html, css/ or js/.
 */
(function (global) {
  "use strict";

  function nextPaint() {
    // double requestAnimationFrame ≈ "work submitted, next frame composited"
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())));
    });
  }

  function stats(samples) {
    if (!samples.length) return null;
    const s = [...samples].sort((a, b) => a - b);
    const pct = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    const r = (x) => Math.round(x * 100) / 100;
    return { n: s.length, min: r(s[0]), median: r(pct(50)), p95: r(pct(95)), max: r(s[s.length - 1]), mean: r(mean), raw: s.map(r) };
  }

  function glRenderer() {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
      if (!gl) return "NO_WEBGL";
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    } catch (e) {
      return "unknown";
    }
  }

  function env(opts) {
    const nav = global.navigator || {};
    const gl = glRenderer();
    const software = /swiftshader|software|llvmpipe|microsoft basic/i.test(String(gl));
    return {
      device_label: opts.device_label || "UNLABELLED — set device_label!",
      cache: opts.cache || "unknown",
      network: opts.network || "unknown",
      userAgent: nav.userAgent || "unknown",
      viewport: { w: global.innerWidth, h: global.innerHeight, dpr: global.devicePixelRatio || 1 },
      deviceMemoryGB: nav.deviceMemory || null,
      hardwareConcurrency: nav.hardwareConcurrency || null,
      gl_renderer: gl,
      gl_is_software: software,
      is_device_grade: !software,
      measuredAt: new Date().toISOString(),
    };
  }

  function paintTimings() {
    const out = { first_paint_ms: null, first_contentful_paint_ms: null };
    try {
      for (const e of performance.getEntriesByType("paint")) {
        if (e.name === "first-paint") out.first_paint_ms = Math.round(e.startTime);
        if (e.name === "first-contentful-paint") out.first_contentful_paint_ms = Math.round(e.startTime);
      }
    } catch (e) {}
    return out;
  }

  function heapMB() {
    try {
      if (performance.memory) return Math.round((performance.memory.usedJSHeapSize / 1048576) * 10) / 10;
    } catch (e) {}
    return null;
  }

  // Drive one scenario. See file header for the callback contract.
  async function run(opts) {
    const started = performance.now();
    const result = {
      spike: "K12 runtime decision",
      scenario: opts.scenario || "unnamed",
      renderer: opts.renderer || "unknown",
      env: env(opts),
      thresholds_ref: "device_harness/thresholds.json",
    };

    // TTI: time until the page reports the map is interactive.
    const tReadyStart = performance.now();
    if (opts.ready) await opts.ready();
    // NOTE: this is NOT the Lighthouse "Time To Interactive" metric (main-thread
    // quiet-window). It is the wall time from run() start until the page's
    // ready() callback resolves — i.e. data fetched/parsed + layers built + one
    // settling frame. Named map_ready_ms to avoid the loaded TTI term.
    result.map_ready_ms = Math.round(performance.now() - tReadyStart);
    Object.assign(result, paintTimings());
    result.paint_note =
      "first_contentful_paint_ms is the Paint Timing API FCP of THIS harness page " +
      "(HTML+CSS+vendored Leaflet / MapLibre JS), a proxy for the app's static-shell FCP; " +
      "it does not include the production app's full script graph.";

    // recompute_mode: "renderer" moves only the Lens overlay (renderer-only
    // latency); "full" also runs the production analytical recompute each step
    // (licencesInLens + ámbito intersect) — the full Lens interaction latency.
    result.recompute_mode = opts.recompute_mode || "renderer";

    // Interaction latency: scripted Lens-drag steps.
    //   interaction_to_paint_ms is a DOUBLE-rAF PROXY: time from the state
    //   mutation until the callback of the SECOND rAF runs (i.e. after the
    //   intervening frame was composited). It is NOT a true paint timestamp
    //   (that needs the Event Timing / LoAF APIs) and it is frame-quantised, so
    //   on an idle/fast path it floors near one frame interval. The synchronous
    //   analytical work is captured SEPARATELY as interaction_recompute_ms when
    //   interactionStep returns its measured work time.
    if (opts.interactionStep) {
      const reps = opts.reps || 40;
      const lat = [];
      const work = [];
      for (let i = 0; i < reps; i++) {
        const t0 = performance.now();
        const w = opts.interactionStep(i, reps);
        await nextPaint();
        lat.push(performance.now() - t0);
        if (typeof w === "number" && isFinite(w)) work.push(w);
      }
      result.interaction_to_paint_ms = stats(lat);
      result.interaction_to_paint_method = "double-rAF proxy (two frames); frame-quantised; not a true paint timestamp";
      result.interaction_recompute_ms = work.length ? stats(work) : null;
      result.interaction_recompute_note =
        result.recompute_mode === "full"
          ? "synchronous production analytical recompute (licencesInLens + ámbito intersect) per step"
          : "renderer-only: no analytical recompute measured (move the Lens overlay only)";
    }

    // Pan: record frame deltas while the page runs a programmatic pan.
    if (opts.pan) {
      const frames = [];
      let last = performance.now();
      let running = true;
      const tick = () => {
        const now = performance.now();
        frames.push(now - last);
        last = now;
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      await opts.pan();
      running = false;
      frames.shift(); // drop the first (warm) delta
      result.pan_frame_ms = stats(frames);
    }

    result.js_heap_mb = heapMB();
    result.total_harness_ms = Math.round(performance.now() - started);
    global.__K12__ = result;
    renderButton(result);
    return result;
  }

  function renderButton(result) {
    try {
      const pre = document.createElement("pre");
      pre.style.cssText = "position:fixed;right:8px;bottom:8px;max-width:46ch;max-height:60vh;overflow:auto;background:#0b1320ee;color:#cfe;padding:10px;font:11px/1.4 monospace;z-index:99999;border:1px solid #2a3b55;border-radius:6px";
      pre.textContent = JSON.stringify(result, null, 2);
      const btn = document.createElement("button");
      btn.textContent = "⬇ download JSON";
      btn.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:100000";
      btn.onclick = () => {
        const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `k12_${result.renderer}_${result.scenario}.json`;
        a.click();
      };
      document.body.appendChild(pre);
      document.body.appendChild(btn);
      btn.onclick = btn.onclick; // keep
      pre.addEventListener("dblclick", () => pre.remove());
    } catch (e) {}
  }

  global.K12RUM = { run, stats, nextPaint, glRenderer };
})(typeof window !== "undefined" ? window : globalThis);
