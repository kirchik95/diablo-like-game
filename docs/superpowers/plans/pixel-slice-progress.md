# SDD ledger — plan: docs/superpowers/plans/2026-10-22-pixel-slice.md

- Baseline: 15/15 tests pass; no Git metadata. Original source snapshot: `/private/tmp/night-ritual-pre-pixel-20261022/` (outside Node's test discovery).
- Pre-flight: Task 1 atlas cells/pivots match Task 2 consumers; Task 2 renderer preserves the existing main/input interface.
- Source generation: three built-in imagegen calls from local approved Paper references; alpha channel present. Normalization and in-game acceptance pending.
- External pane: `HERDR_ENV` was not forwarded to tool commands, but the actual Herdr session is available. Following the user's explicit request, found the idle same-project Codex at `w4:pF9` and sent the independent combat verification brief. No new panel or session created.
- Task 1: complete. Three normalized atlases, 32 colors/family, binary alpha, all frame silhouettes inside bounds; sources/prompts retained. Native contact sheet reviewed.
- Task 2: animation selection tests RED (unimplemented return values) → GREEN, four new behavior tests. Browser integration in progress.
- Integration complete: one courtyard, monk/hound atlas animation, environmental props, asset readiness/error panel, pause/restart, existing audio and combat feedback.
- First external Codex added 12 combat regressions and found two hound navigation deadlocks plus a permanent corpse hit flash. All three reproduced and fixed in `src/game.js`.
- Fresh external review found body-versus-floor pointer aiming, column footprint mismatch and fractional canvas scaling. Added 13 picking and five scenery regressions, observed RED, then verified GREEN. Picking now uses opaque frame pixels; column contact follows its projected base; canvas dimensions preserve integer upscale. Overlapping scenery fades to keep actors visible.
- Final code checks, 2026-10-22 22:20 local: `npm test` **49/49 pass**; `npm run build` succeeds, 524 modules. Remaining Vite warning concerns the engine chunk size, not build correctness. Source sheets/prompts are excluded from the runtime bundle.
- Chrome QA: movement, held attack, dash, wave, hound telegraph, victory, defeat, both restarts and pause exercised. After final fixes, clicking the hound body produced damage, defeat/restart restored 100 HP, and console error/warning capture was empty.
- Resize QA: compact viewport exercised; odd CSS viewport **1441×901** produced a **720×450** framebuffer displayed at **1440×900**, exact **2×** scale on both axes. Effects canvas matched. Temporary viewport override reset.
- Gameplay capture: `artifacts/pixel-courtyard.jpg`. Prior source backup and `AGENTS.md` preserved. Keyframe limitations remain as stated in `assets/game/pixel-v1/README.md`.
- User expanded the work to a complete Paper animation artbook and requested studio-style orchestration. Three external Codex agents now own independent hero, monster and world pages. See `artifacts/animation-*-progress.md` for their individual progress.
