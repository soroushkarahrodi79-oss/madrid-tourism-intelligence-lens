// K12 — §4 PMTiles tiling cost + transfer.
//
// Issue #74 asks to MEASURE the tiling cost of the ámbito and licence layers and
// the resulting transfer, and to state whether PMTiles is decidable independently
// of MapLibre (it is not).
//
// This harness now GENERATES real Mapbox Vector Tiles (geojson-vt + vt-pbf) for
// both layers across a representative zoom range and measures:
//   * total tiled archive bytes (raw + gzip) — what a .pmtiles file would hold;
//   * per-viewport transfer at the app's default zoom — what PMTiles range-fetches
//     on first paint (the number that actually competes with today's whole-layer
//     fetch).
// MVT bytes are deterministic and hardware-independent. geojson-vt's simplification
// differs from tippecanoe's, so these are a REAL lower-to-mid estimate of a
// vector-tile pipeline, not tippecanoe output — the tippecanoe command is still
// recorded for an exact cross-check.
//
// Run:  node research/runtime_spike/pmtiles/tiling_cost.mjs   (needs npm install here)
// Out:  research/runtime_spike/results/pmtiles.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { gzipBytes, brotliBytes, countGeoJSON, hostDescriptor } from "../lib/measure.mjs";

const require = createRequire(import.meta.url);
const _gvt = require("geojson-vt");
const geojsonvt = typeof _gvt === "function" ? _gvt : _gvt.default;
const _vtpbf = require("vt-pbf");
const vtpbf = _vtpbf.fromGeojsonVt ? _vtpbf : _vtpbf.default;

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../..");
const MADRID_BBOX = { west: -3.889, south: 40.312, east: -3.518, north: 40.564 };
const DEFAULT_ZOOM = 14; // app default (js/app.js setView zoom 14)
const ZOOM_RANGE = [10, 11, 12, 13, 14, 15];

function lon2x(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function lat2y(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

// Tile the layer across ZOOM_RANGE; return total archive bytes and the
// per-viewport transfer at DEFAULT_ZOOM.
function tileLayer(name, geojson) {
  const index = geojsonvt(geojson, { maxZoom: 15, indexMaxZoom: 15, tolerance: 3, extent: 4096 });
  const perZoom = [];
  let totalRaw = 0;
  let totalGz = 0;
  for (const z of ZOOM_RANGE) {
    const x0 = lon2x(MADRID_BBOX.west, z);
    const x1 = lon2x(MADRID_BBOX.east, z);
    const y0 = lat2y(MADRID_BBOX.north, z);
    const y1 = lat2y(MADRID_BBOX.south, z);
    let raw = 0;
    let gz = 0;
    let tiles = 0;
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const t = index.getTile(z, x, y);
        if (!t || !t.features || !t.features.length) continue;
        const buf = Buffer.from(vtpbf.fromGeojsonVt({ [name]: t }, { version: 2 }));
        raw += buf.length;
        gz += gzipBytes(buf);
        tiles++;
      }
    }
    perZoom.push({ z, tiles, raw_bytes: raw, gzip_bytes: gz });
    totalRaw += raw;
    totalGz += gz;
  }
  // per-viewport: tiles covering a 1280×800 viewport centred on Sol at DEFAULT_ZOOM
  const z = DEFAULT_ZOOM;
  const cx = lon2x(-3.7038, z);
  const cy = lat2y(40.4168, z);
  let vpRaw = 0;
  let vpGz = 0;
  let vpTiles = 0;
  for (let x = cx - 2; x <= cx + 2; x++) {
    for (let y = cy - 1; y <= cy + 1; y++) {
      const t = index.getTile(z, x, y);
      if (!t || !t.features || !t.features.length) continue;
      const buf = Buffer.from(vtpbf.fromGeojsonVt({ [name]: t }, { version: 2 }));
      vpRaw += buf.length;
      vpGz += gzipBytes(buf);
      vpTiles++;
    }
  }
  return {
    per_zoom: perZoom,
    archive_total_raw_bytes: totalRaw,
    archive_total_gzip_bytes: totalGz,
    viewport_default_zoom: {
      zoom: z,
      grid: "5x3 tiles around Sol",
      tiles: vpTiles,
      raw_bytes: vpRaw,
      gzip_bytes: vpGz,
    },
  };
}

// --- inputs (whole-layer baseline, kept) ----------------------------------
const ambitoPath = path.join(ROOT, "data/planning/madrid_ambitos.geojson");
const ambito = JSON.parse(fs.readFileSync(ambitoPath, "utf8"));
const ambitoBuf = fs.readFileSync(ambitoPath);

const lic = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data/planning/madrid_urban_licences.json"), "utf8"),
);
const licPoints = {
  type: "FeatureCollection",
  features: lic.records
    .filter((r) => Number.isFinite(+r.lat) && Number.isFinite(+r.lon))
    .map((r) => ({
      type: "Feature",
      properties: { id: r.id, family: r.family, grant_date: r.grant_date },
      geometry: { type: "Point", coordinates: [+r.lon, +r.lat] },
    })),
};
const licBuf = Buffer.from(JSON.stringify(licPoints), "utf8");

const layers = [
  {
    layer: "ambito_polygons",
    source: "data/planning/madrid_ambitos.geojson",
    geometry: countGeoJSON(ambito),
    today_whole_layer: {
      raw_bytes: ambitoBuf.length,
      gzip_bytes: gzipBytes(ambitoBuf),
      brotli_bytes: brotliBytes(ambitoBuf),
    },
    tiled: tileLayer("ambito", ambito),
  },
  {
    layer: "licence_points",
    source: "data/planning/madrid_urban_licences.json (as point FC)",
    features: licPoints.features.length,
    today_whole_layer: {
      raw_bytes: licBuf.length,
      gzip_bytes: gzipBytes(licBuf),
      brotli_bytes: brotliBytes(licBuf),
    },
    tiled: tileLayer("licence", licPoints),
  },
];

const out = {
  spike: "K12 runtime decision",
  measurement: "pmtiles_tiling_cost",
  deterministic: "input + tiled MVT bytes are hardware-independent",
  host: hostDescriptor(),
  method:
    "geojson-vt (tolerance 3, extent 4096, z10–15) + vt-pbf v2 MVT encoding. Tile bytes summed " +
    "over the Madrid bbox per zoom; per-viewport = the 5x3 tile grid around Sol at z14.",
  tippecanoe_crosscheck: {
    note: "For an exact tippecanoe archive (different simplification), run on a machine with it:",
    ambito: "tippecanoe -o ambito.pmtiles -zg --drop-densest-as-needed -l ambito data/planning/madrid_ambitos.geojson",
    status: "tippecanoe absent in this container; the geojson-vt/vt-pbf figures above ARE real MVT measurements, not estimates of tippecanoe",
  },
  layers,
  decidability_finding:
    "PMTiles packages vector (or raster) tiles consumed by a VECTOR renderer. The production app " +
    "uses Leaflet with RASTER basemap tiles and whole-GeoJSON overlays — no vector renderer. So " +
    "adopting PMTiles for the overlays is NOT decidable independently of the MapLibre decision " +
    "(§3); its verdict is slaved to B.",
};

const outPath = path.join(ROOT, "research/runtime_spike/results/pmtiles.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`pmtiles → ${path.relative(ROOT, outPath)}`);
for (const l of layers) {
  const kb = (b) => (b / 1024).toFixed(0);
  console.log(
    `  ${l.layer.padEnd(16)} whole-layer ${kb(l.today_whole_layer.gzip_bytes)}KB gz | ` +
      `tiled archive z10-15 ${kb(l.tiled.archive_total_gzip_bytes)}KB gz | ` +
      `per-viewport@z14 ${l.tiled.viewport_default_zoom.tiles} tiles ${kb(l.tiled.viewport_default_zoom.gzip_bytes)}KB gz`,
  );
}
