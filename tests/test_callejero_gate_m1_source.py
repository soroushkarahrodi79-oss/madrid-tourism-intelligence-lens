import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULT = ROOT / "research/callejero_gate/results/m1_source.json"
DOC = ROOT / "docs/CALLEJERO_NDP_CROSSWALK_GATE_M.md"


class GateM1Source(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = json.loads(RESULT.read_text(encoding="utf-8"))
        cls.doc = DOC.read_text(encoding="utf-8")

    def test_pinned_source_identities_and_counts(self):
        lic = self.report["licence_register"]
        self.assertEqual(lic["dataset_id"], "640505-0-licencias-urbanisticas-otorgadas")
        self.assertEqual(lic["resource_id"], "640505-1-licencias-urbanisticas-otorgadas")
        self.assertEqual(lic["row_count"], 11498)
        cal = self.report["authoritative_callejero"]
        current = cal["current_coordinates_and_admin_codes"]
        historical = cal["historical_identity_coordinates_and_validity"]
        self.assertEqual(current["resource_id"], "213605-4-callejero-oficial-madrid-csv")
        self.assertEqual(historical["resource_id"], "213605-1-callejero-oficial-madrid-csv")
        self.assertEqual(current["row_count"], 214697)
        self.assertEqual(historical["row_count"], 379297)

    def test_fingerprints_and_freshness_are_complete(self):
        records = [self.report["licence_register"]]
        cal = self.report["authoritative_callejero"]
        records += [cal["current_coordinates_and_admin_codes"], cal["historical_identity_coordinates_and_validity"]]
        for record in records:
            self.assertEqual(len(record["observed_resource_state"]["sha256"]), 64)
            self.assertIsNone(record["published_at"])
            self.assertTrue(record["retrieved_at"].endswith("Z"))
            self.assertIn(record["update_frequency"], {"MONTHLY", "WEEKLY"})
            self.assertEqual(record["source_state"], "NOT_DECLARED_BY_PUBLISHER")
            self.assertIn(record["observed_resource_state"]["sha256"], self.doc)

    def test_schema_is_the_observed_schema(self):
        lic = self.report["licence_register"]
        fields = {item["name"]: item["non_empty"] for item in lic["schema"]}
        self.assertEqual(fields["NDP"], lic["row_count"])
        self.assertEqual(fields["FECHA_FIRMA_RESOLUCION"], lic["row_count"])
        self.assertEqual(len(fields), 21)


if __name__ == "__main__":
    unittest.main()
