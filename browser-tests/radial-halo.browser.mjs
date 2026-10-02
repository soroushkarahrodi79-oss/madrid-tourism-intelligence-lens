import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Radial Halo V3 browser regression. These tests exercise the production
// Leaflet/SVG renderer and assert the *semantics* of the quantitative perimeter
// bars — raw values present, within-metric monotonic lengths, one shared A/B
// scale, unavailable-vs-zero, single-lens + compare, projection and pointer
// transparency — not merely that SVG nodes exist.

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
const ICON_ANCHORS = { north: [68, 54], east: [4, 28], south: [68, 2], west: [132, 28] };

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

// Compare mode: both lenses enabled, positioned apart, Lens A active. The
// panel/left rails are hidden by default so both lenses' bars sit over open map
// for geometry reads; pass { panels: true } to keep the Compare panel visible.
async function openCompare(viewport, { panels = false } = {}) {
  const page = await newPage(viewport);
  await page.locator("#lensBButton").click();
  await page.waitForFunction(() => document.querySelectorAll(".comparison-halo-icon").length > 0);
  if (!panels) await page.addStyleTag({ content: ".panel,.left{display:none!important}" });
  await page.evaluate(() => {
    const api = window.__HALO_REGRESSION__;
    api.setZoom(13);
    api.setCenterAtPoint("A", 460, 430);
    api.setCenterAtPoint("B", 1000, 430);
    api.setActive("A");
  });
  return page;
}

// Single-lens mode: Lens B never enabled; the halo must still render Lens A.
// The lens is moved over central (dense) Madrid via the real recompute path.
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
async function setUiRadius(page, which, metres) {
  await page.locator(which === "A" ? "#lensAButton" : "#lensBButton").click();
  await page.locator("#radiusSlider").evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, metres);
}
async function geometryFor(page, lens, metric) {
  return page.evaluate(({ lens, metric }) => window.__HALO_REGRESSION__.geometry(lens, metric), { lens, metric });
}

const live = (value) => ({ value, sourceState: "live" });

// A. single Lens renders four valid metric positions, each printing a raw value.
test("A/B/N single lens renders four perimeter bars that print real runtime values", async (t) => {
  const page = await openSingle();
  t.after(() => page.close());
  const slots = await visibleSlots(page, "A");
  assert.equal(slots.filter((s) => s.visible).length, 4, "all four Lens A slots render with Compare off");
  // Count metrics at a central lens are numeric and derived from runtime data
  // (not a test-only constant): north/east/south print plain integers.
  for (const slot of ["north", "east", "south"]) {
    const text = await valueText(page, "A", slot);
    assert.match(text, /^\d[\d,]*$/, `${SLOT_METRIC[slot]} prints a runtime integer, got "${text}"`);
  }
  // No Lens B markers exist in single-lens mode.
  assert.equal(await page.locator(".halo-glyph.halo-b").count(), 0);
});

// I + N. The same production path updates values when the Lens radius changes.
test("I values update from runtime data when the Lens radius changes", async (t) => {
  const page = await openSingle();
  t.after(() => page.close());
  await page.evaluate(() => { window.__HALO_REGRESSION__.setRadius("A", 400); window.__HALO_REGRESSION__.recompute(); });
  const small = Number((await valueText(page, "A", "south")).replace(/,/g, ""));
  await page.evaluate(() => { window.__HALO_REGRESSION__.setRadius("A", 1500); window.__HALO_REGRESSION__.recompute(); });
  const large = Number((await valueText(page, "A", "south")).replace(/,/g, ""));
  assert.ok(Number.isFinite(small) && Number.isFinite(large), "mobility value is numeric at both radii");
  assert.ok(large >= small, "a larger radius never reports fewer mobility nodes");
  assert.ok(large > small, "a central lens gains mobility nodes as the radius grows");
});

// C + D + E. Within-metric monotonic lengths, equal values equal, one shared
// A/B scale (reference 20 for every count metric in the fixture).
test("C/D/E bar length is monotonic within a metric and shares one A/B scale", async (t) => {
  const page = await openCompare();
  t.after(() => page.close());
  const lengths = [];
  for (const value of [2, 4, 10, 40]) {
    await setComparison(page, { tourism: { a: live(value), b: live(10) } });
    lengths.push(await fillLength(page, "A", "north"));
  }
  for (let i = 1; i < lengths.length; i += 1) {
    assert.ok(lengths[i] >= lengths[i - 1] - 0.01, `length is monotonic non-decreasing (${lengths[i - 1]} -> ${lengths[i]})`);
  }
  assert.ok(lengths[2] > lengths[0], "10 renders a visibly longer bar than 2");
  assert.ok(Math.abs(lengths[3] - lengths[2]) < 0.5 || lengths[3] >= lengths[2], "a value above the reference clamps, never shrinks");

  // Equal values on A and B produce equal bars (same reference).
  await setComparison(page, { tourism: { a: live(7), b: live(7) } });
  assert.ok(Math.abs((await fillLength(page, "A", "north")) - (await fillLength(page, "B", "north"))) < 0.01, "equal values -> equal A/B bars");

  // Shared scale: with reference 20, value 10 is exactly twice value 5.
  await setComparison(page, { tourism: { a: live(5), b: live(10) } });
  const a = await fillLength(page, "A", "north");
  const b = await fillLength(page, "B", "north");
  assert.ok(a > 0 && b > a, "Lens B (10) is longer than Lens A (5) under the same scale");
  assert.ok(Math.abs(b - 2 * a) < 1.0, `Lens B length ~= 2x Lens A under the shared reference (a=${a}, b=${b})`);
  assert.equal(await valueText(page, "A", "north"), "5");
  assert.equal(await valueText(page, "B", "north"), "10");
});

// G + H. Missing metric renders an unavailable state and NOT zero; a genuine
// zero stays a distinct zero state.
test("G/H unavailable renders N/A (not zero) and a genuine zero stays distinct", async (t) => {
  const page = await openCompare();
  t.after(() => page.close());

  // Genuine zero: a bar-less zero mark with the printed value "0".
  await setComparison(page, { tourism: { a: live(0), b: live(10) } });
  assert.equal(await valueText(page, "A", "north"), "0");
  assert.notEqual(await groupDisplay(page, "A", "north", ".halo-zero"), "none");
  assert.equal(await groupDisplay(page, "A", "north", ".halo-abstain"), "none");

  // Unavailable: an abstain mark printing "N/A", with no data bar and no zero.
  await setComparison(page, { tourism: { a: { value: null, sourceState: "unavailable" }, b: live(10) } });
  assert.equal(await valueText(page, "A", "north"), "N/A");
  assert.notEqual(await groupDisplay(page, "A", "north", ".halo-abstain"), "none");
  assert.equal(await groupDisplay(page, "A", "north", ".halo-fill"), "none");
  assert.equal(await groupDisplay(page, "A", "north", ".halo-zero"), "none");
  assert.match(await glyph(page, "A", "north").locator(".halo-abstain").getAttribute("class"), /halo-state-unavailable/);
});

// J. Switching the active Lens does not remove the other Lens's bars.
test("J active-lens switching keeps both lenses' quantitative bars on the map", async (t) => {
  const page = await openCompare();
  t.after(() => page.close());
  // Both lenses over dense central Madrid (real recompute), well separated.
  await page.evaluate(() => {
    window.__HALO_REGRESSION__.setZoom(14);
    window.__HALO_REGRESSION__.moveLens("A", 380, 430);
    window.__HALO_REGRESSION__.moveLens("B", 980, 430);
  });
  const bothPresent = async () => {
    assert.equal((await visibleSlots(page, "A")).filter((s) => s.visible).length, 4, "Lens A keeps four bars");
    assert.equal((await visibleSlots(page, "B")).filter((s) => s.visible).length, 4, "Lens B keeps four bars");
    assert.match(await valueText(page, "A", "south"), /^\d[\d,]*$/, "Lens A still prints its mobility value");
    assert.match(await valueText(page, "B", "south"), /^\d[\d,]*$/, "Lens B still prints its mobility value");
  };
  await bothPresent();
  await page.evaluate(() => window.__HALO_REGRESSION__.setActive("B"));
  await bothPresent();
  await page.evaluate(() => window.__HALO_REGRESSION__.setActive("A"));
  await bothPresent();
});

// F. Unequal Lens radii remain correctly projected (5 px attachment per lens).
test("F unequal radii keep each lens's bars projected onto its own boundary", async (t) => {
  const page = await openCompare();
  t.after(() => page.close());
  await page.addStyleTag({ content: ".panel,.left{display:none!important}" });
  await page.evaluate(() => {
    window.__HALO_REGRESSION__.setCenterAtPoint("A", 500, 430);
    window.__HALO_REGRESSION__.setCenterAtPoint("B", 1200, 430);
  });
  await setRadius(page, "A", 500);
  await setRadius(page, "B", 1500);
  for (const lens of ["A", "B"]) {
    const geometry = await geometryFor(page, lens, "tourism");
    const distance = Math.hypot(geometry.anchor.x - geometry.center.x, geometry.anchor.y - geometry.center.y);
    assert.ok(Math.abs(distance - geometry.radiusPx - 5) <= 1.5, `${lens} spoke attaches 5 px beyond its own radius`);
    assert.ok(geometry.radiusPx > 0);
  }
  // Independent radii: growing A moves A's spoke, leaves B's untouched.
  const before = await geometryFor(page, "A", "tourism");
  const beforeB = await geometryFor(page, "B", "tourism");
  await setRadius(page, "A", 1500);
  const after = await geometryFor(page, "A", "tourism");
  const afterB = await geometryFor(page, "B", "tourism");
  assert.ok(after.radiusPx > before.radiusPx);
  assert.ok(Math.hypot(after.anchor.x - before.anchor.x, after.anchor.y - before.anchor.y) > 20);
  assert.ok(Math.abs(afterB.radiusPx - beforeB.radiusPx) < 0.01, "B radius unchanged when A grows");
});

// K. Pan/zoom preserves attachment to the Lens.
test("K pan and zoom preserve bar attachment to the Lens boundary", async (t) => {
  const page = await openCompare();
  t.after(() => page.close());
  await setRadius(page, "A", 900);
  const check = async () => {
    const geometry = await geometryFor(page, "A", "mobility");
    const distance = Math.hypot(geometry.anchor.x - geometry.center.x, geometry.anchor.y - geometry.center.y);
    assert.ok(Math.abs(distance - geometry.radiusPx - 5) <= 1.5, "spoke stays 5 px beyond the projected radius");
  };
  await check();
  await page.evaluate(() => window.__HALO_REGRESSION__.setZoom(15));
  await check();
  await page.evaluate(() => window.__HALO_REGRESSION__.setZoom(12));
  await check();
});

// L. Labels/values stay within viewport bounds (or the slot is suppressed) on
// desktop, laptop and iPad viewports; values are never hidden to fit.
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
        const value = glyph(page, lens, slot).locator(".halo-value");
        const box = await value.evaluate((node) => node.getBoundingClientRect().toJSON());
        // A rendered value is never microscopic and never fully off the map.
        assert.ok(box.height >= 9, `${lens} ${slot} value font is legible (${box.height}px) on ${viewport.name}`);
        assert.ok(box.right > mapRect.left && box.left < mapRect.right && box.bottom > mapRect.top && box.top < mapRect.bottom,
          `${lens} ${slot} value stays within the map on ${viewport.name}`);
      }
    }
  });
}

// M. The halo never blocks pointer interaction with the map.
test("M the halo is pointer-transparent and clicks pass through to the map", async (t) => {
  const page = await openCompare();
  t.after(() => page.close());
  const cssPointerEvents = await glyph(page, "A", "north").evaluate((svg) => getComputedStyle(svg.closest(".comparison-halo-icon")).pointerEvents);
  assert.equal(cssPointerEvents, "none");
  const target = await page.evaluate(() => {
    const anchor = window.__HALO_REGRESSION__.geometry("A", "tourism").anchor;
    window.__haloMapClicks = 0;
    document.querySelector("#map").addEventListener("click", () => { window.__haloMapClicks += 1; }, { once: true });
    return { x: anchor.x, y: anchor.y - 30 };
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction(() => window.__haloMapClicks === 1);
});

// Compare panel survives, collisions suppress ambiguous slots, and the single
// Compare readout remains available throughout.
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
