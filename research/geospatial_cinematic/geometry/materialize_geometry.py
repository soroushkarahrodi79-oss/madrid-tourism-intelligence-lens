"""Gate 4D geometry materialization: official PNOA-LiDAR MDS/MDT sheets -> elevation grids
on the exact pixel lattice of a Gate 4B texture package.

    python -I -X utf8 research/geospatial_cinematic/geometry/materialize_geometry.py \
        --package <Gate 4B package dir> --mds <MDS50CM-...tif> --mdt <MDT50CM-...tif> \
        --points research/geospatial_cinematic/geometry/madrid-rio-points.json \
        --out <directory outside the repository>

Official elevation -> spatial validation -> crop + reprojection -> elevation grid (the Three.js
mesh is built from that grid by the renderer, lib/geometry.mjs).

What it does, in order (any refusal exits non-zero and writes no geometry):
  1. Reads the Gate 4B package spatial record (EPSG:3857 bbox, 1280 x 800 lattice) and checks the
     two LiDAR sheets as a pair (CRS equivalent to EPSG:25830, 0.5 m cells, same lattice), reusing
     the merged PNOA-LiDAR pilot code (research/pnoa_lidar_madrid_pilot).
  2. Chooses the largest window of WHOLE texture pixels whose footprint lies inside the sheet,
     at least --margin-m inside its edges. Texture pixels outside the sheet get no elevation:
     nothing is extrapolated or filled.
  3. Reprojects MDS and MDT from EPSG:25830 (0.5 m) onto that window of the EPSG:3857 texture
     lattice with GDAL "average" resampling, so each grid value is the mean source elevation of
     one texture pixel footprint. Grids are float32, row 0 = north; a single NaN (NoData) refuses.
  4. Validates: elevation range, anomalies, MDS - MDT (nDSM) distribution, independent per-point
     recomputation from the source raster, and texture-to-elevation correspondence (gradient
     cross-correlation over integer pixel shifts, with mirrored controls).
  5. Writes surface_mds.f32, surface_mdt.f32, geometry-manifest.json and checksums.sha256.

The inputs are only read. The script never downloads anything (the CNIG download is behind a
reCAPTCHA and is done by a person).
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import pathlib
import platform
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[2]
PILOT = REPO / "research" / "pnoa_lidar_madrid_pilot"
sys.path.insert(0, str(PILOT))

import lidar_core as core  # noqa: E402  (merged PNOA-LiDAR pilot, PR #218)

core.isolate_proj_environment()  # before rasterio / pyproj are imported

import run_pilot  # noqa: E402  (inspect_raster: file-level metadata incl. CRS equivalence)

GEOMETRY_SCHEMA = {"id": "urn:madrid-urban-evidence-lens:geometry-package", "version": "0.1.0"}
TOOL = {"name": "madrid-geometry-materializer", "version": "0.1.0"}
SRC_CRS = "EPSG:25830"
DST_CRS = "EPSG:3857"
ELEVATION_PLAUSIBLE_M = (520.0, 760.0)  # Madrid city lies ~540-700 m a.s.l.; outside = anomaly
NDSM_NEGATIVE_TOLERANCE_M = core.NEGATIVE_TOLERANCE_M
SHIFT_RANGE_PX = 6

# Official source facts, re-checked 2026-11-26 (see GATE_4D.md "Source audit" for URLs).
SOURCES = {
    "mds": {
        "product": "MDS 50 cm, 3.ª cobertura PNOA-LiDAR, versión 1 (provisional, interpolado de NPC01)",
        "identifier": "MDS50cm-cob3",
        "producer": "Instituto Geográfico Nacional (IGN) / CNIG",
        "catalogue_url": "https://centrodedescargas.cnig.es/CentroDescargas/modelo-digital-superficies-mds50cm-tercera-cobertura",
        "semantics": "interpolation of all point classes: terrain, vegetation, buildings and other elements",
    },
    "mdt": {
        "product": "MDT 50 cm, 3.ª cobertura PNOA-LiDAR, versión 1 (provisional, clase suelo de NPC01)",
        "identifier": "MDT50cm-cob3",
        "producer": "Instituto Geográfico Nacional (IGN) / CNIG",
        "catalogue_url": "https://centrodedescargas.cnig.es/CentroDescargas/modelo-digital-terreno-mdt50cm",
        "semantics": "interpolation of the ground class",
    },
}
ACQUISITION = {
    "kind": "flight_interval_month_level",
    "start": "2024-03",
    "end": "2024-05",
    "start_year": 2024,
    "end_year": 2024,
    "label": "mar–may 2024",
    "source": "https://pnoa.ign.es/pnoa-lidar/tercera-cobertura (table 'Estado actual (septiembre 2026)', row Comunidad de Madrid)",
    "conflicting_statement": "CNIG novedades 2026-08-26 (MDS v1 Madrid) says the Madrid flight took place 'entre los años 2023 y 2024'; "
                             "the per-region table gives mar-24 to may-24. The table is used; the conflict is recorded.",
    "acquisition_day": None,
}
PUBLICATION = {"mdt_v1": "2026-04-14", "mds_v1": "2026-08-25",
               "v2_madrid": "not published (forecast 2nd half 2026; not in the 2026-11-16 MDT v2 release)"}
LICENCE = {
    "name": "CC BY 4.0 (IGN licence conditions, Orden FOM/2807/2015)",
    "attribution": core.ATTRIBUTION,
    "url": "http://www.scne.es/tablaProductos.php",
}
VERTICAL = {"reference": "orthometric heights, geoid EGM08 (PNOA-LiDAR technical specification)", "units": "metre"}
DECLARED_ACCURACY = {"rmse_z_model_m": 0.15, "planimetric_model_m": 0.5, "point_density_per_m2": 5,
                     "note": "contractual specifications, not values measured for this sheet"}


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def load_package(pkg_dir: pathlib.Path):
    raw = (pkg_dir / "materialized-manifest.json").read_bytes()
    rec = json.loads(raw.decode("utf8"))
    sp = rec["spatial"]
    if sp["crs"] != DST_CRS:
        raise SystemExit(f"REFUSED: package CRS {sp['crs']} is not {DST_CRS}")
    return rec, sp, sha256_bytes(raw)


def frame_for(rec, coverage_id):
    for f in rec["frames"]:
        if f["coverage_id"] == coverage_id:
            return f
    raise SystemExit(f"REFUSED: coverage {coverage_id} not in the package")


def longest_run(flags):
    best, cur, start = (0, 0), 0, 0
    for i, f in enumerate(flags):
        if f:
            if cur == 0:
                start = i
            cur += 1
            if cur > best[1] - best[0]:
                best = (start, i + 1)
        else:
            cur = 0
    return best


def choose_window(sp, sheet_bounds, margin_m):
    """Largest block of whole texture pixels whose 4 corners lie inside the sheet minus margin."""
    import numpy as np
    from pyproj import Transformer

    minE, minN, maxE, maxN = sp["bbox"]
    W, H = sp["width"], sp["height"]
    px = (maxE - minE) / W
    py = (maxN - minN) / H
    t = Transformer.from_crs(DST_CRS, SRC_CRS, always_xy=True)
    E, N = np.meshgrid(minE + px * np.arange(W + 1), maxN - py * np.arange(H + 1))
    X, Y = t.transform(E, N)
    x0, y0, x1, y1 = sheet_bounds
    corner_ok = (X >= x0 + margin_m) & (X <= x1 - margin_m) & (Y >= y0 + margin_m) & (Y <= y1 - margin_m)
    cell_ok = corner_ok[:-1, :-1] & corner_ok[1:, :-1] & corner_ok[:-1, 1:] & corner_ok[1:, 1:]
    r0, r1 = longest_run(cell_ok.all(axis=1))
    c0, c1 = longest_run(cell_ok[r0:r1].all(axis=0))
    if r1 - r0 < 16 or c1 - c0 < 16:
        raise SystemExit("REFUSED: the sheet does not cover a usable block of the texture extent")
    return {"row0": int(r0), "row1": int(r1), "col0": int(c0), "col1": int(c1), "px": px, "py": py,
            "covered_cell_fraction_of_texture": float(cell_ok.mean())}


def reproject_to_window(path, sp, win):
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import Affine
    from rasterio.warp import reproject

    minE, _, _, maxN = sp["bbox"]
    rows, cols = win["row1"] - win["row0"], win["col1"] - win["col0"]
    dst_t = Affine(win["px"], 0, minE + win["col0"] * win["px"], 0, -win["py"], maxN - win["row0"] * win["py"])
    dst = np.full((rows, cols), np.nan, dtype="float32")
    with rasterio.open(path) as src:
        reproject(
            source=rasterio.band(src, 1), destination=dst,
            src_transform=src.transform, src_crs=SRC_CRS, src_nodata=src.nodata,
            dst_transform=dst_t, dst_crs=DST_CRS, dst_nodata=np.nan,
            resampling=Resampling.average,
        )
    return dst, dst_t


def stats(a):
    import numpy as np

    v = a[np.isfinite(a)].astype("float64")
    q = np.percentile(v, [0, 1, 5, 25, 50, 75, 95, 99, 100])
    keys = ["min", "p01", "p05", "p25", "p50", "p75", "p95", "p99", "max"]
    return {**{k: round(float(x), 3) for k, x in zip(keys, q)},
            "mean": round(float(v.mean()), 3), "std": round(float(v.std()), 3), "count": int(v.size)}


def point_checks(points, sp, win, grids, paths):
    """Recompute each probed grid cell from the source raster, independently of GDAL warp.

    Independent value = unweighted mean of the 0.5 m source cells whose centres fall inside the
    texture pixel footprint (its four corners transformed to EPSG:25830). GDAL 'average' weights
    partially covered edge cells, so the two can differ where elevation jumps inside the footprint
    (roof edges); the tolerance therefore grows with the spread of source values in the footprint.
    """
    import numpy as np
    import rasterio
    from matplotlib.path import Path as MplPath
    from pyproj import Transformer
    from rasterio.windows import from_bounds

    t = Transformer.from_crs(DST_CRS, SRC_CRS, always_xy=True)
    minE, _, _, maxN = sp["bbox"]
    px, py = win["px"], win["py"]
    out = []
    srcs = {k: rasterio.open(p) for k, p in paths.items()}
    try:
        for p in points:
            col, row = p["texture_px"]
            if not (win["col0"] <= col < win["col1"] and win["row0"] <= row < win["row1"]):
                raise SystemExit(f"REFUSED: point {p['id']} at texture pixel {col},{row} is outside the elevation window")
            e0, e1 = minE + col * px, minE + (col + 1) * px
            n1, n0 = maxN - row * py, maxN - (row + 1) * py
            xs, ys = t.transform([e0, e1, e1, e0], [n1, n1, n0, n0])
            poly = MplPath(list(zip(xs, ys)))
            ce, cn = t.transform((e0 + e1) / 2, (n0 + n1) / 2)
            rec = {"id": p["id"], "category": p["category"], "reading": p["reading"], "texture_px": [col, row],
                   "grid_rc": [row - win["row0"], col - win["col0"]],
                   "centre_epsg3857": [round((e0 + e1) / 2, 3), round((n0 + n1) / 2, 3)],
                   "centre_epsg25830": [round(ce, 3), round(cn, 3)], "surfaces": {}}
            for key, src in srcs.items():
                w = from_bounds(min(xs) - 1, min(ys) - 1, max(xs) + 1, max(ys) + 1, src.transform).round_offsets().round_lengths()
                arr = src.read(1, window=w).astype("float64")
                wt = src.window_transform(w)
                CX, CY = np.meshgrid(wt.c + (np.arange(arr.shape[1]) + 0.5) * wt.a, wt.f + (np.arange(arr.shape[0]) + 0.5) * wt.e)
                inside = poly.contains_points(np.c_[CX.ravel(), CY.ravel()]).reshape(arr.shape) & core.valid_mask(arr, src.nodata)
                vals = arr[inside]
                nr, nc = src.index(ce, cn)
                nearest = float(src.read(1, window=((nr, nr + 1), (nc, nc + 1)))[0, 0])
                g = float(grids[key][row - win["row0"], col - win["col0"]])
                mean = float(vals.mean())
                spread = float(vals.max() - vals.min())
                tol = 0.05 + 0.15 * spread
                rec["surfaces"][key] = {
                    "grid_value_m": round(g, 3), "independent_footprint_mean_m": round(mean, 3), "source_cells_in_footprint": int(vals.size),
                    "source_min_m": round(float(vals.min()), 3), "source_max_m": round(float(vals.max()), 3),
                    "source_std_m": round(float(vals.std()), 3), "nearest_source_cell_at_centre_m": round(nearest, 3),
                    "diff_grid_minus_independent_m": round(g - mean, 3), "tolerance_m": round(tol, 3),
                    "diff_grid_minus_nearest_m": round(g - nearest, 3),
                    "pass": bool(abs(g - mean) <= tol and vals.min() - 1e-3 <= g <= vals.max() + 1e-3),
                }
            rec["ndsm_grid_m"] = round(rec["surfaces"]["mds"]["grid_value_m"] - rec["surfaces"]["mdt"]["grid_value_m"], 3)
            rec["pass"] = all(s["pass"] for s in rec["surfaces"].values())
            out.append(rec)
    finally:
        for s in srcs.values():
            s.close()
    return out


def gradient_magnitude(a):
    import numpy as np

    gy, gx = np.gradient(a)
    return np.hypot(gx, gy)


def ncc(a, b):
    a = a - a.mean()
    b = b - b.mean()
    return float((a * b).sum() / math.sqrt((a * a).sum() * (b * b).sum()))


def shift_scores(A, B, r=SHIFT_RANGE_PX):
    """NCC of A's core against B sampled at integer shifts (+dx east, +dy south)."""
    m = r + 2
    core_a = A[m:-m, m:-m]
    return {(dx, dy): ncc(core_a, B[m + dy:B.shape[0] - m + dy, m + dx:B.shape[1] - m + dx])
            for dy in range(-r, r + 1) for dx in range(-r, r + 1)}


def subpixel_peak(scores, best):
    """Parabolic refinement of the integer NCC peak along each axis (pixels, +x east, +y south)."""
    out = []
    for axis in (0, 1):
        lo = list(best); hi = list(best)
        lo[axis] -= 1; hi[axis] += 1
        if tuple(lo) not in scores or tuple(hi) not in scores:
            out.append(float(best[axis]))
            continue
        a, b, c = scores[tuple(lo)], scores[tuple(best)], scores[tuple(hi)]
        den = a - 2 * b + c
        out.append(float(best[axis]) + (0.5 * (a - c) / den if den < 0 else 0.0))
    return [round(v, 2) for v in out]


def texture_correspondence(texture_path, win, ndsm):
    """Normalised cross-correlation of gradient magnitudes: texture luminance vs nDSM.

    Building and tree edges appear in both the orthophoto and MDS - MDT. If texture and elevation
    share the lattice, the correlation peaks at shift (0, 0). Mirrored nDSM grids are controls and
    must correlate far less. Relief displacement of a conventional (not true-ortho) photo moves roof
    edges away from footprints, so the peak is broad; the result is reported, not tuned.
    """
    import numpy as np
    import rasterio

    with rasterio.open(texture_path) as src:
        rgb = src.read().astype("float64")
    lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
    A = gradient_magnitude(lum[win["row0"]:win["row1"], win["col0"]:win["col1"]])
    B = gradient_magnitude(ndsm.astype("float64"))
    scores = shift_scores(A, B)
    best = max(scores, key=scores.get)
    m = SHIFT_RANGE_PX + 2
    controls = {
        "ndsm_flipped_east_west": ncc(A[m:-m, m:-m], B[:, ::-1][m:-m, m:-m]),
        "ndsm_flipped_north_south": ncc(A[m:-m, m:-m], B[::-1, :][m:-m, m:-m]),
    }
    return {
        "method": "NCC of gradient magnitude (texture luminance vs MDS - MDT) over integer shifts; +dx = elevation sampled 1 px east, +dy = 1 px south",
        "shift_range_px": SHIFT_RANGE_PX,
        "best_shift_px": list(best), "subpixel_peak_px": subpixel_peak(scores, best),
        "best_ncc": round(scores[best], 4), "ncc_at_zero": round(scores[(0, 0)], 4),
        "ncc_at_1px": {k: round(scores[v], 4) for k, v in {"east": (1, 0), "west": (-1, 0), "south": (0, 1), "north": (0, -1)}.items()},
        "ncc_at_3px_mean": round(float(np.mean([scores[(3, 0)], scores[(-3, 0)], scores[(0, 3)], scores[(0, -3)]])), 4),
        "mirror_controls": {k: round(v, 4) for k, v in controls.items()},
        "criterion": "best shift within 1 px of (0, 0) and NCC at (0, 0) more than twice every mirrored control",
        "pass": bool(max(abs(best[0]), abs(best[1])) <= 1 and scores[(0, 0)] > 2 * max(abs(v) for v in controls.values())),
    }


def main(argv=None):
    import numpy as np
    import rasterio

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--package", required=True)
    ap.add_argument("--mds", required=True)
    ap.add_argument("--mdt", required=True)
    ap.add_argument("--points", required=True)
    ap.add_argument("--texture", default="2023", help="coverage id of the texture the geometry is prepared for")
    ap.add_argument("--out", required=True)
    ap.add_argument("--margin-m", type=float, default=2.0)
    ap.add_argument("--retrieved-on", default="2026-11-24", help="date a person downloaded the sheets from CNIG")
    a = ap.parse_args(argv)

    t_start = time.perf_counter()
    pkg_dir = pathlib.Path(a.package).resolve()
    out = pathlib.Path(a.out).resolve()
    if REPO in out.parents or out == REPO:
        raise SystemExit("REFUSED: write geometry outside the repository (no rasters in git history)")
    if pkg_dir in out.parents or out == pkg_dir:
        raise SystemExit("REFUSED: the output must be outside the texture package (the package is read-only)")
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"REFUSED: {out} is not empty")

    rec, sp, rec_sha = load_package(pkg_dir)
    tex = frame_for(rec, a.texture)

    # 1. pair checks (pilot code) ---------------------------------------------------------------
    metas = {"mds": run_pilot.inspect_raster(a.mds), "mdt": run_pilot.inspect_raster(a.mdt)}
    problems = core.metadata_problems(metas["mds"], metas["mdt"], run_pilot.CELL_M)
    if tuple(metas["mds"]["bounds"]) != tuple(metas["mdt"]["bounds"]):
        problems.append("MDS and MDT sheet bounds differ")
    problems += core.grid_problems(metas["mds"]["transform"], metas["mdt"]["transform"],
                                   (metas["mds"]["height"], metas["mds"]["width"]), (metas["mdt"]["height"], metas["mdt"]["width"]))
    if problems:
        raise SystemExit("REFUSED: " + "; ".join(problems))

    # 2. window ---------------------------------------------------------------------------------
    win = choose_window(sp, metas["mds"]["bounds"], a.margin_m)
    rows, cols = win["row1"] - win["row0"], win["col1"] - win["col0"]

    # 3. reprojection -----------------------------------------------------------------------------
    t0 = time.perf_counter()
    mds, dst_t = reproject_to_window(a.mds, sp, win)
    mdt, _ = reproject_to_window(a.mdt, sp, win)
    t_reproject = time.perf_counter() - t0
    nodata_cells = {"mds": int((~np.isfinite(mds)).sum()), "mdt": int((~np.isfinite(mdt)).sum())}
    if any(nodata_cells.values()):
        raise SystemExit(f"REFUSED: NoData inside the window {nodata_cells}; no elevation is invented")

    # 4. validation -------------------------------------------------------------------------------
    lo, hi = ELEVATION_PLAUSIBLE_M
    anomalies = {k: int(((g < lo) | (g > hi)).sum()) for k, g in (("mds", mds), ("mdt", mdt))}
    ndsm = (mds.astype("float64") - mdt.astype("float64")).astype("float32")
    neg = int((ndsm < NDSM_NEGATIVE_TOLERANCE_M).sum())
    thresholds = {f">={t}m": round(float((ndsm >= t).mean()), 4) for t in (0.5, 2.0, 5.0, 10.0, 20.0, 40.0)}
    points = json.loads(pathlib.Path(a.points).read_text("utf8"))
    probes = point_checks(points["points"], sp, win, {"mds": mds, "mdt": mdt}, {"mds": a.mds, "mdt": a.mdt})
    corr = texture_correspondence(pkg_dir / tex["file"], win, ndsm)
    base_m = float(round(float(np.median(mdt)), 1))

    # 5. write ------------------------------------------------------------------------------------
    out.mkdir(parents=True, exist_ok=True)
    files = {}
    for key, g in (("mds", mds), ("mdt", mdt)):
        name = f"surface_{key}.f32"
        data = np.ascontiguousarray(g, dtype="<f4").tobytes()
        (out / name).write_bytes(data)
        files[key] = {"file": name, "sha256": sha256_bytes(data), "bytes": len(data), "dtype": "float32 little-endian",
                      "shape_rows_cols": [rows, cols], "order": "row-major, row 0 = north, column 0 = west",
                      "stats_m": stats(g), "nodata_cells": 0, "anomalous_cells_outside_plausible_range": anomalies[key]}
    minE, minN, maxE, maxN = sp["bbox"]
    win_bbox = [minE + win["col0"] * win["px"], maxN - win["row1"] * win["py"], minE + win["col1"] * win["px"], maxN - win["row0"] * win["py"]]
    checks = {
        "pair_crs_cell_lattice": {"pass": True, "note": "metadata_problems / grid_problems (pilot code) found no problem"},
        "window_inside_sheet_with_margin": {"pass": True, "margin_m": a.margin_m},
        "no_nodata_in_window": {"pass": True, "cells": nodata_cells},
        "elevation_plausible": {"range_m": [lo, hi], "anomalous_cells": anomalies, "pass": not any(anomalies.values())},
        "ndsm_negative_share": {"tolerance_m": NDSM_NEGATIVE_TOLERANCE_M, "cells_below": neg, "share": round(neg / ndsm.size, 6),
                                "pass": neg / ndsm.size <= 0.01},
        "point_fidelity_to_source": {"points": len(probes), "pass": len(probes) >= 5 and all(p["pass"] for p in probes)},
        "texture_elevation_correspondence": {"pass": corr["pass"]},
    }
    status = "PASS" if all(c["pass"] for c in checks.values()) else "FAIL"
    manifest = {
        "schema": GEOMETRY_SCHEMA,
        "id": f"madrid-rio-lidar2024-on-{a.texture}-v1",
        "version": "1.0.0",
        "status": status,
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "tool": {**TOOL, "script": "research/geospatial_cinematic/geometry/materialize_geometry.py",
                 "python": platform.python_version(), "numpy": np.__version__, "rasterio": rasterio.__version__,
                 "gdal": rasterio.__gdal_version__},
        "sources": {k: {**SOURCES[k], "file": metas[k]["file"], "sha256": metas[k]["sha256"], "bytes": metas[k]["bytes"],
                        "declared_epsg": metas[k]["epsg"], "crs_equivalent_to_epsg_25830": metas[k]["crs_equivalent_to_25830"],
                        "grid": {"width": metas[k]["width"], "height": metas[k]["height"], "cell_m": metas[k]["res"],
                                 "bounds_epsg25830": metas[k]["bounds"], "nodata": metas[k]["nodata"], "dtype": metas[k]["dtype"],
                                 "area_or_point": metas[k]["tags"].get("AREA_OR_POINT")},
                        "sheet": "0559-4-5 (MTN50 0559, 1:5 000 sheet)",
                        "retrieved_on": a.retrieved_on, "retrieved_by": "a person, CNIG Centro de Descargas (reCAPTCHA; never automated)"}
                    for k in ("mds", "mdt")},
        "acquisition": ACQUISITION,
        "publication": PUBLICATION,
        "licence": LICENCE,
        "vertical": VERTICAL,
        "declared_accuracy": DECLARED_ACCURACY,
        "texture_package": {
            "path": str(pkg_dir), "materialized_manifest_sha256": rec_sha, "crs": sp["crs"], "bbox": sp["bbox"],
            "pixels": [sp["width"], sp["height"]],
            "prepared_for_coverage": {"coverage_id": tex["coverage_id"], "product": tex["product"], "date": tex["date"], "sha256": tex["sha256"]},
        },
        "grid": {
            "crs": DST_CRS,
            "lattice": "the texture package's own pixel lattice: one elevation value per texture pixel",
            "window_texture_pixels": {"col0": win["col0"], "col1": win["col1"], "row0": win["row0"], "row1": win["row1"]},
            "rows": rows, "cols": cols,
            "bbox_epsg3857": win_bbox,
            "pixel_size_mercator_units": [win["px"], win["py"]],
            "gdal_geotransform": list(dst_t)[:6],
            "value_location": "pixel-area mean: each value is the mean source elevation over one texture pixel footprint",
            "covered_share_of_texture_pixels": round(win["covered_cell_fraction_of_texture"], 4),
            "window_share_of_texture_pixels": round(rows * cols / (sp["width"] * sp["height"]), 4),
            "uncovered": "texture pixels outside sheet 0559-4-5 (its south edge is 4 471 860 m N, EPSG:25830) have no elevation in this package",
        },
        "transformations": [
            f"{SRC_CRS} (the MDS declares EPSG:3042; equivalence verified numerically by the pilot code) -> {DST_CRS} with PROJ via GDAL warp; "
            "the UTM grid is rotated about 0.47 degrees from the Web Mercator grid here (meridian convergence) and the warp accounts for it",
            "no vertical transformation: heights stay orthometric (EGM08) metres",
        ],
        "resampling": {
            "algorithm": "GDAL warp 'average' (rasterio.warp.reproject, Resampling.average)",
            "source_resolution_m": 0.5,
            "output_resolution": f"{win['px']:.4f} x {win['py']:.4f} EPSG:3857 units (about 1.82 m on the ground at the centre)",
            "consequences": "about 13 source cells per output cell; edges of roofs, trees and walls become ramps about one output cell wide; "
                            "narrow features (< ~2 m: poles, thin walls, single small trees) are smoothed or lost; area means are kept",
        },
        "files": files,
        "vertical_base_m": base_m,
        "vertical_base_rule": "median MDT of the window rounded to 0.1 m; the renderer puts z = 0 at this orthometric height",
        "mesh_counts_at_full_lattice": {"vertices": rows * cols, "triangles": 2 * (rows - 1) * (cols - 1)},
        "ndsm": {"definition": "MDS - MDT on the output lattice (both resampled identically)", "stats_m": stats(ndsm),
                 "share_at_or_above": thresholds, "cells_below_negative_tolerance": neg,
                 "interpretation_limit": "height of the interpolated surface above interpolated ground: buildings, trees, bridges, vehicles, "
                                         "other structures and classification artefacts alike; NOT building height; v1 classification is provisional"},
        "validation": {"checks": checks, "points": probes, "texture_correspondence": corr},
        "temporal_compatibility": {
            "geometry_date": ACQUISITION["label"],
            "texture_date": tex["date"]["label"],
            "texture_flight": "PNOA 2023 Madrid flight 2023-07-28 to 2023-08-04 (pnoa.ign.es 'Estado del proyecto', read 2026-11-26); "
                              "the per-pixel acquisition date of the WMS mosaic is not published",
            "gap": "about 7 to 10 months (2023-08-04 -> 2024-03 at least; 2023-07-28 -> 2024-05 at most); 1 year between published years",
            "rule": "the renderer refuses this geometry under a texture whose published years are more than max_gap_years from 2024, "
                    "unless the shot carries an explicit methodological warning",
        },
        "limitations": [
            "Provisional v1 models interpolated from automatically classified NPC01; v2 is not published for Madrid.",
            "A surface derived from elevation, not an architectural model: no building objects, no facades, no roofs as entities.",
            "Water surfaces have sparse LiDAR returns; the Manzanares channel is interpolated.",
            "The 2023 texture is a conventional orthophoto, not a true orthophoto: tall buildings lean in it, so roof texture can fall on walls or streets of the surface.",
            "Only the part of the Gate 4B extent inside sheet 0559-4-5 has elevation; the southern strip is uncovered (adjacent sheet not downloaded).",
            "Point checks show fidelity to the source raster, not real-world accuracy; no field measurement exists.",
        ],
        "resources": {"materialize_seconds": round(time.perf_counter() - t_start, 1), "reproject_seconds": round(t_reproject, 1),
                      "grid_bytes_total": sum(f["bytes"] for f in files.values())},
    }
    (out / "geometry-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf8", newline="\n")
    names = sorted(["geometry-manifest.json", *(f["file"] for f in files.values())])
    (out / "checksums.sha256").write_text("".join(f"{sha256_bytes((out / n).read_bytes())}  {n}\n" for n in names), encoding="utf8", newline="\n")
    print(json.dumps({"status": status, "out": str(out), "window": manifest["grid"]["window_texture_pixels"],
                      "checks": {k: v["pass"] for k, v in checks.items()}, "texture_correspondence": corr,
                      "seconds": manifest["resources"]["materialize_seconds"]}, indent=2))
    return 0 if status == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
