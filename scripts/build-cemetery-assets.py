#!/usr/bin/env python3
"""Draw the old cemetery package programmatically; --verify-only never writes.

Grave steles, cairns, mounds, an obelisk, stone lanterns, fences, a bell gate,
urns, an offering stone, yews and flat ground decals for «Старое кладбище»,
rendered in the camp panorama's stone language: every stone is a heightfield
mass with a rounded, chipped top, mossy beds and blue-green bounce light,
splatted into a z-buffer; carvings are cut in screen space on the true face
planes. No image generation, network or dependency installation is involved.
Paths resolve from this script; output is confined to
assets/game/pixel-v13/cemetery.
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
OUT = ROOT / "assets/game/pixel-v13/cemetery"
INPUTS = {
    "campAtlas": "assets/game/pixel-v9/camp-panorama/camp-panorama.png",
    "campManifest": "assets/game/pixel-v9/camp-panorama/manifest.json",
    "campPalette": "assets/game/pixel-v9/camp-panorama/source/palette.json",
    "campGrass": "assets/game/pixel-v9/camp-panorama/camp-grass.png",
    "ruinsAtlas": "assets/game/pixel-v11/monastery-ruins/monastery-ruins.png",
    "ruinsManifest": "assets/game/pixel-v11/monastery-ruins/manifest.json",
    "ruinsPalette": "assets/game/pixel-v11/monastery-ruins/source/palette.json",
    "monkAtlas": "assets/game/pixel-v2/monk/monk-v2.png",
    "monkManifest": "assets/game/pixel-v2/monk/manifest.json",
}
FRAMES = ["stele-tall-x", "stele-tall-y", "stele-low-x", "stele-low-y",
          "stele-leaning-x", "stele-leaning-y", "stele-fallen-x", "stele-fallen-y",
          "cairn-small", "cairn-large", "grave-mound-x", "grave-mound-y",
          "grave-plot-x", "grave-plot-y", "obelisk", "obelisk-broken",
          "stone-lantern", "stone-lantern-toppled", "fence-x", "fence-y",
          "fence-broken-x", "fence-broken-y", "cemetery-gate-x", "cemetery-gate-y",
          "urn-pair", "urn-broken", "offering-stone", "yew-round",
          "yew-small", "grave-ash", "stepping-slabs", "moss-graves"]
CELL, COLUMNS, ROWS, ANCHOR = 256, 4, 8, (128, 232)
LAST_ROW = 231
PALETTE_BUDGET = 48

# One prop palette. Stone, moss, foliage, bark, bronze and grass are the camp
# panorama ramps unchanged (same names, same hex); the lit-face tone, soil,
# turquoise and magenta come from the monastery ruins. Nothing is new, so the
# cemetery reads as the same world as the camp, the road and the courtyard.
PALETTE = {
    "OUT": "#0e121d", "DEEP": "#1f2737", "DEEP2": "#2d2f40",
    "Q_HI": "#c9b79b", "Q_W1": "#b09c82", "Q_T1": "#9f9280", "Q_T2": "#877d72", "Q_T3": "#6c6564",
    "Q_L0": "#7b7270", "Q_L1": "#706968", "Q_L2": "#5c5258", "Q_M": "#4a4753", "Q_S1": "#3d3e4c", "Q_S2": "#30344a",
    "Q_AMB": "#3c4b52",
    "M_HI": "#9a9358", "M1": "#7d7b4f", "M2": "#626445", "M3": "#4a523f",
    "F4": "#0f2b3c", "F5": "#081a2b",
    "B_HI": "#6f8467", "B1": "#4f6759", "B2": "#37504b", "B3": "#263c3e",
    "G_HI": "#6f8a64", "G1": "#4c6a55", "G2": "#33504a",
    "T1": "#6e4f45", "T2": "#4a3438", "T3": "#2f2230",
    "Y1": "#b8935c", "Y2": "#8c6c46", "Y3": "#d3bb8f",
    "SOIL1": "#82664c", "SOIL2": "#6c5440", "SOIL3": "#4b3a33",
    "C0": "#e6fffb", "C1": "#92faf1", "C2": "#24ced5", "C3": "#1cabb8", "C4": "#14707e",
    "RUNE1": "#ff4bb7", "RUNE2": "#cf1b87", "RUNE3": "#7c3767",
}
RUINS_ONLY = ("Q_L0", "SOIL1", "SOIL2", "SOIL3", "C0", "C1", "C2", "C3", "C4", "RUNE1", "RUNE2", "RUNE3")
CYAN_KEYS = ("C0", "C1", "C2", "C3", "C4")
MAGENTA_KEYS = ("RUNE1", "RUNE2", "RUNE3")

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


def vnoise(x, y, salt):
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = ihash(ix, iy, salt), ihash(ix + 1, iy, salt)
    c, d = ihash(ix, iy + 1, salt), ihash(ix + 1, iy + 1, salt)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy


def ab(axis, a, b):
    """World (x, y) of a point given along / across a prop's axis."""
    return (a, b) if axis == "x" else (b, a)


def abox(axis, a0, a1, b0, b1):
    return (a0, a1, b0, b1) if axis == "x" else (b0, b1, a0, a1)


# --------------------------------------------------------------------------
# Sprite canvas: exact orthographic 2:1 projection into a z-buffer (the camp
# panorama renderer as copied by the ruins script; copied again here so later
# edits there never change these bytes).
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
                        # Grass blades and litter lying over a stone cut no seam into it.
                        if (style[j] or {}).get("flat"):
                            continue
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


def moss_at(x, y, salt, amount, fine=0.3):
    m = vnoise(x * 2.7 + 11.3, y * 2.7 - 4.1, salt) * (1 - fine) + vnoise(x * 8.5, y * 8.5, salt + 3) * fine
    return m - (1 - amount)


# --------------------------------------------------------------------------
# Stone masses (the ruins heightfield). Every stone is a rounded plan rectangle
# (or disc) with a bevelled, chipped top; stones merge with max() into a field
# sampled GRID times per unit. Grounded passes paint each sample down to its
# lowest front neighbour; floating passes (rails, lintels, caps, a leaning
# slab's overhang) paint from their underside to their top.
# --------------------------------------------------------------------------

GRID = 48
PX_Z = 1 / KZ        # one screen row of height
JB = 0.034           # bed joint: one row
ARRIS = 0.038


class Block:
    snap = True
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


class Slab(Block):
    """An upright monolith whose top follows profile(a) across its width."""

    def __init__(self, axis, a0, a1, b0, b1, z0, profile, salt, **kw):
        self.axis, self.profile, self.ca = axis, profile, (a0 + a1) / 2
        z1 = max(profile((a1 - a0) * (k / 40 - 0.5)) for k in range(41))
        super().__init__(*abox(axis, a0, a1, b0, b1), z0, z1, salt, **kw)

    def top(self, x, y):
        a = x if self.axis == "x" else y
        return self.profile(a - self.ca) + self.rough * (vnoise(x * 6.0, y * 6.0, self.salt + 2) - 0.5)


class LeaningSlab(Block):
    """A thin monolith rolled in its own plane: the top sways towards -along
    (away from the viewer), one foot sinks into the soil. Local u runs across
    the width, w up the slab; profile(u) is the top. Drawn as a floating mass."""

    def __init__(self, axis, ca, cb, ha, hb, profile, roll, sink, salt, **kw):
        self.axis, self.ca, self.cb, self.ha, self.hb, self.profile = axis, ca, cb, ha, hb, profile
        self.cos, self.sin, self.sink = math.cos(roll), math.sin(roll), sink
        outline = [(ha * (k / 20 * 2 - 1), profile(ha * (k / 20 * 2 - 1))) for k in range(21)] + [(-ha, 0.0), (ha, 0.0)]
        along = [ca + u * self.cos - w * self.sin for u, w in outline]
        zs = [u * self.sin + w * self.cos - sink for u, w in outline]
        super().__init__(*abox(axis, min(along), max(along), cb - hb, cb + hb), 0.0, max(zs), salt, **kw)
        self._columns = {}

    def local(self, a, z):
        da, dz = a - self.ca, z + self.sink
        return da * self.cos + dz * self.sin, -da * self.sin + dz * self.cos

    def column(self, a):
        key = round(a * GRID * 4)
        if key not in self._columns:
            lo = hi = None
            for k in range(int(self.z1 / 0.004) + 2):
                z = k * 0.004
                u, w = self.local(a, z)
                if abs(u) <= self.ha and 0.0 <= w <= self.profile(u):
                    lo = z if lo is None else lo
                    hi = z
            self._columns[key] = None if lo is None or hi - lo < 0.004 else (lo, hi)
        return self._columns[key]

    def height(self, x, y):
        a, b = (x, y) if self.axis == "x" else (y, x)
        e = self.hb - abs(b - self.cb)
        if e <= 0:
            return None
        span = self.column(a)
        if span is None:
            return None
        lo, hi = span
        bev = self.bevel
        if e < bev:  # the long arrises are rounded
            hi -= bev - math.sqrt(max(0.0, bev * bev - (bev - e) ** 2))
        return max(hi, lo + 0.01)

    def underside(self, x, y):
        span = self.column(x if self.axis == "x" else y)
        return span[0] if span else 0.0


class LyingSlab(Block):
    """A fallen stele lying face up: a plan rectangle with one rounded end
    (the old top) at -along; `half` shrinks the outline into one broken piece."""

    def __init__(self, axis, a0, a1, b0, b1, z0, z1, salt, rounded="start", **kw):
        self.axis, self.rounded = axis, rounded
        self.a0, self.a1, self.b0, self.b1 = a0, a1, b0, b1
        super().__init__(*abox(axis, a0, a1, b0, b1), z0, z1, salt, **kw)

    def edge(self, x, y):
        a, b = (x, y) if self.axis == "x" else (y, x)
        hb, cb = (self.b1 - self.b0) / 2, (self.b0 + self.b1) / 2
        rect = max(self.a0 - a, a - self.a1, abs(b - cb) - hb)
        if self.rounded == "start" and a < self.a0 + hb:
            rect = max(math.hypot(a - (self.a0 + hb), b - cb) - hb, a - self.a1)
        rc = 0.02
        return rect + rc * 0 + self.wobble * vnoise(x * 9.0 + 3.1, y * 9.0, self.salt)


class TaperShaft(Block):
    """A square shaft narrowing from half h0 at z0 to h1 at z1, ending in a
    pyramid cap (cap height) or, when broken, in a jagged fracture."""

    def __init__(self, cx, cy, h0, h1, z0, z1, cap, salt, broken=False, **kw):
        self.h0, self.h1, self.zt, self.cap, self.broken = h0, h1, z1, cap, broken
        super().__init__(cx - h0, cx + h0, cy - h0, cy + h0, z0, z1 + (0 if broken else cap), salt, **kw)

    def height(self, x, y):
        d = max(abs(x - self.cx), abs(y - self.cy))
        if d >= self.h0:
            return None
        if self.broken:
            top = (self.zt - 0.16 * (x - self.cx + self.h0) / (2 * self.h0) + 0.1 * (y - self.cy) / self.h0
                   + 0.07 * (vnoise(x * 16, y * 16, self.salt) - 0.5))
        else:
            top = self.zt + self.cap * max(0.0, 1 - d / self.h1)
        if self.h0 - self.h1 > 1e-6 and d > self.h1:
            return min(top, self.z0 + (self.h0 - d) / (self.h0 - self.h1) * (self.zt - self.z0))
        return top


class Mound(Block):
    """A low earth mound: a superellipse plan and a domed top."""

    material = "earth"

    def __init__(self, x0, x1, y0, y1, height, salt, **kw):
        super().__init__(x0, x1, y0, y1, 0.0, height, salt, **kw)

    def height(self, x, y):
        q = (abs(x - self.cx) / self.hx) ** 3.2 + (abs(y - self.cy) / self.hy) ** 3.2
        if q >= 1:
            return None
        bump = 0.025 * (vnoise(x * 5.0, y * 5.0, self.salt) - 0.5)
        return max(0.004, self.z1 * (1 - q) ** 0.55 + bump * (1 - q))


class LyingDrum(Block):
    """A cylinder on its side along world x or y, half sunk into the soil."""

    def __init__(self, axis, a0, a1, cb, radius, salt, sink=0.18, **kw):
        self.axis, self.radius, self.cb, self.zc = axis, radius, cb, radius * (1 - sink)
        self.ca, self.ha = (a0 + a1) / 2, (a1 - a0) / 2
        super().__init__(*abox(axis, a0, a1, cb - radius, cb + radius), 0.0, self.zc + radius, salt, **kw)

    def _ab(self, x, y):
        return (x, y) if self.axis == "x" else (y, x)

    def edge(self, x, y):
        a, b = self._ab(x, y)
        return max(abs(a - self.ca) - self.ha, abs(b - self.cb) - self.radius * 0.995)

    def height(self, x, y):
        if self.edge(x, y) >= 0:
            return None
        a, b = self._ab(x, y)
        s = math.sqrt(max(0.0, self.radius ** 2 - (b - self.cb) ** 2))
        z = self.zc + s + 0.02 * (vnoise(x * 7, y * 7, self.salt) - 0.5)
        end = self.ha - abs(a - self.ca)
        if end < 0.04:  # rounded rim at both caps
            z -= (0.04 - end) * 0.9
        return max(z, self.underside(x, y) + 0.02)

    def underside(self, x, y):
        a, b = self._ab(x, y)
        s = math.sqrt(max(0.0, self.radius ** 2 - (b - self.cb) ** 2))
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
            "crack": "Q_M", "recess": "DEEP2", "carve": "Q_M", "weather": "Q_L1"},
    "mid": {"body": ("Q_L2", "Q_L2", "Q_M", "Q_L1"), "hi": "Q_L1", "low": "Q_M", "joint": "Q_S1", "deep": "DEEP2",
            "crack": "Q_S1", "recess": "DEEP2", "carve": "Q_S1", "weather": "Q_M"},
    "shade": {"body": ("Q_S1", "Q_S1", "Q_M", "Q_S1"), "hi": "Q_M", "low": "Q_S2", "joint": "Q_S2", "deep": "DEEP",
              "crack": "DEEP2", "recess": "DEEP", "carve": "DEEP2", "weather": "Q_S2"},
}


def field_normal(f, i, j):
    hx = (f.at(i + 1, j) - f.at(i - 1, j)) * GRID / 2
    hy = (f.at(i, j + 1) - f.at(i, j - 1)) * GRID / 2
    return _normalize((-hx, -hy, 1.0))


def rim_normal(f, i, j):
    """The flatter one-sided normal: on the last sample before a drop it is the
    top surface's own normal, so a thin rail's top row never alternates with
    its face colours."""
    h = f.at(i, j)
    dx = min((f.at(i + 1, j) - h, h - f.at(i - 1, j)), key=abs) * GRID
    dy = min((f.at(i, j + 1) - h, h - f.at(i, j - 1)), key=abs) * GRID
    return _normalize((-dx, -dy, 1.0))


def earth_tone(f, rock, i, j, z, floating):
    """Soil masses: dry olive grass and moss over the crown, bare soil sides,
    a few fallen leaves; the light comes from the screen's upper left."""
    x, y = f.x0 + i / GRID, f.y0 + j / GRID
    n = field_normal(f, i, j)
    b = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]
    zt = f.h[j * f.nx + i]
    leaf = ihash(round(x * 40), round(y * 40), rock.salt + 5)
    if n[2] > 0.5 and zt - z < 0.05:
        if leaf < 0.022:
            return ("Y1" if b > 0.8 else "Y2"), TOP
        if leaf < 0.03:
            return "T1", TOP
        # Large calm zones: dry grass over most of the crown, a green patch,
        # bare soil where the grass wore away; the slope carries the light.
        g = vnoise(x * 3.0, y * 3.0, rock.salt) * 0.8 + vnoise(x * 10, y * 10, rock.salt + 1) * 0.2
        if g > 0.36:
            return ("M_HI" if b > 0.9 else "M1" if b > 0.7 else "M2"), TOP
        if g > 0.3:
            return ("G_HI" if b > 0.8 else "M3"), TOP
        return ("SOIL1" if b > 0.82 else "SOIL2"), TOP
    if z < PX_Z * 1.5 or b < 0.05:
        return "SOIL3", RIGHT_FACE
    if b > 0.45:
        return ("M2" if zt - z < 0.035 else "SOIL1"), LEFT
    return ("M3" if zt - z < 0.035 else "SOIL2"), RIGHT_FACE


def mass_tone(f, blocks, i, j, z, k, floating):
    rock = blocks[k]
    if rock.material == "earth":
        return earth_tone(f, rock, i, j, z, floating)
    idx = j * f.nx + i
    x, y = f.x0 + i / GRID, f.y0 + j / GRID
    zt = f.h[idx]
    zf = f.fl[idx] if floating else 0.0
    mossy = moss_at(x, y, rock.salt, rock.moss)
    pattern = rock.pattern
    if floating and zf > 0.01 and z - zf < 0.045 and zt - z > 0.03:
        # Underside of a lintel, a cap or a leaning slab's overhang.
        gx = (f.floor_at(i + 1, j) - f.floor_at(i - 1, j)) * GRID / 2
        gy = (f.floor_at(i, j + 1) - f.floor_at(i, j - 1)) * GRID / 2
        n = _normalize((gx, gy, -1.0))
        b = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]
        return ("Q_L2" if b > 0.32 else "Q_M" if b > 0.05 else "Q_S2"), RIGHT_FACE
    n = field_normal(f, i, j)
    if n[2] <= 0.3 and zt - z < PX_Z * 0.8:
        rim = rim_normal(f, i, j)
        if rim[2] > 0.8:
            n = rim
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
    band = min(0.05 + 0.07 * vnoise(x * 7, y * 7, rock.salt + 5), 0.4 * max(0.0, zt - rock.z0))
    if zt - z < band and moss_at(x, y, rock.salt, rock.moss, fine=0.08) > 0.14:
        return ("M2" if b > 0.2 else "M3"), face
    light = "lit" if b > 0.3 else "mid" if b > -0.05 else "shade"
    ramp = FACE_RAMPS[light]
    if pattern:
        along = x if abs(nh[1]) >= abs(nh[0]) else y
        kind, variant = pattern.face(along, z, abs(nh[1]) >= abs(nh[0]), (x, y, z, zt), b)
    else:
        kind, variant = natural_face(rock, x, y, z, zt, along_is_x=abs(nh[1]) >= abs(nh[0]))
    if kind == "joint" and z < 0.4 and mossy > -0.05 and vnoise(x * 5, y * 5 + z * 3, rock.salt + 31) > 0.45:
        return ("M3" if light != "lit" else "M2"), face
    if kind == "body" and light == "lit" and b > 0.56:
        return "Q_L0", face
    if light == "shade" and z < 0.2 and kind in ("body", "low") and vnoise(x * 4 + y * 4, z * 9, rock.salt + 7) > 0.35:
        return "Q_AMB", face
    color = ramp[kind]
    return (color[variant % len(color)] if isinstance(color, tuple) else color), face


def natural_face(rock, x, y, z, zt, along_is_x):
    """Monoliths and loose stones: a lit arris under the top, grain and a darker foot."""
    along = x if along_is_x else y
    if zt - z < ARRIS:
        return "hi", 0
    if z - rock.z0 < PX_Z * 1.2:
        return "low", 0
    grain = vnoise(along * 5.0 + rock.salt, z * 4.0, rock.salt + 17)
    if grain > 0.82:
        return "crack", 0
    return "body", int(grain * 7) % 4


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
    if zt - z < PX_Z * 0.8 and rim_normal(f, i, j)[2] > 0.8:
        return None
    x, y = f.x0 + i / GRID, f.y0 + j / GRID
    if abs(hx) > abs(hy):
        return id(rock.pattern), "x", math.copysign(1, -hx), round(x * 8)
    return id(rock.pattern), "y", math.copysign(1, -hy), round(y * 8)


def draw_mass(cv, blocks, field=None, floating=False, style=None):
    """Splat a block mass; returns (field, the canvas ids it used)."""
    f = field or mass_field(blocks)
    first = cv.next_oid + 1
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
    return f, set(range(first, cv.next_oid + 1))


def floating(cv, blocks, floor_z):
    f = mass_field(blocks)
    return draw_mass(cv, blocks, carve(f, lambda x, y, top, fl: (floor_z, top)), floating=True)


class Beds:
    """Horizontal beds: plinth courses, drums, a lintel's mouldings."""

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


class Dressed:
    """A dressed monolith face (steles): one calm tone so carvings read, sparse
    darker weathering, a lit arris under the curved top, a darker foot."""

    def __init__(self, z0, salt, weather=0.74):
        self.z0, self.salt, self.weather = z0, salt, weather

    def face(self, along, z, along_is_x, point, b):
        zt = point[3]
        if zt - z < ARRIS:
            return "hi", 0
        if z - self.z0 < PX_Z * 1.2:
            return "low", 0
        if vnoise(along * 3.2 + self.salt, z * 2.4, self.salt + 3) > self.weather:
            return "weather", 0
        if ihash(round(along * KX), round(z * KZ), self.salt + 5) < 0.02:
            return "crack", 0
        return "body", 0


class Dish(Beds):
    """Marks a bowl's hollow so it can be filled after the bronze pass."""

    def top(self, x, y, zt):
        return None


# ------------------------------ carving -------------------------------------
#
# Carvings are cut after the mass is splatted: every pixel of the given ids is
# projected back onto the face plane it should lie on (vertical plane along x
# or y, or a horizontal top), so glyph cells map one to one onto screen pixels
# and rows follow the face's own slope. A groove is dark; the pixel under it
# catches the light from the upper left (its lower lip).

ENGRAVE = {
    "lit": {"groove": "Q_M", "deep": "Q_S1", "lip": "Q_T2", "crack": "DEEP2", "moss": "M2"},
    "shade": {"groove": "DEEP2", "deep": "DEEP", "lip": "Q_M", "crack": "DEEP", "moss": "M3"},
    "top": {"groove": "Q_L2", "deep": "Q_M", "lip": "Q_HI", "crack": "Q_M", "moss": "M2"},
}

# Abstract glyph marks, 3 x 4 cells (no letters, crosses or religious signs).
GLYPHS = [("110", "011", "110", "011"), ("010", "101", "101", "010"), ("101", "101", "010", "010"),
          ("111", "000", "111", "000"), ("100", "110", "011", "001"), ("010", "010", "101", "101"),
          ("111", "101", "111", "000"), ("011", "110", "011", "110"), ("110", "100", "110", "100")]


def engrave(cv, oids, plane, mark, light, tol=0.06, lips=True):
    """plane = ('x', y0[, z->y0]) face along x, ('y', x0) face along y, ('z', z0) top.
    mark(a, b) -> None | groove | deep | crack | moss | colour name, with (a, b) =
    (along, z) on a vertical face and (x, y) on a top."""
    kind, value = plane[0], plane[1]
    shift = plane[2] if len(plane) > 2 else None
    marks, on_face = {}, set()
    for i, c in enumerate(cv.color):
        if c is None or cv.oid[i] not in oids:
            continue
        px, py = i % CELL, i // CELL
        du, dv = px + 0.5 - cv.cx, py + 0.5 - cv.cy
        if kind == "z":
            if cv.face[i] != TOP:
                continue
            dz = dv + KZ * value
            x, y = (2 * dz - du) / (32 * SQ2), (2 * dz + du) / (32 * SQ2)
            p, args = (x, y, value), (x, y)
        else:
            if cv.face[i] == TOP:
                continue
            plane_at = value
            for _ in range(2 if shift else 1):
                if kind == "x":
                    y = plane_at
                    x = y - du / KX
                else:
                    x = plane_at
                    y = x + du / KX
                z = (KY * (x + y) - dv) / KZ
                if shift:
                    plane_at = shift(z)
            p, args = (x, y, z), ((x if kind == "x" else y), z)
        if abs(cv.depth[i] - (VIEW[0] * p[0] + VIEW[1] * p[1] + VIEW[2] * p[2])) > tol:
            continue
        on_face.add((px, py))
        m = mark(*args)
        if m:
            marks[(px, py)] = m
    ramp = ENGRAVE[light]
    for (px, py), m in sorted(marks.items()):
        cv.color[py * CELL + px] = ramp.get(m, m)
    if lips:
        for (px, py), m in sorted(marks.items()):
            below = (px, py + 1)
            if m in ("groove", "deep") and below in on_face and below not in marks:
                cv.color[(py + 1) * CELL + px] = ramp["lip"]
    return on_face


def glyph_mark(glyphs, a_centre, z_top, axis, gap=2):
    """A column of glyphs on a vertical face centred at a_centre, from z_top down."""
    def mark(a, z):
        col = math.floor(((a_centre - a) if axis == "x" else (a - a_centre)) * KX + 1.5)
        row = math.floor((z_top - z) * KZ)
        if not 0 <= col < 3 or row < 0:
            return None
        n, r = divmod(row, 4 + gap)
        if n >= len(glyphs) or r >= 4:
            return None
        return "groove" if glyphs[n][r][col] == "1" else None
    return mark


def band_mark(levels):
    """One-row carved bands on a vertical face, at heights `levels`."""
    def mark(a, z):
        return "groove" if any(math.floor((zb - z) * KZ) == 0 for zb in levels) else None
    return mark


def combine(*marks):
    def mark(a, b):
        for m in marks:
            r = m(a, b)
            if r:
                return r
        return None
    return mark


# ------------------------------ plants and litter ---------------------------

def base_grass(cv, points, salt, dry=0.7):
    """A few dry or green blades in front of a stone's foot."""
    rng = random.Random(salt)
    oid = cv.new_oid()
    for x, y in points:
        bx, by = cv.project(x, y, 0)
        ramp = ("M_HI", "M1", "M2") if rng.random() < dry else ("G_HI", "M1", "M2")
        for _ in range(rng.randint(3, 6)):
            ox = rng.uniform(-5, 5)
            length = rng.randint(4, 8)
            lean = rng.uniform(-0.45, 0.45)
            for step in range(length):
                f = step / length
                color = ramp[0] if f > 0.7 else ramp[1] if f > 0.3 else ramp[2]
                cv.put(math.floor(bx + ox + lean * step), math.floor(by - 1 - step), 50.0, color, oid, ROD, {"flat": True})


def top_grass(cv, f, points, salt):
    """Short blades growing out of a stone's top."""
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
                       "M_HI" if t > 0.6 else "M1" if t > 0.25 else "M2", oid, ROD, None)


def leaves(cv, rng, spots, depth=-8.0, flat=True):
    """Fallen leaves: two-pixel blades with a lit tip, a darker stalk end."""
    oid = cv.new_oid()
    style = {"flat": True}
    for x, y, z in spots:
        sx, sy = cv.project(x, y, z)
        px, py = math.floor(sx), math.floor(sy)
        kind = rng.random()
        body, tip = ("Y1", "Y2") if kind < 0.45 else ("Y2", "T1") if kind < 0.8 else ("T1", "T2")
        d = depth if flat else VIEW[0] * x + VIEW[1] * y + VIEW[2] * z + 0.06
        cells = ((0, 0, body), (1, 0, body), (1, 1, tip)) if rng.random() < 0.5 else ((0, 0, body), (0, 1, body), (1, 1, tip))
        for dx, dy, color in cells:
            cv.put(px + dx, py + dy, d, color, oid, TOP, style)


def ground_pixels(cv, hw, hd, cx=0.0, cy=0.0):
    corners = [cv.project(cx + x, cy + y, 0) for x in (-hw, hw) for y in (-hd, hd)]
    left, right, top, bottom = cv.bounds(corners)
    for py in range(top, bottom + 1):
        dv = py + 0.5 - cv.cy
        for px in range(left, right + 1):
            du = px + 0.5 - cv.cx
            x, y = (2 * dv - du) / (32 * SQ2), (2 * dv + du) / (32 * SQ2)
            if abs(x - cx) <= hw and abs(y - cy) <= hd:
                yield px, py, x, y


def put_flat(cv, colors, oid, depth=-9.0):
    for (px, py), color in sorted(colors.items()):
        cv.put(px, py, depth, color, oid, TOP, {"flat": True})


def blob(x, y, hw, hd, salt, rough=0.35):
    d = (x / hw) ** 2 + (y / hd) ** 2
    return d < 1 - rough * vnoise(x * 3.2 + 5, y * 3.2, salt) - 0.15 * vnoise(x * 9, y * 9, salt + 1)


def soil_heap(cv, centre, rx, ry, salt, height=0.07):
    """A low earth heap at a stone's sunken foot (an earth mass, no collider of its own)."""
    cx, cy = centre
    heap = Mound(cx - rx, cx + rx, cy - ry, cy + ry, height, salt)
    return draw_mass(cv, [heap])


def crack_walk(rng, start, angle, steps, cells, branch=0.0, depth=0, step=0.03):
    x, y = start
    for _ in range(steps):
        cells.append((x, y))
        angle += rng.uniform(-0.5, 0.5)
        x += math.cos(angle) * step
        y += math.sin(angle) * step
        if depth < 2 and rng.random() < branch:
            crack_walk(rng, (x, y), angle + rng.choice((-1, 1)) * rng.uniform(0.6, 1.2), steps // 2, cells, branch * 0.5,
                       depth + 1, step)


# --------------------------------------------------------------------------
# Steles. "-x" frames stand along world x: their carved broad face is the +y
# face (screen lower right, in shade). "-y" frames stand along world y: the
# carved face is +x (screen lower left, lit). Both are drawn; a mirror would
# put the lit tones on the shaded face.
# --------------------------------------------------------------------------

def face_light(axis):
    return "shade" if axis == "x" else "lit"


def stele_face(axis, b1):
    return ("x", b1) if axis == "x" else ("y", b1)


def arch_frame(profile, ha, inset, z_floor, axis):
    """A groove that follows a stele's outline `inset` inside its sides and top."""
    side = ha - inset

    def curve(a):
        return profile(max(-side, min(side, a))) - inset * 1.25

    def mark(a, z):
        rel = a  # profile coordinates are relative to the stele centre
        col_edge = abs(abs(rel) - side) * KX < 0.5
        if col_edge and z_floor <= z <= curve(rel):
            return "groove"
        if abs(rel) > side:
            return None
        d = 0.5 / KX
        lo, hi = sorted((curve(rel - d), curve(rel + d)))
        if lo - 0.5 / KZ <= z <= hi + 0.5 / KZ and z >= z_floor:
            return "groove"
        return None
    return mark


def draw_stele_tall(cv, axis):
    salt = 101 if axis == "x" else 111
    base = Block(*abox(axis, -0.36, 0.36, -0.17, 0.17), 0.0, 0.14, salt, corner=0.03, bevel=0.035, chips=2,
                 chip_depth=(0.03, 0.06), wobble=0.0, moss=0.55, warm=True, pattern=Beds([0.0, 0.14], salt + 1))
    profile = lambda a: 1.22 + 0.3 * math.sqrt(max(0.0, 1 - (a / 0.3) ** 2))
    slab = Slab(axis, -0.3, 0.3, -0.09, 0.09, 0.14, profile, salt + 2, corner=0.03, bevel=0.035, chips=1,
                chip=(0.05, 0.1), chip_depth=(0.04, 0.07), moss=0.42, pattern=Dressed(0.14, salt + 3))
    _, base_ids = draw_mass(cv, [base])
    f, ids = draw_mass(cv, [slab])
    mark = combine(arch_frame(profile, 0.3, 0.06, 0.3, axis), band_mark([0.24]),
                   glyph_mark([GLYPHS[1], GLYPHS[4], GLYPHS[7]], 0.0, 1.27, axis))
    engrave(cv, ids, stele_face(axis, 0.09), mark, face_light(axis))
    side = lambda a: ab(axis, a, 0.18)
    base_grass(cv, [side(-0.28), side(0.3), ab(axis, 0.37, 0.05)], salt + 5)


def draw_stele_low(cv, axis):
    salt = 121 if axis == "x" else 131
    base = Block(*abox(axis, -0.55, 0.55, -0.17, 0.17), 0.0, 0.1, salt, corner=0.03, bevel=0.03, chips=2,
                 chip_depth=(0.02, 0.05), wobble=0.0, moss=0.6, pattern=Beds([0.0, 0.1], salt + 1))

    def profile(a):
        hump = 0.15 * math.sqrt(max(0.0, 1 - (a / 0.3) ** 2))
        shoulder = 0.62 - 0.05 * max(0.0, abs(a) - 0.42) / 0.08
        return max(shoulder, 0.63 + hump)
    slab = Slab(axis, -0.5, 0.5, -0.1, 0.1, 0.1, profile, salt + 2, corner=0.03, bevel=0.035, chips=2,
                chip=(0.06, 0.12), chip_depth=(0.04, 0.08), moss=0.5, warm=True, pattern=Dressed(0.1, salt + 3))
    draw_mass(cv, [base])
    f, ids = draw_mass(cv, [slab])

    def panel(a, z):
        inside_a, inside_z = abs(a) <= 0.4, 0.26 <= z <= 0.56
        edge_a = abs(abs(a) - 0.4) * KX < 0.5 and 0.26 <= z <= 0.56
        edge_z = abs(a) <= 0.4 and (math.floor((0.56 - z) * KZ) == 0 or math.floor((0.26 - z) * KZ) == -1)
        return "groove" if (edge_a or edge_z) and (inside_a or inside_z) else None
    glyph_row = []
    for n, a_c in enumerate((-0.27, -0.09, 0.09, 0.27)):
        glyph_row.append(glyph_mark([GLYPHS[(n * 3 + (0 if axis == "x" else 2)) % len(GLYPHS)]], a_c, 0.47, axis))
    engrave(cv, ids, stele_face(axis, 0.1), combine(panel, *glyph_row, band_mark([0.68])), face_light(axis))
    side = lambda a: ab(axis, a, 0.18)
    base_grass(cv, [side(-0.45), side(0.1), side(0.5)], salt + 5, dry=0.6)


def draw_stele_leaning(cv, axis):
    salt = 141 if axis == "x" else 151

    def profile(u):
        top = 1.0 + 0.24 * math.sqrt(max(0.0, 1 - (u / 0.28) ** 2))
        if u > 0.05:  # the broken shoulder: a jagged diagonal fracture
            top -= (u - 0.05) * 1.4 + 0.035 * math.sin(u * 90)
        return top
    roll = math.radians(13)
    slab = LeaningSlab(axis, 0.04, 0.0, 0.28, 0.09, profile, roll, 0.1, salt, bevel=0.03, moss=0.5,
                       pattern=Dressed(0.0, salt + 1, weather=0.68))
    f = mass_field([slab])
    _, ids = draw_mass(cv, [slab], carve(f, lambda x, y, top, fl: (fl, top)), floating=True)
    cos, sin, sink = slab.cos, slab.sin, slab.sink

    def local(a, z):
        da, dz = a - 0.04, z + sink
        return da * cos + dz * sin, -da * sin + dz * cos
    crack = []
    rng = random.Random(salt + 3)
    u, w = 0.12, 0.98
    while w > 0.25:
        crack.append((u, w))
        u += rng.uniform(-0.035, 0.02)
        w -= 0.03
    def mark(a, z):
        u, w = local(a, z)
        if any(abs(u - cu) < 0.022 and abs(w - cw) < 0.02 for cu, cw in crack):
            return "crack"
        if abs(abs(u) - 0.21) * KX < 0.5 and 0.3 < w < 0.95 and not (u > 0 and w > 0.83):
            return "groove"
        if math.floor((0.3 - w) * KZ / cos) == 0 and abs(u) < 0.21:
            return "groove"
        col = math.floor((((-u) if axis == "x" else u)) * KX + 1.5)
        row = math.floor((0.84 - w) * KZ)
        if 0 <= col < 3 and 0 <= row < 4 and GLYPHS[2 if axis == "x" else 6][row][col] == "1":
            return "groove"
        return None
    engrave(cv, ids, stele_face(axis, 0.09), mark, face_light(axis), tol=0.08)
    # The sunken foot sits in a little heap of soil.
    soil_heap(cv, ab(axis, -0.2, 0.0), 0.2, 0.18, salt + 7, height=0.08)
    base_grass(cv, [ab(axis, 0.3, 0.12), ab(axis, -0.1, 0.17)], salt + 9, dry=0.7)


def draw_stele_fallen(cv, axis):
    """A stele lying face up, broken in two; the rounded old top points back."""
    salt = 161 if axis == "x" else 171
    head = LyingSlab(axis, -0.7, -0.02, -0.29, 0.29, 0.0, 0.12, salt, rounded="start", bevel=0.03, chips=2,
                     chip=(0.05, 0.1), chip_depth=(0.03, 0.05), moss=0.5)
    foot = LyingSlab(axis, 0.04, 0.7, -0.29, 0.29, 0.0, 0.14, salt + 1, rounded="none", bevel=0.03, chips=2,
                     chip=(0.05, 0.1), chip_depth=(0.03, 0.05), tilt=ab(axis, 0.03, -0.03), moss=0.4, warm=True)
    f, ids = draw_mass(cv, [head, foot])

    def mark(x, y):
        # The arched frame groove of the old face, 0.07u inside the outline,
        # and two cross bands near the foot; the break interrupts both.
        a, b = (x, y) if axis == "x" else (y, x)
        if -0.06 < a < 0.1:
            return None
        inner = 0.29 - 0.08
        d = 0.5 / KY
        if a < -0.7 + 0.29:  # round end
            r = math.hypot(a - (-0.7 + 0.29), b)
            return "groove" if abs(r - inner) < d else None
        if abs(abs(b) - inner) < d and a < 0.62:
            return "groove"
        if abs(b) < inner and any(abs(a - g) < d * 1.2 for g in (0.42, 0.5)):
            return "groove"
        return None
    engrave(cv, ids, ("z", 0.13), mark, "top", tol=0.1, lips=False)
    base_grass(cv, [ab(axis, 0.72, 0.15), ab(axis, 0.2, 0.32), ab(axis, -0.5, 0.31)], salt + 5, dry=0.55)
    leaves(cv, random.Random(salt + 7), [(*ab(axis, -0.2, 0.05), 0.16), (*ab(axis, 0.42, -0.12), 0.18)], flat=False)


# ------------------------------ cairns --------------------------------------

def stack(cv, stones, salt, moss=0.5):
    """Rounded river stones, each resting on whatever lies under its centre."""
    rng = random.Random(salt)
    blocks, f = [], None
    for n, (x, y, rx, ry, h) in enumerate(stones):
        base = f.xy(x, y) - h * 0.18 if f else 0.0
        base = max(0.0, base)
        blocks.append(Block(x - rx, x + rx, y - ry, y + ry, base, base + h, salt + n * 7, round_plan=True,
                            bevel=min(rx, ry, h) * 0.8, chips=rng.randint(0, 1), chip=(0.05, 0.09), chip_depth=(0.02, 0.04),
                            tilt=(rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1)), moss=moss, warm=n % 3 == 1, wobble=0.008))
        f = mass_field(blocks)
    return draw_mass(cv, blocks, f)


def draw_cairn_small(cv):
    stones = [(0.02, 0.0, 0.27, 0.22, 0.14), (0.16, 0.16, 0.1, 0.09, 0.08), (-0.01, 0.0, 0.2, 0.17, 0.12),
              (0.0, 0.02, 0.15, 0.13, 0.11), (0.0, 0.0, 0.1, 0.09, 0.09)]
    f, _ = stack(cv, stones, 201)
    base_grass(cv, [(0.28, 0.05), (0.02, 0.28)], 207, dry=0.6)


def draw_cairn_large(cv):
    rng = random.Random(213)
    ring = []
    for k in range(7):
        a = 0.35 + k * math.tau / 7 + rng.uniform(-0.15, 0.15)
        r = rng.uniform(0.17, 0.21)
        ring.append((0.31 * math.cos(a), 0.31 * math.sin(a), r, r * rng.uniform(0.78, 0.9), rng.uniform(0.15, 0.2)))
    stones = ring + [(0.0, 0.0, 0.24, 0.21, 0.2), (0.07, -0.06, 0.18, 0.15, 0.17), (-0.07, 0.07, 0.17, 0.15, 0.16),
                     (0.0, 0.0, 0.15, 0.13, 0.15), (0.03, -0.02, 0.12, 0.1, 0.14), (0.0, 0.01, 0.075, 0.065, 0.15),
                     (0.4, 0.33, 0.09, 0.08, 0.08), (-0.1, 0.44, 0.07, 0.06, 0.06)]
    f, _ = stack(cv, stones, 211, moss=0.5)
    base_grass(cv, [(0.5, 0.1), (0.12, 0.5), (0.42, -0.32)], 217)


# ------------------------------ graves --------------------------------------

def border_stones(axis, ha, hb, salt, gaps=()):
    """Small kerb stones round a grave's outline, a few missing or tipped."""
    rng = random.Random(salt)
    stones = []
    perimeter = []
    step = 0.17
    for a in [(-ha + step * (k + 0.5)) for k in range(int(2 * ha / step))]:
        perimeter += [(a, hb), (a, -hb)]
    for b in [(-hb + step * (k + 0.5)) for k in range(int(2 * hb / step))]:
        perimeter += [(ha, b), (-ha, b)]
    for n, (a, b) in enumerate(perimeter):
        if n in gaps:
            continue
        size = rng.uniform(0.065, 0.085)
        h = rng.uniform(0.07, 0.12)
        x, y = ab(axis, a + rng.uniform(-0.015, 0.015), b + rng.uniform(-0.01, 0.01))
        stones.append(Block(x - size, x + size, y - size * 0.9, y + size * 0.9, 0.0, h, salt + n * 3, round_plan=True,
                            bevel=0.04, tilt=(rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15)), moss=0.55,
                            warm=n % 4 == 0, wobble=0.0))
    return stones


def draw_grave_mound(cv, axis):
    salt = 301 if axis == "x" else 311
    mound = Mound(*abox(axis, -0.84, 0.84, -0.35, 0.35), 0.27, salt)
    draw_mass(cv, [mound])
    stones = border_stones(axis, 0.92, 0.42, salt + 3, gaps=(5, 14))
    draw_mass(cv, stones)
    rng = random.Random(salt + 5)
    spots = [(*ab(axis, rng.uniform(-0.55, 0.55), rng.uniform(-0.15, 0.15)), 0.0) for _ in range(3)]
    oid = cv.new_oid()
    f = mass_field([mound])
    for x, y, _ in spots:  # a few dry stalks standing out of the crown
        z = f.xy(x, y)
        sx, sy = cv.project(x, y, z)
        lean = rng.choice((-0.3, 0.3))
        for step in range(rng.randint(3, 5)):
            cv.put(math.floor(sx + step * lean), math.floor(sy) - step, 60.0 + step * 0.01,
                   "M_HI" if step > 2 else "M1", oid, ROD, {"flat": True})
    base_grass(cv, [ab(axis, 0.95, 0.2), ab(axis, -0.4, 0.46), ab(axis, 0.5, 0.46)], salt + 9, dry=0.6)


def draw_grave_plot(cv, axis):
    """Flat: a sunken kerb outline lying flush with the ground round an old grave."""
    salt = 321 if axis == "x" else 331
    ha, hb = 0.98, 0.48
    rng = random.Random(salt)
    colors = {}
    for px, py, x, y in ground_pixels(cv, *ab(axis, ha - 0.06, hb - 0.06)):
        # Sunken old soil, moss creeping in from the kerbs, turf showing through.
        a, b = (x, y) if axis == "x" else (y, x)
        g = vnoise(x * 3.4, y * 3.4, salt + 1) * 0.8 + ihash(px, py, salt + 2) * 0.2
        rim = min(ha - abs(a), hb - abs(b))
        if rim < 0.16 and g > 0.42:
            colors[(px, py)] = "M2" if g > 0.6 else "M3"
        elif g > 0.5:
            colors[(px, py)] = "SOIL2" if g < 0.68 else "SOIL1"
        elif g > 0.4:
            colors[(px, py)] = "SOIL3"
    put_flat(cv, colors, cv.new_oid())
    kerbs = []
    pieces = [(-ha, -0.3, hb - 0.09, hb), (-0.26, 0.38, hb - 0.09, hb), (0.42, ha, hb - 0.09, hb),
              (-ha, -0.5, -hb, -hb + 0.09), (-0.08, ha, -hb, -hb + 0.09),
              (ha - 0.09, ha, -hb + 0.09, hb - 0.09), (-ha, -ha + 0.09, -hb + 0.09, 0.1)]
    for n, (a0, a1, b0, b1) in enumerate(pieces):
        kerbs.append(Block(*abox(axis, a0, a1, b0, b1), 0.0, 0.05 + 0.02 * (n % 2), salt + 10 + n, corner=0.02, bevel=0.025,
                           chips=1, chip_depth=(0.01, 0.025), wobble=0.0, moss=0.55, warm=n % 3 == 0))
    draw_mass(cv, kerbs)
    leaves(cv, rng, [(*ab(axis, rng.uniform(-0.8, 0.8), rng.uniform(-0.35, 0.35)), 0.0) for _ in range(7)])
    grass_oid = cv.new_oid()
    for a, b in ((-0.5, 0.2), (0.3, -0.15), (0.75, 0.25)):
        px, py = cv.project(*ab(axis, a, b), 0)
        for _ in range(3):
            ox, length, lean = rng.randint(-2, 2), rng.randint(3, 5), rng.uniform(-0.4, 0.4)
            for step in range(length):
                t = step / length
                cv.put(math.floor(px + ox + lean * step), math.floor(py) - step, -8.0,
                       "M_HI" if t > 0.6 else "M1" if t > 0.25 else "M2", grass_oid, ROD, {"flat": True})


# ------------------------------ obelisk -------------------------------------

def obelisk_plinth(salt):
    beds = Beds([0.0, 0.18, 0.34], salt)
    return [Block(-0.5, 0.5, -0.5, 0.5, 0.0, 0.18, salt + 1, corner=0.03, bevel=0.035, chips=3, chip_depth=(0.03, 0.07),
                  wobble=0.0, moss=0.55, pattern=beds),
            Block(-0.4, 0.4, -0.4, 0.4, 0.18, 0.34, salt + 2, corner=0.03, bevel=0.035, chips=2, chip_depth=(0.03, 0.06),
                  moss=0.45, warm=True, pattern=beds),
            Block(-0.3, 0.3, -0.3, 0.3, 0.34, 0.86, salt + 3, corner=0.025, bevel=0.03, chips=1, chip_depth=(0.03, 0.05),
                  moss=0.3, pattern=Beds([0.34, 0.86], salt + 4))]


def obelisk_die_carving(cv, ids, axis_faces=("x", "y")):
    """A framed panel with two glyphs on each visible face of the die."""
    for axis in axis_faces:
        def panel(a, z):
            in_a, in_z = abs(a) <= 0.21, 0.44 <= z <= 0.76
            edge_a = abs(abs(a) - 0.21) * KX < 0.5 and 0.44 <= z <= 0.76
            edge_z = abs(a) <= 0.21 and (math.floor((0.76 - z) * KZ) == 0 or math.floor((0.44 - z) * KZ) == -1)
            return "groove" if (edge_a or edge_z) and (in_a or in_z) else None
        glyphs = [GLYPHS[0 if axis == "x" else 3], GLYPHS[6 if axis == "x" else 8]]
        mark = combine(panel, glyph_mark(glyphs[:1], -0.08, 0.68, axis), glyph_mark(glyphs[1:], 0.08, 0.68, axis))
        engrave(cv, ids, stele_face(axis, 0.3), mark, face_light(axis))


def draw_obelisk(cv):
    plinth = obelisk_plinth(401)
    _, plinth_ids = draw_mass(cv, plinth)
    obelisk_die_carving(cv, plinth_ids)
    floating(cv, [Block(-0.34, 0.34, -0.34, 0.34, 0.86, 0.93, 405, corner=0.02, bevel=0.03, chips=2, chip_depth=(0.02, 0.04),
                        moss=0.6, pattern=Beds([0.86, 0.93], 406))], 0.86)
    shaft = TaperShaft(0.0, 0.0, 0.21, 0.135, 0.93, 2.36, 0.26, 407, moss=0.05, pattern=Beds([0.93, 2.36], 408),
                       chips=0)
    shaft.snap = False
    _, ids = draw_mass(cv, [shaft])
    for axis in ("x", "y"):
        plane = lambda z: 0.21 - (0.21 - 0.135) * (z - 0.93) / (2.36 - 0.93)
        glyphs = [GLYPHS[(k * 2 + (0 if axis == "x" else 1)) % len(GLYPHS)] for k in range(5)]
        mark = combine(band_mark([1.12, 2.2]), glyph_mark(glyphs, 0.0, 2.06, axis))
        engrave(cv, ids, (axis, plane(1.6), plane), mark, face_light(axis), tol=0.09)
    base_grass(cv, [(0.52, -0.2), (0.2, 0.52), (0.52, 0.45)], 409, dry=0.5)


def draw_obelisk_broken(cv):
    """The plinth at the back (x < 0.05); the snapped top lies before it along y."""
    shift = -0.45
    plinth = obelisk_plinth(421)
    for block in plinth:  # move the whole plinth back along x
        x0, x1, y0, y1 = block.box
        block.box = (x0 + shift, x1 + shift, y0, y1)
        block.cx += shift
        block.chips = [(px + shift, py, r, d) for px, py, r, d in block.chips]
    _, plinth_ids = draw_mass(cv, plinth)
    # Carving on the shifted die: the +y face only (the +x face is hidden behind the fragment).
    def panel(a, z):
        a -= shift
        in_a, in_z = abs(a) <= 0.21, 0.44 <= z <= 0.76
        edge_a = abs(abs(a) - 0.21) * KX < 0.5 and 0.44 <= z <= 0.76
        edge_z = abs(a) <= 0.21 and (math.floor((0.76 - z) * KZ) == 0 or math.floor((0.44 - z) * KZ) == -1)
        return "groove" if (edge_a or edge_z) and (in_a or in_z) else None
    engrave(cv, plinth_ids, ("x", 0.3), combine(panel, glyph_mark([GLYPHS[0]], shift - 0.08, 0.68, "x"),
                                                glyph_mark([GLYPHS[6]], shift + 0.08, 0.68, "x")), "shade")
    engrave(cv, plinth_ids, ("y", 0.3 + shift), combine(panel_y(shift), glyph_mark([GLYPHS[3]], -0.08, 0.68, "y"),
                                                        glyph_mark([GLYPHS[8]], 0.08, 0.68, "y")), "lit")
    floating(cv, [Block(-0.34 + shift, 0.34 + shift, -0.34, 0.34, 0.86, 0.93, 425, corner=0.02, bevel=0.03, chips=3,
                        chip_depth=(0.02, 0.05), moss=0.65, pattern=Beds([0.86, 0.93], 426))], 0.86)
    stump = TaperShaft(shift, 0.0, 0.21, 0.135, 0.93, 1.42, 0.0, 427, broken=True, moss=0.3, pattern=Beds([0.93, 1.5], 428))
    stump.snap = False
    stump.box = (shift - 0.21, shift + 0.21, -0.21, 0.21)
    f, ids = draw_mass(cv, [stump])
    plane = lambda z: 0.21 - (0.21 - 0.135) * (z - 0.93) / (2.36 - 0.93)
    engrave(cv, ids, ("x", plane(1.1), plane), combine(band_mark([1.12]), glyph_mark([GLYPHS[0], GLYPHS[2]], shift, 1.36, "x")),
            "shade", tol=0.09)
    engrave(cv, ids, ("y", shift + plane(1.1), lambda z: shift + plane(z)),
            combine(band_mark([1.12]), glyph_mark([GLYPHS[1], GLYPHS[3]], 0.0, 1.36, "y")), "lit", tol=0.09)
    # The fallen top: a tapering shaft piece with its pyramid, lying along y in front.
    piece = FallenShaft(0.58, -0.5, 0.5, 0.18, 0.14, 429)
    pf = mass_field([piece])
    _, piece_ids = draw_mass(cv, [piece], carve(pf, lambda x, y, top, fl: (fl, top)), floating=True)
    bands = lambda a, z: "groove" if any(abs(a - g) < 0.5 / KX for g in (-0.36, 0.12)) else None
    engrave(cv, piece_ids, ("y", 0.58 + 0.16), bands, "lit", tol=0.09)
    engrave(cv, piece_ids, ("z", 0.33), lambda x, y: "groove" if any(abs(y - g) < 0.5 / KY for g in (-0.36, 0.12)) else None,
            "top", tol=0.12, lips=False)
    base_grass(cv, [(0.82, 0.3), (0.1, 0.52), (0.82, -0.4)], 431, dry=0.55)
    leaves(cv, random.Random(433), [(0.3, 0.3, 0.0), (0.25, -0.3, 0.0), (-0.1, 0.45, 0.0)])


def panel_y(shift):
    def panel(a, z):
        in_a, in_z = abs(a) <= 0.21, 0.44 <= z <= 0.76
        edge_a = abs(abs(a) - 0.21) * KX < 0.5 and 0.44 <= z <= 0.76
        edge_z = abs(a) <= 0.21 and (math.floor((0.76 - z) * KZ) == 0 or math.floor((0.44 - z) * KZ) == -1)
        return "groove" if (edge_a or edge_z) and (in_a or in_z) else None
    return panel


class FallenShaft(Block):
    """The snapped obelisk top lying on its side along y: a tapering square
    section from its broken end (y0, half h0) to the pyramid tip (y1)."""

    def __init__(self, cx, y0, y1, h0, h1, salt):
        self.h0, self.h1, self.y0_, self.y1_ = h0, h1, y0, y1
        self.cap = 0.24
        super().__init__(cx - h0, cx + h0, y0, y1, 0.0, 2 * h0, salt, moss=0.35, chips=0, bevel=0.03,
                         pattern=Dressed(0.0, salt + 1, weather=0.7))
        self.snap = False

    def half(self, y):
        t = (y - self.y0_) / (self.y1_ - self.cap - self.y0_)
        if t <= 1:
            return self.h0 + (self.h1 - self.h0) * t
        return self.h1 * max(0.0, 1 - (y - (self.y1_ - self.cap)) / self.cap)

    def height(self, x, y):
        if not self.y0_ <= y <= self.y1_:
            return None
        h = self.half(y)
        if abs(x - self.cx) >= h or h <= 0.01:
            return None
        # The square section rests on one face, sunk a little: its top lies at
        # 2h; the pyramidion's faces slope down to the tip; the arrises are eased.
        top = (self.h1 + h if y > self.y1_ - self.cap else 2 * h) - 0.03
        e = h - abs(x - self.cx)
        if e < 0.03:
            top -= 0.03 - e
        jag = 0.05 * (vnoise(x * 20, y * 20, self.salt) - 0.5) if y - self.y0_ < 0.04 else 0.0
        return max(self.underside(x, y) + 0.02, top + jag)

    def underside(self, x, y):
        """The pyramidion's lower faces lift off the ground towards the tip."""
        if y <= self.y1_ - self.cap:
            return 0.0
        return max(0.0, self.h1 - self.half(y) - 0.03)


# ------------------------------ lanterns ------------------------------------

def lantern_parts(salt):
    """Stone lantern (1.3u): base, round step, shaft, platform, firebox, roof, knob."""
    grounded = [Block(-0.3, 0.3, -0.3, 0.3, 0.0, 0.12, salt, corner=0.03, bevel=0.03, chips=2, chip_depth=(0.02, 0.05),
                      wobble=0.0, moss=0.6, pattern=Beds([0.0, 0.12], salt + 1)),
                Block(-0.22, 0.22, -0.22, 0.22, 0.12, 0.2, salt + 2, round_plan=True, bevel=0.04, moss=0.5,
                      pattern=Beds([0.12, 0.2], salt + 3)),
                Block(-0.1, 0.1, -0.1, 0.1, 0.2, 0.64, salt + 4, round_plan=True, bevel=0.02, moss=0.25,
                      pattern=Beds([0.2, 0.64], salt + 5, grooves=(0.42,)))]
    return grounded


class Roof(Block):
    """A square pyramid roof with a thin eave."""

    def height(self, x, y):
        d = max(abs(x - self.cx), abs(y - self.cy))
        if d >= self.hx:
            return None
        eave = self.z0 + 0.06
        if d > self.hx - 0.04:
            return eave - 0.02 * (d - (self.hx - 0.04)) / 0.04
        return eave + (self.z1 - eave) * (1 - (d / (self.hx - 0.04)) ** 0.85) + 0.01 * (vnoise(x * 12, y * 12, self.salt) - 0.5)


def window_glow(a, z, z0, z1, half):
    """The firebox opening: a turquoise light, brightest at the low centre."""
    if abs(a) > half or not z0 <= z <= z1:
        return None
    head = z1 - (half - math.sqrt(max(0.0, half * half - a * a))) * 0.9
    if z > head:
        return None
    r = math.hypot(a / half, (z - z0) / (z1 - z0) * 1.3)
    if abs(abs(a) - half) * KX < 0.75 or z > head - 0.6 / KZ:
        return "C4"
    return "C0" if r < 0.35 else "C1" if r < 0.7 else "C2" if r < 1.05 else "C3"


def draw_stone_lantern(cv):
    salt = 501
    draw_mass(cv, lantern_parts(salt))
    floating(cv, [Block(-0.24, 0.24, -0.24, 0.24, 0.64, 0.71, salt + 6, corner=0.02, bevel=0.025, chips=1,
                        chip_depth=(0.02, 0.03), moss=0.5, pattern=Beds([0.64, 0.71], salt + 7))], 0.64)
    _, box_ids = floating(cv, [Block(-0.17, 0.17, -0.17, 0.17, 0.71, 0.98, salt + 8, corner=0.015, bevel=0.02, moss=0.2,
                                     pattern=Beds([0.71, 0.98], salt + 9))], 0.71)
    for axis in ("x", "y"):
        engrave(cv, box_ids, stele_face(axis, 0.17), lambda a, z: window_glow(a, z, 0.76, 0.93, 0.09), face_light(axis),
                lips=False)
    floating(cv, [Roof(-0.32, 0.32, -0.32, 0.32, 0.98, 1.21, salt + 10, moss=0.55)], 0.98)
    floating(cv, [Block(-0.06, 0.06, -0.06, 0.06, 1.19, 1.3, salt + 11, round_plan=True, bevel=0.05, moss=0.3)], 1.19)
    # The glow spills onto the platform lip under each window.
    for i, c in enumerate(cv.color):
        if c in ("Q_T1", "Q_W1", "Q_T2", "Q_HI", "M1", "M2", "M_HI") and cv.face[i] == TOP:
            x, y = i % CELL, i // CELL
            for ax in ("x", "y"):
                wx, wy = ab(ax, 0.0, 0.2)
                sx, sy = cv.project(wx, wy, 0.71)
                if abs(x + 0.5 - sx) < 3.2 and abs(y + 0.5 - sy) < 1.8:
                    cv.color[i] = "C4" if abs(x + 0.5 - sx) < 2.2 else c
    base_grass(cv, [(0.31, -0.15), (-0.1, 0.31), (0.31, 0.25)], salt + 13, dry=0.5)


def draw_stone_lantern_toppled(cv):
    """The base still stands at the back with a snapped stump; the shaft, the
    dark firebox and the roof lie in the grass before it (no glow left)."""
    salt = 521
    bx, by = -0.44, -0.16
    base = [Block(bx - 0.27, bx + 0.27, by - 0.27, by + 0.27, 0.0, 0.12, salt, corner=0.03, bevel=0.03, chips=3,
                  chip_depth=(0.02, 0.05), wobble=0.0, moss=0.65, pattern=Beds([0.0, 0.12], salt + 1)),
            Block(bx - 0.2, bx + 0.2, by - 0.2, by + 0.2, 0.12, 0.2, salt + 2, round_plan=True, bevel=0.04, moss=0.55,
                  pattern=Beds([0.12, 0.2], salt + 3)),
            Block(bx - 0.1, bx + 0.1, by - 0.1, by + 0.1, 0.2, 0.4, salt + 4, round_plan=True, bevel=0.02, moss=0.2,
                  tilt=(0.45, -0.35), rough=0.06)]
    draw_mass(cv, base)
    shaft = LyingDrum("x", -0.12, 0.3, -0.26, 0.1, salt + 5, sink=0.12, moss=0.5, chips=1, chip=(0.05, 0.08),
                      chip_depth=(0.02, 0.04))
    sf = mass_field([shaft])
    draw_mass(cv, [shaft], carve(sf, lambda x, y, top, fl: (fl, top)), floating=True)
    box = Block(0.38, 0.68, -0.38, -0.08, 0.0, 0.3, salt + 6, corner=0.015, bevel=0.02, tilt=(0.08, -0.06), chips=2,
                chip=(0.05, 0.08), chip_depth=(0.03, 0.06), moss=0.4, pattern=Beds([0.0, 0.3], salt + 7))
    _, box_ids = draw_mass(cv, [box])
    # The firebox lies on its back: one window now looks up at the sky, dark.
    engrave(cv, box_ids, ("z", 0.31), lambda x, y: ("deep" if abs(x - 0.53) < 0.07 and abs(y + 0.23) < 0.08 else None),
            "top", tol=0.12, lips=False)
    engrave(cv, box_ids, ("x", -0.08), lambda a, z: ("deep" if abs(a - 0.53) < 0.06 and 0.08 < z < 0.22 else None),
            "shade", lips=False)
    roof = Roof(-0.14, 0.4, -0.06, 0.46, 0.0, 0.3, salt + 8, moss=0.6)
    draw_mass(cv, [roof])
    knob = Block(0.52, 0.66, 0.24, 0.38, 0.0, 0.12, salt + 9, round_plan=True, bevel=0.06, moss=0.3)
    draw_mass(cv, [knob])
    base_grass(cv, [(0.76, -0.1), (-0.1, 0.47), (0.55, 0.45)], salt + 11)
    leaves(cv, random.Random(salt + 13), [(0.05, -0.42, 0.0), (-0.6, 0.28, 0.0), (0.7, 0.1, 0.0)])


# ------------------------------ fences --------------------------------------

POSTS = (-1.41, -0.47, 0.47, 1.41)
RAILS = ((0.19, 0.29), (0.45, 0.55))


def fence_post(axis, a, salt, height=0.62, cap=0.1, broken=False):
    x, y = ab(axis, a, 0.0)
    if broken:
        return TaperShaft(x, y, 0.09, 0.09, 0.0, height, 0.0, salt, broken=True, moss=0.6, pattern=Beds([0.0, 1.0], salt + 1))
    post = TaperShaft(x, y, 0.09, 0.09, 0.0, height, cap, salt, moss=0.45, pattern=Beds([0.0, height], salt + 1))
    return post


def draw_rails(cv, axis, spans, salt):
    for n, ((z0, z1), (a0, a1)) in enumerate(spans):
        rail = Block(*abox(axis, a0, a1, -0.045, 0.045), z0, z1, salt + n, corner=0.01, bevel=0.015, wobble=0.0,
                     moss=0.3, rough=0.008, pattern=Dressed(z0, salt + n + 20, weather=0.8))
        floating(cv, [rail], z0)


def draw_fence(cv, axis):
    salt = 601 if axis == "x" else 611
    draw_rails(cv, axis, [(r, (-1.41, 1.41)) for r in RAILS], salt + 40)
    for n, a in enumerate(POSTS):
        draw_mass(cv, [fence_post(axis, a, salt + n * 5)])
    side = lambda a: ab(axis, a, 0.11)
    base_grass(cv, [side(-1.3), side(-0.1), side(0.9)], salt + 31, dry=0.55)


def fence_broken_runs():
    """Standing chunks along the fence as (a0, a1): the colliders of the frame."""
    return [(-1.5, -0.38), (1.32, 1.5)]


def draw_fence_broken(cv, axis):
    """One bay stands; the middle post lies on the ground, the far post leans a stub of rail."""
    salt = 621 if axis == "x" else 631
    draw_rails(cv, axis, [(RAILS[0], (-1.41, -0.47)), (RAILS[1], (-1.41, -0.2)), (RAILS[0], (1.1, 1.41))], salt + 40)
    for n, a in enumerate((-1.41, -0.47, 1.41)):
        draw_mass(cv, [fence_post(axis, a, salt + n * 5)])
    stump = fence_post(axis, 0.47, salt + 17, height=0.07, broken=True)
    draw_mass(cv, [stump])
    # The fallen post and a broken rail lie in the gap, flat in the grass.
    fallen = Block(*abox(axis, 0.12, 0.74, 0.12, 0.28), 0.0, 0.11, salt + 21, corner=0.02, bevel=0.03, chips=2,
                   chip_depth=(0.02, 0.04), moss=0.6, wobble=0.0, tilt=ab(axis, 0.0, 0.02))
    rail = Block(*abox(axis, -0.32, 0.12, -0.2, -0.13), 0.0, 0.06, salt + 23, corner=0.01, bevel=0.02, moss=0.5,
                 wobble=0.0)
    draw_mass(cv, [fallen, rail])
    side = lambda a: ab(axis, a, 0.11)
    base_grass(cv, [side(-1.0), side(0.0), side(1.1), ab(axis, 0.8, 0.3)], salt + 31, dry=0.6)
    leaves(cv, random.Random(salt + 33), [(*ab(axis, 0.3, 0.0), 0.0), (*ab(axis, -0.1, 0.2), 0.0)])


# ------------------------------ gate ----------------------------------------

GATE_POST, GATE_HALF, GATE_PLINTH = 1.55, 0.21, 0.3


def bell(cv, base, depth):
    """A small hand-pixelled bronze bell with verdigris, hanging from (sx, sy)."""
    sx, sy = math.floor(base[0]), math.floor(base[1])
    oid = cv.new_oid()
    style = {"seam": "T3", "seamGap": 0.05}
    for dy in range(3):  # the iron hanger
        cv.put(sx, sy + dy, depth, "T3" if dy else "T2", oid, ROD, style)
    rows = ["  ab  ", " abcc ", " abbcd", "abbbcd", "abbbcd", "aabbcdd", " eeeee"]
    colors = {"a": "Y3", "b": "Y1", "c": "Y2", "d": "T1", "e": "T2"}
    for r, row in enumerate(rows):
        for k, ch in enumerate(row):
            if ch == " ":
                continue
            color = colors[ch]
            if ch in "bc" and ihash(k, r, 777) < 0.22:
                color = "B1"
            cv.put(sx - 3 + k, sy + 3 + r, depth, color, oid, ROUND, style)
    cv.put(sx, sy + 3 + len(rows), depth, "T3", oid, ROUND, style)  # the clapper


def draw_gate(cv, axis):
    salt = 701 if axis == "x" else 711
    posts = []
    for n, side in enumerate((-1, 1)):
        a = side * GATE_POST
        x, y = ab(axis, a, 0.0)
        posts.append(Block(x - GATE_PLINTH, x + GATE_PLINTH, y - GATE_PLINTH, y + GATE_PLINTH, 0.0, 0.18, salt + n * 20,
                           corner=0.03, bevel=0.035, chips=2, chip_depth=(0.03, 0.06), wobble=0.0, moss=0.6,
                           pattern=Beds([0.0, 0.18], salt + n * 20 + 1)))
        beds = Beds([0.18, 0.86, 1.5, 2.12], salt + n * 20 + 2)
        for k, (z0, z1) in enumerate(((0.18, 0.86), (0.86, 1.5), (1.5, 2.12))):
            posts.append(Block(x - GATE_HALF, x + GATE_HALF, y - GATE_HALF, y + GATE_HALF, z0, z1, salt + n * 20 + 3 + k,
                               corner=0.02, bevel=0.03, chips=1 if k == 2 else 0, chip_depth=(0.03, 0.06), moss=0.3,
                               warm=(k + n) % 2 == 0, pattern=beds))
    _, post_ids = draw_mass(cv, posts)
    for axis_face in ("x", "y"):
        for side in (-1, 1):
            a = side * GATE_POST
            if axis_face == axis:
                plane = ("x", GATE_HALF) if axis == "x" else ("y", GATE_HALF)
                centre = a
            else:
                plane = ("y", a + GATE_HALF) if axis == "x" else ("x", a + GATE_HALF)
                centre = 0.0
            glyphs = [GLYPHS[(side + 1 + k * 2 + (0 if axis_face == "x" else 1)) % len(GLYPHS)] for k in range(3)]
            mark = combine(band_mark([1.96]), glyph_mark(glyphs, centre, 1.38, axis_face))
            engrave(cv, post_ids, plane, mark, face_light(axis_face))
    for side in (-1, 1):
        x, y = ab(axis, side * GATE_POST, 0.0)
        floating(cv, [Block(x - 0.27, x + 0.27, y - 0.27, y + 0.27, 2.12, 2.24, salt + 60 + side, corner=0.02, bevel=0.03,
                            chips=1, chip_depth=(0.02, 0.04), moss=0.45, pattern=Beds([2.12, 2.24], salt + 62))], 2.12)
    lintel = Block(*abox(axis, -2.02, 2.02, -0.19, 0.19), 2.24, 2.52, salt + 64, corner=0.03, bevel=0.04, chips=3,
                   chip=(0.08, 0.14), chip_depth=(0.04, 0.09), moss=0.6, warm=True,
                   pattern=Beds([2.24, 2.52], salt + 65, grooves=(2.3,)))
    _, lintel_ids = floating(cv, [lintel], 2.24)
    face = stele_face(axis, 0.19)
    glyph_marks = [glyph_mark([GLYPHS[k % len(GLYPHS)]], a_c, 2.47, axis, gap=1) for k, a_c in
                   enumerate((-0.5, -0.25, 0.0, 0.25, 0.5))]
    engrave(cv, lintel_ids, face, combine(*glyph_marks), face_light(axis))
    hang = cv.project(*ab(axis, 0.0, 0.0), 2.24)
    bell(cv, (hang[0], hang[1] + 1), VIEW[2] * 2.0 + 0.4)
    for side in (-1, 1):
        # Grass grows on the outer sides of the posts; the passage stays clear ground.
        a = side * GATE_POST
        base_grass(cv, [ab(axis, a + side * 0.2, 0.33), ab(axis, a + side * 0.33, -0.1)], salt + 70 + side)


# ------------------------------ urns and offerings ---------------------------

def stone_round(salt, moss=0.4):
    """Shade for turned stone (urns): light from the upper left, moss on top."""
    def shade(n, p):
        b = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]
        m = moss_at(p[0], p[1] + p[2], salt, moss)
        if n[2] > 0.45 and m > 0.16:
            return "M1" if b > 0.75 else "M2"
        # Five broad bands, no smooth ramp: highlight, lit, half, shade, bounce.
        if b > 0.9:
            return "Q_HI"
        if b > 0.55:
            return "Q_T1"
        if b > 0.18:
            return "Q_L1"
        if b > -0.2:
            return "Q_M"
        return "Q_AMB" if n[2] < -0.1 else "Q_S1"
    return shade


def dark_disc(*_):
    return "DEEP"


def urn(cv, x, y, z0, s, salt, lid=False):
    """A turned stone urn: foot, stem, round belly, neck, flared lip, and a
    dark mouth or a domed lid."""
    style = {"seam": "DEEP2", "seamGap": 0.03}
    shade = stone_round(salt)
    oid = cv.new_oid()
    for (cz, rr, rz, floor) in ((0.03, 0.1, 0.035, 0.0), (0.085, 0.062, 0.05, 0.0), (0.25, 0.16, 0.15, 0.1),
                                (0.39, 0.075, 0.05, 0.0), (0.445, 0.112, 0.028, 0.0)):
        cv.ellipsoid((x, y, z0 + cz * s), (rr * s, rr * s, rz * s), shade, style, oid=oid, floor=z0 + floor * s)
    if lid:
        cv.ellipsoid((x, y, z0 + 0.48 * s), (0.085 * s, 0.085 * s, 0.05 * s), shade, style, oid=oid)
        cv.ellipsoid((x, y, z0 + 0.535 * s), (0.028 * s, 0.028 * s, 0.03 * s), shade, style, oid=oid)
        return
    cx, cy = cv.project(x, y, z0 + 0.47 * s)
    hw, hh = 32 * 0.072 * s, 16 * 0.072 * s
    mouth = cv.new_oid()
    for dy in range(-2, 3):
        for dx in range(-4, 5):
            px, py = math.floor(cx) + dx, math.floor(cy) + dy
            u, v = (px + 0.5 - cx) / hw, (py + 0.5 - cy) / hh
            if u * u + v * v <= 1:
                cv.put(px, py, 60.0, "DEEP" if v > -0.35 else "DEEP2", mouth, ROUND, {"flat": True})


def draw_urn_pair(cv):
    salt = 801
    slab = Block(-0.3, 0.3, -0.46, 0.46, 0.0, 0.07, salt, corner=0.03, bevel=0.025, chips=2, chip_depth=(0.02, 0.04),
                 wobble=0.0, moss=0.6, pattern=Beds([0.0, 0.07], salt + 1))
    draw_mass(cv, [slab])
    urn(cv, 0.08, -0.22, 0.07, 1.25, salt + 3)
    urn(cv, -0.06, 0.24, 0.07, 0.92, salt + 7, lid=True)
    base_grass(cv, [(0.31, 0.1), (0.1, 0.47), (0.31, -0.3)], salt + 9)


def draw_urn_broken(cv):
    """An urn on its side, mouth to +y, a hole broken into its flank, shards and spilled soil."""
    salt = 821
    style = {"seam": "DEEP2", "seamGap": 0.03}
    shade = stone_round(salt, moss=0.5)
    colors = {}
    for px, py, x, y in ground_pixels(cv, 0.3, 0.3):
        if (x / 0.17) ** 2 + ((y - 0.21) / 0.1) ** 2 < 1 - 0.45 * vnoise(x * 9, y * 9, salt):
            colors[(px, py)] = "SOIL2" if ihash(px, py, salt + 1) < 0.6 else "SOIL3"
    put_flat(cv, colors, cv.new_oid())
    oid = cv.new_oid()
    cv.ellipsoid((-0.03, -0.08, 0.135), (0.15, 0.17, 0.14), shade, style, oid=oid)
    cv.ellipsoid((-0.03, 0.1, 0.12), (0.075, 0.06, 0.075), shade, style, oid=oid)
    cv.ellipsoid((-0.03, 0.15, 0.12), (0.105, 0.025, 0.105), shade, style, oid=oid)
    cv.ellipsoid((-0.03, 0.162, 0.12), (0.068, 0.02, 0.068), dark_disc, style)
    cv.ellipsoid((-0.06, -0.2, 0.06), (0.09, 0.05, 0.07), shade, style, oid=oid)  # the foot end
    # A broken-out hole in the upper flank: dark inside, its lower rim lit.
    hole = cv.new_oid()
    hx, hy = cv.project(0.04, -0.12, 0.27)
    for dx, dy, color in ((-1, 0, "DEEP"), (0, 0, "DEEP"), (1, 0, "DEEP"), (2, 0, "DEEP2"), (-1, 1, "DEEP"), (0, 1, "DEEP"),
                          (1, 1, "DEEP"), (0, -1, "DEEP2"), (-1, 2, "Q_HI"), (0, 2, "Q_T1"), (1, 2, "Q_T1")):
        cv.put(math.floor(hx) + dx, math.floor(hy) + dy, 60.0, color, hole, ROUND, {"flat": True})
    shards = [Block(0.18, 0.27, 0.1, 0.18, 0.0, 0.035, salt + 3, corner=0.02, bevel=0.02, tilt=(0.1, -0.05), moss=0.1),
              Block(-0.27, -0.2, 0.17, 0.25, 0.0, 0.03, salt + 4, corner=0.02, bevel=0.02, tilt=(-0.05, 0.1), moss=0.1),
              Block(0.13, 0.2, -0.28, -0.21, 0.0, 0.035, salt + 5, corner=0.02, bevel=0.02, moss=0.1)]
    draw_mass(cv, shards)
    base_grass(cv, [(0.3, 0.05), (-0.2, 0.3)], salt + 9)


def draw_offering_stone(cv):
    salt = 841
    parts = [Block(-0.45, 0.45, -0.3, 0.3, 0.0, 0.06, salt, corner=0.03, bevel=0.025, chips=2, chip_depth=(0.02, 0.04),
                   wobble=0.0, moss=0.6, pattern=Beds([0.0, 0.06], salt + 1)),
             Block(-0.37, 0.37, -0.23, 0.23, 0.06, 0.27, salt + 2, corner=0.03, bevel=0.03, chips=1, chip_depth=(0.02, 0.05),
                   moss=0.35, warm=True, pattern=Beds([0.06, 0.27], salt + 3))]
    _, body_ids = draw_mass(cv, parts)
    for axis in ("x", "y"):
        engrave(cv, body_ids, stele_face(axis, 0.23 if axis == "x" else 0.37),
                combine(band_mark([0.2]), *[glyph_mark([GLYPHS[(k * 2 + (axis == "y")) % len(GLYPHS)]], a, 0.17, axis)
                                            for k, a in enumerate((-0.2, 0.0, 0.2) if axis == "x" else (-0.1, 0.1))]),
                face_light(axis))
    top = Block(-0.42, 0.42, -0.28, 0.28, 0.27, 0.36, salt + 4, corner=0.03, bevel=0.035, chips=3, chip=(0.06, 0.12),
                chip_depth=(0.02, 0.05), moss=0.55, pattern=Beds([0.27, 0.36], salt + 5))
    f, _ = floating(cv, [top], 0.27)
    for n, (bx, by) in enumerate(((-0.18, -0.06), (0.17, 0.05))):
        bowl = Bowl(bx, by, 0.11, 0.35, 0.43, salt + 10 + n)
        bf = mass_field([bowl])
        draw_mass(cv, [bowl], carve(bf, lambda x, y, t, fl: (fl, t)), floating=True)
    for i, c in enumerate(cv.color):
        if c == "DISH":
            x, y = i % CELL, i // CELL
            cv.color[i] = "Y3" if ihash(x, y, salt + 20) < 0.12 else "DEEP" if ihash(x, y, salt + 21) < 0.6 else "DEEP2"
    leaves(cv, random.Random(salt + 23), [(0.02, 0.2, 0.36), (-0.3, 0.15, 0.36), (0.3, -0.18, 0.36)], flat=False)
    base_grass(cv, [(0.46, -0.1), (0.1, 0.31), (0.46, 0.25)], salt + 25, dry=0.55)


class Bowl(Block):
    """A small bronze offering bowl: rounded underside, rolled rim, a dark hollow."""

    material = "bronze"

    def __init__(self, cx, cy, radius, bottom, rim, salt):
        super().__init__(cx - radius, cx + radius, cy - radius, cy + radius, bottom, rim, salt, round_plan=True,
                         bevel=0.02, moss=0.0)
        self.radius = radius
        self.pattern = BowlHollow(cx, cy, radius)

    def height(self, x, y):
        q = math.hypot(x - self.cx, y - self.cy) / self.radius
        if q >= 1:
            return None
        if q < 0.72:
            return self.z1 - 0.03
        return self.z1 - 0.012 * max(0.0, (q - 0.9) / 0.1)

    def underside(self, x, y):
        q = math.hypot(x - self.cx, y - self.cy) / self.radius
        return self.z0 + (self.z1 - 0.03 - self.z0) * q * q


class BowlHollow:
    def __init__(self, cx, cy, radius):
        self.cx, self.cy, self.radius = cx, cy, radius

    def top(self, x, y, zt):
        return "DISH" if math.hypot(x - self.cx, y - self.cy) < self.radius * 0.7 else None

    def face(self, along, z, along_is_x, point, b):
        return ("hi", 0) if z > 0.415 else ("body", 0)


# ------------------------------ yews ----------------------------------------
#
# A new species for the grove: a dark round evergreen with a short, fluted,
# red-brown trunk. The crown is the camp bush recipe (an ellipsoid body under
# rings of foliage tufts) lifted onto a trunk and kept a step darker than the
# camp shrubs; tufts are small, so the needles read finer than a bush.

YEW = ("B1", "B2", "B3", "F4", "F5", "F5")


def foliage_surface(centre, radius, z, theta, slope):
    """Point and normal on a vertical solid of revolution, theta 0 = towards the camera."""
    vx, vy = 1 / SQ2, 1 / SQ2
    rx, ry = RIGHT[0], RIGHT[1]
    dx = math.cos(theta) * vx + math.sin(theta) * rx
    dy = math.cos(theta) * vy + math.sin(theta) * ry
    point = (centre[0] + dx * radius, centre[1] + dy * radius, z)
    normal = _normalize((dx, dy, slope))
    return point, normal


def tuft(cv, sx, sy, width, height, tone, ramp, depth, oid):
    """One hand-pixel foliage tuft: lit upper-left rim, darker right/lower rim."""
    top = sy - height / 2
    for row in range(math.floor(top), math.ceil(sy + height / 2)):
        t = (row + 0.5 - top) / height
        if not 0 <= t <= 1:
            continue
        half = width / 2 * math.sin(math.pi * min(1.0, 0.18 + t * 0.82)) ** 0.45
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


def draw_crown(cv, lobes, salt, ramp=YEW, lumps=9):
    """A lumpy crown: each lobe (x, y, bottom z, radius, height) carries random
    lumps, and every lump is covered in tufts lit on its own upper left, so the
    dome breaks into clusters instead of rings."""
    rng = random.Random(salt)
    oid = cv.new_oid()

    def body(n, p):
        b = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]
        return ramp[3] if b > 0.3 else ramp[4] if b > -0.25 else ramp[5]
    spheres = []
    for lx, ly, lz, lr, lh in lobes:
        cz, rz = lz + lh * 0.5, lh * 0.5
        spheres.append((lx, ly, cz, lr * 0.9, rz * 0.9))
        for _ in range(lumps):
            theta = rng.uniform(-math.pi, math.pi)
            phi = rng.uniform(-0.5, 1.25)
            dx, dy = math.cos(theta) / SQ2 - math.sin(theta) / SQ2, math.cos(theta) / SQ2 + math.sin(theta) / SQ2
            ring = math.cos(phi)
            rr = lr * rng.uniform(0.26, 0.4)
            spheres.append((lx + dx * ring * lr * 0.78, ly + dy * ring * lr * 0.78, cz + math.sin(phi) * rz * 0.8,
                            rr, rr * 0.85))
    tufts = []
    for cx, cy, cz, rr, rz in spheres:
        cv.ellipsoid((cx, cy, cz), (rr, rr, rz), body, None, oid=oid)
        count = 3 + int(rr * rr * 120)
        for _ in range(count):
            theta = rng.uniform(-1.9, 1.9)
            phi = math.asin(rng.uniform(-0.75, 1.0))
            point, normal = foliage_surface((cx, cy), rr * math.cos(phi) + 0.02, cz + rz * math.sin(phi), theta,
                                            math.tan(phi) + 0.25)
            sx, sy = cv.project(*point)
            depth = sum(VIEW[i] * point[i] for i in range(3)) + 0.4
            size = rng.uniform(5.0, 8.5)
            b = normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]
            side = 1 if b > 0.72 else 2 if b > 0.38 else 3 if b > 0.0 else 4
            if phi < -0.3:
                side = max(side, 3)
            if rng.random() < 0.12:
                side = max(1, min(4, side + rng.choice((-1, 1))))
            tufts.append((depth, sx, sy, size, size * 0.8, side))
    for depth, sx, sy, w, h, tone in sorted(tufts):
        tuft(cv, sx, sy, w, h, tone, ramp, depth, oid)


def bark(salt):
    def shade(n, p):
        b = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]
        flute = vnoise(math.atan2(n[1], n[0]) * 2.2 + 7, p[2] * 1.5, salt)
        tone = 3 if b > 0.6 else 2 if b > 0.25 else 1 if b > -0.1 else 0
        if flute > 0.68:
            tone -= 1
        if p[2] < 0.25 and flute < 0.28 and b > 0:
            return "M2"
        return ("T3", "T2", "T1", "Q_T3")[max(0, tone)]
    return shade


def draw_trunk(cv, stems, salt):
    shade = bark(salt)
    style = {"seam": "T3", "seamGap": 0.12}
    for pts, r0, r1 in stems:
        oid = cv.new_oid()
        total = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
        walked = 0.0
        for a, b in zip(pts, pts[1:]):
            seg = math.dist(a, b)
            t = 0.0
            while t < seg:
                r = r0 + (r1 - r0) * (walked + t) / total
                p = tuple(a[k] + (b[k] - a[k]) * t / seg for k in range(3))
                cv.ellipsoid(p, (r, r, r), shade, style, oid=oid)
                t += max(0.02, r * 0.35)
            walked += seg


def roots(cv, rng, radius, count, salt):
    shade = bark(salt)
    oid = cv.new_oid()
    for k in range(count):
        a = k * math.tau / count + rng.uniform(-0.3, 0.3)
        reach = radius * rng.uniform(1.3, 1.9)
        for s in range(9):
            f = s / 8
            p = (math.cos(a) * reach * f, math.sin(a) * reach * f, 0.06 * (1 - f))
            r = radius * 0.5 * (1 - f) + 0.03
            cv.ellipsoid(p, (r, r, r * 0.7), shade, {"seam": "T3", "seamGap": 0.12}, oid=oid, floor=0.0)


def needle_litter(cv, radius, salt, centre=(0.0, 0.0)):
    """Flat dark needle litter in the crown's shadow."""
    oid = cv.new_oid()
    px, py = cv.project(centre[0], centre[1], 0)
    for row in range(math.floor(py - 16 * radius) - 1, math.ceil(py + 16 * radius) + 1):
        for col in range(math.floor(px - 32 * radius) - 1, math.ceil(px + 32 * radius) + 1):
            dx, dy = (col + 0.5 - px) / (32 * radius), (row + 0.5 - py) / (16 * radius)
            edge = 1.0 + (ihash(col // 2, row, salt) - 0.5) * 0.35
            d = dx * dx + dy * dy
            if d <= edge:
                # Dead needles: dark red-brown under the trunk, olive litter outwards.
                h = ihash(col, row, salt + 1)
                tone = "T2" if d < 0.3 else "Y2" if h < 0.05 else "T1" if h < 0.18 else "SOIL3" if d < 0.7 else "M3"
                cv.put(col, row, -9.0, tone, oid, TOP, {"flat": True})


def draw_yew_round(cv):
    """A broad old yew: a short, fluted trunk that forks low, under a dense,
    dark, lumpy dome that starts at hip height."""
    rng = random.Random(901)
    needle_litter(cv, 0.7, 902)
    roots(cv, rng, 0.18, 6, 903)
    stems = [([(0.0, 0.0, 0.0), (0.02, -0.02, 0.4), (0.0, 0.03, 0.95)], 0.17, 0.11),
             ([(0.02, 0.0, 0.32), (0.2, -0.14, 0.66), (0.3, -0.22, 1.0)], 0.085, 0.06),
             ([(0.0, 0.02, 0.36), (-0.16, 0.18, 0.7), (-0.25, 0.27, 1.02)], 0.08, 0.055)]
    draw_trunk(cv, stems, 904)
    draw_crown(cv, [(0.0, 0.0, 0.8, 0.98, 1.95), (0.05, -0.05, 1.7, 0.66, 1.3), (-0.2, 0.24, 0.86, 0.6, 1.15),
                    (0.26, -0.28, 0.92, 0.58, 1.1), (0.3, 0.32, 0.95, 0.42, 0.75)], 905)
    base_grass(cv, [(0.34, 0.14), (0.12, 0.34)], 907)


def draw_yew_small(cv):
    rng = random.Random(921)
    needle_litter(cv, 0.45, 922)
    roots(cv, rng, 0.11, 4, 923)
    draw_trunk(cv, [([(0.0, 0.0, 0.0), (0.0, 0.01, 0.3), (0.01, 0.0, 0.62)], 0.1, 0.07)], 924)
    draw_crown(cv, [(0.0, 0.0, 0.5, 0.58, 1.05), (0.02, -0.02, 1.05, 0.4, 0.8), (0.18, 0.16, 0.56, 0.32, 0.6)], 925)
    base_grass(cv, [(0.24, 0.08), (0.06, 0.24)], 927)


# ------------------------------ flat decals ---------------------------------

def draw_grave_ash(cv):
    """Scorched ground where the ritual touched a grave: charred rim, pale ash,
    faint magenta cracks (the only magenta in the package)."""
    rng = random.Random(1001)
    hw, hd = 1.1, 0.9
    colors = {}
    for px, py, x, y in ground_pixels(cv, hw, hd):
        d = (x / (hw - 0.08)) ** 2 + (y / (hd - 0.08)) ** 2
        rough = 0.35 * vnoise(x * 3.1 + 2, y * 3.1, 1003) + 0.12 * vnoise(x * 9, y * 9, 1004)
        if d > 1 - rough:
            if d < 1.08 - rough and ihash(px, py, 1005) < 0.45:
                colors[(px, py)] = "SOIL3"  # a ragged scorched fringe
            continue
        g = vnoise(x * 5, y * 5, 1006) * 0.6 + ihash(px, py, 1007) * 0.4
        if d > 0.62 - rough:
            colors[(px, py)] = "DEEP2" if g > 0.55 else "Q_S2" if g > 0.3 else "SOIL3"
        elif d > 0.3:
            colors[(px, py)] = "Q_S1" if g > 0.62 else "Q_M" if g > 0.35 else "DEEP2"
        else:
            colors[(px, py)] = "Q_T3" if g > 0.7 else "Q_L2" if g > 0.42 else "Q_M"
    put_flat(cv, colors, cv.new_oid())
    # Thin cracks start a little off the centre, so they never knot into a
    # bright blob; most of their length is the dark ember tone, a few pixels
    # near the heart glow brighter (faint, not a rune).
    cells = []
    for k, (angle, steps) in enumerate(((0.3, 20), (2.0, 17), (3.4, 19), (4.7, 14), (5.6, 11))):
        start = (0.05 + 0.1 * math.cos(angle), 0.1 * math.sin(angle))
        crack_walk(rng, start, angle, steps, cells, branch=0.08, step=0.032)
    crack = {}
    for x, y in cells:
        if (x / (hw - 0.22)) ** 2 + (y / (hd - 0.22)) ** 2 > 0.85:
            continue
        sx, sy = cv.project(x, y, 0)
        crack[(math.floor(sx), math.floor(sy))] = math.hypot(x - 0.05, y)
    oid = cv.new_oid()
    for (px, py), r in sorted(crack.items()):
        hot = ihash(px, py, 1009)
        color = "RUNE1" if r < 0.16 and hot < 0.25 else "RUNE2" if r < 0.3 and hot < 0.4 else "RUNE3"
        cv.put(px, py, -8.0, color, oid, TOP, {"flat": True})
    # Charred twigs and a few clumps of dead grass at the fringe.
    twig = cv.new_oid()
    for _ in range(6):
        x, y = rng.uniform(-0.6, 0.6), rng.uniform(-0.45, 0.45)
        angle = rng.uniform(0, math.tau)
        for step in range(rng.randint(5, 9)):
            sx, sy = cv.project(x + math.cos(angle) * step * 0.025, y + math.sin(angle) * step * 0.025, 0)
            cv.put(math.floor(sx), math.floor(sy), -7.5, "T3", twig, TOP, {"flat": True})
    blades = cv.new_oid()
    for a in (0.5, 2.3, 3.8, 5.2):
        px, py = cv.project(math.cos(a) * 0.9, math.sin(a) * 0.72, 0)
        for _ in range(3):
            ox, length, lean = rng.randint(-2, 2), rng.randint(3, 5), rng.uniform(-0.5, 0.5)
            for step in range(length):
                cv.put(math.floor(px + ox + lean * step), math.floor(py) - step, -7.0, "T2" if step > 1 else "T3", blades,
                       ROD, {"flat": True})


def draw_stepping_slabs(cv):
    """Flat path stones set flush in the turf, along world y."""
    rng = random.Random(1101)
    slabs = [(0.04, -1.12, 0.32, 0.26, 0.2), (-0.06, -0.48, 0.3, 0.27, -0.15), (0.07, 0.15, 0.34, 0.25, 0.1),
             (-0.04, 0.8, 0.31, 0.27, -0.25), (0.22, 1.32, 0.16, 0.13, 0.4)]
    labels, colors = {}, {}
    for px, py, x, y in ground_pixels(cv, 0.55, 1.5):
        for n, (cx, cy, rx, ry, ang) in enumerate(slabs):
            u = (x - cx) * math.cos(ang) + (y - cy) * math.sin(ang)
            v = -(x - cx) * math.sin(ang) + (y - cy) * math.cos(ang)
            q = (abs(u) / rx) ** 3 + (abs(v) / ry) ** 3
            if q < 1 - 0.25 * vnoise(x * 8, y * 8, 1103 + n):
                labels[(px, py)] = n
    for (px, py), n in labels.items():
        x = (2 * (py + 0.5 - cv.cy) - (px + 0.5 - cv.cx)) / (32 * SQ2)
        y = (2 * (py + 0.5 - cv.cy) + (px + 0.5 - cv.cx)) / (32 * SQ2)
        g = vnoise(x * 6, y * 6, 1105 + n)
        m = moss_at(x, y, 1107 + n, 0.45, fine=0.15)
        colors[(px, py)] = ("M1" if m > 0.3 else "M2" if m > 0.17 else
                            "Q_T3" if g < 0.3 else "Q_T1" if g > 0.78 else ("Q_W1" if n % 2 and g > 0.6 else "Q_T2"))
    for (px, py), n in labels.items():
        if labels.get((px - 1, py)) != n or labels.get((px, py - 1)) != n:
            if colors[(px, py)] not in ("M1", "M2"):
                colors[(px, py)] = "Q_HI" if ihash(px, py, 1109) < 0.35 else "Q_T1"
        elif labels.get((px + 1, py)) != n or labels.get((px, py + 1)) != n:
            colors[(px, py)] = "Q_L2"
    # The turf's shaded lip against each slab's lower right edge, soil in the joints.
    for (px, py), n in sorted(labels.items()):
        for dx, dy, color in ((1, 0, "SOIL3"), (0, 1, "SOIL3"), (1, 1, "M3")):
            p = (px + dx, py + dy)
            if p not in labels and p not in colors:
                colors[p] = color
    put_flat(cv, colors, cv.new_oid())
    grass = cv.new_oid()
    for n, (cx, cy, rx, ry, ang) in enumerate(slabs[:4]):
        for side in (-1, 1):
            px, py = cv.project(cx + side * (rx + 0.04), cy + side * 0.1, 0)
            for _ in range(rng.randint(2, 3)):
                ox, length, lean = rng.randint(-1, 1), rng.randint(3, 5), rng.uniform(-0.4, 0.4)
                ramp = ("M_HI", "M1", "M2") if rng.random() < 0.5 else ("G_HI", "G1", "G2")
                for step in range(length):
                    t = step / length
                    cv.put(math.floor(px + ox + lean * step), math.floor(py) - step, -7.0,
                           ramp[0] if t > 0.6 else ramp[1] if t > 0.25 else ramp[2], grass, ROD, {"flat": True})


def draw_moss_graves(cv):
    """Moss mats over sunken graves: solid cushions lit on their upper-left
    rim, darker on the lower right, with fallen leaves gathered on them."""
    rng = random.Random(1201)
    hw, hd = 1.0, 0.8
    mats = ((-0.38, -0.22, 0.52, 0.36, 1203), (0.42, 0.24, 0.46, 0.34, 1205), (-0.25, 0.45, 0.24, 0.17, 1207))
    inside_mat = {}
    for n, (cx, cy, rx, ry, salt) in enumerate(mats):
        for px, py, x, y in ground_pixels(cv, hw, hd):
            if blob(x - cx, y - cy, rx, ry, salt, rough=0.4):
                inside_mat[(px, py)] = n
    colors = {}
    # Old grave slabs, flush with the turf, show where the moss has not reached.
    slab_at = {}
    for n, (cx, cy, hx, hy) in enumerate(((-0.42, -0.26, 0.36, 0.5), (0.4, 0.22, 0.3, 0.46))):
        for px, py, x, y in ground_pixels(cv, hx, hy, cx, cy):
            if min(hx - abs(x - cx), hy - abs(y - cy)) > 0.02 * vnoise(x * 20, y * 20, 1215 + n):
                slab_at[(px, py)] = n
    for (px, py), n in slab_at.items():
        if (px, py) in inside_mat:
            continue
        if slab_at.get((px - 1, py)) != n or slab_at.get((px, py - 1)) != n:
            colors[(px, py)] = "Q_T1"
        elif slab_at.get((px + 1, py)) != n or slab_at.get((px, py + 1)) != n:
            colors[(px, py)] = "Q_L2"
        else:
            colors[(px, py)] = "Q_T3" if ihash(px, py, 1217) < 0.2 else "Q_T2"
    for (px, py), n in inside_mat.items():
        x = (2 * (py + 0.5 - cv.cy) - (px + 0.5 - cv.cx)) / (32 * SQ2)
        y = (2 * (py + 0.5 - cv.cy) + (px + 0.5 - cv.cx)) / (32 * SQ2)
        g = vnoise(x * 4.0, y * 4.0, mats[n][4] + 1)
        upper_left = inside_mat.get((px - 1, py)) != n or inside_mat.get((px, py - 1)) != n
        lower_right = inside_mat.get((px + 1, py)) != n or inside_mat.get((px, py + 1)) != n
        if upper_left:
            colors[(px, py)] = "M1" if ihash(px, py, 1211) < 0.7 else "M_HI"
        elif lower_right:
            colors[(px, py)] = "M3"
        else:
            colors[(px, py)] = "M1" if g > 0.68 else "M2" if g > 0.3 else "M3"
    # A soft shaded fringe under each mat's lower-right rim.
    for (px, py), n in sorted(inside_mat.items()):
        for q in ((px + 1, py + 1), (px, py + 1)):
            if q not in inside_mat and q not in colors:
                colors[q] = "SOIL3"
    put_flat(cv, colors, cv.new_oid())
    spots = []
    while len(spots) < 14:
        cx, cy, rx, ry, _ = mats[len(spots) % 3]
        x, y = cx + rng.uniform(-rx, rx) * 0.9, cy + rng.uniform(-ry, ry) * 0.9
        if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 0.8:
            spots.append((x, y, 0.0))
    leaves(cv, rng, spots, depth=-7.0)
    twig = cv.new_oid()
    for x, y, angle in ((0.1, -0.3, 0.6), (-0.6, 0.3, 2.2)):
        for step in range(8):
            sx, sy = cv.project(x + math.cos(angle) * step * 0.028, y + math.sin(angle) * step * 0.028, 0)
            cv.put(math.floor(sx), math.floor(sy), -7.5, "T2", twig, TOP, {"flat": True})
            angle += rng.uniform(-0.3, 0.3)


DRAW = {
    "stele-tall-x": lambda cv: draw_stele_tall(cv, "x"), "stele-tall-y": lambda cv: draw_stele_tall(cv, "y"),
    "stele-low-x": lambda cv: draw_stele_low(cv, "x"), "stele-low-y": lambda cv: draw_stele_low(cv, "y"),
    "stele-leaning-x": lambda cv: draw_stele_leaning(cv, "x"), "stele-leaning-y": lambda cv: draw_stele_leaning(cv, "y"),
    "stele-fallen-x": lambda cv: draw_stele_fallen(cv, "x"), "stele-fallen-y": lambda cv: draw_stele_fallen(cv, "y"),
    "cairn-small": draw_cairn_small, "cairn-large": draw_cairn_large,
    "grave-mound-x": lambda cv: draw_grave_mound(cv, "x"), "grave-mound-y": lambda cv: draw_grave_mound(cv, "y"),
    "grave-plot-x": lambda cv: draw_grave_plot(cv, "x"), "grave-plot-y": lambda cv: draw_grave_plot(cv, "y"),
    "obelisk": draw_obelisk, "obelisk-broken": draw_obelisk_broken,
    "stone-lantern": draw_stone_lantern, "stone-lantern-toppled": draw_stone_lantern_toppled,
    "fence-x": lambda cv: draw_fence(cv, "x"), "fence-y": lambda cv: draw_fence(cv, "y"),
    "fence-broken-x": lambda cv: draw_fence_broken(cv, "x"), "fence-broken-y": lambda cv: draw_fence_broken(cv, "y"),
    "cemetery-gate-x": lambda cv: draw_gate(cv, "x"), "cemetery-gate-y": lambda cv: draw_gate(cv, "y"),
    "urn-pair": draw_urn_pair, "urn-broken": draw_urn_broken, "offering-stone": draw_offering_stone,
    "yew-round": draw_yew_round, "yew-small": draw_yew_small,
    "grave-ash": draw_grave_ash, "stepping-slabs": draw_stepping_slabs, "moss-graves": draw_moss_graves,
}


# --------------------------------------------------------------------------
# Footprint contract, pixel-v9 rule: contactCenter = [128, 231 - front ground
# extent] rounded down to 0.25 px, so the front-most footprint point sits on
# row 231. Multi-part frames add `colliders` (world units, relative to the
# footprint centre); the gate adds its walkable `passage`.
# --------------------------------------------------------------------------

def _box(hw, hd, height, role="solid", **extra):
    return {"shape": "box", "role": role, "height": height, "halfWidth": hw, "halfDepth": hd, **extra}


def _rect(hw, hd, height=0):
    return {"shape": "rect", "role": "flat", "height": height, "halfWidth": hw, "halfDepth": hd, "contact": "none"}


def _circle(radius, height, role="solid", **extra):
    return {"shape": "circle", "role": role, "height": height, "radius": radius, **extra}


def _part(x, y, hw, hd):
    return {"x": x, "y": y, "halfWidth": hw, "halfDepth": hd}


def _swap(spec):
    """The -y twin of a -x footprint: x and y extents exchange."""
    result = dict(spec)
    if "halfWidth" in spec:
        result["halfWidth"], result["halfDepth"] = spec["halfDepth"], spec["halfWidth"]
    for key in ("colliders",):
        if key in spec:
            result[key] = [_part(p["y"], p["x"], p["halfDepth"], p["halfWidth"]) for p in spec[key]]
    if "passage" in spec:
        p = spec["passage"]
        result["passage"] = _part(p["y"], p["x"], p["halfDepth"], p["halfWidth"])
    if "axis" in spec:
        result["axis"] = "y"
    return result


SPECS = {
    "stele-tall-x": _box(0.36, 0.17, 1.52, axis="x", contact="corners"),
    "stele-low-x": _box(0.55, 0.17, 0.8, role="low", axis="x", contact="corners"),
    "stele-leaning-x": _box(0.32, 0.12, 1.2, axis="x", contact="loose"),
    "stele-fallen-x": _box(0.7, 0.3, 0.2, role="low", axis="x", contact="loose"),
    "cairn-small": _circle(0.3, 0.45, role="low", contact="loose"),
    "cairn-large": _circle(0.5, 0.75, role="low", contact="loose"),
    "grave-mound-x": _box(1.0, 0.5, 0.3, role="low", axis="x", contact="loose"),
    "grave-plot-x": {**_rect(1.0, 0.5, 0.07), "axis": "x"},
    "obelisk": _box(0.5, 0.5, 2.62, contact="corners", landmark=True),
    "obelisk-broken": _box(0.95, 0.5, 1.5, contact="loose",
                           colliders=[_part(-0.45, 0.0, 0.5, 0.5), _part(0.58, 0.0, 0.19, 0.5)]),
    "stone-lantern": _box(0.3, 0.3, 1.3, contact="corners", glow="cyan"),
    "stone-lantern-toppled": _box(0.75, 0.45, 0.45, role="low", contact="loose"),
    "fence-x": _box(1.5, 0.11, 0.72, role="low", axis="x", contact="corners"),
    "fence-broken-x": _box(1.5, 0.3, 0.72, role="low", axis="x", contact="corners", colliders=[]),
    "cemetery-gate-x": _box(1.85, 0.3, 2.52, axis="x", contact="corners",
                            colliders=[_part(-GATE_POST, 0.0, GATE_PLINTH, GATE_PLINTH),
                                       _part(GATE_POST, 0.0, GATE_PLINTH, GATE_PLINTH)],
                            passage=_part(0.0, 0.0, GATE_POST - GATE_PLINTH, GATE_PLINTH)),
    "urn-pair": _box(0.3, 0.46, 0.73, role="low", contact="corners"),
    "urn-broken": _circle(0.32, 0.3, role="low", contact="loose"),
    "offering-stone": _box(0.45, 0.3, 0.43, role="low", contact="corners"),
    "yew-round": _circle(0.25, 3.0, contact="loose", canopy=1.0),
    "yew-small": _circle(0.18, 1.85, contact="loose", canopy=0.62),
    "grave-ash": _rect(1.1, 0.9),
    "stepping-slabs": {**_rect(0.55, 1.5), "axis": "y"},
    "moss-graves": _rect(1.0, 0.8),
}
SPECS["fence-broken-x"]["colliders"] = [_part(round((a0 + a1) / 2, 3), 0.0, round((a1 - a0) / 2, 3), 0.11)
                                        for a0, a1 in fence_broken_runs()]
for _name in ("stele-tall", "stele-low", "stele-leaning", "stele-fallen", "grave-mound", "grave-plot", "fence",
              "fence-broken", "cemetery-gate"):
    SPECS[f"{_name}-y"] = _swap(SPECS[f"{_name}-x"])


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
        "owner": "scripts/build-cemetery-assets.py (SPECS); the cemetery layout reads manifest.footprints",
        "coordinateSpace": "cell-local pixels, origin top-left, x right, y down; world units at scale 1",
        "cell": CELL,
        "anchor": list(ANCHOR),
        "worldAxes": {"xPixelsPerUnit": [-22.627417, 11.313708], "yPixelsPerUnit": [22.627417, 11.313708],
                      "inverse": "x=(2*dv-du)/(32*sqrt2), y=(2*dv+du)/(32*sqrt2) for a pixel offset (du,dv) from contactCenter"},
        "rule": "contactCenter y = 231 - front ground extent (box/rect: (halfWidth+halfDepth)*8*sqrt2, circle: 16*radius), "
                "rounded down to .25 px; x = 128. colliders/passage are boxes in world units relative to the footprint "
                "centre; a mirrored placement swaps x<->y and halfWidth<->halfDepth (frames with -x/-y twins should use the "
                "twin instead). role: solid (collider, may hide the hero), low (collider, too low to hide the hero, fine on "
                "front edges), flat (ground layer, walkable, no collider). Circles of trees are trunk colliders; `canopy` is "
                "the crown radius in world units. contact: corners (drawn ground corners within 1.6 px of every collider "
                "corner), loose (organic edge on the footprint), none.",
        "frames": {name: contract_record(SPECS[name]) for name in FRAMES},
    }


# ------------------------------ frame assembly ------------------------------

def draw_frame(name, records):
    record = records[name]
    cv = Canvas(record["contactCenter"])
    DRAW[name](cv)
    if record["role"] == "flat":
        colors = cv.finish(outline=name.startswith("grave-plot"), outline_color="DEEP2")
    else:
        colors = cv.finish()
    return to_image(colors)


# --------------------------------------------------------------------------
# Cemetery earth: 128 px = 4u, sampled at worldXZ / 4 with repeat. The camp
# meadow's own hues, shifted darker under the grove, with sparse leaf litter
# lit on its +row side. Every feature wraps across the tile edges.
# --------------------------------------------------------------------------

SURFACE = 128
SURFACE_PALETTE = {
    "G_SH": "#454a34", "G_D2": "#58553c", "G_D1": "#666243", "G_B": "#74704a", "G_G": "#70764a", "G_H1": "#948c55",
    "L1": PALETTE["Y2"], "L2": PALETTE["T1"], "L3": PALETTE["SOIL3"], "L_HI": PALETTE["Y1"],
}
CAMP_GRASS_SHARED = ("G_SH", "G_D2", "G_D1", "G_B", "G_G", "G_H1")


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


def cemetery_earth():
    rng = random.Random(1301)
    names = []
    for y in range(SURFACE):
        for x in range(SURFACE):
            # One dominant tone a step darker than the camp meadow, soft
            # darker and greener patches, a few deep shade pockets.
            v = patch_value(x, y, 1310)
            tone = "G_D1" if v > 0.4 else "G_D2" if v > 0.3 else "G_SH"
            if tone == "G_D1" and tile_noise(x + 0.5, y + 0.5, 16, 1314) > 0.7:
                tone = "G_G"
            if ihash(x, y, 1317) < 0.03:
                tone = "G_D2" if tone in ("G_D1", "G_G") else "G_SH"
            names.append(tone)

    def at(x, y):
        return (y % SURFACE) * SURFACE + x % SURFACE

    # Short blade clusters point screen-up: one texel -col, +row per step.
    for _ in range(110):
        cx, cy = rng.randrange(SURFACE), rng.randrange(SURFACE)
        for _ in range(rng.randint(2, 4)):
            bx, by = cx + rng.randint(-3, 3), cy + rng.randint(-3, 3)
            length = rng.choice((2, 2, 3))
            names[at(bx + 1, by - 1)] = "G_SH"
            for k in range(length):
                names[at(bx - k, by + k)] = "G_H1" if k == length - 1 and rng.random() < 0.4 else "G_B"
    # Sparse fallen leaves: a lit +row edge, a dark stalk end.
    for _ in range(26):
        cx, cy = rng.randrange(SURFACE), rng.randrange(SURFACE)
        body = "L1" if rng.random() < 0.6 else "L2"
        horizontal = rng.random() < 0.5
        cells = [(0, 0), (1, 0), (2, 0)] if horizontal else [(0, 0), (0, 1), (1, 1)]
        for k, (dx, dy) in enumerate(cells):
            names[at(cx + dx, cy + dy)] = "L_HI" if k == 1 and body == "L1" and rng.random() < 0.5 else body
        names[at(cx - 1, cy - 1)] = "L3"
    image = Image.new("RGB", (SURFACE, SURFACE))
    rgb = {name: hexrgb(value) for name, value in SURFACE_PALETTE.items()}
    image.putdata([rgb[name] for name in names])
    return image


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
    if record["shape"] == "circle" or record["role"] == "flat":
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
              "sizeUnits": [round((box[2] - box[0]) / 32, 2), round((box[3] - box[1]) / 32, 2)],
              "opaquePixels": len(opaque), "colors": len(colors), "maxOpaqueRow": max(y for _, y in opaque),
              "opaqueOnFootprint": on_footprint, "contactCenter": record["contactCenter"], "role": record["role"]}
    gaps = contact_gaps(cell, record)
    if gaps:
        report["contactGaps"] = gaps
        report["maxContactGap"] = max(g["gap"] for g in gaps)
    return report


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
            outline = footprint_polygon(record)
            draw.line([(x + px, y + py) for px, py in outline + outline[:1]], fill="#ffd60a")
            for b in collider_boxes(record) if record.get("colliders") else []:
                corners = [(b["x"] + sx * b["halfWidth"], b["y"] + sy * b["halfDepth"]) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
                draw.line([(x + cx + KX * (wy - wx), y + cy + KY * (wx + wy)) for wx, wy in corners + corners[:1]], fill="#30d5c8")
            if record.get("passage"):
                b = record["passage"]
                corners = [(b["x"] + sx * b["halfWidth"], b["y"] + sy * b["halfDepth"]) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
                draw.line([(x + cx + KX * (wy - wx), y + cy + KY * (wx + wy)) for wx, wy in corners + corners[:1]], fill="#ff8ad8")
            draw.rectangle((x + cx - 1, y + cy - 1, x + cx + 1, y + cy + 1), outline="#ff3b30")
    if scale > 1:
        sheet = sheet.resize((sheet.width * scale, sheet.height * scale), Image.Resampling.NEAREST)
    return sheet


# ------------------------------ composition previews ------------------------

def to_screen(origin, x, y, z=0.0):
    return origin[0] + KX * (y - x), origin[1] + KY * (x + y) - KZ * z


def ground_image(size, origin, pick):
    """Project surfaces onto the ground plane: pick(x, y) -> texture."""
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
        ruins = json.loads((ROOT / INPUTS["ruinsManifest"]).read_text())
        self.ruin_frames, self.ruin_prints, self.ruin_atlas = ruins["monasteryRuins"]["frames"], ruins["footprints"], ruins["monasteryRuins"]
        monk = json.loads((ROOT / INPUTS["monkManifest"]).read_text())["monk"]
        self.monk = sprite_cell(images["monkAtlas"], monk["clips"]["idle"]["front"][0], monk["cell"], monk["columns"])

    def add(self, sprite, contact, x, y, extent, actor=None):
        hw, hd = extent
        self.items.append({"sprite": sprite, "contact": contact, "x": x, "y": y, "actor": actor,
                           "x0": x - hw, "x1": x + hw, "y0": y - hd, "y1": y + hd, "key": x + y})

    def _place(self, cell, record, x, y):
        if record["role"] == "flat":
            self.flat.append((cell, record["contactCenter"], x, y))
            return
        extent = (record["radius"],) * 2 if record["shape"] == "circle" else (record["halfWidth"], record["halfDepth"])
        self.add(cell, record["contactCenter"], x, y, extent)

    def prop(self, name, x, y):
        self._place(self.cells[FRAMES.index(name)], self.records[name], x, y)

    def camp(self, name, x, y):
        cell = sprite_cell(self.images["campAtlas"], self.camp_frames.index(name), self.camp_atlas["cell"], self.camp_atlas["columns"])
        self._place(cell, self.camp_prints[name], x, y)

    def ruin(self, name, x, y):
        cell = sprite_cell(self.images["ruinsAtlas"], self.ruin_frames.index(name), self.ruin_atlas["cell"], self.ruin_atlas["columns"])
        self._place(cell, self.ruin_prints[name], x, y)

    def paste(self, sprite, contact, x, y):
        sx, sy = to_screen(self.origin, x, y)
        self.image.alpha_composite(sprite, (round(sx - contact[0]), round(sy - contact[1])))

    def render(self):
        for sprite, contact, x, y in self.flat:
            self.paste(sprite, contact, x, y)
        for item in paint_order(self.items):
            if item["actor"]:
                shadow(self.image, self.origin, item["x"], item["y"], item["actor"])
            self.paste(item["sprite"], item["contact"], item["x"], item["y"])


def cemetery_mock(cells, records, images, earth):
    """A 16 x 10u burial ground (x -8..8, y -5..5) on cemetery-earth inside the
    camp meadow, drawn at native scale and shown enlarged 2x."""
    size = (640, 420)
    origin = (320, 250)
    grass = images["campGrass"]

    def pick(x, y):
        edge = min(x + 8.3, 8.3 - x, y + 5.3, 5.3 - y)
        jitter = vnoise(x * 1.6, y * 1.6, 1901) * 1.1 - 0.55 + (ihash(math.floor(x * 32), math.floor(y * 32), 1902) - 0.5) * 0.35
        return earth if edge + jitter > 0 else grass

    image = ground_image(size, origin, pick)
    stage = Stage(image, origin, cells, records, images)
    # Flat ground art first: the path from the gate to the obelisk, plots, moss, the scorched grave.
    for name, x, y in (("stepping-slabs", 0.0, 3.4), ("stepping-slabs", 0.0, 0.4), ("grave-plot-y", -2.6, 0.75),
                       ("grave-plot-y", 4.8, 1.85), ("moss-graves", -4.6, 3.7), ("moss-graves", 6.0, -1.8),
                       ("grave-ash", 4.3, 3.6)):
        stage.prop(name, x, y)
    for name, x, y in (
            # Back edge: old steles, the yews, a cairn and the broken obelisk.
            ("yew-round", -7.0, -4.4), ("yew-small", -1.2, -4.6), ("yew-round", 7.0, -4.3),
            ("stele-tall-x", -5.6, -4.3), ("stele-low-x", -4.4, -4.3), ("stele-tall-x", -3.2, -4.3),
            ("cairn-large", 3.3, -4.1), ("obelisk-broken", 5.1, -3.5), ("stele-leaning-x", 1.6, -4.4),
            # The obelisk at the end of the path, with its lantern, urns and offering stone.
            ("obelisk", 0.0, -2.7), ("stone-lantern", -1.3, -1.5), ("stone-lantern-toppled", 1.6, -1.5),
            ("urn-pair", -1.2, -2.9), ("offering-stone", 1.3, -2.9),
            # Graves on both sides of the path: steles at the head (-y), mounds and plots before them.
            ("stele-tall-x", -4.6, -0.75), ("grave-mound-y", -4.6, 0.75), ("stele-low-x", -2.6, -0.65),
            ("stele-tall-x", 2.8, 0.05), ("grave-mound-y", 2.8, 1.55), ("stele-leaning-x", 4.8, 0.3),
            ("stele-low-x", -4.6, 2.5), ("stele-fallen-y", -2.6, 3.3), ("cairn-small", 6.6, 0.4),
            ("urn-broken", 5.9, 4.1),
            # The upper-right edge: steles facing +x.
            ("stele-tall-y", -7.2, -1.6), ("stele-low-y", -7.2, 0.2), ("stele-leaning-y", -7.2, 1.9),
            ("stele-fallen-x", -6.6, 3.7),
            # Front edges: a low fence, the bell gate on the path, a broken bay.
            ("fence-x", -6.5, 5.3), ("fence-x", -3.4, 5.3), ("cemetery-gate-x", 0.0, 5.3), ("fence-broken-x", 3.4, 5.3),
            ("fence-x", 6.5, 5.3), ("fence-y", 8.3, -3.45), ("fence-broken-y", 8.3, -0.4), ("fence-y", 8.3, 2.65)):
        stage.prop(name, x, y)
    # Existing world props beyond the grove: cypresses, bushes, a ruin wall and a parapet.
    for name, x, y in (("cypress-tall", -9.4, 1.0), ("cypress-medium", -1.0, -7.0), ("bush-round", 9.6, 1.4),
                       ("bush-large", 3.6, 6.9), ("cypress-pair", 6.2, -7.2)):
        stage.camp(name, x, y)
    stage.ruin("wall-run-x", -4.2, -6.8)
    stage.ruin("parapet-y", -8.9, 3.4)
    stage.add(stage.monk, (48, 84), 0.9, 1.2, (0.3, 0.3), actor=0.42)
    stage.add(stage.monk, (48, 84), 0.2, 6.3, (0.3, 0.3), actor=0.42)
    stage.render()
    image = image.convert("RGB").resize((size[0] * 2, size[1] * 2), Image.Resampling.NEAREST)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, image.width, 16), fill="#20282e")
    draw.text((6, 3), "cemetery mock 16x10u, native 32 px/u shown at 2x: pixel-v13 props on cemetery-earth inside the camp "
                      "meadow, camp cypress/bush, ruins wall/parapet, unchanged monk (art preview, not a layout)",
              fill="#e3e4d8")
    return image


def style_match(cells, records, images):
    size = (1280, 360)
    origin = (600, 214)
    image = ground_image(size, origin, lambda x, y: images["campGrass"])
    stage = Stage(image, origin, cells, records, images)
    row = [("ruin", "parapet-x", -10.0), ("prop", "fence-x", -7.6), ("camp", "ruin-pillar", -5.4),
           ("prop", "stele-tall-y", -4.2), ("prop", "stele-low-x", -3.1), ("camp", "boulder-round", -1.9),
           ("prop", "cairn-large", -0.9), ("ruin", "column-intact", 0.4), ("prop", "obelisk", 1.6),
           ("prop", "stone-lantern", 2.9), ("camp", "cypress-medium", 4.2), ("prop", "yew-round", 5.9),
           ("camp", "bush-round", 7.6), ("prop", "yew-small", 8.8), ("prop", "urn-pair", 9.9)]
    for kind, name, s in row:
        {"camp": stage.camp, "ruin": stage.ruin, "prop": stage.prop}[kind](name, 1.5 - s, 1.5 + s)
    stage.add(stage.monk, (48, 84), 1.5 - 11.2, 1.5 + 11.2, (0.3, 0.3), actor=0.42)
    stage.render()
    draw = ImageDraw.Draw(image)
    for n, (kind, name, s) in enumerate(row):
        sx, sy = to_screen(origin, 1.5 - s, 1.5 + s)
        draw.text((round(sx) - 3 * len(name), round(sy) + 26 + 14 * (n % 2)), name, fill="#e3e4d8" if kind == "prop" else "#b9c2b0")
    draw.rectangle((0, 0, size[0], 16), fill="#20282e")
    draw.text((6, 3), "style match at 1:1: camp-panorama and monastery-ruins props (grey labels) next to the cemetery props "
                      "(white labels); monk for scale", fill="#e3e4d8")
    return image.convert("RGB")


README = """# Old cemetery package

Programmatic pixel art for «Старое кладбище», the old open-air burial ground of the monastery's monks in a yew and
cypress grove east of the road. It is drawn in the camp panorama's stone language, so camp, road, courtyard and
cemetery read as one world. Every pixel is drawn by `scripts/build-cemetery-assets.py` from fixed geometry, fixed seeds
and explicit palettes. No image generation, network access or new dependency is involved.

## Runtime use

Not placed yet. A layout agent will place the frames by `manifest.footprints` in the way `src/courtyard-layout.js`
places the ruins (`put()`: sprite position = footprint centre − `toWorld(contactCenter − anchor)`; `colliders`
replace the box). Register the atlas under the key `cemetery`. Frame names, footprints, roles and colliders are the
runtime contract.

## Contents

| File | Contents |
| --- | --- |
| `cemetery.png` | Atlas, cell 256 px, 4 columns × 8 rows, registration anchor `[128,232]`, binary alpha, {prop_colors} opaque colours. |
| `cemetery-earth.png` | Opaque 128 × 128 ground surface (4u, 32 px/u), seamless on both axes, {surface_colors} colours. |
| `hit-masks.json` | Little-bit-first mask of the atlas alpha, keyed by `cemetery.png`. |
| `manifest.json` | Runtime contract: atlas slicing, frame keys, surface, footprints, `opaqueBounds` (opaque `[x0,y0,x1,y1]` box of each cell, exclusive end, as in pixel-v9). |
| `frames/*.png` | One 256 px cell per frame. |
| `previews/` | Contact sheets (native, 2×), footprint overlay, a 16 × 10u mock cemetery with camp and ruins props and the monk, a style match row, 3×3 surface repeats (native, 2×). |
| `source/footprints.json` | Geometry contract the art was drawn to (written by the script from `SPECS`). |
| `source/palette.json`, `source/provenance.json`, `qa-report.json` | Palette with its camp and ruins sources, input hashes, per-frame checks. |

Frames, in atlas order: {frame_list}.

## Frames

Sizes are the drawn ground footprint (along × across, u) and the drawn height. "-x" frames stand along world x
(screen upper right to lower left) and show their carved face in shade; "-y" frames stand along world y and show it
lit. Both orientations are drawn: a mirror would put the shade-side tones on the lit face.

| Frame | Role | Footprint | Height | Notes |
| --- | --- | --- | --- | --- |
{frame_rows}

Roles: `solid` blocks walking and may hide the hero (the renderer fades it); `low` blocks walking but stays under the
hero's knees, so it suits the front edges of the zone; `flat` is ground art without a collider. Trees, the obelisk and
the gate have small colliders at the trunk, the plinth or the posts only.

Colours: magenta appears only in `grave-ash` (faint cracks where the ritual touched the ground); turquoise only in
`stone-lantern` (a static spirit glow in its firebox windows). There are no bones, skulls, crosses or other religious
signs: the steles carry carved bands, framing grooves and abstract glyph marks.

## Registration

`[128,232]` is a fixed registration point, not a footprint centre. Each frame's ground footprint is
`footprints.<frame>`: `contactCenter` in cell pixels plus a world-space shape (`box`/`rect`: `halfWidth` along
world x = screen down-left, `halfDepth` along world y = screen down-right; `circle`: `radius`). The front-most
footprint point sits on row 231. Pixel offset `(du,dv)` from `contactCenter` maps to world `x=(2dv-du)/(32√2)`,
`y=(2dv+du)/(32√2)`.

Extensions over pixel-v9 (as in pixel-v11): `colliders` (exact solid boxes of `obelisk-broken`, the two gate posts and
the standing chunks of `fence-broken-*`, world units relative to the footprint centre), `passage` (the gate's
walkable 2.5u box), `axis` (the -x/-y orientation), `canopy` (a tree's crown radius in u), `landmark`, `glow` and
`contact` (`corners`: every collider's front, screen-left and screen-right ground corner lies within 1.6 px of the
drawing; `loose`: organic edge; `none`). The role `low` is new: it is a collider like `solid`.

## Ground surface

`manifest.surfaces.cemeteryEarth` follows the pixel-v6 surface contract: sample at `worldXZ / 4` with repeat.
Image columns run along world +x and rows along world −y (textures load with `invertY`). It is the camp meadow's own
hues ({grass_shared} of its colours are `campGrass` colours) pushed darker under the grove, with short blade clusters,
dark soil patches and sparse fallen leaves lit on their +row side. Every feature wraps across the tile edges.

## Rebuild and verify

From the repository root (tested with Python {python}, Pillow {pillow}):

```sh
python3 -B scripts/build-cemetery-assets.py
python3 -B scripts/build-cemetery-assets.py --verify-only
node --test tests/cemetery-assets.test.js
```

`--verify-only` redraws every delivered file in memory, compares bytes, writes nothing and exits non-zero on any
difference. Byte identity is guaranteed only with the recorded Pillow version.

## Limits

- Programmatic drawing: stones are heightfield masses with rounded, chipped tops; carvings are one-pixel grooves.
  Glyphs are 3 × 4 pixels, so they read as marks, not as script.
- No animation: the lantern glow is static.
- The gate passage is see-through, but billboard sorting cannot put an actor between the posts in front of the far
  post; the layout should rely on the renderer's translucency, as for the ruins arch.
- `obelisk-broken`, `stone-lantern-toppled`, `urn-pair`, `urn-broken`, `offering-stone`, the cairns and the yews have
  one drawing each; mirroring them puts their lit faces on the shaded side. `stepping-slabs` runs along world y; a
  mirrored copy runs along x with the slab lips lit from the wrong side (a small effect on flat stones).
- Colliders and placement are the cemetery layout's decision; footprints are the drawing contract.
"""

NOTES = {
    "stele-tall": "upright gravestone, rounded top, carved frame, band and three glyphs, on a plinth",
    "stele-low": "low wide gravestone with a humped top, framed glyph panel",
    "stele-leaning": "tilted 13°, cracked, one shoulder broken off, foot sunk in a soil heap",
    "stele-fallen": "lies face up, broken in two, carving on its top",
    "cairn-small": "five stacked river stones",
    "cairn-large": "a ring of seven stones under a stack of six, knee high",
    "grave-mound": "earth mound with dry grass, leaves and border stones (two missing)",
    "grave-plot": "flush kerb outline, broken in places, soil and moss inside",
    "obelisk": "landmark: stepped plinth, glyph panels on the die, tapered shaft with glyph columns and a pyramidion",
    "obelisk-broken": "snapped at 1.4u, the banded top with its pyramidion lies beside the plinth; one collider each",
    "stone-lantern": "base, shaft, firebox with two turquoise windows, pyramid roof",
    "stone-lantern-toppled": "base with a snapped stump, shaft, dark firebox and roof lying in the grass",
    "fence": "four low posts with two stone rails, 3u",
    "fence-broken": "one bay standing, the middle post fallen, a walkable gap between the colliders",
    "cemetery-gate": "two posts, a lintel with glyphs, a small bronze bell; walkable passage 2.5u",
    "urn-pair": "an open urn and a lidded urn on a slab along world y",
    "urn-broken": "an urn on its side with a broken flank, shards and spilled soil",
    "offering-stone": "low altar stone with two bronze bowls and a carved band",
    "yew-round": "dark round evergreen ≈3u, short fluted red-brown trunk",
    "yew-small": "young yew ≈1.85u",
    "grave-ash": "scorched ground with faint magenta cracks (the only magenta)",
    "stepping-slabs": "five flush path stones along world y",
    "moss-graves": "moss cushions over two flush grave slabs, fallen leaves and twigs",
}


def frame_rows(records, reports):
    rows = []
    for name, report in zip(FRAMES, reports):
        r = records[name]
        if r["shape"] == "circle":
            area = f"r {r['radius']}"
        else:
            area = f"{2 * r['halfWidth']:g} × {2 * r['halfDepth']:g}"
        key = name[:-2] if name[-2:] in ("-x", "-y") else name
        rows.append(f"| `{name}` | {r['role']} | {area} | {r['height']:g} | {NOTES[key]} |")
    return "\n".join(rows)


def build_outputs():
    records = contract()["frames"]
    assert list(records) == FRAMES and len(FRAMES) == COLUMNS * ROWS
    images = {key: load_rgba(ROOT / path) for key, path in INPUTS.items() if path.endswith(".png")}
    cells = [draw_frame(name, records) for name in FRAMES]
    atlas = Image.new("RGBA", (CELL * COLUMNS, CELL * ROWS), (0, 0, 0, 0))
    for i, cell in enumerate(cells):
        atlas.alpha_composite(cell, ((i % COLUMNS) * CELL, (i // COLUMNS) * CELL))
    atlas_colors = sorted({p[:3] for p in pixels(atlas) if p[3]})
    assert len(atlas_colors) <= PALETTE_BUDGET, f"palette budget exceeded: {len(atlas_colors)}"
    used = {name for name, value in PALETTE.items() if hexrgb(value) in set(atlas_colors)}
    reports = [frame_report(name, cell, records[name]) for name, cell in zip(FRAMES, cells)]
    for report in reports:
        assert report["maxOpaqueRow"] <= LAST_ROW, f"{report['frame']} draws below the anchor"
        assert report["opaqueOnFootprint"] > 0, f"{report['frame']} does not touch its footprint"
        assert report.get("maxContactGap", 0) <= 1.6, f"{report['frame']} contact gap {report.get('maxContactGap')}"
    earth = cemetery_earth()
    surface_colors = len(set(pixels(earth)))
    assert 8 <= surface_colors <= 12, f"surface palette {surface_colors}"
    camp_palette = json.loads((ROOT / INPUTS["campPalette"]).read_text())
    ruins_palette = json.loads((ROOT / INPUTS["ruinsPalette"]).read_text())
    shared_camp = sorted(n for n in PALETTE if n in camp_palette["props"] and camp_palette["props"][n]["hex"] == PALETTE[n])
    shared_ruins = sorted(n for n in RUINS_ONLY if ruins_palette["props"].get(n, {}).get("hex") == PALETTE[n])
    assert len(shared_camp) + len(shared_ruins) == len(PALETTE), "every prop colour comes from the camp or the ruins"
    outputs = {}
    outputs["cemetery.png"] = png_bytes(atlas)
    outputs["cemetery-earth.png"] = png_bytes(earth)
    for name, cell in zip(FRAMES, cells):
        outputs[f"frames/{name}.png"] = png_bytes(cell)
    outputs["hit-masks.json"] = json_bytes({"cemetery.png": pack_mask(atlas)})
    outputs["previews/contact-native.png"] = png_bytes(contact_sheet(cells, 1))
    outputs["previews/contact-2x.png"] = png_bytes(contact_sheet(cells, 2))
    outputs["previews/footprints-native.png"] = png_bytes(contact_sheet(cells, 1, records))
    outputs["previews/cemetery-earth-repeat-native.png"] = png_bytes(repeat_preview(earth, 1))
    outputs["previews/cemetery-earth-repeat-2x.png"] = png_bytes(repeat_preview(earth, 2))
    outputs["previews/cemetery-mock.png"] = png_bytes(cemetery_mock(cells, records, images, earth.convert("RGBA")))
    outputs["previews/style-match.png"] = png_bytes(style_match(cells, records, images))
    outputs["source/footprints.json"] = json_bytes(contract())
    outputs["source/palette.json"] = json_bytes({
        "schemaVersion": 1,
        "method": "No new colours: camp panorama ramps reused by name and hex, plus the monastery ruins' lit-face tone, "
                  "soil, turquoise and magenta ramps. The surface uses six campGrass colours and four prop colours.",
        "props": {name: {"hex": value, "source": "campPanorama" if name in shared_camp else "monasteryRuins",
                         "usedInAtlas": name in used} for name, value in PALETTE.items()},
        "surfaces": {"cemeteryEarth": {name: {"hex": value, "source": "campGrass" if name in CAMP_GRASS_SHARED else "props"}
                                       for name, value in SURFACE_PALETTE.items()}},
        "sharedWithCampPanorama": shared_camp,
        "sharedWithMonasteryRuins": shared_ruins,
        "atlasColors": len(atlas_colors),
        "budget": PALETTE_BUDGET,
    })
    input_hashes = {key: {"path": path, "sha256": digest((ROOT / path).read_bytes())} for key, path in INPUTS.items()}
    outputs["source/provenance.json"] = json_bytes({
        "schemaVersion": 1,
        "method": "programmatic drawing: heightfield stone masses (rounded, chipped blocks; slabs with profiled tops, a "
                  "rolled slab, tapered shafts, earth mounds) splatted into a z-buffer with grounded and floating passes, "
                  "screen-space carving on the true face planes, ray-cast ellipsoids for urns, bark and foliage tufts, "
                  "hand-pixelled bell and litter, screen-space flat decals, and a wrapped-noise meadow surface",
        "generator": "scripts/build-cemetery-assets.py",
        "rendererOrigin": "Canvas, ellipsoid, rod, Block, mass_field, draw_mass, mass_tone, tuft, base_grass and the "
                          "surface noise are adapted copies of scripts/build-monastery-ruins-assets.py and "
                          "scripts/build-camp-panorama-assets.py (copied, not imported, so edits there never change these bytes)",
        "imageGeneration": None,
        "tools": {"python": sys.version.split()[0], "pillow": PILLOW_VERSION},
        "inputs": input_hashes,
        "inputRoles": {
            "campAtlas": "camp props in the mock and the style match", "campManifest": "camp frame order and footprints",
            "campPalette": "shared colour check (names and hex)", "campGrass": "preview meadow; surface hues",
            "ruinsAtlas": "ruins wall, parapet and column in the mock and the style match",
            "ruinsManifest": "ruins frame order and footprints", "ruinsPalette": "shared colour check (names and hex)",
            "monkAtlas": "unchanged hero for scale", "monkManifest": "idle frame index",
        },
        "seeds": "fixed integer salts in the script; random.Random only",
        "license": "project art; no external assets",
    })
    magenta = {hexrgb(PALETTE[k]) for k in MAGENTA_KEYS}
    cyan = {hexrgb(PALETTE[k]) for k in CYAN_KEYS}
    outputs["qa-report.json"] = json_bytes({
        "schemaVersion": 1,
        "atlas": {"size": list(atlas.size), "opaqueColors": len(atlas_colors), "budget": PALETTE_BUDGET, "binaryAlpha": True,
                  "usedFromCampPanorama": sorted(n for n in used if n in shared_camp),
                  "usedFromMonasteryRuins": sorted(n for n in used if n in shared_ruins),
                  "magentaFrames": [FRAMES[i] for i, cell in enumerate(cells) if any(p[3] and p[:3] in magenta for p in pixels(cell))],
                  "cyanFrames": [FRAMES[i] for i, cell in enumerate(cells) if any(p[3] and p[:3] in cyan for p in pixels(cell))]},
        "frames": reports,
        "surfaces": {"cemeteryEarth": surface_report(earth)},
    })
    manifest = {
        "schemaVersion": 1, "status": "ready", "nativePixelsPerUnit": 32,
        "cemetery": {"path": "cemetery.png", "cell": CELL, "columns": COLUMNS, "rows": ROWS,
                     "anchor": list(ANCHOR), "frames": FRAMES, "filter": "nearest", "mipmaps": False},
        "surfaces": {"cemeteryEarth": {"path": "cemetery-earth.png", "size": [SURFACE, SURFACE],
                                       "filter": "nearest", "mipmaps": False}},
        "footprints": records,
        "opaqueBounds": {report["frame"]: report["bbox"] for report in reports},
        "hitMasks": "hit-masks.json", "provenance": "source/provenance.json", "palette": "source/palette.json",
        "previews": "previews/contact-native.png",
    }
    outputs["manifest.json"] = json_bytes(manifest)
    outputs["README.md"] = README.format(
        prop_colors=len(atlas_colors), surface_colors=surface_colors, frame_list=", ".join(f"`{n}`" for n in FRAMES),
        frame_rows=frame_rows(records, reports), grass_shared=len(CAMP_GRASS_SHARED),
        python=sys.version.split()[0], pillow=PILLOW_VERSION).encode()
    return outputs, {"atlasColors": len(atlas_colors), "surfaceColors": surface_colors, "files": len(outputs),
                     "usedFromCamp": sum(n in shared_camp for n in used), "usedFromRuins": sum(n in shared_ruins for n in used),
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
