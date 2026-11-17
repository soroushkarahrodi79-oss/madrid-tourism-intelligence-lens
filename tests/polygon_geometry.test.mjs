// Pure polygon analysis geometry (#187 Phase 3).
//
// WHAT THESE TESTS DEFEND. A custom polygon is only worth having if membership is
// EXACT. The tempting shortcuts — test the bounding box, test an enclosing
// circle, test distance from the centroid — are all cheaper and all wrong for any
// polygon that is not convex and roughly round. Each is refuted here with a
// concrete point that the shortcut gets wrong and the implementation gets right.
//
// They also pin the boundary convention (stated, not assumed), parity with the
// administrative geometry's own ring test, and that area is computed on the
// sphere rather than by a shoelace over raw degrees.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { pointInRing } from "../js/geography.js";

const require = createRequire(import.meta.url);
const lens = require("../js/lens.js");
const {
  ANALYSIS_GEOMETRY, POLYGON_MIN_VERTICES, normalizePolygonRing,
  createCircleGeometry, createPolygonGeometry, pointInPolygonRing,
  geometryContainsPoint, polygonPerimeterM, polygonAreaKm2,
  polygonReferencePoint, geometryAreaKm2, geometryReferencePoint,
  geometriesOverlap,
  poiStatsInGeometry, pedestrianStatsInGeometry, poiStatsInLens, haversineMeters,
} = lens;

const MADRID_LAT = 40.4149;
const MADRID_LON = -3.69;

// A deliberately CONCAVE ring: a square with a deep notch bitten out of its east
// side, so the notch interior is inside the bounding box but outside the polygon.
//   (0,0) ── (10,0)
//     │        │
//     │     (5,5)  <- notch apex, pulled west
//     │        │
//   (0,10) ─ (10,10)       (units are 0.01° steps from the Madrid anchor)
const STEP = 0.01;
const atStep = (x, y) => ({ lat: MADRID_LAT + y * STEP, lon: MADRID_LON + x * STEP });
const CONCAVE = [atStep(0, 0), atStep(10, 0), atStep(5, 5), atStep(10, 10), atStep(0, 10)];

test("a polygon geometry is only built from a ring that can enclose area", () => {
  assert.equal(POLYGON_MIN_VERTICES, 3);
  assert.equal(createPolygonGeometry([]), null);
  assert.equal(createPolygonGeometry([atStep(0, 0), atStep(1, 1)]), null, "two vertices enclose nothing");
  assert.equal(createPolygonGeometry(null), null);
  // Three identical or collinear-by-duplication points are not an area.
  assert.equal(createPolygonGeometry([atStep(0, 0), atStep(0, 0), atStep(0, 0)]), null);
  // A non-finite vertex is dropped, not coerced to 0 — which would place a
  // vertex off the coast of Africa.
  assert.equal(createPolygonGeometry([atStep(0, 0), atStep(1, 0), { lat: NaN, lon: 1 }]), null);
  const triangle = createPolygonGeometry([atStep(0, 0), atStep(2, 0), atStep(0, 2)]);
  assert.equal(triangle.kind, ANALYSIS_GEOMETRY.POLYGON);
  assert.equal(triangle.ring.length, 3);
  // An explicitly repeated closing vertex does not become a zero-length edge.
  const closed = createPolygonGeometry([atStep(0, 0), atStep(2, 0), atStep(0, 2), atStep(0, 0)]);
  assert.equal(closed.ring.length, 3);
  assert.equal(normalizePolygonRing([atStep(0, 0), atStep(2, 0), atStep(0, 2), atStep(0, 0)]).length, 3);
});

test("membership is exact: a bounding box, an enclosing circle and a centroid radius all get it wrong", () => {
  const polygon = createPolygonGeometry(CONCAVE);
  // A point deep inside the notch: inside the bounding box, outside the polygon.
  const inNotch = atStep(8, 5);
  assert.equal(geometryContainsPoint(polygon, inNotch), false, "the notch interior is outside the polygon");
  // ...and the bounding box would have said yes.
  const lats = CONCAVE.map((v) => v.lat); const lons = CONCAVE.map((v) => v.lon);
  const inBox = inNotch.lat >= Math.min(...lats) && inNotch.lat <= Math.max(...lats)
    && inNotch.lon >= Math.min(...lons) && inNotch.lon <= Math.max(...lons);
  assert.equal(inBox, true, "the bounding box wrongly includes it — which is why it is not used");
  // ...and so would an enclosing circle about the vertex average.
  const reference = polygonReferencePoint(polygon.ring);
  const enclosingRadiusM = Math.max(...polygon.ring.map((v) => haversineMeters(reference, v)));
  assert.ok(haversineMeters(reference, inNotch) <= enclosingRadiusM,
    "the enclosing circle wrongly includes it — which is why it is not used");
  // A point in the solid west half is inside, and the shortcuts happen to agree
  // there; agreement on easy points is exactly what makes the shortcuts tempting.
  assert.equal(geometryContainsPoint(polygon, atStep(2, 5)), true);
});

test("the boundary convention is half-open and deterministic, and is stated rather than assumed", () => {
  // An axis-aligned square, so edges are easy to sit exactly on.
  const square = createPolygonGeometry([atStep(0, 0), atStep(10, 0), atStep(10, 10), atStep(0, 10)]);
  const ring = square.ring;
  const answer = (x, y) => geometryContainsPoint(square, atStep(x, y));

  // Determinism first: the property the convention exists to provide.
  for (const [x, y] of [[0, 0], [10, 0], [10, 10], [0, 10], [5, 0], [5, 10], [0, 5], [10, 5]]) {
    assert.equal(answer(x, y), answer(x, y), `(${x},${y}) must answer identically every time`);
  }
  // THE ACTUAL CONVENTION, measured rather than assumed. `yi > lat !== yj > lat`
  // opens each edge at its lower vertex and closes it at its upper one, and the
  // ray is cast eastward (`lon <` the crossing). Together those make the SOUTH
  // and WEST boundaries inclusive and the NORTH and EAST boundaries exclusive —
  // so two polygons tiled edge to edge assign a shared boundary point to exactly
  // one of them, never to both and never to neither. That is the property worth
  // having; "boundary points are inside" is NOT the rule and must not be assumed.
  assert.equal(answer(0, 5), true, "the western boundary is inclusive");
  assert.equal(answer(5, 0), true, "the southern boundary is inclusive");
  assert.equal(answer(0, 0), true, "the south-west corner is inclusive");
  assert.equal(answer(10, 5), false, "the eastern boundary is exclusive");
  assert.equal(answer(5, 10), false, "the northern boundary is exclusive");
  assert.equal(answer(10, 0), false, "the south-east corner is exclusive");
  assert.equal(answer(10, 10), false, "the north-east corner is exclusive");
  assert.equal(answer(0, 10), false, "the north-west corner is exclusive");
  // Tiling: a point on the shared edge of two abutting squares belongs to
  // exactly one of them. This is the invariant the convention exists to protect.
  const west = createPolygonGeometry([atStep(0, 0), atStep(5, 0), atStep(5, 10), atStep(0, 10)]);
  const east = createPolygonGeometry([atStep(5, 0), atStep(10, 0), atStep(10, 10), atStep(5, 10)]);
  for (const y of [1, 3, 5, 7, 9]) {
    const onShared = atStep(5, y);
    const hits = [west, east].filter((g) => geometryContainsPoint(g, onShared)).length;
    assert.equal(hits, 1, `a point on the shared edge at y=${y} belongs to exactly one tile`);
  }
  // Interior and exterior are never ambiguous.
  assert.equal(answer(5, 5), true);
  assert.equal(answer(-1, 5), false);
  assert.equal(answer(11, 5), false);
  // Winding order must not change any answer: the same ring reversed agrees.
  const reversed = createPolygonGeometry([...CONCAVE].reverse());
  const forward = createPolygonGeometry(CONCAVE);
  for (let x = -1; x <= 11; x += 1) {
    for (let y = -1; y <= 11; y += 1) {
      assert.equal(geometryContainsPoint(reversed, atStep(x, y)), geometryContainsPoint(forward, atStep(x, y)),
        `winding order must not change membership at (${x},${y})`);
    }
  }
  assert.ok(ring.length >= 3);
});

test("the ring test agrees exactly with the administrative geometry's own ring test", () => {
  // js/geography.js owns the containment rule for official areas. Two different
  // answers about an edge inside one product would be indefensible, so this is
  // the guard against the two implementations drifting apart.
  const asGeoJson = (ring) => ring.map((v) => [v.lon, v.lat]);
  for (const vertices of [CONCAVE, [atStep(0, 0), atStep(10, 0), atStep(10, 10), atStep(0, 10)]]) {
    const ring = normalizePolygonRing(vertices);
    const geoJsonRing = asGeoJson(ring);
    for (let x = -2; x <= 12; x += 0.5) {
      for (let y = -2; y <= 12; y += 0.5) {
        const { lat, lon } = atStep(x, y);
        assert.equal(
          pointInPolygonRing(lon, lat, ring),
          pointInRing(lon, lat, geoJsonRing),
          `lens.js and geography.js must agree at (${x},${y})`,
        );
      }
    }
  }
});

test("area is computed on the sphere, not by a shoelace over raw degrees", () => {
  // A square one kilometre on each side at Madrid's latitude.
  const metresPerDegLat = 111194.9;
  const latStep = 1000 / metresPerDegLat;
  const lonStep = 1000 / (metresPerDegLat * Math.cos((MADRID_LAT * Math.PI) / 180));
  const km2 = polygonAreaKm2(normalizePolygonRing([
    { lat: MADRID_LAT, lon: MADRID_LON },
    { lat: MADRID_LAT, lon: MADRID_LON + lonStep },
    { lat: MADRID_LAT + latStep, lon: MADRID_LON + lonStep },
    { lat: MADRID_LAT + latStep, lon: MADRID_LON },
  ]));
  assert.ok(Math.abs(km2 - 1) < 0.01, `a 1 km x 1 km square must measure ~1 km2, got ${km2}`);

  // THE CRS POINT. A square with EQUAL degree spans is not square on the ground:
  // a longitude degree at 40.41 N is cos(lat) of a latitude degree. A shoelace
  // over raw degrees would report the same number for both spans; the spherical
  // formula reports the cos(lat) ratio. ~0.761 at Madrid — a 24% error avoided.
  const degreeSquare = polygonAreaKm2(normalizePolygonRing([
    { lat: MADRID_LAT, lon: MADRID_LON },
    { lat: MADRID_LAT, lon: MADRID_LON + 0.01 },
    { lat: MADRID_LAT + 0.01, lon: MADRID_LON + 0.01 },
    { lat: MADRID_LAT + 0.01, lon: MADRID_LON },
  ]));
  const naiveDegreeShoelace = (0.01 * metresPerDegLat / 1000) ** 2;
  const ratio = degreeSquare / naiveDegreeShoelace;
  const expected = Math.cos((MADRID_LAT * Math.PI) / 180);
  assert.ok(Math.abs(ratio - expected) < 0.005,
    `area must shrink by cos(lat)=${expected.toFixed(4)} relative to a degree shoelace, got ${ratio.toFixed(4)}`);

  // Winding order changes the sign of the excess, never the reported magnitude.
  const ring = normalizePolygonRing(CONCAVE);
  assert.ok(Math.abs(polygonAreaKm2(ring) - polygonAreaKm2([...ring].reverse())) < 1e-9);
  // A degenerate ring measures nothing rather than zero-as-a-measurement.
  assert.equal(polygonAreaKm2([{ lat: 1, lon: 1 }]), null);
  assert.equal(polygonAreaKm2(null), null);
});

test("perimeter is the closed great-circle ring length", () => {
  const metresPerDegLat = 111194.9;
  const latStep = 1000 / metresPerDegLat;
  const lonStep = 1000 / (metresPerDegLat * Math.cos((MADRID_LAT * Math.PI) / 180));
  const perimeter = polygonPerimeterM(normalizePolygonRing([
    { lat: MADRID_LAT, lon: MADRID_LON },
    { lat: MADRID_LAT, lon: MADRID_LON + lonStep },
    { lat: MADRID_LAT + latStep, lon: MADRID_LON + lonStep },
    { lat: MADRID_LAT + latStep, lon: MADRID_LON },
  ]));
  assert.ok(Math.abs(perimeter - 4000) < 40, `a 1 km square must be ~4000 m around, got ${perimeter}`);
  // The ring closes: the last edge back to the first vertex is counted.
  const triangle = normalizePolygonRing([atStep(0, 0), atStep(10, 0), atStep(0, 10)]);
  const edges = haversineMeters(triangle[0], triangle[1]) + haversineMeters(triangle[1], triangle[2]) + haversineMeters(triangle[2], triangle[0]);
  assert.ok(Math.abs(polygonPerimeterM(triangle) - edges) < 1e-6);
  assert.equal(polygonPerimeterM([{ lat: 1, lon: 1 }]), null);
});

test("circle statistics are unchanged by routing through the shared predicate", () => {
  const points = [
    { type: "museum", lat: MADRID_LAT, lon: MADRID_LON },
    { type: "stay", lat: MADRID_LAT + 0.004, lon: MADRID_LON },
    { type: "rail", lat: MADRID_LAT + 0.05, lon: MADRID_LON },
  ];
  const viaCircle = poiStatsInLens(points, { lat: MADRID_LAT, lon: MADRID_LON }, 900);
  assert.equal(viaCircle.museum, 1);
  assert.equal(viaCircle.stay, 1);
  assert.equal(viaCircle.rail, 0, "a point 5.5 km out stays outside a 900 m circle");
  assert.equal(viaCircle.total, 2);
  assert.equal(viaCircle.nearest[0].type, "museum");
  // A point exactly on the circle's edge is included, as it always was.
  const edge = poiStatsInLens([{ type: "museum", lat: MADRID_LAT, lon: MADRID_LON }], { lat: MADRID_LAT, lon: MADRID_LON }, 900);
  assert.equal(edge.museum, 1);
  // The same statistics computed from an explicit circle geometry agree.
  assert.deepEqual(
    poiStatsInGeometry(points, createCircleGeometry({ lat: MADRID_LAT, lon: MADRID_LON }, 900)),
    viaCircle,
  );
});

test("polygon statistics count exactly the records inside the ring", () => {
  const polygon = createPolygonGeometry(CONCAVE);
  const points = [
    { type: "museum", ...atStep(2, 5) },   // solid west half: inside
    { type: "museum", ...atStep(8, 5) },   // notch: inside the bbox, outside the ring
    { type: "stay", ...atStep(1, 1) },     // inside
    { type: "rail", ...atStep(20, 20) },   // far outside
  ];
  const stats = poiStatsInGeometry(points, polygon);
  assert.equal(stats.museum, 1, "the notch museum must not be counted");
  assert.equal(stats.stay, 1);
  assert.equal(stats.rail, 0);
  assert.equal(stats.total, 2);
  // Nearest is ordered by distance FROM THE REFERENCE POINT and is reported as
  // such; it never decides membership.
  assert.equal(stats.nearest.length, 2);
  assert.ok(stats.nearest.every((p) => Number.isFinite(p.d)));
  assert.ok(stats.nearest[0].d <= stats.nearest[1].d);

  // Pedestrian sufficient statistics recombine over the same exact membership.
  const stations = [
    { ...atStep(2, 5), meanObserved: 800, observationCount: 1000, dateMin: "2024-01-01", dateMax: "2024-06-30" },
    { ...atStep(1, 1), meanObserved: 1200, observationCount: 1000, dateMin: "2024-02-01", dateMax: "2024-12-31" },
    { ...atStep(8, 5), meanObserved: 9999, observationCount: 5000, dateMin: "2024-01-01", dateMax: "2024-12-31" },
  ];
  const observed = pedestrianStatsInGeometry(stations, polygon);
  assert.equal(observed.evidence, "OBSERVED");
  assert.equal(observed.stationCount, 2, "the notch station is outside the ring");
  assert.equal(observed.observationCount, 2000);
  assert.equal(observed.meanObserved, 1000, "the weighted mean must exclude the notch station entirely");
  assert.equal(observed.dateMin, "2024-01-01");
  assert.equal(observed.dateMax, "2024-12-31");
  // An empty polygon is a real zero-membership answer, never a fabricated mean.
  const empty = pedestrianStatsInGeometry([{ ...atStep(20, 20), meanObserved: 500, observationCount: 10 }], polygon);
  assert.equal(empty.evidence, "NONE");
  assert.equal(empty.meanObserved, null);
});

test("a circle geometry takes the radius it is given and never snaps it", () => {
  // The 50 m step and the 100 m / 5 km bounds are the radius CONTROL's rule.
  // Applying them inside the geometry made membership disagree with the radius
  // the rest of the app was reporting whenever a caller held an off-step value.
  const centre = { lat: MADRID_LAT, lon: MADRID_LON };
  assert.equal(createCircleGeometry(centre, 777).radiusM, 777);
  assert.equal(createCircleGeometry(centre, 6000).radiusM, 6000);
  assert.equal(createCircleGeometry(centre, 12).radiusM, 12);
  // A point 780 m out is outside a 777 m circle; a snapped 800 m circle would
  // have wrongly included it.
  const metresPerDegLat = 111194.9;
  const point = { lat: MADRID_LAT + 780 / metresPerDegLat, lon: MADRID_LON };
  assert.equal(geometryContainsPoint(createCircleGeometry(centre, 777), point), false);
  assert.equal(geometryContainsPoint(createCircleGeometry(centre, 800), point), true);
  assert.equal(createCircleGeometry(centre, Number.NaN), null);
  assert.equal(createCircleGeometry(null, 900), null);
});

test("the geometry area and reference point dispatch correctly for both kinds", () => {
  const circle = createCircleGeometry({ lat: MADRID_LAT, lon: MADRID_LON }, 1000);
  assert.ok(Math.abs(geometryAreaKm2(circle) - Math.PI) < 1e-9, "a 1 km circle is pi km2");
  assert.deepEqual(geometryReferencePoint(circle), { lat: MADRID_LAT, lon: MADRID_LON });
  const polygon = createPolygonGeometry(CONCAVE);
  assert.equal(geometryAreaKm2(polygon), polygonAreaKm2(polygon.ring));
  assert.deepEqual(geometryReferencePoint(polygon), polygonReferencePoint(polygon.ring));
  assert.equal(geometryAreaKm2(null), null);
  assert.equal(geometryReferencePoint(null), null);
  assert.equal(geometryContainsPoint(null, { lat: 1, lon: 1 }), false);
  assert.equal(geometryContainsPoint(polygon, null), false);
  assert.equal(geometryContainsPoint({ kind: "SOMETHING_ELSE" }, { lat: 1, lon: 1 }), false,
    "an unknown geometry kind contains nothing rather than defaulting to a circle");
});

test("overlap warning distinguishes disjoint, touching and mixed windows", () => {
  const square = (x0, x1) => createPolygonGeometry([atStep(x0, 0), atStep(x1, 0), atStep(x1, 10), atStep(x0, 10)]);
  const west = square(0, 5), east = square(5, 10), far = square(20, 25);
  assert.equal(geometriesOverlap(west, east), true, "shared edge must warn");
  assert.equal(geometriesOverlap(west, far), false);
  assert.equal(geometriesOverlap(createCircleGeometry(atStep(2, 5), 100), west), true);
  assert.equal(geometriesOverlap(createCircleGeometry(atStep(12, 5), 100), west), false);
  assert.equal(geometriesOverlap(createCircleGeometry(atStep(2, 5), 100), createCircleGeometry(atStep(20, 5), 100)), false);
});

test("the module states its own refusal to substitute an approximation", () => {
  const source = fs.readFileSync(new URL("../js/lens.js", import.meta.url), "utf8");
  assert.match(source, /No bounding box, no enclosing\s*\/\/ circle/);
  assert.match(source, /half-open edge rule as the/);
});
