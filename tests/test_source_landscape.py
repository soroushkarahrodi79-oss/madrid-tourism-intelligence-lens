#!/usr/bin/env python3
"""Gate C0 research-artifact contract tests.

These guard the two things a Gate C0 artifact can get wrong silently: an
invalid or self-contradictory machine-readable file, and a credential
committed into a probe target. They deliberately do NOT test the probe's
network behaviour - the probe runs on demand against live sources and nothing
in the application depends on it.
"""

from __future__ import annotations

import json
import pathlib
import re
import unittest

REPO = pathlib.Path(__file__).resolve().parent.parent
LANDSCAPE_DIR = REPO / "research" / "source_landscape"
TARGETS_PATH = LANDSCAPE_DIR / "probe_targets.json"

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


class ProbeHarnessHygiene(unittest.TestCase):
    def test_probe_script_never_writes_into_the_application_data_directory(self) -> None:
        source = (LANDSCAPE_DIR / "probe_sources.py").read_text(encoding="utf-8")
        self.assertNotIn('"data/', source)
        self.assertNotIn("'data/", source)

    def test_probe_script_bounds_every_read(self) -> None:
        source = (LANDSCAPE_DIR / "probe_sources.py").read_text(encoding="utf-8")
        self.assertIn("DEFAULT_MAX_BYTES", source)
        self.assertIn("response.read(max_bytes)", source)


if __name__ == "__main__":
    unittest.main()
