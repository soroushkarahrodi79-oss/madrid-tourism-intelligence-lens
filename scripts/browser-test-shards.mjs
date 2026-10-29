import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// File-level timings come from successful origin/main run 40759479604.
// Longest-processing-time bin packing keeps the original three historical
// loads within 3 seconds of one another without concurrency inside a test file.
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
    "browser-tests/geo-search.browser.mjs",
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

// PR #139 added one 10m30s Chromium file after the original calibration. Its
// test groups are partitioned by anchored names using timings from successful
// run 40779172501. Every process still runs serially in its own CI workspace.
// Expected TAP totals make a new, renamed, duplicated, or unassigned UX-C2 test
// fail closed instead of silently reducing coverage.
const UX_C2_FILE = "browser-tests/panel-containment-ux-c2.browser.mjs";
const UX_C2_CAPTURE_ONLY_TESTS = 1;
const UX_C2_PARTITIONS = Object.freeze({
  chromium: Object.freeze({
    registeredTests: 128,
    shards: Object.freeze({
      "1": Object.freeze({
        pattern: "^(?:real data, (?:light/ES|dark/(?:EN|ES)|system-light/(?:EN|ES))|touch \\(pointer:coarse\\)|reported iPad-landscape|the Planning ámbitos list|opening Detail)",
        expectedPass: 42,
      }),
      "2": Object.freeze({
        pattern: "^(?:fallback font|classic scrollbars|evidence drawer)",
        expectedPass: 41,
      }),
      "3": Object.freeze({
        pattern: "^(?:real data, Light/EN|licence and hospitality layers on|long-content stress fixture|panel at its)",
        expectedPass: 44,
      }),
    }),
  }),
  webkit: Object.freeze({
    registeredTests: 125,
    shards: Object.freeze({
      "1": Object.freeze({
        pattern: "^(?:fallback font|long-content stress fixture \\(en\\)|reported iPad-landscape|the Planning ámbitos list|opening Detail)",
        expectedPass: 39,
      }),
      "2": Object.freeze({
        pattern: "^(?:real data, (?:light/ES|dark/(?:EN|ES)|system-light/(?:EN|ES))|licence and hospitality layers on|long-content stress fixture \\(es\\))",
        expectedPass: 43,
      }),
      "3": Object.freeze({
        pattern: "^(?:touch \\(pointer:coarse\\)|real data, Light/EN|evidence drawer|panel at its)",
        expectedPass: 42,
      }),
    }),
  }),
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
  const assigned = [...Object.values(SHARDS).flat(), UX_C2_FILE].map(normalize);
  const discovered = discoveredBrowserTests();
  const duplicates = sort([...new Set(assigned.filter((file, index) => assigned.indexOf(file) !== index))]);
  const missing = discovered.filter((file) => !assigned.includes(file));
  const unexpected = sort(assigned.filter((file) => !discovered.includes(file)));

  const partitionProblems = Object.entries(UX_C2_PARTITIONS).flatMap(([engine, config]) => {
    const passes = Object.values(config.shards).reduce((total, partition) => total + partition.expectedPass, 0);
    const keysMatch = Object.keys(config.shards).every((shard) => Object.hasOwn(SHARDS, shard));
    return passes + UX_C2_CAPTURE_ONLY_TESTS === config.registeredTests && keysMatch
      ? []
      : [`${engine} UX-C2 partitions cover ${passes} asserted + ${UX_C2_CAPTURE_ONLY_TESTS} capture-only tests; expected ${config.registeredTests}`];
  });

  if (duplicates.length || missing.length || unexpected.length || partitionProblems.length) {
    const details = [
      duplicates.length ? `duplicate assignments: ${duplicates.join(", ")}` : null,
      missing.length ? `unassigned browser tests: ${missing.join(", ")}` : null,
      unexpected.length ? `assigned files not found on disk: ${unexpected.join(", ")}` : null,
      ...partitionProblems,
    ].filter(Boolean);
    throw new Error(`Browser shard inventory mismatch\n${details.join("\n")}`);
  }

  console.log(`Browser shard inventory verified: ${discovered.length} files, ${assigned.length} assignments, 0 duplicates.`);
  for (const [shard, files] of Object.entries(SHARDS)) {
    const chromium = UX_C2_PARTITIONS.chromium.shards[shard].expectedPass;
    const webkit = UX_C2_PARTITIONS.webkit.shards[shard].expectedPass;
    console.log(`  shard ${shard}: ${files.length} whole files + UX-C2 partitions (${chromium} Chromium / ${webkit} WebKit asserted tests)`);
  }
  return discovered;
}

function filesFor(selection) {
  if (selection === "all") return [...Object.values(SHARDS).flat(), UX_C2_FILE];
  if (!Object.hasOwn(SHARDS, selection)) {
    throw new Error(`Unknown browser shard "${selection}"; expected one of ${Object.keys(SHARDS).join(", ")} or all.`);
  }
  return SHARDS[selection];
}

function runNodeTests(args, options = {}) {
  const captured = Boolean(options.captureOutput);
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", ...args],
    captured
      ? { cwd: ROOT, env: process.env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
      : { cwd: ROOT, env: process.env, stdio: "inherit" },
  );
  if (captured) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
  }
  if (result.error) throw result.error;
  return result;
}

function lastTapCount(output, label) {
  const matches = [...output.matchAll(new RegExp(`^# ${label} (\\d+)$`, "gm"))];
  return matches.length ? Number(matches.at(-1)[1]) : null;
}

function runUxC2Partition(selection, engine) {
  const config = UX_C2_PARTITIONS[engine];
  if (!config) throw new Error(`Unknown UX-C2 browser engine "${engine}"; expected chromium or webkit.`);
  const partition = config.shards[selection];
  if (!partition) throw new Error(`Unknown UX-C2 ${engine} shard "${selection}"; expected 1, 2, or 3.`);
  console.log(`Running UX-C2 ${engine} partition ${selection}: ${partition.pattern}`);
  const result = runNodeTests([`--test-name-pattern=${partition.pattern}`, UX_C2_FILE], { captureOutput: true });
  if ((result.status ?? 1) !== 0) return result.status ?? 1;

  const tests = lastTapCount(result.stdout, "tests");
  const passed = lastTapCount(result.stdout, "pass");
  const failed = lastTapCount(result.stdout, "fail");
  const skipped = lastTapCount(result.stdout, "skipped");
  const expectedSkipped = config.registeredTests - partition.expectedPass;
  if (tests !== config.registeredTests || passed !== partition.expectedPass || failed !== 0 || skipped !== expectedSkipped) {
    throw new Error(
      `UX-C2 ${engine} partition ${selection} inventory mismatch: tests=${tests}, pass=${passed}, fail=${failed}, skipped=${skipped}; ` +
      `expected tests=${config.registeredTests}, pass=${partition.expectedPass}, fail=0, skipped=${expectedSkipped}`,
    );
  }
  console.log(`UX-C2 ${engine} partition ${selection} verified: ${passed} asserted, ${skipped} assigned elsewhere/capture-only.`);
  return 0;
}

function run(selection) {
  verifyInventory();
  const files = filesFor(selection);
  console.log(`Running browser shard ${selection}: ${files.length} files`);
  for (const file of files) console.log(`  ${file}`);

  const result = runNodeTests(files);
  if ((result.status ?? 1) !== 0 || selection === "all") {
    process.exitCode = result.status ?? 1;
    return;
  }
  process.exitCode = runUxC2Partition(selection, "chromium");
}

const [command = "verify", selection] = process.argv.slice(2);
if (command === "verify") {
  verifyInventory();
} else if (command === "run") {
  run(selection ?? "all");
} else if (command === "run-ux-c2") {
  verifyInventory();
  runUxC2Partition(selection, process.env.UXC2_BROWSER || "chromium");
} else {
  throw new Error(`Unknown command "${command}"; expected verify, run, or run-ux-c2.`);
}
