// Search surface contract (Lens Search UX V2, package 1).
//
// The finder's result surface is an INTERACTION state, not a consequence of the
// Question Explorer having loaded. These regressions pin that contract in a real
// browser: nothing covers the map at idle, the inline field never overlaps the
// header controls, dismissal behaves as specified, and the Guided Tour can
// always reach its search target. Search logic itself is covered by
// geo-search.browser.mjs and tests/geo_search.test.mjs.
//
// GEOSEARCH_ROOT serves another checkout (the "before" evidence) and
// GEOSEARCH_BROWSER=webkit selects Safari's engine, as in the sibling suite.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";

const ROOT = process.env.GEOSEARCH_ROOT
  ? path.resolve(process.env.GEOSEARCH_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = process.env.GEOSEARCH_BROWSER === "webkit" ? webkit : chromium;
const CAPTURE_DIR = process.env.SEARCH_SURFACE_CAPTURE_DIR || null;
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
const browser = await ENGINE.launch({ headless: true });

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

// The Question Explorer is loaded on idle in production. Tests force it so the
// regression is deterministic: "ready" is exactly the state that used to force
// the surface open.
// Looping tests create many pages. WebKit closes the whole browser when dozens
// of contexts stay open at once, so only the most recent one is kept alive.
let openContext = null;
async function track(context, t) {
  if (openContext) await openContext.close().catch(() => {});
  openContext = context;
  t.after(() => context.close().catch(() => {}));
}

async function pageFor({ viewport = { width: 1280, height: 900 }, colorScheme = "light", language = "en" } = {}) {
  const context = await browser.newContext({ viewport, colorScheme });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.message)));
  await page.route("**/*", (route) => (new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort()));
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const api = window.__GEO_SEARCH_TEST__;
    if (!api) return false;
    const status = api.snapshot().universeStatus;
    return status.administrative !== "loading" && status.ambito !== "loading";
  });
  await page.evaluate(() => window.__QUESTION_EXPLORER_TEST__.whenReady());
  await page.waitForFunction(() => document.querySelector("#geoSearchPanel").dataset.questionExplorer === "ready");
  // Tests that are not about the loading state start from a resolved resolver (the cold-load case has its own test).
  await page.waitForFunction(() => document.querySelector("#geoSearchPanel").dataset.state === "ready");
  if (language !== "en") {
    await page.selectOption("#languageSelect", language);
    await page.waitForTimeout(150);
  }
  return { page, context, errors };
}

const snapshot = (page) => page.evaluate(() => window.__GEO_SEARCH_TEST__.snapshot());
const world = (page) => page.evaluate(() => ({
  view: window.__HALO_REGRESSION__.mapView(),
  centres: window.__HALO_REGRESSION__.lensCenters(),
  radii: window.__GEO_SEARCH_TEST__.radii(),
  mode: document.querySelector("#analysisPanel").dataset.mode,
}));
const surfaceVisible = (page) => page.locator(".geo-search-surface").isVisible();
const activeId = (page) => page.evaluate(() => document.activeElement && document.activeElement.id);

async function headerGeometry(page) {
  return page.evaluate(() => {
    const box = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right }; };
    return {
      presentation: document.querySelector("#geoSearchPanel").dataset.presentation,
      brand: box(".brand"),
      field: box("#geoSearchQuery"),
      tools: box(".header-tools"),
    };
  });
}

async function capture(page, name) {
  if (CAPTURE_DIR) {
    fs.mkdirSync(CAPTURE_DIR, { recursive: true });
    await page.screenshot({ path: path.join(CAPTURE_DIR, `${name}.png`) });
  }
}

// ----------------------------------------------------------------- idle

test("idle: a ready Question Explorer never opens the search surface over the map", async (t) => {
  for (const width of [1024, 1280, 1440, 1536]) {
    const { page, context, errors } = await pageFor({ viewport: { width, height: 900 } });
    await track(context, t);
    const geometry = await headerGeometry(page);
    if (width >= 1280) assert.equal(geometry.presentation, "inline", `${width}px exposes the inline field`);
    assert.equal(await surfaceVisible(page), false, `${width}px: no surface at idle`);
    assert.equal(await page.locator("#geoSearchQuestions").isVisible(), false, `${width}px: the disclosure is part of the closed surface`);
    assert.deepEqual(errors, []);
    if (width === 1536 || width === 1280) await capture(page, `idle-${width}`);
  }
});

test("idle: the surface contains no instructional copy before the reader acts", async (t) => {
  const { page, context } = await pageFor({ viewport: { width: 1440, height: 900 } });
  await track(context, t);
  const box = await page.locator(".geo-search-surface").boundingBox();
  assert.ok(!box || box.width === 0 || box.height === 0, "the surface occupies no area at idle");
});

// ------------------------------------------------------ header geometry

test("the inline field never overlaps the brand or the header controls, in EN and ES", async (t) => {
  for (const language of ["en", "es"]) {
    for (const width of [1024, 1100, 1280, 1440, 1536]) {
      const { page, context } = await pageFor({ viewport: { width, height: 900 }, language });
      await track(context, t);
      const g = await headerGeometry(page);
      if (g.presentation !== "inline") continue;
      assert.ok(g.field.left >= g.brand.right + 11.5, `${language}/${width}: field clears the brand (${g.field.left} vs ${g.brand.right})`);
      assert.ok(g.field.right <= g.tools.left - 11.5, `${language}/${width}: field clears the tools (${g.field.right} vs ${g.tools.left})`);
    }
  }
});

test("an inline field never inherits the overlay's corridor placement", async (t) => {
  const { page, context } = await pageFor({ viewport: { width: 1440, height: 900 } });
  await track(context, t);
  const state = await page.evaluate(() => {
    const panel = document.querySelector("#geoSearchPanel");
    return { placement: panel.dataset.placement || null, left: getComputedStyle(panel).left, leftVar: document.documentElement.style.getPropertyValue("--geo-search-left") };
  });
  assert.notEqual(state.placement, "corridor");
  assert.equal(state.left, "0px");
  assert.equal(state.leftVar, "");
});

// ------------------------------------------------------ interaction

test("focusing, clicking or typing opens the surface and moves nothing", async (t) => {
  const { page, context } = await pageFor();
  await track(context, t);
  const before = await world(page);
  await page.locator("#geoSearchQuery").click();
  assert.equal(await surfaceVisible(page), true, "activating the field opens the surface");
  assert.equal(await page.locator("#geoSearchPanel").getAttribute("data-open"), "true");
  assert.equal(await page.locator("#geoSearchQuestions").isVisible(), true, "the Evidence Questions entry is offered");
  assert.equal(await page.locator("#geoSearchQuestions").evaluate((node) => node.open), false, "the explorer itself stays collapsed");
  await capture(page, "activated");
  await page.keyboard.type("Palacio");
  await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
  assert.equal(await surfaceVisible(page), true);
  await capture(page, "typing");
  assert.deepEqual(await world(page), before, "typing moves no Lens, camera, radius or mode");
  assert.equal((await snapshot(page)).cameraMoves, 0);
});

test("Escape closes the surface, clears query, selection and highlight, and keeps focus in the field", async (t) => {
  const { page, context } = await pageFor();
  await track(context, t);
  await page.locator("#geoSearchQuery").fill("APR.02.09");
  await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
  await page.locator("#geoSearchResults button").first().click();
  await page.waitForFunction(() => !document.querySelector("#geoSearchCard").hasAttribute("hidden"));
  assert.equal((await snapshot(page)).selectedLayer, true);
  const before = await world(page);
  await page.locator("#geoSearchQuery").focus();
  await page.keyboard.press("Escape");
  const after = await snapshot(page);
  assert.equal(await surfaceVisible(page), false);
  assert.equal(after.query, "");
  assert.equal(after.selectedId, null);
  assert.equal(after.selectedLayer, false, "no unexplained outline remains");
  assert.equal(await page.locator("#geoSearchQuery").inputValue(), "");
  assert.equal(await activeId(page), "geoSearchQuery");
  assert.equal(await surfaceVisible(page), false, "restoring focus does not reopen the surface");
  assert.deepEqual(await world(page), before);
});

test("an outside click closes the surface, keeps the query, clears the selection and passes the click through", async (t) => {
  const { page, context } = await pageFor();
  await track(context, t);
  await page.locator("#geoSearchQuery").fill("APR.02.09");
  await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
  await page.locator("#geoSearchResults button").first().click();
  await page.waitForFunction(() => !document.querySelector("#geoSearchCard").hasAttribute("hidden"));
  const lens = (await world(page)).centres;

  await page.locator("#modeCompareButton").click();
  await page.waitForFunction(() => document.querySelector("#analysisPanel").dataset.mode === "COMPARE");
  const closed = await snapshot(page);
  assert.equal(await surfaceVisible(page), false, "the surface closed");
  assert.equal(await page.locator("#geoSearchQuery").inputValue(), "APR.02.09", "the typed query is retained");
  assert.equal(closed.query, "APR.02.09");
  assert.equal(closed.selectedId, null, "the selection is cleared");
  assert.equal(closed.selectedLayer, false, "the temporary highlight is cleared");
  assert.deepEqual((await world(page)).centres, lens, "the outside click moved no Lens");

  await page.locator("#geoSearchQuery").click();
  await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
  const reopened = await snapshot(page);
  assert.equal(reopened.query, "APR.02.09");
  assert.ok(reopened.results.length > 0, "results are regenerated from the retained query");
  assert.equal(reopened.selectedId, null, "nothing is selected automatically");
  assert.equal(await page.locator("#geoSearchCard").isHidden(), true);
});

test("tabbing out of the surface dismisses it without losing the query", async (t) => {
  const { page, context } = await pageFor();
  await track(context, t);
  await page.locator("#geoSearchQuery").fill("Palacio");
  assert.equal(await surfaceVisible(page), true);
  await page.locator("#languageSelect").focus();
  assert.equal(await surfaceVisible(page), false);
  assert.equal(await page.locator("#geoSearchQuery").inputValue(), "Palacio");
});

// --------------------------------------------------- Evidence Questions

test("Evidence Questions stay discoverable but only open on request, and survive dismissal", async (t) => {
  const { page, context, errors } = await pageFor();
  await track(context, t);
  assert.equal(await page.locator("#geoSearchQuestions").isVisible(), false, "nothing opens merely because the explorer loaded");
  await page.locator("#geoSearchQuery").click();
  await page.locator("#geoSearchQuestions > summary").click();
  await page.waitForFunction(() => document.querySelector("#questionExplorer") && !document.querySelector("#questionExplorer").hidden);
  assert.equal(await page.locator(".qx-q[data-question]").count(), 6);
  assert.equal(await page.locator("#questionExplorer").count(), 1, "one explorer, never a copy");
  const view = await page.evaluate(() => Boolean(window.__QUESTION_EXPLORER_TEST__.view()));
  await page.locator(".qx-q[data-question]").first().press("Escape");
  assert.equal(await surfaceVisible(page), false, "Escape inside the explorer dismisses the surface");
  assert.equal(await page.evaluate(() => Boolean(window.__QUESTION_EXPLORER_TEST__.view())), view, "the explorer instance is retained");
  assert.equal(await page.locator("#questionExplorer").count(), 1);
  await page.locator("#geoSearchQuery").click();
  assert.equal(await page.locator(".qx-q[data-question]").count(), 6, "reopening shows the same explorer");
  assert.deepEqual(errors, []);
});

// ------------------------------------------------------- responsive

test("resizing between inline and compact never carries an open surface or stale placement", async (t) => {
  const { page, context } = await pageFor({ viewport: { width: 1440, height: 900 } });
  await track(context, t);
  await page.locator("#geoSearchQuery").click();
  assert.equal(await surfaceVisible(page), true);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForFunction(() => document.querySelector("#geoSearchPanel").dataset.presentation === "overlay");
  let state = await snapshot(page);
  assert.equal(await page.locator("#geoSearchPanel").getAttribute("data-presentation"), "overlay");
  assert.equal(await page.locator("#geoSearchPanel").isHidden(), true, "compact overlay is closed after the flip");
  assert.equal(state.compactOpen, false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => document.querySelector("#geoSearchPanel").dataset.presentation === "inline");
  assert.equal(await surfaceVisible(page), false, "returning to inline does not reopen the surface");
  const geometry = await headerGeometry(page);
  assert.ok(geometry.field.right <= geometry.tools.left - 11.5, "no overlap on the first frame after the flip");
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#geoSearchPanel")).left), "0px");
});

test("compact: the activator opens the one panel; Escape clears, an outside click keeps the query", async (t) => {
  const { page, context } = await pageFor({ viewport: { width: 768, height: 1024 } });
  await track(context, t);
  assert.equal(await page.locator("#geoSearchToggle").isVisible(), true);
  await page.locator("#geoSearchToggle").click();
  assert.equal(await page.locator("#geoSearchPanel").isHidden(), false);
  assert.equal(await page.locator("#geoSearchToggle").getAttribute("aria-expanded"), "true");
  await page.locator("#geoSearchQuery").fill("Palacio");
  await page.locator(".brand").click();
  assert.equal(await page.locator("#geoSearchPanel").isHidden(), true, "an outside click closes the compact panel");
  await page.locator("#geoSearchToggle").click();
  assert.equal(await page.locator("#geoSearchQuery").inputValue(), "Palacio");
  await page.locator("#geoSearchQuery").press("Escape");
  assert.equal(await page.locator("#geoSearchPanel").isHidden(), true);
  assert.equal(await page.locator("#geoSearchQuery").inputValue(), "");
  assert.equal(await activeId(page), "geoSearchToggle");
});

// ------------------------------------------------------ Guided Tour

test("the Guided Tour search step always has a visible target", async (t) => {
  for (const [width, expected] of [[1440, "geoSearchQuery"], [768, "geoSearchToggle"], [390, "geoSearchToggle"]]) {
    const { page, context } = await pageFor({ viewport: { width, height: 900 } });
    await track(context, t);
    const target = await page.evaluate(() => {
      const node = window.MadridLensTutorial.targetFor(1);
      return node ? node.id : null;
    });
    assert.equal(target, expected, `${width}px search step target`);
  }
});

test("the tour reveals Evidence Questions through the inline field without changing the analytical state", async (t) => {
  const { page, context } = await pageFor({ viewport: { width: 1440, height: 900 } });
  await track(context, t);
  const before = await world(page);
  await page.evaluate(() => window.MadridLensTutorial.start(document.getElementById("tutorialHelpButton")));
  for (let step = 0; step < 5; step += 1) await page.locator("[data-tutorial-next]").click();
  await page.locator("[data-tutorial-navigate]").click();
  await page.waitForFunction(() => document.querySelector("#geoSearchQuestions").open && !document.querySelector("#questionExplorer").hidden);
  assert.equal(await surfaceVisible(page), true, "the tour opened the real surface");
  await page.locator("[data-tutorial-next]").click();
  assert.equal(await surfaceVisible(page), true, "advancing the tour does not dismiss the surface it opened");
  assert.deepEqual(await world(page), before);
});

// ------------------------------------------------------ Cold load

test("a search activation before the deferred resolver arrives is kept, not lost", async (t) => {
  for (const [width, activator] of [[1440, "#geoSearchQuery"], [390, "#geoSearchToggle"]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await track(context, t);
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "127.0.0.1") return route.abort();
      if (url.pathname.endsWith("/geo-search.js")) await new Promise((resolve) => setTimeout(resolve, 3000));
      return route.continue();
    });
    await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
    await page.locator(activator).waitFor({ state: "visible" });
    assert.equal(await page.locator("#geoSearchPanel").getAttribute("data-state"), "loading", `${width}px starts before the resolver`);
    assert.equal(await page.locator("#geoSearchQuery").isDisabled(), false, `${width}px the field is not disabled while loading`);
    await page.locator(activator).click();
    await page.keyboard.type("Palacio");
    assert.equal(await page.locator("#geoSearchPanel").getAttribute("data-open"), "true", `${width}px the first activation opened the surface`);
    assert.equal(await page.locator("#geoSearchQuery").inputValue(), "Palacio", `${width}px the typed text was kept`);
    assert.match(await page.locator("#geoSearchStatus").innerText(), /loading|Cargando/i, `${width}px the surface says it is loading`);
    await page.waitForFunction(() => document.querySelector("#geoSearchPanel").dataset.state === "ready");
    await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
    assert.equal(await page.locator("#geoSearchQuery").inputValue(), "Palacio", `${width}px the query survives resolution`);
    assert.equal(await activeId(page), "geoSearchQuery", `${width}px focus stays in the field`);
  }
});
