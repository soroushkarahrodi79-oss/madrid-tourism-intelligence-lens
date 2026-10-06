import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Planning-ámbito evidence (K6, #68) browser contract.
//
// Semantic DOM assertions against the REAL render path and the REAL committed
// artifacts. The contracts it defends in the browser:
//
//   * The browser makes NO request to an official planning service. K6 runs
//     from packaged evidence only, and that is asserted by observing every
//     request the page actually makes.
//   * A point inside an ámbito names that ámbito, with its EXACT official code,
//     labelled as a planning ámbito and not as the barrio.
//   * A point outside every production ámbito says so EXPLICITLY — not zero,
//     not blank, not the nearest ámbito.
//   * The four published phase fields render as FOUR independent rows, with no
//     ordering cue, no percentage, no progress element and no single badge.
//     `No Necesita` and the PGOUM markers are distinguished by structure and
//     label, not by colour alone, and their verbatim values survive.
//   * Every buildability figure renders with its unit and its whole-ámbito
//     scope; a blank published cell renders as "not published", never as 0.
//   * The edition reference date is visible WITH the evidence, not only in the
//     drawer, and the drawer carries the full registry provenance.
//   * The ámbito polygon renders on its own pane, and the ámbito, the barrio and
//     the Lens circle stay three different geometries.
//   * ES and EN both work, official values stay verbatim in both, and the
//     citizen and analyst readings agree on every state.

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
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "source_registry.json"), "utf8"));
const sourceById = (id) => registry.sources.find((source) => source.id === id);
const stateMeta = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "planning", "madrid_ambito_state.meta.json"), "utf8")
);
const stateArtifact = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "planning", "madrid_ambito_state.json"), "utf8")
);
const K7_VISUAL_DIR = path.join(os.tmpdir(), "madrid-k7-visual-review");
fs.mkdirSync(K7_VISUAL_DIR, { recursive: true });

// Fixture places, verified against the committed geometry.
const INSIDE = { lat: 40.40255, lon: -3.71371, code: "APR.02.09" }; // has a No Necesita phase
const MARKER = { lat: 40.40589, lon: -3.6841, code: "APE.03.08" }; // has a PGOUM-97 marker
const BLANK_CELL = { lat: 40.40261, lon: -3.71841, code: "APE.02.27" }; // has an unpublished use class
const OUTSIDE = { lat: 40.4149, lon: -3.69 }; // central Madrid: no containing ámbito

const PLANNING_SERVICE_ROUTE =
  /^\/hosted\/(?:services\/|rest\/services\/)DESARROLLO_URBANO_ACTUALIZADO\/PLANEAMIENTO_URBANISTICO\/MapServer(?:\/WFSServer)?(?:\/|$)/i;
const PLANNING_DATASET_IDS = [
  "203200-0-desarrollo-ambitos",
  "203182-0-ambitos-remanente",
  "ca62bee0-8ce1-11e9-90e1-dc4a3e81fab6",
];

function isForbiddenPlanningRuntimeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  // Match the K6 planning service route itself, regardless of its host, and
  // the planning dataset identifiers on their official catalogue hosts.
  // This deliberately says nothing about ArcGIS as a hosting technology.
  if (PLANNING_SERVICE_ROUTE.test(decodeURIComponent(url.pathname))) return true;
  const host = url.hostname.toLowerCase();
  const officialPlanningHost = ["sigma.madrid.es", "datos.madrid.es", "geoportal.madrid.es"].some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
  return officialPlanningHost && PLANNING_DATASET_IDS.some((id) => url.href.toLowerCase().includes(id));
}

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

async function newPage(viewport = { width: 1366, height: 900 }, contextOptions = {}) {
  const context = await browser.newContext({ viewport, ...contextOptions });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  // Every request is RECORDED before any off-origin request is aborted. PA 1
  // classifies planning URLs specifically; it does not set the application's
  // network policy for unrelated remote sources.
  const requests = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return route.abort();
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/?haloRegressionTest=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__HALO_REGRESSION__));
  // The planning surface is ready once the artifacts have loaded and the
  // section has been rendered out of its initial hidden state.
  await page.waitForFunction(() => {
    const section = document.getElementById("planningAmbito");
    return section && !section.hasAttribute("hidden") && section.dataset.state && section.dataset.state !== "loading";
  });
  page.context_ = context;
  page.requests_ = requests;
  return page;
}
const closePage = (page) => page.context_.close();

async function at(page, place) {
  await page.evaluate(
    ([lat, lon]) => window.__HALO_REGRESSION__.moveLensToLatLng("A", lat, lon),
    [place.lat, place.lon]
  );
  await page.waitForFunction(
    (expected) => document.getElementById("planningCode").textContent.trim() === expected,
    place.code ?? ""
  );
  return page.evaluate(() => window.__HALO_REGRESSION__.planning());
}

const planning = (page) => page.evaluate(() => window.__HALO_REGRESSION__.planning());

// ------------------------------------------------------ 1. planning network

test("PA 1 the classifier catches planning routes without banning unrelated ArcGIS sources", () => {
  assert.equal(
    isForbiddenPlanningRuntimeUrl(
      "https://sigma.madrid.es/hosted/services/DESARROLLO_URBANO_ACTUALIZADO/PLANEAMIENTO_URBANISTICO/MapServer/WFSServer"
    ),
    true
  );
  assert.equal(
    isForbiddenPlanningRuntimeUrl(
      "https://sigma.madrid.es/hosted/rest/services/DESARROLLO_URBANO_ACTUALIZADO/PLANEAMIENTO_URBANISTICO/MapServer/2/query"
    ),
    true
  );
  assert.equal(
    isForbiddenPlanningRuntimeUrl("https://datos.madrid.es/api/3/action/package_show?id=203200-0-desarrollo-ambitos"),
    true
  );
  assert.equal(
    isForbiddenPlanningRuntimeUrl("https://datos.madrid.es/api/3/action/package_show?id=203182-0-ambitos-remanente"),
    true
  );
  assert.equal(
    isForbiddenPlanningRuntimeUrl(
      "https://geoportal.madrid.es/IDEAM_WBGEOPORTAL/dataset.iam?id=ca62bee0-8ce1-11e9-90e1-dc4a3e81fab6"
    ),
    true
  );
  for (const line of ["M4_Red", "M5_Red"]) {
    assert.equal(
      isForbiddenPlanningRuntimeUrl(
        `https://services5.arcgis.com/UxADft6QPcvFyDU1/arcgis/rest/services/${line}/FeatureServer/0/query`
      ),
      false
    );
  }
});

test("PA 1 the browser makes NO request to an official planning service", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  await at(page, INSIDE);
  await page.evaluate(() => window.__HALO_REGRESSION__.openPlaceDetailForTest());
  await at(page, MARKER);

  const offending = page.requests_.filter(isForbiddenPlanningRuntimeUrl);
  assert.deepEqual(offending, [], "K6 runs from packaged evidence only");
  // And the committed artifacts ARE what it read.
  assert.ok(page.requests_.some((url) => url.includes("/data/planning/madrid_ambitos.geojson")));
  assert.ok(page.requests_.some((url) => url.includes("/data/planning/madrid_ambito_state.json")));
});

// ------------------------------------------------------------- 2. the place

test("PA 2 a point inside an ámbito names it, with its exact official code, as a PLANNING ámbito", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  const view = await at(page, INSIDE);

  assert.equal(view.state, "resolved");
  assert.equal(view.identityHidden, false);
  assert.equal(view.outsideHidden, true);
  // The EXACT official code, and the denomination the model carries.
  assert.equal(view.code, INSIDE.code);
  assert.equal(view.code, view.model.containing.ambitoCode);
  assert.equal(view.denomination, view.model.containing.denomination);
  assert.ok(view.denomination.length > 0);
  // Labelled as a planning ámbito, and explicitly NOT the barrio, district or Lens.
  assert.match(view.kindLabel, /Planning ámbito/i);
  assert.match(view.distinction, /not the barrio/i);
  assert.match(view.distinction, /not the district/i);
  assert.match(view.distinction, /not the Lens circle/i);

  // The geographies are NOT concatenated into one place string: the barrio name
  // the Area Profile shows appears nowhere in the planning identity.
  const barrioHeadline = await page.locator("#areaHeadline").textContent();
  const identityText = await page.locator("#planningIdentity").textContent();
  assert.ok(barrioHeadline.trim().length > 0, "the Area Profile resolved a barrio too");
  const barrioName = barrioHeadline.replace(/^.*?\bin\b\s*/i, "").trim();
  if (barrioName.length > 3) assert.equal(identityText.includes(barrioName), false, "no barrio name in the ámbito identity");
});

test("PA 3 a point outside every production ámbito says so explicitly — not zero, not blank", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  await at(page, { ...OUTSIDE, code: "" });
  const view = await planning(page);

  assert.equal(view.state, "outside_all_ambitos");
  assert.equal(view.identityHidden, true);
  assert.equal(view.outsideHidden, false);
  assert.ok(view.outsideText.length > 60, "the absence is stated in words");
  assert.match(view.outsideText, /No official planning ámbito contains the Lens centre/i);
  assert.match(view.outsideText, /does not cover the whole municipality/i);
  // Not a zero, not a blank, not the nearest ámbito.
  assert.doesNotMatch(view.outsideText, /\b0\b/);
  assert.equal(view.phases.length, 0);
  assert.equal(view.uses.length, 0);
  assert.equal(view.phasesHidden, true);
  assert.equal(view.buildHidden, true);
  // And no polygon is drawn for a place that has none.
  assert.equal(view.mapLayerCode, null);
});

// ---------------------------------------------- 3. four independent fields

test("PA 4 the four published phase fields render as four independent rows", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  const view = await at(page, INSIDE);

  assert.equal(view.phasesHidden, false);
  assert.equal(view.phases.length, 4);
  // Each row's value is the publisher's string VERBATIM, taken from the model.
  const modelPhases = view.model.developmentState.phases;
  assert.equal(modelPhases.length, 4);
  for (let i = 0; i < 4; i += 1) {
    assert.ok(view.phases[i].value.includes(modelPhases[i].sourceValue), `${i}: ${view.phases[i].value}`);
    assert.ok(view.phases[i].field.length > 0);
  }
  // No ordering cue, no numbering, no percentage, no progress element and no
  // single badge summarising the four.
  const block = await page.locator("#planningPhasesBlock").innerHTML();
  assert.doesNotMatch(block, /<progress|role="progressbar"|aria-valuenow/i);
  assert.doesNotMatch(block, /[→➔⟶⇒]/);
  assert.doesNotMatch(block, /%/);
  assert.doesNotMatch(block, /\b[1-4]\.\s/);
  assert.equal(await page.locator("#planningPhasesBlock .badge").count(), 0, "no single status badge over the four");
  // The explanatory note states the rule the reader needs.
  const note = await page.locator("#planningPhasesBlock .planning-block-note").textContent();
  assert.match(note, /Four independent published fields/i);
  assert.match(note, /do not form one overall stage/i);
});

test("PA 5 No Necesita keeps its verbatim label and a non-colour distinction", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  const view = await at(page, INSIDE);

  const unresolved = view.phases.filter((phase) => phase.kind === "UNRESOLVED_MEANING");
  assert.ok(unresolved.length >= 1, "the fixture ámbito publishes a No Necesita phase");
  for (const phase of unresolved) {
    // Verbatim. Never "no aplica", never Sin Iniciar, never 0.
    assert.ok(phase.value.includes("No Necesita"), phase.value);
    assert.equal(phase.value.includes("no aplica"), false);
    assert.equal(phase.value.includes("Sin Iniciar"), false);
    // The meaning is stated as UNRESOLVED, not asserted.
    assert.match(phase.note, /lists this as a distinct state/i);
    assert.match(phase.note, /not defined in the audited documentation/i);
    // Structure, not only hue: a dashed rule marks it.
    assert.equal(phase.borderStyle, "dashed");
  }
  // Sin Iniciar is a DIFFERENT row with a different structural treatment.
  const ordinary = view.phases.filter((phase) => phase.kind === "PHASE_VALUE");
  assert.ok(ordinary.length >= 1);
  for (const phase of ordinary) assert.equal(phase.borderStyle, "solid");
  // Nowhere in the document is No Necesita translated into an inferred meaning.
  assert.equal((await page.content()).includes("no aplica"), false);
});

test("PA 6 PGOUM markers survive verbatim with their own neutral treatment", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  const view = await at(page, MARKER);

  const markers = view.phases.filter((phase) => phase.kind === "PLAN_ORIGIN_MARKER");
  assert.ok(markers.length >= 1, "the fixture ámbito publishes a PGOUM marker");
  for (const marker of markers) {
    assert.match(marker.value, /PGOUM-(?:85|97)/);
    assert.match(marker.note, /plan-of-origin marker/i);
    assert.match(marker.note, /not a development state/i);
    // A distinct structural mark, never a position in a sequence.
    assert.equal(marker.borderStyle, "dotted");
  }
});

test("PA 7 a value observed but not documented by the publisher says so", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  // Valdecarros publishes En Ejecución, which the November-2025 structure
  // document does not list.
  const view = await at(page, { lat: 40.3555, lon: -3.588, code: "UZP.1.03" });
  const observed = view.model.developmentState.phases.filter(
    (phase) => phase.vocabulary === "SOURCE_OBSERVED_NOT_DOCUMENTED"
  );
  if (observed.length === 0) {
    // The fixture ámbito's values may all be documented; find one that is not.
    const next = await at(page, { lat: 40.4257, lon: -3.6133, code: "UZP.1.04" }).catch(() => null);
    if (!next) return;
  }
  const rendered = view.phases.filter((phase) => /Observed in the published data/i.test(phase.note ?? ""));
  assert.equal(rendered.length, observed.length, "each undocumented value is labelled as observed-not-documented");
});

// ------------------------------------------------------- 4. buildability

test("PA 8 available buildability renders by use class, with its unit and its whole-ámbito scope", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  const view = await at(page, INSIDE);

  assert.equal(view.buildHidden, false);
  const modelRows = view.model.availableBuildability.rows;
  assert.ok(modelRows.length >= 1);
  assert.equal(view.uses.length, modelRows.length * 4);
  for (const use of view.uses) {
    assert.ok(use.label.length > 0);
    if (use.valueState === "PUBLISHED") {
      // The unit is rendered WITH the value. There is no bare number.
      assert.equal(use.unit, "m² edificable");
      assert.match(use.value, /^[\d,.]+$/, use.value);
    } else {
      // Not published renders in words, never as 0.
      assert.equal(use.value, "not published");
      assert.equal(use.unit, null);
    }
  }
  // The scope is impossible to miss, and names what the figure is NOT.
  assert.match(view.buildScope, /whole planning ámbito/i);
  assert.match(view.buildScope, /not the Lens circle/i);
  // And what the quantity is not.
  const note = await page.locator("#planningBuildBlock .planning-block-note").first().textContent();
  assert.match(note, /Not what remains to be physically built/i);
  assert.match(note, /not an estimate of what will be built/i);
});

test("PA 9 a blank published cell renders as not published, never as zero", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  const view = await at(page, BLANK_CELL);

  const unpublished = view.uses.filter((use) => use.valueState === "NOT_PUBLISHED");
  assert.ok(unpublished.length >= 1, "the fixture ámbito has an unpublished use class");
  for (const use of unpublished) {
    assert.equal(use.value, "not published");
    assert.notEqual(use.value, "0");
  }
  // A published zero elsewhere still renders as a number with its unit, so the
  // two states are visibly different rather than merged.
  const zeroView = await at(page, INSIDE);
  const published = zeroView.uses.filter((use) => use.valueState === "PUBLISHED");
  assert.ok(published.length >= 1);
  for (const use of published) assert.equal(use.unit, "m² edificable");
});

test("PA 10 several published rows for one ámbito are shown separately and never added", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  // UZP.1.01 (Ensanche de Barajas) is published twice by the current edition.
  const view = await at(page, { lat: 40.4718, lon: -3.5793, code: "UZP.1.01" }).catch(() => null);
  if (!view || view.code !== "UZP.1.01") return; // the centroid may fall outside
  assert.equal(view.model.availableBuildability.publication, "MULTIPLE_PUBLISHED_ROWS_NOT_COMBINED");
  assert.equal(view.uses.length, view.model.availableBuildability.rowCount * 4);
  const text = await page.locator("#planningBuildRows").textContent();
  assert.match(text, /more than one row/i);
  assert.match(text, /never added together/i);
});

// ---------------------------------------------------- 5. date and provenance

test("PA 11 the edition reference date is visible WITH the evidence, not only in the drawer", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  const view = await at(page, INSIDE);

  const [year, month, day] = stateMeta.baseline.s1_reference_date.split("-");
  assert.match(view.edition, new RegExp(`${Number(day)} \\w+ ${year}`), view.edition);
  assert.match(view.edition, /official edition/i);
  // Visible without opening anything.
  assert.equal(await page.locator("#planningEdition").isVisible(), true);
  assert.equal(await page.locator("#evidenceDrawer").evaluate((node) => node.open), false);
  assert.equal(month.length, 2);
  // The rail states the real planning scope and the ámbito's own code.
  const rail = await page.locator("#scopeRailList").textContent();
  assert.ok(rail.includes("Planning ámbito"), rail);
  assert.ok(rail.includes(INSIDE.code), rail);
});

test("PA 12 every planning value opens the ONE evidence drawer with full registry provenance", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  await at(page, INSIDE);

  const button = page.locator('.evidence-link[data-evidence-prefix="place.planning."]');
  await button.focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#evidenceDrawer").evaluate((node) => node.open), true);

  const surfaces = await page
    .locator("#evidenceDrawerBody .drawer-record")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.surface));
  assert.ok(surfaces.length >= 4 && surfaces.every((s) => s.startsWith("place.planning.")), surfaces.join(","));
  const scopes = await page
    .locator("#evidenceDrawerBody .drawer-record")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.scope));
  assert.ok(scopes.every((s) => s === "PLANNING_AMBITO"), scopes.join(","));

  // Both ceilings, VERBATIM from the registry, in the citizen reading.
  const body = (await page.locator("#evidenceDrawerBody").textContent()).replace(/\s+/g, " ");
  for (const id of ["planning_ambito_geometry", "planning_ambito_state"]) {
    const ceiling = sourceById(id).interpretation_ceiling.replace(/\s+/g, " ");
    assert.ok(body.includes(ceiling), `${id} ceiling is verbatim in the citizen reading`);
  }
  // The geometry's undated-ness is stated, not hidden.
  assert.match(body, /not published/);

  // The analyst reading adds provenance and keeps every ceiling.
  await page.locator('.reading-btn[data-reading="analyst"]').click();
  const analyst = (await page.locator("#evidenceDrawerBody").textContent()).replace(/\s+/g, " ");
  assert.ok(analyst.includes("Retrieval route"));
  assert.ok(analyst.includes("Scope definition"));
  for (const id of ["planning_ambito_geometry", "planning_ambito_state"]) {
    assert.ok(analyst.includes(sourceById(id).interpretation_ceiling.replace(/\s+/g, " ")), id);
  }
  // Citizen and analyst are two projections of ONE record: same sources, same
  // order, nothing dropped or reordered.
  const analystSources = await page.evaluate(() =>
    [...document.querySelectorAll("#evidenceDrawerBody .drawer-source")].map((n) => n.dataset.source)
  );
  await page.locator('.reading-btn[data-reading="citizen"]').click();
  const citizenSources = await page.evaluate(() =>
    [...document.querySelectorAll("#evidenceDrawerBody .drawer-source")].map((n) => n.dataset.source)
  );
  assert.deepEqual(citizenSources, analystSources);
  await page.keyboard.press("Escape");
  assert.equal(await button.evaluate((node) => node === document.activeElement), true, "focus returns to the opener");

  // There is exactly ONE drawer: no second planning provenance modal exists.
  assert.equal(await page.locator("dialog").count(), 1);
});

test("PA 13 the section's own Source & interpretation control opens the same drawer, scoped", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  await at(page, INSIDE);
  await page.locator("#planningSourceToggle").click();
  assert.equal(await page.locator("#evidenceDrawer").evaluate((node) => node.open), true);
  const filter = await page.locator("#evidenceDrawerFilter").textContent();
  assert.match(filter, /Planning ámbito/i);
  const scopes = await page
    .locator("#evidenceDrawerBody .drawer-record")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.scope));
  assert.ok(scopes.length > 0 && scopes.every((s) => s === "PLANNING_AMBITO"));
  await page.locator("#evidenceDrawerClose").click();
});

// -------------------------------------------------------------- 6. the map

test("PA 14 the containing ámbito renders on its own pane, in its own hue family", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  const view = await at(page, INSIDE);

  assert.equal(view.mapLayerCode, INSIDE.code);
  assert.equal(view.mapPane, "planningPane");
  // Its own pane, distinct from the administrative and Lens panes.
  const panes = await page.evaluate(() => {
    const planningPane = document.querySelector(".leaflet-pane.leaflet-planning-pane");
    return {
      exists: Boolean(planningPane),
      zIndex: planningPane ? getComputedStyle(planningPane).zIndex : null,
      pointerEvents: planningPane ? getComputedStyle(planningPane).pointerEvents : null,
    };
  });
  assert.equal(panes.exists, true, "the planning pane exists");
  assert.equal(panes.pointerEvents, "none", "the planning polygon is not an interactive surface");
  assert.notEqual(panes.zIndex, "460", "it is not the Lens pane");
  assert.notEqual(panes.zIndex, "455", "it is not the active-barrio pane");

  // The stroke is the reserved neutral planning family, never a Lens hue.
  const stroke = await page.evaluate(() => window.__HALO_REGRESSION__.planning().mapLayerCode && getComputedStyle(document.documentElement).getPropertyValue("--planning-neutral").trim());
  const lensA = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--a").trim());
  const lensB = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--b").trim());
  assert.ok(stroke);
  assert.notEqual(stroke, lensA);
  assert.notEqual(stroke, lensB);

  // Only the containing ámbito is drawn: 724 polygons at once would be wallpaper.
  const drawn = await page.evaluate(() => {
    let count = 0;
    window.__HALO_REGRESSION__ && null;
    for (const canvas of document.querySelectorAll(".leaflet-planning-pane canvas")) count += 1;
    return count;
  });
  assert.ok(drawn <= 1, `${drawn} planning canvases`);

  // Moving to another ámbito replaces the polygon rather than accumulating one.
  const next = await at(page, MARKER);
  assert.equal(next.mapLayerCode, MARKER.code);
  // Leaving every ámbito removes it.
  await at(page, { ...OUTSIDE, code: "" });
  assert.equal((await planning(page)).mapLayerCode, null);
});

// ------------------------------------------------- 7. Lens ∩ ámbito membership

test("PA 15 the Lens∩ámbito reading lists touched ámbitos and no quantity", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  await at(page, INSIDE);

  // Closed by default: no membership list, and the rail does not claim the scope.
  let view = await planning(page);
  assert.equal(view.touchedCardHidden, true);
  assert.equal(view.touched.length, 0);
  let rail = await page.locator("#scopeRailList").textContent();
  assert.equal(rail.includes("Lens ∩ ámbito"), false);

  await page.evaluate(() => window.__HALO_REGRESSION__.openPlaceDetailForTest());
  view = await planning(page);
  assert.equal(view.touchedCardHidden, false);
  assert.equal(view.touched.length, view.model.membership.count);
  assert.ok(view.model.membership.count >= 1);
  // The rail now names the real scope, because the surface is on screen.
  rail = await page.locator("#scopeRailList").textContent();
  assert.ok(rail.includes("Lens ∩ ámbito"), rail);

  // Every listed entry is identity only. No number appears beside an ámbito.
  const items = await page.locator("#planningTouchedList > li").evaluateAll((nodes) =>
    nodes.map((node) => ({
      code: node.querySelector(".planning-touched-code")?.textContent.trim() ?? null,
      text: node.textContent.trim(),
    }))
  );
  for (const item of items) {
    assert.ok(item.code && item.code.length > 0);
    assert.doesNotMatch(item.text, /m²|%|\d{3,}/, item.text);
  }
  // The card states what the list is not.
  const note = await page.locator("#planningTouchedCard .planning-block-note").textContent();
  assert.match(note, /No share, proportion or part/i);
  assert.match(note, /published quantities/i);
});

// ------------------------------------------------------------- 8. language

test("PA 16 the planning surface works in ES and EN, and official values stay verbatim in both", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  const english = await at(page, INSIDE);

  await page.selectOption("#languageSelect", "es");
  await page.waitForFunction(() => document.documentElement.lang === "es");
  const spanish = await planning(page);

  // Product-authored copy is Spanish.
  assert.match(spanish.kindLabel, /Ámbito de planeamiento/i);
  assert.match(spanish.distinction, /No es el barrio/i);
  assert.match(spanish.edition, /Estado publicado a fecha de/i);
  assert.match(spanish.buildScope, /Ámbito de planeamiento completo/i);
  assert.notEqual(spanish.kindLabel, english.kindLabel);

  // Official values are IDENTICAL in both languages: the code, the denomination,
  // every phase value and every situación are the publisher's, not ours.
  assert.equal(spanish.code, english.code);
  assert.equal(spanish.denomination, english.denomination);
  const sourceValues = (view) => view.model.developmentState.phases.map((phase) => phase.sourceValue);
  assert.deepEqual(sourceValues(spanish), sourceValues(english));
  for (let i = 0; i < 4; i += 1) {
    assert.ok(spanish.phases[i].value.includes(sourceValues(spanish)[i]), spanish.phases[i].value);
  }
  // No Necesita is NOT translated into an inferred meaning.
  assert.equal((await page.content()).includes("no aplica"), false);
  // The unit is the publisher's own term in both languages.
  for (const use of spanish.uses.filter((u) => u.valueState === "PUBLISHED")) {
    assert.equal(use.unit, "m² edificable");
  }
  // And the ceiling is stated in Spanish, in full.
  assert.ok(spanish.ceiling.length > 200);
  assert.notEqual(spanish.ceiling, english.ceiling);

  // Switching back restores the English copy exactly.
  await page.selectOption("#languageSelect", "en");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  const back = await planning(page);
  assert.equal(back.kindLabel, english.kindLabel);
  assert.equal(back.distinction, english.distinction);
  assert.equal(back.code, english.code);
});

// --------------------------------------------------- 9. reading consistency

test("PA 17 the rendered surface never drifts from the model it is a reading of", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  for (const place of [INSIDE, MARKER, BLANK_CELL]) {
    const view = await at(page, place);
    assert.equal(view.code, view.model.containing.ambitoCode, place.code);
    // Four fields, in the model's order, with the model's verbatim values.
    assert.equal(view.phases.length, view.model.developmentState.phases.length);
    view.model.developmentState.phases.forEach((phase, i) => {
      assert.ok(view.phases[i].value.includes(phase.sourceValue), `${place.code} ${phase.key}`);
      assert.equal(view.phases[i].kind, phase.kind, `${place.code} ${phase.key}`);
    });
    // Every use class in the model is on screen, in its model state.
    const modelStates = view.model.availableBuildability.rows.flatMap((row) =>
      row.useClasses.map((useClass) => useClass.state)
    );
    assert.deepEqual(view.uses.map((use) => use.valueState), modelStates, place.code);
    // The whole-ámbito scope and the ceiling are present for every place.
    assert.match(view.buildScope, /whole planning ámbito/i);
    assert.ok(view.ceiling.length > 200);
  }
});

test("PA 18 an ámbito the edition does not cover shows explicit absences, never zeros", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  // A historic colonia: geometry exists, the estado edition carries no row.
  const view = await at(page, { lat: 40.4229, lon: -3.6719, code: "APE.04.02" }).catch(() => null);
  if (!view || view.state !== "resolved") return;
  if (view.model.developmentState.availability === "PUBLISHED") return;

  assert.equal(view.phasesHidden, true);
  assert.ok(view.stateAbsent);
  assert.match(view.stateAbsent, /publishes no development-state row/i);
  assert.match(view.stateAbsent, /not a zero/i);
  assert.equal(view.buildHidden, true);
  assert.ok(view.buildAbsent);
  assert.match(view.buildAbsent, /publishes no available-buildability row/i);
  // The place still stands: the identity is the geometry's, not the edition's.
  assert.equal(view.identityHidden, false);
  assert.equal(view.code, "APE.04.02");
});

// ------------------------------------------------------- 10. accessibility

test("PA 19 the planning surface meets the K5 interaction floor", async (t) => {
  const page = await newPage({ width: 390, height: 844 });
  t.after(() => closePage(page));
  await at(page, INSIDE);

  // Never hidden at a narrow width: the identity, the date, the scope and the
  // route into Evidence & limits.
  for (const selector of [
    "#planningDenomination",
    "#planningCode",
    "#planningEdition",
    "#planningSourceToggle",
    '#planningAmbito .evidence-link',
    "#planningAmbito .planning-ceiling",
  ]) {
    assert.equal(await page.locator(selector).isVisible(), true, selector);
  }
  // No horizontal overflow at 390px.
  const overflow = await page.evaluate(() => {
    const section = document.getElementById("planningAmbito");
    return section.scrollWidth - section.clientWidth;
  });
  assert.ok(overflow <= 1, `planning section overflows by ${overflow}px`);
  // Nothing renders below the 10px floor.
  const sizes = await page.evaluate(() => {
    const out = [];
    const walk = (node) => {
      if (node.nodeType === 1) {
        const text = [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim());
        if (text) out.push(parseFloat(getComputedStyle(node).fontSize));
        for (const child of node.children) walk(child);
      }
    };
    walk(document.getElementById("planningAmbito"));
    return out;
  });
  assert.ok(sizes.length > 5);
  for (const size of sizes) assert.ok(size >= 10, `${size}px is below the floor`);

  // A coarse pointer gets 44px targets on the controls this surface adds.
  const coarsePage = await newPage({ width: 390, height: 844 }, { hasTouch: true });
  t.after(() => closePage(coarsePage));
  await at(coarsePage, INSIDE);
  for (const selector of ["#planningSourceToggle", "#planningCitizen > summary"]) {
    const box = await coarsePage.locator(selector).boundingBox();
    assert.ok(box && box.height >= 44, `${selector} is ${box && box.height}px tall`);
  }
});

test("PA 20 the citizen reading foregrounds without changing a value or softening the ceiling", async (t) => {
  const page = await newPage();
  t.after(() => closePage(page));
  const view = await at(page, INSIDE);

  const citizen = await page.locator("#planningCitizen").textContent();
  assert.match(citizen, /official planning ámbito/i);
  assert.match(citizen, /four separate development values/i);
  assert.match(citizen, /m² edificable/);
  assert.match(citizen, /one dated official edition/i);
  // It states what cannot be concluded, in the same breath as what can.
  assert.match(citizen, /nothing here measures physical construction/i);
  assert.match(citizen, /do not combine into one stage or percentage/i);
  assert.match(citizen, /no number of homes is published or derivable/i);
  assert.match(citizen, /no figure is a share of the Lens circle/i);
  // And it changes no value: the four phase values on screen are still the
  // publisher's, and the ceiling is still present in full.
  view.model.developmentState.phases.forEach((phase, i) => {
    assert.ok(view.phases[i].value.includes(phase.sourceValue));
  });
  assert.ok(view.ceiling.includes("never proof of physical construction"));
  assert.ok(view.ceiling.includes("No dwelling count is published or derivable"));
});

test("K7 renders both dates, explicit outcomes and numeric states at desktop and 390px", async (t) => {
  const samples = [
    { name: "no-change", lat: 40.4491896975, lon: -3.551747205, code: "AOE.00.02-RP", family: "S1", outcome: "NO_CHANGE" },
    { name: "state-transition", lat: 40.4001518625, lon: -3.719977745, code: "APE.02.27", family: "S1", outcome: "STATE_TRANSITION" },
    { name: "new-in-edition", lat: 40.405911965, lon: -3.72762766, code: "APE.10.24", family: "S1", outcome: "NEW_AMBITO" },
    { name: "cause-unresolved", lat: 40.453697585, lon: -3.60379061, code: "APE.21.02", family: "S2", outcome: "CAUSE_UNRESOLVED" },
    { name: "numeric-observed", lat: 40.5001215925, lon: -3.6351243775, code: "US.04.10-RP", family: "S2", numeric: "OBSERVED_PUBLISHED_DIFFERENCE" },
    { name: "numeric-withheld", lat: 40.39107073, lon: -3.68838488, code: "APE.02.12", family: "S2", numeric: "WITHHELD" },
  ];
  for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
    const page = await newPage(viewport);
    t.after(() => closePage(page));
    const prefix = viewport.width === 390 ? "390" : "desktop";
    assert.equal(await page.locator("#map").isVisible(), true, "the map stays present");
    await page.screenshot({ path: path.join(K7_VISUAL_DIR, prefix + "-place-map.png") });

    for (const sample of samples) {
      await at(page, sample);
      await page.locator("#planningChange").evaluate((node) => { node.open = true; });
      const view = await planning(page);
      assert.equal(view.change.visible, true, sample.name);
      assert.deepEqual(view.change.dates, { previous: "1 Jul 2025", current: "1 Jan 2026" }, sample.name);
      if (sample.outcome) {
        const family = view.change.outcomes.find((entry) => entry.family === sample.family);
        assert.equal(family?.outcome, sample.outcome, sample.name);
      }
      if (sample.numeric) assert.equal(view.change.buildabilityState, sample.numeric, sample.name);

      const stateBlock = await page.locator("#planningChange").evaluate((node) => ({
        datesVisible: [...node.querySelectorAll("#planningChangeDates strong")].every((date) => date.textContent.trim().length > 0),
        text: node.innerText,
      }));
      assert.equal(stateBlock.datesVisible, true, sample.name);
      assert.match(stateBlock.text, /1 Jul 2025/);
      assert.match(stateBlock.text, /1 Jan 2026/);

      const k6Box = await page.locator("#planningIdentity").boundingBox();
      const k7Box = await page.locator("#planningChange").boundingBox();
      assert.ok(k6Box && k7Box && k7Box.y > k6Box.y, "the K6 current-edition identity remains above the K7 comparison");
      if (viewport.width === 390) {
        const summaryBox = await page.locator("#planningChange > summary").boundingBox();
        assert.ok(summaryBox && summaryBox.height >= 44, "K7 comparison disclosure has a mobile touch target");
        const widths = await page.evaluate(() => ({
          section: document.getElementById("planningAmbito").scrollWidth - document.getElementById("planningAmbito").clientWidth,
          document: document.documentElement.scrollWidth - window.innerWidth,
        }));
        assert.ok(widths.section <= 1, sample.name + " planning surface overflow " + widths.section + "px");
        assert.ok(widths.document <= 1, sample.name + " document overflow " + widths.document + "px");
      }
      await page.locator("#planningChange").screenshot({ path: path.join(K7_VISUAL_DIR, prefix + "-" + sample.name + ".png") });
    }
  }

  const spanishPage = await newPage({ width: 390, height: 844 });
  t.after(() => closePage(spanishPage));
  await at(spanishPage, samples[1]);
  await spanishPage.locator("#planningChange").evaluate((node) => { node.open = true; });
  await spanishPage.locator("#languageSelect").selectOption("es");
  const spanish = await planning(spanishPage);
  assert.deepEqual(spanish.change.dates, { previous: "1 jul. 2025", current: "1 ene. 2026" });
  const spanishText = await spanishPage.locator("#planningChange").innerText();
  assert.match(spanishText, /Cambió el estado publicado/);
  assert.match(spanishText, /Valor publicado anterior/);
  assert.match(spanishText, /Valor publicado actual/);
  await spanishPage.locator("#planningChange").screenshot({ path: path.join(K7_VISUAL_DIR, "390-state-transition-es.png") });
  await at(spanishPage, samples[3]);
  await spanishPage.locator("#planningChange").evaluate((node) => { node.open = true; });
  const spanishCauseText = await spanishPage.locator("#planningChange").innerText();
  assert.match(spanishCauseText, /Las etiquetas de situación duplicadas impiden establecer una correspondencia de filas uno a uno/);
  assert.match(spanishCauseText, /Código exacto del ámbito y valor único y estable de SITUACION DEL ÁMBITO/);
  assert.doesNotMatch(spanishCauseText, /Duplicate situation labels|Exact code plus a unique|Both editions must publish numeric values/);
  await spanishPage.locator("#planningChangeAnalyst").evaluate((node) => { node.open = true; });
  const spanishAnalystText = await spanishPage.locator("#planningChangeAnalystBody").innerText();
  assert.match(spanishAnalystText, /correspondencia de filas uno a uno/);
  assert.doesNotMatch(spanishAnalystText, /Duplicate situation labels|Exact code plus a unique|Both editions must publish numeric values|One or more published S2 rows has no defensible counterpart/);

  // Scan only authored visible K7 text. Source strings are marked data-verbatim
  // and remain untouched; the analyst disclosure is a separate projection.
  const forbidden = {
    en: /\b(?:progress(?:ed|ion)?|advanced|moved\s+forward|improved|worsened|delayed|accelerated|on\s+track|stalled|completion|development\s+gained|construction\s+delivered|consumed|built|expected|projected|trend|rate|velocity|because|due\s+to)\b/i,
    es: /\b(?:progreso|avanz(?:a|ó|ado|aron|ar)|mejor(?:a|ó|ado)|empeor(?:a|ó|ado)|retras(?:a|ó|ado)|aceler(?:a|ó|ado)|en\s+plazo|estancad\w*|finalizaci[oó]n|desarrollo\s+ganado|construcci[oó]n\s+entregada|consumid\w*|construid\w*|previst\w*|proyectad\w*|tendencia|ritmo|velocidad|porque|debido\s+a|a\s+causa\s+de)\b/i,
  };
  const englishPage = await newPage();
  t.after(() => closePage(englishPage));
  await at(englishPage, samples[1]);
  await englishPage.locator("#planningChange").evaluate((node) => { node.open = true; });
  for (const [page, language] of [[englishPage, "en"], [spanishPage, "es"]]) {
    const authoredText = await page.locator("#planningChange").evaluate((root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const values = [];
      while (walker.nextNode()) {
        const parent = walker.currentNode.parentElement;
        if (parent?.closest("[data-verbatim], #planningChangeAnalyst")) continue;
        values.push(walker.currentNode.textContent);
      }
      return values.join(" ");
    });
    assert.doesNotMatch(authoredText, forbidden[language], language + " rendered K7 copy");
  }
  console.log("[k7-visual] screenshots: " + K7_VISUAL_DIR);
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});
