// Gate 4D: elevation surface on the Gate 4C engine. Pure modules and a synthetic geometry package
// on disk (no LiDAR, no browser): mesh layout and units, the geometry contract, and the timeline's
// temporal rule. Render-time checks (texture on mesh, elevation round trip) are recorded in each
// render-manifest.json. Fixtures are SYNTHETIC numbers, never observations of Madrid.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sceneFrame, groundScale, perspectivePose } from '../research/geospatial_cinematic/lib/geo.mjs';
import {
  surfaceFrame, vertexXY, vertexUV, buildLayout, buildPositions, verticalUnitsPerMetre, metresToZ, zToMetres,
} from '../research/geospatial_cinematic/lib/surface.mjs';
import { loadGeometry, GeometryError } from '../research/geospatial_cinematic/lib/geometry.mjs';
import { resolveTimeline, frameState, StoryboardError, yearGap, MAX_TEXTURE_GEOMETRY_GAP_YEARS } from '../research/geospatial_cinematic/lib/timeline.mjs';

const BBOX = [-414969.329, 4922846.603, -411911.848, 4924757.528];
const W = 1280;
const H = 800;
const PX = (BBOX[2] - BBOX[0]) / W;
const PY = (BBOX[3] - BBOX[1]) / H;
const SPATIAL = { crs: 'EPSG:3857', bbox: BBOX, width: W, height: H };
const FRAME = sceneFrame(SPATIAL);
const sha = (b) => createHash('sha256').update(b).digest('hex');

function gridRecord({ col0 = 0, col1 = W, row0 = 0, row1 = 507 } = {}) {
  return {
    crs: 'EPSG:3857',
    window_texture_pixels: { col0, col1, row0, row1 },
    rows: row1 - row0, cols: col1 - col0,
    bbox_epsg3857: [BBOX[0] + col0 * PX, BBOX[3] - row1 * PY, BBOX[0] + col1 * PX, BBOX[3] - row0 * PY],
    pixel_size_mercator_units: [PX, PY],
  };
}

// ---------- mesh layout ----------

test('vertices sit on texture pixel centres, and each UV is its own pixel centre (north row = top)', () => {
  const g = gridRecord({ col0: 10, col1: 30, row0: 5, row1: 25 });
  const sf = surfaceFrame(FRAME, g);
  const [x00, y00] = vertexXY(sf, 0, 0);
  assert.ok(Math.abs(x00 - (BBOX[0] + 10.5 * PX - FRAME.origin[0])) < 1e-6);
  assert.ok(Math.abs(y00 - (BBOX[3] - 5.5 * PY - FRAME.origin[1])) < 1e-6);
  const [u, v] = vertexUV(sf, 0, 0);
  assert.ok(Math.abs(u - 10.5 / W) < 1e-12 && Math.abs(v - (1 - 5.5 / H)) < 1e-12);
  const [uL, vL] = vertexUV(sf, g.rows - 1, g.cols - 1);
  assert.ok(Math.abs(uL - 29.5 / W) < 1e-12 && Math.abs(vL - (1 - 24.5 / H)) < 1e-12);
  // +x east, +y north: later columns are east, later rows are south.
  assert.ok(vertexXY(sf, 0, 1)[0] > x00 && vertexXY(sf, 1, 0)[1] < y00);
  assert.ok(Math.abs(sf.width - (g.cols - 1) * PX) < 1e-6 && Math.abs(sf.height - (g.rows - 1) * PY) < 1e-6);
});

test('UV is the same linear map as scene position: texture and elevation cannot drift apart', () => {
  const sf = surfaceFrame(FRAME, gridRecord());
  for (const [r, c] of [[0, 0], [100, 700], [506, 1279], [250, 3]]) {
    const [x, y] = vertexXY(sf, r, c);
    const [u, v] = vertexUV(sf, r, c);
    // Where the flat Gate 4C plane samples the texture at the same scene point.
    const uPlane = (x + FRAME.width / 2) / FRAME.width;
    const vPlane = (y + FRAME.height / 2) / FRAME.height;
    assert.ok(Math.abs(u - uPlane) < 1e-9 && Math.abs(v - vPlane) < 1e-9, `${r},${c}`);
  }
});

test('the full window spans exactly the package width and the covered rows', () => {
  const sf = surfaceFrame(FRAME, gridRecord());
  assert.ok(Math.abs(sf.edges.west - -FRAME.width / 2) < 1e-6 && Math.abs(sf.edges.east - FRAME.width / 2) < 1e-6);
  assert.ok(Math.abs(sf.edges.north - FRAME.height / 2) < 1e-6);
  assert.ok(Math.abs(sf.edges.south - (FRAME.height / 2 - 507 * PY)) < 1e-6);
});

test('triangles cover the grid once and face up (+z)', () => {
  const g = gridRecord({ col0: 0, col1: 4, row0: 0, row1: 3 });
  const sf = surfaceFrame(FRAME, g);
  const { uv, index } = buildLayout(sf);
  assert.equal(uv.length, 12 * 2);
  assert.equal(index.length, (3 - 1) * (4 - 1) * 6);
  const pos = buildPositions(sf, new Float32Array(12).fill(600), 600, 1);
  for (let k = 0; k < index.length; k += 3) {
    const [a, b, c] = [index[k], index[k + 1], index[k + 2]].map((i) => [pos[i * 3], pos[i * 3 + 1]]);
    const crossZ = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    assert.ok(crossZ > 0, `triangle ${k / 3} faces down`);
  }
});

test('heights: z = (H - base) * zPerM, inverse exact; NoData never becomes a height', () => {
  const sf = surfaceFrame(FRAME, gridRecord({ col0: 0, col1: 2, row0: 0, row1: 2 }));
  const pos = buildPositions(sf, Float32Array.from([600, 610, 590.5, 600]), 600, 1.3);
  assert.deepEqual([pos[2], pos[5], pos[8], pos[11]].map((z) => Math.round(z * 1e4) / 1e4), [0, 13, -12.35, 0]);
  assert.ok(Math.abs(zToMetres(metresToZ(612.345, 584.1, 1.31), 584.1, 1.31) - 612.345) < 1e-9);
  assert.throws(() => buildPositions(sf, Float32Array.from([600, NaN, 600, 600]), 600, 1), /non-finite/);
  assert.throws(() => buildPositions(sf, new Float32Array(3), 600, 1), /expected 4/);
});

test('vertical exaggeration 1 keeps ground proportions: a metre up equals a metre across', () => {
  const ground = groundScale(FRAME.centreLonLat[1]);
  const zPerM = verticalUnitsPerMetre(ground);
  // Within the documented ~0.2 % residual anisotropy of the geometric mean.
  assert.ok(Math.abs(zPerM * ground.eastWest - 1) < 0.003);
  assert.ok(Math.abs(zPerM * ground.northSouth - 1) < 0.003);
  // Not the naive 1, which would flatten relief by cos(latitude), about 24 % at Madrid.
  assert.ok(zPerM > 1.3 && zPerM < 1.32);
});

test('a perspective pose on the surface window is centred on that window', () => {
  const sf = surfaceFrame(FRAME, gridRecord());
  const pose = perspectivePose(sf, 16 / 9, 30, { target: [0, 0], distance: 1, tilt_deg: 0, heading_deg: 0 });
  assert.ok(Math.abs(pose.target[0] - sf.centre[0]) < 1e-9 && Math.abs(pose.target[1] - sf.centre[1]) < 1e-9);
  // A frame without a centre (the Gate 4C package frame) keeps the origin.
  const flat = perspectivePose(FRAME, 16 / 9, 30, { target: [0, 0], distance: 1, tilt_deg: 0, heading_deg: 0 });
  assert.deepEqual(flat.target, [0, 0, 0]);
});

// ---------- geometry package contract ----------

const MAT_SHA = 'a'.repeat(64);
const PKG = { recordHashes: { 'materialized-manifest.json': MAT_SHA }, spatial: SPATIAL };

function buildGeometry(edit = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate4d-geom-'));
  const grid = gridRecord({ col0: 0, col1: 8, row0: 0, row1: 4 });
  const heights = { mds: new Float32Array(32).map((_, i) => 600 + i), mdt: new Float32Array(32).fill(598) };
  const files = {};
  const manifest = {
    schema: { id: 'urn:madrid-urban-evidence-lens:geometry-package', version: '0.1.0' },
    id: 'synthetic', version: '1.0.0', status: 'PASS',
    texture_package: { materialized_manifest_sha256: MAT_SHA },
    grid, files, acquisition: { start_year: 2024, end_year: 2024, label: 'mar–may 2024' }, vertical_base_m: 600,
    licence: { attribution: 'synthetic' }, validation: { points: [] },
  };
  const ctx = { dir, grid, heights, manifest, extraFile: null, after: null, buildings: null };
  edit(ctx);
  const names = [];
  for (const k of ['mds', 'mdt']) {
    const bytes = Buffer.from(ctx.heights[k].buffer);
    fs.writeFileSync(path.join(dir, `surface_${k}.f32`), bytes);
    files[k] = { file: `surface_${k}.f32`, sha256: sha(bytes) };
    names.push(`surface_${k}.f32`);
  }
  if (ctx.buildings) {
    const bytes = Buffer.from(JSON.stringify(ctx.buildings));
    fs.writeFileSync(path.join(dir, 'buildings.json'), bytes);
    manifest.buildings = { file: 'buildings.json', sha256: sha(bytes), attribution: 'synthetic' };
    names.push('buildings.json');
  }
  fs.writeFileSync(path.join(dir, 'geometry-manifest.json'), JSON.stringify(manifest));
  names.push('geometry-manifest.json');
  fs.writeFileSync(path.join(dir, 'checksums.sha256'), names.map((n) => `${sha(fs.readFileSync(path.join(dir, n)))}  ${n}\n`).join(''));
  if (ctx.extraFile) fs.writeFileSync(path.join(dir, ctx.extraFile), 'x');
  if (ctx.after) ctx.after(dir);
  return dir;
}

test('a consistent geometry package loads with its heights', () => {
  const g = loadGeometry(buildGeometry(), PKG);
  assert.equal(g.surfaces.mds.heights.length, 32);
  assert.equal(g.surfaces.mds.heights[5], 605);
  assert.equal(g.base_m, 600);
});

test('a geometry package that does not belong to this texture package or lattice is refused', () => {
  const expectCode = (dir, code) => assert.throws(() => loadGeometry(dir, PKG), (e) => e instanceof GeometryError && e.code === code);
  expectCode(buildGeometry((c) => { c.manifest.texture_package.materialized_manifest_sha256 = 'b'.repeat(64); }), 'TEXTURE_PACKAGE');
  expectCode(buildGeometry((c) => { c.manifest.status = 'FAIL'; }), 'STATUS');
  expectCode(buildGeometry((c) => { c.manifest.grid = { ...c.grid, bbox_epsg3857: c.grid.bbox_epsg3857.map((v) => v + 1) }; }), 'LATTICE');
  expectCode(buildGeometry((c) => { c.manifest.grid = { ...c.grid, window_texture_pixels: { col0: 1280, col1: 1288, row0: 0, row1: 4 } }; }), 'WINDOW');
  expectCode(buildGeometry((c) => { c.heights.mds[3] = NaN; }), 'NODATA');
  expectCode(buildGeometry((c) => { c.extraFile = 'stray.bin'; }), 'UNLISTED_FILE');
  expectCode(buildGeometry((c) => { c.after = (d) => { const p = path.join(d, 'surface_mdt.f32'); const b = fs.readFileSync(p); b[0] ^= 1; fs.writeFileSync(p, b); }; }), 'HASH_MISMATCH');
});

const PART = (dx = 0, roof = 620, base = 598) => {
  const [w, , , n] = gridRecord({ col0: 0, col1: 8, row0: 0, row1: 4 }).bbox_epsg3857;
  const x = w + 2 + dx; const y = n - 2;
  return { id: 'p1', floors_above_ground: 6, outer_epsg3857: [[x, y], [x + 3, y], [x + 3, y - 3], [x, y - 3], [x, y]], holes_epsg3857: [], roof_m: roof, base_m: base, ground_median_m: base };
};

test('LoD1 buildings load with the geometry and add the lod1 surface; bad parts are refused', () => {
  const g = loadGeometry(buildGeometry((c) => { c.buildings = [PART()]; }), PKG);
  assert.equal(g.buildings.parts.length, 1);
  assert.deepEqual(g.surfaceIds, ['mds', 'mdt', 'lod1']);
  assert.deepEqual(loadGeometry(buildGeometry(), PKG).surfaceIds, ['mds', 'mdt']);
  const expectCode = (dir, code) => assert.throws(() => loadGeometry(dir, PKG), (e) => e instanceof GeometryError && e.code === code);
  expectCode(buildGeometry((c) => { c.buildings = [PART(1000)]; }), 'WINDOW');
  expectCode(buildGeometry((c) => { c.buildings = [PART(0, 590, 598)]; }), 'BUILDINGS');
  expectCode(buildGeometry((c) => { c.buildings = [PART(0, NaN)]; }), 'NODATA');
});

// ---------- timeline: surface shots and the temporal rule ----------

const DATES = {
  2006: { kind: 'annual_mosaic', start_year: 2006, end_year: 2006, label: '2006' },
  ams1956: { kind: 'multi_year_flight', start_year: 1956, end_year: 1957, label: '1956–57' },
  2023: { kind: 'annual_mosaic', start_year: 2023, end_year: 2023, label: '2023' },
};
const TL_PKG = {
  reference: { coverage_id: '2006' },
  sequence: [{ coverage_id: 'ams1956' }, { coverage_id: '2023' }],
  usable: new Set(['2006', 'ams1956', '2023']),
  byId: Object.fromEntries(Object.entries(DATES).map(([id, date]) => [id, { coverage_id: id, role: id === '2006' ? 'reference' : 'frame', date }])),
};
const GEOM = { acquisition: { start_year: 2024, end_year: 2024, label: 'mar–may 2024' }, surfaces: ['mds', 'mdt', 'lod1'] };
const OPTS = { fps: 30, width: 960, height: 540 };
const pose = { target: [0, 0], distance: 0.5, tilt_deg: 58, heading_deg: 26 };
const surfaceShot = (extra = {}) => ({ id: 's', kind: 'surface', duration_s: 1, coverage: '2023', surface: 'mds', camera: { type: 'perspective', fov_deg: 30, from: pose, to: pose }, ...extra });

test('published-year gap between a texture and the geometry', () => {
  assert.equal(yearGap(DATES[2023], GEOM.acquisition), 1);
  assert.equal(yearGap(DATES.ams1956, GEOM.acquisition), 67);
  assert.equal(yearGap({ start_year: 2023, end_year: 2025 }, GEOM.acquisition), 0);
  assert.equal(MAX_TEXTURE_GEOMETRY_GAP_YEARS, 2);
});

test('a surface shot labels both the texture and the geometry it shows', () => {
  const tl = resolveTimeline({ shots: [surfaceShot()] }, TL_PKG, OPTS, GEOM);
  const st = frameState(tl, 0);
  assert.deepEqual(st.visible, ['2023', 'surface:mds']);
  assert.deepEqual(st.surface, { id: 'mds', relief: 1, shading: 'none' });
  const flat = frameState(resolveTimeline({ shots: [surfaceShot({ surface: 'flat' })] }, TL_PKG, OPTS, GEOM), 0);
  assert.deepEqual(flat.visible, ['2023', 'surface:flat']);
  assert.equal(flat.surface.relief, 0);
});

test('a historical texture on 2024 geometry is refused without an on-screen warning', () => {
  assert.throws(() => resolveTimeline({ shots: [surfaceShot({ coverage: 'ams1956' })] }, TL_PKG, OPTS, GEOM), (e) => e instanceof StoryboardError && /temporal_warning/.test(e.message));
  // With an explicit methodological warning it resolves, and the warning travels with the shot.
  const tl = resolveTimeline({ shots: [surfaceShot({ coverage: 'ams1956', temporal_warning: 'Edificios de 2024 bajo una foto de 1956: comparación metodológica' })] }, TL_PKG, OPTS, GEOM);
  assert.match(tl.shots[0].temporal_warning, /1956/);
  assert.equal(tl.shots[0].temporal_gap_years, 67);
  // The flat state carries no geometry, so any date is allowed on it.
  assert.doesNotThrow(() => resolveTimeline({ shots: [surfaceShot({ coverage: 'ams1956', surface: 'flat' })] }, TL_PKG, OPTS, GEOM));
});

test('surface settings that would hide or distort the geometry are refused', () => {
  const bad = (extra, re, geom = GEOM) => assert.throws(() => resolveTimeline({ shots: [surfaceShot(extra)] }, TL_PKG, OPTS, geom), (e) => e instanceof StoryboardError && re.test(e.message));
  bad({}, /geometry package/, null);
  bad({ surface: 'lod2' }, /surface must be/);
  bad({ vertical_exaggeration: 0.5 }, /vertical_exaggeration/);
  bad({ vertical_exaggeration: 4 }, /vertical_exaggeration/);
  bad({ shading: 'sunset' }, /shading/);
  bad({ camera: { type: 'orthographic', zoom: 1 } }, /perspective/);
  bad({ camera: { type: 'perspective', fov_deg: 30, from: pose, to: { ...pose, tilt_deg: 61 } } }, /tilt above 60/);
  // An exaggeration other than 1 is allowed but recorded on the shot (and drawn on screen).
  assert.equal(resolveTimeline({ shots: [surfaceShot({ vertical_exaggeration: 2 })] }, TL_PKG, OPTS, GEOM).shots[0].exaggeration, 2);
});

test('flat Gate 4C shots keep their 45 degree tilt limit', () => {
  const intro = { id: 'i', kind: 'intro', duration_s: 1, coverage: 'reference', camera: { type: 'perspective', fov_deg: 30, from: { ...pose, tilt_deg: 50, heading_deg: 0 }, to: { ...pose, tilt_deg: 0, heading_deg: 0 } } };
  assert.throws(() => resolveTimeline({ shots: [intro] }, TL_PKG, OPTS, GEOM), /tilt above 45/);
});

test('the 3D pilot storyboard uses LoD1 buildings, not the MDS surface, with 2023 texture on 2024 geometry', () => {
  const sb = JSON.parse(fs.readFileSync(new URL('../research/geospatial_cinematic/storyboards/madrid-rio-3d.json', import.meta.url), 'utf8'));
  const tl = resolveTimeline(sb, TL_PKG, OPTS, GEOM);
  assert.ok(tl.duration_s >= 10 && tl.duration_s <= 16, `${tl.duration_s}`);
  const surf = tl.shots.filter((s) => s.surface);
  assert.ok(surf.length >= 4);
  assert.ok(surf.every((s) => s.coverage === '2023' && s.temporal_gap_years <= MAX_TEXTURE_GEOMETRY_GAP_YEARS && s.exaggeration <= 1));
  assert.deepEqual(new Set(surf.map((s) => s.surface)), new Set(['lod1', 'mdt', 'flat']));
  // The three comparison states share one camera: only the surface changes at each cut.
  const cmp = tl.shots.filter((s) => s.id.startsWith('compare_'));
  assert.equal(new Set(cmp.map((s) => JSON.stringify(s.camera))).size, 1);
});
