import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import tutorial from "../js/tutorial.js";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("index.html");
const source = read("js/tutorial.js");
const css = read("css/app.css");

test("Guided Tour V2 keeps the V1 preference and provides eight complete bilingual steps", () => {
  assert.equal(tutorial.STORAGE_KEY, "madrid-lens-tutorial-v1");
  assert.equal(tutorial.VERSION, "1");
  assert.equal(tutorial.STEP_COUNT, 8);
  assert.deepEqual(tutorial.STEPS.map(({ id }) => id), ["lens", "search", "controls", "layers", "modes", "questions", "dossier", "verify"]);
  for (const lang of ["en", "es"]) {
    const copy = tutorial.COPY[lang];
    assert.equal(copy.steps.length, 8);
    assert.ok(copy.steps.every(([title, body]) => title.length > 8 && body.length > 40));
    assert.match(copy.progress, /8/);
    assert.ok(copy.doneTitle.length > 10);
  }
  assert.match(source, /\$\{VERSION\}:completed/);
  assert.match(source, /\$\{VERSION\}:dismissed/);
  assert.doesNotMatch(source, /two-minute|2 minutos|2 minutes/i);
});

test("copy teaches the real M1 to M3 and K11/K13 contracts without stronger claims", () => {
  const en = tutorial.COPY.en.steps.map(([, body]) => body).join(" ");
  const es = tutorial.COPY.es.steps.map(([, body]) => body).join(" ");
  for (const term of ["barrios", "districts", "planning ámbitos", "municipality", "View on map", "Analyze with Lens", "K13", "abstention", "HTML", "JSON", "K11", "five workspace files", "future deployments"]) assert.ok(en.includes(term), term);
  for (const term of ["barrios", "distritos", "ámbitos de planeamiento", "municipio", "Ver en el mapa", "Analizar con Lens", "K13", "abstención", "HTML", "JSON", "K11", "cinco archivos", "despliegue futuro"]) assert.ok(es.includes(term), term);
  assert.match(en, /not completed construction/);
  assert.match(en, /do not prove physical construction progress/);
  assert.match(en, /Missing, unavailable, withheld, OFF and a published zero are different/);
  assert.match(en, /no chatbot, unrestricted question box or AI-generated answer/i);
  assert.match(en, /restores neither that question nor its answer/);
});

test("tutorial remains an optional visual guide rather than an analytical-state driver", () => {
  assert.match(html, /id="tutorialHelpButton"/);
  assert.match(html, /js\/tutorial\.js\?v=20261030-guided-tour-v2/);
  assert.match(html, /css\/app\.css\?v=20261030-guided-tour-v2/);
  assert.match(source, /const shared = \/\(\?:\\\?\|&\)v=/);
  for (const forbidden of ["setMode(", "setBasemap(", "setLayerVisible(", "setLensRadius(", "map.setView(", "createQuestionDossier(", ".ask(", "URL.createObjectURL(", "history.replaceState("]) {
    assert.equal(source.includes(forbidden), false, `guide does not invoke ${forbidden}`);
  }
  assert.doesNotMatch(source, /institutional-journey|yeser[ií]as/i);
});

test("targets and navigation are contextual, visible and limited to safe disclosure", () => {
  for (const selector of ["geoSearchToggle", "radiusSlider", "mobileLayersButton", "layerRail", "modeNav", "qxTitle", "qx-action-dossier", "scopeRailFreshness"]) assert.ok(source.includes(selector), selector);
  assert.match(source, /if \(panel\?\.hidden && toggle\) toggle\.click\(\)/);
  assert.match(source, /scrollIntoView\(\{ block: "nearest", behavior: "auto" \}\)/);
  assert.match(source, /clippedRect/);
  assert.match(source, /This control is not visible/);
});

test("guide styles constrain short screens, expose focus and cover accessibility media", () => {
  assert.match(css, /max-height:calc\(100dvh/);
  assert.match(css, /overflow:auto/);
  assert.match(css, /\.tutorial-guide-bottom/);
  assert.match(css, /#tutorialHighlight/);
  assert.match(css, /tutorial-actions button:focus-visible/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /@media\(forced-colors:active\)/);
  assert.match(css, /@media\(max-height:620px\)/);
});
