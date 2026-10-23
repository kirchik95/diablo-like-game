# Animation integration: first playable set

The user approved continuing from the completed Paper artbook to usable game sprites while away, with the main agent acting as studio lead. This stage makes the existing courtyard's actors, effects and interactive scenery move like the approved designs. Babylon.js, Vite, dimensional isometry and the current combat remain the foundation.

## Scope and presentation

- Monk: idle, six-key run, three distinct six-key palm attacks, six-key dash, six-key wave, four-key hurt, six-key death. Preserve four logical facings using separately authored front/back views and horizontal mirrors. Reference is `assets/concepts/animation-bible-01/hero/`; use the corrected run, not its rejected drafts.
- Hound: four-key alert idle, six-key run, six-key telegraph/leap/recovery, four-key hurt, six-key death. Two authored front/back views and mirrors. Reference is the artbook's hound originals.
- Existing scenery: six-key cyan/magenta braziers, shrine activation to spent state, and opening gate. Existing walls, columns, floor and collision footprints remain in use.
- Impact, ground-warning and amber-healing effects use the six-key artbook sequences. Keep the wave's spatial readability and the existing damage numbers.
- Source cleanup must yield stable actor size, grounded feet, binary transparency, no background rectangle, nearest filtering, no mipmaps, and readable silhouettes at native resolution. Author missing back views using the existing approved character references; retain prompts and original outputs.

The main agent chooses this bounded set because these actions already exist in the playable courtyard. Revive, new enemy species, inventory, customization, new maps and additional gameplay screens belong to later stages.

## Behavior

Combat numbers and input remain unchanged. Palm contacts occur at 90/110/160 ms and end at 290/320/420 ms; dash lasts 200 ms; wave damage is immediate. Hound windup/leap/recovery last 550/270/700 ms. Animation follows those events rather than changing simulation to suit the drawings. Locomotion follows traveled distance; pause freezes presentation; a new run clears animation state. Death can finish visually after simulation stops, then holds its last pose. Hurt cannot delay control or replace a higher-priority dash/death pose.

Gate opening begins when the last hound dies; shrine activation begins on its single healing event. Occlusion fading, alpha-aware body picking, high-DPI pointer projection, integer pixel scaling and reduced-motion behavior must continue to work.

## Asset contract

Two independently owned packages: `assets/game/pixel-v2/monk/` and `assets/game/pixel-v2/hound-world/`. Each has `manifest.json`, `hit-masks.json`, normalized PNG atlases, source/provenance, and native-scale previews. No shared manifest is edited by artists.

Both manifests contain `schemaVersion: 2`, `nativePixelsPerUnit: 32`, and named atlas entries (`monk`, or `hound`, `world`, `effects`). Each atlas has `path`, `cell`, `columns`, `rows`, `anchor`, `frames` (names), `clips`, `filter: "nearest"`, `mipmaps: false`. `clips` maps names to `{front: [absolute frame indices], back: [indices]}`; world/effect clips need only `front`.

Monk clips: `idle`, `run`, `attack1`, `attack2`, `attack3`, `dash`, `wave`, `hurt`, `death`. Hound clips: `idle`, `run`, `attack`, `hurt`, `death`. World clips: `brazier-cyan`, `brazier-magenta`, `shrine`, `gate`. Effect clips: `impact`, `warning`, `healing`.

Actor cells are 96×96 with anchor [48,84]; monk neutral height about 60–64 px; hound neutral width about 65–80 px. World cells are 160×160, anchor [80,144]; effects use 192×192, anchor [96,96]. Permit transparent padding, no clipping; shared body scale within a clip, no per-frame stretching. Filenames `monk-v2.png`, `hound-v2.png`, `world-v2.png`, `effects-v2.png` uniquely key packed alpha masks. Mask format matches v1: `{filename: {width, bits: base64 little-bit-first opaque pixels}}`. Keep each atlas below 2048×2048 and a deliberate palette (characters ≤48 opaque colors, world/effects ≤64).

## Acceptance

Readable animated game in Chrome, a developer-only animation preview for visual QA, all existing meaningful regression checks retained, focused tests of new animation timing/reset/picking, production build succeeds, and an independent review of the resulting changes. Preserve Paper boards and original concept files. Existing `AGENTS.md` must not be edited. No new dependencies or publishing are needed.

## Added user request — HUD

The user additionally requested a HUD in the game's style. Restyle the existing interface with restrained cut-stone framing, charcoal/gray-violet surfaces, ivory readable text, coral attack/health accents, cyan spiritual abilities and amber objectives/healing. Replace generic thin line skill glyphs with clear stepped/pixel silhouettes. Health, cooldown numbers, combo progression, quest count, minimap, pause and sound must remain clear and functional. Keep the center of the playfield open; reduce tiny labels and ornamental noise. Carry the same restrained treatment into the existing welcome/pause/end panel without adding screens, controls or mechanics.

HUD uses native HTML/CSS/SVG and existing local resources; no new dependency or external font service. Preserve DOM IDs and hooks consumed by main.js. Test layout at 1440×900, 1024×768 and 800×600, plus the existing narrow/coarse-pointer notice. Vital text and keyboard labels should generally be at least 11–12 CSS px at supported desktop sizes. Decorative wrappers must not intercept aiming; real buttons retain keyboard focus and ARIA labels.
