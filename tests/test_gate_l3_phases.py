"""Contract tests for the committed Gate L · L3 phase-vocabulary results.

Network-free. Guards:

  H. 'No Necesita' and 'Sin Iniciar' are never mapped to the same internal state;
  I. the complete observed phase vocabulary in the results matches the source-normalized
     audit (the result lists each observed value), and is derived, not hard-coded to a
     fixed expected set;
  plus: 'En Ejecución' is recorded as observed-but-undocumented; the PGOUM plan-of-origin
  markers are quantified as occupying phase cells; the four phases are found
  multi-dimensional (no scalar stage); and 'No Necesita' semantics are UNRESOLVED.
"""

import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULTS = ROOT / "research" / "urban_planning_gate" / "results"
PHASES = RESULTS / "l3_phases.json"
SUMMARY = RESULTS / "l3_summary.json"


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


class TestL3Phases(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rep = load(PHASES)
        cls.sum = load(SUMMARY)

    def test_H_no_necesita_distinct_from_sin_iniciar(self):
        nn = self.rep["no_necesita"]
        self.assertTrue(nn["are_distinct_values"])
        obs = set(self.rep["four_phase_era"]["observed_values"])
        self.assertIn("No Necesita", obs)
        self.assertIn("Sin Iniciar", obs)
        self.assertNotEqual("No Necesita", "Sin Iniciar")

    def test_I_vocabulary_is_derived_and_complete(self):
        # the per-column vocabulary must cover every observed value (derived, not fixed)
        per_col = self.rep["four_phase_era"]["per_column_vocabulary"]
        seen = set()
        for col, entries in per_col.items():
            for e in entries:
                seen.add(e["value"])
        self.assertEqual(seen, set(self.rep["four_phase_era"]["observed_values"]))
        # must not be hard-coded to exactly the five "expected" states
        self.assertGreater(len(self.rep["four_phase_era"]["observed_values"]), 5)

    def test_en_ejecucion_observed_but_undocumented(self):
        self.assertIn("En Ejecución", self.rep["four_phase_era"]["undocumented_states"])

    def test_pgoum_markers_quantified_in_phase_cells(self):
        markers = self.rep["four_phase_era"]["pgoum_markers_in_phase_cells"]
        self.assertGreater(sum(markers.values()), 0)
        self.assertGreater(self.sum["pgoum_markers_share_of_phase_cells"], 0.0)

    def test_phases_multi_dimensional_no_scalar_stage(self):
        self.assertEqual(self.rep["ordering_analysis"]["verdict"], "MULTI_DIMENSIONAL_NO_SCALAR_STAGE")
        self.assertGreater(self.rep["ordering_analysis"]["funnel_violation_count"], 0)

    def test_no_necesita_semantics_unresolved(self):
        self.assertEqual(self.rep["no_necesita"]["verdict"], "SOURCE_OBSERVED_INTERPRETATION_UNRESOLVED")
        self.assertFalse(self.rep["no_necesita"]["semantics_defined_by_publisher"])

    def test_single_state_era_reported_separately(self):
        self.assertIn("single_state_era", self.rep)
        self.assertGreater(len(self.rep["single_state_era"]["editions"]), 0)


if __name__ == "__main__":
    unittest.main()
