# iPad measurement procedure (physical device)

An iPad **cannot** run Playwright. A desktop browser in an iPad viewport, or any
device-emulation mode, is **not** an iPad and must never be recorded as one:
the GPU, the compositor, the touch input and the memory ceiling are all
different. This manual procedure is the only device-grade iPad route.

## Steps

1. **Serve the repo from a laptop on the same Wi-Fi** (repo root):
   ```
   python3 -m http.server 8000
   ```
   Find the laptop's LAN IP (e.g. `192.168.1.20`).

2. **On the iPad, open each harness URL in Safari** (replace the IP). Append
   `&device_label=`, `&cache=`, `&network=`, and `auto=1`:

   This matrix **mirrors `run_device.mjs --suite=full`** exactly, so the iPad
   results pair 1-to-1 with the laptop results. Every comparative scenario is run
   on **both** engines with the **same** layers, basemap and `recompute` mode, and
   the ceiling series uses the **same** `kind`/`count` on both. `recompute=full`
   runs the two-model analytical recompute; `recompute=renderer` moves the Lens
   overlay only.

   Comparative real payload — run BOTH engines for each line (swap
   `leaflet_baseline.html` ↔ `maplibre_proto/maplibre_prototype.html`), for
   `basemap=light` and `basemap=satellite`, and `recompute=renderer` and `=full`:
   ```
   http://192.168.1.20:8000/research/runtime_spike/device_harness/leaflet_baseline.html?layers=ambito&basemap=light&recompute=renderer&auto=1&device_label=iPad-Air-M1-SafariXX&cache=cold&network=wifi
   http://.../device_harness/leaflet_baseline.html?layers=ambito,licence&basemap=light&recompute=full&auto=1&...
   http://.../device_harness/leaflet_baseline.html?layers=ambito,licence,admin&basemap=light&recompute=full&auto=1&...
   http://.../maplibre_proto/maplibre_prototype.html?layers=ambito&basemap=light&recompute=renderer&auto=1&...
   http://.../maplibre_proto/maplibre_prototype.html?layers=ambito,licence&basemap=light&recompute=full&auto=1&...
   http://.../maplibre_proto/maplibre_prototype.html?layers=ambito,licence,admin&basemap=light&recompute=full&auto=1&...
   ```
   Comparative ceiling series — run BOTH engines at each count:
   ```
   http://.../device_harness/leaflet_ceiling.html?kind=polygon&count=765&auto=1&...   (…2000, 5675, 10000)
   http://.../device_harness/leaflet_ceiling.html?kind=point&count=11500&auto=1&...   (…25000, 50000)
   http://.../maplibre_proto/maplibre_prototype.html?kind=polygon&count=765&auto=1&... (…2000, 5675, 10000)
   http://.../maplibre_proto/maplibre_prototype.html?kind=point&count=11500&auto=1&... (…25000, 50000)
   ```
   (MapLibre needs internet for its CDN; the ámbito,licence,admin set and the
   ceiling stress cases are the parity cases the laptop runner also covers.)

3. When the on-screen JSON panel appears, tap **⬇ download JSON** (double-tap the
   panel to dismiss it). Repeat for every URL. For **cold cache**, use a new
   Safari private tab each time; for **warm cache**, reload once first and set
   `cache=warm`.

4. **Transfer the JSON files back** (AirDrop / Files) into
   `research/runtime_spike/results/ipad/` and commit them.

## What to check on each file

- `env.is_device_grade: true` and `env.gl_renderer` names the Apple GPU (not
  SwiftShader).
- `env.userAgent` contains a real iPad/Safari token.
- `interaction_to_paint_ms.p95` and `pan_frame_ms.p95` against
  `thresholds.json` (150 ms / 33.3 ms).

The lowest polygon/point `count` whose `interaction_to_paint_ms.p95 > 150` or
`pan_frame_ms.p95 > 33.3` is the **iPad Leaflet ceiling** — half of the MapLibre
trigger (the laptop run is the other half).
