// Gate 4D: reads and checks a geometry package before anything is rendered (Node only).
// The package is only read. It must have been materialized for this very texture package:
// same materialized-manifest bytes, same EPSG:3857 extent and lattice. Refused (GeometryError):
// a missing, altered or unlisted file, a manifest that is not PASS, a grid that does not fit the
// texture lattice, a grid file of the wrong size or with a non-finite value.
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './package.mjs';

export const GEOMETRY_SCHEMA_ID = 'urn:madrid-urban-evidence-lens:geometry-package';
export const SURFACES = ['mds', 'mdt'];

export class GeometryError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.code = code; }
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;

export function loadGeometry(dirInput, pkg) {
  const dir = path.resolve(dirInput);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new GeometryError('MISSING_FILE', `no geometry directory at ${dir}`);
  const read = (rel) => {
    const full = path.join(dir, rel);
    if (!fs.existsSync(full)) throw new GeometryError('MISSING_FILE', rel);
    return fs.readFileSync(full);
  };
  const sums = new Map();
  for (const line of read('checksums.sha256').toString('utf8').split(/\r?\n/).filter((l) => l.trim())) {
    const m = /^([0-9a-f]{64}) [ *]([\w.-]+)$/.exec(line.trim());
    if (!m) throw new GeometryError('CHECKSUMS', `bad line "${line}"`);
    sums.set(m[2], m[1]);
  }
  const fileHashes = {};
  for (const [rel, expected] of sums) {
    const actual = sha256(read(rel));
    if (actual !== expected) throw new GeometryError('HASH_MISMATCH', `${rel} differs from checksums.sha256`);
    fileHashes[rel] = actual;
  }
  for (const rel of fs.readdirSync(dir)) {
    if (rel !== 'checksums.sha256' && !sums.has(rel)) throw new GeometryError('UNLISTED_FILE', rel);
  }
  if (!sums.has('geometry-manifest.json')) throw new GeometryError('CHECKSUMS', 'geometry-manifest.json is not covered');
  const manifestBytes = read('geometry-manifest.json');
  const m = JSON.parse(manifestBytes.toString('utf8'));
  if (m.schema?.id !== GEOMETRY_SCHEMA_ID) throw new GeometryError('SCHEMA', `expected ${GEOMETRY_SCHEMA_ID}`);
  if (m.status !== 'PASS') throw new GeometryError('STATUS', `geometry manifest status is ${m.status}, not PASS`);

  // Materialized for this texture package, on its lattice.
  const tp = m.texture_package || {};
  if (tp.materialized_manifest_sha256 !== pkg.recordHashes['materialized-manifest.json']) {
    throw new GeometryError('TEXTURE_PACKAGE', 'geometry was materialized for another texture package (materialized-manifest.json hash differs)');
  }
  const g = m.grid;
  const sp = pkg.spatial;
  if (g.crs !== sp.crs) throw new GeometryError('CRS', `grid ${g.crs} vs texture ${sp.crs}`);
  const [minE, minN, maxE, maxN] = sp.bbox;
  const px = (maxE - minE) / sp.width;
  const py = (maxN - minN) / sp.height;
  const w = g.window_texture_pixels;
  if (!(w.col0 >= 0 && w.row0 >= 0 && w.col1 <= sp.width && w.row1 <= sp.height && w.col1 - w.col0 === g.cols && w.row1 - w.row0 === g.rows)) {
    throw new GeometryError('WINDOW', 'grid window is not inside the texture lattice');
  }
  const expected = [minE + w.col0 * px, maxN - w.row1 * py, minE + w.col1 * px, maxN - w.row0 * py];
  if (!g.bbox_epsg3857.every((v, i) => near(v, expected[i], 1e-6)) || !near(g.pixel_size_mercator_units[0], px, 1e-9) || !near(g.pixel_size_mercator_units[1], py, 1e-9)) {
    throw new GeometryError('LATTICE', 'grid bbox / pixel size are not the texture lattice');
  }

  const surfaces = {};
  for (const key of SURFACES) {
    const f = m.files[key];
    if (!f || fileHashes[f.file] !== f.sha256) throw new GeometryError('HASH_MISMATCH', `${key}: file record and checksums disagree`);
    const bytes = read(f.file);
    if (bytes.length !== g.rows * g.cols * 4) throw new GeometryError('DIMENSIONS', `${key}: ${bytes.length} bytes for ${g.rows} x ${g.cols} float32`);
    const heights = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    for (let i = 0; i < heights.length; i++) if (!Number.isFinite(heights[i])) throw new GeometryError('NODATA', `${key}: non-finite value at ${i}`);
    surfaces[key] = { file: f.file, sha256: f.sha256, bytes: bytes.length, heights };
  }
  // Optional LoD1 buildings (Catastro footprints x LiDAR heights).
  let buildings = null;
  if (m.buildings) {
    const b = m.buildings;
    if (fileHashes[b.file] !== b.sha256) throw new GeometryError('HASH_MISMATCH', 'buildings: file record and checksums disagree');
    const bytes = read(b.file);
    const parts = JSON.parse(bytes.toString('utf8'));
    const [w, s, e, n] = g.bbox_epsg3857;
    for (const p of parts) {
      const nums = [p.roof_m, p.base_m, ...p.outer_epsg3857.flat(), ...p.holes_epsg3857.flat(2)];
      if (!nums.every(Number.isFinite)) throw new GeometryError('NODATA', `buildings: non-finite value in ${p.id}`);
      if (!(p.roof_m > p.base_m)) throw new GeometryError('BUILDINGS', `${p.id}: roof below base`);
      if (!p.outer_epsg3857.every(([x, y]) => x >= w && x <= e && y >= s && y <= n)) throw new GeometryError('WINDOW', `${p.id}: footprint outside the window`);
    }
    buildings = { file: b.file, sha256: b.sha256, bytes: bytes.length, parts };
  }
  return {
    dir, manifest: m, manifestSha256: sha256(manifestBytes), fileHashes, surfaces, grid: g, buildings,
    surfaceIds: [...SURFACES, ...(buildings ? ['lod1'] : [])],
    acquisition: m.acquisition, base_m: m.vertical_base_m,
  };
}
