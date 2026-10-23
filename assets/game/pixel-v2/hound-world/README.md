# Night Ritual — hound, world and effects v2

Task 2 delivery. `manifest.json` follows animation spec schema 2; the initial
`source/planned-manifest.json` freezes the same paths, dimensions and indices.
32 native pixels per world unit, nearest sampling, no mipmaps, binary alpha.

| Atlas | Grid / cell | Anchor | Keys | Opaque colors |
| --- | --- | --- | --- | --- |
| `hound-v2.png` | 13×4 / 96 | [48,84] | 52 | 39 |
| `world-v2.png` | 6×4 / 160 | [80,144] | 24 | 56 |
| `effects-v2.png` | 6×3 / 192 | [96,96] | 18 | 26 |

| Clip | Front indices | Back indices |
| --- | --- | --- |
| hound idle | 0–3 | 26–29 |
| hound run | 4–9 | 30–35 |
| hound attack | 10–15 | 36–41 |
| hound hurt | 16–19 | 42–45 |
| hound death | 20–25 | 46–51 |
| brazier-cyan | 0–5 | — |
| brazier-magenta | 6–11 | — |
| shrine | 12–17 | — |
| gate | 18–23 | — |
| impact | 0–5 | — |
| warning | 6–11 | — |
| healing | 12–17 | — |

`hit-masks.json` uses the three exact PNG filenames as keys. Each entry contains
`width` and base64 `bits`, row-major and least significant bit first, exactly as
v1. Masks include only the actual delivered opaque pixels.

From the repository root, with Python 3.10+ and Pillow 12.3.0 already installed:

```sh
python3 scripts/build-hound-world-animation.py
python3 scripts/build-hound-world-animation.py --verify-only
```

The build performs no generation or network calls and writes only this package.
It reads the immutable artbook sources elsewhere in the repository. It records
every source hash, exact extraction bounds, source calibration, clip-wide uniform
scale, registration and fixed palette. There is no per-pose bounding-box resizing.

Open `previews/index.html` directly, or serve the repository and visit
`/assets/game/pixel-v2/hound-world/previews/`. The player has native/integer zoom,
front/back/mirror, scrubbing, pause, replay, contrasting backgrounds and anchors.
It holds one-shot endpoints. The 12 native GIFs replay after an endpoint pause
for inspection. `*-contact-native.png` shows every frame at 1×. The targeted
`back-idle-cycle-2x.gif` shows 26→29; `back-idle-after-2x.png` is the matching strip.

Back views were newly drawn with the built-in ImageGen tool. Exact prompts,
references, originals and selection decisions are in `source/`. Back death v1
was rejected for turning side-on and replaced by v2. Only idle indices 28/29
were replaced after direction review; hashes verify the other 50 hound keys,
including 26/27, stayed unchanged. Both replacement drawings share a single
0.744 source-density calibration before the idle clip's common 0.133 scale.

Front hound art retains the approved Paper keys. Blue baked shadows, source
backgrounds and haze are removed. Disconnected attack dust/ground-warning marks
are excluded from the body atlas. A fixed vessel, stone shrine and gate arch
prevent base drift. Shrine light can change inside the bowl; the bottom 22-pixel
support bands are bit-identical throughout each scenery clip. All effects leave
a 10×10 transparent aperture at the origin; impact sparks are registered to its
right and healing particles rise above it.

`qa-report.json` is the machine-checkable delivery report. Final runtime event
timing, target picking, occlusion and combat readability remain the runtime/main
owner's in-game acceptance. This asset task did not operate a browser or modify
game code. GIF/HTML timing is a preview convention; movement remains driven by
distance in the game and shrine healing remains immediate.
