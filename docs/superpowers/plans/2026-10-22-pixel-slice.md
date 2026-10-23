# Pixel Courtyard Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Play the approved pixel-art monk against one hound in a small browser courtyard.

**Architecture:** Keep Babylon.js, orthographic projection, input and deterministic combat. Replace character geometry with alpha-tested sprite planes; render a pixel stone floor and imported scenery at a fixed pixel density. Animation reads simulation state without altering combat timing.

**Tech Stack:** JavaScript, Babylon.js 9, Vite, Node test runner; Pillow for deterministic asset normalization.

**Spec:** `docs/art-direction.md` and the user's approved monk → animation → courtyard → feedback sequence.

## Global Constraints

- Simplified pixel art, dimensional fixed isometric view, monster combat.
- One courtyard and one hound. Existing attack, dash and wave remain usable.
- Do not modify `AGENTS.md` or original Paper exports.
- Save generated source images, prompts, normalized atlases and provenance locally.
- No new runtime dependencies. This workspace has no Git metadata; keep a source backup and file-based progress record.

## Review Focus

- Pixel scaling and pointer alignment after a resize or on Retina displays.
- Feet stay anchored across attack, run and dash; opposite facings use the correct row.
- Scenery collision matches visible bases; props do not hide combat.
- Pause, restart and hit-stop never advance a hidden simulation or leave stale effects.
- Asset load failure produces a visible recoverable error, not a permanently disabled start button.

## Task 1: Normalize the approved visual family

**Files:** `assets/game/pixel-v1/`, `scripts/build-pixel-assets.py`, `docs/pixel-art-brief.md`.

**Interfaces:** Produces `monk.png` (96px cells, 16 frames), `hound.png` (96px cells, 8 frames), `environment.png` (160px cells, 6 frames), plus JSON metadata and a contact sheet. Sprite anchors are bottom-center with fixed padding; nearest sampling, binary alpha, limited per-family palette.

- [x] Generate source sheets from existing Paper references and inspect them.
- [x] Slice with explicit source bounds; normalize using a shared character scale and measured foot anchors.
- [x] Validate atlas dimensions, alpha, palette size, frame bounds; inspect at native size.

## Task 2: Connect animation, scenery and a small encounter

**Files:** `src/pixel-animation.js`, `src/pixel-scene.js`, `src/render.js`, `src/world.js`, `src/main.js`, `src/styles.css`, `index.html`, `tests/pixel-animation.test.js`, existing gameplay/projection tests.

**Interfaces:** `monkPose(player)` and `houndPose(enemy)` return `{ frame, flip }`; Babylon sprite planes consume frame coordinates from the local atlas. Renderer retains `engine`, `scene`, `camera`, `resize()`, `screenToWorld()`, `render()`.

- [x] Write animation tests for front/back/mirror directions, distance-based run cycle, attack timing and dash priority; run and observe failure.
- [x] Implement pure pose selection, then run the suite.
- [x] Replace world data with the bounded courtyard; keep connectivity, obstacle routing and victory tests meaningful for its new layout.
- [x] Replace geometry characters and props with alpha-tested atlas planes, fixed-density floor and integer-scaled rendering. Keep the pointer projection contract.
- [x] Connect asset readiness/error handling and existing audio, hit-stop, knockback and restart flows. Remove stale multi-hound copy.

## Task 3: Verify in the browser and document

**Files:** `README.md`, `docs/art-direction.md`, `docs/superpowers/plans/pixel-slice-progress.md`, `artifacts/pixel-*`.

- [x] Run `npm test` and `npm run build`; all checks must pass.
- [x] Play movement, attack, dash, wave, victory, defeat, restart, pause and resize in the actual browser; capture the native-scale scene.
- [x] Obtain a fresh code review, resolve material findings, record evidence and remaining artistic limits.
- [x] Update setup/art documentation to describe the delivered slice accurately.
