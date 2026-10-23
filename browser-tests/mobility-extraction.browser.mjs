import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// F-01 browser regression — geographic extraction boundary safety for the
// combined Mobility metric (BiciMAD + Metro/Cercanías).
//
// These tests drive the PRODUCTION data path: data/runtime_poi.json is served as
// a deterministic deployment artefact (it is a gitignored deploy output, so a
// clean checkout has none), the app loads it through loadAllLayers(), and every
// assertion reads what the production renderers actually printed — the PLACE
// card, the circle summary, the comparison table, the Bridge, Decision Insight,
// the halo glyphs and the evidence export. No test injects comparison values.
//
// Rail was queried only inside a central rectangle. A Lens circle that is not
// wholly inside it must show Mobility as WITHHELD (never a number, never 0),
// distinct from "No data" (source unavailable) and from a genuine zero.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".css": "text/css; charset=utf-8", ".geojson": "application/geo+json; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml",
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
    if (error) { response.writeHead(404).end("Not found"); return; }
    response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    response.end(content);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const BASE = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PW_EXECUTABLE_PATH || undefined });
test.after(async () => { await browser.close(); server.close(); });

const extraction = JSON.parse(fs.readFileSync(path.join(ROOT, "data/source_registry.json"), "utf8"))
  .sources.find((source) => source.id === "rail").extraction_bounds;
const RECORD = {
  contract_version: extraction.contract_version, kind: extraction.kind, crs: extraction.crs,
  bounds: { west: extraction.west, south: extraction.south, east: extraction.east, north: extraction.north },
  origin: extraction.origin, is_coverage_evidence: false, completeness: "NOT_VERIFIED",
};

const SOL = [40.4169, -3.7035];
const RETIRO = [40.4149, -3.69];
const BARAJAS = [40.4743, -3.5805];
const HORTALEZA = [40.4733, -3.6402];
// Just north of the rectangle's edge (40.455): the circle reaches into the queried
// area but past its edge (PARTIAL), and stays in view beside Sol so the halo
// glyphs of both Lenses are on the map.
const NORTH_EDGE = [40.4585, -3.69];
const QUIET_CENTRE = [40.4375, -3.7225]; // inside the rectangle, no mobility record nearby

const bike = (id, lat, lon) => ({ id: `bike-${id}`, name: `BiciMAD ${id}`, lat, lon });
const rail = (id, lat, lon, mode = "metro") => ({ id: `rail-${id}`, name: `Estación ${id}`, mode, lines: "1", lat, lon });

// Sol 900 m: 2 bikes + 3 rail = 5 (all inside the rectangle). A bike 4.2 km west
// of Sol lies inside r = 5 km, as does the Barajas bike beside the Barajas Lens.
const FIXTURE = {
  generatedAt: "2026-10-23T09:00:00.000Z",
  sourceMode: "deployment-snapshot",
  layers: {
    bike: [bike("sol1", 40.4171, -3.7032), bike("sol2", 40.4166, -3.7040), bike("west", 40.4169, -3.7535), bike("barajas", 40.4745, -3.5803)],
    rail: [rail("sol1", 40.4168, -3.7038), rail("sol2", 40.4173, -3.7029), rail("sol3", 40.4164, -3.7044, "cercanias")],
  },
  status: {
    bike: { ok: true, count: 4, error: null },
    rail: { ok: true, count: 3, error: null, extraction: RECORD },
  },
  sources: {},
};

async function openPage({ fixture = FIXTURE, viewport = { width: 1366, height: 1024 }, url = `${BASE}/?haloRegressionTest=1` } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return route.abort();
    if (u.pathname.endsWith("/data/runtime_poi.json")) {
      return fixture
        ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture) })
        : route.fulfill({ status: 404, body: "" });
    }
    return route.continue();
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
  await page.waitForFunction(() => document.getElementById("mobilityFoot")?.textContent.trim().length > 0 && document.getElementById("mobilityFoot").textContent.trim() !== "—");
  page.context_ = context;
  return page;
}
const close = (page) => page.context_.close();

async function place(page, which, [lat, lon], radiusM) {
  await page.evaluate(({ which, lat, lon, radiusM }) => {
    const api = window.__HALO_REGRESSION__;
    api.setRadius(which, radiusM);
    api.moveLensToLatLng(which, lat, lon);
  }, { which, lat, lon, radiusM });
}
const text = (page, selector) => page.locator(selector).first().evaluate((node) => node.textContent.trim());
async function card(page) {
  return page.evaluate(() => ({
    value: document.getElementById("mobilityValue").textContent.trim(),
    abstain: document.getElementById("mobilityValue").classList.contains("abstain"),
    foot: document.getElementById("mobilityFoot").textContent.trim(),
    title: document.getElementById("mobilityValue").title,
    summaryValue: document.getElementById("placeCircleMobilityValue").textContent.trim(),
    summaryState: document.getElementById("placeCircleMobilityState").textContent.trim(),
  }));
}
async function openCompare(page) {
  await page.evaluate(() => window.__HALO_REGRESSION__.setMapView(40.437, -3.696, 14));
  await page.locator("#lensBButton").click();
  await page.locator("#compareDetail > summary").click();
  await page.waitForFunction(() => document.querySelectorAll(".comparison-halo-icon").length > 0);
}
async function compareRow(page) {
  return page.evaluate(() => ({
    a: document.getElementById("cmpMobilityA").textContent.trim(),
    b: document.getElementById("cmpMobilityB").textContent.trim(),
    relation: document.getElementById("cmpMobility").textContent.trim(),
    haloA: window.__HALO_REGRESSION__.haloValueText("A", "mobility"),
    haloB: window.__HALO_REGRESSION__.haloValueText("B", "mobility"),
    bridge: window.__HALO_REGRESSION__.bridgeModel("mobility"),
    insight: window.__HALO_REGRESSION__.decisionInsight().items.find((item) => item.metricId === "mobility"),
    summary: document.getElementById("comparisonHaloSummary").textContent,
  }));
}

// ---------------------------------------------------------------------- PLACE

test("Sol at 900 m: the combined count is shown, with the completeness limitation disclosed", async () => {
  const page = await openPage();
  try {
    await place(page, "A", SOL, 900);
    const c = await card(page);
    assert.equal(c.value, "5");
    assert.equal(c.abstain, false);
    assert.match(c.foot, /rail: queried central area/);
    assert.match(c.title, /fits inside it, but completeness of the source within it is not verified/);
    assert.equal(c.summaryValue, "5");
  } finally { await close(page); }
});

test("Sol at 5 km and Retiro at 5 km: the truncated count is withheld, not displayed", async () => {
  const page = await openPage();
  try {
    for (const centre of [SOL, RETIRO]) {
      await place(page, "A", centre, 5000);
      const c = await card(page);
      assert.equal(c.value, "Withheld");
      assert.equal(c.abstain, true);
      assert.match(c.foot, /Lens extends beyond the Metro\/Cercanías extraction area/);
      assert.match(c.title, /so missing stations would read as zero/);
      assert.equal(c.summaryValue, "Withheld", "the circle summary reads the same card");
      assert.doesNotMatch(c.value + c.summaryValue, /^\d+$/);
    }
  } finally { await close(page); }
});

test("Barajas at 500 m, 900 m and 2 km: withheld at every radius, never the one bike a truncated sum would show", async () => {
  const page = await openPage();
  try {
    for (const radius of [500, 900, 2000]) {
      await place(page, "A", BARAJAS, radius);
      const c = await card(page);
      assert.equal(c.value, "Withheld", `r=${radius}`);
      assert.notEqual(c.value, "1");
      assert.notEqual(c.value, "0");
      assert.match(c.foot, /extraction area/);
    }
    // The individual record is still a real nearby feature: nothing is hidden.
    await place(page, "A", BARAJAS, 500);
    assert.match(await text(page, "#nearestList"), /BiciMAD barajas/);
  } finally { await close(page); }
});

test("a genuine observed zero inside the queried area is a zero, not Withheld and not No data", async () => {
  const page = await openPage();
  try {
    await place(page, "A", QUIET_CENTRE, 300);
    const c = await card(page);
    assert.equal(c.value, "0");
    assert.equal(c.abstain, false);
  } finally { await close(page); }
});

test("source unavailability is independent: an unreadable rail layer is No data wherever the Lens is", async () => {
  const unreadable = { ...FIXTURE, layers: { bike: FIXTURE.layers.bike }, status: { bike: FIXTURE.status.bike } };
  const page = await openPage({ fixture: unreadable }).catch(() => null);
  // Without a rail layer the live fallback is blocked (offline), so the layer is unavailable.
  assert.ok(page, "page opened");
  try {
    for (const centre of [SOL, BARAJAS]) {
      await place(page, "A", centre, 900);
      const c = await card(page);
      assert.equal(c.value, "No data", "availability outranks geography");
      assert.match(c.foot, /some mobility sources unavailable/);
    }
  } finally { await close(page); }
});

test("an artefact that does not state its extraction rectangle fails closed, even inside the area", async () => {
  const old = { ...FIXTURE, status: { ...FIXTURE.status, rail: { ok: true, count: 3, error: null } } };
  const page = await openPage({ fixture: old });
  try {
    await place(page, "A", SOL, 900);
    const c = await card(page);
    assert.equal(c.value, "Withheld");
    assert.match(c.foot, /could not be verified/);
  } finally { await close(page); }
});

test("a rectangle recorded with different bounds is not trusted (build/browser drift fails closed)", async () => {
  const drifted = { ...FIXTURE, status: { ...FIXTURE.status, rail: { ...FIXTURE.status.rail, extraction: { ...RECORD, bounds: { ...RECORD.bounds, east: -3.6 } } } } };
  const page = await openPage({ fixture: drifted });
  try {
    await place(page, "A", SOL, 900);
    assert.equal((await card(page)).value, "Withheld");
  } finally { await close(page); }
});

test("the category mix leaves a withheld Mobility out and says so", async () => {
  const page = await openPage();
  try {
    await place(page, "A", BARAJAS, 900);
    const mix = await page.evaluate(() => ({ pct: document.getElementById("pctBike").textContent.trim(), label: document.getElementById("mixLabel").textContent }));
    assert.equal(mix.pct, "—");
    assert.match(mix.label, /Mobility withheld/);
    await place(page, "A", SOL, 900);
    assert.match(await text(page, "#pctBike"), /^\d+%$/);
  } finally { await close(page); }
});

// -------------------------------------------------------------------- COMPARE

test("equal radii, A eligible and B ineligible: A keeps its qualified value, B and the comparison are withheld on every surface", async () => {
  const page = await openPage();
  try {
    await openCompare(page);
    await place(page, "A", SOL, 900);
    await place(page, "B", NORTH_EDGE, 900);
    const row = await compareRow(page);
    assert.match(row.a, /^5 nodes/);
    assert.match(row.b, /^Withheld/);
    assert.match(row.relation, /^Withheld · Lens extends beyond the Metro\/Cercanías extraction area$/);
    assert.equal(row.haloA, "5");
    assert.equal(row.haloB, "—");
    assert.equal(row.bridge.a.evidence, "VALID");
    assert.equal(row.bridge.a.rawValue, 5);
    assert.equal(row.bridge.b.evidence, "WITHHELD_EXTRACTION");
    assert.equal(row.bridge.b.rawValue, null);
    assert.equal(row.bridge.relationship.comparable, false);
    assert.equal(row.bridge.relationship.deltaValue, null);
    assert.equal(row.bridge.relationship.withheldReasonCode, "extraction-bounds");
    assert.equal(row.insight.state, "withheld");
    assert.match(row.insight.relationship, /Lens extends beyond the Metro\/Cercanías extraction area/);
    assert.match(row.summary, /Lens B mobility withheld/);
    assert.doesNotMatch(row.summary, /Lens A mobility withheld/);
    const ariaB = await page.locator(".halo-glyph.halo-b.halo-slot-south").getAttribute("aria-label");
    assert.match(ariaB, /Mobility nodes: withheld, the Lens extends beyond the geographic extraction area/);
    assert.equal(await page.locator(".halo-glyph.halo-b.halo-slot-south").getAttribute("data-visual-state"), "withheld");
  } finally { await close(page); }
});

test("unequal radii: the geographic reason outranks the window-size reason", async () => {
  const page = await openPage();
  try {
    await openCompare(page);
    await place(page, "A", SOL, 900);
    await place(page, "B", BARAJAS, 1800);
    const row = await compareRow(page);
    assert.equal(row.bridge.relationship.withheldReasonCode, "extraction-bounds");
    assert.match(row.relation, /extraction area/);
    assert.doesNotMatch(row.relation, /window sizes/);
    // Eligible on both sides but different windows keeps the existing reason.
    await place(page, "B", RETIRO, 1800);
    const eligible = await compareRow(page);
    assert.equal(eligible.bridge.relationship.withheldReasonCode, "different-window-sizes");
    assert.match(eligible.a, /^5 nodes/);
    assert.match(eligible.b, /nodes/);
  } finally { await close(page); }
});

test("both Lenses ineligible: both sides withheld, nothing numeric, nothing 'unavailable'", async () => {
  const page = await openPage();
  try {
    await openCompare(page);
    await place(page, "A", BARAJAS, 900);
    await place(page, "B", HORTALEZA, 900);
    const row = await compareRow(page);
    assert.match(row.a, /^Withheld/);
    assert.match(row.b, /^Withheld/);
    assert.equal(row.haloA, "—");
    assert.equal(row.haloB, "—");
    assert.equal(row.bridge.a.evidence, "WITHHELD_EXTRACTION");
    assert.equal(row.bridge.b.evidence, "WITHHELD_EXTRACTION");
    assert.equal(row.insight.state, "withheld");
    assert.doesNotMatch(row.a + row.b, /Unavailable|N\/A/);
    assert.match(row.summary, /Lens A mobility withheld/);
    assert.match(row.summary, /Lens B mobility withheld/);
  } finally { await close(page); }
});

test("both Lenses eligible: the ordinary comparison, with the limitation disclosed", async () => {
  const page = await openPage();
  try {
    await openCompare(page);
    await place(page, "A", SOL, 900);
    await place(page, "B", RETIRO, 900);
    const row = await compareRow(page);
    assert.match(row.a, /^5 nodes/);
    assert.equal(row.bridge.relationship.comparable, true);
    assert.equal(typeof row.bridge.relationship.deltaValue, "number");
    assert.match(row.summary, /limited to the queried central area and its completeness is not verified/);
    assert.match(await page.locator("#cmpMobilityA").getAttribute("title"), /completeness of the source within it is not verified/);
  } finally { await close(page); }
});

test("moving a Lens across the boundary changes state without ever showing a partial sum", async () => {
  const page = await openPage();
  try {
    const seen = [];
    for (const lat of [40.43, 40.446, 40.452, 40.4545, 40.46]) {
      await place(page, "A", [lat, -3.695], 900);
      seen.push((await card(page)).value);
    }
    // 40.43 and 40.446 fit inside; 40.452 reaches the northern edge; later ones are outside.
    assert.deepEqual(seen.map((value) => (/^\d+$/.test(value) ? "number" : value)), ["number", "number", "Withheld", "Withheld", "Withheld"]);
  } finally { await close(page); }
});

// ------------------------------------------------------------- ES / EN, mobile

test("ES: the withheld copy and the disclosure are Spanish, on the card and in the comparison", async () => {
  const page = await openPage();
  try {
    await page.locator("#languageSelect").selectOption("es");
    await openCompare(page);
    await place(page, "A", SOL, 900);
    await place(page, "B", NORTH_EDGE, 900);
    await page.evaluate(() => window.__HALO_REGRESSION__.setActive("A"));
    const c = await card(page);
    assert.match(c.foot, /tren: área central consultada/);
    assert.match(c.title, /no se ha verificado la completitud/);
    const row = await compareRow(page);
    assert.match(row.b, /^Retenido/);
    assert.match(row.relation, /^Retenido · la Lente excede el área de extracción de Metro\/Cercanías$/);
    await place(page, "A", SOL, 5000);
    const withheld = await card(page);
    assert.equal(withheld.value, "Retenido");
    assert.match(withheld.foot, /La Lente excede el área de extracción de Metro\/Cercanías/);
    const ariaB = await page.locator(".halo-glyph.halo-b.halo-slot-south").getAttribute("aria-label");
    assert.match(ariaB, /retenido: la Lente excede el área de extracción geográfica/);
  } finally { await close(page); }
});

test("mobile 390x844: the withheld state fits, in both languages, with no horizontal overflow", async () => {
  const page = await openPage({ viewport: { width: 390, height: 844 } });
  try {
    for (const language of ["en", "es"]) {
      await page.locator("#languageSelect").selectOption(language);
      await place(page, "A", BARAJAS, 900);
      const fit = await page.evaluate(() => {
        const foot = document.getElementById("mobilityFoot");
        const value = document.getElementById("mobilityValue");
        return {
          overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          footClipped: foot.scrollWidth > foot.clientWidth + 1,
          valueClipped: value.scrollWidth > value.clientWidth + 1,
          footText: foot.textContent.trim(),
        };
      });
      assert.equal(fit.overflowX, false, language);
      assert.equal(fit.footClipped, false, `${language}: ${fit.footText}`);
      assert.equal(fit.valueClipped, false, language);
    }
  } finally { await close(page); }
});

// ----------------------------------------------------- evidence export / URL

async function bundleOf(page) {
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__.k11Bundle()));
  const bundle = await page.evaluate(() => window.__HALO_REGRESSION__.k11Bundle());
  const file = (prefix) => JSON.parse(bundle.files.find((entry) => entry.name.startsWith(prefix)).text);
  return {
    reading: file("reading-"),
    sources: file("sources-"),
    readme: bundle.files.find((entry) => entry.name.startsWith("README-")).text,
  };
}
const mobilityValue = (reading) => reading.values.find((value) => value.id === "mobility");

test("export, PLACE inside the area: a valid count that carries the boundary and says completeness is not verified", async () => {
  const page = await openPage();
  try {
    await place(page, "A", SOL, 900);
    const { reading, sources, readme } = await bundleOf(page);
    const value = mobilityValue(reading);
    assert.equal(value.state, "VALID");
    assert.equal(value.value, 5);
    assert.equal(value.extraction_eligibility.state, "WITHIN_EXTRACTION_BOUNDS");
    assert.equal(value.extraction_eligibility.withheld, false);
    assert.equal(value.extraction_eligibility.is_coverage_evidence, false);
    assert.equal(value.extraction_eligibility.completeness, "NOT_VERIFIED");
    assert.deepEqual(
      { west: value.extraction_eligibility.bounds.west, south: value.extraction_eligibility.bounds.south, east: value.extraction_eligibility.bounds.east, north: value.extraction_eligibility.bounds.north },
      RECORD.bounds,
    );
    assert.match(value.extraction_eligibility.origin, /CENTRAL_MADRID_ENVELOPE/);
    assert.match(value.extraction_eligibility.limitation, /completeness of the source is not verified/);
    const rail = sources.sources.find((source) => source.id === "rail");
    assert.equal(rail.extraction_bounds.is_coverage_evidence, false);
    assert.match(rail.interpretation_ceiling, /extraction rectangle/);
    assert.match(readme, /extraction boundary: W -3\.745, S 40\.385, E -3\.645, N 40\.455/);
  } finally { await close(page); }
});

test("export, PLACE beyond the area: WITHHELD with a reason, no value, no zero, boundary attached", async () => {
  const page = await openPage();
  try {
    await place(page, "A", BARAJAS, 900);
    const { reading, readme } = await bundleOf(page);
    const value = mobilityValue(reading);
    assert.equal(value.state, "WITHHELD");
    assert.equal(value.value, null);
    assert.equal(value.display, null);
    assert.equal(value.withheld_reason, "geographic extraction bounds");
    assert.equal(value.extraction_eligibility.state, "OUTSIDE_EXTRACTION_BOUNDS");
    assert.equal(value.extraction_eligibility.withheld, true);
    assert.match(readme, /Mobility nodes \[LENS_CIRCLE\]: WITHHELD \(geographic extraction bounds\)/);
    assert.doesNotMatch(JSON.stringify(value), /"value":\s*(0|1)\b/);
  } finally { await close(page); }
});

test("export, COMPARE: A's value, B withheld, both eligibility states attached", async () => {
  const page = await openPage();
  try {
    await openCompare(page);
    await place(page, "A", SOL, 900);
    await place(page, "B", BARAJAS, 900);
    await page.evaluate(() => window.__HALO_REGRESSION__.enterMode("COMPARE"));
    const { reading } = await bundleOf(page);
    const value = mobilityValue(reading);
    assert.equal(value.state, "WITHHELD");
    assert.equal(value.a_value, 5);
    assert.equal(value.b_value, null);
    assert.equal(value.delta, null);
    assert.equal(value.extraction_eligibility.a_state, "WITHIN_EXTRACTION_BOUNDS");
    assert.equal(value.extraction_eligibility.b_state, "OUTSIDE_EXTRACTION_BOUNDS");
    assert.match(value.withheld_reason, /geographic extraction bounds/);
  } finally { await close(page); }
});

test("the share URL stores no geographic status and restores the same withheld reading deterministically", async () => {
  const page = await openPage();
  let shareUrl;
  try {
    await place(page, "A", BARAJAS, 900);
    shareUrl = await page.evaluate(() => window.__HALO_REGRESSION__.k11Url());
    assert.doesNotMatch(shareUrl, /extraction|withheld|WITHIN|OUTSIDE|PARTIAL/i);
  } finally { await close(page); }
  const restoreUrl = new URL(shareUrl);
  restoreUrl.searchParams.set("haloRegressionTest", "1");
  const restored = await openPage({ url: restoreUrl.toString() });
  try {
    await restored.waitForFunction(() => window.__HALO_REGRESSION__.k11Restored() === true);
    assert.equal((await card(restored)).value, "Withheld");
  } finally { await close(restored); }
});
