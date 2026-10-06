"""Gate L discipline guards (issue #65 invariants L, M, N, O).

A research gate must touch no production surface. This test compares the current
branch against `origin/main` (local git, no network) and asserts that NOTHING this
gate changed falls under a production path:

  L. no file added/changed under `data/`;
  M. no file added/changed under `scripts/`;
  N. `package.json` / `package-lock.json` unchanged;
  O. no UI / CSS / index / app-JS production change.

If `origin/main` is not available locally (e.g. a shallow CI checkout without the
base ref), the diff-based checks are skipped and only the static invariant — that the
gate's own artifacts live solely under research/, docs/ and tests/ — is asserted.
"""

import os
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

FORBIDDEN_PREFIXES = ("data/", "scripts/", "css/", "js/", "browser-tests/", "assets/")
FORBIDDEN_FILES = ("package.json", "package-lock.json", "index.html")
ALLOWED_PREFIXES = ("research/urban_planning_gate/", "tests/test_gate_l",
                    "docs/URBAN_PLANNING_SOURCE_GATE_L.md",
                    "docs/MADRID_TOURISM_INTELLIGENCE_SOURCE_LANDSCAPE.md",
                    ".gitignore")


def _git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)


def _base_ref():
    for ref in ("origin/main", "main"):
        if _git("rev-parse", "--verify", ref).returncode == 0:
            return ref
    return None


# These invariants describe the Gate L change ITSELF. Once it is merged, every later
# feature branch also differs from origin/main, so applying them to an arbitrary
# branch would forbid all production work (K4 was the first to hit this). They are
# therefore enforced on the Gate L research branch (or when GATE_L_GUARD=1 forces
# them) and skipped everywhere else; the diff base and invariants are unchanged.
GATE_L_BRANCH = "research/urban-planning-source-gate-l"


def _current_branch():
    head_ref = os.environ.get("GITHUB_HEAD_REF", "").strip()
    if head_ref:
        return head_ref
    return _git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()


def _guard_applies():
    return os.environ.get("GATE_L_GUARD") == "1" or _current_branch() == GATE_L_BRANCH


def _changed_paths():
    if not _guard_applies():
        return None
    base = _base_ref()
    if base is None:
        return None
    mb = _git("merge-base", base, "HEAD")
    base_point = mb.stdout.strip() if mb.returncode == 0 and mb.stdout.strip() else base
    tracked = _git("diff", "--name-only", base_point, "HEAD").stdout.splitlines()
    untracked = _git("ls-files", "--others", "--exclude-standard").stdout.splitlines()
    return sorted({p.strip() for p in tracked + untracked if p.strip()})


class TestGateLGuards(unittest.TestCase):
    def setUp(self):
        self.changed = _changed_paths()

    def test_L_no_production_data_added(self):
        if self.changed is None:
            self.skipTest("Gate L guard applies to the Gate L branch only, or origin/main is unavailable")
        offenders = [p for p in self.changed if p.startswith("data/")]
        self.assertEqual(offenders, [], f"Gate L must add nothing under data/: {offenders}")

    def test_M_no_production_scripts_added(self):
        if self.changed is None:
            self.skipTest("Gate L guard applies to the Gate L branch only, or origin/main is unavailable")
        offenders = [p for p in self.changed if p.startswith("scripts/")]
        self.assertEqual(offenders, [], f"Gate L must add nothing under scripts/: {offenders}")

    def test_N_package_json_unchanged(self):
        if self.changed is None:
            self.skipTest("Gate L guard applies to the Gate L branch only, or origin/main is unavailable")
        offenders = [p for p in self.changed if p in ("package.json", "package-lock.json")]
        self.assertEqual(offenders, [], f"Gate L must not change package manifests: {offenders}")

    def test_O_no_ui_change(self):
        if self.changed is None:
            self.skipTest("Gate L guard applies to the Gate L branch only, or origin/main is unavailable")
        offenders = [p for p in self.changed
                     if p.startswith(("css/", "js/", "browser-tests/", "assets/")) or p == "index.html"]
        self.assertEqual(offenders, [], f"Gate L must not change UI/CSS/index/app-JS: {offenders}")

    def test_all_changes_within_allowed_surface(self):
        if self.changed is None:
            self.skipTest("Gate L guard applies to the Gate L branch only, or origin/main is unavailable")
        offenders = [p for p in self.changed if not p.startswith(ALLOWED_PREFIXES)]
        self.assertEqual(offenders, [],
                         f"Gate L changed a path outside its allowed surface: {offenders}")

    def test_no_raw_third_party_files_committed(self):
        # the cache (raw .xls/.pdf/geojson) must be git-ignored, never tracked
        tracked = _git("ls-files", "research/urban_planning_gate/cache").stdout.splitlines()
        self.assertEqual([t for t in tracked if t.strip()], [],
                         "raw third-party files under cache/ must never be committed")


if __name__ == "__main__":
    unittest.main()
