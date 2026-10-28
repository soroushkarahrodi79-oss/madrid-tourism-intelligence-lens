import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// File-level timings come from the successful origin/main run 40759479604.
// Longest-processing-time bin packing keeps the three shards within 3 seconds
// of one another without introducing concurrency inside any test file.
const SHARDS = Object.freeze({
  "1": [
    "browser-tests/light-contrast-ux-c1.browser.mjs",
    "browser-tests/evidence-url.browser.mjs",
    "browser-tests/urban-licences.browser.mjs",
    "browser-tests/mobility-extraction.browser.mjs",
    "browser-tests/institutional-journey.browser.mjs",
    "browser-tests/planning-explorer.browser.mjs",
    "browser-tests/ta4-map-chrome.browser.mjs",
    "browser-tests/tutorial.browser.mjs",
  ],
  "2": [
    "browser-tests/visual-language.browser.mjs",
    "browser-tests/information-architecture.browser.mjs",
    "browser-tests/mobile-layers-ux-h1-2.browser.mjs",
    "browser-tests/ambito-comparison.browser.mjs",
    "browser-tests/map-control-layout.browser.mjs",
    "browser-tests/scope-rail-compact.browser.mjs",
    "browser-tests/ta3-identity.browser.mjs",
    "browser-tests/rail-ambito-layout.browser.mjs",
    "discover/interaction.browser.mjs",
  ],
  "3": [
    "browser-tests/planning-ambito.browser.mjs",
    "browser-tests/radial-halo.browser.mjs",
    "browser-tests/appearance.browser.mjs",
    "browser-tests/k12-r1-thin.browser.mjs",
    "browser-tests/territorial-compact.browser.mjs",
    "browser-tests/p0a-staging-gate.browser.mjs",
    "browser-tests/header-ux-h1.browser.mjs",
    "discover/release-check.browser.mjs",
    "browser-tests/hospitality-fill-hold.browser.mjs",
  ],
});

const normalize = (value) => value.split(path.sep).join("/");
const sort = (values) => [...values].sort((a, b) => a.localeCompare(b));

function discoveredBrowserTests() {
  return sort([
    ...readdirSync(path.join(ROOT, "browser-tests"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".browser.mjs"))
      .map((entry) => `browser-tests/${entry.name}`),
    ...readdirSync(path.join(ROOT, "discover"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".browser.mjs"))
      .map((entry) => `discover/${entry.name}`),
  ]);
}

function verifyInventory() {
  const assigned = Object.values(SHARDS).flat().map(normalize);
  const discovered = discoveredBrowserTests();
  const duplicates = sort([...new Set(assigned.filter((file, index) => assigned.indexOf(file) !== index))]);
  const missing = discovered.filter((file) => !assigned.includes(file));
  const unexpected = sort(assigned.filter((file) => !discovered.includes(file)));

  if (duplicates.length || missing.length || unexpected.length) {
    const details = [
      duplicates.length ? `duplicate assignments: ${duplicates.join(", ")}` : null,
      missing.length ? `unassigned browser tests: ${missing.join(", ")}` : null,
      unexpected.length ? `assigned files not found on disk: ${unexpected.join(", ")}` : null,
    ].filter(Boolean);
    throw new Error(`Browser shard inventory mismatch\n${details.join("\n")}`);
  }

  console.log(`Browser shard inventory verified: ${discovered.length} files, ${assigned.length} assignments, 0 duplicates.`);
  for (const [shard, files] of Object.entries(SHARDS)) {
    console.log(`  shard ${shard}: ${files.length} files`);
  }
  return discovered;
}

function filesFor(selection) {
  if (selection === "all") return Object.values(SHARDS).flat();
  if (!Object.hasOwn(SHARDS, selection)) {
    throw new Error(`Unknown browser shard "${selection}"; expected one of ${Object.keys(SHARDS).join(", ")} or all.`);
  }
  return SHARDS[selection];
}

function run(selection) {
  verifyInventory();
  const files = filesFor(selection);
  console.log(`Running browser shard ${selection}: ${files.length} files`);
  for (const file of files) console.log(`  ${file}`);

  const result = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", ...files],
    { cwd: ROOT, env: process.env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

const [command = "verify", selection] = process.argv.slice(2);
if (command === "verify") {
  verifyInventory();
} else if (command === "run") {
  run(selection ?? "all");
} else {
  throw new Error(`Unknown command "${command}"; expected verify or run.`);
}

