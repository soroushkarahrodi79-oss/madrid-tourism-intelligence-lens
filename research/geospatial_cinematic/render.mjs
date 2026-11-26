#!/usr/bin/env node
// Gate 4C geospatial cinematic engine V0.1: verified Gate 4B package -> MP4 + render-manifest.json.
//
//   node render.mjs --package <dir> --storyboard storyboards/madrid-rio.json --out <dir>
//                   [--width 1920] [--height 1080] [--fps 30] [--n 4] [--crf 18] [--force]
//   node render.mjs ... --stills 2.0,9.1     PNG stills at those playback seconds, no video
//
// The package is only read. Nothing is fetched from the network: the page may load files from
// this process's own local server only, every other request is blocked and logged.
// Exit codes: 0 rendered and every check passed; 1 rendered but a check failed (see the manifest);
// 2 input refused (package, storyboard, output directory); 3 tool failure.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadPackage, PackageError, sha256 } from './lib/package.mjs';
import { resolveTimeline, frameState, timeMapping, StoryboardError } from './lib/timeline.mjs';
import { groundScale, orthoView, extentPixelRect } from './lib/geo.mjs';

const RENDERER = { id: 'madrid-urban-evidence-lens/geospatial-cinematic-engine', version: '0.1.0' };
const ENGINE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ENGINE, '..', '..');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const PYTHON = process.env.PYTHON || 'python';
const SCALE_BAR_M = 500;
// Alignment criteria (mean absolute difference, 0-255 per channel). See README "Validation".
// The absolute MAD of the right image depends on image detail and on GPU vs Canvas resampling
// (4-12 at 960x540 in the pilot), so it is not a pass criterion. What is: the right image wins by a
// margin, mirrors lose, and the computed placement beats every 1 px shift.
const MARGIN = 0.5;
const MAX_OUTSIDE_MAD = 1.5;
// Share of a central sample grid that must differ from the background on every frame (before
// typography): catches a frame whose image layer did not draw, e.g. after a lost WebGL context.
const MIN_IMAGERY_SHARE = 0.75;
const MIN_SEEK_PSNR_DB = 30;

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}

const refuse = (msg) => { console.error(`REFUSED: ${msg}`); process.exit(2); };
const inside = (child, parent) => { const r = path.relative(parent, child); return !r.startsWith('..') && !path.isAbsolute(r); };
const run = (cmd, argv, opts = {}) => spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

const A = args(process.argv.slice(2));
const packageDir = A.package || process.env.CINEMATIC_PACKAGE;
if (!packageDir) refuse('--package <Gate 4B package directory> is required');
if (!A.storyboard || !A.out) refuse('--storyboard and --out are required');
const width = +(A.width || 1920);
const height = +(A.height || 1080);
const fps = +(A.fps || 30);
const n = +(A.n || 1);
const crf = +(A.crf || 18);
if (![width, height].every((v) => Number.isInteger(v) && v >= 320 && v % 2 === 0)) refuse('width/height: even integers >= 320');
if (!(Number.isInteger(fps) && fps >= 12 && fps <= 60)) refuse('fps: integer 12..60');

// --- 1. package -----------------------------------------------------------------------------
let pkg;
try { pkg = loadPackage(packageDir); } catch (e) {
  if (e instanceof PackageError) refuse(`package: ${e.message}`);
  throw e;
}
const verifier = path.join(REPO, 'research', 'temporal_materialization', 'materialize.py');
let materializerVerify = { available: false };
if (fs.existsSync(verifier)) {
  const r = run(PYTHON, ['-I', verifier, '--verify', pkg.dir]);
  materializerVerify = { available: !r.error, command: 'python -I research/temporal_materialization/materialize.py --verify <package>', exit_code: r.status, output: (r.stdout || '').trim() || String(r.error || r.stderr || '').trim() };
  if (!r.error && r.status !== 0) refuse(`Gate 4B --verify failed (exit ${r.status}): ${materializerVerify.output} ${(r.stderr || '').trim()}`);
}
console.log(`package: ${pkg.dir}\n  ${pkg.sequence.length} usable sequence frames, reference ${pkg.reference.coverage_id}, excluded ${pkg.excluded.length}; Gate 4B verify: ${materializerVerify.output || 'not available'}`);

// --- 2. storyboard + timeline ---------------------------------------------------------------
const storyboardPath = path.resolve(A.storyboard);
const storyboardBytes = fs.readFileSync(storyboardPath);
const storyboard = JSON.parse(storyboardBytes.toString('utf8'));
let copyFrom = null;
if (storyboard.copy_from) {
  const p = path.resolve(path.dirname(storyboardPath), storyboard.copy_from);
  const bytes = fs.readFileSync(p);
  storyboard.copy = JSON.parse(bytes.toString('utf8')).copy;
  copyFrom = { file: path.relative(ENGINE, p).split(path.sep).join('/'), sha256: sha256(bytes) };
}
let timeline;
try {
  timeline = resolveTimeline(storyboard, pkg, { fps, width, height });
} catch (e) {
  if (e instanceof StoryboardError) refuse(`storyboard: ${e.message}`);
  throw e;
}
console.log(`timeline: ${timeline.shots.length} shots, ${timeline.total_frames} frames, ${timeline.duration_s.toFixed(2)} s at ${width}x${height}, ${fps} fps, n=${n}`);

// --- 3. output directory --------------------------------------------------------------------
const outDir = path.resolve(A.out);
if (inside(outDir, pkg.dir) || inside(pkg.dir, outDir)) refuse('the output directory must be outside the package');
if (inside(outDir, REPO)) refuse('keep renders outside the repository (no video or frames in git history)');
if (fs.existsSync(outDir) && fs.readdirSync(outDir).length && !A.force) refuse(`${outDir} is not empty (use a new directory, or --force to overwrite)`);
fs.mkdirSync(outDir, { recursive: true });

// --- 4. read-only local server --------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png' };
const servedFrames = new Set(timeline.shots.flatMap((s) => s.layers).map((id) => pkg.byId[id].file));
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '').split('?')[0]);
  let file = null;
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (url.startsWith('/package/') && servedFrames.has(url.slice(9))) file = path.join(pkg.dir, url.slice(9));
    else if (url.startsWith('/engine/')) {
      const rel = url.slice(8);
      const allowed = /^(scene\/(index\.html|scene\.js)|lib\/(geo|timeline)\.mjs|node_modules\/three\/build\/three\.(module|core)\.js)$/.test(rel);
      if (allowed) file = path.join(ENGINE, rel);
    }
  }
  if (!file || !fs.existsSync(file)) { res.writeHead(req.method === 'GET' || req.method === 'HEAD' ? 404 : 405); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file, { flags: 'r' }).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// --- 5. browser -----------------------------------------------------------------------------
const angle = process.platform === 'win32' ? ['--use-angle=d3d11'] : process.platform === 'darwin' ? ['--use-angle=metal'] : [];
// Keep Chromium's sandbox on and drop Playwright's default software-WebGL fallback flag: if no GPU
// WebGL is available the render fails (exit 3) instead of weakening the browser.
const launch = { headless: true, chromiumSandbox: true, ignoreDefaultArgs: ['--enable-unsafe-swiftshader'], args: ['--force-color-profile=srgb', '--hide-scrollbars', ...angle] };
const browser = await chromium.launch(launch);
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, serviceWorkers: 'block' });
const network = { allowed_origin: origin, requests: 0, by_origin: {}, blocked: [] };
await context.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(`${origin}/`) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  network.blocked.push(u);
  return route.abort('blockedbyclient');
});
const consoleLog = { errors: [], warnings: [] };
const page = await context.newPage();
page.on('request', (r) => {
  const u = r.url();
  if (u.startsWith('data:') || u.startsWith('blob:')) return;
  network.requests++;
  const o = new URL(u).origin;
  network.by_origin[o] = (network.by_origin[o] || 0) + 1;
});
page.on('console', (m) => {
  if (m.type() === 'error') consoleLog.errors.push(m.text());
  else if (m.type() === 'warning') consoleLog.warnings.push(m.text());
});
page.on('pageerror', (e) => consoleLog.errors.push(`pageerror: ${e.message}`));
await page.goto(`${origin}/engine/scene/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.setupScene === 'function', null, { timeout: 30000 });

const latDeg = pkg.frame.centreLonLat[1];
const ground = groundScale(latDeg);
const nf = new Intl.NumberFormat(storyboard.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf3 = new Intl.NumberFormat(storyboard.locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const seqShotsSeconds = timeline.shots.find((s) => s.kind === 'sequence');
const usedIds = [...new Set(timeline.shots.flatMap((s) => s.layers))];
const seqIds = timeline.shots.filter((s) => s.kind === 'sequence').map((s) => s.coverage);
const firstSeq = pkg.byId[seqIds[0] ?? pkg.sequence[0].coverage_id];
const lastSeq = pkg.byId[seqIds[seqIds.length - 1] ?? pkg.sequence.at(-1).coverage_id];
const tokens = {
  period: `${firstSeq.date.label} → ${lastSeq.date.label}`,
  lat: nf3.format(latDeg),
  lon: nf3.format(Math.abs(pkg.frame.centreLonLat[0])),
  wm: nf.format(pkg.frame.width / 1000),
  hm: nf.format(pkg.frame.height / 1000),
  wg: nf.format((pkg.frame.width * ground.eastWest) / 1000),
  hg: nf.format((pkg.frame.height * ground.northSouth) / 1000),
  per: seqShotsSeconds ? new Intl.NumberFormat(storyboard.locale, { maximumFractionDigits: 2 }).format(seqShotsSeconds.frames / fps) : '',
  provider: pkg.service.provider,
  licence: pkg.service.licence.name,
  images: String(usedIds.length),
};
const sceneConfig = {
  width, height, locale: storyboard.locale, timeline, frame: pkg.frame, copy: storyboard.copy, tokens, ground, scale_bar_m: SCALE_BAR_M,
  images: usedIds.map((id) => ({ coverage_id: id, url: `${origin}/package/${pkg.byId[id].file}`, sha256: pkg.byId[id].sha256, width: pkg.byId[id].width, height: pkg.byId[id].height, format: 'image/jpeg' })),
  meta: {
    reference_id: pkg.reference.coverage_id,
    sequence_ids: pkg.sequence.map((f) => f.coverage_id),
    byId: Object.fromEntries(Object.values(pkg.byId).map((f) => [f.coverage_id, { role: f.role, date: f.date, product: f.product, attribution: f.attribution, coverage_state: f.coverage.state }])),
  },
};
let env;
try { env = await page.evaluate((cfg) => window.setupScene(cfg), sceneConfig); } catch (e) {
  console.error(`scene setup failed: ${e.message}`); await browser.close(); server.close(); process.exit(3);
}
console.log(`GPU: ${env.gpu} | three r${env.three} | font: ${env.font_available}`);
if (/swiftshader|llvmpipe|software/i.test(env.gpu)) console.log('  software rendering: slower, same pictures');

const framePng = async (i, opts) => page.evaluate(([f, o]) => window.renderFrame(f, o), [i, opts]);

// --- stills mode ----------------------------------------------------------------------------
if (A.stills) {
  for (const s of String(A.stills).split(',')) {
    const i = Math.min(timeline.total_frames - 1, Math.round(parseFloat(s) * fps));
    const r = await framePng(i, { n });
    const f = path.join(outDir, `still_f${String(i).padStart(5, '0')}.png`);
    fs.writeFileSync(f, Buffer.from(r.png.split(',')[1], 'base64'));
    console.log(`still -> ${f} (${r.shot}; shows ${r.visible.join('+')}; labelled ${(r.labelled || []).join('+')})`);
  }
  if (consoleLog.errors.length) console.log('console errors:', consoleLog.errors);
  await browser.close(); server.close(); process.exit(0);
}

// --- 6. alignment checks on the page (before encoding) --------------------------------------
const checks = [];
const orthoShots = timeline.shots.filter((s) => s.camera.type === 'orthographic');
for (const s of orthoShots) {
  const frames = s.kind === 'sequence' ? [s.start_frame, Math.floor((s.start_frame + s.end_frame) / 2)]
    : s.kind === 'compare' ? [s.end_frame - 1] : [s.start_frame];
  for (const i of frames) {
    const r = await page.evaluate((f) => window.checkFrame(f), i);
    const regions = r.regions.map((g) => {
      const others = Math.min(...Object.entries(g.mad_all).filter(([id]) => id !== g.coverage_id).map(([, v]) => v), Infinity);
      const criteria = {
        right_image_is_best_match: g.best_match === g.coverage_id,
        margin_vs_other_images: g.mad_expected <= MARGIN * others,
        not_mirrored: g.mad_expected < Math.min(...Object.values(g.mad_mirrors)),
        zero_offset_is_optimum: g.mad_expected <= Math.min(...Object.values(g.mad_shifts)),
      };
      return { ...g, criteria, pass: Object.values(criteria).every(Boolean) };
    });
    checks.push({ frame: i, shot: s.id, rect: r.rect, outside_mad: r.outside_mad, regions, pass: regions.every((g) => g.pass) && r.outside_mad <= MAX_OUTSIDE_MAD });
  }
}
// Identical framing across every fixed orthographic shot (context, sequence, comparison).
const fixedRects = orthoShots.filter((s) => s.camera.zoom_to === undefined).map((s) => {
  const st = frameState(timeline, s.start_frame);
  return JSON.stringify(extentPixelRect(pkg.frame, orthoView(pkg.frame, width / height, st.camera.zoom), width, height));
});
const framingIdentical = new Set(fixedRects).size <= 1;
console.log(`alignment: ${checks.filter((c) => c.pass).length}/${checks.length} probes pass; fixed framing identical: ${framingIdentical}`);

// --- 7. render + encode ---------------------------------------------------------------------
const videoFile = path.join(outDir, 'video.mp4');
const keyDir = path.join(outDir, 'keyframes');
fs.mkdirSync(keyDir, { recursive: true });
const keyFrames = new Set();
for (const s of timeline.shots) { keyFrames.add(s.start_frame); keyFrames.add(Math.floor((s.start_frame + s.end_frame) / 2)); keyFrames.add(s.end_frame - 1); }
const ffArgs = ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-', '-an',
  '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf),
  '-profile:v', 'high', '-r', String(fps), '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', videoFile];
const ff = spawn(FFMPEG, ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
const ffDone = new Promise((r) => ff.on('close', r));
// If ffmpeg dies (seen once under memory pressure: "Cannot allocate memory" in the PNG pipe),
// stop with a tool failure instead of an unhandled stream error. Nothing partial is reported as done.
ff.stdin.on('error', async (e) => {
  console.error(`ffmpeg input closed (${e.code}); no video produced. Free memory and run again.`);
  try { await browser.close(); } catch {}
  server.close();
  process.exit(3);
});
const syncMismatches = [];
const noImagery = [];
let minImagery = 1;
const t0 = Date.now();
for (let i = 0; i < timeline.total_frames; i++) {
  let r;
  try { r = await framePng(i, { n }); } catch (e) {
    console.error(`frame ${i}: ${e.message}`); ff.stdin.destroy(); await browser.close(); server.close(); process.exit(3);
  }
  minImagery = Math.min(minImagery, r.imagery);
  if (r.imagery < MIN_IMAGERY_SHARE) noImagery.push({ frame: i, imagery_share: r.imagery });
  const a = [...r.visible].sort().join('+');
  const b = [...(r.labelled || [])].sort().join('+');
  if (a !== b) syncMismatches.push({ frame: i, shows: a, labelled: b });
  const buf = Buffer.from(r.png.split(',')[1], 'base64');
  if (keyFrames.has(i)) fs.writeFileSync(path.join(keyDir, `f${String(i).padStart(5, '0')}.png`), buf);
  if (!ff.stdin.write(buf)) await new Promise((res) => ff.stdin.once('drain', res));
  if (i && i % (fps * 2) === 0) {
    const el = (Date.now() - t0) / 1000;
    console.log(`frame ${i}/${timeline.total_frames}  ${el.toFixed(0)} s, ~${(((timeline.total_frames - i) * el) / i).toFixed(0)} s left`);
  }
}
ff.stdin.end();
const ffExit = await ffDone;
const renderSeconds = (Date.now() - t0) / 1000;
const chromiumVersion = browser.version();
await browser.close();
server.close();
if (ffExit !== 0) { console.error(`ffmpeg exited ${ffExit}`); process.exit(3); }
console.log(`encoded ${videoFile} in ${renderSeconds.toFixed(0)} s`);

// --- 8. check the encoded file, not the browser ---------------------------------------------
const probe = JSON.parse(run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries',
  'stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,color_space,color_primaries,color_transfer:format=duration,size,format_name',
  '-of', 'json', videoFile]).stdout);
const vs = probe.streams[0];
const decode = run(FFMPEG, ['-v', 'error', '-i', videoFile, '-f', 'null', '-']);
const decodeErrors = (decode.stderr || '').trim();
const mp4Frames = +vs.nb_read_frames;
const mp4Duration = +probe.format.duration;
// Extract the key frames from the MP4 in one decode pass, then compare with the rendered PNGs.
const keys = [...keyFrames].sort((p, q) => p - q);
const mp4Dir = path.join(outDir, 'mp4_frames');
fs.mkdirSync(mp4Dir, { recursive: true });
run(FFMPEG, ['-v', 'error', '-y', '-i', videoFile, '-vf', `select='${keys.map((k) => `eq(n\\,${k})`).join('+')}'`, '-fps_mode', 'passthrough', path.join(mp4Dir, 'k%04d.png')]);
const mp4Key = Object.fromEntries(keys.map((k, idx) => [k, path.join(mp4Dir, `k${String(idx + 1).padStart(4, '0')}.png`)]));
const renderedKey = (k) => path.join(keyDir, `f${String(k).padStart(5, '0')}.png`);
const psnr = (a, b) => {
  const r = run(FFMPEG, ['-v', 'info', '-i', a, '-i', b, '-lavfi', '[0:v]format=rgb24[x];[1:v]format=rgb24[y];[x][y]psnr', '-f', 'null', '-']);
  const m = /average:(inf|[\d.]+)/.exec(r.stderr || '');
  return m ? (m[1] === 'inf' ? Infinity : +m[1]) : NaN;
};
const seek = keys.map((k) => ({ frame: k, psnr_db: psnr(mp4Key[k], renderedKey(k)) }));
// Cut sync in the encoded file: around each cut c, MP4 frame c must match rendered frame c better
// than rendered frame c-1, and MP4 frame c-1 the reverse.
const cuts = timeline.shots.slice(1).map((s) => {
  const c = s.start_frame;
  const r = {
    cut_frame: c, from: timeline.shots.find((x) => x.end_frame === c).id, to: s.id,
    mp4_c_vs_c: psnr(mp4Key[c], renderedKey(c)), mp4_c_vs_prev: psnr(mp4Key[c], renderedKey(c - 1)),
    mp4_prev_vs_prev: psnr(mp4Key[c - 1], renderedKey(c - 1)), mp4_prev_vs_c: psnr(mp4Key[c - 1], renderedKey(c)),
  };
  r.pass = r.mp4_c_vs_c > r.mp4_c_vs_prev && r.mp4_prev_vs_prev > r.mp4_prev_vs_c;
  return r;
});
const videoBytes = fs.readFileSync(videoFile);

// --- 9. render manifest ---------------------------------------------------------------------
const gitHead = run('git', ['-C', ENGINE, 'rev-parse', 'HEAD']);
const gitDirty = run('git', ['-C', ENGINE, 'status', '--porcelain', '--', '.']);
const ffVersion = (run(FFMPEG, ['-version']).stdout || '').split('\n')[0];
const validation = {
  mp4_dimensions: { expected: [width, height], actual: [vs.width, vs.height], pass: vs.width === width && vs.height === height },
  mp4_frame_rate: { expected: `${fps}/1`, actual: vs.r_frame_rate, pass: vs.r_frame_rate === `${fps}/1` },
  mp4_frame_count: { expected: timeline.total_frames, actual: mp4Frames, pass: mp4Frames === timeline.total_frames },
  mp4_duration_s: { expected: timeline.duration_s, actual: mp4Duration, pass: Math.abs(mp4Duration - timeline.duration_s) <= 1 / fps + 1e-6 },
  mp4_full_decode: { errors: decodeErrors, pass: decode.status === 0 && !decodeErrors },
  mp4_seek_psnr: { min_db: MIN_SEEK_PSNR_DB, frames: seek, pass: seek.every((s) => s.psnr_db >= MIN_SEEK_PSNR_DB) },
  mp4_cut_sync: { cuts, pass: cuts.every((c) => c.pass) },
  label_texture_sync: { frames_checked: timeline.total_frames, mismatches: syncMismatches, pass: syncMismatches.length === 0 },
  imagery_present_every_frame: { min_share_required: MIN_IMAGERY_SHARE, min_share_observed: minImagery, frames_without_imagery: noImagery, pass: noImagery.length === 0 },
  image_alignment: { criteria: { right_image_mad_at_most: `${MARGIN} x the best other image`, mirrors_worse: true, zero_offset_beats_1px_shifts: true, max_outside_mad: MAX_OUTSIDE_MAD }, probes: checks, pass: checks.length > 0 && checks.every((c) => c.pass) },
  identical_framing_fixed_orthographic_shots: { pass: framingIdentical },
  chronological_order: { sequence: seqIds.map((id) => pkg.byId[id].date.label), pass: true, note: 'enforced by loadPackage and resolveTimeline; a violation refuses the run' },
  network: { external_requests: network.blocked.length, ign_requests: network.blocked.filter((u) => /ign\.es/i.test(u)).length, pass: network.blocked.length === 0 && Object.keys(network.by_origin).every((o) => o === origin) },
  console: { errors: consoleLog.errors, warnings: consoleLog.warnings, pass: consoleLog.errors.length === 0 && !consoleLog.warnings.some((w) => /webgl|context_lost|shader|three\./i.test(w)) },
  package_unchanged_after_render: (() => {
    const changed = Object.entries(pkg.fileHashes).filter(([rel, h]) => sha256(fs.readFileSync(path.join(pkg.dir, rel))) !== h).map(([rel]) => rel);
    return { changed, pass: changed.length === 0 };
  })(),
};
const pass = Object.values(validation).every((v) => v.pass);
const imagesUsed = usedIds.map((id) => {
  const f = pkg.byId[id];
  return {
    coverage_id: id, role: f.role, layer: f.layer, product: f.product, file: f.file, sha256: f.sha256, bytes: f.bytes,
    date: f.date, coverage_state: f.coverage.state, coverage_flags: f.coverage.flags, frame_limitations: f.limitations,
    attribution: f.attribution, licence: f.licence, request_url: f.request_url, retrieved_at: f.retrieved_at,
    shown_in_shots: timeline.shots.filter((s) => s.layers.includes(id)).map((s) => s.id),
  };
});
const manifest = {
  schema: { id: 'urn:madrid-urban-evidence-lens:render-manifest', version: '0.1.0' },
  status: pass ? 'PASS' : 'FAIL',
  renderer: RENDERER,
  rendered_at: new Date().toISOString(),
  render_seconds: Math.round(renderSeconds),
  code: { repository_commit: (gitHead.stdout || '').trim() || null, uncommitted_engine_changes: (gitDirty.stdout || '').trim().split('\n').filter(Boolean) },
  package: {
    path: pkg.dir, id: pkg.id, schema: pkg.materialized.schema, complete: pkg.materialized.complete,
    record_sha256: pkg.recordHashes, source_deployment_commit: pkg.materialized.source_manifest.deployment_commit,
    materializer_verify: materializerVerify, excluded_frames: pkg.excluded, warnings: pkg.warnings,
  },
  storyboard: { file: path.relative(ENGINE, storyboardPath).split(path.sep).join('/'), sha256: sha256(storyboardBytes), id: storyboard.id, version: storyboard.storyboard_version, copy_from: copyFrom },
  output: {
    file: videoFile, sha256: sha256(videoBytes), bytes: videoBytes.length,
    width, height, fps, frames: timeline.total_frames, duration_s: timeline.duration_s,
    encoding: { codec: 'H.264 (libx264)', profile: vs.profile, pix_fmt: vs.pix_fmt, crf, preset: 'slow', colour: 'sRGB render -> BT.709 limited range', audio: 'none (silent)' },
    subframes_per_moving_frame: n, shutter: '0.5 frame (camera moves only; static shots are single samples)',
    ffprobe: probe,
  },
  spatial: {
    crs: pkg.spatial.crs, bbox: pkg.spatial.bbox, image_pixels: [pkg.spatial.width, pkg.spatial.height],
    scene_transform: {
      origin_epsg3857: pkg.frame.origin,
      formula: 'x = easting - origin[0]; y = northing - origin[1]; z = 0 on the image plane',
      axes: '+x east, +y north (grid north), +z up; right-handed',
      units: '1 scene unit = 1 EPSG:3857 metre (Web Mercator units, not ground metres)',
      north: 'grid north is screen-up in every orthographic shot; the intro rotates by heading_deg, at most 30 degrees, and ends north-up',
      plane: `one flat plane of ${pkg.frame.width.toFixed(3)} x ${pkg.frame.height.toFixed(3)} units shared by every coverage; no elevation`,
      image_aspect: pkg.frame.aspect, output_aspect: width / height,
      fit: 'contain: the whole extent is visible at orthographic zoom 1, centred; bars outside the extent are background',
      texture_orientation: 'image row 0 = north edge (flipY texture upload); world-file pixel-centre convention of Gate 4B',
    },
    ground_scale_at_centre: {
      latitude_deg: latDeg, method: 'WGS84 ellipsoid factors for EPSG:3857 at the extent centre',
      ground_m_per_mercator_m_east_west: ground.eastWest, ground_m_per_mercator_m_north_south: ground.northSouth,
      approx_extent_ground_km: [(pkg.frame.width * ground.eastWest) / 1000, (pkg.frame.height * ground.northSouth) / 1000],
      scale_bar: `${SCALE_BAR_M} m east-west at the centre, labelled approximate; the north-south factor differs by ${(Math.abs(ground.eastWest / ground.northSouth - 1) * 100).toFixed(2)} % and the factor varies across the extent`,
    },
  },
  camera: {
    lens: storyboard.shots.filter((s) => s.camera.type === 'perspective').map((s) => ({ shot: s.id, fov_deg: s.camera.fov_deg, from: s.camera.from, to: s.camera.to, ease: s.camera.ease || 'easeInOut' })),
    orthographic: 'context, historical sequence and comparison use one fixed orthographic camera (zoom 1, centred, north-up); closing uses a slow orthographic push',
  },
  scenes: timeline.shots.map((s) => ({ id: s.id, kind: s.kind, frames: [s.start_frame, s.end_frame], seconds: [s.start_s, s.end_s], coverages: s.layers, camera: s.camera, wipe: s.wipe || null })),
  time_mapping: {
    note: 'Playback seconds are video time. Historical time is each coverage\'s published date (a mosaic year or a flight interval). Equal playback durations do not mean equal steps in history.',
    shots: timeMapping(timeline, pkg.byId),
  },
  images: imagesUsed,
  attributions: [...new Set(imagesUsed.map((i) => i.attribution))],
  licences: [...new Set(imagesUsed.map((i) => `${i.licence.name} (${i.licence.scope})`))],
  environment: {
    node: process.version, platform: `${process.platform} ${os.release()} ${process.arch}`,
    playwright: JSON.parse(fs.readFileSync(path.join(ENGINE, 'node_modules', 'playwright', 'package.json'), 'utf8')).version,
    chromium: chromiumVersion, chromium_launch: launch, three: `r${env.three}`, gpu: env.gpu, webgl: env.webgl, max_anisotropy: env.max_anisotropy,
    font: env.font_available, font_stack: env.font_stack, ffmpeg: ffVersion,
  },
  network,
  validation,
  limitations: [
    'Flat 2.5D presentation of 2D orthophotos: no terrain, no buildings, no reconstructed geometry.',
    'Each date is shown as published; nothing is interpolated between dates. Camera and text are animated, imagery is not.',
    'Visible differences between dates are a visual reading, not a measurement of change, and say nothing about causes.',
    'Multi-year flights are labelled with their published interval; no exact acquisition date is implied.',
    'Every frame is COVERAGE_UNVERIFIED unless stated: the Gate 4B heuristic found no blank region, which does not prove complete coverage.',
    'Video resolution does not add spatial detail: the frames are 1280x800 requests (~1.8 m ground spacing at the centre) resampled for display.',
    'The scale bar and ground extent are approximate (Web Mercator, evaluated at the centre).',
    'Licence: CC BY 4.0 scne.es is declared service-wide by IGN, not verified layer by layer.',
  ],
  disclaimers: [
    'SHA-256 values detect change; they are not a digital signature. Whoever edits the video can rewrite this file.',
    'The procedure is reproducible from the package and storyboard; byte-identical MP4 output across GPUs, drivers, fonts or encoder builds is not claimed.',
  ],
};
fs.writeFileSync(path.join(outDir, 'render-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
for (const [k, v] of Object.entries(validation)) console.log(`${v.pass ? 'PASS' : 'FAIL'}  ${k}`);
console.log(`${manifest.status}: ${videoFile}\n  sha256 ${manifest.output.sha256}\n  ${path.join(outDir, 'render-manifest.json')}`);
process.exit(pass ? 0 : 1);
