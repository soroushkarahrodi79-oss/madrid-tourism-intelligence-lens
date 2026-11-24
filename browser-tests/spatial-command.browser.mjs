// Spatial command core (Gate 1) — real-browser regressions.
//
// The pure contract is covered by tests/spatial_command.test.mjs. THIS suite
// settles what only the running app can: that a structured command and the SAME
// operation performed by hand through the existing Lens controls (map click,
// radius slider, mode buttons, Lens buttons, "Analyze with Lens", "View on map")
// produce the same application state and the same readings; that a rejected or
// failed command leaves the map exactly as it was; and that no visible input,
// assistant or microphone surface exists.
//
// Every expected value is established on a SEPARATE page by the manual path, so
// no expectation is derived from the executor under test.

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

async function openApp(t, { seam = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.message)));
  await page.route("**/*", (route) => (new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort()));
  await page.goto(`http://127.0.0.1:${port}/${seam ? "?haloRegressionTest=1" : ""}`, { waitUntil: "networkidle" });
  if (!seam) return { page, errors };
  await page.evaluate(() => window.__GEO_SEARCH_TEST__.whenModuleReady());
  await page.waitForFunction(() => {
    const status = window.__GEO_SEARCH_TEST__.snapshot().universeStatus;
    return status.administrative === "ready" && status.ambito === "ready";
  });
  await frames(page);
  return { page, errors };
}

// Two animation frames: the canonical URL is committed on the next frame.
const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

// Everything an equivalence claim is judged on. `k11State` is the app's own
// reading of mode, Lenses, radii, active Lens, layers, scope, language and
// geometry; `readings` is the app's own per-Lens evidence (value AND status, so
// zero / unavailable / no-sample stay distinct); `membership` is the planning
// ámbito set the active Lens intersects; `insight` is the A/B Decision Insight.
async function world(page) {
  await frames(page);
  return page.evaluate(() => {
    const planning = window.__HALO_REGRESSION__.planning();
    let insight = null;
    try { insight = window.__HALO_REGRESSION__.decisionInsightModel(); } catch (error) { insight = `error: ${error.message}`; }
    return {
      k11State: window.__HALO_REGRESSION__.k11State(),
      url: location.search,
      // The app's canonical serialisation of the current reading, independent of
      // whether the address bar has been rewritten yet.
      canonicalUrl: new URL(window.__HALO_REGRESSION__.k11Url()).search,
      readings: window.__SPATIAL_COMMAND_TEST__.readings(),
      membership: planning.model ? planning.model.membership : null,
      containing: planning.model && planning.model.containing ? planning.model.containing.ambitoCode : null,
      insight: JSON.parse(JSON.stringify(insight)),
      view: window.__HALO_REGRESSION__.mapView(),
      slider: document.getElementById("radiusSlider").value,
      radiusText: document.getElementById("radiusText").textContent,
    };
  });
}

const run = (page, command) => page.evaluate((c) => window.__SPATIAL_COMMAND_TEST__.execute(c), command);

// ----------------------------------------------------------- manual helpers
// Only existing product controls, driven the way a person drives them.

async function manualMode(page, mode) {
  await page.locator(`.mode-btn[data-mode="${mode}"]`).click();
}
async function manualActivate(page, which) {
  await page.locator(which === "A" ? "#lensAButton" : "#lensBButton").click();
}
// The slider's own input handler, fired as a keyboard/drag adjustment fires it.
async function manualSlider(page, value) {
  await page.evaluate((v) => {
    const slider = document.getElementById("radiusSlider");
    slider.value = String(v);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
async function openSearch(page) {
  if (await page.locator("#geoSearchPanel").getAttribute("data-presentation") === "inline") {
    if (await page.locator("#geoSearchPanel").getAttribute("data-open") !== "true") await page.locator("#geoSearchQuery").click();
  } else if (await page.locator("#geoSearchPanel").isHidden()) await page.locator("#geoSearchToggle").click();
  await page.waitForFunction(() => document.querySelector("#geoSearchPanel").dataset.state === "ready");
}
// Search by name, require the first result to be the expected official entity,
// select it. The id assertion keeps the manual reference honest.
async function manualSelect(page, text, expectedId) {
  await openSearch(page);
  await page.locator("#geoSearchQuery").fill(text);
  await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
  assert.equal(await page.locator("#geoSearchResults button").first().getAttribute("data-id"), expectedId);
  await page.locator("#geoSearchResults button").first().click();
  await page.waitForFunction(() => !document.querySelector("#geoSearchCard").hasAttribute("hidden"));
}
async function manualAnalyze(page, text, expectedId) {
  await manualSelect(page, text, expectedId);
  await page.locator("#geoSearchAnalyze").click();
}

// The analytical comparison. The URL is compared too: it is the app's
// canonical serialisation of the reading.
function assertEquivalent(command, manual, { ignore = [] } = {}) {
  for (const key of ["k11State", "url", "canonicalUrl", "readings", "membership", "containing", "insight", "slider", "radiusText"]) {
    if (ignore.includes(key)) continue;
    assert.deepEqual(command[key], manual[key], `command and manual ${key} differ`);
  }
}

// ----------------------------------------------------------------- tests

test("set_lens_location (coordinates) equals a real map click on Lens A", async (t) => {
  const manual = await openApp(t);
  const point = await manual.page.evaluate(() => window.__HALO_REGRESSION__.mapClickablePoint());
  await manual.page.mouse.click(point.x, point.y);
  const expected = await world(manual.page);
  const clicked = expected.k11State.lensA;

  const cmd = await openApp(t);
  const receipt = await run(cmd.page, { version: 1, action: "set_lens_location", lens: "A", location: { type: "coordinates", lat: clicked.lat, lon: clicked.lon } });
  assert.equal(receipt.status, "applied");
  assert.equal(receipt.error, null);
  assert.deepEqual(receipt.state.lensA, { lat: clicked.lat, lon: clicked.lon, radiusM: clicked.radiusM, geometry: "CIRCLE" });
  assertEquivalent(await world(cmd.page), expected);
  assert.deepEqual(manual.errors, []);
  assert.deepEqual(cmd.errors, []);
});

test("set_lens_location (official area) on Lens B equals Analyze with Lens on an active Lens B", async (t) => {
  const manual = await openApp(t);
  await manualMode(manual.page, "COMPARE");
  await manualAnalyze(manual.page, "Hortaleza", "DISTRICT:16");
  const expected = await world(manual.page);

  const cmd = await openApp(t);
  await manualMode(cmd.page, "COMPARE");
  const before = await world(cmd.page);
  const receipt = await run(cmd.page, { version: 1, action: "set_lens_location", lens: "B", location: { type: "official_area", id: "DISTRICT:16" } });
  assert.equal(receipt.status, "applied");
  assert.equal(receipt.resolved.B.area.type, "DISTRICT");
  assert.ok(receipt.notes.includes("LENS_CIRCLE_NOT_AREA"), "the receipt states the Lens is a circle, not the district");
  const after = await world(cmd.page);
  assertEquivalent(after, expected);
  assert.deepEqual(after.k11State.lensA, before.k11State.lensA, "Lens A is untouched");
  assert.equal(after.k11State.lensB.radiusM, before.k11State.lensB.radiusM, "placing a Lens never changes its radius");
});

test("set_lens_radius equals the radius slider, for the active and the inactive Lens", async (t) => {
  // B is active after entering COMPARE. Manual: slider on B, then Lens A button + slider.
  const manual = await openApp(t);
  await manualMode(manual.page, "COMPARE");
  await manualSlider(manual.page, 750);
  const expectedB = await world(manual.page);
  await manualActivate(manual.page, "A");
  await manualSlider(manual.page, 1200);
  const expectedA = await world(manual.page);

  const cmd = await openApp(t);
  await manualMode(cmd.page, "COMPARE");
  const r1 = await run(cmd.page, { version: 1, action: "set_lens_radius", lens: "B", radiusM: 750 });
  assert.equal(r1.status, "applied");
  assertEquivalent(await world(cmd.page), expectedB);
  const r2 = await run(cmd.page, { version: 1, action: "set_lens_radius", lens: "A", radiusM: 1200 });
  assert.equal(r2.status, "applied");
  assert.ok(r2.notes.includes("ACTIVE_LENS_CHANGED"));
  assertEquivalent(await world(cmd.page), expectedA);
});

test("compare_locations equals the full manual comparison sequence (COMPARE, place A, radius A, place B, radius B)", async (t) => {
  const manual = await openApp(t);
  await manualMode(manual.page, "COMPARE");
  await manualActivate(manual.page, "A");
  await manualAnalyze(manual.page, "Hortaleza", "DISTRICT:16");
  await manualSlider(manual.page, 1000);
  await manualActivate(manual.page, "B");
  await manualAnalyze(manual.page, "Chamartín", "DISTRICT:05");
  await manualSlider(manual.page, 750);
  const expected = await world(manual.page);
  assert.equal(expected.k11State.mode, "COMPARE");

  const cmd = await openApp(t);
  const receipt = await run(cmd.page, {
    version: 1,
    action: "compare_locations",
    a: { location: { type: "official_area", id: "DISTRICT:16" }, radiusM: 1000 },
    b: { location: { type: "official_area", id: "DISTRICT:05" }, radiusM: 750 },
  });
  assert.equal(receipt.status, "applied");
  assert.deepEqual([...receipt.notes].sort(), ["ACTIVE_LENS_CHANGED", "CENTRE_MOVED", "LENS_CIRCLE_NOT_AREA", "MODE_CHANGED"]);
  const got = await world(cmd.page);
  assertEquivalent(got, expected);
  // Two circles: the comparison never becomes a district comparison.
  assert.equal(got.k11State.scope, "LENS");
  assert.equal(got.k11State.geometryA, undefined);
  assert.equal(got.k11State.geometryB, undefined);
  assert.ok(got.insight && Array.isArray(got.insight.items), "a Lens A/B Decision Insight model exists for the comparison");
});

test("navigate_to_location frames an official area exactly like View on map, and moves nothing else", async (t) => {
  const manual = await openApp(t);
  await manualSelect(manual.page, "Hortaleza", "DISTRICT:16");
  await manual.page.locator("#geoSearchViewMap").click();
  const expected = await world(manual.page);

  const cmd = await openApp(t);
  const before = await world(cmd.page);
  const receipt = await run(cmd.page, { version: 1, action: "navigate_to_location", location: { type: "official_area", id: "DISTRICT:16" } });
  assert.equal(receipt.status, "applied");
  const after = await world(cmd.page);
  assert.deepEqual(after.view, expected.view, "same camera as the manual View on map");
  assert.deepEqual(after.k11State, before.k11State, "no Lens, radius, mode or layer changed");
  assert.deepEqual(after.readings, before.readings);
  assert.equal(after.url, before.url);
  // The geographic-search surface is not touched by a command.
  const search = await cmd.page.evaluate(() => window.__GEO_SEARCH_TEST__.snapshot());
  assert.equal(search.selectedId, null);
  assert.equal(search.cameraMoves, 0);
});

test("prepare never mutates the application", async (t) => {
  const { page } = await openApp(t);
  const before = await world(page);
  const prepared = await page.evaluate(() => window.__SPATIAL_COMMAND_TEST__.prepare({
    version: 1, action: "compare_locations",
    a: { location: { type: "official_area", id: "DISTRICT:16" }, radiusM: 1000 },
    b: { location: { type: "official_area", id: "DISTRICT:05" } },
  }));
  assert.equal(prepared.ok, true);
  assert.equal(prepared.plan.target.mode, "COMPARE");
  assert.deepEqual(await world(page), before);
});

test("a failed B side leaves the whole map unchanged, including Lens A", async (t) => {
  const { page } = await openApp(t);
  await manualMode(page, "COMPARE");
  await manualActivate(page, "A");
  const before = await world(page);
  const cases = [
    [{ location: { type: "official_area", id: "DISTRICT:16" }, radiusM: 1000 }, { location: { type: "official_area", id: "DISTRICT:99" } }, "AREA_NOT_FOUND"],
    [{ location: { type: "official_area", id: "DISTRICT:16" } }, { location: { type: "official_area", id: "MUNICIPALITY:28079" } }, "AREA_TYPE_NOT_SUPPORTED"],
    [{ location: { type: "official_area", id: "DISTRICT:16" } }, { location: { type: "coordinates", lat: 41.39, lon: 2.17 } }, "COORDINATES_OUT_OF_BOUNDS"],
    [{ location: { type: "official_area", id: "DISTRICT:16" } }, { location: { type: "official_area", id: "DISTRICT:05" }, radiusM: 120 }, "RADIUS_OFF_STEP"],
    [{ location: { type: "official_area", id: "DISTRICT:16" } }, { location: { type: "official_area", id: "Lavapiés" } }, "INVALID_AREA_ID"],
  ];
  for (const [a, b, code] of cases) {
    const receipt = await run(page, { version: 1, action: "compare_locations", a, b });
    assert.equal(receipt.status, "rejected", code);
    assert.equal(receipt.error.code, code);
    assert.deepEqual(await world(page), before, `state unchanged after ${code}`);
  }
});

test("invalid and unsupported commands are rejected without any state change", async (t) => {
  const { page } = await openApp(t);
  const before = await world(page);
  const cases = [
    [{ version: 2, action: "set_lens_radius", lens: "A", radiusM: 900 }, "UNSUPPORTED_VERSION"],
    [{ version: 1, action: "compare_administrative_areas", a: "DISTRICT:16", b: "DISTRICT:05" }, "UNKNOWN_ACTION"],
    [{ version: 1, action: "set_lens_radius", lens: "A", radiusM: 900, unit: "m" }, "UNKNOWN_FIELD"],
    [{ version: 1, action: "set_lens_radius", lens: "A" }, "MISSING_FIELD"],
    [{ version: 1, action: "set_lens_radius", lens: "C", radiusM: 900 }, "INVALID_LENS"],
    [{ version: 1, action: "set_lens_radius", lens: "A", radiusM: 6000 }, "RADIUS_OUT_OF_RANGE"],
    [{ version: 1, action: "set_lens_radius", lens: "A", radiusM: "750" }, "INVALID_RADIUS"],
    [{ version: 1, action: "set_lens_radius", lens: "B", radiusM: 750 }, "LENS_B_NOT_ENABLED"],
    [{ version: 1, action: "set_lens_location", lens: "A", location: { type: "coordinates", lat: 0, lon: 0 } }, "COORDINATES_OUT_OF_BOUNDS"],
    [{ version: 1, action: "set_lens_location", lens: "A", location: { type: "official_area", id: "MUNICIPALITY:28079" } }, "AREA_TYPE_NOT_SUPPORTED"],
    [{ version: 1, action: "navigate_to_location", location: { type: "coordinates", lat: 40.4, lon: -3.7 }, zoom: 40 }, "ZOOM_OUT_OF_RANGE"],
    ["set_lens_radius A 750", "INVALID_COMMAND"],
  ];
  for (const [input, code] of cases) {
    const receipt = await run(page, input);
    assert.equal(receipt.status, "rejected", code);
    assert.equal(receipt.error.code, code);
    assert.deepEqual(await world(page), before, `state unchanged after ${code}`);
  }
  // CITY mode refuses Lens commands.
  await manualMode(page, "CITY");
  const city = await world(page);
  const receipt = await run(page, { version: 1, action: "set_lens_radius", lens: "A", radiusM: 500 });
  assert.equal(receipt.error.code, "MODE_NOT_SUPPORTED");
  assert.deepEqual(await world(page), city);
});

test("a confirmed polygon or an open draft is never overwritten by a command", async (t) => {
  const { page } = await openApp(t);
  const ring = [{ lat: 40.416, lon: -3.706 }, { lat: 40.416, lon: -3.698 }, { lat: 40.410, lon: -3.698 }, { lat: 40.410, lon: -3.706 }];
  await page.evaluate((vertices) => {
    document.getElementById("geometryModePolygon").click();
    document.getElementById("polygonDrawButton").click();
    for (const vertex of vertices) window.__addVertex(vertex);
    document.getElementById("polygonFinishButton").click();
  }, ring);
  const withPolygon = await world(page);
  assert.ok(withPolygon.k11State.geometryA, "Lens A holds a confirmed polygon");
  for (const input of [
    { version: 1, action: "set_lens_location", lens: "A", location: { type: "coordinates", lat: 40.42, lon: -3.69 } },
    { version: 1, action: "set_lens_radius", lens: "A", radiusM: 500 },
    { version: 1, action: "compare_locations", a: { location: { type: "official_area", id: "DISTRICT:16" } }, b: { location: { type: "official_area", id: "DISTRICT:05" } } },
  ]) {
    const receipt = await run(page, input);
    assert.equal(receipt.status, "rejected");
    assert.equal(receipt.error.code, "GEOMETRY_NOT_CIRCLE");
    assert.deepEqual(await world(page), withPolygon);
  }
  // An unfinished draft blocks every Lens command too.
  await page.evaluate(() => {
    document.getElementById("polygonDeleteButton").click();
    document.getElementById("polygonDrawButton").click();
    window.__addVertex({ lat: 40.41, lon: -3.70 });
  });
  const drafting = await world(page);
  const receipt = await run(page, { version: 1, action: "set_lens_radius", lens: "A", radiusM: 500 });
  assert.equal(receipt.error.code, "GEOMETRY_EDIT_IN_PROGRESS");
  assert.deepEqual(await world(page), drafting);
});

test("repeating a command is idempotent: the second run reports no_change and changes nothing", async (t) => {
  const { page } = await openApp(t);
  const command = {
    version: 1, action: "compare_locations",
    a: { location: { type: "official_area", id: "BARRIO:012" }, radiusM: 500 },
    b: { location: { type: "official_area", id: "BARRIO:015" }, radiusM: 500 },
  };
  assert.equal((await run(page, command)).status, "applied");
  const once = await world(page);
  const second = await run(page, command);
  assert.equal(second.status, "no_change");
  assert.deepEqual(second.notes, []);
  assert.deepEqual(await world(page), once);
  assert.equal((await run(page, { version: 1, action: "set_lens_radius", lens: "B", radiusM: 500 })).status, "no_change");
});

test("an exception during execution is rolled back to the exact prior state", async (t) => {
  const { page } = await openApp(t);
  const before = await world(page);
  // Make the app's own activateLens() throw ONCE, in the middle of a compound
  // command (inside the mode controller's enableLensB, after B was switched on).
  await page.evaluate(() => {
    const original = window.activateLens;
    let armed = true;
    window.activateLens = function (...args) {
      if (armed) { armed = false; throw new Error("injected failure"); }
      return original.apply(this, args);
    };
  });
  const receipt = await run(page, {
    version: 1, action: "compare_locations",
    a: { location: { type: "official_area", id: "DISTRICT:16" }, radiusM: 1000 },
    b: { location: { type: "official_area", id: "DISTRICT:05" }, radiusM: 750 },
  });
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.error.code, "EXECUTION_FAILED");
  assert.equal(receipt.rolledBack, true);
  assert.deepEqual(receipt.notes, []);
  const after = await world(page);
  // The rollback's own refresh() may rewrite a not-yet-canonical address bar to
  // the canonical form of the SAME reading, so the reading is compared through
  // its canonical serialisation rather than the raw address bar.
  assertEquivalent(after, before, { ignore: ["url"] });
  assert.equal(after.canonicalUrl, before.canonicalUrl);
  assert.deepEqual(after.view, before.view);
});

test("no visible command, assistant or microphone surface exists, and the seam is gated", async (t) => {
  const { page } = await openApp(t, { seam: false });
  const exposed = await page.evaluate(() => ({
    seam: typeof window.__SPATIAL_COMMAND_TEST__,
    adapterOnWindow: typeof window.executeSpatialCommand,
    // Every free-text field, described by its id, label and placeholder.
    textInputs: [...document.querySelectorAll("input[type=text], input[type=search], input:not([type]), textarea")]
      .map((el) => `${el.id} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("placeholder") || ""}`),
    mic: document.querySelectorAll("[id*=mic i], [class*=mic i], [aria-label*=micr i], [id*=voice i], [id*=command i], [class*=command i]").length,
  }));
  assert.equal(exposed.seam, "undefined", "the command seam needs ?haloRegressionTest=1 on a local host");
  assert.equal(exposed.adapterOnWindow, "undefined", "the adapter is not a window API");
  // The existing official finders (place search, ámbito explorer, ámbito code
  // fields) stay; no field invites a command, a question or speech.
  for (const field of exposed.textInputs) {
    assert.doesNotMatch(field, /command|voice|assistant|chat|ask|speak|micro|dictat/i, `unexpected free-text field: ${field}`);
  }
  assert.equal(exposed.mic, 0, "no microphone, voice or command element");
});
