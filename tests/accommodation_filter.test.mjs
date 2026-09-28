import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { filterPoiPointsByStayKind } from "../js/accommodation.js";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

test("accommodation filter preserves non-stay layers and filters only stays", () => {
  const points = [
    { id: "m1", type: "museum" },
    { id: "h1", type: "stay", stayKind: "hotel" },
    { id: "a1", type: "stay", stayKind: "apartment" },
    { id: "b1", type: "bike" },
  ];
  const filtered = filterPoiPointsByStayKind(points, "hotel");
  assert.deepEqual(filtered.map((p) => p.id), ["m1", "h1", "b1"]);
});

test("all accommodation leaves the source point array unchanged", () => {
  const points = [{ type: "stay", stayKind: "hotel" }, { type: "stay" }];
  assert.equal(filterPoiPointsByStayKind(points, "all"), points);
});

test("UI exposes bounded source-derived accommodation families", () => {
  for (const kind of ["hotel", "hostal", "apartment", "hostel", "guest", "residence", "camping", "other"]) {
    assert.match(html, new RegExp(`data-kind="${kind}"`));
  }
});

test("lens statistics and stay rendering use the same active accommodation filter", () => {
  assert.match(app, /return filterPoiPointsByStayKind\(poiPoints, stayKindFilter\)/);
  assert.match(app, /return poiStatsInLens\(visiblePoiPoints\(\), centerOf\(which\), radius\)/);
  assert.match(app, /const points = visiblePoiPoints\(\)\.filter\(\(p\) => p\.type === type\)/);
});

test("filter disables unavailable types instead of fabricating classifications", () => {
  assert.match(app, /option\.disabled = count === 0/);
  assert.match(app, /stayFilter\.disabled = stayKinds\.size === 0/);
});

test("accommodation filter helper and current app are cache-busted", () => {
  assert.match(html, /js\/accommodation\.js\?v=20260928-15/);
  assert.match(html, /js\/app\.js\?v=20260928-22/);
});
