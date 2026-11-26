// Gate 4C geospatial cinematic engine: package contract, spatial transform and timeline.
// Pure modules only (no three.js, no browser): the render-time checks live in render.mjs and are
// recorded in each render-manifest.json. Set CINEMATIC_PACKAGE to a real Gate 4B package to also
// run the integration test against it (read-only).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadPackage, PackageError, imageSize } from '../research/geospatial_cinematic/lib/package.mjs';
import {
  sceneFrame, toScene, groundScale, orthoView, projectOrtho, extentPixelRect, perspectivePose,
  projectPerspective, extentCorners, ndcToPixel, mercatorToLonLat,
} from '../research/geospatial_cinematic/lib/geo.mjs';
import { resolveTimeline, frameState, timeMapping, StoryboardError } from '../research/geospatial_cinematic/lib/timeline.mjs';

const STORYBOARD = JSON.parse(fs.readFileSync(new URL('../research/geospatial_cinematic/storyboards/madrid-rio.json', import.meta.url), 'utf8'));
const BBOX = [-414969.329, 4922846.603, -411911.848, 4924757.528];
const W = 1280;
const H = 800;
const sha = (b) => createHash('sha256').update(b).digest('hex');

// ---------- synthetic Gate 4B package on disk (no imagery: a JPEG header with the right size) ----------

const COVERAGES = [
  { id: '2006', role: 'reference', date: { kind: 'annual_mosaic', start_year: 2006, end_year: 2006, label: '2006' } },
  { id: 'ams1956', role: 'frame', date: { kind: 'multi_year_flight', start_year: 1956, end_year: 1957, label: '1956–57' } },
  { id: 'olistat', role: 'frame', date: { kind: 'multi_year_flight', start_year: 1997, end_year: 1998, label: '1997–98' } },
  { id: 'sigpac', role: 'frame', date: { kind: 'multi_year_flight', start_year: 1997, end_year: 2003, label: '1997–2003' } },
  { id: '2023', role: 'frame', date: { kind: 'annual_mosaic', start_year: 2023, end_year: 2023, label: '2023' } },
];

function jpegHeader(width, height, salt) {
  const b = Buffer.alloc(64);
  b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  b.writeUInt16BE(height, 7);
  b.writeUInt16BE(width, 9);
  b.write(salt, 32, 'latin1');
  return b;
}

function buildPackage(edit = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate4c-pkg-'));
  fs.mkdirSync(path.join(dir, 'frames'));
  const [minE, minN, maxE, maxN] = BBOX;
  const px = (maxE - minE) / W;
  const py = (maxN - minN) / H;
  const spatial = {
    crs: 'EPSG:3857', axis_order: ['easting', 'northing'], bbox: BBOX, width: W, height: H,
    pixel_size_mercator_units: [px, py], gdal_geotransform: [minE, px, 0, maxN, 0, -py],
    world_file: [px, 0, 0, -py, minE + px / 2, maxN - py / 2],
  };
  const source = { schema: { version: '1.0.0' }, view: { crs: 'EPSG:3857', bbox: BBOX }, image: { width: W, height: H } };
  const licence = { name: 'CC BY 4.0 scne.es', scope: 'declared service-wide', url: 'https://www.scne.es' };
  const ctx = { spatial, source, frames: [], files: {}, coverages: structuredClone(COVERAGES) };
  ctx.coverages.forEach((c) => {
    ctx.frames.push({
      coverage_id: c.id, role: c.role, product: `Product ${c.id}`, date: c.date, crs: 'EPSG:3857', bbox: BBOX.slice(), width: W, height: H,
      licence, attribution: `Product ${c.id} cedido por © IGN · CC BY 4.0 scne.es`, status: 'VALID_IMAGE',
      file: `frames/${c.id}.jpg`, coverage: { state: 'COVERAGE_UNVERIFIED', flags: [] },
    });
    ctx.files[`frames/${c.id}.jpg`] = jpegHeader(W, H, c.id);
  });
  edit(ctx);
  const write = (rel, data) => { fs.writeFileSync(path.join(dir, rel), data); return sha(data); };
  const sums = {};
  for (const f of ctx.frames) {
    const base = f.file.replace(/\.jpg$/, '');
    sums[f.file] = write(f.file, ctx.files[f.file]);
    f.sha256 = sums[f.file];
    f.sidecars = {};
    for (const [rel, text] of [
      [`${base}.jgw`, `${ctx.spatial.world_file.join('\n')}\n`],
      [`${base}.prj`, 'PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",PROJECTION["Mercator_Auxiliary_Sphere"]]'],
      [`${f.file}.aux.xml`, '<PAMDataset><SRS>WGS 84 / Pseudo-Mercator AUTHORITY["EPSG","3857"]</SRS></PAMDataset>'],
    ]) f.sidecars[rel] = sums[rel] = write(rel, text);
  }
  const sourceBytes = Buffer.from(JSON.stringify(ctx.source));
  sums['source-manifest.json'] = write('source-manifest.json', sourceBytes);
  const seq = ctx.frames.filter((f) => f.role === 'frame');
  seq.forEach((f, i) => { f.sequence_index = i; });
  const materialized = {
    schema: { id: 'urn:madrid-urban-evidence-lens:materialized-package', version: '1.0.0' },
    complete: ctx.frames.every((f) => f.status === 'VALID_IMAGE'),
    source_manifest: { file: 'source-manifest.json', sha256: sums['source-manifest.json'] },
    spatial: ctx.spatial,
    service: { provider: 'Instituto Geográfico Nacional de España', licence },
    order: { reference: '2006', sequence: seq.map((f) => f.coverage_id) },
    frames: ctx.frames,
  };
  (ctx.editManifest || (() => {}))(materialized);
  sums['materialized-manifest.json'] = write('materialized-manifest.json', JSON.stringify(materialized));
  const report = { complete: materialized.complete, frames: ctx.frames.map((f) => ({ coverage_id: f.coverage_id, status: f.status, coverage: f.coverage })) };
  sums['validation-report.json'] = write('validation-report.json', JSON.stringify(report));
  write('checksums.sha256', Object.entries(sums).map(([rel, h]) => `${h}  ${rel}`).join('\n') + '\n');
  return dir;
}

const refusal = (fn, code) => assert.throws(fn, (e) => e instanceof PackageError && e.code === code, `expected ${code}`);

test('a consistent package loads: order, reference, extent, attributions', () => {
  const p = loadPackage(buildPackage());
  assert.equal(p.reference.coverage_id, '2006');
  assert.deepEqual(p.sequence.map((f) => f.coverage_id), ['ams1956', 'olistat', 'sigpac', '2023']);
  assert.deepEqual(p.sequence.map((f) => f.date.label), ['1956–57', '1997–98', '1997–2003', '2023'], 'published intervals are kept as published');
  assert.equal(p.excluded.length, 0);
  assert.equal(p.frame.crs, 'EPSG:3857');
  assert.ok(p.sequence.every((f) => f.attribution && f.licence.name));
});

test('one altered byte in an image is refused, and the package is left as it was', () => {
  const dir = buildPackage();
  const file = path.join(dir, 'frames', 'olistat.jpg');
  const bytes = fs.readFileSync(file);
  bytes[40] ^= 0xff;
  fs.writeFileSync(file, bytes);
  const before = fs.readFileSync(file);
  refusal(() => loadPackage(dir), 'HASH_MISMATCH');
  assert.deepEqual(fs.readFileSync(file), before);
});

test('a missing file, an unlisted file and an altered sidecar are refused', () => {
  const a = buildPackage();
  fs.rmSync(path.join(a, 'frames', '2023.jpg'));
  refusal(() => loadPackage(a), 'MISSING_FILE');
  const b = buildPackage();
  fs.writeFileSync(path.join(b, 'frames', 'extra.jpg'), 'x');
  refusal(() => loadPackage(b), 'UNLISTED_FILE');
  const c = buildPackage();
  fs.appendFileSync(path.join(c, 'frames', 'sigpac.jgw'), '0\n');
  refusal(() => loadPackage(c), 'HASH_MISMATCH');
});

test('records that disagree are refused: CRS, extent, image size, order, licence', () => {
  refusal(() => loadPackage(buildPackage((c) => { c.spatial.crs = 'EPSG:25830'; })), 'CRS');
  refusal(() => loadPackage(buildPackage((c) => { c.frames[2].bbox = [BBOX[0] + 10, BBOX[1], BBOX[2] + 10, BBOX[3]]; })), 'EXTENT');
  refusal(() => loadPackage(buildPackage((c) => { c.source.view.bbox = [0, 0, 1, 1]; })), 'EXTENT');
  refusal(() => loadPackage(buildPackage((c) => { c.files['frames/olistat.jpg'] = jpegHeader(1024, 800, 'olistat'); })), 'DIMENSIONS');
  refusal(() => loadPackage(buildPackage((c) => { [c.frames[1], c.frames[4]] = [c.frames[4], c.frames[1]]; })), 'ORDER');
  refusal(() => loadPackage(buildPackage((c) => { c.frames[3].attribution = ''; })), 'LICENCE');
  refusal(() => loadPackage(buildPackage((c) => { c.editManifest = (m) => { m.order.reference = 'ams1956'; }; })), 'ORDER');
  refusal(() => loadPackage(buildPackage((c) => { c.frames[1].date = { kind: 'annual_mosaic', start_year: 1956, end_year: 1957, label: '1956' }; })), 'DATE');
});

test('empty or failed frames are left out of the film, never filled in', () => {
  const p = loadPackage(buildPackage((c) => {
    c.frames[2].coverage = { state: 'EMPTY_BLANK', flags: [] };
    c.frames[3].status = 'HTTP_ERROR';
  }));
  assert.deepEqual(p.sequence.map((f) => f.coverage_id), ['ams1956', '2023']);
  assert.deepEqual(p.excluded.map((e) => e.coverage_id), ['olistat', 'sigpac']);
  assert.throws(() => resolveTimeline({ shots: [{ id: 's', kind: 'sequence', per_frame_s: 1, coverages: ['olistat'], camera: { type: 'orthographic', zoom: 1 } }] }, p, { fps: 30, width: 1920, height: 1080 }), StoryboardError);
  const flagged = loadPackage(buildPackage((c) => { c.frames[4].coverage = { state: 'SUSPECTED_PARTIAL', flags: [] }; }));
  assert.ok(flagged.usable.has('2023'), 'a suspected-partial frame stays usable');
  assert.match(flagged.warnings.join(' '), /SUSPECTED_PARTIAL/);
});

test('JPEG and PNG headers give the image size without decoding', () => {
  assert.deepEqual(imageSize(jpegHeader(1280, 800, 'x')), { format: 'image/jpeg', width: 1280, height: 800 });
  const png = Buffer.alloc(32);
  png.set([0x89, 0x50, 0x4e, 0x47]);
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(400, 20);
  assert.deepEqual(imageSize(png), { format: 'image/png', width: 640, height: 400 });
  assert.equal(imageSize(Buffer.from('not an image')), null);
});

// ---------- spatial transform ----------

const FRAME = sceneFrame({ crs: 'EPSG:3857', bbox: BBOX, width: W, height: H });

test('scene origin is the extent centre: corners map to ±half-extent, +x east, +y north', () => {
  assert.deepEqual(toScene(FRAME, BBOX[0], BBOX[3]).map((v) => +v.toFixed(6)), [-FRAME.width / 2, FRAME.height / 2].map((v) => +v.toFixed(6)));
  assert.deepEqual(toScene(FRAME, BBOX[2], BBOX[1]).map((v) => +v.toFixed(6)), [FRAME.width / 2, -FRAME.height / 2].map((v) => +v.toFixed(6)));
  assert.ok(Math.abs(FRAME.aspect - W / H) < 1e-5, 'Mercator extent and pixel grid have the same aspect');
  const [lon, lat] = FRAME.centreLonLat;
  assert.ok(Math.abs(lon - -3.714) < 1e-6 && Math.abs(lat - 40.397) < 1e-6, 'centre matches the manifest centre');
  assert.deepEqual(mercatorToLonLat(0, 0), [0, 0]);
});

test('orthographic view: whole extent visible, north edge at the top, aspect preserved, centred', () => {
  const view = orthoView(FRAME, 1920 / 1080, 1);
  const rect = extentPixelRect(FRAME, view, 1920, 1080);
  assert.ok(Math.abs(rect.y) < 1e-9 && Math.abs(rect.height - 1080) < 1e-9, 'fits the height');
  assert.ok(Math.abs(rect.width / rect.height - FRAME.aspect) < 1e-9, 'no stretching');
  assert.ok(Math.abs(rect.x - (1920 - rect.width) / 2) < 1e-9, 'centred');
  const north = ndcToPixel(projectOrtho(view, [0, FRAME.height / 2]), 1920, 1080);
  const east = ndcToPixel(projectOrtho(view, [FRAME.width / 2, 0]), 1920, 1080);
  assert.ok(north[1] < 1e-9 && east[0] > 1920 / 2, 'north is up and east is right (not mirrored)');
  const narrow = extentPixelRect(FRAME, orthoView(FRAME, 4 / 3, 1), 1440, 1080);
  assert.ok(narrow.x >= -1e-9 && narrow.x + narrow.width <= 1440 + 1e-9, 'a narrower screen still shows the whole extent');
});

test('the intro ends exactly on the orthographic framing (seamless cut, no jump)', () => {
  const aspect = 1920 / 1080;
  const pose = perspectivePose(FRAME, aspect, 30, { target: [0, 0], distance: 1, tilt_deg: 0, heading_deg: 0 });
  const view = orthoView(FRAME, aspect, 1);
  for (const corner of Object.values(extentCorners(FRAME))) {
    const a = ndcToPixel(projectPerspective(pose, corner), 1920, 1080);
    const b = ndcToPixel(projectOrtho(view, corner), 1920, 1080);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6, `corner ${corner} lands on the same pixel`);
  }
});

test('heading rotates the view clockwise from north; tilt keeps the target centred', () => {
  const pose = perspectivePose(FRAME, 16 / 9, 30, { target: [0, 0], distance: 1, tilt_deg: 0, heading_deg: 90 });
  const [nx] = projectPerspective(pose, [0, 500]);
  assert.ok(nx < 0, 'facing east, grid north is on the left');
  const tilted = perspectivePose(FRAME, 16 / 9, 30, { target: [0.1, -0.1], distance: 0.6, tilt_deg: 22, heading_deg: -6 });
  const c = projectPerspective(tilted, tilted.target);
  assert.ok(Math.abs(c[0]) < 1e-9 && Math.abs(c[1]) < 1e-9);
});

test('ground scale distinguishes Web Mercator units from ground metres', () => {
  const eq = groundScale(0);
  assert.ok(Math.abs(eq.eastWest - 1) < 1e-12);
  const m = groundScale(40.397);
  assert.ok(Math.abs(m.spherical - Math.cos((40.397 * Math.PI) / 180)) < 1e-12);
  assert.ok(m.eastWest > m.northSouth, 'EPSG:3857 is not conformal on the ellipsoid');
  assert.ok(Math.abs(m.eastWest / m.northSouth - 1) < 0.005, 'the difference is about 0.4 % at Madrid');
  assert.ok(Math.abs(FRAME.width * m.eastWest - 2331.8) < 1, 'extent ≈ 2.33 km east-west on the ground');
});

// ---------- timeline ----------

function pkgView(ids = ['ams1956', 'olistat', 'sigpac', '2009', '2011', '2014', '2017', '2020', '2023']) {
  const byId = { 2006: { coverage_id: '2006', role: 'reference', date: { kind: 'annual_mosaic', start_year: 2006, end_year: 2006, label: '2006' } } };
  ids.forEach((id, i) => { byId[id] = { coverage_id: id, role: 'frame', date: { kind: 'annual_mosaic', start_year: 1950 + i, end_year: 1950 + i, label: `L${id}` } }; });
  byId.ams1956.date = { kind: 'multi_year_flight', start_year: 1956, end_year: 1957, label: '1956–57' };
  return { reference: byId['2006'], sequence: ids.map((id) => byId[id]), usable: new Set(Object.keys(byId)), byId };
}
const OPTS = { fps: 30, width: 1920, height: 1080 };

test('the pilot storyboard resolves to 30 s at 30 fps with contiguous, frame-exact shots', () => {
  const tl = resolveTimeline(STORYBOARD, pkgView(), OPTS);
  assert.equal(tl.total_frames, 900);
  assert.equal(tl.duration_s, 30);
  tl.shots.forEach((s, i) => {
    assert.equal(s.start_frame, i ? tl.shots[i - 1].end_frame : 0);
    assert.ok(s.frames >= 1);
  });
  const seq = tl.shots.filter((s) => s.kind === 'sequence');
  assert.deepEqual(seq.map((s) => s.coverage), pkgView().sequence.map((f) => f.coverage_id), 'chronological package order');
  assert.ok(seq.every((s) => s.frames === 39), 'equal playback per image (1.3 s)');
});

test('every frame labels exactly the coverages it shows, and cuts land on whole frames', () => {
  const tl = resolveTimeline(STORYBOARD, pkgView(), OPTS);
  for (let i = 0; i < tl.total_frames; i++) {
    const st = frameState(tl, i);
    assert.ok(i >= st.shot.start_frame && i < st.shot.end_frame);
    if (st.shot.kind !== 'compare') assert.deepEqual(st.visible, st.shot.layers);
    for (const sub of [0.25, 0.49]) assert.equal(frameState(tl, i, sub).shot.id, st.shot.id, 'motion-blur samples never cross a cut');
  }
  const compare = tl.shots.find((s) => s.kind === 'compare');
  assert.deepEqual(frameState(tl, compare.start_frame).visible, ['olistat'], 'before the wipe only A is visible and labelled');
  assert.deepEqual(frameState(tl, compare.end_frame - 1).visible, ['olistat', '2023']);
  assert.equal(frameState(tl, compare.end_frame - 1).wipe, 0.5);
});

test('frames are a pure function of their index (any order, any number of times)', () => {
  const tl = resolveTimeline(STORYBOARD, pkgView(), OPTS);
  const pick = [899, 0, 450, 37, 119, 120, 450];
  const a = pick.map((i) => JSON.stringify({ ...frameState(tl, i), shot: frameState(tl, i).shot.id }));
  const b = pick.map((i) => JSON.stringify({ ...frameState(tl, i), shot: frameState(tl, i).shot.id }));
  assert.deepEqual(a, b);
  assert.equal(a[2], a[6]);
});

test('the orthographic camera is identical through the sequence and the comparison', () => {
  const tl = resolveTimeline(STORYBOARD, pkgView(), OPTS);
  const cams = tl.shots.filter((s) => ['context', 'sequence', 'compare'].includes(s.kind))
    .flatMap((s) => [s.start_frame, s.end_frame - 1]).map((i) => JSON.stringify(frameState(tl, i).camera));
  assert.equal(new Set(cams).size, 1);
  const intro = tl.shots[0];
  const end = frameState(tl, intro.end_frame - 1, 0).camera;
  assert.ok(end.pose.tilt_deg < 0.05 && Math.abs(end.pose.distance - 1) < 0.01 && Math.abs(end.pose.heading_deg) < 0.02, 'intro settles at nadir, north up');
});

test('storyboards that would break spatial or temporal integrity are refused', () => {
  const p = pkgView();
  const base = (shot) => ({ shots: [shot] });
  const ortho = { type: 'orthographic', zoom: 1 };
  assert.throws(() => resolveTimeline(base({ id: 's', kind: 'sequence', per_frame_s: 1, coverages: ['2023', 'ams1956'], camera: ortho }), p, OPTS), /package order/);
  assert.throws(() => resolveTimeline(base({ id: 's', kind: 'sequence', per_frame_s: 1, camera: { type: 'orthographic', zoom_from: 1, zoom_to: 1.2 } }), p, OPTS), /fixed orthographic/);
  assert.throws(() => resolveTimeline(base({ id: 'c', kind: 'compare', duration_s: 2, a: '2023', b: 'latest', camera: ortho }), p, OPTS), /two different/);
  const steep = { type: 'perspective', fov_deg: 30, from: { target: [0, 0], distance: 1, tilt_deg: 60, heading_deg: 0 }, to: { target: [0, 0], distance: 1, tilt_deg: 0, heading_deg: 0 } };
  assert.throws(() => resolveTimeline(base({ id: 'i', kind: 'intro', duration_s: 2, coverage: 'reference', camera: steep }), p, OPTS), /moderate tilt/);
  assert.throws(() => resolveTimeline(base({ id: 'x', kind: 'context', duration_s: 2, coverage: 'nope', camera: ortho }), p, OPTS), /not a usable frame/);
});

test('the time mapping keeps playback time and historical dates apart', () => {
  const tl = resolveTimeline(STORYBOARD, pkgView(), OPTS);
  const rows = timeMapping(tl, pkgView().byId);
  const first = rows.find((r) => r.kind === 'sequence');
  assert.deepEqual(first.coverages[0], { coverage_id: 'ams1956', role: 'frame', date_label: '1956–57', date_kind: 'multi_year_flight', start_year: 1956, end_year: 1957 });
  assert.equal(first.video_frames[1] - first.video_frames[0], 39, '1.3 s of video at 30 fps');
});

test('integration: the real Gate 4B pilot package (set CINEMATIC_PACKAGE)', { skip: !process.env.CINEMATIC_PACKAGE }, () => {
  const p = loadPackage(process.env.CINEMATIC_PACKAGE);
  assert.equal(p.materialized.complete, true);
  assert.equal(p.reference.coverage_id, '2006');
  assert.deepEqual(p.sequence.map((f) => f.date.label), ['1956–57', '1997–98', '1997–2003', '2009', '2011', '2014', '2017', '2020', '2023']);
  const tl = resolveTimeline(STORYBOARD, p, OPTS);
  assert.equal(tl.total_frames, 900);
});
