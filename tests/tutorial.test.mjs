import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import tutorial from "../js/tutorial.js";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("index.html");
const source = read("js/tutorial.js");
const css = read("css/app.css");

test("tutorial has a versioned, minimal preference and bilingual six-step copy", () => {
  assert.equal(tutorial.STORAGE_KEY, "madrid-lens-tutorial-v1");
  for (const lang of ["en", "es"]) {
    assert.equal(tutorial.COPY[lang].steps.length, 6);
    assert.ok(tutorial.COPY[lang].doneTitle.length > 10);
  }
  assert.match(source, /\$\{VERSION\}:completed/);
  assert.match(source, /\$\{VERSION\}:dismissed/);
});

test("tutorial is an optional guide, not an analytical-state driver", () => {
  assert.match(html, /id="tutorialHelpButton"/);
  assert.match(html, /js\/tutorial\.js/);
  assert.match(source, /const shared = \/\(\?:\\\?\|&\)v=/);
  for (const forbidden of ["setMode(", "setBasemap(", "setLayerVisible(", "setLensRadius(", "showModal(", "map.setView("]) {
    assert.equal(source.includes(forbidden), false, `guide does not invoke ${forbidden}`);
  }
});

test("guide styles are responsive, focused and forced-colours compatible", () => {
  assert.match(css, /\.tutorial-guide-bottom/);
  assert.match(css, /\.tutorial-target/);
  assert.match(css, /@media\(forced-colors:active\)/);
  assert.match(css, /@media\(max-width:560px\)/);
});
