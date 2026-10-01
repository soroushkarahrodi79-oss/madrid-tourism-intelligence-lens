"""Contract tests for the committed hospitality Gate D temporal-comparability reports.

Network-free. These guard the *semantics* of the Gate D artifacts in
`research/hospitality_commercial_gate/results/`, not their counts: the counts are
observations of one audit run against live, re-publishable monthly snapshots and are
expected to move. What must not move is how Gate D models snapshot identity, how it
separates format drift from semantic drift, how it tiers temporal comparisons, how it
bounds every earliest-defensible window with evidence, and that it never licenses a
business-event, trend or economic reading.

Specifically guarded (the claims any later gate / implementation must rely on):

  * a nominal month label alone is NOT a snapshot identity - identity carries a content
    fingerprint and the resource id is explicitly insufficient;
  * each nominal month maps to exactly one resource (no silent overwrite), and the
    duplicate-period representation is explicit;
  * missing months are an explicit list, never numeric zero;
  * format drift and semantic drift are separate, enumerated categories;
  * schema eras are ordered, contiguous and non-overlapping per family;
  * every earliest-defensible window carries an evidence AND a caveat field;
  * status transitions cannot be labelled business openings/closures;
  * Gate B classes are NOT projected backward as a blanket GO (taxonomy ruling is
    MODIFY, with the unclassified-representation break recorded);
  * revision-aware provenance fields are mandatory on every sentinel;
  * no trend / economic-pressure language appears in the structured verdict labels;
  * no raw CSV is committed or referenced as a local artifact;
  * the methodology-document ruling agrees with the machine-readable ruling.
"""

import json
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESULTS = ROOT / "research" / "hospitality_commercial_gate" / "results"
SUMMARY = RESULTS / "gate_d_temporal_summary.json"
MANIFEST = RESULTS / "gate_d_resource_manifest.json"
ERAS = RESULTS / "gate_d_schema_eras.json"
COMPAT = RESULTS / "gate_d_temporal_compatibility.json"
METHOD_DOC = ROOT / "docs" / "HOSPITALITY_COMMERCIAL_METHOD_GATE.md"

MONTHS = {
    "Enero": 1, "Febrero": 2, "Marzo": 3, "Abril": 4, "Mayo": 5, "Junio": 6,
    "Julio": 7, "Agosto": 8, "Septiembre": 9, "Octubre": 10, "Noviembre": 11,
    "Diciembre": 12,
}

# Terms that must never appear as a structured verdict label / tier key / class name.
# They may appear in PROSE that forbids them (the interpretation ceiling lists what the
# series may NEVER claim), so the scan runs over structured verdict labels only.
FORBIDDEN_SUBSTRINGS = [
    "tourism pressure", "overtourism", "over-tourism", "saturation", "vitality",
    "visitor pressure", "operating business", "business failure", "economic decline",
    "commercial success", "currently trading", "currently operating", "growth indicator",
]


def pkey(label):
    mon, yr = label.split()
    return (int(yr), MONTHS[mon])


class GateDTemporalReports(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.summary = json.loads(SUMMARY.read_text(encoding="utf-8"))
        cls.manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        cls.eras = json.loads(ERAS.read_text(encoding="utf-8"))
        cls.compat = json.loads(COMPAT.read_text(encoding="utf-8"))
        cls.ruling = cls.summary["gate_d_ruling"]

    # -- all four artifacts present and non-trivial -----------------------
    def test_all_artifacts_present(self):
        for p in (SUMMARY, MANIFEST, ERAS, COMPAT):
            self.assertTrue(p.exists(), p)
        self.assertGreater(len(self.manifest["resources"]), 0)

    # -- D2 snapshot identity: a month label is not identity --------------
    def test_nominal_month_label_is_not_snapshot_identity(self):
        m = self.summary["d3_snapshot_identity_model"]
        self.assertIn("content_fingerprint", m)
        self.assertIn("resource_id_is_insufficient", m)
        # The rule must compose family + nominal period + a fingerprint, not a label alone.
        self.assertRegex(m["rule"].lower(), r"nominal_period.*fingerprint")
        self.assertIn("not", m["resource_id_is_insufficient"].lower())

    def test_version_identity_carries_a_fingerprint_on_every_sentinel(self):
        # Revision-aware provenance is mandatory: every downloaded sentinel must carry a
        # SHA-256, the resource id, a retrieval timestamp and the catalogue-declared MD5.
        sentinels = self.compat["sentinels"]
        seen = 0
        for fam in sentinels.values():
            for period, rec in fam.items():
                seen += 1
                for field in ("sha256", "resource_id", "retrieved_at",
                              "catalogue_declared_md5", "schema_signature"):
                    self.assertIn(field, rec, f"{period}:{field}")
                self.assertTrue(rec["sha256"])
        self.assertGreater(seen, 0)

    def test_reproducibility_protocol_requires_revision_aware_fields(self):
        proto = self.summary["d11_revision_risk_and_capture_protocol"]["capture_protocol"]
        persist = " ".join(proto["when_a_monthly_resource_is_used_analytically_persist"]).lower()
        for field in ("sha256", "resource_id", "retrieval_timestamp", "nominal_reference_period",
                      "observed_schema_signature"):
            self.assertIn(field, persist)

    # -- D3 continuity: no silent overwrite, missing != zero --------------
    def test_each_nominal_month_maps_to_one_resource_no_silent_overwrite(self):
        cont = self.summary["d2_continuity"]
        for fam in ("Locales", "Actividades"):
            fc = cont[fam]
            dups = fc["duplicate_nominal_periods"]
            self.assertIsInstance(dups, dict)
            # If any duplicate exists it must be surfaced with a count > 1, never hidden.
            for period, n in dups.items():
                self.assertGreater(n, 1, period)
            # Internal consistency for ANY run: total resources == distinct present periods
            # plus the extra copies of any duplicated period. A collapse would be a silent
            # overwrite; this equation forbids it without freezing a live count.
            extra = sum(n - 1 for n in dups.values())
            self.assertEqual(fc["resources"], fc["present_periods"] + extra, fam)

    def test_missing_months_are_explicit_never_zero(self):
        cont = self.summary["d2_continuity"]
        for fam in ("Locales", "Actividades"):
            fc = cont[fam]
            missing = fc["missing_months"]
            self.assertIsInstance(missing, list)
            self.assertEqual(fc["missing_count"], len(missing))
            # Every entry is a "<Month> <Year>" label - a period, not a numeric zero.
            for label in missing:
                self.assertIsInstance(label, str)
                mon, yr = label.split()
                self.assertIn(mon, MONTHS)
                self.assertTrue(yr.isdigit())

    def test_resource_resolution_is_deterministic(self):
        # Zero descriptions may fail the deterministic month parser.
        self.assertEqual(self.summary["d1_inventory"]["unparsed_descriptions"], [])

    # -- D4/D5 schema eras ordered, contiguous, non-overlapping -----------
    def test_schema_eras_are_ordered_and_non_overlapping(self):
        for fam, runs in self.eras["schema_eras"].items():
            self.assertGreater(len(runs), 1, f"{fam} should have multiple eras")
            prev_end = None
            for run in runs:
                start, end = pkey(run["start"]), pkey(run["end"])
                self.assertLessEqual(start, end, f"{fam} era start<=end")
                if prev_end is not None:
                    # strictly after the previous era's end: no overlap, ordered
                    self.assertGreater(start, prev_end, f"{fam} eras must not overlap")
                prev_end = end

    # -- D6 format drift vs semantic drift are separate categories --------
    def test_format_and_semantic_drift_are_separate_categories(self):
        d6 = self.summary["d6_drift_classification"]
        legend = set(d6["legend"])
        self.assertIn("cosmetic_format_only", legend)
        self.assertIn("confirmed_semantic_break", legend)
        classes = {c["class"] for c in d6["changes"]}
        self.assertTrue(classes <= legend, "every change class must be in the legend")
        # Both categories must actually be exercised - they are not collapsed into one.
        self.assertIn("cosmetic_format_only", classes)
        self.assertTrue(classes & {"confirmed_semantic_break", "potentially_semantic"})
        for c in d6["changes"]:
            self.assertTrue(c["evidence"].strip(), c["change"])

    # -- D10 earliest windows all carry evidence + caveat -----------------
    def test_every_earliest_window_carries_evidence_and_caveat(self):
        windows = self.summary["d14_earliest_defensible_windows"]
        dims = [k for k in windows if not k.startswith("_")]
        self.assertGreaterEqual(len(dims), 6)
        for dim in dims:
            w = windows[dim]
            for field in ("earliest_defensible_nominal_month", "comparison_mode",
                          "evidence", "caveat"):
                self.assertIn(field, w, f"{dim}:{field}")
                self.assertTrue(str(w[field]).strip(), f"{dim}:{field} empty")

    def test_windows_are_not_one_universal_start_date(self):
        # Different dimensions legitimately have different windows; identity reaches back
        # further than the code-based filtering rule. This is a structural expectation.
        w = self.summary["d14_earliest_defensible_windows"]
        self.assertIn("premises_identity_id_local", w)
        self.assertIn("source_excluded_premises_filtering", w)

    # -- D11 monthly transition != business event -------------------------
    def test_status_transitions_are_not_business_events(self):
        tr = self.summary["d15_monthly_transition_ruling"]
        self.assertEqual(tr["ruling"][:5], "NO-GO")
        self.assertIn("!=", tr["rule"])
        forbidden = {s.lower() for s in tr["forbidden_language"]}
        for term in ("opening", "closure", "business failure", "reopening"):
            self.assertIn(term, forbidden)
        self.assertEqual(
            self.ruling["month_to_month_status_transition_as_business_events"]["ruling"],
            "NO-GO")

    # -- D8 Gate B classes not projected backward as a blanket GO ---------
    def test_taxonomy_backward_projection_is_not_a_blanket_go(self):
        # The class MAP projects back, but the ruling must be MODIFY (not GO) because the
        # unclassified representation is era-specific and accommodation coverage changed.
        self.assertEqual(self.ruling["activity_taxonomy_longitudinal"]["ruling"], "MODIFY")
        basis = self.ruling["activity_taxonomy_longitudinal"]["basis"].lower()
        self.assertTrue(("normalis" in basis) or ("segment" in basis))
        # The era-specific unclassified-set break must be recorded as a drift finding.
        changes = " ".join(c["change"].lower() + " " + c["class"]
                           for c in self.summary["d6_drift_classification"]["changes"])
        self.assertIn("unclassified", changes)

    # -- interpretation ceiling forbids economic/event claims -------------
    def test_interpretation_ceiling_forbids_trend_and_economic_claims(self):
        ceiling = self.summary["d16_interpretation_ceiling"]
        never = " ".join(ceiling["a_future_series_may_never_claim"]).lower()
        for term in ("trading", "openings", "demand", "saturation"):
            self.assertIn(term, never)

    # -- terminology: no trend/economic language in structured labels -----
    def test_no_pressure_or_trend_terminology_in_structured_verdicts(self):
        labels = set()
        for sub in self.ruling.values():
            for v in sub.values():
                if isinstance(v, str) and v in ("GO", "NO-GO", "MODIFY", "MODIFY pending Gate E"):
                    labels.add(v)
        labels.update(self.summary["d13_temporal_tiers"].keys())
        labels.update(self.summary["d14_earliest_defensible_windows"].keys())
        blob = " ".join(l.lower() for l in labels)
        for bad in FORBIDDEN_SUBSTRINGS:
            self.assertNotIn(bad, blob, bad)

    # -- no raw CSV committed or referenced as a local artifact -----------
    def test_no_raw_csv_committed(self):
        # The results directory must hold only compact JSON, never a raw monthly CSV.
        for p in RESULTS.glob("*.csv"):
            self.fail(f"raw CSV committed: {p}")
        # Manifest resource URLs point at the remote source, not a local committed file.
        for r in self.manifest["resources"]:
            self.assertTrue(r["url"].startswith("http"), r["url"])
        proto = self.summary["d11_revision_risk_and_capture_protocol"]["capture_protocol"]
        self.assertIn("no_raw_csv_committed", proto)

    # -- D14 ruling shape: scoped, mixed, overall GO to Gate E ------------
    def test_ruling_is_scoped_not_a_blanket_go(self):
        for key in ("resource_continuity", "snapshot_version_identity", "schema_continuity",
                    "premises_identity_longitudinal", "activity_taxonomy_longitudinal",
                    "status_composition_longitudinal",
                    "month_to_month_status_transition_as_business_events",
                    "barrio_grouping_over_time", "overall_gate_d"):
            self.assertIn(key, self.ruling)
        self.assertEqual(self.ruling["overall_gate_d"]["ruling"], "GO to Gate E")
        self.assertTrue(self.ruling["overall_gate_d"]["mixed_subrulings_are_expected"])
        # The mix must actually be mixed (GO, MODIFY and NO-GO all present).
        verdicts = {sub.get("ruling") for sub in self.ruling.values()}
        self.assertTrue({"GO"} & verdicts)
        self.assertTrue({"MODIFY", "MODIFY pending Gate E"} & verdicts)
        self.assertIn("NO-GO", verdicts)

    def test_premises_identity_go_but_counts_not_a_trend(self):
        r = self.ruling["premises_identity_longitudinal"]
        self.assertEqual(r["ruling"], "GO")
        # Identity GO must not be read as count comparability - the caveat must travel.
        self.assertIn("count", r["basis"].lower())

    # -- resource continuity is MODIFY, not an unconditional GO -----------
    def test_resource_continuity_is_modify_not_unconditional_go(self):
        # Incomplete monthly coverage (2014 quarterly + missing months) cannot be labelled
        # an unconditional GO continuity.
        r = self.ruling["resource_continuity"]
        self.assertEqual(r["ruling"], "MODIFY")
        basis = r["basis"].lower()
        self.assertIn("missing", basis)
        self.assertTrue(("quarterly" in basis) or ("uninterrupted" in basis))
        # Missing periods must never be imputed as zero.
        self.assertIn("zero", basis)

    # -- universe expansion is not assigned an unsupported cause ----------
    def test_universe_expansion_cause_is_not_asserted(self):
        blob = json.dumps(self.summary, ensure_ascii=False).lower()
        # The unsupported causal phrasing must be gone everywhere in the report.
        self.assertNotIn("coverage expansion", blob)
        self.assertNotIn("coverage/definition", blob)
        # The additive-universe drift finding must say the cause is unresolved and must
        # bound the discontinuity to the sentinel interval, not invent a precise month.
        changes = self.summary["d6_drift_classification"]["changes"]
        univ = [c for c in changes if "universe" in c["change"].lower()]
        self.assertTrue(univ, "an administrative-universe-expansion drift finding must exist")
        text = (univ[0]["change"] + " " + univ[0]["evidence"]).lower()
        self.assertIn("unresolved", text)
        self.assertIn("within", text)

    # -- accommodation discontinuity is not labelled VUT-driven -----------
    def test_accommodation_discontinuity_not_labelled_vut_without_evidence(self):
        w = self.summary["d14_earliest_defensible_windows"]["accommodation_div55"]
        ev = w["evidence"].lower()
        # Without machine-readable epigraph-level (551005) evidence in the artifacts, the
        # jump must be left causally unresolved, never attributed.
        self.assertIn("unresolved", ev)
        self.assertNotIn("tourist-dwelling cataloguing", ev)
        self.assertNotIn("(vut)", ev)
        # If the artifacts genuinely carried per-epigraph 551005 counts, attribution would
        # be allowed; they do not, so the compatibility report must have no per-epigraph map.
        act = self.compat["sentinels"]["Actividades"]
        for rec in act.values():
            tax = rec["report"]["taxonomy_vocabulary"]
            self.assertNotIn("per_epigraph", tax)
            self.assertNotIn("epigraph_counts", tax)

    # -- methodology doc agrees with the machine-readable ruling ----------
    def test_methodology_ruling_agrees_with_machine_output(self):
        text = METHOD_DOC.read_text(encoding="utf-8")
        self.assertIn("Gate D", text)
        self.assertRegex(text, r"[Rr]esource continuity.{0,40}MODIFY")
        self.assertRegex(text, r"[Ss]napshot version identity.{0,80}GO")
        self.assertRegex(text, r"[Pp]remises identity longitudinally.{0,120}GO")
        self.assertRegex(text, r"status transition.{0,160}NO-?GO")
        self.assertRegex(text, r"[Oo]verall Gate D.{0,80}GO to Gate E")


if __name__ == "__main__":
    unittest.main()
