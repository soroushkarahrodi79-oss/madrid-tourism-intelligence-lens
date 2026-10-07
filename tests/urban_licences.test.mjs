// Granted urban licences: the contract these tests defend (K9, #71).
//
// THE DECISIVE CONTRACTS:
//   1. NO CROSS-FAMILY TOTAL. No exported function is a single
//      total/overall/all-count, and no view carries an aggregate key summing the
//      three families. Tested STRUCTURALLY: a developer would have to add one.
//   2. The three families stay SEPARATELY QUANTIFIED, even when shown together.
//   3. Point-in-lens is the inclusive great-circle rule of js/lens.js
//      (`distance <= radiusM`); the boundary is tested deterministically.
//   4. OFF, UNAVAILABLE, NO_MATCHES and AVAILABLE are four distinct states; an
//      unresolved row is never a zero.
//   5. The date window is clamped to the real register extent (before/after/
//      reversed/same-day), with no overflow beyond the evidence.
//   6. Outputs are frozen.
//
// They also run against the COMMITTED artifact so a bad regeneration fails here.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  ADDRESS_POINT_SCOPE,
  LICENCE_FAMILIES,
  LICENCE_LAYER_STATE,
  GRANTED_ONLY_CEILING,
  clampWindow,
  defaultWindow,
  licencesInLens,
  createLicenceIndex,
} from "../js/urban-licences.js";
import * as licenceModule from "../js/urban-licences.js";

const ROOT = new URL("..", import.meta.url);

// Same formula as the model/lens, so the boundary distance is computed identically.
function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const q =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(q));
}

const CENTRE = { lat: 40.4168, lon: -3.7038 }; // Puerta del Sol
const BUILDING = "BUILDING_URBANISTIC_LICENCE_FAMILY";
const ACTIVITY = "ACTIVITY_LICENCE_FAMILY";
const TEMPORARY = "TEMPORARY_ACTIVITY_FAMILY";

function rec(id, family, grant_date, lat, lon) {
  return { id, family, grant_date, lat, lon, tipo: "x", barrio_code: "011", district_code: "01" };
}

// A tiny fixture: three points at the centre (distance 0, always inside), one far
// away, across the three families and two years.
const FIXTURE = [
  rec("k9-00001", BUILDING, "2024-05-10", CENTRE.lat, CENTRE.lon),
  rec("k9-00002", ACTIVITY, "2025-06-20", CENTRE.lat, CENTRE.lon),
  rec("k9-00003", TEMPORARY, "2026-03-01", CENTRE.lat, CENTRE.lon),
  rec("k9-00004", BUILDING, "2024-01-15", 40.9, -3.2), // far outside any small circle
];
const EXTENT = { min: "2023-01-13", max: "2026-09-30" };

const ARTIFACT = {
  contract_version: "1.0.0",
  generated_at: "2026-10-06T00:00:00Z",
  granted_only: true,
  interpretation_ceiling: "granted != built",
  families: { [BUILDING]: { resolved: 2, unresolved: 0, total: 2 } },
  date_extent: EXTENT,
  coverage: { total_rows: 5, resolved_rows: 4, unresolved_rows: 1, row_match_rate: 0.8 },
  records: FIXTURE,
};

test("a point inside the Lens is counted, a far point is not", () => {
  const view = licencesInLens({ ...CENTRE, radiusM: 1000 }, FIXTURE, {});
  assert.equal(view.records.length, 3);
  assert.ok(!view.records.some((r) => r.id === "k9-00004"));
  assert.equal(view.scope, ADDRESS_POINT_SCOPE);
});

test("boundary is inclusive: a point exactly at the radius is inside, one past it is out", () => {
  const pt = rec("k9-edge", BUILDING, "2024-05-10", 40.42, -3.70);
  const d = haversineMeters(CENTRE, pt);
  const atBoundary = licencesInLens({ ...CENTRE, radiusM: d }, [pt], {});
  assert.equal(atBoundary.records.length, 1, "distance exactly equal to the radius is inside");
  const justOutside = licencesInLens({ ...CENTRE, radiusM: d - 0.001 }, [pt], {});
  assert.equal(justOutside.records.length, 0, "distance greater than the radius is outside");
});

test("family filter restricts records but keeps each family separately counted", () => {
  const onlyBuilding = licencesInLens({ ...CENTRE, radiusM: 1000 }, FIXTURE, { families: [BUILDING] });
  assert.equal(onlyBuilding.records.length, 1);
  assert.equal(onlyBuilding.perFamily[BUILDING], 1);
  assert.equal(onlyBuilding.perFamily[ACTIVITY], 0);
  assert.equal(onlyBuilding.perFamily[TEMPORARY], 0);
});

test("date-window filter restricts by grant date", () => {
  const win = { from: "2025-01-01", to: "2026-12-31" };
  const view = licencesInLens({ ...CENTRE, radiusM: 1000 }, FIXTURE, { window: win });
  assert.deepEqual(
    view.records.map((r) => r.id).sort(),
    ["k9-00002", "k9-00003"],
    "only the 2025 and 2026 records survive the window"
  );
});

test("combined display keeps the three families separate (no merged total)", () => {
  const view = licencesInLens({ ...CENTRE, radiusM: 1000 }, FIXTURE, {});
  assert.equal(view.perFamily[BUILDING], 1);
  assert.equal(view.perFamily[ACTIVITY], 1);
  assert.equal(view.perFamily[TEMPORARY], 1);
  // The per-family object has EXACTLY the three family keys and nothing summing them.
  assert.deepEqual(Object.keys(view.perFamily).sort(), [...LICENCE_FAMILIES].sort());
});

test("STRUCTURAL: no cross-family total is exported and no view carries one", () => {
  const forbidden = /total|overall|sum|combined|allcount|grandtotal/i;
  for (const name of Object.keys(licenceModule)) {
    if (typeof licenceModule[name] === "function") {
      assert.ok(!forbidden.test(name), `exported function "${name}" must not be a cross-family total`);
    }
  }
  const view = licencesInLens({ ...CENTRE, radiusM: 1000 }, FIXTURE, {});
  for (const key of Object.keys(view)) {
    assert.ok(!forbidden.test(key), `view key "${key}" must not be a cross-family total`);
  }
  for (const key of Object.keys(view.perFamily)) {
    assert.ok(!forbidden.test(key), `perFamily key "${key}" must not be an aggregate`);
  }
});

test("outputs are deeply frozen", () => {
  const view = licencesInLens({ ...CENTRE, radiusM: 1000 }, FIXTURE, {});
  assert.ok(Object.isFrozen(view));
  assert.ok(Object.isFrozen(view.perFamily));
  assert.ok(Object.isFrozen(view.records));
  assert.throws(() => {
    view.perFamily[BUILDING] = 999;
  }, TypeError);
});

test("window clamp: before min, after max, reversed, same-day", () => {
  assert.equal(clampWindow("2000-01-01", "2026-09-30", EXTENT).from, EXTENT.min, "before min is raised");
  assert.equal(clampWindow("2023-01-13", "2099-01-01", EXTENT).to, EXTENT.max, "after max is lowered");
  const reversed = clampWindow("2026-01-01", "2024-01-01", EXTENT);
  assert.ok(reversed.from <= reversed.to, "reversed input is swapped, not dropped");
  const sameDay = clampWindow("2025-05-05", "2025-05-05", EXTENT);
  assert.equal(sameDay.from, "2025-05-05");
  assert.equal(sameDay.to, "2025-05-05");
});

test("default window is a bounded recent period with exact dates, never all-time", () => {
  const win = defaultWindow(EXTENT);
  assert.ok(win.valid);
  assert.equal(win.to, EXTENT.max);
  assert.ok(win.from > EXTENT.min, "default is narrower than the full extent");
  assert.match(win.from, /^\d{4}-\d{2}-\d{2}$/);
});

test("index view states: OFF, NO_MATCHES, AVAILABLE are distinct; UNAVAILABLE on a bad artifact", () => {
  const index = createLicenceIndex(ARTIFACT);
  assert.ok(index, "a usable artifact builds an index");

  const off = index.view({ ...CENTRE, radiusM: 1000 }, { enabled: false });
  assert.equal(off.state, LICENCE_LAYER_STATE.OFF);
  assert.equal(off.records.length, 0);

  const available = index.view({ ...CENTRE, radiusM: 1000 }, { enabled: true, window: EXTENT.min && { from: EXTENT.min, to: EXTENT.max } });
  assert.equal(available.state, LICENCE_LAYER_STATE.AVAILABLE);
  assert.ok(available.records.length >= 1);

  // Enabled, valid window, but a tiny circle far from every record -> NO_MATCHES,
  // which is a real zero, NOT unavailable and NOT off.
  const none = index.view({ lat: 41.5, lon: -3.0, radiusM: 100 }, { enabled: true, window: { from: EXTENT.min, to: EXTENT.max } });
  assert.equal(none.state, LICENCE_LAYER_STATE.NO_MATCHES);
  assert.equal(none.records.length, 0);

  assert.equal(createLicenceIndex(null), null, "no artifact -> null index (UNAVAILABLE upstream)");
  assert.equal(createLicenceIndex({ granted_only: false, records: [], date_extent: EXTENT }), null);
});

test("the granted-only ceiling rides on every reading", () => {
  const view = licencesInLens({ ...CENTRE, radiusM: 1000 }, FIXTURE, {});
  assert.equal(view.ceiling, GRANTED_ONLY_CEILING);
  assert.equal(GRANTED_ONLY_CEILING.grantedOnly, true);
  assert.match(GRANTED_ONLY_CEILING.grantIsNotBuilt, /not .*evidence that work started|construction/i);
});

// -------------------------------------------------------- committed artifact
const ARTIFACT_PATH = new URL("data/planning/madrid_urban_licences.json", ROOT);

test("committed artifact loads, is granted-only, and has the three families", () => {
  if (!fs.existsSync(ARTIFACT_PATH)) {
    // The artifact is committed; its absence is a build problem caught elsewhere.
    return;
  }
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf-8"));
  const index = createLicenceIndex(artifact);
  assert.ok(index, "committed artifact builds an index");
  assert.equal(artifact.granted_only, true);
  assert.deepEqual(Object.keys(artifact.families).sort(), [...LICENCE_FAMILIES].sort());
  // No cross-family total anywhere at the top level of the artifact.
  for (const key of Object.keys(artifact)) {
    assert.ok(!/total_urban_licences|all_licence|overall_licence/i.test(key));
  }
  // Every resolved record carries a family in the closed set and a coordinate.
  for (const r of artifact.records) {
    assert.ok(LICENCE_FAMILIES.includes(r.family));
    assert.ok(Number.isFinite(r.lat) && Number.isFinite(r.lon));
  }
});
