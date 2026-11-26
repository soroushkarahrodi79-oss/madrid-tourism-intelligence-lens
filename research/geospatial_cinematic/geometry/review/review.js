// Gate 4D visual review page: one crop, four representations, identical cameras and light.
// Driven by render_review.mjs. Research-only; not used by render.mjs or the Lens app.
import * as THREE from 'three';
import { perspectivePose } from '../../lib/geo.mjs';

const BG = '#0e1012';
const WALL = 0xb9b3a8; // neutral facade colour: a representation, not an observation
const LIGHT = { azimuth_deg: 315, elevation_deg: 30, directional: 0.8 }; // horizontal faces: ambient + 0.8 * sin 30 = 1
LIGHT.ambient = 1 - LIGHT.directional * Math.sin((LIGHT.elevation_deg * Math.PI) / 180);

let R;

const f32 = async (url) => new Float32Array(await (await fetch(url)).arrayBuffer());

window.setupReview = async ({ width, height, meta, frame, zPerM }) => {
  const canvas = document.getElementById('gl');
  canvas.width = width; canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(BG, 1);
  const img = new Image(); img.src = '/data/texture.jpg'; await img.decode();
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = true; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.needsUpdate = true;

  const [px, py] = meta.texture_px;
  const { col0, col1, row0, row1 } = meta.crop_texture_px;
  const [W, H] = frame.pixels;
  const minE = -frame.width / 2; const maxN = frame.height / 2; // package extent in scene units
  const base = meta.base_m;
  const z = (h) => (h - base) * zPerM;
  const uvOf = (x, y) => [(x - minE) / frame.width, (y + frame.height / 2) / frame.height];
  const crop = { west: minE + col0 * px, east: minE + col1 * px, north: maxN - row0 * py, south: maxN - row1 * py };
  crop.width = crop.east - crop.west; crop.height = crop.north - crop.south;
  crop.centre = [(crop.west + crop.east) / 2, (crop.north + crop.south) / 2];

  // Regular grid on a lattice (pixel centres), z from heights; returns position/uv/index.
  function gridArrays(heights, rows, cols, sx, sy) {
    const pos = new Float32Array(rows * cols * 3); const uv = new Float32Array(rows * cols * 2);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c; const x = crop.west + (c + 0.5) * sx; const y = crop.north - (r + 0.5) * sy;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z(heights[i]);
      const [u, v] = uvOf(x, y); uv[i * 2] = u; uv[i * 2 + 1] = v;
    }
    const index = [];
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c; const b = a + 1; const d = a + cols; const e = d + 1;
      index.push(a, d, b, b, d, e);
    }
    return { pos, uv, index };
  }
  const lambert = (opts) => new THREE.MeshLambertMaterial(opts);
  const texMat = (flat) => lambert({ map: tex, flatShading: flat });
  const wallMat = lambert({ color: WALL, flatShading: true });

  const meshes = {};
  const build = {};
  // current: Gate 4D grid as rendered in the film (1.82 m average, smooth normals, texture everywhere).
  build.current = async () => {
    const h = await f32('/data/current_mds.f32');
    const { pos, uv, index } = gridArrays(h, meta.current.rows, meta.current.cols, px, py);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(index); g.computeVertexNormals();
    return [new THREE.Mesh(g, texMat(false))];
  };
  const fine = meta.fine; const fsx = fine.pixel[0]; const fsy = fine.pixel[1];
  let mds, mdt;
  const loadFine = async () => { mds = mds || await f32('/data/fine_mds.f32'); mdt = mdt || await f32('/data/fine_mdt.f32'); };
  // A: native-resolution MDS (unmodified source cells), flat shading; faces steeper than 60 degrees
  // carry no photo (an orthophoto has no facade information) and are drawn neutral.
  build.A = async () => {
    await loadFine();
    const { pos, uv, index } = gridArrays(mds, fine.rows, fine.cols, fsx, fsy);
    const gentle = []; const steep = [];
    const lim = Math.tan((60 * Math.PI) / 180);
    for (let k = 0; k < index.length; k += 3) {
      const [a, b, c] = [index[k], index[k + 1], index[k + 2]];
      const ux = pos[b * 3] - pos[a * 3]; const uy = pos[b * 3 + 1] - pos[a * 3 + 1]; const uz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const vx = pos[c * 3] - pos[a * 3]; const vy = pos[c * 3 + 1] - pos[a * 3 + 1]; const vz = pos[c * 3 + 2] - pos[a * 3 + 2];
      const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
      (Math.hypot(nx, ny) > lim * Math.abs(nz) ? steep : gentle).push(a, b, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex([...gentle, ...steep]);
    g.addGroup(0, gentle.length, 0); g.addGroup(gentle.length, steep.length, 1);
    R_stats.A = { triangles: index.length / 3, steep_share: steep.length / index.length };
    return [new THREE.Mesh(g, [texMat(true), wallMat])];
  };
  // Terrain for B and C: MDT at native resolution, textured (the photo is a view of the ground and roofs).
  const terrain = () => {
    const { pos, uv, index } = gridArrays(mdt, fine.rows, fine.cols, fsx, fsy);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(index); g.computeVertexNormals();
    return new THREE.Mesh(g, texMat(false));
  };
  // B: MDT terrain + every cell with MDS - MDT >= 2.5 m as a prism: flat top at the MDS value
  // (textured), vertical neutral walls down to the neighbour. Trees, buildings, bridges alike.
  build.B = async () => {
    await loadFine();
    const T = 2.5;
    const top = (i) => (mds[i] - mdt[i] >= T ? mds[i] : null);
    const tp = []; const tu = []; const wp = [];
    const quadTop = (x0, y0, x1, y1, h) => {
      const zz = z(h);
      const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const order = [0, 1, 2, 0, 2, 3];
      for (const o of order) { const [x, y] = pts[o]; tp.push(x, y, zz); const [u, v] = uvOf(x, y); tu.push(u, v); }
    };
    const wall = (xa, ya, xb, yb, h0, h1) => {
      const z0 = z(h0); const z1 = z(h1);
      wp.push(xa, ya, z0, xb, yb, z0, xb, yb, z1, xa, ya, z0, xb, yb, z1, xa, ya, z1);
    };
    const { rows, cols } = fine;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c; const h = top(i);
      if (h === null) continue;
      const x0 = crop.west + c * fsx; const x1 = x0 + fsx; const y0 = crop.north - (r + 1) * fsy; const y1 = y0 + fsy;
      quadTop(x0, y0, x1, y1, h);
      const nb = [[r, c + 1, x1, y0, x1, y1], [r, c - 1, x0, y1, x0, y0], [r - 1, c, x1, y1, x0, y1], [r + 1, c, x0, y0, x1, y0]];
      for (const [rr, cc, xa, ya, xb, yb] of nb) {
        let hn;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) hn = mdt[i];
        else { const j = rr * cols + cc; hn = top(j) ?? mdt[j]; }
        if (h - hn > 0.3) wall(xa, ya, xb, yb, hn, h);
      }
    }
    const gt = new THREE.BufferGeometry();
    gt.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3)); gt.setAttribute('uv', new THREE.Float32BufferAttribute(tu, 2)); gt.computeVertexNormals();
    const gw = new THREE.BufferGeometry();
    gw.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); gw.computeVertexNormals();
    R_stats.B = { prism_cells: tp.length / 18, wall_quads: wp.length / 18 };
    return [terrain(), new THREE.Mesh(gt, texMat(true)), new THREE.Mesh(gw, wallMat)];
  };
  // C: Catastro footprints extruded (LoD1): roof = median MDS, base = min MDT; neutral walls;
  // the roof cap takes the orthophoto seen from above. Vegetation is not modelled (photo on terrain).
  build.C = async () => {
    await loadFine();
    const parts = await (await fetch('/data/parts.json')).json();
    const list = [terrain()];
    const roofMat = texMat(true);
    for (const p of parts) {
      const shape = new THREE.Shape(p.outer.map(([x, y]) => new THREE.Vector2(x, y)));
      for (const hole of p.holes) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
      const bottom = p.base_m - 1; // sunk 1 m below the lowest ground so no gap shows on slopes
      const g = new THREE.ExtrudeGeometry(shape, { depth: z(p.roof_m) - z(bottom), bevelEnabled: false });
      g.translate(0, 0, z(bottom));
      const P = g.attributes.position; const uv = g.attributes.uv;
      for (let k = 0; k < P.count; k++) { const [u, v] = uvOf(P.getX(k), P.getY(k)); uv.setXY(k, u, v); }
      g.computeVertexNormals();
      list.push(new THREE.Mesh(g, [roofMat, wallMat]));
    }
    R_stats.C = { parts: parts.length };
    return list;
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  const az = (LIGHT.azimuth_deg * Math.PI) / 180; const el = (LIGHT.elevation_deg * Math.PI) / 180;
  const sun = new THREE.DirectionalLight(0xffffff, LIGHT.directional * Math.PI);
  sun.position.set(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)).multiplyScalar(1e4);
  scene.add(new THREE.AmbientLight(0xffffff, LIGHT.ambient * Math.PI), sun, sun.target);
  const cam = new THREE.PerspectiveCamera(30, width / height, 1, 1e6);
  R = { renderer, scene, build, cam, crop, width, height, group: null };
  return true;
};

const R_stats = {};

// Builds one variant (disposing the previous one: the integrated GPU cannot hold all four).
window.useVariant = async (variant) => {
  if (R.group) {
    R.scene.remove(R.group);
    R.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
  const t0 = performance.now();
  const list = await R.build[variant]();
  R.group = new THREE.Group(); list.forEach((m) => R.group.add(m)); R.scene.add(R.group);
  return { ...(R_stats[variant] || {}), build_ms: Math.round(performance.now() - t0) };
};

window.renderVariant = (variant, pose) => {
  const { renderer, scene, cam, crop, width, height } = R;
  const p = perspectivePose(crop, width / height, 30, pose);
  cam.position.set(...p.eye); cam.up.set(...p.up); cam.lookAt(...p.target);
  const dist = Math.hypot(p.eye[0] - p.target[0], p.eye[1] - p.target[1], p.eye[2] - p.target[2]);
  cam.near = dist * 0.05; cam.far = dist * 10; cam.updateProjectionMatrix();
  renderer.render(scene, cam);
  if (renderer.getContext().isContextLost()) throw new Error('WebGL context lost');
  return document.getElementById('gl').toDataURL('image/png');
};
