// K10 ámbito comparison against the REAL committed artifacts (#72, Gate B).
//
// These tests load data/planning/madrid_ambitos.geojson and
// data/planning/madrid_ambito_state.json and exercise the model through the real
// K6 readers and the real K7 change-detection classifier — not synthetic
// fixtures. They assert behaviour on representative official codes with published
// comparable evidence, missing evidence, multiple buildability rows, real
// published zeros, and an edition difference whose continuity K7 leaves
// unresolved. Exact official identifiers (including `-RP`) are preserved.

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createPlanningIndex } from "../js/planning-ambito.js";
import * as changeModule from "../js/ambito-change.js";
import {
  buildCurrentAmbitoInput,
  reconstructPreviousStateArtifact,
  buildPreviousAmbitoInput,
  editionOutcomes,
  governingContinuityOutcome,
} from "../js/ambito-comparison-adapter.js";
import {
  WITHHELD_REASON,
  CATEGORICAL_RELATION,
  AMBITO_SENSITIVITY_TRANSITION,
  CONTINUITY_REASON,
  buildAmbitoComparisonModel,
  buildAmbitoEditionSensitivity,
  editionContinuityFromOutcome,
  ambitoComparisonRows,
} from "../js/ambito-comparison.js";

const geometry = JSON.parse(fs.readFileSync(new URL("../data/planning/madrid_ambitos.geojson", import.meta.url)));
const stateArtifact = JSON.parse(fs.readFileSync(new URL("../data/planning/madrid_ambito_state.json", import.meta.url)));
const index = createPlanningIndex({ geometry, state: stateArtifact });

const current = (code) => buildCurrentAmbitoInput(code, index);

test("real artifacts load and the index is built over the committed universe", () => {
  assert.ok(index);
  assert.ok(index.counts.ambitos >= 700);
});

test("real current-edition comparison: two single-row published ámbitos are comparable, a real published 0 participates", () => {
  // AOE.00.03 and AOE.00.06 both publish a single buildability row with a real 0
  // for collective residential (verified against the committed artifact).
  const model = buildAmbitoComparisonModel(current("AOE.00.03"), current("AOE.00.06"));
  assert.equal(model.comparable, true);
  assert.equal(model.a.ambitoCode, "AOE.00.03");
  assert.equal(model.b.ambitoCode, "AOE.00.06");
  const collective = model.metrics.find((m) => m.id === "buildability_residential_collective");
  assert.equal(collective.a.state, "PUBLISHED");
  assert.equal(collective.b.state, "PUBLISHED");
  assert.equal(collective.a.value, 0); // a real published zero, not missing
  assert.equal(collective.comparable, true);
  assert.equal(collective.deltaValue, 0); // 0 − 0, a genuine comparable zero
  // every quantity delta that is comparable equals b − a of the published values
  for (const m of model.metrics.filter((x) => x.kind === "QUANTITY" && x.comparable)) {
    assert.equal(m.deltaValue, m.b.value - m.a.value);
  }
});

test("real multiple-row ámbito (APE.21.02) withholds every buildability metric, never combined", () => {
  const model = buildAmbitoComparisonModel(current("APE.21.02"), current("AOE.00.03"));
  for (const id of ["buildability_residential_collective", "buildability_residential_single_family", "buildability_tertiary", "buildability_industrial"]) {
    const m = model.metrics.find((x) => x.id === id);
    assert.equal(m.comparable, false);
    assert.equal(m.withheldReasonCode, WITHHELD_REASON.MULTIPLE_ROWS_NOT_COMBINED);
  }
});

test("real missing-evidence ámbito (AOE.00.08, not published in edition) yields indeterminate phases and withheld quantities", () => {
  const model = buildAmbitoComparisonModel(current("AOE.00.08"), current("AOE.00.03"));
  for (const m of model.metrics.filter((x) => x.kind === "CATEGORICAL")) {
    assert.equal(m.relation, CATEGORICAL_RELATION.INDETERMINATE);
  }
  const surface = model.metrics.find((m) => m.id === "ambito_surface");
  assert.equal(surface.comparable, false);
  assert.equal(surface.withheldReasonCode, WITHHELD_REASON.VALUE_NOT_PUBLISHED);
});

test("exact official identifiers are preserved, including -RP", () => {
  const code = Object.keys(stateArtifact.ambitos).find((c) => c.endsWith("-RP"));
  assert.ok(code, "the committed universe contains a -RP ámbito");
  const model = buildAmbitoComparisonModel(current(code), current("AOE.00.03"));
  assert.equal(model.a.ambitoCode, code); // verbatim, no suffix stripping
  assert.equal(ambitoComparisonRows(model).length, 9);
});

test("real edition continuity is derived from the K7 classifier, not a flag", () => {
  // AOE.00.03: both families NO_CHANGE → identity continuous.
  const contOutcomes = editionOutcomes("AOE.00.03", stateArtifact, changeModule);
  assert.ok(["NO_CHANGE", "STATE_TRANSITION"].includes(governingContinuityOutcome(contOutcomes)));
  assert.equal(editionContinuityFromOutcome(governingContinuityOutcome(contOutcomes)).established, true);

  // APE.21.02 (Barajas): S2 is CAUSE_UNRESOLVED → identity NOT continuous.
  const unresolved = editionOutcomes("APE.21.02", stateArtifact, changeModule);
  assert.equal(unresolved.S2, "CAUSE_UNRESOLVED");
  const cont = editionContinuityFromOutcome(governingContinuityOutcome(unresolved));
  assert.equal(cont.established, false);
  assert.equal(cont.reasonCode, CONTINUITY_REASON.CAUSE_UNRESOLVED);
});

test("real edition sensitivity over a continuous pair: previous edition rebuilt from committed records, each family's own dates kept", () => {
  const previousArtifact = reconstructPreviousStateArtifact(stateArtifact);
  assert.ok(previousArtifact);
  // AOE.00.03 and AOE.00.06 are both single-row, identity-continuous.
  const curModel = buildAmbitoComparisonModel(current("AOE.00.03"), current("AOE.00.06"));
  const prevModel = buildAmbitoComparisonModel(
    buildPreviousAmbitoInput("AOE.00.03", previousArtifact),
    buildPreviousAmbitoInput("AOE.00.06", previousArtifact)
  );
  const continuity = {
    a: editionContinuityFromOutcome(governingContinuityOutcome(editionOutcomes("AOE.00.03", stateArtifact, changeModule))),
    b: editionContinuityFromOutcome(governingContinuityOutcome(editionOutcomes("AOE.00.06", stateArtifact, changeModule))),
  };
  const sens = buildAmbitoEditionSensitivity(curModel, prevModel, continuity);
  assert.equal(sens.applicable, true);
  assert.equal(sens.identityEstablished, true);
  const valid = new Set(Object.values(AMBITO_SENSITIVITY_TRANSITION));
  for (const item of sens.items) {
    assert.ok(valid.has(item.code), `${item.metricId} → ${item.code}`);
    // S1 reference dates for phase/surface, S2 for buildability — both the real
    // committed 2026-01-01 (scenario) and 2025-07-01 (baseline) dates.
    assert.equal(item.scenarioReferenceDate.a, "2026-01-01");
    assert.equal(item.baselineReferenceDate.a, "2025-07-01");
  }
});

// ---------------------------------------- F1: continuity fails closed

test("F1 — absent K7 evidence (both families null) fails closed, never silent NO_CHANGE", () => {
  const outcome = governingContinuityOutcome({ S1: null, S2: null });
  assert.equal(outcome, "NO_EVIDENCE");
  const cont = editionContinuityFromOutcome(outcome);
  assert.equal(cont.established, false);
  assert.equal(cont.reasonCode, CONTINUITY_REASON.NO_EVIDENCE);
});

test("F1 — one positive family carries identity even when the other is an inapplicable (null) family", () => {
  // S1 positively NO_CHANGE, S2 has no row (null) → established via S1.
  assert.equal(governingContinuityOutcome({ S1: "NO_CHANGE", S2: null }), "NO_CHANGE");
  assert.equal(editionContinuityFromOutcome(governingContinuityOutcome({ S1: "NO_CHANGE", S2: null })).established, true);
  assert.equal(editionContinuityFromOutcome(governingContinuityOutcome({ S1: "STATE_TRANSITION", S2: null })).outcome, "STATE_TRANSITION");
});

test("F1 — a break in EITHER family governs, even beside an apparently valid family", () => {
  assert.equal(governingContinuityOutcome({ S1: "ABSENT_FROM_EDITION", S2: "NO_CHANGE" }), "ABSENT_FROM_EDITION");
  assert.equal(governingContinuityOutcome({ S1: "NO_CHANGE", S2: "CAUSE_UNRESOLVED" }), "CAUSE_UNRESOLVED");
  assert.equal(editionContinuityFromOutcome(governingContinuityOutcome({ S1: "ABSENT_FROM_EDITION", S2: "NO_CHANGE" })).established, false);
});

test("F1 — a valid pair establishes continuity", () => {
  assert.equal(editionContinuityFromOutcome(governingContinuityOutcome({ S1: "NO_CHANGE", S2: "STATE_TRANSITION" })).established, true);
});

test("real edition sensitivity refuses a non-continuous entity (APE.21.02) — every metric withheld", () => {
  const previousArtifact = reconstructPreviousStateArtifact(stateArtifact);
  const curModel = buildAmbitoComparisonModel(current("APE.21.02"), current("AOE.00.03"));
  const prevModel = buildAmbitoComparisonModel(
    buildPreviousAmbitoInput("APE.21.02", previousArtifact),
    buildPreviousAmbitoInput("AOE.00.03", previousArtifact)
  );
  const continuity = {
    a: editionContinuityFromOutcome(governingContinuityOutcome(editionOutcomes("APE.21.02", stateArtifact, changeModule))),
    b: editionContinuityFromOutcome(governingContinuityOutcome(editionOutcomes("AOE.00.03", stateArtifact, changeModule))),
  };
  const sens = buildAmbitoEditionSensitivity(curModel, prevModel, continuity);
  assert.equal(sens.identityEstablished, false);
  for (const item of sens.items) assert.equal(item.code, AMBITO_SENSITIVITY_TRANSITION.WITHHELD_NON_CONTINUOUS);
});
