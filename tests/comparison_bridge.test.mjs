import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildHaloComparison,
  buildCountPairState,
  buildComparisonBridgeModel,
  buildHaloGlyphSpec,
  bridgeSideEvidence,
  BRIDGE_METRIC_IDS,
  HALO_METRICS,
  COMPARISON_RADIUS_MODE,
  circleAreaKm2,
} from "../js/radial-halo.js";

// The Comparison Bridge is the FOCUSED reading of one metric. These tests pin
// its SEMANTICS (not formatted HTML): per-side evidence, whether a B − A delta
// exists, its numeric value/kind, and the withheld reason when it does not. The
// model reads the same authoritative state objects the panel table renders, so
// the two can never disagree — the final assertions make that explicit.

const REFS = Object.freeze({ tourism: 8, stays: 8, mobility: 8, radiusM: 900, quantile: 0.95 });
const BAND = Object.freeze({ min: 30, max: 46 });
const live = (value) => ({ value, sourceState: "live" });
const unavailable = () => ({ value: null, sourceState: "unavailable" });

const baseInput = (overrides = {}) => ({
  references: REFS, utciBand: BAND, radii: { A: 900, B: 900 },
  radiusMode: COMPARISON_RADIUS_MODE.EQUAL, aoiState: "not-required",
  tourism: { a: live(17), b: live(26) },
  stays: { a: live(2), b: live(4) },
  mobility: { a: live(3), b: live(6) },
  utci: {
    enabled: true, timestepA: "15:00", timestepB: "15:00",
    a: { evidence: "MODEL-DERIVED", mean: 36.4, count: 2 },
    b: { evidence: "MODEL-DERIVED", mean: 38.1, count: 3 },
  },
  ...overrides,
});

function bridgeFor(metricId, input, { mobilityPairMode } = {}) {
  const comparison = buildHaloComparison(input);
  const radiusMode = input.radiusMode;
  // Mobility in the panel/Bridge uses the pair-state (withholds under unequal
  // windows), exactly as renderCompare() wires it — not the halo density state.
  const state = metricId === "mobility"
    ? buildCountPairState(input.mobility.a, input.mobility.b, mobilityPairMode || radiusMode)
    : comparison.metrics[metricId];
  return { model: buildComparisonBridgeModel({ metricId, state, radiusMode, radii: input.radii }), state };
}

// --- A: valid equal-radius count comparison --------------------------------
test("A valid equal-radius count comparison yields a raw-count B − A", () => {
  const { model, state } = bridgeFor("tourism", baseInput());
  assert.equal(model.metricId, "tourism");
  assert.equal(model.a.evidence, "VALID");
  assert.equal(model.b.evidence, "VALID");
  assert.equal(model.a.valueText, "17");
  assert.equal(model.b.valueText, "26");
  assert.equal(model.relationship.comparable, true);
  assert.equal(model.relationship.deltaKind, "count");
  assert.equal(model.relationship.basisCode, "raw-counts");
  assert.equal(model.relationship.deltaValue, 9);
  assert.equal(model.relationship.deltaValue, state.delta, "Bridge delta IS the table state's delta");
});

// --- B: unequal-radius Tourism via represented-record density ---------------
test("B unequal-radius Tourism compares by represented-record density, not raw counts", () => {
  const input = baseInput({ radii: { A: 600, B: 1200 }, radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, aoiState: "eligible", tourism: { a: live(17), b: live(26) } });
  const { model, state } = bridgeFor("tourism", input);
  assert.equal(model.relationship.comparable, true);
  assert.equal(model.relationship.deltaKind, "density");
  assert.equal(model.relationship.basisCode, "density");
  // Density surfaced per side, and the raw counts are still carried.
  const rateA = 17 / circleAreaKm2(600);
  const rateB = 26 / circleAreaKm2(1200);
  assert.ok(Math.abs(model.a.densityValue - rateA) < 1e-9);
  assert.ok(Math.abs(model.b.densityValue - rateB) < 1e-9);
  assert.equal(model.a.rawValue, 17);
  assert.equal(model.b.rawValue, 26);
  assert.ok(Math.abs(model.relationship.deltaValue - (rateB - rateA)) < 1e-9);
  assert.equal(model.relationship.deltaValue, state.delta);
  // Smaller window, same raw count, higher density → the density delta is NOT
  // the raw difference of 9.
  assert.notEqual(model.relationship.deltaValue, 9);
});

// --- C: unequal-radius comparison withheld because AOI conditions fail ------
test("C unequal-radius Tourism withholds its delta when the AOI condition fails", () => {
  for (const [aoiState, reason] of [["crosses", "aoi-crosses"], ["outside", "aoi-outside"], ["unavailable", "aoi-unavailable"]]) {
    const input = baseInput({ radii: { A: 600, B: 1200 }, radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, aoiState });
    const { model } = bridgeFor("tourism", input);
    assert.equal(model.relationship.comparable, false, `${aoiState} withholds`);
    assert.equal(model.relationship.deltaValue, null);
    assert.equal(model.relationship.withheldReasonCode, reason);
    // Raw per-side values remain visible even when the delta is withheld.
    assert.equal(model.a.rawValue, 17);
    assert.equal(model.b.rawValue, 26);
  }
});

// --- D: Mobility unequal-radius comparison withheld -------------------------
test("D Mobility withholds its delta under unequal windows (never silently density)", () => {
  const input = baseInput({ radii: { A: 600, B: 1200 }, radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, aoiState: "eligible" });
  const { model } = bridgeFor("mobility", input);
  assert.equal(model.relationship.comparable, false);
  assert.equal(model.relationship.deltaValue, null);
  assert.equal(model.relationship.withheldReasonCode, "different-window-sizes");
  // Raw node counts still shown for each lens.
  assert.equal(model.a.rawValue, 3);
  assert.equal(model.b.rawValue, 6);
  assert.equal(model.a.densityValue, null, "mobility never converts to density");
});

// --- E: valid UTCI comparison ----------------------------------------------
test("E valid UTCI comparison yields a Celsius B − A", () => {
  const { model, state } = bridgeFor("utci", baseInput());
  assert.equal(model.kind, "temperature");
  assert.equal(model.a.evidence, "VALID");
  assert.equal(model.b.evidence, "VALID");
  assert.equal(model.a.valueText, "36.4°C");
  assert.equal(model.b.valueText, "38.1°C");
  assert.equal(model.relationship.comparable, true);
  assert.equal(model.relationship.deltaKind, "temperature");
  assert.equal(model.relationship.basisCode, "celsius");
  assert.ok(Math.abs(model.relationship.deltaValue - (38.1 - 36.4)) < 1e-9);
  assert.ok(Math.abs(model.relationship.deltaValue - state.delta) < 1e-9);
});

// --- F: UTCI OFF ------------------------------------------------------------
test("F UTCI OFF shows OFF on both sides and never a delta", () => {
  const { model } = bridgeFor("utci", baseInput({ utci: { enabled: false } }));
  assert.equal(model.a.evidence, "OFF");
  assert.equal(model.b.evidence, "OFF");
  assert.equal(model.a.valueText, null, "OFF is not a value");
  assert.equal(model.relationship.comparable, false);
  assert.equal(model.relationship.deltaValue, null);
  assert.equal(model.relationship.withheldReasonCode, "layer-off");
});

// --- G: one side N/A --------------------------------------------------------
test("G one side N/A withholds the delta and never fabricates a number", () => {
  const { model } = bridgeFor("tourism", baseInput({ tourism: { a: unavailable(), b: live(26) } }));
  assert.equal(model.a.evidence, "N_A");
  assert.equal(model.a.valueText, null);
  assert.equal(model.b.evidence, "VALID");
  assert.equal(model.b.valueText, "26");
  assert.equal(model.relationship.comparable, false);
  assert.equal(model.relationship.deltaValue, null);
});

// --- H: observed zero versus positive --------------------------------------
test("H a genuine observed zero is a real value, not unavailable, and yields a delta", () => {
  const { model } = bridgeFor("tourism", baseInput({ tourism: { a: live(0), b: live(26) } }));
  assert.equal(model.a.evidence, "ZERO");
  assert.equal(model.a.valueText, "0", "zero prints as 0, distinct from N/A");
  assert.equal(model.relationship.comparable, true);
  assert.equal(model.relationship.deltaValue, 26);
});

// --- I: both sides zero -----------------------------------------------------
test("I both sides zero compare to a real zero delta", () => {
  const { model } = bridgeFor("tourism", baseInput({ tourism: { a: live(0), b: live(0) } }));
  assert.equal(model.a.evidence, "ZERO");
  assert.equal(model.b.evidence, "ZERO");
  assert.equal(model.relationship.comparable, true);
  assert.equal(model.relationship.deltaValue, 0);
});

// --- J: raw values independent from normalized halo magnitude ---------------
test("J Bridge raw values are independent of the normalized halo bar magnitude", () => {
  // A tiny window saturates the halo bar (magnitude clamps to 1) but the raw
  // count the Bridge reports is still the honest count.
  const input = baseInput({ radii: { A: 400, B: 900 }, tourism: { a: live(500), b: live(10) } });
  const comparison = buildHaloComparison(input);
  const haloSpec = buildHaloGlyphSpec(HALO_METRICS[0], comparison.metrics.tourism, "A");
  const model = buildComparisonBridgeModel({ metricId: "tourism", state: comparison.metrics.tourism, radiusMode: input.radiusMode, radii: input.radii });
  assert.equal(haloSpec.magnitude, 1, "halo bar is saturated");
  assert.equal(model.a.rawValue, 500, "Bridge keeps the raw count, not the magnitude");
  assert.equal(model.a.valueText, "500");
  assert.notEqual(model.a.rawValue, haloSpec.magnitude);
});

// --- K: B − A sign and kind are correct where permitted ---------------------
test("K B − A keeps arithmetic sign and the correct kind per metric", () => {
  // B smaller than A → negative delta (direction only, never 'worse').
  const neg = bridgeFor("tourism", baseInput({ tourism: { a: live(26), b: live(17) } })).model;
  assert.equal(neg.relationship.deltaValue, -9);
  assert.equal(neg.relationship.deltaKind, "count");
  // Density kind under unequal eligible radii.
  const dens = bridgeFor("stays", baseInput({ radii: { A: 600, B: 1200 }, radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, aoiState: "eligible" })).model;
  assert.equal(dens.relationship.deltaKind, "density");
  assert.equal(dens.unitCode, "stays");
  // Temperature kind for UTCI.
  assert.equal(bridgeFor("utci", baseInput()).model.relationship.deltaKind, "temperature");
});

// --- L: no delta exists when comparability is false -------------------------
test("L no delta value is produced whenever the comparison is not comparable", () => {
  const cases = [
    bridgeFor("tourism", baseInput({ tourism: { a: unavailable(), b: unavailable() } })).model,
    bridgeFor("mobility", baseInput({ radii: { A: 600, B: 1200 }, radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL })).model,
    bridgeFor("utci", baseInput({ utci: { enabled: false } })).model,
    bridgeFor("tourism", baseInput({ radii: { A: 600, B: 1200 }, radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, aoiState: "crosses" })).model,
  ];
  for (const model of cases) {
    assert.equal(model.relationship.comparable, false);
    assert.equal(model.relationship.deltaValue, null);
    assert.equal(model.relationship.deltaKind, null);
    assert.equal(model.relationship.basisCode, null);
    assert.ok(model.relationship.withheldReasonCode, "a reason is always given");
  }
});

// --- model guards + one-authoritative-interpretation ------------------------
test("the Bridge covers exactly the four canonical halo metrics, never Pedestrian", () => {
  assert.deepEqual([...BRIDGE_METRIC_IDS], ["tourism", "stays", "mobility", "utci"]);
  assert.equal(buildComparisonBridgeModel({ metricId: "pedestrian", state: {}, radii: { A: 900, B: 900 } }), null);
  assert.equal(buildComparisonBridgeModel({ metricId: null, state: {} }), null);
  assert.equal(buildComparisonBridgeModel({ metricId: "tourism", state: null }), null);
});

test("per-side evidence classification keeps zero, N/A and OFF distinct", () => {
  const count = buildHaloComparison(baseInput({ tourism: { a: live(0), b: unavailable() } })).metrics.tourism;
  assert.equal(bridgeSideEvidence("tourism", count, "A"), "ZERO");
  assert.equal(bridgeSideEvidence("tourism", count, "B"), "N_A");
  const utciOff = buildHaloComparison(baseInput({ utci: { enabled: false } })).metrics.utci;
  assert.equal(bridgeSideEvidence("utci", utciOff, "A"), "OFF");
});

test("Bridge and table share one interpretation: delta equals the state delta or both withhold", () => {
  for (const metricId of ["tourism", "stays", "utci"]) {
    const { model, state } = bridgeFor(metricId, baseInput());
    if (model.relationship.comparable) assert.equal(model.relationship.deltaValue, state.delta);
    else assert.equal(state.comparable, false);
  }
});

// --- production wiring (source-level guards) --------------------------------
test("the app wires the Bridge from the authoritative states and a dictionary-backed translator", () => {
  const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(app, /function renderComparisonBridge\(/);
  assert.match(app, /buildComparisonBridgeModel\(/);
  assert.match(app, /lastBridgeStates = \{ tourism:[^;]*mobility: mobilityState/);
  assert.match(app, /createI18n\(BRIDGE_DICTIONARIES/);
  assert.match(app, /bindComparisonMetricControls\(/);
  // The deterministic comparison-evidence override is inert in production
  // (defaults null; only the gated regression seam writes it) and feeds the
  // real renderCompare() builders — it never adds a parallel render path.
  assert.match(app, /let comparisonEvidenceOverride = null;/);
  assert.match(app, /const ov = comparisonEvidenceOverride;/);
  assert.match(app, /const mobilityState = buildCountPairState\(mobilityInput\.a, mobilityInput\.b, radiusMode\);/);
  // setComparisonOverride lives inside the query-gated + local-host-only seam.
  const gated = app.slice(app.indexOf("if (haloRegressionRequested && haloRegressionLocal)"));
  assert.match(gated, /setComparisonOverride\(override\) \{\s*comparisonEvidenceOverride = override;\s*renderCompare\(\);/);
  assert.match(html, /id="comparisonBridge"/);
  assert.match(html, /id="comparisonBridgeMetric"/);
  assert.match(html, /class="cmp-metric-focus"/);
});
