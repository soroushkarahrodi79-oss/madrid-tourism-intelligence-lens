import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const label = process.argv[2] || "before";
const baseUrl = process.env.UX_P2_BASE_URL || "http://127.0.0.1:4173";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (m) => m.slice(1))), "..");
const output = path.join(root, "docs", "review", "ux-p2", label);
const viewports = [
  { name: "320x568", width: 320, height: 568, touch: true },
  { name: "360x800", width: 360, height: 800, touch: true },
  { name: "390x844", width: 390, height: 844, touch: true },
  { name: "430x932", width: 430, height: 932, touch: true },
  { name: "768x1024", width: 768, height: 1024, touch: true },
  { name: "1024x768", width: 1024, height: 768, touch: false },
  { name: "1366x768", width: 1366, height: 768, touch: false },
  { name: "1440x900", width: 1440, height: 900, touch: false },
];

await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = [];

function roundedRect(rect) {
  if (!rect) return null;
  return Object.fromEntries(["x", "y", "width", "height", "top", "right", "bottom", "left"]
    .map((key) => [key, Math.round(rect[key] * 10) / 10]));
}

for (const viewport of viewports) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: viewport.touch,
    isMobile: viewport.width <= 430,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => localStorage.setItem("madrid-lens-tutorial-v1", "1:completed"));
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(`${baseUrl}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
  await page.waitForFunction(() => /Reference ·|Referencia ·/.test(document.getElementById("scopeRailFreshness")?.textContent || ""));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(output, `${viewport.name}-place.jpg`), type: "jpeg", quality: 82, fullPage: false });

  const place = await page.evaluate(() => {
    const selectors = {
      header: "header", map: "#map", panel: "#analysisPanel", rail: "#layerRail",
      layersButton: "#mobileLayersButton", zoom: ".leaflet-control-zoom",
      attribution: ".leaflet-control-attribution", modeNav: "#modeNav", resizeHandle: "#panelResizeHandle",
    };
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element || element.hidden || getComputedStyle(element).display === "none") return null;
      return element.getBoundingClientRect().toJSON();
    };
    const interactive = [...document.querySelectorAll("button, select, summary, a[href], input:not([type=hidden])")]
      .filter((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
      })
      .map((element) => {
        const box = element.getBoundingClientRect();
        return { tag: element.tagName, id: element.id || null, cls: element.className || null, text: (element.textContent || "").trim().slice(0, 80), width: box.width, height: box.height };
      });
    const exempt = (item) => /leaflet-control-attribution/.test(String(item.cls));
    return {
      document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, clientHeight: document.documentElement.clientHeight, scrollHeight: document.documentElement.scrollHeight },
      rects: Object.fromEntries(Object.entries(selectors).map(([key, selector]) => [key, rect(selector)])),
      panel: { scrollHeight: document.getElementById("analysisPanel").scrollHeight, clientHeight: document.getElementById("analysisPanel").clientHeight },
      visibleTargets: interactive.length,
      targetsUnder44: interactive.filter((item) => !exempt(item) && (item.width < 44 || item.height < 44)),
      language: document.documentElement.lang,
    };
  });

  if (viewport.width <= 560) {
    await page.locator("#mobileLayersButton").click();
    await page.screenshot({ path: path.join(output, `${viewport.name}-layers.jpg`), type: "jpeg", quality: 82, fullPage: false });
    place.layersOpen = await page.evaluate(() => ({
      expanded: document.getElementById("mobileLayersButton").getAttribute("aria-expanded"),
      rail: document.getElementById("layerRail").getBoundingClientRect().toJSON(),
      groupCount: document.querySelectorAll("#layerRail .rail-group").length,
      toggleCount: document.querySelectorAll("#layerRail input[data-layer]").length,
    }));
    await page.keyboard.press("Escape");
  }

  await page.locator('[data-mode="COMPARE"]').click();
  await page.waitForFunction(() => document.getElementById("analysisPanel").dataset.mode === "COMPARE");
  // The canonical table is intentionally inside a collapsed Detail disclosure.
  // Drive the same focus path through the test seam so the capture can inspect
  // the compact Bridge without changing the disclosure's production state.
  await page.evaluate(() => window.__HALO_REGRESSION__.focusMetric("tourism", "A", true));
  await page.waitForFunction(() => !document.getElementById("comparisonBridgeMetric").hidden);
  await page.locator("#comparisonBridge").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, `${viewport.name}-compare.jpg`), type: "jpeg", quality: 82, fullPage: false });
  const compare = await page.evaluate(() => {
    const panel = document.getElementById("analysisPanel").getBoundingClientRect();
    const bridge = document.getElementById("comparisonBridge").getBoundingClientRect();
    return {
      bridge: bridge.toJSON(), panel: panel.toJSON(),
      bridgeFullyVisible: bridge.top >= panel.top && bridge.bottom <= panel.bottom,
      bridgeText: document.getElementById("comparisonBridge").innerText.trim().replace(/\s+/g, " "),
      compareScrollTop: document.getElementById("analysisPanel").scrollTop,
    };
  });

  if (viewport.name === "390x844") {
    await page.locator('.evidence-route[data-evidence-mode="COMPARE"]').scrollIntoViewIfNeeded();
    await page.locator('.evidence-route[data-evidence-mode="COMPARE"]').click();
    await page.locator("#evidenceDrawer").waitFor({ state: "visible" });
    await page.screenshot({ path: path.join(output, `${viewport.name}-evidence.jpg`), type: "jpeg", quality: 82, fullPage: false });
    compare.evidenceDialog = await page.evaluate(() => {
      const dialog = document.getElementById("evidenceDrawer");
      const close = dialog.querySelector(".drawer-close").getBoundingClientRect();
      return { open: dialog.open, rect: dialog.getBoundingClientRect().toJSON(), close: close.toJSON() };
    });
  }

  report.push({
    viewport,
    place: {
      ...place,
      rects: Object.fromEntries(Object.entries(place.rects).map(([key, rect]) => [key, roundedRect(rect)])),
      layersOpen: place.layersOpen ? { ...place.layersOpen, rail: roundedRect(place.layersOpen.rail) } : undefined,
      targetsUnder44: place.targetsUnder44.map((item) => ({ ...item, width: Math.round(item.width * 10) / 10, height: Math.round(item.height * 10) / 10 })),
    },
    compare: { ...compare, bridge: roundedRect(compare.bridge), panel: roundedRect(compare.panel), evidenceDialog: compare.evidenceDialog ? { ...compare.evidenceDialog, rect: roundedRect(compare.evidenceDialog.rect), close: roundedRect(compare.evidenceDialog.close) } : undefined },
    consoleErrors,
  });
  await context.close();
}

await browser.close();
await fs.writeFile(path.join(output, "measurements.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`UX P2 ${label}: ${report.length} viewports captured in ${output}`);
