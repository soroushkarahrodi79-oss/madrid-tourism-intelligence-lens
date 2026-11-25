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

// net.hist[LAYER] = "ok" | "down" | "flaky" (every other tile fails) | "blank" (a white tile, as
// the real service answers outside a coverage) | "halfblank" (every other tile white: a footprint
// edge). Historical tiles carry CORS *, as the service does.
const PNG_WHITE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==", "base64");
async function openPage({ viewport = { width: 1280, height: 800 }, hist = {}, pnoa = "ok" } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const histRequests = [];
  const pnoaRequests = [];
  // Gate 3: net.delay[LAYER] = ms before that layer's tiles are answered (artificial latency);
  // net.held[LAYER] = true parks its requests in net.parked until net.release(LAYER).
  const net = { hist: { PNOA2006: "ok", PNOA2023: "ok", ...hist }, pnoa, flip: 0, delay: {}, held: {}, parked: [], inflight: 0, maxInflight: 0 };
  net.release = (layer) => {
    const go = net.parked.filter((p) => p.layer === layer);
    net.parked = net.parked.filter((p) => p.layer !== layer);
    for (const p of go) p.answer();
  };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/runtime-config.js")) return route.fulfill({ contentType: "text/javascript", body: 'window.RUNTIME_CONFIG={CARTO_BASEMAP_KEY:""};' });
    if (url.hostname === "127.0.0.1") return route.continue();
    if (url.hostname === "www.ign.es") {
      if (url.pathname === "/wms/pnoa-historico") {
        histRequests.push(url);
        const layer = url.searchParams.get("layers");
        const mode = net.hist[layer];
        const fail = mode === "down" || (mode === "flaky" && (net.flip++ % 2 === 0));
        const headers = { "access-control-allow-origin": "*" };
        const answer = () => (fail ? route.fulfill({ status: 503, headers, body: "" }) : route.fulfill({ contentType: "image/png", headers, body: mode === "blank" || (mode === "halfblank" && net.flip++ % 2 === 0) ? PNG_WHITE : PNG_1X1 })).catch(() => {});
        if (!net.delay[layer] && !net.held[layer]) return answer();
        net.inflight += 1;
        net.maxInflight = Math.max(net.maxInflight, net.inflight);
        const done = () => { net.inflight -= 1; return answer(); };
        if (net.held[layer]) { net.parked.push({ layer, answer: done }); return undefined; }
        await new Promise((r) => setTimeout(r, net.delay[layer]));
        return done();
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
// The halo placement note ("hidden: overlapped by a panel" vs "at the map edge") legitimately follows
// panel geometry, and the collapsed panels change that geometry; it is layout, not a reading.
const PANEL_TEXT = `(() => document.getElementById("analysisPanel").textContent.replace(/Some map Halo slots are hidden \([^)]*\)/g, "Some map Halo slots are hidden (layout)"))()`;
const panelText = (page) => page.evaluate(PANEL_TEXT);
const histState = (page) => page.evaluate(() => {
  const el = document.getElementById("histStatus");
  return { state: el.dataset.state, text: el.textContent };
});
const waitHist = (page, state) => page.waitForFunction((s) => document.getElementById("histStatus").dataset.state === s, state);
const waitPnoa = (page, state) => page.waitForFunction((s) => document.getElementById("pnoaStatus").dataset.state === s, state);
const toggleHist = (page) => page.locator("label.switch:has(#histToggle)").click();
// The controller keeps its secondary actions in a menu and the long method text behind an info button.
const openHistMenu = async (page) => { if (await page.locator("#histMenu").isHidden()) await page.locator("#histMenuBtn").click(); };
const histAction = async (page, id) => { await openHistMenu(page); await page.locator(`#${id}`).click(); };
const openHistInfo = async (page) => { if (await page.locator("#histInfo").isHidden()) await page.locator("#histInfoBtn").click(); };
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

test("on: both official layers requested, attribution and notice visible, current view kept", async () => {
  const { page, context, histRequests } = await openPage();
  const before = await page.evaluate(() => ({ ...map.getCenter(), zoom: map.getZoom() }));
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
  const notice = await page.locator("#histNotice").textContent(); // inside the expandable method detail
  assert.match(notice, /annual PNOA mosaics, not single dates/);
  assert.match(notice, /0\.50 m vs 0\.25 m/);
  assert.match(notice, /shadows and orthorectification/);
  assert.match(notice, /does not show what was built or why/);
  assert.match(notice, /hidden and do not describe these years/);
  assert.match(notice, /not that nothing changed/);
  assert.match(notice, /CC BY 4\.0/);
  assert.equal(await page.locator("#histCompareBar").isVisible(), true);
  const c = await page.evaluate(() => ({ ...map.getCenter(), zoom: map.getZoom() }));
  assert.deepEqual(c, before, "entering keeps the chosen centre and zoom; it never jumps to the example");
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

  await page.locator("#histDivider").focus();
  assert.equal(await page.evaluate(() => document.activeElement.id), "histDivider");
  await page.keyboard.press("Home");
  s = await splits(page);
  assert.ok(Math.abs(s.leftEnd) < 1 && Math.abs(s.rightStart) < 1, "Home: all 2023");
  assert.match(await page.locator("#histDivider").getAttribute("aria-valuetext"), /^0% of the map shows 2006, 100% shows 2023$/);
  await page.keyboard.press("End");
  s = await splits(page);
  assert.ok(Math.abs(s.leftEnd - s.width) < 1 && Math.abs(s.rightStart - s.width) < 1, "End: all 2006");
  await page.keyboard.press("Home");
  for (let i = 0; i < 25; i += 1) await page.keyboard.press("ArrowRight");
  s = await splits(page);
  assert.ok(Math.abs(s.leftEnd - s.width * 0.25) < 1, "25 arrow presses = 25%");
  assert.equal(await page.locator("#histDivider").getAttribute("aria-valuenow"), "25");
  assert.equal(await page.evaluate(() => document.getElementById("histDivider").style.left), "25%");
  assert.match(await page.locator("#histDivider").getAttribute("aria-valuetext"), /^25% of the map shows 2006, 75% shows 2023$/);

  await page.evaluate(() => map.panBy([300, 0], { animate: false })); // the split is screen-fixed
  s = await splits(page);
  assert.ok(Math.abs(s.leftEnd - s.width * 0.25) < 1, "split stays at the same screen position after a pan");
  await context.close();
});

test("contemporary panes are hidden, not removed; no click moves a Lens or a selection", async () => {
  const { page, context } = await openPage();
  await page.waitForFunction(() => typeof lenses !== "undefined" && lenses.A.marker
    && !/locating…|loading…/i.test(document.getElementById("analysisPanel").innerText)); // data settled
  const read = () => page.evaluate(() => ({ a: lenses.A.marker.getLatLng(), panel: document.getElementById("analysisPanel").textContent.replace(/Some map Halo slots are hidden \([^)]*\)/g, "Some map Halo slots are hidden (layout)") }));
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
  await openHistInfo(page);
  assert.equal(await page.locator(".hist-summary").isVisible(), true, "the method summary is one click away and states the limit");

  await page.mouse.click(300, 300); // would move the Lens centre outside the mode
  await page.waitForTimeout(150);
  const during = await read();
  assert.deepEqual(during.a, before.a, "a map click under the comparison does not move Lens A");
  assert.equal(during.panel, before.panel, "no reading is recomputed or re-worded");
  await histAction(page, "histExit");
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

  await histAction(page, "histExit");
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
  await histAction(page, "histExit");
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
  await openHistInfo(page);
  assert.equal(await page.locator(".hist-summary").isVisible(), true);
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
  assert.match(await page.locator("#histNotice").textContent(), /no demuestra qué se construyó ni por qué/);
  const box = await page.locator("#histCompareBar").boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 780, "bar fits the phone screen");
  const grip = await page.locator("#histDivider .hist-grip").boundingBox();
  assert.ok(grip.width >= 36 && grip.height >= 36 && grip.x >= 0 && grip.x + grip.width <= 390, "the handle is on screen and finger-sized");
  for (const preset of await page.locator(".hist-preset").all()) assert.ok((await preset.boundingBox()).height >= 44, "presets are touch targets");
  assert.match(await page.locator("#histDivider").getAttribute("aria-valuetext"), /El 50% del mapa muestra 2006/);
  assert.match(await page.locator("#histHint").textContent(), /^Activada\./, "the hint follows the effective state in Spanish");
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
  panel: document.getElementById("analysisPanel").textContent.replace(/Some map Halo slots are hidden \([^)]*\)/g, "Some map Halo slots are hidden (layout)"),
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
    assert.equal(await page.locator(selector).first().isVisible(), false, `${selector} is collapsed out of the way`);
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

test("contemporary surfaces are collapsed (not removed) while comparing, and the brief summary follows the language", async () => {
  const { page, context } = await openPage();
  await settled(page);
  const panelBefore = await panelText(page);
  await toggleHist(page);
  await waitHist(page, "on");
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("analysisPanel")).display), "none");
  await openHistInfo(page);
  assert.match(await page.locator(".hist-summary").innerText(), /not measured change and does not say why/);
  await page.selectOption("#languageSelect", "es");
  await page.waitForFunction(() => /no es un cambio medido/.test(document.querySelector(".hist-summary").textContent));
  await page.selectOption("#languageSelect", "en");
  await page.waitForFunction(() => /not measured change/.test(document.querySelector(".hist-summary").textContent));
  await histAction(page, "histExit");
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.getElementById("analysisPanel")).display), "none");
  assert.equal(await panelText(page), panelBefore, "panel state intact after collapse");
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

// ---- UX-05: direct divider, presets, per-year status, retry, repeated entry --------
const dividerBox = (page) => page.locator("#histDivider .hist-grip").boundingBox();
const frac = (page) => page.evaluate(() => Number(document.getElementById("histDivider").getAttribute("aria-valuenow")));
const view = (page) => page.evaluate(() => ({ ...map.getCenter(), zoom: map.getZoom() }));

test("mouse: dragging the divider on the map moves the split and never pans, draws or moves a Lens", async () => {
  const { page, context } = await openPage();
  await settled(page);
  await toggleHist(page);
  await waitHist(page, "on");
  const before = { view: await view(page), lens: await page.evaluate(() => lenses.A.marker.getLatLng()), panel: await panelText(page) };
  const g = await dividerBox(page);
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 - 180, g.y + g.height / 2 + 40, { steps: 6 });
  assert.equal(await page.evaluate(() => document.getElementById("histDivider").dataset.dragging), "true");
  await page.mouse.up();
  const s = await splits(page);
  assert.ok(Math.abs(s.leftEnd - (s.width / 2 - 180)) < 3, "the split follows the pointer without a jump");
  assert.deepEqual(await view(page), before.view, "dragging the divider did not pan or zoom the map");
  assert.deepEqual(await page.evaluate(() => lenses.A.marker.getLatLng()), before.lens);
  assert.equal(await panelText(page), before.panel);
  // dragging past the edge is clamped
  const g2 = await dividerBox(page);
  await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2);
  await page.mouse.down();
  await page.mouse.move(5000, g2.y, { steps: 3 });
  await page.mouse.up();
  assert.equal(await frac(page), 100);
  // a plain map drag elsewhere still pans (the divider did not break the map)
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(380, 340, { steps: 4 });
  await page.mouse.up();
  assert.notDeepEqual(await view(page), before.view);
  await context.close();
});

test("touch: dragging the divider with a finger moves the split and does not pan the map", async () => {
  const touchContext = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const page = await touchContext.newPage();
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/runtime-config.js")) return route.fulfill({ contentType: "text/javascript", body: 'window.RUNTIME_CONFIG={CARTO_BASEMAP_KEY:""};' });
    if (url.hostname === "127.0.0.1") return route.continue();
    if (route.request().resourceType() === "image" || url.hostname === "www.ign.es") return route.fulfill({ contentType: "image/png", body: PNG_1X1 });
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?lang=en`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#histToggle", { state: "attached" });
  await page.evaluate(() => document.getElementById("histToggle").click());
  await waitHist(page, "on");
  const startView = await view(page);
  const g = await dividerBox(page);
  const cdp = await touchContext.newCDPSession(page);
  const x0 = g.x + g.width / 2;
  const y0 = g.y + g.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 6; i += 1) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + 20 * i, y: y0 + 5 * i }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const f = await frac(page);
  assert.ok(f >= 75 && f <= 85, `finger moved the split to the right (got ${f}%)`);
  assert.deepEqual(await view(page), startView, "a touch drag on the divider does not pan the map");
  await touchContext.close();
});

test("keyboard: arrows, Shift, Page, Home/End; instructions announced; presets mirror the split", async () => {
  const { page, context } = await openPage();
  await toggleHist(page);
  await waitHist(page, "on");
  const divider = page.locator("#histDivider");
  assert.equal(await divider.getAttribute("role"), "slider");
  assert.equal(await divider.getAttribute("tabindex"), "0");
  assert.equal(await divider.getAttribute("aria-describedby"), "histKeys");
  assert.match(await page.locator("#histKeys").innerText(), /arrow keys/);
  await divider.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  assert.equal(await frac(page), 40);
  await page.keyboard.press("PageUp");
  assert.equal(await frac(page), 50);
  await page.keyboard.press("ArrowLeft");
  assert.equal(await frac(page), 49);
  assert.equal(await page.locator('[data-hist-fraction="0.5"]').getAttribute("aria-pressed"), "false");
  await page.locator('[data-hist-fraction="1"]').click();
  assert.equal(await frac(page), 100);
  assert.equal(await page.locator('[data-hist-fraction="1"]').getAttribute("aria-pressed"), "true");
  const full = await splits(page);
  assert.equal(full.leftEnd, full.width, "2006 only");
  await page.locator('[data-hist-fraction="0"]').click();
  assert.equal(await frac(page), 0);
  assert.equal(await page.locator("#histDivider .hist-side-left").isVisible(), false, "a label hides when its side is out of view");
  await page.locator('[data-hist-fraction="0.5"]').click();
  assert.equal(await frac(page), 50);
  assert.equal(await page.locator("#histDivider .hist-side-left b").innerText(), "2006");
  assert.equal(await page.locator("#histDivider .hist-side-right b").innerText(), "2023");
  await context.close();
});

test("per-year status and retry: an unavailable year says so, retries on its own, and a gap is not 'no change'", async () => {
  const { page, context, histRequests, net } = await openPage({ hist: { PNOA2006: "down" } });
  await toggleHist(page);
  await waitHist(page, "error");
  const row = (side) => page.locator(`.hist-years li[data-side="${side}"]`);
  assert.equal(await row("left").getAttribute("data-state"), "error");
  assert.equal(await row("right").getAttribute("data-state"), "ok");
  assert.match(await row("left").innerText(), /2006\s+Unavailable/);
  assert.equal(await row("left").locator(".hist-retry").isVisible(), true);
  assert.equal(await row("right").locator(".hist-retry").isVisible(), false);
  assert.match(await page.locator('#histDivider .hist-side[data-side="left"] small').innerText(), /Unavailable/);
  assert.match((await histState(page)).text, /not evidence of no change/);
  assert.match(await page.locator("#histHint").innerText(), /^On, but at least one year is unavailable/);
  const requests2023 = histRequests.filter((u) => u.searchParams.get("layers") === "PNOA2023").length;
  net.hist.PNOA2006 = "ok"; // the service recovers
  await row("left").locator(".hist-retry").click();
  await waitHist(page, "on");
  assert.equal(await row("left").getAttribute("data-state"), "ok");
  assert.equal(await row("left").locator(".hist-retry").isVisible(), false);
  assert.ok((await tileRects(page)).left.length > 0, "the 2006 side now shows imagery");
  assert.equal(histRequests.filter((u) => u.searchParams.get("layers") === "PNOA2023").length, requests2023, "retry only re-requested the failed year");
  assert.match(await page.locator("#histHint").innerText(), /^On\. Showing 2006 \(left\) and 2023 \(right\)/);
  await context.close();
});

test("the switch hint follows the effective state (never a stale 'Off')", async () => {
  const { page, context } = await openPage();
  assert.match(await page.locator("#histHint").innerText(), /^Off\./);
  await toggleHist(page);
  await waitHist(page, "on");
  assert.doesNotMatch(await page.locator("#histHint").innerText(), /Off\./);
  await histAction(page, "histExit");
  assert.match(await page.locator("#histHint").innerText(), /^Off\./);
  await context.close();
});

test("repeated enter/exit keeps view, selection, radius, appearance and the Lens panel intact", async () => {
  const { page, context } = await openPage();
  await settled(page);
  await selectSearchResult(page, "APR.02.09");
  await page.selectOption("#appearanceSelect", "dark");
  await page.selectOption("#basemapSelect", "dark");
  await page.evaluate(() => map.setView([40.43, -3.68], 15, { animate: false }));
  const start = await analytic(page);
  const startView = await view(page);
  const startUrl = await page.evaluate(() => location.search + location.hash);
  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(() => document.getElementById("histToggle").click());
    await waitHist(page, "on");
    await page.locator('[data-hist-fraction="1"]').click();
    await page.evaluate(() => document.getElementById("histExit").click());
    assert.deepEqual(await view(page), startView, `view restored on exit ${i + 1}`);
    assert.deepEqual(await analytic(page), start, `selection, radius, layers and panel restored on exit ${i + 1}`);
    assert.equal(await page.locator("#appearanceSelect").inputValue(), "dark");
    assert.equal(await page.locator("#basemapSelect").inputValue(), "dark");
    assert.equal(await page.evaluate(() => location.search + location.hash), startUrl);
    assert.equal(await page.evaluate(() => document.querySelectorAll("[inert]").length), 0);
    assert.equal(await page.evaluate(() => document.body.classList.contains("hist-compare-mode")), false);
  }
  await page.evaluate(() => document.getElementById("histToggle").click());
  await waitHist(page, "on");
  assert.equal(await frac(page), 50, "each entry starts at 50/50");
  await context.close();
});

// ---- UX-06 (#199): compare here, guided example, return, share ---------------
const evidenceFingerprint = (page) => page.evaluate(() => ({ state: JSON.parse(JSON.stringify(k11CurrentState())), panel: document.getElementById("analysisPanel").textContent.replace(/Some map Halo slots are hidden \([^)]*\)/g, "x") }));
const EXAMPLE = { lat: 40.3925, lng: -3.699, zoom: 17 };
const near = (v, w) => Math.abs(v.lat - w.lat) < 1e-4 && Math.abs(v.lng - w.lng) < 1e-4 && v.zoom === w.zoom;
const CHOSEN = [40.4435, -3.7106];

test("compare here: keeps the chosen view and requests tiles for it (no jump to Madrid Río)", async () => {
  const { page, context, histRequests } = await openPage();
  await settled(page);
  await page.evaluate((c) => map.setView(c, 16, { animate: false }), CHOSEN);
  const chosen = await view(page);
  await page.locator("#histHere").click();
  await waitHist(page, "on");
  assert.deepEqual(await view(page), chosen);
  assert.ok(histRequests.length > 0);
  // The requested EPSG:3857 bbox is around lon -3.71 (x ~ -413000), not Matadero (x ~ -411800 at lat 40.39).
  const bbox = histRequests[0].searchParams.get("bbox").split(",").map(Number);
  assert.ok(bbox[0] < -412500 && bbox[0] > -414500, `bbox x ${bbox[0]} is at the chosen view`);
  assert.equal(await page.locator("#histHere").isDisabled(), true, "already comparing: nothing left to do here");
  await context.close();
});

test("compare here outside the covered area explains the limit first and moves nothing", async () => {
  const { page, context, histRequests } = await openPage();
  await settled(page);
  await page.evaluate(() => map.setView([41.65, -0.88], 15, { animate: false })); // Zaragoza
  const before = await view(page);
  await page.locator("#histHere").click();
  const note = await page.locator("#histEntryNote").innerText();
  assert.match(note, /outside the Comunidad de Madrid frame/);
  assert.match(note, /Madrid Río \/ Matadero example/);
  assert.deepEqual(await view(page), before);
  assert.equal(await page.evaluate(() => document.getElementById("histToggle").checked), false);
  assert.equal(await page.locator("#histCompareBar").isVisible(), false);
  assert.equal(histRequests.length, 0, "no imagery request for an uncovered view");
  // Too wide to compare: also stated, nothing moves.
  await page.evaluate(() => map.setView([40.4168, -3.7038], 8, { animate: false }));
  await page.locator("#histHere").click();
  assert.match(await page.locator("#histEntryNote").innerText(), /too wide/);
  assert.equal(histRequests.length, 0);
  await context.close();
});

test("guided example and back to my view are explicit and reversible", async () => {
  const { page, context } = await openPage();
  await settled(page);
  await page.evaluate((c) => map.setView(c, 16, { animate: false }), CHOSEN);
  const mine = await view(page);
  await page.locator("#histHere").click();
  await waitHist(page, "on");
  assert.equal(await page.locator("#histBack").isDisabled(), true, "nothing to return to before the example");
  await histAction(page, "histExample");
  assert.ok(near(await view(page), EXAMPLE), "example frames Madrid Río / Matadero");
  assert.equal(await page.locator("#histBack").isDisabled(), false);
  await histAction(page, "histExample"); // repeating never overwrites the remembered view
  await histAction(page, "histBack");
  assert.deepEqual(await view(page), mine, "back to my view restores exactly the view before the example");
  assert.equal(await page.locator("#histBack").isDisabled(), true);
  assert.equal(await page.evaluate(() => document.body.classList.contains("hist-compare-mode")), true, "still comparing");
  // Leaving lands on the original view; the example can also be the way in.
  await histAction(page, "histExit");
  assert.deepEqual(await view(page), mine);
  await page.locator("#histExampleAside").click();
  await waitHist(page, "on");
  assert.ok(near(await view(page), EXAMPLE));
  await histAction(page, "histBack");
  assert.deepEqual(await view(page), mine);
  await histAction(page, "histExit");
  assert.deepEqual(await view(page), mine);
  await context.close();
});

test("share: link carries only centre, zoom, pair and divider; a new page restores the same view", async () => {
  const { page, context } = await openPage();
  await settled(page);
  await page.evaluate((c) => map.setView(c, 16, { animate: false }), CHOSEN);
  await page.locator("#histHere").click();
  await waitHist(page, "on");
  await page.locator('[data-hist-fraction="1"]').click();
  const urlBefore = await page.evaluate(() => location.search);
  await histAction(page, "histCopy");
  await page.waitForFunction(() => document.getElementById("histNote").textContent.length > 0);
  assert.match(await page.locator("#histNote").innerText(), /Link copied|Copy this link/);
  // The link the button builds; the address bar itself is never rewritten.
  const link = await page.evaluate(() => buildHistoricalUrl(window.location.href, histViewState()));
  const query = new URL(link).searchParams;
  assert.deepEqual([...query.keys()], ["hv", "hc", "hz", "hp", "hd"]);
  assert.equal(query.get("hp"), "2006-2023");
  assert.equal(query.get("hz"), "16");
  assert.equal(query.get("hd"), "100");
  assert.equal(await page.evaluate(() => location.search), urlBefore, "address bar untouched");
  await context.close();

  const next = await openPage();
  await next.page.goto(`http://127.0.0.1:${port}/?lang=en&${query.toString()}`, { waitUntil: "domcontentloaded" });
  await next.page.waitForSelector("#histToggle", { state: "attached" });
  await waitHist(next.page, "on");
  const restored = await view(next.page);
  assert.ok(Math.abs(restored.lat - CHOSEN[0]) < 1e-4 && Math.abs(restored.lng - CHOSEN[1]) < 1e-4 && restored.zoom === 16);
  assert.equal(await frac(next.page), 100);
  assert.equal(await next.page.evaluate(() => document.getElementById("histToggle").checked), true);
  assert.equal(await next.page.locator("#k11RestoreNotice").isVisible(), false);
  assert.deepEqual([...new Set(next.histRequests.map((u) => u.searchParams.get("layers")))].sort(), ["PNOA2006", "PNOA2023"]);
  // Leaving the restored view returns to the page's own view and is fully reversible.
  await histAction(next.page, "histExit");
  assert.equal(await next.page.evaluate(() => document.body.classList.contains("hist-compare-mode")), false);
  await next.context.close();
});

test("old evidence links are untouched; invalid historical links say so and never restore a different view", async () => {
  const evidence = "v=1&m=PLACE&a=40.4168,-3.7038,500&be=0&al=A&ly=museum.info.stay.bike.rail&sc=LENS&rd=citizen&lg=en";
  const old = await openPage();
  await old.page.goto(`http://127.0.0.1:${port}/?${evidence}`, { waitUntil: "domcontentloaded" });
  await old.page.waitForSelector("#histToggle", { state: "attached" });
  await settled(old.page);
  assert.equal(await old.page.evaluate(() => histCompare.active), false, "a pre-UX-06 link opens no historical view");
  assert.equal(old.histRequests.length, 0);
  await old.context.close();

  const cases = {
    "hv=1&hc=48.85,2.35&hz=16&hp=2006-2023&hd=50": /centre outside the Comunidad de Madrid frame/,
    "hv=1&hc=40.4435,-3.7106&hz=25&hp=2006-2023&hd=50": /zoom outside 9 to 19/,
    // 2019 is not a verified Madrid coverage (the IGN layer returns no imagery here), so it stays refused.
    "hv=1&hc=40.4435,-3.7106&hz=16&hp=2006-2019&hd=50": /date pair that is not two different verified orthophoto dates/,
    "hv=1&hc=40.4435,-3.7106&hz=16&hp=2006-2023&hd=250": /divider position outside 0 to 100%/,
    "hv=2&hc=40.4435,-3.7106&hz=16&hp=2006-2023&hd=50": /unsupported historical-view format/,
    "hv=1&hc=40.4435,-3.7106&hp=2006-2023&hd=50": /required part of the historical view is missing/,
  };
  for (const [query, expected] of Object.entries(cases)) {
    const t = await openPage();
    await t.page.goto(`http://127.0.0.1:${port}/?lang=en&${query}`, { waitUntil: "domcontentloaded" });
    await t.page.waitForSelector("#histToggle", { state: "attached" });
    await settled(t.page);
    assert.equal(await t.page.evaluate(() => histCompare.active), false, `${query}: nothing restored`);
    assert.equal(t.histRequests.length, 0);
    assert.equal(await t.page.locator("#k11RestoreNotice").isVisible(), true, `${query}: warning shown`);
    const text = await t.page.locator("#k11RestoreNotice").innerText();
    assert.match(text, /Historical view not restored/);
    assert.match(text, expected, query);
    await t.context.close();
  }
});

test("share is only offered for a view that would restore exactly", async () => {
  const { page, context } = await openPage();
  await settled(page);
  await page.locator("#histHere").click();
  await waitHist(page, "on");
  assert.equal(await page.locator("#histCopy").isDisabled(), false);
  await page.evaluate(() => map.setView([41.65, -0.88], 15, { animate: false }));
  assert.equal(await page.locator("#histCopy").isDisabled(), true);
  assert.match(await page.locator("#histNote").innerText(), /cannot be shared/);
  await page.evaluate(() => map.setView([40.4168, -3.7038], 15, { animate: false }));
  assert.equal(await page.locator("#histCopy").isDisabled(), false);
  assert.equal(await page.locator("#histNote").innerText(), "");
  await context.close();
});

test("repeated enter/exit with example, return and divider loses no state; A/B geometries and metrics are untouched", async () => {
  const { page, context } = await openPage();
  await settled(page);
  await selectSearchResult(page, "APR.02.09");
  await page.evaluate(() => map.setView([40.43, -3.68], 15, { animate: false })); // settle the halo layout note, as the sibling test does
  await settled(page);
  const evidence = await evidenceFingerprint(page);
  const start = await analytic(page);
  const mine = await view(page);
  const urlBefore = await page.evaluate(() => location.search + location.hash);
  for (let i = 0; i < 3; i += 1) {
    await page.locator("#histHere").click();
    await waitHist(page, "on");
    await histAction(page, "histExample");
    await page.locator('[data-hist-fraction="0"]').click();
    await histAction(page, "histBack");
    assert.deepEqual((await evidenceFingerprint(page)).state, evidence.state, `evidence state (lenses, A/B geometry, layers, metric) unchanged while comparing ${i + 1}`);
    await histAction(page, "histExit");
    assert.deepEqual(await view(page), mine, `view restored ${i + 1}`);
    assert.deepEqual(await analytic(page), start);
    assert.deepEqual(await evidenceFingerprint(page), evidence);
    assert.equal(await page.evaluate(() => location.search + location.hash), urlBefore);
    assert.equal(await page.evaluate(() => document.querySelectorAll("[inert]").length), 0);
    assert.equal(await page.locator("#histBack").isDisabled(), true);
  }
  await context.close();
});

test("observation guide is descriptive, in both languages, and claims no detection or cause", async () => {
  const { page, context } = await openPage();
  await page.locator("#histHere").click();
  await waitHist(page, "on");
  await openHistInfo(page);
  await page.locator("#histGuide summary").click();
  const en = await page.locator("#histGuide").innerText();
  assert.match(en, /Street layout/);
  assert.match(en, /Open space/);
  assert.match(en, /Visible occupation/);
  assert.match(en, /not an automatic detection/);
  assert.doesNotMatch(en, /built.up area|square metres|caused|because of|increase of|decrease of/i);
  await page.selectOption("#languageSelect", "es");
  const es = await page.locator("#histGuide").innerText();
  assert.match(es, /Trazado/);
  assert.match(es, /Espacios abiertos/);
  assert.match(es, /Ocupación visible/);
  assert.match(es, /no son una detección automática/);
  await context.close();
});

test("phone width: the new actions fit inside the screen and are 44px targets", async () => {
  const { page, context } = await openPage({ viewport: { width: 390, height: 780 } });
  await settled(page);
  await dismissInvite(page);
  await page.evaluate((c) => map.setView(c, 16, { animate: false }), CHOSEN);
  await page.evaluate(() => document.getElementById("histHere").click());
  await waitHist(page, "on");
  await openHistMenu(page);
  for (const id of ["histExample", "histBack", "histCopy", "histExit"]) {
    const box = await page.locator(`#${id}`).boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390, `${id} inside the viewport horizontally`);
    assert.ok(box.height >= 44, `${id} is a 44px target`);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await context.close();
});

// ---- #219 compact floating controller ------------------------------------------------
// The controller is PRESENTATION: moving, minimising, hiding or opening its menu/info must
// never change the comparison (divider, layers, share link) or pan the map.
const histBox = (page) => page.locator("#histCompareBar").boundingBox();
const mapView = (page) => page.evaluate(() => { const c = map.getCenter(); return [c.lat, c.lng, map.getZoom()]; });
const histFraction = (page) => page.evaluate(() => histCompare.fraction);
const histMode = (page) => page.locator("#histCompareBar").getAttribute("data-mode");
const dragHead = async (page, dx, dy) => {
  const b = await page.locator(".hist-handle").boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
};
// The first-visit tutorial invite is a separate, dismissible card that can sit over a phone sheet.
const dismissInvite = (page) => page.evaluate(() => document.getElementById("tutorialInvite")?.remove());
const openCompare = async (page) => { await toggleHist(page); await waitHist(page, "on"); };
const inside = (box, vp) => box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height;
const overlapsAttribution = (page) => page.evaluate(() => {
  const a = document.querySelector(".leaflet-control-attribution").getBoundingClientRect();
  const b = document.getElementById("histCompareBar").getBoundingClientRect();
  return !(b.right <= a.left || b.left >= a.right || b.bottom <= a.top || b.top >= a.bottom);
});

test("#219 the card is compact, has no inner scroll and keeps a permanent reference-only notice", async () => {
  const { page, context } = await openPage({ viewport: { width: 1440, height: 900 } });
  await openCompare(page);
  const box = await histBox(page);
  assert.ok(box.width >= 280 && box.width <= 340, `desktop width is compact (${box.width}px)`);
  assert.ok(box.height <= 140, `expanded card is short (${box.height}px)`);
  assert.equal(await page.evaluate(() => { const el = document.getElementById("histCompareBar"); return el.scrollHeight <= el.clientHeight + 1; }), true, "no inner scroll in the normal state");
  assert.deepEqual(await page.locator(".hist-preset").allInnerTexts(), ["2006", "50/50", "2023"]);
  assert.equal(await page.locator(".hist-refonly").isVisible(), true, "the brief reference-only notice is permanent");
  await context.close();
});

test("#219 dragging the header moves the card, never the map, and stays inside the viewport", async () => {
  const { page, context } = await openPage();
  await openCompare(page);
  const view = await mapView(page);
  const start = await histBox(page);
  await dragHead(page, -120, -200);
  const moved = await histBox(page);
  assert.ok(Math.abs(moved.x - (start.x - 120)) <= 2 && Math.abs(moved.y - (start.y - 200)) <= 2, "the card follows the pointer");
  assert.deepEqual(await mapView(page), view, "the map did not pan while the card was dragged");
  assert.equal(await page.evaluate(() => document.getElementById("histCompareBar").hasAttribute("data-dragging")), false, "the gesture is released");
  await dragHead(page, -5000, -5000);
  const topLeft = await histBox(page);
  assert.ok(topLeft.x >= 0 && topLeft.y >= 60, "cannot leave through the top-left or cover the header");
  await dragHead(page, 5000, 5000);
  assert.ok(inside(await histBox(page), { width: 1280, height: 800 }), "cannot leave through the bottom-right");
  assert.deepEqual(await mapView(page), view);
  // The map still pans normally after the card gesture (pointer capture was released).
  await page.mouse.move(700, 300);
  await page.mouse.down();
  await page.mouse.move(640, 300, { steps: 4 });
  await page.mouse.up();
  assert.notDeepEqual(await mapView(page), view, "map interactions are restored");
  await context.close();
});

test("#219 pressing a header button never starts a drag", async () => {
  const { page, context } = await openPage();
  await openCompare(page);
  const start = await histBox(page);
  const info = await page.locator("#histInfoBtn").boundingBox();
  await page.mouse.move(info.x + info.width / 2, info.y + info.height / 2);
  await page.mouse.down();
  await page.mouse.move(info.x - 150, info.y - 150, { steps: 4 });
  await page.mouse.up();
  const after = await histBox(page);
  assert.equal(after.x, start.x);
  assert.equal(after.y + after.height, start.y + start.height, "the card did not move");
  await context.close();
});

test("#219 the card is re-fitted after a viewport resize and never leaves the screen", async () => {
  const { page, context } = await openPage();
  await openCompare(page);
  await dragHead(page, 5000, 5000);
  await page.setViewportSize({ width: 960, height: 560 });
  await page.waitForTimeout(200);
  assert.ok(inside(await histBox(page), { width: 960, height: 560 }), "re-fitted inside the smaller window");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(200);
  assert.ok(inside(await histBox(page), { width: 1280, height: 800 }));
  await context.close();
});

test("#219 a dragged card never covers the required map attribution", async () => {
  const { page, context } = await openPage();
  await openCompare(page);
  await dragHead(page, -2000, 5000); // toward the attribution corner
  assert.equal(await overlapsAttribution(page), false);
  await context.close();
});

test("#219 minimise/expand and hide/show change presentation only: divider, layers and mode stay", async () => {
  const { page, context } = await openPage();
  await openCompare(page);
  await page.locator("#histDivider").focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("ArrowRight");
  const split = await histFraction(page);
  assert.ok(Math.abs(split - 0.41) < 1e-9, `a custom split (${split})`);
  const rects = await tileRects(page);

  await page.locator("#histCollapse").click();
  assert.equal(await histMode(page), "collapsed");
  assert.equal(await page.locator("#histCollapse").getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator(".hist-presets").isVisible(), false);
  assert.match(await page.locator("#histChip").innerText(), /2006 41\/59 2023/);
  assert.equal(await histFraction(page), split, "minimising does not move the divider");
  assert.equal((await histState(page)).state, "on");

  await page.locator("#histHide").click();
  assert.equal(await histMode(page), "hidden");
  assert.equal(await page.locator("#histShow").isVisible(), true, "a visible control brings the controller back");
  assert.equal(await page.locator("#histExitHidden").isVisible(), true, "leaving the comparison stays one click away");
  assert.equal(await page.evaluate(() => histCompare.active && document.getElementById("histToggle").checked), true, "hiding is not leaving the comparison");
  assert.equal(await histFraction(page), split);
  assert.deepEqual(await tileRects(page), rects, "both mosaics keep showing");
  assert.equal(await page.locator("#histDivider").isVisible(), true);

  await page.locator("#histShow").click();
  assert.equal(await histMode(page), "collapsed", "coming back restores the previous presentation");
  await page.locator("#histCollapse").click();
  assert.equal(await histMode(page), "expanded");
  assert.equal(await histFraction(page), split);
  assert.equal(await page.locator('.hist-preset[aria-pressed="true"]').count(), 0, "no preset is claimed for a custom split");
  await context.close();
});

test("#219 2006 | 50/50 | 2023 drives the same divider state and the labels follow", async () => {
  const { page, context } = await openPage();
  await openCompare(page);
  for (const [fraction, text] of [["1", "2006"], ["0", "2023"], ["0.5", "50/50"]]) {
    await page.locator(`[data-hist-fraction="${fraction}"]`).click();
    assert.equal(await histFraction(page), Number(fraction));
    assert.equal(await page.locator(`[data-hist-fraction="${fraction}"]`).getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator(`[data-hist-fraction="${fraction}"]`).innerText(), text);
  }
  assert.match(await page.locator("#histDivider").getAttribute("aria-valuetext"), /50% of the map shows 2006, 50% shows 2023/);
  await context.close();
});

test("#219 minimised controller keeps its menu: copy link, example and return work; exit is reachable", async () => {
  const { page, context } = await openPage();
  await openCompare(page);
  await page.locator("#histCollapse").click();
  await histAction(page, "histCopy");
  await page.waitForFunction(() => document.getElementById("histNote").textContent.length > 0);
  assert.equal(await page.locator("#histNote").isVisible(), true, "the copy result is visible while minimised");
  assert.equal(await page.locator("#histMenu").isHidden(), true, "the menu closes after an action");
  assert.equal(await page.evaluate(() => document.activeElement.id), "histMenuBtn", "focus returns to the menu button");
  await histAction(page, "histExample");
  assert.equal(await page.evaluate(() => histCompare.returnView !== null), true, "the example keeps its return view");
  await histAction(page, "histBack");
  assert.equal(await page.evaluate(() => histCompare.returnView), null);
  await histAction(page, "histExit");
  assert.equal(await page.locator("#histCompareBar").isHidden(), true);
  assert.equal(await page.evaluate(() => histCompare.active), false);
  await context.close();
});

test("#219 expanded/minimised and the desktop position are remembered; hidden never is", async () => {
  const { page, context } = await openPage();
  await openCompare(page);
  await dragHead(page, -100, -150);
  const placed = await histBox(page);
  await page.locator("#histCollapse").click();
  await histAction(page, "histExit");
  await openCompare(page);
  assert.equal(await histMode(page), "collapsed", "minimised state is remembered");
  const back = await histBox(page);
  assert.ok(Math.abs(back.x - placed.x) <= 2 && Math.abs(back.y + back.height - (placed.y + placed.height)) <= 60, "position is remembered");
  await page.locator("#histHide").click();
  await page.locator("#histExitHidden").click();
  await openCompare(page);
  assert.notEqual(await histMode(page), "hidden", "a hidden controller is never restored hidden");
  assert.equal(await page.locator("#histCompareBar").isVisible(), true);
  await histAction(page, "histResetPos");
  assert.equal(await page.evaluate(() => document.getElementById("histCompareBar").hasAttribute("data-placed")), false, "reset returns to the default place");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("lens.histController.v1")).x), undefined, "the reset is persisted");
  await context.close();
});

test("#219 stored presentation preferences are validated, never trusted", async () => {
  const { page, context } = await openPage();
  await page.evaluate(() => localStorage.setItem("lens.histController.v1", JSON.stringify({ mode: "hidden", x: 99999, y: -99999 })));
  await openCompare(page);
  assert.equal(await histMode(page), "expanded", "a stored hidden/unknown mode is ignored");
  assert.ok(inside(await histBox(page), { width: 1280, height: 800 }), "an absurd stored position is clamped");
  await page.evaluate(() => localStorage.setItem("lens.histController.v1", "{not json"));
  await histAction(page, "histExit");
  await openCompare(page);
  assert.equal(await histMode(page), "expanded");
  await context.close();
});

test("#219 keyboard: info and menu are disclosure buttons, Escape closes them, the divider still works", async () => {
  const { page, context } = await openPage();
  await openCompare(page);
  await page.locator("#histInfoBtn").focus();
  assert.equal(await page.locator("#histInfoBtn").getAttribute("aria-expanded"), "false");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#histInfoBtn").getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator("#histInfo").isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#histInfo").isHidden(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), "histInfoBtn");

  await page.locator("#histMenuBtn").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#histMenuBtn").getAttribute("aria-expanded"), "true");
  assert.equal(await page.evaluate(() => document.activeElement.id), "histExample", "focus moves into the opened menu");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#histMenu").isHidden(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), "histMenuBtn");

  for (const id of ["histInfoBtn", "histMenuBtn", "histCollapse", "histHide"]) {
    const name = await page.locator(`#${id}`).getAttribute("aria-label");
    assert.ok(name && name.length > 3, `${id} has an accessible name`);
  }
  await page.locator("#histCollapse").focus();
  await page.keyboard.press("Space");
  assert.equal(await page.locator("#histCollapse").getAttribute("aria-expanded"), "false");
  await page.keyboard.press("Space");
  assert.equal(await histMode(page), "expanded");

  await page.locator("#histDivider").focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await histFraction(page), 0.51, "the divider keeps its keyboard behaviour");
  await context.close();
});

test("#219 method, limits and attribution stay explicit behind the info button, in both languages", async () => {
  const { page, context } = await openPage();
  await openCompare(page);
  await openHistInfo(page);
  await page.locator("#histMethod summary").click();
  const en = await page.locator("#histInfo").innerText();
  for (const needle of [/not measured change/, /annual PNOA mosaics/, /0\.50 m vs 0\.25 m/, /shadows/, /orthorectification/, /arrow keys/, /IGN PNOA/, /CC BY 4\.0/]) assert.match(en, needle);
  assert.match(await page.locator(".leaflet-control-attribution").first().innerText(), /PNOA 2006[\s\S]*PNOA 2023/, "map attribution stays on the map");
  await page.selectOption("#languageSelect", "es");
  assert.equal(await page.locator("#histBarTitle").innerText(), "Comparador PNOA");
  assert.equal(await page.locator(".hist-refonly").innerText(), "Solo referencia visual");
  const es = await page.locator("#histInfo").innerText();
  for (const needle of [/no es un cambio medido/, /mosaicos anuales/, /ortorrectificación/, /IGN PNOA/, /CC BY 4\.0/]) assert.match(es, needle);
  assert.equal(await page.locator("#histExit").innerText(), "Salir de la comparación");
  await context.close();
});

test("#219 phone: compact bottom sheet, no free drag, 44px targets, exit reachable, no horizontal scroll", async () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    const { page, context } = await openPage({ viewport });
    await settled(page);
    await dismissInvite(page);
    await page.evaluate((c) => map.setView(c, 16, { animate: false }), CHOSEN);
    await page.evaluate(() => document.getElementById("histHere").click());
    await waitHist(page, "on");
    const box = await histBox(page);
    assert.ok(inside(box, viewport), `${viewport.width}x${viewport.height}: sheet fits the screen`);
    assert.ok(box.y + box.height >= viewport.height - 40, "anchored to the bottom");
    assert.ok(box.height <= viewport.height * 0.3, `compact (${box.height}px)`);
    for (const sel of ["#histInfoBtn", "#histMenuBtn", "#histCollapse", "#histHide", ".hist-preset"]) {
      const b = await page.locator(sel).first().boundingBox();
      assert.ok(b.width >= 44 && b.height >= 44, `${sel} is a 44px target`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no horizontal scroll");
    // Free dragging is a desktop gesture: a header drag on a phone layout does nothing.
    const handle = await page.locator(".hist-head-text").boundingBox();
    await page.mouse.move(handle.x + 10, handle.y + 10);
    await page.mouse.down();
    await page.mouse.move(handle.x + 10, handle.y - 150, { steps: 4 });
    await page.mouse.up();
    const same = await histBox(page);
    assert.equal(same.x, box.x);
    assert.equal(same.y, box.y, "no free dragging on a phone");
    await page.locator("#histCollapse").click();
    assert.ok(inside(await histBox(page), viewport));
    await page.locator("#histHide").click();
    assert.ok(inside(await histBox(page), viewport), "the restore pill fits");
    for (const sel of ["#histShow", "#histExitHidden"]) assert.ok((await page.locator(sel).boundingBox()).height >= 44, `${sel} is a 44px target`);
    await page.locator("#histShow").click();
    await histAction(page, "histExit");
    assert.equal(await page.evaluate(() => histCompare.active), false);
    await context.close();
  }
});

test("#219 phone sheet never covers the map attribution, even with the info panel open", async () => {
  const { page, context } = await openPage({ viewport: { width: 360, height: 640 } });
  await settled(page);
  await dismissInvite(page);
  await page.evaluate((c) => map.setView(c, 16, { animate: false }), CHOSEN);
  await page.evaluate(() => document.getElementById("histHere").click());
  await waitHist(page, "on");
  await openHistInfo(page);
  assert.equal(await overlapsAttribution(page), false);
  await context.close();
});

// ---- Urban Time Machine: independent, verified dates per side -------------------------
// Only dates in HIST_COVERAGES (Gate 0, verified to return imagery in Madrid) exist; each side
// chooses one independently; the pair travels in the share link; changing a date drops that
// side's tiles at once and requests only the date the reader stops on.
const layersOf = (requests) => [...new Set(requests.map((u) => u.searchParams.get("layers")))].sort();
const openDates = async (page, side = "left") => {
  if (await page.locator("#histDates").isHidden()) await page.locator(`[data-hist-dates="${side}"]`).click();
};
const labels = (page) => page.evaluate(() => ({
  years: [...document.querySelectorAll(".hist-years .hist-year-name")].map((el) => el.textContent),
  divider: [...document.querySelectorAll("#histDivider .hist-side b")].map((el) => el.textContent),
  presets: [...document.querySelectorAll(".hist-preset")].map((el) => el.textContent),
  aria: document.getElementById("histDivider").getAttribute("aria-label"),
  picks: [document.getElementById("histPickLeft").value, document.getElementById("histPickRight").value],
}));

test("time machine: the year labels open the date pickers, which list only the verified dates", async () => {
  const { page, context } = await openPage();
  await openCompare(page);
  assert.equal(await page.locator("#histDates").isHidden(), true, "the compact card stays compact until asked");
  await page.locator('[data-hist-dates="left"]').click();
  assert.equal(await page.locator("#histDates").isVisible(), true);
  assert.equal(await page.locator('[data-hist-dates="left"]').getAttribute("aria-expanded"), "true");
  assert.equal(await page.evaluate(() => document.activeElement.id), "histPickLeft", "the chosen side's picker takes focus");
  const options = await page.locator("#histPickLeft option").evaluateAll((els) => els.map((o) => o.value));
  assert.deepEqual(options, ["ams1956", "olistat", "sigpac", "2006", "2009", "pnoa10_2009", "2011", "pnoa10_2013", "2014", "pnoa10_2016", "2017", "2020", "2023"]);
  assert.equal(await page.locator('#histPickLeft option[value="2023"]').isDisabled(), true, "the right side's date cannot also be the left");
  assert.equal(await page.locator('#histPickRight option[value="2006"]').isDisabled(), true);
  assert.deepEqual((await labels(page)).picks, ["2006", "2023"]);
  // Escape closes the panel and returns focus to the year label that opened it.
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#histDates").isHidden(), true);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.histDates), "left");
  await context.close();
});

test("time machine: choosing a date requests only that layer and every label, notice and attribution follows", async () => {
  const { page, context, histRequests } = await openPage();
  await openCompare(page);
  const view = await page.evaluate(() => ({ ...map.getCenter(), zoom: map.getZoom() }));
  const before = histRequests.length;
  await openDates(page);
  await page.locator("#histPickLeft").selectOption("ams1956");
  await waitHist(page, "on");
  const fresh = histRequests.slice(before);
  assert.deepEqual(layersOf(fresh), ["AMS_1956-1957"], "only the changed side is requested; the right side is untouched");
  const l = await labels(page);
  assert.deepEqual(l.years, ["1956–57", "2023"]);
  assert.deepEqual(l.divider, ["1956–57", "2023"]);
  assert.deepEqual(l.presets, ["1956–57", "50/50", "2023"]);
  assert.match(l.aria, /1956–57 \(left\) and 2023 \(right\)/);
  assert.match((await histState(page)).text, /1956–57 on the left, 2023 on the right/);
  const attribution = await page.locator("#map .leaflet-control-attribution").innerText();
  assert.match(attribution, /Vuelo Americano, serie B/);
  assert.match(attribution, /vuelo 1956–1957/);
  assert.doesNotMatch(attribution, /PNOA 2006/, "the replaced date is no longer attributed");
  assert.match(await page.locator("#histPairNote").innerText(), /Ground resolution differs \(0\.50 m vs 0\.25 m\)/);
  assert.match(await page.locator("#histPairNote").innerText(), /1956–57 is a flight carried out over 1956–1957/);
  assert.match(await page.locator("#histPairNote").innerText(), /resolution as uncertain/);
  await openHistInfo(page);
  const notice = await page.locator("#histNotice").textContent();
  assert.match(notice, /1956–57 \(left\) and 2023 \(right\) are official orthoimages, not single dates/);
  assert.match(notice, /CC BY 4\.0/);
  const prov = await page.locator("#histProvList").textContent();
  assert.match(prov, /AMS_1956-1957/);
  assert.match(prov, /flight over 1956–1957/);
  assert.match(prov, /PNOA2023/);
  assert.match(prov, /annual mosaic 2023 \(year only; no acquisition day is published\)/);
  assert.deepEqual(await page.evaluate(() => ({ ...map.getCenter(), zoom: map.getZoom() })), view, "a date change never moves the map");
  await context.close();
});

test("time machine: rapid stepping drops each intermediate date and requests only the final one", async () => {
  const { page, context, histRequests } = await openPage();
  await openCompare(page);
  await openDates(page, "right");
  const before = histRequests.length;
  for (let i = 0; i < 5; i += 1) await page.locator('[data-hist-step="-1"][data-side="right"]').click();
  // 2023 -> 2020 -> 2017 -> pnoa10_2016 -> 2014 -> pnoa10_2013
  assert.equal(await page.locator("#histPickRight").inputValue(), "pnoa10_2013");
  await waitHist(page, "on");
  assert.deepEqual(layersOf(histRequests.slice(before)), ["pnoa10_2013"], "intermediate dates are never requested");
  assert.equal(await page.locator(".leaflet-histRight-pane .leaflet-layer").count(), 1, "one layer per side, never a stack");
  assert.deepEqual((await labels(page)).divider, ["2006", "2013 · 10 cm"]);
  assert.match(await page.locator("#histPairNote").innerText(), /covers the Madrid city area only/);
  await context.close();
});

test("time machine: step buttons stop at the ends and skip the other side's date", async () => {
  const { page, context } = await openPage();
  await openCompare(page);
  await openDates(page);
  await page.locator("#histPickLeft").selectOption("olistat");
  await page.locator('[data-hist-step="-1"][data-side="left"]').click();
  assert.equal(await page.locator("#histPickLeft").inputValue(), "ams1956");
  assert.equal(await page.locator('[data-hist-step="-1"][data-side="left"]').isDisabled(), true, "nothing is earlier than the first verified date");
  assert.equal(await page.evaluate(() => document.activeElement.id), "histPickLeft", "focus is not lost when the button disables");
  await page.locator("#histPickRight").selectOption("sigpac");
  await page.locator('[data-hist-step="1"][data-side="left"]').click();
  assert.equal(await page.locator("#histPickLeft").inputValue(), "olistat");
  await page.locator('[data-hist-step="1"][data-side="left"]').click();
  assert.equal(await page.locator("#histPickLeft").inputValue(), "2006", "the right side's date (SIGPAC) is skipped");
  await page.locator("#histPickRight").selectOption("2023");
  await page.locator("#histPickLeft").selectOption("2020");
  assert.equal(await page.locator('[data-hist-step="1"][data-side="left"]').isDisabled(), true, "2023 is taken by the other side, so nothing is later");
  await context.close();
});

test("time machine: a date with no imagery here is named as unavailable, not as no change", async () => {
  const { page, context } = await openPage({ hist: { SIGPAC: "down" } });
  await openCompare(page);
  await openDates(page);
  await page.locator("#histPickLeft").selectOption("sigpac");
  await waitHist(page, "error");
  const text = (await histState(page)).text;
  assert.match(text, /The 1997–2003 \(left\) imagery is unavailable/);
  assert.match(text, /not evidence of no change/);
  assert.match(await page.locator('.hist-years li[data-side="left"]').innerText(), /1997–2003\s+Unavailable/);
  await context.close();
});

test("time machine: the shared link carries the chosen pair and a new page restores exactly that pair", async () => {
  const { page, context } = await openPage();
  await page.evaluate((c) => map.setView(c, 16, { animate: false }), CHOSEN);
  await openCompare(page);
  await openDates(page);
  await page.locator("#histPickLeft").selectOption("ams1956");
  await page.locator("#histPickRight").selectOption("2017");
  await waitHist(page, "on");
  const url = await page.evaluate(() => buildHistoricalUrl(window.location.href, histViewState()));
  assert.equal(new URL(url).searchParams.get("hp"), "ams1956-2017");
  await context.close();
  const next = await openPage();
  await next.page.goto(url.replace(/^http:\/\/127\.0\.0\.1:\d+/, `http://127.0.0.1:${port}`), { waitUntil: "domcontentloaded" });
  await waitHist(next.page, "on");
  assert.deepEqual((await labels(next.page)).picks, ["ams1956", "2017"]);
  assert.deepEqual(layersOf(next.histRequests), ["AMS_1956-1957", "PNOA2017"]);
  await next.context.close();
});

test("time machine: Spanish copy, local number format and a phone-width date panel with 44px targets", async () => {
  const { page, context } = await openPage({ viewport: { width: 390, height: 844 } });
  await dismissInvite(page);
  await page.selectOption("#languageSelect", "es");
  await page.evaluate((c) => map.setView(c, 16, { animate: false }), CHOSEN);
  await page.evaluate(() => document.getElementById("histHere").click());
  await waitHist(page, "on");
  await openDates(page);
  await page.locator("#histPickLeft").selectOption("2009");
  assert.match(await page.locator("#histPairNote").innerText(), /La resolución difiere \(0,50 m frente a 0,25 m\)/);
  assert.match(await page.locator("#histPickLeft option[value='2009']").textContent(), /0,50 m/);
  const panel = await page.locator("#histCompareBar").boundingBox();
  assert.ok(inside(panel, { width: 390, height: 844 }), "the sheet with the date panel open fits the screen");
  for (const sel of ["#histPickLeft", "#histPickRight", '[data-hist-step="-1"][data-side="left"]', '[data-hist-step="1"][data-side="right"]']) {
    const b = await page.locator(sel).boundingBox();
    assert.ok(b && b.height >= 44, `${sel} is a 44px target`);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no horizontal scroll");
  await context.close();
});

test("time machine: a date outside its coverage here (only blank tiles) says 'no imagery here', not 'Showing'", async () => {
  const { page, context } = await openPage({ hist: { pnoa10_2016: "blank" } });
  await openCompare(page);
  await openDates(page);
  await page.locator("#histPickLeft").selectOption("pnoa10_2016");
  await waitHist(page, "error");
  const text = (await histState(page)).text;
  assert.match(text, /2016 · 10 cm \(left\) has no imagery in this view/);
  assert.match(text, /missing imagery, not evidence of no change/);
  const row = page.locator('.hist-years li[data-side="left"]');
  assert.match(await row.innerText(), /No imagery here/);
  assert.equal(await row.locator(".hist-retry").isHidden(), true, "retrying cannot create imagery outside a coverage");
  assert.match(await page.locator("#histHint").innerText(), /has no imagery in this view \(outside its coverage\)/, "the rail hint names a coverage gap, not a load failure");
  assert.match(await page.locator('.hist-years li[data-side="right"]').innerText(), /2023\s+Showing/, "the other side is unaffected");
  await context.close();
});

test("time machine: a footprint edge (some blank tiles) is reported as partly outside the coverage", async () => {
  const { page, context } = await openPage({ hist: { PNOA2006: "halfblank" } });
  await toggleHist(page);
  await waitHist(page, "partial");
  assert.match((await histState(page)).text, /Part of this view is outside the 2006 \(left\) coverage/);
  assert.match(await page.locator('.hist-years li[data-side="left"]').innerText(), /Partly outside/);
  assert.doesNotMatch(await page.locator("#histHint").innerText(), /did not load|retry/, "a coverage edge is not reported as a load failure");
  await context.close();
});

// ---- Gate 2: regional temporal explorer (Comunidad de Madrid) --------------------------
// Orthophoto EXPLORATION reaches the whole Comunidad de Madrid frame (HIST_URL_BOUNDS, the
// official IGN boundary's extent); Lens EVIDENCE keeps its own coverage and envelope.
const NAVALCARNERO = [40.29501, -4.00356]; // IGN CartoCiudad municipality point
const RASCAFRIA = [40.90433, -3.87844];
const lensSnapshot = (page) => page.evaluate(() => ({ a: lenses.A.marker.getLatLng(), b: lenses.B.marker.getLatLng(), search: location.search }));

test("Gate 2: compare here works outside the city (Navalcarnero) and the link is offered", async () => {
  const { page, context, histRequests } = await openPage();
  await settled(page);
  await page.evaluate((c) => map.setView(c, 16, { animate: false }), NAVALCARNERO);
  const chosen = await view(page);
  await page.locator("#histHere").click();
  await waitHist(page, "on");
  assert.deepEqual(await view(page), chosen, "the regional view is kept, not moved to Madrid");
  assert.equal(await page.locator("#histEntryNote").innerText(), "", "no limit note inside the frame");
  const bbox = histRequests[0].searchParams.get("bbox").split(",").map(Number);
  assert.ok(bbox[0] < -444000 && bbox[0] > -447000, `bbox x ${bbox[0]} is at Navalcarnero (lon −4.00)`);
  assert.equal(await page.locator("#histCopy").isDisabled(), false, "a regional view can be shared");
  assert.equal(await page.locator("#histNote").innerText(), "");
  await context.close();
});

test("Gate 2: free regional navigation keeps zoom, divider and dates; a date with no coverage there says so", async () => {
  const { page, context } = await openPage({ hist: { pnoa10_2016: "blank" } });
  await settled(page);
  await openCompare(page);
  await page.locator('[data-hist-fraction="1"]').click();
  await openDates(page);
  await page.locator("#histPickLeft").selectOption("pnoa10_2016");
  await page.evaluate((c) => map.setView(c, 15, { animate: false }), RASCAFRIA);
  await waitHist(page, "error");
  assert.match((await histState(page)).text, /2016 · 10 cm \(left\) has no imagery in this view/);
  assert.match((await histState(page)).text, /missing imagery, not evidence of no change/);
  assert.equal(await frac(page), 100, "divider kept across the move");
  assert.equal(await page.evaluate(() => joinHistoricalPair(histCompare.pair.left, histCompare.pair.right)), "pnoa10_2016-2023");
  assert.equal((await view(page)).zoom, 15);
  assert.equal(await page.locator("#histCopy").isDisabled(), false);
  // Beyond the frame the view is still explorable, but the link is withheld with a stated reason.
  await page.evaluate(() => map.setView([41.65, -0.88], 15, { animate: false }));
  assert.equal(await page.locator("#histCopy").isDisabled(), true);
  assert.match(await page.locator("#histNote").innerText(), /outside the Comunidad de Madrid frame/);
  await context.close();
});

test("Gate 2: a regional link restores exactly; an old Madrid link still restores unchanged", async () => {
  for (const [hc, lat, lng] of [["40.90433,-3.87844", 40.90433, -3.87844], ["40.39250,-3.69900", 40.3925, -3.699]]) {
    const t = await openPage();
    await t.page.goto(`http://127.0.0.1:${port}/?lang=en&hv=1&hc=${hc}&hz=16&hp=ams1956-2023&hd=30`, { waitUntil: "domcontentloaded" });
    await t.page.waitForSelector("#histToggle", { state: "attached" });
    await waitHist(t.page, "on");
    const v = await view(t.page);
    assert.ok(Math.abs(v.lat - lat) < 1e-4 && Math.abs(v.lng - lng) < 1e-4 && v.zoom === 16, hc);
    assert.equal(await frac(t.page), 30);
    assert.equal(await t.page.locator("#k11RestoreNotice").isVisible(), false, `${hc}: no warning`);
    assert.deepEqual([...new Set(t.histRequests.map((u) => u.searchParams.get("layers")))].sort(), ["AMS_1956-1957", "PNOA2023"]);
    await t.context.close();
  }
});

test("Gate 2: 'whole Comunidad' frames the region, is reversible, and moves no Lens", async () => {
  const { page, context } = await openPage();
  await settled(page);
  await page.evaluate((c) => map.setView(c, 16, { animate: false }), CHOSEN);
  const mine = await view(page);
  const lensBefore = await lensSnapshot(page);
  await page.locator("#histHere").click();
  await waitHist(page, "on");
  await histAction(page, "histRegion");
  const framed = await page.evaluate(() => {
    const b = map.getBounds();
    const f = HIST_URL_BOUNDS;
    return { contains: b.contains([[f.minLat, f.minLon], [f.maxLat, f.maxLon]]), zoom: map.getZoom() };
  });
  assert.equal(framed.contains, true, "the whole frame is visible");
  assert.ok(framed.zoom <= 10, `zoom ${framed.zoom} is a regional overview`);
  assert.equal(await page.locator("#histBack").isDisabled(), false);
  await histAction(page, "histBack");
  assert.deepEqual(await view(page), mine, "back to my view restores the exact view");
  assert.deepEqual(await lensSnapshot(page), lensBefore, "no Lens, selection or address moved");
  await context.close();
});

test("Gate 2: exiting from outside the Lens envelope returns to the Lens view and says why; Lens state intact", async () => {
  const { page, context } = await openPage();
  await settled(page);
  const mine = await view(page);
  const lensBefore = await lensSnapshot(page);
  const panelBefore = await panelText(page);
  await openCompare(page);
  await page.evaluate((c) => map.setView(c, 15, { animate: false }), RASCAFRIA); // north of lat 40.9
  await page.mouse.click(400, 400); // a click under regional imagery never reaches a Lens
  await histAction(page, "histExit");
  assert.equal(await page.evaluate(() => histCompare.active), false);
  assert.deepEqual(await view(page), mine, "back at the Lens view");
  const note = await page.locator("#histEntryNote").innerText();
  assert.match(note, /Comparison closed: the map is back at the view you had before comparing/);
  assert.match(note, /do not extend to the regional view/);
  assert.deepEqual(await lensSnapshot(page), lensBefore);
  assert.equal(await panelText(page), panelBefore, "no Lens reading changed");
  // Exiting from inside the Lens envelope adds no note (the earlier behaviour).
  await openCompare(page);
  await histAction(page, "histExit");
  assert.equal(await page.locator("#histEntryNote").innerText(), "");
  await context.close();
});

test("Gate 2: Spanish copy for the regional action, link limit and exit note on a phone", async () => {
  const { page, context } = await openPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${port}/?lang=es`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#histToggle", { state: "attached" });
  await settled(page);
  await dismissInvite(page);
  await page.evaluate(() => document.getElementById("histHere").click()); // the rail is collapsed on a phone
  await waitHist(page, "on");
  await openHistMenu(page);
  const item = page.locator("#histRegion");
  assert.equal((await item.innerText()).trim(), "Ver toda la Comunidad de Madrid");
  const box = await item.boundingBox();
  assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= 390, `44px target inside the screen: ${JSON.stringify(box)}`);
  await page.locator("#histMenuBtn").click();
  await page.evaluate(() => map.setView([41.65, -0.88], 15, { animate: false }));
  assert.match(await page.locator("#histNote").innerText(), /fuera del marco de la Comunidad de Madrid/);
  await page.evaluate((c) => map.setView(c, 15, { animate: false }), RASCAFRIA);
  await histAction(page, "histExit");
  assert.match(await page.locator("#histEntryNote").innerText(), /Comparación cerrada/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no horizontal scroll");
  await context.close();
});

test("Gate 2: a page served from a cached pre-Gate-2 index.html (no regional item) still runs", async () => {
  const { page, context } = await openPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/127\.0\.0\.1:\d+\/(\?.*)?$/, async (route) => {
    const res = await route.fetch();
    const html = (await res.text()).replace(/\s*<button id="histRegion"[^>]*>[^<]*<\/button>/, "");
    await route.fulfill({ response: res, body: html });
  });
  await page.goto(`http://127.0.0.1:${port}/?lang=en&hv=1&hc=40.90433,-3.87844&hz=16&hp=2006-2023&hd=50`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#histToggle", { state: "attached" });
  await waitHist(page, "on");
  assert.equal(await page.locator("#histRegion").count(), 0, "the old HTML really lacks the item");
  await histAction(page, "histExit");
  assert.deepEqual(errors, []);
  await context.close();
});

// ---- Gate 3: load-aware temporal playback -------------------------------------------------
// Stubbed IGN (delays, holds, failures, blank tiles). The display time is shortened through
// histPlay.dwell so the tests run fast; the user-facing options stay 1/2/4/8 s.
const openPlay = async (page, { dwell = 150 } = {}) => {
  await openCompare(page);
  await page.locator("#histPlayBtn").click();
  await page.evaluate((d) => { histPlay.dwell = d; }, dwell);
};
// Samples (every 30 ms) what the right side shows and records any moment at which a label names a
// date that is not the image on screen, a staged frame is visible, or attribution names a staged date.
const startWatch = (page) => page.evaluate(() => {
  window.__watch = { frames: [], bad: [], maxLayers: 0 };
  window.__watchTimer = setInterval(() => {
    const w = window.__watch;
    const vis = histCompare.layers.right;
    w.maxLayers = Math.max(w.maxLayers, document.querySelectorAll(".leaflet-histRight-pane .leaflet-layer").length);
    if (vis) {
      const want = histCoverage(vis.histId).label;
      const tag = document.querySelector('#histDivider .hist-side[data-side="right"] b').textContent;
      if (tag !== want || document.getElementById("histPlayLabel").textContent !== want || histCompare.pair.right !== vis.histId) w.bad.push(`label ${tag} over ${vis.histId}`);
      if (String(vis.options.opacity) !== "1") w.bad.push(`visible layer at opacity ${vis.options.opacity}`);
      const st = histPlay.staged;
      if (st && String(st.options.opacity) !== "0") w.bad.push(`staged ${st.histId} visible`);
      if (st && document.querySelector(".leaflet-control-attribution").textContent.includes(`${histCoverage(st.histId).product} (`)) w.bad.push(`staged ${st.histId} attributed`);
      if (w.frames[w.frames.length - 1] !== vis.histId) w.frames.push(vis.histId);
    }
  }, 30);
});
const stopWatch = (page) => page.evaluate(() => { clearInterval(window.__watchTimer); return window.__watch; });
const playing = (page) => page.evaluate(() => histPlay.playing);
const waitPhase = (page, phase, timeout = 15000) => page.waitForFunction((p) => histPlay.phase === p, phase, { timeout });
const toFirstDate = async (page) => {
  await page.locator("#histPlayRestart").click(); // paused: a manual jump to the first date
  await page.waitForFunction(() => histCompare.pair.right === "ams1956" && histCompare.state.right === "ok");
};

test("Gate 3: the playback panel opens from the controller; Play runs the whole sequence in order, once, and ends", async () => {
  const { page, context } = await openPage();
  await openPlay(page);
  assert.equal(await page.locator("#histPlay").isVisible(), true);
  assert.equal(await page.locator("#histPlayBtn").getAttribute("aria-expanded"), "true");
  assert.match(await page.locator("#histPlayStatus").innerText(), /Steps through 9 official dates on the right side while 2006 stays fixed/);
  await startWatch(page);
  await page.locator("#histPlayToggle").click(); // at 2023 (the last date): starts again from the first
  await waitPhase(page, "ended", 30000);
  const w = await stopWatch(page);
  assert.deepEqual(w.frames, ["2023", "ams1956", "olistat", "sigpac", "2009", "2011", "2014", "2017", "2020", "2023"], "documented order, reference 2006 skipped, no 10 cm frame");
  assert.deepEqual(w.bad, [], "a label never named an image that was not on screen");
  assert.ok(w.maxLayers <= 2, `at most the visible and one staged layer: ${w.maxLayers}`);
  assert.equal(await page.evaluate(() => histCompare.pair.left), "2006", "the reference never moved");
  assert.match(await page.locator("#histPlayStatus").innerText(), /Sequence complete: 2023 is the last date/);
  assert.equal(await page.locator("#histPlayToggle").getAttribute("aria-label"), "Play the dates in order");
  await context.close();
});

test("Gate 3: Pause stops at once (no timer, no staged request); Restart goes back to the first date", async () => {
  const { page, context } = await openPage();
  await openPlay(page, { dwell: 400 });
  await toFirstDate(page);
  await page.locator("#histPlayToggle").click();
  assert.equal(await page.locator("#histPlayToggle").getAttribute("aria-label"), "Pause");
  await page.waitForFunction(() => histCompare.pair.right === "olistat");
  await page.locator("#histPlayToggle").click();
  const after = await page.evaluate(() => ({ playing: histPlay.playing, staged: histPlay.staged, timer: histPlay.timer, layers: document.querySelectorAll(".leaflet-histRight-pane .leaflet-layer").length, id: histCompare.pair.right }));
  assert.deepEqual(after, { playing: false, staged: null, timer: null, layers: 1, id: "olistat" });
  assert.match(await page.locator("#histPlayStatus").innerText(), /Paused on 1997–98/);
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => histCompare.pair.right), "olistat", "nothing advances after Pause");
  // Restart while playing keeps playing from the first date.
  await page.locator("#histPlayToggle").click();
  await page.waitForFunction(() => histCompare.pair.right === "sigpac");
  await page.locator("#histPlayRestart").click();
  await page.waitForFunction(() => histCompare.pair.right === "ams1956");
  assert.equal(await playing(page), true);
  await page.locator("#histPlayToggle").click();
  await context.close();
});

test("Gate 3: high latency — the display time waits for the image, and the old label stays until the new image has loaded", async () => {
  const { page, context, net } = await openPage();
  await openPlay(page, { dwell: 200 });
  await toFirstDate(page);
  net.delay.OLISTAT = 2500;
  await startWatch(page);
  const t0 = Date.now();
  await page.locator("#histPlayToggle").click();
  await waitPhase(page, "advancing");
  await page.waitForTimeout(1200); // well past the 200 ms display time
  const mid = await page.evaluate(() => ({ id: histCompare.pair.right, label: document.getElementById("histPlayLabel").textContent, status: document.getElementById("histPlayStatus").textContent, wait: document.getElementById("histPlayWait").textContent }));
  assert.equal(mid.id, "ams1956", "still on the previous image");
  assert.equal(mid.label, "1956–57", "labelled as what is on screen");
  assert.match(mid.status, /Still showing 1956–57; loading the next date, 1997–98/);
  assert.match(mid.wait, /^\d+ s$/);
  await page.waitForFunction(() => histCompare.pair.right === "olistat", null, { timeout: 10000 });
  assert.ok(Date.now() - t0 >= 2500, "the next date appeared only after its tiles arrived");
  assert.equal(await page.evaluate(() => histCompare.state.right), "ok");
  await page.locator("#histPlayToggle").click();
  const w = await stopWatch(page);
  assert.deepEqual(w.bad, []);
  await context.close();
});

test("Gate 3: a frame reloading after a pan suspends the display time until it has loaded again", async () => {
  const { page, context, net } = await openPage();
  await openPlay(page, { dwell: 600 });
  await toFirstDate(page);
  await page.locator("#histPlayToggle").click();
  await waitPhase(page, "showing");
  net.held["AMS_1956-1957"] = true;
  await page.evaluate(() => map.panBy([900, 0], { animate: false }));
  await waitPhase(page, "waiting");
  await page.waitForTimeout(1200); // twice the display time
  assert.equal(await page.evaluate(() => histCompare.pair.right), "ams1956", "no advance while the frame on screen is reloading");
  net.held["AMS_1956-1957"] = false;
  net.release("AMS_1956-1957");
  await page.waitForFunction(() => histCompare.pair.right === "olistat", null, { timeout: 10000 });
  await page.locator("#histPlayToggle").click();
  await context.close();
});

test("Gate 3: a network error halts on that frame and says so; Play goes on with the next date", async () => {
  const { page, context } = await openPage({ hist: { PNOA2011: "down" } });
  await openPlay(page);
  await toFirstDate(page);
  await page.locator("#histPlayToggle").click();
  await waitPhase(page, "halted", 20000);
  const halted = await page.evaluate(() => ({ id: histCompare.pair.right, state: histCompare.state.right, playing: histPlay.playing, staged: histPlay.staged }));
  assert.deepEqual(halted, { id: "2011", state: "error", playing: false, staged: null }, "labelled 2011, with its failure stated");
  assert.match(await page.locator("#histPlayStatus").innerText(), /Stopped on 2011: some 2011 tiles did not load, so playback did not go on over an incomplete image/);
  assert.equal(await page.locator('.hist-years li[data-side="right"] .hist-retry').isHidden(), false, "the existing retry is offered");
  await page.locator("#histPlayToggle").click();
  await page.waitForFunction(() => histCompare.pair.right === "2014");
  await page.locator("#histPlayToggle").click();
  await context.close();
});

test("Gate 3: a date with no imagery here is shown and named as missing imagery, never as unchanged", async () => {
  const { page, context } = await openPage({ hist: { PNOA2009: "blank" } });
  await openPlay(page, { dwell: 600 });
  await page.evaluate(() => setHistSide("right", "sigpac"));
  await page.waitForFunction(() => histCompare.pair.right === "sigpac" && histCompare.state.right === "ok");
  await page.locator("#histPlayToggle").click();
  await page.waitForFunction(() => histCompare.pair.right === "2009" && histPlay.phase === "showing");
  assert.equal(await page.evaluate(() => histCompare.state.right), "nocover");
  assert.match(await page.locator("#histPlayStatus").innerText(), /2009 has no imagery in this view: that is missing imagery, not unchanged ground/);
  await page.waitForFunction(() => histCompare.pair.right === "2011", null, { timeout: 10000 });
  await page.locator("#histPlayToggle").click();
  await context.close();
});

test("Gate 3: a manual date choice stops playback and cancels the staged request; a late answer changes nothing", async () => {
  const { page, context, net } = await openPage();
  await openPlay(page, { dwell: 100 });
  await toFirstDate(page);
  net.held.OLISTAT = true;
  await page.locator("#histPlayToggle").click();
  await waitPhase(page, "advancing");
  assert.equal(await page.evaluate(() => histPlay.staged && histPlay.staged.histId), "olistat");
  await page.evaluate(() => { const s = document.getElementById("histPickRight"); s.value = "2017"; s.dispatchEvent(new Event("change")); });
  assert.equal(await playing(page), false);
  assert.equal(await page.evaluate(() => histPlay.staged), null, "the staged layer is gone");
  await page.waitForFunction(() => histCompare.pair.right === "2017" && histCompare.state.right === "ok");
  net.held.OLISTAT = false;
  net.release("OLISTAT"); // the obsolete answers arrive late
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => histCompare.pair.right), "2017");
  assert.equal(await page.evaluate(() => document.querySelectorAll(".leaflet-histRight-pane .leaflet-layer").length), 1);
  assert.doesNotMatch(await page.locator("#map .leaflet-control-attribution").innerText(), /OLISTAT/);
  await context.close();
});

test("Gate 3: the left side can be the one that changes while the right stays fixed; the range picks a date", async () => {
  const { page, context } = await openPage();
  await openPlay(page);
  await page.locator('[data-hist-play-side="left"]').click();
  assert.equal(await page.locator('[data-hist-play-side="left"]').getAttribute("aria-pressed"), "true");
  assert.match(await page.locator("#histPlayStatus").innerText(), /on the left side while 2023 stays fixed/);
  const range = page.locator("#histPlayRange");
  assert.equal(await range.getAttribute("max"), "8");
  await range.focus();
  await page.keyboard.press("Home");
  await page.waitForFunction(() => histCompare.pair.left === "ams1956" && histCompare.state.left === "ok");
  assert.match(await range.getAttribute("aria-valuetext"), /^1956–57 · Vuelo Americano/);
  await page.evaluate(() => { window.__rightLayer = histCompare.layers.right; });
  await page.locator("#histPlayToggle").click();
  await page.waitForFunction(() => histCompare.pair.left === "sigpac");
  await page.locator("#histPlayToggle").click();
  assert.equal(await page.evaluate(() => histCompare.pair.right), "2023");
  assert.equal(await page.evaluate(() => histCompare.layers.right === window.__rightLayer), true, "the fixed side's image was never reloaded");
  await context.close();
});

test("Gate 3: closing the panel, minimising, a hidden tab or exiting stops playback; reopening is clean", async () => {
  const { page, context } = await openPage();
  await openPlay(page, { dwell: 300 });
  const stops = [
    () => page.locator("#histPlayBtn").click(),
    () => page.locator("#histCollapse").click(),
    () => page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); delete document.hidden; }),
  ];
  for (const stop of stops) {
    if (await page.locator("#histCompareBar").getAttribute("data-mode") === "collapsed") await page.locator("#histCollapse").click();
    if (await page.locator("#histPlay").isHidden()) await page.locator("#histPlayBtn").click();
    await page.locator("#histPlayToggle").click();
    assert.equal(await playing(page), true);
    await stop();
    assert.deepEqual(await page.evaluate(() => ({ playing: histPlay.playing, staged: histPlay.staged, timer: histPlay.timer })), { playing: false, staged: null, timer: null });
  }
  await page.locator("#histPlayToggle").click();
  assert.equal(await playing(page), true);
  await histAction(page, "histExit");
  assert.deepEqual(await page.evaluate(() => ({ playing: histPlay.playing, staged: histPlay.staged, timer: histPlay.timer, phase: histPlay.phase, layers: document.querySelectorAll(".leaflet-histRight-pane .leaflet-layer, .leaflet-histLeft-pane .leaflet-layer").length })), { playing: false, staged: null, timer: null, phase: "stopped", layers: 0 });
  await openCompare(page);
  assert.equal(await page.locator("#histPlay").isHidden(), true, "the panel starts closed");
  assert.equal(await playing(page), false);
  await context.close();
});

test("Gate 3: playback moves no Lens, selection, panel reading or address", async () => {
  const { page, context } = await openPage();
  await settled(page);
  const lensBefore = await lensSnapshot(page);
  const panelBefore = await panelText(page);
  await openPlay(page);
  await page.locator("#histPlayToggle").click();
  await waitPhase(page, "ended", 30000);
  await histAction(page, "histExit");
  assert.deepEqual(await lensSnapshot(page), lensBefore);
  assert.equal(await panelText(page), panelBefore);
  await context.close();
});

test("Gate 3: the whole-Comunidad view (zoom 9) can be shared and restores exactly; zoom 8 is refused", async () => {
  const { page, context } = await openPage();
  await settled(page);
  await openCompare(page);
  await histAction(page, "histRegion");
  assert.equal(await page.evaluate(() => map.getZoom()), 9, "the region frames at zoom 9 on this desktop viewport");
  assert.equal(await page.locator("#histCopy").isDisabled(), false, "the link is now offered");
  const state = await page.evaluate(() => histViewState());
  const query = await page.evaluate((s) => serializeHistoricalState(s), state);
  assert.match(query, /hz=9/);
  const second = await openPage();
  await second.page.goto(`http://127.0.0.1:${port}/?lang=en&${query}`, { waitUntil: "domcontentloaded" });
  await second.page.waitForFunction(() => typeof histCompare !== "undefined" && histCompare.active);
  const restored = await second.page.evaluate(() => ({ zoom: map.getZoom(), lat: map.getCenter().lat.toFixed(5), lon: map.getCenter().lng.toFixed(5) }));
  assert.deepEqual(restored, { zoom: 9, lat: state.lat.toFixed(5), lon: state.lon.toFixed(5) });
  await second.context.close();
  await page.evaluate(() => map.setZoom(8, { animate: false }));
  assert.equal(await page.locator("#histCopy").isDisabled(), true);
  assert.match(await page.locator("#histNote").innerText(), /zoom must be between 9 and 19/);
  await context.close();
});

test("Gate 3: Spanish copy and a phone-width playback panel with 44px targets and no horizontal scroll", async () => {
  const { page, context } = await openPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://127.0.0.1:${port}/?lang=es`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#histToggle", { state: "attached" });
  await settled(page);
  await dismissInvite(page);
  await page.evaluate(() => document.getElementById("histHere").click());
  await waitHist(page, "on");
  await page.locator("#histPlayBtn").click();
  assert.match(await page.locator("#histPlayStatus").innerText(), /Recorre 9 fechas oficiales en el lado derecho mientras 2006 queda fija/);
  assert.equal(await page.locator("#histPlayToggle").getAttribute("aria-label"), "Reproducir las fechas en orden");
  assert.equal(await page.locator("#histPlayPrev").getAttribute("aria-label"), "Fecha anterior (lado derecho)");
  for (const sel of ["#histPlayRestart", "#histPlayPrev", "#histPlayToggle", "#histPlayNext", '[data-hist-play-dwell="2000"]', '[data-hist-play-side="left"]', "#histPlayBtn"]) {
    await page.locator(sel).scrollIntoViewIfNeeded();
    const box = await page.locator(sel).boundingBox();
    assert.ok(box && box.height >= 44 && box.width >= 44 && box.x >= 0 && box.x + box.width <= 390, `${sel}: ${JSON.stringify(box)}`);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no horizontal scroll");
  await context.close();
});

test("Gate 3: keyboard — open the panel, Space plays and pauses, Escape closes it, pauses and returns focus", async () => {
  const { page, context } = await openPage();
  await openCompare(page);
  await page.locator("#histPlayBtn").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement.id), "histPlayToggle");
  await page.evaluate(() => { histPlay.dwell = 5000; });
  await page.keyboard.press("Space");
  assert.equal(await playing(page), true);
  await page.keyboard.press("Space");
  assert.equal(await playing(page), false);
  await page.keyboard.press("Space");
  assert.equal(await playing(page), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#histPlay").isHidden(), true);
  assert.equal(await playing(page), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), "histPlayBtn");
  await context.close();
});

test("Gate 3: a page served from a cached pre-Gate-3 index.html (no playback panel) still runs", async () => {
  const { page, context } = await openPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/127\.0\.0\.1:\d+\/(\?.*)?$/, async (route) => {
    const res = await route.fetch();
    const html = (await res.text())
      .replace(/\s*<button id="histPlayBtn"[\s\S]*?<\/button>/, "")
      .replace(/\s*<!-- Gate 3: date playback[\s\S]*?<span id="histPlayWait"[^>]*><\/span><\/p>\s*<\/div>/, "");
    await route.fulfill({ response: res, body: html });
  });
  await page.goto(`http://127.0.0.1:${port}/?lang=en&hv=1&hc=40.39250,-3.69900&hz=16&hp=2006-2023&hd=50`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#histToggle", { state: "attached" });
  await waitHist(page, "on");
  assert.equal(await page.locator("#histPlay, #histPlayBtn").count(), 0, "the old HTML really lacks the panel");
  await page.evaluate(() => setHistSide("right", "2020"));
  await page.waitForFunction(() => histCompare.pair.right === "2020" && histCompare.state.right === "ok");
  await histAction(page, "histExit");
  assert.deepEqual(errors, []);
  await context.close();
});
