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

const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  if (pathname === "/js/runtime-config.js") {
    try {
      const deployed = await fetch("https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens/js/runtime-config.js", { cache: "no-store" });
      response.writeHead(deployed.status, { "content-type": "text/javascript", "cache-control": "no-store" });
      response.end(Buffer.from(await deployed.arrayBuffer()));
    } catch { response.writeHead(503).end(); }
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
  if (language !== "en") await page.locator("#languageSelect").selectOption(language);
  return { context, page };
}

async function capture(file, state, setup = async () => {}) {
  const opened = await open(state);
  try {
    await setup(opened.page);
    await opened.page.waitForFunction(() => {
      const tiles = [...document.querySelectorAll(".leaflet-tile")];
      return tiles.length === 0 || tiles.some((tile) => tile.complete && tile.naturalWidth > 0);
    }, null, { timeout: 15000 }).catch(() => {});
    await opened.page.waitForTimeout(250);
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
      mode: await opened.page.locator("#analysisPanel").getAttribute("data-mode")
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
    schema: "ux-t1-appearance-visual-proof/1.0",
    capturedAt: new Date().toISOString(),
    browser: `Chromium ${browser.version()} via Playwright`,
    source: "local implementation branch; repository fallback data; deployed runtime basemap config proxied in memory; live tiles (not version-pinned)",
    screenshots: records
  }, null, 2)}\n`);
  console.log(JSON.stringify({ count: records.length, records }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
