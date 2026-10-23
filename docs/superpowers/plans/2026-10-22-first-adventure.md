# First Connected Adventure Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development, adapted to the user's explicitly chosen visible external Codex team in Herdr. Coordinator accepts each owner's work and a fresh reviewer checks the integrated result.

**Goal:** Deliver a complete camp/road/monastery adventure with a ranged spirit, ritual quest/reward and light character creation.

**Architecture:** Keep the deterministic simulation separate from rendering. Location data drives collision, scenery and minimap; a run retains mutable state per location. Independent art and UI owners consume the shared contract while the renderer integrates location rebuilding and new sprite families.

**Tech Stack:** Installed Babylon.js, Vite, JavaScript, node:test, Python/Pillow asset normalization, ImageGen for missing artwork.

**Spec:** `docs/superpowers/specs/2026-10-22-first-adventure.md`.

## Global constraints

- No new dependencies, publishing, Git initialization, AGENTS.md edits or changes to accepted Paper/source artwork.
- Existing pixel style, 32px/unit, 2:1 orthographic view, nearest filtering/no sprite mipmaps and binary actor alpha.
- File ownership replaces worktree isolation because this directory has no Git metadata; immutable baseline is `/private/tmp/night-ritual-pre-adventure-20261022`.
- The user explicitly authorized implementation by the team while away. Routine design/art decisions are delegated to the coordinator; do not wait for another approval or open user questions.
- No nested agents or shared browser/Paper operation by workers. Send integration issues through owner reports. Preserve all other owners' changes.

## Review focus

1. Backtracking and repeated portal input preserve kills, secrets and shrine state without spawning inside obstacles or immediately returning.
2. Old attacks/projectiles and same-length enemy lists cannot leak across locations; scene objects and presentation state reset correctly.
3. Wraith shots respect obstacles, aim lock, dash invulnerability and pause at different update sizes.
4. Ritual cannot be damaged through its guardian lock; reward and secret cannot be claimed twice or before prerequisites.
5. Nondefault appearance remains selected in all views/animations and after restart; slow image loads cannot replace a newer selection.

## Task 1 — Simulation, world data and adventure progression

**Owner:** existing neighboring Codex. **Files:** `src/game.js`, `src/world.js`, new `src/campaign.js`; new `tests/adventure-game.test.js`, `tests/adventure-world.test.js`; `artifacts/adventure-gameplay.md`.

**Interfaces:** Produce the simulation/world/interaction APIs in the shared contract. Consume appearance as opaque normalized ids; no DOM/renderer imports. Publish `campaign.js` and API exports early. Preserve legacy `createGame()` tests.

- [x] Write failing tests asserting safe connected spawn→portal routes, a reachable optional fork, local state persistence on camp/road/court round trips, and no duplicate E transition.
- [x] Implement immutable location records and optional world parameters; verify those tests with `node --test tests/adventure-world.test.js`.
- [x] Write failing tests for wraith fixed 0.8s aim lock, one shot, obstacles/dash, source destruction only after guardians, secret/reward once, and fresh-run reset.
- [x] Implement `createAdventure`, `interact`, prompt/objective helpers and campaign combat; run `node --test tests/adventure-game.test.js tests/game.test.js`.
- [x] Inspect every main/optional route with actual radius constraints; document balance values, test evidence and integration fields in the report.

## Task 2 — Wraith and appearance art packages

**Owner:** art Codex. **Files:** `assets/game/pixel-v3/wraith/`, `assets/game/pixel-v3/appearance/`, new `scripts/build-adventure-assets.py`, new `tests/adventure-assets.test.js`, `artifacts/adventure-art.md`.

**Interfaces:** Produce the exact wraith and appearance manifests/files in the shared contract. Read accepted concept originals and v2 monk; never edit them. Renderer registers wraith; UI owns appearance helper code.

- [x] Inspect existing native-scale art and accepted spirit boards; record reference identity and generation/normalization strategy.
- [x] Create the 52-key wraith family and matching masks; preserve real front/back views, stable form and anchors.
- [x] Produce 18 monk looks with three coherent skin ramps, two visible hair options and three sash ramps, preserving alpha/ordering and non-target materials. Save matching preview images.
- [x] Validate exact frames, size/alpha/color limits, distinct intended choices, consistent masks and rebuild provenance; run `node --test tests/adventure-assets.test.js` and the script's read-only verification mode.
- [x] Save contact sheets and report exact commands, sources, hashes and remaining visual limitations for coordinator inspection.

## Task 3 — Location and combat rendering

**Owner:** scene Codex. **Files:** `src/render.js`, `src/pixel-scene.js`, `src/pixel-animation.js`, `src/pixel-assets.js`, new optional `src/adventure-*.js` renderer modules (coordinate name with owner 1), new `tests/adventure-renderer.test.js`; existing renderer/animation tests only when contract fixtures intentionally change; `artifacts/adventure-rendering.md`.

**Interfaces:** Consume `game.world`, `locationRevision`, body kinds/projectiles and wraith timing. Consume the new art packages and UI's `appearanceVariant`. Preserve constructor/render/project/picking public methods.

- [x] Write failing tests for location revision reset/disposal, same-length enemy replacement, camera entry reset, wraith pose/picking and appearance URL race handling.
- [x] Implement world-data-driven camp/road/court scenery and minimap with clear portals, fork/cache and ritual state. Preserve compact HUD battlefield space.
- [x] Integrate wraith/body-kind rendering, ranged warning/shot, ritual hit/state feedback and selected monk texture. Preserve death holds, pause and masks.
- [x] Run `node --test tests/adventure-renderer.test.js tests/animation-renderer.test.js tests/animation-runtime.test.js tests/animation-picking.test.js tests/projection.test.js`; report integration assumptions and visual inspection hooks. Coordinator owns Chrome use.

## Task 4 — Welcome customization and adventure HUD

**Owner:** UI Codex. **Files:** `src/main.js`, `src/input.js`, `src/appearance.js`, `src/styles.css`, `index.html`; `assets/ui/pixel-v3/` if needed; `tests/adventure-ui.test.js`; `artifacts/adventure-ui.md`.

**Interfaces:** Consume `createAdventure`, `interact`, prompt/objective helpers and adventure state; produce the appearance helpers in the shared contract. Expose the selection inside the existing welcome panel.

- [x] Implement validated appearance helpers and tests for missing/unknown choices and exact variant/preview mapping.
- [x] Bind compact skin/hair/sash choices and immediate preview; carry selection into start/restart without a separate screen. Preserve accessibility and the current stone/pixel design.
- [x] Route E exactly once per press; display location, current objective, nearby prompt and total/remaining monster progress from state. Write real notices and reward/defeat summaries.
- [x] Verify pure helpers/input routing with `node --test tests/adventure-ui.test.js`; check DOM hooks and style rules for 1440×900, 1024×768 and 800×600. Report; coordinator does final actual browser checks.

## Task 5 — Integration, review and acceptance

**Owner:** coordinator; fresh read-only external reviewer. **Files:** shared docs and `artifacts/adventure-{progress,acceptance,review}.md`, proof images and final patch/hash inventory.

- [x] Read each report and inspect changed outputs against its task; return issues to the owning agent rather than taking concurrent ownership.
- [x] Run `npm test` and `npm run build` on the integrated tree. Resolve failures through owners and rerun only relevant checks before the final suite.
- [x] Generate baseline-to-final textual patch and asset inventory. Fresh reviewer assesses scope, transitions, combat, UI state and loading/disposal; repair and verify material findings.
- [x] Play the full adventure and optional route, pause/backtrack, defeat/restart and nondefault appearance. Inspect three desktop layouts and capture only game-tab screenshots.
- [x] Update README, art direction and studio status with actual scope/results; record observed pacing and limitations. Close only completed panes created for this stage, retaining the user's original two panes.

## Acceptance record

Completed on 2026-10-22. See `artifacts/adventure-acceptance.md` for exact automated and manual evidence. Optional exploration and successful reward were checked in separate browser runs; the full optional-and-reward route also passed a simulation smoke. The 5–10 minute pacing target was assessed and remains unproven. No claim of a normal uninterrupted user playtest is made.
