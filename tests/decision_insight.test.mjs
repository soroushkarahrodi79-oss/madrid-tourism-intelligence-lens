import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildHaloComparison,
  buildCountPairState,
  buildComparisonBridgeModel,
  buildDecisionInsightModel,
  DECISION_INSIGHT_METRIC_IDS,
  DECISION_INSIGHT_GUARD_CODE,
  decisionInsightDirection,
  decisionInsightStatus,
  BRIDGE_METRIC_IDS,
  COMPARISON_RADIUS_MODE,
  circleAreaKm2,
} from "../js/radial-halo.js";

// DECISION INSIGHT V1 — pure model tests.
//
// Decision Insight is the deterministic SYNTHESIS of the canonical comparison
// set. These tests pin its SEMANTICS (not rendered text): the per-metric
// descriptive state, the arithmetic B − A direction, the delta value/kind, the
// evidence qualifier, the authoritative withheld reason, the fixed canonical
// order and the overall descriptive status.
//
// The model is DERIVED: every number it carries must be the one the authoritative
// Comparison Bridge model already produced. The last blocks prove that
// explicitly, and that no recommendation, ranking or causal vocabulary can enter
// the model, the renderer, the stylesheet or the markup.

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

// Rebuilds EXACTLY the wiring renderCompare() uses: the halo comparison states
// for tourism/stays/utci and the panel pair-state for mobility, each passed
// through buildComparisonBridgeModel() before the Insight ever sees it.
function insightFor(input, { mobilityPairMode } = {}) {
  const comparison = buildHaloComparison(input);
  const radiusMode = input.radiusMode;
  const states = {
    tourism: comparison.metrics.tourism,
    stays: comparison.metrics.stays,
    mobility: buildCountPairState(input.mobility.a, input.mobility.b, mobilityPairMode || radiusMode),
    utci: comparison.metrics.utci,
  };
  const metricModels = {};
  for (const metricId of BRIDGE_METRIC_IDS) {
    metricModels[metricId] = buildComparisonBridgeModel({ metricId, state: states[metricId], radiusMode, radii: input.radii });
  }
  return {
    model: buildDecisionInsightModel({ metricModels, radiusMode, radii: input.radii }),
    metricModels,
    states,
  };
}
const itemFor = (model, metricId) => model.items.find((item) => item.metricId === metricId);

// --- A: equal-radius Tourism, positive count delta -------------------------
test("A equal-radius Tourism yields a positive raw-count B − A", () => {
  const { model, metricModels } = insightFor(baseInput());
  const item = itemFor(model, "tourism");
  assert.equal(item.state, "comparable");
  assert.equal(item.direction, "B_MINUS_A_POSITIVE");
  assert.equal(item.deltaValue, 9);
  assert.equal(item.deltaKind, "count");
  assert.equal(item.basisCode, "raw-counts");
  assert.equal(item.evidenceQualifier, null);
  assert.equal(item.withheldReasonCode, null);
  assert.equal(item.deltaValue, metricModels.tourism.relationship.deltaValue, "the Insight delta IS the Bridge delta");
  assert.equal(model.status, "available");
  assert.equal(model.guardCode, DECISION_INSIGHT_GUARD_CODE);
});

// --- B: equal-radius Tourism, negative count delta -------------------------
test("B equal-radius Tourism yields a negative B − A with no judgment attached", () => {
  const { model } = insightFor(baseInput({ tourism: { a: live(26), b: live(17) } }));
  const item = itemFor(model, "tourism");
  assert.equal(item.state, "comparable");
  assert.equal(item.direction, "B_MINUS_A_NEGATIVE");
  assert.equal(item.deltaValue, -9);
  assert.equal(item.deltaKind, "count");
  // Direction is a sign, never a verdict.
  assert.equal(decisionInsightDirection(-9), "B_MINUS_A_NEGATIVE");
  assert.equal(decisionInsightDirection(9), "B_MINUS_A_POSITIVE");
  assert.equal(decisionInsightDirection(0), "B_MINUS_A_ZERO");
  assert.equal(decisionInsightDirection(null), null);
});

// --- C: observed zero versus a positive value -------------------------------
test("C an observed zero is real evidence and participates in the comparison", () => {
  const { model } = insightFor(baseInput({ tourism: { a: live(0), b: live(4) } }));
  const item = itemFor(model, "tourism");
  assert.equal(item.aEvidence, "ZERO", "zero is ZERO, never N_A");
  assert.equal(item.bEvidence, "VALID");
  assert.equal(item.state, "comparable", "a zero side does not withhold the comparison");
  assert.equal(item.deltaValue, 4);
  assert.equal(item.direction, "B_MINUS_A_POSITIVE");
});

// --- D: both sides zero -----------------------------------------------------
test("D both sides zero compare to a real zero delta, not to missing evidence", () => {
  const { model } = insightFor(baseInput({ tourism: { a: live(0), b: live(0) } }));
  const item = itemFor(model, "tourism");
  assert.equal(item.state, "comparable");
  assert.equal(item.deltaValue, 0);
  assert.equal(item.direction, "B_MINUS_A_ZERO");
  assert.equal(item.withheldReasonCode, null);
  assert.notEqual(item.state, "unavailable");
});

// --- E: unequal-radius Tourism, authorized represented density --------------
test("E unequal-radius Tourism compares by represented-record density", () => {
  const input = baseInput({ radii: { A: 600, B: 1200 }, radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, aoiState: "eligible" });
  const { model, metricModels } = insightFor(input);
  const item = itemFor(model, "tourism");
  const expected = 26 / circleAreaKm2(1200) - 17 / circleAreaKm2(600);
  assert.equal(item.state, "comparable");
  assert.equal(item.deltaKind, "density");
  assert.equal(item.basisCode, "density");
  assert.ok(Math.abs(item.deltaValue - expected) < 1e-9);
  assert.equal(item.deltaValue, metricModels.tourism.relationship.deltaValue);
  // Never the raw-count difference under unequal windows.
  assert.notEqual(item.deltaValue, 9);
  assert.equal(item.direction, "B_MINUS_A_NEGATIVE", "the smaller window carries the higher density here");
});

// --- F: unequal-radius Tourism, AOI condition fails -> withheld -------------
test("F unequal-radius Tourism withholds with the authoritative AOI reason", () => {
  for (const [aoiState, reason] of [["crosses", "aoi-crosses"], ["outside", "aoi-outside"], ["unavailable", "aoi-unavailable"]]) {
    const input = baseInput({ radii: { A: 600, B: 1200 }, radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, aoiState });
    const { model, metricModels } = insightFor(input);
    const item = itemFor(model, "tourism");
    assert.equal(item.state, "withheld", `${aoiState}: both sides have values, the comparison is not authorized`);
    assert.equal(item.deltaValue, null, "no normalized comparison is invented when the model withholds it");
    assert.equal(item.deltaKind, null);
    assert.equal(item.direction, null);
    assert.equal(item.withheldReasonCode, reason);
    assert.equal(item.withheldReasonCode, metricModels.tourism.relationship.withheldReasonCode);
    // Both sides still carry real evidence; withheld is NOT unavailable.
    assert.equal(item.aEvidence, "VALID");
    assert.equal(item.bEvidence, "VALID");
  }
});

// --- G: unequal-radius Tourism, source unavailable --------------------------
test("G unequal-radius Tourism with an unavailable source reports the evidence limitation", () => {
  const input = baseInput({
    radii: { A: 600, B: 1200 }, radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, aoiState: "eligible",
    tourism: { a: unavailable(), b: unavailable() },
  });
  const { model, metricModels } = insightFor(input);
  const item = itemFor(model, "tourism");
  assert.equal(item.state, "unavailable", "missing evidence is unavailable, not merely withheld");
  assert.equal(item.aEvidence, "N_A");
  assert.equal(item.bEvidence, "N_A");
  assert.equal(item.deltaValue, null);
  assert.equal(item.withheldReasonCode, metricModels.tourism.relationship.withheldReasonCode);
  // The evidence limitation is reported, NOT the window mismatch.
  assert.notEqual(item.withheldReasonCode, "different-window-sizes");
});

// --- H: Stays density comparison -------------------------------------------
test("H Stays compares by its own represented catalogue-record density", () => {
  const input = baseInput({ radii: { A: 800, B: 1500 }, radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, aoiState: "eligible", stays: { a: live(9), b: live(3) } });
  const { model, metricModels } = insightFor(input);
  const item = itemFor(model, "stays");
  const expected = 3 / circleAreaKm2(1500) - 9 / circleAreaKm2(800);
  assert.equal(item.state, "comparable");
  assert.equal(item.deltaKind, "density");
  assert.equal(item.unitCode, "stays");
  assert.ok(Math.abs(item.deltaValue - expected) < 1e-9);
  assert.equal(item.deltaValue, metricModels.stays.relationship.deltaValue);
  assert.equal(item.direction, "B_MINUS_A_NEGATIVE");
});

// --- I: Mobility equal-radius valid comparison ------------------------------
test("I Mobility compares normally at equal radii", () => {
  const { model, metricModels } = insightFor(baseInput({ mobility: { a: live(3), b: live(6) } }));
  const item = itemFor(model, "mobility");
  assert.equal(item.state, "comparable");
  assert.equal(item.deltaValue, 3);
  assert.equal(item.deltaKind, "count", "Mobility is never converted into a density comparator");
  assert.equal(item.basisCode, "raw-counts");
  assert.equal(item.deltaValue, metricModels.mobility.relationship.deltaValue);
});

// --- J: Mobility unequal radii with valid evidence --------------------------
test("J Mobility with valid evidence and unequal windows is withheld for window size", () => {
  const input = baseInput({ radii: { A: 700, B: 1600 }, radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, aoiState: "eligible", mobility: { a: live(24), b: live(147) } });
  const { model, metricModels } = insightFor(input);
  const item = itemFor(model, "mobility");
  assert.equal(item.state, "withheld");
  assert.equal(item.withheldReasonCode, "different-window-sizes");
  assert.equal(item.deltaValue, null);
  assert.equal(item.deltaKind, null, "no density comparator is substituted");
  assert.equal(item.aEvidence, "VALID");
  assert.equal(item.bEvidence, "VALID");
  assert.equal(item.withheldReasonCode, metricModels.mobility.relationship.withheldReasonCode);
  // Tourism under the SAME unequal windows still compares by density: the
  // Mobility withholding is per-metric, never global.
  assert.equal(itemFor(model, "tourism").state, "comparable");
  assert.equal(itemFor(model, "tourism").deltaKind, "density");
});

// --- K: Mobility unavailable evidence --------------------------------------
test("K Mobility with unavailable evidence uses the evidence reason, not window size", () => {
  const input = baseInput({ radii: { A: 700, B: 1600 }, radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, aoiState: "eligible", mobility: { a: unavailable(), b: unavailable() } });
  const { model, metricModels } = insightFor(input);
  const item = itemFor(model, "mobility");
  assert.equal(item.state, "unavailable");
  assert.equal(item.aEvidence, "N_A");
  assert.equal(item.bEvidence, "N_A");
  assert.equal(item.deltaValue, null, "nothing is implied, least of all zero");
  assert.notEqual(item.deltaValue, 0);
  assert.notEqual(item.withheldReasonCode, "different-window-sizes", "the evidence limitation is more fundamental");
  assert.equal(item.withheldReasonCode, metricModels.mobility.relationship.withheldReasonCode);
});

// --- L: UTCI valid Celsius difference --------------------------------------
test("L valid UTCI reports a Celsius B − A carrying its model-derived limitation", () => {
  const { model, metricModels } = insightFor(baseInput());
  const item = itemFor(model, "utci");
  assert.equal(item.state, "comparable");
  assert.equal(item.deltaKind, "temperature");
  assert.equal(item.basisCode, "celsius");
  assert.ok(Math.abs(item.deltaValue - (38.1 - 36.4)) < 1e-9);
  assert.equal(item.deltaValue, metricModels.utci.relationship.deltaValue);
  assert.equal(item.evidenceQualifier, "model-derived", "UTCI never loses its model-derived qualifier");
  assert.equal(item.direction, "B_MINUS_A_POSITIVE");
  // Only UTCI carries a model-derived qualifier; the count metrics carry none.
  for (const metricId of ["tourism", "stays", "mobility"]) assert.equal(itemFor(model, metricId).evidenceQualifier, null);
});

// --- M: UTCI OFF -----------------------------------------------------------
test("M UTCI OFF is its own state: not zero, not N/A, not withheld", () => {
  const { model } = insightFor(baseInput({ utci: { enabled: false } }));
  const item = itemFor(model, "utci");
  assert.equal(item.state, "off");
  assert.equal(item.aEvidence, "OFF");
  assert.equal(item.bEvidence, "OFF");
  assert.equal(item.deltaValue, null);
  assert.notEqual(item.deltaValue, 0, "OFF is never zero");
  assert.notEqual(item.state, "unavailable");
  assert.notEqual(item.state, "withheld");
  assert.equal(item.withheldReasonCode, "layer-off");
  // The rest of the canonical set is unaffected.
  assert.equal(itemFor(model, "tourism").state, "comparable");
  assert.equal(model.status, "available");
});

// --- N: UTCI incompatible timestep -----------------------------------------
test("N UTCI with different timesteps reports that authoritative reason", () => {
  const input = baseInput({
    utci: {
      enabled: true, timestepA: "15:00", timestepB: "18:00",
      a: { evidence: "MODEL-DERIVED", mean: 36.4, count: 2 },
      b: { evidence: "MODEL-DERIVED", mean: 38.1, count: 3 },
    },
  });
  const { model, metricModels } = insightFor(input);
  const item = itemFor(model, "utci");
  assert.equal(item.deltaValue, null);
  assert.equal(item.direction, null);
  assert.equal(item.withheldReasonCode, "timesteps-differ");
  assert.equal(item.withheldReasonCode, metricModels.utci.relationship.withheldReasonCode);
  assert.notEqual(item.state, "off", "incompatible evidence is not a disabled layer");
  assert.notEqual(item.state, "comparable");
});

// --- O: every canonical metric unavailable ---------------------------------
test("O when no canonical metric can compare at all, the status is unavailable", () => {
  const input = baseInput({
    tourism: { a: unavailable(), b: unavailable() },
    stays: { a: unavailable(), b: unavailable() },
    mobility: { a: unavailable(), b: unavailable() },
    utci: { enabled: false },
  });
  const { model } = insightFor(input);
  assert.equal(model.status, "unavailable");
  assert.equal(model.items.length, 4, "all four metrics are still reported, honestly");
  for (const item of model.items) {
    assert.equal(item.deltaValue, null);
    assert.equal(item.direction, null);
    assert.ok(item.withheldReasonCode, "every non-comparable metric states a reason");
    assert.ok(["unavailable", "off"].includes(item.state));
  }
  // A missing Bridge model degrades honestly rather than throwing.
  const degraded = buildDecisionInsightModel({ metricModels: {} });
  assert.equal(degraded.status, "unavailable");
  assert.deepEqual(degraded.items.map((item) => item.state), ["unavailable", "unavailable", "unavailable", "unavailable"]);
  assert.equal(buildDecisionInsightModel({ metricModels: null }), null);
  assert.equal(buildDecisionInsightModel(), null);
});

// --- P: mixed valid / withheld / unavailable / off --------------------------
test("P a mixed state keeps every metric's own interpretation", () => {
  const input = baseInput({
    radii: { A: 700, B: 1600 }, radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, aoiState: "eligible",
    tourism: { a: live(17), b: live(26) },          // comparable by density
    stays: { a: unavailable(), b: live(4) },        // one side missing
    mobility: { a: live(24), b: live(147) },        // withheld: window sizes
    utci: { enabled: false },                       // off
  });
  const { model } = insightFor(input);
  assert.deepEqual(
    model.items.map((item) => [item.metricId, item.state]),
    [["tourism", "comparable"], ["stays", "unavailable"], ["mobility", "withheld"], ["utci", "off"]],
    "four different evidence states coexist without collapsing into one",
  );
  assert.equal(model.status, "available", "one comparable metric is enough for an available status");
  // Only the comparable metric carries a number.
  assert.equal(model.items.filter((item) => item.deltaValue !== null).length, 1);
});

// --- overall status is descriptive, never a score --------------------------
test("the status is limited when real values exist but nothing is comparable", () => {
  const input = baseInput({
    radii: { A: 700, B: 1600 }, radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, aoiState: "crosses",
    utci: { enabled: false },
  });
  const { model } = insightFor(input);
  assert.ok(model.items.every((item) => item.state !== "comparable"));
  assert.equal(model.status, "limited");
  // The three states follow from evidence presence alone; nothing is scored.
  assert.equal(decisionInsightStatus([{ state: "comparable", aEvidence: "VALID", bEvidence: "VALID" }]), "available");
  assert.equal(decisionInsightStatus([{ state: "withheld", aEvidence: "VALID", bEvidence: "VALID" }]), "limited");
  assert.equal(decisionInsightStatus([{ state: "unavailable", aEvidence: "N_A", bEvidence: "N_A" }]), "unavailable");
  // A genuine observed zero counts as evidence for the status, too.
  assert.equal(decisionInsightStatus([{ state: "withheld", aEvidence: "ZERO", bEvidence: "N_A" }]), "limited");
});

// --- Q: fixed canonical order ----------------------------------------------
test("Q the canonical metric order is fixed and matches the Bridge/halo order", () => {
  assert.deepEqual([...DECISION_INSIGHT_METRIC_IDS], ["tourism", "stays", "mobility", "utci"]);
  assert.deepEqual([...DECISION_INSIGHT_METRIC_IDS], [...BRIDGE_METRIC_IDS]);
  const { model } = insightFor(baseInput());
  assert.deepEqual(model.items.map((item) => item.metricId), ["tourism", "stays", "mobility", "utci"]);
  // Pedestrian has a different observational contract and stays panel-only.
  assert.ok(!model.items.some((item) => item.metricId === "pedestrian"));
  assert.ok(!DECISION_INSIGHT_METRIC_IDS.includes("pedestrian"));
});

// --- R: no cross-metric ranking or sorting ---------------------------------
test("R items are never reordered by magnitude, in either direction", () => {
  // Magnitudes deliberately descending across the canonical order...
  const descending = insightFor(baseInput({
    tourism: { a: live(0), b: live(900) },
    stays: { a: live(0), b: live(90) },
    mobility: { a: live(0), b: live(9) },
  })).model;
  // ...and deliberately ascending.
  const ascending = insightFor(baseInput({
    tourism: { a: live(0), b: live(1) },
    stays: { a: live(0), b: live(50) },
    mobility: { a: live(0), b: live(400) },
  })).model;
  const order = ["tourism", "stays", "mobility", "utci"];
  assert.deepEqual(descending.items.map((item) => item.metricId), order);
  assert.deepEqual(ascending.items.map((item) => item.metricId), order);
  // No field anywhere marks a "largest difference", "top" or "key" metric.
  for (const model of [descending, ascending]) {
    const keys = new Set(model.items.flatMap((item) => Object.keys(item)).concat(Object.keys(model)));
    for (const forbidden of ["rank", "score", "top", "best", "winner", "primary", "strongest", "importance", "weight", "overall", "composite"]) {
      assert.ok(![...keys].some((key) => key.toLowerCase().includes(forbidden)), `no "${forbidden}" field exists`);
    }
  }
});

// --- S: no recommendation, winner or causal semantics anywhere -------------
test("S neither the model nor the shipped Insight surfaces carry judgment language", () => {
  const { model } = insightFor(baseInput());
  const modelJson = JSON.stringify(model);
  const sources = {
    "decision insight model": fs.readFileSync(new URL("../js/radial-halo.js", import.meta.url), "utf8"),
    "decision insight renderer": fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8"),
    "decision insight markup": fs.readFileSync(new URL("../index.html", import.meta.url), "utf8"),
    "decision insight styles": fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8"),
    "decision insight doc": fs.readFileSync(new URL("../docs/DECISION_INSIGHT_V1.md", import.meta.url), "utf8"),
    "decision insight model output": modelJson,
  };
  // Judgment / causal phrasings the comparison contract cannot support. These
  // are the exact claim shapes the gate forbids, so they must appear in no
  // shipped source, template, doc or model output.
  const FORBIDDEN = [
    "better suited", "underperform", "outperform", "is better", "performs better",
    "should receive", "we recommend", "recommended for", "best choice", "winner is",
    "more successful", "higher is better", "dangerously hotter", "tourists will avoid",
    "because demand", "because tourism", "causes greater", "implies overtourism",
  ];
  for (const [label, text] of Object.entries(sources)) {
    const lower = text.toLowerCase();
    for (const phrase of FORBIDDEN) {
      assert.ok(!lower.includes(phrase), `${label} must not contain "${phrase}"`);
    }
  }
  // The model's own vocabulary is a closed set of neutral codes.
  for (const item of model.items) {
    assert.ok(["comparable", "withheld", "unavailable", "off"].includes(item.state));
    assert.ok(item.direction === null || ["B_MINUS_A_POSITIVE", "B_MINUS_A_NEGATIVE", "B_MINUS_A_ZERO"].includes(item.direction));
    assert.ok(item.deltaKind === null || ["count", "density", "temperature"].includes(item.deltaKind));
  }
  assert.ok(["available", "limited", "unavailable"].includes(model.status));
  assert.equal(model.guardCode, "descriptive-only");
  // No composite, aggregate or numeric-confidence field exists at model level.
  assert.deepEqual(Object.keys(model).sort(), ["guardCode", "items", "radii", "radiusMode", "status"]);
  assert.ok(!/"(confidence|score|rating|rank|overall)"/.test(modelJson));
});

// --- T: the Insight delta IS the Bridge delta, in every state --------------
test("T every Insight item is read through from the authoritative Bridge model", () => {
  const scenarios = [
    baseInput(),
    baseInput({ radii: { A: 600, B: 1200 }, radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, aoiState: "eligible" }),
    baseInput({ radii: { A: 600, B: 1200 }, radiusMode: COMPARISON_RADIUS_MODE.UNEQUAL, aoiState: "crosses" }),
    baseInput({ tourism: { a: live(0), b: live(0) }, utci: { enabled: false } }),
    baseInput({ tourism: { a: unavailable(), b: live(5) }, mobility: { a: unavailable(), b: unavailable() } }),
  ];
  for (const input of scenarios) {
    const { model, metricModels, states } = insightFor(input);
    for (const item of model.items) {
      const bridge = metricModels[item.metricId];
      const rel = bridge.relationship;
      assert.equal(item.state === "comparable", rel.comparable, `${item.metricId}: one comparability verdict`);
      assert.equal(item.deltaValue, rel.comparable ? rel.deltaValue : null, `${item.metricId}: identical delta`);
      assert.equal(item.deltaKind, rel.comparable ? rel.deltaKind : null);
      assert.equal(item.basisCode, rel.comparable ? rel.basisCode : null);
      assert.equal(item.withheldReasonCode, rel.comparable ? null : rel.withheldReasonCode, `${item.metricId}: identical reason`);
      assert.equal(item.aEvidence, bridge.a.evidence);
      assert.equal(item.bEvidence, bridge.b.evidence);
      // ...and the Bridge delta is itself the table state's delta, so the chain
      // evidence -> state -> Bridge -> Insight carries ONE number end to end.
      if (rel.comparable) assert.equal(item.deltaValue, states[item.metricId].delta, `${item.metricId}: identical to the table state`);
    }
  }
});

// --- production wiring + localization (source-level guards) -----------------
test("the app renders the Insight from the authoritative models, in both languages, with no runtime LLM", () => {
  const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

  // 1) One derivation chain: the renderer consumes Bridge models, never raw
  //    evidence, and never re-implements the comparison arithmetic.
  assert.match(app, /function renderDecisionInsight\(/);
  assert.match(app, /function buildBridgeMetricModels\(\)/);
  assert.match(app, /models\[metricId\] = buildComparisonBridgeModel\(\{/);
  assert.match(app, /buildDecisionInsightModel\(\{\s*metricModels: buildBridgeMetricModels\(\)/);
  // It is rebuilt from the authoritative states renderCompare() captured.
  assert.match(app, /lastBridgeContext = \{ radiusMode, radii: \{ \.\.\.radii \} \};\s*renderComparisonBridge\(\);\s*renderDecisionInsight\(\);/);
  // Metric focus only re-applies emphasis; it never rebuilds or hides items.
  // Sibling derived surfaces may re-apply their own emphasis at the same point
  // (Spatial Sensitivity does), so the gap allows further `apply…Focus()` calls
  // and nothing else — the next assertion proves no surface is REBUILT here.
  assert.match(app, /applyDecisionInsightFocus\(\);\s*(?:apply\w+Focus\(\);\s*)*window\.dispatchEvent\(new CustomEvent\("halo:metricfocus"/);
  assert.match(app, /function applyDecisionInsightFocus\(\)/);
  // The focus machine must never call a render* rebuild: focus changes emphasis
  // only, so no derived surface can lose or recompute its items on hover.
  const focusMachine = app.slice(app.indexOf("function setHaloMetricFocus("), app.indexOf('new CustomEvent("halo:metricfocus"'));
  assert.ok(focusMachine.length > 200, "the focus machine was located");
  assert.ok(!/\brenderDecisionInsight\(/.test(focusMachine), "metric focus never rebuilds the Insight");
  assert.ok(!/\brenderSpatialSensitivity\(/.test(focusMachine), "metric focus never rebuilds Spatial Sensitivity");

  // 2) The withheld clause reuses the Bridge's single authoritative text, so a
  //    withheld Insight line and the Bridge qualifier can never diverge.
  assert.match(app, /return bridgeWithheldText\(item\.withheldReasonCode\);/);
  // Metric names resolve through the same dictionary keys as the Bridge/table.
  assert.match(app, /name\.textContent = bridgeT\(`metric\.\$\{item\.metricId\}`\)/);

  // 3) NO RUNTIME LLM: no generative service, no model API and no network call
  //    on the Insight path. The whole surface is dictionary templates over codes.
  //    Comments are stripped first, so the scan judges EXECUTABLE code — a
  //    comment documenting the prohibition must not read as a violation of it.
  // The slice ends at the next surface's banner, so this scan judges the
  // Decision Insight renderer itself. Spatial Sensitivity carries its own
  // equivalent no-runtime-LLM scan in tests/spatial_sensitivity.test.mjs.
  const insightSection = app.slice(app.indexOf("// --- Decision Insight ---"), app.indexOf("// --- Spatial Window Sensitivity ---"));
  assert.ok(insightSection.length > 500, "the Insight renderer section was located");
  const insightCode = insightSection.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  assert.ok(!/\/\//.test(insightCode.replace(/https?:\/\//g, "")), "all comments were stripped before scanning");
  for (const forbidden of [
    "fetch(", "xmlhttprequest", "websocket", "eventsource", "sendbeacon", "import(", "navigator.",
    "anthropic", "openai", "completion", "generate", "prompt", "llm", "model.create", "inference",
  ]) {
    assert.ok(!insightCode.toLowerCase().includes(forbidden), `the Insight path must not reference "${forbidden}"`);
  }
  // The renderer's only data source is the pure model, and its only output is
  // DOM text — nothing asynchronous and nothing awaited.
  assert.ok(!/\b(await|async|then\s*\(|setTimeout|setInterval)\b/.test(insightCode), "the Insight render path is fully synchronous");

  // 4) Localization: every user-visible string resolves through the shared
  //    dictionary-backed translator, in BOTH languages, with no gaps.
  const INSIGHT_KEYS = [
    "insight.title", "insight.subtitle", "insight.bMinusA",
    "insight.status.available", "insight.status.limited", "insight.status.unavailable",
    "insight.guard.descriptive-only", "insight.qualifier.model-derived",
    "insight.unit.count.tourism", "insight.unit.count.stays", "insight.unit.count.mobility",
    "insight.unit.density.tourism", "insight.unit.density.stays",
  ];
  const dictionaries = app.slice(app.indexOf("const BRIDGE_DICTIONARIES"), app.indexOf("let bridgeI18n"));
  const [, enBlock, esBlock] = dictionaries.match(/en: Object\.freeze\(\{([\s\S]*?)\}\),\s*es: Object\.freeze\(\{([\s\S]*?)\}\),/);
  for (const key of INSIGHT_KEYS) {
    assert.ok(enBlock.includes(`"${key}":`), `EN dictionary defines ${key}`);
    assert.ok(esBlock.includes(`"${key}":`), `ES dictionary defines ${key}`);
  }
  // The B − A notation uses a real minus sign, identically in both languages.
  assert.equal((dictionaries.match(/"insight\.bMinusA": "B − A"/g) || []).length, 2);
  // The descriptive guard exists in both languages and never promises advice.
  assert.match(enBlock, /"insight\.guard\.descriptive-only": "Observed comparison only · no ordering or recommendation"/);
  assert.match(esBlock, /"insight\.guard\.descriptive-only": "Comparación observada · sin ordenación ni recomendación"/);
  // Stays keeps its own catalogue-record unit wording, matching the table.
  assert.match(enBlock, /"insight\.unit\.density\.stays": "catalogue records\/km²"/);
  assert.match(esBlock, /"insight\.unit\.density\.stays": "registros de catálogo\/km²"/);
  // No user-visible Insight string is hardcoded in the renderer: every one goes
  // through bridgeT(...). The only literals are separators and the sign.
  const renderLiterals = [...insightCode.matchAll(/textContent = ("(?!")[^"]*")/g)].map((match) => match[1]);
  assert.deepEqual(renderLiterals, [], "no hardcoded user-visible copy in the renderer");

  // 5) Markup + placement: inside the Lens A ↔ Lens B panel, between the
  //    Comparison Bridge and the full comparison table.
  assert.match(html, /id="decisionInsight"/);
  assert.match(html, /<h3 id="decisionInsightHeading"/, "a semantic heading, not a styled div");
  assert.match(html, /aria-labelledby="decisionInsightHeading"/);
  assert.match(html, /<ul id="decisionInsightItems"/, "items are a real list");
  assert.match(html, /id="decisionInsightGuard"/);
  const panel = html.slice(html.indexOf('<div id="compareLine"'), html.indexOf('<div id="cmpEvidence"'));
  assert.ok(panel.includes('id="decisionInsight"'), "the Insight lives inside the Lens A to Lens B panel");
  assert.ok(panel.indexOf('id="comparisonBridge"') < panel.indexOf('id="decisionInsight"'), "Bridge precedes Decision Insight");
  assert.ok(panel.indexOf('id="decisionInsight"') < panel.indexOf('class="comparetable"'), "Decision Insight precedes the full table");
  // It is not placed over the map or inside a floating map popup.
  assert.ok(!html.slice(html.indexOf('<div id="map"'), html.indexOf('<div id="compareLine"')).includes('id="decisionInsight"'));

  // 6) Accessibility: no interactive control, so no extra tab stop, and no
  //    aria-live chatter on hover-driven emphasis.
  const section = html.slice(html.indexOf('<section id="decisionInsight"'), html.indexOf("</section>", html.indexOf('<section id="decisionInsight"')));
  assert.ok(!/<button|<a |tabindex|role="button"/.test(section), "the Insight adds no tab stop");
  assert.ok(!section.includes("aria-live"), "no aria-live announcement on hover-driven emphasis");
});

test("the Insight stylesheet encodes no judgment colour and no direction colour", () => {
  const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
  const start = css.indexOf("/* DECISION INSIGHT V1");
  assert.ok(start > 0, "the Insight style block exists");
  const insightCss = css.slice(start, css.indexOf(".di-guard{", start) + 400);
  // Direction is exposed as data for traceability but must never be styled, so
  // a sign can never read as success or failure.
  assert.ok(!/\[data-direction/.test(insightCss), "the Insight styles never key on B − A direction");
  assert.ok(!/\[data-direction[^\]]*\][^{]*\{[^}]*color/.test(css), "no colour anywhere is keyed on direction");
  // No traffic-light hues in the Insight block.
  for (const judgment of ["green", "red", "#0f0", "#f00", "crimson", "tomato"]) {
    assert.ok(!insightCss.toLowerCase().includes(judgment), `no "${judgment}" judgment colour`);
  }
  // Focused emphasis must never hide the other items.
  assert.ok(!/\.di-item\[data-focused="false"\][^{]*\{[^}]*display:\s*none/.test(css));
  assert.match(css, /\.di-items\[data-has-focus="true"\] \.di-item\[data-focused="false"\]\{opacity:\.78\}/);
  // Narrow viewports stack the item instead of shrinking or clipping it.
  assert.match(css, /\.di-item\{grid-template-columns:1fr/);
  // The heading beats the generic `.panel h3` rule on specificity.
  assert.match(css, /\.decision-insight \.di-title\{/);
});
