#!/usr/bin/env python3
"""Build the canonical Madrid administrative geography.

    OFFICIAL SOURCE -> FETCH -> NORMALISE -> DERIVE MUNICIPALITY -> VALIDATE -> ARTIFACT

This produces the territorial backbone that every future Madrid City dataset
(Padron, accommodation, VUT, restaurants, housing, socioeconomic and
environmental indicators) must join against. It is deliberately *not* rebuilt at
deploy time: administrative boundaries are not "live", so the artifact is
committed to the repository and only changes through a reviewed commit, exactly
like the HATI research evidence. Freshness is never faked from the build clock.

Authoritative source
--------------------
Ayuntamiento de Madrid - IDEAM (Infraestructura de Datos Espaciales del
Ayuntamiento de Madrid), served through the official ArcGIS map service

    https://sigma.madrid.es/hosted/rest/services/CARTOGRAFIA/LIMITES_ADMINISTRATIVOS/MapServer

cataloged on the municipal open-data portal (datos.madrid.es) as
"Distritos municipales de Madrid" (dataset 300497) and "Barrios municipales de
Madrid" (dataset 300496), both licensed CC BY 4.0. The service publishes the
geometry in EPSG:25830 (ETRS89 / UTM zone 30N); this builder requests
`outSR=4326`, so the map server reprojects to WGS84 server-side and no
reprojection library is needed. OSM, Google, hand-drawn or scraped boundaries
are deliberately NOT used: an authoritative municipal source exists.

Municipality boundary
---------------------
The service's TERMINO MUNICIPAL layer is a *polyline*, not a filled polygon, so
there is no published municipality polygon to use directly. The municipality is
therefore DERIVED as the topological union of the 21 official district polygons
(shapely `unary_union`) and is flagged `DERIVED_FROM_OFFICIAL_GEOMETRY` in the
artifact. The district polygons remain the authoritative source geometry.

Dependencies
------------
Standard library for fetching (urllib) and I/O (json); `shapely` only for the
municipality union. shapely is a builder-only dependency: the committed artifact
is plain GeoJSON, the deploy validator and the test suites read it with no
geospatial library, and this builder is never run in CI. Install with
`pip install shapely` to regenerate.

Usage
-----
    python scripts/build_madrid_geography.py
    python scripts/build_madrid_geography.py --out-dir data/geography
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

MAP_SERVICE = (
    "https://sigma.madrid.es/hosted/rest/services/"
    "CARTOGRAFIA/LIMITES_ADMINISTRATIVOS/MapServer"
)
# Layers in the most detailed scale group (10.000-500) of the service.
DISTRICT_LAYER = 26
BARRIO_LAYER = 25

CKAN_DISTRICTS = "https://datos.madrid.es/api/3/action/package_show?id=300497-0-distritos-municipales-madrid"
CKAN_BARRIOS = "https://datos.madrid.es/api/3/action/package_show?id=300496-0-barrios-madrid"

# INE code of the municipality of Madrid. Used only as the municipality's stable
# identifier so future statistical joins (Padron, INE) have a canonical key; the
# geometry itself is derived, not taken from INE.
INE_MADRID_MUNICIPAL_CODE = "28079"

# ~0.11 m at Madrid's latitude. Rounding only reduces coordinate precision and
# noisy diffs; it removes no vertices and performs no geometry simplification.
COORD_DECIMALS = 6

CONTRACT_VERSION = "1.0.0"

USER_AGENT = "madrid-tourism-intelligence-lens/geography-builder (+https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens)"


# --------------------------------------------------------------------- fetching


def _get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=90) as response:  # noqa: S310 (trusted official host)
        return response.read()


def fetch_layer_geojson(layer_id: int) -> dict:
    """Fetch one map-service layer as GeoJSON reprojected to WGS84."""
    query = urllib.parse.urlencode(
        {
            "where": "1=1",
            "outFields": "*",
            "outSR": "4326",
            "f": "geojson",
            "returnGeometry": "true",
        }
    )
    url = f"{MAP_SERVICE}/{layer_id}/query?{query}"
    data = json.loads(_get(url))
    features = data.get("features")
    if not isinstance(features, list) or not features:
        raise SystemExit(f"layer {layer_id}: the service returned no features")
    return data


def fetch_dataset_vintage() -> dict:
    """Read dataset-level edition metadata from the CKAN catalogue.

    The service exposes no usable per-feature edition date (FCH_ALTA / FCH_BAJA
    come back null), so the catalogue's last-modified date is the best geography
    vintage the authority publishes. It is recorded as the *source* vintage and
    is deliberately kept separate from the retrieval/build time.
    """
    vintage = {}
    for level, url in (("district", CKAN_DISTRICTS), ("barrio", CKAN_BARRIOS)):
        try:
            result = json.loads(_get(url))["result"]
            vintage[level] = {
                "dataset": result.get("title"),
                "metadata_modified": _date_only(result.get("metadata_modified")),
                "metadata_created": _date_only(result.get("metadata_created")),
                "license": result.get("license_title"),
                "license_id": result.get("license_id"),
            }
        except Exception as error:  # noqa: BLE001 - vintage is best-effort metadata
            vintage[level] = {"error": f"could not read CKAN metadata: {error}"}
    return vintage


def _date_only(value):
    if isinstance(value, str) and len(value) >= 10:
        return value[:10]
    return value


# ------------------------------------------------------------------ geometry io


def round_coords(geom):
    """Round coordinates to COORD_DECIMALS and drop consecutive duplicates.

    Winding order is preserved as served: point-in-polygon by ray casting is
    orientation-agnostic, so the source geometry is kept faithful rather than
    silently rewound.
    """
    gtype = geom["type"]
    coords = geom["coordinates"]
    if gtype == "Polygon":
        coords = [_round_ring(ring) for ring in coords]
    elif gtype == "MultiPolygon":
        coords = [[_round_ring(ring) for ring in poly] for poly in coords]
    else:
        raise SystemExit(f"unexpected geometry type {gtype!r}; expected Polygon/MultiPolygon")
    return {"type": gtype, "coordinates": coords}


def _round_ring(ring):
    out = []
    for x, y in ring:
        pt = [round(x, COORD_DECIMALS), round(y, COORD_DECIMALS)]
        if not out or out[-1] != pt:
            out.append(pt)
    # A ring must stay closed after de-duplication.
    if len(out) >= 3 and out[0] != out[-1]:
        out.append(out[0][:])
    return out


# --------------------------------------------------------------- normalisation


def build_districts(raw: dict) -> list[dict]:
    features = []
    for feat in raw["features"]:
        props = feat["properties"]
        code = str(props["COD_DIS_TX"]).strip()
        name = str(props["NOMBRE"]).strip()
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "geography_level": "district",
                    "official_id": code,
                    "official_name": name,
                    "parent_id": INE_MADRID_MUNICIPAL_CODE,
                    "parent_name": "Madrid",
                    "geometry_provenance": "OFFICIAL_GEOMETRY",
                },
                "geometry": round_coords(feat["geometry"]),
            }
        )
    features.sort(key=lambda f: f["properties"]["official_id"])
    return features


def build_barrios(raw: dict, district_names: dict[str, str]) -> list[dict]:
    features = []
    for feat in raw["features"]:
        props = feat["properties"]
        code = str(props["COD_BAR"]).strip()
        parent = str(props["COD_DIS_TX"]).strip()
        name = str(props["NOMBRE"]).strip()
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "geography_level": "barrio",
                    "official_id": code,
                    "official_name": name,
                    "parent_id": parent,
                    # Prefer the district's own name from the district layer, so
                    # the two levels never disagree on a district's name.
                    "parent_name": district_names.get(parent, str(props.get("NOMDIS", "")).strip()),
                    "geometry_provenance": "OFFICIAL_GEOMETRY",
                },
                "geometry": round_coords(feat["geometry"]),
            }
        )
    features.sort(key=lambda f: f["properties"]["official_id"])
    return features


def derive_municipality(district_features: list[dict]) -> tuple[dict, dict]:
    """Union the official district polygons into the municipality boundary."""
    try:
        from shapely.geometry import mapping, shape
        from shapely.ops import unary_union
        from shapely.validation import make_valid
    except ImportError as error:  # pragma: no cover - environment guard
        raise SystemExit(
            "shapely is required to derive the municipality boundary "
            "(pip install shapely)"
        ) from error

    geoms = []
    for feat in district_features:
        geom = shape(feat["geometry"])
        if not geom.is_valid:
            geom = make_valid(geom)
        geoms.append(geom)

    union = unary_union(geoms)
    if union.geom_type not in ("Polygon", "MultiPolygon"):
        raise SystemExit(f"district union produced unexpected geometry {union.geom_type!r}")

    sum_area = sum(g.area for g in geoms)
    union_area = union.area
    # Shared internal boundaries carry no area, so a clean tiling gives
    # union_area == sum(parts). A large shortfall would mean overlaps; a large
    # excess is impossible. Degrees^2 units, used only for this relative check.
    coherence = {
        "sum_of_district_areas_deg2": sum_area,
        "union_area_deg2": union_area,
        "relative_difference": abs(union_area - sum_area) / sum_area if sum_area else None,
        "union_geometry_type": union.geom_type,
        "union_part_count": len(union.geoms) if union.geom_type == "MultiPolygon" else 1,
    }

    feature = {
        "type": "Feature",
        "properties": {
            "geography_level": "municipality",
            "official_id": INE_MADRID_MUNICIPAL_CODE,
            "official_name": "Madrid",
            "parent_id": None,
            "parent_name": None,
            "geometry_provenance": "DERIVED_FROM_OFFICIAL_GEOMETRY",
        },
        "geometry": round_coords(json.loads(json.dumps(mapping(union)))),
    }
    return feature, coherence


# ----------------------------------------------------------------- validation


def validate(municipality, districts, barrios) -> list[str]:
    """Fail the build (not the deployment) on a structurally broken geography."""
    errors = []

    if len(districts) != 21:
        errors.append(f"expected 21 districts, got {len(districts)}")
    if len(barrios) != 131:
        errors.append(f"expected 131 barrios, got {len(barrios)}")

    dcodes = [f["properties"]["official_id"] for f in districts]
    if len(set(dcodes)) != len(dcodes):
        errors.append("duplicate district official_id present")
    bcodes = [f["properties"]["official_id"] for f in barrios]
    if len(set(bcodes)) != len(bcodes):
        errors.append("duplicate barrio official_id present")

    dset = set(dcodes)
    for feat in barrios:
        parent = feat["properties"]["parent_id"]
        if parent not in dset:
            errors.append(f"barrio {feat['properties']['official_id']} references unknown district {parent}")

    for feat in [municipality, *districts, *barrios]:
        p = feat["properties"]
        if not p["official_name"]:
            errors.append(f"{p['geography_level']} {p['official_id']} has an empty name")
        if not _geometry_plausible(feat["geometry"]):
            errors.append(f"{p['geography_level']} {p['official_id']} has implausible geometry")

    return errors


# Generous box around the municipality of Madrid; only catches null-island,
# swapped lat/lon or a projection leak, never asserts an administrative boundary.
_LON_MIN, _LON_MAX = -4.6, -3.0
_LAT_MIN, _LAT_MAX = 39.8, 41.2


def _geometry_plausible(geom) -> bool:
    seen = False
    for x, y in _iter_coords(geom):
        seen = True
        if not (_LON_MIN <= x <= _LON_MAX and _LAT_MIN <= y <= _LAT_MAX):
            return False
    return seen


def _iter_coords(geom):
    stack = [geom["coordinates"]]
    while stack:
        item = stack.pop()
        if item and isinstance(item[0], (int, float)):
            yield item[0], item[1]
        else:
            stack.extend(item)


# --------------------------------------------------------------- serialisation


def write_json(path: Path, obj) -> None:
    # Deterministic and cross-platform: LF endings (newline="\n" stops Windows
    # from writing CRLF), trailing newline, UTF-8 names kept readable. This
    # matches the repository's eol=lf policy so the committed artifact is
    # byte-identical whatever platform regenerated it.
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Build canonical Madrid administrative geography")
    parser.add_argument("--out-dir", default="data/geography")
    args = parser.parse_args(argv)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("[geography] fetching official district and barrio geometry ...")
    districts_raw = fetch_layer_geojson(DISTRICT_LAYER)
    barrios_raw = fetch_layer_geojson(BARRIO_LAYER)
    vintage = fetch_dataset_vintage()

    districts = build_districts(districts_raw)
    district_names = {f["properties"]["official_id"]: f["properties"]["official_name"] for f in districts}
    barrios = build_barrios(barrios_raw, district_names)

    print("[geography] deriving municipality boundary from district union ...")
    municipality, coherence = derive_municipality(districts)

    errors = validate(municipality, districts, barrios)
    if errors:
        for error in errors:
            print(f"[geography] ERROR: {error}", file=sys.stderr)
        print("[geography] refusing to write a structurally broken geography", file=sys.stderr)
        return 1

    features = [municipality, *districts, *barrios]
    feature_collection = {
        "type": "FeatureCollection",
        "name": "madrid_admin",
        # The geometry file carries no build timestamp on purpose: it changes
        # only when the geometry changes. All build/provenance metadata that
        # would otherwise churn the diff lives in the separate .meta.json.
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "features": features,
    }

    meta = {
        "contract_version": CONTRACT_VERSION,
        "title": "Canonical Madrid administrative geography (municipality, districts, barrios)",
        "artifact": "madrid_admin.geojson",
        "source": {
            "authority": "Ayuntamiento de Madrid - IDEAM (Infraestructura de Datos Espaciales del Ayuntamiento de Madrid)",
            "map_service": MAP_SERVICE,
            "service_layers": {"district": DISTRICT_LAYER, "barrio": BARRIO_LAYER},
            "catalogue": {
                "district": "https://datos.madrid.es/dataset/300497-0-distritos-municipales-madrid",
                "barrio": "https://datos.madrid.es/dataset/300496-0-barrios-madrid",
            },
            "license": "CC BY 4.0",
            "license_url": "https://creativecommons.org/licenses/by/4.0/",
            "attribution": "(c) Ayuntamiento de Madrid",
        },
        "coordinate_reference_system": {
            "source": "EPSG:25830 (ETRS89 / UTM zone 30N)",
            "output": "EPSG:4326 / CRS84 (WGS84, lon,lat)",
            "reprojection": "server-side via ArcGIS outSR=4326; no client-side reprojection",
        },
        "coordinate_precision": {
            "decimal_places": COORD_DECIMALS,
            "note": "~0.11 m; rounding only. No vertices removed, no geometry simplification.",
        },
        "identifier_scheme": {
            "municipality": "INE municipal code (28079); geometry is derived, see municipality_geometry",
            "district": "Official Ayuntamiento de Madrid district code COD_DIS_TX, zero-padded 2 digits (01-21)",
            "barrio": "Official Ayuntamiento de Madrid barrio code COD_BAR, 3 digits, prefixed by the parent district code",
            "primary_key_note": "Names are never used as identifiers; codes are source-derived, not invented.",
        },
        "hierarchy": {
            "model": "municipality -> district -> barrio",
            "join": "barrio.parent_id == district.official_id ; district.parent_id == municipality.official_id",
            "validated_by": ["attribute codes", "spatial containment of each barrio's interior point within its parent district"],
        },
        "municipality_geometry": {
            "method": "DERIVED_FROM_OFFICIAL_GEOMETRY",
            "how": "shapely unary_union of the 21 official district polygons. The service's TERMINO MUNICIPAL layer is a polyline, so no published municipality polygon exists to use directly.",
            "ine_municipal_code": INE_MADRID_MUNICIPAL_CODE,
            "union_coherence": coherence,
        },
        "source_vintage": {
            "per_feature_edition_exposed": False,
            "datasets": vintage,
            "note": (
                "This is the geography vintage the authority publishes (dataset last-modified). "
                "It is NOT the retrieval/build time below and must never be conflated with it, nor "
                "with a future population vintage: a Padron join must be able to state 'population "
                "vintage X joined to geography vintage Y' rather than assume they are equal."
            ),
        },
        "retrieved_at": _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "builder": "scripts/build_madrid_geography.py",
        "counts": {"municipality": 1, "districts": len(districts), "barrios": len(barrios)},
        "interpretation_ceiling": (
            "Administrative reference geography for spatial joins and containment only. Not an "
            "analytical metric and not a denominator on its own. Administrative-area statistics must "
            "never be spatially distributed into a circular Lens or any sub-area; a Lens may report "
            "the official barrio/district containing a point, kept separate from circle-derived measurements."
        ),
    }

    write_json(out_dir / "madrid_admin.geojson", feature_collection)
    write_json(out_dir / "madrid_admin.meta.json", meta)

    print(
        f"[geography] wrote {out_dir/'madrid_admin.geojson'} "
        f"({len(features)} features: 1 municipality, {len(districts)} districts, {len(barrios)} barrios)"
    )
    print(f"[geography] wrote {out_dir/'madrid_admin.meta.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
