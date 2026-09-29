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
import re
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

# ~1.1 cm at Madrid's latitude. Rounding only reduces coordinate precision and
# noisy diffs; it removes no vertices and performs no geometry simplification.
#
# 7, not 6: at 6 decimals the rounding collapsed a handful of near-coincident
# vertices in the official geometry into ring self-intersections (district 08,
# barrios 086 and 105 became invalid while their full-precision source was
# valid). That is exactly the "precision policy needs review" signal the builder
# is meant to surface, so the policy was moved to 7 decimals, at which every
# official district and barrio stays valid and every barrio is still exactly
# covered by its parent district. The builder now fails rather than silently
# repairing if any rounded feature is invalid, so a future precision change that
# reintroduced the problem could not pass unnoticed.
COORD_DECIMALS = 7

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


# The official dataset version is stated in the Madrid Open Data description as
# "Versión de los datos v3.4.1". This is deterministic: it captures that exact
# phrase, so a version-looking token elsewhere in the notes cannot be mistaken
# for it. Returns "v3.4.1" (with the leading v normalised) or None.
VERSION_RE = re.compile(r"versi[oó]n\s+de\s+los\s+datos\s+v?\s*(\d+\.\d+(?:\.\d+)*)", re.IGNORECASE)


def parse_published_version(notes: str):
    if not notes:
        return None
    match = VERSION_RE.search(notes)
    return f"v{match.group(1)}" if match else None


def fetch_dataset_metadata() -> dict:
    """Read dataset-level version and catalogue metadata from CKAN.

    Two distinct concepts are captured separately and never conflated:

      - published_version: the official dataset version the authority states in
        its description ("Versión de los datos"). This is the meaningful
        geography-version identifier a future join should cite.
      - catalog_metadata_modified: the CKAN catalogue record's last-modified
        date. This is metadata about the catalogue entry, NOT the effective or
        edition date of the geometry, and must not be presented as one.

    The service exposes no effective date of the geometry itself (FCH_ALTA /
    FCH_BAJA come back null), so the geography carries no source period; the
    published version is what identifies the edition. The retrieval/build time is
    recorded separately by the caller.
    """
    metadata = {}
    for level, url in (("district", CKAN_DISTRICTS), ("barrio", CKAN_BARRIOS)):
        try:
            result = json.loads(_get(url))["result"]
            metadata[level] = {
                "dataset": result.get("title"),
                "published_version": parse_published_version(result.get("notes", "")),
                "catalog_metadata_modified": _date_only(result.get("metadata_modified")),
                "catalog_metadata_created": _date_only(result.get("metadata_created")),
                "license": result.get("license_title"),
                "license_id": result.get("license_id"),
            }
        except Exception as error:  # noqa: BLE001 - catalogue metadata is best-effort
            metadata[level] = {"error": f"could not read CKAN metadata: {error}"}
    return metadata


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


def _require_shapely():
    try:
        from shapely.geometry import mapping, shape
        from shapely.ops import unary_union
        from shapely.validation import explain_validity
    except ImportError as error:  # pragma: no cover - environment guard
        raise SystemExit(
            "shapely is required to build and validate the geometry "
            "(pip install shapely)"
        ) from error
    return mapping, shape, unary_union, explain_validity


def validate_source_geometry(features: list[dict], level: str) -> dict:
    """Require every official feature's (rounded) geometry to be genuinely valid.

    This is real geometry validity, not just a type/coordinate-range check. The
    official geometry is never silently repaired: an invalid feature fails the
    build, naming the level and official_id, so a bad regeneration (or a
    coordinate-precision policy that corrupts a valid source feature) surfaces
    rather than shipping an undocumented repaired geometry. Returns a map of
    official_id -> shapely geometry for reuse by the coverage and union checks.
    """
    _mapping, shape, _union, explain = _require_shapely()
    geoms = {}
    for feat in features:
        oid = feat["properties"]["official_id"]
        geom = shape(feat["geometry"])
        if geom.is_empty:
            raise SystemExit(f"{level} {oid}: geometry is empty")
        if geom.geom_type not in ("Polygon", "MultiPolygon"):
            raise SystemExit(f"{level} {oid}: geometry is {geom.geom_type}, not polygonal")
        if not geom.is_valid:
            raise SystemExit(
                f"{level} {oid}: geometry is not valid after {COORD_DECIMALS}-dp rounding "
                f"({explain(geom)}). The official source geometry is not silently repaired; "
                f"if rounding caused this, the coordinate-precision policy needs review."
            )
        geoms[oid] = geom
    return geoms


def enforce_barrio_coverage(barrios: list[dict], barrio_geoms: dict, district_geoms: dict) -> None:
    """Require every barrio to be spatially covered by its declared parent district.

    Attribute hierarchy stays authoritative; this is the geometry consistency
    check. Exact `covers` is required (no analytical buffer): a barrio must never
    be silently reassigned to another district on geometric grounds. A failure
    quantifies the out-of-parent area so a reviewer can judge it rather than
    having a tolerance introduced automatically.
    """
    for barrio in barrios:
        oid = barrio["properties"]["official_id"]
        parent = barrio["properties"]["parent_id"]
        pgeom = district_geoms.get(parent)
        if pgeom is None:
            raise SystemExit(f"barrio {oid}: declared parent district {parent} has no geometry")
        bgeom = barrio_geoms[oid]
        if not pgeom.covers(bgeom):
            outside = bgeom.difference(pgeom)
            raise SystemExit(
                f"barrio {oid}: geometry is not covered by declared parent district {parent} "
                f"(out-of-parent area {outside.area:.3e} deg^2, "
                f"{(outside.area / bgeom.area * 100) if bgeom.area else 0:.2e}% of the barrio). "
                f"Investigate before adding any tolerance; do not reassign the barrio."
            )


def derive_municipality(district_geoms: dict) -> tuple[dict, dict]:
    """Union the (already validated) official district polygons into the municipality."""
    mapping, _shape, unary_union, explain = _require_shapely()

    geoms = list(district_geoms.values())
    union = unary_union(geoms)
    if union.is_empty:
        raise SystemExit("district union is empty")
    if union.geom_type not in ("Polygon", "MultiPolygon"):
        raise SystemExit(f"district union produced unexpected geometry {union.geom_type!r}")
    if not union.is_valid:
        raise SystemExit(f"district union is not a valid geometry ({explain(union)})")

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

    rounded = round_coords(json.loads(json.dumps(mapping(union))))
    _mapping, shape, _union, explain = _require_shapely()
    rounded_geom = shape(rounded)
    if rounded_geom.is_empty or rounded_geom.geom_type not in ("Polygon", "MultiPolygon") or not rounded_geom.is_valid:
        raise SystemExit(f"derived municipality geometry is invalid after rounding ({explain(rounded_geom)})")

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
        "geometry": rounded,
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
    dataset_metadata = fetch_dataset_metadata()

    districts = build_districts(districts_raw)
    district_names = {f["properties"]["official_id"]: f["properties"]["official_name"] for f in districts}
    barrios = build_barrios(barrios_raw, district_names)

    # Real shapely validity for every official feature (no silent repair), then
    # the geometric hierarchy check, then the derived municipality. Any failure
    # raises SystemExit naming the offending feature.
    print("[geography] validating geometry with shapely ...")
    district_geoms = validate_source_geometry(districts, "district")
    barrio_geoms = validate_source_geometry(barrios, "barrio")
    enforce_barrio_coverage(barrios, barrio_geoms, district_geoms)

    print("[geography] deriving municipality boundary from district union ...")
    municipality, coherence = derive_municipality(district_geoms)

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
            "note": (
                "~1.1 cm; rounding only. No vertices removed, no geometry simplification. "
                "Every rounded feature is checked for real shapely validity at build time and "
                "the build fails rather than repairing the official geometry."
            ),
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
            "validated_by": [
                "attribute codes",
                "shapely covers(): every barrio geometry is contained by its declared parent district",
                "spatial containment of each barrio's interior point within its parent district (test suites)",
            ],
        },
        "municipality_geometry": {
            "method": "DERIVED_FROM_OFFICIAL_GEOMETRY",
            "how": "shapely unary_union of the 21 official district polygons. The service's TERMINO MUNICIPAL layer is a polyline, so no published municipality polygon exists to use directly.",
            "ine_municipal_code": INE_MADRID_MUNICIPAL_CODE,
            "union_coherence": coherence,
        },
        # Three distinct concepts, never conflated (this is the corrected model):
        #   published_version        - the authority's stated dataset version
        #   catalog_metadata_modified - the CKAN record's last-modified date only
        #   retrieved_at             - the build time (below)
        # No effective/edition date of the geometry is published, so the geography
        # has no source period; the published_version identifies the edition.
        "source_version": {
            "published_version_exposed": True,
            "geometry_effective_date_exposed": False,
            "datasets": dataset_metadata,
            "note": (
                "published_version is the official dataset version stated in the Madrid Open Data "
                "description ('Versión de los datos'). catalog_metadata_modified is only the CKAN "
                "catalogue record's last-modified date, NOT the geometry's edition or effective date, "
                "and must not be presented as one. retrieved_at is the build time. No effective date "
                "of the geometry is published, so this geography carries no source_period; a future "
                "join should cite the published version, e.g. 'Padron period X joined to Madrid "
                "barrio geography v3.4.1', never a catalogue modification timestamp."
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
