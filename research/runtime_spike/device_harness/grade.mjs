// K12 device-harness — device-grade + completeness predicates (pure, testable).
//
// Extracted from run_device.mjs so the FAIL-CLOSED logic can be unit-tested
// (tests/device_grade.test.mjs) without launching a browser.
//
// Device-grade is granted ONLY when hardware identity is positively verified.
// It fails closed on software/NO_WEBGL/generic renderers, on the bundled
// headless Chromium, and on a missing human label.

export const REQUIRED_METRICS = ["interaction_to_paint_ms", "pan_frame_ms", "first_contentful_paint_ms"];

// A real hardware GPU names a vendor. Absent a vendor token, identity is
// unverified → not device-grade.
export const GPU_VENDOR =
  /(apple|nvidia|geforce|amd|radeon|intel|iris|adreno|mali|powervr|qualcomm|vivante|videocore|m1|m2|m3|a1[0-9]|a[0-9]{2}\sgpu)/i;
export const SOFTWARE_OR_GENERIC =
  /(swiftshader|llvmpipe|software|microsoft basic|mesa offscreen|^no_webgl$|^unknown$|^$)/i;

export function scenarioComplete(r) {
  if (!r || r.error) return { ok: false, why: r?.error || "no result" };
  const missing = REQUIRED_METRICS.filter((k) => r[k] === undefined || r[k] === null);
  if (missing.length) return { ok: false, why: `missing metrics: ${missing.join(",")}` };
  if (!r.readiness_barrier) return { ok: false, why: "no readiness_barrier recorded" };
  return { ok: true };
}

// deviceGradeOf — fails closed. opts: { label, channel, headed }.
export function deviceGradeOf(result, opts = {}) {
  const e = (result && result.env) || {};
  const gl = String(e.gl_renderer || "").trim();
  const label = opts.label || "";
  const channel = opts.channel || "chromium";
  const headed = Boolean(opts.headed);

  const software = Boolean(e.gl_is_software) || SOFTWARE_OR_GENERIC.test(gl);
  const hasVendorToken = GPU_VENDOR.test(gl);
  const hasRealGpu = !software && hasVendorToken;
  const hasLabel = Boolean(label) && !/container|unlabelled/i.test(label);
  const hasUA = Boolean(e.userAgent) && e.userAgent !== "unknown";
  const realChannel = channel === "chrome" || channel === "msedge";

  const basis = {
    gl_renderer: gl,
    gl_is_software: software,
    has_gpu_vendor_token: hasVendorToken,
    has_real_gpu: hasRealGpu,
    has_human_label: hasLabel,
    has_ua: hasUA,
    channel,
    headed,
    real_browser_channel: realChannel,
  };
  return { device_grade: hasRealGpu && hasLabel && hasUA && realChannel && headed, basis };
}
