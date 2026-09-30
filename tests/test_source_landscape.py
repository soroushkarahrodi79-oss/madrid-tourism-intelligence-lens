#!/usr/bin/env python3
"""Gate C0 research-artifact contract tests.

These guard the two things a Gate C0 artifact can get wrong silently: an
invalid or self-contradictory machine-readable file, and a credential
committed into a probe target. They deliberately do NOT test the probe's
network behaviour - the probe runs on demand against live sources and nothing
in the application depends on it.
"""

from __future__ import annotations

import importlib.util
import io
import json
import pathlib
import re
import unittest

REPO = pathlib.Path(__file__).resolve().parent.parent
LANDSCAPE_DIR = REPO / "research" / "source_landscape"
TARGETS_PATH = LANDSCAPE_DIR / "probe_targets.json"
CATALOG_PATH = LANDSCAPE_DIR / "source_catalog.json"
REPORT_PATH = LANDSCAPE_DIR / "probe_report.json"
LANDSCAPE_DOC = REPO / "docs" / "MADRID_TOURISM_INTELLIGENCE_SOURCE_LANDSCAPE.md"

# The probe lives outside any package, so it is loaded by path rather than
# imported. Loading it runs no network code: everything at module scope is
# constants and function definitions.
_spec = importlib.util.spec_from_file_location(
    "gate_c0_probe_sources", LANDSCAPE_DIR / "probe_sources.py"
)
probe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(probe)

# Mirrors probe_sources.CREDENTIAL_HINTS. Duplicated on purpose: the test must
# fail if someone relaxes the probe's own guard.
CREDENTIAL_PATTERN = re.compile(
    r"(?:^|[?&])(api[_-]?key|apikey|key|token|access[_-]?token|secret|password|passwd|auth)=",
    re.IGNORECASE,
)


class ProbeTargetsContract(unittest.TestCase):
    def setUp(self) -> None:
        self.doc = json.loads(TARGETS_PATH.read_text(encoding="utf-8"))
        self.targets = self.doc["targets"]

    def test_file_is_valid_json_with_targets(self) -> None:
        self.assertIsInstance(self.targets, list)
        self.assertGreater(len(self.targets), 0)

    def test_target_ids_are_unique(self) -> None:
        ids = [t["id"] for t in self.targets]
        self.assertEqual(len(ids), len(set(ids)), "duplicate probe target id")

    def test_every_target_has_required_fields(self) -> None:
        required = ("id", "family", "dataset", "url", "kind", "probe_question")
        for target in self.targets:
            for field in required:
                self.assertIn(field, target, f"{target.get('id')} missing {field}")
                self.assertTrue(str(target[field]).strip(), f"{target.get('id')} empty {field}")

    def test_every_target_declares_whether_its_url_form_is_proven(self) -> None:
        # Gate C0's core discipline: an unverified URL must be labelled as a
        # hypothesis, never presented as an established source contract.
        for target in self.targets:
            self.assertIn("proven_url_form", target, f"{target['id']} missing proven_url_form")
            self.assertIsInstance(target["proven_url_form"], bool)

    def test_a_proven_url_form_must_cite_its_evidence(self) -> None:
        # Correction from PR #31 review: a portal being reachable does not make
        # one of its API actions proven, and a proven action on one path does
        # not make a different path on the same host proven. True therefore
        # requires a citation; anything uncited stays a hypothesis.
        for target in self.targets:
            if target["proven_url_form"]:
                self.assertTrue(
                    str(target.get("proven_by", "")).strip(),
                    f"{target['id']} claims proven_url_form without proven_by evidence",
                )
            else:
                self.assertNotIn(
                    "proven_by", target,
                    f"{target['id']} is unproven but carries proven_by",
                )

    def test_package_search_is_not_claimed_as_proven(self) -> None:
        # package_search is exercised by no production builder and by no
        # completed live audit in this repository, on either portal.
        for target in self.targets:
            if "package_search" in target["url"]:
                self.assertFalse(
                    target["proven_url_form"],
                    f"{target['id']} claims package_search is a proven URL form",
                )

    def test_no_probe_target_carries_a_credential(self) -> None:
        for target in self.targets:
            self.assertIsNone(
                CREDENTIAL_PATTERN.search(target["url"]),
                f"{target['id']} URL appears to carry a credential parameter",
            )
            self.assertNotIn("@", target["url"].split("//", 1)[-1].split("/", 1)[0],
                             f"{target['id']} URL carries userinfo credentials")

    def test_targets_use_https_only(self) -> None:
        for target in self.targets:
            self.assertTrue(target["url"].startswith("https://"), f"{target['id']} is not HTTPS")


class BoundedRead(unittest.TestCase):
    """The cap applies to what is KEPT; truncation must be positively detected.

    Reading exactly `max_bytes` conflates a truncated resource with a complete
    one whose length equals the cap. `_bounded_read` reads one byte past the cap
    and discards it, so the exact-cap case is reported complete.
    """

    def _read(self, payload: bytes, cap: int):
        return probe._bounded_read(io.BytesIO(payload), cap)

    def test_payload_smaller_than_cap_is_not_truncated(self) -> None:
        body, truncated = self._read(b"x" * 64, 128)
        self.assertFalse(truncated)
        self.assertEqual(body, b"x" * 64)

    def test_payload_exactly_equal_to_cap_is_not_truncated(self) -> None:
        body, truncated = self._read(b"x" * 128, 128)
        self.assertFalse(truncated, "a complete resource of exactly cap length is not truncated")
        self.assertEqual(len(body), 128)

    def test_payload_larger_than_cap_is_truncated(self) -> None:
        body, truncated = self._read(b"x" * 129, 128)
        self.assertTrue(truncated)
        self.assertEqual(len(body), 128, "the read-ahead byte is discarded, never kept")

    def test_read_ahead_byte_is_never_retained_even_far_over_cap(self) -> None:
        body, truncated = self._read(b"x" * 100_000, 128)
        self.assertTrue(truncated)
        self.assertEqual(len(body), 128)

    def test_empty_payload_is_not_truncated(self) -> None:
        body, truncated = self._read(b"", 128)
        self.assertFalse(truncated)
        self.assertEqual(body, b"")


class ContentRangeTotal(unittest.TestCase):
    """A Range-honouring server stops early, so the read-ahead byte would never
    arrive even from a huge resource. Its stated total is the stronger evidence."""

    def test_total_is_parsed(self) -> None:
        self.assertEqual(probe._parse_content_range_total("bytes 0-1023/4096"), 4096)

    def test_absent_or_unsatisfiable_total_is_none(self) -> None:
        self.assertIsNone(probe._parse_content_range_total(None))
        self.assertIsNone(probe._parse_content_range_total("bytes */4096"))
        self.assertIsNone(probe._parse_content_range_total("nonsense"))


class ProbeHarnessHygiene(unittest.TestCase):
    def test_probe_script_never_writes_into_the_application_data_directory(self) -> None:
        source = (LANDSCAPE_DIR / "probe_sources.py").read_text(encoding="utf-8")
        self.assertNotIn('"data/', source)
        self.assertNotIn("'data/", source)

    def test_probe_script_bounds_every_read(self) -> None:
        source = (LANDSCAPE_DIR / "probe_sources.py").read_text(encoding="utf-8")
        self.assertIn("DEFAULT_MAX_BYTES", source)
        self.assertIn("_bounded_read(response, max_bytes)", source)

    def test_probe_script_does_not_infer_truncation_from_length_alone(self) -> None:
        # The regression this guards: `len(body) >= max_bytes` silently reports a
        # complete resource of exactly cap length as truncated.
        source = (LANDSCAPE_DIR / "probe_sources.py").read_text(encoding="utf-8")
        self.assertNotIn("len(body) >= max_bytes", source)


if __name__ == "__main__":
    unittest.main()


class CatalogContract(unittest.TestCase):
    """Gate C0 catalogue semantics. These guard the rules the gate itself sets:
    one recommendation per candidate, no recommendation without the evidence
    that recommendation asserts, and no invented precision."""

    RECOMMENDATIONS = {"USE", "WATCH", "REJECT"}
    EFFORTS = {"LOW", "LOW_MEDIUM", "MEDIUM", "MEDIUM_HIGH", "HIGH"}

    def setUp(self) -> None:
        self.doc = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        self.sources = self.doc["sources"]

    def test_catalog_is_valid_json_with_sources(self) -> None:
        self.assertIsInstance(self.sources, list)
        self.assertGreater(len(self.sources), 0)

    def test_source_ids_are_unique(self) -> None:
        ids = [s["id"] for s in self.sources]
        self.assertEqual(len(ids), len(set(ids)), "duplicate catalogue source id")

    def test_every_source_has_exactly_one_valid_recommendation(self) -> None:
        for source in self.sources:
            self.assertIn(source["recommendation"], self.RECOMMENDATIONS,
                          f"{source['id']} has an invalid recommendation")

    def test_implementation_effort_uses_the_declared_enum(self) -> None:
        for source in self.sources:
            self.assertIn(source["implementation_effort"], self.EFFORTS,
                          f"{source['id']} has an invalid implementation_effort")

    def test_declared_enums_match_what_the_records_use(self) -> None:
        # The catalogue publishes its own enums; they must not drift from use.
        self.assertEqual(set(self.doc["enums"]["recommendation"]), self.RECOMMENDATIONS)
        self.assertEqual(set(self.doc["enums"]["implementation_effort"]), self.EFFORTS)

    def test_every_use_candidate_carries_the_evidence_use_asserts(self) -> None:
        # USE asserts a clear decision question, usable geography and
        # understandable period semantics. A USE without one of those is the
        # failure mode Gates A and B exist to prevent.
        for source in self.sources:
            if source["recommendation"] != "USE":
                continue
            for field in ("candidate_question", "geography", "temporal_semantics",
                          "access_method", "evidence_class", "placement",
                          "interpretation_ceiling"):
                self.assertTrue(str(source.get(field, "")).strip(),
                                f"USE candidate {source['id']} is missing {field}")

    def test_every_use_candidate_has_a_real_decision_question(self) -> None:
        # Not "this dataset contains trees". The gate's decision-question test
        # requires a use and a decision.
        for source in self.sources:
            if source["recommendation"] != "USE":
                continue
            question = source["candidate_question"].lower()
            self.assertIn("in order to decide", question,
                          f"USE candidate {source['id']} has no decision clause")

    def test_every_watch_candidate_has_a_blocker_and_an_unblock_condition(self) -> None:
        for source in self.sources:
            if source["recommendation"] != "WATCH":
                continue
            self.assertTrue(str(source.get("blocker", "")).strip(),
                            f"WATCH candidate {source['id']} has no blocker")
            self.assertTrue(str(source.get("unblock_condition", "")).strip(),
                            f"WATCH candidate {source['id']} has no unblock_condition")

    def test_every_reject_candidate_has_a_reason(self) -> None:
        for source in self.sources:
            if source["recommendation"] != "REJECT":
                continue
            self.assertTrue(str(source.get("reject_reason", "")).strip(),
                            f"REJECT candidate {source['id']} has no reject_reason")

    def test_no_catalog_url_carries_a_credential(self) -> None:
        for source in self.sources:
            url = source.get("url") or ""
            self.assertIsNone(CREDENTIAL_PATTERN.search(url),
                              f"{source['id']} URL appears to carry a credential")

    def test_no_weighted_score_is_published(self) -> None:
        # The gate forbids a single composite source-quality score.
        raw = CATALOG_PATH.read_text(encoding="utf-8").lower()
        for banned in ('"score"', '"weight"', '"weighted_score"', '"rank"', '"total_score"'):
            self.assertNotIn(banned, raw, f"catalogue publishes a {banned} field")

    def test_every_record_states_how_it_was_verified(self) -> None:
        # Provenance must be machine-readable, not only prose, so a later reader
        # cannot mistake external verification for a successful in-environment probe.
        for source in self.sources:
            self.assertEqual(source.get("verification_method"),
                             "external_official_documentation",
                             f"{source['id']} does not state its verification method")
            self.assertTrue(str(source.get("verified_at", "")).strip(),
                            f"{source['id']} has no verified_at")


class EvidenceProvenanceIsPreserved(unittest.TestCase):
    """The blocked probe and the external verification are two separate facts.
    Neither may be rewritten into the other."""

    def test_probe_report_still_records_the_blocked_run(self) -> None:
        report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
        self.assertEqual(report["targets_ok"], 0,
                         "probe_report.json must keep recording that no probe succeeded")
        self.assertGreater(report["targets_probed"], 0)
        for result in report["results"]:
            self.assertFalse(result.get("ok"), "a blocked probe was rewritten as successful")

    def test_catalog_records_the_probe_as_blocked_not_successful(self) -> None:
        doc = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        probe_block = doc["evidence_provenance"]["claude_environment_probe"]
        self.assertEqual(probe_block["status"], "BLOCKED_BY_EGRESS_POLICY")
        verification = doc["evidence_provenance"]["official_source_verification"]
        self.assertEqual(verification["status"], "COMPLETED_EXTERNALLY")

    def test_landscape_report_keeps_both_facts(self) -> None:
        text = LANDSCAPE_DOC.read_text(encoding="utf-8")
        self.assertIn("0 of 14", text, "the report must state the blocked probe result")
        self.assertIn("independently", text.lower(),
                      "the report must state that verification was done independently")


class LandscapeReportContract(unittest.TestCase):
    def test_report_exists_and_records_the_audit_date(self) -> None:
        text = LANDSCAPE_DOC.read_text(encoding="utf-8")
        self.assertIn("30 September 2026", text)

    def test_report_names_every_catalogued_candidate_ruling(self) -> None:
        text = LANDSCAPE_DOC.read_text(encoding="utf-8")
        for token in ("USE", "WATCH", "REJECT"):
            self.assertIn(token, text)

    def test_shortlist_is_bounded(self) -> None:
        # The gate asks for roughly 5-10 recommended modules, not 50 datasets.
        catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        use_count = sum(1 for s in catalog["sources"] if s["recommendation"] == "USE")
        self.assertGreaterEqual(use_count, 5)
        self.assertLessEqual(use_count, 10, "the USE shortlist has grown beyond the gate's bound")
