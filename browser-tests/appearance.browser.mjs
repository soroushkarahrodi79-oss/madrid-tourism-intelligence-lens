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
  assert.equal(await visibleLabel.isVisible(), true);
  await page.locator("#languageSelect").selectOption("es");
  assert.equal(await select.getAttribute("aria-label"), "Apariencia");
  assert.equal((await visibleLabel.textContent()).trim(), "Apariencia");
  assert.equal(await visibleLabel.isVisible(), true);
  assert.deepEqual(await select.locator("option").allTextContents(), ["Claro", "Oscuro", "Sistema"]);
  await select.focus();
  const focus = await select.evaluate((node) => {
    const s = getComputedStyle(node);
    return { visible: node.matches(":focus-visible"), width: s.outlineWidth, style: s.outlineStyle };
  });
  assert.equal(focus.visible, true);
  assert.equal(focus.style, "solid");
  assert.ok(parseFloat(focus.width) >= 2);
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
