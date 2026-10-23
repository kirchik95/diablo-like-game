# SDD ledger — plan: docs/superpowers/plans/2026-10-22-combat-prototype.md

- Ruling: execute inline in the existing project — the user approved the playable prototype; no Git repository or branch exists, so worktree/commit tooling is inapplicable.
- Ruling: local-only workflow — this is the user's project workspace and the accepted step is a local playable prototype, not deployment.
- Pre-flight: simulation/world interfaces feed rendering, input and audio; all three share world coordinates in tile units. No conflicting interfaces.
- Ruling: use Babylon.js + Vite instead of custom Canvas rendering, after the user asked which engine the game will use. Native 3D supports the requested volumetric isometry; simulation remains renderer-independent.
- Task 1: complete. Core model tests were written and failed before implementation; ten initial tests passed after implementation.
- Task 2: complete. Local Vite server, Babylon scene, models, effects, HUD, input and sound implemented.
- Review: independent read-only reviewer found doubled high-DPI aim scaling, mirrored horizontal controls, and insufficient navigation clearance. All three reproduced in tests before fixes. Additional zero-axis facing correction included.
- Regression tests: 15/15 passing after fixes, including real Babylon camera projection and hound navigation around braziers.
- Browser validation: complete seven-enemy victory with 84 HP remaining using normal input; defeat at 0 HP; restart after each restores 100 HP, all 7 enemies and the spawn position; pause freezes positions/health/cooldowns. No browser console errors. Observed about 120 FPS on the test machine before the art refinement (not a cross-device performance guarantee).
- Art feedback: user correctly noted the generic geometric prototype diverged from Paper. Added ink outlines, painterly procedural stone texture, organic animated flame sprites, separated pink/cyan lighting, taller monk proportions and closer framing. Final custom art remains future asset work; recorded in docs/art-direction.md.
- Task 3: complete. Final suite 15/15 passed; production build passed (Vite chunk-size warning only). Production HTTP 200, rendered at 1440×900, start and right-click wave verified, zero console errors. Compact 960×640 view inspected with controls inside the viewport and no horizontal overflow.
- Final art check: updated materials, outlines and proportions verified in-browser. Screenshots saved under ignored `artifacts/`. Full hand-authored concept-art fidelity remains a stated limitation of this first playable slice.
- Handoff: README includes setup, controls, build/test commands, architecture and scope. Original AGENTS.md preserved. Development server left running at http://127.0.0.1:5173/ for the user; temporary production preview and QA tab closed.
