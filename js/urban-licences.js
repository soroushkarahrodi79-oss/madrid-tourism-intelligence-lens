// Granted urban licences: the pure model (K9, #71).
//
// WHICH GRANTED URBAN LICENCES ARE INSIDE THIS LENS, BY FAMILY AND GRANT-DATE
// WINDOW. This is an administrative-record layer, NOT a construction-progress
// layer, and this module exists to keep it that way by construction.
//
// Five things this module will not do, by the SHAPE of its API rather than by
// convention:
//
//   1. **No cross-family total.** A licence belongs to exactly one of three
//      families (building/urbanistic, activity, temporary activity). Every reader
//      returns a per-family breakdown; there is no exported function whose purpose
//      is a single `totalUrbanLicences()` / `allLicenceTotal()` /
//      `overallLicenceCount()`, and a structural test asserts none is ever added.
//      When all families are shown together each stays separately quantified.
//   2. **No approval/rejection semantics.** The register is granted-only
//      (RESOLUCION = Conceder). There is no applications/refusals denominator, so
//      nothing here computes an approval rate, rejection rate, refusal count or
//      success rate.
//   3. **No construction semantics.** A granted licence means an administrative
//      grant was recorded. It is never evidence that work started, construction
//      occurred or completed, occupancy happened, or the permitted quantity was
//      built. The interpretation ceiling rides on every view this module returns.
//   4. **No density/surface.** The layer is points only: counts of records inside
//      the Lens circle. No heatmap, density, interpolation, choropleth, kernel or
//      per-area intensity is computed here, and no barrio/district ranking.
//   5. **No apportionment to a barrio.** Licence counts are ADDRESS_POINT records
//      spatially included in the circle. They are never converted into a
//      barrio-level figure or compared with a barrio total without an explicit,
//      separate scope.
//
// Point-in-lens uses the SAME inclusive great-circle rule as js/lens.js
// (`distance <= radiusM`), reimplemented here so this ES module stays pure and
// unit-testable with plain `node --test`: committed artifact in, frozen view out.
// No DOM, no Leaflet, no fetch, no clock, no app-state globals.

export const ADDRESS_POINT_SCOPE = "ADDRESS_POINT";

// The three families, in a fixed display order. There is deliberately no fourth
// "all" or "total" family.
export const LICENCE_FAMILIES = Object.freeze([
  "BUILDING_URBANISTIC_LICENCE_FAMILY",
  "ACTIVITY_LICENCE_FAMILY",
  "TEMPORARY_ACTIVITY_FAMILY",
]);

// How the layer resolved for a given request. OFF, UNAVAILABLE and the two
// available states are all DIFFERENT and never collapsed:
//   OFF          — the opt-in layer is disabled; no evidence was read.
//   UNAVAILABLE  — the committed artifact is missing or unusable.
//   NO_MATCHES   — enabled, valid window, but no resolved record falls in the Lens.
//   AVAILABLE    — enabled and at least one resolved record falls in the Lens.
// An unresolved licence row is NOT a zero: it never reaches this model as a map
// record, and the coverage block reports it separately.
export const LICENCE_LAYER_STATE = Object.freeze({
  OFF: "OFF",
  UNAVAILABLE: "UNAVAILABLE",
  NO_MATCHES: "NO_MATCHES",
  AVAILABLE: "AVAILABLE",
});

export const GRANTED_ONLY_CEILING = Object.freeze({
  grantedOnly: true,
  grantIsNotBuilt:
    "Granted administrative licences. A granted licence means an administrative grant was " +
    "recorded; it is not evidence that work started, construction occurred or completed, " +
    "occupancy happened, or the permitted quantity was built.",
  noApprovalRate:
    "Granted-only universe: no application or refusal denominator, so no approval, rejection or " +
    "success rate exists.",
  noCrossFamilyTotal:
    "Building/urbanistic, activity and temporary-activity licences are three different families " +
    "and are never summed into one total.",
});

// ----------------------------------------------------------------- freeze helper

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// --------------------------------------------------------------- lens geometry

// Great-circle metres between two {lat, lon} points — the same formula and the
// same R as js/lens.js, so the Lens boundary behaves identically across the app.
function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const q =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(q));
}

// A point is inside the Lens when its distance is at most the radius: the
// boundary is INCLUSIVE, matching js/lens.js `poiStatsInLens` (`d <= radiusM`).
function insideLens(record, centre, radiusM) {
  if (!Number.isFinite(record.lat) || !Number.isFinite(record.lon)) return false;
  return haversineMeters(centre, record) <= radiusM;
}

// --------------------------------------------------------------- date window

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value) {
  return typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Clamp a requested [from, to] window to the register's actual coverage.
 *
 * `extent` is `{ min, max }` ISO dates, the real pinned register coverage. User
 * input can never exceed it: a value before `min` is raised to `min`, a value
 * after `max` is lowered to `max`, a reversed pair is swapped, and an invalid or
 * missing bound falls back to the extent bound. A same-day window is preserved.
 * There is no hidden overflow beyond the evidence coverage.
 */
export function clampWindow(from, to, extent) {
  const min = isIsoDate(extent && extent.min) ? extent.min : null;
  const max = isIsoDate(extent && extent.max) ? extent.max : null;
  if (!min || !max) return deepFreeze({ from: null, to: null, clamped: true, valid: false });

  let lo = isIsoDate(from) ? from : min;
  let hi = isIsoDate(to) ? to : max;
  if (lo > hi) [lo, hi] = [hi, lo]; // reversed input is swapped, never silently dropped
  const clampedLo = lo < min ? min : lo > max ? max : lo;
  const clampedHi = hi > max ? max : hi < min ? min : hi;
  const clamped = clampedLo !== from || clampedHi !== to;
  return deepFreeze({ from: clampedLo, to: clampedHi, clamped, valid: true });
}

/**
 * A deterministic default window: the trailing twelve months ending at the latest
 * grant date in the register, clamped to the extent. It is NEVER "all time" and
 * always resolves to exact dates (the caller renders them, never the word
 * "Recent").
 */
export function defaultWindow(extent) {
  if (!extent || !isIsoDate(extent.max) || !isIsoDate(extent.min)) {
    return deepFreeze({ from: null, to: null, valid: false });
  }
  const max = new Date(`${extent.max}T00:00:00Z`);
  const start = new Date(Date.UTC(max.getUTCFullYear() - 1, max.getUTCMonth(), max.getUTCDate() + 1));
  const startIso = start.toISOString().slice(0, 10);
  const win = clampWindow(startIso, extent.max, extent);
  return deepFreeze({ from: win.from, to: win.to, valid: win.valid });
}

function withinWindow(grantDate, window) {
  if (!window || !window.from || !window.to) return true;
  return grantDate >= window.from && grantDate <= window.to;
}

// --------------------------------------------------------------- per-family count

// A per-family breakdown object. Each family carries its OWN count; there is no
// aggregate key summing them, by construction.
function emptyPerFamily() {
  const out = {};
  for (const family of LICENCE_FAMILIES) out[family] = 0;
  return out;
}

// ------------------------------------------------------------------ core reader

/**
 * The granted licences inside a Lens circle, filtered by family and grant-date
 * window.
 *
 * `lensCircle` is `{ lat, lon, radiusM }`. `records` is the resolved-record array
 * from the committed artifact (each `{ id, family, grant_date, lat, lon, ... }`).
 * `filters` may carry `families` (an allow-list subset of LICENCE_FAMILIES) and a
 * `window` `{ from, to }` already clamped by the caller.
 *
 * Returns a frozen view with the matched `records`, a `perFamily` count object
 * (each family separately quantified — there is no cross-family total), the
 * applied `window`, and the `scope`/`ceiling`. It never returns a single summed
 * count across families.
 */
export function licencesInLens(lensCircle, records, filters = {}) {
  const lat = lensCircle && Number(lensCircle.lat);
  const lon = lensCircle && Number(lensCircle.lon);
  const radiusM = lensCircle && Number(lensCircle.radiusM);
  const window = filters.window || null;
  const allowed =
    Array.isArray(filters.families) && filters.families.length
      ? new Set(filters.families.filter((f) => LICENCE_FAMILIES.includes(f)))
      : new Set(LICENCE_FAMILIES);

  const perFamily = emptyPerFamily();
  const matched = [];
  if (
    Array.isArray(records) &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Number.isFinite(radiusM) &&
    radiusM > 0
  ) {
    const centre = { lat, lon };
    for (const record of records) {
      if (!allowed.has(record.family)) continue;
      if (!withinWindow(record.grant_date, window)) continue;
      if (!insideLens(record, centre, radiusM)) continue;
      perFamily[record.family] += 1;
      matched.push(record);
    }
    matched.sort((a, b) => (a.grant_date < b.grant_date ? 1 : a.grant_date > b.grant_date ? -1 : a.id.localeCompare(b.id)));
  }

  return deepFreeze({
    scope: ADDRESS_POINT_SCOPE,
    records: matched,
    // Per-family counts only. There is no `total`, `all`, `overall` or `sum` key:
    // the three families are never collapsed into one number.
    perFamily,
    familiesShown: [...allowed].filter((f) => LICENCE_FAMILIES.includes(f)),
    window: window ? { from: window.from, to: window.to } : null,
    ceiling: GRANTED_ONLY_CEILING,
  });
}

// ======================================================================== index

/**
 * Wrap the committed licence artifact into a layer index.
 *
 * Returns null when the artifact is missing or unusable (the caller then renders
 * the UNAVAILABLE state — distinct from an enabled layer with zero matches, and
 * distinct from the OFF state). Otherwise exposes the frozen `records`, the
 * register `dateExtent`, the per-family `families` metadata, the `coverage`
 * block, and a `view(lensCircle, filters)` reader.
 */
export function createLicenceIndex(artifact) {
  if (!artifact || typeof artifact !== "object" || !Array.isArray(artifact.records)) return null;
  if (artifact.granted_only !== true) return null;
  const extent = artifact.date_extent || null;
  if (!extent || !isIsoDate(extent.min) || !isIsoDate(extent.max)) return null;
  const records = artifact.records;
  const coverage = artifact.coverage || null;
  const families = artifact.families || null;

  return {
    records,
    dateExtent: deepFreeze({ min: extent.min, max: extent.max }),
    families,
    coverage,
    generatedAt: artifact.generated_at || null,
    interpretationCeiling: artifact.interpretation_ceiling || null,

    clampWindow(from, to) {
      return clampWindow(from, to, extent);
    },
    defaultWindow() {
      return defaultWindow(extent);
    },

    /**
     * The full layer view for a request, covering every distinct state:
     * OFF (disabled), UNAVAILABLE (handled by a null index upstream), NO_MATCHES
     * (enabled, valid window, zero records in the Lens) and AVAILABLE.
     */
    view(lensCircle, { enabled = true, families: familyFilter = null, window = null } = {}) {
      if (!enabled) {
        return deepFreeze({
          state: LICENCE_LAYER_STATE.OFF,
          records: [],
          perFamily: emptyPerFamily(),
          window: null,
          coverage,
          scope: ADDRESS_POINT_SCOPE,
          ceiling: GRANTED_ONLY_CEILING,
        });
      }
      const applied = window ? clampWindow(window.from, window.to, extent) : defaultWindow(extent);
      const reading = licencesInLens(lensCircle, records, { families: familyFilter, window: applied });
      const matchedCount = reading.records.length;
      return deepFreeze({
        state: matchedCount > 0 ? LICENCE_LAYER_STATE.AVAILABLE : LICENCE_LAYER_STATE.NO_MATCHES,
        records: reading.records,
        perFamily: reading.perFamily,
        familiesShown: reading.familiesShown,
        window: { from: applied.from, to: applied.to, clamped: applied.clamped === true },
        coverage,
        scope: ADDRESS_POINT_SCOPE,
        ceiling: GRANTED_ONLY_CEILING,
      });
    },
  };
}

/**
 * Browser convenience: fetch the committed licence artifact and build the index.
 * Points only at the committed repository path; no official service is requested.
 */
export async function loadLicenceIndex(url = "data/planning/madrid_urban_licences.json") {
  if (typeof fetch !== "function") {
    throw new Error("loadLicenceIndex requires fetch; pass data to createLicenceIndex instead");
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`urban licences: failed to load ${url} (${response.status})`);
  return createLicenceIndex(await response.json());
}
