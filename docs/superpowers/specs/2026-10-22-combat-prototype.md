# Night Ritual combat prototype

Build the playable first step approved in conversation: a browser RPG with dimensional isometric scenery, a monk, and monster combat. Follow the established Paper direction: charcoal stone, warm ivory clothing, magenta fire, cyan spirit effects. The eventual world has large connected regions; this slice has one explorable monastery approach with a fork and an optional healing shrine.

- Desktop keyboard and mouse: screen-relative WASD/arrows, left mouse three-hit combo, Space dash, right mouse radial wave. Q is an alternate wave key; Escape pauses.
- One enemy species: shadow hound. Show its approach, telegraphed leap, and vulnerable recovery.
- Provide health, damage feedback, knockback, sound, defeat/restart, and a reachable victory after clearing the path.
- Present a polished full-screen game, minimal HUD, a concise entry/pause panel, and a small map. No inventory, progression, character creation, or additional enemies in this slice.
- Use JavaScript modules, Babylon.js 3D rendering with a fixed orthographic camera, Web Audio, Vite, Node.js 22.12+ and node:test. Run locally in this repository; preserve AGENTS.md and concept exports.
- Separate deterministic simulation from rendering and browser input. Do not require external assets, services, fonts, accounts, or network access at runtime.
- This is a combat/visual prototype, not the finished painted art or full RPG. User feedback: the initial generic geometric 3D look diverged from the concept. Add ink contours, worn painted surfaces, organic flames, stronger magenta/cyan light separation and improved character proportions; retain `docs/art-direction.md` as the visual contract.

Acceptance: movement and collision work across the fork; the combo, dash and wave behave distinctly; enemies telegraph and can kill the player; pause freezes gameplay; restart resets the run; all enemies and the exit can be reached; the game displays correctly at desktop and compact landscape sizes.
