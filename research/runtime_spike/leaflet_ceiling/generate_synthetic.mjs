// K12 — §2 deterministic synthetic geometry generator for the Leaflet ceiling.
//
// Produces reproducible synthetic polygon and point FeatureCollections at the
// counts the issue names. Seeded PRNG (mulberry32) → byte-identical output on
// every run and every machine.
//
// LIMITATIONS (stated so no reader over-reads these as real Madrid data):
//   * Polygons are pseudo-random convex-ish blobs, NOT real cadastral parcels.
//     Real ámbitos average ~194 vertices/feature with concave topology; the
//     generator matches the AVERAGE vertex budget but not the topology, so it
//     stresses vertex throughput, not winding/hole complexity.
//   * Points are uniformly scattered in the Madrid bbox; real licences cluster
//     on the street network, which changes canvas overdraw locally.
// These harnesses exist to find an ORDER-OF-MAGNITUDE ceiling, not a precise one.

import { mulberry32 } from "../lib/measure.mjs";

// Madrid municipal bounding box (approx), WGS84.
export const MADRID_BBOX = { west: -3.889, south: 40.312, east: -3.518, north: 40.564 };

export const POLYGON_LEVELS = [765, 2000, 5675, 10000];
export const POINT_LEVELS = [11500, 25000, 50000];

// Average vertices per real ámbito, used as the synthetic polygon vertex budget.
export const REAL_AMBITO_AVG_VERTICES = Math.round(140507 / 724); // ≈ 194

export function makePolygons(count, { seed = 42, verticesPerPolygon = REAL_AMBITO_AVG_VERTICES } = {}) {
  const rnd = mulberry32(seed);
  const features = [];
  const { west, south, east, north } = MADRID_BBOX;
  for (let i = 0; i < count; i++) {
    const cx = west + rnd() * (east - west);
    const cy = south + rnd() * (north - south);
    const r = 0.0008 + rnd() * 0.0025; // ~80–350 m radius
    const n = verticesPerPolygon;
    const ring = [];
    for (let v = 0; v < n; v++) {
      const ang = (v / n) * Math.PI * 2;
      const jitter = 0.6 + rnd() * 0.8; // irregular radius → non-trivial outline
      ring.push([cx + Math.cos(ang) * r * jitter, cy + Math.sin(ang) * r * jitter]);
    }
    ring.push(ring[0]); // close
    features.push({
      type: "Feature",
      properties: { id: `syn-poly-${i}` },
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }
  return { type: "FeatureCollection", features };
}

export function makePoints(count, { seed = 7 } = {}) {
  const rnd = mulberry32(seed);
  const features = [];
  const { west, south, east, north } = MADRID_BBOX;
  for (let i = 0; i < count; i++) {
    features.push({
      type: "Feature",
      properties: { id: `syn-pt-${i}`, family: ["A", "B", "C"][i % 3] },
      geometry: {
        type: "Point",
        coordinates: [west + rnd() * (east - west), south + rnd() * (north - south)],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

// CLI: write the fixtures the device harness loads, so device and container
// measure the SAME bytes.
if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.join(here, "fixtures");
  fs.mkdirSync(dir, { recursive: true });
  for (const n of POLYGON_LEVELS) {
    fs.writeFileSync(path.join(dir, `polygons_${n}.geojson`), JSON.stringify(makePolygons(n)));
  }
  for (const n of POINT_LEVELS) {
    fs.writeFileSync(path.join(dir, `points_${n}.geojson`), JSON.stringify(makePoints(n)));
  }
  console.log(`wrote synthetic fixtures → ${path.relative(process.cwd(), dir)}`);
}
