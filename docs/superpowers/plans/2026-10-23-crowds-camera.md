# Natural Crowds and Wider Camera Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development adapted to the user's explicitly requested visible external agents and exclusive file ownership. No nested agents or Git initialization.

**Goal:** Remove regimented monster placement/movement and show more of the existing world.

**Architecture:** Deterministic seeded encounters on shared immutable geometry; local role-aware steering layered onto existing combat states; orthographic zoom with scale-aware picking. Gameplay and camera work are independent after the contract below.

**Tech Stack:** JavaScript, Babylon.js, Vite, node:test, existing pixel assets.

**Spec:** `docs/superpowers/specs/2026-10-23-crowds-camera-design.md`

## Global Constraints

Keep all ground0u,34 monsters/six packs, existing damage and telegraphs, topology and safe camp. Never modify AGENTS or previous assets. No dependencies/Git/publication. Baseline: `/private/tmp/night-ritual-pre-crowds-camera-20261023`.

## Review Focus

- Seeds near unsigned32 limits must not lose actors, produce unreachable spawns or place monsters on interactions.
- Steering around columns and narrow gaps must not jitter, orbit forever, cross safe camp or exceed speed/pathfinding budgets.
- Separation must not alter committed telegraphs or move dead/stunned actors, and physical return must still settle.
- Zoom must not introduce click-through opaque sprites, phantom alpha hits or incorrect scenery fading.
- Random worlds and repeated runs must preserve source/reward gating and release renderer resources.

## Task1 — Seeded encounters (root)

Files: `src/overworld.js`, new `src/encounter-layout.js`, `tests/overworld.test.js`, new `tests/encounter-layout.test.js`.

Interface: `createOverworld(seed = DEFAULT_WORLD_SEED)` returns frozen world with `seed`, shared unchanged geometry and generated zone/combined encounters. Same default returns `OVERWORLD`. IDs/counts/species preserved.

- [x] Add failing tests: seed reproducibility/variation, unsigned32 edges,34 valid/distinct/reachable spawns, minimum separation, reserved interactions, retained geometry and pack composition.
- [x] Implement bounded rejection sampling in authored pack envelopes with a deterministic fallback, using existing collision helpers.
- [x] Run world/placement tests and a broad seed sweep; freeze the contract for gameplay worker.

## Task2 — Crowd steering (neighbor Codex)

Files: `src/game.js`, optional `src/enemy-steering.js`, gameplay tests and a new route probe/report. Do not change overworld or camera files.

Interface: consume root world factory in `createAdventure(appearance={}, {seed=DEFAULT_WORLD_SEED}={})`; expose actual seed on game. Preserve existing API defaults and IDs.

- [x] Reproduce hound/wraith crowding and same-target approaches in isolated tests before changes.
- [x] Implement stable varied approach targets and bounded separation for movable actors, preserving attack timing, collisions, safe camp, return behaviour and budget.
- [x] Cover both species, zero-distance neighbours, walls, committed attack/stun/death states, frame-size bounds, all six pack returns and unchanged damage.
- [x] Run focused tests and full real-API quest routes with fixed seeds; report exact results and limits.

## Task3 — Camera and interaction projection (camera Codex)

Files: `src/render.js`, `src/pixel-picking.js`, optional camera constants module; renderer/picking tests. Do not change asset constants, sprite geometry or simulation.

- [x] Add failing tests for extents×1.2 and actual projected alpha picking/occlusion at the wider zoom.
- [x] Apply orthographic zoom and pass actual projected scale through alpha helpers (default1 for compatible direct callers).
- [x] Run focused camera/picking/occlusion tests with real masks, flipped/scaled sprites and high-DPI pointer coordinates. Report import changes for root's UI harness.

## Task4 — Integration (root)

Files: `src/main.js`, affected root UI tests, QA fixture, README/art direction/status and acceptance artifacts.

- [x] Choose a seed per fresh normal run; support explicit `?seed=` replay. Verify deterministic API callers remain reproducible.
- [x] Browser-check old/new framing, irregular groups, actual combat, alpha picking and edges/HUD at small/default/wide sizes.
- [x] Run full suite/build, preserve final seed route evidence and freeze a review snapshot/diff.
- [x] Obtain independent read-only review; fix confirmed findings; record accepted state and historical Paper-plan limitation.
- [x] Close only finished created panes/QA tabs; preserve original neighbor and deliverable game tab.

## Final acceptance

Completed 2026-10-23. Final full suite 338/338 PASS, production build PASS, Chrome QA and independent v2 ACCEPT. R1 framebuffer-edge picking was corrected and independently rechecked; R2 adaptive non-colliding ground-cover variation is explicitly documented. See `artifacts/crowds-camera-acceptance.md` and `artifacts/crowds-review-final.md`. All prior assets and AGENTS remain unchanged.
