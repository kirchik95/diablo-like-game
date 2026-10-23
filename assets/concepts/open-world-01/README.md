# Open world 01 — region plan

Paper: [Регион 01 · Открытый мир](https://app.paper.design/file/01M5JE4QF1S7K7921DAQTPSHYY/p-C-0), artboard «01 · План региона». Export: `exports/01-region-plan.png` (1600×1882).

This folder holds a plan board for review, not a game resource. All ground is level at 0u. Only trees, rocks, ruins and actors have volume.

## Provenance

- Source data: `src/overworld.js` (`OVERWORLD`), plus `layoutLandscape(OVERWORLD)` from `src/landscape.js` with the frozen `src/country-border.js`. The exact sha256 of each source file and the generation date are in `source/overworld-snapshot.json`.
- Exact layers: walkable ground and outline, paving, colliders and braziers, 34 monsters, and key points.
- Renderer snapshot: the natural border and outer groves. They are visual only and have no colliders. This layer can become stale after later source changes.
- Diagram: route lines, pack outlines and labels.
- `source/history/` keeps the renderer layer and snapshot from before the border freeze. In the freeze, 59 of 108 border rocks and ruins moved outward.
- No new sprites or AI images were made. All labels are editable Russian text in Paper.

## Rebuild

```bash
node assets/concepts/open-world-01/source/export-overworld.mjs
node assets/concepts/open-world-01/source/route-metrics.mjs
python3 assets/concepts/open-world-01/source/compose-plan.py
```

After a rebuild, place the SVG layers from `source/paper-input/` at (50, 60) in the map frame. Then export the board again. `manifest.json` lists the sha256 of every file.
