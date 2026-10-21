import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUTPUT = path.join(HERE, "screenshots");
const MIME = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const DEPLOYED_BASE = "https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens";

async function loadVerifiedDeploymentAssets() {
  const paths = ["/js/runtime-config.js", "/data/runtime_poi.json", "/data/deployment_manifest.json", "/data/pedestrian_activity.json"];
  try {
    const fetched = await Promise.all(paths.map(async (assetPath) => {
      const url = `${DEPLOYED_BASE}${assetPath}`;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`${assetPath} returned HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      return { assetPath, url, bytes, sha256: digest(bytes) };
    }));
    const byPath = new Map(fetched.map((asset) => [asset.assetPath, asset]));
    const json = (assetPath) => JSON.parse(byPath.get(assetPath).bytes.toString("utf8"));
    const manifest = json("/data/deployment_manifest.json");
    const runtime = json("/data/runtime_poi.json");
    const pedestrian = json("/data/pedestrian_activity.json");
    if (manifest.build_state !== "pass" || manifest.validation?.error_count !== 0) throw new Error("deployed manifest is not a validated pass");
    if (runtime.sourceMode !== "deployment-snapshot") throw new Error("runtime POI artifact is not a deployment snapshot");
    if (Object.values(runtime.status || {}).some((state) => !state.ok)) throw new Error("a deployed runtime POI layer is not available");
    const operationalRecords = ["museum", "info", "bike", "rail", "stay"].reduce((sum, key) => sum + (runtime.layers?.[key]?.length || 0), 0);
    if (operationalRecords !== manifest.totals?.operational_records) throw new Error("runtime POI count does not match the deployment manifest");
    if (!pedestrian.available) throw new Error("deployed pedestrian artifact is not available");
    return {
      mode: "verified-deployment",
      byPath,
      manifest: {
        commit: manifest.commit,
        workflowRun: manifest.workflow_run,
        generatedAt: manifest.generated_at,
        buildState: manifest.build_state,
        validation: manifest.validation,
        operationalRecords
      },
      assets: fetched.map(({ assetPath, url, bytes, sha256 }) => ({ path: assetPath, url, bytes: bytes.length, sha256 }))
    };
  } catch (error) {
    return { mode: "repository-fallback", byPath: new Map(), manifest: null, assets: [], limitation: error.message };
  }
}

const deployment = await loadVerifiedDeploymentAssets();

const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const deployedAsset = deployment.byPath.get(pathname);
  if (deployedAsset) {
    response.writeHead(200, { "content-type": MIME[path.extname(pathname)] || "application/octet-stream", "cache-control": "no-store" });
    response.end(deployedAsset.bytes);
    return;
  }
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== path.join(ROOT, "index.html")) return response.writeHead(403).end();
  try {
    const content = await readFile(target);
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream", "cache-control": "no-store" });
    response.end(content);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });
const records = [];

async function open({ width = 1440, height = 900, preference = "light", colorScheme = "light", language = "en" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, locale: language === "es" ? "es-ES" : "en-US" });
  await context.addInitScript((value) => localStorage.setItem("madrid-lens-appearance", value), preference);
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__) && Boolean(window.MadridAppearance));
  await page.waitForFunction((expectedMode) => {
    const badge = document.querySelector("#liveBadge span")?.textContent || "";
    const area = document.querySelector("#areaProfile")?.dataset.state || "";
    const planning = document.querySelector("#planningAmbito")?.dataset.state || "";
    const sourcesReady = badge && !/loading spatial sources/i.test(badge);
    const contextsReady = area && area !== "loading" && planning && planning !== "loading";
    const productionReady = expectedMode !== "verified-deployment" || (/1470 records/i.test(badge) && /deployment snapshot/i.test(badge) && !/fallback/i.test(badge));
    return sourcesReady && contextsReady && productionReady;
  }, deployment.mode, { timeout: 40000 });
  if (language !== "en") await page.locator("#languageSelect").selectOption(language);
  return { context, page };
}

async function waitForStableApplication(page) {
  await page.waitForFunction(() => {
    const panel = document.querySelector("#analysisPanel");
    const visiblePending = [...panel.querySelectorAll("*")].some((node) => {
      const style = getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden" && /^(Loading(?: spatial sources)?…?|Locating…?)$/i.test(node.textContent.trim());
    });
    const mode = panel.dataset.mode;
    const cityReady = mode !== "CITY" || (document.querySelector("#destinationContext")?.dataset.state || "") !== "loading";
    return !visiblePending && cityReady;
  }, null, { timeout: 40000 });
  await page.evaluate(() => document.fonts?.ready);
  const first = await page.evaluate(() => [
    document.querySelector("#liveBadge span")?.textContent,
    document.querySelector("#areaHeadline")?.textContent,
    document.querySelector("#analysisPanel")?.dataset.mode,
    document.querySelector("#destinationPeriod")?.textContent,
    document.querySelector("#planningAmbito")?.dataset.state
  ].join("|"));
  await page.waitForTimeout(500);
  const second = await page.evaluate(() => [
    document.querySelector("#liveBadge span")?.textContent,
    document.querySelector("#areaHeadline")?.textContent,
    document.querySelector("#analysisPanel")?.dataset.mode,
    document.querySelector("#destinationPeriod")?.textContent,
    document.querySelector("#planningAmbito")?.dataset.state
  ].join("|"));
  if (first !== second) throw new Error(`application state was not stable before capture: ${first} -> ${second}`);
}

async function capture(file, state, setup = async () => {}) {
  const opened = await open(state);
  try {
    await setup(opened.page);
    await waitForStableApplication(opened.page);
    await opened.page.waitForFunction(() => {
      const tiles = [...document.querySelectorAll(".leaflet-tile")];
      return tiles.length > 0 && tiles.some((tile) => tile.complete && tile.naturalWidth > 0);
    }, null, { timeout: 20000 });
    const target = path.join(OUTPUT, file);
    await opened.page.screenshot({ path: target, animations: "disabled" });
    const bytes = await readFile(target);
    records.push({
      file: `screenshots/${file}`,
      sha256: digest(bytes), bytes: bytes.length,
      viewport: { width: state.width || 1440, height: state.height || 900 },
      preference: await opened.page.locator("#appearanceSelect").inputValue(),
      resolved: await opened.page.locator("html").getAttribute("data-appearance"),
      basemap: await opened.page.locator("#basemapSelect").inputValue(),
      language: await opened.page.locator("#languageSelect").inputValue(),
      mode: await opened.page.locator("#analysisPanel").getAttribute("data-mode"),
      dataMode: deployment.mode,
      evidenceState: await opened.page.locator("#liveBadge span").textContent()
    });
  } finally { await opened.context.close(); }
}

await mkdir(OUTPUT, { recursive: true });
try {
  await capture("01-desktop-place-dark.png", { preference: "dark" });
  await capture("02-desktop-place-light.png", { preference: "light" });
  await capture("03-desktop-compare-dark.png", { preference: "dark" }, async (page) => page.locator("#modeCompareButton").click());
  await capture("04-desktop-compare-light.png", { preference: "light" }, async (page) => page.locator("#modeCompareButton").click());
  await capture("05-city-light-es.png", { preference: "light", language: "es" }, async (page) => page.locator("#modeCityButton").click());
  await capture("06-evidence-drawer-light.png", { preference: "light" }, async (page) => page.locator('[data-evidence-mode="PLACE"]').click());
  await capture("07-mobile-light.png", { width: 390, height: 844, preference: "light" });
  await capture("08-light-ui-dark-basemap.png", { preference: "light" }, async (page) => page.locator("#basemapSelect").selectOption("dark"));
  await capture("09-dark-ui-light-basemap.png", { preference: "dark" });
  await capture("10-system-after-os-dark.png", { preference: "system", colorScheme: "light" }, async (page) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => document.documentElement.dataset.appearance === "dark");
  });
  await writeFile(path.join(HERE, "manifest.json"), `${JSON.stringify({
    schema: "ux-t1-appearance-visual-proof/1.1",
    capturedAt: new Date().toISOString(),
    browser: `Chromium ${browser.version()} via Playwright`,
    source: deployment.mode === "verified-deployment"
      ? "local implementation branch; verified deployed runtime artifacts proxied in memory; committed static evidence assets; live tiles (not version-pinned)"
      : "local implementation branch; repository deterministic fallback data; live tiles (not version-pinned)",
    deployment: { mode: deployment.mode, manifest: deployment.manifest, assets: deployment.assets, limitation: deployment.limitation || null },
    screenshots: records
  }, null, 2)}\n`);
  console.log(JSON.stringify({ count: records.length, records }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
