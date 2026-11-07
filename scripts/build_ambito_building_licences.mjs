#!/usr/bin/env node

// Deterministic build-time co-location of granted BUILDING licences with the
// official planning ámbitos (Gate A0 MODIFY, Gate A1 GO). Reads three committed
// artifacts, writes one derived artifact; no network, no clock, no randomness.
//
//   node scripts/build_ambito_building_licences.mjs          # write
//   node scripts/build_ambito_building_licences.mjs --check  # fail if the file drifts
//
// A licence is a granted administrative record with one official callejero
// address point. Co-location is NOT evidence of works started, built or finished,
// and the point is not the parcel of the action. The 10 m figure is a geometric
// proximity flag to the containing ámbito's own boundary, never an error bound.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pointBoundaryDistanceM, pointInGeometry } from "../js/geography.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "data/planning");
const FILES = {
  licences: "madrid_urban_licences.json",
  geometry: "madrid_ambitos.geojson",
  state: "madrid_ambito_state.json",
};
const OUT = path.join(dir, "madrid_ambito_building_licences.json");
const FAMILY = "BUILDING_URBANISTIC_LICENCE_FAMILY";
const PROXIMITY_M = 10;

const raw = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, fs.readFileSync(path.join(dir, f))]));
const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const licences = JSON.parse(raw.licences.toString("utf8"));
const geometry = JSON.parse(raw.geometry.toString("utf8"));
const state = JSON.parse(raw.state.toString("utf8"));

const edition = state.editions.development_state;
const editionIdentity = edition.snapshot_identity; // e.g. S1:2026-01:<fingerprint>
const publishedOf = (code) => state.ambitos[code]?.development_state?.availability === "PUBLISHED";

const boxOf = (geom) => {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      minLon = Math.min(minLon, c[0]); maxLon = Math.max(maxLon, c[0]);
      minLat = Math.min(minLat, c[1]); maxLat = Math.max(maxLat, c[1]);
    } else c.forEach(walk);
  };
  walk(geom.coordinates);
  return { minLon, minLat, maxLon, maxLat };
};
const ambitos = geometry.features
  .map((f) => ({ code: f.properties.ambito_code, geometry: f.geometry, box: boxOf(f.geometry) }))
  .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
if (new Set(ambitos.map((a) => a.code)).size !== ambitos.length) throw new Error("duplicate ámbito codes");

const building = licences.records.filter((r) => r.family === FAMILY);
const groups = { inside_published_ambito: 0, inside_not_published_ambito: 0, outside_all_ambitos: 0 };
const per = new Map();
let nearPublished = 0;
let dateMin = null;
let dateMax = null;

for (const record of building) {
  if (dateMin === null || record.grant_date < dateMin) dateMin = record.grant_date;
  if (dateMax === null || record.grant_date > dateMax) dateMax = record.grant_date;
  const hits = ambitos.filter(
    (a) =>
      record.lon >= a.box.minLon && record.lon <= a.box.maxLon &&
      record.lat >= a.box.minLat && record.lat <= a.box.maxLat &&
      pointInGeometry(record.lon, record.lat, a.geometry)
  );
  if (hits.length > 1) throw new Error(`licence ${record.id} falls in ${hits.length} ámbitos`);
  if (hits.length === 0) { groups.outside_all_ambitos += 1; continue; }
  const hit = hits[0];
  if (!publishedOf(hit.code)) { groups.inside_not_published_ambito += 1; continue; }
  groups.inside_published_ambito += 1;
  const near = pointBoundaryDistanceM(record.lon, record.lat, hit.geometry) <= PROXIMITY_M;
  if (near) nearPublished += 1;
  const key = `${editionIdentity}:${hit.code}`;
  const entry = per.get(key) || { building_licences: 0, within_10m_of_boundary: 0 };
  entry.building_licences += 1;
  if (near) entry.within_10m_of_boundary += 1;
  per.set(key, entry);
}

const unresolved = licences.coverage.per_family[FAMILY].unresolved;
const out = {
  contract_version: "1.0.0",
  artifact: "madrid_ambito_building_licences.json",
  builder: "scripts/build_ambito_building_licences.mjs",
  gate: "Gate A0 MODIFY, Gate A1 GO",
  edition_identity: editionIdentity,
  edition_reference_date: edition.reference_date,
  derived_from: {
    licences: { artifact: `planning/${FILES.licences}`, sha256: sha(raw.licences), generated_at: licences.generated_at },
    geometry: { artifact: `planning/${FILES.geometry}`, sha256: sha(raw.geometry) },
    state: { artifact: `planning/${FILES.state}`, sha256: sha(raw.state), development_state_snapshot: editionIdentity },
  },
  family: FAMILY,
  licence_period: { min: dateMin, max: dateMax, semantics: "Grant-date extent of the building-family records in the register; a property of the records, not a publication date and not the date of the planning state." },
  proximity_flag: {
    metres: PROXIMITY_M,
    semantics: "Geometric proximity of the official address point to the boundary of its containing ámbito. It is NOT a positional error bound, a confidence interval or a minimum or maximum count.",
  },
  groups: {
    resolved_building_licences: building.length,
    ...groups,
    unresolved_geolocation: unresolved,
    inside_published_ambito_within_10m_of_boundary: nearPublished,
  },
  ambitos: Object.fromEntries([...per.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  interpretation_ceiling:
    "Counts of GRANTED building licences whose official callejero address point lies inside a planning ámbito with a PUBLISHED state in the stated edition. This is administrative co-location, not evidence that works started, were executed or finished. The point is an address, not the parcel of the action. The edition state is a single dated snapshot and is never read as the state at the grant date of any licence. An ámbito without an entry has no building licence of this register with a point inside it; that says nothing about other urban activity. No rate, ranking, dwelling count, progress or cross-family total is derived.",
};

const text = `${JSON.stringify(out, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : null;
  if (current !== text) { console.error("madrid_ambito_building_licences.json drifted from its inputs"); process.exit(1); }
  console.log("ok: artifact matches a fresh build");
} else {
  fs.writeFileSync(OUT, text);
  console.log(JSON.stringify(out.groups), `ambitos_with_licences=${per.size}`, dateMin, dateMax);
}
