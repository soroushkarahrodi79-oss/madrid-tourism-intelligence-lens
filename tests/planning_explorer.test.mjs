import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createPlanningIndex } from "../js/planning-ambito.js";
import { EXPLORER_RESULT_LIMIT, planningEvidenceEditions, searchPlanningAmbitos } from "../js/planning-explorer.js";

const geometry = JSON.parse(fs.readFileSync(new URL("../data/planning/madrid_ambitos.geojson", import.meta.url), "utf8"));
const state = JSON.parse(fs.readFileSync(new URL("../data/planning/madrid_ambito_state.json", import.meta.url), "utf8"));
const index = createPlanningIndex({ geometry, state });

test("explorer accepts only an exact official code", () => {
  const code = "APR.02.09";
  assert.deepEqual(searchPlanningAmbitos(index, code).results.map((entry) => entry.code), [code]);
  assert.equal(searchPlanningAmbitos(index, code.toLowerCase()).state, "not_found");
  assert.equal(searchPlanningAmbitos(index, ` ${code}`).state, "not_found");
  assert.equal(searchPlanningAmbitos(index, "APR.02.09-RP").state, "not_found");
});

test("explorer offers denomination matches only from committed non-empty values", () => {
  const known = index.entries.find((entry) => entry.denomination && entry.denomination.length > 8);
  const query = known.denomination.slice(0, 8);
  const result = searchPlanningAmbitos(index, query);
  assert.equal(result.state, "results");
  assert.ok(result.results.some((entry) => entry.code === known.code));
  assert.ok(result.results.every((entry) => entry.denomination));
  assert.ok(result.results.length <= EXPLORER_RESULT_LIMIT);
});

test("explorer keeps empty, unavailable and unknown states distinct", () => {
  assert.equal(searchPlanningAmbitos(index, "").state, "empty");
  assert.equal(searchPlanningAmbitos(index, "NOT.A.REAL.CODE").state, "not_found");
  assert.equal(searchPlanningAmbitos(null, "APR.02.09").state, "unavailable");
});

test("explorer keeps development-state and buildability edition dates tied to their evidence families", () => {
  const editions = planningEvidenceEditions({ editions: {
    developmentState: { referenceDate: "2026-01-01" },
    availableBuildability: { referenceDate: "2025-07-01" },
  } });
  assert.deepEqual(editions, [
    { family: "developmentState", referenceDate: "2026-01-01" },
    { family: "availableBuildability", referenceDate: "2025-07-01" },
  ]);
  assert.deepEqual(planningEvidenceEditions({ editions: { developmentState: { referenceDate: "2026-01-01" } } }), [
    { family: "developmentState", referenceDate: "2026-01-01" },
  ]);
});
