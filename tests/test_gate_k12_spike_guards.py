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
        s = p["initial_load_savings"]
        b2 = s["B2_dynamics_equivalent"]["transfer_gzip9"]["saved_pct"]  # general figure
        b1 = s["B1_latest_only_NOT_dynamics_equivalent"]["transfer_gzip9"]["saved_pct"]
        self.assertGreater(b2, 65, f"B2 (Dynamics-equivalent) saving {b2}% unexpectedly low")
        self.assertGreater(b1, 85, f"B1 (latest-only) saving {b1}% unexpectedly low")

    def test_baseline_counts_match_measured_reality(self):
        inv = self._load("baseline_inventory.json")
        by_file = {a["file"]: a for a in inv["artifacts"]}
        ambito = by_file["planning/madrid_ambitos.geojson"]["geometry"]
        self.assertEqual(ambito["features"], 724)
        lic = by_file["planning/madrid_urban_licences.json"]["records"]
        self.assertEqual(lic, 11265)


DH = os.path.join(SPIKE, "device_harness")
PROTO = os.path.join(SPIKE, "maplibre_proto")


def read_result(name):
    return json.loads(read(os.path.join(RESULTS, name)))


class ReviewBenchmarkFidelity(unittest.TestCase):
    """#1 — renderer-only vs full-Lens recompute is instrumented and distinguished."""

    def test_harness_has_both_recompute_modes_and_imports_production_models(self):
        lb = read(os.path.join(DH, "leaflet_baseline.html"))
        self.assertIn("recompute", lb)
        self.assertIn("/js/urban-licences.js", lb)
        self.assertIn("/js/planning-ambito.js", lb)
        self.assertIn("ambitosIntersecting", lb)  # the real analytical recompute path

    def test_rum_records_recompute_separately_and_renames_tti(self):
        rum = read(os.path.join(DH, "rum.js"))
        self.assertIn("interaction_recompute_ms", rum)
        self.assertIn("map_ready_ms", rum)
        self.assertNotIn("time_to_interactive_map_ms", rum)  # loaded TTI term removed
        self.assertIn("double-rAF proxy", rum)


class ReviewRunnerReliability(unittest.TestCase):
    """#2 — failures/incompleteness are blockers; device-grade is not SwiftShader-absence."""

    def test_runner_has_completeness_gate_and_strict_device_grade(self):
        r = read(os.path.join(DH, "run_device.mjs"))
        self.assertIn("process.exit(exitCode)", r)
        self.assertIn("require-device", r)
        self.assertIn("scenarioComplete", r)
        # fail-closed device-grade logic lives in the unit-tested grade module
        g = read(os.path.join(DH, "grade.mjs"))
        self.assertIn("has_human_label", g)
        self.assertIn("SOFTWARE_OR_GENERIC", g)
        self.assertIn("GPU_VENDOR", g)

    def test_container_smoke_is_not_certified_and_reports_completeness(self):
        # the committed container smoke must be honest: not device-grade, with a basis
        s = read_result("container_smoke_smoke.json")
        self.assertFalse(s["is_device_grade"], "container run must not be device-grade")
        self.assertIn("completeness", s)
        self.assertIn("device_grade_basis", s)
        self.assertIn("complete", s)


class ReviewMapLibreParity(unittest.TestCase):
    """#3 — MapLibre runs the same payload AND the same synthetic ceiling series."""

    def test_maplibre_prototype_supports_synthetic_and_recompute(self):
        mp = read(os.path.join(PROTO, "maplibre_prototype.html"))
        self.assertIn("makePolygons", mp)
        self.assertIn("makePoints", mp)
        self.assertIn("mulberry32", mp)
        self.assertIn("recompute", mp)
        self.assertIn("ambitosIntersecting", mp)

    def test_full_suite_runs_maplibre_ceiling_and_recompute(self):
        r = read(os.path.join(DH, "run_device.mjs"))
        # ceilPair/realPair both emit a MapLibre (ML) twin → MapLibre runs the
        # ceiling series and the recompute real-payload set, paired to Leaflet.
        self.assertIn("ceilPair", r)
        self.assertIn("realPair", r)
        self.assertRegex(r, r"recompute=\$\{recompute\}")  # recompute carried into the real pair
        self.assertRegex(r, r"ceilPair\(\"point\"")  # maplibre+leaflet point ceiling
        self.assertRegex(r, r"ceilPair\(\"polygon\"")  # maplibre+leaflet polygon ceiling


class ReviewAcceptanceCoverage(unittest.TestCase):
    """#4 — 4 DuckDB shapes; PMTiles real output; GeoParquet geometry."""

    def test_duckdb_covers_four_shapes_with_verified_outputs(self):
        d = read_result("duckdb_wasm.json")
        self.assertEqual(
            set(d["query_shapes_covered"]),
            {"in_circle", "date_window", "edition_diff", "ambito_containment"},
        )
        self.assertTrue(d["correctness"]["editionDiff"]["identical"])
        # shape 4 DuckDB side is honestly UNVERIFIED, JS side measured
        self.assertIsNotNone(d["correctness"]["containment"]["js_hits"])
        self.assertIn("UNVERIFIED", d["correctness"]["containment"]["duckdb_status"])

    def test_pmtiles_has_real_tiled_output(self):
        p = read_result("pmtiles.json")
        for layer in p["layers"]:
            self.assertIn("tiled", layer)
            self.assertIn("per_zoom", layer["tiled"])
            self.assertGreater(layer["tiled"]["viewport_default_zoom"]["tiles"], 0)

    def test_geoparquet_has_geometry_measurement(self):
        g = read_result("geoparquet.json")
        self.assertIn("geometry_artifacts", g)
        amb = next(a for a in g["geometry_artifacts"] if a["artifact"] == "ambitos")
        self.assertIn("geoparquet_zstd_bytes", amb)
        self.assertIn("geojson_gzip_bytes", amb)


class ReviewPartitioningInterpretation(unittest.TestCase):
    """#5 — B1 (latest-only) and B2 (Dynamics-equivalent) reported separately."""

    def test_partitioning_reports_b1_and_b2_with_dynamics_finding(self):
        p = read_result("partitioning.json")
        self.assertIn("B1_partitioned_latest_month_only", p["scenarios"])
        self.assertIn("B2_partitioned_latest_plus_previous", p["scenarios"])
        self.assertIn("dynamics_adjacency_finding", p)
        self.assertIn("B2_dynamics_equivalent", p["initial_load_savings"])

    def test_doc_qualifies_the_saving(self):
        t = read(DOC)
        self.assertIn("72.4", t)  # the Dynamics-equivalent figure is present
        self.assertIn("breaks Dynamics", t)  # latest-only qualified, not a general claim


class ReviewMethodologyWording(unittest.TestCase):
    """Methodology honesty: FCP/map-ready/double-rAF described accurately."""

    def test_doc_does_not_overclaim_paint_or_tti(self):
        t = read(DOC)
        self.assertIn("double-rAF proxy", t)
        self.assertIn("true paint timestamp", t)  # "not** a true paint timestamp"
        self.assertIn("Lighthouse", t)  # map-ready explicitly distinguished from Lighthouse TTI


class ReviewDeviceMicroGate(unittest.TestCase):
    """Device micro-gate: strict parity, readiness barriers, fail-closed device-grade."""

    def test_maplibre_has_admin_layer_and_async_readiness(self):
        mp = read(os.path.join(PROTO, "maplibre_prototype.html"))
        self.assertIn('"admin"', mp)  # admin source for the 3-layer parity set
        self.assertIn("awaitIdleAndSources", mp)
        self.assertIn("isSourceLoaded", mp)

    def test_rum_records_readiness_barrier_and_fidelity_caveat(self):
        rum = read(os.path.join(DH, "rum.js"))
        self.assertIn("readiness_barrier", rum)
        self.assertIn("recompute_fidelity", rum)

    def test_harness_pages_pass_a_readiness_barrier(self):
        for f in ("leaflet_baseline.html", "leaflet_ceiling.html"):
            self.assertIn("readiness_barrier", read(os.path.join(DH, f)), f"{f} lacks readiness_barrier")

    def test_runner_pairs_engines_and_gates_comparability(self):
        r = read(os.path.join(DH, "run_device.mjs"))
        self.assertIn("pairKey", r)
        self.assertIn("comparable", r)
        self.assertIn("allComparable", r)
        self.assertIn("ambito,licence,admin", r)  # matched 3-layer set on both engines
        self.assertIn('deviceGradeOf', r)
        self.assertIn("./grade.mjs", r)  # fail-closed logic imported from the tested module

    def test_runner_supports_real_channel_and_headed(self):
        r = read(os.path.join(DH, "run_device.mjs"))
        self.assertIn("channel", r)
        self.assertIn("HEADED", r)
        self.assertIn("chromium.launch", r)

    def test_grade_module_exists(self):
        self.assertTrue(os.path.exists(os.path.join(DH, "grade.mjs")))

    def test_ipad_matrix_matches_final_benchmark(self):
        ip = read(os.path.join(DH, "IPAD.md"))
        self.assertIn("recompute=", ip)  # recompute modes present
        self.assertIn("maplibre_proto/maplibre_prototype.html?kind=", ip)  # MapLibre ceiling stress
        self.assertIn("ambito,licence,admin", ip)  # matched 3-layer set


if __name__ == "__main__":
    unittest.main()
