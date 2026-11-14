// HATI-Madrid evidence layer: bounded, model-derived, non-interpolated.
// This module never estimates a UTCI value for a location without a sample;
// it only reports descriptive statistics over whatever HATI samples fall
// inside a lens, or an explicit "no evidence" state.

const HATI_SUPPORTED_TIMESTEPS = ["12:00", "15:00", "18:00"];
const HATI_STUDY_DATE = "2023-08-21";

function utciCategoryColor(v) {
  if (v == null) return "#63d3b1";
  if (v >= 46) return "#ef4c58"; // Extreme heat stress
  if (v >= 38) return "#ff875d"; // Very strong heat stress
  if (v >= 32) return "#ffc765"; // Strong heat stress
  return "#63d3b1"; // Moderate or below
}

function hatiPointFor(asset, timestep) {
  return {
    id: `heat-${asset.id}`,
    type: "heat",
    name: asset.name,
    lat: asset.lat,
    lon: asset.lon,
    utci: asset.utci_mean_10m[timestep],
    utciCategory: asset.utci_category[timestep],
    provenance: "hati-model",
  };
}

// Descriptive statistics only: count and mean of whatever HATI samples fall
// inside the analysis geometry at the selected timestep. Returns evidence:"NONE"
// rather than a fabricated value when the geometry contains zero samples.
//
// HATI assets are POINT observations, so they are exactly clippable by any
// analysis geometry — a circle or a custom polygon. `containsFn` and `distanceFn`
// are injected so this module keeps no dependency on the Lens model; the caller
// passes js/lens.js geometryContainsPoint and haversineMeters. Membership is
// decided by containsFn ALONE; `d` is attached only so a sample can be reported
// with its distance from the geometry's reference point.
function hatiStatsInGeometry(hatiAssets, timestep, geometry, containsFn, distanceFn, referencePoint) {
  const inside = (hatiAssets || [])
    .filter((a) => containsFn(geometry, a))
    .map((a) => ({ ...a, d: referencePoint ? distanceFn(referencePoint, a) : null }))
    .map((a) => ({ ...a, utci: a.utci_mean_10m[timestep] }))
    .filter((a) => Number.isFinite(a.utci));

  if (!inside.length) {
    return { evidence: "NONE", count: 0, mean: null, samples: [] };
  }
  const mean = inside.reduce((s, a) => s + a.utci, 0) / inside.length;
  return { evidence: "MODEL-DERIVED", count: inside.length, mean, samples: inside };
}

// The circular entry point, unchanged.
function hatiStatsInLens(hatiAssets, timestep, center, radiusM, distanceFn) {
  const inside = hatiAssets
    .map((a) => ({ ...a, d: distanceFn(center, a) }))
    .filter((a) => a.d <= radiusM)
    .map((a) => ({ ...a, utci: a.utci_mean_10m[timestep] }))
    .filter((a) => Number.isFinite(a.utci));

  if (!inside.length) {
    return { evidence: "NONE", count: 0, mean: null, samples: [] };
  }
  const mean = inside.reduce((s, a) => s + a.utci, 0) / inside.length;
  return { evidence: "MODEL-DERIVED", count: inside.length, mean, samples: inside };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HATI_SUPPORTED_TIMESTEPS,
    HATI_STUDY_DATE,
    utciCategoryColor,
    hatiPointFor,
    hatiStatsInLens,
    hatiStatsInGeometry,
  };
}
