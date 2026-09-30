#!/usr/bin/env python3
"""Gate B source audit: can an authoritative accommodation numerator reach barrio level?

Run on demand against the LIVE official sources; it is not part of the test
suite and nothing in the application depends on it. It writes compact JSON
reports next to this file so a reviewer can see what was observed, when, and
from which resource fingerprint. Raw upstream downloads are held in memory and
never committed.

    python research/accommodation_gate_b/audit_gate_b.py

Candidates audited
------------------
A  Ayuntamiento de Madrid, "Viviendas de uso turistico con licencia"
   (datos.madrid.es 300694) - municipal urban-planning activity licences.
B  Comunidad de Madrid, "Alojamientos turisticos de la Comunidad de Madrid"
   (datos.comunidad.madrid) - regional tourism-accommodation inventory.

Supporting official sources
---------------------------
* Callejero oficial del Ayuntamiento de Madrid (datos.madrid.es 213605),
  resource "direcciones vigentes": the municipal address register, which
  publishes an official DISTRITO and BARRIO code for every current address.
  It is used two ways: as an independent check of Candidate A's geometric
  barrio join, and as the deterministic reconciliation path for Candidate B,
  which publishes addresses but no coordinates.
* "Numero de establecimientos hoteleros por tipo de establecimiento. Municipios"
  (Comunidad de Madrid) - municipality-level control totals. Used only as an
  external reconciliation reference, never to distribute counts into barrios.
* "Declaraciones responsables de actividad de viviendas de uso turistico"
  (Comunidad de Madrid) - a DIFFERENT legal universe, inspected only to
  interpret Candidate B's VUT semantics. Never merged into either candidate.

Dependencies: standard library, plus shapely and pyproj for Candidate A's
geometry (the same builder-only dependencies as scripts/build_madrid_geography.py).
"""

from __future__ import annotations

import collections
import csv
import datetime as _dt
import io
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from build_vut_licence_numerator import (          # noqa: E402  (path set above)
    district_label_key,
    fetch,
    normalise_text,
    parse_licence_rows,
    parse_units,
    read_dbf,
    read_shp_points,
    read_xlsx_rows,
    summarise_grant_dates,
)

HERE = Path(__file__).resolve().parent
GEOGRAPHY = REPO_ROOT / "data" / "geography" / "madrid_admin.geojson"

MADRID_CKAN = "https://datos.madrid.es/api/3/action/package_show?id="
CM_CKAN = "https://datos.comunidad.madrid/api/3/action/package_show?id="
CANDIDATE_A_PKG = "300694-0-viviendas-turisticas-geoportal"
CALLEJERO_PKG = "213605-0-callejero-oficial-madrid"
CANDIDATE_B_PKG = "alojamientos_turisticos"
CONTROL_PKG = "establecimientos_hoteleros"
DECLARATIONS_PKG = "declaraciones_actividad_viviendas_uso_turistico"

# Candidate B writes via types as abbreviations; the municipal register spells
# them out. The mapping is closed, explicit and checked: an unmapped abbreviation
# is reported rather than silently guessed.
VIA_CLASS = {
    "CALLE": "CALLE", "PLAZA": "PLAZA", "AVDA": "AVENIDA", "AVIA": "AVENIDA",
    "PASEO": "PASEO", "CRA": "CARRERA", "RONDA": "RONDA", "CSTAN": "COSTANILLA",
    "TRVA": "TRAVESIA", "CUSTA": "CUESTA", "GTA": "GLORIETA", "CTRA": "CARRETERA",
    "PSAJE": "PASAJE", "CMNO": "CAMINO", "CLLON": "CALLEJON", "BULEV": "BULEVAR",
}
PARTICLES = ("DE LOS", "DE LAS", "DE LA", "DEL", "DE", "LOS", "LAS", "LA", "EL", "A LA")


def package(url: str) -> dict:
    payload, _ = fetch(url)
    return json.loads(payload.decode("utf-8"))["result"]


def resource_url(pkg: dict, fmt: str, needle: str = "") -> str:
    for resource in pkg["resources"]:
        if (resource.get("format") or "").upper() == fmt.upper():
            haystack = f"{resource.get('description', '')} {resource.get('url', '')}".lower()
            if needle.lower() in haystack:
                return resource["url"]
    raise SystemExit(f"no {fmt} resource matching {needle!r} in {pkg['name']}")


def fold(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(c for c in text if not unicodedata.combining(c)).upper()
    return " ".join(re.sub(r"[^A-Z0-9 ]", " ", text).split())


def street_core(name: str) -> str:
    """Strip leading particles and articles from a folded street name.

    The municipal register splits the particle into its own VIA_PAR column
    ("DE" + "LOS MADRAZO"), while Candidate B keeps it inline ("de Los Madrazo").
    Stripping repeatedly on both sides makes the two spellings meet, without any
    fuzzy or approximate matching.
    """
    changed = True
    while changed:
        changed = False
        for particle in PARTICLES:
            if name == particle:
                return name
            if name.startswith(particle + " "):
                name = name[len(particle) + 1:]
                changed = True
                break
    return name


def load_geography():
    from shapely.geometry import shape
    features = json.loads(GEOGRAPHY.read_text(encoding="utf-8"))["features"]
    by_level = lambda level: [f for f in features if f["properties"]["geography_level"] == level]
    return (
        shape(by_level("municipality")[0]["geometry"]),
        [(f["properties"], shape(f["geometry"])) for f in by_level("district")],
        [(f["properties"], shape(f["geometry"])) for f in by_level("barrio")],
    )


def load_callejero() -> tuple[list[dict], dict]:
    pkg = package(MADRID_CKAN + CALLEJERO_PKG)
    url = resource_url(pkg, "CSV", "direccionesvigentes")
    payload, http = fetch(url)
    rows = list(csv.DictReader(io.StringIO(payload.decode("cp1252")), delimiter=";"))
    http["url"] = url
    http["catalogue_metadata_modified"] = pkg.get("metadata_modified")
    return rows, http


def barrio_id(row: dict) -> str:
    """Canonical barrio id from the register's district + local barrio number."""
    return f"{int(row['DISTRITO']):02d}{int(row['BARRIO'])}"


# ------------------------------------------------------------- candidate A


def audit_candidate_a(callejero: list[dict]) -> dict:
    from pyproj import Transformer
    from shapely.geometry import Point

    pkg = package(MADRID_CKAN + CANDIDATE_A_PKG)
    xlsx_url = resource_url(pkg, "XLSX")
    zip_url = resource_url(pkg, "ZIP")
    xlsx_bytes, xlsx_http = fetch(xlsx_url)
    zip_bytes, zip_http = fetch(zip_url)

    grid = read_xlsx_rows(xlsx_bytes)
    licences = parse_licence_rows(grid)
    populated = [r for r in grid[1:] if any((v or "").strip() for v in r.values())]

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = {Path(n).suffix.lower(): n for n in zf.namelist()}
        dbf = read_dbf(zf.read(names[".dbf"]))
        points = read_shp_points(zf.read(names[".shp"]))
        prj = zf.read(names[".prj"]).decode("latin-1")

    xlsx_exp = [normalise_text(r.get("EXPEDIENTE_LU")) for r in licences]
    dbf_exp = [normalise_text(r.get("EXPEDIENTE")) for r in dbf]
    geometry_by_exp = dict(zip(dbf_exp, points))

    municipality, districts, barrios = load_geography()
    transformer = Transformer.from_crs("EPSG:25830", "EPSG:4326", always_xy=True)
    ndp_barrio: dict[str, set[str]] = collections.defaultdict(set)
    for row in callejero:
        ndp_barrio[row["COD_NDP"]].add(barrio_id(row))

    resolved = inside = 0
    label_mismatch, register_mismatch, register_unresolved = [], [], []
    per_barrio: dict[str, dict[str, int]] = {}
    for licence in licences:
        exp = normalise_text(licence.get("EXPEDIENTE_LU"))
        units = parse_units(licence.get("UNIDADES_VUT"))
        point = geometry_by_exp.get(exp)
        if point is None:
            continue
        lon, lat = transformer.transform(*point)
        geom = Point(lon, lat)
        if municipality.covers(geom):
            inside += 1
        district = next((p for p, poly in districts if poly.covers(geom)), None)
        barrio = next((p for p, poly in barrios if poly.covers(geom)), None)
        if barrio:
            resolved += 1
            bucket = per_barrio.setdefault(barrio["official_id"], {"licences": 0, "units": 0})
            bucket["licences"] += 1
            bucket["units"] += units
        if district and district_label_key(licence.get("DISTRITO")) != district_label_key(district["official_name"]):
            label_mismatch.append({
                "expediente": exp,
                "source_label": normalise_text(licence.get("DISTRITO")),
                "geometry_district": f"{district['official_id']} {district['official_name']}",
                "geometry_barrio": f"{barrio['official_id']} {barrio['official_name']}" if barrio else None,
            })
        # Independent check: the official address register also publishes a
        # barrio for this licence's COD_NDP, derived from the address, not the
        # geometry. Agreement means two unrelated official paths concur.
        ndp = normalise_text(licence.get("COD_NDP"))
        candidates = ndp_barrio.get(ndp, set())
        if len(candidates) != 1:
            register_unresolved.append(exp)
        elif barrio and next(iter(candidates)) != barrio["official_id"]:
            register_mismatch.append(exp)

    coords = collections.Counter(p for p in points if p)
    ndp_counts = collections.Counter(normalise_text(r.get("COD_NDP")) for r in licences)
    lf_exp = [normalise_text(r.get("EXPEDIENTE_LF")) for r in licences if normalise_text(r.get("EXPEDIENTE_LF"))]

    return {
        "candidate": "A",
        "dataset": {
            "title": pkg.get("title"),
            "dataset_id": pkg.get("name"),
            "catalogue": f"https://datos.madrid.es/dataset/{pkg.get('name')}",
            "publisher": pkg.get("author"),
            "responsible_unit": "Agencia de Actividades - Subdireccion General de Actividades Economicas - Servicio de Licencias y Consultas (per the dataset's own structure document)",
            "license": pkg.get("license_title"),
            "update_frequency": pkg.get("frequency"),
            "catalogue_metadata_modified": pkg.get("metadata_modified"),
            "documentation_resource_published": any(
                (r.get("format") or "").upper() == "PDF" for r in pkg["resources"]
            ),
        },
        "resources": {
            "xlsx": {"url": xlsx_url, **xlsx_http},
            "shp_zip": {"url": zip_url, **zip_http},
        },
        "schema": {
            "xlsx_columns": [v for v in grid[0].values()],
            "dbf_columns": sorted({k for r in dbf for k in r}),
            "note": "The XLSX carries COD_NDP (official municipal address code) and TIPO, which the structure document does not list; the SHP carries the funcionamiento-licence fields. Header labels for the two trailing XLSX columns are transposed relative to their content.",
        },
        "records": {
            "xlsx_populated_rows": len(populated),
            "xlsx_licence_rows": len(licences),
            "xlsx_trailer_rows_dropped": len(populated) - len(licences),
            "trailer_note": "The workbook ends with publisher COUNTIF/SUM formula rows over the data range. Counting populated rows, or summing the unit column over the sheet, would overstate the numerator.",
            "dbf_records": len(dbf),
            "shp_geometries": len(points),
            "null_geometries": sum(1 for p in points if p is None),
            "xlsx_shp_expediente_sets_identical": sorted(set(xlsx_exp)) == sorted(set(dbf_exp)),
            "row_order_matches_between_resources": sum(a == b for a, b in zip(xlsx_exp, dbf_exp)),
            "row_order_note": "The resources are published in different row orders, so they must be joined by EXPEDIENTE, not positionally.",
        },
        "unit_of_analysis": {
            "documented_row": "one granted urban-planning activity licence (expediente)",
            "documented_n_vut": "numero de unidades de viviendas de uso turistico incluidas en cada licencia urbanistica de actividad",
            "licences": len(licences),
            "vut_units": sum(parse_units(r.get("UNIDADES_VUT")) for r in licences),
            "units_per_licence_distribution": dict(sorted(collections.Counter(
                parse_units(r.get("UNIDADES_VUT")) for r in licences).items())),
            "max_units_in_one_licence": max(parse_units(r.get("UNIDADES_VUT")) for r in licences),
        },
        "identity": {
            "key": "EXPEDIENTE_LU",
            "rows": len(xlsx_exp),
            "unique": len(set(xlsx_exp)),
            "blank": sum(1 for e in xlsx_exp if not e),
            "funcionamiento_expedientes_present": len(lf_exp),
            "funcionamiento_expedientes_unique": len(set(lf_exp)),
            "funcionamiento_note": "One funcionamiento expediente can cover several activity licences, so it is not a record identity.",
        },
        "duplicates": {
            "unique_official_address_codes": len({k for k in ndp_counts if k}),
            "addresses_with_more_than_one_licence": sum(1 for v in ndp_counts.values() if v > 1),
            "max_licences_at_one_address": max(ndp_counts.values()),
            "unique_coordinates": len(coords),
            "interpretation": "Unique coordinates equal unique official address codes: geometry is published at address granularity, and several licences at one address are distinct licences, not duplicates.",
        },
        "grant_decision": dict(collections.Counter(r.get("DECRETO_LU") for r in licences)),
        "temporal": {
            "reference_date_field_published": False,
            "effective_date_published": False,
            "catalogue_metadata_modified": pkg.get("metadata_modified"),
            "xlsx_http_last_modified": xlsx_http["last_modified"],
            "http_last_modified_is_not_a_reference_date": "The HTTP header describes the file served, not a publisher-declared publication, effective or reference date. The source declares none.",
            "retention_policy_published": False,
            "retention_note": "The source publishes no policy for how revoked, expired or ceased licences are retained or removed, so the extract is not described as a cumulative stock. What is verifiable: the current published extract contains granted activity-licence records whose grant dates span the range below, and it carries no revocation, expiry or cessation field.",
            **summarise_grant_dates([r.get("RESOLUCION", "") for r in dbf]),
        },
        "geography": {
            "source_crs_declared": "EPSG:25830" if ("25830" in prj or "UTM_Zone_30N" in prj) else prj[:80],
            "records_with_geometry": sum(1 for p in points if p),
            "inside_municipality": inside,
            "resolved_to_barrio": resolved,
            "barrios_represented": len(per_barrio),
            "barrios_total": len(barrios),
            "district_label_disagreements": label_mismatch,
            "address_register_cross_check": {
                "method": "COD_NDP looked up in the official municipal address register, which publishes its own DISTRITO/BARRIO codes derived from the address rather than from geometry.",
                "unresolved_in_register": len(register_unresolved),
                "barrio_disagreements": len(register_mismatch),
            },
        },
        "top_barrios_by_units": sorted(
            ({"barrio": b, **v} for b, v in per_barrio.items()),
            key=lambda x: -x["units"],
        )[:10],
    }


# ------------------------------------------------------------- candidate B


def audit_candidate_b(callejero: list[dict]) -> dict:
    pkg = package(CM_CKAN + CANDIDATE_B_PKG)
    extras = {e["key"]: e["value"] for e in pkg.get("extras", [])}
    json_url = resource_url(pkg, "JSON")
    csv_url = resource_url(pkg, "CSV")
    json_bytes, json_http = fetch(json_url)
    csv_bytes, csv_http = fetch(csv_url)
    rows = json.loads(json_bytes.decode("utf-8"))["data"]
    csv_rows = list(csv.DictReader(io.StringIO(csv_bytes.decode("utf-8-sig")), delimiter=";"))

    localidad = collections.Counter(r["localidad"] for r in rows)
    madrid = [r for r in rows if r["localidad"] == "Madrid"]
    substring = [r for r in rows if "madrid" in r["localidad"].lower()]

    signatura = [r["signatura"] for r in rows]
    types = collections.Counter(r["alojamiento_tipo"] for r in madrid)

    # Deterministic reconciliation against the official municipal address register.
    portal_with_class: dict[tuple, set[str]] = collections.defaultdict(set)
    portal_any_class: dict[tuple, set[str]] = collections.defaultdict(set)
    street_only: dict[str, set[str]] = collections.defaultdict(set)
    for row in callejero:
        name = street_core(fold(f"{row['VIA_PAR']} {row['VIA_NOMBRE_ACENTOS']}"))
        code = barrio_id(row)
        street_only[name].add(code)
        try:
            number = int(row["NUMERO"])
        except (TypeError, ValueError):
            continue
        portal_with_class[(fold(row["VIA_CLASE"]), name, number)].add(code)
        portal_any_class[(name, number)].add(code)

    outcomes = collections.Counter()
    per_barrio: dict[str, int] = collections.Counter()
    unmapped_via_types = collections.Counter()
    for record in madrid:
        via_type = record["via_tipo"].strip().upper()
        via_class = VIA_CLASS.get(via_type)
        if via_class is None:
            unmapped_via_types[via_type] += 1
        name = street_core(fold(record["via_nombre"]))
        match = re.match(r"\s*(\d+)", record["numero"] or "")
        number = int(match.group(1)) if match else None
        code = None
        if not name:
            outcome = "no_street_name"
        elif number is not None and via_class and len(portal_with_class.get((via_class, name, number), ())) == 1:
            code = next(iter(portal_with_class[(via_class, name, number)]))
            outcome = "exact_portal"
        elif number is not None and len(portal_any_class.get((name, number), ())) == 1:
            code = next(iter(portal_any_class[(name, number)]))
            outcome = "portal_match_ignoring_via_class"
        elif number is not None and (name, number) in portal_any_class:
            outcome = "portal_ambiguous_across_barrios"
        elif len(street_only.get(name, ())) == 1:
            code = next(iter(street_only[name]))
            outcome = "street_lies_in_one_barrio"
        elif name in street_only:
            outcome = "street_spans_several_barrios"
        else:
            outcome = "street_not_found_in_register"
        outcomes[outcome] += 1
        if code:
            per_barrio[code] += 1

    resolved = sum(per_barrio.values())
    return {
        "candidate": "B",
        "dataset": {
            "title": pkg.get("title"),
            "dataset_id": pkg.get("name"),
            "catalogue": f"https://datos.comunidad.madrid/dataset/{pkg.get('name')}",
            "publisher": "Comunidad de Madrid",
            "responsible_unit": extras.get("Dirección General"),
            "consejeria": extras.get("Consejería"),
            "license": pkg.get("license_title"),
            "update_frequency": extras.get("Frecuencia de actualización de datos"),
            "geographic_coverage": extras.get("Cobertura geográfica"),
            "temporal_coverage_declared": extras.get("Cobertura temporal") or None,
            "catalogue_metadata_modified": pkg.get("metadata_modified"),
            "self_description": pkg.get("notes"),
            "documentation_resource_published": any(
                (r.get("format") or "").upper() == "PDF" for r in pkg["resources"]
            ),
            "universe_statement_published": False,
            "universe_note": "The dataset states no legal universe, no active/inactive semantics and no reference period. That a registry is meant is inferred only from the sibling declarations dataset, which describes itself as VUT 'sin inscripcion en el Registro de Empresas Turisticas'. An inference is not a source contract.",
        },
        "resources": {"json": {"url": json_url, **json_http}, "csv": {"url": csv_url, **csv_http}},
        "records": {
            "json_rows": len(rows),
            "csv_rows": len(csv_rows),
            "csv_json_agree": len(rows) == len(csv_rows) and all(
                all((a.get(k) or "") == (b.get(k) or "") for k in rows[0]) for a, b in zip(rows, csv_rows)
            ),
            "fields": list(rows[0].keys()),
        },
        "madrid_selection": {
            "rule": "localidad == 'Madrid' (exact equality)",
            "madrid_records": len(madrid),
            "distinct_localidad_values": len(localidad),
            "values_containing_madrid": {k: v for k, v in sorted(localidad.items()) if "madrid" in k.lower()},
            "naive_substring_match_would_return": len(substring),
            "naive_substring_overcount": len(substring) - len(madrid),
            "municipality_code_field_published": False,
            "note": "localidad is free text with no INE municipality code. Exact equality is correct on the observed values; a substring rule would wrongly absorb three other municipalities.",
        },
        "identity": {
            "key": "signatura",
            "rows": len(signatura),
            "unique": len(set(signatura)),
            "blank": sum(1 for s in signatura if not (s or "").strip()),
            "prefixes": dict(collections.Counter(s.split("-")[0] for s in signatura if s).most_common()),
        },
        "taxonomy_madrid": {
            "alojamiento_tipo": {repr(k): v for k, v in types.most_common()},
            "categoria": dict(collections.Counter(r["categoria"] for r in madrid).most_common()),
            "truncation_note": "alojamiento_tipo is truncated to 20 characters: the VUT value is literally 'VIVIENDAS DE USO TU ' with a trailing space, so an equality filter on the full phrase returns nothing.",
        },
        "unit_of_analysis": {
            "documented": False,
            "observed": "Mixed granularity. VT rows carry floor and door and describe individual dwellings; HM/AM rows describe whole establishments. One record is one registry entry, not uniformly one establishment.",
        },
        "address_quality_madrid": {
            field: sum(1 for r in madrid if (r[field] or "").strip())
            for field in ["via_tipo", "via_nombre", "numero", "bloque", "portal", "escalera", "planta", "puerta", "cdpostal"]
        },
        "duplicates_madrid": {
            "identical_full_address_groups": sum(
                1 for v in collections.Counter(
                    tuple(fold(r[f]) for f in ["via_tipo", "via_nombre", "numero", "bloque", "portal", "escalera", "planta", "puerta"])
                    for r in madrid).values() if v > 1),
            "buildings_with_more_than_one_record": sum(
                1 for v in collections.Counter(
                    (fold(r["via_tipo"]), fold(r["via_nombre"]), fold(r["numero"])) for r in madrid).values() if v > 1),
            "blank_denominacion": sum(1 for r in madrid if not (r["denominacion"] or "").strip()),
            "note": "Address-based deduplication would be wrong: the puerta/escalera fields are truncated by the source, so distinct dwellings collapse onto an identical structured address while their denominacion still distinguishes them. Identity must come from signatura.",
        },
        "barrio_reconciliation": {
            "method": "Deterministic join to the official municipal address register (datos.madrid.es 213605, 'direcciones vigentes'), which publishes an official barrio code per address. No commercial geocoder and no fuzzy matching.",
            "outcomes": dict(outcomes.most_common()),
            "resolved_to_single_barrio": resolved,
            "records": len(madrid),
            "resolution_rate": round(resolved / len(madrid), 4),
            "barrios_represented": len(per_barrio),
            "unmapped_via_types": dict(unmapped_via_types),
        },
        "temporal": {
            "portal_declared_dataset_state_date": pkg.get("metadata_modified"),
            "portal_declared_dataset_state_note": "The official portal does date the CURRENT dataset state ('Última actualización de los datos'). The current state can therefore be cited honestly; what is missing is everything below.",
            "record_level_reference_or_effective_date": False,
            "temporal_coverage_declared": extras.get("Cobertura temporal") or None,
            "historical_snapshots_published": False,
            "previous_states_reconstructable": False,
            "json_http_last_modified": json_http["last_modified"],
            "http_last_modified_is_not_a_reference_date": "The HTTP header describes the file served, not a publisher-declared reference or effective period. It is recorded separately from the portal's declared state date.",
            "assessment": "CONDITIONAL, not absent. The current published dataset state is dated by the portal, so it can be cited honestly. But no record carries an effective or reference date, no temporal coverage is declared, and the file is overwritten weekly with no archive, so a past state cannot be reconstructed or re-verified and no longitudinal period semantics exist.",
        },
    }


# ------------------------------------------------- control + adjacent source


def audit_control_and_declarations(candidate_b: dict) -> dict:
    control_pkg = package(CM_CKAN + CONTROL_PKG)
    control_bytes, control_http = fetch(resource_url(control_pkg, "JSON"))
    control = json.loads(control_bytes.decode("utf-8"))["data"]
    madrid = [r for r in control if r["Tipo territorio"] == "Municipios" and r["Territorio"] == "Madrid"]
    latest = max(r["Año"] for r in madrid)
    values = {r["Tipo"]: int(r["Valor"]) for r in madrid if r["Año"] == latest}

    decl_pkg = package(CM_CKAN + DECLARATIONS_PKG)
    decl_bytes, decl_http = fetch(resource_url(decl_pkg, "JSON"))
    decl = json.loads(decl_bytes.decode("utf-8"))["data"]
    decl_madrid = [r for r in decl if r["Localidad"] == "Madrid"]

    observed = {k.strip("'"): v for k, v in candidate_b["taxonomy_madrid"]["alojamiento_tipo"].items()}
    pairs = [
        ("HOTEL", "Total hoteles"),
        ("HOSTAL", "Total hostales con estrellas"),
        ("APART-TURISTICO", "Total apartamentos turísticos con llaves"),
        ("HOTEL-APART.", "Total hoteles-apartamentos con estrellas"),
        ("HOSTERIAS", "Total hosterías"),
        ("CAMPING", "Total campamentos de turismo"),
    ]
    comparison = {}
    for observed_key, control_key in pairs:
        got = observed.get(observed_key, 0)
        comparison[observed_key] = {
            "candidate_b": got, "control": values.get(control_key, 0),
            "difference": got - values.get(control_key, 0),
        }
    pensions = observed.get("PENSION", 0) + observed.get("CASA HUESPEDES", 0)
    comparison["PENSION + CASA HUESPEDES"] = {
        "candidate_b": pensions, "control": values["Total pensiones"],
        "difference": pensions - values["Total pensiones"],
    }
    vut_observed = observed.get("VIVIENDAS DE USO TU ", 0)
    non_vut_observed = sum(v for k, v in observed.items() if k.strip() != "VIVIENDAS DE USO TU")
    non_vut_control = values["Total establecimientos hoteleros"] - values["Viviendas de uso turístico"]

    return {
        "control": {
            "dataset": control_pkg.get("title"),
            "catalogue": f"https://datos.comunidad.madrid/dataset/{control_pkg.get('name')}",
            "authority": {e["key"]: e["value"] for e in control_pkg.get("extras", [])}.get("Fuente"),
            "http_last_modified": control_http["last_modified"],
            "latest_year_for_madrid": latest,
            "universe_composition": control_pkg.get("notes", "")[:400],
            "madrid_totals": values,
        },
        "reconciliation": {
            "note": "Compared only because the control's stated composition matches Candidate B's taxonomy. The control is evidence, never a target: no Candidate B figure is adjusted towards it.",
            "period_mismatch": f"Candidate B is a current state dated {candidate_b['temporal']['portal_declared_dataset_state_date']} by the portal; the control's latest Madrid figure is the year {latest}. The periods differ, so no difference here is fully reconciled.",
            "by_type": comparison,
            "non_vut_total": {
                "candidate_b": non_vut_observed, "control": non_vut_control,
                "difference": non_vut_observed - non_vut_control,
                "relative": round((non_vut_observed - non_vut_control) / non_vut_control, 4),
                "classification": "plausibly compatible with temporal evolution; NOT fully reconciled, because the periods differ. The difference is small, positive and in the same direction as the control's own upward trend over the series, but this audit cannot show that time alone accounts for it.",
            },
            "vut_total": {
                "candidate_b": vut_observed, "control": values["Viviendas de uso turístico"],
                "difference": vut_observed - values["Viviendas de uso turístico"],
                "relative": round((vut_observed - values["Viviendas de uso turístico"]) / values["Viviendas de uso turístico"], 4),
                "classification": "unexplained discrepancy - not closed by adding the declarations dataset",
            },
            "control_vut_series_madrid": {
                year: next((int(r["Valor"]) for r in madrid
                            if r["Año"] == year and r["Tipo"] == "Viviendas de uso turístico"), None)
                for year in sorted({r["Año"] for r in madrid})
            },
        },
        "declarations": {
            "dataset": decl_pkg.get("title"),
            "catalogue": f"https://datos.comunidad.madrid/dataset/{decl_pkg.get('name')}",
            "http_last_modified": decl_http["last_modified"],
            "self_description": (decl_pkg.get("notes") or "")[:300],
            "rows": len(decl),
            "madrid_rows": len(decl_madrid),
            "fields": list(decl[0].keys()),
            "identity_field_published": False,
            "legal_universe": "VUT that filed a responsible declaration of commencement of activity WITHOUT inscription in the Registro de Empresas Turisticas. A different legal universe from both candidates; inspected for interpretation only and never merged.",
            "effect_on_candidate_b": {
                "candidate_b_vut_madrid": vut_observed,
                "plus_declarations_madrid": vut_observed + len(decl_madrid),
                "control_vut_madrid": values["Viviendas de uso turístico"],
                "closes_the_gap": False,
            },
        },
    }


def main() -> int:
    started = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print("[gate-b] fetching the official municipal address register ...")
    callejero, callejero_http = load_callejero()
    print(f"[gate-b] {len(callejero)} current addresses")

    print("[gate-b] auditing Candidate A ...")
    report_a = audit_candidate_a(callejero)
    print("[gate-b] auditing Candidate B ...")
    report_b = audit_candidate_b(callejero)
    print("[gate-b] auditing control and adjacent declarations ...")
    report_c = audit_control_and_declarations(report_b)

    envelope = {
        "audit_started_at": started,
        "audit_finished_at": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": "Counts are observations of one audit run against live official sources, not repository invariants and not integrity thresholds.",
        "address_register": {
            "dataset": "Callejero oficial del Ayuntamiento de Madrid (datos.madrid.es 213605)",
            "resource": "direcciones vigentes",
            "addresses": len(callejero),
            **callejero_http,
        },
    }
    for name, payload in [("candidate_a", report_a), ("candidate_b", report_b), ("control", report_c)]:
        path = HERE / f"report_{name}.json"
        path.write_text(
            json.dumps({**envelope, name: payload}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"[gate-b] wrote {path.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
