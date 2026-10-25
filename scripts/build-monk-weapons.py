#!/usr/bin/env python3
"""Build/verify the monk's weapon layers: knuckles and staff. Python 3.10+, Pillow >=10,<13.

    python3 scripts/build-monk-weapons.py                # write the package
    python3 scripts/build-monk-weapons.py --verify-only  # rebuild in memory and compare; no writes

No generation, network, numpy, browser or runtime modification occurs here. Run from any
working directory. The weapon layers sit over the shipped 110-key monk atlas
(assets/game/pixel-v10/monk-side). They contain no skin, sash or hair pixels, so one layer
serves all 18 appearances (spec 3.8):

  * hands: a rough centre per visible hand of keys 0-99 was authored from 4x/10x review
    sheets; the builder snaps it to the hand pixels (skin plus its bronze/beads shading,
    inside ink) and reads the forearm direction from the nearest wrap. The ten side keys
    reuse v2 upper bodies (pixel-v10 rig.json), so their hands are the source hands moved
    by the rig's upperOffset;
  * knuckles.png: a 2-row band across each fist (light rings over dark bronze), painted
    only on skin pixels, so the monk silhouette and hit mask do not change. Four knuckle
    strikes (front/back) bake the band plus hit accents into their own cells;
  * staff.png: a 3 px shaft with bronze caps and an ink rim for every monk key. Gripping
    hands are cut out of the layer so the monk's own fists show over the shaft; a shaft
    behind the body is cut out of the body silhouette;
  * staff-attacks.png: three swings (front/back/side, six keys each) in larger cells. Each
    key reuses a monk body drawing (optionally mirrored) under a new staff drawing and a
    swing smear; the 3rd swing turns the body through four facings (360 degrees).
"""

from __future__ import annotations

import argparse
import hashlib
from io import BytesIO
import json
import math
from pathlib import Path
import platform

from PIL import Image, ImageDraw, __version__ as PILLOW_VERSION

ROOT = Path(__file__).resolve().parents[1]
PKG = Path("assets/game/pixel-v12/monk-weapons")
MONK = Path("assets/game/pixel-v10/monk-side")
V2_PALETTE = Path("assets/game/pixel-v2/monk/palette.json")
NEAREST = Image.Resampling.NEAREST
CELL, ANCHOR, COLUMNS, KEYS = 96, (48, 84), 10, 110
ROWS = 11
# Swing cells: a 2u staff reaches ~75 px from the hips and rises ~100 px over the ground.
SWING_CELL, SWING_ANCHOR = (160, 144), (80, 104)
SWING_OFFSET = (SWING_ANCHOR[0] - ANCHOR[0], SWING_ANCHOR[1] - ANCHOR[1])   # monk cell inside a swing cell
PX = 32                               # native pixels per world unit (ground x and height); ground depth is PX / 2
STAFF_UNITS = 2.0                     # shaft length (gear board 4: "древко 2 ед.")

# ---------------------------------------------------------------------------
# Palette (gear board 4 mock: assets/concepts/systems-01/gear/source)
# ---------------------------------------------------------------------------
PALETTE = {
    "ink": ["15121f", "0d0a14"],
    "wood": ["c79a66", "8a5d3b", "553829"],            # light (upper-left), mid, dark
    "metal": ["fff2d6", "e5b66e", "b07a36", "4a3024"],  # stud/glint, bright bronze, bronze, dark strap
    "flare": ["ffffff"],
    "smear": ["f2e4c6", "c7b99e"],
}
COLOR = {m: [tuple(bytes.fromhex(c)) for c in ramp] for m, ramp in PALETTE.items()}

# ---------------------------------------------------------------------------
# Hands of keys 0-99: rough centres in cell pixels, authored from review sheets.
# Only drawn (at least partly visible) hands are listed; a hand hidden by the body is
# omitted. The builder snaps each point to its hand pixels.
# ---------------------------------------------------------------------------
HANDS = {
    # front (SE): idle, run
    0: [(42, 49), (72, 38)], 1: [(40, 49), (75, 37)], 2: [(38, 52), (72, 42)], 3: [(47, 50), (78, 42)],
    4: [(29, 47), (73, 42)], 5: [(42, 55), (73, 52)], 6: [(28, 41), (71, 39)], 7: [(40, 43), (66, 42)],
    8: [(40, 44), (71, 42)], 9: [(43, 40), (67, 39)],
    # attack1, attack2, attack3
    10: [(42, 49), (74, 40)], 11: [(36, 42), (75, 42)], 12: [(39, 52), (78, 35)], 13: [(40, 50), (79, 35)],
    14: [(38, 48), (69, 38)], 15: [(42, 49), (74, 40)],
    16: [(43, 45), (68, 39)], 17: [(34, 27), (48, 58)], 18: [(75, 35)], 19: [(77, 37)],
    20: [(45, 47), (70, 44)], 21: [(42, 48), (74, 39)],
    22: [(34, 54), (66, 50)], 23: [(49, 50), (55, 50)], 24: [(73, 45), (78, 40)], 25: [(72, 42), (79, 40)],
    26: [(45, 48), (64, 48)], 27: [(40, 49), (71, 40)],
    # dash, wave, hurt, death
    28: [(57, 80), (81, 61)], 29: [(30, 37)], 30: [(38, 39), (86, 31)], 31: [(47, 37), (72, 33)],
    32: [(31, 38), (83, 73)], 33: [(43, 47), (75, 39)],
    34: [(41, 45), (65, 43)], 35: [(24, 44), (75, 44)], 36: [(17, 40), (79, 40)], 37: [(22, 51), (73, 47)],
    38: [(37, 49), (69, 50)], 39: [(44, 46), (70, 39)],
    40: [(32, 54), (71, 32)], 41: [(20, 44), (62, 26)], 42: [(41, 51), (64, 46)], 43: [(42, 46), (71, 37)],
    44: [(41, 56), (75, 51)], 45: [(47, 66), (75, 62)], 46: [(46, 78), (68, 80)], 47: [(44, 73), (67, 79)],
    48: [(62, 80)], 49: [(76, 77)],
    # back (NE): idle, run
    50: [(38, 48), (73, 39)], 51: [(38, 48), (73, 38)], 52: [(38, 51), (74, 42)], 53: [(38, 48), (73, 39)],
    54: [(38, 49), (75, 38)], 55: [(40, 48), (74, 45)], 56: [(32, 39), (71, 35)], 57: [(31, 52), (71, 37)],
    58: [(33, 55), (70, 40)], 59: [(28, 50), (69, 32)],
    # attack1, attack2, attack3
    60: [(36, 49), (72, 39)], 61: [(71, 39)], 62: [(30, 52), (78, 34)], 63: [(34, 50), (77, 39)],
    64: [(35, 40), (69, 39)], 65: [(38, 49), (71, 39)],
    66: [(38, 47), (74, 39)], 67: [(35, 31), (65, 50)], 68: [(78, 30)], 69: [(36, 49), (77, 37)],
    70: [(40, 48), (72, 41)], 71: [(37, 49), (72, 39)],
    72: [(35, 51), (63, 48)], 73: [], 74: [(70, 33), (77, 35)], 75: [(68, 34), (77, 35)],
    76: [(34, 44), (65, 47)], 77: [(35, 49), (71, 36)],
    # dash, wave, hurt, death
    78: [(74, 79)], 79: [(27, 39), (78, 45)], 80: [(84, 32)], 81: [(71, 35)], 82: [(28, 42), (79, 74)],
    83: [(36, 48), (73, 37)],
    84: [(61, 35), (73, 35)], 85: [(19, 41), (76, 37)], 86: [(15, 41), (79, 35)], 87: [(19, 48), (76, 49)],
    88: [(32, 53), (71, 52)], 89: [(37, 49), (73, 37)],
    90: [(35, 44), (71, 30)], 91: [(20, 44), (59, 17)], 92: [(71, 48)], 93: [(36, 47), (74, 38)],
    94: [(36, 50), (71, 58)], 95: [(71, 63)], 96: [(70, 75)], 97: [(68, 75)], 98: [], 99: [(71, 70)],
}

# ---------------------------------------------------------------------------
# Held staff for the 110 monk keys. By default the shaft runs through both hands (rear
# hand = butt side, front hand = tip side), centred between them. A key with one hand, or
# two hands closer than MIN_SPAN, uses an authored screen angle (degrees, 0 = screen right,
# + = clockwise / down) and the share of the shaft behind the grip. depth > 0: in front of
# the body; < 0: behind it (hidden by the body). "free": the staff lies loose (death).
# ---------------------------------------------------------------------------
MIN_SPAN = 9
STAFF_LENGTH = 60                     # px, held staff (2u at 32 px/u, slightly foreshortened)
FACING_DEPTH = {"front": 1, "back": -1, "side": 1}
STAFF_POSE = {
    17: {"tip": "upper"},                                   # raised over the shoulder
    18: {"angle": -12, "behind": .2},                       # thrust hand carries the staff forward
    19: {"angle": -10, "behind": .2},
    23: {"angle": 22, "behind": .3, "length": 50},          # hands together: staff points at the target
    28: {"tip": "lower", "length": 58},
    29: {"angle": 168, "behind": .3},                       # trailing behind the leap
    30: {"depth": (-1, .4)},                                # rear hand behind the body: passes behind the head
    41: {"tip": "upper"},
    44: {"length": 56},
    45: {"tip": "lower", "length": 54},
    46: {"free": ((14, 83), (54, 83)), "depth": (1, 1)},       # dropped beside the falling monk
    47: {"free": ((10, 84), (52, 85)), "depth": (1, 1)},
    48: {"free": ((8, 85), (50, 86)), "depth": (1, 1)},
    49: {"free": ((8, 85), (50, 86)), "depth": (1, 1)},
    61: {"angle": -18, "behind": .35},
    68: {"angle": -14, "behind": .25},
    73: {"grip": (52, 47), "angle": -16, "behind": .5},     # hands hidden in front of the chest
    78: {"tip": "lower"},
    80: {"angle": -12, "behind": .3},
    81: {"angle": -20, "behind": .4},
    91: {"tip": "upper"},
    92: {"angle": 30, "behind": .3},
    95: {"angle": 40, "behind": .25},
    96: {"free": ((40, 82), (82, 83)), "depth": (-1, -1)},
    97: {"free": ((34, 82), (76, 83)), "depth": (-1, -1)},
    98: {"free": ((30, 82), (72, 83)), "depth": (-1, -1)},
    99: {"free": ((30, 82), (72, 83)), "depth": (-1, -1)},
}

# ---------------------------------------------------------------------------
# Knuckle strikes. Keys are monk frames (front, back); key 03 (index 2) is contact.
#   1 jab: attack1   2 cross: attack2   3 double thrust: attack3
#   4 "Пробой": a new order of existing drawings -- coil (attack3 key 02), cock (attack2
#     key 02), deep cross (attack2 key 04) held for two keys under the heavy accent,
#     attack2 recovery (key 05), attack3 guard (key 06).
# ---------------------------------------------------------------------------
KNUCKLE_STRIKES = [
    {"id": "knuckleStrike1", "source": "attack1", "front": [10, 11, 12, 13, 14, 15], "back": [60, 61, 62, 63, 64, 65],
     "accent": [None, None, "hit", "fade", None, None]},
    {"id": "knuckleStrike2", "source": "attack2", "front": [16, 17, 18, 19, 20, 21], "back": [66, 67, 68, 69, 70, 71],
     "accent": [None, None, "hit", "fade", None, None]},
    {"id": "knuckleStrike3", "source": "attack3", "front": [22, 23, 24, 25, 26, 27], "back": [72, 73, 74, 75, 76, 77],
     "accent": [None, None, "hit", "fade", None, None]},
    {"id": "knuckleStrike4", "source": "attack3/attack2 composite", "front": [23, 17, 19, 19, 20, 27],
     "back": [73, 67, 69, 69, 70, 77], "accent": [None, "glint", "heavy", "afterglow", None, None]},
]
KNUCKLE_FIRST = KEYS                 # strike cells follow the 110 key cells
KNUCKLE_ROWS = ROWS + 5              # 48 strike cells in rows 11-15

# ---------------------------------------------------------------------------
# Staff swings. Facing azimuth phi (degrees) is a ground direction drawn at
# (cos, sin / 2) on screen: E 0, SE 45, S 90, SW 135, NW 225, NE 315. A key reuses a monk
# body drawing ("mirror": flipped inside the clip) and points the staff along (phi, elev)
# from its grip ("hand": index into the drawn hands after mirroring, or "mid" of two).
# "behind" is the share of the shaft behind the grip. "held": copy the held staff of
# that body key (recovery). Contact is key 03 (index 2). Smears follow the tip from the
# previous key.
# ---------------------------------------------------------------------------
def swing(body, phi=None, elev=0, hand=-1, behind=.3, mirror=False, held=False, smear=True):
    return {"body": body, "phi": phi, "elev": elev, "hand": hand, "behind": behind, "mirror": mirror,
            "held": held, "smear": smear}


STAFF_ATTACKS = [
    {"id": "staffAttack1", "name": "forehand sweep", "arc": "±102°", "facings": {
        "front": [swing(22, -70, 22, hand=1, smear=False), swing(21, -20, 8), swing(24, 45, 0, hand="mid", behind=.22),
                  swing(25, 100, -4, hand="mid", behind=.25), swing(26, 150, -8, hand=1), swing(27, held=True)],
        "back": [swing(72, -160, 22, hand=0, smear=False), swing(71, -110, 8), swing(74, -45, 0, hand="mid", behind=.22),
                 swing(75, 10, -4, hand="mid", behind=.25), swing(76, 60, -8, hand=1), swing(77, held=True)],
        "side": [swing(100, -120, 25, hand=0, smear=False), swing(101, -60, 10), swing(104, 0, 0, behind=.22),
                 swing(104, 60, -4, behind=.25), swing(102, 110, -8), swing(100, held=True)],
    }},
    {"id": "staffAttack2", "name": "backhand sweep", "arc": "±102°", "facings": {
        "front": [swing(26, 160, 12, hand=0, smear=False), swing(20, 125, 5), swing(19, 40, 0, behind=.22),
                  swing(18, -20, 4, behind=.25), swing(20, -60, 20), swing(21, held=True)],
        "back": [swing(76, 70, 12, hand=1, smear=False), swing(70, 20, 5), swing(69, -50, 0, behind=.22),
                 swing(68, -110, 4, behind=.25), swing(70, -150, 20), swing(71, held=True)],
        "side": [swing(102, 115, 12, hand=0, smear=False), swing(103, 65, 5), swing(107, -5, 0, behind=.22),
                 swing(107, -65, 4, behind=.25), swing(101, -105, 20), swing(101, held=True)],
    }},
    # 360 degrees: the body turns through the four authored facings (decreasing phi).
    {"id": "staffAttack3", "name": "spin", "arc": "360°", "facings": {
        "front": [swing(23, 165, 5, hand="mid", behind=.4, smear=False), swing(69, -45, 0, behind=.2),
                  swing(69, -135, 0, mirror=True, behind=.2), swing(19, -225, 0, mirror=True, behind=.2),
                  swing(19, -315, 0, behind=.2), swing(27, held=True)],
        "back": [swing(72, 20, 8, hand=1, behind=.4, smear=False), swing(69, -135, 0, mirror=True, behind=.2),
                 swing(19, -225, 0, mirror=True, behind=.2), swing(19, -315, 0, behind=.2),
                 swing(69, -405, 0, behind=.2), swing(77, held=True)],
        "side": [swing(100, 150, 8, hand=0, behind=.4, smear=False), swing(69, -45, 0, behind=.2),
                 swing(69, -135, 0, mirror=True, behind=.2), swing(19, -225, 0, mirror=True, behind=.2),
                 swing(19, -315, 0, behind=.2), swing(100, held=True)],
    }},
]
FACINGS = ("front", "back", "side")
FACING_PHI = {"front": 45, "back": -45, "side": 0}
SWING_ROWS = 6                       # 54 cells, 10 per row
SWING_TIMING_MS = {"staffAttack1": [0, 65, 130, 172, 232, 283], "staffAttack2": [0, 70, 140, 185, 248, 303],
                   "staffAttack3": [0, 110, 220, 275, 352, 423]}
KNUCKLE_TIMING_MS = {"knuckleStrike1": [0, 30, 60, 83, 114, 133], "knuckleStrike2": [0, 30, 60, 83, 114, 133],
                     "knuckleStrike3": [0, 40, 80, 103, 134, 153], "knuckleStrike4": [0, 65, 130, 165, 214, 253]}


def json_text(value, indent=0):
    """JSON with two-space indent; any container that fits in 110 columns stays on one line."""
    flat = json.dumps(value, ensure_ascii=False, separators=(", ", ": "))
    if not isinstance(value, (dict, list)) or len(flat) + indent <= 110:
        return flat
    pad = " " * (indent + 2)
    if isinstance(value, dict):
        items = [f"{pad}{json.dumps(k, ensure_ascii=False)}: {json_text(v, indent + 2)}" for k, v in value.items()]
        return "{\n" + ",\n".join(items) + "\n" + " " * indent + "}"
    items = [pad + json_text(v, indent + 2) for v in value]
    return "[\n" + ",\n".join(items) + "\n" + " " * indent + "]"


def json_bytes(value):
    return (json_text(value) + "\n").encode()


def read_json(path):
    return json.loads((ROOT / path).read_text())


def sha(data):
    return hashlib.sha256(data).hexdigest()


def png_bytes(im):
    stream = BytesIO()
    im.save(stream, format="PNG", optimize=False, compress_level=9)
    return stream.getvalue()


def cell(atlas, index, size=(CELL, CELL), columns=COLUMNS):
    x, y = index % columns * size[0], index // columns * size[1]
    return atlas.crop((x, y, x + size[0], y + size[1]))


N4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
N8 = N4 + ((1, 1), (1, -1), (-1, 1), (-1, -1))


def components(pixels, neighbours=N8):
    pixels, seen, groups = set(pixels), set(), []
    for p in sorted(pixels):
        if p in seen:
            continue
        group, todo = set(), [p]
        seen.add(p)
        while todo:
            q = todo.pop()
            group.add(q)
            for dx, dy in neighbours:
                r = (q[0] + dx, q[1] + dy)
                if r in pixels and r not in seen:
                    seen.add(r)
                    todo.append(r)
        groups.append(group)
    return groups


# ---------------------------------------------------------------------------
# Hands
# ---------------------------------------------------------------------------
HAND_MATERIALS = ("skin", "bronze", "beads")


def material_plane(atlas, index, lookup):
    im = cell(atlas, index).load()
    return {(x, y): lookup[im[x, y][:3]] for y in range(CELL) for x in range(CELL) if im[x, y][3]}


def side_points():
    """Hands of the side keys: v2 source hands moved by the side rig's upper-body offset."""
    rig = read_json(MONK / "source/rig.json")
    return {100 + k: [(x + key["upperOffset"][0], y + key["upperOffset"][1]) for x, y in HANDS[key["upperFrame"]]]
            for k, key in enumerate(rig["keys"])}


def snap_hand(plane, wraps, point):
    """Hand pixels around an authored centre: hand materials inside the ink, within 4.5 px."""
    px, py = point
    near = [p for p, v in plane.items() if v[0] in HAND_MATERIALS and math.hypot(p[0] - px, p[1] - py) <= 3.2]
    if not near:
        raise ValueError(f"no hand pixels near {point}")
    start = min(near, key=lambda p: (plane[p][0] != "skin", math.hypot(p[0] - px, p[1] - py), p))
    mask, todo = set(), [start]
    while todo:
        p = todo.pop()
        if p in mask:
            continue
        mask.add(p)
        for dx, dy in N4:
            q = (p[0] + dx, p[1] + dy)
            if q in plane and plane[q][0] in HAND_MATERIALS and math.hypot(q[0] - px, q[1] - py) <= 4.5:
                todo.append(q)
    skin = [p for p in mask if plane[p][0] == "skin"]
    use = skin if len(skin) >= 4 else list(mask)
    cx = sum(p[0] + .5 for p in use) / len(use)
    cy = sum(p[1] + .5 for p in use) / len(use)
    # Forearm direction: from the nearest wrap pixels towards the hand; else away from the chest.
    wrist = [p for p in wraps if p not in mask and math.hypot(p[0] + .5 - cx, p[1] + .5 - cy) <= 8]
    if wrist:
        wx = sum(p[0] + .5 for p in wrist) / len(wrist)
        wy = sum(p[1] + .5 for p in wrist) / len(wrist)
    else:
        wx, wy = 48, 44
    ux, uy = cx - wx, cy - wy
    norm = math.hypot(ux, uy) or 1
    outline = {(p[0] + dx, p[1] + dy) for p in mask for dx, dy in N8} - mask
    outline = {p for p in outline if p in plane and plane[p][0] == "ink"}
    return {"centre": (cx, cy), "axis": (ux / norm, uy / norm), "mask": mask, "skin": set(skin),
            "cover": mask | outline}


def hands_of(atlas, lookup, points):
    hands = {}
    for index in range(KEYS):
        plane = material_plane(atlas, index, lookup)
        metal = {p for p, v in plane.items() if v[0] in ("bronze", "beads")}
        wraps = set().union(*[g for g in components(metal) if len(g) >= 12]) if metal else set()
        hands[index] = [snap_hand(plane, wraps, p) for p in points[index]]
    return hands


# ---------------------------------------------------------------------------
# Knuckles
# ---------------------------------------------------------------------------

def knuckle_band(hand):
    """{pixel: colour} of the 2-row band on skin only: bright studs between bronze, over a
    dark strap on the wrist side. It crosses the hand at 62% of its length along the
    forearm: the front face of a fist, the finger roots of an open hand."""
    skin = hand["skin"]
    if len(skin) < 6:
        return {}
    (cx, cy), (ux, uy) = hand["centre"], hand["axis"]
    vx, vy = -uy, ux
    t = {p: (p[0] + .5 - cx) * ux + (p[1] + .5 - cy) * uy for p in skin}
    s = {p: (p[0] + .5 - cx) * vx + (p[1] + .5 - cy) * vy for p in skin}
    lo, hi = min(t.values()), max(t.values())
    top = lo + .62 * (hi - lo)
    band = {}
    for p in skin:
        if abs(s[p]) > 3.1:
            continue
        if top - 1 < t[p] <= top + .5:
            band[p] = COLOR["metal"][0] if (p[0] + p[1]) % 2 == 0 else COLOR["metal"][2]
        elif top - 2 < t[p] <= top - 1:
            band[p] = COLOR["metal"][3]
    return band


def tip_of(hand):
    """Outermost hand pixel along the forearm direction."""
    (cx, cy), (ux, uy) = hand["centre"], hand["axis"]
    return max(hand["mask"], key=lambda p: ((p[0] + .5 - cx) * ux + (p[1] + .5 - cy) * uy, p))


def put(layer, x, y, colour):
    x, y = round(x), round(y)
    if 0 <= x < CELL and 0 <= y < CELL:
        layer[(x, y)] = colour


def accent(kind, hand):
    """Hit accents ahead of the striking fist (gear board 4: light ring and a 2x2 bronze spark)."""
    layer = {}
    if not kind:
        return layer
    tx, ty = tip_of(hand)
    ux, uy = hand["axis"]
    vx, vy = -uy, ux
    ax, ay = tx + ux * 2.4, ty + uy * 2.4                 # just past the knuckles
    flare, ring, bright, bronze, dark = COLOR["flare"][0], *COLOR["metal"]
    if kind == "glint":
        put(layer, ax - ux, ay - uy, flare)
    elif kind == "hit":
        for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
            put(layer, ax + dx, ay + dy, bright if (dx + dy) % 2 else ring)
        put(layer, ax + ux * 2 + .5, ay + uy * 2 + .5, bronze)
    elif kind == "fade":
        put(layer, ax + ux * 2.5, ay + uy * 2.5, bronze)
    elif kind == "heavy":
        # "Пробой": a 5 px-armed star with a white core, two speed lines along the forearm
        cx, cy = ax + ux * 2, ay + uy * 2
        for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
            put(layer, cx + dx, cy + dy, flare)
        for r, colour in ((1, ring), (2, ring), (3, bright), (4, bright), (5, bronze)):
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                put(layer, cx + .5 + dx * (r + .5) - .5, cy + .5 + dy * (r + .5) - .5, colour)
        for r, colour in ((2.1, ring), (3.2, bright)):
            for dx, dy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
                put(layer, cx + .5 + dx * r, cy + .5 + dy * r, colour)
        for side in (-3.2, 3.2):
            for k in range(3, 11):
                if k < 9 or k % 2:
                    put(layer, tx - ux * k + vx * side, ty - uy * k + vy * side, ring if k < 7 else bright)
    elif kind == "afterglow":
        cx, cy = ax + ux * 2, ay + uy * 2
        for k in range(32):
            a = k * math.pi / 16
            put(layer, cx + .5 + math.cos(a) * 5.2, cy + .5 + math.sin(a) * 5.2, bright if k % 2 else bronze)
        put(layer, cx, cy, ring)
    return layer


def striking_hand(hands):
    """The fist that leads the strike: furthest towards screen right (front/back face right)."""
    usable = [h for h in hands if len(h["skin"]) >= 6] or hands
    return max(usable, key=lambda h: (tip_of(h)[0], -tip_of(h)[1])) if usable else None


def knuckle_layers(hands):
    bands = {index: {} for index in range(KEYS)}
    for index in range(KEYS):
        for hand in hands[index]:
            bands[index].update(knuckle_band(hand))
    strikes = []
    for s, strike in enumerate(KNUCKLE_STRIKES):
        for f, facing in enumerate(("front", "back")):
            for k, frame in enumerate(strike[facing]):
                layer = dict(bands[frame])
                kind = strike["accent"][k]
                lead = striking_hand(hands[frame])
                if kind == "glint":
                    for hand in hands[frame]:
                        layer.update(accent(kind, hand))
                elif kind and lead is not None:
                    if kind in ("hit", "heavy", "afterglow"):
                        # the contact keys light every ring of the striking band
                        for p in knuckle_band(lead):
                            if layer.get(p) == COLOR["metal"][2]:
                                layer[p] = COLOR["metal"][0]
                    layer.update(accent(kind, lead))
                strikes.append({"cell": KNUCKLE_FIRST + s * 12 + f * 6 + k, "layer": layer, "frame": frame,
                                "strike": strike["id"], "facing": facing, "key": k, "accent": kind})
    return bands, strikes


# ---------------------------------------------------------------------------
# Staff drawing
# ---------------------------------------------------------------------------

def shaft(butt, tip):
    """{pixel: (material, step, t)}: 3 px shaft (light, mid, dark across it, light upper-left),
    1 px ink rim and 3 px bronze caps. t runs 0 (butt) .. 1 (tip)."""
    (x0, y0), (x1, y1) = butt, tip
    length = math.hypot(x1 - x0, y1 - y0)
    pixels = {}
    if length < 1:
        return pixels
    steep = abs(y1 - y0) > abs(x1 - x0)
    a0, a1 = (y0, y1) if steep else (x0, x1)
    b0, b1 = (x0, x1) if steep else (y0, y1)
    lo, hi = math.floor(min(a0, a1)), math.floor(max(a0, a1))
    cap = 3 / length
    for a in range(lo, hi + 1):
        f = 0. if a1 == a0 else (a + .5 - a0) / (a1 - a0)
        f = max(0., min(1., f))
        centre = math.floor(b0 + (b1 - b0) * f)
        metal = f <= cap or f >= 1 - cap
        for offset, step in ((-1, 0), (0, 1), (1, 2)):
            p = (centre + offset, a) if steep else (a, centre + offset)
            pixels[p] = ("metal" if metal else "wood", step + (1 if metal else 0), f)
        for offset in (-2, 2):
            p = (centre + offset, a) if steep else (a, centre + offset)
            pixels.setdefault(p, ("ink", 0, f))
    # end caps of ink
    for a, f in ((lo - 1, 0. if a1 >= a0 else 1.), (hi + 1, 1. if a1 >= a0 else 0.)):
        g = 0. if a1 == a0 else max(0., min(1., (a + .5 - a0) / (a1 - a0)))
        centre = math.floor(b0 + (b1 - b0) * g)
        for offset in (-1, 0, 1):
            p = (centre + offset, a) if steep else (a, centre + offset)
            pixels.setdefault(p, ("ink", 0, f))
    # a bright bronze glint on the upper side of each cap
    for f in (0., 1.):
        ends = [p for p, v in pixels.items() if v[0] == "metal" and v[1] == 1 and abs(v[2] - f) <= cap / 2 + 1e-9]
        if ends:
            pixels[min(ends)] = ("metal", 0, f)
    return pixels


def paint_staff(size, butt, tip, depth, body_alpha, covers, offset=(0, 0)):
    """Staff layer in a cell of `size`. Body pixels hide the shaft where it is behind the
    body; gripping hands (cover masks, in monk cell space) always show over it."""
    layer = {}
    w, h = size
    ox, oy = offset
    hidden = set()
    for cover in covers:
        hidden |= {(x + ox, y + oy) for x, y in cover}
    for p, (material, step, f) in shaft(butt, tip).items():
        x, y = p
        if not (0 <= x < w and 0 <= y < h):
            raise ValueError(f"staff leaves its cell at {p}")
        if p in hidden:
            continue
        d = depth[0] + (depth[1] - depth[0]) * f
        if d < 0 and (x - ox, y - oy) in body_alpha:
            continue
        layer[p] = COLOR[material][step]
    return layer


def held_staff(index, hands, facing):
    """Butt, tip, depth and grips of the held staff for one monk key."""
    spec = STAFF_POSE.get(index, {})
    if "free" in spec:
        (bx, by), (tx, ty) = spec["free"]
        return {"butt": (bx + .5, by + .5), "tip": (tx + .5, ty + .5), "depth": spec["depth"], "grips": [],
                "mode": "free"}
    points = [h["centre"] for h in hands]
    if "grip" in spec:
        points = [(spec["grip"][0] + .5, spec["grip"][1] + .5)]
    length = spec.get("length", STAFF_LENGTH)
    depth = spec.get("depth", (FACING_DEPTH[facing],) * 2)
    two = len(points) == 2 and math.dist(*points) >= MIN_SPAN and "angle" not in spec
    if two:
        rear, front = sorted(points)
        if spec.get("tip") == "upper":
            rear, front = sorted(points, key=lambda p: -p[1])
        elif spec.get("tip") == "lower":
            rear, front = sorted(points, key=lambda p: p[1])
        span = math.dist(rear, front)
        length = max(length, span + 14)
        ux, uy = (front[0] - rear[0]) / span, (front[1] - rear[1]) / span
        mx, my = (rear[0] + front[0]) / 2, (rear[1] + front[1]) / 2
        butt, tip = (mx - ux * length / 2, my - uy * length / 2), (mx + ux * length / 2, my + uy * length / 2)
        grips, mode = [front, rear], "two-hand"
    else:
        if len(points) == 2:
            grip = ((points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2)
        else:
            grip = points[0]
        angle = math.radians(spec.get("angle", -18))
        ux, uy = math.cos(angle), math.sin(angle)
        behind = spec.get("behind", .35)
        butt = (grip[0] - ux * length * behind, grip[1] - uy * length * behind)
        tip = (grip[0] + ux * length * (1 - behind), grip[1] + uy * length * (1 - behind))
        grips, mode = [grip], "one-hand"
    return {"butt": fit(tip, butt), "tip": fit(butt, tip), "depth": depth, "grips": grips, "mode": mode}


def fit(start, end, margin=3, size=CELL):
    """Shorten the shaft at `end` so its rim stays inside the cell."""
    (x0, y0), (x1, y1) = start, end
    f = 1.
    for a0, a1 in ((x0, x1), (y0, y1)):
        if a1 > size - margin and a1 != a0:
            f = min(f, (size - margin - a0) / (a1 - a0))
        if a1 < margin and a1 != a0:
            f = min(f, (margin - a0) / (a1 - a0))
    return (x0 + (x1 - x0) * f, y0 + (y1 - y0) * f)


def facing_of(index):
    return "side" if index >= 100 else "back" if index >= 50 else "front"


def gripping(hands, grips):
    """The hands whose centres carry the staff."""
    chosen = []
    for g in grips:
        near = [h for h in hands if math.dist(h["centre"], g) < 6]
        chosen += [h for h in near if h not in chosen]
    return chosen


def staff_layers(atlas, hands):
    alpha = {}
    poses, layers = {}, {}
    for index in range(KEYS):
        a = cell(atlas, index).getchannel("A").load()
        alpha[index] = {(x, y) for y in range(CELL) for x in range(CELL) if a[x, y]}
        pose = held_staff(index, hands[index], facing_of(index))
        covers = [h["cover"] for h in gripping(hands[index], pose["grips"])]
        layers[index] = paint_staff((CELL, CELL), pose["butt"], pose["tip"], pose["depth"], alpha[index], covers)
        poses[index] = pose
    return poses, layers, alpha


# ---------------------------------------------------------------------------
# Staff swings
# ---------------------------------------------------------------------------

def mirrored_hand(hand):
    flip = lambda p: (CELL - 1 - p[0], p[1])
    (cx, cy), (ux, uy) = hand["centre"], hand["axis"]
    return {"centre": (CELL - cx, cy), "axis": (-ux, uy), "mask": {flip(p) for p in hand["mask"]},
            "skin": {flip(p) for p in hand["skin"]}, "cover": {flip(p) for p in hand["cover"]}}


def project(phi, elev):
    """Screen pixels per world unit along a staff pointing at (phi, elev); depth towards the camera."""
    a, e = math.radians(phi), math.radians(elev)
    return (PX * math.cos(e) * math.cos(a), PX / 2 * math.cos(e) * math.sin(a) - PX * math.sin(e),
            math.cos(e) * math.sin(a))


def swing_key(spec, hands, alpha, poses, facing, previous):
    body = spec["body"]
    # Hands keep the authored drawing's order (rear to front along screen x) before mirroring.
    own = sorted(hands[body], key=lambda h: h["centre"])
    own = [mirrored_hand(h) for h in own] if spec["mirror"] else own
    body_alpha = {(CELL - 1 - x, y) for x, y in alpha[body]} if spec["mirror"] else alpha[body]
    ox, oy = SWING_OFFSET
    if spec["held"]:
        pose = poses[body]
        butt, tip = (pose["butt"][0] + ox, pose["butt"][1] + oy), (pose["tip"][0] + ox, pose["tip"][1] + oy)
        covers = [h["cover"] for h in gripping(own, pose["grips"])]
        layer = paint_staff(SWING_CELL, butt, tip, pose["depth"], body_alpha, covers, (ox, oy))
        return {"layer": layer, "butt": butt, "tip": tip, "grip": [(g[0] + ox, g[1] + oy) for g in pose["grips"]],
                "depth": list(pose["depth"]), "tipWorld": None}
    if spec["hand"] == "mid":
        grip = ((own[0]["centre"][0] + own[1]["centre"][0]) / 2, (own[0]["centre"][1] + own[1]["centre"][1]) / 2)
        holders = own
    else:
        holder = own[spec["hand"]]
        grip, holders = holder["centre"], [holder]
    sx, sy, dz = project(spec["phi"], spec["elev"])
    length, behind = STAFF_UNITS, spec["behind"]
    butt = (grip[0] - sx * length * behind + ox, grip[1] - sy * length * behind + oy)
    tip = (grip[0] + sx * length * (1 - behind) + ox, grip[1] + sy * length * (1 - behind) + oy)
    # Hands sit in front of the torso when the body faces the camera, behind it otherwise.
    grip_depth = .35 if facing_of(body) != "back" else -.35
    depth = (grip_depth - dz * length * behind, grip_depth + dz * length * (1 - behind))
    layer = {}
    if spec["smear"] and previous is not None:
        layer.update(smear(previous, (spec["phi"], spec["elev"]), grip, length * (1 - behind), body_alpha))
    layer.update(paint_staff(SWING_CELL, butt, tip, depth, body_alpha, [h["cover"] for h in holders], (ox, oy)))
    return {"layer": layer, "butt": butt, "tip": tip, "grip": [(grip[0] + ox, grip[1] + oy)],
            "depth": [round(d, 3) for d in depth], "tipWorld": (spec["phi"], spec["elev"])}


def smear(previous, current, grip, reach, body_alpha):
    """Swing smear: a crescent along the tip's path from the previous key. Three rows thick
    at the leading end (bright outer edge), thinning to a dithered single row at the tail.
    Points behind the body are hidden by the body silhouette."""
    (p0, e0), (p1, e1) = previous, current
    ox, oy = SWING_OFFSET
    layer = {}
    for k in range(401):
        f = k / 400
        phi, elev = p0 + (p1 - p0) * f, e0 + (e1 - e0) * f
        sx, sy, dz = project(phi, elev)
        dx, dy = sx * reach, sy * reach
        radius = math.hypot(dx, dy) or 1
        rows = 3 if f >= .55 else 2 if f >= .25 else 1
        for row in range(rows):
            x = grip[0] + dx * (1 - row / radius) + ox
            y = grip[1] + dy * (1 - row / radius) + oy
            q = (math.floor(x), math.floor(y))
            if f < .25 and (q[0] + q[1]) % 2:
                continue                                  # dithered tail
            if dz < -.05 and (q[0] - ox, q[1] - oy) in body_alpha:
                continue
            if 0 <= q[0] < SWING_CELL[0] and 0 <= q[1] < SWING_CELL[1]:
                colour = COLOR["metal"][0] if row == 0 and f >= .55 else COLOR["smear"][0] if row < 2 else COLOR["smear"][1]
                layer.setdefault(q, colour)
    return layer


def swing_layers(hands, alpha, poses):
    keys = []
    for a, attack in enumerate(STAFF_ATTACKS):
        for f, facing in enumerate(FACINGS):
            previous = None
            for k, spec in enumerate(attack["facings"][facing]):
                drawn = swing_key(spec, hands, alpha, poses, facing, previous)
                previous = drawn["tipWorld"] or previous
                keys.append({"cell": a * 18 + f * 6 + k, "attack": attack["id"], "facing": facing, "key": k,
                             "body": spec["body"], "mirror": spec["mirror"], **drawn})
    return keys


# ---------------------------------------------------------------------------
# Atlases
# ---------------------------------------------------------------------------

def atlas_of(layers, size, rows):
    im = Image.new("RGBA", (COLUMNS * size[0], rows * size[1]))
    px = im.load()
    for index, layer in layers.items():
        x0, y0 = index % COLUMNS * size[0], index // COLUMNS * size[1]
        for (x, y), colour in layer.items():
            px[x0 + x, y0 + y] = (*colour, 255)
    return im


def r2(v):
    return [round(v[0], 2), round(v[1], 2)]


def manifest(hands, poses, strikes, swings, bands, monk_meta):
    keys = []
    for index in range(KEYS):
        pose = poses[index]
        angle = math.degrees(math.atan2(pose["tip"][1] - pose["butt"][1], pose["tip"][0] - pose["butt"][0]))
        keys.append({
            "index": index, "name": monk_meta["frames"][index],
            "hands": [{"centre": r2(h["centre"]), "axis": r2(h["axis"]), "pixels": len(h["mask"]),
                       "knuckles": len(knuckle_band(h)) > 0} for h in hands[index]],
            "knuckles": {"cell": index, "pixels": len(bands[index])},
            "staff": {"cell": index, "mode": pose["mode"], "grips": [r2(g) for g in pose["grips"]],
                      "angle": round(angle, 1), "butt": r2(pose["butt"]), "tip": r2(pose["tip"]),
                      "depth": list(pose["depth"])},
        })
    knuckle_clips = {}
    for strike in KNUCKLE_STRIKES:
        clip = {"source": strike["source"], "contactKey": 2, "keyTimesMs": KNUCKLE_TIMING_MS[strike["id"]],
                "playback": "one-shot-hold", "accent": strike["accent"]}
        for facing in ("front", "back"):
            clip[facing] = [{"frame": s["frame"], "overlay": s["cell"]} for s in strikes
                            if s["strike"] == strike["id"] and s["facing"] == facing]
        knuckle_clips[strike["id"]] = clip
    swing_clips = {}
    for attack in STAFF_ATTACKS:
        clip = {"name": attack["name"], "arc": attack["arc"], "contactKey": 2, "keyTimesMs": SWING_TIMING_MS[attack["id"]],
                "playback": "one-shot-hold"}
        for facing in FACINGS:
            clip[facing] = [{"frame": s["body"], "mirrorBody": s["mirror"], "staff": s["cell"],
                             "grip": r2(s["grip"][0]) if s["grip"] else None, "butt": r2(s["butt"]), "tip": r2(s["tip"]),
                             "depth": s["depth"]}
                            for s in swings if s["attack"] == attack["id"] and s["facing"] == facing]
        swing_clips[attack["id"]] = clip
    return {
        "schemaVersion": 1, "status": "ready", "nativePixelsPerUnit": 32,
        "monkAtlas": {"manifest": str(MONK / "manifest.json"), "cell": CELL, "columns": COLUMNS, "rows": ROWS,
                      "anchor": list(ANCHOR), "keys": KEYS},
        "drawOrder": ["monk appearance atlas", "weapon layer (hands already cut out where they grip)"],
        "appearanceIndependent": True,
        "knuckles": {
            "path": "knuckles.png", "cell": CELL, "columns": COLUMNS, "rows": KNUCKLE_ROWS, "anchor": list(ANCHOR),
            "filter": "nearest", "mipmaps": False,
            "keyCells": "cell i overlays monk key i (0-109); same anchor and flip as the monk key",
            "strikeCells": f"{KNUCKLE_FIRST}-{KNUCKLE_FIRST + 47}: band plus hit accent per strike key",
            "clips": knuckle_clips,
        },
        "staff": {
            "path": "staff.png", "cell": CELL, "columns": COLUMNS, "rows": ROWS, "anchor": list(ANCHOR),
            "filter": "nearest", "mipmaps": False, "lengthPixels": STAFF_LENGTH, "lengthUnits": STAFF_UNITS,
            "keyCells": "cell i is the staff held in monk key i (0-109); same anchor and flip as the monk key",
        },
        "staffAttacks": {
            "path": "staff-attacks.png", "cell": list(SWING_CELL), "columns": COLUMNS, "rows": SWING_ROWS,
            "anchor": list(SWING_ANCHOR), "monkCellOffset": list(SWING_OFFSET), "filter": "nearest", "mipmaps": False,
            "facingAzimuth": FACING_PHI,
            "note": "Body: monk key `frame`, flipped when mirrorBody differs from the facing's flipX. Staff: cell `staff`, flipped with the facing. Both share the ground anchor.",
            "clips": swing_clips,
        },
        "keys": keys,
        "palette": PALETTE,
        "provenance": "provenance.json",
    }


# ---------------------------------------------------------------------------
# Previews
# ---------------------------------------------------------------------------

def checker(width, height):
    im = Image.new("RGB", (width, height), "#292532")
    draw = ImageDraw.Draw(im)
    for y in range(0, height, 8):
        for x in range(0, width, 8):
            if (x // 8 + y // 8) % 2:
                draw.rectangle((x, y, x + 7, y + 7), fill="#24212c")
    return im


def floor(width, height):
    tile = Image.open(ROOT / "assets/game/pixel-v1/floor.png").convert("RGB")
    im = Image.new("RGB", (width, height))
    for y in range(0, height, tile.height):
        for x in range(0, width, tile.width):
            im.paste(tile, (x, y))
    return im


def scaled(im, factor):
    return im.resize((im.width * factor, im.height * factor), NEAREST)


def composite(monk, overlay, index, overlay_index=None, size=(CELL, CELL)):
    im = Image.new("RGBA", (CELL, CELL))
    im.alpha_composite(cell(monk, index))
    o = cell(overlay, index if overlay_index is None else overlay_index, size)
    im.alpha_composite(o)
    return im


def key_sheet(monk, overlay, title):
    """All 110 keys with one overlay, 10 per row, 1x."""
    sheet = checker(COLUMNS * CELL, 12 + ROWS * CELL)
    draw = ImageDraw.Draw(sheet)
    draw.text((4, 1), title, fill="#e6dfcf")
    for index in range(KEYS):
        im = composite(monk, overlay, index)
        sheet.paste(im, (index % COLUMNS * CELL, 12 + index // COLUMNS * CELL), im)
    return sheet


def strike_sheet(monk, knuckles, strikes):
    """The 48 strike cells over their body frames: one row per strike and facing."""
    sheet = checker(6 * CELL, 8 * (CELL + 12))
    draw = ImageDraw.Draw(sheet)
    ids = [k["id"] for k in KNUCKLE_STRIKES]
    for s in strikes:
        y = (ids.index(s["strike"]) * 2 + (s["facing"] == "back")) * (CELL + 12)
        im = composite(monk, knuckles, s["frame"], s["cell"])
        sheet.paste(im, (s["key"] * CELL, y + 12), im)
        if s["key"] == 0:
            draw.text((4, y + 1), f"{s['strike']} / {s['facing']}", fill="#e6dfcf")
    return sheet


def swing_composite(monk, swing_atlas, s):
    im = Image.new("RGBA", SWING_CELL)
    body = cell(monk, s["body"])
    if s["mirror"]:
        body = body.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    im.alpha_composite(body, SWING_OFFSET)
    im.alpha_composite(cell(swing_atlas, s["cell"], SWING_CELL))
    return im


def swing_sheet(monk, swing_atlas, swings):
    w, h = SWING_CELL
    sheet = checker(6 * w, 9 * (h + 12))
    draw = ImageDraw.Draw(sheet)
    for s in swings:
        row = [a["id"] for a in STAFF_ATTACKS].index(s["attack"]) * 3 + FACINGS.index(s["facing"])
        y = row * (h + 12)
        im = swing_composite(monk, swing_atlas, s)
        sheet.paste(im, (s["key"] * w, y + 12), im)
        if s["key"] == 0:
            draw.text((4, y + 1), f"{s['attack']} / {s['facing']}", fill="#e6dfcf")
    return sheet


def game_scale(monk, knuckles, staff, swing_atlas, swings):
    """Native-pixel strip on the floor tile: bare, knuckles, staff idle/run, swing contact keys."""
    w, h = SWING_CELL
    shots = [("bare", composite(monk, Image.new("RGBA", monk.size), 0)), ("knuckles", composite(monk, knuckles, 0)),
             ("knuckles hit", composite(monk, knuckles, 12, KNUCKLE_FIRST + 2)),
             ("staff idle", composite(monk, staff, 0)), ("staff run", composite(monk, staff, 6)),
             ("staff side", composite(monk, staff, 104)), ("staff back", composite(monk, staff, 54))]
    board = floor(len(shots) * CELL + 3 * w, h)
    draw = ImageDraw.Draw(board)
    for i, (label, im) in enumerate(shots):
        board.paste(im, (i * CELL, SWING_OFFSET[1]), im)
        draw.text((i * CELL + 2, 2), label, fill="#f5e4bd")
    for j, attack in enumerate(STAFF_ATTACKS):
        s = next(x for x in swings if x["attack"] == attack["id"] and x["facing"] == "front" and x["key"] == 2)
        im = swing_composite(monk, swing_atlas, s)
        board.paste(im, (len(shots) * CELL + j * w, 0), im)
        draw.text((len(shots) * CELL + j * w + 2, 2), f"{attack['id']} contact", fill="#f5e4bd")
    return board


# ---------------------------------------------------------------------------
# Build, validate, verify
# ---------------------------------------------------------------------------

def construct():
    monk_meta = read_json(MONK / "manifest.json")["monk"]
    monk = Image.open(ROOT / MONK / "monk-side.png").convert("RGBA")
    palette = read_json(V2_PALETTE)
    lookup = {tuple(bytes.fromhex(c)): (m, i) for m, ramp in palette.items() for i, c in enumerate(ramp)}
    points = {**HANDS, **side_points()}
    hands = hands_of(monk, lookup, points)
    bands, strikes = knuckle_layers(hands)
    poses, staff, alpha = staff_layers(monk, hands)
    swings = swing_layers(hands, alpha, poses)
    knuckles = atlas_of({**bands, **{s["cell"]: s["layer"] for s in strikes}}, (CELL, CELL), KNUCKLE_ROWS)
    staff_atlas = atlas_of(staff, (CELL, CELL), ROWS)
    swing_atlas = atlas_of({s["cell"]: s["layer"] for s in swings}, SWING_CELL, SWING_ROWS)
    meta = manifest(hands, poses, strikes, swings, bands, monk_meta)
    artifacts = {PKG / "knuckles.png": png_bytes(knuckles), PKG / "staff.png": png_bytes(staff_atlas),
                 PKG / "staff-attacks.png": png_bytes(swing_atlas)}
    previews = {
        "previews/knuckles-keys.png": key_sheet(monk, knuckles, "knuckles: monk keys 0-109"),
        "previews/knuckle-strikes.png": strike_sheet(monk, knuckles, strikes),
        "previews/staff-keys.png": key_sheet(monk, staff_atlas, "staff: monk keys 0-109"),
        "previews/staff-attacks.png": swing_sheet(monk, swing_atlas, swings),
        "previews/game-scale.png": game_scale(monk, knuckles, staff_atlas, swing_atlas, swings),
    }
    for path, im in previews.items():
        artifacts[PKG / path] = png_bytes(im)
    artifacts[PKG / "previews/game-scale-3x.png"] = png_bytes(scaled(previews["previews/game-scale.png"], 3))
    meta["previews"] = sorted([*previews, "previews/game-scale-3x.png"])
    meta["files"] = [{"path": str(p.relative_to(PKG)), "bytes": len(d), "sha256": sha(d)}
                     for p, d in sorted(artifacts.items()) if p.suffix == ".png" and "previews" not in p.parts]
    for f in meta["files"]:
        im = {"knuckles.png": knuckles, "staff.png": staff_atlas, "staff-attacks.png": swing_atlas}[f["path"]]
        f["size"] = list(im.size)
    artifacts[PKG / "manifest.json"] = json_bytes(meta)
    inputs = {str(MONK / "manifest.json"), str(MONK / "monk-side.png"), str(MONK / "source/rig.json"),
              str(V2_PALETTE), "assets/game/pixel-v1/floor.png", "scripts/build-monk-weapons.py"}
    return {"artifacts": artifacts, "inputs": inputs, "meta": meta, "monk": monk, "hands": hands, "bands": bands,
            "strikes": strikes, "poses": poses, "staff": staff, "swings": swings, "alpha": alpha,
            "knuckles": knuckles, "staff_atlas": staff_atlas, "swing_atlas": swing_atlas, "lookup": lookup}


def validate(built):
    meta, monk, hands = built["meta"], built["monk"], built["hands"]
    assert len(meta["keys"]) == KEYS and [k["index"] for k in meta["keys"]] == list(range(KEYS))
    skin = {tuple(bytes.fromhex(c)) for c in read_json(V2_PALETTE)["skin"]}
    allowed = {c for ramp in COLOR.values() for c in ramp}
    for name, im in (("knuckles", built["knuckles"]), ("staff", built["staff_atlas"]), ("swings", built["swing_atlas"])):
        alpha = im.getchannel("A").tobytes()
        assert set(alpha) <= {0, 255}, (name, "binary alpha")
        data = im.tobytes()
        assert all(data[i:i + 3] == b"\0\0\0" for i in range(0, len(data), 4) if not data[i + 3]), (name, "hidden RGB")
        colours = {c[:3] for _, c in im.getcolors(im.width * im.height) if c[3]}
        assert colours <= allowed, (name, "colour outside the weapon palette")
        assert not colours & skin, (name, "weapon layers carry no skin")
    # Knuckle bands sit on the monk's skin pixels only: the silhouette never changes.
    with_band = 0
    for index in range(KEYS):
        band = built["bands"][index]
        mp = cell(monk, index).load()
        for (x, y) in band:
            assert mp[x, y][3] and mp[x, y][:3] in skin, (index, (x, y), "band off the skin")
        with_band += bool(band)
        for h in hands[index]:
            cx, cy = h["centre"]
            assert 0 <= cx < CELL and 0 <= cy < CELL, (index, "hand centre outside the cell")
            assert len(h["mask"]) >= 3, (index, "hand too small")
    visible = [i for i in range(KEYS) if any(len(h["skin"]) >= 6 for h in hands[i])]
    assert set(visible) <= {i for i in range(KEYS) if built["bands"][i]}, "a visible fist without a band"
    # Every key has a staff drawing inside its cell and a pose record.
    for index in range(KEYS):
        layer, pose = built["staff"][index], built["poses"][index]
        assert len(layer) >= (40 if pose["depth"][0] > 0 or pose["depth"][1] > 0 else 24), (index, "staff too small", len(layer))
        for end in (pose["butt"], pose["tip"]):
            assert 1 <= end[0] <= CELL - 2 and 1 <= end[1] <= CELL - 1, (index, "staff end outside the cell", end)
        for g in pose["grips"]:
            assert 0 <= g[0] < CELL and 0 <= g[1] < CELL, (index, "grip outside the cell")
        if pose["mode"] != "free":
            assert pose["grips"], (index, "held staff without a grip")
    # Strikes and swings.
    assert len(built["strikes"]) == 48 and len(built["swings"]) == 54
    for s in built["strikes"]:
        if s["accent"] in ("hit", "heavy"):
            assert len(s["layer"]) > len(built["bands"][s["frame"]]), (s["strike"], s["facing"], "contact accent")
    for s in built["swings"]:
        assert len(s["layer"]) >= 30, (s["attack"], s["facing"], s["key"], "swing staff too small")
    for clip in meta["staffAttacks"]["clips"].values():
        for facing in FACINGS:
            assert len(clip[facing]) == 6
    spin = meta["staffAttacks"]["clips"]["staffAttack3"]["front"]
    assert len({(k["frame"] >= 50, k["mirrorBody"]) for k in spin[1:5]}) == 4, "the spin shows four facings"
    return {"status": "passed", "toolchain": {"python": platform.python_version(), "pillow": PILLOW_VERSION},
            "keys": KEYS, "hands": sum(len(h) for h in hands.values()), "keysWithKnuckleBand": with_band,
            "knuckleBandPixels": sum(len(b) for b in built["bands"].values()),
            "knuckleStrikeCells": len(built["strikes"]), "staffKeys": KEYS,
            "staffModes": {m: sum(p["mode"] == m for p in built["poses"].values()) for m in ("two-hand", "one-hand", "free")},
            "swingCells": len(built["swings"]), "binaryAlpha": True, "transparentRgbZero": True,
            "paletteOnly": True, "noSkinPixels": True, "bandsOnSkinOnly": True,
            "atlases": {f["path"]: f["size"] for f in meta["files"]},
            "artifactCount": len(built["artifacts"]), "sourceCount": len(built["inputs"])}


def provenance(built):
    return {"schemaVersion": 1, "date": "2026-10-24",
            "generationMode": "No image generation. Deterministic pixel drawing over the shipped pixel-v10 monk atlas.",
            "rightsNote": "Derived from project artwork; inherited provenance of pixel-v10/monk-side applies. Not a new license grant.",
            "acceptance": {"status": "worker-inspected-awaiting-coordinator",
                           "authority": "Coordinator accepts under user delegation. No personal user approval is claimed.",
                           "boundary": "Asset owner inspected 4x/10x review sheets and the native game-scale strip; renderer integration and in-game acceptance belong to the coordinator."},
            "method": {"hands": "Authored rough centres (keys 0-99) snapped to hand pixels; side keys = source hands + rig upperOffset.",
                       "knuckles": "2-row band (light rings, dark bronze) on skin pixels across the distal fist; strike accents per gear board 4.",
                       "staff": "3 px shaft, ink rim, bronze caps; through both grips or along an authored angle; gripping hands and the body (when behind) cut out.",
                       "swings": "3D staff direction (azimuth, elevation) from a grip on a reused monk body drawing; ground-ellipse projection 32/16/32 px per unit; tip smears.",
                       "lookReference": "assets/concepts/systems-01/gear/04-weapon-on-monk.png and source/ mocks (not sampled)"},
            "builder": "scripts/build-monk-weapons.py",
            "toolchain": {"python": platform.python_version(), "pillow": PILLOW_VERSION},
            "inputs": [{"path": p, "sha256": sha((ROOT / p).read_bytes())} for p in sorted(built["inputs"])],
            "outputs": [{"path": str(p), "sha256": sha(data), "bytes": len(data)}
                        for p, data in sorted(built["artifacts"].items())]}


def run(verify_only):
    built = construct()
    report = validate(built)
    artifacts = built["artifacts"]
    if verify_only:
        record = read_json(PKG / "provenance.json")
        for source in record["inputs"]:
            assert sha((ROOT / source["path"]).read_bytes()) == source["sha256"], ("source changed", source["path"])
        for output in record["outputs"]:
            assert sha((ROOT / output["path"]).read_bytes()) == output["sha256"], ("output changed", output["path"])
        assert {o["path"] for o in record["outputs"]} == {str(p) for p in artifacts}, "output set changed"
        for path, data in artifacts.items():
            assert (ROOT / path).read_bytes() == data, ("rebuild differs", str(path))
        qa = read_json(PKG / "qa-report.json")
        assert qa["status"] == "passed" and qa["artifactCount"] == report["artifactCount"], "qa report stale"
        report.update(rebuildMatches=True, sourceHashesMatch=True, mode="read-only")
    else:
        for path, data in artifacts.items():
            (ROOT / path).parent.mkdir(parents=True, exist_ok=True)
            (ROOT / path).write_bytes(data)
        (ROOT / PKG / "provenance.json").write_bytes(json_bytes(provenance(built)))
        report.update(rebuildMatches=True, sourceHashesMatch=True, mode="build")
        (ROOT / PKG / "qa-report.json").write_bytes(json_bytes(report))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--verify-only", action="store_true", help="Reconstruct and validate in memory; no filesystem writes")
    run(parser.parse_args().verify_only)
