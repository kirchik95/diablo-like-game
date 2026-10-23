# Camp panorama package

Programmatic pixel art for the rebuilt first location (Paper artboard "Панорама лагеря"). The road area
reuses the same stones, trees, bushes and tufts; `ruin-stump` and `ruin-fallen` are its road markers.
Every pixel is drawn by `scripts/build-camp-panorama-assets.py` from fixed geometry, fixed seeds and
explicit palettes. No image generation, network access or new dependency is involved.

## Contents

| File | Contents |
| --- | --- |
| `camp-panorama.png` | Atlas, cell 256 px, 4 columns × 6 rows (all cells used), registration anchor `[128,232]`, binary alpha, 55 opaque colours. |
| `mountains.png` | Far backdrop, 2048 × 1280, opaque, 28 colours, wraps horizontally. |
| `camp-earth.png`, `camp-grass.png` | Opaque 128 × 128 ground surfaces (4u, 32 px/u), seamless on both axes: packed earth/road and olive meadow. |
| `hit-masks.json` | Little-bit-first mask of the atlas alpha, keyed by `camp-panorama.png`. |
| `manifest.json` | Runtime contract: atlas slicing, frame keys, backdrop screen frame, footprints, opaque cell bounds. |
| `frames/*.png` | One 256 px cell per frame. |
| `previews/` | Contact sheet (native and nearest 2×), props next to the unchanged monk, backdrop with the planned horizon, 3×3 surface repeats (native and 2×). |
| `source/footprints.json` | Geometry contract owned by `src/camp-layout.js` (camp) and `src/road-country.js` (road); an input of this script, never written by it. |
| `source/palette.json`, `source/provenance.json`, `qa-report.json` | Palettes with reproducible concept samples, input hashes, per-frame checks. |

Frames, in atlas order: `tripod-kettle`, `woven-carpet`, `outcrop-block`, `outcrop-pair`, `outcrop-cluster`, `outcrop-cliff`, `outcrop-wall-x`, `outcrop-wall-y`, `outcrop-slab`, `ruin-pillar`, `cypress-tall`, `cypress-medium`, `cypress-pair`, `bush-round`, `bush-large`, `crate`, `sack-pair`, `grass-tuft`, `fern-tuft`, `boulder-round`, `outcrop-crag`, `outcrop-ledge-x`, `ruin-stump`, `ruin-fallen`.

## Registration

`[128,232]` is a fixed registration point, not a footprint centre. Each frame's ground footprint is
`footprints.<frame>`: `contactCenter` in cell pixels plus a world-space shape (`box`/`rect`: `halfWidth` along
world x = screen down-left, `halfDepth` along world y = screen down-right; `circle`: `radius`). The front-most
footprint point sits on row 231, so the anchor also sorts like the object's front. Pixel offset `(du,dv)` from
`contactCenter` maps to world `x=(2dv-du)/(32√2)`, `y=(2dv+du)/(32√2)`; mirrored placements swap the roles of x
and y. `role` is `solid` (needs a collider) or `flat` (carpet, tufts: walkable, draw in the ground layer).
`opaqueBounds.<frame>` is the opaque `[x0,y0,x1,y1]` box of the cell (exclusive end), for screen-space reservations.
Circles of trees and bushes are trunk/stem cores; canopies overhang them.

## Backdrop

`mountains.png` is painted in world-screen coordinates: `u=(y-x)/√2` (screen right) and `v=(x+y)/(2√2)`
(screen down), in world units, 32 px per unit. Column `(u+20)·32`, row `(v+40)·32`; it wraps every 64 units in
u. The top rows are a flat sky band and the bottom 24 rows one flat colour, so clamped vertical sampling has no
edge. Three ridges follow the camp rim (`NEAR_CREST`, about 1u above the layout horizon `H(u)`): a far pale
blue-grey range with warm lit faces and varied peaks (the highest near u≈12), a mid slate-blue ridge and a near
dark blue-green ridge with rows of tiny cypress silhouettes. Facets take their light from the crest slope smoothed
wider with depth, so spurs merge into broad flanks instead of vertical streaks. Each ridge's foot sinks into
horizontal, dithered valley haze; small flat-bottomed cloud wisps float over the sky and the far range only.

## Ground surfaces

`manifest.surfaces.campEarth` / `campGrass` follow the pixel-v6 surface contract: sample at `worldXZ / 4` with
repeat. Image columns run along world +x and rows along world −y (textures load with `invertY`), so the
screen's upper-left light falls on the lower (+row) side of pebbles. Both are flat: no height, no edges. Earth
has sparse hairline cracks, small pebbles and darker trodden patches; grass has darker patches and short
2–3 texel blade highlights that point screen-up. Tufts taller than that are separate props.

## Rebuild and verify

From the repository root (tested with Python 3.14.4, Pillow 12.3.0):

```sh
python3 -B scripts/build-camp-panorama-assets.py
python3 -B scripts/build-camp-panorama-assets.py --verify-only
node --test tests/camp-panorama-assets.test.js
```

`--verify-only` redraws every delivered file in memory, compares bytes and input hashes, writes nothing and exits
non-zero on any difference. Byte identity is guaranteed only with the recorded Pillow version.

## Limits

- Programmatic drawing: outcrops are heightfields of rounded, chipped and cracked blocks (bevelled tops, moss,
  bedding joints, dark crevices, blue-green bounce light) splatted into a z-buffer; trees and bushes are layered
  tufts. Plan corners stay sharp at the screen-left and screen-right ground corners, so the drawn contact stays
  within 1.6 px of every box footprint corner. Detail is simpler than the artboard illustration, at the game's
  32 px/u density (not the artboard's coarser grid).
- No animation; the backdrop has no depth information and is meant only beyond the horizon line.
- Colliders and placement are the layout owner's decision; footprints are the drawing contract.
