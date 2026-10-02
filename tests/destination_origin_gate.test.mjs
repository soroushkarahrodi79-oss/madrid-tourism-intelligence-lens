import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const gate = fs.readFileSync(new URL("../docs/DESTINATION_ORIGIN_GATE_H.md", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");

test("Gate H authorizes domestic origin only at municipality level", () => {
  assert.match(gate, /H-A DOMESTIC = GO via INE direct workbook/);
  assert.match(gate, /dest_cod == "28079"/);
  assert.match(gate, /No international-origin production UI is authorized yet/);
  assert.match(gate, /H-B INTERNATIONAL HOLD \/ WATCH/);
});

test("Gate H preserves suppression semantics", () => {
  assert.match(gate, /more than 30 tourists/i);
  assert.match(gate, /absent origin-destination row is \*\*not zero\*\*/i);
  assert.match(gate, /published origin set is incomplete by design/i);
});

test("Gate H does not leave temporary network probes in CI", () => {
  assert.doesNotMatch(workflow, /Probe Gate H/);
  assert.doesNotMatch(workflow, /probe_origin_sources\.py/);
});
