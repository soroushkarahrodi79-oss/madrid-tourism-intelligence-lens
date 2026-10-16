"""K12 runtime-decision-spike quality gates (issue #74 §10).

These guards enforce that the spike is a throwaway measurement study and never
leaks into production:

  * no production file references the spike harnesses;
  * the production package.json gains no dependency;
  * the change set touches only docs/, research/runtime_spike/ and tests/;
  * docs/RUNTIME_DECISION_SPIKE.md carries a verdict per technology and every
    "NOT YET" names a numeric trigger;
  * the committed JSON evidence exists, parses, and matches the measurements
    the document reports.

Run by CI via:  python -m unittest discover -s tests -p "test_*.py"
"""
import json
import os
import re
import subprocess
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SPIKE = os.path.join(ROOT, "research", "runtime_spike")
RESULTS = os.path.join(SPIKE, "results")
DOC = os.path.join(ROOT, "docs", "RUNTIME_DECISION_SPIKE.md")

PRODUCTION_PREFIXES = ("js/", "css/", "assets/", "data/")
PRODUCTION_FILES = ("index.html", "package.json", "package-lock.json")
ALLOWED_PREFIXES = ("docs/", "research/runtime_spike/", "tests/")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


class NoProductionReference(unittest.TestCase):
    """Nothing under research/runtime_spike/ may be referenced from production."""

    def test_html_css_js_do_not_reference_the_spike(self):
        offenders = []
        targets = [os.path.join(ROOT, "index.html")]
        for sub in ("js", "css"):
            d = os.path.join(ROOT, sub)
            for dirpath, _dirs, files in os.walk(d):
                for fn in files:
                    targets.append(os.path.join(dirpath, fn))
        for path in targets:
            try:
                text = read(path)
            except (UnicodeDecodeError, OSError):
                continue
            if "runtime_spike" in text or "research/runtime_spike" in text:
                offenders.append(os.path.relpath(path, ROOT))
        self.assertEqual(offenders, [], f"production files reference the spike: {offenders}")


class ProductionPackageUnchanged(unittest.TestCase):
    """The production package.json must add no dependency for the spike."""

    def test_no_dependencies_block_and_only_playwright_dev(self):
        pkg = json.loads(read(os.path.join(ROOT, "package.json")))
        self.assertNotIn(
            "dependencies", pkg, "production package.json gained a runtime dependency"
        )
        dev = pkg.get("devDependencies", {})
        self.assertEqual(
            set(dev.keys()),
            {"playwright"},
            f"production devDependencies changed (expected only playwright): {sorted(dev)}",
        )

    def test_spike_package_is_separate_and_isolated(self):
        spike_pkg_path = os.path.join(SPIKE, "package.json")
        self.assertTrue(os.path.exists(spike_pkg_path), "spike package.json missing")
        spike_pkg = json.loads(read(spike_pkg_path))
        self.assertTrue(spike_pkg.get("private"), "spike package must be private")
        # its deps are the harness tools, deliberately NOT in production
        self.assertIn("@duckdb/duckdb-wasm", spike_pkg.get("devDependencies", {}))
        gi = read(os.path.join(SPIKE, ".gitignore"))
        self.assertIn("node_modules", gi, "spike node_modules must be gitignored")


class ChangeSetPathGuard(unittest.TestCase):
    """git diff vs the base must touch only docs/, research/runtime_spike/, tests/."""

    def _base_ref(self):
        for ref in ("origin/main", "main"):
            r = subprocess.run(
                ["git", "rev-parse", "--verify", ref], cwd=ROOT, capture_output=True, text=True
            )
            if r.returncode == 0:
                return ref
        return None

    def test_only_allowed_paths_changed(self):
        base = self._base_ref()
        if base is None:
            self.skipTest("no base ref (origin/main|main) available to diff against")
        mb = subprocess.run(
            ["git", "merge-base", base, "HEAD"], cwd=ROOT, capture_output=True, text=True
        )
        if mb.returncode != 0:
            self.skipTest("could not compute merge-base")
        diff = subprocess.run(
            ["git", "diff", "--name-only", mb.stdout.strip(), "HEAD"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        changed = [p for p in diff.stdout.splitlines() if p.strip()]
        offenders = []
        for p in changed:
            if p in PRODUCTION_FILES or p.startswith(PRODUCTION_PREFIXES):
                offenders.append(p)
            elif not p.startswith(ALLOWED_PREFIXES):
                offenders.append(p)
        self.assertEqual(offenders, [], f"change set touches disallowed paths: {offenders}")


class DocumentVerdicts(unittest.TestCase):
    """The decision document must carry a verdict per technology and numeric NOT-YET triggers."""

    REQUIRED = ["MapLibre", "PMTiles", "DuckDB-WASM", "GeoParquet"]
    VERDICTS = ["GO", "NOT YET", "NO-GO"]

    def setUp(self):
        self.assertTrue(os.path.exists(DOC), "RUNTIME_DECISION_SPIKE.md missing")
        self.text = read(DOC)

    def test_each_technology_named(self):
        for tech in self.REQUIRED:
            self.assertIn(tech, self.text, f"document does not mention {tech}")

    def test_all_three_verdict_tokens_present(self):
        for v in self.VERDICTS:
            self.assertIn(v, self.text, f"verdict token {v!r} absent")

    def _section8(self):
        # the §8 verdict table lives between the "## 8" and "## 9" headings
        m = re.search(r"\n##\s*8\.[^\n]*\n(.*?)\n##\s*9\.", self.text, re.DOTALL)
        self.assertIsNotNone(m, "§8 verdict section not found")
        return m.group(1)

    def test_verdict_table_rows_and_notyet_triggers(self):
        section = self._section8()
        rows = [
            ln
            for ln in section.splitlines()
            if ln.strip().startswith("|") and re.search(r"\*\*[A-D]\*\*", ln)
        ]
        self.assertGreaterEqual(len(rows), 5, f"expected >=5 verdict rows in §8, found {len(rows)}")
        notyet_rows = [r for r in rows if "NOT YET" in r]
        self.assertGreaterEqual(len(notyet_rows), 2, "expected MapLibre and PMTiles NOT YET rows")
        for r in notyet_rows:
            cells = [c.strip() for c in r.strip().strip("|").split("|")]
            # columns: tech | verdict | evidence | trigger | uncertainty
            self.assertGreaterEqual(len(cells), 4, f"malformed verdict row: {r}")
            trigger = cells[3]
            self.assertRegex(
                trigger,
                r"\d",
                f"NOT YET row has no numeric trigger: {cells[0]} -> trigger cell {trigger!r}",
            )


class EvidencePreserved(unittest.TestCase):
    """Committed JSON evidence exists, parses, and backs the document's headline figures."""

    def _load(self, name):
        path = os.path.join(RESULTS, name)
        self.assertTrue(os.path.exists(path), f"missing evidence: results/{name}")
        return json.loads(read(path))

    def test_core_result_files_present_and_valid(self):
        for name in (
            "baseline_inventory.json",
            "partitioning.json",
            "duckdb_wasm.json",
            "leaflet_cpu_scaling.json",
            "geoparquet.json",
            "pmtiles.json",
        ):
            self._load(name)

    def test_duckdb_outputs_were_verified_identical(self):
        d = self._load("duckdb_wasm.json")
        # the spike must have checked correctness before comparing speed
        self.assertEqual(d.get("status"), "MEASURED_IN_CONTAINER")
        corr = d["correctness"]
        self.assertTrue(corr["inCircle"]["identical"], "in-circle outputs not identical")
        self.assertTrue(corr["dateWindow"]["identical"], "date-window outputs not identical")

    def test_partitioning_saving_matches_document_claim(self):
        p = self._load("partitioning.json")
        saved = p["initial_load_savings_B_vs_A"]["transfer_gzip9"]["saved_pct"]
        # document headline: ~87% initial-load transfer reduction
        self.assertGreater(saved, 80, f"partitioning saving {saved}% below documented ~87%")

    def test_baseline_counts_match_measured_reality(self):
        inv = self._load("baseline_inventory.json")
        by_file = {a["file"]: a for a in inv["artifacts"]}
        ambito = by_file["planning/madrid_ambitos.geojson"]["geometry"]
        self.assertEqual(ambito["features"], 724)
        lic = by_file["planning/madrid_urban_licences.json"]["records"]
        self.assertEqual(lic, 11265)


if __name__ == "__main__":
    unittest.main()
