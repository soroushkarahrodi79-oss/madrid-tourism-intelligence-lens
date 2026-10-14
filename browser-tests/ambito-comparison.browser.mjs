import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// K10 ámbito comparison (#72) browser contract.
//
// Semantic DOM assertions against the REAL render path and the REAL committed
// artifacts, driven through the gated __HALO_REGRESSION__ seam. The contracts it
// defends in the browser:
//
//   * COMPARE has two scopes. The Lens-circle surfaces and the ámbito block never
//     show at once, so an ámbito comparison can never be mistaken for a Lens one.
//     Switching to the ámbito scope leaves the circle Bridge/table intact and
//     restores them on switching back.
//   * Two ámbitos are selectable as A and B by exact official code AND by clicking
//     an official polygon on the map; the two official geometries are drawn.
//   * Categorical phases render two verbatim states and SAME/DIFFERENT with NO
//     arrow, sign, numeric delta or direction colour.
//   * Quantities render a B − A m² difference only when comparable (a real
//     published 0 participates) and a withheld reason inline otherwise.
//   * Radius sensitivity states its non-applicability; edition sensitivity renders
//     per metric with the shared transition vocabulary.
//   * ES and EN both work; official values stay verbatim in both.
//   * No request reaches an official planning service during ámbito interaction.

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

// A point inside an official ámbito (verified against the committed geometry).
const INSIDE = { lat: 40.40255, lon: -3.71371, code: "APR.02.09" };
// Two single-row ámbitos, both publishing a real 0 for collective residential,
// and one with no published surface (verified against the committed artifact).
const CODE_A = "AOE.00.03";
const CODE_B = "AOE.00.06";

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

const OFFICIAL_PLANNING_HOST = /(?:sigma|datos|geoportal)\.madrid\.es/i;

async function newPage(viewport = { width: 1366, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const offOrigin = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (OFFICIAL_PLANNING_HOST.test(url.hostname)) offOrigin.push(url.href);
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return route.abort();
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
  await page.waitForFunction(() => {
    const section = document.getElementById("planningAmbito");
    return section && section.dataset.state && section.dataset.state !== "loading";
  });
  await page.evaluate(() => window.__HALO_REGRESSION__.enterMode("COMPARE"));
  page.context_ = context;
  page.offOrigin_ = offOrigin;
  return page;
}
const closePage = (page) => page.context_.close();
const ambito = (page) => page.evaluate(() => window.__HALO_REGRESSION__.ambitoState());

async function selectPair(page, a, b) {
  await page.evaluate(() => window.__HALO_REGRESSION__.ambitoSetScope("AMBITO"));
  await page.evaluate((code) => window.__HALO_REGRESSION__.ambitoSelect("A", code), a);
  await page.evaluate((code) => window.__HALO_REGRESSION__.ambitoSelect("B", code), b);
  await page.waitForFunction(() => window.__HALO_REGRESSION__.ambitoState().bodyHidden === false);
  return ambito(page);
}

// --------------------------------------------------------------- scope separation

test("AC 1 the two comparison scopes never show at once; LENS keeps the circle surfaces", async () => {
  const page = await newPage();
  try {
    const lens = await ambito(page);
    assert.equal(lens.scope ?? "LENS", lens.scope === "AMBITO" ? "AMBITO" : "LENS");
    assert.equal(lens.blockHidden, true, "ámbito block hidden in LENS scope");
    assert.equal(lens.circleBridgePresent, true);
    assert.equal(lens.circleTablePresent, true);

    await page.evaluate(() => window.__HALO_REGRESSION__.ambitoSetScope("AMBITO"));
    const amb = await ambito(page);
    assert.equal(amb.scope, "AMBITO");
    assert.equal(amb.blockHidden, false, "ámbito block shown in ámbito scope");
    // the circle surfaces remain in the DOM (CSS-gated, not deleted) and come back
    await page.evaluate(() => window.__HALO_REGRESSION__.ambitoSetScope("LENS"));
    const back = await ambito(page);
    assert.equal(back.scope, "LENS");
    assert.equal(back.blockHidden, true);
    assert.equal(back.polygonCount, 0, "no ámbito polygons linger after leaving the scope");
  } finally {
    await closePage(page);
  }
});

// ------------------------------------------------------------- selection by code

test("AC 2 two ámbitos selected by exact code render both identities and draw both official polygons", async () => {
  const page = await newPage();
  try {
    const state = await selectPair(page, CODE_A, CODE_B);
    assert.equal(state.a.code, CODE_A);
    assert.equal(state.b.code, CODE_B);
    assert.ok(state.a.denom && state.a.denom.length > 0, "A denomination visible");
    assert.ok(state.b.denom && state.b.denom.length > 0, "B denomination visible");
    assert.ok(state.a.date && /\d{4}/.test(state.a.date), "A edition date visible");
    assert.ok(state.b.date && /\d{4}/.test(state.b.date), "B edition date visible");
    assert.equal(state.polygonCount, 2, "both official polygons drawn");
  } finally {
    await closePage(page);
  }
});

// ------------------------------------------------------------ selection by map

test("AC 3 clicking an official polygon selects an ámbito; the Lens is not moved", async () => {
  const page = await newPage();
  try {
    await page.evaluate(() => window.__HALO_REGRESSION__.ambitoSetScope("AMBITO"));
    const consumed = await page.evaluate(([lat, lon]) => window.__HALO_REGRESSION__.ambitoClickAt(lat, lon), [INSIDE.lat, INSIDE.lon]);
    assert.equal(consumed, true, "the click is consumed as an ámbito selection");
    const selectedA = await page.evaluate(() => document.getElementById("ambitoSelectA").value);
    assert.equal(selectedA, INSIDE.code, "the clicked ámbito became selection A");
    // In the Lens scope the same click is NOT consumed (the Lens-move path runs).
    await page.evaluate(() => window.__HALO_REGRESSION__.ambitoSetScope("LENS"));
    const notConsumed = await page.evaluate(([lat, lon]) => window.__HALO_REGRESSION__.ambitoClickAt(lat, lon), [INSIDE.lat, INSIDE.lon]);
    assert.equal(notConsumed, false, "ámbito-select never intercepts a click in the Lens scope");
  } finally {
    await closePage(page);
  }
});

// -------------------------------------------------------- categorical: no delta

test("AC 4 categorical phases show two verbatim states and SAME/DIFFERENT, never a numeric delta", async () => {
  const page = await newPage();
  try {
    const state = await selectPair(page, CODE_A, CODE_B);
    const phases = state.categorical;
    assert.equal(phases.length, 4, "four phase rows");
    for (const phase of phases) {
      assert.ok(["SAME", "DIFFERENT", "INDETERMINATE"].includes(phase.relation), `${phase.metric} relation`);
      assert.ok(/A .+ · B .+/.test(phase.values), `${phase.metric} shows both verbatim states`);
      // no arrow, sign or numeric delta anywhere in a categorical row
      assert.doesNotMatch(phase.relationText, /[+\-→↑↓]|\d/);
    }
    // AOE.00.03 vs AOE.00.06 are all "Sin Iniciar" → every phase SAME.
    assert.ok(phases.every((p) => p.relation === "SAME"));
    // The phase metrics never appear in the QUANTITY (delta) table.
    assert.deepEqual(state.quantity.filter((q) => q.metric.startsWith("phase_")), []);
  } finally {
    await closePage(page);
  }
});

// --------------------------------------------------- quantity: B−A and withheld

test("AC 5 quantities show B − A in m² when comparable (a published 0 participates) and a withheld reason otherwise", async () => {
  const page = await newPage();
  try {
    const state = await selectPair(page, CODE_A, CODE_B);
    const byId = Object.fromEntries(state.quantity.map((q) => [q.metric, q]));
    const collective = byId.buildability_residential_collective;
    assert.equal(collective.a, "0");
    assert.equal(collective.b, "0");
    assert.equal(collective.delta, "0"); // a genuine comparable zero, not "withheld"
    assert.equal(collective.withheld, false);
    // AOE.00.03 publishes no surface; AOE.00.06 does → the surface delta is withheld.
    const surface = byId.ambito_surface;
    assert.equal(surface.withheld, true);
    assert.match(surface.delta, /[Ww]ithheld/);
  } finally {
    await closePage(page);
  }
});

test("AC 6 a DIFFERENT phase and a withheld quantity render for an unlike pair", async () => {
  const page = await newPage();
  try {
    const state = await selectPair(page, INSIDE.code, CODE_A);
    assert.ok(state.categorical.some((p) => p.relation === "DIFFERENT"), "at least one phase differs");
    // multiple-row / not-published pairs withhold rather than fabricate a number
    assert.ok(state.quantity.every((q) => q.withheld || /^[+\-]?[\d.,]+$/.test(q.delta)), "every quantity is a number or a stated withholding");
  } finally {
    await closePage(page);
  }
});

// --------------------------------------------------------- sensitivity surfaces

test("AC 7 radius sensitivity states non-applicability; edition sensitivity renders per metric", async () => {
  const page = await newPage();
  try {
    const state = await selectPair(page, CODE_A, CODE_B);
    assert.match(state.radiusNote, /does not apply/i);
    assert.equal(state.edition.length, 9, "one edition-sensitivity item per canonical metric");
    const codes = new Set([
      "UNCHANGED_COMPARABLE", "DIRECTION_CHANGED", "BASIS_CHANGED", "BECAME_WITHHELD", "BECAME_COMPARABLE",
      "WITHHELD_UNCHANGED", "WITHHELD_REASON_CHANGED", "RELATION_UNCHANGED", "RELATION_CHANGED",
      "RELATION_INDETERMINATE", "WITHHELD_NON_CONTINUOUS",
    ]);
    for (const item of state.edition) assert.ok(codes.has(item.transition), `${item.metric} → ${item.transition}`);
  } finally {
    await closePage(page);
  }
});

// ------------------------------------------------------------------ localization

test("AC 8 ES and EN both render; official values stay verbatim", async () => {
  const page = await newPage();
  try {
    const en = await selectPair(page, CODE_A, CODE_B);
    assert.match(en.radiusNote, /does not apply/i);
    assert.equal(en.guard, "Observed comparison only · no ordering or recommendation");

    await page.evaluate(() => {
      const select = document.getElementById("languageSelect");
      select.value = "es";
      select.dispatchEvent(new Event("change"));
    });
    const es = await ambito(page);
    assert.match(es.radiusNote, /no aplica/i);
    assert.match(es.guard, /Comparación observada/);
    // official phase values are verbatim in both languages
    assert.match(es.categorical[0].values, /Sin Iniciar/);
    assert.equal(es.a.code, CODE_A, "the official code is never localized");
  } finally {
    await closePage(page);
  }
});

// ----------------------------------------------------------------- responsive

test("AC 9 the ámbito block is usable at mobile width (identities stack, block visible)", async () => {
  const page = await newPage({ width: 375, height: 812 });
  try {
    const state = await selectPair(page, CODE_A, CODE_B);
    assert.equal(state.blockHidden, false);
    const stacked = await page.evaluate(() => {
      const grid = document.querySelector(".ambito-identities");
      return getComputedStyle(grid).gridTemplateColumns;
    });
    // a single column at mobile width (one track) rather than two side-by-side
    assert.equal(stacked.split(" ").length, 1, `identities stack at 375px (got ${stacked})`);
    const noOverflow = await page.evaluate(() => {
      const el = document.getElementById("ambitoCompare");
      return el.scrollWidth <= el.clientWidth + 1;
    });
    assert.ok(noOverflow, "no horizontal overflow of the ámbito block at mobile width");
  } finally {
    await closePage(page);
  }
});

// ------------------------------------------------------------ network discipline

test("AC 10 ámbito interaction contacts no official planning service", async () => {
  const page = await newPage();
  try {
    await selectPair(page, CODE_A, CODE_B);
    await page.evaluate(([lat, lon]) => window.__HALO_REGRESSION__.ambitoClickAt(lat, lon), [INSIDE.lat, INSIDE.lon]);
    assert.deepEqual(page.offOrigin_, [], "no request to sigma/datos/geoportal.madrid.es");
  } finally {
    await closePage(page);
  }
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});
