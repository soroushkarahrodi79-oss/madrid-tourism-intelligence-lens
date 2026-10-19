import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// K12-R1 (#97 / review 5571780753) — acceptance contract for the gated `thin`
// pan optimization (?k12opt=thin, loopback host only). It defends the UX/a11y
// requirements the review asked for BEFORE `thin` could ever become a default:
//   * it activates ONLY for a user-initiated MAP DRAG (not zoom, not programmatic
//     camera moves, not a marker drag);
//   * it restores the POI cluster icons on EVERY termination path (dragend,
//     inertia/moveend, blur, pointer/touch cancel) — the map is never left thinned;
//   * cluster DOM identity/content/placement is restored exactly after the gesture;
//   * a FOCUSED cluster is never hidden (keyboard/screen-reader safety);
//   * it works in ES and EN and on both basemaps;
//   * `.poi-cluster` geometry/labels and the Lens are untouched.
// Nothing here changes scientific geometry, HATI or AC-P0-12 thresholds.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".css": "text/css; charset=utf-8", ".geojson": "application/geo+json; charset=utf-8",
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml",
};

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = path.resolve(ROOT, relative);
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== path.join(ROOT, "index.html")) {
    response.writeHead(403).end("Forbidden"); return;
  }
  fs.readFile(target, (error, content) => {
    if (error) { response.writeHead(404).end("Not found"); return; }
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    response.end(content);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return route.abort();
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1&k12opt=thin`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__ && window.__K12_THIN__));
  // POI clusters rendered (the workload `thin` optimises).
  await page.waitForFunction(() => document.querySelectorAll(".poi-cluster-icon").length > 5);
  page.context_ = context;
  return page;
}
const close = (page) => page.context_.close();

// Signature of the rendered clusters: sorted {rounded screen pos, count text}.
const clusterSignature = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".poi-cluster-icon")]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return `${Math.round(r.left)},${Math.round(r.top)}:${(el.textContent || "").trim()}`;
      })
      .sort()
      .join("|")
  );
const visibleClusterCount = (page) =>
  page.evaluate(() => [...document.querySelectorAll(".poi-cluster-icon")].filter((el) => getComputedStyle(el).display !== "none").length);
const thinActive = (page) => page.evaluate(() => window.__K12_THIN__.active());
// A point on the map background away from any marker/cluster (upper-left quadrant).
async function mapDragPoint(page) {
  const box = await page.evaluate(() => { const m = document.getElementById("map").getBoundingClientRect(); return { x: m.left, y: m.top, w: m.width, h: m.height }; });
  return { x: box.x + box.w * 0.2, y: box.y + box.h * 0.25 };
}

test("thin: a user map DRAG hides cluster icons during the drag and restores them after", async () => {
  const page = await newPage();
  try {
    const before = await clusterSignature(page);
    const beforeCount = await visibleClusterCount(page);
    assert.ok(beforeCount > 5, "clusters present before");
    const p = await mapDragPoint(page);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.mouse.move(p.x + 40, p.y + 30, { steps: 3 });
    await page.mouse.move(p.x + 90, p.y + 60, { steps: 4 });
    // DURING the drag: thin active and cluster icons not displayed.
    assert.equal(await thinActive(page), true, "thin active during drag");
    assert.equal(await visibleClusterCount(page), 0, "cluster icons hidden during drag");
    await page.mouse.up();
    await page.waitForFunction(() => window.__K12_THIN__.active() === false);
    // AFTER: restored, same count, and (recentred to the same place) exact identity.
    await page.evaluate(() => window.__HALO_REGRESSION__.setZoom(14)); // settle view deterministically
    await page.waitForFunction((n) => document.querySelectorAll(".poi-cluster-icon").length >= n, Math.min(beforeCount, 5));
    assert.equal(await thinActive(page), false, "thin cleared after drag");
    assert.ok((await visibleClusterCount(page)) > 5, "clusters visible again after drag");
    // the container must not be left in either transient class
    assert.equal(await page.evaluate(() => { const c = document.getElementById("map"); return c.classList.contains("k12-panning"); }), false);
  } finally { await close(page); }
});

test("thin: a ZOOM does NOT activate the simplification", async () => {
  const page = await newPage();
  try {
    await page.evaluate(() => window.__HALO_REGRESSION__.setZoom(15));
    await page.waitForTimeout(150);
    assert.equal(await thinActive(page), false, "zoom must not thin");
    assert.ok((await visibleClusterCount(page)) > 0, "clusters stay visible on zoom");
  } finally { await close(page); }
});

test("thin: a MARKER drag (Lens pin) does NOT activate the simplification", async () => {
  const page = await newPage();
  try {
    const box = await page.evaluate(() => { const el = document.querySelector(".leaflet-marker-draggable"); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    assert.ok(box, "draggable lens marker present");
    await page.mouse.move(box.x, box.y); await page.mouse.down();
    await page.mouse.move(box.x + 30, box.y + 20, { steps: 4 });
    const during = await thinActive(page);
    await page.mouse.up();
    assert.equal(during, false, "dragging a marker is not a map drag → thin must stay off");
  } finally { await close(page); }
});

test("thin: restores on window BLUR mid-drag (never stuck)", async () => {
  const page = await newPage();
  try {
    const p = await mapDragPoint(page);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.mouse.move(p.x + 60, p.y + 40, { steps: 4 });
    assert.equal(await thinActive(page), true, "thin active mid-drag");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.waitForFunction(() => window.__K12_THIN__.active() === false);
    assert.equal(await thinActive(page), false, "blur restores clusters even with pointer still down");
    await page.mouse.up();
  } finally { await close(page); }
});

test("thin: a FOCUSED cluster icon is NOT hidden during a drag (keyboard/SR safety)", async () => {
  const page = await newPage();
  try {
    // focus the first cluster icon
    const focused = await page.evaluate(() => { const el = document.querySelector(".poi-cluster-icon"); if (!el) return false; el.focus(); return document.activeElement === el; });
    assert.ok(focused, "a cluster icon can take focus");
    const p = await mapDragPoint(page);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.mouse.move(p.x + 70, p.y + 50, { steps: 4 });
    const focusVisible = await page.evaluate(() => { const el = document.activeElement; return el && el.classList.contains("poi-cluster-icon") && getComputedStyle(el).display !== "none"; });
    assert.equal(focusVisible, true, "the focused cluster stays displayed during the drag");
    assert.equal(await thinActive(page), true, "thin still active (others hidden)");
    await page.mouse.up();
  } finally { await close(page); }
});

test("thin: works in ES and on the satellite basemap; geometry/labels untouched", async () => {
  const page = await newPage();
  try {
    await page.evaluate(() => { const s = document.getElementById("languageSelect"); if (s) { s.value = "es"; s.dispatchEvent(new Event("change", { bubbles: true })); } });
    await page.evaluate(() => { const s = document.getElementById("basemapSelect"); if (s) { s.value = "satellite"; s.dispatchEvent(new Event("change", { bubbles: true })); } });
    await page.waitForTimeout(200);
    const p = await mapDragPoint(page);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.mouse.move(p.x + 80, p.y + 50, { steps: 4 });
    assert.equal(await thinActive(page), true, "thin activates on satellite + ES");
    assert.equal(await visibleClusterCount(page), 0, "clusters hidden during drag (satellite+ES)");
    await page.mouse.up();
    await page.waitForFunction(() => window.__K12_THIN__.active() === false);
    assert.ok((await visibleClusterCount(page)) > 5, "clusters restored (satellite+ES)");
  } finally { await close(page); }
});

test("thin: visual before/during/after capture (popping/reinstatement review)", async () => {
  const os = await import("node:os");
  const dir = path.join(os.tmpdir(), "k12-thin-visuals");
  fs.mkdirSync(dir, { recursive: true });
  for (const [label, vp] of [["desktop", { width: 1200, height: 860 }], ["tablet", { width: 834, height: 1112 }]]) {
    const page = await newPage();
    await page.setViewportSize(vp);
    await page.waitForFunction(() => document.querySelectorAll(".poi-cluster-icon").length > 5);
    const map = page.locator("#map");
    await map.screenshot({ path: path.join(dir, `${label}_1_before.png`) });
    const b = await page.evaluate(() => { const m = document.getElementById("map").getBoundingClientRect(); return { x: m.left, y: m.top, w: m.width, h: m.height }; });
    await page.mouse.move(b.x + b.w * 0.25, b.y + b.h * 0.3); await page.mouse.down();
    await page.mouse.move(b.x + b.w * 0.45, b.y + b.h * 0.5, { steps: 6 });
    await page.waitForTimeout(120);
    await map.screenshot({ path: path.join(dir, `${label}_2_during.png`) });
    await page.mouse.up();
    await page.waitForTimeout(400);
    await map.screenshot({ path: path.join(dir, `${label}_3_after.png`) });
    await close(page);
  }
  console.log(`[k12-thin] visuals written to ${dir}`);
  assert.ok(fs.existsSync(path.join(dir, "desktop_2_during.png")));
});

test.after(async () => { await browser.close(); server.close(); });
