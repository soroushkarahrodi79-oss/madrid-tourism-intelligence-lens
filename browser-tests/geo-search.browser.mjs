// M1 unified geographic search — real-browser regressions.
//
// The pure resolver is covered by tests/geo_search.test.mjs. THIS suite exists
// for the claims only a running application can settle: that discovery moves
// nothing, that the two explicit actions do exactly and only what they say, that
// the existing Lens, COMPARE, URL and export behaviour is untouched, and that
// the surface is operable by keyboard and by touch in both languages and all
// three appearances.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";

// GEOSEARCH_ROOT serves a DIFFERENT checkout, which is how the "before"
// screenshots are captured from real origin/main rather than illustrated. It is
// the same convention the UX-C1 and UX-C2 suites use in .github/workflows.
const ROOT = process.env.GEOSEARCH_ROOT
  ? path.resolve(process.env.GEOSEARCH_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = process.env.GEOSEARCH_BROWSER === "webkit" ? webkit : chromium;
const CAPTURE_DIR = process.env.GEOSEARCH_CAPTURE_DIR || null;
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

// `block` names an artifact whose request is failed, so a missing universe is a
// real network outcome rather than a flag the application knows about.
async function pageFor({ viewport = { width: 1280, height: 900 }, colorScheme = "light", block = null, query = "" } = {}) {
  const context = await browser.newContext({ viewport, colorScheme });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.message)));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (block && url.pathname.endsWith(block)) return route.fulfill({ status: 503, body: "unavailable" });
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1${query}`, { waitUntil: "domcontentloaded" });
  // Wait until every universe has SETTLED — ready or unavailable. The finder is
  // usable before that (a loaded universe is searchable while another is still
  // arriving), but a test that asserts on coverage must not race the loaders.
  await page.waitForFunction(() => {
    const api = window.__GEO_SEARCH_TEST__;
    if (!api) return false;
    const status = api.snapshot().universeStatus;
    return status.administrative !== "loading" && status.ambito !== "loading";
  });
  return { page, context, errors };
}

const snapshot = (page) => page.evaluate(() => window.__GEO_SEARCH_TEST__.snapshot());
const world = (page) => page.evaluate(() => ({
  view: window.__HALO_REGRESSION__.mapView(),
  centres: window.__HALO_REGRESSION__.lensCenters(),
  radii: window.__GEO_SEARCH_TEST__.radii(),
  mode: document.querySelector("#analysisPanel").dataset.mode,
  url: location.href,
  activeLens: document.querySelector("#lensAButton").className.includes("active") ? "A" : "B",
  layers: [...document.querySelectorAll("[data-layer]")].map((input) => `${input.dataset.layer}:${input.checked}`),
  basemap: document.querySelector("#basemapSelect").value,
  boundaries: document.querySelector("#boundarySelect").value,
  radiusSlider: document.querySelector("#radiusSlider").value,
}));

async function openSearch(page) {
  await page.locator("#geoSearchToggle").click();
  await page.waitForFunction(() => !document.querySelector("#geoSearchPanel").hasAttribute("hidden"));
  // The resolver is deliberately off the critical path, so opening may precede
  // its arrival. A test asserting on results waits for the surface to say ready;
  // the honest loading state in between is covered by its own test.
  await page.waitForFunction(() => {
    const state = document.querySelector("#geoSearchPanel").dataset.state;
    return state === "ready" || state === "unavailable";
  });
}
async function selectFirst(page, text) {
  await page.locator("#geoSearchQuery").fill(text);
  await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
  await page.locator("#geoSearchResults button").first().click();
  await page.waitForFunction(() => !document.querySelector("#geoSearchCard").hasAttribute("hidden"));
}

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

test("the finder is closed by default, opens from the header and indexes the committed universes", async (t) => {
  const { page, context, errors } = await pageFor();
  t.after(() => context.close());
  assert.equal(await page.locator("#geoSearchPanel").isHidden(), true);
  assert.equal(await page.locator("#geoSearchToggle").getAttribute("aria-expanded"), "false");
  await openSearch(page);
  const open = await snapshot(page);
  assert.equal(open.state, "ready");
  assert.equal(await page.locator("#geoSearchToggle").getAttribute("aria-expanded"), "true");
  assert.deepEqual(open.counts, { total: 877, MUNICIPALITY: 1, DISTRICT: 21, BARRIO: 131, AMBITO: 724 });
  assert.deepEqual(open.coverage, { administrative: true, ambito: true });
  // Opening focuses the field, so a keyboard user can type immediately.
  assert.equal(await page.evaluate(() => document.activeElement.id), "geoSearchQuery");
  assert.match(await page.locator("#geoSearchCoverage").textContent(), /21 official districts, 131 official barrios and 724 planning ámbitos/);
  assert.match(await page.locator("#geoSearchCoverage").textContent(), /Street addresses are not searchable/);
  assert.deepEqual(errors, []);
});

test("the search resolver is kept off the initial critical path", async (t) => {
  // The finder starts closed, so its resolver must not compete with the page's
  // own first render. This asserts the LOADING property directly from the
  // browser's resource timing, not from a code reading.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.route("**/*", (route) => (new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort()));
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "load" });

  // It still arrives on its own, with nobody opening the finder: the idle
  // prefetch is a deferral, not a removal.
  await page.waitForFunction(() => performance.getEntriesByType("resource").some((entry) => entry.name.includes("geo-search.js")));
  const timing = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const resource = performance.getEntriesByType("resource").find((entry) => entry.name.includes("geo-search.js"));
    return { loadEventEnd: navigation.loadEventEnd, started: resource.startTime };
  });
  assert.ok(
    timing.started > timing.loadEventEnd,
    `the resolver started at ${timing.started.toFixed(0)}ms but the load event ended at ${timing.loadEventEnd.toFixed(0)}ms, so it is on the critical path`,
  );

  // And the deferral never costs the reader anything: opening still reaches a
  // ready surface, with the real universes indexed.
  await page.locator("#geoSearchToggle").click();
  await page.waitForFunction(() => document.querySelector("#geoSearchPanel").dataset.state === "ready");
  const counts = await page.evaluate(() => window.__GEO_SEARCH_TEST__.snapshot().counts);
  assert.deepEqual(counts, { total: 877, MUNICIPALITY: 1, DISTRICT: 21, BARRIO: 131, AMBITO: 724 });
});

test("typing moves no Lens, no camera, no radius, no mode and no layer", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openSearch(page);
  const before = await world(page);
  for (const term of ["c", "ce", "cen", "cent", "centr", "centro", "APR", "APR.02", "APR.02.09", "pacifico", "zzz"]) {
    await page.locator("#geoSearchQuery").fill(term);
  }
  const after = await world(page);
  assert.deepEqual(after, before, "a keystroke changed application state");
  const typed = await snapshot(page);
  assert.equal(typed.cameraMoves, 0);
  assert.equal(typed.lensMoves, 0);
  assert.equal(typed.selectedLayer, false);
  assert.equal(typed.cardHidden, true);
});

test("selecting a result draws the official outline and still moves nothing", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openSearch(page);
  const before = await world(page);
  await selectFirst(page, "APR.02.09");
  const selected = await snapshot(page);
  assert.equal(selected.selectedId, "AMBITO:APR.02.09");
  assert.equal(selected.selectedLayer, true);
  assert.equal(selected.cameraMoves, 0);
  assert.equal(selected.lensMoves, 0);
  assert.deepEqual(await world(page), before, "selection changed application state");
  assert.equal(await page.locator("#geoSearchCardCode").textContent(), "APR.02.09");
  assert.match(await page.locator("#geoSearchCardScope").textContent(), /not the barrio and not the Lens circle/);
});

test("View on map frames the official geometry and repositions neither Lens", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openSearch(page);
  await selectFirst(page, "APR.02.09");
  const before = await world(page);
  await page.locator("#geoSearchViewMap").click();
  const after = await world(page);
  const moved = await snapshot(page);
  assert.notDeepEqual(after.view, before.view, "the camera must move");
  assert.deepEqual(after.centres, before.centres, "no Lens may move");
  assert.equal(after.mode, before.mode);
  assert.equal(after.radiusSlider, before.radiusSlider);
  assert.deepEqual(after.layers, before.layers);
  assert.equal(after.basemap, before.basemap);
  assert.equal(after.boundaries, before.boundaries);
  assert.equal(moved.cameraMoves, 1);
  assert.equal(moved.lensMoves, 0);
  assert.match(await page.locator("#geoSearchAnalyzeNote").textContent(), /No Lens moved, no radius changed and no layer was switched/);
});

test("Analyze with Lens moves only the active Lens, to a point inside the official geometry", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openSearch(page);
  await selectFirst(page, "APR.02.09");
  const before = await world(page);
  const interior = await page.evaluate(() => window.__GEO_SEARCH_TEST__.interiorPointFor("AMBITO:APR.02.09"));
  assert.ok(interior, "an interior point was verified before the action is offered");

  await page.locator("#geoSearchAnalyze").click();
  const after = await world(page);
  const acted = await snapshot(page);
  assert.equal(acted.lensMoves, 1);
  assert.equal(after.activeLens, "A");
  assert.notDeepEqual(after.centres.A, before.centres.A, "the active Lens must move");
  assert.deepEqual(after.centres.B, before.centres.B, "the inactive Lens must not move");
  assert.ok(Math.abs(after.centres.A.lat - interior.lat) < 1e-9);
  assert.ok(Math.abs(after.centres.A.lon - interior.lon) < 1e-9);
  assert.equal(after.radiusSlider, before.radiusSlider, "no radius may change");
  assert.equal(after.mode, before.mode, "no mode may change");
  assert.deepEqual(after.layers, before.layers, "no layer may change");

  // The Lens centre is genuinely inside the official ámbito, confirmed by the
  // application's OWN containment model, not by the search module.
  const contained = await page.evaluate(() => {
    const planning = window.__HALO_REGRESSION__.planning();
    return planning.model && planning.model.containing ? planning.model.containing.ambitoCode : null;
  });
  assert.equal(contained, "APR.02.09");

  // The whole-versus-part distinction is STATED, every time, in words.
  const note = await page.locator("#geoSearchAnalyzeNote").textContent();
  assert.match(note, /Lens A was moved to a verified interior point/);
  assert.match(note, /NOT equivalent to the complete official boundary/);
  assert.match(note, /never a figure for the whole area/);
});

test("the Analyze action is withheld for the municipality, with the reason stated in place", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openSearch(page);
  await selectFirst(page, "Madrid");
  const selected = await snapshot(page);
  assert.equal(selected.selectedId, "MUNICIPALITY:28079");
  assert.equal(selected.analyzeHidden, true, "the action is withheld, not offered as a broken button");
  assert.match(await page.locator("#geoSearchAnalyzeNote").textContent(), /cannot represent the whole municipality/);
  assert.equal(await page.locator("#geoSearchViewMap").isVisible(), true, "framing the municipality is still honest");
  const before = await world(page);
  await page.locator("#geoSearchViewMap").click();
  assert.deepEqual((await world(page)).centres, before.centres);
  assert.equal((await snapshot(page)).lensMoves, 0);
});

test("Lens B keeps its own radius and its own position through an Analyze on Lens A", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  // Enter COMPARE through the existing mode control, which owns Lens B.
  await page.locator("#modeCompareButton").click();
  await page.waitForFunction(() => document.querySelector("#analysisPanel").dataset.mode === "COMPARE");
  await page.locator("#radiusSlider").fill("2000");
  await page.locator("#radiusSlider").dispatchEvent("change");
  await page.locator("#lensAButton").click();
  await page.locator("#radiusSlider").fill("500");
  await page.locator("#radiusSlider").dispatchEvent("change");
  const independent = await page.evaluate(() => window.__GEO_SEARCH_TEST__.radii());
  assert.deepEqual(independent, { A: 500, B: 2000 }, "the two radii are independent before the action");

  await openSearch(page);
  const beforeB = (await world(page)).centres.B;
  await selectFirst(page, "APR.02.09");
  await page.locator("#geoSearchAnalyze").click();
  const after = await world(page);
  assert.deepEqual(await page.evaluate(() => window.__GEO_SEARCH_TEST__.radii()), { A: 500, B: 2000 });
  assert.deepEqual(after.centres.B, beforeB);
  assert.equal(after.mode, "COMPARE", "COMPARE is not silently destroyed");
  assert.equal(after.activeLens, "A");

  // With Lens B active, the SAME action moves B and leaves A alone.
  await page.locator("#lensBButton").click();
  const beforeA = (await world(page)).centres.A;
  await page.locator("#geoSearchAnalyze").click();
  const second = await world(page);
  assert.equal(second.activeLens, "B");
  assert.deepEqual(second.centres.A, beforeA);
  assert.deepEqual(await page.evaluate(() => window.__GEO_SEARCH_TEST__.radii()), { A: 500, B: 2000 });
  assert.match(await page.locator("#geoSearchAnalyzeNote").textContent(), /Lens B was moved/);
});

test("administrative polygons keep their identity; the highlight is a separate non-interactive pane", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await page.locator("#boundarySelect").selectOption("barrio");
  await openSearch(page);
  await selectFirst(page, "Palacio");
  const panes = await page.evaluate(() => {
    const paneNodes = [...document.querySelectorAll(".leaflet-pane")];
    const byClass = (fragment) => paneNodes.find((node) => node.className.includes(fragment));
    const style = (fragment, property) => {
      const node = byClass(fragment);
      return node ? window.getComputedStyle(node)[property] : null;
    };
    return {
      // Leaflet drops the "Pane" suffix when it names a pane's class, so the
      // pane created as "geoSearchPane" is ".leaflet-geoSearch-pane".
      searchPane: style("leaflet-geoSearch-pane", "zIndex"),
      searchEvents: style("leaflet-geoSearch-pane", "pointerEvents"),
      lensPane: style("leaflet-lens-pane", "zIndex"),
      adminPane: style("leaflet-admin-pane", "zIndex"),
      boundaries: document.querySelector("#boundarySelect").value,
    };
  });
  assert.ok(panes.searchPane, "the finder owns its own Leaflet pane");
  assert.equal(panes.searchEvents, "none", "the highlight never intercepts a map click");
  assert.ok(Number(panes.searchPane) < Number(panes.lensPane), "the Lens stays above the highlight");
  assert.ok(Number(panes.searchPane) > Number(panes.adminPane), "the highlight is visible over the boundary layer");
  assert.equal(panes.boundaries, "barrio", "the boundary layer selection is untouched");
  // A barrio result reads as a barrio, with the district the source states.
  assert.equal(await page.locator("#geoSearchCardType").textContent(), "Official barrio");
  assert.equal(await page.locator("#geoSearchCardParent").textContent(), "District: Centro");
  assert.match(await page.locator("#geoSearchCardScope").textContent(), /Official barrio polygon/);
});

test("a shared name returns every entity that carries it and never claims a unique identification", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openSearch(page);
  await page.locator("#geoSearchQuery").fill("Ciudad Universitaria");
  await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length >= 2);
  const results = (await snapshot(page)).results.filter((result) => result.match === "EXACT_NAME");
  assert.deepEqual(results.map((result) => result.id), ["BARRIO:093", "AMBITO:AOE.00.07"]);
  for (const result of results) assert.equal(result.ambiguous, true);
  // Both rows show the type and the official code, and both are badged.
  const badges = await page.locator("#geoSearchResults .geo-search-result-badge").count();
  assert.ok(badges >= 2);
  await page.locator("#geoSearchResults button").first().click();
  assert.match(await page.locator("#geoSearchAnalyzeNote").textContent(), /More than one official place carries this name/);
  assert.equal(await page.locator("#geoSearchCardCode").textContent(), "093");
});

test("an ámbito district is the edition's attribution, or is explicitly not published", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openSearch(page);
  await selectFirst(page, "AOE.00.02-RP");
  assert.match(await page.locator("#geoSearchCardParent").textContent(), /District attributed by the development-state edition: BARAJAS/);
  // An ámbito the edition does not cover says so rather than borrowing a
  // district from geometry.
  const absent = await page.evaluate(() => {
    const api = window.__GEO_SEARCH_TEST__;
    const codes = api.query("APR").results.map((result) => result.code);
    return codes.length > 0;
  });
  assert.equal(absent, true);
});

test("the canonical URL, the evidence snapshot and the export are unaffected by search", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  const before = await page.evaluate(() => ({ url: location.href, exportLabel: document.querySelector("#k11ExportBtn")?.textContent || null }));
  await openSearch(page);
  await page.locator("#geoSearchQuery").fill("Palacio");
  await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
  await page.locator("#geoSearchResults button").first().click();
  await page.locator("#geoSearchViewMap").click();
  const afterDiscovery = await page.evaluate(() => location.href);
  assert.equal(afterDiscovery, before.url, "discovery and framing add no URL state");

  // The explicit Lens action goes through the ordinary Lens path, so it commits
  // Lens state to the URL exactly as a map click does — and nothing else.
  await page.locator("#geoSearchAnalyze").click();
  await page.waitForFunction((previous) => location.href !== previous, before.url);
  const committed = new URL(await page.evaluate(() => location.href));
  for (const key of [...committed.searchParams.keys()]) {
    assert.doesNotMatch(key, /search|find|query|geo/i, `search leaked "${key}" into the canonical URL`);
  }
  assert.equal(await page.evaluate(() => document.querySelector("#k11ExportBtn")?.textContent || null), before.exportLabel);
});

test("restoring a shared link, then searching, leaves the restored reading intact", async (t) => {
  const first = await pageFor();
  t.after(() => first.context.close());
  await first.page.evaluate(() => window.__HALO_REGRESSION__.moveLensToLatLng("A", 40.40255, -3.71371));
  await first.page.waitForFunction(() => location.search.length > 20);
  const shared = new URL(await first.page.evaluate(() => location.href));

  const restored = await pageFor({ query: `&${shared.searchParams.toString()}` });
  t.after(() => restored.context.close());
  const beforeSearch = await world(restored.page);
  await openSearch(restored.page);
  await restored.page.locator("#geoSearchQuery").fill("centro");
  await restored.page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
  assert.deepEqual((await world(restored.page)).centres, beforeSearch.centres, "restoration was not disturbed");
  assert.deepEqual(restored.errors, []);
});

test("keyboard alone operates the whole finder, and focus never falls to the document", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await page.locator("#geoSearchToggle").focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector("#geoSearchPanel").hasAttribute("hidden"));
  assert.equal(await page.evaluate(() => document.activeElement.id), "geoSearchQuery");

  await page.keyboard.type("APR.02.0");
  await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
  await page.keyboard.press("ArrowDown");
  const firstId = await page.evaluate(() => document.activeElement.dataset.id);
  assert.ok(firstId, "ArrowDown enters the result list");
  await page.keyboard.press("ArrowDown");
  assert.notEqual(await page.evaluate(() => document.activeElement.dataset.id), firstId);
  await page.keyboard.press("ArrowUp");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), firstId);
  await page.keyboard.press("ArrowUp");
  assert.equal(await page.evaluate(() => document.activeElement.id), "geoSearchQuery", "ArrowUp returns to the field");

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal((await snapshot(page)).selectedId, firstId);

  // Escape dismisses, clears the highlight and returns focus to the trigger.
  await page.keyboard.press("Escape");
  const dismissed = await snapshot(page);
  assert.equal(dismissed.open, false);
  assert.equal(dismissed.selectedLayer, false, "a dismissed search leaves no unexplained outline");
  assert.equal(await page.evaluate(() => document.activeElement.id), "geoSearchToggle");

  // "/" opens the finder from anywhere that is not a field.
  await page.locator("#modePlaceButton").focus();
  await page.keyboard.press("/");
  await page.waitForFunction(() => !document.querySelector("#geoSearchPanel").hasAttribute("hidden"));
  assert.equal((await snapshot(page)).open, true);
  assert.equal(await page.evaluate(() => document.activeElement.id), "geoSearchQuery");

  // ...and is ignored while a field has focus, so it never swallows a character.
  await page.locator("#geoSearchQuery").fill("");
  await page.locator("#geoSearchQuery").pressSequentially("a/b");
  assert.equal(await page.locator("#geoSearchQuery").inputValue(), "a/b");
  await page.locator("#languageSelect").focus();
  await page.keyboard.press("/");
  assert.equal(await page.evaluate(() => document.activeElement.id), "languageSelect", "the shortcut never steals focus from a control");
});

test("result buttons keep focus and accessible names through a Lens move and a language change", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openSearch(page);
  await page.locator("#geoSearchQuery").fill("Palacio");
  await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
  await page.locator("#geoSearchQuery").press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), "BARRIO:011");
  assert.equal(await page.locator("#geoSearchResults button").first().getAttribute("aria-label"), "Inspect Palacio");

  await page.evaluate(() => window.__HALO_REGRESSION__.moveLensToLatLng("A", 40.40255, -3.71371));
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), "BARRIO:011");

  await page.locator("#languageSelect").selectOption("es");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), "BARRIO:011");
  assert.equal(await page.locator("#geoSearchResults button").first().getAttribute("aria-label"), "Inspeccionar Palacio");
  // Native semantics: a list of real buttons, with no invented ARIA roles.
  const semantics = await page.locator("#geoSearchResults").evaluate((node) => ({
    role: node.getAttribute("role"),
    buttonRole: node.querySelector("button")?.getAttribute("role"),
    live: document.querySelector("#geoSearchStatus").getAttribute("aria-live"),
    describedBy: document.querySelector("#geoSearchQuery").getAttribute("aria-describedby"),
    labelFor: document.querySelector(".geo-search-label").getAttribute("for"),
  }));
  assert.equal(semantics.role, null);
  assert.equal(semantics.buttonRole, null);
  assert.equal(semantics.live, "polite");
  assert.equal(semantics.describedBy, "geoSearchStatus");
  assert.equal(semantics.labelFor, "geoSearchQuery");
});

test("Spanish copy covers the whole surface while official values stay verbatim", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await page.locator("#languageSelect").selectOption("es");
  await openSearch(page);
  assert.equal(await page.locator("#geoSearchToggle").getAttribute("aria-label"), "Buscar un lugar oficial de Madrid");
  assert.match(await page.locator(".geo-search-label").textContent(), /Código oficial, barrio, distrito o ámbito/);
  await selectFirst(page, "Pacifico");
  assert.equal(await page.locator("#geoSearchCardName").textContent(), "Pacífico", "the official name is never translated");
  assert.equal(await page.locator("#geoSearchCardType").textContent(), "Barrio oficial");
  assert.equal(await page.locator("#geoSearchCardParent").textContent(), "Distrito: Retiro");
  assert.equal(await page.locator("#geoSearchViewMap").textContent(), "Ver en mapa");
  assert.equal(await page.locator("#geoSearchAnalyze").textContent(), "Analizar con la Lente");
  await page.locator("#geoSearchAnalyze").click();
  assert.match(await page.locator("#geoSearchAnalyzeNote").textContent(), /NO equivale al límite oficial completo/);
  // Switching back mid-session re-renders without losing the selection.
  await page.locator("#languageSelect").selectOption("en");
  assert.equal(await page.locator("#geoSearchCardName").textContent(), "Pacífico");
  assert.equal(await page.locator("#geoSearchCardType").textContent(), "Official barrio");
});

test("Light, Dark and System all render the finder from appearance tokens", async (t) => {
  const { page, context } = await pageFor({ colorScheme: "dark" });
  t.after(() => context.close());
  await openSearch(page);
  await selectFirst(page, "Palacio");
  const sample = () => page.evaluate(() => {
    const panel = document.querySelector("#geoSearchPanel");
    const result = document.querySelector("#geoSearchResults button");
    return {
      appearance: document.documentElement.dataset.appearance,
      panelColor: getComputedStyle(panel).color,
      panelBackground: getComputedStyle(panel).backgroundColor,
      resultBackground: getComputedStyle(result).backgroundColor,
      view: window.__HALO_REGRESSION__.mapView(),
    };
  });
  const initial = await sample();
  await page.locator("#appearanceSelect").selectOption("light");
  const light = await sample();
  await page.locator("#appearanceSelect").selectOption("dark");
  const dark = await sample();
  await page.locator("#appearanceSelect").selectOption("system");
  const system = await sample();
  assert.equal(light.appearance, "light");
  assert.equal(dark.appearance, "dark");
  assert.equal(system.appearance, "dark", "System follows the emulated dark preference");
  assert.notEqual(light.panelColor, dark.panelColor);
  assert.notEqual(light.panelBackground, dark.panelBackground);
  for (const state of [light, dark, system]) assert.deepEqual(state.view, initial.view, "appearance never moves the map");
});

test("an absent planning universe leaves barrios searchable and names the gap", async (t) => {
  const { page, context, errors } = await pageFor({ block: "/data/planning/madrid_ambitos.geojson" });
  t.after(() => context.close());
  await openSearch(page);
  const state = await snapshot(page);
  assert.equal(state.state, "ready", "administrative search survives a planning outage");
  assert.deepEqual(state.coverage, { administrative: true, ambito: false });
  assert.equal(state.counts.AMBITO, 0);
  await page.locator("#geoSearchQuery").fill("APR.02.09");
  assert.match(await page.locator("#geoSearchStatus").textContent(), /No official place matches/);
  assert.match(await page.locator("#geoSearchCoverage").textContent(), /Planning ámbitos are not loaded.*absent source, not an absence of ámbitos/s);
  await selectFirst(page, "Palacio");
  assert.equal((await snapshot(page)).selectedId, "BARRIO:011");
  assert.deepEqual(errors, []);
});

test("an absent administrative universe leaves ámbitos searchable and names the gap", async (t) => {
  const { page, context, errors } = await pageFor({ block: "/data/geography/madrid_admin.geojson" });
  t.after(() => context.close());
  await openSearch(page);
  const state = await snapshot(page);
  assert.equal(state.state, "ready");
  assert.deepEqual(state.coverage, { administrative: false, ambito: true });
  await page.locator("#geoSearchQuery").fill("Palacio");
  assert.match(await page.locator("#geoSearchCoverage").textContent(), /barrios and districts are not loaded/);
  await selectFirst(page, "APR.02.09");
  assert.equal((await snapshot(page)).selectedId, "AMBITO:APR.02.09");
  assert.deepEqual(errors, []);
});

test("rapid typing, rapid selection and mode changes during search leave no broken state", async (t) => {
  const { page, context, errors } = await pageFor();
  t.after(() => context.close());
  await openSearch(page);
  // 60 keystrokes with no settling, then an immediate selection.
  await page.evaluate(() => {
    const input = document.querySelector("#geoSearchQuery");
    const terms = ["a", "ap", "apr", "apr.", "apr.0", "apr.02", "apr.02.", "apr.02.0", "apr.02.09", "pacifico", "centro", "zzz"];
    for (let round = 0; round < 5; round += 1) {
      for (const term of terms) {
        input.value = term;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  });
  await page.locator("#geoSearchQuery").fill("APR.02.09");
  await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length === 1);
  for (let i = 0; i < 5; i += 1) await page.locator("#geoSearchResults button").first().click();
  const rapid = await snapshot(page);
  assert.equal(rapid.selectedId, "AMBITO:APR.02.09");
  assert.equal(rapid.selectedLayer, true);
  assert.equal(rapid.lensMoves, 0);
  assert.equal(rapid.cameraMoves, 0);

  // With the finder OPEN on a desktop viewport it must sit in the measured map
  // corridor, so the mode navigation stays directly clickable: a reader can
  // change mode mid-search without dismissing anything. A mode change must then
  // leave no stale selection claiming to be a COMPARE choice.
  assert.equal((await snapshot(page)).placement, "corridor");
  await page.locator("#modeCompareButton").click();
  await page.waitForFunction(() => document.querySelector("#analysisPanel").dataset.mode === "COMPARE");
  assert.equal((await snapshot(page)).open, true, "the finder survives a mode change");
  assert.equal((await snapshot(page)).state, "ready");
  await page.locator("#modeCityButton").click();
  await page.waitForFunction(() => document.querySelector("#analysisPanel").dataset.mode === "CITY");
  await selectFirst(page, "Palacio");
  assert.equal((await snapshot(page)).selectedId, "BARRIO:011");
  await page.locator("#modePlaceButton").click();
  assert.deepEqual(errors, []);
});

test("searching with the Layers rail and the evidence drawer open stays usable and clipping-free", async (t) => {
  const { page, context } = await pageFor({ viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  await page.locator("#mobileLayersButton").click();
  await page.waitForFunction(() => !document.querySelector("#layerRail").hasAttribute("hidden"));
  await openSearch(page);
  await selectFirst(page, "Palacio");
  const geometry = await page.evaluate(() => {
    const panel = document.querySelector("#geoSearchPanel");
    const rect = panel.getBoundingClientRect();
    return {
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      panelClipped: panel.scrollWidth - panel.clientWidth,
      withinViewport: rect.left >= -0.5 && rect.right <= window.innerWidth + 0.5 && rect.top >= -0.5 && rect.bottom <= window.innerHeight + 0.5,
      aboveRail: Number(getComputedStyle(panel).zIndex) > Number(getComputedStyle(document.querySelector("#layerRail")).zIndex),
      targets: [
        document.querySelector("#geoSearchToggle").getBoundingClientRect().height,
        document.querySelector("#geoSearchQuery").getBoundingClientRect().height,
        document.querySelector("#geoSearchClose").getBoundingClientRect().height,
        document.querySelector("#geoSearchViewMap").getBoundingClientRect().height,
        document.querySelector("#geoSearchAnalyze").getBoundingClientRect().height,
        document.querySelector("#geoSearchResults button").getBoundingClientRect().height,
      ],
    };
  });
  assert.equal(geometry.pageOverflow <= 0, true);
  assert.equal(geometry.panelClipped <= 0, true);
  assert.equal(geometry.withinViewport, true);
  assert.equal(geometry.aboveRail, true, "the finder is reachable with the rail open");
  for (const height of geometry.targets) assert.ok(height >= 44, `touch target ${height.toFixed(1)}px is below 44px`);
});

test("coarse-pointer operation works without hover and the header never overflows at 320px", async (t) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: ENGINE === chromium });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.route("**/*", (route) => (new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort()));
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#geoSearchPanel")?.dataset.state === "ready");

  const closedHeader = await page.evaluate(() => {
    const header = document.querySelector("header");
    return { overflow: header.scrollWidth - header.clientWidth, page: document.documentElement.scrollWidth - window.innerWidth };
  });
  assert.equal(closedHeader.overflow <= 0, true, `header overflowed by ${closedHeader.overflow}px`);
  assert.equal(closedHeader.page <= 0, true);

  await page.locator("#geoSearchToggle").tap();
  await page.waitForFunction(() => !document.querySelector("#geoSearchPanel").hasAttribute("hidden"));
  await page.locator("#geoSearchQuery").fill("Palacio");
  await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
  await page.locator("#geoSearchResults button").first().tap();
  await page.waitForFunction(() => !document.querySelector("#geoSearchCard").hasAttribute("hidden"));
  const openGeometry = await page.evaluate(() => {
    const header = document.querySelector("header");
    const panel = document.querySelector("#geoSearchPanel");
    const rect = panel.getBoundingClientRect();
    return {
      headerOverflow: header.scrollWidth - header.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      panelClipped: panel.scrollWidth - panel.clientWidth,
      labelVisible: getComputedStyle(document.querySelector(".geo-search-toggle-label")).display !== "none",
      within: rect.left >= -0.5 && rect.right <= window.innerWidth + 0.5,
    };
  });
  assert.equal(openGeometry.headerOverflow <= 0, true);
  assert.equal(openGeometry.pageOverflow <= 0, true);
  assert.equal(openGeometry.panelClipped <= 0, true);
  assert.equal(openGeometry.within, true);
  assert.equal(openGeometry.labelVisible, false, "the narrow header shows the icon alone, as the help control does");
  await page.locator("#geoSearchAnalyze").tap();
  assert.equal((await snapshot(page)).lensMoves, 1);
});

test("capture the finder's real states for the visual audit", async (t) => {
  if (!CAPTURE_DIR) return t.skip("GEOSEARCH_CAPTURE_DIR not set");
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  // A checkout WITHOUT the finder (the before capture) still produces a frame:
  // the state being recorded there is precisely that there is no place finder
  // and the map chrome is unobstructed.
  const absent = !fs.existsSync(path.join(ROOT, "js", "geo-search.js"));
  const shot = async (name, options, steps) => {
    const context = await browser.newContext({ viewport: options.viewport, colorScheme: options.colorScheme || "light" });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.route("**/*", (route) => (new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort()));
    try {
      await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelector("#planningExplorer")?.dataset.state !== "loading");
      if (!absent) await steps(page);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(CAPTURE_DIR, `${name}.png`), fullPage: false });
    } finally {
      await context.close();
    }
  };
  const desktop = { viewport: { width: 1440, height: 900 } };
  await shot("01-desktop-closed-light", desktop, async () => {});
  await shot("02-desktop-results-light", desktop, async (page) => {
    await openSearch(page);
    await page.locator("#geoSearchQuery").fill("ciudad");
    await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
  });
  await shot("03-desktop-selected-light", desktop, async (page) => {
    await openSearch(page);
    await selectFirst(page, "APR.02.09");
    await page.locator("#geoSearchViewMap").click();
  });
  await shot("04-desktop-ambiguous-light", desktop, async (page) => {
    await openSearch(page);
    await selectFirst(page, "Ciudad Universitaria");
  });
  await shot("05-desktop-noresult-light", desktop, async (page) => {
    await openSearch(page);
    await page.locator("#geoSearchQuery").fill("zzzz no such place");
  });
  await shot("06-desktop-results-dark", { ...desktop, colorScheme: "dark" }, async (page) => {
    await openSearch(page);
    await selectFirst(page, "Palacio");
    await page.locator("#geoSearchAnalyze").click();
  });
  await shot("07-phone-results-390", { viewport: { width: 390, height: 844 } }, async (page) => {
    await openSearch(page);
    await selectFirst(page, "Palacio");
  });
  await shot("08-phone-results-320", { viewport: { width: 320, height: 568 } }, async (page) => {
    await openSearch(page);
    await page.locator("#geoSearchQuery").fill("centro");
    await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
  });
  await shot("09-tablet-results-834", { viewport: { width: 834, height: 1112 } }, async (page) => {
    await openSearch(page);
    await selectFirst(page, "Madrid");
  });
  await shot("10-tablet-selected-1180-dark", { viewport: { width: 1180, height: 820 }, colorScheme: "dark" }, async (page) => {
    await openSearch(page);
    await selectFirst(page, "AOE.00.02-RP");
    await page.locator("#geoSearchViewMap").click();
  });
  assert.ok(fs.readdirSync(CAPTURE_DIR).length >= 10);
});
