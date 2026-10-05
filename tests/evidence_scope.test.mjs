import assert from "node:assert/strict";
import test from "node:test";

import {
  ANALYTICAL_SCOPES,
  UPDATE_FREQUENCIES,
  SOURCE_STATES,
  FRESHNESS_FIELDS,
  isAnalyticalScope,
  isReferenceDate,
  scopeOf,
  freshnessOf,
  oldestReferenceDate,
  crossScopeArithmeticAllowed,
} from "../js/evidence-scope.js";

// ----------------------------------------------------------- closed vocabularies (A)

test("the analytical scope enum is the closed Gate K set and is frozen", () => {
  assert.deepEqual(ANALYTICAL_SCOPES, [
    "LENS_CIRCLE",
    "OFFICIAL_BARRIO",
    "OFFICIAL_DISTRICT",
    "MUNICIPALITY",
    "POINT_OBSERVATION",
    "BOUNDED_STUDY_AREA",
    "PLANNING_AMBITO",
    "EXECUTION_UNIT",
    "DEVELOPMENT_STAGE_AREA",
    "PARCEL",
    "ADDRESS_POINT",
    "WORK_GEOMETRY",
    "LENS_INTERSECT_AMBITO",
  ]);
  assert.ok(Object.isFrozen(ANALYTICAL_SCOPES), "the scope enum must be frozen");
  assert.throws(() => ANALYTICAL_SCOPES.push("NEW_SCOPE"));
});

test("the update-frequency vocabulary is the closed set and is frozen", () => {
  assert.deepEqual(UPDATE_FREQUENCIES, [
    "DAILY",
    "WEEKLY",
    "MONTHLY",
    "BIMONTHLY",
    "QUARTERLY",
    "SEMESTRAL",
    "ANNUAL",
    "IRREGULAR",
    "DECLARED_UNDEFINED",
    "NONE_DECLARED",
  ]);
  assert.ok(Object.isFrozen(UPDATE_FREQUENCIES));
});

test("the source-state vocabulary is the closed set and is frozen", () => {
  assert.deepEqual(SOURCE_STATES, [
    "DEFINITIVE",
    "PROVISIONAL",
    "WITHHELD_BY_PUBLISHER",
    "NOT_DECLARED_BY_PUBLISHER",
  ]);
  assert.ok(Object.isFrozen(SOURCE_STATES));
});

// ------------------------------------------- DECLARED_UNDEFINED != NONE_DECLARED (G)

test("DECLARED_UNDEFINED and NONE_DECLARED are both present and never interchangeable", () => {
  // Both are real, distinct publisher facts: "Sin definir" vs no statement at all.
  assert.ok(UPDATE_FREQUENCIES.includes("DECLARED_UNDEFINED"));
  assert.ok(UPDATE_FREQUENCIES.includes("NONE_DECLARED"));
  assert.notEqual("DECLARED_UNDEFINED", "NONE_DECLARED");
  // Neither is collapsed into a single "UNKNOWN" sentinel.
  assert.ok(!UPDATE_FREQUENCIES.includes("UNKNOWN"));

  // freshnessOf preserves each verbatim, so a renderer can tell them apart.
  const declared = freshnessOf(baseSource({ update_frequency: "DECLARED_UNDEFINED" }));
  const none = freshnessOf(baseSource({ update_frequency: "NONE_DECLARED" }));
  assert.equal(declared.update_frequency, "DECLARED_UNDEFINED");
  assert.equal(none.update_frequency, "NONE_DECLARED");
  assert.notEqual(declared.update_frequency, none.update_frequency);
});

// -------------------------------------------------------------------- scopeOf (J)

test("scopeOf returns the single declared scope", () => {
  assert.equal(scopeOf({ scope: "LENS_CIRCLE", value: 3 }), "LENS_CIRCLE");
  assert.equal(scopeOf({ scope: "MUNICIPALITY" }), "MUNICIPALITY");
});

test("scopeOf throws on an unscoped value and never defaults or infers", () => {
  // No scope property at all.
  assert.throws(() => scopeOf({ value: 3 }), /unscoped|scope/i);
  // Explicit null / empty / unknown scope is not a scope.
  assert.throws(() => scopeOf({ scope: null }));
  assert.throws(() => scopeOf({ scope: "" }));
  assert.throws(() => scopeOf({ scope: "UNKNOWN" }));
  assert.throws(() => scopeOf({ scope: "lens_circle" }), /not a declared/); // case matters
  // Non-objects.
  assert.throws(() => scopeOf(null));
  assert.throws(() => scopeOf("LENS_CIRCLE"));
  assert.throws(() => scopeOf(undefined));
  // It must NOT infer a scope from coordinates or from a source name.
  assert.throws(() => scopeOf({ lat: 40.42, lon: -3.7 }), /unscoped|scope/i);
  assert.throws(() => scopeOf({ name: "Museo del Prado", lat: 40.41, lon: -3.69 }));
});

// -------------------------------------------------- oldestReferenceDate (L, M)

test("oldestReferenceDate returns the earliest exact date", () => {
  assert.equal(
    oldestReferenceDate([{ reference_date: "2026-03-10" }, { reference_date: "2024-12-31" }, { reference_date: "2025-06-01" }]),
    "2024-12-31"
  );
});

test("oldestReferenceDate mixes ISO month and ISO date without manufacturing a day (M)", () => {
  // A month compared against days; the month is older here and must be returned
  // AS A MONTH, never promoted to 2024-11-01.
  assert.equal(oldestReferenceDate([{ reference_date: "2025-01-15" }, { reference_date: "2024-11" }]), "2024-11");
  // The month is newer than one day but older than another; still returned as a month.
  assert.equal(
    oldestReferenceDate([{ reference_date: "2026-05-20" }, { reference_date: "2026-04" }, { reference_date: "2026-07-01" }]),
    "2026-04"
  );
});

test("oldestReferenceDate prefers month precision on an identical lower bound (M)", () => {
  // Same month, two precisions: the month is reported, not the manufactured day.
  assert.equal(oldestReferenceDate([{ reference_date: "2026-01-01" }, { reference_date: "2026-01" }]), "2026-01");
  assert.equal(oldestReferenceDate([{ reference_date: "2026-01" }, { reference_date: "2026-01-01" }]), "2026-01");
});

test("oldestReferenceDate returns null when ANY contributor has a null reference date (L)", () => {
  assert.equal(oldestReferenceDate([{ reference_date: "2024-01-01" }, { reference_date: null }]), null);
  assert.equal(oldestReferenceDate([{ reference_date: null }, { reference_date: "2026-08" }]), null);
  // All null.
  assert.equal(oldestReferenceDate([{ reference_date: null }, { reference_date: null }]), null);
  // A bare null element counts as a null-period contributor too.
  assert.equal(oldestReferenceDate(["2024-01-01", null]), null);
});

test("oldestReferenceDate handles empty input and accepts bare strings", () => {
  assert.equal(oldestReferenceDate([]), null);
  assert.equal(oldestReferenceDate(["2026-02", "2025-12-01"]), "2025-12-01");
  assert.equal(oldestReferenceDate(["2026-02"]), "2026-02");
});

test("oldestReferenceDate rejects malformed input rather than guessing", () => {
  assert.throws(() => oldestReferenceDate("2026-01"), /array/);
  assert.throws(() => oldestReferenceDate([{ reference_date: "2026" }]), /ISO month/);
  assert.throws(() => oldestReferenceDate([{ reference_date: "2026-13" }]));
  assert.throws(() => oldestReferenceDate([{ value: 3 }]), /no reference_date/);
});

// -------------------------------------------- crossScopeArithmeticAllowed (K)

test("crossScopeArithmeticAllowed allows the same scope and refuses differing scopes without a basis (K)", () => {
  assert.equal(crossScopeArithmeticAllowed("OFFICIAL_BARRIO", "OFFICIAL_BARRIO"), true);
  assert.equal(crossScopeArithmeticAllowed("OFFICIAL_BARRIO", "LENS_CIRCLE"), false);
  assert.equal(crossScopeArithmeticAllowed("MUNICIPALITY", "OFFICIAL_BARRIO"), false);
  assert.equal(crossScopeArithmeticAllowed("PLANNING_AMBITO", "LENS_INTERSECT_AMBITO"), false);
});

test("crossScopeArithmeticAllowed refuses EVERY differing scope pair without a basis (K)", () => {
  for (const a of ANALYTICAL_SCOPES) {
    for (const b of ANALYTICAL_SCOPES) {
      const allowed = crossScopeArithmeticAllowed(a, b);
      assert.equal(allowed, a === b, `${a} vs ${b} without a basis must be ${a === b}`);
    }
  }
});

test("crossScopeArithmeticAllowed permits differing scopes ONLY with an explicit documented basis (K)", () => {
  assert.equal(crossScopeArithmeticAllowed("MUNICIPALITY", "OFFICIAL_BARRIO", "both are official totals, documented in Gate X"), true);
  assert.equal(crossScopeArithmeticAllowed("MUNICIPALITY", "OFFICIAL_BARRIO", { reason: "documented basis" }), true);
  // An empty, whitespace, or non-documented basis is not a basis.
  assert.equal(crossScopeArithmeticAllowed("MUNICIPALITY", "OFFICIAL_BARRIO", ""), false);
  assert.equal(crossScopeArithmeticAllowed("MUNICIPALITY", "OFFICIAL_BARRIO", "   "), false);
  assert.equal(crossScopeArithmeticAllowed("MUNICIPALITY", "OFFICIAL_BARRIO", true), false);
  assert.equal(crossScopeArithmeticAllowed("MUNICIPALITY", "OFFICIAL_BARRIO", {}), false);
  // Geometric overlap is never an implicit basis: a Lens that intersects a barrio
  // still may not be combined with it without an argued basis.
  assert.equal(crossScopeArithmeticAllowed("LENS_CIRCLE", "OFFICIAL_BARRIO"), false);
});

test("crossScopeArithmeticAllowed reads the scope of evidence objects via scopeOf", () => {
  const barrioA = { scope: "OFFICIAL_BARRIO", value: 10 };
  const barrioB = { scope: "OFFICIAL_BARRIO", value: 20 };
  const circle = { scope: "LENS_CIRCLE", value: 5 };
  assert.equal(crossScopeArithmeticAllowed(barrioA, barrioB), true);
  assert.equal(crossScopeArithmeticAllowed(barrioA, circle), false);
  // An unscoped operand throws rather than being treated as a wildcard.
  assert.throws(() => crossScopeArithmeticAllowed(barrioA, { value: 1 }));
});

// ------------------------------------------------------------------ freshnessOf (N)

test("freshnessOf returns a frozen five-field record preserving explicit nulls (N)", () => {
  const record = freshnessOf(
    baseSource({
      reference_date: null,
      published_at: null,
      retrieved_at: "2026-09-30T10:13:04Z",
      update_frequency: "BIMONTHLY",
      source_state: "NOT_DECLARED_BY_PUBLISHER",
    })
  );
  assert.ok(Object.isFrozen(record), "the freshness record must be frozen");
  assert.throws(() => {
    record.reference_date = "2026-01-01";
  });
  // Known absence (explicit null) is preserved, not dropped.
  assert.ok("reference_date" in record);
  assert.equal(record.reference_date, null);
  assert.ok("published_at" in record);
  assert.equal(record.published_at, null);
  assert.deepEqual(Object.keys(record).sort(), [...FRESHNESS_FIELDS].sort());
});

test("freshnessOf carries observed_cadence only when the source declares it", () => {
  const without = freshnessOf(baseSource({}));
  assert.ok(!("observed_cadence" in without));
  const withCadence = freshnessOf(baseSource({ observed_cadence: "ANNUAL" }));
  assert.equal(withCadence.observed_cadence, "ANNUAL");
});

test("freshnessOf throws on a missing mandatory field (missing property != explicit null)", () => {
  const incomplete = baseSource({});
  delete incomplete.retrieved_at;
  assert.throws(() => freshnessOf(incomplete), /missing mandatory freshness field/);
});

// --------------------------------------------------------------------- helpers

test("isAnalyticalScope and isReferenceDate guard their vocabularies", () => {
  assert.ok(isAnalyticalScope("OFFICIAL_DISTRICT"));
  assert.ok(!isAnalyticalScope("DISTRICT"));
  assert.ok(isReferenceDate(null));
  assert.ok(isReferenceDate("2026-07"));
  assert.ok(isReferenceDate("2026-07-01"));
  assert.ok(!isReferenceDate("2026"));
  assert.ok(!isReferenceDate("2026-13"));
  assert.ok(!isReferenceDate("2026-07-01T00:00:00Z"));
});

function baseSource(overrides) {
  return {
    id: "fixture",
    reference_date: "2026-01",
    published_at: null,
    retrieved_at: "2026-09-29T00:00:00Z",
    update_frequency: "NONE_DECLARED",
    source_state: "NOT_DECLARED_BY_PUBLISHER",
    ...overrides,
  };
}
