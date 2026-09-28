import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("analysis panel resize state is clamped and persisted", () => {
  assert.match(app, /function panelResizeLimits\(\)/);
  assert.match(app, /function clampPanelSize\(width, height\)/);
  assert.match(app, /localStorage\.setItem\(PANEL_SIZE_STORAGE_KEY/);
  assert.match(app, /restorePanelSize\(\)/);
});

test("leftward drag increases width for the right-anchored panel", () => {
  assert.match(app, /panelResizeState\.width \+ \(panelResizeState\.startX - event\.clientX\)/);
  assert.match(app, /panelResizeState\.height \+ \(event\.clientY - panelResizeState\.startY\)/);
});

test("panel resizing is keyboard-accessible and resettable", () => {
  assert.match(html, /aria-label="Resize analysis panel"/);
  assert.match(app, /event\.key === "ArrowLeft"/);
  assert.match(app, /event\.key === "ArrowDown"/);
  assert.match(app, /event\.key === "Home"/);
  assert.match(app, /panelResizeHandle\.addEventListener\("dblclick", resetPanelSize\)/);
});

test("mobile viewport ignores stored desktop panel dimensions", () => {
  assert.match(app, /if \(window\.innerWidth <= 850\) \{\n    analysisPanel\.style\.removeProperty\("width"\);/);
});
