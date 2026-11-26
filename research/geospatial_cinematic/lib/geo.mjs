// Spatial frame of a Gate 4B package and the camera maths of the scene.
// Pure functions, no dependencies: the renderer page, the CLI and the tests all import this file.
//
// Scene coordinates (documented in README.md):
//   origin  = centre of the package bbox, in EPSG:3857 (Web Mercator) metres
//   x       = easting  - origin easting   (+x = east)
//   y       = northing - origin northing  (+y = north)
//   z       = up, out of the image plane  (the image lies flat on z = 0)
//   1 scene unit = 1 Web Mercator metre. That is NOT a ground metre: see groundScale().
// Subtracting the origin keeps every coordinate within a few kilometres, so 32-bit GPU floats
// keep sub-millimetre precision instead of losing it on values near 4.9e6.

export const WEB_MERCATOR_RADIUS = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const DEG = Math.PI / 180;

export function mercatorToLonLat(easting, northing) {
  const lon = (easting / WEB_MERCATOR_RADIUS) / DEG;
  const lat = (2 * Math.atan(Math.exp(northing / WEB_MERCATOR_RADIUS)) - Math.PI / 2) / DEG;
  return [lon, lat];
}

export function sceneFrame(spatial) {
  const [minE, minN, maxE, maxN] = spatial.bbox;
  const origin = [(minE + maxE) / 2, (minN + maxN) / 2];
  const width = maxE - minE;
  const height = maxN - minN;
  return {
    crs: spatial.crs,
    origin,
    width,
    height,
    aspect: width / height,
    pixels: [spatial.width, spatial.height],
    centreLonLat: mercatorToLonLat(origin[0], origin[1]),
  };
}

export function toScene(frame, easting, northing) {
  return [easting - frame.origin[0], northing - frame.origin[1]];
}

// Ground metres per Web Mercator metre at a latitude, on the WGS84 ellipsoid.
// EPSG:3857 projects WGS84 latitude as if the Earth were a sphere, so it is not conformal: the
// east-west and north-south factors differ (about 0.4 % at Madrid). `spherical` is the cos(lat)
// approximation that `approx_ground_m_per_pixel_at_centre` in Gate 4B uses.
export function groundScale(latDeg) {
  const phi = latDeg * DEG;
  const s2 = Math.sin(phi) ** 2;
  const w = 1 - WGS84_E2 * s2;
  return {
    eastWest: Math.cos(phi) / Math.sqrt(w),
    northSouth: ((1 - WGS84_E2) * Math.cos(phi)) / w ** 1.5,
    spherical: Math.cos(phi),
  };
}

// Half-height (scene units) that fits the whole extent inside a viewport of `aspect` (contain fit).
export function fitHalfHeight(frame, aspect) {
  return Math.max(frame.height / 2, frame.width / 2 / aspect);
}

// --- Orthographic camera: always looks straight down, north up -------------------------------

export function orthoView(frame, aspect, zoom = 1, centre = [0, 0]) {
  const halfHeight = fitHalfHeight(frame, aspect) / zoom;
  return { type: 'orthographic', centre, halfHeight, halfWidth: halfHeight * aspect, zoom };
}

// Scene point -> normalized device coordinates (-1..1, +y up).
export function projectOrtho(view, [x, y]) {
  return [(x - view.centre[0]) / view.halfWidth, (y - view.centre[1]) / view.halfHeight];
}

// --- Perspective camera: used only for the opening move ---------------------------------------
//
// A pose is given relative to the extent, so a storyboard works for any package:
//   target       [fx, fy] in half-extents (0,0 = centre, 1,1 = north-east corner)
//   distance     multiple of the nadir distance that exactly fits the extent (1 = fitted)
//   tilt_deg     angle from straight down (0 = nadir)
//   heading_deg  direction the camera faces, clockwise from grid north (0 = north up)
// A frame with a `centre` (Gate 4D surface window) is posed around that centre instead of the origin.
export function perspectivePose(frame, aspect, fovDeg, p) {
  const tanHalf = Math.tan((fovDeg * DEG) / 2);
  const nadirDistance = fitHalfHeight(frame, aspect) / tanHalf;
  const [cx, cy] = frame.centre || [0, 0];
  const target = [cx + (p.target[0] * frame.width) / 2, cy + (p.target[1] * frame.height) / 2, 0];
  const dist = p.distance * nadirDistance;
  const tilt = p.tilt_deg * DEG;
  const heading = p.heading_deg * DEG;
  const forward = [Math.sin(heading), Math.cos(heading)];
  const horizontal = dist * Math.sin(tilt);
  const eye = [target[0] - horizontal * forward[0], target[1] - horizontal * forward[1], dist * Math.cos(tilt)];
  // Screen-up points along the heading on the ground, so heading 0 keeps grid north at the top.
  const up = [forward[0], forward[1], 0];
  return { type: 'perspective', eye, target, up, fovDeg, aspect, nadirDistance };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

// Same basis as THREE.Object3D.lookAt with camera.up = pose.up.
export function projectPerspective(pose, [x, y, z = 0]) {
  const f = norm(sub(pose.target, pose.eye));
  const r = norm(cross(f, pose.up));
  const u = cross(r, f);
  const v = sub([x, y, z], pose.eye);
  const depth = dot(v, f);
  const tanHalf = Math.tan((pose.fovDeg * DEG) / 2);
  return [dot(v, r) / (depth * tanHalf * pose.aspect), dot(v, u) / (depth * tanHalf)];
}

export function extentCorners(frame) {
  const w = frame.width / 2;
  const h = frame.height / 2;
  return { nw: [-w, h], ne: [w, h], se: [w, -h], sw: [-w, -h] };
}

// NDC -> pixel (row 0 at the top).
export function ndcToPixel([nx, ny], width, height) {
  return [((nx + 1) / 2) * width, ((1 - ny) / 2) * height];
}

// Pixel rectangle covered by the extent under an orthographic view.
export function extentPixelRect(frame, view, width, height) {
  const c = extentCorners(frame);
  const [x0, y0] = ndcToPixel(projectOrtho(view, c.nw), width, height);
  const [x1, y1] = ndcToPixel(projectOrtho(view, c.se), width, height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
