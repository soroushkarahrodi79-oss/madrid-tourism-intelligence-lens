# Geospatial cinematic engine V0.1 (Madrid Urban Time Machine, Gate 4C)

Renders a verified [Gate 4B frame package](../temporal_materialization/README.md) as a silent
MP4 with a `render-manifest.json` that records where every pixel came from. A standalone
research tool: no backend, nothing in the Lens web app imports it, and it never contacts the IGN.

```
Temporal manifest (4A) → materialize.py (4B) → verified package → render.mjs (4C) → video.mp4 + render-manifest.json
```

By default it is a **2.5D presentation of flat 2D orthophotos**: one georeferenced plane, a camera
above it. No terrain, no buildings, no reconstructed or generated geometry, and no interpolation
between dates. Gate 4D adds an **optional** surface derived from official PNOA-LiDAR elevation
(`--geometry`, see [Elevation surface](#elevation-surface-gate-4d)); without it nothing changes.

## Install (isolated)

Dependencies live in this folder only (`three` 0.186.1, `playwright` 1.63.0, the version the repo
already uses, so its cached Chromium is reused). No install scripts, no browser download:

```powershell
cd research/geospatial_cinematic; $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1; npm ci --ignore-scripts
```

If no Playwright Chromium is cached on the machine: `npx playwright install chromium-headless-shell`.
FFmpeg and ffprobe must be on `PATH` (or set `FFMPEG` / `FFPROBE`). `python` is used, if present, to
run the Gate 4B `--verify` as a cross-check (standard library only).

## Run

Three stages of increasing cost. Keep `--out` outside the repository and outside the package
(the tool refuses otherwise); renders are never committed.

```powershell
node render.mjs --package C:\workspace\temporal-packages\madrid-rio-z16-final --storyboard storyboards/smoke.json --out C:\renders\a-smoke --width 640 --height 360 --n 1
```

```powershell
node render.mjs --package C:\workspace\temporal-packages\madrid-rio-z16-final --storyboard storyboards/madrid-rio.json --out C:\renders\b-preview --width 960 --height 540 --n 1
```

```powershell
node render.mjs --package C:\workspace\temporal-packages\madrid-rio-z16-final --storyboard storyboards/madrid-rio.json --out C:\renders\c-final --width 1920 --height 1080 --fps 30 --n 4
```

`--stills 2.0,9.1` writes PNG stills at those playback seconds instead of a video. `--n` is the
number of motion-blur sub-frames for camera moves (static shots always use one sample).

| Exit | Meaning |
|---|---|
| 0 | Rendered, every check passed (`status: PASS` in the manifest) |
| 1 | Rendered, at least one check failed: read `validation` in the manifest |
| 2 | Refused: package, storyboard or output directory |
| 3 | Tool failure (scene setup, lost WebGL context, FFmpeg) — no result is claimed |

## Input contract

The engine reads the Gate 4B files directly and builds no parallel format: `checksums.sha256`,
`materialized-manifest.json`, `source-manifest.json`, `validation-report.json`, each frame image and
its `.jgw`, `.prj` and `.aux.xml`. Nothing in the package is opened for writing; the manifest
records every file's hash before and after the render (`package_unchanged_after_render`).

**Refused** (exit 2, nothing rendered): a listed file missing or with a different SHA-256; a file not
listed; schema other than `materialized-package 1.0.0`; the source-manifest hash, the validation
report, or the source view bbox disagreeing with the materialized manifest; a CRS other than
EPSG:3857; a bbox, pixel size, GDAL geotransform or world file that disagree; any frame on another
extent or image size; an image header of another size; a sidecar that is altered or does not
declare Web Mercator; a reference that is not `order.reference`; frames that do not follow
`order.sequence`; dates out of historical order (start year, then end year); an unknown date kind
or a malformed interval; a frame without licence or attribution. The Gate 4B `--verify` also runs.

**Left out, never filled in:** frames whose `status` is not `VALID_IMAGE`, and `EMPTY_BLANK`
frames. They are listed in `package.excluded_frames`; a storyboard that names one is refused.
`SUSPECTED_PARTIAL` frames remain usable, carry an on-screen warning and are listed in the manifest.
`COVERAGE_UNVERIFIED` is recorded per image and stated in the closing card.

In the page, each image is fetched as bytes from the local server, hashed again with SubtleCrypto,
compared with the package record, and only then decoded.

## Spatial representation

| | |
|---|---|
| Local origin | centre of the package bbox in EPSG:3857 (`render-manifest.json` → `spatial.scene_transform.origin_epsg3857`) |
| Transform | `x = easting − origin_e`, `y = northing − origin_n`, image on `z = 0` |
| Axes | +x east, +y grid north, +z up (right-handed) |
| Units | 1 scene unit = 1 Web Mercator metre, **not** a ground metre |
| North | grid north is screen-up in every orthographic shot; the intro may rotate by `heading_deg` (≤ 30°) and ends north-up |
| Plane | one plane of the bbox size, shared by every date: identical geometry for all coverages |
| Texture | image row 0 = north edge (`flipY`); the bbox is the outer edge of the edge pixels, as in Gate 4B |
| Fit / aspect | *contain*: the whole extent is visible at zoom 1, centred, never stretched (1.6 image in a 1.78 frame: background bars at the sides) |

Subtracting the origin keeps coordinates within a few kilometres, so 32-bit GPU floats keep their
precision (absolute EPSG:3857 values are near 4.9 × 10⁶).

**Scale.** EPSG:3857 is not conformal on the WGS84 ellipsoid. At the pilot centre (40.397° N) one
Mercator metre is 0.7626 ground metres east–west and 0.7597 north–south (−0.4 %). The extent is
3.06 × 1.91 km in Mercator units ≈ 2.33 × 1.45 km on the ground. The on-screen 500 m bar uses the
east–west factor at the centre and is labelled *aprox.*; it is not a survey-grade scale.

**Cameras.** The historical sequence and the comparison use one fixed orthographic camera
(identical framing, checked). Only the opening uses a perspective camera (fov 30°, tilt ≤ 22°,
heading −6° → 0°) that ends exactly on the orthographic framing, so the cut to the sequence does
not jump (unit-tested to 1e-6 px). The closing is a slow orthographic push (×1.05).

## Storyboard and timeline

A storyboard is JSON (`storyboards/madrid-rio.json`): shots of kind `intro`, `context`, `sequence`,
`compare`, `closing`, with durations, coverage references (`reference`, `earliest`, `latest` or an
id) and camera keys; on-screen copy and its locale. `lib/timeline.mjs` resolves it against the
package into frame-exact shots; every frame is a pure function of its index (no clock, no random,
no state carried between frames), so any frame can be rendered alone.

Refused storyboards: a sequence out of package order, a moving camera in the sequence or the
comparison, a tilt above 45° or a heading above 30°, an unknown or unusable coverage.

Two clocks are kept apart. **Playback time** is video seconds. **Historical time** is each image's
published date: a mosaic year (`2009`) or a flight interval (`1956–57`, `1997–98`, `1997–2003`),
shown as published and never reduced to an invented acquisition date. Every image gets the same
1.3 s; the on-screen ruler draws each coverage on a linear year axis, so the uneven gaps
(1957 → 1997) stay visible. `time_mapping` in the manifest lists both clocks per shot.

## Render manifest

`render-manifest.json`, next to `video.mp4`: renderer id and version, render date, repository
commit and any uncommitted engine changes; the package path, id, record hashes, Gate 4B verify
result and excluded frames; the storyboard file and hash; every image used (coverage id, file,
SHA-256, date, coverage state, attribution, licence, original request URL, shots it appears in);
scene order; the playback ↔ historical mapping; camera settings and the scene transform; output
resolution, fps, frame count, duration, encoding, ffprobe output and the MP4's SHA-256;
dependency versions (Node, Playwright, Chromium, three.js, GPU, FFmpeg, font); the network log;
every validation result; limitations.

SHA-256 values detect change; they are **not a signature** (whoever edits the video can rewrite
the manifest). The procedure is reproducible; byte-identical MP4s across GPUs, drivers, fonts or
encoder builds are not claimed.

## Validation (run on every render, recorded in the manifest)

| Check | How |
|---|---|
| Label ↔ image sync | every frame: the coverages drawn and the coverages labelled must be the same set |
| Imagery present | every frame: ≥ 75 % of a central sample grid differs from the background before typography |
| Right image, right place | per orthographic shot (first and middle frame of each date): the render is compared with each image drawn at the computed pixel rectangle; the expected one must be the best match, at most half the difference of any other date, worse when mirrored horizontally or vertically, and better than 1 px shifts east, west, north and south; nothing outside the extent differs from the background |
| Identical framing | every fixed orthographic shot projects the extent to the same pixel rectangle |
| Chronology, intervals | enforced at load and resolve; labels are the package labels |
| MP4 | ffprobe width, height, frame rate, decoded frame count and duration; full decode without errors |
| Seek | key frames extracted from the MP4 vs the PNGs sent to the encoder: PSNR ≥ 30 dB |
| Cuts | around every cut *c*, MP4 frame *c* matches rendered *c* better than *c − 1*, and *c − 1* the reverse |
| Network | the page may only reach this process's 127.0.0.1 server; everything else is blocked and listed |
| Console | no JavaScript error, no WebGL / shader / context-loss warning |
| Package | every package file re-hashed after the render |

The absolute difference of the right image is *not* a pass criterion: it depends on image detail and
on GPU versus Canvas resampling (4–12 grey levels at 960 × 540 in the pilot). An earlier draft used a
fixed bound of 12, which the sharp 2020 frame exceeded (12.19) while being the right image by a
factor of 2.7 and with its optimum at zero offset; the margin and shift tests replaced it.

Unit tests (`node --test tests/geospatial_cinematic.test.mjs`) cover the package contract on
synthetic packages (tampering, missing and unlisted files, CRS, extent, size, order, licence,
exclusions), the transform (origin, north-up, aspect, contain fit, seamless intro cut, heading
direction, ground scale) and the timeline (frame-exact cuts, label sync, purity, fixed camera,
refused storyboards, time mapping). With `CINEMATIC_PACKAGE` set they also load the real package.

## Cross-dissolve mode (Gate 4C.1)

Hard cut is the default. A sequence shot can instead dissolve between consecutive dates:

```json
{ "kind": "sequence", "per_frame_s": 1.1, "coverages": "all",
  "transition": { "type": "dissolve", "duration_s": 0.8 }, "camera": { "type": "orthographic", "zoom": 1 } }
```

- Each dissolve is its own `transition` shot between two original holds. On its frames the
  incoming original texture is drawn over the outgoing one on the **same plane, camera and extent**,
  at opacity α = (j + 1) / (n + 1) for frame j of n: linear, strictly between 0 and 1 (0.04 … 0.96
  for 0.8 s at 30 fps). Nothing else enters the picture: no generated, morphed or geographically
  interpolated image, and no date that does not exist.
- The blend is the usual video cross-fade on displayed (sRGB-encoded) values,
  `(1 − α)·A + α·B`, done by the GPU when the canvas framebuffer blends the two textures.
- Every frame is either `original` (one or two source images as they are) or `transition` (an
  opacity blend). Transition frames name both dates, show the mix ratio and carry both attributions;
  the year ruler highlights both intervals.
- `render-manifest.json` → `transitions`: mode, original/transition frame counts, and for each dissolve
  its frames, seconds, both coverages with their published dates and coverage states, and α per frame.

Checks added for dissolves (the others run unchanged):

| Check | How |
|---|---|
| Blend in the page | at α ≈ 0.3 and 0.7: the render must fit the declared blend better than either original alone, the pair at α ± 0.2, and the pair reversed (not probed at 0.5, where reversal is the same picture); zero offset beats 1 px shifts |
| Opacity in the MP4 | every transition frame is decoded and fitted by least squares as (1 − α̂)·A + α̂·B against the MP4 frames just before and after: \|α̂ − α\| ≤ 0.02, residual ≤ 10 % of the A–B difference (no third image), every α̂ farther than 0.02 from 0 and 1 (each transition frame is measurably a blend), and the holds around it estimate as originals |
| Cuts | the cut-sync test runs only on real cuts; boundaries next to a dissolve are covered by the opacity check |

`storyboards/madrid-rio-dissolve.json` is the second version of the pilot; `madrid-rio.json` stays
the hard-cut original. `storyboards/smoke-dissolve.json` is a 4 s preview (three dates, two dissolves).

**Interactive opacity preview (local, optional).** `--interactive` opens a visible window of the same
page with a slider over the frames of one dissolve, from the last original frame before it to the
first after it, drawn by the same `renderFrame` as the video: it shows exactly the opacities the film
uses. Same local server, request blocking and sandbox; it writes nothing.

```powershell
node render.mjs --package C:\workspace\temporal-packages\madrid-rio-z16-final --storyboard storyboards/madrid-rio-dissolve.json --out C:\renders\interactive --width 1280 --height 720 --interactive
```

### Pilot results (2026-11-26)

Same Gate 4B package, not downloaded again; the hard-cut original
(`C:\workspace\temporal-renders\madrid-rio-gate4c\final\video.mp4`, SHA-256 `7049c700…`) is left as is.

- **Hard cut unchanged:** the hard-cut storyboard renders byte-identical with the Gate 4C code
  and with this code (960 × 540, SHA-256 `7279a93f…`, both runs PASS).
- **Short preview** (`smoke-dissolve.json`, 960 × 540, 4 s): PASS. Its first run flagged a flaw in the
  test, not the render: at α ≈ 0.5 the reversed-pair rival is the same picture, so the page probe
  moved to α ≈ 0.3 and 0.7.
- **Second film**, `C:\workspace\temporal-renders\madrid-rio-gate4c1\final-dissolve-2\` (`video.mp4`
  35.0 MB, `render-manifest.json` PASS, commit `00f5f69`, `screenshots\`): 1920 × 1080, 30/1, 1038
  decoded frames, 34.6 s; 846 original and 192 transition frames, 8 dissolves of 0.8 s.
  - Opacity in the MP4: 8/8 dissolves, largest \|α̂ − α\| 0.009, largest residual 4.2 % of the
    A–B difference, every transition frame ≥ 0.031 from either original, holds 0.000.
  - Page probes 37/37 (16 blend probes: declared blend ≥ 1.8 × better than the closest rival,
    1 px shifts worse by ≥ 5.3); label ↔ image sync 0 mismatches; 4 real cuts on the exact frame;
    seek PSNR ≥ 38.1 dB; 16 local requests, 0 to the IGN; package unchanged.
- A first 1080p render (`final-dissolve`) passed every check but showed the two ruler labels of
  the 1997–98 → 1997–2003 dissolve overlapping (both start in 1997); they are now stacked, and that
  render is superseded.
- Interactive preview: checked with `--interactive-screenshot` (slider at 52 % of the
  1956–57 → 1997–98 dissolve, frame 270).

## 3D Animator skill: audit (verdict MODIFY)

The `3d-animator` skill (in `.claude/skills/3d-animator`, untracked) was read in full before any
code was written; none of its scripts was run.

- **Reused (as method, not code):** every frame a pure function of `t`; headless Chromium renders
  frame by frame and pipes PNGs into FFmpeg (`image2pipe` → libx264), so no frame is dropped;
  sub-frame accumulation for motion blur on camera moves; one lens and one eased progress value per
  move; stills → preview → final, checking the encoded file rather than the browser.
- **Adapted:** Puppeteer replaced by the repo's existing Playwright 1.63 (no second browser
  download); its static server replaced by a GET-only allow-list server; request blocking and a
  network log added; BT.709 conversion made explicit; validation of the encoded file extended
  (cut sync, alignment, imagery presence). Chromium runs with its sandbox on and without
  Playwright's default `--enable-unsafe-swiftshader` (the kit instead adds `--ignore-gpu-blocklist`);
  without GPU WebGL the render stops rather than weakening the browser. The launch options are
  recorded in the manifest (`environment.chromium_launch`).
- **Not needed:** lighting rig, depth of field, dust, styles (clay/toon/neon), props, sound and
  voice (ElevenLabs), the phone-shake and laptop compositing tools, the recipes.
- **Risks found:** the kit has **no licence file**, so no code was copied; `npm install` of the kit
  downloads a ~170 MB Chrome through Puppeteer's install script (avoided); its advice on bold
  lighting, hand-held realism and sound is aimed at product reels and would misrepresent
  scientific imagery here; it does not detect a lost WebGL context, which happened in this pilot
  (see below).

## Pilot (2026-11-26): Madrid Río

Package `C:\workspace\temporal-packages\madrid-rio-z16-final` (Gate 4B, reused as is, not
downloaded again; Gate 4B `--verify`: 43 files match). Reference 2006 + nine dates, 1956–57 to 2023,
all `COVERAGE_UNVERIFIED`. Storyboard built from what the frames show: riverside road corridor in
1997–98, bare works ground 2006–2011, a linear park from 2014 (a visual reading, not a measurement).

| Shot | Video | Content |
|---|---|---|
| Intro | 0–4 s | title over the 2006 reference; perspective, tilt 22° → 0°, heading −6° → 0° |
| Context | 4–7.5 s | north-up extent, centre, Mercator vs ground size, scale bar |
| Sequence | 7.5–19.2 s | nine dates × 1.3 s, hard cuts, published-year ruler |
| Comparison | 19.2–24.2 s | 1997–98 \| 2023 wipe on the same plane |
| Closing | 24.2–30 s | 2023, sources, licence, method caveats |

Stages: A smoke (2 dates, 640 × 360, 4.7 s) PASS; B preview (960 × 540) PASS on its third run
(see below); C final, one storyboard, 1920 × 1080, 30 fps, 4 sub-frames on camera moves, 341 s on an
Intel UHD 620 (ANGLE D3D11). Results, outside the repository:

```
C:\workspace\temporal-renders\madrid-rio-gate4c\final\video.mp4             (20.1 MB)
C:\workspace\temporal-renders\madrid-rio-gate4c\final\render-manifest.json  (status PASS, commit 1d28d79)
C:\workspace\temporal-renders\madrid-rio-gate4c\final\screenshots\
```

- ffprobe: H.264 High, yuv420p BT.709, 1920 × 1080, 30/1, 900 decoded frames, 30.000 s; full decode clean.
- Alignment, 21 probes: right image MAD 1.3–5.0 against ≥ 27.6 for any other date, ≥ 41.3 mirrored;
  every 1 px shift worse by ≥ 7.1; outside the extent 0.
- Encoded file: seek PSNR 39.5–44.5 dB on 39 key frames; all 12 cuts on the exact frame (≥ 40.1 dB
  against the right frame, ≤ 18.8 dB against its neighbour). Label ↔ image sync: 0 mismatches in 900 frames.
- Network: 16 requests, all to the local server; 0 blocked, 0 to the IGN. Console: no errors or warnings.
- Package: 44 files byte-identical, same modification times, after all runs.
- Two final renders of the same code on this machine produced byte-identical MP4s
  (SHA-256 `7049c700…eb9d89`). One observation on one system, not a cross-system guarantee.

What went wrong on the way, kept for the record: the first preview lost its WebGL context (the
alignment probes allocated a canvas each) and encoded frames without imagery while passing the
checks of that version; probe canvases are now reused, a lost context stops the render, and the
imagery-presence check was added. A later preview failed in FFmpeg with an allocation error when
free memory dropped to ~1.5 GB; the same frames encoded cleanly in isolation and on the next run.
One final render was interrupted by the session ending and is not used.

## Elevation surface (Gate 4D)

Optional. A geometry package made by [`geometry/materialize_geometry.py`](geometry/materialize_geometry.py)
from PNOA-LiDAR MDS/MDT 50 cm sheets puts one elevation value on every texture pixel of the window the
sheet covers. `--geometry <dir>` loads it (refused unless it was materialized for this very package);
storyboard shots of kind `surface` / `surface_closing` then show the texture on the MDT terrain with LoD1
buildings (`lod1`: Catastro footprints × LiDAR heights, neutral facades), the MDT alone, a flat copy, or the
experimental MDS surface, at 1× vertical scale unless stated, with texture date, geometry date, their gap and the
vertical scale on screen. A historical texture on recent geometry is refused unless the shot carries a
visible `temporal_warning`.

```powershell
node render.mjs --package C:\workspace\temporal-packages\madrid-rio-z16-final `
  --geometry C:\workspace\temporal-geometry\madrid-rio-lidar2024-lod1-v2 `
  --storyboard storyboards/madrid-rio-3d.json --out C:\workspace\temporal-renders\madrid-rio-gate4d\final --width 1920 --height 1080 --n 4
```

Sources, decisions, coordinates, measured results and limitations: [geometry/GATE_4D.md](geometry/GATE_4D.md).

## Limitations

- Frames are 1280 × 800 requests (~1.8 m ground spacing at the centre); 1080p output resamples
  them and adds no spatial detail.
- Visible differences between dates are a visual reading, not a measurement, and imply no cause.
- Every pilot frame is `COVERAGE_UNVERIFIED`: no blank region was detected, which does not prove
  complete coverage. Licence `CC BY 4.0 scne.es` is declared service-wide, not verified per layer.
- The alignment checks compare the render with the package images, so they prove the engine
  shows what the package holds, not that the IGN mosaics are mutually co-registered. Sub-pixel
  differences between separate IGN requests were noted in Gate 4B.
- Typography uses the system font (`Segoe UI` on Windows, with fallbacks); other systems may set
  the text slightly differently.
- Rendering at 1080p needs a few GB of free memory: a run with ~1.5 GB free failed once with an
  FFmpeg allocation error (now reported as exit 3).
