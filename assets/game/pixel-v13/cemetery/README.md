# Old cemetery package

Programmatic pixel art for «Старое кладбище», the old open-air burial ground of the monastery's monks in a yew and
cypress grove east of the road. It is drawn in the camp panorama's stone language, so camp, road, courtyard and
cemetery read as one world. Every pixel is drawn by `scripts/build-cemetery-assets.py` from fixed geometry, fixed seeds
and explicit palettes. No image generation, network access or new dependency is involved.

## Runtime use

Not placed yet. A layout agent will place the frames by `manifest.footprints` in the way `src/courtyard-layout.js`
places the ruins (`put()`: sprite position = footprint centre − `toWorld(contactCenter − anchor)`; `colliders`
replace the box). Register the atlas under the key `cemetery`. Frame names, footprints, roles and colliders are the
runtime contract.

## Contents

| File | Contents |
| --- | --- |
| `cemetery.png` | Atlas, cell 256 px, 4 columns × 8 rows, registration anchor `[128,232]`, binary alpha, 42 opaque colours. |
| `cemetery-earth.png` | Opaque 128 × 128 ground surface (4u, 32 px/u), seamless on both axes, 10 colours. |
| `hit-masks.json` | Little-bit-first mask of the atlas alpha, keyed by `cemetery.png`. |
| `manifest.json` | Runtime contract: atlas slicing, frame keys, surface, footprints, `opaqueBounds` (opaque `[x0,y0,x1,y1]` box of each cell, exclusive end, as in pixel-v9). |
| `frames/*.png` | One 256 px cell per frame. |
| `previews/` | Contact sheets (native, 2×), footprint overlay, a 16 × 10u mock cemetery with camp and ruins props and the monk, a style match row, 3×3 surface repeats (native, 2×). |
| `source/footprints.json` | Geometry contract the art was drawn to (written by the script from `SPECS`). |
| `source/palette.json`, `source/provenance.json`, `qa-report.json` | Palette with its camp and ruins sources, input hashes, per-frame checks. |

Frames, in atlas order: `stele-tall-x`, `stele-tall-y`, `stele-low-x`, `stele-low-y`, `stele-leaning-x`, `stele-leaning-y`, `stele-fallen-x`, `stele-fallen-y`, `cairn-small`, `cairn-large`, `grave-mound-x`, `grave-mound-y`, `grave-plot-x`, `grave-plot-y`, `obelisk`, `obelisk-broken`, `stone-lantern`, `stone-lantern-toppled`, `fence-x`, `fence-y`, `fence-broken-x`, `fence-broken-y`, `cemetery-gate-x`, `cemetery-gate-y`, `urn-pair`, `urn-broken`, `offering-stone`, `yew-round`, `yew-small`, `grave-ash`, `stepping-slabs`, `moss-graves`.

## Frames

Sizes are the drawn ground footprint (along × across, u) and the drawn height. "-x" frames stand along world x
(screen upper right to lower left) and show their carved face in shade; "-y" frames stand along world y and show it
lit. Both orientations are drawn: a mirror would put the shade-side tones on the lit face.

| Frame | Role | Footprint | Height | Notes |
| --- | --- | --- | --- | --- |
| `stele-tall-x` | solid | 0.72 × 0.34 | 1.52 | upright gravestone, rounded top, carved frame, band and three glyphs, on a plinth |
| `stele-tall-y` | solid | 0.34 × 0.72 | 1.52 | upright gravestone, rounded top, carved frame, band and three glyphs, on a plinth |
| `stele-low-x` | low | 1.1 × 0.34 | 0.8 | low wide gravestone with a humped top, framed glyph panel |
| `stele-low-y` | low | 0.34 × 1.1 | 0.8 | low wide gravestone with a humped top, framed glyph panel |
| `stele-leaning-x` | solid | 0.64 × 0.24 | 1.2 | tilted 13°, cracked, one shoulder broken off, foot sunk in a soil heap |
| `stele-leaning-y` | solid | 0.24 × 0.64 | 1.2 | tilted 13°, cracked, one shoulder broken off, foot sunk in a soil heap |
| `stele-fallen-x` | low | 1.4 × 0.6 | 0.2 | lies face up, broken in two, carving on its top |
| `stele-fallen-y` | low | 0.6 × 1.4 | 0.2 | lies face up, broken in two, carving on its top |
| `cairn-small` | low | r 0.3 | 0.45 | five stacked river stones |
| `cairn-large` | low | r 0.5 | 0.75 | a ring of seven stones under a stack of six, knee high |
| `grave-mound-x` | low | 2 × 1 | 0.3 | earth mound with dry grass, leaves and border stones (two missing) |
| `grave-mound-y` | low | 1 × 2 | 0.3 | earth mound with dry grass, leaves and border stones (two missing) |
| `grave-plot-x` | flat | 2 × 1 | 0.07 | flush kerb outline, broken in places, soil and moss inside |
| `grave-plot-y` | flat | 1 × 2 | 0.07 | flush kerb outline, broken in places, soil and moss inside |
| `obelisk` | solid | 1 × 1 | 2.62 | landmark: stepped plinth, glyph panels on the die, tapered shaft with glyph columns and a pyramidion |
| `obelisk-broken` | solid | 1.9 × 1 | 1.5 | snapped at 1.4u, the banded top with its pyramidion lies beside the plinth; one collider each |
| `stone-lantern` | solid | 0.6 × 0.6 | 1.3 | base, shaft, firebox with two turquoise windows, pyramid roof |
| `stone-lantern-toppled` | low | 1.5 × 0.9 | 0.45 | base with a snapped stump, shaft, dark firebox and roof lying in the grass |
| `fence-x` | low | 3 × 0.22 | 0.72 | four low posts with two stone rails, 3u |
| `fence-y` | low | 0.22 × 3 | 0.72 | four low posts with two stone rails, 3u |
| `fence-broken-x` | low | 3 × 0.6 | 0.72 | one bay standing, the middle post fallen, a walkable gap between the colliders |
| `fence-broken-y` | low | 0.6 × 3 | 0.72 | one bay standing, the middle post fallen, a walkable gap between the colliders |
| `cemetery-gate-x` | solid | 3.7 × 0.6 | 2.52 | two posts, a lintel with glyphs, a small bronze bell; walkable passage 2.5u |
| `cemetery-gate-y` | solid | 0.6 × 3.7 | 2.52 | two posts, a lintel with glyphs, a small bronze bell; walkable passage 2.5u |
| `urn-pair` | low | 0.6 × 0.92 | 0.73 | an open urn and a lidded urn on a slab along world y |
| `urn-broken` | low | r 0.32 | 0.3 | an urn on its side with a broken flank, shards and spilled soil |
| `offering-stone` | low | 0.9 × 0.6 | 0.43 | low altar stone with two bronze bowls and a carved band |
| `yew-round` | solid | r 0.25 | 3 | dark round evergreen ≈3u, short fluted red-brown trunk |
| `yew-small` | solid | r 0.18 | 1.85 | young yew ≈1.85u |
| `grave-ash` | flat | 2.2 × 1.8 | 0 | scorched ground with faint magenta cracks (the only magenta) |
| `stepping-slabs` | flat | 1.1 × 3 | 0 | five flush path stones along world y |
| `moss-graves` | flat | 2 × 1.6 | 0 | moss cushions over two flush grave slabs, fallen leaves and twigs |

Roles: `solid` blocks walking and may hide the hero (the renderer fades it); `low` blocks walking but stays under the
hero's knees, so it suits the front edges of the zone; `flat` is ground art without a collider. Trees, the obelisk and
the gate have small colliders at the trunk, the plinth or the posts only.

Colours: magenta appears only in `grave-ash` (faint cracks where the ritual touched the ground); turquoise only in
`stone-lantern` (a static spirit glow in its firebox windows). There are no bones, skulls, crosses or other religious
signs: the steles carry carved bands, framing grooves and abstract glyph marks.

## Registration

`[128,232]` is a fixed registration point, not a footprint centre. Each frame's ground footprint is
`footprints.<frame>`: `contactCenter` in cell pixels plus a world-space shape (`box`/`rect`: `halfWidth` along
world x = screen down-left, `halfDepth` along world y = screen down-right; `circle`: `radius`). The front-most
footprint point sits on row 231. Pixel offset `(du,dv)` from `contactCenter` maps to world `x=(2dv-du)/(32√2)`,
`y=(2dv+du)/(32√2)`.

Extensions over pixel-v9 (as in pixel-v11): `colliders` (exact solid boxes of `obelisk-broken`, the two gate posts and
the standing chunks of `fence-broken-*`, world units relative to the footprint centre), `passage` (the gate's
walkable 2.5u box), `axis` (the -x/-y orientation), `canopy` (a tree's crown radius in u), `landmark`, `glow` and
`contact` (`corners`: every collider's front, screen-left and screen-right ground corner lies within 1.6 px of the
drawing; `loose`: organic edge; `none`). The role `low` is new: it is a collider like `solid`.

## Ground surface

`manifest.surfaces.cemeteryEarth` follows the pixel-v6 surface contract: sample at `worldXZ / 4` with repeat.
Image columns run along world +x and rows along world −y (textures load with `invertY`). It is the camp meadow's own
hues (6 of its colours are `campGrass` colours) pushed darker under the grove, with short blade clusters,
dark soil patches and sparse fallen leaves lit on their +row side. Every feature wraps across the tile edges.

## Rebuild and verify

From the repository root (tested with Python 3.14.4, Pillow 12.3.0):

```sh
python3 -B scripts/build-cemetery-assets.py
python3 -B scripts/build-cemetery-assets.py --verify-only
node --test tests/cemetery-assets.test.js
```

`--verify-only` redraws every delivered file in memory, compares bytes, writes nothing and exits non-zero on any
difference. Byte identity is guaranteed only with the recorded Pillow version.

## Limits

- Programmatic drawing: stones are heightfield masses with rounded, chipped tops; carvings are one-pixel grooves.
  Glyphs are 3 × 4 pixels, so they read as marks, not as script.
- No animation: the lantern glow is static.
- The gate passage is see-through, but billboard sorting cannot put an actor between the posts in front of the far
  post; the layout should rely on the renderer's translucency, as for the ruins arch.
- `obelisk-broken`, `stone-lantern-toppled`, `urn-pair`, `urn-broken`, `offering-stone`, the cairns and the yews have
  one drawing each; mirroring them puts their lit faces on the shaded side. `stepping-slabs` runs along world y; a
  mirrored copy runs along x with the slab lips lit from the wrong side (a small effect on flat stones).
- Colliders and placement are the cemetery layout's decision; footprints are the drawing contract.
