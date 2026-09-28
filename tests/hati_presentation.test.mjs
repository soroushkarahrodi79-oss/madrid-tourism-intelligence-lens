import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("HATI is presented as research evidence, not an operational layer", () => {
  assert.match(html, /<h3>Operational layers<\/h3>/);
  assert.match(html, /Research evidence/);
  assert.match(html, /HATI · thermal pilot/);
  assert.doesNotMatch(html, />HATI UTCI samples</);
});

test("HATI behavior is unchanged in this presentation-only step", () => {
  assert.match(html, /data-layer="heat" type="checkbox" checked/);
  assert.match(html, /HATI UTCI is <b>model-derived<\/b>/);
});
