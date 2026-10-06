#!/usr/bin/env node

// Derive K7's audit summaries from the exact, separately preserved edition
// records emitted by build_ambito_development_state.py. S2's old first-row result
// is retained only as a labelled Gate L audit baseline.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditEditionPair,
  auditLegacyGateLPair,
  reconcileEditionPair,
} from "../js/ambito-change.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = path.join(root, "data/planning/madrid_ambito_state.json");
const metaPath = path.join(root, "data/planning/madrid_ambito_state.meta.json");
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
const pair = artifact.change_detection;
if (!pair || pair.pair_id !== "2025-07__2026-01") throw new Error("K7 pinned pair is missing or drifted");

const families = {};
for (const family of ["S1", "S2"]) {
  const previous = pair.previous?.families?.[family];
  const current = pair.current?.families?.[family];
  const legacy = auditLegacyGateLPair(previous, current);
  const production = auditEditionPair(previous, current);
  const reconciliation = reconcileEditionPair(previous, current);
  if (legacy.comparabilityVerdict !== "COMPARABLE_WITHIN_SCHEMA_ERA" ||
      production.comparabilityVerdict !== "COMPARABLE_WITHIN_SCHEMA_ERA") {
    throw new Error(`${family} K7 pair did not pass the schema-era comparability guard`);
  }
  families[family] = {
    previous: {
      reference_date: previous.reference_date,
      snapshot_identity: previous.snapshot_identity,
      resource_id: previous.resource_id,
      sha256: previous.sha256,
      schema_era: previous.schema_era,
      schema_fingerprint: previous.schema_fingerprint,
      retrieved_at: previous.retrieved_at,
      source_url: previous.resource_url,
    },
    current: {
      reference_date: current.reference_date,
      snapshot_identity: current.snapshot_identity,
      resource_id: current.resource_id,
      sha256: current.sha256,
      schema_era: current.schema_era,
      schema_fingerprint: current.schema_fingerprint,
      retrieved_at: current.retrieved_at,
      source_url: current.resource_url,
    },
    comparability_verdict: reconciliation.comparabilityVerdict,
    legacy_gate_l_audit: {
      audit_mode: legacy.auditMode,
      row_policy: legacy.rowPolicy,
      counts: legacy.counts,
      cosmetic_only_count: legacy.cosmeticOnlyCount,
      cosmetic_only_observations: legacy.records
        .filter((record) => record.cosmeticOnly)
        .map((record) => ({ exact_code: record.exactCode, evidence: record.evidence })),
    },
    production_row_preserving: {
      row_policy: family === "S2"
        ? "PRESERVE_ALL_ROWS_MATCH_UNIQUE_SITUACION_ONLY"
        : "ONE_EXACT_CODE_ROW_PER_EDITION",
      counts: production.counts,
      cosmetic_only_count: production.cosmeticOnlyCount,
    },
    reconciliation: {
      exact_code_divergence_count: reconciliation.divergenceCount,
      divergences: reconciliation.divergences,
    },
  };
}

const expectedS1 = { NO_CHANGE: 655, STATE_TRANSITION: 10, NEW_AMBITO: 2 };
const expectedS2Legacy = {
  NO_CHANGE: 220,
  STATE_TRANSITION: 9,
  NEW_AMBITO: 0,
  ABSENT_FROM_EDITION: 9,
  MODIFIED_BY_INSTRUMENT: 0,
  CAUSE_UNRESOLVED: 1,
  NON_COMPARABLE: 0,
};
const compactCounts = (counts) => Object.fromEntries(
  Object.entries(counts).filter(([, count]) => count !== 0),
);
if (JSON.stringify(compactCounts(families.S1.production_row_preserving.counts)) !== JSON.stringify(expectedS1)) {
  throw new Error(`S1 production benchmark mismatch: ${JSON.stringify(families.S1.production_row_preserving.counts)}`);
}
if (JSON.stringify(families.S2.legacy_gate_l_audit.counts) !== JSON.stringify(expectedS2Legacy)) {
  throw new Error(`Legacy Gate L S2 benchmark mismatch: ${JSON.stringify(families.S2.legacy_gate_l_audit.counts)}`);
}
if (families.S2.legacy_gate_l_audit.cosmetic_only_count !== 54) {
  throw new Error(`Expected 54 legacy cosmetic-only observations, found ${families.S2.legacy_gate_l_audit.cosmetic_only_count}`);
}
const explicitCodes = new Set(families.S2.reconciliation.divergences.map((item) => item.exactCode));
for (const code of ["UZPp.02.03-RP", "UZPp.02.04-RP"]) {
  if (!explicitCodes.has(code)) throw new Error(`Required row reconciliation is missing for ${code}`);
}

pair.audits = {
  source: "scripts/build_ambito_change_detection.mjs",
  comparison_basis: pair.comparison_basis,
  comparability_verdict: pair.comparability_verdict,
  families,
  notes: [
    "The legacy S2 audit reproduces Gate L's old first-source-row-per-code calculation only as an audit baseline.",
    "The production result preserves every S2 row and matches only unique SITUACION DEL ÁMBITO values.",
    "Every exact-code outcome divergence is listed with matched and unmatched rows and numeric comparison status.",
    "The 54 legacy cosmetic-only observations preserve their source strings and are not substantive changes.",
  ],
};
meta.change_detection = {
  ...meta.change_detection,
  audits: Object.fromEntries(Object.entries(families).map(([family, result]) => [family, {
    legacy_gate_l_counts: result.legacy_gate_l_audit.counts,
    legacy_gate_l_cosmetic_only_count: result.legacy_gate_l_audit.cosmetic_only_count,
    production_counts: result.production_row_preserving.counts,
    exact_code_divergence_count: result.reconciliation.exact_code_divergence_count,
  }])),
};
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
meta.fingerprint.value = crypto.createHash("sha256").update(canonical(artifact), "utf8").digest("hex");
fs.writeFileSync(artifactPath, `${JSON.stringify(artifact)}\n`, "utf8");
fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
console.log(`[k7] derived legacy + row-preserving audits; fingerprint ${meta.fingerprint.value.slice(0, 16)}`);
