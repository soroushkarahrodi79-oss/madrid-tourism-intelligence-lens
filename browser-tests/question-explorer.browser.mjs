// Urban evidence questions (M2) — real-browser regressions and adversarial audit.
//
// The pure model is covered by tests/question_explorer.test.mjs (the evaluation
// set, compared with direct registry calls). THIS suite settles what only a
// running application can: that the explorer is wired to the real registry and
// the real application state, that an answer is NEVER shown as current for a
// context it was not computed for, that a failed source is a stated outcome and
// not a blank, and that the surface is operable and uncluttered on every
// viewport, appearance and language.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";

const ROOT = process.env.QX_ROOT
  ? path.resolve(process.env.QX_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = process.env.QX_BROWSER === "webkit" ? webkit : chromium;
const ENGINE_NAME = process.env.QX_BROWSER === "webkit" ? "webkit" : "chromium";
const CAPTURE_DIR = process.env.QX_CAPTURE_DIR || null;
const MIME = { ".css": "text/css", ".geojson": "application/geo+json", ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(ROOT, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!target.startsWith(`${ROOT}${path.sep}`) && target !== path.join(ROOT, "index.html")) return response.writeHead(403).end();
  fs.readFile(target, (error, content) => (error
    ? response.writeHead(404).end()
    : response.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" }).end(content)));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const browser = await ENGINE.launch({ headless: true });

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

// `block` fails the real network request for an artifact, so an absent source is a
// network outcome and not a flag the application knows about.
async function pageFor({ viewport = { width: 1280, height: 900 }, colorScheme = "light", block = null, delay = null, query = "", locale } = {}) {
  const context = await browser.newContext({ viewport, colorScheme, locale });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.message)));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (block && block.some((name) => url.pathname.endsWith(name))) return route.fulfill({ status: 503, body: "unavailable" });
    if (delay && url.pathname.endsWith(delay.name)) await new Promise((resolve) => setTimeout(resolve, delay.ms));
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const api = window.__GEO_SEARCH_TEST__;
    if (!api) return false;
    const status = api.snapshot().universeStatus;
    return status.administrative !== "loading" && status.ambito !== "loading";
  });
  return { page, context, errors };
}

const snap = (page) => page.evaluate(() => window.__QUESTION_EXPLORER_TEST__.snapshot());
const answerState = (page) => page.evaluate(() => {
  const answer = document.querySelector("#qxAnswer");
  return answer.hidden ? null : {
    kind: answer.dataset.kind, stale: answer.dataset.stale, question: answer.dataset.question, busy: answer.getAttribute("aria-busy"),
    title: answer.querySelector(".qx-answer-title")?.textContent || null,
    headline: answer.querySelector(".qx-headline")?.textContent || null,
    badge: answer.querySelector(".qx-badge")?.textContent || null,
    scope: answer.querySelector(".qx-section-scope")?.textContent || null,
  };
});

async function openExplorer(page) {
  await page.locator("#geoSearchToggle").click();
  await page.waitForFunction(() => !document.querySelector("#geoSearchPanel").hasAttribute("hidden"));
  await page.waitForFunction(() => !document.querySelector("#questionExplorer").hasAttribute("hidden"));
}
async function selectAndAnalyze(page, text) {
  await page.locator("#geoSearchQuery").fill(text);
  await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
  await page.locator("#geoSearchResults button").first().click();
  await page.locator("#geoSearchAnalyze").click();
}
async function askQuestion(page, id) {
  await page.locator(`.qx-q[data-question="${id}"]`).click();
  await page.waitForFunction(() => {
    const s = window.__QUESTION_EXPLORER_TEST__.snapshot();
    return s && s.kind && s.kind !== "loading";
  }, null, { timeout: 30000 });
}
async function settled(page) {
  await page.waitForFunction(() => {
    const a = document.querySelector("#qxAnswer");
    return !a.hidden && a.dataset.stale === "false" && a.getAttribute("aria-busy") === "false";
  });
}
const lensState = (page) => page.evaluate(() => ({
  centres: window.__HALO_REGRESSION__.lensCenters(), radii: window.__GEO_SEARCH_TEST__.radii(),
  mode: document.querySelector("#analysisPanel").dataset.mode, url: location.search,
}));
async function setRadius(page, value) {
  await page.evaluate((v) => {
    const slider = document.querySelector("#radiusSlider");
    slider.value = v;
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function createDossier(page, { keyboard = false } = {}) {
  const action = page.locator("#qxAnswer .qx-action-dossier");
  if (keyboard) {
    await action.focus();
    await page.keyboard.press("Enter");
  } else {
    await action.click();
  }
  await page.waitForFunction(() => document.querySelector("#qxDossierStatus")?.dataset.tone === "ok");
  return page.evaluate(() => {
    const links = [...document.querySelectorAll("#qxDossierStatus a")];
    const generated = window.__QUESTION_EXPLORER_TEST__.dossier();
    return generated.files.map((file, index) => ({
      label: links[index]?.textContent || null,
      name: links[index]?.download || file.name,
      text: file.text,
    }));
  });
}

// ============================================================ structure and wiring

test("the explorer lives in the finder, adds nothing to the header and is wired to the real registry", async (t) => {
  const { page, context, errors } = await pageFor();
  t.after(() => context.close());
  const headerBefore = await page.evaluate(() => [...document.querySelectorAll(".header-tools > *")].map((n) => n.id || n.className));
  assert.equal(headerBefore.length, 5, "the header gains no control");
  assert.equal(await page.locator("#questionExplorer").isHidden(), true, "closed with the finder");
  await openExplorer(page);
  assert.equal(await page.locator(".qx-q[data-question]").count(), 6);
  assert.equal(await page.locator(".qx-q[aria-pressed='true']").count(), 0);
  assert.equal(await page.locator("#qxAnswer").isHidden(), true, "no answer exists before a question is asked");
  assert.equal(await page.locator("#qxRefused").evaluate((node) => node.open), false);
  for (const id of ["AMBITO_AT_POINT", "AMBITO_PHASES", "AMBITO_EDITION_DIFF", "AMBITOS_IN_LENS", "LICENCES_IN_LENS", "SOURCE_PROVENANCE"]) {
    const text = await page.locator(`.qx-q[data-question="${id}"]`).innerText();
    assert.ok(text.split("\n").length >= 2, `${id} states its subject before it is asked`);
  }
  const wiring = await page.evaluate(() => {
    const api = window.__QUESTION_EXPLORER_TEST__;
    const registry = api.registry();
    return { shapes: registry ? registry.shapes : null, ready: Boolean(api.context().readiness), model: Boolean(api.model()) };
  });
  assert.equal(wiring.shapes.length, 10, "the live registry is the K13 registry with its ten registered shapes");
  assert.equal(await page.locator("#geoSearchPanel .qx input, #geoSearchPanel .qx textarea").count(), 0, "no free-text input exists");
  assert.deepEqual(errors, []);
});

test("the explorer is fetched after the load event, never on the critical path", async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.route("**/*", (route) => (new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort()));
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "load" });
  await page.waitForFunction(() => ["question-explorer.js", "question-explorer-view.js"].every((name) => performance.getEntriesByType("resource").some((e) => e.name.includes(name))));
  const timing = await page.evaluate(() => {
    const load = performance.getEntriesByType("navigation")[0].loadEventEnd;
    const starts = ["question-explorer.js", "question-explorer-view.js"].map((n) => performance.getEntriesByType("resource").find((e) => e.name.includes(n)).startTime);
    return { load, starts, eager: document.querySelectorAll('script[src*="question-explorer"]').length };
  });
  for (const started of timing.starts) assert.ok(started > timing.load, `a question module started at ${started.toFixed(0)}ms, before load ended at ${timing.load.toFixed(0)}ms`);
  assert.equal(timing.eager, 0, "neither module is a classic script tag");
});

// ================================================================ the journey

test("find a place, ask a question, read a source-backed answer, verify it in Evidence & limits", async (t) => {
  const { page, context, errors } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  await askQuestion(page, "AMBITO_AT_POINT");
  const first = await answerState(page);
  assert.equal(first.kind, "answer");
  assert.equal(first.stale, "false");
  assert.match(first.headline, /APR\.02\.09/);
  assert.match(first.scope, /planning ámbito/i);
  // Result, scope, evidence, limits and verification are all present and in order.
  const sections = await page.locator("#qxAnswer .qx-section-title").allTextContents();
  assert.deepEqual(sections, ["Result", "Scope", "Evidence", "What this cannot show", "Verification"]);
  // The publisher declared no date for this geometry; the card says so.
  assert.match(await page.locator("#qxAnswer .qx-reference").textContent(), /not declared by the publisher/);
  // Verification reaches the existing drawer, scoped to the answer's scope, and focus returns.
  await page.locator("#qxAnswer .qx-action-drawer").click();
  await page.waitForFunction(() => document.querySelector("#evidenceDrawer").open);
  assert.deepEqual(await page.evaluate(() => ({ ...window.__EVIDENCE_DRAWER_FILTER__ })).catch(() => ({})), {}, "no test-only drawer hook is required");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("#evidenceDrawer").open);
  assert.equal(await page.evaluate(() => document.activeElement.className), "qx-action qx-action-drawer");
  assert.deepEqual(errors, []);
});

test("sharing and export are not implied to carry the question: the card says so, and the link holds no question", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  await askQuestion(page, "AMBITO_PHASES");
  await settled(page);
  const note = await page.locator("#qxAnswer .qx-share-note").textContent();
  assert.match(note, /do not include this question or its answer/);
  assert.equal(await page.locator("#qxAnswer .qx-action-drawer").getAttribute("aria-describedby"), "qxShareNote");
  assert.doesNotMatch(await page.evaluate(() => location.href), /AMBITO_PHASES|qx|question/i, "the canonical link carries no question");
});

test("the licence answer explains how to change its dates, and asking does not enable the layer", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  const layer = () => page.locator('[data-layer="licences"]').isChecked();
  assert.equal(await layer(), false);
  await askQuestion(page, "LICENCES_IN_LENS");
  assert.match(await page.locator("#qxAnswer .qx-hint").textContent(), /switch on Granted urban licences in the layers panel and edit From and To/);
  assert.equal(await layer(), false, "asking leaves the layer off");
});

test("asking for the source reads the registry's provenance for the latest answer, with all five freshness fields", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  // Nothing to explain yet: the registry's own AMBIGUOUS_SCOPE, shown as such.
  await askQuestion(page, "SOURCE_PROVENANCE");
  assert.equal((await snap(page)).reason, "AMBIGUOUS_SCOPE");
  assert.equal((await answerState(page)).kind, "abstention");
  await selectAndAnalyze(page, "APR.02.09");
  await askQuestion(page, "AMBITO_PHASES");
  await page.locator("#qxAnswer .qx-action-source").click();
  await page.waitForFunction(() => document.querySelector("#qxAnswer").dataset.question === "SOURCE_PROVENANCE");
  const state = await answerState(page);
  assert.equal(state.kind, "answer");
  assert.match(state.headline, /Published ambito development state/);
  await page.locator("#qxAnswer .qx-source-record summary").click();
  const labels = await page.locator("#qxAnswer .qx-source-record dt").allTextContents();
  for (const label of ["Reference date", "Published", "Retrieved by this project", "Update frequency", "Source state"]) assert.ok(labels.includes(label), label);
});

// ============================================================ context and scope

test("the ámbito subject is named: a finder selection, else the Lens centre, else an explicit abstention", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  // Lens at its default place (outside every ámbito), nothing selected.
  await askQuestion(page, "AMBITO_PHASES");
  assert.equal((await snap(page)).reason, "AMBIGUOUS_SCOPE");
  assert.match(await page.locator("#qxAnswer").textContent(), /select a planning ámbito in the place finder/i);
  // A selected BARRIO is never treated as an ámbito.
  await page.locator("#geoSearchQuery").fill("Sol");
  await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
  await page.locator('#geoSearchResults button[data-type="BARRIO"]').first().click();
  await page.waitForFunction(() => document.querySelector("#qxAnswer").dataset.stale === "false");
  assert.match(await page.locator("#qxAnswer").textContent(), /is a Official barrio, not a planning ámbito|not a planning ámbito, so it was not used/i);
  // Selecting an ámbito makes IT the subject, without moving the Lens.
  const before = await lensState(page);
  await page.locator("#geoSearchQuery").fill("APR.02.09");
  await page.waitForFunction(() => document.querySelector('#geoSearchResults button[data-type="AMBITO"]'));
  await page.locator('#geoSearchResults button[data-type="AMBITO"]').first().click();
  await page.waitForFunction(() => document.querySelector("#qxAnswer").dataset.stale === "false" && document.querySelector("#qxAnswer .qx-headline"));
  assert.match(await page.locator("#qxAnswer .qx-headline").textContent(), /APR\.02\.09/);
  assert.match(await page.locator("#qxAnswer").textContent(), /selected in the place finder/);
  assert.deepEqual((await lensState(page)).centres, before.centres, "answering moves no Lens");
});

test("no camera movement, Lens movement, radius change, mode change or layer toggle is caused by asking", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  const world = () => page.evaluate(() => ({
    view: window.__HALO_REGRESSION__.mapView(), centres: window.__HALO_REGRESSION__.lensCenters(), radii: window.__GEO_SEARCH_TEST__.radii(),
    mode: document.querySelector("#analysisPanel").dataset.mode,
    layers: [...document.querySelectorAll("[data-layer]")].map((i) => `${i.dataset.layer}:${i.checked}`),
    camera: window.__GEO_SEARCH_TEST__.snapshot().cameraMoves,
  }));
  const before = await world();
  for (const id of ["AMBITO_AT_POINT", "AMBITO_PHASES", "AMBITO_EDITION_DIFF", "AMBITOS_IN_LENS", "LICENCES_IN_LENS", "SOURCE_PROVENANCE"]) await askQuestion(page, id);
  await page.locator("#qxRefused summary").click();
  await page.locator('.qx-q[data-refused="dwellings"]').click();
  assert.deepEqual(await world(), before);
});

test("a licence answer states the applied window and the register's unlocated rows, and never a total", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  await askQuestion(page, "LICENCES_IN_LENS");
  // The result block only: the source's own ceiling (shown verbatim, in a disclosure) says "never summed into a cross-family total".
  const text = await page.locator("#qxAnswer .qx-section-result").textContent();
  assert.match(text, /1 Oct 2025 – 30 Sep 2026/);
  assert.match(text, /233 \/ 11,498/);
  assert.doesNotMatch(text, /\btotal\b/i);
  const counts = await page.locator("#qxAnswer .qx-section-result .qx-facts dt").allTextContents();
  assert.equal(counts.filter((label) => /licences/i.test(label)).length, 3);
  const direct = await page.evaluate(() => {
    const api = window.__QUESTION_EXPLORER_TEST__;
    const ctx = api.context();
    return api.registry().query("LICENCES_IN_LENS", { lon: ctx.lens.lon, lat: ctx.lens.lat, radiusM: ctx.lens.radiusM, window: ctx.licenceWindow }).value.perFamily;
  });
  const shown = await page.locator("#qxAnswer .qx-section-result .qx-facts dd").allTextContents();
  for (const value of Object.values(direct)) assert.ok(shown.some((cell) => cell.trim() === String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",")), `the registry's count ${value} is shown unchanged`);
});

// =============================================================== adversarial: stale

test("an answer is marked out of date in the same task as a radius change, then recomputed for the new radius", async (t) => {
  const { page, context, errors } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  await askQuestion(page, "AMBITOS_IN_LENS");
  await settled(page);
  const before = await snap(page);
  const marked = await page.evaluate(() => {
    const slider = document.querySelector("#radiusSlider");
    slider.value = 1800;
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    const answer = document.querySelector("#qxAnswer");
    return { stale: answer.dataset.stale, busy: answer.getAttribute("aria-busy"), badge: answer.querySelector(".qx-badge").textContent, note: answer.querySelector(".qx-stale")?.textContent || null };
  });
  assert.equal(marked.stale, "true", "the answer is marked out of date synchronously with the change");
  assert.equal(marked.busy, "true");
  assert.match(marked.badge, /Out of date/);
  assert.ok(marked.note, "the reader is told why");
  await settled(page);
  const after = await snap(page);
  assert.notEqual(after.contextKey, before.contextKey);
  const scope = await page.locator("#qxAnswer .qx-scope-instance").textContent();
  assert.match(scope, /1\.8 km/, "the recomputed answer describes the NEW radius");
  assert.deepEqual(errors, []);
});

test("moving the Lens by a real drag never leaves a figure that looks current for another position", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  await askQuestion(page, "LICENCES_IN_LENS");
  await settled(page);
  // The finder overlays part of the map, so the marker is dragged with it hidden
  // (the toggle hides it WITHOUT clearing the selection or the answer).
  await page.locator("#geoSearchToggle").click();
  const before = (await lensState(page)).centres;
  // Every animation frame of the drag: whenever the card claims to be current, its
  // context key must equal the key of the Lens that is on screen at that frame.
  await page.evaluate(() => {
    window.__qxAudit = { frames: 0, staleMarks: 0, violations: [] };
    const audit = window.__qxAudit;
    const api = window.__QUESTION_EXPLORER_TEST__;
    const answer = document.querySelector("#qxAnswer");
    const inspect = () => {
      if (answer.hidden) return;
      if (answer.dataset.stale === "true") return;
      if (api.snapshot().contextKey !== api.model().contextKey(api.context())) audit.violations.push(audit.frames);
    };
    // Attribute changes are observed in microtask order, so a stale mark set in the
    // same task as the Lens move is seen; the frame loop covers everything else.
    new MutationObserver(() => { if (answer.dataset.stale === "true") audit.staleMarks += 1; }).observe(answer, { attributes: true, attributeFilter: ["data-stale"] });
    (function frame() {
      audit.frames += 1;
      inspect();
      if (!audit.done) requestAnimationFrame(frame);
    })();
  });
  const box = await page.locator(".leaflet-marker-draggable").first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 170, box.y + box.height / 2 + 95, { steps: 14 });
  await page.mouse.up();
  await page.locator("#geoSearchToggle").click();
  await settled(page);
  const audit = await page.evaluate(() => { window.__qxAudit.done = true; return window.__qxAudit; });
  assert.deepEqual(audit.violations, [], "no frame showed a current-looking answer for a context it was not computed for");
  assert.ok(audit.staleMarks > 0, "the card was marked out of date while the Lens moved");
  assert.notDeepEqual((await lensState(page)).centres, before, "the Lens moved");
  assert.equal((await snap(page)).contextKey, await page.evaluate(() => window.__QUESTION_EXPLORER_TEST__.model().contextKey(window.__QUESTION_EXPLORER_TEST__.context())), "the settled answer is bound to the Lens now on screen");
});

test("Lens A and Lens B keep their own radii, and the answer follows the ACTIVE Lens", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  await page.locator("#geoSearchClose").click();
  await setRadius(page, 500);
  await page.locator("#modeCompareButton").click();
  await page.locator("#lensBButton").click();
  await setRadius(page, 2000);
  await page.locator("#lensAButton").click();
  await page.locator("#geoSearchToggle").click();
  await askQuestion(page, "AMBITOS_IN_LENS");
  await settled(page);
  assert.match(await page.locator("#qxAnswer .qx-scope-instance").textContent(), /Lens A · 500 m/);
  const aKey = (await snap(page)).contextKey;
  await page.locator("#lensBButton").click();
  assert.equal((await answerState(page)).stale, "true", "switching the active Lens makes the held answer stale");
  await settled(page);
  assert.match(await page.locator("#qxAnswer .qx-scope-instance").textContent(), /Lens B · 2 km/);
  assert.notEqual((await snap(page)).contextKey, aKey);
  const radii = (await lensState(page)).radii;
  assert.deepEqual([radii.A, radii.B], [500, 2000], "answering changed neither radius");
});

test("changing the grant-date window marks the licence answer out of date and recomputes it for the new dates", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  await askQuestion(page, "LICENCES_IN_LENS");
  await settled(page);
  assert.match(await page.locator("#qxAnswer .qx-headline").textContent(), /1 Oct 2025 – 30 Sep 2026/);
  await page.evaluate(() => {
    document.getElementById("licFrom").value = "2024-01-01";
    document.getElementById("licTo").value = "2024-12-31";
    document.getElementById("licTo").dispatchEvent(new Event("change", { bubbles: true }));
  });
  // The inputs' own handler is bound to `change`; fall back to it explicitly if the page uses `onchange`.
  await page.waitForFunction(() => /2024/.test(document.querySelector("#qxAnswer .qx-headline")?.textContent || ""));
  await settled(page);
  assert.match(await page.locator("#qxAnswer .qx-headline").textContent(), /1 Jan 2024 – 31 Dec 2024/);
});

test("rapid question switching leaves exactly one pressed question and the answer for the LAST one", async (t) => {
  const { page, context, errors } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  const order = ["LICENCES_IN_LENS", "AMBITO_PHASES", "AMBITOS_IN_LENS", "AMBITO_EDITION_DIFF", "AMBITO_AT_POINT", "SOURCE_PROVENANCE", "AMBITO_PHASES", "LICENCES_IN_LENS", "AMBITO_AT_POINT"];
  await page.evaluate((ids) => { for (const id of ids) document.querySelector(`.qx-q[data-question="${id}"]`).click(); }, order);
  await page.waitForFunction(() => { const s = window.__QUESTION_EXPLORER_TEST__.snapshot(); return s && s.kind && s.kind !== "loading" && s.questionId === "AMBITO_AT_POINT"; });
  await settled(page);
  assert.equal(await page.locator(".qx-q[aria-pressed='true']").count(), 1);
  assert.equal(await page.locator('.qx-q[aria-pressed="true"]').getAttribute("data-question"), "AMBITO_AT_POINT");
  assert.equal((await answerState(page)).question, "AMBITO_AT_POINT");
  assert.equal(await page.locator("#qxAnswer").count(), 1);
  assert.deepEqual(errors, []);
});

test("repeating one question builds one answer and one registry", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  const registryBefore = await page.evaluate(() => { window.__qxRegistry = window.__QUESTION_EXPLORER_TEST__.registry(); return true; });
  assert.ok(registryBefore);
  for (let i = 0; i < 6; i += 1) await askQuestion(page, "AMBITOS_IN_LENS");
  assert.equal(await page.locator("#qxAnswer .qx-answer-title").count(), 1);
  assert.equal(await page.evaluate(() => window.__qxRegistry === window.__QUESTION_EXPLORER_TEST__.registry()), true, "the registry is not rebuilt by repeated asking");
});

test("changing the analytical mode, or opening and closing the finder, does not stale or lose an answer that is still current", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  await askQuestion(page, "AMBITO_AT_POINT");
  await settled(page);
  const key = (await snap(page)).contextKey;
  await page.locator("#modeCityButton").click();
  await page.locator("#modePlaceButton").click();
  assert.equal((await answerState(page)).stale, "false");
  await page.keyboard.press("Escape");
  await page.locator("#geoSearchToggle").click();
  assert.equal((await snap(page)).contextKey, key);
  assert.equal((await answerState(page)).kind, "answer");
});

test("a change made while the finder is closed is noticed on reopening, and the answer is never shown as current", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  await askQuestion(page, "AMBITOS_IN_LENS");
  await settled(page);
  await page.locator("#geoSearchClose").click();
  await setRadius(page, 1200);
  await page.locator("#geoSearchToggle").click();
  await settled(page);
  assert.match(await page.locator("#qxAnswer .qx-scope-instance").textContent(), /1\.2 km/);
});

// ============================================================= language and reading

test("switching language mid-answer re-words the SAME facts without re-asking the registry", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  await askQuestion(page, "AMBITO_PHASES");
  await settled(page);
  const verbatim = () => page.locator("#qxAnswer [data-verbatim]").allTextContents();
  const enValues = await verbatim();
  const key = (await snap(page)).contextKey;
  await page.evaluate(() => { window.__qxRegistry = window.__QUESTION_EXPLORER_TEST__.registry(); });
  await page.selectOption("#languageSelect", "es");
  await page.waitForFunction(() => /Respuesta/.test(document.querySelector("#qxAnswer .qx-badge")?.textContent || ""));
  assert.deepEqual(await verbatim(), enValues, "official values are not translated");
  assert.equal((await snap(page)).contextKey, key);
  assert.match(await page.locator("#qxAnswer .qx-answer-title").textContent(), /desarrollo de este ámbito/);
  assert.match(await page.locator("#qxAnswer .qx-section-title").first().textContent(), /Resultado/);
  assert.equal(await page.locator(".qx-title").textContent(), "Explorar preguntas");
  assert.equal(await page.evaluate(() => window.__qxRegistry === window.__QUESTION_EXPLORER_TEST__.registry()), true);
  await page.selectOption("#languageSelect", "en");
  await page.waitForFunction(() => /Answer/.test(document.querySelector("#qxAnswer .qx-badge")?.textContent || ""));
});

test("the reading preference is the drawer's own: it survives both ways and never changes the facts", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  await askQuestion(page, "AMBITO_PHASES");
  await settled(page);
  const facts = () => page.locator("#qxAnswer .qx-facts dd").first().textContent();
  const citizenCount = await page.locator("#qxAnswer .qx-section-result .qx-facts dt").count();
  await page.locator('#qxAnswer .qx-reading-btn[data-reading="analyst"]').click();
  assert.equal(await page.locator('#qxAnswer .qx-reading-btn[data-reading="analyst"]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#qxAnswer .qx-section-result .qx-facts dt").count(), citizenCount, "analyst adds no fact, only detail");
  assert.ok((await page.locator("#qxAnswer .qx-trace").count()) === 1, "the analyst reading adds the trace");
  assert.ok(await facts());
  await page.locator("#qxAnswer .qx-action-drawer").click();
  await page.waitForFunction(() => document.querySelector("#evidenceDrawer").open);
  assert.equal(await page.locator('#evidenceDrawer .reading-btn[data-reading="analyst"]').getAttribute("aria-pressed"), "true");
  await page.locator('#evidenceDrawer .reading-btn[data-reading="citizen"]').click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector('#qxAnswer .qx-reading-btn[data-reading="citizen"]')?.getAttribute("aria-pressed") === "true");
  assert.equal(await page.locator("#qxAnswer .qx-trace").count(), 0);
});

// ====================================================== refused asks and abstentions

test("an unsupported ask is refused by the registry and shows its clause, its reason code and no figure", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  await page.locator("#qxRefused summary").click();
  const expected = { dwellings: "DWELLING_COUNT", completion: "COMPLETION_OR_PROJECTION", ranking: "RANKING_OR_RECOMMENDATION", cause: "CAUSAL_CLAIM", legal: "LEGAL_INTERPRETATION", share: "WHOLE_TO_PART_APPORTIONMENT" };
  for (const [id, clause] of Object.entries(expected)) {
    await page.locator(`.qx-q[data-refused="${id}"]`).click();
    const s = await snap(page);
    assert.equal(s.reason, "CEILING_PROHIBITS", id);
    assert.equal(s.prohibition, clause, id);
    assert.equal(await page.locator("#qxAnswer .qx-facts").count(), 0, `${id}: an abstention carries no figure`);
    assert.match(await page.locator("#qxAnswer .qx-abstention-codes").textContent(), new RegExp(`CEILING_PROHIBITS.*${clause}`));
  }
  await page.locator('.qx-q[data-refused="pressure"]').click();
  assert.equal((await snap(page)).reason, "UNREGISTERED_SHAPE");
});

// ===================================================================== failures

test("a failed licence artifact is a stated abstention, not a blank and not a zero", async (t) => {
  const { page, context, errors } = await pageFor({ block: ["madrid_urban_licences.json"] });
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  await askQuestion(page, "LICENCES_IN_LENS");
  await settled(page);
  const s = await snap(page);
  assert.equal(s.kind, "abstained");
  assert.equal(s.reason, "NO_EVIDENCE_FOR_SCOPE");
  assert.equal(await page.locator("#qxAnswer .qx-facts").count(), 0);
  assert.doesNotMatch(await page.locator("#qxAnswer").textContent(), /\b0\b/);
  assert.deepEqual(errors, []);
});

test("a licence register that arrives late is shown as loading, then answered, and never as out of date", async (t) => {
  const { page, context } = await pageFor({ delay: { name: "madrid_urban_licences.json", ms: 1500 } });
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  await page.evaluate(() => {
    window.__qxSeen = new Set();
    const answer = document.querySelector("#qxAnswer");
    new MutationObserver(() => window.__qxSeen.add(`${answer.dataset.kind}/${answer.dataset.stale}`)).observe(answer, { attributes: true, attributeFilter: ["data-kind", "data-stale"] });
  });
  await page.locator('.qx-q[data-question="LICENCES_IN_LENS"]').click();
  assert.equal((await answerState(page)).kind, "loading");
  assert.match(await page.locator("#qxAnswer .qx-loading").textContent(), /granted-licence register/);
  assert.equal(await page.locator("#qxAnswer .qx-facts").count(), 0, "a loading card shows no figure");
  await page.waitForFunction(() => document.querySelector("#qxAnswer").dataset.kind === "answer", null, { timeout: 30000 });
  const seen = await page.evaluate(() => [...window.__qxSeen]);
  assert.ok(!seen.some((entry) => entry.endsWith("/true")), `a loading card must never be marked out of date: ${seen}`);
});

test("a failed source registry is stated as a loading failure, and no question is answered", async (t) => {
  const { page, context } = await pageFor({ block: ["source_registry.json"] });
  t.after(() => context.close());
  await openExplorer(page);
  await page.locator('.qx-q[data-question="AMBITO_AT_POINT"]').click();
  await page.waitForFunction(() => document.querySelector("#qxAnswer").dataset.kind === "unavailable");
  assert.match(await page.locator("#qxAnswer").textContent(), /source registry could not be loaded/);
  assert.equal(await page.locator("#qxAnswer .qx-headline").count(), 0);
});

test("failed planning artifacts leave the Lens questions abstaining and the licence question intact", async (t) => {
  const { page, context } = await pageFor({ block: ["madrid_ambitos.geojson", "madrid_ambito_state.json"] });
  t.after(() => context.close());
  await openExplorer(page);
  await askQuestion(page, "AMBITO_AT_POINT");
  assert.equal((await snap(page)).reason, "NO_EVIDENCE_FOR_SCOPE");
  await askQuestion(page, "AMBITOS_IN_LENS");
  assert.equal((await snap(page)).reason, "NO_EVIDENCE_FOR_SCOPE");
  await askQuestion(page, "LICENCES_IN_LENS");
  assert.equal((await snap(page)).kind, "answered", "an unrelated source is unaffected");
});

// ====================================================================== sharing

test("reloading a shared link restores the Lens and starts with NO answer, never a stale one", async (t) => {
  const first = await pageFor();
  const url = await (async () => {
    await openExplorer(first.page);
    await selectAndAnalyze(first.page, "APR.02.09");
    await askQuestion(first.page, "AMBITOS_IN_LENS");
    await first.page.waitForFunction(() => /[?&]v=/.test(location.search) || location.search.length > 3);
    return first.page.url();
  })();
  await first.context.close();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.route("**/*", (route) => (new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort()));
  await page.goto(`${url}&haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__GEO_SEARCH_TEST__?.snapshot().universeStatus.ambito === "ready");
  await openExplorer(page);
  assert.equal(await page.locator("#qxAnswer").isHidden(), true, "the question is not part of the shared state, so no answer is carried over");
  await askQuestion(page, "AMBITOS_IN_LENS");
  const direct = await page.evaluate(() => {
    const api = window.__QUESTION_EXPLORER_TEST__;
    const c = api.context().lens;
    return api.registry().query("AMBITOS_IN_LENS", { lon: c.lon, lat: c.lat, radiusM: c.radiusM }).value.count;
  });
  assert.match(await page.locator("#qxAnswer .qx-headline").textContent(), new RegExp(`touches ${direct === 1 ? "1 official planning ámbito" : direct + " official planning ámbitos"}|touches no official`));
});

// ============================================================ accessibility and layout

test("keyboard alone operates the explorer; focus stays on the control and the result is announced", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  // The M1 finder keeps its field disabled (so it cannot take focus) until its
  // universes have loaded; on a slower engine a key press can precede that. This
  // test is about the explorer, so it opens the finder once it is ready, exactly as
  // the M1 suite's own openSearch does.
  await page.waitForFunction(() => document.querySelector("#geoSearchPanel").dataset.state === "ready");
  await page.locator("#geoSearchToggle").focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement.id === "geoSearchQuery");
  await page.keyboard.type("APR.02.09");
  await page.waitForFunction(() => document.querySelectorAll("#geoSearchResults button").length > 0);
  await page.locator("#geoSearchResults button").first().focus();
  await page.keyboard.press("Enter");
  await page.locator("#geoSearchAnalyze").focus();
  await page.keyboard.press("Enter");
  // Tab from the Analyze action reaches the explorer's own controls in DOM order.
  const reached = [];
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    reached.push(await page.evaluate(() => document.activeElement.className));
    if (/qx-q\b/.test(reached[reached.length - 1])) break;
  }
  assert.ok(reached.some((name) => /qx-collapse/.test(name)) && reached.some((name) => /qx-q\b/.test(name)), `reached ${reached.join(" > ")}`);
  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.__QUESTION_EXPLORER_TEST__.snapshot()?.kind);
  assert.match(await page.evaluate(() => document.activeElement.className), /qx-q\b/, "activating a question does not steal focus");
  const live = await page.locator("#qxLive").textContent();
  assert.match(live, /^(Answer|No answer)/, "the result is announced through the status region");
  assert.equal(await page.locator("#qxLive").getAttribute("role"), "status");
  assert.equal(await page.locator("#qxAnswer").getAttribute("aria-labelledby"), "qxAnswerHeading");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#geoSearchPanel").isHidden(), true);
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
  test(`layout ${viewport.width}x${viewport.height}: nothing clips, overflows or hides a control, and targets stay touch-sized`, async (t) => {
    const { page, context } = await pageFor({ viewport });
    t.after(() => context.close());
    await openExplorer(page);
    await selectAndAnalyze(page, "APR.02.09");
    await askQuestion(page, "AMBITO_PHASES");
    await page.locator("#qxAnswer .qx-source-record summary").click();
    const g = await page.evaluate(() => {
      const panel = document.querySelector("#geoSearchPanel");
      const rect = panel.getBoundingClientRect();
      const targets = [...document.querySelectorAll(".qx-q, .qx-collapse, .qx-action, .qx-reading-btn, .qx summary")].map((n) => Math.round(n.getBoundingClientRect().height));
      const wide = [...document.querySelectorAll("#questionExplorer *")].filter((n) => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX === "visible" && n.getBoundingClientRect().right > panel.getBoundingClientRect().right + 1).length;
      return {
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        panelClipped: panel.scrollWidth - panel.clientWidth,
        within: rect.left >= -0.5 && rect.right <= window.innerWidth + 0.5 && rect.bottom <= window.innerHeight + 0.5 && rect.top >= -0.5,
        minTarget: Math.min(...targets),
        spill: wide,
        headerOverflow: document.querySelector("header").scrollWidth - document.querySelector("header").clientWidth,
      };
    });
    assert.ok(g.pageOverflow <= 0, `page overflowed by ${g.pageOverflow}px`);
    assert.ok(g.panelClipped <= 0, `the finder clipped ${g.panelClipped}px horizontally`);
    assert.ok(g.within, "the finder stays inside the viewport");
    assert.ok(g.minTarget >= 44, `smallest target ${g.minTarget}px`);
    assert.equal(g.spill, 0, "no text spills out of the panel");
    assert.ok(g.headerOverflow <= 0);
  });
}

test("on a wide screen the finder stays in the map corridor and covers neither the zoom control nor the attribution", async (t) => {
  const { page, context } = await pageFor({ viewport: { width: 1440, height: 900 } });
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  await askQuestion(page, "LICENCES_IN_LENS");
  const overlap = await page.evaluate(() => {
    const panel = document.querySelector("#geoSearchPanel").getBoundingClientRect();
    const hit = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return false;
      const r = node.getBoundingClientRect();
      return !(r.right <= panel.left || r.left >= panel.right || r.bottom <= panel.top || r.top >= panel.bottom);
    };
    return {
      placement: document.querySelector("#geoSearchPanel").dataset.placement,
      zoom: hit(".leaflet-control-zoom"), attribution: hit(".leaflet-control-attribution"),
      rail: hit("#layerRail"), analysis: hit("#analysisPanel"), modeNav: hit("#modeNav"),
    };
  });
  assert.equal(overlap.placement, "corridor");
  assert.deepEqual([overlap.zoom, overlap.attribution, overlap.rail, overlap.analysis, overlap.modeNav], [false, false, false, false, false]);
});

function luminance([r, g, b]) {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
for (const scheme of ["light", "dark"]) {
  test(`${scheme}: question, answer and abstention text meet 4.5:1 against their own surface`, async (t) => {
    const { page, context } = await pageFor({ colorScheme: scheme });
    t.after(() => context.close());
    await page.selectOption("#appearanceSelect", scheme);
    await openExplorer(page);
    await selectAndAnalyze(page, "APR.02.09");
    const measure = (selectors) => page.evaluate((list) => {
      const parse = (c) => c.match(/[\d.]+/g).slice(0, 4).map(Number);
      const opaqueBackground = (node) => {
        let current = node;
        while (current) {
          const [r, g, b, a = 1] = parse(getComputedStyle(current).backgroundColor);
          if (a > 0.9) return [r, g, b];
          current = current.parentElement;
        }
        return [255, 255, 255];
      };
      return list.map((selector) => {
        const node = document.querySelector(selector);
        if (!node) return { selector, missing: true };
        return { selector, fg: parse(getComputedStyle(node).color).slice(0, 3), bg: opaqueBackground(node) };
      });
    }, selectors);
    const check = (rows) => {
      for (const row of rows) {
        assert.ok(!row.missing, `${row.selector} must exist in this state`);
        const [a, b] = [luminance(row.fg), luminance(row.bg)];
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        assert.ok(ratio >= 4.5, `${scheme} ${row.selector}: ${ratio.toFixed(2)}:1`);
      }
    };
    await askQuestion(page, "AMBITO_PHASES");
    check(await measure([".qx-title", ".qx-q-text", ".qx-q-subject", ".qx-answer-title", ".qx-headline", ".qx-section-title", ".qx-scope-instance", ".qx-context-line", ".qx-reading-btn", ".qx-action", ".qx-badge", ".qx-limits li"]));
    await page.locator("#qxRefused summary").click();
    await page.locator('.qx-q[data-refused="dwellings"]').click();
    check(await measure([".qx-abstention-name", ".qx-abstention-text", ".qx-abstention-clause", ".qx-abstention-codes", ".qx-refused-summary", ".qx-q-refused .qx-q-text"]));
  });
}

test("Spanish copy covers the whole surface", async (t) => {
  const { page, context } = await pageFor();
  t.after(() => context.close());
  await page.selectOption("#languageSelect", "es");
  await openExplorer(page);
  await selectAndAnalyze(page, "APR.02.09");
  await askQuestion(page, "AMBITO_EDITION_DIFF");
  await settled(page);
  const text = await page.locator("#questionExplorer").textContent();
  for (const english of ["Explore questions", "What this cannot show", "Verification", "Citizen", "Analyst", "Question"]) assert.ok(!text.includes(english), `"${english}" left untranslated`);
  for (const spanish of ["Explorar preguntas", "Lo que no permite concluir", "Verificación", "Ciudadana", "Analista"]) assert.ok(text.includes(spanish), spanish);
});

// ================================================================ dossier V1

test("dossier export preserves one frozen answer in matching offline HTML and JSON without changing K11", async (t) => {
  const { page, context, errors } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APE.02.20");
  await askQuestion(page, "AMBITO_EDITION_DIFF");
  await settled(page);
  assert.equal(await page.locator("#qxAnswer .qx-action-dossier").count(), 1);
  assert.equal(await page.evaluate(() => performance.getEntriesByType("resource").filter((entry) => entry.name.includes("evidence-dossier.js")).length), 0, "dossier code is absent before the action");
  const dossierStarted = Date.now();
  const files = await createDossier(page, { keyboard: true });
  t.diagnostic(`dossier action (deferred module + HTML/JSON + Blob links): ${Date.now() - dossierStarted} ms`);
  assert.equal(await page.evaluate(() => performance.getEntriesByType("resource").filter((entry) => entry.name.includes("evidence-dossier.js")).length), 1, "one deferred dossier module request");
  assert.deepEqual(files.map((file) => file.label), ["HTML", "JSON"]);
  const html = files.find((file) => file.label === "HTML").text;
  const machine = JSON.parse(files.find((file) => file.label === "JSON").text);
  assert.equal(machine.dossier_schema_version, 1);
  assert.equal(machine.question.id, "AMBITO_EDITION_DIFF");
  assert.equal(machine.question.registered_shape, "AMBITO_EDITION_DIFF");
  assert.equal(machine.question.parameters.code, "APE.02.20");
  assert.equal(machine.outcome.status, "ANSWERED");
  assert.equal(machine.outcome.evidence.derivation, "EDITION_DIFF");
  assert.equal(machine.context.planning_ambito.code, "APE.02.20");
  assert.match(machine.reproducibility.does_not_restore, /does not restore the selected M2 question/);
  assert.match(machine.identification.deployment_build.characterization, /not a cryptographic data fingerprint/);
  assert.match(html, /APE\.02\.20/);
  assert.match(html, /EDITION_DIFF/);
  assert.match(html, /@page\{size:A4/);
  assert.doesNotMatch(html, /<script|<link|src=/i);
  assert.equal((html.match(/2026-01-01/g) || []).length > 0, true);

  const k11 = await page.evaluate(() => window.__HALO_REGRESSION__.k11Bundle().files.map((file) => file.name.replace(/-\d{8}-\d{4}/, "")));
  assert.deepEqual(k11, ["reading.json", "sources.json", "geometry.geojson", "README.txt", "state.url"]);

  const offline = await context.newPage();
  const requests = [];
  offline.on("request", (request) => requests.push(request.url()));
  await offline.setContent(html, { waitUntil: "load" });
  await offline.emulateMedia({ media: "print" });
  assert.equal(await offline.locator("h1").textContent(), "Urban Evidence Dossier");
  assert.equal(requests.length, 0, "opening the generated document makes no runtime request");
  if (ENGINE_NAME === "chromium") {
    const pdf = await offline.pdf({ format: "A4", printBackground: true });
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    assert.ok(pdf.length > 20_000, "print output contains the evidence brief");
  }
  await offline.close();
  assert.deepEqual(errors, []);
});

test("dossier export preserves usable fallback links until replacement or page close", async (t) => {
  const { page, context, errors } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APE.02.20");
  await askQuestion(page, "AMBITO_EDITION_DIFF");
  await settled(page);
  await page.evaluate(() => {
    const lifecycle = { revoked: [], scheduledExpiry: 0 };
    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    window.__DOSSIER_URL_LIFECYCLE__ = lifecycle;
    window.setTimeout = (callback, delay, ...args) => {
      if (delay === 120000) {
        lifecycle.scheduledExpiry += 1;
        callback(...args);
        return 0;
      }
      return nativeSetTimeout(callback, delay, ...args);
    };
    URL.revokeObjectURL = (url) => {
      lifecycle.revoked.push(url);
      nativeRevokeObjectURL(url);
    };
  });

  await createDossier(page);
  const firstUrls = await page.locator("#qxDossierStatus a").evaluateAll((links) => links.map((link) => link.href));
  const initial = await page.evaluate(() => ({ ...window.__DOSSIER_URL_LIFECYCLE__ }));
  assert.equal(initial.scheduledExpiry, 0, "no fixed expiry is scheduled while fallback links remain visible");
  assert.deepEqual(initial.revoked, []);
  const downloaded = [];
  for (const link of await page.locator("#qxDossierStatus a").all()) {
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    downloaded.push({ name: download.suggestedFilename(), failure: await download.failure() });
  }
  assert.deepEqual(downloaded.map(({ name }) => path.extname(name)), [".html", ".json"]);
  assert.ok(downloaded.every(({ failure }) => failure === null), "both visible Blob links remain downloadable");

  await page.locator("#qxAnswer .qx-action-dossier").click();
  await page.waitForFunction((previous) => {
    const current = [...document.querySelectorAll("#qxDossierStatus a")].map((link) => link.href);
    return current.length === 2 && current.every((url) => !previous.includes(url));
  }, firstUrls);
  const replacement = await page.evaluate(() => ({
    current: [...document.querySelectorAll("#qxDossierStatus a")].map((link) => link.href),
    revoked: [...window.__DOSSIER_URL_LIFECYCLE__.revoked],
  }));
  assert.deepEqual(replacement.revoked, firstUrls, "replacing the links revokes the previous pair");
  assert.ok(replacement.current.every((url) => !replacement.revoked.includes(url)), "the replacement pair remains usable");

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  assert.deepEqual(await page.evaluate(() => [...window.__DOSSIER_URL_LIFECYCLE__.revoked]), firstUrls, "a bfcache page keeps its visible pair usable");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
  const finalRevoked = await page.evaluate(() => [...window.__DOSSIER_URL_LIFECYCLE__.revoked]);
  assert.deepEqual(finalRevoked, [...firstUrls, ...replacement.current], "closing the page revokes the visible pair");
  assert.deepEqual(errors, []);
});

test("dossier export records an abstention without inventing a value", async (t) => {
  const { page, context, errors } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await askQuestion(page, "SOURCE_PROVENANCE");
  const state = await answerState(page);
  assert.equal(state.kind, "abstention");
  const files = await createDossier(page);
  const machine = JSON.parse(files.find((file) => file.label === "JSON").text);
  assert.equal(machine.outcome.status, "ABSTAINED");
  assert.equal(machine.outcome.evidence, null);
  assert.equal(machine.outcome.abstention.reason, "AMBIGUOUS_SCOPE");
  assert.equal(machine.sources.length, 0);
  assert.match(files.find((file) => file.label === "HTML").text, /No factual value is asserted/);
  assert.deepEqual(errors, []);
});

test("dossier action disables on stale context, re-enables after recompute, and coalesces rapid activation", async (t) => {
  const { page, context, errors } = await pageFor();
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APE.02.20");
  await askQuestion(page, "AMBITO_AT_POINT");
  await page.evaluate(() => {
    const slider = document.querySelector("#radiusSlider");
    slider.value = String(Number(slider.value) + 50);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector("#qxAnswer")?.dataset.stale === "true");
  assert.equal(await page.locator("#qxAnswer .qx-action-dossier").isDisabled(), true);
  await settled(page);
  assert.equal(await page.locator("#qxAnswer .qx-action-dossier").isEnabled(), true);
  await page.locator("#qxAnswer .qx-action-dossier").dblclick({ delay: 5 });
  await page.waitForFunction(() => document.querySelector("#qxDossierStatus")?.dataset.tone === "ok");
  assert.equal(await page.locator("#qxDossierStatus a").count(), 2, "rapid activation still yields one HTML/JSON pair");
  assert.deepEqual(errors, []);
});

test("dossier action remains contained at all required viewports in Light/Dark and ES/EN", async (t) => {
  const { page, context, errors } = await pageFor({ viewport: { width: 1440, height: 900 } });
  t.after(() => context.close());
  await openExplorer(page);
  await selectAndAnalyze(page, "APE.02.20");
  await askQuestion(page, "AMBITO_AT_POINT");
  const viewports = [[320,568],[390,844],[430,932],[768,1024],[834,1112],[1024,768],[1366,768],[1440,900]];
  for (let index = 0; index < viewports.length; index += 1) {
    const [width, height] = viewports[index];
    await page.setViewportSize({ width, height });
    await page.selectOption("#appearanceSelect", index % 2 ? "dark" : "light");
    await page.selectOption("#languageSelect", index % 2 ? "es" : "en");
    const button = page.locator("#qxAnswer .qx-action-dossier");
    await button.scrollIntoViewIfNeeded();
    const geometry = await button.evaluate((node) => {
      const b = node.getBoundingClientRect();
      const answer = node.closest("#qxAnswer").getBoundingClientRect();
      const panel = node.closest("#geoSearchPanel").getBoundingClientRect();
      return { b: { left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height }, answer: { left:answer.left,right:answer.right }, panel: { left:panel.left,right:panel.right } };
    });
    assert.ok(geometry.b.height >= 44, `${width}×${height}: touch target`);
    assert.ok(geometry.b.left >= geometry.answer.left && geometry.b.right <= geometry.answer.right + 1, `${width}×${height}: action inside answer`);
    assert.ok(geometry.b.left >= geometry.panel.left && geometry.b.right <= geometry.panel.right + 1, `${width}×${height}: action inside finder`);
    assert.ok(geometry.b.left >= 0 && geometry.b.right <= width + 1, `${width}×${height}: no viewport clipping`);
  }
  assert.deepEqual(errors, []);
});

// ===================================================================== capture

test("capture the explorer's real states for the visual audit", async (t) => {
  if (!CAPTURE_DIR) return t.skip("QX_CAPTURE_DIR not set");
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  for (const [name, viewport, scheme] of [["desktop-light", { width: 1440, height: 900 }, "light"], ["desktop-dark", { width: 1440, height: 900 }, "dark"], ["tablet", { width: 820, height: 1180 }, "light"], ["mobile", { width: 390, height: 844 }, "light"], ["mobile-narrow", { width: 320, height: 640 }, "light"]]) {
    const { page, context } = await pageFor({ viewport, colorScheme: scheme });
    await openExplorer(page);
    await selectAndAnalyze(page, "APR.02.09");
    await page.screenshot({ path: path.join(CAPTURE_DIR, `${name}-1-list.png`) });
    for (const id of ["AMBITO_AT_POINT", "AMBITO_PHASES", "AMBITO_EDITION_DIFF", "AMBITOS_IN_LENS", "LICENCES_IN_LENS"]) {
      await askQuestion(page, id);
      await settled(page);
      await page.locator("#qxAnswer").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(CAPTURE_DIR, `${name}-2-${id}.png`) });
      if (name === "desktop-light" && id === "AMBITO_EDITION_DIFF" && await page.locator("#qxAnswer .qx-action-dossier").count()) {
        const files = await createDossier(page);
        await page.screenshot({ path: path.join(CAPTURE_DIR, `${name}-4-dossier-ready.png`) });
        const documentPage = await context.newPage();
        await documentPage.setContent(files.find((file) => file.label === "HTML").text, { waitUntil: "load" });
        await documentPage.screenshot({ path: path.join(CAPTURE_DIR, `${name}-5-dossier-document.png`), fullPage: true });
        await documentPage.close();
      }
    }
    await page.locator("#qxRefused summary").click();
    await page.locator('.qx-q[data-refused="dwellings"]').click();
    await page.locator("#qxAnswer").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(CAPTURE_DIR, `${name}-3-refused.png`) });
    await context.close();
  }
});
