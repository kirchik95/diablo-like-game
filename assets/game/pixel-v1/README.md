# Pixel courtyard assets

The playable set follows the approved Paper pixel-art references in `assets/concepts/pixel-art-01/raw/`. Generated with the built-in imagegen tool on 2026-10-22; the original PNGs and exact prompts are retained in `source/`. No external stock assets are used.

| Resource | Layout | Purpose |
| --- | --- | --- |
| `monk.png` | 4 × 4 cells, 96 px | Front/back poses, mirrored for four facings |
| `hound.png` | 4 × 2 cells, 96 px | Eight poses, mirrored left/right |
| `environment.png` | 3 × 2 cells, 160 px | Wall, arch, column, two braziers, shrine |
| `floor.png` | 32 × 32 px | Code-authored paving tile |

`manifest.json` records frame names, dimensions, pivots and provenance. `hit-masks.json` stores packed opaque pixels for pointer targeting and scenery visibility. `contact-sheet.png` previews the atlases at native scale. Character pivots are `(48, 84)`; scenery pivots are `(80, 144)`.

Rebuild from the repository root with `python3 scripts/build-pixel-assets.py` using Python 3.10+ and Pillow >=10,<13. The script performs measured cropping, nearest resizing, palette reduction and binary-alpha validation. It does not call a generation service. Runtime loads only the four atlas/tile PNGs; source images and the contact sheet stay out of the build.

These are prototype keyframes. The monk has four run frames; the hound has two facings. More in-between frames, full directional hound animation and customization layers remain future art work.
