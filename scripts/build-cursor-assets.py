#!/usr/bin/env python3
"""Build the in-game pixel cursors from the ASCII maps below.

The base cursor uses 2 CSS px per art pixel (the HUD unit at the default scale).
Larger HUD units get their own files: 3 CSS px (`-u3`) and 4 CSS px (`-u4`).
Each scale also has an `@2x` file for high-DPI screens (twice the bitmap pixels).
Screens where `--u` is 5px or more reuse the `-u4` cursor.

    python3 scripts/build-cursor-assets.py            # write the PNGs
    python3 scripts/build-cursor-assets.py --verify-only
"""
import argparse
import hashlib
import io
import json
import sys
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent.parent / 'assets' / 'ui' / 'pixel-v4' / 'cursor'

# Palette matches the HUD tokens in src/styles.css.
PALETTE = {
    'k': (13, 10, 20, 255),     # --night outline
    'i': (238, 224, 206, 255),  # --ivory body
    'm': (180, 170, 186, 255),  # --muted shade
    'c': (239, 142, 131, 255),  # --coral palm contact
    'a': (229, 182, 110, 255),  # --amber interaction
    'd': (143, 115, 79, 255),   # --amber-dark shade
}

# The reticle sits over the game field; its coral centre is the aim point.
RETICLE = [
    'kkkkk.....kkkkk',
    'kiiik.....kiiik',
    'kikkk.....kkkik',
    'kik.........kik',
    'kkk.........kkk',
    '.......k.......',
    '......kck......',
    '.....kcick.....',
    '......kck......',
    '.......k.......',
    'kkk.........kkk',
    'kik.........kik',
    'kikkk.....kkkik',
    'kiiik.....kiiik',
    'kkkkk.....kkkkk',
]

ARROW = [
    'k...........',
    'kk..........',
    'kik.........',
    'kiik........',
    'kiiik.......',
    'kiiiik......',
    'kiiiiik.....',
    'kiiiiimk....',
    'kiiiiimmk...',
    'kiiiiimmmk..',
    'kiiiiikkkkk.',
    'kiikiik.....',
    'kik.kiik....',
    'kk..kimk....',
    'k....kiik...',
    '.....kkk....',
]

ACTIVE = [row.replace('i', 'a').replace('m', 'd') for row in ARROW]

CURSORS = {
    'reticle': (RETICLE, (7, 7)),
    'arrow': (ARROW, (0, 0)),
    'arrow-active': (ACTIVE, (0, 0)),
}

# CSS px per art pixel. 2 is the unsuffixed base; 3 and 4 are `-u3` and `-u4`.
SCALES = (2, 3, 4)


def render(art, scale):
    width, height = len(art[0]), len(art)
    assert all(len(row) == width for row in art)
    image = Image.new('RGBA', (width * scale, height * scale), (0, 0, 0, 0))
    for y, row in enumerate(art):
        for x, key in enumerate(row):
            if key == '.':
                continue
            for dy in range(scale):
                for dx in range(scale):
                    image.putpixel((x * scale + dx, y * scale + dy), PALETTE[key])
    buffer = io.BytesIO()
    image.save(buffer, format='PNG', optimize=False)
    return buffer.getvalue()


def hotspot_axis(index, css_px):
    """Centre of the hotspot art pixel, in CSS px. The arrow tip stays at 0."""
    if index == 0:
        return 0
    center = index * css_px + css_px / 2
    return int(center) if center == int(center) else center


def scale_suffix(css_px):
    return '' if css_px == 2 else f'-u{css_px}'


def build():
    files, meta = {}, {}
    for name, (art, (hx, hy)) in CURSORS.items():
        width, height = len(art[0]), len(art)
        scales = {}
        for css_px in SCALES:
            suffix = scale_suffix(css_px)
            files[f'{name}{suffix}.png'] = render(art, css_px)
            files[f'{name}{suffix}@2x.png'] = render(art, css_px * 2)
            scales[str(css_px)] = {
                'cssPixelsPerArtPixel': css_px,
                'size': [width * css_px, height * css_px],
                'hotspot': [hotspot_axis(hx, css_px), hotspot_axis(hy, css_px)],
            }
        base = scales['2']
        meta[name] = {'size': base['size'], 'hotspot': base['hotspot'], 'scales': scales}
    manifest = {'schemaVersion': 1, 'cssPixelsPerArtPixel': 2, 'cursors': meta,
                'files': {filename: hashlib.sha256(data).hexdigest() for filename, data in sorted(files.items())}}
    files['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    return files


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    files = build()
    if args.verify_only:
        stale = [name for name, data in files.items() if not (OUT / name).exists() or (OUT / name).read_bytes() != data]
        if stale:
            print('stale:', ', '.join(stale))
            sys.exit(1)
        print(f'ok: {len(files)} files match')
        return
    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (OUT / name).write_bytes(data)
    print(f'wrote {len(files)} files to {OUT}')


if __name__ == '__main__':
    main()
