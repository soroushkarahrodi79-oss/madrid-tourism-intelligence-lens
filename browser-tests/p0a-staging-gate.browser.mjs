import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// P0-a staging gate (#95, PR #96 comment 6273771576) — OFF/ON browser contract.
//
// P0-a ships OFF by default, including on a loopback host, unless the URL
// explicitly carries ?p0aStaging=1 (gated on the SAME loopback/private-LAN
// predicate K12's ?k12opt= already uses — the public GitHub Pages host can
// never satisfy it regardless of query string; see
// tests/planning_membership.test.mjs's "staging gate" tests for that proof).
//
// This file proves, against the REAL render path:
//   * OFF reproduces pre-P0-a main exactly for the promoted block (hidden,
//     unscanned) and for the Detail/scope-rail surface (gated on Detail being
//     open, the pre-P0-a `planningDetail` semantics).
//   * ON (the flag set, on this loopback host) is unchanged from the full
//     PA 1-25 contract in browser-tests/planning-ambito.browser.mjs, which
//     exercises this same flag.

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

const INSIDE = { lat: 40.40255, lon: -3.71371, code: "APR.02.09" };

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

async function newPage(staged) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const query = staged ? "haloRegressionTest=1&p0aStaging=1" : "haloRegressionTest=1";
  await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
  await page.waitForFunction(() => {
    const section = document.getElementById("planningAmbito");
    return section && !section.hasAttribute("hidden") && section.dataset.state && section.dataset.state !== "loading";
  });
  page.context_ = context;
  return page;
}
const closePage = (page) => page.context_.close();

async function at(page, place) {
  await page.evaluate(([lat, lon]) => window.__HALO_REGRESSION__.moveLensToLatLng("A", lat, lon), [place.lat, place.lon]);
  await page.waitForFunction((expected) => document.getElementById("planningCode").textContent.trim() === expected, place.code ?? "");
  return page.evaluate(() => window.__HALO_REGRESSION__.planning());
}
const planning = (page) => page.evaluate(() => window.__HALO_REGRESSION__.planning());
const hasRailScope = (page, scope) =>
  page.evaluate((s) => Boolean(document.querySelector(`.scope-rail-item[data-scope="${s}"]`)), scope);

// --------------------------------------------------------------- OFF default

test("OFF (default, no ?p0aStaging): the promoted block never renders or scans", async (t) => {
  const page = await newPage(false);
  t.after(() => closePage(page));
  const view = await at(page, INSIDE);

  assert.equal(view.membership.hidden, true, "block stays hidden");
  assert.equal(view.membership.state, null, "no state is ever assigned (dataset reads back as null, not an empty string)");
  assert.equal(view.membership.countText, "", "no count line");
  assert.equal(view.membership.chips.length, 0, "no chips");
  assert.equal(view.membership.seeAllHidden, true, "the See all route never appears");
  assert.equal(await page.locator("#planningMembership").isVisible(), false);

  // The containment answer above it is completely untouched by the flag.
  assert.equal(view.identityHidden, false);
  assert.equal(view.code, INSIDE.code);
});

test("OFF: the scope rail reproduces the pre-P0-a planningDetail gate — the scope is claimed only while Detail is open", async (t) => {
  const page = await newPage(false);
  t.after(() => closePage(page));
  await at(page, INSIDE);

  assert.equal(await hasRailScope(page, "LENS_INTERSECT_AMBITO"), false, "closed Detail claims nothing");
  await page.locator("#placeDetail > summary").click();
  // <details> dispatches its "toggle" event as a queued task, not synchronously
  // with the click, so wait for the open state before reading the re-rendered rail.
  await page.waitForFunction(() => document.getElementById("placeDetail").open);
  await page.waitForFunction(() => Boolean(document.querySelector('.scope-rail-item[data-scope="LENS_INTERSECT_AMBITO"]')));
  assert.equal(await hasRailScope(page, "LENS_INTERSECT_AMBITO"), true, "opening Detail now claims it, exactly as pre-P0-a main did");
});

test("OFF: the existing Detail full list still works, unaffected by the flag (it predates P0-a)", async (t) => {
  const page = await newPage(false);
  t.after(() => closePage(page));
  await at(page, INSIDE);
  await page.locator("#placeDetail > summary").click();
  await page.waitForFunction(() => document.getElementById("placeDetail").open);
  await page.waitForFunction(() => document.getElementById("planningTouchedCard").hidden === false);
  const view = await planning(page);

  assert.equal(view.touchedCardHidden, false);
  assert.ok(view.touched.length >= 1, "the Detail list still names the touched ámbitos");
  assert.equal(view.touched.length, view.model.membership.count);
});

// ---------------------------------------------------------------- ON opt-in

test("ON (?p0aStaging=1, loopback host): the promoted block renders and claims the rail scope immediately, with Detail still closed", async (t) => {
  const page = await newPage(true);
  t.after(() => closePage(page));
  const view = await at(page, INSIDE);

  assert.equal(view.membership.hidden, false);
  assert.equal(view.membership.state, "present");
  assert.ok(view.model.membership.count >= 1);
  assert.equal(view.touchedCardHidden, true, "no forced disclosure");
  assert.equal(await hasRailScope(page, "LENS_INTERSECT_AMBITO"), true, "the rail claims it without opening Detail — the P0-a semantics");
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});
