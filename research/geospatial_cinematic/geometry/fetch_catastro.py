"""Gate 4D: fetch Catastro INSPIRE building parts (BU:BuildingPart) for an elevation window.

    python -I -X utf8 research/geospatial_cinematic/geometry/fetch_catastro.py \
        --geometry <Gate 4D geometry package (for the window)> --out <directory outside the repository>

Splits the window's EPSG:25830 bounding box into tiles of at most --tile-m metres, requests each tile
from the official WFS (one request at a time) and stores the GML exactly as received, with a
fetch-log.json (URL, time, bytes, SHA-256, feature count). Licence: CC BY 4.0 DG Catastro (INSPIRE
metadata record ES_SDGC_BU). Building parts crossing tile edges come back in several tiles; the
materializer de-duplicates them by gml:id.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import pathlib
import sys
import time
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(REPO / "research" / "pnoa_lidar_madrid_pilot"))
import lidar_core as core  # noqa: E402

core.isolate_proj_environment()

WFS = "http://ovc.catastro.meh.es/INSPIRE/wfsBU.aspx"
LICENCE = {"name": "CC BY 4.0", "attribution": "DG Catastro",
           "evidence": "IDEE CSW GetRecordById ES_SDGC_BU, gmd:otherConstraints 'CC BY 4.0 DG Catastro', dateStamp 2025-01-28"}


def window_bbox_25830(manifest, buffer_m):
    """Bounding box (EPSG:25830) of the window footprint, from its four corners."""
    from pyproj import Transformer

    w, s, e, n = manifest["grid"]["bbox_epsg3857"]
    t = Transformer.from_crs(3857, 25830, always_xy=True)
    xs, ys = t.transform([w, e, e, w], [n, n, s, s])
    return [min(xs) - buffer_m, min(ys) - buffer_m, max(xs) + buffer_m, max(ys) + buffer_m]


def tiles(bbox, tile_m):
    x0, y0, x1, y1 = bbox
    nx, ny = math.ceil((x1 - x0) / tile_m), math.ceil((y1 - y0) / tile_m)
    dx, dy = (x1 - x0) / nx, (y1 - y0) / ny
    return [[round(x0 + i * dx, 1), round(y0 + j * dy, 1), round(x0 + (i + 1) * dx, 1), round(y0 + (j + 1) * dy, 1)]
            for j in range(ny) for i in range(nx)]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--geometry", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tile-m", type=float, default=600.0)
    ap.add_argument("--buffer-m", type=float, default=20.0)
    a = ap.parse_args()
    out = pathlib.Path(a.out).resolve()
    if REPO in out.parents or out == REPO:
        raise SystemExit("REFUSED: store fetched data outside the repository")
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"REFUSED: {out} is not empty")
    out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((pathlib.Path(a.geometry) / "geometry-manifest.json").read_text("utf8"))
    bbox = window_bbox_25830(manifest, a.buffer_m)
    log = {"service": WFS, "type": "BU:BuildingPart", "srsname": "EPSG::25830", "licence": LICENCE,
           "window_bbox_epsg25830": [round(v, 1) for v in bbox], "tile_m": a.tile_m, "requests": []}
    for k, b in enumerate(tiles(bbox, a.tile_m)):
        url = (f"{WFS}?service=WFS&version=2.0.0&request=GetFeature&typenames=BU:BuildingPart"
               f"&srsname=EPSG::25830&bbox={','.join(str(v) for v in b)}")
        req = urllib.request.Request(url, headers={"User-Agent": "research-client"})
        started = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
        with urllib.request.urlopen(req, timeout=180) as r:
            body = r.read()
            status = r.status
        name = f"tile_{k:02d}.gml"
        (out / name).write_bytes(body)
        if status != 200 or b"FeatureCollection" not in body[:2000]:
            raise SystemExit(f"tile {k}: HTTP {status}, not a feature collection; see {name}")
        n = body.count(b"<bu-ext2d:BuildingPart ")
        log["requests"].append({"file": name, "bbox_epsg25830": b, "url": url, "retrieved_at": started, "http_status": status,
                                "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(), "building_parts": n})
        print(f"{name}: {n} parts, {len(body)} bytes")
        time.sleep(1.0)
    (out / "fetch-log.json").write_text(json.dumps(log, indent=2), encoding="utf8", newline="\n")
    print(f"{len(log['requests'])} tiles -> {out}")


if __name__ == "__main__":
    main()
