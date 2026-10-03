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
async function textPosition(page, lens, slot, selector) {
  return glyph(page, lens, slot).locator(selector).evaluate((node) => ({
    x: Number(node.getAttribute("x")), y: Number(node.getAttribute("y")),
  }));
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

test("rendered SVG length is exactly the normalized value times the shared maximum, with the tuned thickness", async (t) => {
  const page = await openCompare(undefined, { zoom: 14 });
  t.after(() => page.close());
  await setRadius(page, "A", 900);
  await setRadius(page, "B", 900);
  await setComparison(page, { tourism: { a: live(4), b: live(8) } });
  const expectedA = 44 * Math.min(1, (4 / (Math.PI * 0.9 ** 2)) / 8);
  assert.ok(Math.abs((await fillLength(page, "A", "north")) - expectedA) < 0.01,
    `rendered Lens A line equals 44 px × density magnitude (${expectedA.toFixed(4)} px)`);
  assert.ok(Math.abs((await fillLength(page, "B", "north")) - 44 * Math.min(1, (8 / (Math.PI * 0.9 ** 2)) / 8)) < 0.01);
  const styles = await glyph(page, "A", "north").evaluate((svg) => ({
    thickness: Number.parseFloat(getComputedStyle(svg.querySelector(".halo-fill")).strokeWidth),
    trackLength: Math.hypot(
      Number(svg.querySelector(".halo-track").getAttribute("x2")) - Number(svg.querySelector(".halo-track").getAttribute("x1")),
      Number(svg.querySelector(".halo-track").getAttribute("y2")) - Number(svg.querySelector(".halo-track").getAttribute("y1")),
    ),
  }));
  assert.equal(styles.thickness, 4.5);
  assert.ok(Math.abs(styles.trackLength - 44) < 0.01, "the circumference gap is not added inside SVG coordinates");
});

test("value and caption anchors stay on the full-track rail across magnitudes, lenses and evidence states", async (t) => {
  const page = await openCompare(undefined, { zoom: 14 });
  t.after(() => page.close());
  await setRadius(page, "A", 900);
  await setRadius(page, "B", 900);
  const input = {
    references: { tourism: 8, stays: 8, mobility: 8 },
    tourism: { a: live(2), b: live(10) },
    stays: { a: live(50), b: live(2) },
    mobility: { a: live(3), b: live(6) },
    utci: { enabled: true, timestepA: "15:00", timestepB: "15:00", a: { evidence: "MODEL-DERIVED", mean: 36, count: 2 }, b: { evidence: "MODEL-DERIVED", mean: 39, count: 2 } },
  };
  await setComparison(page, input);
  const slots = { tourism: "north", stays: "east", mobility: "south", utci: "west" };
  const readRail = async (lens, slot) => {
    const track = await lineGeometry(page, lens, slot, ".halo-track");
    const value = await textPosition(page, lens, slot, ".halo-value");
    const caption = await textPosition(page, lens, slot, ".halo-label");
    const metric = SLOT_METRIC[slot];
    const angle = SLOT_ANGLE[metric] * Math.PI / 180;
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const valueDistance = (value.x - track.x2) * ux + (value.y - track.y2) * uy;
    const captionDistance = (caption.x - value.x) * ux + (caption.y - value.y) * uy;
    return { value, caption, valueDistance, captionDistance };
  };
  const tourismA = await readRail("A", "north");
  const tourismB = await readRail("B", "north");
  assert.ok((await fillLength(page, "A", "north")) < (await fillLength(page, "B", "north")), "different magnitudes change only fill length");
  assert.deepEqual(tourismA.value, tourismB.value, "A/B use identical local value coordinates for the same slot");
  assert.deepEqual(tourismA.caption, tourismB.caption, "A/B use identical local caption coordinates for the same slot");
  assert.ok(Math.abs(tourismA.valueDistance - 7) < 0.01, "value anchor sits 7 px beyond the full track endpoint");
  assert.ok(Math.abs(tourismA.captionDistance - 12) < 0.01, "caption sits 12 px beyond the fixed value anchor");
  const shortFill = await lineGeometry(page, "A", "north");
  const tipToValue = Math.hypot(tourismA.value.x - shortFill.x2, tourismA.value.y - shortFill.y2);
  assert.ok(tipToValue > 7, "low-magnitude label stays beyond the full track, not at the fill tip");

  await setComparison(page, { ...input, tourism: { a: live(10), b: live(2) }, stays: { a: live(2), b: live(50) } });
  assert.deepEqual(await readRail("A", "north"), tourismA, "changing magnitudes does not move either text anchor");
  assert.deepEqual(await readRail("B", "north"), tourismB);

  const mobilityRail = await readRail("A", "south");
  const mobilityBRail = await readRail("B", "south");
  assert.deepEqual(mobilityRail.value, mobilityBRail.value);
  assert.deepEqual(mobilityRail.caption, mobilityBRail.caption);
  const utciRail = await readRail("A", "west");
  const utciRailB = await readRail("B", "west");
  assert.ok(Math.abs(utciRail.valueDistance - 7) < 0.01);
  await setComparison(page, {
    ...input,
    tourism: { a: live(0), b: { value: null, sourceState: "unavailable" } },
    mobility: { a: live(0), b: { value: null, sourceState: "unavailable" } },
    utci: { enabled: false },
  });
  assert.deepEqual(await textPosition(page, "A", "north", ".halo-value"), tourismA.value, "observed zero shares the valid-value rail");
  assert.deepEqual(await textPosition(page, "B", "north", ".halo-value"), tourismB.value, "N/A shares the valid-value rail");
  assert.deepEqual(await textPosition(page, "A", "south", ".halo-value"), mobilityRail.value, "observed zero shares a valid-value rail");
  assert.deepEqual(await textPosition(page, "A", "south", ".halo-label"), mobilityRail.caption);
  assert.deepEqual(await textPosition(page, "B", "south", ".halo-value"), mobilityBRail.value, "N/A shares a valid-value rail");
  assert.deepEqual(await textPosition(page, "B", "south", ".halo-label"), mobilityBRail.caption);
  assert.deepEqual(await textPosition(page, "A", "west", ".halo-value"), utciRail.value, "OFF shares the valid-value rail");
  assert.deepEqual(await textPosition(page, "A", "west", ".halo-label"), utciRail.caption, "OFF caption shares the valid-value rail");
  assert.deepEqual(await textPosition(page, "B", "west", ".halo-value"), utciRailB.value);
  assert.deepEqual(await textPosition(page, "B", "west", ".halo-label"), utciRailB.caption);
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
    svgPointerEvents: getComputedStyle(svg).pointerEvents,
    markerTabIndex: svg.closest(".comparison-halo-icon").getAttribute("tabindex"),
  }));
  assert.equal(interaction.pointerEvents, "none");
  assert.equal(interaction.role, "button");
  assert.equal(interaction.tabIndex, "0");
  assert.match(interaction.ariaLabel, /Lens A, Tourism POIs/);
  assert.equal(interaction.svgPointerEvents, "none", "the transparent SVG root is not a pointer target");
  assert.equal(interaction.markerTabIndex, null, "Leaflet does not add a second keyboard target");
  await glyph(page, "A", "north").focus();
  await page.waitForFunction(() => document.querySelectorAll(".halo-metric-focused").length === 2);
  assert.notEqual(await page.locator('[data-halo-metric="tourism"]').getAttribute("aria-current"), null);
  await glyph(page, "A", "north").press("Escape");
  await page.waitForFunction(() => document.querySelectorAll(".halo-metric-focused").length === 0);
  const target = await page.evaluate(() => {
    const root = document.querySelector(".halo-glyph.halo-a.halo-slot-north").closest(".comparison-halo-icon");
    const rect = root.getBoundingClientRect();
    const point = { x: rect.left + 12, y: rect.top + 12 };
    window.__haloMapClicks = 0;
    document.querySelector("#map").addEventListener("click", () => { window.__haloMapClicks += 1; }, { once: true });
    return { ...point, inside: point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom,
      hit: document.elementFromPoint(point.x, point.y)?.closest(".comparison-halo-icon") != null };
  });
  assert.equal(target.inside, true, "test point lies inside the large transparent DivIcon box");
  assert.equal(target.hit, false, "transparent DivIcon space is absent from pointer hit testing");
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction(() => window.__haloMapClicks === 1);
  await page.evaluate(() => window.__HALO_REGRESSION__.setCenterAtPoint("A", 460, 430));
  const dragTarget = await page.evaluate(() => {
    const root = document.querySelector(".halo-glyph.halo-a.halo-slot-north").closest(".comparison-halo-icon");
    const rect = root.getBoundingClientRect();
    return { x: rect.left + 12, y: rect.top + 12, center: window.__HALO_REGRESSION__.mapCenter() };
  });
  await page.mouse.move(dragTarget.x, dragTarget.y);
  await page.mouse.down();
  await page.mouse.move(dragTarget.x + 70, dragTarget.y + 20, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction((before) => {
    const after = window.__HALO_REGRESSION__.mapCenter();
    return Math.abs(after.lat - before.lat) + Math.abs(after.lng - before.lng) > 1e-6;
  }, dragTarget.center);
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
  await glyph(page, "B", "east").locator(".halo-value").click();
  for (const lens of ["A", "B"]) {
    assert.equal(await glyph(page, lens, "east").getAttribute("aria-pressed"), "true");
    assert.equal(await glyph(page, lens, "east").evaluate((svg) => svg.classList.contains("halo-metric-focused")), true);
  }
  await glyph(page, "B", "east").locator(".halo-value").click();
  assert.equal(await glyph(page, "A", "east").getAttribute("aria-pressed"), "false");
  await glyph(page, "B", "east").evaluate((svg) => svg.blur());
  assert.equal(await page.locator(".halo-metric-focused").count(), 0);
  assert.equal(await page.locator('[data-halo-metric="stays"]').getAttribute("aria-current"), null);
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


// --- Comparison Bridge V1 --------------------------------------------------
//
// The Bridge lives inside the Lens A ↔ Lens B panel, so these open compare mode
// WITH panels visible. Halo-origin focus is driven through the focusMetric seam
// — the exact function the halo's mouseover / focus / click DOM events call,
// whose DOM wiring is already covered above — and panel controls are exercised
// by dispatching real events on the real buttons (robust against the panel's
// async content reflow). Assertions read Bridge DOM and the shared focus state;
// the final test proves the Bridge, halo and table never disagree on one metric.

async function openBridge(viewport, opts = {}) {
  const page = await openCompare(viewport, { panels: true, zoom: 14, ...opts });
  await page.evaluate(() => window.__HALO_REGRESSION__.recompute());
  return page;
}
async function bridgeState(page) {
  return page.evaluate(() => ({
    hidden: document.getElementById("comparisonBridgeMetric").hasAttribute("hidden"),
    emptyShown: !document.getElementById("comparisonBridgeEmpty").hasAttribute("hidden"),
    name: document.getElementById("cbMetricName").textContent.trim(),
    valueA: document.getElementById("cbValueA").textContent.trim(),
    valueB: document.getElementById("cbValueB").textContent.trim(),
    radiusA: document.getElementById("cbRadiusA").textContent.trim(),
    radiusB: document.getElementById("cbRadiusB").textContent.trim(),
    relValue: document.getElementById("cbRelValue").textContent.trim(),
    qualifier: document.getElementById("cbQualifier").textContent.trim(),
    relationship: document.getElementById("comparisonBridge").getAttribute("data-relationship"),
    locked: document.getElementById("comparisonBridge").getAttribute("data-locked"),
    lockShown: !document.getElementById("cbLock").hasAttribute("hidden"),
  }));
}
const focusMetric = (page, metricId, which = "A", selected = false) =>
  page.evaluate(({ metricId, which, selected }) => window.__HALO_REGRESSION__.focusMetric(metricId, which, selected), { metricId, which, selected });
const focusState = (page) => page.evaluate(() => window.__HALO_REGRESSION__.focusState());
const haloFocusedCount = (page) => page.evaluate(() => window.__HALO_REGRESSION__.haloFocusedCount());
const rowCurrent = (page, metricId) => page.locator(`tr[data-halo-metric="${metricId}"]`).getAttribute("aria-current");
const buttonPressed = (page, metricId) => page.locator(`tr[data-halo-metric="${metricId}"] .cmp-metric-focus`).getAttribute("aria-pressed");
// Exercise the real button handlers via dispatched events so the panel's async
// reflow can never make the control "unstable" for a pointer gesture.
const buttonEvent = (page, metricId, type, init = {}) =>
  page.evaluate(({ metricId, type, init }) => {
    const el = document.querySelector(`tr[data-halo-metric="${metricId}"] .cmp-metric-focus`);
    const Ctor = type.startsWith("key") ? KeyboardEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, { bubbles: true, ...init }));
  }, { metricId, type, init });
const leadingNumber = (text) => (text.match(/^[+-]?\d[\d.,]*/) || [null])[0];

test("1/3 Bridge is neutral until a metric is focused, then mirrors the row; mouseout returns neutral", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  let s = await bridgeState(page);
  assert.equal(s.hidden, true, "no metric selected → metric block hidden");
  assert.equal(s.emptyShown, true, "the neutral prompt is shown");
  // Temporary focus (hover / keyboard focus equivalent) from Lens A.
  await focusMetric(page, "tourism", "A", false);
  await page.waitForFunction(() => !document.getElementById("comparisonBridgeMetric").hasAttribute("hidden"));
  s = await bridgeState(page);
  assert.equal(s.name, "Tourism POIs");
  assert.equal(s.locked, "false", "a temporary focus is not a lock");
  assert.ok(await haloFocusedCount(page) >= 1, "the focused metric's halo marks are emphasized");
  assert.equal(await rowCurrent(page, "tourism"), "true", "the Tourism table row is marked current");
  assert.deepEqual(await focusState(page), { focused: "tourism", selected: null });
  // Focus leaves with nothing locked → neutral again.
  await focusMetric(page, null, "A", false);
  await page.waitForFunction(() => document.getElementById("comparisonBridgeMetric").hasAttribute("hidden"));
  assert.equal((await bridgeState(page)).emptyShown, true);
});

// The temporary-preview state machine is transient and would race async halo
// re-layout, so it is driven and read in ONE synchronous page sequence that
// exercises the real setHaloMetricFocus + renderComparisonBridge code at each
// step (lock → preview → return → toggle-off / Escape).
test("4/5/6/8/9 lock, temporary preview, return, toggle-off and Escape (real focus machine)", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  const steps = await page.evaluate(() => {
    const api = window.__HALO_REGRESSION__;
    const name = () => document.getElementById("cbMetricName").textContent.trim();
    const hidden = () => document.getElementById("comparisonBridgeMetric").hasAttribute("hidden");
    const locked = () => document.getElementById("comparisonBridge").getAttribute("data-locked");
    const clickBtn = (m) => document.querySelector(`tr[data-halo-metric="${m}"] .cmp-metric-focus`).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const escBtn = (m) => document.querySelector(`tr[data-halo-metric="${m}"] .cmp-metric-focus`).dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    const snap = () => ({ name: name(), hidden: hidden(), locked: locked(), ...api.focusState() });
    const out = {};
    clickBtn("tourism"); out.lock = snap();                 // 4: click locks Tourism
    api.focusMetric("stays", "A", false); out.preview = snap(); // 5: preview Stays, lock preserved
    api.focusMetric(null, "A", false); out.leave = snap();  // 5: leaving preview returns to lock
    clickBtn("tourism"); out.toggleOff = snap();            // 6: clicking the locked metric unlocks it (still previewed)
    api.focusMetric(null, "A", false); out.afterLeave = snap(); // 6: focus leaves → neutral
    api.focusMetric("mobility", "B", true); out.relock = snap(); // 8: Enter-equivalent locks Mobility
    escBtn("mobility"); out.escape = snap();                // 9: Escape clears the lock
    return out;
  });
  assert.deepEqual({ name: steps.lock.name, locked: steps.lock.locked, selected: steps.lock.selected }, { name: "Tourism POIs", locked: "true", selected: "tourism" });
  assert.deepEqual({ name: steps.preview.name, selected: steps.preview.selected }, { name: "Hotels & stays", selected: "tourism" }, "preview shows Stays but the lock stays Tourism");
  assert.deepEqual({ name: steps.leave.name, selected: steps.leave.selected }, { name: "Tourism POIs", selected: "tourism" }, "leaving the preview returns to the locked metric");
  assert.deepEqual({ locked: steps.toggleOff.locked, selected: steps.toggleOff.selected }, { locked: "false", selected: null }, "clicking the locked metric again unlocks it (still previewed until focus leaves)");
  assert.equal(steps.afterLeave.hidden, true, "once focus leaves, the Bridge returns to neutral");
  assert.deepEqual({ name: steps.relock.name, locked: steps.relock.locked, selected: steps.relock.selected }, { name: "Mobility nodes", locked: "true", selected: "mobility" });
  assert.deepEqual({ hidden: steps.escape.hidden, selected: steps.escape.selected }, { hidden: true, selected: null }, "Escape clears the lock and returns to neutral");
});

test("10 panel metric control focuses and locks the matching halo pair (panel → halo)", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  // Place both lenses in open map (clear of the panels) so BOTH halo marks render.
  await page.evaluate(() => {
    const a = window.__HALO_REGRESSION__;
    a.setZoom(13); a.setRadius("A", 500); a.setRadius("B", 500);
    a.setCenterAtPoint("A", 360, 430); a.setCenterAtPoint("B", 720, 430); a.setActive("A"); a.recompute();
  });
  await page.waitForFunction(() =>
    document.querySelectorAll(".halo-glyph.halo-a.halo-slot-east").length === 1 &&
    document.querySelectorAll(".halo-glyph.halo-b.halo-slot-east").length === 1);
  await buttonEvent(page, "stays", "click");
  await page.waitForFunction(() => window.__HALO_REGRESSION__.haloFocusedCount() === 2);
  assert.equal(await haloFocusedCount(page), 2, "both A and B Stays halo marks focus from the panel control");
  assert.deepEqual(await focusState(page), { focused: "stays", selected: "stays" });
  assert.equal((await bridgeState(page)).name, "Hotels & stays");
  assert.equal(await rowCurrent(page, "stays"), "true");
  // Pedestrian is panel-only: no focus control, so it can never target a halo mark.
  assert.equal(await page.locator("tr.panel-only-metric .cmp-metric-focus").count(), 0);
});

test("11/12/18 lock and radii survive radius changes, pan and zoom", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await focusMetric(page, "tourism", "A", true);
  await page.waitForFunction(() => document.getElementById("comparisonBridge").getAttribute("data-locked") === "true");
  await page.evaluate(() => { const a = window.__HALO_REGRESSION__; a.setRadius("A", 900); a.setRadius("B", 900); a.recompute(); });
  let s = await bridgeState(page);
  assert.equal(s.radiusA, "r 900 m");
  assert.equal(s.radiusB, "r 900 m");
  // Change Lens B radius → selection survives renderCompare(), both radii visible, B updates.
  await page.evaluate(() => { const a = window.__HALO_REGRESSION__; a.setRadius("B", 1800); a.recompute(); });
  await page.waitForFunction(() => document.getElementById("cbRadiusB").textContent.trim() === "r 1.8 km");
  s = await bridgeState(page);
  assert.equal(s.name, "Tourism POIs");
  assert.equal(s.locked, "true", "renderCompare() does not reset the lock");
  assert.equal(s.radiusA, "r 900 m", "both windows stay visible so unequal radii are never read as equivalent");
  assert.equal(s.radiusB, "r 1.8 km");
  // Pan + zoom must not reset the lock either.
  await page.evaluate(() => { const a = window.__HALO_REGRESSION__; a.setCenterAtPoint("A", 500, 440); a.setZoom(15); });
  assert.equal((await focusState(page)).selected, "tourism");
  assert.equal((await bridgeState(page)).name, "Tourism POIs");
});

test("13/14 unequal windows: Mobility withheld; Tourism density-or-withheld, never raw counts", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await page.evaluate(() => { const a = window.__HALO_REGRESSION__; a.setRadius("A", 700); a.setRadius("B", 1600); a.recompute(); });
  // Mobility is always explicitly withheld under unequal windows (never silent density).
  await focusMetric(page, "mobility", "A", true);
  await page.waitForFunction(() => document.getElementById("cbMetricName").textContent.trim() === "Mobility nodes");
  let s = await bridgeState(page);
  assert.equal(s.relationship, "withheld");
  assert.equal(s.relValue, "Withheld");
  assert.match(s.qualifier, /different window sizes/);
  assert.equal(s.radiusA, "r 700 m");
  assert.equal(s.radiusB, "r 1.6 km");
  // Tourism either compares by represented-record density or is explicitly withheld.
  await focusMetric(page, "tourism", "A", true);
  await page.waitForFunction(() => document.getElementById("cbMetricName").textContent.trim() === "Tourism POIs");
  s = await bridgeState(page);
  if (s.relationship === "comparable") {
    assert.match(s.qualifier, /represented-record density/);
    assert.match(s.relValue, /records\/km²/);
  } else {
    assert.equal(s.relValue, "Withheld");
    assert.match(s.qualifier, /AOI|source|window/);
  }
});

test("16 UTCI OFF shows OFF on both sides and withholds any delta (never zero)", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await focusMetric(page, "utci", "A", true);
  await page.waitForFunction(() => document.getElementById("cbMetricName").textContent.trim() === "Mean UTCI");
  const haloA = await page.evaluate(() => window.__HALO_REGRESSION__.haloValueText("A", "utci"));
  const s = await bridgeState(page);
  assert.equal(s.valueA, haloA, "Bridge mirrors the halo's UTCI state exactly");
  if (haloA === "OFF") {
    assert.equal(s.valueA, "OFF");
    assert.equal(s.valueB, "OFF");
    assert.equal(s.relationship, "withheld");
    assert.equal(s.relValue, "Withheld");
    assert.notEqual(s.relValue, "0");
    assert.match(s.qualifier, /layer off|evidence/);
  }
});

test("24 Bridge, halo and table agree on one metric simultaneously (state coherence)", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await focusMetric(page, "tourism", "A", true);
  await page.waitForFunction(() => document.getElementById("comparisonBridge").getAttribute("data-locked") === "true");
  const halo = await page.evaluate(() => ({
    a: window.__HALO_REGRESSION__.haloValueText("A", "tourism"),
    b: window.__HALO_REGRESSION__.haloValueText("B", "tourism"),
  }));
  const s = await bridgeState(page);
  // 1) Same displayed per-side value across halo and Bridge (one formatter, one truth).
  assert.equal(s.valueA, halo.a, "Bridge Lens A value equals the halo's Lens A value");
  assert.equal(s.valueB, halo.b, "Bridge Lens B value equals the halo's Lens B value");
  // 2) Same comparable/withheld verdict as the table, same magnitude when comparable.
  const tableDelta = (await page.locator("#cmpPoi").textContent()).trim();
  const tableWithheld = /Withheld|Off|Unavailable/i.test(tableDelta);
  assert.equal(s.relationship === "withheld", tableWithheld, "Bridge and table agree on whether a delta exists");
  if (s.relationship === "comparable") {
    assert.equal(leadingNumber(s.relValue), leadingNumber(tableDelta), "Bridge and table report the same B − A magnitude");
  }
  // 3) The focused table row is the same metric the Bridge shows.
  assert.equal(await rowCurrent(page, "tourism"), "true");
  assert.equal(s.name, "Tourism POIs");
});

for (const viewport of [{ name: "iPad landscape", width: 1024, height: 768 }, { name: "iPad portrait", width: 768, height: 1024 }]) {
  test(`19 Bridge is readable with no horizontal overflow on ${viewport.name}`, async (t) => {
    const page = await openBridge(viewport);
    t.after(() => page.close());
    await focusMetric(page, "tourism", "A", true);
    await page.waitForFunction(() => !document.getElementById("comparisonBridgeMetric").hasAttribute("hidden"));
    const metrics = await page.evaluate(() => {
      const bridge = document.getElementById("comparisonBridge");
      const rect = bridge.getBoundingClientRect();
      return {
        docOverflow: document.documentElement.scrollWidth - window.innerWidth,
        bridgeOverflow: bridge.scrollWidth - bridge.clientWidth,
        visible: rect.width > 0 && rect.height > 0,
      };
    });
    assert.equal(metrics.visible, true, "Bridge is rendered");
    assert.ok(metrics.docOverflow <= 1, `no horizontal page overflow (${metrics.docOverflow}px)`);
    assert.ok(metrics.bridgeOverflow <= 1, `Bridge does not overflow its own box (${metrics.bridgeOverflow}px)`);
  });
}

test.after(async () => {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
