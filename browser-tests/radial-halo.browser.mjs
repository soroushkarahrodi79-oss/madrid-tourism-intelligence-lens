import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

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

async function openPage(viewport = { width: 1366, height: 1024 }) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(5000);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return route.abort();
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
  await page.locator("#lensBButton").click();
  await page.waitForFunction(() => document.querySelectorAll(".comparison-halo-icon").length > 0);
  await page.evaluate(() => {
    const api = window.__HALO_REGRESSION__;
    api.setZoom(13);
    api.setCenterAtPoint("A", 500, 430);
    api.setCenterAtPoint("B", 1200, 430);
  });
  await page.locator("#lensAButton").click();
  return page;
}

async function visibleHaloSlots(page, lens) {
  const slots = ["north", "east", "south", "west"];
  return Promise.all(slots.map(async (slot) => {
    const icon = page.locator(`.halo-glyph.halo-${lens.toLowerCase()}.halo-slot-${slot}`).locator("xpath=..");
    const present = await icon.count() > 0;
    return { slot, visible: present, display: present ? await icon.evaluate((node) => getComputedStyle(node).display) : "none" };
  }));
}

async function glyph(page, lens, slot) {
  return page.locator(`.halo-glyph.halo-${lens.toLowerCase()}.halo-slot-${slot}`);
}

async function textPoint(glyphLocator) {
  return glyphLocator.evaluate((svg) => {
    const box = svg.querySelector(".halo-label").getBBox();
    const rect = svg.getBoundingClientRect();
    return { x: rect.left + box.x + box.width / 2, y: rect.top + box.y + box.height / 2 };
  });
}

async function renderedAnchor(glyphLocator, slot) {
  const iconAnchors = { north: [68, 52], east: [6, 28], south: [68, 4], west: [130, 28] };
  const [iconX, iconY] = iconAnchors[slot];
  return glyphLocator.locator("xpath=..").evaluate((icon, point) => {
    const rect = icon.getBoundingClientRect();
    return { x: rect.left + point.x, y: rect.top + point.y };
  }, { x: iconX, y: iconY });
}

async function setRadius(page, which, metres) {
  await page.evaluate(({ which, metres }) => window.__HALO_REGRESSION__.setRadius(which, metres), { which, metres });
}

async function setUiRadius(page, which, metres) {
  await page.locator(which === "A" ? "#lensAButton" : "#lensBButton").click();
  await page.locator("#radiusSlider").evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, metres);
}

test("equal and unequal radius UI retains the panel and positions independent Lens halos", async (t) => {
  const page = await openPage();
  t.after(() => page.close());
  await setUiRadius(page, "A", 900);
  await setUiRadius(page, "B", 900);
  assert.match(await page.locator("#comparisonModeCue").innerText(), /Equal windows/);
  assert.match(await page.locator("#comparisonRadiusReadout").innerText(), /900 m/);
  await page.addStyleTag({ content: ".panel,.left{display:none!important}" });
  await page.evaluate(() => {
    window.__HALO_REGRESSION__.setCenterAtPoint("A", 360, 430);
    window.__HALO_REGRESSION__.setCenterAtPoint("B", 1000, 430);
  });
  assert.equal((await visibleHaloSlots(page, "A")).filter((slot) => slot.visible).length, 4);
  assert.equal((await visibleHaloSlots(page, "B")).filter((slot) => slot.visible).length, 4);

  await page.addStyleTag({ content: ".panel,.left{display:block!important}" });
  await page.evaluate(() => {
    window.__HALO_REGRESSION__.setCenterAtPoint("A", 280, 430);
    window.__HALO_REGRESSION__.setCenterAtPoint("B", 600, 430);
  });
  await setUiRadius(page, "A", 500);
  await setUiRadius(page, "B", 1500);
  assert.match(await page.locator("#comparisonRadiusReadout").innerText(), /Lens A · 500 m \| Lens B · 1\.5 km/);
  assert.match(await page.locator("#comparisonModeCue").innerText(), /Different windows/);
  assert.match(await page.locator("#cmpMobility").innerText(), /Withheld · different window sizes/);
  const unequal = await page.evaluate(() => window.__HALO_REGRESSION__.setComparison({
    ...window.__HALO_REGRESSION__.fixture,
    radiusMode: "UNEQUAL_RADIUS", radii: { A: 500, B: 1500 }, aoiState: "eligible",
  }));
  assert.equal(unequal.metrics.tourism.aRawValue, 5);
  assert.equal(unequal.metrics.stays.bRawValue, 4);
  assert.ok(unequal.metrics.tourism.aValue > 0, "POI uses the unequal-window rate comparison state");
  assert.ok(unequal.metrics.stays.bValue > 0, "Stay uses the unequal-window rate comparison state");
  assert.equal("mobility" in unequal.metrics, false);
  assert.equal(await page.locator(".halo-slot-mobility").count(), 0);
  assert.ok((await visibleHaloSlots(page, "A")).some((slot) => slot.visible));
  assert.ok((await visibleHaloSlots(page, "B")).some((slot) => slot.visible));
  for (const [lens, metres] of [["A", 500], ["B", 1500]]) {
    const geometry = await page.evaluate(({ lens }) => window.__HALO_REGRESSION__.geometry(lens, "tourism"), { lens });
    const distance = Math.hypot(geometry.anchor.x - geometry.center.x, geometry.anchor.y - geometry.center.y);
    assert.ok(Math.abs(distance - geometry.radiusPx - 5) <= 1.5, `${lens} anchor gap was ${distance - geometry.radiusPx}px`);
    assert.ok(geometry.radiusPx > 0, `${lens} radius projects to a positive screen radius`);
  }
  const panel = await page.locator("#comparisonRadiusReadout").count();
  assert.equal(panel, 1, "Compare panel remains present with the map Halo enabled");
});

test("metric labels keep fixed screen coordinates while POI and Stay fills change", async (t) => {
  const page = await openPage();
  t.after(() => page.close());
  await page.addStyleTag({ content: ".panel,.left{display:none!important}" });
  await page.evaluate(() => {
    window.__HALO_REGRESSION__.setCenterAtPoint("A", 500, 430);
    window.__HALO_REGRESSION__.setCenterAtPoint("B", 1200, 430);
  });
  await setRadius(page, "A", 900);
  const observations = [];
  for (const magnitude of [0, 0.25, 0.5, 1]) {
    await page.evaluate((magnitude) => window.__HALO_REGRESSION__.setComparison({
      ...window.__HALO_REGRESSION__.fixture,
      tourism: { a: { value: magnitude * 10, sourceState: "live" }, b: { value: 10, sourceState: "live" } },
      stays: { a: { value: magnitude * 10, sourceState: "live" }, b: { value: 10, sourceState: "live" } },
    }), magnitude);
    const poi = await glyph(page, "A", "north");
    const stay = await glyph(page, "A", "east");
    observations.push({
      labels: await Promise.all([poi, stay, await glyph(page, "A", "south"), await glyph(page, "A", "west")].map(textPoint)),
      poiFill: await poi.locator(".halo-fill").getAttribute("x2") + "," + await poi.locator(".halo-fill").getAttribute("y2"),
      stayFill: await stay.locator(".halo-fill").getAttribute("x2") + "," + await stay.locator(".halo-fill").getAttribute("y2"),
      track: await poi.locator(".halo-track").evaluate((line) => ["x1", "y1", "x2", "y2"].map((attribute) => line.getAttribute(attribute))),
    });
  }
  for (const row of observations.slice(1)) {
    for (const [index, name] of ["POI", "STAY", "PED", "UTCI"].entries()) {
      assert.ok(Math.hypot(row.labels[index].x - observations[0].labels[index].x, row.labels[index].y - observations[0].labels[index].y) < 0.5, `${name} label screen position is stable`);
    }
    assert.deepEqual(row.track, observations[0].track, "screen-space track length is fixed");
  }
  assert.equal(new Set(observations.map((row) => row.poiFill)).size, 4, "POI fill endpoint changes at every magnitude");
  assert.equal(new Set(observations.map((row) => row.stayFill)).size, 4, "Stay fill endpoint changes at every magnitude");
});

test("valid zero and unavailable evidence render distinct real SVG states", async (t) => {
  const page = await openPage();
  t.after(() => page.close());
  await page.evaluate(() => window.__HALO_REGRESSION__.setComparison({ ...window.__HALO_REGRESSION__.fixture }));
  const poi = await glyph(page, "A", "north");
  await page.evaluate(() => window.__HALO_REGRESSION__.setComparison({
    ...window.__HALO_REGRESSION__.fixture,
    tourism: { a: { value: 0, sourceState: "live" }, b: { value: 10, sourceState: "live" } },
  }));
  assert.notEqual(await poi.locator(".halo-count").evaluate((node) => getComputedStyle(node).display), "none");
  assert.notEqual(await poi.locator(".halo-zero").evaluate((node) => getComputedStyle(node).display), "none");
  assert.equal(await poi.locator(".halo-abstain").evaluate((node) => getComputedStyle(node).display), "none");
  await page.evaluate(() => window.__HALO_REGRESSION__.setComparison({
    ...window.__HALO_REGRESSION__.fixture,
    tourism: { a: { value: null, sourceState: "unavailable" }, b: { value: 10, sourceState: "live" } },
  }));
  assert.notEqual(await poi.locator(".halo-abstain").evaluate((node) => getComputedStyle(node).display), "none");
  assert.equal(await poi.locator(".halo-zero").evaluate((node) => getComputedStyle(node).display), "none");
  assert.equal(await poi.locator(".halo-count").evaluate((node) => getComputedStyle(node).display), "none");
  assert.match(await poi.locator(".halo-abstain").getAttribute("class"), /halo-state-unavailable/);
});

test("compact and hidden modes respond to projected radius while Compare stays available", async (t) => {
  const page = await openPage();
  t.after(() => page.close());
  const initial = await page.evaluate(() => window.__HALO_REGRESSION__.geometry("A", "tourism"));
  const metresPerPixel = 900 / initial.radiusPx;
  await setRadius(page, "A", 36 * metresPerPixel);
  const compact = await glyph(page, "A", "north");
  assert.ok(await compact.evaluate((svg) => svg.classList.contains("halo-compact")));
  assert.notEqual(await compact.locator(".halo-track").count(), 0);
  assert.equal(await compact.locator(".halo-label").evaluate((node) => getComputedStyle(node).display), "none");
  await setRadius(page, "A", 29 * metresPerPixel);
  assert.equal((await visibleHaloSlots(page, "A")).filter((slot) => slot.visible).length, 0);
  assert.equal(await page.locator("#comparisonRadiusReadout").count(), 1);
  assert.notEqual(await page.locator("#cmpPoi").innerText(), "");
});

test("Lens circles and halos keep independent radii and five-pixel attachment", async (t) => {
  const page = await openPage();
  t.after(() => page.close());
  await page.addStyleTag({ content: ".panel,.left{display:none!important}" });
  await page.evaluate(() => {
    window.__HALO_REGRESSION__.setCenterAtPoint("A", 500, 430);
    window.__HALO_REGRESSION__.setCenterAtPoint("B", 1200, 430);
  });
  await setRadius(page, "A", 500);
  await setRadius(page, "B", 1500);
  const before = await page.evaluate(() => ({ A: window.__HALO_REGRESSION__.geometry("A", "tourism"), B: window.__HALO_REGRESSION__.geometry("B", "tourism") }));
  const mapRect = await page.locator("#map").evaluate((map) => map.getBoundingClientRect().toJSON());
  for (const lens of ["A", "B"]) {
    const actual = await renderedAnchor(await glyph(page, lens, "north"), "north");
    assert.ok(Math.hypot(actual.x - mapRect.left - before[lens].anchor.x, actual.y - mapRect.top - before[lens].anchor.y) <= 1.5, `${lens} rendered SVG anchor follows its own projected Lens`);
  }
  await setRadius(page, "A", 1500);
  const afterA = await page.evaluate(() => ({ A: window.__HALO_REGRESSION__.geometry("A", "tourism"), B: window.__HALO_REGRESSION__.geometry("B", "tourism") }));
  assert.ok(afterA.A.radiusPx > before.A.radiusPx);
  assert.ok(Math.hypot(afterA.A.anchor.x - before.A.anchor.x, afterA.A.anchor.y - before.A.anchor.y) > 20, "A spoke moves outward when A radius grows");
  assert.ok(Math.abs(afterA.B.radiusPx - before.B.radiusPx) < 0.01);
  assert.ok(Math.hypot(afterA.B.anchor.x - before.B.anchor.x, afterA.B.anchor.y - before.B.anchor.y) < 0.1);
  await setRadius(page, "B", 500);
  const afterB = await page.evaluate(() => ({ A: window.__HALO_REGRESSION__.geometry("A", "tourism"), B: window.__HALO_REGRESSION__.geometry("B", "tourism") }));
  assert.ok(Math.abs(afterB.A.radiusPx - afterA.A.radiusPx) < 0.01);
  assert.ok(Math.hypot(afterB.B.anchor.x - afterA.B.anchor.x, afterB.B.anchor.y - afterA.B.anchor.y) > 20, "B spoke moves when B radius changes");
  for (const geometry of [before.A, before.B, afterA.A, afterA.B, afterB.A, afterB.B]) {
    const distance = Math.hypot(geometry.anchor.x - geometry.center.x, geometry.anchor.y - geometry.center.y);
    assert.ok(Math.abs(distance - geometry.radiusPx - 5) <= 1.5);
  }
});

test("one cross-Lens slot collision suppresses slots independently", async (t) => {
  const page = await openPage();
  t.after(() => page.close());
  const scale = await page.evaluate(() => {
    const px = window.__HALO_REGRESSION__.geometry("A", "tourism").radiusPx;
    return 900 / px;
  });
  const compactRadiusM = 36 * scale;
  await setRadius(page, "A", compactRadiusM);
  await setRadius(page, "B", compactRadiusM);
  await page.evaluate((distance) => {
    window.__HALO_REGRESSION__.setCenterAtPoint("A", 350, 430);
    window.__HALO_REGRESSION__.setCenterAtPoint("B", 350 + distance, 430);
  }, 2 * (36 + 5));
  const a = await visibleHaloSlots(page, "A");
  const b = await visibleHaloSlots(page, "B");
  assert.ok(a.some((slot) => slot.visible && slot.display !== "none"));
  assert.ok(a.some((slot) => !slot.visible || slot.display === "none"));
  assert.ok(b.some((slot) => slot.visible && slot.display !== "none"));
  assert.match(await page.locator("#haloVisibilityNote").innerText(), /ambiguous Lens A\/B slot overlap/);
  for (const [lens, slots] of [["A", a], ["B", b]]) {
    for (const slot of slots.filter((entry) => entry.visible && entry.display !== "none")) {
      const geometry = await page.evaluate(({ lens, metric }) => window.__HALO_REGRESSION__.geometry(lens, metric), { lens, metric: ({ north: "tourism", east: "stays", south: "pedestrian", west: "utci" })[slot.slot] });
      const distance = Math.hypot(geometry.anchor.x - geometry.center.x, geometry.anchor.y - geometry.center.y);
      assert.ok(Math.abs(distance - geometry.radiusPx - 5) <= 1.5, "visible collision survivors remain attached");
    }
  }
});

test("analysis panel and map edge suppress outward slots without relocating surviving spokes", async (t) => {
  const page = await openPage();
  t.after(() => page.close());
  await setRadius(page, "A", 700);
  await page.evaluate(() => {
    const mapRect = document.querySelector("#map").getBoundingClientRect();
    const panelRect = document.querySelector(".panel").getBoundingClientRect();
    const geometry = window.__HALO_REGRESSION__.geometry("A", "tourism");
    window.__HALO_REGRESSION__.setCenterAtPoint("A", panelRect.left - mapRect.left - geometry.radiusPx - 70, mapRect.height / 2);
    window.__HALO_REGRESSION__.setCenterAtPoint("B", 100, mapRect.height / 2);
  });
  const panelSlots = await visibleHaloSlots(page, "A");
  assert.ok(panelSlots.some((slot) => !slot.visible || slot.display === "none"));
  assert.ok(panelSlots.some((slot) => slot.visible && slot.display !== "none"));
  assert.match(await page.locator("#haloVisibilityNote").innerText(), /map control panel/);
  await page.addStyleTag({ content: ".panel{display:none!important}" });
  const edgeGeometry = await page.evaluate(() => {
    const mapRect = document.querySelector("#map").getBoundingClientRect();
    const radiusPx = window.__HALO_REGRESSION__.geometry("A", "tourism").radiusPx;
    window.__HALO_REGRESSION__.setCenterAtPoint("A", mapRect.width - radiusPx - 80, mapRect.height / 2);
    return window.__HALO_REGRESSION__.geometry("A", "tourism");
  });
  const edgeSlots = await visibleHaloSlots(page, "A");
  assert.ok(edgeSlots.some((slot) => !slot.visible || slot.display === "none"));
  assert.ok(edgeSlots.some((slot) => slot.visible && slot.display !== "none"));
  assert.match(await page.locator("#haloVisibilityNote").innerText(), /map edge/);
  const distance = Math.hypot(edgeGeometry.anchor.x - edgeGeometry.center.x, edgeGeometry.anchor.y - edgeGeometry.center.y);
  assert.ok(Math.abs(distance - edgeGeometry.radiusPx - 5) <= 1.5);
  assert.equal(await page.locator("#comparisonRadiusReadout").count(), 1);
});

test("Halo remains pointer-transparent and a click through a Halo slot reaches the map", async (t) => {
  const page = await openPage();
  t.after(() => page.close());
  const poi = await glyph(page, "A", "north");
  const cssPointerEvents = await poi.evaluate((svg) => getComputedStyle(svg.closest(".comparison-halo-icon")).pointerEvents);
  assert.equal(cssPointerEvents, "none");
  const target = await page.evaluate(() => {
    const anchor = window.__HALO_REGRESSION__.geometry("A", "tourism").anchor;
    window.__haloMapClicks = 0;
    document.querySelector("#map").addEventListener("click", () => { window.__haloMapClicks += 1; }, { once: true });
    return { x: anchor.x, y: anchor.y - 35 };
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction(() => window.__haloMapClicks === 1);
});

test("smaller landscape viewport keeps deterministic layout and available Compare panel", async (t) => {
  const page = await openPage({ width: 1024, height: 768 });
  t.after(() => page.close());
  await page.evaluate(() => window.__HALO_REGRESSION__.setComparison({ ...window.__HALO_REGRESSION__.fixture }));
  assert.equal(await page.locator("#comparisonRadiusReadout").count(), 1);
  assert.ok(await page.locator(".comparison-halo-icon").count() > 0);
  assert.equal(await page.locator(".comparison-halo-icon").first().evaluate((element) => getComputedStyle(element).pointerEvents), "none");
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
