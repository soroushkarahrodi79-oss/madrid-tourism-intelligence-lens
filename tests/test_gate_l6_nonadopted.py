"""Contract tests for the committed Gate L · L6 non-adopted-source results.

Network-free. Guards that each non-adopted source carries its measured reason:

  * MCPG_Madrid_Crece: the EDIF_AMBITO denormalisation is demonstrated numerically and
    the verdict is NOT_YET;
  * the tiny / single-directorate / southeast-only services are recorded with their
    feature counts and non-adoption verdicts;
  * the viewer portals 403 to automated clients (recorded, not bypassed);
  * the housing-unit figures are PRESENTATION_SURFACE_NOT_A_REPRODUCIBLE_RETRIEVAL_ROUTE.
"""

import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULTS = ROOT / "research" / "urban_planning_gate" / "results"
REP = RESULTS / "l6_nonadopted.json"
SUMMARY = RESULTS / "l6_summary.json"


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


class TestL6NonAdopted(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rep = load(REP)
        cls.sum = load(SUMMARY)

    def test_mcpg_denormalisation_demonstrated(self):
        mcpg = self.rep["MCPG_Madrid_Crece"]
        self.assertEqual(mcpg["verdict"], "NOT_YET")
        demo = mcpg["edif_ambito_denormalisation_demo"]
        self.assertIsNotNone(demo)
        self.assertEqual(demo["distinct_edif_ambito_values"], 1)
        # naive sum = per-ambito total * parcel rows (inflation)
        self.assertAlmostEqual(demo["naive_sum_m2"],
                               demo["edif_ambito_m2"] * demo["parcel_rows"], places=0)
        self.assertGreater(demo["parcel_rows"], 1)

    def test_small_universe_services_recorded(self):
        self.assertEqual(self.rep["FASES_RECEPCION_URBANIZACION"]["verdict"], "NOT_A_USABLE_UNIVERSE")
        self.assertEqual(self.rep["OBRA_PUBLICA"]["verdict"], "NOT_A_CITY_WIDE_UNIVERSE")
        self.assertEqual(self.rep["ETAPAS_DESARROLLOS_DEL_SURESTE"]["verdict"], "DEFER")
        self.assertEqual(self.rep["PLAN_18000"]["verdict"], "NOT_ADOPTED")

    def test_portals_403_recorded_not_bypassed(self):
        for probe in self.rep["viewer_portals"]["probes"]:
            self.assertEqual(probe["plain"], 403)
            self.assertEqual(probe["browser_ua"], 403)
        self.assertEqual(self.rep["viewer_portals"]["verdict"], "NOT_A_RETRIEVAL_ROUTE")

    def test_housing_figures_not_publishable(self):
        self.assertEqual(self.rep["housing_unit_figures"]["verdict"],
                         "PRESENTATION_SURFACE_NOT_A_REPRODUCIBLE_RETRIEVAL_ROUTE")


if __name__ == "__main__":
    unittest.main()
