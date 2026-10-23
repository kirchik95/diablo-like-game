# Natural monster groups and a wider camera

## User intent

The user approved replacing visibly regimented monsters with controlled random placement, soft separation and varied approaches. They also asked to move the camera a little farther away because actors and props look too large. Prior constraints remain: simplified pixel art, fixed isometry, all ground at 0u, one continuous outdoor region, monsters only, safe camp. The user has delegated implementation and visible-agent orchestration; execute without another approval gate.

## Chosen implementation scope

- Preserve 34 monsters, their six pack IDs/counts/species, source gating, damage, telegraph durations, player movement/combat and world topology.
- Sample irregular spawn positions within authored pack regions with minimum spacing, collision clearance and reserved interactions. Generate once per run with an unsigned32 seed, never per frame. IDs remain stable. All placements must be reachable and outside camp/seam buffers.
- Root exports `DEFAULT_WORLD_SEED`, `createOverworld(seed = DEFAULT_WORLD_SEED)` and the existing `OVERWORLD`, `getOverworldZone(x,y)`. The default seed returns the same OVERWORLD reference. Other seeds produce frozen worlds sharing static geometry but with their own zone/combined encounters and `seed`.
- Simulation entry point becomes `createAdventure(appearance = {}, { seed = DEFAULT_WORLD_SEED } = {})`; `game.seed` records the actual world seed. Deterministic API default keeps probes reproducible. Normal UI passes a new seed once per fresh run; `?seed=12345` requests repeatable placement. Root owns UI selection of seeds.
- Hounds approach from stable varied offsets relative to the player, bending their path only where walkable/visible. Near contact they attack normally; no rigid surrounding ring, excessive circling, perfect formation or enemies waiting their turn. Wraiths keep useful shooting distance and can take a nearby firing angle when crowded; they remain catchable.
- Soft local separation applies to movable hounds AND wraiths before severe overlap. It must obey world collisions/safe area, be bounded and deterministic, and not slide actors during windup/leap/recovery/stun/death. Returning monsters must still settle at home without healing. Retain the bounded pathfinding budget.
- Initial facing and a small deterministic initial reaction offset may vary. Do not randomize telegraph lengths or attack damage. Ambient patrols and a combat director are outside this iteration.
- Camera target: about17% smaller world images, implemented as orthographic extents ×1.2 (same viewport shows20% more per axis). Keep fixed angle, asset world sizes, pixel-art nearest filtering, integer framebuffer-to-CSS scale and HUD size. Actual asset scale remains32px/u; effective camera projection becomes32/1.2px/u. Update alpha picking and occlusion to use projected scale. No camera zoom UI needed.

## Success criteria

- Same seed repeats placement; multiple seeds differ, keep all34 safe/valid/reachable spawns and pack constraints, and remove authored rows.
- Crowd probes show hounds approach from varied sides and nearby movable hounds/wraiths separate without illegal motion, global aggro or changed telegraph timing. Real combat remains responsive and the entire quest is completable.
- Camera view is visibly wider. Ground aiming, opaque actor picking, scenery occlusion and HUD remain correct at small/default/wide desktop sizes.
- Full tests/build pass, browser screenshots and real combat checked, immutable independent review performed. Existing assets and AGENTS.md remain byte-identical. Paper's old coordinate plan is explicitly historical after randomized spawns; do not silently edit its source package.

## Ownership

Root: overworld/placement modules and tests; main/UI seed integration; QA fixtures, docs and integration. Existing neighboring Codex: game.js and new enemy-steering module plus gameplay tests/route. New camera Codex: render.js, pixel-picking.js and relevant renderer/picking tests. No shared edits, dependencies, Git initialization, publication, Paper edits or nested agents.

## Review refinement — adaptive ground details

R2 identified that the existing `countryGroundCover` rule leaves gaps around encounter positions. Those gaps now follow the seeded spawns, so a small number of non-colliding grass/detail sprites may differ between runs. Keep this existing readability rule. Height, collision, surface mask, large scenery and authored geometry stay fixed. “Unchanged terrain” refers to those properties, not an identical list of decorative ground-cover sprites. This is an explicit, accepted minor visual variation, not procedural regeneration of the map.
