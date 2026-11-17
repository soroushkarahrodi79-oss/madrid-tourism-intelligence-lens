// Historical PNOA comparison (2006 | 2023) is an OPT-IN visual aid, never evidence.
// Tile requests are stubbed (no external traffic). This asserts: no request until
// the reader opts in, the exact WMS request shape, that both images share one
// pan/zoom and the divider really splits them, keyboard use, that contemporary
// panes are hidden (not removed) behind a persistent notice, mutual exclusion with
// the current-PNOA overlay and exact restoration, per-side failure messages, and
// that no Lens reading, panel text or canonical URL moves.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".css": "text/css", ".geojson": "application/geo+json", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(`${ROOT}${path.sep}`)) return response.writeHead(403).end();
  fs.readFile(target, (error, content) => (error
    ? response.writeHead(404).end()
    : response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" }).end(content)));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });
test.after(async () => { await browser.close(); server.close(); });

// net.hist[LAYER] = "ok" | "down" | "flaky" (every other tile fails)
async function openPage({ viewport = { width: 1280, height: 800 }, hist = {}, pnoa = "ok" } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const histRequests = [];
  const pnoaRequests = [];
  const net = { hist: { PNOA2006: "ok", PNOA2023: "ok", ...hist }, pnoa, flip: 0 };
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/runtime-config.js")) return route.fulfill({ contentType: "text/javascript", body: 'window.RUNTIME_CONFIG={CARTO_BASEMAP_KEY:""};' });
    if (url.hostname === "127.0.0.1") return route.continue();
    if (url.hostname === "www.ign.es") {
      if (url.pathname === "/wms/pnoa-historico") {
        histRequests.push(url);
        const mode = net.hist[url.searchParams.get("layers")];
        const fail = mode === "down" || (mode === "flaky" && (net.flip++ % 2 === 0));
        return fail ? route.fulfill({ status: 503, body: "" }) : route.fulfill({ contentType: "image/png", body: PNG_1X1 });
      }
      pnoaRequests.push(url);
      return net.pnoa === "down" ? route.fulfill({ status: 503, body: "" }) : route.fulfill({ contentType: "image/png", body: PNG_1X1 });
    }
    if (route.request().resourceType() === "image") return route.fulfill({ contentType: "image/png", body: PNG_1X1 });
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?lang=en`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#histToggle", { state: "attached" });
  return { page, context, histRequests, pnoaRequests, net };
}
const histState = (page) => page.evaluate(() => {
  const el = document.getElementById("histStatus");
  return { state: el.dataset.state, text: el.textContent };
});
const waitHist = (page, state) => page.waitForFunction((s) => document.getElementById("histStatus").dataset.state === s, state);
const waitPnoa = (page, state) => page.waitForFunction((s) => document.getElementById("pnoaStatus").dataset.state === s, state);
const toggleHist = (page) => page.locator("label.switch:has(#histToggle)").click();
const lensStroke = (page) => page.evaluate(() => lenses.A.circle.options.color);
// Left and right tile rectangles, sorted, so alignment is a plain deep-equal.
const tileRects = (page) => page.evaluate(() => {
  const grab = (cls) => [...document.querySelectorAll(`.${cls} img.leaflet-tile-loaded`)]
    .map((img) => { const r = img.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { left: grab("leaflet-histLeft-pane"), right: grab("leaflet-histRight-pane") };
});
// Where each pane is cut, in container pixels (clip-path is in layer space).
const splits = (page) => page.evaluate(() => {
  const nw = map.containerPointToLayerPoint([0, 0]);
  const xs = (name) => (map.getPane(name).style.clipPath.match(/-?[\d.]+(?=px)/g) || []).map(Number);
  const l = xs("histLeftPane");
  const r = xs("histRightPane");
  return { leftEnd: l[2] - nw.x, rightStart: r[0] - nw.x, width: map.getSize().x };
});

test("default: off, no historical request, bar hidden, nothing attributed", async () => {
  const { page, context, histRequests } = await openPage();
  assert.equal(await page.locator("#histToggle").isChecked(), false);
  assert.equal(await page.locator("#histCompareBar").isHidden(), true);
  assert.equal(await page.locator(".leaflet-histLeft-pane img, .leaflet-histRight-pane img").count(), 0);
  assert.doesNotMatch(await page.locator("#map .leaflet-control-attribution").innerText(), /2006|2023/);
  assert.match(await page.locator("#histHint").innerText(), /no count, indicator or Lens result uses it/);
  assert.equal(await page.locator("#histToggle").getAttribute("aria-describedby"), "histHint");
  await page.waitForTimeout(400);
  assert.equal(histRequests.length, 0, "nothing is requested from the historical service until the reader opts in");
  await context.close();
});

test("on: both official layers requested, attribution and notice visible, pilot framed", async () => {
  const { page, context, histRequests } = await openPage();
  await toggleHist(page);
  await waitHist(page, "on");
  const layers = new Set(histRequests.map((u) => u.searchParams.get("layers")));
  assert.deepEqual([...layers].sort(), ["PNOA2006", "PNOA2023"]);
  const q = histRequests[0];
  assert.equal(q.pathname, "/wms/pnoa-historico");
  assert.equal(q.searchParams.get("request"), "GetMap");
  assert.equal(q.searchParams.get("version"), "1.3.0");
  assert.equal(q.searchParams.get("crs"), "EPSG:3857");
  assert.match((await histState(page)).text, /2006 on the left, 2023 on the right/);
  const attribution = await page.locator("#map .leaflet-control-attribution").innerText();
  assert.match(attribution, /PNOA 2006/);
  assert.match(attribution, /PNOA 2023/);
  assert.match(attribution, /Instituto Geográfico Nacional/);
  assert.match(attribution, /CC BY 4\.0/);
  const notice = await page.locator("#histNotice").innerText();
  assert.match(notice, /annual PNOA mosaics, not single dates/);
  assert.match(notice, /0\.50 m vs 0\.25 m/);
  assert.match(notice, /shadows and orthorectification/);
  assert.match(notice, /does not show what was built or why/);
  assert.match(notice, /hidden and do not describe these years/);
  assert.match(notice, /CC BY 4\.0/);
  assert.equal(await page.locator("#histCompareBar").isVisible(), true);
  const c = await page.evaluate(() => ({ ...map.getCenter(), zoom: map.getZoom() }));
  assert.ok(Math.abs(c.lat - 40.3925) < 1e-3 && Math.abs(c.lng + 3.699) < 1e-3 && c.zoom === 17);
  await context.close();
});

test("both images share one pan/zoom: tile rectangles stay aligned", async () => {
  const { page, context } = await openPage();
  await toggleHist(page);
  await waitHist(page, "on");
  for (const move of [
    () => map.panBy([260, -140], { animate: false }),
    () => map.zoomIn(1, { animate: false }),
    () => map.setZoom(16, { animate: false }),
  ]) {
    await page.evaluate(move);
    await waitHist(page, "on");
    await page.waitForTimeout(150);
    const { left, right } = await tileRects(page);
    assert.ok(left.length > 0 && right.length > 0, "both panes have tiles");
    assert.deepEqual(left, right, "same tile grid, same screen position");
  }
  await context.close();
});

test("the divider really splits the two images, by keyboard", async () => {
  const { page, context } = await openPage();
  await toggleHist(page);
  await waitHist(page, "on");
  let s = await splits(page);
  assert.ok(Math.abs(s.leftEnd - s.width / 2) < 1 && Math.abs(s.rightStart - s.width / 2) < 1, "starts at the middle");

  await page.locator("#histSlider").focus();
  assert.equal(await page.evaluate(() => document.activeElement.id), "histSlider");
  await page.keyboard.press("Home");
  s = await splits(page);
  assert.ok(Math.abs(s.leftEnd) < 1 && Math.abs(s.rightStart) < 1, "Home: all 2023");
  assert.match(await page.locator("#histSlider").getAttribute("aria-valuetext"), /^0% of the map shows 2006, 100% shows 2023$/);
  await page.keyboard.press("End");
  s = await splits(page);
  assert.ok(Math.abs(s.leftEnd - s.width) < 1 && Math.abs(s.rightStart - s.width) < 1, "End: all 2006");
  await page.keyboard.press("Home");
  for (let i = 0; i < 25; i += 1) await page.keyboard.press("ArrowRight");
  s = await splits(page);
  assert.ok(Math.abs(s.leftEnd - s.width * 0.25) < 1, "25 arrow presses = 25%");
  assert.equal(await page.locator("#histSlider").inputValue(), "25");
  assert.equal(await page.evaluate(() => document.getElementById("histDivider").style.left), "25%");
  assert.match(await page.locator("#histSlider").getAttribute("aria-valuetext"), /^25% of the map shows 2006, 75% shows 2023$/);

  await page.evaluate(() => map.panBy([300, 0], { animate: false })); // the split is screen-fixed
  s = await splits(page);
  assert.ok(Math.abs(s.leftEnd - s.width * 0.25) < 1, "split stays at the same screen position after a pan");
  await context.close();
});

test("contemporary panes are hidden, not removed; no click moves a Lens or a selection", async () => {
  const { page, context } = await openPage();
  await page.waitForFunction(() => typeof lenses !== "undefined" && lenses.A.marker
    && !/locating…|loading…/i.test(document.getElementById("analysisPanel").innerText)); // data settled
  const read = () => page.evaluate(() => ({ a: lenses.A.marker.getLatLng(), panel: document.getElementById("analysisPanel").innerText }));
  const before = await read();
  await toggleHist(page);
  await waitHist(page, "on");
  const vis = await page.evaluate(() => {
    const v = (n) => getComputedStyle(map.getPane(n)).visibility;
    return { lens: v("lensPane"), halo: v("haloPane"), admin: v("adminPane"), licence: v("licencePane"), planning: v("planningPane"), hospitality: v("hospitalityPane"), marker: v("markerPane"), overlay: v("overlayPane"), tooltip: v("tooltipPane"), popup: v("popupPane"), tile: v("tilePane"), left: v("histLeftPane"), right: v("histRightPane") };
  });
  for (const k of ["lens", "halo", "admin", "licence", "planning", "hospitality", "marker", "overlay", "tooltip", "popup"]) assert.equal(vis[k], "hidden", `${k} pane is hidden`);
  for (const k of ["tile", "left", "right"]) assert.equal(vis[k], "visible", `${k} pane stays visible`);
  assert.equal(await page.evaluate(() => map.hasLayer(lenses.A.marker)), true, "layers are still on the map (hidden, not removed)");
  assert.equal(await page.locator("#histNotice").isVisible(), true);

  await page.mouse.click(640, 400); // would move the Lens centre outside the mode
  await page.waitForTimeout(150);
  const during = await read();
  assert.deepEqual(during.a, before.a, "a map click under the comparison does not move Lens A");
  assert.equal(during.panel, before.panel, "no reading is recomputed or re-worded");
  await page.locator("#histExit").click();
  const after = await read();
  assert.deepEqual(after.a, before.a);
  assert.equal(after.panel, before.panel);
  assert.equal(await page.evaluate(() => getComputedStyle(map.getPane("lensPane")).visibility), "visible");
  await context.close();
});

test("exit restores view, palette, URL and the previous PNOA state exactly (PNOA was on)", async () => {
  const { page, context } = await openPage();
  await page.locator("label.switch:has(#pnoaToggle)").click();
  await waitPnoa(page, "on");
  await page.selectOption("#basemapSelect", "dark");
  await page.evaluate(() => map.setView([40.43, -3.68], 15, { animate: false }));
  const urlBefore = await page.evaluate(() => location.search + location.hash);
  const strokeBefore = await lensStroke(page);
  const viewBefore = await page.evaluate(() => ({ ...map.getCenter(), zoom: map.getZoom() }));

  await toggleHist(page);
  await waitHist(page, "on");
  assert.equal(await page.locator("#pnoaToggle").isChecked(), false, "current PNOA is paused");
  assert.equal(await page.locator("#pnoaToggle").isDisabled(), true, "and cannot be switched on underneath");
  assert.equal(await page.locator(".leaflet-pnoa-pane img").count(), 0);
  assert.match(await page.locator("#pnoaStatus").innerText(), /Paused while the historical comparison is active/);
  assert.equal(await page.evaluate(() => location.search + location.hash), urlBefore, "the shareable URL does not encode the comparison");

  await page.locator("#histExit").click();
  await waitPnoa(page, "on");
  assert.equal(await page.locator("#pnoaToggle").isChecked(), true);
  assert.equal(await page.locator("#pnoaToggle").isDisabled(), false);
  assert.ok(await page.locator(".leaflet-pnoa-pane img").count() > 0, "PNOA overlay returns");
  assert.equal(await page.locator(".leaflet-histLeft-pane img, .leaflet-histRight-pane img").count(), 0);
  assert.equal(await page.locator("#histToggle").isChecked(), false);
  assert.equal(await page.locator("#histCompareBar").isHidden(), true);
  assert.equal(await page.evaluate(() => map.getPane("histLeftPane").style.clipPath), "");
  assert.doesNotMatch(await page.locator("#map .leaflet-control-attribution").innerText(), /PNOA 2006|PNOA 2023/);
  assert.equal(await page.locator("#basemapSelect").inputValue(), "dark");
  assert.equal(await lensStroke(page), strokeBefore, "palette restored");
  assert.deepEqual(await page.evaluate(() => ({ ...map.getCenter(), zoom: map.getZoom() })), viewBefore, "map view restored");
  assert.equal(await page.evaluate(() => location.search + location.hash), urlBefore);
  assert.equal(await page.evaluate(() => document.activeElement.id), "histToggle", "focus returns to the switch");
  await context.close();
});

test("exit leaves the current PNOA off when it was off", async () => {
  const { page, context, pnoaRequests } = await openPage();
  const strokeBefore = await lensStroke(page);
  await toggleHist(page);
  await waitHist(page, "on");
  await page.locator("#histExit").click();
  assert.equal(await page.evaluate(() => document.getElementById("pnoaStatus").dataset.state), "off");
  assert.equal(await page.locator("#pnoaToggle").isChecked(), false);
  assert.equal(await page.locator("#pnoaToggle").isDisabled(), false);
  assert.equal(await lensStroke(page), strokeBefore);
  await page.waitForTimeout(200);
  assert.equal(pnoaRequests.length, 0, "the current-PNOA service was never asked");
  await context.close();
});

test("one side down: that side is named, the other is unaffected, notice persists", async () => {
  const { page, context } = await openPage({ hist: { PNOA2006: "down" } });
  await toggleHist(page);
  await waitHist(page, "error");
  const text = (await histState(page)).text;
  assert.match(text, /2006 \(left\) imagery is unavailable/);
  assert.doesNotMatch(text, /2023/);
  const rects = await tileRects(page);
  assert.ok(rects.right.length > 0, "2023 side still shows");
  assert.equal(rects.left.length, 0);
  assert.equal(await page.locator("#histNotice").isVisible(), true);
  await context.close();
});

test("right side down, both down, and partial tile loss are each reported", async () => {
  let t = await openPage({ hist: { PNOA2023: "down" } });
  await toggleHist(t.page);
  await waitHist(t.page, "error");
  let text = (await histState(t.page)).text;
  assert.match(text, /2023 \(right\) imagery is unavailable/);
  assert.doesNotMatch(text, /2006/);
  await t.context.close();

  t = await openPage({ hist: { PNOA2006: "down", PNOA2023: "down" } });
  await toggleHist(t.page);
  await waitHist(t.page, "error");
  text = (await histState(t.page)).text;
  assert.match(text, /2006 \(left\) imagery is unavailable/);
  assert.match(text, /2023 \(right\) imagery is unavailable/);
  assert.ok(await t.page.locator(".leaflet-tile-pane img").count() > 0, "basemap still present");
  await t.context.close();

  t = await openPage({ hist: { PNOA2006: "flaky" } });
  await toggleHist(t.page);
  await waitHist(t.page, "partial");
  assert.match((await histState(t.page)).text, /Some 2006 \(left\) tiles did not load/);
  await t.context.close();
});

test("Spanish and a phone-width viewport: copy, reachable controls, bar inside the screen", async () => {
  const { page, context } = await openPage({ viewport: { width: 390, height: 780 } });
  await page.selectOption("#languageSelect", "es");
  await page.waitForFunction(() => /Desactivada/.test(document.getElementById("histHint").textContent));
  await page.locator("#mobileLayersButton").click();
  await page.locator('.rail-group[data-rail-group="map"] > summary').click();
  assert.match(await page.locator("#histLabel").innerText(), /Ortofotos históricas/);
  assert.equal(await page.locator("#histLabel").isVisible(), true, "the switch is reachable in the phone rail");
  await page.locator("label.switch:has(#histToggle)").click();
  await waitHist(page, "on");
  assert.match((await histState(page)).text, /2006 a la izquierda, 2023 a la derecha/);
  assert.match(await page.locator("#histNotice").innerText(), /no demuestra qué se construyó ni por qué/);
  const box = await page.locator("#histCompareBar").boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 780, "bar fits the phone screen");
  const slider = await page.locator("#histSlider").boundingBox();
  assert.ok(slider.width >= 120 && slider.height >= 44, "slider is usable by touch");
  assert.match(await page.locator("#histSlider").getAttribute("aria-valuetext"), /El 50% del mapa muestra 2006/);
  await context.close();
});

// ---- Analytical isolation (PR #193 review) -----------------------------------
// The comparison is a visual inspection mode. Every action that could move a Lens,
// a selection, a radius, a mode, a geometry or a layer must be inert while it is on
// and fully normal again afterwards, and the contemporary readings that stay
// visible must say they are contemporary.
const analytic = (page) => page.evaluate(() => ({
  a: lenses.A.marker.getLatLng(),
  b: lenses.B.marker.getLatLng(),
  radius: document.getElementById("radiusSlider").value,
  mode: document.getElementById("analysisPanel").dataset.mode,
  layers: [...document.querySelectorAll("#layerRail input[type=checkbox]")].filter((i) => !["histToggle", "pnoaToggle"].includes(i.id)).map((i) => [i.id, i.checked]),
  geometry: document.querySelector("[data-geometry-mode][aria-pressed=true]")?.dataset.geometryMode ?? null,
  lensB: document.getElementById("lensBButton").textContent,
  panel: document.getElementById("analysisPanel").innerText,
}));
const settled = (page) => page.waitForFunction(() => typeof lenses !== "undefined" && lenses.A.marker
  && !/locating…|loading…/i.test(document.getElementById("analysisPanel").innerText));
// A real pointer press at the control's centre, as a reader would make it.
async function pointerClick(page, selector) {
  const at = await page.evaluate((s) => {
    const el = document.querySelector(s);
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(120);
}
async function selectSearchResult(page, text) {
  if ((await page.locator("#geoSearchPanel").getAttribute("data-presentation")) === "inline") await page.locator("#geoSearchQuery").click();
  else await page.locator("#geoSearchToggle").click();
  await page.waitForFunction(() => ["ready", "unavailable"].includes(document.querySelector("#geoSearchPanel").dataset.state));
  await page.locator("#geoSearchQuery").fill(text);
  await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
  await page.locator("#geoSearchResults button").first().click();
  await page.waitForFunction(() => !document.querySelector("#geoSearchCard").hasAttribute("hidden"));
}

test("search 'Analyze with Lens' cannot move a Lens during the comparison, by pointer or by script", async () => {
  const { page, context } = await openPage();
  await settled(page);
  await selectSearchResult(page, "APR.02.09");
  // Switch by script: a pointer press elsewhere would dismiss the open search, and the
  // defect needs the selected result to still be there when the comparison starts.
  await page.evaluate(() => document.getElementById("histToggle").click());
  await waitHist(page, "on");
  const before = await analytic(page);
  await pointerClick(page, "#geoSearchAnalyze");
  await page.evaluate(() => document.getElementById("geoSearchAnalyze").click());
  await page.waitForTimeout(200);
  assert.deepEqual(await analytic(page), before, "no Lens moved, no reading recomputed");
  await context.close();
});

test("'Show HATI pilot on the map' cannot move Lens A or switch a layer during the comparison", async () => {
  const { page, context } = await openPage();
  await settled(page);
  await toggleHist(page);
  await waitHist(page, "on");
  const before = await analytic(page);
  await pointerClick(page, "#hatiFrameButton");
  await page.evaluate(() => document.getElementById("hatiFrameButton").click());
  await page.waitForTimeout(200);
  assert.deepEqual(await analytic(page), before);
  await context.close();
});

test("no visible analytical control changes state during the comparison; the keyboard cannot reach them", async () => {
  const { page, context } = await openPage();
  await settled(page);
  const before0 = await analytic(page);
  await toggleHist(page);
  await waitHist(page, "on");
  for (const selector of [
    "#radiusSlider", "#polygonDrawButton", "#resetButton", "#lensBButton",
    '#analysisPanel button[data-mode="COMPARE"]', '#analysisPanel button[data-mode="CITY"]',
    '#layerRail .rail-group[data-rail-group="operational"] label.switch',
    '#layerRail .rail-group[data-rail-group="administrative"] label.switch',
  ]) {
    if (await page.locator(selector).count() === 0) continue;
    await pointerClick(page, selector);
  }
  await page.keyboard.press("/"); // the search shortcut
  assert.notEqual(await page.evaluate(() => document.activeElement.id), "geoSearchQuery");
  assert.deepEqual(await analytic(page), before0, "nothing analytical moved");
  const inert = await page.evaluate(() => ({
    panel: document.getElementById("analysisPanel").inert,
    toolbar: document.getElementById("spatialToolbar").inert,
    search: document.getElementById("geoSearchPanel").inert && document.getElementById("geoSearchToggle").inert,
    groups: [...document.querySelectorAll(".rail-group")].map((g) => [g.dataset.railGroup, g.inert]),
    language: document.getElementById("languageSelect").inert,
    appearance: document.getElementById("appearanceSelect").inert,
    histToggle: document.getElementById("histToggle").inert,
  }));
  assert.equal(inert.panel && inert.toolbar && inert.search, true);
  for (const [name, isInert] of inert.groups) assert.equal(isInert, name !== "map", `rail group ${name}`);
  assert.equal(inert.language || inert.appearance || inert.histToggle, false, "language, appearance and the comparison switch stay usable");
  await context.close();
});

test("contemporary readings that stay visible are labelled as contemporary (EN and ES)", async () => {
  const { page, context } = await openPage();
  await settled(page);
  assert.equal(await page.evaluate(() => document.getElementById("analysisPanel").hasAttribute("data-hist-notice")), false, "no label outside the comparison");
  await toggleHist(page);
  await waitHist(page, "on");
  const label = () => page.evaluate(() => getComputedStyle(document.getElementById("analysisPanel"), "::before").content);
  assert.match(await label(), /Contemporary Lens readings/);
  assert.match(await label(), /do not describe 2006 or 2023/);
  await page.selectOption("#languageSelect", "es");
  await page.waitForFunction(() => /contemporáne/.test(document.getElementById("analysisPanel").dataset.histNotice || ""));
  assert.match(await label(), /No describen 2006 ni 2023/);
  await context.close();
});

test("leaving the comparison restores every action: search, radius, mode, layers", async () => {
  const { page, context } = await openPage();
  await settled(page);
  await selectSearchResult(page, "APR.02.09");
  const start = await analytic(page);
  await page.evaluate(() => document.getElementById("histToggle").click());
  await waitHist(page, "on");
  await page.evaluate(() => document.getElementById("histExit").click());
  const none = await page.evaluate(() => ({
    inert: document.querySelectorAll("[inert]").length,
    label: document.getElementById("analysisPanel").hasAttribute("data-hist-notice"),
  }));
  assert.deepEqual(none, { inert: 0, label: false });
  assert.deepEqual(await analytic(page), start, "state exactly as before");

  await page.locator("#geoSearchAnalyze").click(); // normal behaviour is back
  assert.notDeepEqual((await analytic(page)).a, start.a, "Analyze with Lens moves the Lens again");
  await page.locator("#spatialToolsToggle").click();
  await page.evaluate(() => document.getElementById("radiusSlider").scrollIntoView({ block: "center" }));
  await page.locator("#radiusSlider").fill("1500");
  assert.equal(await page.locator("#radiusSlider").inputValue(), "1500");
  await page.locator('#analysisPanel button[data-mode="COMPARE"]').click();
  assert.equal((await analytic(page)).mode, "COMPARE");
  await context.close();
});
