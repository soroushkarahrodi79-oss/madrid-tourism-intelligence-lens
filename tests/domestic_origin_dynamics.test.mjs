import assert from "node:assert/strict";
import test from "node:test";
import { DYNAMICS_STATE, compareDomesticOriginMonths, previousCalendarMonth } from "../js/domestic-origin-dynamics.js";

const origin = (code, count) => ({ origin_municipality_code: code, origin_municipality_name: `Municipality ${code}`, origin_province_code: "01", origin_province_name: "Province", source_reported_tourists: count });
const index = (months, latest = "2026-07") => ({ byMonth: new Map(months), months: months.map(([month]) => month), latest });

test("resolves only the exact prior calendar month, including January", () => {
  assert.equal(previousCalendarMonth("2026-07"), "2026-06");
  assert.equal(previousCalendarMonth("2027-01"), "2026-12");
  assert.equal(previousCalendarMonth("invalid"), null);
  const model = compareDomesticOriginMonths(index([["2026-05", [origin("00001", 50)]], ["2026-07", [origin("00001", 55)]]]), "2026-07");
  assert.equal(model.state, DYNAMICS_STATE.NO_ADJACENT_PRIOR_MONTH);
  assert.equal(model.previousMonth, "2026-06");
});

test("classifies published sets and never turns missing rows into zero", () => {
  const model = compareDomesticOriginMonths(index([["2026-06", [origin("00001", 40), origin("00002", 100), origin("00003", 80)]], ["2026-07", [origin("00002", 120), origin("00003", 60), origin("00004", 90)]]]), "2026-07");
  assert.equal(model.state, DYNAMICS_STATE.AVAILABLE);
  assert.deepEqual(model.shared.map((row) => row.origin_municipality_code).sort(), ["00002", "00003"]);
  assert.deepEqual(model.newlyPresent.map((row) => row.origin_municipality_code), ["00004"]);
  assert.deepEqual(model.noLongerPresent.map((row) => row.origin_municipality_code), ["00001"]);
  assert.equal(model.newlyPresent[0].previousCount, null);
  assert.equal(model.newlyPresent[0].absoluteChange, null);
  assert.equal(model.newlyPresent[0].percentChange, null);
  assert.equal(model.noLongerPresent[0].currentCount, null);
  assert.equal(model.noLongerPresent[0].absoluteChange, null);
  assert.equal(model.noLongerPresent[0].percentChange, null);
});

test("calculates observed changes only for origins published in both months", () => {
  const model = compareDomesticOriginMonths(index([["2026-06", [origin("00002", 100), origin("00003", 80)]], ["2026-07", [origin("00002", 120), origin("00003", 60)]]]), "2026-07");
  const b = model.shared.find((row) => row.origin_municipality_code === "00002");
  const c = model.shared.find((row) => row.origin_municipality_code === "00003");
  assert.deepEqual({ previous: b.previousCount, current: b.currentCount, absolute: b.absoluteChange, percent: b.percentChange }, { previous: 100, current: 120, absolute: 20, percent: 20 });
  assert.deepEqual({ previous: c.previousCount, current: c.currentCount, absolute: c.absoluteChange, percent: c.percentChange }, { previous: 80, current: 60, absolute: -20, percent: -25 });
});

test("returns explicit unavailable, unavailable-month, empty-current and no-shared states", () => {
  assert.equal(compareDomesticOriginMonths(null, "2026-07").state, DYNAMICS_STATE.UNAVAILABLE);
  assert.equal(compareDomesticOriginMonths(index([["2026-06", []]], "2026-06"), "1999-01").state, DYNAMICS_STATE.MONTH_UNAVAILABLE);
  assert.equal(compareDomesticOriginMonths(index([["2026-06", [origin("00001", 45)]], ["2026-07", []]]), "2026-07").state, DYNAMICS_STATE.CURRENT_MONTH_EMPTY);
  assert.equal(compareDomesticOriginMonths(index([["2026-06", [origin("00001", 45)]], ["2026-07", [origin("00002", 55)]]]), "2026-07").state, DYNAMICS_STATE.NO_SHARED_ORIGINS);
});

test("comparison API has no spatial or Lens inputs", () => {
  assert.doesNotMatch(compareDomesticOriginMonths.toString().slice(0, compareDomesticOriginMonths.toString().indexOf(")") + 1).toLowerCase(), /\b(lat|lon|radius|lens|barrio|district)\b/);
});
