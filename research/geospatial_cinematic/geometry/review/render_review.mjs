#!/usr/bin/env node
// Gate 4D visual review: renders the same crop as current / A / B / C from the same cameras and
// writes one PNG per variant and camera plus a labelled 2 x 2 comparison per camera.
//   node render_review.mjs --data <prep_review.py output> --package <Gate 4B package> --out <dir>
// Same local-server, sandbox and network-block rules as render.mjs. Writes stills only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { sceneFrame, groundScale } from '../../lib/geo.mjs';
import { verticalUnitsPerMetre } from '../../lib/surface.mjs';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ENGINE, 'package.json'));
const { chromium } = require('playwright');
const A = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith('--') ? [...acc, [v.slice(2), all[i + 1]]] : acc), []));
const data = path.resolve(A.data); const out = path.resolve(A.out); const pkgDir = path.resolve(A.package);
fs.mkdirSync(out, { recursive: true });
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'materialized-manifest.json'), 'utf8'));
const tex = pkg.frames.find((f) => f.coverage_id === '2023');
const meta = JSON.parse(fs.readFileSync(path.join(data, 'meta.json'), 'utf8'));
const frame = sceneFrame(pkg.spatial);
const zPerM = verticalUnitsPerMetre(groundScale(frame.centreLonLat[1]));
const W = 960; const H = 540;

const FILES = {
  '/review/review.html': path.join(ENGINE, 'geometry', 'review', 'review.html'),
  '/review/review.js': path.join(ENGINE, 'geometry', 'review', 'review.js'),
  '/lib/geo.mjs': path.join(ENGINE, 'lib', 'geo.mjs'),
  '/three.module.js': path.join(ENGINE, 'node_modules', 'three', 'build', 'three.module.js'),
  '/three.core.js': path.join(ENGINE, 'node_modules', 'three', 'build', 'three.core.js'),
  '/data/texture.jpg': path.join(pkgDir, tex.file),
  ...Object.fromEntries(['current_mds.f32', 'fine_mds.f32', 'fine_mdt.f32', 'parts.json'].map((f) => [`/data/${f}`, path.join(data, f)])),
};
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.jpg': 'image/jpeg', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const f = FILES[req.url.split('?')[0]];
  if (!f) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, chromiumSandbox: true, ignoreDefaultArgs: ['--enable-unsafe-swiftshader'], args: ['--use-angle=d3d11', '--force-color-profile=srgb'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const blocked = [];
await ctx.route('**/*', (r) => (r.request().url().startsWith(origin) ? r.continue() : (blocked.push(r.request().url()), r.abort())));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${origin}/review/review.html`);
await page.waitForFunction(() => typeof window.setupReview === 'function');
const t0 = Date.now();
const stats = await page.evaluate((cfg) => window.setupReview(cfg), { width: W, height: H, meta, frame, zPerM });
console.log('setup', Date.now() - t0, 'ms', stats);

const CAMERAS = {
  oblique: { target: [0.0, 0.05], distance: 0.85, tilt_deg: 55, heading_deg: 20 },
  close: { target: [0.25, -0.3], distance: 0.38, tilt_deg: 58, heading_deg: -18 },
};
const VARIANTS = ['current', 'A', 'B', 'C'];
for (const v of VARIANTS) {
  const st = await page.evaluate((vv) => window.useVariant(vv), v);
  console.log(v, JSON.stringify(st));
  for (const [cname, pose] of Object.entries(CAMERAS)) {
    const png = await page.evaluate(([vv, p]) => window.renderVariant(vv, p), [v, pose]);
    fs.writeFileSync(path.join(out, `${cname}_${v}.png`), Buffer.from(png.split(',')[1], 'base64'));
  }
}
console.log('stills written to', out, '| blocked external requests:', blocked.length, '| page errors:', errors);
await browser.close(); server.close();
