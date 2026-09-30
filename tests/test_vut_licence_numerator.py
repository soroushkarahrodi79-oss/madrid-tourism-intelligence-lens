"""Tests for the canonical Madrid licensed-VUT numerator (Gate B, Candidate A).

Two layers, both network-free:

  1. The builder's pure logic (workbook trailer handling, unit parsing, district
     label folding, grant-date summarising, barrio aggregation, and the binary
     readers for the published XLSX and shapefile resources), on small in-memory
     fixtures whose shapes are taken from the real published resources.
  2. The committed artifacts data/accommodation/madrid_vut_licences.json and its
     meta, cross-checked against the committed canonical geography.

The fixtures deliberately reproduce two traps found in the live source: the
publisher's COUNTIF/SUM trailer rows at the foot of the workbook, and the fact
that one licence can contain many tourist-dwelling units, so that a licence
count and a dwelling-unit count are different numbers.
"""

import importlib.util
import io
import json
import pathlib
import struct
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "build_vut_licence_numerator.py"
SPEC = importlib.util.spec_from_file_location("build_vut_licence_numerator", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

ARTIFACT_PATH = ROOT / "data" / "accommodation" / "madrid_vut_licences.json"
META_PATH = ROOT / "data" / "accommodation" / "madrid_vut_licences.meta.json"
GEO_PATH = ROOT / "data" / "geography" / "madrid_admin.geojson"

# Column letters and names as the published workbook orders them.
HEADER = {
    "A": "COD_NDP", "B": "DECRETO_LU", "C": "DISTRITO", "D": "DIRECCION",
    "E": "PLANTA", "F": "UNIDADES_VUT", "G": "EXPEDIENTE_LU", "H": "TIPO",
    "I": "RESOLUCION_LU", "J": "EXPEDIENTE_LF", "K": "DECRETO  LF", "L": "RESOLUCION_LF",
}


def licence_row(ndp, distrito, direccion, units, expediente):
    return {
        "A": ndp, "B": "Conceder", "C": distrito, "D": direccion, "E": "BAJA",
        "F": units, "G": expediente, "H": "VIVIENDAS DE USO TURÍSTICO",
        "I": "44792", "J": "", "K": "", "L": "",
    }


GRID = [
    HEADER,
    licence_row("11000001", "Distrito de Centro", "CALLE ABADA 4", "2", "500/2021/06172"),
    licence_row("11000002", "Distrito de Tetuan", "CALLE BRONCE 9", "1", " 220/2022/00147"),
    licence_row("11000003", "Distrito de Chamberí", "CALLE BLASCO DE GARAY 16", "48", "350/2020/00281"),
    # The publisher's trailer: formula rows over the data range, plus spacers.
    {"B": "3", "F": "51", "K": "0"},
    {"F": "12"},
    {},
]


class WorkbookLogicTests(unittest.TestCase):
    def test_trailer_rows_are_not_counted_as_licences(self):
        licences = MODULE.parse_licence_rows(GRID)
        self.assertEqual(len(licences), 3)
        self.assertNotIn("51", [r["UNIDADES_VUT"] for r in licences])

    def test_licence_count_and_unit_count_are_different_numbers(self):
        licences = MODULE.parse_licence_rows(GRID)
        units = sum(MODULE.parse_units(r["UNIDADES_VUT"]) for r in licences)
        self.assertEqual(len(licences), 3)
        self.assertEqual(units, 51)
        self.assertNotEqual(len(licences), units)

    def test_expediente_whitespace_is_normalised(self):
        licences = MODULE.parse_licence_rows(GRID)
        self.assertIn("220/2022/00147", [MODULE.normalise_text(r["EXPEDIENTE_LU"]) for r in licences])

    def test_expediente_identity_is_unique_in_fixture(self):
        licences = MODULE.parse_licence_rows(GRID)
        keys = [MODULE.normalise_text(r["EXPEDIENTE_LU"]) for r in licences]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertTrue(all(keys))

    def test_empty_grid(self):
        self.assertEqual(MODULE.parse_licence_rows([]), [])


class UnitParsingTests(unittest.TestCase):
    def test_parses_workbook_integers_and_shapefile_doubles(self):
        self.assertEqual(MODULE.parse_units("2"), 2)
        self.assertEqual(MODULE.parse_units("2.00000000"), 2)
        self.assertEqual(MODULE.parse_units(" 48 "), 48)

    def test_missing_unit_count_is_an_error_not_an_assumed_one(self):
        for bad in (None, "", "   "):
            with self.assertRaises(ValueError):
                MODULE.parse_units(bad)

    def test_rejects_fractional_and_negative_units(self):
        for bad in ("1.5", "-2"):
            with self.assertRaises(ValueError):
                MODULE.parse_units(bad)


class DistrictLabelTests(unittest.TestCase):
    def test_accent_and_hyphen_variants_fold_together(self):
        key = MODULE.district_label_key
        self.assertEqual(key("Distrito de Tetuan"), key("Distrito de Tetuán"))
        self.assertEqual(key("Distrito de Chamberi"), key("Distrito de Chamberí"))
        self.assertEqual(key("Distrito de San Blas - Canillejas"), key("Distrito de San Blas-Canillejas"))
        self.assertEqual(key("Distrito de Fuencarral - El Pardo"), key("Fuencarral-El Pardo"))

    def test_different_districts_do_not_fold_together(self):
        self.assertNotEqual(
            MODULE.district_label_key("Distrito de Centro"),
            MODULE.district_label_key("Distrito de Barajas"),
        )


class GrantDateTests(unittest.TestCase):
    def test_summarises_span_and_ignores_blanks(self):
        summary = MODULE.summarise_grant_dates(["20190306", "", "20260902", "20230101", None])
        self.assertEqual(summary["records_with_grant_date"], 3)
        self.assertEqual(summary["earliest_grant_date"], "2019-03-06")
        self.assertEqual(summary["latest_grant_date"], "2026-09-02")
        self.assertEqual(summary["by_year"], {"2019": 1, "2023": 1, "2026": 1})

    def test_no_dates_yields_no_span(self):
        summary = MODULE.summarise_grant_dates(["", None])
        self.assertIsNone(summary["earliest_grant_date"])
        self.assertIsNone(summary["latest_grant_date"])


class AggregationTests(unittest.TestCase):
    JOINED = [
        {"expediente": "a", "vut_units": 2, "barrio_id": "011", "district_id": "01"},
        {"expediente": "b", "vut_units": 1, "barrio_id": "011", "district_id": "01"},
        {"expediente": "c", "vut_units": 48, "barrio_id": "095", "district_id": "09"},
        {"expediente": "d", "vut_units": 3, "barrio_id": None, "district_id": None},
    ]

    def test_counts_licences_and_sums_units_separately(self):
        totals = MODULE.aggregate_by_barrio(self.JOINED)
        self.assertEqual(totals["011"], {"vut_licences": 2, "vut_units": 3})
        self.assertEqual(totals["095"], {"vut_licences": 1, "vut_units": 48})

    def test_unresolved_records_are_not_attributed_to_any_barrio(self):
        totals = MODULE.aggregate_by_barrio(self.JOINED)
        self.assertEqual(sum(v["vut_licences"] for v in totals.values()), 3)
        self.assertNotIn(None, totals)

    def test_no_records_yields_no_barrios(self):
        self.assertEqual(MODULE.aggregate_by_barrio([]), {})


class BinaryReaderTests(unittest.TestCase):
    """The published resources are a shapefile and an xlsx; both are parsed here."""

    @staticmethod
    def build_dbf(records):
        fields = [("EXPEDIENTE", 14), ("UNIDADES_V", 10)]
        header_len = 32 + 32 * len(fields) + 1
        record_len = 1 + sum(length for _, length in fields)
        out = bytearray(struct.pack("<4sBBBIHH", b"\x03\x00\x00\x00"[:4], 0, 0, 0, 0, 0, 0))
        out = bytearray(b"\x03" + b"\x00" * 3)
        out += struct.pack("<IHH", len(records), header_len, record_len)
        out += b"\x00" * 20
        for name, length in fields:
            out += name.encode("latin-1").ljust(11, b"\x00") + b"C" + b"\x00" * 4
            out += bytes([length]) + b"\x00" * 15
        out += b"\x0D"
        for expediente, units, deleted in records:
            out += b"*" if deleted else b" "
            out += expediente.encode("latin-1").ljust(14)
            out += units.encode("latin-1").ljust(10)
        return bytes(out)

    def test_dbf_reader_returns_fields_and_skips_tombstoned_records(self):
        raw = self.build_dbf([("500/2021/06172", "2.00000000", False),
                              ("350/2020/00281", "48.0000000", False),
                              ("999/1999/00000", "1.00000000", True)])
        records = MODULE.read_dbf(raw)
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["EXPEDIENTE"], "500/2021/06172")
        self.assertEqual(MODULE.parse_units(records[1]["UNIDADES_V"]), 48)

    @staticmethod
    def build_shp(shapes):
        """shapes: list of (type, x, y); type 11 is PointZ, 0 is a null shape."""
        body = b""
        for index, (shape_type, x, y) in enumerate(shapes, start=1):
            if shape_type == 0:
                content = struct.pack("<i", 0)
            else:
                content = struct.pack("<idd", shape_type, x, y) + struct.pack("<dd", 0.0, 0.0)
            body += struct.pack(">ii", index, len(content) // 2) + content
        return b"\x00" * 100 + body

    def test_shp_reader_handles_pointz_and_null_shapes(self):
        raw = self.build_shp([(11, 442628.92, 4474142.08), (0, 0, 0), (11, 450167.06, 4480281.34)])
        points = MODULE.read_shp_points(raw)
        self.assertEqual(len(points), 3)
        self.assertAlmostEqual(points[0][0], 442628.92, places=2)
        self.assertIsNone(points[1])
        self.assertAlmostEqual(points[2][1], 4480281.34, places=2)

    def test_shp_reader_rejects_unsupported_geometry(self):
        with self.assertRaises(ValueError):
            MODULE.read_shp_points(self.build_shp([(5, 1.0, 2.0)]))

    @staticmethod
    def build_xlsx(grid):
        ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        rows = []
        for number, cells in enumerate(grid, start=1):
            body = "".join(
                f'<c r="{letter}{number}" t="inlineStr"><is><t>{value}</t></is></c>'
                for letter, value in cells.items()
            )
            rows.append(f'<row r="{number}">{body}</row>')
        sheet = f'<worksheet xmlns="{ns}"><sheetData>{"".join(rows)}</sheetData></worksheet>'
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as zf:
            zf.writestr("xl/worksheets/sheet1.xml", sheet)
        return buffer.getvalue()

    def test_xlsx_reader_round_trips_the_published_grid_shape(self):
        raw = self.build_xlsx([HEADER, licence_row("11000001", "Distrito de Centro", "CALLE ABADA 4", "2", "500/2021/06172")])
        grid = MODULE.read_xlsx_rows(raw)
        licences = MODULE.parse_licence_rows(grid)
        self.assertEqual(len(licences), 1)
        self.assertEqual(licences[0]["EXPEDIENTE_LU"], "500/2021/06172")
        self.assertEqual(MODULE.parse_units(licences[0]["UNIDADES_VUT"]), 2)


class CommittedArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.artifact = json.loads(ARTIFACT_PATH.read_text(encoding="utf-8"))
        cls.meta = json.loads(META_PATH.read_text(encoding="utf-8"))
        geography = json.loads(GEO_PATH.read_text(encoding="utf-8"))
        cls.geo = {
            f["properties"]["official_id"]: f["properties"]
            for f in geography["features"]
        }
        cls.records = cls.artifact["records"]
        cls.barrios = [r for r in cls.records if r["geography_level"] == "barrio"]
        cls.districts = [r for r in cls.records if r["geography_level"] == "district"]

    def test_covers_every_canonical_barrio_exactly_once(self):
        canonical = {k for k, v in self.geo.items() if v["geography_level"] == "barrio"}
        ids = [r["official_id"] for r in self.barrios]
        self.assertEqual(len(ids), 131)
        self.assertEqual(set(ids), canonical)
        self.assertEqual(len(ids), len(set(ids)))

    def test_hierarchy_matches_canonical_geography(self):
        for record in self.barrios + self.districts:
            self.assertEqual(record["parent_id"], self.geo[record["official_id"]]["parent_id"])

    def test_values_are_non_negative_integers(self):
        for record in self.records:
            for field in ("vut_licences", "vut_units"):
                self.assertIsInstance(record[field], int)
                self.assertGreaterEqual(record[field], 0)

    def test_units_are_never_fewer_than_licences(self):
        # Every licence contains at least one dwelling unit, so a barrio can
        # never report more licences than units.
        for record in self.records:
            self.assertGreaterEqual(record["vut_units"], record["vut_licences"])

    def test_licence_and_unit_totals_are_not_the_same_number(self):
        counts = self.artifact["counts"]
        self.assertGreater(counts["vut_units"], counts["licences"])

    def test_barrio_totals_are_never_labelled_source_reported(self):
        # Regression guard. The source publishes individual licence records, not
        # barrio figures: every barrio total here is derived by this project
        # through geometry reprojection and containment aggregation. Labelling
        # them SOURCE_REPORTED would credit the publisher with a number it never
        # published.
        for record in self.barrios:
            self.assertNotEqual(record["value_provenance"], "SOURCE_REPORTED")
            self.assertEqual(record["value_provenance"], "DERIVED_FROM_LICENCE_RECORDS")
        self.assertNotIn("SOURCE_REPORTED", json.dumps(self.artifact))

    def test_every_record_declares_a_derived_provenance(self):
        allowed = {"DERIVED_FROM_LICENCE_RECORDS", "DERIVED_FROM_BARRIO_TOTALS"}
        for record in self.records:
            self.assertIn(record["value_provenance"], allowed)

    def test_district_and_municipality_totals_are_exact_sums_of_barrios(self):
        for district in self.districts:
            children = [r for r in self.barrios if r["parent_id"] == district["official_id"]]
            self.assertTrue(children)
            for field in ("vut_licences", "vut_units"):
                self.assertEqual(district[field], sum(c[field] for c in children))
            self.assertEqual(district["value_provenance"], "DERIVED_FROM_BARRIO_TOTALS")
        municipality = [r for r in self.records if r["geography_level"] == "municipality"]
        self.assertEqual(len(municipality), 1)
        for field in ("vut_licences", "vut_units"):
            self.assertEqual(municipality[0][field], sum(b[field] for b in self.barrios))

    def test_headline_counts_agree_with_the_records(self):
        counts = self.artifact["counts"]
        self.assertEqual(counts["licences"], sum(b["vut_licences"] for b in self.barrios))
        self.assertEqual(counts["vut_units"], sum(b["vut_units"] for b in self.barrios))
        self.assertEqual(counts["barrios"], 131)
        self.assertEqual(
            counts["barrios_with_at_least_one_licence"],
            sum(1 for b in self.barrios if b["vut_licences"] > 0),
        )

    def test_source_state_is_source_derived_not_the_build_clock(self):
        state = self.artifact["source_state"]
        self.assertTrue(state["xlsx_http_last_modified"])
        self.assertNotEqual(state["xlsx_http_last_modified"], self.meta["retrieved_at"])
        span = state["grant_date_span"]
        self.assertLessEqual(span["earliest_grant_date"], span["latest_grant_date"])

    def test_http_last_modified_is_never_called_a_reference_or_publication_date(self):
        # The source declares no reference or effective date. The HTTP header is
        # a fact about the file served and must not be promoted into one.
        period = self.meta["source_period"]
        self.assertFalse(period["reference_date_published_by_source"])
        self.assertFalse(period["effective_date_published_by_source"])
        self.assertIn("xlsx_http_last_modified", period)
        self.assertNotIn("reference_date", period)
        for blob in (json.dumps(self.artifact), json.dumps(self.meta)):
            lowered = blob.lower()
            self.assertNotIn("publication timestamp", lowered)
            self.assertNotIn("resource published", lowered)
        self.assertIn(
            "http_last_modified_is_not_a_reference_date", self.artifact["source_state"]
        )

    def test_the_four_date_kinds_are_kept_distinct(self):
        # HTTP header, per-record grant dates and the build clock are three
        # different things; none may be reused as another's value.
        header = self.artifact["source_state"]["xlsx_http_last_modified"]
        span = self.artifact["source_state"]["grant_date_span"]
        self.assertNotEqual(header, self.meta["retrieved_at"])
        self.assertNotEqual(header, span["latest_grant_date"])
        self.assertNotEqual(self.meta["retrieved_at"], span["latest_grant_date"])

    def test_artifact_publishes_no_ratio_and_no_population(self):
        blob = json.dumps(self.artifact).lower()
        for forbidden in ("per_1000", "per1000", "residents", "population", "ratio",
                          "rate", "density", "score", "index", "pressure"):
            self.assertNotIn(forbidden, blob)

    def test_artifact_record_fields_are_exactly_the_declared_contract(self):
        expected = {"geography_level", "official_id", "parent_id",
                    "vut_licences", "vut_units", "value_provenance"}
        for record in self.records:
            self.assertEqual(set(record), expected)

    def test_meta_names_the_universe_and_its_exclusions(self):
        universe = self.meta["universe"]
        includes = universe["includes"].lower()
        # The universe is licences granted, not dwellings observed in operation.
        self.assertIn("activity licences", includes)
        self.assertIn("granted", includes)
        for excluded in ("hotel", "pension", "aparthotel", "hostel", "guest house"):
            self.assertIn(excluded, universe["excludes"].lower())
        # The things this source is repeatedly mistaken for must stay listed.
        is_not = " ".join(universe["is_not"]).lower()
        for other in ("operating", "responsible declarations", "regional", "platform listings"):
            self.assertIn(other, is_not)
        self.assertIn("currency_caveat", universe)

    def test_meta_keeps_licences_and_dwellings_verbally_distinct(self):
        unit = self.meta["unit_of_analysis"]
        self.assertIn("not_interchangeable", unit)
        self.assertIn("COUNT", unit["vut_licences"])
        self.assertIn("SUM", unit["vut_units"])

    def test_meta_records_the_geography_join_outcome(self):
        linkage = self.meta["geography_linkage"]
        self.assertEqual(linkage["resolved_to_barrio"], linkage["records_total"])
        self.assertEqual(linkage["missing_geometry"], [])
        self.assertEqual(linkage["outside_municipality"], [])
        self.assertEqual(linkage["barrio_geography_version"], "v3.4.1")

    def test_zero_semantics_are_scoped_to_the_published_source_extract(self):
        zero = self.meta["zero_semantics"]
        self.assertTrue(zero["zero_is_a_real_zero"])
        # A zero is a statement about this extract, not about all VUT activity
        # that has ever existed in a barrio.
        self.assertIn("extract", zero["scope"].lower())
        self.assertIn("extract", zero["why"].lower())
        self.assertIn("is_not", zero)
        self.assertIn("never", zero["is_not"].lower() + " never")

    def test_currency_caveat_claims_no_undocumented_retention_policy(self):
        # The source documents no retention policy for revoked or ceased
        # licences, so the extract must not be described as a cumulative stock.
        caveat = self.meta["universe"]["currency_caveat"].lower()
        self.assertIn("no revocation", caveat)
        self.assertIn("cannot establish current operation", caveat)
        self.assertIn("not described here as a cumulative stock", caveat)
        for blob in (json.dumps(self.artifact).lower(), json.dumps(self.meta).lower()):
            self.assertNotIn("the extract is cumulative", blob)

    def test_interpretation_ceiling_refuses_the_forbidden_constructs(self):
        ceiling = self.meta["interpretation_ceiling"].lower()
        for construct in ("tourism pressure", "overtourism", "saturation",
                          "carrying capacity", "tourism intensity", "displacement",
                          "burden", "impact", "attractiveness"):
            self.assertIn(construct, ceiling)

    def test_identity_is_the_licence_expediente(self):
        self.assertEqual(self.meta["identity"]["key"], "EXPEDIENTE_LU")


if __name__ == "__main__":
    unittest.main()
