"""Gate M path guard: this issue is research-only."""

import os
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
BRANCH = "research/callejero-ndp-gate-m"
FORBIDDEN_PREFIXES = ("data/", "scripts/", "js/", "css/", "browser-tests/", "assets/")
FORBIDDEN_FILES = ("package.json", "package-lock.json", "index.html")
ALLOWED_PREFIXES = (
    "research/callejero_gate/", "tests/test_callejero_gate_",
    "docs/CALLEJERO_NDP_CROSSWALK_GATE_M.md",
    "docs/MADRID_TOURISM_INTELLIGENCE_SOURCE_LANDSCAPE.md",
)


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)


def changed_paths():
    branch = os.environ.get("GITHUB_HEAD_REF", "").strip() or git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    if branch != BRANCH and os.environ.get("GATE_M_GUARD") != "1":
        return None
    base = next((r for r in ("origin/main", "main") if git("rev-parse", "--verify", r).returncode == 0), None)
    if base is None:
        return None
    merge_base = git("merge-base", base, "HEAD").stdout.strip() or base
    tracked = git("diff", "--name-only", merge_base, "HEAD").stdout.splitlines()
    untracked = git("ls-files", "--others", "--exclude-standard").stdout.splitlines()
    return sorted({p.strip() for p in tracked + untracked if p.strip()})


class GateMGuards(unittest.TestCase):
    def setUp(self):
        self.changed = changed_paths()

    def test_no_production_paths_or_dependencies(self):
        if self.changed is None:
            self.skipTest("Gate M branch/base ref unavailable")
        offenders = [p for p in self.changed if p.startswith(FORBIDDEN_PREFIXES) or p in FORBIDDEN_FILES]
        self.assertEqual(offenders, [])

    def test_every_change_is_in_the_gate_surface(self):
        if self.changed is None:
            self.skipTest("Gate M branch/base ref unavailable")
        offenders = [p for p in self.changed if not p.startswith(ALLOWED_PREFIXES)]
        self.assertEqual(offenders, [])

    def test_no_raw_download_is_tracked(self):
        tracked = git("ls-files", "research/callejero_gate").stdout.splitlines()
        raw_suffixes = {".csv", ".xlsx", ".pdf", ".zip", ".shp", ".dbf"}
        self.assertEqual([p for p in tracked if pathlib.Path(p).suffix.lower() in raw_suffixes], [])


if __name__ == "__main__":
    unittest.main()
