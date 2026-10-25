# Orchard package («Сад обители»)

Programmatic pixel art for the monastery's walled orchard and kitchen garden, abandoned since the ritual began:
gnarled olive trees, a well, an olive press, pergolas and trellises, beehives, benches, a broken handcart, baskets,
terracotta jars, a worn statue of a seated monk, herb beds and ground litter. It is drawn in the camp panorama and
monastery ruins language (rounded chipped stone with moss and blue-green shade, the camp's warm crate wood) so the
orchard reads as the same world. Every pixel is drawn by `scripts/build-orchard-assets.py` from fixed geometry, fixed
seeds and one explicit palette. No image generation, network access or new dependency is involved.

## Runtime use

- Not wired yet: no file in `src/` loads this package. The zone layout (west of the monastery courtyard) will
  register the atlas key `orchard` and place frames by `manifest.footprints`, exactly like the pixel-v9 props in
  `src/camp-layout.js` and the pixel-v11 ruins in `src/courtyard-layout.js` (`put()`).
- Roles follow the ruins package: `solid` blocks walking, `low` blocks walking but stays at most 1.1u high so it
  never hides the hero, `flat` is a ground decal without a collider.
- `tall` frames (trees, pergolas) collide only at their trunk or posts; the renderer fades them over the hero.
- Ground: `orchard-grass.png` follows the pixel-v6 surface contract (sample at `worldXZ / 4` with repeat).

Frame names and footprints are therefore part of the runtime contract.

## Contents

| File | Contents |
| --- | --- |
| `orchard.png` | Atlas, cell 256 px, 4 columns × 8 rows, registration anchor `[128,232]`, binary alpha, 45 opaque colours. |
| `orchard-grass.png` | Opaque 128 × 128 clover meadow (4u, 32 px/u), seamless on both axes, 10 colours. |
| `hit-masks.json` | Little-bit-first mask of the atlas alpha, keyed by `orchard.png`. |
| `manifest.json` | Runtime contract: atlas slicing, frame keys, surface, footprints, `opaqueBounds` (opaque `[x0,y0,x1,y1]` box of each cell, exclusive end, as in pixel-v9). |
| `frames/*.png` | One 256 px cell per frame. |
| `previews/` | Contact sheets (native, 2×), footprint overlay (footprint yellow, colliders teal, canopy green), a 16 × 10u mock orchard on the camp meadow with ruins and camp props and the monk, a style match row, 3×3 surface repeats (native, 2×). |
| `source/footprints.json` | Geometry contract the art was drawn to (written by the script from `SPECS`). |
| `source/palette.json`, `source/provenance.json`, `qa-report.json` | Palette with the source package of every colour, input hashes, per-frame checks. |

Frames, in atlas order: `olive-tree-a`, `olive-tree-b`, `olive-tree-c`, `olive-tree-old`, `olive-dead`, `fig-young`, `well`, `olive-press`, `pergola-x`, `pergola-y`, `pergola-broken-x`, `pergola-broken-y`, `trellis-x`, `trellis-y`, `beehive-pair`, `beehive-fallen`, `stone-basin`, `garden-bench-x`, `garden-bench-y`, `cart-broken-x`, `cart-broken-y`, `olive-baskets`, `terracotta-jars`, `monk-statue`, `herb-bed-x`, `herb-bed-y`, `herb-bed-overgrown`, `vine-clump`, `fallen-olives`, `leaf-litter`, `gravel-path`, `pruned-branches`.

## Frames

- Olive trees (silver-green crowns, gnarled twisted trunks, trunk collider only): `olive-tree-a` (≈3.1u, three
  cords twisting into one trunk), `olive-tree-b` (≈2.9u, one stout leaning trunk, a wide lopsided crown),
  `olive-tree-c` (≈3.3u, two trunks split in a V), `olive-tree-old` (landmark, ≈3.8u, a ring of massive cords round
  a hollow that opens toward the viewer, buttress roots), `olive-dead` (bleached split cords, bare limbs snapped
  short, a few dry leaves), `fig-young` (≈1.9u, smooth grey stems, broad fresh leaves). `canopy` gives each
  crown's ground radius.
- `well`: a round well head of two stone courses 1.6u across, a dark shaft, a wooden frame with a little gable roof,
  a windlass and a hanging bucket (landmark).
- `olive-press`: a round stone basin, a central pivot with a timber post, a millstone on edge in the trough and a
  wooden axle beam through it (landmark).
- `pergola-x/-y`: four stone posts, two timber beams, rafters and grapevines over the top; `pergola-broken-x/-y`:
  the front post snapped to a stump (collider note `stump`), its beam slanting down onto it, fallen rafters.
  Colliders on the posts only.
- `trellis-x/-y`: a low vine fence of three posts and two laths (role `low`).
- `beehive-pair`: two straw skeps on a stone bench; `beehive-fallen`: the bench slab slopes to the ground, one
  skep lies on its side.
- `stone-basin`: a dry trough hollowed from one block. `garden-bench-x/-y`: a timber seat and backrest on two stone
  feet, one back board gone.
- `cart-broken-x/-y`: a wooden handcart down on one corner, its far wheel flat in the grass, the shafts on the ground.
- `olive-baskets` (two heaped wicker baskets and a third tipped over, spilling), `terracotta-jars` (a tall jar, a
  two-handled jar, a small jar on its side and a broken foot with shards).
- `monk-statue`: a worn, hooded stone monk seated on a coursed, mossy plinth with an offering bowl (≈1.8u, landmark).
- `herb-bed-x/-y`: raised beds with a kerb of rounded stones, dark soil and rows of herbs with lavender;
  `herb-bed-overgrown` (kerb stones tumbled, weeds spilling over); `vine-clump` (a vine stump in a low leaf mound).
- Flat ground decals (role `flat`, ground layer, no outline): `fallen-olives`, `leaf-litter`, `gravel-path`
  (lit from above only, may be mirrored), `pruned-branches`.

Both orientations of every lit, asymmetric prop are drawn (`-x` and `-y`): a mirror would put the shade-side colours
on the lit face. No magenta, turquoise or amber glow appears in this package.

## Registration

`[128,232]` is a fixed registration point, not a footprint centre. Each frame's ground footprint is
`footprints.<frame>`: `contactCenter` in cell pixels plus a world-space shape (`box`/`rect`: `halfWidth` along
world x = screen down-left, `halfDepth` along world y = screen down-right; `circle`: `radius`). The front-most
footprint point sits on row 231. Pixel offset `(du,dv)` from `contactCenter` maps to world `x=(2dv-du)/(32√2)`,
`y=(2dv+du)/(32√2)`; mirrored placements swap the roles of x and y. Placement works exactly like the pixel-v9
props in `src/camp-layout.js` (`put()`): sprite position = footprint centre − `toWorld(contactCenter − anchor)`.

Extensions over pixel-v9 (as in pixel-v11): `colliders` (the pergola posts, world units relative to the footprint
centre), `axis`, `tall`, `canopy`, `landmark`, `mirror` and `contact` (`corners`: every collider's front,
screen-left and screen-right ground corner lies within 1.6 px of the drawing; `loose`: organic edge; `none`).

## Ground surface

`manifest.surfaces.orchardGrass` follows the pixel-v6 surface contract: sample at `worldXZ / 4` with repeat. Image
columns run along world +x and rows along world −y (textures load with `invertY`). The structure is the camp
meadow's (three octaves of wrapping patch noise, short blade clusters pointing screen-up), a little greener, with
mats of clover trefoils and a few white clover heads. `G_SH` and `G_H2` are the camp meadow's own shade and blade
tip, so the two meadows meet without a visible change of light.

## Rebuild and verify

From the repository root (tested with Python 3.14.4, Pillow 12.3.0):

```sh
python3 -B scripts/build-orchard-assets.py
python3 -B scripts/build-orchard-assets.py --verify-only
node --test tests/orchard-assets.test.js
```

`--verify-only` redraws every delivered file in memory, compares bytes and input hashes, writes nothing and exits
non-zero on any difference. Byte identity is guaranteed only with the recorded Pillow version. The provenance
records the input hashes of the camp, ruins and monk files, so a change to those inputs makes verify fail until the
package is rebuilt.

## Limits

- Programmatic drawing: masonry and wood are a heightfield of rounded, chipped blocks with patterned faces; jars,
  skeps, baskets and the bucket are ray-marched solids of revolution; bark, the statue and foliage are ray-cast
  ellipsoids and hand-placed pixel tufts. Faces are flat planes; individual face blocks do not protrude.
- No animation (no swaying leaves, no bees).
- Crowns are wide and opaque. The tree colliders are small, so the hero walks under a crown; the runtime has to fade
  `tall` frames over the hero, as it does for the camp cypresses.
- The statue is small at native scale (1.8u); its face is a dark hood opening, not a carved face.
- Colliders and placement are the zone layout's decision; footprints are the drawing contract.
