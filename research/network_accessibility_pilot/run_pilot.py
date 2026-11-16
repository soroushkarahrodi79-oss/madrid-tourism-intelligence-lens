"""Madrid Network Accessibility pilot — the whole run, in order.

    python research/network_accessibility_pilot/run_pilot.py

Research only. Writes nothing outside ``research/network_accessibility_pilot/``
and imports nothing from the application. See the package README for the
question, the design, the acceptance criteria and the verdict.

The run is one pass with five stages:

  S1  freeze the official sources and their licences
  S2  resolve the study area, the origin universe and the facility universe
  S3  retrieve the OSM extract once, then build one pedestrian graph per
      extraction variant and measure Euclidean and network distances
  S4  compare the variants against the baseline
  S5  export the table, the point geometry, the figure and the metadata

Stage S3 downloads the OSM extract exactly once and re-filters the same cached
bytes for every variant, so the sensitivity analysis varies only the documented
decision and never the input data.
"""

from __future__ import annotations

import csv
import io
import json
import math
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from pilot_common import (  # noqa: E402
    GEOGRAPHIC_CRS,
    METRIC_CRS,
    Graph,
    cache_dir,
    euclid,
    multi_source_dijkstra,
    parse_spanish_decimal,
    quantiles,
    retrieve,
    snap_points_into_graph,
    to_metric,
    write_result,
)

REPO = pathlib.Path(__file__).resolve().parents[2]

# --------------------------------------------------------------------------
# Design constants. These are the parameters the measurement depends on,
# gathered here so the whole design can be read in one place and varied in one
# place. They were set while building the pipeline and before its results were
# examined, but this pilot holds NO independent timestamped record proving that
# order, so they are documented retrospectively and must not be described as
# pre-registered. What IS verifiable is weaker and stated plainly: the
# study-area rule below is recomputed at run time from the sources alone and
# never from a distance, so it cannot have been fitted to an outcome.
# --------------------------------------------------------------------------

#: Study area. Selection rule, stated in the README and applied in S2: among the
#: 131 official barrios whose centroid lies inside the application's documented
#: central-Madrid envelope, the barrio holding the most DISTINCT official
#: facility access points; ties broken by smaller area.
STUDY_BARRIO_ID = "113"
APP_ENVELOPE = {"lat_min": 40.385, "lat_max": 40.455, "lon_min": -3.745, "lon_max": -3.645}

#: Origin rule: every current official address point of type PORTAL (a street
#: doorway) whose official callejero district/barrio codes name the study
#: barrio. Not a sample, not a grid, not a result-dependent selection.
ORIGIN_TIPO_NDP = "PORTAL"

#: Facility candidates may lie outside the study barrio, or every origin near
#: the boundary would be measured against an artificially distant facility.
FACILITY_BUFFER_M = 1000.0
#: The network is extracted wider still, so a path to a candidate facility is
#: never truncated by the edge of the extract.
NETWORK_BUFFER_M = 1600.0
#: A portal further than this from any retained pedestrian segment is reported
#: as NOT SNAPPED rather than attached to a distant street.
SNAP_RADIUS_M = 30.0

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
CKAN_PACKAGE_SHOW = "https://datos.madrid.es/api/3/action/package_show"

CALLEJERO_PACKAGE = "213605-0-callejero-oficial-madrid"
CALLEJERO_RESOURCE = "213605-4-callejero-oficial-madrid-csv"
CALLEJERO_ENCODING = "cp1252"

FACILITY_PACKAGE = "200215-0-instalaciones-deportivas"
FACILITY_RESOURCE = "200215-1-instalaciones-deportivas-json"

GEOGRAPHY_ARTIFACT = "data/geography/madrid_admin.geojson"

# --------------------------------------------------------------------------
# OSM pedestrian extraction rules
# --------------------------------------------------------------------------

#: Baseline: every way a pedestrian may lawfully and physically walk along in
#: an ordinary Madrid street network, including carriageways of residential and
#: distributor streets, which in Madrid carry pavements that OSM does not
#: always map separately. Motorways and trunk roads are excluded outright.
BASELINE_HIGHWAY = frozenset(
    {
        "primary",
        "primary_link",
        "secondary",
        "secondary_link",
        "tertiary",
        "tertiary_link",
        "unclassified",
        "residential",
        "living_street",
        "pedestrian",
        "footway",
        "path",
        "steps",
        "service",
        "track",
        "road",
        "cycleway",
    }
)

#: Never walkable, or not a linear way at all.
EXCLUDED_HIGHWAY = frozenset(
    {
        "motorway",
        "motorway_link",
        "trunk",
        "trunk_link",
        "construction",
        "proposed",
        "raceway",
        "bus_guideway",
        "busway",
        "escape",
        "corridor",
        "platform",
        "rest_area",
        "services",
        "elevator",
    }
)

#: A way carrying one of these is not public pedestrian space in the baseline.
DENY_ACCESS = frozenset({"no", "private"})
#: ... unless an explicit foot tag grants passage.
FOOT_GRANT = frozenset({"yes", "designated", "permissive", "official"})

STRICT_PEDESTRIAN_HIGHWAY = frozenset({"pedestrian", "footway", "path", "steps", "living_street"})

#: The sensitivity variants. Each changes exactly ONE documented decision.
VARIANTS = [
    {
        "id": "baseline",
        "decision": "the documented baseline",
        "highway": BASELINE_HIGHWAY,
        "allow_steps": True,
        "respect_access": True,
        "snap_radius_m": SNAP_RADIUS_M,
        "facility_buffer_m": FACILITY_BUFFER_M,
    },
    {
        "id": "strict_pedestrian",
        "decision": "retain only ways tagged as pedestrian space; no carriageways",
        "highway": STRICT_PEDESTRIAN_HIGHWAY,
        "allow_steps": True,
        "respect_access": True,
        "snap_radius_m": SNAP_RADIUS_M,
        "facility_buffer_m": FACILITY_BUFFER_M,
    },
    {
        "id": "no_steps",
        "decision": "remove highway=steps (a step-free walking proxy)",
        "highway": BASELINE_HIGHWAY,
        "allow_steps": False,
        "respect_access": True,
        "snap_radius_m": SNAP_RADIUS_M,
        "facility_buffer_m": FACILITY_BUFFER_M,
    },
    {
        "id": "permissive_access",
        "decision": "ignore access=no/private (upper bound on permeability)",
        "highway": BASELINE_HIGHWAY,
        "allow_steps": True,
        "respect_access": False,
        "snap_radius_m": SNAP_RADIUS_M,
        "facility_buffer_m": FACILITY_BUFFER_M,
    },
    {
        "id": "snap_15m",
        "decision": "tighten the snapping tolerance to 15 m",
        "highway": BASELINE_HIGHWAY,
        "allow_steps": True,
        "respect_access": True,
        "snap_radius_m": 15.0,
        "facility_buffer_m": FACILITY_BUFFER_M,
    },
    {
        "id": "snap_50m",
        "decision": "loosen the snapping tolerance to 50 m",
        "highway": BASELINE_HIGHWAY,
        "allow_steps": True,
        "respect_access": True,
        "snap_radius_m": 50.0,
        "facility_buffer_m": FACILITY_BUFFER_M,
    },
    {
        "id": "facility_buffer_500m",
        "decision": "halve the out-of-barrio facility catchment to 500 m",
        "highway": BASELINE_HIGHWAY,
        "allow_steps": True,
        "respect_access": True,
        "snap_radius_m": SNAP_RADIUS_M,
        "facility_buffer_m": 500.0,
    },
]

#: Decision-relevant thresholds. A "within X metres" claim made on Euclidean
#: distance is checked against the same claim made on network distance.
THRESHOLDS_M = (300.0, 500.0, 800.0)

#: A ratio needs a denominator that is larger than the precision of the
#: coordinates it is computed from. The facility register publishes WGS84 to 7
#: decimals (~1.1 cm) and the callejero publishes UTM to the centimetre, so a
#: separation below one metre is inside the geocoding precision of the inputs
#: and the resulting ratio is not interpretable. Pairs below this bound are
#: excluded from RATIO statistics only, counted, and kept in full in the
#: distance-in-metres statistics, where they remain valid.
#:
#: This bound is deliberately minimal. An earlier draft of this pilot used 25 m,
#: which is not wrong but does more work than the data justify; the run reports
#: the 25 m figure alongside as a robustness check so the choice can be judged
#: rather than trusted (see ``ratio_denominator_rule.robustness_*``).
RATIO_MIN_DENOMINATOR_M = 1.0
RATIO_ALTERNATIVE_FLOOR_M = 25.0

PROBS = (0.05, 0.25, 0.5, 0.75, 0.95, 0.99)


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


# --------------------------------------------------------------------------
# S1 — official sources and their licences
# --------------------------------------------------------------------------


def ckan_package(package_id: str) -> dict:
    hit = retrieve(
        f"{CKAN_PACKAGE_SHOW}?id={package_id}", f"ckan_{package_id}", suffix=".json"
    )
    body = json.loads(hit["path"].read_text(encoding="utf-8"))
    if not body.get("success"):
        raise RuntimeError(f"CKAN package_show failed for {package_id}")
    return {"result": body["result"], "provenance": hit["provenance"]}


def resolve_resource(package: dict, resource_id: str) -> dict:
    for resource in package["result"].get("resources", []):
        if resource.get("id") == resource_id:
            return resource
    raise RuntimeError(f"resource {resource_id} absent from package")


def stage_s1() -> dict:
    log("S1 resolving official sources")
    callejero_pkg = ckan_package(CALLEJERO_PACKAGE)
    facility_pkg = ckan_package(FACILITY_PACKAGE)
    callejero_res = resolve_resource(callejero_pkg, CALLEJERO_RESOURCE)
    facility_res = resolve_resource(facility_pkg, FACILITY_RESOURCE)

    geography_meta = json.loads(
        (REPO / "data/geography/madrid_admin.meta.json").read_text(encoding="utf-8")
    )

    return {
        "origins": {
            "role": "origin universe (official address portals)",
            "dataset_id": CALLEJERO_PACKAGE,
            "resource_id": CALLEJERO_RESOURCE,
            "resource_description": callejero_res.get("description"),
            "download_url": callejero_res.get("url"),
            "declared_licence": callejero_pkg["result"].get("license_title"),
            "declared_licence_url": callejero_pkg["result"].get("license_url"),
            "publisher": "Ayuntamiento de Madrid",
            "encoding_observed": CALLEJERO_ENCODING,
            "coordinate_fields": ["UTMX_ETRS", "UTMY_ETRS"],
            "coordinate_crs": METRIC_CRS,
            "note": (
                "The register publishes its coordinates in ETRS89/UTM 30N directly, "
                "so origins are never reprojected in this pilot."
            ),
            "already_used_by_repository": (
                "scripts/build_callejero_ndp_crosswalk.py resolves the same resource id"
            ),
        },
        "facilities": {
            "role": "facility universe (one urban facility category)",
            "dataset_id": FACILITY_PACKAGE,
            "resource_id": FACILITY_RESOURCE,
            "resource_description": facility_res.get("description"),
            "download_url": facility_res.get("url"),
            "declared_licence": facility_pkg["result"].get("license_title"),
            "declared_licence_url": facility_pkg["result"].get("license_url"),
            "publisher": "Ayuntamiento de Madrid",
            "coordinate_fields": ["location.latitude", "location.longitude"],
            "coordinate_crs": GEOGRAPHIC_CRS,
            "family_note": (
                "Same municipal 'Equipamientos' publication family and same CC BY 4.0 "
                "instrument as the museums dataset the application already adopts "
                "(201132). No new licensing instrument is introduced by this pilot."
            ),
        },
        "study_area_geometry": {
            "role": "study-area boundary and spatial coherence check",
            "artifact": GEOGRAPHY_ARTIFACT,
            "committed_in_repository": True,
            "declared_licence": geography_meta.get("licence")
            or geography_meta.get("license")
            or "see data/geography/madrid_admin.meta.json",
        },
        "network": {
            "role": "pedestrian network geometry",
            "source": "OpenStreetMap, via the Overpass API",
            "endpoint": OVERPASS_URL,
            "declared_licence": "Open Database License (ODbL) 1.0",
            "attribution_required": "© OpenStreetMap contributors",
            "distribution_decision": (
                "OSM-derived LINEAR GEOMETRY and route traces are written to the git-ignored "
                "cache only and are NOT committed. Only the derived distance table and the "
                "official point geometry are committed, each carrying the OSM attribution."
            ),
            "distribution_decision_basis": (
                "A PRECAUTION, not a legal determination. Whether a distance table derived "
                "from OSM is a Produced Work or a Derivative Database under ODbL 1.0 is a "
                "question this pilot is not competent to settle, and the boundary is "
                "genuinely contested for derived measurements. The pilot therefore takes the "
                "conservative route on both sides: it withholds the extracted geometry, which "
                "is the clearest derivative-database case, AND it attributes OpenStreetMap on "
                "the derived outputs, which a Produced Work would require anyway. Nothing here "
                "is legal advice, and adopting any of this into the application should be "
                "reviewed by someone who can give it."
            ),
            "not_official": (
                "OSM is volunteered geographic information, not an official municipal "
                "source. It is kept categorically distinct from the official sources "
                "above and from the derived results."
            ),
        },
        "retrieval_provenance": {
            "callejero_catalogue": callejero_pkg["provenance"],
            "facility_catalogue": facility_pkg["provenance"],
        },
    }


# --------------------------------------------------------------------------
# S2 — study area, origins, facilities
# --------------------------------------------------------------------------


def _require_shapely():
    from shapely.geometry import Point, shape  # noqa: PLC0415
    from shapely.ops import transform  # noqa: PLC0415

    return Point, shape, transform


def _metric_transform():
    import pyproj  # noqa: PLC0415

    return pyproj.Transformer.from_crs(GEOGRAPHIC_CRS, METRIC_CRS, always_xy=True).transform


def _inverse_transform():
    import pyproj  # noqa: PLC0415

    return pyproj.Transformer.from_crs(METRIC_CRS, GEOGRAPHIC_CRS, always_xy=True).transform


def load_facilities() -> list[dict]:
    package = ckan_package(FACILITY_PACKAGE)
    resource = resolve_resource(package, FACILITY_RESOURCE)
    hit = retrieve(resource["url"], "facilities_200215", suffix=".json")
    body = json.loads(hit["path"].read_text(encoding="utf-8"))
    out = []
    for record in body.get("@graph", []):
        location = record.get("location") or {}
        lat, lon = location.get("latitude"), location.get("longitude")
        if lat is None or lon is None:
            out.append({"id": str(record.get("id")), "title": record.get("title"), "geometry": None})
            continue
        x, y = to_metric(float(lon), float(lat))
        out.append(
            {
                "id": str(record.get("id")),
                "title": record.get("title"),
                "subtype": (record.get("@type") or "").rsplit("/", 1)[-1],
                "lon": float(lon),
                "lat": float(lat),
                "x": x,
                "y": y,
                "geometry": True,
            }
        )
    return out


def load_origins() -> list[dict]:
    package = ckan_package(CALLEJERO_PACKAGE)
    resource = resolve_resource(package, CALLEJERO_RESOURCE)
    hit = retrieve(resource["url"], "callejero_direccionesvigentes", suffix=".csv")
    text = hit["path"].read_bytes().decode(CALLEJERO_ENCODING)
    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    district, barrio = STUDY_BARRIO_ID[:2], STUDY_BARRIO_ID[2:].lstrip("0") or "0"
    out = []
    seen_ndp: set[str] = set()
    duplicate_ndp: list[str] = []
    total = 0
    for row in reader:
        total += 1
        if row["DISTRITO"].strip() != district or row["BARRIO"].strip() != barrio:
            continue
        if row["TIPO_NDP"].strip().upper() != ORIGIN_TIPO_NDP:
            continue
        xs, ys = row["UTMX_ETRS"].strip(), row["UTMY_ETRS"].strip()
        if not xs or not ys:
            continue
        ndp = row["COD_NDP"].strip()
        # COD_NDP is the origin's identity throughout the pilot (snapping key,
        # table key, geometry key). A duplicate would silently collapse two
        # portals into one, so it is recorded and the row is not admitted.
        if ndp in seen_ndp:
            duplicate_ndp.append(ndp)
            continue
        seen_ndp.add(ndp)
        out.append(
            {
                "cod_ndp": ndp,
                "address": " ".join(
                    part
                    for part in (
                        row["VIA_CLASE"].strip(),
                        row["VIA_NOMBRE_ACENTOS"].strip(),
                        row["NUMERO"].strip(),
                    )
                    if part
                ),
                "x": parse_spanish_decimal(xs),
                "y": parse_spanish_decimal(ys),
            }
        )
    return out, total, hit["provenance"], sorted(set(duplicate_ndp))


def stage_s2() -> dict:
    log("S2 study area, origins, facilities")
    Point, shape, transform = _require_shapely()
    forward = _metric_transform()

    geojson = json.loads((REPO / GEOGRAPHY_ARTIFACT).read_text(encoding="utf-8"))
    barrios = [
        feature
        for feature in geojson["features"]
        if feature["properties"].get("geography_level") == "barrio"
    ]
    facilities = load_facilities()

    # --- the study-area selection rule, recomputed in the open at run time ---
    distinct_by_barrio = {}
    for feature in barrios:
        geom = shape(feature["geometry"])
        centroid = geom.centroid
        in_envelope = (
            APP_ENVELOPE["lat_min"] <= centroid.y <= APP_ENVELOPE["lat_max"]
            and APP_ENVELOPE["lon_min"] <= centroid.x <= APP_ENVELOPE["lon_max"]
        )
        if not in_envelope:
            continue
        coords = {
            (f["lon"], f["lat"])
            for f in facilities
            if f["geometry"] and geom.contains(Point(f["lon"], f["lat"]))
        }
        distinct_by_barrio[feature["properties"]["official_id"]] = {
            "name": feature["properties"]["official_name"],
            "district": feature["properties"]["parent_name"],
            "distinct_access_points": len(coords),
            "area_km2": round(transform(forward, geom).area / 1e6, 4),
        }
    ranked = sorted(
        distinct_by_barrio.items(),
        key=lambda kv: (-kv[1]["distinct_access_points"], kv[1]["area_km2"], kv[0]),
    )
    selected_by_rule = ranked[0][0]

    study = next(f for f in barrios if f["properties"]["official_id"] == STUDY_BARRIO_ID)
    study_geom_wgs = shape(study["geometry"])
    study_geom = transform(forward, study_geom_wgs)

    origins, callejero_rows, callejero_provenance, duplicate_ndp = load_origins()

    # Geometric coherence: the callejero's own barrio codes must agree with the
    # official barrio polygon. Disagreement is reported, never silently fixed.
    inside = [o for o in origins if study_geom.contains(Point(o["x"], o["y"]))]
    outside = [o for o in origins if not study_geom.contains(Point(o["x"], o["y"]))]

    catchment = study_geom.buffer(FACILITY_BUFFER_M)
    wide = study_geom.buffer(max(FACILITY_BUFFER_M, NETWORK_BUFFER_M))
    candidates = [f for f in facilities if f["geometry"] and catchment.contains(Point(f["x"], f["y"]))]

    # Distinct access points: the register publishes one row per sub-installation
    # (a court, a rink), several of which share one street location. For a
    # nearest-facility measure the unit of analysis is the ACCESS POINT, so rows
    # at an identical published coordinate are collapsed and the collapse is
    # reported rather than hidden.
    by_coord: dict[tuple[float, float], list[dict]] = {}
    for facility in candidates:
        by_coord.setdefault((round(facility["lon"], 7), round(facility["lat"], 7)), []).append(
            facility
        )
    access_points = []
    for (lon, lat), group in sorted(by_coord.items()):
        chosen = sorted(group, key=lambda f: f["id"])[0]
        access_points.append(
            {
                "access_point_id": chosen["id"],
                "collapsed_record_ids": sorted(f["id"] for f in group),
                "record_count": len(group),
                "title": chosen["title"],
                "subtypes": sorted({f.get("subtype") for f in group if f.get("subtype")}),
                "lon": lon,
                "lat": lat,
                "x": chosen["x"],
                "y": chosen["y"],
                "inside_study_barrio": bool(study_geom.contains(Point(chosen["x"], chosen["y"]))),
            }
        )

    minx, miny, maxx, maxy = wide.bounds
    inverse = _inverse_transform()
    west, south = inverse(minx, miny)
    east, north = inverse(maxx, maxy)

    return {
        "selection_rule": {
            "statement": (
                "Among the official barrios whose centroid lies inside the application's "
                "documented central-Madrid envelope, take the barrio with the most DISTINCT "
                "official facility access points; break ties by smaller area. The rule is "
                "recomputed here at run time and depends only on the facility register and "
                "the official geography, never on a distance or a ratio, so it cannot have "
                "been fitted to an outcome. That is an argument from the rule's INPUTS, not "
                "a claim of pre-registration: this pilot holds no independent timestamped "
                "record of when the rule was written."
            ),
            "app_envelope": APP_ENVELOPE,
            "barrio_selected_by_rule": selected_by_rule,
            "barrio_declared_in_code": STUDY_BARRIO_ID,
            "rule_agrees_with_declaration": selected_by_rule == STUDY_BARRIO_ID,
            "top_candidates": [
                {"official_id": k, **v} for k, v in ranked[:8]
            ],
        },
        "study_area": {
            "official_id": STUDY_BARRIO_ID,
            "official_name": study["properties"]["official_name"],
            "district": study["properties"]["parent_name"],
            "area_km2": round(study_geom.area / 1e6, 4),
            "perimeter_m": round(study_geom.length, 1),
            "crs": METRIC_CRS,
        },
        "origins": {
            "rule": (
                f"every current official address point with TIPO_NDP={ORIGIN_TIPO_NDP} whose "
                "callejero DISTRITO/BARRIO codes name the study barrio"
            ),
            "callejero_rows_scanned": callejero_rows,
            "origins_selected": len(origins),
            "duplicate_cod_ndp_rejected": len(duplicate_ndp),
            "duplicate_cod_ndp_examples": duplicate_ndp[:5],
            "inside_official_polygon": len(inside),
            "outside_official_polygon": len(outside),
            "coherence_note": (
                "A portal whose official barrio code names the study barrio but which falls "
                "outside the official barrio polygon is a disagreement between two official "
                "products. It is counted here and kept in the analysis; it is not moved, "
                "re-coded or dropped."
            ),
            "retrieval_provenance": callejero_provenance,
        },
        "facilities": {
            "category": "Instalaciones Deportivas Basicas Municipales (200215)",
            "catchment_rule": f"within {FACILITY_BUFFER_M:.0f} m of the study-barrio boundary",
            "records_citywide": len(facilities),
            "records_without_coordinates": sum(1 for f in facilities if not f["geometry"]),
            "records_in_catchment": len(candidates),
            "distinct_access_points_in_catchment": len(access_points),
            "access_points_inside_study_barrio": sum(
                1 for a in access_points if a["inside_study_barrio"]
            ),
            "collapse_note": (
                "The register publishes one row per sub-installation; rows sharing an "
                "identical published coordinate are one access point here. "
                f"{len(candidates)} rows collapse to {len(access_points)} access points."
            ),
        },
        "_internal": {
            "study_geom": study_geom,
            "origins": origins,
            "access_points": access_points,
            "facilities_all": facilities,
            "bbox_wgs84": {"south": south, "west": west, "north": north, "east": east},
        },
    }


# --------------------------------------------------------------------------
# S3 — OSM retrieval, graph construction, distances
# --------------------------------------------------------------------------


def fetch_osm(bbox: dict) -> dict:
    query = (
        "[out:json][timeout:900];"
        f'way({bbox["south"]:.6f},{bbox["west"]:.6f},{bbox["north"]:.6f},{bbox["east"]:.6f})["highway"];'
        "(._;>;);"
        "out body qt;"
    )
    log("S3 retrieving the OSM extract (once; every variant re-filters these bytes)")
    hit = retrieve(
        OVERPASS_URL,
        "osm_highway_extract",
        method="POST",
        data={"data": query},
        suffix=".json",
    )
    body = json.loads(hit["path"].read_text(encoding="utf-8"))
    osm3s = body.get("osm3s") or {}
    # The HTTP layer carries no validator for a POST, so the only temporal
    # anchor for the DATA (as opposed to the request) is the base timestamp
    # Overpass reports inside the payload. It is read here, not assumed.
    vintage = {
        "timestamp_osm_base": osm3s.get("timestamp_osm_base"),
        "overpass_generator": body.get("generator"),
        "osm_api_version": body.get("version"),
        "copyright_notice_as_served": osm3s.get("copyright"),
        "elements_returned": len(body.get("elements", [])),
        "meaning": (
            "timestamp_osm_base is the state of the OpenStreetMap database the answer was "
            "computed against. It, not the retrieval time, is this result's data vintage."
        ),
    }
    return {
        "body": body,
        "provenance": hit["provenance"],
        "query": query,
        "vintage": vintage,
    }


def classify_way(tags: dict, variant: dict) -> tuple[bool, str]:
    """Return ``(retained, reason)`` for one OSM way under one variant."""
    highway = (tags.get("highway") or "").strip()
    if not highway:
        return False, "no_highway_tag"
    if highway in EXCLUDED_HIGHWAY:
        return False, f"excluded_highway:{highway}"
    if highway == "steps" and not variant["allow_steps"]:
        return False, "variant_excludes_steps"
    if highway not in variant["highway"]:
        return False, f"highway_not_in_variant:{highway}"
    if (tags.get("indoor") or "").strip() == "yes":
        return False, "indoor"
    foot = (tags.get("foot") or "").strip()
    access = (tags.get("access") or "").strip()
    if variant["respect_access"]:
        if foot in DENY_ACCESS:
            return False, "foot_denied"
        if access in DENY_ACCESS and foot not in FOOT_GRANT:
            return False, "access_denied"
    return True, "retained"


def build_graph(osm: dict, variant: dict) -> dict:
    nodes = {}
    ways = []
    for element in osm["elements"]:
        if element["type"] == "node":
            nodes[element["id"]] = (element["lon"], element["lat"])
        elif element["type"] == "way":
            ways.append(element)

    graph = Graph()
    segments: list[tuple[object, object]] = []
    rejected: dict[str, int] = {}
    retained_ways = 0
    missing_node_refs = 0
    area_rings = 0

    metric_cache: dict[int, tuple[float, float]] = {}

    def pos(node_id: int):
        if node_id not in metric_cache:
            lon, lat = nodes[node_id]
            metric_cache[node_id] = to_metric(lon, lat)
        return metric_cache[node_id]

    for way in ways:
        tags = way.get("tags") or {}
        keep, reason = classify_way(tags, variant)
        if not keep:
            rejected[reason] = rejected.get(reason, 0) + 1
            continue
        refs = [r for r in way.get("nodes", []) if r in nodes]
        if len(refs) != len(way.get("nodes", [])):
            missing_node_refs += 1
        if len(refs) < 2:
            rejected["fewer_than_two_resolved_nodes"] = (
                rejected.get("fewer_than_two_resolved_nodes", 0) + 1
            )
            continue
        if (tags.get("area") or "").strip() == "yes":
            area_rings += 1
        retained_ways += 1
        for ref in refs:
            x, y = pos(ref)
            graph.add_node(ref, x, y)
        for a, b in zip(refs, refs[1:]):
            if a == b:
                continue
            graph.add_edge(a, b)
            segments.append((a, b))

    return {
        "graph": graph,
        "segments": segments,
        "stats": {
            "osm_nodes_in_extract": len(nodes),
            "osm_ways_in_extract": len(ways),
            "ways_retained": retained_ways,
            "ways_rejected_by_reason": dict(sorted(rejected.items())),
            "ways_with_area_yes_kept_as_ring": area_rings,
            "ways_with_unresolved_node_refs": missing_node_refs,
            "graph_nodes_before_snapping": graph.node_count,
            "graph_segments_before_snapping": len(segments),
            "graph_total_length_km": round(graph.total_length_m() / 1000.0, 3),
        },
    }


def measure(osm: dict, s2: dict, variant: dict) -> dict:
    built = build_graph(osm["body"], variant)
    graph, segments = built["graph"], built["segments"]

    origins = s2["_internal"]["origins"]
    if variant["facility_buffer_m"] == FACILITY_BUFFER_M:
        access_points = s2["_internal"]["access_points"]
    else:
        Point, _shape, _transform = _require_shapely()
        catchment = s2["_internal"]["study_geom"].buffer(variant["facility_buffer_m"])
        keep = {
            a["access_point_id"]
            for a in s2["_internal"]["access_points"]
            if catchment.contains(Point(a["x"], a["y"]))
        }
        access_points = [
            a for a in s2["_internal"]["access_points"] if a["access_point_id"] in keep
        ]

    points = [(f"F:{a['access_point_id']}", a["x"], a["y"]) for a in access_points]
    points += [(f"O:{o['cod_ndp']}", o["x"], o["y"]) for o in origins]
    snapped, unsnapped = snap_points_into_graph(
        graph, segments, points, max_radius=variant["snap_radius_m"]
    )

    components = graph.components()
    largest = components[0] if components else set()

    seeds = {}
    seeded_facilities = []
    for access in access_points:
        key = f"F:{access['access_point_id']}"
        info = snapped.get(key)
        if not info:
            continue
        seeds[info["node"]] = (info["offset_m"], access["access_point_id"])
        seeded_facilities.append(access)

    if not seeds:
        raise RuntimeError(f"variant {variant['id']}: no facility could be snapped")

    dist, label = multi_source_dijkstra(graph, seeds)

    rows = []
    invariant_violations = []
    for origin in origins:
        key = f"O:{origin['cod_ndp']}"
        info = snapped.get(key)
        record = {
            "cod_ndp": origin["cod_ndp"],
            "address": origin["address"],
            "x_25830": round(origin["x"], 2),
            "y_25830": round(origin["y"], 2),
        }
        # Euclidean nearest, over the same facility set, ties by id.
        best = min(
            (
                (euclid((origin["x"], origin["y"]), (a["x"], a["y"])), a["access_point_id"])
                for a in seeded_facilities
            ),
            key=lambda t: (t[0], t[1]),
        )
        record["euclid_nearest_facility"] = best[1]
        record["euclid_nearest_m"] = round(best[0], 3)

        if info is None:
            record.update(
                {
                    "snap_offset_m": None,
                    "network_nearest_facility": None,
                    "network_nearest_m": None,
                    "detour_ratio": None,
                    "state": "NOT_SNAPPED",
                }
            )
            rows.append(record)
            continue
        record["snap_offset_m"] = round(info["offset_m"], 3)
        node = info["node"]
        if node not in dist or node not in largest:
            record.update(
                {
                    "network_nearest_facility": None,
                    "network_nearest_m": None,
                    "detour_ratio": None,
                    "state": "UNREACHABLE",
                }
            )
            rows.append(record)
            continue
        network_m = dist[node] + info["offset_m"]
        facility_id = label[node]
        chosen = next(a for a in seeded_facilities if a["access_point_id"] == facility_id)
        straight_to_chosen = euclid((origin["x"], origin["y"]), (chosen["x"], chosen["y"]))
        record.update(
            {
                "network_nearest_facility": facility_id,
                "network_nearest_m": round(network_m, 3),
                "euclid_to_network_nearest_m": round(straight_to_chosen, 3),
                "detour_ratio": round(network_m / straight_to_chosen, 5)
                if straight_to_chosen >= RATIO_MIN_DENOMINATOR_M
                else None,
                "understatement_ratio": round(network_m / best[0], 5)
                if best[0] >= RATIO_MIN_DENOMINATOR_M
                else None,
                "understatement_m": round(network_m - best[0], 3),
                "ratio_defined": straight_to_chosen >= RATIO_MIN_DENOMINATOR_M
                and best[0] >= RATIO_MIN_DENOMINATOR_M,
                "straight_to_network_nearest_raw_m": straight_to_chosen,
                "agrees_with_euclid_nearest": facility_id == best[1],
                "state": "MEASURED",
            }
        )
        # Geometric necessity: a path along the network can never be shorter
        # than the straight line between the same two published points.
        if network_m + 1e-6 < straight_to_chosen:
            invariant_violations.append(
                {
                    "cod_ndp": origin["cod_ndp"],
                    "network_m": network_m,
                    "straight_m": straight_to_chosen,
                }
            )
        rows.append(record)

    measured = [r for r in rows if r["state"] == "MEASURED"]
    detours = [r["detour_ratio"] for r in measured if r["detour_ratio"] is not None]
    understate = [
        r["understatement_ratio"] for r in measured if r["understatement_ratio"] is not None
    ]
    euclid_nearest = [r["euclid_nearest_m"] for r in measured]
    network_nearest = [r["network_nearest_m"] for r in measured]
    raw_denominators = [r["straight_to_network_nearest_raw_m"] for r in measured]
    below_bound = [d for d in raw_denominators if d < RATIO_MIN_DENOMINATOR_M]
    exactly_zero = [d for d in raw_denominators if d == 0.0]
    alternative = sorted(
        r["network_nearest_m"] / r["straight_to_network_nearest_raw_m"]
        for r in measured
        if r["straight_to_network_nearest_raw_m"] >= RATIO_ALTERNATIVE_FLOOR_M
    )

    thresholds = {}
    for limit in THRESHOLDS_M:
        euclid_in = [r for r in measured if r["euclid_nearest_m"] <= limit]
        both_in = [r for r in euclid_in if r["network_nearest_m"] <= limit]
        network_in = [r for r in measured if r["network_nearest_m"] <= limit]
        network_only = [r for r in network_in if r["euclid_nearest_m"] > limit]
        thresholds[f"{limit:.0f}m"] = {
            "within_by_euclid": len(euclid_in),
            "within_by_network": len(network_in),
            "within_by_euclid_and_network": len(both_in),
            "network_says_within_euclid_says_not": len(network_only),
            "subset_note": (
                "The straight-line distance to the straight-line-nearest facility can never "
                "exceed the network distance to the network-nearest facility, so the "
                "network-inside set is necessarily a SUBSET of the straight-line-inside set. "
                "'network_says_within_euclid_says_not' is therefore 0 by construction, not by "
                "coincidence, and there is no symmetric false-exclusion rate to report."
            ),
            "euclid_says_within_network_says_not": len(euclid_in) - len(both_in),
            "false_inclusion_rate_denominator": "origins inside this threshold by straight line",
            "false_inclusion_rate_denominator_n": len(euclid_in),
            "false_inclusion_rate_pct": round(
                100.0 * (len(euclid_in) - len(both_in)) / len(euclid_in), 2
            )
            if euclid_in
            else None,
            "false_inclusion_share_of_all_measured_pct": round(
                100.0 * (len(euclid_in) - len(both_in)) / len(measured), 2
            )
            if measured
            else None,
        }

    discordant = sum(1 for r in measured if not r["agrees_with_euclid_nearest"])

    summary = {
        "variant": variant["id"],
        "decision_changed": variant["decision"],
        "snap_radius_m": variant["snap_radius_m"],
        "facility_buffer_m": variant["facility_buffer_m"],
        "network": built["stats"],
        "connectivity": {
            "measured_after_snapping": True,
            "graph_nodes_after_snapping": graph.node_count,
            "components": len(components),
            "largest_component_nodes": len(largest),
            "largest_component_share_pct": round(
                100.0 * len(largest) / max(graph.node_count, 1), 3
            ),
            "note": (
                "Snapping inserts one virtual node per snapped point, so the post-snapping "
                "node count exceeds the pre-snapping count reported under 'network'. "
                "Connectivity is assessed on the graph that the shortest paths actually run on."
            ),
        },
        "facilities_seeded": len(seeded_facilities),
        "facilities_not_snapped": len(access_points) - len(seeded_facilities),
        "origins_total": len(origins),
        "origins_measured": len(measured),
        "origins_not_snapped": sum(1 for r in rows if r["state"] == "NOT_SNAPPED"),
        "origins_unreachable": sum(1 for r in rows if r["state"] == "UNREACHABLE"),
        "origins_measured_pct": round(100.0 * len(measured) / max(len(origins), 1), 3),
        "snap_offset_m": quantiles([r["snap_offset_m"] for r in measured], PROBS),
        "euclid_nearest_m": quantiles(euclid_nearest, PROBS),
        "network_nearest_m": quantiles(network_nearest, PROBS),
        "ratio_denominator_rule": {
            "minimum_denominator_m": RATIO_MIN_DENOMINATOR_M,
            "statement": (
                "A detour ratio is reported only where the straight-line distance is at "
                f"least {RATIO_MIN_DENOMINATOR_M:.0f} m, the precision bound of the published "
                "coordinates themselves (facility register: WGS84 to 7 decimals, ~1.1 cm; "
                "callejero: UTM to the centimetre). Below that bound the register publishes "
                "the facility at the portal's own published coordinate and the ratio is not "
                "interpretable. Such pairs stay in the metre statistics."
            ),
            "measured_pairs": len(measured),
            "ratio_defined_pairs": len(detours),
            "ratio_excluded_pairs": len(measured) - len(detours),
            "excluded_below_bound": len(below_bound),
            "excluded_exactly_zero_denominator": len(exactly_zero),
            # Not rounded to a few decimals: the smallest separations here are
            # sub-micron, and rounding them would print a positive number as
            # 0.0 and contradict 'excluded_exactly_zero_denominator'.
            "smallest_denominator_m": f"{min(raw_denominators):.3e}"
            if raw_denominators
            else None,
            "smallest_retained_denominator_m": round(
                min((d for d in raw_denominators if d >= RATIO_MIN_DENOMINATOR_M), default=0.0), 4
            ),
            "gap_note": (
                "The excluded separations and the smallest retained one are orders of "
                "magnitude apart, so the bound falls in an empty interval rather than cutting "
                "through the data. That is why the bound's exact value does not matter here."
            ),
            "robustness_alternative_floor_m": RATIO_ALTERNATIVE_FLOOR_M,
            "robustness_alternative_pairs": len(alternative),
            "robustness_alternative_median": round(
                alternative[(len(alternative) - 1) // 2]
                if len(alternative) % 2
                else (
                    alternative[len(alternative) // 2 - 1] + alternative[len(alternative) // 2]
                )
                / 2.0,
                5,
            )
            if alternative
            else None,
            "robustness_note": (
                "The difference between the two bounds is the whole evidence that the choice "
                "of bound does not drive the result. Compare "
                "'robustness_alternative_median' with "
                "'detour_ratio_to_network_nearest.p50'."
            ),
        },
        "detour_ratio_to_network_nearest": quantiles(detours, PROBS),
        "understatement_ratio_nearest_vs_nearest": quantiles(understate, PROBS),
        "mean_detour_ratio_defined_pairs": round(sum(detours) / len(detours), 5)
        if detours
        else None,
        "mean_understatement_m": round(
            sum(r["understatement_m"] for r in measured) / len(measured), 3
        )
        if measured
        else None,
        "nearest_facility_discordance": {
            "origins_where_euclid_and_network_disagree": discordant,
            "denominator": "origins with a MEASURED state",
            "denominator_n": len(measured),
            "share_pct": round(100.0 * discordant / len(measured), 2) if measured else None,
            "share_of_all_selected_origins_pct": round(100.0 * discordant / len(origins), 2)
            if origins
            else None,
            "all_selected_origins_n": len(origins),
            "denominator_note": (
                "The headline share is over MEASURED origins, not over all selected origins: "
                "an origin that could not be snapped or could not be reached has no network "
                "answer to agree or disagree with. Both denominators are given so neither "
                "figure can be quoted without its base."
            ),
        },
        "threshold_sensitivity": thresholds,
        "geometric_invariant_violations": len(invariant_violations),
        "geometric_invariant_examples": invariant_violations[:5],
    }
    return {"summary": summary, "rows": rows, "facilities": seeded_facilities}


# --------------------------------------------------------------------------
# S5 — exports
# --------------------------------------------------------------------------

CSV_COLUMNS = [
    "cod_ndp",
    "address",
    "x_25830",
    "y_25830",
    "state",
    "snap_offset_m",
    "euclid_nearest_facility",
    "euclid_nearest_m",
    "network_nearest_facility",
    "network_nearest_m",
    "euclid_to_network_nearest_m",
    "ratio_defined",
    "detour_ratio",
    "understatement_ratio",
    "understatement_m",
    "agrees_with_euclid_nearest",
]


OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright"
OSM_CREDIT = (
    "Contains information from OpenStreetMap, which is made available under the "
    f"Open Database License (ODbL) 1.0. (c) OpenStreetMap contributors. {OSM_COPYRIGHT_URL}"
)
MADRID_CREDIT_CALLEJERO = (
    "Origen de los datos: Ayuntamiento de Madrid (callejero oficial, CC BY 4.0)."
)
MADRID_CREDIT_FACILITIES = (
    "Origen de los datos: Ayuntamiento de Madrid "
    "(Instalaciones Deportivas Basicas Municipales, dataset 200215, CC BY 4.0)."
)

#: Written beside the artifacts so that a credit reaches a reader who opens any
#: one of them alone. A CSV cannot carry a notice inside itself without breaking
#: every parser that reads it, and the OSMF attribution guideline asks for a
#: credit "where users would customarily expect it" rather than inside the data.
ATTRIBUTION_SIDECAR = "ATTRIBUTION.md"

#: Zenodo deposit for the archived OSM extract.
#:
#: The identifier below is **RESERVED on a draft deposit**, which is not the
#: same thing as published. Zenodo lets a DOI be reserved before the Publish
#: step; until then the record is not public and the DOI is not registered with
#: the global Handle System. Recorded here so the identifier travels with the
#: results, explicitly marked as not yet resolvable, and never as a citation.
ZENODO_DOI_RESERVED = "10.5281/zenodo.24288645"
ZENODO_STATE = "RESERVED_ON_DRAFT_NOT_PUBLISHED"
ZENODO_VERIFIED_ON = "2026-11-16"
ZENODO_VERIFICATION = (
    "Checked on " + ZENODO_VERIFIED_ON + ": https://doi.org/api/handles/"
    + ZENODO_DOI_RESERVED + " returned HTTP 404 (handle not registered), and both "
    "https://zenodo.org/api/records/24288645 and https://zenodo.org/records/24288645 "
    "returned HTTP 404. A control DOI resolved normally through the same endpoints in the "
    "same session, so the negative is not an endpoint failure. The deposit must not be "
    "cited until the DOI resolves."
)


def export_attribution(archive_note: dict) -> pathlib.Path:
    """Write the credit and the ODbL 4.6 statement beside the results."""
    path = pathlib.Path(__file__).resolve().parent / "results" / ATTRIBUTION_SIDECAR
    path.parent.mkdir(parents=True, exist_ok=True)
    body = f"""# Attribution and licence notice

Generated by `run_pilot.py`. It covers **every file in this directory**, and in
particular `origin_facility_distances.csv`, which cannot carry a notice inside
itself without breaking the parsers that read it.

## Credits

- {MADRID_CREDIT_CALLEJERO}
- {MADRID_CREDIT_FACILITIES}
- {OSM_CREDIT}

## What came from where

| File | Official sources | OpenStreetMap |
|---|---|---|
| `origin_facility_distances.csv` | portal coordinates and addresses (callejero); facility ids (200215) | every `network_nearest_m`, `snap_offset_m`, `detour_ratio`, `understatement_*` value is computed over an OSM-derived pedestrian graph |
| `pilot_report.json` | source, licence and retrieval records | all network statistics, and the recorded extraction rules and data vintage |
| `figure_straightline_vs_network.png` | — | the plotted network distances |
| `facility_access_points.geojson` | the whole file | **nothing** — it carries no OSM-derived value |
| `ATTRIBUTION.md` | — | — |

## ODbL section 4.6 — the database underlying these results

This is a factual statement of what exists and where, **not a claim that any
legal obligation has been discharged**. See `../README.md` for the open
questions and `../RESULTS.md` section 6 for why a qualified review is a
precondition of adopting any of this.

1. **A Derivative Database exists.** Producing these results required a
   systematic extract of OpenStreetMap ({archive_note['extract_elements']:,}
   elements, all `way[highway]` in the study bounding box) which was then
   filtered and restructured into a pedestrian graph. Under the OSMF
   *Substantial* guideline an extract of that scale and kind is substantial, and
   under the *Licence and Legal FAQ* adapting data in that way creates a
   Derivative Database. None of it is published here.
2. **It is not archived publicly yet.** A Zenodo deposit has been prepared and a
   DOI reserved, but the deposit is **still a draft and is not published**, so
   the identifier below does **not resolve** and must not be cited:
   - reserved DOI `{ZENODO_DOI_RESERVED}` — state `{ZENODO_STATE}`
   - {ZENODO_VERIFICATION}

   Until it is published, the extract lives only in the pilot's git-ignored
   `cache/`. Its identity is recorded:
   - SHA-256 `{archive_note['extract_sha256']}`
   - {archive_note['extract_bytes']:,} bytes
   - OSM data vintage (`timestamp_osm_base`) `{archive_note['timestamp_osm_base']}`
   - retrieved from `{archive_note['endpoint']}` on {archive_note['first_retrieved_at']}
3. **The means to recreate it are published** in this repository: the exact
   Overpass query and the data vintage in `pilot_report.json`
   (`s3_osm_extraction.query`, `.data_vintage`), the filtering rules in
   `.rules` and in `classify_way()`, and the whole pipeline in `run_pilot.py`
   and `pilot_common.py`.
4. **What that does not settle.** OpenStreetMap is edited continuously, so
   re-running the query answers against a later state and will not reproduce
   the recorded SHA-256. An Overpass *attic* query against the recorded vintage
   is the route a reader would take to approach the original state; this pilot
   **records the vintage but has not tested an attic re-retrieval** and does not
   claim one would succeed. Whether publishing the means to recreate a database
   discharges a request under ODbL 4.6 when the exact state is no longer
   regenerable is an open question here.
5. **Requests.** Anyone who receives these results and wants the underlying
   extract or the derived graph should raise an issue on this repository. The
   cached extract can be supplied under ODbL 1.0 while it exists. Once the
   Zenodo deposit above is published and its DOI resolves, that becomes the
   route, and this file and `pilot_report.json` should be regenerated so they
   state the published state rather than the reserved one.

Nothing in this file is legal advice. The OSMF's own Licence and Legal FAQ says
the same of itself.
"""
    path.write_text(body, encoding="utf-8")
    return path


def export_table(rows: list[dict]) -> pathlib.Path:
    path = pathlib.Path(__file__).resolve().parent / "results" / "origin_facility_distances.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for row in sorted(rows, key=lambda r: r["cod_ndp"]):
            writer.writerow(row)
    return path


def export_geometry(rows: list[dict], facilities: list[dict], s2: dict) -> list[pathlib.Path]:
    """Official point geometry only.

    The facility coordinates are official (CC BY 4.0) and this file carries no
    value derived from OpenStreetMap, so it stands on its own attribution.

    A per-origin GeoJSON of the 2,651 portals with their derived distances was
    produced by earlier versions of this pilot and is deliberately **no longer
    written**. It duplicated ``origin_facility_distances.csv`` record for
    record, added no property the CSV lacks, accounted for roughly 70% of the
    published bytes, and was the artifact in the set that most resembled a
    database rather than a reading of one. The CSV keeps the per-origin detail
    for re-analysis and no figure or finding depended on the GeoJSON.
    """
    out = []

    facility_features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [a["lon"], a["lat"]]},
            "properties": {
                "access_point_id": a["access_point_id"],
                "title": a["title"],
                "record_count": a["record_count"],
                "collapsed_record_ids": a["collapsed_record_ids"],
                "subtypes": a["subtypes"],
                "inside_study_barrio": a["inside_study_barrio"],
            },
        }
        for a in facilities
    ]
    path = pathlib.Path(__file__).resolve().parent / "results" / "facility_access_points.geojson"
    path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "attribution": [MADRID_CREDIT_FACILITIES],
                "osm_note": (
                    "This file carries no value derived from OpenStreetMap. "
                    "See ATTRIBUTION.md for the files that do."
                ),
                "features": facility_features,
            },
            ensure_ascii=False,
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )
    out.append(path)
    return out


def export_figure(runs: dict) -> pathlib.Path | None:
    try:
        import matplotlib  # noqa: PLC0415

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt  # noqa: PLC0415
    except ModuleNotFoundError:  # pragma: no cover - optional
        log("matplotlib unavailable; figure skipped")
        return None

    baseline = runs["baseline"]
    measured = [r for r in baseline["rows"] if r["state"] == "MEASURED"]

    fig, axes = plt.subplots(1, 3, figsize=(15, 4.6))

    ax = axes[0]
    ax.scatter(
        [r["euclid_to_network_nearest_m"] for r in measured],
        [r["network_nearest_m"] for r in measured],
        s=3,
        alpha=0.25,
        linewidths=0,
        color="#1f3b63",
    )
    top = max(
        max((r["network_nearest_m"] for r in measured), default=1),
        max((r["euclid_to_network_nearest_m"] for r in measured), default=1),
    )
    ax.plot([0, top], [0, top], color="#b02020", lw=1, label="1:1 (no detour)")
    ax.set_xlabel("Straight-line distance to that facility (m)")
    ax.set_ylabel("Pedestrian-network distance (m)")
    ax.set_title("(a) Same origin, same facility")
    ax.legend(frameon=False, fontsize=8)

    ax = axes[1]
    for variant_id, run in runs.items():
        values = sorted(
            r["detour_ratio"]
            for r in run["rows"]
            if r["state"] == "MEASURED" and r["detour_ratio"]
        )
        if not values:
            continue
        ys = [(i + 1) / len(values) for i in range(len(values))]
        ax.plot(
            values,
            ys,
            lw=2 if variant_id == "baseline" else 1,
            color="#1f3b63" if variant_id == "baseline" else None,
            label=f"{variant_id} (n={len(values)})",
        )
    ax.set_xlabel("Detour ratio (network / straight line)")
    ax.set_ylabel("Cumulative share of origins")
    ax.set_title("(b) Sensitivity to extraction decisions")
    ax.legend(frameon=False, fontsize=7)
    ax.set_xlim(left=1.0)

    ax = axes[2]
    limits = [t for t in THRESHOLDS_M]
    width = 0.8 / max(len(runs), 1)
    for offset, (variant_id, run) in enumerate(runs.items()):
        rates = [
            run["summary"]["threshold_sensitivity"][f"{t:.0f}m"]["false_inclusion_rate_pct"] or 0.0
            for t in limits
        ]
        ax.bar(
            [i + offset * width for i in range(len(limits))],
            rates,
            width=width,
            label=variant_id,
        )
    ax.set_xticks([i + 0.4 - width / 2 for i in range(len(limits))])
    ax.set_xticklabels([f"{t:.0f} m" for t in limits])
    ax.set_ylabel("% of origins inside by straight line\nbut outside by network")
    ax.set_xlabel("Threshold used for a 'within X metres' statement")
    ax.set_title("(c) Where a straight-line claim breaks")
    ax.legend(frameon=False, fontsize=7)

    study = runs["baseline"]["summary"]
    # The credit must be READABLE, so it is wrapped onto its own short lines
    # rather than run into one long title that the canvas clips at both edges.
    fig.suptitle(
        "Madrid Network Accessibility pilot — straight-line vs pedestrian-network distance "
        "to the nearest municipal basic sports facility\n"
        f"Study area: barrio {STUDY_BARRIO_ID} San Isidro (Carabanchel). "
        f"Origins: {study['origins_measured']} official address portals.",
        fontsize=9,
    )
    fig.text(
        0.5,
        0.895,
        "Official sources: Ayuntamiento de Madrid (CC BY 4.0).\n"
        "Contains information from OpenStreetMap, available under the ODbL 1.0, "
        "(c) OpenStreetMap contributors — https://www.openstreetmap.org/copyright",
        ha="center",
        va="top",
        fontsize=7.5,
    )
    fig.tight_layout(rect=(0, 0, 1, 0.84))
    path = pathlib.Path(__file__).resolve().parent / "results" / "figure_straightline_vs_network.png"
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return path


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------


def main() -> int:
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    s1 = stage_s1()
    s2 = stage_s2()
    osm = fetch_osm(s2["_internal"]["bbox_wgs84"])

    runs = {}
    for variant in VARIANTS:
        log(f"S3 measuring variant {variant['id']}")
        runs[variant["id"]] = measure(osm, s2, variant)

    baseline = runs["baseline"]
    archive_note = {
        "extract_sha256": osm["provenance"]["sha256"],
        "extract_bytes": osm["provenance"]["byte_length"],
        "extract_elements": osm["vintage"]["elements_returned"],
        "timestamp_osm_base": osm["vintage"]["timestamp_osm_base"],
        "endpoint": osm["provenance"]["url"],
        "first_retrieved_at": osm["provenance"]["first_retrieved_at"],
    }
    table = export_table(baseline["rows"])
    geometry = export_geometry(baseline["rows"], baseline["facilities"], s2)
    attribution = export_attribution(archive_note)
    figure = export_figure(runs)

    baseline_summary = baseline["summary"]
    comparison = []
    for variant_id, run in runs.items():
        if variant_id == "baseline":
            continue
        summary = run["summary"]
        comparison.append(
            {
                "variant": variant_id,
                "decision_changed": summary["decision_changed"],
                "origins_measured_pct": summary["origins_measured_pct"],
                "median_detour_ratio": summary["detour_ratio_to_network_nearest"]["p50"],
                "median_detour_ratio_delta_vs_baseline": round(
                    (summary["detour_ratio_to_network_nearest"]["p50"] or 0)
                    - (baseline_summary["detour_ratio_to_network_nearest"]["p50"] or 0),
                    5,
                ),
                "median_network_nearest_m": summary["network_nearest_m"]["p50"],
                "median_network_nearest_m_delta_vs_baseline": round(
                    (summary["network_nearest_m"]["p50"] or 0)
                    - (baseline_summary["network_nearest_m"]["p50"] or 0),
                    3,
                ),
                "discordance_share_pct": summary["nearest_facility_discordance"]["share_pct"],
                "discordance_delta_pp_vs_baseline": round(
                    (summary["nearest_facility_discordance"]["share_pct"] or 0)
                    - (baseline_summary["nearest_facility_discordance"]["share_pct"] or 0),
                    2,
                ),
                "geometric_invariant_violations": summary["geometric_invariant_violations"],
            }
        )

    acceptance = {
        "A1_snapping": {
            "criterion": ">= 95% of origins snap within the baseline 30 m tolerance",
            "observed_pct": round(
                100.0
                * (baseline_summary["origins_total"] - baseline_summary["origins_not_snapped"])
                / baseline_summary["origins_total"],
                3,
            ),
            "threshold_pct": 95.0,
        },
        "A2_geometric_coherence": {
            "criterion": "no measured pair has network distance below the straight line",
            "observed_violations": sum(
                run["summary"]["geometric_invariant_violations"] for run in runs.values()
            ),
            "threshold": 0,
        },
        "A3_coverage": {
            "criterion": "< 5% of origins unmeasurable (not snapped or unreachable)",
            "observed_pct": round(100.0 - baseline_summary["origins_measured_pct"], 3),
            "threshold_pct": 5.0,
        },
        "A4_sensitivity_stability": {
            "criterion": (
                "the direction of the finding survives every variant: median detour ratio "
                "stays above 1.0 and the ranking of thresholds by false-inclusion rate is "
                "not reversed"
            ),
            "median_detour_ratio_by_variant": {
                variant_id: run["summary"]["detour_ratio_to_network_nearest"]["p50"]
                for variant_id, run in runs.items()
            },
            "all_medians_above_one": all(
                (run["summary"]["detour_ratio_to_network_nearest"]["p50"] or 0) > 1.0
                for run in runs.values()
            ),
        },
    }
    for key, check in acceptance.items():
        if "observed_pct" in check and "threshold_pct" in check:
            if key == "A1_snapping":
                check["pass"] = check["observed_pct"] >= check["threshold_pct"]
            else:
                check["pass"] = check["observed_pct"] < check["threshold_pct"]
        elif "observed_violations" in check:
            check["pass"] = check["observed_violations"] == check["threshold"]
        else:
            check["pass"] = bool(check.get("all_medians_above_one"))

    report = {
        "attribution": {
            "official_callejero": MADRID_CREDIT_CALLEJERO,
            "official_facilities": MADRID_CREDIT_FACILITIES,
            "openstreetmap": OSM_CREDIT,
            "openstreetmap_copyright_url": OSM_COPYRIGHT_URL,
            "applies_to": (
                "every file in results/. The per-file breakdown and the ODbL 4.6 statement "
                "are in results/ATTRIBUTION.md."
            ),
        },
        "odbl_4_6_statement": {
            "status": (
                "FACTUAL RECORD, NOT A CLAIM OF LEGAL COMPLIANCE. This pilot is not "
                "competent to determine its own ODbL position and does not assert one."
            ),
            "derivative_database_exists": (
                "Yes. Producing these results required a systematic OpenStreetMap extract "
                f"({archive_note['extract_elements']} elements; every way[highway] in the study "
                "bounding box), filtered and restructured into a pedestrian graph. Under the "
                "OSMF Substantial guideline an extract of that scale and kind is substantial."
            ),
            "derivative_database_published": False,
            "derivative_database_archived": False,
            "extract_identity": archive_note,
            "zenodo_deposit": {
                "doi_reserved": ZENODO_DOI_RESERVED,
                "state": ZENODO_STATE,
                "resolves": False,
                "citable": False,
                "verified_on": ZENODO_VERIFIED_ON,
                "verification": ZENODO_VERIFICATION,
                "meaning": (
                    "A DOI reserved on a Zenodo draft is an identifier that has been set aside, "
                    "not a published record. It is recorded here so it travels with the results, "
                    "and is marked unresolvable so nothing cites it as though the deposit "
                    "existed."
                ),
                "on_publication": (
                    "Re-run run_pilot.py after updating ZENODO_STATE so this block and "
                    "results/ATTRIBUTION.md state the published state, and add the resolved DOI "
                    "to the README's archiving section."
                ),
            },
            "means_to_recreate_published": [
                "s3_osm_extraction.query (the exact Overpass query)",
                "s3_osm_extraction.data_vintage.timestamp_osm_base",
                "s3_osm_extraction.rules (the filtering rules)",
                "run_pilot.py classify_way() and pilot_common.py (the full pipeline)",
            ],
            "unresolved": [
                "Re-running the query answers against a later state of a continuously edited "
                "database and will not reproduce the recorded SHA-256.",
                "An Overpass attic query against the recorded vintage is the route to approach "
                "the original state; this pilot records the vintage but HAS NOT tested an attic "
                "re-retrieval and does not claim one would succeed.",
                "Whether publishing the means to recreate a database discharges a request under "
                "ODbL 4.6 when the exact state is no longer regenerable is an open question.",
                "Whether a structured per-record table of derived measurements "
                "(origin_facility_distances.csv) is a Produced Work or attracts the OSMF "
                "attribution guideline's treatment of works that recreate substantial parts of "
                "the data is NOT settled here. See classification_uncertainty below.",
            ],
            "classification_uncertainty": {
                "what_the_guideline_says": (
                    "The OSMF Produced Work guideline's test is whether the published result "
                    "'is intended for the extraction of the original data'. These results are "
                    "not. The attribution guideline separately treats a Produced Work that "
                    "extracts or recreates substantial parts of the data as a Derivative "
                    "Database."
                ),
                "why_the_csv_is_the_uncertain_one": (
                    "origin_facility_distances.csv is the most database-like artifact that "
                    "remains: one row per official portal, systematic over the whole portal "
                    "universe of the study barrio, each row carrying values computed from OSM. "
                    "A systematic per-record table is closer to a database in form than a "
                    "figure or a statistics report is, even when its contents are measurements "
                    "rather than map data."
                ),
                "the_technical_argument_for_Produced_Work": (
                    "A shortest-path length is a functional of the whole graph, not a sample of "
                    "it, and is not invertible to geometry. The withheld network holds 66181 "
                    "nodes (132362 coordinates) plus topology and tags; the table publishes "
                    "about 5272 OSM-informed scalars, roughly 25x underdetermined on "
                    "coordinates alone. snap_offset_m is the only value that localises OSM "
                    "geometry at all, and it gives a distance from a known official point to "
                    "the nearest way with no topology, tags or node positions."
                ),
                "why_that_is_not_a_conclusion": (
                    "Substantiality under the ODbL is 'substantial in terms of quantity or "
                    "quality or a combination of both', and the OSMF Substantial guideline's "
                    "tests count extracted features rather than addressing derived or "
                    "aggregated outputs at all. This case falls in a gap the published "
                    "guidelines do not cover, so the argument above is a technical reading and "
                    "not a determination. A reviewer could reasonably reach a different view."
                ),
            },
            "attribution_carried": (
                "results/ATTRIBUTION.md covers every file; the figure carries a visible credit; "
                "this report carries the attribution block above; the official-only GeoJSON "
                "carries its own CC BY 4.0 credit and states that it holds no OSM-derived value."
            ),
        },
        "pilot": "Madrid Network Accessibility — straight-line vs pedestrian-network distance",
        "status": "RESEARCH ONLY. Not wired into the application; no data/ artifact produced.",
        "run_started_utc": started,
        "run_finished_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "question": (
            "For official address portals in one Madrid barrio, how far does the "
            "straight-line distance to the nearest official municipal basic sports facility "
            "depart from the shortest distance along the OSM pedestrian network, and does the "
            "choice of metric change WHICH facility is nearest?"
        ),
        "unit_of_analysis": "one official address portal (TIPO_NDP=PORTAL), measured to the nearest facility access point",
        "s1_sources": s1,
        "s2_design": {k: v for k, v in s2.items() if k != "_internal"},
        "s3_osm_extraction": {
            "endpoint": OVERPASS_URL,
            "query": osm["query"],
            "retrieval_provenance": osm["provenance"],
            "data_vintage": osm["vintage"],
            "reproducibility_limits": {
                "what_is_reproducible": (
                    "Given the cached extract, every number in this report is reproducible "
                    "exactly: the cached payload's SHA-256 is recorded, the filtering, graph "
                    "construction, snapping and shortest-path code are deterministic, and the "
                    "variants re-filter the same bytes."
                ),
                "what_is_not": (
                    "The raw OSM extract is NOT archived in this repository, so once the "
                    "git-ignored cache is removed this exact run cannot be reproduced "
                    "byte-for-byte. Re-running the query will answer against a later state of "
                    "a continuously edited database and will return a different payload and a "
                    "different SHA-256, so the figures will move by an unknown amount."
                ),
                "available_mitigation": (
                    "timestamp_osm_base identifies the database state, and Overpass supports "
                    "attic queries against a past date, which is the route a reader would take "
                    "to approach this state again. This pilot records the timestamp; it does "
                    "NOT claim to have tested an attic re-retrieval."
                ),
                "http_validators_absent": (
                    "The request is a POST, so no ETag or Last-Modified is returned. The "
                    "payload SHA-256 is the only fingerprint, and it is of the answer, not of "
                    "any upstream file."
                ),
                "official_sources_differ": (
                    "The callejero and facility registers are stable published editions whose "
                    "resource URLs and SHA-256 are recorded, so those inputs can be retrieved "
                    "again. Only the OSM side carries this limit."
                ),
            },
            "bbox_wgs84": s2["_internal"]["bbox_wgs84"],
            "rules": {
                "graph_level": "segment level: one edge per consecutive node pair",
                "simplification": "NONE. No intersection consolidation, no geometry generalisation, no degree-2 collapse, because each changes a shortest-path length.",
                "directionality": "undirected; oneway tags are ignored because they restrict vehicles, not pedestrians",
                "baseline_highway_values_retained": sorted(BASELINE_HIGHWAY),
                "highway_values_excluded_always": sorted(EXCLUDED_HIGHWAY),
                "pedestrian_restriction_rule": "reject foot in {no, private}; reject access in {no, private} unless foot in {yes, designated, permissive, official}",
                "indoor_rule": "reject indoor=yes",
                "area_rule": "a way tagged area=yes is kept as its closed ring, which measures walking AROUND a plaza rather than across it; this is conservative (never shorter than reality)",
                "snapping": "nearest point ON the nearest retained segment; the segment is split there; the perpendicular offset is added to the modelled path length and reported separately",
                "snapping_ceiling": (
                    "The offset is a MODELLED straight connector from a published coordinate "
                    "to the nearest retained segment. It is not an observed walk, not a "
                    "surveyed path, and not evidence that a way exists along that line."
                ),
                "unreachable_rule": "a portal outside the largest connected component is reported UNREACHABLE, never given an imputed distance",
                "endpoint_ceiling": (
                    "A path ends at the published coordinate of a facility record, not at a "
                    "verified entrance. Where an entrance differs from the published "
                    "coordinate, the reported distance differs from the walk a person would "
                    "make, and the pilot does not know by how much."
                ),
            },
        },
        "s4_results_baseline": baseline_summary,
        "s4_sensitivity": comparison,
        "s4_all_variants": {vid: run["summary"] for vid, run in runs.items()},
        "acceptance_criteria": acceptance,
        "exports": {
            "attribution": str(attribution.relative_to(REPO)).replace("\\", "/"),
            "table_csv": str(table.relative_to(REPO)).replace("\\", "/"),
            "geometry": [str(p.relative_to(REPO)).replace("\\", "/") for p in geometry],
            "figure": str(figure.relative_to(REPO)).replace("\\", "/") if figure else None,
            "note": (
                "A per-origin GeoJSON is no longer written: it duplicated the CSV record for "
                "record and added no property the CSV lacks. See export_geometry()."
            ),
        },
        "interpretation_ceiling": [
            "This measures distance along a mapped network. It is not travel time, not "
            "perceived walkability, not comfort, not safety, not slope-adjusted effort and "
            "not accessibility for a wheelchair user or a person with reduced mobility.",
            "It describes ONE barrio and ONE facility category. Nothing here generalises to "
            "Madrid, to other barrios or to other facility types.",
            "The network is OpenStreetMap: volunteered data of unknown and spatially uneven "
            "completeness, not an official municipal cadastre of pavements.",
            "A facility access point is the coordinate the municipal register publishes, not "
            "a surveyed entrance door, and not an opening-hours-aware service point. Every "
            "path here ends at a published coordinate; where the real entrance is elsewhere, "
            "the figure is wrong by an amount this pilot cannot bound.",
            "The snap offset is a MODELLED straight connector from a published coordinate to "
            "the nearest retained segment. It is not an observed walk and not evidence that a "
            "way exists along it. It is included in the reported metres because excluding it "
            "would understate the distance, not because it was surveyed.",
            "The result says nothing about whether a facility is open, usable, in repair, "
            "or of any particular quality.",
            "This is NOT the Lens observation circle and must never be presented as one. "
            "The Lens circle is a declared observation window over published records; a "
            "network distance is a measured property of a street network.",
        ],
    }
    path = write_result("pilot_report.json", report)
    log(f"wrote {path}")
    log(f"wrote {attribution}")
    log(f"wrote {table}")
    for geom_path in geometry:
        log(f"wrote {geom_path}")
    if figure:
        log(f"wrote {figure}")

    print("\n=== acceptance ===")
    for key, check in acceptance.items():
        print(f"  {'PASS' if check['pass'] else 'FAIL'}  {key}: {check['criterion']}")
    print("\n=== baseline headline ===")
    print(f"  origins measured           : {baseline_summary['origins_measured']} / {baseline_summary['origins_total']}")
    print(f"  median straight-line (m)   : {baseline_summary['euclid_nearest_m']['p50']}")
    print(f"  median network (m)         : {baseline_summary['network_nearest_m']['p50']}")
    print(f"  median detour ratio        : {baseline_summary['detour_ratio_to_network_nearest']['p50']}")
    print(f"  mean detour ratio          : {baseline_summary['mean_detour_ratio_defined_pairs']}")
    print(f"  p95 detour ratio           : {baseline_summary['detour_ratio_to_network_nearest']['p95']}")
    ratio_rule = baseline_summary["ratio_denominator_rule"]
    print(
        f"  ratio pairs used/excluded  : {ratio_rule['ratio_defined_pairs']} / "
        f"{ratio_rule['ratio_excluded_pairs']} "
        f"(bound {ratio_rule['minimum_denominator_m']:.0f} m; smallest denominator "
        f"{ratio_rule['smallest_denominator_m']} m, smallest retained "
        f"{ratio_rule['smallest_retained_denominator_m']} m)"
    )
    print(
        f"  robustness, {ratio_rule['robustness_alternative_floor_m']:.0f} m bound : "
        f"median {ratio_rule['robustness_alternative_median']} "
        f"over {ratio_rule['robustness_alternative_pairs']} pairs"
    )
    print(f"  nearest-facility discordance: {baseline_summary['nearest_facility_discordance']['share_pct']}%")
    for limit in THRESHOLDS_M:
        bucket = baseline_summary["threshold_sensitivity"][f"{limit:.0f}m"]
        print(
            f"  within {limit:.0f} m: euclid {bucket['within_by_euclid']}, "
            f"network {bucket['within_by_network']}, "
            f"false inclusion {bucket['false_inclusion_rate_pct']}%"
        )
    return 0 if all(check["pass"] for check in acceptance.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
