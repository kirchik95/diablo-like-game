# Ground Polish Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development adapted to
> the user's explicitly requested visible Codex team. Exclusive file ownership
> and a baseline snapshot replace unavailable Git worktrees. No nested agents.

**Goal:** Faster walking and fuller, naturally textured outdoor locations.
**Architecture:** Keep simulation topology; tune travel separately, import a new
country art family, and render organic surfaces plus low decorative clusters.
**Tech Stack:** Existing Babylon.js/JavaScript, node:test, Python/Pillow, imagegen.
**Spec:** `docs/superpowers/specs/2026-10-23-ground-polish-design.md`.

## Global constraints

- 4.4u/s running, existing .38 attack multiplier; preserve dash/enemy/combat timing.
- Preserve collision/navigation/portals, scale/camera/HUD and all old art/Paper. User refinement replaces terrain heights/perimeter geometry with continuous 0u ground and natural borders.
- New art only in pixel-v6/country, nearest filtering, no mipmaps.
- No dependencies, Git, publishing, AGENTS edits, shared-browser use by workers.
- Coordinator owns visual selection, browser acceptance and shared documentation.

## Review focus

1. Movement gains do not tunnel through props or speed up diagonal input.
2. The ground reads as natural continuous countryside, not tinted square sand.
3. Added decoration leaves monk/monster silhouettes, tells and approaches clear.
4. New assets and terrain resources handle load failure, transitions and disposal.
5. All three areas improve, with full outer coverage and stable existing topology.

## Task 1 — Movement

Owner: original neighboring agent. Files: `src/game.js`, `tests/player-movement.test.js`.

- [ ] Prove measured 4.4u/s cardinal/diagonal movement at .01/.05 steps with a failing test.
- [ ] Change base running speed to 4.4; keep attack movement at .38 and all dash/AI timing.
- [ ] Check .05s collision steps, distance-driven run animation and pause; run relevant gameplay tests.
- [ ] Report exact files/tests and before/after travel measurement in `artifacts/ground-polish-movement.md`.

## Task 2 — Art family

Owner: country-art. Exclusive: new package, `scripts/build-country-assets.py`,
`tests/country-assets.test.js`, `artifacts/ground-polish-art.md`.

- [ ] Read references/spec and produce a representative grass/soil/detail target for coordinator selection.
- [ ] Finish three 128px ground textures and eight 64px low-detail frames; save sources/prompts.
- [ ] Normalize, verify seams/alpha/palette/masks and view repeat/contact previews at game scale.
- [ ] Provide a non-writing verify mode and asset contract tests; report all limitations.

## Task 3 — Terrain and decoration integration

Owner: country-scene. Exclusive: `src/landscape.js`, `src/pixel-assets.js`,
`src/pixel-scene.js`, new `src/country-*.js` if useful, `tests/landscape-renderer.test.js`,
new `tests/country-renderer.test.js`, required existing loading tests, own report.

- [ ] Inspect spec as a builder; report material issues before code, settle routine choices.
- [ ] Define meaningful regressions for non-grid surface sampling, deterministic clusters,
  clear interactions, unchanged movement data, new loading/disposal and outer coverage.
- [ ] Implement organic world-coordinate surface transitions and location-specific
  grass/soil/stone balance. Register the exact four runtime keys from the spec.
- [ ] Integrate low grouped decorations with shared/batched resources. Do not add blockers.
- [ ] Remove vertical terrace/box perimeters; keep all ground continuous at 0u, add natural road/courtyard borders using existing art and retain open portals. Add height/clearance/coverage regressions.
- [ ] Run relevant tests and report in `artifacts/ground-polish-rendering.md`.

## Task 4 — Acceptance and review

Owner: coordinator and fresh visible reviewer.

- [ ] Select actual art target; inspect final game views and return visual corrections.
- [ ] Run full suite/build/quest route and actual input; check three sizes and resource reuse.
- [ ] Freeze runtime/art, prepare diff against baseline, obtain independent review; resolve findings.
- [ ] Record scope/results/limits, preserve historical Paper/art and close created finished panes.
