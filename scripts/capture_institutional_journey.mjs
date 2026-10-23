import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "docs", "review", "institutional-journey-v1");
fs.mkdirSync(out, { recursive: true });
const mime = { ".css": "text/css", ".geojson": "application/geo+json", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(root, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(`${root}${path.sep}`) && target !== path.join(root, "index.html")) return response.writeHead(403).end();
  fs.readFile(target, (error, content) => error ? response.writeHead(404).end() : response.writeHead(200, { "content-type": mime[path.extname(target)] || "application/octet-stream" }).end(content));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const query = "journey=yeserias&v=1&m=PLACE&a=40.395543,-3.691757,900&be=0&al=A&ly=museum.info.stay.bike.rail&sc=LENS&rd=citizen&lg=es&lang=es&haloRegressionTest=1";
const browser = await chromium.launch({ headless: true });
const fixtures = [
  { name: "desktop-place-1440x900.png", viewport: { width: 1440, height: 900 }, step: 0, colorScheme: "light" },
  { name: "ipad-portrait-evidence-834x1112.png", viewport: { width: 834, height: 1112 }, step: 1, colorScheme: "light" },
  { name: "ipad-landscape-compare-dark-1194x834.png", viewport: { width: 1194, height: 834 }, step: 2, colorScheme: "dark" },
  { name: "mobile-verify-390x844.png", viewport: { width: 390, height: 844 }, step: 3, colorScheme: "light", drawer: true },
];
for (const fixture of fixtures) {
  const context = await browser.newContext({ viewport: fixture.viewport, colorScheme: fixture.colorScheme });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto(`${base}/?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__HALO_REGRESSION__?.planning()?.code === "APE.02.20" && window.__HALO_REGRESSION__.k11Restored());
  for (let i = 0; i < fixture.step; i += 1) { await page.evaluate(() => document.getElementById("institutionalJourneyNext").click()); await page.waitForTimeout(150); }
  if (fixture.step >= 2) await page.waitForFunction(() => window.__HALO_REGRESSION__.ambitoState().bodyHidden === false);
  if (fixture.drawer) { await page.evaluate(() => document.getElementById("institutionalJourneyEvidence").click()); await page.waitForFunction(() => document.getElementById("evidenceDrawer")?.open); }
  else await page.evaluate(() => document.getElementById("institutionalJourney").scrollIntoView({ block: "start" }));
  await page.screenshot({ path: path.join(out, fixture.name), fullPage: false });
  await context.close();
}
await browser.close();
await new Promise((resolve) => server.close(resolve));
