# Animation Integration Implementation Plan

> **For agentic workers:** Execute through visible external Codex agents, with separate ownership and a final independent review. Main agent coordinates and accepts results.

**Goal:** Bring the approved animation designs into the existing playable courtyard.

**Architecture:** Two asset packages are produced independently against the shared metadata contract. One runtime owner integrates both through state-driven pose selection and a presentation clock. Existing simulation rules and projection remain authoritative.

**Tech Stack:** Babylon.js 9.32, Vite 8, JavaScript, node:test, Python/Pillow for deterministic sprite normalization, built-in ImageGen for missing authored views.

**Spec:** `docs/superpowers/specs/2026-10-22-animation-integration.md`.

## Global constraints

Use 32 native pixels per world unit, nearest filtering and integer scaling. Keep combat/input/collision semantics. No new dependencies, publishing, Git initialization, AGENTS.md edits, or changes to existing Paper/source artwork. There is no Git repository; snapshot `/private/tmp/night-ritual-pre-animation-v2-20261022` provides the immutable comparison baseline. File ownership isolates simultaneous writes. The user's instruction to continue while away authorizes implementation without another approval round.

## Review focus

1. Pause, defeat and restart: no drifting paused clock, repeating death or stale state in a fresh game.
2. Attack boundaries and cancellation: visible contact at actual damage time; dash wins over pending attack/hurt.
3. Direction changes: real back poses and correct mirrors, stable feet and body proportions.
4. Picking/occlusion: masks match the currently displayed atlas frame, including leap and transparent padding.
5. Shrine/gate transitions: trigger once and hold final state, with no change to heal/victory timing.

## Task 1 — Monk animation package

Owner writes only `assets/game/pixel-v2/monk/`, `scripts/build-monk-animation.py`, and `artifacts/animation-v2-monk.md`.

Consumes the hero artbook and asset contract. Produces the `monk` atlas, exact clips, packed masks, deterministic build script, provenance and previews.

- [x] Inspect sources at native scale; extract accepted front keys and author missing back views with ImageGen.
- [x] Normalize to 96×96 cells and [48,84] anchor; keep 50 keys per authored facing, 100 total.
- [x] Verify each frame has content, no clipped opaque edges, binary alpha, ≤48 colors, valid clip indices/masks and stable scale; inspect contact sheets and animation previews.
- [x] Report exact outputs, commands, image acceptance and limitations. Main agent checks spec and visual quality.

## Task 2 — Hound, world and effects package

Owner writes only `assets/game/pixel-v2/hound-world/`, `scripts/build-hound-world-animation.py`, and `artifacts/animation-v2-hound-world.md`.

Consumes matching artbook originals and the same contract. Produces 52 hound keys (26 per authored facing), 24 world keys and 18 effects keys, masks/provenance/previews.

- [x] Extract and clean accepted front keys; author coherent back-facing hound actions.
- [x] Normalize actor/world/effect atlases with their specified sizes and anchors. Keep scenery bases stationary; erase source backgrounds and baked shadows that conflict with engine shadows.
- [x] Verify all frames/clip indices, no clipping, palette/alpha, trigger endpoints and full visual sequences at native scale.
- [x] Report exact outputs and validation. Main agent checks spec and visual quality.

## Task 3 — Runtime integration

Owner writes JavaScript in `src/`, relevant `tests/`, developer-only `artifacts/animation-preview.html` plus any preview JS under `artifacts/`, and `artifacts/animation-v2-runtime.md`. Artists own every generated asset/script. Task 5 owns `src/styles.css` and `index.html`. Main agent owns shared docs.

Consumes both named manifest packages. Preserve `monkPose(player)`/`houndPose(enemy)` compatibility or update all consumers deliberately; a separate presentation-state module may add elapsed visual timers. Atlas indices must come from clips rather than fixed offsets.

- [x] Write focused failing tests for action-contact boundaries, six-key distance-driven movement, directional selection, death hold, pause/reset and gate/shrine one-shot endpoints. Retain existing gameplay/projection tests; adapt only old frame-index fixtures whose contract intentionally changed.
- [x] Integrate loading, clips and masks. Implement state-driven rendering and nonblocking presentation timers; update main-loop handoff only as necessary.
- [x] Bind scenery and FX to current events. Preserve readable telegraphs and body targeting. Add a developer preview of all available clips without adding a game menu screen.
- [x] Run focused tests, then `npm test` and `npm run build`; report actual results. Main agent performs Chrome gameplay and preview inspection.

## Task 4 — Acceptance and independent review

- [x] Generate a textual before/after package from the immutable snapshot. A fresh reviewer checks spec compliance and code quality using the package, sources, tests and artifact reports; it does not edit production files.
- [x] Return actionable findings to the relevant owner, then recheck the fixes.
- [x] Main agent verifies a complete battle, loss/restart, pause, body aiming, pixel scaling and key animations; save browser proof under `artifacts/`.
- [x] Update README, art direction, asset documentation and studio status to reflect implemented scope. Final response links the playable result and reports checks and genuine limitations.

## Task 5 — HUD restyle (added user request)

Owner writes only `index.html`, `src/styles.css`, optional code-native SVG UI assets under `assets/ui/pixel-v2/`, and `artifacts/animation-v2-hud.md`. Preserve all runtime IDs and hooks; no JavaScript ownership.

- [x] Inspect existing HUD and the approved visual system. Use compact stone/charcoal framing, stepped glyphs, semantic palette and readable text; the battlefield remains dominant.
- [x] Restyle health, skills, cooldowns, combo pips, quest/minimap and existing menu panel without adding product screens.
- [x] Inspect static DOM contract and responsive rules. Main agent verifies actual layouts and interactions in Chrome at the sizes in the spec; no behavior-mirroring tests are needed for CSS-only changes.
- [x] Report changed files, visual decisions and responsive behavior. Include HUD in the final independent review and screenshot.

## Completion

All five tasks accepted on 2026-10-22. See `artifacts/animation-v2-acceptance.md` for coordinator-run tests, independent review, browser evidence and remaining project scope.
