// Writes build-identity.json: the V2 verification record of THIS deployment.
//
// Usage: node scripts/write_build_identity.mjs <out.json>      (run in the deploy checkout)
//
// The static site carries no git identity of its own (AREA_ASSET_VERSION is a
// hand-edited cache label, not a commit). This is the only place a commit id and
// artifact fingerprints enter the deployed site, and they are produced by the SAME
// `buildVerificationRecord` the headless verifier uses, from git's object store at
// HEAD: nothing is typed in, guessed or hashed from a different source.
//
// Refuses (non-zero, writes nothing) unless the checkout's artifacts and the closed
// code set are byte-identical to HEAD. The browser treats an absent file as "no
// verifiable identity" and exports a plain V1 dossier, so refusing is always safe.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { VERIFIABLE, gitProvider, buildVerificationRecord } from "./dossier_verify.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2];
if (!out) { console.error("usage: node scripts/write_build_identity.mjs <out.json>"); process.exit(2); }

const spec = VERIFIABLE.AMBITO_PHASES;
const provider = gitProvider({ repo: ROOT, codeRoot: ROOT });
const commit = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

for (const file of spec.artifacts) {
  const committed = provider.readArtifact(commit, file);
  const working = fs.existsSync(path.join(ROOT, file)) ? fs.readFileSync(path.join(ROOT, file)) : null;
  if (!committed || !working || provider.sha256Hex(committed) !== provider.sha256Hex(working)) {
    console.error(`DIRTY_TREE: ${file} differs from ${commit}; no build identity written`);
    process.exit(1);
  }
}
for (const file of spec.code) {
  if (provider.codeMatchesCommit(commit, file) !== true) {
    console.error(`DIRTY_TREE: ${file} differs from ${commit}; no build identity written`);
    process.exit(1);
  }
}

fs.writeFileSync(out, `${JSON.stringify(buildVerificationRecord(provider, commit), null, 2)}\n`, "utf8");
console.log(`wrote ${out} for ${commit}`);
