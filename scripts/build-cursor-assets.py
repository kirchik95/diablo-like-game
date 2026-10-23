#!/usr/bin/env python3
"""Build the in-game pixel cursors from the ASCII maps below.

One art pixel is 2 CSS px (the HUD unit at the base scale). Each cursor is written
at 1x (2 px per art pixel) and 2x (4 px per art pixel) for high-DPI screens.

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


def build():
    files, meta = {}, {}
    for name, (art, (hx, hy)) in CURSORS.items():
        for suffix, scale in (('', 2), ('@2x', 4)):
            files[f'{name}{suffix}.png'] = render(art, scale)
        # CSS hotspot in 1x pixels: the centre of the hotspot art pixel, clamped to the tip for arrows.
        meta[name] = {'size': [len(art[0]) * 2, len(art) * 2],
                      'hotspot': [hx * 2 + (1 if hx else 0), hy * 2 + (1 if hy else 0)]}
    manifest = {'schemaVersion': 1, 'cssPixelsPerArtPixel': 2, 'cursors': meta,
                'files': {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}}
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
