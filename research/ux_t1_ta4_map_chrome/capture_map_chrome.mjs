import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { promoteVerifiedCapturePackage } from "./capture_package.mjs";

const PACKAGE_PARENT = path.dirname(fileURLToPath(import.meta.url));
const RUN_ID = `${Date.now()}-${process.pid}`;
const ROOT = path.join(PACKAGE_PARENT, `.capture-staging-${RUN_ID}`);
const CURRENT = path.join(PACKAGE_PARENT, "capture-current");
const BACKUP = path.join(PACKAGE_PARENT, `.capture-previous-${RUN_ID}`);
const REQUIRED_SCREENSHOTS = [
  "screenshots/01-dark-reference-desktop-en-light.png",
  "screenshots/02-light-desktop-es-light-zoom-tooltip.png",
  "screenshots/03-light-desktop-en-dark-attribution-focus.png",
  "screenshots/04-light-mobile-es-satellite.png",
  "screenshots/05-light-desktop-en-satellite-top-tooltip.png",
];
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
  --map-fallback-surface: #f4f6f9;
  --map-attribution-surface: rgba(255,255,255,.92);
  --map-attribution-text: #445468;
  --map-attribution-link: #0a63c7;
  --map-zoom-surface: #fff;
  --map-zoom-text: #16222f;
  --map-zoom-edge: #74808e;
  --map-zoom-hover-surface: #f2f4f7;
  --map-zoom-disabled-text: #667586;
  --map-zoom-disabled-opacity: 1;
  --map-zoom-shadow: 0 8px 24px rgba(16,24,34,.18);
  --map-tooltip-surface: rgba(255,255,255,.96);
  --map-tooltip-text: #16222f;
  --map-tooltip-edge: #74808e;
  --map-tooltip-arrow: #74808e;
  --map-tooltip-shadow: 0 10px 28px rgba(16,24,34,.18);
  --map-label-surface: rgba(255,255,255,.94);
  --map-label-text: #16222f;
  --map-label-edge: #74808e;
  --map-label-shadow: 0 6px 18px rgba(16,24,34,.16);
  --map-label-b-edge: #00718f;
  --map-label-b-text: #00718f;
}
#map, .leaflet-container { background: var(--map-fallback-surface) !important; }
.leaflet-control-attribution {
  background: var(--map-attribution-surface) !important;
  color: var(--map-attribution-text) !important;
}
.leaflet-control-attribution a,
.leaflet-control-attribution a:hover { color: var(--map-attribution-link) !important; text-decoration: underline; text-underline-offset: 2px; }
.leaflet-control-zoom { box-shadow: var(--map-zoom-shadow) !important; }
.leaflet-control-zoom a {
  background: var(--map-zoom-surface) !important;
  color: var(--map-zoom-text) !important;
  border-color: var(--map-zoom-edge) !important;
}
.leaflet-control-zoom a:hover {
  background: var(--map-zoom-hover-surface) !important;
  color: var(--map-zoom-text) !important;
}
.leaflet-control-zoom a.leaflet-disabled { color: var(--map-zoom-disabled-text) !important; opacity: var(--map-zoom-disabled-opacity); }
.leaflet-tooltip {
  background: var(--map-tooltip-surface) !important;
  border-color: var(--map-tooltip-edge) !important;
  color: var(--map-tooltip-text) !important;
  box-shadow: var(--map-tooltip-shadow) !important;
}
.leaflet-tooltip-top:before { border-top-color: var(--map-tooltip-arrow) !important; }
.area-label {
  background: var(--map-label-surface) !important;
  border-color: var(--map-label-edge) !important;
  color: var(--map-label-text) !important;
  box-shadow: var(--map-label-shadow) !important;
}
.area-label-b { border-color: var(--map-label-b-edge) !important; }
.area-label-b b { color: var(--map-label-b-text) !important; }
`;
const DARK_ATTRIBUTION_FIX_CSS = `
.leaflet-control-attribution { color: #aab9ca !important; }
.leaflet-control-attribution a { text-decoration: underline; text-underline-offset: 2px; }
.leaflet-control-zoom a.leaflet-disabled { opacity: .56; }
`;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rgbHex = (rgb) => `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
function luminance(rgb) {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
}
function contrastRatio(first, second) {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
function decodePngRgb(bytes) {
  let offset = 8, width, height, bitDepth, colorType;
  const imageData = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === "IDAT") imageData.push(data);
    else if (type === "IEND") break;
    offset += length + 12;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!width || !height || bitDepth !== 8 || !channels) throw new Error("Unsupported browser screenshot PNG encoding");
  const stride = width * channels, raw = inflateSync(Buffer.concat(imageData));
  const pixels = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const source = y * (stride + 1), filter = raw[source], row = y * stride, above = row - stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? pixels[row + i - channels] : 0;
      const up = y ? pixels[above + i] : 0;
      const upperLeft = y && i >= channels ? pixels[above + i - channels] : 0;
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up :
        filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, upperLeft) : null;
      if (prediction == null) throw new Error(`Unsupported PNG filter ${filter}`);
      pixels[row + i] = (raw[source + 1 + i] + prediction) & 255;
    }
  }
  return { width, height, channels, pixels };
}
function modalRenderedRgb(png) {
  const { width, height, channels, pixels } = decodePngRgb(png), counts = new Map();
  for (let y = 3; y < height - 3; y++) for (let x = 3; x < width - 3; x++) {
    const at = (y * width + x) * channels;
    const key = `${pixels[at]},${pixels[at + 1]},${pixels[at + 2]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const [key] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (!key) throw new Error("Rendered surface screenshot has no sampleable interior");
  return key.split(",").map(Number);
}
async function renderedAttributionSurfaceRgb(page) {
  const style = await page.addStyleTag({ content: `
    .leaflet-control-attribution { color: transparent !important; text-shadow: none !important; }
    .leaflet-control-attribution a[href] { color: transparent !important; text-decoration: none !important; text-shadow: none !important; }
  ` });
  try {
    const bytes = await page.locator(".leaflet-control-attribution").screenshot({ animations: "disabled" });
    return modalRenderedRgb(bytes);
  } finally { await style.evaluate((element) => element.remove()); }
}
async function renderedTooltipSurfaceRgb(page) {
  const style = await page.addStyleTag({ content: `
    .leaflet-tooltip:not(.area-label), .leaflet-tooltip:not(.area-label) * {
      color: transparent !important; text-shadow: none !important;
    }
  ` });
  try {
    const bytes = await page.locator(".leaflet-tooltip:not(.area-label):visible").first()
      .screenshot({ animations: "disabled" });
    return modalRenderedRgb(bytes);
  } finally { await style.evaluate((element) => element.remove()); }
}
async function topArrowAdjacentRgb(page) {
  const point = await page.locator(".leaflet-tooltip-top:not(.area-label):visible").first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.bottom + 7) };
  });
  const screenshot = decodePngRgb(await page.screenshot({ animations: "disabled" }));
  if (point.x < 0 || point.y < 0 || point.x >= screenshot.width || point.y >= screenshot.height) {
    throw new Error("Top-arrow adjacent sample is outside the rendered viewport");
  }
  const at = (point.y * screenshot.width + point.x) * screenshot.channels;
  return { point: [point.x, point.y], rgb: [0, 1, 2].map((channel) => screenshot.pixels[at + channel]) };
}
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
async function installDarkAttributionCorrection(page) { await page.addStyleTag({ content: DARK_ATTRIBUTION_FIX_CSS }); }
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
  if (boundary.current <= boundary.minimum && await button.evaluate((e) => e.classList.contains("leaflet-disabled"))) {
    const bounds = await button.boundingBox();
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.waitForTimeout(250);
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

const snapshot = await assertSnapshot();
await mkdir(path.join(ROOT, "screenshots"), { recursive: true });
const browser = await chromium.launch({ headless: true });
const browserVersion = browser.version(), captures = [], notes = [], lightTooltipSamples = [], lightArrowSamples = [];
try {
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "en-GB" });
    const page = await openMap(context);
    await installDarkAttributionCorrection(page);
    const darkAttributionSamples = [];
    for (const basemap of ["light", "dark", "satellite"]) {
      if (basemap !== "light") await selectState(page, "en", basemap);
      const background = await renderedAttributionSurfaceRgb(page);
      const foreground = [170, 185, 202];
    const linkForeground = [185, 199, 215];
      darkAttributionSamples.push({
        basemap, foreground: rgbHex(foreground), sampledBackground: rgbHex(background),
        contrast: Number(contrastRatio(foreground, background).toFixed(2)),
      linkForeground: rgbHex(linkForeground), linkContrast: Number(contrastRatio(linkForeground, background).toFixed(2)),
      });
    }
    await selectState(page, "en", "light");
    notes.push({
      name: "Dark attribution rendered contrast samples",
      method: "modal pixel from actual attribution background with link/text glyphs temporarily hidden; live tiles; screenshot crops were not retained",
      samples: darkAttributionSamples,
    });
    await save(page, "01-dark-reference-desktop-en-light.png",
      { language: "en", basemap: "light", chrome: "dark-attribution-correction-preview" },
      ["pinned production source snapshot", "sampled corrected attribution over Light, Dark and Satellite tiles", "restored Light basemap", "test-only Dark attribution text correction and persistent link underline"], captures);
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
    const tooltipSurface = await renderedTooltipSurfaceRgb(page);
    lightTooltipSamples.push({ basemap: "light", foreground: "#16222f", sampledBackground: rgbHex(tooltipSurface),
      contrast: Number(contrastRatio([22, 34, 47], tooltipSurface).toFixed(2)) });
    const arrowSample = await topArrowAdjacentRgb(page);
    lightArrowSamples.push({ basemap: "light", foreground: "#74808e", sampledAdjacent: rgbHex(arrowSample.rgb),
      contrast: Number(contrastRatio([116, 128, 142], arrowSample.rgb).toFixed(2)), point: arrowSample.point });
    await save(page, "02-light-desktop-es-light-zoom-tooltip.png",
      { language: "es", basemap: "light", mode: "COMPARE", chrome: "simulated-light" },
      ["select Spanish", "select Light / CARTO Positron", "click Zoom in once", "hover visible application POI layer until top tooltip is fully inside map viewport"], captures);
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
    const zoomLevel = await clickZoomOnce(page), tooltip = await hoverBoundTooltip(page);
    const tooltipSurface = await renderedTooltipSurfaceRgb(page);
    lightTooltipSamples.push({ basemap: "dark", foreground: "#16222f", sampledBackground: rgbHex(tooltipSurface),
      contrast: Number(contrastRatio([22, 34, 47], tooltipSurface).toFixed(2)) });
    const focus = await focusAttributionByKeyboard(page);
    await save(page, "03-light-desktop-en-dark-attribution-focus.png",
      { language: "en", basemap: "dark", chrome: "simulated-light" },
      ["select English", "select Dark / CARTO Dark Matter", "click Zoom in once", "keyboard Tab traversal to a real attribution link (:focus-visible)"], captures);
    notes.push({ name: "Dark-basemap Light chrome interaction", zoomLevel, tooltip, keyboardFocus: focus });
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
      ["mobile viewport with coarse pointer", "open Layers through visible mobile button", "open Map display disclosure", "select Spanish and Satellite with labels / Esri", "close Layers", "click Zoom in once"], captures);
    notes.push({ name: "Coarse-pointer zoom targets", zoomLevel, controls: sizes });
    await context.close();
  }
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "en-GB" });
    const page = await openMap(context);
    await installLightMapPreview(page);
    await selectState(page, "en", "satellite");
    const zoomLevel = await clickZoomOnce(page), tooltip = await hoverBoundTooltip(page);
    const tooltipSurface = await renderedTooltipSurfaceRgb(page);
    lightTooltipSamples.push({ basemap: "satellite", foreground: "#16222f", sampledBackground: rgbHex(tooltipSurface),
      contrast: Number(contrastRatio([22, 34, 47], tooltipSurface).toFixed(2)) });
    const arrowSample = await topArrowAdjacentRgb(page);
    lightArrowSamples.push({ basemap: "satellite", foreground: "#74808e", sampledAdjacent: rgbHex(arrowSample.rgb),
      contrast: Number(contrastRatio([116, 128, 142], arrowSample.rgb).toFixed(2)), point: arrowSample.point });
    await save(page, "05-light-desktop-en-satellite-top-tooltip.png",
      { language: "en", basemap: "satellite", chrome: "simulated-light" },
      ["select English", "select Satellite basemap", "click Zoom in once", "hover a real POI tooltip to inspect the top arrow against satellite tiles"], captures);
    notes.push({ name: "Satellite top tooltip", zoomLevel, tooltip });
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
        light: "reuse the existing T-a2 --chrome-focus-ring-color and --chrome-focus-separation-color; no map-specific focus override",
      },
      unsupported: [
        "Only top-directed POI tooltips were exercised; bottom/left/right Leaflet arrows remain provider defaults. The Light arrow is redundant with the pointer-held feature association; its sampled adjacent Light-basemap contrast was 2.17:1, so no tile-independent edge-conformance claim is made. A B area label appeared in the Light/COMPARE capture; both A and B labels were not sampled over every basemap.",
        "A real zoom-out sequence reached map zoom 0; a pointer click on the .leaflet-disabled / aria-disabled=true control left the map at zoom 0 in both modes. Light #667586 on #f2f4f7 is 4.28:1; WCAG exempts genuinely inactive components from the 4.5:1 text contrast requirement. Dark uses opacity .56 because the app's important active colors mask Leaflet's default disabled colors.",
        "Open-data tile imagery is live and may change independently of this pinned application snapshot.",
        "T-a3 center-marker and SVG-halo colors remain shipped Dark values by design; this evidence does not validate those marks for Light.",
      ],
    },
    screenshots: captures, observations: notes,
    caveats: [
      "Simulated Light map chrome only; the rest of the application remains in its shipped Dark appearance.",
      "Screenshot sampling and contrast arithmetic are bounded observations, not a WCAG conformance claim over heterogeneous map imagery.",
      "Chromium desktop/mobile emulation is not physical iPad or Safari testing.",
      "No Phase B appearance by basemap by information-surface Cartesian matrix was run.",
    ],
  };
  notes.push({ name: "Light top-tooltip rendered text contrast", method: "modal pixel from real tooltip surface after hiding only text glyphs in an in-memory locator screenshot", samples: lightTooltipSamples });
  notes.push({ name: "Light top-arrow adjacent rendered samples", method: "single pixel 7 CSS px beyond the live top-arrow tip in an in-memory viewport screenshot; not retained", samples: lightArrowSamples });
  await writeFile(path.join(ROOT, "capture-metadata.json"), JSON.stringify(metadata, null, 2) + "\n", "utf8");
  await promoteVerifiedCapturePackage({
    stagingPath: ROOT, currentPath: CURRENT, backupPath: BACKUP,
    expectedSnapshot: snapshot, requiredFiles: REQUIRED_SCREENSHOTS,
  });
  console.log(JSON.stringify({
    sourceSnapshot: snapshot,
    screenshots: captures.map(({ file, sha256, bytes, viewport, language, basemap, interaction }) =>
      ({ file, sha256, bytes, viewport, language, basemap, interaction })),
    observations: notes,
  }, null, 2));
} catch (error) {
  await rm(ROOT, { recursive: true, force: true });
  throw error;
} finally { await browser.close(); }
