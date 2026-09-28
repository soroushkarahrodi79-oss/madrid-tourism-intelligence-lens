import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
const builder = fs.readFileSync(new URL("../scripts/build_pedestrian_activity.py", import.meta.url), "utf8");

test("observed pedestrian activity is opt-in and separate from operational POIs", () => {
  assert.match(html, /<span>Observed activity<\/span>/);
  assert.match(html, /Pedestrian counters/);
  assert.match(html, /data-layer="pedestrian" type="checkbox"[^>]*aria-checked="false"/);
  assert.doesNotMatch(html, /data-layer="pedestrian"[^>]*type="checkbox"\s+checked(?:\s|>)/);
  assert.match(app, /pedestrian: L\.layerGroup\(\),/);
  assert.match(app, /let poiPoints = \[\];\nlet pedestrianStations = \[\];/);
  assert.match(app, /return poiStatsInLens\(visiblePoiPoints\(\), centerOf\(which\), radius\)/);
  assert.match(app, /return pedestrianStatsInLens\(pedestrianStations, centerOf\(which\), radius\)/);
});

test("pedestrian lens metric communicates observed evidence and abstains without a counter", () => {
  assert.match(html, /id="pedestrianCard" class="activity-card" hidden/);
  assert.match(html, /Counts are observed pedestrians, not tourists/);
  assert.match(app, /value\.textContent = "No sensor evidence"/);
  assert.match(app, /pedestrians \/ published hourly record/);
  assert.match(app, /pedestrianStatus === "unavailable"/);
});

test("Lens A/B comparison includes pedestrian activity only when evidence exists in both lenses", () => {
  assert.match(html, /Ped flow<b id="cmpPedestrian">—<\/b>/);
  assert.match(app, /pa\.evidence === "OBSERVED" && pb\.evidence === "OBSERVED"/);
  assert.match(app, /deltaOrDash\(Math\.round\(pa\.meanObserved\), Math\.round\(pb\.meanObserved\), "\/h"\)/);
});

test("deployment builds a bounded pedestrian snapshot from Madrid Open Data", () => {
  assert.match(workflow, /python3 scripts\/build_pedestrian_activity\.py/);
  assert.match(builder, /300321-0-aforos-peatones-bicicletas-csv\.csv/);
  assert.match(builder, /LAT_MIN, LAT_MAX = 40\.385, 40\.455/);
  assert.match(builder, /LON_MIN, LON_MAX = -3\.745, -3\.645/);
  assert.match(builder, /not tourism-specific/);
});

test("current pedestrian snapshot and app/lens scripts are cache-busted", () => {
  assert.match(app, /data\/pedestrian_activity\.json\?v=20260928-21/);
  assert.match(html, /js\/lens\.js\?v=20260928-19/);
  assert.match(html, /js\/app\.js\?v=20260928-22/);
});


test("pedestrian snapshot bypasses stale browser cache after deployments", () => {
  assert.match(app, /fetch\("data\/pedestrian_activity\.json\?v=20260928-21", \{ cache: "no-store" \}\)/);
});
