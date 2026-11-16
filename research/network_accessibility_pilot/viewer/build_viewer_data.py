#!/usr/bin/env python3
"""Build-time data preparation for the Madrid Network Accessibility Explorer (V0.1).

This script is a BUILD STEP, not an application dependency. The viewer itself is
static HTML/CSS/JS and never calls Python. Re-run this only if the committed
pilot results change.

It produces exactly two derived artifacts plus a manifest:

  data/portal_coordinates.csv  cod_ndp,lon,lat - OFFICIAL coordinates only.
                               Transformed from the x_25830 / y_25830 columns the
                               pilot CSV already publishes (EPSG:25830 -> EPSG:4326).
                               It deliberately carries NO measured attribute, so it
                               contains nothing derived from OpenStreetMap. The
                               browser joins it to origin_facility_distances.csv on
                               cod_ndp.
  data/study_barrio.geojson    The single official San Isidro (barrio 113) polygon,
                               extracted unmodified from
                               data/geography/madrid_admin.geojson.
  data/build_manifest.json     Record counts, bounds and transformation residuals,
                               so the viewer integrity checks have a baseline.

Why not a full origins GeoJSON: the pilot deliberately stopped exporting one
(results/pilot_report.json -> exports.note) because it duplicated the CSV and
mixed OSM-derived measurements into a geometry file. We do not reintroduce that.
"""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

from pyproj import CRS, Transformer

VIEWER_DIR = Path(__file__).resolve().parent
PILOT_DIR = VIEWER_DIR.parent
REPO_ROOT = PILOT_DIR.parent.parent

DISTANCES_CSV = PILOT_DIR / "results" / "origin_facility_distances.csv"
FACILITIES_GEOJSON = PILOT_DIR / "results" / "facility_access_points.geojson"
REPORT_JSON = PILOT_DIR / "results" / "pilot_report.json"
ADMIN_GEOJSON = REPO_ROOT / "data" / "geography" / "madrid_admin.geojson"

OUT_DIR = VIEWER_DIR / "data"
OUT_PORTALS = OUT_DIR / "portal_coordinates.csv"
OUT_BARRIO = OUT_DIR / "study_barrio.geojson"
OUT_MANIFEST = OUT_DIR / "build_manifest.json"

STUDY_BARRIO_ID = "113"

# Same CRS pair and the same always_xy convention pilot_common.py uses; only the
# direction is reversed, because Leaflet needs geographic coordinates.
METRIC_CRS = "EPSG:25830"
GEOGRAPHIC_CRS = "EPSG:4326"

# Madrid must land inside this envelope; anything outside means a broken transform.
SANITY_LON = (-3.90, -3.50)
SANITY_LAT = (40.30, 40.65)

# 7 decimal places is ~1.1 cm of latitude: finer than the callejero's own
# centimetre precision, so the rounding cannot be the dominant error term.
COORD_DECIMALS = 7

# Two separate tolerances, because a single round-trip number would conflate two
# unrelated error sources and hide whichever one actually moved.
#
# 1. The TRANSFORM itself, measured on unrounded output. pyproj round-trips a
#    projected coordinate to near floating-point exactness, so anything above a
#    micrometre means the CRS pair or the axis order is wrong.
TRANSFORM_TOLERANCE_M = 1e-6
# 2. The QUANTISATION deliberately introduced by rounding the output to
#    COORD_DECIMALS. At latitude ~40.4 deg, 1e-7 deg is ~1.11 cm of latitude and
#    ~0.85 cm of longitude, so half-grid displacement is bounded at ~0.56 cm.
#    1 cm leaves headroom without admitting a real error.
QUANTISATION_TOLERANCE_M = 0.01


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    for required in (DISTANCES_CSV, FACILITIES_GEOJSON, REPORT_JSON, ADMIN_GEOJSON):
        if not required.exists():
            raise SystemExit(f"missing authoritative input: {required}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    with DISTANCES_CSV.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))

    if not rows:
        raise SystemExit("origin_facility_distances.csv has no rows")

    forward = Transformer.from_crs(CRS(METRIC_CRS), CRS(GEOGRAPHIC_CRS), always_xy=True)
    inverse = Transformer.from_crs(CRS(GEOGRAPHIC_CRS), CRS(METRIC_CRS), always_xy=True)

    seen: set[str] = set()
    out_rows: list[tuple[str, str, str]] = []
    worst_transform_residual = 0.0
    worst_quantisation_residual = 0.0
    lons: list[float] = []
    lats: list[float] = []

    for row in rows:
        cod_ndp = row["cod_ndp"].strip()
        if not cod_ndp:
            raise SystemExit("a row has an empty cod_ndp; the browser join needs a key")
        if cod_ndp in seen:
            raise SystemExit(f"duplicate cod_ndp {cod_ndp}; the browser join must be 1:1")
        seen.add(cod_ndp)

        x = float(row["x_25830"])
        y = float(row["y_25830"])
        lon, lat = forward.transform(x, y)

        if not (
            SANITY_LON[0] <= lon <= SANITY_LON[1]
            and SANITY_LAT[0] <= lat <= SANITY_LAT[1]
        ):
            raise SystemExit(f"cod_ndp {cod_ndp} transformed outside Madrid: {lon}, {lat}")

        # Check 1: the transform alone, on unrounded output.
        x_exact, y_exact = inverse.transform(lon, lat)
        worst_transform_residual = max(
            worst_transform_residual, abs(x_exact - x), abs(y_exact - y)
        )

        # Check 2: the rounded output, which is what the viewer actually reads.
        # The excess over check 1 is the quantisation the rounding introduces.
        lon_r = round(lon, COORD_DECIMALS)
        lat_r = round(lat, COORD_DECIMALS)
        x_back, y_back = inverse.transform(lon_r, lat_r)
        worst_quantisation_residual = max(
            worst_quantisation_residual, abs(x_back - x), abs(y_back - y)
        )

        lons.append(lon_r)
        lats.append(lat_r)
        out_rows.append((cod_ndp, f"{lon_r:.7f}", f"{lat_r:.7f}"))

    if worst_transform_residual > TRANSFORM_TOLERANCE_M:
        raise SystemExit(
            f"transform round-trip residual {worst_transform_residual:.9f} m exceeds "
            f"{TRANSFORM_TOLERANCE_M} m tolerance: check the CRS pair and axis order"
        )
    if worst_quantisation_residual > QUANTISATION_TOLERANCE_M:
        raise SystemExit(
            f"quantisation residual {worst_quantisation_residual:.6f} m exceeds "
            f"{QUANTISATION_TOLERANCE_M} m tolerance: raise COORD_DECIMALS"
        )

    # No comment header: a leading '#' line would break strict CSV parsers, exactly
    # as results/ATTRIBUTION.md explains for the pilot's own table. Attribution for
    # this file lives in data/ATTRIBUTION.md.
    with OUT_PORTALS.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["cod_ndp", "lon", "lat"])
        writer.writerows(out_rows)

    admin = json.loads(ADMIN_GEOJSON.read_text(encoding="utf-8"))
    matches = [
        feature
        for feature in admin["features"]
        if feature["properties"].get("geography_level") == "barrio"
        and feature["properties"].get("official_id") == STUDY_BARRIO_ID
    ]
    if len(matches) != 1:
        raise SystemExit(
            f"expected exactly one barrio {STUDY_BARRIO_ID}, found {len(matches)}"
        )

    barrio = matches[0]
    barrio_collection = {
        "type": "FeatureCollection",
        "name": f"study_barrio_{STUDY_BARRIO_ID}",
        "crs": admin.get("crs"),
        "attribution": [
            "Origen de los datos: Ayuntamiento de Madrid (official administrative "
            "geography, CC BY 4.0)."
        ],
        "provenance": {
            "extracted_from": "data/geography/madrid_admin.geojson",
            "selection": (
                "the single feature with geography_level=barrio and "
                f"official_id={STUDY_BARRIO_ID}"
            ),
            "geometry_modified": False,
            "source_sha256": sha256(ADMIN_GEOJSON),
        },
        "osm_note": "This file carries no value derived from OpenStreetMap.",
        "features": [barrio],
    }
    # newline="\n" on every write: the default would emit CRLF on Windows, so the
    # same inputs would produce different bytes on different platforms and the
    # SHA-256s recorded here would stop meaning anything.
    OUT_BARRIO.write_text(
        json.dumps(barrio_collection, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    report = json.loads(REPORT_JSON.read_text(encoding="utf-8"))
    baseline = report["s4_results_baseline"]
    discordance = baseline["nearest_facility_discordance"]
    facilities = json.loads(FACILITIES_GEOJSON.read_text(encoding="utf-8"))

    states: dict[str, int] = {}
    for row in rows:
        states[row["state"]] = states.get(row["state"], 0) + 1

    manifest = {
        "generated_by": "research/network_accessibility_pilot/viewer/build_viewer_data.py",
        "purpose": (
            "Baseline for the in-browser integrity checks. Every number here is read "
            "from the committed pilot artifacts, never typed in by hand."
        ),
        "transform": {
            "source_crs": METRIC_CRS,
            "target_crs": GEOGRAPHIC_CRS,
            "source_columns": ["x_25830", "y_25830"],
            "output_decimals": COORD_DECIMALS,
            "transform_roundtrip_worst_residual_m": round(worst_transform_residual, 12),
            "transform_roundtrip_tolerance_m": TRANSFORM_TOLERANCE_M,
            "quantisation_worst_residual_m": round(worst_quantisation_residual, 9),
            "quantisation_tolerance_m": QUANTISATION_TOLERANCE_M,
            "quantisation_note": (
                "The quantisation residual is the displacement caused by rounding the "
                "output to 7 decimal places, not an error in the transform. Its "
                "theoretical bound at this latitude is ~0.0056 m."
            ),
        },
        "counts": {
            "portals_total": len(out_rows),
            "portals_by_state": dict(sorted(states.items())),
            "facility_access_points": len(facilities["features"]),
            "facility_access_points_inside_study_barrio": sum(
                1
                for feature in facilities["features"]
                if feature["properties"].get("inside_study_barrio")
            ),
        },
        "expected_from_pilot_report": {
            "origins_total": baseline["origins_total"],
            "origins_measured": baseline["origins_measured"],
            "origins_not_snapped": baseline["origins_not_snapped"],
            "origins_unreachable": baseline["origins_unreachable"],
            "facilities_seeded": baseline["facilities_seeded"],
            "nearest_facility_disagreements": discordance[
                "origins_where_euclid_and_network_disagree"
            ],
            "nearest_facility_disagreement_denominator_n": discordance["denominator_n"],
            "nearest_facility_disagreement_share_pct": discordance["share_pct"],
            "euclid_nearest_m_p50": baseline["euclid_nearest_m"]["p50"],
            "network_nearest_m_p50": baseline["network_nearest_m"]["p50"],
            "detour_ratio_p50": baseline["detour_ratio_to_network_nearest"]["p50"],
            "ratio_defined_pairs": baseline["ratio_denominator_rule"][
                "ratio_defined_pairs"
            ],
            "ratio_excluded_pairs": baseline["ratio_denominator_rule"][
                "ratio_excluded_pairs"
            ],
        },
        "bounds_wgs84": {
            "lon_min": min(lons),
            "lon_max": max(lons),
            "lat_min": min(lats),
            "lat_max": max(lats),
        },
        "source_checksums_sha256": {
            "results/origin_facility_distances.csv": sha256(DISTANCES_CSV),
            "results/facility_access_points.geojson": sha256(FACILITIES_GEOJSON),
            "results/pilot_report.json": sha256(REPORT_JSON),
            "data/geography/madrid_admin.geojson": sha256(ADMIN_GEOJSON),
        },
    }
    OUT_MANIFEST.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )

    print(f"portals written      : {len(out_rows)}")
    print(f"states               : {manifest['counts']['portals_by_state']}")
    print(f"facility points      : {manifest['counts']['facility_access_points']}")
    print(
        f"transform residual   : {worst_transform_residual:.12f} m "
        f"(tolerance {TRANSFORM_TOLERANCE_M} m)"
    )
    print(
        f"quantisation residual: {worst_quantisation_residual:.9f} m "
        f"(tolerance {QUANTISATION_TOLERANCE_M} m, from 7-decimal rounding)"
    )
    print(f"bounds               : {manifest['bounds_wgs84']}")
    print(f"wrote {OUT_PORTALS.name}, {OUT_BARRIO.name}, {OUT_MANIFEST.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
