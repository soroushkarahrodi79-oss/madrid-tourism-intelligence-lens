import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const textSize = require("../js/text-size.js");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
const shell = readFileSync(new URL("../js/shell-copy.js", import.meta.url), "utf8");

test("text-size preference accepts only normal, comfortable and large", () => {
  assert.deepEqual([...textSize.VALID_PREFERENCES], ["normal", "comfortable", "large"]);
  for (const value of textSize.VALID_PREFERENCES) assert.equal(textSize.normalizePreference(value), value);
  for (const value of ["huge", "112", "", null, undefined]) assert.equal(textSize.normalizePreference(value), "normal");
});

test("storage failures and invalid saved values fall back to normal without throwing", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(textSize.safeRead(broken), "normal");
  assert.doesNotThrow(() => textSize.safeWrite(broken, "large"));
  assert.equal(textSize.safeRead({ getItem: () => "garbage" }), "normal");
  assert.equal(textSize.safeRead(null), "normal");
});

test("the stylesheet keeps one bounded multiplier per step and seven rem tokens", () => {
  assert.match(css, /html\{font-size:calc\(100% \* var\(--text-scale,1\)\)\}/);
  assert.match(css, /:root\[data-text-size="comfortable"\]\{--text-scale:1\.12\}/);
  assert.match(css, /:root\[data-text-size="large"\]\{--text-scale:1\.25\}/);
  assert.doesNotMatch(css, /(?:^|[;{\s])zoom\s*:/m);
  assert.doesNotMatch(css, /transform\s*:\s*scale\(var\(--text-scale/);
});

test("the pre-paint resolver, control, script and localized copy are wired", () => {
  assert.ok(html.indexOf("madrid-lens-text-size") < html.indexOf('<link rel="stylesheet"'));
  assert.match(html, /<select id="textSizeSelect"/);
  assert.ok(html.indexOf('id="basemapSelect"') < html.indexOf('id="textSizeSelect"'));
  assert.ok(html.indexOf('id="textSizeSelect"') < html.indexOf('id="boundarySelect"'));
  assert.match(html, /js\/text-size\.js\?v=20261102-textsize-v1/);
  assert.match(html, /css\/app\.css\?v=20261102-textsize-v1/);
  for (const key of ["textSize.label", "textSize.normal", "textSize.comfortable", "textSize.large"]) {
    assert.equal(shell.split(`"${key}"`).length - 1, 2, `${key} exists in EN and ES`);
  }
});
