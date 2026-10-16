// K12 — §4 PMTiles tiling cost + transfer (DETERMINISTIC input baseline +
// documented procedure).
//
// Question from issue #74: measure the tiling cost of the ámbito and licence
// layers and the resulting transfer, and state whether PMTiles is decidable
// independently of the MapLibre (vector-renderer) decision — "it is not".
//
// WHAT IS MEASURED HERE (deterministic): the raw/gzip input bytes of the two
// vector layers that would be tiled, and what a single map viewport transfers
// TODAY (the whole layer, once) versus the PMTiles model (only visible tiles).
//
// WHAT IS NOT MEASURED HERE: the actual .pmtiles output bytes. Producing them
// needs `tippecanoe`, a C++ tool not installed in this container. The exact
// command is recorded below so a reviewer can produce and measure it on a
// machine that has it. The per-viewport transfer figures are ENGINEERING
// ESTIMATES, labelled as such — not measurements.
//
// Run:  node research/runtime_spike/pmtiles/tiling_cost.mjs
// Out:  research/runtime_spike/results/pmtiles.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipBytes, brotliBytes, countGeoJSON, hostDescriptor } from "../lib/measure.mjs";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../..");

const ambitoPath = path.join(ROOT, "data/planning/madrid_ambitos.geojson");
const ambito = JSON.parse(fs.readFileSync(ambitoPath, "utf8"));
const ambitoBuf = fs.readFileSync(ambitoPath);

// Licences are points in a JSON artifact; as a tiled vector layer they would be
// a point FeatureCollection. Measure them in that shape for a fair comparison.
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
  },
];

const out = {
  spike: "K12 runtime decision",
  measurement: "pmtiles_tiling_cost",
  deterministic: "input layer bytes are hardware-independent; per-viewport transfer is an ESTIMATE",
  host: hostDescriptor(),
  layers,
  decidability_finding:
    "PMTiles is a transport/packaging format for VECTOR (or raster) tiles consumed by a " +
    "vector renderer. The production app uses Leaflet with RASTER basemap tiles and whole-" +
    "GeoJSON overlays; it has no vector-tile renderer. PMTiles for the overlays is therefore " +
    "NOT decidable independently of the MapLibre decision (§3): adopting PMTiles for ámbito/" +
    "licence vectors presupposes a vector renderer. Verdict is slaved to MapLibre's.",
  transfer_model_note:
    "TODAY each overlay is fetched once as a whole gzipped GeoJSON and cached. PMTiles would " +
    "fetch only the tiles overlapping the viewport, via HTTP range requests on one .pmtiles " +
    "file. At Madrid-municipal extent and the app's default zoom, the whole ámbito layer is " +
    "visible, so PMTiles would transfer a comparable byte volume on first paint; its win is " +
    "at deep zoom over a much larger corpus (parcel scale), which this product does not have.",
  tippecanoe_procedure: {
    install: "brew install tippecanoe  (or build from mapbox/tippecanoe)",
    ambito:
      "tippecanoe -o ambito.pmtiles -zg --drop-densest-as-needed " +
      "-l ambito data/planning/madrid_ambitos.geojson",
    licences:
      "node research/runtime_spike/pmtiles/tiling_cost.mjs  # writes licence_points.geojson first, then: " +
      "tippecanoe -o licences.pmtiles -zg --cluster-distance=... -l licences licence_points.geojson",
    then: "measure: ls -l *.pmtiles ; compare against today_whole_layer.gzip_bytes above",
    status: "NOT RUN — tippecanoe absent in this container (declared, not estimated away)",
  },
};

const outPath = path.join(ROOT, "research/runtime_spike/results/pmtiles.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`pmtiles → ${path.relative(ROOT, outPath)}`);
for (const l of layers)
  console.log(
    `  ${l.layer.padEnd(16)} whole-layer gzip ${(l.today_whole_layer.gzip_bytes / 1024).toFixed(0)}KB ` +
      `(raw ${(l.today_whole_layer.raw_bytes / 1024 / 1024).toFixed(2)}MB)`,
  );
console.log("  actual .pmtiles bytes: DEFERRED (tippecanoe absent) — procedure recorded");
