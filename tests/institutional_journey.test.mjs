import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const journey = require("../js/institutional-journey.js");

test("Institutional Journey V1 pins one real, bilingual and scope-disciplined case", () => {
  assert.equal(journey.CASE_ID, "yeserias");
  assert.deepEqual(journey.CASE.primary, {
    code: "APE.02.20", name: "CÁRCEL DE YESERÍAS", lat: 40.395543, lon: -3.691757, radiusM: 900,
  });
  assert.equal(journey.CASE.comparator.code, "APE.02.12");
  for (const language of ["en", "es"]) {
    assert.equal(journey.COPY[language].steps.length, 4);
    const all = journey.COPY[language].steps.map((step) => `${step.title} ${step.body} ${step.scope}`).join(" ");
    assert.match(all, /APE\.02\.20/);
    assert.match(all, /APE\.02\.12/);
    assert.match(all, language === "es" ? /Concedida no significa construida/ : /Granted is not built/);
    assert.doesNotMatch(all, /progress score|índice de progreso|tourist pressure|presión turística/i);
  }
});
