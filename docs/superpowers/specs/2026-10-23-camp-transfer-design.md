# Camp plan and playable transfer

## Intent and authority

The user told the studio team to proceed after discussing complete Paper locations
and transferring the first camp into the game. The accepted visual reference is
`assets/concepts/camp-location-01/camp-scene.png`. The user delegates routine
production decisions to the coordinator. Continue without a new permission loop.
Retain Babylon.js, JavaScript, 32 native pixels per world unit and the fixed camera.

Deliver a complete, labelled Paper plan and a materially closer playable camp:
large cloth tents, real animated fire, grouped supplies, vegetation and rock borders,
a free central clearing and a single outbound path. All activity remains outdoors.

## Scope

- Camp only: change its geometry, placement and presentation. Keep road/courtyard,
  all combat rules, 18 appearances, HUD and existing transition IDs stable.
- A single `CAMP_LAYOUT` data export in `src/camp-layout.js` supplies gameplay,
  render placement and Paper plan. Exact values come from the reviewed layout
  proposal; freeze them before artboard production and renderer integration.
- Target roughly three to four viewport areas at 1280×720 or 1920×1080. This is
  the coordinator's sizing choice, not a previously approved measurement. Measure
  actual footprint and travel time rather than stretching a path to meet a claim.
- Natural grass/earth, low ledges and visible rock/vegetation boundaries. Avoid
  enclosing the camp in a tall sheer platform wall. Preserve complete camera coverage.
- Tent entrances face the clearing. Actor scale stays coherent with collision;
  larger tents/trees establish scale instead of shrinking only the actor graphic.
- Exclude new NPCs, shops, quests, menus, inventory and additional exits.

## Shared contracts

`CAMP_LAYOUT` exports regions, pavingRoutes, spawn, entries, exit, reward,
pillars/braziers and explicit setDressing placements. A placement has id, kind,
x, y, scale, flip and optional collider using the world collision primitives.
Large props on otherwise walkable ground have matching collision. Low grass is
traversable. Reward and transition targets have unobstructed approach points.

New runtime package: `assets/game/pixel-v5/camp/manifest.json`, schemaVersion 1,
nativePixelsPerUnit 32. `camp` atlas: `camp.png`, cell 256, columns 3, rows 2,
anchor [128,232], frames in order `tent-left`, `tent-right`, `road-marker`,
`campfire-base`, `supply-cache`, `fallen-log`. `campFlame`: `camp-flame.png`,
cell 128, columns 4, rows 1, anchor [64,112], four distinct looping flame frames.
Nearest filtering, no mipmaps, binary alpha, <=64 opaque colors for static atlas,
<=24 for flame. Masks keyed by those filenames in `hit-masks.json`.

Tents fit roughly 190–220 native pixels across and 140–170 tall. The base and flame
have a shared ground anchor and render together. Produce meaningful changing flame
poses with a stable base, not frame labels or duplicate drawings. Reuse existing
landscape props for vegetation/rocks. Keep originals, exact prompts, reference
copies or relative reference paths, normalization and reproducibility checks.

Paper gets a new page in file `01M5JE4QF1S7K7921DAQTPSHYY`. Existing pages unchanged.
The complete plan uses exact layout coordinates, an editable legend, traversable
area, obstacle footprints, spawn, fire, reward, two tents, markers and one exit.
Include a complete isometric composition using the same placements and final
assets, plus clear camera/scale notes. The previous illustration remains a visual
reference. Save real Paper exports and source layout data locally.

## Quality and preservation

Gameplay tests verify geometry connectivity, obstacle clearance, portal round trips
and reward approach. Art tests decode actual frames and masks. Renderer checks cover
loading, foot anchors, prop collision consistency, animated flame, occlusion,
viewport coverage and resource disposal. Use actual browser views at center, exit
and outer boundary; verify the camp-to-road round trip and complete quest API route.

No Git repository exists. Use exclusive file ownership and immutable baseline
`/private/tmp/night-ritual-pre-camp-transfer-20261023` (539 files). Do not initialize
Git, add dependencies, publish, edit AGENTS.md or overwrite previous art packages.
Browser is coordinator-owned. Paper is reserved to the designated plan artist.
No nested agents. Final read-only review precedes acceptance.

## Coordinator selection, 2026-10-23

Accepted the proposal's 1,534-tile shape (3.409 × 450u² viewport areas), north
entry `(0,-22)`, exit `(0,-27)` and shared low boundary belt. Revised the central
cluster so the actual artwork's entrances face inward:

| Object | Ground/collider center |
| --- | --- |
| tent-left, entrance toward +Y | `(5,-5)` |
| tent-right, entrance toward +X | `(-6,4)` |
| fire | `(-3,-2)` |
| supplies | `(6,5)` |
| fallen log | `(-3,2)` |
| spawn | `(0,3)` |
| reward interaction | `(4,5)` |

Short paths and approaches must follow this cluster. Keep these centers stable;
derive render-anchor offsets and obstacle extents from the measured final art.
The proposal's provisional `5×4` tents and `(+2.25,+2.25)` offsets are superseded:
the first measured tent is approximately `3×5u`, with its collider center around
`(-1.65,-1.73)` relative to the sprite anchor. Measure the right tent separately.
Do not reshape artwork to fit an earlier guessed collision rectangle. Recompute
navigation counts and travel times after the final registration.
