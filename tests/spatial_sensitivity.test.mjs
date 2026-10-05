import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildHaloComparison,
  buildCountPairState,
  buildComparisonBridgeModel,
  buildDecisionInsightModel,
  buildSpatialSensitivityModel,
  captureSpatialSensitivityBaseline,
  spatialBaselineCenterChanged,
  spatialBasisCompatible,
  SPATIAL_SENSITIVITY_METRIC_IDS,
  SPATIAL_SENSITIVITY_GUARD_CODE,
  SENSITIVITY_TRANSITION,
  SENSITIVITY_STATUS,
  BRIDGE_METRIC_IDS,
  COMPARISON_RADIUS_MODE,
} from "../js/radial-halo.js";

// SPATIAL WINDOW SENSITIVITY V1 — pure model tests.
//
// This layer answers a question about the METHOD, not about Madrid: if the
// spatial windows change, does the analytical reading hold, change direction,
// change basis, become withheld or become comparable?
//
// These tests pin its SEMANTICS (not rendered text): the transition taxonomy,
// the basis-compatibility rule that decides whether two differences may ever be
// subtracted, the preservation of zero / N/A / OFF / withheld distinctions, the
// fixed canonical order, baseline immutability and the invalidation helpers.
//
// The model is DERIVED: every number it reports must be the one the
// authoritative Comparison Bridge already produced. The last blocks prove that
// explicitly, and that no forecasting, causal, ranking or recommendation
// vocabulary can enter the model, the renderer, the stylesheet or the markup.

const REFS = Object.freeze({ tourism: 8, stays: 8, mobility: 8, radiusM: 900, quantile: 0.95 });
const BAND = Object.freeze({ min: 30, max: 46 });
const live = (value) => ({ value, sourceState: "live" });
const unavailable = () => ({ value: null, sourceState: "unavailable" });
const sample = (value) => ({ value, sourceState: "snapshot" });
const CENTERS = Object.freeze({ A: { lat: 40.4168, lon: -3.7038 }, B: { lat: 40.4259, lon: -3.6918 } });

const baseInput = (overrides = {}) => ({
  references: REFS, utciBand: BAND, radii: { A: 900, B: 900 },
  radiusMode: COMPARISON_RADIUS_MODE.EQUAL, aoiState: "eligible",
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

// Rebuilds EXACTLY the wiring renderCompare() uses: the halo comparison states
// for tourism/stays/utci and the panel pair-state for mobility, each passed
// through buildComparisonBridgeModel() before any derived layer sees it. This is
// the same helper shape the Decision Insight tests use, on purpose: the
// sensitivity layer must consume the identical authoritative models.
function bridgeModelsFor(input) {
  const comparison = buildHaloComparison(input);
  const radiusMode = input.radiusMode;
  const states = {
    tourism: comparison.metrics.tourism,
    stays: comparison.metrics.stays,
    mobility: buildCountPairState(input.mobility.a, input.mobility.b, radiusMode),
    utci: comparison.metrics.utci,
  };
  const models = {};
  for (const metricId of BRIDGE_METRIC_IDS) {
    models[metricId] = buildComparisonBridgeModel({
      metricId, state: states[metricId], radiusMode, radii: input.radii,
    });
  }
  return models;
}

function baselineFor(input, { evidenceKey = "ev-1", centers = CENTERS } = {}) {
  return captureSpatialSensitivityBaseline({
    metricModels: bridgeModelsFor(input),
    radii: input.radii,
    centers,
    radiusMode: input.radiusMode,
    evidenceKey,
  });
}

// baseline window vs scenario window, through the real builders on both sides.
function sensitivityFor(baselineInput, scenarioInput, { baselineKey = "ev-1", scenarioKey = "ev-1" } = {}) {
  return buildSpatialSensitivityModel({
    baseline: baselineFor(baselineInput, { evidenceKey: baselineKey }),
    scenarioMetricModels: bridgeModelsFor(scenarioInput),
    scenarioRadii: scenarioInput.radii,
    scenarioEvidenceKey: scenarioKey,
  });
}

const itemFor = (model, metricId) => model.items.find((item) => item.metricId === metricId);
const unequal = (overrides = {}) => baseInput({ radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, radii: { A: 700, B: 1400 }, ...overrides });

// --- A. identical baseline and scenario -------------------------------------
test("A identical baseline and scenario: every reading is unchanged and the window is reported identical", () => {
  const model = sensitivityFor(baseInput(), baseInput());
  assert.equal(model.status, SENSITIVITY_STATUS.STABLE);
  assert.equal(model.windowUnchanged, true);
  assert.equal(model.evidenceCompatible, true);
  assert.equal(model.guardCode, SPATIAL_SENSITIVITY_GUARD_CODE);
  for (const item of model.items) {
    assert.equal(item.transitionCode, SENSITIVITY_TRANSITION.UNCHANGED_COMPARABLE);
    assert.equal(item.basisCompatible, true);
    // A compatible basis with an identical reading yields a real, zero change —
    // not a withheld one: the comparison genuinely did not move.
    assert.equal(item.deltaChange, 0);
    assert.equal(item.baseline.direction, item.scenario.direction);
  }
  assert.deepEqual(model.baseline.radii, { A: 900, B: 900 });
  assert.deepEqual(model.scenario.radii, { A: 900, B: 900 });
});

// --- B. comparable raw count -> comparable raw count, same direction --------
test("B raw-count to raw-count with the same positive direction stays UNCHANGED_COMPARABLE", () => {
  // Both windows equal (so both keep the raw-count basis) but Lens B grows.
  const scenario = baseInput({ tourism: { a: live(17), b: live(31) } });
  const model = sensitivityFor(baseInput(), scenario);
  const tourism = itemFor(model, "tourism");
  assert.equal(tourism.baseline.basisCode, "raw-counts");
  assert.equal(tourism.scenario.basisCode, "raw-counts");
  assert.equal(tourism.baseline.direction, "B_MINUS_A_POSITIVE");
  assert.equal(tourism.scenario.direction, "B_MINUS_A_POSITIVE");
  assert.equal(tourism.transitionCode, SENSITIVITY_TRANSITION.UNCHANGED_COMPARABLE);
  // Same basis, so the change in the observed comparison is reportable.
  assert.equal(tourism.basisCompatible, true);
  assert.equal(tourism.deltaChange, 14 - 9);
  assert.equal(tourism.deltaChangeKind, "count");
  assert.equal(tourism.deltaChangeBasisCode, "raw-counts");
  // The MAGNITUDE moved (+9 → +14) but the qualitative reading did not: same
  // state, same basis, same direction. "Sensitive to window choice" is defined
  // as a change of qualitative comparison STATE or DIRECTION, so a magnitude
  // shift alone must stay STABLE — the size of the change is reported per
  // metric as deltaChange instead.
  assert.equal(model.status, SENSITIVITY_STATUS.STABLE);
});

test("B(2) a qualitative change is what makes the summary MIXED, not a magnitude change", () => {
  // Magnitude only: stable.
  assert.equal(sensitivityFor(baseInput(), baseInput({ tourism: { a: live(17), b: live(31) } })).status, SENSITIVITY_STATUS.STABLE);
  // Direction changed: mixed.
  assert.equal(sensitivityFor(baseInput(), baseInput({ tourism: { a: live(30), b: live(26) } })).status, SENSITIVITY_STATUS.MIXED);
  // Basis changed: mixed.
  assert.equal(sensitivityFor(baseInput(), unequal()).status, SENSITIVITY_STATUS.MIXED);
  // Became withheld: mixed.
  assert.equal(sensitivityFor(baseInput(), baseInput({ utci: { enabled: false } })).status, SENSITIVITY_STATUS.MIXED);
  // Withheld reason changed: mixed.
  assert.equal(sensitivityFor(unequal({ aoiState: "crosses" }), unequal({ aoiState: "outside" })).status, SENSITIVITY_STATUS.MIXED);
});

// --- C. positive -> negative --------------------------------------------------
test("C a positive B − A that becomes negative is DIRECTION_CHANGED, with the signed change", () => {
  const model = sensitivityFor(baseInput(), baseInput({ tourism: { a: live(30), b: live(26) } }));
  const tourism = itemFor(model, "tourism");
  assert.equal(tourism.baseline.deltaValue, 9);
  assert.equal(tourism.scenario.deltaValue, -4);
  assert.equal(tourism.baseline.direction, "B_MINUS_A_POSITIVE");
  assert.equal(tourism.scenario.direction, "B_MINUS_A_NEGATIVE");
  assert.equal(tourism.transitionCode, SENSITIVITY_TRANSITION.DIRECTION_CHANGED);
  assert.equal(tourism.deltaChange, -13);
  assert.equal(model.status, SENSITIVITY_STATUS.MIXED);
});

// --- D. positive -> zero -----------------------------------------------------
test("D a positive B − A that becomes zero is DIRECTION_CHANGED and the zero is a real reading", () => {
  const model = sensitivityFor(baseInput(), baseInput({ tourism: { a: live(26), b: live(26) } }));
  const tourism = itemFor(model, "tourism");
  assert.equal(tourism.scenario.deltaValue, 0);
  assert.equal(tourism.scenario.direction, "B_MINUS_A_ZERO");
  assert.equal(tourism.scenario.comparable, true, "a zero difference is still a comparable reading");
  assert.equal(tourism.transitionCode, SENSITIVITY_TRANSITION.DIRECTION_CHANGED);
  assert.equal(tourism.deltaChange, -9);
});

// --- E. zero -> positive -----------------------------------------------------
test("E a zero B − A that becomes positive is DIRECTION_CHANGED", () => {
  const model = sensitivityFor(baseInput({ tourism: { a: live(26), b: live(26) } }), baseInput());
  const tourism = itemFor(model, "tourism");
  assert.equal(tourism.baseline.direction, "B_MINUS_A_ZERO");
  assert.equal(tourism.scenario.direction, "B_MINUS_A_POSITIVE");
  assert.equal(tourism.transitionCode, SENSITIVITY_TRANSITION.DIRECTION_CHANGED);
  assert.equal(tourism.deltaChange, 9);
});

// --- F. comparable -> withheld ----------------------------------------------
test("F comparable to withheld is BECAME_WITHHELD and withholds any numeric change", () => {
  // Unequal windows + an AOI condition is an authoritative withholding that
  // leaves both sides with real values.
  const scenario = unequal({ aoiState: "crosses" });
  const model = sensitivityFor(baseInput(), scenario);
  const tourism = itemFor(model, "tourism");
  assert.equal(tourism.baseline.comparable, true);
  assert.equal(tourism.scenario.comparable, false);
  assert.equal(tourism.transitionCode, SENSITIVITY_TRANSITION.BECAME_WITHHELD);
  assert.equal(tourism.scenario.withheldReasonCode, "aoi-crosses");
  assert.equal(tourism.deltaChange, null, "a withheld scenario can never carry a numeric change");
  assert.equal(tourism.basisCompatible, false);
});

// --- G. withheld -> comparable ----------------------------------------------
test("G withheld to comparable is BECAME_COMPARABLE and still withholds the numeric change", () => {
  const model = sensitivityFor(unequal({ aoiState: "crosses" }), baseInput());
  const tourism = itemFor(model, "tourism");
  assert.equal(tourism.baseline.comparable, false);
  assert.equal(tourism.scenario.comparable, true);
  assert.equal(tourism.transitionCode, SENSITIVITY_TRANSITION.BECAME_COMPARABLE);
  // There is no baseline difference to subtract from, so no change exists.
  assert.equal(tourism.deltaChange, null);
});

// --- H. same withheld reason -------------------------------------------------
test("H the same authoritative withheld reason in both windows is WITHHELD_UNCHANGED", () => {
  const model = sensitivityFor(unequal({ aoiState: "crosses" }), unequal({ aoiState: "crosses", radii: { A: 800, B: 1500 } }));
  const tourism = itemFor(model, "tourism");
  assert.equal(tourism.baseline.withheldReasonCode, "aoi-crosses");
  assert.equal(tourism.scenario.withheldReasonCode, "aoi-crosses");
  assert.equal(tourism.transitionCode, SENSITIVITY_TRANSITION.WITHHELD_UNCHANGED);
  assert.equal(tourism.deltaChange, null);
});

// --- I. withheld reason changes ---------------------------------------------
test("I a changed authoritative withheld reason is WITHHELD_REASON_CHANGED, never silently equivalent", () => {
  const model = sensitivityFor(unequal({ aoiState: "crosses" }), unequal({ aoiState: "outside" }));
  const tourism = itemFor(model, "tourism");
  assert.equal(tourism.baseline.withheldReasonCode, "aoi-crosses");
  assert.equal(tourism.scenario.withheldReasonCode, "aoi-outside");
  assert.equal(tourism.transitionCode, SENSITIVITY_TRANSITION.WITHHELD_REASON_CHANGED);
  // Neither window is comparable anywhere in the canonical set except UTCI, so
  // the summary still rests on the metrics that ARE comparable in both.
  assert.equal(tourism.deltaChange, null);
});

test("I(2) OFF and N/A are different non-comparable states, so OFF to N/A changes the reason", () => {
  const off = baseInput({ utci: { enabled: false } });
  const none = baseInput({ utci: { enabled: true, timestepA: "15:00", timestepB: "15:00", a: null, b: null } });
  const model = sensitivityFor(off, none);
  const utci = itemFor(model, "utci");
  assert.equal(utci.baseline.state, "off");
  assert.equal(utci.scenario.state, "unavailable");
  assert.equal(utci.transitionCode, SENSITIVITY_TRANSITION.WITHHELD_REASON_CHANGED,
    "an intentionally disabled layer and absent evidence are not the same state");
});

// --- J. raw count -> density -------------------------------------------------
test("J raw-count to density is BASIS_CHANGED and NEVER produces a delta-of-deltas", () => {
  const model = sensitivityFor(baseInput(), unequal());
  for (const metricId of ["tourism", "stays"]) {
    const item = itemFor(model, metricId);
    assert.equal(item.baseline.comparable, true);
    assert.equal(item.scenario.comparable, true, "unequal windows authorize the density comparison");
    assert.equal(item.baseline.deltaKind, "count");
    assert.equal(item.baseline.basisCode, "raw-counts");
    assert.equal(item.scenario.deltaKind, "density");
    assert.equal(item.scenario.basisCode, "density");
    assert.equal(item.transitionCode, SENSITIVITY_TRANSITION.BASIS_CHANGED);
    // THE CENTRAL ABSTENTION: records and records/km² are different quantities,
    // so they are never subtracted and never unit-converted to force a number.
    assert.equal(item.basisCompatible, false);
    assert.equal(item.deltaChange, null);
    assert.equal(item.deltaChangeKind, null);
    assert.equal(item.deltaChangeBasisCode, null);
  }
});

test("J(2) basis is checked before direction, so a sign flip across bases never reads as DIRECTION_CHANGED", () => {
  // Raw counts give B − A = +9; under the unequal window the density difference
  // is NEGATIVE, because Lens B's larger area dilutes its records. Reporting
  // that as a "direction change" would compare two incomparable quantities.
  const model = sensitivityFor(baseInput(), unequal());
  const tourism = itemFor(model, "tourism");
  assert.ok(tourism.baseline.deltaValue > 0);
  assert.ok(tourism.scenario.deltaValue < 0);
  assert.notEqual(tourism.baseline.direction, tourism.scenario.direction);
  assert.equal(tourism.transitionCode, SENSITIVITY_TRANSITION.BASIS_CHANGED,
    "a differing basis outranks a differing sign");
});

// --- K. density -> density ---------------------------------------------------
test("K density to density is a compatible basis and reports the change in records/km²", () => {
  const baseline = unequal();
  const scenario = unequal({ radii: { A: 700, B: 1200 } });
  const model = sensitivityFor(baseline, scenario);
  const tourism = itemFor(model, "tourism");
  assert.equal(tourism.baseline.basisCode, "density");
  assert.equal(tourism.scenario.basisCode, "density");
  assert.equal(tourism.basisCompatible, true);
  assert.equal(tourism.deltaChangeKind, "density");
  assert.equal(tourism.deltaChangeBasisCode, "density");
  // The number IS the difference of the two authoritative density deltas.
  assert.equal(tourism.deltaChange, tourism.scenario.deltaValue - tourism.baseline.deltaValue);
  assert.ok(Number.isFinite(tourism.deltaChange));
});

// --- L. UTCI Celsius -> Celsius ----------------------------------------------
test("L UTCI Celsius to Celsius is compatible and radius-independent", () => {
  const model = sensitivityFor(baseInput(), unequal({
    utci: {
      enabled: true, timestepA: "15:00", timestepB: "15:00",
      a: { evidence: "MODEL-DERIVED", mean: 36.0, count: 4 },
      b: { evidence: "MODEL-DERIVED", mean: 38.0, count: 6 },
    },
  }));
  const utci = itemFor(model, "utci");
  assert.equal(utci.baseline.basisCode, "celsius");
  assert.equal(utci.scenario.basisCode, "celsius");
  // UTCI never converts to density, so changing the radii does not change its
  // basis the way it does for the count metrics.
  assert.equal(utci.transitionCode, SENSITIVITY_TRANSITION.UNCHANGED_COMPARABLE);
  assert.equal(utci.basisCompatible, true);
  assert.equal(utci.deltaChangeKind, "temperature");
  assert.ok(Math.abs(utci.deltaChange - (2.0 - 1.7)) < 1e-9);
  // The model-derived limitation travels with the comparable Celsius reading.
  assert.equal(utci.scenario.evidenceQualifier, "model-derived");
});

test("L(2) differing HATI timesteps stay incomparable, so the UTCI contract is read through", () => {
  const model = sensitivityFor(baseInput(), baseInput({
    utci: {
      enabled: true, timestepA: "15:00", timestepB: "18:00",
      a: { evidence: "MODEL-DERIVED", mean: 36.4, count: 2 },
      b: { evidence: "MODEL-DERIVED", mean: 38.1, count: 3 },
    },
  }));
  const utci = itemFor(model, "utci");
  assert.equal(utci.scenario.comparable, false);
  assert.equal(utci.scenario.withheldReasonCode, "timesteps-differ");
  assert.equal(utci.transitionCode, SENSITIVITY_TRANSITION.BECAME_WITHHELD);
  assert.equal(utci.deltaChange, null);
});

// --- M. UTCI valid -> unavailable --------------------------------------------
test("M UTCI losing its sample under the scenario window becomes non-comparable, never a manufactured value", () => {
  const model = sensitivityFor(baseInput(), unequal({
    utci: {
      enabled: true, timestepA: "15:00", timestepB: "15:00",
      a: { evidence: "MODEL-DERIVED", mean: 36.4, count: 2 }, b: null,
    },
  }));
  const utci = itemFor(model, "utci");
  assert.equal(utci.baseline.comparable, true);
  assert.equal(utci.scenario.state, "unavailable");
  assert.equal(utci.scenario.bEvidence, "N_A");
  assert.equal(utci.scenario.deltaValue, null, "no value is invented for the missing side");
  assert.equal(utci.transitionCode, SENSITIVITY_TRANSITION.BECAME_WITHHELD);
  assert.equal(utci.deltaChange, null);
});

// --- N. Mobility equal-window comparable -> unequal-window withheld ----------
test("N Mobility comparable at equal windows becomes withheld for different window sizes", () => {
  const model = sensitivityFor(baseInput(), unequal());
  const mobility = itemFor(model, "mobility");
  assert.equal(mobility.baseline.comparable, true);
  assert.equal(mobility.baseline.deltaValue, 3);
  assert.equal(mobility.baseline.basisCode, "raw-counts");
  assert.equal(mobility.scenario.comparable, false);
  // The authoritative Mobility rule, read through unchanged.
  assert.equal(mobility.scenario.withheldReasonCode, "different-window-sizes");
  assert.equal(mobility.transitionCode, SENSITIVITY_TRANSITION.BECAME_WITHHELD);
  assert.equal(mobility.deltaChange, null);
});

test("N(2) Mobility never converts to a density basis under any window change", () => {
  for (const scenario of [baseInput(), unequal(), unequal({ radii: { A: 500, B: 1800 } })]) {
    const model = sensitivityFor(baseInput(), scenario);
    const mobility = itemFor(model, "mobility");
    assert.notEqual(mobility.scenario.basisCode, "density");
    assert.notEqual(mobility.scenario.deltaKind, "density");
  }
});

// --- O. Mobility unavailable stays evidence-withheld -------------------------
test("O unavailable Mobility keeps the evidence reason, which outranks the window mismatch", () => {
  const absent = { mobility: { a: unavailable(), b: unavailable() } };
  const model = sensitivityFor(baseInput(absent), unequal(absent));
  const mobility = itemFor(model, "mobility");
  assert.equal(mobility.baseline.state, "unavailable");
  assert.equal(mobility.scenario.state, "unavailable");
  assert.equal(mobility.baseline.aEvidence, "N_A");
  assert.equal(mobility.scenario.aEvidence, "N_A");
  // Both windows report the EVIDENCE reason, not "different window sizes": with
  // no valid pair there is nothing for the window rule to withhold.
  assert.equal(mobility.scenario.withheldReasonCode, "source-incompatible");
  assert.equal(mobility.transitionCode, SENSITIVITY_TRANSITION.WITHHELD_UNCHANGED);
  assert.equal(mobility.deltaChange, null);
});

// --- P. observed zero remains evidence ---------------------------------------
test("P an observed zero is evidence and participates in a valid comparison", () => {
  const zeros = { tourism: { a: live(0), b: live(0) } };
  const model = sensitivityFor(baseInput(zeros), baseInput(zeros));
  const tourism = itemFor(model, "tourism");
  assert.equal(tourism.baseline.aEvidence, "ZERO");
  assert.equal(tourism.baseline.bEvidence, "ZERO");
  assert.equal(tourism.baseline.comparable, true, "an observed zero is evidence, not absence");
  assert.equal(tourism.scenario.comparable, true);
  assert.equal(tourism.baseline.deltaValue, 0);
  assert.equal(tourism.transitionCode, SENSITIVITY_TRANSITION.UNCHANGED_COMPARABLE);
  assert.equal(tourism.deltaChange, 0);
});

test("P(2) a zero on one side only still compares, and the zero never reads as missing", () => {
  const model = sensitivityFor(
    baseInput({ tourism: { a: live(0), b: live(4) } }),
    baseInput({ tourism: { a: live(0), b: live(9) } }),
  );
  const tourism = itemFor(model, "tourism");
  assert.equal(tourism.baseline.aEvidence, "ZERO");
  assert.equal(tourism.scenario.aEvidence, "ZERO");
  assert.equal(tourism.transitionCode, SENSITIVITY_TRANSITION.UNCHANGED_COMPARABLE);
  assert.equal(tourism.deltaChange, 5);
});

// --- Q. N/A never becomes zero -----------------------------------------------
test("Q an unavailable side never collapses into a zero value or a zero direction", () => {
  const model = sensitivityFor(
    baseInput(),
    baseInput({ tourism: { a: unavailable(), b: unavailable() } }),
  );
  const tourism = itemFor(model, "tourism");
  assert.equal(tourism.scenario.state, "unavailable");
  assert.equal(tourism.scenario.aEvidence, "N_A");
  assert.equal(tourism.scenario.bEvidence, "N_A");
  assert.equal(tourism.scenario.deltaValue, null, "N/A is not zero");
  assert.notEqual(tourism.scenario.direction, "B_MINUS_A_ZERO");
  assert.equal(tourism.scenario.direction, null);
  assert.equal(tourism.deltaChange, null);
  assert.equal(tourism.transitionCode, SENSITIVITY_TRANSITION.BECAME_WITHHELD);
});

test("Q(2) OFF never collapses into a zero value either", () => {
  const model = sensitivityFor(baseInput(), baseInput({ utci: { enabled: false } }));
  const utci = itemFor(model, "utci");
  assert.equal(utci.scenario.state, "off");
  assert.equal(utci.scenario.aEvidence, "OFF");
  assert.equal(utci.scenario.deltaValue, null);
  assert.equal(utci.scenario.direction, null);
  assert.equal(utci.scenario.withheldReasonCode, "layer-off");
  assert.equal(utci.deltaChange, null);
});

// --- R / S. fixed canonical order, no ranking --------------------------------
test("R the canonical order is fixed and matches the Bridge/Insight metric set", () => {
  assert.deepEqual(SPATIAL_SENSITIVITY_METRIC_IDS, ["tourism", "stays", "mobility", "utci"]);
  assert.deepEqual([...SPATIAL_SENSITIVITY_METRIC_IDS], [...BRIDGE_METRIC_IDS]);
  // Pedestrian stays a panel-only observational comparison and is absent here.
  assert.ok(!SPATIAL_SENSITIVITY_METRIC_IDS.includes("pedestrian"));
  const model = sensitivityFor(baseInput(), unequal());
  assert.deepEqual(model.items.map((item) => item.metricId), ["tourism", "stays", "mobility", "utci"]);
});

test("S the order never responds to magnitude, change size or availability", () => {
  // A huge Tourism change, a huge UTCI change, an unavailable Stays and a
  // withheld Mobility: no arrangement of evidence may reorder the items.
  const scenarios = [
    baseInput({ tourism: { a: live(1), b: live(900) } }),
    baseInput({ stays: { a: unavailable(), b: unavailable() } }),
    unequal(),
    baseInput({
      utci: {
        enabled: true, timestepA: "15:00", timestepB: "15:00",
        a: { evidence: "MODEL-DERIVED", mean: 20.0, count: 2 },
        b: { evidence: "MODEL-DERIVED", mean: 45.0, count: 3 },
      },
    }),
  ];
  for (const scenario of scenarios) {
    const model = sensitivityFor(baseInput(), scenario);
    assert.deepEqual(model.items.map((item) => item.metricId), ["tourism", "stays", "mobility", "utci"]);
  }
  // There is no ranked, sorted, "top" or "most sensitive" surface at all.
  const model = sensitivityFor(baseInput(), unequal());
  for (const forbidden of ["top", "rank", "ranking", "best", "worst", "winner", "leader", "score", "sorted"]) {
    assert.ok(!Object.keys(model).some((key) => key.toLowerCase().includes(forbidden)),
      `the model exposes no "${forbidden}" field`);
  }
});

// --- overall status ----------------------------------------------------------
test("the overall summary is categorical, conservative and carries no number", () => {
  // STABLE: nothing changed anywhere.
  assert.equal(sensitivityFor(baseInput(), baseInput()).status, SENSITIVITY_STATUS.STABLE);
  // MIXED: something changed state, direction or basis.
  assert.equal(sensitivityFor(baseInput(), unequal()).status, SENSITIVITY_STATUS.MIXED);
  // LIMITED: not one metric is comparable in BOTH windows, so stability cannot
  // be assessed and the summary abstains rather than implying it.
  const blind = {
    tourism: { a: unavailable(), b: unavailable() },
    stays: { a: unavailable(), b: unavailable() },
    mobility: { a: unavailable(), b: unavailable() },
    utci: { enabled: false },
  };
  const limited = sensitivityFor(baseInput(blind), baseInput(blind));
  assert.equal(limited.status, SENSITIVITY_STATUS.LIMITED);
  // A withheld-but-unchanged set must NOT be dressed up as a stable reading.
  assert.notEqual(limited.status, SENSITIVITY_STATUS.STABLE);
  // No numeric robustness anywhere: no score, index, percentage or confidence.
  for (const model of [sensitivityFor(baseInput(), baseInput()), limited]) {
    assert.equal(typeof model.status, "string");
    assert.ok(!/\d/.test(model.status), "the summary is a code, never a number");
    for (const forbidden of ["robust", "confidence", "stabilityScore", "index", "percent", "pct"]) {
      assert.ok(!Object.keys(model).some((key) => key.toLowerCase().includes(forbidden.toLowerCase())),
        `the model exposes no "${forbidden}" field`);
    }
  }
});

test("a baseline-only metric still counts toward LIMITED when nothing is comparable in both windows", () => {
  // Comparable at baseline, withheld under the scenario, and nothing else is
  // comparable in both: there is no pair whose stability could be read.
  const onlyTourism = {
    stays: { a: unavailable(), b: unavailable() },
    mobility: { a: unavailable(), b: unavailable() },
    utci: { enabled: false },
  };
  const model = sensitivityFor(baseInput(onlyTourism), unequal({ ...onlyTourism, aoiState: "crosses" }));
  assert.equal(itemFor(model, "tourism").transitionCode, SENSITIVITY_TRANSITION.BECAME_WITHHELD);
  assert.equal(model.status, SENSITIVITY_STATUS.LIMITED);
});

// --- T. no prediction / recommendation vocabulary ----------------------------
test("T no forecasting, causal, ranking or recommendation vocabulary reaches the shipped model", () => {
  const model = sensitivityFor(baseInput(), unequal());
  const serialized = JSON.stringify(model).toLowerCase();
  for (const forbidden of [
    "forecast", "predict", "prediction", "projected", "expected", "future", "will increase",
    "will decrease", "impact", "effect", "caused", "causal", "intervention", "policy",
    "recommend", "advice", "should", "better", "worse", "winner", "loser", "improve", "decline",
  ]) {
    assert.ok(!serialized.includes(forbidden), `the model never emits "${forbidden}"`);
  }
  // Every transition and status code is drawn from the small declared taxonomy.
  const transitions = new Set(Object.values(SENSITIVITY_TRANSITION));
  for (const item of model.items) assert.ok(transitions.has(item.transitionCode));
  assert.ok(new Set(Object.values(SENSITIVITY_STATUS)).has(model.status));
  // The taxonomy stays SMALL: a handful of states, not dozens of microstates.
  assert.equal(transitions.size, 8);
  assert.equal(Object.values(SENSITIVITY_STATUS).length, 4);
});

// --- U. the scenario delta IS the authoritative Bridge delta -----------------
test("U every scenario number is the authoritative Bridge/Insight number, never recomputed", () => {
  for (const input of [baseInput(), unequal(), baseInput({ tourism: { a: live(0), b: live(7) } })]) {
    const scenarioModels = bridgeModelsFor(input);
    const insight = buildDecisionInsightModel({
      metricModels: scenarioModels, radiusMode: input.radiusMode, radii: input.radii,
    });
    const model = buildSpatialSensitivityModel({
      baseline: baselineFor(baseInput()),
      scenarioMetricModels: scenarioModels,
      scenarioRadii: input.radii,
      scenarioEvidenceKey: "ev-1",
    });
    for (const metricId of SPATIAL_SENSITIVITY_METRIC_IDS) {
      const scenario = itemFor(model, metricId).scenario;
      const bridge = scenarioModels[metricId].relationship;
      const insightItem = insight.items.find((item) => item.metricId === metricId);
      // Identical to the Bridge relationship …
      assert.equal(scenario.comparable, bridge.comparable, `${metricId} comparability is the Bridge's`);
      assert.equal(scenario.deltaValue, bridge.comparable ? bridge.deltaValue : null, `${metricId} delta is the Bridge's`);
      assert.equal(scenario.deltaKind, bridge.comparable ? bridge.deltaKind : null);
      assert.equal(scenario.basisCode, bridge.comparable ? bridge.basisCode : null);
      assert.equal(scenario.withheldReasonCode, bridge.comparable ? null : bridge.withheldReasonCode);
      // … and identical to the rendered Decision Insight item, so the scenario
      // side can never become an independent fifth interpretation.
      assert.equal(scenario.state, insightItem.state, `${metricId} state matches Decision Insight`);
      assert.equal(scenario.deltaValue, insightItem.deltaValue);
      assert.equal(scenario.direction, insightItem.direction);
      assert.equal(scenario.basisCode, insightItem.basisCode);
      assert.equal(scenario.withheldReasonCode, insightItem.withheldReasonCode);
      assert.equal(scenario.aEvidence, insightItem.aEvidence);
      assert.equal(scenario.bEvidence, insightItem.bEvidence);
    }
  }
});

test("U(2) the reported change is exactly scenario delta minus baseline delta, or nothing", () => {
  const model = sensitivityFor(baseInput(), baseInput({ tourism: { a: live(17), b: live(40) } }));
  const tourism = itemFor(model, "tourism");
  assert.equal(tourism.deltaChange, tourism.scenario.deltaValue - tourism.baseline.deltaValue);
  // Whenever the basis is incompatible the change is absent, with no fallback.
  const crossBasis = itemFor(sensitivityFor(baseInput(), unequal()), "tourism");
  assert.equal(crossBasis.basisCompatible, false);
  assert.equal(crossBasis.deltaChange, null);
});

test("U(3) spatialBasisCompatible demands metric, kind, basis and evidence agreement", () => {
  const comparable = { metricId: "tourism", state: "comparable", deltaKind: "count", basisCode: "raw-counts" };
  assert.equal(spatialBasisCompatible(comparable, { ...comparable }, true), true);
  // Any single mismatch is enough to refuse the subtraction.
  assert.equal(spatialBasisCompatible(comparable, { ...comparable, basisCode: "density" }, true), false);
  assert.equal(spatialBasisCompatible(comparable, { ...comparable, deltaKind: "density" }, true), false);
  assert.equal(spatialBasisCompatible(comparable, { ...comparable, metricId: "stays" }, true), false);
  assert.equal(spatialBasisCompatible(comparable, { ...comparable, state: "withheld" }, true), false);
  assert.equal(spatialBasisCompatible({ ...comparable, state: "off" }, comparable, true), false);
  // A differing evidence contract blocks it even when the basis matches.
  assert.equal(spatialBasisCompatible(comparable, { ...comparable }, false), false);
});

// --- V. baseline immutability ------------------------------------------------
test("V a captured baseline is deeply frozen and never drifts with the live state", () => {
  const baseline = baselineFor(baseInput());
  assert.ok(Object.isFrozen(baseline));
  assert.ok(Object.isFrozen(baseline.items));
  assert.ok(Object.isFrozen(baseline.items.tourism));
  assert.ok(Object.isFrozen(baseline.radii));
  assert.ok(Object.isFrozen(baseline.centers));
  assert.ok(Object.isFrozen(baseline.centers.A));
  const before = JSON.stringify(baseline);
  // A mutation attempt must not take effect (the snapshot is frozen, not a
  // live reference), and neither must building a scenario against it.
  try { baseline.radii.A = 1; } catch { /* strict-mode throw is also acceptable */ }
  try { baseline.items.tourism.deltaValue = 999; } catch { /* idem */ }
  buildSpatialSensitivityModel({
    baseline,
    scenarioMetricModels: bridgeModelsFor(unequal()),
    scenarioRadii: { A: 700, B: 1400 },
    scenarioEvidenceKey: "ev-1",
  });
  assert.equal(JSON.stringify(baseline), before, "the baseline is unchanged after a scenario read");
  assert.equal(baseline.radii.A, 900);
});

test("V(2) the baseline keeps the reading it was captured with after the live state moves on", () => {
  const baseline = baselineFor(baseInput());
  const capturedTourismDelta = baseline.items.tourism.deltaValue;
  assert.equal(capturedTourismDelta, 9);
  // Three successive, very different live states.
  for (const scenario of [unequal(), baseInput({ tourism: { a: live(1), b: live(2) } }), baseInput({ tourism: { a: unavailable(), b: unavailable() } })]) {
    const model = buildSpatialSensitivityModel({
      baseline, scenarioMetricModels: bridgeModelsFor(scenario),
      scenarioRadii: scenario.radii, scenarioEvidenceKey: "ev-1",
    });
    assert.equal(itemFor(model, "tourism").baseline.deltaValue, capturedTourismDelta,
      "the baseline reading is historical and must not follow the live state");
    assert.deepEqual(model.baseline.radii, { A: 900, B: 900 });
  }
});

test("V(3) the baseline stores structured model state, never rendered text", () => {
  const baseline = baselineFor(baseInput());
  const serialized = JSON.stringify(baseline);
  // No formatted values, localized labels or prose: text is rendering, the
  // model is truth. (Neutral unit CODES like "nodes" are model data — they are
  // what the view resolves a localized unit from, exactly as the Insight does.)
  for (const rendered of [
    "Tourism POIs", "Hotels & stays", "Mobility nodes", "Mean UTCI",
    "Withheld", "Retenido", "B − A", "N/A", "N/D", "/km²", "+9", "records/km²",
    "Relationship unchanged", "Basis changed", "raw represented counts",
  ]) {
    assert.ok(!serialized.includes(rendered), `the baseline stores no rendered "${rendered}"`);
  }
  // The captured difference is a NUMBER, not a formatted string.
  assert.equal(typeof baseline.items.tourism.deltaValue, "number");
  assert.equal(typeof baseline.items.mobility.deltaValue, "number");
  // It does store the structured codes needed to reproduce the reading.
  assert.equal(baseline.items.tourism.basisCode, "raw-counts");
  assert.equal(baseline.items.tourism.deltaKind, "count");
  assert.equal(baseline.items.tourism.direction, "B_MINUS_A_POSITIVE");
  assert.equal(baseline.items.tourism.deltaValue, 9);
  assert.equal(baseline.evidenceKey, "ev-1");
  assert.equal(baseline.radiusMode, COMPARISON_RADIUS_MODE.EQUAL);
});

// --- W. centre-change invalidation -------------------------------------------
test("W a materially moved Lens centre is detected, and pan/zoom jitter is not", () => {
  const baseline = baselineFor(baseInput());
  // The identical centres: nothing to invalidate. Map pan and zoom never move a
  // centre, so they can never reach this helper with a change.
  assert.equal(spatialBaselineCenterChanged(baseline.centers, { A: { ...CENTERS.A }, B: { ...CENTERS.B } }), false);
  // A deliberate move of either lens is a DIFFERENT PLACE, not radius sensitivity.
  assert.equal(spatialBaselineCenterChanged(baseline.centers, { A: { lat: 40.4300, lon: -3.7038 }, B: CENTERS.B }), true);
  assert.equal(spatialBaselineCenterChanged(baseline.centers, { A: CENTERS.A, B: { lat: 40.4259, lon: -3.6800 } }), true);
  // Sub-metre floating-point jitter is absorbed, not treated as a move.
  assert.equal(spatialBaselineCenterChanged(baseline.centers, {
    A: { lat: CENTERS.A.lat + 1e-7, lon: CENTERS.A.lon - 1e-7 }, B: CENTERS.B,
  }), false);
  // A missing centre is treated as changed rather than silently equal.
  assert.equal(spatialBaselineCenterChanged(baseline.centers, { A: CENTERS.A, B: null }), true);
  // With no baseline there is nothing to invalidate.
  assert.equal(spatialBaselineCenterChanged(null, { A: CENTERS.A, B: CENTERS.B }), false);
});

// --- X. evidence-configuration invalidation ----------------------------------
test("X a differing evidence contract is never presented as spatial sensitivity", () => {
  const model = sensitivityFor(baseInput(), baseInput(), { baselineKey: "hati:15:00", scenarioKey: "hati:18:00" });
  assert.equal(model.evidenceCompatible, false);
  assert.equal(model.status, SENSITIVITY_STATUS.EVIDENCE_CHANGED);
  for (const item of model.items) {
    assert.equal(item.transitionCode, SENSITIVITY_TRANSITION.EVIDENCE_CHANGED);
    // No window-sensitivity number may survive an evidence-contract change,
    // even where the basis would otherwise have matched.
    assert.equal(item.deltaChange, null);
    assert.equal(item.basisCompatible, false);
  }
});

test("X(2) an unknown evidence key on either side is not treated as a change", () => {
  // A caller that does not track an evidence contract still gets a reading;
  // only a KNOWN DIFFERENCE marks the snapshots incompatible.
  const model = buildSpatialSensitivityModel({
    baseline: captureSpatialSensitivityBaseline({
      metricModels: bridgeModelsFor(baseInput()), radii: { A: 900, B: 900 }, centers: CENTERS, radiusMode: COMPARISON_RADIUS_MODE.EQUAL,
    }),
    scenarioMetricModels: bridgeModelsFor(baseInput()),
    scenarioRadii: { A: 900, B: 900 },
  });
  assert.equal(model.evidenceCompatible, true);
  assert.equal(model.status, SENSITIVITY_STATUS.STABLE);
});

// --- model contract ----------------------------------------------------------
test("the model abstains entirely without a baseline or without scenario models", () => {
  assert.equal(buildSpatialSensitivityModel(), null);
  assert.equal(buildSpatialSensitivityModel({}), null);
  assert.equal(buildSpatialSensitivityModel({ baseline: baselineFor(baseInput()) }), null);
  assert.equal(buildSpatialSensitivityModel({ scenarioMetricModels: bridgeModelsFor(baseInput()) }), null);
  assert.equal(captureSpatialSensitivityBaseline(), null);
  assert.equal(captureSpatialSensitivityBaseline({}), null);
});

test("the returned model and its items are frozen, so no consumer can mutate the reading", () => {
  const model = sensitivityFor(baseInput(), unequal());
  assert.ok(Object.isFrozen(model));
  assert.ok(Object.isFrozen(model.items));
  for (const item of model.items) {
    assert.ok(Object.isFrozen(item));
    assert.ok(Object.isFrozen(item.baseline));
    assert.ok(Object.isFrozen(item.scenario));
  }
});

test("V1 scope is radii only: the model carries no non-spatial scenario input", () => {
  const model = sensitivityFor(baseInput(), unequal());
  // Baseline and scenario each describe a WINDOW: radii and the radius mode.
  assert.deepEqual(Object.keys(model.baseline).sort(), ["radii", "radiusMode"]);
  assert.deepEqual(Object.keys(model.scenario).sort(), ["radii", "radiusMode"]);
  // No lens-centre, dataset, timestep, category, date or filter scenario knob.
  const keys = JSON.stringify(model).toLowerCase();
  for (const forbidden of ["timestep", "category", "filter", "dataset", "pedestrian", "destination", "date"]) {
    assert.ok(!keys.includes(forbidden), `V1 exposes no "${forbidden}" scenario dimension`);
  }
});

// --- production wiring + localization (source-level guards) ------------------
test("the app renders the sensitivity reading from the authoritative models, in both languages, with no runtime LLM", () => {
  const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

  // 1) ONE derivation chain. The scenario side is built from the SAME
  //    buildBridgeMetricModels() the Bridge and the Insight consume, and the
  //    baseline is a captured snapshot — never re-derived from raw evidence.
  assert.match(app, /function renderSpatialSensitivity\(/);
  assert.match(app, /buildSpatialSensitivityModel\(\{\s*baseline: spatialBaseline,\s*scenarioMetricModels,/);
  assert.match(app, /const scenarioMetricModels = buildBridgeMetricModels\(\);/);
  assert.match(app, /spatialBaseline = captureSpatialSensitivityBaseline\(\{/);
  // It is rendered from the authoritative states renderCompare() captured, and
  // only AFTER validity has been enforced.
  assert.match(app, /enforceSpatialBaselineValidity\(\);\s*renderSpatialSensitivity\(\);/);
  // Metric focus only re-applies emphasis; it never rebuilds the items.
  assert.match(app, /function applySpatialSensitivityFocus\(\)/);

  // 2) NO DOM SCRAPING on the production model path. The baseline and the
  //    scenario come from models; reading Bridge/Insight/table text and parsing
  //    it back into a scenario is forbidden.
  const section = app.slice(app.indexOf("// --- Spatial Window Sensitivity ---"), app.indexOf("function setHaloLine("));
  assert.ok(section.length > 500, "the Spatial Sensitivity section was located");
  const code = section.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  assert.ok(!/\/\//.test(code.replace(/https?:\/\//g, "")), "all comments were stripped before scanning");
  // The model builders are never fed text, and nothing is parsed back out of it.
  for (const forbidden of ["parsefloat", "parseint", "number(", "textcontent.match", "innertext", "queryselector(\".cb-", "queryselector(\".di-"]) {
    assert.ok(!code.toLowerCase().includes(forbidden), `the model path must not use "${forbidden}"`);
  }
  // Writing text is expected; READING it to derive state is not.
  assert.ok(/\.textContent = /.test(code), "the renderer writes text");
  assert.ok(!/= [a-zA-Z.]*\.textContent/.test(code), "the renderer never reads text back as a source of truth");

  // 3) NO RUNTIME LLM: no generative service, no model API, no network call.
  for (const forbidden of [
    "fetch(", "xmlhttprequest", "websocket", "eventsource", "sendbeacon", "import(", "navigator.",
    "anthropic", "openai", "completion", "generate", "prompt", "llm", "model.create", "inference",
  ]) {
    assert.ok(!code.toLowerCase().includes(forbidden), `the sensitivity path must not reference "${forbidden}"`);
  }
  assert.ok(!/\b(await|async|then\s*\(|setTimeout|setInterval)\b/.test(code), "the render path is fully synchronous");

  // 4) NO FORECASTING OR CAUSAL CLAIMS in shipped copy. The dictionaries are
  //    the only source of user-visible text, so they are what must stay clean.
  const dictionaries = app.slice(app.indexOf("const BRIDGE_DICTIONARIES"), app.indexOf("let bridgeI18n"));
  const [, enBlock, esBlock] = dictionaries.match(/en: Object\.freeze\(\{([\s\S]*?)\}\),\s*es: Object\.freeze\(\{([\s\S]*?)\}\),/);
  // The GUARD line is excluded and asserted separately below: it is the one
  // string that may name a forecast or a causal effect, because its whole job
  // is to DENY being either. Everything else is then scanned with no exception.
  const ssCopy = (block) => block.split("\n")
    .filter((line) => line.includes('"ss.') && !line.includes('"ss.guard.'))
    .join("\n").toLowerCase();
  for (const block of [ssCopy(enBlock), ssCopy(esBlock)]) {
    assert.ok(block.length > 400, "the scenario copy block was located");
    for (const forbidden of [
      "forecast", "predict", "projected", "expected", "future", "previsión", "previsto",
      "pronóstico", "futuro", "impact", "causal", "effect", "efecto", "intervention",
      "intervención", "policy", "política", "recommend", "recomend", "will increase",
      "will decrease", "aumentará", "disminuirá", "caused by", "causado por",
      "better", "worse", "mejor", "peor", "winner", "ganador",
    ]) {
      assert.ok(!block.includes(forbidden), `shipped scenario copy never says "${forbidden}"`);
    }
  }
  // The guard explicitly DENIES being a forecast or a causal effect, in both
  // languages. This is the one place those words may appear.
  assert.match(enBlock, /"ss\.guard\.window-sensitivity-only": "Alternative analytical window · not a forecast and not a causal effect"/);
  assert.match(esBlock, /"ss\.guard\.window-sensitivity-only": "Ventana analítica alternativa · no es una previsión ni un efecto causal"/);
  // The summary claims observation between two windows, never robustness.
  assert.match(enBlock, /"ss\.status\.STABLE": "Stable under this window change"/);
  assert.ok(!/"ss\.status\.STABLE": "[^"]*[Rr]obust/.test(enBlock), "the summary never claims robustness");

  // 5) Localization: every user-visible string resolves through the shared
  //    dictionary-backed translator, in BOTH languages, with no gaps.
  const SS_KEYS = [
    "ss.title", "ss.subtitle", "ss.empty", "ss.capture", "ss.recapture", "ss.reset",
    "ss.baseline", "ss.scenario", "ss.readingBaseline", "ss.readingScenario",
    "ss.windowUnchanged", "ss.notice.center-changed", "ss.notice.evidence-changed",
    "ss.status.STABLE", "ss.status.MIXED", "ss.status.LIMITED", "ss.status.EVIDENCE_CHANGED",
    "ss.transition.UNCHANGED_COMPARABLE", "ss.transition.DIRECTION_CHANGED",
    "ss.transition.BASIS_CHANGED", "ss.transition.BECAME_WITHHELD",
    "ss.transition.BECAME_COMPARABLE", "ss.transition.WITHHELD_UNCHANGED",
    "ss.transition.WITHHELD_REASON_CHANGED", "ss.transition.EVIDENCE_CHANGED",
    "ss.changedBy", "ss.noNumericChange", "ss.guard.window-sensitivity-only",
    "ss.a11y.captured", "ss.a11y.reset",
  ];
  for (const key of SS_KEYS) {
    assert.ok(enBlock.includes(`"${key}":`), `EN dictionary defines ${key}`);
    assert.ok(esBlock.includes(`"${key}":`), `ES dictionary defines ${key}`);
  }
  // Every transition and status code in the taxonomy has copy in both languages.
  for (const transitionCode of Object.values(SENSITIVITY_TRANSITION)) {
    assert.ok(enBlock.includes(`"ss.transition.${transitionCode}":`), `EN copy for ${transitionCode}`);
    assert.ok(esBlock.includes(`"ss.transition.${transitionCode}":`), `ES copy for ${transitionCode}`);
  }
  for (const statusCode of Object.values(SENSITIVITY_STATUS)) {
    assert.ok(enBlock.includes(`"ss.status.${statusCode}":`), `EN copy for ${statusCode}`);
    assert.ok(esBlock.includes(`"ss.status.${statusCode}":`), `ES copy for ${statusCode}`);
  }
  // The B − A notation uses a real minus sign in the Spanish copy too.
  assert.match(esBlock, /"ss\.transition\.DIRECTION_CHANGED": "El signo de B − A cambió"/);
  // The Spanish copy is idiomatic, not a machine-literal calque.
  assert.match(esBlock, /"ss\.baseline": "Ventana de línea base"/);
  assert.match(esBlock, /"ss\.transition\.BECAME_WITHHELD": "La comparación pasó a retenida"/);
  // Shared keys are NOT duplicated: metric names, units, bases and withheld
  // reasons resolve through the Bridge/Insight keys, so wording cannot drift.
  assert.match(code, /bridgeT\(`metric\.\$\{item\.metricId\}`\)/);
  assert.match(code, /bridgeT\(`basis\.\$\{item\.baseline\.basisCode\}`\)/);
  assert.match(code, /return bridgeWithheldText\(side\.withheldReasonCode\);/);
  assert.match(code, /return decisionInsightRelationshipText\(side\);/);
  // No user-visible string is hardcoded in the renderer: every one goes through
  // bridgeT(...). The only literals are separators and the sign.
  const renderLiterals = [...code.matchAll(/textContent = ("(?!")[^"]*")/g)].map((match) => match[1]);
  assert.deepEqual(renderLiterals.filter((literal) => literal !== '""'), [], "no hardcoded user-visible copy");

  // 6) Markup + placement: inside the Lens A ↔ Lens B panel, after Decision
  //    Insight and before the full comparison table.
  assert.match(html, /id="spatialSensitivity"/);
  assert.match(html, /<h3 id="spatialSensitivityHeading"/, "a semantic heading, not a styled div");
  assert.match(html, /aria-labelledby="spatialSensitivityHeading"/);
  assert.match(html, /<ul id="spatialSensitivityItems"/, "items are a real list");
  assert.match(html, /<dl id="spatialSensitivityWindows"/, "the two windows are a description list");
  const panel = html.slice(html.indexOf('<div id="compareLine"'), html.indexOf('<div id="cmpEvidence"'));
  assert.ok(panel.includes('id="spatialSensitivity"'), "it lives inside the Lens A to Lens B panel");
  assert.ok(panel.indexOf('id="comparisonBridge"') < panel.indexOf('id="spatialSensitivity"'), "Bridge precedes it");
  assert.ok(panel.indexOf('id="decisionInsight"') < panel.indexOf('id="spatialSensitivity"'), "Decision Insight precedes it");
  assert.ok(panel.indexOf('id="spatialSensitivity"') < panel.indexOf('class="comparetable"'), "it precedes the full table");
  // It is NOT a map widget and NOT a modal, and it draws no baseline circles.
  assert.ok(!html.slice(html.indexOf('<div id="map"'), html.indexOf('<div id="compareLine"')).includes('id="spatialSensitivity"'));
  const ssSection = html.slice(html.indexOf('<section id="spatialSensitivity"'), html.indexOf("</section>", html.indexOf('<section id="spatialSensitivity"')));
  assert.ok(!/role="dialog"|aria-modal|<dialog/.test(ssSection), "no modal");
  // No ghost baseline circles on the map in V1.
  assert.ok(!/baselineCircle|ghostCircle|baselineHalo/.test(app), "V1 draws no baseline circles or halos on the map");

  // 7) Accessibility: a semantic heading, exactly two labelled buttons, radii
  //    readable as text, and a RESTRAINED announcement strategy — the live
  //    region is written only on capture/reset, never on a radius change.
  assert.match(ssSection, /<button type="button" id="spatialSensitivityCapture"/);
  assert.match(ssSection, /<button type="button" id="spatialSensitivityReset"/);
  assert.equal((ssSection.match(/<button/g) || []).length, 2, "exactly two tab stops");
  assert.ok(!/tabindex/.test(ssSection), "no manufactured tab stops");
  assert.equal((ssSection.match(/aria-live/g) || []).length, 1, "a single polite live region");
  assert.match(ssSection, /<p id="spatialSensitivityA11y" class="sr-only" aria-live="polite">/);
  // The announcement is fired ONLY from the discrete capture/reset paths, so a
  // radius drag cannot flood assistive technology.
  assert.match(code, /function announceSpatialSensitivity\(/);
  const announceCalls = [...code.matchAll(/announceSpatialSensitivity\(/g)];
  assert.equal(announceCalls.length, 3, "defined once, called only from capture and reset");
  assert.ok(!/renderSpatialSensitivity\(\)[\s\S]{0,80}announceSpatialSensitivity/.test(code.slice(code.indexOf("function renderSpatialSensitivity"), code.indexOf("function captureSpatialBaseline"))),
    "the per-render path never announces");

  // 8) Reset removes ONLY the stored baseline.
  const reset = code.slice(code.indexOf("function resetSpatialBaseline()"));
  for (const forbidden of ["setRadius", "setLatLng", "activateLens", "setLayerVisible", "renderComparisonBridge", "renderDecisionInsight", "refresh()"]) {
    assert.ok(!reset.includes(forbidden), `reset must not call ${forbidden}`);
  }
  assert.match(reset, /spatialBaseline = null;/);
});

test("the sensitivity stylesheet encodes no judgment colour and no direction colour", () => {
  const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
  const start = css.indexOf("/* SPATIAL WINDOW SENSITIVITY V1");
  assert.ok(start > 0, "the style block exists");
  const ssCss = css.slice(start, css.indexOf(".ss-guard{", start) + 400);
  // Direction is exposed as data for traceability but must never be styled, so
  // a sign can never read as success or failure.
  assert.ok(!/\[data-baseline-direction|\[data-scenario-direction/.test(css),
    "no style anywhere keys on B − A direction");
  // No transition is coloured as good or bad news.
  assert.ok(!/\[data-transition[^\]]*\][^{]*\{[^}]*color/.test(css),
    "no colour is keyed on a transition code");
  // No traffic-light hues in the block.
  for (const judgment of ["green", "red", "#0f0", "#f00", "crimson", "tomato", "orange"]) {
    assert.ok(!ssCss.toLowerCase().includes(judgment), `no "${judgment}" judgment colour`);
  }
  // Focused emphasis must never hide the other items.
  assert.ok(!/\.ss-item\[data-focused="false"\][^{]*\{[^}]*display:\s*none/.test(css));
  assert.match(css, /\.ss-items\[data-has-focus="true"\] \.ss-item\[data-focused="false"\]\{opacity:\.78\}/);
  // Narrow layouts STACK baseline → scenario → transition rather than squeezing
  // three columns; the item is a column flex at every width.
  assert.match(ssCss, /\.ss-item\{display:flex;flex-direction:column/);
  // The heading beats the generic `.panel h3` rule on specificity.
  assert.match(css, /\.spatial-sensitivity \.ss-title\{/);
  // The capture/reset buttons reach a real touch target where the pointer is coarse.
  assert.match(css, /\.ss-button\{min-height:44px/);
});
