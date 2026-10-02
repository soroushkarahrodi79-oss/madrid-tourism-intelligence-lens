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
  // Separate state arrays are the contract; their adjacency in the file is not.
  assert.match(app, /let poiPoints = \[\];/);
  assert.match(app, /let pedestrianStations = \[\];/);
  assert.match(app, /return poiStatsInLens\(visiblePoiPoints\(\), centerOf\(which\), radiusFor\(which\)\)/);
  assert.match(app, /return pedestrianStatsInLens\(pedestrianStations, centerOf\(which\), radiusFor\(which\)\)/);
});

test("pedestrian KPI is directly below the active Lens control and communicates observed evidence", () => {
  assert.match(html, /id="pedestrianCard" class="activity-card" hidden/);
  assert.match(html, /Pedestrian flow <span class="badge observed">observed<\/span>/);
  assert.ok(html.indexOf('id="pedestrianCard"') < html.indexOf('id="areaProfile"'));
  assert.match(html, /Counts are observed pedestrians, not tourists/);
  assert.match(app, /if \(card\) card\.hidden = !on;/);
  assert.match(app, /renderPedestrianMetric\(pedestrianStatsFor\(active\)\);/);
  assert.match(app, /value\.textContent = "No sensor evidence"/);
  assert.match(app, /p\.stationCount === 1 \? "ped\/h" : "passages\/hour"/);
  assert.match(app, /in current lens · \$\{formatLensRadius\(radiusFor\(active\)\)\} radius/);
  assert.match(app, /pedestrianStatus === "unavailable"/);
});

test("Lens A/B comparison includes pedestrian activity only when evidence exists in both lenses", () => {
  assert.match(html, /<th scope="row">Pedestrian<\/th><td id="cmpPedestrianA">—<\/td><td id="cmpPedestrianB">—<\/td><td id="cmpPedestrian">—<\/td>/);
  assert.match(app, /pedestrian: \{[\s\S]*enabled: pedestrianOn/);
  assert.match(app, /setComparisonRow\("cmpPedestrian", comparison\.metrics\.pedestrian/);
  assert.match(app, /pa\.stationCount[\s\S]*pa\.observationCount/);
});

test("deployment builds a bounded pedestrian snapshot from Madrid Open Data", () => {
  assert.match(workflow, /python3 scripts\/build_pedestrian_activity\.py/);
  assert.match(builder, /DATASTORE_URL = "https:\/\/datos\.madrid\.es\/api\/3\/action\/datastore_search"/);
  assert.match(builder, /RESOURCE_ID = "300321-0-aforos-peatones-bicicletas-csv"/);
  assert.match(builder, /retrieval_route = "ckan_datastore_search"/);
  assert.match(builder, /csv_download_fallback/);
  assert.match(builder, /LAT_MIN, LAT_MAX = 40\.385, 40\.455/);
  assert.match(builder, /LON_MIN, LON_MAX = -3\.745, -3\.645/);
  assert.match(builder, /not tourism-specific/);
});

test("current pedestrian snapshot and app/lens scripts are cache-busted", () => {
  assert.match(app, /data\/pedestrian_activity\.json\?v=[\w.-]+/);
  assert.match(html, /js\/lens\.js\?v=[\w.-]+/);
  assert.match(html, /js\/app\.js\?v=[\w.-]+/);
});


test("pedestrian snapshot bypasses stale browser cache after deployments", () => {
  assert.match(app, /fetch\("data\/pedestrian_activity\.json\?v=[\w.-]+", \{ cache: "no-store" \}\)/);
});
