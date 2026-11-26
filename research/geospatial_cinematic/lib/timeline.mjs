// Storyboard (declarative JSON) + verified package -> frame-exact timeline.
// Every video frame is a pure function of its index: frameState(timeline, i) never reads a clock,
// a random number or the previous frame. Pure ES module, used by the page, the CLI and the tests.
//
// Two clocks are kept apart on purpose:
//   playback time  frame index / fps, seconds of video
//   historical time the frame's published date (a mosaic year or a multi-year flight interval)
// A shot of equal length per image does not mean equal steps in history.

export const EASE = {
  linear: (k) => k,
  easeInOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  easeOut: (k) => 1 - Math.pow(1 - k, 3),
};
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const seg = (t, a, b) => (b <= a ? (t >= b ? 1 : 0) : clamp01((t - a) / (b - a)));
const lerp = (a, b, k) => a + (b - a) * k;

const KINDS = new Set(['intro', 'context', 'sequence', 'compare', 'closing', 'surface', 'surface_closing']);
const SURFACE_KINDS = new Set(['surface', 'surface_closing']);
export const isSurfaceKind = (kind) => SURFACE_KINDS.has(kind);
// Gate 4D temporal rule: a texture may be draped on an elevation surface only when its published
// years are within this many years of the geometry's acquisition years. Anything further apart
// (e.g. a 1956 photo on 2024 buildings) is refused unless the shot carries an explicit warning.
export const MAX_TEXTURE_GEOMETRY_GAP_YEARS = 2;
export const MAX_VERTICAL_EXAGGERATION = 3;
const SHADINGS = new Set(['none', 'illustrative']);
const TRANSITIONS = new Set(['cut', 'dissolve']);

// Opacity of the incoming coverage on transition frame j of n (0-based): a linear cross-fade,
// strictly between 0 and 1. With n = 24 it runs 0.04 ... 0.96, so every transition frame is a
// measurable blend in the encoded video and every hold frame is an original image. (An eased curve
// would put the first and last frames below what the MP4 check can tell from an original.)
export const dissolveAlpha = (j, n) => (j + 1) / (n + 1);

export class StoryboardError extends Error {}

function resolveCoverage(ref, pkg, where) {
  if (ref === 'reference') return pkg.reference.coverage_id;
  if (ref === 'earliest' || ref === 'latest') {
    if (!pkg.sequence.length) throw new StoryboardError(`${where}: no usable sequence frame for "${ref}"`);
    return (ref === 'earliest' ? pkg.sequence[0] : pkg.sequence[pkg.sequence.length - 1]).coverage_id;
  }
  if (!pkg.usable.has(ref)) {
    throw new StoryboardError(`${where}: coverage "${ref}" is not a usable frame of this package`);
  }
  return ref;
}

function frameCount(seconds, fps, where) {
  if (!(seconds > 0)) throw new StoryboardError(`${where}: duration must be > 0`);
  return Math.max(1, Math.round(seconds * fps));
}

function checkCamera(cam, where, maxTilt = 45) {
  if (!cam || !['perspective', 'orthographic'].includes(cam.type)) {
    throw new StoryboardError(`${where}: camera.type must be "perspective" or "orthographic"`);
  }
  if (cam.ease && !EASE[cam.ease]) throw new StoryboardError(`${where}: unknown ease "${cam.ease}"`);
  if (cam.type === 'perspective') {
    if (!(cam.fov_deg >= 15 && cam.fov_deg <= 60)) throw new StoryboardError(`${where}: one lens, fov_deg between 15 and 60`);
    for (const key of ['from', 'to']) {
      const p = cam[key];
      if (!p || !Array.isArray(p.target) || !(p.distance > 0)) throw new StoryboardError(`${where}: camera.${key} needs target and distance`);
      if (Math.abs(p.tilt_deg) > maxTilt) throw new StoryboardError(`${where}: tilt above ${maxTilt} degrees is not a moderate tilt`);
      if (Math.abs(p.heading_deg) > 30) throw new StoryboardError(`${where}: heading above 30 degrees is not a moderate rotation`);
    }
  }
}

// Published-year distance between two date intervals (0 when they overlap).
export function yearGap(a, b) {
  if (a.end_year < b.start_year) return b.start_year - a.end_year;
  if (a.start_year > b.end_year) return a.start_year - b.end_year;
  return 0;
}

// pkg: { reference, sequence: [usable frame records in package order], usable: Set(ids), byId }
// geometry (optional, Gate 4D): { acquisition: { start_year, end_year, label }, surfaces: ['mds', 'mdt'] }
export function resolveTimeline(storyboard, pkg, { fps, width, height }, geometry = null) {
  if (!Array.isArray(storyboard.shots) || !storyboard.shots.length) throw new StoryboardError('storyboard has no shots');
  const shots = [];
  let cursor = 0;
  const push = (shot) => {
    shot.start_frame = cursor;
    shot.end_frame = cursor + shot.frames;
    shot.start_s = cursor / fps;
    shot.end_s = shot.end_frame / fps;
    cursor = shot.end_frame;
    shots.push(shot);
  };
  storyboard.shots.forEach((spec, index) => {
    const where = `shots[${index}] (${spec.id})`;
    if (!KINDS.has(spec.kind)) throw new StoryboardError(`${where}: unknown kind "${spec.kind}"`);
    // Surface shots may tilt further (60 degrees) so that relief is visible; flat shots keep 45.
    checkCamera(spec.camera, where, SURFACE_KINDS.has(spec.kind) ? 60 : 45);
    if (SURFACE_KINDS.has(spec.kind)) {
      if (!geometry) throw new StoryboardError(`${where}: a surface shot needs a geometry package (--geometry)`);
      if (spec.camera.type !== 'perspective') throw new StoryboardError(`${where}: a surface shot uses the perspective camera`);
      const surface = spec.surface;
      if (surface !== 'flat' && !geometry.surfaces.includes(surface)) throw new StoryboardError(`${where}: surface must be "flat" or one of ${geometry.surfaces.join(', ')}`);
      const exaggeration = spec.vertical_exaggeration ?? 1;
      if (!(exaggeration >= 1 && exaggeration <= MAX_VERTICAL_EXAGGERATION)) throw new StoryboardError(`${where}: vertical_exaggeration must be between 1 and ${MAX_VERTICAL_EXAGGERATION}`);
      const shading = spec.shading ?? 'none';
      if (!SHADINGS.has(shading)) throw new StoryboardError(`${where}: shading must be "none" or "illustrative"`);
      const coverage = resolveCoverage(spec.coverage, pkg, where);
      const gap = yearGap(pkg.byId[coverage].date, geometry.acquisition);
      const warning = typeof spec.temporal_warning === 'string' && spec.temporal_warning.trim() ? spec.temporal_warning.trim() : null;
      if (surface !== 'flat' && gap > MAX_TEXTURE_GEOMETRY_GAP_YEARS && !warning) {
        throw new StoryboardError(`${where}: texture ${pkg.byId[coverage].date.label} is ${gap} years from the geometry (${geometry.acquisition.label}); `
          + `more than ${MAX_TEXTURE_GEOMETRY_GAP_YEARS} needs an explicit temporal_warning shown on screen`);
      }
      push({
        id: spec.id, kind: spec.kind, group: spec.id, frames: frameCount(spec.duration_s, fps, where), coverage, layers: [coverage],
        camera: spec.camera, surface, exaggeration: surface === 'flat' ? 0 : exaggeration, shading, temporal_gap_years: gap, temporal_warning: warning, spec,
      });
      return;
    }
    if (spec.kind === 'sequence') {
      if (spec.camera.type !== 'orthographic' || spec.camera.zoom_to !== undefined) {
        throw new StoryboardError(`${where}: the historical sequence must use one fixed orthographic camera`);
      }
      const ids = spec.coverages === 'all' || spec.coverages === undefined
        ? pkg.sequence.map((f) => f.coverage_id)
        : spec.coverages.map((ref) => resolveCoverage(ref, pkg, where));
      const order = pkg.sequence.map((f) => f.coverage_id);
      let last = -1;
      for (const id of ids) {
        const at = order.indexOf(id);
        if (at <= last) throw new StoryboardError(`${where}: coverages must follow the package order (${order.join(', ')})`);
        last = at;
      }
      if (!ids.length) throw new StoryboardError(`${where}: no usable frame to show`);
      const transition = spec.transition || { type: 'cut' };
      if (!TRANSITIONS.has(transition.type)) throw new StoryboardError(`${where}: transition.type must be "cut" or "dissolve"`);
      if (transition.type === 'dissolve' && !(transition.duration_s >= 0.2 && transition.duration_s <= 2)) {
        throw new StoryboardError(`${where}: a dissolve lasts 0.2-2 s`);
      }
      ids.forEach((id, i) => {
        push({
          id: `${spec.id}:${id}`, kind: 'sequence', group: spec.id, frames: frameCount(spec.per_frame_s, fps, where),
          coverage: id, layers: [id], camera: spec.camera, sequence_index: i, sequence_count: ids.length, spec,
        });
        // A dissolve is its own shot between two original holds: only the two original textures,
        // mixed by opacity, on the same plane and camera. No image in between is generated.
        if (transition.type === 'dissolve' && i < ids.length - 1) {
          push({
            id: `${spec.id}:${id}>${ids[i + 1]}`, kind: 'transition', group: spec.id, frames: frameCount(transition.duration_s, fps, where),
            coverage: null, layers: [id, ids[i + 1]], a: id, b: ids[i + 1], camera: spec.camera,
            transition: { type: 'dissolve', duration_s: transition.duration_s, curve: 'linear (j + 1) / (n + 1)' },
            sequence_index: i, sequence_count: ids.length, spec,
          });
        }
      });
      return;
    }
    const frames = frameCount(spec.duration_s, fps, where);
    if (spec.kind === 'compare') {
      if (spec.camera.type !== 'orthographic' || spec.camera.zoom_to !== undefined) {
        throw new StoryboardError(`${where}: a comparison must use one fixed orthographic camera`);
      }
      const a = resolveCoverage(spec.a, pkg, where);
      const b = resolveCoverage(spec.b, pkg, where);
      if (a === b) throw new StoryboardError(`${where}: compare needs two different coverages`);
      push({ id: spec.id, kind: 'compare', group: spec.id, frames, coverage: null, layers: [a, b], a, b, camera: spec.camera, wipe: spec.wipe, spec });
      return;
    }
    const coverage = resolveCoverage(spec.coverage, pkg, where);
    push({ id: spec.id, kind: spec.kind, group: spec.id, frames, coverage, layers: [coverage], camera: spec.camera, spec });
  });
  return { fps, width, height, aspect: width / height, total_frames: cursor, duration_s: cursor / fps, shots };
}

export function shotAt(timeline, i) {
  if (!Number.isInteger(i) || i < 0 || i >= timeline.total_frames) throw new RangeError(`frame ${i} outside 0..${timeline.total_frames - 1}`);
  // The shot is chosen from the integer frame index only, so sub-frame samples never cross a cut.
  return timeline.shots.find((s) => i >= s.start_frame && i < s.end_frame);
}

function moveProgress(cam, localS, durationS) {
  const ease = EASE[cam.ease || 'easeInOut'];
  return ease(seg(localS, cam.start_s ?? 0, cam.end_s ?? durationS));
}

// sub: fraction of a frame (0 <= sub < 1) for motion-blur samples of camera moves.
export function frameState(timeline, i, sub = 0) {
  const shot = shotAt(timeline, i);
  const localS = (i - shot.start_frame + sub) / timeline.fps;
  const durationS = shot.frames / timeline.fps;
  const cam = shot.camera;
  let camera;
  if (cam.type === 'perspective') {
    const k = moveProgress(cam, localS, durationS);
    camera = {
      type: 'perspective', fov_deg: cam.fov_deg, progress: k,
      pose: {
        target: [lerp(cam.from.target[0], cam.to.target[0], k), lerp(cam.from.target[1], cam.to.target[1], k)],
        distance: lerp(cam.from.distance, cam.to.distance, k),
        tilt_deg: lerp(cam.from.tilt_deg, cam.to.tilt_deg, k),
        heading_deg: lerp(cam.from.heading_deg, cam.to.heading_deg, k),
      },
    };
  } else {
    const from = cam.zoom ?? cam.zoom_from ?? 1;
    const to = cam.zoom_to ?? from;
    const k = from === to ? 0 : moveProgress(cam, localS, durationS);
    camera = { type: 'orthographic', zoom: lerp(from, to, k), centre: [0, 0] };
  }
  let wipe = null;
  if (shot.kind === 'compare') {
    const w = shot.wipe || { from: 0.5, to: 0.5 };
    wipe = lerp(w.from, w.to, EASE[w.ease || 'easeInOut'](seg(localS, w.start_s ?? 0, w.end_s ?? 0)));
  }
  const mix = shot.kind === 'transition'
    ? { a: shot.a, b: shot.b, alpha: dissolveAlpha(i - shot.start_frame, shot.frames) }
    : null;
  // What the picture shows. The page must label exactly these coverages on this frame.
  // A surface shot also shows a geometry: its label ("surface:<id>") must be drawn on the same frame.
  const visible = shot.kind === 'compare'
    ? [wipe > 0 ? shot.a : null, wipe < 1 ? shot.b : null].filter(Boolean)
    : SURFACE_KINDS.has(shot.kind) ? [...shot.layers, `surface:${shot.surface}`] : shot.layers.slice();
  const surface = SURFACE_KINDS.has(shot.kind) ? { id: shot.surface, relief: shot.exaggeration, shading: shot.shading } : null;
  return {
    frame: i, t: (i + sub) / timeline.fps, local_s: localS, duration_s: durationS,
    shot, camera, wipe, mix, surface, layers: shot.layers.slice(), visible,
    // An original frame shows source images as they are; a transition frame is an opacity blend.
    frame_type: mix ? 'transition' : 'original',
  };
}

// Playback time <-> historical coverage, one row per shot, for the render manifest.
export function timeMapping(timeline, byId) {
  return timeline.shots.map((s) => ({
    shot: s.id,
    kind: s.kind,
    video_frames: [s.start_frame, s.end_frame],
    video_seconds: [round(s.start_s), round(s.end_s)],
    ...(SURFACE_KINDS.has(s.kind) ? { surface: s.surface, vertical_exaggeration: s.exaggeration, texture_geometry_gap_years: s.temporal_gap_years } : {}),
    coverages: s.layers.map((id) => ({
      coverage_id: id,
      role: byId[id].role,
      date_label: byId[id].date.label,
      date_kind: byId[id].date.kind,
      start_year: byId[id].date.start_year,
      end_year: byId[id].date.end_year,
    })),
  }));
}

const round = (x) => Math.round(x * 1e6) / 1e6;
