// A repository checkout and a GitHub Pages deployment deliberately show
// different evidence states. Locally the app runs on the small curated fallback;
// on Pages it runs on the deployment snapshot the builders produce. That
// difference is a design choice, not an accident, so it is asserted here rather
// than left as folklore. These tests need no network.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function readJson(relative) {
  return JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), "utf8"));
}

function readText(relative) {
  return fs.readFileSync(new URL(relative, import.meta.url), "utf8");
}

test("deployment build artifacts are never committed to the repository", () => {
  const gitignore = readText("../.gitignore");

  // A checkout must not carry a deployment snapshot, or a developer would be
  // looking at stale published evidence while believing it is current.
  assert.match(gitignore, /^data\/runtime_poi\.json$/m);
  assert.match(gitignore, /^data\/deployment_manifest\.json$/m);
});

test("the committed pedestrian artifact is the explicit unavailable state", () => {
  const pedestrian = readJson("../data/pedestrian_activity.json");

  assert.equal(pedestrian.available, false);
  assert.equal(pedestrian.stations.length, 0);
  assert.equal(pedestrian.stationCount, 0);
  assert.equal(pedestrian.observationCount, 0);
  assert.equal(pedestrian.dateMin, null);
  assert.equal(pedestrian.dateMax, null);
  assert.ok(
    typeof pedestrian.error === "string" && pedestrian.error.length > 0,
    "the committed stub must say why it carries no evidence"
  );

  // It must still identify its source, so the layer's provenance survives even
  // in the unavailable state.
  assert.match(pedestrian.source.datasetUrl, /300321/);
});

test("the committed POI fallback is declared a sample, never an inventory", () => {
  const provenance = readJson("../data/snapshot_provenance.json");
  const snapshot = readJson("../data/snapshot_poi.json");

  for (const [layer, record] of Object.entries(provenance.layers)) {
    assert.equal(record.exhaustive, false, `${layer} must never be declared exhaustive`);
  }
  assert.match(provenance.completeness_notice, /not a complete inventory/i);

  const total = Object.values(snapshot).filter(Array.isArray).flat().length;
  assert.ok(total > 0, "the packaged fallback must not be empty");
  assert.ok(total < 100, "the packaged fallback is a small curated sample, not a dataset");
});

test("the app prefers the deployment snapshot over the curated sample, and says which it used", () => {
  const data = readText("../js/data.js");

  // Precedence: published deployment snapshot, then curated sample, then live.
  const publishedAt = data.indexOf("const published = publishedFor(runtimePOI, type)");
  const snapshotAt = data.indexOf("const snap = snapshotFor(snapshotPOI, type)");
  assert.ok(publishedAt >= 0 && snapshotAt >= 0, "both packaged sources must be consulted");
  assert.ok(publishedAt < snapshotAt, "the deployment snapshot must be preferred over the curated sample");

  // Each path must tag its own provenance state, which is what the UI badges.
  assert.match(data, /provenance: "published"/);
  assert.match(data, /provenance: "snapshot"/);
  assert.match(data, /layerStatus\[name\] = "unavailable"/);
});
