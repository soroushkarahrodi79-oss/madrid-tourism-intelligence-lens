import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== path.join(ROOT, "index.html")) return response.writeHead(403).end();
  fs.readFile(target, (error, content) => {
    if (error) return response.writeHead(404).end();
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    response.end(content);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });

async function openApp({ width = 1440, height = 900, colorScheme = "light", preference, forcedColors = "none", locale = "en-US" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, forcedColors, locale });
  if (preference) await context.addInitScript((value) => localStorage.setItem("madrid-lens-appearance", value), preference);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "127.0.0.1" || host === "localhost" ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__) && Boolean(window.MadridAppearance));
  page.context_ = context;
  return page;
}
const closePage = (page) => page.context_.close();

test("manual Light and Dark persist after reload without changing the basemap", async (t) => {
  const page = await openApp({ colorScheme: "dark" });
  t.after(() => closePage(page));
  assert.equal(await page.locator("html").getAttribute("data-appearance"), "dark");
  assert.equal(await page.locator("#appearanceSelect").inputValue(), "system");
  const originalBasemap = await page.locator("#basemapSelect").inputValue();

  await page.locator("#appearanceSelect").selectOption("light");
  assert.equal(await page.locator("html").getAttribute("data-appearance"), "light");
  assert.equal(await page.evaluate(() => localStorage.getItem("madrid-lens-appearance")), "light");
  assert.equal(await page.locator("#basemapSelect").inputValue(), originalBasemap);
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator("html").getAttribute("data-appearance"), "light");
  assert.equal(await page.locator("#appearanceSelect").inputValue(), "light");

  await page.locator("#appearanceSelect").selectOption("dark");
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator("html").getAttribute("data-appearance"), "dark");
  assert.equal(await page.locator("#appearanceSelect").inputValue(), "dark");
  assert.equal(await page.locator("#basemapSelect").inputValue(), originalBasemap);
});

test("System follows live OS changes and never overrides a manual preference", async (t) => {
  const page = await openApp({ colorScheme: "light", preference: "system" });
  t.after(() => closePage(page));
  assert.equal(await page.locator("html").getAttribute("data-appearance"), "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.dataset.appearance === "dark");
  await page.locator("#appearanceSelect").selectOption("light");
  await page.emulateMedia({ colorScheme: "dark" });
  assert.equal(await page.locator("html").getAttribute("data-appearance"), "light");
  await page.emulateMedia({ colorScheme: "light" });
  assert.equal(await page.locator("html").getAttribute("data-appearance"), "light");
});

for (const appearance of ["light", "dark"]) {
  for (const basemap of ["light", "dark", "satellite"]) {
    test(`${appearance} UI remains independent from the ${basemap} basemap and map camera`, async (t) => {
      const page = await openApp({ preference: appearance });
      t.after(() => closePage(page));
      const before = await page.evaluate(() => {
        const m = eval("map"), center = m.getCenter();
        return { center: [center.lat, center.lng], zoom: m.getZoom(), radius: document.querySelector("#radiusSlider").value };
      });
      await page.locator("#basemapSelect").selectOption(basemap);
      await page.locator("#appearanceSelect").selectOption(appearance === "light" ? "dark" : "light");
      await page.locator("#appearanceSelect").selectOption(appearance);
      const after = await page.evaluate(() => {
        const m = eval("map"), center = m.getCenter();
        return { center: [center.lat, center.lng], zoom: m.getZoom(), radius: document.querySelector("#radiusSlider").value };
      });
      assert.deepEqual(after, before);
      assert.equal(await page.locator("#basemapSelect").inputValue(), basemap);
      assert.equal(await page.locator("html").getAttribute("data-appearance"), appearance);
    });
  }
}

test("Appearance copy localizes in EN and ES and stays keyboard reachable", async (t) => {
  const page = await openApp({ width: 390, height: 844 });
  t.after(() => closePage(page));
  const select = page.locator("#appearanceSelect");
  const visibleLabel = page.locator(".appearance-control > span");
  assert.equal(await select.getAttribute("aria-label"), "Appearance");
  assert.equal((await visibleLabel.textContent()).trim(), "Appearance");
  assert.equal(await visibleLabel.isVisible(), false, "phone selects retain an aria-label; the oversized visual label does not consume space");
  await page.locator("#languageSelect").selectOption("es");
  assert.equal(await select.getAttribute("aria-label"), "Apariencia");
  assert.equal((await visibleLabel.textContent()).trim(), "Apariencia");
  assert.equal(await visibleLabel.isVisible(), false, "phone selects retain an aria-label; the oversized visual label does not consume space");
  assert.deepEqual(await select.locator("option").allTextContents(), ["Claro", "Oscuro", "Sistema"]);
  await select.focus();
  const focus = await select.evaluate((node) => {
    const s = getComputedStyle(node);
    return { visible: node.matches(":focus-visible"), width: s.outlineWidth, style: s.outlineStyle };
  });
  assert.equal(focus.visible, true);
  assert.equal(focus.style, "solid");
  assert.ok(parseFloat(focus.width) >= 2);
  await page.setViewportSize({ width: 1024, height: 768 });
  assert.equal(await visibleLabel.isVisible(), true, "desktop keeps the full visible appearance label");
});

for (const viewport of [{ width: 360, height: 760 }, { width: 390, height: 844 }, { width: 420, height: 860 }, { width: 720, height: 450 }, { width: 834, height: 1112 }, { width: 1440, height: 900 }]) {
  test(`Light reflows without page overflow or header collisions at ${viewport.width}px`, async (t) => {
    const page = await openApp({ ...viewport, preference: "light" });
    t.after(() => closePage(page));
    const result = await page.evaluate(() => {
      const box = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const brand = box(".brand"), tools = box(".header-tools"), header = box("header");
      return {
        horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
        brandToolsOverlap: Math.max(brand.left, tools.left) < Math.min(brand.right, tools.right) && Math.max(brand.top, tools.top) < Math.min(brand.bottom, tools.bottom),
        toolsInsideHeader: tools.right <= header.right + .5 && tools.left >= header.left - .5,
        appearanceVisible: document.querySelector("#appearanceSelect").getClientRects().length > 0
      };
    });
    assert.ok(result.horizontalOverflow <= 1, JSON.stringify(result));
    assert.equal(result.brandToolsOverlap, false, JSON.stringify(result));
    assert.equal(result.toolsInsideHeader, true, JSON.stringify(result));
    assert.equal(result.appearanceVisible, true);
  });
}

test("Light keeps A/B identity and comparable, withheld and OFF readings visually distinct", async (t) => {
  const page = await openApp({ preference: "light" });
  t.after(() => closePage(page));
  await page.locator("#modeCompareButton").click();
  await page.evaluate(() => {
    window.__HALO_REGRESSION__.setRadius("B", 1800);
    window.__HALO_REGRESSION__.recompute();
  });
  await page.waitForFunction(() => {
    const states = [...document.querySelectorAll("#decisionInsightItems .di-item")].map((node) => node.dataset.state);
    return states.includes("comparable") && states.some((state) => state === "withheld" || state === "unavailable") && states.includes("off");
  });
  const result = await page.evaluate(() => {
    const color = (selector) => getComputedStyle(document.querySelector(selector)).color;
    const text = (selector) => document.querySelector(selector).textContent.trim();
    const limited = document.querySelector('#decisionInsightItems .di-item[data-state="withheld"], #decisionInsightItems .di-item[data-state="unavailable"]');
    return {
      lensA: color(".cb-side-a .cb-lens"),
      lensB: color(".cb-side-b .cb-lens"),
      comparable: color('#decisionInsightItems .di-item[data-state="comparable"] .di-rel'),
      limited: getComputedStyle(limited.querySelector(".di-rel")).color,
      limitedText: limited.querySelector(".di-rel").textContent.trim(),
      off: color('#decisionInsightItems .di-item[data-state="off"] .di-rel'),
      offText: text('#decisionInsightItems .di-item[data-state="off"] .di-rel'),
      selectedMode: color('#modeCompareButton[aria-pressed="true"]')
    };
  });
  assert.notEqual(result.lensA, result.lensB, JSON.stringify(result));
  assert.notEqual(result.comparable, result.limited, JSON.stringify(result));
  assert.doesNotMatch(result.limitedText, /^0(?:\.0)?$/);
  assert.match(result.offText, /off/i);
  assert.doesNotMatch(result.offText, /^0(?:\.0)?$/);
  assert.equal(result.selectedMode, "rgb(255, 255, 255)");
});

test("PLACE, COMPARE, CITY and the evidence drawer render in both appearances", async (t) => {
  const page = await openApp({ preference: "light" });
  t.after(() => closePage(page));
  for (const appearance of ["light", "dark"]) {
    await page.locator("#appearanceSelect").selectOption(appearance);
    for (const mode of ["PLACE", "COMPARE", "CITY"]) {
      await page.locator(`.mode-btn[data-mode="${mode}"]`).click();
      assert.equal(await page.locator("#analysisPanel").getAttribute("data-mode"), mode);
      await page.locator(`[data-evidence-mode="${mode}"]`).click();
      assert.equal(await page.locator("#evidenceDrawer").getAttribute("open"), "");
      await page.keyboard.press("Escape");
    }
  }
});

test("forced colours retains visible controls and focus", async (t) => {
  const page = await openApp({ forcedColors: "active", preference: "light" });
  t.after(() => closePage(page));
  const select = page.locator("#appearanceSelect");
  await select.focus();
  assert.equal(await select.isVisible(), true);
  assert.equal(await select.evaluate((node) => node.matches(":focus-visible")), true);
  assert.equal(await page.locator("#modePlaceButton").isVisible(), true);
  assert.equal(await page.locator("#mobileLayersButton").count(), 1);
});

test("appearance changes stay inexpensive under 4x CPU throttling", async (t) => {
  const page = await openApp({ preference: "light" });
  t.after(() => closePage(page));
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const elapsed = await page.evaluate(async () => {
    const select = document.querySelector("#appearanceSelect");
    const started = performance.now();
    for (let index = 0; index < 20; index += 1) {
      select.value = index % 2 ? "light" : "dark";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      getComputedStyle(document.querySelector("#analysisPanel")).backgroundColor;
    }
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    return performance.now() - started;
  });
  const perChange = elapsed / 20;
  assert.ok(perChange < 150, `appearance changes averaged ${perChange.toFixed(1)}ms at 4x CPU throttling`);
  t.diagnostic(`20 changes at 4x CPU: ${elapsed.toFixed(1)}ms (${perChange.toFixed(1)}ms/change)`);
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});


test("P1 responsive shell keeps branding, map tools and provider credits distinct at phone, tablet and laptop sizes", async (t) => {
  const page = await openApp({ width: 390, height: 844, preference: "light" });
  t.after(() => closePage(page));
  const rectTest = async () => page.evaluate(() => {
    const rect = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const overlaps = (a, b) => Boolean(a && b && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1);
    const brand = rect(".brand"), tools = rect(".header-tools"), panel = rect("#analysisPanel");
    const layers = rect("#mobileLayersButton"), zoom = rect(".leaflet-control-zoom");
    const attribution = rect(".leaflet-control-attribution");
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      viewportWidth: window.innerWidth,
      brand, tools, panel, layers, zoom, attribution,
      brandTools: overlaps(brand, tools),
      layersTools: getComputedStyle(document.querySelector("#mobileLayersButton")).display !== "none" && overlaps(layers, tools),
      zoomAttribution: overlaps(zoom, attribution),
      zoomLayers: getComputedStyle(document.querySelector("#mobileLayersButton")).display !== "none" && overlaps(zoom, layers),
      brandTextClipped: window.innerWidth <= 680 &&
        document.querySelector(".brand-title").scrollWidth > document.querySelector(".brand-title").clientWidth + 1,
      credits: document.querySelector(".leaflet-control-attribution").textContent,
      themeWidth: rect("#appearanceSelect")?.width,
      themeHeight: rect("#appearanceSelect")?.height,
      languageHeight: rect("#languageSelect")?.height
    };
  });
  for (const viewport of [
    { width: 320, height: 700 }, { width: 360, height: 760 },
    { width: 390, height: 844 }, { width: 420, height: 860 },
    { width: 560, height: 760 }, { width: 600, height: 820 },
    { width: 720, height: 450 }, { width: 900, height: 700 },
    { width: 1024, height: 768 }, { width: 1440, height: 900 },
    { width: 390, height: 320 }
  ]) {
    await page.setViewportSize(viewport);
    const g = await rectTest();
    assert.ok(g.overflow <= 1, `horizontal document overflow at ${viewport.width}x${viewport.height}: ${JSON.stringify(g)}`);
    assert.ok(g.panel.left >= -1 && g.panel.right <= viewport.width + 1, `analysis panel remains within the viewport at ${viewport.width}x${viewport.height}: ${JSON.stringify(g.panel)}`);
    assert.equal(g.brandTools, false, `brand/tool collision: ${JSON.stringify(g)}`);
    assert.equal(g.layersTools, false, `Layers/preference collision: ${JSON.stringify(g)}`);
    assert.equal(g.zoomAttribution, false, `zoom/provider credit collision: ${JSON.stringify(g)}`);
    assert.equal(g.zoomLayers, false, `zoom/Layers collision: ${JSON.stringify(g)}`);
    assert.equal(g.brandTextClipped, false, `mobile brand clipping: ${JSON.stringify(g)}`);
    if (viewport.width <= 680) assert.ok(g.themeHeight >= 44 && g.languageHeight >= 44, `touch preferences at ${viewport.width}px: ${JSON.stringify(g)}`);
    assert.ok(g.themeWidth >= 70, "appearance remains a real visible select, not a hidden setting");
    assert.ok(/OpenStreetMap/i.test(g.credits), "required OSM attribution remains visible");
    // CI has an empty CARTO key and legitimately falls back to OSM tiles;
    // demand CARTO credit only if that provider is actually enabled.
    if (await page.evaluate(() => Boolean(window.RUNTIME_CONFIG?.CARTO_BASEMAP_KEY))) {
      assert.ok(/CARTO/i.test(g.credits), "CARTO credit remains when CARTO tiles are enabled");
    }
    assert.ok(g.tools.left >= 0 && g.tools.right <= viewport.width + 1, "tools remain inside viewport");
  }
});

// --------------------------------------------------------------------------
// Header chrome must never be drawn over the header, including in the frame
// immediately after a viewport change.
//
// syncHeaderBottom() writes --header-bottom inline on :root, which overrides
// every media-query value. After a viewport change that value still describes
// the PREVIOUS viewport until the ResizeObserver callback is delivered, which
// is at least one frame later. Map chrome positioned from the measurement alone
// is therefore drawn over the header for that frame — a real, user-visible
// overlap, not a test artefact. Each breakpoint also declares the header height
// it guarantees, and chrome uses max(measurement, floor).
//
// Every assertion below measures IMMEDIATELY after the viewport change, with no
// settling wait, because that transient frame is exactly what has to be safe.
// --------------------------------------------------------------------------
const CHROME_VIEWPORTS = [
  { width: 320, height: 700 }, { width: 360, height: 760 },
  { width: 390, height: 844 }, { width: 420, height: 860 },
  { width: 560, height: 760 }, { width: 600, height: 820 },
  { width: 720, height: 450 }, { width: 900, height: 700 },
  { width: 1024, height: 768 }, { width: 1440, height: 900 },
  { width: 390, height: 320 },
];

async function chromeGeometry(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      if (!box.width && !box.height) return null;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return null;
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const overlaps = (a, b) => Boolean(a && b && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1);
    const header = rect("header");
    const parts = {
      layers: rect("#mobileLayersButton"),
      zoom: rect(".leaflet-control-zoom"),
      attribution: rect(".leaflet-control-attribution"),
      rail: rect("#layerRail"),
      search: rect("#geoSearchPanel"),
      searchToggle: rect("#geoSearchToggle"),
      tools: rect(".header-tools"),
      brand: rect(".brand"),
    };
    const overHeader = Object.entries(parts)
      .filter(([name]) => !["tools", "brand", "searchToggle"].includes(name))
      .filter(([, box]) => overlaps(box, header))
      .map(([name]) => name);
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      headerBottom: header ? header.bottom : null,
      measured: document.documentElement.style.getPropertyValue("--header-bottom").trim() || null,
      parts,
      overHeader,
      layersTools: overlaps(parts.layers, parts.tools),
      zoomLayers: overlaps(parts.zoom, parts.layers),
      zoomAttribution: overlaps(parts.zoom, parts.attribution),
      railTools: overlaps(parts.rail, parts.tools),
      searchTools: overlaps(parts.search, parts.tools),
      searchLayers: overlaps(parts.search, parts.layers),
    };
  });
}

function assertNoCollision(geometry, label) {
  assert.deepEqual(geometry.overHeader, [], `${label}: map chrome drawn over the header — ${JSON.stringify(geometry)}`);
  assert.equal(geometry.layersTools, false, `${label}: Layers/preferences collision — ${JSON.stringify(geometry)}`);
  assert.equal(geometry.zoomLayers, false, `${label}: zoom/Layers collision — ${JSON.stringify(geometry)}`);
  assert.equal(geometry.zoomAttribution, false, `${label}: zoom/attribution collision — ${JSON.stringify(geometry)}`);
  assert.equal(geometry.railTools, false, `${label}: Layers rail over the header tools — ${JSON.stringify(geometry)}`);
  assert.equal(geometry.searchTools, false, `${label}: place finder over the header tools — ${JSON.stringify(geometry)}`);
  assert.ok(geometry.overflow <= 1, `${label}: horizontal document overflow ${geometry.overflow}`);
}

test("map chrome clears the header in the frame right after every viewport change", async (t) => {
  const page = await openApp({ width: 1440, height: 900, preference: "light" });
  t.after(() => closePage(page));
  // Every viewport is entered from the WIDEST one, so the inline measurement is
  // always stale by a full breakpoint when the geometry is read. That is the
  // transition the post-merge failure came from.
  for (const viewport of CHROME_VIEWPORTS) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(120);
    await page.setViewportSize(viewport);
    assertNoCollision(await chromeGeometry(page), `1440x900 -> ${viewport.width}x${viewport.height} (immediate)`);
    await page.waitForTimeout(150);
    assertNoCollision(await chromeGeometry(page), `1440x900 -> ${viewport.width}x${viewport.height} (settled)`);
  }
});

test("map chrome clears the header through rapid transitions and orientation changes", async (t) => {
  const page = await openApp({ width: 390, height: 844, preference: "light" });
  t.after(() => closePage(page));

  // Rapid consecutive changes with no settling between them.
  for (let round = 0; round < 3; round += 1) {
    for (const viewport of CHROME_VIEWPORTS) {
      await page.setViewportSize(viewport);
      assertNoCollision(await chromeGeometry(page), `rapid round ${round} at ${viewport.width}x${viewport.height}`);
    }
  }

  // Orientation changes, both directions, measured immediately.
  for (const [portrait, landscape] of [[{ width: 390, height: 844 }, { width: 844, height: 390 }], [{ width: 360, height: 760 }, { width: 760, height: 360 }], [{ width: 320, height: 700 }, { width: 700, height: 320 }]]) {
    await page.setViewportSize(portrait);
    await page.waitForTimeout(120);
    await page.setViewportSize(landscape);
    assertNoCollision(await chromeGeometry(page), `rotate to landscape ${landscape.width}x${landscape.height}`);
    await page.setViewportSize(portrait);
    assertNoCollision(await chromeGeometry(page), `rotate to portrait ${portrait.width}x${portrait.height}`);
  }
});

test("map chrome clears the header with the place finder open, in both languages and all appearances", async (t) => {
  for (const language of ["en", "es"]) {
    for (const appearance of ["light", "dark", "system"]) {
      const page = await openApp({ width: 1440, height: 900, preference: "light", colorScheme: appearance === "dark" ? "dark" : "light" });
      try {
        await page.locator("#languageSelect").selectOption(language);
        await page.locator("#appearanceSelect").selectOption(appearance);
        await page.locator("#geoSearchToggle").click();
        await page.waitForFunction(() => !document.querySelector("#geoSearchPanel").hasAttribute("hidden"));
        for (const viewport of CHROME_VIEWPORTS) {
          await page.setViewportSize({ width: 1440, height: 900 });
          await page.waitForTimeout(80);
          await page.setViewportSize(viewport);
          const label = `${language}/${appearance} finder open at ${viewport.width}x${viewport.height}`;
          const immediate = await chromeGeometry(page);
          assertNoCollision(immediate, `${label} (immediate)`);
          assert.ok(immediate.parts.search, `${label}: the finder must stay rendered`);
          await page.waitForTimeout(120);
          assertNoCollision(await chromeGeometry(page), `${label} (settled)`);
        }
        // Closed again, the same sweep must hold.
        await page.locator("#geoSearchClose").click();
        for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 700 }, { width: 390, height: 320 }]) {
          await page.setViewportSize({ width: 1440, height: 900 });
          await page.waitForTimeout(80);
          await page.setViewportSize(viewport);
          assertNoCollision(await chromeGeometry(page), `${language}/${appearance} finder closed at ${viewport.width}x${viewport.height}`);
        }
      } finally {
        await closePage(page);
      }
    }
  }
});

test("every interactive map control stays operable and 44px after a breakpoint change", async (t) => {
  const page = await openApp({ width: 1440, height: 900, preference: "light" });
  t.after(() => closePage(page));
  for (const viewport of [{ width: 320, height: 700 }, { width: 360, height: 760 }, { width: 390, height: 844 }, { width: 390, height: 320 }]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(100);
    await page.setViewportSize(viewport);
    const targets = await page.evaluate(() => {
      const measure = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const style = getComputedStyle(element);
        if (style.display === "none") return null;
        const box = element.getBoundingClientRect();
        // Is the control's own centre the topmost element there?
        const hit = document.elementFromPoint(Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2));
        return { width: box.width, height: box.height, reachable: Boolean(hit && (element === hit || element.contains(hit) || hit.contains(element))) };
      };
      return {
        layers: measure("#mobileLayersButton"),
        searchToggle: measure("#geoSearchToggle"),
        appearance: measure("#appearanceSelect"),
        language: measure("#languageSelect"),
      };
    });
    for (const [name, target] of Object.entries(targets)) {
      if (!target) continue;
      assert.ok(target.height >= 44, `${name} at ${viewport.width}x${viewport.height} is ${target.height}px tall`);
      assert.equal(target.reachable, true, `${name} at ${viewport.width}x${viewport.height} is covered by another control`);
    }
    // The Layers button must actually open the rail after the breakpoint change.
    if (targets.layers) {
      await page.locator("#mobileLayersButton").click();
      await page.waitForFunction(() => !document.querySelector("#layerRail").hasAttribute("hidden"));
      assertNoCollision(await chromeGeometry(page), `rail open at ${viewport.width}x${viewport.height}`);
      await page.locator("#mobileLayersButton").click();
    }
  }
});
