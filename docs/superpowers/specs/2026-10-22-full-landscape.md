# Full landscape and first playtest pass

## Intent and authorization

The user approved continuing with balance and route content, then identified the immediate visual defect: locations look like disconnected fragments in black space, unlike the filled concept scenes. The coordinator is authorized to direct the visible Codex team and make routine implementation/art decisions. Preserve the selected simplified pixel art and dimensional 2:1 isometry.

Root cause: `buildPixelWorld` treats the walkable tile mask as the entire visible world. It draws shallow exposed tile boxes and a few props; the camera follows the player beyond that geometry, exposing the scene clear color. Fix the world composition, not just the clear color or camera crop.

## Visual target

Latest explicit user constraint: no dungeons or crypts; all gameplay takes place outdoors in the ordinary world. Camp, natural road and the roofless ruined courtyard remain open-air locations. Lower terrain tiers are outdoor topography, not underground rooms or cave entrances. Vegetation, soil and restrained natural ambient light must make this clear.

Primary reference: `assets/concepts/pixel-art-01/p4-pixel-monastery.png` (and its raw original). It fills the view with layered cliff country, lighter paths, ruined stone architecture, trees and a warm camp. Supplement with the environment kit and existing production actor/world art. Existing accepted concepts/Paper boards must not be edited.

- Camp is a grounded clearing: earth/grass, stone path and gathering area, pitched shelters, supplies, rocks/vegetation and the warm fire. The campsite is part of surrounding terrain.
- Road crosses broad, irregular rocky terraces. Lighter paving/dirt routes guide the player, with room beside them for combat. The western branch remains optional. Lower terraces, cliff faces, trees and distant ruins fill space between and around routes.
- Monastery is a courtyard within architecture: side/rear walls, broken wings, ground outside the court and visible approach. Foreground boundaries stay low or fade when they cover actors. Ritual, combat warnings and exits remain readable.
- All rendered viewport corners must meet intentional terrain/scenery for valid player positions, including spawns, exits and outer walkable edges at 800×600, 1024×768, 1440×900 and 2560×1080. Preserve a small canvas rounding gutter only; no large scene-clear-color void.
- Ground extends beyond movement space. Actual movement boundaries are communicated by cliff drops, walls or dense boundary scenery rather than invisible barriers across visually continuous open ground. No infinite new playable plane.
- Quiet dark ground and grouped detail keep actors readable. Avoid uniform checkerboard paving, a flat replacement color, dense random clutter and huge new per-tile draw-call counts.

## Gameplay pass

Keep camp → road → courtyard → return/reward, three existing hero actions, both monster types, optional cache/shrine, 18 appearances and the existing HUD. Broaden playable clearings and separate path appearance from the walk mask. Improve first-encounter sequencing and readable recovery windows based on the previous acceptance observations. Prefer distinct encounter spaces and safe approach lines over inflated enemy HP, forced waiting or arbitrary gates. The worker proposes exact balance/encounter changes; the coordinator records the selected values before implementation. No promise of 5–10 minutes until observed in play.

## Contracts and ownership

- Gameplay owner: `src/campaign.js`, `src/game.js`, `src/world.js`, their gameplay tests. Preserve existing public simulation/interaction APIs and legacy `createGame()` fixtures. Each adventure world additionally exposes `paving: Array<{x,y}>`, a subset of `tiles`, describing the visibly paved route/space. `tiles` is the full walkable plateau, not the whole visible environment. Existing positions of portals, entries, cache/shrine and ritual stay stable unless explicitly ruled otherwise. Rendering must consume geometry dynamically.
- Art owner: `assets/game/pixel-v4/landscape/`, `scripts/build-landscape-assets.py`, `tests/landscape-assets.test.js`. Publish `manifest.json` with `schemaVersion:1`, `nativePixelsPerUnit:32`, `landscape` atlas metadata and `surfaces` metadata. `landscape`: path `landscape.png`, cell 160, columns 4, rows 2, anchor [80,144], frames exactly `cypress`, `dead-tree`, `rock-large`, `rock-small`, `shrub`, `grass`, `ruin-pile`, `supplies`; nearest, no mipmaps. Eight static drawings, with native sizes appropriate to the monk. `surfaces` keys `earth`, `moss`, `cliff`, each with path `<key>.png`, size [32,32], nearest/no mipmaps; opaque and seamless when repeated. Export `hit-masks.json` keyed `landscape.png` in the established packed format. Binary prop alpha, at most 48 opaque colors for the prop family and 24 per surface. Save originals, exact prompts, recipes, provenance, native/2× contact sheets and 3×3 surface-repeat previews. ImageGen supplies raster drafts; normalize deterministically. No edits to v1/v2/v3 assets.
- Renderer owner: `src/render.js`, `src/pixel-scene.js`, `src/pixel-assets.js`, new focused `src/landscape.js` if useful, renderer/landscape tests. Register `assets.landscape` plus `assets.earth/moss/cliff`; preserve asset readiness and appearance retry. Fill terrain around/between plateaus, build proper cliffs and themed scenery from the existing/new packages. Derive content placement from `world.tiles/paving` and current interaction positions. Terrain decor must not modify simulation state or create unrepresented collision. Dispose all owned resources on transitions; preserve picking and actor occlusion.
- Coordinator owns spec/plan, baseline, review packages, browser, shared docs and acceptance. Workers must not operate the shared browser/Paper or spawn other agents.

## Verification and limits

Baseline: `/private/tmp/night-ritual-pre-landscape-20261022`, 457 files. No Git repository exists: retain file ownership and immutable baseline; no Git initialization, dependency additions, publishing or AGENTS.md changes. Default CLI model/config remains unchanged. Node tests and Vite build are already installed.

Meaningful checks cover actual geometry/camera coverage, path/plateau connectivity, no blocked interaction approaches, ranged shot/attack behavior after tuning, deterministic scenery placement, resource disposal and native asset integrity. Visually inspect the three locations against the primary concept, not merely successful rendering. Exercise a route through the game, optional branch, backtracking and source/reward. Review the integrated diff independently, fix material findings and record actual pacing/limitations.
