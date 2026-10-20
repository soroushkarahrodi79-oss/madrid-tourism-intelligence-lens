import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "capture-current");
const APP_URL = "https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens/";
const EXPECTED = {
  commit: "9a7d2f20debdffce0823bbca81850060069ccb4d",
  manifestSha256: "ee5307fbb9ed31a2ffc440b070b2e60d53861084d37b4194612bb12a8365d071",
  poiSha256: "c2982798228e7936dd0cce813d1f9d0627b9946769f11f3a101ec6a2da0ea0cf",
  assets: {
    "index.html": "758f01eeecbb5be48e5897331d7311c1477a3b07674db9812d0863aac6d24acb",
    "css/app.css": "c08e5cd139152e0916da17267d705a75985baee9005ac0c96d65449820888da1",
    "js/app.js": "5dad8b53e211ea51d40e57e8a8e3d88c351f04470b08f6219a9d663a65a2a34c",
    "assets/leaflet/leaflet.css": "337bfca5cabd03b39815b2700febe2b3b7edf55921c59cd49f88ecb328212303",
  },
};
const LIGHT_MAP_CSS = `
:root {
  --leaflet-map-fallback-bg: #f4f6f9;
  --leaflet-attribution-bg: rgba(255,255,255,.92);
  --leaflet-attribution-text: #445468;
  --leaflet-attribution-link: #0a63c7;
  --leaflet-zoom-bg: #ffffff;
  --leaflet-zoom-text: #16222f;
  --leaflet-zoom-border: #c7ced7;
  --leaflet-zoom-shadow: 0 8px 24px rgba(16,24,34,.18);
  --leaflet-zoom-hover-bg: #f2f4f7;
  --leaflet-zoom-disabled-text: #667586;
  --leaflet-tooltip-bg: rgba(255,255,255,.96);
  --leaflet-tooltip-border: #aab6c4;
  --leaflet-tooltip-text: #16222f;
  --leaflet-tooltip-shadow: 0 10px 28px rgba(16,24,34,.18);
  --map-label-bg: rgba(255,255,255,.94);
  --map-label-border: rgba(22,34,47,.30);
  --map-label-text: #16222f;
  --map-label-b-text: #00718f;
}
#map, .leaflet-container { background: var(--leaflet-map-fallback-bg) !important; }
.leaflet-control-attribution {
  background: var(--leaflet-attribution-bg) !important;
  color: var(--leaflet-attribution-text) !important;
}
.leaflet-control-attribution a,
.leaflet-control-attribution a:hover { color: var(--leaflet-attribution-link) !important; }
.leaflet-control-zoom { box-shadow: var(--leaflet-zoom-shadow) !important; }
.leaflet-control-zoom a {
  background: var(--leaflet-zoom-bg) !important;
  color: var(--leaflet-zoom-text) !important;
  border-color: var(--leaflet-zoom-border) !important;
}
.leaflet-control-zoom a:hover {
  background: var(--leaflet-zoom-hover-bg) !important;
  color: var(--leaflet-zoom-text) !important;
}
.leaflet-control-zoom a.leaflet-disabled { color: var(--leaflet-zoom-disabled-text) !important; }
.leaflet-tooltip {
  background: var(--leaflet-tooltip-bg) !important;
  border-color: var(--leaflet-tooltip-border) !important;
  color: var(--leaflet-tooltip-text) !important;
  box-shadow: var(--leaflet-tooltip-shadow) !important;
}
.leaflet-tooltip-top:before { border-top-color: var(--leaflet-tooltip-border) !important; }
.area-label {
  background: var(--map-label-bg) !important;
  border-color: var(--map-label-border) !important;
  color: var(--map-label-text) !important;
  box-shadow: 0 6px 18px rgba(16,24,34,.16) !important;
}
.area-label-b { border-color: rgba(0,113,143,.45) !important; }
.area-label-b b { color: var(--map-label-b-text) !important; }
.leaflet-control-zoom a:focus-visible,
.leaflet-control-attribution a:focus-visible {
  outline: 2px solid #0a63c7 !important;
  outline-offset: 3px;
  box-shadow: 0 0 0 1px #f4f6f9 !important;
}
`;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function getBytes(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Pinned resource returned HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
async function assertSnapshot() {
  const manifestBytes = await getBytes(new URL("data/deployment_manifest.json", APP_URL));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (digest(manifestBytes) !== EXPECTED.manifestSha256) throw new Error("Deployment manifest digest changed");
  if (manifest.commit !== EXPECTED.commit || manifest.build_state !== "pass" || manifest.build_step_outcome !== "success") {
    throw new Error("Production manifest does not match the pinned successful build");
  }
  const poiBytes = await getBytes(new URL("data/runtime_poi.json", APP_URL));
  if (digest(poiBytes) !== EXPECTED.poiSha256) throw new Error("Production POI digest changed");
  const assets = {};
  for (const [file, expected] of Object.entries(EXPECTED.assets)) {
    const actual = digest(await getBytes(new URL(file, APP_URL)));
    if (actual !== expected) throw new Error(`Deployed asset differs from pinned source: ${file}`);
    assets[file] = actual;
  }
  return {
    commit: manifest.commit, workflowRun: manifest.workflow_run, generatedAt: manifest.generated_at,
    buildState: manifest.build_state, manifestSha256: digest(manifestBytes),
    runtimePoiSha256: digest(poiBytes), runtimePoiBytes: poiBytes.length, assets,
  };
}
async function openMap(context) {
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => {
    try {
      return !!document.querySelector(".leaflet-container") &&
        !!document.querySelector("#basemapSelect") && !!eval("map");
    } catch { return false; }
  }, null, { timeout: 60000 });
  await page.waitForFunction(() => {
    const tiles = [...document.querySelectorAll(".leaflet-tile")];
    return tiles.length >= 4 && tiles.filter((tile) => tile.complete && tile.naturalWidth > 0).length >= 4;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(1100);
  return page;
}
async function selectState(page, language, basemap) {
  await page.locator("#languageSelect").selectOption(language);
  await page.locator("#basemapSelect").selectOption(basemap);
  await page.waitForFunction(({ language, basemap }) =>
    document.documentElement.lang === language &&
    document.querySelector("#basemapSelect")?.value === basemap,
    { language, basemap }, { timeout: 12000 });
  await page.waitForFunction(() => {
    const tiles = [...document.querySelectorAll(".leaflet-tile")];
    return tiles.length >= 4 && tiles.filter((tile) => tile.complete && tile.naturalWidth > 0).length >= 4;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(1400);
}
async function installLightMapPreview(page) { await page.addStyleTag({ content: LIGHT_MAP_CSS }); }
async function selectMobileState(page, language, basemap) {
  await page.locator("#mobileLayersButton").click();
  await page.waitForFunction(() => document.querySelector("#mobileLayersButton")?.getAttribute("aria-expanded") === "true");
  const mapGroup = page.locator('#layerRail details[data-rail-group="map"]');
  if (!(await mapGroup.evaluate((e) => e.open))) await mapGroup.locator("summary").click();
  await page.locator("#languageSelect").selectOption(language);
  await page.locator("#basemapSelect").selectOption(basemap);
  await page.waitForFunction(({ language, basemap }) =>
    document.documentElement.lang === language &&
    document.querySelector("#basemapSelect")?.value === basemap,
    { language, basemap }, { timeout: 12000 });
  await page.waitForFunction(() => {
    const tiles = [...document.querySelectorAll(".leaflet-tile")];
    return tiles.length >= 4 && tiles.filter((tile) => tile.complete && tile.naturalWidth > 0).length >= 4;
  }, null, { timeout: 30000 });
  await page.locator("#mobileLayersButton").click();
  await page.waitForFunction(() => document.querySelector("#mobileLayersButton")?.getAttribute("aria-expanded") === "false");
  await page.waitForTimeout(1200);
}
async function hoverBoundTooltip(page) {
  const candidates = await page.evaluate(() => {
    const m = eval("map"), result = [];
    const panelLeft = document.querySelector("#analysisPanel")?.getBoundingClientRect().left ?? innerWidth;
    m.eachLayer((layer) => {
      if (!layer._p || layer._cluster || !layer.getTooltip?.() || !layer.getLatLng) return;
      const pt = m.latLngToContainerPoint(layer.getLatLng());
      if (pt.x < 300 || pt.x > Math.min(panelLeft - 190, innerWidth - 30) || pt.y < 260 || pt.y > innerHeight - 150) return;
      result.push({ x: Math.round(pt.x), y: Math.round(pt.y), type: layer._p.type });
    });
    return result;
  });
  for (const point of candidates.slice(0, 40)) {
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(300);
    const tooltip = await page.evaluate(() => {
      const el = [...document.querySelectorAll(".leaflet-tooltip:not(.area-label)")].find((x) => x.offsetWidth > 0);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const panelLeft = document.querySelector("#analysisPanel")?.getBoundingClientRect().left ?? innerWidth;
      return {
        textPresent: !!el.textContent.trim(),
        position: ["top", "bottom", "left", "right", "center"].find((d) => el.classList.contains("leaflet-tooltip-" + d)) || "unknown",
        background: getComputedStyle(el).backgroundColor, foreground: getComputedStyle(el).color,
        border: getComputedStyle(el).borderTopColor, arrowTop: getComputedStyle(el, "::before").borderTopColor,
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        fullyVisibleInMap: r.x >= 242 && r.y >= 100 && r.right <= panelLeft - 2 && r.bottom <= innerHeight - 80,
      };
    });
    if (tooltip?.textPresent && tooltip.fullyVisibleInMap) {
      return { trigger: "hover on visible application POI layer", category: point.type, point: [point.x, point.y], ...tooltip };
    }
    await page.mouse.move(1100, 850);
    await page.waitForTimeout(450);
  }
  throw new Error("No fully visible bound application tooltip appeared on hover");
}async function clickZoomOnce(page) {
  await page.locator(".leaflet-control-zoom-in").click();
  await page.waitForTimeout(450);
  return await page.evaluate(() => eval("map").getZoom());
}
async function observeZoomOutDisabled(page) {
  const button = page.locator(".leaflet-control-zoom-out");
  let clicks = 0;
  let noZoomChange = false;
  while (clicks < 30 && !(await button.evaluate((e) => e.classList.contains("leaflet-disabled")))) {
    const before = await page.evaluate(() => eval("map").getZoom());
    const minimum = await page.evaluate(() => eval("map").getMinZoom());
    if (before <= minimum) break;
    const zoomEnd = page.evaluate(() => new Promise((resolve) => {
      const leafMap = eval("map");
      const timer = setTimeout(() => { leafMap.off("zoomend", onEnd); resolve(null); }, 3000);
      const onEnd = () => { clearTimeout(timer); resolve(leafMap.getZoom()); };
      leafMap.once("zoomend", onEnd);
    }));
    await button.click();
    const endedAt = await zoomEnd;
    if (endedAt == null || endedAt >= before) {
      noZoomChange = true;
      break;
    }
    clicks++;
  }
  const boundary = await page.evaluate(() => ({ current: eval("map").getZoom(), minimum: eval("map").getMinZoom() }));
  if (boundary.current <= boundary.minimum && !(await button.evaluate((e) => e.classList.contains("leaflet-disabled")))) {
    await button.click();
    await page.waitForTimeout(500);
    noZoomChange = (await page.evaluate(() => eval("map").getZoom())) === boundary.current;
  }
  const rendered = await button.evaluate((e) => ({
    disabledClass: e.classList.contains("leaflet-disabled"),
    ariaDisabled: e.getAttribute("aria-disabled"),
    foreground: getComputedStyle(e).color,
    background: getComputedStyle(e).backgroundColor,
  }));
  const zoom = await page.evaluate(() => ({
    current: eval("map").getZoom(), minimum: eval("map").getMinZoom(),
    layerZoomBounds: (() => {
      const bounds = [];
      eval("map").eachLayer((layer) => {
        if (layer.options && (layer.options.minZoom != null || layer.options.maxZoom != null)) {
          bounds.push({ minZoom: layer.options.minZoom ?? null, maxZoom: layer.options.maxZoom ?? null });
        }
      });
      return bounds;
    })(),
  }));
  return { clicksToDisabled: clicks, noZoomChange, zoom, ...rendered };
}
async function focusZoomByKeyboard(page) {
  await page.evaluate(() => document.activeElement?.blur());
  for (let i = 0; i < 250; i++) {
    await page.keyboard.press("Tab");
    const state = await page.evaluate(() => {
      const e = document.activeElement;
      return {
        hit: e?.classList?.contains("leaflet-control-zoom-in") && e.matches(":focus-visible"),
        target: e?.getAttribute("aria-label"),
        focusVisible: e?.matches(":focus-visible") || false,
        outline: getComputedStyle(e).outline,
        separation: getComputedStyle(e).boxShadow,
      };
    });
    if (state.hit) return state;
  }
  throw new Error("Could not reach Zoom in with keyboard Tab navigation");
}
async function focusAttributionByKeyboard(page) {
  await page.evaluate(() => document.activeElement?.blur());
  for (let i = 0; i < 250; i++) {
    await page.keyboard.press("Tab");
    const state = await page.evaluate(() => {
      const e = document.activeElement;
      return {
        hit: !!e?.closest(".leaflet-control-attribution") && e.matches(":focus-visible"),
        target: e?.textContent?.trim(),
        focusVisible: e?.matches(":focus-visible") || false,
        outline: getComputedStyle(e).outline,
        separation: getComputedStyle(e).boxShadow,
      };
    });
    if (state.hit) return state;
  }
  throw new Error("Could not reach attribution link with keyboard Tab navigation");
}
async function stateStyles(page) {
  return await page.evaluate(() => {
    const style = (selector) => {
      const e = document.querySelector(selector);
      if (!e) return null;
      const s = getComputedStyle(e), r = e.getBoundingClientRect();
      return { background: s.backgroundColor, foreground: s.color, border: s.borderColor,
        shadow: s.boxShadow, outline: s.outline, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
    };
    const attr = document.querySelector(".leaflet-control-attribution");
    const tooltip = [...document.querySelectorAll(".leaflet-tooltip")].find((e) => e.offsetWidth && !e.classList.contains("area-label")) ||
      document.querySelector(".leaflet-tooltip.area-label");
    return {
      documentLanguage: document.documentElement.lang, basemap: document.querySelector("#basemapSelect")?.value,
      tileCount: document.querySelectorAll(".leaflet-tile").length,
      loadedTileCount: [...document.querySelectorAll(".leaflet-tile")].filter((e) => e.complete && e.naturalWidth > 0).length,
      mapBackground: style("#map"),
      attribution: attr ? {
        background: getComputedStyle(attr).backgroundColor, foreground: getComputedStyle(attr).color,
        rect: [Math.round(attr.getBoundingClientRect().x), Math.round(attr.getBoundingClientRect().y), Math.round(attr.getBoundingClientRect().width), Math.round(attr.getBoundingClientRect().height)],
        link: style(".leaflet-control-attribution a"),
        linkFocusOutline: getComputedStyle(document.querySelector(".leaflet-control-attribution a")).outline,
        responsiveMaxWidth: getComputedStyle(attr).maxWidth,
      } : null,
      zoom: style(".leaflet-control-zoom-in"), zoomOut: style(".leaflet-control-zoom-out"),
      tooltip: tooltip ? {
        className: tooltip.className, textPresent: !!tooltip.textContent.trim(),
        background: getComputedStyle(tooltip).backgroundColor, foreground: getComputedStyle(tooltip).color,
        border: getComputedStyle(tooltip).borderTopColor, arrowTop: getComputedStyle(tooltip, "::before").borderTopColor,
        rect: [Math.round(tooltip.getBoundingClientRect().x), Math.round(tooltip.getBoundingClientRect().y), Math.round(tooltip.getBoundingClientRect().width), Math.round(tooltip.getBoundingClientRect().height)],
      } : null,
      areaLabel: style(".area-label"),
      areaLabelB: document.querySelector(".area-label-b b") ? getComputedStyle(document.querySelector(".area-label-b b")).color : null,
    };
  });
}
async function save(page, file, state, interaction, rows) {
  const target = path.join(ROOT, "screenshots", file);
  await page.screenshot({ path: target, animations: "disabled" });
  const bytes = await readFile(target);
  rows.push({
    file: `screenshots/${file}`, sha256: digest(bytes), bytes: bytes.length,
    viewport: await page.evaluate(() => [innerWidth, innerHeight]),
    language: state.language, basemap: state.basemap, mode: state.mode || "PLACE", chrome: state.chrome, interaction,
    rendered: await stateStyles(page),
  });
}

await mkdir(path.join(ROOT, "screenshots"), { recursive: true });
const snapshot = await assertSnapshot();
const browser = await chromium.launch({ headless: true });
const browserVersion = browser.version(), captures = [], notes = [];
try {
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "en-GB" });
    const page = await openMap(context);
    await save(page, "01-dark-reference-desktop-en-light.png",
      { language: "en", basemap: "light", chrome: "shipped-dark" },
      ["fresh production load", "Light basemap already selected", "no injected CSS"], captures);
    await page.locator(".leaflet-control-zoom-in").hover();
    notes.push({ name: "Dark zoom hover", effective: await page.locator(".leaflet-control-zoom-in").evaluate((e) => ({
      background: getComputedStyle(e).backgroundColor, foreground: getComputedStyle(e).color,
    })) });
    await page.locator(".leaflet-control-attribution a").first().hover();
    notes.push({ name: "Dark attribution link hover", effective: await page.locator(".leaflet-control-attribution a").first().evaluate((e) => ({
      color: getComputedStyle(e).color, decoration: getComputedStyle(e).textDecorationLine,
    })) });
    notes.push({ name: "Dark top tooltip", tooltip: await hoverBoundTooltip(page) });
    notes.push({ name: "Dark zoom-out lower-bound probe", state: await observeZoomOutDisabled(page) });
    await context.close();
  }
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "es-ES" });
    const page = await openMap(context);
    await installLightMapPreview(page);
    await selectState(page, "es", "light");
    await page.locator("#modeCompareButton").click();
    await page.waitForFunction(() => document.querySelector("#analysisPanel")?.dataset.mode === "COMPARE");
    const zoomLevel = await clickZoomOnce(page), tooltip = await hoverBoundTooltip(page);
    await save(page, "02-light-desktop-es-light-zoom-tooltip.png",
      { language: "es", basemap: "light", mode: "COMPARE", chrome: "simulated-light" },
      ["select Espaأ±ol", "select Light آ· CARTO Positron", "click Zoom in once", "hover visible application POI layer until top tooltip is fully inside map viewport"], captures);
    await page.locator(".leaflet-control-zoom-in").hover();
    notes.push({ name: "Light zoom hover", effective: await page.locator(".leaflet-control-zoom-in").evaluate((e) => ({
      background: getComputedStyle(e).backgroundColor, foreground: getComputedStyle(e).color,
    })) });
    const focus = await focusZoomByKeyboard(page);
    notes.push({ name: "Light zoom keyboard focus", keyboardFocus: focus });
    notes.push({ name: "Light desktop interaction", zoomLevel, tooltip });
    await page.locator(".leaflet-control-attribution a").first().hover();
    notes.push({ name: "Light attribution link hover", effective: await page.locator(".leaflet-control-attribution a").first().evaluate((e) => ({
      color: getComputedStyle(e).color, decoration: getComputedStyle(e).textDecorationLine,
    })) });
    notes.push({ name: "Light zoom-out lower-bound probe", state: await observeZoomOutDisabled(page) });
    await context.close();
  }
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "en-GB" });
    const page = await openMap(context);
    await installLightMapPreview(page);
    await selectState(page, "en", "dark");
    const zoomLevel = await clickZoomOnce(page), focus = await focusAttributionByKeyboard(page);
    await page.mouse.move(1180, 760);
    await save(page, "03-light-desktop-en-dark-attribution-focus.png",
      { language: "en", basemap: "dark", chrome: "simulated-light" },
      ["select English", "select Dark آ· CARTO Dark Matter", "click Zoom in once", "keyboard Tab traversal to a real attribution link (:focus-visible)"], captures);
    notes.push({ name: "Attribution keyboard focus", zoomLevel, keyboardFocus: focus });
    await context.close();
  }
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "es-ES" });
    const page = await openMap(context);
    await installLightMapPreview(page);
    await selectMobileState(page, "es", "satellite");
    const zoomLevel = await clickZoomOnce(page);
    const sizes = await page.evaluate(() => [...document.querySelectorAll(".leaflet-control-zoom a")].map((e) => {
      const r = e.getBoundingClientRect(), s = getComputedStyle(e);
      return { aria: e.getAttribute("aria-label"), width: Math.round(r.width), height: Math.round(r.height), minWidth: s.minWidth, minHeight: s.minHeight };
    }));
    await save(page, "04-light-mobile-es-satellite.png",
      { language: "es", basemap: "satellite", chrome: "simulated-light" },
      ["mobile viewport with coarse pointer", "open Layers through visible mobile button", "open Map display disclosure", "select Espaأ±ol and Satellite + labels آ· Esri", "close Layers", "click Zoom in once"], captures);
    notes.push({ name: "Coarse-pointer zoom targets", zoomLevel, controls: sizes });
    await context.close();
  }
  const metadata = {
    title: "UX-T1 T-a4 bounded map-chrome evidence",
    sourceSnapshot: snapshot, browser: { engine: "Chromium", version: browserVersion },
    lightPreview: {
      type: "temporary CSS injection in Playwright page only", productionAssetsChanged: false,
      geometryChanged: false, markerColorsChanged: false, basemapTilesOrLENS_BASEMAP_STYLESChanged: false,
      focus: {
        dark: "current shared application treatment: 2px #9bd5ff outline, 3px offset, 1px #08101a separation",
        light: "test-only map focus: 2px #0a63c7 outline, 3px offset, 1px #f4f6f9 separation",
      },
      unsupported: [
        "Only top-directed POI tooltips were exercised; bottom/left/right Leaflet arrows remain provider defaults (white), although visible POI/cluster tooltips are bound top. A B area label appeared in the Light/COMPARE capture with #00718f text; this is one rendered sample only, not validation across tile backgrounds or Dark appearance.",
        "A real zoom-out sequence reached Leaflet map zoom 0 and applied .leaflet-disabled / aria-disabled=true in both Dark and simulated Light. Dark keeps white disabled text because the app's #fff !important masks Leaflet gray; Light preview disabled text is #667586 and measures 4.28:1 on its hover surface.",
        "Open-data tile imagery is live and may change independently of this pinned application snapshot.",
        "T-a3 center-marker and SVG-halo colors remain shipped Dark values by design; this evidence does not validate those marks for Light.",
      ],
    },
    screenshots: captures, observations: notes,
    caveats: [
      "Simulated Light map chrome only; the rest of the application remains in its shipped Dark appearance.",
      "Screenshot sampling and contrast arithmetic are bounded observations, not a WCAG conformance claim over heterogeneous map imagery.",
      "Chromium desktop/mobile emulation is not physical iPad or Safari testing.",
      "No Phase B appearance أ— basemap أ— information-surface Cartesian matrix was run.",
    ],
  };
  await writeFile(path.join(ROOT, "capture-metadata.json"), JSON.stringify(metadata, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({
    sourceSnapshot: snapshot,
    screenshots: captures.map(({ file, sha256, bytes, viewport, language, basemap, interaction }) =>
      ({ file, sha256, bytes, viewport, language, basemap, interaction })),
    observations: notes,
  }, null, 2));
} finally { await browser.close(); }
