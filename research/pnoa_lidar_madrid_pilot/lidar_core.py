"""Pure-numpy primitives for the PNOA-LiDAR pilot (no raster I/O, no network).

Everything whose silent failure would make a reported number wrong lives here so
it can be unit-tested on small arrays. The functions deliberately refuse to name
what a height difference *is*: MDS - MDT is a height of the first-return
surface above the interpolated ground surface, not "building height".
"""

from __future__ import annotations

import hashlib
import math
import os

# Declared product accuracy (IGN, tercera cobertura, especificaciones tecnicas):
# RMSE Z of each 0.5 m model <= 0.15 m. Used ONLY to size a noise tolerance, never
# to claim a measured accuracy.
DECLARED_RMSE_Z_MDE_M = 0.15
# If the two model errors were independent and unbiased, the difference would
# carry sqrt(2) * 0.15 m of noise. That independence is an assumption, not a
# finding: both models come from the same point cloud.
NOISE_FLOOR_M = round(math.sqrt(2.0) * DECLARED_RMSE_Z_MDE_M, 3)
# Tolerance below which a negative difference is called a defect, not noise.
NEGATIVE_TOLERANCE_M = -0.5


# Attribution required by the IGN licence for a work derived from these products.
# Strings copied 2026-11-24 from the official product table
# (http://www.scne.es/tablaProductos.php): identifier, date, "CC-BY 4.0", producer.
ATTRIBUTION = (
    "Obra derivada de MDS50cm-cob3 2022-2025 CC-BY 4.0 scne.es "
    "y de MDT50cm-cob3 2022-2025 CC-BY 4.0 scne.es"
)


def metadata_problems(mds, mdt, cell_m=0.5):
    """Reasons the two rasters' file-level metadata cannot be combined (empty = compatible).

    Checked BEFORE any pixel is read, because AOI coordinates are EPSG:25830 and
    reading a raster in another CRS with them would be meaningless.
    """
    out = []
    for name, m in (("MDS", mds), ("MDT", mdt)):
        if not m.get("crs_equivalent_to_25830"):
            out.append(f"{name}: CRS missing or not equivalent to EPSG:25830 (declared EPSG code: {m.get('epsg')})")
        if any(abs(r - cell_m) > 1e-9 for r in m["res"]):
            out.append(f"{name}: cell size {m['res']} is not {cell_m} m")
        t = m["transform"]
        if abs(t[1]) > 0 or abs(t[3]) > 0:
            out.append(f"{name}: rotated or sheared geotransform")
    return out


def grid_problems(t_mds, t_mdt, shape_mds, shape_mdt, tol=1e-6):
    """Reasons the two AOI windows are not the same cell lattice (empty = identical)."""
    out = []
    if tuple(shape_mds) != tuple(shape_mdt):
        out.append(f"AOI window shapes differ: MDS {tuple(shape_mds)} vs MDT {tuple(shape_mdt)}")
    if any(abs(a - b) > tol for a, b in zip(list(t_mds)[:6], list(t_mdt)[:6])):
        out.append("AOI window geotransforms differ: the grids are not cell-for-cell aligned")
    return out


def isolate_proj_environment():
    """Drop PROJ/GDAL data-path variables inherited from another installation.

    The rasterio and pyproj wheels bundle a matching PROJ database. A machine-wide
    PROJ_LIB (for example PostgreSQL/PostGIS) points at an incompatible proj.db and
    makes every EPSG lookup fail. Must run BEFORE rasterio or pyproj is imported.
    """
    for var in ("PROJ_LIB", "PROJ_DATA", "GDAL_DATA"):
        os.environ.pop(var, None)


def sha256_file(path, chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(chunk)
            if not block:
                return h.hexdigest()
            h.update(block)


def valid_mask(arr, nodata):
    """True where a cell is a usable measurement (finite and not the NoData value)."""
    import numpy as np

    ok = np.isfinite(arr)
    if nodata is not None and not (isinstance(nodata, float) and math.isnan(nodata)):
        ok &= arr != nodata
    return ok


def normalised_surface(mds, mdt, mds_nodata, mdt_nodata):
    """MDS - MDT as float32, NaN wherever either input is not a measurement.

    Raises ValueError on shape mismatch: two grids that are not cell-for-cell
    identical must be resampled explicitly, never silently subtracted.
    """
    import numpy as np

    if mds.shape != mdt.shape:
        raise ValueError(f"grid shape mismatch: MDS {mds.shape} vs MDT {mdt.shape}")
    ok = valid_mask(mds, mds_nodata) & valid_mask(mdt, mdt_nodata)
    out = np.full(mds.shape, np.nan, dtype="float32")
    out[ok] = (mds[ok].astype("float64") - mdt[ok].astype("float64")).astype("float32")
    return out


def height_summary(ndsm, inside, cell_area_m2, thresholds=(0.5, 2.0, 3.0, 6.0, 12.0, 20.0)):
    """Descriptive statistics of a normalised surface inside a boolean mask.

    The denominator of every share is stated: ``cells_valid`` (cells inside the
    geometry with a usable MDS and MDT value). ``cells_total`` and
    ``valid_fraction`` expose how much of the geometry the statistic describes.
    """
    import numpy as np

    total = int(inside.sum())
    vals = ndsm[inside & np.isfinite(ndsm)]
    n = int(vals.size)
    out = {
        "cells_total": total,
        "cells_valid": n,
        "valid_fraction": (n / total) if total else None,
        "area_total_m2": total * cell_area_m2,
        "area_valid_m2": n * cell_area_m2,
    }
    if n == 0:
        return out
    q = np.percentile(vals, [1, 5, 25, 50, 75, 90, 95, 99])
    out.update(
        {
            "min": float(vals.min()),
            "max": float(vals.max()),
            "mean": float(vals.mean()),
            "std": float(vals.std(ddof=0)),
            "p01": float(q[0]), "p05": float(q[1]), "p25": float(q[2]), "p50": float(q[3]),
            "p75": float(q[4]), "p90": float(q[5]), "p95": float(q[6]), "p99": float(q[7]),
            "share_below_negative_tolerance": float((vals < NEGATIVE_TOLERANCE_M).mean()),
            "share_at_or_above": {f"{t:g}m": float((vals >= t).mean()) for t in thresholds},
        }
    )
    return out


def circle_mask(shape, transform_origin, cell_size, centre_xy, radius_m):
    """Boolean mask of cell CENTRES within ``radius_m`` of ``centre_xy``.

    ``transform_origin`` is the (x, y) of the top-left corner of the array; rows
    run south (y decreases), columns run east.
    """
    import numpy as np

    rows, cols = shape
    x0, y0 = transform_origin
    xs = x0 + (np.arange(cols) + 0.5) * cell_size
    ys = y0 - (np.arange(rows) + 0.5) * cell_size
    dx = xs[None, :] - centre_xy[0]
    dy = ys[:, None] - centre_xy[1]
    return (dx * dx + dy * dy) <= radius_m * radius_m


def evaluate_criteria(checks):
    """Fold named boolean checks into PASS / FAIL with the failing names listed."""
    failed = sorted(k for k, v in checks.items() if not v)
    return {"verdict": "PASS" if not failed else "FAIL", "failed": failed, "checks": dict(checks)}
