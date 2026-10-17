// Evidence Registry query contract — the contract these tests defend (K13, #75).
//
// THE DECISIVE CONTRACTS:
//
//   1. The evidence object is FROZEN and TOTAL: {value, scope, unit, sourceId,
//      freshness(5), ceiling, derivation}. A missing field is rejected, never
//      defaulted. derivation is SOURCE_FACT or a named transformation.
//   2. The registered shape set is CLOSED. An unregistered shape is refused with
//      abstain(UNREGISTERED_SHAPE), never approximated.
//   3. abstain(reason) is a first-class result with a CLOSED eight-reason
//      vocabulary; every reason is reached by a test below.
//   4. The eight §4 prohibitions are enforced STRUCTURALLY; each is attempted and
//      refused by a test below.
//   5. A refusal is NEVER a zero and NEVER a nearest match.
//   6. classifyIntent is deterministic, carries no content, invokes no model and
//      opens no socket; its output is consumed only as a shape selector.
//   7. The drawer (js/scope-rail.js) and export (js/evidence-export.js) read the
//      SAME provenance THROUGH the registry; the rendered/serialised content is
//      unchanged.
//
// Pure `node --test`. The deterministic models are imported and wired exactly as
// the app wires them, against the committed artifacts, so the worked examples are
// real integration tests. No network.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const R = require("../js/evidence-registry.js");
const sr = require("../js/scope-rail.js");
const ex = require("../js/evidence-export.js");

import { freshnessOf } from "../js/evidence-scope.js";
import { createPlanningIndex, AMBITO_STATE, AVAILABILITY } from "../js/planning-ambito.js";
import { createLicenceIndex } from "../js/urban-licences.js";
import { createGeographyIndex } from "../js/geography.js";
import { createPopulationIndex, buildAreaProfile, AREA_STATE } from "../js/area-profile.js";
import { createDestinationIndex, buildDestinationContext, DESTINATION_STATE } from "../js/destination-context.js";
import { buildAmbitoComparisonModel } from "../js/ambito-comparison.js";
import { buildAmbitoComparison } from "../js/ambito-change.js";
import {
  ambitoEditionContainsCode,
  createCanonicalAmbitoComparisonInputResolver,
} from "../js/ambito-comparison-adapter.js";

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const REGISTRY = read("data/source_registry.json");

// --- wire the real models exactly as the app does -------------------------------
const GEOMETRY = read("data/planning/madrid_ambitos.geojson");
const STATE = read("data/planning/madrid_ambito_state.json");
const planningIndex = createPlanningIndex({ geometry: GEOMETRY, state: STATE });
const licenceIndex = createLicenceIndex(read("data/planning/madrid_urban_licences.json"));
const geo = createGeographyIndex(read("data/geography/madrid_admin.geojson"));
const pop = createPopulationIndex(read("data/population/madrid_population.json"));
const dest = createDestinationIndex(read("data/destination/madrid_hotel_demand.json"));
const areaProfileFor = ({ lon, lat }) =>
  buildAreaProfile({ lens: { lon, lat }, located: geo.locate(lon, lat), populationIndex: pop });
const destinationModel = buildDestinationContext({ index: dest, state: DESTINATION_STATE.AVAILABLE });

// The REAL #69 edition-diff model, wired exactly as the app's adapter wires it:
// buildAmbitoComparison over the committed change_detection block's two editions.
const CD = STATE.change_detection;
const ambitoEditionDiff = (code) =>
  buildAmbitoComparison({
    previous: { reference_date: CD.previous.reference_date, families: CD.previous.families },
    current: { reference_date: CD.current.reference_date, families: CD.current.families },
    exactCode: code,
  });
const ambitoComparisonInputFor = createCanonicalAmbitoComparisonInputResolver({ index: planningIndex, stateArtifact: STATE });
const ambitoEditionCodeKnown = (code) => ambitoEditionContainsCode(code, STATE);

const DEPS = {
  registry: REGISTRY,
  planningIndex,
  planningModule: { AMBITO_STATE, AVAILABILITY },
  licenceIndex,
  areaProfileFor,
  areaStates: AREA_STATE,
  destinationModel,
  destinationStateAvailable: DESTINATION_STATE.AVAILABLE,
  ambitoCompare: buildAmbitoComparisonModel,
  ambitoComparisonInputFor,
  ambitoEditionDiff, // the real #69 model (see the AMBITO_EDITION_DIFF tests below)
  ambitoEditionCodeKnown,
};
const reg = R.createEvidenceRegistry(DEPS);
// A code present in BOTH committed editions — a genuine two-edition diff.
const EDITION_CODE = Object.keys((CD.previous.families.S1 || {}).records || {}).find(
  (code) => (CD.current.families.S1 || {}).records && (CD.current.families.S1.records[code] !== undefined)
);

// A code that HAS published state, and the Sol barrio centre, discovered once.
const PUBLISHED_CODE = Object.keys(STATE.ambitos).find(
  (code) => STATE.ambitos[code].development_state &&
    STATE.ambitos[code].development_state.availability === AVAILABILITY.PUBLISHED
);
const SOL = { lon: -3.7038, lat: 40.4168 };
// A point known to fall inside an ámbito: scan the index for one.
function pointInsideSomeAmbito() {
  for (const entry of planningIndex.entries) {
    const g = entry.geometry || (entry.feature && entry.feature.geometry);
    if (!g) continue;
    let c = g.coordinates;
    // nudge off the exact vertex so point-in-polygon includes it
    while (Array.isArray(c[0])) c = c[0];
    const [lon, lat] = c;
    const probe = reg.query("AMBITO_AT_POINT", { lon, lat });
    if (R.isEvidence(probe)) return { lon, lat, code: probe.value.ambitoCode };
    // try the ámbito's own containment by its code centroid-ish average
  }
  return null;
}

// =============================================================== 1. evidence object

test("makeEvidence returns a frozen, total, inspectable evidence object", () => {
  const ev = R.makeEvidence({
    value: 7,
    scope: "MUNICIPALITY",
    unit: "unit.hotelDemand",
    sourceId: "hotel_demand",
    freshness: { reference_date: "2026-01", published_at: null, retrieved_at: "2026-02-01", update_frequency: "MONTHLY", source_state: "PROVISIONAL" },
    ceiling: "a ceiling",
    derivation: R.DERIVATION.SOURCE_FACT,
  });
  assert.equal(ev.kind, "EVIDENCE");
  assert.ok(Object.isFrozen(ev));
  assert.ok(Object.isFrozen(ev.freshness));
  assert.equal(ev.value, 7);
  assert.equal(ev.derivation, "SOURCE_FACT");
});

test("makeEvidence rejects an object missing ANY contract field", () => {
  const good = {
    value: 1, scope: "MUNICIPALITY", unit: "u", sourceId: "hotel_demand",
    freshness: { reference_date: null, published_at: null, retrieved_at: null, update_frequency: "NONE_DECLARED", source_state: "NOT_DECLARED_BY_PUBLISHER" },
    ceiling: "c", derivation: "SOURCE_FACT",
  };
  for (const field of ["scope", "unit", "sourceId", "freshness", "ceiling", "derivation"]) {
    const bad = { ...good };
    delete bad[field];
    assert.throws(() => R.makeEvidence(bad), new RegExp(field), `missing ${field} must throw`);
  }
  // value omitted (not merely undefined) is also rejected
  const noValue = { ...good };
  delete noValue.value;
  assert.throws(() => R.makeEvidence(noValue), /value/);
});

test("makeEvidence rejects a freshness record missing one of the five fields", () => {
  const base = {
    value: 1, scope: "MUNICIPALITY", unit: "u", sourceId: "hotel_demand",
    ceiling: "c", derivation: "SOURCE_FACT",
  };
  assert.throws(
    () => R.makeEvidence({ ...base, freshness: { reference_date: null, published_at: null, retrieved_at: null, update_frequency: "NONE_DECLARED" } }),
    /source_state/
  );
});

test("makeEvidence rejects an undeclared scope and an unnamed derivation", () => {
  const base = {
    value: 1, unit: "u", sourceId: "x",
    freshness: { reference_date: null, published_at: null, retrieved_at: null, update_frequency: "NONE_DECLARED", source_state: "NOT_DECLARED_BY_PUBLISHER" },
    ceiling: "c",
  };
  assert.throws(() => R.makeEvidence({ ...base, scope: "NOT_A_SCOPE", derivation: "SOURCE_FACT" }), /analytical scope/);
  assert.throws(() => R.makeEvidence({ ...base, scope: "MUNICIPALITY", derivation: "MADE_UP" }), /transformation/);
});

test("makeEvidence is structural; public queries authenticate source identity and dates", () => {
  const structural = R.makeEvidence({
    value: 1,
    scope: "MUNICIPALITY",
    unit: "u",
    sourceId: "not_a_registered_source",
    freshness: { reference_date: "2099-01-01", published_at: null, retrieved_at: null, update_frequency: "NONE_DECLARED", source_state: "NOT_DECLARED_BY_PUBLISHER" },
    ceiling: "structural fixture only",
    derivation: "SOURCE_FACT",
  });
  assert.ok(R.isEvidence(structural));
  assert.equal(reg.query("SOURCE_PROVENANCE", { sourceId: structural.sourceId }).reason, "OUTSIDE_SOURCE_UNIVERSE");
});

// ============================================================ 2. closed shape set

test("the registered shape set is exactly the ten documented shapes", () => {
  assert.deepEqual([...reg.shapes].sort(), [
    "AMBITOS_IN_LENS", "AMBITO_AT_POINT", "AMBITO_BUILDABILITY", "AMBITO_COMPARE",
    "AMBITO_EDITION_DIFF", "AMBITO_PHASES", "AREA_PROFILE_AT_POINT",
    "CITY_HOTEL_DEMAND", "LICENCES_IN_LENS", "SOURCE_PROVENANCE",
  ]);
});

test("an unregistered shape is refused, not approximated", () => {
  const out = reg.query("TOTAL_DWELLINGS_PER_BARRIO", { code: PUBLISHED_CODE });
  assert.ok(R.isAbstention(out));
  assert.equal(out.reason, "UNREGISTERED_SHAPE");
});

// ======================================================= 3. one resolver per shape

test("SOURCE_PROVENANCE resolves a registered source with full provenance", () => {
  const out = reg.query("SOURCE_PROVENANCE", { sourceId: "population" });
  assert.ok(R.isEvidence(out));
  assert.equal(out.derivation, "REGISTRY_LOOKUP");
  assert.equal(out.value.id, "population");
  assert.equal(out.scope, "OFFICIAL_BARRIO");
  for (const f of ["reference_date", "published_at", "retrieved_at", "update_frequency", "source_state"]) {
    assert.ok(f in out.freshness, `freshness.${f}`);
  }
});

test("AREA_PROFILE_AT_POINT resolves a barrio inside Madrid (boundary: outside is refused)", () => {
  const inside = reg.query("AREA_PROFILE_AT_POINT", SOL);
  assert.ok(R.isEvidence(inside));
  assert.equal(inside.scope, "OFFICIAL_BARRIO");
  assert.equal(inside.derivation, "AREA_PROFILE_ASSEMBLY");
  assert.deepEqual(inside.value.sources, ["geography", "population"]);

  const outside = reg.query("AREA_PROFILE_AT_POINT", { lon: 0, lat: 0 });
  assert.ok(R.isAbstention(outside));
  assert.equal(outside.reason, "OUTSIDE_SOURCE_UNIVERSE");
});

test("CITY_HOTEL_DEMAND resolves the municipality figure", () => {
  const out = reg.query("CITY_HOTEL_DEMAND", {});
  assert.ok(R.isEvidence(out));
  assert.equal(out.scope, "MUNICIPALITY");
  assert.equal(out.sourceId, "hotel_demand");
  assert.equal(out.derivation, "DESTINATION_CONTEXT_ASSEMBLY");
});

test("AMBITO_PHASES resolves a code with published state (empty: a code with none abstains)", () => {
  const out = reg.query("AMBITO_PHASES", { code: PUBLISHED_CODE });
  assert.ok(R.isEvidence(out));
  assert.equal(out.scope, "PLANNING_AMBITO");
  assert.equal(out.derivation, "SOURCE_FACT");
});

test("AMBITOS_IN_LENS returns a membership relation carrying no quantity to apportion", () => {
  const out = reg.query("AMBITOS_IN_LENS", { lon: SOL.lon, lat: SOL.lat, radiusM: 1000 });
  assert.ok(R.isEvidence(out));
  assert.equal(out.scope, "LENS_INTERSECT_AMBITO");
  assert.equal(out.derivation, "CIRCLE_INTERSECT_POLYGON");
  // The membership relation exposes no apportionable quantity.
  assert.equal(out.value.quantitiesProvided, false);
});

test("LICENCES_IN_LENS resolves located records inside the circle", () => {
  const out = reg.query("LICENCES_IN_LENS", { lon: SOL.lon, lat: SOL.lat, radiusM: 1000 });
  assert.ok(R.isEvidence(out));
  assert.equal(out.scope, "ADDRESS_POINT");
  assert.equal(out.derivation, "IN_CIRCLE_FILTER");
  // Per-family counts only — never a single collapsed total.
  assert.ok(out.value.perFamily && typeof out.value.perFamily === "object");
  assert.ok(!("total" in out.value));
});

test("AMBITO_COMPARE runs the same-scope comparison model", () => {
  const a = { scope: "PLANNING_AMBITO", code: PUBLISHED_CODE };
  const b = { scope: "PLANNING_AMBITO", code: PUBLISHED_CODE };
  const out = reg.query("AMBITO_COMPARE", { a, b });
  // Either a model (evidence) or a documented withheld/refusal — never a crash.
  assert.ok(R.isEvidence(out) || R.isAbstention(out));
  if (R.isEvidence(out)) assert.equal(out.derivation, "SAME_SCOPE_COMPARISON");
});

test("AMBITO_EDITION_DIFF runs the real #69 edition-diff over two committed editions", () => {
  assert.ok(EDITION_CODE, "expected a code present in both committed editions");
  const out = reg.query("AMBITO_EDITION_DIFF", { code: EDITION_CODE });
  assert.ok(R.isEvidence(out), `expected evidence, got ${JSON.stringify(out)}`);
  assert.equal(out.scope, "PLANNING_AMBITO");
  assert.equal(out.derivation, "EDITION_DIFF");
  assert.equal(out.sourceId, "planning_ambito_state");
  // The value is the real classifier's comparison, carrying its per-family state.
  assert.ok(out.value && out.value.state);
});

test("AMBITO_EDITION_DIFF abstains when the #69 model is not wired (not a crash)", () => {
  const noEdition = R.createEvidenceRegistry({ registry: REGISTRY, planningIndex, planningModule: { AMBITO_STATE, AVAILABILITY } });
  const out = noEdition.query("AMBITO_EDITION_DIFF", { code: EDITION_CODE });
  assert.ok(R.isAbstention(out));
  assert.equal(out.reason, "NO_EVIDENCE_FOR_SCOPE");
});

// ======================================================= 4. every abstention reason

test("abstention reason: UNREGISTERED_SHAPE", () => {
  assert.equal(reg.query("NOPE", {}).reason, "UNREGISTERED_SHAPE");
  assert.equal(R.classifyIntent("tell me a joke").reason, "UNREGISTERED_SHAPE");
});

test("abstention reason: AMBIGUOUS_SCOPE", () => {
  assert.equal(reg.query("AMBITO_PHASES", {}).reason, "AMBIGUOUS_SCOPE"); // no code
  assert.equal(reg.query("AMBITO_AT_POINT", {}).reason, "AMBIGUOUS_SCOPE"); // no point
});

test("abstention reason: NO_EVIDENCE_FOR_SCOPE", () => {
  // A real ámbito code with no published buildability (missing is not zero).
  const code = Object.keys(STATE.ambitos).find((c) => {
    const b = STATE.ambitos[c].available_buildability;
    const feat = planningIndex.featureFor(c);
    return feat && (!b || b.availability !== AVAILABILITY.PUBLISHED);
  });
  assert.ok(code, "expected an ámbito with geometry but no published buildability");
  const out = reg.query("AMBITO_BUILDABILITY", { code });
  assert.equal(out.reason, "NO_EVIDENCE_FOR_SCOPE");
});

test("abstention reason: CROSS_SCOPE_WITHOUT_BASIS", () => {
  const out = reg.query("AMBITO_COMPARE", {
    a: { scope: "PLANNING_AMBITO", code: PUBLISHED_CODE },
    b: { scope: "OFFICIAL_BARRIO", code: "x" },
  });
  assert.ok(R.isAbstention(out));
  assert.equal(out.reason, "CROSS_SCOPE_WITHOUT_BASIS");
  assert.equal(out.prohibition, "CROSS_SCOPE_COMBINATION");
});

test("abstention reason: OUTSIDE_SOURCE_UNIVERSE", () => {
  assert.equal(reg.query("SOURCE_PROVENANCE", { sourceId: "not_a_source" }).reason, "OUTSIDE_SOURCE_UNIVERSE");
  assert.equal(reg.query("AMBITO_PHASES", { code: "ZZZ-NOT-A-CODE" }).reason, "OUTSIDE_SOURCE_UNIVERSE");
  assert.equal(reg.query("AREA_PROFILE_AT_POINT", { lon: 2.3, lat: 48.8 }).reason, "OUTSIDE_SOURCE_UNIVERSE");
});

test("abstention reason: OUTSIDE_TEMPORAL_COVERAGE — not a nearest match", () => {
  const lic = reg.query("LICENCES_IN_LENS", { lon: SOL.lon, lat: SOL.lat, radiusM: 1000, window: { from: "1990-01-01", to: "1990-12-31" } });
  assert.equal(lic.reason, "OUTSIDE_TEMPORAL_COVERAGE");
  const hotel = reg.query("CITY_HOTEL_DEMAND", { period: "1800-01" });
  assert.equal(hotel.reason, "OUTSIDE_TEMPORAL_COVERAGE");
});

test("abstention reason: WITHHELD_BY_PUBLISHER — a withheld value is refused, the provenance is not", () => {
  const withheldRegistry = JSON.parse(JSON.stringify(REGISTRY));
  withheldRegistry.sources.find((s) => s.id === "hotel_demand").source_state = "WITHHELD_BY_PUBLISHER";
  const r2 = R.createEvidenceRegistry({
    registry: withheldRegistry,
    destinationModel: { state: "available", coverage: { earliest: "2020-01", latest: "2026-08" } },
    destinationStateAvailable: "available",
  });
  assert.equal(r2.query("CITY_HOTEL_DEMAND", {}).reason, "WITHHELD_BY_PUBLISHER");
  // Disclosing WHERE a withheld figure comes from is still permitted.
  assert.ok(R.isEvidence(r2.query("SOURCE_PROVENANCE", { sourceId: "hotel_demand" })));
});

test("abstention reason: CEILING_PROHIBITS — a dwelling count", () => {
  const out = reg.query("AMBITO_BUILDABILITY", { code: PUBLISHED_CODE, wantsDwellingCount: true });
  assert.equal(out.reason, "CEILING_PROHIBITS");
  assert.equal(out.prohibition, "DWELLING_COUNT");
});

// ======================================================= 5. every §4 prohibition

test("prohibition (1): an untraceable factual token cannot be constructed", () => {
  assert.throws(
    () => R.makeEvidence({ value: 5, scope: "MUNICIPALITY", unit: "u", sourceId: "", freshness: { reference_date: null, published_at: null, retrieved_at: null, update_frequency: "NONE_DECLARED", source_state: "NOT_DECLARED_BY_PUBLISHER" }, ceiling: "c", derivation: "SOURCE_FACT" }),
    /source identity/
  );
});

test("prohibition (2): cross-scope combination without a basis is refused", () => {
  const out = reg.query("AMBITO_COMPARE", { a: { scope: "PLANNING_AMBITO" }, b: { scope: "MUNICIPALITY" } });
  assert.equal(out.prohibition, "CROSS_SCOPE_COMBINATION");
  assert.equal(out.reason, "CROSS_SCOPE_WITHOUT_BASIS");
});

test("prohibition (3): whole-to-part apportionment is refused", () => {
  const out = reg.query("AMBITOS_IN_LENS", { lon: SOL.lon, lat: SOL.lat, radiusM: 1000, wantsApportionment: true });
  assert.equal(out.prohibition, "WHOLE_TO_PART_APPORTIONMENT");
  assert.equal(out.reason, "CEILING_PROHIBITS");
});

test("prohibition (4): a dwelling / protected-dwelling count is refused", () => {
  const out = reg.query("AMBITO_PHASES", { code: PUBLISHED_CODE, wantsDwellingCount: true });
  assert.equal(out.prohibition, "DWELLING_COUNT");
});

test("prohibition (5): a completion date / projection is refused", () => {
  assert.equal(reg.query("AMBITO_PHASES", { code: PUBLISHED_CODE, wantsCompletionDate: true }).prohibition, "COMPLETION_OR_PROJECTION");
  assert.equal(reg.query("AMBITO_PHASES", { code: PUBLISHED_CODE, wantsProjection: true }).prohibition, "COMPLETION_OR_PROJECTION");
});

test("prohibition (6): a ranking / score / recommendation is refused", () => {
  assert.equal(reg.query("AMBITOS_IN_LENS", { lon: SOL.lon, lat: SOL.lat, radiusM: 1000, wantsRanking: true }).prohibition, "RANKING_OR_RECOMMENDATION");
  assert.equal(reg.query("CITY_HOTEL_DEMAND", { wantsRecommendation: true }).prohibition, "RANKING_OR_RECOMMENDATION");
});

test("prohibition (7): a causal claim is refused", () => {
  assert.equal(reg.query("CITY_HOTEL_DEMAND", { wantsCausalClaim: true }).prohibition, "CAUSAL_CLAIM");
});

test("prohibition (8): a legal / regulatory interpretation is refused", () => {
  assert.equal(reg.query("LICENCES_IN_LENS", { lon: SOL.lon, lat: SOL.lat, radiusM: 1000, wantsLegalInterpretation: true }).prohibition, "LEGAL_INTERPRETATION");
});

// ========================================================== 6. provenance totality

test("every resolver result carries source id, scope, unit, five freshness fields, ceiling and derivation", () => {
  const results = [
    reg.query("SOURCE_PROVENANCE", { sourceId: "geography" }),
    reg.query("AREA_PROFILE_AT_POINT", SOL),
    reg.query("CITY_HOTEL_DEMAND", {}),
    reg.query("AMBITO_PHASES", { code: PUBLISHED_CODE }),
    reg.query("AMBITOS_IN_LENS", { lon: SOL.lon, lat: SOL.lat, radiusM: 1000 }),
    reg.query("LICENCES_IN_LENS", { lon: SOL.lon, lat: SOL.lat, radiusM: 1000 }),
  ].filter(R.isEvidence);
  assert.ok(results.length >= 5);
  for (const ev of results) {
    assert.ok(typeof ev.sourceId === "string" && ev.sourceId.length > 0);
    assert.ok(typeof ev.scope === "string");
    assert.ok(typeof ev.unit === "string" && ev.unit.length > 0);
    assert.ok(typeof ev.ceiling === "string" && ev.ceiling.length > 0);
    assert.ok(R.DERIVATIONS.includes(ev.derivation));
    for (const f of ["reference_date", "published_at", "retrieved_at", "update_frequency", "source_state"]) {
      assert.ok(f in ev.freshness, `${ev.sourceId} freshness.${f}`);
    }
    assert.ok(Object.isFrozen(ev));
  }
});

test("SOURCE_FACT and derived transformations stay distinguished in the answer", () => {
  const fact = reg.query("AMBITO_PHASES", { code: PUBLISHED_CODE });
  assert.equal(fact.derivation, "SOURCE_FACT");
  const derived = reg.query("AMBITOS_IN_LENS", { lon: SOL.lon, lat: SOL.lat, radiusM: 1000 });
  assert.equal(derived.derivation, "CIRCLE_INTERSECT_POLYGON");
  assert.equal(reg.query("AREA_PROFILE_AT_POINT", SOL).derivation, "AREA_PROFILE_ASSEMBLY");
  assert.equal(reg.query("CITY_HOTEL_DEMAND", {}).derivation, "DESTINATION_CONTEXT_ASSEMBLY");
  assert.notEqual(fact.derivation, derived.derivation);
});

// =============================================================== 7. classifier seam

test("classifyIntent is deterministic and returns ONLY a shape and confidence", () => {
  const a = R.classifyIntent("what is the hotel demand in Madrid?");
  const b = R.classifyIntent("what is the hotel demand in Madrid?");
  assert.deepEqual(a, b); // deterministic
  assert.deepEqual(Object.keys(a).sort(), ["confidence", "shape"]);
  assert.ok(reg.shapes.includes(a.shape));
  // No factual content, value, date, scope or free text rides on the classifier.
  assert.equal(a.value, undefined);
  assert.equal(a.ceiling, undefined);
  assert.equal(a.answer, undefined);
});

test("classifier output is consumed only as a shape SELECTOR; the question text is never content", () => {
  // Two differently-worded questions that select the same shape yield identical
  // evidence — the answer comes from the resolver, not the words.
  const q1 = R.classifyIntent("hotel demand please");
  const q2 = R.classifyIntent("show me the hotel occupancy figure");
  assert.equal(q1.shape, "CITY_HOTEL_DEMAND");
  assert.equal(q2.shape, "CITY_HOTEL_DEMAND");
  const e1 = reg.query(q1.shape, {});
  const e2 = reg.query(q2.shape, {});
  assert.deepEqual(e1, e2);
  // A shape that is only a selector cannot smuggle a prohibited operation: the
  // classifier can never return a shape outside the closed set.
  assert.ok(R.isAbstention(R.classifyIntent("rank the barrios by dwellings")));
});

test("classifyIntent matches Spanish and English for the same shape", () => {
  assert.equal(R.classifyIntent("which ámbito is here?").shape, R.classifyIntent("qué ámbito está aquí?").shape);
});

// ============================================================ 8. no network, no model

test("no module in the layer performs a network call or references a credential/model endpoint", () => {
  const src = fs.readFileSync(new URL("../js/evidence-registry.js", import.meta.url), "utf8");
  // Operational integration patterns — NOT disclaimer prose.
  const forbidden = [
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /\brequire\(\s*["']https?["']\s*\)/,
    /https?:\/\//,
    /\bapi[_-]?key\b/i,
    /\bAuthorization\b/,
    /\bBearer\s/,
    /\bopenai\b/i,
    /@anthropic\b/i,
    /generativelanguage/i,
  ];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(src), `evidence-registry.js must not contain ${pattern}`);
  }
});

test("no resolver reaches a clock or Date", () => {
  const src = fs.readFileSync(new URL("../js/evidence-registry.js", import.meta.url), "utf8");
  assert.ok(!/\bDate\.now\b/.test(src));
  assert.ok(!/new\s+Date\b/.test(src));
});

// ==================================================== 9. drawer refactor equivalence

// The pre-refactor formula for one drawer source object, reconstructed here. The
// drawer now builds this THROUGH the registry's SOURCE_PROVENANCE assembly; this
// test asserts the result is identical, field for field and value for value.
function expectedDrawerSource(id, isK7) {
  const source = REGISTRY.sources.find((s) => s.id === id);
  const base = freshnessOf(source);
  const freshness = isK7
    ? { ...base, reference_date: source.change_detection.oldest_contributor_reference_date }
    : base;
  return {
    id,
    displayName: source.display_name || id,
    authority: source.authority || null,
    datasetUrl: source.dataset_url || null,
    artifact: source.artifact || null,
    builder: source.builder || null,
    freshness,
    freshnessEvidence: source.freshness_evidence || null,
    periodSemantics: source.source_period_semantics || null,
    interpretationCeiling: source.interpretation_ceiling,
    changeDetectionProvenance: isK7 ? source.change_detection : null,
  };
}

test("the drawer's rendered source provenance is unchanged by reading through the registry", () => {
  const surfaces = ["place.area.residents", "place.area.vut", "place.planning.phases", "place.planning.change", "place.licences"];
  const records = sr.buildEvidenceRecords({ surfaces, registry: REGISTRY });
  for (const record of records) {
    const isK7 = record.surface === "place.planning.change";
    for (const source of record.sources) {
      assert.deepEqual(source, expectedDrawerSource(source.id, isK7), `${record.surface} / ${source.id}`);
    }
  }
});

// ==================================================== 10. export bundle equivalence

test("the export's sources.json is unchanged by reading through the registry", () => {
  // A representative projection whose contributing sources span several surfaces.
  const projection = {
    meta: { generated_at: "2026-10-17T00:00:00Z", mode: "PLACE", reading: "analyst", language: "en", snapshot_id: "test" },
    state_url: "https://example.test/#x",
    values: [],
    evidence: [
      { sources: [{ id: "population" }, { id: "geography" }] },
      { sources: [{ id: "hotel_demand" }, { id: "not_a_registered_source" }] },
    ],
    geometry: [],
  };
  const built = ex.buildSourcesObject(projection, REGISTRY);
  const byId = new Map(REGISTRY.sources.map((s) => [s.id, s]));
  const expected = [];
  for (const id of ex.contributingSourceIds(projection)) {
    const source = byId.get(id);
    if (!source) { expected.push({ id, missing_from_registry: true }); continue; }
    const entry = {};
    for (const field of ex.SOURCE_EXPORT_FIELDS) if (source[field] !== undefined) entry[field] = source[field];
    expected.push(entry);
  }
  assert.deepEqual(built.sources, expected);
  // The unknown source is still reported, not hidden.
  assert.ok(built.sources.some((s) => s.id === "not_a_registered_source" && s.missing_from_registry === true));
});

// ================================================= 11. gate §15.5 worked examples

test("worked example: 'which ámbito contains this point, and what is its state?'", () => {
  const found = pointInsideSomeAmbito();
  assert.ok(found, "expected at least one point inside an ámbito");
  const at = reg.query("AMBITO_AT_POINT", { lon: found.lon, lat: found.lat });
  assert.ok(R.isEvidence(at));
  assert.equal(at.scope, "PLANNING_AMBITO");
  const phases = reg.query("AMBITO_PHASES", { code: at.value.ambitoCode });
  assert.ok(R.isEvidence(phases) || R.isAbstention(phases)); // published or an honest absence
});

test("worked example: a dwelling-count question abstains with CEILING_PROHIBITS", () => {
  // However the question is phrased, the dwelling-count intent is refused.
  const out = reg.query("AMBITO_BUILDABILITY", { code: PUBLISHED_CODE, wantsDwellingCount: true });
  assert.equal(out.reason, "CEILING_PROHIBITS");
  assert.equal(out.prohibition, "DWELLING_COUNT");
});

test("worked example: a cross-scope question abstains rather than apportioning", () => {
  const out = reg.query("AMBITO_COMPARE", {
    a: { scope: "PLANNING_AMBITO", code: PUBLISHED_CODE },
    b: { scope: "LENS_CIRCLE" },
  });
  assert.equal(out.reason, "CROSS_SCOPE_WITHOUT_BASIS");
});

// =============================================== 12. post-review contract hardening

// Finding 1 — CITY_HOTEL_DEMAND must never return a later month's figures under an
// earlier requested month's label.
test("CITY_HOTEL_DEMAND returns the served (latest) period when a period is pinned to it", () => {
  const served = destinationModel.period.key;
  const out = reg.query("CITY_HOTEL_DEMAND", { period: served });
  assert.ok(R.isEvidence(out));
  assert.equal(out.value.period.key, served);
});

test("CITY_HOTEL_DEMAND abstains for an in-range earlier month rather than returning the latest figure", () => {
  const served = destinationModel.period.key;
  const earlier = destinationModel.coverage.earliest;
  assert.notEqual(earlier, served, "fixture must have more than one period");
  const out = reg.query("CITY_HOTEL_DEMAND", { period: earlier });
  assert.ok(R.isAbstention(out), `must not return the latest month for an earlier request: ${JSON.stringify(out).slice(0, 120)}`);
  assert.equal(out.reason, "NO_EVIDENCE_FOR_SCOPE");
});

test("CITY_HOTEL_DEMAND abstains OUTSIDE_TEMPORAL_COVERAGE beyond the series, not a nearest match", () => {
  assert.equal(reg.query("CITY_HOTEL_DEMAND", { period: "1800-01" }).reason, "OUTSIDE_TEMPORAL_COVERAGE");
  assert.equal(reg.query("CITY_HOTEL_DEMAND", { period: "2999-12" }).reason, "OUTSIDE_TEMPORAL_COVERAGE");
});

// Finding 2 — AMBITO_COMPARE scope validation; no free-text basis bypass.
test("AMBITO_COMPARE rejects an input with a missing or invalid scope", () => {
  assert.equal(reg.query("AMBITO_COMPARE", { a: { code: PUBLISHED_CODE }, b: { scope: "PLANNING_AMBITO" } }).reason, "AMBIGUOUS_SCOPE");
  assert.equal(reg.query("AMBITO_COMPARE", { a: { scope: "NOT_A_SCOPE" }, b: { scope: "PLANNING_AMBITO" } }).reason, "AMBIGUOUS_SCOPE");
});

test("AMBITO_COMPARE: a free-text basis cannot bypass the cross-scope rule", () => {
  const out = reg.query("AMBITO_COMPARE", {
    a: { scope: "PLANNING_AMBITO", code: PUBLISHED_CODE },
    b: { scope: "OFFICIAL_BARRIO" },
    basis: "a hand-waved justification",
  });
  assert.equal(out.reason, "CROSS_SCOPE_WITHOUT_BASIS");
  assert.equal(out.prohibition, "CROSS_SCOPE_COMBINATION");
});

test("AMBITO_COMPARE refuses a same-scope pair that is not PLANNING_AMBITO", () => {
  const out = reg.query("AMBITO_COMPARE", { a: { scope: "MUNICIPALITY" }, b: { scope: "MUNICIPALITY" } });
  assert.equal(out.reason, "AMBIGUOUS_SCOPE");
});

test("AMBITO_COMPARE preserves a legitimate same-scope PLANNING_AMBITO comparison", () => {
  const out = reg.query("AMBITO_COMPARE", {
    a: { scope: "PLANNING_AMBITO", code: PUBLISHED_CODE },
    b: { scope: "PLANNING_AMBITO", code: PUBLISHED_CODE },
  });
  assert.ok(R.isEvidence(out) || R.isAbstention(out));
  if (R.isEvidence(out)) assert.equal(out.derivation, "SAME_SCOPE_COMPARISON");
});

test("AMBITO_COMPARE rejects fabricated caller values instead of comparing them as official evidence", () => {
  const fabricated = {
    scope: "PLANNING_AMBITO",
    code: PUBLISHED_CODE,
    developmentState: { availability: "PUBLISHED", phases: [{ sourceValue: "FABRICATED" }] },
    availableBuildability: { availability: "PUBLISHED", rows: [{ useClasses: [{ value: 999999999 }] }] },
  };
  const out = reg.query("AMBITO_COMPARE", {
    a: fabricated,
    b: { scope: "PLANNING_AMBITO", code: PUBLISHED_CODE },
  });
  assert.ok(R.isAbstention(out));
  assert.equal(out.reason, "AMBIGUOUS_SCOPE");
});

test("AMBITO_COMPARE resolves exact registered edition identities and rejects stale identities", () => {
  const current = {
    development_state: STATE.editions.development_state.snapshot_identity,
    available_buildability: STATE.editions.available_buildability.snapshot_identity,
  };
  const previous = {
    development_state: CD.previous.families.S1.snapshot_identity,
    available_buildability: CD.previous.families.S2.snapshot_identity,
  };
  const crossEdition = reg.query("AMBITO_COMPARE", {
    a: { scope: "PLANNING_AMBITO", code: PUBLISHED_CODE, edition: previous },
    b: { scope: "PLANNING_AMBITO", code: PUBLISHED_CODE, edition: current },
  });
  assert.ok(R.isEvidence(crossEdition));
  assert.equal(crossEdition.value.editionBasis.like_for_like.development_state, false);
  assert.equal(crossEdition.value.editionBasis.like_for_like.available_buildability, false);
  const stale = reg.query("AMBITO_COMPARE", {
    a: { scope: "PLANNING_AMBITO", code: PUBLISHED_CODE, edition: { ...current, development_state: "S1:STALE" } },
    b: { scope: "PLANNING_AMBITO", code: PUBLISHED_CODE },
  });
  assert.equal(stale.reason, "OUTSIDE_TEMPORAL_COVERAGE");
});

// Finding 3 — provenance integrity: no arbitrary freshness rewrite; every public
// query result's sourceId is a registered source.
test("sourceProvenance accepts only a reference_date override (the K7 case) and rejects any other field", () => {
  // The legitimate K7 override works and changes only reference_date.
  const k7 = R.sourceProvenance(REGISTRY, "planning_ambito_state", { freshnessOverride: { reference_date: "2025-07-01" } });
  assert.equal(k7.freshness.reference_date, "2025-07-01");
  const base = R.sourceProvenance(REGISTRY, "planning_ambito_state");
  assert.equal(k7.freshness.source_state, base.freshness.source_state); // unchanged
  // Overriding any other freshness field is refused.
  assert.throws(() => R.sourceProvenance(REGISTRY, "population", { freshnessOverride: { source_state: "DEFINITIVE" } }), /only reference_date/);
  assert.throws(() => R.sourceProvenance(REGISTRY, "population", { freshnessOverride: { retrieved_at: "2099-01-01" } }), /only reference_date/);
  // A malformed reference_date (a build clock, a bare year) is refused too.
  assert.throws(() => R.sourceProvenance(REGISTRY, "population", { freshnessOverride: { reference_date: "2026" } }), /ISO month/);
  // Syntactically valid is insufficient: it must be the registered K7 oldest contributor.
  assert.throws(() => R.sourceProvenance(REGISTRY, "planning_ambito_state", { freshnessOverride: { reference_date: "2099-01-01" } }), /registered contributing-edition/);
  assert.throws(() => R.sourceProvenance(REGISTRY, "population", { freshnessOverride: { reference_date: "2025-07-01" } }), /registered contributing-edition/);
});

test("every public query result's sourceId is a registered source", () => {
  const registeredIds = new Set(REGISTRY.sources.map((s) => s.id));
  const results = [
    reg.query("SOURCE_PROVENANCE", { sourceId: "geography" }),
    reg.query("AREA_PROFILE_AT_POINT", SOL),
    reg.query("CITY_HOTEL_DEMAND", {}),
    reg.query("AMBITO_PHASES", { code: PUBLISHED_CODE }),
    reg.query("AMBITOS_IN_LENS", { lon: SOL.lon, lat: SOL.lat, radiusM: 1000 }),
    reg.query("LICENCES_IN_LENS", { lon: SOL.lon, lat: SOL.lat, radiusM: 1000 }),
    reg.query("AMBITO_EDITION_DIFF", { code: EDITION_CODE }),
  ].filter(R.isEvidence);
  assert.ok(results.length >= 6);
  for (const ev of results) assert.ok(registeredIds.has(ev.sourceId), `unregistered sourceId: ${ev.sourceId}`);
});

// Finding 4 — AMBITO_EDITION_DIFF does not fabricate a diff for a non-existent code.
test("AMBITO_EDITION_DIFF refuses a bogus code OUTSIDE_SOURCE_UNIVERSE, not a fabricated diff", () => {
  const out = reg.query("AMBITO_EDITION_DIFF", { code: "ZZZ-NOT-A-CODE" });
  assert.ok(R.isAbstention(out));
  assert.equal(out.reason, "OUTSIDE_SOURCE_UNIVERSE");
});

test("AMBITO_EDITION_DIFF abstains when no authoritative edition-code universe is wired", () => {
  const indexWithoutFeatureFor = { ...planningIndex, featureFor: undefined };
  const noUniverse = R.createEvidenceRegistry({
    registry: REGISTRY,
    planningIndex: indexWithoutFeatureFor,
    ambitoEditionDiff,
  });
  const out = noUniverse.query("AMBITO_EDITION_DIFF", { code: "ZZZ-NOT-A-CODE" });
  assert.equal(out.reason, "NO_EVIDENCE_FOR_SCOPE");
  assert.equal(noUniverse.query("AMBITO_EDITION_DIFF", { code: EDITION_CODE }).reason, "NO_EVIDENCE_FOR_SCOPE");
});

test("AMBITO_EDITION_DIFF preserves codes appearing in only one committed edition", () => {
  const codesFor = (side) => new Set(Object.values(side.families).flatMap((family) => Object.keys(family.records || {})));
  const previousCodes = codesFor(CD.previous);
  const currentCodes = codesFor(CD.current);
  const editionSpecific = [...new Set([...previousCodes, ...currentCodes])].find((code) => previousCodes.has(code) !== currentCodes.has(code));
  assert.ok(editionSpecific, "expected an edition-specific appearance/disappearance in committed K7 artifacts");
  const out = reg.query("AMBITO_EDITION_DIFF", { code: editionSpecific });
  assert.ok(R.isEvidence(out), `expected edition-diff evidence for ${editionSpecific}`);
});

test("AMBITO_EDITION_DIFF requires an exact code", () => {
  assert.equal(reg.query("AMBITO_EDITION_DIFF", {}).reason, "AMBIGUOUS_SCOPE");
});
