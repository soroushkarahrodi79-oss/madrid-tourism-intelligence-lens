"""Tests for the K6 planning-ámbito builders (issue #68).

Two layers, both network-free and both DEPENDENCY-FREE (no requests, no xlrd, no
pyproj), because every builder keeps its third-party imports inside a
``_require_*()`` helper:

  1. The builders' PURE logic — code classification, the current-era schema
     assertion, edition selection by stated reference date, cell semantics, phase
     vocabulary, the aggregate-row guard, coordinate rounding and the
     cross-language number form — exercised on small in-memory fixtures and on
     the real header tuples.
  2. The COMMITTED artifacts under ``data/planning/``, so a bad regeneration
     fails on every push on both Windows and Ubuntu.

The contracts these defend:

  * The four published phase columns stay FOUR INDEPENDENT FIELDS: no overall
    stage, progression, percentage, completion or timeline is derivable.
  * ``No Necesita`` is its own state with no official definition, and
    ``PGOUM-85`` / ``PGOUM-97`` survive verbatim as plan-of-origin markers.
  * NO DWELLING COUNT is published: the ``Nº Viviendas`` proxy columns are read,
    counted and excluded by name.
  * A blank published cell and a published ``0`` stay different facts.
  * The edition is selected by its OWN STATED REFERENCE DATE, and selecting by
    resource id would pick the WRONG edition — the regression this gate exists
    for.
  * Schema drift FAILS the build rather than shifting a column.
  * The exact official code, ``-RP`` included, is never normalised.
"""

import importlib.util
import io
import json
import pathlib
import re
import tokenize
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _executable_code(path):
    """A module's executable tokens, with comments, docstrings and strings removed.

    Several contracts here are about what the builder DOES, not about what its
    own documentation says it refuses to do. The published interpretation ceiling
    necessarily quotes the forbidden construction in order to forbid it, so a
    plain text scan would flag the prohibition itself. Tokenising keeps the scan
    honest.
    """
    source = path.read_text(encoding="utf-8")
    kept = []
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type in (tokenize.COMMENT, tokenize.STRING, tokenize.NL, tokenize.NEWLINE):
            continue
        kept.append(token.string)
    return " ".join(kept)


def _load(name):
    path = ROOT / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


# Importable with the standard library alone: if either builder imported requests,
# xlrd or pyproj at module level, this would raise here and the whole suite would
# fail in CI, which installs none of them.
GEOMETRY_BUILDER = _load("build_planning_ambitos")
STATE_BUILDER = _load("build_ambito_development_state")

PLANNING_DIR = ROOT / "data" / "planning"
GEOMETRY = json.loads((PLANNING_DIR / "madrid_ambitos.geojson").read_text(encoding="utf-8"))
GEOMETRY_META = json.loads((PLANNING_DIR / "madrid_ambitos.meta.json").read_text(encoding="utf-8"))
STATE = json.loads((PLANNING_DIR / "madrid_ambito_state.json").read_text(encoding="utf-8"))
STATE_META = json.loads((PLANNING_DIR / "madrid_ambito_state.meta.json").read_text(encoding="utf-8"))
REGISTRY = json.loads((ROOT / "data" / "source_registry.json").read_text(encoding="utf-8"))


# ============================================================ build dependencies


class BuildDependencyContract(unittest.TestCase):
    def test_builders_import_with_the_standard_library_alone(self):
        # Already proved by the module-level loads above; asserted explicitly so
        # the reason is visible when it breaks. The Python suite installs nothing
        # in CI, so a top-level third-party import would make it unrunnable.
        for module in (GEOMETRY_BUILDER, STATE_BUILDER):
            source = pathlib.Path(module.__file__).read_text(encoding="utf-8")
            top_level = [
                line
                for line in source.splitlines()
                if re.match(r"^(?:import|from) (?:requests|xlrd|pyproj|shapely)\b", line)
            ]
            self.assertEqual(top_level, [], f"{module.__name__} imports a build dependency at module level")
            self.assertRegex(source, r"def _require_\w+\(")

    def test_build_dependencies_are_pinned_and_declared_build_only(self):
        requirements = (ROOT / "scripts" / "requirements-build.txt").read_text(encoding="utf-8")
        for pin in ("xlrd==2.0.2", "pyproj==", "requests=="):
            self.assertIn(pin, requirements)
        # xlrd is pinned to the exact version Gate L audited.
        self.assertIn("xlrd==2.0.2", requirements)
        self.assertRegex(requirements, r"NOT runtime dependencies")
        self.assertRegex(requirements, r"NOT test dependencies")
        # And none of them is a Node/browser dependency.
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        declared = {**package.get("dependencies", {}), **package.get("devDependencies", {})}
        for name in ("xlrd", "pyproj", "requests", "shapely"):
            self.assertNotIn(name, declared)


# ======================================================= geometry: pure logic


class RecordClassification(unittest.TestCase):
    def test_documented_ambito_families_classify_as_planning_ambitos(self):
        for code in (
            "APE.01.01",
            "API.21.01",
            "APR.02.09",
            "AOE.00.02-RP",
            "AOD.00.01",
            "AE.00.01",
            "UZP.1.01",
            "UZPp.03.01-RP",
            "UZI.0.02",
            "UNP.4.01",
            "UNS.4.01",
            "US.04.10-RP",
        ):
            self.assertEqual(GEOMETRY_BUILDER.classify_record_code(code), "PLANNING_AMBITO", code)

    def test_norma_zonal_grades_and_levels_are_excluded(self):
        for code in ("4", "1.1", "3.2", "9.5", "3.1.b", "7.2.e", "9.4.a"):
            self.assertEqual(GEOMETRY_BUILDER.classify_record_code(code), "NORMA_ZONAL_GRADE", code)

    def test_non_developable_land_classes_are_excluded(self):
        for code in ("NUC", "NUP.1", "NUP.6"):
            self.assertEqual(GEOMETRY_BUILDER.classify_record_code(code), "NON_DEVELOPABLE_LAND_CLASS", code)

    def test_an_unknown_code_is_unclassified_rather_than_admitted(self):
        # The builder FAILS the build on this class: a record is never silently
        # admitted to the production universe and never silently discarded.
        for code in ("", None, "   ", "XYZ.01.01", "WHATEVER", "APEX", "APE"):
            self.assertEqual(GEOMETRY_BUILDER.classify_record_code(code), "UNCLASSIFIED_SOURCE_RECORD", repr(code))

    def test_a_numeric_code_can_never_be_absorbed_by_a_prefix_match(self):
        # The families are anchored at a dotted separator, so no zoning grade can
        # drift into the ámbito universe through a loose prefix test.
        for code in ("1.1", "8.2.c"):
            self.assertNotEqual(GEOMETRY_BUILDER.classify_record_code(code), "PLANNING_AMBITO", code)

    def test_classification_never_rewrites_or_normalises_the_code(self):
        # It returns a class, never a code: there is no path through which a
        # -RP suffix could be stripped on the way into the artifact.
        result = GEOMETRY_BUILDER.classify_record_code("UZPp.03.01-RP")
        self.assertIn(result, GEOMETRY_BUILDER.RECORD_CLASSES)
        self.assertNotIn("UZP", result)
        source = pathlib.Path(GEOMETRY_BUILDER.__file__).read_text(encoding="utf-8")
        self.assertRegex(source, r"The code is NEVER normalised")


class GeometryTransformation(unittest.TestCase):
    POLYGON = {
        "type": "MultiPolygon",
        "coordinates": [[[[440461.0212345678, 4475228.8912345], [440462.0, 4475229.0], [440463.5, 4475230.25], [440461.0212345678, 4475228.8912345]]]],
    }

    def test_rounding_changes_precision_only_and_removes_no_vertex(self):
        before = GEOMETRY_BUILDER.count_vertices(self.POLYGON)
        rounded = GEOMETRY_BUILDER.round_geometry({"type": "MultiPolygon", "coordinates": [[[[1.123456789, 2.987654321]] * 4]]})
        self.assertEqual(GEOMETRY_BUILDER.count_vertices(rounded), 4)
        self.assertEqual(rounded["coordinates"][0][0][0], [1.1234568, 2.9876543])
        # Structure is preserved exactly: same type, same nesting, same count.
        same = GEOMETRY_BUILDER.round_geometry(self.POLYGON)
        self.assertEqual(same["type"], self.POLYGON["type"])
        self.assertEqual(GEOMETRY_BUILDER.count_vertices(same), before)
        self.assertEqual(len(same["coordinates"]), len(self.POLYGON["coordinates"]))
        self.assertEqual(len(same["coordinates"][0][0]), len(self.POLYGON["coordinates"][0][0]))

    def test_the_crs_contract_is_explicit_and_never_guessed(self):
        self.assertEqual(GEOMETRY_BUILDER.SOURCE_EPSG, 25830)
        self.assertEqual(GEOMETRY_BUILDER.TARGET_EPSG, 4326)
        self.assertIn("always_xy=True", GEOMETRY_BUILDER.REPROJECTION_PIPELINE)
        self.assertEqual(GEOMETRY_BUILDER.COORD_DECIMALS, 7)
        source = pathlib.Path(GEOMETRY_BUILDER.__file__).read_text(encoding="utf-8")
        # The builder refuses a response that declares another CRS rather than
        # reinterpreting the coordinates.
        self.assertRegex(source, r"refusing to guess a coordinate reference system")
        # And it fails when its own transform disagrees with the publisher's.
        self.assertRegex(source, r"must be resolved, never rounded away")

    def test_vertex_key_sets_ignore_encoding_but_not_geometry(self):
        polygon = {"type": "Polygon", "coordinates": [[[1.0, 2.0], [3.0, 4.0], [1.0, 2.0]]]}
        multi = {"type": "MultiPolygon", "coordinates": [[[[3.0, 4.0], [1.0, 2.0], [1.0, 2.0]]]]}
        # A single-part MultiPolygon and a Polygon over the same vertices compare
        # equal: that difference is GeoJSON encoding, not geometry.
        self.assertEqual(
            GEOMETRY_BUILDER.vertex_key_set(polygon),
            GEOMETRY_BUILDER.vertex_key_set(multi),
        )
        moved = {"type": "Polygon", "coordinates": [[[1.0, 2.0], [3.0, 4.5], [1.0, 2.0]]]}
        self.assertNotEqual(
            GEOMETRY_BUILDER.vertex_key_set(polygon),
            GEOMETRY_BUILDER.vertex_key_set(moved),
        )


# ========================================================== state: pure logic


class CurrentEraSchemaAssertion(unittest.TestCase):
    S1 = list(STATE_BUILDER.S1_EXPECTED_COLUMNS)
    S2 = list(STATE_BUILDER.S2_EXPECTED_COLUMNS)

    def test_the_real_current_era_headers_pass(self):
        self.assertTrue(STATE_BUILDER.assert_current_era_schema("S1", self.S1, 1))
        self.assertTrue(STATE_BUILDER.assert_current_era_schema("S2", self.S2, 1))
        # The publisher stores the Nº Viviendas headers with an embedded newline;
        # only whitespace is folded, never a column name.
        wrapped = list(self.S2)
        wrapped[6] = "Colectiva. Nº \nViviendas"
        wrapped[8] = "Unifamiliar. Nº \nViviendas"
        self.assertTrue(STATE_BUILDER.assert_current_era_schema("S2", wrapped, 1))

    def test_a_moved_column_fails_the_build(self):
        swapped = list(self.S1)
        swapped[6], swapped[7] = swapped[7], swapped[6]
        with self.assertRaises(SystemExit) as caught:
            STATE_BUILDER.assert_current_era_schema("S1", swapped, 1)
        self.assertIn("pinned current-era schema", str(caught.exception))

    def test_a_renamed_removed_or_added_column_fails_the_build(self):
        for mutated in (
            [*self.S1[:6], "Estado de desarrollo. Planeamiento urbanistico", *self.S1[7:]],
            [*self.S1[:-1]],
            [*self.S1, "Nueva columna"],
        ):
            with self.assertRaises(SystemExit):
                STATE_BUILDER.assert_current_era_schema("S1", mutated, 1)

    def test_no_fuzzy_match_and_no_index_shift_is_tolerated(self):
        # A header that merely CONTAINS the expected tokens is not the schema.
        loose = [f"  {name}  " for name in self.S1]
        self.assertTrue(STATE_BUILDER.assert_current_era_schema("S1", loose, 1), "whitespace only is folded")
        shifted = ["", *self.S1]
        with self.assertRaises(SystemExit):
            STATE_BUILDER.assert_current_era_schema("S1", shifted, 1)

    def test_a_cross_era_multi_sheet_edition_is_refused(self):
        # The 2013-2024 S1 editions are 21 per-district sheets. Even with a
        # matching header they are not comparable four-phase evidence.
        with self.assertRaises(SystemExit) as caught:
            STATE_BUILDER.assert_current_era_schema("S1", self.S1, 21)
        self.assertIn("not comparable four-phase evidence", str(caught.exception))


class EditionSelection(unittest.TestCase):
    # The REAL non-chronological ordering Gate L measured: 203200-15 is Enero
    # 2026 while 203200-16 is Enero 2025 and 203200-2 is Julio 2025. This is the
    # regression fixture: selecting "latest" by resource id returns Enero 2025.
    S1_INVENTORY = [
        {"resource_id": "203200-16-desarrollo-ambitos", "reference_date": "2025-01", "schema_era": "S1_FOUR_PHASE_FLAT"},
        {"resource_id": "203200-2-desarrollo-ambitos-xls", "reference_date": "2025-07", "schema_era": "S1_FOUR_PHASE_FLAT"},
        {"resource_id": "203200-15-desarrollo-ambitos", "reference_date": "2026-01", "schema_era": "S1_FOUR_PHASE_FLAT"},
        {"resource_id": "203200-0-desarrollo-ambitos-xls", "reference_date": "2013-01", "schema_era": "S1_SINGLE_STATE_PER_DISTRICT"},
        {"resource_id": "203200-12-desarrollo-ambitos-xls", "reference_date": "2024-01", "schema_era": "S1_SINGLE_STATE_PER_DISTRICT"},
    ]

    def test_latest_is_the_newest_stated_reference_date_within_the_current_era(self):
        selected, other_era, _ = STATE_BUILDER.select_current_era_edition(
            self.S1_INVENTORY, "S1", "S1_FOUR_PHASE_FLAT"
        )
        self.assertEqual(selected["reference_date"], "2026-01")
        self.assertEqual(selected["resource_id"], "203200-15-desarrollo-ambitos")
        # The superseded era is rejected, not parsed as equivalent evidence.
        self.assertEqual(len(other_era), 2)
        for edition in other_era:
            self.assertEqual(edition["schema_era"], "S1_SINGLE_STATE_PER_DISTRICT")

    def test_REGRESSION_selecting_by_resource_id_would_pick_the_wrong_edition(self):
        selected, _, by_resource_id = STATE_BUILDER.select_current_era_edition(
            self.S1_INVENTORY, "S1", "S1_FOUR_PHASE_FLAT"
        )
        # The discredited heuristic picks the HIGHEST resource id, which is the
        # EARLIEST current-era edition. This is the original Gate K assumption
        # and must never come back.
        self.assertEqual(by_resource_id["resource_id"], "203200-16-desarrollo-ambitos")
        self.assertEqual(by_resource_id["reference_date"], "2025-01")
        self.assertNotEqual(by_resource_id["resource_id"], selected["resource_id"])
        self.assertLess(by_resource_id["reference_date"], selected["reference_date"])

    def test_an_edition_with_no_stated_date_is_refused_rather_than_ordered_some_other_way(self):
        with self.assertRaises(SystemExit) as caught:
            STATE_BUILDER.select_current_era_edition(
                [{"resource_id": "x-1", "reference_date": None, "schema_era": "S1_FOUR_PHASE_FLAT"}],
                "S1",
                "S1_FOUR_PHASE_FLAT",
            )
        self.assertIn("never falls back to a resource id", str(caught.exception))

    def test_no_current_era_edition_fails_rather_than_falling_back_to_an_older_schema(self):
        with self.assertRaises(SystemExit) as caught:
            STATE_BUILDER.select_current_era_edition(
                [e for e in self.S1_INVENTORY if e["schema_era"] != "S1_FOUR_PHASE_FLAT"],
                "S1",
                "S1_FOUR_PHASE_FLAT",
            )
        self.assertIn("not equivalent evidence", str(caught.exception))

    def test_the_resource_id_number_is_recorded_but_never_used_to_order(self):
        self.assertEqual(STATE_BUILDER._resource_id_num("203200-15-desarrollo-ambitos"), 15)
        self.assertEqual(STATE_BUILDER._resource_id_num("nope"), -1)
        source = pathlib.Path(STATE_BUILDER.__file__).read_text(encoding="utf-8")
        self.assertRegex(source, r"Recorded for the audit, NEVER for ordering")


class CellSemantics(unittest.TestCase):
    def test_a_blank_cell_and_a_published_zero_are_different_facts(self):
        published = STATE_BUILDER.classify_numeric_cell(2, 0)
        self.assertEqual(published["state"], "PUBLISHED")
        self.assertEqual(published["value"], 0)
        for empty_type in (0, 6):
            blank = STATE_BUILDER.classify_numeric_cell(empty_type, "")
            self.assertEqual(blank["state"], "NOT_PUBLISHED")
            self.assertIsNone(blank["value"], "missing never becomes zero")

    def test_a_published_number_keeps_its_value(self):
        cell = STATE_BUILDER.classify_numeric_cell(2, 4752314.0)
        self.assertEqual(cell["state"], "PUBLISHED")
        self.assertEqual(cell["value"], 4752314)
        fractional = STATE_BUILDER.classify_numeric_cell(2, 2569.25)
        self.assertEqual(fractional["value"], 2569.25)

    def test_non_numeric_text_is_reported_verbatim_rather_than_coerced(self):
        cell = STATE_BUILDER.classify_numeric_cell(1, " n/d ")
        self.assertEqual(cell["state"], "NOT_PUBLISHED_NON_NUMERIC")
        self.assertIsNone(cell["value"])
        self.assertEqual(cell["source_text"], "n/d")
        # Empty text is simply not published, not a non-numeric observation.
        self.assertEqual(STATE_BUILDER.classify_numeric_cell(1, "   ")["state"], "NOT_PUBLISHED")

    def test_numbers_take_a_form_every_json_reader_serialises_identically(self):
        # Python writes an integral float as "4752314.0"; the deployment
        # validator recomputes the fingerprint in Node, which writes "4752314".
        self.assertEqual(STATE_BUILDER._json_number(4752314.0), 4752314)
        self.assertIsInstance(STATE_BUILDER._json_number(4752314.0), int)
        self.assertEqual(STATE_BUILDER._json_number(0.0), 0)
        self.assertEqual(STATE_BUILDER._json_number(2569.25), 2569.25)
        self.assertIsInstance(STATE_BUILDER._json_number(2569.25), float)


class PhaseVocabulary(unittest.TestCase):
    def test_every_observed_value_is_preserved_verbatim(self):
        for raw in (
            "Sin Iniciar",
            "En tramitación",
            "En Ejecución",
            "Finalizado",
            "No Necesita",
            "PGOUM-85",
            "PGOUM-97",
            "Finalizada",
            "En  Tramitación",
            "FinalizadaS",
        ):
            record = STATE_BUILDER.classify_phase_value(raw)
            self.assertEqual(record["source_value"], raw, raw)
            self.assertEqual(record["state"], "PUBLISHED", raw)

    def test_no_necesita_is_its_own_kind_and_never_sin_iniciar(self):
        no_necesita = STATE_BUILDER.classify_phase_value("No Necesita")
        sin_iniciar = STATE_BUILDER.classify_phase_value("Sin Iniciar")
        self.assertEqual(no_necesita["kind"], "UNRESOLVED_MEANING")
        self.assertEqual(sin_iniciar["kind"], "PHASE_VALUE")
        self.assertNotEqual(no_necesita["kind"], sin_iniciar["kind"])
        # It is never mapped to zero, to unavailable, or to another label.
        self.assertEqual(no_necesita["source_value"], "No Necesita")
        self.assertNotEqual(no_necesita["state"], "NOT_PUBLISHED")
        # The publisher lists it, so it IS documented vocabulary; what is
        # unresolved is its MEANING, and the two are not confused.
        self.assertEqual(no_necesita["vocabulary"], "SOURCE_DOCUMENTED")
        self.assertEqual(
            STATE_META["phase_vocabulary"]["no_necesita"]["status"],
            "SOURCE_OBSERVED_INTERPRETATION_UNRESOLVED",
        )

    def test_pgoum_markers_are_plan_origin_markers_not_phase_values(self):
        for raw in ("PGOUM-85", "PGOUM-97", "PGOUM 85", "PGOUM 97"):
            record = STATE_BUILDER.classify_phase_value(raw)
            self.assertEqual(record["kind"], "PLAN_ORIGIN_MARKER", raw)
            self.assertEqual(record["source_value"], raw, raw)
            # Punctuation drift of a documented value, not an undocumented one.
            self.assertEqual(record["vocabulary"], "SOURCE_DOCUMENTED", raw)

    def test_en_ejecucion_is_observed_but_not_documented(self):
        record = STATE_BUILDER.classify_phase_value("En Ejecución")
        self.assertEqual(record["vocabulary"], "SOURCE_OBSERVED_NOT_DOCUMENTED")
        self.assertIsNone(record["documented_as"])
        self.assertEqual(record["kind"], "PHASE_VALUE")

    def test_spelling_variants_resolve_to_their_documented_value_without_being_rewritten(self):
        for raw in ("Finalizada", "Finalizadas", "FinalizadaS"):
            record = STATE_BUILDER.classify_phase_value(raw)
            self.assertEqual(record["vocabulary"], "SOURCE_DOCUMENTED_SPELLING_VARIANT", raw)
            self.assertEqual(record["documented_as"], "Finalizado", raw)
            # The verbatim value is still what the artifact carries.
            self.assertEqual(record["source_value"], raw, raw)
        # Punctuation and spacing drift of a documented value is recognised.
        self.assertEqual(STATE_BUILDER.classify_phase_value("En  Tramitación")["vocabulary"], "SOURCE_DOCUMENTED")

    def test_a_blank_phase_cell_is_not_published_rather_than_a_state(self):
        for raw in (None, "", "   "):
            record = STATE_BUILDER.classify_phase_value(raw)
            self.assertEqual(record["state"], "NOT_PUBLISHED", repr(raw))
            self.assertIsNone(record["source_value"])
            self.assertIsNone(record["kind"])

    def test_a_phase_record_carries_no_rank_order_or_number(self):
        for raw in ("Sin Iniciar", "Finalizado", "No Necesita", "PGOUM-85"):
            record = STATE_BUILDER.classify_phase_value(raw)
            for key, value in record.items():
                self.assertNotIsInstance(value, (int, float), f"{raw}.{key} is numeric")
                self.assertNotRegex(key, r"(?i)rank|order|index|stage|progress|percent|score")

    def test_the_four_phase_fields_are_four_and_carry_no_sequence(self):
        self.assertEqual(len(STATE_BUILDER.PHASE_FIELDS), 4)
        keys = [key for key, _ in STATE_BUILDER.PHASE_FIELDS]
        self.assertEqual(keys, ["planeamiento", "gestion", "urbanizacion_proyecto", "urbanizacion_obras"])
        for key in keys:
            self.assertNotRegex(key, r"\d")
        source = pathlib.Path(STATE_BUILDER.__file__).read_text(encoding="utf-8")
        self.assertRegex(source, r"this tuple carries no rank and no sequence")


class AggregateRowGuard(unittest.TestCase):
    def test_an_aggregate_total_row_is_recognised_in_the_code_or_the_text(self):
        self.assertTrue(STATE_BUILDER.is_aggregate_total_row("Total"))
        self.assertTrue(STATE_BUILDER.is_aggregate_total_row("TOTAL"))
        self.assertTrue(STATE_BUILDER.is_aggregate_total_row("total general"))
        self.assertTrue(STATE_BUILDER.is_aggregate_total_row("APE.01.01", "TOTAL"))
        self.assertTrue(STATE_BUILDER.is_aggregate_total_row("APE.01.01", "Total ciudad"))

    def test_a_real_ambito_row_is_never_mistaken_for_an_aggregate(self):
        for code in ("APE.01.01", "UZPp.03.01-RP", "US.04.10-RP"):
            self.assertFalse(STATE_BUILDER.is_aggregate_total_row(code, "ENSANCHE DE VALLECAS"), code)


class DwellingCeiling(unittest.TestCase):
    def test_the_dwelling_proxy_columns_are_named_and_excluded_by_the_builder(self):
        self.assertEqual(
            list(STATE_BUILDER.EXCLUDED_DWELLING_PROXY_COLUMNS),
            ["Colectiva. Nº Viviendas", "Unifamiliar. Nº Viviendas"],
        )
        # They ARE part of the pinned schema — the builder asserts the publisher
        # still ships them — and they are excluded from the artifact, which is a
        # different thing from not reading them.
        for column in STATE_BUILDER.EXCLUDED_DWELLING_PROXY_COLUMNS:
            self.assertIn(column, STATE_BUILDER.S2_EXPECTED_COLUMNS)
        self.assertNotIn("Nº Viviendas", [column for _, column in STATE_BUILDER.USE_CLASSES])

    def test_the_builder_derives_no_dwelling_count_anywhere(self):
        # EXECUTABLE CODE only. The builder's published ceiling has to quote the
        # thing it refuses ("a mechanical m²/100 proxy at an assumed 100 m² per
        # dwelling"), and quoting it is not doing it — so comments, docstrings
        # and string literals are tokenised away before the scan.
        code = _executable_code(pathlib.Path(STATE_BUILDER.__file__))
        # No m²-per-dwelling divisor: the proxy cannot be reconstructed.
        self.assertNotRegex(code, r"/\s*100\b")
        # No identifier that would HOLD or PRODUCE a dwelling count. The
        # exclusion machinery is deliberately named for what it excludes
        # (EXCLUDED_DWELLING_PROXY_COLUMNS, dwelling_proxy_cells_read), so the
        # ban is on count-shaped names, not on the word.
        self.assertNotRegex(
            code,
            r"(?i)dwelling_count|dwellings\b|viviendas_|n_viviendas|homes_|housing_unit|protected_housing",
        )

    def test_the_use_classes_are_the_four_documented_ones_in_square_metres(self):
        self.assertEqual(len(STATE_BUILDER.USE_CLASSES), 4)
        self.assertEqual(
            [key for key, _ in STATE_BUILDER.USE_CLASSES],
            ["colectiva_residencial", "unifamiliar_residencial", "industrial", "terciario"],
        )
        self.assertEqual(STATE_BUILDER.BUILDABILITY_UNIT, "m² edificable")


class RowMultiplicity(unittest.TestCase):
    def _row(self, situacion, district="21"):
        return {"situacion": situacion, "district_code": district, "district_name": "BARAJAS"}

    def test_one_published_row_is_a_single_row(self):
        described = STATE_BUILDER.describe_multiplicity([self._row("FASE DE EDIFICACION")])
        self.assertEqual(described["publication"], "SINGLE_PUBLISHED_ROW")
        self.assertEqual(described["row_count"], 1)
        self.assertIsNone(described["cause"])

    def test_rows_that_differ_by_situacion_are_published_separately_and_never_combined(self):
        described = STATE_BUILDER.describe_multiplicity(
            [self._row("FASE GESTION Y/O URBANIZACION"), self._row("FASE DE EDIFICACION")]
        )
        self.assertEqual(described["publication"], "MULTIPLE_PUBLISHED_ROWS_NOT_COMBINED")
        self.assertEqual(described["cause"], "DISTINCT_PUBLISHED_SITUACION")
        self.assertIn("never added together", described["detail"])

    def test_rows_the_source_does_not_distinguish_are_cause_unresolved(self):
        described = STATE_BUILDER.describe_multiplicity(
            [self._row("FASE DE EDIFICACION", "20"), self._row("FASE DE EDIFICACION", "21")]
        )
        self.assertEqual(described["publication"], "MULTIPLE_PUBLISHED_ROWS_NOT_COMBINED")
        self.assertEqual(described["cause"], "CAUSE_UNRESOLVED")
        # No cause is attributed that the source does not state, and the
        # disagreement itself is reported.
        self.assertIn("The source states no cause", described["detail"])
        self.assertIn("20", described["detail"])
        self.assertIn("21", described["detail"])


class JoinReport(unittest.TestCase):
    def test_the_join_reports_both_residual_sides_and_hides_nothing(self):
        report = STATE_BUILDER.join_report("S1", ["A", "B", "C"], ["B", "C", "D"])
        self.assertEqual(report["matching"], "EXACT")
        self.assertEqual(report["normalisation"], "NONE")
        self.assertEqual(report["matched"], 2)
        self.assertEqual(report["table_codes"], 3)
        self.assertEqual(report["unmatched_in_table"], ["A"])
        self.assertEqual(report["unmatched_in_table_count"], 1)
        self.assertEqual(report["geometry_only_count"], 1)
        self.assertAlmostEqual(report["match_rate_of_table"], 2 / 3, places=5)

    def test_the_join_is_exact_so_a_normalised_code_does_not_match(self):
        report = STATE_BUILDER.join_report("S1", ["UZPp.03.01-RP"], ["UZP.03.01"])
        self.assertEqual(report["matched"], 0)
        self.assertEqual(report["unmatched_in_table"], ["UZPp.03.01-RP"])


# ==================================================== the committed artifacts


class CommittedGeometryArtifact(unittest.TestCase):
    def test_the_universe_is_filtered_and_every_exclusion_is_reported(self):
        universe = GEOMETRY_META["universe"]
        self.assertEqual(len(GEOMETRY["features"]), universe["included_feature_count"])
        excluded = sum(record["count"] for record in universe["excluded_by_class"].values())
        self.assertEqual(universe["included_feature_count"] + excluded, universe["raw_feature_count"])
        self.assertEqual(universe["excluded_by_class"]["UNCLASSIFIED_SOURCE_RECORD"]["count"], 0)
        for name, record in universe["excluded_by_class"].items():
            self.assertEqual(len(record["codes"]), record["count"], name)
        # The raw count is never the ámbito count.
        self.assertGreater(universe["raw_feature_count"], universe["included_feature_count"])
        self.assertIn("prohibited wording", universe["raw_feature_count_is_not_the_ambito_count"])

    def test_every_committed_feature_classifies_as_a_planning_ambito(self):
        for feature in GEOMETRY["features"]:
            code = feature["properties"]["ambito_code"]
            self.assertEqual(GEOMETRY_BUILDER.classify_record_code(code), "PLANNING_AMBITO", code)
            self.assertEqual(feature["properties"]["source_record_class"], "PLANNING_AMBITO")

    def test_the_committed_fingerprint_matches_the_artifact(self):
        self.assertEqual(
            GEOMETRY_META["fingerprint"]["value"],
            GEOMETRY_BUILDER.fingerprint(GEOMETRY),
        )
        self.assertEqual(GEOMETRY_META["fingerprint"]["algorithm"], "sha256")

    def test_the_committed_coordinates_are_wgs84_degrees_over_madrid(self):
        for feature in GEOMETRY["features"][:40]:
            for lon, lat in GEOMETRY_BUILDER.iter_coordinates(feature["geometry"]):
                self.assertTrue(-4.2 < lon < -3.3, f"{feature['properties']['ambito_code']} lon {lon}")
                self.assertTrue(40.1 < lat < 40.8, f"{feature['properties']['ambito_code']} lat {lat}")
                # Rounded to the declared precision, never beyond it.
                self.assertEqual(round(lon, GEOMETRY_BUILDER.COORD_DECIMALS), lon)

    def test_the_geometry_is_sorted_by_exact_code_so_a_rebuild_is_byte_identical(self):
        codes = [feature["properties"]["ambito_code"] for feature in GEOMETRY["features"]]
        self.assertEqual(codes, sorted(codes))
        self.assertEqual(len(codes), len(set(codes)))


class CommittedStateArtifact(unittest.TestCase):
    def test_the_committed_fingerprint_matches_the_artifact(self):
        self.assertEqual(STATE_META["fingerprint"]["value"], STATE_BUILDER.fingerprint(STATE))

    def test_the_state_artifact_is_keyed_on_the_geometry_universe(self):
        geometry_codes = sorted(f["properties"]["ambito_code"] for f in GEOMETRY["features"])
        self.assertEqual(sorted(STATE["ambitos"]), geometry_codes)

    def test_no_dwelling_proxy_column_or_key_reached_the_artifact(self):
        text = json.dumps(STATE, ensure_ascii=False)
        for column in STATE_BUILDER.EXCLUDED_DWELLING_PROXY_COLUMNS:
            self.assertNotIn(column, text, column)
        for token in ("Viviendas", "viviendas", "dwelling", "Nº Viv"):
            self.assertNotIn(token, text, token)

    def test_no_scalar_stage_key_exists_anywhere_in_the_artifact(self):
        forbidden = re.compile(r"(?i)stage|progress|percent|completion|advance|delay|timeline|viviend|dwelling|housing")
        offending = []

        def walk(node, path=""):
            if isinstance(node, dict):
                for key, value in node.items():
                    if forbidden.search(str(key)):
                        offending.append(f"{path}/{key}")
                    walk(value, f"{path}/{key}")
            elif isinstance(node, list):
                for index, value in enumerate(node):
                    walk(value, f"{path}[{index}]")

        walk(STATE)
        self.assertEqual(offending, [])

    def test_every_published_record_carries_exactly_four_phases_with_verbatim_values(self):
        keys = {key for key, _ in STATE_BUILDER.PHASE_FIELDS}
        published = 0
        for code, record in STATE["ambitos"].items():
            state = record["development_state"]
            if state["availability"] != "PUBLISHED":
                self.assertEqual(state["availability"], "NOT_PUBLISHED_IN_EDITION", code)
                self.assertNotIn("phases", state, code)
                continue
            published += 1
            self.assertEqual(set(state["phases"]), keys, code)
            for key, phase in state["phases"].items():
                self.assertEqual(phase["source_column"], dict(STATE_BUILDER.PHASE_FIELDS)[key], code)
                if phase["state"] == "PUBLISHED":
                    # The verbatim value re-classifies to the same record, so the
                    # artifact and the classifier cannot drift apart.
                    again = STATE_BUILDER.classify_phase_value(phase["source_value"])
                    self.assertEqual(again["kind"], phase["kind"], f"{code}.{key}")
                    self.assertEqual(again["vocabulary"], phase["vocabulary"], f"{code}.{key}")
        self.assertGreater(published, 500)

    def test_every_buildability_cell_carries_its_unit_and_missing_stays_null(self):
        use_keys = {key for key, _ in STATE_BUILDER.USE_CLASSES}
        rows = 0
        for code, record in STATE["ambitos"].items():
            published = record["available_buildability"]
            if published["availability"] != "PUBLISHED":
                continue
            for row in published["rows"]:
                rows += 1
                self.assertEqual(set(row["use_classes"]), use_keys, code)
                for key, cell in row["use_classes"].items():
                    self.assertEqual(cell["unit"], STATE_BUILDER.BUILDABILITY_UNIT, f"{code}.{key}")
                    if cell["state"] == "PUBLISHED":
                        self.assertIsInstance(cell["value"], (int, float), f"{code}.{key}")
                    else:
                        self.assertIsNone(cell["value"], f"{code}.{key}")
        self.assertGreater(rows, 150)

    def test_no_aggregate_total_row_entered_the_artifact(self):
        for code, record in STATE["ambitos"].items():
            self.assertFalse(STATE_BUILDER.is_aggregate_total_row(code), code)
            published = record["available_buildability"]
            if published["availability"] != "PUBLISHED":
                continue
            for row in published["rows"]:
                self.assertFalse(
                    STATE_BUILDER.is_aggregate_total_row(code, row["denomination"], row["situacion"]),
                    code,
                )

    def test_the_selected_editions_are_the_current_era_and_dated_by_themselves(self):
        for family, era in (
            ("development_state", "S1_FOUR_PHASE_FLAT"),
            ("available_buildability", "S2_SPLIT_RESIDENTIAL_FLAT"),
        ):
            edition = STATE["editions"][family]
            self.assertEqual(edition["schema_era"], era, family)
            self.assertRegex(edition["reference_date"], r"^\d{4}-\d{2}-\d{2}$")
            self.assertEqual(edition["reference_date_method"], "IN_FILE_EXCEL_SERIAL")
            # published_at is an ISO date (the freshness contract's type) while
            # the full OLE2 timestamp keeps its own field.
            self.assertRegex(edition["published_at"], r"^\d{4}-\d{2}-\d{2}$")
            self.assertRegex(edition["published_at_timestamp"], r"^\d{4}-\d{2}-\d{2}T")
            self.assertEqual(edition["observed_cadence"], "SEMESTRAL")
            self.assertIn("Annual (12-month) gaps", edition["observed_cadence_evidence"])

    def test_the_joins_reproduce_the_gate_l_baseline_and_name_every_residual(self):
        self.assertEqual(STATE_META["joins"]["S1"]["matched"], 666)
        self.assertEqual(STATE_META["joins"]["S1"]["table_codes"], 667)
        self.assertEqual(STATE_META["joins"]["S2"]["matched"], 230)
        self.assertEqual(STATE_META["joins"]["S2"]["table_codes"], 230)
        for family in ("S1", "S2"):
            join = STATE_META["joins"][family]
            self.assertEqual(join["matching"], "EXACT")
            self.assertEqual(join["normalisation"], "NONE")
            self.assertEqual(len(join["unmatched_in_table"]), join["unmatched_in_table_count"])
            self.assertEqual(join["matched"] + join["unmatched_in_table_count"], join["table_codes"])

    def test_the_district_anomaly_is_recorded_rather_than_corrected(self):
        attribution = STATE_META["district_attribution"]
        self.assertIn("Codigo_Distrito", attribution["source"])
        # The S2 Barajas duplication is an OBSERVED publisher inconsistency, kept
        # verbatim and classified unresolved; no row is preferred or merged.
        self.assertIn("COD_DISTRITO 20", attribution["observed_anomaly"])
        self.assertIn("CAUSE_UNRESOLVED", attribution["observed_anomaly"])
        self.assertIn("no row is preferred, merged", attribution["observed_anomaly"])


class RegistryAgreement(unittest.TestCase):
    def _source(self, source_id):
        return next(s for s in REGISTRY["sources"] if s["id"] == source_id)

    def test_the_registry_and_the_sidecars_agree_on_the_editions(self):
        source = self._source("planning_ambito_state")
        for family in ("development_state", "available_buildability"):
            self.assertEqual(
                source["editions"][family]["snapshot_identity"],
                STATE["editions"][family]["snapshot_identity"],
                family,
            )
            self.assertEqual(source["editions"][family]["sha256"], STATE["editions"][family]["sha256"], family)
        self.assertEqual(source["reference_date"], STATE["editions"]["development_state"]["reference_date"])
        self.assertEqual(source["published_at"], STATE["editions"]["development_state"]["published_at"])
        self.assertEqual(source["scope"], STATE["scope"])

    def test_the_geometry_registry_entry_carries_the_reuse_basis_and_no_date(self):
        source = self._source("planning_ambito_geometry")
        self.assertIsNone(source["reference_date"])
        self.assertIsNone(source["published_at"])
        self.assertEqual(source["update_frequency"], "NONE_DECLARED")
        self.assertEqual(source["source_state"], "NOT_DECLARED_BY_PUBLISHER")
        self.assertEqual(source["license"], "AYUNTAMIENTO_DE_MADRID_GENERAL_REUSE_CONDITIONS")
        self.assertEqual(source["license_url"], GEOMETRY_META["reuse"]["conditions_url"])
        self.assertEqual(source["attribution"], GEOMETRY_META["reuse"]["attribution_full"])
        self.assertIn("WFS", source["retrieval_route"])
        self.assertIn("Build time only", source["retrieval_route"])

    def test_both_planning_sources_are_committed_and_block_deployment(self):
        for source_id in ("planning_ambito_geometry", "planning_ambito_state"):
            source = self._source(source_id)
            self.assertFalse(source["rebuilt_at_deploy"], source_id)
            self.assertTrue(source["blocks_deployment"], source_id)
            self.assertFalse(source["unavailable_is_allowed"], source_id)
            self.assertGreater(len(source["interpretation_ceiling"]), 400, source_id)


class NoRuntimeSourceDependency(unittest.TestCase):
    def test_the_application_never_names_an_official_planning_service(self):
        hosts = ("sigma.madrid.es", "datos.madrid.es", "geoportal.madrid.es", "WFSServer")
        for relative in ("index.html", "js/app.js", "js/planning-ambito.js", "js/scope-rail.js", "js/shell-copy.js"):
            text = (ROOT / relative).read_text(encoding="utf-8")
            for host in hosts:
                self.assertNotIn(host, text, f"{relative} names {host}")

    def test_the_committed_artifacts_are_the_only_planning_source_the_browser_reads(self):
        app = (ROOT / "js" / "app.js").read_text(encoding="utf-8")
        self.assertIn("data/planning/madrid_ambitos.geojson", app)
        self.assertIn("data/planning/madrid_ambito_state.json", app)
        module = (ROOT / "js" / "planning-ambito.js").read_text(encoding="utf-8")
        # The browser convenience points at committed repository paths only.
        for url in re.findall(r'"(data/[^"]+)"', module):
            self.assertTrue((ROOT / url).exists(), url)


if __name__ == "__main__":
    unittest.main()
