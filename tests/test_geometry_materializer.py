"""Tests for the Gate 4D geometry materializer helpers (research/geospatial_cinematic/geometry).

SYNTHETIC arrays only, never observations of Madrid. The window search and the peak refinement are
standard library; the correlation test skips itself when numpy is not installed, so the file stays
collectable in CI without installing anything.
"""

from __future__ import annotations

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "research" / "geospatial_cinematic" / "geometry"))

import materialize_geometry as mg  # noqa: E402  (stdlib + pilot modules at import time)

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None


class WindowSearch(unittest.TestCase):
    def test_longest_run_picks_the_longest_contiguous_block(self):
        self.assertEqual(mg.longest_run([True, True, False, True, True, True, False]), (3, 6))
        self.assertEqual(mg.longest_run([True] * 5), (0, 5))
        self.assertEqual(mg.longest_run([False, False]), (0, 0))


class PeakRefinement(unittest.TestCase):
    def test_symmetric_peak_stays_on_the_integer_shift(self):
        scores = {(-1, 0): 0.5, (0, 0): 1.0, (1, 0): 0.5, (0, -1): 0.5, (0, 1): 0.5}
        self.assertEqual(mg.subpixel_peak(scores, (0, 0)), [0.0, 0.0])

    def test_asymmetric_peak_moves_towards_the_higher_neighbour(self):
        scores = {(-1, 0): 0.2, (0, 0): 1.0, (1, 0): 0.8, (0, -1): 0.5, (0, 1): 0.5}
        dx, dy = mg.subpixel_peak(scores, (0, 0))
        self.assertGreater(dx, 0.0)
        self.assertLess(dx, 0.5)
        self.assertEqual(dy, 0.0)


@unittest.skipIf(np is None, "numpy not installed")
class Correspondence(unittest.TestCase):
    def test_correlation_peaks_where_the_two_grids_are_aligned(self):
        rng = np.random.default_rng(7)
        base = rng.random((60, 80))
        A = mg.gradient_magnitude(base)
        # Without displacement the peak is at (0, 0).
        self.assertEqual(max(mg.shift_scores(A, A, r=3).items(), key=lambda kv: kv[1])[0], (0, 0))
        # Features of B lie 2 px WEST of A's (B[c] = base[c + 2]), so A matches B sampled 2 px west.
        shifted = np.roll(base, -2, axis=1)
        scores = mg.shift_scores(A, mg.gradient_magnitude(shifted), r=3)
        self.assertEqual(max(scores, key=scores.get), (-2, 0))


if __name__ == "__main__":
    unittest.main()
