#!/usr/bin/env python3
"""Draw the v2 home-screen portrait on a native 60×60 pixel grid (Pillow).

Original local pixel art, authored as integer-coordinate shapes. Palette and
monk materials follow docs/art-direction.md: spirit teal, ink, light cloth,
bronze beads, warm skin. No downloads, APIs, fonts or reference image required.
The three legacy night-ritual-{180,192,512}.png files are never written.
The inline 24×24 favicon stays independent for small browser tabs.

    python3 -B scripts/build-app-icons.py
    python3 -B scripts/build-app-icons.py --verify-only
    python3 -B scripts/build-app-icons.py --preview-dir /tmp/icon-review

180 = 60×3; 192 = 60×3 + 2×6; 512 any = 60×8 + 2×16.
512 maskable = 60×7 + 2×46, all motif pixels inside the central 80% circle.
Every art pixel uses a whole-number nearest-neighbour scale; padding is ink.
"""
import argparse
import io
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'icons'
GRID = 60
INK = '#171321'
P = {
    'ink': INK, 'dark': '#252032', 'stone': '#44394F', 'stone_mid': '#6C6179',
    'stone_light': '#85798F', 'cloth_shadow': '#948A91', 'cloth': '#CEC5B8',
    'cloth_light': '#EEE0CE', 'skin_shadow': '#8B5744', 'skin': '#C58A68',
    'skin_light': '#E9B78C', 'skin_glint': '#F4CCA0', 'bronze': '#805345',
    'gold': '#C38B48', 'gold_light': '#E5B66E', 'spirit_dark': '#223C40',
    'spirit_mid': '#367C7A', 'spirit': '#6DD6CB', 'spirit_light': '#B5F3DD',
}
OUTPUTS = {
    'night-ritual-monk-v2-180.png': (180, 3),
    'night-ritual-monk-v2-192.png': (192, 3),
    'night-ritual-monk-v2-512.png': (512, 8),
    'night-ritual-monk-v2-maskable-512.png': (512, 7),
}


def canvas():
    art = Image.new('RGB', (GRID, GRID), INK)
    return art, ImageDraw.Draw(art)


def spirit_flame(d, x, y):
    """A stepped, asymmetric flame, always in palette clusters."""
    def shape(points, color):
        d.polygon([(x + px, y + py) for px, py in points], fill=P[color])
    shape([(0, -14), (2, -7), (6, -10), (5, -4), (9, 1), (9, 5),
           (5, 9), (-4, 9), (-9, 4), (-8, -2), (-4, -6), (-3, 0), (0, -4)], 'spirit_mid')
    shape([(0, -10), (1, -3), (4, -5), (3, 0), (6, 3), (4, 7),
           (-2, 8), (-6, 3), (-3, -1), (-2, 3), (0, 1)], 'spirit')
    shape([(0, -1), (1, 2), (3, 3), (2, 6), (-1, 6), (-3, 3)], 'spirit_light')


def seal():
    art, d = canvas()
    # A substantial carved seal, rather than the favicon enlarged.
    diamond = [(30, 4), (55, 29), (55, 32), (31, 56), (28, 56), (4, 32), (4, 29)]
    d.polygon(diamond, fill=P['stone'])
    d.polygon([(30, 4), (55, 29), (49, 29), (30, 10), (10, 30), (4, 30)], fill=P['stone_light'])
    d.polygon([(30, 10), (49, 29), (49, 32), (31, 50), (28, 50), (10, 32), (10, 29)], fill=P['ink'])
    d.polygon([(30, 13), (47, 30), (30, 47), (13, 30)], fill=P['spirit_dark'])
    d.polygon([(30, 17), (43, 30), (30, 43), (17, 30)], fill=P['ink'])
    spirit_flame(d, 30, 30)
    for x, y in [(28, 7), (48, 28), (28, 49), (7, 28)]:
        d.rectangle((x, y, x + 3, y + 3), fill=P['gold'])
    d.line([(17, 14), (20, 17), (18, 19)], fill=P['ink'], width=2)
    d.line([(41, 43), (38, 40), (40, 38)], fill=P['ink'], width=2)
    return art


def monk():
    art, d = canvas()
    # Cold spirit halo and a dark inner void frame the warm, unhooded monk.
    d.ellipse((5, 4, 54, 53), fill=P['spirit_dark'])
    d.ellipse((7, 6, 52, 51), fill=P['spirit_mid'])
    d.ellipse((10, 9, 49, 48), fill=P['ink'])
    d.arc((7, 6, 52, 51), 190, 285, fill=P['spirit'], width=2)
    d.rectangle((15, 10, 17, 11), fill=P['spirit_light'])
    d.rectangle((44, 13, 46, 15), fill=P['spirit'])
    # Dark outline, compact shoulders, no text or fine decorative noise.
    d.polygon([(23, 29), (35, 29), (40, 32), (45, 37), (48, 47),
               (42, 52), (17, 52), (12, 47), (15, 37), (20, 32)], fill=P['ink'])
    d.polygon([(22, 31), (35, 31), (41, 36), (45, 47), (40, 50),
               (18, 50), (15, 46), (18, 36)], fill=P['cloth_shadow'])
    d.polygon([(22, 32), (28, 34), (24, 43), (18, 47), (16, 45), (19, 36)], fill=P['cloth_light'])
    d.polygon([(35, 32), (40, 36), (44, 46), (39, 49), (30, 45), (29, 39)], fill=P['cloth'])
    d.polygon([(36, 34), (39, 37), (41, 42), (38, 41), (34, 36)], fill=P['cloth_light'])
    d.polygon([(20, 47), (27, 43), (34, 46), (40, 50), (19, 50)], fill=P['stone'])
    d.rectangle((26, 29, 33, 35), fill=P['skin_shadow'])
    d.rectangle((27, 29, 31, 34), fill=P['skin'])
    # Broad stepped head, side-plane shading, brow and two quiet eye clusters.
    d.polygon([(24, 12), (32, 12), (36, 16), (37, 23), (35, 28),
               (31, 31), (26, 30), (22, 26), (21, 18)], fill=P['ink'])
    d.polygon([(25, 13), (31, 13), (35, 17), (35, 25), (32, 29),
               (27, 28), (24, 25), (22, 19)], fill=P['skin'])
    d.polygon([(25, 14), (30, 14), (33, 16), (32, 20), (25, 21), (23, 19)], fill=P['skin_light'])
    d.rectangle((25, 14, 29, 15), fill=P['skin_glint'])
    d.polygon([(33, 19), (35, 18), (35, 25), (32, 29), (29, 28), (32, 25)], fill=P['skin_shadow'])
    d.rectangle((22, 22, 23, 24), fill=P['skin_light'])
    d.rectangle((25, 22, 27, 22), fill=P['bronze'])
    d.rectangle((31, 22, 33, 22), fill=P['bronze'])
    d.rectangle((28, 23, 29, 25), fill=P['skin_light'])
    d.rectangle((28, 27, 30, 27), fill=P['skin_shadow'])
    # Bronze prayer beads support the costume at small size.
    for x, y in [(23, 32), (24, 35), (25, 38), (34, 32), (33, 35), (32, 38)]:
        d.rectangle((x, y, x + 1, y + 1), fill=P['bronze'])
        d.point((x, y), fill=P['gold_light'])
    # Two hands cradle a spirit flame, the brightest focal point.
    d.polygon([(18, 39), (21, 39), (25, 43), (28, 42), (29, 44),
               (26, 47), (22, 46), (18, 43)], fill=P['skin_shadow'])
    d.polygon([(19, 39), (21, 40), (25, 43), (27, 43), (25, 45),
               (22, 44), (19, 42)], fill=P['skin_light'])
    d.polygon([(39, 39), (42, 41), (39, 45), (34, 47), (31, 45),
               (32, 43), (35, 43)], fill=P['skin_shadow'])
    d.polygon([(39, 39), (40, 41), (37, 44), (34, 45), (33, 44), (36, 42)], fill=P['skin_light'])
    # A smaller flame so it does not cover the face, hands or robe silhouette.
    d.polygon([(30, 31), (30, 35), (33, 34), (32, 38), (34, 40),
               (32, 43), (28, 43), (26, 40), (28, 36), (28, 39), (30, 37)], fill=P['spirit'])
    d.polygon([(30, 37), (32, 40), (31, 42), (29, 42), (28, 40)], fill=P['spirit_light'])
    d.rectangle((19, 49, 24, 50), fill=P['spirit_mid'])
    d.rectangle((0, 51, 59, 59), fill=P['ink'])  # The halo ends behind the shoulders.
    return art


def palm():
    art, d = canvas()
    d.ellipse((6, 5, 53, 52), fill=P['spirit_dark'])
    d.ellipse((9, 8, 50, 49), fill=P['ink'])
    d.arc((7, 6, 52, 51), 195, 325, fill=P['spirit_mid'], width=2)
    spirit_flame(d, 31, 22)
    d.polygon([(15, 34), (17, 32), (21, 36), (24, 39), (34, 39),
               (39, 34), (43, 30), (46, 32), (42, 39), (37, 45), (30, 47),
               (28, 53), (16, 50), (20, 44), (16, 39)], fill=P['skin_shadow'])
    d.polygon([(17, 33), (21, 37), (24, 40), (33, 41), (37, 39),
               (43, 32), (43, 35), (38, 42), (30, 44), (25, 43), (20, 40)], fill=P['skin_light'])
    d.polygon([(18, 46), (29, 49), (28, 54), (15, 50)], fill=P['cloth_light'])
    d.line([(18, 47), (28, 50)], fill=P['gold'], width=2)
    d.rectangle((18, 27, 19, 29), fill=P['spirit'])
    d.rectangle((44, 20, 45, 21), fill=P['spirit'])
    return art


def icon(art, side, scale):
    image = Image.new('RGB', (side, side), INK)
    big = art.resize((GRID * scale, GRID * scale), Image.Resampling.NEAREST)
    offset = (side - big.width) // 2
    image.paste(big, (offset, offset))
    return image


def check_safe_circle(image):
    """Every non-ink pixel, including its corners, must survive the safe mask."""
    half = image.width / 2
    radius = image.width * .4
    ink = tuple(bytes.fromhex(INK[1:]))
    for y in range(image.height):
        for x in range(image.width):
            if image.getpixel((x, y)) == ink:
                continue
            dx = max(abs(x - half), abs(x + 1 - half))
            dy = max(abs(y - half), abs(y + 1 - half))
            if dx * dx + dy * dy > radius * radius:
                sys.exit(f'maskable motif outside safe circle: {x},{y}')


def encoded(image):
    buffer = io.BytesIO()
    image.save(buffer, 'PNG', optimize=True)
    return buffer.getvalue()


def preview(directory):
    """Disposable review board, native grids, and two home-screen wallpapers."""
    directory.mkdir(parents=True, exist_ok=True)
    font = ImageFont.load_default(size=16)
    small = ImageFont.load_default(size=12)
    variants = [('A / SPIRIT SEAL', seal()), ('B / MONK - SELECTED', monk()), ('C / SPIRIT PALM', palm())]
    board = Image.new('RGB', (1056, 850), '#211D2C')
    d = ImageDraw.Draw(board)
    d.text((28, 18), 'NIGHT RITUAL / APP ICON / 60 x 60 NATIVE PIXELS', font=font, fill=P['cloth_light'])
    for i, (label, art) in enumerate(variants):
        x = 28 + i * 348
        d.text((x, 52), label, font=font, fill=P['spirit'] if i == 1 else P['cloth'])
        board.paste(icon(art, 240, 4), (x, 84))
        board.paste(icon(art, 60, 1), (x + 260, 100))
        d.text((x + 260, 168), '60 px', font=small, fill=P['cloth'])
        directory.joinpath(f'variant-{i + 1}-native.png').write_bytes(encoded(art))
    d.text((28, 348), 'CHOSEN B / HOME SCREEN AT 60 CSS px / DARK + LIGHT WALLPAPER', font=font, fill=P['cloth_light'])
    for i, (name, bg, text) in enumerate([('dark', '#161C2B', '#EEE0CE'), ('light', '#E6E1D8', '#44394F')]):
        wall = Image.new('RGB', (464, 390), bg)
        w = ImageDraw.Draw(wall)
        # Wallpaper-only stepped mountains; never part of a shipped icon.
        w.polygon([(0, 290), (90, 190), (160, 260), (300, 110), (464, 265), (464, 390), (0, 390)],
                  fill='#253548' if i == 0 else '#C1C6BF')
        w.text((24, 20), '21:40   /   NIGHT RITUAL', font=font, fill=text)
        w.text((24, 47), 'Home-screen mock / 1x CSS size', font=small, fill=text)
        thumb = icon(monk(), 60, 1)
        mask = Image.new('L', (60, 60), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, 59, 59), radius=13, fill=255)
        wall.paste(thumb, (34, 107), mask)
        w.text((28, 177), 'Night Ritual', font=small, fill=text)
        # A larger view beside the native home-screen size makes pixel edges inspectable.
        zoom = icon(monk(), 180, 3)
        zoom_mask = Image.new('L', (180, 180), 0)
        ImageDraw.Draw(zoom_mask).rounded_rectangle((0, 0, 179, 179), radius=39, fill=255)
        wall.paste(zoom, (237, 100), zoom_mask)
        w.text((260, 295), '180 px / Apple', font=small, fill=text)
        directory.joinpath(f'wallpaper-{name}.png').write_bytes(encoded(wall))
        board.paste(wall, (28 + i * 516, 392))
    d.text((28, 808), 'Nearest-neighbour only. No text, wallpaper or rounded corners in shipped PNGs.', font=small, fill=P['cloth'])
    directory.joinpath('contact-sheet.png').write_bytes(encoded(board))
    # Three common OS masks, plus the conservative safe circle overlay.
    masks = Image.new('RGB', (1056, 310), '#211D2C')
    md = ImageDraw.Draw(masks)
    safe = icon(monk(), 512, 7)
    for i, name in enumerate(['Circle', 'Rounded square', '80% safe circle']):
        thumb = safe.resize((256, 256), Image.Resampling.NEAREST)
        mask = Image.new('L', (256, 256), 0)
        draw = ImageDraw.Draw(mask)
        if i == 0:
            draw.ellipse((0, 0, 255, 255), fill=255)
        else:
            draw.rounded_rectangle((0, 0, 255, 255), radius=52, fill=255)
        x = 28 + i * 348
        masks.paste(thumb, (x, 16), mask)
        if i == 2:
            md.ellipse((x + 25.6, 41.6, x + 230.4, 246.4), outline=P['gold_light'], width=1)
        md.text((x, 282), name, font=font, fill=P['cloth_light'])
    directory.joinpath('maskable-preview.png').write_bytes(encoded(masks))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--verify-only', action='store_true', help='compare pixels without writing files')
    parser.add_argument('--preview-dir', type=Path, help='write review sheets to a separate directory')
    args = parser.parse_args()
    if args.verify_only and args.preview_dir:
        parser.error('--verify-only never writes previews; run previews separately')
    art = monk()
    stale = []
    for name, (side, scale) in OUTPUTS.items():
        path, image = OUT / name, icon(art, side, scale)
        if 'maskable' in name:
            check_safe_circle(image)
        if args.verify_only:
            if not path.exists():
                stale.append(name)
                continue
            with Image.open(path) as existing:
                if existing.mode != 'RGB' or existing.size != image.size or existing.tobytes() != image.tobytes():
                    stale.append(name)
            continue
        OUT.mkdir(parents=True, exist_ok=True)
        path.write_bytes(encoded(image))
        print(f'{path.relative_to(ROOT)}  {side}×{side}  native 60×60 ×{scale}')
    if stale:
        sys.exit(f'stale icons: {", ".join(stale)}; run python3 -B scripts/build-app-icons.py')
    if args.verify_only:
        print('4 app icons verified; maskable motif fits the central 80% safe circle.')
    if args.preview_dir:
        preview(args.preview_dir)


if __name__ == '__main__':
    main()
