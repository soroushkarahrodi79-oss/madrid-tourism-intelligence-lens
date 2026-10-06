import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULT = ROOT / "research/callejero_gate/results/m4_universe.json"


class GateM4Universe(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = json.loads(RESULT.read_text(encoding="utf-8"))

    def test_granted_only_universe(self):
        self.assertEqual(self.report["resolucion"]["distinct_values"], ["Conceder"])
        self.assertEqual(self.report["resolucion"]["counts"], {"Conceder": 11498})

    def test_tipo_taxonomy_is_exhaustive_and_separated(self):
        tipo = self.report["tipo"]
        self.assertEqual(tipo["unclassified_rows"], 0)
        self.assertEqual(tipo["unclassified_values"], [])
        self.assertEqual(sum(tipo["counts"].values()), 11498)
        self.assertEqual(sum(tipo["family_counts"].values()), 11498)
        self.assertEqual(set(tipo["family_counts"]), {
            "ACTIVITY_LICENCE_FAMILY", "BUILDING_URBANISTIC_LICENCE_FAMILY",
            "TEMPORARY_ACTIVITY_FAMILY",
        })

    def test_protection_absence_states_are_distinct(self):
        protection = self.report["nivel_proteccion"]
        self.assertEqual(protection["absence_states_kept_distinct"],
                         ["EMPTY", "Sin Catalogar", "Sin protección"])
        for key in protection["absence_states_kept_distinct"]:
            self.assertIn(key, protection["counts"])
        self.assertNotEqual(protection["counts"]["EMPTY"], protection["counts"]["Sin Catalogar"])

    def test_norma_protection_intersection_reconciles(self):
        missing = self.report["norma_zonal_missingness"]
        self.assertEqual(missing["missing"], missing["both_missing"] + missing["only_norma_missing"])
        self.assertEqual(sum(missing[k] for k in (
            "both_missing", "only_protection_missing", "only_norma_missing", "neither_missing"
        )), 11498)

    def test_declarations_stay_separate(self):
        declarations = self.report["declaraciones_responsables"]
        self.assertEqual(declarations["dataset_id"], "133556-0-declaraciones-responsables")
        self.assertIn("never joined or summed", declarations["relationship"])


if __name__ == "__main__":
    unittest.main()
