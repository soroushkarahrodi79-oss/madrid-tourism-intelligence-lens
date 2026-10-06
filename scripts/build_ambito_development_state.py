#!/usr/bin/env python3
"""Build the committed ámbito development-state and buildability artifact (#68 / K6).

    CATALOGUE -> EDITION SELECTION BY STATED REFERENCE DATE -> SCHEMA ASSERTION
    -> VERBATIM PARSE -> JOIN REPORT -> FINGERPRINT -> ARTIFACT

Two official CC BY 4.0 dated-edition families, read with the BIFF8 approach Gate L
audited:

  * **S1** ``203200`` *PGOUM 97. Estado de desarrollo de los ámbitos* — the four
    independent published development-phase fields, the characteristic use and the
    ámbito surface.
  * **S2** ``203182`` *PGOUM 97. Edificabilidad remanente en ámbitos* — available
    buildability (``edificabilidad disponible``) by documented use class, in m²,
    and the ámbito's published ``SITUACION DEL ÁMBITO``.

This builder restates none of Gate L's rules: it imports the gate's own catalogue
resolution, fingerprinting, OLE2 publication-timestamp reader, reference-date
extraction and schema-era classifier from ``research/urban_planning_gate/``, the
same way ``scripts/build_hospitality_commercial_context.py`` imports the Gate A–F
modules it depends on.

What this artifact is not allowed to contain
--------------------------------------------
* **No overall stage.** Gate L §12 measured the four phase columns as
  multi-dimensional (empirically non-funnel) and the structure PDF documents no
  ordering. There is no scalar stage, stage number, progression, percentage,
  completion, advancement, delay or timeline anywhere in this artifact, and a test
  asserts no such key can appear.
* **No dwelling counts.** S2 publishes ``Colectiva. Nº Viviendas`` and
  ``Unifamiliar. Nº Viviendas``, but Gate L §16 measured them as exactly
  residential buildability ÷ 100 with fractional values — a mechanical
  m²/100 proxy at an assumed 100 m²/dwelling, not a count of dwelling units.
  Those columns are READ, counted and then EXCLUDED by name, with the exclusion
  recorded in the metadata. Buildability ships in m² only.
* **No cross-era series.** The four-phase flat S1 schema and the split-residential
  flat S2 schema exist only in the three most recent editions (Gate L §6). This
  builder selects within the current era and REFUSES an edition from another era.
* **K6 and K7 stay separate.** The current-edition ``editions`` / ``ambitos``
  object remains the K6 primary record. K7's two dated source snapshots live under
  a separate ``change_detection`` key; no K6 record is mutated into a before/after
  object.
* **No derived quantity of any kind.** No sum across rows, no total, no ratio, no
  per-area figure, no apportionment.

Edition selection
-----------------
"Latest" means the newest **stated reference date** among the editions whose schema
era is the current one. The reference date is read from inside the file (the
``Estado del desarrollo a fecha`` column, an Excel serial). It is NEVER selected by
resource id, resource name, filename or catalogue position: Gate L §6 proved the
resource-id order is not chronological (``203200-15`` is Enero 2026 while
``203200-16`` is Enero 2025, and S1 shows 72 id/date inversions). A regression test
asserts that selecting by resource id would pick the WRONG edition.

Source truth is preserved
-------------------------
Phase values are carried **verbatim**, including spelling variants and the
``PGOUM-85`` / ``PGOUM-97`` plan-of-origin markers. Normalised metadata is exposed
in SEPARATE fields for UI treatment; the verbatim ``source_value`` stays
authoritative. ``No Necesita`` is its own state: it is never mapped to
``Sin Iniciar``, to zero, to unavailable, to "complete", to "skipped" or to
"no aplica" — Gate L §13 found the publisher never defines it.

A blank buildability cell and a published ``0`` are DIFFERENT states and stay
different. Missing never becomes zero.

Dependencies
------------
``requests`` and ``xlrd`` 2.0.2 (the BIFF8 reader Gate L audited: these editions
are legacy OLE2 compound documents, which ``openpyxl`` cannot read). Both are
BUILDER-ONLY, imported lazily so this module stays importable — and its pure logic
stays testable — with the standard library alone. Pinned in
``scripts/requirements-build.txt``; neither is in ``package.json`` and nothing in
the application imports them.

Usage
-----
    python scripts/build_ambito_development_state.py
    python scripts/build_ambito_development_state.py --out-dir data/planning
    python scripts/build_ambito_development_state.py --geometry data/planning/madrid_ambitos.geojson
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GATE_DIR = REPO / "research" / "urban_planning_gate"

CONTRACT_VERSION = "1.0.0"

# ------------------------------------------------------------------ the families

FAMILIES = {
    "S1": {
        "package": "203200-0-desarrollo-ambitos",
        "dataset_url": "https://datos.madrid.es/dataset/203200-0-desarrollo-ambitos",
        "title": "PGOUM 97. Estado de desarrollo de los ámbitos",
        "role": "the four independent published development-phase fields",
        "current_era": "S1_FOUR_PHASE_FLAT",
        "code_column": "Ámbito",
    },
    "S2": {
        "package": "203182-0-ambitos-remanente",
        "dataset_url": "https://datos.madrid.es/dataset/203182-0-ambitos-remanente",
        "title": "PGOUM 97. Edificabilidad remanente en ámbitos",
        "role": "available buildability (edificabilidad disponible) by use class, in m²",
        "current_era": "S2_SPLIT_RESIDENTIAL_FLAT",
        "code_column": "COD_AMBITO",
    },
}

AUTHORITY = (
    "Ayuntamiento de Madrid. Área de Gobierno de Urbanismo, Medio Ambiente y Movilidad. "
    "Dirección General de Planificación Estratégica"
)
LICENSE = "CC BY 4.0"

# ------------------------------------------- the exact current-era column contract

# The builder asserts these header tokens EXACTLY. A moved, renamed, removed or
# added column FAILS the build. No fuzzy header matching, no index shifting and no
# silent field drop: a schema change must be seen by a reviewer.
S1_EXPECTED_COLUMNS = (
    "Codigo_Distrito",
    "Distrito",
    "Ámbito",
    "Nombre",
    "Uso Característico",
    "Superficie (m²)",
    "Estado de desarrollo. Planeamiento",
    "Estado de desarrollo. Gestión",
    "Estado de desarrollo.Urbanización. Proyecto",
    "Estado de desarrollo. Urbanización. Obras",
    "Estado del desarrollo a fecha",
)

S2_EXPECTED_COLUMNS = (
    "COD_DISTRITO",
    "DISTRITO",
    "COD_AMBITO",
    "AMBITO",
    "SITUACION DEL ÁMBITO",
    "Colectiva. Edif. Residencial",
    "Colectiva. Nº Viviendas",
    "Unifamiliar. Edif. Residencial",
    "Unifamiliar. Nº Viviendas",
    "Edif. Industrial",
    "Edif. Terciario",
    "ESTADO DEL DESARROLLO A FECHA",
    "OBSERVACIONES",
)

# The four published phase fields, in the publisher's own column order. FOUR
# INDEPENDENT FIELDS: this tuple carries no rank and no sequence, and nothing in
# this builder or the artifact derives one value from the four.
PHASE_FIELDS = (
    ("planeamiento", "Estado de desarrollo. Planeamiento"),
    ("gestion", "Estado de desarrollo. Gestión"),
    ("urbanizacion_proyecto", "Estado de desarrollo.Urbanización. Proyecto"),
    ("urbanizacion_obras", "Estado de desarrollo. Urbanización. Obras"),
)

# The documented use classes, with the publisher's own column names. Unit m²
# throughout; the publisher's word for the quantity is *disponible* (available).
USE_CLASSES = (
    ("colectiva_residencial", "Colectiva. Edif. Residencial"),
    ("unifamiliar_residencial", "Unifamiliar. Edif. Residencial"),
    ("industrial", "Edif. Industrial"),
    ("terciario", "Edif. Terciario"),
)

BUILDABILITY_UNIT = "m² edificable"

# Read, counted, and then deliberately NOT published. See the module docstring and
# Gate L §16: these values are residential buildability ÷ 100 with fractional
# results, a mechanical proxy rather than a count of dwellings.
EXCLUDED_DWELLING_PROXY_COLUMNS = (
    "Colectiva. Nº Viviendas",
    "Unifamiliar. Nº Viviendas",
)

# Values the publisher's structure document (v. Nov 2025) lists as expected.
# Compared accent-, case- and whitespace-insensitively, because the editions carry
# punctuation and spelling drift of the SAME documented values; the verbatim string
# is always preserved separately.
SOURCE_DOCUMENTED_PHASE_VALUES = (
    "Sin Iniciar",
    "En Tramitación",
    "Finalizado",
    "No necesita",
    "PGOUM 85",
    "PGOUM 97",
)

# Plan-of-origin markers that occupy phase cells (42.4 % of all phase cells per
# Gate L §11). They are NOT progress states, NOT ordered and NOT errors.
PLAN_ORIGIN_MARKERS = ("PGOUM 85", "PGOUM 97")

# Structurally distinct from Sin Iniciar, with NO official definition (Gate L §13).
UNRESOLVED_MEANING_VALUES = ("No necesita",)

PHASE_VALUE_KINDS = ("PHASE_VALUE", "PLAN_ORIGIN_MARKER", "UNRESOLVED_MEANING")
PHASE_VOCABULARY_STATES = (
    "SOURCE_DOCUMENTED",
    "SOURCE_DOCUMENTED_SPELLING_VARIANT",
    "SOURCE_OBSERVED_NOT_DOCUMENTED",
)

VALUE_STATES = ("PUBLISHED", "NOT_PUBLISHED", "NOT_PUBLISHED_NON_NUMERIC")
AVAILABILITY_STATES = ("PUBLISHED", "NOT_PUBLISHED_IN_EDITION")
BUILDABILITY_PUBLICATION_STATES = (
    "SINGLE_PUBLISHED_ROW",
    "MULTIPLE_PUBLISHED_ROWS_NOT_COMBINED",
)

# Pinned observations of the calibration run, so a change in the published universe
# is a visible diff in a reviewed pull request rather than a silent one.
BASELINE = {
    "s1_reference_date": "2026-01-01",
    "s2_reference_date": "2026-01-01",
    "s1_rows": 667,
    "s2_rows": 239,
    "s2_distinct_codes": 230,
    "s1_geometry_matched": 666,
    "s2_geometry_matched": 230,
    "calibrated_on": "2026-10-06",
}

# Engineering guardrails against an ingestion collapse, far below the observed
# counts. Not analytical thresholds.
MIN_S1_ROWS = 500
MIN_S2_ROWS = 150


# =========================================================== pure value semantics


def _fold(text):
    """Accent-, case- and whitespace-insensitive key for vocabulary comparison only.

    Never applied to a value that is stored or displayed: the verbatim source
    string is always what the artifact carries. This folding exists so that the
    publisher's own punctuation and spelling drift (``En  Tramitación``,
    ``Finalizada``, ``PGOUM-85``) is recognised as a variant of a DOCUMENTED value
    instead of being misreported as an undocumented one — the same discipline Gate
    L §7 applied to cosmetic note drift.
    """
    if text is None:
        return ""
    stripped = unicodedata.normalize("NFKD", str(text))
    stripped = "".join(ch for ch in stripped if not unicodedata.combining(ch))
    stripped = stripped.replace("-", " ").replace("_", " ")
    return " ".join(stripped.lower().split())


_DOCUMENTED_FOLDED = {_fold(value): value for value in SOURCE_DOCUMENTED_PHASE_VALUES}
_MARKER_FOLDED = {_fold(value) for value in PLAN_ORIGIN_MARKERS}
_UNRESOLVED_FOLDED = {_fold(value) for value in UNRESOLVED_MEANING_VALUES}

# Gender/number spelling drift of a documented value, folded. ``Finalizada`` /
# ``Finalizadas`` / ``FinalizadaS`` are the observed variants of ``Finalizado``.
_SPELLING_VARIANTS = {
    "finalizada": "Finalizado",
    "finalizadas": "Finalizado",
}


def classify_phase_value(raw):
    """Describe one published phase cell WITHOUT ranking, ordering or rewriting it.

    Returns a record whose ``source_value`` is the publisher's string verbatim. The
    other fields are product-side metadata for presentation only:

    ``kind``
        ``PHASE_VALUE`` — an administrative phase state;
        ``PLAN_ORIGIN_MARKER`` — a ``PGOUM 85`` / ``PGOUM 97`` plan-of-origin
        marker occupying a phase cell;
        ``UNRESOLVED_MEANING`` — ``No Necesita``, listed by the publisher as a
        distinct expected value but never defined by it.
    ``vocabulary``
        whether the value is in the structure document's expected list, a spelling
        variant of one, or observed in the data but absent from the document
        (``En Ejecución`` is the known case).
    ``documented_as``
        the documented spelling this value corresponds to, or null.

    There is deliberately no rank, index, order, score or percentage. The caller
    cannot obtain one from this function because the function does not compute one.
    """
    text = "" if raw is None else str(raw).strip()
    folded = _fold(text)
    if not text:
        return {
            "source_value": None,
            "state": "NOT_PUBLISHED",
            "kind": None,
            "vocabulary": None,
            "documented_as": None,
        }

    if folded in _MARKER_FOLDED:
        kind = "PLAN_ORIGIN_MARKER"
    elif folded in _UNRESOLVED_FOLDED:
        kind = "UNRESOLVED_MEANING"
    else:
        kind = "PHASE_VALUE"

    documented_as = _DOCUMENTED_FOLDED.get(folded)
    if documented_as is not None:
        vocabulary = "SOURCE_DOCUMENTED"
    elif folded in _SPELLING_VARIANTS:
        documented_as = _SPELLING_VARIANTS[folded]
        vocabulary = "SOURCE_DOCUMENTED_SPELLING_VARIANT"
    else:
        vocabulary = "SOURCE_OBSERVED_NOT_DOCUMENTED"

    return {
        "source_value": text,
        "state": "PUBLISHED",
        "kind": kind,
        "vocabulary": vocabulary,
        "documented_as": documented_as,
    }


def _json_number(value):
    """A number in a form every JSON reader serialises identically.

    Python writes an integral float as ``4752314.0``; JavaScript and most other
    readers write ``4752314``. The artifact's fingerprint is recomputed by
    ``scripts/validate_deployment.mjs`` in Node, so an integral value is stored as
    an integer and only genuinely fractional values keep a decimal point. No value
    is rounded and no precision is invented: a published 0 stays 0 and is still
    distinguished from an unpublished cell by its ``state``, never by its shape.
    """
    number = float(value)
    return int(number) if number == int(number) else number


def classify_numeric_cell(cell_type, value):
    """Turn one buildability cell into a value state, keeping blank ≠ zero.

    ``cell_type`` is an xlrd cell type: 2 is a number, 0/6 are empty/blank, 1 is
    text. A blank cell is ``NOT_PUBLISHED`` and a published ``0`` is a real zero;
    collapsing one into the other would either invent available buildability or
    invent its absence. Non-numeric text is reported as such, verbatim, rather than
    being coerced.
    """
    if cell_type == 2:
        return {"state": "PUBLISHED", "value": _json_number(value), "source_text": None}
    if cell_type in (0, 6):
        return {"state": "NOT_PUBLISHED", "value": None, "source_text": None}
    text = "" if value is None else str(value).strip()
    if not text:
        return {"state": "NOT_PUBLISHED", "value": None, "source_text": None}
    return {"state": "NOT_PUBLISHED_NON_NUMERIC", "value": None, "source_text": text}


def is_aggregate_total_row(code, *cells):
    """Is this an aggregate ``Total`` row rather than an ámbito row?

    The current-era editions carry no such row (reported in the metadata), but the
    guard is kept and tested: an aggregate row entering a per-ámbito artifact would
    publish a city total as if it were one place's figure.
    """
    if _fold(code).startswith("total"):
        return True
    return any(_fold(cell) == "total" or _fold(cell).startswith("total ") for cell in cells)


def assert_current_era_schema(family, header_tokens, sheet_count):
    """Assert the pinned current-era column contract, or raise.

    Fails closed on drift: the header must be EXACTLY the expected tuple, in order.
    No fuzzy matching, no index shifting, no dropped field. ``Nº Viviendas``
    headers are compared with their embedded newline folded away, because the
    publisher stores them as ``'Colectiva. Nº \\nViviendas'``.
    """
    expected = S1_EXPECTED_COLUMNS if family == "S1" else S2_EXPECTED_COLUMNS
    observed = tuple(" ".join(str(token or "").split()) for token in header_tokens)
    if observed != expected:
        missing = [column for column in expected if column not in observed]
        added = [column for column in observed if column not in expected]
        raise SystemExit(
            f"{family}: the selected edition does not match the pinned current-era schema.\n"
            f"  expected ({len(expected)}): {expected}\n"
            f"  observed ({len(observed)}): {observed}\n"
            f"  missing: {missing}\n"
            f"  unexpected: {added}\n"
            "A schema change must be reviewed, not absorbed: update "
            f"{'S1_EXPECTED_COLUMNS' if family == 'S1' else 'S2_EXPECTED_COLUMNS'} and the "
            "parsing rules in the same reviewed pull request."
        )
    if sheet_count != 1:
        raise SystemExit(
            f"{family}: the current-era schema is a single flat sheet, but the selected edition "
            f"has {sheet_count} sheets. The per-district multi-sheet layout belongs to the "
            "superseded schema era and is not comparable four-phase evidence."
        )
    return True


def select_current_era_edition(editions, family, current_era):
    """Pick the newest edition WITHIN the current schema era, by stated reference date.

    ``editions`` is a list of dicts carrying at least ``schema_era``,
    ``reference_date`` and ``resource_id``. Selection reads the reference date the
    edition states about itself and nothing else. Returns
    ``(selected, rejected_other_era, would_be_selected_by_resource_id)``.

    The third return value exists so the build record, and the regression test, can
    show what the discredited resource-id heuristic WOULD have chosen: Gate L §6
    proved id order is not chronological, so that heuristic returns the wrong
    edition, and this builder must never regress to it.
    """
    in_era = [edition for edition in editions if edition.get("schema_era") == current_era]
    other_era = [edition for edition in editions if edition.get("schema_era") != current_era]
    if not in_era:
        raise SystemExit(
            f"{family}: no edition in the current schema era {current_era!r}. "
            "The four-phase/split-residential flat schema is the only comparable current era; "
            "an edition from a superseded era is not equivalent evidence and is never selected."
        )
    undated = [edition for edition in in_era if not edition.get("reference_date")]
    if undated:
        raise SystemExit(
            f"{family}: {len(undated)} current-era edition(s) state no reference date "
            f"({', '.join(str(edition.get('resource_id')) for edition in undated)}). "
            "Edition selection reads the date the edition states about itself; it never falls "
            "back to a resource id, a name or a catalogue position."
        )
    selected = max(in_era, key=lambda edition: edition["reference_date"])
    by_resource_id = max(in_era, key=lambda edition: _resource_id_num(edition.get("resource_id")))
    return selected, other_era, by_resource_id


def _resource_id_num(resource_id):
    """The EDITION INDEX inside a resource id. Recorded for the audit, NEVER for ordering.

    A catalogue resource id reads ``203200-15-desarrollo-ambitos``: the first
    number is the dataset, the second is the edition index. The index is the part
    the discredited "latest = highest id" heuristic would have ordered by, so it
    is the part this function extracts — exactly as Gate L's audit did — and the
    only thing it is ever used for is recording what that heuristic WOULD have
    chosen. Returns -1 when no edition index is present.
    """
    text = "" if resource_id is None else str(resource_id)
    match = re.search(r"-(\d+)-", text)
    return int(match.group(1)) if match else -1


def canonical_bytes(payload):
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def fingerprint(payload):
    return hashlib.sha256(canonical_bytes(payload)).hexdigest()


def now():
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ================================================================ lazy build deps


def _require_gate_l():
    """Import Gate L's audited catalogue / BIFF8 / reference-date helpers.

    The production builder deliberately reuses the research gate's tested modules
    rather than restating its rules, exactly as the hospitality production builder
    imports the Gate A–F modules.
    """
    if str(GATE_DIR) not in sys.path:
        sys.path.insert(0, str(GATE_DIR))
    try:
        import audit_l1_editions  # noqa: PLC0415
        import gate_l_common  # noqa: PLC0415
    except ImportError as error:  # pragma: no cover - environment dependent
        raise SystemExit(
            "the Gate L research helpers need requests and xlrd 2.0.2 "
            "(pip install -r scripts/requirements-build.txt)"
        ) from error
    return gate_l_common, audit_l1_editions


# ===================================================================== retrieval


def _header_and_rows(sheet, cell_text):
    """The header row index, its tokens, and every data row as (types, values)."""
    header_index = 0
    header = [cell_text(value) for value in sheet.row_values(header_index)]
    rows = []
    for index in range(header_index + 1, sheet.nrows):
        types = [sheet.cell_type(index, column) for column in range(sheet.ncols)]
        values = [sheet.cell_value(index, column) for column in range(sheet.ncols)]
        rows.append((index, types, values))
    return header, rows


def _reference_date(sheet, column, xlrd_module, datemode):
    """The edition's own stated reference date, from inside the file.

    The publisher states a calendar day (the structure PDF's *Fecha recogida de los
    datos*), so the day is kept: the precision is the publisher's, not ours.

    Both numeric and date-formatted cells are accepted, because the serial is the
    same value either way and whether the publisher applied a date format to the
    column is a spreadsheet presentation choice, not evidence. The serial is
    converted with the workbook's own datemode, never with an assumed epoch.
    """
    for index in range(1, min(sheet.nrows, 8)):
        if sheet.cell_type(index, column) in (xlrd_module.XL_CELL_NUMBER, xlrd_module.XL_CELL_DATE):
            raw = sheet.cell_value(index, column)
            if raw > 40000:
                parsed = xlrd_module.xldate_as_datetime(raw, datemode)
                return {
                    "reference_date": parsed.strftime("%Y-%m-%d"),
                    "reference_date_month": parsed.strftime("%Y-%m"),
                    "method": "IN_FILE_EXCEL_SERIAL",
                    "source_column": _column_name(sheet, column),
                    "source_serial": raw,
                }
    raise SystemExit(
        "the selected edition states no reference date in its own "
        f"{_column_name(sheet, column)!r} column; a date is never inferred from the "
        "resource name, the catalogue or the build clock"
    )


def _column_name(sheet, column):
    value = sheet.cell_value(0, column)
    return " ".join(str(value or "").split())


def load_edition(family, gate_l, l1):
    """Resolve, select, fingerprint and open the current-era edition for one family.

    Returns a dict with the edition identity, the opened sheet, the header tokens
    and the parsed rows. Nothing is interpreted here.
    """
    import xlrd  # noqa: PLC0415 - available via _require_gate_l

    spec = FAMILIES[family]
    catalogue = gate_l.package_show(spec["package"])
    inventory = []
    for resource in gate_l.xls_editions(catalogue):
        fetched = gate_l.fetch(resource["url"], resource["resource_id"], ".xls")
        path = Path(fetched["cache_path"])
        workbook = gate_l.open_workbook(path)
        dates = l1.reference_date_of(workbook, resource["description"])
        signature = l1.schema_signature(workbook)
        inventory.append(
            {
                "resource_id": resource["resource_id"],
                "resource_id_num": _resource_id_num(resource["resource_id"]),
                "description": resource["description"],
                "url": resource["url"],
                "reference_date": dates["reference_date"],
                "reference_date_method": dates["reference_date_method"],
                "schema_era": l1.classify_era(family, signature),
                "schema_fingerprint": signature["schema_fingerprint"],
                "sheet_count": signature["sheet_count"],
                "bytes": fetched["bytes"],
                "sha256": fetched["sha256"],
                "ole2": gate_l.ole2_timestamps(path),
                "http_last_modified": fetched["http_last_modified"],
                "retrieved_at": fetched["retrieved_at"],
                "cache_path": str(path),
            }
        )

    selected, other_era, by_resource_id = select_current_era_edition(
        inventory, family, spec["current_era"]
    )
    workbook = gate_l.open_workbook(Path(selected["cache_path"]))
    sheet = workbook.sheet_by_index(0)
    header, rows = _header_and_rows(sheet, gate_l.cell_text)
    assert_current_era_schema(family, header, len(workbook.sheet_names()))

    date_column = header.index(
        "Estado del desarrollo a fecha" if family == "S1" else "ESTADO DEL DESARROLLO A FECHA"
    )
    reference = _reference_date(sheet, date_column, xlrd, workbook.datemode)

    identity = f"{family}:{reference['reference_date_month']}:{selected['sha256'][:12]}"
    return {
        "family": family,
        "spec": spec,
        "inventory": inventory,
        "selected": selected,
        "other_era": other_era,
        "would_be_selected_by_resource_id": by_resource_id,
        "reference": reference,
        "snapshot_identity": identity,
        "header": header,
        "rows": rows,
        "sheet": sheet,
    }


# K7 pins one explicitly named pair. Each lookup is made from the catalogue's
# source-stated reference date and the full file fingerprint; resource IDs and
# catalogue order are retained as provenance only.
K7_PINNED_PAIR = {
    "S1": {
        "previous": ("2025-07-01", "e1ff3e0e0f63fe59dbe64d10b319026917c34d9086f395e9787b6fe3661cf49d"),
        "current": ("2026-01-01", "585db074c122caec3293137e56742b5c9d77189205050aab328520a2dd1ec677"),
    },
    "S2": {
        "previous": ("2025-07-01", "09f6859a2541ea8c31eb3ce47464ca5fbec64d38f57a7b3b435bb65e4a5cb286"),
        "current": ("2026-01-01", "326edf48d2214e73175256777fd5083a3f656a05d0bcf0bec36b63ac6cc899e8"),
    },
}


def load_pinned_edition(template, reference_date, sha256, gate_l):
    """Open a specific edition by its in-file date plus full byte fingerprint."""
    import xlrd  # noqa: PLC0415 - available via _require_gate_l

    candidates = [
        item for item in template["inventory"]
        if str(item["reference_date"]).startswith(reference_date[:7]) and item["sha256"] == sha256
    ]
    if len(candidates) != 1:
        raise SystemExit(
            f"K7 pin {template['family']} {reference_date} / {sha256} resolved to "
            f"{len(candidates)} catalogue entries; exactly one is required"
        )
    selected = candidates[0]
    expected_era = FAMILIES[template["family"]]["current_era"]
    if selected["schema_era"] != expected_era:
        raise SystemExit(
            f"K7 pin {template['family']} {reference_date} has schema era "
            f"{selected['schema_era']}, expected {expected_era}"
        )
    workbook = gate_l.open_workbook(Path(selected["cache_path"]))
    sheet = workbook.sheet_by_index(0)
    header, rows = _header_and_rows(sheet, gate_l.cell_text)
    assert_current_era_schema(template["family"], header, len(workbook.sheet_names()))
    import xlrd  # noqa: PLC0415 - available via _require_gate_l
    date_column = header.index(
        "Estado del desarrollo a fecha" if template["family"] == "S1" else "ESTADO DEL DESARROLLO A FECHA"
    )
    reference = _reference_date(sheet, date_column, xlrd, workbook.datemode)
    if reference["reference_date"] != reference_date:
        raise SystemExit(
            f"K7 pin date mismatch: inventory says {reference_date}, workbook says {reference['reference_date']}"
        )
    return {
        **template,
        "selected": selected,
        "reference": reference,
        "snapshot_identity": f"{template['family']}:{reference['reference_date_month']}:{selected['sha256'][:12]}",
        "header": header,
        "rows": rows,
        "sheet": sheet,
    }


def comparison_snapshot(edition, gate_l):
    """Make a separate K7 edition record without changing the K6 current object."""
    family = edition["family"]
    if family == "S1":
        records, duplicates, _totals = parse_s1(edition, gate_l)
        if duplicates:
            raise SystemExit(f"K7 S1 edition has duplicate exact codes: {duplicates[:3]}")
        for record in records.values():
            record["source_verbatim"] = {
                "phase_values": {
                    key: phase["source_value"] if phase["state"] == "PUBLISHED" else ""
                    for key, phase in record["phases"].items()
                }
            }
        return {
            **_edition_record(edition),
            "family": family,
            "records": records,
            "published_row_count": len(records),
            "identity_scope": "{edition}:{exact_code}",
        }

    records, _totals, _excluded = parse_s2(edition, gate_l)
    for rows in records.values():
        for row in rows:
            row["source_verbatim"] = {
                "denomination": row["denomination"],
                "district_code": row["district_code"],
                "district_name": row["district_name"],
                "situacion": row["situacion"],
                "observaciones": row["observaciones"],
            }
    return {
        **_edition_record(edition),
        "family": family,
        "records": records,
        "published_row_count": sum(len(rows) for rows in records.values()),
        "distinct_code_count": len(records),
        "identity_scope": "{edition}:{exact_code}; row identity subordinate to exact code",
    }


# ========================================================================== parse


def parse_s1(edition, gate_l):
    """Parse the estado edition into per-code records. Values stay verbatim."""
    header = edition["header"]
    index_of = {name: header.index(name) for name in S1_EXPECTED_COLUMNS}
    phase_columns = {key: index_of[column] for key, column in PHASE_FIELDS}
    records = {}
    duplicates = []
    total_rows = []
    for row_index, types, values in edition["rows"]:
        code = gate_l.cell_text(values[index_of["Ámbito"]])
        if not code:
            continue
        if is_aggregate_total_row(code, values[index_of["Nombre"]], values[index_of["Distrito"]]):
            total_rows.append({"source_row": row_index, "code": code})
            continue
        if code in records:
            duplicates.append({"source_row": row_index, "code": code})
            continue
        surface = classify_numeric_cell(
            types[index_of["Superficie (m²)"]], values[index_of["Superficie (m²)"]]
        )
        characteristic_use = gate_l.cell_text(values[index_of["Uso Característico"]]) or None
        records[code] = {
            "source_row": row_index,
            "denomination": gate_l.cell_text(values[index_of["Nombre"]]) or None,
            "district_code": gate_l.cell_text(values[index_of["Codigo_Distrito"]]) or None,
            "district_name": gate_l.cell_text(values[index_of["Distrito"]]) or None,
            "characteristic_use": characteristic_use,
            "surface": {
                "state": surface["state"],
                "value": surface["value"],
                "unit": "m²",
                "source_column": "Superficie (m²)",
            },
            "phases": {
                key: {
                    **classify_phase_value(values[column]),
                    "source_column": dict(PHASE_FIELDS)[key],
                }
                for key, column in phase_columns.items()
            },
        }
    return records, duplicates, total_rows


def parse_s2(edition, gate_l):
    """Parse the buildability edition, preserving EVERY published row per code.

    The publisher documents that buildability is reported *según la situación del
    ámbito*, and the current edition does publish more than one row for some codes.
    Those rows are kept separately and are NEVER summed, averaged or otherwise
    combined: an ámbito total across published rows is a derived quantity Gate L did
    not establish, and the no-apportionment rule forbids manufacturing one.

    The two ``Nº Viviendas`` columns are read and counted here so the exclusion is
    an observed fact in the build record, and are then dropped.
    """
    header = edition["header"]
    folded_header = [" ".join(str(token or "").split()) for token in header]
    index_of = {name: folded_header.index(name) for name in S2_EXPECTED_COLUMNS}
    rows_by_code = {}
    total_rows = []
    dwelling_proxy_cells_read = 0
    dwelling_proxy_fractional = 0
    for row_index, types, values in edition["rows"]:
        code = gate_l.cell_text(values[index_of["COD_AMBITO"]])
        if not code:
            continue
        if is_aggregate_total_row(code, values[index_of["AMBITO"]], values[index_of["DISTRITO"]]):
            total_rows.append({"source_row": row_index, "code": code})
            continue
        for column in EXCLUDED_DWELLING_PROXY_COLUMNS:
            cell = classify_numeric_cell(types[index_of[column]], values[index_of[column]])
            dwelling_proxy_cells_read += 1
            if cell["state"] == "PUBLISHED" and cell["value"] != int(cell["value"]):
                dwelling_proxy_fractional += 1
        use_classes = {}
        for key, column in USE_CLASSES:
            cell = classify_numeric_cell(types[index_of[column]], values[index_of[column]])
            use_classes[key] = {
                "state": cell["state"],
                "value": cell["value"],
                "unit": BUILDABILITY_UNIT,
                "source_column": column,
                **({"source_text": cell["source_text"]} if cell["source_text"] else {}),
            }
        rows_by_code.setdefault(code, []).append(
            {
                "source_row": row_index,
                "denomination": gate_l.cell_text(values[index_of["AMBITO"]]) or None,
                "district_code": gate_l.cell_text(values[index_of["COD_DISTRITO"]]) or None,
                "district_name": gate_l.cell_text(values[index_of["DISTRITO"]]) or None,
                "situacion": gate_l.cell_text(values[index_of["SITUACION DEL ÁMBITO"]]) or None,
                "observaciones": gate_l.cell_text(values[index_of["OBSERVACIONES"]]) or None,
                "use_classes": use_classes,
            }
        )
    return (
        rows_by_code,
        total_rows,
        {
            "columns": list(EXCLUDED_DWELLING_PROXY_COLUMNS),
            "cells_read": dwelling_proxy_cells_read,
            "published_fractional_values": dwelling_proxy_fractional,
            "published_in_artifact": False,
            "reason": (
                "Gate L §16 measured these values as exactly residential buildability ÷ 100, "
                "with fractional results, at a match rate of 1.0 across every row. They are a "
                "mechanical m²/100 proxy at an assumed 100 m² per dwelling, not a count of "
                "dwelling units, and no protected-housing count column exists. The product "
                "publishes buildability in m² only and exposes no dwelling count."
            ),
        },
    )


def describe_multiplicity(rows):
    """Characterise a code's published S2 rows without resolving the source for it.

    * one row                       -> SINGLE_PUBLISHED_ROW
    * several rows, distinct
      ``SITUACION DEL ÁMBITO``      -> MULTIPLE_PUBLISHED_ROWS_NOT_COMBINED,
                                       cause DISTINCT_PUBLISHED_SITUACION
    * several rows, same situación   -> MULTIPLE_PUBLISHED_ROWS_NOT_COMBINED,
                                       cause CAUSE_UNRESOLVED

    In every multi-row case the rows are published side by side and never combined.
    ``CAUSE_UNRESOLVED`` is a valid, publishable verdict (the Gate L rule): the
    builder does not guess which of two conflicting rows the publisher meant.
    """
    if len(rows) == 1:
        return {"publication": "SINGLE_PUBLISHED_ROW", "row_count": 1, "cause": None, "detail": None}
    situaciones = [row["situacion"] for row in rows]
    districts = sorted({(row["district_code"], row["district_name"]) for row in rows})
    if len(set(situaciones)) == len(rows):
        cause = "DISTINCT_PUBLISHED_SITUACION"
        detail = (
            "The publisher documents that available buildability is reported according to the "
            "ámbito's situación, and publishes one row per situación for this code. The rows are "
            "shown separately and are never added together."
        )
    else:
        cause = "CAUSE_UNRESOLVED"
        detail = (
            "The edition publishes more than one row for this code without distinguishing them by "
            "situación"
            + (
                f"; the rows disagree on the district code ({', '.join(str(code) for code, _ in districts)})"
                if len(districts) > 1
                else ""
            )
            + ". The source states no cause, so none is attributed: both rows are shown verbatim "
            "and no single figure is published for this code."
        )
    return {
        "publication": "MULTIPLE_PUBLISHED_ROWS_NOT_COMBINED",
        "row_count": len(rows),
        "cause": cause,
        "detail": detail,
    }


def join_report(family, table_codes, geometry_codes):
    """Exact-identifier join evidence. Nothing disappears silently."""
    table = set(table_codes)
    geometry = set(geometry_codes)
    matched = sorted(table & geometry)
    table_only = sorted(table - geometry)
    geometry_only = sorted(geometry - table)
    return {
        "family": family,
        "matching": "EXACT",
        "normalisation": "NONE",
        "table_codes": len(table),
        "geometry_codes": len(geometry),
        "matched": len(matched),
        "match_rate_of_table": round(len(matched) / len(table), 6) if table else None,
        "unmatched_in_table_count": len(table_only),
        "unmatched_in_table": table_only,
        "geometry_only_count": len(geometry_only),
        "geometry_only_sample": geometry_only[:20],
        "note": (
            "Geometry-only ámbitos are real published ámbitos that the selected edition does not "
            "carry a row for — the published annex 'Ámbitos del PGOUM que no son objeto de "
            "seguimiento' names court annulment, MPG re-ordering, cession to other municipalities, "
            "deadline prescription and historic colonies as reasons. They stay in the production "
            "universe with an explicit NOT_PUBLISHED_IN_EDITION state; they are never dropped and "
            "never shown as zero."
        ),
    }


# ========================================================================== build


def build(out_dir, geometry_path):
    gate_l, l1 = _require_gate_l()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    geometry = json.loads(Path(geometry_path).read_text(encoding="utf-8"))
    geometry_codes = [
        feature["properties"]["ambito_code"] for feature in geometry.get("features", [])
    ]
    if not geometry_codes:
        raise SystemExit(
            f"{geometry_path} carries no ámbito features; run scripts/build_planning_ambitos.py first"
        )
    print(f"[state] geometry universe: {len(geometry_codes)} ámbitos")

    print("[state] resolving S1 editions from the catalogue ...")
    s1 = load_edition("S1", gate_l, l1)
    print(
        f"[state] S1 selected {s1['snapshot_identity']} "
        f"(reference {s1['reference']['reference_date']}, resource {s1['selected']['resource_id']})"
    )
    print("[state] resolving S2 editions from the catalogue ...")
    s2 = load_edition("S2", gate_l, l1)
    print(
        f"[state] S2 selected {s2['snapshot_identity']} "
        f"(reference {s2['reference']['reference_date']}, resource {s2['selected']['resource_id']})"
    )

    # K7 uses an explicit, pinned two-edition pair. These are parsed into a
    # separate comparison artifact so K6's current-edition records remain intact.
    comparison_editions = {"previous": {}, "current": {}}
    for family, template in (("S1", s1), ("S2", s2)):
        for side in ("previous", "current"):
            reference_date, sha256 = K7_PINNED_PAIR[family][side]
            pinned = load_pinned_edition(template, reference_date, sha256, gate_l)
            comparison_editions[side][family] = comparison_snapshot(pinned, gate_l)
            print(
                f"[state] K7 {side} {family} {pinned['snapshot_identity']} "
                f"(reference {reference_date}, schema {pinned['selected']['schema_era']})"
            )

    s1_records, s1_duplicates, s1_totals = parse_s1(s1, gate_l)
    s2_rows, s2_totals, dwelling_exclusion = parse_s2(s2, gate_l)
    print(f"[state] S1 rows {len(s1_records)} | S2 rows {sum(len(v) for v in s2_rows.values())} "
          f"across {len(s2_rows)} codes")

    if s1_duplicates:
        raise SystemExit(
            f"S1: duplicate ámbito code(s) {', '.join(d['code'] for d in s1_duplicates)}. The "
            "estado edition is expected to publish one row per ámbito; two rows would make the "
            "four published phase values ambiguous and must be reviewed, not silently resolved."
        )
    if len(s1_records) < MIN_S1_ROWS:
        raise SystemExit(f"S1: only {len(s1_records)} rows parsed (guardrail {MIN_S1_ROWS})")
    if sum(len(v) for v in s2_rows.values()) < MIN_S2_ROWS:
        raise SystemExit(f"S2: only {sum(len(v) for v in s2_rows.values())} rows parsed (guardrail {MIN_S2_ROWS})")

    s1_join = join_report("S1", s1_records.keys(), geometry_codes)
    s2_join = join_report("S2", s2_rows.keys(), geometry_codes)
    for report in (s1_join, s2_join):
        print(
            f"[state] join {report['family']}: {report['matched']}/{report['table_codes']} exact "
            f"({report['match_rate_of_table']}), table-only {report['unmatched_in_table_count']}, "
            f"geometry-only {report['geometry_only_count']}"
        )

    # ---- assemble one record per PRODUCTION ámbito ------------------------------
    denomination_differences = []
    ambitos = {}
    for code in sorted(geometry_codes):
        state = s1_records.get(code)
        rows = s2_rows.get(code)
        geometry_denomination = next(
            feature["properties"].get("ambito_denomination")
            for feature in geometry["features"]
            if feature["properties"]["ambito_code"] == code
        )
        if state and state["denomination"] and geometry_denomination:
            if _fold(state["denomination"]) != _fold(geometry_denomination):
                denomination_differences.append(
                    {
                        "code": code,
                        "edition": state["denomination"],
                        "geometry": geometry_denomination,
                    }
                )
        record = {
            "ambito_code": code,
            "geometry_denomination": geometry_denomination,
            "development_state": (
                {
                    "availability": "PUBLISHED",
                    "denomination": state["denomination"],
                    "district": {"code": state["district_code"], "name": state["district_name"]},
                    "characteristic_use": state["characteristic_use"],
                    "surface": state["surface"],
                    "phases": state["phases"],
                    "source_row": state["source_row"],
                }
                if state
                else {
                    "availability": "NOT_PUBLISHED_IN_EDITION",
                    "note": (
                        "The selected estado edition publishes no row for this ámbito. That is an "
                        "absence of published evidence, not a zero and not a state."
                    ),
                }
            ),
            "available_buildability": (
                {
                    "availability": "PUBLISHED",
                    **describe_multiplicity(rows),
                    "rows": rows,
                }
                if rows
                else {
                    "availability": "NOT_PUBLISHED_IN_EDITION",
                    "note": (
                        "The selected edificabilidad edition publishes no row for this ámbito. "
                        "That is an absence of published evidence, not zero available buildability."
                    ),
                }
            ),
        }
        ambitos[code] = record

    # Edition rows with no geometry are kept visible in the artifact's join report
    # rather than dropped, so a reader of the artifact can see what is missing.
    artifact = {
        "contract_version": CONTRACT_VERSION,
        "scope": "PLANNING_AMBITO",
        "phase_fields": [
            {"key": key, "source_column": column, "independent": True} for key, column in PHASE_FIELDS
        ],
        "phase_fields_note": (
            "FOUR INDEPENDENT PUBLISHED FIELDS. Gate L §12 measured them as multi-dimensional "
            "(empirically non-funnel) and the publisher documents no ordering, so there is no "
            "overall stage, no stage number, no progression, no percentage and no completion "
            "figure anywhere in this artifact. The field order is the publisher's column order "
            "and carries no rank."
        ),
        "use_classes": [
            {"key": key, "source_column": column, "unit": BUILDABILITY_UNIT}
            for key, column in USE_CLASSES
        ],
        "editions": {
            "development_state": _edition_record(s1),
            "available_buildability": _edition_record(s2),
        },
        "change_detection": {
            "contract_version": "1.0.0",
            "pair_id": "2025-07__2026-01",
            "comparison_basis": (
                "Two explicitly named editions selected by source-stated reference date plus full SHA-256; "
                "comparison is within one schema era. Entity identity is {edition}:{exact_code}."
            ),
            "comparability_verdict": "COMPARABLE_WITHIN_SCHEMA_ERA",
            "schema_era_verdict": {
                "S1": "S1_FOUR_PHASE_FLAT",
                "S2": "S2_SPLIT_RESIDENTIAL_FLAT",
            },
            "previous": {
                "reference_date": "2025-07-01",
                "families": comparison_editions["previous"],
            },
            "current": {
                "reference_date": "2026-01-01",
                "families": comparison_editions["current"],
            },
            "row_policy": (
                "Preserve every published S2 row under exact code. Match only unique stable SITUACION DEL ÁMBITO "
                "values; unmatched or duplicate rows remain explicit and numeric comparison is withheld."
            ),
            "audits": None,
        },
        "ambitos": ambitos,
    }
    artifact_fingerprint = fingerprint(artifact)

    phase_vocabulary = {}
    for record in ambitos.values():
        state = record["development_state"]
        if state["availability"] != "PUBLISHED":
            continue
        for phase in state["phases"].values():
            if phase["state"] != "PUBLISHED":
                continue
            entry = phase_vocabulary.setdefault(
                phase["source_value"],
                {"count": 0, "kind": phase["kind"], "vocabulary": phase["vocabulary"],
                 "documented_as": phase["documented_as"]},
            )
            entry["count"] += 1

    buildability_states = {state: 0 for state in VALUE_STATES}
    for record in ambitos.values():
        buildability = record["available_buildability"]
        if buildability["availability"] != "PUBLISHED":
            continue
        for row in buildability["rows"]:
            for cell in row["use_classes"].values():
                buildability_states[cell["state"]] += 1

    multiplicity = {}
    for record in ambitos.values():
        buildability = record["available_buildability"]
        key = buildability.get("cause") or buildability["availability"]
        multiplicity[key] = multiplicity.get(key, 0) + 1

    meta = {
        "contract_version": CONTRACT_VERSION,
        "artifact": "madrid_ambito_state.json",
        "generated_at": now(),
        "builder": "scripts/build_ambito_development_state.py",
        "gate": "Gate L (#65) source contract; issue #68 (K6) and #69 (K7) production increments",
        "what_this_is": (
            "K6's current-edition record per planning ámbito: the four independent published "
            "development-phase values, characteristic use, published surface, and available "
            "buildability by documented use class in m² edificable. K7's separately keyed "
            "change_detection object carries exactly the pinned 2025-07-01 and 2026-01-01 source "
            "editions with all S2 rows preserved. Whole-ámbito scope throughout."
        ),
        "scope": "PLANNING_AMBITO",
        "change_detection": {
            "pair_id": "2025-07__2026-01",
            "comparison_basis": "source-stated reference date + full SHA-256 fingerprint + schema era",
            "comparability_verdict": "COMPARABLE_WITHIN_SCHEMA_ERA",
            "editions": {
                side: {
                    family: {
                        key: record[key]
                        for key in (
                            "reference_date", "snapshot_identity", "resource_id", "sha256",
                            "schema_era", "schema_fingerprint", "resource_url", "retrieved_at",
                            "published_at", "published_at_timestamp", "http_last_modified",
                        )
                    }
                    for family, record in families.items()
                }
                for side, families in comparison_editions.items()
            },
            "row_policy": "All published S2 rows preserved; only unique stable SITUACION matches permit row-level comparison.",
            "audits": "Derived by scripts/build_ambito_change_detection.mjs from the pinned source-edition records.",
        },
        "scope_note": (
            "Every value describes the WHOLE planning ámbito. No value is apportioned, "
            "area-weighted, population-weighted or otherwise distributed into a Lens circle, a "
            "barrio, a district or any sub-area, and no value is combined with a value of another "
            "analytical scope."
        ),
        "license": LICENSE,
        "authority": AUTHORITY,
        "families": {
            key: {
                "package": spec["package"],
                "dataset_url": spec["dataset_url"],
                "title": spec["title"],
                "role": spec["role"],
                "current_schema_era": spec["current_era"],
            }
            for key, spec in FAMILIES.items()
        },
        "edition_selection": {
            "rule": (
                "The newest STATED REFERENCE DATE among the editions whose schema era is the "
                "current one. The reference date is read from inside the file, from the edition's "
                "own 'Estado del desarrollo a fecha' column."
            ),
            "never_by": ["resource id", "resource name", "filename", "catalogue position"],
            "why": (
                "Gate L §6 proved the resource-id order is not chronological: S1 shows 72 and S2 "
                "42 id/date inversions, and 203200-15 is Enero 2026 while 203200-16 is Enero 2025. "
                "Selecting 'latest' by id returns the wrong edition."
            ),
            "resource_id_heuristic_would_select": {
                "S1": _heuristic_record(s1),
                "S2": _heuristic_record(s2),
            },
            "schema_era_boundary": (
                "The four-phase flat S1 schema and the split-residential flat S2 schema exist only "
                "in the three most recent editions (2025-01, 2025-07, 2026-01). The 2013–2024 "
                "editions use superseded schemas — S1 a per-district single-state layout, S2 three "
                "earlier column sets — and are NOT one comparable series with the current era. The "
                "builder refuses an out-of-era edition rather than parsing it as equivalent."
            ),
            "editions_rejected_as_other_era": {
                "S1": sorted(
                    {edition["schema_era"] for edition in s1["other_era"]}
                ),
                "S2": sorted(
                    {edition["schema_era"] for edition in s2["other_era"]}
                ),
                "S1_count": len(s1["other_era"]),
                "S2_count": len(s2["other_era"]),
            },
        },
        "schema_assertion": {
            "mode": "FAIL_CLOSED",
            "s1_expected_columns": list(S1_EXPECTED_COLUMNS),
            "s2_expected_columns": list(S2_EXPECTED_COLUMNS),
            "note": (
                "The selected edition's header must equal the pinned tuple exactly, in order, and "
                "the sheet count must be 1. No fuzzy header matching, no index shifting and no "
                "silent field drop: a column that moves, disappears or changes incompatibly FAILS "
                "the build so a reviewer sees it."
            ),
        },
        "reader": {
            "library": "xlrd",
            "minimum_version": "2.0.2",
            "why": (
                "These editions are legacy BIFF8 .xls OLE2 compound documents. xlrd 2.0 reads only "
                "that format, which is exactly what is needed; openpyxl is an Office-Open-XML/ZIP "
                "reader and cannot open them."
            ),
            "scope": "BUILD ONLY — pinned in scripts/requirements-build.txt, absent from package.json",
        },
        "phase_vocabulary": {
            "fields": [{"key": key, "source_column": column} for key, column in PHASE_FIELDS],
            "independent_fields": True,
            "no_scalar_stage": (
                "MULTI_DIMENSIONAL_NO_SCALAR_STAGE (Gate L §12). No overall stage, stage number, "
                "progression, percentage, completion, advancement, delay or timeline is derived."
            ),
            "source_documented_values": list(SOURCE_DOCUMENTED_PHASE_VALUES),
            "source_documented_by": "the publisher's structure document, v. November 2025",
            "observed_values": phase_vocabulary,
            "plan_origin_markers": {
                "values": list(PLAN_ORIGIN_MARKERS),
                "handling": (
                    "Carried verbatim. They are plan-of-origin markers occupying phase cells "
                    "(42.4 % of all phase cells per Gate L §11), not progress states, not ordered "
                    "states and not errors."
                ),
            },
            "no_necesita": {
                "values": list(UNRESOLVED_MEANING_VALUES),
                "status": "SOURCE_OBSERVED_INTERPRETATION_UNRESOLVED",
                "handling": (
                    "Carried verbatim and kept structurally distinct from Sin Iniciar. The "
                    "publisher lists it as an expected value but never defines it (Gate L §13), so "
                    "it is never rendered as, mapped to or equated with 'no aplica', 'not "
                    "applicable', Sin Iniciar, zero, unavailable, complete or skipped."
                ),
            },
            "spelling_variants": (
                "The publisher's own punctuation and spelling drift (En  Tramitación, Finalizada, "
                "Finalizadas, PGOUM-85) is recognised as a variant of a DOCUMENTED value for "
                "presentation metadata only; the verbatim source_value is always preserved and is "
                "what the artifact and the interface carry."
            ),
            "undocumented_observed": (
                "En Ejecución is observed in the data but is NOT listed by the November-2025 "
                "structure document. It is published verbatim and labelled "
                "SOURCE_OBSERVED_NOT_DOCUMENTED rather than quietly promoted to a documented value."
            ),
        },
        "buildability": {
            "publisher_term": "edificabilidad remanente (dataset title) / edificabilidad disponible (structure document)",
            "product_term_es": "edificabilidad disponible",
            "product_term_en": "available buildability",
            "unit": BUILDABILITY_UNIT,
            "unit_is_mandatory": True,
            "definition_verbatim": (
                "edificabilidad disponible para los usos lucrativos Residencial, Servicios "
                "Terciarios e Industrial en los ámbitos de ordenación vigentes … según la "
                "situación del ámbito"
            ),
            "not": (
                "NOT 'remaining to be built', NOT 'yet to be constructed', NOT construction "
                "remaining, NOT development remaining, NOT remaining unallocated and NOT an "
                "estimate of what will be built. It is available planning buildability under the "
                "plan, for currently-valid ámbitos, according to situación."
            ),
            "use_classes": [
                {"key": key, "source_column": column, "unit": BUILDABILITY_UNIT}
                for key, column in USE_CLASSES
            ],
            "value_states": list(VALUE_STATES),
            "value_state_counts": buildability_states,
            "missing_is_not_zero": (
                "The edition itself distinguishes a blank cell from a published 0, and so does "
                "this artifact: a blank cell is NOT_PUBLISHED and a published 0 is a real zero. "
                "Neither is ever substituted for the other, and no value falls back to 0."
            ),
            "blank_cell_observation": (
                "The 2026-01 and 2025-01 editions publish blank cells where the 2025-07 edition "
                "publishes 0, within the same schema era. This is recorded as an observed "
                "publisher difference with cause unresolved; it is NOT normalised away."
            ),
            "multiple_published_rows": {
                "rule": (
                    "Every published row for a code is preserved and presented separately. Rows "
                    "are NEVER summed, averaged, reconciled or otherwise combined: an ámbito total "
                    "across published rows is a derived quantity the sources do not state."
                ),
                "states": list(BUILDABILITY_PUBLICATION_STATES),
                "counts": multiplicity,
            },
            "dwelling_proxy_exclusion": dwelling_exclusion,
        },
        "aggregate_total_rows": {
            "rule": "An aggregate Total row never enters the artifact.",
            "s1_excluded": s1_totals,
            "s2_excluded": s2_totals,
            "observation": (
                "The selected current-era editions carry NO aggregate Total row: the exclusion "
                "found nothing to exclude. The guard is kept and tested anyway, because an "
                "aggregate row entering a per-ámbito artifact would publish a city total as one "
                "place's figure."
            ),
        },
        "identifier": {
            "join_key": "the exact official ámbito code",
            "matching": "EXACT",
            "normalisation": "NONE",
            "rp_suffix": (
                "A -RP suffix is never stripped: Gate L §21 established that it marks a distinct "
                "Revisión Parcial ámbito (UZP.3.01 annulled by court sentence, UZPp.03.01-RP its "
                "active replacement) and measured that normalising codes REDUCES exact matches."
            ),
        },
        "joins": {"S1": s1_join, "S2": s2_join},
        "production_universe": {
            "keyed_on": "the geometry artifact's ámbito universe",
            "ambito_count": len(ambitos),
            "development_state_published": sum(
                1 for record in ambitos.values()
                if record["development_state"]["availability"] == "PUBLISHED"
            ),
            "development_state_not_published": sum(
                1 for record in ambitos.values()
                if record["development_state"]["availability"] != "PUBLISHED"
            ),
            "buildability_published": sum(
                1 for record in ambitos.values()
                if record["available_buildability"]["availability"] == "PUBLISHED"
            ),
            "buildability_not_published": sum(
                1 for record in ambitos.values()
                if record["available_buildability"]["availability"] != "PUBLISHED"
            ),
        },
        "denomination_differences": {
            "count": len(denomination_differences),
            "records": denomination_differences,
            "note": (
                "Where the edition and the geometry name the same code differently, BOTH names are "
                "kept verbatim and the difference is recorded. Neither is corrected and neither is "
                "treated as authoritative over the other."
            ),
        },
        "district_attribution": {
            "source": "the S1 estado edition's own Codigo_Distrito / Distrito columns",
            "observed_anomaly": (
                "The selected S2 edition publishes seven Barajas ámbitos twice, once with "
                "COD_DISTRITO 20 and once with 21, while naming the district BARAJAS in both rows "
                "(Barajas is official district 21). Some of those row pairs also disagree "
                "numerically. The S1 edition carries no such anomaly. The duplicated rows are "
                "preserved verbatim and classified CAUSE_UNRESOLVED; no row is preferred, merged "
                "or corrected, and district attribution is read from S1 only."
            ),
        },
        "baseline": {
            **BASELINE,
            "note": (
                "Observations of the calibration run, pinned so a change in the published universe "
                "is a visible diff in a reviewed pull request. They are recorded, not asserted."
            ),
        },
        "engineering_guardrails": {"min_s1_rows": MIN_S1_ROWS, "min_s2_rows": MIN_S2_ROWS},
        "fingerprint": {
            "algorithm": "sha256",
            "scope": "canonical JSON (sorted keys, compact separators, UTF-8) of the artifact",
            "value": artifact_fingerprint,
        },
        "runtime_policy": (
            "BUILD TIME ONLY. The browser never requests datos.madrid.es: it reads this committed, "
            "fingerprinted artifact."
        ),
        "interpretation_ceiling": (
            "Four INDEPENDENT published administrative development-phase values per planning "
            "ámbito, and available planning buildability (edificabilidad disponible) by use class "
            "in m² edificable, as published in the K6 current edition per official family. K7 "
            "separately compares the named 2025-07-01 and 2026-01-01 editions within their shared "
            "schema eras. The four "
            "phase fields do NOT form one overall completion stage: they are multi-dimensional, the "
            "publisher documents no ordering, and no stage, stage number, progression, percentage, "
            "completion, advancement, delay or timeline is derivable from them. A published phase "
            "state is an ADMINISTRATIVE state, never proof of physical construction progress "
            "(PLANNING_STATE_TRANSITION != PHYSICAL_URBAN_CHANGE). 'No Necesita' is a distinct "
            "published value whose precise meaning the audited documentation does not define; it "
            "does not mean not applicable, skipped, complete, zero or unavailable. 'PGOUM-85' and "
            "'PGOUM-97' are plan-of-origin markers occupying phase cells, not progress states. "
            "Available buildability is what the plan makes available, NOT what remains to be "
            "physically built and NOT an estimate of what will be built. NO dwelling count is "
            "published or derivable: the source's Nº Viviendas columns are residential "
            "buildability ÷ 100 with fractional values and are excluded. Every figure describes the "
            "WHOLE ámbito and is never apportioned into a Lens circle, a barrio or any sub-area, "
            "and never combined with a value of another analytical scope. Edition differences describe "
            "published table evidence only; they establish neither physical urban change nor an "
            "unsourced cause. No third edition is included. Geometry and "
            "identifiers come through a separate official route; every quantity and state here "
            "comes from the dated CC BY 4.0 editions."
        ),
    }

    artifact_path = out_dir / "madrid_ambito_state.json"
    meta_path = out_dir / "madrid_ambito_state.meta.json"
    with open(artifact_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(artifact, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
    with open(meta_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(f"[state] wrote {artifact_path} — {len(ambitos)} ámbitos, {artifact_path.stat().st_size} bytes")
    print(f"[state] wrote {meta_path} — fingerprint {artifact_fingerprint[:16]}")
    print("[state] phase vocabulary observed:")
    for value, info in sorted(phase_vocabulary.items(), key=lambda item: -item[1]["count"]):
        print(f"           {value!r:22} {info['count']:>5}  {info['kind']:<20} {info['vocabulary']}")
    return artifact, meta


def _edition_record(edition):
    selected = edition["selected"]
    return {
        "family": edition["family"],
        "package": edition["spec"]["package"],
        "dataset_url": edition["spec"]["dataset_url"],
        "title": edition["spec"]["title"],
        "snapshot_identity": edition["snapshot_identity"],
        "snapshot_identity_form": "family : reference_date : sha256[:12]",
        "resource_id": selected["resource_id"],
        "resource_description": selected["description"],
        "resource_url": selected["url"],
        "schema_era": selected["schema_era"],
        "schema_fingerprint": selected["schema_fingerprint"],
        "reference_date": edition["reference"]["reference_date"],
        "reference_date_month": edition["reference"]["reference_date_month"],
        "reference_date_method": edition["reference"]["method"],
        "reference_date_source_column": edition["reference"]["source_column"],
        # The five-field freshness contract types published_at as an ISO DATE, so
        # the date is published under that name and the full timestamp keeps its
        # own field. Neither is ever presented as the edition's reference date.
        "published_at": (selected["ole2"]["created"] or "")[:10] or None,
        "published_at_timestamp": selected["ole2"]["created"],
        "published_at_method": "OLE2 compound-document root-entry creation FILETIME",
        "ole2_modified": selected["ole2"]["modified"],
        "retrieved_at": selected["retrieved_at"],
        "http_last_modified": selected["http_last_modified"],
        "bytes": selected["bytes"],
        "sha256": selected["sha256"],
        "license": LICENSE,
        "update_frequency": "SEMESTRAL",
        "update_frequency_declared_as": "the catalogue's machine-readable ANNUAL_2 (twice a year)",
        # The enumerated cadence OBSERVED within the current schema era: the three
        # current-era editions are six months apart, which agrees with the declared
        # cadence. The longer observation - annual gaps 2013-2024, semestral only
        # from 2025, so the declared cadence is correct for the recent period only -
        # is recorded in prose beside it rather than forced into the enum.
        "observed_cadence": "SEMESTRAL",
        "observed_cadence_evidence": (
            "Annual (12-month) gaps from 2013 to 2024, then semestral (6-month) gaps from 2025. "
            "The catalogue's declared ANNUAL_2 (twice a year) is therefore correct for the recent "
            "period only. Both are recorded and neither is corrected."
        ),
        "source_state": "DEFINITIVE",
        "edition_count_in_catalogue": len(edition["inventory"]),
    }


def _heuristic_record(edition):
    wrong = edition["would_be_selected_by_resource_id"]
    return {
        "resource_id": wrong["resource_id"],
        "reference_date": wrong["reference_date"],
        "description": wrong["description"],
        "is_the_selected_edition": wrong["resource_id"] == edition["selected"]["resource_id"],
        "note": (
            "Recorded to show that the discredited resource-id heuristic does not agree with the "
            "reference-date rule. The builder never uses it; a regression test asserts it would "
            "pick the wrong edition."
        ),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out-dir", default="data/planning")
    parser.add_argument("--geometry", default="data/planning/madrid_ambitos.geojson")
    args = parser.parse_args(argv)
    build(args.out_dir, args.geometry)
    return 0


if __name__ == "__main__":
    sys.exit(main())
