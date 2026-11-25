// Madrid Urban Time Machine, Gate 4A: the geospatial temporal manifest. Pure: no DOM, no
// Leaflet, no clock and no network, so `node --test` covers it. Contract:
// docs/TEMPORAL_MANIFEST.md and docs/schemas/temporal-manifest.v1.schema.json.
//
// A manifest is a list of REQUESTS that describes one comparator configuration. It holds no
// imagery, no image hashes and no claim that any request will return imagery. Everything that
// can differ between two exports of the same configuration lives under `generated_at`,
// `generator` or `observed` (see `volatile_fields`).

const TEMPORAL_MANIFEST_SCHEMA = Object.freeze({
  id: "urn:madrid-urban-evidence-lens:temporal-manifest",
  version: "1.0.0",
});
// Layer titles exactly as the IGN GetCapabilities document names them (checked 2026-11-25).
const TM_SERVICE_TITLES = Object.freeze({
  "AMS_1956-1957": "Americano (Serie B, 1956-1957)",
  OLISTAT: "OLISTAT (1997-1998)",
  SIGPAC: "SIGPAC (1997-2003)",
  PNOA2006: "PNOA 2006",
  PNOA2009: "PNOA 2009",
  pnoa10_2009: "PNOA10:Madrid 2009",
  PNOA2011: "PNOA 2011",
  pnoa10_2013: "PNOA10:Madrid 2013",
  PNOA2014: "PNOA 2014",
  pnoa10_2016: "PNOA10:Madrid 2016",
  PNOA2017: "PNOA 2017",
  PNOA2020: "PNOA 2020",
  PNOA2023: "PNOA 2023",
});
const TM_MAX_IMAGE_SIDE = 4096; // GetCapabilities MaxWidth / MaxHeight
const TM_FORMAT = "image/jpeg"; // what the comparator itself requests
const TM_EARTH_RADIUS = 6378137; // EPSG:3857 sphere

const TM_LIMITATIONS = Object.freeze([
  ["REQUESTS_ONLY", "This file lists requests. It holds no imagery and no image hashes, and is not materialised cartographic evidence."],
  ["NOT_PIXEL_REPRODUCIBLE", "The same request can be repeated, but the remote service may return different pixels later (reprocessing, republication, withdrawal)."],
  ["AVAILABILITY_NOT_GUARANTEED", "A URL does not mean imagery exists for this extent. The service answers HTTP 200 with a blank white JPEG outside a coverage: decode every image and treat blank areas as missing imagery, never as unchanged ground."],
  ["DISCRETE_OBSERVATIONS", "Frames are discrete official observations. Nothing between them is observed or may be interpolated."],
  ["NO_CHANGE_MEASUREMENT", "Visual differences are not measured change: resolution, season, shadows and orthorectification differ between coverages."],
  ["NO_3D", "2D orthophotos only. They are not 3D reconstructions and are not equivalent to, or co-registered by Lens with, contemporary LiDAR geometry."],
  ["REFERENCE_ONLY", "Visual reference. No Lens indicator, count or evidence record reads these images or this file."],
].map((entry) => Object.freeze(entry)));

const tmRound = (value, digits) => Number(value.toFixed(digits));

function tmMercator(lat, lon) {
  return [
    TM_EARTH_RADIUS * lon * Math.PI / 180,
    TM_EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)),
  ];
}
function tmGeographic(x, y) {
  return [
    x / TM_EARTH_RADIUS * 180 / Math.PI,
    (2 * Math.atan(Math.exp(y / TM_EARTH_RADIUS)) - Math.PI / 2) * 180 / Math.PI,
  ];
}

// Centre + zoom + viewport size (Web Mercator, 256 px tiles) -> the one extent and image size
// that every frame of the sequence shares.
function tmView({ centre, zoom, size }) {
  const resolution = 2 * Math.PI * TM_EARTH_RADIUS / (256 * 2 ** zoom);
  // The published (rounded) centre is the one used, so the extent can be recomputed from the file.
  const lat = tmRound(centre.lat, 7);
  const lon = tmRound(centre.lon, 7);
  const [cx, cy] = tmMercator(lat, lon);
  const halfW = size.width * resolution / 2;
  const halfH = size.height * resolution / 2;
  const bbox = [cx - halfW, cy - halfH, cx + halfW, cy + halfH].map((v) => tmRound(v, 3));
  const scale = Math.min(1, TM_MAX_IMAGE_SIDE / Math.max(size.width, size.height));
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  const unitsPerPixel = (bbox[2] - bbox[0]) / width;
  const [west, south] = tmGeographic(bbox[0], bbox[1]);
  const [east, north] = tmGeographic(bbox[2], bbox[3]);
  return {
    view: {
      crs: "EPSG:3857",
      axis_order: ["easting", "northing"],
      units: "Web Mercator metres (not ground metres)",
      bbox,
      bbox_geographic: { crs: "CRS:84", axis_order: ["longitude", "latitude"], bbox: [west, south, east, north].map((v) => tmRound(v, 7)) },
      centre: { crs: "CRS:84", longitude: lon, latitude: lat },
      zoom,
    },
    image: {
      width,
      height,
      format: TM_FORMAT,
      mercator_units_per_pixel: tmRound(unitsPerPixel, 6),
      // Ground spacing of the REQUESTED pixels at the centre latitude, not the product's resolution.
      requested_ground_m_per_pixel: tmRound(unitsPerPixel * Math.cos(lat * Math.PI / 180), 4),
    },
  };
}

function tmGetMapUrl(wmsUrl, layer, view, image) {
  const params = new URLSearchParams({
    service: "WMS",
    version: "1.3.0",
    request: "GetMap",
    layers: layer,
    styles: "",
    format: image.format,
    transparent: "false",
    crs: view.crs,
    bbox: view.bbox.join(","),
    width: String(image.width),
    height: String(image.height),
  });
  return `${wmsUrl}?${params}`;
}

function tmCoverage(cov, wmsUrl, view, image) {
  const limitations = [];
  if (cov.when === "annual") limitations.push("ANNUAL_YEAR_ONLY_NO_ACQUISITION_DAY");
  else limitations.push("MULTI_YEAR_FLIGHT_DATE_VARIES_BY_AREA");
  if (cov.resConflict) limitations.push("RESOLUTION_UNCERTAIN_LAYER_ABSTRACT_IMPLIES_1_M");
  if (cov.extent === "city") limitations.push("MADRID_CITY_FOOTPRINT_ONLY");
  if (image.requested_ground_m_per_pixel < cov.res_m) limitations.push("REQUEST_FINER_THAN_NOMINAL_RESOLUTION");
  const when = cov.when === "annual" ? "mosaico anual" : `vuelo ${cov.from}–${cov.to}`;
  return {
    coverage_id: cov.id,
    layer: cov.layer,
    service_layer_title: TM_SERVICE_TITLES[cov.layer] ?? null,
    product: cov.product,
    date: {
      kind: cov.when === "annual" ? "annual_mosaic" : "multi_year_flight",
      start_year: cov.from,
      end_year: cov.to,
      label: cov.label,
    },
    nominal_resolution_m: cov.res_m,
    documented_extent: cov.extent === "city" ? "madrid_city" : "comunidad_de_madrid_test_points",
    attribution: `${cov.product} (${when}) cedido por © Instituto Geográfico Nacional de España · CC BY 4.0 scne.es`,
    limitations,
    getmap_url: tmGetMapUrl(wmsUrl, cov.layer, view, image),
  };
}

// input: { generatedAt, generator: { asset_version, deployment_commit }, wmsUrl,
//   centre: { lat, lon }, zoom, size: { width, height }, dividerFraction,
//   pair: { left, right }, varyingSide, includeCity, dwellMs,
//   observed: { sides: { left, right }, playbackPhase, pending: { coverage_id, loaded } | null } }
// Reads its input only. `deps` is the catalogue module (js/historical-url.js); in the browser
// its declarations are already in scope.
function buildTemporalManifest(input, deps) {
  const H = deps || { histCoverage, histSeries, histPlaySequence, HIST_URL_BOUNDS };
  const { view, image } = tmView(input);
  const referenceSide = input.varyingSide === "left" ? "right" : "left";
  const coverage = (id) => tmCoverage(H.histCoverage(id), input.wmsUrl, view, image);
  const referenceId = input.pair[referenceSide];
  const B = H.HIST_URL_BOUNDS;
  const [west, south, east, north] = view.bbox_geographic.bbox;
  return {
    schema: { ...TEMPORAL_MANIFEST_SCHEMA },
    generated_at: input.generatedAt,
    generator: {
      application: "Madrid Urban Evidence Lens",
      asset_version: input.generator.asset_version,
      deployment_commit: input.generator.deployment_commit ?? null,
    },
    volatile_fields: ["generated_at", "generator", "observed"],
    view: {
      ...view,
      // The frame the comparator's imagery checks and shared links cover (a rectangle, not
      // the administrative boundary).
      verified_frame: {
        crs: "CRS:84",
        bbox: [B.minLon, B.minLat, B.maxLon, B.maxLat],
        contains_centre: input.centre.lat >= B.minLat && input.centre.lat <= B.maxLat && input.centre.lon >= B.minLon && input.centre.lon <= B.maxLon,
        contains_bbox: south >= B.minLat && north <= B.maxLat && west >= B.minLon && east <= B.maxLon,
      },
    },
    image,
    display: {
      divider_fraction: tmRound(input.dividerFraction, 4),
      reference_side: referenceSide,
      varying_side: input.varyingSide,
      dwell_ms: input.dwellMs,
      include_10cm_city_coverages: input.includeCity,
    },
    service: {
      type: "OGC WMS",
      version: "1.3.0",
      url: input.wmsUrl,
      operation: "GetMap",
      crs: view.crs,
      format: image.format,
      max_width: TM_MAX_IMAGE_SIDE,
      max_height: TM_MAX_IMAGE_SIDE,
      capabilities_checked: "2026-11-25",
      provider: "Instituto Geográfico Nacional de España",
      licence: { name: "CC BY 4.0 scne.es", scope: "declared service-wide (AccessConstraints); not verified layer by layer", url: "https://www.scne.es" },
    },
    reference: coverage(referenceId),
    sequence: {
      order: "ascending first year, then last year, then region-wide before the 10 cm city product; the reference coverage is excluded; no looping",
      frames: H.histPlaySequence(H.histSeries({ includeCity: input.includeCity }), referenceId).map(coverage),
    },
    // What the reader's browser had at export time, for the on-screen tiles of this view. It is
    // not an availability statement about the GetMap URLs above, nor about any other coverage.
    observed: {
      scope: "on-screen map tiles at export time",
      visible: {
        left: { coverage_id: input.pair.left, tile_state: input.observed.sides.left },
        right: { coverage_id: input.pair.right, tile_state: input.observed.sides.right },
      },
      playback_phase: input.observed.playbackPhase,
      // Requested invisibly by playback and NOT on screen.
      pending_next: input.observed.pending ? { ...input.observed.pending } : null,
    },
    limitations: TM_LIMITATIONS.map(([code, text]) => ({ code, text })),
  };
}

function temporalManifestFileName(manifest) {
  const { centre, zoom } = manifest.view;
  const stamp = manifest.generated_at.replace(/[-:]/g, "").replace(/\.\d+/, "");
  return `madrid-temporal-manifest_${manifest.reference.coverage_id}-ref_z${zoom}_${centre.latitude.toFixed(4)}_${centre.longitude.toFixed(4)}_${stamp}.json`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TEMPORAL_MANIFEST_SCHEMA,
    TM_SERVICE_TITLES,
    TM_MAX_IMAGE_SIDE,
    TM_LIMITATIONS,
    tmView,
    tmGetMapUrl,
    buildTemporalManifest,
    temporalManifestFileName,
  };
}
