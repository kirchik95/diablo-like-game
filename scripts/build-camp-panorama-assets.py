#!/usr/bin/env python3
"""Draw the camp panorama package programmatically; --verify-only never writes.

Every prop and the far mountain backdrop are rendered from fixed geometry,
fixed seeds and one explicit palette per image. No image generation, network
or dependency installation is involved. Paths resolve from this script, so a
copied checkout verifies against its own files. Output is confined to
assets/game/pixel-v9/camp-panorama (the geometry contract there is an input).
"""

import argparse
import base64
import hashlib
import io
import json
import math
from pathlib import Path
import random
import sys

from PIL import Image, ImageDraw, ImageMath, __version__ as PILLOW_VERSION


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/game/pixel-v9/camp-panorama"
CONTRACT = "assets/game/pixel-v9/camp-panorama/source/footprints.json"
INPUTS = {
    "contract": CONTRACT,
    "concept": "assets/concepts/camp-location-01/camp-scene.png",
    "landscapeAtlas": "assets/game/pixel-v4/landscape/landscape.png",
    "campAtlas": "assets/game/pixel-v5/camp/camp.png",
    "monkAtlas": "assets/game/pixel-v2/monk/monk-v2.png",
    "monkManifest": "assets/game/pixel-v2/monk/manifest.json",
    "countryGrass": "assets/game/pixel-v6/country/grass.png",
    "countrySoil": "assets/game/pixel-v6/country/soil.png",
}
FRAMES = ["tripod-kettle", "woven-carpet", "outcrop-block", "outcrop-pair", "outcrop-cluster",
          "outcrop-cliff", "outcrop-wall-x", "outcrop-wall-y", "outcrop-slab", "ruin-pillar",
          "cypress-tall", "cypress-medium", "cypress-pair", "bush-round", "bush-large",
          "crate", "sack-pair", "grass-tuft", "fern-tuft", "boulder-round", "outcrop-crag", "outcrop-ledge-x",
          "ruin-stump", "ruin-fallen"]
CELL, COLUMNS, ROWS, ANCHOR = 256, 4, 6, (128, 232)
LAST_ROW = 231
BACKDROP_SIZE = (2048, 1280)

# One shared prop palette. Ramps were tuned against the median-cut samples of
# the named concept/atlas regions in SAMPLE_REGIONS (recorded in palette.json).
PALETTE = {
    "OUT": "#0e121d", "DEEP": "#1f2737", "DEEP2": "#2d2f40",
    # Rock: warm lit tops, slate sides, blue-green bounce light in the shadows.
    "Q_HI": "#c9b79b", "Q_W1": "#b09c82", "Q_T1": "#9f9280", "Q_T2": "#877d72", "Q_T3": "#6c6564",
    "Q_L1": "#706968", "Q_L2": "#5c5258", "Q_M": "#4a4753", "Q_S1": "#3d3e4c", "Q_S2": "#30344a",
    "Q_AMB": "#3c4b52",
    "M_HI": "#9a9358", "M1": "#7d7b4f", "M2": "#626445", "M3": "#4a523f",
    "F_HI": "#6a8278", "F1": "#43686a", "F2": "#2b5257", "F3": "#1b3e4c", "F4": "#0f2b3c", "F5": "#081a2b",
    "B_HI": "#6f8467", "B1": "#4f6759", "B2": "#37504b", "B3": "#263c3e",
    "T1": "#6e4f45", "T2": "#4a3438", "T3": "#2f2230",
    "W_HI": "#b4754b", "W1": "#8d5c48", "W2": "#6b453e", "W3": "#573a3a", "W4": "#352430",
    "K_HI": "#efdcb4", "K1": "#d7bd94", "K2": "#b49a78", "K3": "#8c7660", "K4": "#63524a",
    "R1": "#74404a", "R2": "#5c303c", "R3": "#45202e", "R_EDGE": "#2a1520",
    "Y1": "#b8935c", "Y2": "#8c6c46", "Y3": "#d3bb8f",
    "I_HI": "#8a8c98", "I1": "#5c5e6b", "I2": "#3b3c4a",
    "G_HI": "#6f8a64", "G1": "#4c6a55", "G2": "#33504a", "G3": "#203842",
}
BACKDROP_PALETTE = {  # sky, clouds, then far / mid / near ridges, each with its own valley haze
    "SKY0": "#5d6d88", "SKY1": "#66778f", "SKY2": "#6f8097", "SKY3": "#7a8a9f",
    "CL_HI": "#e0d3b6", "CL1": "#c4bba5", "CL2": "#9ea2a3",
    "FA_HI": "#cbb594", "FA_LIT": "#9c9d9c", "FA_MID": "#74829a", "FA_SH": "#637391", "FA_DK": "#576786", "FA_HZ": "#7d8ca2",
    "MI_HI": "#8a958f", "MI_LIT": "#687c90", "MI_MID": "#546882", "MI_SH": "#485b77", "MI_DK": "#3e506b", "MI_HZ": "#65788e",
    "NE_HI": "#66796f", "NE_LIT": "#50665f", "NE_MID": "#43585a", "NE_SH": "#374b53", "NE_DK": "#2d404b", "NE_HZ": "#4c5f6b",
    "TR1": "#1f3a44", "TR2": "#152b37", "BASE": "#2a3a45",
}
SAMPLE_REGIONS = {
    "concept stone cliff": ("concept", [1090, 590, 1400, 780]),
    "concept west outcrop": ("concept", [90, 300, 300, 500]),
    "concept cypress group": ("concept", [1000, 560, 1120, 820]),
    "concept bushes": ("concept", [700, 130, 900, 220]),
    "concept carpet": ("concept", [560, 500, 800, 620]),
    "concept crates and sacks": ("concept", [550, 475, 740, 600]),
    "concept ruined pillar": ("concept", [560, 90, 640, 220]),
    "concept grass tufts": ("concept", [400, 600, 600, 700]),
    "concept packed earth": ("concept", [760, 380, 890, 510]),
    "concept road": ("concept", [440, 200, 570, 330]),
    "concept meadow": ("concept", [560, 560, 690, 690]),
    "concept mountains right": ("concept", [1150, 0, 1512, 180]),
    "concept mountains left": ("concept", [640, 0, 1000, 90]),
    "landscape cypress": ("landscapeAtlas", [0, 0, 160, 160]),
    "landscape rock": ("landscapeAtlas", [320, 0, 480, 160]),
    "camp supply cache": ("campAtlas", [256, 256, 512, 512]),
    "camp road marker": ("campAtlas", [512, 0, 768, 256]),
}

SQ2 = math.sqrt(2)
KX, KY, KZ = 16 * SQ2, 8 * SQ2, 32 * math.sin(math.pi / 3)
RIGHT = (-1 / SQ2, 1 / SQ2, 0.0)
UP = (-SQ2 / 4, -SQ2 / 4, math.sqrt(3) / 2)
VIEW = (math.sqrt(6) / 4, math.sqrt(6) / 4, 0.5)


def _normalize(v):
    length = math.sqrt(sum(c * c for c in v))
    return tuple(c / length for c in v)


LIGHT = _normalize(tuple(-0.62 * r + 0.5 * u + 0.6 * w for r, u, w in zip(RIGHT, UP, VIEW)))


def hexrgb(value):
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))


def read_json(path):
    return json.loads(path.read_text())


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def pixels(image):
    return list(image.get_flattened_data())


def load_rgba(path):
    with Image.open(path) as image:
        return image.convert("RGBA")


def png_bytes(image):
    buffer = io.BytesIO()
    image.save(buffer, "PNG", optimize=False, compress_level=9)
    return buffer.getvalue()


def ihash(x, y, salt):
    n = (x * 374761393 + y * 668265263 + salt * 1442695041) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFFFFFF) / 4294967296


def vnoise(x, y, salt, period=None):
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    wrap = (lambda n: n % period) if period else (lambda n: n)
    a, b = ihash(wrap(ix), iy, salt), ihash(wrap(ix + 1), iy, salt)
    c, d = ihash(wrap(ix), iy + 1, salt), ihash(wrap(ix + 1), iy + 1, salt)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy


# --------------------------------------------------------------------------
# Sprite renderer: exact orthographic 2:1 rays into boxes, ellipsoids and rods.
# --------------------------------------------------------------------------

TOP, LEFT, RIGHT_FACE, ROUND, ROD = 1, 2, 3, 4, 5


class Canvas:
    def __init__(self, contact):
        self.cx, self.cy = contact
        size = CELL * CELL
        self.color = [None] * size
        self.depth = [-1e9] * size
        self.oid = [0] * size
        self.face = [0] * size
        self.style = [None] * size
        self.next_oid = 1

    def new_oid(self):
        self.next_oid += 1
        return self.next_oid

    def project(self, x, y, z):
        return self.cx + KX * (y - x), self.cy + KY * (x + y) - KZ * z

    def put(self, px, py, depth, color, oid, face, style):
        if not (0 <= px < CELL and 0 <= py <= LAST_ROW):
            return
        i = py * CELL + px
        if depth > self.depth[i]:
            self.depth[i], self.color[i], self.oid[i] = depth, color, oid
            self.face[i], self.style[i] = face, style

    def bounds(self, points, pad=1):
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        return (max(0, math.floor(min(xs)) - pad), min(CELL - 1, math.ceil(max(xs)) + pad),
                max(0, math.floor(min(ys)) - pad), min(LAST_ROW, math.ceil(max(ys)) + pad))

    def box(self, x0, x1, y0, y1, z0, z1, shade, style, oid=None):
        """Visible top/+x/+y faces of an axis-aligned box. shade(face, x, y, z) -> colour."""
        oid = oid or self.new_oid()
        corners = [self.project(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
        left, right, top, bottom = self.bounds(corners)
        for py in range(top, bottom + 1):
            dv = py + 0.5 - self.cy
            for px in range(left, right + 1):
                t = (px + 0.5 - self.cx) / KX
                s = (dv + KZ * z1) / KY
                x, y, z, face = (s - t) / 2, (s + t) / 2, z1, TOP
                if not (x0 <= x < x1 and y0 <= y < y1):
                    x, y = x1, x1 + t
                    z, face = (KY * (x1 + y) - dv) / KZ, LEFT
                    if not (y0 <= y < y1 and z0 <= z < z1):
                        x, y = y1 - t, y1
                        z, face = (KY * (x + y1) - dv) / KZ, RIGHT_FACE
                        if not (x0 <= x < x1 and z0 <= z < z1):
                            continue
                depth = VIEW[0] * x + VIEW[1] * y + VIEW[2] * z
                self.put(px, py, depth, shade(face, x, y, z), oid, face, style)
        return oid

    def ellipsoid(self, c, r, shade, style, oid=None, floor=0.0):
        """Ray-cast an axis-aligned ellipsoid; shade(normal, point) -> colour."""
        oid = oid or self.new_oid()
        pcx, pcy = self.project(*c)
        reach = max(r) * 32 + 2
        left, right, top, bottom = self.bounds([(pcx - reach, pcy - reach), (pcx + reach, pcy + reach)], 0)
        w = (VIEW[0] / r[0], VIEW[1] / r[1], VIEW[2] / r[2])
        a = w[0] * w[0] + w[1] * w[1] + w[2] * w[2]
        for py in range(top, bottom + 1):
            sv = -(py + 0.5 - self.cy) / 32
            for px in range(left, right + 1):
                su = (px + 0.5 - self.cx) / 32
                p0 = (su * RIGHT[0] + sv * UP[0], su * RIGHT[1] + sv * UP[1], sv * UP[2])
                q = ((p0[0] - c[0]) / r[0], (p0[1] - c[1]) / r[1], (p0[2] - c[2]) / r[2])
                b = q[0] * w[0] + q[1] * w[1] + q[2] * w[2]
                disc = b * b - a * (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] - 1)
                if disc < 0:
                    continue
                t = (-b + math.sqrt(disc)) / a
                p = (p0[0] + t * VIEW[0], p0[1] + t * VIEW[1], p0[2] + t * VIEW[2])
                if p[2] < floor:
                    continue
                n = _normalize(((p[0] - c[0]) / r[0] ** 2, (p[1] - c[1]) / r[1] ** 2, (p[2] - c[2]) / r[2] ** 2))
                self.put(px, py, t, shade(n, p), oid, ROUND, style)
        return oid

    def rod(self, a, b, width, colors, style, oid=None):
        """A thin pole between two world points, lit on its screen-left edge."""
        oid = oid or self.new_oid()
        pa, pb = self.project(*a), self.project(*b)
        steps = max(2, int(math.hypot(pb[0] - pa[0], pb[1] - pa[1]) * 3))
        for i in range(steps + 1):
            f = i / steps
            p = tuple(a[k] + (b[k] - a[k]) * f for k in range(3))
            sx, sy = self.project(*p)
            depth = sum(VIEW[k] * p[k] for k in range(3))
            for k in range(width):
                color = colors[0] if k == 0 else colors[1] if k < width - 1 or width == 1 else colors[2]
                self.put(math.floor(sx) + k - width // 2, math.floor(sy), depth + 0.001 * (width - k), color, oid, ROD, style)
        return oid

    def finish(self, outline=True, seam=True, highlight=True, outline_color="OUT"):
        color, face, oid, depth, style = self.color, self.face, self.oid, self.depth, self.style
        result = color[:]
        for i, c in enumerate(color):
            if c is None:
                continue
            x, y = i % CELL, i // CELL
            st = style[i] or {}
            if seam and st.get("seam"):
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < CELL and 0 <= ny < CELL:
                        j = ny * CELL + nx
                        if color[j] is not None and oid[j] != oid[i] and depth[j] > depth[i] + st.get("seamGap", 0.04):
                            result[i] = st["seam"]
                            break
            if highlight and st.get("edge") and face[i] == LEFT and x + 1 < CELL:
                j = i + 1
                if color[j] is not None and oid[j] == oid[i] and face[j] == RIGHT_FACE and result[i] not in ("DEEP2", "M2"):
                    result[i] = st["edge"]
            if highlight and st.get("hi") and face[i] == TOP and y + 1 < CELL:
                j = i + CELL
                if color[j] is not None and oid[j] == oid[i] and face[j] in (LEFT, RIGHT_FACE):
                    result[i] = st["hi"]
        if outline:
            ring = []
            for i, c in enumerate(result):
                if c is not None:
                    continue
                x, y = i % CELL, i // CELL
                if y > LAST_ROW:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    j = ny * CELL + nx
                    # Flat litter lies in the ground; it never gets a silhouette outline.
                    if 0 <= nx < CELL and 0 <= ny < CELL and result[j] is not None and not (style[j] or {}).get("flat"):
                        ring.append(i)
                        break
            for i in ring:
                result[i] = outline_color
        return result


def to_image(colors, palette=PALETTE):
    image = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    rgb = {name: hexrgb(value) + (255,) for name, value in palette.items()}
    image.putdata([rgb[c] if c else (0, 0, 0, 0) for c in colors])
    return image


# ----------------------------- materials ---------------------------------

STONE_RAMPS = {  # cut stone of the ruined pillar
    "warm": {"hi": "Q_HI", "top": "Q_T1", "top2": "Q_T2", "top3": "Q_T3", "l1": "Q_L1", "l2": "Q_L2",
             "r1": "Q_S1", "r2": "Q_S2"},
    "cool": {"hi": "Q_HI", "top": "Q_T2", "top2": "Q_T3", "top3": "Q_T3", "l1": "Q_L2", "l2": "Q_M",
             "r1": "Q_S1", "r2": "Q_S2"},
}


def moss_at(x, y, salt, amount):
    m = vnoise(x * 2.7 + 11.3, y * 2.7 - 4.1, salt) * 0.7 + vnoise(x * 8.5, y * 8.5, salt + 3) * 0.3
    return m - (1 - amount)


def fissures(rng, length, count):
    """Positions along a face (world units) of vertical joints in cut stone."""
    result = []
    for _ in range(count):
        if length < 0.5:
            break
        result.append((rng.uniform(0.18, length - 0.18), rng.uniform(0.45, 1.0)))
    return result


def stone(block, salt, ramp="warm", moss=0.4, dark=False, columns=True):
    x0, x1, y0, y1, z0, z1 = block
    r = STONE_RAMPS[ramp]
    height = max(z1 - z0, 1e-6)
    rng = random.Random(salt * 31 + 5)
    drip = 0.05 + 0.1 * rng.random()
    count = int(height > 0.7) + int(height > 1.6) + int(rng.random() < 0.5)
    left_joints = fissures(rng, y1 - y0, count if columns else 0)
    right_joints = fissures(rng, x1 - x0, count if columns else 0)
    bevel = 0.045

    def joint(along, joints, z):
        return any(abs(along - q) < 0.024 and z > z1 - height * reach for q, reach in joints)

    def shade(face, x, y, z):
        if face == TOP:
            m = moss_at(x, y, salt, moss)
            if m > 0.24:
                return "M_HI" if m > 0.4 else "M1"
            if m > 0.12:
                return "M2"
            n = vnoise(x * 10.5, y * 10.5, salt + 9)
            return r["top3"] if n < 0.1 else r["top2"] if n > 0.74 else r["top"]
        if face == LEFT:
            if z1 - z < drip and moss_at(x1 - 0.06, y, salt, moss) > 0.16:
                return "M2"
            if z1 - z < bevel:
                return r["top2"]
            if joint(y - y0, left_joints, z):
                return "DEEP2"
            f = (z - z0) / height
            w = vnoise((y - y0) * 4.2 + salt, z * 3.4, salt + 17)
            if w > 0.76:
                return r["r1"] if dark else r["l2"]
            if w < 0.12 and not dark:
                return r["top3"]
            return r["l2"] if f < 0.22 or dark else r["l1"]
        if z1 - z < drip * 0.8 and moss_at(x, y1 - 0.06, salt, moss) > 0.16:
            return "M3"
        if z1 - z < bevel:
            return r["l2"]
        if joint(x - x0, right_joints, z):
            return "DEEP"
        f = (z - z0) / height
        w = vnoise((x - x0) * 4.2 - salt, z * 3.4, salt + 23)
        if w > 0.78:
            return r["r2"]
        return r["r2"] if f < 0.3 or dark else r["r1"]
    return shade, {"seam": "DEEP2", "hi": r["hi"], "edge": r["top2"], "seamGap": 0.03}


def stone_box(cv, block, salt, ramp="warm", moss=0.4, dark=False, columns=True):
    shade, style = stone(block, salt, ramp, moss, dark, columns)
    return cv.box(*block, shade, style)


def stack(cv, column, salt, ramp, moss, joints):
    """A column of cut blocks with small lateral offsets at each joint."""
    x0, x1, y0, y1, z0, z1 = column
    rng = random.Random(salt * 7 + 3)
    levels = [z0] + sorted(joints) + [z1]
    for k in range(len(levels) - 1):
        ox, oy = (rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05)) if k else (0, 0)
        inset = 0.03 * k
        top_moss = moss if k == len(levels) - 2 else moss * 0.4
        stone_box(cv, (x0 + inset + ox, x1 - inset + ox, y0 + inset + oy, y1 - inset + oy, levels[k], levels[k + 1]),
                  salt * 13 + k, ramp, top_moss, dark=rng.random() < 0.15)


# ------------------------------ natural rock --------------------------------
# Outcrops are heightfields: rounded, chipped and cracked blocks merged with
# max(). Every ground sample is splatted as a vertical run of pixels into a
# local z-buffer, then shaded from the field's normal. One oid per block keeps
# a dark seam where a nearer block overlaps a farther one.

ROCK_GRID = 48  # field samples per world unit, about two per screen pixel


class Rock:
    """One weathered block: a rounded plan rectangle with a bevelled, chipped top."""

    def __init__(self, x0, x1, y0, y1, h, salt, base=0.0, moss=0.5, corner=0.26, bevel=0.16, steep=24.0,
                 wobble=0.06, tilt=(0.0, 0.0), chips=3, cracks=2, warm=False):
        self.cx, self.cy, self.hx, self.hy = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
        self.box = (x0, x1, y0, y1)
        self.h, self.base, self.salt, self.moss, self.warm = h, base, salt, moss, warm
        self.corner = min(corner, self.hx * 0.9, self.hy * 0.9)
        self.bevel, self.steep, self.wobble, self.tilt = bevel, steep, wobble, tilt
        rng = random.Random(salt * 97 + 13)
        # Chips bite into the top edge, most often at a corner.
        self.chips = []
        for _ in range(chips):
            roll = rng.random()
            if roll < 0.55:
                px, py = rng.choice((x0, x1)), rng.choice((y0, y1))
            elif roll < 0.8:
                px, py = rng.choice((x0, x1)), rng.uniform(y0, y1)
            else:
                px, py = rng.uniform(x0, x1), rng.choice((y0, y1))
            self.chips.append((px, py, rng.uniform(0.14, 0.3), rng.uniform(0.1, min(0.42, h * 0.4))))
        # Bedding joints cross the faces at one or two heights.
        self.strata = [base + h * rng.uniform(0.3, 0.7) for _ in range(1 if h < 1.2 else 2)] if h > 0.45 else []
        # Fissures open down from the top of the two visible faces.
        self.cracks = []
        for _ in range(cracks):
            face = rng.choice(("x", "y"))
            lo, hi = (y0, y1) if face == "x" else (x0, x1)
            if hi - lo > 0.55:
                self.cracks.append((face, rng.uniform(lo + 0.22, hi - 0.22), rng.uniform(0.3, 0.75) * h))

    def top(self, x, y):
        return (self.base + self.h + self.tilt[0] * (x - self.cx) + self.tilt[1] * (y - self.cy)
                + 0.06 * (vnoise(x * 4.0, y * 4.0, self.salt + 2) - 0.5))

    def edge(self, x, y):
        """Signed plan distance to the weathered outline, negative inside."""
        # The screen-side corners stay sharp: they carry the footprint's left
        # and right ground contact. Front and back corners are well rounded.
        rc = self.corner if (x - self.cx) * (y - self.cy) >= 0 else min(self.corner, 0.07)
        qx, qy = abs(x - self.cx) - (self.hx - rc), abs(y - self.cy) - (self.hy - rc)
        d = math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - rc
        # Noise only pulls the outline inwards, so the base never leaves its
        # footprint, and it calms near the side corners that carry the contact.
        x0, x1, y0, y1 = self.box
        side = min(math.hypot(x - x1, y - y0), math.hypot(x - x0, y - y1))
        wobble = self.wobble * (0.3 + 0.7 * min(1.0, side / 0.45))
        return d + wobble * (0.7 * vnoise(x * 3.3 + 7.1, y * 3.3, self.salt) + 0.3 * vnoise(x * 11, y * 11, self.salt + 1))

    def height(self, x, y):
        d = self.edge(x, y)
        if d >= 0:
            return None
        e, top, b = -d, self.top(x, y), self.bevel
        z = top - b + math.sqrt(max(0.0, b * b - (b - e) ** 2)) if e < b else top
        z = min(z, self.base + e * self.steep)
        for px, py, r, depth in self.chips:
            q = math.hypot(x - px, y - py) / r
            if q < 1:
                z = min(z, top - depth * min(1.0, (1 - q) * 3.0))
        x1, y1 = self.box[1], self.box[3]
        for face, pos, length in self.cracks:
            if (face == "x" and x > x1 - 0.12 and abs(y - pos) < 0.024) or (face == "y" and y > y1 - 0.12 and abs(x - pos) < 0.024):
                z = min(z, top - length)
        return max(z, self.base)


class Boulder(Rock):
    """A lone rounded stone: a flattened dome with a few planar facets."""

    def __init__(self, cx, cy, radius, h, salt, moss=0.45, chips=2):
        super().__init__(cx - radius, cx + radius, cy - radius, cy + radius, h, salt, moss=moss, chips=0, cracks=0)
        self.radius = radius
        rng = random.Random(salt * 31 + 7)
        self.facets = [(math.cos(a), math.sin(a), rng.uniform(0.55, 0.75))
                       for a in (rng.uniform(0, math.tau) + k * math.tau / 5 for k in range(5))]
        self.chips = [(cx + radius * 0.8 * math.cos(a), cy + radius * 0.8 * math.sin(a), rng.uniform(0.12, 0.2), rng.uniform(0.08, 0.16))
                      for a in (rng.uniform(0, math.tau) for _ in range(chips))]

    def edge(self, x, y):
        a = math.atan2(y - self.cy, x - self.cx)
        wobble = 0.05 * (vnoise(a * 2.2 + 3.0, 0.5, self.salt) + 0.5 * vnoise(a * 5.0, 1.5, self.salt + 1))
        return math.hypot(x - self.cx, y - self.cy) - self.radius * (1 - wobble)

    def height(self, x, y):
        d = self.edge(x, y)
        if d >= 0:
            return None
        t = min(1.0, math.hypot(x - self.cx, y - self.cy) / (self.radius + 1e-9))
        z = self.h * min(1.0, 1.15 * (1 - t ** 2.4) ** 0.55) + 0.05 * (vnoise(x * 5, y * 5, self.salt + 2) - 0.5)
        dx, dy = x - self.cx, y - self.cy
        for fx, fy, k in self.facets:  # planar cuts give the dome flat, faceted shoulders
            z = min(z, self.h * (1.0 + k) - (dx * fx + dy * fy) / self.radius * self.h * 1.6)
        for px, py, r, depth in self.chips:
            q = math.hypot(x - px, y - py) / r
            if q < 1:
                z = min(z, self.h - depth * min(1.0, (1 - q) * 3.0))
        return max(0.0, min(z, -d * 9.0))


def rock_field(rocks):
    x0 = min(r.box[0] for r in rocks) - 0.06
    x1 = max(r.box[1] for r in rocks) + 0.06
    y0 = min(r.box[2] for r in rocks) - 0.06
    y1 = max(r.box[3] for r in rocks) + 0.06
    nx, ny = math.ceil((x1 - x0) * ROCK_GRID) + 1, math.ceil((y1 - y0) * ROCK_GRID) + 1
    height, owner = [0.0] * (nx * ny), [-1] * (nx * ny)
    for j in range(ny):
        y = y0 + j / ROCK_GRID
        for i in range(nx):
            x = x0 + i / ROCK_GRID
            best, who = 0.0, -1
            for k, rock in enumerate(rocks):
                bx0, bx1, by0, by1 = rock.box
                if bx0 <= x <= bx1 and by0 <= y <= by1:
                    z = rock.height(x, y)
                    if z is not None and (who < 0 or z > best):
                        best, who = z, k
            height[j * nx + i], owner[j * nx + i] = best, who
    return {"x0": x0, "y0": y0, "nx": nx, "ny": ny, "h": height, "owner": owner}


def field_at(f, i, j):
    if 0 <= i < f["nx"] and 0 <= j < f["ny"]:
        return f["h"][j * f["nx"] + i]
    return 0.0


def field_xy(f, x, y):
    return field_at(f, round((x - f["x0"]) * ROCK_GRID), round((y - f["y0"]) * ROCK_GRID))


def rock_tone(f, rocks, i, j, z, is_top, k):
    rock = rocks[k]
    x, y = f["x0"] + i / ROCK_GRID, f["y0"] + j / ROCK_GRID
    zt = field_at(f, i, j)
    hx = (field_at(f, i + 1, j) - field_at(f, i - 1, j)) * ROCK_GRID / 2
    hy = (field_at(f, i, j + 1) - field_at(f, i, j - 1)) * ROCK_GRID / 2
    n = _normalize((-hx, -hy, 1.0))
    # Gentle field is surface (tops, rims, boulder flanks); steep field is a wall.
    is_top = n[2] > 0.3
    if not is_top:
        n = _normalize((-hx, -hy, 0.0)) if abs(hx) + abs(hy) > 1e-6 else (SQ2 / 2, SQ2 / 2, 0.0)
    b = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]
    mossy = moss_at(x, y, rock.salt, rock.moss)
    if is_top and n[2] > 0.8:
        if mossy > 0.24:
            return ("M_HI" if mossy > 0.42 else "M1"), TOP
        if mossy > 0.12:
            return "M2", TOP
        mottle = vnoise(x * 9.5, y * 9.5, rock.salt + 9)
        if mottle < 0.14:
            return "Q_T3", TOP
        if mottle > 0.74:
            return "Q_T2", TOP
        return ("Q_W1" if rock.warm else "Q_T1"), TOP
    if is_top:  # rounded rims, shoulders and boulder flanks
        if b > 0.9:
            return "Q_HI", TOP
        if b > 0.72:
            return ("Q_W1" if rock.warm else "Q_T1"), TOP
        if b > 0.5:
            return ("Q_T2" if mossy < 0.1 else "M2"), TOP
        if b > 0.3:
            return "Q_L1", LEFT
        if b > 0.05:
            return "Q_M", RIGHT_FACE
        return "Q_S1", RIGHT_FACE
    # A wall: dark where the field just outside it stands higher (a crevice).
    nh = _normalize((n[0], n[1], 0.0)) if abs(n[0]) + abs(n[1]) > 1e-6 else (SQ2 / 2, SQ2 / 2, 0.0)
    outside = max(field_xy(f, x + nh[0] * 0.07, y + nh[1] * 0.07), field_xy(f, x + nh[0] * 0.15, y + nh[1] * 0.15))
    # Slopes fall away from their own top; a gap or fissure rises past it.
    if outside > z + 0.45 and outside > zt + 0.1:
        return "DEEP", RIGHT_FACE
    if outside > z + 0.08 and outside > zt - 0.25:
        return "DEEP2", RIGHT_FACE
    if zt - z < 0.07 + 0.08 * vnoise(x * 7, y * 7, rock.salt + 5) and mossy > 0.16:
        return ("M2" if b > 0.2 else "M3"), (LEFT if b > 0.2 else RIGHT_FACE)
    along = y if abs(n[0]) > abs(n[1]) else x
    grain = vnoise(along * 4.2 + rock.salt, z * 3.0, rock.salt + 17) * 0.7 + vnoise(along * 12.0, z * 10.0, rock.salt + 19) * 0.3
    low = z - rock.base < 0.16
    if any(abs(z - level) < 0.022 for level in rock.strata) and vnoise(along * 2.6, 0.5, rock.salt + 21) > 0.3:
        return ("Q_S1" if b > 0.3 else "Q_S2"), (LEFT if b > 0.3 else RIGHT_FACE)
    if b > 0.3:
        if grain > 0.78:
            return "Q_M", LEFT
        if grain < 0.1:
            return "Q_T3", LEFT
        return ("Q_L2" if low or grain > 0.6 else "Q_L1"), LEFT
    if b > -0.05:
        return ("Q_S1" if low else "Q_M" if grain < 0.55 else "Q_L2"), RIGHT_FACE
    if z < 0.22 and grain > 0.35:
        return "Q_AMB", RIGHT_FACE
    return ("Q_S2" if low or grain > 0.72 else "Q_S1"), RIGHT_FACE


def draw_rocks(cv, rocks):
    f = rock_field(rocks)
    nx, ny = f["nx"], f["ny"]
    oids = [cv.new_oid() for _ in rocks]
    best = {}
    for j in range(ny):
        y = f["y0"] + j / ROCK_GRID
        for i in range(nx):
            k = f["owner"][j * nx + i]
            if k < 0:
                continue
            x = f["x0"] + i / ROCK_GRID
            zt = f["h"][j * nx + i]
            zl = min(field_at(f, i + 1, j), field_at(f, i, j + 1), field_at(f, i + 1, j + 1))
            # Paint down to the lowest front neighbour, so steep slopes leave no holes.
            zl = max(0.0, zl - 0.02) if zt - zl > 0.01 else zt
            sx, top_row = cv.project(x, y, zt)
            bottom_row = cv.project(x, y, zl)[1]
            px = math.floor(sx)
            if not 0 <= px < CELL:
                continue
            for row in range(math.floor(top_row), math.floor(bottom_row) + 1):
                if not 0 <= row <= LAST_ROW:
                    continue
                z = min(zt, max(zl, (cv.cy + KY * (x + y) - (row + 0.5)) / KZ))
                depth = VIEW[0] * x + VIEW[1] * y + VIEW[2] * z
                index = row * CELL + px
                if index not in best or depth > best[index][0]:
                    best[index] = (depth, i, j, z, row == math.floor(top_row), k)
    style = {"seam": "DEEP2", "seamGap": 0.03}
    for index, (depth, i, j, z, is_top, k) in best.items():
        color, face = rock_tone(f, rocks, i, j, z, is_top, k)
        cv.put(index % CELL, index // CELL, depth, color, oids[k], face, style)


def base_grass(cv, points, salt):
    """A few blades in front of a stone's foot, rooted on its footprint edge."""
    rng = random.Random(salt)
    oid = cv.new_oid()
    for x, y in points:
        bx, by = cv.project(x, y, 0)
        for _ in range(rng.randint(3, 6)):
            ox = rng.uniform(-5, 5)
            length = rng.randint(4, 8)
            lean = rng.uniform(-0.45, 0.45)
            for step in range(length):
                f = step / length
                color = "G_HI" if f > 0.7 else "G1" if f > 0.3 else "G2"
                cv.put(math.floor(bx + ox + lean * step), math.floor(by - 1 - step), 50.0, color, oid, ROD, {"flat": True})


# ------------------------------ props -------------------------------------

def draw_outcrop_block(cv):
    draw_rocks(cv, [Rock(-0.55, 0.55, -0.55, 0.55, 0.52, 101, moss=0.45, corner=0.3, chips=3, cracks=1),
                    Rock(-0.48, 0.24, -0.46, 0.28, 0.22, 102, base=0.5, moss=0.62, corner=0.2, chips=2, cracks=0, warm=True,
                         tilt=(0.08, -0.05))])
    base_grass(cv, [(0.5, 0.2), (0.2, 0.52)], 103)


def draw_outcrop_pair(cv):
    draw_rocks(cv, [Rock(-0.7, 0.7, -1.1, -0.02, 0.86, 111, moss=0.45, tilt=(0.06, 0.04), corner=0.26),
                    Rock(-0.7, 0.7, 0.06, 1.1, 0.6, 113, moss=0.5, tilt=(-0.05, 0.08), warm=True, corner=0.3)])
    base_grass(cv, [(0.65, 0.5), (0.4, 1.05), (0.6, -0.5)], 115)


def draw_outcrop_cluster(cv):
    """One broad rounded mass stepping down to the front."""
    draw_rocks(cv, [Rock(-1.3, 0.22, -1.3, 0.3, 1.25, 121, moss=0.55, tilt=(0.08, -0.05), cracks=2, corner=0.26, bevel=0.2),
                    Rock(-1.1, -0.2, -1.12, -0.3, 0.24, 126, base=1.2, moss=0.75, cracks=0, warm=True, corner=0.3),
                    Rock(-1.3, -0.04, 0.36, 1.3, 0.78, 122, moss=0.5, warm=True, corner=0.26),
                    Rock(0.28, 1.3, -1.3, 1.3, 0.52, 124, moss=0.6, corner=0.26, tilt=(-0.06, 0.04))])
    base_grass(cv, [(1.25, 0.6), (0.7, 1.25), (1.25, -0.9), (-0.6, 1.25)], 127)


def draw_outcrop_cliff(cv):
    rocks = [
        Rock(-1.6, -0.2, -1.4, 0.2, 2.6, 131, moss=0.35, cracks=3, corner=0.26), Rock(-1.5, -0.6, -1.3, -0.4, 0.22, 132, base=2.56, moss=0.75, cracks=0, warm=True),
        Rock(-1.58, -0.1, 0.26, 1.4, 1.85, 133, moss=0.4, warm=True, corner=0.3, tilt=(-0.08, 0.0)),
        Rock(-0.12, 1.6, -1.4, 0.0, 1.6, 135, moss=0.45, tilt=(-0.1, 0.05), cracks=2, corner=0.26),
        Rock(0.0, 1.6, 0.06, 1.4, 0.85, 138, moss=0.55, warm=True, corner=0.26),
    ]
    draw_rocks(cv, rocks)
    base_grass(cv, [(1.55, 0.3), (1.0, 1.35), (1.55, -0.9), (-0.9, 1.35)], 141)


def draw_wall(cv, along_x):
    spans = [(-2.0, -0.62, 1.0), (-0.6, 0.72, 1.6), (0.74, 2.0, 0.8)]
    depths = [(-0.8, 0.8), (-0.8, 0.8), (-0.8, 0.8)]
    salt = 161 if along_x else 171
    rocks = []
    for k, (a0, a1, h) in enumerate(spans):
        b0, b1 = depths[k]
        box = (a0, a1, b0, b1) if along_x else (b0, b1, a0, a1)
        rocks.append(Rock(*box, h, salt + k * 5, moss=0.5, warm=k == 1, corner=0.26, cracks=2))
    cap = (-0.4, 0.4, -0.6, 0.5) if along_x else (-0.6, 0.5, -0.4, 0.4)
    rocks.append(Rock(*cap, 0.26, salt + 30, base=1.56, moss=0.7, cracks=0, warm=True, corner=0.3))
    draw_rocks(cv, rocks)
    base_grass(cv, [(1.98, 0.3), (0.6, 0.78), (-1.2, 0.78)] if along_x else [(0.3, 1.98), (0.78, 0.6), (0.78, -1.2)], salt + 40)


def draw_outcrop_slab(cv):
    draw_rocks(cv, [Rock(-1.4, 0.12, -1.0, 0.02, 0.4, 181, moss=0.6, corner=0.3, cracks=1, tilt=(0.04, 0.02)),
                    Rock(0.16, 1.4, -1.0, 0.22, 0.28, 182, moss=0.65, corner=0.26, warm=True),
                    Rock(-1.4, 0.66, 0.06, 1.0, 0.22, 183, moss=0.7, corner=0.26, cracks=1),
                    Rock(0.7, 1.4, 0.3, 1.0, 0.15, 184, moss=0.5, corner=0.22, chips=1, cracks=0, warm=True)])
    base_grass(cv, [(1.3, 0.62), (0.2, 1.0)], 185)


def draw_outcrop_crag(cv):
    """A weathered crag: one tall leaning shoulder over two low steps."""
    draw_rocks(cv, [Rock(-1.2, 0.2, -1.0, 0.3, 1.5, 311, moss=0.4, tilt=(0.16, -0.1), cracks=2, corner=0.26),
                    Rock(-1.1, -0.36, -0.9, -0.2, 0.3, 312, base=1.46, moss=0.65, tilt=(0.2, -0.1), corner=0.26, warm=True, cracks=0),
                    Rock(-1.2, 1.2, 0.36, 1.0, 0.62, 313, moss=0.55, tilt=(0.0, 0.06), corner=0.26),
                    Rock(0.26, 1.2, -1.0, 0.3, 0.95, 314, moss=0.45, warm=True, tilt=(-0.1, 0.0), corner=0.26)])
    base_grass(cv, [(1.15, 0.5), (0.5, 0.98), (1.15, -0.7)], 317)


def draw_outcrop_ledge_x(cv):
    """A long low ledge along world x for continuous walls."""
    spans = [(-2.4, -0.82, 0.66), (-0.8, 0.86, 0.92), (0.88, 2.4, 0.52)]
    rocks = []
    for k, (a0, a1, h) in enumerate(spans):
        b0, b1 = -0.9 + 0.06 * (k % 2), 0.9
        rocks.append(Rock(a0, a1, b0, b1, h, 321 + k, moss=0.55, warm=k == 1, tilt=(0.0, 0.05 * (k - 1)), corner=0.26))
    rocks.append(Rock(-0.5, 0.5, -0.7, 0.4, 0.2, 326, base=0.88, moss=0.75, cracks=0, warm=True, corner=0.3))
    draw_rocks(cv, rocks)
    base_grass(cv, [(2.3, 0.5), (1.0, 0.9), (-0.8, 0.9), (2.3, -0.6)], 328)


def draw_boulder_round(cv):
    draw_rocks(cv, [Boulder(0.0, 0.0, 0.6, 0.74, 331, moss=0.5)])
    base_grass(cv, [(0.45, 0.25), (0.15, 0.55)], 332)


def draw_ruin_pillar(cv):
    stone_box(cv, (-0.8, 0.8, -0.8, 0.8, 0, 0.18), 191, "warm", 0.55, columns=False)
    stone_box(cv, (-0.62, 0.62, -0.62, 0.62, 0.18, 0.42), 192, "cool", 0.5, columns=False)
    blocks = [(-0.44, 0.44, -0.46, 0.4, 0.42, 1.15), (-0.47, 0.39, -0.4, 0.45, 1.15, 1.86),
              (-0.4, 0.43, -0.43, 0.42, 1.86, 2.55), (-0.37, 0.4, -0.39, 0.35, 2.55, 3.05)]
    for k, block in enumerate(blocks):
        stone_box(cv, block, 193 + k, "warm" if k % 2 == 0 else "cool", 0.22 if k < 3 else 0.6)
    stone_box(cv, (-0.3, 0.12, -0.32, 0.2, 3.05, 3.2), 199, "warm", 0.7, columns=False)
    for k, (x, y, s) in enumerate([(0.62, 0.15, 0.16), (0.2, 0.62, 0.13), (0.66, -0.45, 0.11), (-0.5, 0.66, 0.1)]):
        stone_box(cv, (x - s, x + s, y - s, y + s, 0.0, 0.18 + s * 0.6), 200 + k, "cool", 0.3, columns=False)


def draw_ruin_stump(cv):
    """A road marker: the pillar broken above its first drum, rubble on the plinth."""
    stone_box(cv, (-0.9, 0.9, -0.9, 0.9, 0, 0.16), 341, "warm", 0.62, columns=False)
    stone_box(cv, (-0.66, 0.66, -0.66, 0.66, 0.16, 0.38), 342, "cool", 0.5, columns=False)
    stone_box(cv, (-0.45, 0.43, -0.46, 0.42, 0.38, 1.02), 343, "warm", 0.3)
    # The break: a high and a low shard of the second drum.
    stone_box(cv, (-0.47, 0.4, -0.42, 0.0, 1.02, 1.42), 344, "cool", 0.55, columns=False)
    stone_box(cv, (-0.47, -0.05, 0.0, 0.43, 1.02, 1.2), 345, "warm", 0.65, columns=False)
    for k, (x, y, s) in enumerate([(0.68, 0.32, 0.17), (0.3, 0.7, 0.13), (0.72, -0.5, 0.12), (-0.55, 0.7, 0.11)]):
        stone_box(cv, (x - s, x + s, y - s, y + s, 0.16, 0.3 + s * 0.6), 346 + k, "cool", 0.3, columns=False)
    base_grass(cv, [(0.9, 0.3), (0.4, 0.9), (0.9, -0.6)], 351)


def draw_ruin_fallen(cv):
    """A toppled column along world x: capital, two drums and the sunk broken base."""
    draw_rocks(cv, [
        Rock(-1.6, -0.98, -0.55, 0.55, 0.66, 361, moss=0.55, corner=0.12, bevel=0.1, chips=2, cracks=1, warm=True),
        Rock(-0.94, -0.12, -0.42, 0.4, 0.58, 362, moss=0.45, corner=0.3, bevel=0.2, chips=2, cracks=1, tilt=(0.0, 0.04)),
        Rock(-0.08, 0.86, -0.38, 0.44, 0.55, 363, moss=0.5, corner=0.3, bevel=0.2, chips=3, cracks=1, warm=True,
             tilt=(0.05, 0.0)),
        Rock(0.92, 1.6, -0.55, 0.55, 0.42, 364, moss=0.65, corner=0.14, bevel=0.12, chips=2, cracks=0),
    ])
    base_grass(cv, [(1.55, 0.3), (0.5, 0.5), (-0.6, 0.5), (1.55, -0.4)], 365)


def draw_crate(cv):
    """Weathered planked box in the supply-cache browns: battens, joints and grain."""
    a, h = 0.45, 0.8

    def shade(face, x, y, z):
        if face == TOP:
            if abs(y + 0.15) < 0.035 or abs(y - 0.15) < 0.035:
                return "W4"
            if abs(x) > a - 0.07 or abs(y) > a - 0.07:
                return "W2"
            return "W3" if vnoise(x * 3.0, y * 24.0, 301) > 0.78 else "W1"
        along = y if face == LEFT else x
        if abs(z - 0.27) < 0.028 or abs(z - 0.53) < 0.028:
            return "W4"
        if abs(along) > a - 0.08:
            return "W1" if face == LEFT else "W2"
        grain = vnoise(along * 3.0, z * 26.0, 302 if face == LEFT else 303) > 0.76
        if face == LEFT:
            return "W3" if grain else "W2"
        return "W4" if grain else "W3"
    cv.box(-a, a, -a, a, 0, h, shade, {"seam": "W4", "hi": "W_HI"})


FOLIAGE = {"cypress": ("F_HI", "F1", "F2", "F3", "F4", "F5"), "bush": ("B_HI", "B1", "B2", "B3", "F4", "F5")}


def tuft(cv, sx, sy, width, height, tone, ramp, depth, oid, pointed):
    """One hand-pixel foliage tuft: lit upper-left rim, darker right/lower rim."""
    top = sy - height / 2
    for row in range(math.floor(top), math.ceil(sy + height / 2)):
        t = (row + 0.5 - top) / height
        if not 0 <= t <= 1:
            continue
        half = width / 2 * (t ** 0.55 if pointed else math.sin(math.pi * min(1.0, 0.18 + t * 0.82)) ** 0.45)
        if t > 0.74:
            half *= math.sqrt(max(0.0, 1 - ((t - 0.74) / 0.26) ** 2 * 0.75))
        if half < 0.5:
            continue
        for col in range(math.floor(sx - half + 0.5), math.floor(sx + half + 0.5)):
            edge_left = col < sx - half + 1.5
            edge_right = col >= sx + half - 1.5
            level = tone
            if t > 0.9:
                level = tone + 2
            elif edge_right or t > 0.72:
                level = tone + 1
            elif edge_left and t < 0.7:
                level = tone - 1
            cv.put(col, row, depth, ramp[max(0, min(5, level))], oid, ROUND, None)


def foliage_surface(cv, centre, radius, z, theta, slope):
    """Point and normal on a vertical solid of revolution, theta 0 = towards the camera."""
    vx, vy = 1 / SQ2, 1 / SQ2
    rx, ry = RIGHT[0], RIGHT[1]
    dx = math.cos(theta) * vx + math.sin(theta) * rx
    dy = math.cos(theta) * vy + math.sin(theta) * ry
    point = (centre[0] + dx * radius, centre[1] + dy * radius, z)
    normal = _normalize((dx, dy, slope))
    return point, normal


def ground_patch(cv, centre, radius, salt, colors=("F3", "F4", "T2")):
    """Flat litter under a plant, filling the projected footprint ellipse."""
    oid = cv.new_oid()
    px, py = cv.project(centre[0], centre[1], 0)
    for row in range(math.floor(py - 16 * radius) - 1, math.ceil(py + 16 * radius) + 1):
        for col in range(math.floor(px - 32 * radius) - 1, math.ceil(px + 32 * radius) + 1):
            dx, dy = (col + 0.5 - px) / (32 * radius), (row + 0.5 - py) / (16 * radius)
            edge = 1.0 + (ihash(col // 2, row, salt) - 0.5) * 0.3
            d = dx * dx + dy * dy
            if d <= edge:
                tone = colors[1] if d < 0.3 else colors[2] if ihash(col, row, salt + 1) < 0.1 else colors[0]
                cv.put(col, row, -9.0, tone, oid, TOP, {"flat": True})


def roots(cv, base, radius, salt, angles=(45, -45, 135, -100, 10)):
    rng = random.Random(salt)
    for angle in angles:
        a = math.radians(angle + rng.uniform(-6, 6))
        tip = (base[0] + math.cos(a) * radius * 0.96, base[1] + math.sin(a) * radius * 0.96, 0.0)
        cv.rod((base[0], base[1], 0.1), tip, 2, ("T1", "T2", "T2"), {"seam": "T3"})


def draw_cypress(cv, base, height, width, salt, lean=(0.0, 0.0), trunk=0.75, core=None):
    rng = random.Random(salt)
    bx, by = base
    ramp = FOLIAGE["cypress"]
    if core:
        roots(cv, base, core, salt + 5)
    bark = lambda face, x, y, z: "T1" if face == LEFT else "T2"
    tw = 0.085
    cv.box(bx - tw, bx + tw, by - tw, by + tw, 0, trunk + 0.4, bark, {"seam": "T3"})
    cv.box(bx - tw - 0.05, bx + tw + 0.05, by - tw - 0.05, by + tw + 0.04, 0, 0.1, bark, {"seam": "T3"})
    z0 = trunk * 0.62

    def radius(z):
        s = (z - z0) / (height - z0)
        if s <= 0 or s >= 1:
            return 0.0
        return width * (math.sin(math.pi * s ** 0.6) ** 0.8) * (1 - 0.15 * s)

    def axis(z):
        f = max(0.0, z - z0) / height
        return bx + lean[0] * f * f, by + lean[1] * f * f

    oid = cv.new_oid()
    body = lambda n, p: ramp[4] if n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2] > 0 else ramp[5]
    z = z0 + 0.1
    while z < height - 0.2:
        rz = radius(z)
        ax, ay = axis(z)
        cv.ellipsoid((ax, ay, z), (rz * 0.86, rz * 0.86, max(0.2, rz * 0.6)), body, None, oid=oid)
        z += 0.25
    tufts = []
    z, ring = z0 + 0.25, 0
    while z < height - 0.1:
        rz = max(0.1, radius(z))
        ax, ay = axis(z)
        slope = (radius(z - 0.15) - radius(z + 0.15)) / 0.3
        w = 6.0 + 4.0 * min(1.0, rz / 0.7)
        count = max(2, round(math.tau * rz * 32 / (w * 0.9)))
        phase = rng.random() * math.tau
        for k in range(count):
            theta = phase + k * math.tau / count
            theta = (theta + math.pi) % math.tau - math.pi
            if abs(theta) > 1.75:
                continue
            gap = vnoise(theta * 2.2 + 9, z * 2.4, salt + 41)
            if gap < 0.2 and abs(theta) < 1.3:
                continue
            point, normal = foliage_surface(cv, (ax, ay), rz * rng.uniform(0.88, 1.05), z + rng.uniform(-0.12, 0.12),
                                            theta, slope + 0.25)
            sx, sy = cv.project(*point)
            depth = sum(VIEW[i] * point[i] for i in range(3)) + 0.5
            size = w * rng.uniform(0.8, 1.15) * (0.8 + 0.4 * gap)
            side = 0 if theta < -1.0 else 1 if theta < -0.35 else 2 if theta < 0.3 else 3 if theta < 0.95 else 4
            if rng.random() < 0.18:
                side += rng.choice((-1, 1))
            side = max(0, min(4, side - (1 if z > height * 0.6 and side > 1 and rng.random() < 0.35 else 0)))
            tufts.append((depth, sx, sy, size, size * 1.85, side))
        z += 0.3 + 0.07 * rng.random()
        ring += 1
    tip = axis(height)
    tx, ty = cv.project(tip[0], tip[1], height - 0.18)
    tufts.append((9.0, tx, ty, 4.0, 9.0, 2))
    for depth, sx, sy, w, h, tone in sorted(tufts):
        tuft(cv, sx, sy, w, h, tone, ramp, depth, oid, True)


def draw_cypress_tall(cv):
    ground_patch(cv, (0, 0), 0.5, 212)
    draw_cypress(cv, (0, 0), 7.6, 0.66, 211, lean=(-0.06, 0.05), core=0.5)


def draw_cypress_medium(cv):
    ground_patch(cv, (0, 0), 0.42, 222)
    draw_cypress(cv, (0, 0), 5.85, 0.5, 221, lean=(0.05, -0.04), trunk=0.65, core=0.42)


def draw_cypress_pair(cv):
    ground_patch(cv, (0, 0), 0.8, 233)
    draw_cypress(cv, (0.42, -0.45), 7.0, 0.58, 231, lean=(-0.05, -0.07))
    draw_cypress(cv, (-0.36, 0.36), 5.6, 0.52, 232, lean=(0.06, 0.07), trunk=0.6)
    roots(cv, (0.42, -0.45), 0.5, 234, angles=(10, -45, -100, 60))
    roots(cv, (-0.36, 0.36), 0.5, 235, angles=(135, 80, 30, 170))


def draw_bush(cv, lobes, salt):
    rng = random.Random(salt)
    ramp = FOLIAGE["bush"]
    oid = cv.new_oid()
    body = lambda n, p: ramp[3] if n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2] > 0.2 else ramp[4]
    tufts = []
    for li, (lx, ly, lr, lh) in enumerate(lobes):
        cv.ellipsoid((lx, ly, lh * 0.3), (lr * 0.92, lr * 0.92, lh * 0.5), body, None, oid=oid)
        rows = max(3, int(lh / 0.2)) + 1
        for row in range(rows):
            e = (row - 0.5) / (rows - 1) if row else 0.0
            z = lh * (0.06 + 0.9 * math.sin(e * math.pi / 2)) if row else 0.05
            rr = (lr * math.cos(e * 1.35) * 0.95 + 0.06) if row else lr * 0.98
            w = 11.0 + 5.0 * lr
            count = max(1, round(math.tau * rr * 32 / (w * 0.85)))
            phase = rng.random() * math.tau
            for k in range(count):
                theta = (phase + k * math.tau / count + math.pi) % math.tau - math.pi
                if abs(theta) > 1.8:
                    continue
                point, normal = foliage_surface(cv, (lx, ly), rr, z, theta, 0.6 + e * 2.2)
                sx, sy = cv.project(*point)
                depth = sum(VIEW[i] * point[i] for i in range(3)) + 0.4
                size = w * rng.uniform(0.8, 1.15)
                side = 1 if theta < -0.5 else 2 if theta < 0.45 else 3
                if e > 0.6 and side > 1:
                    side -= 1
                if e < 0.25:
                    side += 1
                if rng.random() < 0.15:
                    side = max(1, side + rng.choice((-1, 1)))
                tufts.append((depth, sx, sy, size, size * 0.9, min(4, side)))
    for depth, sx, sy, w, h, tone in sorted(tufts):
        tuft(cv, sx, sy, w, h, tone, ramp, depth, oid, False)


def draw_bush_round(cv):
    draw_bush(cv, [(0, 0, 0.68, 1.05)], 241)


def draw_bush_large(cv):
    # Lobes balanced about the contact: screen-left, centre and screen-right.
    draw_bush(cv, [(0.05, 0.05, 0.74, 1.55), (0.52, -0.3, 0.52, 1.05), (-0.3, 0.52, 0.5, 1.0)], 251)


def sack_shade(n, p):
    b = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]
    return "K_HI" if b > 0.82 else "K1" if b > 0.45 else "K2" if b > 0.05 else "K3"


def draw_sack(cv, x, y, s, lean):
    """A sagging grain bag: wide base, narrow shoulders, tied neck and a gathered tuft."""
    style = {"seam": "K4", "seamGap": 0.04}
    body = cv.ellipsoid((x, y, 0.16 * s), (0.34 * s, 0.31 * s, 0.22 * s), sack_shade, style)
    cv.ellipsoid((x + lean[0] * s, y + lean[1] * s, 0.33 * s), (0.24 * s, 0.22 * s, 0.13 * s), sack_shade, style, oid=body)
    nx, ny = x + lean[0] * 1.7 * s, y + lean[1] * 1.7 * s
    neck = cv.ellipsoid((nx, ny, 0.46 * s), (0.075 * s, 0.075 * s, 0.08 * s), lambda n, p: "K2" if n[0] - n[1] > 0 else "K3", style)
    sx, sy = cv.project(nx, ny, 0.49 * s)
    bx, by = math.floor(sx), math.floor(sy)
    for row in (0, 1):
        for dx in range(-3, 3):
            cv.put(bx + dx, by + row, 9.0, "K4", neck, ROD, style)
    # Gathered cloth above the tie: a short fan of folds.
    for k, dx in enumerate((-3, -2, -1, 0, 1, 2)):
        height = (2, 4, 3, 5, 3, 2)[k]
        for up in range(1, height + 1):
            cv.put(bx + dx + (1 if up > 3 and dx > 0 else -1 if up > 3 and dx < 0 else 0), by - up, 9.5,
                   "K_HI" if dx < 0 and up > 1 else "K1" if up > 1 else "K2", neck, ROD, style)
    # Creases fall from the tie over the lit front of the bag.
    for k, spread in enumerate((-0.75, 0.05, 0.8)):
        for step in range(26):
            f = step / 25
            z = (0.38 - 0.32 * f) * s
            a = math.pi / 4 + spread * (0.25 + 0.75 * f)
            reach = (0.1 + 0.24 * f) * s
            px, py = cv.project(x + lean[0] * s * (1 - f) + reach * math.cos(a), y + lean[1] * s * (1 - f) + reach * math.sin(a), z)
            i = math.floor(py) * CELL + math.floor(px)
            if 0 <= i < CELL * CELL and cv.oid[i] == body:
                cv.color[i] = "K3" if cv.color[i] in ("K1", "K2") else "K4"


def draw_sack_pair(cv):
    draw_sack(cv, 0.3, -0.01, 1.12, (-0.04, -0.06))
    draw_sack(cv, -0.01, 0.3, 0.95, (0.06, 0.04))


def draw_tripod(cv):
    apex = (0.0, 0.0, 1.7)
    # Legs stand at the front and both screen sides of the 0.5u footprint.
    feet = [(0.5 * math.cos(a), 0.5 * math.sin(a), 0.0) for a in (math.radians(-45), math.radians(135), math.radians(45))]
    feet.sort(key=lambda p: p[0] + p[1])
    for foot in feet:
        over = tuple(apex[k] + (apex[k] - foot[k]) * 0.13 for k in range(3))
        cv.rod(foot, over, 3, ("W1", "W2", "W4"), {"seam": "W4"})
    style = {"seam": "I2", "seamGap": 0.04}

    def iron(n, p):
        b = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]
        return "I_HI" if b > 0.75 else "I1" if b > 0.25 else "I2"
    pot = cv.ellipsoid((0.0, 0.0, 0.22), (0.31, 0.31, 0.21), iron, style)
    rim = cv.ellipsoid((0.0, 0.0, 0.39), (0.25, 0.25, 0.05), lambda n, p: "I_HI" if n[2] > 0.6 else "I1", style)
    cv.ellipsoid((0.0, 0.0, 0.415), (0.19, 0.19, 0.02), lambda n, p: "OUT", style)
    for k in range(9):
        a = math.pi * k / 8
        p = (0.24 * math.cos(a + math.pi / 4) * 1.0, 0.24 * math.cos(a + math.pi / 4) * -1.0, 0.41 + 0.22 * math.sin(a))
        sx, sy = cv.project(*p)
        cv.put(math.floor(sx), math.floor(sy), sum(VIEW[i] * p[i] for i in range(3)) - 0.2, "I2", rim, ROD, style)
    for k in range(15):
        z = 0.64 + k * (apex[2] - 0.66) / 15
        sx, sy = cv.project(0.0, 0.0, z)
        cv.put(math.floor(sx), math.floor(sy), 2.0, "I1" if k % 2 else "I2", pot, ROD, style)


def carpet_color(x, y):
    a, b, body = 2.2, 3.0, 2.84
    if abs(y) > body:
        strand = (math.floor((x + a) * 9.0)) % 2 == 0
        return ("Y3" if abs(y) < body + 0.1 else "K2") if strand and abs(x) < a - 0.08 else None
    ex, ey = a - abs(x), body - abs(y)
    edge = min(ex, ey)
    if edge < 0.07:
        return "R_EDGE"
    if edge < 0.46:
        # Border band: running diamonds along the band's centre line.
        along = (y + body) if ex > ey else (x + a)
        across = edge - 0.07
        phase = (along * 2.6) % 1.0
        tri = abs(phase - 0.5) * 2
        if abs(across - 0.195) < 0.11 * (1 - tri) + 0.02:
            return "R3" if abs(across - 0.195) < 0.05 * (1 - tri) else "Y1"
        return "Y2"
    if edge < 0.55:
        return "Y3"
    if edge < 0.62:
        return "R3"
    # Field with a central medallion and a quiet repeated lozenge lattice.
    m = abs(x) / 1.15 + abs(y) / 1.75
    if m < 0.32:
        return "Y1" if m > 0.2 else "R3"
    if m < 0.5:
        return "R1"
    if 0.62 < m < 0.7:
        return "Y2"
    lattice = (abs(((x + y) * 1.6) % 1.0 - 0.5) < 0.06) or (abs(((y - x) * 1.6) % 1.0 - 0.5) < 0.06)
    if lattice and m > 0.8:
        return "R3"
    return "R2" if m > 0.7 else "R1"


def draw_carpet(cv):
    oid = cv.new_oid()
    a, b = 2.2, 3.0
    corners = [cv.project(x, y, 0) for x in (-a, a) for y in (-b, b)]
    left, right, top, bottom = cv.bounds(corners)
    for py in range(top, bottom + 1):
        dv = py + 0.5 - cv.cy
        for px in range(left, right + 1):
            t = (px + 0.5 - cv.cx) / KX
            s = dv / KY
            x, y = (s - t) / 2, (s + t) / 2
            if -a <= x < a and -b <= y < b:
                c = carpet_color(x, y)
                if c:
                    cv.put(px, py, x + y, c, oid, TOP, None)


def draw_tuft(cv, salt, fern=False):
    rng = random.Random(salt)
    oid = cv.new_oid()
    cx = cv.cx
    if fern:
        bx, by = cv.project(0, 0, 0)
        for k in range(8):
            angle = math.radians(-168 + k * 22 + rng.uniform(-6, 6))
            length = rng.uniform(16, 22) * (0.82 + 0.18 * abs(math.cos(angle)))
            droop = rng.uniform(0.12, 0.28)
            steps = int(length * 1.5)
            for j in range(steps + 1):
                f = j / steps
                x = bx + math.cos(angle) * length * f
                y = by - 1 + math.sin(angle) * length * f * 0.95 + droop * length * f * f
                cv.put(math.floor(x), math.floor(y), 1.0 + k * 0.01, "G2" if f < 0.45 else "G1", oid, ROD, None)
                if j % 3 == 1 and 0.15 < f < 0.92:
                    nx, ny = -math.sin(angle), math.cos(angle) * 0.8
                    leaf = 2 if f < 0.7 else 1
                    for side, color in ((1, "G1"), (-1, "G_HI")):
                        for q in range(1, leaf + 1):
                            cv.put(math.floor(x + nx * q * side), math.floor(y + ny * q * side - q * 0.6),
                                   1.0 + k * 0.01, color, oid, ROD, None)
        return
    for k in range(15):
        angle = (k + rng.uniform(-0.3, 0.3)) / 15 * math.tau
        rr = rng.uniform(0.0, 0.26)
        bx, by = cv.project(math.cos(angle) * rr, math.sin(angle) * rr, 0)
        length = rng.uniform(11, 21) * (1.15 if abs(math.sin(angle)) < 0.5 else 0.9)
        lean = rng.uniform(-0.55, 0.55) + (bx - cx) * 0.06
        for j in range(int(length)):
            f = j / length
            x = bx + lean * j * (0.6 + f)
            y = by - j
            color = "G_HI" if f > 0.72 else "G1" if f > 0.32 else "G2"
            cv.put(math.floor(x), math.floor(y), -y + k * 0.01, color, oid, ROD, None)


DRAW = {
    "tripod-kettle": draw_tripod, "woven-carpet": draw_carpet,
    "outcrop-block": draw_outcrop_block, "outcrop-pair": draw_outcrop_pair,
    "outcrop-cluster": draw_outcrop_cluster, "outcrop-cliff": draw_outcrop_cliff,
    "outcrop-wall-x": lambda cv: draw_wall(cv, True), "outcrop-wall-y": lambda cv: draw_wall(cv, False),
    "outcrop-slab": draw_outcrop_slab, "ruin-pillar": draw_ruin_pillar,
    "cypress-tall": draw_cypress_tall, "cypress-medium": draw_cypress_medium, "cypress-pair": draw_cypress_pair,
    "bush-round": draw_bush_round, "bush-large": draw_bush_large,
    "crate": draw_crate, "sack-pair": draw_sack_pair,
    "grass-tuft": lambda cv: draw_tuft(cv, 271), "fern-tuft": lambda cv: draw_tuft(cv, 281, fern=True),
    "boulder-round": draw_boulder_round, "outcrop-crag": draw_outcrop_crag, "outcrop-ledge-x": draw_outcrop_ledge_x,
    "ruin-stump": draw_ruin_stump, "ruin-fallen": draw_ruin_fallen,
}


# --------------------------------------------------------------------------
# Far backdrop: three ridges painted back to front in screen space.
# Image column c is u = U0 + (c + .5) / 32, row r is v = V0 + (r + .5) / 32.
# Each ridge is a crest line; below it, facets take the light from the slope of
# the crest smoothed wider with depth, so spurs merge into broad flanks. Valley
# haze lies in horizontal dithered bands at each ridge's foot.
# --------------------------------------------------------------------------

BACK_U0, BACK_V0, BACK_PERIOD = -20.0, -40.0, 64.0
# Near-ridge crest, just behind the camp rim (layout horizon minus 1.2-2.4u),
# as periodic control points (u, v) across the 64u wrap.
NEAR_CREST = [(-20.0, -10.8), (-12.0, -11.4), (-5.0, -11.8), (0.0, -11.5), (3.3, -10.9), (7.5, -10.2),
              (11.67, -9.4), (15.34, -7.4), (17.68, -6.9), (22.0, -6.3), (26.0, -5.8), (30.0, -5.4),
              (33.0, -5.5), (38.0, -8.0)]
RIDGES = [  # name, offset above the near crest, roughness, peaks (u, rise, half-width), haze depth, salt
    ("FA", 2.3, 0.8, [(12.0, 2.6, 4.2), (17.5, 1.2, 2.4), (0.6, 2.0, 3.6), (5.6, 1.0, 2.2), (25.5, 2.2, 4.0),
                      (31.5, 1.4, 2.8), (39.0, 1.8, 3.6), (-9.0, 2.4, 4.4), (-15.0, 1.2, 3.0)], 1.7, 11),
    ("MI", 1.2, 0.5, [(-3.0, 0.9, 3.0), (7.8, 0.7, 2.6), (20.0, 1.0, 3.2), (28.5, 0.6, 2.4), (-13.0, 0.8, 3.0),
                      (35.0, 0.8, 2.6)], 1.2, 23),
    ("NE", 0.0, 0.3, [(1.5, 0.35, 2.0), (14.0, 0.45, 1.8), (24.0, 0.35, 2.2), (-8.0, 0.45, 2.4), (36.0, 0.3, 1.6)], 2.6, 37),
]
SMOOTHING = [0.22, 0.4, 0.62, 0.9, 1.25, 1.7, 2.3]  # facet scale (u) by depth below the crest
CLOUDS = [  # u, v (base line), length in units: low wisps against the far ridge, a few higher in the sky
    (9.4, -14.9, 2.6), (14.6, -16.3, 1.9), (3.2, -16.6, 2.2), (21.8, -14.6, 2.0), (28.5, -15.6, 2.4),
    (-3.5, -16.0, 2.0), (36.0, -14.2, 1.8), (6.0, -20.5, 3.4), (18.0, -22.5, 2.8), (31.0, -19.8, 3.0),
    (-10.0, -21.5, 3.2), (40.5, -24.0, 2.4),
]
BAYER = [[0.0, 0.5], [0.75, 0.25]]


def periodic_curve(points, width):
    """Catmull-Rom through periodic (u, v) control points, one value per image column."""
    pts = sorted(points)
    n = len(pts)
    ext = [(u - BACK_PERIOD, v) for u, v in pts[-2:]] + pts + [(u + BACK_PERIOD, v) for u, v in pts[:2]]
    result = []
    for c in range(width):
        u = BACK_U0 + (c + 0.5) / 32
        k = next(i for i in range(1, len(ext) - 2) if ext[i][0] <= u < ext[i + 1][0])
        (u0, p0), (u1, p1), (u2, p2), (u3, p3) = ext[k - 1], ext[k], ext[k + 1], ext[k + 2]
        t = (u - u1) / (u2 - u1)
        m1 = (p2 - p0) / (u2 - u0) * (u2 - u1)
        m2 = (p3 - p1) / (u3 - u1) * (u2 - u1)
        t2, t3 = t * t, t * t * t
        result.append((2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2)
    assert n >= 4
    return result


def periodic_noise(u, salt, octaves=((0.5, 0.55), (1.3, 0.3), (3.1, 0.15))):
    """Fractal value noise in [-1, 1] that repeats every BACK_PERIOD units."""
    total = 0.0
    for freq, amp in octaves:
        cells = max(1, round(BACK_PERIOD * freq))
        x = (u - BACK_U0) / BACK_PERIOD * cells
        total += (vnoise(x, 0.5, salt, period=cells) * 2 - 1) * amp
    return total


def ridge_crest(name, offset, rough, peaks, salt, near, width):
    crest = []
    for c in range(width):
        u = BACK_U0 + (c + 0.5) / 32
        v = near[c] - offset - rough * (0.6 + periodic_noise(u, salt))
        for pu, rise, half in peaks:
            du = (u - pu + BACK_PERIOD / 2) % BACK_PERIOD - BACK_PERIOD / 2
            q = abs(du) / half
            if q < 1:  # slightly concave flanks under a sharp summit
                v -= rise * (1 - q) ** 1.35
        crest.append(v)
    return crest


def box_blur(values, radius):
    width, total = len(values), 0.0
    if radius < 1:
        return values[:]
    window = 2 * radius + 1
    for k in range(-radius, radius + 1):
        total += values[k % width]
    result = []
    for c in range(width):
        result.append(total / window)
        total += values[(c + radius + 1) % width] - values[(c - radius) % width]
    return result


def backdrop():
    width, height = BACKDROP_SIZE
    near = periodic_curve(NEAR_CREST, width)
    color = ["SKY0"] * (width * height)
    layer_of = [None] * (width * height)
    for r in range(height):
        v = BACK_V0 + (r + 0.5) / 32
        for c in range(width):
            # Two dithered rows soften each sky band edge.
            w = v + (BAYER[r % 2][c % 2] - 0.375) * 0.12
            color[r * width + c] = "SKY0" if w < -27 else "SKY1" if w < -21.5 else "SKY2" if w < -17.5 else "SKY3"
    for name, offset, rough, peaks, haze, salt in RIDGES:
        crest = ridge_crest(name, offset, rough, peaks, salt, near, width)
        # Twice-blurred crests approximate a smooth kernel at each facet scale.
        smoothed = [box_blur(box_blur(crest, round(w * 16)), round(w * 16)) for w in SMOOTHING]
        for c in range(width):
            u = BACK_U0 + (c + 0.5) / 32
            skew = 0.45 * periodic_noise(u, salt + 5, ((0.15, 1.0),))
            top = math.floor((crest[c] - BACK_V0) * 32)
            for r in range(max(0, top), height):
                v = BACK_V0 + (r + 0.5) / 32
                y = v - crest[c]
                if y < 0:
                    continue
                level = min(len(SMOOTHING) - 1, int(y / 0.4))
                cs = smoothed[level]
                col = round(c + skew * y * 32) % width
                slope = (cs[(col + 2) % width] - cs[(col - 2) % width]) * 8.0  # dv/du
                # Rising to the right faces the light from the upper left.
                t = -slope * (1.6 if name == "FA" else 1.25) + BAYER[r % 2][c % 2] * 0.16 - 0.08
                if name != "FA":
                    t += 0.12 * periodic_noise(u * 3.0 + y * 0.7, salt + 9, ((1.0, 1.0),))
                tone = ("HI" if t > 0.95 and y < (1.8 if name == "FA" else 0.6) else "LIT" if t > 0.32
                        else "MID" if t > -0.12 else "SH" if t > -0.55 else "DK")
                # Valley haze: horizontal dithered bands at the ridge's foot.
                band = y - haze - 0.25 * periodic_noise(u, salt + 7, ((0.4, 1.0),))
                if band > 0.55 or (band > 0 and BAYER[r % 2][c % 2] < band / 0.55):
                    tone = "HZ"
                color[r * width + c] = name + "_" + tone
                layer_of[r * width + c] = name
        if name == "NE":
            draw_far_trees(color, crest, width, height)
    draw_clouds(color, layer_of, width, height)
    # The lowest rows are one flat colour so clamped sampling never shows an edge.
    for r in range(height - 24, height):
        for c in range(width):
            color[r * width + c] = "BASE"
    image = Image.new("RGBA", (width, height))
    rgb = {name: hexrgb(value) + (255,) for name, value in BACKDROP_PALETTE.items()}
    image.putdata([rgb[name] for name in color])
    return image


def draw_clouds(color, layer_of, width, height):
    """Small flat-bottomed wisps, lit from the left, in front of the sky and the far ridge only."""
    rng = random.Random(907)
    for u, v, length in CLOUDS:
        cx, base = (u - BACK_U0) * 32, (v - BACK_V0) * 32
        count = max(3, int(length * 2.6))
        bumps = []
        for k in range(count):
            f = k / (count - 1) - 0.5
            bumps.append((cx + f * length * 32 * 0.92 + rng.uniform(-4, 4), rng.uniform(5, 9) * (1 - abs(f) * 1.1) + 2))
        for x in range(math.floor(cx - length * 20), math.ceil(cx + length * 20)):
            c = x % width
            for bx, br in bumps:
                dx = x + 0.5 - bx
                if abs(dx) >= br * 1.6:
                    continue
                hgt = math.sqrt(max(0.0, (br * 1.6) ** 2 - dx * dx)) * 0.32
                for r in range(math.floor(base - hgt), math.floor(base) + 1):
                    if not 0 <= r < height or layer_of[r * width + c] in ("MI", "NE"):
                        continue
                    i = r * width + c
                    rel = (base - r) / max(1.0, hgt)
                    shade = "CL2" if base - r < 1 else "CL_HI" if rel > 0.45 and dx < br * 0.4 else "CL1"
                    if color[i] != "CL_HI" or shade == "CL_HI":
                        color[i] = shade


def draw_far_trees(color, crest, width, height):
    """Rows of tiny dark cypress silhouettes along the near ridge."""
    rng = random.Random(911)
    c = 0
    while c < width:
        c += rng.randint(3, 8) if rng.random() < 0.78 else rng.randint(20, 60)
        column = c % width
        base = math.floor((crest[column] - BACK_V0) * 32) + rng.randint(4, 26)
        h = rng.randint(9, 19)
        w = max(3, round(h / 3.2))
        for row in range(h):
            t = (row + 0.5) / h
            half = w * (t ** 0.8) / 2
            r = base - h + row
            for dx in range(-math.ceil(half), math.ceil(half) + 1):
                if abs(dx) > half + 0.25 or not 0 <= r < height:
                    continue
                color[r * width + (column + dx) % width] = "TR1" if dx < 0 and t < 0.85 else "TR2"


def draw_frame(name, contract):
    cv = Canvas(contract["frames"][name]["contactCenter"])
    DRAW[name](cv)
    if name == "woven-carpet":
        colors = cv.finish(outline=False, seam=False, highlight=False)
    elif name in ("grass-tuft", "fern-tuft"):
        colors = cv.finish(outline=True, seam=False, highlight=False, outline_color="G3")
    else:
        colors = cv.finish()
    return to_image(colors)


# --------------------------------------------------------------------------
# Ground surfaces: 128 px = 4u tiles sampled at worldXZ / 4 with repeat.
# Image column = world +x, image row = world -y (textures load with invertY),
# so the screen's upper-left light falls on the +row side of small details.
# --------------------------------------------------------------------------

SURFACE = 128
SURFACE_PALETTES = {
    "campEarth": {"E_HI": "#ddbd95", "E1": "#cfac84", "E2": "#c39f76", "E3": "#b5916b", "E4": "#a5835f",
                  "E5": "#82664c", "E6": "#6c5440", "P_HI": "#ddd2bf", "P1": "#b4a795", "P2": "#8c8072", "P_SH": "#635850"},
    "campGrass": {"G_D2": "#58553c", "G_D1": "#666243", "G_B": "#74704a", "G_G": "#70764a", "G_L": "#827c50",
                  "G_H1": "#948c55", "G_H2": "#a89f5d", "G_SH": "#454a34"},
}
SURFACE_TARGETS = {"campEarth": (190, 155, 115), "campGrass": (115, 111, 75)}


def tile_noise(x, y, grid, salt):
    """Value noise that repeats every SURFACE pixels on both axes."""
    gx, gy = x / SURFACE * grid, y / SURFACE * grid
    ix, iy = math.floor(gx), math.floor(gy)
    fx, fy = gx - ix, gy - iy
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = ihash(ix % grid, iy % grid, salt), ihash((ix + 1) % grid, iy % grid, salt)
    c, d = ihash(ix % grid, (iy + 1) % grid, salt), ihash((ix + 1) % grid, (iy + 1) % grid, salt)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy


def patch_value(x, y, salt):
    return (0.45 * tile_noise(x + 0.5, y + 0.5, 8, salt) + 0.35 * tile_noise(x + 0.5, y + 0.5, 16, salt + 1)
            + 0.2 * tile_noise(x + 0.5, y + 0.5, 32, salt + 2))


def surface_image(names, palette):
    image = Image.new("RGB", (SURFACE, SURFACE))
    rgb = {name: hexrgb(value) for name, value in palette.items()}
    image.putdata([rgb[name] for name in names])
    return image


def camp_earth():
    rng = random.Random(1201)
    names = []
    for y in range(SURFACE):
        for x in range(SURFACE):
            v = patch_value(x, y, 1210)
            tone = "E1" if v > 0.66 else "E2" if v > 0.39 else "E3" if v > 0.27 else "E4"
            h = ihash(x, y, 1213)
            if h < 0.016 and tone != "E4":
                tone = "E_HI"
            elif h < 0.034:
                tone = "E3" if tone in ("E1", "E2") else "E4"
            names.append(tone)

    def at(x, y):
        return (y % SURFACE) * SURFACE + x % SURFACE

    for _ in range(4):  # sparse hairline cracks, wrapping across the tile edges
        x, y = rng.uniform(0, SURFACE), rng.uniform(0, SURFACE)
        angle = rng.uniform(0, math.tau)
        for step in range(rng.randint(10, 24)):
            names[at(math.floor(x), math.floor(y))] = "E6" if rng.random() < 0.12 else "E5"
            angle += rng.uniform(-0.45, 0.45)
            x += math.cos(angle)
            y += math.sin(angle)
            if rng.random() < 0.06:
                angle += rng.choice((-1.2, 1.2))
    for _ in range(13):  # small pebbles lit on their +row side
        cx, cy = rng.randrange(SURFACE), rng.randrange(SURFACE)
        rx, ry = rng.uniform(0.9, 2.2), rng.uniform(0.8, 1.7)
        for dy in range(-3, 4):
            for dx in range(-3, 4):
                if (dx / rx) ** 2 + (dy / ry) ** 2 <= 1:
                    tone = "P_HI" if dy >= ry * 0.35 and dx <= 0 else "P2" if dy < -ry * 0.3 else "P1"
                    names[at(cx + dx, cy + dy)] = tone
        names[at(cx, cy - math.ceil(ry) - 1)] = "P_SH"
    return surface_image(names, SURFACE_PALETTES["campEarth"])


def camp_grass():
    rng = random.Random(1301)
    names = []
    for y in range(SURFACE):
        for x in range(SURFACE):
            v = patch_value(x, y, 1310)
            tone = "G_L" if v > 0.65 else "G_B" if v > 0.4 else "G_D1" if v > 0.28 else "G_D2"
            if tone == "G_B" and tile_noise(x + 0.5, y + 0.5, 16, 1314) > 0.66:
                tone = "G_G"
            if ihash(x, y, 1317) < 0.03:
                tone = "G_D1" if tone in ("G_L", "G_B", "G_G") else "G_SH"
            names.append(tone)

    def at(x, y):
        return (y % SURFACE) * SURFACE + x % SURFACE

    # Short blade clusters point screen-up: one texel -col, +row per step.
    for _ in range(150):
        cx, cy = rng.randrange(SURFACE), rng.randrange(SURFACE)
        for _ in range(rng.randint(2, 5)):
            bx, by = cx + rng.randint(-3, 3), cy + rng.randint(-3, 3)
            length = rng.choice((2, 2, 3))
            names[at(bx + 1, by - 1)] = "G_SH" if rng.random() < 0.5 else "G_D2"
            for k in range(length):
                names[at(bx - k, by + k)] = "G_H2" if k == length - 1 and rng.random() < 0.6 else "G_H1"
    return surface_image(names, SURFACE_PALETTES["campGrass"])


def repeat_preview(image, scale):
    preview = Image.new("RGB", (SURFACE * 3, SURFACE * 3))
    for y in range(3):
        for x in range(3):
            preview.paste(image, (x * SURFACE, y * SURFACE))
    if scale > 1:
        preview = preview.resize((preview.width * scale, preview.height * scale), Image.Resampling.NEAREST)
    return preview


def surface_report(image):
    data = pixels(image)
    mean = [round(sum(p[c] for p in data) / len(data), 1) for c in range(3)]

    def diff(a, b):
        return sum(abs(a[c] - b[c]) for c in range(3))

    interior = [diff(image.getpixel((x, y)), image.getpixel((x + 1, y))) for y in range(SURFACE) for x in range(SURFACE - 1)]
    seam_x = [diff(image.getpixel((SURFACE - 1, y)), image.getpixel((0, y))) for y in range(SURFACE)]
    seam_y = [diff(image.getpixel((x, SURFACE - 1)), image.getpixel((x, 0))) for x in range(SURFACE)]
    return {"size": list(image.size), "colors": len(set(data)), "mean": mean,
            "interiorStep": round(sum(interior) / len(interior), 2),
            "seamStepX": round(sum(seam_x) / len(seam_x), 2), "seamStepY": round(sum(seam_y) / len(seam_y), 2)}


# --------------------------------------------------------------------------
# Package: atlas, masks, previews, records.
# --------------------------------------------------------------------------

def pack_mask(image):
    bits = bytearray((image.width * image.height + 7) // 8)
    for i, alpha in enumerate(pixels(image.getchannel("A"))):
        if alpha:
            bits[i >> 3] |= 1 << (i & 7)
    return {"width": image.width, "height": image.height, "bits": base64.b64encode(bits).decode("ascii")}


def footprint_polygon(record):
    cx, cy = record["contactCenter"]
    if record["shape"] == "circle":
        r = record["radius"]
        return [(cx + 32 * r * math.cos(a * math.pi / 8), cy + 16 * r * math.sin(a * math.pi / 8)) for a in range(16)]
    return [tuple(p) for p in record["polygon"]]


def inside(polygon, x, y):
    hit = False
    for (x0, y0), (x1, y1) in zip(polygon, polygon[1:] + polygon[:1]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            hit = not hit
    return hit


def frame_report(name, cell, record):
    alpha = pixels(cell.getchannel("A"))
    opaque = [(i % CELL, i // CELL) for i, a in enumerate(alpha) if a]
    colors = {p[:3] for p in pixels(cell) if p[3]}
    polygon = footprint_polygon(record)
    on_footprint = sum(1 for x, y in opaque if inside(polygon, x + 0.5, y + 0.5))
    box = cell.getchannel("A").getbbox()
    return {"frame": name, "bbox": list(box), "size": [box[2] - box[0], box[3] - box[1]],
            "opaquePixels": len(opaque), "colors": len(colors), "maxOpaqueRow": max(y for _, y in opaque),
            "opaqueOnFootprint": on_footprint, "contactCenter": record["contactCenter"], "role": record["role"]}


def median_samples(images):
    result = {}
    for label, (source, box) in SAMPLE_REGIONS.items():
        crop = images[source].crop(tuple(box)).convert("RGB")
        quantized = crop.quantize(colors=10, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        palette = quantized.getpalette()[:30]
        counts = sorted(quantized.getcolors(), key=lambda item: (-item[0], item[1]))
        result[label] = {"source": INPUTS[source], "box": box,
                         "colors": ["#%02x%02x%02x" % tuple(palette[i * 3:i * 3 + 3]) for _, i in counts]}
    return result


def nearest_sample(value, samples):
    rgb = hexrgb(value)
    best = None
    for label, record in samples.items():
        for sample in record["colors"]:
            d = math.dist(rgb, hexrgb(sample))
            if best is None or d < best[0]:
                best = (d, label, sample)
    return {"region": best[1], "sample": best[2], "distance": round(best[0], 2)}


def tiled(texture, size):
    image = Image.new("RGBA", size)
    for y in range(0, size[1], texture.height):
        for x in range(0, size[0], texture.width):
            image.alpha_composite(texture, (x, y))
    return image


def contact_sheet(cells, scale):
    label = 18
    sheet = Image.new("RGBA", (CELL * COLUMNS, (CELL + label) * ROWS), "#9aa29b")
    draw = ImageDraw.Draw(sheet)
    for i, cell in enumerate(cells):
        x, y = (i % COLUMNS) * CELL, (i // COLUMNS) * (CELL + label)
        sheet.alpha_composite(cell, (x, y))
        box = cell.getchannel("A").getbbox()
        draw.text((x + 4, y + CELL + 3), f"{i}: {FRAMES[i]}  {box[2] - box[0]}x{box[3] - box[1]}px", fill="#20282e")
        draw.point((x + ANCHOR[0], y + ANCHOR[1]), fill="#bb332f")
    if scale > 1:
        sheet = sheet.resize((sheet.width * scale, sheet.height * scale), Image.Resampling.NEAREST)
    return sheet


def native_context(cells, images):
    size = (960, 540)
    image = tiled(images["countryGrass"], size)
    draw = ImageDraw.Draw(image)
    origin = (480, 230)

    def place(sprite, anchor, contact, x, y):
        sx = origin[0] + KX * (y - x)
        sy = origin[1] + KY * (x + y)
        image.alpha_composite(sprite, (round(sx - contact[0]), round(sy - contact[1])))

    camp = images["campAtlas"]
    monk_manifest = json.loads((ROOT / INPUTS["monkManifest"]).read_text())["monk"]
    idle = monk_manifest["clips"]["idle"]["front"][0]
    cell = monk_manifest["cell"]
    monk = images["monkAtlas"].crop(((idle % monk_manifest["columns"]) * cell, (idle // monk_manifest["columns"]) * cell,
                                     (idle % monk_manifest["columns"] + 1) * cell, (idle // monk_manifest["columns"] + 1) * cell))
    tent = camp.crop((256, 0, 512, 256))
    fire = camp.crop((0, 256, 256, 512))
    by_name = dict(zip(FRAMES, cells))
    contract = read_json(ROOT / CONTRACT)["frames"]
    items = [  # name, world x, y (contact centres)
        ("woven-carpet", 5.0, 2.0), ("grass-tuft", 0.0, 4.0), ("fern-tuft", 4.0, -4.0), ("grass-tuft", 8.6, 8.4),
        ("cypress-tall", 5.0, -7.0), ("cypress-pair", -6.0, 5.0), ("cypress-medium", 8.0, -3.0),
        ("outcrop-cliff", 9.0, -6.0), ("outcrop-wall-x", -7.0, 1.0), ("outcrop-wall-y", 11.0, 1.0),
        ("outcrop-cluster", -2.0, 7.0), ("ruin-pillar", -4.0, -1.0), ("bush-large", 2.0, 8.0), ("bush-round", 7.0, 8.0),
        ("outcrop-block", 12.0, 6.0), ("outcrop-slab", 9.0, 11.0), ("outcrop-pair", -3.0, 11.0),
        ("tripod-kettle", 0.2, 0.7), ("crate", 4.4, 1.0), ("sack-pair", 5.3, 2.5),
        ("outcrop-crag", 13.0, -2.0), ("outcrop-ledge-x", -8.0, 8.5), ("boulder-round", 6.0, 12.0),
        ("ruin-stump", -6.5, -4.0), ("ruin-fallen", 1.5, 12.5),
    ]
    sprites = [(by_name[name], contract[name]["contactCenter"], x, y) for name, x, y in items]
    sprites.append((tent, (130, 196), -3.0, -3.0))
    sprites.append((fire, (128, 214), 1.0, -1.0))
    sprites.append((monk, (48, 84), 3.4, -2.2))
    flat = [s for s in sprites if s[0] in (by_name["woven-carpet"], by_name["grass-tuft"], by_name["fern-tuft"])]
    for sprite, contact, x, y in flat:
        place(sprite, None, contact, x, y)
    for sprite, contact, x, y in sorted((s for s in sprites if s not in flat), key=lambda s: s[2] + s[3]):
        place(sprite, None, contact, x, y)
    draw.rectangle((0, 0, size[0], 16), fill="#20282e")
    draw.text((6, 3), "camp-panorama props at 1:1 native, 32 px/u, with the unchanged monk, tent and fire (art preview, not a layout)",
              fill="#e3e4d8")
    return image


def mountains_preview(mountains, contract):
    left, right, top, bottom = -12, 40, -30, -2
    crop = mountains.crop(((left - BACK_U0) * 32, (top - BACK_V0) * 32, (right - BACK_U0) * 32, (bottom - BACK_V0) * 32))
    draw = ImageDraw.Draw(crop)
    points = contract["backdrop"]["plannedHorizon"]["points"]
    draw.line([((u - left) * 32, (v - top) * 32) for u, v in points], fill="#ff3b30", width=2)
    window = (-7, -13.1, 18, -6)
    draw.rectangle(((window[0] - left) * 32, (window[1] - top) * 32, (window[2] - left) * 32, (window[3] - top) * 32),
                   outline="#ffd60a")
    draw.text((8, 8), "mountains.png u -12..40, v -30..-2 at 1:1; red = planned horizon H(u), yellow = artboard window",
              fill="#11121d")
    return crop


README = """# Camp panorama package

Programmatic pixel art for the rebuilt first location (Paper artboard "Панорама лагеря"). The road area
reuses the same stones, trees, bushes and tufts; `ruin-stump` and `ruin-fallen` are its road markers.
Every pixel is drawn by `scripts/build-camp-panorama-assets.py` from fixed geometry, fixed seeds and
explicit palettes. No image generation, network access or new dependency is involved.

## Contents

| File | Contents |
| --- | --- |
| `camp-panorama.png` | Atlas, cell 256 px, 4 columns × 6 rows (all cells used), registration anchor `[128,232]`, binary alpha, {prop_colors} opaque colours. |
| `mountains.png` | Far backdrop, 2048 × 1280, opaque, {back_colors} colours, wraps horizontally. |
| `camp-earth.png`, `camp-grass.png` | Opaque 128 × 128 ground surfaces (4u, 32 px/u), seamless on both axes: packed earth/road and olive meadow. |
| `hit-masks.json` | Little-bit-first mask of the atlas alpha, keyed by `camp-panorama.png`. |
| `manifest.json` | Runtime contract: atlas slicing, frame keys, backdrop screen frame, footprints, opaque cell bounds. |
| `frames/*.png` | One 256 px cell per frame. |
| `previews/` | Contact sheet (native and nearest 2×), props next to the unchanged monk, backdrop with the planned horizon, 3×3 surface repeats (native and 2×). |
| `source/footprints.json` | Geometry contract owned by `src/camp-layout.js` (camp) and `src/road-country.js` (road); an input of this script, never written by it. |
| `source/palette.json`, `source/provenance.json`, `qa-report.json` | Palettes with reproducible concept samples, input hashes, per-frame checks. |

Frames, in atlas order: {frame_list}.

## Registration

`[128,232]` is a fixed registration point, not a footprint centre. Each frame's ground footprint is
`footprints.<frame>`: `contactCenter` in cell pixels plus a world-space shape (`box`/`rect`: `halfWidth` along
world x = screen down-left, `halfDepth` along world y = screen down-right; `circle`: `radius`). The front-most
footprint point sits on row 231, so the anchor also sorts like the object's front. Pixel offset `(du,dv)` from
`contactCenter` maps to world `x=(2dv-du)/(32√2)`, `y=(2dv+du)/(32√2)`; mirrored placements swap the roles of x
and y. `role` is `solid` (needs a collider) or `flat` (carpet, tufts: walkable, draw in the ground layer).
`opaqueBounds.<frame>` is the opaque `[x0,y0,x1,y1]` box of the cell (exclusive end), for screen-space reservations.
Circles of trees and bushes are trunk/stem cores; canopies overhang them.

## Backdrop

`mountains.png` is painted in world-screen coordinates: `u=(y-x)/√2` (screen right) and `v=(x+y)/(2√2)`
(screen down), in world units, 32 px per unit. Column `(u+20)·32`, row `(v+40)·32`; it wraps every 64 units in
u. The top rows are a flat sky band and the bottom 24 rows one flat colour, so clamped vertical sampling has no
edge. Three ridges follow the camp rim (`NEAR_CREST`, about 1u above the layout horizon `H(u)`): a far pale
blue-grey range with warm lit faces and varied peaks (the highest near u≈12), a mid slate-blue ridge and a near
dark blue-green ridge with rows of tiny cypress silhouettes. Facets take their light from the crest slope smoothed
wider with depth, so spurs merge into broad flanks instead of vertical streaks. Each ridge's foot sinks into
horizontal, dithered valley haze; small flat-bottomed cloud wisps float over the sky and the far range only.

## Ground surfaces

`manifest.surfaces.campEarth` / `campGrass` follow the pixel-v6 surface contract: sample at `worldXZ / 4` with
repeat. Image columns run along world +x and rows along world −y (textures load with `invertY`), so the
screen's upper-left light falls on the lower (+row) side of pebbles. Both are flat: no height, no edges. Earth
has sparse hairline cracks, small pebbles and darker trodden patches; grass has darker patches and short
2–3 texel blade highlights that point screen-up. Tufts taller than that are separate props.

## Rebuild and verify

From the repository root (tested with Python {python}, Pillow {pillow}):

```sh
python3 -B scripts/build-camp-panorama-assets.py
python3 -B scripts/build-camp-panorama-assets.py --verify-only
node --test tests/camp-panorama-assets.test.js
```

`--verify-only` redraws every delivered file in memory, compares bytes and input hashes, writes nothing and exits
non-zero on any difference. Byte identity is guaranteed only with the recorded Pillow version.

## Limits

- Programmatic drawing: outcrops are heightfields of rounded, chipped and cracked blocks (bevelled tops, moss,
  bedding joints, dark crevices, blue-green bounce light) splatted into a z-buffer; trees and bushes are layered
  tufts. Plan corners stay sharp at the screen-left and screen-right ground corners, so the drawn contact stays
  within 1.6 px of every box footprint corner. Detail is simpler than the artboard illustration, at the game's
  32 px/u density (not the artboard's coarser grid).
- No animation; the backdrop has no depth information and is meant only beyond the horizon line.
- Colliders and placement are the layout owner's decision; footprints are the drawing contract.
"""


def build_outputs():
    contract = read_json(ROOT / CONTRACT)
    assert contract["cell"] == CELL and contract["anchor"] == list(ANCHOR), "contract cell/anchor changed"
    assert list(contract["frames"]) == FRAMES, "contract frame order changed"
    images = {key: load_rgba(ROOT / path) for key, path in INPUTS.items() if path.endswith(".png")}
    cells = [draw_frame(name, contract) for name in FRAMES]
    atlas = Image.new("RGBA", (CELL * COLUMNS, CELL * ROWS), (0, 0, 0, 0))
    for i, cell in enumerate(cells):
        atlas.alpha_composite(cell, ((i % COLUMNS) * CELL, (i // COLUMNS) * CELL))
    mountains = backdrop()
    atlas_colors = sorted({p[:3] for p in pixels(atlas) if p[3]})
    back_colors = sorted({p[:3] for p in pixels(mountains)})
    assert len(atlas_colors) <= 64 and len(back_colors) <= 40, "palette budget exceeded"
    reports = [frame_report(name, cell, contract["frames"][name]) for name, cell in zip(FRAMES, cells)]
    for report in reports:
        assert report["maxOpaqueRow"] <= LAST_ROW, f"{report['frame']} draws below the anchor"
        assert report["opaqueOnFootprint"] > 0, f"{report['frame']} does not touch its footprint"
    outputs = {}
    outputs["camp-panorama.png"] = png_bytes(atlas)
    outputs["mountains.png"] = png_bytes(mountains.convert("RGB"))
    ground = {"campEarth": camp_earth(), "campGrass": camp_grass()}
    files = {"campEarth": "camp-earth", "campGrass": "camp-grass"}
    for key, image in ground.items():
        assert len(set(pixels(image))) <= 24, f"{key} palette budget exceeded"
        outputs[f"{files[key]}.png"] = png_bytes(image)
        outputs[f"previews/{files[key]}-repeat-native.png"] = png_bytes(repeat_preview(image, 1))
        outputs[f"previews/{files[key]}-repeat-2x.png"] = png_bytes(repeat_preview(image, 2))
    for name, cell in zip(FRAMES, cells):
        outputs[f"frames/{name}.png"] = png_bytes(cell)
    outputs["hit-masks.json"] = json_bytes({"camp-panorama.png": pack_mask(atlas)})
    outputs["previews/contact-native.png"] = png_bytes(contact_sheet(cells, 1))
    outputs["previews/contact-2x.png"] = png_bytes(contact_sheet(cells, 2))
    outputs["previews/native-context.png"] = png_bytes(native_context(cells, images))
    outputs["previews/mountains-preview.png"] = png_bytes(mountains_preview(mountains.convert("RGBA"), contract).convert("RGB"))
    samples = median_samples(images)
    outputs["source/palette.json"] = json_bytes({
        "schemaVersion": 1,
        "method": "Explicit ramps, hand-tuned against reproducible median-cut samples (10 colours, no dither) of the named regions.",
        "props": {name: {"hex": value, "nearestSample": nearest_sample(value, samples)} for name, value in PALETTE.items()},
        "backdrop": {name: {"hex": value, "nearestSample": nearest_sample(value, samples)} for name, value in BACKDROP_PALETTE.items()},
        "surfaces": {key: {name: {"hex": value, "nearestSample": nearest_sample(value, samples)} for name, value in palette.items()}
                     for key, palette in SURFACE_PALETTES.items()},
        "surfaceTargets": {key: list(value) for key, value in SURFACE_TARGETS.items()},
        "samples": samples,
    })
    input_hashes = {key: {"path": path, "sha256": digest((ROOT / path).read_bytes())} for key, path in INPUTS.items()}
    outputs["source/provenance.json"] = json_bytes({
        "schemaVersion": 1,
        "method": "programmatic drawing: exact orthographic 2:1 ray casting of boxes/ellipsoids/rods for props, "
                  "screen-space foliage tufts, heightfield rock splatting, and three screen-space ridges with depth-smoothed facets and dithered valley haze for the backdrop",
        "generator": "scripts/build-camp-panorama-assets.py",
        "imageGeneration": None,
        "tools": {"python": sys.version.split()[0], "pillow": PILLOW_VERSION},
        "inputs": input_hashes,
        "inputRoles": {
            "contract": "geometry contract (footprints, backdrop frame and planned horizon)",
            "concept": "artboard export; palette samples and arrangement reference only, no pixels copied",
            "landscapeAtlas": "palette samples of the existing cypress and rock",
            "campAtlas": "palette samples of supplies and road marker; tent and fire in the context preview",
            "monkAtlas": "unchanged hero in the context preview", "monkManifest": "idle frame index",
            "countryGrass": "preview ground", "countrySoil": "recorded for the ground palette match",
        },
        "seeds": "fixed integer salts in the script; random.Random only",
        "license": "project art; no external assets",
    })
    outputs["qa-report.json"] = json_bytes({
        "schemaVersion": 1, "atlas": {"size": list(atlas.size), "opaqueColors": len(atlas_colors), "binaryAlpha": True},
        "backdrop": {"size": list(mountains.size), "colors": len(back_colors),
                     "wrapColumnDifference": sum(1 for r in range(mountains.height)
                                                 if mountains.getpixel((0, r)) != mountains.getpixel((mountains.width - 1, r)))},
        "frames": reports,
        "surfaces": {key: surface_report(image) for key, image in ground.items()},
    })
    manifest = {
        "schemaVersion": 1, "status": "ready", "nativePixelsPerUnit": 32,
        "campPanorama": {"path": "camp-panorama.png", "cell": CELL, "columns": COLUMNS, "rows": ROWS,
                         "anchor": list(ANCHOR), "frames": FRAMES, "filter": "nearest", "mipmaps": False},
        "campBackdrop": {"path": "mountains.png", "size": list(BACKDROP_SIZE),
                         "screenFrame": contract["backdrop"]["screenFrame"], "wrapU": True,
                         "filter": "nearest", "mipmaps": False},
        "surfaces": {key: {"path": f"{files[key]}.png", "size": [SURFACE, SURFACE], "filter": "nearest", "mipmaps": False}
                     for key in ("campGrass", "campEarth")},
        "footprints": contract["frames"],
        "opaqueBounds": {report["frame"]: report["bbox"] for report in reports},
        "backdropPlan": {key: contract["backdrop"][key] for key in ("plannedHorizon", "parallax", "screenCoordinates")},
        "hitMasks": "hit-masks.json", "provenance": "source/provenance.json", "palette": "source/palette.json",
        "previews": "previews/contact-native.png",
    }
    outputs["manifest.json"] = json_bytes(manifest)
    outputs["README.md"] = README.format(
        prop_colors=len(atlas_colors), back_colors=len(back_colors), frame_list=", ".join(f"`{n}`" for n in FRAMES),
        python=sys.version.split()[0], pillow=PILLOW_VERSION).encode()
    return outputs, {"atlasColors": len(atlas_colors), "backdropColors": len(back_colors),
                     "files": len(outputs)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true", help="rebuild in memory and compare without writes")
    args = parser.parse_args()
    outputs, summary = build_outputs()
    if args.verify_only:
        mismatched = [name for name, data in outputs.items()
                      if not (OUT / name).is_file() or (OUT / name).read_bytes() != data]
        print(json.dumps({"mode": "verify-only", "files": len(outputs), "mismatched": mismatched, **summary}, indent=2))
        return 1 if mismatched else 0
    for name, data in outputs.items():
        path = OUT / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    print(json.dumps({"mode": "build", **summary}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
