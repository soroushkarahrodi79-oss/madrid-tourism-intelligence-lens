// Pure display-density helpers for high-volume POI layers.
// These functions never change analytical counts; they only decide how
// already-loaded points are grouped for map rendering.

const MAX_MERCATOR_LAT = 85.05112878;

function clampLat(lat) {
  return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, Number(lat)));
}

function projectToWorldPixel(point, zoom, tileSize = 256) {
  const lat = clampLat(point.lat);
  const lon = Number(point.lon);
  const scale = tileSize * 2 ** zoom;
  const x = ((lon + 180) / 360) * scale;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y =
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function clusterCellSizePx(zoom) {
  if (zoom <= 12) return 92;
  if (zoom === 13) return 76;
  if (zoom === 14) return 60;
  if (zoom === 15) return 46;
  return 0;
}

function shouldClusterDenseLayer(zoom) {
  return zoom < 16;
}

function clusterPointsByPixelGrid(points, zoom) {
  const cellPx = clusterCellSizePx(zoom);
  if (!cellPx || !points.length) {
    return points.map((p) => ({
      count: 1,
      lat: p.lat,
      lon: p.lon,
      points: [p],
    }));
  }

  const buckets = new Map();

  for (const point of points) {
    const px = projectToWorldPixel(point, zoom);
    const key = `${Math.floor(px.x / cellPx)}:${Math.floor(px.y / cellPx)}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { points: [], latSum: 0, lonSum: 0 };
      buckets.set(key, bucket);
    }
    bucket.points.push(point);
    bucket.latSum += Number(point.lat);
    bucket.lonSum += Number(point.lon);
  }

  return [...buckets.values()].map((bucket) => ({
    count: bucket.points.length,
    lat: bucket.latSum / bucket.points.length,
    lon: bucket.lonSum / bucket.points.length,
    points: bucket.points,
  }));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    projectToWorldPixel,
    clusterCellSizePx,
    shouldClusterDenseLayer,
    clusterPointsByPixelGrid,
  };
}
