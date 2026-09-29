"""Tests for the canonical Madrid residential population denominator.

Two layers, both network-free and dependency-free:

  1. The builder's pure logic (number/period parsing, code normalisation,
     canonical reconciliation and its failure modes, deterministic aggregation),
     on small in-memory fixtures.
  2. The committed artifacts data/population/madrid_population.json and its meta,
     cross-checked against the committed canonical geography.
"""

import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "build_madrid_population.py"
SPEC = importlib.util.spec_from_file_location("build_madrid_population", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

POP_PATH = ROOT / "data" / "population" / "madrid_population.json"
META_PATH = ROOT / "data" / "population" / "madrid_population.meta.json"
GEO_PATH = ROOT / "data" / "geography" / "madrid_admin.geojson"

SAMPLE_CSV = (
    "fecha;cod_municipio;municipio;cod_distrito;distrito;cod_barrio;barrio;"
    "num_personas;num_personas_hombres;num_personas_mujeres\n"
    "1 de enero de 2026;28079;Madrid;1; Centro;11;Palacio;23.410;11.320;12.090\n"
    "1 de enero de 2026;28079;Madrid;1; Centro;12;Embajadores;48.085;25.546;22.539\n"
    "1 de enero de 2025;28079;Madrid;1; Centro;11;Palacio;23.000;11.100;11.900\n"
    "1 de enero de 2025;28079;Madrid;1; Centro;12;Embajadores;47.000;24.000;23.000\n"
)


class BuilderLogicTests(unittest.TestCase):
    def test_parse_int_handles_spanish_thousands_and_rejects_junk(self):
        self.assertEqual(MODULE.parse_int("23.410"), 23410)
        self.assertEqual(MODULE.parse_int("3.497.277"), 3497277)
        self.assertEqual(MODULE.parse_int(" 8.099 "), 8099)
        for bad in ("", "-5", "12,3", "N/A"):
            with self.assertRaises(ValueError):
                MODULE.parse_int(bad)

    def test_parse_year(self):
        self.assertEqual(MODULE.parse_year("1 de enero de 2026"), "2026")
        with self.assertRaises(ValueError):
            MODULE.parse_year("sin fecha")

    def test_parse_population_csv(self):
        rows = MODULE.parse_population_csv(SAMPLE_CSV)
        self.assertEqual(len(rows), 4)
        r = rows[0]
        self.assertEqual(r["year"], "2026")
        self.assertEqual(r["cod_distrito"], "1")
        self.assertEqual(r["cod_barrio"], "11")
        self.assertEqual(r["residents"], 23410)

    def test_parse_population_csv_rejects_missing_columns(self):
        with self.assertRaises(SystemExit):
            MODULE.parse_population_csv("fecha;cod_barrio;num_personas\n2026;11;10\n")

    def test_select_period_prefers_latest_complete(self):
        rows = MODULE.parse_population_csv(SAMPLE_CSV)
        # Two barrios per year; with a canonical universe of 2, both years are
        # complete and the latest wins.
        self.assertEqual(MODULE.select_period(rows, 2, None), "2026")
        # With a canonical universe of 3, neither year is complete -> fail.
        with self.assertRaises(SystemExit):
            MODULE.select_period(rows, 3, None)
        # An explicit period must exist.
        self.assertEqual(MODULE.select_period(rows, 2, "2025"), "2025")
        with self.assertRaises(SystemExit):
            MODULE.select_period(rows, 2, "1999")

    def test_normalise_codes_zero_pads(self):
        self.assertEqual(MODULE.normalise_codes({"cod_distrito": "1", "cod_barrio": "11"}), ("01", "011"))
        self.assertEqual(MODULE.normalise_codes({"cod_distrito": "21", "cod_barrio": "215"}), ("21", "215"))
        self.assertEqual(MODULE.normalise_codes({"cod_distrito": "2", "cod_barrio": "21"}), ("02", "021"))

    def test_reconcile_success(self):
        parent = {"011": "01", "012": "01"}
        rows = [
            {"cod_distrito": "1", "cod_barrio": "11", "barrio_name": "Palacio", "residents": 100},
            {"cod_distrito": "1", "cod_barrio": "12", "barrio_name": "Embajadores", "residents": 200},
        ]
        out = MODULE.reconcile(rows, parent)
        self.assertEqual([b["official_id"] for b in out], ["011", "012"])
        self.assertEqual(out[0], {"official_id": "011", "parent_id": "01", "residents": 100})

    def test_reconcile_rejects_unknown_barrio(self):
        with self.assertRaises(SystemExit):
            MODULE.reconcile([{"cod_distrito": "9", "cod_barrio": "99", "barrio_name": "X", "residents": 1}], {"011": "01"})

    def test_reconcile_rejects_parent_mismatch(self):
        with self.assertRaises(SystemExit):
            MODULE.reconcile([{"cod_distrito": "2", "cod_barrio": "11", "barrio_name": "X", "residents": 1}], {"011": "01"})

    def test_reconcile_rejects_missing_canonical_barrio(self):
        # Source has 011 but the canonical universe also needs 012.
        with self.assertRaises(SystemExit):
            MODULE.reconcile(
                [{"cod_distrito": "1", "cod_barrio": "11", "barrio_name": "Palacio", "residents": 1}],
                {"011": "01", "012": "01"},
            )

    def test_reconcile_rejects_duplicate(self):
        with self.assertRaises(SystemExit):
            MODULE.reconcile(
                [
                    {"cod_distrito": "1", "cod_barrio": "11", "barrio_name": "P", "residents": 1},
                    {"cod_distrito": "1", "cod_barrio": "11", "barrio_name": "P", "residents": 2},
                ],
                {"011": "01"},
            )

    def test_reconcile_rejects_negative(self):
        with self.assertRaises(SystemExit):
            MODULE.reconcile([{"cod_distrito": "1", "cod_barrio": "11", "barrio_name": "P", "residents": -1}], {"011": "01"})

    def test_derive_totals(self):
        barrios = [
            {"official_id": "011", "parent_id": "01", "residents": 100},
            {"official_id": "012", "parent_id": "01", "residents": 200},
            {"official_id": "021", "parent_id": "02", "residents": 50},
        ]
        districts, muni = MODULE.derive_totals(barrios)
        self.assertEqual(muni, 350)
        as_map = {d["official_id"]: d["residents"] for d in districts}
        self.assertEqual(as_map, {"01": 300, "02": 50})
        self.assertTrue(all(d["parent_id"] == MODULE.INE_MADRID_MUNICIPAL_CODE for d in districts))


class CommittedArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pop = json.loads(POP_PATH.read_text(encoding="utf-8"))
        cls.meta = json.loads(META_PATH.read_text(encoding="utf-8"))
        geo = json.loads(GEO_PATH.read_text(encoding="utf-8"))
        cls.canon = {
            f["properties"]["official_id"]: f["properties"]["parent_id"]
            for f in geo["features"]
            if f["properties"]["geography_level"] == "barrio"
        }
        recs = cls.pop["records"]
        cls.muni = [r for r in recs if r["geography_level"] == "municipality"]
        cls.dist = [r for r in recs if r["geography_level"] == "district"]
        cls.barr = [r for r in recs if r["geography_level"] == "barrio"]

    def test_counts(self):
        self.assertEqual(len(self.muni), 1)
        self.assertEqual(len(self.dist), 21)
        self.assertEqual(len(self.barr), 131)

    def test_period_is_source_reference_date_not_build_time(self):
        ref = self.pop["source_period"]["reference_date"]
        self.assertRegex(ref, r"^\d{4}-01-01$")
        self.assertRegex(self.meta["retrieved_at"], r"^\d{4}-\d{2}-\d{2}T")
        self.assertNotEqual(self.meta["retrieved_at"][:10], ref)

    def test_values_valid(self):
        for r in self.pop["records"]:
            self.assertIsInstance(r["residents"], int)
            self.assertGreaterEqual(r["residents"], 0)
        self.assertGreater(self.muni[0]["residents"], 0)

    def test_canonical_join_is_complete(self):
        pop_ids = {b["official_id"] for b in self.barr}
        self.assertEqual(pop_ids, set(self.canon), "every canonical barrio present, none extra")
        for b in self.barr:
            self.assertEqual(b["parent_id"], self.canon[b["official_id"]])

    def test_aggregation_is_exact(self):
        sums = {}
        for b in self.barr:
            sums[b["parent_id"]] = sums.get(b["parent_id"], 0) + b["residents"]
        for d in self.dist:
            self.assertEqual(d["residents"], sums[d["official_id"]])
            self.assertEqual(d["residents_provenance"], "DERIVED_FROM_BARRIO_POPULATION")
        self.assertEqual(self.muni[0]["residents"], sum(b["residents"] for b in self.barr))
        self.assertEqual(self.muni[0]["residents_provenance"], "DERIVED_FROM_BARRIO_POPULATION")
        for b in self.barr:
            self.assertEqual(b["residents_provenance"], "SOURCE_REPORTED")

    def test_geography_linkage_distinct_from_period(self):
        gl = self.meta["geography_linkage"]
        self.assertEqual(gl["barrio_geography_version"], "v3.4.1")
        self.assertEqual(gl["district_geography_version"], "v3.2.1")
        self.assertNotEqual(gl["barrio_geography_version"], self.pop["source_period"]["reference_date"])

    def test_interpretation_ceiling(self):
        ceiling = self.meta["interpretation_ceiling"]
        self.assertIn("Padron", self.meta["population_concept"])
        self.assertRegex(ceiling, r"NOT.*tourists")
        self.assertIn("never be spatially distributed into a circular Lens", ceiling)


if __name__ == "__main__":
    unittest.main()
