import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("production has one explicit independent A/B radius source and side-specific consumers", () => {
  assert.match(app, /const radii = createLensRadii\(\)/);
  assert.doesNotMatch(app, /let radius\s*=/);
  // The statistics read the SAME filtered point set the map renders. The call
  // now names an analysis geometry rather than a centre and a radius (#187
  // Phase 3: circle or custom polygon), and `activeAnalysisGeometry` returns the
  // circular geometry unchanged in every case but an active polygon in PLACE.
  assert.match(app, /poiStatsInGeometry\(visiblePoiPoints\(\), activeAnalysisGeometry\(which\)\)/);
  assert.match(app, /hatiStatsInGeometry\(\s*hatiAssets, timestep, geometry, geometryContainsPoint/);
  assert.match(app, /pedestrianStatsInGeometry\(pedestrianStations, activeAnalysisGeometry\(which\)\)/);
  assert.match(app, /lenses\[which\]\.circle\.setRadius\(radiusFor\(which\)\)/);
  assert.match(app, /radiusFor\(which\) \/ metresPerPixel/);
});

test("first B enable copies A once; active slider and reset do not mutate the inactive radius", () => {
  assert.match(app, /let lensBHasBeenInitialized = false/);
  assert.match(app, /if \(!lensBHasBeenInitialized\) \{ initializeLensBRadius\(radii\); lensBHasBeenInitialized = true; \}/);
  assert.match(app, /setLensRadius\(active, e\.target\.value\)/);
  assert.match(app, /radiusSlider\.setAttribute\("aria-label", `\$\{lensName\} radius`\)/);
  const resetHandler = app.slice(app.indexOf('document.getElementById("resetButton")'), app.indexOf('function renderRadiusLabels'));
  assert.doesNotMatch(resetHandler, /setLensRadius|radii\./);
});

test("Compare mode exposes both radii and a live comparison-mode cue", () => {
  assert.match(html, /id="comparisonRadiusReadout" class="comparison-radius-readout" aria-label="Lens radii"/);
  assert.match(html, /id="comparisonModeCue" class="comparison-mode-cue" aria-live="polite"/);
  assert.match(app, /Lens A · \$\{formatLensRadius\(radii\.A\)\} \| Lens B · \$\{formatLensRadius\(radii\.B\)\}/);
});
