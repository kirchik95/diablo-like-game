# Continuous outdoor world and monk combat

## Intent and authorization

The user now wants an apparently open world without interaction-driven location transitions, more monsters, and combat closer in rhythm to Diablo 3. They also rejected platform-like cube edges and requested natural boundaries. This supersedes the old connected-location transition requirement. Existing delegated studio-lead execution remains authorized, including visible Codex workers and a Claude worker for Paper art.

## First playable scope

- Keep Babylon.js, fixed isometric pixel-art presentation, current appearance selection and outdoor theme.
- One persistent world contains the camp, road, side trail and monastery courtyard. Moving across their borders never teleports the player, clears input, resets enemies or rebuilds the scene. Area names remain useful HUD labels.
- Reuse the existing local layouts at integer offsets: camp (0,0), road (0,-51), courtyard (0,-85). Their walkable tiles connect directly. Preserve the camp composition and existing assets; use the combined outer footprint for natural borders. No portal rings or E-to-travel labels.
- The combined walkable extent is approximately 41 by 120 units. This is the first region, not an infinite or fully streamed world. All ground is level; forest, rocks and intermittent ruins describe the external boundary.
- User explicitly reaffirmed that the entire location must remain on one level. Ground inside and outside the playable footprint is exactly 0u: no slopes, stairs, terraces, raised platforms or painted edges suggesting a rise. Isometric volume belongs only to props, trees, rocks, buildings and actors. The Paper plan follows the same rule.
- Populate 34 ordinary monsters: 22 on the road/side trail and 12 in the courtyard, in recognizable groups of 4–6. The camp remains safe. Existing hound and wraith art is reused; new species and bosses are out of scope.
- Monk attacks flow as a faster three-hit cleaving combo. Connected strikes generate spirit; the circular wave spends it. A damaging dash passes through crowds while respecting world collision. Hold left click to continue attacking; Q/right click casts the wave; Space dashes.
- Coordinator tuning choices, subject to playtest: move speed 4.4u/s, attack movement multiplier .65; combo damage 24/30/48 with durations .22/.24/.31s; hound 64HP, wraith 76HP; spirit 100 maximum/60 initial, +12 per connected combo strike (once per strike), wave costs 40 and has 1.2s cooldown, radius 3.4 and damage 72; dash retains 13u/s for .2s and 1.2s cooldown, dealing 32 damage once per enemy per dash.
- Add a modest health pickup from each fourth ordinary kill (+18HP); no separate loot/inventory system. Keep clear windups, projectile collision, short impact feedback and reduced-motion behavior. Avoid world-wide pack aggro and offscreen CPU-heavy pathfinding.
- Preserve quest: clear courtyard guardians to unseal the source, destroy it, walk back and claim the amber bead. Road enemies do not seal the source. State persists everywhere.

## Data and ownership contract

Root owns `src/overworld.js`: exports immutable `OVERWORLD` and `getOverworldZone(x,y)`. `OVERWORLD.zones` contains complete translated local records (id, title, subtitle, offset, tiles, paving, regions, obstacles, setDressing, points), all in global coordinates; individual zone portals are empty too. Combined world fields retain the existing world shape and add `safeArea: {maxY:24,minY:-29.5}` and global encounters with `zoneId`/`packId`. Do not infer area from world.id.

Gameplay worker owns `game.js`, optional focused combat helper, and gameplay tests. `createAdventure()` uses OVERWORLD; `game.locationId` reports current area, `game.world` remains OVERWORLD and `locationRevision` stays stable. `_locations` may remain read-only-compatible views of shared enemies for existing consumers. Export `MONK_RULES` from the combat helper or game.js so HUD/rendering never duplicates new tuning values. Health pickups are `game.pickups` records `{id,x,y,amount}`; collection emits `pickup` and `heal` events. Events may include `strength: 'light'|'heavy'` and `source`.

Renderer worker owns landscape/country/pixel-scene/render/animation files and renderer tests. Root owns main/input/styles/index, overworld data tests, integration QA and documentation. Paper worker owns only a new Paper page and `assets/concepts/open-world-01/` plus its report. No shared-file edits.

## Acceptance

Prove walking and dashing across both area borders in both directions without E, scene replacement, position jump or state reset; verify source gating and return reward. Test pack activation/leash, multi-target hits, once-per-target dash, spirit cap/cost and pickups. Test/inspect natural borders, seamless surface transitions, actor readability and small/normal/ultrawide views. Run the complete test suite and production build after integration, then review the frozen patch. Preserve AGENTS.md and prior art byte-for-byte.
