// Builds ONE verifiable Urban Evidence Dossier V2 (AMBITO_PHASES) through the same
// K13/M2 production path as the browser, pins it to the current git commit, and
// immediately self-verifies it.
//
// Usage: node scripts/build_verifiable_dossier.mjs <out.json> [ambito-code] [UTC-ISO-timestamp]
//
// Refuses to run on a dirty tree: the dossier names HEAD, so every artifact and
// module it depends on must equal HEAD's blob.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { createPlanningIndex, AMBITO_STATE, AVAILABILITY } from "../js/planning-ambito.js";
import * as Q from "../js/question-explorer.js";
import { buildEvidenceDossier, serializeEvidenceDossier } from "../js/evidence-dossier.js";
import { VERIFIABLE, STATUS, gitProvider, buildVerificationRecord, verifyDossier } from "./dossier_verify.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const R = require("../js/evidence-registry.js");
const U = require("../js/evidence-url.js");

const [out, code = "APE.02.20", stamp] = process.argv.slice(2);
if (!out) { console.error("usage: node scripts/build_verifiable_dossier.mjs <out.json> [ambito-code] [UTC-ISO]"); process.exit(2); }

const spec = VERIFIABLE.AMBITO_PHASES;
const provider = gitProvider({ repo: ROOT, codeRoot: ROOT });
const commit = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

for (const file of spec.artifacts) {
  const committed = provider.readArtifact(commit, file);
  const working = fs.readFileSync(path.join(ROOT, file));
  if (!committed || provider.sha256Hex(committed) !== provider.sha256Hex(working)) throw new Error(`DIRTY_TREE: ${file} differs from ${commit}`);
}
for (const file of spec.code) if (provider.codeMatchesCommit(commit, file) !== true) throw new Error(`DIRTY_TREE: ${file} differs from ${commit}`);

const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
const registryData = read("data/source_registry.json");
const state = read("data/planning/madrid_ambito_state.json");
const planningIndex = createPlanningIndex({ geometry: read("data/planning/madrid_ambitos.geojson"), state });
const registry = R.createEvidenceRegistry({ registry: registryData, planningIndex, planningModule: { AMBITO_STATE, AVAILABILITY } });

const context = {
  lens: { which: "A", lon: -3.691757, lat: 40.395543, radiusM: 900 },
  selection: { type: "AMBITO", code, name: code },
  licenceWindow: { from: "2025-10-01", to: "2026-09-30" },
  readiness: { planning: "ready", licences: "ready", editions: "ready" },
};
const outcome = Q.askQuestion(registry, "AMBITO_PHASES", context);
if (outcome.status !== "answered") throw new Error(`AMBITO_PHASES did not resolve for ${code}: ${outcome.result?.reason || outcome.status}`);
const presentation = Q.presentOutcome(outcome, { language: "en", reading: "analyst", context, registry });
const sourceRecords = [registryData.sources.find((s) => s.id === outcome.result.sourceId)];
const generatedAt = stamp || new Date().toISOString();
const stateUrl = U.buildShareUrl("https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens/", {
  snapshotId: commit.slice(0, 12), mode: "PLACE",
  lensA: { lat: context.lens.lat, lon: context.lens.lon, radiusM: context.lens.radiusM },
  lensBEnabled: false, activeLens: "A", layers: [], reading: "analyst", language: "en",
});

const dossier = buildEvidenceDossier({
  outcome, presentation, context, currentContextKey: Q.contextKey(context), sourceRecords, generatedAt, stateUrl,
  identification: { language: "en", reading: "analyst", questionExplorerModelVersion: Q.MODEL_VERSION, registryContractVersion: registryData.contract_version, deploymentBuildId: null },
  verification: buildVerificationRecord(provider, commit),
});
const text = serializeEvidenceDossier(dossier);
fs.writeFileSync(out, text, "utf8");

const verdict = verifyDossier(JSON.parse(text), provider);
console.log(`wrote ${out}\n${verdict.status} ${verdict.reason}${verdict.detail ? ` — ${verdict.detail}` : ""}`);
process.exit(verdict.status === STATUS.VERIFIED ? 0 : 1);
