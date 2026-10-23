# UI pixel-v3: Ritual Pixel

`ritual-pixel.woff2` is the HUD font of «Ночной ритуал». It was drawn for this project on 23 October 2026 as a plain bitmap in `source/ritual-pixel-glyphs.txt`. No external font or generator is used.

## Metrics

- One font pixel is 100 units. The em is 9 pixels: 7 above the baseline, 2 below.
- Capitals and digits are 6 pixels tall. Lowercase letters are 4 pixels tall.
- Advances include a 1-pixel gap. The space advance is 3 pixels.
- CSS sets `font-size: calc(var(--u) * 9)`, so one font pixel equals one HUD unit. `--u` follows the integer world scale of `src/render.js`.
- Coverage: printable ASCII, Russian А–Я, а–я, Ё, ё, and `« » · — – − … ‘ ’ “ ” ×`. О and 0, and З and 3, share a bitmap.

## Files

| File | Purpose |
| --- | --- |
| `ritual-pixel.woff2` | Not loaded since 23.10.2026: the user found the pixel font unreadable; the HUD uses a system font. Kept as a rejected variant. |
| `ritual-pixel.json` | Metrics, code points and the SHA-256 of the WOFF2. No test reads it now. |
| `ritual-pixel-specimen.png` | Review sheet at 3×, drawn from the source bitmaps. |
| `source/ritual-pixel-glyphs.txt` | Editable glyph bitmaps. |
| `source/build-ritual-pixel.py` | Build and verification script. |

## Rebuild

The script needs Python 3.10+, fontTools with brotli, and Pillow. These tools only rebuild the asset; the game has no new dependency.

```sh
python3 -B assets/ui/pixel-v3/source/build-ritual-pixel.py
python3 -B assets/ui/pixel-v3/source/build-ritual-pixel.py --verify-only
```

The build traces each glyph into merged pixel outlines. Then it rasterises every glyph without antialiasing and compares the result with the bitmap. `--verify-only` rebuilds in memory and fails when the committed WOFF2 or JSON differs. The output is deterministic, because the font timestamps are fixed.
