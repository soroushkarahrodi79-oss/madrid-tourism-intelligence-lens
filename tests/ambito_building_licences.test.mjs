// Gate A1: granted BUILDING licences co-located with planning ámbitos.
// Runs against the committed artifacts; no network. Defends: determinism, correct
// edition-keyed attribution without duplication, the four separate groups, and
// that the 10 m figure stays a proximity flag (no error bounds, rates or totals).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { pointBoundaryDistanceM } from "../js/geography.js";

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../data/planning/${name}`, import.meta.url), "utf8"));
const artifact = read("madrid_ambito_building_licences.json");
const state = read("madrid_ambito_state.json");
const licences = read("madrid_urban_licences.json");

test("the artifact is a deterministic rebuild of its committed inputs", () => {
  const result = spawnSync(process.execPath, ["scripts/build_ambito_building_licences.mjs", "--check"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("groups are separate, add up, and match the building-family licences", () => {
  const g = artifact.groups;
  const building = licences.records.filter((r) => r.family === artifact.family);
  assert.equal(g.resolved_building_licences, building.length);
  assert.equal(g.inside_published_ambito + g.inside_not_published_ambito + g.outside_all_ambitos, building.length);
  assert.equal(g.unresolved_geolocation, licences.coverage.per_family[artifact.family].unresolved);
  // Per-ámbito entries carry exactly the PUBLISHED group, once each.
  const entries = Object.values(artifact.ambitos);
  assert.equal(entries.reduce((s, e) => s + e.building_licences, 0), g.inside_published_ambito);
  assert.equal(entries.reduce((s, e) => s + e.within_10m_of_boundary, 0), g.inside_published_ambito_within_10m_of_boundary);
  for (const e of entries) assert.ok(e.within_10m_of_boundary <= e.building_licences);
});

test("entries are keyed {edition}:{code}, only for PUBLISHED ámbitos of the named edition", () => {
  assert.equal(artifact.edition_identity, state.editions.development_state.snapshot_identity);
  for (const key of Object.keys(artifact.ambitos)) {
    assert.ok(key.startsWith(`${artifact.edition_identity}:`));
    const code = key.slice(artifact.edition_identity.length + 1);
    assert.equal(state.ambitos[code]?.development_state?.availability, "PUBLISHED", code);
  }
});

test("the proximity flag is not an error bound and no rate, rank or total exists", () => {
  assert.match(artifact.proximity_flag.semantics, /NOT a positional error bound/);
  const text = JSON.stringify(artifact);
  for (const banned of ["rate", "rank", "score", "progress_pct", "dwelling", "total_licences", "confidence", "min_count", "max_count"]) {
    assert.ok(!Object.keys(artifact).includes(banned) && !new RegExp(`"${banned}"`).test(text), banned);
  }
  assert.equal(artifact.family, "BUILDING_URBANISTIC_LICENCE_FAMILY");
});

test("pointBoundaryDistanceM measures metres to the nearest boundary, inside or out", () => {
  const square = { type: "Polygon", coordinates: [[[-3.7, 40.4], [-3.69, 40.4], [-3.69, 40.41], [-3.7, 40.41], [-3.7, 40.4]]] };
  const mPerDegLat = 111195;
  // 0.0001 deg of latitude north of the south edge, inside: about 11.1 m.
  const inside = pointBoundaryDistanceM(-3.695, 40.4001, square);
  assert.ok(Math.abs(inside - 0.0001 * mPerDegLat) < 0.5, String(inside));
  // The same offset outside the south edge gives the same distance.
  const outside = pointBoundaryDistanceM(-3.695, 40.3999, square);
  assert.ok(Math.abs(outside - inside) < 0.5);
  assert.equal(pointBoundaryDistanceM(-3.695, 40.4, null), null);
});
