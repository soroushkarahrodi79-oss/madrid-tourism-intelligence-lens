"""Gate 4D visual review: data for one test crop, four representations (current, A, B, C).

    python -X utf8 research/geospatial_cinematic/geometry/review/prep_review.py \
        --package <Gate 4B package> --geometry <Gate 4D geometry package> \
        --mds <MDS sheet> --mdt <MDT sheet> --catastro <BuildingPart GML> --out <dir outside repo>

Same crop of the texture lattice for every variant (texture columns 380-700, rows 250-507):
  current  the Gate 4D grid as rendered (MDS, GDAL average on the 1.82 m texture lattice)
  A, B     MDS / MDT on a 4x finer lattice (~0.45 m) by NEAREST sampling: every value is an
           unmodified 0.5 m source cell (no averaging, no new heights)
  C        Catastro INSPIRE building parts (CC BY 4.0 DG Catastro) with heights from the LiDAR:
           roof = median MDS inside the footprint shrunk by 0.75 m, base = min MDT inside it.
Nothing is written into the repository or the packages.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "pnoa_lidar_madrid_pilot"))
import lidar_core as core  # noqa: E402

core.isolate_proj_environment()

CROP = {"col0": 380, "col1": 700, "row0": 250, "row1": 507}
FINE = 4
SHRINK_M = 0.75
MIN_PART_NDSM_M = 2.0


def parse_parts(gml_path):
    """BuildingPart id, floors above ground and polygon rings (EPSG:25830, x y)."""
    text = pathlib.Path(gml_path).read_text(encoding="iso-8859-1")
    parts = []
    for blk in re.findall(r"<bu-ext2d:BuildingPart (.*?)</bu-ext2d:BuildingPart>", text, re.S):
        pid = re.search(r'gml:id="([^"]+)"', blk).group(1)
        fl = re.search(r"<bu-ext2d:numberOfFloorsAboveGround>(\d+)<", blk)
        polys = []
        patches = re.findall(r"<gml:PolygonPatch>(.*?)</gml:PolygonPatch>", blk, re.S) or re.findall(r"<gml:Polygon[ >](.*?)</gml:Polygon>", blk, re.S)
        for surf in patches:
            rings = []
            for kind, pl in re.findall(r"<gml:(exterior|interior)>.*?<gml:posList[^>]*>(.*?)</gml:posList>", surf, re.S):
                v = [float(x) for x in pl.split()]
                rings.append((kind, list(zip(v[0::2], v[1::2]))))
            if rings:
                polys.append(rings)
        parts.append({"id": pid, "floors_above_ground": int(fl.group(1)) if fl else None, "polygons": polys})
    return parts


def main():
    import numpy as np
    import rasterio
    from pyproj import Transformer
    from rasterio.enums import Resampling
    from rasterio.features import geometry_mask
    from rasterio.transform import Affine
    from rasterio.warp import reproject
    from rasterio.windows import from_bounds
    from shapely.geometry import Polygon

    ap = argparse.ArgumentParser()
    for k in ("package", "geometry", "mds", "mdt", "catastro", "out"):
        ap.add_argument(f"--{k}", required=True)
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rec = json.loads((pathlib.Path(a.package) / "materialized-manifest.json").read_text("utf8"))
    sp = rec["spatial"]
    minE, minN, maxE, maxN = sp["bbox"]
    px, py = (maxE - minE) / sp["width"], (maxN - minN) / sp["height"]
    origin = [(minE + maxE) / 2, (minN + maxN) / 2]
    gm = json.loads((pathlib.Path(a.geometry) / "geometry-manifest.json").read_text("utf8"))
    g = gm["grid"]
    c0, c1, r0, r1 = CROP["col0"], CROP["col1"], CROP["row0"], CROP["row1"]
    assert g["window_texture_pixels"]["col0"] == 0 and g["window_texture_pixels"]["row0"] == 0 and r1 <= g["rows"]

    # current: slice of the rendered grid
    cur = np.fromfile(pathlib.Path(a.geometry) / "surface_mds.f32", "<f4").reshape(g["rows"], g["cols"])[r0:r1, c0:c1]
    np.ascontiguousarray(cur, "<f4").tofile(out / "current_mds.f32")

    # A/B: nearest on a 4x lattice (unmodified source values)
    fpx, fpy = px / FINE, py / FINE
    rows, cols = (r1 - r0) * FINE, (c1 - c0) * FINE
    t = Affine(fpx, 0, minE + c0 * px, 0, -fpy, maxN - r0 * py)
    for key, path in (("mds", a.mds), ("mdt", a.mdt)):
        dst = np.full((rows, cols), np.nan, "float32")
        with rasterio.open(path) as src:
            reproject(source=rasterio.band(src, 1), destination=dst, src_transform=src.transform, src_crs="EPSG:25830",
                      src_nodata=src.nodata, dst_transform=t, dst_crs="EPSG:3857", dst_nodata=np.nan, resampling=Resampling.nearest)
        assert np.isfinite(dst).all(), key
        dst.astype("<f4").tofile(out / f"fine_{key}.f32")

    # C: Catastro building parts with LiDAR-derived heights
    to3857 = Transformer.from_crs(25830, 3857, always_xy=True)
    to25830 = Transformer.from_crs(3857, 25830, always_xy=True)
    xs, ys = to25830.transform([minE + c0 * px, minE + c1 * px, minE + c1 * px, minE + c0 * px], [maxN - r0 * py, maxN - r0 * py, maxN - r1 * py, maxN - r1 * py])
    crop_poly = Polygon(list(zip(xs, ys)))
    srcs = {k: rasterio.open(p) for k, p in (("mds", a.mds), ("mdt", a.mdt))}
    parts_out = []
    skipped = {"outside_crop": 0, "no_cells": 0, "low_ndsm": 0, "no_geometry": 0, "multi_polygon": 0}
    for part in parse_parts(a.catastro):
        geoms = []
        for rings in part["polygons"]:
            ext = [r for k, r in rings if k == "exterior"]
            if ext:
                geoms.append(Polygon(ext[0], [r for k, r in rings if k == "interior"]))
        if not geoms:
            skipped["no_geometry"] += 1
            continue
        if len(geoms) > 1:
            skipped["multi_polygon"] += 1
            continue
        poly = geoms[0] if geoms[0].is_valid else geoms[0].buffer(0)
        if poly.geom_type != "Polygon" or not crop_poly.contains(poly.centroid):
            skipped["outside_crop"] += 1
            continue
        inner = poly.buffer(-SHRINK_M)
        if inner.is_empty or inner.area < 1.0:
            inner = poly
        stats = {}
        for key, src in srcs.items():
            b = poly.bounds
            w = from_bounds(b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1, src.transform).round_offsets().round_lengths()
            arr = src.read(1, window=w).astype("float64")
            wt = src.window_transform(w)
            ok = core.valid_mask(arr, src.nodata)
            m_inner = ~geometry_mask([inner.__geo_interface__], out_shape=arr.shape, transform=wt) & ok
            m_full = ~geometry_mask([poly.__geo_interface__], out_shape=arr.shape, transform=wt) & ok
            stats[key] = (arr[m_inner], arr[m_full])
        if stats["mds"][0].size == 0 or stats["mdt"][1].size == 0:
            skipped["no_cells"] += 1
            continue
        roof = float(np.median(stats["mds"][0]))
        base = float(stats["mdt"][1].min())
        ground_med = float(np.median(stats["mdt"][1]))
        if roof - ground_med < MIN_PART_NDSM_M:
            skipped["low_ndsm"] += 1
            continue

        def ring3857(r):
            X, Y = to3857.transform([p[0] for p in r], [p[1] for p in r])
            return [[round(x - origin[0], 3), round(y - origin[1], 3)] for x, y in zip(X, Y)]

        parts_out.append({
            "id": part["id"], "floors_above_ground": part["floors_above_ground"],
            "outer": ring3857(list(poly.exterior.coords)), "holes": [ring3857(list(h.coords)) for h in poly.interiors],
            "roof_m": round(roof, 2), "base_m": round(base, 2), "ground_median_m": round(ground_med, 2),
            "height_above_ground_m": round(roof - ground_med, 2),
            "roof_iqr_m": round(float(np.percentile(stats["mds"][0], 75) - np.percentile(stats["mds"][0], 25)), 2),
            "cells": int(stats["mds"][0].size),
        })
    for s in srcs.values():
        s.close()
    fl = np.array([[p["height_above_ground_m"], p["floors_above_ground"]] for p in parts_out if p["floors_above_ground"]], float)
    per_floor = fl[:, 0] / fl[:, 1]
    meta = {
        "crop_texture_px": CROP, "fine_factor": FINE, "texture_px": [px, py], "origin_epsg3857": origin,
        "fine": {"rows": rows, "cols": cols, "pixel": [fpx, fpy], "resampling": "nearest (unmodified 0.5 m source cells)"},
        "current": {"rows": r1 - r0, "cols": c1 - c0},
        "base_m": gm["vertical_base_m"],
        "catastro": {"source": "Catastro INSPIRE WFS BU:BuildingPart (http://ovc.catastro.meh.es/INSPIRE/wfsBU.aspx)",
                     "licence": "CC BY 4.0 DG Catastro (IDEE CSW record ES_SDGC_BU, otherConstraints, dateStamp 2025-01-28)",
                     "parts_used": len(parts_out), "skipped": skipped, "shrink_m": SHRINK_M, "min_part_ndsm_m": MIN_PART_NDSM_M,
                     "height_rule": "roof = median MDS in footprint shrunk 0.75 m; base = min MDT in footprint; height = roof - median MDT",
                     "metres_per_floor_check": {"parts_with_floors": int(len(per_floor)), "median": round(float(np.median(per_floor)), 2),
                                                "p10": round(float(np.percentile(per_floor, 10)), 2), "p90": round(float(np.percentile(per_floor, 90)), 2)}},
    }
    (out / "parts.json").write_text(json.dumps(parts_out), encoding="utf8")
    (out / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf8")
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
