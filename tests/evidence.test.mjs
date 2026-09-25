import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { hatiStatsInLens, HATI_SUPPORTED_TIMESTEPS } from "../js/evidence.js";
import { haversineMeters } from "../js/lens.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = JSON.parse(readFileSync(path.join(here, "..", "data", "hati_assets.json"), "utf8"));

test("hati_assets.json: every point has valid Madrid-area coordinates", () => {
  assert.ok(assets.length > 0, "expected at least one HATI asset");
  for (const a of assets) {
    assert.ok(a.lat > 40.3 && a.lat < 40.5, `asset ${a.id} lat out of Madrid range: ${a.lat}`);
    assert.ok(a.lon > -3.8 && a.lon < -3.6, `asset ${a.id} lon out of Madrid range: ${a.lon}`);
  }
});

test("hati_assets.json: UTCI timesteps are restricted to the supported HATI timesteps", () => {
  for (const a of assets) {
    for (const ts of Object.keys(a.utci_mean_10m)) {
      assert.ok(HATI_SUPPORTED_TIMESTEPS.includes(ts), `unexpected timestep ${ts} on ${a.id}`);
    }
  }
});

test("hatiStatsInLens: returns NONE evidence, not a fabricated mean, when lens is empty", () => {
  const farAway = { lat: 41.5, lon: -3.6 }; // well outside Madrid pilot area
  const s = hatiStatsInLens(assets, "15:00", farAway, 500, haversineMeters);
  assert.equal(s.evidence, "NONE");
  assert.equal(s.mean, null);
  assert.equal(s.count, 0);
});

test("hatiStatsInLens: returns MODEL-DERIVED with a real mean when samples exist", () => {
  const puertaAlcala = { lat: 40.419987, lon: -3.688724 };
  const s = hatiStatsInLens(assets, "15:00", puertaAlcala, 200, haversineMeters);
  assert.equal(s.evidence, "MODEL-DERIVED");
  assert.ok(s.count >= 1);
  assert.ok(Number.isFinite(s.mean));
});

test("hatiStatsInLens: deterministic across repeated calls", () => {
  const center = { lat: 40.415, lon: -3.685 };
  const s1 = hatiStatsInLens(assets, "12:00", center, 1000, haversineMeters);
  const s2 = hatiStatsInLens(assets, "12:00", center, 1000, haversineMeters);
  assert.deepEqual(s1, s2);
});
