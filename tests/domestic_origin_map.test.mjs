import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildDomesticOriginContext, createDomesticOriginIndex } from "../js/domestic-origin-context.js";
import { MADRID_MUNICIPALITY_CODE, MAP_DEFAULT_LIMIT, MAP_DICTIONARIES, MAP_LIMITS, MAP_MAX_RADIUS_PX, MAP_STATE, buildDomesticOriginMapModel, createMunicipalityPointIndex } from "../js/domestic-origin-map.js";

const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), "utf8"));
const origins = read("../data/destination/madrid_domestic_origins.json");
const pointsArtifact = read("../data/geography/spain_municipality_points.json");
const pointsMeta = read("../data/geography/spain_municipality_points.meta.json");
const originIndex = createDomesticOriginIndex(origins);
const pointIndex = createMunicipalityPointIndex(pointsArtifact);
const modelFor = (month) => buildDomesticOriginContext({ index: originIndex, month });

test("the committed IGN point artifact indexes and carries Madrid", () => {
  assert.ok(pointIndex);
  assert.equal(pointIndex.byCode.size, pointsArtifact.record_count);
  assert.ok(pointIndex.byCode.has(MADRID_MUNICIPALITY_CODE));
  assert.match(pointIndex.edition, /^\d{4}-\d{2}$/);
});

test("reference points match known municipality positions (lon/lat order, WGS84-compatible)", () => {
  const near = (code, lon, lat) => { const p = pointIndex.byCode.get(code); assert.ok(Math.abs(p.lon - lon) < 0.1 && Math.abs(p.lat - lat) < 0.1, `${code}: ${p.lon}, ${p.lat}`); };
  near("28079", -3.70, 40.42); // Madrid
  near("08019", 2.17, 41.39); // Barcelona
  near("35016", -15.43, 28.12); // Las Palmas de Gran Canaria (REGCAN95)
  near("07040", 2.65, 39.57); // Palma (Balearic Islands)
});

test("every published origin of every month resolves to a point, so nothing is silently dropped", () => {
  const missing = [];
  for (const month of originIndex.months) for (const origin of originIndex.byMonth.get(month)) if (!pointIndex.byCode.has(origin.origin_municipality_code)) missing.push(`${month}:${origin.origin_municipality_code}`);
  assert.deepEqual(missing, []);
});

test("the map ranks exactly the same Top N as the validated table, for every month and limit", () => {
  assert.deepEqual(MAP_LIMITS, [10, 25]);
  assert.equal(MAP_DEFAULT_LIMIT, 10);
  for (const month of originIndex.months) for (const limit of MAP_LIMITS) {
    const model = modelFor(month);
    const map = buildDomesticOriginMapModel({ model, pointIndex, limit });
    assert.equal(map.state, MAP_STATE.AVAILABLE);
    assert.equal(map.month, month);
    assert.equal(map.shown, limit);
    assert.equal(map.total, model.origins.length);
    assert.equal(map.unplaced.length, 0);
    assert.deepEqual(map.points.map((p) => [p.position, p.code, p.name, p.count, p.countDisplay]), model.origins.slice(0, limit).map((o, i) => [i + 1, o.origin_municipality_code, o.origin_municipality_name, o.source_reported_tourists, o.countDisplay]));
  }
});

test("circle area is proportional to the count, relative to the largest shown, on a zero baseline", () => {
  const map = buildDomesticOriginMapModel({ model: modelFor(), pointIndex, limit: 25 });
  const max = map.points[0].count;
  assert.equal(map.points[0].radiusPx, MAP_MAX_RADIUS_PX);
  for (const p of map.points) {
    assert.ok(p.radiusPx > 0 && p.radiusPx <= MAP_MAX_RADIUS_PX);
    assert.ok(Math.abs((p.radiusPx / MAP_MAX_RADIUS_PX) ** 2 - p.count / max) < 1e-9, p.code);
  }
});

test("an origin without a reference point is reported as unplaced, never dropped or put at 0,0", () => {
  const trimmed = structuredClone(pointsArtifact);
  const model = modelFor();
  const victim = model.origins[1].origin_municipality_code;
  delete trimmed.points[victim];
  trimmed.record_count -= 1;
  const map = buildDomesticOriginMapModel({ model, pointIndex: createMunicipalityPointIndex(trimmed), limit: 10 });
  assert.equal(map.shown, 10);
  assert.equal(map.points.length, 9);
  assert.deepEqual(map.unplaced.map((u) => u.code), [victim]);
  assert.equal(map.unplaced[0].position, 2);
  assert.ok(map.points.every((p) => p.lat !== 0 && p.lon !== 0));
});

test("the model carries no flow, share, total or other-origins field", () => {
  const map = buildDomesticOriginMapModel({ model: modelFor(), pointIndex, limit: 10 });
  assert.deepEqual(Object.keys(map).sort(), ["destination", "edition", "limit", "month", "points", "shown", "state", "total", "unplaced"]);
  assert.deepEqual(Object.keys(map.points[0]), ["position", "code", "name", "count", "countDisplay", "lat", "lon", "radiusPx"]);
  assert.doesNotMatch(JSON.stringify(map), /flow|share|percent|"other"|route/i);
  assert.deepEqual(Object.keys(map.destination), ["code", "lat", "lon"]);
});

test("unavailable inputs and unsupported limits yield an empty unavailable model", () => {
  const model = modelFor();
  for (const args of [{ model, pointIndex: null }, { model: null, pointIndex }, { model: modelFor("1999-01"), pointIndex }, { model: buildDomesticOriginContext({ index: null }), pointIndex }, { model, pointIndex, limit: 7 }, { model, pointIndex, limit: 100 }, {}]) {
    const map = buildDomesticOriginMapModel(args);
    assert.equal(map.state, MAP_STATE.UNAVAILABLE);
    assert.deepEqual(map.points, []);
    assert.equal(map.destination, null);
  }
});

test("the point index rejects swapped, out-of-envelope, miskeyed or incomplete artifacts", () => {
  const mutate = (fn) => { const copy = structuredClone(pointsArtifact); fn(copy); return createMunicipalityPointIndex(copy); };
  assert.equal(mutate((a) => { a.points["28079"] = [40.42, -3.69]; }), null); // lon/lat swapped
  assert.equal(mutate((a) => { a.points["28079"] = [-3.69, 140.4]; }), null);
  assert.equal(mutate((a) => { a.points["2807"] = [-3.69, 40.42]; }), null);
  assert.equal(mutate((a) => { a.points["28079"] = [-3.69]; }), null);
  assert.equal(mutate((a) => { a.record_count += 1; }), null);
  assert.equal(mutate((a) => { delete a.points["28079"]; a.record_count -= 1; }), null);
  assert.equal(mutate((a) => { a.coordinates.order = "[latitude, longitude]"; }), null);
  assert.equal(mutate((a) => { a.source.edition = "march"; }), null);
  assert.equal(createMunicipalityPointIndex(null), null);
  assert.equal(createMunicipalityPointIndex({ points: [] }), null);
});

test("provenance travels with the artifact: licence, edition, fingerprints and coordinate semantics", () => {
  assert.match(pointsArtifact.source.licence, /FOM\/2807\/2015/);
  assert.match(pointsArtifact.source.licence, /CC BY 4\.0/);
  assert.match(pointsArtifact.source.authority, /Instituto Geografico Nacional/);
  assert.equal(pointsMeta.source.edition, pointsArtifact.source.edition);
  assert.match(pointsMeta.fingerprints.archive_sha256, /^[0-9a-f]{64}$/);
  assert.match(pointsMeta.fingerprints.table_sha256, /^[0-9a-f]{64}$/);
  assert.equal(pointsMeta.integrity.record_count, pointsArtifact.record_count);
  assert.match(pointsArtifact.coordinates.semantics, /not the centroid of the municipal territory/i);
  assert.match(pointsArtifact.coordinates.crs, /ETRS89.*REGCAN95/);
});

test("copy exists in EN and ES with the same keys and the zero-baseline, no-flow and not-zero disclosures", () => {
  assert.deepEqual(Object.keys(MAP_DICTIONARIES.es).sort(), Object.keys(MAP_DICTIONARIES.en).sort());
  for (const language of ["en", "es"]) for (const value of Object.values(MAP_DICTIONARIES[language])) assert.ok(value.length > 3);
  assert.match(MAP_DICTIONARIES.en.mapTitle, /\{month\}/);
  assert.match(MAP_DICTIONARIES.en.mapScale, /zero baseline/i);
  assert.match(MAP_DICTIONARIES.en.mapScale, /no flows, routes or shares/i);
  assert.match(MAP_DICTIONARIES.en.mapScale, /not at the centre of its territory/i);
  assert.match(MAP_DICTIONARIES.en.mapScale, /not zero/i);
  assert.match(MAP_DICTIONARIES.es.mapScale, /base cero/i);
  assert.match(MAP_DICTIONARIES.es.mapScale, /no son cero/i);
  for (const language of ["en", "es"]) assert.equal(`${MAP_DICTIONARIES[language].attribution} ${MAP_DICTIONARIES[language].attributionSite}`, "Obra derivada de NGMEP CC-BY 4.0 ign.es");
});
