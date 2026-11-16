"""Reproducibility and geometric-coherence tests for the network-accessibility pilot.

Research-package tests, deliberately narrow. They cover exactly the primitives
whose silent failure would make the pilot's numbers wrong rather than merely
imprecise:

* the projection and snapping geometry,
* the shortest-path search and its determinism,
* the invariant that a network path is never shorter than the straight line,
* the parsing of the official callejero's comma-decimal UTM strings,
* the quantile reporting,
* and, when pyproj is installed, that the EPSG:25830 <-> EPSG:4326 round trip
  is lossless at millimetre scale for a real Madrid coordinate.

Standard library only by default, like the rest of the repository's Python
suite: the one test that needs pyproj skips itself when pyproj is absent, so
this file stays collectable in CI without installing anything.
"""

from __future__ import annotations

import math
import pathlib
import sys
import unittest

PILOT = pathlib.Path(__file__).resolve().parents[1] / "research" / "network_accessibility_pilot"
sys.path.insert(0, str(PILOT))

import pilot_common as pc  # noqa: E402


class ProjectOnSegmentTests(unittest.TestCase):
    def test_projects_to_interior_point(self):
        t, x, y = pc.project_on_segment((5.0, 3.0), (0.0, 0.0), (10.0, 0.0))
        self.assertAlmostEqual(t, 0.5)
        self.assertAlmostEqual(x, 5.0)
        self.assertAlmostEqual(y, 0.0)

    def test_clamps_before_start(self):
        t, x, y = pc.project_on_segment((-7.0, 4.0), (0.0, 0.0), (10.0, 0.0))
        self.assertEqual(t, 0.0)
        self.assertEqual((x, y), (0.0, 0.0))

    def test_clamps_after_end(self):
        t, x, y = pc.project_on_segment((99.0, -4.0), (0.0, 0.0), (10.0, 0.0))
        self.assertEqual(t, 1.0)
        self.assertEqual((x, y), (10.0, 0.0))

    def test_degenerate_segment_does_not_divide_by_zero(self):
        t, x, y = pc.project_on_segment((3.0, 3.0), (1.0, 1.0), (1.0, 1.0))
        self.assertEqual((t, x, y), (0.0, 1.0, 1.0))


def _grid(step: float = 100.0, n: int = 4) -> tuple[pc.Graph, list[tuple[object, object]]]:
    """A regular ``n x n`` grid of ``step`` metres: the canonical Manhattan case.

    On this network the shortest path between two nodes is their L1 distance,
    so every expected value below is known in closed form rather than copied
    from a previous run of the code under test.
    """
    graph = pc.Graph()
    segments: list[tuple[object, object]] = []
    for i in range(n):
        for j in range(n):
            graph.add_node((i, j), i * step, j * step)
    for i in range(n):
        for j in range(n):
            if i + 1 < n:
                graph.add_edge((i, j), (i + 1, j))
                segments.append(((i, j), (i + 1, j)))
            if j + 1 < n:
                graph.add_edge((i, j), (i, j + 1))
                segments.append(((i, j), (i, j + 1)))
    return graph, segments


class DijkstraTests(unittest.TestCase):
    def test_distances_equal_l1_on_a_grid(self):
        graph, _ = _grid()
        dist, label = pc.multi_source_dijkstra(graph, {(0, 0): (0.0, "A")})
        for i in range(4):
            for j in range(4):
                self.assertAlmostEqual(dist[(i, j)], (i + j) * 100.0, places=6)
                self.assertEqual(label[(i, j)], "A")

    def test_multi_source_picks_the_nearer_seed_and_labels_it(self):
        graph, _ = _grid()
        dist, label = pc.multi_source_dijkstra(
            graph, {(0, 0): (0.0, "A"), (3, 3): (0.0, "B")}
        )
        self.assertEqual(label[(0, 1)], "A")
        self.assertEqual(label[(3, 2)], "B")
        self.assertAlmostEqual(dist[(3, 2)], 100.0, places=6)

    def test_initial_seed_cost_is_carried(self):
        graph, _ = _grid()
        dist, label = pc.multi_source_dijkstra(
            graph, {(0, 0): (0.0, "A"), (0, 3): (40.0, "B")}
        )
        # (0,2) is 200 m from A and 100+40 m from B, so B owns it.
        self.assertEqual(label[(0, 2)], "B")
        self.assertAlmostEqual(dist[(0, 2)], 140.0, places=6)

    def test_equidistant_seeds_break_ties_deterministically(self):
        graph, _ = _grid()
        first = pc.multi_source_dijkstra(graph, {(0, 0): (0.0, "B"), (0, 2): (0.0, "A")})[1]
        second = pc.multi_source_dijkstra(graph, {(0, 2): (0.0, "A"), (0, 0): (0.0, "B")})[1]
        self.assertEqual(first[(0, 1)], second[(0, 1)])
        self.assertEqual(first[(0, 1)], "A")

    def test_unreachable_nodes_get_no_distance(self):
        graph, _ = _grid()
        graph.add_node("island", 9999.0, 9999.0)
        dist, _ = pc.multi_source_dijkstra(graph, {(0, 0): (0.0, "A")})
        self.assertNotIn("island", dist)


class ComponentTests(unittest.TestCase):
    def test_components_are_largest_first(self):
        graph, _ = _grid()
        graph.add_node("x", 1.0, 1.0)
        graph.add_node("y", 2.0, 2.0)
        graph.add_edge("x", "y")
        components = graph.components()
        self.assertEqual(len(components), 2)
        self.assertEqual(len(components[0]), 16)
        self.assertEqual(components[1], {"x", "y"})


class SnappingTests(unittest.TestCase):
    def test_offset_is_the_perpendicular_distance_and_node_is_on_the_segment(self):
        graph, segments = _grid()
        snapped, unsnapped = pc.snap_points_into_graph(
            graph, segments, [("p", 50.0, 12.0)], max_radius=30.0
        )
        self.assertEqual(unsnapped, [])
        self.assertAlmostEqual(snapped["p"]["offset_m"], 12.0, places=6)
        x, y = graph.pos[snapped["p"]["node"]]
        self.assertAlmostEqual(x, 50.0, places=6)
        self.assertAlmostEqual(y, 0.0, places=6)

    def test_point_beyond_tolerance_is_reported_not_attached(self):
        graph, segments = _grid()
        snapped, unsnapped = pc.snap_points_into_graph(
            graph, segments, [("far", 50.0, 50.0)], max_radius=30.0
        )
        self.assertEqual(unsnapped, ["far"])
        self.assertNotIn("far", snapped)

    def test_splitting_preserves_total_edge_length(self):
        graph, segments = _grid()
        before = graph.total_length_m()
        pc.snap_points_into_graph(
            graph,
            segments,
            [("a", 30.0, 0.0), ("b", 70.0, 0.0), ("c", 0.0, 55.0)],
            max_radius=5.0,
        )
        self.assertAlmostEqual(graph.total_length_m(), before, places=6)

    def test_result_is_independent_of_input_order(self):
        points = [("a", 30.0, 4.0), ("b", 70.0, 4.0), ("c", 12.0, 100.0)]
        first_graph, first_segments = _grid()
        first, _ = pc.snap_points_into_graph(
            first_graph, first_segments, points, max_radius=30.0
        )
        second_graph, second_segments = _grid()
        second, _ = pc.snap_points_into_graph(
            second_graph, second_segments, list(reversed(points)), max_radius=30.0
        )
        for pid in ("a", "b", "c"):
            self.assertAlmostEqual(first[pid]["offset_m"], second[pid]["offset_m"], places=9)
            self.assertEqual(
                first_graph.pos[first[pid]["node"]], second_graph.pos[second[pid]["node"]]
            )

    def test_two_points_on_one_segment_stay_connected_in_order(self):
        graph, segments = _grid()
        snapped, _ = pc.snap_points_into_graph(
            graph, segments, [("near", 10.0, 0.0), ("far", 90.0, 0.0)], max_radius=5.0
        )
        dist, _ = pc.multi_source_dijkstra(graph, {snapped["near"]["node"]: (0.0, "N")})
        self.assertAlmostEqual(dist[snapped["far"]["node"]], 80.0, places=6)


class GeometricCoherenceTests(unittest.TestCase):
    """The invariant the pilot asserts on real data, asserted here on known data."""

    def test_network_distance_never_below_the_straight_line(self):
        graph, segments = _grid()
        origins = [("o1", 10.0, 7.0), ("o2", 240.0, 3.0), ("o3", 7.0, 290.0)]
        facility = ("f1", 295.0, 298.0)
        snapped, unsnapped = pc.snap_points_into_graph(
            graph, segments, [facility, *origins], max_radius=30.0
        )
        self.assertEqual(unsnapped, [])
        seeds = {snapped["f1"]["node"]: (snapped["f1"]["offset_m"], "f1")}
        dist, _ = pc.multi_source_dijkstra(graph, seeds)
        for pid, px, py in origins:
            network = dist[snapped[pid]["node"]] + snapped[pid]["offset_m"]
            straight = math.hypot(px - facility[1], py - facility[2])
            self.assertGreaterEqual(network + 1e-9, straight, f"{pid} violates the invariant")

    def test_grid_detour_ratio_matches_the_closed_form(self):
        """On a pure grid the detour ratio is exactly L1/L2 between the nodes."""
        graph, segments = _grid()
        snapped, _ = pc.snap_points_into_graph(
            graph, segments, [("f", 0.0, 0.0), ("o", 300.0, 300.0)], max_radius=1.0
        )
        dist, _ = pc.multi_source_dijkstra(
            graph, {snapped["f"]["node"]: (snapped["f"]["offset_m"], "f")}
        )
        network = dist[snapped["o"]["node"]] + snapped["o"]["offset_m"]
        self.assertAlmostEqual(network, 600.0, places=6)
        self.assertAlmostEqual(network / math.hypot(300.0, 300.0), math.sqrt(2.0), places=9)


class CallejeroParsingTests(unittest.TestCase):
    def test_comma_decimal_utm_strings(self):
        self.assertAlmostEqual(pc.parse_spanish_decimal("437541,88"), 437541.88)
        self.assertAlmostEqual(pc.parse_spanish_decimal(" 4471554,43 "), 4471554.43)

    def test_plain_decimal_still_parses(self):
        self.assertAlmostEqual(pc.parse_spanish_decimal("437541.88"), 437541.88)


class QuantileTests(unittest.TestCase):
    def test_type_seven_quantiles_on_a_known_sample(self):
        values = [1.0, 2.0, 3.0, 4.0]
        out = pc.quantiles(values, (0.5,))
        self.assertAlmostEqual(out["p50"], 2.5)

    def test_single_value_and_empty_sample(self):
        self.assertEqual(pc.quantiles([7.0], (0.5,))["p50"], 7.0)
        self.assertIsNone(pc.quantiles([], (0.5,))["p50"])


class CrsTests(unittest.TestCase):
    @unittest.skipUnless(
        __import__("importlib").util.find_spec("pyproj"), "pyproj is a build/research dependency"
    )
    def test_madrid_coordinate_round_trips_within_a_millimetre(self):
        import pyproj

        # A real published callejero portal coordinate (ETRS89 / UTM 30N).
        x, y = 437541.88, 4471554.43
        inverse = pyproj.Transformer.from_crs(
            pc.METRIC_CRS, pc.GEOGRAPHIC_CRS, always_xy=True
        ).transform
        lon, lat = inverse(x, y)
        back_x, back_y = pc.to_metric(lon, lat)
        self.assertLess(abs(back_x - x), 0.001)
        self.assertLess(abs(back_y - y), 0.001)
        # Sanity: the coordinate must land in Madrid, not in another zone.
        self.assertTrue(-3.80 < lon < -3.55, lon)
        self.assertTrue(40.33 < lat < 40.52, lat)


class CacheTests(unittest.TestCase):
    """A cache hit must serve the payload without a network call, and must
    report the provenance of the FIRST retrieval rather than inventing a new one.

    This is a reproducibility property, not a performance one: if a hit rewrote
    the provenance, a re-run would silently relabel where the bytes came from.
    """

    def setUp(self):
        import json
        import os
        import tempfile

        self._tmp = tempfile.TemporaryDirectory()
        self._previous = os.environ.get("PILOT_CACHE")
        os.environ["PILOT_CACHE"] = self._tmp.name
        cache = pathlib.Path(self._tmp.name)
        (cache / "probe.json").write_text('{"ok": true}', encoding="utf-8")
        (cache / "probe.provenance.json").write_text(
            json.dumps(
                {
                    "url": "https://example.invalid/original",
                    "first_retrieved_at": "2020-01-01T00:00:00Z",
                    "sha256": "0" * 64,
                    "byte_length": 12,
                    "cache_state": "MISS",
                }
            ),
            encoding="utf-8",
        )

    def tearDown(self):
        import os

        if self._previous is None:
            os.environ.pop("PILOT_CACHE", None)
        else:
            os.environ["PILOT_CACHE"] = self._previous
        self._tmp.cleanup()

    def test_hit_serves_cached_bytes_and_first_retrieval_provenance(self):
        def explode(*args, **kwargs):  # pragma: no cover - must never run
            raise AssertionError("a cache hit must not perform a network request")

        original = pc._require_requests
        pc._require_requests = explode
        try:
            hit = pc.retrieve("https://example.invalid/changed-since", "probe", suffix=".json")
        finally:
            pc._require_requests = original

        self.assertEqual(hit["provenance"]["cache_state"], "HIT")
        self.assertEqual(hit["provenance"]["first_retrieved_at"], "2020-01-01T00:00:00Z")
        self.assertEqual(hit["provenance"]["url"], "https://example.invalid/original")
        self.assertEqual(hit["path"].read_text(encoding="utf-8"), '{"ok": true}')

    def test_cache_dir_honours_the_environment_override(self):
        self.assertEqual(pc.cache_dir(), pathlib.Path(self._tmp.name))


class IsolationTests(unittest.TestCase):
    """The pilot must stay outside the application."""

    def test_no_application_file_references_the_pilot(self):
        repo = pathlib.Path(__file__).resolve().parents[1]
        targets = ["network_accessibility_pilot", "pilot_common", "run_pilot"]
        searched = list((repo / "js").glob("*.js")) + [
            repo / "index.html",
            repo / "package.json",
        ]
        for path in searched:
            if not path.exists():
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            for target in targets:
                self.assertNotIn(target, text, f"{path.name} references {target}")

    def test_pilot_module_imports_without_third_party_packages(self):
        """Module import must stay stdlib-only, like the repository's builders."""
        source = (PILOT / "pilot_common.py").read_text(encoding="utf-8")
        head = source.split("# ---", 1)[0]
        for banned in ("import requests", "import pyproj", "import shapely", "import numpy"):
            self.assertNotIn(banned, head, f"{banned} must stay inside a _require_* helper")


if __name__ == "__main__":
    unittest.main()
