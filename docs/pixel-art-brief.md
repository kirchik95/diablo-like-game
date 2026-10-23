# Pixel Art Technical Brief

## Game frame

Browser action RPG, Babylon.js WebGL, fixed orthographic 2:1 isometry. The first scene is a small monastery courtyard with one monk and one spiny hound. Movement, palm combo, dash and spirit wave use the existing simulation.

## Visual system

Follow `assets/concepts/pixel-art-01/raw/`: an adult bald monk, ivory wrap, burgundy sash, charcoal trousers, bronze cuffs. Hard pixel clusters and dark purple outlines. Upper-left light. Muted purple stone supports an immediately readable ivory hero. Coral marks palm attacks, cyan marks player energy, magenta marks enemy danger and amber marks healing. No hostile humans, smooth vector characters or chibi proportions.

## Technical contract

- Hero approximately 60–64 native pixels tall; one shared scale across all poses.
- Monk/hound atlas cells: 96 × 96, foot anchor (48, 84). The game loads the monk from `assets/game/pixel-v10/monk-side/`: 10 × 11 cells, 110 keys; rows 0–9 equal the v2 atlas byte for byte. Environment cells: 160 × 160, anchor (80, 144).
- Monk: 50 front and 50 authored back keys, nine named clips; hound: 26 front and 26 authored back keys, five clips. Horizontal mirrors provide four logical directions. Both use six-key locomotion; attack, hurt and death follow actual gameplay events.
- World: six keys each for cyan/magenta braziers, shrine and gate. Effects: six keys each for impact, warning and healing, in 192 × 192 cells with anchor (96, 96).
- Transparent atlases: PNG RGBA, binary alpha after normalization, ≤48 opaque colors per actor atlas and ≤64 per world/effect atlas. The opaque paving tile is RGB. Source sheets are retained separately.
- Nearest sampling, no mipmaps, no lossy compression. sRGB artwork with unlit sprite materials. Native world density 32 px/unit, integer CSS upscale.
- Animated resources live in `assets/game/pixel-v2/{monk,hound-world}/`; static floor, walls and columns remain in `pixel-v1`. Source images and prompts are never loaded by the game.
- Each v2 package has a schema-versioned manifest with scalar cell size, anchor, absolute clip indices and unique atlas paths, plus packed alpha masks matching the exact displayed frame. The detailed contract is in `superpowers/specs/2026-10-22-animation-integration.md`.
- Pause freezes presentation; a separate visual clock lets death finish after simulation stops. Restart clears timers and one-shot effects. No animation may delay player control or change damage timing.
- Beetle (`assets/game/pixel-v7/beetle/`): 128 × 128 cells, anchor (64, 112), 74 keys in nine clips (idle, walk, windup, slam, recover, hurt, stunned, death, block), 15 opaque colors. Front = SE, back = NE; SW and NW are mirrors. Hit masks use the wraith format.
- Facing: four diagonal art directions. A 15° screen-angle hysteresis keeps front/back and mirror choices stable. A running monk faces the movement; a standing monk and every strike face the aim. Monk idle and run also have a side view (E, mirrored for W) for headings within ±20° of screen-horizontal; it enters inside 15° and leaves beyond 25°, so keyboard diagonals (26.6°) keep the authored SE/NE drawings. Strikes, dash, wave, hurt and death keep four directions. Pure vertical runs still show a diagonal drawing.
- Monk run cycle: one key per 0.56u of travel (`MONK_RUN_KEY_DISTANCE`). Footstep sounds follow the same keys. On side runs the planted sole moves back exactly 18 px per key (32 px/u × 0.56u), so it does not slide. Some foot slide remains on diagonals and on vertical runs.
- Pixel lattice: the camera and all moving actors snap to one screen-pixel lattice. Simulation positions stay continuous. Rendering blends the last two 1/120 s steps (`src/render-interpolation.js`) before the lattice snap, so the drawn state lags the simulation by one step (8.3 ms).
- Contact shadows are generated at runtime: 2:1 pixel ellipses at 32 px/unit, a dark core, two alpha levels, nearest sampling. No blur.
- HUD and cursors: one HUD unit `--u` equals one world pixel. Cursor art uses 1 art pixel = 2 CSS px (`assets/ui/pixel-v4/cursor/`), so it does not grow with `--u` ≥ 3px. HUD text uses a system font; the pixel font in `assets/ui/pixel-v3/` was rejected and is not loaded.
- Camp panorama (`assets/game/pixel-v9/camp-panorama/`): 22 prop frames in 256 px cells (4 × 6 atlas, 1024 × 1536), registration anchor (128, 232), 55 opaque colors, footprints in `source/footprints.json`. Flat props (carpet, tufts) lie in the ground layer. `mountains.png` (2048 × 1280, 28 colors) wraps horizontally and is drawn only beyond the camp horizon, with 0.25 parallax. Two 128 × 128 camp surfaces follow the pixel-v6 surface contract. All of it is drawn by `scripts/build-camp-panorama-assets.py`; byte identity holds with the recorded Pillow version.

## Visual target

References: `p2-pixel-characters.png`, `p3-pixel-action-keyframes.png`, `p7-pixel-environment-kit.png`, `p9-pixel-monster-attacks.png`. Approved simplified pixel direction: user, 2026-10-22. Technical acceptance requires an in-game capture, readable silhouettes, stable pivots and matching collision bases. Source generation alone is not production approval.
