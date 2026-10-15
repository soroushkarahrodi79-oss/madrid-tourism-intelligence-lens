// Canonical PLANNING_AMBITO comparison — the contract these tests defend (K10, #72).
//
// THE DECISIVE CONTRACTS:
//
//   1. No categorical metric ever produces a numeric delta — not even for
//      identical states. The four phases are a vocabulary, not a scale.
//   2. An ámbito compared against a Lens circle is REFUSED with a stated reason,
//      and no code path coerces it into a comparison.
//   3. Two ámbitos from different editions are WITHHELD by default and only
//      proceed with an explicit documented basis.
//   4. A MODIFIED_BY_INSTRUMENT pair is withheld, never compared.
//   5. Bridge, Insight, table and sensitivity read ONE authoritative state; none
//      recomputes a relation or a delta.
//   6. Insight order is fixed and canonical under permuted input.
//   7. Radius sensitivity states non-applicability and retains no baseline.
//   8. Both dictionaries define every key and carry no ordering/recommendation
//      vocabulary.

import assert from "node:assert/strict";
import test from "node:test";
import {
  AMBITO_METRIC_IDS,
  METRIC_KIND,
  CATEGORICAL_RELATION,
  WITHHELD_REASON,
  AMBITO_SENSITIVITY_TRANSITION,
  CONTINUITY_REASON,
  AMBITO_COMPARISON_DICTIONARIES,
  buildAmbitoComparisonModel,
  ambitoBridgeReading,
  ambitoDecisionInsightItems,
  ambitoComparisonRows,
  ambitoComparisonStatus,
  ambitoRadiusSensitivityStatus,
  editionContinuityFromOutcome,
  buildAmbitoEditionSensitivity,
} from "../js/ambito-comparison.js";

// Both ámbitos identity-continuous across the editions (K7 NO_CHANGE/STATE_TRANSITION).
const CONTINUOUS = { a: editionContinuityFromOutcome("NO_CHANGE"), b: editionContinuityFromOutcome("STATE_TRANSITION") };

// ---------------------------------------------------------------- fixture builders

const EDITION_CURRENT = {
  development_state: "S1:2026-01:585db074c122",
  available_buildability: "S2:2026-01:326edf48d221",
};
const EDITION_PREVIOUS = {
  development_state: "S1:2025-07:e1ff3e0e0f63",
  available_buildability: "S2:2025-07:09f6859a2541",
};
const REF_CURRENT = "2026-01-01";
const REF_PREVIOUS = "2025-07-01";

function phase(sourceValue, kind = "PHASE_VALUE") {
  return { state: "PUBLISHED", sourceValue, kind, vocabulary: "SOURCE_DOCUMENTED" };
}

// Build a planning-ambito-style side input. `phases` is a map field→value string
// (or null for not-published). `build` is a map useClass→value (number|null|"MULTI").
function ambitoSide({
  code = "APE.01.01",
  denomination = "FIXTURE",
  phases = { planeamiento: "Finalizado", gestion: "Finalizado", urbanizacion_proyecto: "Finalizado", urbanizacion_obras: "Finalizado" },
  surface = 1000,
  build = { colectiva_residencial: 100, unifamiliar_residencial: 0, terciario: 50, industrial: null },
  multipleRows = false,
  devEdition = EDITION_CURRENT.development_state,
  buildEdition = EDITION_CURRENT.available_buildability,
  devRef = REF_CURRENT,
  buildRef = REF_CURRENT,
  modifiedByInstrument = false,
  scope = "PLANNING_AMBITO",
  developmentPublished = true,
  buildabilityPublished = true,
} = {}) {
  const phaseList = ["planeamiento", "gestion", "urbanizacion_proyecto", "urbanizacion_obras"].map((key) => {
    const v = phases[key];
    if (v == null) return { key, state: "NOT_PUBLISHED", sourceValue: null, kind: null, vocabulary: null };
    return { key, ...phase(v) };
  });
  const useClasses = ["colectiva_residencial", "unifamiliar_residencial", "industrial", "terciario"].map((key) => {
    const v = build[key];
    if (v === undefined || v === null) return { key, state: "NOT_PUBLISHED", value: null, unit: "m² edificable" };
    return { key, state: "PUBLISHED", value: v, unit: "m² edificable" };
  });
  const rows = multipleRows
    ? [{ situacion: "A", useClasses }, { situacion: "B", useClasses }]
    : [{ situacion: "ONLY", useClasses }];
  return {
    scope,
    ambitoCode: code,
    denomination,
    modifiedByInstrument,
    developmentState: developmentPublished
      ? {
          scope: "PLANNING_AMBITO",
          ambitoCode: code,
          availability: "PUBLISHED",
          denomination,
          surface: surface == null ? { state: "NOT_PUBLISHED", value: null, unit: "m²" } : { state: "PUBLISHED", value: surface, unit: "m²" },
          phases: phaseList,
          edition: { snapshotIdentity: devEdition, referenceDate: devRef },
        }
      : { scope: "PLANNING_AMBITO", ambitoCode: code, availability: "NOT_PUBLISHED_IN_EDITION", phases: [], edition: { snapshotIdentity: devEdition, referenceDate: devRef } },
    availableBuildability: buildabilityPublished
      ? {
          scope: "PLANNING_AMBITO",
          ambitoCode: code,
          availability: "PUBLISHED",
          unit: "m² edificable",
          rows,
          edition: { snapshotIdentity: buildEdition, referenceDate: buildRef },
        }
      : { scope: "PLANNING_AMBITO", ambitoCode: code, availability: "NOT_PUBLISHED_IN_EDITION", rows: [], edition: { snapshotIdentity: buildEdition, referenceDate: buildRef } },
  };
}

function lensCircleSide() {
  return { scope: "LENS_CIRCLE", ambitoCode: null, denomination: null, developmentState: null, availableBuildability: null };
}

const PHASE_METRICS = AMBITO_METRIC_IDS.filter((id) => id.startsWith("phase_"));
const QUANTITY_METRICS = AMBITO_METRIC_IDS.filter((id) => !id.startsWith("phase_"));
const DELTA_KEYS = ["delta", "deltaValue", "deltaKind", "direction", "sign", "difference", "rank", "order", "score"];

// ================================================================= nine metrics

test("the nine canonical metrics are present, in fixed order, each with kind/basis/unit", () => {
  assert.deepEqual(AMBITO_METRIC_IDS, [
    "phase_planeamiento",
    "phase_gestion",
    "phase_urbanizacion_proyecto",
    "phase_urbanizacion_obras",
    "buildability_residential_collective",
    "buildability_residential_single_family",
    "buildability_tertiary",
    "buildability_industrial",
    "ambito_surface",
  ]);
  const model = buildAmbitoComparisonModel(ambitoSide(), ambitoSide({ code: "APE.02.02" }));
  assert.equal(model.metrics.length, 9);
  assert.deepEqual(model.metrics.map((m) => m.id), AMBITO_METRIC_IDS);
  for (const m of model.metrics) {
    assert.ok(m.kind === METRIC_KIND.CATEGORICAL || m.kind === METRIC_KIND.QUANTITY);
    assert.ok(typeof m.basis === "string");
    if (m.kind === METRIC_KIND.QUANTITY) assert.ok(typeof m.unit === "string");
  }
});

// ============================================= categorical never produces a delta

for (const metricId of PHASE_METRICS) {
  test(`categorical metric ${metricId} produces NO numeric delta — identical states`, () => {
    const model = buildAmbitoComparisonModel(
      ambitoSide({ phases: { planeamiento: "Sin Iniciar", gestion: "Sin Iniciar", urbanizacion_proyecto: "Sin Iniciar", urbanizacion_obras: "Sin Iniciar" } }),
      ambitoSide({ code: "APE.02.02", phases: { planeamiento: "Sin Iniciar", gestion: "Sin Iniciar", urbanizacion_proyecto: "Sin Iniciar", urbanizacion_obras: "Sin Iniciar" } })
    );
    const m = model.metrics.find((x) => x.id === metricId);
    assert.equal(m.kind, METRIC_KIND.CATEGORICAL);
    assert.equal(m.relation, CATEGORICAL_RELATION.SAME);
    for (const key of DELTA_KEYS) assert.ok(!(key in m), `${metricId} must not carry "${key}"`);
  });

  test(`categorical metric ${metricId} produces NO numeric delta — different states`, () => {
    const model = buildAmbitoComparisonModel(
      ambitoSide({ phases: { planeamiento: "No Necesita", gestion: "No Necesita", urbanizacion_proyecto: "No Necesita", urbanizacion_obras: "No Necesita" } }),
      ambitoSide({ code: "APE.02.02", phases: { planeamiento: "Sin Iniciar", gestion: "Sin Iniciar", urbanizacion_proyecto: "Sin Iniciar", urbanizacion_obras: "Sin Iniciar" } })
    );
    const m = model.metrics.find((x) => x.id === metricId);
    // `No Necesita` vs `Sin Iniciar` is DIFFERENT, never "behind", never a number.
    assert.equal(m.relation, CATEGORICAL_RELATION.DIFFERENT);
    for (const key of DELTA_KEYS) assert.ok(!(key in m), `${metricId} must not carry "${key}"`);
  });
}

test("no categorical metric carries a numeric leaf anywhere in its object", () => {
  const model = buildAmbitoComparisonModel(ambitoSide(), ambitoSide({ code: "APE.02.02" }));
  for (const m of model.metrics.filter((x) => x.kind === METRIC_KIND.CATEGORICAL)) {
    const numeric = [];
    const walk = (v, path) => {
      if (typeof v === "number") numeric.push(path);
      else if (v && typeof v === "object") for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`);
    };
    walk(m, m.id);
    assert.deepEqual(numeric, [], `categorical ${m.id} must contain no number; found ${numeric.join(", ")}`);
  }
});

test("cosmetic drift (accents, double space) reads SAME; substance reads DIFFERENT", () => {
  const model = buildAmbitoComparisonModel(
    ambitoSide({ phases: { planeamiento: "En  Tramitación", gestion: "Finalizado", urbanizacion_proyecto: "Sin Iniciar", urbanizacion_obras: "No Necesita" } }),
    ambitoSide({ code: "APE.02.02", phases: { planeamiento: "En Tramitacion", gestion: "Finalizado", urbanizacion_proyecto: "No Necesita", urbanizacion_obras: "No Necesita" } })
  );
  const byId = Object.fromEntries(model.metrics.map((m) => [m.id, m]));
  assert.equal(byId.phase_planeamiento.relation, CATEGORICAL_RELATION.SAME); // cosmetic only
  assert.equal(byId.phase_gestion.relation, CATEGORICAL_RELATION.SAME);
  assert.equal(byId.phase_urbanizacion_proyecto.relation, CATEGORICAL_RELATION.DIFFERENT); // Sin Iniciar vs No Necesita
  assert.equal(byId.phase_urbanizacion_obras.relation, CATEGORICAL_RELATION.SAME);
});

// ========================================================= quantity B − A semantics

test("quantity metrics compute B − A in m²; a published 0 participates", () => {
  const model = buildAmbitoComparisonModel(
    ambitoSide({ surface: 1000, build: { colectiva_residencial: 100, unifamiliar_residencial: 0, terciario: 50, industrial: 10 } }),
    ambitoSide({ code: "APE.02.02", surface: 1500, build: { colectiva_residencial: 250, unifamiliar_residencial: 0, terciario: 50, industrial: 40 } })
  );
  const byId = Object.fromEntries(model.metrics.map((m) => [m.id, m]));
  assert.equal(byId.buildability_residential_collective.comparable, true);
  assert.equal(byId.buildability_residential_collective.deltaValue, 150);
  assert.equal(byId.buildability_residential_single_family.comparable, true);
  assert.equal(byId.buildability_residential_single_family.deltaValue, 0); // 0 − 0, a real zero
  assert.equal(byId.ambito_surface.deltaValue, 500);
  assert.equal(byId.ambito_surface.unit, "m²");
  assert.equal(byId.buildability_residential_collective.unit, "m² edificable");
});

test("a blank (NOT_PUBLISHED) side withholds the quantity, never becomes 0", () => {
  const model = buildAmbitoComparisonModel(
    ambitoSide({ build: { colectiva_residencial: 100, unifamiliar_residencial: 0, terciario: 50, industrial: null } }),
    ambitoSide({ code: "APE.02.02", build: { colectiva_residencial: 200, unifamiliar_residencial: 0, terciario: 50, industrial: 999 } })
  );
  const m = model.metrics.find((x) => x.id === "buildability_industrial");
  assert.equal(m.comparable, false);
  assert.equal(m.deltaValue, null);
  assert.equal(m.withheldReasonCode, WITHHELD_REASON.VALUE_NOT_PUBLISHED);
});

test("multiple published rows are withheld, never summed or combined", () => {
  const model = buildAmbitoComparisonModel(
    ambitoSide({ multipleRows: true }),
    ambitoSide({ code: "APE.02.02" })
  );
  for (const id of ["buildability_residential_collective", "buildability_residential_single_family", "buildability_tertiary", "buildability_industrial"]) {
    const m = model.metrics.find((x) => x.id === id);
    assert.equal(m.comparable, false);
    assert.equal(m.withheldReasonCode, WITHHELD_REASON.MULTIPLE_ROWS_NOT_COMBINED);
  }
  // surface is read from development_state, so it is unaffected by buildability rows
  assert.equal(model.metrics.find((x) => x.id === "ambito_surface").comparable, true);
});

// ================================================================ cross-scope refusal

test("an ámbito compared against a Lens circle is refused with a stated reason", () => {
  const model = buildAmbitoComparisonModel(ambitoSide(), lensCircleSide());
  assert.equal(model.comparable, false);
  assert.equal(model.refusal.code, "CROSS_SCOPE");
  assert.equal(model.crossScopeArithmeticAllowed, false);
  assert.deepEqual(model.metrics, []); // no coerced comparison path
});

test("cross-scope refusal is symmetric (circle as A)", () => {
  const model = buildAmbitoComparisonModel(lensCircleSide(), ambitoSide());
  assert.equal(model.comparable, false);
  assert.equal(model.refusal.code, "CROSS_SCOPE");
});

test("a missing scope is never defaulted to PLANNING_AMBITO", () => {
  const noScope = ambitoSide();
  delete noScope.scope;
  const model = buildAmbitoComparisonModel(noScope, ambitoSide({ code: "APE.02.02" }));
  assert.equal(model.comparable, false);
  assert.equal(model.refusal.code, "CROSS_SCOPE");
});

// ============================================================== cross-edition withholding

test("two ámbitos from different editions withhold every quantity by default", () => {
  const model = buildAmbitoComparisonModel(
    ambitoSide(),
    ambitoSide({ code: "APE.02.02", devEdition: EDITION_PREVIOUS.development_state, buildEdition: EDITION_PREVIOUS.available_buildability, devRef: REF_PREVIOUS, buildRef: REF_PREVIOUS })
  );
  assert.equal(model.comparable, true); // still a valid ámbito↔ámbito object
  assert.equal(model.editionBasis.like_for_like.development_state, false);
  assert.equal(model.editionBasis.like_for_like.available_buildability, false);
  for (const id of QUANTITY_METRICS) {
    const m = model.metrics.find((x) => x.id === id);
    assert.equal(m.comparable, false);
    assert.equal(m.withheldReasonCode, WITHHELD_REASON.CROSS_EDITION);
  }
  for (const id of PHASE_METRICS) {
    const m = model.metrics.find((x) => x.id === id);
    assert.equal(m.relation, CATEGORICAL_RELATION.INDETERMINATE);
    assert.equal(m.indeterminateReasonCode, WITHHELD_REASON.CROSS_EDITION);
  }
});

test("Gate A.1 — there is NO documented-basis override: a cross-edition pair stays withheld whatever options are passed", () => {
  const prevB = ambitoSide({ code: "APE.02.02", surface: 1200, devEdition: EDITION_PREVIOUS.development_state, buildEdition: EDITION_PREVIOUS.available_buildability, devRef: REF_PREVIOUS, buildRef: REF_PREVIOUS });
  // Any extra argument is ignored; the function takes (a, b) only.
  const model = buildAmbitoComparisonModel(ambitoSide({ surface: 1000 }), prevB, { documentedEditionBasis: "anything" });
  assert.equal(model.editionBasis.like_for_like.development_state, false);
  assert.equal(model.editionBasis.like_for_like.available_buildability, false);
  assert.ok(!("documentedBasis" in model.editionBasis), "the escape-hatch field must not exist");
  const surface = model.metrics.find((x) => x.id === "ambito_surface");
  assert.equal(surface.comparable, false);
  assert.equal(surface.withheldReasonCode, WITHHELD_REASON.CROSS_EDITION);
});

// ===================================================== one authoritative state

test("Bridge, Insight and table read the SAME metric object — none recomputes", () => {
  const model = buildAmbitoComparisonModel(
    ambitoSide({ surface: 1000, build: { colectiva_residencial: 100, unifamiliar_residencial: 0, terciario: 50, industrial: 10 } }),
    ambitoSide({ code: "APE.02.02", surface: 1500, build: { colectiva_residencial: 250, unifamiliar_residencial: 0, terciario: 50, industrial: 40 } })
  );
  const rows = ambitoComparisonRows(model);
  assert.strictEqual(rows, model.metrics); // the table rows ARE the authoritative array

  const insight = ambitoDecisionInsightItems(model);
  for (const id of QUANTITY_METRICS) {
    const metric = model.metrics.find((m) => m.id === id);
    const item = insight.find((i) => i.metricId === id);
    const bridge = ambitoBridgeReading(model, id);
    // the delta travels unchanged: model → insight → bridge
    assert.equal(item.deltaValue, metric.comparable ? metric.deltaValue : null);
    assert.equal(bridge.deltaValue, metric.comparable ? metric.deltaValue : null);
  }
  for (const id of PHASE_METRICS) {
    const metric = model.metrics.find((m) => m.id === id);
    assert.equal(ambitoBridgeReading(model, id).relation, metric.relation);
    assert.equal(insight.find((i) => i.metricId === id).relation, metric.relation);
  }
});

test("Decision Insight order is canonical under permuted input", () => {
  // Permute which side is A/B and the phase values; order must not move.
  const model = buildAmbitoComparisonModel(
    ambitoSide({ code: "ZZZ.99.99", build: { colectiva_residencial: 9, unifamiliar_residencial: 9, terciario: 9, industrial: 9 } }),
    ambitoSide({ code: "AAA.00.01", build: { colectiva_residencial: 1, unifamiliar_residencial: 1, terciario: 1, industrial: 1 } })
  );
  assert.deepEqual(ambitoDecisionInsightItems(model).map((i) => i.metricId), AMBITO_METRIC_IDS);
});

test("overall status is descriptive and carries no number", () => {
  const model = buildAmbitoComparisonModel(ambitoSide(), ambitoSide({ code: "APE.02.02" }));
  const status = ambitoComparisonStatus(model);
  assert.equal(typeof status, "string");
  assert.ok(["available", "limited", "refused"].includes(status));
});

// ========================================================= radius non-applicability

test("radius sensitivity states non-applicability and retains no baseline", () => {
  const r = ambitoRadiusSensitivityStatus();
  assert.equal(r.applicable, false);
  assert.equal(r.reasonCode, "FIXED_OFFICIAL_GEOMETRY");
  assert.equal(r.retainsBaseline, false);
});

// ============================================================ edition sensitivity

test("edition sensitivity uses the shared transition vocabulary and keeps each side's reference date", () => {
  const current = buildAmbitoComparisonModel(
    ambitoSide({ surface: 1000, build: { colectiva_residencial: 100, unifamiliar_residencial: 0, terciario: 50, industrial: 10 } }),
    ambitoSide({ code: "APE.02.02", surface: 1500, build: { colectiva_residencial: 250, unifamiliar_residencial: 0, terciario: 50, industrial: 40 } })
  );
  const previous = buildAmbitoComparisonModel(
    ambitoSide({ surface: 1000, devEdition: EDITION_PREVIOUS.development_state, buildEdition: EDITION_PREVIOUS.available_buildability, devRef: REF_PREVIOUS, buildRef: REF_PREVIOUS, build: { colectiva_residencial: 80, unifamiliar_residencial: 0, terciario: 50, industrial: 10 } }),
    ambitoSide({ code: "APE.02.02", surface: 1500, devEdition: EDITION_PREVIOUS.development_state, buildEdition: EDITION_PREVIOUS.available_buildability, devRef: REF_PREVIOUS, buildRef: REF_PREVIOUS, build: { colectiva_residencial: 250, unifamiliar_residencial: 0, terciario: 50, industrial: 40 } })
  );
  const sens = buildAmbitoEditionSensitivity(current, previous, CONTINUOUS);
  assert.equal(sens.applicable, true);
  assert.equal(sens.variedParameter, "EDITION");
  assert.equal(sens.identityEstablished, true);
  assert.deepEqual(sens.items.map((i) => i.metricId), AMBITO_METRIC_IDS);
  const collective = sens.items.find((i) => i.metricId === "buildability_residential_collective");
  // prev B−A = +170, cur B−A = +150: same direction, unchanged-comparable
  assert.equal(collective.code, AMBITO_SENSITIVITY_TRANSITION.UNCHANGED_COMPARABLE);
  // buildability dates come from the S2 family, not S1
  assert.equal(collective.sourceFamily, "S2");
  assert.equal(collective.scenarioReferenceDate.a, REF_CURRENT);
  assert.equal(collective.baselineReferenceDate.a, REF_PREVIOUS);
  // valid transition codes only
  const valid = new Set(Object.values(AMBITO_SENSITIVITY_TRANSITION));
  for (const item of sens.items) assert.ok(valid.has(item.code), `${item.metricId} → ${item.code}`);
});

test("Gate A.2 — edition sensitivity carries each metric's OWN source-family reference date", () => {
  const current = buildAmbitoComparisonModel(ambitoSide(), ambitoSide({ code: "APE.02.02" }));
  const previous = buildAmbitoComparisonModel(
    ambitoSide({ devEdition: EDITION_PREVIOUS.development_state, buildEdition: EDITION_PREVIOUS.available_buildability, devRef: REF_PREVIOUS, buildRef: REF_PREVIOUS }),
    ambitoSide({ code: "APE.02.02", devEdition: EDITION_PREVIOUS.development_state, buildEdition: EDITION_PREVIOUS.available_buildability, devRef: REF_PREVIOUS, buildRef: REF_PREVIOUS })
  );
  const sens = buildAmbitoEditionSensitivity(current, previous, CONTINUOUS);
  const byId = Object.fromEntries(sens.items.map((i) => [i.metricId, i]));
  // phase + surface → S1 development-state family
  for (const id of ["phase_planeamiento", "ambito_surface"]) assert.equal(byId[id].sourceFamily, "S1", id);
  // buildability → S2 available-buildability family
  for (const id of ["buildability_residential_collective", "buildability_industrial"]) assert.equal(byId[id].sourceFamily, "S2", id);
});

test("Gate A.3 — a non-continuous identity (K7 MODIFIED_BY_INSTRUMENT) withholds every metric, never compared", () => {
  const current = buildAmbitoComparisonModel(ambitoSide(), ambitoSide({ code: "APE.02.02" }));
  const previous = buildAmbitoComparisonModel(
    ambitoSide({ devEdition: EDITION_PREVIOUS.development_state, buildEdition: EDITION_PREVIOUS.available_buildability, devRef: REF_PREVIOUS, buildRef: REF_PREVIOUS }),
    ambitoSide({ code: "APE.02.02", devEdition: EDITION_PREVIOUS.development_state, buildEdition: EDITION_PREVIOUS.available_buildability, devRef: REF_PREVIOUS, buildRef: REF_PREVIOUS })
  );
  const continuity = { a: editionContinuityFromOutcome("MODIFIED_BY_INSTRUMENT"), b: editionContinuityFromOutcome("NO_CHANGE") };
  const sens = buildAmbitoEditionSensitivity(current, previous, continuity);
  assert.equal(sens.identityEstablished, false);
  for (const item of sens.items) {
    assert.equal(item.code, AMBITO_SENSITIVITY_TRANSITION.WITHHELD_NON_CONTINUOUS);
    assert.equal(item.nonContinuousReason, CONTINUITY_REASON.MODIFIED_BY_INSTRUMENT);
    // no numeric change is ever produced for a non-continuous entity
    assert.equal(item.deltaChange, null);
  }
});

test("Gate A.3 — missing/unknown continuity is treated as not-established, never silently continuous", () => {
  const current = buildAmbitoComparisonModel(ambitoSide(), ambitoSide({ code: "APE.02.02" }));
  const previous = buildAmbitoComparisonModel(
    ambitoSide({ devEdition: EDITION_PREVIOUS.development_state, buildEdition: EDITION_PREVIOUS.available_buildability, devRef: REF_PREVIOUS, buildRef: REF_PREVIOUS }),
    ambitoSide({ code: "APE.02.02", devEdition: EDITION_PREVIOUS.development_state, buildEdition: EDITION_PREVIOUS.available_buildability, devRef: REF_PREVIOUS, buildRef: REF_PREVIOUS })
  );
  const sens = buildAmbitoEditionSensitivity(current, previous); // no continuity supplied
  assert.equal(sens.identityEstablished, false);
  for (const item of sens.items) assert.equal(item.code, AMBITO_SENSITIVITY_TRANSITION.WITHHELD_NON_CONTINUOUS);
});

test("edition sensitivity detects a direction change", () => {
  const current = buildAmbitoComparisonModel(
    ambitoSide({ build: { colectiva_residencial: 300, unifamiliar_residencial: 0, terciario: 50, industrial: 10 } }),
    ambitoSide({ code: "APE.02.02", build: { colectiva_residencial: 100, unifamiliar_residencial: 0, terciario: 50, industrial: 40 } })
  ); // B − A = -200
  const previous = buildAmbitoComparisonModel(
    ambitoSide({ devEdition: EDITION_PREVIOUS.development_state, buildEdition: EDITION_PREVIOUS.available_buildability, devRef: REF_PREVIOUS, buildRef: REF_PREVIOUS, build: { colectiva_residencial: 100, unifamiliar_residencial: 0, terciario: 50, industrial: 10 } }),
    ambitoSide({ code: "APE.02.02", devEdition: EDITION_PREVIOUS.development_state, buildEdition: EDITION_PREVIOUS.available_buildability, devRef: REF_PREVIOUS, buildRef: REF_PREVIOUS, build: { colectiva_residencial: 300, unifamiliar_residencial: 0, terciario: 50, industrial: 40 } })
  ); // B − A = +200
  const sens = buildAmbitoEditionSensitivity(current, previous, CONTINUOUS);
  assert.equal(sens.items.find((i) => i.metricId === "buildability_residential_collective").code, AMBITO_SENSITIVITY_TRANSITION.DIRECTION_CHANGED);
});

test("edition sensitivity is not applicable when a comparison is a cross-scope refusal", () => {
  const refusal = buildAmbitoComparisonModel(ambitoSide(), lensCircleSide());
  const ok = buildAmbitoComparisonModel(ambitoSide(), ambitoSide({ code: "APE.02.02" }));
  assert.equal(buildAmbitoEditionSensitivity(ok, refusal).applicable, false);
});

// --------------------------------------- F2: exact identity across editions

function editionPair(aCode, bCode, aCodePrev, bCodePrev) {
  const current = buildAmbitoComparisonModel(ambitoSide({ code: aCode }), ambitoSide({ code: bCode }));
  const previous = buildAmbitoComparisonModel(
    ambitoSide({ code: aCodePrev, devEdition: EDITION_PREVIOUS.development_state, buildEdition: EDITION_PREVIOUS.available_buildability, devRef: REF_PREVIOUS, buildRef: REF_PREVIOUS }),
    ambitoSide({ code: bCodePrev, devEdition: EDITION_PREVIOUS.development_state, buildEdition: EDITION_PREVIOUS.available_buildability, devRef: REF_PREVIOUS, buildRef: REF_PREVIOUS })
  );
  return { current, previous };
}

test("F2 — a previous-edition A code mismatch is refused even when continuity looks valid", () => {
  const { current, previous } = editionPair("APE.01.01", "APE.02.02", "APE.99.99", "APE.02.02");
  const sens = buildAmbitoEditionSensitivity(current, previous, CONTINUOUS);
  assert.equal(sens.applicable, false);
  assert.equal(sens.reasonCode, "IDENTITY_MISMATCH");
  assert.equal(sens.mismatch.a.matched, false);
  assert.equal(sens.mismatch.b.matched, true);
  assert.deepEqual(sens.items, []);
});

test("F2 — an A/B swap cannot create a false comparison", () => {
  // previous has A and B swapped relative to current
  const { current, previous } = editionPair("APE.01.01", "APE.02.02", "APE.02.02", "APE.01.01");
  const sens = buildAmbitoEditionSensitivity(current, previous, CONTINUOUS);
  assert.equal(sens.applicable, false);
  assert.equal(sens.reasonCode, "IDENTITY_MISMATCH");
});

test("F2 — a -RP code must match exactly; -RP vs non-RP is a mismatch", () => {
  const mismatch = editionPair("UZPp.03.01-RP", "APE.02.02", "UZPp.03.01", "APE.02.02");
  assert.equal(buildAmbitoEditionSensitivity(mismatch.current, mismatch.previous, CONTINUOUS).applicable, false);
  // exact -RP on both sides is a legitimate, applicable comparison
  const ok = editionPair("UZPp.03.01-RP", "APE.02.02", "UZPp.03.01-RP", "APE.02.02");
  assert.equal(buildAmbitoEditionSensitivity(ok.current, ok.previous, CONTINUOUS).applicable, true);
});

// ======================================================= localization & vocabulary

test("both dictionaries define every key", () => {
  const en = Object.keys(AMBITO_COMPARISON_DICTIONARIES.en).sort();
  const es = Object.keys(AMBITO_COMPARISON_DICTIONARIES.es).sort();
  assert.deepEqual(en, es);
  // every metric, relation, withheld reason and transition has a dictionary key
  for (const id of AMBITO_METRIC_IDS) assert.ok(`metric.${id}` in AMBITO_COMPARISON_DICTIONARIES.en);
  for (const r of Object.values(CATEGORICAL_RELATION)) assert.ok(`relation.${r}` in AMBITO_COMPARISON_DICTIONARIES.en);
  for (const w of Object.values(WITHHELD_REASON)) assert.ok(`withheld.${w}` in AMBITO_COMPARISON_DICTIONARIES.en);
  for (const t of Object.values(AMBITO_SENSITIVITY_TRANSITION)) assert.ok(`transition.${t}` in AMBITO_COMPARISON_DICTIONARIES.en);
});

test("neither dictionary carries ordering, ranking or recommendation vocabulary", () => {
  const forbiddenEn = [
    "better", "worse", "best", "worst", "winner", "loser", "rank", "ranking", "score",
    "recommend", "recommended", "should", "progress", "advanced", "ahead", "behind",
    "leads", "outperforms", "superior", "preferred", "top", "improve", "decline",
  ];
  const forbiddenEs = [
    "mejor", "peor", "ganador", "perdedor", "ranking", "puntuación", "puntuacion",
    "recomienda", "recomendado", "debería", "deberia", "progreso", "avanzado",
    "adelantado", "atrasado", "supera", "superior", "preferido",
  ];
  const scan = (dict, forbidden) => {
    for (const [key, value] of Object.entries(dict)) {
      const text = value.toLowerCase();
      for (const word of forbidden) {
        assert.ok(!new RegExp(`\\b${word}\\b`).test(text), `dictionary key "${key}" contains forbidden word "${word}"`);
      }
    }
  };
  scan(AMBITO_COMPARISON_DICTIONARIES.en, forbiddenEn);
  scan(AMBITO_COMPARISON_DICTIONARIES.es, forbiddenEs);
});

// ============================================================ immutability

test("the authoritative model is deeply frozen", () => {
  const model = buildAmbitoComparisonModel(ambitoSide(), ambitoSide({ code: "APE.02.02" }));
  assert.ok(Object.isFrozen(model));
  assert.ok(Object.isFrozen(model.metrics));
  assert.ok(Object.isFrozen(model.metrics[0]));
});
