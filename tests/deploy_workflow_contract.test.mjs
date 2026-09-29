// Contract tests for the Pages deploy workflow's ordering and step conditions.
//
// The guarantees asserted here are the ones that keep a degraded build off the
// public site and keep a failed build auditable. They are easy to delete by
// accident while editing YAML, so they are pinned.
//
// The workflow is parsed into an ordered list of steps rather than regex-matched
// as text, so the assertions survive reformatting, comment changes and key
// reordering. No YAML dependency: only the small subset this file uses is read.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function parseSteps(yaml) {
  const lines = yaml.split(/\r?\n/);
  const steps = [];
  let current = null;
  let stepIndent = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const item = line.match(/^(\s*)-\s+(.*)$/);
    // A step begins at the first "- " encountered inside the steps: block, and
    // every later "- " at that same indentation is a sibling step.
    if (item && (stepIndent === null || item[1].length === stepIndent)) {
      const looksLikeStep = /^(name|uses|id|if|run|with|env):/.test(item[2]);
      if (looksLikeStep) {
        if (stepIndent === null) stepIndent = item[1].length;
        current = {};
        steps.push(current);
        const [key, ...rest] = item[2].split(":");
        current[key.trim()] = rest.join(":").trim();
        continue;
      }
    }

    if (!current) continue;

    const keyIndent = stepIndent + 2;
    const key = line.match(/^\s*([\w-]+):\s*(.*)$/);
    if (key && line.search(/\S/) === keyIndent) {
      // A block scalar ("run: |") keeps its body on the following, more-indented
      // lines; gather them so `run` holds the actual commands.
      if (key[2] === "|" || key[2] === ">") {
        current[key[1]] = { block: true, lines: [] };
      } else {
        current[key[1]] = key[2];
      }
      current.__lastKey = key[1];
      continue;
    }

    const lastKey = current.__lastKey;
    const holder = lastKey ? current[lastKey] : null;
    if (holder && typeof holder === "object" && holder.block && line.search(/\S/) > keyIndent) {
      holder.lines.push(line.trim());
    }
  }

  // Flatten gathered block scalars and drop the bookkeeping key.
  for (const step of steps) {
    delete step.__lastKey;
    for (const [key, value] of Object.entries(step)) {
      if (value && typeof value === "object" && value.block) step[key] = value.lines.join("\n");
    }
  }
  return steps;
}

const workflow = fs.readFileSync(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
const steps = parseSteps(workflow);

function indexOfStep(predicate, label) {
  const index = steps.findIndex(predicate);
  assert.notEqual(index, -1, `deploy workflow has no ${label} step`);
  return index;
}

const buildAt = indexOfStep((s) => s.name === "Build deployment spatial snapshots", "data build");
const validateAt = indexOfStep((s) => s.name === "Validate deployment evidence integrity", "evidence validation");
const auditAt = indexOfStep((s) => s.name === "Upload deployment evidence audit", "audit upload");
const configureAt = indexOfStep((s) => (s.uses ?? "").startsWith("actions/configure-pages"), "configure-pages");
const uploadPagesAt = indexOfStep((s) => (s.uses ?? "").startsWith("actions/upload-pages-artifact"), "upload-pages-artifact");
const deployAt = indexOfStep((s) => (s.uses ?? "").startsWith("actions/deploy-pages"), "deploy-pages");

test("the workflow parser found a plausible step list", () => {
  // Guards the parser itself: if it silently matched nothing, every ordering
  // assertion below would pass vacuously.
  assert.ok(steps.length >= 8, `expected at least 8 steps, parsed ${steps.length}`);
  assert.ok(steps.some((s) => (s.uses ?? "").startsWith("actions/checkout")));
});

test("validation runs after the build and before anything that publishes", () => {
  assert.ok(buildAt < validateAt, "validation must run after the data build");
  assert.ok(validateAt < configureAt, "validation must run before configure-pages");
  assert.ok(validateAt < uploadPagesAt, "validation must run before the site artifact is uploaded");
  assert.ok(validateAt < deployAt, "validation must run before deployment");
});

test("validation invokes the single deterministic validator", () => {
  assert.match(steps[validateAt].run ?? "", /node scripts\/validate_deployment\.mjs/);
});

test("a failed build still runs the validator, so a build failure is auditable", () => {
  const condition = steps[validateAt].if ?? "";
  assert.match(
    condition,
    /!\s*cancelled\(\)/,
    "the validate step needs a !cancelled() condition, or GitHub Actions skips it after a failed build and no manifest is written"
  );
});

test("the validator is told the build step's outcome", () => {
  // Without this, artifacts left behind by a partially successful build could
  // validate cleanly and the manifest would not record that the build failed.
  assert.equal(steps[buildAt].id, "build", "the build step needs an id so its outcome can be referenced");
  assert.match(workflow, /DEPLOYMENT_BUILD_OUTCOME:\s*\$\{\{\s*steps\.build\.outcome\s*\}\}/);
});

test("the audit artifact is uploaded even when the build or validation failed", () => {
  const condition = steps[auditAt].if ?? "";
  assert.match(condition, /!\s*cancelled\(\)|always\(\)/);
  assert.ok(auditAt > validateAt, "the audit upload must run after validation so it captures the manifest");
  assert.ok(auditAt < configureAt, "the audit upload must run before the CARTO key is injected");
});

test("publishing steps carry no condition, so any earlier failure skips them", () => {
  // This is what makes a failed build or a failed validation non-deployable:
  // GitHub Actions skips unconditioned steps once the job is failing.
  for (const [index, label] of [
    [configureAt, "configure-pages"],
    [uploadPagesAt, "upload-pages-artifact"],
    [deployAt, "deploy-pages"],
  ]) {
    assert.equal(
      steps[index].if,
      undefined,
      `${label} must not carry an if: condition, or a failed build could become deployable`
    );
  }
});

test("no step uses continue-on-error", () => {
  // Setting it on the build step would mark a failed build successful and could
  // turn it into a published deployment. Asserted against parsed steps rather
  // than the file text, so the explanatory comment naming it does not count.
  for (const step of steps) {
    assert.equal(
      step["continue-on-error"],
      undefined,
      `no deploy step may set continue-on-error (found on "${step.name ?? step.uses}")`
    );
  }
});

test("the CARTO secret is injected after the audit upload and never archived", () => {
  const injectAt = indexOfStep((s) => s.name === "Inject CARTO basemap key", "CARTO key injection");
  assert.ok(injectAt > auditAt, "the secret must not be present on disk when the audit artifact is collected");

  const auditStep = workflow.slice(workflow.indexOf("Upload deployment evidence audit"), workflow.indexOf("configure-pages"));
  assert.doesNotMatch(auditStep, /runtime-config/, "the audit artifact must not archive the injected runtime config");
  assert.doesNotMatch(auditStep, /CARTO/);
});

test("the deployment build still runs all three builders", () => {
  const run = steps[buildAt].run ?? "";
  assert.match(run, /node scripts\/build_runtime_poi\.mjs/);
  assert.match(run, /scripts\/fill_stays_from_esmadrid\.py/);
  assert.match(run, /scripts\/build_pedestrian_activity\.py/);
});
