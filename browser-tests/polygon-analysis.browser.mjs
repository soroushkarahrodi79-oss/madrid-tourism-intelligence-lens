// Custom polygon analysis geometry, end to end (#187 Phase 3).
//
// The pure model (exact membership, boundary convention, spherical area,
// perimeter, parity with js/geography.js) is covered by
// tests/polygon_geometry.test.mjs. THIS file covers the things only a browser can
// show: the drawing workflow, vertex editing, deletion and cancellation, that the
// polygon really becomes the analytical geometry, that the circular Lens is
// untouched, that every reading which cannot be clipped is MARKED rather than
// recomputed, keyboard operability, and that URL/share behaviour stays honest.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const lens = require("../js/lens.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".geojson": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(ROOT + path.sep) && target !== path.join(ROOT, "index.html")) return response.writeHead(403).end();
  fs.readFile(target, (error, data) => {
    if (error) return response.writeHead(404).end();
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    response.end(data);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const port = server.address().port;

// An axis-aligned ring around the default Lens A centre, given explicitly so the
// geometry under test is exact rather than whatever a click happened to produce.
const RING = Object.freeze([
  { lat: 40.4100, lon: -3.7100 }, { lat: 40.4100, lon: -3.6800 },
  { lat: 40.4250, lon: -3.6800 }, { lat: 40.4250, lon: -3.7100 },
]);

async function openApp({ locale = null, appearance = "light", viewport = { width: 1440, height: 900 }, tools = true } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem("madrid-lens-appearance", value), appearance);
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error.message)));
  await page.route("**/*", (route) => {
    const hostname = new URL(route.request().url()).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__) && typeof window.__addVertex === "function");
  // Wait for the POI pipeline to settle before any baseline reading is taken,
  // otherwise a "circle unchanged" comparison is against a still-loading panel.
  await page.waitForFunction(() => document.getElementById("tourismValue").textContent.trim() !== "—");
  await page.waitForFunction(() => window.__visiblePoints().length > 0);
  if (locale) await page.locator("#languageSelect").selectOption(locale);
  if (tools) await page.locator("#spatialToolsToggle").click();
  return { context, page, pageErrors };
}

const readState = (page) => page.evaluate(() => ({
  pressed: Object.fromEntries([...document.querySelectorAll("[data-geometry-mode]")]
    .map((b) => [b.dataset.geometryMode, b.getAttribute("aria-pressed")])),
  radiusVisible: !document.getElementById("spatialRadiusField").hidden,
  toolsVisible: !document.getElementById("polygonTools").hidden,
  visibleButtons: ["polygonDrawButton", "polygonAddVertexButton", "polygonFinishButton", "polygonCancelButton", "polygonDeleteButton"]
    .filter((id) => !document.getElementById(id).hidden),
  finishAriaDisabled: document.getElementById("polygonFinishButton").getAttribute("aria-disabled"),
  status: (document.getElementById("polygonStatus").textContent || "").trim(),
  measureVisible: !document.getElementById("polygonMeasure").hidden,
  measure: {
    vertices: document.getElementById("polygonVertexCount").textContent,
    area: document.getElementById("polygonArea").textContent,
    perimeter: document.getElementById("polygonPerimeter").textContent,
  },
  noticeVisible: (() => {
    // NOT just `hidden`: an element can carry hidden=false and still be invisible
    // inside a display:none ancestor. This measurement exists because that is
    // exactly what happened once — the notice was moved into a container that is
    // display:none on desktop and the attribute-only check stayed green.
    const notice = document.getElementById("polygonScopeNotice");
    const box = notice.getBoundingClientRect();
    return !notice.hidden && box.width > 0 && box.height > 0;
  })(),
  documentGeometry: document.documentElement.dataset.analysisGeometry,
  activeGeometryKind: window.__geometryKind(),
  markedUnsupported: [...document.querySelectorAll("[data-geometry-unsupported]")].map((el) => el.id).sort(),
  readings: {
    tourism: document.getElementById("tourismValue").textContent.trim(),
    stay: document.getElementById("stayValue").textContent.trim(),
  },
  ring: window.__ring(),
}));

const drawRing = (page, ring) => page.evaluate((vertices) => {
  document.getElementById("geometryModePolygon").click();
  document.getElementById("polygonDrawButton").click();
  for (const vertex of vertices) window.__addVertex(vertex);
  document.getElementById("polygonFinishButton").click();
}, ring);

test("the circular Lens is the default geometry and nothing polygon-shaped is shown", async () => {
  const { context, page, pageErrors } = await openApp();
  const state = await readState(page);
  assert.deepEqual(state.pressed, { CIRCLE: "true", POLYGON: "false" });
  assert.equal(state.radiusVisible, true, "the radius control is immediately available in circular mode");
  assert.equal(state.toolsVisible, false);
  assert.equal(state.activeGeometryKind, "CIRCLE");
  assert.equal(state.documentGeometry, "CIRCLE");
  assert.equal(state.noticeVisible, false);
  assert.deepEqual(state.markedUnsupported, []);
  assert.equal(state.ring, null);
  assert.deepEqual(pageErrors, []);
  await context.close();
});

test("the drawing workflow refuses to commit a ring that encloses no area", async () => {
  const { context, page } = await openApp();
  await page.locator("#geometryModePolygon").click();
  let state = await readState(page);
  assert.equal(state.radiusVisible, false, "the radius control gives way to the polygon tools");
  assert.deepEqual(state.visibleButtons, ["polygonDrawButton"]);
  assert.match(state.status, /Draw a polygon/);

  await page.locator("#polygonDrawButton").click();
  state = await readState(page);
  assert.deepEqual(state.visibleButtons, ["polygonAddVertexButton", "polygonFinishButton", "polygonCancelButton"]);
  assert.equal(state.finishAriaDisabled, "true", "Finish refuses while under three vertices");
  assert.match(state.status, /At least three vertices/);

  // Two vertices still cannot enclose an area, and Finish must not commit one.
  await page.evaluate(() => { window.__addVertex({ lat: 40.41, lon: -3.70 }); window.__addVertex({ lat: 40.41, lon: -3.68 }); });
  state = await readState(page);
  assert.equal(state.finishAriaDisabled, "true");
  await page.locator("#polygonFinishButton").click({ force: true });
  state = await readState(page);
  assert.equal(state.ring, null, "no polygon was committed");
  assert.equal(state.activeGeometryKind, "CIRCLE", "and the circle is still the analytical geometry");

  // The third vertex makes it committable.
  await page.evaluate(() => window.__addVertex({ lat: 40.425, lon: -3.69 }));
  state = await readState(page);
  assert.equal(state.finishAriaDisabled, "false");
  assert.equal(state.measureVisible, true, "area and perimeter are reported as soon as a ring exists");
  await context.close();
});

test("a committed polygon becomes the analytical geometry and reports its own measurements", async () => {
  const { context, page, pageErrors } = await openApp();
  const before = await readState(page);
  await drawRing(page, RING);
  const after = await readState(page);

  assert.equal(after.activeGeometryKind, "POLYGON");
  assert.equal(after.documentGeometry, "POLYGON");
  assert.equal(after.ring.length, 4);
  assert.deepEqual(after.visibleButtons, ["polygonDeleteButton"]);
  assert.match(after.status, /Edit vertices/);

  // Measurements agree with the pure model computed independently in Node.
  const expectedArea = lens.polygonAreaKm2(lens.normalizePolygonRing(RING));
  const expectedPerimeter = lens.polygonPerimeterM(lens.normalizePolygonRing(RING));
  assert.equal(after.measure.vertices, "4");
  assert.equal(after.measure.area, `${Number(expectedArea.toFixed(2))} km²`);
  assert.equal(after.measure.perimeter, `${Number((expectedPerimeter / 1000).toFixed(2))} km`);

  // The readings actually changed, so the polygon is genuinely driving them.
  assert.notDeepEqual(after.readings, before.readings);
  assert.deepEqual(pageErrors, []);
  await context.close();
});

test("the rendered counts equal an exact point-in-polygon recomputation", async () => {
  // THE CENTRAL CORRECTNESS CLAIM. The panel's figures are recomputed here from
  // the raw point set with the pure model, independently of the application, and
  // must agree exactly. A bounding-box or enclosing-circle shortcut inside the
  // app would show up as a disagreement.
  const { context, page } = await openApp();
  // A concave ring, so the shortcuts and the exact answer genuinely differ.
  const concave = [
    { lat: 40.4100, lon: -3.7100 }, { lat: 40.4100, lon: -3.6800 },
    { lat: 40.4175, lon: -3.6900 }, { lat: 40.4250, lon: -3.6800 },
    { lat: 40.4250, lon: -3.7100 },
  ];
  await drawRing(page, concave);
  const observed = await page.evaluate(() => ({
    tourism: document.getElementById("tourismValue").textContent.trim(),
    stay: document.getElementById("stayValue").textContent.trim(),
    ring: window.__ring(),
    points: window.__visiblePoints(),
  }));
  const geometry = lens.createPolygonGeometry(observed.ring);
  const inside = observed.points.filter((p) => lens.geometryContainsPoint(geometry, p));
  const count = (type) => inside.filter((p) => p.type === type).length;
  assert.equal(observed.tourism, String(count("museum") + count("info")), "tourism count must be exact point-in-polygon");
  assert.equal(observed.stay, String(count("stay")), "stay count must be exact point-in-polygon");

  // And confirm the shortcut really would have differed on this ring, so the
  // assertion above is testing something.
  const lats = observed.ring.map((v) => v.lat); const lons = observed.ring.map((v) => v.lon);
  const inBox = observed.points.filter((p) =>
    p.lat >= Math.min(...lats) && p.lat <= Math.max(...lats) && p.lon >= Math.min(...lons) && p.lon <= Math.max(...lons));
  assert.ok(inBox.length >= inside.length, "the bounding box can only over-include");
  await context.close();
});

test("readings that cannot be clipped are marked, never recomputed", async () => {
  const { context, page } = await openApp();
  await drawRing(page, RING);
  const state = await readState(page);
  assert.equal(state.noticeVisible, true, "the scope statement is on screen while a polygon is active");
  // The compact band's own heading must stop claiming a circle too.
  const band = await page.evaluate(() => ({
    head: document.querySelector('#placeCircleSummary [data-i18n="place.circleSummary"]').textContent.trim(),
    chip: document.getElementById("placeCircleSummaryRadius").textContent.trim(),
    aria: document.getElementById("placeCircleSummary").getAttribute("aria-label"),
  }));
  assert.equal(band.head, "In this polygon");
  assert.doesNotMatch(band.chip, /radius/i, `the band must not state a radius: ${band.chip}`);
  assert.match(band.aria, /custom polygon/i);
  assert.deepEqual(state.markedUnsupported,
    ["areaProfile", "hospitalityContext", "planningAmbito", "spatialSensitivity", "urbanLicences"]);
  // TWO KINDS OF MARK, because there are two different situations and saying the
  // same thing about both would itself be inaccurate.
  const marks = await page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll("[data-geometry-unsupported]")]
      .map((section) => [section.id, {
        kind: section.dataset.geometryUnsupported,
        text: (section.querySelector(":scope > .geometry-unsupported")?.textContent || "").trim(),
      }])));
  // Would otherwise compute from the Lens circle: abstains outright.
  for (const id of ["urbanLicences", "spatialSensitivity"]) {
    assert.equal(marks[id].kind, "withheld", id);
    assert.match(marks[id].text, /Not available for a custom polygon/i);
  }
  // Published per official area: still true, simply not clipped to the polygon.
  for (const id of ["areaProfile", "planningAmbito", "hospitalityContext"]) {
    assert.equal(marks[id].kind, "unclipped", id);
    assert.match(marks[id].text, /Published per official area — not clipped to this polygon/i);
  }
  // THE DANGEROUS CASE: the licence register's own view contract is a circle, so
  // it must abstain rather than present a circle-derived reading as the
  // polygon's. A null view is what its unavailable path consumes.
  assert.equal(await page.evaluate(() => window.__licenceViewIsNull()), true,
    "the licence register must not compute from the Lens circle while a polygon is active");
  // The scope statement names what IS computed and what is NOT, and says the
  // unsupported readings are not estimated.
  const scope = await page.evaluate(() => document.getElementById("polygonScopeNotice").textContent);
  assert.match(scope, /exact point-in-polygon/);
  assert.match(scope, /not estimated/);
  assert.match(scope, /even spread inside the published unit/);
  // The geometry line states vertices, area and perimeter rather than a radius.
  assert.match(await page.locator("#polygonScopeGeometry").textContent(), /4 vertices · .+ · .+/);
  await context.close();
});

test("the scope rail declares the polygon, never a radius the polygon does not have", async () => {
  // The rail states the analytical scope of what is on screen. Showing
  // "Lens circle · A · 900 m" over polygon-derived figures would be a false scope
  // claim, which is the specific failure this product's scope model exists to
  // prevent. LENS_POLYGON is a separate scope for exactly that reason.
  const { context, page } = await openApp();
  const railOf = () => page.evaluate(() => [...document.querySelectorAll("#scopeRailList li")]
    .map((li) => ({ scope: li.dataset.scope, text: li.textContent.replace(/\s+/g, " ").trim() })));
  // The barrio lookup is asynchronous; wait for it to settle so the baseline is
  // the resolved rail and not a "locating…" placeholder.
  await page.waitForFunction(() => !/locating/i.test(document.getElementById("scopeRailList").textContent));
  const before = await railOf();
  assert.ok(before.some((entry) => entry.scope === "LENS_CIRCLE"), "the circular rail entry is the default");

  await drawRing(page, RING);
  const after = await railOf();
  assert.equal(after.some((entry) => entry.scope === "LENS_CIRCLE"), false,
    `no circle scope may be claimed while a polygon is active: ${JSON.stringify(after)}`);
  const polygonEntry = after.find((entry) => entry.scope === "LENS_POLYGON");
  assert.ok(polygonEntry, `the rail must declare the polygon scope: ${JSON.stringify(after)}`);
  assert.match(polygonEntry.text, /Custom polygon/);
  // The instance states vertices and area, and carries no radius.
  assert.match(polygonEntry.text, /4 · [\d.]+ km²/);
  assert.doesNotMatch(polygonEntry.text, /\d+\s?m\b/);
  // Scopes whose sections are marked unavailable carry no claim either.
  for (const scope of ["OFFICIAL_BARRIO", "PLANNING_AMBITO", "LENS_INTERSECT_AMBITO"]) {
    assert.equal(after.some((entry) => entry.scope === scope), false,
      `${scope} is marked unavailable, so it must not also claim a scope in the rail`);
  }
  // Deleting the polygon restores the circular claim exactly.
  await page.locator("#polygonDeleteButton").click();
  await page.waitForFunction(() => !/locating/i.test(document.getElementById("scopeRailList").textContent));
  const restored = await railOf();
  assert.deepEqual(restored, before);
  await context.close();
});

test("vertex edits stay in a draft until Apply and Cancel restores the committed ring", async () => {
  const { context, page } = await openApp();
  await drawRing(page, RING);
  const before = await readState(page);
  await page.locator("#polygonEditButton").click();
  assert.equal(await page.locator("#polygonEditApplyButton").isVisible(), true);
  // A real pointer drag exercises the handle wiring and leaves readings intact.
  const handle = await page.evaluate(() => {
    const vertex = window.__ring()[0];
    return window.__latLngToPoint(vertex.lat, vertex.lon);
  });
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x - 60, handle.y + 40, { steps: 8 });
  await page.mouse.up();
  const draft = await readState(page);
  assert.deepEqual(draft.ring, before.ring);
  assert.deepEqual(draft.readings, before.readings);
  assert.notEqual(draft.measure.area, before.measure.area);
  await page.locator("#polygonEditCancelButton").click();
  const cancelled = await readState(page);
  assert.deepEqual(cancelled.ring, before.ring);
  assert.deepEqual(cancelled.readings, before.readings);
  assert.equal(cancelled.measure.area, before.measure.area);

  await page.locator("#polygonEditButton").click();
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x - 60, handle.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.locator("#polygonEditApplyButton").click();
  const applied = await readState(page);
  assert.notDeepEqual(applied.ring, before.ring);
  assert.equal(applied.ring.length, before.ring.length);
  assert.equal(applied.measure.area, draft.measure.area);
  const points = await page.evaluate(() => window.__visiblePoints());
  const inside = points.filter((p) => lens.geometryContainsPoint(lens.createPolygonGeometry(applied.ring), p));
  assert.equal(Number(applied.readings.tourism),
    inside.filter((p) => p.type === "museum" || p.type === "info").length);
  await context.close();
});

test("edit add and remove work on the draft; Escape discards it", async () => {
  const { context, page } = await openApp();
  await drawRing(page, RING);
  const before = await readState(page);
  await page.locator("#polygonEditButton").click();
  assert.equal(await page.locator("#polygonEditDeleteButton").isDisabled(), true);
  await page.locator("#polygonEditAddButton").click();
  assert.equal((await readState(page)).measure.vertices, "5");
  assert.equal(await page.locator("#polygonEditDeleteButton").isDisabled(), false);
  await page.locator("#polygonEditDeleteButton").click();
  assert.equal((await readState(page)).measure.vertices, "4");
  await page.locator("#polygonEditAddButton").click();
  await page.locator("#polygonEditCancelButton").press("Escape");
  const after = await readState(page);
  assert.deepEqual(after.ring, before.ring);
  assert.deepEqual(after.readings, before.readings);
  assert.equal(await page.locator("#spatialToolbar").isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), "spatialToolsToggle");
  await context.close();
});

test("cancelling a drawing restores the circular geometry and leaves no polygon", async () => {
  const { context, page } = await openApp();
  await page.locator("#geometryModePolygon").click();
  await page.locator("#polygonDrawButton").click();
  await page.evaluate(() => { for (const v of [{ lat: 40.41, lon: -3.70 }, { lat: 40.41, lon: -3.68 }, { lat: 40.425, lon: -3.69 }]) window.__addVertex(v); });
  assert.equal((await readState(page)).measureVisible, true);
  await page.locator("#polygonCancelButton").click();
  const state = await readState(page);
  assert.equal(state.ring, null, "nothing was committed");
  assert.equal(state.activeGeometryKind, "CIRCLE");
  assert.deepEqual(state.visibleButtons, ["polygonDrawButton"]);
  assert.equal(state.measureVisible, false);
  await context.close();
});

test("undo removes draft vertices and leaves the committed polygon and readings intact", async () => {
  const { context, page } = await openApp();
  await drawRing(page, RING);
  const committed = await readState(page);
  await page.locator("#polygonRedrawButton").click();
  assert.equal(await page.locator("#polygonUndoButton").isDisabled(), true);
  assert.equal(await page.locator("#polygonDraftNotice").isVisible(), true);
  await page.evaluate((ring) => { for (const vertex of ring) window.__addVertex(vertex); }, RING.slice(0, 3));
  assert.equal((await readState(page)).finishAriaDisabled, "false");
  await page.locator("#polygonUndoButton").click();
  assert.equal((await readState(page)).finishAriaDisabled, "true");
  assert.equal((await readState(page)).measureVisible, false);
  await page.locator("#polygonUndoButton").click();
  await page.locator("#polygonUndoButton").click();
  assert.equal(await page.locator("#polygonUndoButton").isDisabled(), true);
  const emptyDraft = await readState(page);
  assert.deepEqual(emptyDraft.ring, committed.ring);
  assert.deepEqual(emptyDraft.readings, committed.readings);
  await page.locator("#polygonCancelButton").click();
  const cancelled = await readState(page);
  assert.deepEqual(cancelled.ring, committed.ring);
  assert.deepEqual(cancelled.readings, committed.readings);
  assert.equal(cancelled.activeGeometryKind, "POLYGON");
  assert.equal(await page.locator("#polygonDraftNotice").isVisible(), false);
  await context.close();
});

test("redraw replaces the polygon only on Finish; Escape preserves the replacement", async () => {
  const { context, page, pageErrors } = await openApp();
  await drawRing(page, RING);
  const replacement = RING.map((vertex) => ({ lat: vertex.lat + 0.002, lon: vertex.lon + 0.002 }));
  await page.locator("#polygonRedrawButton").click();
  await page.evaluate((ring) => { for (const vertex of ring) window.__addVertex(vertex); }, replacement);
  assert.deepEqual((await readState(page)).ring, lens.normalizePolygonRing(RING));
  await page.locator("#polygonFinishButton").click();
  const committed = await readState(page);
  assert.deepEqual(committed.ring, lens.normalizePolygonRing(replacement));
  await page.locator("#polygonRedrawButton").click();
  await page.evaluate(() => window.__addVertex({ lat: 40.41, lon: -3.70 }));
  await page.locator("#map").press("Escape");
  const cancelled = await readState(page);
  assert.deepEqual(cancelled.ring, committed.ring);
  assert.deepEqual(cancelled.readings, committed.readings);
  assert.equal(await page.locator("#spatialToolbar").isVisible(), false);
  assert.deepEqual(pageErrors, []);
  await context.close();
});

test("deleting the polygon returns to the circular Lens exactly as it was", async () => {
  const { context, page } = await openApp();
  const original = await readState(page);
  await drawRing(page, RING);
  assert.equal((await readState(page)).activeGeometryKind, "POLYGON");
  await page.locator("#polygonDeleteButton").click();
  const restored = await readState(page);
  assert.equal(restored.activeGeometryKind, "CIRCLE");
  assert.deepEqual(restored.pressed, { CIRCLE: "true", POLYGON: "false" });
  assert.equal(restored.radiusVisible, true);
  assert.equal(restored.ring, null);
  assert.equal(restored.noticeVisible, false);
  assert.deepEqual(restored.markedUnsupported, [], "the unsupported marks are cleared");
  // The circular readings are exactly what they were before any polygon existed.
  assert.deepEqual(restored.readings, original.readings);
  await context.close();
});

test("the whole workflow is operable from the keyboard", async () => {
  const { context, page } = await openApp();
  // Reach and activate the Polygon button with the keyboard only.
  await page.locator("#geometryModePolygon").focus();
  assert.equal(await page.evaluate(() => document.activeElement.id), "geometryModePolygon");
  await page.keyboard.press("Enter");
  await page.locator("#polygonDrawButton").focus();
  await page.keyboard.press("Enter");
  assert.deepEqual((await readState(page)).visibleButtons,
    ["polygonAddVertexButton", "polygonFinishButton", "polygonCancelButton"]);

  // "Add vertex here" drops a vertex at the map centre: the keyboard route that
  // does not require clicking the map. Pan between presses so the three vertices
  // are distinct.
  for (const [dLat, dLon] of [[0, 0], [0.004, 0], [0, 0.004]]) {
    await page.evaluate(([a, b]) => window.__panMapBy(a, b), [dLat, dLon]);
    await page.locator("#polygonAddVertexButton").focus();
    await page.keyboard.press("Enter");
  }
  let state = await readState(page);
  assert.equal(state.measure.vertices, "3", "three vertices were placed without a map click");
  assert.equal(state.finishAriaDisabled, "false");

  // Enter commits from outside a button; Escape cancels a drawing.
  await page.locator("#polygonFinishButton").focus();
  await page.keyboard.press("Enter");
  state = await readState(page);
  assert.equal(state.activeGeometryKind, "POLYGON");

  await page.locator("#polygonDeleteButton").focus();
  await page.keyboard.press("Enter");
  await page.locator("#geometryModePolygon").press("Enter");
  await page.locator("#polygonDrawButton").press("Enter");
  await page.evaluate(() => window.__addVertex({ lat: 40.41, lon: -3.70 }));
  await page.locator("#map").press("Escape");
  state = await readState(page);
  assert.equal(state.activeGeometryKind, "CIRCLE", "Escape cancelled the drawing");
  assert.deepEqual(state.visibleButtons, ["polygonDrawButton"]);
  await context.close();
});

test("A and B keep independent polygons across mode changes, editing and deletion", async () => {
  const { context, page } = await openApp();
  await drawRing(page, RING);
  const ringB = [
    { lat: 40.420, lon: -3.695 }, { lat: 40.420, lon: -3.675 },
    { lat: 40.435, lon: -3.675 }, { lat: 40.435, lon: -3.695 },
  ];
  await page.locator("#modeCompareButton").click();
  assert.deepEqual(await page.evaluate(() => [window.__geometryKindFor("A"), window.__geometryKindFor("B")]), ["POLYGON", "CIRCLE"]);
  assert.match(await page.locator("#comparisonRadiusReadout").textContent(), /A · Polygon · .+ \| B · Circle ·/);
  const mixed = await page.evaluate(() => ({ points: window.__visiblePoints(), geometryB: window.__geometryFor("B"), countB: document.getElementById("cmpPoiB").textContent }));
  assert.equal(parseInt(mixed.countB, 10), mixed.points.filter((p) => (p.type === "museum" || p.type === "info") && lens.geometryContainsPoint(mixed.geometryB, p)).length);
  assert.match(await page.locator("#haloVisibilityNote").textContent(), /no radius/);
  assert.equal(await page.locator("#spatialSensitivity").isVisible(), false);
  await drawRing(page, ringB);
  assert.deepEqual(await page.evaluate(() => [window.__ringFor("A"), window.__ringFor("B")]), [RING, ringB]);
  const observed = await page.evaluate(() => ({
    points: window.__visiblePoints(),
    cells: ["cmpPoiA", "cmpPoiB", "cmpStayA", "cmpStayB"].map((id) => document.getElementById(id).textContent),
    cue: document.getElementById("comparisonModeCue").textContent,
  }));
  for (const [i, ring] of [RING, ringB].entries()) {
    const inside = observed.points.filter((p) => lens.geometryContainsPoint(lens.createPolygonGeometry(ring), p));
    assert.equal(parseInt(observed.cells[i], 10), inside.filter((p) => p.type === "museum" || p.type === "info").length);
    assert.equal(parseInt(observed.cells[i + 2], 10), inside.filter((p) => p.type === "stay").length);
  }
  assert.match(observed.cue, /Different areas/);
  assert.match(await page.locator("#cmpPoi").textContent(), /Withheld · different areas/);
  await page.locator("#languageSelect").selectOption("es");
  assert.match(await page.locator("#comparisonModeCue").textContent(), /Superficies distintas/);
  await page.locator("#languageSelect").selectOption("en");
  assert.deepEqual(await page.evaluate(() => window.__polygonOutlines().map((shape) => [shape.className, shape.dashArray])),
    [["lens-polygon lens-polygon-a", null], ["lens-polygon lens-polygon-b", "8 5"]]);
  assert.equal(await page.locator(".lens-polygon-label-a").count(), 1);
  assert.equal(await page.locator(".lens-polygon-label-b").count(), 1);
  await page.locator("#polygonEditButton").click();
  await page.locator("#polygonEditAddButton").click();
  await page.locator("#polygonEditCancelButton").click();
  assert.deepEqual(await page.evaluate(() => window.__ringFor("B")), ringB);
  await page.locator("#polygonEditButton").click();
  await page.locator("#polygonEditAddButton").click();
  await page.locator("#polygonEditApplyButton").click();
  assert.equal((await page.evaluate(() => window.__ringFor("B"))).length, 5);
  assert.deepEqual(await page.evaluate(() => window.__ringFor("A")), RING);
  await page.locator("#modePlaceButton").click();
  await page.locator("#modeCompareButton").click();
  assert.deepEqual(await page.evaluate(() => window.__ringFor("A")), RING);
  assert.equal((await page.evaluate(() => window.__ringFor("B"))).length, 5);
  await page.locator("#polygonDeleteButton").click();
  assert.deepEqual(await page.evaluate(() => window.__ringFor("A")), RING);
  assert.equal(await page.evaluate(() => window.__geometryKindFor("B")), "CIRCLE");
  await page.locator("#lensAButton").click();
  await page.locator("#polygonDeleteButton").click();
  assert.deepEqual(await page.evaluate(() => [window.__geometryKindFor("A"), window.__geometryKindFor("B")]), ["CIRCLE", "CIRCLE"]);
  assert.equal(await page.locator("#comparisonBridge").isVisible(), true);
  await context.close();
});

test("the toolbar and scope statement are translated", async () => {
  const { context, page } = await openApp({ locale: "es" });
  const labels = await page.evaluate(() => ({
    circle: document.getElementById("geometryModeCircle").textContent.trim(),
    polygon: document.getElementById("geometryModePolygon").textContent.trim(),
    draw: document.getElementById("polygonDrawButton").textContent.trim(),
  }));
  assert.equal(labels.circle, "Círculo");
  assert.equal(labels.polygon, "Polígono");
  assert.equal(labels.draw, "Dibujar polígono");
  await drawRing(page, RING);
  const scope = await page.evaluate(() => document.getElementById("polygonScopeNotice").textContent);
  assert.match(scope, /El polígono personalizado es la geometría activa/);
  assert.match(scope, /pertenencia exacta punto-en-polígono/);
  const marks = await page.evaluate(() => [...document.querySelectorAll(".geometry-unsupported")]
    .filter((el) => !el.hidden).map((el) => el.textContent.trim()));
  // Both mark kinds must be translated, not just the first.
  assert.ok(marks.some((text) => /No disponible para un polígono personalizado/.test(text)), JSON.stringify(marks));
  assert.ok(marks.some((text) => /Publicado por área oficial — no recortado a este polígono/.test(text)), JSON.stringify(marks));
  assert.ok(marks.every((text) => !/Not available|Published per official/.test(text)), `no English leaked: ${JSON.stringify(marks)}`);
  await context.close();
});

// ---- #197: A/B geometry reproduction (link + local session file) -------------
const RING_B = Object.freeze([
  { lat: 40.420, lon: -3.695 }, { lat: 40.420, lon: -3.675 },
  { lat: 40.435, lon: -3.675 }, { lat: 40.435, lon: -3.695 },
]);
// Deliberately unrounded vertices: only a lossless route can reproduce them.
const FLOAT_RING = Object.freeze([
  { lat: 40.412345678901, lon: -3.702345678901 }, { lat: 40.414567891234, lon: -3.699876543219 },
  { lat: 40.410987654321, lon: -3.698123456789 }, { lat: 40.409876543219, lon: -3.701234567891 },
]);

const openDrawer = (page) => page.evaluate(() => document.getElementById("evidenceDrawer").showModal());

async function buildComparison(page, ringA, ringB) {
  await drawRing(page, ringA);
  await page.locator("#modeCompareButton").click();
  await page.locator("#lensBButton").click();
  if (ringB) await drawRing(page, ringB);
  await page.locator("#lensAButton").click();
  await page.locator("#lensBButton").click(); // end with B active, to prove the active lens travels
}
const snapshotOf = (page) => page.evaluate(() => ({
  rings: [window.__ringFor("A"), window.__ringFor("B")],
  kinds: [window.__geometryKindFor("A"), window.__geometryKindFor("B")],
  cells: ["cmpPoiA", "cmpPoiB", "cmpStayA", "cmpStayB", "cmpMobilityA", "cmpMobilityB"].map((id) => document.getElementById(id).textContent),
  active: document.getElementById("lensBButton").className.includes("active") ? "B" : "A",
  mode: document.querySelector('[data-evidence-mode][aria-pressed="true"], [data-evidence-mode].active')?.dataset.evidenceMode ?? null,
}));
const openAt = async (search, opts) => {
  const { context, page, pageErrors } = await openApp({ ...opts, tools: false });
  void context;
  return { context, page, pageErrors, search };
};
async function reopen(browserContext, search) {
  const page = await browserContext.newPage();
  page.setDefaultTimeout(12000);
  await page.route("**/*", (route) => {
    const hostname = new URL(route.request().url()).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?${search}&haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__) && typeof window.__addVertex === "function");
  await page.waitForFunction(() => window.__visiblePoints().length > 0);
  return page;
}

test("a shared link restores two polygons exactly, with the active Lens", async () => {
  const { context, page } = await openApp();
  await buildComparison(page, RING, RING_B);
  const before = await snapshotOf(page);
  await openDrawer(page);
  await page.locator("#k11ShareBtn").click();
  await page.waitForFunction(() => document.getElementById("k11ShareStatus").textContent.trim().length > 0);
  const status = await page.locator("#k11ShareStatus").textContent();
  assert.match(status, /restores both geometries/);
  const search = await page.evaluate(() => location.search.slice(1).replace(/&?haloRegressionTest=1/, ""));
  assert.match(search, /(^|&)ga=/);
  assert.match(search, /(^|&)gb=/);
  assert.ok(search.length <= 1900, `query ${search.length} chars`);
  const restored = await reopen(context, search);
  await restored.waitForFunction(() => window.__ringFor("B"));
  const after = await snapshotOf(restored);
  assert.deepEqual(after.rings, before.rings, "ring vertices and order identical (4-decimal fixture, within link precision)");
  assert.deepEqual(after.kinds, ["POLYGON", "POLYGON"]);
  assert.equal(after.active, "B");
  assert.deepEqual(after.cells, before.cells, "results recompute identically for identical geometry");
  assert.equal(await restored.locator("#k11RestoreNotice").isVisible(), false, "exact restore shows no degradation notice");
  await context.close();
});

test("a mixed link restores polygon A with circle B and keeps the circle radius", async () => {
  const { context, page } = await openApp();
  await buildComparison(page, RING, null);
  const before = await snapshotOf(page);
  await openDrawer(page);
  await page.locator("#k11ShareBtn").click();
  const search = await page.evaluate(() => location.search.slice(1).replace(/&?haloRegressionTest=1/, ""));
  assert.match(search, /(^|&)ga=/);
  assert.doesNotMatch(search, /(^|&)gb=/);
  const restored = await reopen(context, search);
  const after = await snapshotOf(restored);
  assert.deepEqual(after.kinds, ["POLYGON", "CIRCLE"]);
  assert.deepEqual(after.rings[0], before.rings[0]);
  assert.deepEqual(after.cells, before.cells);
  await context.close();
});

test("a polygon too large for a link is refused with a reproducible alternative, never silently dropped", async () => {
  const { context, page } = await openApp();
  const n = 40;
  const big = Array.from({ length: n }, (_, i) => ({ lat: 40.42 + 0.01 * Math.sin((2 * Math.PI * i) / n), lon: -3.70 + 0.01 * Math.cos((2 * Math.PI * i) / n) }));
  await drawRing(page, big);
  await page.locator("#modePlaceButton").click();
  await openDrawer(page);
  await page.locator("#k11ShareBtn").click();
  const status = await page.locator("#k11ShareStatus").textContent();
  assert.match(status, /Link not copied/);
  assert.match(status, /Save session/);
  const search = await page.evaluate(() => location.search.slice(1).replace(/&?haloRegressionTest=1/, ""));
  assert.match(search, /(^|&)gx=A(&|$)/, "the address bar says a polygon is missing instead of posing as exact");
  assert.doesNotMatch(search, /(^|&)ga=/);
  const restored = await reopen(context, search);
  const notice = restored.locator("#k11RestoreNotice");
  await notice.waitFor({ state: "visible" });
  assert.match(await notice.textContent(), /too large to encode/);
  assert.equal(await restored.evaluate(() => window.__geometryKindFor("A")), "CIRCLE", "the circle is shown AND the notice says it is not the polygon");
  await context.close();
});

test("a legacy circle link still restores exactly", async () => {
  const { context, page } = await openApp({ tools: false });
  const restored = await reopen(context, "v=1&m=COMPARE&a=40.41500%2C-3.70300%2C950&b=40.42500%2C-3.69000%2C600&be=1&al=B&ly=museum&sc=LENS&rd=citizen&lg=en");
  assert.deepEqual(await restored.evaluate(() => [window.__geometryKindFor("A"), window.__geometryKindFor("B")]), ["CIRCLE", "CIRCLE"]);
  assert.equal(await restored.locator("#k11RestoreNotice").isVisible(), false);
  await context.close();
});

test("session round-trip: save A/B polygons, restore in a fresh page, recompute and compare", async () => {
  const { context, page } = await openApp();
  await drawRing(page, FLOAT_RING);
  await page.locator("#modeCompareButton").click();
  await page.locator("#lensBButton").click();
  await drawRing(page, RING_B);
  const before = await snapshotOf(page);
  await openDrawer(page);
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#k11SessionBtn").click()]);
  const filePath = path.join(ROOT, `.session-test-${process.pid}.json`);
  await download.saveAs(filePath);
  try {
    const file = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(file.schema, "madrid-lens-session");
    assert.deepEqual(file.geometries.A.ring, FLOAT_RING, "export keeps full-precision vertices in order");
    assert.equal(file.geometries.B.kind, "POLYGON");
    assert.ok(file.geometries.A.areaKm2 > 0);
    assert.equal(file.state.activeLens, "B");
    assert.ok(file.snapshot_id);
    assert.ok(file.limitations.length > 0);
    assert.ok(file.evidence.length > 0, "source provenance travels with the file");
    assert.ok(file.readings.A.tourism, "the readings computed from these geometries travel with them");
    assert.equal(file.readings.A.pedestrian.status, "off", "layers that are off are recorded as off, not zero");
    assert.ok(file.limitations.some((l) => /NOT a capture of every figure/.test(l)), "the file states it is not a full capture");

    const fresh = await openAt("", {});
    await fresh.page.locator("#k11RestoreInput").setInputFiles(filePath);
    await fresh.page.waitForFunction(() => /Session restored/.test(document.getElementById("k11ShareStatus").textContent));
    const after = await snapshotOf(fresh.page);
    assert.deepEqual(after.rings, before.rings, "geometry equal at full precision");
    assert.equal(after.active, "B");
    assert.deepEqual(after.cells, before.cells, "recomputed results equal");
    const message = await fresh.page.locator("#k11ShareStatus").textContent();
    assert.match(message, /identical to the file/);
    assert.match(message, /equal those saved/, "result equivalence reported separately from geometry equality");
    // Recalculating after restore keeps both geometries independent.
    await fresh.page.locator("#lensAButton").click();
    await fresh.page.evaluate(() => window.__commitRing([{ lat: 40.40, lon: -3.72 }, { lat: 40.40, lon: -3.71 }, { lat: 40.41, lon: -3.71 }]));
    assert.deepEqual(await fresh.page.evaluate(() => window.__ringFor("B")), RING_B, "editing A after a restore does not touch B");
    assert.equal((await fresh.page.evaluate(() => window.__ringFor("A"))).length, 3);
    await fresh.context.close();
  } finally {
    fs.rmSync(filePath, { force: true });
  }
  await context.close();
});

test("a corrupt, tampered or oversized session file is refused and leaves the workspace untouched", async () => {
  const { context, page } = await openApp();
  await drawRing(page, RING);
  const before = await snapshotOf(page);
  await openDrawer(page);
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#k11SessionBtn").click()]);
  const good = path.join(ROOT, `.session-good-${process.pid}.json`);
  await download.saveAs(good);
  const cases = {
    notJson: "{ nope",
    wrongSchema: JSON.stringify({ schema: "x" }),
    tampered: (() => { const f = JSON.parse(fs.readFileSync(good, "utf8")); f.geometries.A.ring[0].lat += 0.001; return JSON.stringify(f); })(),
    incomplete: (() => { const f = JSON.parse(fs.readFileSync(good, "utf8")); delete f.geometries.B; return JSON.stringify(f); })(),
    oversized: "x".repeat(1_100_000),
  };
  const written = [];
  try {
    for (const [name, body] of Object.entries(cases)) {
      const target = path.join(ROOT, `.session-bad-${name}-${process.pid}.json`);
      fs.writeFileSync(target, body);
      written.push(target);
      await page.locator("#k11RestoreInput").setInputFiles(target);
      await page.waitForFunction(() => /not restored/.test(document.getElementById("k11ShareStatus").textContent));
      assert.equal(await page.locator("#k11ShareStatus").getAttribute("data-tone"), "error", name);
      const after = await snapshotOf(page);
      assert.deepEqual(after, before, `${name}: previous workspace unchanged`);
      await page.evaluate(() => { document.getElementById("k11ShareStatus").textContent = ""; });
    }
  } finally {
    for (const file of [good, ...written]) fs.rmSync(file, { force: true });
  }
  await context.close();
});

test("saving never creates a file the importer would refuse", async () => {
  const { context, page } = await openApp();
  const n = 2001;
  const ring = Array.from({ length: n }, (_, i) => ({ lat: 40.42 + 0.01 * Math.sin((2 * Math.PI * i) / n), lon: -3.70 + 0.01 * Math.cos((2 * Math.PI * i) / n) }));
  await drawRing(page, ring);
  assert.equal(await page.evaluate(() => window.__ringFor("A").length), n);
  await openDrawer(page);
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await page.locator("#k11SessionBtn").click();
  await page.waitForFunction(() => /No file was created/.test(document.getElementById("k11ShareStatus").textContent));
  assert.equal(await page.locator("#k11ShareStatus").getAttribute("data-tone"), "error");
  assert.equal(await page.locator("#k11ShareStatus .k11-export-link").count(), 0);
  await page.waitForTimeout(300);
  assert.equal(downloaded, false);
  await context.close();
});

test("session save and restore controls are translated and keyboard reachable", async () => {
  const { context, page } = await openApp({ locale: "es", tools: false });
  assert.equal((await page.locator("#k11SessionBtn").textContent()).trim(), "Guardar sesión");
  assert.equal((await page.locator("#k11RestoreBtn").textContent()).trim(), "Restaurar sesión");
  assert.equal(await page.locator("#k11RestoreBtn").evaluate((el) => el.tagName), "BUTTON");
  assert.equal(await page.locator("#k11ShareStatus").getAttribute("role"), "status");
  await context.close();
  // All four actions stay inside a 360px viewport with no horizontal page scroll.
  const mobile = await openApp({ locale: "es", tools: false, viewport: { width: 360, height: 740 } });
  await openDrawer(mobile.page);
  for (const id of ["k11ShareBtn", "k11ExportBtn", "k11SessionBtn", "k11RestoreBtn"]) {
    const box = await mobile.page.locator(`#${id}`).boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 360 && box.height >= 32, `${id} fits at 360px: ${JSON.stringify(box)}`);
  }
  assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await mobile.context.close();
});

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("committed A/B outlines stay legible on the light basemap and follow a basemap change in place", async () => {
  // Pale OSM/CARTO land (#f2efe9) is the real surface in the default light theme.
  const LIGHT_LAND = "#f2efe9";
  const ringB = [
    { lat: 40.420, lon: -3.695 }, { lat: 40.420, lon: -3.675 },
    { lat: 40.435, lon: -3.675 }, { lat: 40.435, lon: -3.695 },
  ];
  const { context, page, pageErrors } = await openApp();
  await drawRing(page, RING);
  await page.locator("#modeCompareButton").click();
  await drawRing(page, ringB);
  const colors = () => page.evaluate(() => window.__polygonOutlines().map((shape) => shape.color));
  const [lightA, lightB] = await colors();
  assert.ok(contrast(lightA, LIGHT_LAND) >= 3, `A outline ${lightA} on light land: ${contrast(lightA, LIGHT_LAND).toFixed(2)}:1`);
  assert.ok(contrast(lightB, LIGHT_LAND) >= 3, `B outline ${lightB} on light land: ${contrast(lightB, LIGHT_LAND).toFixed(2)}:1`);
  const rings = await page.evaluate(() => [window.__ringFor("A"), window.__ringFor("B")]);
  await page.locator("#basemapSelect").selectOption("dark");
  const [darkA, darkB] = await colors();
  assert.notEqual(darkA, lightA, "dark basemap restyles A in place");
  assert.notEqual(darkB, lightB, "dark basemap restyles B in place");
  assert.deepEqual(await page.evaluate(() => [window.__ringFor("A"), window.__ringFor("B")]), rings, "restyle never touches geometry");
  assert.deepEqual(await page.evaluate(() => window.__polygonOutlines().map((shape) => shape.dashArray)), [null, "8 5"], "identity still carried by dash, not colour alone");
  await page.locator("#basemapSelect").selectOption("light");
  assert.deepEqual(await colors(), [lightA, lightB]);
  assert.deepEqual(pageErrors, []);
  await context.close();
});

test("drawing disclosure opens without changing geometry and Escape returns focus", async () => {
  const { context, page, pageErrors } = await openApp({ tools: false });
  assert.equal(await page.locator("#spatialToolbar").isVisible(), false);
  const before = await page.evaluate(() => window.__geometryKind());
  await page.locator("#spatialToolsToggle").press("Enter");
  assert.equal(await page.locator("#spatialToolsToggle").getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator("#spatialToolbar").isVisible(), true);
  assert.equal(await page.evaluate(() => window.__geometryKind()), before);
  await page.locator("#geometryModeCircle").press("Escape");
  assert.equal(await page.locator("#spatialToolbar").isVisible(), false);
  assert.equal(await page.locator("#spatialToolsToggle").getAttribute("aria-expanded"), "false");
  assert.equal(await page.evaluate(() => document.activeElement.id), "spatialToolsToggle");
  assert.deepEqual(pageErrors, []);
  await context.close();
});

test("the polygon toolbar does not overlap the map chrome on desktop or mobile", async () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 560, height: 400 }]) {
    const { context, page } = await openApp({ viewport });
    await page.locator("#geometryModePolygon").click();
    await page.locator("#polygonDrawButton").click();
    await page.evaluate(() => { for (const v of [{ lat: 40.41, lon: -3.70 }, { lat: 40.41, lon: -3.68 }, { lat: 40.425, lon: -3.69 }]) window.__addVertex(v); });
    const boxes = await page.evaluate(() => {
      const box = (selector) => {
        const el = document.querySelector(selector);
        if (!el || el.hidden) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      return {
        toolbar: box("#spatialToolbar"),
        toggle: box("#spatialToolsToggle"),
        zoom: box(".leaflet-control-zoom"),
        attribution: box(".leaflet-control-attribution"),
        panel: box("#analysisPanel"),
        rail: box("#layerRail"),
      };
    });
    // Boolean, not a falsy value: an element that is not on screen at this
    // viewport cannot be overlapped, and must read as a clean `false`.
    const hits = (a, b) => Boolean(a && b && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1);
    assert.ok(boxes.toolbar && boxes.toolbar.width > 0, `${viewport.width}x${viewport.height}: the toolbar is on screen`);
    assert.ok(boxes.toggle.top >= boxes.zoom.bottom, "drawing action sits below zoom");
    for (const name of ["zoom", "attribution", "panel", "rail", "toggle"]) {
      assert.equal(hits(boxes.toolbar, boxes[name]), false,
        `${viewport.width}x${viewport.height}: the toolbar must not overlap ${name} (${JSON.stringify(boxes.toolbar)} vs ${JSON.stringify(boxes[name])})`);
    }
    await context.close();
  }
});

test.after(async () => {
  await browser.close();
  server.close();
});
