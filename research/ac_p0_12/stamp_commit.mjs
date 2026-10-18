// AC-P0-12 runner — write the test commit SHA next to the runner so the browser
// page can stamp every evidence JSON with the exact commit it measured. Run it
// once (from the repo root) before serving:  node research/ac_p0_12/stamp_commit.mjs
// TEST-ONLY. It writes a single untracked file, research/ac_p0_12/commit.json.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
function git(args) {
  try { return execSync(`git ${args}`, { encoding: "utf8" }).trim(); } catch (e) { return null; }
}
const sha = git("rev-parse HEAD");
const branch = git("rev-parse --abbrev-ref HEAD");
const describe = git("describe --always --dirty");
const dirty = git("status --porcelain") ? true : false;
const out = { sha, branch, describe, dirty, stampedAt: new Date().toISOString() };
const path = join(here, "commit.json");
writeFileSync(path, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${path}`);
console.log(JSON.stringify(out, null, 2));
if (dirty) console.warn("WARNING: working tree is dirty — the measured app may not match this commit exactly.");
