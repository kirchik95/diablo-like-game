#!/usr/bin/env python3
"""Build the 14×14 skill and item icons from the ASCII maps below.

One art pixel is one HUD unit `--u`. Each icon has four files: `@1x` to `@4x`,
where the number is bitmap pixels per art pixel (nearest neighbour). Pick the
file whose scale equals `--u` × devicePixelRatio, or the nearest one below it.
The script adds a 1-pixel `--night` outline around every silhouette.

    python3 -B scripts/build-icon-assets.py            # write the PNGs
    python3 -B scripts/build-icon-assets.py --verify-only
"""
import argparse
import hashlib
import io
import json
import sys
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent.parent / 'assets' / 'ui' / 'pixel-v5' / 'icons'

# Palette matches the HUD tokens in src/styles.css.
TOKENS = {
    'k': ('--night', '#0d0a14'),        # outline, holes
    'n': ('--ink', '#171321'),
    'o': ('--coal', '#211a2b'),
    'x': ('--slate', '#2c2437'),
    'g': ('--stone-dark', '#44394f'),
    'h': ('--stone', '#6c6179'),
    'v': ('--dim', '#85798f'),
    'm': ('--muted', '#b4aaba'),
    'i': ('--ivory', '#eee0ce'),
    'c': ('--coral', '#ef8e83'),
    'p': ('--coral-light', '#f8c4ab'),
    'r': ('--coral-dark', '#9d4e5c'),
    's': ('--spirit', '#6dd6cb'),
    'l': ('--spirit-light', '#c2f0dd'),
    'e': ('--spirit-dark', '#397c85'),
    'a': ('--amber', '#e5b66e'),
    'b': ('--amber-dark', '#8f734f'),
}
PALETTE = {key: tuple(int(color[i:i + 2], 16) for i in (1, 3, 5)) + (255,) for key, (_, color) in TOKENS.items()}
OUTLINE = 'k'
SIZE = 14
SCALES = (1, 2, 3, 4)
# Contact sheet backgrounds: the HUD skill well and a bag cell.
WELL = (26, 21, 35, 255)        # #1a1523, .skill --frame-fill
CELL = PALETTE['x']             # --slate
SHEET = PALETTE['n']            # --ink

# Series of strikes: the icon follows the weapon family (`bare` is no weapon).
COMBO_BARE = [
    '..............',
    '..............',
    '..pp.pp.pp.pp.',
    '..pcrpcrpcrpc.',
    '..ccrccrccrcc.',
    '..ccrccrccrcc.',
    '..rrrrrrrrrcc.',
    '.pppppppcrccr.',
    '.pcccccccrcr..',
    '..rrrrrrccc...',
    '....cccccr....',
    '....ccccr.....',
    '....rrrr......',
    '..............',
]

COMBO_KNUCKLES = [
    '..............',
    '..............',
    '..pp.pp.pp.pp.',
    '..pcrpcrpcrpc.',
    '.iaaiaaiaaiaa.',
    '.abbabbabbabb.',
    '..rrrrrrrrrcc.',
    '.pppppppcrccr.',
    '.pcccccccrcr..',
    '..rrrrrrccc...',
    '....cccccr....',
    '....ccccr.....',
    '....rrrr......',
    '..............',
]

COMBO_STAFF = [
    '..............',
    '...........ai.',
    '..........ab..',
    '.........ab...',
    '....pp.ppab...',
    '...pccpcccr...',
    '...ccrccrcr...',
    '...rrrrrrr....',
    '...ppppcrr....',
    '...rrrrrr.....',
    '...ab.........',
    '..ab..........',
    '.ab...........',
    '..............',
]

DASH = [
    '..............',
    '.........ll...',
    '.eeee....ls...',
    '......ssssss..',
    '.....s.ss...s.',
    '....s..ss.....',
    'ee....ss......',
    '......sss.....',
    '.eee.s...ss...',
    '...ss.....s...',
    '..s.......ss..',
    '..............',
    '..............',
    '..............',
]

WAVE = [
    '..............',
    '......l.......',
    '.....sll......',
    '.....slls.....',
    '...eessssee...',
    '..e...ss...e..',
    '.e..........e.',
    '.s..........s.',
    '.ss........ss.',
    '..ss......ss..',
    '...sslllllss..',
    '.....ssss.....',
    '..............',
    '..............',
]

PALM = [
    '..............',
    '.......l......',
    '.....l.s.l....',
    '.....s.s.s.l..',
    '.....s.s.s.s..',
    '.....sssssss..',
    '..l..sssssss..',
    '..ss.scclsss..',
    '...sssccssss..',
    '....sssssssee.',
    '.....sssssee..',
    '......eeeee...',
    '..............',
    '..............',
]

CRANE = [
    '..............',
    '.l..........l.',
    '.sl........ls.',
    '.ssl..cc..lss.',
    '..ssl.ll.lss..',
    '..ssssssssss..',
    '....ssssss....',
    '.....ssss.....',
    '.....e..e.....',
    '....e....e....',
    '..............',
    '..eeeeeeeeee..',
    '.ss........ss.',
    '..ssssssssss..',
]

DEFLECT = [
    '..............',
    '.ppc..ll..cpp.',
    '.ccr......rcc.',
    '...rr....cc...',
    '....rr..cc....',
    '.....rrcc.....',
    '......cc......',
    '.....ccrr.....',
    '....cc..rr....',
    '...cc....rr...',
    '..cc......rr..',
    '.s..........s.',
    '..ssssssssss..',
    '..............',
]

BELL = [
    '..............',
    '......bb......',
    '.....aaab.....',
    '..l.iaaaab.l..',
    '.l..iaaaab..l.',
    '..l.aaaaab.l..',
    '...aaaaaaab...',
    '...bbbbbbbb...',
    '..aaaaaaaaab..',
    '.iaaaaaaaaaab.',
    '.bbbbbbbbbbbb.',
    '......ab......',
    '.s.ss....ss.s.',
    '..............',
]

MANTRA = [
    '..............',
    '......ia......',
    '...ia.ab.ia...',
    '...ab....ab...',
    '..............',
    '......ls......',
    '.ia..lsse..ia.',
    '.ab..ssse..ab.',
    '......se......',
    '..............',
    '...ia....ia...',
    '...ab.ia.ab...',
    '......ab......',
    '..............',
]

SEVEN_STRIKES = [
    '..............',
    '......l.......',
    '..l...s.......',
    '...s..s...l...',
    '....s....s....',
    '.........s....',
    '......c.......',
    '.lss.cpc..ssl.',
    '......c.......',
    '.....s.s......',
    '....s...s.....',
    '....l...l.....',
    '..............',
    '..............',
]

LOCK = [
    '..............',
    '..............',
    '.....mmmm.....',
    '....m....m....',
    '....v....v....',
    '....v....v....',
    '...mmmmmmmm...',
    '...vvvvvvvg...',
    '...vvvkkvvg...',
    '...vvvkkvvg...',
    '...vvvvvvvg...',
    '...gggggggg...',
    '..............',
    '..............',
]

NOVICE_KNUCKLES = [
    '..............',
    '..............',
    '..............',
    '.immimmimmimm.',
    '.mkhmkhmkhmkh.',
    '.hhghhghhghhg.',
    '..gb......bg..',
    '..ba......ab..',
    '..ba......ab..',
    '..baaaaaaaab..',
    '...bbbbbbbb...',
    '..............',
    '..............',
    '..............',
]

BRONZE_KNUCKLES = [
    '..............',
    '..............',
    '..............',
    '.iaaiaaiaaiaa.',
    '.akbakbakbakb.',
    '.bbrbbrbbrbbr.',
    '..rb......br..',
    '..ba......ab..',
    '..ba......ab..',
    '..baaaaaaaab..',
    '...bbbbbbbb...',
    '..............',
    '..............',
    '..............',
]

PILGRIM_KNUCKLES = [
    '..............',
    '..............',
    '..m..m..m..m..',
    '.immimmimmimm.',
    '.hkghkghkghkg.',
    '.ggxggxggxggx.',
    '..gx......xg..',
    '..rc......cr..',
    '..rc......cr..',
    '..rcccccccpr..',
    '...rrrrrrrr...',
    '..............',
    '..............',
    '..............',
]

NOVICE_STAFF = [
    '..............',
    '..............',
    '...........ab.',
    '..........ab..',
    '.........im...',
    '........ab....',
    '.......ab.....',
    '......im......',
    '.....ab.......',
    '....ab........',
    '...ab.........',
    '..ab..........',
    '.gb...........',
    '..............',
]

ASH_STAFF = [
    '..............',
    '..............',
    '...........mh.',
    '..........mh..',
    '.........ia...',
    '........ib....',
    '.......ia.....',
    '......ia......',
    '.....ib.......',
    '....ia........',
    '...ia.........',
    '..mh..........',
    '.mh...........',
    '..............',
]

PILGRIM_STAFF = [
    '..............',
    '.........aia..',
    '........a...a.',
    '........a...b.',
    '.........abb..',
    '........hgc...',
    '.......hg.r...',
    '......hg......',
    '.....hg.......',
    '....hg........',
    '...hg.........',
    '..hg..........',
    '.ab...........',
    '..............',
]

CRANE_NECK = [
    '..............',
    '........ciii..',
    '.......pi...ia',
    '...........ab.',
    '..........ab..',
    '.........ab...',
    '........ab....',
    '.......ab.....',
    '......ab......',
    '.....ab.......',
    '....ab........',
    '...ab.........',
    '..ab..........',
    '..............',
]

QUIET_THUNDER = [
    '..............',
    '...l..l..l....',
    '..l..l..l.....',
    '.lsslsslssls..',
    '.akbakbakbakb.',
    '.bbrbbrbbrbbr.',
    '..rb......br..',
    '..rc......cr..',
    '..rc......cr..',
    '..rcccccccpr..',
    '...rrrrrrrr...',
    '..............',
    '..............',
    '..............',
]

# name -> (kind, data id, art). Data ids are SKILLS, WEAPON_BASES and RELICS keys.
ICONS = {
    'skill-combo-bare': ('skill', 'combo', COMBO_BARE),
    'skill-combo-knuckles': ('skill', 'combo', COMBO_KNUCKLES),
    'skill-combo-staff': ('skill', 'combo', COMBO_STAFF),
    'skill-dash': ('skill', 'dash', DASH),
    'skill-wave': ('skill', 'wave', WAVE),
    'skill-palm': ('skill', 'palm', PALM),
    'skill-crane': ('skill', 'crane', CRANE),
    'skill-deflect': ('skill', 'deflect', DEFLECT),
    'skill-bell': ('skill', 'bell', BELL),
    'skill-mantra': ('skill', 'mantra', MANTRA),
    'skill-seven-strikes': ('skill', 'sevenStrikes', SEVEN_STRIKES),
    'lock': ('ui', 'lock', LOCK),
    'weapon-novice-knuckles': ('weapon', 'novice-knuckles', NOVICE_KNUCKLES),
    'weapon-bronze-knuckles': ('weapon', 'bronze-knuckles', BRONZE_KNUCKLES),
    'weapon-pilgrim-knuckles': ('weapon', 'pilgrim-knuckles', PILGRIM_KNUCKLES),
    'weapon-novice-staff': ('weapon', 'novice-staff', NOVICE_STAFF),
    'weapon-ash-staff': ('weapon', 'ash-staff', ASH_STAFF),
    'weapon-pilgrim-staff': ('weapon', 'pilgrim-staff', PILGRIM_STAFF),
    'relic-quiet-thunder': ('relic', 'quiet-thunder', QUIET_THUNDER),
    'relic-crane-neck': ('relic', 'crane-neck', CRANE_NECK),
}
# The series icon for each weapon family; `bare` is the series without a weapon.
COMBO = {'bare': 'skill-combo-bare', 'knuckles': 'skill-combo-knuckles', 'staff': 'skill-combo-staff'}
SHEET_ROWS = (
    [name for name, (kind, _, _) in ICONS.items() if kind in ('skill', 'ui')],
    [name for name, (kind, _, _) in ICONS.items() if kind in ('weapon', 'relic')],
)


def outlined(art):
    """Paint `--night` on every empty pixel that touches a coloured pixel by its side."""
    assert len(art) == SIZE and all(len(row) == SIZE for row in art), 'icons are 14×14'
    grid = [list(row) for row in art]
    for y, row in enumerate(art):
        for x, key in enumerate(row):
            if key != '.':
                continue
            near = [art[y + dy][x + dx] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                    if 0 <= x + dx < SIZE and 0 <= y + dy < SIZE]
            if any(n not in '.' + OUTLINE for n in near):
                grid[y][x] = OUTLINE
    return [''.join(row) for row in grid]


def image(art, scale):
    base = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    for y, row in enumerate(outlined(art)):
        for x, key in enumerate(row):
            if key != '.':
                base.putpixel((x, y), PALETTE[key])
    return base if scale == 1 else base.resize((SIZE * scale, SIZE * scale), Image.NEAREST)


def png(img):
    buffer = io.BytesIO()
    img.save(buffer, format='PNG', optimize=False)
    return buffer.getvalue()


def faded(img, percent):
    """The locked and low-spirit state: the icon at `percent` opacity."""
    out = img.copy()
    out.putalpha(img.getchannel('A').point(lambda a: a * percent // 100))
    return out


def contact_sheet():
    """Each icon: 4× on the skill well, 2× on a bag cell, 2× at 35%, 1× on a bag cell."""
    cell, gap, margin = 64, 8, 12
    row_height = cell + 4 + 30 + 4 + 16
    columns = max(len(row) for row in SHEET_ROWS)
    sheet = Image.new('RGBA', (margin * 2 + columns * cell + (columns - 1) * gap,
                               margin * 2 + len(SHEET_ROWS) * row_height + (len(SHEET_ROWS) - 1) * margin), SHEET)

    def tile(x, y, size, color, icon, offset):
        sheet.paste(Image.new('RGBA', (size, size), color), (x, y))
        sheet.alpha_composite(icon, (x + offset, y + offset))

    for r, names in enumerate(SHEET_ROWS):
        top = margin + r * (row_height + margin)
        for c, name in enumerate(names):
            left = margin + c * (cell + gap)
            art = ICONS[name][2]
            tile(left, top, cell, WELL, image(art, 4), 4)
            tile(left, top + cell + 4, 30, CELL, image(art, 2), 1)
            tile(left + 34, top + cell + 4, 30, CELL, faded(image(art, 2), 35), 1)
            tile(left, top + cell + 38, 16, CELL, image(art, 1), 1)
    return sheet


def build():
    files, icons = {}, {}
    for name, (kind, data_id, art) in ICONS.items():
        entry = {'kind': kind, 'id': data_id, 'files': {}, 'sizes': {}}
        for scale in SCALES:
            filename = f'{name}@{scale}x.png'
            files[filename] = png(image(art, scale))
            entry['files'][str(scale)] = filename
            entry['sizes'][str(scale)] = [SIZE * scale, SIZE * scale]
        icons[name] = entry
    files['contact-sheet.png'] = png(contact_sheet())
    by_kind = lambda kind: {entry['id']: name for name, entry in icons.items() if kind == entry['kind']}
    skills = by_kind('skill')
    skills['combo'] = COMBO['bare']
    manifest = {
        'schemaVersion': 1,
        'artSize': [SIZE, SIZE],
        'scales': list(SCALES),
        'outline': TOKENS[OUTLINE][0],
        'palette': {token: color for token, color in TOKENS.values()},
        'skills': skills,
        'combo': COMBO,
        'weapons': by_kind('weapon'),
        'relics': by_kind('relic'),
        'lock': 'lock',
        'icons': icons,
        'contactSheet': {'file': 'contact-sheet.png', 'rows': [list(row) for row in SHEET_ROWS]},
        'files': {filename: hashlib.sha256(data).hexdigest() for filename, data in sorted(files.items())},
    }
    files['manifest.json'] = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode()
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
