import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

const TYPE_TOKENS = Object.freeze({
  display: "28px",
  title: "20px",
  figure: "16px",
  body: "14px",
  label: "12px",
  meta: "11px",
  micro: "10px",
});

test("K5 stylesheet declares exactly the seven fixed type tokens", () => {
  const declarations = [...withoutComments.matchAll(/--t-([\w-]+)\s*:\s*([^;]+);/g)]
    .map((match) => [match[1], match[2].trim()]);
  assert.deepEqual(Object.fromEntries(declarations), TYPE_TOKENS);
});

test("K5 every production font-size declaration uses the type scale with zero exceptions", () => {
  const declarations = [...withoutComments.matchAll(/font-size\s*:\s*([^;}]+)/g)].map((match) => match[1].trim());
  assert.ok(declarations.length > 100, "the whole production stylesheet was audited");
  for (const value of declarations) {
    assert.match(value, /^var\(--t-(?:display|title|figure|body|label|meta|micro)\)(?:\s*!important)?$/);
  }
  assert.doesNotMatch(withoutComments, /font\s*:[^;}]*\b\d+(?:\.\d+)?px\b/i, "font shorthand may not bypass the scale");
  assert.equal([...withoutComments.matchAll(/font-size\s*:\s*\d/gi)].length, 0, "literal font-size allowlist is empty");
});

test("K5 breakpoints change layout, never per-surface typography", () => {
  for (const block of mediaBlocks(withoutComments)) {
    assert.doesNotMatch(block.body, /font-size\s*:/, `${block.query} contains a per-surface font-size override`);
  }
});

test("K5 exposes exactly four spacing and two radius tokens", () => {
  const spacing = [...withoutComments.matchAll(/--s-([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);
  const radii = [...withoutComments.matchAll(/--r-([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);
  assert.deepEqual(spacing, [["1", "4px"], ["2", "8px"], ["3", "12px"], ["4", "16px"]]);
  assert.deepEqual(radii, [["small", "8px"], ["large", "16px"]]);
});

test("K5 spacing literals are limited to explicit geometry categories", () => {
  const literals = cssDeclarations(withoutComments).filter(({ property, value }) =>
    /^(?:margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|gap|row-gap|column-gap)$/.test(property) && /-?\d+(?:\.\d+)?px\b/.test(value),
  );
  const failures = literals.map((declaration) => ({ ...declaration, classification: classifySpacingGeometry(declaration) || "APPLICATION_LAYOUT" }))
    .filter(({ classification }) => classification === "APPLICATION_LAYOUT");
  assert.deepEqual(failures, [], formatViolations("UNAPPROVED_LAYOUT_LITERAL", failures));
});

test("K5 application surfaces use radius tokens; only explicit geometric radii remain literal", () => {
  const literals = cssDeclarations(withoutComments).filter(({ property, value }) =>
    property === "border-radius" && /(?:\d+(?:\.\d+)?px|\d+(?:\.\d+)?%)/.test(value) && !/^var\(--r-(?:small|large)\)$/.test(value),
  );
  const failures = literals.map((declaration) => ({ ...declaration, classification: classifyRadiusGeometry(declaration) || "APPLICATION_SURFACE" }))
    .filter(({ classification }) => classification === "APPLICATION_SURFACE");
  assert.deepEqual(failures, [], formatViolations("UNAPPROVED_SURFACE_RADIUS", failures));
});

test("K5 judgement-bearing concepts use no success, error or warning colour convention", () => {
  const forbidden = /\b(?:success|error|warning|danger|positive|negative|good|bad|stale|fresh|ahead|behind|delayed|complete)[\w-]*\b|var\(--(?:green|heat|activity)\)/i;
  for (const [, selectors, declarations] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(?:phase|freshness|change|edition(?:-age)?)/i.test(selectors)) continue;
    assert.doesNotMatch(declarations, forbidden, `judgement colour in ${selectors.trim()}`);
  }
  assert.doesNotMatch(withoutComments, /--planning-[\w-]*(?:success|error|warning|complete|progress|order)/i);
});

test("K5 reserves a neutral planning family without borrowing Lens A/B", () => {
  const value = (name) => new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(withoutComments)?.[1].trim().toLowerCase();
  const lens = new Set([value("a"), value("b")]);
  for (const token of ["planning-neutral", "planning-origin", "planning-unresolved"]) {
    assert.ok(value(token), `${token} exists`);
    assert.equal(lens.has(value(token)), false, `${token} does not reuse Lens A/B`);
  }
  assert.match(css, /separate from Lens A\/B and carries no order, progress or judgement/);
});

test("K5 static inline presentation moved to classes; only dynamic bar widths remain", () => {
  const styles = [...html.matchAll(/style="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(styles.length, 4);
  for (const style of styles) assert.match(style, /^width:0%$/);
  assert.doesNotMatch(html, /style="[^"]*(?:color|background|border-radius|font)/i);
});

test("K5 adds no rendering dependency", () => {
  assert.deepEqual(Object.keys(pkg.dependencies || {}), []);
  assert.deepEqual(Object.keys(pkg.devDependencies || {}), ["playwright"]);
});

function mediaBlocks(source) {
  const blocks = [];
  let index = source.indexOf("@media");
  while (index !== -1) {
    const open = source.indexOf("{", index);
    let depth = 1;
    let cursor = open + 1;
    while (depth && cursor < source.length) {
      if (source[cursor] === "{") depth += 1;
      if (source[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    blocks.push({ query: source.slice(index, open).trim(), body: source.slice(open + 1, cursor - 1) });
    index = source.indexOf("@media", cursor);
  }
  return blocks;
}

function cssDeclarations(source) {
  const declarations = [];
  for (const [, selector, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const declaration of body.split(";")) {
      const match = /^\s*([\w-]+)\s*:\s*([\s\S]*?)\s*$/.exec(declaration);
      if (match) declarations.push({ selector: selector.trim(), property: match[1], value: match[2].trim() });
    }
  }
  return declarations;
}

function classifySpacingGeometry({ selector, property, value }) {
  const rules = [
    { category: "LEAFLET_GEOMETRY", selector: /^\.leaflet-control-attribution$/, property: "padding", value: /^2px 5px!important$/ },
    { category: "LEAFLET_GEOMETRY", selector: /^\.leaflet-tooltip$/, property: "padding", value: /^7px 9px$/ },
    { category: "ACCESSIBILITY_CLIPPING_GEOMETRY", selector: /^\.sr-only$/, property: "margin", value: /^-1px$/ },
  ];
  return rules.find((rule) => rule.selector.test(selector) && rule.property === property && rule.value.test(value))?.category;
}

function classifyRadiusGeometry({ selector, value }) {
  const rules = [
    { category: "CIRCLE_GEOMETRY", selector: /^\.(?:dot|marker-center|poi-cluster|evidence-link)$|^\.live i$|^\.switch span:after$/, value: /^50%$/ },
    { category: "PILL_GEOMETRY", selector: /^(?:\.activity-divider small,\.context-divider small,\.research-divider small|\.hospitality-scale|\.live|\.cb-lock|\.area-label)$/, value: /^999px$/ },
    { category: "LEAFLET_GEOMETRY", selector: /^\.leaflet-control-attribution$/, value: /^7px$/ },
    { category: "LEAFLET_GEOMETRY", selector: /^\.leaflet-tooltip$/, value: /^10px$/ },
    { category: "LOGO_GEOMETRY", selector: /^\.logo:before,\.logo:after$/, value: /^5px 1px 5px 5px$/ },
    { category: "SWITCH_GEOMETRY", selector: /^\.switch span$/, value: /^(?:10|14)px$/ },
    { category: "TRACK_GEOMETRY", selector: /^\.heat-scale$/, value: /^6px$/ },
    { category: "RESIZE_HANDLE_GEOMETRY", selector: /^\.panel-resize-handle:before,\.panel-resize-handle:after$/, value: /^0 0 0 3px$/ },
    { category: "RESIZE_HANDLE_GEOMETRY", selector: /^\.panel-resize-handle:focus-visible$/, value: /^5px$/ },
    { category: "SCROLLBAR_GEOMETRY", selector: /^\.panel::-webkit-scrollbar-thumb$/, value: /^9px$/ },
    { category: "BAR_GEOMETRY", selector: /^\.bar$|^\.bar i$/, value: /^6px$/ },
    { category: "CHART_MARK_GEOMETRY", selector: /^\.destination-compbar$/, value: /^3px$/ },
  ];
  return rules.find((rule) => rule.selector.test(selector) && rule.value.test(value))?.category;
}

function formatViolations(code, failures) {
  return failures.map(({ selector, property, value, classification }) =>
    `${code}: ${selector} ${property}: ${value} [${classification}]`,
  ).join("\n");
}
