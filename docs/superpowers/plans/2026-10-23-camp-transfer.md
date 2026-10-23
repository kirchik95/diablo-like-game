# Camp Transfer Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development adapted to the user's requested visible Codex team in Herdr. Exclusive file ownership replaces unavailable Git worktrees. The coordinator performs browser acceptance and obtains a fresh final review.

**Goal:** Deliver the full Paper camp plan and a playable implementation matching its layout and art.

**Architecture:** A shared camp data module drives simulation, prop placement and the Paper map. A small static/animated atlas replaces prototype camp props; existing terrain and loading infrastructure remain in use.

**Tech Stack:** Existing Babylon.js, JavaScript, node:test, Python/Pillow, ImageGen and Paper.

**Spec:** `docs/superpowers/specs/2026-10-23-camp-transfer-design.md`.

## Global constraints

- Preserve 32 px/unit, fixed isometry, integer display scaling and common loading/appearance retry.
- Camp only; preserve other locations, combat, HUD and transition IDs.
- No dependencies, Git, publishing, AGENTS edits or changes to previous assets.
- Read the specification for the exact atlas/mask contract. Existing Paper pages stay unchanged.
- Baseline and file ownership are mandatory; no worker browser use or nested agents.

## Review focus

1. All visible blockers agree with collision and allow access to tents, fire, reward and exit.
2. Paper and runtime use the same coordinates and scale; labels distinguish authored plan from old concept.
3. Outer camera edges stay filled; daylight, grass and low natural borders do not read as a dungeon.
4. Large props cannot hide the player; art is anchored to the same ground as its footprint.
5. New assets load in production, animate correctly and dispose across repeated transitions without regressing appearance retry.

## Task 1 — Camp data and navigation

Owner: original neighbor. Files: `src/camp-layout.js`, `src/campaign.js`, required `src/world.js` collision extension only, camp-specific gameplay tests and `artifacts/camp-transfer-layout.md`.

- [x] Calculate the proposed full layout, viewport-area ratio and real movement distances; publish `artifacts/camp-transfer-layout-proposal.md` for the coordinator's selection. Selected 1,534-tile outline with the revised central cluster recorded in the spec; final counts/timing follow registration.
- [x] Write meaningful failing tests for camp connectivity, prop collisions, reachable approaches and preserved road/court definitions.
- [x] Implement/export `CAMP_LAYOUT` with exact placement/collision data and integrate camp into campaign.
- [x] Run gameplay tests and export the machine-readable layout for Paper; freeze the contract.

## Task 2 — Camp art family

Owner: camp-art. Files: new `assets/game/pixel-v5/camp/`, `scripts/build-camp-assets.py`, `tests/camp-assets.test.js`, `artifacts/camp-transfer-art.md`.

- [x] Inspect the camp reference and existing production family; generate a representative tent and obtain coordinator selection.
- [x] Produce six static objects and four changing flame frames in the exact spec contract; preserve sources and relative provenance.
- [x] Normalize, create masks and native/context previews; verify dimensions, alpha, colors, anchor and actual frame changes.
- [x] Run asset checks and non-writing reproducibility verification, including a relocated checkout. Coordinator's final complete suite passed 233/233 after R1/R2 corrections.

## Task 3 — Paper plan and full location composition

Owner: original neighbor after Task 1. Files: new Paper page, `assets/concepts/camp-plan-01/`, `artifacts/camp-transfer-paper.md`.

- [x] Read frozen layout and source art; create the complete plan with editable labels, collision overlay and scale notes.
- [x] Assemble the complete isometric scene using final assets and exact placement data; show the outbound approach and all camp borders.
- [x] Inspect Paper screenshots, export final boards and save IDs/URLs, layout snapshot and provenance.

## Task 4 — Runtime integration

Owner: camp-scene. Files: `src/render.js`, `src/pixel-scene.js`, `src/pixel-assets.js`, `src/landscape.js`, optional `src/camp-scene.js`, relevant renderer tests and `artifacts/camp-transfer-rendering.md`.

- [x] Add regressions for placement/footprints, loading, animated flame, visibility, coverage and disposal.
- [x] Register new package and render shared placements; remove the old camp rug/fire/tent placeholders only in camp.
- [x] Create natural low camp borders and grouped surroundings; keep the central routes and actor silhouettes clear.
- [x] Run focused renderer tests and build with the final art, reporting exact visual inspection positions.

## Task 5 — Acceptance

Owner: coordinator plus fresh reviewer. Files: shared docs, `artifacts/camp-transfer-{progress,acceptance,review}.md`, QA fixtures, immutable review inventory and screenshots.

- [x] Inspect original/camp art and real scene, returning corrections to owners.
- [x] Run full tests, build, camp round trip and complete quest API route.
- [x] Verify Paper/runtime agreement and actual browser views from center, exit and boundaries at normal/small/ultrawide sizes.
- [x] Freeze changes, obtain independent review and resolve material findings. Frozen v2: R1/R2 closed; independent 233/233 suite, build and final Paper/browser review passed.
- [x] Record results and limits, preserve originals and close completed created panes. See `artifacts/camp-transfer-acceptance.md`; original neighbor preserved, local demo available.
