"""Shared helpers for the Madrid Network Accessibility pilot (research only).

NOT a builder. Nothing here is imported by the application: no file in ``js/``,
``index.html`` or ``package.json`` references this package, and no committed data
artifact under ``data/`` is produced or mutated by it. See the package README.

What this module provides, and nothing more:

* **Cached, fingerprinted retrieval.** Every third-party byte stream is written
  into the git-ignored ``cache/`` directory with a JSON sidecar recording the
  first-retrieval timestamp, the HTTP validators, the byte length and the
  SHA-256. A cache hit therefore still reports the real original provenance.
* **One metric CRS.** EPSG:25830 (ETRS89 / UTM zone 30N), which is the CRS the
  official callejero already publishes its coordinates in and the CRS the
  repository's planning geometry is retrieved in. All lengths in metres are
  computed in that projected plane and nowhere else.
* **A segment-level, undirected pedestrian graph with no simplification.** Each
  consecutive OSM node pair of a retained way is one edge. Intersections are not
  consolidated, geometry is not generalised and degree-2 chains are not
  collapsed, because every one of those operations changes a shortest-path
  length. This is a deliberate departure from the usual OSMnx
  ``simplify``/``consolidate_intersections`` defaults.
* **Edge-projection snapping.** A point is attached to the nearest point *on*
  the nearest retained segment (not to the nearest OSM node), the segment is
  split at that projection and the perpendicular offset is carried as a real,
  separately reported walking cost.
* **Exact multi-source Dijkstra** over that graph, from the standard library.

Deliberately absent: machine learning, graph neural networks, any composite
index, any routing engine, any new web framework, and any dependency the
repository does not already pin for its official builders (``requests``,
``pyproj``, ``shapely``) plus ``matplotlib`` for the single figure.
"""

from __future__ import annotations

import hashlib
import heapq
import json
import math
import os
import pathlib
import time
from typing import Iterable, Sequence

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------

#: Projected CRS used for every metre in this pilot. The official callejero
#: publishes UTMX_ETRS/UTMY_ETRS in it directly, so origins need no
#: reprojection at all; only WGS84 inputs (OSM, the facility register) are
#: transformed, once, explicitly.
METRIC_CRS = "EPSG:25830"
GEOGRAPHIC_CRS = "EPSG:4326"

USER_AGENT = "madrid-urban-evidence-lens-research/network-accessibility-pilot"

ROOT = pathlib.Path(__file__).resolve().parent
RESULTS = ROOT / "results"
DEFAULT_CACHE = ROOT / "cache"


def cache_dir() -> pathlib.Path:
    """The git-ignored raw-retrieval cache. ``PILOT_CACHE`` relocates it."""
    path = pathlib.Path(os.environ.get("PILOT_CACHE", DEFAULT_CACHE))
    path.mkdir(parents=True, exist_ok=True)
    return path


# --------------------------------------------------------------------------
# Retrieval with provenance
# --------------------------------------------------------------------------


def _require_requests():
    try:
        import requests  # noqa: PLC0415
    except ModuleNotFoundError as exc:  # pragma: no cover - environment guard
        raise RuntimeError(
            "requests is required to retrieve the official sources. "
            "pip install -r scripts/requirements-build.txt"
        ) from exc
    return requests


def retrieve(url: str, key: str, *, method: str = "GET", data=None, suffix: str = "") -> dict:
    """Return ``{"path", "provenance"}`` for *url*, retrieving it at most once.

    The payload lands at ``cache/<key><suffix>`` and its provenance sidecar at
    ``cache/<key>.provenance.json``. A cache hit returns the provenance of the
    **first** retrieval, so re-running the pilot never rewrites the recorded
    origin of a byte stream, and never silently upgrades it either.
    """
    cache = cache_dir()
    payload_path = cache / f"{key}{suffix}"
    sidecar_path = cache / f"{key}.provenance.json"

    if payload_path.exists() and sidecar_path.exists():
        provenance = json.loads(sidecar_path.read_text(encoding="utf-8"))
        provenance["cache_state"] = "HIT"
        return {"path": payload_path, "provenance": provenance}

    requests = _require_requests()
    retrieved_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    headers = {"User-Agent": USER_AGENT}

    if method == "POST":
        response = requests.post(url, data=data, headers=headers, timeout=900)
    else:
        response = requests.get(url, headers=headers, timeout=900, stream=True)

    if response.status_code != 200:
        raise RuntimeError(f"retrieval failed: {url} -> HTTP {response.status_code}")

    digest = hashlib.sha256()
    length = 0
    with open(payload_path, "wb") as handle:
        for chunk in response.iter_content(1 << 16):
            if not chunk:
                continue
            digest.update(chunk)
            length += len(chunk)
            handle.write(chunk)

    provenance = {
        "url": url,
        "http_method": method,
        "first_retrieved_at": retrieved_at,
        "http_status": response.status_code,
        "http_last_modified": response.headers.get("Last-Modified"),
        "http_etag": response.headers.get("ETag"),
        "http_content_type": response.headers.get("Content-Type"),
        "byte_length": length,
        "sha256": digest.hexdigest(),
        "cache_state": "MISS",
    }
    sidecar_path.write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return {"path": payload_path, "provenance": provenance}


# --------------------------------------------------------------------------
# Projection
# --------------------------------------------------------------------------


def _require_pyproj():
    try:
        import pyproj  # noqa: PLC0415
    except ModuleNotFoundError as exc:  # pragma: no cover - environment guard
        raise RuntimeError(
            "pyproj is required for the explicit EPSG:4326 -> EPSG:25830 transform. "
            "pip install -r scripts/requirements-build.txt"
        ) from exc
    return pyproj


_FORWARD = None


def to_metric(lon: float, lat: float) -> tuple[float, float]:
    """Transform WGS84 (lon, lat) to EPSG:25830 (easting, northing) in metres."""
    global _FORWARD
    if _FORWARD is None:
        pyproj = _require_pyproj()
        _FORWARD = pyproj.Transformer.from_crs(
            GEOGRAPHIC_CRS, METRIC_CRS, always_xy=True
        ).transform
    return _FORWARD(lon, lat)


def parse_spanish_decimal(text: str) -> float:
    """Parse the callejero's comma-decimal UTM strings (``'437541,88'``)."""
    return float(text.strip().replace(",", "."))


def euclid(a: Sequence[float], b: Sequence[float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


# --------------------------------------------------------------------------
# Segment-level undirected graph
# --------------------------------------------------------------------------


class Graph:
    """An undirected, segment-level weighted graph with metric node positions.

    Nodes are opaque keys; positions are EPSG:25830 ``(x, y)`` tuples. Edge
    weights are planar lengths in metres. No simplification of any kind is
    applied: the caller's segments survive exactly as given.
    """

    def __init__(self) -> None:
        self.pos: dict[object, tuple[float, float]] = {}
        self.adj: dict[object, list[tuple[object, float]]] = {}

    def add_node(self, key, x: float, y: float) -> None:
        if key not in self.pos:
            self.pos[key] = (x, y)
            self.adj[key] = []

    def add_edge(self, a, b, weight: float | None = None) -> None:
        if a == b:
            return
        if weight is None:
            weight = euclid(self.pos[a], self.pos[b])
        self.adj[a].append((b, weight))
        self.adj[b].append((a, weight))

    @property
    def node_count(self) -> int:
        return len(self.pos)

    @property
    def edge_count(self) -> int:
        return sum(len(v) for v in self.adj.values()) // 2

    def total_length_m(self) -> float:
        """Total undirected edge length in metres."""
        return sum(w for nbrs in self.adj.values() for _, w in nbrs) / 2.0

    def components(self) -> list[set]:
        """Connected components, largest first."""
        seen: set = set()
        out: list[set] = []
        for start in self.pos:
            if start in seen:
                continue
            stack = [start]
            comp = set()
            seen.add(start)
            while stack:
                node = stack.pop()
                comp.add(node)
                for nbr, _ in self.adj[node]:
                    if nbr not in seen:
                        seen.add(nbr)
                        stack.append(nbr)
            out.append(comp)
        out.sort(key=len, reverse=True)
        return out


def multi_source_dijkstra(
    graph: Graph, seeds: dict[object, tuple[float, object]]
) -> tuple[dict[object, float], dict[object, object]]:
    """Exact multi-source Dijkstra.

    *seeds* maps a start node to ``(initial_cost, label)``. Returns
    ``(distance_by_node, label_by_node)`` where ``label`` identifies which seed
    owns the shortest path to that node. One pass therefore yields, for every
    node at once, both the distance to the nearest seed and which seed it is.

    Ties are broken deterministically by the string form of the label, so when
    two seeds are exactly equidistant from a node the same seed always wins. The
    third heap element is a monotonic counter, never the node key: node keys are
    heterogeneous (OSM ids and ``("snap", pid)`` tuples) and would otherwise be
    compared against each other. It only ever breaks a tie in which cost and
    label already agree, so it cannot change an answer.
    """
    dist: dict[object, float] = {}
    label: dict[object, object] = {}
    heap: list[tuple[float, str, int, object, object]] = []
    order = 0
    for node, (cost, name) in seeds.items():
        heapq.heappush(heap, (cost, str(name), order, node, name))
        order += 1
    while heap:
        cost, _, _, node, name = heapq.heappop(heap)
        if node in dist:
            continue
        dist[node] = cost
        label[node] = name
        for nbr, weight in graph.adj[node]:
            if nbr not in dist:
                heapq.heappush(heap, (cost + weight, str(name), order, nbr, name))
                order += 1
    return dist, label


# --------------------------------------------------------------------------
# Edge-projection snapping
# --------------------------------------------------------------------------


def project_on_segment(
    p: Sequence[float], a: Sequence[float], b: Sequence[float]
) -> tuple[float, float, float]:
    """Return ``(t, x, y)``: the clamped parameter and the projected point."""
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    denom = dx * dx + dy * dy
    if denom == 0.0:
        return 0.0, ax, ay
    t = ((p[0] - ax) * dx + (p[1] - ay) * dy) / denom
    t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    return t, ax + t * dx, ay + t * dy


class SnapIndex:
    """Nearest-segment lookup over a fixed segment list, with a uniform grid.

    A uniform grid is used rather than an R-tree so the index carries no extra
    dependency and no tie-breaking surprises: cells are scanned in widening
    square rings until no unscanned ring could hold anything closer than the
    best candidate already found.
    """

    def __init__(self, segments: list[tuple[object, object]], pos: dict, cell: float = 100.0):
        self.segments = segments
        self.pos = pos
        self.cell = cell
        self.grid: dict[tuple[int, int], list[int]] = {}
        for index, (a, b) in enumerate(segments):
            (ax, ay), (bx, by) = pos[a], pos[b]
            i0, i1 = sorted((int(ax // cell), int(bx // cell)))
            j0, j1 = sorted((int(ay // cell), int(by // cell)))
            for i in range(i0, i1 + 1):
                for j in range(j0, j1 + 1):
                    self.grid.setdefault((i, j), []).append(index)

    def nearest(self, x: float, y: float, max_radius: float):
        """Return ``(segment_index, t, px, py, offset)`` or ``None``.

        Deterministic: among equal-distance candidates the lowest segment index
        wins, and segment order is the order the caller built the graph in.
        """
        ci, cj = int(x // self.cell), int(y // self.cell)
        best = None
        ring = 0
        max_ring = int(max_radius // self.cell) + 2
        while ring <= max_ring:
            # Anything first reachable at this ring is at least (ring-1)*cell
            # away, so once that floor exceeds the best offset found, stop.
            if best is not None and (ring - 1) * self.cell > best[4]:
                break
            for i in range(ci - ring, ci + ring + 1):
                for j in range(cj - ring, cj + ring + 1):
                    if ring and max(abs(i - ci), abs(j - cj)) != ring:
                        continue
                    bucket = self.grid.get((i, j))
                    if not bucket:
                        continue
                    for index in bucket:
                        a, b = self.segments[index]
                        t, px, py = project_on_segment((x, y), self.pos[a], self.pos[b])
                        offset = math.hypot(px - x, py - y)
                        if offset > max_radius:
                            continue
                        if best is None or (offset, index) < (best[4], best[0]):
                            best = (index, t, px, py, offset)
            ring += 1
        return best


def snap_points_into_graph(
    graph: Graph,
    segments: list[tuple[object, object]],
    points: Iterable[tuple[str, float, float]],
    *,
    max_radius: float,
) -> tuple[dict[str, dict], list[str]]:
    """Attach *points* to the graph by splitting the segment each projects onto.

    Returns ``(snapped, unsnapped)``. ``snapped[pid]`` carries the inserted
    virtual node key and the perpendicular ``offset_m``, which the caller must
    treat as real walking distance rather than discarding it.

    Every projection is computed against the ORIGINAL segment list first, and
    only then are the segments split, so no point snaps to a sub-segment another
    point created and the outcome does not depend on input order.
    """
    index = SnapIndex(segments, graph.pos)
    per_segment: dict[int, list[tuple[float, str, float, float]]] = {}
    snapped: dict[str, dict] = {}
    unsnapped: list[str] = []

    for pid, x, y in points:
        hit = index.nearest(x, y, max_radius)
        if hit is None:
            unsnapped.append(pid)
            continue
        seg_index, t, px, py, offset = hit
        per_segment.setdefault(seg_index, []).append((t, pid, px, py))
        snapped[pid] = {"offset_m": offset, "segment_index": seg_index, "t": t}

    for seg_index, hits in per_segment.items():
        a, b = segments[seg_index]
        hits.sort(key=lambda h: (h[0], h[1]))
        chain: list[object] = [a]
        for _t, pid, px, py in hits:
            key = ("snap", pid)
            graph.add_node(key, px, py)
            snapped[pid]["node"] = key
            chain.append(key)
        chain.append(b)
        _remove_edge(graph, a, b)
        for left, right in zip(chain, chain[1:]):
            graph.add_edge(left, right)

    return snapped, unsnapped


def _remove_edge(graph: Graph, a, b) -> None:
    graph.adj[a] = [(n, w) for n, w in graph.adj[a] if n != b]
    graph.adj[b] = [(n, w) for n, w in graph.adj[b] if n != a]


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------


def quantiles(values: Sequence[float], probs: Sequence[float]) -> dict[str, float]:
    """Linear-interpolation quantiles (type 7), reported to 4 decimals."""
    if not values:
        return {f"p{int(p * 100)}": None for p in probs}
    ordered = sorted(values)
    out: dict[str, float] = {}
    for p in probs:
        if len(ordered) == 1:
            out[f"p{int(p * 100)}"] = round(ordered[0], 4)
            continue
        h = (len(ordered) - 1) * p
        lo = int(math.floor(h))
        hi = min(lo + 1, len(ordered) - 1)
        out[f"p{int(p * 100)}"] = round(ordered[lo] + (h - lo) * (ordered[hi] - ordered[lo]), 4)
    return out


def write_result(name: str, payload: dict) -> pathlib.Path:
    RESULTS.mkdir(parents=True, exist_ok=True)
    path = RESULTS / name
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return path
