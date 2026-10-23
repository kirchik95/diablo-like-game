# Night Ritual Combat Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver a locally playable isometric monk combat prototype based on the approved Paper concepts.

**Architecture:** A deterministic simulation exposes state and short-lived events to the Babylon.js renderer, DOM HUD, and synthesized audio. Input converts screen directions and pointer positions into world coordinates. Static world data is shared by collision, rendering, and the map.

**Tech Stack:** JavaScript ES modules, Babylon.js, Vite, Web Audio, Node.js 22.12+ built-in tests. Engine choice was clarified in conversation before renderer implementation.

**Spec:** `docs/superpowers/specs/2026-10-22-combat-prototype.md`

## Global Constraints

- Local implementation in the existing workspace; no external runtime network requests.
- Preserve `AGENTS.md` and existing concept assets.
- Desktop keyboard/mouse controls and Russian interface.
- Test deterministic gameplay; visually inspect the actual browser build.

## Review Focus

- Diagonal movement and high-speed dashes must stay on navigable ground.
- One swing must not damage a target on every frame.
- Lost focus/pause must clear held input and freeze timers.
- Hounds must navigate around scenery without blocking completion.
- Restart after defeat or victory must reset health, enemies, effects, and cooldowns.

### Task 1: World and simulation

**Files:** `package.json`, `src/world.js`, `src/game.js`, `tests/game.test.js`.

**Interfaces:** `createGame()` returns a fresh run; `updateGame(game, input, dt)` mutates it; `startAttack`, `startDash`, `startWave` return acceptance; `isWalkable`, `moveBody`, `findPath` share world collision data. Inputs contain moveX/moveY, aimX/aimY and held attack.

- [x] Write failing behavioral tests for single-hit damage, combo reset/finisher, dash immunity/cooldown, wave interruption, enemy telegraph/recovery, death/reset, connected terrain, and collision.
- [x] Run `npm test`, verify missing behavior fails.
- [x] Implement world and simulation; run `npm test` until the whole suite passes.

### Task 2: Playable visual slice

**Files:** `index.html`, `src/styles.css`, `src/main.js`, `src/render.js`, `src/input.js`, `src/audio.js`, `src/scene-world.js`, `src/scene-art.js`, `src/models.js`; Vite supplies development and build commands.

**Interfaces:** `Renderer(canvas, effectsCanvas, mapCanvas, game).render(game, dt, mode)`, `.screenToWorld(x,y)`, `.resize()`; `Input(canvas, renderer, isActive).sample(player)` / `.clear()`; `GameAudio.play(event)` / `.unlock()` / `.setMuted(value)`.

- [x] Implement the scene, animated monk/hounds, combat effects, DOM HUD, map, pause/start/end panels, audio, and local scripts.
- [x] Run syntax checks and `npm test`; build and launch with `npm run dev`.
- [x] Inspect the browser at 1440×900 and 960×640; exercise real input, pause/resume, abilities, damage and restart. Correct observed issues.

### Task 3: Verification and handoff

**Files:** `README.md`, `.gitignore`, this plan's `progress.md`.

**Interfaces:** Document `npm run dev`, `npm test`, `npm run build`, and the scope/controls.

- [x] Review implementation against the spec; fix substantive defects with regression tests.
- [x] Run the full tests/build and check browser console errors.
- [x] Record validation and hand off the running local URL.

No commits/worktree operations: the starting directory is not a Git repository.
