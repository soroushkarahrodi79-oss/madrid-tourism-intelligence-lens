import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const appearance = require("../js/appearance.js");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../css/app.css", import.meta.url), "utf8");

test("appearance preference accepts only light, dark and system", () => {
  assert.equal(appearance.normalizePreference("light"), "light");
  assert.equal(appearance.normalizePreference("dark"), "dark");
  assert.equal(appearance.normalizePreference("system"), "system");
  assert.equal(appearance.normalizePreference("sepia"), "system");
  assert.equal(appearance.normalizePreference(null), "system");
});

test("system resolves from OS while explicit preferences do not", () => {
  assert.equal(appearance.resolveAppearance("system", false), "light");
  assert.equal(appearance.resolveAppearance("system", true), "dark");
  assert.equal(appearance.resolveAppearance("light", true), "light");
  assert.equal(appearance.resolveAppearance("dark", false), "dark");
});

test("storage access is optional and failures fall back to system", () => {
  const broken = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); }
  };
  assert.equal(appearance.safeRead(broken), "system");
  assert.doesNotThrow(() => appearance.safeWrite(broken, "light"));
});

test("the synchronous resolver precedes the stylesheet and emits concrete values", () => {
  const scriptIndex = html.indexOf("madrid-lens-appearance");
  const styleIndex = html.indexOf('<link rel="stylesheet"');
  assert.ok(scriptIndex > -1 && scriptIndex < styleIndex);
  assert.match(html, /dataset\.appearance\s*=\s*preference === "system"/);
  assert.doesNotMatch(html, /dataset\.appearance\s*=\s*"system"/);
});

test("appearance and basemap are separate controls", () => {
  assert.match(html, /id="appearanceSelect"/);
  assert.match(html, /id="basemapSelect"/);
  assert.match(html, /value="system"/);
});

test("Light appearance does not flatten panel, rail or drawer descendant colours", () => {
  assert.doesNotMatch(css, /:root\[data-appearance="light"\]\s+\.left\s+\*/);
  assert.doesNotMatch(css, /:root\[data-appearance="light"\]\s+\.panel\s+\*/);
  assert.doesNotMatch(css, /:root\[data-appearance="light"\]\s+\.evidence-drawer\s+\*/);
  assert.match(css, /\.di-item\[data-state="withheld"\]\s+\.di-rel/);
  assert.match(css, /\.comparison-bridge\[data-relationship="withheld"\]\s+\.cb-rel-value/);
});
