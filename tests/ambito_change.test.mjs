import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import {
  BUILDABILITY_STATE,
  CHANGE_OUTCOME,
  CHANGE_OUTCOMES,
  auditEditionPair,
  auditLegacyGateLPair,
  buildAmbitoComparison,
  classifyAmbitoEditionPair,
  compareBuildability,
  editionEntityIdentity,
  projectAmbitoChangeReading,
  reconcileEditionPair,
  resolveEditionEntity,
} from "../js/ambito-change.js";

const artifact = JSON.parse(fs.readFileSync(new URL("../data/planning/madrid_ambito_state.json", import.meta.url), "utf8"));
const pair = artifact.change_detection;
const currentS2 = pair.current.families.S2;
const previousS2 = pair.previous.families.S2;
const currentS1 = pair.current.families.S1;
const previousS1 = pair.previous.families.S1;
const SHELL_DICTIONARIES = createRequire(import.meta.url)("../js/shell-copy.js").SHELL_DICTIONARIES;

function edition(family, month, records, era = family === "S1" ? "S1_FOUR_PHASE_FLAT" : "S2_SPLIT_RESIDENTIAL_FLAT") {
  return {
    family,
    snapshot_identity: `${family}:${month}:${month.replace("-", "")}`,
    reference_date: `${month}-01`,
    sha256: month === "2025-07" ? "a".repeat(64) : "b".repeat(64),
    schema_era: era,
    records,
  };
}

function s1Record(value) {
  const phases = Object.fromEntries(["planeamiento", "gestion", "urbanizacion_proyecto", "urbanizacion_obras"].map((key) => [
    key,
    { state: "PUBLISHED", source_value: value },
  ]));
  return { phases, source_verbatim: { phase_values: Object.fromEntries(Object.keys(phases).map((key) => [key, value])) } };
}

function s2Row(situation, value = 100, notes = "") {
  return {
    source_row: 1,
    situacion: situation,
    observaciones: notes,
    source_verbatim: { situacion: situation, observaciones: notes },
    use_classes: Object.fromEntries(["colectiva_residencial", "unifamiliar_residencial", "industrial", "terciario"].map((key) => [
      key,
      { state: "PUBLISHED", value, unit: "m² edificable", source_column: {
        colectiva_residencial: "Colectiva. Edif. Residencial",
        unifamiliar_residencial: "Unifamiliar. Edif. Residencial",
        industrial: "Edif. Industrial",
        terciario: "Edif. Terciario",
      }[key] },
    ])),
  };
}

function fixtureS2(beforeRows, afterRows) {
  return [
    edition("S2", "2025-07", { "UZPp.02.03-RP": beforeRows }),
    edition("S2", "2026-01", { "UZPp.02.03-RP": afterRows }),
  ];
}

test("edition identity requires exact code plus a named edition and retains -RP", () => {
  const identity = editionEntityIdentity(previousS2, "UZPp.02.03-RP");
  assert.equal(identity, `${previousS2.snapshot_identity}:UZPp.02.03-RP`);
  assert.equal(resolveEditionEntity(previousS2, "UZPp.02.03-RP"), null);
  assert.equal(resolveEditionEntity(previousS2, identity), previousS2.records["UZPp.02.03-RP"]);
});

test("cross-era pairs abstain and same edition supplied twice abstains", () => {
  const old = edition("S1", "2024-01", { X: s1Record("Sin Iniciar") }, "S1_SINGLE_STATE_PER_DISTRICT");
  const recent = edition("S1", "2025-01", { X: s1Record("Finalizado") });
  assert.equal(classifyAmbitoEditionPair(old, recent, "X").outcome, CHANGE_OUTCOME.NON_COMPARABLE);
  assert.equal(classifyAmbitoEditionPair(recent, recent, "X").outcome, CHANGE_OUTCOME.NON_COMPARABLE);
});

test("persistent MPG note is not an instrument event; a dated applicable event is explicit", () => {
  const note = "ÁMBITO CON MPG";
  const [before, after] = fixtureS2([s2Row("FASE DE EDIFICACION", 100, note)], [s2Row("FASE DE EDIFICACION", 100, note)]);
  assert.equal(classifyAmbitoEditionPair(before, after, "UZPp.02.03-RP").outcome, CHANGE_OUTCOME.NO_CHANGE);
  const changed = classifyAmbitoEditionPair(before, after, "UZPp.02.03-RP", {
    instrumentEvents: [{
      applicable: true,
      entity_code: "UZPp.02.03-RP",
      effective_date: "2025-10-01",
      instrument_reference: "MPG example",
      source_evidence: "official dated instrument record",
      affected_fields: ["observaciones"],
    }],
  });
  // A dated record alone does not transform unchanged source evidence.
  assert.equal(changed.outcome, CHANGE_OUTCOME.NO_CHANGE);
  const phaseBefore = edition("S1", "2025-07", { X: s1Record("Sin Iniciar") });
  const phaseAfter = edition("S1", "2026-01", { X: s1Record("Finalizado") });
  const instrument = classifyAmbitoEditionPair(phaseBefore, phaseAfter, "X", {
    instrumentEvents: [{
      applicable: true,
      entity_code: "X",
      effective_date: "2025-10-01",
      instrument_reference: "MPG 7/2025",
      source_evidence: "official instrument publication",
      affected_fields: ["planeamiento"],
    }],
  });
  assert.equal(instrument.outcome, CHANGE_OUTCOME.MODIFIED_BY_INSTRUMENT);
  assert.match(instrument.modificationCaveat, /may not be like-for-like/i);
});

test("S2 row matching preserves row count, matches unique situations, and withholds unresolved duplicates", () => {
  const [before, oneToOne] = fixtureS2([s2Row("Fase gestión", 100)], [s2Row("FASE GESTION", 90)]);
  const one = classifyAmbitoEditionPair(before, oneToOne, "UZPp.02.03-RP");
  assert.equal(one.outcome, CHANGE_OUTCOME.NO_CHANGE);
  assert.equal(one.evidence.rowCorrespondence.outcome, "ROW_MATCHED");
  const [multiBefore, multiAfter] = fixtureS2(
    [s2Row("FASE DE EDIFICACION", 100), s2Row("FASE GESTION", 60)],
    [s2Row("FASE GESTION", 60), s2Row("FASE DE EDIFICACION", 110)],
  );
  const multi = classifyAmbitoEditionPair(multiBefore, multiAfter, "UZPp.02.03-RP");
  assert.equal(multi.evidence.rowCorrespondence.outcome, "ROW_MATCHED");
  assert.equal(multi.evidence.situations.matched.length, 2);
  const numeric = compareBuildability(multiBefore, multiAfter, "UZPp.02.03-RP");
  assert.equal(numeric.rowMatching.matchedRowCount, 2);
  assert.equal(numeric.state, BUILDABILITY_STATE.OBSERVED_PUBLISHED_DIFFERENCE);
  const [duplicateBefore, duplicateAfter] = fixtureS2(
    [s2Row("FASE DE EDIFICACION", 100)],
    [s2Row("FASE DE EDIFICACION", 90), s2Row("FASE DE EDIFICACION", 110)],
  );
  const duplicate = classifyAmbitoEditionPair(duplicateBefore, duplicateAfter, "UZPp.02.03-RP");
  assert.equal(duplicate.outcome, CHANGE_OUTCOME.CAUSE_UNRESOLVED);
  assert.equal(duplicate.evidence.situations.unmatchedCurrent.length, 2);
  assert.equal(compareBuildability(duplicateBefore, duplicateAfter, "UZPp.02.03-RP").state, BUILDABILITY_STATE.WITHHELD);
});

test("blank, zero, missing row, and absent code remain separate", () => {
  const blank = s2Row("FASE DE EDIFICACION", 0);
  blank.use_classes.unifamiliar_residencial = { state: "NOT_PUBLISHED", value: null, unit: "m² edificable", source_column: "Unifamiliar. Edif. Residencial" };
  const current = edition("S2", "2026-01", { "UZPp.02.03-RP": [blank] });
  const previous = edition("S2", "2025-07", { "UZPp.02.03-RP": [s2Row("FASE DE EDIFICACION", 0)] });
  const comparison = compareBuildability(previous, current, "UZPp.02.03-RP");
  assert.equal(comparison.state, BUILDABILITY_STATE.WITHHELD);
  assert.equal(comparison.differences[0].useClasses[0].state, BUILDABILITY_STATE.NO_CHANGE);
  assert.equal(comparison.differences[0].useClasses[1].current.state, "NOT_PUBLISHED");
  const neitherEditionPublishes = classifyAmbitoEditionPair(previous, current, "NOT-HERE");
  assert.equal(neitherEditionPublishes.outcome, CHANGE_OUTCOME.CAUSE_UNRESOLVED);
  assert.equal(neitherEditionPublishes.evidence.membership, "ABSENT_IN_BOTH_EDITIONS");
  const laterOnly = classifyAmbitoEditionPair(edition("S2", "2025-07", {}), edition("S2", "2026-01", { X: [s2Row("A")] }), "X");
  assert.equal(laterOnly.outcome, CHANGE_OUTCOME.NEW_AMBITO);
  const beforeAbsent = edition("S2", "2025-07", { X: [s2Row("A")] });
  const afterAbsent = edition("S2", "2026-01", {});
  const absentLater = classifyAmbitoEditionPair(beforeAbsent, afterAbsent, "X");
  assert.equal(absentLater.outcome, CHANGE_OUTCOME.ABSENT_FROM_EDITION);
  assert.equal(absentLater.evidence.causeStatus, "CAUSE_UNRESOLVED");
  assert.equal(absentLater.evidence.absenceReason, null);
  const documented = classifyAmbitoEditionPair(beforeAbsent, afterAbsent, "X", {
    absenceReasons: { X: "Source-stated reason, retained verbatim." },
  });
  assert.equal(documented.evidence.causeStatus, "SOURCE_DOCUMENTED");
  assert.equal(documented.evidence.absenceReason, "Source-stated reason, retained verbatim.");
});

test("generated valid code pairs always have exactly one authorised outcome", () => {
  const states = ["Sin Iniciar", "Finalizado", "No Necesita", "PGOUM-97"];
  const memberships = ["neither", "previous", "current", "both"];
  let examples = 0;
  for (const family of ["S1", "S2"]) {
    for (const leftValue of states) for (const rightValue of states) for (const membership of memberships) {
      const makeRecords = (value, include) => !include ? {} : family === "S1" ? { X: s1Record(value) } : { X: [s2Row(value)] };
      const includeLeft = membership === "previous" || membership === "both";
      const includeRight = membership === "current" || membership === "both";
      const before = edition(family, "2025-07", makeRecords(leftValue, includeLeft));
      const after = edition(family, "2026-01", makeRecords(rightValue, includeRight));
      const result = classifyAmbitoEditionPair(before, after, "X");
      assert.ok(CHANGE_OUTCOMES.includes(result.outcome));
      assert.equal(result.outcome == null, false);
      assert.equal(Object.isFrozen(result), true);
      examples += 1;
    }
  }
  assert.equal(examples, 128);
});

test("legacy S2 audit baseline reproduces Gate L while production preserves every row", () => {
  const s1 = auditEditionPair(previousS1, currentS1);
  assert.deepEqual(
    Object.fromEntries(Object.entries(s1.counts).filter(([, value]) => value)),
    { NO_CHANGE: 655, STATE_TRANSITION: 10, NEW_AMBITO: 2 },
  );
  const legacy = auditLegacyGateLPair(previousS2, currentS2);
  assert.deepEqual(legacy.counts, {
    NO_CHANGE: 220, STATE_TRANSITION: 9, NEW_AMBITO: 0, ABSENT_FROM_EDITION: 9,
    MODIFIED_BY_INSTRUMENT: 0, CAUSE_UNRESOLVED: 1, NON_COMPARABLE: 0,
  });
  assert.equal(legacy.cosmeticOnlyCount, 54);
  const production = auditEditionPair(previousS2, currentS2);
  const absentRecords = production.records.filter((record) => record.outcome === CHANGE_OUTCOME.ABSENT_FROM_EDITION);
  assert.equal(absentRecords.length, 9);
  assert.ok(absentRecords.every((record) => record.evidence.causeStatus === "CAUSE_UNRESOLVED" && record.evidence.absenceReason === null));
  assert.equal(Object.values(previousS2.records).reduce((n, rows) => n + rows.length, 0), 239);
  assert.equal(Object.values(currentS2.records).reduce((n, rows) => n + rows.length, 0), 239);
  assert.equal(Object.keys(currentS2.records).length, 230);
  assert.deepEqual(production.counts, {
    NO_CHANGE: 212, STATE_TRANSITION: 8, NEW_AMBITO: 0, ABSENT_FROM_EDITION: 9,
    MODIFIED_BY_INSTRUMENT: 0, CAUSE_UNRESOLVED: 10, NON_COMPARABLE: 0,
  });
  assert.equal(production.cosmeticOnlyCount, 53);
  const reconciliation = reconcileEditionPair(previousS2, currentS2);
  assert.equal(reconciliation.divergenceCount, 9);
  const byCode = new Map(reconciliation.divergences.map((item) => [item.exactCode, item]));
  for (const code of ["UZPp.02.03-RP", "UZPp.02.04-RP"]) {
    const item = byCode.get(code);
    assert.ok(item);
    assert.equal(item.production.outcome, CHANGE_OUTCOME.CAUSE_UNRESOLVED);
    assert.ok(item.rowReconciliation.reason);
    assert.ok(item.rowReconciliation.unmatchedCurrent.length > 0);
    assert.equal(item.buildability.state, BUILDABILITY_STATE.WITHHELD);
  }
});

test("Barajas duplicate rows are retained as unresolved; no district reconciliation is inferred", () => {
  const duplicateCodes = Object.entries(currentS2.records).filter(([, rows]) =>
    rows.filter((row) => row.district_name === "BARAJAS" && ["20", "21"].includes(row.district_code)).length === 2,
  );
  assert.equal(duplicateCodes.length, 7);
  for (const [code, rows] of duplicateCodes) {
    assert.deepEqual(new Set(rows.map((row) => row.district_code)), new Set(["20", "21"]));
    assert.ok(rows.every((row) => row.district_name === "BARAJAS"));
    const result = classifyAmbitoEditionPair(previousS2, currentS2, code);
    assert.equal(result.outcome, CHANGE_OUTCOME.CAUSE_UNRESOLVED);
    assert.equal(result.evidence.rowCorrespondence.outcome, CHANGE_OUTCOME.CAUSE_UNRESOLVED);
    assert.equal(compareBuildability(previousS2, currentS2, code).state, BUILDABILITY_STATE.WITHHELD);
    assert.equal(JSON.stringify(result).includes("district_changed"), false);
  }
});

test("real numeric difference and blank-driven withholding preserve both reference dates", () => {
  const valid = compareBuildability(previousS2, currentS2, "US.04.10-RP");
  assert.equal(valid.state, BUILDABILITY_STATE.OBSERVED_PUBLISHED_DIFFERENCE);
  assert.equal(valid.withheldCellCount, 0);
  assert.deepEqual(valid.dates, { previous: "2025-07-01", current: "2026-01-01" });
  const withheld = compareBuildability(previousS2, currentS2, "APE.02.12");
  assert.equal(withheld.state, BUILDABILITY_STATE.WITHHELD);
  assert.match(withheld.reason, /blank is not zero/i);
  assert.deepEqual(withheld.dates, { previous: "2025-07-01", current: "2026-01-01" });
});

test("citizen and analyst readings project the same frozen comparison", () => {
  const previous = { reference_date: "2025-07-01", families: { S1: previousS1, S2: previousS2 } };
  const current = { reference_date: "2026-01-01", families: { S1: currentS1, S2: currentS2 } };
  const comparison = buildAmbitoComparison({ previous, current, exactCode: "US.04.10-RP" });
  const citizen = projectAmbitoChangeReading(comparison, "citizen");
  const analyst = projectAmbitoChangeReading(comparison, "analyst");
  assert.deepEqual(citizen.dates, analyst.dates);
  assert.deepEqual(citizen.outcomes, analyst.outcomes);
  assert.deepEqual(citizen.buildability, {
    state: analyst.buildability.state,
    reason: analyst.buildability.reason,
    differences: analyst.buildability.differences,
  });
  assert.equal(Object.isFrozen(comparison), true);
});

test("K7 English and Spanish authored dictionaries avoid the forbidden directional and forecast language", () => {
  const prohibited = {
    en: /\b(?:progress(?:ed|ion)?|advanced|moved\s+forward|improved|worsened|delayed|accelerated|on\s+track|stalled|completion|development\s+gained|construction\s+delivered|consumed|built|expected|projected|trend|rate|velocity|because|due\s+to)\b/i,
    es: /\b(?:progreso|avanz(?:a|ó|ado|aron|ar)|mejor(?:a|ó|ado)|empeor(?:a|ó|ado)|retras(?:a|ó|ado)|aceler(?:a|ó|ado)|en\s+plazo|estancad\w*|finalizaci[oó]n|desarrollo\s+ganado|construcci[oó]n\s+entregada|consumid\w*|construid\w*|previst\w*|proyectad\w*|tendencia|ritmo|velocidad|porque|debido\s+a|a\s+causa\s+de)\b/i,
  };
  for (const language of ["en", "es"]) {
    const copy = Object.entries(SHELL_DICTIONARIES[language])
      .filter(([key]) => key.startsWith("planning.change.") || key === "surface.place.planning.change")
      .map(([, value]) => value)
      .join("\n");
    assert.doesNotMatch(copy, prohibited[language]);
  }
});
