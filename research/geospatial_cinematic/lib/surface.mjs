// Gate 4D: elevation grid (geometry package) -> mesh arrays in the Gate 4C scene frame.
// Pure ES module, no dependencies: the render page, the CLI and the tests all import it.
//
// The grid lies on the texture package's own EPSG:3857 pixel lattice (one value per texture pixel,
// the mean source elevation over that pixel's footprint). Vertices sit at those pixel centres, so
// the mesh spans from the first to the last pixel centre of the window and each vertex's UV is the
// texture coordinate of its own pixel centre: texture and elevation share one lattice by
// construction, with no resampling of either at render time.
//
// Units. Horizontal scene units are Web Mercator metres (geo.mjs). Elevations are orthometric
// metres. To keep 1:1 proportions (vertical exaggeration 1), a ground metre of height becomes
// 1 / k scene units, where k = sqrt(eastWest * northSouth) is the ground-metres-per-Mercator-metre
// factor at the extent centre (the two factors differ by ~0.4 % at Madrid; the geometric mean
// leaves at most ~0.2 % anisotropy, and k varies by ~0.02 % across a 1.5 km north-south window).
//   z = (H - base_m) / k * exaggeration          H = elevation in metres, base_m = documented base

export function verticalUnitsPerMetre(ground) {
  return 1 / Math.sqrt(ground.eastWest * ground.northSouth);
}

// grid: geometry-manifest "grid" record; frame: sceneFrame of the texture package.
export function surfaceFrame(frame, grid) {
  const [minE, minN, maxE, maxN] = grid.bbox_epsg3857;
  const [px, py] = grid.pixel_size_mercator_units;
  const { cols, rows } = grid;
  const w = grid.window_texture_pixels;
  if (w.col1 - w.col0 !== cols || w.row1 - w.row0 !== rows) throw new Error('grid window and shape disagree');
  const west = minE + px / 2 - frame.origin[0];
  const east = maxE - px / 2 - frame.origin[0];
  const north = maxN - py / 2 - frame.origin[1];
  const south = minN + py / 2 - frame.origin[1];
  const [W, H] = frame.pixels;
  return {
    cols, rows, px, py, west, east, north, south,
    width: east - west,
    height: north - south,
    centre: [(west + east) / 2, (north + south) / 2],
    // Outer edges of the window (pixel edges), for outlining it on the flat image.
    edges: { west: minE - frame.origin[0], east: maxE - frame.origin[0], north: maxN - frame.origin[1], south: minN - frame.origin[1] },
    // Texture coordinates (flipY upload: v = 1 is image row 0, the north edge).
    uv: { u0: (w.col0 + 0.5) / W, du: 1 / W, v0: 1 - (w.row0 + 0.5) / H, dv: 1 / H },
    texturePixels: { col0: w.col0, row0: w.row0 },
  };
}

export function vertexXY(sf, r, c) {
  return [sf.west + c * sf.px, sf.north - r * sf.py];
}

export function vertexUV(sf, r, c) {
  return [sf.uv.u0 + c * sf.uv.du, sf.uv.v0 - r * sf.uv.dv];
}

export const metresToZ = (h, base, zPerM) => (h - base) * zPerM;
export const zToMetres = (z, base, zPerM) => z / zPerM + base;

// Shared horizontal layout (uv + triangle indices) for every surface of one grid.
export function buildLayout(sf) {
  const { rows, cols } = sf;
  const uv = new Float32Array(rows * cols * 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = (r * cols + c) * 2;
      const [u, v] = vertexUV(sf, r, c);
      uv[k] = u; uv[k + 1] = v;
    }
  }
  const index = new Uint32Array((rows - 1) * (cols - 1) * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c; const b = a + 1; const d = a + cols; const e = d + 1;
      // Counter-clockwise seen from above (+z): front faces point up.
      index[k++] = a; index[k++] = d; index[k++] = b;
      index[k++] = b; index[k++] = d; index[k++] = e;
    }
  }
  return { uv, index };
}

// Vertex positions for one surface. Throws on a non-finite elevation: NoData never becomes a height.
export function buildPositions(sf, heights, base, zPerM) {
  const { rows, cols } = sf;
  if (heights.length !== rows * cols) throw new Error(`grid has ${heights.length} values, expected ${rows * cols}`);
  const pos = new Float32Array(rows * cols * 3);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const h = heights[i];
      if (!Number.isFinite(h)) throw new Error(`non-finite elevation at row ${r}, col ${c}`);
      const [x, y] = vertexXY(sf, r, c);
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = metresToZ(h, base, zPerM);
    }
  }
  return pos;
}
