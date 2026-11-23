"""PNOA-LiDAR (3a cobertura) MDS50cm - MDT50cm pilot for one Madrid barrio.

    python research/pnoa_lidar_madrid_pilot/run_pilot.py \
        --mds <MDS50CM-...-0559-4-5-COB3-V1.tif> --mdt <MDT50CM-...-0559-4-5-COB3-V1.tif>

Reads two official COG sheets that a person downloaded from the CNIG Centro de
Descargas (the download is behind a reCAPTCHA; this script never fetches it),
checks that they are a coherent pair, computes MDS - MDT inside the official
Embajadores barrio polygon (the area known as Lavapies) and writes a report and
one figure. It writes nothing outside --out and never touches data/ or the app.

Exit code 0 when every acceptance criterion passes, 2 when any fails, 1 on
unusable input. A FAIL is a result, not an error: the report is still written.
"""

from __future__ import annotations

import argparse
import json
import math
import pathlib
import platform
import sys

import lidar_core as core

core.isolate_proj_environment()  # before rasterio/pyproj are imported

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[1]
GEOGRAPHY = REPO / "data" / "geography" / "madrid_admin.geojson"
PILOT_BARRIO_ID = "012"  # Embajadores (Centro): contains Lavapies
CRS_WGS84, CRS_ETRS89_UTM30 = 4326, 25830
CELL_M = 0.5

# Acceptance criteria. Written before any real sheet had been opened (the data
# were not on disk when this file was authored); no independent timestamp exists,
# so they are documented, not pre-registered.
AOI_MIN_VALID_FRACTION = 0.95
MDT_MEDIAN_PLAUSIBLE_M = (550.0, 750.0)  # Madrid centre sits ~600-700 m a.s.l.
MAX_SHARE_BELOW_NEGATIVE_TOLERANCE = 0.01

# Illustrative Lens-style circle, chosen here by the pilot author (Plaza de
# Lavapies, approximate). It is NOT a Lens object and not read from the app.
DEMO_CIRCLE_LONLAT = (-3.7010, 40.4086)
DEMO_CIRCLE_RADIUS_M = 250.0


def _require():
    try:
        import numpy  # noqa: F401
        import rasterio  # noqa: F401
        from pyproj import Transformer  # noqa: F401
        from shapely.geometry import shape  # noqa: F401
    except ImportError as exc:  # pragma: no cover - environment guard
        sys.exit(f"missing dependency ({exc.name}); pip install -r {HERE / 'requirements.txt'}")


def crs_equivalent_to_25830(path):
    """True if the file's declared CRS maps a test point onto EPSG:25830 within 1 mm.

    Real CNIG v1 sheets declare EPSG:3042 (MDT) or an un-coded WKT (MDS) for the
    same ETRS89 / UTM 30N projection; comparing integer EPSG codes would fail on a
    labelling difference, so equivalence is tested numerically.
    """
    import rasterio
    from pyproj import CRS, Transformer

    with rasterio.open(path) as src:
        if not src.crs:
            return False
        tr = Transformer.from_crs(CRS.from_wkt(src.crs.to_wkt()), CRS_ETRS89_UTM30, always_xy=True)
    x, y = tr.transform(440000.0, 4474000.0)
    return abs(x - 440000.0) < 1e-3 and abs(y - 4474000.0) < 1e-3


def inspect_raster(path):
    import rasterio

    with rasterio.open(path) as src:
        return {
            "file": pathlib.Path(path).name,
            "bytes": pathlib.Path(path).stat().st_size,
            "sha256": core.sha256_file(path),
            "driver": src.driver,
            "epsg": src.crs.to_epsg() if src.crs else None,
            "crs_equivalent_to_25830": crs_equivalent_to_25830(path),
            "crs_wkt_name": src.crs.to_dict().get("proj") if src.crs else None,
            "width": src.width,
            "height": src.height,
            "bands": src.count,
            "dtype": src.dtypes[0],
            "nodata": src.nodata,
            "res": [abs(src.res[0]), abs(src.res[1])],
            "bounds": list(src.bounds),
            "transform": list(src.transform)[:6],
            "tiled": bool(src.profile.get("tiled")),
            "compression": src.compression.value if src.compression else None,
            "overviews": src.overviews(1),
            "tags": src.tags(),
            "band_tags": src.tags(1),
            "units": src.units[0],
            "descriptions": list(src.descriptions),
        }


def aoi_polygon_25830():
    from pyproj import Transformer
    from shapely.geometry import shape
    from shapely.ops import transform

    gj = json.loads(GEOGRAPHY.read_text(encoding="utf-8"))
    feat = next(
        f for f in gj["features"]
        if f["properties"]["geography_level"] == "barrio" and f["properties"]["official_id"] == PILOT_BARRIO_ID
    )
    tr = Transformer.from_crs(CRS_WGS84, CRS_ETRS89_UTM30, always_xy=True)
    return feat["properties"], transform(tr.transform, shape(feat["geometry"]))


def read_window(path, poly):
    """Read the whole-pixel window covering ``poly``; return (masked array, transform)."""
    import rasterio
    from rasterio.windows import Window

    with rasterio.open(path) as src:
        minx, miny, maxx, maxy = poly.bounds
        r0, c0 = src.index(minx, maxy, op=math.floor)
        r1, c1 = src.index(maxx, miny, op=math.ceil)
        if r0 < 0 or c0 < 0 or r1 > src.height or c1 > src.width:
            raise ValueError(f"{pathlib.Path(path).name} does not fully cover the AOI window")
        win = Window(c0, r0, c1 - c0, r1 - r0)
        arr = src.read(1, window=win)
        return arr, src.window_transform(win), src.nodata


def run(args):
    import numpy as np
    import rasterio
    from pyproj import Transformer
    from rasterio.features import geometry_mask

    meta_mds, meta_mdt = inspect_raster(args.mds), inspect_raster(args.mdt)
    props, poly = aoi_polygon_25830()
    mds, t_mds, nd_mds = read_window(args.mds, poly)
    mdt, t_mdt, nd_mdt = read_window(args.mdt, poly)

    same_grid = (
        mds.shape == mdt.shape
        and all(abs(a - b) < 1e-6 for a, b in zip(list(t_mds)[:6], list(t_mdt)[:6]))
    )
    ndsm = core.normalised_surface(mds, mdt, nd_mds, nd_mdt) if mds.shape == mdt.shape else None
    report = {
        "pilot": "pnoa_lidar_madrid_pilot",
        "aoi": {"barrio": props["official_name"], "official_id": props["official_id"],
                "parent": props["parent_name"], "area_km2": poly.area / 1e6, "epsg": CRS_ETRS89_UTM30},
        "inputs": {"mds": meta_mds, "mdt": meta_mdt, "retrieved_on": args.retrieved_on},
        "environment": {"python": platform.python_version(), "numpy": np.__version__,
                        "rasterio": rasterio.__version__, "gdal": rasterio.__gdal_version__},
        "noise_floor_m_if_independent": core.NOISE_FLOOR_M,
        "interpretation_limit": (
            "MDS - MDT is the height of the first-return surface above the interpolated ground "
            "surface. It is not building height: vegetation, vehicles, awnings, scaffolding and "
            "NPC01 misclassification are all included. Provisional v1 models (NPC01)."
        ),
    }

    inside = geometry_mask([poly], out_shape=mds.shape, transform=t_mds, invert=True)
    checks = {
        "both_crs_equivalent_to_epsg_25830": meta_mds["crs_equivalent_to_25830"] and meta_mdt["crs_equivalent_to_25830"],
        "both_cell_0_5m": all(abs(r - CELL_M) < 1e-9 for r in meta_mds["res"] + meta_mdt["res"]),
        "grids_identical_in_aoi": bool(same_grid),
    }
    if ndsm is not None:
        aoi = core.height_summary(ndsm, inside, CELL_M * CELL_M)
        mdt_valid = mdt[inside & core.valid_mask(mdt, nd_mdt)]
        mds_valid = mds[inside & core.valid_mask(mds, nd_mds)]
        report["aoi_summary"] = aoi
        report["mdt_in_aoi"] = {"median": float(np.median(mdt_valid)), "min": float(mdt_valid.min()),
                                "max": float(mdt_valid.max()), "cells_nodata": int((inside & ~core.valid_mask(mdt, nd_mdt)).sum())}
        report["mds_in_aoi"] = {"median": float(np.median(mds_valid)), "min": float(mds_valid.min()),
                                "max": float(mds_valid.max()), "cells_nodata": int((inside & ~core.valid_mask(mds, nd_mds)).sum())}
        checks["aoi_valid_fraction_ge_0_95"] = (aoi["valid_fraction"] or 0) >= AOI_MIN_VALID_FRACTION
        lo, hi = MDT_MEDIAN_PLAUSIBLE_M
        checks["mdt_median_plausible_for_madrid"] = lo <= report["mdt_in_aoi"]["median"] <= hi
        checks["negative_share_le_1pct"] = (aoi["share_below_negative_tolerance"]
                                            <= MAX_SHARE_BELOW_NEGATIVE_TOLERANCE)

        tr = Transformer.from_crs(CRS_WGS84, CRS_ETRS89_UTM30, always_xy=True)
        centre = tr.transform(*DEMO_CIRCLE_LONLAT)
        circ = core.circle_mask(ndsm.shape, (t_mds.c, t_mds.f), CELL_M, centre, DEMO_CIRCLE_RADIUS_M)
        report["demo_circle"] = {
            "note": "illustrative geometry chosen by the pilot author; not a Lens object",
            "centre_lonlat": list(DEMO_CIRCLE_LONLAT), "radius_m": DEMO_CIRCLE_RADIUS_M,
            "clipped_by_window": bool(circ[0].any() or circ[-1].any() or circ[:, 0].any() or circ[:, -1].any()),
            "summary": core.height_summary(ndsm, circ, CELL_M * CELL_M),
        }
        _figure(ndsm, inside, args.out / "figure_mds_minus_mdt.png")
    report["acceptance"] = core.evaluate_criteria(checks)

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "pilot_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"acceptance: {report['acceptance']['verdict']} {report['acceptance']['failed']}")
    return 0 if report["acceptance"]["verdict"] == "PASS" else 2


def _figure(ndsm, inside, path):
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import numpy as np
    except ImportError:
        print("matplotlib not installed: figure skipped")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    show = np.where(inside, ndsm, np.nan)[::2, ::2]
    fig, ax = plt.subplots(figsize=(9, 6), dpi=110)
    im = ax.imshow(show, cmap="viridis", vmin=0, vmax=30, interpolation="nearest")
    ax.set_axis_off()
    fig.colorbar(im, ax=ax, shrink=0.7, label="MDS - MDT (m), clipped to 0-30")
    ax.set_title("PNOA-LiDAR 3a cobertura v1 (NPC01), Embajadores: MDS - MDT\n"
                 "height above interpolated ground, NOT building height; 1 px = 1 m (2x2 cells subsampled)",
                 fontsize=8)
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--mds", required=True, type=pathlib.Path)
    p.add_argument("--mdt", required=True, type=pathlib.Path)
    p.add_argument("--out", type=pathlib.Path, default=HERE / "results")
    p.add_argument("--retrieved-on", default=None, help="ISO date the sheets were downloaded (provenance only)")
    args = p.parse_args(argv)
    _require()
    for f in (args.mds, args.mdt):
        if not f.is_file():
            print(f"input not found: {f}", file=sys.stderr)
            return 1
    try:
        return run(args)
    except ValueError as exc:
        print(f"unusable input: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
