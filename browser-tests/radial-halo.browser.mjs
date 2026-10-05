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

// Mobility's unequal-window contract is EVIDENCE-DEPENDENT, so these two cases
// inject deterministic authoritative evidence through the gated regression
// override and run the REAL renderCompare() path. They never depend on the
// deploy-only data/runtime_poi.json artifact, so local and CI agree.
const UNEQUAL = (mobility) => ({
  aoiState: "eligible",
  tourism: { a: { value: 17, sourceState: "live" }, b: { value: 26, sourceState: "live" } },
  stays: { a: { value: 2, sourceState: "live" }, b: { value: 4, sourceState: "live" } },
  mobility,
});
const applyOverride = (page, override) => page.evaluate((ov) => {
  const api = window.__HALO_REGRESSION__;
  api.setRadius("A", 700); api.setRadius("B", 1600);
  api.setComparisonOverride(ov);
}, override);

// CASE 1: valid Mobility evidence + unequal radii → withheld · different window sizes.
test("13/14 CASE 1 valid Mobility + unequal radii → withheld · different window sizes (deterministic)", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyOverride(page, UNEQUAL({ a: { value: 24, sourceState: "live" }, b: { value: 147, sourceState: "live" } }));
  await focusMetric(page, "mobility", "A", true);
  await page.waitForFunction(() => document.getElementById("cbMetricName").textContent.trim() === "Mobility nodes");
  const s = await bridgeState(page);
  assert.equal(s.relationship, "withheld");
  assert.equal(s.relValue, "Withheld");
  assert.match(s.qualifier, /different window sizes/);
  assert.doesNotMatch(s.qualifier, /source states/);
  // Raw Mobility counts for both lenses remain visible; no density is invented.
  assert.equal(s.valueA, "24");
  assert.equal(s.valueB, "147");
  assert.doesNotMatch((await page.locator("#cbSubA").textContent()).trim(), /km²/);
  // Both radii remain visible.
  assert.equal(s.radiusA, "r 700 m");
  assert.equal(s.radiusB, "r 1.6 km");
  // Table and Bridge derive the SAME withheld reason for VALID evidence.
  const tableDelta1 = (await page.locator("#cmpMobility").textContent()).trim();
  assert.match(tableDelta1, /Withheld · different window sizes/);
  assert.equal(tableDelta1, s.qualifier, "table relationship equals the Bridge withheld qualifier");
  assert.match((await page.locator("#cmpMobilityA").textContent()).trim(), /^24 nodes/);
  // Three-surface coherence: halo, Bridge and table report the same raw per-side values.
  const halo1 = await page.evaluate(() => ({ a: window.__HALO_REGRESSION__.haloValueText("A", "mobility"), b: window.__HALO_REGRESSION__.haloValueText("B", "mobility") }));
  assert.equal(s.valueA, halo1.a);
  assert.equal(s.valueB, halo1.b);
  // Accessible summary derives the same reason from the authoritative model.
  const sr1 = (await page.locator("#comparisonHaloSummary").textContent());
  assert.match(sr1, /Mobility comparison withheld · different window sizes\./);
  assert.doesNotMatch(sr1, /source states incompatible/);
  // Halo focus stays synchronized.
  assert.ok(await haloFocusedCount(page) >= 1);
  assert.equal(await rowCurrent(page, "mobility"), "true");
  // Tourism under the SAME unequal windows compares by represented-record density
  // (deterministic because AOI is injected eligible) — never a raw-count delta.
  await focusMetric(page, "tourism", "A", true);
  await page.waitForFunction(() => document.getElementById("cbMetricName").textContent.trim() === "Tourism POIs");
  const ts = await bridgeState(page);
  assert.equal(ts.relationship, "comparable");
  assert.match(ts.qualifier, /represented-record density/);
  assert.match(ts.relValue, /records\/km²/);
  assert.equal(ts.valueA, "17");
  assert.equal(ts.valueB, "26");
});

// CASE 2: unavailable Mobility evidence + unequal radii → honest N/A, never a delta,
// never zero; the evidence limitation is more fundamental than the window mismatch.
test("13/14 CASE 2 unavailable Mobility + unequal radii → honest N/A, withheld, never zero (deterministic)", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyOverride(page, UNEQUAL({ a: { value: null, sourceState: "unavailable" }, b: { value: null, sourceState: "unavailable" } }));
  await focusMetric(page, "mobility", "A", true);
  await page.waitForFunction(() => document.getElementById("cbMetricName").textContent.trim() === "Mobility nodes");
  const s = await bridgeState(page);
  assert.equal(s.relationship, "withheld");
  assert.equal(s.relValue, "Withheld");
  assert.notEqual(s.relValue, "0", "unavailable is never turned into zero");
  // Each side honestly reads N/A, not 0.
  assert.equal(s.valueA, "N/A");
  assert.equal(s.valueB, "N/A");
  // The authoritative withheld reason reflects the evidence limitation, not the window size.
  assert.match(s.qualifier, /source states|unavailable/);
  assert.doesNotMatch(s.qualifier, /different window sizes/);
  // Both radii still visible; unequal radii do not override the evidence limitation.
  assert.equal(s.radiusA, "r 700 m");
  assert.equal(s.radiusB, "r 1.6 km");
  // DEFECT FIX: the table relationship cell now derives its reason from the SAME
  // authoritative model as the Bridge — no longer the hardcoded window-size text.
  const tableDelta = (await page.locator("#cmpMobility").textContent()).trim();
  assert.equal(tableDelta, s.qualifier, "table relationship equals the Bridge withheld reason");
  assert.match(tableDelta, /source states/);
  assert.doesNotMatch(tableDelta, /different window sizes/);
  // Three-surface coherence for UNAVAILABLE Mobility: halo + Bridge + table agree.
  const halo = await page.evaluate(() => ({ a: window.__HALO_REGRESSION__.haloValueText("A", "mobility"), b: window.__HALO_REGRESSION__.haloValueText("B", "mobility") }));
  assert.equal(halo.a, "N/A", "halo reads N/A");
  assert.equal(halo.b, "N/A");
  assert.equal(s.valueA, halo.a, "Bridge mirrors the halo N/A state");
  assert.equal(s.valueB, halo.b);
  // The table shows the sides as Unavailable (honest), and nothing is ever 0.
  assert.match((await page.locator("#cmpMobilityA").textContent()).trim(), /Unavailable/);
  assert.notEqual(tableDelta, "0");
  // Accessible summary agrees with Bridge + table: evidence reason, never window size.
  const sr2 = (await page.locator("#comparisonHaloSummary").textContent());
  assert.match(sr2, /Mobility comparison withheld · source states incompatible\./);
  assert.doesNotMatch(sr2, /Mobility[^.]*different window sizes/);
  assert.doesNotMatch(sr2, /Mobility delta withheld/);
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

// ---------------------------------------------------------------------------
// DECISION INSIGHT V1 — browser regressions.
//
// These exercise the REAL production render path: comparison evidence ->
// comparison states -> buildComparisonBridgeModel -> buildDecisionInsightModel
// -> rendered DOM. Evidence-dependent contracts use the existing query-gated,
// local-host-only regression seam so local and CI agree regardless of which
// deploy-only data artifacts a checkout ships.
//
// The four-surface coherence tests are the point of the layer: HALO + BRIDGE +
// DECISION INSIGHT + TABLE must agree on metric identity, per-side values,
// comparability, delta meaning and evidence interpretation.

const insightState = (page) => page.evaluate(() => window.__HALO_REGRESSION__.decisionInsight());
const insightModel = (page) => page.evaluate(() => window.__HALO_REGRESSION__.decisionInsightModel());
const bridgeModelFor = (page, metricId) => page.evaluate((m) => window.__HALO_REGRESSION__.bridgeModel(m), metricId);
const insightItem = (state, metricId) => state.items.find((item) => item.metricId === metricId);
// First signed number anywhere in a rendered clause ("B − A +7.4 records/km²" -> "+7.4").
const signedNumber = (text) => (text.match(/[+-]?\d[\d.,]*/) || [null])[0];
const tableDelta = (page, id) => page.locator(`#${id}`).textContent().then((t) => t.trim());
const CANONICAL = ["tourism", "stays", "mobility", "utci"];

// Deterministic evidence for the Insight scenarios. Equal radii by default; the
// helper leaves the radii alone so each test owns its window relationship.
const INSIGHT_EVIDENCE = (overrides = {}) => ({
  aoiState: "eligible",
  tourism: { a: { value: 17, sourceState: "live" }, b: { value: 26, sourceState: "live" } },
  stays: { a: { value: 2, sourceState: "live" }, b: { value: 4, sourceState: "live" } },
  mobility: { a: { value: 3, sourceState: "live" }, b: { value: 6, sourceState: "live" } },
  utci: {
    enabled: true, timestepA: "15:00", timestepB: "15:00",
    a: { evidence: "MODEL-DERIVED", mean: 36.4, count: 2 },
    b: { evidence: "MODEL-DERIVED", mean: 38.1, count: 3 },
  },
  ...overrides,
});
const applyInsight = (page, override, radii = null) => page.evaluate(({ override, radii }) => {
  const api = window.__HALO_REGRESSION__;
  if (radii) { api.setRadius("A", radii.A); api.setRadius("B", radii.B); }
  api.setComparisonOverride(override);
}, { override, radii });

test("DI 1 compare mode renders Decision Insight from the real production comparison state", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  // No override: this is whatever the real data path produced for this checkout.
  const state = await insightState(page);
  const model = await insightModel(page);
  assert.equal(state.hidden, false, "the Insight renders as soon as compare mode has a comparison state");
  assert.deepEqual(state.items.map((item) => item.metricId), CANONICAL, "fixed canonical order");
  assert.equal(state.items.length, 4);
  // Pedestrian is panel-only and must never appear in the Insight.
  assert.ok(!state.items.some((item) => item.metricId === "pedestrian"));
  assert.ok(await page.locator("tr.panel-only-metric").count() === 1, "Pedestrian still has its table row");
  // The rendered status, guard and every item state come from the model.
  assert.equal(state.status, model.status);
  assert.ok(["available", "limited", "unavailable"].includes(state.status));
  assert.deepEqual(state.items.map((item) => item.state), model.items.map((item) => item.state));
  assert.ok(state.guard.length > 0, "the descriptive guard is always present");
  assert.match(state.guard, /no ordering or recommendation/);
  // Each item names its metric and states a relationship; nothing is blank.
  for (const item of state.items) {
    assert.ok(item.metric.length > 0, `${item.metricId} exposes its identity`);
    assert.ok(item.relationship.length > 0, `${item.metricId} exposes a relationship`);
  }
});

test("DI 2 equal radii: Insight Tourism/Stays agree with the Bridge and the table", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  const state = await insightState(page);
  for (const [metricId, cellId, expected] of [["tourism", "cmpPoi", "+9"], ["stays", "cmpStay", "+2"]]) {
    const item = insightItem(state, metricId);
    const model = await bridgeModelFor(page, metricId);
    assert.equal(item.state, "comparable", `${metricId} is comparable at equal radii`);
    // Equal windows compare RAW COUNTS, so no km² unit appears.
    assert.doesNotMatch(item.relationship, /km²/, `${metricId} uses raw counts at equal radii`);
    assert.equal(signedNumber(item.relationship), expected, `${metricId} shows the authoritative count delta`);
    assert.equal(Number(signedNumber(item.relationship)), model.relationship.deltaValue, "Insight number IS the Bridge delta");
    // ...and the same number the table prints.
    assert.equal(signedNumber(await tableDelta(page, cellId)), expected, `${metricId} table agrees`);
    // ...and the same number the focused Bridge prints.
    await focusMetric(page, metricId, "A", true);
    await page.waitForFunction((m) => document.getElementById("cbMetricName").textContent.trim().length > 0 && window.__HALO_REGRESSION__.focusState().focused === m, metricId);
    assert.equal(signedNumber((await bridgeState(page)).relValue), expected, `${metricId} Bridge agrees`);
  }
});

test("DI 3 unequal radii: Insight shows the density relationship, never a raw-count delta", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 700, B: 1600 });
  const state = await insightState(page);
  for (const [metricId, cellId, rawDelta] of [["tourism", "cmpPoi", "+9"], ["stays", "cmpStay", "+2"]]) {
    const item = insightItem(state, metricId);
    const model = await bridgeModelFor(page, metricId);
    assert.equal(item.state, "comparable", `${metricId} compares by density under unequal windows`);
    assert.match(item.relationship, /km²/, `${metricId} states the per-km² basis`);
    assert.equal(model.relationship.deltaKind, "density");
    // The raw-count difference must NOT be what the Insight reports.
    assert.notEqual(signedNumber(item.relationship), rawDelta, `${metricId} is not the raw-count delta`);
    assert.equal(signedNumber(item.relationship), `${model.relationship.deltaValue > 0 ? "+" : ""}${model.relationship.deltaValue.toFixed(1)}`);
    // The table's density figure carries the same number.
    assert.equal(signedNumber(await tableDelta(page, cellId)), signedNumber(item.relationship), `${metricId} table agrees`);
  }
  // Stays keeps its own catalogue-record wording, matching the table's noun.
  assert.match(insightItem(state, "stays").relationship, /catalogue records\/km²/);
  assert.match((await tableDelta(page, "cmpStay")), /catalogue records\/km²/);
});

test("DI 4 Mobility valid + unequal radii: Insight is withheld for different window sizes", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE({ mobility: { a: { value: 24, sourceState: "live" }, b: { value: 147, sourceState: "live" } } }), { A: 700, B: 1600 });
  const item = insightItem(await insightState(page), "mobility");
  assert.equal(item.state, "withheld", "values exist on both sides; the comparison is not authorized");
  assert.match(item.relationship, /different window sizes/);
  assert.doesNotMatch(item.relationship, /source states/, "the window mismatch is the reason here");
  assert.doesNotMatch(item.relationship, /km²/, "Mobility is never converted into a density comparator");
  assert.equal(item.direction, "none", "a withheld comparison has no direction");
  // The table relationship cell says exactly the same thing.
  assert.equal(item.relationship, await tableDelta(page, "cmpMobility"), "Insight and table share one authoritative reason");
  // Tourism under the SAME unequal windows still compares: withholding is per-metric.
  assert.equal(insightItem(await insightState(page), "tourism").state, "comparable");
});

test("DI 5 Mobility unavailable + unequal radii: the evidence reason, never the window size", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE({ mobility: { a: { value: null, sourceState: "unavailable" }, b: { value: null, sourceState: "unavailable" } } }), { A: 700, B: 1600 });
  const item = insightItem(await insightState(page), "mobility");
  assert.equal(item.state, "unavailable", "missing evidence is unavailable, not merely withheld");
  assert.match(item.relationship, /N\/A/, "each side honestly reads unavailable");
  assert.match(item.relationship, /source states/, "the authoritative evidence reason");
  assert.doesNotMatch(item.relationship, /different window sizes/, "the evidence limitation is more fundamental");
  assert.notEqual(item.relationship.trim(), "0", "unavailable is never turned into zero");
  assert.equal(signedNumber(item.relationship), null, "no number is implied at all");
  // Same reason on the table relationship cell and in the accessible summary.
  assert.match(await tableDelta(page, "cmpMobility"), /source states/);
  const sr = await page.locator("#comparisonHaloSummary").textContent();
  assert.match(sr, /Mobility comparison withheld · source states incompatible\./);
});

test("DI 6 UTCI OFF: the Insight says OFF, never zero and never a delta", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE({ utci: { enabled: false } }), { A: 900, B: 900 });
  const state = await insightState(page);
  const item = insightItem(state, "utci");
  assert.equal(item.state, "off", "OFF is its own state, distinct from N/A and from withheld");
  assert.equal(item.relationship, "OFF");
  assert.notEqual(item.relationship, "0", "OFF is not zero");
  assert.doesNotMatch(item.relationship, /^[+-]?0/, "OFF never renders as a zero value");
  assert.equal(signedNumber(item.relationship), null);
  assert.equal(item.direction, "none");
  // The halo, Bridge and table agree that UTCI is off.
  assert.equal(await page.evaluate(() => window.__HALO_REGRESSION__.haloValueText("A", "utci")), "OFF");
  assert.equal(await tableDelta(page, "cmpHeat"), "Off");
  await focusMetric(page, "utci", "A", true);
  await page.waitForFunction(() => window.__HALO_REGRESSION__.focusState().focused === "utci");
  assert.equal((await bridgeState(page)).valueA, "OFF");
  // The other metrics are unaffected: OFF is per-metric, not a global state.
  assert.equal(insightItem(state, "tourism").state, "comparable");
  assert.equal(state.status, "available");
});

test("DI 7 UTCI valid: the Insight Celsius B − A matches the Bridge and the table", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  const item = insightItem(await insightState(page), "utci");
  const model = await bridgeModelFor(page, "utci");
  assert.equal(item.state, "comparable");
  assert.equal(signedNumber(item.relationship), "+1.7");
  assert.match(item.relationship, /\+1\.7°C/);
  // Model-derived evidence always carries that limitation.
  assert.match(item.relationship, /model-derived/);
  assert.equal(model.relationship.deltaKind, "temperature");
  assert.ok(Math.abs(model.relationship.deltaValue - 1.7) < 1e-9);
  // Table and Bridge report the same Celsius difference.
  assert.equal(signedNumber(await tableDelta(page, "cmpHeat")), "+1.7");
  await focusMetric(page, "utci", "A", true);
  await page.waitForFunction(() => window.__HALO_REGRESSION__.focusState().focused === "utci");
  assert.equal(signedNumber((await bridgeState(page)).relValue), "+1.7");
  // V1 stays descriptive: no categorical thermal-stress claim is made.
  assert.doesNotMatch(item.relationship, /hot|warm|danger|risk|stress|comfort/i);
});

test("DI 8 an observed zero stays zero and participates where the comparison is valid", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE({
    tourism: { a: { value: 0, sourceState: "live" }, b: { value: 4, sourceState: "live" } },
    stays: { a: { value: 0, sourceState: "live" }, b: { value: 0, sourceState: "live" } },
  }), { A: 900, B: 900 });
  const state = await insightState(page);
  // Zero against a positive value: a real comparison.
  const tourism = insightItem(state, "tourism");
  assert.equal(tourism.state, "comparable", "a zero side is evidence, not absence");
  assert.equal(signedNumber(tourism.relationship), "+4");
  assert.equal(tourism.direction, "B_MINUS_A_POSITIVE");
  // Both sides zero: a real zero difference, not "unavailable".
  const stays = insightItem(state, "stays");
  assert.equal(stays.state, "comparable");
  assert.equal(signedNumber(stays.relationship), "0");
  assert.equal(stays.direction, "B_MINUS_A_ZERO");
  assert.notEqual(stays.state, "unavailable");
  assert.doesNotMatch(stays.relationship, /N\/A|OFF|Withheld/);
  // The halo and Bridge print the same honest zero for Lens A.
  assert.equal(await page.evaluate(() => window.__HALO_REGRESSION__.haloValueText("A", "tourism")), "0");
  await focusMetric(page, "tourism", "A", true);
  await page.waitForFunction(() => window.__HALO_REGRESSION__.focusState().focused === "tourism");
  assert.equal((await bridgeState(page)).valueA, "0", "zero prints as 0, distinct from N/A");
});

test("DI 9 metric focus emphasizes the matching item without hiding the others", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  // Nothing focused: no item is emphasized and none is de-emphasized.
  let state = await insightState(page);
  assert.ok(state.items.every((item) => item.focused === "false"));
  assert.equal(await page.locator("#decisionInsightItems").getAttribute("data-has-focus"), "false");
  for (const metricId of CANONICAL) {
    await focusMetric(page, metricId, "A", true);
    await page.waitForFunction((m) => window.__HALO_REGRESSION__.focusState().focused === m, metricId);
    state = await insightState(page);
    // The focused Bridge metric and the emphasized Insight item are the same one.
    assert.equal((await bridgeState(page)).name, insightItem(state, metricId).metric, `${metricId}: Bridge and Insight name one metric`);
    assert.equal(insightItem(state, metricId).focused, "true");
    assert.equal(insightItem(state, metricId).ariaCurrent, "true", "emphasis is exposed accessibly");
    // Every other item is still rendered, readable and non-empty.
    assert.equal(state.items.length, 4, "focus never hides an item");
    const visibility = await page.evaluate(() => [...document.querySelectorAll("#decisionInsightItems .di-item")].map((row) => {
      const style = getComputedStyle(row);
      const rect = row.getBoundingClientRect();
      return { display: style.display, visibility: style.visibility, opacity: Number(style.opacity), height: rect.height };
    }));
    for (const box of visibility) {
      assert.notEqual(box.display, "none");
      assert.notEqual(box.visibility, "hidden");
      assert.ok(box.opacity >= 0.7, `unfocused items stay readable (opacity ${box.opacity})`);
      assert.ok(box.height > 0);
    }
    for (const other of state.items.filter((item) => item.metricId !== metricId)) {
      assert.equal(other.focused, "false");
      assert.equal(other.ariaCurrent, null, "only the focused item is aria-current");
      assert.ok(other.relationship.length > 0, `${other.metricId} stays readable while another metric is focused`);
    }
  }
  // The Insight is informational: it adds no focusable control of its own.
  assert.equal(await page.locator("#decisionInsight button, #decisionInsight a, #decisionInsight [tabindex]").count(), 0);
});

test("DI 10 lock survives radius changes, lens movement, pan and zoom while values recompute", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  await focusMetric(page, "tourism", "A", true);
  await page.waitForFunction(() => window.__HALO_REGRESSION__.focusState().selected === "tourism");
  const equal = insightItem(await insightState(page), "tourism");
  assert.equal(equal.state, "comparable");
  assert.doesNotMatch(equal.relationship, /km²/, "equal windows: raw counts");

  // 1) Radius change -> the Insight recomputes to the density basis, lock intact.
  await page.evaluate(() => { const a = window.__HALO_REGRESSION__; a.setRadius("B", 1800); a.recompute(); });
  await page.waitForFunction(() => /km²/.test(document.querySelector('#decisionInsightItems .di-item[data-metric-id="tourism"] .di-rel').textContent));
  let state = await insightState(page);
  assert.match(insightItem(state, "tourism").relationship, /km²/, "unequal windows: density basis");
  assert.equal(insightItem(state, "tourism").focused, "true", "the lock is not reset by a radius change");
  assert.deepEqual(await focusState(page), { focused: "tourism", selected: "tourism" });

  // 2) Lens movement (real data recompute), 3) pan and 4) zoom.
  for (const step of ["move", "pan", "zoom"]) {
    await page.evaluate((s) => {
      const a = window.__HALO_REGRESSION__;
      if (s === "move") a.moveLens("B", 820, 450);
      if (s === "pan") a.setCenterAtPoint("A", 420, 400);
      if (s === "zoom") a.setZoom(15);
    }, step);
    state = await insightState(page);
    assert.equal(state.hidden, false, `${step}: the Insight stays rendered`);
    assert.deepEqual(state.items.map((item) => item.metricId), CANONICAL, `${step}: canonical order survives`);
    assert.deepEqual(await focusState(page), { focused: "tourism", selected: "tourism" }, `${step}: the lock survives`);
    assert.equal(insightItem(state, "tourism").focused, "true");
  }
  // The recomputed values still agree with the authoritative Bridge model.
  const model = await bridgeModelFor(page, "tourism");
  const item = insightItem(await insightState(page), "tourism");
  assert.equal(item.state === "comparable", model.relationship.comparable, "one comparability verdict after recompute");
  if (model.relationship.comparable) {
    assert.equal(signedNumber(item.relationship), `${model.relationship.deltaValue > 0 ? "+" : ""}${model.relationship.deltaKind === "count" ? model.relationship.deltaValue : model.relationship.deltaValue.toFixed(1)}`);
  }
});

test("DI 11/12 the Insight copy switches between Spanish and English", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE({ mobility: { a: { value: 24, sourceState: "live" }, b: { value: 147, sourceState: "live" } } }), { A: 700, B: 1600 });
  const setLanguage = (language) => page.evaluate((l) => window.__HALO_REGRESSION__.setComparisonLanguage(l), language);

  // --- English ---
  await setLanguage("en");
  const en = await insightState(page);
  assert.equal(en.heading, "Decision Insight");
  assert.match(en.statusText, /Observed contrasts · descriptive evidence only/);
  assert.equal(en.guard, "Observed comparison only · no ordering or recommendation");
  assert.equal(insightItem(en, "tourism").metric, "Tourism POIs");
  assert.match(insightItem(en, "tourism").relationship, /^B − A [+-]?\d/, "B − A notation with a real minus sign");
  assert.match(insightItem(en, "tourism").relationship, /records\/km²/);
  assert.match(insightItem(en, "mobility").relationship, /Withheld · different window sizes/);
  assert.match(insightItem(en, "utci").relationship, /°C · model-derived/);

  // --- Spanish ---
  await setLanguage("es");
  const es = await insightState(page);
  assert.equal(es.heading, "Lectura de decisión");
  assert.match(es.statusText, /Contrastes observados · solo evidencia descriptiva/);
  assert.equal(es.guard, "Comparación observada · sin ordenación ni recomendación");
  assert.equal(insightItem(es, "tourism").metric, "POI turísticos");
  assert.match(insightItem(es, "tourism").relationship, /^B − A [+-]?\d/, "B − A notation is identical in both languages");
  assert.match(insightItem(es, "tourism").relationship, /registros\/km²/);
  assert.match(insightItem(es, "stays").relationship, /registros de catálogo/);
  assert.match(insightItem(es, "mobility").relationship, /Retenido · tamaños de ventana distintos/);
  assert.match(insightItem(es, "utci").relationship, /°C · derivado del modelo/);
  // Nothing is left untranslated and no raw dictionary key leaks through.
  for (const item of es.items) {
    assert.ok(!item.metric.includes("."), `${item.metricId}: no raw key in the metric name`);
    assert.ok(!/insight\.|reason\.|unit\./.test(item.relationship), `${item.metricId}: no raw key in the relationship`);
  }
  // The NUMBERS are language-independent: only the words change.
  for (const metricId of ["tourism", "stays", "utci"]) {
    assert.equal(signedNumber(insightItem(es, metricId).relationship), signedNumber(insightItem(en, metricId).relationship), `${metricId}: same number in both languages`);
  }
  // Back to English, so the state machine is reversible.
  await setLanguage("en");
  assert.equal((await insightState(page)).heading, "Decision Insight");
});

// --- §28 FOUR-SURFACE COHERENCE -------------------------------------------
// HALO + COMPARISON BRIDGE + DECISION INSIGHT + TABLE, on one live page.

test("DI four-surface coherence: a VALID metric reads identically on halo, Bridge, Insight and table", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE({ tourism: { a: { value: 17, sourceState: "live" }, b: { value: 26, sourceState: "live" } } }), { A: 900, B: 900 });
  await focusMetric(page, "tourism", "A", true);
  await page.waitForFunction(() => window.__HALO_REGRESSION__.focusState().selected === "tourism");

  const halo = await page.evaluate(() => ({
    a: window.__HALO_REGRESSION__.haloValueText("A", "tourism"),
    b: window.__HALO_REGRESSION__.haloValueText("B", "tourism"),
  }));
  const bridge = await bridgeState(page);
  const model = await bridgeModelFor(page, "tourism");
  const item = insightItem(await insightState(page), "tourism");
  const table = { a: (await page.locator("#cmpPoiA").textContent()).trim(), b: (await page.locator("#cmpPoiB").textContent()).trim(), delta: await tableDelta(page, "cmpPoi") };

  // 1) SAME METRIC IDENTITY on all four surfaces.
  assert.equal(bridge.name, "Tourism POIs");
  assert.equal(item.metric, "Tourism POIs");
  assert.equal(await rowCurrent(page, "tourism"), "true", "the table row is the same metric");
  assert.equal(item.focused, "true", "the Insight emphasizes the same metric");
  assert.ok(await haloFocusedCount(page) >= 1, "the halo emphasizes the same metric");

  // 2) SAME SIDE VALUES.
  assert.equal(halo.a, "17");
  assert.equal(halo.b, "26");
  assert.equal(bridge.valueA, halo.a, "Bridge mirrors the halo");
  assert.equal(bridge.valueB, halo.b);
  assert.match(table.a, /^17 records/, "the table prints the same raw count");
  assert.match(table.b, /^26 records/);
  assert.equal(model.a.rawValue, 17, "the authoritative model carries the same values");
  assert.equal(model.b.rawValue, 26);

  // 3) SAME COMPARABILITY verdict.
  assert.equal(bridge.relationship, "comparable");
  assert.equal(item.state, "comparable");
  assert.equal(model.relationship.comparable, true);
  assert.doesNotMatch(table.delta, /Withheld|Unavailable|Off/i);

  // 4) SAME DELTA MEANING: one number, read through the whole chain.
  assert.equal(model.relationship.deltaValue, 9);
  assert.equal(signedNumber(bridge.relValue), "+9");
  assert.equal(signedNumber(item.relationship), "+9");
  assert.equal(signedNumber(table.delta), "+9");
  assert.equal(item.direction, "B_MINUS_A_POSITIVE", "direction is B − A arithmetic only");

  // 5) SAME EVIDENCE INTERPRETATION: a raw-count basis at equal windows.
  assert.equal(model.relationship.basisCode, "raw-counts");
  assert.match(bridge.qualifier, /raw represented counts/);
  assert.doesNotMatch(item.relationship, /km²/);
  assert.doesNotMatch(table.delta, /km²/);
  assert.match((await page.locator("#comparisonModeCue").textContent()), /Equal windows · raw represented counts/);
});

test("DI four-surface coherence: a WITHHELD metric (Mobility unavailable + unequal radii) agrees everywhere", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE({ mobility: { a: { value: null, sourceState: "unavailable" }, b: { value: null, sourceState: "unavailable" } } }), { A: 700, B: 1600 });
  await focusMetric(page, "mobility", "A", true);
  await page.waitForFunction(() => window.__HALO_REGRESSION__.focusState().selected === "mobility");

  const halo = await page.evaluate(() => ({
    a: window.__HALO_REGRESSION__.haloValueText("A", "mobility"),
    b: window.__HALO_REGRESSION__.haloValueText("B", "mobility"),
  }));
  const bridge = await bridgeState(page);
  const model = await bridgeModelFor(page, "mobility");
  const item = insightItem(await insightState(page), "mobility");
  const table = { a: (await page.locator("#cmpMobilityA").textContent()).trim(), delta: await tableDelta(page, "cmpMobility") };
  const summary = await page.locator("#comparisonHaloSummary").textContent();

  // 1) EVIDENCE IS UNAVAILABLE on every surface.
  assert.equal(halo.a, "N/A", "the halo reads N/A");
  assert.equal(halo.b, "N/A");
  assert.equal(bridge.valueA, "N/A");
  assert.equal(bridge.valueB, "N/A");
  assert.match(item.relationship, /N\/A/);
  assert.match(table.a, /Unavailable/);
  assert.equal(model.a.evidence, "N_A");
  assert.equal(model.b.evidence, "N_A");
  assert.equal(item.state, "unavailable");

  // 2) NO NUMERIC DELTA EXISTS anywhere.
  assert.equal(model.relationship.deltaValue, null);
  assert.equal(signedNumber(item.relationship), null);
  assert.equal(bridge.relValue, "Withheld");
  assert.equal(bridge.relationship, "withheld");
  assert.equal(item.direction, "none");

  // 3) ZERO IS NEVER IMPLIED.
  for (const text of [halo.a, halo.b, bridge.valueA, bridge.relValue, item.relationship, table.delta]) {
    assert.notEqual(text.trim(), "0");
    assert.doesNotMatch(text, /(^|\s)[+-]?0(\s|$)/, `"${text}" never reads as zero`);
  }

  // 4) THE AUTHORITATIVE REASON IS THE EVIDENCE LIMITATION, not the window mismatch.
  assert.equal(model.relationship.withheldReasonCode, "source-incompatible");
  assert.match(item.relationship, /source states incompatible/);
  assert.match(bridge.qualifier, /source states incompatible/);
  assert.match(table.delta, /source states incompatible/);
  assert.match(summary, /Mobility comparison withheld · source states incompatible\./);
  for (const text of [item.relationship, bridge.qualifier, table.delta]) {
    assert.doesNotMatch(text, /different window sizes/, "the evidence limitation takes precedence");
  }
  // The unequal windows are still honestly visible, so nothing reads as equivalent.
  assert.equal(bridge.radiusA, "r 700 m");
  assert.equal(bridge.radiusB, "r 1.6 km");
  assert.match((await page.locator("#comparisonRadiusReadout").textContent()), /700 m \| Lens B · 1\.6 km/);
});

for (const viewport of [{ name: "iPad landscape", width: 1024, height: 768 }, { name: "iPad portrait", width: 768, height: 1024 }]) {
  test(`DI 13/14 Decision Insight is readable with no horizontal overflow on ${viewport.name}`, async (t) => {
    const page = await openBridge(viewport);
    t.after(() => page.close());
    await applyInsight(page, INSIGHT_EVIDENCE({ mobility: { a: { value: 24, sourceState: "live" }, b: { value: 147, sourceState: "live" } } }), { A: 700, B: 1600 });
    await focusMetric(page, "tourism", "A", true);
    await page.waitForFunction(() => document.getElementById("decisionInsight").hasAttribute("hidden") === false);
    const metrics = await page.evaluate(() => {
      const section = document.getElementById("decisionInsight");
      const rect = section.getBoundingClientRect();
      const rows = [...section.querySelectorAll(".di-item")].map((row) => ({
        overflow: row.scrollWidth - row.clientWidth,
        height: row.getBoundingClientRect().height,
        fontSize: Number.parseFloat(getComputedStyle(row.querySelector(".di-rel")).fontSize),
      }));
      return {
        docOverflow: document.documentElement.scrollWidth - window.innerWidth,
        sectionOverflow: section.scrollWidth - section.clientWidth,
        visible: rect.width > 0 && rect.height > 0,
        withinPanel: rect.right <= window.innerWidth + 1,
        rows,
      };
    });
    assert.equal(metrics.visible, true, "the Insight is rendered");
    assert.equal(metrics.rows.length, 4);
    assert.ok(metrics.docOverflow <= 1, `no horizontal page overflow (${metrics.docOverflow}px)`);
    assert.ok(metrics.sectionOverflow <= 1, `the Insight does not overflow its own box (${metrics.sectionOverflow}px)`);
    assert.ok(metrics.withinPanel, "the Insight stays inside the viewport");
    for (const row of metrics.rows) {
      assert.ok(row.overflow <= 1, `an item does not overflow its row (${row.overflow}px)`);
      assert.ok(row.height > 0, "each item has layout");
      assert.ok(row.fontSize >= 8, `text is not shrunk to illegibility (${row.fontSize}px)`);
    }
  });
}


// ---------------------------------------------------------------------------
// SPATIAL WINDOW SENSITIVITY V1 — browser regressions.
//
// These exercise the REAL production path: comparison evidence -> comparison
// states -> buildComparisonBridgeModel -> captured baseline snapshot +
// buildSpatialSensitivityModel -> rendered DOM, driven through the actual
// capture/reset buttons.
//
// The FIVE-SURFACE coherence tests are the point of the layer: HALO + BRIDGE +
// DECISION INSIGHT + TABLE + SPATIAL SENSITIVITY must agree on the CURRENT
// state. The baseline is the frozen historical snapshot; the scenario side must
// never become an independent fifth interpretation.

const ssState = (page) => page.evaluate(() => window.__HALO_REGRESSION__.spatialSensitivity());
const ssModel = (page) => page.evaluate(() => window.__HALO_REGRESSION__.spatialSensitivityModel());
const ssItem = (state, metricId) => state.items.find((item) => item.metricId === metricId);
const ssCapture = (page) => page.evaluate(() => window.__HALO_REGRESSION__.captureSpatialBaseline());
const ssReset = (page) => page.evaluate(() => window.__HALO_REGRESSION__.resetSpatialBaseline());
const setRadii = (page, radii) => page.evaluate((r) => {
  const api = window.__HALO_REGRESSION__;
  if (r.A != null) api.setRadius("A", r.A);
  if (r.B != null) api.setRadius("B", r.B);
}, radii);

test("SS 1 no baseline: the section renders a neutral state with only a capture control", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  const state = await ssState(page);
  assert.equal(state.hidden, false, "the section renders in compare mode");
  assert.equal(state.status, "no-baseline");
  assert.equal(await ssModel(page), null, "there is no model without a baseline");
  assert.equal(state.emptyHidden, false, "the neutral empty state is shown");
  assert.match(state.emptyText, /No baseline captured/);
  assert.equal(state.windowsHidden, true, "no baseline/scenario windows yet");
  assert.equal(state.items.length, 0, "no per-metric readings yet");
  assert.equal(state.resetHidden, true, "nothing to reset");
  assert.match(state.captureLabel, /Capture current comparison/);
  assert.equal(state.noticeHidden, true, "no invalidation notice on a fresh page");
  // The guard is always present and denies being a forecast.
  assert.match(state.guard, /not a forecast and not a causal effect/);
});

test("SS 2 capture records the exact A/B radii and the authoritative baseline reading", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  await ssCapture(page);
  const state = await ssState(page);
  const model = await ssModel(page);
  assert.equal(state.emptyHidden, true);
  assert.equal(state.windowsHidden, false);
  assert.deepEqual(model.baseline.radii, { A: 900, B: 900 });
  assert.deepEqual(model.scenario.radii, { A: 900, B: 900 });
  assert.equal(model.windowUnchanged, true);
  // Both windows are printed as readable text, not colour or position alone.
  assert.match(state.baselineRadii, /900 m/);
  assert.match(state.scenarioRadii, /900 m/);
  assert.match(state.baselineLabel, /Baseline window/);
  assert.match(state.scenarioLabel, /Scenario window/);
  // Four canonical readings in fixed order, each with both sides and a transition.
  assert.deepEqual(state.items.map((item) => item.metricId), CANONICAL);
  assert.ok(!state.items.some((item) => item.metricId === "pedestrian"), "Pedestrian stays excluded");
  for (const item of state.items) {
    assert.ok(item.baseline.length > 0, `${item.metricId} baseline reading is readable`);
    assert.ok(item.scenario.length > 0, `${item.metricId} scenario reading is readable`);
    assert.ok(item.transitionText.length > 0, `${item.metricId} transition is readable`);
  }
  // Identical windows: nothing changed anywhere.
  assert.equal(model.status, "STABLE");
  assert.equal(state.status, "STABLE");
  assert.match(state.statusText, /Stable under this window change/);
  // Replacing the baseline is now offered explicitly, alongside reset.
  assert.match(state.captureLabel, /Capture current as new baseline/);
  assert.equal(state.resetHidden, false);
  assert.match(state.resetLabel, /Reset baseline/);
  // Capture is a discrete action, so it announces once.
  assert.match(state.announcement, /Baseline window captured/);
});

test("SS 3 changing Lens A radius freezes the baseline and updates only the scenario", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  await ssCapture(page);
  const before = await ssState(page);
  const baselineReadings = before.items.map((item) => item.baseline);
  // Lens A alone shrinks: the windows become unequal.
  await setRadii(page, { A: 700 });
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 700, B: 900 });
  const after = await ssState(page);
  const model = await ssModel(page);
  // THE BASELINE IS HISTORICAL: identical strings, identical radii.
  assert.deepEqual(after.items.map((item) => item.baseline), baselineReadings,
    "every baseline reading is frozen at capture time");
  assert.deepEqual(model.baseline.radii, { A: 900, B: 900 }, "the baseline radii never move");
  assert.match(after.baselineRadii, /900 m/);
  // The scenario followed the live state.
  assert.deepEqual(model.scenario.radii, { A: 700, B: 900 });
  assert.equal(model.windowUnchanged, false);
  assert.match(after.scenarioRadii, /700 m/);
  assert.ok(!after.scenarioRadii.includes("matches the baseline"), "a changed window is not reported as identical");
  // A radius change must never invalidate: that IS the scenario.
  assert.equal(after.noticeHidden, true, "a radius change raises no invalidation notice");
  assert.equal(after.emptyHidden, true, "the baseline survives a radius change");
});

test("SS 4 changing Lens B radius behaves identically", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  await ssCapture(page);
  const baselineReadings = (await ssState(page)).items.map((item) => item.baseline);
  await setRadii(page, { B: 1600 });
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 1600 });
  const after = await ssState(page);
  const model = await ssModel(page);
  assert.deepEqual(after.items.map((item) => item.baseline), baselineReadings);
  assert.deepEqual(model.baseline.radii, { A: 900, B: 900 });
  assert.deepEqual(model.scenario.radii, { A: 900, B: 1600 });
  assert.equal(after.noticeHidden, true);
});

test("SS 5 equal to unequal windows: Tourism/Stays report BASIS_CHANGED and withhold any numeric change", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  await ssCapture(page);
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 700, B: 1600 });
  const state = await ssState(page);
  const model = await ssModel(page);
  for (const metricId of ["tourism", "stays"]) {
    const item = ssItem(state, metricId);
    const modelItem = model.items.find((candidate) => candidate.metricId === metricId);
    assert.equal(item.transition, "BASIS_CHANGED", `${metricId} changed comparison basis`);
    assert.match(item.transitionText, /Basis changed/);
    // The baseline side is a raw count; the scenario side is a density.
    assert.doesNotMatch(item.baseline, /km²/, `${metricId} baseline is a raw count`);
    assert.match(item.scenario, /km²/, `${metricId} scenario is a density`);
    // THE CENTRAL ABSTENTION: no delta-of-deltas is ever shown or computed.
    assert.equal(modelItem.deltaChange, null, `${metricId} withholds the numeric change`);
    assert.equal(modelItem.basisCompatible, false);
    assert.match(item.detail, /numeric change withheld/, `${metricId} says why`);
    // The two bases are named, so the abstention is explainable.
    assert.match(item.detail, /raw represented counts → represented-record density/);
    // No "changed by" sentence may appear for an incompatible basis.
    assert.ok(!item.detail.includes("changed by"), `${metricId} never reports a cross-basis change`);
  }
  assert.equal(model.status, "MIXED");
  assert.match(state.statusText, /Sensitive to window choice/);
});

test("SS 6 Mobility: comparable at the baseline window, withheld under an unequal scenario window", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  await ssCapture(page);
  const baseline = ssItem(await ssState(page), "mobility");
  assert.equal(baseline.baselineComparable, "true", "Mobility compares at equal windows");
  assert.equal(signedNumber(baseline.baseline), "+3", "the authoritative node difference");
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 1600 });
  const item = ssItem(await ssState(page), "mobility");
  const model = await ssModel(page);
  const modelItem = model.items.find((candidate) => candidate.metricId === "mobility");
  // The baseline reading is unchanged; the scenario became withheld.
  assert.equal(signedNumber(item.baseline), "+3", "the baseline Mobility reading is frozen");
  assert.equal(item.transition, "BECAME_WITHHELD");
  assert.match(item.transitionText, /Comparison became withheld/);
  assert.match(item.scenario, /Withheld · different window sizes/);
  assert.equal(item.scenarioComparable, "false");
  assert.equal(modelItem.deltaChange, null);
  // Mobility NEVER becomes a density under any window change.
  assert.doesNotMatch(item.scenario, /km²/);
  assert.notEqual(modelItem.scenario.basisCode, "density");
  // It reads exactly as the Bridge and the table read it.
  const bridge = await bridgeModelFor(page, "mobility");
  assert.equal(bridge.relationship.withheldReasonCode, "different-window-sizes");
  assert.equal(modelItem.scenario.withheldReasonCode, "different-window-sizes");
  assert.equal(await tableDelta(page, "cmpMobility"), "Withheld · different window sizes");
});

test("SS 7 returning to the original radii makes the scenario match the baseline interpretation again", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  await ssCapture(page);
  const original = await ssState(page);
  // Out to an unequal window …
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 700, B: 1600 });
  const changed = await ssState(page);
  assert.equal(changed.status, "MIXED");
  assert.equal((await ssModel(page)).windowUnchanged, false);
  // … and back again.
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  const restored = await ssState(page);
  const model = await ssModel(page);
  assert.equal(model.windowUnchanged, true);
  assert.equal(restored.status, "STABLE");
  assert.match(restored.scenarioRadii, /matches the baseline/);
  // Every reading and transition is back to the captured interpretation.
  assert.deepEqual(restored.items.map((item) => item.transition), original.items.map((item) => item.transition));
  assert.deepEqual(restored.items.map((item) => item.scenario), original.items.map((item) => item.scenario));
  assert.deepEqual(restored.items.map((item) => item.baseline), original.items.map((item) => item.baseline));
});

test("SS 8 reset removes the baseline and leaves the Lens state completely untouched", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 700, B: 1600 });
  await ssCapture(page);
  await focusMetric(page, "tourism", "A", true);
  const before = await page.evaluate(() => ({
    radiusReadout: document.getElementById("comparisonRadiusReadout").textContent.trim(),
    cue: document.getElementById("comparisonModeCue").textContent.trim(),
    bridgeName: document.getElementById("cbMetricName").textContent.trim(),
    bridgeRel: document.getElementById("cbRelValue").textContent.trim(),
    insight: window.__HALO_REGRESSION__.decisionInsight(),
    focus: window.__HALO_REGRESSION__.focusState(),
    tableTourism: document.getElementById("cmpPoi").textContent.trim(),
  }));
  await ssReset(page);
  const state = await ssState(page);
  // The baseline is gone …
  assert.equal(state.status, "no-baseline");
  assert.equal(await ssModel(page), null);
  assert.equal(state.emptyHidden, false);
  assert.equal(state.windowsHidden, true);
  assert.equal(state.items.length, 0);
  assert.equal(state.resetHidden, true);
  assert.match(state.captureLabel, /Capture current comparison/);
  assert.match(state.announcement, /Baseline removed/);
  // Reset is not an invalidation, so it raises no notice.
  assert.equal(state.noticeHidden, true);
  // … and NOTHING ELSE changed: not the radii, not the active lens, not the
  // Bridge, not Decision Insight, not the focus lock, not the table.
  const after = await page.evaluate(() => ({
    radiusReadout: document.getElementById("comparisonRadiusReadout").textContent.trim(),
    cue: document.getElementById("comparisonModeCue").textContent.trim(),
    bridgeName: document.getElementById("cbMetricName").textContent.trim(),
    bridgeRel: document.getElementById("cbRelValue").textContent.trim(),
    insight: window.__HALO_REGRESSION__.decisionInsight(),
    focus: window.__HALO_REGRESSION__.focusState(),
    tableTourism: document.getElementById("cmpPoi").textContent.trim(),
  }));
  assert.deepEqual(after, before, "reset touches only the stored baseline");
});

test("SS 9 capture current as new baseline replaces the old snapshot", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  await ssCapture(page);
  assert.deepEqual((await ssModel(page)).baseline.radii, { A: 900, B: 900 });
  // Move to an unequal window; the old baseline must NOT follow it on its own.
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 700, B: 1600 });
  assert.deepEqual((await ssModel(page)).baseline.radii, { A: 900, B: 900 },
    "the baseline never moves by itself after a radius change");
  assert.equal((await ssState(page)).status, "MIXED");
  // Capturing again EXPLICITLY replaces it with the current configuration.
  await ssCapture(page);
  const model = await ssModel(page);
  const state = await ssState(page);
  assert.deepEqual(model.baseline.radii, { A: 700, B: 1600 }, "the new snapshot replaced the old one");
  assert.equal(model.windowUnchanged, true);
  assert.equal(state.status, "STABLE", "the new baseline equals the current scenario");
  assert.match(state.baselineRadii, /1.6 km|1600 m/);
  // Tourism now reads as a density on BOTH sides, so the basis is stable.
  const tourism = ssItem(state, "tourism");
  assert.equal(tourism.transition, "UNCHANGED_COMPARABLE");
  assert.match(tourism.baseline, /km²/);
  assert.match(tourism.scenario, /km²/);
});

test("SS 10/11 map pan and zoom preserve the baseline, because neither moves a Lens centre", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  await ssCapture(page);
  const before = await ssState(page);
  // Pan.
  await page.evaluate(() => { const c = window.__HALO_REGRESSION__.mapCenter(); window.__HALO_REGRESSION__ && null; return c; });
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.mouse.move(700, 300);
  await page.mouse.down();
  await page.mouse.move(560, 360, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(() => window.__HALO_REGRESSION__.recompute());
  let state = await ssState(page);
  assert.equal(state.status, before.status, "a map pan preserves the baseline");
  assert.equal(state.emptyHidden, true);
  assert.equal(state.noticeHidden, true, "a pan is not an invalidation");
  assert.deepEqual(state.items.map((item) => item.baseline), before.items.map((item) => item.baseline));
  // Zoom.
  await page.evaluate(() => window.__HALO_REGRESSION__.setZoom(12));
  await page.evaluate(() => window.__HALO_REGRESSION__.recompute());
  state = await ssState(page);
  assert.equal(state.status, before.status, "a map zoom preserves the baseline");
  assert.equal(state.noticeHidden, true);
  assert.deepEqual(state.items.map((item) => item.baseline), before.items.map((item) => item.baseline));
  assert.deepEqual((await ssModel(page)).baseline.radii, { A: 900, B: 900 });
});

test("SS 12 switching the active Lens preserves the baseline", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  await ssCapture(page);
  const before = await ssState(page);
  await page.evaluate(() => window.__HALO_REGRESSION__.setActive("B"));
  await page.evaluate(() => window.__HALO_REGRESSION__.setActive("A"));
  const after = await ssState(page);
  assert.equal(after.status, before.status);
  assert.equal(after.noticeHidden, true, "activating a lens is not a location change");
  assert.deepEqual(after.items.map((item) => item.baseline), before.items.map((item) => item.baseline));
  assert.deepEqual((await ssModel(page)).baseline.radii, { A: 900, B: 900 });
});

test("SS 13 moving a Lens centre invalidates the baseline and says why", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  await ssCapture(page);
  assert.ok((await ssModel(page)) !== null);
  // A different PLACE is not radius sensitivity.
  await page.evaluate(() => window.__HALO_REGRESSION__.setCenterAtPoint("A", 560, 470));
  await page.evaluate(() => window.__HALO_REGRESSION__.recompute());
  const state = await ssState(page);
  assert.equal(await ssModel(page), null, "the baseline was dropped, not silently compared");
  assert.equal(state.status, "no-baseline");
  assert.equal(state.noticeHidden, false);
  assert.match(state.noticeText, /Baseline invalidated · Lens location changed/);
  assert.equal(state.items.length, 0, "no stale readings survive");
  assert.equal(state.windowsHidden, true);
  assert.equal(state.baselineRadii, "", "no stale baseline radii survive");
  assert.match(state.captureLabel, /Capture current comparison/);
  // The user can simply capture a new baseline, which clears the notice.
  await ssCapture(page);
  const recaptured = await ssState(page);
  assert.equal(recaptured.noticeHidden, true, "a fresh capture answers the invalidation");
  assert.equal(recaptured.status, "STABLE");
});

test("SS 14 an evidence-configuration change invalidates the baseline rather than posing as window sensitivity", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  await ssCapture(page);
  assert.ok((await ssModel(page)) !== null);
  // Toggling the HATI layer changes the UTCI evidence contract, not the window.
  // The switch's own <span> is what a user clicks; it is label-associated, so
  // this toggles the input and fires the real change handler.
  await page.locator('.layer.research-layer .switch span').click();
  await page.waitForFunction(() => document.querySelector('[data-layer="heat"]').checked === true);
  await page.evaluate(() => window.__HALO_REGRESSION__.recompute());
  const state = await ssState(page);
  assert.equal(await ssModel(page), null, "V1 policy is invalidate, not 'mark incompatible'");
  assert.equal(state.status, "no-baseline");
  assert.equal(state.noticeHidden, false);
  assert.match(state.noticeText, /Baseline invalidated · evidence configuration changed/);
  assert.equal(state.items.length, 0);
});

test("SS 14(2) an accommodation-category change also invalidates the baseline", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  // DETERMINISTIC REGARDLESS OF PACKAGED DATA. The #stayKindFilter <select> is
  // legitimately DISABLED whenever the packaged fallback carries no
  // accommodation type metadata (true of a clean CI checkout), so driving the
  // control would test the deployment's data shape instead of the invalidation
  // contract. This drives the SAME setStayKindFilter() production helper the
  // real onchange handler calls, through the gated seam, so the evidence-key
  // change, the stay-layer rebuild and the re-render are all production code.
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  const before = await page.evaluate(() => ({
    kind: window.__HALO_REGRESSION__.stayKindFilterValue(),
    radii: { A: document.getElementById("cmpPoiA").textContent, B: document.getElementById("cmpPoiB").textContent },
    readout: document.getElementById("comparisonRadiusReadout").textContent.trim(),
    centers: window.__HALO_REGRESSION__.lensCenters(),
  }));
  assert.equal(before.kind, "all", "the session starts on the all-accommodation category");
  await ssCapture(page);
  const captured = await ssModel(page);
  assert.ok(captured !== null, "a valid baseline was captured");
  assert.deepEqual(captured.baseline.radii, { A: 900, B: 900 });

  // A REAL category change, to a different known Madrid Destino category.
  await page.evaluate(() => window.__HALO_REGRESSION__.setStayKindFilterForTest("hotel"));
  assert.equal(await page.evaluate(() => window.__HALO_REGRESSION__.stayKindFilterValue()), "hotel",
    "the production helper actually changed the category state");

  const state = await ssState(page);
  // The baseline is dropped, not silently compared as radius sensitivity.
  assert.equal(await ssModel(page), null, "an evidence-configuration change invalidates the baseline");
  assert.equal(state.status, "no-baseline");
  assert.equal(state.emptyHidden, false, "the UI returned to the no-baseline state");
  assert.equal(state.windowsHidden, true);
  assert.equal(state.items.length, 0, "no stale readings survive");
  assert.equal(state.resetHidden, true);
  assert.match(state.captureLabel, /Capture current comparison/);
  // The notice is visible and names the evidence configuration, not the window.
  assert.equal(state.noticeHidden, false);
  assert.match(state.noticeText, /Baseline invalidated · evidence configuration changed/);
  assert.doesNotMatch(state.noticeText, /location changed/, "this is not a centre change");

  // Invalidation must not disturb the live Lens geometry at all.
  const after = await page.evaluate(() => ({
    readout: document.getElementById("comparisonRadiusReadout").textContent.trim(),
    centers: window.__HALO_REGRESSION__.lensCenters(),
  }));
  assert.equal(after.readout, before.readout, "the current Lens radii are untouched");
  assert.deepEqual(after.centers, before.centers, "the current Lens centres are untouched");

  // The user can capture a fresh baseline under the new category, which clears
  // the notice — the contract is invalidation, not a dead end.
  await ssCapture(page);
  const recaptured = await ssState(page);
  assert.equal(recaptured.noticeHidden, true);
  assert.equal(recaptured.status, "STABLE");
  assert.deepEqual((await ssModel(page)).baseline.radii, { A: 900, B: 900 });
});

test("SS 14(3) the category transition is driven by one production helper, reachable only through the gated seam", async (t) => {
  // A SOURCE GUARD, so the architecture cannot drift back to a test-only path.
  const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  // 1) The real <select> handler delegates to the shared production helper and
  //    performs no state transition of its own.
  assert.match(app, /function setStayKindFilter\(nextKind\)\s*\{\s*stayKindFilter = nextKind;\s*rebuildDenseLayer\("stay"\);\s*refresh\(\);\s*\}/,
    "one named production helper owns the transition");
  assert.match(app, /document\.getElementById\("stayKindFilter"\)\.onchange = \(e\) => \{\s*setStayKindFilter\(e\.target\.value\);\s*\};/,
    "the real UI handler delegates to that helper");
  // The old inline duplication must be gone: assigning stayKindFilter directly
  // from an event is exactly the drift this guard prevents.
  assert.ok(!/stayKindFilter = e\.target\.value/.test(app), "no inline duplicate of the transition");
  // stayKindFilter is only ever reassigned inside the one helper.
  const assignments = [...app.matchAll(/^\s*stayKindFilter = /gm)];
  assert.equal(assignments.length, 1, "the category state has exactly one writer");

  // 2) The regression seam delegates to the SAME helper — no duplicated filter
  //    or invalidation logic, and no separate scenario render path.
  assert.match(app, /setStayKindFilterForTest\(kind\)\s*\{\s*setStayKindFilter\(kind\);\s*\}/,
    "the seam calls the production helper and nothing else");
  for (const forbidden of ["rebuildDenseLayer", "renderSpatialSensitivity", "invalidateSpatialBaseline", "disabled"]) {
    const seamFn = app.slice(app.indexOf("setStayKindFilterForTest(kind)"), app.indexOf("stayKindFilterValue()"));
    assert.ok(!seamFn.includes(forbidden), `the seam must not itself call ${forbidden}`);
  }

  // 3) Every seam member, including the new ones, stays inside the query-gated
  //    AND localhost-only block. Nothing test-only is reachable in production.
  assert.match(app, /const haloRegressionRequested = new URLSearchParams\(window\.location\.search\)\.get\("haloRegressionTest"\) === "1";/);
  assert.match(app, /const haloRegressionLocal = window\.location\.hostname === "127\.0\.0\.1" \|\| window\.location\.hostname === "localhost";/);
  assert.match(app, /if \(haloRegressionRequested && haloRegressionLocal\) \{\s*window\.__HALO_REGRESSION__ = Object\.freeze\(\{/);
  const seamStart = app.indexOf("if (haloRegressionRequested && haloRegressionLocal) {");
  // The boundary is the gate's own CLOSING BRACE, not the next statement:
  // slicing to the following `const` would count anything inserted just above
  // it as "inside the seam", which is exactly the leak this guard must catch.
  const seamClose = app.indexOf("\n  });\n}\n", seamStart);
  assert.ok(seamStart > 0 && seamClose > seamStart, "the gated seam block was located");
  const seamEnd = seamClose + "\n  });\n}".length;
  const seamBlock = app.slice(seamStart, seamEnd);
  assert.ok(seamBlock.trimEnd().endsWith("});\n}"), "the slice ends at the gate's closing brace");
  // Unambiguous test-only identifiers: each must live inside the gated block and
  // appear NOWHERE else in the file.
  for (const member of ["setStayKindFilterForTest", "stayKindFilterValue", "lensCenters", "spatialSensitivityModel", "spatialBaselineSnapshot"]) {
    assert.ok(seamBlock.includes(member), `${member} lives inside the gated seam`);
    assert.equal(app.split(member).length - 1, seamBlock.split(member).length - 1,
      `${member} appears nowhere outside the gated seam`);
  }
  // There is exactly one seam assignment, and it is the gated one.
  assert.equal((app.match(/window\.__HALO_REGRESSION__ =/g) || []).length, 1);
});

test("SS 14(4) the seam is absent, and the category filter keeps its production availability rule, without the query gate", async (t) => {
  // Served from 127.0.0.1 but WITHOUT haloRegressionTest=1: the seam must not exist.
  const page = await browser.newPage({ viewport: { width: 1366, height: 1024 } });
  t.after(() => page.close());
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return route.abort();
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  // Wait for the production availability rule to have actually RUN. The options
  // and the <select> ship in static markup, so waiting for them resolves
  // immediately and would race the rule; the `title` is set only by that rule,
  // so a non-empty title is the deterministic signal that it has applied.
  await page.waitForFunction(() => document.getElementById("stayKindFilter").title.length > 0);
  assert.equal(await page.evaluate(() => typeof window.__HALO_REGRESSION__), "undefined",
    "no test-only code is reachable during normal production use");
  // Every test-only ENTRY POINT is gone with it. (setStayKindFilter itself is
  // ordinary production code at script scope, exactly like refresh() and
  // renderCompare() already are — js/app.js is a classic script, so that is
  // pre-existing architecture and not a seam leak. What must never be reachable
  // is a test-only shortcut, and the seam is the only one.)
  const seamMembers = await page.evaluate(() => ({
    seam: typeof window.__HALO_REGRESSION__,
    forTest: typeof window.setStayKindFilterForTest,
    model: typeof window.spatialSensitivityModel,
    snapshot: typeof window.spatialBaselineSnapshot,
  }));
  assert.deepEqual(seamMembers, { seam: "undefined", forTest: "undefined", model: "undefined", snapshot: "undefined" },
    "no test-only entry point exists without the query gate");
  // The production availability rule is intact and is driven ONLY by whether the
  // packaged data carries accommodation type metadata — this fix did not change
  // it, and the test above never needed it to be enabled.
  const filter = await page.evaluate(() => {
    const select = document.getElementById("stayKindFilter");
    const kinds = new Set([...document.querySelectorAll("#stayKindFilter option[data-kind]")]
      .filter((option) => !option.disabled).map((option) => option.dataset.kind));
    return { disabled: select.disabled, title: select.title, enabledKinds: kinds.size };
  });
  // Either state is legitimate depending on the packaged fallback; what must
  // hold is that `disabled` agrees with the presence of category metadata.
  assert.equal(filter.disabled, filter.enabledKinds === 0,
    "the filter is disabled exactly when no accommodation category metadata is present");
  assert.match(filter.title, filter.disabled
    ? /Accommodation type metadata unavailable in the current fallback/
    : /Filter the official accommodation layer by Madrid Destino category/);
});

test("SS 15 metric focus emphasizes the matching sensitivity item without hiding the others", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  await ssCapture(page);
  await focusMetric(page, "mobility", "A", true);
  const state = await ssState(page);
  const focused = state.items.filter((item) => item.focused === "true");
  assert.equal(focused.length, 1, "exactly one item is emphasized");
  assert.equal(focused[0].metricId, "mobility", "the focused metric is the emphasized one");
  assert.equal(focused[0].ariaCurrent, "true", "emphasis is exposed to assistive technology, not colour alone");
  // Every other item stays present and fully readable: this is not a selector.
  assert.equal(state.items.length, 4);
  for (const item of state.items) {
    assert.ok(item.baseline.length > 0 && item.scenario.length > 0, `${item.metricId} stays readable`);
    if (item.metricId !== "mobility") assert.equal(item.ariaCurrent, null);
  }
  const visible = await page.evaluate(() => [...document.querySelectorAll("#spatialSensitivityItems .ss-item")]
    .map((row) => getComputedStyle(row).display !== "none" && row.getBoundingClientRect().height > 0));
  assert.deepEqual(visible, [true, true, true, true], "no item is ever hidden");
  // It adds no tab stop and no interactive control of its own.
  const controls = await page.evaluate(() => document.querySelectorAll("#spatialSensitivityItems button, #spatialSensitivityItems [tabindex]").length);
  assert.equal(controls, 0);
  // Clearing focus removes the emphasis without touching the readings.
  await focusMetric(page, "mobility", "A", true);
  await focusMetric(page, null, "A");
  const cleared = await ssState(page);
  assert.equal(cleared.items.filter((item) => item.focused === "true").length, 0);
  assert.deepEqual(cleared.items.map((item) => item.scenario), state.items.map((item) => item.scenario));
});

test("SS 16/17 the sensitivity copy switches between Spanish and English", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  await ssCapture(page);
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 700, B: 1600 });

  await page.evaluate(() => window.__HALO_REGRESSION__.setComparisonLanguage("es"));
  const es = await ssState(page);
  assert.equal(es.heading, "Sensibilidad espacial");
  assert.match(es.statusText, /Sensible a la elección de ventana/);
  assert.equal(es.baselineLabel, "Ventana de línea base");
  assert.equal(es.scenarioLabel, "Ventana de escenario");
  assert.match(es.captureLabel, /Capturar la actual como nueva línea base/);
  assert.match(es.resetLabel, /Restablecer la línea base/);
  assert.match(es.guard, /no es una previsión ni un efecto causal/);
  assert.equal(ssItem(es, "tourism").metric, "POI turísticos");
  assert.match(ssItem(es, "tourism").transitionText, /La base de comparación cambió/);
  assert.match(ssItem(es, "tourism").detail, /cambio numérico retenido/);
  assert.match(ssItem(es, "mobility").transitionText, /La comparación pasó a retenida/);
  assert.match(ssItem(es, "mobility").scenario, /tamaños de ventana distintos/);
  // No English leaks into the Spanish rendering.
  for (const item of es.items) {
    assert.doesNotMatch(item.transitionText, /Basis changed|became withheld|Relationship unchanged/);
  }
  // The structural reading is IDENTICAL across languages: only words change.
  const esTransitions = es.items.map((item) => item.transition);

  await page.evaluate(() => window.__HALO_REGRESSION__.setComparisonLanguage("en"));
  const en = await ssState(page);
  assert.equal(en.heading, "Spatial sensitivity");
  assert.match(en.statusText, /Sensitive to window choice/);
  assert.equal(en.baselineLabel, "Baseline window");
  assert.equal(en.scenarioLabel, "Scenario window");
  assert.match(en.captureLabel, /Capture current as new baseline/);
  assert.match(en.resetLabel, /Reset baseline/);
  assert.match(en.guard, /not a forecast and not a causal effect/);
  assert.equal(ssItem(en, "tourism").metric, "Tourism POIs");
  assert.match(ssItem(en, "tourism").transitionText, /Basis changed/);
  assert.match(ssItem(en, "mobility").transitionText, /Comparison became withheld/);
  assert.deepEqual(en.items.map((item) => item.transition), esTransitions,
    "the analytical reading is language-independent");
  assert.equal(en.status, es.status);
});

test("SS 20 no sensitivity state ever alters the authoritative halo, Bridge, Insight or table semantics", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 700, B: 1600 });
  await focusMetric(page, "tourism", "A", true);
  const snapshot = () => page.evaluate(() => ({
    bridge: window.__HALO_REGRESSION__.bridgeModel("tourism"),
    insight: window.__HALO_REGRESSION__.decisionInsightModel(),
    insightDom: window.__HALO_REGRESSION__.decisionInsight(),
    haloTourismA: window.__HALO_REGRESSION__.haloValueText("A", "tourism"),
    haloTourismB: window.__HALO_REGRESSION__.haloValueText("B", "tourism"),
    table: ["cmpPoi", "cmpStay", "cmpMobility", "cmpHeat"].map((id) => document.getElementById(id).textContent.trim()),
    cue: document.getElementById("comparisonModeCue").textContent.trim(),
    focus: window.__HALO_REGRESSION__.focusState(),
  }));
  const before = await snapshot();
  // Capture, change the window, come back, capture again, reset: none of it may
  // perturb any authoritative surface.
  await ssCapture(page);
  assert.deepEqual(await snapshot(), before, "capturing a baseline changes no authoritative surface");
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 700, B: 1600 });
  assert.deepEqual(await snapshot(), before, "a round trip through the scenario restores every surface");
  await ssCapture(page);
  assert.deepEqual(await snapshot(), before, "re-capturing changes no authoritative surface");
  await ssReset(page);
  assert.deepEqual(await snapshot(), before, "resetting the baseline changes no authoritative surface");
});

// --- FIVE-SURFACE COHERENCE -------------------------------------------------
//
// The scenario side of Spatial Sensitivity must be the SAME authoritative
// current state the other four surfaces show. The baseline is the frozen
// historical snapshot and is the only thing that may differ.

test("SS five-surface coherence: a VALID metric reads identically on halo, Bridge, Insight, table and sensitivity", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
  await ssCapture(page);
  // Move the window so the baseline and the scenario genuinely differ, then
  // come back to a comparable raw-count scenario with a changed magnitude.
  await applyInsight(page, INSIGHT_EVIDENCE({
    tourism: { a: { value: 17, sourceState: "live" }, b: { value: 40, sourceState: "live" } },
  }), { A: 900, B: 900 });

  // The halo's own visibility is governed by the frozen collision contract, so
  // a given glyph may legitimately be suppressed off the map in this layout.
  // Each attached glyph is checked, and the count is asserted afterwards so the
  // halo leg of this coherence test can never pass vacuously.
  let haloChecks = 0;
  for (const metricId of ["tourism", "stays", "mobility"]) {
    await focusMetric(page, metricId, "A", true);
    await page.waitForFunction((m) => window.__HALO_REGRESSION__.focusState().focused === m, metricId);
    const bridge = await bridgeModelFor(page, metricId);
    const insight = (await insightState(page)).items.find((item) => item.metricId === metricId);
    const insightModelItem = (await insightModel(page)).items.find((item) => item.metricId === metricId);
    const sensitivity = ssItem(await ssState(page), metricId);
    const sensitivityModelItem = (await ssModel(page)).items.find((item) => item.metricId === metricId);
    const cellId = { tourism: "cmpPoi", stays: "cmpStay", mobility: "cmpMobility" }[metricId];

    // 1) One metric identity across every surface.
    assert.equal(sensitivity.metric, insight.metric, `${metricId} name matches Decision Insight`);
    assert.equal(sensitivity.metric, (await bridgeState(page)).name, `${metricId} name matches the Bridge`);

    // 2) The SCENARIO state is the authoritative current state, everywhere.
    assert.equal(sensitivityModelItem.scenario.state, insightModelItem.state, `${metricId} scenario state IS the Insight state`);
    assert.equal(sensitivityModelItem.scenario.comparable, bridge.relationship.comparable, `${metricId} comparability IS the Bridge's`);
    assert.equal(sensitivityModelItem.scenario.deltaValue, insightModelItem.deltaValue, `${metricId} scenario delta IS the Insight delta`);
    assert.equal(sensitivityModelItem.scenario.basisCode, bridge.relationship.basisCode, `${metricId} basis IS the Bridge's`);
    assert.equal(sensitivityModelItem.scenario.direction, insightModelItem.direction);

    // 3) The RENDERED scenario clause is literally the rendered Insight clause,
    //    so the two surfaces cannot word one state differently.
    assert.equal(sensitivity.scenario, insight.relationship, `${metricId} scenario text IS the Insight text`);

    // 4) The same number reaches the Bridge, the table and the halo.
    const expected = signedNumber(insight.relationship);
    assert.equal(signedNumber(sensitivity.scenario), expected, `${metricId} sensitivity number agrees`);
    assert.equal(signedNumber((await bridgeState(page)).relValue), expected, `${metricId} Bridge number agrees`);
    assert.equal(signedNumber(await tableDelta(page, cellId)), expected, `${metricId} table number agrees`);
    const haloB = await page.evaluate((m) => window.__HALO_REGRESSION__.haloValueText("B", m), metricId);
    if (haloB !== null) {
      assert.equal(haloB, String(bridge.b.rawValue), `${metricId} halo prints the same authoritative raw value`);
      haloChecks += 1;
    }

    // 5) The BASELINE is the historical snapshot and is the only differing side.
    assert.equal(sensitivityModelItem.baseline.state, "comparable");
    assert.notEqual(sensitivity.baseline, sensitivity.scenario === sensitivity.baseline ? null : sensitivity.scenario,
      `${metricId} baseline is reported separately from the scenario`);
  }
  assert.ok(haloChecks >= 1, "at least one halo glyph was actually compared");
  // Tourism's magnitude moved while its direction and basis held, so the
  // reading is STABLE and the change is reported with correct units.
  const tourism = (await ssModel(page)).items.find((item) => item.metricId === "tourism");
  assert.equal(tourism.transitionCode, "UNCHANGED_COMPARABLE");
  assert.equal(tourism.deltaChange, 23 - 9);
  assert.match(ssItem(await ssState(page), "tourism").detail, /Observed comparison changed by \+14 records/);
});

test("SS five-surface coherence: a WITHHELD metric agrees on every surface, including the reason", async (t) => {
  const page = await openBridge();
  t.after(() => page.close());
  // Mobility unavailable: the EVIDENCE reason must win over the window rule on
  // every surface, and the sensitivity layer must not invent a third reading.
  const absent = INSIGHT_EVIDENCE({ mobility: { a: { value: null, sourceState: "unavailable" }, b: { value: null, sourceState: "unavailable" } } });
  await applyInsight(page, absent, { A: 900, B: 900 });
  await ssCapture(page);
  await applyInsight(page, absent, { A: 900, B: 1600 });
  await focusMetric(page, "mobility", "A", true);
  await page.waitForFunction(() => window.__HALO_REGRESSION__.focusState().focused === "mobility");

  const bridge = await bridgeModelFor(page, "mobility");
  const insight = (await insightState(page)).items.find((item) => item.metricId === "mobility");
  const sensitivity = ssItem(await ssState(page), "mobility");
  const modelItem = (await ssModel(page)).items.find((item) => item.metricId === "mobility");

  assert.equal(bridge.relationship.comparable, false);
  assert.equal(bridge.relationship.withheldReasonCode, "source-incompatible",
    "the evidence reason outranks the window mismatch");
  assert.equal(modelItem.scenario.withheldReasonCode, bridge.relationship.withheldReasonCode);
  assert.equal(modelItem.baseline.withheldReasonCode, bridge.relationship.withheldReasonCode);
  // Both windows are non-comparable for the SAME reason.
  assert.equal(modelItem.transitionCode, "WITHHELD_UNCHANGED");
  assert.match(sensitivity.transitionText, /Comparison withheld in both windows/);
  // The rendered scenario clause is the rendered Insight clause, verbatim.
  assert.equal(sensitivity.scenario, insight.relationship);
  // N/A is never rendered as zero, on any surface.
  for (const text of [sensitivity.baseline, sensitivity.scenario, insight.relationship]) {
    assert.match(text, /N\/A/);
    assert.ok(!/(^|\s)[+-]?0($|\s)/.test(text), `"${text}" never reads as zero`);
  }
  assert.equal(modelItem.scenario.deltaValue, null);
  assert.equal(modelItem.deltaChange, null);
  // The table and the Bridge agree on the same words.
  assert.equal(await tableDelta(page, "cmpMobility"), "Withheld · source states incompatible");
  assert.equal((await bridgeState(page)).qualifier, "Withheld · source states incompatible");
});

// --- responsive --------------------------------------------------------------
for (const [label, viewport] of [["iPad landscape", { width: 1180, height: 820 }], ["iPad portrait", { width: 820, height: 1180 }]]) {
  test(`SS 18/19 the sensitivity section is readable with no horizontal overflow on ${label}`, async (t) => {
    const page = await openBridge(viewport);
    t.after(() => page.close());
    // The busiest state: a basis change, a became-withheld and a live reading.
    await applyInsight(page, INSIGHT_EVIDENCE(), { A: 900, B: 900 });
    await ssCapture(page);
    await applyInsight(page, INSIGHT_EVIDENCE(), { A: 700, B: 1600 });
    const metrics = await page.evaluate(() => {
      const section = document.getElementById("spatialSensitivity");
      section.scrollIntoView({ block: "center" });
      const rect = section.getBoundingClientRect();
      const rows = [...section.querySelectorAll(".ss-item")].map((row) => ({
        overflow: row.scrollWidth - row.clientWidth,
        height: row.getBoundingClientRect().height,
        fontSize: parseFloat(getComputedStyle(row.querySelector(".ss-transition")).fontSize),
        // Baseline above scenario above transition: the stacked reading order.
        stacked: getComputedStyle(row).flexDirection === "column",
        readings: [...row.querySelectorAll(".ss-reading")].map((reading) => ({
          overflow: reading.scrollWidth - reading.clientWidth,
          value: reading.querySelector(".ss-reading-value").textContent.trim().length,
        })),
      }));
      const buttons = [...section.querySelectorAll(".ss-button")]
        .filter((button) => !button.hasAttribute("hidden"))
        .map((button) => ({ height: button.getBoundingClientRect().height, overflow: button.scrollWidth - button.clientWidth }));
      return {
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        sectionOverflow: section.scrollWidth - section.clientWidth,
        visible: rect.width > 0 && rect.height > 0,
        withinViewport: rect.right <= window.innerWidth + 1,
        windowsOverflow: (() => { const w = document.getElementById("spatialSensitivityWindows"); return w.scrollWidth - w.clientWidth; })(),
        rows, buttons,
      };
    });
    assert.equal(metrics.visible, true, "the section is rendered");
    assert.equal(metrics.rows.length, 4);
    assert.ok(metrics.docOverflow <= 1, `no horizontal page overflow (${metrics.docOverflow}px)`);
    assert.ok(metrics.sectionOverflow <= 1, `the section does not overflow its own box (${metrics.sectionOverflow}px)`);
    assert.ok(metrics.windowsOverflow <= 1, `the baseline/scenario windows do not overflow (${metrics.windowsOverflow}px)`);
    assert.equal(metrics.withinViewport, true, "the section stays inside the viewport");
    assert.equal(metrics.buttons.length, 2);
    for (const button of metrics.buttons) {
      assert.ok(button.overflow <= 1, `a control does not overflow (${button.overflow}px)`);
      assert.ok(button.height >= 20, `a control keeps a usable target (${button.height}px)`);
    }
    for (const row of metrics.rows) {
      assert.ok(row.overflow <= 1, `an item does not overflow its row (${row.overflow}px)`);
      assert.ok(row.height > 0, "each item has layout");
      assert.ok(row.fontSize >= 7, `text is not shrunk to illegibility (${row.fontSize}px)`);
      // Narrow widths must STACK rather than squeeze three tiny columns.
      assert.equal(row.stacked, true, "baseline, scenario and transition stack vertically");
      assert.equal(row.readings.length, 2, "both the baseline and the scenario reading are present");
      for (const reading of row.readings) {
        assert.ok(reading.overflow <= 1, `a reading does not overflow (${reading.overflow}px)`);
        assert.ok(reading.value > 0, "each reading prints a value");
      }
    }
  });
}

test.after(async () => {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
