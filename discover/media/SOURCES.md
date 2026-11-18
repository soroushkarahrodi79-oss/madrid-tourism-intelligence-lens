# Discover media provenance

## Earth to Madrid

These images are used for the public landing's editorial sequence. It
composites different views and dates, so it carries no analytical reading,
map scale, or claim about current conditions.

| Local file | Source and credit | Preparation |
|---|---|---|
| `earth.webp` | July 2004 MODIS Blue Marble: Next Generation, Reto Stöckli / [NASA Earth Observatory](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/) · [source raster](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/july/world.200407.3x5400x2700.jpg) | Orthographic projection centered on Madrid (40.42° N, 3.70° W). Editorial lighting and atmospheric limb. 840×840. |
| `iberia.webp` | Same July 2004 Blue Marble raster and credit | North-up crop from 29° W to 21° E and 20° N to 61° N. Cool color grade. 900×760. |
| `madrid-720.webp`, `madrid-1200.webp` | [Central Madrid](https://science.nasa.gov/earth/earth-observatory/central-madrid-88734/), Expedition 45 ISS photo ISS045-E-15741, 18 September 2015. ISS Crew Earth Observations Facility and Earth Science and Remote Sensing Unit, NASA Johnson Space Center · [source photograph](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/88000/88734/iss045e015741_lrg.jpg) | Crop (0,475)–(3280,4575), downsample and color grade. 720×900 and 1200×1500. |

The [NASA Images and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/)
allow this informational reuse with source acknowledgement. The source records
credit NASA and its crew, and the landing displays a credit for the final
photograph. NASA's imagery does not imply NASA endorsement.

## Methodology page

The hero, PLACE, COMPARE and CITY images are lossy WebP crops or downscales of
authentic, unmodified captures of the deployed Lens (Playwright Chromium, 1440×900,
light, `lg=es`, CARTO Positron base map, 4 Nov 2026), taken at
`https://soroushkarahrodi79-oss.github.io/madrid-tourism-intelligence-lens/` with
the state `m=PLACE|COMPARE|CITY`, `a=40.41490,-3.69000,900`, `b=40.40520,-3.72119,500`.
The refusal and limits details remain crops of the committed `docs/showcase` captures
(1 Nov 2026). No pixel content was added.
Values visible in a capture belong to its capture date and build.

| File | Source capture | Operation (source pixels) |
|---|---|---|
| `hero-compare-detail.webp` | Fresh capture of the deployed application, COMPARE (4 Nov 2026, see below) | crop 240,275 → 940,825, fully inside the map canvas (no panel or margin pixels) |
| `place-1200.webp`, `place-720.webp` | Fresh capture, PLACE (4 Nov 2026) | full 1440×900 frame, resized |
| `compare-1200.webp`, `compare-720.webp` | Fresh capture, COMPARE (4 Nov 2026) | full 1440×900 frame, resized |
| `city-1200.webp`, `city-720.webp` | Fresh capture, CITY (4 Nov 2026) | full 1440×900 frame, resized |
| `refusal-detail.webp` | `docs/showcase/lens-03a-refusal.webp` (1 Nov 2026) | crop 480,312 → 928,578 |
| `limits-detail.webp` | `docs/showcase/lens-03b-evidence-limits.webp` (1 Nov 2026) | crop 960,96 → 1411,620 |

Base map in all captures: © OpenStreetMap contributors © CARTO.
