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
