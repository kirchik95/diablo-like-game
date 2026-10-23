#!/usr/bin/env python3
"""Draw the monastery ruins package programmatically; --verify-only never writes.

Courtyard ruin props, flat ground decals and one seamless flagstone surface,
rendered in the camp panorama's stone language: every block is a heightfield
mass with a rounded, chipped top, mossy beds, dark crevices and blue-green
bounce light, splatted into a z-buffer. Walls add coursed masonry, arches add
voussoirs. No image generation, network or dependency installation is
involved. Paths resolve from this script; output is confined to
assets/game/pixel-v11/monastery-ruins.
"""

import argparse
import base64
import bisect
import hashlib
import io
import json
import math
from pathlib import Path
import random
import sys

from PIL import Image, ImageDraw, __version__ as PILLOW_VERSION


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/game/pixel-v11/monastery-ruins"
INPUTS = {
    "campAtlas": "assets/game/pixel-v9/camp-panorama/camp-panorama.png",
    "campManifest": "assets/game/pixel-v9/camp-panorama/manifest.json",
    "campGrass": "assets/game/pixel-v9/camp-panorama/camp-grass.png",
    "campEarth": "assets/game/pixel-v9/camp-panorama/camp-earth.png",
    "worldAtlas": "assets/game/pixel-v2/hound-world/world-v2.png",
    "worldManifest": "assets/game/pixel-v2/hound-world/manifest.json",
    "houndAtlas": "assets/game/pixel-v2/hound-world/hound-v2.png",
    "monkAtlas": "assets/game/pixel-v2/monk/monk-v2.png",
    "monkManifest": "assets/game/pixel-v2/monk/manifest.json",
    "conceptRoad": "assets/concepts/pixel-art-01/p4-pixel-monastery.png",
    "conceptKit": "assets/concepts/pixel-art-01/p7-pixel-environment-kit.png",
    "keyart": "assets/concepts/art-bible-01/07-monastery-outskirts-keyart.png",
    "courtyardV1": "assets/game/pixel-v1/environment.png",
}
FRAMES = ["wall-run-x", "wall-run-y", "wall-window-x", "wall-window-y",
          "wall-end-x", "wall-end-y", "wall-breach-x", "wall-corner",
          "arch-gate", "parapet-x", "parapet-y", "parapet-corner",
          "column-intact", "column-broken", "column-drums", "ritual-plinth",
          "ritual-plinth-runes", "fallen-block", "fallen-lintel", "fallen-blocks",
          "rubble-pile", "rubble-scatter", "flagstones-broken", "flagstone-cracks",
          "moss-patch", "ivy-clump", "dead-tree", "dead-tree-snag",
          "parapet-broken-x", "parapet-broken-y", "corner-stump", "rubble-small"]
CELL, COLUMNS, ROWS, ANCHOR = 256, 4, 8, (128, 232)
LAST_ROW = 231

# One shared prop palette. Stone, moss, foliage and bark are the camp panorama
# ramps unchanged (same names, same hex), so camp and courtyard rocks read as
# one material. Additions: one lighter lit-face block tone, soil, the courtyard
# flagstone tones (shared with the surface texture) and the magenta rune ramp.
PALETTE = {
    "OUT": "#0e121d", "DEEP": "#1f2737", "DEEP2": "#2d2f40",
    "Q_HI": "#c9b79b", "Q_W1": "#b09c82", "Q_T1": "#9f9280", "Q_T2": "#877d72", "Q_T3": "#6c6564",
    "Q_L0": "#7b7270", "Q_L1": "#706968", "Q_L2": "#5c5258", "Q_M": "#4a4753", "Q_S1": "#3d3e4c", "Q_S2": "#30344a",
    "Q_AMB": "#3c4b52",
    "M_HI": "#9a9358", "M1": "#7d7b4f", "M2": "#626445", "M3": "#4a523f",
    "B_HI": "#6f8467", "B1": "#4f6759", "B2": "#37504b", "B3": "#263c3e", "F4": "#0f2b3c",
    "G_HI": "#6f8a64", "G1": "#4c6a55", "G2": "#33504a", "G3": "#203842",
    "T1": "#6e4f45", "T2": "#4a3438", "T3": "#2f2230",
    "SOIL1": "#82664c", "SOIL2": "#6c5440", "SOIL3": "#4b3a33",
    "S_HI": "#bcae98", "S1": "#a39785", "S2": "#958a7d", "S3": "#89817e", "S4": "#7a7174", "S_SH": "#5f5860",
    "RUNE_HI": "#ffa8de", "RUNE1": "#ff4bb7", "RUNE2": "#cf1b87", "RUNE3": "#7c3767",
    "Y1": "#b8935c", "Y2": "#8c6c46", "Y3": "#d3bb8f",
    "C0": "#e6fffb", "C1": "#92faf1", "C2": "#24ced5", "C3": "#1cabb8", "C4": "#14707e",
    "A0": "#fff0c2", "A1": "#ffc75c", "A2": "#ed9e43", "A3": "#b88051",
}
# Colours that are not camp panorama ramps (everything else is shared by name and value).
NEW_COLORS = {"Q_L0", "SOIL1", "SOIL2", "SOIL3", "S_HI", "S1", "S2", "S3", "S4", "S_SH", "RUNE_HI", "RUNE1", "RUNE2", "RUNE3",
              "C0", "C1", "C2", "C3", "C4", "A0", "A1", "A2", "A3"}
CYAN_KEYS = ("C0", "C1", "C2", "C3", "C4")
AMBER_KEYS = ("A0", "A1", "A2", "A3")
RUNE_KEYS = ("RUNE_HI", "RUNE1", "RUNE2", "RUNE3")
SAMPLE_REGIONS = {
    "camp outcrop-cliff": ("campAtlas", [256, 256, 512, 512]),
    "camp outcrop-wall-x": ("campAtlas", [512, 256, 768, 512]),
    "camp cypress-tall": ("campAtlas", [512, 512, 768, 768]),
    "camp bush-round": ("campAtlas", [256, 768, 512, 1024]),
    "concept courtyard ruins": ("conceptRoad", [1060, 230, 1550, 520]),
    "concept low walls": ("conceptRoad", [870, 640, 1180, 770]),
    "concept dead grove": ("conceptRoad", [430, 240, 800, 500]),
    "concept ritual shrine": ("conceptRoad", [540, 330, 700, 490]),
    "kit flagstones": ("conceptKit", [130, 280, 460, 480]),
    "kit wall corner": ("conceptKit", [505, 255, 800, 465]),
    "kit arch and drum": ("conceptKit", [855, 255, 1115, 520]),
    "keyart courtyard": ("keyart", [1000, 230, 1550, 520]),
    "world magenta brazier": ("worldAtlas", [0, 160, 160, 320]),
    "camp earth": ("campEarth", [0, 0, 128, 128]),
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


def lerp_points(points, a):
    """Piecewise-linear profile through sorted (a, value) control points."""
    if a <= points[0][0]:
        return points[0][1]
    for (a0, v0), (a1, v1) in zip(points, points[1:]):
        if a <= a1:
            return v0 + (v1 - v0) * (a - a0) / (a1 - a0)
    return points[-1][1]


# --------------------------------------------------------------------------
# Sprite canvas: exact orthographic 2:1 projection into a z-buffer (the camp
# panorama renderer, copied so later camp edits never change these bytes).
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

    def finish(self, outline=True, seam=True, outline_color="OUT"):
        color, oid, depth, style = self.color, self.oid, self.depth, self.style
        result = color[:]
        if seam:
            for i, c in enumerate(color):
                if c is None:
                    continue
                st = style[i] or {}
                if not st.get("seam"):
                    continue
                x, y = i % CELL, i // CELL
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < CELL and 0 <= ny < CELL:
                        j = ny * CELL + nx
                        if color[j] is not None and oid[j] != oid[i] and depth[j] > depth[i] + st.get("seamGap", 0.04):
                            result[i] = st["seam"]
                            break
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


def moss_at(x, y, salt, amount):
    m = vnoise(x * 2.7 + 11.3, y * 2.7 - 4.1, salt) * 0.7 + vnoise(x * 8.5, y * 8.5, salt + 3) * 0.3
    return m - (1 - amount)


# --------------------------------------------------------------------------
# Masonry masses. Every block is a rounded plan rectangle (or disc) with a
# bevelled, chipped top. Blocks merge with max() into a heightfield sampled
# GRID times per unit. Grounded passes paint each sample as a vertical run down
# to its lowest front neighbour (the camp rule); floating passes (arch vaults,
# window heads, capitals, lying drums) paint full runs from their underside to
# their top, so a soffit seen through an opening is solid. Faces take a
# pattern: coursed ashlar with staggered head joints, voussoir rings, drum
# beds, carved rune bands. Joint rows sit under a lit arris row, the bottom
# row of each block turns away from the light, so blocks read rounded.
# --------------------------------------------------------------------------

GRID = 48
PX_Z = 1 / KZ        # one screen row of height
JB = 0.034           # bed joint: one row
JH = 0.026           # head joint half width: about one column
ARRIS = 0.038


class Block:
    snap = True  # cut faces are axis planes (see mass_tone)
    material = "stone"

    def __init__(self, x0, x1, y0, y1, z0, z1, salt, corner=0.05, bevel=0.055, chips=0, chip=(0.07, 0.16),
                 chip_depth=(0.05, 0.13), wobble=0.012, tilt=(0.0, 0.0), rough=0.022, moss=0.35, warm=False,
                 pattern=None, round_plan=False, steep=90.0):
        self.box = (x0, x1, y0, y1)
        self.cx, self.cy, self.hx, self.hy = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
        self.z0, self.z1, self.salt, self.moss, self.warm, self.pattern = z0, z1, salt, moss, warm, pattern
        self.corner = min(corner, self.hx * 0.95, self.hy * 0.95)
        self.bevel, self.wobble, self.tilt, self.rough, self.steep = bevel, wobble, tilt, rough, steep
        self.round_plan = round_plan
        rng = random.Random(salt * 97 + 13)
        self.chips = []
        for _ in range(chips):
            roll = rng.random()
            if roll < 0.6:
                px, py = rng.choice((x0, x1)), rng.choice((y0, y1))
            elif roll < 0.8:
                px, py = rng.choice((x0, x1)), rng.uniform(y0, y1)
            else:
                px, py = rng.uniform(x0, x1), rng.choice((y0, y1))
            self.chips.append((px, py, rng.uniform(*chip), min(rng.uniform(*chip_depth), (z1 - z0) * 0.6)))

    def top(self, x, y):
        return (self.z1 + self.tilt[0] * (x - self.cx) + self.tilt[1] * (y - self.cy)
                + self.rough * (vnoise(x * 6.0, y * 6.0, self.salt + 2) - 0.5))

    def edge(self, x, y):
        """Signed plan distance to the weathered outline, negative inside."""
        if self.round_plan:
            q = math.hypot((x - self.cx) / self.hx, (y - self.cy) / self.hy)
            d = (q - 1) * min(self.hx, self.hy)
        else:
            rc = self.corner
            qx, qy = abs(x - self.cx) - (self.hx - rc), abs(y - self.cy) - (self.hy - rc)
            d = math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - rc
        # Noise only pulls the outline inwards, so a base never leaves its footprint.
        return d + self.wobble * vnoise(x * 9.0 + 3.1, y * 9.0, self.salt)

    def height(self, x, y):
        d = self.edge(x, y)
        if d >= 0:
            return None
        e, top, b = -d, self.top(x, y), self.bevel
        z = top - b + math.sqrt(max(0.0, b * b - (b - e) ** 2)) if e < b else top
        z = min(z, self.z0 + e * self.steep)
        for px, py, r, depth in self.chips:
            q = math.hypot(x - px, y - py) / r
            if q < 1:
                z = min(z, top - depth * min(1.0, (1 - q) * 3.0))
        return max(z, self.z0)

    def underside(self, x, y):
        return self.z0


class LyingDrum(Block):
    """A column drum on its side along world x, half sunk into the soil."""

    def __init__(self, x0, x1, yc, radius, salt, sink=0.18, **kw):
        self.radius, self.yc, self.zc = radius, yc, radius * (1 - sink)
        super().__init__(x0, x1, yc - radius, yc + radius, 0.0, self.zc + radius, salt, **kw)

    def edge(self, x, y):
        return max(abs(x - self.cx) - self.hx, abs(y - self.yc) - self.radius * 0.995)

    def height(self, x, y):
        if self.edge(x, y) >= 0:
            return None
        s = math.sqrt(max(0.0, self.radius ** 2 - (y - self.yc) ** 2))
        z = self.zc + s + 0.02 * (vnoise(x * 7, y * 7, self.salt) - 0.5)
        end = self.hx - abs(x - self.cx)
        if end < 0.05:  # rounded rim at both caps
            z -= (0.05 - end) * 0.9
        for px, py, r, depth in self.chips:
            q = math.hypot(x - px, (y - py) * 0.7) / r
            if q < 1:
                z = min(z, self.zc + s - depth * min(1.0, (1 - q) * 3.0))
        return max(z, self.underside(x, y) + 0.02)

    def underside(self, x, y):
        s = math.sqrt(max(0.0, self.radius ** 2 - (y - self.yc) ** 2))
        return max(0.0, self.zc - s)


class Field:
    def __init__(self, x0, y0, nx, ny):
        self.x0, self.y0, self.nx, self.ny = x0, y0, nx, ny
        self.h = [0.0] * (nx * ny)
        self.fl = [0.0] * (nx * ny)
        self.owner = [-1] * (nx * ny)

    def at(self, i, j):
        if 0 <= i < self.nx and 0 <= j < self.ny:
            return self.h[j * self.nx + i]
        return 0.0

    def floor_at(self, i, j):
        if 0 <= i < self.nx and 0 <= j < self.ny:
            return self.fl[j * self.nx + i]
        return 0.0

    def xy(self, x, y):
        return self.at(round((x - self.x0) * GRID), round((y - self.y0) * GRID))

    def copy(self):
        f = Field(self.x0, self.y0, self.nx, self.ny)
        f.h, f.fl, f.owner = self.h[:], self.fl[:], self.owner[:]
        return f


def mass_field(blocks, pad=0.08):
    x0 = min(b.box[0] for b in blocks) - pad
    x1 = max(b.box[1] for b in blocks) + pad
    y0 = min(b.box[2] for b in blocks) - pad
    y1 = max(b.box[3] for b in blocks) + pad
    f = Field(x0, y0, math.ceil((x1 - x0) * GRID) + 1, math.ceil((y1 - y0) * GRID) + 1)
    for k, block in enumerate(blocks):
        bx0, bx1, by0, by1 = block.box
        i0, i1 = max(0, math.ceil((bx0 - x0) * GRID)), min(f.nx - 1, math.floor((bx1 - x0) * GRID))
        j0, j1 = max(0, math.ceil((by0 - y0) * GRID)), min(f.ny - 1, math.floor((by1 - y0) * GRID))
        for j in range(j0, j1 + 1):
            y = y0 + j / GRID
            row = j * f.nx
            for i in range(i0, i1 + 1):
                z = block.height(x0 + i / GRID, y)
                if z is not None and (f.owner[row + i] < 0 or z > f.h[row + i]):
                    f.h[row + i], f.owner[row + i] = z, k
                    f.fl[row + i] = block.underside(x0 + i / GRID, y)
    return f


def carve(field, rule):
    """Apply rule(x, y, top, floor) -> None or (floor, top) to every filled sample."""
    f = field.copy()
    for j in range(f.ny):
        y = f.y0 + j / GRID
        for i in range(f.nx):
            idx = j * f.nx + i
            if f.owner[idx] < 0:
                continue
            result = rule(f.x0 + i / GRID, y, f.h[idx], f.fl[idx])
            if result is None:
                f.owner[idx], f.h[idx], f.fl[idx] = -1, 0.0, 0.0
            else:
                f.fl[idx], f.h[idx] = result
    return f


FACE_RAMPS = {
    "lit": {"body": ("Q_L1", "Q_L0", "Q_L1", "Q_T3"), "hi": "Q_T2", "low": "Q_L2", "joint": "Q_M", "deep": "DEEP2",
            "crack": "Q_M", "recess": "DEEP2", "sill": "Q_T2", "carve": "Q_M", "vjoint": "DEEP2", "ring": "Q_T2"},
    "mid": {"body": ("Q_L2", "Q_L2", "Q_M", "Q_L1"), "hi": "Q_L1", "low": "Q_M", "joint": "Q_S1", "deep": "DEEP2",
            "crack": "Q_S1", "recess": "DEEP2", "sill": "Q_L1", "carve": "Q_S1", "vjoint": "DEEP2", "ring": "Q_L1"},
    "shade": {"body": ("Q_S1", "Q_S1", "Q_M", "Q_S1"), "hi": "Q_M", "low": "Q_S2", "joint": "Q_S2", "deep": "DEEP",
              "crack": "DEEP2", "recess": "DEEP", "sill": "Q_M", "carve": "DEEP2", "vjoint": "DEEP2", "ring": "Q_L2"},
}


def mass_tone(f, blocks, i, j, z, k, floating):
    rock = blocks[k]
    idx = j * f.nx + i
    x, y = f.x0 + i / GRID, f.y0 + j / GRID
    zt = f.h[idx]
    zf = f.fl[idx] if floating else 0.0
    mossy = moss_at(x, y, rock.salt, rock.moss)
    pattern = rock.pattern
    if floating and zf > 0.01 and z - zf < 0.045 and zt - z > 0.03:
        # Underside of a vault or drum, seen through its opening.
        gx = (f.floor_at(i + 1, j) - f.floor_at(i - 1, j)) * GRID / 2
        gy = (f.floor_at(i, j + 1) - f.floor_at(i, j - 1)) * GRID / 2
        n = _normalize((gx, gy, -1.0))
        b = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]
        if pattern and hasattr(pattern, "soffit") and pattern.soffit(x if pattern.axis == "x" else y, z):
            return "DEEP2", RIGHT_FACE
        return ("Q_L2" if b > 0.32 else "Q_M" if b > 0.05 else "Q_S2"), RIGHT_FACE
    hx = (f.at(i + 1, j) - f.at(i - 1, j)) * GRID / 2
    hy = (f.at(i, j + 1) - f.at(i, j - 1)) * GRID / 2
    n = _normalize((-hx, -hy, 1.0))
    if n[2] > 0.3 and zt - z < 0.07:
        b = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]
        if pattern and hasattr(pattern, "top"):
            marked = pattern.top(x, y, zt)
            if marked:
                return marked, TOP
        if n[2] > 0.8:
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
    # A wall face. Cut stone faces are planes: snap their normal to the
    # dominant axis, so a step in a broken top never tilts the face below it.
    nh = _normalize((n[0], n[1], 0.0)) if abs(n[0]) + abs(n[1]) > 1e-6 else (SQ2 / 2, SQ2 / 2, 0.0)
    if pattern and rock.snap and not rock.round_plan:
        nh = (math.copysign(1.0, nh[0]), 0.0, 0.0) if abs(nh[0]) > abs(nh[1]) else (0.0, math.copysign(1.0, nh[1]), 0.0)
    b = nh[0] * LIGHT[0] + nh[1] * LIGHT[1]
    face = LEFT if b > 0.3 else RIGHT_FACE
    outside = max(f.xy(x + nh[0] * 0.07, y + nh[1] * 0.07), f.xy(x + nh[0] * 0.15, y + nh[1] * 0.15))
    if outside > z + 0.45 and outside > zt + 0.1:
        return "DEEP", RIGHT_FACE
    if outside > z + 0.08 and outside > zt - 0.25:
        return "DEEP2", RIGHT_FACE
    if zt - z < 0.06 + 0.07 * vnoise(x * 7, y * 7, rock.salt + 5) and mossy > 0.14:
        return ("M2" if b > 0.2 else "M3"), face
    light = "lit" if b > 0.3 else "mid" if b > -0.05 else "shade"
    ramp = FACE_RAMPS[light]
    if pattern:
        along_is_x = abs(nh[1]) >= abs(nh[0])
        along = x if along_is_x else y
        kind, variant = pattern.face(along, z, along_is_x, (x, y, z), b)
    else:
        kind, variant = natural_face(rock, x, y, z, zt, along_is_x=abs(nh[1]) >= abs(nh[0]))
    if kind in RUNE_KEYS:
        return kind, face
    if kind == "joint" and z < 0.4 and mossy > -0.05 and vnoise(x * 5, y * 5 + z * 3, rock.salt + 31) > 0.45:
        return ("M3" if light != "lit" else "M2"), face
    if kind == "body" and light == "lit" and b > 0.56:
        return "Q_L0", face
    if light == "shade" and z < 0.2 and kind in ("body", "low") and vnoise(x * 4 + y * 4, z * 9, rock.salt + 7) > 0.35:
        return "Q_AMB", face
    color = ramp[kind]
    return (color[variant % len(color)] if isinstance(color, tuple) else color), face


def natural_face(rock, x, y, z, zt, along_is_x):
    """Loose stones: a lit arris under the top, grain and a darker foot."""
    along = x if along_is_x else y
    if zt - z < ARRIS:
        return "hi", 0
    if z - rock.z0 < PX_Z * 1.2:
        return "low", 0
    grain = vnoise(along * 5.0 + rock.salt, z * 4.0, rock.salt + 17)
    if grain > 0.8:
        return "crack", 0
    return "body", int(grain * 7) % 4


def draw_mass(cv, blocks, field=None, floating=False, style=None):
    f = field or mass_field(blocks)
    nx = f.nx
    oids = [cv.new_oid() for _ in blocks]
    best = {}
    for j in range(f.ny):
        y = f.y0 + j / GRID
        for i in range(nx):
            idx = j * nx + i
            k = f.owner[idx]
            if k < 0:
                continue
            x = f.x0 + i / GRID
            zt = f.h[idx]
            if floating:
                zl = f.fl[idx]
            else:
                zl = min(f.at(i + 1, j), f.at(i, j + 1), f.at(i + 1, j + 1))
                # Paint down to the lowest front neighbour, so steep slopes leave no holes.
                zl = max(0.0, zl - 0.02) if zt - zl > 0.01 else zt
            sx, top_row = cv.project(x, y, zt)
            bottom_row = cv.project(x, y, zl)[1]
            px = math.floor(sx)
            if not 0 <= px < CELL:
                continue
            ground_v = cv.cy + KY * (x + y)
            for row in range(math.floor(top_row), math.floor(bottom_row) + 1):
                if not 0 <= row <= LAST_ROW:
                    continue
                z = min(zt, max(zl, (ground_v - (row + 0.5)) / KZ))
                depth = VIEW[0] * x + VIEW[1] * y + VIEW[2] * z
                index = row * CELL + px
                current = best.get(index)
                if current is None or depth > current[0]:
                    best[index] = (depth, i, j, z, k)
    st = style or {"seam": "DEEP2", "seamGap": 0.03}
    planes = {}
    for index, (depth, i, j, z, k) in best.items():
        color, face = mass_tone(f, blocks, i, j, z, k, floating)
        if blocks[k].material == "bronze":
            color = BRONZE.get(color, color)
        plane = face_plane(f, blocks[k], i, j, z, floating)
        # Neighbouring pixels of one cut face share an id, so seams mark only
        # real steps and overlaps, never the column boundaries inside a face.
        oid = oids[k] if plane is None else planes.setdefault(plane, cv.new_oid())
        cv.put(index % CELL, index // CELL, depth, color, oid, face, st)
    return f


BRONZE = {"Q_HI": "Y3", "Q_W1": "Y1", "Q_T1": "Y1", "Q_T2": "Y2", "Q_T3": "Y2", "Q_L0": "Y1", "Q_L1": "Y2", "Q_L2": "T1",
          "Q_M": "T1", "Q_S1": "T2", "Q_S2": "T3", "Q_AMB": "T2", "DEEP2": "T3", "DEEP": "T3",
          "M_HI": "B_HI", "M1": "B1", "M2": "B1", "M3": "B2"}


def face_plane(f, rock, i, j, z, floating):
    """(pattern, axis, plane) for a pixel on a flat cut face, None elsewhere."""
    if not rock.pattern or rock.round_plan or not rock.snap:
        return None
    idx = j * f.nx + i
    zt = f.h[idx]
    if floating and f.fl[idx] > 0.01 and z - f.fl[idx] < 0.045 and zt - z > 0.03:
        return None
    hx = (f.at(i + 1, j) - f.at(i - 1, j)) * GRID / 2
    hy = (f.at(i, j + 1) - f.at(i, j - 1)) * GRID / 2
    if 1 / math.sqrt(hx * hx + hy * hy + 1) > 0.3 and zt - z < 0.07:
        return None
    x, y = f.x0 + i / GRID, f.y0 + j / GRID
    if abs(hx) > abs(hy):
        return id(rock.pattern), "x", math.copysign(1, -hx), round(x * 8)
    return id(rock.pattern), "y", math.copysign(1, -hy), round(y * 8)


# ------------------------------ face patterns ------------------------------

class Masonry:
    """Coursed ashlar of one wall: bed joints at `levels`, staggered head joints.

    `axis` is the wall's long axis. Long faces cut blocks every 0.5-0.95u;
    end faces alternate through-stones and paired headers across the
    thickness [b0, b1]. An optional arch ring (centre along the axis, springing
    height, inner and outer radius, voussoir count) replaces the courses it
    crosses; `recess` is the chance of a missing face block."""

    def __init__(self, axis, b0, b1, salt, levels, lengths=(0.5, 0.95), arch=None, recess=0.05, cracks=0,
                 crack_span=(-2.0, 2.0), long_courses=None):
        self.axis, self.b0, self.b1, self.salt, self.levels = axis, b0, b1, salt, levels
        self.lengths, self.arch, self.recess = lengths, arch, recess
        self.long_courses = long_courses or {}
        self._cuts, self._ends = {}, {}
        rng = random.Random(salt * 7 + 1)
        self.crack_cells = set()
        for _ in range(cracks):
            a = rng.uniform(*crack_span)
            z = levels[-1] * rng.uniform(0.55, 0.9)
            for _step in range(rng.randint(14, 30)):
                self.crack_cells.add((round(a * 22), round(z * 27)))
                a += rng.uniform(-0.05, 0.05)
                z -= rng.uniform(0.02, 0.045)
                if z < 0.1:
                    break

    def course(self, z):
        k = bisect.bisect_right(self.levels, z) - 1
        return max(0, min(len(self.levels) - 2, k))

    def cuts(self, k):
        if k not in self._cuts:
            rng = random.Random(self.salt * 131 + k * 17)
            lo, hi = self.long_courses.get(k, self.lengths)
            a = -8.0 - rng.uniform(0, hi)
            cuts = []
            while a < 8.0:
                cuts.append(a)
                a += rng.uniform(lo, hi)
            cuts.append(a)
            self._cuts[k] = cuts
        return self._cuts[k]

    def end_cuts(self, k):
        if k not in self._ends:
            rng = random.Random(self.salt * 151 + k * 23)
            if k % 2 == 0:
                self._ends[k] = [self.b0 - 1, self.b1 + 1]
            else:
                mid = (self.b0 + self.b1) / 2 + rng.uniform(-0.08, 0.08)
                self._ends[k] = [self.b0 - 1, mid, self.b1 + 1]
        return self._ends[k]

    def arch_face(self, along, z):
        ca, spring, rin, rout, count = self.arch
        dx, dz = along - ca, z - spring
        if dz < -0.001:
            return None
        r = math.hypot(dx, dz)
        if r > rout + JB:
            return None
        if r > rout:
            return "joint", 0
        theta = math.atan2(max(dz, 0.0), dx)
        step = math.pi / count
        index = min(count - 1, int(theta / step))
        if min(theta - index * step, (index + 1) * step - theta) * r < JH * 1.1:
            return "vjoint", 0
        h = ihash(index, 77, self.salt)
        if rout - r < JB + PX_Z:
            return "ring", 0
        if r - rin < PX_Z * 1.3:
            return "low", 0
        if h < 0.12 and abs(index - count // 2) > 1:
            return "crack", 0
        return "body", (1 if index == count // 2 else 2 * (index % 2))

    def soffit(self, along, z):
        if not self.arch:
            return False
        ca, spring, rin, rout, count = self.arch
        theta = math.atan2(max(z - spring, 0.0), along - ca)
        step = math.pi / count
        index = min(count - 1, int(theta / step))
        return min(theta - index * step, (index + 1) * step - theta) * rin < JH * 1.1

    def face(self, along, z, along_is_x, point, b):
        end = (self.axis == "x") != along_is_x
        if self.arch and not end:
            result = self.arch_face(along, z)
            if result:
                return result
        k = self.course(z)
        z0, z1 = self.levels[k], self.levels[k + 1]
        top_gap, bot_gap = z1 - z, z - z0
        cuts = self.end_cuts(k) if end else self.cuts(k)
        j = max(0, min(len(cuts) - 2, bisect.bisect_right(cuts, along) - 1))
        a0, a1 = cuts[j], cuts[j + 1]
        s0, s1 = along - a0, a1 - along
        h = ihash(k * 31 + j, 3 if end else 5, self.salt)
        if top_gap < JB or min(s0, s1) < JH:
            return "joint", 0
        # Chipped arrises bite into block corners.
        if top_gap < 0.085 and min(s0, s1) < 0.075 and h < 0.4:
            return "joint", 0
        if (round(along * 22), round(z * 27)) in self.crack_cells:
            return "crack", 0
        variant = int(h * 11) % 4
        if not end and 0 < k < len(self.levels) - 3 and ihash(k, j, self.salt + 9) < self.recess:
            if bot_gap < PX_Z * 1.5:
                return "sill", 0
            if min(s0, s1) > 0.05 and top_gap > 0.06:
                return "recess", 0
        lead = s1 if along_is_x else s0  # the block's screen-left end
        if top_gap < JB + ARRIS or lead < JH + 0.04:
            return "hi", variant
        if bot_gap < PX_Z:
            return "low", variant
        return "body", variant


class Beds:
    """Horizontal beds only: drums, plinth courses, lintels with mouldings."""

    axis = None

    def __init__(self, levels, salt, grooves=()):
        self.levels, self.salt, self.grooves = levels, salt, grooves

    def face(self, along, z, along_is_x, point, b):
        k = max(0, min(len(self.levels) - 2, bisect.bisect_right(self.levels, z) - 1))
        top_gap, bot_gap = self.levels[k + 1] - z, z - self.levels[k]
        if any(abs(z - g) < PX_Z * 0.6 for g in self.grooves):
            return "joint", 0
        if any(0 < g - z < PX_Z * 1.5 for g in self.grooves):
            return "low", 0
        if top_gap < JB:
            return "joint", 0
        if top_gap < JB + ARRIS:
            return "hi", k
        if bot_gap < PX_Z:
            return "low", k
        grain = vnoise(along * 6.0 + k, z * 5.0, self.salt)
        if grain > 0.84:
            return "crack", 0
        return "body", int(ihash(k, 1, self.salt) * 7) % 4


class DrumCaps(Beds):
    """Lying drums: plain body; caps show the dowel socket and a worn rim."""

    def __init__(self, drums, salt):
        super().__init__([0.0, 9.0], salt)
        self.drums = drums

    def face(self, along, z, along_is_x, point, b):
        x, y, _ = point
        for drum in self.drums:
            if abs(abs(x - drum.cx) - drum.hx) < 0.06 and abs(y - drum.yc) < drum.radius:
                r = math.hypot(y - drum.yc, z - drum.zc)
                if r < 0.055:
                    return "recess", 0
                if r > drum.radius - 0.05:
                    return "hi", 0
                if abs(r - drum.radius * 0.55) < 0.016:
                    return "carve", 0
                return "body", 1
        grain = vnoise(x * 4.0, y * 4.0 + z * 6.0, self.salt)
        return ("crack" if grain > 0.86 else "body"), 0


GLYPHS = [("010", "111", "010", "010"), ("110", "101", "110", "100"), ("101", "010", "101", "010"),
          ("111", "010", "010", "111"), ("010", "101", "101", "010"), ("100", "111", "001", "001")]


class RuneVeins(Beds):
    """Dais stones whose tops carry cracks that glow magenta while the seal holds."""

    def __init__(self, levels, salt, veins):
        super().__init__(levels, salt)
        self.veins = veins

    def top(self, x, y, zt):
        if (round(x * GRID), round(y * GRID)) in self.veins:
            return "RUNE2"
        return None


# ------------------------------ wall builders ------------------------------

def course_levels(height, course=0.42):
    return [round(course * k, 4) for k in range(int(height / course) + 2)]


def wall_blocks(masonry, a0, a1, profile, salt, moss=0.5, top_moss=0.62, warm_every=3):
    """Course blocks standing under a broken profile(a) (in courses), along masonry.axis."""
    rng = random.Random(salt)
    blocks = []
    levels = masonry.levels
    for k in range(len(levels) - 1):
        z0, z1 = levels[k], levels[k + 1]
        for c0, c1 in zip(masonry.cuts(k), masonry.cuts(k)[1:]):
            lo, hi = max(c0, a0), min(c1, a1)
            if hi - lo < 0.05:
                continue
            standing = profile((lo + hi) / 2) + 0.6 * (ihash(k, round(lo * 100), salt) - 0.5)
            if k + 0.5 > standing:
                continue
            top = k + 1.5 > standing
            b0, b1 = masonry.b0, masonry.b1
            if top and rng.random() < 0.3:
                shift = rng.uniform(-0.05, 0.05)
                b0, b1 = b0 + max(0.0, shift), b1 + min(0.0, shift)
            plan = (lo, hi, b0, b1) if masonry.axis == "x" else (b0, b1, lo, hi)
            blocks.append(Block(*plan, z0, z1 - (rng.uniform(0.0, 0.035) if top else 0.0), salt * 1000 + k * 40 + len(blocks),
                                corner=0.05, bevel=0.06 if top else 0.03, chips=rng.randint(1, 3) if top else 0,
                                tilt=((rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05)) if top else (0.0, 0.0)),
                                moss=top_moss if top else moss, warm=(len(blocks) % warm_every == 0), pattern=masonry))
    return blocks


def loose_blocks(rng, f, spots, salt, pattern=None, moss=0.55):
    """Fallen stones resting on whatever the field holds under their centre."""
    result = []
    for n, (x, y, w, d, h) in enumerate(spots):
        base = f.xy(x, y) if f else 0.0
        result.append(Block(x - w / 2, x + w / 2, y - d / 2, y + d / 2, base, base + h, salt + n * 7,
                            corner=0.05, bevel=0.05, chips=rng.randint(1, 3), tilt=(rng.uniform(-0.18, 0.18), rng.uniform(-0.18, 0.18)),
                            moss=moss, warm=n % 2 == 0, pattern=pattern))
    return result


def opening_rules(axis, ca, half, sill, spring):
    """Grounded and floating carve rules for a round-headed opening in a wall."""
    def along(x, y):
        return x if axis == "x" else y

    def ground(x, y, top, floor):
        a = along(x, y)
        if abs(a - ca) >= half:
            return floor, top
        if sill <= 0:
            return None
        return floor, min(top, sill)

    def vault(x, y, top, floor):
        a = along(x, y)
        if abs(a - ca) >= half:
            return None
        head = spring + math.sqrt(max(0.0, half * half - (a - ca) ** 2))
        return (head, top) if top > head + 0.04 else None
    return ground, vault


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


def top_grass(cv, f, points, salt):
    """Short blades growing out of joints on a ruin's top."""
    rng = random.Random(salt)
    oid = cv.new_oid()
    for x, y in points:
        z = f.xy(x, y)
        bx, by = cv.project(x, y, z)
        depth = VIEW[0] * x + VIEW[1] * y + VIEW[2] * z + 0.05
        for _ in range(rng.randint(3, 5)):
            ox = rng.uniform(-3, 3)
            length = rng.randint(3, 6)
            lean = rng.uniform(-0.5, 0.5)
            for step in range(length):
                t = step / length
                cv.put(math.floor(bx + ox + lean * step), math.floor(by - step), depth + 0.01 * step,
                       "G_HI" if t > 0.6 else "G1" if t > 0.25 else "G2", oid, ROD, None)


def ivy_curtain(cv, f, axis, face, spans, salt, lit):
    """Ivy hanging from a wall top down one visible face (face = plane coordinate)."""
    rng = random.Random(salt)
    oid = cv.new_oid()
    leaf = ("B_HI", "B1", "B2") if lit else ("B1", "B2", "B3")
    style = {"seam": "F4", "seamGap": 0.2}
    inset = -0.02
    for a0, a1, reach in spans:
        for _ in range(int((a1 - a0) * 26)):
            a = rng.uniform(a0, a1)
            x, y = (a, face + inset) if axis == "x" else (face + inset, a)
            z = f.xy(x - (0.03 if axis == "y" else 0), y - (0.03 if axis == "x" else 0)) - 0.02
            length = reach * rng.uniform(0.35, 1.0)
            wander = rng.uniform(-0.04, 0.04)
            zz = z
            while zz > z - length and zz > 0.05:
                px = x + (wander * (z - zz) if axis == "x" else 0.0)
                py = y + (wander * (z - zz) if axis == "y" else 0.0)
                sx, sy = cv.project(px + (0.012 if axis == "y" else 0), py + (0.012 if axis == "x" else 0), zz)
                depth = VIEW[0] * px + VIEW[1] * py + VIEW[2] * zz + 0.06
                if rng.random() < 0.55:
                    w, h = rng.choice(((2, 2), (3, 2), (2, 3)))
                    for dy in range(h):
                        for dx in range(w):
                            tone = leaf[0] if (dx == 0 and dy == 0 and rng.random() < 0.7) else leaf[1] if dy < h - 1 else leaf[2]
                            cv.put(math.floor(sx) + dx - 1, math.floor(sy) + dy, depth, tone, oid, ROUND, style)
                else:
                    cv.put(math.floor(sx), math.floor(sy), depth, leaf[2], oid, ROUND, style)
                zz -= rng.uniform(0.05, 0.09)


def ivy_top(cv, f, points, salt, radius=0.18):
    """Leafy clumps lying over a wall top."""
    rng = random.Random(salt)
    oid = cv.new_oid()
    for x0, y0 in points:
        for _ in range(int(radius * 120)):
            a = rng.uniform(0, math.tau)
            r = radius * math.sqrt(rng.random())
            x, y = x0 + r * math.cos(a), y0 + r * math.sin(a)
            z = f.xy(x, y)
            if z <= 0.05:
                continue
            sx, sy = cv.project(x, y, z + 0.02)
            depth = VIEW[0] * x + VIEW[1] * y + VIEW[2] * z + 0.06
            tone = "B_HI" if rng.random() < 0.3 else "B1" if rng.random() < 0.6 else "B2"
            for dx, dy in ((0, 0), (1, 0), (0, 1)):
                cv.put(math.floor(sx) + dx, math.floor(sy) + dy - 1, depth, tone if dy == 0 else "B2", oid, ROUND, None)


def draw_wall(cv, axis, a0, a1, thick, profile, salt, height=3.0, opening=None, rubble=(), ivy=None,
              grass=(), tops=(), cracks=2, recess=0.035):
    b0, b1 = -thick / 2, thick / 2
    arch = None
    if opening:
        ca, half, sill, spring, ring, count = opening
        arch = (ca, spring, half, half + ring, count)
    masonry = Masonry(axis, b0, b1, salt, course_levels(height), arch=arch, recess=recess, cracks=cracks,
                      crack_span=(a0 + 0.2, a1 - 0.2))
    blocks = wall_blocks(masonry, a0, a1, profile, salt)
    rng = random.Random(salt + 5)
    if rubble:
        f0 = mass_field(blocks)
        blocks += loose_blocks(rng, f0, rubble, salt * 3 + 1)
    f = mass_field(blocks)
    if opening:
        ground, vault = opening_rules(axis, ca, half, sill, spring)
        draw_mass(cv, blocks, carve(f, ground))
        draw_mass(cv, blocks, carve(f, vault), floating=True)
    else:
        draw_mass(cv, blocks, f)
    if ivy:
        ivy_curtain(cv, f, axis, b1, ivy, salt + 11, lit=axis == "y")
    if tops:
        ivy_top(cv, f, tops, salt + 13)
    if grass:
        top_grass(cv, f, grass, salt + 17)
    along = [a for a in (a0 + (a1 - a0) * t for t in (0.12, 0.45, 0.83))
             if not opening or abs(a - opening[0]) > opening[1] + 0.2]
    face_points = [(a, b1 + 0.02) if axis == "x" else (b1 + 0.02, a) for a in along]
    base_grass(cv, face_points, salt + 19)
    return f


# ------------------------------ wall frames --------------------------------

RUN_PROFILE = [(-2.0, 5.3), (-1.45, 6.2), (-0.9, 5.6), (-0.35, 4.6), (0.3, 4.1), (0.9, 5.0), (1.5, 5.6), (2.0, 4.9)]
WINDOW_PROFILE = [(-2.0, 4.6), (-1.3, 5.6), (-0.6, 6.8), (0.5, 7.0), (1.2, 6.1), (2.0, 5.0)]
END_PROFILE = [(-1.5, 5.6), (-0.7, 5.5), (-0.45, 4.9), (-0.2, 3.0), (0.3, 2.6), (0.55, 3.3), (0.8, 1.7), (1.15, 1.3), (1.5, 0.7)]
BREACH_PROFILE = [(-2.0, 5.0), (-1.2, 5.5), (-0.85, 4.0), (-0.55, 1.6), (0.65, 1.4), (0.95, 3.4), (1.4, 4.7), (2.0, 4.4)]


def draw_wall_run(cv, axis):
    draw_wall(cv, axis, -2.0, 2.0, 0.8, lambda a: lerp_points(RUN_PROFILE, a), 401 if axis == "x" else 411,
              grass=[(-1.45, 0.0) if axis == "x" else (0.0, -1.45)], cracks=2)


def draw_wall_window(cv, axis):
    draw_wall(cv, axis, -2.0, 2.0, 0.8, lambda a: lerp_points(WINDOW_PROFILE, a), 421 if axis == "x" else 431,
              height=3.4, opening=(0.15, 0.5, 0.84, 1.68, 0.34, 7), cracks=1,
              ivy=[(1.2, 1.9, 1.3)] if axis == "y" else [(-1.9, -1.3, 0.9)],
              tops=[(1.4, 0.0) if axis == "x" else (0.0, 1.4)])


def draw_wall_end(cv, axis):
    rubble = [(1.15, 0.05, 0.36, 0.3, 0.2), (0.85, -0.18, 0.28, 0.26, 0.16), (1.35, 0.22, 0.2, 0.18, 0.12)]
    if axis == "y":
        rubble = [(y, x, d, w, h) for x, y, w, d, h in rubble]
    draw_wall(cv, axis, -1.5, 1.5, 0.8, lambda a: lerp_points(END_PROFILE, a), 441 if axis == "x" else 451,
              rubble=rubble, ivy=[(-1.4, -0.5, 1.6)] if axis == "y" else [(-1.4, -0.9, 1.0)],
              tops=[(-1.2, 0.05) if axis == "x" else (0.05, -1.2)], cracks=1)


def draw_wall_breach(cv):
    rubble = [(-0.2, 0.0, 0.42, 0.36, 0.22), (0.3, -0.12, 0.34, 0.3, 0.2), (0.05, 0.2, 0.26, 0.24, 0.14),
              (0.55, 0.15, 0.22, 0.2, 0.12), (-0.45, -0.18, 0.24, 0.22, 0.14)]
    draw_wall(cv, "x", -2.0, 2.0, 0.8, lambda a: lerp_points(BREACH_PROFILE, a), 461, rubble=rubble,
              grass=[(0.1, -0.1), (-1.5, 0.05)], tops=[(1.6, 0.0)], cracks=1)


def draw_wall_corner(cv):
    """Inner back corner: arms run from the corner along +x and +y."""
    levels = course_levels(3.2)
    mx = Masonry("x", -1.5, -0.7, 471, levels, cracks=1, crack_span=(-0.5, 1.2))
    my = Masonry("y", -1.5, -0.7, 481, levels, cracks=1, crack_span=(-0.5, 1.2))
    blocks = wall_blocks(mx, -1.5, 1.5, lambda a: lerp_points([(-1.5, 7.0), (-0.5, 6.8), (-0.2, 5.6), (0.5, 5.2), (0.8, 3.9), (1.5, 3.6)], a), 471)
    blocks += wall_blocks(my, -1.5, 1.5, lambda a: lerp_points([(-1.5, 7.0), (-0.6, 6.6), (-0.3, 4.8), (0.6, 4.5), (0.9, 2.9), (1.5, 2.6)], a), 481)
    f = mass_field(blocks)
    draw_mass(cv, blocks, f)
    ivy_curtain(cv, f, "y", -0.7, [(-0.6, 0.4, 1.8)], 487, lit=True)
    ivy_top(cv, f, [(-1.1, -1.1), (-1.1, -0.2)], 489, radius=0.22)
    base_grass(cv, [(1.2, -0.68), (-0.68, 1.2), (-0.6, -0.6)], 491)


def draw_arch_gate(cv):
    profile = [(-2.2, 8.6), (-1.7, 9.4), (-1.0, 9.6), (-0.3, 10.1), (0.4, 10.0), (0.9, 8.9), (1.5, 8.2), (2.2, 7.4)]
    f = draw_wall(cv, "x", -2.2, 2.2, 0.9, lambda a: lerp_points(profile, a), 501, height=4.4,
                  opening=(0.0, 1.25, 0.0, 1.68, 0.47, 11), cracks=2, recess=0.03,
                  ivy=[(1.4, 2.1, 2.2)], tops=[(-1.6, 0.0)], grass=[(0.6, 0.1)])
    return f


def draw_parapet(cv, axis):
    levels = [0.0, 0.27, 0.54, 0.76]
    salt = 511 if axis == "x" else 521
    masonry = Masonry(axis, -0.3, 0.3, salt, levels, long_courses={2: (0.9, 1.3)}, recess=0.0, cracks=1,
                      crack_span=(-1.6, 1.6))
    profile = lambda a: lerp_points([(-2.0, 2.6), (0.2, 2.6), (0.45, 1.6), (0.95, 1.6), (1.15, 2.6), (2.0, 2.6)], a)
    blocks = wall_blocks(masonry, -2.0, 2.0, profile, salt, top_moss=0.55)
    f = mass_field(blocks)
    draw_mass(cv, blocks, f)
    side = (lambda a: (a, 0.32)) if axis == "x" else (lambda a: (0.32, a))
    base_grass(cv, [side(-1.4), side(0.7), side(1.7)], salt + 7)
    top_grass(cv, f, [(0.7, 0.0) if axis == "x" else (0.0, 0.7)], salt + 9)


def draw_parapet_corner(cv):
    """Outer front corner: arms run from the corner along -x and -y."""
    levels = [0.0, 0.27, 0.54, 0.76]
    mx = Masonry("x", 0.9, 1.5, 531, levels, long_courses={2: (0.9, 1.3)}, recess=0.0)
    my = Masonry("y", 0.9, 1.5, 541, levels, long_courses={2: (0.9, 1.3)}, recess=0.0)
    blocks = wall_blocks(mx, -1.5, 1.5, lambda a: lerp_points([(-1.5, 2.0), (-1.0, 2.6), (1.5, 2.6)], a), 531)
    blocks += wall_blocks(my, -1.5, 1.5, lambda a: lerp_points([(-1.5, 1.6), (-0.9, 2.6), (1.5, 2.6)], a), 541)
    f = mass_field(blocks)
    draw_mass(cv, blocks, f)
    base_grass(cv, [(1.52, -0.8), (-0.6, 1.52), (1.5, 1.5)], 547)


# ------------------------------ columns ------------------------------------

def plinth_blocks(salt):
    beds = Beds([0.0, 0.14, 0.28, 0.37], salt)
    return [Block(-0.5, 0.5, -0.5, 0.5, 0.0, 0.14, salt + 1, corner=0.04, bevel=0.04, chips=2, moss=0.5, pattern=beds),
            Block(-0.42, 0.42, -0.42, 0.42, 0.14, 0.28, salt + 2, corner=0.04, bevel=0.04, chips=1, moss=0.4, warm=True,
                  pattern=beds),
            Block(-0.35, 0.35, -0.35, 0.35, 0.28, 0.37, salt + 3, bevel=0.06, round_plan=True, moss=0.3, pattern=beds)]


def drum_stack(salt, top, radius=0.29, broken=False):
    rng = random.Random(salt)
    levels = [0.37]
    while levels[-1] < top - 0.3:
        levels.append(levels[-1] + rng.uniform(0.46, 0.56))
    levels[-1] = top
    beds = Beds(levels, salt + 7)
    blocks = []
    for k in range(len(levels) - 1):
        ox, oy = (rng.uniform(-0.018, 0.018), rng.uniform(-0.018, 0.018)) if k else (0.0, 0.0)
        last = k == len(levels) - 2
        blocks.append(Block(-radius + ox, radius + ox, -radius + oy, radius + oy, levels[k], levels[k + 1], salt + 10 + k,
                            bevel=0.05 if not (broken and last) else 0.02, round_plan=True, pattern=beds,
                            chips=3 if broken and last else 0, chip=(0.12, 0.24), chip_depth=(0.2, 0.42),
                            tilt=(0.22, -0.14) if broken and last else (0.0, 0.0), rough=0.09 if broken and last else 0.02,
                            moss=0.55 if last else 0.18))
    return blocks


def floating(cv, blocks, floor_z):
    f = mass_field(blocks)
    draw_mass(cv, blocks, carve(f, lambda x, y, top, fl: (floor_z, top)), floating=True)


def draw_column_intact(cv):
    blocks = plinth_blocks(601) + drum_stack(611, 2.9)
    draw_mass(cv, blocks)
    beds = Beds([2.9, 2.97, 3.1, 3.27], 621)
    floating(cv, [Block(-0.315, 0.315, -0.315, 0.315, 2.9, 2.97, 622, bevel=0.03, round_plan=True, pattern=beds)], 2.9)
    floating(cv, [Block(-0.37, 0.37, -0.37, 0.37, 2.97, 3.1, 623, bevel=0.07, round_plan=True, pattern=beds, moss=0.2)], 2.97)
    floating(cv, [Block(-0.42, 0.42, -0.42, 0.42, 3.1, 3.27, 624, corner=0.04, bevel=0.05, chips=2, pattern=beds,
                        moss=0.65, warm=True)], 3.1)
    base_grass(cv, [(0.52, 0.2), (0.15, 0.52)], 627)


def draw_column_broken(cv):
    blocks = plinth_blocks(631) + drum_stack(641, 1.72, broken=True)
    blocks.append(Block(0.08, 0.38, 0.22, 0.44, 0.28, 0.44, 647, corner=0.06, bevel=0.05, chips=2, moss=0.6,
                        tilt=(0.15, 0.1)))
    f = mass_field(blocks)
    draw_mass(cv, blocks, f)
    ivy_curtain(cv, f, "y", 0.27, [(-0.25, 0.05, 1.1)], 649, lit=True)
    base_grass(cv, [(0.52, -0.1), (0.3, 0.52), (-0.3, 0.52)], 651)


def draw_column_drums(cv):
    drums = [LyingDrum(-1.45, -0.55, -0.12, 0.29, 661, chips=2, chip=(0.1, 0.18), chip_depth=(0.05, 0.1), moss=0.5),
             LyingDrum(-0.42, 0.42, 0.05, 0.29, 662, chips=1, chip=(0.1, 0.18), chip_depth=(0.05, 0.1), moss=0.45)]
    caps = DrumCaps(drums, 663)
    for drum in drums:
        drum.pattern = caps
    for drum in drums:
        f = mass_field([drum])
        draw_mass(cv, [drum], carve(f, lambda x, y, top, fl: (fl, top)), floating=True)
    beds = Beds([0.0, 0.3, 0.42], 665)
    standing = [Block(0.62, 1.2, -0.4, 0.18, 0.0, 0.42, 666, round_plan=True, bevel=0.05, chips=2, chip=(0.12, 0.2),
                      chip_depth=(0.08, 0.16), moss=0.6, pattern=beds),
                Block(0.66, 1.45, 0.08, 0.48, 0.0, 0.22, 667, corner=0.04, bevel=0.05, chips=2, moss=0.55, warm=True,
                      tilt=(0.1, -0.12), pattern=Beds([0.0, 0.22], 668))]
    f = mass_field(standing)
    draw_mass(cv, standing, f)
    base_grass(cv, [(-0.9, 0.2), (0.2, 0.36), (1.2, 0.5)], 669)


# ------------------------------ ritual plinth -------------------------------

DAIS_OUTER, DAIS_TIER, DAIS_SOCKET, DAIS_CHAMFER = 2.0, 1.5, 1.0, 3.4


def octagon_sdf(x, y, apothem, chamfer=None):
    """Signed distance to a square of half `apothem` with its corners cut at |x|+|y| = chamfer."""
    chamfer = apothem * SQ2 if chamfer is None else chamfer
    return max(abs(x) - apothem, abs(y) - apothem, (abs(x) + abs(y) - chamfer) / SQ2)


class DaisStone(Block):
    """A rim stone of the ritual dais: a plan rectangle clipped by the dais octagon."""

    snap = False  # the chamfered sides run at 45 degrees

    def edge(self, x, y):
        return max(super().edge(x, y), octagon_sdf(x, y, DAIS_OUTER, DAIS_CHAMFER))


def plinth_veins():
    """Radial cracks across both rim tiers that glow magenta while the seal holds."""
    rng = random.Random(709)
    cells = set()
    for angle in (0.35, 1.2, 2.05, 2.9, 3.6, 4.5, 5.3, 6.0):
        r = DAIS_SOCKET + 0.03
        a = angle
        while r < DAIS_OUTER - 0.03:
            x, y = r * math.cos(a), r * math.sin(a)
            if octagon_sdf(x, y, DAIS_OUTER, DAIS_CHAMFER) > -0.03:
                break
            cells.add((round(x * GRID), round(y * GRID)))
            a += rng.uniform(-0.05, 0.05)
            r += 0.02
    return cells


def plinth_drawing(cv):
    """Flat octagonal stepped dais (4 x 4u) around a ground-level square socket
    (half 1.0u) where the ritual source's own pedestal stands."""
    cracks = plinth_veins()
    veins, low_veins = RuneVeins([0.0, 0.12], 701, cracks), RuneVeins([0.0, 0.06], 702, cracks)
    s, t, o = DAIS_SOCKET, DAIS_TIER, DAIS_OUTER
    blocks = []
    # Inner tier (0.12u): a square frame of side stones and corner stones round the socket.
    pieces = [(s, t, -s, 0.0), (s, t, 0.0, s), (-t, -s, -s, 0.0), (-t, -s, 0.0, s),
              (-s, 0.0, s, t), (0.0, s, s, t), (-s, 0.0, -t, -s), (0.0, s, -t, -s),
              (s, t, s, t), (-t, -s, s, t), (s, t, -t, -s), (-t, -s, -t, -s)]
    for n, (x0, x1, y0, y1) in enumerate(pieces):
        blocks.append(DaisStone(x0, x1, y0, y1, 0.0, 0.12, 710 + n, corner=0.03, bevel=0.03, chips=1,
                                chip_depth=(0.02, 0.05), moss=0.45 if n >= 8 else 0.32, warm=n % 2 == 0, pattern=veins))
    # Outer tier (0.06u): a ring of long kerbs and chamfered corner stones.
    ring_pieces = []
    for a0, a1 in ((-t, -0.5), (-0.5, 0.5), (0.5, t)):
        ring_pieces += [(t, o, a0, a1), (-o, -t, a0, a1), (a0, a1, t, o), (a0, a1, -o, -t)]
    ring_pieces += [(t, o, t, o), (-o, -t, t, o), (t, o, -o, -t), (-o, -t, -o, -t)]
    for n, (x0, x1, y0, y1) in enumerate(ring_pieces):
        blocks.append(DaisStone(x0, x1, y0, y1, 0.0, 0.06, 730 + n, corner=0.03, bevel=0.025, chips=1,
                                chip_depth=(0.01, 0.03), moss=0.55 if n >= 12 else 0.45, warm=n % 2 == 1, pattern=low_veins))
    # The socket floor lies at ground level: four worn slabs.
    colors = {}
    for px, py, x, y in ground_pixels(cv, s - 0.01, s - 0.01):
        joint = min(abs(x), abs(y)) < 0.022
        g = vnoise(x * 6, y * 6, 745)
        colors[(px, py)] = "S_SH" if joint else "S3" if g > 0.55 else "S4"
    put_flat(cv, None, colors, cv.new_oid())
    f = mass_field(blocks)
    draw_mass(cv, blocks, f)
    # Carved glyphs along the inner tier, around the source.
    for side in range(4):
        for k in range(-3, 4):
            along = k * 0.36
            x, y = [(1.25, along), (-1.25, along), (along, 1.25), (along, -1.25)][side]
            sx, sy = cv.project(x, y, 0.12)
            glyph = GLYPHS[(side * 7 + k + 3) % len(GLYPHS)]
            for gy, row in enumerate(glyph):
                for gx, bit in enumerate(row):
                    px, py = math.floor(sx) + gx - 1, math.floor(sy) + gy - 2
                    i = py * CELL + px
                    if bit == "1" and 0 <= px < CELL and 0 <= py <= LAST_ROW and cv.color[i] and cv.face[i] == TOP:
                        cv.color[i] = "RUNE_HI" if gy == 0 else "RUNE1"
    return f


# ------------------------------ fallen masonry ------------------------------

def draw_fallen_block(cv):
    blocks = [Block(-0.58, 0.58, -0.43, 0.43, 0.0, 0.52, 801, corner=0.06, bevel=0.06, chips=3, chip_depth=(0.08, 0.18),
                    tilt=(0.12, -0.07), moss=0.55, warm=True, pattern=Beds([0.0, 0.52], 802, grooves=(0.16, 0.2)))]
    f = mass_field(blocks)
    draw_mass(cv, blocks, f)
    ivy_top(cv, f, [(-0.35, -0.25)], 805, radius=0.12)
    base_grass(cv, [(0.58, 0.1), (0.2, 0.44)], 807)


def draw_fallen_lintel(cv):
    mould = (0.1, 0.3)
    blocks = [Block(-1.3, -0.06, -0.3, 0.3, 0.0, 0.44, 811, corner=0.05, bevel=0.05, chips=2, chip=(0.12, 0.2),
                    tilt=(0.04, 0.02), moss=0.5, pattern=Beds([0.0, 0.44], 812, grooves=mould)),
              Block(0.02, 1.3, -0.3, 0.3, 0.0, 0.4, 813, corner=0.05, bevel=0.05, chips=3, chip=(0.12, 0.22),
                    tilt=(-0.08, 0.03), moss=0.55, warm=True, pattern=Beds([0.0, 0.4], 814, grooves=mould))]
    f = mass_field(blocks)
    draw_mass(cv, blocks, f)
    base_grass(cv, [(1.28, 0.1), (0.0, 0.32), (-1.0, 0.32)], 817)


def draw_fallen_blocks(cv):
    rng = random.Random(821)
    blocks = [Block(-0.1, 0.8, -0.8, 0.0, 0.0, 0.42, 822, corner=0.05, bevel=0.06, chips=2, moss=0.55,
                    pattern=Beds([0.0, 0.42], 823)),
              Block(-0.8, 0.02, -0.06, 0.8, 0.0, 0.38, 824, corner=0.05, bevel=0.06, chips=2, moss=0.5, warm=True,
                    pattern=Beds([0.0, 0.38], 825)),
              Block(0.2, 0.8, 0.08, 0.6, 0.0, 0.24, 826, corner=0.05, bevel=0.05, chips=1, moss=0.6)]
    f0 = mass_field(blocks)
    blocks += loose_blocks(rng, f0, [(0.08, -0.02, 0.66, 0.5, 0.32)], 827)
    f = mass_field(blocks)
    draw_mass(cv, blocks, f)
    base_grass(cv, [(0.8, -0.4), (-0.4, 0.8), (0.82, 0.5)], 829)


def rubble_spots(rng, hw, hd, count, big):
    spots = []
    for n in range(count):
        a, r = rng.uniform(0, math.tau), math.sqrt(rng.random())
        x, y = math.cos(a) * r * (hw - 0.1), math.sin(a) * r * (hd - 0.1)
        size = (big if n < 4 else 1.0) * rng.uniform(0.2, 0.34) * (1.25 - 0.55 * r)
        spots.append((x, y, size * rng.uniform(0.9, 1.5), size * rng.uniform(0.8, 1.3), size * rng.uniform(0.6, 1.0)))
    return spots


def corner_stones(rng, hw, hd, size, salt):
    """Spilled stones on the front and both screen-side footprint corners, so a
    body walking into the heap's box stops at drawn stone."""
    stones = []
    for n, (sx, sy) in enumerate(((1, 1), (1, -1), (-1, 1))):
        w, d = size * rng.uniform(0.9, 1.2), size * rng.uniform(0.8, 1.1)
        x0, x1 = (hw - w, hw) if sx > 0 else (-hw, -hw + w)
        y0, y1 = (hd - d, hd) if sy > 0 else (-hd, -hd + d)
        stones.append(Block(x0, x1, y0, y1, 0.0, size * rng.uniform(0.55, 0.75), salt + n * 3, corner=0.02, bevel=0.035,
                            wobble=0.0, chips=1, chip_depth=(0.02, 0.05), moss=0.45, warm=n == 1,
                            tilt=(rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1))))
    return stones


def draw_rubble_pile(cv):
    """Broken masonry settled into a low heap: no stone rises above the heap profile."""
    rng = random.Random(901)
    blocks = []
    f = None
    for x, y, w, d, h in sorted(rubble_spots(rng, 0.9, 0.8, 34, 1.7), key=lambda s: -s[2] * s[3]):
        heap = 0.62 * max(0.0, 1 - (x / 0.9) ** 2 - (y / 0.8) ** 2) ** 0.7
        base = max(0.0, min(f.xy(x, y) if f else 0.0, heap - h * 0.6))
        blocks.append(Block(x - w / 2, x + w / 2, y - d / 2, y + d / 2, base, base + h, 902 + len(blocks) * 7,
                            corner=0.05, bevel=0.05, chips=rng.randint(1, 3),
                            tilt=(rng.uniform(-0.14, 0.14), rng.uniform(-0.14, 0.14)), moss=0.5, warm=len(blocks) % 2 == 0))
        f = mass_field(blocks)
    blocks += corner_stones(rng, 0.9, 0.8, 0.24, 960)
    f = mass_field(blocks)
    draw_mass(cv, blocks, f)
    top_grass(cv, f, [(-0.3, 0.2), (0.4, -0.3)], 905)
    base_grass(cv, [(0.85, 0.1), (0.1, 0.78)], 907)


# ------------------------------ flat ground frames --------------------------

def ground_pixels(cv, hw, hd):
    corners = [cv.project(x, y, 0) for x in (-hw, hw) for y in (-hd, hd)]
    left, right, top, bottom = cv.bounds(corners)
    for py in range(top, bottom + 1):
        dv = py + 0.5 - cv.cy
        for px in range(left, right + 1):
            du = px + 0.5 - cv.cx
            x, y = (2 * dv - du) / (32 * SQ2), (2 * dv + du) / (32 * SQ2)
            if abs(x) <= hw and abs(y) <= hd:
                yield px, py, x, y


def put_flat(cv, labels, colors, oid):
    for (px, py), color in colors.items():
        cv.put(px, py, -9.0, color, oid, TOP, {"flat": True})


def blob(x, y, hw, hd, salt, rough=0.35):
    d = (x / hw) ** 2 + (y / hd) ** 2
    return d < 1 - rough * vnoise(x * 3.2 + 5, y * 3.2, salt) - 0.15 * vnoise(x * 9, y * 9, salt + 1)


def edge_lights(labels, colors, key, lit, dark):
    """Screen-space lips: upper-left edges catch the light, lower-right edges fall dark."""
    for (px, py), label in labels.items():
        if label != key:
            continue
        if labels.get((px - 1, py)) != key or labels.get((px, py - 1)) != key:
            colors[(px, py)] = lit
        elif labels.get((px + 1, py)) != key or labels.get((px, py + 1)) != key:
            colors[(px, py)] = dark


def draw_flagstones_broken(cv):
    rng = random.Random(1001)
    hw, hd = 1.4, 1.1
    frags = []
    for n in range(7):
        frags.append((rng.uniform(-0.85, 0.85), rng.uniform(-0.6, 0.6), rng.uniform(0.18, 0.34), rng.uniform(0.14, 0.26),
                      rng.uniform(-0.6, 0.6), ("S1", "S2", "S3", "S4", "S2", "S1", "S3")[n]))
    labels, colors = {}, {}
    for px, py, x, y in ground_pixels(cv, hw, hd):
        if not blob(x, y, hw, hd, 1003):
            continue
        label = "soil"
        for n, (fx, fy, ax, ay, ang, tone) in enumerate(frags):
            u = (x - fx) * math.cos(ang) + (y - fy) * math.sin(ang)
            v = -(x - fx) * math.sin(ang) + (y - fy) * math.cos(ang)
            if abs(u) < ax and abs(v) < ay and (u / ax + v / ay) < 1.55 - 0.3 * (n % 2):
                label = n
        labels[(px, py)] = label
    for (px, py), label in labels.items():
        if label == "soil":
            x, y = ((2 * (py + 0.5 - cv.cy) - (px + 0.5 - cv.cx)) / (32 * SQ2), (2 * (py + 0.5 - cv.cy) + (px + 0.5 - cv.cx)) / (32 * SQ2))
            g = vnoise(x * 7, y * 7, 1005) * 0.7 + ihash(px, py, 1006) * 0.3
            colors[(px, py)] = "SOIL1" if g > 0.62 else "SOIL2" if g > 0.3 else "SOIL3"
        else:
            tone = frags[label][5]
            colors[(px, py)] = "S_SH" if ihash(px // 2, py, 1007 + label) < 0.06 else tone
    for n in range(len(frags)):
        edge_lights(labels, colors, n, "S_HI", "S_SH")
    for (px, py), label in labels.items():
        if label == "soil" and isinstance(labels.get((px - 1, py - 1)), int):
            colors[(px, py)] = "SOIL3"  # a fragment's cast shadow on the soil
        if label == "soil" and (labels.get((px - 1, py)) is None or labels.get((px, py - 1)) is None):
            colors[(px, py)] = "SOIL3"  # the hole's shaded upper-left wall
        if label == "soil" and (labels.get((px + 1, py)) is None or labels.get((px, py + 1)) is None):
            colors[(px, py)] = "S2"  # the paving lip facing the light
    oid = cv.new_oid()
    put_flat(cv, labels, colors, oid)
    grass_oid = cv.new_oid()
    soil = [p for p, label in sorted(labels.items()) if label == "soil"]
    for _ in range(9):
        px, py = soil[rng.randrange(len(soil))]
        for _ in range(rng.randint(2, 4)):
            ox, length, lean = rng.randint(-2, 2), rng.randint(3, 6), rng.uniform(-0.4, 0.4)
            for step in range(length):
                t = step / length
                cv.put(math.floor(px + ox + lean * step), py - step, -8.0, "G_HI" if t > 0.6 else "G1" if t > 0.25 else "G2",
                       grass_oid, ROD, {"flat": True})


def crack_walk(rng, start, angle, steps, cells, branch=0.0, depth=0):
    x, y = start
    for _ in range(steps):
        cells.add((x, y))
        angle += rng.uniform(-0.5, 0.5)
        x += math.cos(angle) * 0.03
        y += math.sin(angle) * 0.03
        if depth < 2 and rng.random() < branch:
            crack_walk(rng, (x, y), angle + rng.choice((-1, 1)) * rng.uniform(0.6, 1.2), steps // 2, cells, branch * 0.5, depth + 1)


def draw_flagstone_cracks(cv):
    rng = random.Random(1101)
    hw, hd = 1.3, 1.0
    cells = set()
    # A struck point with a star of cracks, plus one long settling crack.
    for angle, steps in ((2.4, 34), (-0.6, 30), (0.9, 22), (4.1, 18), (1.7, 14)):
        crack_walk(rng, (0.1, -0.05), angle, steps, cells, 0.12)
    crack_walk(rng, (-0.9, 0.7), 0.15, 30, cells, 0.06)
    crack_pixels = set()
    for x, y in cells:
        sx, sy = cv.project(x, y, 0)
        crack_pixels.add((math.floor(sx), math.floor(sy)))
        crack_pixels.add((math.floor(sx + 0.7), math.floor(sy)))
    chips = [(0.55, 0.45, 0.09), (-0.45, -0.4, 0.07), (0.9, -0.3, 0.06)]
    colors = {}
    inside = {(px, py) for px, py, x, y in ground_pixels(cv, hw, hd)}
    for px, py, x, y in ground_pixels(cv, hw, hd):
        for cxp, cyp, r in chips:
            if math.hypot(x - cxp, (y - cyp) * 1.3) < r * (0.8 + 0.4 * vnoise(x * 20, y * 20, 1103)):
                colors[(px, py)] = "S_SH"
    for p in sorted(crack_pixels):
        if p in inside:
            colors[p] = "Q_M"
    for (px, py) in sorted(list(colors)):
        if colors[(px, py)] in ("Q_M", "S_SH"):
            lip = (px + 1, py + 1)
            if lip in inside and lip not in colors:
                colors[lip] = "S_HI"
    mossy = sorted(p for p in crack_pixels if p in inside)
    for n, (px, py) in enumerate(mossy):
        if ihash(px, py, 1105) < 0.18:
            colors[(px, py)] = "M3"
            if (px, py - 1) not in colors and ihash(px, py, 1106) < 0.5:
                colors[(px, py - 1)] = "M2"
    oid = cv.new_oid()
    put_flat(cv, None, colors, oid)


def draw_moss_patch(cv):
    rng = random.Random(1201)
    hw, hd = 1.0, 0.8
    colors = {}
    for px, py, x, y in ground_pixels(cv, hw, hd):
        if not blob(x, y, hw, hd, 1203, rough=0.55):
            continue
        g = vnoise(x * 5, y * 5, 1205) * 0.6 + vnoise(x * 13, y * 13, 1206) * 0.4
        edge = (x / hw) ** 2 + (y / hd) ** 2
        if edge > 0.45 and ihash(px, py, 1207) < (edge - 0.45) * 1.4:
            continue
        colors[(px, py)] = ("M_HI" if g > 0.8 else "M1" if g > 0.6 else "M2" if g > 0.4 else "M3" if g > 0.24
                            else "G3")
    for (px, py) in sorted(list(colors)):
        if colors[(px, py)] in ("M1", "M_HI") and (px, py + 1) in colors and colors[(px, py + 1)] in ("M3",):
            colors[(px, py + 1)] = "G3"
    oid = cv.new_oid()
    put_flat(cv, None, colors, oid)
    leaf_oid = cv.new_oid()
    for _ in range(4):
        x, y = rng.uniform(-0.6, 0.6), rng.uniform(-0.45, 0.45)
        angle = rng.uniform(0, math.tau)
        for step in range(22):
            sx, sy = cv.project(x, y, 0)
            cv.put(math.floor(sx), math.floor(sy), -8.0, "B3", leaf_oid, ROD, {"flat": True})
            if step % 3 == 0:
                for dx, dy, tone in ((0, -1, "B_HI"), (1, -1, "B1"), (1, 0, "B2")):
                    cv.put(math.floor(sx) + dx, math.floor(sy) + dy, -7.9, tone, leaf_oid, ROD, {"flat": True})
            angle += rng.uniform(-0.6, 0.6)
            x += math.cos(angle) * 0.045
            y += math.sin(angle) * 0.045
            if abs(x) > hw - 0.1 or abs(y) > hd - 0.1:
                break


def draw_rubble_scatter(cv):
    rng = random.Random(1301)
    hw, hd = 1.2, 1.0
    colors = {}
    for px, py, x, y in ground_pixels(cv, hw, hd):
        if blob(x * 1.3, y * 1.3, hw, hd, 1303, rough=0.6) and ihash(px, py, 1304) < 0.5:
            g = vnoise(x * 6, y * 6, 1305)
            colors[(px, py)] = "SOIL1" if g > 0.55 else "SOIL2"
    oid = cv.new_oid()
    put_flat(cv, None, colors, oid)
    spots = []
    for n in range(24):
        a, r = rng.uniform(0, math.tau), math.sqrt(rng.random())
        size = rng.uniform(0.06, 0.16) * (1.25 - 0.5 * r)
        spots.append((math.cos(a) * r * (hw - 0.15), math.sin(a) * r * (hd - 0.15), size * rng.uniform(1.0, 1.6),
                      size * rng.uniform(0.8, 1.2), size * rng.uniform(0.4, 0.8)))
    blocks = loose_blocks(rng, None, spots, 1310, moss=0.3)
    for block in blocks:
        block.bevel, block.chips = 0.03, block.chips[:1]
    draw_mass(cv, blocks)


# ------------------------------ plants -------------------------------------

FOLIAGE = ("B_HI", "B1", "B2", "B3", "F4", "F4")


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


def draw_ivy_clump(cv):
    """Ivy climbing a broken masonry stub, with a leafy mound at its foot."""
    rng = random.Random(1401)
    stub = [Block(-0.26, 0.22, -0.28, 0.2, 0.0, 0.8, 1402, corner=0.05, bevel=0.05, chips=3, chip=(0.14, 0.24),
                  chip_depth=(0.14, 0.3), tilt=(0.18, -0.12), rough=0.06, moss=0.65,
                  pattern=Beds([0.0, 0.27, 0.54, 0.8], 1403))]
    f = mass_field(stub)
    draw_mass(cv, stub, f)
    ivy_curtain(cv, f, "y", 0.22, [(-0.27, 0.19, 0.85)], 1404, lit=True)
    ivy_curtain(cv, f, "x", 0.2, [(-0.25, 0.1, 0.55)], 1405, lit=False)
    ivy_top(cv, f, [(-0.05, -0.08)], 1406, radius=0.15)
    oid = cv.new_oid()
    tufts = []
    for lx, ly, lr, lh in ((0.3, 0.05, 0.16, 0.26), (0.05, 0.3, 0.15, 0.22), (0.3, 0.3, 0.12, 0.18), (-0.3, 0.25, 0.1, 0.16)):
        for _ in range(int(lr * 90)):
            a, r = rng.uniform(0, math.tau), lr * math.sqrt(rng.random())
            x, y = lx + math.cos(a) * r, ly + math.sin(a) * r
            z = lh * (1 - (r / lr) ** 2) ** 0.6 * rng.uniform(0.6, 1.0)
            sx, sy = cv.project(x, y, z)
            depth = VIEW[0] * x + VIEW[1] * y + VIEW[2] * z + 0.3
            side = 1 if math.cos(a) - math.sin(a) > 0.3 else 2 if math.cos(a) - math.sin(a) > -0.4 else 3
            tufts.append((depth, sx, sy, rng.uniform(4, 6.5), rng.uniform(3.5, 5.5), side - (1 if z > lh * 0.6 else 0)))
    for depth, sx, sy, w, h, tone in sorted(tufts):
        tuft(cv, sx, sy, w, h, tone, FOLIAGE, depth, oid, False)
    base_grass(cv, [(0.4, -0.2), (-0.2, 0.4)], 1409)


def bark(salt):
    def shade(n, p):
        b = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]
        grain = vnoise(p[0] * 10 + p[2] * 2.0, p[1] * 10 - p[2] * 2.0, salt) * 0.6 + vnoise(p[2] * 14, p[0] * 6, salt + 1) * 0.4
        tone = 3 if b > 0.62 else 2 if b > 0.3 else 1 if b > -0.08 else 0
        if grain > 0.7:
            tone -= 1
        if p[2] < 0.35 and grain < 0.3 and b > 0:
            return "M2"
        return ("T3", "T2", "T1", "Q_T3")[max(0, tone)]
    return shade


def grow(rng, start, direction, length, radius, depth, out, upward=0.18):
    pts = [start]
    d = direction
    p = start
    steps = max(3, int(length / 0.16))
    for _ in range(steps):
        d = _normalize((d[0] + rng.uniform(-0.32, 0.32), d[1] + rng.uniform(-0.32, 0.32), d[2] + rng.uniform(-0.12, 0.12) + upward))
        p = tuple(p[k] + d[k] * length / steps for k in range(3))
        pts.append(p)
    r_end = radius * 0.64
    out.append((pts, radius, r_end, depth))
    if depth == 0:
        return
    count = 2 if rng.random() < 0.55 else 3
    for c in range(count):
        a = rng.uniform(0, math.tau) if c else rng.uniform(-0.5, 0.5)
        tilt = rng.uniform(0.45, 0.95)
        side = (math.cos(a), math.sin(a), 0.0)
        child = _normalize((d[0] + side[0] * tilt, d[1] + side[1] * tilt, d[2] + 0.15))
        grow(rng, p, child, length * rng.uniform(0.55, 0.78), r_end * rng.uniform(0.7, 0.95), depth - 1, out, upward * 0.8)


def draw_limbs(cv, limbs, salt):
    shade = bark(salt)
    twig = {"flat": True}
    style = {"seam": "T3", "seamGap": 0.12}
    for n, (pts, r0, r1, depth) in enumerate(limbs):
        oid = cv.new_oid()
        total = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
        walked = 0.0
        for a, b in zip(pts, pts[1:]):
            seg = math.dist(a, b)
            t = 0.0
            while t < seg:
                f = (walked + t) / total
                r = r0 + (r1 - r0) * f
                p = tuple(a[k] + (b[k] - a[k]) * t / seg for k in range(3))
                if r >= 0.04:
                    cv.ellipsoid(p, (r, r, r), shade, style, oid=oid)
                    t += max(0.02, r * 0.4)
                else:
                    q = tuple(a[k] + (b[k] - a[k]) * min(seg, t + 0.03) / seg for k in range(3))
                    cv.rod(p, q, 1, ("T2", "T2", "T2"), twig, oid=oid)
                    t += 0.03
            walked += seg


def draw_roots(cv, rng, radius, count, salt):
    shade = bark(salt)
    oid = cv.new_oid()
    for k in range(count):
        a = k * math.tau / count + rng.uniform(-0.3, 0.3)
        reach = radius * rng.uniform(1.3, 2.0)
        for s in range(10):
            f = s / 9
            p = (math.cos(a) * reach * f, math.sin(a) * reach * f, 0.08 * (1 - f))
            r = radius * 0.55 * (1 - f) + 0.035
            cv.ellipsoid(p, (r, r, r * 0.7), shade, {"seam": "T3", "seamGap": 0.12}, oid=oid, floor=0.0)


def draw_dead_tree(cv):
    rng = random.Random(1501)
    limbs = []
    trunk = [(0.0, 0.0, 0.0)]
    d, p = (0.06, -0.04, 1.0), (0.0, 0.0, 0.0)
    for step in range(9):
        d = _normalize((d[0] + rng.uniform(-0.22, 0.22), d[1] + rng.uniform(-0.22, 0.22), 1.0))
        p = tuple(p[k] + d[k] * 0.24 for k in range(3))
        trunk.append(p)
    limbs.append((trunk, 0.24, 0.15, 3))
    for k, (a, tilt, length) in enumerate(((0.3, 0.8, 1.5), (2.6, 0.9, 1.3), (4.4, 0.7, 1.2))):
        start = trunk[-1 - (k % 2)]
        direction = _normalize((math.cos(a) * tilt, math.sin(a) * tilt, 1.0))
        grow(rng, start, direction, length, 0.13 - 0.015 * k, 2, limbs, upward=0.12)
    grow(rng, trunk[4], _normalize((0.9, 0.4, 0.5)), 0.8, 0.07, 1, limbs, upward=0.2)
    draw_roots(cv, rng, 0.26, 5, 1503)
    draw_limbs(cv, limbs, 1505)
    base_grass(cv, [(0.3, 0.1), (0.05, 0.32)], 1507)


def draw_dead_tree_snag(cv):
    rng = random.Random(1601)
    limbs = []
    trunk = [(0.0, 0.0, 0.0)]
    d, p = (-0.15, 0.1, 1.0), (0.0, 0.0, 0.0)
    for step in range(7):
        d = _normalize((d[0] + rng.uniform(-0.18, 0.18), d[1] + rng.uniform(-0.18, 0.18), 1.0))
        p = tuple(p[k] + d[k] * 0.27 for k in range(3))
        trunk.append(p)
    limbs.append((trunk, 0.2, 0.13, 1))
    # A split, broken crown: two short prongs and one bare side limb.
    for a, tilt, length in ((0.8, 0.5, 0.42), (3.6, 0.6, 0.32)):
        tip = trunk[-1]
        direction = _normalize((math.cos(a) * tilt, math.sin(a) * tilt, 1.0))
        limbs.append(([tip, tuple(tip[k] + direction[k] * length for k in range(3))], 0.09, 0.06, 0))
    grow(rng, trunk[3], _normalize((0.8, -0.5, 0.45)), 0.9, 0.065, 1, limbs, upward=0.15)
    draw_roots(cv, rng, 0.22, 4, 1603)
    draw_limbs(cv, limbs, 1605)
    # A dark hollow on the lit side of the trunk.
    hx, hy = cv.project(trunk[3][0] + 0.2, trunk[3][1], trunk[3][2])
    hole = cv.new_oid()
    for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1), (0, 2), (1, -1)):
        cv.put(math.floor(hx) + dx - 1, math.floor(hy) + dy, 40.0, "DEEP", hole, ROUND, None)
    base_grass(cv, [(0.26, 0.05), (0.0, 0.28)], 1607)


# The dip falls below the ground course, so both variants have a bare, walkable gap.
PARAPET_BROKEN_PROFILE = [(-1.5, 1.9), (-0.8, 1.9), (-0.5, 1.1), (-0.2, -0.3), (0.3, -0.3), (0.6, 0.9), (0.85, 1.9), (1.5, 1.6)]


def parapet_broken_blocks(axis):
    levels = [0.0, 0.27, 0.54, 0.76]
    salt = 1801 if axis == "x" else 1811
    masonry = Masonry(axis, -0.3, 0.3, salt, levels, recess=0.0, cracks=1, crack_span=(-1.2, 1.2))
    return salt, wall_blocks(masonry, -1.5, 1.5, lambda a: lerp_points(PARAPET_BROKEN_PROFILE, a), salt, top_moss=0.6)


def parapet_broken_runs(axis):
    """Standing chunks along the course as (a0, a1): the colliders of the frame."""
    _, blocks = parapet_broken_blocks(axis)
    spans = sorted((b.box[0], b.box[1]) if axis == "x" else (b.box[2], b.box[3]) for b in blocks)
    runs = []
    for a0, a1 in spans:
        if runs and a0 <= runs[-1][1] + 0.02:
            runs[-1][1] = max(runs[-1][1], a1)
        else:
            runs.append([a0, a1])
    return [(round(a0, 3), round(a1, 3)) for a0, a1 in runs]


def draw_parapet_broken(cv, axis):
    """A low front course broken down to one or two courses, with a walkable gap
    where a couple of flat stones lie (each standing chunk has its own collider)."""
    salt, blocks = parapet_broken_blocks(axis)
    runs = parapet_broken_runs(axis)
    gap = (runs[0][1] + runs[1][0]) / 2 if len(runs) > 1 else 0.0
    rng = random.Random(salt + 3)
    spots = [(gap - 0.08, 0.06, 0.2, 0.18, 0.07), (gap + 0.1, -0.12, 0.16, 0.14, 0.05)]
    if axis == "y":
        spots = [(y, x, d, w, h) for x, y, w, d, h in spots]
    stones = loose_blocks(rng, None, spots, salt + 5)
    f = mass_field(blocks)
    draw_mass(cv, blocks, f)
    draw_mass(cv, stones)
    side = (lambda a: (a, 0.32)) if axis == "x" else (lambda a: (0.32, a))
    base_grass(cv, [side(-1.1), side(gap), side(1.2)], salt + 7)


def draw_corner_stump(cv):
    """A squat broken pier of coursed masonry for a notched court corner."""
    masonry = Masonry("x", -0.75, 0.75, 1821, course_levels(2.0), recess=0.0, cracks=1, crack_span=(-0.5, 0.5))
    profile = lambda a: lerp_points([(-0.75, 3.4), (-0.3, 3.1), (0.1, 2.4), (0.5, 2.0), (0.75, 1.6)], a)
    blocks = wall_blocks(masonry, -0.75, 0.75, profile, 1821, top_moss=0.65)
    f = mass_field(blocks)
    draw_mass(cv, blocks, f)
    ivy_curtain(cv, f, "x", 0.75, [(-0.7, -0.2, 0.9)], 1823, lit=False)
    ivy_top(cv, f, [(-0.5, -0.4)], 1825, radius=0.2)
    top_grass(cv, f, [(0.4, 0.2)], 1827)
    base_grass(cv, [(0.76, 0.3), (0.3, 0.76), (0.76, -0.5)], 1829)


def draw_rubble_small(cv):
    rng = random.Random(1901)
    blocks = []
    f = None
    for x, y, w, d, h in sorted(rubble_spots(rng, 0.5, 0.45, 14, 1.3), key=lambda s: -s[2] * s[3]):
        heap = 0.38 * max(0.0, 1 - (x / 0.5) ** 2 - (y / 0.45) ** 2) ** 0.7
        base = max(0.0, min(f.xy(x, y) if f else 0.0, heap - h * 0.6))
        blocks.append(Block(x - w / 2, x + w / 2, y - d / 2, y + d / 2, base, base + h, 1902 + len(blocks) * 7,
                            corner=0.05, bevel=0.05, chips=rng.randint(1, 2),
                            tilt=(rng.uniform(-0.14, 0.14), rng.uniform(-0.14, 0.14)), moss=0.5, warm=len(blocks) % 2 == 0))
        f = mass_field(blocks)
    blocks += corner_stones(rng, 0.5, 0.45, 0.17, 1960)
    f = mass_field(blocks)
    draw_mass(cv, blocks, f)
    base_grass(cv, [(0.45, 0.1)], 1907)


DRAW = {
    "wall-run-x": lambda cv: draw_wall_run(cv, "x"), "wall-run-y": lambda cv: draw_wall_run(cv, "y"),
    "wall-window-x": lambda cv: draw_wall_window(cv, "x"), "wall-window-y": lambda cv: draw_wall_window(cv, "y"),
    "wall-end-x": lambda cv: draw_wall_end(cv, "x"), "wall-end-y": lambda cv: draw_wall_end(cv, "y"),
    "wall-breach-x": draw_wall_breach, "wall-corner": draw_wall_corner, "arch-gate": draw_arch_gate,
    "parapet-x": lambda cv: draw_parapet(cv, "x"), "parapet-y": lambda cv: draw_parapet(cv, "y"),
    "parapet-corner": draw_parapet_corner,
    "column-intact": draw_column_intact, "column-broken": draw_column_broken, "column-drums": draw_column_drums,
    "ritual-plinth": plinth_drawing, "ritual-plinth-runes": plinth_drawing,
    "fallen-block": draw_fallen_block, "fallen-lintel": draw_fallen_lintel, "fallen-blocks": draw_fallen_blocks,
    "rubble-pile": draw_rubble_pile, "rubble-scatter": draw_rubble_scatter,
    "flagstones-broken": draw_flagstones_broken, "flagstone-cracks": draw_flagstone_cracks, "moss-patch": draw_moss_patch,
    "ivy-clump": draw_ivy_clump, "dead-tree": draw_dead_tree, "dead-tree-snag": draw_dead_tree_snag,
    "parapet-broken-x": lambda cv: draw_parapet_broken(cv, "x"), "parapet-broken-y": lambda cv: draw_parapet_broken(cv, "y"),
    "corner-stump": draw_corner_stump, "rubble-small": draw_rubble_small,
}


# --------------------------------------------------------------------------
# World atlas: the ritual source, the healing shrine and both braziers, laid
# out exactly like the pixel-v2 `world` atlas (cell 160, anchor (80,144), six
# keys per clip) so the runtime swaps atlas and clip names only. render.js
# registers the shrine pedestal's contact at cell pixel (80,124); a brazier's
# foot centre is the anchor itself. Frames are drawn on the 256 prop canvas
# with the 160 cell as a window at WORLD_WINDOW, so one renderer serves both.
# --------------------------------------------------------------------------

WORLD_CELL, WORLD_COLUMNS, WORLD_ROWS, WORLD_ANCHOR = 160, 6, 4, (80, 144)
WORLD_WINDOW = (48, 72)  # cell pixel (0, 0) on the drawing canvas
SHRINE_CONTACT, BRAZIER_CONTACT = (80, 124), (80, 144)
WORLD_CLIPS = ["brazier-cyan", "brazier-magenta", "ritual-source", "healing-shrine"]
WORLD_FRAMES = [f"{clip}-{k + 1:02d}" for clip in WORLD_CLIPS for k in range(6)]
FLAME_RAMPS = {"cyan": ("C0", "C1", "C2", "C3", "C4"), "magenta": ("RUNE_HI", "RUNE1", "RUNE2", "RUNE2", "RUNE3")}
PEDESTAL_HALF, BRAZIER_RADIUS = 0.86, 0.28


def world_canvas(contact):
    return Canvas((contact[0] + WORLD_WINDOW[0], contact[1] + WORLD_WINDOW[1]))


class Bowl(Block):
    """A bronze fire bowl: rounded underside, rolled rim, a shallow dish of coals."""

    material = "bronze"

    def __init__(self, radius, bottom, rim, salt):
        super().__init__(-radius, radius, -radius, radius, bottom, rim, salt, round_plan=True, bevel=0.03, moss=0.3)
        self.radius = radius

    def height(self, x, y):
        q = math.hypot(x, y) / self.radius
        if q >= 1:
            return None
        if q < 0.78:
            return self.z1 - 0.07 * (1 - (q / 0.78) ** 2) - 0.03
        return self.z1 - 0.025 * max(0.0, (q - 0.93) / 0.07)

    def underside(self, x, y):
        q = math.hypot(x, y) / self.radius
        return self.z0 + (self.z1 - 0.06 - self.z0) * q * q


class Coals(Beds):
    """Marks the dish of a bowl so the flame can light it."""

    def top(self, x, y, zt):
        if math.hypot(x, y) < 0.47:
            return "COAL"
        return None


# Per key: height scale (±20%), lean (px per row, + = screen right), left and
# right tongue heights. The magenta loop uses its own sequence so the two
# colours never flicker in step.
FLAME_KEYS = {
    "cyan": [(1.0, 0.0, 0.72, 0.56), (1.18, 0.17, 0.54, 0.78), (0.9, -0.1, 0.8, 0.5),
             (1.2, -0.21, 0.5, 0.82), (0.82, 0.09, 0.76, 0.66), (1.07, 0.2, 0.6, 0.72)],
    "magenta": [(1.12, -0.16, 0.78, 0.52), (0.86, 0.07, 0.6, 0.8), (1.2, 0.2, 0.5, 0.74),
                (0.94, -0.06, 0.82, 0.58), (1.16, -0.22, 0.56, 0.84), (0.84, 0.12, 0.7, 0.62)],
}


def draw_flame(cv, base, key, ramp, color, salt, height=40.0, width=30.0, depth=0.4):
    """One key of a flickering fire loop in screen space. Three tongues share a
    root and part towards ragged tips; noise scrolling up with the key eats the
    edges, so every key has its own silhouette, height and lean. Levels: 0 core,
    1 bright, 2 body, 3 edge, 4 dark rim. depth sits at the bowl centre: the
    front rim hides the root, the back rim does not."""
    bx, by = base
    hk, lean, lk, rk = FLAME_KEYS[color][key]
    tall = height * hk
    tongues = ((0.0, 0.33, tall, 0.0), (-0.3 * width, 0.23, tall * lk, 1.7), (0.3 * width, 0.23, tall * rk, 3.1))
    field = {}
    for r in range(int(tall * 1.04) + 1):
        for col in range(math.floor(bx - width), math.ceil(bx + width)):
            dx = col + 0.5 - bx
            best = 0.0
            for tx, tw, th, wp in tongues:
                t = r / th
                if t >= 1:
                    continue
                # Tongues curl: an S-sway that grows towards the tip.
                centre = tx * (1 + 0.15 * t) + lean * r + 2.6 * math.sin(wp + key * 1.9 + t * 4.6) * t ** 1.2
                half = width * tw * (1 - t ** 1.5) ** 0.75 * (0.8 + 0.2 * math.sin(math.pi * min(1.0, 0.3 + t * 2.2)))
                d = (1 - abs(dx - centre) / max(half, 0.3)) * (1 - 0.25 * t)
                best = max(best, d)
            if best <= 0:
                continue
            u = r / tall
            # Noise scrolling up with the key cuts only the outline; the inside stays smooth.
            ragged = 0.65 * vnoise(dx * 0.62 + 3.1, (r + key * 4.5) * 0.5, salt) + 0.35 * vnoise(dx * 1.1, (r + key * 6.0) * 0.9, salt + 1)
            if best - (0.06 + 0.7 * u * u) * ragged > 0.04:
                field[(col, math.floor(by - r))] = (best, u)
    levels = {}
    for (px, py), (value, u) in field.items():
        level = 0 if value > 0.68 and u < 0.3 else 1 if value > 0.42 and u < 0.6 else 2
        levels[(px, py)] = level
    for (px, py), level in list(levels.items()):
        u = field[(px, py)][1]
        open_sides = [(px + ox, py + oy) not in levels for ox, oy in ((1, 0), (-1, 0), (0, -1))]
        if any(open_sides) and py < by - 2:
            # The silhouette darkens: dark rim on the upper tongues, edge tone below.
            levels[(px, py)] = 4 if u > 0.42 and (open_sides[2] or ihash(px, py, salt + 2) < 0.5) else max(level, 3)
    for j in range(5):  # sparks and embers rising off the tongues, new places every key
        rise = ((key + j * 1.3) / 6 + j * 0.17) % 1
        x = bx + (j - 2) * 4.5 + 3.5 * math.sin(key * 1.3 + j * 2.2) + lean * tall * 0.6
        y = by - tall * (0.72 + 0.12 * (j % 2)) - rise * 22
        spot = (math.floor(x), math.floor(y))
        if spot in levels:
            continue
        levels[spot] = 1 if rise < 0.4 else 2 if rise < 0.75 else 3
        if j % 2 == 0 and rise < 0.5:
            levels.setdefault((spot[0], spot[1] + 1), 3)
    for col in range(math.floor(bx - width * 0.42), math.ceil(bx + width * 0.42)):  # the root glows in the coals
        levels.setdefault((col, math.floor(by) + 1), 2)
    oid = cv.new_oid()
    for (px, py), level in levels.items():
        cv.put(px, py, depth, ramp[level], oid, ROUND, {"flat": True})


def draw_brazier(cv, key, color):
    ramp = FLAME_RAMPS[color]
    stone = [Block(-0.3, 0.3, -0.3, 0.3, 0.0, 0.14, 2001, round_plan=True, bevel=0.04, chips=1, moss=0.45,
                   pattern=Beds([0.0, 0.14], 2002)),
             Block(-0.21, 0.21, -0.21, 0.21, 0.14, 0.84, 2003, round_plan=True, bevel=0.03, moss=0.2,
                   pattern=Beds([0.14, 0.5, 0.84], 2004))]
    draw_mass(cv, stone)
    floating(cv, [Block(-0.31, 0.31, -0.31, 0.31, 0.82, 0.92, 2005, round_plan=True, bevel=0.035, moss=0.3,
                        pattern=Beds([0.82, 0.92], 2006))], 0.82)
    bowl = Bowl(0.62, 0.84, 1.22, 2007)
    bowl.pattern = Coals([0.84, 1.22], 2008)
    f = mass_field([bowl])
    draw_mass(cv, [bowl], carve(f, lambda x, y, top, fl: (fl, top)), floating=True)
    # Coals glow in the flame's colour; the rim catches a little of its light.
    for i, c in enumerate(cv.color):
        if c == "COAL":
            x, y = i % CELL, i // CELL
            cv.color[i] = ramp[3] if ihash(x, y, 2009) < 0.45 else ramp[4] if ihash(x, y, 2010) < 0.6 else "T3"
    bx, by = cv.project(0.0, 0.0, 1.14)
    for i, c in enumerate(cv.color):
        x, y = i % CELL, i // CELL
        if c in ("Y1", "Y3") and cv.face[i] == TOP and abs(x + 0.5 - bx) < 16 and y < by + 3 and ihash(x, y, 2011) < 0.5:
            cv.color[i] = ramp[3]
    draw_flame(cv, (bx, by), key, ramp, color, 2012 + (0 if color == "cyan" else 5), height=40.0, width=30.0,
               depth=VIEW[2] * 1.14)
    base_grass(cv, [(0.28, 0.1), (0.1, 0.28)], 2013)


class Pyramidion(Block):
    """A square obelisk shaft ending in a low pyramid."""

    def __init__(self, cx, cy, half, z0, z1, cap, salt, broken=False, **kw):
        super().__init__(cx - half, cx + half, cy - half, cy + half, z0, z1, salt, **kw)
        self.cap, self.broken = cap, broken

    def top(self, x, y):
        cheb = max(abs(x - self.cx), abs(y - self.cy)) / self.hx
        if self.broken:  # snapped off: a jagged, sloping fracture
            return self.z1 - 0.18 * (x - self.cx + self.hx) / (2 * self.hx) + 0.08 * (vnoise(x * 18, y * 18, self.salt) - 0.5)
        return self.z1 + self.cap * (1 - cheb)


class ObeliskRunes(Beds):
    """A column of carved glyphs down the obelisk's two visible faces."""

    def __init__(self, levels, salt, cx, cy, half, z0, z1):
        super().__init__(levels, salt)
        self.cx, self.cy, self.half, self.z0, self.z1 = cx, cy, half, z0, z1

    def face(self, along, z, along_is_x, point, b):
        centre = self.cx if along_is_x else self.cy
        if self.z0 < z < self.z1 and abs(along - centre) < 0.07:
            gx = math.floor((along - centre + 0.0665) / 0.0443)
            gz = math.floor((self.z1 - z) / 0.0361)
            glyph = GLYPHS[(gz // 5 + (0 if along_is_x else 2)) % len(GLYPHS)]
            row = gz % 5
            if row < 4 and 0 <= gx < 3 and glyph[row][gx] == "1":
                return ("RUNE_HI" if row == 0 else "RUNE1"), 0
        return super().face(along, z, along_is_x, point, b)


class Dish(Beds):
    def __init__(self, levels, salt, cx, cy):
        super().__init__(levels, salt)
        self.cx, self.cy = cx, cy

    def top(self, x, y, zt):
        if math.hypot(x - self.cx, y - self.cy) < 0.19:
            return "DISH"
        return None


class Basin(Block):
    def height(self, x, y):
        z = super().height(x, y)
        if z is None:
            return None
        q = math.hypot(x - self.cx, y - self.cy) / (self.hx * 0.72)
        return z - 0.08 * (1 - q * q) if q < 1 else z


def shrine_mass(cv, broken):
    base = Beds([0.0, 0.12, 0.24], 2101)
    stone = [Block(-PEDESTAL_HALF, PEDESTAL_HALF, -PEDESTAL_HALF, PEDESTAL_HALF, 0.0, 0.12, 2102, corner=0.04, bevel=0.035,
                   chips=2, chip_depth=(0.03, 0.06), moss=0.45, pattern=base),
             Block(-0.74, 0.74, -0.74, 0.74, 0.12, 0.24, 2103, corner=0.04, bevel=0.04, chips=1, chip_depth=(0.03, 0.06),
                   moss=0.35, warm=True, pattern=base),
             Basin(0.04, 0.6, 0.04, 0.6, 0.24, 0.46, 2104, round_plan=True, bevel=0.035, moss=0.4,
                   pattern=Dish([0.24, 0.46], 2105, 0.32, 0.32))]
    wing_x = Masonry("x", -0.74, -0.38, 2110, [0.24, 0.5, 0.76, 1.02])
    wing_y = Masonry("y", -0.74, -0.38, 2111, [0.24, 0.5, 0.76, 1.02])
    stone += wall_blocks(wing_x, -0.74, 0.5, lambda a: lerp_points([(-0.74, 3.0), (0.1, 2.6), (0.5, 1.6)], a + 0.0), 2110)
    stone += wall_blocks(wing_y, -0.74, 0.5, lambda a: lerp_points([(-0.74, 3.0), (0.1, 2.4), (0.5, 1.4)], a + 0.0), 2111)
    runes = ObeliskRunes([0.24, 0.66, 1.1, 1.54, 1.9], 2106, -0.42, -0.42, 0.3, 0.5, 1.8)
    stone.append(Pyramidion(-0.42, -0.42, 0.3, 0.24, 1.55 if broken else 1.92, 0.4, 2107, broken=broken, corner=0.02,
                            bevel=0.025, moss=0.25, chips=3 if broken else 0, chip=(0.08, 0.14), chip_depth=(0.08, 0.16),
                            pattern=runes))
    draw_mass(cv, stone)


def crystal(cv, centre, ramp, oid, depth, size=1.35, shards=False):
    """A floating diamond: lit left facets, dark right facets, a bright tip.
    ramp = (tip, lit, body, dark)."""
    cx, cy = centre
    top, bottom, half = round(9 * size), round(7 * size), 4.2 * size
    for r in range(-top, bottom + 1):
        w = half * (1 - (-r / top) ** 1.2) if r < 0 else half * (1 - (r / (bottom + 0.5)) ** 0.9)
        for col in range(math.floor(cx - w + 0.5), math.floor(cx + w + 0.5)):
            left = col + 0.5 < cx
            color = ramp[1] if left else ramp[3]
            if abs(col + 0.5 - cx) < 1.0:
                color = ramp[2]
            if left and r < -top * 0.45 and col + 0.5 > cx - w * 0.6:
                color = ramp[0]
            cv.put(col, math.floor(cy + r), depth, color, oid, ROUND, None)
    cv.put(math.floor(cx) - 1, math.floor(cy - top), depth + 0.01, ramp[0], oid, ROUND, None)


def ring(cv, centre, rx, ry, color, depth_front, depth_back, oid, step=2, phase=0):
    cx, cy = centre
    count = int(math.tau * max(rx, ry) / step)
    for n in range(count):
        a = n / count * math.tau + phase
        x, y = cx + rx * math.cos(a), cy + ry * math.sin(a)
        cv.put(math.floor(x), math.floor(y), depth_front if math.sin(a) > 0 else depth_back, color, oid, ROUND, {"flat": True})


SOURCE_STATES = {  # key -> (glyph ramp key, crystal ramp, dish glint, extras)
    0: "sealed", 1: "sealed-bright", 2: "open", 3: "open-peak", 4: "open", 5: "destroyed"}
HEAL_STATES = {0: "idle", 1: "spark", 2: "lit", 3: "peak", 4: "fading", 5: "used"}
MAGENTA_CRYSTAL = ("RUNE_HI", "RUNE1", "RUNE2", "RUNE3")
CYAN_CRYSTAL = ("C0", "C1", "C2", "C3")
AMBER_CRYSTAL = ("A0", "A1", "A2", "A3")


def glow_map(colors, glyph, dish):
    """Recolour the carved glyph and dish markers for one state."""
    result = []
    for i, c in enumerate(colors):
        if c in ("RUNE_HI", "RUNE1"):
            c = glyph[0] if c == "RUNE_HI" else glyph[1]
        elif c == "DISH":
            x, y = i % CELL, i // CELL
            c = dish[1] if dish and ihash(x, y, 2201) < 0.3 else dish[0] if dish else "DEEP2"
        result.append(c)
    return result


GLYPH_GLOW = {  # state -> (glyph highlight, glyph body), dish (liquid, glint) or None
    "sealed": (("RUNE1", "RUNE2"), ("DEEP2", "RUNE2")), "sealed-bright": (("RUNE_HI", "RUNE1"), ("DEEP2", "RUNE1")),
    "open": (("C1", "C2"), ("C4", "C2")), "open-peak": (("C0", "C1"), ("C3", "C1")), "destroyed": (("Q_M", "DEEP2"), None),
    "idle": (("A3", "A3"), None), "spark": (("A2", "A3"), ("DEEP2", "A3")), "lit": (("A1", "A2"), ("A3", "A1")),
    "peak": (("A0", "A1"), ("A2", "A0")), "fading": (("A2", "A3"), ("DEEP2", "A2")), "used": (("Q_M", "DEEP2"), None),
}
HEAL_CRYSTAL = {"idle": ("A2", "A2", "A3", "A3"), "spark": ("A1", "A1", "A2", "A3"), "lit": AMBER_CRYSTAL,
                "peak": ("A0", "A0", "A1", "A2"), "fading": ("A1", "A1", "A2", "A3"), "used": ("A3", "A3", "Q_M", "Q_S1")}


def draw_source(cv, key, kind):
    """Ritual source: keys 0-1 sealed (magenta ward), 2-4 open pulse (turquoise),
    5 destroyed. Healing shrine: the six activation keys of worldPose('shrine'), amber."""
    state = (SOURCE_STATES if kind == "ritual" else HEAL_STATES)[key]
    glyph, dish = GLYPH_GLOW[state]
    shrine_mass(cv, kind == "ritual" and state == "destroyed")
    cv.color = glow_map(cv.color, glyph, dish)
    centre = cv.project(0.32, 0.32, 0.98)
    depth = VIEW[0] * 0.32 + VIEW[1] * 0.32 + VIEW[2] * 0.98
    oid = cv.new_oid()
    if state.startswith("sealed"):
        bob = 0 if state == "sealed" else -1
        crystal(cv, (centre[0], centre[1] + bob), MAGENTA_CRYSTAL, oid, depth)
        ring(cv, (centre[0] + 0.5, centre[1] + 3), 12, 6, "RUNE1" if state == "sealed" else "RUNE_HI", depth + 0.4,
             depth - 0.4, cv.new_oid(), step=2 if state == "sealed" else 1.6, phase=0.2 * key)
    elif state.startswith("open"):
        bob = {2: 0, 3: -1, 4: 1}[key]
        crystal(cv, (centre[0], centre[1] + bob), CYAN_CRYSTAL if state == "open" else ("C0", "C0", "C1", "C2"), oid, depth)
        if state == "open-peak":  # a one-pixel turquoise halo
            halo = cv.new_oid()
            for dx in range(-7, 8):
                for dy in range(-12, 10):
                    px, py = math.floor(centre[0]) + dx, math.floor(centre[1] + bob) + dy
                    if cv.color[py * CELL + px] is None and any(cv.oid[(py + oy) * CELL + px + ox] == oid
                                                                for ox, oy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                        cv.put(px, py, depth - 0.01, "C3", halo, ROUND, {"flat": True})
        for j in range(4):  # motes rising from the basin
            rise = ((key - 2) / 3 + j / 4) % 1
            x, y = centre[0] + 7 * math.sin(j * 2.3 + key), centre[1] + 10 - 26 * rise
            cv.put(math.floor(x), math.floor(y), depth + 0.3, "C1" if rise < 0.5 else "C2", cv.new_oid(), ROUND, {"flat": True})
    elif state == "destroyed":  # shards in the basin, no light
        for sx, sy, size in ((0.2, 0.38, 0.45), (0.42, 0.26, 0.38), (0.3, 0.46, 0.3)):
            p = cv.project(sx, sy, 0.44)
            crystal(cv, (p[0], p[1] - 2), ("Q_T2", "Q_L1", "Q_M", "Q_S1"), cv.new_oid(),
                    VIEW[0] * sx + VIEW[1] * sy + VIEW[2] * 0.5, size=size)
    else:
        crystal(cv, (centre[0], centre[1] - (1 if state == "peak" else 0)), HEAL_CRYSTAL[state], oid, depth)
        if state == "used":
            cv.put(math.floor(centre[0]) - 1, math.floor(centre[1]) - 2, depth + 0.02, "A3", oid, ROUND, None)
        if state in ("spark", "peak", "fading"):
            count, r = {"spark": (2, 7), "peak": (10, 13), "fading": (5, 10)}[state]
            for j in range(count):
                a = j / count * math.tau + key
                x = centre[0] + r * math.cos(a)
                y = centre[1] + 2 + r * 0.5 * math.sin(a) - (6 if state == "fading" and j % 2 else 0)
                cv.put(math.floor(x), math.floor(y), depth + (0.4 if math.sin(a) > 0 else -0.4),
                       "A0" if j % 3 == 0 else "A1", cv.new_oid(), ROUND, {"flat": True})
    base_grass(cv, [(0.88, -0.3), (-0.2, 0.88), (0.88, 0.6)], 2401)


def draw_world_frame(name):
    clip, key = name.rsplit("-", 1)
    key = int(key) - 1
    if clip.startswith("brazier"):
        cv = world_canvas(BRAZIER_CONTACT)
        draw_brazier(cv, key, "cyan" if clip == "brazier-cyan" else "magenta")
    else:
        cv = world_canvas(SHRINE_CONTACT)
        draw_source(cv, key, "ritual" if clip == "ritual-source" else "healing")
    image = to_image(cv.finish())
    x0, y0 = WORLD_WINDOW
    full = image.getchannel("A").getbbox()
    assert full[0] >= x0 and full[1] >= y0 and full[2] <= x0 + WORLD_CELL and full[3] <= y0 + WORLD_CELL, f"{name} leaves its cell"
    return image.crop((x0, y0, x0 + WORLD_CELL, y0 + WORLD_CELL))


def world_record(clip):
    if clip.startswith("brazier"):
        return {"shape": "circle", "role": "solid", "contactCenter": list(BRAZIER_CONTACT), "height": 2.65, "radius": BRAZIER_RADIUS,
                "stepSeconds": 0.1 if clip == "brazier-cyan" else 0.12, "contact": "loose"}
    h, (cx, cy) = PEDESTAL_HALF, SHRINE_CONTACT
    record = {"shape": "box", "role": "solid", "contactCenter": [cx, cy], "height": 2.26, "halfWidth": h, "halfDepth": h,
              "polygon": [[round(cx + KX * (y - x), 2), round(cy + KY * (x + y), 2)] for x, y in ((-h, -h), (h, -h), (h, h), (-h, h))],
              "contact": "corners"}
    if clip == "ritual-source":
        record["keys"] = {"sealed": [0, 1], "open": [2, 3, 4], "destroyed": [5]}
    else:
        record["keyTimes"] = [0, 0.1, 0.24, 0.4, 0.62, 0.9]
    return record


def world_manifest():
    clips = {clip: {"front": list(range(n * 6, n * 6 + 6))} for n, clip in enumerate(WORLD_CLIPS)}
    clips["shrine"] = clips["healing-shrine"]  # drop-in name for worldPose('shrine')
    return {"path": "monastery-world.png", "cell": WORLD_CELL, "columns": WORLD_COLUMNS, "rows": WORLD_ROWS,
            "anchor": list(WORLD_ANCHOR), "frames": WORLD_FRAMES, "clips": clips, "filter": "nearest", "mipmaps": False,
            "footprints": {clip: world_record(clip) for clip in WORLD_CLIPS}}


# --------------------------------------------------------------------------
# Footprint contract, pixel-v9 rule: contactCenter = [128, 231 - front ground
# extent] rounded down to 0.25 px, so the front-most footprint point sits on
# row 231. Multi-part frames add `colliders` (world units, relative to the
# footprint centre); the arch adds its walkable `passage`.
# --------------------------------------------------------------------------

def _box(hw, hd, height, role="solid", **extra):
    return {"shape": "box", "role": role, "height": height, "halfWidth": hw, "halfDepth": hd, **extra}


def _rect(hw, hd):
    return {"shape": "rect", "role": "flat", "height": 0, "halfWidth": hw, "halfDepth": hd, "contact": "none"}


def _circle(radius, height, **extra):
    return {"shape": "circle", "role": "solid", "height": height, "radius": radius, **extra}


def _part(x, y, hw, hd):
    return {"x": x, "y": y, "halfWidth": hw, "halfDepth": hd}


SPECS = {
    "wall-run-x": _box(2.0, 0.4, 2.6, axis="x", contact="corners"),
    "wall-run-y": _box(0.4, 2.0, 2.6, axis="y", contact="corners"),
    "wall-window-x": _box(2.0, 0.4, 2.95, axis="x", contact="corners", window=_part(0.15, 0.0, 0.5, 0.4)),
    "wall-window-y": _box(0.4, 2.0, 2.95, axis="y", contact="corners", window=_part(0.0, 0.15, 0.4, 0.5)),
    "wall-end-x": _box(1.5, 0.4, 2.35, axis="x", contact="corners", brokenEnd="+x"),
    "wall-end-y": _box(0.4, 1.5, 2.35, axis="y", contact="corners", brokenEnd="+y"),
    "wall-breach-x": _box(2.0, 0.4, 2.3, axis="x", contact="corners"),
    "wall-corner": _box(1.5, 1.5, 2.95, contact="corners", corner="inner",
                        colliders=[_part(0.0, -1.1, 1.5, 0.4), _part(-1.1, 0.4, 0.4, 1.1)]),
    "arch-gate": _box(2.2, 0.45, 4.25, axis="x", contact="corners",
                      colliders=[_part(-1.725, 0.0, 0.475, 0.45), _part(1.725, 0.0, 0.475, 0.45)],
                      passage=_part(0.0, 0.0, 1.25, 0.45)),
    "parapet-x": _box(2.0, 0.3, 0.76, axis="x", contact="corners"),
    "parapet-y": _box(0.3, 2.0, 0.76, axis="y", contact="corners"),
    "parapet-corner": _box(1.5, 1.5, 0.76, contact="corners", corner="outer",
                           colliders=[_part(0.0, 1.2, 1.5, 0.3), _part(1.2, -0.3, 0.3, 1.2)]),
    "column-intact": _box(0.5, 0.5, 3.27, contact="corners"),
    "column-broken": _box(0.5, 0.5, 1.9, contact="corners"),
    "column-drums": _box(1.5, 0.5, 0.6, contact="loose"),
    "ritual-plinth": {**_rect(2.0, 2.0), "height": 0.12, "socket": _part(0.0, 0.0, 1.0, 1.0)},
    "ritual-plinth-runes": {**_rect(2.0, 2.0), "height": 0.12, "socket": _part(0.0, 0.0, 1.0, 1.0),
                            "variantOf": "ritual-plinth", "state": "sealed"},
    "fallen-block": _box(0.58, 0.43, 0.6, contact="corners"),
    "fallen-lintel": _box(1.3, 0.3, 0.5, contact="corners"),
    "fallen-blocks": _box(0.82, 0.82, 0.85, contact="loose"),
    "rubble-pile": _box(0.9, 0.8, 0.65, contact="corners"),
    "rubble-scatter": _rect(1.2, 1.0),
    "flagstones-broken": _rect(1.4, 1.1),
    "flagstone-cracks": _rect(1.3, 1.0),
    "moss-patch": _rect(1.0, 0.8),
    "ivy-clump": _circle(0.4, 0.9, contact="loose"),
    "dead-tree": _circle(0.28, 4.6, contact="loose"),
    "dead-tree-snag": _circle(0.24, 2.6, contact="loose"),
    "parapet-broken-x": _box(1.5, 0.3, 0.54, axis="x", contact="corners", colliders=[]),
    "parapet-broken-y": _box(0.3, 1.5, 0.54, axis="y", contact="corners", colliders=[]),
    "corner-stump": _box(0.75, 0.75, 1.35, contact="corners"),
    "rubble-small": _box(0.5, 0.45, 0.4, contact="corners"),
}


for _axis in ("x", "y"):
    SPECS[f"parapet-broken-{_axis}"]["colliders"] = [
        _part(round((a0 + a1) / 2, 3), 0.0, round((a1 - a0) / 2, 3), 0.3) if _axis == "x"
        else _part(0.0, round((a0 + a1) / 2, 3), 0.3, round((a1 - a0) / 2, 3)) for a0, a1 in parapet_broken_runs(_axis)]


def contract_record(spec):
    record = {"shape": spec["shape"], "role": spec["role"]}
    if spec["shape"] == "circle":
        front = 16 * spec["radius"]
    else:
        front = (spec["halfWidth"] + spec["halfDepth"]) * 8 * SQ2
    cy = math.floor((LAST_ROW - front) * 4) / 4
    record["contactCenter"] = [128, cy]
    record["height"] = spec["height"]
    if spec["shape"] == "circle":
        record["radius"] = spec["radius"]
    else:
        hw, hd = spec["halfWidth"], spec["halfDepth"]
        record["halfWidth"], record["halfDepth"] = hw, hd
        record["polygon"] = [[round(128 + KX * (y - x), 2), round(cy + KY * (x + y), 2)]
                             for x, y in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))]
    for key, value in spec.items():
        if key not in record and key not in ("shape", "role", "height", "halfWidth", "halfDepth", "radius"):
            record[key] = value
    return record


def contract():
    return {
        "schemaVersion": 1,
        "owner": "scripts/build-monastery-ruins-assets.py (SPECS); the courtyard layout reads manifest.footprints",
        "coordinateSpace": "cell-local pixels, origin top-left, x right, y down; world units at scale 1",
        "cell": CELL,
        "anchor": list(ANCHOR),
        "worldAxes": {"xPixelsPerUnit": [-22.627417, 11.313708], "yPixelsPerUnit": [22.627417, 11.313708],
                      "inverse": "x=(2*dv-du)/(32*sqrt2), y=(2*dv+du)/(32*sqrt2) for a pixel offset (du,dv) from contactCenter"},
        "rule": "contactCenter y = 231 - front ground extent (box/rect: (halfWidth+halfDepth)*8*sqrt2, circle: 16*radius), "
                "rounded down to .25 px; x = 128. colliders/passage/window/socket are boxes in world units relative to the "
                "footprint centre; a mirrored placement swaps x<->y and halfWidth<->halfDepth. role: solid (collider), flat "
                "(ground layer, walkable, no collider). variantOf: a swap frame with the same placement and alpha. contact: "
                "corners (drawn ground corners within 1.6 px of every collider corner), loose (organic edge on the "
                "footprint), none.",
        "frames": {name: contract_record(SPECS[name]) for name in FRAMES},
    }


# ------------------------------ frame assembly ------------------------------

def rune_post(cv, colors, lit):
    """ritual-plinth: glyphs and veins carved dark. ritual-plinth-runes: the same
    dais with every rune glowing magenta and a one-pixel glow on the stone around it."""
    if not lit:
        return [("Q_T3" if c != "RUNE2" else "Q_M") if c in RUNE_KEYS else c for c in colors]
    result = colors[:]
    for i, c in enumerate(colors):
        if c == "RUNE2":
            result[i] = "RUNE_HI" if ihash(i % CELL, i // CELL, 77) < 0.2 else "RUNE1"
    for i, c in enumerate(colors):
        if c is None or c in RUNE_KEYS or c == "DEEP2" and cv.style[i] is None:
            continue
        x, y = i % CELL, i // CELL
        if any(0 <= x + dx < CELL and 0 <= y + dy < CELL and colors[(y + dy) * CELL + x + dx] in RUNE_KEYS
               for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            result[i] = "RUNE3"
    return result


def draw_frame(name, records):
    record = records[name]
    cv = Canvas(record["contactCenter"])
    DRAW[name](cv)
    if record["role"] == "flat":
        colors = cv.finish(outline=name == "rubble-scatter" or name.startswith("ritual-plinth"), outline_color="DEEP2")
    else:
        colors = cv.finish()
    if name.startswith("ritual-plinth"):
        colors = rune_post(cv, colors, lit=name == "ritual-plinth-runes")
    return to_image(colors)


# --------------------------------------------------------------------------
# Courtyard flagstone surface: 128 px = 4u, sampled at worldXZ / 4 with repeat.
# Image column = world +x, image row = world -y (textures load with invertY).
# Courses of rectangular slabs in running bond; every cut avoids the tile
# edges, so the wrap is an ordinary slab interior. Light from the screen's
# upper left lifts each slab's +row and +col lip and darkens the joints.
# --------------------------------------------------------------------------

SURFACE = 128
SURFACE_PALETTE = {
    "S_HI": PALETTE["S_HI"], "S1": PALETTE["S1"], "S2": PALETTE["S2"], "S3": PALETTE["S3"], "S4": PALETTE["S4"],
    "S_SH": PALETTE["S_SH"], "J1": "#4e4752", "J2": "#3b3846", "MJ1": "#626445", "MJ2": "#4a523f", "MS": "#7d7b4f",
}
SLAB_LADDER = ["S_SH", "S4", "S3", "S2", "S1", "S_HI"]
COURSE_ROWS = [36, 28, 34, 30]
COURSE_START = 13


def tile_noise(x, y, grid, salt):
    """Value noise that repeats every SURFACE pixels on both axes."""
    gx, gy = x / SURFACE * grid, y / SURFACE * grid
    ix, iy = math.floor(gx), math.floor(gy)
    fx, fy = gx - ix, gy - iy
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = ihash(ix % grid, iy % grid, salt), ihash((ix + 1) % grid, iy % grid, salt)
    c, d = ihash(ix % grid, (iy + 1) % grid, salt), ihash((ix + 1) % grid, (iy + 1) % grid, salt)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy


def slab_courses():
    rng = random.Random(1701)
    courses = []
    for r, h in enumerate(COURSE_ROWS):
        count = (3, 4, 4, 3)[r]
        while True:
            cuts = sorted(rng.sample(range(0, SURFACE), count))
            lengths = [(cuts[(k + 1) % count] - cuts[k]) % SURFACE for k in range(count)]
            # Slabs 24-52 px long; no head joint on or next to the tile edge.
            if min(lengths) >= 24 and max(lengths) <= 52 and all(3 <= c <= SURFACE - 3 for c in cuts):
                break
        courses.append((h, cuts))
    return courses


def courtyard_flagstone():
    courses = slab_courses()
    starts = []
    y = COURSE_START
    for h, cuts in courses:
        starts.append(y)
        y += h
    names = []
    slab_of = []
    for py in range(SURFACE):
        ly = (py - COURSE_START) % SURFACE
        r = 0
        while r + 1 < len(courses) and ly >= starts[r + 1] - COURSE_START:
            r += 1
        h, cuts = courses[r]
        yy = ly - (starts[r] - COURSE_START)
        for px in range(SURFACE):
            s = bisect.bisect_right(cuts, px) - 1  # -1 wraps to the last slab
            a0 = cuts[s] if s >= 0 else cuts[-1] - SURFACE
            a1 = cuts[s + 1] if s + 1 < len(cuts) else cuts[0] + SURFACE
            xx, length = px - a0, a1 - a0
            sid = (r, s % len(cuts))
            slab_of.append(sid)
            hs = ihash(sid[0] * 7 + 3, sid[1] * 13 + 5, 1703)
            # Ladder index 4 = S1 (lightest) ... 1 = S4 (violet): mostly warm mid slabs.
            tone = 1 if hs < 0.1 else 2 if hs < 0.38 else 3 if hs < 0.78 else 4
            chipped = hs * 10 % 1 < 0.5
            if yy == 0 or xx == 0:
                corner = (yy == 0 and xx in (0, 1, length - 1)) or (xx == 0 and yy in (0, 1, h - 1))
                moss = tile_noise(px + 0.5, py + 0.5, 8, 1705) > 0.62
                if moss:
                    names.append("MJ1" if ihash(px, py, 1706) < 0.55 else "MJ2")
                else:
                    names.append("J2" if corner or ihash(px, py, 1707) < 0.1 else "J1")
                continue
            if chipped and (xx <= 2 or xx >= length - 2) and (yy <= 2 or yy >= h - 2) and (xx + yy) % 3 != 2:
                names.append("J1")
                continue
            m = tile_noise(px + 0.5, py + 0.5, 16, 1709 + r) * 0.7 + tile_noise(px + 0.5, py + 0.5, 32, 1710) * 0.3
            level = tone + (1 if m > 0.8 else -1 if m < 0.17 else 0)
            if yy == h - 1 or xx == length - 1:
                level += 1  # lit lip facing the light
            elif yy == 1 or xx == 1:
                level -= 1
            if ihash(px, py, 1711) < 0.012:
                level = 0
            names.append(SLAB_LADDER[max(0, min(len(SLAB_LADDER) - 1, level))])
    rng = random.Random(1713)

    def at(x, y):
        return (y % SURFACE) * SURFACE + x % SURFACE

    for _ in range(4):  # hairline cracks across a few slabs, wrapping
        x, y = rng.uniform(0, SURFACE), rng.uniform(0, SURFACE)
        angle = rng.uniform(0, math.tau)
        for _step in range(rng.randint(9, 18)):
            i = at(math.floor(x), math.floor(y))
            if names[i] not in ("J1", "J2", "MJ1", "MJ2"):
                names[i] = "J1"
                below = at(math.floor(x), math.floor(y) + 1)
                if names[below] in SLAB_LADDER[1:4]:
                    names[below] = SLAB_LADDER[SLAB_LADDER.index(names[below]) + 1]
            angle += rng.uniform(-0.5, 0.5)
            x += math.cos(angle)
            y += math.sin(angle)
    for i, name in enumerate(names):  # moss creeping out of mossy joints onto the slab lip
        if name in ("S2", "S3", "S4") and i >= SURFACE and names[i - SURFACE] in ("MJ1", "MJ2") and ihash(i, 3, 1715) < 0.35:
            names[i] = "MS"
    image = Image.new("RGB", (SURFACE, SURFACE))
    rgb = {name: hexrgb(value) for name, value in SURFACE_PALETTE.items()}
    image.putdata([rgb[name] for name in names])
    return image, courses


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
    interior_y = [diff(image.getpixel((x, y)), image.getpixel((x, y + 1))) for y in range(SURFACE - 1) for x in range(SURFACE)]
    seam_x = [diff(image.getpixel((SURFACE - 1, y)), image.getpixel((0, y))) for y in range(SURFACE)]
    seam_y = [diff(image.getpixel((x, SURFACE - 1)), image.getpixel((x, 0))) for x in range(SURFACE)]
    return {"size": list(image.size), "colors": len(set(data)), "mean": mean,
            "interiorStepX": round(sum(interior) / len(interior), 2), "interiorStepY": round(sum(interior_y) / len(interior_y), 2),
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


def collider_boxes(record):
    if record["shape"] == "circle":
        return []
    return record.get("colliders") or [_part(0.0, 0.0, record["halfWidth"], record["halfDepth"])]


def contact_gaps(cell, record):
    """Distance from each collider's front, screen-left and screen-right ground
    corner to the nearest drawn pixel centre (corners buried inside another
    collider are skipped)."""
    if record.get("contact") != "corners":
        return []
    cx, cy = record["contactCenter"]
    alpha = cell.getchannel("A")
    boxes = collider_boxes(record)
    gaps = []
    for n, b in enumerate(boxes):
        for label, sx_, sy_ in (("front", 1, 1), ("left", 1, -1), ("right", -1, 1)):
            wx, wy = b["x"] + sx_ * b["halfWidth"], b["y"] + sy_ * b["halfDepth"]
            if any(m != n and abs(wx - o["x"]) < o["halfWidth"] - 0.01 and abs(wy - o["y"]) < o["halfDepth"] - 0.01
                   for m, o in enumerate(boxes)):
                continue
            px, py = cx + KX * (wy - wx), cy + KY * (wx + wy)
            best = 99.0
            for y in range(max(0, math.floor(py) - 6), min(CELL, math.floor(py) + 7)):
                for x in range(max(0, math.floor(px) - 6), min(CELL, math.floor(px) + 7)):
                    if alpha.getpixel((x, y)):
                        best = min(best, math.hypot(x + 0.5 - px, y + 0.5 - py))
            gaps.append({"collider": n, "corner": label, "gap": round(best, 2)})
    return gaps


def frame_report(name, cell, record):
    alpha = pixels(cell.getchannel("A"))
    opaque = [(i % CELL, i // CELL) for i, a in enumerate(alpha) if a]
    colors = {p[:3] for p in pixels(cell) if p[3]}
    polygon = footprint_polygon(record)
    on_footprint = sum(1 for x, y in opaque if inside(polygon, x + 0.5, y + 0.5))
    box = cell.getchannel("A").getbbox()
    report = {"frame": name, "bbox": list(box), "size": [box[2] - box[0], box[3] - box[1]],
              "opaquePixels": len(opaque), "colors": len(colors), "maxOpaqueRow": max(y for _, y in opaque),
              "opaqueOnFootprint": on_footprint, "contactCenter": record["contactCenter"], "role": record["role"]}
    gaps = contact_gaps(cell, record)
    if gaps:
        report["contactGaps"] = gaps
        report["maxContactGap"] = max(g["gap"] for g in gaps)
    return report


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


def contact_sheet(cells, scale, records=None):
    label = 18
    sheet = Image.new("RGBA", (CELL * COLUMNS, (CELL + label) * ROWS), "#9aa29b")
    draw = ImageDraw.Draw(sheet)
    for i, cell in enumerate(cells):
        x, y = (i % COLUMNS) * CELL, (i // COLUMNS) * (CELL + label)
        sheet.alpha_composite(cell, (x, y))
        box = cell.getchannel("A").getbbox()
        draw.text((x + 4, y + CELL + 3), f"{i}: {FRAMES[i]}  {box[2] - box[0]}x{box[3] - box[1]}px", fill="#20282e")
        draw.point((x + ANCHOR[0], y + ANCHOR[1]), fill="#bb332f")
        if records:
            record = records[FRAMES[i]]
            cx, cy = record["contactCenter"]
            draw.line([(x + px, y + py) for px, py in footprint_polygon(record) + footprint_polygon(record)[:1]], fill="#ffd60a")
            for b in collider_boxes(record) if record.get("colliders") else []:
                corners = [(b["x"] + sx * b["halfWidth"], b["y"] + sy * b["halfDepth"]) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
                draw.line([(x + cx + KX * (wy - wx), y + cy + KY * (wx + wy)) for wx, wy in corners + corners[:1]], fill="#30d5c8")
            draw.rectangle((x + cx - 1, y + cy - 1, x + cx + 1, y + cy + 1), outline="#ff3b30")
    if scale > 1:
        sheet = sheet.resize((sheet.width * scale, sheet.height * scale), Image.Resampling.NEAREST)
    return sheet


# ------------------------------ composition previews ------------------------

def to_screen(origin, x, y, z=0.0):
    return origin[0] + KX * (y - x), origin[1] + KY * (x + y) - KZ * z


def ground_image(size, origin, pick):
    """Project surfaces onto the ground plane: pick(x, y) -> (texture, None|alpha)."""
    image = Image.new("RGBA", size)
    data = []
    cache = {}
    for py in range(size[1]):
        dv = py + 0.5 - origin[1]
        for px in range(size[0]):
            du = px + 0.5 - origin[0]
            x, y = (2 * dv - du) / (32 * SQ2), (2 * dv + du) / (32 * SQ2)
            texture = pick(x, y)
            key = id(texture)
            if key not in cache:
                cache[key] = (texture, texture.load())
            tex, load = cache[key]
            data.append(load[math.floor(x * 32) % tex.width, math.floor(-y * 32) % tex.height])
    image.putdata([p if len(p) == 4 else p + (255,) for p in data])
    return image


def sprite_cell(atlas, index, cell, columns):
    return atlas.crop(((index % columns) * cell, (index // columns) * cell,
                       (index % columns + 1) * cell, (index // columns + 1) * cell))


def shadow(image, origin, x, y, radius):
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    sx, sy = to_screen(origin, x, y)
    draw.ellipse((sx - radius * 32, sy - radius * 16, sx + radius * 32, sy + radius * 16), fill=(14, 18, 29, 110))
    image.alpha_composite(layer)


def paint_order(items):
    """Isometric painter's order: A before B when A lies wholly behind B on x or y."""
    def behind(a, b):
        return a["x1"] <= b["x0"] + 1e-6 or a["y1"] <= b["y0"] + 1e-6
    n = len(items)
    after = {i: set() for i in range(n)}
    before = [0] * n
    for i in range(n):
        for j in range(n):
            if i != j and behind(items[i], items[j]) and not behind(items[j], items[i]):
                after[i].add(j)
                before[j] += 1
    ready = sorted((i for i in range(n) if before[i] == 0), key=lambda i: items[i]["key"])
    order = []
    while ready:
        i = ready.pop(0)
        order.append(i)
        for j in sorted(after[i]):
            before[j] -= 1
            if before[j] == 0:
                ready.append(j)
        ready.sort(key=lambda k: items[k]["key"])
    order += [i for i in range(n) if i not in order]
    return [items[i] for i in order]


class Stage:
    def __init__(self, image, origin, cells, records, images):
        self.image, self.origin, self.cells, self.records, self.images = image, origin, cells, records, images
        self.items, self.flat = [], []
        camp = json.loads((ROOT / INPUTS["campManifest"]).read_text())
        self.camp_frames, self.camp_prints, self.camp_atlas = camp["campPanorama"]["frames"], camp["footprints"], camp["campPanorama"]
        monk = json.loads((ROOT / INPUTS["monkManifest"]).read_text())["monk"]
        world = json.loads((ROOT / INPUTS["worldManifest"]).read_text())
        self.monk = sprite_cell(images["monkAtlas"], monk["clips"]["idle"]["front"][0], monk["cell"], monk["columns"])
        hound = world["hound"]
        self.hound = sprite_cell(images["houndAtlas"], hound["clips"]["idle"]["front"][0], hound["cell"], hound["columns"])
        w = world["world"]
        self.shrine = sprite_cell(images["worldAtlas"], w["clips"]["shrine"]["front"][0], w["cell"], w["columns"])
        self.brazier = sprite_cell(images["worldAtlas"], w["clips"]["brazier-magenta"]["front"][0], w["cell"], w["columns"])

    def add(self, sprite, contact, x, y, extent, lift=0.0, actor=None):
        hw, hd = extent
        self.items.append({"sprite": sprite, "contact": contact, "x": x, "y": y, "lift": lift, "actor": actor,
                           "x0": x - hw, "x1": x + hw, "y0": y - hd, "y1": y + hd, "key": x + y})

    def ruin(self, name, x, y, lift=0.0):
        record = self.records[name]
        cell = self.cells[FRAMES.index(name)]
        if record["role"] == "flat":
            self.flat.append((cell, record["contactCenter"], x, y))
            return
        if record["shape"] == "circle":
            extent = (record["radius"], record["radius"])
        else:
            extent = (record["halfWidth"], record["halfDepth"])
        self.add(cell, record["contactCenter"], x, y, extent, lift)

    def camp(self, name, x, y):
        record = self.camp_prints[name]
        index = self.camp_frames.index(name)
        cell = sprite_cell(self.images["campAtlas"], index, self.camp_atlas["cell"], self.camp_atlas["columns"])
        extent = (record["radius"],) * 2 if record["shape"] == "circle" else (record["halfWidth"], record["halfDepth"])
        if record["role"] == "flat":
            self.flat.append((cell, record["contactCenter"], x, y))
        else:
            self.add(cell, record["contactCenter"], x, y, extent)

    def paste(self, sprite, contact, x, y, lift=0.0):
        sx, sy = to_screen(self.origin, x, y, lift)
        self.image.alpha_composite(sprite, (round(sx - contact[0]), round(sy - contact[1])))

    def render(self):
        for sprite, contact, x, y in self.flat:
            self.paste(sprite, contact, x, y)
        for item in paint_order(self.items):
            if item["actor"]:
                shadow(self.image, self.origin, item["x"], item["y"], item["actor"])
            self.paste(item["sprite"], item["contact"], item["x"], item["y"], item["lift"])


def courtyard_mock(cells, records, images, flagstone, world_cells):
    size = (1280, 720)
    origin = (676, 392)
    grass = images["campGrass"]

    def pick(x, y):
        # The paved court, with a ragged dithered verge into the camp meadow.
        edge = min(x + 6.6, 7.6 - x, y + 9.0, 6.6 - y)
        if 5.6 < y < 9.6 and -2.3 < x < 0.6:
            return flagstone  # the road mouth stays paved
        jitter = vnoise(x * 1.7, y * 1.7, 1901) * 0.9 - 0.45 + (ihash(math.floor(x * 32), math.floor(y * 32), 1902) - 0.5) * 0.3
        return flagstone if edge + jitter > 0 else grass

    image = ground_image(size, origin, pick)
    stage = Stage(image, origin, cells, records, images)
    # Ground decals first.
    for name, x, y in (("flagstones-broken", -1.2, -1.4), ("flagstone-cracks", 3.2, -1.6), ("moss-patch", -4.4, -2.6),
                       ("rubble-scatter", 4.2, -6.2), ("flagstone-cracks", -2.6, 3.6), ("moss-patch", 5.4, 3.0)):
        stage.ruin(name, x, y)
    # Back walls: corner, a run, the gate and a broken end along x; window, run and end along y.
    for name, x, y in (("wall-corner", -5.0, -7.3), ("wall-run-x", -1.5, -8.4), ("arch-gate", 2.7, -8.4),
                       ("wall-end-x", 6.4, -8.4), ("wall-window-y", -6.1, -3.8), ("wall-run-y", -6.1, 0.2),
                       ("wall-end-y", -6.1, 3.7), ("parapet-corner", 6.0, 5.0), ("parapet-x", 2.5, 6.2),
                       ("parapet-y", 7.2, 1.5), ("parapet-y", 7.2, -2.5), ("fallen-blocks", 5.6, -6.6),
                       ("column-intact", -3.0, -4.6), ("column-intact", 4.6, -4.6), ("column-broken", -3.0, 1.4),
                       ("column-intact", 4.6, 1.4), ("column-drums", 2.4, 3.6), ("ritual-plinth-runes", 0.8, -4.2),
                       ("corner-stump", 7.2, -5.3), ("rubble-small", 3.6, 5.1), ("parapet-broken-x", -4.6, 6.2),
                       ("fallen-lintel", -3.7, 4.9), ("fallen-block", 5.5, -1.0), ("rubble-pile", -2.2, 6.7),
                       ("ivy-clump", -5.15, -0.9), ("dead-tree", -4.6, 3.4), ("wall-breach-x", -9.0, -11.4)):
        stage.ruin(name, x, y)
    stage.add(world_cells[WORLD_FRAMES.index("ritual-source-01")], SHRINE_CONTACT, 0.8, -4.2, (0.86, 0.86))
    for x, y in ((-1.9, -3.9), (3.6, -3.6)):  # flanking the dais, never behind the obelisk on screen
        stage.add(world_cells[WORLD_FRAMES.index("brazier-magenta-01")], BRAZIER_CONTACT, x, y, (0.28, 0.28))
    for x, y in ((-5.0, 1.0),):
        stage.add(world_cells[WORLD_FRAMES.index("brazier-cyan-03")], BRAZIER_CONTACT, x, y, (0.28, 0.28))
    # Camp props beyond the court, for material and scale.
    for name, x, y in (("cypress-tall", -8.6, -10.4), ("cypress-pair", 5.4, -10.8), ("outcrop-crag", -9.6, 1.0),
                       ("bush-round", 9.6, 4.2), ("outcrop-ledge-x", 10.4, -2.4), ("cypress-medium", -9.2, -5.0),
                       ("grass-tuft", 8.8, 7.6), ("bush-large", 4.2, 9.4), ("boulder-round", 9.3, -6.5)):
        stage.camp(name, x, y)
    stage.ruin("dead-tree-snag", -8.6, 6.2)
    stage.add(stage.monk, (48, 84), 1.2, 1.4, (0.3, 0.3), actor=0.42)
    stage.add(stage.hound, (48, 84), -1.0, -2.6, (0.3, 0.3), actor=0.36)
    stage.render()
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, size[0], 16), fill="#20282e")
    draw.text((6, 3), "monastery-ruins mock courtyard at 1:1 native, 32 px/u: ruins, ritual source and braziers on courtyard-flagstone, "
                      "camp-panorama props beyond the walls, unchanged monk and hound (art preview, not a layout)", fill="#e3e4d8")
    return image.convert("RGB")


def style_match(cells, records, images):
    size = (1280, 340)
    origin = (600, 200)
    image = ground_image(size, origin, lambda x, y: images["campGrass"])
    stage = Stage(image, origin, cells, records, images)
    row = [("camp", "outcrop-wall-x", -9.6), ("ruin", "wall-run-x", -7.0), ("camp", "ruin-pillar", -4.6),
           ("ruin", "column-intact", -3.2), ("camp", "boulder-round", -1.9), ("ruin", "fallen-block", -0.7),
           ("camp", "outcrop-ledge-x", 1.2), ("ruin", "parapet-x", 3.8), ("camp", "cypress-medium", 5.9),
           ("ruin", "dead-tree", 7.2), ("camp", "bush-round", 8.6), ("ruin", "ivy-clump", 9.7)]
    for kind, name, s in row:
        (stage.camp if kind == "camp" else stage.ruin)(name, 1.5 - s, 1.5 + s)
    stage.add(stage.monk, (48, 84), 1.5 - 11.4, 1.5 + 11.4, (0.3, 0.3), actor=0.42)
    stage.render()
    draw = ImageDraw.Draw(image)
    for n, (kind, name, s) in enumerate(row):
        sx, sy = to_screen(origin, 1.5 - s, 1.5 + s)
        draw.text((round(sx) - 3 * len(name), round(sy) + 30 + 14 * (n % 2)), name, fill="#e3e4d8" if kind == "ruin" else "#b9c2b0")
    draw.rectangle((0, 0, size[0], 16), fill="#20282e")
    draw.text((6, 3), "style match at 1:1: camp-panorama prop, then the monastery-ruins counterpart, left to right; monk for scale",
              fill="#e3e4d8")
    return image.convert("RGB")


def world_sheet(cells, scale, background="#8f8a84"):
    label = 16
    sheet = Image.new("RGBA", (WORLD_CELL * WORLD_COLUMNS, (WORLD_CELL + label) * WORLD_ROWS), background)
    draw = ImageDraw.Draw(sheet)
    for i, cell in enumerate(cells):
        x, y = (i % WORLD_COLUMNS) * WORLD_CELL, (i // WORLD_COLUMNS) * (WORLD_CELL + label)
        sheet.alpha_composite(cell, (x, y))
        draw.text((x + 4, y + WORLD_CELL + 2), f"{i}: {WORLD_FRAMES[i]}", fill="#20282e")
        draw.point((x + WORLD_ANCHOR[0], y + WORLD_ANCHOR[1]), fill="#bb332f")
        contact = BRAZIER_CONTACT if WORLD_FRAMES[i].startswith("brazier") else SHRINE_CONTACT
        draw.rectangle((x + contact[0] - 1, y + contact[1] - 1, x + contact[0] + 1, y + contact[1] + 1), outline="#ff3b30")
    if scale > 1:
        sheet = sheet.resize((sheet.width * scale, sheet.height * scale), Image.Resampling.NEAREST)
    return sheet


def world_tile(flagstone, size):
    """A projected patch of courtyard paving as a preview background."""
    origin = (size[0] / 2, size[1] * 0.6)
    return ground_image(size, origin, lambda x, y: flagstone)


def world_vs_v2(world_cells, images, flagstone):
    """pixel-v2 world frames next to their pixel-v11 replacements on courtyard paving, monk for scale."""
    old = json.loads((ROOT / INPUTS["worldManifest"]).read_text())["world"]
    v2 = images["worldAtlas"]
    pairs = [("brazier-cyan", "brazier-cyan"), ("brazier-magenta", "brazier-magenta"), ("shrine", "ritual-source"),
             ("shrine", "healing-shrine")]
    image = world_tile(flagstone, (WORLD_CELL * 9, WORLD_CELL + 36)).convert("RGBA")
    draw = ImageDraw.Draw(image)
    monk = json.loads((ROOT / INPUTS["monkManifest"]).read_text())["monk"]
    idle = sprite_cell(images["monkAtlas"], monk["clips"]["idle"]["front"][0], monk["cell"], monk["columns"])
    x = 0
    for old_clip, new_clip in pairs:
        index = old["clips"][old_clip]["front"][0]
        image.alpha_composite(sprite_cell(v2, index, old["cell"], old["columns"]), (x, 18))
        draw.text((x + 4, 4), f"v2 {old_clip}", fill="#20282e")
        x += WORLD_CELL
        key = 2 if new_clip == "ritual-source" else 3 if new_clip == "healing-shrine" else 0
        image.alpha_composite(world_cells[WORLD_FRAMES.index(f"{new_clip}-{key + 1:02d}")], (x, 18))
        draw.text((x + 4, 4), f"v11 {new_clip}-{key + 1:02d}", fill="#20282e")
        x += WORLD_CELL
    image.alpha_composite(idle, (x + 32, 18 + WORLD_ANCHOR[1] - 84))
    return image.convert("RGB")


def dais_preview(cells, records, world_cells, images, flagstone):
    """The ritual source on the courtyard dais: pixel-v2 shrine, then the pixel-v11 source sealed, open and destroyed."""
    size = (1120, 236)
    origin = (210, 40)
    image = ground_image(size, origin, lambda x, y: flagstone)
    stage = Stage(image, origin, cells, records, images)
    v2_shrine = stage.shrine
    states = [("v2 shrine on the sealed dais", "ritual-plinth-runes", v2_shrine), ("v11 ritual-source-01 sealed", "ritual-plinth-runes", 12),
              ("v11 ritual-source-04 open", "ritual-plinth", 15), ("v11 ritual-source-06 destroyed", "ritual-plinth", 17)]
    draw = ImageDraw.Draw(image)
    for n, (label, dais, source) in enumerate(states):
        x, y = 5.2 - 5.3 * n, 1.6 + 5.3 * n
        stage.ruin(dais, x, y)
        sprite = source if isinstance(source, Image.Image) else world_cells[source]
        stage.add(sprite, SHRINE_CONTACT, x, y, (0.86, 0.86))
        sx, sy = to_screen(origin, x, y)
        draw.text((round(sx) - 3 * len(label), round(sy) + 52), label, fill="#20282e")
    stage.add(stage.monk, (48, 84), 5.2 - 5.3 * 3.68, 1.6 + 5.3 * 3.68, (0.3, 0.3), actor=0.42)
    stage.render()
    return image.convert("RGB")


def world_gif(world_cells, flagstone, sequence, durations, scale=2):
    """An animated preview over courtyard paving (Pillow GIF, palette per frame)."""
    background = world_tile(flagstone, (WORLD_CELL, WORLD_CELL)).convert("RGBA")
    frames = []
    for index in sequence:
        frame = background.copy()
        frame.alpha_composite(world_cells[index])
        frames.append(frame.convert("RGB").resize((WORLD_CELL * scale, WORLD_CELL * scale), Image.Resampling.NEAREST))
    buffer = io.BytesIO()
    frames[0].save(buffer, "GIF", save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=False,
                   disposal=1)
    return buffer.getvalue()


README = """# Monastery ruins package

Programmatic pixel art for the monastery courtyard, drawn in the camp panorama's stone language so camp, road and
courtyard read as one world. Every pixel is drawn by `scripts/build-monastery-ruins-assets.py` from fixed geometry,
fixed seeds and explicit palettes. No image generation, network access or new dependency is involved.

## Runtime use

- Courtyard: `src/courtyard-layout.js` places the ruin frames by `manifest.footprints` (colliders included);
  `src/pixel-assets.js` registers `monasteryRuins`, `monasteryWorld` and `courtyardFlagstone`; `src/pixel-scene.js`
  loads both hit masks and draws the props, the dais states and the braziers.
- Road: `src/road-country.js` uses the gate pieces (`arch-gate`, `fallen-lintel`, `rubble-pile`, `column-drums`);
  `src/country-border.js` reads the frames' footprints and `opaqueBounds`.
- Ground: `src/country-terrain.js` samples `courtyard-flagstone.png` for the court's stone.
- `src/render.js` draws the ritual source, the braziers and the healing shrine from `monasteryWorld`.

Frame names, clip names and footprints are therefore part of the runtime contract.

## Contents

| File | Contents |
| --- | --- |
| `monastery-ruins.png` | Atlas, cell 256 px, 4 columns × 8 rows, registration anchor `[128,232]`, binary alpha, {prop_colors} opaque colours. |
| `courtyard-flagstone.png` | Opaque 128 × 128 ground surface (4u, 32 px/u), seamless on both axes, {surface_colors} colours. |
| `monastery-world.png` | World atlas for the ritual source, healing shrine and braziers: cell 160, 6 × 4, anchor `[80,144]`, the pixel-v2 `world` layout. |
| `hit-masks.json` | Little-bit-first masks of both atlases' alpha, keyed by `monastery-ruins.png` and `monastery-world.png`. |
| `manifest.json` | Runtime contract: atlas slicing, frame keys, surfaces, footprints, `opaqueBounds` (opaque `[x0,y0,x1,y1]` box of each cell, exclusive end, as in pixel-v9). |
| `frames/*.png`, `frames/world/*.png` | One cell per frame (256 px ruins, 160 px world). |
| `previews/` | Contact sheets (native, 2×; ruins and world), footprint overlay, mock courtyard with camp props, style match against camp props, pixel-v2 vs pixel-v11 world frames, the v2 and v11 ritual source on the dais, animated GIF loops, 3×3 surface repeats (native, 2×). |
| `source/footprints.json` | Geometry contract the art was drawn to (written by the script from `SPECS`). |
| `source/palette.json`, `source/provenance.json`, `qa-report.json` | Palette with reproducible concept samples, input hashes, per-frame checks. |

Frames, in atlas order: {frame_list}.

## Frames

- Walls (0.8u thick, 0.42u courses): `wall-run-x/-y` (4u runs), `wall-window-x/-y` (4u, round-headed window,
  sill 0.84u, head 2.18u), `wall-end-x/-y` (3u, crumbling towards +x / +y), `wall-breach-x` (4u, collapsed middle
  with rubble), `wall-corner` (inner back corner, 3u arms along +x and +y). Both orientations are drawn: a mirror
  would put the shade-side colours on the lit face.
- `arch-gate`: 4.4u gate spanning world x, walkable passage 2.5u wide along y, crown 2.93u, eleven voussoirs.
- Low parapets (0.6u thick, 0.76u with coping): `parapet-x/-y` (4u), `parapet-corner` (outer front corner, arms
  along -x and -y), `parapet-broken-x/-y` (3u, broken down to 0.54u, with a bare walkable gap in the middle and one
  collider per standing chunk). `corner-stump` (1.5u square pier, 1.35u)
  fills a notched court corner.
- Columns: `column-intact` (3.27u: plinth, eight drums, necking, echinus, abacus), `column-broken` (fractured at
  1.7u), `column-drums` (toppled drums half sunk in the soil, a stump and a slab).
- `ritual-plinth`: flat ground art (role `flat`, no collider), an octagonal stepped dais 4 × 4u with rim tiers of
  0.06u and 0.12u around a ground-level square `socket` (half 1.0u) where the ritual source's own pedestal stands.
  `ritual-plinth-runes` is the same dais with its carved glyphs and radial veins glowing magenta: identical
  alpha, swap frames (runes while the seal holds, the plain dais after it breaks).
- Fallen masonry: `fallen-block`, `fallen-lintel` (moulded, broken in two), `fallen-blocks`; `rubble-pile`
  (1.8u heap) and `rubble-small` (1u heap).
- Flat ground decals (role `flat`, ground layer, no outline): `rubble-scatter`, `flagstones-broken`,
  `flagstone-cracks` (transparent except the cracks, for any paving), `moss-patch` (moss and ivy runners).
- Plants: `ivy-clump` (ivy over a broken stub), `dead-tree`, `dead-tree-snag`. Ivy also grows on several walls,
  the arch and the broken column.

Magenta appears only in `ritual-plinth-runes`, `brazier-magenta` and the sealed `ritual-source` keys (ritual
energy, per `docs/art-direction.md`); turquoise only in `brazier-cyan` and the open source keys; amber only in the
healing shrine.

## World atlas (ritual source, healing shrine, braziers)

`monastery-world.png` replaces the lavender pixel-v2 world frames in the same stone. Its layout is the pixel-v2
`world` atlas contract, so the runtime swaps atlas and clip names only: cell 160, 6 columns × 4 rows, anchor
`[80,144]`, six keys per clip, {world_colors} opaque colours.

| Clip | Keys | Runtime use |
| --- | --- | --- |
| `brazier-cyan` | 0–5 | turquoise flame loop, `worldPose` step 0.1 s |
| `brazier-magenta` | 6–11 | magenta (ritual) flame loop, step 0.12 s |
| `ritual-source` | 12–17 | key 0 sealed, 1 sealed flare, 2–4 open pulse (turquoise), 5 destroyed (render.js keys 0 / 2–4 / 5) |
| `healing-shrine` = `shrine` | 18–23 | amber activation at `worldPose('shrine')` times 0, .1, .24, .4, .62, .9 |

The shrine pedestal's contact centre is cell pixel `(80,124)`, exactly where render.js registers the pixel-v2
shrine; the pedestal is a 1.72u square, so it stands inside the courtyard dais socket at ground level. A brazier's
foot centre is the anchor `(80,144)`; its stone foot has radius 0.28u (the bowl overhangs). Stone parts are
identical in every key of a clip: only flame, crystal, glyphs and motes change. The frames carry their own glow
colours, so the runtime should not tint them (render.js currently sets a pink or cyan emissive on the v2 shrine).
`manifest.monasteryWorld.footprints` records each clip's footprint and key meaning.

## Registration

`[128,232]` is a fixed registration point, not a footprint centre. Each frame's ground footprint is
`footprints.<frame>`: `contactCenter` in cell pixels plus a world-space shape (`box`/`rect`: `halfWidth` along
world x = screen down-left, `halfDepth` along world y = screen down-right; `circle`: `radius`). The front-most
footprint point sits on row 231. Pixel offset `(du,dv)` from `contactCenter` maps to world `x=(2dv-du)/(32√2)`,
`y=(2dv+du)/(32√2)`; mirrored placements swap the roles of x and y. Placement works exactly like the pixel-v9
props in `src/camp-layout.js` (`put()`): sprite position = footprint centre − `toWorld(contactCenter − anchor)`.

Extensions over pixel-v9: `colliders` (exact solid boxes of `wall-corner`, `parapet-corner`, the two `arch-gate`
piers and the standing chunks of `parapet-broken-*`, world units relative to the footprint centre), `passage` (the arch's walkable box), `window`,
`axis` (wall direction), `brokenEnd`, `socket` (the dais's ground-level centre), `variantOf` and `state` (a swap
frame with the same placement and alpha) and `contact` (`corners`: every collider's front, screen-left and
screen-right ground corner lies within 1.6 px of the drawing; `loose`: organic edge; `none`).

## Ground surface

`manifest.surfaces.courtyardFlagstone` follows the pixel-v6 surface contract: sample at `worldXZ / 4` with repeat.
Image columns run along world +x and rows along world −y (textures load with `invertY`). Courses of 36/28/34/30 px
(≈1u) run along x in running bond, slabs 24–52 px long; no joint touches a tile edge, so the wrap is invisible. Each
slab has its own tone with mottling, a lit lip on its +row/+col edge, chipped corners, hairline cracks and moss in
some joints. The stone tones are the decals' `S_*` colours, so `flagstones-broken` and `flagstone-cracks` sit on it.

## Rebuild and verify

From the repository root (tested with Python {python}, Pillow {pillow}):

```sh
python3 -B scripts/build-monastery-ruins-assets.py
python3 -B scripts/build-monastery-ruins-assets.py --verify-only
node --test tests/monastery-ruins-assets.test.js
```

`--verify-only` redraws every delivered file in memory, compares bytes and input hashes, writes nothing and exits
non-zero on any difference. Byte identity is guaranteed only with the recorded Pillow version.

## Limits

- Programmatic drawing: masonry is a heightfield of rounded, chipped blocks with patterned faces (courses,
  head joints, voussoirs, drum beds). Faces are flat planes; individual face blocks do not protrude.
- No animation. The rune frame is static; the glow does not pulse.
- The arch passage and the window are see-through. Billboard sorting cannot put an actor between the piers in
  front of the far jamb; the courtyard integration has to handle that (for example with the tent translucency).
- Colliders and placement are the courtyard layout's decision; footprints are the drawing contract.
"""


def build_outputs():
    records = contract()["frames"]
    assert list(records) == FRAMES and len(FRAMES) <= COLUMNS * ROWS
    images = {key: load_rgba(ROOT / path) for key, path in INPUTS.items() if path.endswith(".png")}
    cells = [draw_frame(name, records) for name in FRAMES]
    atlas = Image.new("RGBA", (CELL * COLUMNS, CELL * ROWS), (0, 0, 0, 0))
    for i, cell in enumerate(cells):
        atlas.alpha_composite(cell, ((i % COLUMNS) * CELL, (i // COLUMNS) * CELL))
    atlas_colors = sorted({p[:3] for p in pixels(atlas) if p[3]})
    assert len(atlas_colors) <= 64, f"palette budget exceeded: {len(atlas_colors)}"
    reports = [frame_report(name, cell, records[name]) for name, cell in zip(FRAMES, cells)]
    for report in reports:
        assert report["maxOpaqueRow"] <= LAST_ROW, f"{report['frame']} draws below the anchor"
        assert report["opaqueOnFootprint"] > 0, f"{report['frame']} does not touch its footprint"
        assert report.get("maxContactGap", 0) <= 1.6, f"{report['frame']} contact gap {report.get('maxContactGap')}"
    world_cells = [draw_world_frame(name) for name in WORLD_FRAMES]
    world_atlas = Image.new("RGBA", (WORLD_CELL * WORLD_COLUMNS, WORLD_CELL * WORLD_ROWS), (0, 0, 0, 0))
    for i, cell in enumerate(world_cells):
        world_atlas.alpha_composite(cell, ((i % WORLD_COLUMNS) * WORLD_CELL, (i // WORLD_COLUMNS) * WORLD_CELL))
    world_colors = sorted({p[:3] for p in pixels(world_atlas) if p[3]})
    assert len(world_colors) <= 64, f"world palette budget exceeded: {len(world_colors)}"
    world_reports = []
    for name, cell in zip(WORLD_FRAMES, world_cells):
        box = cell.getchannel("A").getbbox()
        world_reports.append({"frame": name, "bbox": list(box), "colors": len({p[:3] for p in pixels(cell) if p[3]}),
                              "opaquePixels": sum(1 for a in pixels(cell.getchannel("A")) if a)})
    flagstone, courses = courtyard_flagstone()
    surface_colors = len(set(pixels(flagstone)))
    assert surface_colors <= 24, "surface palette budget exceeded"
    outputs = {}
    outputs["monastery-ruins.png"] = png_bytes(atlas)
    outputs["courtyard-flagstone.png"] = png_bytes(flagstone)
    for name, cell in zip(FRAMES, cells):
        outputs[f"frames/{name}.png"] = png_bytes(cell)
    outputs["monastery-world.png"] = png_bytes(world_atlas)
    for name, cell in zip(WORLD_FRAMES, world_cells):
        outputs[f"frames/world/{name}.png"] = png_bytes(cell)
    outputs["hit-masks.json"] = json_bytes({"monastery-ruins.png": pack_mask(atlas), "monastery-world.png": pack_mask(world_atlas)})
    outputs["previews/contact-native.png"] = png_bytes(contact_sheet(cells, 1))
    outputs["previews/contact-2x.png"] = png_bytes(contact_sheet(cells, 2))
    outputs["previews/footprints-native.png"] = png_bytes(contact_sheet(cells, 1, records))
    outputs["previews/courtyard-flagstone-repeat-native.png"] = png_bytes(repeat_preview(flagstone, 1))
    outputs["previews/courtyard-flagstone-repeat-2x.png"] = png_bytes(repeat_preview(flagstone, 2))
    flagstone_rgba = flagstone.convert("RGBA")
    outputs["previews/courtyard-mock.png"] = png_bytes(courtyard_mock(cells, records, images, flagstone_rgba, world_cells))
    outputs["previews/style-match.png"] = png_bytes(style_match(cells, records, images))
    outputs["previews/world-contact-native.png"] = png_bytes(world_sheet(world_cells, 1))
    outputs["previews/world-contact-2x.png"] = png_bytes(world_sheet(world_cells, 2))
    outputs["previews/world-vs-v2.png"] = png_bytes(world_vs_v2(world_cells, images, flagstone_rgba))
    outputs["previews/ritual-dais-v2-vs-v11.png"] = png_bytes(dais_preview(cells, records, world_cells, images, flagstone_rgba))
    outputs["previews/brazier-cyan-loop.gif"] = world_gif(world_cells, flagstone_rgba, range(0, 6), 100)
    outputs["previews/brazier-magenta-loop.gif"] = world_gif(world_cells, flagstone_rgba, range(6, 12), 120)
    outputs["previews/ritual-source-states.gif"] = world_gif(world_cells, flagstone_rgba, [12, 13, 12, 13, 14, 15, 16, 14, 15, 16, 17],
                                                             [500, 250, 500, 250, 250, 250, 250, 250, 250, 250, 1200])
    outputs["previews/healing-shrine-activation.gif"] = world_gif(world_cells, flagstone_rgba, range(18, 24),
                                                                  [600, 140, 160, 220, 280, 1200])
    samples = median_samples(images)
    outputs["source/footprints.json"] = json_bytes(contract())
    outputs["source/palette.json"] = json_bytes({
        "schemaVersion": 1,
        "method": "Camp panorama ramps reused by name and hex; additions hand-tuned against reproducible median-cut "
                  "samples (10 colours, no dither) of the named regions.",
        "props": {name: {"hex": value, "nearestSample": nearest_sample(value, samples)} for name, value in PALETTE.items()},
        "surfaces": {"courtyardFlagstone": {name: {"hex": value, "nearestSample": nearest_sample(value, samples)}
                                            for name, value in SURFACE_PALETTE.items()}},
        "sharedWithCampPanorama": sorted(name for name in PALETTE if name not in NEW_COLORS),
        "samples": samples,
    })
    input_hashes = {key: {"path": path, "sha256": digest((ROOT / path).read_bytes())} for key, path in INPUTS.items()}
    outputs["source/provenance.json"] = json_bytes({
        "schemaVersion": 1,
        "method": "programmatic drawing: heightfield masonry (rounded, chipped blocks; coursed, voussoir and drum face "
                  "patterns) splatted into a z-buffer with grounded and floating passes, ray-cast ellipsoids for bark and "
                  "foliage tufts, screen-space flat decals, and a running-bond slab surface",
        "generator": "scripts/build-monastery-ruins-assets.py",
        "rendererOrigin": "Canvas, ellipsoid, rod, tuft, base_grass and the rock tone rules are adapted copies of "
                          "scripts/build-camp-panorama-assets.py (copied, not imported, so camp edits never change these bytes)",
        "imageGeneration": None,
        "tools": {"python": sys.version.split()[0], "pillow": PILLOW_VERSION},
        "inputs": input_hashes,
        "inputRoles": {
            "campAtlas": "palette samples; camp props in the mock courtyard and style match", "campManifest": "camp frame order and footprints",
            "campGrass": "preview meadow", "campEarth": "soil palette sample",
            "worldAtlas": "registration and timing reference for monastery-world.png (no pixels copied); v2 frames in "
                          "the comparison preview; magenta sample",
            "worldManifest": "brazier, shrine and hound clips (layout the world atlas reproduces)", "houndAtlas": "hound for scale",
            "monkAtlas": "unchanged hero for scale", "monkManifest": "idle frame index",
            "conceptRoad": "palette samples and courtyard arrangement reference (Paper p-4-0 artboard 03), no pixels copied",
            "conceptKit": "flagstone, wall corner, arch and drum reference (Paper p-4-0 artboard 06), no pixels copied",
            "keyart": "courtyard stone reference (art bible 07), no pixels copied",
            "courtyardV1": "the current courtyard wall, arch and column art, recorded as the replaced reference",
        },
        "seeds": "fixed integer salts in the script; random.Random only",
        "license": "project art; no external assets",
    })
    outputs["qa-report.json"] = json_bytes({
        "schemaVersion": 1,
        "atlas": {"size": list(atlas.size), "opaqueColors": len(atlas_colors), "binaryAlpha": True,
                  "magentaFrames": sorted({FRAMES[i] for i, cell in enumerate(cells)
                                           if any(p[3] and p[:3] in {hexrgb(PALETTE[k]) for k in RUNE_KEYS} for p in pixels(cell))})},
        "frames": reports,
        "world": {"size": list(world_atlas.size), "opaqueColors": len(world_colors), "binaryAlpha": True, "frames": world_reports},
        "surfaces": {"courtyardFlagstone": {**surface_report(flagstone),
                                            "courses": [{"rows": h, "headJoints": cuts} for h, cuts in courses]}},
    })
    manifest = {
        "schemaVersion": 1, "status": "ready", "nativePixelsPerUnit": 32,
        "monasteryRuins": {"path": "monastery-ruins.png", "cell": CELL, "columns": COLUMNS, "rows": ROWS,
                           "anchor": list(ANCHOR), "frames": FRAMES, "filter": "nearest", "mipmaps": False},
        "monasteryWorld": world_manifest(),
        "surfaces": {"courtyardFlagstone": {"path": "courtyard-flagstone.png", "size": [SURFACE, SURFACE],
                                            "filter": "nearest", "mipmaps": False}},
        "footprints": records,
        "opaqueBounds": {report["frame"]: report["bbox"] for report in reports},
        "hitMasks": "hit-masks.json", "provenance": "source/provenance.json", "palette": "source/palette.json",
        "previews": "previews/contact-native.png",
    }
    outputs["manifest.json"] = json_bytes(manifest)
    outputs["README.md"] = README.format(
        prop_colors=len(atlas_colors), surface_colors=surface_colors, world_colors=len(world_colors), frame_list=", ".join(f"`{n}`" for n in FRAMES),
        python=sys.version.split()[0], pillow=PILLOW_VERSION).encode()
    return outputs, {"atlasColors": len(atlas_colors), "worldColors": len(world_colors), "surfaceColors": surface_colors,
                     "files": len(outputs),
                     "maxContactGap": max(r.get("maxContactGap", 0) for r in reports)}


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
