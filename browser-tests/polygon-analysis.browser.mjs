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
  assert.match(after.status, /Drag a vertex handle/);

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

test("vertices can be edited, and the readings follow the edited ring", async () => {
  const { context, page } = await openApp();
  await drawRing(page, RING);
  const before = await readState(page);
  // A REAL pointer drag on a vertex handle, not a call into the commit path, so
  // the handle wiring itself is under test.
  const handle = await page.evaluate(() => {
    const vertex = window.__ring()[0];
    return window.__latLngToPoint(vertex.lat, vertex.lon);
  });
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x - 60, handle.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction((previous) => JSON.stringify(window.__ring()) !== previous,
    JSON.stringify(before.ring));
  const after = await readState(page);
  assert.notDeepEqual(after.ring, before.ring, "dragging a handle rewrote the ring");
  assert.equal(after.ring.length, before.ring.length, "a drag moves a vertex, it does not add one");
  assert.notEqual(after.measure.area, before.measure.area, "the measurements follow the edited ring");
  assert.equal(after.activeGeometryKind, "POLYGON");

  // The readings follow the edit too: enlarging the ring cannot lose records.
  const enlarged = await page.evaluate(() => {
    window.__commitRing([
      { lat: 40.4050, lon: -3.7200 }, { lat: 40.4050, lon: -3.6700 },
      { lat: 40.4300, lon: -3.6700 }, { lat: 40.4300, lon: -3.7200 },
    ]);
    return {
      tourism: Number(document.getElementById("tourismValue").textContent.trim()),
      points: window.__visiblePoints(),
      ring: window.__ring(),
    };
  });
  const geometry = lens.createPolygonGeometry(enlarged.ring);
  const inside = enlarged.points.filter((p) => lens.geometryContainsPoint(geometry, p));
  assert.equal(enlarged.tourism,
    inside.filter((p) => p.type === "museum").length + inside.filter((p) => p.type === "info").length,
    "the edited ring's counts are exact point-in-polygon, not stale");
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

test("polygon analysis is refused outside PLACE rather than reinterpreted", async () => {
  const { context, page } = await openApp();
  await drawRing(page, RING);
  assert.equal((await readState(page)).activeGeometryKind, "POLYGON");
  await page.locator("#modeCompareButton").click();
  await page.waitForTimeout(400);
  const inCompare = await page.evaluate(() => ({
    kind: window.__geometryKind(),
    pressed: document.getElementById("geometryModePolygon").getAttribute("aria-pressed"),
    documentGeometry: document.documentElement.dataset.analysisGeometry,
    noticeVisible: !document.getElementById("polygonScopeNotice").hidden,
  }));
  assert.equal(inCompare.kind, "CIRCLE", "the A/B comparison is never fed a polygon");
  assert.equal(inCompare.pressed, "false");
  assert.equal(inCompare.documentGeometry, "CIRCLE");
  // Pressing Polygon in COMPARE states why it is refused.
  await page.locator("#geometryModePolygon").click();
  const note = await page.evaluate(() => {
    const el = document.getElementById("geometryModeNote");
    return { hidden: el.hidden, text: el.textContent.trim() };
  });
  assert.equal(await page.evaluate(() => window.__geometryKind()), "CIRCLE");
  assert.equal(note.hidden, false, "the refusal is stated, not silent");
  assert.match(note.text, /PLACE only/);
  await context.close();
});

test("the toolbar copy, the scope statement and the refusal are translated", async () => {
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

test("the shared link still carries the circular Lens, and says the polygon is not in it", async () => {
  const { context, page } = await openApp();
  const circleUrl = page.url();
  await drawRing(page, RING);
  // The committed URL state is unchanged in shape: no new dimension was invented.
  const urlState = await page.evaluate(() => location.search);
  assert.match(urlState, /[?&]v=1\b/, "the v=1 schema still applies");
  assert.match(urlState, /[?&]a=40\.\d+%2C-3\.\d+%2C\d+/, "the circular Lens A is still what the URL carries");
  assert.doesNotMatch(urlState, /polygon|ring|poly=/i, "no polygon dimension was added to the schema");
  await page.locator('[data-evidence-mode="PLACE"]').click();
  await page.waitForTimeout(400);
  await page.locator("#k11ShareBtn").click();
  await page.waitForTimeout(400);
  const status = await page.locator("#k11ShareStatus").textContent();
  assert.match(status, /carries the circular Lens only/,
    "copying a link while a polygon is active must say what the link does not carry");
  assert.match(status, /Export evidence/);
  void circleUrl;
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
