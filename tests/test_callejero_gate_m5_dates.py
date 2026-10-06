import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULT = ROOT / "research/callejero_gate/results/m5_dates.json"
MODULE_PATH = ROOT / "research/callejero_gate/audit_common.py"
SPEC = importlib.util.spec_from_file_location("gate_m_audit_common", MODULE_PATH)
COMMON = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMMON)


class GateM5Dates(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = json.loads(RESULT.read_text(encoding="utf-8"))

    def test_every_committed_observed_date_round_trips(self):
        for field, audit in self.report["fields"].items():
            observed_count = 0
            for source_value, expected in audit["observed_values"].items():
                parsed, weekday_ok = COMMON.parse_spanish_date(source_value)
                self.assertTrue(weekday_ok, (field, source_value))
                self.assertEqual(parsed.isoformat(), expected["iso_date"])
                self.assertEqual(str(parsed.year), expected["publisher_year"])
                self.assertEqual(parsed.month, COMMON.MONTHS[expected["publisher_month"].lower()])
                self.assertEqual(str(parsed.day), expected["publisher_day"])
                observed_count += expected["count"]
            self.assertEqual(observed_count, audit["non_empty"])
            self.assertEqual(audit["parsed"], audit["non_empty"])

    def test_all_validation_anomaly_lists_are_empty(self):
        for audit in self.report["fields"].values():
            self.assertEqual(audit["parse_failure_rows"], [])
            self.assertEqual(audit["weekday_failure_rows"], [])
            self.assertEqual(audit["publisher_component_failure_rows"], [])
            self.assertEqual(audit["rows"], audit["non_empty"] + audit["missing"])

    def test_signature_date_is_the_licence_date_without_fallback(self):
        rule = self.report["licence_date_rule"]
        self.assertEqual(rule["field"], "FECHA_FIRMA_RESOLUCION")
        self.assertIn("never substitute FECHA_ALTA", rule["missing_signature_handling"])


if __name__ == "__main__":
    unittest.main()
