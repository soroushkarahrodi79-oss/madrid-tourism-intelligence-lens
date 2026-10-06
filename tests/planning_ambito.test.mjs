// Planning-ámbito evidence: the contract these tests defend (K6, #68).
//
// THE DECISIVE CONTRACTS:
//
//   1. The four published phase fields are FOUR INDEPENDENT FIELDS. No function
//      here returns an overall stage, a stage number, a progression, a
//      percentage, a completion figure or a timeline, and no shape in the
//      artifact can hold one.
//   2. `No Necesita` is its own published state. It never becomes `Sin Iniciar`,
//      zero, unavailable, "complete", "skipped" or "no aplica".
//   3. `PGOUM-85` / `PGOUM-97` survive verbatim as plan-of-origin markers.
//   4. NO DWELLING COUNT exists or is derivable. The source's `Nº Viviendas`
//      columns are excluded by name.
//   5. Every buildability figure carries its unit, and MISSING IS NEVER ZERO.
//   6. NO APPORTIONMENT. The Lens∩ámbito reading answers WHICH ámbitos a circle
//      touches and exposes no quantity, so there is no numerator through which a
//      whole-ámbito figure could be scaled to a circle. This is tested
//      STRUCTURALLY: a developer would have to add a new function to break it.
//   7. The EXACT official code survives build → artifact → model, `-RP` included.
//
// They run against the committed artifacts, so a bad regeneration (a collapsed
// geometry, a projection leak, a cross-era edition, a lost join) fails here on
// every push, on both Windows and Ubuntu. No network.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createGeographyIndex, geometryIntersectsCircle, pointInGeometry } from "../js/geography.js";
import {
  AMBITO_STATE,
  APPORTIONMENT_POLICY,
  AVAILABILITY,
  BUILDABILITY_PUBLICATION,
  BUILDABILITY_UNIT,
  LENS_INTERSECT_AMBITO_SCOPE,
  PHASE_FIELD_ORDER,
  PHASE_KIND,
  PHASE_VOCABULARY,
  PLANNING_AMBITO_SCOPE,
  USE_CLASS_ORDER,
  VALUE_STATE,
  ambitoContaining,
  ambitosIntersecting,
  availableBuildability,
  createPlanningIndex,
  developmentState,
} from "../js/planning-ambito.js";

function readJson(relative) {
  return JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), "utf8"));
}

const GEOMETRY = readJson("../data/planning/madrid_ambitos.geojson");
const GEOMETRY_META = readJson("../data/planning/madrid_ambitos.meta.json");
const STATE = readJson("../data/planning/madrid_ambito_state.json");
const STATE_META = readJson("../data/planning/madrid_ambito_state.meta.json");
const REGISTRY = readJson("../data/source_registry.json");
const MODULE_SOURCE = fs.readFileSync(new URL("../js/planning-ambito.js", import.meta.url), "utf8");

const index = createPlanningIndex({ geometry: GEOMETRY, state: STATE });

// Fixture coordinates, verified against the committed geometry. Each is chosen
// for the state it exercises, not for being convenient.
const INSIDE = { lon: -3.71371, lat: 40.40255, code: "APR.02.09" }; // has a No Necesita phase
const INSIDE_MARKER = { lon: -3.6841, lat: 40.40589, code: "APE.03.08" }; // has a PGOUM-97 marker
const OUTSIDE = { lon: -3.69, lat: 40.4149 }; // central Madrid: no containing ámbito
const FAR_OUTSIDE = { lon: -3.0, lat: 40.0 };

// ---------------------------------------------------------------- 1. geometry

test("the committed geometry is the filtered ámbito universe, not the mixed source layer", () => {
  assert.equal(GEOMETRY.type, "FeatureCollection");
  const counts = GEOMETRY_META.universe;
  assert.equal(GEOMETRY.features.length, counts.included_feature_count);
  assert.equal(counts.included_class, "PLANNING_AMBITO");
  // Every raw feature is accounted for: included plus every excluded class.
  const excludedTotal = Object.values(counts.excluded_by_class).reduce((sum, record) => sum + record.count, 0);
  assert.equal(counts.included_feature_count + excludedTotal, counts.raw_feature_count);
  assert.equal(counts.excluded_total, excludedTotal);
  // Nothing unclassified was admitted, and nothing was discarded silently: each
  // excluded class carries its count, its codes and its reason.
  assert.equal(counts.excluded_by_class.UNCLASSIFIED_SOURCE_RECORD.count, 0);
  for (const [name, record] of Object.entries(counts.excluded_by_class)) {
    assert.equal(record.codes.length, record.count, `${name} lists every excluded code`);
    assert.ok(record.reason.length > 40, `${name} states why it is excluded`);
  }
  // The raw count is never presented as an ámbito count.
  assert.match(counts.raw_feature_count_is_not_the_ambito_count, /prohibited wording/i);
  assert.ok(counts.raw_feature_count > counts.included_feature_count);
});

test("the geometry carries the exact official code and denomination, and nothing numeric", () => {
  const seen = new Set();
  for (const feature of GEOMETRY.features) {
    const properties = feature.properties;
    // Exactly three properties: identity and class. No area, no surface, no
    // quantity — nothing a reader could mistake for published evidence and
    // nothing a caller could apportion.
    assert.deepEqual(Object.keys(properties).sort(), ["ambito_code", "ambito_denomination", "source_record_class"]);
    assert.equal(typeof properties.ambito_code, "string");
    assert.ok(properties.ambito_code.length > 0);
    assert.equal(properties.source_record_class, "PLANNING_AMBITO");
    assert.equal(seen.has(properties.ambito_code), false, `duplicate code ${properties.ambito_code}`);
    seen.add(properties.ambito_code);
    assert.ok(["Polygon", "MultiPolygon"].includes(feature.geometry.type));
  }
});

test("the geometry is reprojected to EPSG:4326 and sits inside Madrid", () => {
  assert.equal(GEOMETRY_META.crs.source, "EPSG:25830");
  assert.equal(GEOMETRY_META.crs.target, "EPSG:4326");
  assert.match(GEOMETRY_META.crs.transformation, /25830 -> EPSG:4326/);
  // The transformation is not merely declared: the builder checked it against
  // the publisher's own server-side reprojection and recorded the deviation.
  assert.equal(GEOMETRY_META.crs.verification.within_tolerance, true);
  assert.ok(GEOMETRY_META.crs.verification.max_deviation_deg <= GEOMETRY_META.crs.verification.tolerance_deg);
  assert.ok(GEOMETRY_META.crs.verification.vertices_compared > 10000);
  assert.deepEqual(GEOMETRY_META.crs.verification.codes_not_compared, []);
  // No simplification: topological containment is unchanged.
  assert.equal(GEOMETRY_META.crs.simplification, "NONE");
  assert.equal(GEOMETRY_META.geometry_metrics.vertices_removed, 0);
  // A projection leak would put coordinates in the hundreds of thousands.
  const bounds = GEOMETRY_META.geometry_metrics.bounds_4326;
  assert.ok(bounds.min_lon > -4.1 && bounds.max_lon < -3.4, "longitudes are WGS84 degrees over Madrid");
  assert.ok(bounds.min_lat > 40.2 && bounds.max_lat < 40.7, "latitudes are WGS84 degrees over Madrid");
});

test("the geometry's reuse basis is the catalogued route, not public reachability", () => {
  const reuse = GEOMETRY_META.reuse;
  assert.equal(reuse.basis, "AYUNTAMIENTO_DE_MADRID_GENERAL_REUSE_CONDITIONS");
  assert.match(reuse.conditions_url, /^https:\/\/datos\.madrid\.es\//);
  assert.match(reuse.conditions_linked_from, /catalogue record/i);
  assert.ok(reuse.attribution.length > 10, "the attribution obligation is recorded");
  assert.ok(reuse.obligations_observed.length >= 5, "each reuse obligation is recorded as observed");
  // Gate L's MODIFY finding on the raw endpoint is kept, not quietly dropped.
  assert.match(reuse.gate_l_verdict_on_raw_endpoint, /MODIFY/);
  // The dead AccessConstraints link is recorded as an observation, not corrected.
  assert.match(reuse.wfs_access_constraints_observed, /404/);
  // Route equivalence: the catalogued route serves the same geometry Gate L
  // audited, which is what makes preferring it a substitution-free choice.
  const route = GEOMETRY_META.route_equivalence;
  assert.equal(route.equivalent, true);
  assert.equal(route.verdict, "AUTHORITATIVE_EQUIVALENCE_ESTABLISHED");
  assert.equal(route.catalogued_feature_count, route.audited_feature_count);
  assert.equal(route.catalogued_vertices, route.audited_vertices);
  assert.deepEqual(route.codes_only_in_catalogued, []);
  assert.deepEqual(route.codes_only_in_audited, []);
  assert.deepEqual(route.denomination_differences, []);
  assert.deepEqual(route.geometry_differences, []);
  // -RP identity agrees across both routes, including the Valdecarros pair.
  assert.equal(route.rp_identity.rp_code_sets_identical, true);
  assert.equal(route.rp_identity.valdecarros_evidence["UZP.3.01_present"], false);
  assert.equal(route.rp_identity.valdecarros_evidence["UZPp.03.01-RP_present"], true);
});

test("the geometry declares no reference date, and the null is never back-filled", () => {
  assert.equal(GEOMETRY_META.freshness.reference_date, null);
  assert.equal(GEOMETRY_META.freshness.published_at, null);
  assert.equal(GEOMETRY_META.freshness.source_state, "NOT_DECLARED_BY_PUBLISHER");
  assert.equal(GEOMETRY_META.freshness.update_frequency, "NONE_DECLARED");
  // The observed resource state exists, and says what it is NOT.
  assert.match(GEOMETRY_META.freshness.observed_resource_state.note, /never be presented as a reference date/i);
  const source = REGISTRY.sources.find((s) => s.id === "planning_ambito_geometry");
  assert.equal(source.reference_date, null);
  assert.equal(source.published_at, null);
});

// ---------------------------------------------- 2. exact identifiers (-RP)

test("the exact official code survives build → artifact → model, -RP included", () => {
  const rpCodes = GEOMETRY.features.map((f) => f.properties.ambito_code).filter((code) => code.endsWith("-RP"));
  assert.ok(rpCodes.length >= 20, "the Revisión Parcial codes are present");
  // UZP.3.01 was annulled by court sentence; UZPp.03.01-RP is its active
  // replacement. Normalising the suffix would merge the two.
  assert.ok(rpCodes.includes("UZPp.03.01-RP"));
  assert.equal(GEOMETRY.features.some((f) => f.properties.ambito_code === "UZP.3.01"), false);

  for (const code of rpCodes) {
    // Present in the artifact under its exact code, and reachable from the model
    // under that exact code and no other.
    assert.ok(Object.prototype.hasOwnProperty.call(STATE.ambitos, code), `${code} in the state artifact`);
    assert.equal(index.developmentState(code).ambitoCode, code);
    assert.equal(index.featureFor(code).properties.ambito_code, code);
  }
  // A normalised spelling resolves to NOTHING rather than to the distinct ámbito.
  for (const wrong of ["UZPp.03.01", "UZP.03.01-RP", "uzpp.03.01-rp", "UZPp.03.01-RP "]) {
    assert.equal(index.developmentState(wrong).availability, AVAILABILITY.NOT_PUBLISHED_IN_EDITION, wrong);
    assert.equal(index.featureFor(wrong), null, wrong);
  }
  // No normalisation anywhere in the module or the artifacts' identifier contract.
  assert.equal(GEOMETRY_META.identifier.matching, "EXACT");
  assert.equal(GEOMETRY_META.identifier.normalisation, "NONE");
  assert.equal(STATE_META.identifier.matching, "EXACT");
  assert.equal(STATE_META.identifier.normalisation, "NONE");
  assert.match(MODULE_SOURCE, /no normalisation anywhere in[\s/]*this[\s/]*module/);
});

// ------------------------------------------------------------- 3. containment

test("a point inside a production ámbito resolves to that ámbito", () => {
  const result = index.ambitoContaining(INSIDE.lon, INSIDE.lat);
  assert.equal(result.state, AMBITO_STATE.RESOLVED);
  assert.equal(result.ambitoCode, INSIDE.code);
  assert.equal(result.scope, PLANNING_AMBITO_SCOPE);
  assert.ok(result.denomination.length > 0);
  // The free function agrees with the index: the index is a performance wrapper,
  // not a second model.
  assert.deepEqual(ambitoContaining({ lon: INSIDE.lon, lat: INSIDE.lat }, GEOMETRY), result);
  // The hint is a performance hint only: the answer is identical with a correct
  // hint, a wrong hint, or none.
  assert.equal(index.ambitoContaining(INSIDE.lon, INSIDE.lat, INSIDE.code).ambitoCode, INSIDE.code);
  assert.equal(index.ambitoContaining(INSIDE.lon, INSIDE.lat, "APE.01.01").ambitoCode, INSIDE.code);
  assert.equal(index.ambitoContaining(INSIDE.lon, INSIDE.lat, "nonsense").ambitoCode, INSIDE.code);
});

test("a point outside every production ámbito returns an EXPLICIT outside state", () => {
  for (const point of [OUTSIDE, FAR_OUTSIDE]) {
    const result = index.ambitoContaining(point.lon, point.lat);
    // Not zero, not null rendered as blank, not the nearest ámbito.
    assert.equal(result.state, AMBITO_STATE.OUTSIDE_ALL_AMBITOS);
    assert.equal(result.ambitoCode, null);
    assert.equal(result.denomination, null);
    assert.ok(result.note.length > 40, "the absence is stated in words");
    assert.match(result.note, /does not cover the whole municipality/);
  }
});

test("an unusable geometry yields UNAVAILABLE, never a false outside", () => {
  for (const bad of [null, { type: "FeatureCollection", features: [] }, {}]) {
    assert.equal(ambitoContaining({ lon: INSIDE.lon, lat: INSIDE.lat }, bad).state, AMBITO_STATE.UNAVAILABLE);
  }
  // A non-finite coordinate is unavailable, not outside: the question was never
  // answerable.
  assert.equal(ambitoContaining({ lon: Number.NaN, lat: 40 }, GEOMETRY).state, AMBITO_STATE.UNAVAILABLE);
  // An unusable geometry artifact yields NO index at all, so an absent layer
  // stays absent rather than becoming an index reporting every point outside.
  assert.equal(createPlanningIndex({ geometry: null, state: STATE }), null);
  assert.equal(createPlanningIndex({ geometry: { type: "FeatureCollection", features: [] } }), null);
});

test("containment reuses js/geography.js and implements no second point-in-polygon", () => {
  assert.match(MODULE_SOURCE, /import \{ geometryIntersectsCircle, pointInGeometry \} from "\.\/geography\.js";/);
  // No ray-casting, no winding number and no distance maths of its own.
  assert.doesNotMatch(MODULE_SOURCE, /inside = !inside/);
  assert.doesNotMatch(MODULE_SOURCE, /Math\.(?:acos|hypot|atan2)/);
  assert.doesNotMatch(MODULE_SOURCE, /6371008|6378137/);
  // And the shared predicate really is the one answering: every resolved point
  // is inside the feature the model named, by geography.js's own function.
  const feature = index.featureFor(INSIDE.code);
  assert.equal(pointInGeometry(INSIDE.lon, INSIDE.lat, feature.geometry), true);
});

// ----------------------------------------- 4. four independent phase fields

test("developmentState returns exactly four independent fields and no summary", () => {
  const state = index.developmentState(INSIDE.code);
  assert.equal(state.scope, PLANNING_AMBITO_SCOPE);
  assert.equal(state.availability, AVAILABILITY.PUBLISHED);
  assert.equal(state.phases.length, 4);
  assert.deepEqual(state.phases.map((phase) => phase.key), [...PHASE_FIELD_ORDER]);
  // There is no fifth field summarising the four, under any name.
  const forbidden = /stage|progress|percent|completion|advance|delay|timeline|overall|current|furthest|score|rank|order|index/i;
  for (const key of Object.keys(state)) assert.doesNotMatch(key, forbidden, `developmentState exposes "${key}"`);
  for (const phase of state.phases) {
    for (const key of Object.keys(phase)) assert.doesNotMatch(key, forbidden, `phase exposes "${key}"`);
    // No numeric rank travels with a phase: its only numbers would be a rank.
    for (const value of Object.values(phase)) assert.notEqual(typeof value, "number");
  }
  // The field order is the publisher's column order and is documented as such.
  assert.match(MODULE_SOURCE, /PHASE_FIELD_ORDER is a column order, not a[\s/]*rank/);
  assert.match(STATE.phase_fields_note, /FOUR INDEPENDENT PUBLISHED FIELDS/);
  assert.match(STATE_META.phase_vocabulary.no_scalar_stage, /MULTI_DIMENSIONAL_NO_SCALAR_STAGE/);
});

test("No Necesita is its own state and never collapses into another", () => {
  const state = index.developmentState(INSIDE.code);
  const unresolved = state.phases.filter((phase) => phase.sourceValue === "No Necesita");
  assert.ok(unresolved.length >= 1, "the fixture ámbito publishes a No Necesita phase");
  for (const phase of unresolved) {
    assert.equal(phase.state, VALUE_STATE.PUBLISHED);
    assert.equal(phase.kind, PHASE_KIND.UNRESOLVED_MEANING);
    // Distinct from Sin Iniciar, from zero and from unavailable.
    assert.notEqual(phase.sourceValue, "Sin Iniciar");
    assert.notEqual(phase.sourceValue, 0);
    assert.notEqual(phase.sourceValue, null);
    assert.notEqual(phase.state, VALUE_STATE.NOT_PUBLISHED);
  }
  // Across the whole artifact: every No Necesita cell is PUBLISHED, carries the
  // verbatim label, and is never kinded as an ordinary phase value.
  let total = 0;
  for (const record of Object.values(STATE.ambitos)) {
    if (record.development_state.availability !== AVAILABILITY.PUBLISHED) continue;
    for (const phase of Object.values(record.development_state.phases)) {
      if (phase.source_value !== "No Necesita") continue;
      total += 1;
      assert.equal(phase.state, VALUE_STATE.PUBLISHED);
      assert.equal(phase.kind, PHASE_KIND.UNRESOLVED_MEANING);
    }
  }
  assert.ok(total > 100, `No Necesita is published widely (${total} cells)`);
  // Sin Iniciar keeps its own kind, so the two can never be one internal state.
  const sinIniciar = Object.values(STATE.ambitos)
    .filter((record) => record.development_state.availability === AVAILABILITY.PUBLISHED)
    .flatMap((record) => Object.values(record.development_state.phases))
    .filter((phase) => phase.source_value === "Sin Iniciar");
  assert.ok(sinIniciar.length > 100);
  for (const phase of sinIniciar) assert.equal(phase.kind, PHASE_KIND.PHASE_VALUE);
  // The meaning stays unresolved, and the product never asserts one.
  assert.equal(STATE_META.phase_vocabulary.no_necesita.status, "SOURCE_OBSERVED_INTERPRETATION_UNRESOLVED");
  assert.match(STATE_META.phase_vocabulary.no_necesita.handling, /never rendered as, mapped to or equated with 'no aplica'/);
});

test("PGOUM-85 and PGOUM-97 survive verbatim as plan-of-origin markers", () => {
  const state = index.developmentState(INSIDE_MARKER.code);
  const markers = state.phases.filter((phase) => phase.kind === PHASE_KIND.PLAN_ORIGIN_MARKER);
  assert.ok(markers.length >= 1, "the fixture ámbito publishes a PGOUM marker");
  for (const marker of markers) assert.match(marker.sourceValue, /^PGOUM-(?:85|97)$/);
  // Verbatim across the artifact: the punctuation the publisher used is kept,
  // and a marker is never re-labelled as a phase value or as an error.
  const observed = Object.keys(STATE_META.phase_vocabulary.observed_values);
  assert.ok(observed.includes("PGOUM-85") && observed.includes("PGOUM-97"));
  for (const value of ["PGOUM-85", "PGOUM-97"]) {
    assert.equal(STATE_META.phase_vocabulary.observed_values[value].kind, PHASE_KIND.PLAN_ORIGIN_MARKER);
  }
  assert.match(STATE_META.phase_vocabulary.plan_origin_markers.handling, /not progress states/);
});

test("source-documented and source-observed vocabulary stay distinguishable", () => {
  const observed = STATE_META.phase_vocabulary.observed_values;
  // En Ejecución is in the data but not in the publisher's structure document,
  // and is labelled as such rather than quietly promoted.
  assert.equal(observed["En Ejecución"].vocabulary, PHASE_VOCABULARY.SOURCE_OBSERVED_NOT_DOCUMENTED);
  assert.equal(observed["Finalizado"].vocabulary, PHASE_VOCABULARY.SOURCE_DOCUMENTED);
  assert.match(STATE_META.phase_vocabulary.undocumented_observed, /En Ejecución is observed/);
  // Every observed value is one of the three vocabulary states and one of the
  // three kinds: no value falls through to an undeclared classification.
  for (const [value, record] of Object.entries(observed)) {
    assert.ok(Object.values(PHASE_VOCABULARY).includes(record.vocabulary), value);
    assert.ok(Object.values(PHASE_KIND).includes(record.kind), value);
    assert.ok(record.count > 0, value);
  }
});

test("an ámbito with geometry but no published row is an explicit absence, not a zero", () => {
  const absent = Object.values(STATE.ambitos).filter(
    (record) => record.development_state.availability === AVAILABILITY.NOT_PUBLISHED_IN_EDITION
  );
  assert.ok(absent.length > 0, "the production universe includes not-monitored ámbitos");
  for (const record of absent) {
    assert.equal(record.development_state.availability, AVAILABILITY.NOT_PUBLISHED_IN_EDITION);
    assert.match(record.development_state.note, /not a zero/);
    // No phases object at all, so nothing can read a state off it.
    assert.equal(record.development_state.phases, undefined);
  }
  const model = index.developmentState(absent[0].ambito_code);
  assert.equal(model.availability, AVAILABILITY.NOT_PUBLISHED_IN_EDITION);
  assert.deepEqual(model.phases, []);
  // The edition is still named, so the reader knows WHICH edition is silent.
  assert.ok(model.edition.referenceDate);
});

// --------------------------------------------------- 5. available buildability

test("every buildability figure carries its unit, and missing is never zero", () => {
  const buildability = index.availableBuildability(INSIDE.code);
  assert.equal(buildability.scope, PLANNING_AMBITO_SCOPE);
  assert.equal(buildability.availability, AVAILABILITY.PUBLISHED);
  assert.equal(buildability.unit, BUILDABILITY_UNIT);
  for (const row of buildability.rows) {
    assert.deepEqual(row.useClasses.map((useClass) => useClass.key), [...USE_CLASS_ORDER]);
    for (const useClass of row.useClasses) {
      // The unit travels in the same object as the value: there is no shape here
      // that can hold a number without one.
      assert.equal(useClass.unit, BUILDABILITY_UNIT);
      if (useClass.state === VALUE_STATE.PUBLISHED) assert.equal(typeof useClass.value, "number");
      else assert.equal(useClass.value, null, "an unpublished cell keeps null, never 0");
    }
  }

  // Across the artifact: a published 0 and a blank cell are different facts.
  let publishedZero = 0;
  let notPublished = 0;
  for (const record of Object.values(STATE.ambitos)) {
    const published = record.available_buildability;
    if (published.availability !== AVAILABILITY.PUBLISHED) continue;
    for (const row of published.rows) {
      for (const cell of Object.values(row.use_classes)) {
        assert.equal(cell.unit, BUILDABILITY_UNIT);
        if (cell.state === VALUE_STATE.PUBLISHED && cell.value === 0) publishedZero += 1;
        if (cell.state === VALUE_STATE.NOT_PUBLISHED) {
          notPublished += 1;
          assert.equal(cell.value, null);
        }
      }
    }
  }
  assert.ok(publishedZero > 0, "the editions publish real zeros");
  assert.ok(notPublished > 0, "the editions also leave cells blank");
  assert.match(STATE_META.buildability.missing_is_not_zero, /Neither is ever substituted for the other/);
});

test("available buildability is the publisher's available-under-the-plan quantity, not construction remaining", () => {
  assert.equal(STATE_META.buildability.product_term_en, "available buildability");
  assert.equal(STATE_META.buildability.product_term_es, "edificabilidad disponible");
  assert.equal(STATE_META.buildability.unit, BUILDABILITY_UNIT);
  assert.equal(STATE_META.buildability.unit_is_mandatory, true);
  for (const phrase of [
    /NOT 'remaining to be built'/,
    /NOT 'yet to be constructed'/,
    /NOT construction\s+remaining/,
    /NOT development remaining/,
    /NOT an\s+estimate of what will be built/,
  ]) {
    assert.match(STATE_META.buildability.not, phrase, String(phrase));
  }
});

test("several published rows for one code are kept separate and never combined", () => {
  const multiple = Object.values(STATE.ambitos).filter(
    (record) =>
      record.available_buildability.availability === AVAILABILITY.PUBLISHED &&
      record.available_buildability.publication === BUILDABILITY_PUBLICATION.MULTIPLE_PUBLISHED_ROWS_NOT_COMBINED
  );
  assert.ok(multiple.length > 0, "the selected edition publishes multi-row codes");
  for (const record of multiple) {
    const published = record.available_buildability;
    assert.equal(published.rows.length, published.row_count);
    assert.ok(published.row_count > 1);
    // A cause is always stated, and CAUSE_UNRESOLVED is a valid verdict: the
    // builder never guesses which of two conflicting rows the publisher meant.
    assert.ok(["DISTINCT_PUBLISHED_SITUACION", "CAUSE_UNRESOLVED"].includes(published.cause), published.cause);
    assert.ok(published.detail.length > 60);
    // No total, sum, mean or reconciled figure exists for the code.
    const forbidden = /total|sum|mean|average|combined|merged|reconcil/i;
    for (const key of Object.keys(published)) assert.doesNotMatch(key, forbidden, key);
  }
  const model = index.availableBuildability(multiple[0].ambito_code);
  assert.equal(model.publication, BUILDABILITY_PUBLICATION.MULTIPLE_PUBLISHED_ROWS_NOT_COMBINED);
  assert.ok(model.rows.length > 1);
  for (const key of Object.keys(model)) assert.doesNotMatch(key, /total|sum|mean|average/i, key);
  assert.match(STATE_META.buildability.multiple_published_rows.rule, /NEVER summed/);
});

// ----------------------------------------------------- 6. the dwelling ceiling

test("no dwelling count is published or derivable", () => {
  // The excluded columns were READ and COUNTED — so the exclusion is an observed
  // fact — and then dropped by name.
  const exclusion = STATE_META.buildability.dwelling_proxy_exclusion;
  assert.deepEqual(exclusion.columns, ["Colectiva. Nº Viviendas", "Unifamiliar. Nº Viviendas"]);
  assert.ok(exclusion.cells_read > 0, "the proxy columns were read");
  assert.ok(exclusion.published_fractional_values > 0, "their fractional values were observed");
  assert.equal(exclusion.published_in_artifact, false);
  assert.match(exclusion.reason, /not a count of\s+dwelling units/);

  // Neither column, nor any dwelling-count key or label, appears in the
  // published artifact or the production model.
  const artifactText = JSON.stringify(STATE);
  for (const column of exclusion.columns) assert.equal(artifactText.includes(column), false, column);
  for (const token of ["Viviendas", "viviendas", "dwelling", "Nº Viv"]) {
    assert.equal(artifactText.includes(token), false, token);
  }
  // `unit` is REQUIRED on every figure, so it is deliberately not in this set.
  const forbiddenKey = /viviend|dwelling|\bhomes?\b|housing/i;
  const offending = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKey.test(key)) offending.add(key);
      walk(child);
    }
  };
  walk(STATE);
  assert.deepEqual([...offending], []);
  // And the model exposes no such accessor.
  for (const object of [index.developmentState(INSIDE.code), index.availableBuildability(INSIDE.code)]) {
    for (const key of Object.keys(object)) assert.doesNotMatch(key, forbiddenKey, key);
  }
  // The module source itself contains no m²-per-dwelling divisor.
  assert.doesNotMatch(MODULE_SOURCE, /\/\s*100\b/);
});

// ----------------------------------------------- 7. the no-apportionment rule

test("the Lens∩ámbito reading answers membership and exposes no quantity", () => {
  const membership = index.ambitosIntersecting(INSIDE.lon, INSIDE.lat, 900);
  assert.equal(membership.scope, LENS_INTERSECT_AMBITO_SCOPE);
  assert.notEqual(membership.scope, PLANNING_AMBITO_SCOPE, "membership is not whole-ámbito evidence");
  assert.ok(membership.count >= 1);
  assert.equal(membership.count, membership.touched.length);
  assert.equal(membership.quantitiesProvided, false);
  assert.equal(membership.apportionment.policy, "NONE");

  // Every touched entry carries identity and a boolean, and nothing else. No
  // area, no fraction, no weight, no quantity — so there is no numerator and no
  // denominator with which to scale a whole-ámbito figure to the circle.
  for (const entry of membership.touched) {
    assert.deepEqual(Object.keys(entry).sort(), ["ambitoCode", "containsCentre", "denomination"]);
    assert.equal(typeof entry.containsCentre, "boolean");
    for (const value of Object.values(entry)) assert.notEqual(typeof value, "number");
  }
  // The only numbers in the whole result are the circle's own geometry and the
  // count of touched areas — all properties of the circle, never of an ámbito.
  const numericPaths = [];
  const walk = (value, path) => {
    if (typeof value === "number") return numericPaths.push(path);
    if (Array.isArray(value)) return value.forEach((item, i) => walk(item, `${path}[${i}]`));
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
  };
  walk(membership, "");
  assert.deepEqual(numericPaths.sort(), [".centre.lat", ".centre.lon", ".count", ".radiusM"]);
  // The reading's own ceiling says what it is not.
  assert.match(membership.ceiling, /not a share, proportion or part/i);
  // A circle touching nothing says so, and still carries no quantity.
  const empty = index.ambitosIntersecting(FAR_OUTSIDE.lon, FAR_OUTSIDE.lat, 900);
  assert.equal(empty.count, 0);
  assert.deepEqual(empty.touched, []);
  assert.equal(empty.quantitiesProvided, false);
});

test("STRUCTURAL: no exported function can apportion an ámbito quantity to a circle", () => {
  // 1. The quantity readers accept NO geometry parameter. Their signatures are
  //    (code, artifact), so a radius or a centre has nowhere to enter.
  assert.equal(developmentState.length, 2);
  assert.equal(availableBuildability.length, 2);
  // 2. And they refuse anything circle-shaped handed to them anyway, rather than
  //    quietly reading a quantity through it.
  for (const reader of [developmentState, availableBuildability]) {
    for (const shape of [
      { radiusM: 900, ambitos: STATE.ambitos },
      { lat: 40.4, lon: -3.7, ambitos: STATE.ambitos },
      { centre: { lon: -3.7, lat: 40.4 }, ambitos: STATE.ambitos },
    ]) {
      assert.throws(() => reader(INSIDE.code, shape), /no apportionment in this model/);
    }
  }
  // 3. Extra arguments are ignored, so a third positional radius cannot sneak in.
  const plain = availableBuildability(INSIDE.code, STATE);
  assert.deepEqual(availableBuildability(INSIDE.code, STATE, 900, { lon: 0, lat: 0 }), plain);
  // 4. No exported name suggests, or could host, an apportionment.
  const exported = [...MODULE_SOURCE.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
  assert.ok(exported.length >= 5, "the exports were located");
  for (const name of exported) {
    assert.doesNotMatch(
      name,
      /apportion|allocat|distribut|weight|share|propor|fraction|density|perArea|intersectArea|overlap|total|sum/i,
      `exported function "${name}"`
    );
  }
  // 5. The module computes no overlap area and no fraction at all: there is no
  //    arithmetic in it that could produce one.
  // Identifier-shaped names only: the module's prose does discuss sub-areas.
  assert.doesNotMatch(MODULE_SOURCE, /intersection_?area|overlap_?area|area_?of|area_?weight|area_?share|area_?fraction/i);
  // 6. The two scopes are never carried by one value.
  const membership = index.ambitosIntersecting(INSIDE.lon, INSIDE.lat, 900);
  const quantity = index.availableBuildability(INSIDE.code);
  assert.equal(membership.scope, LENS_INTERSECT_AMBITO_SCOPE);
  assert.equal(quantity.scope, PLANNING_AMBITO_SCOPE);
  assert.notEqual(membership.scope, quantity.scope);
  // 7. The policy is stated on every object the module returns.
  for (const object of [membership, quantity, index.developmentState(INSIDE.code), index.ambitoContaining(INSIDE.lon, INSIDE.lat)]) {
    assert.equal(object.apportionment, APPORTIONMENT_POLICY);
  }
  assert.match(APPORTIONMENT_POLICY.statement, /No figure is apportioned, area-weighted, population-weighted/);
});

test("the shared circle predicate answers membership only", () => {
  const feature = index.featureFor(INSIDE.code);
  assert.equal(geometryIntersectsCircle(INSIDE.lon, INSIDE.lat, 100, feature.geometry), true);
  assert.equal(geometryIntersectsCircle(FAR_OUTSIDE.lon, FAR_OUTSIDE.lat, 100, feature.geometry), false);
  // A boolean, never a measure. A caller cannot obtain an overlap from it.
  assert.equal(typeof geometryIntersectsCircle(INSIDE.lon, INSIDE.lat, 900, feature.geometry), "boolean");
  // Degenerate inputs are false, not a thrown error and not a true.
  for (const radius of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(geometryIntersectsCircle(INSIDE.lon, INSIDE.lat, radius, feature.geometry), false, String(radius));
  }
  // A circle that wholly contains a small ámbito still touches it, even though
  // its centre may lie outside: both the centre test and the boundary distance
  // are part of the predicate.
  const touched = index.ambitosIntersecting(INSIDE.lon, INSIDE.lat, 2000).touched;
  assert.ok(touched.some((entry) => entry.containsCentre === false), "a touched-but-not-containing ámbito exists");
});

// ------------------------------------------------------------ 8. editions

test("the selected editions are the current comparable era, dated by themselves", () => {
  for (const [family, era] of [
    ["development_state", "S1_FOUR_PHASE_FLAT"],
    ["available_buildability", "S2_SPLIT_RESIDENTIAL_FLAT"],
  ]) {
    const edition = STATE.editions[family];
    assert.equal(edition.schema_era, era, family);
    assert.match(edition.reference_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(edition.reference_date_method, "IN_FILE_EXCEL_SERIAL");
    assert.match(edition.reference_date_source_column, /fecha/i);
    assert.equal(edition.source_state, "DEFINITIVE");
    assert.equal(edition.license, "CC BY 4.0");
    assert.match(edition.snapshot_identity, /^S[12]:\d{4}-\d{2}:[0-9a-f]{12}$/);
    // published_at is the FILE's own OLE2 timestamp, not an HTTP header and not
    // a catalogue date.
    assert.match(edition.published_at_method, /OLE2/);
    assert.notEqual(edition.published_at, edition.retrieved_at);
  }
  // The era boundary is documented, and the superseded eras were rejected rather
  // than parsed as equivalent evidence.
  assert.match(STATE_META.edition_selection.schema_era_boundary, /NOT one comparable series/);
  assert.ok(STATE_META.edition_selection.editions_rejected_as_other_era.S1_count > 0);
  assert.ok(STATE_META.edition_selection.editions_rejected_as_other_era.S2_count > 0);
  // Selection reads the stated date and nothing else.
  assert.match(STATE_META.edition_selection.rule, /newest STATED REFERENCE DATE/);
  assert.deepEqual(STATE_META.edition_selection.never_by, [
    "resource id",
    "resource name",
    "filename",
    "catalogue position",
  ]);
});

test("REGRESSION: selecting by resource id would pick the WRONG edition", () => {
  // Gate L §6 proved the resource-id order is not chronological. The builder
  // records what the discredited heuristic WOULD have chosen so this can never
  // silently regress to the original Gate K assumption.
  for (const family of ["S1", "S2"]) {
    const heuristic = STATE_META.edition_selection.resource_id_heuristic_would_select[family];
    assert.equal(
      heuristic.is_the_selected_edition,
      false,
      `${family}: the resource-id heuristic must disagree with the reference-date rule`
    );
    const selected = STATE.editions[family === "S1" ? "development_state" : "available_buildability"];
    assert.notEqual(heuristic.resource_id, selected.resource_id);
    // And it would pick an EARLIER edition, which is the actual harm.
    assert.ok(heuristic.reference_date < selected.reference_date, `${family}: ${heuristic.reference_date}`);
  }
});

test("no aggregate Total row entered the artifact", () => {
  for (const code of Object.keys(STATE.ambitos)) {
    assert.doesNotMatch(code, /^total/i, code);
  }
  for (const record of Object.values(STATE.ambitos)) {
    const published = record.available_buildability;
    if (published.availability !== AVAILABILITY.PUBLISHED) continue;
    for (const row of published.rows) {
      assert.doesNotMatch(String(row.denomination ?? ""), /^total/i);
      assert.doesNotMatch(String(row.situacion ?? ""), /^total/i);
    }
  }
  assert.match(STATE_META.aggregate_total_rows.rule, /never enters the artifact/);
  // The guard is kept even though the current editions carry no such row.
  assert.match(STATE_META.aggregate_total_rows.observation, /NO aggregate Total row/);
});

// ------------------------------------------------------------- 9. joins

test("the exact joins are reported in full, and nothing disappears silently", () => {
  for (const family of ["S1", "S2"]) {
    const join = STATE_META.joins[family];
    assert.equal(join.matching, "EXACT");
    assert.equal(join.normalisation, "NONE");
    assert.ok(join.matched > 0);
    assert.ok(join.match_rate_of_table > 0.99, `${family} rate ${join.match_rate_of_table}`);
    // Both residual sides are reported, not dropped.
    assert.equal(Array.isArray(join.unmatched_in_table), true);
    assert.equal(join.unmatched_in_table.length, join.unmatched_in_table_count);
    assert.equal(join.matched + join.unmatched_in_table_count, join.table_codes);
    assert.ok(join.note.includes("never dropped"));
  }
  // The Gate L baseline is reproduced: S1 666/667, S2 230/230.
  assert.equal(STATE_META.joins.S1.matched, 666);
  assert.equal(STATE_META.joins.S1.table_codes, 667);
  assert.equal(STATE_META.joins.S2.matched, 230);
  assert.equal(STATE_META.joins.S2.table_codes, 230);
  // A table-only code is one the geometry does not carry. It is named, and it is
  // NOT in the production universe — so it cannot be rendered as a place.
  for (const code of STATE_META.joins.S1.unmatched_in_table) {
    assert.equal(Object.prototype.hasOwnProperty.call(STATE.ambitos, code), false, code);
    assert.equal(index.featureFor(code), null, code);
  }
});

test("the state artifact is keyed on exactly the committed geometry universe", () => {
  const geometryCodes = GEOMETRY.features.map((feature) => feature.properties.ambito_code).sort();
  assert.deepEqual(Object.keys(STATE.ambitos).sort(), geometryCodes);
  assert.equal(index.counts.ambitos, geometryCodes.length);
  assert.equal(index.counts.withPublishedState, STATE_META.production_universe.development_state_published);
  assert.equal(index.counts.withPublishedBuildability, STATE_META.production_universe.buildability_published);
  // The two artifacts agree on each ámbito's identity.
  for (const feature of GEOMETRY.features) {
    const record = STATE.ambitos[feature.properties.ambito_code];
    assert.equal(record.geometry_denomination, feature.properties.ambito_denomination);
  }
});

// --------------------------------------------------------- 10. purity & scope

test("the model is pure: frozen returns, no DOM, no fetch, no clock, no globals", () => {
  for (const object of [
    index.ambitoContaining(INSIDE.lon, INSIDE.lat),
    index.ambitoContaining(OUTSIDE.lon, OUTSIDE.lat),
    index.ambitosIntersecting(INSIDE.lon, INSIDE.lat, 900),
    index.developmentState(INSIDE.code),
    index.availableBuildability(INSIDE.code),
    index.editions,
  ]) {
    assert.ok(Object.isFrozen(object), "the returned object is frozen");
    // Deeply frozen: a renderer cannot mutate a reading in place.
    for (const value of Object.values(object)) {
      if (value !== null && typeof value === "object") assert.ok(Object.isFrozen(value));
    }
  }
  // Pure by construction: no DOM, no Leaflet, no fetch outside the one documented
  // browser convenience, no clock, no module-level mutable state.
  // The purity scan reads CODE, not prose: a comment naming the publisher's
  // structure document is not a DOM access.
  const core = MODULE_SOURCE.slice(0, MODULE_SOURCE.indexOf("export async function loadPlanningIndex"))
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
  for (const pattern of [/document\./, /window\./, /\bL\./, /localStorage/, /Date\.now|new Date/, /fetch\(/]) {
    assert.doesNotMatch(core, pattern, String(pattern));
  }
  assert.doesNotMatch(core, /^(?:let|var) /m, "no module-level mutable state");
  // Deterministic: the same inputs give the same answer.
  assert.deepEqual(
    index.availableBuildability(INSIDE.code),
    availableBuildability(INSIDE.code, STATE)
  );
});

test("every planning value declares PLANNING_AMBITO, never a Lens or barrio scope", () => {
  assert.equal(STATE.scope, PLANNING_AMBITO_SCOPE);
  for (const object of [
    index.developmentState(INSIDE.code),
    index.availableBuildability(INSIDE.code),
    index.ambitoContaining(INSIDE.lon, INSIDE.lat),
  ]) {
    assert.equal(object.scope, PLANNING_AMBITO_SCOPE);
  }
  assert.match(STATE_META.scope_note, /WHOLE planning ámbito/);
  assert.match(STATE_META.scope_note, /no value is combined with a value of another analytical scope/);
  // The ámbito and the barrio stay different geometries: a planning record
  // carries no barrio identity at all, so the two can never be concatenated.
  const geography = createGeographyIndex(readJson("../data/geography/madrid_admin.geojson"));
  const barrio = geography.resolve(INSIDE.lon, INSIDE.lat).barrio;
  assert.ok(barrio, "the fixture point is inside an official barrio too");
  const state = index.developmentState(INSIDE.code);
  const stateText = JSON.stringify(state);
  assert.equal(stateText.includes(barrio.official_id), false, "no barrio id in a planning record");
  assert.equal(stateText.includes(barrio.official_name), false, "no barrio name in a planning record");
  for (const key of Object.keys(state)) assert.doesNotMatch(key, /barrio|lens|circle/i, key);
});

// ------------------------------------------------------ 11. no change surface

test("K6 current records remain primary and separate from the K7 edition pair", () => {
  // K6 model functions still consume a current-edition index. K7's pair is a
  // separate artifact object and never mutates an ámbito into a merged record.
  for (const fn of [developmentState, availableBuildability, ambitoContaining, ambitosIntersecting]) {
    assert.ok(fn.length <= 2, `${fn.name} takes at most two arguments`);
  }
  const forbidden = /previous|earlier|delta|diff|change|trend|transition|since|compare/i;
  const walk = (value, path) => {
    if (Array.isArray(value)) return value.forEach((item, i) => walk(item, `${path}[${i}]`));
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.doesNotMatch(key, forbidden, `${path}.${key}`);
      walk(child, `${path}.${key}`);
    }
  };
  walk({ editions: STATE.editions, ambitos: STATE.ambitos }, "K6");
  assert.deepEqual(Object.keys(STATE.editions).sort(), ["available_buildability", "development_state"]);
  const pair = STATE.change_detection;
  assert.equal(pair.pair_id, "2025-07__2026-01");
  assert.equal(pair.previous.reference_date, "2025-07-01");
  assert.equal(pair.current.reference_date, "2026-01-01");
  assert.equal(pair.current.families.S1.snapshot_identity, STATE.editions.development_state.snapshot_identity);
  assert.equal(pair.current.families.S2.snapshot_identity, STATE.editions.available_buildability.snapshot_identity);
});
