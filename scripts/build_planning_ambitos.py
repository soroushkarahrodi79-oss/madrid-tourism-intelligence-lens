#!/usr/bin/env python3
"""Build the committed planning-ámbito geometry artifact (issue #68 / K6).

    CATALOGUED OFFICIAL SOURCE -> WFS DOWNLOAD -> CLASSIFY -> FILTER -> REPROJECT
    -> VERIFY (route equivalence + authority reprojection) -> FINGERPRINT -> ARTIFACT

Geometry and the official identifier ONLY. Every quantity and every development
state comes from the dated CC BY 4.0 XLS editions through
``scripts/build_ambito_development_state.py``; nothing numeric is ever taken from
this service (Gate L §23).

Retrieval route and reuse basis
-------------------------------
Gate L (#65) audited the ArcGIS layer
``DESARROLLO_URBANO_ACTUALIZADO/AMBITOS_PLANEAMIENTO_URBANISTICO/MapServer/0`` and
returned **MODIFY** on reuse: that service asserts an attribution string but no
licence and no reuse statement, and public reachability is not a reuse grant
(the permanent principle in docs/PRODUCT_SEMANTICS.md §6).

Issue #68's reuse-route clarification therefore requires the **catalogued**
Geoportal route to be verified first. The Ayuntamiento de Madrid Geoportal
metadata record

    Planeamiento Urbanístico. Modificaciones y desarrollos del PGOUM de 1997
    geoportal.madrid.es/IDEAM_WBGEOPORTAL/dataset.iam?id=ca62bee0-8ce1-11e9-90e1-dc4a3e81fab6

names the Dirección General de Planeamiento as resource contact, states the CRS
(EPSG:25830), links its public-access limitation field to the Ayuntamiento's
general reuse conditions, and publishes an **OGC WFS download service** alongside
an ESRI REST visualisation service. Its planning service carries the layer
``Ámbitos Ordenación``. Those general conditions expressly authorise reuse —
copying, dissemination, modification, adaptation, extraction, reordering and
combination, for commercial and non-commercial purposes — subject to citing the
source, stating the last-update date where the original carries one, not
distorting the information, not implying municipal endorsement, and preserving
the update-date and reuse-condition metadata. This builder honours all five.

This builder therefore acquires geometry through the **catalogued WFS download
service** and proves, at build time, that it is the same authoritative geometry
Gate L audited. The comparison is not optional: if the two routes are not
equivalent the build FAILS rather than silently substituting one for the other.

The mixed universe
------------------
The layer serves 765 features and is **not** "765 ámbitos" (Gate L §17). It mixes
planning ámbitos with Norma Zonal grade/level records and non-developable land
classes. This builder classifies every record by its official code family, keeps
only the ámbito-like universe, and reports every excluded record by class and
count. An unclassifiable code FAILS the build; nothing is discarded silently.

One correction to Gate L's preliminary split: Gate L's prefix regex omitted the
``US`` family and so counted ``US.04.10-RP`` (SOLANA DE VALDEBEBAS) among its
"other" records. The S1 estado edition publishes a full row for that code
(district 16 Hortaleza, Residencial, 1,096,164 m², four phase values), so it is a
planning ámbito on the publisher's own evidence and is included here. The
production split is 724 ámbito-like / 34 Norma Zonal grade / 7 non-developable
land class = 765, replacing Gate L's provisional 723 / 18 / 24.

CRS
---
Source CRS is **EPSG:25830** (ETRS89 / UTM zone 30N), confirmed from the WFS
capabilities, the REST service metadata and the Geoportal record. The artifact is
**EPSG:4326** for browser rendering. The transformation is explicit (pyproj,
``always_xy=True``), deterministic, recorded as a named pipeline in the metadata,
and VERIFIED against the publisher's own server-side reprojection: the builder
fetches the same features with ``outSR=4326`` from the catalogued REST layer and
fails if any transformed vertex deviates by more than ``MAX_REPROJECTION_DEVIATION_DEG``.
No CRS is ever guessed.

Coordinates are rounded to 7 decimal places (~1.1 cm at Madrid's latitude), the
same precision policy as scripts/build_madrid_geography.py. Rounding reduces
coordinate precision and noisy diffs only: it removes no vertex and performs no
geometry simplification, so topological containment is unchanged.

Runtime
-------
Nothing here runs in the browser. The artifact is committed and fingerprinted;
the application never calls sigma.madrid.es, datos.madrid.es or geoportal.madrid.es.

Dependencies
------------
``requests`` and ``pyproj``, both BUILDER-ONLY and imported lazily so this module
stays importable (and its pure logic stays testable) with the standard library
alone. Pinned in scripts/requirements-build.txt. Neither appears in package.json
and nothing in the application imports them.

Usage
-----
    python scripts/build_planning_ambitos.py
    python scripts/build_planning_ambitos.py --out-dir data/planning
    python scripts/build_planning_ambitos.py --skip-route-check   # diagnostics only
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import re
import sys
import urllib.parse
from pathlib import Path

CONTRACT_VERSION = "1.0.0"

# --------------------------------------------------------------- source identity

GEOPORTAL_METADATA_ID = "ca62bee0-8ce1-11e9-90e1-dc4a3e81fab6"
GEOPORTAL_DATASET_URL = (
    "https://geoportal.madrid.es/IDEAM_WBGEOPORTAL/dataset.iam?id=" + GEOPORTAL_METADATA_ID
)
GEOPORTAL_TITLE = "Planeamiento Urbanístico. Modificaciones y desarrollos del PGOUM de 1997."
GEOPORTAL_DOCU_UID = "{9CA9A128-7F18-4E34-B741-B14B344F9930}"

# The catalogued OGC WFS DOWNLOAD service — the production acquisition route.
WFS_SERVER = (
    "https://sigma.madrid.es/hosted/services/"
    "DESARROLLO_URBANO_ACTUALIZADO/PLANEAMIENTO_URBANISTICO/MapServer/WFSServer"
)
WFS_VERSION = "2.0.0"
WFS_TYPENAME = "PLANEAMIENTO_URBANISTICO:Ámbitos_Ordenación"

# The catalogued ESRI REST VISUALISATION service, same Geoportal record. Used only
# to verify the reprojection against the publisher's own server-side transform.
CATALOGUED_REST_LAYER = (
    "https://sigma.madrid.es/hosted/rest/services/"
    "DESARROLLO_URBANO_ACTUALIZADO/PLANEAMIENTO_URBANISTICO/MapServer/2"
)

# The service Gate L audited. Used only to prove route equivalence; never the
# production acquisition route, because it carries no catalogued reuse statement.
GATE_L_AUDITED_LAYER = (
    "https://sigma.madrid.es/hosted/rest/services/"
    "DESARROLLO_URBANO_ACTUALIZADO/AMBITOS_PLANEAMIENTO_URBANISTICO/MapServer/0"
)

REUSE_CONDITIONS_URL = "https://datos.madrid.es/pages/condiciones-generales-ayuntamiento-de-madrid"
ATTRIBUTION = "Origen de los datos: Ayuntamiento de Madrid"
RESOURCE_AUTHORITY = (
    "Ayuntamiento de Madrid. A.G. Urbanismo, Medio Ambiente y Movilidad. "
    "Dirección General de Planeamiento."
)

SOURCE_FIELD_CODE_WFS = "Etiqueta"
SOURCE_FIELD_DENOM_WFS = "Denominación"
SOURCE_FIELD_CODE_REST = "AMB_TX_ETIQ"
SOURCE_FIELD_DENOM_REST = "AMB_TX_DENOM"

SOURCE_EPSG = 25830
TARGET_EPSG = 4326
REPROJECTION_PIPELINE = "EPSG:25830 -> EPSG:4326 (pyproj Transformer, always_xy=True)"

# ~1.1 cm at Madrid's latitude. Precision only: no vertex is removed.
COORD_DECIMALS = 7

# The publisher's own server-side 25830 -> 4326 transform and ours must agree to
# well under a centimetre. 1e-7 degrees is ~1.1 cm; the observed agreement is far
# tighter. A larger deviation means a datum or axis-order disagreement, not noise.
MAX_REPROJECTION_DEVIATION_DEG = 1e-6

# Two routes are the same authoritative geometry when every code carries the same
# denomination and the same vertex set to 1 mm. GeoJSON Polygon vs MultiPolygon
# encoding of a single-part polygon is an encoding difference, not a geometry one.
ROUTE_EQUIVALENCE_TOLERANCE_M = 0.001

USER_AGENT = (
    "madrid-urban-evidence-lens/planning-ambito-builder "
    "(+https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens)"
)

# ------------------------------------------------------- pinned build observations

# Observations of the calibration run, pinned so a change in the official universe
# is a visible diff in a reviewed pull request rather than a silent one. They are
# recorded, not asserted: the publisher may legitimately add or remove an ámbito.
BASELINE_RAW_FEATURES = 765
BASELINE_CLASS_COUNTS = {
    "PLANNING_AMBITO": 724,
    "NORMA_ZONAL_GRADE": 34,
    "NON_DEVELOPABLE_LAND_CLASS": 7,
}
BASELINE_CALIBRATED_ON = "2026-10-06"

# An ENGINEERING guardrail against an ingestion collapse (a truncated response, a
# schema change, an upstream outage that still returns parseable GeoJSON). Set far
# below the observed count so legitimate source change passes and only an obvious
# collapse fails. It is not a claim about how many ámbitos Madrid has.
MIN_AMBITO_FEATURES = 600


# ============================================================ pure classification

# Documented ámbito code families. APE/API/APR (áreas de planeamiento específico /
# incorporado / remitido), AOE (área de ordenación especial), AE, AOD, UZP/UZPp
# (suelo urbanizable programado, and its Revisión Parcial re-identification), UZI,
# UNP/UNS and US. Every family is anchored at a dotted separator so a numeric Norma
# Zonal code can never be absorbed by a prefix match.
AMBITO_CODE_FAMILIES = (
    "APE", "API", "APR", "AOE", "AOD", "AE", "UZP", "UZPp", "UZI", "UNP", "UNS", "US",
)
_AMBITO_CODE = re.compile(
    r"^(?:" + "|".join(AMBITO_CODE_FAMILIES) + r")\.", re.IGNORECASE
)
# Norma Zonal grade / level records: "4", "1.1", "3.1.b", "7.2.e".
_NORMA_ZONAL = re.compile(r"^\d+(?:\.\d+)*(?:\.[A-Za-z]+)?$")
# Non-developable land classes: "NUC", "NUP.1" … "NUP.6".
_NON_DEVELOPABLE = re.compile(r"^(?:NUC|NUP)(?:\.\d+)?$", re.IGNORECASE)

RECORD_CLASSES = (
    "PLANNING_AMBITO",
    "NORMA_ZONAL_GRADE",
    "NON_DEVELOPABLE_LAND_CLASS",
    "UNCLASSIFIED_SOURCE_RECORD",
)


def classify_record_code(code):
    """Classify one source record by its official code, verbatim and exactly.

    The code is NEVER normalised: no case folding, no padding, no stripping of a
    ``-RP`` suffix. Gate L §21 established that ``-RP`` (Revisión Parcial) marks a
    DISTINCT ámbito — ``UZP.3.01`` was annulled by court sentence while
    ``UZPp.03.01-RP`` is its active replacement — so any normalisation that merged
    them would merge an annulled ámbito with its successor. The classification
    reads the prefix; it returns the class only, never a rewritten code.
    """
    text = "" if code is None else str(code).strip()
    if not text:
        return "UNCLASSIFIED_SOURCE_RECORD"
    if _NORMA_ZONAL.match(text):
        return "NORMA_ZONAL_GRADE"
    if _NON_DEVELOPABLE.match(text):
        return "NON_DEVELOPABLE_LAND_CLASS"
    if _AMBITO_CODE.match(text):
        return "PLANNING_AMBITO"
    return "UNCLASSIFIED_SOURCE_RECORD"


def iter_coordinates(geometry):
    """Yield every [x, y] pair of a Polygon/MultiPolygon, depth-independently."""
    stack = [geometry.get("coordinates") or []]
    while stack:
        item = stack.pop()
        if item and isinstance(item[0], (int, float)):
            yield item
        elif item and isinstance(item[0], list):
            stack.extend(item)


def count_vertices(geometry):
    return sum(1 for _ in iter_coordinates(geometry))


def round_geometry(geometry, decimals=COORD_DECIMALS):
    """Round coordinates in place-free fashion, preserving structure exactly.

    Precision policy only. No vertex is removed, no ring is closed or reopened and
    no geometry is simplified, so point-in-polygon containment is unchanged.
    """

    def walk(node):
        if node and isinstance(node[0], (int, float)):
            return [round(float(node[0]), decimals), round(float(node[1]), decimals)]
        return [walk(child) for child in node]

    return {"type": geometry["type"], "coordinates": walk(geometry["coordinates"])}


def vertex_key_set(geometry, decimals=3):
    """A geometry's vertex multiset at a given precision, sorted.

    Used to compare two retrieval routes without being sensitive to GeoJSON
    encoding differences (Polygon vs single-part MultiPolygon), ring start vertex
    or winding order — none of which change the geometry.
    """
    return sorted(
        (round(float(x), decimals), round(float(y), decimals))
        for x, y in iter_coordinates(geometry)
    )


def canonical_bytes(payload):
    """Deterministic UTF-8 serialisation used for every fingerprint."""
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def fingerprint(payload):
    return hashlib.sha256(canonical_bytes(payload)).hexdigest()


def now():
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ================================================================ lazy build deps


def _require_requests():
    try:
        import requests  # noqa: PLC0415
    except ImportError as error:  # pragma: no cover - environment dependent
        raise SystemExit(
            "requests is required to retrieve the official geometry "
            "(pip install -r scripts/requirements-build.txt)"
        ) from error
    return requests


def _require_pyproj():
    try:
        from pyproj import Transformer  # noqa: PLC0415
    except ImportError as error:  # pragma: no cover - environment dependent
        raise SystemExit(
            "pyproj is required for the explicit EPSG:25830 -> EPSG:4326 transformation "
            "(pip install -r scripts/requirements-build.txt)"
        ) from error
    return Transformer


# ===================================================================== retrieval


def _get(url, timeout=600):
    requests = _require_requests()
    response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=timeout)
    response.raise_for_status()
    return response


def wfs_get_feature_url(srs_name="urn:ogc:def:crs:EPSG::25830"):
    query = urllib.parse.urlencode(
        {
            "service": "WFS",
            "version": WFS_VERSION,
            "request": "GetFeature",
            "typeNames": WFS_TYPENAME,
            "outputFormat": "GEOJSON",
            "srsName": srs_name,
        },
        encoding="utf-8",
    )
    return f"{WFS_SERVER}?{query}"


def fetch_wfs_features():
    """Download the catalogued WFS feature collection in its native CRS.

    Returns (features, retrieval record). The retrieval record carries the exact
    request URL, the byte size, the SHA-256 of the response body and the HTTP
    validators, so the acquisition is reproducible and the bytes are identifiable.
    """
    url = wfs_get_feature_url()
    retrieved_at = now()
    response = _get(url)
    body = response.content
    payload = json.loads(body.decode("utf-8"))
    declared_crs = ((payload.get("crs") or {}).get("properties") or {}).get("name")
    features = payload.get("features") or []
    if not features:
        raise SystemExit("the catalogued WFS download service returned no features")
    # The response must state the CRS we asked for. A server that silently serves
    # another CRS would be a projection leak, and guessing is forbidden.
    if declared_crs and declared_crs.replace("EPSG::", "EPSG:") != f"EPSG:{SOURCE_EPSG}":
        raise SystemExit(
            f"the WFS response declares CRS {declared_crs!r}, not EPSG:{SOURCE_EPSG}; "
            "refusing to guess a coordinate reference system"
        )
    record = {
        "route": "OGC_WFS_GETFEATURE",
        "service": WFS_SERVER,
        "wfs_version": WFS_VERSION,
        "type_name": WFS_TYPENAME,
        "output_format": "GEOJSON",
        "request_url": url,
        "retrieved_at": retrieved_at,
        "http_last_modified": response.headers.get("Last-Modified"),
        "etag": response.headers.get("ETag"),
        "content_type": response.headers.get("Content-Type"),
        "response_bytes": len(body),
        "response_sha256": hashlib.sha256(body).hexdigest(),
        "declared_crs": declared_crs,
    }
    return features, record


def fetch_rest_features(layer, out_sr=SOURCE_EPSG, page=2000):
    """Page an ArcGIS REST layer as GeoJSON. Verification only, never production."""
    features = []
    offset = 0
    while True:
        query = urllib.parse.urlencode(
            {
                "where": "1=1",
                "outFields": f"{SOURCE_FIELD_CODE_REST},{SOURCE_FIELD_DENOM_REST}",
                "returnGeometry": "true",
                "outSR": str(out_sr),
                "resultOffset": str(offset),
                "resultRecordCount": str(page),
                "f": "geojson",
            }
        )
        batch = json.loads(_get(f"{layer}/query?{query}").content.decode("utf-8")).get("features") or []
        features.extend(batch)
        if len(batch) < page:
            return features
        offset += page


def service_metadata(url):
    return json.loads(_get(f"{url}?f=json", timeout=120).content.decode("utf-8"))


# ============================================================ route verification


def compare_routes(wfs_features, audited_features):
    """Prove the catalogued route serves the same authoritative geometry Gate L audited.

    Compares, for every official code: presence, verbatim denomination, and the
    vertex multiset to 1 mm. Returns a frozen report. ``equivalent`` is the gate:
    a false value is the issue's STOP condition and the caller must not commit an
    artifact built from a route it could not match.
    """
    def index(features, code_field, denom_field):
        out = {}
        for feature in features:
            properties = feature.get("properties") or {}
            code = properties.get(code_field)
            out.setdefault("" if code is None else str(code), []).append(
                {
                    "denomination": properties.get(denom_field),
                    "vertices": vertex_key_set(feature.get("geometry") or {}),
                    "geometry_type": (feature.get("geometry") or {}).get("type"),
                }
            )
        return out

    catalogued = index(wfs_features, SOURCE_FIELD_CODE_WFS, SOURCE_FIELD_DENOM_WFS)
    audited = index(audited_features, SOURCE_FIELD_CODE_REST, SOURCE_FIELD_DENOM_REST)

    only_catalogued = sorted(set(catalogued) - set(audited))
    only_audited = sorted(set(audited) - set(catalogued))
    denomination_differences = []
    geometry_differences = []
    for code in sorted(set(catalogued) & set(audited)):
        left, right = catalogued[code], audited[code]
        if len(left) != len(right):
            geometry_differences.append({"code": code, "reason": "different number of features"})
            continue
        left_sorted = sorted(left, key=lambda item: item["vertices"])
        right_sorted = sorted(right, key=lambda item: item["vertices"])
        for a, b in zip(left_sorted, right_sorted):
            if a["denomination"] != b["denomination"]:
                denomination_differences.append(
                    {"code": code, "catalogued": a["denomination"], "audited": b["denomination"]}
                )
            if a["vertices"] != b["vertices"]:
                geometry_differences.append({"code": code, "reason": "vertex sets differ beyond 1 mm"})

    equivalent = not (only_catalogued or only_audited or denomination_differences or geometry_differences)
    rp_catalogued = sorted(code for code in catalogued if code.upper().endswith("-RP"))
    rp_audited = sorted(code for code in audited if code.upper().endswith("-RP"))
    return {
        "question": (
            "Is the catalogued Geoportal/WFS 'Ámbitos Ordenación' geometry the same "
            "authoritative geometry Gate L audited on AMBITOS_PLANEAMIENTO_URBANISTICO?"
        ),
        "catalogued_route": WFS_SERVER,
        "audited_route": GATE_L_AUDITED_LAYER,
        "catalogued_feature_count": len(wfs_features),
        "audited_feature_count": len(audited_features),
        "catalogued_distinct_codes": len(catalogued),
        "audited_distinct_codes": len(audited),
        "catalogued_vertices": sum(count_vertices(f.get("geometry") or {}) for f in wfs_features),
        "audited_vertices": sum(count_vertices(f.get("geometry") or {}) for f in audited_features),
        "codes_only_in_catalogued": only_catalogued,
        "codes_only_in_audited": only_audited,
        "denomination_differences": denomination_differences,
        "geometry_differences": geometry_differences,
        "vertex_tolerance_m": ROUTE_EQUIVALENCE_TOLERANCE_M,
        "rp_identity": {
            "rp_codes_in_catalogued_route": len(rp_catalogued),
            "rp_codes_in_audited_route": len(rp_audited),
            "rp_code_sets_identical": rp_catalogued == rp_audited,
            "rp_codes": rp_catalogued,
            "valdecarros_evidence": {
                "UZP.3.01_present": "UZP.3.01" in catalogued,
                "UZPp.03.01-RP_present": "UZPp.03.01-RP" in catalogued,
                "note": (
                    "Gate L §21: UZP.3.01 (Valdecarros) is listed by the structure annex as "
                    "annulled by court sentence, while UZPp.03.01-RP is its active replacement in "
                    "the geometry. Both routes agree: the annulled code is absent and the Revisión "
                    "Parcial code is present. -RP is a distinct ámbito and the suffix is never "
                    "stripped."
                ),
            },
        },
        "encoding_difference": (
            "The WFS encodes every feature as MultiPolygon; the REST route encodes a "
            "single-part feature as Polygon. That is a GeoJSON encoding difference, not a "
            "geometry difference, and the vertex-set comparison is insensitive to it."
        ),
        "equivalent": equivalent,
        "verdict": "AUTHORITATIVE_EQUIVALENCE_ESTABLISHED" if equivalent else "NOT_EQUIVALENT",
    }


def verify_reprojection(transformed_by_code, authority_features):
    """Check our explicit transform against the publisher's own server-side one.

    ``transformed_by_code`` maps an official code to the vertex multiset (6 dp) our
    pyproj pipeline produced. ``authority_features`` are the same features fetched
    with ``outSR=4326``, i.e. reprojected by the authority's server. The maximum
    per-vertex deviation is recorded and gated, so the transformation is not merely
    documented but checked against the source of truth for it.
    """
    authority = {}
    for feature in authority_features:
        code = (feature.get("properties") or {}).get(SOURCE_FIELD_CODE_REST)
        authority.setdefault("" if code is None else str(code), []).extend(
            vertex_key_set(feature.get("geometry") or {}, decimals=9)
        )

    worst = 0.0
    worst_code = None
    compared = 0
    missing = []
    for code, ours in transformed_by_code.items():
        theirs = authority.get(code)
        if theirs is None:
            missing.append(code)
            continue
        mine = sorted(ours)
        yours = sorted(theirs)
        if len(mine) != len(yours):
            missing.append(code)
            continue
        for (ax, ay), (bx, by) in zip(mine, yours):
            deviation = max(abs(ax - bx), abs(ay - by))
            compared += 1
            if deviation > worst:
                worst = deviation
                worst_code = code
    return {
        "method": REPROJECTION_PIPELINE,
        "verified_against": f"{CATALOGUED_REST_LAYER} (outSR={TARGET_EPSG}, publisher server-side transform)",
        "vertices_compared": compared,
        "codes_not_compared": sorted(missing),
        "max_deviation_deg": worst,
        "max_deviation_code": worst_code,
        "tolerance_deg": MAX_REPROJECTION_DEVIATION_DEG,
        "within_tolerance": worst <= MAX_REPROJECTION_DEVIATION_DEG and not missing,
    }


# ========================================================================= build


def build(out_dir, skip_route_check=False):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("[ambitos] retrieving the catalogued WFS download service ...")
    wfs_features, retrieval = fetch_wfs_features()
    raw_count = len(wfs_features)
    print(f"[ambitos] {raw_count} raw features, {retrieval['response_bytes']} bytes")

    # ---- classify the mixed universe; nothing is discarded silently -------------
    classified = {name: [] for name in RECORD_CLASSES}
    for feature in wfs_features:
        properties = feature.get("properties") or {}
        code = properties.get(SOURCE_FIELD_CODE_WFS)
        classified[classify_record_code(code)].append(feature)

    excluded = {
        name: {
            "count": len(classified[name]),
            "codes": sorted(
                "" if (f.get("properties") or {}).get(SOURCE_FIELD_CODE_WFS) is None
                else str((f.get("properties") or {}).get(SOURCE_FIELD_CODE_WFS))
                for f in classified[name]
            ),
            "reason": _EXCLUSION_REASONS[name],
        }
        for name in RECORD_CLASSES
        if name != "PLANNING_AMBITO"
    }
    for name, record in excluded.items():
        print(f"[ambitos] excluded {record['count']:>3} {name}")

    unclassified = excluded["UNCLASSIFIED_SOURCE_RECORD"]
    if unclassified["count"]:
        raise SystemExit(
            "the official layer carries "
            f"{unclassified['count']} record(s) whose code matches no documented class: "
            f"{', '.join(unclassified['codes'])}. "
            "Classify them against the publisher's structure documentation and update "
            "AMBITO_CODE_FAMILIES; a record is never silently discarded and never "
            "silently admitted."
        )

    ambito_features = classified["PLANNING_AMBITO"]
    if len(ambito_features) < MIN_AMBITO_FEATURES:
        raise SystemExit(
            f"only {len(ambito_features)} ámbito-like features survived classification "
            f"(engineering guardrail {MIN_AMBITO_FEATURES}); this looks like an ingestion "
            "collapse rather than a change in the official universe"
        )

    # ---- route equivalence: the issue's STOP condition, enforced in code --------
    if skip_route_check:
        route_report = {
            "equivalent": None,
            "verdict": "NOT_CHECKED",
            "note": "--skip-route-check was passed; this artifact must not be committed.",
        }
        print("[ambitos] WARNING route equivalence check skipped (diagnostics only)")
    else:
        print("[ambitos] verifying route equivalence against the Gate-L-audited service ...")
        route_report = compare_routes(wfs_features, fetch_rest_features(GATE_L_AUDITED_LAYER))
        if not route_report["equivalent"]:
            raise SystemExit(
                "STOP - geometry provenance/reuse unresolved. The catalogued Geoportal/WFS "
                "route and the Gate-L-audited service are NOT the same geometry: "
                f"{len(route_report['codes_only_in_catalogued'])} code(s) only in the catalogued "
                f"route, {len(route_report['codes_only_in_audited'])} only in the audited route, "
                f"{len(route_report['denomination_differences'])} denomination difference(s), "
                f"{len(route_report['geometry_differences'])} geometry difference(s). "
                "Do not substitute one route for the other; resolve the mismatch first."
            )
        print(
            f"[ambitos] routes equivalent: {route_report['catalogued_feature_count']} features, "
            f"{route_report['catalogued_vertices']} vertices on both"
        )

    # ---- explicit, deterministic reprojection ----------------------------------
    print(f"[ambitos] reprojecting EPSG:{SOURCE_EPSG} -> EPSG:{TARGET_EPSG} ...")
    Transformer = _require_pyproj()
    transformer = Transformer.from_crs(f"EPSG:{SOURCE_EPSG}", f"EPSG:{TARGET_EPSG}", always_xy=True)

    out_features = []
    transformed_by_code = {}
    source_vertices = 0
    for feature in ambito_features:
        properties = feature.get("properties") or {}
        code = str(properties.get(SOURCE_FIELD_CODE_WFS))
        geometry = feature.get("geometry") or {}
        if geometry.get("type") not in ("Polygon", "MultiPolygon"):
            raise SystemExit(f"ámbito {code}: unexpected geometry type {geometry.get('type')!r}")
        source_vertices += count_vertices(geometry)

        def project(node):
            if node and isinstance(node[0], (int, float)):
                lon, lat = transformer.transform(float(node[0]), float(node[1]))
                return [lon, lat]
            return [project(child) for child in node]

        projected = {"type": geometry["type"], "coordinates": project(geometry["coordinates"])}
        transformed_by_code.setdefault(code, []).extend(vertex_key_set(projected, decimals=9))
        rounded = round_geometry(projected)
        out_features.append(
            {
                "type": "Feature",
                "properties": {
                    # The exact official code, verbatim. Never normalised, never
                    # stripped of a -RP suffix: it is the join key to the editions.
                    "ambito_code": code,
                    "ambito_denomination": properties.get(SOURCE_FIELD_DENOM_WFS),
                    "source_record_class": "PLANNING_AMBITO",
                },
                "geometry": rounded,
            }
        )

    # Deterministic order so a rebuild produces a byte-identical artifact.
    out_features.sort(key=lambda f: f["properties"]["ambito_code"])
    codes = [f["properties"]["ambito_code"] for f in out_features]
    duplicates = sorted({code for code in codes if codes.count(code) > 1})
    if duplicates:
        raise SystemExit(
            f"duplicate ámbito code(s) in the official geometry: {', '.join(duplicates)}. "
            "The production universe keys on the exact official code and cannot carry two "
            "features under one code without a documented basis."
        )

    # ---- verify the transformation against the authority ------------------------
    if skip_route_check:
        reprojection_report = {"within_tolerance": None, "note": "skipped with --skip-route-check"}
    else:
        print("[ambitos] verifying the reprojection against the publisher's own transform ...")
        reprojection_report = verify_reprojection(
            transformed_by_code, fetch_rest_features(CATALOGUED_REST_LAYER, out_sr=TARGET_EPSG)
        )
        if not reprojection_report["within_tolerance"]:
            raise SystemExit(
                "the explicit EPSG:25830 -> EPSG:4326 transformation disagrees with the "
                f"publisher's own server-side reprojection by {reprojection_report['max_deviation_deg']} "
                f"degrees (tolerance {MAX_REPROJECTION_DEVIATION_DEG}) at code "
                f"{reprojection_report['max_deviation_code']!r}. A datum or axis-order "
                "disagreement must be resolved, never rounded away."
            )
        print(
            f"[ambitos] reprojection verified: max deviation "
            f"{reprojection_report['max_deviation_deg']:.3e} deg over "
            f"{reprojection_report['vertices_compared']} vertices"
        )

    artifact = {"type": "FeatureCollection", "features": out_features}
    artifact_fingerprint = fingerprint(artifact)
    out_vertices = sum(count_vertices(f["geometry"]) for f in out_features)

    # Bounding box of the production universe, as an integrity observation only.
    lons = []
    lats = []
    for feature in out_features:
        for lon, lat in iter_coordinates(feature["geometry"]):
            lons.append(lon)
            lats.append(lat)

    meta = {
        "contract_version": CONTRACT_VERSION,
        "artifact": "madrid_ambitos.geojson",
        "generated_at": now(),
        "builder": "scripts/build_planning_ambitos.py",
        "gate": "Gate L (#65) source contract; issue #68 (K6) production increment",
        "what_this_is": (
            "Official planning-ámbito polygon geometry and the exact official ámbito code, "
            "for the municipality of Madrid. GEOMETRY AND IDENTIFIER ONLY: no quantity and no "
            "development state is taken from this service. Every state and every buildability "
            "figure comes from the dated CC BY 4.0 XLS editions through "
            "scripts/build_ambito_development_state.py."
        ),
        "source": {
            "catalogue": "Geoportal del Ayuntamiento de Madrid (IDEAM)",
            "catalogue_record_title": GEOPORTAL_TITLE,
            "catalogue_record_url": GEOPORTAL_DATASET_URL,
            "catalogue_record_identifier": GEOPORTAL_METADATA_ID,
            "catalogue_record_docu_uid": GEOPORTAL_DOCU_UID,
            "catalogue_declared_crs": f"EPSG:{SOURCE_EPSG}",
            "catalogue_metadata_contact": (
                "Ayuntamiento de Madrid. A.G. Urbanismo, Medio Ambiente y Movilidad. "
                "Subdirección General de Innovación e Información Urbana"
            ),
            "authority": RESOURCE_AUTHORITY,
            "layer": "Ámbitos Ordenación",
            "service_copyright_text": (
                "Ayto. Madrid. Área de Desarrollo Urbano. SG Innovación e Información Urbana"
            ),
        },
        "retrieval": retrieval,
        "retrieval_route_rationale": (
            "The catalogued OGC WFS download service is preferred over the raw ArcGIS endpoint "
            "Gate L audited because the Geoportal metadata record for this resource explicitly "
            "links its public-access limitation field to the Ayuntamiento's general reuse "
            "conditions and designates a download service. Gate L returned MODIFY on the raw "
            "endpoint's reuse basis precisely because that endpoint carries attribution but no "
            "licence or reuse statement, and public reachability is not a reuse grant."
        ),
        "reuse": {
            "basis": "AYUNTAMIENTO_DE_MADRID_GENERAL_REUSE_CONDITIONS",
            "conditions_url": REUSE_CONDITIONS_URL,
            "conditions_linked_from": (
                "the Geoportal catalogue record's 'Limitaciones de acceso público' field"
            ),
            "grant": (
                "The general conditions authorise reuse of the documents and data subject to them "
                "for commercial and non-commercial purposes, including copying, dissemination, "
                "modification, adaptation, extraction, reordering and combination."
            ),
            "obligations_observed": [
                "the source is cited (attribution below) wherever this geometry is published",
                "the information's meaning is not distorted: geometry and identifier only, no "
                "quantity and no state is read from this service",
                "no municipal participation, sponsorship or endorsement is indicated or implied",
                "the reuse-condition and update-date metadata is preserved in this record and "
                "carried into data/source_registry.json",
                "the publisher declares no last-update date for this resource, which is recorded "
                "as an explicit null rather than back-filled",
            ],
            "attribution": ATTRIBUTION,
            "attribution_full": f"{ATTRIBUTION} ({RESOURCE_AUTHORITY})",
            "wfs_access_constraints_declared": "https://datos.madrid.es/egob/catalogo/aviso-legal",
            "wfs_access_constraints_observed": (
                "The WFS capabilities document's own ows:AccessConstraints URL returned HTTP 404 "
                "when checked on 2026-10-06. The Geoportal catalogue record's reuse-conditions "
                "link resolves and is therefore the authoritative reuse pointer used here. The "
                "dead link is recorded, not corrected."
            ),
            "gate_l_verdict_on_raw_endpoint": "MODIFY (attribution asserted, no licence statement)",
            "resolution": (
                "RESOLVED FOR THE CATALOGUED ROUTE. The catalogued route is proven to serve the "
                "same authoritative geometry and its catalogue record states the reuse conditions."
            ),
        },
        "freshness": {
            "reference_date": None,
            "reference_date_note": (
                "The publisher declares no reference date, no effective date and no edition date "
                "for this geometry: the layer exposes no editingInfo and no lastEditDate (Gate L "
                "§19). The null is KNOWN ABSENCE and is never back-filled from the catalogue "
                "record's creation date, the HTTP headers or the retrieval clock."
            ),
            "published_at": None,
            "retrieved_at": retrieval["retrieved_at"],
            "update_frequency": "NONE_DECLARED",
            "source_state": "NOT_DECLARED_BY_PUBLISHER",
            "observed_resource_state": {
                "http_last_modified": retrieval["http_last_modified"],
                "etag": retrieval["etag"],
                "response_sha256": retrieval["response_sha256"],
                "note": (
                    "An observed state of the resource as served, not a publisher statement about "
                    "the geometry's currency. It must never be presented as a reference date."
                ),
            },
        },
        "crs": {
            "source": f"EPSG:{SOURCE_EPSG}",
            "source_confirmed_from": [
                "WFS 2.0.0 GetCapabilities DefaultCRS urn:ogc:def:crs:EPSG::25830",
                "the GetFeature response's own declared CRS",
                "the catalogued REST service metadata spatialReference.wkid",
                "the Geoportal catalogue record's 'Sistema de Referencia de Coordenadas' field",
            ],
            "target": f"EPSG:{TARGET_EPSG}",
            "transformation": REPROJECTION_PIPELINE,
            "transformation_is_client_side": True,
            "verification": reprojection_report,
            "coordinate_decimals": COORD_DECIMALS,
            "coordinate_precision_note": (
                "Rounding to 7 decimal places (~1.1 cm at Madrid's latitude) reduces coordinate "
                "precision and diff noise only. No vertex is removed and no geometry is "
                "simplified, so topological containment is unchanged."
            ),
            "simplification": "NONE",
        },
        "route_equivalence": route_report,
        "universe": {
            "raw_feature_count": raw_count,
            "raw_feature_count_is_not_the_ambito_count": (
                "The official layer is a MIXED universe. The raw feature count is NOT a count of "
                "planning ámbitos and the phrase '765 ámbitos' is prohibited wording."
            ),
            "included_class": "PLANNING_AMBITO",
            "included_feature_count": len(out_features),
            "excluded_total": raw_count - len(out_features),
            "excluded_by_class": excluded,
            "classification_rule": (
                "Each record is classified by its exact official code: a documented ámbito code "
                "family (" + ", ".join(AMBITO_CODE_FAMILIES) + ") anchored at a dotted separator; "
                "a Norma Zonal grade/level code (purely numeric, dotted, optionally with a level "
                "letter); a non-developable land class (NUC, NUP.n); otherwise UNCLASSIFIED, which "
                "FAILS the build. Codes are never normalised for classification."
            ),
            "gate_l_correction": (
                "Gate L §17 reported a provisional split of 723 ámbito-like / 18 Norma Zonal / 24 "
                "other. Its prefix regex omitted the US family, so US.04.10-RP (SOLANA DE "
                "VALDEBEBAS) fell into 'other' although the S1 estado edition publishes a full row "
                "for it. The production split is "
                f"{BASELINE_CLASS_COUNTS['PLANNING_AMBITO']} ámbito-like / "
                f"{BASELINE_CLASS_COUNTS['NORMA_ZONAL_GRADE']} Norma Zonal grade / "
                f"{BASELINE_CLASS_COUNTS['NON_DEVELOPABLE_LAND_CLASS']} non-developable land class, "
                "and the 41 excluded records are all land-classification records rather than ámbitos."
            ),
            "baseline": {
                "raw_feature_count": BASELINE_RAW_FEATURES,
                "class_counts": BASELINE_CLASS_COUNTS,
                "calibrated_on": BASELINE_CALIBRATED_ON,
                "note": (
                    "Observations of the calibration run, pinned so a change in the official "
                    "universe is a visible diff in a reviewed pull request. They are recorded, not "
                    "asserted: the publisher may legitimately add or remove an ámbito."
                ),
            },
            "engineering_guardrail": {
                "min_ambito_features": MIN_AMBITO_FEATURES,
                "note": (
                    "A guard against an ingestion collapse, set far below the observed count. Not "
                    "an analytical threshold and not a claim about Madrid's ámbito count."
                ),
            },
        },
        "identifier": {
            "join_field": "ambito_code",
            "source_field": SOURCE_FIELD_CODE_WFS,
            "source_field_in_rest_route": SOURCE_FIELD_CODE_REST,
            "denomination_field": "ambito_denomination",
            "denomination_source_field": SOURCE_FIELD_DENOM_WFS,
            "matching": "EXACT",
            "normalisation": "NONE",
            "rp_suffix": (
                "A -RP suffix marks a Revisión Parcial ámbito and is a DISTINCT entity (Gate L "
                "§21): UZP.3.01 was annulled by court sentence while UZPp.03.01-RP is its active "
                "replacement. The suffix is never stripped, and normalisation is rejected because "
                "Gate L measured that it REDUCES exact matches."
            ),
        },
        "geometry_metrics": {
            "source_vertices_in_included_features": source_vertices,
            "artifact_vertices": out_vertices,
            "vertices_removed": source_vertices - out_vertices,
            "raw_response_bytes": retrieval["response_bytes"],
            "geometry_types": sorted({f["geometry"]["type"] for f in out_features}),
            "bounds_4326": {
                "min_lon": min(lons),
                "min_lat": min(lats),
                "max_lon": max(lons),
                "max_lat": max(lats),
            },
        },
        "fingerprint": {
            "algorithm": "sha256",
            "scope": "canonical JSON (sorted keys, compact separators, UTF-8) of the FeatureCollection",
            "value": artifact_fingerprint,
        },
        "runtime_policy": (
            "BUILD TIME ONLY. The browser never requests geoportal.madrid.es, sigma.madrid.es or "
            "datos.madrid.es: it reads this committed, fingerprinted artifact."
        ),
        "interpretation_ceiling": (
            "Official planning-ámbito boundaries and codes as published by the Ayuntamiento de "
            "Madrid. The geometry supports orientation, scope recognition and selection; it is NOT "
            "evidence of development state, buildability, physical construction, ownership, land "
            "value or any quantity, and no figure is ever derived from a polygon's area. The "
            "publisher declares no reference date for this geometry, so its currency is unknown and "
            "must never be inferred from the retrieval time, the catalogue record date or an HTTP "
            "header. The raw service is a mixed universe: the excluded Norma Zonal grade and "
            "non-developable land-class records are land-classification records, not ámbitos."
        ),
    }

    geojson_path = out_dir / "madrid_ambitos.geojson"
    meta_path = out_dir / "madrid_ambitos.meta.json"
    with open(geojson_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(artifact, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
    with open(meta_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(
        f"[ambitos] wrote {geojson_path} — {len(out_features)} ámbitos, {out_vertices} vertices, "
        f"{geojson_path.stat().st_size} bytes"
    )
    print(f"[ambitos] wrote {meta_path} — fingerprint {artifact_fingerprint[:16]}")
    return artifact, meta


_EXCLUSION_REASONS = {
    "NORMA_ZONAL_GRADE": (
        "A Norma Zonal grade/level record (for example '1.1' = ZONA 1 GRADO 1º). It describes a "
        "zoning grade applied across the city, not a planning ámbito, and no edition publishes a "
        "development state or buildability row for it."
    ),
    "NON_DEVELOPABLE_LAND_CLASS": (
        "A non-developable land class (NUC = no urbanizable común, NUP.n = no urbanizable de "
        "protección). It is a land classification, not a planning ámbito."
    ),
    "UNCLASSIFIED_SOURCE_RECORD": (
        "A code matching no documented class. This FAILS the build: a record is never silently "
        "discarded and never silently admitted to the production universe."
    ),
}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out-dir", default="data/planning")
    parser.add_argument(
        "--skip-route-check",
        action="store_true",
        help="skip the route-equivalence and reprojection verification (diagnostics only; "
        "an artifact built this way must not be committed)",
    )
    args = parser.parse_args(argv)
    build(args.out_dir, skip_route_check=args.skip_route_check)
    return 0


if __name__ == "__main__":
    sys.exit(main())
