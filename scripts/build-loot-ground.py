#!/usr/bin/env python3
"""Build the loot-on-the-ground world sprites from the pixel maps below; --verify-only never writes.

Every weapon base and relic lies flat on the ground in the fixed 2:1 iso view at 32 px/u. Rarity glow
(a ring under the item, a beam above it), the contact shadow and the glint are separate frames, so the
renderer stacks and tints them. Camp supplies show both starter weapons on a cloth.

    python3 -B scripts/build-loot-ground.py            # write the package
    python3 -B scripts/build-loot-ground.py --verify-only
"""
import argparse
import hashlib
import io
import json
import math
import sys
from pathlib import Path

from PIL import Image, __version__ as PILLOW_VERSION

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'game' / 'pixel-v12' / 'loot-ground'
PPU = 32
# Read only for the contact sheet: grounds to test readability on and the monk for scale.
INPUTS = {
    'grass': 'assets/game/pixel-v9/camp-panorama/camp-grass.png',
    'earth': 'assets/game/pixel-v9/camp-panorama/camp-earth.png',
    'flagstone': 'assets/game/pixel-v11/monastery-ruins/courtyard-flagstone.png',
    'monk': 'assets/game/pixel-v10/monk-side/monk-side.png',
}
MONK_CELL, MONK_ANCHOR = 96, (48, 84)

# Every loot frame shares one cell and one anchor, so the layers stack at the same point.
CELL = 48
ANCHOR = (24, 34)
COLUMNS = 8
SUPPLY_SIZE = (72, 52)
SUPPLY_ANCHOR = (36, 28)

INK = '#211a28'                 # outline, as the procedural item art in src/pixel-scene.js
SHADOW = '#141223'              # contact shadow colour of createShadow in src/pixel-scene.js
SHADOW_ALPHA = .4               # SHADOWS.item.alpha in src/render.js

# Rarity ramps: [light, token colour, dark]. The token colour is RARITIES[*].color in src/styles.css.
RARITY = {
    'common': {'token': '--ivory', 'ramp': ['#fff7e4', '#eee0ce', '#b4aaba']},
    'rare': {'token': '--spirit', 'ramp': ['#e4fff5', '#6dd6cb', '#397c85']},
    'relic': {'token': '--amber', 'ramp': ['#fff1cf', '#e5b66e', '#8f734f']},
}


def rgba(value, alpha=255):
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5)) + (alpha,)


# ---------------------------------------------------------------------------------------------
# Knuckles. One knuckle-duster lies with its four finger rings up and its grip towards the camera,
# turned a little off the screen axis. Keys: Y a b c d ring light to deep shade, h finger hole,
# p q r grip light, mid and shade. Overlays add spikes (s S) and spirit sparks (z Z).
KNUCKLES = [
    '.Yaa................',
    'Yaaab.Yaa...........',
    'ahhbcYaaab.Yaa......',
    'bhhcdahhbcYaaab.Yaa.',
    '.ccd.bhhcdahhbcYaaab',
    '.pq...ccd.bhhcdahhbc',
    '.pq........ccd.bhhcd',
    '.pq.............ccd.',
    '.qppppppp.......qr..',
    '..rrrrrrrpppppppqr..',
    '.........rrrrrrrrr..',
]
# Spikes on the ring tops: (x, y) of the tip, the base sits one row below.
SPIKES = [(2, -2), (7, -1), (12, 0), (17, 1)]
SPARKS = [(-1, -2, 'z'), (0, -1, 'Z'), (3, -3, 'z'), (4, -2, 'Z'), (8, -2, 'z'), (9, -1, 'Z'),
          (13, -1, 'z'), (14, -2, 'z'), (18, 0, 'z'), (19, -1, 'Z'), (20, 1, 'z')]

IRON = {'Y': '#ece6ee', 'a': '#b9b0c0', 'b': '#8a8094', 'c': '#5f5669', 'd': '#3f3848', 'h': '#1a1520'}
BRONZE = {'Y': '#fbe7b0', 'a': '#ecc37c', 'b': '#c8935a', 'c': '#8f5f3e', 'd': '#5c3a26', 'h': '#2a1c1c'}
DARK_IRON = {'Y': '#b2a8bd', 'a': '#83788f', 'b': '#5f556c', 'c': '#463d52', 'd': '#2f2839', 'h': '#141018'}
WOOD_GRIP = {'p': '#e2b676', 'q': '#a8764e', 'r': '#6e4a32'}
BRONZE_GRIP = {'p': '#f3d08e', 'q': '#c8935a', 'r': '#8f5f3e'}
CORAL_GRIP = {'p': '#f8c4ab', 'q': '#ef8e83', 'r': '#9d4e5c'}
SPIKE = {'s': '#fff7e4', 'S': '#b4aaba'}
SPARK = {'z': '#e4fff5', 'Z': '#6dd6cb'}


def knuckles(rings, grip, spikes=False, sparks=False, light=None):
    art = Art()
    art.stamp(KNUCKLES, 0, 0, {**rings, **grip, **({'Y': light} if light else {})})
    if spikes:
        for x, y in SPIKES:
            art.set(x, y, SPIKE['s'])
            art.set(x, y + 1, SPIKE['S'])
    if sparks:
        for x, y, key in SPARKS:
            art.set(x, y, SPARK[key])
    # The plate's middle rests on the anchor; the glint sits on the first ring's light.
    return art, (10, 5), (1, 0)


# ---------------------------------------------------------------------------------------------
# Staffs lie along world x: a 2 px thick 2:1 line rising to the screen right (light top row, shaded
# bottom row). `segment(t)` returns (top, bottom, bulge) colours for column t from the butt; a bulge is
# one more pixel above the top row, for wraps and rings. `head` adds (dx, row, colour) pixels: dx counts
# from the tip column, rows count from the tip's top row (row 0).
STAFF_LENGTH = 28


def staff(segment, head=None, shift=0):
    art, rise = Art(), (STAFF_LENGTH - 1) // 2
    for t in range(STAFF_LENGTH):
        y = rise - t // 2
        top, bottom, bulge = segment(t)
        art.set(t, y, top)
        art.set(t, y + 1, bottom)
        if bulge:
            art.set(t, y - 1, bulge)
    if head:
        for dx, dy, color in head:
            art.set(STAFF_LENGTH - 1 + dx, dy, color)
    # The shaft's middle (between columns 13 and 14, between its two rows) rests on the anchor. A heavy
    # head moves that point `shift` steps of (2, -1) towards the tip, so the frame keeps a margin.
    return art, (STAFF_LENGTH // 2 + 2 * shift, rise - STAFF_LENGTH // 4 + 1 - shift)


def wood(light, mid, dark, every):
    return lambda t: (light if t % every == every // 2 else mid, dark, None)


def novice_staff(t):
    if t < 2:
        return '#8a8094', '#44394f', None                       # iron butt cap
    if t in (8, 9, 10, 18, 19, 20):                              # cloth wraps
        return '#efe4cf', '#a89a86', '#d8cbb2' if t in (9, 19) else None
    return wood('#f0cf92', '#d6a666', '#97653f', 7)(t)


def ash_staff(t):
    if t < 3 or t >= STAFF_LENGTH - 3:                           # iron ferrules
        return '#e4e2ec', '#77728a', '#a9a4b8' if t in (2, STAFF_LENGTH - 3) else None
    return wood('#fff6dc', '#ecd6a6', '#b8956a', 6)(t)


def pilgrim_staff(t):
    if t < 2:
        return '#f2cf8a', '#8f734f', None                       # amber butt
    if t in (16, 17):                                            # amber band
        return '#f6d593', '#8f734f', '#e5b66e'
    return wood('#a37a5a', '#7d5640', '#4b3024', 5)(t)


# A ring lying flat over the tip, with a coral ribbon knotted under it and two tails on the ground.
PILGRIM_HEAD = [
    (0, -2, '#e5b66e'), (1, -3, '#f6d593'), (2, -3, '#f6d593'), (3, -3, '#e5b66e'), (4, -2, '#e5b66e'),
    (4, -1, '#b28a55'), (3, 0, '#8f734f'), (2, 0, '#8f734f'), (1, -1, '#b28a55'),
    (-1, 2, '#ef8e83'), (0, 2, '#9d4e5c'), (-2, 3, '#f8c4ab'), (-3, 3, '#ef8e83'), (-4, 4, '#ef8e83'),
    (-5, 4, '#9d4e5c'), (0, 3, '#ef8e83'), (1, 4, '#ef8e83'), (1, 5, '#9d4e5c'),
]


def crane_staff(t):
    if t < 2:
        return '#eee0ce', '#8f734f', None                       # ivory butt
    if t in (12, 13):                                            # ivory feather band
        return '#fff7e4', '#b4aaba', '#eee0ce'
    return wood('#f6d593', '#d9a35c', '#8f5f3e', 6)(t)


# The crane's neck curls back from the tip: ivory neck, coral crown, amber beak, dark eye.
CRANE_HEAD = [
    (1, -1, '#eee0ce'), (2, -2, '#eee0ce'), (2, -3, '#fff7e4'), (3, -4, '#fff7e4'), (4, -4, '#eee0ce'),
    (5, -3, '#eee0ce'), (5, -2, '#b4aaba'), (4, -5, '#ef8e83'), (5, -5, '#ef8e83'), (6, -4, '#fff7e4'),
    (7, -4, '#e5b66e'), (8, -3, '#e5b66e'), (6, -3, '#211a28'), (1, 0, '#b4aaba'),
]


# ---------------------------------------------------------------------------------------------
class Art:
    """Sparse pixel art: (x, y) -> '#rrggbb' or ('#rrggbb', alpha); negative coordinates allowed."""

    def __init__(self):
        self.px = {}

    def set(self, x, y, color):
        self.px[(x, y)] = color

    def stamp(self, rows, ox, oy, palette):
        for y, row in enumerate(rows):
            for x, key in enumerate(row):
                if key != '.':
                    self.set(ox + x, oy + y, palette[key])


def outlined(art):
    """Paint INK on every empty pixel that touches a coloured pixel by its side."""
    out = Art()
    out.px = dict(art.px)
    for (x, y) in art.px:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if (x + dx, y + dy) not in art.px:
                out.px[(x + dx, y + dy)] = INK
    return out


def place(art, center, size=(CELL, CELL), anchor=ANCHOR):
    """Render art into a frame so that its ground centre lands on the frame anchor."""
    img = Image.new('RGBA', size, (0, 0, 0, 0))
    ox, oy = anchor[0] - center[0], anchor[1] - center[1]
    for (x, y), color in art.px.items():
        fx, fy = x + ox, y + oy
        assert 0 <= fx < size[0] and 0 <= fy < size[1], f'pixel {x},{y} leaves the frame'
        img.putpixel((fx, fy), rgba(*color) if isinstance(color, tuple) else rgba(color))
    return img, (ox, oy)


def contact_shadow(item):
    """The item silhouette grown by one pixel and pushed one pixel down-right (light from upper left)."""
    alpha = item.getchannel('A')
    img = Image.new('RGBA', item.size, (0, 0, 0, 0))
    w, h = item.size
    for y in range(h):
        for x in range(w):
            near = [(x - 1 + dx, y - 1 + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if abs(dx) + abs(dy) < 2]
            if any(0 <= nx < w and 0 <= ny < h and alpha.getpixel((nx, ny)) for nx, ny in near):
                img.putpixel((x, y), rgba(SHADOW))
    return img


# ---------------------------------------------------------------------------------------------
# Glow. The rings lie on the ground around the anchor (an iso circle: half-height = half-width / 2).
# Shapes differ by rarity, so rarity reads without colour: common has four short arcs, rare a dashed
# ring, relic a full ring, an inner ring and corner sparks. Alpha comes in a few flat steps.
def ellipse(cx, cy, a, b):
    """A one-pixel ellipse around the pixel corner (cx, cy), as pixel -> angle. Each column and each row
    of a quadrant takes the pixel nearest the curve, so steep sides and flat tops both stay connected."""
    quadrant = set()
    for i in range(math.ceil(a)):
        x = i + .5
        if x <= a:
            quadrant.add((i, round(b * math.sqrt(1 - (x / a) ** 2) - .5)))
    for j in range(math.ceil(b)):
        y = j + .5
        if y <= b:
            quadrant.add((round(a * math.sqrt(1 - (y / b) ** 2) - .5), j))
    # Drop the inner pixel of each doubled corner so the line stays one pixel thick.
    for i, j in sorted(quadrant):
        if (i + 1, j) in quadrant and (i, j + 1) in quadrant:
            quadrant.discard((i, j))
    pts = {}
    for i, j in quadrant:
        for sx, sy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
            px = cx + i if sx > 0 else cx - 1 - i
            py = cy + j if sy > 0 else cy - 1 - j
            pts[(px, py)] = math.atan2((py + .5 - cy) / b, (px + .5 - cx) / a) % (2 * math.pi)
    return pts


def filled_ellipse(cx, cy, a, b):
    return {(x, y) for y in range(math.floor(cy - b), math.ceil(cy + b))
            for x in range(math.floor(cx - a), math.ceil(cx + a))
            if ((x + .5 - cx) / a) ** 2 + ((y + .5 - cy) / b) ** 2 <= 1}


def ring(rarity, frame):
    light, mid, dark = RARITY[rarity]['ramp']
    lines, pool, (cx, cy) = {}, set(), ANCHOR
    if rarity == 'common':
        for p, t in ellipse(cx, cy, 14 + frame, (14 + frame) / 2).items():
            # Four short arcs on the ring's shoulders, clear of the beam above and of a crosshair look.
            near = min(abs((t - (k + .5) * math.pi / 2 + math.pi) % (2 * math.pi) - math.pi) for k in range(4))
            if near < .3:
                lines[p] = (light if frame == 0 else mid, 220 if frame == 0 else 150)
    else:
        a = 15 + frame if rarity == 'rare' else 16 + frame
        # A faint pool inside the ring: the token colour brightens dark grass and tints pale earth.
        pool = filled_ellipse(cx, cy, a - 2, (a - 2) / 2)
        for p, t in ellipse(cx, cy, a, a / 2).items():
            if rarity == 'relic' or int((t / (2 * math.pi)) * 24 + frame * .5) % 2 == 0:
                lines[p] = (mid, 240 if frame == 0 else 170)
    if rarity == 'relic':
        for p, t in ellipse(cx, cy, a - 4, (a - 4) / 2).items():
            if int((t / (2 * math.pi)) * 16 + frame * .5) % 2 == 0:
                lines[p] = (light, 180 if frame == 0 else 120)
        # Four sparks on the diamond corners, two pixels outside the ring.
        for sx, sy in ((cx - a - 2, cy), (cx + a + 1, cy), (cx, cy - a // 2 - 2), (cx, cy + a // 2 + 1)):
            sx, sy = math.floor(sx), math.floor(sy)
            lines[(sx, sy)] = (light, 255)
            if frame == 0:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    lines[(sx + dx, sy + dy)] = (mid, 180)
    art = Art()
    for p in pool:
        art.set(*p, (mid, 24 if frame == 0 else 44))
    # An ink edge under every lit pixel keeps the glow readable on pale earth and flagstone.
    for x, y in lines:
        if (x, y + 1) not in lines:
            art.set(x, y + 1, (INK, 96))
    for p, color in lines.items():
        art.set(*p, color)
    return art


# Beam: a 2 px column rising from the anchor, drawn behind the item (§5.4). Heights also differ by
# rarity: 14, 24 and 28 px. The left column is lit, the right one carries the token colour (common: its
# shade, so the pale column still reads on earth); frame 1 is the pulse, a brighter band half way up.
BEAM_HEIGHT = {'common': 14, 'rare': 24, 'relic': 28}
BEAM_ALPHA = {'common': 168, 'rare': 224, 'relic': 248}


def beam(rarity, frame):
    light, mid, dark = RARITY[rarity]['ramp']
    art, (cx, cy), height = Art(), ANCHOR, BEAM_HEIGHT[rarity]
    for i in range(height):
        y = cy - 1 - i
        fade = 1 - i / height
        core = max(56, round(BEAM_ALPHA[rarity] * (.35 + .65 * fade) / 8) * 8)
        pulse = frame == 1 and height * .45 <= i < height * .45 + 4
        alpha = 255 if pulse else core
        art.set(cx - 1, y, (light if pulse or rarity != 'common' else mid, alpha))
        art.set(cx, y, (light if pulse or i >= height - 2 else dark if rarity == 'common' else mid, alpha))
        if rarity != 'common' and i < height - 3:
            halo = (dark if rarity == 'rare' else mid, 88 if frame == 0 else 56)
            art.set(cx - 2, y, halo)
            art.set(cx + 1, y, halo)
    top = cy - height - 1
    if rarity == 'relic':
        art.set(cx - 1, top, (light, 255))
        art.set(cx, top, (light, 255))
        arm = 3 if frame == 0 else 2
        for k in range(1, arm + 1):
            alpha = 255 if k == 1 else 150
            for dx, dy in ((-1 - k, 0), (k, 0), (-1, -k), (0, -k)):
                art.set(cx + dx, top + dy, (light, alpha))
    return art


def glint(frame):
    """A white four-point star around pixel (24, 34); items give the point it goes to."""
    art, (cx, cy) = Art(), ANCHOR
    art.set(cx, cy, ('#ffffff', 255))
    arm = 2 if frame == 0 else 3
    for k in range(1, arm + 1):
        color = ('#fff7e4', 255) if k < arm else ('#fff7e4', 140)
        for dx, dy in ((k, 0), (-k, 0), (0, k), (0, -k)):
            art.set(cx + dx, cy + dy, color)
    if frame == 1:
        for dx, dy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
            art.set(cx + dx, cy + dy, ('#fff7e4', 140))
    return art


# ---------------------------------------------------------------------------------------------
# Camp supplies: a woven cloth (1.44 × 1.36 u) with both starter weapons.
CLOTH = {'hx': .72, 'hy': .68, 'border': .08}
CLOTH_INK = {'field': '#6e3438', 'weave': '#5a2a31', 'light': '#86453f', 'border': '#c58f4e',
             'border_dark': '#8f5f3e', 'edge': '#3a1e26', 'fringe': '#d8bf8f'}


def screen_to_world(du, dv):
    s = PPU * math.sqrt(2)
    return (2 * dv - du) / s, (2 * dv + du) / s


def cloth():
    art, hx, hy, border = Art(), CLOTH['hx'], CLOTH['hy'], CLOTH['border']
    w, h = SUPPLY_SIZE
    for y in range(h):
        for x in range(w):
            wx, wy = screen_to_world(x + .5 - SUPPLY_ANCHOR[0], y + .5 - SUPPLY_ANCHOR[1])
            if abs(wx) > hx or abs(wy) > hy:
                continue
            edge = min(hx - abs(wx), hy - abs(wy))
            if edge < border:
                color = CLOTH_INK['border'] if edge > border * .45 else CLOTH_INK['border_dark']
            elif (math.floor(wx * 10) + math.floor(wy * 10)) % 2 == 0:
                color = CLOTH_INK['weave']
            elif abs(wx) < .12:
                color = CLOTH_INK['light']
            else:
                color = CLOTH_INK['field']
            art.set(x, y, color)
    # Front edges (+x and +y faces towards the camera) show the cloth's thickness.
    for (x, y) in list(art.px):
        if (x, y + 1) not in art.px:
            art.set(x, y + 1, CLOTH_INK['edge'])
    # Fringe on both short ends (world ±x), every other step along the edge.
    for sign in (-1, 1):
        for k in range(-4, 5):
            wy = k * hy / 4.5
            wx = sign * (hx + .06)
            du, dv = (wy - wx) / math.sqrt(2) * PPU, (wy + wx) / math.sqrt(2) * PPU / 2
            if k % 2 == 0:
                art.set(math.floor(SUPPLY_ANCHOR[0] + du), math.floor(SUPPLY_ANCHOR[1] + dv), CLOTH_INK['fringe'])
    return art


def supplies(with_weapons):
    base = cloth()
    img = Image.new('RGBA', SUPPLY_SIZE, (0, 0, 0, 0))
    for (x, y), color in outlined(base).px.items():
        if 0 <= x < SUPPLY_SIZE[0] and 0 <= y < SUPPLY_SIZE[1]:
            img.putpixel((x, y), rgba(color))
    if not with_weapons:
        return img
    # The staff lies along world x on the back half (0.32 u towards -y), the knuckles on the front half
    # (0.1 u towards +x, 0.3 u towards +y); both cast a shadow on the cloth.
    for key, offset in (('novice-staff', (-7, -4)), ('novice-knuckles', (5, 4))):
        art, center, _ = ITEMS[key]
        anchor = (SUPPLY_ANCHOR[0] + offset[0], SUPPLY_ANCHOR[1] + offset[1])
        sprite, _ = place(outlined(art), center, SUPPLY_SIZE, anchor)
        shade = contact_shadow(sprite)
        for y in range(SUPPLY_SIZE[1]):
            for x in range(SUPPLY_SIZE[0]):
                if shade.getpixel((x, y))[3] and img.getpixel((x, y))[3]:
                    r, g, b, _ = img.getpixel((x, y))
                    img.putpixel((x, y), (r * 3 // 5, g * 3 // 5, b * 3 // 5, 255))
        img.alpha_composite(sprite)
    return img


# ---------------------------------------------------------------------------------------------
def build_items():
    """name -> (art, ground centre, glint pixel in art coordinates)."""
    items = {}
    for key, rings, grip, extra in (
            ('novice-knuckles', IRON, WOOD_GRIP, {}),
            ('bronze-knuckles', BRONZE, BRONZE_GRIP, {}),
            ('pilgrim-knuckles', DARK_IRON, CORAL_GRIP, {'spikes': True}),
            ('quiet-thunder', BRONZE, CORAL_GRIP, {'sparks': True, 'light': SPARK['z']})):
        items[key] = knuckles(rings, grip, **extra)
    for key, segment, head, glint_at in (
            ('novice-staff', novice_staff, None, (STAFF_LENGTH - 2, 0)),
            ('ash-staff', ash_staff, None, (STAFF_LENGTH - 2, 0)),
            ('pilgrim-staff', pilgrim_staff, PILGRIM_HEAD, (STAFF_LENGTH + 1, -3)),
            ('crane-neck', crane_staff, CRANE_HEAD, (STAFF_LENGTH + 2, -4))):
        art, center = staff(segment, head, {'pilgrim-staff': 1, 'crane-neck': 2}.get(key, 0))
        items[key] = (art, center, glint_at)
    return items


ITEMS = build_items()
WEAPONS = ['novice-knuckles', 'bronze-knuckles', 'pilgrim-knuckles', 'novice-staff', 'ash-staff', 'pilgrim-staff']
FAMILY = {'novice-knuckles': 'knuckles', 'bronze-knuckles': 'knuckles', 'pilgrim-knuckles': 'knuckles',
          'novice-staff': 'staff', 'ash-staff': 'staff', 'pilgrim-staff': 'staff',
          'quiet-thunder': 'knuckles', 'crane-neck': 'staff'}
RELICS = ['quiet-thunder', 'crane-neck']


def opaque_bounds(img):
    box = img.getchannel('A').getbbox()
    return list(box) if box else [0, 0, 0, 0]


def frames():
    """Ordered (name, image, meta) for the loot atlas."""
    out = []
    for key in WEAPONS + RELICS:
        art, center, glint_at = ITEMS[key]
        img, (ox, oy) = place(outlined(art), center)
        meta = {'kind': 'item', 'family': FAMILY[key], 'alpha': 'binary', 'layer': 'item',
                'shadow': f'shadow-{key}', 'glint': [glint_at[0] + ox, glint_at[1] + oy]}
        meta['weapon' if key in WEAPONS else 'relic'] = key
        out.append((f'item-{key}', img, meta))
    for key in WEAPONS + RELICS:
        item = next(img for name, img, _ in out if name == f'item-{key}')
        out.append((f'shadow-{key}', contact_shadow(item),
                    {'kind': 'shadow', 'item': f'item-{key}', 'alpha': 'binary', 'layer': 'shadow',
                     'color': SHADOW, 'drawAlpha': SHADOW_ALPHA}))
    for rarity in RARITY:
        for frame in (0, 1):
            img, _ = place(ring(rarity, frame), ANCHOR)
            out.append((f'ring-{rarity}-{frame}', img,
                        {'kind': 'ring', 'rarity': rarity, 'frame': frame, 'alpha': 'stepped', 'layer': 'ring'}))
    for frame in (0, 1):
        img, _ = place(glint(frame), ANCHOR)
        out.append((f'glint-{frame}', img, {'kind': 'glint', 'frame': frame, 'alpha': 'stepped', 'layer': 'glint'}))
    for rarity in RARITY:
        for frame in (0, 1):
            img, _ = place(beam(rarity, frame), ANCHOR)
            out.append((f'beam-{rarity}-{frame}', img,
                        {'kind': 'beam', 'rarity': rarity, 'frame': frame, 'alpha': 'stepped', 'layer': 'beam',
                         'height': BEAM_HEIGHT[rarity]}))
    return out


def atlas(entries, size, columns):
    rows = math.ceil(len(entries) / columns)
    sheet = Image.new('RGBA', (size[0] * columns, size[1] * rows), (0, 0, 0, 0))
    for i, (_, img, _) in enumerate(entries):
        sheet.paste(img, ((i % columns) * size[0], (i // columns) * size[1]))
    return sheet, rows


# ---------------------------------------------------------------------------------------------
# Contact sheet. Grounds are the real surfaces projected to the screen like the renderer does:
# pixel offset (du, dv) -> world x = (2dv - du) / (32√2), y = (2dv + du) / (32√2); texture column
# = 32x, row = -32y, repeating every 4 u (pixel-v9 surface contract).
def ground(name, w, h, phase=(0, 0)):
    tex = Image.open(ROOT / INPUTS[name]).convert('RGB')
    img = Image.new('RGBA', (w, h))
    for y in range(h):
        for x in range(w):
            wx, wy = screen_to_world(x + phase[0], y + phase[1])
            img.putpixel((x, y), tex.getpixel((math.floor(wx * PPU) % 128, math.floor(-wy * PPU) % 128)) + (255,))
    return img


def with_alpha(img, alpha):
    out = img.copy()
    out.putalpha(img.getchannel('A').point(lambda a: round(a * alpha)))
    return out


def stack(by_name, key, rarity, frame=0, glow=True):
    """Ring, shadow at 40%, beam, item, in the documented draw order."""
    img = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    if glow:
        img.alpha_composite(by_name[f'ring-{rarity}-{frame}'])
    img.alpha_composite(with_alpha(by_name[f'shadow-{key}'], SHADOW_ALPHA))
    if glow:
        img.alpha_composite(by_name[f'beam-{rarity}-{frame}'])
    img.alpha_composite(by_name[f'item-{key}'])
    return img


def game_scale(img):
    """What the game shows at 1174×813: art at 5:6 per framebuffer pixel, framebuffer ×2."""
    w, h = img.size
    return img.resize((w * 5 // 6, h * 5 // 6), Image.NEAREST).resize((w * 5 // 6 * 2, h * 5 // 6 * 2), Image.NEAREST)


def contact_sheet(entries, supply_frames):
    by_name = {name: img for name, img, _ in entries}
    keys = WEAPONS + RELICS
    natural = {key: 'relic' if key in RELICS else 'common' for key in keys}
    natural['ash-staff'] = natural['bronze-knuckles'] = 'rare'
    grounds = ['grass', 'earth', 'flagstone']
    zoom, pad, bg = 3, 8, (23, 19, 33, 255)
    tile = CELL * zoom
    width = pad + len(keys) * (tile + pad)
    sections = []

    # 1. Each item with its shadow on the three grounds, 3×.
    rows = []
    for g in grounds:
        row = Image.new('RGBA', (width, tile + pad), bg)
        patch = ground(g, CELL * len(keys), CELL)
        for i, key in enumerate(keys):
            cell = patch.crop((i * CELL, 0, (i + 1) * CELL, CELL))
            cell.alpha_composite(stack(by_name, key, None, glow=False))
            row.paste(cell.resize((tile, tile), Image.NEAREST), (pad + i * (tile + pad), 0))
        rows.append(row)
    sections += rows

    # 2. Full stacks (ring, shadow, beam, item) in each item's usual rarity, frames 0 and 1, 3×.
    for g, frame in (('grass', 0), ('earth', 1), ('flagstone', 0)):
        row = Image.new('RGBA', (width, tile + pad), bg)
        patch = ground(g, CELL * len(keys), CELL, (17, 5))
        for i, key in enumerate(keys):
            cell = patch.crop((i * CELL, 0, (i + 1) * CELL, CELL))
            cell.alpha_composite(stack(by_name, key, natural[key], frame))
            row.paste(cell.resize((tile, tile), Image.NEAREST), (pad + i * (tile + pad), 0))
        sections.append(row)

    # 3. One staff and one knuckle in all three rarities, both pulse frames, and the glint, 3×.
    row = Image.new('RGBA', (width, tile + pad), bg)
    patch = ground('grass', CELL * 8, CELL, (40, 11))
    cells = [('novice-staff', r, f) for r in RARITY for f in (0, 1)] + [('bronze-knuckles', 'relic', 0)]
    for i, (key, rarity, frame) in enumerate(cells):
        cell = patch.crop((i * CELL, 0, (i + 1) * CELL, CELL))
        cell.alpha_composite(stack(by_name, key, rarity, frame))
        row.paste(cell.resize((tile, tile), Image.NEAREST), (pad + i * (tile + pad), 0))
    glint_cell = patch.crop((7 * CELL, 0, 8 * CELL, CELL))
    glint_cell.alpha_composite(stack(by_name, 'pilgrim-staff', None, glow=False))
    gx, gy = next(meta['glint'] for name, _, meta in entries if name == 'item-pilgrim-staff')
    glint_cell.alpha_composite(by_name['glint-1'], (gx - ANCHOR[0], gy - ANCHOR[1]))
    row.paste(glint_cell.resize((tile, tile), Image.NEAREST), (pad + 7 * (tile + pad), 0))
    sections.append(row)

    # 4. Game scale: all items with glow around the monk on each ground, then camp supplies 3×.
    monk_atlas = Image.open(ROOT / INPUTS['monk']).convert('RGBA')
    monk = monk_atlas.crop((0, 0, MONK_CELL, MONK_CELL))
    scene_w, scene_h = 232, 88
    row = Image.new('RGBA', (width, scene_h * 5 // 6 * 2 + pad), bg)
    for gi, g in enumerate(grounds):
        scene = ground(g, scene_w, scene_h, (gi * 31, gi * 13))
        spots = [(22, 30), (52, 62), (82, 26), (112, 60), (150, 28), (178, 62), (206, 30), (200, 72)]
        for (x, y), key in zip(spots, keys):
            scene.alpha_composite(stack(by_name, key, natural[key], gi % 2), (x - ANCHOR[0], y - ANCHOR[1]))
        scene.alpha_composite(monk, (128 - MONK_ANCHOR[0], 74 - MONK_ANCHOR[1]))
        shown = game_scale(scene)
        row.paste(shown, (pad + gi * (shown.width + pad), 0))
    sections.append(row)

    supply_row = Image.new('RGBA', (width, SUPPLY_SIZE[1] * zoom + pad), bg)
    for i, img in enumerate(supply_frames):
        patch = ground('grass', *SUPPLY_SIZE, (i * 23, 9))
        patch.alpha_composite(img)
        supply_row.paste(patch.resize((SUPPLY_SIZE[0] * zoom, SUPPLY_SIZE[1] * zoom), Image.NEAREST),
                         (pad + i * (SUPPLY_SIZE[0] * zoom + pad), 0))
    patch = ground('grass', SUPPLY_SIZE[0] * 2, SUPPLY_SIZE[1] * 2, (5, 3))
    patch.alpha_composite(supply_frames[0], (SUPPLY_SIZE[0] // 2, SUPPLY_SIZE[1] // 2 - 8))
    patch.alpha_composite(monk, (SUPPLY_SIZE[0] + 30 - MONK_ANCHOR[0], SUPPLY_SIZE[1] + 30 - MONK_ANCHOR[1]))
    shown = game_scale(patch)
    supply_row.paste(shown, (pad + 2 * (SUPPLY_SIZE[0] * zoom + pad), 0))
    sections.append(supply_row)

    # 5. The raw atlas at 2× on the sheet colour, to see alpha steps.
    raw, _ = atlas(entries, (CELL, CELL), COLUMNS)
    raw_bg = Image.new('RGBA', raw.size, (52, 46, 62, 255))
    raw_bg.alpha_composite(raw)
    raw_row = Image.new('RGBA', (width, raw.height * 2 + pad), bg)
    raw_row.paste(raw_bg.resize((raw.width * 2, raw.height * 2), Image.NEAREST), (pad, 0))
    sections.append(raw_row)

    sheet = Image.new('RGBA', (width, pad + sum(s.height for s in sections)), bg)
    top = pad
    for section in sections:
        sheet.paste(section, (0, top))
        top += section.height
    return sheet


# ---------------------------------------------------------------------------------------------
def png(img):
    buffer = io.BytesIO()
    img.save(buffer, format='PNG', optimize=False)
    return buffer.getvalue()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def build():
    entries = frames()
    supply_frames = [supplies(True), supplies(False)]
    supply_names = ['camp-supplies', 'camp-supplies-empty']

    files = {}
    sheet, rows = atlas(entries, (CELL, CELL), COLUMNS)
    files['loot-ground.png'] = png(sheet)
    supply_sheet, _ = atlas([(n, img, {}) for n, img in zip(supply_names, supply_frames)], SUPPLY_SIZE, 2)
    files['camp-supplies.png'] = png(supply_sheet)
    frame_meta = {}
    for i, (name, img, meta) in enumerate(entries):
        files[f'frames/{name}.png'] = png(img)
        frame_meta[name] = {'atlas': 'lootGround', 'index': i, 'file': f'frames/{name}.png',
                            'size': [CELL, CELL], 'anchor': list(ANCHOR), 'opaqueBounds': opaque_bounds(img), **meta}
    for i, (name, img) in enumerate(zip(supply_names, supply_frames)):
        files[f'frames/{name}.png'] = png(img)
        frame_meta[name] = {'atlas': 'campSupplies', 'index': i, 'file': f'frames/{name}.png',
                            'size': list(SUPPLY_SIZE), 'anchor': list(SUPPLY_ANCHOR), 'opaqueBounds': opaque_bounds(img),
                            'kind': 'supplies', 'alpha': 'binary', 'layer': 'flat',
                            'weapons': ['novice-knuckles', 'novice-staff'] if i == 0 else [],
                            'cloth': {'halfX': CLOTH['hx'], 'halfY': CLOTH['hy']}}
    files['contact-sheet.png'] = png(contact_sheet(entries, supply_frames))

    rarity = {}
    for key, value in RARITY.items():
        rarity[key] = {'token': value['token'], 'color': value['ramp'][1], 'ramp': value['ramp'],
                       'ring': [f'ring-{key}-0', f'ring-{key}-1'], 'beam': [f'beam-{key}-0', f'beam-{key}-1'],
                       'beamHeight': BEAM_HEIGHT[key]}
    manifest = {
        'schemaVersion': 1,
        'status': 'ready',
        'nativePixelsPerUnit': PPU,
        'lootGround': {'path': 'loot-ground.png', 'frameSize': [CELL, CELL], 'columns': COLUMNS, 'rows': rows,
                       'anchor': list(ANCHOR), 'filter': 'nearest', 'mipmaps': False,
                       'frames': [name for name, _, _ in entries]},
        'campSupplies': {'path': 'camp-supplies.png', 'frameSize': list(SUPPLY_SIZE), 'columns': 2, 'rows': 1,
                         'anchor': list(SUPPLY_ANCHOR), 'filter': 'nearest', 'mipmaps': False,
                         'frames': supply_names, 'full': 'camp-supplies', 'empty': 'camp-supplies-empty'},
        'weapons': {key: f'item-{key}' for key in WEAPONS},
        'relics': {key: f'item-{key}' for key in RELICS},
        'rarity': rarity,
        'glint': ['glint-0', 'glint-1'],
        # Draw order at one anchor, back to front. Beam stays behind the item so the item reads.
        'stack': ['ring', 'shadow', 'beam', 'item', 'glint'],
        'shadow': {'color': SHADOW, 'drawAlpha': SHADOW_ALPHA},
        'timing': {'ringStepSeconds': .5, 'beamStepSeconds': .3, 'glintEverySeconds': 2, 'glintSeconds': .16},
        'frames': frame_meta,
        'provenance': {'script': 'scripts/build-loot-ground.py', 'pillow': PILLOW_VERSION,
                       'inputs': {path: digest((ROOT / path).read_bytes()) for path in INPUTS.values()}},
        'contactSheet': 'contact-sheet.png',
        'files': {name: digest(data) for name, data in sorted(files.items())},
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
        known = set(files) | {'README.md'}
        extra = sorted(str(p.relative_to(OUT)) for p in OUT.rglob('*') if p.is_file() and str(p.relative_to(OUT)) not in known)
        if stale or extra:
            print('stale:', ', '.join(stale) or '-', '| extra:', ', '.join(extra) or '-')
            sys.exit(1)
        print(f'ok: {len(files)} files match')
        return
    (OUT / 'frames').mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (OUT / name).write_bytes(data)
    print(f'wrote {len(files)} files to {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
