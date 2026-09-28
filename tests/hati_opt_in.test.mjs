import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

test("HATI is off by default", () => {
  assert.match(html, /data-layer="heat" type="checkbox" aria-label="Toggle HATI thermal pilot" aria-checked="false"/);
  assert.doesNotMatch(html, /data-layer="heat"[^>]*type="checkbox"\s+checked(?:\s|>)/);
  assert.match(app, /heat: L\.layerGroup\(\),/);
});

test("HATI evidence details are hidden until the layer is enabled", () => {
  assert.match(html, /id="hatiEvidenceDetails" hidden/);
  assert.match(app, /details\.hidden = !on/);
  assert.match(app, /timeSelect\.disabled = !on/);
});

test("HATI metric abstains while research evidence is off", () => {
  assert.match(app, /hv\.textContent = "Off"/);
  assert.match(app, /hf\.textContent = "enable HATI research evidence"/);
});

test("Evidence navigation explicitly enables HATI before framing the pilot", () => {
  assert.match(app, /document\.getElementById\("navEvidence"\)\.onclick = \(\) => \{\n  setLayerVisible\("heat", true\);/);
});

test("HATI comparison does not compute a thermal delta while the layer is off", () => {
  assert.match(app, /const hatiOn = isHatiVisible\(\)/);
  assert.match(app, /: "HATI off"/);
});
