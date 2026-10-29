// Urban evidence questions (M2) — the evaluation set.
//
// WHAT THESE TESTS DEFEND
//
//   1. The question interface cannot change the scientific meaning of a registry
//      result: for every case the outcome's `result` is deep-equal to a DIRECT
//      call of `registry.query(shape, params)`, and every verbatim fact on the
//      presentation is a string that exists in that result.
//   2. A missing answer stays missing: every abstention reason survives with its
//      machine-readable identity and a non-empty explanation in both languages.
//   3. Citizen and analyst readings carry the same facts, scope, evidence and
//      limits; only labels and trace rows differ.
//   4. The answer is bound to its analytical context; any change of that context
//      changes the context key (so a held answer can be marked out of date).
//   5. There is no model, key, network call, storage or free text in the layer.
//
// The evaluation set uses the COMMITTED artifacts, wired into the registry exactly
// as js/app.js wires them. Every expected value is either a literal read from the
// committed data at the top of this file or a direct registry call. Where no
// committed record exhibits a state, the fixture is a stated derivation of a real
// record and the test says so.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const R = require("../js/evidence-registry.js");

import { createPlanningIndex, AMBITO_STATE, AVAILABILITY } from "../js/planning-ambito.js";
import { createLicenceIndex } from "../js/urban-licences.js";
import { buildAmbitoComparison } from "../js/ambito-change.js";
import { ambitoEditionContainsCode, createCanonicalAmbitoComparisonInputResolver } from "../js/ambito-comparison-adapter.js";
import { buildAmbitoComparisonModel } from "../js/ambito-comparison.js";
import { createDestinationIndex, buildDestinationContext, DESTINATION_STATE } from "../js/destination-context.js";
import { interiorPointOf } from "../js/geo-search.js";
import * as Q from "../js/question-explorer.js";

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const REGISTRY = read("data/source_registry.json");
const GEOMETRY = read("data/planning/madrid_ambitos.geojson");
const STATE = read("data/planning/madrid_ambito_state.json");
const LICENCES = read("data/planning/madrid_urban_licences.json");
const CD = STATE.change_detection;

function wire(overrides = {}) {
  const planningIndex = createPlanningIndex({ geometry: GEOMETRY, state: STATE });
  const licenceIndex = createLicenceIndex(LICENCES);
  const deps = {
    registry: REGISTRY,
    planningIndex,
    planningModule: { AMBITO_STATE, AVAILABILITY },
    licenceIndex,
    ambitoEditionDiff: (code) => buildAmbitoComparison({
      previous: { reference_date: CD.previous.reference_date, families: CD.previous.families },
      current: { reference_date: CD.current.reference_date, families: CD.current.families },
      exactCode: code,
    }),
    ambitoEditionCodeKnown: (code) => ambitoEditionContainsCode(code, STATE),
    ambitoCompare: buildAmbitoComparisonModel,
    ambitoComparisonInputFor: createCanonicalAmbitoComparisonInputResolver({ index: planningIndex, stateArtifact: STATE }),
    destinationModel: buildDestinationContext({
      index: createDestinationIndex(read("data/destination/madrid_hotel_demand.json")),
      state: DESTINATION_STATE.AVAILABLE,
    }),
    destinationStateAvailable: DESTINATION_STATE.AVAILABLE,
    ...overrides,
  };
  return { registry: R.createEvidenceRegistry(deps), planningIndex, licenceIndex };
}

const { registry, planningIndex, licenceIndex } = wire();

// ---------------------------------------------------------------- the fixtures

const CODE = "APR.02.09"; // a committed ámbito with a published state, found by the M1 finder
const CODE_FEATURE = planningIndex.featureFor(CODE);
const CODE_POINT = interiorPointOf(CODE_FEATURE.geometry); // verified interior point
const SOL = { lon: -3.7038, lat: 40.4168 }; // inside no ámbito of the committed universe
const WINDOW = { from: "2025-10-01", to: "2026-09-30" }; // the trailing twelve months of the register
const READY = { planning: "ready", licences: "ready", editions: "ready" };

const lens = (which, point, radiusM) => ({ which, lon: point.lon, lat: point.lat, radiusM });
const context = (over = {}) => ({
  lens: lens("A", CODE_POINT, 900),
  selection: null,
  licenceWindow: WINDOW,
  readiness: READY,
  ...over,
});

const NOT_PUBLISHED_CODE = Object.keys(STATE.ambitos).find((code) => STATE.ambitos[code].development_state.availability !== "PUBLISHED");
const BOTH_EDITIONS_CODE = Object.keys(CD.previous.families.S1.records).find((code) => CD.current.families.S1.records[code] !== undefined);
const LATER_ONLY_CODE = Object.keys(CD.current.families.S1.records).find((code) => CD.previous.families.S1.records[code] === undefined);

const ask = (id, ctx = context(), reg = registry) => Q.askQuestion(reg, id, ctx);
const present = (outcome, over = {}) => Q.presentOutcome(outcome, { language: "en", reading: "citizen", context: context(), registry, ...over });

// ============================================================== 0. the fixtures

test("fixtures: the committed data exhibits every state the evaluation set relies on", () => {
  assert.ok(CODE_FEATURE, `${CODE} must exist in the committed geometry`);
  assert.ok(CODE_POINT && Number.isFinite(CODE_POINT.lon), "the finder's verified interior point must exist");
  assert.equal(registry.query("AMBITO_AT_POINT", SOL).reason, "NO_EVIDENCE_FOR_SCOPE", "Sol must lie outside every ámbito");
  assert.ok(NOT_PUBLISHED_CODE, "expected an ámbito with no published state in the committed edition");
  assert.ok(BOTH_EDITIONS_CODE && LATER_ONLY_CODE, "expected codes in both editions and in only the later one");
  assert.equal(CD.previous.reference_date, "2025-07-01");
  assert.equal(CD.current.reference_date, "2026-01-01");
});

// ============================================================ 1. the catalogue

test("the catalogue is exactly six questions, each bound to a registered shape", () => {
  assert.deepEqual(Q.QUESTIONS.map((q) => q.id), [
    "AMBITO_AT_POINT", "AMBITO_PHASES", "AMBITO_EDITION_DIFF", "AMBITOS_IN_LENS", "LICENCES_IN_LENS", "SOURCE_PROVENANCE",
  ]);
  for (const question of Q.QUESTIONS) {
    assert.ok(R.REGISTERED_SHAPES.includes(question.shape), `${question.id} must use a registered shape`);
    assert.equal(question.id, question.shape, "a question id is its shape: there is no second vocabulary");
  }
});

test("shapes whose runtime integration is not demonstrated, or that duplicate an existing surface, are not exposed", () => {
  const exposed = new Set(Q.QUESTIONS.map((q) => q.shape));
  for (const shape of ["AMBITO_BUILDABILITY", "AMBITO_COMPARE", "AREA_PROFILE_AT_POINT", "CITY_HOTEL_DEMAND"]) {
    assert.ok(R.REGISTERED_SHAPES.includes(shape));
    assert.ok(!exposed.has(shape), `${shape} must not be exposed by V1`);
  }
});

test("every question and refused ask has wording, subject and limits in both languages", () => {
  for (const language of ["en", "es"]) {
    const copy = Q.copyFor(language);
    for (const question of Q.QUESTIONS) {
      assert.ok(copy.questions[question.id], `${language}: question text for ${question.id}`);
      assert.ok(copy.subject[question.subject], `${language}: subject label for ${question.id}`);
      assert.ok(copy.limits[question.id].length >= 2, `${language}: limits for ${question.id}`);
    }
    for (const ask of Q.REFUSED_ASKS) assert.ok(copy.refused[ask.id], `${language}: refused ask ${ask.id}`);
  }
});

test("every refused ask is refused by the REAL registry, naming its clause", () => {
  const expected = {
    dwellings: ["CEILING_PROHIBITS", "DWELLING_COUNT"],
    completion: ["CEILING_PROHIBITS", "COMPLETION_OR_PROJECTION"],
    ranking: ["CEILING_PROHIBITS", "RANKING_OR_RECOMMENDATION"],
    cause: ["CEILING_PROHIBITS", "CAUSAL_CLAIM"],
    legal: ["CEILING_PROHIBITS", "LEGAL_INTERPRETATION"],
    share: ["CEILING_PROHIBITS", "WHOLE_TO_PART_APPORTIONMENT"],
    pressure: ["UNREGISTERED_SHAPE", null],
  };
  assert.deepEqual(Q.REFUSED_ASKS.map((a) => a.id).sort(), Object.keys(expected).sort());
  for (const entry of Q.REFUSED_ASKS) {
    const outcome = Q.askRefused(registry, entry.id, context());
    assert.equal(outcome.status, "abstained");
    assert.equal(outcome.result.reason, expected[entry.id][0]);
    assert.equal(outcome.result.prohibition, expected[entry.id][1]);
    assert.ok(!R.REGISTERED_SHAPES.includes(entry.shape) || entry.flag, "a registered shape is refused only through a prohibited-intent flag");
  }
});

// ===================================================== 2. the evaluation set (16)

test("E01 valid planning point: the registry names the ámbito and the answer repeats only that", () => {
  const outcome = ask("AMBITO_AT_POINT");
  assert.equal(outcome.status, "answered");
  assert.equal(outcome.result.value.ambitoCode, CODE);
  assert.equal(outcome.result.derivation, "POINT_IN_POLYGON");
  assert.equal(outcome.result.sourceId, "planning_ambito_geometry");
  const p = present(outcome);
  assert.match(p.headline, new RegExp(CODE));
  assert.equal(p.scope.id, "PLANNING_AMBITO");
  assert.deepEqual(p.facts.map((f) => f.id), ["ambito.code", "ambito.denomination"]);
});

test("E02 point outside every ámbito: an explicit absence, never a nearest ámbito", () => {
  const ctx = context({ lens: lens("A", SOL, 900) });
  const outcome = ask("AMBITO_AT_POINT", ctx);
  assert.equal(outcome.status, "abstained");
  assert.equal(outcome.result.reason, "NO_EVIDENCE_FOR_SCOPE");
  const p = present(outcome, { context: ctx });
  assert.equal(p.kind, "abstention");
  assert.equal(p.facts.length, 0);
  assert.equal(p.abstention.reason, "NO_EVIDENCE_FOR_SCOPE");
});

test("E03 exact official code: a finder-selected ámbito is the subject, and its four phases are verbatim", () => {
  const ctx = context({ lens: lens("A", SOL, 900), selection: { type: "AMBITO", code: CODE, name: "x" } });
  const outcome = ask("AMBITO_PHASES", ctx);
  assert.equal(outcome.status, "answered");
  assert.equal(outcome.subject.origin, "SELECTION");
  assert.equal(outcome.result.value.ambitoCode, CODE);
  const direct = planningIndex.developmentState(CODE);
  const p = present(outcome, { context: ctx });
  const phases = p.facts.filter((f) => f.id.startsWith("phase."));
  assert.equal(phases.length, 4);
  for (const phase of direct.phases) {
    const shown = phases.find((f) => f.id === `phase.${phase.key}`);
    assert.equal(shown.value, phase.sourceValue, `${phase.key} must be the publisher's string, untouched`);
    assert.equal(shown.verbatim, true);
  }
  assert.ok(!p.facts.some((f) => /stage|progress|overall|percent/i.test(f.label)), "the four fields never become one stage");
});

test("E04a missing published ámbito: a known ámbito with no published state abstains, never a zero", () => {
  const ctx = context({ selection: { type: "AMBITO", code: NOT_PUBLISHED_CODE, name: "x" } });
  const outcome = ask("AMBITO_PHASES", ctx);
  assert.equal(outcome.status, "abstained");
  assert.equal(outcome.result.reason, "NO_EVIDENCE_FOR_SCOPE");
  assert.equal(present(outcome, { context: ctx }).facts.length, 0);
});

test("E04b missing published cell (DERIVED fixture: a committed record with one cell blanked): shown as not published, never blank or zero", () => {
  // No committed PUBLISHED ámbito has an unpublished phase cell, so this fixture is
  // the committed record for CODE with exactly two cells blanked.
  const state = JSON.parse(JSON.stringify(STATE));
  const record = state.ambitos[CODE].development_state;
  record.phases.gestion = { ...record.phases.gestion, source_value: null, state: "NOT_PUBLISHED" };
  record.surface = { ...record.surface, value: null, state: "NOT_PUBLISHED" };
  const derived = wire({ planningIndex: createPlanningIndex({ geometry: GEOMETRY, state }) });
  const ctx = context({ selection: { type: "AMBITO", code: CODE, name: "x" } });
  const outcome = Q.askQuestion(derived.registry, "AMBITO_PHASES", ctx);
  assert.equal(outcome.status, "answered");
  for (const language of ["en", "es"]) {
    const p = Q.presentOutcome(outcome, { language, reading: "citizen", context: ctx, registry: derived.registry });
    const gestion = p.facts.find((f) => f.id === "phase.gestion");
    const surface = p.facts.find((f) => f.id === "ambito.surface");
    assert.equal(gestion.value, Q.copyFor(language).notPublished);
    assert.equal(gestion.verbatim, false);
    assert.equal(surface.value, Q.copyFor(language).notPublished);
    assert.ok(!/^0\b/.test(gestion.value) && !/^0\b/.test(surface.value));
  }
});

test("E05 registered edition comparison: the K7 model's outcomes, with both dates, never called progress", () => {
  const ctx = context({ selection: { type: "AMBITO", code: BOTH_EDITIONS_CODE, name: "x" } });
  const outcome = ask("AMBITO_EDITION_DIFF", ctx);
  assert.equal(outcome.status, "answered");
  const direct = buildAmbitoComparison({
    previous: { reference_date: CD.previous.reference_date, families: CD.previous.families },
    current: { reference_date: CD.current.reference_date, families: CD.current.families },
    exactCode: BOTH_EDITIONS_CODE,
  });
  assert.deepEqual(outcome.result.value, direct);
  for (const language of ["en", "es"]) {
    const p = Q.presentOutcome(outcome, { language, reading: "analyst", context: ctx, registry });
    assert.ok(p.facts.some((f) => f.id === "edition.previous") && p.facts.some((f) => f.id === "edition.current"));
    for (const family of ["S1", "S2"]) {
      const shown = p.facts.find((f) => f.id === `change.${family}`);
      assert.equal(shown.outcome, direct.state[family].outcome);
    }
    assert.ok(!/progress|avance|completed|finalizaci/i.test(`${p.headline} ${p.facts.map((f) => f.value).join(" ")}`));
  }
  const later = Q.askQuestion(registry, "AMBITO_EDITION_DIFF", context({ selection: { type: "AMBITO", code: LATER_ONLY_CODE, name: "x" } }));
  assert.equal(later.status, "answered", "a code present in only one edition keeps its genuine appearance");
});

test("E06 invalid identity: an unknown ámbito code, and a stale edition identity, are refused", () => {
  const unknown = ask("AMBITO_EDITION_DIFF", context({ selection: { type: "AMBITO", code: "ZZZ.00.00", name: "x" } }));
  assert.equal(unknown.result.reason, "OUTSIDE_SOURCE_UNIVERSE");
  const unknownPhases = ask("AMBITO_PHASES", context({ selection: { type: "AMBITO", code: "ZZZ.00.00", name: "x" } }));
  assert.equal(unknownPhases.result.reason, "OUTSIDE_SOURCE_UNIVERSE");
  // The stale-edition refusal belongs to AMBITO_COMPARE, which V1 does not expose;
  // it is asserted at the registry so the refusal this surface would inherit is known.
  const stale = registry.query("AMBITO_COMPARE", {
    a: { scope: "PLANNING_AMBITO", code: CODE, edition: { development_state: "S1:STALE", available_buildability: "S2:STALE" } },
    b: { scope: "PLANNING_AMBITO", code: CODE },
  });
  assert.equal(stale.reason, "OUTSIDE_TEMPORAL_COVERAGE");
});

test("E07 current active Lens: AMBITOS_IN_LENS is the registry's membership, with no quantity", () => {
  const outcome = ask("AMBITOS_IN_LENS");
  assert.equal(outcome.status, "answered");
  const direct = planningIndex.ambitosIntersecting(CODE_POINT.lon, CODE_POINT.lat, 900);
  assert.deepEqual(outcome.result.value, direct);
  assert.equal(outcome.result.value.quantitiesProvided, false);
  const p = present(outcome);
  assert.equal(p.scope.id, "LENS_INTERSECT_AMBITO");
  const list = p.facts.find((f) => f.id === "touched.list");
  assert.deepEqual(list.items.map((i) => i.code), direct.touched.map((t) => t.ambitoCode));
  assert.ok(!p.facts.some((f) => /area|share|surface|m²|percent|%/i.test(`${f.label} ${f.value}`)), "no overlap area, share or surface");
});

test("E08 unequal radii: Lens A and Lens B each answer for their own centre and radius", () => {
  const a = context({ lens: lens("A", CODE_POINT, 400) });
  const b = context({ lens: lens("B", SOL, 1500) });
  const outA = ask("AMBITOS_IN_LENS", a);
  const outB = ask("AMBITOS_IN_LENS", b);
  assert.deepEqual(outA.result.value, planningIndex.ambitosIntersecting(CODE_POINT.lon, CODE_POINT.lat, 400));
  assert.deepEqual(outB.result.value, planningIndex.ambitosIntersecting(SOL.lon, SOL.lat, 1500));
  assert.notEqual(outA.contextKey, outB.contextKey);
  assert.equal(outA.lens.radiusM, 400);
  assert.equal(outB.lens.radiusM, 1500);
  // A held answer keeps describing ITS Lens even when presented while the other is active.
  const held = Q.presentOutcome(outA, { language: "en", reading: "citizen", context: b, registry });
  assert.match(held.scope.instance, /Lens A/);
  assert.match(held.scope.instance, /400 m/);
});

test("E09 no available licence records: a stated empty state, with the unlocated rows named", () => {
  const remote = { lon: -3.69, lat: 40.52 }; // the northern edge of the municipality
  const ctx = context({ lens: lens("A", remote, 100) });
  const outcome = ask("LICENCES_IN_LENS", ctx);
  assert.equal(outcome.status, "answered");
  assert.equal(outcome.result.value.state, "NO_MATCHES", "this fixture point must hold no located record");
  const p = present(outcome, { context: ctx });
  assert.match(p.headline, /^No located granted licence/);
  assert.ok(p.facts.some((f) => f.id === "licences.unlocated"), "the rows that could not be located are disclosed beside the zeros");
});

test("E10 licence-date window: malformed is ambiguous, wholly outside is outside coverage, partly outside is disclosed", () => {
  for (const bad of [{ from: 20250101, to: 20251231 }, { from: "garbage", to: "2025-12-31" }, { from: "2025-02-30", to: "2025-12-31" }, {}, "2025", [1, 2]]) {
    const out = registry.query("LICENCES_IN_LENS", { ...CODE_POINT, radiusM: 900, window: bad });
    assert.equal(out.reason, "AMBIGUOUS_SCOPE", `window ${JSON.stringify(bad)} must be refused, not widened to the register`);
  }
  const outside = ask("LICENCES_IN_LENS", context({ licenceWindow: { from: "1990-01-01", to: "1990-12-31" } }));
  assert.equal(outside.result.reason, "OUTSIDE_TEMPORAL_COVERAGE");
  const partly = ask("LICENCES_IN_LENS", context({ licenceWindow: { from: "2022-01-01", to: "2023-06-30" } }));
  assert.equal(partly.status, "answered");
  assert.equal(partly.result.value.window.clamped, true);
  const p = present(partly);
  assert.ok(p.facts.find((f) => f.id === "licences.window").note.text.length > 0, "an adjusted window is stated");
  assert.equal(partly.result.value.window.from, "2023-01-13", "clamped to the register's real first grant date");
});

test("E11 unsupported dwelling count: refused with its clause, no number anywhere", () => {
  const outcome = Q.askRefused(registry, "dwellings", context());
  const p = present(outcome);
  assert.equal(p.kind, "abstention");
  assert.equal(p.abstention.reason, "CEILING_PROHIBITS");
  assert.equal(p.abstention.prohibition, "DWELLING_COUNT");
  assert.equal(p.facts.length, 0);
  assert.ok(p.abstention.prohibitionText.length > 0);
});

test("E12 prohibited legal interpretation: refused with its clause", () => {
  const p = present(Q.askRefused(registry, "legal", context()));
  assert.equal(p.abstention.prohibition, "LEGAL_INTERPRETATION");
});

test("E13 ambiguous scope: no single ámbito is never resolved by guessing", () => {
  const ctx = context({ lens: lens("A", SOL, 900), selection: { type: "BARRIO", code: "042", name: "Sol" } });
  const outcome = ask("AMBITO_PHASES", ctx);
  assert.equal(outcome.result.reason, "AMBIGUOUS_SCOPE");
  assert.equal(outcome.subject.origin, "NONE");
  assert.equal(outcome.subject.ignoredSelection.type, "BARRIO", "a barrio selection is reported as not used, never turned into an ámbito");
  assert.deepEqual(outcome.trace.map((t) => t.shape), ["AMBITO_AT_POINT"]);
  const p = present(outcome, { context: ctx });
  assert.ok(p.abstention.guidance && p.abstention.guidance.length > 0, "the reader is told how to establish a subject");
  assert.equal(p.subjectLines.length, 2);
  // Without any evidence selected, "which source supports this" is ambiguous too.
  assert.equal(ask("SOURCE_PROVENANCE").result.reason, "AMBIGUOUS_SCOPE");
});

test("E14 missing runtime dependency: the registry abstains by itself; a still-loading one is not an answer", () => {
  const bare = wire({ planningIndex: null, licenceIndex: null, ambitoEditionDiff: null, ambitoEditionCodeKnown: null });
  for (const id of ["AMBITO_AT_POINT", "AMBITOS_IN_LENS", "LICENCES_IN_LENS"]) {
    const out = Q.askQuestion(bare.registry, id, context());
    assert.equal(out.status, "abstained", id);
    assert.equal(out.result.reason, "NO_EVIDENCE_FOR_SCOPE", id);
  }
  const noEditions = wire({ ambitoEditionDiff: null });
  const diff = Q.askQuestion(noEditions.registry, "AMBITO_EDITION_DIFF", context({ selection: { type: "AMBITO", code: CODE, name: "x" } }));
  assert.equal(diff.result.reason, "NO_EVIDENCE_FOR_SCOPE");
  // A dependency that is still arriving never reaches the registry.
  let calls = 0;
  const spy = { query() { calls += 1; throw new Error("must not be called while loading"); } };
  const loading = Q.askQuestion(spy, "LICENCES_IN_LENS", context({ readiness: { ...READY, licences: "loading" } }));
  assert.equal(loading.status, "loading");
  assert.equal(loading.waitingFor, "licences");
  assert.equal(calls, 0);
  assert.equal(Q.askQuestion(spy, "AMBITO_EDITION_DIFF", context({ readiness: { ...READY, editions: "idle" } })).status, "loading");
  assert.equal(present(loading).kind, "loading");
});

test("E15 unavailable and withheld sources: an unknown source and a publisher-withheld source are refused, honestly", () => {
  assert.equal(Q.askQuestion(registry, "SOURCE_PROVENANCE", { ...context(), evidenceSourceId: "not_a_source" }).result.reason, "OUTSIDE_SOURCE_UNIVERSE");
  const withheld = JSON.parse(JSON.stringify(REGISTRY));
  withheld.sources.find((s) => s.id === "planning_ambito_geometry").source_state = "WITHHELD_BY_PUBLISHER";
  const w = wire({ registry: withheld });
  const out = Q.askQuestion(w.registry, "AMBITO_AT_POINT", context());
  assert.equal(out.result.reason, "WITHHELD_BY_PUBLISHER");
  // The provenance of a withheld source stays disclosable.
  const provenance = Q.askQuestion(w.registry, "SOURCE_PROVENANCE", { ...context(), evidenceSourceId: "planning_ambito_geometry" });
  assert.equal(provenance.status, "answered");
});

test("E16 municipality-wide CITY evidence resolves at the registry; V1 leaves it to the CITY mode", () => {
  const city = registry.query("CITY_HOTEL_DEMAND", {});
  assert.equal(city.kind, "EVIDENCE");
  assert.equal(city.scope, "MUNICIPALITY");
  assert.equal(city.derivation, "DESTINATION_CONTEXT_ASSEMBLY");
  assert.ok(!Q.QUESTIONS.some((q) => q.shape === "CITY_HOTEL_DEMAND"), "the existing CITY mode is the surface for this evidence");
});

// ============================================== 3. all eight abstention reasons

const REASON_FIXTURES = {
  UNREGISTERED_SHAPE: () => Q.askRefused(registry, "pressure", context()),
  AMBIGUOUS_SCOPE: () => ask("AMBITO_PHASES", context({ lens: lens("A", SOL, 900) })),
  NO_EVIDENCE_FOR_SCOPE: () => ask("AMBITO_AT_POINT", context({ lens: lens("A", SOL, 900) })),
  CROSS_SCOPE_WITHOUT_BASIS: () => ({
    status: "abstained", questionId: "SOURCE_PROVENANCE", shape: "AMBITO_COMPARE", contextKey: "x", lens: {}, subject: null, params: {}, trace: [],
    result: registry.query("AMBITO_COMPARE", { a: { scope: "LENS_CIRCLE", code: CODE }, b: { scope: "PLANNING_AMBITO", code: CODE } }),
  }),
  OUTSIDE_SOURCE_UNIVERSE: () => ask("AMBITO_PHASES", context({ selection: { type: "AMBITO", code: "ZZZ.00.00", name: "x" } })),
  OUTSIDE_TEMPORAL_COVERAGE: () => ask("LICENCES_IN_LENS", context({ licenceWindow: { from: "1990-01-01", to: "1990-12-31" } })),
  WITHHELD_BY_PUBLISHER: () => {
    const withheld = JSON.parse(JSON.stringify(REGISTRY));
    withheld.sources.find((s) => s.id === "planning_ambito_geometry").source_state = "WITHHELD_BY_PUBLISHER";
    return Q.askQuestion(wire({ registry: withheld }).registry, "AMBITO_AT_POINT", context());
  },
  CEILING_PROHIBITS: () => Q.askRefused(registry, "dwellings", context()),
};

test("all eight abstention reasons are reachable and each is shown with its machine identity and an explanation, in both languages", () => {
  assert.deepEqual(Object.keys(REASON_FIXTURES).sort(), [...R.ABSTENTION_REASONS].sort());
  for (const [reason, fixture] of Object.entries(REASON_FIXTURES)) {
    const outcome = fixture();
    assert.equal(outcome.result.kind, "ABSTENTION", reason);
    assert.equal(outcome.result.reason, reason);
    for (const language of ["en", "es"]) {
      for (const reading of ["citizen", "analyst"]) {
        const p = Q.presentOutcome(outcome, { language, reading, context: context(), registry });
        assert.equal(p.kind, "abstention");
        assert.equal(p.abstention.reason, reason, "the machine-readable reason is preserved");
        assert.ok(p.abstention.reasonName.length > 3 && p.abstention.explanation.length > 20, `${language}/${reading}/${reason} explains itself`);
        assert.ok(p.abstention.registryMessage === outcome.result.message, "the registry's own message is kept verbatim");
        assert.equal(p.facts.length, 0, "an abstention carries no fact");
        assert.equal(p.headline, p.abstention.reasonName);
      }
    }
  }
});

// ============================ 4. the UI cannot change the registry's meaning

const ANSWERED_CASES = [
  ["AMBITO_AT_POINT", () => context()],
  ["AMBITO_PHASES", () => context({ selection: { type: "AMBITO", code: CODE, name: "x" } })],
  ["AMBITO_PHASES", () => context({ lens: lens("A", CODE_POINT, 900) })], // subject from the Lens centre
  ["AMBITO_EDITION_DIFF", () => context({ selection: { type: "AMBITO", code: BOTH_EDITIONS_CODE, name: "x" } })],
  ["AMBITOS_IN_LENS", () => context()],
  ["LICENCES_IN_LENS", () => context()],
  ["SOURCE_PROVENANCE", () => ({ ...context(), evidenceSourceId: "planning_ambito_state" })],
];

test("every outcome IS the direct registry result for the same shape and parameters", () => {
  for (const [id, make] of ANSWERED_CASES) {
    const ctx = make();
    const outcome = ask(id, ctx);
    assert.equal(outcome.status, "answered", id);
    const direct = registry.query(Q.questionFor(id).shape, outcome.params);
    assert.deepEqual(outcome.result, direct, `${id}: the interface must not alter the resolver's result`);
    assert.ok(Object.isFrozen(outcome.result), `${id}: the registry's frozen result is carried untouched`);
  }
});

function collectStrings(value, into = new Set()) {
  if (typeof value === "string") into.add(value);
  else if (value && typeof value === "object") for (const child of Object.values(value)) collectStrings(child, into);
  return into;
}

test("every verbatim fact on every answer is a string that exists in the registry result", () => {
  for (const [id, make] of ANSWERED_CASES) {
    const ctx = make();
    const outcome = ask(id, ctx);
    const known = collectStrings(outcome.result.value);
    for (const language of ["en", "es"]) {
      const p = Q.presentOutcome(outcome, { language, reading: "analyst", context: ctx, registry });
      for (const fact of p.facts.filter((f) => f.verbatim && f.value != null)) {
        assert.ok(known.has(fact.value), `${id}/${language}: "${fact.value}" (${fact.id}) is not in the resolver output`);
      }
    }
  }
});

test("the answer carries all seven contract fields: value, scope, unit, sourceId, five freshness fields, ceiling, derivation", () => {
  for (const [id, make] of ANSWERED_CASES) {
    const ctx = make();
    const outcome = ask(id, ctx);
    const r = outcome.result;
    for (const field of ["value", "scope", "unit", "sourceId", "freshness", "ceiling", "derivation"]) assert.ok(field in r, `${id}: ${field}`);
    const p = present(outcome, { context: ctx });
    assert.equal(p.scope.id, r.scope);
    assert.equal(p.evidence.sourceId, r.sourceId);
    assert.equal(p.evidence.derivation, r.derivation);
    assert.equal(p.evidence.ceiling, r.ceiling, "the ceiling is carried verbatim, never softened");
    assert.deepEqual(p.evidence.freshness.map((f) => f.field), ["reference_date", "published_at", "retrieved_at", "update_frequency", "source_state"]);
    for (const row of p.evidence.freshness) assert.equal(row.raw, r.freshness[row.field] ?? null);
  }
});

test("a date the publisher did not declare is stated as not declared, never filled in", () => {
  const geometry = present(ask("AMBITO_AT_POINT"));
  assert.equal(geometry.evidence.referenceDeclared, false);
  assert.equal(geometry.evidence.referenceDate, Q.copyFor("en").notDeclared);
  assert.equal(present(ask("AMBITO_AT_POINT"), { language: "es" }).evidence.referenceDate, Q.copyFor("es").notDeclared);
  const state = present(ask("AMBITO_PHASES", context({ selection: { type: "AMBITO", code: CODE, name: "x" } })));
  assert.equal(state.evidence.referenceDeclared, true);
  assert.equal(state.evidence.referenceDate, "1 Jan 2026");
});

test("citizen and analyst readings carry the same facts, scope, evidence and limits, in both languages", () => {
  for (const [id, make] of ANSWERED_CASES) {
    const ctx = make();
    const outcome = ask(id, ctx);
    for (const language of ["en", "es"]) {
      const citizen = Q.presentOutcome(outcome, { language, reading: "citizen", context: ctx, registry });
      const analyst = Q.presentOutcome(outcome, { language, reading: "analyst", context: ctx, registry });
      assert.deepEqual(citizen.facts.map((f) => [f.id, f.value]), analyst.facts.map((f) => [f.id, f.value]), `${id}/${language} facts`);
      assert.deepEqual(citizen.limits, analyst.limits, `${id}/${language} limits`);
      assert.deepEqual(citizen.scope, analyst.scope);
      assert.deepEqual(citizen.evidence, analyst.evidence);
      assert.equal(citizen.headline, analyst.headline);
      assert.ok(analyst.trace.length > citizen.trace.length, "only the analyst reading adds trace rows");
    }
  }
});

test("Spanish and English presentations expose the same facts (ids and verbatim values)", () => {
  for (const [id, make] of ANSWERED_CASES) {
    const ctx = make();
    const outcome = ask(id, ctx);
    const en = Q.presentOutcome(outcome, { language: "en", reading: "citizen", context: ctx, registry });
    const es = Q.presentOutcome(outcome, { language: "es", reading: "citizen", context: ctx, registry });
    assert.deepEqual(en.facts.map((f) => f.id), es.facts.map((f) => f.id));
    assert.deepEqual(en.facts.filter((f) => f.verbatim).map((f) => f.value), es.facts.filter((f) => f.verbatim).map((f) => f.value));
    assert.equal(es.limits.length, en.limits.length);
  }
});

// ========================================================= 5. prohibited claims

test("licences: per-family counts only, no total, and the scope and ceiling say what a grant is not", () => {
  const outcome = ask("LICENCES_IN_LENS");
  const p = present(outcome);
  const counts = p.facts.filter((f) => f.id.startsWith("licences.") && Object.keys(outcome.result.value.perFamily).some((k) => f.id === `licences.${k}`));
  assert.equal(counts.length, 3);
  assert.deepEqual(counts.map((f) => f.id), Object.keys(outcome.result.value.perFamily).map((k) => `licences.${k}`));
  assert.ok(!p.facts.some((f) => /total|all families|overall|approval|rate/i.test(f.label)), "no cross-family total and no approval rate");
  assert.match(p.limits.join(" "), /not proof/i);
  assert.match(p.evidence.ceiling, /not evidence that work started/i, "the source's own ceiling is carried verbatim");
});

test("no limits, headline or fact on any answer states a prohibited conclusion", () => {
  const prohibited = /\b(will be built|homes|dwellings|completion date|% (complete|built)|percent(age)? (complete|built)|best area|ranking|score|carrying capacity|tourist pressure|because)\b/i;
  const allowedNegations = /(not|no|nunca|ni|sin)\b/i;
  for (const [id, make] of ANSWERED_CASES) {
    const ctx = make();
    const p = Q.presentOutcome(ask(id, ctx), { language: "en", reading: "analyst", context: ctx, registry });
    const text = [p.headline, ...p.facts.map((f) => `${f.label} ${f.value}`)].join(" | ");
    assert.ok(!prohibited.test(text), `${id}: headline/facts must not assert a prohibited claim: ${text}`);
    for (const limit of p.limits) {
      if (prohibited.test(limit)) assert.ok(allowedNegations.test(limit), `${id}: a prohibited term in a limit must be a negation: ${limit}`);
    }
  }
});

// =============================================== 6. context binding and staleness

test("the context key changes with every element of the analytical context and with nothing else", () => {
  const base = context();
  const key = Q.contextKey(base);
  assert.equal(Q.contextKey(JSON.parse(JSON.stringify(base))), key, "an identical context has an identical key");
  const variants = {
    which: { ...base, lens: { ...base.lens, which: "B" } },
    lon: { ...base, lens: { ...base.lens, lon: base.lens.lon + 0.00001 } },
    lat: { ...base, lens: { ...base.lens, lat: base.lens.lat + 0.00001 } },
    radius: { ...base, lens: { ...base.lens, radiusM: 901 } },
    selection: { ...base, selection: { type: "AMBITO", code: CODE } },
    selectionCode: { ...base, selection: { type: "AMBITO", code: "OTHER" } },
    windowFrom: { ...base, licenceWindow: { ...WINDOW, from: "2025-10-02" } },
    windowTo: { ...base, licenceWindow: { ...WINDOW, to: "2026-09-29" } },
    planning: { ...base, readiness: { ...READY, planning: "loading" } },
    licences: { ...base, readiness: { ...READY, licences: "loading" } },
    editions: { ...base, readiness: { ...READY, editions: "unavailable" } },
  };
  const seen = new Set([key]);
  for (const [name, variant] of Object.entries(variants)) {
    const next = Q.contextKey(variant);
    assert.notEqual(next, key, `${name} must change the key`);
    seen.add(next);
  }
  assert.equal(seen.size, 1 + Object.keys(variants).length, "no two variants collide");
  // Language and the reading preference are wording, not context.
  assert.equal(Q.contextKey({ ...base, language: "es", reading: "analyst" }), key);
});

test("an outcome records the context it was computed for, so it can be recognised as out of date", () => {
  const outcome = ask("LICENCES_IN_LENS");
  assert.equal(outcome.contextKey, Q.contextKey(context()));
  assert.notEqual(outcome.contextKey, Q.contextKey(context({ lens: lens("A", CODE_POINT, 901) })));
  assert.equal(outcome.lens.radiusM, 900);
});

test("a licence answer uses the applied window verbatim and never infers one", () => {
  const spy = { query: (shape, params) => registry.query(shape, params) };
  const seen = [];
  const recording = { query: (shape, params) => { seen.push([shape, params]); return spy.query(shape, params); } };
  Q.askQuestion(recording, "LICENCES_IN_LENS", context({ licenceWindow: { from: "2024-03-01", to: "2024-03-31" } }));
  assert.deepEqual(seen[0][1].window, { from: "2024-03-01", to: "2024-03-31" });
  const noWindow = Q.askQuestion(registry, "LICENCES_IN_LENS", context({ licenceWindow: null }));
  const p = present(noWindow);
  assert.ok(p.facts.find((f) => f.id === "licences.window").note.text.includes("default"), "an unset window is declared as the documented default, not hidden");
});

// ===================================================== 7. a layer with no model

test("the question layer has no model, key, network call, storage or free-text path", () => {
  for (const file of ["js/question-explorer.js", "js/question-explorer-view.js"]) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
      .split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");
    for (const pattern of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /localStorage|sessionStorage|indexedDB/, /\bapi[_-]?key\b/i,
      /openai|anthropic|gemini|llm|embedding|vector/i, /<input|<textarea|contenteditable/i, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, /Math\.random|Date\.now|new Date\(\)/]) {
      assert.ok(!pattern.test(source), `${file} must not contain ${pattern}`);
    }
  }
});

test("the model module is pure: importing it touches no DOM, no globals and no network", async () => {
  assert.equal(typeof document, "undefined");
  const copy = await import("../js/question-explorer.js");
  assert.ok(copy.QUESTIONS.length === 6);
});

test("the registered shape set and abstention vocabulary are unchanged by M2", () => {
  assert.equal(R.REGISTERED_SHAPES.length, 10);
  assert.equal(R.ABSTENTION_REASONS.length, 8);
  assert.equal(R.PROHIBITIONS.length, 8);
});
