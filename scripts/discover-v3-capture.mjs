import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const phase = process.argv[2];
if (!new Set(["before", "after"]).has(phase)) {
  throw new Error("Usage: node scripts/discover-v3-capture.mjs before|after");
}

const output = path.join(root, "docs", "review", "discover-v3", phase);
const projectPath = "/madrid-tourism-intelligence-lens";
const contentTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

async function serveTree() {
  const server = http.createServer(async (request, response) => {
    const rawPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (!rawPath.startsWith(projectPath)) return response.writeHead(404).end();
    const relative = rawPath.slice(projectPath.length).replace(/^\/+/, "") || "index.html";
    const target = path.resolve(root, relative.endsWith("/") ? path.join(relative, "index.html") : relative);
    if (!target.startsWith(root + path.sep) && target !== root) return response.writeHead(403).end();
    try {
      const body = await fs.readFile(target);
      response.writeHead(200, { "content-type": contentTypes[path.extname(target)] || "application/octet-stream" }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}${projectPath}` };
}

async function instrument(context) {
  await context.addInitScript(() => {
    window.__discoverVitals = { cls: 0, lcp: 0 };
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__discoverVitals.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver(list => {
      const entries = list.getEntries();
      window.__discoverVitals.lcp = entries.at(-1)?.startTime || 0;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });
}

async function initialMetrics(page, width) {
  await page.waitForTimeout(700);
  return page.evaluate(viewportWidth => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    const paints = Object.fromEntries(performance.getEntriesByType("paint").map(entry => [entry.name, entry.startTime]));
    return {
      width: viewportWidth,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      initialResourceCount: resources.length,
      initialEncodedBytes: resources.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0),
      productImageLoadedInitially: document.querySelector(".product-proof img").complete && document.querySelector(".product-proof img").naturalWidth > 0,
      domContentLoadedMs: navigation?.domContentLoadedEventEnd || 0,
      loadMs: navigation?.loadEventEnd || 0,
      fcpMs: paints["first-contentful-paint"] || 0,
      lcpMs: window.__discoverVitals.lcp,
      cls: window.__discoverVitals.cls,
      externalScripts: [...document.scripts].map(script => script.src).filter(Boolean),
    };
  }, width);
}

const { server, base } = await serveTree();
const browser = await chromium.launch({ headless: true });
await fs.mkdir(output, { recursive: true });
const measurements = { phase, capturedAt: new Date().toISOString(), browser: await browser.version(), viewports: [] };

try {
  for (const [width, height] of [[320, 720], [390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    await instrument(context);
    const page = await context.newPage();
    await page.route("https://**/*", route => route.abort());
    await page.goto(`${base}/discover/`, { waitUntil: "load" });
    measurements.viewports.push(await initialMetrics(page, width));

    if (width === 1440) {
      await page.screenshot({ path: path.join(output, "01-desktop-hero-1440.png") });
      await page.locator("#product").scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(output, "02-desktop-product-1440.png") });
      await page.locator('[data-story="compare"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(output, "03-desktop-story-1440.png") });
      await page.locator(".cta-panel").scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(output, "04-desktop-cta-1440.png") });
    }
    if (width === 390) {
      await page.screenshot({ path: path.join(output, "05-mobile-hero-390.png") });
      await page.locator('[data-story="compare"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(output, "06-mobile-story-390.png") });
      await page.locator(".cta-panel").scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(output, "07-mobile-cta-390.png") });
    }
    await context.close();
  }
  await fs.writeFile(path.join(output, "measurements.json"), `${JSON.stringify(measurements, null, 2)}\n`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

console.log(`Discover V3 ${phase} evidence written to ${path.relative(root, output)}`);
