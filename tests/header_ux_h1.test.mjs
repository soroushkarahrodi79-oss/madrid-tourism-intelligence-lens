import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("index.html");
const css = read("css/app.css");

test("UX-H1 retains the sole header controls and isolates map-display controls in the layer rail", () => {
  assert.match(html, /<header class="map-header">/);
  assert.match(html, /class="header-tools" role="group"/);
  for (const id of ["appearanceSelect", "languageSelect", "tutorialHelpButton"]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, `${id} remains unique`);
  }
  const header = html.slice(html.indexOf("<header"), html.indexOf("</header>") + "</header>".length);
  assert.doesNotMatch(header, /basemapSelect|boundarySelect|data-layer=/, "header must not duplicate map-display controls");
});

test("UX-H1 uses existing chrome tokens and preserves a visible 44px preference target", () => {
  assert.match(css, /header\{[\s\S]*?background:var\(--chrome-header-surface\)/);
  assert.match(css, /\.header-tools\{[^}]*?border-left:1px solid var\(--chrome-divider\)/);
  assert.match(css, /\.header-tools select\{[^}]*?min-height:44px/);
  assert.match(css, /\.header-tools select:focus-visible\{outline:2px solid var\(--chrome-focus-ring-color\)/);
  assert.match(css, /@media\(max-width:680px\)\{[\s\S]*?\.header-tools\{[^}]*?border-left:0/);
});
