// Reads and checks a Gate 4B frame package before anything is rendered (Node only).
// The package is only read: no file in it is opened for writing, renamed or touched.
// It is consumed as Gate 4B wrote it. No second data format is derived from it.
//
// Refused (PackageError): a missing or altered file, an unlisted file, records that disagree with
// each other, a CRS other than EPSG:3857, frames on different extents or image sizes, a date
// sequence out of order, a frame without licence or attribution.
// Not refused but kept out of the film: a frame whose status is not VALID_IMAGE or whose coverage
// is EMPTY_BLANK (listed in `excluded`). SUSPECTED_PARTIAL frames stay usable and are flagged.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sceneFrame } from './geo.mjs';

export const PACKAGE_SCHEMA_ID = 'urn:madrid-urban-evidence-lens:materialized-package';
export const PACKAGE_SCHEMA_VERSION = '1.0.0';
const RECORDS = ['source-manifest.json', 'materialized-manifest.json', 'validation-report.json'];
const DATE_KINDS = new Set(['annual_mosaic', 'multi_year_flight']);
const MERCATOR_MARKERS = [/Mercator_Auxiliary_Sphere/, /Pseudo-Mercator/, /AUTHORITY\["EPSG","3857"\]/, /EPSG&quot;,&quot;3857/];

export class PackageError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function parseChecksums(text) {
  const sums = new Map();
  for (const [n, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (!m) throw new PackageError('CHECKSUMS', `line ${n + 1} is not "<sha256>  <path>"`);
    const rel = m[2];
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new PackageError('CHECKSUMS', `unsafe path ${rel}`);
    if (sums.has(rel)) throw new PackageError('CHECKSUMS', `${rel} listed twice`);
    sums.set(rel, m[1]);
  }
  return sums;
}

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

// Width and height from the image header (JPEG SOFn or PNG IHDR), without decoding pixels.
export function imageSize(bytes) {
  if (bytes[0] === 0x89 && bytes.toString('latin1', 1, 4) === 'PNG') {
    return { format: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) { at += 1; continue; }
    const len = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { format: 'image/jpeg', height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    at += 2 + len;
  }
  return null;
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const sameNumbers = (a, b, tol) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => near(x, b[i], tol));

function checkSpatial(spatial, source) {
  if (spatial?.crs !== 'EPSG:3857') throw new PackageError('CRS', `expected EPSG:3857, got ${spatial?.crs}`);
  const [minE, minN, maxE, maxN] = spatial.bbox || [];
  if (![minE, minN, maxE, maxN].every(Number.isFinite) || !(maxE > minE && maxN > minN)) throw new PackageError('EXTENT', 'bbox is not [minE, minN, maxE, maxN]');
  const { width, height } = spatial;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new PackageError('DIMENSIONS', 'width/height must be positive integers');
  const px = (maxE - minE) / width;
  const py = (maxN - minN) / height;
  if (!sameNumbers(spatial.pixel_size_mercator_units, [px, py], 1e-9)) throw new PackageError('EXTENT', 'pixel size disagrees with bbox / image size');
  if (!sameNumbers(spatial.gdal_geotransform, [minE, px, 0, maxN, 0, -py], 1e-6)) throw new PackageError('EXTENT', 'GDAL geotransform disagrees with bbox');
  if (!sameNumbers(spatial.world_file, [px, 0, 0, -py, minE + px / 2, maxN - py / 2], 1e-6)) throw new PackageError('EXTENT', 'world file disagrees with bbox (pixel centres)');
  if (source.view?.crs !== 'EPSG:3857' || !sameNumbers(source.view?.bbox, spatial.bbox, 1e-6)) throw new PackageError('EXTENT', 'source manifest view bbox differs from the package extent');
  if (source.image?.width !== width || source.image?.height !== height) throw new PackageError('DIMENSIONS', 'source manifest image size differs from the package');
}

function checkDate(date, id) {
  if (!date || !DATE_KINDS.has(date.kind)) throw new PackageError('DATE', `${id}: unknown date kind ${date?.kind}`);
  if (!Number.isInteger(date.start_year) || !Number.isInteger(date.end_year) || date.start_year > date.end_year) throw new PackageError('DATE', `${id}: bad year interval`);
  if (date.kind === 'annual_mosaic' && date.start_year !== date.end_year) throw new PackageError('DATE', `${id}: an annual mosaic spans one year`);
  if (typeof date.label !== 'string' || !date.label.trim()) throw new PackageError('DATE', `${id}: no published date label`);
}

export function loadPackage(dirInput) {
  const dir = path.resolve(dirInput);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new PackageError('MISSING_FILE', `no package directory at ${dir}`);
  const read = (rel) => {
    const full = path.join(dir, rel);
    if (!fs.existsSync(full)) throw new PackageError('MISSING_FILE', rel);
    return fs.readFileSync(full);
  };
  const checksumBytes = read('checksums.sha256');
  const sums = parseChecksums(checksumBytes.toString('utf8'));

  // 1. Every listed file exists and matches; nothing else is in the package.
  const fileHashes = {};
  for (const [rel, expected] of sums) {
    const actual = sha256(read(rel));
    if (actual !== expected) throw new PackageError('HASH_MISMATCH', `${rel} differs from checksums.sha256`);
    fileHashes[rel] = actual;
  }
  for (const rel of walk(dir)) {
    if (rel !== 'checksums.sha256' && !sums.has(rel)) throw new PackageError('UNLISTED_FILE', `${rel} is not in checksums.sha256`);
  }
  for (const rel of RECORDS) if (!sums.has(rel)) throw new PackageError('CHECKSUMS', `${rel} is not covered by checksums.sha256`);

  const json = (rel) => {
    try { return JSON.parse(read(rel).toString('utf8')); } catch (e) { throw new PackageError('JSON', `${rel}: ${e.message}`); }
  };
  const source = json('source-manifest.json');
  const m = json('materialized-manifest.json');
  const report = json('validation-report.json');

  // 2. Records agree with each other.
  if (m.schema?.id !== PACKAGE_SCHEMA_ID || m.schema?.version !== PACKAGE_SCHEMA_VERSION) {
    throw new PackageError('SCHEMA', `expected ${PACKAGE_SCHEMA_ID} ${PACKAGE_SCHEMA_VERSION}`);
  }
  if (m.source_manifest?.sha256 !== fileHashes['source-manifest.json']) throw new PackageError('HASH_MISMATCH', 'materialized manifest records another source manifest');
  checkSpatial(m.spatial, source);
  if (report.complete !== m.complete) throw new PackageError('REPORT_MISMATCH', 'validation report and manifest disagree on completeness');

  const order = m.order || {};
  if (typeof order.reference !== 'string' || !Array.isArray(order.sequence)) throw new PackageError('ORDER', 'order.reference / order.sequence missing');
  if (new Set(order.sequence).size !== order.sequence.length || order.sequence.includes(order.reference)) throw new PackageError('ORDER', 'duplicate coverage in order');
  const frames = m.frames || [];
  const refs = frames.filter((f) => f.role === 'reference');
  if (refs.length !== 1 || refs[0].coverage_id !== order.reference) throw new PackageError('REFERENCE', 'exactly one reference frame, equal to order.reference, is required');
  const seqFrames = frames.filter((f) => f.role === 'frame');
  if (seqFrames.length !== order.sequence.length || frames.length !== order.sequence.length + 1) throw new PackageError('ORDER', 'frames do not match order.sequence');
  order.sequence.forEach((id, i) => {
    const f = seqFrames.find((x) => x.coverage_id === id);
    if (!f || f.sequence_index !== i) throw new PackageError('ORDER', `${id} is not at sequence position ${i}`);
  });
  const reportById = Object.fromEntries((report.frames || []).map((f) => [f.coverage_id, f]));

  const byId = {};
  const excluded = [];
  const warnings = [];
  for (const f of frames) {
    const id = f.coverage_id;
    checkDate(f.date, id);
    if (!f.licence?.name || !f.attribution?.trim()) throw new PackageError('LICENCE', `${id}: licence or attribution missing`);
    if (f.crs !== m.spatial.crs || !sameNumbers(f.bbox, m.spatial.bbox, 1e-9) || f.width !== m.spatial.width || f.height !== m.spatial.height) {
      throw new PackageError('EXTENT', `${id}: frame geometry differs from the package extent`);
    }
    const r = reportById[id];
    if (!r || r.status !== f.status || r.coverage?.state !== f.coverage?.state) throw new PackageError('REPORT_MISMATCH', `${id}: validation report disagrees`);
    byId[id] = f;
    const state = f.coverage?.state;
    if (f.status !== 'VALID_IMAGE') { excluded.push({ coverage_id: id, reason: `status ${f.status}` }); continue; }
    if (state === 'EMPTY_BLANK') { excluded.push({ coverage_id: id, reason: 'coverage EMPTY_BLANK' }); continue; }
    if (state === 'SUSPECTED_PARTIAL') warnings.push(`${id}: SUSPECTED_PARTIAL coverage, shown with an on-screen flag`);

    // 3. The image and its georeferencing sidecars are the recorded bytes.
    if (fileHashes[f.file] !== f.sha256) throw new PackageError('HASH_MISMATCH', `${id}: ${f.file} hash differs from its frame record`);
    const size = imageSize(read(f.file));
    if (!size || size.width !== f.width || size.height !== f.height) throw new PackageError('DIMENSIONS', `${id}: image header is ${size?.width}x${size?.height}`);
    const sidecars = f.sidecars || {};
    for (const ext of ['.prj', '.aux.xml']) {
      const rel = Object.keys(sidecars).find((k) => k.endsWith(ext));
      if (!rel || fileHashes[rel] !== sidecars[rel]) throw new PackageError('SIDECAR', `${id}: ${ext} sidecar missing or altered`);
      const text = read(rel).toString('utf8');
      if (!MERCATOR_MARKERS.some((re) => re.test(text))) throw new PackageError('CRS', `${id}: ${rel} does not declare Web Mercator`);
    }
    const worldRel = Object.keys(sidecars).find((k) => /\.(jgw|pgw|wld)$/.test(k));
    if (!worldRel || fileHashes[worldRel] !== sidecars[worldRel]) throw new PackageError('SIDECAR', `${id}: world file missing or altered`);
    const world = read(worldRel).toString('utf8').trim().split(/\s+/).map(Number);
    if (!sameNumbers(world, m.spatial.world_file, 1e-6)) throw new PackageError('SIDECAR', `${id}: world file disagrees with the package extent`);
  }

  const usable = new Set(Object.keys(byId).filter((id) => !excluded.some((e) => e.coverage_id === id)));
  const sequence = order.sequence.filter((id) => usable.has(id)).map((id) => byId[id]);
  // 4. The usable sequence is in historical order (start year, then end year).
  for (let i = 1; i < sequence.length; i++) {
    const a = sequence[i - 1].date;
    const b = sequence[i].date;
    if (b.start_year < a.start_year || (b.start_year === a.start_year && b.end_year < a.end_year)) {
      throw new PackageError('ORDER', `${sequence[i].coverage_id} (${b.label}) precedes ${sequence[i - 1].coverage_id} (${a.label})`);
    }
  }
  if (!m.complete) warnings.push('package is not complete: missing frames are left out, never filled');

  return {
    dir,
    id: `${m.schema.id}#source-sha256:${m.source_manifest.sha256}`,
    materialized: m,
    source,
    report,
    spatial: m.spatial,
    frame: sceneFrame(m.spatial),
    service: m.service,
    reference: byId[order.reference],
    sequence,
    usable,
    byId,
    excluded,
    warnings,
    recordHashes: {
      'source-manifest.json': fileHashes['source-manifest.json'],
      'materialized-manifest.json': fileHashes['materialized-manifest.json'],
      'validation-report.json': fileHashes['validation-report.json'],
      'checksums.sha256': sha256(checksumBytes),
    },
    fileHashes,
  };
}
