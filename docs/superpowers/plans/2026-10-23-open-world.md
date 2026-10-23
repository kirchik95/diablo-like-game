# Continuous World Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development, adapted to the user's explicitly requested visible external agents and exclusive file ownership. No nested agents or Git initialization.

**Goal:** Replace travel interactions with a continuous first region and deliver a denser, faster monk combat loop.

**Architecture:** Compose translated local world records into one immutable simulation world and one persistent rendered scene. Keep area identity separate from scene identity. Reuse existing art, animated actors and event feedback.

**Tech Stack:** JavaScript, Babylon.js, Vite, node:test, existing pixel-art assets, Paper.

**Spec:** `docs/superpowers/specs/2026-10-23-open-world-design.md`

## Global Constraints

Do not modify AGENTS.md or existing asset files. No dependencies, publishing, Git initialization or original-pane closure. Renderer, gameplay and root own separate files. The user delegated implementation choices; no extra approval gate is needed for this reversible local iteration.

## Review Focus

- Travel during an attack/dash must preserve input, damage, projectiles and camera continuity.
- Far-away monsters must not all chase or repeatedly pathfind; camp must remain safe.
- Source gating must only include courtyard guardians, including after walking away.
- Repeated waves/dashes and crowds must not multiply resource gain or per-target damage.
- Combined-world rendering must not leave overlapping background planes, interior borders or a resource leak.

## Task 1 — World composition (root)

Files: create `src/overworld.js`, `tests/overworld.test.js`.

- [x] Add tests for connected union, global coordinates, safe camp, 34 unique valid spawns, path to source/reward and original-layout immutability.
- [x] Implement `OVERWORLD` and `getOverworldZone(x,y)` exactly as the spec contract.
- [x] Run `node --test tests/overworld.test.js` and communicate final data to workers/Paper artist.

## Task 2 — Persistent simulation and combat (existing neighboring Codex)

Files: `src/game.js`, optional `src/monk-combat.js`, gameplay tests, `artifacts/open-world-gameplay.md`.

- [x] Test and implement continuous area tracking with shared enemy state, source gating and reward.
- [x] Test and implement 34-monster pack activation/leashing, combo/spirit/wave/dash/pickup behavior with constants exported as MONK_RULES.
- [x] Update obsolete transition assertions to meaningful continuous-travel assertions, preserving unrelated coverage. Run focused tests and a full quest route using real movement/combat APIs.

## Task 3 — Unified scenery and combat presentation (country-scene)

Files: `src/landscape.js`, `src/country-*.js`, `src/pixel-scene.js`, `src/render.js`, `src/pixel-animation.js`, renderer tests, own report.

- [x] Finish flat natural-edge rendering; support the combined world using zone-local art context and a single terrain surface.
- [x] Build all camp/road/courtyard props together, remove portal markers, preserve scene identity at area changes and fix minimap framing.
- [x] Render health pickups and stronger heavy-hit feedback; preserve readability/reduced motion. Test disposal and continuity; report targeted results.

## Task 4 — Controls, HUD and Paper (root + Claude)

Root files: `src/main.js`, `src/input.js`, `src/styles.css`, `index.html`, UI/input tests. Claude: only new Paper page/package.

- [x] Integrate MONK_RULES into cooldown/spirit HUD; right click casts wave; names/counters show current area; remove travel instructions.
- [x] Claude draws a new Paper map/encounter plan from actual global layout, reusing existing approved art direction, then exports and records provenance.
- [x] Inspect Paper and game at native scale; make necessary visual corrections through file owners.

## Task 5 — Integration acceptance (root + independent reviewer)

- [x] Run full tests/build once integrated; retain evidence of actual seamless travel, combat, quest and repeated resource stability.
- [x] Freeze snapshot/diff and receive read-only independent review; resolve verified findings and recheck affected paths.
- [x] Update README/art direction/status, preserve original art/AGENTS hashes, close only finished created workers and leave local game available.
