// Rebuild the committed M3 example from the same K13/M2 path as the browser.
// Usage: node scripts/build_dossier_example.mjs [UTC ISO timestamp]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { createPlanningIndex, AMBITO_STATE, AVAILABILITY } from "../js/planning-ambito.js";
import { buildAmbitoComparison } from "../js/ambito-change.js";
import { ambitoEditionContainsCode } from "../js/ambito-comparison-adapter.js";
import * as Q from "../js/question-explorer.js";
import { buildEvidenceDossier, buildDossierFiles } from "../js/evidence-dossier.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const R = require("../js/evidence-registry.js");
const U = require("../js/evidence-url.js");
const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
const registryData = read("data/source_registry.json");
const state = read("data/planning/madrid_ambito_state.json");
const planningIndex = createPlanningIndex({ geometry: read("data/planning/madrid_ambitos.geojson"), state });
const cd = state.change_detection;
const registry = R.createEvidenceRegistry({
  registry: registryData,
  planningIndex,
  planningModule: { AMBITO_STATE, AVAILABILITY },
  ambitoEditionDiff: (code) => buildAmbitoComparison({
    previous: { reference_date: cd.previous.reference_date, families: cd.previous.families },
    current: { reference_date: cd.current.reference_date, families: cd.current.families },
    exactCode: code,
  }),
  ambitoEditionCodeKnown: (code) => ambitoEditionContainsCode(code, state),
});

const context = {
  lens: { which: "A", lon: -3.691757, lat: 40.395543, radiusM: 900 },
  selection: { type: "AMBITO", code: "APE.02.20", name: "CÁRCEL DE YESERÍAS" },
  licenceWindow: { from: "2025-10-01", to: "2026-09-30" },
  readiness: { planning: "ready", licences: "ready", editions: "ready" },
};
const outcome = Q.askQuestion(registry, "AMBITO_EDITION_DIFF", context);
if (outcome.status !== "answered") throw new Error(`Example did not resolve: ${outcome.result?.reason || outcome.status}`);
const presentation = Q.presentOutcome(outcome, { language: "en", reading: "analyst", context, registry });
const sourceIds = [outcome.result.sourceId, ...(outcome.trace || []).map((entry) => entry.result?.sourceId)].filter((id, index, all) => id && all.indexOf(id) === index);
const sourceRecords = sourceIds.map((id) => registryData.sources.find((source) => source.id === id)).filter(Boolean);
const generatedAt = process.argv[2] || new Date().toISOString();
const stateUrl = U.buildShareUrl("https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens/", {
  snapshotId: "20261029-m3-dossier-v1",
  mode: "PLACE",
  lensA: { lat: context.lens.lat, lon: context.lens.lon, radiusM: context.lens.radiusM },
  lensBEnabled: false,
  activeLens: "A",
  layers: [],
  reading: "analyst",
  language: "en",
});
const dossier = buildEvidenceDossier({
  outcome, presentation, context, currentContextKey: Q.contextKey(context), sourceRecords, generatedAt, stateUrl,
  identification: {
    language: "en", reading: "analyst", questionExplorerModelVersion: Q.MODEL_VERSION,
    registryContractVersion: registryData.contract_version, deploymentBuildId: "20261029-m3-dossier-v1",
  },
});
const files = buildDossierFiles(dossier);
const output = path.join(ROOT, "docs", "examples", "urban-evidence-dossier-v1");
fs.mkdirSync(output, { recursive: true });
for (const file of files) {
  const extension = path.extname(file.name);
  fs.writeFileSync(path.join(output, `yeserias-edition-difference${extension}`), file.text, "utf8");
}
console.log(`Wrote Yeserías dossier example at ${generatedAt}`);
