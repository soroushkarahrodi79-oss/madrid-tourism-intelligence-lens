// Render page: the verified frames on one flat georeferenced plane, plus editorial typography.
// Driven only by render.mjs through window.setupScene / renderFrame / checkFrame.
// Every frame is drawn from its index alone (lib/timeline.mjs frameState): no clock, no random,
// no state carried from the previous frame, so any frame can be rendered alone.
import * as THREE from 'three';
import { perspectivePose, orthoView, extentPixelRect, projectPerspective, ndcToPixel, extentCorners } from '../lib/geo.mjs';
import { frameState, seg, EASE } from '../lib/timeline.mjs';

const BG = '#0e1012';
const INK = '#f3efe6';
const MUTED = 'rgba(243, 239, 230, 0.72)';
const FAINT = 'rgba(243, 239, 230, 0.30)';
const ACCENT = '#d9a441';
const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
const SHUTTER = 0.5; // 180-degree shutter for camera-move motion blur

let S; // scene state, set once by setupScene

const hex = async (buf) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');

window.setupScene = async (cfg) => {
  const { width: W, height: H } = cfg;
  const gl = document.getElementById('gl');
  const out = document.getElementById('out');
  gl.width = out.width = W;
  gl.height = out.height = H;

  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true, preserveDrawingBuffer: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(BG, 1);

  // Each image is fetched as bytes, hashed and compared with the package record before it is decoded.
  const textures = {};
  const images = {};
  for (const img of cfg.images) {
    const bytes = await (await fetch(img.url)).arrayBuffer();
    const digest = await hex(bytes);
    if (digest !== img.sha256) throw new Error(`${img.coverage_id}: decoded bytes hash ${digest}, package records ${img.sha256}`);
    const el = new Image();
    el.src = URL.createObjectURL(new Blob([bytes], { type: img.format }));
    await el.decode();
    if (el.naturalWidth !== img.width || el.naturalHeight !== img.height) throw new Error(`${img.coverage_id}: decoded ${el.naturalWidth}x${el.naturalHeight}`);
    const tex = new THREE.Texture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true; // image row 0 (north) -> top of the plane (+y = north)
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    textures[img.coverage_id] = tex;
    images[img.coverage_id] = el;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  // One plane per coverage, all with the identical geometry: the package extent, centred on the local origin.
  const geometry = new THREE.PlaneGeometry(cfg.frame.width, cfg.frame.height);
  const clip = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  const meshes = {};
  for (const id of Object.keys(textures)) {
    const mat = new THREE.MeshBasicMaterial({ map: textures[id], toneMapped: false, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.visible = false;
    scene.add(mesh);
    meshes[id] = mesh;
  }
  const persp = new THREE.PerspectiveCamera(30, W / H, 1, 1e6);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1e6);
  // Warm the GPU upload of every texture so the first frame of a shot is not special.
  for (const id of Object.keys(meshes)) { meshes[id].visible = true; renderer.render(scene, ortho); meshes[id].visible = false; }

  const ctx = out.getContext('2d', { willReadFrequently: true });
  // One probe canvas, reused by every alignment probe (allocating one per probe exhausted GPU memory).
  const probe = document.createElement('canvas');
  probe.width = W; probe.height = H;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });
  gl.addEventListener('webglcontextlost', () => { S.lost = true; });
  await document.fonts.ready;
  const info = renderer.getContext();
  const dbg = info.getExtension('WEBGL_debug_renderer_info');
  S = { cfg, W, H, renderer, scene, meshes, clip, persp, ortho, ctx, gl, out, images, probeCtx, lost: false, sc: H / 1080, nf: new Intl.NumberFormat(cfg.locale, { maximumFractionDigits: 2 }) };
  return {
    three: THREE.REVISION,
    gpu: dbg ? info.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
    webgl: info.getParameter(info.VERSION),
    max_anisotropy: renderer.capabilities.getMaxAnisotropy(),
    font_available: document.fonts.check(`16px "Segoe UI"`) ? 'Segoe UI' : 'fallback (see FONT stack)',
    font_stack: FONT,
  };
};

// --- camera + image ------------------------------------------------------------------------

function cameraFor(state) {
  const { cfg, W, H } = S;
  const aspect = W / H;
  if (state.camera.type === 'perspective') {
    const pose = perspectivePose(cfg.frame, aspect, state.camera.fov_deg, state.camera.pose);
    const c = S.persp;
    c.fov = pose.fovDeg; c.aspect = aspect;
    c.position.set(...pose.eye); c.up.set(...pose.up); c.lookAt(...pose.target);
    c.updateProjectionMatrix(); c.updateMatrixWorld();
    return { camera: c, pose };
  }
  const view = orthoView(cfg.frame, aspect, state.camera.zoom, state.camera.centre);
  const c = S.ortho;
  c.left = -view.halfWidth; c.right = view.halfWidth; c.top = view.halfHeight; c.bottom = -view.halfHeight;
  c.position.set(view.centre[0], view.centre[1], 1000); c.up.set(0, 1, 0); c.lookAt(view.centre[0], view.centre[1], 0);
  c.updateProjectionMatrix(); c.updateMatrixWorld();
  return { camera: c, view };
}

function drawImageLayer(state) {
  for (const m of Object.values(S.meshes)) { m.visible = false; m.material.clippingPlanes = null; m.renderOrder = 0; }
  state.layers.forEach((id, k) => { S.meshes[id].visible = true; S.meshes[id].renderOrder = k; });
  if (state.shot.kind === 'compare') {
    // Coverage B is shown east of the divider only; both share the same plane geometry.
    S.clip.constant = -((state.wipe - 0.5) * S.cfg.frame.width);
    const b = S.meshes[state.shot.b];
    b.material.clippingPlanes = [S.clip];
    b.visible = state.wipe < 1;
    S.meshes[state.shot.a].visible = state.wipe > 0;
  }
  const cam = cameraFor(state);
  S.renderer.render(S.scene, cam.camera);
  return cam;
}

// --- typography helpers --------------------------------------------------------------------

const px = (v) => v * S.sc;
function font(size, weight = 400) { return `${weight} ${Math.round(px(size))}px ${FONT}`; }
function text(str, x, y, { size = 20, weight = 400, color = INK, align = 'left', alpha = 1, spacing = 0, baseline = 'alphabetic' } = {}) {
  const c = S.ctx;
  c.save();
  c.globalAlpha *= alpha;
  c.font = font(size, weight);
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = baseline;
  c.letterSpacing = `${px(spacing)}px`;
  // A soft shadow keeps type legible over bright imagery (white roofs, 1990s B/W flights).
  c.shadowColor = 'rgba(0, 0, 0, 0.75)';
  c.shadowBlur = px(6);
  c.shadowOffsetY = px(1);
  c.fillText(str, x, y);
  const w = c.measureText(str).width;
  c.restore();
  return w;
}
function fill(template, values) { return template.replace(/\{(\w+)\}/g, (_, k) => (k in values ? values[k] : `{${k}}`)); }
function scrim(y0, y1, a0, a1) {
  const g = S.ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, `rgba(8, 9, 10, ${a0})`);
  g.addColorStop(1, `rgba(8, 9, 10, ${a1})`);
  S.ctx.fillStyle = g;
  S.ctx.fillRect(0, Math.min(y0, y1), S.W, Math.abs(y1 - y0));
}
function line(x0, y0, x1, y1, color = FAINT, w = 1) {
  const c = S.ctx; c.save(); c.strokeStyle = color; c.lineWidth = px(w); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.restore();
}
const meta = (id) => S.cfg.meta.byId[id];
const copy = () => S.cfg.copy;

function northArrow(x, y, alpha, rotationDeg = 0) {
  const c = S.ctx;
  c.save();
  c.globalAlpha *= alpha;
  c.translate(x, y);
  c.rotate((rotationDeg * Math.PI) / 180);
  const h = px(26);
  c.fillStyle = INK;
  c.beginPath(); c.moveTo(0, -h); c.lineTo(px(9), px(8)); c.lineTo(0, px(2)); c.closePath(); c.fill();
  c.fillStyle = 'rgba(243, 239, 230, 0.35)';
  c.beginPath(); c.moveTo(0, -h); c.lineTo(-px(9), px(8)); c.lineTo(0, px(2)); c.closePath(); c.fill();
  c.restore();
  text('N', x, y + px(30), { size: 15, weight: 600, align: 'center', alpha });
}

// Scale bar for an orthographic, north-up view: ground metres -> screen pixels at the extent centre,
// with the ellipsoidal east-west factor. Approximate by design, labelled "aprox." on screen.
function scaleBar(view, xRight, y, alpha) {
  const groundM = S.cfg.scale_bar_m;
  const mercPerPx = (2 * view.halfWidth) / S.W;
  const len = groundM / S.cfg.ground.eastWest / mercPerPx;
  const x0 = xRight - len;
  line(x0, y, xRight, y, `rgba(243, 239, 230, ${0.9 * alpha})`, 2);
  line(x0, y - px(6), x0, y + px(1), `rgba(243, 239, 230, ${0.9 * alpha})`, 2);
  line(xRight, y - px(6), xRight, y + px(1), `rgba(243, 239, 230, ${0.9 * alpha})`, 2);
  text(fill(copy().scale_bar, { m: S.nf.format(groundM) }), xRight, y + px(22), { size: 14, color: MUTED, align: 'right', alpha });
}

function neatline(rect, alpha) {
  const c = S.ctx; c.save(); c.strokeStyle = `rgba(243, 239, 230, ${0.28 * alpha})`; c.lineWidth = 1;
  c.strokeRect(Math.round(rect.x) + 0.5, Math.round(rect.y) + 0.5, Math.round(rect.width) - 1, Math.round(rect.height) - 1); c.restore();
}

// Date block for one coverage. Returns the coverage id it labelled (checked against the picture).
function dateBlock(id, x, y, { align = 'left', alpha = 1, size = 84 } = {}) {
  const m = meta(id);
  text(m.date.label, x, y, { size, weight: 300, align, alpha, spacing: -1 });
  let kind = copy().kind[m.date.kind] || m.date.kind;
  if (m.role === 'reference') kind = `${kind} · ${copy().reference}`;
  text(kind, x, y + px(34), { size: 20, weight: 500, color: ACCENT, align, alpha });
  text(m.product, x, y + px(60), { size: 16, color: MUTED, align, alpha });
  const flag = copy().coverage_flag?.[m.coverage_state];
  if (flag) text(`⚠ ${flag}`, x, y + px(86), { size: 16, weight: 600, color: ACCENT, align, alpha });
  return id;
}

function attribution(ids, alpha = 1) {
  const lines = [...new Set(ids.map((id) => meta(id).attribution))];
  lines.forEach((a, k) => text(a, S.W - px(40), S.H - px(22) - px(20) * (lines.length - 1 - k), { size: 13, color: MUTED, align: 'right', alpha }));
}

function wrap(str, maxWidth, size, weight = 400) {
  const c = S.ctx; c.save(); c.font = font(size, weight);
  const words = str.split(' '); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (c.measureText(t).width > maxWidth && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  c.restore();
  return lines;
}

// --- shots -----------------------------------------------------------------------------------

function overlayIntro(state) {
  const t = state.local_s;
  const d = state.duration_s;
  const id = state.layers[0];
  scrim(0, S.H, 0.25, 0.45);
  const a = seg(t, 0.35, 1.2) * (1 - seg(t, d - 0.75, d - 0.15));
  const cy = S.H * 0.45;
  text(copy().title, S.W / 2, cy, { size: 64, weight: 600, align: 'center', alpha: a, spacing: 14 });
  const ruleW = px(140) * EASE.easeOut(seg(t, 0.6, 1.5));
  S.ctx.save(); S.ctx.globalAlpha = a;
  line(S.W / 2 - ruleW / 2, cy + px(30), S.W / 2 + ruleW / 2, cy + px(30), ACCENT, 2);
  S.ctx.restore();
  text(copy().subtitle, S.W / 2, cy + px(82), { size: 30, weight: 300, align: 'center', alpha: a * seg(t, 0.7, 1.5) });
  text(fill(copy().intro_source, S.cfg.tokens), S.W / 2, cy + px(122), { size: 17, color: MUTED, align: 'center', alpha: a * seg(t, 1.0, 1.8), spacing: 1 });
  // The imagery on screen is always identified, even under the title.
  const m = meta(id);
  text(`${m.date.label} · ${m.role === 'reference' ? copy().reference : copy().kind[m.date.kind]}`, px(40), S.H - px(26), { size: 15, weight: 600, color: INK, alpha: 0.9 });
  attribution([id], 0.85);
  return [id];
}

function overlayContext(state, cam) {
  const t = state.local_s;
  const id = state.layers[0];
  const rect = extentPixelRect(S.cfg.frame, cam.view, S.W, S.H);
  scrim(0, px(300), 0.78, 0);
  scrim(S.H, S.H - px(160), 0.7, 0);
  neatline(rect, 1);
  // Corner brackets mark the package extent: this is the whole study area.
  const k = EASE.easeOut(seg(t, 0.1, 0.9));
  const arm = px(46) * k;
  const c = S.ctx; c.save(); c.strokeStyle = ACCENT; c.lineWidth = px(3);
  const inset = px(18);
  for (const [cx, cy, sx, sy] of [[rect.x + inset, rect.y + inset, 1, 1], [rect.x + rect.width - inset, rect.y + inset, -1, 1], [rect.x + rect.width - inset, rect.y + rect.height - inset, -1, -1], [rect.x + inset, rect.y + rect.height - inset, 1, -1]]) {
    c.beginPath(); c.moveTo(cx + sx * arm, cy); c.lineTo(cx, cy); c.lineTo(cx, cy + sy * arm); c.stroke();
  }
  c.restore();
  const x = rect.x + px(64);
  const a1 = seg(t, 0.2, 0.8);
  text(copy().eyebrow, x, px(78), { size: 15, weight: 600, color: ACCENT, spacing: 4, alpha: a1 });
  text(copy().place, x, px(128), { size: 40, weight: 400, alpha: a1 });
  copy().context_lines.forEach((l, i) => text(fill(l, S.cfg.tokens), x, px(168) + px(28) * i, { size: 18, color: MUTED, alpha: seg(t, 0.5 + 0.2 * i, 1.1 + 0.2 * i) }));
  const m = meta(id);
  text(`${m.date.label} · ${copy().reference}`, x, S.H - px(56), { size: 26, weight: 300, alpha: seg(t, 0.4, 1.0) });
  northArrow(rect.x + rect.width - px(64), px(84), seg(t, 0.6, 1.2));
  scaleBar(cam.view, rect.x + rect.width - px(64), px(150), seg(t, 0.8, 1.4));
  attribution([id], 0.9);
  return [id];
}

function ruler(state) {
  const seqIds = S.cfg.meta.sequence_ids;
  const shown = state.shot.sequence_index;
  const all = [...seqIds, S.cfg.meta.reference_id].map((id) => meta(id).date);
  const y0 = Math.floor(Math.min(...all.map((d) => d.start_year)) / 10) * 10;
  const y1 = Math.ceil((Math.max(...all.map((d) => d.end_year)) + 1) / 10) * 10;
  const xa = px(140);
  const xb = S.W - px(140);
  const X = (yr) => xa + ((yr - y0) / (y1 - y0)) * (xb - xa);
  const y = S.H - px(96);
  line(xa, y, xb, y, FAINT, 1);
  for (let yr = y0; yr <= y1; yr += 10) {
    line(X(yr), y - px(5), X(yr), y + px(5), FAINT, 1);
    text(String(yr), X(yr), y + px(26), { size: 13, color: MUTED, align: 'center' });
  }
  // A coverage occupies its published years [start, end + 1): an interval stays an interval.
  const ids = S.cfg.timeline.shots.filter((s) => s.group === state.shot.group).map((s) => s.coverage);
  ids.forEach((id, i) => {
    const d = meta(id).date;
    const xs = X(d.start_year);
    const xe = Math.max(X(d.end_year + 1), xs + px(4));
    const current = i === shown;
    const col = current ? ACCENT : i < shown ? 'rgba(217, 164, 65, 0.45)' : 'rgba(243, 239, 230, 0.28)';
    const c = S.ctx; c.save(); c.fillStyle = col; c.fillRect(xs, y - px(current ? 6 : 3), xe - xs, px(current ? 12 : 6)); c.restore();
    if (current) text(d.label, (xs + xe) / 2, y - px(16), { size: 16, weight: 600, color: ACCENT, align: 'center' });
  });
  const ref = meta(S.cfg.meta.reference_id).date;
  const xr = X(ref.start_year + 0.5);
  const c = S.ctx; c.save(); c.strokeStyle = 'rgba(243, 239, 230, 0.6)'; c.lineWidth = px(1.5);
  c.beginPath(); c.arc(xr, y + px(12), px(4), 0, Math.PI * 2); c.stroke(); c.restore();
  text(copy().reference_tick, xr, y + px(44), { size: 12, color: MUTED, align: 'center' });
  text(fill(copy().ruler_caption, S.cfg.tokens), xb, y - px(40), { size: 13, color: MUTED, align: 'right' });
}

function overlaySequence(state, cam) {
  const id = state.layers[0];
  const rect = extentPixelRect(S.cfg.frame, cam.view, S.W, S.H);
  scrim(0, px(400), 0.88, 0);
  scrim(S.H, S.H - px(240), 0.88, 0);
  neatline(rect, 1);
  const x = rect.x + px(64);
  text(copy().eyebrow, x, px(70), { size: 15, weight: 600, color: ACCENT, spacing: 4 });
  text(`${copy().sequence_heading}  ${state.shot.sequence_index + 1} / ${state.shot.sequence_count}`, x, px(96), { size: 14, color: MUTED, spacing: 2 });
  // The label is drawn at full opacity from the first frame of the shot: it changes on the same frame as the image.
  dateBlock(id, x, px(184));
  northArrow(rect.x + rect.width - px(64), px(84), 1);
  scaleBar(cam.view, rect.x + rect.width - px(64), px(150), 1);
  ruler(state);
  attribution([id], 1);
  return [id];
}

function overlayCompare(state, cam) {
  const { a, b } = state.shot;
  const rect = extentPixelRect(S.cfg.frame, cam.view, S.W, S.H);
  const dx = rect.x + state.wipe * rect.width;
  scrim(0, px(380), 0.88, 0);
  scrim(S.H, S.H - px(170), 0.8, 0);
  neatline(rect, 1);
  const labelled = [];
  if (state.wipe > 0) labelled.push(dateBlock(a, rect.x + px(64), px(150), { size: 64 }));
  if (state.wipe < 1) {
    const alpha = seg(rect.x + rect.width - dx, 0, px(160));
    labelled.push(dateBlock(b, rect.x + rect.width - px(64), px(150), { size: 64, align: 'right', alpha: Math.max(alpha, 1e-3) }));
    line(dx, rect.y, dx, rect.y + rect.height, INK, 2);
    const c = S.ctx; c.save(); c.fillStyle = INK; c.beginPath(); c.arc(dx, rect.y + rect.height / 2, px(7), 0, Math.PI * 2); c.fill(); c.restore();
  }
  text(copy().compare_heading, S.W / 2, px(58), { size: 14, weight: 600, color: ACCENT, align: 'center', spacing: 4 });
  text(copy().compare_note, S.W / 2, S.H - px(72), { size: 18, color: INK, align: 'center' });
  attribution(labelled, 1);
  return labelled;
}

function overlayClosing(state, cam) {
  const t = state.local_s;
  const d = state.duration_s;
  const id = state.layers[0];
  const g = S.ctx.createLinearGradient(0, 0, S.W * 0.62, 0);
  g.addColorStop(0, 'rgba(8, 9, 10, 0.90)');
  g.addColorStop(0.75, 'rgba(8, 9, 10, 0.70)');
  g.addColorStop(1, 'rgba(8, 9, 10, 0)');
  S.ctx.fillStyle = g; S.ctx.fillRect(0, 0, S.W, S.H);
  const x = px(150);
  text(copy().eyebrow, x, px(250), { size: 15, weight: 600, color: ACCENT, spacing: 4, alpha: seg(t, 0.2, 0.8) });
  text(fill(copy().closing_heading, S.cfg.tokens), x, px(318), { size: 48, weight: 300, alpha: seg(t, 0.3, 1.0) });
  let y = px(380);
  copy().closing_lines.forEach((l, i) => {
    for (const w of wrap(fill(l, S.cfg.tokens), S.W * 0.42, 19)) {
      text(w, x, y, { size: 19, color: MUTED, alpha: seg(t, 0.8 + 0.25 * i, 1.4 + 0.25 * i) });
      y += px(29);
    }
    y += px(8);
  });
  text(copy().credit, x, y + px(36), { size: 15, weight: 600, color: INK, alpha: seg(t, 2.4, 3.0), spacing: 1 });
  dateBlock(id, S.W - px(64), px(150), { size: 64, align: 'right', alpha: 1 });
  attribution([id], 1);
  const fade = seg(t, d - 0.7, d);
  if (fade > 0) { S.ctx.fillStyle = `rgba(8, 9, 10, ${fade})`; S.ctx.fillRect(0, 0, S.W, S.H); }
  return [id];
}

const OVERLAYS = { intro: overlayIntro, context: overlayContext, sequence: overlaySequence, compare: overlayCompare, closing: overlayClosing };

const isMoving = (st) => st.camera.type === 'perspective' || st.shot.camera.zoom_to !== undefined;

// Share of a 12 x 12 grid over the central half of the frame that is not plain background.
// Every shot puts imagery there, so a low share means the image layer did not draw.
function imageryShare() {
  const d = S.ctx.getImageData(Math.round(S.W / 4), Math.round(S.H / 4), Math.round(S.W / 2), Math.round(S.H / 2));
  let hit = 0;
  for (let gy = 0; gy < 12; gy++) for (let gx = 0; gx < 12; gx++) {
    const x = Math.floor(((gx + 0.5) / 12) * d.width);
    const y = Math.floor(((gy + 0.5) / 12) * d.height);
    const o = (y * d.width + x) * 4;
    if (Math.abs(d.data[o] - 14) + Math.abs(d.data[o + 1] - 16) + Math.abs(d.data[o + 2] - 18) > 12) hit++;
  }
  return hit / 144;
}

function composeFrame(i, n, overlays) {
  if (S.lost || S.renderer.getContext().isContextLost()) throw new Error('WebGL context lost: refusing to produce a frame without imagery');
  const base = frameState(S.cfg.timeline, i, 0);
  const ctx = S.ctx;
  ctx.globalAlpha = 1;
  ctx.fillStyle = BG; ctx.fillRect(0, 0, S.W, S.H);
  const samples = isMoving(base) ? Math.max(1, n) : 1;
  let cam;
  for (let k = 0; k < samples; k++) {
    // Sub-frame samples spread over the shutter; averaged by progressive alpha.
    const st = samples === 1 ? base : frameState(S.cfg.timeline, i, ((k + 0.5) / samples) * SHUTTER);
    cam = drawImageLayer(st);
    ctx.globalAlpha = 1 / (k + 1);
    ctx.drawImage(S.gl, 0, 0);
  }
  ctx.globalAlpha = 1;
  if (samples > 1) cam = drawImageLayer(base); // overlays follow the frame's own camera state
  const imagery = imageryShare();
  const labelled = overlays ? OVERLAYS[base.shot.kind](base, cam) : null;
  return { base, cam, labelled, imagery };
}

window.renderFrame = (i, { n = 1, overlays = true } = {}) => {
  const { base, labelled, imagery } = composeFrame(i, n, overlays);
  return { png: S.out.toDataURL('image/png'), shot: base.shot.id, visible: base.visible, labelled, imagery };
};

// --- validation probes (overlays off) --------------------------------------------------------

function sampleRegion(img, data, rect, transform) {
  // Mean absolute difference between the rendered region and `img` drawn into the same rect.
  const p = S.probeCtx;
  p.setTransform(1, 0, 0, 1, 0, 0);
  p.imageSmoothingEnabled = true; p.imageSmoothingQuality = 'high';
  p.fillStyle = BG; p.fillRect(0, 0, S.W, S.H);
  p.save();
  p.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
  p.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);
  p.drawImage(img, -rect.width / 2 + (transform.dxPx || 0), -rect.height / 2 - (transform.dyPx || 0), rect.width, rect.height);
  p.restore();
  const ref = p.getImageData(0, 0, S.W, S.H).data;
  return (x0, y0, x1, y1) => {
    let sum = 0; let count = 0;
    for (let y = Math.ceil(y0) + 2; y < Math.floor(y1) - 2; y += 2) {
      for (let x = Math.ceil(x0) + 2; x < Math.floor(x1) - 2; x += 2) {
        const o = (y * S.W + x) * 4;
        sum += Math.abs(data[o] - ref[o]) + Math.abs(data[o + 1] - ref[o + 1]) + Math.abs(data[o + 2] - ref[o + 2]);
        count += 3;
      }
    }
    return sum / count;
  };
}

// Compares the rendered picture of frame i with every candidate image placed at the extent's
// pixel rectangle. The right image must be the closest, and closer than its own mirror images.
window.checkFrame = (i) => {
  const { base, cam } = composeFrame(i, 1, false);
  if (!cam.view) throw new Error(`frame ${i}: alignment is checked on orthographic shots only`);
  const rect = extentPixelRect(S.cfg.frame, cam.view, S.W, S.H);
  const data = S.ctx.getImageData(0, 0, S.W, S.H).data;
  // Outside the extent the frame must be plain background: nothing spills or shifts outward.
  let outside = 0; let n = 0;
  const bg = [14, 16, 18];
  for (let y = 0; y < S.H; y += 3) for (let x = 0; x < S.W; x += 3) {
    if (x >= rect.x - 1 && x <= rect.x + rect.width + 1 && y >= rect.y - 1 && y <= rect.y + rect.height + 1) continue;
    const o = (y * S.W + x) * 4; outside += Math.abs(data[o] - bg[0]) + Math.abs(data[o + 1] - bg[1]) + Math.abs(data[o + 2] - bg[2]); n += 3;
  }
  const regions = base.shot.kind === 'compare'
    ? [{ id: base.shot.a, x0: rect.x, x1: rect.x + base.wipe * rect.width - 3 }, { id: base.shot.b, x0: rect.x + base.wipe * rect.width + 3, x1: rect.x + rect.width }]
      .filter((r) => r.x1 - r.x0 > 20)
    : [{ id: base.layers[0], x0: rect.x, x1: rect.x + rect.width }];
  const result = regions.map((r) => {
    const scores = {};
    for (const [id, img] of Object.entries(S.images)) scores[id] = sampleRegion(img, data, rect, {})(r.x0, rect.y, r.x1, rect.y + rect.height);
    const own = S.images[r.id];
    const at = (t) => sampleRegion(own, data, rect, t)(r.x0, rect.y, r.x1, rect.y + rect.height);
    const mirrors = { flip_horizontal: at({ flipX: true }), flip_vertical: at({ flipY: true }) };
    // The best placement must be the computed one: 1 px east/west/north/south must all fit worse.
    const shifts = { east_1px: at({ dxPx: 1 }), west_1px: at({ dxPx: -1 }), north_1px: at({ dyPx: 1 }), south_1px: at({ dyPx: -1 }) };
    const best = Object.entries(scores).sort((p, q) => p[1] - q[1])[0][0];
    return { coverage_id: r.id, best_match: best, mad_expected: scores[r.id], mad_all: scores, mad_mirrors: mirrors, mad_shifts: shifts };
  });
  return { frame: i, shot: base.shot.id, rect, outside_mad: outside / n, regions: result };
};
