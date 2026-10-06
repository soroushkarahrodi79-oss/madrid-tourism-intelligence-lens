import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Information architecture V2 (K4, #66) browser contract. Semantic DOM
// assertions only: mode state, Lens preservation, the always-present scope &
// freshness rail at every width, the evidence drawer's dialog behaviour and
// provenance, language consistency and the re-homed surfaces. It uses the same
// query-gated seam discipline as the halo suite (data/runtime_poi.json is a
// gitignored deploy artifact, so nothing here depends on live POI counts).

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "source_registry.json"), "utf8"));
const sourceById = (id) => registry.sources.find((source) => source.id === id);

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = path.resolve(ROOT, relative);
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== path.join(ROOT, "index.html")) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(target, (error, content) => {
    if (error) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    response.end(content);
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });

async function newPage(viewport = { width: 1366, height: 900 }, contextOptions = {}) {
  const context = await browser.newContext({ viewport, ...contextOptions });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return route.abort();
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
  // The registry-backed rail is ready once a reference line has been written.
  await page.waitForFunction(() => /Reference ·|Referencia ·/.test(document.getElementById("scopeRailFreshness").textContent));
  page.context_ = context;
  return page;
}
const closePage = (page) => page.context_.close();

const mode = (page) => page.locator("#analysisPanel").getAttribute("data-mode");
async function setMode(page, name) {
  await page.locator(`.mode-btn[data-mode="${name}"]`).click();
  await page.waitForFunction((expected) => document.getElementById("analysisPanel").dataset.mode === expected, name);
}
const centers = (page) => page.evaluate(() => window.__HALO_REGRESSION__.lensCenters());

// ------------------------------------------------------------------ modes

test("IA 1 PLACE is the initial mode, exposed with aria-pressed/aria-current and a live announcement", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  assert.equal(await mode(page), "PLACE");
  const buttons = await page.locator(".mode-btn").evaluateAll((nodes) => nodes.map((node) => ({
    mode: node.dataset.mode, pressed: node.getAttribute("aria-pressed"), current: node.getAttribute("aria-current"), text: node.textContent.trim(),
  })));
  assert.deepEqual(buttons.map((b) => b.mode), ["PLACE", "COMPARE", "CITY"]);
  assert.deepEqual(buttons.map((b) => b.pressed), ["true", "false", "false"]);
  assert.deepEqual(buttons.map((b) => b.current), ["true", null, null]);
  assert.match(buttons[0].text, /✓|Place/, "the current mode is not colour-only: it carries a name");
  const after = await page.locator(".mode-btn[data-mode=PLACE] .mode-name").evaluate((node) => getComputedStyle(node, "::after").content);
  assert.match(after, /✓/, "a check glyph marks the current mode");
  assert.equal(await page.locator("#modeAnnouncer").getAttribute("aria-live"), "polite");
  // The fictional Explore button and the two fake nav actions are gone.
  assert.equal(await page.getByRole("button", { name: "Explore", exact: true }).count(), 0);
  assert.equal(await page.locator("#navCompare, #navEvidence, header .nav").count(), 0);
});

test("IA 2 mode switching is keyboard-operable and announced", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  await page.locator('.mode-btn[data-mode="CITY"]').focus();
  await page.keyboard.press("Enter");
  assert.equal(await mode(page), "CITY");
  assert.match(await page.locator("#modeAnnouncer").textContent(), /Mode: City/);
  assert.equal(await page.locator('.mode-btn[data-mode="CITY"]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator('.mode-btn[data-mode="PLACE"]').getAttribute("aria-current"), null);
  await page.locator('.mode-btn[data-mode="PLACE"]').focus();
  await page.keyboard.press("Space");
  assert.equal(await mode(page), "PLACE");
  // Exactly one mode section is visible at a time; hidden sections are not tabbable.
  assert.equal(await page.locator("[data-mode-section]:visible").count(), 1);
  const hiddenControls = await page.evaluate(() => [...document.querySelectorAll('[data-mode-section][hidden] button, [data-mode-section][hidden] select, [data-mode-section][hidden] input')]
    .filter((node) => node.offsetParent !== null).length);
  assert.equal(hiddenControls, 0, "no hidden control stays focusable");
});

test("IA 3 PLACE ↔ COMPARE ↔ CITY preserves Lens positions and radii and follows the existing Lens B semantics", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  await page.evaluate(() => { window.__HALO_REGRESSION__.setRadius("A", 1300); window.__HALO_REGRESSION__.moveLens("A", 500, 420); });
  const before = await centers(page);
  assert.equal(await page.locator("#lensBButton").textContent(), "+ Enable Lens B");

  await setMode(page, "COMPARE");
  assert.equal(await page.locator("#lensBButton").textContent(), "Lens B · active", "entering COMPARE uses the existing Lens B activation");
  assert.equal(await page.locator("#compareLine").isVisible(), true);
  assert.equal(await page.locator("#modePlace").isVisible(), false);
  const inCompare = await centers(page);
  assert.deepEqual(inCompare.A, before.A, "Lens A was not reset or moved by entering COMPARE");
  assert.match(await page.locator("#comparisonRadiusReadout").textContent(), /Lens A · 1\.3 km/, "Lens A keeps its independent radius");

  await setMode(page, "CITY");
  assert.equal(await page.locator("#lensBButton").textContent(), "+ Enable Lens B", "leaving COMPARE runs the existing Lens B cleanup");
  assert.equal(await page.locator("#destinationContext").isVisible(), true);
  await setMode(page, "PLACE");
  assert.deepEqual((await centers(page)).A, before.A, "Lens A survives the whole round trip");
  assert.equal(await page.locator("#radiusText").textContent(), "1.3 km", "Lens A keeps its independent radius across the whole round trip");
});

test("IA 4 leaving COMPARE clears the focused halo metric exactly as before", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  await setMode(page, "COMPARE");
  await page.evaluate(() => window.__HALO_REGRESSION__.focusMetric("tourism", "A", true));
  assert.ok(await page.evaluate(() => window.__HALO_REGRESSION__.haloFocusedCount()) > 0);
  await setMode(page, "PLACE");
  assert.equal(await page.evaluate(() => window.__HALO_REGRESSION__.haloFocusedCount()), 0, "no stale locked halo metric survives leaving COMPARE");
});

test("IA 5 the Lens B button enters COMPARE, and moving a Lens never changes the mode", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  await page.locator("#lensBButton").click();
  assert.equal(await mode(page), "COMPARE");
  await page.evaluate(() => window.__HALO_REGRESSION__.moveLens("A", 300, 300));
  assert.equal(await mode(page), "COMPARE");
  await setMode(page, "CITY");
  await page.evaluate(() => window.__HALO_REGRESSION__.moveLens("A", 600, 400));
  assert.equal(await mode(page), "CITY", "dragging a Lens while in CITY does not silently switch mode");
});

test("IA 6 no mode button mutates a layer or the camera", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  const snapshot = () => page.evaluate(() => ({
    layers: [...document.querySelectorAll("[data-layer]")].map((node) => [node.dataset.layer, node.checked]),
    view: window.__HALO_REGRESSION__.lensCenters(),
  }));
  const before = await snapshot();
  for (const name of ["CITY", "COMPARE", "PLACE", "CITY", "PLACE"]) await setMode(page, name);
  assert.deepEqual((await snapshot()).layers, before.layers, "layer switches are untouched by mode changes");
  assert.equal(await page.locator('[data-layer="heat"]').isChecked(), false, "HATI stays off: Evidence is no longer a nav action");
});

test("IA 7 the HATI camera action lives on the HATI layer control", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  assert.equal(await page.locator("aside.left #hatiFrameButton").count(), 1);
  assert.equal(await page.locator('[data-layer="heat"]').isChecked(), false);
  await page.locator("#hatiFrameButton").click();
  assert.equal(await page.locator('[data-layer="heat"]').isChecked(), true, "the layer control enables the layer first");
  assert.equal(await mode(page), "PLACE", "framing the pilot does not change mode");
});

// ------------------------------------------------------------------- rail

const WIDTHS = [360, 420, 560, 850, 1100, 1440];

for (const width of WIDTHS) {
  test(`IA 8 at ${width}px the rail, lead, mode control and evidence route are present and unclipped in every mode`, async (t) => {
    const page = await newPage({ width, height: width < 851 ? 740 : 900 });
    t.after(() => closePage(page));
    for (const name of ["PLACE", "COMPARE", "CITY"]) {
      await setMode(page, name);
      const rail = page.locator("#scopeRail");
      assert.equal(await rail.isVisible(), true, `${name}: rail visible`);
      assert.equal(await page.locator("#modeNav").isVisible(), true, `${name}: mode control visible`);
      assert.ok(await page.locator(".scope-rail-item").count() >= 1, `${name}: at least one scope entry`);
      const geometry = await page.evaluate(() => {
        const railNode = document.getElementById("scopeRail");
        const box = railNode.getBoundingClientRect();
        return { scrollable: railNode.scrollWidth > railNode.clientWidth + 1, left: box.left, right: box.right, viewport: window.innerWidth };
      });
      assert.equal(geometry.scrollable, false, `${name}: the rail needs no horizontal scroll at ${width}px`);
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewport + 0.5, `${name}: the rail fits the viewport`);
      // Each entry is glyph + text, and the glyph is decorative.
      const items = await page.locator(".scope-rail-item").evaluateAll((nodes) => nodes.map((node) => ({
        glyph: node.querySelector(".scope-glyph")?.textContent.trim(), name: node.querySelector(".scope-name")?.textContent.trim(),
        hidden: node.querySelector(".scope-glyph")?.getAttribute("aria-hidden"),
      })));
      for (const item of items) assert.ok(item.glyph && item.name && item.hidden === "true", `${name}: glyph + label`);
      assert.equal(new Set(items.map((i) => i.glyph + i.name)).size >= 1, true);
      const lead = { PLACE: "#areaProfile", COMPARE: "#comparisonBridge", CITY: "#destinationContext" }[name];
      assert.equal(await page.locator(lead).isVisible(), true, `${name}: lead visible at ${width}px`);
      assert.equal(await page.locator(`[data-evidence-mode="${name}"]`).isVisible(), true, `${name}: Evidence & limits route visible`);
      assert.match(await page.locator("#scopeRailFreshness").textContent(), /^Reference · /);
    }
  });
}

test("IA 9 the rail reports the oldest contributing reference date, and 'not published' when a contributor has none", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  // The rail names the barrio once geography resolves (it re-renders with the area profile).
  await page.waitForFunction(() => !/Locating/.test(document.getElementById("areaHeadline").textContent));
  const barrio = (await page.locator("#areaHeadline").textContent()).trim();
  await page.waitForFunction((name) => document.querySelector('.scope-rail-item[data-scope="OFFICIAL_BARRIO"]')?.textContent.includes(name), barrio);
  // PLACE contributors include sources that publish no reference date.
  assert.match(await page.locator("#scopeRailFreshness").textContent(), /Reference · not published/);
  await setMode(page, "CITY");
  const oldest = ["hotel_demand", "domestic_origin_context"].map((id) => sourceById(id).reference_date).sort()[0];
  const text = await page.locator("#scopeRailFreshness").textContent();
  assert.ok(text.includes(`Reference · ${oldest}`), `CITY rail shows the oldest contributing date ${oldest}: ${text}`);
  assert.match(text, /State · /);
  assert.doesNotMatch(text, /today|fresh|stale/i);
  const cityItems = await page.locator(".scope-rail-item .scope-name").allTextContents();
  assert.deepEqual(cityItems, ["Municipality"]);
  await setMode(page, "COMPARE");
  const compareItems = await page.locator(".scope-rail-item").evaluateAll((nodes) => nodes.map((n) => n.textContent.replace(/\s+/g, " ").trim()));
  assert.equal(compareItems.length, 2);
  assert.ok(compareItems[0].includes("A ·") && compareItems[1].includes("B ·"), compareItems.join(" | "));
});

// ----------------------------------------------------------------- drawer

test("IA 10 the evidence drawer opens from the rail by keyboard, shows the full provenance, and Escape returns focus", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  const opener = page.locator(".scope-rail-item").first();
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.locator("#evidenceDrawer");
  assert.equal(await dialog.evaluate((node) => node.open), true);
  assert.equal(await dialog.evaluate((node) => node.tagName), "DIALOG", "native dialog semantics");
  const labelledBy = await dialog.getAttribute("aria-labelledby");
  assert.equal(await page.locator(`#${labelledBy}`).textContent(), "Evidence & limits");
  assert.equal(await page.locator("#evidenceDrawerClose").isVisible(), true, "a visible close control");
  const text = await page.locator("#evidenceDrawerBody").textContent();
  for (const label of ["Authority", "Scope", "Unit", "Reference date", "Publication date", "Retrieval date", "Update frequency", "Source state", "Interpretation ceiling"]) {
    assert.ok(text.includes(label), `drawer shows "${label}"`);
  }
  await page.keyboard.press("Escape");
  assert.equal(await dialog.evaluate((node) => node.open), false, "Escape closes");
  await page.waitForFunction(() => document.activeElement?.className === "scope-rail-item");
  assert.equal(await page.evaluate(() => document.activeElement?.className), "scope-rail-item", "focus returned to a rail control, not <body>");
});

test("IA 11 the drawer carries each contributing source's ceiling VERBATIM, in both readings", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  await page.locator('[data-evidence-mode="PLACE"]').click();
  const body = await page.locator("#evidenceDrawerBody").textContent();
  for (const id of ["population", "museum", "stay", "bike", "rail", "info", "geography"]) {
    const ceiling = sourceById(id).interpretation_ceiling;
    assert.ok(body.replace(/\s+/g, " ").includes(ceiling.replace(/\s+/g, " ")), `${id} ceiling is verbatim in the citizen reading`);
  }
  assert.equal(body.includes("Retrieval route"), false, "the citizen reading omits the retrieval route");
  await page.locator('.reading-btn[data-reading="analyst"]').click();
  assert.equal(await page.locator('.reading-btn[data-reading="analyst"]').getAttribute("aria-pressed"), "true");
  const analyst = await page.locator("#evidenceDrawerBody").textContent();
  assert.ok(analyst.includes("Retrieval route") && analyst.includes("Scope definition"), "the analyst reading adds provenance");
  for (const id of ["population", "museum", "stay"]) {
    assert.ok(analyst.replace(/\s+/g, " ").includes(sourceById(id).interpretation_ceiling.replace(/\s+/g, " ")), `${id} ceiling stays in the analyst reading`);
  }
  // Same records, same states, in the same order.
  const citizenStates = await page.evaluate(() => [...document.querySelectorAll("#evidenceDrawerBody .drawer-source")].map((n) => n.dataset.source));
  await page.locator('.reading-btn[data-reading="citizen"]').click();
  const citizenAgain = await page.evaluate(() => [...document.querySelectorAll("#evidenceDrawerBody .drawer-source")].map((n) => n.dataset.source));
  assert.deepEqual(citizenAgain, citizenStates, "toggling the reading never reorders or drops a source");
  await page.keyboard.press("Escape");
});

test("IA 12 a per-value evidence button opens the drawer and focus returns to that exact button", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  const button = page.locator('.evidence-link[data-evidence-prefix="place.metric."]');
  await button.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#evidenceDrawer").evaluate((n) => n.open), true);
  const surfaces = await page.locator("#evidenceDrawerBody .drawer-record").evaluateAll((nodes) => nodes.map((n) => n.dataset.surface));
  assert.ok(surfaces.length >= 3 && surfaces.every((s) => s.startsWith("place.metric.")), surfaces.join(","));
  assert.ok((await page.locator("#evidenceDrawerBody .drawer-record").evaluateAll((nodes) => nodes.map((n) => n.dataset.scope))).every((s) => s === "LENS_CIRCLE"));
  await page.locator("#evidenceDrawerClose").click();
  assert.equal(await button.evaluate((node) => node === document.activeElement), true, "focus returns to the opener");
});

test("IA 13 the drawer absorbs the halo legend and the sources paragraph, and opens the source notes from the section toggles", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  await setMode(page, "COMPARE");
  await page.locator('[data-evidence-mode="COMPARE"]').click();
  assert.equal(await page.locator("#drawerHaloLegend").isVisible(), true);
  assert.match(await page.locator("#haloLegend").textContent(), /Fixed slots: Tourism POIs at 12/);
  assert.match(await page.locator("#sourcesBody").textContent(), /Ayuntamiento de Madrid/);
  await page.keyboard.press("Escape");
  await setMode(page, "PLACE");
  assert.equal(await page.locator("#haloLegend").isVisible(), false, "the legend is only shown where it applies");
  assert.equal(await page.locator(".halo-legend:visible").count(), 0, "no permanent legend left in the scroll column");
  assert.equal(await page.locator(".panel .source").count(), 0, "the source footer left the panel");
});

test("IA 14 at 360px the drawer is reachable, closable and carries every provenance field", async (t) => {
  const page = await newPage({ width: 360, height: 700 });
  t.after(() => closePage(page));
  await page.locator('[data-evidence-mode="PLACE"]').click();
  const box = await page.locator("#evidenceDrawer").boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 360.5, "the drawer fits a 360px viewport");
  assert.equal(await page.locator("#evidenceDrawerClose").isVisible(), true);
  const text = await page.locator("#evidenceDrawerBody").textContent();
  for (const label of ["Authority", "Reference date", "Publication date", "Retrieval date", "Update frequency", "Source state", "Interpretation ceiling", "Unit", "Scope"]) {
    assert.ok(text.includes(label), label);
  }
  await page.locator("#evidenceDrawerClose").click();
  assert.equal(await page.locator("#evidenceDrawer").evaluate((n) => n.open), false);
});

test("IA 15 touch targets are at least 44px on coarse pointers", async (t) => {
  const page = await newPage({ width: 390, height: 780 }, { hasTouch: true, isMobile: true });
  t.after(() => closePage(page));
  const small = await page.evaluate(() => {
    const selectors = [".mode-btn", ".scope-rail-item", "#scopeRailFreshness", ".evidence-link", ".evidence-route", "#placeDetail > summary", "#hatiFrameButton"];
    return selectors.flatMap((selector) => [...document.querySelectorAll(selector)])
      .filter((node) => node.offsetParent !== null)
      .map((node) => ({ selector: node.className || node.id, h: node.getBoundingClientRect().height, w: node.getBoundingClientRect().width }))
      .filter((box) => box.h < 43.5 || box.w < 43.5);
  });
  assert.equal(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), true);
  assert.deepEqual(small, [], "every interactive K4 control is ≥44px");
  await page.locator(".evidence-route").first().click();
  const close = await page.locator("#evidenceDrawerClose").boundingBox();
  assert.ok(close.height >= 43.5, "the drawer close control is ≥44px tall");
});

// -------------------------------------------------------------- structure

test("IA 16 supporting figures, Detail, Evidence route and controls follow the reading order", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  assert.ok(await page.locator("#modePlace .metrics .metric:visible").count() <= 4);
  assert.equal(await page.locator("#placeDetail").evaluate((n) => n.open), false, "Detail is closed by default");
  assert.equal(await page.locator("#placeDetail .mix").isVisible(), false, "Category mix is inside the closed Detail");
  await page.locator("#placeDetail > summary").click();
  assert.equal(await page.locator("#placeDetail .mix").isVisible(), true, "…and reachable at every width");
  assert.equal(await page.locator("#placeDetail #nearestList").count(), 1);
  // No control between results: every control id lives in the controls region or the aside.
  const stray = await page.evaluate(() => ["radiusSlider", "timeSelect", "resetButton", "lensAButton", "lensBButton", "haloToggle", "domesticOriginsMonth"]
    .filter((id) => !document.getElementById(id).closest("#panelControls")));
  assert.deepEqual(stray, []);
  assert.equal(await page.locator("[data-mode-section] #hospitalityMetricSelect, [data-mode-section] #hospitalityScale").count(), 0);
  assert.equal(await page.locator("aside.left #hospitalityMetricSelect").count(), 1, "the hospitality selector moved to its layer");
  const order = await page.evaluate(() => [...document.getElementById("analysisPanel").children].map((n) => n.id || n.className));
  assert.ok(order.indexOf("panelControls") === order.length - 1, `controls are last: ${order.join(" > ")}`);
  await setMode(page, "COMPARE");
  assert.ok(await page.locator("#decisionInsightItems > li").count() <= 4, "Insight shows at most four figures");
  assert.equal(await page.locator("#compareDetail").evaluate((n) => n.open), false);
  assert.equal(await page.locator("#compareDetail #spatialSensitivity").count(), 1);
  assert.equal(await page.locator("#compareDetail .comparetable").count(), 1);
  await setMode(page, "CITY");
  assert.equal(await page.locator("#domesticOrigins").isVisible(), true, "Domestic Origins / Monthly Dynamics are CITY surfaces");
  assert.equal(await page.locator("#cityControls #domesticOriginsMonth").count(), 1);
  assert.equal(await page.locator("#modePlace #domesticOrigins, #compareLine #domesticOrigins").count(), 0);
});

test("IA 17 COMPARE surfaces — Bridge, Insight, Sensitivity — survive the relocation", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  await setMode(page, "COMPARE");
  assert.equal(await page.locator("#comparisonBridge").isVisible(), true);
  await page.evaluate(() => window.__HALO_REGRESSION__.focusMetric("stays", "A", true));
  assert.ok((await page.locator("#cbMetricName").textContent()).length > 0, "the Bridge still mirrors the focused metric");
  assert.ok(await page.locator("#decisionInsightItems > li").count() > 0, "Insight still renders from the authoritative state");
  await page.locator("#compareDetail > summary").click();
  await page.locator("#spatialSensitivityCapture").click();
  assert.equal(await page.locator("#spatialSensitivityWindows").isVisible(), true, "Sensitivity still captures a baseline");
  assert.equal(await page.locator("#compareAreaHost #areaProfile").count(), 1, "each lens's barrio stays reachable in COMPARE Detail");
});

test("IA 18 no breakpoint deletes provenance-bearing content", async (t) => {
  for (const width of [360, 560, 850]) {
    const page = await newPage({ width, height: 740 });
    t.after(() => closePage(page));
    await page.locator('[data-layer="pedestrian"]').evaluate((node) => { node.checked = true; node.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.locator('[data-layer="heat"]').evaluate((node) => { node.checked = true; node.dispatchEvent(new Event("change", { bubbles: true })); });
    assert.equal(await page.locator("#placeDetail").evaluate((n) => n.open), true, "switching a layer on opens the Detail that holds its reading");
    for (const selector of [".metric-foot", ".activity-card-note", ".evidence-note", ".mix", "#scopeRailFreshness", ".evidence-route"]) {
      const display = await page.locator(selector).first().evaluate((node) => getComputedStyle(node).display);
      assert.notEqual(display, "none", `${selector} is not display:none at ${width}px`);
    }
    await page.context_.close();
  }
});

// --------------------------------------------------------------- language

test("IA 19 one document language: the switch re-labels the shell, drawer, rail and every dictionary-backed surface", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
  assert.deepEqual(await page.locator(".mode-name").allTextContents(), ["Place", "Compare", "City"]);

  await page.locator("#languageSelect").selectOption("es");
  assert.equal(await page.evaluate(() => document.documentElement.lang), "es");
  assert.deepEqual(await page.locator(".mode-name").allTextContents(), ["Lugar", "Comparar", "Ciudad"]);
  assert.match(await page.locator("#modeQuestion").textContent(), /¿Qué dice la evidencia/);
  assert.match(await page.locator("#scopeRailFreshness").textContent(), /^Referencia · no publicada · Estado · /);
  assert.equal(await page.locator("#placeDetail > summary").textContent(), "Detalle");
  assert.match(await page.locator("#hatiFrameButton").textContent(), /Mostrar el piloto HATI/);
  assert.equal(await page.locator(".left h3").first().textContent(), "Visualización del mapa");
  // Hospitality surfaces follow the SAME language, with no separate selector.
  // Dictionary-backed modules load asynchronously: poll for the language, never race it.
  await page.waitForFunction(() => /Contexto de hostelería/.test(document.getElementById("hospitalityLayerName").textContent));
  await setMode(page, "CITY");
  await page.waitForFunction(() => /Orígenes nacionales/.test(document.getElementById("domesticOriginsHeading").textContent));
  await page.locator('[data-evidence-mode="CITY"]').click();
  const drawerEs = await page.locator("#evidenceDrawer").textContent();
  for (const label of ["Autoridad", "Fecha de referencia", "Fecha de publicación", "Fecha de obtención", "Frecuencia de actualización", "Estado de la fuente", "Límite de interpretación"]) {
    assert.ok(drawerEs.includes(label), label);
  }
  // The publisher's ceiling is NOT translated or paraphrased.
  assert.ok(drawerEs.replace(/\s+/g, " ").includes(sourceById("hotel_demand").interpretation_ceiling.replace(/\s+/g, " ")));
  await page.keyboard.press("Escape");
  // Bridge/Insight follow the document language too.
  await setMode(page, "COMPARE");
  await page.waitForFunction(() => /Enfoca una métrica/.test(document.getElementById("comparisonBridgeEmpty").textContent));

  await page.locator("#languageSelect").selectOption("en");
  assert.deepEqual(await page.locator(".mode-name").allTextContents(), ["Place", "Compare", "City"]);
  await page.waitForFunction(() => /Focus a halo metric/.test(document.getElementById("comparisonBridgeEmpty").textContent));
  await page.waitForFunction(() => /Hospitality/i.test(document.getElementById("hospitalityLayerName").textContent));
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

// ------------------------------------------- language policy: product copy

// Visible product-authored copy under a root: text nodes and accessibility
// attributes of visible elements, excluding verbatim source/registry content
// (data-verbatim / lang="en" provenance), map internals and SVG numerals.
async function productCopy(page, rootSelector) {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const out = [];
    const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === 3) {
        const parent = node.parentElement;
        if (!node.nodeValue.trim() || !visible(parent) || parent.closest("script,style,[data-verbatim],[lang=en],.leaflet-pane,svg")) continue;
        out.push(node.nodeValue.replace(/\s+/g, " ").trim());
      } else if (visible(node) && !node.closest("[data-verbatim],[lang=en],svg")) {
        for (const name of ["aria-label", "title", "aria-description"]) if (node.hasAttribute(name)) out.push(node.getAttribute(name));
      }
    }
    return out;
  }, rootSelector);
}

// PRODUCT-AUTHORED legacy English that must be gone when ES is selected. This is
// an explicit list, not an "English words" heuristic: proper nouns, source names,
// BiciMAD / HATI / Metro and verbatim source wording are legitimately unchanged.
const FORBIDDEN_ENGLISH = [
  "Locating", "Registered residents", "Administrative area", "Within the Lens", "Category mix", "Nearest in active lens",
  "within lens", "deployment snapshot", "Reset active lens", "Enable Lens B", "Lens A radius", "Pedestrian flow", "Map display",
  "Operational layers", "Observed activity", "Research evidence", "Source & interpretation", "Whole official barrio",
  "circle measurements only", "Equal windows", "Destination context", "overnight stays", "travellers", "Decision Insight",
  "Spatial sensitivity", "Baseline window", "Capture current", "Evidence & limits", "Comparison halo", "Show HATI pilot",
  "Unavailable", "No data", "Hotels & stays", "Tourism POIs", "Mobility nodes", "Mean UTCI", "Official register", "Licensed VUT",
  "Whole municipality", "Official statistics", "Controls", "Source month", "Domestic origins", "Monthly origin dynamics",
  "Origin municipality", "Metric", "Reference date", "Nearest", "Base map", "Administrative boundaries", "Accommodation category",
  "All accommodation", "Reading the", "Lens A", "Lens B", "records", "samples", "Madrid municipality — not the Lens circle",
];
const SPANISH_MARKERS = ["Lente A", "Dentro de la Lente", "Mezcla de categorías", "Residentes empadronados", "Visualización del mapa", "Controles", "Evidencia y límites"];
const escapePhrase = (phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasPhrase = (lines, phrase) => lines.some((line) => new RegExp(`(^|[^\\p{L}])${escapePhrase(phrase)}([^\\p{L}]|$)`, "u").test(line));
function assertNoEnglish(lines, surface) {
  const found = FORBIDDEN_ENGLISH.filter((phrase) => hasPhrase(lines, phrase));
  assert.deepEqual(found, [], `${surface}: product-authored English left in ES: ${found.join(" | ")}\n${lines.filter((l) => found.some((f) => l.includes(f))).slice(0, 14).map((l) => l.slice(0, 170)).join("\n")}`);
}

test("IA 20 ES: representative real surfaces in PLACE, COMPARE and CITY carry no product-authored English", async (t) => {
  const page = await newPage({ width: 1366, height: 900 });
  t.after(() => closePage(page));
  await page.locator("#languageSelect").selectOption("es");
  await page.waitForFunction(() => /Orígenes nacionales/.test(document.getElementById("domesticOriginsHeading").textContent));
  // Everything on: the layers whose copy only renders when enabled.
  for (const layer of ["pedestrian", "hospitality", "heat", "park"]) {
    await page.locator(`[data-layer="${layer}"]`).evaluate((node) => { node.checked = true; node.dispatchEvent(new Event("change", { bubbles: true })); });
  }
  await page.waitForFunction(() => !/Locating|Localizando/.test(document.getElementById("areaHeadline").textContent));
  await page.locator("#placeDetail > summary").click();
  await page.waitForTimeout(400);

  // ---- PLACE
  assert.equal(await page.locator("html").getAttribute("lang"), "es");
  assert.match(await page.locator("#areaScopeNote").textContent(), /Barrio oficial completo, no el círculo de la Lente\./);
  assert.match(await page.locator(".area-value-label").textContent(), /Residentes empadronados/);
  assert.match(await page.locator("#areaScopeHint").textContent(), /barrio oficial/);
  const feet = await page.locator("#tourismFoot, #stayFoot, #mobilityFoot, #heatFoot").allTextContents();
  assert.equal(feet.length, 4);
  for (const foot of feet) assert.doesNotMatch(foot, /within lens|deployment snapshot|enable HATI|sample|in lens|not exhaustive/, `metric foot still English: ${foot}`);
  assert.ok(feet.some((foot) => /dentro de la Lente|instantánea|muestra|BiciMAD/.test(foot)), feet.join(" | "));
  assert.match(await page.locator("#pedestrianCard").textContent(), /Flujo peatonal/);
  assert.match(await page.locator(".activity-card-note").textContent(), /peatones observados, no turistas/);
  assert.match(await page.locator("#placeDetail .mix .card-title").first().textContent(), /Mezcla de categorías/);
  assert.equal(await page.locator("#resetButton").textContent(), "Restablecer la Lente activa");
  assert.equal(await page.locator("#lensBButton").textContent(), "+ Activar Lente B");
  assert.equal(await page.locator("#radiusControlLabel").textContent(), "Radio de la Lente A");
  assert.equal(await page.locator("#radiusSlider").getAttribute("aria-label"), "Radio de la Lente A");
  assert.equal(await page.locator("#timeSelect").getAttribute("aria-label"), "Hora del modelo HATI");
  assert.match(await page.locator("#layerSourceNote").textContent(), /Museos:/);
  assert.equal(await page.locator(".left h3").first().textContent(), "Visualización del mapa");
  assert.match(await page.locator("#stayKindFilter option").first().textContent(), /Todo el alojamiento/, "select option copy is localised");
  for (const selector of ["header", ".left", "#analysisPanel"]) assertNoEnglish(await productCopy(page, selector), `PLACE ${selector}`);

  // ---- COMPARE
  await setMode(page, "COMPARE");
  await page.evaluate(() => window.__HALO_REGRESSION__.focusMetric("stays", "A", true));
  await page.locator("#compareDetail > summary").click();
  await page.locator("#spatialSensitivityCapture").click();
  await page.waitForTimeout(400);
  assert.match(await page.locator("#decisionInsightHeading").textContent(), /Lectura de decisión/);
  assert.match(await page.locator("#spatialSensitivityHeading").textContent(), /Sensibilidad espacial/);
  assert.match(await page.locator("#comparisonRadiusReadout").textContent(), /Lente A · .* \| Lente B · /);
  assert.match(await page.locator("#comparisonModeCue").textContent(), /Ventanas/);
  assert.equal(await page.locator(".comparetable").getAttribute("aria-label"), "Mediciones de los círculos de la Lente A y la Lente B");
  assert.equal(await page.locator(".comparetable thead th").first().textContent(), "Métrica");
  assert.match(await page.locator(".halo-toggle").textContent(), /Halo de comparación/);
  assert.match(await page.locator("#comparisonHaloSummary").textContent(), /Halo de comparación\./, "the screen-reader comparison summary is Spanish too");
  assert.match(await page.locator("#modeAnnouncer").textContent(), /Modo: Comparar/);
  for (const selector of ["#analysisPanel", ".left"]) assertNoEnglish(await productCopy(page, selector), `COMPARE ${selector}`);

  // ---- CITY
  await setMode(page, "CITY");
  assert.match(await page.locator("#destinationContext .section-head span").first().textContent(), /Contexto del destino/);
  assert.match(await page.locator("#destinationScopeHint").textContent(), /municipio completo/);
  assert.match(await page.locator(".destination-metric-exact").first().textContent(), /viajeros|pernoctaciones/);
  assert.match(await page.locator("#destinationCeiling").textContent(), /Solo establecimientos hoteleros/);
  assert.match(await page.locator("#domesticOriginsHeading").textContent(), /Orígenes nacionales/);
  assert.match(await page.locator("#domesticOriginDynamicsHeading").textContent(), /din[aá]mica/i);
  assert.match(await page.locator("#domesticOriginsMonthLabel").textContent(), /Mes de referencia/);
  assert.equal(await page.locator("#destinationContext").getAttribute("aria-label"), "Contexto del destino: demanda hotelera de la ciudad de Madrid");
  assert.match(await page.locator("#destinationPeriod").textContent(), /de \d{4}$/, "the period month is Spanish");
  for (const selector of ["#analysisPanel", ".left"]) assertNoEnglish(await productCopy(page, selector), `CITY ${selector}`);

  // ---- drawer (our labels localise; registry wording is verbatim and marked)
  await page.locator('[data-evidence-mode="CITY"]').click();
  assertNoEnglish(await productCopy(page, "#evidenceDrawer"), "CITY drawer");
  const ceiling = page.locator("#evidenceDrawerBody .drawer-ceiling [lang=en]").first();
  assert.equal(await ceiling.getAttribute("lang"), "en", "verbatim registry ceilings are annotated with their real language");
  assert.ok((await ceiling.textContent()).includes(sourceById("hotel_demand").interpretation_ceiling.slice(0, 40)));
  await page.keyboard.press("Escape");

  // ---- EN regression, same page: nothing is one-way
  await page.locator("#languageSelect").selectOption("en");
  await page.waitForFunction(() => /Domestic origins/.test(document.getElementById("domesticOriginsHeading").textContent));
  await setMode(page, "PLACE");
  const english = [...(await productCopy(page, "#analysisPanel")), ...(await productCopy(page, ".left")), ...(await productCopy(page, "header"))];
  const stray = SPANISH_MARKERS.filter((phrase) => hasPhrase(english, phrase));
  assert.deepEqual(stray, [], `Spanish left after switching back to EN: ${stray.join(" | ")}`);
  assert.equal(await page.locator("#resetButton").textContent(), "Reset active lens");
  assert.equal(await page.locator("#lensBButton").textContent(), "+ Enable Lens B");
  assert.match(await page.locator("#areaScopeNote").textContent(), /Whole official barrio — not the Lens circle\./);
  assert.equal(await page.locator(".left h3").first().textContent(), "Map display");
  assert.equal(await page.locator("#radiusSlider").getAttribute("aria-label"), "Lens A radius");
  assert.match(await page.locator("#tourismFoot").textContent(), /within lens|deployment snapshot|sample/);
  assert.equal(await page.locator("#timeSelect").getAttribute("aria-label"), "HATI model time");
  await setMode(page, "CITY");
  assert.match(await page.locator("#destinationCeiling").textContent(), /Hotel establishments only/);
  assert.match(await page.locator("#destinationPeriod").textContent(), /^[A-Z][a-z]+ \d{4}$/);
});

test("IA 21 verbatim provenance keeps its own language and says so; sentences we author are translated", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  await page.waitForFunction(() => document.querySelectorAll("#areaSourceDetails [data-provenance-line]").length > 0);
  await page.locator("#languageSelect").selectOption("es");
  await page.waitForFunction(() => document.querySelector("#areaSourceDetails [data-provenance-line][lang=en]"));
  const lines = await page.locator("#areaSourceDetails [data-provenance-line]").evaluateAll((nodes) => nodes.map((n) => ({ text: n.textContent, lang: n.getAttribute("lang") })));
  const caveat = lines.find((line) => /Granted licences only/.test(line.text));
  assert.ok(caveat && caveat.lang === "en", "the canonical licence caveat stays verbatim and is annotated lang=en");
  const authored = lines.filter((line) => /^(Fecha de referencia|Estado de la fuente|Geografía de barrio)/.test(line.text));
  assert.ok(authored.length >= 1 && authored.every((line) => line.lang === null), "project-authored provenance sentences are Spanish and carry no English tag");
  await page.locator("#languageSelect").selectOption("en");
  await page.waitForFunction(() => !document.querySelector("#areaSourceDetails [lang]"));
  assert.match(await page.locator("#areaSourceDetails").textContent(), /Reference date/);
});
