// Canonical Madrid residential population denominator: contract tests.
//
// These run against the committed artifacts data/population/madrid_population.json
// and its meta, cross-checked against the committed canonical geography. A bad
// regeneration (wrong period, broken join, totals that don't add up, a fabricated
// period) fails here on every push, on both Windows and Ubuntu. No network.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function readJson(relative) {
  return JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), "utf8"));
}

const POP = readJson("../data/population/madrid_population.json");
const META = readJson("../data/population/madrid_population.meta.json");
const GEO = readJson("../data/geography/madrid_admin.geojson");

const records = POP.records;
const municipality = records.filter((r) => r.geography_level === "municipality");
const districts = records.filter((r) => r.geography_level === "district");
const barrios = records.filter((r) => r.geography_level === "barrio");

const canonicalBarrioParent = new Map(
  GEO.features
    .filter((f) => f.properties.geography_level === "barrio")
    .map((f) => [f.properties.official_id, f.properties.parent_id])
);

// ---------------------------------------------------------------- counts

test("the denominator covers exactly the canonical join universe", () => {
  assert.equal(municipality.length, 1);
  assert.equal(districts.length, 21);
  assert.equal(barrios.length, 131);
  assert.deepEqual(POP.counts, { municipality: 1, districts: 21, barrios: 131 });
});

// ---------------------------------------------------------------- period

test("the population period is a source-derived reference date, not the build time", () => {
  assert.match(POP.source_period.reference_date, /^\d{4}-01-01$/, "a 1-January reference date");
  assert.equal(POP.source_period.provisional, false);
  assert.match(META.retrieved_at, /^\d{4}-\d{2}-\d{2}T/, "retrieved_at is a timestamp");
  assert.equal(META.source_period.reference_date, POP.source_period.reference_date, "data and meta agree on the period");
  // Separation is semantic: source period and retrieval time live in distinct
  // fields/contracts. Their calendar dates need not be forced unequal.
});

// ---------------------------------------------------------------- values

test("every resident count is a non-negative integer", () => {
  for (const r of records) {
    assert.ok(Number.isInteger(r.residents), `${r.geography_level} ${r.official_id} residents must be an integer`);
    assert.ok(r.residents >= 0, `${r.geography_level} ${r.official_id} residents must be non-negative`);
  }
  // A residential denominator must not be empty overall.
  assert.ok(municipality[0].residents > 0);
});

test("there are no duplicate geography records for the period", () => {
  const keys = records.map((r) => `${r.geography_level}:${r.official_id}`);
  assert.equal(new Set(keys).size, keys.length);
});

// ---------------------------------------------------------------- canonical join

test("every barrio joins to the canonical geography by official code and agrees on parent", () => {
  const popIds = new Set(barrios.map((b) => b.official_id));
  for (const b of barrios) {
    assert.ok(canonicalBarrioParent.has(b.official_id), `barrio ${b.official_id} must be canonical`);
    assert.equal(canonicalBarrioParent.get(b.official_id), b.parent_id, `barrio ${b.official_id} parent must match geography`);
  }
  for (const id of canonicalBarrioParent.keys()) {
    assert.ok(popIds.has(id), `canonical barrio ${id} must have a population value`);
  }
});

// ---------------------------------------------------------------- aggregation

test("district totals are the exact sums of their barrios and are flagged derived", () => {
  const sums = new Map();
  for (const b of barrios) sums.set(b.parent_id, (sums.get(b.parent_id) ?? 0) + b.residents);
  for (const d of districts) {
    assert.equal(d.residents, sums.get(d.official_id) ?? 0, `district ${d.official_id} total`);
    assert.equal(d.residents_provenance, "DERIVED_FROM_BARRIO_POPULATION");
    assert.equal(d.parent_id, "28079");
  }
});

test("the municipality total is the exact sum of the 131 barrios and is flagged derived", () => {
  const total = barrios.reduce((s, b) => s + b.residents, 0);
  assert.equal(municipality[0].residents, total);
  assert.equal(municipality[0].residents_provenance, "DERIVED_FROM_BARRIO_POPULATION");
  assert.equal(municipality[0].official_id, "28079");
  assert.equal(municipality[0].parent_id, null);
});

test("barrio counts are source-reported, aggregates are derived", () => {
  for (const b of barrios) assert.equal(b.residents_provenance, "SOURCE_REPORTED");
});

// ---------------------------------------------------------------- ordering

test("records are emitted in a deterministic order", () => {
  const order = { municipality: 0, district: 1, barrio: 2 };
  let prev = -1;
  for (const r of records) {
    assert.ok(order[r.geography_level] >= prev, "levels grouped municipality, districts, barrios");
    prev = Math.max(prev, order[r.geography_level]);
  }
  const dIds = districts.map((d) => d.official_id);
  assert.deepEqual(dIds, [...dIds].sort());
  const bIds = barrios.map((b) => b.official_id);
  assert.deepEqual(bIds, [...bIds].sort());
});

// ---------------------------------------------------------------- provenance metadata

test("the metadata links the population period to a distinct geography version", () => {
  assert.equal(META.geography_linkage.barrio_geography_version, "v3.4.1");
  assert.equal(META.geography_linkage.district_geography_version, "v3.2.1");
  // The geography version must not be a date and must not equal the period.
  assert.notEqual(META.geography_linkage.barrio_geography_version, POP.source_period.reference_date);
  assert.match(META.geography_linkage.note, /NOT the population period/i);
});

test("the metadata documents the source, licence and Padron concept", () => {
  assert.match(META.source.authority, /Ayuntamiento de Madrid/);
  assert.match(META.source.underlying_register, /Padron Municipal de habitantes/);
  assert.equal(META.source.license, "CC BY 4.0");
  assert.match(META.population_concept, /registered in the municipal Padron/i);
  assert.match(META.dimensions.note, /no double-counting/i);
  assert.deepEqual(META.dimensions.aggregated_over, [], "no dimension is summed for this single-total source");
});

test("the interpretation ceiling forbids tourism reuse and Lens interpolation", () => {
  const ceiling = META.interpretation_ceiling;
  assert.match(ceiling, /NOT .*tourists/i);
  assert.match(ceiling, /NOT .*daytime population/i);
  assert.match(ceiling, /never be spatially distributed into a circular Lens/i);
  assert.match(ceiling, /no tourism indicator|no .*ratio|no composite/i);
});
