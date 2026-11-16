// Headless verifier for Urban Evidence Dossier V2 (increment 1: AMBITO_PHASES only).
//
// Usage: node scripts/dossier_verify.mjs <dossier.json> [--repo <git-dir>]
// Exit:  0 VERIFIED · 1 MISMATCH · 2 UNVERIFIABLE
//
// TRUST MODEL. The dossier is an untrusted CLAIM. Nothing it declares is accepted
// on its own word:
//   * the artifact bytes come from the git object store at the declared commit
//     (content-addressed), never from the dossier and never from the working tree;
//   * the declared SHA-256 of each artifact is only CROSS-CHECKED against those bytes;
//   * the code that re-derives the value is this checkout's own modules, and the
//     verifier refuses to run if they differ from the declared commit's blobs;
//   * which question, reader, artifact paths and code paths are acceptable is a
//     CLOSED list in this file, not something the dossier can extend.
// The commit id itself is the out-of-band anchor: cite it, and anyone can look it up.
//
// No network, no new dependency: node:crypto, node:child_process and git only.

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { developmentState, AVAILABILITY } from "../js/planning-ambito.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const require = createRequire(import.meta.url);
const R = require("../js/evidence-registry.js");

export const STATUS = Object.freeze({ VERIFIED: "VERIFIED", MISMATCH: "MISMATCH", UNVERIFIABLE: "UNVERIFIABLE" });

// The closed list. One question, one pure reader, two data files, and the code
// closure that re-derivation actually loads. Sorted so equality is order-free.
export const VERIFIABLE = Object.freeze({
  AMBITO_PHASES: Object.freeze({
    sourceId: "planning_ambito_state",
    reader: "developmentState",
    appliedArtifact: "planning/madrid_ambito_state.json",
    artifacts: Object.freeze(["data/planning/madrid_ambito_state.json", "data/source_registry.json"]),
    code: Object.freeze(["js/evidence-registry.js", "js/evidence-scope.js", "js/geography.js", "js/planning-ambito.js"]),
  }),
});

const HEX40 = /^[0-9a-f]{40}$/;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
const result = (status, reason, detail = null) => Object.freeze({ status, reason, detail });

// Key-sorted JSON: equality that does not depend on property order.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value === undefined ? null : value);
}

// ---------------------------------------------------------------- git provider

export function gitProvider({ repo = ROOT, codeRoot = ROOT } = {}) {
  const git = (args) => execFileSync("git", ["-C", repo, ...args], { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] });
  return {
    commitExists(commit) {
      if (!HEX40.test(commit)) return false;
      try { git(["cat-file", "-e", `${commit}^{commit}`]); return true; } catch { return false; }
    },
    readArtifact(commit, file) {
      try { return git(["cat-file", "blob", `${commit}:${file}`]); } catch { return null; }
    },
    sha256Hex: (bytes) => crypto.createHash("sha256").update(bytes).digest("hex"),
    // true/false: the executed module is / is not the declared commit's blob.
    // null: it cannot be decided (module absent from the commit or the checkout).
    codeMatchesCommit(commit, file) {
      let expected;
      try { expected = git(["rev-parse", `${commit}:${file}`]).toString("utf8").trim(); } catch { return null; }
      let bytes;
      try { bytes = fs.readFileSync(path.join(codeRoot, file)); } catch { return null; }
      // git stores text with LF; a CRLF checkout must not read as a code change.
      const text = Buffer.from(bytes.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
      const blob = crypto.createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${text.length}\0`), text])).digest("hex");
      return blob === expected;
    },
  };
}

// The verification record a dossier must carry, built from the SAME trusted source
// the verifier later reads, so generator and verifier cannot disagree on identity.
export function buildVerificationRecord(provider, commit, questionId = "AMBITO_PHASES") {
  const spec = VERIFIABLE[questionId];
  if (!spec) throw new Error(`buildVerificationRecord: ${questionId} is not verifiable`);
  const artifacts = spec.artifacts.map((file) => {
    const bytes = provider.readArtifact(commit, file);
    if (!bytes) throw new Error(`buildVerificationRecord: ${file} is absent at ${commit}`);
    return { path: file, sha256: provider.sha256Hex(bytes) };
  });
  return {
    verification_schema_version: 1,
    commit,
    artifacts,
    code: [...spec.code],
    reader: spec.reader,
    trust_model: "Artifact bytes are read from git at `commit`; declared SHA-256 values are cross-checked, not trusted. Code identity is checked against the same commit.",
    proves: "That re-running the named pure reader over the identified committed artifacts yields exactly the recorded evidence.",
    does_not_prove: "That the publisher's data are correct, that the method is scientifically valid, or that the commit is an official release. Computational reproducibility only.",
  };
}

// ---------------------------------------------------------------- verification

export function verifyDossier(dossier, provider) {
  if (!isObject(dossier)) return result(STATUS.UNVERIFIABLE, "MALFORMED_DOSSIER");
  if (dossier.dossier_schema_version === 1) return result(STATUS.UNVERIFIABLE, "V1_NO_VERIFICATION_RECORD", "V1 dossiers carry neither `applied` nor artifact fingerprints.");
  if (dossier.dossier_schema_version !== 2) return result(STATUS.UNVERIFIABLE, "UNSUPPORTED_SCHEMA_VERSION", String(dossier.dossier_schema_version));
  const v = dossier.verification;
  if (!isObject(v)) return result(STATUS.UNVERIFIABLE, "MALFORMED_VERIFICATION_RECORD");
  if (v.verification_schema_version !== 1) return result(STATUS.UNVERIFIABLE, "UNSUPPORTED_VERIFICATION_VERSION");

  const question = isObject(dossier.question) ? dossier.question : {};
  const spec = Object.hasOwn(VERIFIABLE, question.id) ? VERIFIABLE[question.id] : null;
  if (!spec || question.registered_shape !== question.id) return result(STATUS.UNVERIFIABLE, "UNSUPPORTED_QUESTION", String(question.id));
  const outcome = isObject(dossier.outcome) ? dossier.outcome : {};
  if (outcome.status !== "ANSWERED" || !isObject(outcome.evidence)) return result(STATUS.UNVERIFIABLE, "UNSUPPORTED_OUTCOME", String(outcome.status));
  const params = question.parameters;
  if (!isObject(params) || !same(Object.keys(params), ["code"]) || typeof params.code !== "string" || !params.code) {
    return result(STATUS.UNVERIFIABLE, "UNSUPPORTED_PARAMETERS");
  }
  if (v.reader !== spec.reader) return result(STATUS.UNVERIFIABLE, "UNSUPPORTED_READER", String(v.reader));
  const applied = outcome.evidence.applied;
  if (!isObject(applied)) return result(STATUS.UNVERIFIABLE, "NO_APPLIED_RECORD");
  if (applied.reader !== spec.reader || applied.artifact !== spec.appliedArtifact || outcome.evidence.sourceId !== spec.sourceId) {
    return result(STATUS.UNVERIFIABLE, "UNSUPPORTED_ARTIFACT_PATH", String(applied.artifact));
  }
  const declared = Array.isArray(v.artifacts) ? v.artifacts : [];
  if (!same(declared.map((a) => (isObject(a) ? a.path : null)), spec.artifacts)) {
    return result(STATUS.UNVERIFIABLE, "UNSUPPORTED_ARTIFACT_PATH", "declared artifact list is not the closed list");
  }
  if (!Array.isArray(v.code) || !same(v.code, spec.code)) return result(STATUS.UNVERIFIABLE, "UNSUPPORTED_CODE_PATH");
  if (typeof v.commit !== "string" || !HEX40.test(v.commit)) return result(STATUS.UNVERIFIABLE, "MALFORMED_VERIFICATION_RECORD", "commit");

  if (!provider.commitExists(v.commit)) return result(STATUS.UNVERIFIABLE, "COMMIT_NOT_AVAILABLE", v.commit);
  const bytesByPath = {};
  for (const file of spec.artifacts) {
    const bytes = provider.readArtifact(v.commit, file);
    if (!bytes) return result(STATUS.UNVERIFIABLE, "ARTIFACT_MISSING", file);
    bytesByPath[file] = bytes;
  }
  for (const entry of declared) {
    const actual = provider.sha256Hex(bytesByPath[entry.path]);
    if (actual !== entry.sha256) return result(STATUS.MISMATCH, "FINGERPRINT_MISMATCH", `${entry.path}: declared ${entry.sha256}, git has ${actual}`);
  }
  for (const file of spec.code) {
    const ok = provider.codeMatchesCommit(v.commit, file);
    if (ok === null) return result(STATUS.UNVERIFIABLE, "CODE_IDENTITY_UNDETERMINED", file);
    if (ok === false) return result(STATUS.UNVERIFIABLE, "CODE_VERSION_DIFFERS", `${file}: check out ${v.commit} to verify`);
  }

  let registryJson;
  let state;
  try {
    registryJson = JSON.parse(bytesByPath["data/source_registry.json"].toString("utf8"));
    state = JSON.parse(bytesByPath["data/planning/madrid_ambito_state.json"].toString("utf8"));
  } catch {
    return result(STATUS.UNVERIFIABLE, "ARTIFACT_UNPARSEABLE");
  }
  // Re-derivation goes through the REAL registry resolver, with the pure reader
  // `developmentState(code, artifact)` the `applied` record names.
  const planningIndex = { developmentState: (code) => developmentState(code, state) };
  const registry = R.createEvidenceRegistry({ registry: registryJson, planningIndex, planningModule: { AVAILABILITY } });
  const rederived = registry.query("AMBITO_PHASES", { code: params.code });
  if (!rederived || rederived.kind !== "EVIDENCE") {
    return result(STATUS.MISMATCH, "REDERIVATION_ABSTAINED", "the dossier asserts a value the identified artifacts do not support");
  }
  const { kind: _kind, ...expected } = rederived;
  const differing = [...new Set([...Object.keys(expected), ...Object.keys(outcome.evidence)])]
    .filter((key) => canonical(expected[key]) !== canonical(outcome.evidence[key]));
  if (differing.length) return result(STATUS.MISMATCH, "VALUE_MISMATCH", `differs in: ${differing.join(", ")}`);
  return result(STATUS.VERIFIED, "REDERIVED_EQUAL", `${spec.reader}(${params.code}) over ${spec.artifacts.length} artifacts at ${v.commit}`);
}

// ------------------------------------------------------------------------- CLI

const EXIT = { VERIFIED: 0, MISMATCH: 1, UNVERIFIABLE: 2 };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const repoAt = args.indexOf("--repo");
  const repo = repoAt >= 0 ? path.resolve(args[repoAt + 1] || ".") : ROOT;
  const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--repo");
  if (!file) { console.error("usage: node scripts/dossier_verify.mjs <dossier.json> [--repo <git-dir>]"); process.exit(2); }
  let dossier = null;
  try { dossier = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* reported below */ }
  const outcome = dossier === null ? result(STATUS.UNVERIFIABLE, "MALFORMED_DOSSIER", "not readable JSON") : verifyDossier(dossier, gitProvider({ repo, codeRoot: ROOT }));
  console.log(`${outcome.status} ${outcome.reason}${outcome.detail ? ` — ${outcome.detail}` : ""}`);
  process.exit(EXIT[outcome.status]);
}
