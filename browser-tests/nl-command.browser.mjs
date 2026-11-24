// Typed map command (Gate 2) — real-browser regressions.
//
// The parser, resolver and preview model are covered by tests/nl_command.test.mjs
// and the command core by tests/spatial_command.test.mjs + spatial-command.browser.mjs.
// THIS suite settles what only the running application can:
//   * the visible panel: open / close, focus, Enter, Escape, labels, live regions;
//   * that a typed instruction, interpreted and executed through the panel, leaves
//     the application in the SAME state, with the SAME per-Lens readings, as the
//     equivalent structured command executed on a SEPARATE page (which
//     spatial-command.browser.mjs in turn proves equal to the manual controls);
//   * that every refusal, ambiguity and stale interpretation changes NOTHING;
//   * Spanish, and the phone layout.
//
// Expected states are produced on a separate page by the Gate 1 seam, so no
// expectation is derived from the panel under test.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".css": "text/css", ".geojson": "application/geo+json", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== path.join(ROOT, "index.html")) return response.writeHead(403).end();
  fs.readFile(target, (error, content) => (error
    ? response.writeHead(404).end()
    : response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" }).end(content)));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function openApp(t, { viewport = { width: 1280, height: 900 }, language } = {}) {
  const context = await browser.newContext({ viewport });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.message)));
  await page.route("**/*", (route) => (new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort()));
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.__GEO_SEARCH_TEST__.whenModuleReady());
  await page.waitForFunction(() => {
    const status = window.__GEO_SEARCH_TEST__.snapshot().universeStatus;
    return status.administrative === "ready" && status.ambito === "ready";
  });
  if (language) { await page.selectOption("#languageSelect", language); await frames(page); }
  await frames(page);
  return { page, errors };
}

// Everything an equivalence claim is judged on (the Gate 1 suite's own list).
async function world(page) {
  await frames(page);
  return page.evaluate(() => ({
    k11State: window.__HALO_REGRESSION__.k11State(),
    readings: window.__SPATIAL_COMMAND_TEST__.readings(),
    view: window.__HALO_REGRESSION__.mapView(),
    state: window.__SPATIAL_COMMAND_TEST__.state(),
    slider: document.getElementById("radiusSlider").value,
    radiusText: document.getElementById("radiusText").textContent,
  }));
}

const run = (page, command) => page.evaluate((c) => window.__SPATIAL_COMMAND_TEST__.execute(c), command);
const D = (code) => ({ type: "official_area", id: `DISTRICT:${code}` });

async function openPanel(page) {
  await page.click("#nlCommandToggle");
  await page.waitForSelector("#nlCommandPanel:not([hidden])");
}
async function interpret(page, text) {
  await page.fill("#nlCommandInput", text);
  await page.press("#nlCommandInput", "Enter");
  await frames(page);
}
const statusText = (page) => page.textContent("#nlCommandStatus");
const outputText = (page) => page.textContent("#nlCommandOutput");
const executeVisible = async (page) => (await page.locator("#nlCommandExecute").isVisible()) && !(await page.locator("#nlCommandExecute").isDisabled());

// ---------------------------------------------------------------- panel & a11y

test("the panel is discoverable, labelled, keyboard-operable and closed by default", async (t) => {
  const { page, errors } = await openApp(t);
  assert.equal(await page.locator("#nlCommandPanel").isHidden(), true);
  const toggle = await page.evaluate(() => {
    const b = document.getElementById("nlCommandToggle");
    const box = b.getBoundingClientRect();
    return { label: b.getAttribute("aria-label"), expanded: b.getAttribute("aria-expanded"), controls: b.getAttribute("aria-controls"), w: box.width, h: box.height, text: b.textContent.trim() };
  });
  assert.equal(toggle.label, "Open the map command panel");
  assert.equal(toggle.expanded, "false");
  assert.equal(toggle.controls, "nlCommandPanel");
  assert.ok(toggle.h >= 44 && toggle.w >= 44, `toggle target ${toggle.w}x${toggle.h}`);

  await page.focus("#nlCommandToggle");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#nlCommandPanel:not([hidden])");
  const open = await page.evaluate(() => {
    const panel = document.getElementById("nlCommandPanel");
    const input = document.getElementById("nlCommandInput");
    return {
      expanded: document.getElementById("nlCommandToggle").getAttribute("aria-expanded"),
      focusIsInput: document.activeElement === input,
      role: panel.getAttribute("role"),
      labelledBy: document.getElementById(panel.getAttribute("aria-labelledby")).textContent.trim(),
      inputLabel: document.querySelector('label[for="nlCommandInput"]').textContent.trim(),
      statusRole: document.getElementById("nlCommandStatus").getAttribute("role"),
      outputLive: document.getElementById("nlCommandOutput").getAttribute("aria-live"),
      scope: panel.querySelector(".nl-command-scope").textContent,
      examples: [...document.querySelectorAll("#nlCommandExampleList button")].map((b) => b.textContent),
      mic: document.querySelectorAll("#nlCommandPanel [id*=mic i], #nlCommandPanel [class*=mic i], #nlCommandPanel [aria-label*=micr i]").length,
    };
  });
  assert.equal(open.expanded, "true");
  assert.equal(open.focusIsInput, true, "opening moves focus to the labelled field");
  assert.equal(open.role, "dialog");
  assert.equal(open.labelledBy, "Map command");
  assert.match(open.inputLabel, /short instruction/);
  assert.equal(open.statusRole, "status");
  assert.equal(open.outputLive, "polite");
  assert.match(open.scope, /not an assistant/);
  assert.equal(open.examples.length, 4);
  assert.equal(open.mic, 0);

  // Escape closes, returns focus to the opener, and leaves the map as it was.
  const before = await world(page);
  await page.keyboard.press("Escape");
  await page.waitForSelector("#nlCommandPanel", { state: "hidden" });
  assert.equal(await page.evaluate(() => document.activeElement.id), "nlCommandToggle");
  assert.equal(await page.getAttribute("#nlCommandToggle", "aria-expanded"), "false");
  assert.deepEqual(await world(page), before);
  assert.deepEqual(errors, []);
});

test("Enter interprets but never executes; Execute alone applies a validated interpretation", async (t) => {
  const { page, errors } = await openApp(t);
  await openPanel(page);
  const before = await world(page);
  await interpret(page, "Compara dos círculos de 500 metros en Barajas y Hortaleza.");
  assert.match(await statusText(page), /nothing has changed yet/);
  assert.match(await outputText(page), /circle of 500 m/);
  assert.match(await outputText(page), /not administrative boundaries/);
  assert.match(await outputText(page), /NOT the complete official area/, "the circle-not-area warning is in the preview");
  assert.equal(await executeVisible(page), true);
  assert.deepEqual(await world(page), before, "Enter alone changed nothing");
  await page.press("#nlCommandInput", "Enter"); // a second Enter re-interprets, still nothing applied
  assert.deepEqual(await world(page), before);

  await page.click("#nlCommandExecute");
  await frames(page);
  assert.match(await statusText(page), /^Executed:/);
  assert.match(await outputText(page), /NOT the complete official area/, "the scope warning outlives execution");
  assert.equal(await page.locator("#nlCommandExecute").isVisible(), false, "the action row is gone after execution");

  // Equivalence with the structured command on a SEPARATE page.
  const reference = await openApp(t);
  const receipt = await run(reference.page, { version: 1, action: "compare_locations", a: { location: D("21"), radiusM: 500 }, b: { location: D("16"), radiusM: 500 } });
  assert.equal(receipt.status, "applied");
  assert.deepEqual(await world(page), await world(reference.page));
  assert.deepEqual(errors, []);
});

// -------------------------------------------------- equivalence for each family

const FAMILIES = [
  { name: "navigate_to_location", text: "Ve a Barajas.", command: { version: 1, action: "navigate_to_location", location: D("21") }, setup: null },
  { name: "set_lens_location", text: "Set Lens A to Hortaleza.", command: { version: 1, action: "set_lens_location", lens: "A", location: D("16") }, setup: null },
  {
    name: "set_lens_radius",
    text: "Cambia el radio de Lens B a 800 metros.",
    command: { version: 1, action: "set_lens_radius", lens: "B", radiusM: 800 },
    setup: { version: 1, action: "compare_locations", a: { location: D("21") }, b: { location: D("05") } },
  },
  { name: "compare_locations (individual radii)", text: "Compara un círculo de 500 metros en Barajas con otro de 1 km en Chamartín.", command: { version: 1, action: "compare_locations", a: { location: D("21"), radiusM: 500 }, b: { location: D("05"), radiusM: 1000 } }, setup: null },
];

for (const family of FAMILIES) {
  test(`typed ${family.name} equals the structured command's resulting state and readings`, async (t) => {
    const { page, errors } = await openApp(t);
    if (family.setup) assert.equal((await run(page, family.setup)).status, "applied");
    await openPanel(page);
    await interpret(page, family.text);
    assert.equal(await executeVisible(page), true, family.text);
    await page.click("#nlCommandExecute");
    await frames(page);
    assert.match(await statusText(page), /^Executed:/);
    const reference = await openApp(t);
    if (family.setup) assert.equal((await run(reference.page, family.setup)).status, "applied");
    assert.equal((await run(reference.page, family.command)).status, "applied");
    assert.deepEqual(await world(page), await world(reference.page));
    assert.deepEqual(errors, []);
  });
}

// -------------------------------------------------- refusals change nothing

test("unsupported, unknown, invalid and contradictory instructions are refused without any state change", async (t) => {
  const { page, errors } = await openApp(t);
  await openPanel(page);
  const before = await world(page);
  const cases = [
    ["¿Cuántos hoteles hay en Barajas?", /not supported/],
    ["Ve a Lavapiés", /not an official district/],
    ["Go to Malasaña", /Informal names are never translated/],
    ["Cambia el radio de Lens A a 125 metros", /not allowed.*Nothing was rounded/],
    ["Cambia el radio de Lens A a 1.500 m", /ambiguous/],
    ["Cambia el radio de Lens A a 800", /needs a unit/],
    ["Cambia el radio de Lens A", /radius is missing/],
    ["Cambia el radio a 800 metros", /which Lens/],
    ["Cambia el radio de Lens A a 500 m y 800 m", /contradicts itself/],
    ["Compara los distritos de Barajas y Hortaleza", /Only two circular Lens windows/],
    ["Cambia el radio de Lens B a 800 metros", /Lens B is not enabled/], // PLACE mode, B disabled
    ["Coloca Lens A en Madrid", /whole municipality/],
    ["", /Type an instruction first/],
  ];
  for (const [text, expected] of cases) {
    await interpret(page, text);
    assert.match(await statusText(page), expected, text);
    assert.equal(await executeVisible(page), false, `no Execute offered for: ${text}`);
    assert.equal(await page.getAttribute("#nlCommandPanel", "data-state"), "rejected", text);
  }
  assert.equal(cases.length, 13);
  assert.deepEqual(await world(page), before, "no refusal moved the map or a Lens");
  assert.deepEqual(errors, []);
});

test("an ambiguous official name needs an explicit choice; Enter cannot bypass it", async (t) => {
  const { page, errors } = await openApp(t);
  await openPanel(page);
  const before = await world(page);
  await interpret(page, "Ve a Carabanchel");
  assert.match(await statusText(page), /More than one official place/);
  const options = await page.$$eval("#nlCommandOutput .nl-command-choices button", (buttons) => buttons.map((b) => ({ id: b.dataset.id, aria: b.getAttribute("aria-label"), text: b.textContent })));
  assert.deepEqual(options.map((o) => o.id).sort(), ["AMBITO:UZI.0.10", "DISTRICT:11"]);
  for (const option of options) {
    assert.match(option.aria, /^Use (Official district|Planning ámbito) /, "each choice names its geographic type");
    assert.match(option.text, /Official district|Planning ámbito/);
  }
  assert.equal(await executeVisible(page), false, "no Execute before a choice");
  await page.press("#nlCommandInput", "Enter");
  assert.equal(await executeVisible(page), false, "Enter re-interprets; it does not pick the first candidate");
  assert.deepEqual(await world(page), before);

  await page.click('#nlCommandOutput button[data-id="DISTRICT:11"]');
  await frames(page);
  assert.equal(await executeVisible(page), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), "nlCommandExecute", "focus moves to Execute after the choice");
  assert.deepEqual(await world(page), before, "choosing does not execute");
  await page.keyboard.press("Enter");
  await frames(page);
  const reference = await openApp(t);
  assert.equal((await run(reference.page, { version: 1, action: "navigate_to_location", location: D("11") })).status, "applied");
  assert.deepEqual(await world(page), await world(reference.page));
  assert.deepEqual(errors, []);
});

test("'Compara Barajas y Hortaleza' asks what is compared and executes nothing until the circle reading is adopted", async (t) => {
  const { page, errors } = await openApp(t);
  await openPanel(page);
  const before = await world(page);
  await interpret(page, "Compara Barajas y Hortaleza");
  assert.match(await statusText(page), /does not say what is compared/);
  assert.match(await statusText(page), /cannot compare whole districts or barrios/);
  assert.equal(await executeVisible(page), false);
  assert.equal(await page.getAttribute("#nlCommandPanel", "data-state"), "clarify");
  await page.click("#nlCommandAdopt");
  await frames(page);
  assert.equal(await executeVisible(page), true);
  assert.match(await outputText(page), /Compare two Lens circles \(not administrative boundaries\)/);
  assert.deepEqual(await world(page), before, "adopting a reading does not execute it");
  await page.click("#nlCommandExecute");
  await frames(page);
  const reference = await openApp(t);
  await run(reference.page, { version: 1, action: "compare_locations", a: { location: D("21") }, b: { location: D("16") } });
  assert.deepEqual(await world(page), await world(reference.page));
  assert.deepEqual(errors, []);
});

test("a preview that no longer describes the map is not executed: renewed confirmation is required", async (t) => {
  const { page, errors } = await openApp(t);
  assert.equal((await run(page, { version: 1, action: "compare_locations", a: { location: D("21") }, b: { location: D("05") } })).status, "applied");
  await openPanel(page);
  await interpret(page, "Cambia el radio de Lens A a 750 metros");
  assert.equal(await executeVisible(page), true);
  // The map changes behind the preview (here: the same radius is set elsewhere).
  assert.equal((await run(page, { version: 1, action: "set_lens_radius", lens: "A", radiusM: 750 })).status, "applied");
  const changed = await world(page);
  await page.click("#nlCommandExecute");
  await frames(page);
  assert.match(await statusText(page), /map changed after this interpretation was shown/);
  assert.equal(await page.getAttribute("#nlCommandPanel", "data-state"), "stale");
  assert.deepEqual(await world(page), changed, "the stale confirmation executed nothing");
  assert.equal(await executeVisible(page), true, "the updated interpretation can be confirmed again");
  assert.match(await outputText(page), /already in this state/);
  await page.click("#nlCommandExecute");
  await frames(page);
  assert.match(await statusText(page), /^No change/);
  assert.deepEqual(errors, []);
});

test("editing the text discards the interpretation; closing discards it too", async (t) => {
  const { page, errors } = await openApp(t);
  await openPanel(page);
  await interpret(page, "Ve a Barajas");
  assert.equal(await executeVisible(page), true);
  await page.fill("#nlCommandInput", "Ve a Hortaleza");
  assert.equal(await executeVisible(page), false, "the stale interpretation of other text cannot be executed");
  await interpret(page, "Ve a Barajas");
  await page.click("#nlCommandClose");
  await openPanel(page);
  assert.equal(await executeVisible(page), false, "a reopened panel holds no interpretation");
  assert.equal(await page.getAttribute("#nlCommandPanel", "data-state"), "idle");
  assert.deepEqual(errors, []);
});

test("the supported examples fill the field and interpret in English and Spanish", async (t) => {
  for (const language of ["en", "es"]) {
    const { page, errors } = await openApp(t, { language });
    await openPanel(page);
    const labels = await page.$$eval("#nlCommandExampleList button", (b) => b.map((x) => x.textContent));
    assert.equal(labels.length, 4);
    // Open the disclosure and use each example the way a person would.
    await page.evaluate(() => { document.getElementById("nlCommandExamples").open = true; });
    for (let i = 0; i < 4; i += 1) {
      await page.click(`#nlCommandExampleList li:nth-child(${i + 1}) button`);
      assert.equal(await page.inputValue("#nlCommandInput"), labels[i]);
      await page.press("#nlCommandInput", "Enter");
      await frames(page);
      const state = await page.getAttribute("#nlCommandPanel", "data-state");
      // Example 3 sets Lens B's radius, which needs Lens B (PLACE mode): refused by the core, not misread.
      assert.equal(state, i === 2 ? "rejected" : "preview", `${language} example ${i + 1}: ${labels[i]}`);
    }
    assert.deepEqual(errors, []);
  }
});

test("the interface and the preview follow the page language (Spanish)", async (t) => {
  const { page, errors } = await openApp(t, { language: "es" });
  assert.equal(await page.getAttribute("#nlCommandToggle", "aria-label"), "Abrir el panel de comandos del mapa");
  await openPanel(page);
  assert.equal((await page.textContent("#nlCommandTitle")).trim(), "Comando de mapa");
  await interpret(page, "Compara dos círculos de 500 metros en Barajas y Hortaleza");
  assert.match(await statusText(page), /todavía no ha cambiado nada/);
  assert.match(await outputText(page), /Lente A: círculo de 500 m/);
  assert.match(await outputText(page), /NO es el área oficial completa/);
  await interpret(page, "Ve a Narnia");
  assert.match(await statusText(page), /no es un distrito, barrio/);
  // The language can change while an interpretation is shown: it re-renders, never re-executes.
  await interpret(page, "Ve a Barajas");
  await page.selectOption("#languageSelect", "en");
  await frames(page);
  assert.match(await outputText(page), /Frame the map on Official district Barajas/);
  assert.deepEqual(errors, []);
});

// ---------------------------------------------------------------- phone layout

test("on a phone the command entry is reached through the place finder, and panel and targets stay inside the viewport", async (t) => {
  const { page, errors } = await openApp(t, { viewport: { width: 375, height: 812 } });
  const geometry = () => page.evaluate(() => {
    const rect = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; };
    return { finder: rect("geoSearchToggle"), scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, innerH: window.innerHeight };
  });
  // The header has no room for another control here (the existing header tests pin its
  // layout), so the header button does not exist at this width and the finder holds the entry.
  assert.equal(await page.locator("#nlCommandToggle").isVisible(), false, "no sixth control is squeezed into the phone header");
  const closed = await geometry();
  assert.ok(closed.scrollW <= closed.innerW, "no horizontal page scroll");
  await page.click("#geoSearchToggle");
  await page.waitForSelector("#nlCommandFromFinder", { state: "visible" });
  const entry = await page.evaluate(() => { const b = document.getElementById("nlCommandFromFinder"); const r = b.getBoundingClientRect(); return { h: r.height, w: r.width, text: b.textContent.trim(), right: r.right, left: r.left }; });
  assert.equal(entry.text, "Type a map command");
  assert.ok(entry.h >= 44 && entry.left >= 0 && entry.right <= 375, `entry ${JSON.stringify(entry)}`);
  await page.click("#nlCommandFromFinder");
  await page.waitForSelector("#nlCommandPanel:not([hidden])");
  assert.equal(await page.evaluate(() => document.activeElement.id), "nlCommandInput");
  assert.equal(await page.evaluate(() => document.getElementById("geoSearchPanel").dataset.open), "false", "the finder closed");
  await interpret(page, "Compara dos círculos de 500 metros en Barajas y Hortaleza");
  const open = await page.evaluate(() => {
    const panel = document.getElementById("nlCommandPanel").getBoundingClientRect();
    const targets = ["nlCommandInput", "nlCommandInterpret", "nlCommandExecute", "nlCommandCancel", "nlCommandClose"].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { id, h: r.height, w: r.width }; });
    return { panel: { x: panel.x, right: panel.right, bottom: panel.bottom }, targets, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, innerH: window.innerHeight };
  });
  assert.ok(open.panel.x >= 0 && open.panel.right <= open.innerW, `panel ${open.panel.x}..${open.panel.right} within ${open.innerW}`);
  assert.ok(open.panel.bottom <= open.innerH, "the panel fits the viewport height (it scrolls internally)");
  assert.ok(open.scrollW <= open.innerW, "no horizontal page scroll with the panel open");
  for (const target of open.targets) assert.ok(target.h >= 44 && target.w >= 44, `${target.id} is ${target.w}x${target.h}`);
  await page.click("#nlCommandExecute");
  await frames(page);
  assert.match(await statusText(page), /^Executed:/);
  assert.deepEqual(errors, []);
});

test("the header command button exists only on a wide header; narrower widths use the finder entry", async (t) => {
  const { page, errors } = await openApp(t);
  const at = async (width) => {
    await page.setViewportSize({ width, height: 800 });
    await frames(page);
    return page.evaluate(() => ({
      header: getComputedStyle(document.getElementById("nlCommandToggle")).display,
      entry: getComputedStyle(document.getElementById("nlCommandFromFinder")).display,
      inline: document.getElementById("geoSearchPanel").dataset.presentation,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
  };
  const wide = await at(1440);
  assert.equal(wide.inline, "inline");
  assert.equal(wide.header, "flex", "wide header: the labelled button is shown");
  assert.equal(wide.entry, "none", "wide header: the finder entry is not duplicated");
  for (const width of [390, 768, 1000]) {
    const narrow = await at(width);
    assert.equal(narrow.header, "none", `${width}px: the header gains no control`);
    assert.equal(narrow.entry, "flex", `${width}px: the finder entry is the way in`);
    assert.ok(narrow.overflow <= 1, `${width}px: no horizontal overflow`);
  }
  assert.deepEqual(errors, []);
});

test("opening the place finder closes the command panel and vice versa; neither moves the map", async (t) => {
  const { page, errors } = await openApp(t);
  const before = await world(page);
  await openPanel(page);
  // Wide headers expose the finder's field inline (its activator is hidden there).
  await page.click("#geoSearchQuery");
  await frames(page);
  assert.equal(await page.locator("#nlCommandPanel").isHidden(), true, "the finder replaces the command panel");
  await page.click("#nlCommandToggle");
  await frames(page);
  assert.equal(await page.locator("#nlCommandPanel").isVisible(), true);
  assert.equal(await page.evaluate(() => document.getElementById("geoSearchPanel").dataset.open), "false", "the finder closed");
  assert.deepEqual(await world(page), before);
  assert.deepEqual(errors, []);
});
