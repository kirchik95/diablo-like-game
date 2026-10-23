# Full Landscape Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development adapted to the user's explicitly requested visible external Codex team in Herdr. Preserve exclusive ownership and obtain independent final review.

**Goal:** Replace fragmented platforms in black space with cohesive, filled landscapes matching the accepted concept, and improve the first gameplay encounters.

**Architecture:** Simulation tiles describe walkable plateaus; a separate paving subset guides terrain materials. The renderer surrounds them with layered non-walkable ground, cliffs and themed scenery. A small shared art package supplies terrain textures and static props.

**Tech Stack:** Existing Babylon.js/Vite/JavaScript, node:test, Python/Pillow and built-in ImageGen.

**Spec:** `docs/superpowers/specs/2026-10-22-full-landscape.md`.

## Global constraints

- Existing 32px/unit, fixed 2:1 isometry, nearest/no mipmaps and binary sprite alpha.
- Preserve public simulation/renderer contracts, original art and appearance loading/retry.
- No dependencies, Git initialization, publishing, AGENTS.md edits or shared browser/Paper use by workers.
- Existing portal/entry/quest-point positions remain stable. Geometry and encounters may change within the agreed gameplay pass.
- File ownership and `/private/tmp/night-ritual-pre-landscape-20261022` replace unavailable Git isolation.
- Later user addition authorizes the art worker to create one new Paper camp page and its isolated `assets/concepts/camp-location-01/` package. Existing Paper pages remain unchanged.

## Review focus

1. Camera corners at outer walkable edges and ultrawide aspect must meet terrain, including immediately after transition and during camera shake.
2. Paving is a subset of walkable plateau; cliff boundaries, spawn/portal paths and the optional branch stay consistent with collision.
3. New scenery cannot hide actors, warnings or interaction targets or trap the player behind visual-only blockers.
4. Repeated transitions retain bounded scene resources; new textures load in production and still allow appearance retry.
5. Encounter changes preserve interrupt/attack timing and allow a readable first approach without an unavoidable simultaneous hit.

## Task 1 — Walkable plateaus and encounter pass

**Owner:** original neighboring Codex. **Files:** `src/campaign.js`, `src/game.js`, `src/world.js`, `tests/adventure-game.test.js`, `tests/adventure-world.test.js`, new gameplay test if needed; `artifacts/landscape-gameplay.md`.

**Interface:** preserve world/game APIs; export each adventure world's `paving` subset alongside `tiles`. Renderer consumes live geometry without hardcoded tile counts. Obtain coordinator's exact tuning choice from the proposal before editing combat.

- [x] Propose concrete encounter/timing changes based on code and previous playtest; document expected effect.
- [x] Write failing meaningful checks for paving subset, safe broadened plateaus, portal/optional paths and the selected combat changes.
- [x] Implement broader clearing shapes, narrower visible routes and agreed encounters/timing without moving quest points.
- [x] Run `node --test tests/adventure-game.test.js tests/adventure-world.test.js tests/game.test.js`; report changes and limitations.

## Task 2 — Terrain and prop family

**Owner:** art Codex. **Files/interface:** exact package/manifest/masks/script/test contract in the spec; `artifacts/landscape-art.md`.

- [x] Inspect the primary concept, production world atlas and monk at native scale; use their palette/view as the art target.
- [x] Generate and normalize the eight-prop family and three repeatable 32×32 surfaces; publish manifest early.
- [x] Add asset checks that decode actual PNGs/masks and enforce the contract. Verify repeat seams and native silhouettes visually.
- [x] Run the new test and `python3 scripts/build-landscape-assets.py --verify-only`; save previews, provenance and report.

## Task 3 — Complete landscape rendering

**Owner:** renderer Codex. **Files/interface:** renderer ownership from spec; `artifacts/landscape-rendering.md`.

- [x] Write geometry tests for camera-corner surface intersections at all supported sizes and valid edge positions, deterministic placement and transition disposal.
- [x] Register the art contract, distinguish paving/plateau materials and build surrounding land, deeper cliffs and themed scenery. Use existing art while new files are being produced, but do not ship fallbacks as final art.
- [x] Preserve readable actors and targets, warn/shot projection, pause, picking and appearance failure/retry.
- [x] Run focused renderer/projection/landscape tests and production build once all assets exist; report browser inspection points.

## Task 4 — Integration and acceptance

**Owner:** coordinator and fresh read-only external reviewer. **Files:** shared docs, `artifacts/landscape-{progress,review,acceptance}.md`, final patch/hash inventory and tab-only screenshots.

- [x] Inspect all owner outputs against the concept and shared contracts. Return corrections to their owners.
- [x] Run integrated `npm test` and `npm run build`; review the baseline diff independently and resolve material findings.
- [x] Inspect all three locations, outer edges and transitions at normal/ultrawide desktop sizes; play combat and objective path. Save representative before/after proof.
- [x] Update docs with actual results and pacing; close only newly created completed panes, retain the original two and the ready game tab.
