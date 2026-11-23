"""Bounded diagnostics for the PNOA-LiDAR pilot (run AFTER run_pilot.py passes).

    python research/pnoa_lidar_madrid_pilot/diagnostics.py --mds <MDS.tif> --mdt <MDT.tif>

Answers three narrow questions about the real Embajadores sheet and attributes no
cause to anything it cannot show:

1. CRS / alignment: how EPSG:3042 differs from EPSG:25830 (axis order), and
   whether the two rasters are co-registered. Evidence is the exact equality of
   the GeoTIFF georeferencing; a one-cell-shift test is also run and reported, but
   it turned out NOT to discriminate (see shift_sensitivity).
2. Where are the cells with MDS - MDT >= 45 m, and do they look like identifiable
   structures or artefacts (side-by-side crops with the PNOA orthophoto).
3. Where are the cells < 0.5 m (the "ground-like" cells), by connected component
   size and equivalent width, with crops.

Orthophoto crops come from the IGN PNOA WMS (CC BY 4.0 scne.es). That service is
dynamic and shows a different date from the 2024 LiDAR, so the crops are a visual
aid, never a measurement; pass --no-orthophoto to skip them.
"""

from __future__ import annotations

import argparse
import io
import json
import pathlib
import sys

import lidar_core as core

core.isolate_proj_environment()  # before rasterio/pyproj are imported

import run_pilot as rp  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
WMS = "https://www.ign.es/wms-inspire/pnoa-ma"
HIGH_M, LOW_M = 45.0, 0.5
CROP_HALF_M = 45.0


def crs_report(mds_path, mdt_path):
    import rasterio
    from pyproj import CRS, Transformer

    a, b = CRS.from_epsg(3042), CRS.from_epsg(25830)
    out = {
        "epsg_3042": {"name": a.name, "axes": [[x.abbrev, x.direction] for x in a.axis_info]},
        "epsg_25830": {"name": b.name, "axes": [[x.abbrev, x.direction] for x in b.axis_info]},
        "pyproj_equals_strict": bool(a.equals(b)),
        "pyproj_equals_ignore_axis_order": bool(a.equals(b, ignore_axis_order=True)),
    }
    e, n = 440000.0, 4474000.0
    out["transform_check"] = {
        "authority_order_3042_input_is_(N,E)": list(Transformer.from_crs(3042, 25830).transform(n, e)),
        "traditional_GIS_order_(E,N)_via_always_xy": list(Transformer.from_crs(3042, 25830, always_xy=True).transform(e, n)),
        "expected_(E,N)": [e, n],
    }
    files = {}
    for key, p in (("mds", mds_path), ("mdt", mdt_path)):
        with rasterio.open(p) as src:
            wkt = src.crs.to_wkt()
            files[key] = {
                "declared_epsg": src.crs.to_epsg(),
                "wkt_axis_names_in_file": [w for w in ("Easting", "Northing") if f'AXIS["{w}"' in wkt],
                "geotransform": list(src.transform)[:6],
                "bounds": list(src.bounds),
                "shape": [src.height, src.width],
            }
    out["files"] = files
    out["geotransform_exactly_equal"] = files["mds"]["geotransform"] == files["mdt"]["geotransform"]
    out["bounds_exactly_equal"] = files["mds"]["bounds"] == files["mdt"]["bounds"]
    out["shape_equal"] = files["mds"]["shape"] == files["mdt"]["shape"]
    return out


def shift_sensitivity(mds, mdt, inside, nd_mds, nd_mdt, k=2):
    """Re-register MDT by whole cells and report how the difference changes.

    Intended as an independent data-level co-registration test. On the real pair it
    does not discriminate: the MDT is a smooth interpolated ground surface, so
    moving it by up to one metre barely changes MDS - MDT and no shift produces
    negative differences. ``discriminating`` records that honestly, so a flat
    result is never read as proof of alignment.
    """
    h, w = mds.shape
    base_ok = core.valid_mask(mds, nd_mds)
    rows = []
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            a = mds[k:h - k, k:w - k]
            b = mdt[k + dy:h - k + dy, k + dx:w - k + dx]
            ok = inside[k:h - k, k:w - k] & base_ok[k:h - k, k:w - k] & core.valid_mask(b, nd_mdt)
            d = a[ok].astype("float32") - b[ok]
            rows.append({"dy_cells": dy, "dx_cells": dx, "cells": int(d.size),
                         "share_below_-0.5m": float((d < -0.5).mean()),
                         "share_below_-0.25m": float((d < -0.25).mean()),
                         "std_m": float(d.std())})
    shares = [r["share_below_-0.5m"] for r in rows]
    stds = [r["std_m"] for r in rows]
    discriminating = (max(shares) - min(shares)) > 1e-3 or (max(stds) - min(stds)) > 0.1
    best = min(rows, key=lambda r: (r["share_below_-0.5m"], r["std_m"]))
    return {"shifts": rows, "range_share_below_-0.5m": max(shares) - min(shares), "range_std_m": max(stds) - min(stds),
            "discriminating": bool(discriminating), "best_shift_dy_dx": [best["dy_cells"], best["dx_cells"]],
            "reading": "co-registration is established by identical georeferencing, not by this test"
            if not discriminating else "shift (0,0) should be best if the pair is co-registered"}


def polygons(mask, transform):
    from rasterio.features import shapes
    from shapely.geometry import shape

    return [shape(g) for g, _ in shapes(mask.astype("uint8"), mask=mask, transform=transform, connectivity=8)]


def lonlat(e, n):
    from pyproj import Transformer

    return list(Transformer.from_crs(rp.CRS_ETRS89_UTM30, rp.CRS_WGS84, always_xy=True).transform(e, n))


def high_cells(ndsm, inside, mds, mdt, tf):
    import numpy as np
    from rasterio.features import rasterize

    mask = inside & np.isfinite(ndsm) & (ndsm >= HIGH_M)
    polys = polygons(mask, tf)
    rows = []
    for p in polys:
        minx, miny, maxx, maxy = p.bounds
        c0, r0 = int((minx - tf.c) / tf.a), int((tf.f - maxy) / -tf.e)
        c1, r1 = int(np.ceil((maxx - tf.c) / tf.a)), int(np.ceil((tf.f - miny) / -tf.e))
        win = (slice(r0, r1), slice(c0, c1))
        wtf = tf * tf.translation(c0, r0)
        m = rasterize([(p, 1)], out_shape=(r1 - r0, c1 - c0), transform=wtf, fill=0, dtype="uint8").astype(bool)
        v = ndsm[win][m]
        if not v.size:
            continue
        cx, cy = p.centroid.x, p.centroid.y
        rows.append({"easting": round(cx, 1), "northing": round(cy, 1), "lonlat": [round(x, 6) for x in lonlat(cx, cy)],
                     "cells": int(v.size), "area_m2": float(v.size * 0.25), "max_mds_minus_mdt_m": float(v.max()),
                     "mean_mds_minus_mdt_m": float(v.mean()),
                     "mdt_mean_m": float(np.nanmean(mdt[win][m])), "mds_max_m": float(mds[win][m].max())})
    rows.sort(key=lambda r: -r["max_mds_minus_mdt_m"])
    return {"threshold_m": HIGH_M, "cells": int(mask.sum()), "share_of_valid_aoi_cells": float(mask.sum() / inside.sum()),
            "components": len(rows), "top_components": rows[:12],
            "all_components_area_m2_desc": sorted((r["area_m2"] for r in rows), reverse=True)}


def low_cells(ndsm, inside, tf):
    import numpy as np

    mask = inside & np.isfinite(ndsm) & (ndsm < LOW_M)
    rows = []
    for p in polygons(mask, tf):
        a, per = p.area, p.length
        rows.append((a, 2 * a / per if per else 0.0, p))
    tot = sum(r[0] for r in rows) or 1.0
    area_b = [("<10 m2", 0, 10), ("10-100 m2", 10, 100), ("100-1000 m2", 100, 1000), (">=1000 m2", 1000, 1e18)]
    width_b = [("eq.width <3 m", 0, 3), ("3-8 m", 3, 8), ("8-20 m", 8, 20), (">=20 m", 20, 1e18)]
    by_area = {n: {"components": sum(lo <= r[0] < hi for r in rows),
                   "share_of_low_area": sum(r[0] for r in rows if lo <= r[0] < hi) / tot} for n, lo, hi in area_b}
    by_w = {n: {"share_of_low_area": sum(r[0] for r in rows if lo <= r[1] < hi) / tot} for n, lo, hi in width_b}
    exact_zero = float(((ndsm == 0) & mask).sum() / max(mask.sum(), 1))
    big = sorted(rows, key=lambda r: -r[0])[:8]
    return {"threshold_m": LOW_M, "cells": int(mask.sum()), "share_of_valid_aoi_cells": float(mask.sum() / inside.sum()),
            "components": len(rows), "by_component_area": by_area, "by_equivalent_width_2A_over_P": by_w,
            "share_of_low_cells_with_difference_exactly_zero": exact_zero,
            "largest_components": [{"area_m2": r[0], "eq_width_m": r[1],
                                    "centroid_EN": [round(r[2].centroid.x, 1), round(r[2].centroid.y, 1)]} for r in big]}, mask, big


def fetch_ortho(minx, miny, maxx, maxy, px=360):
    import requests
    from PIL import Image  # installed with matplotlib; no new dependency

    r = requests.get(WMS, params={"service": "WMS", "version": "1.3.0", "request": "GetMap", "layers": "OI.OrthoimageCoverage",
                                  "styles": "", "crs": "EPSG:25830", "bbox": f"{minx},{miny},{maxx},{maxy}",
                                  "width": px, "height": px, "format": "image/png"}, timeout=60,
                     headers={"User-Agent": "research-client"})
    r.raise_for_status()
    return Image.open(io.BytesIO(r.content)).convert("RGB")


def crop_figure(centres, ndsm, tf, low_mask, out, with_ortho, title):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    n = len(centres)
    fig, axes = plt.subplots(2 if with_ortho else 1, n, figsize=(2.6 * n, 5.3 if with_ortho else 2.8), dpi=90, squeeze=False)
    half = CROP_HALF_M
    for i, (e, nn, label) in enumerate(centres):
        c0, r0 = int((e - half - tf.c) / tf.a), int((tf.f - (nn + half)) / -tf.e)
        c1, r1 = c0 + int(2 * half / tf.a), r0 + int(2 * half / -tf.e)
        sl = (slice(max(r0, 0), r1), slice(max(c0, 0), c1))
        ax = axes[0][i]
        ax.imshow(ndsm[sl], cmap="viridis", vmin=0, vmax=40, interpolation="nearest")
        if low_mask is not None:
            ax.imshow(np.where(low_mask[sl], 1.0, np.nan), cmap="autumn", alpha=0.45, interpolation="nearest")
        ax.set_title(label, fontsize=7)
        ax.axis("off")
        if with_ortho:
            try:
                axes[1][i].imshow(fetch_ortho(e - half, nn - half, e + half, nn + half))
            except Exception as exc:  # network is optional
                axes[1][i].text(0.5, 0.5, f"ortho unavailable\n{type(exc).__name__}", ha="center", fontsize=6)
            axes[1][i].axis("off")
    fig.suptitle(title, fontsize=7)
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--mds", required=True, type=pathlib.Path)
    p.add_argument("--mdt", required=True, type=pathlib.Path)
    p.add_argument("--out", type=pathlib.Path, default=HERE / "results")
    p.add_argument("--no-orthophoto", action="store_true")
    args = p.parse_args(argv)
    rp._require()
    from rasterio.features import geometry_mask

    _, poly = rp.aoi_polygon_25830()
    mds, tf, nd1 = rp.read_window(args.mds, poly)
    mdt, _, nd2 = rp.read_window(args.mdt, poly)
    inside = geometry_mask([poly], out_shape=mds.shape, transform=tf, invert=True)
    ndsm = core.normalised_surface(mds, mdt, nd1, nd2)
    args.out.mkdir(parents=True, exist_ok=True)

    rep = {"crs_and_alignment": crs_report(args.mds, args.mdt)}
    rep["crs_and_alignment"]["one_cell_shift_sensitivity"] = shift_sensitivity(mds, mdt, inside, nd1, nd2)
    hi = high_cells(ndsm, inside, mds, mdt, tf)
    lo, lomask, big = low_cells(ndsm, inside, tf)
    rep["high_cells"], rep["low_cells"] = hi, lo
    ortho = not args.no_orthophoto
    rep["orthophoto"] = {"used": ortho, "service": WMS, "layer": "OI.OrthoimageCoverage",
                         "licence": "CC BY 4.0 scne.es (service-declared)",
                         "caveat": "dynamic service; date differs from the 2024 LiDAR; visual aid only"}
    crop_figure([(r["easting"], r["northing"], f"max {r['max_mds_minus_mdt_m']:.0f} m, {r['area_m2']:.0f} m2")
                 for r in hi["top_components"][:4]], ndsm, tf, None, args.out / "figure_cells_ge_45m.png", ortho,
                "MDS-MDT (0-40 m) above, PNOA orthophoto below; 90 m crops on the four tallest >=45 m clusters")
    centres = [(c.centroid.x, c.centroid.y, f"low comp. {a:.0f} m2, w={w:.0f} m") for a, w, c in big[:2]]
    from pyproj import Transformer

    plaza = Transformer.from_crs(rp.CRS_WGS84, rp.CRS_ETRS89_UTM30, always_xy=True).transform(*rp.DEMO_CIRCLE_LONLAT)
    cx, cy = poly.centroid.x, poly.centroid.y
    centres += [(plaza[0], plaza[1], "Plaza de Lavapies (approx.)"), (cx, cy, "barrio centre"), (cx - 250, cy + 150, "NW of centre")]
    crop_figure(centres, ndsm, tf, lomask, args.out / "figure_cells_lt_0_5m.png", ortho,
                "cells < 0.5 m in orange over MDS-MDT; PNOA orthophoto below; 90 m crops: two largest low components, plaza, centre, NW")
    (args.out / "diagnostics.json").write_text(json.dumps(rep, indent=2, ensure_ascii=False), encoding="utf-8")
    print("diagnostics written:", args.out / "diagnostics.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
