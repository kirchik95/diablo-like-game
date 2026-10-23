#!/usr/bin/env python3
"""Build the Ritual Pixel HUD font from ritual-pixel-glyphs.txt.

Requires Python 3.10+, fontTools with brotli (WOFF2) and Pillow (checks, specimen).
Every font pixel is 100 units; the em is 9 pixels (7 above the baseline, 2 below),
so CSS `font-size: calc(var(--u) * 9)` draws one font pixel per HUD unit.

    python3 -B assets/ui/pixel-v3/source/build-ritual-pixel.py              # rebuild
    python3 -B assets/ui/pixel-v3/source/build-ritual-pixel.py --verify-only
"""
import argparse
import hashlib
import io
import json
import sys
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'source' / 'ritual-pixel-glyphs.txt'
WOFF2 = ROOT / 'ritual-pixel.woff2'
META = ROOT / 'ritual-pixel.json'
SPECIMEN = ROOT / 'ritual-pixel-specimen.png'

PIXEL = 100
ASCENT, DESCENT, CAP_HEIGHT, X_HEIGHT = 7, 2, 6, 4
EM = ASCENT + DESCENT
SPACE_WIDTH = 2  # Advance of three pixels with the shared one-pixel gap.
FAMILY = 'Ritual Pixel'
TIMESTAMP = timestampFromString('Fri Oct 23 00:00:00 2026')
SPECIMEN_LINES = [
    'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
    'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz',
    '0123456789 .,:;!? -–—− +=×/\\|*#%&@$^_`~<>()[]{} · … « » \' "',
    'Дорога к монастырю · Осталось здесь 22 / 22',
    'Пройди разбитую дорогу. Боковая тропа скрывает тайник и святилище.',
    'ЛКМ  Пробел  ПКМ / Q  Esc  M  E — открыть тайник  100 / 100  60 / 100',
]


def parse(text):
    """Return {char: (rows_above, rows_below)} with rows as strings of '#' and '.'."""
    glyphs, aliases, current = {}, {}, None
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip() or line.startswith('# '):
            continue
        if line.startswith(': '):
            name = line[2:]
            if len(name) > 1 and ' = ' in name:
                char, source = name.split(' = ')
                aliases[char] = source
                current = None
            else:
                if len(name) != 1:
                    raise ValueError(f'line {number}: expected one character, got {name!r}')
                current = glyphs.setdefault(name, ([], []))
                if current[0] or current[1]:
                    raise ValueError(f'line {number}: duplicate glyph {name!r}')
                below = False
            continue
        if current is None:
            raise ValueError(f'line {number}: bitmap row outside a glyph')
        if line == '--':
            below = True
            continue
        if set(line) - {'#', '.'}:
            raise ValueError(f'line {number}: unexpected characters in {line!r}')
        current[1 if below else 0].append(line)
    for char, source in aliases.items():
        if char in glyphs or source not in glyphs:
            raise ValueError(f'alias {char!r} -> {source!r} is invalid')
        glyphs[char] = glyphs[source]
    for char, (above, below) in glyphs.items():
        rows = above + below
        if len({len(row) for row in rows}) != 1:
            raise ValueError(f'glyph {char!r} has rows of different widths')
        if len(above) > ASCENT or len(below) > DESCENT:
            raise ValueError(f'glyph {char!r} exceeds the {ASCENT}+{DESCENT} pixel em')
    return glyphs


def pixels(glyph):
    """Filled cells as (column, row); row 0 sits directly above the baseline."""
    above, below = glyph
    cells = set()
    for index, row in enumerate(above):
        cells.update((x, len(above) - 1 - index) for x, value in enumerate(row) if value == '#')
    for index, row in enumerate(below):
        cells.update((x, -1 - index) for x, value in enumerate(row) if value == '#')
    return cells


def contours(cells):
    """Trace the union of cells into clockwise outlines (ink on the right, y up)."""
    edges = {}
    for x, y in cells:
        if (x, y + 1) not in cells: edges.setdefault((x, y + 1), []).append((x + 1, y + 1))
        if (x + 1, y) not in cells: edges.setdefault((x + 1, y + 1), []).append((x + 1, y))
        if (x, y - 1) not in cells: edges.setdefault((x + 1, y), []).append((x, y))
        if (x - 1, y) not in cells: edges.setdefault((x, y), []).append((x, y + 1))
    loops = []
    while edges:
        start = next(iter(edges))
        loop, point, previous = [start], start, None
        while True:
            options = edges[point]
            # At diagonal contacts prefer the right turn, which keeps touching cells separate.
            if previous and len(options) > 1:
                dx, dy = point[0] - previous[0], point[1] - previous[1]
                right = (point[0] + dy, point[1] - dx)
                following = right if right in options else options[0]
            else:
                following = options[0]
            options.remove(following)
            if not options: del edges[point]
            previous, point = point, following
            if point == start: break
            loop.append(point)
        # Drop points in the middle of straight runs.
        simple = [p for i, p in enumerate(loop)
                  if (loop[i - 1][0] - p[0]) * (loop[(i + 1) % len(loop)][1] - p[1])
                  != (loop[i - 1][1] - p[1]) * (loop[(i + 1) % len(loop)][0] - p[0])]
        loops.append(simple)
    return loops


def glyph_name(char):
    return 'space' if char == ' ' else f'uni{ord(char):04X}'


def build(glyphs):
    chars = sorted(glyphs, key=ord)
    order = ['.notdef', 'space', *[glyph_name(c) for c in chars]]
    cmap = {ord(' '): 'space', 0xA0: 'space', **{ord(c): glyph_name(c) for c in chars}}
    outlines, metrics = {}, {}

    def draw(name, cells, width):
        pen = TTGlyphPen(None)
        for loop in contours(cells):
            pen.moveTo((loop[0][0] * PIXEL, loop[0][1] * PIXEL))
            for x, y in loop[1:]: pen.lineTo((x * PIXEL, y * PIXEL))
            pen.closePath()
        outlines[name] = pen.glyph()
        metrics[name] = ((width + 1) * PIXEL, min((x for x, _ in cells), default=0) * PIXEL)

    notdef = {(x, y) for x in range(4) for y in range(CAP_HEIGHT) if x in (0, 3) or y in (0, CAP_HEIGHT - 1)}
    draw('.notdef', notdef, 4)
    draw('space', set(), SPACE_WIDTH)
    for char in chars:
        draw(glyph_name(char), pixels(glyphs[char]), len((glyphs[char][0] + glyphs[char][1])[0]))

    builder = FontBuilder(unitsPerEm=EM * PIXEL, isTTF=True)
    builder.font.recalcTimestamp = False
    builder.setupGlyphOrder(order)
    builder.setupCharacterMap(cmap)
    builder.setupGlyf(outlines)
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=ASCENT * PIXEL, descent=-DESCENT * PIXEL, lineGap=0)
    builder.setupNameTable({
        'familyName': FAMILY, 'styleName': 'Regular', 'uniqueFontIdentifier': f'{FAMILY} Regular 1.0',
        'fullName': f'{FAMILY} Regular', 'psName': 'RitualPixel-Regular', 'version': 'Version 1.000',
        'copyright': 'Drawn for Ночной ритуал (night-ritual); project asset.',
    })
    builder.setupOS2(
        version=4, sTypoAscender=ASCENT * PIXEL, sTypoDescender=-DESCENT * PIXEL, sTypoLineGap=0,
        usWinAscent=ASCENT * PIXEL, usWinDescent=DESCENT * PIXEL,
        sxHeight=X_HEIGHT * PIXEL, sCapHeight=CAP_HEIGHT * PIXEL,
        fsSelection=0x40 | 0x80, achVendID='NRIT', usWeightClass=400,
    )
    builder.setupPost(isFixedPitch=0, underlinePosition=-PIXEL, underlineThickness=PIXEL)
    builder.updateHead(created=TIMESTAMP, modified=TIMESTAMP, fontRevision=1.0)
    ttf = io.BytesIO(); builder.save(ttf)
    font = TTFont(io.BytesIO(ttf.getvalue()), recalcTimestamp=False)
    font.flavor = 'woff2'
    woff2 = io.BytesIO(); font.save(woff2)
    return ttf.getvalue(), woff2.getvalue(), sorted(cmap)


def check_raster(ttf, glyphs, scale=4):
    """Rasterise every glyph without antialiasing and compare it with its bitmap."""
    font = ImageFont.truetype(io.BytesIO(ttf), size=EM * scale)
    failures = []
    def normalized(points):
        left, top = min(x for x, _ in points), min(y for _, y in points)
        return {(x - left, y - top) for x, y in points}

    for char, glyph in glyphs.items():
        cells = pixels(glyph)
        if not cells:
            continue
        mask = font.getmask(char, mode='1')
        width, height = mask.size
        drawn = {(x, y) for y in range(height) for x in range(width) if mask.getpixel((x, y))}
        expected = {(cx * scale + i, -cy * scale + j) for cx, cy in cells for i in range(scale) for j in range(scale)}
        if not drawn or normalized(drawn) != normalized(expected):
            failures.append(char)
    return failures


def specimen(glyphs, path, scale=3, pad=6):
    def text_width(line):
        return sum((len((glyphs[c][0] + glyphs[c][1])[0]) if c in glyphs else SPACE_WIDTH) + 1 for c in line)
    width = max(text_width(line) for line in SPECIMEN_LINES) + pad * 2
    height = len(SPECIMEN_LINES) * (EM + 2) + pad * 2
    image = Image.new('RGB', (width, height), (23, 19, 33))
    draw = ImageDraw.Draw(image)
    for row, line in enumerate(SPECIMEN_LINES):
        x, baseline = pad, pad + row * (EM + 2) + ASCENT
        for char in line:
            if char in glyphs:
                for cx, cy in pixels(glyphs[char]):
                    draw.point((x + cx, baseline - 1 - cy), fill=(238, 224, 206))
                x += len((glyphs[char][0] + glyphs[char][1])[0]) + 1
            else:
                x += SPACE_WIDTH + 1
    image.resize((width * scale, height * scale), Image.NEAREST).save(path, optimize=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--verify-only', action='store_true', help='check the committed files without writing')
    args = parser.parse_args()
    glyphs = parse(SOURCE.read_text(encoding='utf8'))
    ttf, woff2, codepoints = build(glyphs)
    failures = check_raster(ttf, glyphs)
    if failures:
        sys.exit(f'outline check failed for: {"".join(failures)}')
    meta = {
        'family': FAMILY, 'file': WOFF2.name, 'sha256': hashlib.sha256(woff2).hexdigest(),
        'unitsPerEm': EM * PIXEL, 'pixelUnits': PIXEL, 'emPixels': EM, 'ascentPixels': ASCENT,
        'descentPixels': DESCENT, 'capHeightPixels': CAP_HEIGHT, 'xHeightPixels': X_HEIGHT,
        'css': 'font-size: calc(var(--u) * 9) draws one font pixel per HUD unit',
        'codepoints': codepoints,
    }
    meta_text = json.dumps(meta, ensure_ascii=False, indent=2) + '\n'
    if args.verify_only:
        problems = []
        if not WOFF2.exists() or WOFF2.read_bytes() != woff2: problems.append(f'{WOFF2.name} differs from the source')
        if not META.exists() or META.read_text(encoding='utf8') != meta_text: problems.append(f'{META.name} differs')
        if problems: sys.exit('; '.join(problems))
        print(f'ok: {len(glyphs)} glyphs, {len(codepoints)} code points, outlines match bitmaps')
        return
    WOFF2.write_bytes(woff2)
    META.write_text(meta_text, encoding='utf8')
    specimen(glyphs, SPECIMEN)
    print(f'wrote {WOFF2.name} ({len(woff2)} bytes), {META.name}, {SPECIMEN.name}: {len(glyphs)} glyphs')


if __name__ == '__main__':
    main()
