import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULT = ROOT / "research/callejero_gate/results/m2_ndp.json"


class GateM2Ndp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = json.loads(RESULT.read_text(encoding="utf-8"))

    def test_exact_authoritative_fields_and_representation(self):
        field = self.report["authoritative_field"]
        self.assertEqual(field["licence_field"], "NDP")
        self.assertEqual(field["callejero_field"], "COD_NDP")
        self.assertEqual(field["null_count_licence"], 0)
        self.assertEqual(field["observed_lengths_current"], {"8": 214301})

    def test_current_uniqueness_is_measured_not_assumed(self):
        current = self.report["current"]
        self.assertEqual(current["rows"] - current["distinct_nonempty_ndps"],
                         current["duplicate_rows"] - current["duplicate_ndps"])
        self.assertGreater(current["duplicate_ndps"], 0)
        self.assertEqual(self.report["licence"]["distinct_ndps_affected_by_current_duplicates"], 0)

    def test_historical_version_risk_and_identity_policy(self):
        historical = self.report["historical"]
        self.assertGreater(historical["ndps_with_multiple_versions"], 0)
        self.assertGreater(historical["ndps_mapping_to_multiple_address_signatures"], 0)
        self.assertTrue(historical["has_dated_validity"])
        self.assertIn("FECHA_DE_ALTA", self.report["required_identity_key"])
        self.assertIn("resource_sha256", self.report["required_identity_key"])


if __name__ == "__main__":
    unittest.main()
