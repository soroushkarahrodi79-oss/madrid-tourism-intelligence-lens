import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
const builder = fs.readFileSync(new URL("../scripts/build_pedestrian_activity.py", import.meta.url), "utf8");
const copy = fs.readFileSync(new URL("../js/shell-copy.js", import.meta.url), "utf8");

test("observed pedestrian activity is opt-in and separate from operational POIs", () => {
  assert.match(html, /data-i18n="aside\.observed">Observed activity<\/span>/);
  assert.match(html, /Pedestrian counters/);
  assert.match(html, /data-layer="pedestrian" type="checkbox"[^>]*aria-checked="false"/);
  assert.doesNotMatch(html, /data-layer="pedestrian"[^>]*type="checkbox"\s+checked(?:\s|>)/);
  assert.match(app, /pedestrian: L\.layerGroup\(\),/);
  // Separate state arrays are the contract; their adjacency in the file is not.
  assert.match(app, /let poiPoints = \[\];/);
  assert.match(app, /let pedestrianStations = \[\];/);
  // The statistics read the SAME filtered point set the map renders. The call
  // now names an analysis geometry rather than a centre and a radius (#187
  // Phase 3: circle or custom polygon), and `activeAnalysisGeometry` returns the
  // circular geometry unchanged in every case but an active polygon in PLACE.
  assert.match(app, /poiStatsInGeometry\(visiblePoiPoints\(\), activeAnalysisGeometry\(which\)\)/);
  assert.match(app, /return pedestrianStatsInGeometry\(pedestrianStations, activeAnalysisGeometry\(which\)\)/);
});

test("pedestrian KPI lives in PLACE Detail (K4) and communicates observed evidence", () => {
  assert.match(html, /id="pedestrianCard" class="activity-card" hidden/);
  assert.match(html, /Pedestrian flow <span class="badge observed">observed<\/span>/);
  assert.ok(html.indexOf('id="placeDetail"') < html.indexOf('id="pedestrianCard"'), "the pedestrian reading sits inside the PLACE Detail disclosure");
  assert.ok(html.indexOf('id="areaProfile"') < html.indexOf('id="pedestrianCard"'), "the place lead precedes the optional pedestrian reading");
  assert.match(html, /Counts are observed pedestrians, not tourists/);
  assert.match(app, /if \(card\) card\.hidden = !on;/);
  assert.match(app, /renderPedestrianMetric\(pedestrianStatsFor\(active\)\);/);
  assert.match(app, /value\.textContent = "No sensor evidence"/);
  assert.match(app, /p\.stationCount === 1 \? "ped\/h" : "passages\/hour"/);
  // The footer names the geometry the count was taken over: a radius for the
  // circular Lens, the polygon's own area for a custom polygon (#187 Phase 3).
  assert.match(app, /\$\{formatLensRadius\(radiusFor\(active\)\)\} radius/);
  assert.match(app, /in current lens · \$\{extent\}/);
  assert.match(app, /pedestrianStatus === "unavailable"/);
});

test("Lens A/B comparison includes pedestrian activity (panel-only) when evidence exists in both lenses", () => {
  assert.match(html, /<th scope="row">Pedestrian · panel only<\/th><td id="cmpPedestrianA">—<\/td><td id="cmpPedestrianB">—<\/td><td id="cmpPedestrian">—<\/td>/);
  // V3: pedestrian is a panel-only analytical comparison (not a halo bar), built
  // directly from activityState rather than routed through the halo metrics.
  assert.match(app, /const pedestrianState = activityState\(\{[\s\S]*enabled: pedestrianOn/);
  assert.match(app, /setComparisonRow\("cmpPedestrian", pedestrianState/);
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

// #187: the activation path's failure mode. A checkout ships the committed
// `available: false` stub, so "unavailable" is a state the UI must be able to
// SAY — not one it may express only as a disabled control and a mouse tooltip.
test("the unavailable state is stated, focusable and refused rather than silently disabled", () => {
  // The control carries an accessible description pointing at visible text.
  assert.match(html, /data-layer="pedestrian"[^>]*aria-describedby="pedestrianLayerState"/);
  assert.match(html, /<p id="pedestrianLayerState" class="layer-state" role="status" hidden><\/p>/);
  assert.match(html, /<div class="layer activity-layer" data-layer-row="pedestrian">/);
  // aria-disabled keeps the control in the tab order; `disabled` does not, and
  // that is precisely what hid the reason from keyboard and screen-reader users.
  assert.match(app, /toggle\.setAttribute\("aria-disabled", String\(unavailable\)\)/);
  assert.match(app, /toggle\.disabled = false;/);
  assert.doesNotMatch(app, /pedestrianToggle\.disabled = pedestrianStatus === "unavailable"/);
  // A focusable control still receives change events, so activation is refused
  // in the handler rather than left to the browser.
  assert.match(app, /if \(x\.getAttribute\("aria-disabled"\) === "true"\) \{/);
  // The reason is translated, never English-only.
  assert.match(copy, /"layer\.pedestrianUnavailable": "Unavailable in this build/);
  assert.match(copy, /"layer\.pedestrianUnavailable": "No disponible en esta compilación/);
  // A language switch re-renders it.
  assert.match(app, /renderPedestrianLayerAvailability\(\);\n(?:  if \(typeof render\w+ === "function"\) render\w+\(\);\n)*  document\.getElementById\("hospitalityLanguageLabel"\)/);
});

// #187: the control used to be wired only after the required-artifact Promise.all
// and the heavy loadAllLayers await, so any upstream failure left it in its
// markup state — enabled, with zero stations, able to switch on an empty layer.
test("pedestrian availability is resolved independently of the POI pipeline", () => {
  const pedestrianAwait = app.indexOf("const pedestrianData = await pedestrianRequest;");
  const availabilityRender = app.indexOf("renderPedestrianLayerAvailability();\n\n  const [snapshotPOI");
  const loadAllLayers = app.indexOf("await loadAllLayers(snapshotPOI, runtimePOI)");
  assert.ok(pedestrianAwait > 0, "the pedestrian artifact is awaited on its own");
  assert.ok(availabilityRender > pedestrianAwait, "the control is settled right after its own data arrives");
  assert.ok(availabilityRender < loadAllLayers, "and before the POI pipeline is awaited");
  // A required artifact that 404s must name itself instead of surfacing an opaque
  // JSON parse error from r.json() on an error page.
  assert.match(app, /throw new Error\(`boot: required artifact \$\{url\} responded \$\{r\.status\}`\)/);
  assert.match(app, /required\("data\/snapshot_poi\.json"\)/);
  assert.match(app, /required\("data\/hati_assets\.json"\)/);
});
