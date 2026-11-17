// #197 — A/B geometry reproduction: URL extension (ga/gb/gx) and the local session
// file. These tests defend:
//   1. Legacy links (no geometry keys) restore exactly as before.
//   2. Polygons round-trip through a link in order, within the stated 6-decimal
//      precision, for circle–polygon, polygon–circle and polygon–polygon.
//   3. A polygon over the link budget is NEVER silently dropped: the link says so.
//   4. The session file is lossless, binds geometry to readings by fingerprint,
//      and refuses every corrupt, partial, oversized or mismatched input.
//   5. Geometry equality, result equivalence and snapshot identity stay separate.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import {
  POLYGON_LINK_LIMITS,
  SESSION_LIMITS,
  REASON,
  OUTCOME,
  serializeEvidenceState,
  parseEvidenceState,
  polygonLinkStatus,
  geometryFingerprint,
  buildSessionFile,
  parseSessionFile,
  compareSessionReadings,
} from "../js/evidence-url.js";

const require = createRequire(import.meta.url);
const { createPolygonGeometry, createCircleGeometry, geometryContainsPoint } = require("../js/lens.js");

const lensA = { lat: 40.41234, lon: -3.70123, radiusM: 900 };
const lensB = { lat: 40.42111, lon: -3.69001, radiusM: 450 };
// Full-precision (non-rounded) vertices, as map clicks produce them.
const RING_A = [
  { lat: 40.412345678901, lon: -3.702345678901 },
  { lat: 40.414567891234, lon: -3.699876543219 },
  { lat: 40.410987654321, lon: -3.698123456789 },
  { lat: 40.409876543219, lon: -3.701234567891 },
];
const RING_B = [
  { lat: 40.421111111111, lon: -3.691111111111 },
  { lat: 40.423333333333, lon: -3.688888888888 },
  { lat: 40.419999999999, lon: -3.687777777777 },
];
const polygon = (ring) => ({ kind: "POLYGON", ring });
const base = { mode: "COMPARE", lensA, lensB, lensBEnabled: true, activeLens: "B", layers: ["museum"], scope: "LENS", reading: "analyst", language: "es" };

function circleGeometry(lens) {
  return { kind: "CIRCLE", center: { lat: lens.lat, lon: lens.lon }, radiusM: lens.radiusM };
}
function sessionFor(geomA, geomB) {
  return buildSessionFile({
    state: base,
    geometries: { A: geomA, B: geomB },
    readings: { A: { tourism: { value: 3, status: "published" } }, B: { tourism: { value: 5, status: "published" } } },
    evidence: [{ surface: "tourism" }],
    limitations: ["L1"],
    meta: { generatedAt: "2026-11-17T10:00:00.000Z", snapshotId: "snap-1", appVersion: "v1" },
  });
}
const parse = (file, options = {}) => parseSessionFile(JSON.stringify(file), { snapshotId: "snap-1", createPolygon: createPolygonGeometry, ...options });
const clone = (value) => JSON.parse(JSON.stringify(value));

// ------------------------------------------------------------------ links

test("legacy circle links carry no geometry key and restore EXACT with no geometry", () => {
  const query = serializeEvidenceState(base);
  assert.doesNotMatch(query, /(^|&)(ga|gb|gx)=/);
  const result = parseEvidenceState(query);
  assert.equal(result.outcome, OUTCOME.EXACT);
  assert.equal(result.state.geometryA, undefined);
  assert.equal(result.state.geometryB, undefined);
  // A hand-written pre-#197 link, key order and all.
  const legacy = "v=1&m=COMPARE&a=40.41234%2C-3.70123%2C900&b=40.42111%2C-3.69001%2C450&be=1&al=B&ly=museum&sc=LENS&rd=analyst&lg=es";
  const old = parseEvidenceState(legacy);
  assert.equal(old.outcome, OUTCOME.EXACT);
  assert.deepEqual(old.state.lensA, lensA);
});

for (const [name, geometryA, geometryB] of [
  ["circle–polygon", undefined, polygon(RING_B)],
  ["polygon–circle", polygon(RING_A), undefined],
  ["polygon–polygon", polygon(RING_A), polygon(RING_B)],
]) {
  test(`link round-trip ${name}: order preserved, within 6 decimals`, () => {
    const state = { ...base, geometryA, geometryB };
    assert.equal(polygonLinkStatus(state).encodable, true);
    const result = parseEvidenceState(serializeEvidenceState(state));
    assert.equal(result.outcome, OUTCOME.EXACT);
    for (const [field, source] of [["geometryA", geometryA], ["geometryB", geometryB]]) {
      if (!source) { assert.equal(result.state[field], undefined); continue; }
      const ring = result.state[field].ring;
      assert.equal(ring.length, source.ring.length);
      ring.forEach((v, i) => {
        assert.ok(Math.abs(v.lat - source.ring[i].lat) <= 5e-7 + 1e-12, "lat within half a 6-decimal step");
        assert.ok(Math.abs(v.lon - source.ring[i].lon) <= 5e-7 + 1e-12, "lon within half a 6-decimal step");
        assert.equal(v.lat, Number(source.ring[i].lat.toFixed(6)), "vertex i is vertex i, rounded and nothing else");
      });
    }
    // The circles stay in the link too, so a polygon lens keeps its circle state.
    assert.deepEqual(result.state.lensA, lensA);
    assert.deepEqual(result.state.lensB, lensB);
    assert.equal(result.state.activeLens, "B");
  });
}

test("serialization with polygons is canonical", () => {
  const state = { ...base, geometryA: polygon(RING_A), geometryB: polygon(RING_B) };
  assert.equal(serializeEvidenceState(state), serializeEvidenceState({ ...state }));
});

test("over-budget polygons are never silently dropped: gx names the omitted side", () => {
  const n = POLYGON_LINK_LIMITS.maxVertices + 1;
  const big = Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    return { lat: 40.41 + 0.01 * Math.sin(t), lon: -3.70 + 0.01 * Math.cos(t) };
  });
  const state = { ...base, geometryA: polygon(big), geometryB: polygon(RING_B) };
  const status = polygonLinkStatus(state);
  assert.equal(status.encodable, false);
  assert.equal(status.reason, "VERTEX_LIMIT");
  const query = serializeEvidenceState(state);
  assert.doesNotMatch(query, /(^|&)(ga|gb)=/, "all-or-nothing: the small polygon is not carried alone");
  assert.match(query, /(^|&)gx=AB(&|$)/);
  const result = parseEvidenceState(query);
  assert.equal(result.outcome, OUTCOME.PARTIAL);
  assert.ok(result.issues.some((i) => i.code === REASON.GEOMETRY_NOT_IN_LINK && i.raw === "AB"));
  assert.equal(result.state.geometryA, undefined);
});

test("the query-length budget is enforced on the exact query, not only the vertex cap", () => {
  const ring = (cx) => Array.from({ length: POLYGON_LINK_LIMITS.maxVertices }, (_, i) => {
    const t = (2 * Math.PI * i) / POLYGON_LINK_LIMITS.maxVertices;
    return { lat: 40.4 + 0.012345678 * Math.sin(t), lon: cx + 0.012345678 * Math.cos(t) };
  });
  const state = { ...base, geometryA: polygon(ring(-3.70)), geometryB: polygon(ring(-3.65)) };
  const status = polygonLinkStatus(state);
  const query = serializeEvidenceState(state);
  if (status.encodable) assert.ok(query.length <= POLYGON_LINK_LIMITS.maxQueryLength, `encoded ${query.length}`);
  else { assert.equal(status.reason, "LENGTH_LIMIT"); assert.match(query, /gx=AB/); assert.ok(query.length < POLYGON_LINK_LIMITS.maxQueryLength); }
});

test("a polygon pair within budget keeps the whole query inside the limit", () => {
  const state = { ...base, geometryA: polygon(RING_A), geometryB: polygon(RING_B) };
  assert.ok(serializeEvidenceState(state).length <= POLYGON_LINK_LIMITS.maxQueryLength);
});

test("corrupt polygon values degrade only their own dimension, with a reason", () => {
  const good = serializeEvidenceState({ ...base, geometryB: polygon(RING_B) });
  const cases = {
    twoVertices: "40.41,-3.70;40.42,-3.71",
    outOfBounds: "40.41,-3.70;40.42,-3.71;51.50,-0.12",
    nonNumeric: "40.41,-3.70;abc,-3.71;40.43,-3.72",
    missingLon: "40.41,-3.70;40.42;40.43,-3.72",
    duplicates: "40.41,-3.70;40.41,-3.70;40.41,-3.70",
    empty: "",
  };
  for (const [name, raw] of Object.entries(cases)) {
    const query = good.replace(/(^|&)gb=[^&]*/, `$1ga=${encodeURIComponent(raw)}`);
    const result = parseEvidenceState(query);
    assert.equal(result.outcome, OUTCOME.PARTIAL, name);
    assert.ok(result.issues.some((i) => i.dimension === "geometryA" && i.code === REASON.INVALID_GEOMETRY), name);
    assert.equal(result.state.geometryA, undefined, `${name}: no silent fallback geometry`);
    assert.deepEqual(result.state.lensA, lensA, `${name}: other dimensions intact`);
  }
});

// ------------------------------------------------------------------ session

for (const [name, geomA, geomB] of [
  ["circle–circle", circleGeometry(lensA), circleGeometry(lensB)],
  ["circle–polygon", circleGeometry(lensA), polygon(RING_B)],
  ["polygon–circle", polygon(RING_A), circleGeometry(lensB)],
  ["polygon–polygon", polygon(RING_A), polygon(RING_B)],
]) {
  test(`session round-trip ${name}: lossless geometry and active lens`, () => {
    const file = sessionFor(geomA, geomB);
    const text = JSON.stringify(file); // through real JSON, as a download would
    const result = parseSessionFile(text, { snapshotId: "snap-1", createPolygon: createPolygonGeometry });
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.equal(result.outcome, OUTCOME.EXACT);
    assert.deepEqual(result.geometries.A, geomA, "A geometry equal, full precision");
    assert.deepEqual(result.geometries.B, geomB, "B geometry equal, full precision");
    assert.equal(result.state.activeLens, "B");
    assert.equal(result.state.mode, "COMPARE");
    assert.deepEqual(result.state.lensA, lensA);
    assert.deepEqual(result.state.lensB, lensB);
    assert.equal(result.snapshot.status, "MATCH");
    assert.equal(geometryFingerprint(result.geometries), file.geometry_fingerprint);
  });
}

test("a restored polygon gives the same membership as the original", () => {
  const original = createPolygonGeometry(RING_A);
  const restored = createPolygonGeometry(parse(sessionFor(polygon(RING_A), circleGeometry(lensB))).geometries.A.ring);
  for (const p of [{ lat: 40.4115, lon: -3.7005 }, { lat: 40.4300, lon: -3.7000 }, { lat: 40.4100, lon: -3.6990 }]) {
    assert.equal(geometryContainsPoint(restored, p), geometryContainsPoint(original, p));
  }
});

test("a polygon lens keeps its hidden circle, and is not replaced by it", () => {
  const result = parse(sessionFor(polygon(RING_A), circleGeometry(lensB)));
  assert.equal(result.state.geometryA.kind, "POLYGON");
  assert.equal(result.state.geometryB, undefined, "a circle side carries no polygon");
  assert.deepEqual(result.state.lensA, lensA);
});

test("the session vertex limit is explicit", () => {
  const ring = Array.from({ length: SESSION_LIMITS.maxVertices + 1 }, (_, i) => ({ lat: 40.4 + i * 1e-6, lon: -3.7 + (i % 7) * 1e-6 }));
  const result = parse(sessionFor(polygon(ring), circleGeometry(lensB)));
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, REASON.INVALID_GEOMETRY);
});

test("refusals: not JSON, wrong schema, wrong version, oversized, structure", () => {
  const opts = { snapshotId: "snap-1", createPolygon: createPolygonGeometry };
  const file = sessionFor(polygon(RING_A), polygon(RING_B));
  const code = (text) => parseSessionFile(text, opts).issues[0].code;
  assert.equal(code("{not json"), REASON.SESSION_NOT_JSON);
  assert.equal(code("null"), REASON.SESSION_SCHEMA);
  assert.equal(code(JSON.stringify({ ...file, schema: "other" })), REASON.SESSION_SCHEMA);
  assert.equal(code(JSON.stringify({ ...file, version: 2 })), REASON.SESSION_VERSION);
  assert.equal(code("x".repeat(SESSION_LIMITS.maxChars + 1)), REASON.SESSION_TOO_LARGE);
  assert.equal(code(JSON.stringify({ ...file, state: null })), REASON.SESSION_STRUCTURE);
  assert.equal(parseSessionFile(undefined, opts).issues[0].code, REASON.SESSION_NOT_JSON);
  for (const bad of ["{not json", "null", "[]", "42"]) assert.equal(parseSessionFile(bad, opts).ok, false);
});

test("refusals: incomplete or invalid core state", () => {
  const mutate = (fn) => { const f = clone(sessionFor(polygon(RING_A), polygon(RING_B))); fn(f); return parse(f); };
  const refuses = (r, code) => { assert.equal(r.ok, false); assert.equal(r.state, null); assert.equal(r.issues[0].code, code); };
  refuses(mutate((f) => { delete f.geometries.B; }), REASON.INVALID_GEOMETRY);
  refuses(mutate((f) => { f.geometries.A.ring = f.geometries.A.ring.slice(0, 2); }), REASON.INVALID_GEOMETRY);
  refuses(mutate((f) => { f.geometries.A.ring[0].lat = "40.4"; }), REASON.INVALID_GEOMETRY);
  refuses(mutate((f) => { f.geometries.A.ring[0].lat = 51.5; }), REASON.INVALID_GEOMETRY);
  refuses(mutate((f) => { f.geometries.A.ring[0].lat = null; }), REASON.INVALID_GEOMETRY);
  refuses(mutate((f) => { f.geometries.A.kind = "MULTIPOLYGON"; }), REASON.INVALID_GEOMETRY);
  refuses(mutate((f) => { f.state.lensA.radiusM = 125; }), REASON.INVALID_COORDINATES);
  refuses(mutate((f) => { f.state.lensB.lat = 10; }), REASON.INVALID_COORDINATES);
  refuses(mutate((f) => { f.state.activeLens = "C"; }), REASON.INVALID_ACTIVE_LENS);
  refuses(mutate((f) => { f.state.mode = "CITY"; }), REASON.INVALID_MODE);
  refuses(mutate((f) => { f.state.scope = "AMBITO"; }), REASON.INVALID_SCOPE);
  refuses(mutate((f) => { f.state.lensBEnabled = "yes"; }), REASON.SESSION_STRUCTURE);
});

test("refusal: the app's own ring validator is authoritative", () => {
  const file = clone(sessionFor(polygon(RING_A), polygon(RING_B)));
  const r = parseSessionFile(JSON.stringify(file), { snapshotId: "snap-1", createPolygon: () => null });
  assert.equal(r.ok, false);
  assert.equal(r.issues[0].dimension, "geometryA");
});

test("results can never be paired with a different geometry", () => {
  const edited = clone(sessionFor(polygon(RING_A), polygon(RING_B)));
  edited.geometries.A.ring[1].lat += 1e-7; // ~1 cm
  const r = parse(edited);
  assert.equal(r.ok, false);
  assert.equal(r.issues[0].code, REASON.GEOMETRY_FINGERPRINT);

  const swapped = clone(sessionFor(polygon(RING_A), polygon(RING_B)));
  [swapped.geometries.A, swapped.geometries.B] = [swapped.geometries.B, swapped.geometries.A];
  assert.equal(parse(swapped).issues[0].code, REASON.GEOMETRY_FINGERPRINT);

  const other = clone(sessionFor(polygon(RING_A), polygon(RING_B)));
  other.readings.geometry_fingerprint = "00000000000000";
  const r2 = parse(other);
  assert.equal(r2.ok, false);
  assert.equal(r2.issues[0].dimension, "readings");

  const circles = clone(sessionFor(circleGeometry(lensA), circleGeometry(lensB)));
  circles.geometries.A.radiusM = 950;
  circles.geometry_fingerprint = geometryFingerprint({ A: circles.geometries.A, B: circles.geometries.B });
  assert.equal(parse(circles).issues[0].code, REASON.SESSION_STRUCTURE);
});

test("peripheral problems degrade to a stated PARTIAL, geometry still intact", () => {
  const file = clone(sessionFor(polygon(RING_A), polygon(RING_B)));
  file.state.layers = ["museum", "not-a-layer"];
  const r = parse(file);
  assert.equal(r.ok, true);
  assert.equal(r.outcome, OUTCOME.PARTIAL);
  assert.ok(r.issues.some((i) => i.code === REASON.UNKNOWN_LAYER));
  assert.deepEqual(r.geometries.A, polygon(RING_A));
});

test("a different deployment build is a warning, not a refusal", () => {
  const r = parse(sessionFor(polygon(RING_A), polygon(RING_B)), { snapshotId: "snap-2" });
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.status, "MISMATCH");
  assert.ok(r.issues.some((i) => i.code === REASON.SNAPSHOT_MISMATCH));
  assert.equal(r.outcome, OUTCOME.EXACT, "interface restores exactly; evidence identity is the warning axis");
});

test("result equivalence is reported separately from geometry equality", () => {
  const stored = { A: { tourism: { value: 3, status: "published" } }, B: { tourism: { value: 5, status: "published" } } };
  assert.deepEqual(compareSessionReadings(stored, clone(stored)), { equivalent: true, comparable: true, differences: [] });
  const changed = { A: { tourism: { value: 4, status: "published" } }, B: { tourism: { value: 5, status: "snapshot" } } };
  const diff = compareSessionReadings(stored, changed);
  assert.equal(diff.equivalent, false);
  assert.equal(diff.differences.length, 2);
  assert.equal(compareSessionReadings(null, stored).comparable, false);
  const unavailable = { A: { tourism: { value: null, status: "unavailable" } }, B: stored.B };
  assert.equal(compareSessionReadings(stored, unavailable).equivalent, false, "unavailable is not zero");
});

test("the file records provenance, units and limitations", () => {
  const file = sessionFor(polygon(RING_A), circleGeometry(lensB));
  assert.equal(file.snapshot_id, "snap-1");
  assert.deepEqual(file.evidence, [{ surface: "tourism" }]);
  assert.deepEqual(file.limitations, ["L1"]);
  assert.match(file.units.coordinates, /EPSG:4326/);
  assert.equal(file.state.scope, "LENS");
});

test("the app's circle factory output is a valid session circle", () => {
  const g = createCircleGeometry({ lat: lensA.lat, lon: lensA.lon }, lensA.radiusM);
  const file = sessionFor({ kind: g.kind, center: { ...g.center }, radiusM: g.radiusM }, circleGeometry(lensB));
  assert.equal(parse(file).ok, true);
});
