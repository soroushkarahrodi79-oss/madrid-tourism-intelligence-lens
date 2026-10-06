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

test("The HATI layer control (moved out of navigation by K4) explicitly enables HATI before framing the pilot", () => {
  // Assert the ordering contract rather than the handler's exact source layout:
  // the layer must be switched on before the map frames the pilot study area.
  const handler = app.match(
    /document\.getElementById\("hatiFrameButton"\)\.onclick = \(\) => \{([\s\S]*?)^\};/m
  )?.[1];
  assert.ok(handler, "hatiFrameButton click handler not found");

  const enablesHati = handler.indexOf('setLayerVisible("heat", true)');
  const framesPilot = handler.indexOf("map.fitBounds(");
  assert.ok(enablesHati >= 0, "handler must enable the HATI research layer");
  assert.ok(framesPilot >= 0, "handler must frame the pilot study area");
  assert.ok(
    enablesHati < framesPilot,
    "HATI must be enabled before the map frames the pilot study area"
  );
});

test("HATI comparison does not compute a thermal delta while the layer is off", () => {
  assert.match(app, /const hatiOn = isHatiVisible\(\)/);
  assert.match(app, /: "HATI off"/);
});
