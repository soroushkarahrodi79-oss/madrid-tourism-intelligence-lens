#!/usr/bin/env python3
"""Build the committed official-callejero NDP crosswalk (issue #71 / K9).

    OFFICIAL LICENCE REGISTER + CURRENT CALLEJERO + HISTORICAL CALLEJERO
        -> EXACT NDP JOIN -> DATE-AWARE HISTORICAL SELECTION
        -> WITHHOLD ON AMBIGUITY -> FINGERPRINT -> CROSSWALK ARTIFACT

This reproduces the Gate M (#70) crosswalk contract exactly and commits its
result so the browser never calls datos.madrid.es at runtime. It resolves the
granted-licence NDP set to an official location using the two pinned Callejero
Oficial resources, and NOTHING else: there is no third-party geocoder, no
coordinate estimation and no text re-geocoding.

What this is
------------
One resolution record PER LICENCE ROW (11,498 in the pinned edition), keyed by
the 0-based source-row index so ``scripts/build_urban_licences.py`` can join it
1:1 to the licence product artifact. A record that resolved carries an official
coordinate, an official barrio/district and a crosswalk provenance; a record
that did not carries its exact residual state and no geometry. Unresolved rows
are NEVER dropped: they survive here and in the coverage metadata so the mapped
layer can be described as the resolved subset of a known denominator.

Identity
--------
The join is exact licence ``NDP`` -> callejero ``COD_NDP`` as decoded source
text. No integer coercion, no zero-stripping, no rewriting. Within the pinned
current edition an exact ``COD_NDP`` resolves a licence only when the current
match is unique; a duplicated current key withholds geometry
(``AMBIGUOUS_NDP_MULTI_MATCH``). When no unique current record exists the builder
attempts the official historical file, where bare NDP is insufficient: the
version is selected by the licence grant date against ``FECHA_DE_ALTA`` /
``FECHA_DE_BAJA`` and geometry is published only when exactly one dated version
is active. The historical version identity preserves
``{callejero_resource_sha256}:{COD_NDP}:{FECHA_DE_ALTA}:{FECHA_DE_BAJA}``.

Licence date
------------
``FECHA_FIRMA_RESOLUCION`` (the signature date) is the licence date for historical
selection. ``FECHA_ALTA`` (registry-entry date) is never substituted; a missing
signature date is ``DATE_UNAVAILABLE`` with no automatic fallback.

Barrio provenance
-----------------
A current-resolved row's barrio is the callejero's own official district/barrio
code (``OFFICIAL_CURRENT_CALLEJERO_BARRIO``). The historical file publishes no
barrio, so a historical-only row's barrio is derived from the official historical
coordinate against the project's canonical barrio polygons
(``POLYGON_DERIVED_FROM_OFFICIAL_HISTORICAL_COORDINATE``). The two provenances are
kept distinct and never presented as identical.

Runtime
-------
BUILD TIME ONLY. The committed artifact is fingerprinted; the application reads
it and never requests datos.madrid.es or geoportal.madrid.es.

Dependencies
------------
HTTP retrieval is Python standard library (urllib). ``shapely`` and ``pyproj``
are builder-only and imported lazily (for the historical point-in-polygon barrio
derivation against the canonical geography) so this module stays importable, and
its pure join logic stays testable, with the standard library alone. Pinned in
scripts/requirements-build.txt.

Usage
-----
    python scripts/build_callejero_ndp_crosswalk.py
    python scripts/build_callejero_ndp_crosswalk.py --out-dir data/callejero
"""

from __future__ import annotations

import argparse
import collections
import csv
import datetime as _dt
import hashlib
import io
import json
import re
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

CONTRACT_VERSION = "1.0.0"

# --------------------------------------------------------------- source identity
# The exact official Gate M sources. These must never silently change: the
# committed SHA-256 and HTTP validators in the metadata identify the observed
# edition, and the pinned baseline below reproduces Gate M against it.

CATALOGUE_API = "https://datos.madrid.es/api/3/action/package_show?id="
LICENCE_DATASET = "640505-0-licencias-urbanisticas-otorgadas"
LICENCE_RESOURCE = "640505-1-licencias-urbanisticas-otorgadas"
CALLEJERO_DATASET = "213605-0-callejero-oficial-madrid"
CURRENT_RESOURCE = "213605-4-callejero-oficial-madrid-csv"
HISTORICAL_RESOURCE = "213605-1-callejero-oficial-madrid-csv"

USER_AGENT = (
    "madrid-urban-evidence-lens/callejero-ndp-crosswalk-builder "
    "(+https://github.com/soroushkarahrodi79-oss/madrid-tourism-intelligence-lens)"
)

GEOGRAPHY_ARTIFACT = "data/geography/madrid_admin.geojson"

# ------------------------------------------------------------- pinned Gate M baseline
# Observations of the Gate M run (#70), pinned so a change in the official
# universe is a visible diff in a reviewed pull request rather than a silent one.
# They are RECORDED, not asserted as eternal truths: the publisher may legitimately
# add or remove rows. The regression tests assert them against the pinned edition;
# the engineering guardrails below are set far from them to pass legitimate source
# change and fail only a material collapse.
BASELINE = {
    "licence_rows": 11498,
    "distinct_licence_ndps": 7938,
    "resolved_rows": 11265,
    "resolved_distinct_ndps": 7795,
    "unresolved_rows": 233,
    "unresolved_distinct_ndps": 143,
    "current_only_resolved_rows": 11179,
    "historical_only_recovered_rows": 86,
    "row_match_rate": 0.979736,
    "ndp_match_rate": 0.981985,
    "residual_taxonomy": {
        "RESOLVED": 10662,
        "ADDRESS_TEXT_DISAGREEMENT": 517,
        "NDP_FOUND_HISTORICAL_ONLY": 86,
        "CAUSE_UNRESOLVED": 117,
        "NDP_ABSENT_CURRENT_CALLEJERO": 116,
    },
    "calibrated_on": "2026-10-06",
    "source_shas": {
        "licence": "0f1009e3cfab7f3d02e180d9bda07e50b5539ffdccae70b941672f1046d0a8a0",
        "current": "28b2ca7db810e23c0d5921ea2d3f79dceab3cad2d8d3947743476068960fbb28",
        "historical": "5e67975fdf066f76521308e702bab98620122b497133eda72526eaed80bebea5",
    },
}

# ENGINEERING guardrails against an ingestion collapse, not analytical thresholds.
# The match-rate floor is ~8 points below the pinned 97.97% row rate and below the
# lowest observed per-year rate (97.33%); a gross collapse (callejero truncated or
# unreachable) falls far below it while a small legitimate source update passes.
# The historical-recovery floor ensures the historical route stays present and
# functioning: an accidental regression that stopped using the historical file
# would drop the ~86 recovered rows toward zero.
MIN_ROW_MATCH_RATE = 0.90
MIN_HISTORICAL_RECOVERED = 20
MIN_RESOLVED_ROWS = 9000

# Crosswalk states. No state collapses into a generic N/A. The first five are the
# states Gate M observed; the rest are guarded rules for a future edition and are
# produced only when observed, never fabricated.
CROSSWALK_STATES = (
    "RESOLVED",
    "ADDRESS_TEXT_DISAGREEMENT",
    "NDP_FOUND_HISTORICAL_ONLY",
    "CAUSE_UNRESOLVED",
    "NDP_ABSENT_CURRENT_CALLEJERO",
    "AMBIGUOUS_NDP_MULTI_MATCH",
    "NDP_PRESENT_NO_COORDINATE",
    "NDP_PRESENT_NO_BARRIO",
    "MALFORMED_NDP",
    "DATE_UNAVAILABLE",
)
RESOLVED_STATES = ("RESOLVED", "ADDRESS_TEXT_DISAGREEMENT", "NDP_FOUND_HISTORICAL_ONLY")

# =============================================================== Spanish date parser
# Deterministic parsing: explicit weekday and month maps, the exact observed grammar,
# no machine locale and no fuzzy parsing. Shared contract with Gate M (#70).

MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}
WEEKDAYS = {
    "lunes": 0, "martes": 1, "miércoles": 2, "jueves": 3,
    "viernes": 4, "sábado": 5, "domingo": 6,
}
DATE_RE = re.compile(
    r"^(lunes|martes|miércoles|jueves|viernes|sábado|domingo), "
    r"(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|"
    r"septiembre|octubre|noviembre|diciembre) de (\d{4})$"
)

# Observed closed vocabulary of the licence street-type abbreviation. The audit
# recorded that neither the callejero's leading-particle split nor this closed map
# is a disagreement; a missing callejero qualifier in the licence number remains one.
VIA_ABBREVIATIONS = {
    "AV": "AVENIDA", "BU": "BULEVAR", "CA": "CARRERA", "CJ": "CALLEJÓN",
    "CL": "CALLE", "CM": "CAMINO", "CR": "CARRETERA", "CS": "COSTANILLA",
    "CU": "CUESTA", "GL": "GALERÍA", "GT": "GLORIETA", "PJ": "PASAJE",
    "PO": "PASEO", "PZ": "PLAZA", "RD": "RONDA", "TR": "TRAVESÍA",
}


# ============================================================ pure join primitives


def canonical(value):
    value = (value or "").strip().upper()
    return " ".join(value.split())


def ascii_key(value):
    text = unicodedata.normalize("NFKD", canonical(value))
    return "".join(c for c in text if not unicodedata.combining(c))


def parse_decimal(value):
    value = (value or "").strip()
    if not value:
        return None
    try:
        return float(value.replace(".", "").replace(",", "."))
    except ValueError:
        return None


SOURCE_EPSG = 25830
TARGET_EPSG = 4326
REPROJECTION_PIPELINE = "EPSG:25830 -> EPSG:4326 (pyproj Transformer, always_xy=True)"


def parse_spanish_date(value):
    match = DATE_RE.fullmatch((value or "").strip().lower())
    if not match:
        raise ValueError(f"unsupported Spanish date: {value!r}")
    weekday, day, month, year = match.groups()
    parsed = _dt.date(int(year), MONTHS[month], int(day))
    return parsed, parsed.weekday() == WEEKDAYS[weekday]


def parse_short_date(value):
    value = (value or "").strip()
    return _dt.datetime.strptime(value, "%d/%m/%Y").date() if value else None


def address_signature(row, historical=False):
    street_type = ascii_key(row.get("VIA_CLASE"))
    particle = ascii_key(row.get("VIA_PAR"))
    street = ascii_key(row.get("VIA_NOMBRE_ACENTOS") or row.get("VIA_NOMBRE"))
    name = " ".join(x for x in (particle, street) if x)
    number = canonical(row.get("NÚMERO") if historical else row.get("NUMERO"))
    qualifier = canonical(row.get("CALIFICADOR"))
    return street_type, name, f"{number}{qualifier}".strip()


def licence_address_signature(row):
    return ascii_key(row.get("VIA")), ascii_key(row.get("DIRECCION")), canonical(row.get("Nº"))


def current_barrio_code(row):
    try:
        return f"{int(row['DISTRITO']):02d}{int(row['BARRIO'])}"
    except (KeyError, TypeError, ValueError):
        return None


def current_district_code(row):
    try:
        return f"{int(row['DISTRITO']):02d}"
    except (KeyError, TypeError, ValueError):
        return None


def historical_active(row, date):
    """A historical version is eligible on a licence date when it had started and
    had not ended by that date. An empty FECHA_DE_BAJA is an open (still-active)
    version."""
    start = parse_short_date(row.get("FECHA_DE_ALTA"))
    end = parse_short_date(row.get("FECHA_DE_BAJA"))
    return (start is None or start <= date) and (end is None or date <= end)


def address_text_agrees(lic, candidate):
    """Compare licence address text against the current callejero record. Exact NDP
    identity is authoritative; this is a quality flag only and never overrides it."""
    lic_sig = licence_address_signature(lic)
    cal_sig = address_signature(candidate)
    street_type_agrees = ascii_key(VIA_ABBREVIATIONS.get(canonical(lic.get("VIA")), "")) == cal_sig[0]
    street_name_agrees = lic_sig[1] == ascii_key(candidate.get("VIA_NOMBRE_ACENTOS") or candidate.get("VIA_NOMBRE"))
    street_number_agrees = lic_sig[2] == cal_sig[2]
    return street_type_agrees and street_name_agrees and street_number_agrees, {
        "street_type": street_type_agrees,
        "street_name": street_name_agrees,
        "street_number": street_number_agrees,
    }


def resolve_row(lic, index, current_by_ndp, historical_by_ndp, project_fn, locate_fn, resource_shas):
    """Resolve one licence row to an official location, or to a residual state.

    Pure given the two callejero indexes, ``project_fn(utmx, utmy) -> (lat, lon)``
    (the explicit EPSG:25830 -> EPSG:4326 transform of the official ETRS89/UTM
    coordinate) and ``locate_fn(utmx, utmy) -> dict`` (canonical-polygon containment,
    used only for historical barrio derivation). Returns a crosswalk record. Never
    chooses a first/last/arbitrary match: any ambiguity withholds geometry.
    """
    ndp = canonical(lic.get("NDP"))
    try:
        grant = parse_spanish_date(lic["FECHA_FIRMA_RESOLUCION"])[0] if lic.get("FECHA_FIRMA_RESOLUCION") else None
    except ValueError:
        grant = None
    record = {
        "licence_index": index,
        "ndp": ndp,
        "grant_date": grant.isoformat() if grant else None,
        "crosswalk_state": "CAUSE_UNRESOLVED",
        "lat": None,
        "lon": None,
        "coordinate_crs": None,
        "barrio_code": None,
        "district_code": None,
        "barrio_provenance": None,
        "resolution_provenance": None,
        "address_text_agrees": None,
        "address_identity_provenance": "EXACT_NDP",
        "callejero_resource": None,
        "callejero_resource_sha256": None,
        "historical_version": None,
        "licence_date_selection_basis": None,
    }

    if not re.fullmatch(r"\d+", ndp or ""):
        record["crosswalk_state"] = "MALFORMED_NDP"
        return record

    current_candidates = current_by_ndp.get(ndp, [])
    if len(current_candidates) > 1:
        # Zero licence NDPs hit a duplicated current key in the pinned edition, but
        # the rule is enforced for any future duplication: never choose the first.
        record["crosswalk_state"] = "AMBIGUOUS_NDP_MULTI_MATCH"
        return record
    if len(current_candidates) == 1:
        candidate = current_candidates[0]
        lat, lon = project_fn(parse_decimal(candidate.get("UTMX_ETRS")), parse_decimal(candidate.get("UTMY_ETRS")))
        barrio = current_barrio_code(candidate)
        district = current_district_code(candidate)
        record["callejero_resource"] = CURRENT_RESOURCE
        record["callejero_resource_sha256"] = resource_shas.get("current")
        record["resolution_provenance"] = "CURRENT_CALLEJERO"
        if lat is None or lon is None:
            record["crosswalk_state"] = "NDP_PRESENT_NO_COORDINATE"
            return record
        if barrio is None:
            record["crosswalk_state"] = "NDP_PRESENT_NO_BARRIO"
            return record
        agrees, _ = address_text_agrees(lic, candidate)
        record.update({
            "lat": round(lat, 7),
            "lon": round(lon, 7),
            "coordinate_crs": "EPSG:4326",
            "barrio_code": barrio,
            "district_code": district,
            "barrio_provenance": "OFFICIAL_CURRENT_CALLEJERO_BARRIO",
            "address_text_agrees": agrees,
            "crosswalk_state": "RESOLVED" if agrees else "ADDRESS_TEXT_DISAGREEMENT",
        })
        return record

    history = historical_by_ndp.get(ndp, [])
    if not history:
        record["crosswalk_state"] = "NDP_ABSENT_CURRENT_CALLEJERO"
        return record
    if grant is None:
        record["crosswalk_state"] = "DATE_UNAVAILABLE"
        return record
    active = [r for r in history if historical_active(r, grant)]
    # The defensible version key: dated validity plus the official coordinate and
    # address signature. Bare NDP is never sufficient historical identity.
    unique = {
        (
            address_signature(r, historical=True), r.get("FECHA_DE_ALTA"), r.get("FECHA_DE_BAJA"),
            r.get("UTMX_ETRS"), r.get("UTMY_ETRS"),
        ): r
        for r in active
    }
    if len(unique) != 1:
        record["crosswalk_state"] = "AMBIGUOUS_NDP_MULTI_MATCH" if len(unique) > 1 else "CAUSE_UNRESOLVED"
        return record
    candidate = next(iter(unique.values()))
    record["callejero_resource"] = HISTORICAL_RESOURCE
    record["callejero_resource_sha256"] = resource_shas.get("historical")
    record["resolution_provenance"] = "HISTORICAL_CALLEJERO"
    record["licence_date_selection_basis"] = "FECHA_FIRMA_RESOLUCION"
    record["historical_version"] = {
        "cod_ndp": ndp,
        "fecha_de_alta": (candidate.get("FECHA_DE_ALTA") or None),
        "fecha_de_baja": (candidate.get("FECHA_DE_BAJA") or None),
        "version_identity": f"{resource_shas.get('historical')}:{ndp}:{candidate.get('FECHA_DE_ALTA') or ''}:{candidate.get('FECHA_DE_BAJA') or ''}",
    }
    utmx, utmy = parse_decimal(candidate.get("UTMX_ETRS")), parse_decimal(candidate.get("UTMY_ETRS"))
    lat, lon = project_fn(utmx, utmy)
    if lat is None or lon is None:
        record["crosswalk_state"] = "NDP_PRESENT_NO_COORDINATE"
        return record
    spatial = locate_fn(utmx, utmy)
    if not spatial.get("barrio"):
        record["crosswalk_state"] = "NDP_PRESENT_NO_BARRIO"
        return record
    record.update({
        "lat": round(lat, 7),
        "lon": round(lon, 7),
        "coordinate_crs": "EPSG:4326",
        "barrio_code": spatial["barrio"],
        "district_code": spatial.get("district"),
        "barrio_provenance": "POLYGON_DERIVED_FROM_OFFICIAL_HISTORICAL_COORDINATE",
        "crosswalk_state": "NDP_FOUND_HISTORICAL_ONLY",
    })
    return record


# ============================================================== retrieval (stdlib)


def _package(dataset_id):
    req = urllib.request.Request(CATALOGUE_API + dataset_id, headers={"User-Agent": USER_AGENT})
    error = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                return json.load(response)["result"]
        except Exception as exc:  # the portal intermittently rate-limits bursts
            error = exc
            if attempt < 3:
                time.sleep(2 ** attempt)
    raise error


def _resource(pkg, resource_id):
    return next(r for r in pkg["resources"] if r["id"] == resource_id)


def _fetch(url, cache_dir=None, cache_key=None):
    # A local cache (--cache-dir) lets a rebuild avoid re-downloading ~99 MB. The
    # SHA-256 is always recomputed from the bytes and the HTTP validators are stored
    # in a sidecar, so a cached build carries the same faithful provenance as a live
    # one. The cache is never committed.
    if cache_dir and cache_key:
        body_path = Path(cache_dir) / f"{cache_key}.csv"
        head_path = Path(cache_dir) / f"{cache_key}.headers.json"
        if body_path.exists() and head_path.exists():
            payload = body_path.read_bytes()
            http = json.loads(head_path.read_text(encoding="utf-8"))
            http["sha256"] = hashlib.sha256(payload).hexdigest()
            http["bytes"] = len(payload)
            return payload, http
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    error = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as response:
                digest = hashlib.sha256()
                chunks = []
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    digest.update(chunk)
                    chunks.append(chunk)
                payload = b"".join(chunks)
                http = {
                    "http_last_modified": response.headers.get("Last-Modified"),
                    "http_etag": response.headers.get("ETag"),
                    "http_content_length": response.headers.get("Content-Length"),
                    "bytes": len(payload),
                    "sha256": digest.hexdigest(),
                }
                if cache_dir and cache_key:
                    Path(cache_dir).mkdir(parents=True, exist_ok=True)
                    (Path(cache_dir) / f"{cache_key}.csv").write_bytes(payload)
                    (Path(cache_dir) / f"{cache_key}.headers.json").write_text(
                        json.dumps({k: v for k, v in http.items() if k != "sha256" and k != "bytes"}),
                        encoding="utf-8",
                    )
                return payload, http
        except Exception as exc:
            error = exc
            if attempt < 3:
                time.sleep(2 ** attempt)
    raise error


def _decoded_csv(payload, encoding):
    reader = csv.DictReader(io.StringIO(payload.decode(encoding)), delimiter=";")
    rows = [{(k or "").strip(): (v or "").strip() for k, v in r.items()} for r in reader]
    return rows, list(reader.fieldnames or [])


# =================================================== canonical-polygon containment


def _require_geo():
    try:
        from pyproj import Transformer  # noqa: PLC0415
        from shapely.geometry import Point, shape  # noqa: PLC0415
        from shapely.ops import transform  # noqa: PLC0415
    except ImportError as error:  # pragma: no cover - environment dependent
        raise SystemExit(
            "shapely and pyproj are required for the historical barrio derivation "
            "(pip install -r scripts/requirements-build.txt)"
        ) from error
    return Transformer, Point, shape, transform


def load_geography(root):
    """Load the canonical barrio polygons reprojected to EPSG:25830, so the
    historical barrio derivation uses the SAME metric containment Gate M used
    against the official historical UTMX_ETRS/UTMY_ETRS coordinate."""
    Transformer, _, shape, transform = _require_geo()
    raw = json.loads((root / GEOGRAPHY_ARTIFACT).read_text(encoding="utf-8"))
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:25830", always_xy=True)
    municipality = None
    barrios = []
    for feature in raw["features"]:
        props = feature["properties"]
        geom = transform(transformer.transform, shape(feature["geometry"]))
        if props["geography_level"] == "municipality":
            municipality = geom
        elif props["geography_level"] == "barrio":
            barrios.append((props, geom))
    return municipality, barrios


def make_project():
    """An explicit, deterministic EPSG:25830 -> EPSG:4326 transform of the official
    ETRS89/UTM coordinate, returning (lat, lon) rounded to 7 dp (~1.1 cm). The same
    verified pipeline scripts/build_planning_ambitos.py uses; no coordinate is ever
    guessed and no third-party geocoder is involved."""
    Transformer, _, _, _ = _require_geo()
    transformer = Transformer.from_crs(f"EPSG:{SOURCE_EPSG}", f"EPSG:{TARGET_EPSG}", always_xy=True)
    cache = {}

    def project(x, y):
        if x is None or y is None:
            return None, None
        key = (x, y)
        if key not in cache:
            lon, lat = transformer.transform(x, y)
            cache[key] = (round(lat, 7), round(lon, 7))
        return cache[key]

    return project


def make_locate(municipality, barrios):
    _, Point, _, _ = _require_geo()
    cache = {}

    def locate(x, y):
        key = (x, y)
        if key in cache:
            return cache[key]
        if x is None or y is None:
            result = {"state": "NO_COORDINATE", "barrio": None, "district": None}
        else:
            point = Point(x, y)
            if municipality is not None and not municipality.covers(point):
                result = {"state": "OUTSIDE_MUNICIPALITY", "barrio": None, "district": None}
            else:
                covering = [(p, poly) for p, poly in barrios if poly.covers(point)]
                if len(covering) == 1:
                    props = covering[0][0]
                    result = {"state": "INSIDE", "barrio": props["official_id"], "district": props["parent_id"]}
                else:
                    result = {
                        "state": "BOUNDARY_OR_AMBIGUOUS" if covering else "NO_BARRIO",
                        "barrio": None,
                        "district": None,
                    }
        cache[key] = result
        return result

    return locate


# ============================================================================ build


def now():
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def canonical_bytes(payload):
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def fingerprint(payload):
    return hashlib.sha256(canonical_bytes(payload)).hexdigest()


def build(out_dir, cache_dir=None):
    root = Path(__file__).resolve().parents[1]
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    retrieved_at = now()

    print("[crosswalk] resolving official sources from the CKAN catalogue ...")
    licence_pkg = _package(LICENCE_DATASET)
    callejero_pkg = _package(CALLEJERO_DATASET)
    licence_res = _resource(licence_pkg, LICENCE_RESOURCE)
    current_res = _resource(callejero_pkg, CURRENT_RESOURCE)
    historical_res = _resource(callejero_pkg, HISTORICAL_RESOURCE)

    print("[crosswalk] retrieving the granted-licence register ...")
    licence_payload, licence_http = _fetch(licence_res["url"], cache_dir, LICENCE_RESOURCE)
    print(f"[crosswalk] retrieving the CURRENT callejero ({current_res['url'].rsplit('/', 1)[-1]}) ...")
    current_payload, current_http = _fetch(current_res["url"], cache_dir, CURRENT_RESOURCE)
    print(f"[crosswalk] retrieving the HISTORICAL callejero ({historical_res['url'].rsplit('/', 1)[-1]}) ...")
    historical_payload, historical_http = _fetch(historical_res["url"], cache_dir, HISTORICAL_RESOURCE)

    licences, _ = _decoded_csv(licence_payload, "utf-8-sig")
    current, _ = _decoded_csv(current_payload, "cp1252")
    historical, _ = _decoded_csv(historical_payload, "cp1252")
    resource_shas = {
        "licence": licence_http["sha256"],
        "current": current_http["sha256"],
        "historical": historical_http["sha256"],
    }
    print(f"[crosswalk] {len(licences)} licence rows, {len(current)} current rows, {len(historical)} historical rows")

    current_by_ndp = collections.defaultdict(list)
    historical_by_ndp = collections.defaultdict(list)
    for row in current:
        current_by_ndp[canonical(row.get("COD_NDP"))].append(row)
    for row in historical:
        historical_by_ndp[canonical(row.get("COD_NDP"))].append(row)

    # The current callejero must publish exactly the canonical current barrio set,
    # or the official barrio codes this crosswalk commits would not join to the
    # geography the rest of the app uses. Fail closed rather than ship a mis-join.
    print("[crosswalk] loading canonical geography for historical barrio derivation ...")
    municipality, barrios = load_geography(root)
    canonical_barrio_ids = {p["official_id"] for p, _ in barrios}
    current_codes = {current_barrio_code(r) for r in current if current_barrio_code(r)}
    if current_codes != canonical_barrio_ids:
        raise SystemExit(
            "the current callejero barrio-code set does not equal the canonical "
            f"{len(canonical_barrio_ids)}-barrio geography: "
            f"{len(current_codes - canonical_barrio_ids)} unknown, "
            f"{len(canonical_barrio_ids - current_codes)} missing. Resolve the administrative "
            "geography mismatch before committing a crosswalk."
        )
    locate = make_locate(municipality, barrios)
    project = make_project()

    print("[crosswalk] joining the granted-licence NDP set ...")
    records = [
        resolve_row(lic, index, current_by_ndp, historical_by_ndp, project, locate, resource_shas)
        for index, lic in enumerate(licences)
    ]

    # ---- coverage accounting; nothing is silently dropped -----------------------
    residual = collections.Counter(r["crosswalk_state"] for r in records)
    resolved = [r for r in records if r["crosswalk_state"] in RESOLVED_STATES]
    unresolved = [r for r in records if r["crosswalk_state"] not in RESOLVED_STATES]
    distinct_ndps = {r["ndp"] for r in records}
    resolved_ndps = {r["ndp"] for r in resolved}
    current_resolved = [r for r in resolved if r["resolution_provenance"] == "CURRENT_CALLEJERO"]
    historical_resolved = [r for r in resolved if r["resolution_provenance"] == "HISTORICAL_CALLEJERO"]
    address_disagreements = sum(r["crosswalk_state"] == "ADDRESS_TEXT_DISAGREEMENT" for r in records)
    row_match_rate = round(len(resolved) / len(records), 6) if records else 0.0
    ndp_match_rate = round(len(resolved_ndps) / len(distinct_ndps), 6) if distinct_ndps else 0.0

    # ---- engineering guardrails -------------------------------------------------
    if row_match_rate < MIN_ROW_MATCH_RATE:
        raise SystemExit(
            f"row match rate {row_match_rate:.4f} is below the collapse guardrail {MIN_ROW_MATCH_RATE}; "
            f"this looks like an ingestion collapse (pinned Gate M rate {BASELINE['row_match_rate']})."
        )
    if len(resolved) < MIN_RESOLVED_ROWS:
        raise SystemExit(f"only {len(resolved)} rows resolved (floor {MIN_RESOLVED_ROWS}); suspected collapse.")
    if len(historical_resolved) < MIN_HISTORICAL_RECOVERED:
        raise SystemExit(
            f"only {len(historical_resolved)} rows recovered via the historical callejero "
            f"(floor {MIN_HISTORICAL_RECOVERED}, pinned baseline "
            f"{BASELINE['historical_only_recovered_rows']}). The historical route may have "
            "silently stopped being used; the current file alone is insufficient."
        )

    artifact = {
        "contract_version": CONTRACT_VERSION,
        "records": records,
    }
    artifact_fingerprint = fingerprint(artifact)

    def source_block(pkg, res, http, encoding, cadence):
        return {
            "dataset_id": pkg["name"],
            "resource_id": res["id"],
            "resource_description": res.get("description"),
            "download_url": res["url"],
            "format": res.get("format"),
            "encoding": encoding,
            "delimiter": ";",
            "licence": pkg.get("license_title"),
            "declared_cadence": cadence,
            "reference_date": None,
            "published_at": None,
            "retrieved_at": retrieved_at,
            "update_frequency": cadence,
            "source_state": "NOT_DECLARED_BY_PUBLISHER",
            "observed_resource_state": {**http, "catalogue_metadata_modified": pkg.get("metadata_modified")},
        }

    meta = {
        "contract_version": CONTRACT_VERSION,
        "artifact": "madrid_ndp_crosswalk.json",
        "generated_at": retrieved_at,
        "builder": "scripts/build_callejero_ndp_crosswalk.py",
        "gate": "Gate M (#70) crosswalk contract; issue #71 (K9) production increment",
        "what_this_is": (
            "An official-callejero NDP crosswalk for the granted-urban-licence NDP set. One "
            "resolution record per licence row, keyed by licence_index. Resolved records carry an "
            "official coordinate and barrio/district; unresolved rows survive with their exact "
            "residual state and no geometry. No third-party geocoder, no coordinate estimation and "
            "no text re-geocoding is used anywhere."
        ),
        "identity": {
            "join": "exact licence NDP -> callejero COD_NDP, as decoded source text",
            "normalisation": "NONE (no integer coercion, no zero-stripping, no rewriting)",
            "current_rule": "exact COD_NDP resolves only when the current match is unique; a duplicated current key withholds geometry (AMBIGUOUS_NDP_MULTI_MATCH)",
            "historical_rule": "date-aware: a version is active when FECHA_DE_ALTA <= grant_date and (FECHA_DE_BAJA empty or grant_date <= FECHA_DE_BAJA); geometry published only when exactly one version is active",
            "historical_version_identity": "{callejero_resource_sha256}:{COD_NDP}:{FECHA_DE_ALTA}:{FECHA_DE_BAJA}",
            "licence_date_field": "FECHA_FIRMA_RESOLUCION",
            "licence_date_fallback": "NONE; a missing signature date is DATE_UNAVAILABLE",
            "multi_match_policy": "never choose first/last/arbitrary; withhold geometry",
        },
        "sources": {
            "licence_register": source_block(licence_pkg, licence_res, licence_http, "UTF-8 with BOM", "MONTHLY"),
            "current_callejero": source_block(callejero_pkg, current_res, current_http, "Windows-1252", "WEEKLY"),
            "historical_callejero": source_block(callejero_pkg, historical_res, historical_http, "Windows-1252", "WEEKLY"),
        },
        "callejero_freshness_ceiling": (
            "The bulk callejero publishes no reference_date and no published_at. The dated filename, "
            "the HTTP Last-Modified header, the weekly cadence and the retrieval clock are observed "
            "resource state only and are never promoted into a source reference date."
        ),
        "coverage": {
            "licence_rows": len(records),
            "distinct_licence_ndps": len(distinct_ndps),
            "resolved_rows": len(resolved),
            "unresolved_rows": len(unresolved),
            "resolved_distinct_ndps": len(resolved_ndps),
            "unresolved_distinct_ndps": len(distinct_ndps - resolved_ndps),
            "row_match_rate": row_match_rate,
            "ndp_match_rate": ndp_match_rate,
            "current_only_resolved_rows": len(current_resolved),
            "historical_only_recovered_rows": len(historical_resolved),
            "address_text_disagreement_rows": address_disagreements,
            "residual_taxonomy": dict(sorted(residual.items())),
            "residual_taxonomy_is_exhaustive": sum(residual.values()) == len(records),
            "unresolved_distinct_ndp_sample": sorted({r["ndp"] for r in unresolved})[:40],
        },
        "barrio_provenance": {
            "current": "OFFICIAL_CURRENT_CALLEJERO_BARRIO (the callejero's own district/barrio code)",
            "historical": "POLYGON_DERIVED_FROM_OFFICIAL_HISTORICAL_COORDINATE (the official historical coordinate against the canonical barrio polygon; the historical file publishes no barrio)",
            "canonical_barrio_set": len(canonical_barrio_ids),
            "canonical_barrio_set_matches_current_callejero": True,
            "geography_dependency": GEOGRAPHY_ARTIFACT,
        },
        "crosswalk_states": list(CROSSWALK_STATES),
        "baseline": {**BASELINE, "note": (
            "Pinned Gate M observations, recorded so a change in the official universe is a visible "
            "diff in a reviewed pull request. They are not asserted as permanent truths; the builder "
            "reproduces them from the pinned source edition and the regression tests check them."
        )},
        "engineering_guardrails": {
            "min_row_match_rate": MIN_ROW_MATCH_RATE,
            "min_historical_recovered": MIN_HISTORICAL_RECOVERED,
            "min_resolved_rows": MIN_RESOLVED_ROWS,
            "note": "Ingestion-collapse guardrails, not analytical thresholds.",
        },
        "fingerprint": {
            "algorithm": "sha256",
            "scope": "canonical JSON (sorted keys, compact separators, UTF-8) of the crosswalk object",
            "value": artifact_fingerprint,
        },
        "runtime_policy": (
            "BUILD TIME ONLY. The browser never requests datos.madrid.es or geoportal.madrid.es: it "
            "reads this committed, fingerprinted artifact."
        ),
        "interpretation_ceiling": (
            "An administrative address-point crosswalk. A resolved coordinate is where the official "
            "callejero places the address of a granted licence; it is not evidence that any work "
            "occurred there. Historical-only barrios are polygon-derived and must stay distinguishable "
            "from the official current barrio."
        ),
    }

    crosswalk_path = out_dir / "madrid_ndp_crosswalk.json"
    meta_path = out_dir / "madrid_ndp_crosswalk.meta.json"
    with open(crosswalk_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(artifact, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
    with open(meta_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(
        f"[crosswalk] wrote {crosswalk_path} — {len(records)} rows, {len(resolved)} resolved "
        f"({len(current_resolved)} current, {len(historical_resolved)} historical), "
        f"{len(unresolved)} unresolved, {crosswalk_path.stat().st_size} bytes"
    )
    print(f"[crosswalk] row match rate {row_match_rate:.4f}; fingerprint {artifact_fingerprint[:16]}")
    return artifact, meta


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out-dir", default="data/callejero")
    parser.add_argument(
        "--cache-dir",
        default=None,
        help="optional local cache for the raw official downloads, so a rebuild avoids re-fetching "
        "~99 MB; the SHA-256 is always recomputed from the bytes and the cache is never committed",
    )
    args = parser.parse_args(argv)
    build(args.out_dir, cache_dir=args.cache_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
