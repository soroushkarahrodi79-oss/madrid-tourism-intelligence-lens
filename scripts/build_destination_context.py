#!/usr/bin/env python3
"""Build the Madrid Destination Context artifact: hotel demand over time.

    OFFICIAL STATISTICAL SERIES -> FETCH BY SERIES CODE -> VERIFY SURVEY IDENTITY
    -> NORMALISE PERIODS -> PRESERVE SUPPRESSION AND PROVISIONAL FLAGS
    -> DETERMINISTIC COMPACT JSON

This is a CITY-LEVEL TEMPORAL SERIES. It carries no barrio figure, no Lens figure,
no spatial distribution and no ratio against residents. Nothing in this artifact
may be allocated to a barrio, a district or a circle: the source measures one
municipality as a whole and says nothing about any part of it.

Authoritative source
--------------------
Instituto Nacional de Estadistica (INE), Encuesta de Ocupacion Hotelera (EOH),
Tempus3 JSON API, statistical operation 238. INE is the originating authority for
this survey; Dataestur/SEGITTUR redistributes it. This builder reads INE directly,
so the figures carry the publisher's own provisional and confidentiality flags
rather than a redistributor's rendering of them.

Geography - settled, not assumed
--------------------------------
The source geography is the official INE "punto turistico" named `Madrid`. Two
independent pieces of official evidence establish what that is:

  1. INE's EOH methodology (2025 edition), section 5.12:
        "PUNTO TURISTICO - Municipio donde la concentracion de la oferta
         turistica es significativa."
     A punto turistico IS a municipality. (Section 5.13 defines a "zona
     turistica" separately as a SET of municipalities, so the two are not
     confusable.)

  2. INE's own Tempus3 metadata for variable 103 (PUNTOS TURISTICOS) under
     operation 238 returns the value `Madrid` with `Codigo` = "28079" - the
     official INE municipality code for Madrid.

28079 is the same municipality code carried by this project's canonical
geography artifact, so the Destination Context describes exactly the municipality
the rest of the application already knows. That equivalence is recorded in the
sidecar and asserted by the test suite; it is never re-derived from a name.

The trap this builder exists to avoid
-------------------------------------
Querying the punto-turistico dimension returns series from THREE different
statistical operations, and two of them publish series with IDENTICAL names:

    EOT2743  "Nacional. Viajeros. Madrid. Residentes en Espana."  = 320,715
    EOT9411  "Nacional. Viajeros. Madrid. Residentes en Espana."  =  21,334

The first is operation 238 (Encuesta de Ocupacion Hotelera - hotels). The second
is operation 239 (Encuesta de Ocupacion en Apartamentos Turisticos - tourist
apartments). They differ by a factor of fifteen. Operation 180 (Indicadores de
Rentabilidad del Sector Hotelero) supplies ADR and RevPAR through the same
dimension. Selecting a series by NAME would therefore silently publish the wrong
survey's number under the right-looking label.

This builder never matches on a series name. It pins explicit series codes and
then VERIFIES each one's own FK_Operacion is 238 before using it. A series that
moves to another operation, changes unit, or stops existing is a hard failure.

Metric selection
----------------
Chosen for V1, all from operation 238, all source-published:

    travellers                  EOT42434  unit 213 Viajeros
    overnight stays             EOT42540  unit 242 Pernoctaciones
    travellers, res. in Spain   EOT2743   unit 213 Viajeros
    travellers, res. abroad     EOT2744   unit 213 Viajeros

The two headline totals are PUBLISHED BY THE SOURCE, not summed here. That
matters: the published total and the sum of its residence components disagree by
+/-1 in 32 of 105 traveller periods and 26 of 105 overnight-stay periods, because
INE rounds each estimate independently. Deriving a total by addition would
therefore produce a number the publisher does not publish. This builder never
does that; where the source publishes no total, it abstains.

Deliberately NOT in V1, and why:
    estancia media              a ratio of the two headline figures; adds a third
                                concept without adding a decision
    grados de ocupacion         three different variants (plazas, habitaciones,
                                weekend), all supply-side capacity ratios
    establecimientos/plazas/
    habitaciones/personal       supply side; the gap this module fills is demand
    ADR, RevPAR                 operation 180, not the EOH, and profitability
                                rather than demand
    every operation-239 series  a different survey with a different universe

Temporal contract
-----------------
The published totals run contiguously from 2018-01. One isolated 2007-01
observation exists upstream and is excluded as non-contiguous; the exclusion is
recorded in the sidecar and the builder fails if the contiguous run's start moves.

Four different dates exist around this artifact and are never collapsed:
    1. the month each observation DESCRIBES (source_period)
    2. whether that month is Definitivo or Provisional, per observation
    3. INE's publication calendar (provisional results around day 23 of the
       following month)
    4. this builder's retrieved_at clock

Suppression
-----------
INE marks an unavailable observation with Secreto=true and Valor=null, carrying a
note (for Madrid: "Dato no disponible por cierre debido a crisis COVID19" for
2020-05 and 2020-06). Those stay null with their note attached. A suppressed
observation is NEVER a zero, and never interpolated.

Dependencies
------------
Standard library only (urllib, json). No third-party package is needed to build
or to test this artifact.

Usage
-----
    python scripts/build_destination_context.py
    python scripts/build_destination_context.py --out-dir data/destination
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# ----------------------------------------------------------------- source pins

API_ROOT = "https://servicios.ine.es/wstempus/js/ES"
OPERATION_ID = 238
OPERATION_NAME = "Encuesta de Ocupación Hotelera"

# Variable 103 is the punto-turistico dimension; value 2813 is Madrid, and INE
# publishes it with the municipality code below. Both are asserted at build time.
TOURIST_POINT_VARIABLE = 103
TOURIST_POINT_VALUE_ID = 2813
TOURIST_POINT_NAME = "Madrid"
MUNICIPALITY_CODE = "28079"

# INE's own unit ids, verified against /UNIDADES at calibration.
UNIT_TRAVELLERS = 213  # "Viajeros"
UNIT_OVERNIGHT_STAYS = 242  # "Pernoctaciones"

# The contiguous run of the source-published totals. An earlier isolated
# observation exists upstream (2007-01) and is excluded on purpose.
SERIES_START = (2018, 1)

# FK_TipoDato, read back from INE's own friendly form (tip=A) rather than assumed.
TIPO_DEFINITIVE = 1
TIPO_PROVISIONAL = 2
TIPO_LABELS = {TIPO_DEFINITIVE: "definitive", TIPO_PROVISIONAL: "provisional"}

# Series are pinned by CODE. Names are never used for selection: operation 239
# publishes series with byte-identical names and values that differ ~15x.
SERIES = {
    "travellers": {
        "cod": "EOT42434",
        "unit": UNIT_TRAVELLERS,
        "source_name": "Madrid. Viajero. Total categorías. Total. Dato.",
        "concept": "Viajeros",
        "residence": "Total",
    },
    "overnight_stays": {
        "cod": "EOT42540",
        "unit": UNIT_OVERNIGHT_STAYS,
        "source_name": "Madrid. Pernoctaciones. Total categorías. Total. Dato.",
        "concept": "Pernoctaciones",
        "residence": "Total",
    },
    "travellers_residents_spain": {
        "cod": "EOT2743",
        "unit": UNIT_TRAVELLERS,
        "source_name": "Nacional. Viajeros. Madrid. Residentes en España.",
        "concept": "Viajeros",
        "residence": "Residentes en España",
    },
    "travellers_residents_abroad": {
        "cod": "EOT2744",
        "unit": UNIT_TRAVELLERS,
        "source_name": "Nacional. Viajeros. Madrid. Residentes en el extranjero.",
        "concept": "Viajeros",
        "residence": "Residentes en el extranjero",
    },
}

# The metrics the interface reads. Composition is a pair, not a percentage: the
# artifact stores counts and lets the model compute a share it can also abstain from.
HEADLINE_METRICS = ("travellers", "overnight_stays")
COMPOSITION_METRICS = ("travellers_residents_spain", "travellers_residents_abroad")

REPO_ROOT = Path(__file__).resolve().parents[1]
GEOGRAPHY_ARTIFACT = "data/geography/madrid_admin.geojson"


class BuildError(RuntimeError):
    """A source-contract violation. Never recovered from, never worked around."""


# ----------------------------------------------------------------------- fetch


def fetch_json(path: str, params: dict | None = None) -> object:
    query = f"?{urllib.parse.urlencode(params)}" if params else ""
    url = f"{API_ROOT}/{path}{query}"
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            raw = response.read()
    except urllib.error.URLError as error:  # pragma: no cover - network path
        raise BuildError(f"cannot reach {url}: {error}") from error
    if not raw.strip():
        # INE answers 200 with an empty body for a malformed selection, which must
        # never be read as "no data".
        raise BuildError(f"{url} returned an empty body (HTTP 200) - malformed query")
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as error:
        raise BuildError(f"{url} did not return JSON: {error}") from error


# --------------------------------------------------------- source verification


def verify_geography() -> dict:
    """Confirm the tourist point is still Madrid and still carries code 28079."""
    values = fetch_json(f"VALORES_VARIABLEOPERACION/{TOURIST_POINT_VARIABLE}/{OPERATION_ID}")
    if not isinstance(values, list):
        raise BuildError("the punto-turistico variable did not return a list of values")

    match = next((v for v in values if v.get("Id") == TOURIST_POINT_VALUE_ID), None)
    if match is None:
        raise BuildError(
            f"tourist-point value id {TOURIST_POINT_VALUE_ID} is no longer published under "
            f"variable {TOURIST_POINT_VARIABLE} / operation {OPERATION_ID}"
        )
    if str(match.get("Nombre", "")).strip() != TOURIST_POINT_NAME:
        raise BuildError(
            f"tourist-point {TOURIST_POINT_VALUE_ID} is now named {match.get('Nombre')!r}, "
            f"not {TOURIST_POINT_NAME!r}"
        )
    if str(match.get("Codigo", "")).strip() != MUNICIPALITY_CODE:
        # The municipal equivalence is the single most important claim this module
        # makes. If the publisher changes it, the product must stop, not relabel.
        raise BuildError(
            f"tourist point {TOURIST_POINT_NAME!r} no longer carries municipality code "
            f"{MUNICIPALITY_CODE} (got {match.get('Codigo')!r}); the geography claim must be "
            f"re-established before publishing"
        )
    return {
        "variable_id": TOURIST_POINT_VARIABLE,
        "value_id": TOURIST_POINT_VALUE_ID,
        "name": TOURIST_POINT_NAME,
        "municipality_code": MUNICIPALITY_CODE,
    }


def verify_series(key: str, spec: dict) -> dict:
    """Confirm a pinned series still belongs to the EOH and still has its unit.

    This is the guard against the identically-named operation-239 series. A name
    is never trusted; the operation id is read from the series' own metadata.
    """
    detail = fetch_json(f"SERIE/{spec['cod']}")
    if not isinstance(detail, dict):
        raise BuildError(f"{key}: SERIE/{spec['cod']} did not return an object")

    operation = detail.get("FK_Operacion")
    if operation != OPERATION_ID:
        raise BuildError(
            f"{key}: series {spec['cod']} now belongs to statistical operation {operation}, "
            f"not {OPERATION_ID} ({OPERATION_NAME}). Operation 239 publishes tourist-apartment "
            f"series under identical names; refusing to publish a different survey's figures."
        )
    unit = detail.get("FK_Unidad")
    if unit != spec["unit"]:
        raise BuildError(
            f"{key}: series {spec['cod']} changed unit from {spec['unit']} to {unit}"
        )
    periodicity = detail.get("FK_Periodicidad")
    if periodicity != 1:
        raise BuildError(
            f"{key}: series {spec['cod']} is no longer monthly (FK_Periodicidad={periodicity})"
        )
    return {
        "cod": spec["cod"],
        "operation": operation,
        "unit": unit,
        "periodicity": periodicity,
        "source_name": str(detail.get("Nombre", "")).strip(),
        "decimals": detail.get("Decimales"),
    }


# ------------------------------------------------------------------- observations


def period_key(observation: dict) -> tuple[int, int]:
    year = observation.get("Anyo")
    month = observation.get("FK_Periodo")
    if not isinstance(year, int) or not isinstance(month, int):
        raise BuildError(f"observation carries a non-integer period: {observation!r}")
    if not 1 <= month <= 12:
        raise BuildError(f"observation month out of range: {observation!r}")
    return (year, month)


def fetch_series_observations(key: str, spec: dict) -> dict[tuple[int, int], dict]:
    payload = fetch_json(f"DATOS_SERIE/{spec['cod']}", {"nult": 600})
    if not isinstance(payload, dict):
        raise BuildError(f"{key}: DATOS_SERIE/{spec['cod']} did not return an object")
    rows = payload.get("Data")
    if not isinstance(rows, list) or not rows:
        raise BuildError(f"{key}: series {spec['cod']} returned no observations")

    observations: dict[tuple[int, int], dict] = {}
    for row in rows:
        key_ = period_key(row)
        if key_ in observations:
            raise BuildError(f"{key}: duplicate observation for {key_} in {spec['cod']}")
        observations[key_] = row
    return observations


def normalise_value(key: str, row: dict, decimals: int | None = 0) -> tuple[float | int | None, list[str]]:
    """Return (value, notes). A suppressed observation stays null, never zero.

    Values are emitted at the precision the PUBLISHER declares for the series
    (Decimales). These counts declare 0, so they are written as integers rather
    than as 686094.0, which would imply a precision the source does not claim.
    """
    value = row.get("Valor")
    notes = [
        str(note.get("texto", "")).strip()
        for note in (row.get("Notas") or [])
        if str(note.get("texto", "")).strip()
    ]

    if row.get("Secreto"):
        if value is not None:
            raise BuildError(
                f"{key}: observation flagged Secreto also carries a value ({value}); "
                f"the source's suppression semantics changed"
            )
        return None, notes
    if value is None:
        return None, notes
    if not isinstance(value, (int, float)):
        raise BuildError(f"{key}: non-numeric value {value!r}")
    if value != value or value in (float("inf"), float("-inf")):
        raise BuildError(f"{key}: non-finite value {value!r}")
    if value < 0:
        raise BuildError(f"{key}: negative count {value!r} - not valid for this metric")
    if decimals == 0:
        rounded = round(value)
        if abs(value - rounded) > 1e-6:
            raise BuildError(
                f"{key}: series declares 0 decimals but returned {value!r}; the source's "
                f"precision contract changed"
            )
        return int(rounded), notes
    return round(value, decimals) if decimals is not None else value, notes


def observation_status(key: str, row: dict) -> str:
    tipo = row.get("FK_TipoDato")
    if tipo not in TIPO_LABELS:
        raise BuildError(
            f"{key}: unknown FK_TipoDato {tipo!r}. The source's provisional/definitive "
            f"vocabulary changed and must be re-read before publishing."
        )
    return TIPO_LABELS[tipo]


def build_observations(
    series_rows: dict[str, dict[tuple[int, int], dict]],
    decimals: dict[str, int | None] | None = None,
) -> list[dict]:
    """Assemble one record per month, aligned across every pinned series."""
    headline_keys = [set(series_rows[m]) for m in HEADLINE_METRICS]
    shared = set.intersection(*headline_keys)
    periods = sorted(p for p in shared if p >= SERIES_START)
    if not periods:
        raise BuildError("no shared monthly periods across the headline series")

    if periods[0] != SERIES_START:
        raise BuildError(
            f"the contiguous published-total run now starts at {periods[0]}, not {SERIES_START}. "
            f"Re-inspect the source before changing this pin."
        )

    # Contiguity is a contract, not a hope: a hole would silently distort a trend.
    expected = []
    year, month = SERIES_START
    while (year, month) <= periods[-1]:
        expected.append((year, month))
        month += 1
        if month == 13:
            year, month = year + 1, 1
    missing = [p for p in expected if p not in set(periods)]
    if missing:
        raise BuildError(f"the monthly series has gaps: {missing[:12]}")

    records = []
    for period in periods:
        record: dict = {
            "period": f"{period[0]:04d}-{period[1]:02d}",
            "year": period[0],
            "month": period[1],
        }
        statuses = set()
        notes: list[str] = []

        for metric in (*HEADLINE_METRICS, *COMPOSITION_METRICS):
            row = series_rows[metric].get(period)
            if row is None:
                # Composition may legitimately be absent for a period the headline
                # series covers. Absent is null, never zero.
                record[metric] = None
                continue
            value, row_notes = normalise_value(metric, row, (decimals or {}).get(metric, 0))
            record[metric] = value
            statuses.add(observation_status(metric, row))
            for note in row_notes:
                if note not in notes:
                    notes.append(note)

        if not statuses:
            raise BuildError(f"{record['period']}: no observation carried a data-type flag")
        if len(statuses) > 1:
            # Mixed provisional/definitive inside one month would make a single
            # period label dishonest. Stop rather than pick one.
            raise BuildError(
                f"{record['period']}: series disagree on provisional/definitive status "
                f"({sorted(statuses)})"
            )
        record["status"] = statuses.pop()
        if notes:
            record["source_notes"] = notes
        records.append(record)

    return records


# -------------------------------------------------------------------- integrity


def schema_fingerprint(verified: dict[str, dict]) -> str:
    """Hash the structural contract, so drift is a visible, failing diff."""
    material = json.dumps(
        {
            "operation": OPERATION_ID,
            "tourist_point": [TOURIST_POINT_VARIABLE, TOURIST_POINT_VALUE_ID, MUNICIPALITY_CODE],
            "series": {
                key: [v["cod"], v["operation"], v["unit"], v["periodicity"]]
                for key, v in sorted(verified.items())
            },
            "observation_fields": ["Anyo", "FK_Periodo", "FK_TipoDato", "Secreto", "Valor"],
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def check_municipality_matches_geography() -> str | None:
    """The tourist point must be the municipality the rest of Lens already knows."""
    path = REPO_ROOT / GEOGRAPHY_ARTIFACT
    if not path.exists():
        return None
    geojson = json.loads(path.read_text(encoding="utf-8"))
    for feature in geojson.get("features", []):
        properties = feature.get("properties") or {}
        if properties.get("geography_level") == "municipality":
            official_id = str(properties.get("official_id"))
            if official_id != MUNICIPALITY_CODE:
                raise BuildError(
                    f"canonical geography municipality is {official_id}, but the tourist point "
                    f"carries {MUNICIPALITY_CODE}"
                )
            return official_id
    return None


# ------------------------------------------------------------------------ output


def write_json(path: Path, obj) -> None:
    # Deterministic and cross-platform: LF endings, trailing newline, UTF-8.
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def utc_now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Build the Madrid Destination Context artifact")
    parser.add_argument("--out-dir", default="data/destination")
    args = parser.parse_args(argv)

    out_dir = Path(args.out_dir)
    if not out_dir.is_absolute():
        out_dir = REPO_ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        geography = verify_geography()
        print(
            f"[destination] tourist point {geography['name']!r} verified as municipality "
            f"{geography['municipality_code']}"
        )
        canonical = check_municipality_matches_geography()
        if canonical:
            print(f"[destination] canonical geography municipality matches: {canonical}")

        verified = {}
        series_rows = {}
        for key, spec in SERIES.items():
            verified[key] = verify_series(key, spec)
            series_rows[key] = fetch_series_observations(key, spec)
            print(
                f"[destination] {key:<28} {spec['cod']:<9} operation "
                f"{verified[key]['operation']} · {len(series_rows[key])} observations"
            )

        observations = build_observations(
            series_rows, {key: value.get("decimals") for key, value in verified.items()}
        )
    except BuildError as error:
        print(f"[destination] FAILED: {error}", file=sys.stderr)
        return 1

    latest = observations[-1]
    earliest = observations[0]
    fingerprint = schema_fingerprint(verified)
    retrieved_at = utc_now()

    artifact = {
        "contract_version": "1.0.0",
        "geography": {
            "source_term": "Punto turístico",
            "source_value": TOURIST_POINT_NAME,
            "level": "municipality",
            "municipality_code": MUNICIPALITY_CODE,
            "municipality_name": "Madrid",
            "ine_variable_id": TOURIST_POINT_VARIABLE,
            "ine_value_id": TOURIST_POINT_VALUE_ID,
            "scope_note": (
                "The whole municipality of Madrid. This is a citywide figure and describes no "
                "barrio, no district and no Lens circle."
            ),
        },
        "source_period": {
            "granularity": "month",
            "earliest": earliest["period"],
            "latest": latest["period"],
            "latest_status": latest["status"],
            "count": len(observations),
            "semantics": (
                "Each observation describes the calendar month named by its period. That is not "
                "the publication date and not the retrieval date, which are recorded separately "
                "in the sidecar."
            ),
        },
        "metrics": {
            "travellers": {
                "series": SERIES["travellers"]["cod"],
                "unit": "travellers",
                "source_concept": "Viajeros",
                "provenance": "SOURCE_REPORTED",
            },
            "overnight_stays": {
                "series": SERIES["overnight_stays"]["cod"],
                "unit": "overnight stays",
                "source_concept": "Pernoctaciones",
                "provenance": "SOURCE_REPORTED",
            },
            "travellers_residents_spain": {
                "series": SERIES["travellers_residents_spain"]["cod"],
                "unit": "travellers",
                "source_concept": "Viajeros · Residentes en España",
                "provenance": "SOURCE_REPORTED",
            },
            "travellers_residents_abroad": {
                "series": SERIES["travellers_residents_abroad"]["cod"],
                "unit": "travellers",
                "source_concept": "Viajeros · Residentes en el extranjero",
                "provenance": "SOURCE_REPORTED",
            },
        },
        "schema_fingerprint": fingerprint,
        "observations": observations,
    }

    meta = {
        "contract_version": "1.0.0",
        "title": "Madrid hotel demand by month, official tourist point (municipality 28079)",
        "artifact": "madrid_hotel_demand.json",
        "source": {
            "authority": "Instituto Nacional de Estadística (INE)",
            "survey": "Encuesta de Ocupación Hotelera (EOH)",
            "statistical_operation": OPERATION_ID,
            "operation_name": OPERATION_NAME,
            "api": "Tempus3 JSON API",
            "api_root": API_ROOT,
            "endpoints": {
                "series_metadata": f"{API_ROOT}/SERIE/{{COD}}",
                "series_data": f"{API_ROOT}/DATOS_SERIE/{{COD}}?nult=600",
                "tourist_point_values": (
                    f"{API_ROOT}/VALORES_VARIABLEOPERACION/{TOURIST_POINT_VARIABLE}/{OPERATION_ID}"
                ),
            },
            "methodology": "https://www.ine.es/daco/daco42/ocuphotel/meto_eoh.pdf",
            "redistributor_note": (
                "Dataestur / API-SEGITTUR redistributes this same EOH series as XLSX through its "
                "EOH_PUNT_TUR_DL endpoint. This builder reads INE, the originating authority, "
                "directly, so the publisher's own provisional and confidentiality flags survive "
                "into the artifact instead of being flattened by a redistribution step."
            ),
            "license": "https://www.ine.es/aviso_legal",
            "attribution": "Instituto Nacional de Estadística (INE)",
        },
        "geography": {
            "source_term": "Punto turístico",
            "source_value": TOURIST_POINT_NAME,
            "resolved_level": "municipality",
            "municipality_code": MUNICIPALITY_CODE,
            "hard_gate_1": "PASS",
            "evidence": [
                (
                    "INE, Encuesta de Ocupación Hotelera, Metodología (edición 2025), section 5.12: "
                    "\"PUNTO TURÍSTICO — Municipio donde la concentración de la oferta turística es "
                    "significativa.\" A punto turístico is a municipality."
                ),
                (
                    "Section 5.13 defines \"ZONA TURÍSTICA\" separately as a \"Conjunto de municipios\", "
                    "so a tourist point is not a multi-municipality aggregate."
                ),
                (
                    f"INE Tempus3 metadata, variable {TOURIST_POINT_VARIABLE} (PUNTOS TURISTÍCOS) under "
                    f"operation {OPERATION_ID}, publishes the value \"{TOURIST_POINT_NAME}\" with "
                    f"Codigo \"{MUNICIPALITY_CODE}\" — the official INE municipality code for Madrid."
                ),
                (
                    f"{GEOGRAPHY_ARTIFACT} carries municipality official_id \"{MUNICIPALITY_CODE}\", so the "
                    "source geography is the same municipality the rest of the application uses."
                ),
            ],
            "ui_label_rule": (
                "The interface names this geography as the municipality of Madrid AND keeps the "
                "publisher's own term visible. It is never shortened to a bare \"Madrid\" without "
                "saying which Madrid, and it is never attached to a barrio or a Lens circle."
            ),
        },
        "survey_definitions": {
            "viajeros": (
                "INE 5.4 VIAJEROS ENTRADOS: \"Todas aquellas personas que realizan una o más "
                "pernoctaciones seguidas en el mismo alojamiento.\" A traveller is counted per "
                "establishment stay, so one person staying in two hotels is counted twice. This is "
                "not a count of unique people and not a count of visitors to Madrid."
            ),
            "pernoctaciones": (
                "INE 5.5 PERNOCTACIONES O PLAZAS OCUPADAS: \"cada noche que un viajero se aloja en "
                "el establecimiento.\""
            ),
            "residence": (
                "INE classifies travellers by PLACE OF RESIDENCE: \"Residentes en España\" and "
                "\"Residentes en el extranjero\". This is residence, not nationality, and not a "
                "domestic/international tourist classification."
            ),
            "punto_turistico": (
                "INE 5.12 PUNTO TURÍSTICO: \"Municipio donde la concentración de la oferta turística "
                "es significativa.\""
            ),
        },
        "series_pinned": {
            key: {
                "cod": value["cod"],
                "verified_operation": value["operation"],
                "verified_unit": value["unit"],
                "source_name_observed": value["source_name"],
            }
            for key, value in verified.items()
        },
        "name_collision_hazard": {
            "why_codes_not_names": (
                "Querying the punto-turístico dimension returns series from operations 238 "
                "(Encuesta de Ocupación Hotelera), 239 (Encuesta de Ocupación en Apartamentos "
                "Turísticos) and 180 (Indicadores de Rentabilidad del Sector Hotelero). Operations "
                "238 and 239 publish series with IDENTICAL names."
            ),
            "observed_example": (
                "EOT2743 and EOT9411 are both named \"Nacional. Viajeros. Madrid. Residentes en "
                "España.\" but belong to operations 238 and 239 and reported 320,715 and 21,334 "
                "respectively for their latest published month."
            ),
            "guard": (
                "Every series is pinned by code and its own FK_Operacion is verified to be 238 "
                "before use. A series that moves operation, changes unit or stops being monthly "
                "fails the build."
            ),
        },
        "totals_are_published_not_derived": {
            "rule": "The travellers and overnight-stays totals are read from source-published series.",
            "why": (
                "The published total and the sum of its residence components disagree by ±1 in 32 of "
                "105 traveller periods and 26 of 105 overnight-stay periods, because INE rounds each "
                "estimate independently. Summing the components would publish a number the source "
                "does not publish, so no total is ever derived by addition."
            ),
        },
        "temporal_contract": {
            "observation_period": "the calendar month named by each observation's period field",
            "publication_calendar": (
                "INE publishes provisional results for a reference month around day 23 of the "
                "following month (methodology, section 9)."
            ),
            "provisional_semantics": (
                "Each observation carries the publisher's own FK_TipoDato, read back from INE's "
                "friendly form as \"Definitivo\" or \"Provisional\" and stored as status. Months of "
                "the current statistical year are published as provisional and are revised later. A "
                "same-month-previous-year comparison therefore routinely compares a provisional "
                "figure against a definitive one, and the interface says so."
            ),
            "series_start": (
                f"The source-published totals run contiguously from {SERIES_START[0]}-{SERIES_START[1]:02d}. "
                "One isolated earlier observation (2007-01) exists upstream and is excluded as "
                "non-contiguous; the builder fails if the contiguous run's start moves."
            ),
            "four_dates_never_merged": [
                "the month an observation describes",
                "whether that month is definitive or provisional",
                "INE's publication calendar",
                "this builder's retrieved_at clock",
            ],
        },
        "suppression_semantics": {
            "rule": "Secreto=true observations carry Valor=null and keep their source note.",
            "never_zero": (
                "A suppressed or unavailable observation is null, never zero, and is never "
                "interpolated. Missing is not zero."
            ),
            "observed": (
                "For Madrid, 2020-05 and 2020-06 are null with the source note \"Dato no disponible "
                "por cierre debido a crisis COVID19\"."
            ),
            "statistical_secrecy_rule": (
                "INE methodology section 10: information may be given for strata where the number of "
                "establishments open with movement is 4 or more."
            ),
        },
        "metrics_selected": {
            "travellers": "EOT42434 · source-published total · unit Viajeros",
            "overnight_stays": "EOT42540 · source-published total · unit Pernoctaciones",
            "composition": (
                "EOT2743 / EOT2744 · travellers by place of residence (Residentes en España / "
                "Residentes en el extranjero)"
            ),
        },
        "metrics_rejected_from_v1": {
            "estancia_media": "a ratio of the two headline figures; adds a concept without adding a decision",
            "grados_de_ocupacion": (
                "three variants exist (por plazas, por habitaciones, fin de semana); all are "
                "supply-side capacity ratios rather than demand"
            ),
            "establecimientos_plazas_habitaciones_personal": (
                "supply-side counts; the evidence gap this module fills is temporal demand"
            ),
            "adr_revpar": (
                "operation 180 (Indicadores de Rentabilidad del Sector Hotelero), not the EOH, and "
                "hotel profitability rather than demand"
            ),
            "tourist_apartment_series": (
                "operation 239 (Encuesta de Ocupación en Apartamentos Turísticos) is a different "
                "survey with a different universe and must never be mixed into a hotel-demand figure"
            ),
        },
        "schema_fingerprint": fingerprint,
        "retrieved_at": retrieved_at,
        "builder": "scripts/build_destination_context.py",
        "interpretation_ceiling": (
            "Hotel-sector demand in the municipality of Madrid, as measured by the official INE "
            "hotel occupancy survey. It is NOT total tourism demand, NOT all accommodation, NOT all "
            "visitors to Madrid, and NOT a count of unique people: a traveller is counted once per "
            "establishment stay. It excludes tourist apartments, tourist dwellings (VUT), campsites, "
            "rural accommodation, day visitors and anyone staying in unpaid or private accommodation. "
            "It is NOT tourism pressure, overtourism, saturation, carrying capacity, tourism intensity "
            "or attractiveness, and it carries no explanation of why a figure changed. It describes "
            "the WHOLE MUNICIPALITY and must never be distributed into a barrio, a district or a "
            "Lens circle."
        ),
    }

    write_json(out_dir / "madrid_hotel_demand.json", artifact)
    write_json(out_dir / "madrid_hotel_demand.meta.json", meta)

    print(
        f"[destination] wrote {out_dir/'madrid_hotel_demand.json'} "
        f"({len(observations)} months, {earliest['period']} to {latest['period']}, "
        f"latest {latest['status']})"
    )
    print(f"[destination] wrote {out_dir/'madrid_hotel_demand.meta.json'}")
    print(f"[destination] schema fingerprint {fingerprint[:16]}…")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
