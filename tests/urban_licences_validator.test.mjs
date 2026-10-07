// The K9 deployment guardrails actually fire (issue #71).
//
// Exercises validateDeployment against a minimal registry carrying only the two
// K9 sources plus the real spatial scopes, over the committed artifacts, then
// mutates copies to prove each guard rejects a degraded build: a collapsed match
// rate, the historical route disappearing, a family collapsing, an unseen TIPO,
// the NIVEL_PROTECCION absence states merging, a cross-family total or
// approval-rate semantics appearing, dataset 133556 ingested, and record field
// creep. A guard that never fails is not a guard.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateDeployment } from "../scripts/validate_deployment.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const clone = (v) => JSON.parse(JSON.stringify(v));

const registry = read("data/source_registry.json");
const crosswalkSource = registry.sources.find((s) => s.id === "callejero_ndp_crosswalk");
const licenceSource = registry.sources.find((s) => s.id === "urban_licences");

function baseArtifacts() {
  return {
    "callejero/madrid_ndp_crosswalk.json": read("data/callejero/madrid_ndp_crosswalk.json"),
    "callejero/madrid_ndp_crosswalk.meta.json": read("data/callejero/madrid_ndp_crosswalk.meta.json"),
    "planning/madrid_urban_licences.json": read("data/planning/madrid_urban_licences.json"),
    "planning/madrid_urban_licences.meta.json": read("data/planning/madrid_urban_licences.meta.json"),
  };
}

function run(artifacts) {
  return validateDeployment({
    registry: {
      contract_version: registry.contract_version,
      spatial_scopes: registry.spatial_scopes,
      sources: [crosswalkSource, licenceSource],
    },
    artifacts,
    generatedAt: "2026-10-06T00:00:00Z",
    commit: "test",
    workflowRun: null,
    buildStepOutcome: "success",
  });
}

const errorsFor = (id, result) => result.errors.filter((e) => e.startsWith(`${registry.sources.find((s) => s.id === id).display_name}:`));

test("the committed K9 artifacts pass every guard", () => {
  const result = run(baseArtifacts());
  assert.deepEqual(result.errors, [], result.errors.join("\n"));
  assert.equal(result.ok, true);
});

test("a collapsed match rate is rejected", () => {
  const artifacts = baseArtifacts();
  artifacts["callejero/madrid_ndp_crosswalk.meta.json"].coverage.row_match_rate = 0.4;
  assert.ok(errorsFor("callejero_ndp_crosswalk", run(artifacts)).some((e) => /match rate/i.test(e)));
});

test("the historical route disappearing is rejected", () => {
  const artifacts = baseArtifacts();
  artifacts["callejero/madrid_ndp_crosswalk.meta.json"].coverage.historical_only_recovered_rows = 0;
  assert.ok(errorsFor("callejero_ndp_crosswalk", run(artifacts)).some((e) => /historical/i.test(e)));
});

test("residual counts that fail to reconcile are rejected", () => {
  const artifacts = baseArtifacts();
  artifacts["callejero/madrid_ndp_crosswalk.meta.json"].coverage.resolved_rows = 999;
  assert.ok(errorsFor("callejero_ndp_crosswalk", run(artifacts)).some((e) => /reconcile|resolved/i.test(e)));
});

test("a missing crosswalk source fingerprint is rejected", () => {
  const artifacts = baseArtifacts();
  delete artifacts["callejero/madrid_ndp_crosswalk.meta.json"].sources.historical_callejero.observed_resource_state.sha256;
  assert.ok(errorsFor("callejero_ndp_crosswalk", run(artifacts)).some((e) => /fingerprint/i.test(e)));
});

test("a collapsed family count is rejected", () => {
  const artifacts = baseArtifacts();
  artifacts["planning/madrid_urban_licences.meta.json"].tipo_taxonomy.family_counts.TEMPORARY_ACTIVITY_FAMILY = 0;
  assert.ok(errorsFor("urban_licences", run(artifacts)).some((e) => /TEMPORARY_ACTIVITY_FAMILY/.test(e)));
});

test("an unclassified TIPO is rejected", () => {
  const artifacts = baseArtifacts();
  artifacts["planning/madrid_urban_licences.meta.json"].tipo_taxonomy.unclassified_tipo_rows = 3;
  assert.ok(errorsFor("urban_licences", run(artifacts)).some((e) => /unclassified/i.test(e)));
});

test("merging the NIVEL_PROTECCION absence states is rejected", () => {
  const artifacts = baseArtifacts();
  delete artifacts["planning/madrid_urban_licences.meta.json"].nivel_proteccion.counts["Sin Catalogar"];
  assert.ok(errorsFor("urban_licences", run(artifacts)).some((e) => /absence state/i.test(e)));
});

test("a cross-family total or approval-rate key is rejected", () => {
  for (const banned of ["total_urban_licences", "approval_rate"]) {
    const artifacts = baseArtifacts();
    artifacts["planning/madrid_urban_licences.json"][banned] = 17;
    assert.ok(errorsFor("urban_licences", run(artifacts)).some((e) => e.includes(banned)), banned);
  }
});

test("ingesting dataset 133556 (responsible declarations) is rejected", () => {
  const artifacts = baseArtifacts();
  artifacts["planning/madrid_urban_licences.meta.json"].source.dataset = "133556-0-declaraciones-responsables";
  assert.ok(errorsFor("urban_licences", run(artifacts)).some((e) => /133556/.test(e)));
});

test("record field creep (a non-minimised field) is rejected", () => {
  const artifacts = baseArtifacts();
  artifacts["planning/madrid_urban_licences.json"].records[0].persona_interesada = "x";
  assert.ok(errorsFor("urban_licences", run(artifacts)).some((e) => /allow-list/i.test(e)));
});

test("a missing date extent is rejected", () => {
  const artifacts = baseArtifacts();
  artifacts["planning/madrid_urban_licences.json"].date_extent = { min: null, max: null };
  assert.ok(errorsFor("urban_licences", run(artifacts)).some((e) => /date_extent/i.test(e)));
});

test("a missing artifact is rejected (blocking)", () => {
  const artifacts = baseArtifacts();
  artifacts["planning/madrid_urban_licences.json"] = null;
  const result = run(artifacts);
  assert.equal(result.ok, false);
  assert.ok(errorsFor("urban_licences", result).some((e) => /missing/i.test(e)));
});
