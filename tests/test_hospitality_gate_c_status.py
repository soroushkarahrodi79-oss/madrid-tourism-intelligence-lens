"""Contract tests for the committed hospitality Gate C status-semantics report.

Network-free. These guard the *semantics* of
`research/hospitality_commercial_gate/results/gate_c_status.json`, not its counts:
the counts are observations of one audit run against live monthly snapshots and are
expected to move when the source publishes (or re-cuts) a month. What must not move
is how the report separates the three evidence levels, the scoped rulings, and the
traps it records.

The specific claims guarded here are the ones Gate D (and any later implementation)
must be able to rely on:

  * every observed situacion and tipo-acceso code is represented;
  * source semantics, empirical observation and project handling stay in SEPARATE
    fields and are never merged (a project label is not official source metadata);
  * `Abierto` is NOT represented as an "operating business" - its ruling is NO-GO as
    a current-operation proxy, with the maintenance caveat attached;
  * `Cerrado` is NOT represented as "business failure" - its ruling is bounded NO-GO;
  * `Baja` and `Baja R` remain represented in the record even though they are the
    source's explicit exclusions from a total-premises count;
  * the official exclusion union handles overlaps correctly and PC Asociado is not
    double-subtracted (an internal-consistency contract that holds for any run);
  * the blank-taxonomy (UNCLASSIFIED_SOURCE_ACTIVITY) records remain visible;
  * administrative status and activity classification remain SEPARATE dimensions;
  * no "pressure / vitality / saturation" terminology enters the structured labels;
  * the methodology-document ruling agrees with the machine-readable ruling.
"""

import json
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPORT = ROOT / "research" / "hospitality_commercial_gate" / "results" / "gate_c_status.json"
METHOD_DOC = ROOT / "docs" / "HOSPITALITY_COMMERCIAL_METHOD_GATE.md"

# Terms that must never appear as a project label / ruling verdict / class name. They
# may appear in PROSE that forbids them (an interpretation ceiling that says "NOT
# saturation"), so the scan runs over structured labels only, never the disclaimers.
FORBIDDEN_SUBSTRINGS = [
    "tourism pressure", "overtourism", "over-tourism", "saturation",
    "commercial vitality", "vitality", "hospitality pressure", "visitor pressure",
    "operating business", "business failure", "economic decline", "commercial success",
    "currently trading", "currently operating",
]


class GateCStatusReport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report = json.loads(REPORT.read_text(encoding="utf-8"))
        cls.universe = cls.report["status_universe"]
        cls.excl = cls.report["official_counting_exclusions"]
        cls.ruling = cls.report["gate_c_ruling"]
        cls.xtab = cls.report["status_x_taxonomy_state"]

    # -- C1 universe ------------------------------------------------------
    def test_every_observed_situacion_and_acceso_code_is_represented(self):
        sit = self.universe["situacion"]
        acc = self.universe["tipo_acceso"]
        self.assertTrue(sit, "situacion universe must not be empty")
        self.assertTrue(acc, "tipo_acceso universe must not be empty")
        # Every entry carries both an empirical observation and a code echo.
        for code, rec in {**sit, **acc}.items():
            self.assertEqual(rec["code"], code)
            self.assertIn("rows", rec["empirical_observation"])
            self.assertIn("distinct_id_local", rec["empirical_observation"])
        # The situacion rows must sum to the premises universe (internal consistency).
        total = self.universe["premises_rows_total"]
        self.assertEqual(sum(v["empirical_observation"]["rows"] for v in sit.values()),
                         total)
        self.assertEqual(sum(v["empirical_observation"]["rows"] for v in acc.values()),
                         total)

    def test_nominal_month_label_is_not_an_immutable_snapshot_identity(self):
        # The report must carry the provenance finding that the resource labelled
        # 'Septiembre 2026' was re-published, and must insist that identity is the
        # (label + SHA-256) pair - never the month label alone. This is a semantic
        # contract; the live counts it compares are NOT frozen as invariants.
        rev = self.report["nominal_snapshot_revision"]
        self.assertEqual(rev["warning"], "NOMINAL_SNAPSHOT_REVISION")
        self.assertIn("nominal_label", rev)
        self.assertIn("revised_since_gate_a_b", rev)
        # Both the earlier reference and the current run must be identified by SHA-256,
        # so a comparison can only be made fingerprint-to-fingerprint.
        self.assertIn("sha256", rev["gate_c_current"])
        self.assertTrue(rev["gate_c_current"]["sha256"])
        if rev["gate_a_b_reference"] is not None:
            self.assertIn("sha256", rev["gate_a_b_reference"])
            # If a revision is asserted, the two fingerprints must actually differ.
            if rev["revised_since_gate_a_b"]:
                self.assertNotEqual(rev["gate_c_current"]["sha256"],
                                    rev["gate_a_b_reference"]["sha256"])
        # The five statements must be present, including the label-is-not-identity rule.
        joined = " ".join(rev["statements"]).lower()
        self.assertIn("sha-256", joined)
        self.assertIn("month label alone", joined)
        self.assertIn("gate d", joined)
        # And it must NOT claim this invalidates Gate A/B.
        self.assertTrue(any("does not invalidate" in s.lower() for s in rev["statements"]))

    def test_undocumented_codes_are_flagged_not_renamed(self):
        # The live access code 3 (Interior) is undocumented; it must be surfaced as such,
        # never given an invented official meaning.
        acc = self.universe["tipo_acceso"]
        if "3" in acc:
            self.assertTrue(acc["3"]["undocumented_code"])
            self.assertIn("UNDOCUMENTED", acc["3"]["source_semantics"].upper())
        # Documented-but-absent codes (e.g. Obras) are reported, not invented.
        self.assertIn("documented_situacion_codes_not_observed", self.universe)

    # -- three evidence levels kept separate ------------------------------
    def test_source_semantics_and_project_handling_are_separate_fields(self):
        for code, rec in self.universe["situacion"].items():
            # The source-semantics field and the project interpretation-ceiling field
            # must both exist and must be different strings - never collapsed into one.
            self.assertIn("source_semantics", rec)
            self.assertIn("interpretation_ceiling", rec)
            self.assertIn("official_counting_instruction", rec)
            self.assertNotEqual(rec["source_semantics"], rec["interpretation_ceiling"])
        # The documentation block must assert the separation explicitly.
        self.assertIn("three_levels_kept_separate", self.report["documentation"])

    # -- C7 Abierto -------------------------------------------------------
    def test_abierto_is_not_an_operating_business(self):
        ab = self.report["abierto"]
        self.assertEqual(self.ruling["abierto_semantics"]["use_as_current_operation_proxy"],
                         "NO-GO")
        # The ruling text must not assert current operation; it must bound Abierto to an
        # administrative status.
        self.assertIn("administrative status", ab["ruling"].lower())
        self.assertIn("NO", ab["ruling"])
        # The maintenance caveat must travel with it.
        basis = self.ruling["abierto_semantics"]["basis"].lower()
        self.assertIn("mantenimiento complicado", basis)
        # Abierto must be shown to coexist with blank taxonomy (open != classified).
        self.assertGreater(ab["with_blank_taxonomy_only_or_partial"], 0)

    # -- C8 Cerrado -------------------------------------------------------
    def test_cerrado_is_not_business_failure(self):
        ce = self.report["cerrado"]
        self.assertEqual(
            self.ruling["cerrado_semantics"]["use_as_business_cessation_evidence"], "NO-GO")
        self.assertFalse(ce["closure_dates_published"])
        # It must NOT claim permanence; the field must stay UNRESOLVED/bounded.
        self.assertIn("UNRESOLVED", ce["temporary_or_permanent"])
        self.assertIn("NO", ce["ruling"])

    def test_cerrado_source_semantics_and_project_ceiling_stay_separate(self):
        # The exact official wording must be preserved as the source meaning, and the
        # project interpretation ceiling must be a SEPARATE field - the source wording is
        # never paraphrased away or merged with the project reading.
        ce = self.report["cerrado"]
        self.assertIn("source_semantics", ce)
        # The verbatim source meaning must be present (accent-insensitive on this snapshot's
        # ASCII-folded storage), not replaced by a project phrase.
        src = ce["source_semantics"].lower()
        self.assertIn("en ese momento no se realiza", src)
        self.assertIn("tipo de actividad", src)
        # The project ceiling is its own structured field, distinct from the source meaning.
        ceiling = ce["project_interpretation_ceiling"]
        self.assertIsInstance(ceiling, dict)
        self.assertNotEqual(ce["source_semantics"], ceiling.get("note", ""))
        not_as = {s.lower() for s in ceiling["not_treated_as"]}
        for forbidden in ("permanent cessation", "business failure", "economic decline"):
            self.assertIn(forbidden, not_as)
        self.assertTrue(any("verified current closure" in s for s in not_as))
        # The project ceiling must be labelled as project interpretation, not source.
        self.assertIn("project interpretation ceiling", ceiling["note"].lower())

    # -- C9 Baja / Baja R -------------------------------------------------
    def test_baja_and_baja_r_remain_represented_though_excluded(self):
        baja = self.report["baja_and_baja_r"]
        for key in ("baja", "baja_r"):
            self.assertIn(key, baja)
            self.assertTrue(baja[key]["explicitly_excluded_from_total_premises_count"])
            self.assertIn("count_premises", baja[key])
        # Treated separately AND the distinction is documented.
        self.assertIn("distinction_documented", baja)
        self.assertTrue(baja["distinction_documented"].startswith("YES"))
        # Exclusion from a count must not mean deletion from the record.
        self.assertIn("NOT be deleted", baja["role_in_source_counting"])
        self.assertEqual(self.ruling["baja_baja_r"]["use_as_explicit_source_exclusions"],
                         "GO")

    # -- C5 exclusion arithmetic -----------------------------------------
    def test_official_exclusion_union_handles_overlaps(self):
        e = self.excl
        each = e["excluded_by_each_rule"]
        naive = each["situacion_8_baja"] + each["situacion_9_baja_r"] + each["acceso_12_pc_asociado"]
        self.assertEqual(naive, e["sum_if_naively_added"])
        # The union must be <= the naive sum, and the gap is the avoided double count.
        self.assertLessEqual(e["union_excluded"], naive)
        self.assertEqual(e["double_subtraction_avoided"], naive - e["union_excluded"])
        # Remaining after exclusions is exactly raw - union (internal consistency).
        self.assertEqual(e["remaining_after_official_exclusions"],
                         e["raw_premises_universe"] - e["union_excluded"])
        # Only situacion 8/9 and acceso 12 are covered - not Cerrado/Uso vivienda/Obras.
        self.assertEqual(set(e["rule_scope"]["codes_covered"]["situacion"]), {"8", "9"})
        self.assertEqual(set(e["rule_scope"]["codes_covered"]["tipo_acceso"]), {"12"})

    def test_pc_asociado_is_not_double_subtracted(self):
        pc = self.report["access_type"]["pc_asociado"]
        ov = pc["overlap_with_status_exclusions"]
        # The avoided double-subtraction equals the PC-Asociado∩(Baja∪BajaR) overlap
        # plus the (zero) Baja∩Baja R overlap - this must reconcile with C5.
        overlaps = self.excl["overlaps"]
        reconciled = (overlaps["sit8_and_acceso12"] + overlaps["sit9_and_acceso12"]
                      + overlaps["sit8_and_sit9"] - overlaps["sit8_and_sit9_and_acceso12"])
        self.assertEqual(self.excl["double_subtraction_avoided"], reconciled)
        self.assertEqual(ov["pc_asociado_also_baja_8"], overlaps["sit8_and_acceso12"])
        self.assertEqual(ov["pc_asociado_also_baja_r_9"], overlaps["sit9_and_acceso12"])
        self.assertFalse(pc["is_physical_premises"])

    def test_exclusions_are_an_audit_not_a_denominator(self):
        self.assertIn("does NOT authorise a production denominator",
                      self.excl["audit_note"])
        self.assertIn("Gate F", self.excl["audit_note"])

    # -- C3 status vs taxonomy -------------------------------------------
    def test_blank_taxonomy_records_remain_visible(self):
        totals = self.xtab["taxonomy_state_totals"]
        # Some premises carry a blank-only taxonomy and they must be counted, not dropped.
        blank_states = [k for k in totals if "BLANK" in k]
        self.assertTrue(blank_states)
        self.assertGreater(sum(totals[k] for k in blank_states), 0)
        # The taxonomy-state totals must sum to the premises carrying a status.
        counted = sum(v["empirical_observation"]["rows"]
                      for v in self.universe["situacion"].values())
        self.assertEqual(sum(totals.values()) + self.xtab["premises_with_no_actividades_row"],
                         counted)

    def test_status_and_activity_are_separate_dimensions(self):
        ans = self.xtab["answers"]
        # Status must NOT determine taxonomy state.
        self.assertFalse(ans["administrative_status_determines_taxonomy_state"]["answer"])
        self.assertIn("SEPARATE", ans["administrative_status_determines_taxonomy_state"][
            "conclusion"].upper())
        # The concrete coexistences the gate must demonstrate.
        self.assertTrue(ans["abierto_can_coexist_with_blank_taxonomy"]["answer"])
        self.assertTrue(ans["cerrado_can_retain_populated_activity_codes"]["answer"])
        self.assertTrue(ans["baja_can_retain_populated_activity_codes"]["answer"])

    # -- C4 status by class does not double-count -------------------------
    def test_status_by_class_counts_premises_once_per_class(self):
        by_class = self.report["status_by_gate_b_class"]
        for cls, rec in by_class.items():
            if cls.startswith("_"):
                continue
            total = rec["distinct_premises"]
            # Each per-class situacion distribution sums to that class's distinct premises
            # (a premises is counted once within a class), confirming no double-count.
            s = sum(v["premises"] for v in rec["situacion_distribution"].values())
            self.assertEqual(s, total, cls)
        self.assertIn("do NOT sum across classes", by_class["_note"])

    # -- terminology ------------------------------------------------------
    def test_no_pressure_or_vitality_terminology_in_structured_labels(self):
        labels = set()
        labels.update(self.report["candidate_counting_states"].keys())
        labels.update(self.report["status_by_gate_b_class"].keys())
        labels.update(self.xtab["taxonomy_state_totals"].keys())
        for sub in self.ruling.values():
            for v in sub.values():
                if v in ("GO", "NO-GO", "MODIFY", True, False):
                    labels.add(str(v))
        blob = " ".join(l.lower() for l in labels if isinstance(l, str))
        for bad in FORBIDDEN_SUBSTRINGS:
            self.assertNotIn(bad, blob, bad)

    # -- C14 ruling shape -------------------------------------------------
    def test_ruling_is_scoped_not_a_blanket_go(self):
        for key in ("abierto_semantics", "cerrado_semantics", "baja_baja_r",
                    "pc_asociado", "source_excluded_premises_universe",
                    "economic_interpretation", "overall_gate_c"):
            self.assertIn(key, self.ruling)
        self.assertEqual(self.ruling["economic_interpretation"]["ruling"], "NO-GO")
        self.assertEqual(self.ruling["source_excluded_premises_universe"][
            "use_as_reproducible_administrative_filtering_rule"], "GO")
        self.assertTrue(self.ruling["overall_gate_c"]["mixed_subrulings_are_expected"])

    def test_interpretation_ceiling_forbids_economic_claims(self):
        ceiling = self.report["interpretation_ceiling"]["this_evidence_can_never_claim_on_its_own"]
        blob = " ".join(ceiling).lower()
        self.assertIn("trading", blob)
        self.assertIn("failure", blob)

    # -- methodology doc agrees with the machine-readable ruling ----------
    def test_methodology_ruling_agrees_with_machine_output(self):
        text = METHOD_DOC.read_text(encoding="utf-8")
        self.assertIn("Gate C", text)
        # The scoped verdicts in the prose ruling table must match the JSON.
        # Abierto -> NO-GO as current-operation proxy.
        self.assertRegex(text, r"Abierto.{0,120}NO-?GO")
        # Economic interpretation remains NO-GO.
        self.assertRegex(text, r"[Ee]conomic.{0,120}NO-?GO")
        # Source-excluded filtering is GO.
        self.assertRegex(text, r"[Ss]ource-excluded.{0,160}GO")
        # Overall GO to Gate D.
        self.assertRegex(text, r"[Oo]verall.{0,120}GO to Gate D")


if __name__ == "__main__":
    unittest.main()
