// Documented evidence export — the bundle contract these tests defend (K11, #73).
//
// THE DECISIVE CONTRACTS:
//
//   1. The bundle is a TRANSCRIPT: reading.json carries no value the projection
//      did not already carry (the no-recomputation guarantee), and every shown
//      value keeps its scope, unit, the five freshness fields and the verbatim
//      ceiling.
//   2. A withheld delta stays withheld WITH its reason; a published zero stays a
//      real zero; a missing/unavailable value is distinct from both.
//   3. sources.json carries ONLY the contributing registry entries, with licence
//      and attribution — never the whole registry.
//   4. geometry.geojson is EPSG:4326, every feature scope-tagged; an official
//      polygon is preserved, never replaced by a bounding box; a Lens circle is
//      marked a generated analytical window.
//   5. README.txt attributes every CC BY 4.0 source and records the retrieval date.
//   6. state.url and reading.json describe the same reading.
//   7. No new dependency is introduced.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  GEOJSON_CRS,
  FRESHNESS_FIELDS,
  contributingSourceIds,
  buildReadingObject,
  buildSourcesObject,
  buildGeometryObject,
  buildEvidenceBundle,
} from "../js/evidence-export.js";

const readJson = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), "utf8"));
const REGISTRY = readJson("../data/source_registry.json");

// A realistic projection using REAL registry source ids, mirroring what the app
// assembles from the frozen models. `geography` carries a CC BY 4.0 licence.
const PROJECTION = Object.freeze({
  meta: {
    mode: "COMPARE",
    scope: "LENS",
    reading: "analyst",
    language: "en",
    generated_at: "2026-10-15T09:30:00.000Z",
    snapshot_id: "20261015-1",
    app_version: "20261015-1",
  },
  state_url: "https://example.org/lens/?v=1&m=COMPARE&a=40.41490,-3.69000,900&b=40.42240,-3.70370,900&be=1&al=A&ly=museum.info&sc=LENS&rd=analyst&lg=en",
  values: [
    { id: "tourism", label: "Tourism POIs", scope: "LENS_CIRCLE", unit: "POIs", a_value: 5, b_value: 10, delta: 5, display: "A 5 · B 10 · Δ +5", state: "VALID", comparison_basis: "RAW_COUNT", source_ids: ["museum", "info"] },
    { id: "stays", label: "Hotels & stays", scope: "LENS_CIRCLE", unit: "stays", a_value: 0, b_value: 0, delta: 0, display: "A 0 · B 0 · Δ 0", state: "VALID", comparison_basis: "RAW_COUNT", source_ids: ["stay"] },
    { id: "mobility", label: "Mobility nodes", scope: "LENS_CIRCLE", unit: "nodes", a_value: null, b_value: null, delta: null, display: null, state: "WITHHELD", withheld_reason: "different window sizes", comparison_basis: "RAW_COUNT", source_ids: ["bike", "rail"] },
    { id: "utci", label: "Mean UTCI", scope: "LENS_CIRCLE", unit: "°C", a_value: null, b_value: null, delta: null, display: null, state: "UNAVAILABLE", source_ids: ["hati"] },
  ],
  evidence: [
    {
      surface: "compare.tourism", scope: "LENS_CIRCLE", unit: "unit.poi", derivation: "derivation.lensCount",
      sources: [
        { id: "museum", display_name: "Museums", authority: "Ayuntamiento de Madrid", freshness: { reference_date: null, published_at: null, retrieved_at: "2026-09-29", update_frequency: "NONE_DECLARED", source_state: "NOT_DECLARED_BY_PUBLISHER" }, interpretation_ceiling: "Counts of museum POIs inside the Lens circle. Not a quality or pressure measure." },
        { id: "info", display_name: "Tourist info", authority: "Ayuntamiento de Madrid", freshness: { reference_date: null, published_at: null, retrieved_at: "2026-09-29", update_frequency: "NONE_DECLARED", source_state: "NOT_DECLARED_BY_PUBLISHER" }, interpretation_ceiling: "Counts of tourist-info POIs inside the Lens circle." },
      ],
    },
    {
      surface: "place.area", scope: "ADMIN_BARRIO", unit: "unit.barrio", derivation: "derivation.official",
      sources: [
        { id: "geography", display_name: "Administrative geography", authority: "Ayuntamiento de Madrid — IDEAM", freshness: { reference_date: "2026", published_at: null, retrieved_at: "2026-09-01", update_frequency: "IRREGULAR", source_state: "DEFINITIVE" }, interpretation_ceiling: "Official administrative boundaries. Context, not a data layer." },
      ],
    },
  ],
  geometry: [
    { scope: "LENS_CIRCLE", role: "lensA", identity: "A", geometry_kind: "generated_analytical_window", feature: { type: "Feature", geometry: { type: "Polygon", coordinates: [[[-3.69, 40.41], [-3.68, 40.41], [-3.68, 40.42], [-3.69, 40.41]]] } } },
    { scope: "ADMIN_BARRIO", role: "barrio", identity: "Universidad", geometry_kind: "official_boundary", feature: { type: "Feature", properties: { NOMBRE: "Universidad" }, geometry: { type: "MultiPolygon", coordinates: [[[[-3.71, 40.42], [-3.70, 40.42], [-3.70, 40.43], [-3.71, 40.42]]]] } } },
  ],
});

const BUNDLE = buildEvidenceBundle(PROJECTION, REGISTRY, { now: new Date("2026-10-15T09:30:00.000Z") });
const fileByStem = (stem) => BUNDLE.files.find((f) => f.name.startsWith(stem));

// ---------------------------------------------------------------- five files

test("the bundle has exactly the five required, date-stamped files", () => {
  assert.equal(BUNDLE.files.length, 5);
  const names = BUNDLE.files.map((f) => f.name).sort();
  assert.deepEqual(names, [
    "README-20261015-0930.txt",
    "geometry-20261015-0930.geojson",
    "reading-20261015-0930.json",
    "sources-20261015-0930.json",
    "state-20261015-0930.url",
  ]);
});

test("export filenames carry the retrieval date so two exports differ", () => {
  const later = buildEvidenceBundle(PROJECTION, REGISTRY, { now: new Date("2026-10-16T11:45:00.000Z") });
  assert.notEqual(BUNDLE.files[0].name, later.files[0].name);
  assert.ok(later.files[0].name.includes("20261016-1145"));
});

// --------------------------------------------------- reading.json completeness

test("every displayed value appears in reading.json with scope, unit and state", () => {
  const reading = JSON.parse(fileByStem("reading-").text);
  assert.equal(reading.values.length, PROJECTION.values.length);
  for (const value of reading.values) {
    assert.ok(value.scope, `value ${value.id} has a scope`);
    assert.ok("unit" in value, `value ${value.id} has a unit`);
    assert.ok(value.state, `value ${value.id} has a state`);
  }
});

test("every evidence source carries the five freshness fields and a verbatim ceiling", () => {
  const reading = JSON.parse(fileByStem("reading-").text);
  for (const surface of reading.evidence_surfaces) {
    for (const source of surface.sources) {
      for (const field of FRESHNESS_FIELDS) {
        assert.ok(field in source.freshness, `${source.id} carries ${field}`);
      }
      assert.ok(source.interpretation_ceiling, `${source.id} carries its ceiling`);
    }
  }
});

test("reading.json contains NO value the projection did not carry (no recomputation)", () => {
  const reading = buildReadingObject(PROJECTION);
  assert.deepEqual(reading.values, PROJECTION.values);
  assert.deepEqual(reading.evidence_surfaces, PROJECTION.evidence);
});

test("a withheld delta stays withheld with its reason, never a zero", () => {
  const reading = JSON.parse(fileByStem("reading-").text);
  const mobility = reading.values.find((v) => v.id === "mobility");
  assert.equal(mobility.state, "WITHHELD");
  assert.equal(mobility.delta, null);
  assert.equal(mobility.withheld_reason, "different window sizes");
});

test("a published zero is preserved as a real zero", () => {
  const reading = JSON.parse(fileByStem("reading-").text);
  const stays = reading.values.find((v) => v.id === "stays");
  assert.equal(stays.state, "VALID");
  assert.equal(stays.a_value, 0);
  assert.equal(stays.delta, 0);
});

test("a missing / unavailable value is distinct from a published zero", () => {
  const reading = JSON.parse(fileByStem("reading-").text);
  const utci = reading.values.find((v) => v.id === "utci");
  assert.equal(utci.state, "UNAVAILABLE");
  assert.equal(utci.a_value, null);
  // distinct from the published-zero stays value
  assert.notEqual(utci.state, reading.values.find((v) => v.id === "stays").state);
});

test("reading.json and state.url describe the same reading", () => {
  const reading = JSON.parse(fileByStem("reading-").text);
  const stateUrl = fileByStem("state-").text.trim();
  assert.equal(reading.state_url, PROJECTION.state_url);
  assert.equal(stateUrl, PROJECTION.state_url);
});

// --------------------------------------------------- sources.json (contributing)

test("sources.json carries only contributing sources, not the whole registry", () => {
  const sources = JSON.parse(fileByStem("sources-").text);
  const exportedIds = sources.sources.map((s) => s.id).sort();
  assert.deepEqual(exportedIds, [...contributingSourceIds(PROJECTION)].sort());
  assert.ok(sources.sources.length < REGISTRY.sources.length, "a strict subset of the registry");
  // bike/rail/hati/stay/museum/info/geography contribute; an unrelated registry id does not
  const allRegistryIds = REGISTRY.sources.map((s) => s.id);
  const excluded = allRegistryIds.filter((id) => !exportedIds.includes(id));
  assert.ok(excluded.length > 0, "at least one registry source is excluded");
});

test("a contributing source exports its retrieval route, licence and attribution where declared", () => {
  const sources = buildSourcesObject(PROJECTION, REGISTRY).sources;
  const geography = sources.find((s) => s.id === "geography");
  assert.ok(geography, "geography is a contributing source");
  assert.equal(geography.license, "CC BY 4.0");
  // freshness fields travel with each source
  for (const field of FRESHNESS_FIELDS) assert.ok(field in geography, `geography carries ${field}`);
});

// ------------------------------------------------------------ geometry.geojson

test("geometry.geojson is EPSG:4326 with every feature scope-tagged", () => {
  const geo = JSON.parse(fileByStem("geometry-").text);
  assert.equal(geo.type, "FeatureCollection");
  assert.match(JSON.stringify(geo.crs), /4326/);
  assert.equal(GEOJSON_CRS, "EPSG:4326");
  for (const feature of geo.features) {
    assert.equal(feature.type, "Feature");
    assert.ok(feature.properties.scope, "feature is scope-tagged");
    assert.ok(feature.geometry, "feature keeps its geometry");
  }
});

test("an official polygon is preserved, never replaced by a bounding box", () => {
  const geo = buildGeometryObject(PROJECTION);
  const barrio = geo.features.find((f) => f.properties.role === "barrio");
  assert.equal(barrio.geometry.type, "MultiPolygon");
  // the exact committed ring survives, not a 5-point bbox
  assert.deepEqual(barrio.geometry.coordinates, PROJECTION.geometry[1].feature.geometry.coordinates);
  assert.equal(barrio.properties.geometry_kind, "official_boundary");
});

test("a Lens circle is marked a generated analytical window", () => {
  const geo = buildGeometryObject(PROJECTION);
  const lens = geo.features.find((f) => f.properties.role === "lensA");
  assert.equal(lens.properties.geometry_kind, "generated_analytical_window");
  assert.equal(lens.properties.scope, "LENS_CIRCLE");
});

// -------------------------------------------------------------------- README

test("README.txt attributes every CC BY 4.0 source and records the retrieval date", () => {
  const readme = fileByStem("README-").text;
  assert.match(readme, /CC BY 4\.0/);
  assert.match(readme, /ATTRIBUTION \(required by CC BY 4\.0\)/);
  assert.match(readme, /Administrative geography|IDEAM/);
  assert.match(readme, /2026-10-15T09:30:00\.000Z/); // generated/retrieval date
  assert.match(readme, /withheld[\s\S]*reason/i);
});

// ------------------------------------------------------------ no new dependency

test("no new dependency is introduced in package.json", () => {
  const pkg = readJson("../package.json");
  assert.deepEqual(Object.keys(pkg.devDependencies || {}), ["playwright"]);
  assert.equal(pkg.dependencies, undefined, "no runtime dependencies added");
});
