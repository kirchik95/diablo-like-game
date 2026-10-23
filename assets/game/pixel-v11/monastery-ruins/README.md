# Monastery ruins package

Programmatic pixel art for the monastery courtyard, drawn in the camp panorama's stone language so camp, road and
courtyard read as one world. Every pixel is drawn by `scripts/build-monastery-ruins-assets.py` from fixed geometry,
fixed seeds and explicit palettes. No image generation, network access or new dependency is involved.

## Runtime use

- Courtyard: `src/courtyard-layout.js` places the ruin frames by `manifest.footprints` (colliders included);
  `src/pixel-assets.js` registers `monasteryRuins`, `monasteryWorld` and `courtyardFlagstone`; `src/pixel-scene.js`
  loads both hit masks and draws the props, the dais states and the braziers.
- Road: `src/road-country.js` uses the gate pieces (`arch-gate`, `fallen-lintel`, `rubble-pile`, `column-drums`);
  `src/country-border.js` reads the frames' footprints and `opaqueBounds`.
- Ground: `src/country-terrain.js` samples `courtyard-flagstone.png` for the court's stone.
- `src/render.js` draws the ritual source, the braziers and the healing shrine from `monasteryWorld`.

Frame names, clip names and footprints are therefore part of the runtime contract.

## Contents

| File | Contents |
| --- | --- |
| `monastery-ruins.png` | Atlas, cell 256 px, 4 columns × 8 rows, registration anchor `[128,232]`, binary alpha, 43 opaque colours. |
| `courtyard-flagstone.png` | Opaque 128 × 128 ground surface (4u, 32 px/u), seamless on both axes, 11 colours. |
| `monastery-world.png` | World atlas for the ritual source, healing shrine and braziers: cell 160, 6 × 4, anchor `[80,144]`, the pixel-v2 `world` layout. |
| `hit-masks.json` | Little-bit-first masks of both atlases' alpha, keyed by `monastery-ruins.png` and `monastery-world.png`. |
| `manifest.json` | Runtime contract: atlas slicing, frame keys, surfaces, footprints, `opaqueBounds` (opaque `[x0,y0,x1,y1]` box of each cell, exclusive end, as in pixel-v9). |
| `frames/*.png`, `frames/world/*.png` | One cell per frame (256 px ruins, 160 px world). |
| `previews/` | Contact sheets (native, 2×; ruins and world), footprint overlay, mock courtyard with camp props, style match against camp props, pixel-v2 vs pixel-v11 world frames, the v2 and v11 ritual source on the dais, animated GIF loops, 3×3 surface repeats (native, 2×). |
| `source/footprints.json` | Geometry contract the art was drawn to (written by the script from `SPECS`). |
| `source/palette.json`, `source/provenance.json`, `qa-report.json` | Palette with reproducible concept samples, input hashes, per-frame checks. |

Frames, in atlas order: `wall-run-x`, `wall-run-y`, `wall-window-x`, `wall-window-y`, `wall-end-x`, `wall-end-y`, `wall-breach-x`, `wall-corner`, `arch-gate`, `parapet-x`, `parapet-y`, `parapet-corner`, `column-intact`, `column-broken`, `column-drums`, `ritual-plinth`, `ritual-plinth-runes`, `fallen-block`, `fallen-lintel`, `fallen-blocks`, `rubble-pile`, `rubble-scatter`, `flagstones-broken`, `flagstone-cracks`, `moss-patch`, `ivy-clump`, `dead-tree`, `dead-tree-snag`, `parapet-broken-x`, `parapet-broken-y`, `corner-stump`, `rubble-small`.

## Frames

- Walls (0.8u thick, 0.42u courses): `wall-run-x/-y` (4u runs), `wall-window-x/-y` (4u, round-headed window,
  sill 0.84u, head 2.18u), `wall-end-x/-y` (3u, crumbling towards +x / +y), `wall-breach-x` (4u, collapsed middle
  with rubble), `wall-corner` (inner back corner, 3u arms along +x and +y). Both orientations are drawn: a mirror
  would put the shade-side colours on the lit face.
- `arch-gate`: 4.4u gate spanning world x, walkable passage 2.5u wide along y, crown 2.93u, eleven voussoirs.
- Low parapets (0.6u thick, 0.76u with coping): `parapet-x/-y` (4u), `parapet-corner` (outer front corner, arms
  along -x and -y), `parapet-broken-x/-y` (3u, broken down to 0.54u, with a bare walkable gap in the middle and one
  collider per standing chunk). `corner-stump` (1.5u square pier, 1.35u)
  fills a notched court corner.
- Columns: `column-intact` (3.27u: plinth, eight drums, necking, echinus, abacus), `column-broken` (fractured at
  1.7u), `column-drums` (toppled drums half sunk in the soil, a stump and a slab).
- `ritual-plinth`: flat ground art (role `flat`, no collider), an octagonal stepped dais 4 × 4u with rim tiers of
  0.06u and 0.12u around a ground-level square `socket` (half 1.0u) where the ritual source's own pedestal stands.
  `ritual-plinth-runes` is the same dais with its carved glyphs and radial veins glowing magenta: identical
  alpha, swap frames (runes while the seal holds, the plain dais after it breaks).
- Fallen masonry: `fallen-block`, `fallen-lintel` (moulded, broken in two), `fallen-blocks`; `rubble-pile`
  (1.8u heap) and `rubble-small` (1u heap).
- Flat ground decals (role `flat`, ground layer, no outline): `rubble-scatter`, `flagstones-broken`,
  `flagstone-cracks` (transparent except the cracks, for any paving), `moss-patch` (moss and ivy runners).
- Plants: `ivy-clump` (ivy over a broken stub), `dead-tree`, `dead-tree-snag`. Ivy also grows on several walls,
  the arch and the broken column.

Magenta appears only in `ritual-plinth-runes`, `brazier-magenta` and the sealed `ritual-source` keys (ritual
energy, per `docs/art-direction.md`); turquoise only in `brazier-cyan` and the open source keys; amber only in the
healing shrine.

## World atlas (ritual source, healing shrine, braziers)

`monastery-world.png` replaces the lavender pixel-v2 world frames in the same stone. Its layout is the pixel-v2
`world` atlas contract, so the runtime swaps atlas and clip names only: cell 160, 6 columns × 4 rows, anchor
`[80,144]`, six keys per clip, 40 opaque colours.

| Clip | Keys | Runtime use |
| --- | --- | --- |
| `brazier-cyan` | 0–5 | turquoise flame loop, `worldPose` step 0.1 s |
| `brazier-magenta` | 6–11 | magenta (ritual) flame loop, step 0.12 s |
| `ritual-source` | 12–17 | key 0 sealed, 1 sealed flare, 2–4 open pulse (turquoise), 5 destroyed (render.js keys 0 / 2–4 / 5) |
| `healing-shrine` = `shrine` | 18–23 | amber activation at `worldPose('shrine')` times 0, .1, .24, .4, .62, .9 |

The shrine pedestal's contact centre is cell pixel `(80,124)`, exactly where render.js registers the pixel-v2
shrine; the pedestal is a 1.72u square, so it stands inside the courtyard dais socket at ground level. A brazier's
foot centre is the anchor `(80,144)`; its stone foot has radius 0.28u (the bowl overhangs). Stone parts are
identical in every key of a clip: only flame, crystal, glyphs and motes change. The frames carry their own glow
colours, so the runtime should not tint them (render.js currently sets a pink or cyan emissive on the v2 shrine).
`manifest.monasteryWorld.footprints` records each clip's footprint and key meaning.

## Registration

`[128,232]` is a fixed registration point, not a footprint centre. Each frame's ground footprint is
`footprints.<frame>`: `contactCenter` in cell pixels plus a world-space shape (`box`/`rect`: `halfWidth` along
world x = screen down-left, `halfDepth` along world y = screen down-right; `circle`: `radius`). The front-most
footprint point sits on row 231. Pixel offset `(du,dv)` from `contactCenter` maps to world `x=(2dv-du)/(32√2)`,
`y=(2dv+du)/(32√2)`; mirrored placements swap the roles of x and y. Placement works exactly like the pixel-v9
props in `src/camp-layout.js` (`put()`): sprite position = footprint centre − `toWorld(contactCenter − anchor)`.

Extensions over pixel-v9: `colliders` (exact solid boxes of `wall-corner`, `parapet-corner`, the two `arch-gate`
piers and the standing chunks of `parapet-broken-*`, world units relative to the footprint centre), `passage` (the arch's walkable box), `window`,
`axis` (wall direction), `brokenEnd`, `socket` (the dais's ground-level centre), `variantOf` and `state` (a swap
frame with the same placement and alpha) and `contact` (`corners`: every collider's front, screen-left and
screen-right ground corner lies within 1.6 px of the drawing; `loose`: organic edge; `none`).

## Ground surface

`manifest.surfaces.courtyardFlagstone` follows the pixel-v6 surface contract: sample at `worldXZ / 4` with repeat.
Image columns run along world +x and rows along world −y (textures load with `invertY`). Courses of 36/28/34/30 px
(≈1u) run along x in running bond, slabs 24–52 px long; no joint touches a tile edge, so the wrap is invisible. Each
slab has its own tone with mottling, a lit lip on its +row/+col edge, chipped corners, hairline cracks and moss in
some joints. The stone tones are the decals' `S_*` colours, so `flagstones-broken` and `flagstone-cracks` sit on it.

## Rebuild and verify

From the repository root (tested with Python 3.14.4, Pillow 12.3.0):

```sh
python3 -B scripts/build-monastery-ruins-assets.py
python3 -B scripts/build-monastery-ruins-assets.py --verify-only
node --test tests/monastery-ruins-assets.test.js
```

`--verify-only` redraws every delivered file in memory, compares bytes and input hashes, writes nothing and exits
non-zero on any difference. Byte identity is guaranteed only with the recorded Pillow version.

## Limits

- Programmatic drawing: masonry is a heightfield of rounded, chipped blocks with patterned faces (courses,
  head joints, voussoirs, drum beds). Faces are flat planes; individual face blocks do not protrude.
- No animation. The rune frame is static; the glow does not pulse.
- The arch passage and the window are see-through. Billboard sorting cannot put an actor between the piers in
  front of the far jamb; the courtyard integration has to handle that (for example with the tent translucency).
- Colliders and placement are the courtyard layout's decision; footprints are the drawing contract.
