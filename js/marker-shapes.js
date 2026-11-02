// Non-colour category channel for the five operational POI layers (#152).
//
// One geometry table drives BOTH the Leaflet canvas marker and the left-rail
// legend dot, so the two cannot drift. Coordinates are unit vectors in multiples
// of the marker's rendered radius (y grows downward, as on a canvas). `null`
// means "keep Leaflet's native circle", which is also the fallback whenever the
// canvas drawing path is unavailable.
//
// Only silhouette is claimed here. This is automated shape differentiation, not
// evidence that people recognise the categories (human validation: #153).

const OPERATIONAL_MARKER_SHAPES = Object.freeze({
  bike: Object.freeze({ name: "circle", points: null }),
  stay: Object.freeze({
    name: "square",
    points: Object.freeze([[-0.88, -0.88], [0.88, -0.88], [0.88, 0.88], [-0.88, 0.88]]),
  }),
  rail: Object.freeze({
    name: "diamond",
    points: Object.freeze([[0, -1.2], [1.2, 0], [0, 1.2], [-1.2, 0]]),
  }),
  museum: Object.freeze({
    name: "triangle",
    points: Object.freeze([[0, -1.25], [1.15, 0.75], [-1.15, 0.75]]),
  }),
  info: Object.freeze({
    name: "plus",
    points: Object.freeze([
      [-0.45, -1.2], [0.45, -1.2], [0.45, -0.45], [1.2, -0.45], [1.2, 0.45], [0.45, 0.45],
      [0.45, 1.2], [-0.45, 1.2], [-0.45, 0.45], [-1.2, 0.45], [-1.2, -0.45], [-0.45, -0.45],
    ]),
  }),
});

// Half-width of the shared legend box, in radius units; no shape exceeds it.
const MARKER_SHAPE_EXTENT = 1.25;
// The legend circle is drawn at the standard (non-BiciMAD) radius of 4 px.
const MARKER_CIRCLE_LEGEND_RADIUS = 1;

// Leaflet's canvas renderer rounds a circle's radius to whole pixels; polygons
// follow the same rounding so a shape never grows or shrinks by a sub-pixel.
function renderedMarkerRadius(radius) {
  return Math.max(Math.round(radius), 1);
}

// Trace (do not fill or stroke) the category polygon centred on (x, y).
function traceMarkerShape(ctx, shape, x, y, radius) {
  const points = shape && shape.points;
  if (!points || !points.length) return false;
  ctx.beginPath();
  points.forEach(([px, py], index) => {
    const cx = x + px * radius;
    const cy = y + py * radius;
    if (index === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  });
  ctx.closePath();
  return true;
}

// CSS clip-path for the legend dot, from the same table as the map marker.
function markerShapeClipPath(type) {
  const shape = OPERATIONAL_MARKER_SHAPES[type];
  if (!shape) return "";
  const pct = (v) => `${Math.round(((v + MARKER_SHAPE_EXTENT) / (2 * MARKER_SHAPE_EXTENT)) * 1000) / 10}%`;
  if (!shape.points) return `circle(${Math.round((MARKER_CIRCLE_LEGEND_RADIUS / (2 * MARKER_SHAPE_EXTENT)) * 1000) / 10}%)`;
  return `polygon(${shape.points.map(([x, y]) => `${pct(x)} ${pct(y)}`).join(",")})`;
}

// Leaflet-dependent part. Guarded so the geometry above stays importable by
// `node --test` without a DOM or Leaflet.
let ShapedCircleMarker = null;
if (typeof L !== "undefined" && L.CircleMarker && L.Canvas) {
  ShapedCircleMarker = L.CircleMarker.extend({
    // Mirrors L.Canvas#_updateCircle: draw only inside the renderer's own
    // draw cycle (`_drawing`), on its live context, then let the renderer apply
    // fill/stroke from the layer options. Anything else (SVG renderer, a
    // renderer without `_fillStroke`, outside a draw cycle) takes Leaflet's
    // unmodified circle path, which is a safe no-op or a plain circle.
    _updatePath() {
      const renderer = this._renderer;
      const shape = this.options.markerShape;
      if (
        !shape ||
        !shape.points ||
        !(renderer instanceof L.Canvas) ||
        !renderer._drawing ||
        !renderer._ctx ||
        typeof renderer._fillStroke !== "function" ||
        this._empty()
      ) {
        L.CircleMarker.prototype._updatePath.call(this);
        return;
      }
      const ctx = renderer._ctx;
      const radius = renderedMarkerRadius(this._radius);
      if (!traceMarkerShape(ctx, shape, this._point.x, this._point.y, radius)) {
        L.CircleMarker.prototype._updatePath.call(this);
        return;
      }
      renderer._fillStroke(ctx, this);
    },
  });
}

// Operational layers get their category silhouette; every other marker (HATI,
// pedestrian, parks) stays a plain Leaflet circle.
function createOperationalMarker(latlng, options, type) {
  const shape = OPERATIONAL_MARKER_SHAPES[type];
  if (!ShapedCircleMarker || !shape || !shape.points) return L.circleMarker(latlng, options);
  return new ShapedCircleMarker(latlng, { ...options, markerShape: shape, lineJoin: "miter" });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    OPERATIONAL_MARKER_SHAPES,
    MARKER_SHAPE_EXTENT,
    renderedMarkerRadius,
    traceMarkerShape,
    markerShapeClipPath,
  };
}
