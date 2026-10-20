#!/usr/bin/env node
// Development-only evidence capture. No app styles or hidden states are injected.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const SOURCE_SHA = "028d0389454b4248180654075022e4397b14fd5b";
const DEPLOYMENT_MANIFEST_SHA = "bdbc5c1c85f9d9f47893b7444b824921a42245dfd3d0be362bb648be39006133";
const POI_SHA = "981449c5b52fac59835a826f89d163eae99d13a042a72acb80bcdc08acb88a70";
const SITE = "https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PACKAGE = path.join(ROOT, "research/ux_t1_ta0_minimum");
const SCREENSHOTS = path.join(PACKAGE, "screenshots");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fetchVerifiedDeployment() {
  const manifestResponse = await fetch(`${SITE}/data/deployment_manifest.json`, { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error(`Deployment manifest HTTP ${manifestResponse.status}`);
  const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer());
  if (sha256(manifestBytes) !== DEPLOYMENT_MANIFEST_SHA) throw new Error("Deployment manifest hash changed; stop and review.");
  const manifest = JSON.parse(manifestBytes);
  if (manifest.commit !== SOURCE_SHA || manifest.build_state !== "pass") {
    throw new Error(`Deployment/source mismatch: ${manifest.commit} (${manifest.build_state}); expected ${SOURCE_SHA} (pass).`);
  }
  const poiResponse = await fetch(`${SITE}/data/runtime_poi.json`, { cache: "no-store" });
  if (!poiResponse.ok) throw new Error(`Production POI HTTP ${poiResponse.status}`);
  const poiBytes = Buffer.from(await poiResponse.arrayBuffer());
  if (sha256(poiBytes) !== POI_SHA) throw new Error("Production POI SHA-256 changed; stop and review.");
  const poi = JSON.parse(poiBytes);
  if (poi.sourceMode !== "deployment-snapshot") throw new Error(`Unexpected POI sourceMode: ${poi.sourceMode}`);
  await fs.writeFile(path.join(ROOT, "data/runtime_poi.json"), poiBytes);
  return { manifest, manifestBytes, poi, poiBytes };
}

const MIME = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".geojson", "application/geo+json; charset=utf-8"], [".svg", "image/svg+xml"],
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".woff", "font/woff"], [".woff2", "font/woff2"], [".ico", "image/x-icon"],
]);

async function startLocalServer() {
  const server = createServer(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
    const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
    if (pathname === "/js/runtime-config.js") {
      // Pass through the currently deployed browser config without printing or storing it.
      const response = await fetch(`${SITE}/js/runtime-config.js`, { cache: "no-store" });
      res.writeHead(response.status, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      if (req.method === "HEAD") res.end(); else res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { res.writeHead(400).end(); return; }
    const target = path.resolve(ROOT, `.${decoded === "/" ? "/index.html" : decoded}`);
    if (target !== ROOT && !target.startsWith(`${ROOT}${path.sep}`)) { res.writeHead(403).end(); return; }
    try {
      const bytes = await fs.readFile(target);
      res.writeHead(200, { "content-type": MIME.get(path.extname(target).toLowerCase()) || "application/octet-stream", "cache-control": "no-store" });
      if (req.method === "HEAD") res.end(); else res.end(bytes);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

async function openApp(browser, baseUrl, viewport, language = "en") {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, locale: language === "es" ? "es-ES" : "en-US" });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.__ta0Errors = errors;
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => {
    const note = document.querySelector("#layerSourceNote")?.textContent || "";
    return note.includes("DEPLOYMENT SNAPSHOT");
  }, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  await page.locator("#languageSelect").selectOption(language);
  await page.waitForTimeout(200);
  return { page, errors };
}

async function stateOf(page) {
  return page.evaluate(() => {
    const box = (node) => {
      const r = node?.getBoundingClientRect();
      return r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null;
    };
    const visibleLensLabels = [...document.querySelectorAll(".cb-side-a .cb-lens,.cb-side-b .cb-lens")]
      .filter((node) => node.getClientRects().length).map((node) => node.textContent.trim());
    return {
      viewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: 1 },
      language: document.querySelector("#languageSelect")?.value || document.documentElement.lang,
      mode: document.querySelector("#analysisPanel")?.dataset.mode || null,
      basemap: document.querySelector("#basemapSelect")?.value || null,
      boundaries: document.querySelector("#boundarySelect")?.value || null,
      mobileLayersExpanded: document.querySelector("#mobileLayersButton")?.getAttribute("aria-expanded") === "true",
      deploymentSnapshotLabelPresent: document.querySelector("#layerSourceNote")?.textContent.includes("DEPLOYMENT SNAPSHOT") || false,
      visibleLensLabels,
      poiClusters: document.querySelectorAll(".poi-cluster-icon").length,
      evidenceDrawerOpen: !!document.querySelector("#evidenceDrawer")?.open,
      planningCode: document.querySelector("#planningCode")?.textContent.trim() || null,
      planningIdentityVisible: !!document.querySelector("#planningIdentity") && !document.querySelector("#planningIdentity").hidden,
      mapBox: box(document.querySelector("#map")),
      layerRailBox: box(document.querySelector("#layerRail")),
      activeElement: document.activeElement ? {
        tag: document.activeElement.tagName,
        id: document.activeElement.id || null,
        text: (document.activeElement.getAttribute("aria-label") || document.activeElement.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
        focusVisible: document.activeElement.matches(":focus-visible"),
      } : null,
    };
  });
}

async function computed(page, selectors) {
  return page.evaluate((wanted) => wanted.map(({ selector, pseudo = null, note = null }) => {
    const node = document.querySelector(selector);
    if (!node) return { selector, pseudo, note, present: false };
    const s = getComputedStyle(node, pseudo);
    const rect = node.getBoundingClientRect();
    const focusStyle = selector.includes(":focus-visible") || selector === "#haloToggle";
    const styleKeys = ["color","backgroundColor","borderTopColor","borderTopWidth","borderTopStyle","boxShadow","backdropFilter","fontSize","lineHeight","fontWeight","borderRadius","display","opacity"];
    if (focusStyle) styleKeys.push("outlineColor","outlineStyle","outlineWidth","outlineOffset");
    return {
      selector, pseudo, note, present: true, visible: node.getClientRects().length > 0 && s.display !== "none",
      text: (node.getAttribute("aria-label") || node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 100),
      computed: Object.fromEntries(styleKeys.map((key) => [key, s[key]])),
      box: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  }), selectors);
}

async function openMapDisplayIfCollapsed(page) {
  if (!(await page.locator("#basemapSelect").isVisible())) {
    await page.locator('details[data-rail-group="map"] > summary').click();
  }
}

async function main() {
  await fs.rm(SCREENSHOTS, { recursive: true, force: true });
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  const { manifest: deployment, manifestBytes, poi, poiBytes } = await fetchVerifiedDeployment();
  const { server, url } = await startLocalServer();
  const browser = await chromium.launch({ headless: true });
  const screenshots = [];
  const computedRecords = [];
  const capture = async (id, file, page, actions, extra = {}) => {
    await page.waitForTimeout(1000);
    const filePath = path.join(SCREENSHOTS, file);
    await page.screenshot({ path: filePath, fullPage: false, animations: "disabled" });
    const bytes = await fs.readFile(filePath);
    screenshots.push({ id, file: `screenshots/${file}`, sha256: sha256(bytes), bytes: bytes.length, ...await stateOf(page), actions, pageErrors: page.__ta0Errors, ...extra });
  };
  try {
    // 1 — desktop PLACE, light basemap.
    let opened = await openApp(browser, url, { width: 1440, height: 900 });
    let page = opened.page;
    await capture("desktop-place-light", "01-desktop-place-light.png", page, ["loaded default PLACE state", "production deployment snapshot verified"]);
    computedRecords.push({ state: "desktop-place-light", viewport: { width: 1440, height: 900 }, styles: await computed(page, [
      { selector: "body", note: "shared page chrome" }, { selector: ".brand", note: "header surface" },
      { selector: ".left", note: "map layer rail" }, { selector: "#analysisPanel", note: "shared analysis panel" },
      { selector: ".badge.register", note: "representative administrative evidence badge" },
      { selector: ".badge.snapshot", note: "snapshot fallback badge; absent when production snapshot is available" },
    ]) });
    await page.locator("#modeCompareButton").click();
    await page.waitForFunction(() => document.querySelector("#analysisPanel")?.dataset.mode === "COMPARE");
    await page.locator("#compareDetail > summary").click();
    await page.locator(".cmp-metric-focus").first().click();
    await page.mouse.move(1200, 500);
    await page.mouse.wheel(0, -5000);
    await page.waitForFunction(() => ["#cbLensALabel", "#cbLensBLabel"].every((selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight;
    }));
    await capture("desktop-compare-light", "02-desktop-compare-light.png", page, ["clicked COMPARE mode control", "opened Detail disclosure", "selected the first visible comparison metric to render the A/B bridge"]);
    computedRecords.push({ state: "desktop-compare-light", viewport: { width: 1440, height: 900 }, styles: await computed(page, [
      { selector: ".cb-side-a .cb-lens", note: "Lens A panel identity label" },
      { selector: ".cb-side-b .cb-lens", note: "Lens B panel identity label" },
      { selector: ".badge.observed", note: "observed evidence badge, if present in current reading" },
      { selector: ".halo-toggle input", note: "native comparison-halo checkbox" },
    ]) });
    await page.close();

    opened = await openApp(browser, url, { width: 1440, height: 900 }, "es"); page = opened.page;
    await page.locator("#evidenceDrawer").waitFor({ state: "hidden" });
    await page.locator('.evidence-route[data-evidence-mode="PLACE"]').click();
    await page.locator("#evidenceDrawer").waitFor({ state: "visible" });
    await capture("desktop-evidence-drawer-es", "03-desktop-evidence-drawer-es.png", page, ["selected Español in the visible language selector", "clicked the visible Evidence & limits route"]);
    computedRecords.push({ state: "desktop-evidence-drawer-es", viewport: { width: 1440, height: 900 }, styles: await computed(page, [
      { selector: "#evidenceDrawer", note: "native modal dialog surface" },
      { selector: "#evidenceDrawer", pseudo: "::backdrop", note: "native dialog backdrop" },
    ]) });
    await page.close();

    // 2 — tablet COMPARE, Dark basemap selected in visible Layers UI.
    opened = await openApp(browser, url, { width: 834, height: 1112 }); page = opened.page;
    await openMapDisplayIfCollapsed(page);
    await page.locator("#basemapSelect").selectOption("dark");
    await page.locator("#modeCompareButton").click();
    await capture("tablet-compare-dark", "04-tablet-compare-dark.png", page, ["selected Dark basemap in the visible map-layer rail", "clicked COMPARE mode"]);
    await page.close();

    // 3 — mobile PLACE, Light basemap.
    opened = await openApp(browser, url, { width: 390, height: 844 }); page = opened.page;
    await capture("mobile-place-light", "05-mobile-place-light.png", page, ["loaded default PLACE state"]);
    await page.close();

    // 4 — mobile Layers expanded, then actual basemap selector interaction.
    opened = await openApp(browser, url, { width: 390, height: 844 }); page = opened.page;
    await page.locator("#mobileLayersButton").click();
    await openMapDisplayIfCollapsed(page);
    await page.locator("#basemapSelect").selectOption("dark");
    if ((await page.locator("#mobileLayersButton").getAttribute("aria-expanded")) !== "true") throw new Error("Mobile Layers control did not stay expanded.");
    await capture("mobile-layers-dark", "06-mobile-layers-dark.png", page, ["clicked mobile Layers button", "selected Dark basemap through visible Layers UI"]);
    await page.close();

    // 5 — desktop Satellite with operational markers and official district outlines.
    opened = await openApp(browser, url, { width: 1440, height: 900 }); page = opened.page;
    await openMapDisplayIfCollapsed(page);
    await page.locator("#basemapSelect").selectOption("satellite");
    await page.locator("#boundarySelect").selectOption("district");
    await page.locator('details[data-rail-group="context"] > summary').click();
    await page.locator('[data-layer="park"]').locator("xpath=..").click();
    await capture("desktop-satellite-markers-overlays", "07-desktop-satellite-markers-overlays.png", page, ["selected Satellite + labels in base-map selector", "selected district outlines", "opened Context group and clicked Principal parks switch label"], { additionalControls: { principalParks: await page.locator('[data-layer="park"]').isChecked() } });
    await page.close();

    // 6 — focused Chromium keyboard probe on a visible native checkbox.
    opened = await openApp(browser, url, { width: 1440, height: 900 }); page = opened.page;
    await page.locator("#modeCompareButton").click();
    let haloReached = false;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => document.activeElement?.id === "haloToggle")) { haloReached = true; break; }
    }
    if (!haloReached) throw new Error("Keyboard Tab path did not reach the comparison-halo checkbox.");
    const focus = await page.evaluate(() => {
      const e = document.activeElement, s = getComputedStyle(e);
      return { tag: e.tagName, id: e.id, className: typeof e.className === "string" ? e.className : "", text: e.getAttribute("aria-label"), focusVisible: e.matches(":focus-visible"), outline: s.outline, outlineColor: s.outlineColor, outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle, outlineOffset: s.outlineOffset, boxShadow: s.boxShadow };
    });
    if (!focus.focusVisible) throw new Error("The keyboard-reached halo checkbox did not match :focus-visible.");
    await capture("keyboard-halo-checkbox-focus", "08-keyboard-halo-checkbox-focus.png", page, ["clicked COMPARE mode", "pressed Tab repeatedly from the mode control until the visible native Comparison halo checkbox received focus; no script focus() call"], { focus, historicalAnomaly: "HISTORICAL ANOMALY — NOT REPRODUCED" });
    computedRecords.push({ state: "keyboard-halo-checkbox-focus", viewport: { width: 1440, height: 900 }, styles: await computed(page, [{ selector: "#haloToggle", note: "real keyboard-focused native comparison-halo checkbox" }]) });
    await page.close();

    // 7 — real Lens A pointer drag to an interior point in official APE.03.06 geometry.
    // The point is the validated feature bbox centre; the app's own panel must resolve it.
    opened = await openApp(browser, url, { width: 1440, height: 900 }); page = opened.page;
    const start = { lat: 40.4149, lon: -3.69 }, target = { lat: 40.41384035, lon: -3.69162065 };
    const world = ({ lat, lon }) => {
      const z = 14, scale = 256 * (2 ** z), phi = lat * Math.PI / 180;
      return { x: (lon + 180) / 360 * scale, y: (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2 * scale };
    };
    const a = world(start), b = world(target), delta = { x: b.x - a.x, y: b.y - a.y };
    const marker = page.locator(".leaflet-marker-icon.leaflet-marker-draggable").first();
    const rect = await marker.boundingBox();
    if (!rect) throw new Error("Lens A draggable marker is unavailable.");
    const from = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 8 }); await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector("#planningIdentity")?.hidden && document.querySelector("#planningCode")?.textContent.trim() === "APE.03.06", null, { timeout: 10000 });
    await capture("desktop-place-inside-planning-ambito", "09-desktop-place-planning-ambito.png", page, ["dragged the visible Lens A marker with pointer input to validated interior coordinate", "application rendered APE.03.06 / JERÓNIMOS"] , { targetCoordinate: target });
    await page.close();

    const pageErrors = screenshots.flatMap((screenshot) => screenshot.pageErrors || []);
    if (pageErrors.length) throw new Error(`Browser page errors: ${JSON.stringify(pageErrors)}`);
    if (screenshots.length < 6 || screenshots.length > 9) throw new Error(`Unexpected screenshot count: ${screenshots.length}`);
    await fs.writeFile(path.join(PACKAGE, "screenshot-manifest.json"), JSON.stringify({
      schema: "ux-t1-ta0-minimum-visual-baseline/1.0",
      baselineSource: { repository: "soroushkarahrodi79-oss/madrid-tourism-intelligence-lens", commit: SOURCE_SHA, ref: "origin/main" },
      deployment: { manifestUrl: `${SITE}/data/deployment_manifest.json`, manifestSha256: sha256(manifestBytes), sourceCommit: deployment.commit, generatedAt: deployment.generated_at, buildState: deployment.build_state, workflowRunId: deployment.workflow_run, manifestUrlIsMutable: true, workflowArtifactRetentionDays: 30 },
      productionData: { url: `${SITE}/data/runtime_poi.json`, sha256: sha256(poiBytes), bytes: poiBytes.length, sourceMode: poi.sourceMode, generatedAt: poi.generatedAt, recordsByLayer: Object.fromEntries(Object.entries(poi.layers).map(([key, records]) => [key, records.length])), totalRecords: Object.values(poi.layers).reduce((sum, records) => sum + records.length, 0), storedInRepository: false },
      environment: { browser: "Chromium via Playwright", browserVersion: browser.version(), headless: true, deviceScaleFactor: 1, appServedFrom: "isolated worktree at baseline source commit", mapTiles: "live OSM/CARTO/Esri providers; tile content is not version-pinned", runtimeConfig: "proxied in memory from the current public deployment; never written to disk or emitted" },
      focusAnomaly: { result: "HISTORICAL ANOMALY — NOT REPRODUCED", conditions: "Chromium 153.0.8010.12 headless; isolated local source at baseline SHA; first-party production runtime config proxied in memory; actual keyboard Tab from COMPARE mode button to visible native #haloToggle checkbox; no styles injected; computed 2px solid rgb(155, 213, 255), 2px offset, and 1px box shadow. Cross-browser follow-up deferred to T-a2." },
      capturedAt: new Date().toISOString(), screenshots,
    }, null, 2) + "\n");
    await fs.writeFile(path.join(PACKAGE, "computed-styles.json"), JSON.stringify({
      schema: "ux-t1-ta0-computed-styles/1.0", sourceCommit: SOURCE_SHA, browser: "Chromium via Playwright", note: "Actual computed CSS values from the named rendered states. These are not WCAG conformance results and are separate from screenshot pixels and source declarations.", records: computedRecords,
    }, null, 2) + "\n");
    console.log(JSON.stringify({ screenshots: screenshots.map(({ id, file, sha256, bytes, viewport, mode, basemap, language, planningCode, focus }) => ({ id, file, sha256, bytes, viewport, mode, basemap, language, planningCode, focus: focus?.outline })), browser: browser.version(), source: SOURCE_SHA, poiSha256: sha256(poiBytes) }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
