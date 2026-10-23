# Faster travel and fuller outdoor locations

User request: the monk runs a little too slowly; locations feel empty, especially
the sandy tiles. This is a refinement of the established simplified pixel-art,
fixed-isometric outdoor RPG. The user has delegated routine art/implementation
choices and visible Codex team coordination. No additional approval round is
needed for this reversible pass. Values below are coordinator choices.

## Target

- Run at **4.4u/s**, from 3.5u/s (+25.7%). Keep dash, enemy and attack timings;
  keep the existing 0.38 movement multiplier during attacks. Distance-driven
  animation should naturally keep pace. Preserve normalized diagonal movement,
  collision, pause and input behavior.
- Replace dominant yellow sand with muted green countryside and compacted brown
  paths. Terrain should have broad coherent patches and irregular transitions
  finer than the gameplay grid, not a checkerboard of grass/soil squares.
- Camp: grassy clearing, worn earth around fire/tents/supplies and a legible exit
  trail. Road: grass margins, narrow worn trail, pale pebbles and plant clusters.
  Courtyard: weathered gray stone remnants mixed with moss/soil, still outdoors.
- Add restrained low vegetation, wildflowers, fallen leaves/twigs and flat stones
  in groups across all three locations. Keep interactions, path centers and combat
  tells readable. New decorative details do not introduce movement blockers.
- Preserve the current walk masks, colliders, central props, portals, encounters,
  HUD, camera scale and the continuous outer ground. Existing large sprites stay.

## User refinement — continuous outdoor ground

The user explicitly rejected location borders made of tall cubes/platform sides.
This later instruction supersedes the earlier preserve-height choice. Across camp,
road and courtyard, both playable and surrounding ground lie on a continuous 0u
plane; remove the vertical terrace/perimeter geometry. Preserve walk masks,
colliders, portal IDs, encounters and central props. Camp retains its natural
border. Road/courtyard receive irregular natural boundary groups of existing
vegetation, rocks and localized ruined fragments, outside clear walkable corridors.
The user reinforced forests, fences, rocks and mountains as examples of natural
boundaries. For this pass use the existing art: forest/thickets at camp, varied
tree and boulder groups on the road, localized ruined enclosure remnants at the
courtyard. Vary the segments and density rather than repeating one border object.
No continuous high box-wall perimeter. Keep portal approaches open and natural
props visibly supported; boundaries should read through the environment rather
than unexplained stops in empty grass. Reuse existing art, with no new generation.

## Art and rendering contract

New package: `assets/game/pixel-v6/country/`. Keep all older packages untouched.
Ground PNGs `grass.png`, `soil.png`, `stone.png`: 128×128, opaque, limited palette,
seamless repeat, low contrast, square top-down texture (not an isometric diamond).
Each covers about 4 world units at the established 32px/u texture density.

`details.png`: 4×2 atlas of 64px cells, 256×128, anchor [32,56], binary alpha,
zero RGB under transparent pixels. Frames, in order: `grass-low`, `grass-wide`,
`fern-low`, `flowers-white`, `flowers-ochre`, `leaves`, `twigs`, `pebbles-flat`.
Low silhouettes (roughly 10–28px high); these are foot-level decoration, not
trees, bushes or boulders. Reserve path centers from upright vegetation; sparse
flat leaves/twigs/pebbles may occupy broad paving between reserved points, at
least 2.2u from interactions and encounters. These quiet traces keep the courtyard
from having only a few plants at its edges. Provide hit masks in the existing package convention,
manifest, actual sources/prompts, repeat/contact previews and deterministic
normalization/verification. New generated work must use built-in image generation;
do not silently switch to a paid CLI/API path. Coordinator selects the visual target.

Runtime keys: `countryGrass`, `countrySoil`, `countryStone`, `countryDetails`.
The renderer owner registers assets and handles disposal/loading consistently with
the existing engine. Use world-coordinate material variation and irregular,
pixel-resolved transitions. Keep generation deterministic and batch ground detail
where practical; avoid thousands of unique materials. No new dependencies.

## Acceptance

Tests cover measured movement at multiple timesteps/diagonals and collision,
terrain determinism and surface continuity, clear reserved approaches, new asset
contracts/loading/disposal. Existing gameplay and full quest must still work.
Inspect actual Chrome gameplay and staged positions in all three locations at
regular, small and ultrawide sizes. Compare against the prior sandy scene and
the original camp illustration; reject a mere recolor with square edges intact.

The existing Paper camp boards remain a historical accepted layout snapshot.
Keep their source data/exports intact; new screenshots document this visual pass.
No new Paper authoring, new gameplay systems or full location redesign is required.
No Git initialization, publication, dependency installation or AGENTS.md edits.
