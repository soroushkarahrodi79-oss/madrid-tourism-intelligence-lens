// Canonical Madrid administrative geography: point-in-polygon foundation.
//
// A small, pure, dependency-free mechanism that answers, for a coordinate:
//   - which barrio contains it?
//   - which district contains it?
//   - is it inside the municipality?
//
// It reads the canonical artifact data/geography/madrid_admin.geojson, produced
// by scripts/build_madrid_geography.py. This is the reusable join/containment
// layer future code will build on (Lens centre -> barrio/district, POI -> barrio,
// accommodation -> barrio, and so on). It deliberately does NOT touch the Lens UI
// or any analytical metric: administrative containment is kept separate from the
// circle-derived measurements the Lens reports.
//
// Coordinate order is GeoJSON order: longitude first, then latitude. Every
// function documents this explicitly because Leaflet uses the opposite (lat, lng)
// order, and mixing them is the easy bug to make when this is wired into the app.
//
// The module is written as an ES module so it can be unit-tested directly under
// `node --test`. `createGeographyIndex` is pure (geometry in, lookups out); the
// browser loader is a thin fetch wrapper around it.

// Even-odd ray casting for a single linear ring. Deterministic: the same point
// and ring always give the same answer. The half-open edge convention
// (`(yi > y) !== (yj > y)`) assigns a point lying exactly on a shared boundary to
// exactly one of the two adjacent polygons, never to both and never to neither,
// so a boundary coordinate has a single, deterministic containing area.
export function pointInRing(lon, lat, ring) {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// One GeoJSON Polygon: [exterior, hole, hole, ...]. Inside means inside the
// exterior ring and outside every hole.
export function pointInPolygonRings(lon, lat, polygon) {
  if (!pointInRing(lon, lat, polygon[0])) return false;
  for (let h = 1; h < polygon.length; h += 1) {
    if (pointInRing(lon, lat, polygon[h])) return false;
  }
  return true;
}

// A GeoJSON Polygon or MultiPolygon geometry.
export function pointInGeometry(lon, lat, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") {
    return pointInPolygonRings(lon, lat, geometry.coordinates);
  }
  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates) {
      if (pointInPolygonRings(lon, lat, polygon)) return true;
    }
    return false;
  }
  return false;
}

function boundingBox(geometry) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const walk = (coords) => {
    if (typeof coords[0] === "number") {
      const [lon, lat] = coords;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const child of coords) walk(child);
  };
  walk(geometry.coordinates);
  return { minLon, minLat, maxLon, maxLat };
}

function outsideBox(lon, lat, box) {
  return lon < box.minLon || lon > box.maxLon || lat < box.minLat || lat > box.maxLat;
}

/**
 * Build a containment index over the canonical geography FeatureCollection.
 *
 * Pure: no I/O, no globals. Returns lookups that take (lon, lat) in GeoJSON
 * order and return the matching feature's normalized properties, or null when no
 * official area contains the point (for example a coordinate outside Madrid).
 */
export function createGeographyIndex(featureCollection) {
  const features = (featureCollection && featureCollection.features) || [];
  const byLevel = { municipality: [], district: [], barrio: [] };

  for (const feature of features) {
    const level = feature.properties && feature.properties.geography_level;
    if (!byLevel[level]) continue;
    byLevel[level].push({
      properties: feature.properties,
      geometry: feature.geometry,
      box: boundingBox(feature.geometry),
    });
  }

  // Deterministic order so the first match for a boundary point is stable.
  for (const level of Object.keys(byLevel)) {
    byLevel[level].sort((a, b) =>
      String(a.properties.official_id).localeCompare(String(b.properties.official_id))
    );
  }

  const findAt = (level, lon, lat) => {
    for (const entry of byLevel[level]) {
      if (outsideBox(lon, lat, entry.box)) continue;
      if (pointInGeometry(lon, lat, entry.geometry)) return entry.properties;
    }
    return null;
  };

  return {
    counts: {
      municipality: byLevel.municipality.length,
      district: byLevel.district.length,
      barrio: byLevel.barrio.length,
    },

    // Which district contains (lon, lat)? Null when none does.
    districtAt(lon, lat) {
      return findAt("district", lon, lat);
    },

    // Which barrio contains (lon, lat)? Null when none does. The returned
    // properties carry parent_id / parent_name, so the district is available
    // without a second lookup.
    barrioAt(lon, lat) {
      return findAt("barrio", lon, lat);
    },

    // Is (lon, lat) inside the municipality of Madrid?
    municipalityContains(lon, lat) {
      return findAt("municipality", lon, lat) !== null;
    },

    // One call returning the full containment for a coordinate.
    locate(lon, lat) {
      const barrio = findAt("barrio", lon, lat);
      const district = findAt("district", lon, lat);
      return {
        inside_municipality: findAt("municipality", lon, lat) !== null,
        district,
        barrio,
      };
    },
  };
}

// Browser convenience: fetch the canonical artifact and build the index. Kept
// separate from the pure core so tests never need the network. Only defined for
// environments that have fetch.
export async function loadGeographyIndex(url = "data/geography/madrid_admin.geojson") {
  if (typeof fetch !== "function") {
    throw new Error("loadGeographyIndex requires fetch; pass data to createGeographyIndex instead");
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`geography: failed to load ${url} (${response.status})`);
  return createGeographyIndex(await response.json());
}
