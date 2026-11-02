import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Registered unemployment (tasa absoluta de paro registrado) in the Area Profile.
// Browser contract: the publisher's barrio value is shown for the WHOLE official
// barrio (never changed by the Lens radius), in ES/EN and Light/Dark, at a narrow
// viewport, with its period and scope; it is transcribed into the K11 evidence
// export; and when its source cannot be read the block says so (never 0%) while
// the rest of the Area Profile stands.

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
const BASE = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PW_EXECUTABLE_PATH || undefined });
test.after(async () => { await browser.close(); server.close(); });

// Centre inside Palacio (barrio 011), whose published value is 5.41.
const palacioUrl = (language) =>
  `${BASE}/?v=1&s=20261029-m3-dossier-v1&m=PLACE&a=40.4155%2C-3.7142%2C900&be=0&al=A&ly=&sc=LENS&rd=analyst&lg=${language}&haloRegressionTest=1`;

async function open(language, { viewport = { width: 1366, height: 900 }, blockParo = false } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return route.abort();
    if (blockParo && url.pathname.includes("madrid_registered_unemployment")) return route.abort();
    return route.continue();
  });
  await page.goto(palacioUrl(language), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__) && window.__HALO_REGRESSION__.k11Restored() === true);
  await page.waitForFunction(() => document.getElementById("areaProfile").dataset.state === "resolved");
  page.context_ = context;
  return page;
}
const close = (page) => page.context_.close();
const text = (page, id) => page.locator(`#${id}`).innerText();

test("EN: the whole-barrio value, period, official name and scope are shown; the radius never changes it", async () => {
  const page = await open("en");
  try {
    await page.waitForFunction(() => document.getElementById("areaParo").dataset.state === "available");
    assert.equal(await page.locator("#areaHeadline").innerText(), "Palacio");
    assert.equal(await page.locator("#areaParo").isVisible(), true);
    assert.equal(await text(page, "areaParoValue"), "5.41%");
    assert.match(await text(page, "areaParo"), /registered unemployment/i);
    assert.match(await text(page, "areaParoUnit"), /population aged 16–64/);
    assert.match(await text(page, "areaParoState"), /tasa absoluta de paro registrado\) · Feb 2026/);
    const note = await text(page, "areaParoNote");
    assert.match(note, /Whole official barrio — not the Lens circle/);
    assert.match(note, /not a tourism impact/);
    // The Lens circle is a different object: growing it must not move the figure.
    await page.evaluate(() => { window.__HALO_REGRESSION__.setRadius("A", 1500); window.__HALO_REGRESSION__.recompute(); });
    assert.equal(await text(page, "areaParoValue"), "5.41%");
    // Neutral presentation: no scale, band, rank or comparison affordance inside the block.
    assert.equal(await page.locator("#areaParo meter, #areaParo progress, #areaParo svg, #areaParo canvas, #areaParo [role=img]").count(), 0);
    assert.doesNotMatch(await text(page, "areaParo"), /rank|percentile|higher than|lower than|tourism pressure/i);
  } finally {
    await close(page);
  }
});

test("ES: labels and number format follow the document language and switch live", async () => {
  const page = await open("es");
  try {
    await page.waitForFunction(() => document.getElementById("areaParo").dataset.state === "available");
    assert.equal(await text(page, "areaParoValue"), "5,41 %");
    assert.match(await text(page, "areaParo"), /paro registrado/i);
    assert.match(await text(page, "areaParoState"), /tasa absoluta de paro registrado\) · feb 2026/);
    assert.match(await text(page, "areaParoNote"), /no el círculo de la Lente/);
    await page.selectOption("#languageSelect", "en");
    assert.equal(await text(page, "areaParoValue"), "5.41%");
    assert.match(await text(page, "areaParo"), /registered unemployment/i);
    await page.selectOption("#languageSelect", "es");
    assert.equal(await text(page, "areaParoValue"), "5,41 %");
  } finally {
    await close(page);
  }
});

test("Light and Dark: the figure and its qualifying lines keep readable contrast", async () => {
  const page = await open("en");
  try {
    await page.waitForFunction(() => document.getElementById("areaParo").dataset.state === "available");
    for (const appearance of ["dark", "light"]) {
      await page.evaluate((value) => { document.documentElement.dataset.appearance = value; }, appearance);
      const ratios = await page.evaluate(() => {
        const parse = (css) => css.match(/[\d.]+/g).map(Number);
        const luminance = ([r, g, b]) => {
          const channel = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
          return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
        };
        const backdrop = (el) => {
          for (let node = el; node; node = node.parentElement) {
            const [r, g, b, a = 1] = parse(getComputedStyle(node).backgroundColor);
            if (a > 0.5) return [r, g, b];
          }
          return [255, 255, 255];
        };
        return ["areaParoValue", "areaParoUnit", "areaParoState", "areaParoNote"].map((id) => {
          const el = document.getElementById(id);
          const fg = luminance(parse(getComputedStyle(el).color).slice(0, 3));
          const bg = luminance(backdrop(el));
          const [hi, lo] = fg > bg ? [fg, bg] : [bg, fg];
          return { id, ratio: (hi + 0.05) / (lo + 0.05) };
        });
      });
      for (const { id, ratio } of ratios) assert.ok(ratio >= 4.5, `${appearance} ${id} contrast ${ratio.toFixed(2)}`);
    }
  } finally {
    await close(page);
  }
});

test("360px: the block stays inside the viewport with no horizontal overflow", async () => {
  const page = await open("es", { viewport: { width: 360, height: 740 } });
  try {
    await page.waitForFunction(() => document.getElementById("areaParo").dataset.state === "available");
    const box = await page.evaluate(() => {
      const el = document.getElementById("areaParo");
      el.scrollIntoView({ block: "center" });
      const rect = el.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, docOverflow: document.documentElement.scrollWidth - window.innerWidth };
    });
    assert.ok(box.left >= 0 && box.right <= 360, `block within viewport (${box.left}..${box.right})`);
    assert.ok(box.docOverflow <= 0, "no horizontal page overflow");
    assert.equal(await text(page, "areaParoValue"), "5,41 %");
    const children = await page.evaluate(() => [...document.querySelectorAll("#areaParo *")].filter((n) => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflow !== "visible").length);
    assert.equal(children, 0, "no clipped child");
  } finally {
    await close(page);
  }
});

test("K11 export transcribes the visible value with scope, unit and per-source provenance", async () => {
  const page = await open("en");
  try {
    await page.waitForFunction(() => document.getElementById("areaParo").dataset.state === "available");
    const bundle = await page.evaluate(() => window.__HALO_REGRESSION__.k11Bundle());
    const reading = JSON.parse(bundle.files.find((f) => f.name.startsWith("reading-")).text);
    const value = reading.values.find((v) => v.id === "registered_unemployment_rate");
    assert.ok(value, "the visible value is exported");
    assert.equal(value.scope, "OFFICIAL_BARRIO");
    assert.equal(value.value, 5.41);
    assert.equal(value.display, "5.41%");
    assert.equal(value.unit, "percent");
    assert.equal(value.state, "VALID");
    const unemployment = value.provenance.find((p) => p.id === "registered_unemployment_rate");
    assert.equal(unemployment.freshness.reference_date, "2026-02");
    assert.match(unemployment.interpretation_ceiling, /NOT the EPA unemployment rate/);
    assert.ok(value.provenance.some((p) => p.id === "geography"));
    // The residents value beside it is still exported unchanged.
    assert.ok(reading.values.some((v) => v.id === "residents"));
  } finally {
    await close(page);
  }
});

test("an unreadable unemployment source is stated, never 0%, and costs only its own block", async () => {
  const page = await open("en", { blockParo: true });
  try {
    await page.waitForFunction(() => document.getElementById("areaParo").dataset.state === "unavailable");
    assert.equal(await text(page, "areaParoValue"), "Unavailable");
    assert.match(await text(page, "areaParoState"), /Unemployment source unavailable in this session/);
    assert.doesNotMatch(await text(page, "areaParo"), /0(\.00)?\s?%/);
    // The place and the resident figure stand.
    assert.equal(await page.locator("#areaHeadline").innerText(), "Palacio");
    assert.notEqual(await text(page, "areaResidentsValue"), "—");
    const bundle = await page.evaluate(() => window.__HALO_REGRESSION__.k11Bundle());
    const reading = JSON.parse(bundle.files.find((f) => f.name.startsWith("reading-")).text);
    const value = reading.values.find((v) => v.id === "registered_unemployment_rate");
    assert.equal(value.state, "UNAVAILABLE");
    assert.equal(value.value, null);
    assert.equal(value.withheld_reason, "ARTIFACT_UNAVAILABLE");
  } finally {
    await close(page);
  }
});

test("outside Madrid there is no barrio statistic: the block is absent, emptied and not exported", async () => {
  const page = await open("en");
  try {
    await page.waitForFunction(() => document.getElementById("areaParo").dataset.state === "available");
    // Far outside the map: no barrio contains the point, so no barrio statistic applies.
    await page.evaluate(() => { window.__HALO_REGRESSION__.moveLens("A", 3000, 3000); window.__HALO_REGRESSION__.recompute(); });
    await page.waitForFunction(() => document.getElementById("areaProfile").dataset.state === "outside_madrid");
    const state = await page.evaluate(() => ({
      hidden: document.getElementById("areaParo").hidden,
      state: document.getElementById("areaParo").dataset.state,
      value: document.getElementById("areaParoValue").textContent,
    }));
    assert.deepEqual(state, { hidden: true, state: "not_applicable", value: "—" });
    const bundle = await page.evaluate(() => window.__HALO_REGRESSION__.k11Bundle());
    const ids = bundle ? JSON.parse(bundle.files.find((f) => f.name.startsWith("reading-")).text).values.map((v) => v.id) : [];
    assert.ok(!ids.includes("registered_unemployment_rate"), "nothing is exported for a block that is not shown");
  } finally {
    await close(page);
  }
});

// Cache coherence. Resources changed after AREA_ASSET_VERSION was cut are requested under ONE
// release version; unmodified data artifacts keep the original asset identity; the K11 snapshot
// id does not move. A browser can then never pair a new app.js with a cached registry,
// dictionary, scope rail or Area Profile module.
test("actual request URLs: modified resources carry the release version, unmodified data keeps its asset identity", async () => {
  const RELEASE = "20261102-paro-v1";
  const ASSET = "20261029-m3-dossier-v1";
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const requested = new Map();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") return;
    const versions = requested.get(url.pathname.slice(1)) || new Set();
    versions.add(url.searchParams.get("v"));
    requested.set(url.pathname.slice(1), versions);
  });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
  try {
    await page.goto(palacioUrl("en"), { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__) && window.__HALO_REGRESSION__.k11Restored() === true);
    await page.waitForFunction(() => document.getElementById("areaParo").dataset.state === "available");

    const modified = [
      "css/app.css", "js/app.js", "js/scope-rail.js", "js/shell-copy.js", "js/legacy-copy.js",
      "js/area-profile.js", "data/source_registry.json",
    ];
    for (const resource of modified) {
      assert.deepEqual([...(requested.get(resource) || [])], [RELEASE], `${resource} is requested once, under ${RELEASE}`);
    }
    const unmodifiedData = [
      "data/geography/madrid_admin.geojson", "data/geography/madrid_admin.meta.json",
      "data/population/madrid_population.json", "data/population/madrid_population.meta.json",
      "data/accommodation/madrid_vut_licences.json", "data/accommodation/madrid_vut_licences.meta.json",
      "data/socioeconomic/madrid_registered_unemployment.json", "data/socioeconomic/madrid_registered_unemployment.meta.json",
    ];
    for (const resource of unmodifiedData) {
      assert.deepEqual([...(requested.get(resource) || [])], [ASSET], `${resource} keeps the asset identity ${ASSET}`);
    }
    // The K11 snapshot id (the evidence identity) is unchanged by the cache fix.
    const bundle = await page.evaluate(() => window.__HALO_REGRESSION__.k11Bundle());
    const reading = bundle.files.find((f) => f.name.startsWith("reading-")).text;
    assert.match(reading, new RegExp(`"snapshot_id": ?"${ASSET}"`));
    // The loaded registry is the new one: it carries the new source, so provenance resolves.
    const registered = await page.evaluate(() => window.__HALO_REGRESSION__.k11Bundle().files.find((f) => f.name.startsWith("reading-")).text.includes('"missing_from_registry"'));
    assert.equal(registered, false, "no exported value points at a source missing from the loaded registry");
    console.log("requested:", JSON.stringify(Object.fromEntries([...requested].filter(([k]) => modified.includes(k) || unmodifiedData.includes(k)).map(([k, v]) => [k, [...v]]))));
  } finally {
    await context.close();
  }
});
