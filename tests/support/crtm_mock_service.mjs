// Deterministic stand-in for a CRTM ArcGIS FeatureServer layer (F-02 tests only).
// It answers exactly the request shapes scripts/crtm_reconciliation.mjs issues and
// lets a test alter any one response, or the service state between requests.
// Nothing here touches the network.

const EDIT_DATE = Date.UTC(2026, 8, 1); // 2026-09-01T00:00:00Z

export function defaultFeatures(mode, n) {
  return Array.from({ length: n }, (_, i) => ({
    type: "Feature",
    id: i + 1,
    geometry: { type: "Point", coordinates: [-3.7 + i * 0.0002, 40.42 + (i % 7) * 0.001] },
    properties: { IDESTACION: `${mode}-${i}`, DENOMINACION: `${mode} ${i}`, LINEAS: "1" },
  }));
}

/**
 * @param {object} options
 * @param {string} [options.mode]
 * @param {number} [options.n]       number of stations the service holds in the rectangle
 * @param {object} [options.hooks]   { meta|count|ids|geojson|enum: (body, callNumber, url) => body } (may throw)
 * @param {number} [options.editedAt]
 */
export function makeCrtmService({ mode = "metro", n = 138, hooks = {}, editedAt = EDIT_DATE } = {}) {
  const calls = [];
  const seen = {};
  const features = defaultFeatures(mode, n);
  const bodyFor = (kind, url) => {
    switch (kind) {
      case "meta":
        return {
          name: mode, type: "Feature Layer", maxRecordCount: 1000,
          fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }, { name: "IDESTACION", type: "esriFieldTypeString" }],
          editingInfo: { dataLastEditDate: editedAt, lastEditDate: editedAt },
        };
      case "count": return { count: n };
      case "ids": return { objectIdFieldName: "OBJECTID", objectIds: features.map((f) => f.id) };
      case "enum": return { objectIdFieldName: "OBJECTID", features: features.map((f) => ({ attributes: { OBJECTID: f.id } })) };
      default: return { type: "FeatureCollection", features: structuredClone(features) };
    }
  };
  async function fetchJson(url) {
    const u = new URL(url);
    const p = u.searchParams;
    const kind = !u.pathname.endsWith("/query") ? "meta"
      : p.get("returnCountOnly") === "true" ? "count"
      : p.get("returnIdsOnly") === "true" ? "ids"
      : p.get("f") === "geojson" ? "geojson"
      : "enum";
    seen[kind] = (seen[kind] ?? 0) + 1;
    calls.push({ kind, url, n: seen[kind] });
    const body = bodyFor(kind, url);
    return hooks[kind] ? hooks[kind](body, seen[kind], url) : body;
  }
  return { fetchJson, calls, features };
}

/** A fetch-like router for the whole builder: one mock per CRTM service, everything else 503. */
export function makeCrtmRouter({ metro = {}, cercanias = {} } = {}) {
  const services = {
    M4_Red: makeCrtmService({ mode: "metro", n: 138, ...metro }),
    M5_Red: makeCrtmService({ mode: "cercanias", n: 10, ...cercanias }),
  };
  return {
    services,
    async route(url) {
      const hit = Object.entries(services).find(([name]) => url.includes(`/${name}/FeatureServer/0`));
      return hit ? hit[1].fetchJson(url) : null;
    },
  };
}
