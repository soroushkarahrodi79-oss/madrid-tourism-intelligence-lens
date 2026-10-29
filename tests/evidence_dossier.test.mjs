import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

import { createPlanningIndex, AMBITO_STATE, AVAILABILITY } from "../js/planning-ambito.js";
import { createLicenceIndex } from "../js/urban-licences.js";
import { buildAmbitoComparison } from "../js/ambito-change.js";
import { ambitoEditionContainsCode } from "../js/ambito-comparison-adapter.js";
import * as Q from "../js/question-explorer.js";
import {
  DOSSIER_SCHEMA_VERSION,
  buildDossierFiles,
  buildEvidenceDossier,
  renderEvidenceDossierHtml,
  serializeEvidenceDossier,
} from "../js/evidence-dossier.js";

const require = createRequire(import.meta.url);
const R = require("../js/evidence-registry.js");
const read = (path) => JSON.parse(fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const REGISTRY = read("data/source_registry.json");
const GEOMETRY = read("data/planning/madrid_ambitos.geojson");
const STATE = read("data/planning/madrid_ambito_state.json");
const LICENCES = read("data/planning/madrid_urban_licences.json");
const CD = STATE.change_detection;
const planningIndex = createPlanningIndex({ geometry: GEOMETRY, state: STATE });
const registry = R.createEvidenceRegistry({
  registry: REGISTRY,
  planningIndex,
  planningModule: { AMBITO_STATE, AVAILABILITY },
  licenceIndex: createLicenceIndex(LICENCES),
  ambitoEditionDiff: (code) => buildAmbitoComparison({
    previous: { reference_date: CD.previous.reference_date, families: CD.previous.families },
    current: { reference_date: CD.current.reference_date, families: CD.current.families },
    exactCode: code,
  }),
  ambitoEditionCodeKnown: (code) => ambitoEditionContainsCode(code, STATE),
});

const YESERIAS = { lon: -3.691757, lat: 40.395543 };
const SOL = { lon: -3.7038, lat: 40.4168 };
const WINDOW = { from: "2025-10-01", to: "2026-09-30" };
const READY = { planning: "ready", licences: "ready", editions: "ready" };
const context = (over = {}) => ({
  lens: { which: "A", ...YESERIAS, radiusM: 900 },
  selection: null,
  licenceWindow: WINDOW,
  readiness: READY,
  ...over,
});

function sourceRecords(outcome) {
  const ids = [];
  const add = (result) => { if (result && result.kind === "EVIDENCE" && !ids.includes(result.sourceId)) ids.push(result.sourceId); };
  add(outcome.result);
  for (const trace of outcome.trace || []) add(trace.result);
  return ids.map((id) => REGISTRY.sources.find((source) => source.id === id)).filter(Boolean);
}

function dossierFor(questionId, ctx = context(), { language = "en", reading = "analyst", records } = {}) {
  const outcome = Q.askQuestion(registry, questionId, ctx);
  const presentation = Q.presentOutcome(outcome, { language, reading, context: ctx, registry });
  const dossier = buildEvidenceDossier({
    outcome,
    presentation,
    context: ctx,
    currentContextKey: Q.contextKey(ctx),
    sourceRecords: records ?? sourceRecords(outcome),
    generatedAt: "2026-10-29T10:30:00.000Z",
    stateUrl: "https://example.test/lens/?v=1&s=20261029-1&m=PLACE&a=40.39554,-3.69176,900&al=A&rd=analyst&lg=en",
    identification: {
      language, reading, questionExplorerModelVersion: Q.MODEL_VERSION,
      registryContractVersion: REGISTRY.contract_version, deploymentBuildId: "20261029-1",
    },
  });
  return { outcome, presentation, dossier };
}

test("Case A: planning identity preserves the exact K13 seven-field evidence and point-in-polygon method", () => {
  const { outcome, dossier } = dossierFor("AMBITO_AT_POINT");
  assert.equal(outcome.status, "answered");
  assert.equal(dossier.context.lens.radius_m, 900);
  assert.equal(dossier.outcome.evidence.value.ambitoCode, "APE.02.20");
  assert.equal(dossier.outcome.evidence.derivation, "POINT_IN_POLYGON");
  assert.deepEqual(dossier.outcome.evidence, Object.fromEntries([
    "value", "scope", "unit", "sourceId", "freshness", "ceiling", "derivation",
  ].map((field) => [field, outcome.result[field]])));
  assert.deepEqual(dossier.reproducibility.source_ids, ["planning_ambito_geometry"]);
  assert.equal(dossier.sources[0].reference_date, null, "an unknown source date stays explicitly null");
});

test("Case B: Yeserías edition difference carries the existing classifier and official fingerprints, never progress", () => {
  const ctx = context({ selection: { type: "AMBITO", code: "APE.02.20", name: "CÁRCEL DE YESERÍAS" } });
  const { outcome, dossier } = dossierFor("AMBITO_EDITION_DIFF", ctx);
  assert.equal(outcome.status, "answered");
  assert.equal(dossier.context.planning_ambito.code, "APE.02.20");
  assert.equal(dossier.outcome.evidence.derivation, "EDITION_DIFF");
  assert.deepEqual(dossier.outcome.evidence.value, outcome.result.value, "M3 does not recompute K7 classifications");
  assert.equal(dossier.sources[0].change_detection.pair_id, "2025-07__2026-01");
  assert.match(JSON.stringify(dossier), /e1ff3e0e0f63fe59/);
  assert.doesNotMatch(JSON.stringify(dossier).toLowerCase(), /development progress|physical progress/);
});

test("Case C: granted licences preserve Lens, exact window, families and the granted-is-not-built ceiling", () => {
  const { outcome, dossier } = dossierFor("LICENCES_IN_LENS");
  assert.equal(outcome.status, "answered");
  assert.deepEqual(dossier.question.parameters.window, WINDOW);
  assert.deepEqual(dossier.context.licence_date_window, WINDOW);
  assert.equal(dossier.outcome.evidence.derivation, "IN_CIRCLE_FILTER");
  assert.deepEqual(dossier.outcome.evidence.value, outcome.result.value);
  assert.match(dossier.outcome.evidence.ceiling, /granted is not built/i);
  assert.match(JSON.stringify(dossier.outcome.evidence.value), /BUILDING_URBANISTIC_LICENCE_FAMILY/);
});

test("Case D: an unavailable planning answer exports an abstention, never a plausible fact", () => {
  const ctx = context({ lens: { which: "A", ...SOL, radiusM: 900 } });
  const { outcome, dossier } = dossierFor("AMBITO_AT_POINT", ctx);
  assert.equal(outcome.status, "abstained");
  assert.equal(dossier.outcome.status, "ABSTAINED");
  assert.equal(dossier.outcome.evidence, null);
  assert.equal(dossier.outcome.abstention.reason, "NO_EVIDENCE_FOR_SCOPE");
  assert.equal(dossier.sources.length, 0);
  assert.match(renderEvidenceDossierHtml(dossier), /No factual value is asserted/);
});

test("Case E: changed Lens, radius, entity or date window is rejected as stale", () => {
  const ctx = context();
  const outcome = Q.askQuestion(registry, "LICENCES_IN_LENS", ctx);
  const presentation = Q.presentOutcome(outcome, { language: "en", reading: "citizen", context: ctx, registry });
  for (const changed of [
    context({ lens: { which: "B", ...YESERIAS, radiusM: 900 } }),
    context({ lens: { which: "A", ...YESERIAS, radiusM: 950 } }),
    context({ selection: { type: "AMBITO", code: "APE.02.12", name: "BOLÍVAR Y COBRE" } }),
    context({ licenceWindow: { from: "2025-11-01", to: "2026-09-30" } }),
  ]) {
    assert.throws(() => buildEvidenceDossier({
      outcome, presentation, context: changed, currentContextKey: Q.contextKey(changed),
      sourceRecords: sourceRecords(outcome), generatedAt: "2026-10-29T10:30:00.000Z", stateUrl: "https://example.test/?v=1",
    }), /DOSSIER_CONTEXT_STALE/);
  }
});

test("all six M2 question shapes produce a dossier from completed committed evidence", () => {
  const cases = [
    ["AMBITO_AT_POINT", context()],
    ["AMBITO_PHASES", context({ selection: { type: "AMBITO", code: "APE.02.20", name: "CÁRCEL DE YESERÍAS" } })],
    ["AMBITO_EDITION_DIFF", context({ selection: { type: "AMBITO", code: "APE.02.20", name: "CÁRCEL DE YESERÍAS" } })],
    ["AMBITOS_IN_LENS", context()],
    ["LICENCES_IN_LENS", context()],
    ["SOURCE_PROVENANCE", { ...context(), evidenceSourceId: "planning_ambito_state" }],
  ];
  for (const [id, ctx] of cases) {
    const { outcome, dossier } = dossierFor(id, ctx);
    assert.equal(outcome.status, "answered", id);
    assert.equal(dossier.question.id, id);
    assert.equal(dossier.outcome.status, "ANSWERED");
    assert.deepEqual(dossier.outcome.evidence.value, outcome.result.value);
  }
});

test("HTML and JSON are two safe, offline representations of the same frozen dossier", () => {
  const { dossier } = dossierFor("AMBITO_PHASES", context({
    selection: { type: "AMBITO", code: "APE.02.20", name: '<script>alert("x")</script> CÁRCEL DE YESERÍAS' },
  }), { language: "es", reading: "citizen" });
  const jsonText = serializeEvidenceDossier(dossier);
  const parsed = JSON.parse(jsonText);
  assert.deepEqual(parsed, dossier);
  const html = renderEvidenceDossierHtml(dossier);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /@page\{size:A4/);
  assert.match(html, /CÁRCEL DE YESERÍAS/);
  assert.match(html, /&lt;script&gt;alert/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<script|<link|src=/i, "the offline document has no runtime or remote dependency");
  const files = buildDossierFiles(dossier);
  assert.deepEqual(files.map((file) => file.name.slice(file.name.lastIndexOf("."))), [".html", ".json"]);
  assert.equal(JSON.parse(files[1].text).generated_at, dossier.generated_at);
  assert.ok(files[0].text.includes(dossier.question.wording.slice(0, 20)));
  assert.equal(DOSSIER_SCHEMA_VERSION, 1);
});

test("adversarial validation refuses malformed outcomes and unknown source identity; missing licence metadata stays missing", () => {
  const { outcome, presentation } = dossierFor("AMBITO_AT_POINT");
  const ctx = context();
  const base = {
    outcome, presentation, context: ctx, currentContextKey: Q.contextKey(ctx),
    generatedAt: "2026-10-29T10:30:00.000Z", stateUrl: "https://example.test/?v=1",
  };
  assert.throws(() => buildEvidenceDossier({ ...base, sourceRecords: [] }), /DOSSIER_UNKNOWN_SOURCE/);
  assert.throws(() => buildEvidenceDossier({ ...base, outcome: { ...outcome, shape: "NOT_REGISTERED" } }), /question id and registered shape differ/);
  assert.throws(() => buildEvidenceDossier({ ...base, outcome: { ...outcome, status: "loading" } }), /DOSSIER_OUTCOME_INCOMPLETE/);
  assert.throws(() => buildEvidenceDossier({ ...base, sourceRecords: sourceRecords(outcome), generatedAt: "29 October" }), /UTC ISO timestamp/);
  assert.throws(() => buildEvidenceDossier({ ...base, sourceRecords: sourceRecords(outcome), stateUrl: "javascript:alert(1)" }), /canonical K11 v1 URL/);
  assert.throws(() => buildEvidenceDossier({ ...base, sourceRecords: sourceRecords(outcome), identification: { language: "fr" } }), /language must be es or en/);

  const raw = REGISTRY.sources.find((source) => source.id === outcome.result.sourceId);
  const noLicence = { ...raw };
  delete noLicence.license;
  delete noLicence.license_url;
  const dossier = buildEvidenceDossier({ ...base, sourceRecords: [noLicence] });
  assert.equal(Object.hasOwn(dossier.sources[0], "license"), false);
  assert.equal(dossier.sources[0].reference_date, null);
});

test("the dossier stays separate from K11's exact five-file contract", () => {
  const exportSource = fs.readFileSync(new URL("../js/evidence-export.js", import.meta.url), "utf8");
  assert.match(exportSource, /const files = \[\s*\{ name: `reading-/);
  assert.doesNotMatch(exportSource, /dossier/i);
});
