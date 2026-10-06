"""Contract tests for the committed Gate L · L4 buildability results.

Network-free. Guards:

  * the buildability unit is m²;
  * 'remanente' is resolved to available buildability under the plan (not "remaining to
    be built");
  * the published 'Nº Viviendas' column equals Edif. Residencial / 100 and is a mechanical
    proxy, so the no-dwelling-count ceiling is BINDING;
  * a naive cross-edition / cross-era buildability delta is barred.
"""

import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULTS = ROOT / "research" / "urban_planning_gate" / "results"
BUILD = RESULTS / "l4_buildability.json"
SUMMARY = RESULTS / "l4_summary.json"


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


class TestL4Buildability(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rep = load(BUILD)
        cls.sum = load(SUMMARY)

    def test_unit_is_m2(self):
        self.assertEqual(self.sum["buildability_unit"], "m2")
        m2_fields = [f for f in self.rep["fields"] if f["unit"] == "m2"]
        self.assertGreaterEqual(len(m2_fields), 4)

    def test_remanente_meaning(self):
        self.assertEqual(self.rep["remanente_meaning"]["verdict"], "AVAILABLE_BUILDABILITY_M2_UNDER_PLAN")
        self.assertIn("remaining to be physically built", self.rep["remanente_meaning"]["NOT_supported"])

    def test_n_viviendas_is_mechanical_proxy(self):
        f = self.rep["n_viviendas_finding"]
        self.assertEqual(f["colectiva_ratio_test"]["match_rate"], 1.0)
        self.assertEqual(f["unifamiliar_ratio_test"]["match_rate"], 1.0)
        self.assertGreater(f["colectiva_ratio_test"]["fractional_values"], 0)

    def test_no_dwelling_ceiling_binding(self):
        self.assertEqual(self.rep["no_dwelling_ceiling"]["verdict"], "BINDING")
        self.assertFalse(self.rep["no_dwelling_ceiling"]["has_protected_housing_count_column"])
        self.assertIn("publishing Nº Viviendas as a dwelling count",
                      self.rep["no_dwelling_ceiling"]["prohibited"])

    def test_cross_era_delta_barred(self):
        self.assertIn("BARRED", self.sum["cross_era_buildability_delta"])


if __name__ == "__main__":
    unittest.main()
