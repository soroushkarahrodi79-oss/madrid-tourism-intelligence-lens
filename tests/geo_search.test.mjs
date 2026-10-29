// M1 unified geographic search — the pure core, against the REAL committed
// artifacts. No fixture stands in for the official universes: an index that
// disagreed with data/geography/madrid_admin.geojson or
// data/planning/madrid_ambitos.geojson would be a search surface that disagrees
// with the evidence surfaces, and that is the defect these tests exist to catch.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createGeographyIndex, pointInGeometry } from "../js/geography.js";
import { createPlanningIndex } from "../js/planning-ambito.js";
import {
  GEO_ENTITY_TYPES,
  GEO_SEARCH_RESULT_LIMIT,
  createGeoSearchIndex,
  foldText,
  interiorPointOf,
  searchGeoEntities,
} from "../js/geo-search.js";

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
const ADMIN = read("data/geography/madrid_admin.geojson");
const AMBITO_GEOMETRY = read("data/planning/madrid_ambitos.geojson");
const AMBITO_STATE = read("data/planning/madrid_ambito_state.json");

const geography = createGeographyIndex(ADMIN);
const planning = createPlanningIndex({ geometry: AMBITO_GEOMETRY, state: AMBITO_STATE });
const index = createGeoSearchIndex({ geography, planning });

const resultIds = (query, limit) => searchGeoEntities(index, query, limit).results.map((result) => result.id);
const typeOf = (id) => id.slice(0, id.indexOf(":"));

// --------------------------------------------------------------- 15. universe
test("the index is exactly the authoritative entity universes, with nothing added or dropped", () => {
  assert.equal(index.counts.MUNICIPALITY, geography.counts.municipality);
  assert.equal(index.counts.DISTRICT, geography.counts.district);
  assert.equal(index.counts.BARRIO, geography.counts.barrio);
  assert.equal(index.counts.AMBITO, planning.entries.length);
  assert.equal(
    index.counts.total,
    geography.counts.municipality + geography.counts.district + geography.counts.barrio + planning.entries.length,
  );
  // The committed artifacts as of this edition, so a silent change of universe
  // size fails here rather than quietly widening what search claims to cover.
  assert.deepEqual(
    { municipality: index.counts.MUNICIPALITY, district: index.counts.DISTRICT, barrio: index.counts.BARRIO, ambito: index.counts.AMBITO },
    { municipality: 1, district: 21, barrio: 131, ambito: 724 },
  );
  assert.deepEqual(index.coverage, { administrative: true, ambito: true });
  assert.deepEqual([...GEO_ENTITY_TYPES], ["MUNICIPALITY", "DISTRICT", "BARRIO", "AMBITO"]);
});

test("every entry carries official identity only — no quantity, state, date or score", () => {
  const permitted = new Set(["id", "type", "code", "name", "parentId", "parentName", "foldedName", "foldedCode"]);
  for (const entry of index.entries) {
    for (const key of Object.keys(entry)) assert.ok(permitted.has(key), `${entry.id} exposes "${key}"`);
    assert.ok(Object.isFrozen(entry));
  }
  const reading = searchGeoEntities(index, "centro");
  const permittedResult = new Set(["id", "type", "code", "name", "parentId", "parentName", "match", "ambiguous"]);
  for (const result of reading.results) {
    for (const key of Object.keys(result)) assert.ok(permittedResult.has(key), `result exposes "${key}"`);
  }
});

test("every code and name in the index is the source's own value, carried verbatim", () => {
  const sourceAmbito = new Map(AMBITO_GEOMETRY.features.map((f) => [f.properties.ambito_code, f.properties.ambito_denomination]));
  const sourceAdmin = new Map(ADMIN.features.map((f) => [`${f.properties.geography_level}:${f.properties.official_id}`, f.properties.official_name]));
  for (const entry of index.entries) {
    if (entry.type === "AMBITO") {
      assert.ok(sourceAmbito.has(entry.code), `${entry.code} is not an official ámbito code`);
      assert.equal(entry.name, sourceAmbito.get(entry.code));
    } else {
      const key = `${entry.type.toLowerCase()}:${entry.code}`;
      assert.ok(sourceAdmin.has(key), `${key} is not an official administrative id`);
      assert.equal(entry.name, sourceAdmin.get(key));
    }
  }
});

// -------------------------------------------------------- 1, 4, 7. exact code
test("1. an exact official ámbito code resolves to that one ámbito", () => {
  const reading = searchGeoEntities(index, "APR.02.09");
  assert.equal(reading.state, "results");
  assert.equal(reading.results[0].id, "AMBITO:APR.02.09");
  assert.equal(reading.results[0].match, "EXACT_CODE");
  assert.equal(reading.results[0].type, "AMBITO");
});

test("4. codes and names match regardless of letter case", () => {
  assert.equal(searchGeoEntities(index, "apr.02.09").results[0].id, "AMBITO:APR.02.09");
  assert.equal(searchGeoEntities(index, "Apr.02.09").results[0].id, "AMBITO:APR.02.09");
  assert.equal(searchGeoEntities(index, "PALACIO").results[0].id, "BARRIO:011");
  assert.equal(searchGeoEntities(index, "palacio").results[0].id, "BARRIO:011");
});

test("7. an invalid or malformed identifier matches nothing and says so", () => {
  for (const query of ["APR.99.99", "ZZZ.00.00", "999", "APR.02.09.EXTRA", "--", "{}"]) {
    const reading = searchGeoEntities(index, query);
    assert.equal(reading.state, "not_found", `"${query}" should not resolve`);
    assert.equal(reading.results.length, 0);
    assert.equal(reading.total, 0);
  }
  // "0" is NOT an invalid identifier: it is a legitimate PREFIX of the official
  // district and barrio codes, and is reported as a code-prefix match, never as
  // an exact identification of any one area.
  const prefix = searchGeoEntities(index, "0", 200);
  assert.equal(prefix.state, "results");
  assert.equal(prefix.results[0].match, "CODE_PREFIX");
  for (const result of prefix.results) assert.ok(["CODE_PREFIX", "NAME_CONTAINS"].includes(result.match));
});

// ------------------------------------------------- 2, 3, 5. names and accents
test("2. an exact official name resolves across all three administrative levels", () => {
  assert.equal(searchGeoEntities(index, "Palacio").results[0].id, "BARRIO:011");
  assert.equal(searchGeoEntities(index, "Centro").results[0].id, "DISTRICT:01");
  assert.equal(searchGeoEntities(index, "Madrid").results[0].id, "MUNICIPALITY:28079");
  assert.equal(searchGeoEntities(index, "SISTEMA AEROPORTUARIO BARAJAS").results[0].match, "EXACT_NAME");
});

test("3. matching is accent-insensitive in both directions, and display stays accented", () => {
  const pairs = [
    ["Pacífico", "pacifico"],
    ["Argüelles", "arguelles"],
    ["Niño Jesús", "nino jesus"],
    ["Hispanoamérica", "hispanoamerica"],
    ["Los Cármenes", "los carmenes"],
  ];
  for (const [accented, plain] of pairs) {
    const withAccents = resultIds(accented);
    const withoutAccents = resultIds(plain);
    assert.deepEqual(withoutAccents, withAccents, `"${plain}" must resolve exactly as "${accented}"`);
    assert.ok(withAccents.length > 0, `"${accented}" resolves`);
    // The official value is never folded for display.
    const first = searchGeoEntities(index, plain).results[0];
    assert.equal(first.name, accented);
  }
  assert.equal(foldText("VICÁLVARO"), "vicalvaro");
  assert.equal(foldText("  Niño   Jesús  "), "nino jesus");
});

test("5. a partial name matches by prefix and by substring, prefix first", () => {
  const reading = searchGeoEntities(index, "pacif");
  assert.equal(reading.state, "results");
  assert.equal(reading.results[0].id, "BARRIO:031");
  assert.equal(reading.results[0].match, "NAME_PREFIX");

  const substring = searchGeoEntities(index, "universitaria", 20);
  assert.ok(substring.results.some((result) => result.type === "BARRIO"));
  assert.ok(substring.total >= 1);
  const kinds = substring.results.map((result) => result.match);
  assert.deepEqual([...kinds].sort(), kinds.slice().sort(), "kinds are grouped, best first");
  const order = ["EXACT_CODE", "EXACT_NAME", "CODE_PREFIX", "NAME_PREFIX", "NAME_CONTAINS"];
  for (let i = 1; i < kinds.length; i += 1) {
    assert.ok(order.indexOf(kinds[i - 1]) <= order.indexOf(kinds[i]), "match kinds never improve further down the list");
  }
});

// ------------------------------------------------------------- 6. ambiguity
test("6. entities that share a name are all returned and every one is flagged ambiguous", () => {
  // Four denominations are carried by two different official ámbito codes each.
  // That is a property of the committed register, not of this test.
  const shared = new Map();
  for (const feature of AMBITO_GEOMETRY.features) {
    const key = foldText(feature.properties.ambito_denomination);
    shared.set(key, (shared.get(key) || 0) + 1);
  }
  const duplicated = [...shared].filter(([, count]) => count > 1).map(([name]) => name);
  assert.ok(duplicated.length >= 1, "the register carries at least one shared denomination");

  // 16 folded names are carried by more than one entity across the whole index,
  // 12 of them by entities of DIFFERENT types. A change to either number means
  // the ambiguity surface has to be re-read, so it fails here rather than
  // silently presenting one entity as uniquely identified.
  const byName = new Map();
  for (const entry of index.entries) {
    if (!entry.foldedName) continue;
    byName.set(entry.foldedName, [...(byName.get(entry.foldedName) || []), entry]);
  }
  const sharedNames = [...byName.values()].filter((group) => group.length > 1);
  assert.equal(sharedNames.length, 16);
  assert.equal(sharedNames.filter((group) => new Set(group.map((entry) => entry.type)).size > 1).length, 12);

  for (const name of duplicated) {
    const reading = searchGeoEntities(index, name, 20);
    const exact = reading.results.filter((result) => result.match === "EXACT_NAME");
    assert.ok(exact.length >= 2, `"${name}" returns every entity that carries it`);
    for (const result of exact) {
      assert.equal(result.ambiguous, true, `${result.id} must be flagged ambiguous`);
      assert.ok(result.code, "the official code is present as the distinguishing identity");
    }
    assert.equal(new Set(exact.map((result) => result.code)).size, exact.length, "the codes distinguish them");
  }
});

test("a uniquely named entity is never flagged ambiguous", () => {
  for (const query of ["Palacio", "Centro", "Madrid", "Pacífico", "Argüelles"]) {
    const first = searchGeoEntities(index, query).results[0];
    assert.equal(first.ambiguous, false, `${query} is unique in the index`);
  }
});

// --------------------------------------------------- 8, 9. empty and unknown
test("8. an empty or whitespace-only query is empty, not a match and not an error", () => {
  for (const query of ["", "   ", "\t", "\n", null, undefined, 42, {}]) {
    const reading = searchGeoEntities(index, query);
    assert.equal(reading.state, "empty", `${JSON.stringify(query)} is an empty query`);
    assert.equal(reading.results.length, 0);
  }
});

test("9. an unknown query is explicitly not found, with the searched coverage attached", () => {
  const reading = searchGeoEntities(index, "zzzz-no-such-place");
  assert.equal(reading.state, "not_found");
  assert.deepEqual(reading.coverage, { administrative: true, ambito: true });
});

// -------------------------------------------- 10, 11. duplicates and identity
test("10. no result appears twice, however many ways the query could match it", () => {
  for (const query of ["a", "c", "e", "APR", "01", "0", "centro", "parque", "ciudad"]) {
    const ids = resultIds(query, 200);
    assert.equal(new Set(ids).size, ids.length, `"${query}" returned a duplicate`);
  }
  const ids = index.entries.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "the index itself holds no duplicate id");
});

test("11. result identity and order are stable across repeated identical queries", () => {
  for (const query of ["c", "parque", "APR.02", "pacifico", "arroyo"]) {
    const first = JSON.stringify(searchGeoEntities(index, query, 50).results);
    const second = JSON.stringify(searchGeoEntities(index, query, 50).results);
    const third = JSON.stringify(searchGeoEntities(createGeoSearchIndex({ geography, planning }), query, 50).results);
    assert.equal(second, first, `"${query}" is not stable across calls`);
    assert.equal(third, first, `"${query}" is not stable across index rebuilds`);
  }
});

// ------------------------------------------------------ 12. type distinction
test("12. a barrio, a district, an ámbito and the municipality stay distinct entities", () => {
  // "Centro" is an official district name. One barrio is named "Casco Histórico
  // de Barajas"; no barrio and no district share a name in the register, so a
  // name match must never promote one level to another.
  const centro = searchGeoEntities(index, "Centro", 50);
  const exact = centro.results.filter((result) => result.match === "EXACT_NAME");
  assert.deepEqual(exact.map((result) => result.type), ["DISTRICT"]);
  assert.equal(exact[0].parentName, "Madrid");

  const barrio = index.byId("BARRIO:011");
  const district = index.byId("DISTRICT:01");
  assert.equal(barrio.type, "BARRIO");
  assert.equal(district.type, "DISTRICT");
  assert.equal(barrio.parentId, "01");
  assert.equal(barrio.parentName, "Centro");
  assert.notEqual(barrio.id, district.id);

  // Every result's type is one of the four declared types, and the type is never
  // inferred from the code's shape.
  for (const result of searchGeoEntities(index, "0", 200).results) {
    assert.ok(GEO_ENTITY_TYPES.includes(result.type));
    assert.equal(typeOf(result.id), result.type);
  }
});

test("a name shared ACROSS entity types returns both, each with its own type and code", () => {
  // The register genuinely does this: an official barrio and an official planning
  // ámbito carry the same denomination in 12 cases. Collapsing them, or showing
  // only one, would present a barrio as an ámbito or the reverse.
  const collisions = [
    ["Ciudad Universitaria", "BARRIO:093", "AMBITO:AOE.00.07"],
    ["Casa de Campo", "BARRIO:091", "AMBITO:APE.09.19"],
    ["Alameda de Osuna", "BARRIO:211", "AMBITO:APR.21.03"],
    ["Carabanchel", "DISTRICT:11", "AMBITO:UZI.0.10"],
  ];
  for (const [name, ...expected] of collisions) {
    const reading = searchGeoEntities(index, name, 20);
    const exact = reading.results.filter((result) => result.match === "EXACT_NAME");
    assert.deepEqual(exact.map((result) => result.id), expected, `"${name}" must return both entities`);
    assert.equal(new Set(exact.map((result) => result.type)).size, 2, `"${name}" spans two entity types`);
    for (const result of exact) assert.equal(result.ambiguous, true, `${result.id} must be flagged ambiguous`);
  }
});

test("the register states no parent for an ámbito or for the municipality, and none is invented", () => {
  for (const entry of index.entries) {
    if (entry.type === "AMBITO" || entry.type === "MUNICIPALITY") {
      assert.equal(entry.parentId, null, `${entry.id} must carry no geometric parent`);
      assert.equal(entry.parentName, null, `${entry.id} must carry no geometric parent`);
    } else {
      assert.ok(entry.parentName, `${entry.id} must carry the parent the source states`);
    }
  }
});

// ------------------------------------- 13, 14. loading and unusable universes
test("13. searching while one universe is still loading answers over the other and names the gap", () => {
  const adminOnly = createGeoSearchIndex({ geography, planning: null });
  assert.deepEqual(adminOnly.coverage, { administrative: true, ambito: false });
  assert.equal(adminOnly.counts.AMBITO, 0);
  assert.equal(searchGeoEntities(adminOnly, "Palacio").results[0].id, "BARRIO:011");
  const missing = searchGeoEntities(adminOnly, "APR.02.09");
  assert.equal(missing.state, "not_found");
  assert.equal(missing.coverage.ambito, false, "the absent universe is reported, not implied to be empty");

  const ambitoOnly = createGeoSearchIndex({ geography: null, planning });
  assert.deepEqual(ambitoOnly.coverage, { administrative: false, ambito: true });
  assert.equal(searchGeoEntities(ambitoOnly, "APR.02.09").results[0].id, "AMBITO:APR.02.09");
  assert.equal(searchGeoEntities(ambitoOnly, "Palacio").coverage.administrative, false);
});

test("14. missing or unusable source data yields an unavailable search, never an empty one", () => {
  for (const argument of [undefined, {}, { geography: null, planning: null }, { geography: {}, planning: {} }, { geography: { featuresByLevel: () => [] }, planning: { entries: [] } }]) {
    const empty = createGeoSearchIndex(argument);
    const reading = searchGeoEntities(empty, "Palacio");
    assert.equal(reading.state, "unavailable", `${JSON.stringify(argument)} must be unavailable`);
    assert.equal(reading.results.length, 0);
  }
  assert.equal(searchGeoEntities(null, "Palacio").state, "unavailable");
  // Features without an official id are not entities and are skipped rather than
  // indexed as a nameless, codeless result.
  const malformed = createGeoSearchIndex({
    geography: { featuresByLevel: (level) => (level === "barrio" ? [{ properties: {} }, { properties: { official_id: "011", official_name: "Palacio" } }] : []) },
  });
  assert.equal(malformed.counts.total, 1);
});

// -------------------------------------------------------- limit and ordering
test("the result limit is honoured and truncation is reported rather than hidden", () => {
  const reading = searchGeoEntities(index, "a", 5);
  assert.equal(reading.results.length, 5);
  assert.ok(reading.total > 5);
  assert.equal(reading.truncated, true);
  assert.equal(searchGeoEntities(index, "a").results.length, GEO_SEARCH_RESULT_LIMIT);
  for (const limit of [0, -1, 1.5, "8", null]) {
    assert.equal(searchGeoEntities(index, "a", limit).results.length, GEO_SEARCH_RESULT_LIMIT);
  }
});

test("ordering uses match kind, declared type order and the stable id — never a magnitude", () => {
  const source = fs.readFileSync(new URL("../js/geo-search.js", import.meta.url), "utf8");
  // A sort that reached for a size, a count or a population would be a ranking
  // of places. The sort comparator may read only these three things.
  const comparator = source.slice(source.indexOf("matched.sort("), source.indexOf("const results = matched.slice"));
  assert.match(comparator, /a\.kind - b\.kind/);
  assert.match(comparator, /TYPE_ORDER\.indexOf/);
  assert.match(comparator, /a\.item\.id\.localeCompare/);
  for (const forbidden of ["surface", "population", "area", "count", "length", "buildability", "density"]) {
    assert.doesNotMatch(comparator, new RegExp(forbidden, "i"), `the comparator must not read ${forbidden}`);
  }
});

test("search reads no quantity, state, date or edition from the planning artifacts", () => {
  const source = fs.readFileSync(new URL("../js/geo-search.js", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["developmentState", "availableBuildability", "development_state", "available_buildability", "editions", "phases", "surface", "population", "ambitosIntersecting", "barrioAt", "districtAt", "fetch("]) {
    assert.ok(!code.includes(forbidden), `js/geo-search.js must not reference ${forbidden}`);
  }
  // pointInGeometry is the ONE containment implementation the project allows, and
  // the search core must reuse it rather than writing a second one.
  assert.match(source, /^import \{ pointInGeometry \} from "\.\/geography\.js";$/m);
});

// ------------------------------------------------------- verified interior point
test("every entity in every universe yields an interior point that containment confirms", () => {
  const methods = {};
  const failures = [];
  const check = (label, geometry) => {
    const point = interiorPointOf(geometry);
    if (!point || !pointInGeometry(point.lon, point.lat, geometry)) return failures.push(label);
    methods[point.method] = (methods[point.method] || 0) + 1;
    return null;
  };
  for (const entry of planning.entries) check(`AMBITO ${entry.code}`, entry.geometry);
  for (const level of ["municipality", "district", "barrio"]) {
    for (const feature of geography.featuresByLevel(level)) check(`${level} ${feature.properties.official_id}`, feature.geometry);
  }
  assert.deepEqual(failures, [], "an unverified interior point must be withheld, not shipped");
  assert.equal(Object.values(methods).reduce((a, b) => a + b, 0), index.counts.total);
  // Both methods are genuinely exercised by the real register, so the fallback
  // scan is not dead code that only a synthetic shape would reach.
  assert.ok(methods.ENVELOPE_CENTRE > 0);
  assert.ok(methods.WIDEST_INTERIOR_SPAN > 0);
});

test("the envelope centre is never assumed to be inside the geometry", () => {
  // A ring-shaped polygon whose bounding-box centre lies in its hole. The
  // returned point must be in the ring itself, not in the hole.
  const donut = {
    type: "Polygon",
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]],
    ],
  };
  assert.equal(pointInGeometry(5, 5, donut), false, "the fixture's envelope centre is in the hole");
  const point = interiorPointOf(donut);
  assert.ok(point, "a ring-shaped area still has an interior point");
  assert.equal(point.method, "WIDEST_INTERIOR_SPAN");
  assert.equal(pointInGeometry(point.lon, point.lat, donut), true);

  // A crescent made of two parts, where the envelope centre is between them.
  const split = {
    type: "MultiPolygon",
    coordinates: [
      [[[0, 0], [2, 0], [2, 10], [0, 10], [0, 0]]],
      [[[8, 0], [10, 0], [10, 10], [8, 10], [8, 0]]],
    ],
  };
  assert.equal(pointInGeometry(5, 5, split), false);
  const splitPoint = interiorPointOf(split);
  assert.equal(pointInGeometry(splitPoint.lon, splitPoint.lat, split), true);
});

test("an interior point is deterministic and absent for a geometry that has none", () => {
  const entry = planning.entries.find((candidate) => candidate.code === "API.02.14");
  assert.deepEqual(interiorPointOf(entry.geometry), interiorPointOf(entry.geometry));
  for (const geometry of [null, undefined, {}, { type: "Point", coordinates: [0, 0] }, { type: "Polygon", coordinates: [[[0, 0], [1, 0], [2, 0], [0, 0]]] }]) {
    assert.equal(interiorPointOf(geometry), null, `${JSON.stringify(geometry)} has no verifiable interior point`);
  }
});

// -------------------------------------------------------------- hostile input
test("hostile, very long and unusual input is matched as text and never executed or mangled", () => {
  const hostile = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "';DROP TABLE ambitos;--",
    "${process.exit(1)}",
    "{{constructor}}",
    "__proto__",
    "constructor",
    "toString",
    "../../etc/passwd",
    "%00",
    "\u0000",
    "‮",
    "👋🏽",
  ];
  for (const query of hostile) {
    const reading = searchGeoEntities(index, query);
    assert.ok(["not_found", "results", "empty"].includes(reading.state), `${JSON.stringify(query)} produced ${reading.state}`);
    for (const result of reading.results) assert.ok(index.byId(result.id), "every result is a real indexed entity");
  }
  // A prototype-polluting key must not resolve to an entity through the id map.
  assert.equal(index.byId("__proto__"), null);
  assert.equal(index.byId("constructor"), null);
  assert.equal(index.byId("BARRIO:__proto__"), null);

  const long = "a".repeat(100000);
  const started = performance.now();
  const reading = searchGeoEntities(index, long);
  assert.equal(reading.state, "not_found");
  assert.ok(performance.now() - started < 500, "a pathological query still terminates promptly");
});

test("repeated rapid querying stays within one 60 Hz frame per keystroke", () => {
  const terms = ["a", "pa", "pac", "paci", "pacif", "pacifi", "pacific", "pacifico", "APR", "APR.", "APR.0", "APR.02", "APR.02.0", "APR.02.09"];
  const samples = [];
  for (let round = 0; round < 40; round += 1) {
    for (const term of terms) {
      const started = performance.now();
      searchGeoEntities(index, term);
      samples.push(performance.now() - started);
    }
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(0.95 * (samples.length - 1))];
  assert.ok(p95 < 16, `per-query p95 was ${p95.toFixed(2)}ms over ${index.counts.total} entities`);
});
