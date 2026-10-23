# Camp sprites

Task 2 package. Art direction and normalized tent-left seed accepted by the coordinator under the user's delegated authority on 2026-10-23. Final family/runtime acceptance belongs to the coordinator.

Runtime scale: 32 native pixels per world unit. Preserve native art size; do not stretch a tent to fit a collider estimate. `camp.png`: six 256px cells in 3×2 order, fixed anchor `[128,232]`. `camp-flame.png`: four 128px cells in one row, anchor `[64,112]`. Nearest sampling, no mipmaps, binary alpha, palette limits 64/24.

## Ground registration

`[128,232]` is the render registration at the lower edge of the grounded silhouette, one pixel below the last opaque row. It is **not** the center of the tent floor. Position the image by this anchor and position a collider by the separately measured floor center. Measurements are cell-local pixels: origin top-left, x right, y down. They exclude ropes and pegs; the hidden rear corner is inferred. The layout owner decides collision geometry.

| Tent | Approximate cloth-base corners, clockwise | Center | Center minus anchor | Full silhouette |
| --- | --- | --- | --- | --- |
| tent-left | `[42,182] [113,154] [214,208] [136,231]` | `[126.25,193.75]` | `[-1.75,-38.25]` | `208×145 px` |
| tent-right | `[44,211] [136,158] [215,184] [125,231]` | `[130,196]` | `[2,-36]` | `208×140 px` |

| Other prop | Approximate ground outline | Center | Center minus anchor | Full silhouette |
| --- | --- | --- | --- | --- |
| road-marker | `[100,218] [127,205] [155,218] [129,231]` | `[127.75,218]` | `[-0.25,-14]` | `56×82 px` |
| campfire-base | `[82,214] [95,201] [128,196] [161,201] [174,214] [161,227] [128,232] [95,227]` | `[128,214]` | `[0,-18]` | `92×52 px` |
| supply-cache | `[68,210] [116,185] [188,219] [159,231] [92,223]` | `[124.6,213.6]` | `[-3.4,-18.4]` | `121×86 px` |
| fallen-log | `[80,223] [164,188] [180,204] [98,231]` | `[130.5,211.5]` | `[2.5,-20.5]` | `105×60 px` |

Machine-readable measurements: [source/footprints.json](source/footprints.json), copied into [manifest.json](manifest.json) as `footprints`. Centers are approximate authored registration points. The ring's ground ellipse is about 92×36px. Its horizontal half extent is 46px (`46/32 = 1.4375` before projection correction); derive world collision through the actual isometric basis.

## Fire assembly

Place both atlas anchors at the **same world position**. `campFlame.frames` is explicitly `flame-0`, `flame-1`, `flame-2`, `flame-3`, in that order; `animations.campfire` specifies 120ms/frame, looping (480ms total). The flame has one shared normalization scale and fixed lower six rows. Its visible root `[64,99]` is already offset `[0,-13]` from its anchor `[64,112]`, so it lands at `[128,219]` inside the base cell. Do not apply that offset twice. The base includes the complete stone ring and crossed logs; no flame is baked into it.

## Rebuild and checks

From the repository root, using the existing environment (tested with Node 24.13.0, Python 3.14.4, Pillow 12.3.0):

```sh
python3 -B scripts/build-camp-assets.py
python3 -B scripts/build-camp-assets.py --verify-only
node --test tests/camp-assets.test.js
```

`--verify-only` reconstructs 32 generated artifacts in memory, compares their bytes and source hashes, and writes nothing. Paths resolve from the script location. Copy the script, this package and the repository-relative references listed in `reproducibility.json.inputs` when relocating a subset of the checkout; no paths are rewritten. Exact byte reproduction is verified with the recorded Pillow version.

Original ImageGen PNGs and exact prompts: [source/generation-records.json](source/generation-records.json), [source/provenance.json](source/provenance.json). Normalization: alpha threshold 128, nearest downsampling, removal of tiny disconnected residue, one shared 64-color static palette / 24-color flame palette without dithering, fixed registration and flame-root stabilization. No scene crop, new dependencies, or CLI image-generation fallback. Source colors below the alpha threshold are discarded; originals remain unchanged.

The Node checks decode actual RGBA PNGs and verify CRCs, binary alpha, palette counts, all mask bits, physical sizes, footprints, nearest previews and meaningful flame silhouette changes. Relocation tests also reject missing references, altered originals and damaged output without writing repairs. No collision or runtime integration is provided by this package.

Previews: [tent-left at native size](previews/tent-left-native.png), [family contact](previews/contact-native.png), [native landscape context](previews/native-context-native.png), [all ground outlines](previews/footprints-native.png), [shared fire anchor](previews/ground-contact-native.png), [four flame poses](previews/fire-loop-native.png), [animated APNG](previews/fire-loop.apng). `*-2x.png` are nearest enlargements. Context is an authored art comparison, not a gameplay screenshot or layout proposal.
