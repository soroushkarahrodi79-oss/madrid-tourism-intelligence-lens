/* Madrid Network Accessibility Explorer (V0.1)
 *
 * A standalone, static viewer for the committed pilot results. It is NOT part of
 * the Madrid Urban Evidence Lens: it shares no state, no module and no stylesheet
 * with the application, and borrows only the vendored Leaflet build.
 *
 * Contract this file holds itself to:
 *
 *  1. Every displayed number is read from a committed artifact at runtime. The
 *     only hardcoded numbers in this file are the classification thresholds, and
 *     those are a presentation choice declared in CLASS_BREAKS and shown in the UI.
 *  2. A missing observation is never turned into a number. The CSV publishes an
 *     empty field for "not observed"; parseNumber() maps that to null and the UI
 *     renders N/A. A published 0.0 is a real zero and stays one.
 *  3. No route geometry. The pilot publishes distances, not paths, so nothing here
 *     draws a line between a portal and a facility. See the V0.1 scope note in
 *     README.md.
 */

(function () {
  "use strict";

  // ------------------------------------------------------------------ paths

  // Relative to this file, so the viewer works under any static server root.
  const PATHS = Object.freeze({
    portalCoordinates: "data/portal_coordinates.csv",
    studyBarrio: "data/study_barrio.geojson",
    manifest: "data/build_manifest.json",
    distances: "../results/origin_facility_distances.csv",
    facilities: "../results/facility_access_points.geojson",
    report: "../results/pilot_report.json",
  });

  // ------------------------------------------------------- classification

  // Sequential schemes from ColorBrewer (Harrower & Brewer 2003), chosen because
  // they are perceptually ordered and colour-vision-safe. Two different hue
  // families keep view A and view B from being mistaken for each other.
  const YL_OR_RD_5 = ["#ffffb2", "#fecc5c", "#fd8d3c", "#f03b20", "#bd0026"];
  const PURPLES_5 = ["#dadaeb", "#bcbddc", "#9e9ac8", "#756bb1", "#54278f"];

  const COLOUR_AGREE = "#2b6a8f";
  const COLOUR_DISAGREE = "#c8552a";
  const COLOUR_UNDEFINED = "#cfd3d6";
  const COLOUR_UNMEASURED = "#8b9298";

  // Round breaks, fixed in advance of looking at any map, so the classification
  // cannot be tuned to make a pattern appear. Both sets straddle the published
  // baseline median, which the UI states next to the legend.
  const CLASS_BREAKS = Object.freeze({
    understatement: Object.freeze([25, 50, 100, 200]),
    detour: Object.freeze([1.1, 1.25, 1.5, 2.0]),
  });

  const VIEWS = Object.freeze({
    understatement: {
      id: "understatement",
      title: "Distance understatement",
      definition:
        "<strong>Distance understatement</strong> is the shortest modelled network " +
        "distance minus the straight-line distance to the <em>nearest</em> facility, " +
        "in metres: <code>network_nearest_m − euclid_nearest_m</code>. It is how many " +
        "metres a straight line omits. Because the two methods may pick different " +
        "facilities, this is <em>not</em> a measure of circuity — that is view B.",
      field: "understatementM",
      colours: YL_OR_RD_5,
      breaks: CLASS_BREAKS.understatement,
      format: (value) => `${formatNumber(value, 1)} m`,
      thresholdNote: (report) =>
        "Breaks at 25 / 50 / 100 / 200 m. Published baseline <em>mean</em> " +
        `understatement is ${formatNumber(meanUnderstatement(report), 1)} m. ` +
        "The pilot publishes no median understatement, and the difference of the " +
        "two published medians is not one.",
    },
    detour: {
      id: "detour",
      title: "Detour ratio",
      definition:
        "<strong>Detour ratio</strong> is the published circuity to <em>one and the " +
        "same</em> facility: <code>network_nearest_m ÷ euclid_to_network_nearest_m</code>. " +
        "1.0 would mean the modelled walk is as short as the straight line. The pilot " +
        "reports it only where the straight-line separation is at least 1 m, the " +
        "precision bound of the published coordinates; below that it is not " +
        "interpretable and is shown as N/A.",
      field: "detourRatio",
      colours: PURPLES_5,
      breaks: CLASS_BREAKS.detour,
      format: (value) => `×${formatNumber(value, 3)}`,
      thresholdNote: (report) =>
        "Breaks at 1.1 / 1.25 / 1.5 / 2.0. Published baseline median detour ratio " +
        `is ×${formatNumber(
          path(report, ["s4_results_baseline", "detour_ratio_to_network_nearest", "p50"]),
          4
        )}.`,
    },
    agreement: {
      id: "agreement",
      title: "Nearest-facility disagreement",
      definition:
        "<strong>Nearest-facility disagreement</strong> marks the portals where " +
        "<code>euclid_nearest_facility ≠ network_nearest_facility</code>: the two " +
        "methods name a different facility as the closest one. This is a descriptive " +
        "comparison of two measurement methods. It ranks neither facilities nor " +
        "neighbourhoods, and it says nothing about facility quality.",
      field: null,
      colours: null,
      breaks: null,
      format: null,
      thresholdNote: (report) => {
        const d = path(report, [
          "s4_results_baseline",
          "nearest_facility_discordance",
        ]);
        if (!d) return "";
        return (
          `Published baseline: ${formatInt(d.origins_where_euclid_and_network_disagree)} of ` +
          `${formatInt(d.denominator_n)} measured portals disagree (${formatNumber(
            d.share_pct,
            2
          )}%). Over all ${formatInt(d.all_selected_origins_n)} selected portals the ` +
          `share is ${formatNumber(d.share_of_all_selected_origins_pct, 2)}%.`
        );
      },
    },
  });

  // -------------------------------------------------------------- utilities

  function path(object, keys) {
    let cursor = object;
    for (const key of keys) {
      if (cursor === null || cursor === undefined) return undefined;
      cursor = cursor[key];
    }
    return cursor;
  }

  function meanUnderstatement(report) {
    // The report publishes the two distance medians but not their difference, and
    // a difference of medians is NOT the median of differences. So there is no
    // published median understatement to quote: quote the mean the pilot does
    // publish, and label it as the mean.
    return path(report, ["s4_results_baseline", "mean_understatement_m"]);
  }

  /** Minimal RFC 4180 parser. The pilot's CSVs are unquoted today; this keeps a
   *  future quoted field from silently shifting every column. */
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

    for (let i = 0; i < body.length; i += 1) {
      const char = body[i];
      if (quoted) {
        if (char === '"') {
          if (body[i + 1] === '"') {
            field += '"';
            i += 1;
          } else {
            quoted = false;
          }
        } else {
          field += char;
        }
        continue;
      }
      if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && body[i + 1] === "\n") i += 1;
        row.push(field);
        field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else {
        field += char;
      }
    }
    if (field !== "" || row.length) {
      row.push(field);
      if (row.length > 1 || row[0] !== "") rows.push(row);
    }

    const header = rows.shift();
    if (!header) throw new Error("empty CSV");
    return rows.map((values) => {
      const record = Object.create(null);
      header.forEach((name, index) => {
        record[name] = values[index] === undefined ? "" : values[index];
      });
      return record;
    });
  }

  /** "" means NOT OBSERVED and becomes null. "0.0" is a real zero. */
  function parseNumber(raw) {
    if (raw === undefined || raw === null) return null;
    const text = String(raw).trim();
    if (text === "") return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  }

  /** "" means NOT OBSERVED and becomes null. */
  function parseBoolean(raw) {
    const text = String(raw === undefined || raw === null ? "" : raw).trim();
    if (text === "") return null;
    if (text === "True" || text === "true") return true;
    if (text === "False" || text === "false") return false;
    return null;
  }

  function formatNumber(value, decimals) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
    return value.toLocaleString("en-GB", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function formatInt(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
    return value.toLocaleString("en-GB");
  }

  function classIndex(value, breaks) {
    for (let i = 0; i < breaks.length; i += 1) {
      if (value < breaks[i]) return i;
    }
    return breaks.length;
  }

  function classLabels(breaks, unit) {
    const labels = [];
    labels.push(`< ${breaks[0]}${unit}`);
    for (let i = 0; i < breaks.length - 1; i += 1) {
      labels.push(`${breaks[i]} – ${breaks[i + 1]}${unit}`);
    }
    labels.push(`≥ ${breaks[breaks.length - 1]}${unit}`);
    return labels;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  async function fetchText(url) {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
    return response.text();
  }

  async function fetchJson(url) {
    return JSON.parse(await fetchText(url));
  }

  // ------------------------------------------------------------- map icons

  const facilityIcon = (inside) =>
    L.divIcon({
      className: "facility-icon",
      iconSize: [16, 15],
      iconAnchor: [8, 14],
      html:
        '<svg width="16" height="15" viewBox="0 0 16 15" aria-hidden="true">' +
        `<path d="M8 1 L15 14 L1 14 Z" fill="${inside ? "#17191c" : "#ffffff"}" ` +
        `stroke="${inside ? "#ffffff" : "#17191c"}" stroke-width="1.6" ` +
        'stroke-linejoin="round"/></svg>',
    });

  const unmeasuredIcon = L.divIcon({
    className: "unmeasured-icon",
    iconSize: [13, 13],
    iconAnchor: [6.5, 6.5],
    html:
      '<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">' +
      `<rect x="2.3" y="2.3" width="8.4" height="8.4" transform="rotate(45 6.5 6.5)" ` +
      `fill="#ffffff" stroke="${COLOUR_UNMEASURED}" stroke-width="1.7"/></svg>`,
  });

  // ------------------------------------------------------------ application

  const state = {
    view: "understatement",
    portals: [],
    byCode: new Map(),
    facilitiesById: new Map(),
    report: null,
    manifest: null,
    integrity: null,
    selected: null,
    map: null,
    layers: {},
    markerByCode: new Map(),
  };

  async function boot() {
    const [portalCsv, distanceCsv, facilities, report, barrio, manifest] =
      await Promise.all([
        fetchText(PATHS.portalCoordinates),
        fetchText(PATHS.distances),
        fetchJson(PATHS.facilities),
        fetchJson(PATHS.report),
        fetchJson(PATHS.studyBarrio),
        fetchJson(PATHS.manifest),
      ]);

    state.report = report;
    state.manifest = manifest;

    facilities.features.forEach((feature) => {
      state.facilitiesById.set(String(feature.properties.access_point_id), feature);
    });

    const coordinates = new Map();
    parseCsv(portalCsv).forEach((row) => {
      coordinates.set(String(row.cod_ndp), {
        lon: parseNumber(row.lon),
        lat: parseNumber(row.lat),
      });
    });

    const unjoined = [];
    state.portals = parseCsv(distanceCsv).map((row) => {
      const code = String(row.cod_ndp);
      const position = coordinates.get(code);
      if (!position) unjoined.push(code);
      const portal = {
        code,
        address: row.address,
        lat: position ? position.lat : null,
        lon: position ? position.lon : null,
        state: row.state,
        measured: row.state === "MEASURED",
        snapOffsetM: parseNumber(row.snap_offset_m),
        euclidFacility: row.euclid_nearest_facility || null,
        euclidM: parseNumber(row.euclid_nearest_m),
        networkFacility: row.network_nearest_facility || null,
        networkM: parseNumber(row.network_nearest_m),
        euclidToNetworkM: parseNumber(row.euclid_to_network_nearest_m),
        ratioDefined: parseBoolean(row.ratio_defined),
        detourRatio: parseNumber(row.detour_ratio),
        understatementRatio: parseNumber(row.understatement_ratio),
        understatementM: parseNumber(row.understatement_m),
        agrees: parseBoolean(row.agrees_with_euclid_nearest),
      };
      state.byCode.set(code, portal);
      return portal;
    });

    state.integrity = checkIntegrity(unjoined, coordinates.size, facilities);

    buildMap(barrio, facilities);
    renderStats();
    renderIntegrity();
    renderLimits();
    renderProvenance();
    wireControls();
    setView(state.view);

    document.getElementById("app").dataset.ready = "true";
  }

  // ------------------------------------------------------------- integrity

  function checkIntegrity(unjoined, coordinateCount, facilities) {
    const expected = state.manifest.expected_from_pilot_report;
    const counts = { MEASURED: 0, NOT_SNAPPED: 0, UNREACHABLE: 0 };
    let disagreements = 0;
    let ratioDefined = 0;
    let ratioExcluded = 0;
    let leakedMeasurements = 0;
    let missingCoordinates = 0;
    let outOfBounds = 0;
    let coercionRisk = 0;

    const bounds = state.manifest.bounds_wgs84;

    state.portals.forEach((portal) => {
      if (counts[portal.state] === undefined) counts[portal.state] = 0;
      counts[portal.state] += 1;

      if (portal.agrees === false) disagreements += 1;
      if (portal.ratioDefined === true) ratioDefined += 1;
      if (portal.ratioDefined === false) ratioExcluded += 1;

      // Criterion E, first half: an unmeasured portal must carry no
      // network-derived value at all.
      if (!portal.measured) {
        const networkDerived = [
          portal.networkM,
          portal.euclidToNetworkM,
          portal.detourRatio,
          portal.understatementM,
          portal.understatementRatio,
        ];
        if (networkDerived.some((value) => value !== null)) leakedMeasurements += 1;
        if (portal.networkFacility !== null) leakedMeasurements += 1;
        if (portal.agrees !== null) leakedMeasurements += 1;
      }

      // Criterion E, second half: nothing missing may have become a number.
      // A null must stay null; it must never read as 0.
      if (portal.ratioDefined !== true && portal.detourRatio !== null) coercionRisk += 1;

      if (portal.lat === null || portal.lon === null) {
        missingCoordinates += 1;
      } else if (
        portal.lon < bounds.lon_min ||
        portal.lon > bounds.lon_max ||
        portal.lat < bounds.lat_min ||
        portal.lat > bounds.lat_max
      ) {
        outOfBounds += 1;
      }
    });

    const checks = [
      ["portals joined 1:1 on cod_ndp", unjoined.length === 0 && coordinateCount === state.portals.length],
      [`portals total = ${formatInt(expected.origins_total)}`, state.portals.length === expected.origins_total],
      [`measured = ${formatInt(expected.origins_measured)}`, counts.MEASURED === expected.origins_measured],
      [`not snapped = ${formatInt(expected.origins_not_snapped)}`, counts.NOT_SNAPPED === expected.origins_not_snapped],
      [`unreachable = ${formatInt(expected.origins_unreachable)}`, counts.UNREACHABLE === expected.origins_unreachable],
      [`facility access points = ${formatInt(expected.facilities_seeded)}`, facilities.features.length === expected.facilities_seeded],
      [`nearest-facility disagreements = ${formatInt(expected.nearest_facility_disagreements)}`, disagreements === expected.nearest_facility_disagreements],
      [`detour ratio defined = ${formatInt(expected.ratio_defined_pairs)}`, ratioDefined === expected.ratio_defined_pairs],
      [`detour ratio excluded = ${formatInt(expected.ratio_excluded_pairs)}`, ratioExcluded === expected.ratio_excluded_pairs],
      ["every coordinate present and inside the published bounds", missingCoordinates === 0 && outOfBounds === 0],
      ["no network measurement on an unmeasured portal", leakedMeasurements === 0],
      ["no missing value coerced to a number", coercionRisk === 0],
    ];

    const failed = checks.filter(([, ok]) => !ok).map(([label]) => label);
    return {
      checks,
      failed,
      pass: failed.length === 0,
      counts,
      disagreements,
      ratioDefined,
      ratioExcluded,
      unjoined,
    };
  }

  // ------------------------------------------------------------------- map

  function buildMap(barrio, facilities) {
    const map = L.map("map", {
      preferCanvas: true,
      zoomControl: true,
      attributionControl: true,
    });
    state.map = map;

    // OpenStreetMap standard tiles: keyless, and already the fallback basemap this
    // repository uses, so the viewer adds no new third-party service. CARTO's
    // light_all endpoints now answer every request with an "API KEY REQUIRED"
    // placeholder tile, so they are not usable here.
    //
    // The raster is desaturated in CSS (.basemap-tiles) purely for legibility:
    // the standard style is designed to be read on its own, and at full
    // saturation it competes with the sequential point colours. That is a
    // presentation choice on the basemap only and touches no published value.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      className: "basemap-tiles",
      attribution:
        'Basemap &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
        "contributors &middot; " +
        "Portals &amp; facilities: Ayuntamiento de Madrid (CC BY 4.0) &middot; " +
        "Network distances derived from OpenStreetMap (ODbL 1.0)",
    }).addTo(map);

    state.layers.barrio = L.geoJSON(barrio, {
      style: {
        color: "#17191c",
        weight: 1.6,
        opacity: 0.85,
        fill: true,
        fillColor: "#17191c",
        fillOpacity: 0.03,
        dashArray: "5 3",
        interactive: false,
      },
    }).addTo(map);

    // One shared canvas renderer for ~2,636 points. Canvas keeps this to a single
    // DOM node instead of thousands of SVG paths; no clustering library is needed
    // at this count, and clustering would hide exactly the spatial detail the
    // three views exist to show.
    const renderer = L.canvas({ padding: 0.3 });
    state.layers.portals = L.layerGroup().addTo(map);
    state.layers.unmeasured = L.layerGroup().addTo(map);

    state.portals.forEach((portal) => {
      if (portal.lat === null || portal.lon === null) return;

      if (!portal.measured) {
        const marker = L.marker([portal.lat, portal.lon], {
          icon: unmeasuredIcon,
          keyboard: true,
          title: `${portal.address} — ${portal.state}`,
          alt: `Unmeasured portal ${portal.address}, ${portal.state}`,
        });
        marker.on("click keypress", () => selectPortal(portal.code));
        marker.addTo(state.layers.unmeasured);
        state.markerByCode.set(portal.code, marker);
        return;
      }

      const marker = L.circleMarker([portal.lat, portal.lon], {
        renderer,
        radius: radiusForZoom(14),
        weight: 0.7,
        color: "rgba(23,25,28,0.65)",
        fillColor: COLOUR_UNDEFINED,
        fillOpacity: 0.92,
      });
      marker.on("click", () => selectPortal(portal.code));
      marker.addTo(state.layers.portals);
      state.markerByCode.set(portal.code, marker);
    });

    state.layers.facilities = L.layerGroup().addTo(map);
    facilities.features.forEach((feature) => {
      const [lon, lat] = feature.geometry.coordinates;
      const inside = Boolean(feature.properties.inside_study_barrio);
      const marker = L.marker([lat, lon], {
        icon: facilityIcon(inside),
        keyboard: true,
        riseOnHover: true,
        title: feature.properties.title,
        alt: `Facility access point: ${feature.properties.title}`,
      });
      marker.bindPopup(facilityPopup(feature), {
        maxWidth: 290,
        className: "facility-popup",
      });
      marker.addTo(state.layers.facilities);
    });

    state.layers.selection = L.layerGroup().addTo(map);

    map.on("zoomend", () => {
      const radius = radiusForZoom(map.getZoom());
      state.layers.portals.eachLayer((layer) => layer.setRadius(radius));
    });

    resetExtent();
  }

  function radiusForZoom(zoom) {
    if (zoom <= 13) return 1.8;
    if (zoom === 14) return 2.5;
    if (zoom === 15) return 3.2;
    if (zoom === 16) return 4.1;
    if (zoom === 17) return 5.2;
    return 6.4;
  }

  function resetExtent() {
    const bounds = state.layers.barrio.getBounds();
    state.map.fitBounds(bounds, { padding: [18, 18] });
  }

  function facilityPopup(feature) {
    const properties = feature.properties;
    const [lon, lat] = feature.geometry.coordinates;
    const subtypes = (properties.subtypes || []).join(", ") || "N/A";
    return (
      `<strong>${escapeHtml(properties.title)}</strong>` +
      `<div style="font-family:var(--font-mono);font-size:11px;color:#6d747c;margin:2px 0 6px">` +
      `access_point_id ${escapeHtml(String(properties.access_point_id))}</div>` +
      `<div style="font-size:12px">Register subtypes: ${escapeHtml(subtypes)}</div>` +
      `<div style="font-size:12px">Collapsed register rows: ${formatInt(properties.record_count)}</div>` +
      `<div style="font-size:12px">Inside study barrio: ${properties.inside_study_barrio ? "yes" : "no — within the 1,000 m catchment"}</div>` +
      `<div style="font-size:12px">Published coordinate: ${formatNumber(lat, 7)}, ${formatNumber(lon, 7)}</div>` +
      `<div style="font-size:11px;color:#7a3a10;margin-top:6px">` +
      "This is the coordinate the municipal register publishes, <strong>not a surveyed " +
      "entrance</strong>. Where the real entrance is elsewhere, every distance to it is " +
      "wrong by an amount this pilot cannot bound.</div>"
    );
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (char) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  // ----------------------------------------------------------------- views

  function colourFor(portal, view) {
    if (!portal.measured) return COLOUR_UNMEASURED;

    if (view.id === "agreement") {
      if (portal.agrees === null) return COLOUR_UNMEASURED;
      return portal.agrees ? COLOUR_AGREE : COLOUR_DISAGREE;
    }

    if (view.id === "detour" && portal.ratioDefined !== true) return COLOUR_UNDEFINED;

    const value = portal[view.field];
    if (value === null) return COLOUR_UNDEFINED;
    return view.colours[classIndex(value, view.breaks)];
  }

  function setView(viewId) {
    const view = VIEWS[viewId];
    if (!view) return;
    state.view = viewId;

    document.querySelectorAll(".viewpicker__btn").forEach((button) => {
      button.setAttribute("aria-checked", String(button.dataset.view === viewId));
    });
    document.getElementById("view-definition").innerHTML = view.definition;

    state.portals.forEach((portal) => {
      if (!portal.measured) return;
      const marker = state.markerByCode.get(portal.code);
      if (marker && marker.setStyle) marker.setStyle({ fillColor: colourFor(portal, view) });
    });

    renderLegend(view);
    if (state.selected) renderInspector(state.byCode.get(state.selected));
  }

  function renderLegend(view) {
    const list = document.getElementById("legend");
    list.textContent = "";

    const add = (colour, label, count, modifier) => {
      const item = element("li");
      const swatch = element("span", `swatch${modifier ? ` ${modifier}` : ""}`);
      if (!modifier) swatch.style.background = colour;
      item.appendChild(swatch);
      item.appendChild(element("span", null, label));
      if (count !== null && count !== undefined) {
        item.appendChild(element("span", "legend__count", formatInt(count)));
      }
      list.appendChild(item);
    };

    if (view.id === "agreement") {
      const agree = state.portals.filter((p) => p.agrees === true).length;
      const disagree = state.portals.filter((p) => p.agrees === false).length;
      add(COLOUR_AGREE, "Same facility is nearest by both methods", agree);
      add(COLOUR_DISAGREE, "Different facility is nearest", disagree);
    } else {
      const unit = view.id === "understatement" ? " m" : "";
      const labels = classLabels(view.breaks, unit);
      const counts = new Array(labels.length).fill(0);
      let undefinedCount = 0;

      state.portals.forEach((portal) => {
        if (!portal.measured) return;
        if (view.id === "detour" && portal.ratioDefined !== true) {
          undefinedCount += 1;
          return;
        }
        const value = portal[view.field];
        if (value === null) {
          undefinedCount += 1;
          return;
        }
        counts[classIndex(value, view.breaks)] += 1;
      });

      labels.forEach((label, index) => add(view.colours[index], label, counts[index]));
      if (undefinedCount > 0) {
        add(
          COLOUR_UNDEFINED,
          view.id === "detour" ? "Ratio not defined (N/A)" : "No value published (N/A)",
          undefinedCount
        );
      }
    }

    const unmeasured = state.portals.filter((p) => !p.measured).length;
    add(null, `Not measured — no network answer (${describeUnmeasured()})`, unmeasured, "swatch--diamond");
    add(null, "Facility access point inside the barrio", null, "swatch--facility");
    add(null, "Facility access point in the 1,000 m catchment", null, "swatch--facility-out");

    // Only formatted numbers and fixed copy reach this string; nothing here is
    // user input.
    document.getElementById("legend-thresholds").innerHTML = view.thresholdNote(
      state.report
    );
  }

  function describeUnmeasured() {
    const notSnapped = state.integrity.counts.NOT_SNAPPED || 0;
    const unreachable = state.integrity.counts.UNREACHABLE || 0;
    return `${notSnapped} NOT_SNAPPED, ${unreachable} UNREACHABLE`;
  }

  // ------------------------------------------------------------- inspector

  function selectPortal(code) {
    state.selected = code;
    const portal = state.byCode.get(code);
    renderInspector(portal);

    state.layers.selection.clearLayers();
    if (portal && portal.lat !== null && portal.lon !== null) {
      L.circleMarker([portal.lat, portal.lon], {
        radius: radiusForZoom(state.map.getZoom()) + 5,
        weight: 2,
        color: "#17191c",
        opacity: 0.95,
        fill: false,
        interactive: false,
      }).addTo(state.layers.selection);
    }
  }

  function renderInspector(portal) {
    const host = document.getElementById("inspector");
    host.textContent = "";
    if (!portal) {
      host.appendChild(
        element("p", "placeholder", "Select an address portal on the map.")
      );
      return;
    }

    host.appendChild(element("p", "inspector__head", portal.address || "N/A"));
    host.appendChild(element("p", "inspector__key", `COD_NDP ${portal.code}`));

    const badge = element(
      "span",
      `inspector__state ${portal.measured ? "state--measured" : "state--not-measured"}`,
      portal.state
    );
    host.appendChild(badge);

    const list = element("dl", "kv");

    const group = (label) => {
      const dt = element("dt", "kv kv--group", label);
      dt.className = "kv--group";
      list.appendChild(dt);
    };

    const pair = (label, html) => {
      list.appendChild(element("dt", null, label));
      const dd = element("dd");
      dd.innerHTML = html;
      list.appendChild(dd);
    };

    const naOr = (value, decimals, suffix) =>
      value === null
        ? '<span class="na">N/A</span>'
        : `${formatNumber(value, decimals)}${suffix || ""}`;

    const facilityName = (id) => {
      if (!id) return '<span class="na">N/A</span>';
      const feature = state.facilitiesById.get(String(id));
      const title = feature ? feature.properties.title : "unknown access point";
      return `${escapeHtml(title)}<br><span class="na">id ${escapeHtml(String(id))}</span>`;
    };

    group("Nearest facility by each method");
    pair("Euclidean-nearest", facilityName(portal.euclidFacility));
    pair("Network-nearest", facilityName(portal.networkFacility));
    pair(
      "Identities agree",
      portal.agrees === null
        ? '<span class="na">N/A</span>'
        : portal.agrees
        ? '<span class="yes">yes</span>'
        : '<span class="no">no</span>'
    );

    group("Published distances");
    pair("Straight-line to nearest facility", naOr(portal.euclidM, 3, " m"));
    pair("Modelled network distance", naOr(portal.networkM, 3, " m"));
    pair("Straight line to the network-nearest", naOr(portal.euclidToNetworkM, 3, " m"));
    pair("Distance understatement", naOr(portal.understatementM, 3, " m"));

    group("Published ratios");
    pair(
      "Detour ratio",
      portal.ratioDefined === true
        ? `×${formatNumber(portal.detourRatio, 5)}`
        : '<span class="na">N/A — not defined</span>'
    );
    pair(
      "Understatement ratio",
      portal.ratioDefined === true
        ? `×${formatNumber(portal.understatementRatio, 5)}`
        : '<span class="na">N/A — not defined</span>'
    );

    group("Measurement record");
    pair("State", escapeHtml(portal.state));
    pair("Snap offset to the graph", naOr(portal.snapOffsetM, 3, " m"));
    pair(
      "Official coordinate",
      `${formatNumber(portal.lat, 7)}, ${formatNumber(portal.lon, 7)}`
    );

    host.appendChild(list);

    const caveat = element("p", "inspector__caveat");
    if (portal.state === "NOT_SNAPPED") {
      caveat.textContent =
        "NOT_SNAPPED: no retained pedestrian segment lay within the snapping " +
        "tolerance, so this portal has no network answer. Its straight-line figure " +
        "is still published.";
    } else if (portal.state === "UNREACHABLE") {
      caveat.textContent =
        "UNREACHABLE: the portal snapped to the graph but no facility was reachable " +
        "from it along retained segments, so it has no network answer. Its " +
        "straight-line figure is still published.";
    } else if (portal.ratioDefined === false) {
      caveat.textContent =
        "The register publishes a facility at this portal's own coordinate, so the " +
        "straight-line separation is below the 1 m precision bound and no ratio is " +
        "interpretable. The metre figures still stand.";
    } else {
      caveat.textContent =
        "Distances are modelled along an OpenStreetMap-derived pedestrian graph and " +
        "end at a published facility coordinate, not a surveyed entrance. No walking " +
        "route is drawn because the pilot publishes no route geometry.";
    }
    host.appendChild(caveat);
  }

  // --------------------------------------------------------------- panels

  function renderStats() {
    const baseline = path(state.report, ["s4_results_baseline"]) || {};
    const discordance = baseline.nearest_facility_discordance || {};
    const host = document.getElementById("stats");
    host.textContent = "";

    const rows = [
      ["Address portals selected", formatInt(baseline.origins_total)],
      ["Measured", formatInt(baseline.origins_measured)],
      ["Not snapped / unreachable", `${formatInt(baseline.origins_not_snapped)} / ${formatInt(baseline.origins_unreachable)}`],
      ["Facility access points", formatInt(baseline.facilities_seeded)],
      ["Median straight-line distance", `${formatNumber(path(baseline, ["euclid_nearest_m", "p50"]), 1)} m`],
      ["Median network distance", `${formatNumber(path(baseline, ["network_nearest_m", "p50"]), 1)} m`],
      ["Mean understatement", `${formatNumber(baseline.mean_understatement_m, 1)} m`],
      ["Median detour ratio", `×${formatNumber(path(baseline, ["detour_ratio_to_network_nearest", "p50"]), 4)}`],
      [
        "Nearest-facility disagreement",
        `${formatInt(discordance.origins_where_euclid_and_network_disagree)} of ${formatInt(discordance.denominator_n)} (${formatNumber(discordance.share_pct, 2)}%)`,
      ],
    ];

    rows.forEach(([label, value]) => {
      host.appendChild(element("dt", null, label));
      host.appendChild(element("dd", null, value));
    });
  }

  function renderIntegrity() {
    const host = document.getElementById("integrity");
    const result = state.integrity;
    host.className = `integrity${result.pass ? "" : " integrity--fail"}`;
    if (result.pass) {
      host.textContent =
        `Integrity: ${result.checks.length}/${result.checks.length} checks pass. ` +
        "Every figure above is read from pilot_report.json; the counts were " +
        "recomputed from the CSV in this browser and matched.";
    } else {
      host.textContent = `Integrity: ${result.failed.length} of ${result.checks.length} checks FAILED — ${result.failed.join("; ")}`;
    }
    host.dataset.pass = String(result.pass);
  }

  function renderLimits() {
    const host = document.getElementById("limits");
    host.textContent = "";
    const ceiling = path(state.report, ["interpretation_ceiling"]) || [];
    ceiling.forEach((line) => host.appendChild(element("li", null, line)));
  }

  function renderProvenance() {
    const host = document.getElementById("provenance");
    host.textContent = "";
    const attribution = path(state.report, ["attribution"]) || {};
    const zenodo = path(state.report, ["odbl_4_6_statement", "zenodo_deposit"]) || {};

    const block = (label, html) => {
      const wrapper = element("div", "prov__block");
      wrapper.appendChild(element("span", "prov__label", label));
      const body = element("p");
      body.innerHTML = html;
      wrapper.appendChild(body);
      host.appendChild(wrapper);
    };

    block(
      "Official municipal data — CC BY 4.0",
      `${escapeHtml(attribution.official_callejero || "")}<br>${escapeHtml(
        attribution.official_facilities || ""
      )}`
    );
    block(
      "OpenStreetMap — ODbL 1.0",
      `${escapeHtml(attribution.openstreetmap || "")} ` +
        `<a href="${escapeHtml(attribution.openstreetmap_copyright_url || "https://www.openstreetmap.org/copyright")}" rel="noopener">Copyright and licence</a>.` +
        "<br>Every network distance, snap offset and ratio shown here is derived from " +
        "OpenStreetMap. The portal and facility coordinates are not."
    );
    block(
      "Dataset archive — cite the version DOI",
      `The OpenStreetMap pedestrian-network extract these results are computed from is ` +
        `deposited under ODbL 1.0 at <a href="${escapeHtml(zenodo.url || "https://doi.org/10.5281/zenodo.24288645")}" rel="noopener">` +
        `${escapeHtml(zenodo.doi_version || "10.5281/zenodo.24288645")}</a> ` +
        `(version DOI; published ${escapeHtml(zenodo.publication_date || "2026-11-16")}). ` +
        "Cite the version DOI, not the concept DOI: a reproducibility claim is about " +
        "these exact bytes."
    );
    block(
      "Scope of this viewer",
      "One barrio (San Isidro, 113) and one facility category (Instalaciones " +
        "Deportivas Básicas Municipales, dataset 200215). The network is " +
        "OpenStreetMap-derived, <strong>not surveyed pedestrian infrastructure</strong>. " +
        "Facility points are published register coordinates, <strong>not verified " +
        "entrances</strong>. Nothing here generalises to Madrid as a whole. " +
        "<strong>This is not the Lens observation circle</strong> and must never be " +
        "presented as one: the Lens circle is a declared observation window over " +
        "published records, while a network distance is a measured property of a " +
        "street network."
    );
    block(
      "Run record",
      `Pilot run ${escapeHtml(path(state.report, ["run_finished_utc"]) || "N/A")}; ` +
        `OSM data vintage ${escapeHtml(
          path(state.report, ["odbl_4_6_statement", "extract_identity", "timestamp_osm_base"]) || "N/A"
        )}. ` +
        `Status: ${escapeHtml(path(state.report, ["status"]) || "N/A")}`
    );
  }

  // -------------------------------------------------------------- controls

  function wireControls() {
    const buttons = Array.from(document.querySelectorAll(".viewpicker__btn"));
    buttons.forEach((button, index) => {
      button.addEventListener("click", () => setView(button.dataset.view));
      // Arrow-key traversal, as a radiogroup is expected to support.
      button.addEventListener("keydown", (event) => {
        const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
        const back = event.key === "ArrowUp" || event.key === "ArrowLeft";
        if (!forward && !back) return;
        event.preventDefault();
        const next = buttons[(index + (forward ? 1 : -1) + buttons.length) % buttons.length];
        next.focus();
        setView(next.dataset.view);
      });
    });

    document.getElementById("toggle-facilities").addEventListener("change", (event) => {
      if (event.target.checked) state.layers.facilities.addTo(state.map);
      else state.map.removeLayer(state.layers.facilities);
    });

    document.getElementById("toggle-barrio").addEventListener("change", (event) => {
      if (event.target.checked) state.layers.barrio.addTo(state.map);
      else state.map.removeLayer(state.layers.barrio);
    });

    document.getElementById("reset-extent").addEventListener("click", resetExtent);
  }

  // ------------------------------------------------------------ test hook

  // Read-only seam for the browser smoke test. It exposes no setter that the UI
  // does not already expose through a control.
  window.__explorer = {
    get ready() {
      return document.getElementById("app").dataset.ready === "true";
    },
    get view() {
      return state.view;
    },
    get counts() {
      return {
        portals: state.portals.length,
        measured: state.integrity ? state.integrity.counts.MEASURED : null,
        notSnapped: state.integrity ? state.integrity.counts.NOT_SNAPPED : null,
        unreachable: state.integrity ? state.integrity.counts.UNREACHABLE : null,
        facilities: state.facilitiesById.size,
        disagreements: state.integrity ? state.integrity.disagreements : null,
        ratioDefined: state.integrity ? state.integrity.ratioDefined : null,
        ratioExcluded: state.integrity ? state.integrity.ratioExcluded : null,
      };
    },
    get integrity() {
      return state.integrity
        ? { pass: state.integrity.pass, failed: state.integrity.failed, total: state.integrity.checks.length }
        : null;
    },
    get thresholds() {
      return JSON.parse(JSON.stringify(CLASS_BREAKS));
    },
    portal(code) {
      const portal = state.byCode.get(String(code));
      return portal ? Object.assign({}, portal) : null;
    },
    colourFor(code) {
      const portal = state.byCode.get(String(code));
      return portal ? colourFor(portal, VIEWS[state.view]) : null;
    },
    select(code) {
      selectPortal(String(code));
    },
    layerCounts() {
      return {
        measuredMarkers: state.layers.portals ? state.layers.portals.getLayers().length : 0,
        unmeasuredMarkers: state.layers.unmeasured ? state.layers.unmeasured.getLayers().length : 0,
        facilityMarkers: state.layers.facilities ? state.layers.facilities.getLayers().length : 0,
      };
    },
    hasFacilityLayer() {
      return Boolean(state.layers.facilities && state.map.hasLayer(state.layers.facilities));
    },
  };

  boot().catch((error) => {
    const host = document.getElementById("inspector");
    if (host) {
      host.textContent = "";
      host.appendChild(
        element(
          "p",
          "placeholder",
          `Could not load the pilot artifacts: ${error.message}. The viewer must be ` +
            "served over HTTP from the repository root, not opened as a file:// URL."
        )
      );
    }
    const app = document.getElementById("app");
    if (app) app.dataset.ready = "error";
    throw error;
  });
})();
