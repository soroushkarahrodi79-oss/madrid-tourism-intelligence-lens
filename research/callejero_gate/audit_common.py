"""Shared, research-only machinery for Gate M callejero audits.

Nothing in production imports this module. Raw official downloads are held only in a
temporary directory (or an explicitly external GATE_M_CACHE directory).
"""

from __future__ import annotations

import collections
import csv
import datetime as dt
import hashlib
import io
import json
import pathlib
import re
import time
import unicodedata
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
RESULTS = pathlib.Path(__file__).resolve().parent / "results"
CATALOGUE_API = "https://datos.madrid.es/api/3/action/package_show?id="

LICENCE_DATASET = "640505-0-licencias-urbanisticas-otorgadas"
LICENCE_RESOURCE = "640505-1-licencias-urbanisticas-otorgadas"
CURRENT_DATASET = "213605-0-callejero-oficial-madrid"
CURRENT_RESOURCE = "213605-4-callejero-oficial-madrid-csv"
HISTORICAL_RESOURCE = "213605-1-callejero-oficial-madrid-csv"
WEBSERVICE_DATASET = "300274-0-callejero-oficial-webservice"
DECLARATIONS_DATASET = "133556-0-declaraciones-responsables"
GEO_PORTAL_ID = "9be44652-2490-11e9-a99c-ecb1d752b636"
GEO_PORTAL_URL = (
    "https://geoportal.madrid.es/IDEAM_WBGEOPORTAL/dataset.iam?"
    f"id={GEO_PORTAL_ID}"
)

MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5,
    "junio": 6, "julio": 7, "agosto": 8, "septiembre": 9,
    "octubre": 10, "noviembre": 11, "diciembre": 12,
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

TIPO_FAMILIES = {
    "Licencia básica actividad": "ACTIVITY_LICENCE_FAMILY",
    "Licencia básica residencial": "BUILDING_URBANISTIC_LICENCE_FAMILY",
    "Licencia básica residencial sujeta a la Ley 3/2024": "BUILDING_URBANISTIC_LICENCE_FAMILY",
    "Licencia básica urbanística residencial sujeta a Ley 3/2024": "BUILDING_URBANISTIC_LICENCE_FAMILY",
    "Licencia de 1ª ocupación y funcionamiento": "BUILDING_URBANISTIC_LICENCE_FAMILY",
    "Licencia de funcionamiento de actividad": "ACTIVITY_LICENCE_FAMILY",
    "Licencia urbanística de actividad": "ACTIVITY_LICENCE_FAMILY",
    "Licencia urbanística residencial": "BUILDING_URBANISTIC_LICENCE_FAMILY",
    "Licencia urbanística residencial sujeta a la ley 3/2024": "BUILDING_URBANISTIC_LICENCE_FAMILY",
    "Licencia urbanística residencial sujeta a Ley 3/2024": "BUILDING_URBANISTIC_LICENCE_FAMILY",
    "Licencias para actividades temporales": "TEMPORARY_ACTIVITY_FAMILY",
}

# Observed closed vocabulary in the pinned licence file. The audit separately records
# the five NDP-linked rows whose abbreviation conflicts with the current callejero.
VIA_ABBREVIATIONS = {
    "AV": "AVENIDA", "BU": "BULEVAR", "CA": "CARRERA", "CJ": "CALLEJÓN",
    "CL": "CALLE", "CM": "CAMINO", "CR": "CARRETERA", "CS": "COSTANILLA",
    "CU": "CUESTA", "GL": "GALERÍA", "GT": "GLORIETA", "PJ": "PASAJE",
    "PO": "PASEO", "PZ": "PLAZA", "RD": "RONDA", "TR": "TRAVESÍA",
}


def package(dataset_id: str) -> dict:
    req = urllib.request.Request(
        CATALOGUE_API + dataset_id,
        headers={"User-Agent": "MadridTourismIntelligence-GateM/1.0"},
    )
    error = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                return json.load(response)["result"]
        except Exception as exc:  # official portal intermittently rate-limits bursts
            error = exc
            if attempt < 3:
                time.sleep(2 ** attempt)
    raise error


def resource(pkg: dict, resource_id: str) -> dict:
    return next(r for r in pkg["resources"] if r["id"] == resource_id)


def clean_header(value: str) -> str:
    return value.strip().replace("_", " - ")


def fetch(url: str) -> tuple[bytes, dict]:
    req = urllib.request.Request(
        url, headers={"User-Agent": "MadridTourismIntelligence-GateM/1.0"}
    )
    with urllib.request.urlopen(req, timeout=180) as response:
        digest = hashlib.sha256()
        chunks: list[bytes] = []
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            chunks.append(chunk)
        payload = b"".join(chunks)
        return payload, {
            "http_last_modified": response.headers.get("Last-Modified"),
            "http_etag": response.headers.get("ETag"),
            "http_content_length": response.headers.get("Content-Length"),
            "bytes": len(payload),
            "sha256": digest.hexdigest(),
        }


def decoded_csv(payload: bytes, encoding: str) -> tuple[list[dict[str, str]], list[str]]:
    text = payload.decode(encoding)
    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    rows = [{(k or "").strip(): (v or "").strip() for k, v in r.items()} for r in reader]
    return rows, list(reader.fieldnames or [])


def canonical(value: str | None) -> str:
    value = (value or "").strip().upper()
    return " ".join(value.split())


def ascii_key(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", canonical(value))
    return "".join(c for c in text if not unicodedata.combining(c))


def parse_decimal(value: str | None) -> float | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return float(value.replace(".", "").replace(",", "."))
    except ValueError:
        return None


def parse_spanish_date(value: str) -> tuple[dt.date, bool]:
    match = DATE_RE.fullmatch(value.strip().lower())
    if not match:
        raise ValueError(f"unsupported Spanish date: {value!r}")
    weekday, day, month, year = match.groups()
    parsed = dt.date(int(year), MONTHS[month], int(day))
    return parsed, parsed.weekday() == WEEKDAYS[weekday]


def parse_short_date(value: str | None) -> dt.date | None:
    value = (value or "").strip()
    return dt.datetime.strptime(value, "%d/%m/%Y").date() if value else None


def address_signature(row: dict[str, str], historical: bool = False) -> tuple[str, str, str]:
    street_type = ascii_key(row.get("VIA_CLASE") if historical else row.get("VIA_CLASE"))
    particle = ascii_key(row.get("VIA_PAR"))
    street = ascii_key(row.get("VIA_NOMBRE_ACENTOS") or row.get("VIA_NOMBRE"))
    name = " ".join(x for x in (particle, street) if x)
    number = canonical(row.get("NÚMERO") if historical else row.get("NUMERO"))
    qualifier = canonical(row.get("CALIFICADOR"))
    return street_type, name, f"{number}{qualifier}".strip()


def licence_address_signature(row: dict[str, str]) -> tuple[str, str, str]:
    return ascii_key(row.get("VIA")), ascii_key(row.get("DIRECCION")), canonical(row.get("Nº"))


def row_rate(matched: int, total: int) -> float:
    return round(matched / total, 6) if total else 0.0


def schema(rows: list[dict[str, str]], fields: list[str]) -> list[dict]:
    return [
        {
            "name": field,
            "non_empty": sum(bool(r.get(field, "").strip()) for r in rows),
            "observed_as_text": True,
        }
        for field in fields
    ]


def current_barrio_code(row: dict[str, str]) -> str | None:
    try:
        return f"{int(row['DISTRITO']):02d}{int(row['BARRIO'])}"
    except (KeyError, TypeError, ValueError):
        return None


def historical_active(row: dict[str, str], date: dt.date) -> bool:
    start = parse_short_date(row.get("FECHA_DE_ALTA"))
    end = parse_short_date(row.get("FECHA_DE_BAJA"))
    return (start is None or start <= date) and (end is None or date <= end)


def load_geography():
    from pyproj import Transformer
    from shapely.geometry import shape
    from shapely.ops import transform

    raw = json.loads((ROOT / "data/geography/madrid_admin.geojson").read_text(encoding="utf-8"))
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:25830", always_xy=True)
    features = raw["features"]
    municipality_feature = next(f for f in features if f["properties"]["geography_level"] == "municipality")
    municipality = transform(transformer.transform, shape(municipality_feature["geometry"]))
    barrios = []
    for feature in features:
        props = feature["properties"]
        if props["geography_level"] == "barrio":
            barrios.append((props, transform(transformer.transform, shape(feature["geometry"]))))
    return municipality, barrios


def locate(x: float | None, y: float | None, municipality, barrios) -> dict:
    from shapely.geometry import Point

    if x is None or y is None:
        return {"state": "NO_COORDINATE", "barrio": None, "boundary_distance_m": None}
    point = Point(x, y)
    if not municipality.covers(point):
        return {"state": "OUTSIDE_MUNICIPALITY", "barrio": None, "boundary_distance_m": None}
    covering = [(p, poly) for p, poly in barrios if poly.covers(point)]
    if len(covering) != 1:
        return {
            "state": "BOUNDARY_OR_AMBIGUOUS" if covering else "NO_BARRIO",
            "barrio": None,
            "boundary_distance_m": 0.0 if len(covering) > 1 else None,
        }
    props, polygon = covering[0]
    distance = point.distance(polygon.boundary)
    return {
        "state": "NEAR_BOUNDARY" if distance <= 1.0 else "INSIDE",
        "barrio": props["official_id"],
        "district": props["parent_id"],
        "boundary_distance_m": round(distance, 3),
    }


def output_json(name: str, value: dict) -> None:
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / name).write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def build_all(retrieved_at: str | None = None) -> dict[str, dict]:
    retrieved_at = retrieved_at or dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    licence_pkg = package(LICENCE_DATASET)
    callejero_pkg = package(CURRENT_DATASET)
    ws_pkg = package(WEBSERVICE_DATASET)
    declaration_pkg = package(DECLARATIONS_DATASET)

    licence_res = resource(licence_pkg, LICENCE_RESOURCE)
    current_res = resource(callejero_pkg, CURRENT_RESOURCE)
    historical_res = resource(callejero_pkg, HISTORICAL_RESOURCE)
    licence_payload, licence_http = fetch(licence_res["url"])
    current_payload, current_http = fetch(current_res["url"])
    historical_payload, historical_http = fetch(historical_res["url"])
    licences, licence_fields = decoded_csv(licence_payload, "utf-8-sig")
    current, current_fields = decoded_csv(current_payload, "cp1252")
    historical, historical_fields = decoded_csv(historical_payload, "cp1252")

    def source_contract(pkg, res, http, rows, encoding, cadence, state="NOT_DECLARED_BY_PUBLISHER"):
        return {
            "publisher": pkg.get("author") or "Ayuntamiento de Madrid",
            "authority": "Ayuntamiento de Madrid",
            "dataset_id": pkg["name"],
            "resource_id": res["id"],
            "resource_description": res.get("description"),
            "download_url": res["url"],
            "format": res.get("format"),
            "encoding": encoding,
            "delimiter": ";",
            "declared_cadence": cadence,
            "observed_cadence": None,
            "licence": pkg.get("license_title"),
            "row_count": len(rows),
            "declared_crs": "EPSG:25830" if pkg["name"] == CURRENT_DATASET else None,
            "reference_date": None,
            "published_at": None,
            "retrieved_at": retrieved_at,
            "update_frequency": cadence,
            "source_state": state,
            "observed_resource_state": {
                **http,
                "catalogue_metadata_modified": pkg.get("metadata_modified"),
            },
        }

    licence_source = source_contract(
        licence_pkg, licence_res, licence_http, licences, "UTF-8 with BOM", "MONTHLY"
    )
    current_source = source_contract(
        callejero_pkg, current_res, current_http, current, "Windows-1252", "WEEKLY"
    )
    historical_source = source_contract(
        callejero_pkg, historical_res, historical_http, historical, "Windows-1252", "WEEKLY"
    )
    current_source["declared_crs"] = "EPSG:25830 (UTM ETRS89, zone 30)"
    historical_source["declared_crs"] = "EPSG:25830 (UTM ETRS89, zone 30)"
    current_source["observed_cadence"] = "WEEKLY"
    current_source["observed_cadence_basis"] = "The repository's prior official resource was dated 2026-09-27; this pinned resource is dated 2026-10-04."
    historical_source["observed_cadence"] = "WEEKLY"
    historical_source["observed_cadence_basis"] = "The resource is issued in the same dated weekly Callejero package as the current-address file."

    m1 = {
        "gate": "M1",
        "verdict": "GO",
        "retrieved_at": retrieved_at,
        "licence_register": {**licence_source, "schema": schema(licences, licence_fields)},
        "authoritative_callejero": {
            "register_of_record": "Ayuntamiento de Madrid CADMA / Callejero Oficial",
            "identity_field": "COD_NDP",
            "current_coordinates_and_admin_codes": current_source,
            "historical_identity_coordinates_and_validity": historical_source,
            "geoportal_companion": {
                "publisher": "Ayuntamiento de Madrid — Geoportal / IDEAM",
                "authority": "Ayuntamiento de Madrid — CADMA / Departamento de Cartografía",
                "dataset_id": GEO_PORTAL_ID,
                "resource_id": "CALLEJERO_NDPS_VIGENTES_HISTORICOS",
                "retrieval_route": GEO_PORTAL_URL,
                "download_url": "https://geoportal.madrid.es/fsdescargas/IDEAM_WBGEOPORTAL/CALLEJERO/NDPS_VIGENTES_HISTORICOS/NDPS_VIG_HIS_SHP.zip",
                "format": "service plus SHP/CSV bulk downloads",
                "format_routes": ["ESRI REST", "WMS", "WFS", "OGC API Features", "SHP", "CSV"],
                "encoding": None,
                "row_count": None,
                "declared_crs": "EPSG:25830",
                "licence": "CC BY 4.0",
                "declared_cadence": "continuous CADMA maintenance; daily database load",
                "observed_cadence": None,
                "update_frequency": "DAILY",
                "reference_date": "2026-10-06",
                "published_at": None,
                "retrieved_at": retrieved_at,
                "source_state": "NOT_DECLARED_BY_PUBLISHER",
                "observed_resource_state": "The official portal displayed Fecha datos 06/10/2026 and states continuous CADMA maintenance with a daily database load; this dates the service state, not any individual address's validity.",
            },
            "change_webservice": {
                "publisher": "Ayuntamiento de Madrid",
                "authority": "Ayuntamiento de Madrid — CADMA",
                "dataset_id": ws_pkg["name"],
                "resource_id": ws_pkg["resources"][0]["id"],
                "retrieval_route": ws_pkg["resources"][0]["url"],
                "format": "SOAP/WSDL XML",
                "encoding": "XML-declared",
                "row_count": None,
                "declared_crs": "Coordinates returned by the CADMA service; CRS is not declared in the service catalogue record",
                "declared_cadence": "UPDATE_CONT",
                "observed_cadence": None,
                "licence": ws_pkg.get("license_title"),
                "role": "change feed by date/range; not the reproducible bulk crosswalk route",
                "reference_date": None,
                "published_at": None,
                "retrieved_at": retrieved_at,
                "update_frequency": "DAILY",
                "cadence_mapping_basis": "Mapped to the K2 DAILY vocabulary from the official callejero documentation's daily changes/publication mechanics; raw CKAN cadence remains UPDATE_CONT.",
                "source_state": "NOT_DECLARED_BY_PUBLISHER",
                "observed_resource_state": {"catalogue_metadata_modified": ws_pkg.get("metadata_modified")},
            },
            "schema_current": schema(current, current_fields),
            "schema_historical": schema(historical, historical_fields),
        },
        "publisher_documentation": {
            "callejero_structure_version": "3.0 (2016-04-27)",
            "historical_completeness_ceiling": "Historical digitisation is explicitly documented as incomplete and continuing.",
            "licence_structure_version": "May 2026; updated 2026-05-22",
            "licence_row_unit": "one administrative expediente",
            "personal_data_statement": "Publisher states the file is aggregated and anonymised and contains no personal data; PERSONA_INTERESADA is a person-type category, not a name.",
        },
    }

    current_by_ndp: dict[str, list[dict[str, str]]] = collections.defaultdict(list)
    historical_by_ndp: dict[str, list[dict[str, str]]] = collections.defaultdict(list)
    for row in current:
        current_by_ndp[canonical(row.get("COD_NDP"))].append(row)
    for row in historical:
        historical_by_ndp[canonical(row.get("COD_NDP"))].append(row)

    current_duplicate_ndps = {k: v for k, v in current_by_ndp.items() if k and len(v) > 1}
    historical_multi = {k: v for k, v in historical_by_ndp.items() if k and len(v) > 1}
    historical_reused_address = 0
    for rows in historical_multi.values():
        if len({address_signature(r, historical=True) for r in rows}) > 1:
            historical_reused_address += 1
    licence_ndps = [canonical(r.get("NDP")) for r in licences]
    distinct_licence_ndps = sorted(set(licence_ndps))
    ndp_lengths = collections.Counter(len(x) for x in current_by_ndp if x)
    m2 = {
        "gate": "M2",
        "verdict": "GO_WITH_CONDITIONS",
        "authoritative_field": {
            "licence_field": "NDP",
            "callejero_field": "COD_NDP",
            "source_documented_relationship": "Both are the official internal identifier/code for the address (número de policía); the join preserves their exact text representation.",
            "observed_type": "digit-only text after CSV decoding",
            "observed_lengths_current": dict(sorted(ndp_lengths.items())),
            "leading_zero_count_current": sum(k.startswith("0") for k in current_by_ndp if k),
            "null_count_current": len(current_by_ndp.get("", [])),
            "null_count_historical": len(historical_by_ndp.get("", [])),
            "null_count_licence": sum(not x for x in licence_ndps),
        },
        "current": {
            "rows": len(current),
            "distinct_nonempty_ndps": len([x for x in current_by_ndp if x]),
            "duplicate_ndps": len(current_duplicate_ndps),
            "duplicate_rows": sum(len(v) for v in current_duplicate_ndps.values()),
            "same_ndp_different_address": sum(
                len({address_signature(r) for r in rows}) > 1
                for rows in current_duplicate_ndps.values()
            ),
        },
        "historical": {
            "rows": len(historical),
            "distinct_nonempty_ndps": len([x for x in historical_by_ndp if x]),
            "ndps_with_multiple_versions": len(historical_multi),
            "ndps_mapping_to_multiple_address_signatures": historical_reused_address,
            "has_dated_validity": True,
            "validity_fields": ["FECHA_DE_ALTA", "FECHA_DE_BAJA"],
            "completeness_ceiling": "The publisher warns that historical digitisation is incomplete.",
        },
        "licence": {
            "rows": len(licences),
            "distinct_ndps": len(distinct_licence_ndps),
            "malformed_ndp_rows": sum(not re.fullmatch(r"\d+", x or "") for x in licence_ndps),
            "ndps_absent_current": sum(x not in current_by_ndp for x in distinct_licence_ndps),
            "rows_absent_current": sum(x not in current_by_ndp for x in licence_ndps),
            "distinct_ndps_affected_by_current_duplicates": len(set(licence_ndps) & set(current_duplicate_ndps)),
        },
        "identity_policy": "Use exact COD_NDP for current records. Historical records require COD_NDP plus dated validity/version provenance; bare NDP alone is insufficient when address signatures vary over time.",
        "required_identity_key": "{callejero_resource_sha256}:{COD_NDP}:{FECHA_DE_ALTA}:{FECHA_DE_BAJA} for historical versions; exact COD_NDP is sufficient only within the pinned current edition.",
    }

    municipality, barrios = load_geography()
    canonical_barrio_ids = {p["official_id"] for p, _ in barrios}
    canonical_district_by_barrio = {p["official_id"]: p["parent_id"] for p, _ in barrios}
    row_results = []
    spatial_cache: dict[tuple[float | None, float | None], dict] = {}

    def location(row: dict[str, str]) -> dict:
        key = (parse_decimal(row.get("UTMX_ETRS")), parse_decimal(row.get("UTMY_ETRS")))
        if key not in spatial_cache:
            spatial_cache[key] = locate(key[0], key[1], municipality, barrios)
        return spatial_cache[key]

    for index, lic in enumerate(licences):
        ndp = canonical(lic.get("NDP"))
        signature_date = parse_spanish_date(lic["FECHA_FIRMA_RESOLUCION"])[0] if lic.get("FECHA_FIRMA_RESOLUCION") else None
        result = {
            "index": index,
            "ndp": ndp,
            "year": str(signature_date.year) if signature_date else "DATE_UNAVAILABLE",
            "tipo": lic.get("TIPO", ""),
            "matched": False,
            "current_matched": False,
            "historical_recovered": False,
            "coordinate": False,
            "barrio": False,
            "official_barrio": None,
            "spatial_barrio": None,
            "residual_state": "CAUSE_UNRESOLVED",
        }
        if not re.fullmatch(r"\d+", ndp or ""):
            result["residual_state"] = "MALFORMED_NDP"
            row_results.append(result)
            continue
        current_candidates = current_by_ndp.get(ndp, [])
        if len(current_candidates) > 1:
            result["residual_state"] = "AMBIGUOUS_NDP_MULTI_MATCH"
            row_results.append(result)
            continue
        if len(current_candidates) == 1:
            candidate = current_candidates[0]
            result["current_matched"] = True
            x, y = parse_decimal(candidate.get("UTMX_ETRS")), parse_decimal(candidate.get("UTMY_ETRS"))
            result["coordinate"] = x is not None and y is not None
            result["coordinate_key"] = f"{x:.2f},{y:.2f}" if result["coordinate"] else None
            official_barrio = current_barrio_code(candidate)
            result["official_barrio"] = official_barrio
            result["barrio"] = official_barrio is not None
            spatial = location(candidate)
            result["spatial_state"] = spatial["state"]
            result["spatial_barrio"] = spatial.get("barrio")
            result["boundary_distance_m"] = spatial.get("boundary_distance_m")
            result["district_consistent"] = (
                official_barrio in canonical_district_by_barrio
                and canonical_district_by_barrio[official_barrio] == f"{int(candidate['DISTRITO']):02d}"
            )
            lic_sig = licence_address_signature(lic)
            cal_sig = address_signature(candidate)
            # The callejero splits a leading particle and the licence file uses a
            # closed abbreviation vocabulary. Neither structural difference is a
            # disagreement. A missing callejero qualifier in licence Nº remains one.
            result["street_type_agrees"] = ascii_key(VIA_ABBREVIATIONS.get(canonical(lic.get("VIA")), "")) == cal_sig[0]
            result["street_name_agrees"] = lic_sig[1] == ascii_key(candidate.get("VIA_NOMBRE_ACENTOS") or candidate.get("VIA_NOMBRE"))
            result["street_number_agrees"] = lic_sig[2] == cal_sig[2]
            result["address_agrees"] = result["street_type_agrees"] and result["street_name_agrees"] and result["street_number_agrees"]
            if not result["coordinate"]:
                result["residual_state"] = "NDP_PRESENT_NO_COORDINATE"
            elif not result["barrio"]:
                result["residual_state"] = "NDP_PRESENT_NO_BARRIO"
            elif not result["address_agrees"]:
                result["matched"] = True
                result["residual_state"] = "ADDRESS_TEXT_DISAGREEMENT"
            else:
                result["matched"] = True
                result["residual_state"] = "RESOLVED"
            row_results.append(result)
            continue

        history = historical_by_ndp.get(ndp, [])
        if not history:
            result["residual_state"] = "NDP_ABSENT_CURRENT_CALLEJERO"
            row_results.append(result)
            continue
        if signature_date is None:
            result["residual_state"] = "DATE_UNRESOLVED"
            row_results.append(result)
            continue
        active = [r for r in history if historical_active(r, signature_date)]
        unique_versions = {(
            address_signature(r, historical=True), r.get("FECHA_DE_ALTA"), r.get("FECHA_DE_BAJA"),
            r.get("UTMX_ETRS"), r.get("UTMY_ETRS")
        ): r for r in active}
        if len(unique_versions) != 1:
            result["residual_state"] = "AMBIGUOUS_NDP_MULTI_MATCH" if len(unique_versions) > 1 else "CAUSE_UNRESOLVED"
            row_results.append(result)
            continue
        candidate = next(iter(unique_versions.values()))
        x, y = parse_decimal(candidate.get("UTMX_ETRS")), parse_decimal(candidate.get("UTMY_ETRS"))
        result["coordinate"] = x is not None and y is not None
        result["coordinate_key"] = f"{x:.2f},{y:.2f}" if result["coordinate"] else None
        spatial = location(candidate)
        result["spatial_state"] = spatial["state"]
        result["spatial_barrio"] = spatial.get("barrio")
        result["boundary_distance_m"] = spatial.get("boundary_distance_m")
        result["barrio"] = spatial.get("barrio") is not None
        if not result["coordinate"]:
            result["residual_state"] = "NDP_PRESENT_NO_COORDINATE"
        elif not result["barrio"]:
            result["residual_state"] = "NDP_PRESENT_NO_BARRIO"
        else:
            result["matched"] = True
            result["historical_recovered"] = True
            result["residual_state"] = "NDP_FOUND_HISTORICAL_ONLY"
        row_results.append(result)

    def grouped(field: str) -> dict:
        result = {}
        for key in sorted({r[field] for r in row_results}):
            subset = [r for r in row_results if r[field] == key]
            matched = sum(r["matched"] for r in subset)
            result[key] = {
                "rows": len(subset),
                "distinct_ndps": len({r["ndp"] for r in subset}),
                "matched": matched,
                "unmatched": len(subset) - matched,
                "match_rate": row_rate(matched, len(subset)),
            }
        return result

    matched_rows = sum(r["matched"] for r in row_results)
    matched_ndps = {r["ndp"] for r in row_results if r["matched"]}
    residual_counts = collections.Counter(r["residual_state"] for r in row_results)
    current_match_rows = sum(r["current_matched"] for r in row_results)
    historical_recovered_rows = sum(r["historical_recovered"] for r in row_results)
    current_matched = [r for r in row_results if r["current_matched"]]
    identified = [r for r in row_results if r["current_matched"] or r["historical_recovered"]]
    coordinate_counts = collections.Counter(r["coordinate_key"] for r in identified if r.get("coordinate_key"))
    spatial_states = collections.Counter(r.get("spatial_state", "NOT_CHECKED") for r in current_matched)
    all_spatial_states = collections.Counter(r.get("spatial_state", "NOT_CHECKED") for r in identified)
    barrio_agree = sum(
        r.get("official_barrio") == r.get("spatial_barrio")
        for r in current_matched
        if r.get("official_barrio") and r.get("spatial_barrio")
    )
    barrio_disagree = sum(
        r.get("official_barrio") != r.get("spatial_barrio")
        for r in current_matched
        if r.get("official_barrio") and r.get("spatial_barrio")
    )
    current_codes = {current_barrio_code(r) for r in current if current_barrio_code(r)}
    m3 = {
        "gate": "M3",
        "verdict": "GO_WITH_CONDITIONS",
        "overall": {
            "licence_rows": len(row_results),
            "distinct_licence_ndps": len(set(licence_ndps)),
            "matched_rows": matched_rows,
            "unmatched_rows": len(row_results) - matched_rows,
            "row_match_rate": row_rate(matched_rows, len(row_results)),
            "matched_distinct_ndps": len(matched_ndps),
            "unmatched_distinct_ndps": len(set(licence_ndps) - matched_ndps),
            "ndp_match_rate": row_rate(len(matched_ndps), len(set(licence_ndps))),
        },
        "current_and_historical": {
            "current_only_matched_rows": current_match_rows,
            "current_only_distinct_ndps": len({r["ndp"] for r in row_results if r["current_matched"]}),
            "historical_only_recovered_rows": historical_recovered_rows,
            "historical_only_recovered_distinct_ndps": len({r["ndp"] for r in row_results if r["historical_recovered"]}),
            "still_unresolved_rows": len(row_results) - matched_rows,
            "still_unresolved_distinct_ndps": len(set(licence_ndps) - matched_ndps),
        },
        "per_year": grouped("year"),
        "per_tipo": grouped("tipo"),
        "residual_taxonomy": dict(sorted(residual_counts.items())),
        "residual_taxonomy_is_exhaustive": sum(residual_counts.values()) == len(row_results),
        "coordinate_availability": {
            "matched_or_identified_rows": len(identified),
            "with_coordinate": sum(r["coordinate"] for r in row_results),
            "without_coordinate": sum((r["current_matched"] or r["historical_recovered"]) and not r["coordinate"] for r in row_results),
            "distinct_coordinate_pairs": len(coordinate_counts),
            "coordinate_pairs_used_by_multiple_rows": sum(count > 1 for count in coordinate_counts.values()),
            "rows_at_shared_coordinate_pairs": sum(count for count in coordinate_counts.values() if count > 1),
            "outside_municipality": all_spatial_states.get("OUTSIDE_MUNICIPALITY", 0),
        },
        "barrio_availability": {
            "with_barrio": sum(r["barrio"] for r in row_results),
            "with_official_current_callejero_barrio": sum(bool(r.get("official_barrio")) for r in row_results),
            "historical_barrio_derived_from_official_coordinate_and_canonical_polygon": sum(r["historical_recovered"] and r["barrio"] for r in row_results),
            "without_barrio_among_identified": sum((r["current_matched"] or r["historical_recovered"]) and not r["barrio"] for r in row_results),
        },
        "barrio_era": {
            "callejero_distinct_codes": len(current_codes),
            "canonical_current_codes": len(canonical_barrio_ids),
            "exact_code_set_match": current_codes == canonical_barrio_ids,
            "unknown_codes": sorted(current_codes - canonical_barrio_ids),
            "canonical_codes_missing_from_callejero": sorted(canonical_barrio_ids - current_codes),
            "source_publishes_barrio_names": False,
            "name_check": "NOT_APPLICABLE; the current address CSV publishes official district/barrio codes but no names",
        },
        "district_barrio_consistency": {
            "checked_rows": len(current_matched),
            "consistent": sum(r.get("district_consistent", False) for r in current_matched),
            "disagreements": sum(not r.get("district_consistent", False) for r in current_matched),
        },
        "spatial_cross_check": {
            "scope": "diagnostic validation of current callejero official codes; official codes are not overwritten",
            "official_barrio_agrees_with_polygon": barrio_agree,
            "official_barrio_disagrees_with_polygon": barrio_disagree,
            "states": dict(sorted(spatial_states.items())),
            "near_boundary_threshold_m": 1.0,
            "outside_municipality": spatial_states.get("OUTSIDE_MUNICIPALITY", 0),
        },
        "address_text": {
            "disagreement_rows": residual_counts.get("ADDRESS_TEXT_DISAGREEMENT", 0),
            "street_type_disagreement_rows": sum(r.get("current_matched") and not r.get("street_type_agrees", True) for r in row_results),
            "street_name_disagreement_rows": sum(r.get("current_matched") and not r.get("street_name_agrees", True) for r in row_results),
            "street_number_or_qualifier_disagreement_rows": sum(r.get("current_matched") and not r.get("street_number_agrees", True) for r in row_results),
            "licence_via_abbreviation_map": VIA_ABBREVIATIONS,
            "join_authority": "Exact NDP identity remains authoritative; text disagreement is retained as a quality flag and never used to override NDP.",
        },
        "residual_samples": {
            state: sorted({r["ndp"] for r in row_results if r["residual_state"] == state})[:20]
            for state in sorted(residual_counts)
            if state != "RESOLVED"
        },
    }

    tipo_counts = collections.Counter(r.get("TIPO", "") for r in licences)
    family_counts = collections.Counter()
    unclassified = []
    for tipo, count in tipo_counts.items():
        family = TIPO_FAMILIES.get(tipo)
        if family is None:
            unclassified.append(tipo)
        else:
            family_counts[family] += count
    protection_counts = collections.Counter(
        r.get("NIVEL_PROTECCION", "") or "EMPTY" for r in licences
    )
    both_missing = sum(not r.get("NIVEL_PROTECCION") and not r.get("NORMA_ZONAL") for r in licences)
    only_protection = sum(not r.get("NIVEL_PROTECCION") and bool(r.get("NORMA_ZONAL")) for r in licences)
    only_norma = sum(bool(r.get("NIVEL_PROTECCION")) and not r.get("NORMA_ZONAL") for r in licences)
    m4 = {
        "gate": "M4",
        "verdict": "GO_WITH_CONDITIONS",
        "resolucion": {
            "distinct_values": sorted({r.get("RESOLUCION", "") for r in licences}),
            "counts": dict(sorted(collections.Counter(r.get("RESOLUCION", "") for r in licences).items())),
            "ceiling": "Granted records only; no applications, refusals, withdrawals, approval rate, rejection rate, success rate, or processing-performance denominator.",
        },
        "tipo": {
            "counts": dict(sorted(tipo_counts.items())),
            "classification": {tipo: TIPO_FAMILIES.get(tipo) for tipo in sorted(tipo_counts)},
            "family_counts": dict(sorted(family_counts.items())),
            "unclassified_values": sorted(unclassified),
            "unclassified_rows": sum(tipo_counts[t] for t in unclassified),
        },
        "nivel_proteccion": {
            "counts": dict(sorted(protection_counts.items())),
            "absence_states_kept_distinct": ["EMPTY", "Sin Catalogar", "Sin protección"],
        },
        "norma_zonal_missingness": {
            "missing": sum(not r.get("NORMA_ZONAL") for r in licences),
            "both_missing": both_missing,
            "only_protection_missing": only_protection,
            "only_norma_missing": only_norma,
            "neither_missing": len(licences) - both_missing - only_protection - only_norma,
        },
        "declaraciones_responsables": {
            "dataset_id": declaration_pkg["name"],
            "title": declaration_pkg["title"],
            "publisher_description": declaration_pkg.get("notes"),
            "licence": declaration_pkg.get("license_title"),
            "declared_cadence": "MONTHLY",
            "catalogue_metadata_modified": declaration_pkg.get("metadata_modified"),
            "relationship": "Distinct legal instrument (responsible declarations presented), never joined or summed into granted licences.",
            "recommendation": "Exclude from #71; a later feature may expose it only as a separate, clearly labelled evidence family.",
        },
        "overlap_ceiling": "Licence rows are administrative acts and may concern premises/dwellings also present in Censo de Locales, licensed VUT, or hospitality/activity evidence. No deterministic entity link was established here; users must never sum these universes as unique places or businesses.",
        "product_recommendation": "C — expose building/urbanistic, activity, and temporary-activity families only as an explicit categorical union with separate counts and filters; never a silent combined total.",
        "construction_ceiling": "A grant is not evidence that work started, construction occurred or completed, occupancy happened, or the permitted quantity was built.",
        "sensitive_data": {
            "publisher_statement": "The structure document states the file is aggregated and anonymised and contains no personal data.",
            "observed_persona_interesada_role": "category of person type, not a personal name",
            "future_minimisation": "Do not carry PERSONA_INTERESADA or other unnecessary attributes into a production artifact.",
        },
    }

    date_fields = ["FECHA_ALTA", "FECHA_FIRMA_RESOLUCION"]
    date_audits = {}
    component_map = {
        "FECHA_ALTA": ("FECHA_ALTA - Año", "FECHA_ALTA - Mes", "FECHA_ALTA - Día"),
        "FECHA_FIRMA_RESOLUCION": (
            "FECHA_FIRMA_RESOLUCION - Año",
            "FECHA_FIRMA_RESOLUCION - Mes",
            "FECHA_FIRMA_RESOLUCION - Día",
        ),
    }
    for field in date_fields:
        values = [r.get(field, "") for r in licences]
        observed_values: dict[str, dict] = {}
        parse_failures = []
        weekday_failures = []
        component_failures = []
        for i, (row, value) in enumerate(zip(licences, values)):
            if not value:
                continue
            try:
                parsed, weekday_ok = parse_spanish_date(value)
            except ValueError:
                parse_failures.append(i)
                continue
            if not weekday_ok:
                weekday_failures.append(i)
            year_f, month_f, day_f = component_map[field]
            expected_month = next((number for name, number in MONTHS.items() if ascii_key(name) == ascii_key(row.get(month_f))), None)
            if (
                str(parsed.year) != row.get(year_f, "")
                or expected_month != parsed.month
                or str(parsed.day) != row.get(day_f, "")
            ):
                component_failures.append(i)
            observed_values.setdefault(value, {
                "count": 0,
                "iso_date": parsed.isoformat(),
                "publisher_year": row.get(year_f, ""),
                "publisher_month": row.get(month_f, ""),
                "publisher_day": row.get(day_f, ""),
            })["count"] += 1
        date_audits[field] = {
            "rows": len(licences),
            "non_empty": sum(bool(v) for v in values),
            "missing": sum(not v for v in values),
            "parsed": sum(bool(v) for v in values) - len(parse_failures),
            "parse_failure_count": len(parse_failures),
            "parse_failure_rows": parse_failures,
            "weekday_failure_count": len(weekday_failures),
            "weekday_failure_rows": weekday_failures,
            "publisher_component_failure_count": len(component_failures),
            "publisher_component_failure_rows": component_failures,
            "observed_values": dict(sorted(observed_values.items())),
        }
    m5 = {
        "gate": "M5",
        "verdict": "GO" if all(
            not audit["parse_failure_count"]
            and not audit["weekday_failure_count"]
            and not audit["publisher_component_failure_count"]
            for audit in date_audits.values()
        ) else "MODIFY",
        "parser_contract": {
            "weekdays": WEEKDAYS,
            "months": MONTHS,
            "grammar": "<weekday>, <day> de <month> de <year>; exact lower-case Spanish vocabulary after lower-casing; no locale and no fuzzy parsing",
            "source_observed_orthographic_variants": [],
        },
        "fields": date_audits,
        "licence_date_rule": {
            "field": "FECHA_FIRMA_RESOLUCION",
            "reason": "Publisher structure documentation defines it as the date the resolution was signed; FECHA_ALTA is the expediente's registry-entry date.",
            "missing_signature_handling": "DATE_UNAVAILABLE; never substitute FECHA_ALTA without publisher authorisation.",
        },
    }

    future_contract = {
        "minimum_record_shape": [
            "exact_ndp", "official_coordinate", "coordinate_crs", "barrio_code",
            "district_code", "crosswalk_state", "address_identity_provenance",
            "licence_date", "callejero_source_identity",
        ],
        "states_supported_by_observation": sorted(residual_counts),
        "rules": [
            "Do not emit geometry for ambiguous or date-unresolved historical identity.",
            "Preserve official barrio and diagnostic polygon barrio separately; never overwrite silently.",
            "Preserve the pinned current edition or dated historical-version identity with every resolution.",
        ],
    }
    summary = {
        "overall_verdict": "GO WITH CONDITIONS" if matched_rows else "NO-GO",
        "recommendation": "#71 GO WITH CONDITIONS" if matched_rows else "#71 NO-GO",
        "conditions": [
            "Use the exact official NDP join and the pinned current+historical callejero resources.",
            "Use date-aware historical selection and withhold ambiguous/date-unresolved geometry.",
            "Keep building, activity, and temporary-activity families explicit and separate.",
            "Retain all absence/residual states and the granted-not-built interpretation ceiling.",
        ],
        "future_crosswalk_contract": future_contract,
        "no_production_artifact": True,
    }
    return {"m1_source.json": m1, "m2_ndp.json": m2, "m3_match.json": m3, "m4_universe.json": m4, "m5_dates.json": m5, "summary.json": summary}


def run_all() -> None:
    reports = build_all()
    for name, report in reports.items():
        output_json(name, report)
        print(f"wrote {RESULTS / name}")


if __name__ == "__main__":
    run_all()
