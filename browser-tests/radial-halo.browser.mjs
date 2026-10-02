import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Radial Halo V3 browser regression. Exercises the production Leaflet/SVG
// renderer and asserts the SEMANTICS of the quantitative perimeter bars:
// raw values printed, outward radial geometry, density-based bar length (within-metric), one shared A/B
// scale, radius-compatible comparison, unavailable-vs-zero, saturation, and
// keyboard focus and open-map interaction. Value-semantics tests use the deterministic query-gated
// seam so they are independent of which data layers a given checkout ships
// (notably data/runtime_poi.json is a gitignored deploy artifact, so a clean CI
// checkout serves only the committed snapshot and mobility is legitimately N/A).

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = path.resolve(ROOT, relative);
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== path.join(ROOT, "index.html")) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(target, (error, content) => {
    if (error) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    response.end(content);
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });

const SLOT_METRIC = { north: "tourism", east: "stays", south: "mobility", west: "utci" };
const SLOT_ANGLE = { tourism: -90, stays: -30, mobility: 90, utci: 180 };
const COUNT_TOKEN = /^\d[\d,]*$/;              // a grouped integer, including "0"
const COUNT_OR_NA = /^(\d[\d,]*|N\/A)$/;        // integer or unavailable
const VALID_TOKEN = /^(\d[\d,]*|N\/A|OFF|-?\d[\d.,]*°C)$/;

async function newPage(viewport = { width: 1366, height: 1024 }) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(5000);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return route.abort();
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
  return page;
}

// Compare mode: both lenses enabled, positioned apart, Lens A active. Panels are
// hidden by default so both lenses' bars sit over open map for geometry reads.
async function openCompare(viewport, { panels = false, zoom = 13 } = {}) {
  const page = await newPage(viewport);
  await page.locator("#lensBButton").click();
  await page.waitForFunction(() => document.querySelectorAll(".comparison-halo-icon").length > 0);
  if (!panels) await page.addStyleTag({ content: ".panel,.left{display:none!important}" });
  await page.evaluate((z) => {
    const api = window.__HALO_REGRESSION__;
    api.setZoom(z);
    api.setCenterAtPoint("A", 460, 430);
    api.setCenterAtPoint("B", 1000, 430);
    api.setActive("A");
  }, zoom);
  return page;
}

// Single-lens mode: Lens B never enabled; the halo must still render Lens A from
// the real (production) data path, over central Madrid.
async function openSingle(viewport) {
  const page = await newPage(viewport);
  await page.waitForFunction(() => document.querySelectorAll(".comparison-halo-icon").length > 0);
  await page.evaluate(() => {
    window.__HALO_REGRESSION__.setZoom(14);
    window.__HALO_REGRESSION__.moveLens("A", 560, 430);
  });
  await page.waitForFunction(() => document.querySelectorAll(".halo-glyph.halo-a").length === 4);
  return page;
}

function glyph(page, lens, slot) {
  return page.locator(`.halo-glyph.halo-${lens.toLowerCase()}.halo-slot-${slot}`);
}
async function valueText(page, lens, slot) {
  return (await glyph(page, lens, slot).locator(".halo-value").textContent())?.trim();
}
async function fillLength(page, lens, slot) {
  return glyph(page, lens, slot).locator(".halo-fill").evaluate((line) => {
    const n = (name) => Number(line.getAttribute(name));
    return Math.hypot(n("x2") - n("x1"), n("y2") - n("y1"));
  });
}
async function groupDisplay(page, lens, slot, selector) {
  return glyph(page, lens, slot).locator(selector).evaluate((node) => getComputedStyle(node).display);
}
async function saturated(page, lens, slot) {
  return glyph(page, lens, slot).evaluate((svg) => svg.getAttribute("data-saturated"));
}
async function visibleSlots(page, lens) {
  const slots = ["north", "east", "south", "west"];
  return Promise.all(slots.map(async (slot) => {
    const icon = glyph(page, lens, slot).locator("xpath=..");
    const present = await icon.count() > 0;
    return { slot, visible: present, display: present ? await icon.evaluate((node) => getComputedStyle(node).display) : "none" };
  }));
}
async function setComparison(page, patch) {
  return page.evaluate((patch) => window.__HALO_REGRESSION__.setComparison({ ...window.__HALO_REGRESSION__.fixture, ...patch }), patch);
}
async function setRadius(page, which, metres) {
  await page.evaluate(({ which, metres }) => window.__HALO_REGRESSION__.setRadius(which, metres), { which, metres });
}
async function geometryFor(page, lens, metric) {
  return page.evaluate(({ lens, metric }) => window.__HALO_REGRESSION__.geometry(lens, metric), { lens, metric });
}
async function lineGeometry(page, lens, slot, selector = ".halo-fill") {
  return glyph(page, lens, slot).locator(selector).evaluate((line) => {
    const n = (name) => Number(line.getAttribute(name));
    return { x1: n("x1"), y1: n("y1"), x2: n("x2"), y2: n("y2") };
  });
}
const live = (value) => ({ value, sourceState: "live" });

// A/B/N. Single lens renders four bars that print real runtime values, honest
// about the actual data contract (mobility may be unavailable in a snapshot-only
// checkout; it then reads N/A, never a fake 0).
test("A/B/N single lens renders four perimeter bars printing honest runtime values", async (t) => {
  const page = await openSingle();
  t.after(() => page.close());
  assert.equal((await visibleSlots(page, "A")).filter((s) => s.visible).length, 4, "all four Lens A slots render with Compare off");
  assert.match(await valueText(page, "A", "north"), COUNT_TOKEN, "Tourism prints a runtime integer");
  assert.match(await valueText(page, "A", "east"), COUNT_TOKEN, "Stays prints a runtime integer");
  assert.match(await valueText(page, "A", "south"), COUNT_OR_NA, "Mobility prints an integer or N/A (never a fake 0)");
  assert.match(await valueText(page, "A", "west"), VALID_TOKEN, "UTCI prints a valid token");
  assert.equal(await page.locator(".halo-glyph.halo-b").count(), 0, "no Lens B markers in single-lens mode");
});

test("each rendered quantitative SVG bar points outward along its fixed canonical metric slot", async (t) => {
  const page = await openCompare(undefined, { zoom: 14 });
  t.after(() => page.close());
  await setComparison(page, {
    tourism: { a: live(5), b: live(10) }, stays: { a: live(2), b: live(4) }, mobility: { a: live(3), b: live(6) },
    utci: { enabled: true, timestepA: "15:00", timestepB: "15:00", a: { evidence: "MODEL-DERIVED", mean: 38, count: 2 }, b: { evidence: "MODEL-DERIVED", mean: 35, count: 2 } },
  });
  for (const lens of ["A", "B"]) {
    for (const [slot, metric] of Object.entries(SLOT_METRIC)) {
      const { x1, y1, x2, y2 } = await lineGeometry(page, lens, slot);
      const magnitude = Math.hypot(x2 - x1, y2 - y1);
      assert.ok(magnitude > 0, `${lens} ${metric} has a positive rendered bar`);
      const angle = SLOT_ANGLE[metric] * Math.PI / 180;
      const ux = (x2 - x1) / magnitude;
      const uy = (y2 - y1) / magnitude;
      assert.ok(Math.abs(ux - Math.cos(angle)) < 0.015 && Math.abs(uy - Math.sin(angle)) < 0.015,
        `${lens} ${metric} SVG axis matches its canonical outward angle`);
      const label = await glyph(page, lens, slot).locator(".halo-value").evaluate((node) => ({
        x: Number(node.getAttribute("x")), y: Number(node.getAttribute("y")), anchor: node.getAttribute("text-anchor"),
      }));
      const labelDelta = { x: label.x - x2, y: label.y - y2 };
      assert.ok(Math.abs(labelDelta.x * uy - labelDelta.y * ux) < 0.15, `${lens} ${metric} value stays on its radial axis`);
      assert.ok(labelDelta.x * ux + labelDelta.y * uy >= 6.9, `${lens} ${metric} value sits outside the bar tip`);
      assert.equal(label.anchor, Math.abs(Math.cos(angle)) < 0.35 ? "middle" : Math.cos(angle) > 0 ? "start" : "end");
    }
  }
});

// C (brief). Monotonic within a metric and ONE shared A/B scale, at equal radius.
test("C/D/E density bar is monotonic and shares one A/B scale at equal radius", async (t) => {
  const page = await openCompare(undefined, { zoom: 14 });
  t.after(() => page.close());
  await setRadius(page, "A", 900);
  await setRadius(page, "B", 900);
  const lengths = [];
  for (const value of [1, 2, 5, 40]) {
    await setComparison(page, { radii: { A: 900, B: 900 }, tourism: { a: live(value), b: live(10) } });
    lengths.push(await fillLength(page, "A", "north"));
  }
  for (let i = 1; i < lengths.length; i += 1) {
    assert.ok(lengths[i] >= lengths[i - 1] - 0.01, `monotonic non-decreasing (${lengths[i - 1]} -> ${lengths[i]})`);
  }
  assert.ok(lengths[2] > lengths[0], "5 renders a longer bar than 1");
  // Equal raw count + equal radius -> equal bars on both lenses.
  await setComparison(page, { radii: { A: 900, B: 900 }, tourism: { a: live(7), b: live(7) } });
  assert.ok(Math.abs((await fillLength(page, "A", "north")) - (await fillLength(page, "B", "north"))) < 0.01, "equal density -> equal A/B bars");
  // Raw numbers printed (brief D); Lens B (10) longer than Lens A (5) (brief E).
  await setComparison(page, { radii: { A: 900, B: 900 }, tourism: { a: live(5), b: live(10) } });
  assert.equal(await valueText(page, "A", "north"), "5");
  assert.equal(await valueText(page, "B", "north"), "10");
  assert.ok((await fillLength(page, "B", "north")) > (await fillLength(page, "A", "north")), "same radius: larger count -> longer bar");
});

// B + C (brief). Unequal radii: smaller radius = higher density = longer bar;
// counts proportional to area = equal density = equal bars.
test("B/C unequal radii compare by density, not raw window size", async (t) => {
  const page = await openCompare(undefined, { zoom: 14 });
  t.after(() => page.close());
  await setRadius(page, "A", 500);
  await setRadius(page, "B", 1000);
  // Same raw count, A's window is 4x smaller -> A denser -> A's bar is longer.
  await setComparison(page, { radii: { A: 500, B: 1000 }, tourism: { a: live(5), b: live(5) } });
  assert.equal(await valueText(page, "A", "north"), "5");
  assert.equal(await valueText(page, "B", "north"), "5");
  assert.ok((await fillLength(page, "A", "north")) > (await fillLength(page, "B", "north")) + 1, "smaller radius, same count -> longer bar");
  // Counts proportional to area (2 in 500 m, 8 in 1000 m) -> equal density -> equal bars.
  await setComparison(page, { radii: { A: 500, B: 1000 }, tourism: { a: live(2), b: live(8) } });
  assert.equal(await valueText(page, "A", "north"), "2");
  assert.equal(await valueText(page, "B", "north"), "8");
  const la = await fillLength(page, "A", "north");
  const lb = await fillLength(page, "B", "north");
  assert.ok(Math.abs(la - lb) < 0.8, `area-proportional counts -> equal density bars (${la} vs ${lb})`);
});

// J(UTCI) (brief). UTCI is Celsius-band based (never area-normalized): the same
// mean gives the same bar at any Lens radius. Tested on one lens across two radii
// (both full layout) to avoid cross-lens slot collision.
test("J(UTCI) UTCI bar is Celsius-band based and radius-independent", async (t) => {
  const page = await openCompare(undefined, { zoom: 14 });
  t.after(() => page.close());
  const utci = { enabled: true, timestepA: "15:00", timestepB: "15:00", a: { evidence: "MODEL-DERIVED", mean: 38, count: 2 }, b: { evidence: "MODEL-DERIVED", mean: 35, count: 2 } };
  await setComparison(page, { radii: { A: 500, B: 500 }, utci });
  await setRadius(page, "A", 500);
  assert.equal(await valueText(page, "A", "west"), "38.0°C");
  const small = await fillLength(page, "A", "west");
  await setRadius(page, "A", 1500);
  assert.equal(await valueText(page, "A", "west"), "38.0°C", "raw UTCI unchanged by radius");
  const large = await fillLength(page, "A", "west");
  assert.ok(Math.abs(small - large) < 0.8, `UTCI bar length is radius-independent (${small} vs ${large})`);
  // And it is a real band position, not full/empty.
  assert.ok(small > 2, "UTCI bar has a meaningful length");
});

// H (brief). Values above the reference density saturate the bar, raw unchanged.
test("H above-reference density saturates the bar while the raw number stays full", async (t) => {
  const page = await openCompare(undefined, { zoom: 14 });
  t.after(() => page.close());
  await setRadius(page, "A", 500);
  await setRadius(page, "B", 900);
  await setComparison(page, { radii: { A: 500, B: 900 }, tourism: { a: live(500), b: live(1) } });
  assert.equal(await valueText(page, "A", "north"), "500", "raw count still printed in full");
  assert.equal(await saturated(page, "A", "north"), "true", "saturation flagged");
  assert.equal(await saturated(page, "B", "north"), "false", "below-reference density not flagged");
  const full = await fillLength(page, "A", "north");
  assert.ok(full > (await fillLength(page, "B", "north")), "saturated bar is the longer one");
});

// I (brief). Zero vs unavailable vs off stay distinct in the rendered SVG.
test("I genuine zero, unavailable and off render distinct states", async (t) => {
  const page = await openCompare(undefined, { zoom: 14 });
  t.after(() => page.close());
  await setComparison(page, { tourism: { a: live(0), b: live(10) } });
  assert.equal(await valueText(page, "A", "north"), "0");
  assert.notEqual(await groupDisplay(page, "A", "north", ".halo-zero"), "none");
  assert.equal(await groupDisplay(page, "A", "north", ".halo-abstain"), "none");
  assert.equal(await groupDisplay(page, "A", "north", ".halo-fill"), "none", "observed zero has no quantitative bar");
  assert.equal(await groupDisplay(page, "A", "north", ".halo-track"), "none", "observed zero has no positive-looking track");

  await setComparison(page, { tourism: { a: { value: null, sourceState: "unavailable" }, b: live(10) } });
  assert.equal(await valueText(page, "A", "north"), "N/A");
  assert.notEqual(await groupDisplay(page, "A", "north", ".halo-abstain"), "none");
  assert.equal(await groupDisplay(page, "A", "north", ".halo-fill"), "none");
  assert.equal(await groupDisplay(page, "A", "north", ".halo-track"), "none");
  assert.match(await glyph(page, "A", "north").locator(".halo-abstain").getAttribute("class"), /halo-state-unavailable/);

  await setComparison(page, { utci: { enabled: false } });
  assert.equal(await valueText(page, "A", "west"), "OFF");
  assert.equal(await groupDisplay(page, "A", "west", ".halo-fill"), "none", "OFF has no quantitative bar");
  assert.match(await glyph(page, "A", "west").locator(".halo-abstain").getAttribute("class"), /halo-state-off/);
});

// J (brief). Switching the active lens never removes the other lens's bars.
test("J active-lens switching keeps both lenses' quantitative bars on the map", async (t) => {
  const page = await openCompare();
  t.after(() => page.close());
  await page.evaluate(() => {
    window.__HALO_REGRESSION__.setZoom(14);
    window.__HALO_REGRESSION__.moveLens("A", 380, 430);
    window.__HALO_REGRESSION__.moveLens("B", 980, 430);
  });
  const bothPresent = async () => {
    assert.equal((await visibleSlots(page, "A")).filter((s) => s.visible).length, 4, "Lens A keeps four bars");
    assert.equal((await visibleSlots(page, "B")).filter((s) => s.visible).length, 4, "Lens B keeps four bars");
    assert.match(await valueText(page, "A", "south"), VALID_TOKEN);
    assert.match(await valueText(page, "B", "south"), VALID_TOKEN);
  };
  await bothPresent();
  await page.evaluate(() => window.__HALO_REGRESSION__.setActive("B"));
  await bothPresent();
  await page.evaluate(() => window.__HALO_REGRESSION__.setActive("A"));
  await bothPresent();
});

// Unequal radii remain projected 5 px beyond each lens's own boundary.
test("unequal radii keep each lens's bars projected onto its own boundary", async (t) => {
  const page = await openCompare();
  t.after(() => page.close());
  await setRadius(page, "A", 500);
  await setRadius(page, "B", 1500);
  for (const lens of ["A", "B"]) {
    const g = await geometryFor(page, lens, "tourism");
    const distance = Math.hypot(g.anchor.x - g.center.x, g.anchor.y - g.center.y);
    assert.ok(Math.abs(distance - g.radiusPx - 5) <= 1.5, `${lens} spoke attaches 5 px beyond its own radius`);
    assert.ok(g.radiusPx > 0);
  }
  const before = await geometryFor(page, "A", "tourism");
  const beforeB = await geometryFor(page, "B", "tourism");
  await setRadius(page, "A", 1500);
  const after = await geometryFor(page, "A", "tourism");
  const afterB = await geometryFor(page, "B", "tourism");
  assert.ok(after.radiusPx > before.radiusPx);
  assert.ok(Math.hypot(after.anchor.x - before.anchor.x, after.anchor.y - before.anchor.y) > 20);
  assert.ok(Math.abs(afterB.radiusPx - beforeB.radiusPx) < 0.01, "B radius unchanged when A grows");
});

test("minimum and maximum supported lens radii keep their radial origins attached independently", async (t) => {
  const page = await openCompare({ width: 1440, height: 1000 }, { zoom: 12 });
  t.after(() => page.close());
  await page.evaluate(() => {
    window.__HALO_REGRESSION__.setCenterAtPoint("A", 480, 500);
    window.__HALO_REGRESSION__.setCenterAtPoint("B", 1050, 500);
  });
  await setRadius(page, "A", 100);
  await setRadius(page, "B", 5000);
  for (const lens of ["A", "B"]) {
    const g = await geometryFor(page, lens, "tourism");
    const distance = Math.hypot(g.anchor.x - g.center.x, g.anchor.y - g.center.y);
    assert.ok(Math.abs(distance - g.radiusPx - 5) < 1.8, `${lens} origin follows actual projected radius plus 5 px gap`);
    assert.equal(g.angle, -90);
  }
});

// K. Pan/zoom preserves attachment.
test("K pan and zoom preserve bar attachment to the Lens boundary", async (t) => {
  const page = await openCompare();
  t.after(() => page.close());
  await setRadius(page, "A", 900);
  const check = async () => {
    const g = await geometryFor(page, "A", "mobility");
    const distance = Math.hypot(g.anchor.x - g.center.x, g.anchor.y - g.center.y);
    assert.ok(Math.abs(distance - g.radiusPx - 5) <= 1.5, "spoke stays 5 px beyond the projected radius");
  };
  await check();
  await page.evaluate(() => window.__HALO_REGRESSION__.setZoom(15));
  await check();
  await page.evaluate(() => window.__HALO_REGRESSION__.setZoom(12));
  await check();
});

// L. Values stay legible and in-bounds on desktop, laptop and iPad viewports.
for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "iPad landscape", width: 1024, height: 768 },
  { name: "iPad portrait", width: 768, height: 1024 },
]) {
  test(`L values stay legible and in-bounds on ${viewport.name}`, async (t) => {
    const page = await openCompare(viewport);
    t.after(() => page.close());
    await setComparison(page, {});
    const mapRect = await page.locator("#map").evaluate((node) => node.getBoundingClientRect().toJSON());
    for (const lens of ["A", "B"]) {
      for (const { slot, visible, display } of await visibleSlots(page, lens)) {
        if (!visible || display === "none") continue;
        const box = await glyph(page, lens, slot).locator(".halo-value").evaluate((node) => node.getBoundingClientRect().toJSON());
        assert.ok(box.height >= 9, `${lens} ${slot} value is legible (${box.height}px) on ${viewport.name}`);
        assert.ok(box.right > mapRect.left && box.left < mapRect.right && box.bottom > mapRect.top && box.top < mapRect.bottom,
          `${lens} ${slot} value stays within the map on ${viewport.name}`);
      }
    }
  });
}

// M. The halo never blocks pointer interaction with the map.
test("M the halo exposes keyboard metric focus while open map space remains clickable", async (t) => {
  const page = await openCompare();
  t.after(() => page.close());
  const interaction = await glyph(page, "A", "north").evaluate((svg) => ({
    pointerEvents: getComputedStyle(svg.closest(".comparison-halo-icon")).pointerEvents,
    role: svg.getAttribute("role"), tabIndex: svg.getAttribute("tabindex"),
    ariaLabel: svg.getAttribute("aria-label"),
  }));
  assert.equal(interaction.pointerEvents, "auto");
  assert.equal(interaction.role, "button");
  assert.equal(interaction.tabIndex, "0");
  assert.match(interaction.ariaLabel, /Lens A, Tourism POIs/);
  await glyph(page, "A", "north").focus();
  await page.waitForFunction(() => document.querySelectorAll(".halo-metric-focused").length === 2);
  assert.notEqual(await page.locator('[data-halo-metric="tourism"]').getAttribute("aria-current"), null);
  await glyph(page, "A", "north").press("Escape");
  await page.waitForFunction(() => document.querySelectorAll(".halo-metric-focused").length === 0);
  const target = await page.evaluate(() => {
    const anchor = window.__HALO_REGRESSION__.geometry("A", "tourism").anchor;
    window.__haloMapClicks = 0;
    document.querySelector("#map").addEventListener("click", () => { window.__haloMapClicks += 1; }, { once: true });
    return { x: anchor.x, y: anchor.y - 30 };
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction(() => window.__haloMapClicks === 1);
});

test("metric focus started at either lens synchronizes its partner and the comparison row", async (t) => {
  const page = await openCompare(undefined, { zoom: 14 });
  t.after(() => page.close());
  for (const lens of ["A", "B"]) {
    await glyph(page, lens, "east").focus();
    await page.waitForFunction(() => document.querySelectorAll(".halo-metric-focused").length === 2);
    assert.equal(await glyph(page, "A", "east").evaluate((el) => el.classList.contains("halo-metric-focused")), true);
    assert.equal(await glyph(page, "B", "east").evaluate((el) => el.classList.contains("halo-metric-focused")), true);
    assert.equal(await page.locator('[data-halo-metric="stays"]').getAttribute("aria-current"), "true");
    assert.equal(await page.locator('[data-halo-metric="tourism"]').getAttribute("aria-current"), null);
    await glyph(page, lens, "east").evaluate((svg) => svg.blur());
    await page.waitForFunction(() => document.querySelectorAll(".halo-metric-focused").length === 0);
  }
});

test("selecting a metric keeps the paired highlight until it is toggled off", async (t) => {
  const page = await openCompare(undefined, { zoom: 14 });
  t.after(() => page.close());
  await page.evaluate(() => window.__HALO_REGRESSION__.focusMetric("mobility", "B", true));
  for (const lens of ["A", "B"]) {
    assert.equal(await glyph(page, lens, "south").getAttribute("aria-pressed"), "true");
    assert.equal(await glyph(page, lens, "south").evaluate((svg) => svg.classList.contains("halo-metric-focused")), true);
  }
  await page.evaluate(() => window.__HALO_REGRESSION__.focusMetric("mobility", "B", true));
  assert.equal(await glyph(page, "A", "south").getAttribute("aria-pressed"), "false");
  await page.evaluate(() => window.__HALO_REGRESSION__.focusMetric(null, "B"));
  assert.equal(await page.locator(".halo-metric-focused").count(), 0);
  assert.equal(await page.locator('[data-halo-metric="mobility"]').getAttribute("aria-current"), null);
});

// Compare panel survives, collisions suppress ambiguous slots, readout stays.
test("compare panel and collision suppression stay intact alongside the bars", async (t) => {
  const page = await openCompare(undefined, { panels: true });
  t.after(() => page.close());
  const scale = await page.evaluate(() => 900 / window.__HALO_REGRESSION__.geometry("A", "tourism").radiusPx);
  const compactRadiusM = 36 * scale;
  await setRadius(page, "A", compactRadiusM);
  await setRadius(page, "B", compactRadiusM);
  await page.evaluate((distance) => {
    window.__HALO_REGRESSION__.setCenterAtPoint("A", 350, 430);
    window.__HALO_REGRESSION__.setCenterAtPoint("B", 350 + distance, 430);
  }, 2 * (36 + 5));
  const a = await visibleSlots(page, "A");
  assert.ok(a.some((s) => s.visible && s.display !== "none"));
  assert.ok(a.some((s) => !s.visible || s.display === "none"));
  assert.match(await page.locator("#haloVisibilityNote").innerText(), /ambiguous Lens A\/B slot overlap/);
  assert.equal(await page.locator("#comparisonRadiusReadout").count(), 1);
  assert.notEqual(await page.locator("#cmpPoi").innerText(), "");
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
