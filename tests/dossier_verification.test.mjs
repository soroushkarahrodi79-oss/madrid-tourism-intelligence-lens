// Dossier V2 + headless verifier, increment 1 (AMBITO_PHASES).
// Every case runs against a throwaway git repository that holds ONLY the files the
// verifier is allowed to depend on, so the closed dependency set is itself tested.
// No network: nothing here fetches, and a static guard asserts the verifier cannot.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

import { createPlanningIndex, AMBITO_STATE, AVAILABILITY } from "../js/planning-ambito.js";
import * as Q from "../js/question-explorer.js";
import { buildEvidenceDossier, serializeEvidenceDossier, DOSSIER_SCHEMA_VERSION, DOSSIER_SCHEMA_VERSION_V2 } from "../js/evidence-dossier.js";
import { VERIFIABLE, STATUS, gitProvider, buildVerificationRecord, verifyDossier } from "../scripts/dossier_verify.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const require = createRequire(import.meta.url);
const R = require("../js/evidence-registry.js");
const U = require("../js/evidence-url.js");
const spec = VERIFIABLE.AMBITO_PHASES;
const CODE = "APE.02.20";
const read = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));
const registryData = read("data/source_registry.json");
const state = read("data/planning/madrid_ambito_state.json");
const planningIndex = createPlanningIndex({ geometry: read("data/planning/madrid_ambitos.geojson"), state });
const registry = R.createEvidenceRegistry({ registry: registryData, planningIndex, planningModule: { AMBITO_STATE, AVAILABILITY } });

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (dir, ...args) => execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", ...args], { env: GIT_ENV, encoding: "utf8" }).trim();

function copyInto(dir, files) {
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
  }
}

// A throwaway checkout holding exactly the verifier's closed dependency set.
function makeRepo({ withState = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dossier-verify-"));
  git(dir, "init", "-q");
  const files = [...spec.artifacts, ...spec.code, "scripts/dossier_verify.mjs"];
  copyInto(dir, files.filter((f) => withState || f !== "data/planning/madrid_ambito_state.json"));
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "fixture");
  return { dir, commit: git(dir, "rev-parse", "HEAD") };
}

// The dossier goes through the real production path (askQuestion over a real index).
function buildDossier(provider, commit, { withVerification = true } = {}) {
  const context = {
    lens: { which: "A", lon: -3.691757, lat: 40.395543, radiusM: 900 },
    selection: { type: "AMBITO", code: CODE, name: CODE },
    licenceWindow: { from: "2025-10-01", to: "2026-09-30" },
    readiness: { planning: "ready", licences: "ready", editions: "ready" },
  };
  const outcome = Q.askQuestion(registry, "AMBITO_PHASES", context);
  assert.equal(outcome.status, "answered");
  const presentation = Q.presentOutcome(outcome, { language: "en", reading: "analyst", context, registry });
  return buildEvidenceDossier({
    outcome, presentation, context, currentContextKey: Q.contextKey(context),
    sourceRecords: [registryData.sources.find((s) => s.id === outcome.result.sourceId)],
    generatedAt: "2026-11-16T12:00:00.000Z",
    stateUrl: U.buildShareUrl("https://example.test/", { snapshotId: "x", mode: "PLACE", lensA: { lat: 40.395543, lon: -3.691757, radiusM: 900 }, lensBEnabled: false, activeLens: "A", layers: [], reading: "analyst", language: "en" }),
    identification: { language: "en", reading: "analyst", questionExplorerModelVersion: Q.MODEL_VERSION, registryContractVersion: registryData.contract_version, deploymentBuildId: null },
    ...(withVerification ? { verification: buildVerificationRecord(provider, commit) } : {}),
  });
}

const thaw = (dossier) => JSON.parse(serializeEvidenceDossier(dossier));
const fixture = makeRepo();
const provider = gitProvider({ repo: fixture.dir, codeRoot: fixture.dir });
const good = thaw(buildDossier(provider, fixture.commit));

test("CASE 1 — a correct dossier is VERIFIED, in-process and from a clean checkout via the CLI", () => {
  assert.equal(good.dossier_schema_version, 2);
  assert.deepEqual(Object.keys(good.outcome.evidence).sort(), ["applied", "ceiling", "derivation", "freshness", "scope", "sourceId", "unit", "value"]);
  const verdict = verifyDossier(good, provider);
  assert.equal(verdict.status, STATUS.VERIFIED, JSON.stringify(verdict));

  // Clean checkout: only the closed file set, a different cwd, git objects only.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "dossier-cwd-"));
  const file = path.join(work, "dossier.json");
  fs.writeFileSync(file, JSON.stringify(good));
  const run = spawnSync(process.execPath, [path.join(fixture.dir, "scripts/dossier_verify.mjs"), file], { cwd: work, encoding: "utf8", env: { ...process.env, HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9" } });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /^VERIFIED REDERIVED_EQUAL/);
});

test("CASE 2 — a modified recorded value is a MISMATCH", () => {
  const forged = structuredClone(good);
  forged.outcome.evidence.value.phases[0].sourceValue = "Finalizado (forged)";
  const verdict = verifyDossier(forged, provider);
  assert.equal(verdict.status, STATUS.MISMATCH);
  assert.equal(verdict.reason, "VALUE_MISMATCH");
  assert.match(verdict.detail, /value/);

  const forgedApplied = structuredClone(good);
  forgedApplied.outcome.evidence.applied.code = "APE.02.12";
  assert.equal(verifyDossier(forgedApplied, provider).status, STATUS.MISMATCH);
  const forgedCeiling = structuredClone(good);
  forgedCeiling.outcome.evidence.ceiling = "softened";
  assert.equal(verifyDossier(forgedCeiling, provider).status, STATUS.MISMATCH);
});

test("CASE 3 — a wrong declared fingerprint is a MISMATCH, judged against git, not the dossier", () => {
  for (let i = 0; i < spec.artifacts.length; i += 1) {
    const forged = structuredClone(good);
    forged.verification.artifacts[i].sha256 = "0".repeat(64);
    const verdict = verifyDossier(forged, provider);
    assert.equal(verdict.status, STATUS.MISMATCH);
    assert.equal(verdict.reason, "FINGERPRINT_MISMATCH");
  }
  // A dossier that fingerprints TAMPERED bytes consistently still fails: git decides.
  const tampered = Buffer.from(fs.readFileSync(path.join(ROOT, "data/planning/madrid_ambito_state.json")));
  tampered[tampered.length - 2] ^= 1;
  const forged = structuredClone(good);
  forged.verification.artifacts.find((a) => a.path.endsWith("madrid_ambito_state.json")).sha256 = provider.sha256Hex(tampered);
  assert.equal(verifyDossier(forged, provider).reason, "FINGERPRINT_MISMATCH");
});

test("CASE 4 — an artifact absent at the declared commit is UNVERIFIABLE, never VERIFIED", () => {
  const early = makeRepo({ withState: false });
  copyInto(early.dir, ["data/planning/madrid_ambito_state.json"]);
  git(early.dir, "add", "-A");
  git(early.dir, "commit", "-q", "-m", "add state");
  const later = git(early.dir, "rev-parse", "HEAD");
  const p = gitProvider({ repo: early.dir, codeRoot: early.dir });
  const dossier = thaw(buildDossier(p, later));
  assert.equal(verifyDossier(dossier, p).status, STATUS.VERIFIED);
  const stale = structuredClone(dossier);
  stale.verification.commit = early.commit; // a real commit that predates the artifact
  const verdict = verifyDossier(stale, p);
  assert.equal(verdict.status, STATUS.UNVERIFIABLE);
  assert.equal(verdict.reason, "ARTIFACT_MISSING");
});

test("CASE 5 — a V1 dossier is UNVERIFIABLE with an explicit reason", () => {
  const v1 = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/examples/urban-evidence-dossier-v1/yeserias-edition-difference.json"), "utf8"));
  assert.equal(v1.dossier_schema_version, 1);
  const verdict = verifyDossier(v1, provider);
  assert.equal(verdict.status, STATUS.UNVERIFIABLE);
  assert.equal(verdict.reason, "V1_NO_VERIFICATION_RECORD");
  const built = thaw(buildDossier(provider, fixture.commit, { withVerification: false }));
  assert.equal(built.dossier_schema_version, DOSSIER_SCHEMA_VERSION);
  assert.equal(verifyDossier(built, provider).reason, "V1_NO_VERIFICATION_RECORD");
});

test("closed lists: other questions, readers, paths, commits and code versions are UNVERIFIABLE", () => {
  const cases = [
    ["UNSUPPORTED_QUESTION", (d) => { d.question.id = "AMBITO_EDITION_DIFF"; d.question.registered_shape = "AMBITO_EDITION_DIFF"; }],
    ["UNSUPPORTED_READER", (d) => { d.verification.reader = "availableBuildability"; }],
    ["UNSUPPORTED_ARTIFACT_PATH", (d) => { d.verification.artifacts.push({ path: "data/planning/madrid_ambitos.geojson", sha256: "1".repeat(64) }); }],
    ["UNSUPPORTED_ARTIFACT_PATH", (d) => { d.outcome.evidence.applied.artifact = "../../etc/passwd"; }],
    ["UNSUPPORTED_CODE_PATH", (d) => { d.verification.code = ["js/app.js"]; }],
    ["UNSUPPORTED_PARAMETERS", (d) => { d.question.parameters = { code: CODE, extra: 1 }; }],
    ["UNSUPPORTED_OUTCOME", (d) => { d.outcome.status = "ABSTAINED"; }],
    ["UNSUPPORTED_SCHEMA_VERSION", (d) => { d.dossier_schema_version = 3; }],
    ["NO_APPLIED_RECORD", (d) => { delete d.outcome.evidence.applied; }],
    ["COMMIT_NOT_AVAILABLE", (d) => { d.verification.commit = "a".repeat(40); }],
  ];
  for (const [reason, mutate] of cases) {
    const d = structuredClone(good);
    mutate(d);
    const verdict = verifyDossier(d, provider);
    assert.equal(verdict.status, STATUS.UNVERIFIABLE, `${reason}: ${JSON.stringify(verdict)}`);
    assert.equal(verdict.reason, reason);
  }
  assert.equal(verifyDossier(null, provider).status, STATUS.UNVERIFIABLE);

  // Code that differs from the declared commit must not be trusted to re-derive.
  const drift = makeRepo();
  const p = gitProvider({ repo: drift.dir, codeRoot: drift.dir });
  const dossier = thaw(buildDossier(p, drift.commit));
  fs.appendFileSync(path.join(drift.dir, "js/planning-ambito.js"), "\n// local edit\n");
  const verdict = verifyDossier(dossier, p);
  assert.equal(verdict.status, STATUS.UNVERIFIABLE);
  assert.equal(verdict.reason, "CODE_VERSION_DIFFERS");
});

test("V2 is additive: V1 output is unchanged, V2 adds only `applied` and `verification`", () => {
  const v1 = thaw(buildDossier(provider, fixture.commit, { withVerification: false }));
  assert.equal(Object.hasOwn(v1, "verification"), false);
  assert.equal(Object.hasOwn(v1.outcome.evidence, "applied"), false);
  const strip = (d) => { const c = structuredClone(d); delete c.verification; delete c.outcome.evidence.applied; c.dossier_schema_version = 0; c.reproducibility.dossier_schema_version = 0; return c; };
  assert.deepEqual(strip(good), strip(v1));
  assert.equal(DOSSIER_SCHEMA_VERSION_V2, 2);
  // Verification cannot be attached to an abstention, and a malformed record is refused.
  assert.throws(() => buildEvidenceDossier({ outcome: { questionId: "AMBITO_PHASES", shape: "AMBITO_PHASES", status: "abstained", contextKey: "k", result: { kind: "ABSTENTION" } }, presentation: { questionId: "AMBITO_PHASES" }, context: {}, currentContextKey: "k", generatedAt: "2026-11-16T12:00:00.000Z", stateUrl: "https://e.test/?v=1", verification: good.verification }), /DOSSIER_VERIFICATION_REQUIRES_ANSWER/);
  assert.throws(() => buildDossier(provider, fixture.commit).constructor && buildEvidenceDossier({}), TypeError);
});

test("the verifier cannot reach the network", () => {
  const source = fs.readFileSync(path.join(ROOT, "scripts/dossier_verify.mjs"), "utf8");
  for (const banned of [/\bfetch\s*\(/, /node:https?/, /node:net/, /node:dns/, /XMLHttpRequest/, /WebSocket/]) assert.doesNotMatch(source, banned);
});
