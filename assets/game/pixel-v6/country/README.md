# Country ground and low details

Coordinator-approved visual target for the 2026-10-23 ground polish pass.
New original drafts use the built-in `image_gen.imagegen` tool exclusively.
Original PNGs, exact prompts, actual tool input references and generation records
are preserved in `source/`. The Python build only normalizes those saved images.

## Renderer contract

- `surfaces.countryGrass`: `grass.png`, opaque 128×128 sage/olive grass.
- `surfaces.countrySoil`: `soil.png`, opaque 128×128 compacted brown soil.
- `surfaces.countryStone`: `stone.png`, opaque 128×128 muted gray worn stone.
- `countryDetails`: `details.png`, 256×128; four columns and two rows of 64px cells.
- Frame order: `grass-low`, `grass-wide`, `fern-low`, `flowers-white`,
  `flowers-ochre`, `leaves`, `twigs`, `pebbles-flat`.
- Detail anchor: `[32,56]`, one pixel below the final opaque row. Register all
  frames at this ground point. Native density is 32px/u; each surface spans 4u.
- Nearest filtering, no mipmaps. Detail alpha is binary, transparent RGB is zero.
  `hit-masks.json` uses the existing filename-keyed, row-major, low-bit-first
  packed alpha-mask convention. These decorations create no movement blockers.

Each ground texture has 20 colors, with identical opposite-edge pixels.
The eight details share a 32-color palette. Their visible heights range from
11 to 19 pixels. Flowers are small isolated accents; placement density and
interaction clearance belong to the renderer owner.

## Rebuild and verification

Run from the repository root, using the existing Python/Pillow installation:

```sh
python3 -B scripts/build-country-assets.py
python3 -B scripts/build-country-assets.py --verify-only
node --test tests/country-assets.test.js
npm test
```

Verified with Python 3.14.4, Pillow 12.3.0 and Node v24.13.0. No new dependencies
were installed. The normal build writes only this package. `--verify-only`
checks source and builder hashes, reconstructs 27 managed outputs in memory,
and compares exact bytes without creating or rewriting files. It works after
copying this package and the build script into another checkout, including
paths with spaces. Tests also reject corrupted source prompts and output PNGs.
Byte-identical reproduction is verified for the recorded Pillow version;
other versions are not claimed to emit identical PNG bytes.

`source/normalization.json` specifies the source crop/fit policy, mean RGB grade,
contrast, palette limits and four-pixel symmetric seam repair. The build uses
nearest-neighbor resize without dithering. It does not draw replacement art.

## Visual proof

- `previews/representative-target.png`: original approved grass/soil/tuft target.
- `previews/contact-native.png`, `contact-2x.png`: all eight delivered frames
  beside the existing monk, with unchanged relative pixel sizes.
- `previews/*-repeat-native.png`: actual final surface pixels repeated 3×3.
- `previews/surfaces-repeat-native.png`: the three repeat panels together.
- `previews/native-context.png`, `native-context-2x.png`: 2:1 art compositions
  with the monk and sparse details; these are explicitly not gameplay captures.

The art owner inspected the native contact sheet, repeated surfaces and context
at 2×. Actual scene transitions, camera behavior, final placement and browser
acceptance remain with the coordinator and renderer owner.
