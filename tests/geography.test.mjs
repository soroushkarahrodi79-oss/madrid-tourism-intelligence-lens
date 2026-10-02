// Canonical Madrid administrative geography: contract and point-in-polygon tests.
//
// These run against the committed artifact data/geography/madrid_admin.geojson,
// so a bad regeneration (wrong counts, broken hierarchy, a projection leak, a
// dropped DERIVED flag) fails here on every push, on both Windows and Ubuntu.
// They need no network.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  createGeographyIndex,
  pointInGeometry,
  pointInRing,
} from "../js/geography.js";

function readJson(relative) {
  return JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), "utf8"));
}

const GEO = readJson("../data/geography/madrid_admin.geojson");
const META = readJson("../data/geography/madrid_admin.meta.json");

const byLevel = (level) => GEO.features.filter((f) => f.properties.geography_level === level);
const MUNICIPALITY = byLevel("municipality");
const DISTRICTS = byLevel("district");
const BARRIOS = byLevel("barrio");

// Generous Madrid box; only catches null-island, swapped lat/lon or a projection
// leak, never asserts an administrative boundary.
const BOX = { lonMin: -4.6, lonMax: -3.0, latMin: 39.8, latMax: 41.2 };

function* coords(geometry) {
  const stack = [geometry.coordinates];
  while (stack.length) {
    const item = stack.pop();
    if (item.length && typeof item[0] === "number") yield item;
    else for (const child of item) stack.push(child);
  }
}

// A point guaranteed to be inside the feature: the first ring's average usually
// works; fall back to a grid scan over the bounding box for concave shapes.
function interiorPoint(feature) {
  const g = feature.geometry;
  const ring = (g.type === "Polygon" ? g.coordinates : g.coordinates[0])[0];
  let sx = 0;
  let sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  const avg = [sx / ring.length, sy / ring.length];
  if (pointInGeometry(avg[0], avg[1], g)) return avg;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [x, y] of coords(g)) {
    minLon = Math.min(minLon, x);
    maxLon = Math.max(maxLon, x);
    minLat = Math.min(minLat, y);
    maxLat = Math.max(maxLat, y);
  }
  const N = 25;
  for (let i = 1; i < N; i += 1) {
    for (let j = 1; j < N; j += 1) {
      const x = minLon + ((maxLon - minLon) * i) / N;
      const y = minLat + ((maxLat - minLat) * j) / N;
      if (pointInGeometry(x, y, g)) return [x, y];
    }
  }
  throw new Error(`no interior point found for ${feature.properties.official_id}`);
}

// ---------------------------------------------------------------- counts

test("the geography holds exactly the official administrative division", () => {
  assert.equal(MUNICIPALITY.length, 1, "one municipality");
  assert.equal(DISTRICTS.length, 21, "21 districts");
  assert.equal(BARRIOS.length, 131, "131 barrios");
  assert.equal(GEO.type, "FeatureCollection");
});

// ---------------------------------------------------------------- identifiers

test("official identifiers are unique per level and never empty", () => {
  for (const level of [DISTRICTS, BARRIOS, MUNICIPALITY]) {
    const ids = level.map((f) => f.properties.official_id);
    assert.ok(ids.every((id) => typeof id === "string" && id.length > 0), "no empty ids");
    assert.equal(new Set(ids).size, ids.length, "ids unique within the level");
  }
});

test("names are present and source-derived, not blanked by normalisation", () => {
  for (const f of GEO.features) {
    assert.ok(
      typeof f.properties.official_name === "string" && f.properties.official_name.trim().length > 0,
      `${f.properties.geography_level} ${f.properties.official_id} must have a name`
    );
  }
  // A spot-check that the real official names survived (not renamed to codes).
  const centro = DISTRICTS.find((d) => d.properties.official_id === "01");
  assert.equal(centro.properties.official_name, "Centro");
});

// ---------------------------------------------------------------- hierarchy

test("every barrio belongs to exactly one known district; districts belong to the municipality", () => {
  const districtIds = new Set(DISTRICTS.map((d) => d.properties.official_id));
  const muniId = MUNICIPALITY[0].properties.official_id;

  for (const b of BARRIOS) {
    assert.ok(
      districtIds.has(b.properties.parent_id),
      `barrio ${b.properties.official_id} references unknown district ${b.properties.parent_id}`
    );
    // The official 3-digit barrio code is prefixed by its parent district code.
    assert.ok(
      b.properties.official_id.startsWith(b.properties.parent_id),
      `barrio ${b.properties.official_id} code is not prefixed by district ${b.properties.parent_id}`
    );
  }
  for (const d of DISTRICTS) {
    assert.equal(d.properties.parent_id, muniId, `district ${d.properties.official_id} parent must be the municipality`);
  }
  assert.equal(MUNICIPALITY[0].properties.parent_id, null, "the municipality has no parent in this scale");
});

// ---------------------------------------------------------------- geometry

test("geometries are valid polygons with plausible Madrid coordinates", () => {
  for (const f of GEO.features) {
    const g = f.geometry;
    assert.ok(g && (g.type === "Polygon" || g.type === "MultiPolygon"), "polygonal geometry");
    let count = 0;
    for (const [lon, lat] of coords(g)) {
      count += 1;
      assert.ok(Number.isFinite(lon) && Number.isFinite(lat), "finite coordinates");
      assert.ok(
        lon >= BOX.lonMin && lon <= BOX.lonMax && lat >= BOX.latMin && lat <= BOX.latMax,
        `${f.properties.official_id} has an out-of-range coordinate (${lon}, ${lat})`
      );
    }
    assert.ok(count >= 4, "a ring needs at least four coordinates");
  }
});

test("the municipality boundary is flagged as derived, and the districts are official", () => {
  assert.equal(MUNICIPALITY[0].properties.geometry_provenance, "DERIVED_FROM_OFFICIAL_GEOMETRY");
  for (const d of DISTRICTS) assert.equal(d.properties.geometry_provenance, "OFFICIAL_GEOMETRY");
  for (const b of BARRIOS) assert.equal(b.properties.geometry_provenance, "OFFICIAL_GEOMETRY");
});

// ---------------------------------------------------------------- determinism

test("features are emitted in a deterministic order", () => {
  const order = { municipality: 0, district: 1, barrio: 2 };
  let prevLevel = -1;
  for (const f of GEO.features) {
    const lvl = order[f.properties.geography_level];
    assert.ok(lvl >= prevLevel, "levels appear grouped: municipality, districts, barrios");
    prevLevel = Math.max(prevLevel, lvl);
  }
  const dIds = DISTRICTS.map((d) => d.properties.official_id);
  assert.deepEqual(dIds, [...dIds].sort(), "districts are sorted by official_id");
  const bIds = BARRIOS.map((b) => b.properties.official_id);
  assert.deepEqual(bIds, [...bIds].sort(), "barrios are sorted by official_id");
});

// ---------------------------------------------------------------- point-in-polygon

test("known Madrid landmarks resolve to the correct district and barrio", () => {
  const index = createGeographyIndex(GEO);
  assert.deepEqual(index.counts, { municipality: 1, district: 21, barrio: 131 });

  const cases = [
    { name: "Puerta del Sol", lon: -3.7038, lat: 40.4168, district: "01", barrio: "016" },
    { name: "Santiago Bernabeu", lon: -3.6883, lat: 40.4531, district: "05" },
    { name: "Retiro park centre", lon: -3.6825, lat: 40.4153, district: "03" },
    { name: "Barajas airport T4", lon: -3.5935, lat: 40.4936, district: "21" },
  ];
  for (const c of cases) {
    const located = index.locate(c.lon, c.lat);
    assert.ok(located.inside_municipality, `${c.name} must be inside Madrid`);
    assert.equal(located.district.official_id, c.district, `${c.name} district`);
    if (c.barrio) assert.equal(located.barrio.official_id, c.barrio, `${c.name} barrio`);
    // The barrio's parent must be the containing district: the two layers agree.
    assert.equal(located.barrio.parent_id, located.district.official_id);
  }
});

test("a point outside Madrid returns no administrative assignment", () => {
  const index = createGeographyIndex(GEO);
  for (const [name, lon, lat] of [
    ["Toledo", -4.0273, 39.8628],
    ["null island", 0, 0],
    ["far north", -3.7, 41.1],
  ]) {
    const located = index.locate(lon, lat);
    assert.equal(located.inside_municipality, false, `${name} must be outside the municipality`);
    assert.equal(located.district, null, `${name} district must be null`);
    assert.equal(located.barrio, null, `${name} barrio must be null`);
  }
});

test("whole-circle Madrid AOI eligibility tests boundary segments conservatively", () => {
  const index = createGeographyIndex(GEO);
  assert.equal(index.municipalityContainsCircle(-3.7038, 40.4168, 100).eligible, true);
  assert.equal(index.municipalityContainsCircle(-3.887, 40.35, 100).state, "outside");
  assert.equal(index.municipalityContains(-3.7, 40.5), true);
  assert.equal(index.municipalityContainsCircle(-3.7, 40.5, 5000).eligible, false);
  assert.equal(index.municipalityContainsCircle(-3.58, 40.35, 100).eligible, true);
  assert.equal(index.municipalityContainsCircle(-3.58, 40.35, 1388).eligible, false);
  assert.equal(index.municipalityContainsCircle(-3.58, 40.35, 1300).eligible, true);
});

test("whole-circle AOI uses the municipality exterior, not internal district seams", () => {
  const index = createGeographyIndex(GEO);
  const municipality = MUNICIPALITY[0].geometry;

  // The official municipality is the union of all 21 official districts. Its
  // canonical geometry is one exterior ring; district edges must not become
  // false municipal edges in the circle-clearance index.
  assert.equal(municipality.type, "Polygon");
  assert.equal(municipality.coordinates.length, 1);
  assert.equal(DISTRICTS.length, 21);
  assert.equal(META.municipality_geometry.how, "shapely unary_union of the 21 official district polygons. The service's TERMINO MUNICIPAL layer is a polyline, so no published municipality polygon exists to use directly.");

  // This point lies on the actual Centro / Arganzuela shared district edge.
  // A 250 m circle around it crosses that internal seam but remains well
  // inside Madrid, so it must remain eligible.
  const seamCircle = index.municipalityContainsCircle(-3.693086, 40.40745775, 250);
  assert.equal(index.districtAt(-3.693086, 40.40745775).official_id, "02");
  assert.equal(seamCircle.state, "inside");
  assert.equal(seamCircle.eligible, true);
  assert.ok(seamCircle.conservativeClearanceM > 252);

  // A circle wholly inside the centre and one whose centre remains inside but
  // whose edge crosses Madrid's exterior exercise opposite sides of the rule.
  assert.equal(index.municipalityContainsCircle(-3.7038, 40.4168, 100).eligible, true);
  assert.equal(index.municipalityContainsCircle(-3.7, 40.5, 5000).eligible, false);
  assert.equal(index.municipalityContainsCircle(-3.887, 40.35, 100).state, "outside");

  // This 1.3 km circle is clear; at 1.388 km the boundary is within the 2 m
  // conservative guard band and the result abstains.
  assert.equal(index.municipalityContainsCircle(-3.58, 40.35, 1300).eligible, true);
  const guardBand = index.municipalityContainsCircle(-3.58, 40.35, 1388);
  assert.equal(guardBand.eligible, false);
  assert.equal(guardBand.state, "crosses");
});

test("point-in-polygon is deterministic for a given point", () => {
  const index = createGeographyIndex(GEO);
  const a = index.locate(-3.7038, 40.4168);
  const b = index.locate(-3.7038, 40.4168);
  assert.deepEqual(a, b);
});

test("every barrio's interior point maps back to that barrio and its parent district", () => {
  // This checks the attribute hierarchy against the geometry: a point inside a
  // barrio must resolve to that same barrio and to its declared parent district.
  const index = createGeographyIndex(GEO);
  for (const barrio of BARRIOS) {
    const [lon, lat] = interiorPoint(barrio);
    const located = index.locate(lon, lat);
    assert.equal(located.barrio.official_id, barrio.properties.official_id);
    assert.equal(located.district.official_id, barrio.properties.parent_id);
  }
});

test("a point on a shared boundary is assigned deterministically to exactly one area", () => {
  // Two districts sharing the edge x = 1. This documents and locks the actual
  // assignment convention rather than relying on a claim about ray casting:
  //   - the index sorts by official_id and returns the FIRST matching feature;
  //   - the half-open ray-cast edge rule (`(yi > lat) !== (yj > lat)`) keeps a
  //     boundary point from matching both polygons.
  // The contract is purely that the SAME boundary coordinate always yields the
  // SAME documented result. It is a technical assignment convention only, and
  // makes no claim that a real-world boundary point belongs more strongly to
  // either side.
  const ring = (pts) => pts.concat([pts[0]]);
  const fc = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { geography_level: "district", official_id: "01", official_name: "West", parent_id: "28079" },
        geometry: { type: "Polygon", coordinates: [ring([[0, 0], [1, 0], [1, 1], [0, 1]])] },
      },
      {
        type: "Feature",
        properties: { geography_level: "district", official_id: "02", official_name: "East", parent_id: "28079" },
        geometry: { type: "Polygon", coordinates: [ring([[1, 0], [2, 0], [2, 1], [1, 1]])] },
      },
    ],
  };
  const index = createGeographyIndex(fc);

  // A point exactly on the shared edge resolves to exactly one district, and the
  // choice is stable across repeated calls.
  const onBoundary = index.districtAt(1, 0.5);
  const again = index.districtAt(1, 0.5);
  assert.ok(onBoundary, "a boundary point must resolve to one district, never neither");
  assert.equal(onBoundary.official_id, again.official_id, "the assignment must be deterministic");

  // With this data and the half-open rule the shared edge belongs to the east
  // polygon (its left edge counts; the west polygon's right edge does not). This
  // asserts the concrete mechanism relied upon, not a general PIP guarantee.
  assert.equal(onBoundary.official_id, "02");

  // Interior points are unambiguous.
  assert.equal(index.districtAt(0.5, 0.5).official_id, "01");
  assert.equal(index.districtAt(1.5, 0.5).official_id, "02");
});

test("pointInRing and pointInGeometry agree on a simple square", () => {
  const square = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ];
  assert.equal(pointInRing(0.5, 0.5, square), true);
  assert.equal(pointInRing(1.5, 0.5, square), false);
  assert.equal(
    pointInGeometry(0.5, 0.5, { type: "Polygon", coordinates: [square] }),
    true
  );
  // A hole makes the centre fall outside.
  const hole = [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.75, 0.75],
    [0.25, 0.75],
    [0.25, 0.25],
  ];
  assert.equal(
    pointInGeometry(0.5, 0.5, { type: "Polygon", coordinates: [square, hole] }),
    false
  );
});

// ---------------------------------------------------------------- provenance metadata

test("published version, catalogue date and build time are three separate concepts", () => {
  // The corrected model: the authority publishes a dataset VERSION, not an
  // effective date. The catalogue metadata-modified date is not a geometry
  // vintage, and the build time is neither. All three are distinct fields so a
  // future join can state "Padron period X joined to barrio geography v3.4.1".
  const sv = META.source_version;
  assert.ok(sv, "meta must carry source_version");
  assert.equal(sv.published_version_exposed, true);
  assert.equal(sv.geometry_effective_date_exposed, false);

  assert.equal(sv.datasets.district.published_version, "v3.2.1");
  assert.equal(sv.datasets.barrio.published_version, "v3.4.1");

  const catalogDate = sv.datasets.barrio.catalog_metadata_modified;
  assert.match(catalogDate, /^\d{4}-\d{2}-\d{2}$/, "catalogue date is a date");
  assert.match(META.retrieved_at, /^\d{4}-\d{2}-\d{2}T/, "retrieved_at is a timestamp");
  assert.notEqual(META.retrieved_at, catalogDate, "the build time is not the catalogue date");
  assert.notEqual(sv.datasets.barrio.published_version, catalogDate, "the version is not a date");

  // The note must warn against reading the catalogue date as a geometry vintage.
  assert.match(sv.note, /NOT the geometry's edition or effective date/i);
  // The old, too-strong field must be gone.
  assert.equal(META.source_vintage, undefined, "source_vintage was replaced by source_version");
});

test("the metadata documents the source, licence, CRS and derivation method", () => {
  assert.match(META.source.authority, /Ayuntamiento de Madrid/);
  assert.equal(META.source.license, "CC BY 4.0");
  assert.match(META.coordinate_reference_system.source, /25830/);
  assert.match(META.coordinate_reference_system.output, /4326|WGS84/);
  assert.equal(META.municipality_geometry.method, "DERIVED_FROM_OFFICIAL_GEOMETRY");
  assert.equal(META.municipality_geometry.ine_municipal_code, "28079");
  // The union of the districts must be coherent (they tile the municipality).
  assert.ok(META.municipality_geometry.union_coherence.relative_difference < 1e-6);
  assert.match(META.interpretation_ceiling, /never be spatially distributed/i);
});
