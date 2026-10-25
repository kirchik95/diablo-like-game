#!/usr/bin/env python3
"""Draw the monastery orchard package programmatically; --verify-only never writes.

«Сад обители»: olive trees, a well, an olive press, pergolas, trellises,
beehives, benches, a handcart, jars, a seated monk statue, herb beds and flat
ground litter, plus one seamless clover meadow surface. Stone is the camp and
ruins heightfield masonry (rounded, chipped blocks, moss, blue-green shade);
wood is the same heightfield remapped to the camp crate's warm wood ramp;
jars, skeps, baskets and the bucket are ray-marched solids of revolution;
bark, the statue and foliage are ray-cast ellipsoids and hand-pixel tufts.
No image generation, network or dependency installation is involved. Paths
resolve from this script; output is confined to assets/game/pixel-v13/orchard.
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
OUT = ROOT / "assets/game/pixel-v13/orchard"
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
FRAMES = ["olive-tree-a", "olive-tree-b", "olive-tree-c", "olive-tree-old",
          "olive-dead", "fig-young", "well", "olive-press",
          "pergola-x", "pergola-y", "pergola-broken-x", "pergola-broken-y",
          "trellis-x", "trellis-y", "beehive-pair", "beehive-fallen",
          "stone-basin", "garden-bench-x", "garden-bench-y", "cart-broken-x",
          "cart-broken-y", "olive-baskets", "terracotta-jars", "monk-statue",
          "herb-bed-x", "herb-bed-y", "herb-bed-overgrown", "vine-clump",
          "fallen-olives", "leaf-litter", "gravel-path", "pruned-branches"]
ATLAS_KEY, ATLAS_PATH = "orchard", "orchard.png"
CELL, COLUMNS, ROWS, ANCHOR = 256, 4, 8, (128, 232)
LAST_ROW = 231
PALETTE_BUDGET, SHARED_MINIMUM = 48, 24

# One prop palette. Stone, moss, bush foliage, bark, crate wood, rope straw and
# soil are the camp panorama and monastery ruins ramps unchanged (same names,
# same hex), so the orchard reads as the same world. Seven additions: the
# silver olive leaf (O_*), the fresh vine and fig leaf (V_*), terracotta (TC_*)
# and one grey-violet lavender. No magenta, turquoise or amber glow.
PALETTE = {
    "OUT": "#0e121d", "DEEP": "#1f2737", "DEEP2": "#2d2f40",
    "Q_HI": "#c9b79b", "Q_W1": "#b09c82", "Q_T1": "#9f9280", "Q_T2": "#877d72", "Q_T3": "#6c6564",
    "Q_L0": "#7b7270", "Q_L1": "#706968", "Q_L2": "#5c5258", "Q_M": "#4a4753", "Q_S1": "#3d3e4c", "Q_S2": "#30344a",
    "Q_AMB": "#3c4b52",
    "M_HI": "#9a9358", "M1": "#7d7b4f", "M2": "#626445", "M3": "#4a523f",
    "B_HI": "#6f8467", "B1": "#4f6759", "B2": "#37504b", "B3": "#263c3e", "F4": "#0f2b3c",
    "T1": "#6e4f45", "T2": "#4a3438", "T3": "#2f2230",
    "W_HI": "#b4754b", "W1": "#8d5c48", "W2": "#6b453e", "W3": "#573a3a", "W4": "#352430",
    "Y1": "#b8935c", "Y2": "#8c6c46", "Y3": "#d3bb8f",
    "SOIL1": "#82664c", "SOIL2": "#6c5440", "SOIL3": "#4b3a33",
    "O_HI": "#b0b78f", "O1": "#8f9a77",
    "V_HI": "#87a35f", "V1": "#5f7f4d",
    "TC_HI": "#d4905e", "TC1": "#b4683f",
    "LV": "#8f86b0",
}
NEW_COLORS = ("O_HI", "O1", "V_HI", "V1", "TC_HI", "TC1", "LV")
OLIVE = ("O_HI", "O1", "B_HI", "B1", "B2", "B3")      # silver-green olive canopy
FRESH = ("V_HI", "V1", "B1", "B2", "B3", "F4")        # vine, fig and herb green
DRY = ("Y3", "Y1", "Y2", "T1", "T2", "T3")            # dry leaves of the dead olive

SQ2 = math.sqrt(2)
KX, KY, KZ = 16 * SQ2, 8 * SQ2, 32 * math.sin(math.pi / 3)
RIGHT = (-1 / SQ2, 1 / SQ2, 0.0)
UP = (-SQ2 / 4, -SQ2 / 4, math.sqrt(3) / 2)
VIEW = (math.sqrt(6) / 4, math.sqrt(6) / 4, 0.5)


def _normalize(v):
    length = math.sqrt(sum(c * c for c in v))
    return tuple(c / length for c in v)


LIGHT = _normalize(tuple(-0.62 * r + 0.5 * u + 0.6 * w for r, u, w in zip(RIGHT, UP, VIEW)))


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def lit(n):
    return dot(n, LIGHT)


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


def add(a, b, s=1.0):
    return (a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s)


# --------------------------------------------------------------------------
# Sprite canvas: exact orthographic 2:1 projection into a z-buffer (the camp
# panorama renderer, copied so later camp edits never change these bytes).
# Additions: ellipsoids may turn about z, and `lathe` ray-marches a solid of
# revolution about any axis (jars, skeps, baskets, the bucket).
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

    def ray_origin(self, px, py):
        su, sv = (px + 0.5 - self.cx) / 32, -(py + 0.5 - self.cy) / 32
        return (su * RIGHT[0] + sv * UP[0], su * RIGHT[1] + sv * UP[1], sv * UP[2])

    def ellipsoid(self, c, r, shade, style, oid=None, floor=0.0, angle=0.0):
        """Ray-cast an ellipsoid with radii r on axes turned by `angle` about z; shade(normal, point) -> colour."""
        oid = oid or self.new_oid()
        pcx, pcy = self.project(*c)
        reach = max(r) * 32 + 2
        left, right, top, bottom = self.bounds([(pcx - reach, pcy - reach), (pcx + reach, pcy + reach)], 0)
        ca, sa = math.cos(angle), math.sin(angle)
        lv = (VIEW[0] * ca + VIEW[1] * sa, -VIEW[0] * sa + VIEW[1] * ca, VIEW[2])
        w = (lv[0] / r[0], lv[1] / r[1], lv[2] / r[2])
        a = dot(w, w)
        for py in range(top, bottom + 1):
            for px in range(left, right + 1):
                p0 = self.ray_origin(px, py)
                dx, dy, dz = p0[0] - c[0], p0[1] - c[1], p0[2] - c[2]
                q = ((dx * ca + dy * sa) / r[0], (-dx * sa + dy * ca) / r[1], dz / r[2])
                b = dot(q, w)
                disc = b * b - a * (dot(q, q) - 1)
                if disc < 0:
                    continue
                t = (-b + math.sqrt(disc)) / a
                p = add(p0, VIEW, t)
                if p[2] < floor:
                    continue
                lx, ly, lz = p[0] - c[0], p[1] - c[1], p[2] - c[2]
                nl = ((lx * ca + ly * sa) / r[0] ** 2, (-lx * sa + ly * ca) / r[1] ** 2, lz / r[2] ** 2)
                n = _normalize((nl[0] * ca - nl[1] * sa, nl[0] * sa + nl[1] * ca, nl[2]))
                self.put(px, py, t, shade(n, p), oid, ROUND, style)
        return oid

    def lathe(self, base, axis, height, radius, shade, style, oid=None, step=0.011, floor=0.0):
        """Ray-march the solid radius(h), 0 <= h <= height along `axis` from `base`.
        shade(n, p, h, part, u) -> colour; part is 'side', 'cap' (h = height) or 'base' (h = 0); u is the radial unit."""
        oid = oid or self.new_oid()
        A = _normalize(axis)
        rmax = max(radius(height * k / 48) for k in range(49))
        mid = add(base, A, height / 2)
        R = math.sqrt((height / 2) ** 2 + rmax ** 2) + 0.01
        pcx, pcy = self.project(*mid)
        reach = R * 32 + 2
        left, right, top, bottom = self.bounds([(pcx - reach, pcy - reach), (pcx + reach, pcy + reach)], 0)

        def solid(p):
            if p[2] < floor:
                return False
            q = (p[0] - base[0], p[1] - base[1], p[2] - base[2])
            h = dot(q, A)
            if h < 0 or h > height:
                return False
            rad = (q[0] - h * A[0], q[1] - h * A[1], q[2] - h * A[2])
            return dot(rad, rad) <= radius(h) ** 2

        for py in range(top, bottom + 1):
            for px in range(left, right + 1):
                p0 = self.ray_origin(px, py)
                d = (p0[0] - mid[0], p0[1] - mid[1], p0[2] - mid[2])
                b = dot(d, VIEW)
                disc = b * b - (dot(d, d) - R * R)
                if disc < 0:
                    continue
                t, t1 = -b + math.sqrt(disc), -b - math.sqrt(disc)
                hit = None
                while t >= t1:
                    if solid(add(p0, VIEW, t)):
                        hit = t
                        break
                    t -= step
                if hit is None:
                    continue
                lo, hi = hit, hit + step
                for _ in range(7):
                    m = (lo + hi) / 2
                    if solid(add(p0, VIEW, m)):
                        lo = m
                    else:
                        hi = m
                p = add(p0, VIEW, lo)
                q = (p[0] - base[0], p[1] - base[1], p[2] - base[2])
                h = dot(q, A)
                rad = (q[0] - h * A[0], q[1] - h * A[1], q[2] - h * A[2])
                rho = math.sqrt(dot(rad, rad))
                u = tuple(c / rho for c in rad) if rho > 1e-6 else (0.0, 0.0, 0.0)
                gaps = [(radius(h) - rho, "side"), (height - h, "cap"), (h, "base")]
                part = min(gaps)[1]
                if part == "side":
                    dr = (radius(min(height, h + 0.01)) - radius(max(0.0, h - 0.01))) / 0.02
                    n = _normalize((u[0] - dr * A[0], u[1] - dr * A[1], u[2] - dr * A[2]))
                else:
                    n = A if part == "cap" else (-A[0], -A[1], -A[2])
                self.put(px, py, lo, shade(n, p, h, part, u), oid, ROUND, style)
        return oid

    def rod(self, a, b, width, colors, style, oid=None, depth_bias=0.0):
        """A thin pole between two world points, lit on its screen-left edge."""
        oid = oid or self.new_oid()
        pa, pb = self.project(*a), self.project(*b)
        steps = max(2, int(math.hypot(pb[0] - pa[0], pb[1] - pa[1]) * 3))
        for i in range(steps + 1):
            f = i / steps
            p = tuple(a[k] + (b[k] - a[k]) * f for k in range(3))
            sx, sy = self.project(*p)
            depth = dot(VIEW, p) + depth_bias
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
# Heightfield masses (the ruins renderer). Every block is a rounded plan shape
# with a bevelled, chipped top; blocks merge with max() into a field sampled
# GRID times per unit. Grounded passes paint each sample down to its lowest
# front neighbour; floating passes paint from the underside to the top. Face
# patterns mark courses, boards and grain. `material` remaps the stone tones
# after shading: wood takes the camp crate ramp, soil the ruins soil ramp.
# --------------------------------------------------------------------------

GRID = 48
PX_Z = 1 / KZ        # one screen row of height
JB = 0.034           # bed joint: one row
JH = 0.026           # head joint half width: about one column
ARRIS = 0.038


class Block:
    snap = True  # cut faces are axis planes (see mass_tone)
    material = "stone"
    tone_hook = None

    def __init__(self, x0, x1, y0, y1, z0, z1, salt, corner=0.05, bevel=0.055, chips=0, chip=(0.07, 0.16),
                 chip_depth=(0.05, 0.13), wobble=0.012, tilt=(0.0, 0.0), rough=0.022, moss=0.35, warm=False,
                 pattern=None, round_plan=False, steep=90.0, material=None):
        self.box = (x0, x1, y0, y1)
        self.cx, self.cy, self.hx, self.hy = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
        self.z0, self.z1, self.salt, self.moss, self.warm, self.pattern = z0, z1, salt, moss, warm, pattern
        self.corner = min(corner, self.hx * 0.95, self.hy * 0.95)
        self.bevel, self.wobble, self.tilt, self.rough, self.steep = bevel, wobble, tilt, rough, steep
        self.round_plan = round_plan
        if material:
            self.material = material
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


class TiltBlock(Block):
    """A board or slab whose underside and top follow one tilted plane:
    plane(x, y) = base + slope . ((x, y) - pivot); thickness above it."""

    def __init__(self, x0, x1, y0, y1, base, thick, slope, salt, pivot=(0.0, 0.0), **kw):
        self.base, self.thick, self.slope, self.pivot = base, thick, slope, pivot
        super().__init__(x0, x1, y0, y1, 0.0, base + thick, salt, **kw)

    def plane(self, x, y):
        return self.base + self.slope[0] * (x - self.pivot[0]) + self.slope[1] * (y - self.pivot[1])

    def top(self, x, y):
        return self.plane(x, y) + self.thick + self.rough * (vnoise(x * 6.0, y * 6.0, self.salt + 2) - 0.5)

    def underside(self, x, y):
        return max(0.0, self.plane(x, y))

    def height(self, x, y):
        d = self.edge(x, y)
        if d >= 0:
            return None
        e, top, b = -d, self.top(x, y), self.bevel
        if top < 0.015:
            return None
        z = top - b + math.sqrt(max(0.0, b * b - (b - e) ** 2)) if e < b else top
        for px, py, r, depth in self.chips:
            q = math.hypot(x - px, y - py) / r
            if q < 1:
                z = min(z, top - depth * min(1.0, (1 - q) * 3.0))
        return max(z, self.underside(x, y) + 0.012)


class Cylinder(Block):
    """A horizontal cylinder along world `axis` ('x' or 'y') from a0 to a1, its
    centre line at `cross` on the other axis and at height zc."""

    snap = False

    def __init__(self, axis, a0, a1, cross_at, zc, radius, salt, **kw):
        self.axis, self.zc, self.radius = axis, zc, radius
        lo = max(0.0, zc - radius)
        if axis == "x":
            super().__init__(a0, a1, cross_at - radius, cross_at + radius, lo, zc + radius, salt, **kw)
        else:
            super().__init__(cross_at - radius, cross_at + radius, a0, a1, lo, zc + radius, salt, **kw)

    def local(self, x, y):
        """(along, across, half length) of a plan point."""
        if self.axis == "x":
            return x - self.cx, y - self.cy, self.hx
        return y - self.cy, x - self.cx, self.hy

    def edge(self, x, y):
        a, c, half = self.local(x, y)
        return max(abs(a) - half, abs(c) - self.radius * 0.995)

    def height(self, x, y):
        if self.edge(x, y) >= 0:
            return None
        a, c, half = self.local(x, y)
        s = math.sqrt(max(0.0, self.radius ** 2 - c * c))
        z = self.zc + s + self.rough * (vnoise(x * 7, y * 7, self.salt) - 0.5)
        end = half - abs(a)
        if end < self.bevel:  # rounded rim at both caps
            z -= (self.bevel - end) * 0.9
        for px, py, r, depth in self.chips:
            q = math.hypot(x - px, y - py) / r
            if q < 1:
                z = min(z, self.zc + s - depth * min(1.0, (1 - q) * 3.0))
        return max(z, self.underside(x, y) + 0.01)

    def underside(self, x, y):
        a, c, half = self.local(x, y)
        s = math.sqrt(max(0.0, self.radius ** 2 - c * c))
        return max(0.0, self.zc - s)


class RingStone(Block):
    """One stone of a round course: the annular sector r0..r1, a0..a1 (radians) about `centre`."""

    snap = False

    def __init__(self, centre, r0, r1, a0, a1, z0, z1, salt, **kw):
        self.ox, self.oy, self.r0, self.r1, self.a0, self.a1 = centre[0], centre[1], r0, r1, a0, a1
        super().__init__(centre[0] - r1, centre[0] + r1, centre[1] - r1, centre[1] + r1, z0, z1, salt, **kw)
        rng = random.Random(salt * 31 + 7)
        self.chips = []
        for _ in range(kw.get("chips", 0)):
            a = rng.uniform(a0, a1) if rng.random() < 0.5 else rng.choice((a0, a1))
            r = rng.choice((r0, r1))
            self.chips.append((self.ox + math.cos(a) * r, self.oy + math.sin(a) * r, rng.uniform(*kw.get("chip", (0.07, 0.16))),
                               min(rng.uniform(*kw.get("chip_depth", (0.05, 0.13))), (z1 - z0) * 0.6)))

    def edge(self, x, y):
        dx, dy = x - self.ox, y - self.oy
        rho = math.hypot(dx, dy)
        mid, half = (self.a0 + self.a1) / 2, (self.a1 - self.a0) / 2
        da = (math.atan2(dy, dx) - mid + math.pi) % math.tau - math.pi
        rc = self.corner
        qx = abs(rho - (self.r0 + self.r1) / 2) - ((self.r1 - self.r0) / 2 - rc)
        qy = abs(da) * max(rho, 0.05) - (half * max(rho, 0.05) - rc)
        d = math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - rc
        return d + self.wobble * vnoise(x * 9.0 + 3.1, y * 9.0, self.salt)


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
MATERIALS = {
    "wood": {"Q_HI": "W_HI", "Q_W1": "W_HI", "Q_T1": "W_HI", "Q_T2": "W_HI", "Q_T3": "W1", "Q_L0": "W1", "Q_L1": "W1",
             "Q_L2": "W2", "Q_M": "W2", "Q_S1": "W3", "Q_S2": "W4", "Q_AMB": "W3", "DEEP2": "W4", "DEEP": "W4",
             "M_HI": "M1"},
    "soil": {"Q_HI": "SOIL1", "Q_W1": "SOIL1", "Q_T1": "SOIL1", "Q_T2": "SOIL2", "Q_T3": "SOIL2", "Q_L0": "SOIL1",
             "Q_L1": "SOIL2", "Q_L2": "SOIL3", "Q_M": "SOIL3", "Q_S1": "SOIL3", "Q_S2": "T2", "Q_AMB": "SOIL3",
             "DEEP2": "T2", "DEEP": "T3", "M_HI": "M2", "M1": "M2", "M2": "M3", "M3": "SOIL3"},
}


def mass_tone(f, blocks, i, j, z, k, floating):
    rock = blocks[k]
    idx = j * f.nx + i
    x, y = f.x0 + i / GRID, f.y0 + j / GRID
    zt = f.h[idx]
    zf = f.fl[idx] if floating else 0.0
    if rock.tone_hook:
        hooked = rock.tone_hook(f, i, j, x, y, z, zt)
        if hooked:
            return hooked
    mossy = moss_at(x, y, rock.salt, rock.moss)
    pattern = rock.pattern
    if floating and zf > 0.01 and z - zf < 0.045 and zt - z > 0.03:
        # Underside of a beam or slab.
        gx = (f.floor_at(i + 1, j) - f.floor_at(i - 1, j)) * GRID / 2
        gy = (f.floor_at(i, j + 1) - f.floor_at(i, j - 1)) * GRID / 2
        n = _normalize((gx, gy, -1.0))
        b = lit(n)
        return ("Q_L2" if b > 0.32 else "Q_M" if b > 0.05 else "Q_S2"), RIGHT_FACE
    hx = (f.at(i + 1, j) - f.at(i - 1, j)) * GRID / 2
    hy = (f.at(i, j + 1) - f.at(i, j - 1)) * GRID / 2
    n = _normalize((-hx, -hy, 1.0))
    if n[2] > 0.3 and zt - z < 0.07:
        b = lit(n)
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
    # A wall face. Cut faces are planes: snap their normal to the dominant
    # axis, so a step in a broken top never tilts the face below it.
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
    wooden = all(b.material == "wood" for b in blocks)
    st = style or ({"seam": "W4", "seamGap": 0.03} if wooden else {"seam": "DEEP2", "seamGap": 0.03})
    planes = {}
    for index, (depth, i, j, z, k) in best.items():
        color, face = mass_tone(f, blocks, i, j, z, k, floating)
        mapping = MATERIALS.get(blocks[k].material)
        if mapping:
            color = mapping.get(color, color)
        elif blocks[k].material == "dark":
            color = "DEEP"
        plane = face_plane(f, blocks[k], i, j, z, floating)
        # Neighbouring pixels of one cut face share an id, so seams mark only
        # real steps and overlaps, never the column boundaries inside a face.
        oid = oids[k] if plane is None else planes.setdefault(plane, cv.new_oid())
        cv.put(index % CELL, index // CELL, depth, color, oid, face, st)
    return f


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


def floating_pass(cv, blocks, style=None):
    """Draw blocks that rest on other parts: each column runs from its own underside to its top."""
    draw_mass(cv, blocks, carve(mass_field(blocks), lambda x, y, top, fl: (fl, top)), floating=True, style=style)


# ------------------------------ face patterns ------------------------------

class Beds:
    """Horizontal beds only: post drums, plinth courses, slabs."""

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


class RingFace:
    """Coursed round masonry: bed joints at `levels`, head joints at each course's cut angles."""

    axis = None

    def __init__(self, centre, levels, cuts, salt):
        self.ox, self.oy, self.levels, self.cuts, self.salt = centre[0], centre[1], levels, cuts, salt

    def face(self, along, z, along_is_x, point, b):
        x, y, _ = point
        k = max(0, min(len(self.levels) - 2, bisect.bisect_right(self.levels, z) - 1))
        top_gap, bot_gap = self.levels[k + 1] - z, z - self.levels[k]
        rho = math.hypot(x - self.ox, y - self.oy)
        a = math.atan2(y - self.oy, x - self.ox)
        gap = min(abs((a - c + math.pi) % math.tau - math.pi) for c in self.cuts[k]) * rho
        n = sum(1 for c in self.cuts[k] if ((a - c) % math.tau) < math.pi)
        h = ihash(k * 17 + n, 3, self.salt)
        if top_gap < JB or gap < JH:
            return "joint", 0
        if top_gap < 0.085 and gap < 0.07 and h < 0.4:
            return "joint", 0
        if top_gap < JB + ARRIS:
            return "hi", 0
        if bot_gap < PX_Z:
            return "low", 0
        if vnoise(a * 9.0, z * 6.0, self.salt + 5) > 0.86:
            return "crack", 0
        return "body", int(h * 11) % 4


class Planks:
    """Boards along `axis` ('x' or 'y'): `levels` are the board edges up the face,
    `cuts` the joints across the top. Grain streaks run with the board."""

    def __init__(self, axis, levels, salt, cuts=(), grain=0.78):
        self.axis, self.levels, self.salt, self.cuts, self.grain = axis, levels, salt, cuts, grain

    def top(self, x, y, zt):
        along, across = (x, y) if self.axis == "x" else (y, x)
        if any(abs(across - c) < 0.021 for c in self.cuts):
            return "DEEP2"
        if vnoise(along * 1.8, across * 26.0, self.salt) > self.grain:
            return "Q_T3"
        return None

    def face(self, along, z, along_is_x, point, b):
        k = max(0, min(len(self.levels) - 2, bisect.bisect_right(self.levels, z) - 1))
        top_gap, bot_gap = self.levels[k + 1] - z, z - self.levels[k]
        if top_gap < ARRIS * 0.9:
            return "hi", 0
        if 0 < k and bot_gap < JB * 0.9:
            return "joint", 0
        if bot_gap < PX_Z:
            return "low", 0
        if (self.axis == "x") != along_is_x:
            x, y, _ = point
            across = y if self.axis == "x" else x
            if any(abs(across - c) < 0.02 for c in self.cuts):
                return "joint", 0
            return "body", 3
        g = vnoise(along * 2.2, z * 30.0, self.salt + 3)
        if g > 0.8:
            return "crack", 0
        return "body", int(g * 9) % 4


class Grain:
    """Upright wood: vertical grain on every face, a lit arris under the top."""

    axis = None

    def __init__(self, top_z, salt, bands=()):
        self.top_z, self.salt, self.bands = top_z, salt, bands

    def face(self, along, z, along_is_x, point, b):
        if self.top_z - z < ARRIS:
            return "hi", 0
        if any(abs(z - band) < PX_Z * 0.6 for band in self.bands):
            return "joint", 0
        g = vnoise(along * 30.0, z * 1.6, self.salt)
        if g > 0.8:
            return "crack", 0
        return "body", int(g * 9) % 4


class CapRings:
    """A cylinder lying on its side: plain body; end caps carry a socket, a carved ring and a worn rim."""

    axis = None

    def __init__(self, cylinder, salt, socket=0.06):
        self.c, self.salt, self.socket = cylinder, salt, socket

    def face(self, along, z, along_is_x, point, b):
        x, y, _ = point
        a, c, half = self.c.local(x, y)
        if abs(abs(a) - half) < 0.06:
            r = math.hypot(c, z - self.c.zc)
            if r < self.socket:
                return "recess", 0
            if r > self.c.radius - 0.045:
                return "hi", 0
            if abs(r - self.c.radius * 0.58) < 0.016:
                return "carve", 0
            return "body", 1
        grain = vnoise(x * 4.0, y * 4.0 + z * 6.0, self.salt)
        return ("crack" if grain > 0.86 else "body"), 0


# ------------------------------ masonry helpers ------------------------------

def stone(x0, x1, y0, y1, z0, z1, salt, **kw):
    kw.setdefault("chips", 2)
    return Block(x0, x1, y0, y1, z0, z1, salt, **kw)


def wood(x0, x1, y0, y1, z0, z1, salt, axis="x", cuts=(), levels=None, **kw):
    """A timber or board of the camp crate wood, grain along `axis` ('z' for posts)."""
    kw.setdefault("corner", 0.018)
    kw.setdefault("bevel", 0.022)
    kw.setdefault("wobble", 0.004)
    kw.setdefault("rough", 0.008)
    kw.setdefault("moss", 0.12)
    kw.setdefault("chip", (0.03, 0.06))
    kw.setdefault("chip_depth", (0.015, 0.035))
    pattern = Grain(z1, salt + 1) if axis == "z" else Planks(axis, levels or [z0, z1], salt + 1, cuts=cuts)
    return Block(x0, x1, y0, y1, z0, z1, salt, pattern=pattern, material="wood", **kw)


def tilt_wood(x0, x1, y0, y1, base, thick, slope, salt, axis="x", pivot=(0.0, 0.0), cuts=(), **kw):
    kw.setdefault("corner", 0.018)
    kw.setdefault("bevel", 0.02)
    kw.setdefault("wobble", 0.004)
    kw.setdefault("rough", 0.006)
    kw.setdefault("moss", 0.12)
    return TiltBlock(x0, x1, y0, y1, base, thick, slope, salt, pivot=pivot,
                     pattern=Planks(axis, [-9.0, 9.0], salt + 1, cuts=cuts), material="wood", **kw)


def ring_course(centre, r0, r1, levels, counts, salt, moss=0.5, bevel=0.05, chips=2, hook=None):
    """Top-course stones of round masonry plus the RingFace pattern that marks every course."""
    rng = random.Random(salt)
    cuts = []
    for k, n in enumerate(counts):
        offset = rng.uniform(0, math.tau / n) + (k % 2) * math.tau / (2 * n)
        cuts.append([offset + i * math.tau / n + rng.uniform(-0.12, 0.12) * math.tau / n for i in range(n)])
    pattern = RingFace(centre, levels, cuts, salt + 1)
    top = cuts[-1]
    blocks = []
    for i, a0 in enumerate(top):
        a1 = top[(i + 1) % len(top)]
        if a1 < a0:
            a1 += math.tau
        stone_ = RingStone(centre, r0, r1, a0, a1, 0.0, levels[-1] - rng.uniform(0.0, 0.035), salt * 10 + i,
                           corner=0.03, bevel=bevel, chips=chips, chip=(0.07, 0.13), chip_depth=(0.03, 0.08),
                           tilt=(rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04)), moss=moss, warm=i % 3 == 0,
                           pattern=pattern)
        if hook:
            stone_.tone_hook = hook
        blocks.append(stone_)
    return blocks


def post_stack(cx, cy, half, top, salt, base_half=None, broken=False):
    """A square stone post: a plinth, drums of slightly shifted squared stones, a cap."""
    rng = random.Random(salt)
    base_half = base_half or half + 0.04
    blocks = [Block(cx - base_half, cx + base_half, cy - base_half, cy + base_half, 0.0, 0.16, salt + 1, corner=0.03,
                    bevel=0.035, chips=2, chip_depth=(0.03, 0.06), moss=0.55, pattern=Beds([0.0, 0.16], salt + 2))]
    levels = [0.16]
    while levels[-1] < top - 0.35:
        levels.append(levels[-1] + rng.uniform(0.42, 0.62))
    levels[-1] = top
    beds = Beds(levels, salt + 3)
    for k in range(len(levels) - 1):
        last = k == len(levels) - 2
        ox, oy = rng.uniform(-0.012, 0.012), rng.uniform(-0.012, 0.012)
        blocks.append(Block(cx - half + ox, cx + half + ox, cy - half + oy, cy + half + oy, levels[k], levels[k + 1],
                            salt + 10 + k, corner=0.03, bevel=0.03 if not (broken and last) else 0.02,
                            chips=3 if broken and last else 1, chip=(0.08, 0.16) if broken and last else (0.05, 0.09),
                            chip_depth=(0.12, 0.3) if broken and last else (0.02, 0.05),
                            tilt=(0.2, -0.15) if broken and last else (0.0, 0.0), rough=0.07 if broken and last else 0.015,
                            moss=0.6 if last else 0.3, warm=k % 2 == 1, pattern=beds))
    return blocks


def inner_dark(centre, r_in, top_z, salt):
    """Tone hook: the inner face of a round shaft darkens with depth below its rim."""
    def hook(f, i, j, x, y, z, zt):
        if math.hypot(x - centre[0], y - centre[1]) > r_in + 0.035 or zt - z < 0.05:
            return None
        if zt - z < 0.11:
            return ("Q_M" if ihash(i, j, salt) < 0.5 else "Q_S1"), RIGHT_FACE
        if zt - z < 0.24:
            return "DEEP2", RIGHT_FACE
        return "DEEP", RIGHT_FACE
    return hook


def base_grass(cv, points, salt):
    """A few blades in front of a foot, rooted on its footprint edge."""
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
                color = "V_HI" if f > 0.7 else "V1" if f > 0.3 else "B2"
                cv.put(math.floor(bx + ox + lean * step), math.floor(by - 1 - step), 50.0, color, oid, ROD, {"flat": True})


def top_grass(cv, f, points, salt):
    """Short blades growing out of joints on a top."""
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
                       "V_HI" if t > 0.6 else "V1" if t > 0.25 else "B2", oid, ROD, None)


def ivy_top(cv, f, points, salt, radius=0.18):
    """Leafy clumps lying over a top."""
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


# ------------------------------ plants -------------------------------------

def tuft(cv, sx, sy, width, height, tone, ramp, depth, oid, pointed, style=None):
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
            cv.put(col, row, depth, ramp[max(0, min(5, level))], oid, ROUND, style)


def foliage(cv, clumps, ramp, salt, leaf=(5.5, 4.2), oid=None, wisps=0.0, sprays=0.0, pointed=0.3, lift=0.0, density=1.0,
            bumps=0.14):
    """Leaf clumps: a dark body ellipsoid covered by tufts on its visible hemisphere.
    Tufts take the ramp by sunlight on the clump surface; wisps hang under the
    rim and sprays stick out of the crown, so the silhouette stays lacy."""
    rng = random.Random(salt)
    oid = oid or cv.new_oid()
    tufts = []
    for ci, (cx, cy, cz, rx, ry, rz) in enumerate(clumps):
        cv.ellipsoid((cx, cy, cz), (rx * 0.8, ry * 0.8, rz * 0.78),
                     lambda n, p: ramp[4] if lit(n) > 0.25 else ramp[5], None, oid=oid)
        # Random points on the visible part of a bumpy shell: no rows, no rings.
        area = math.pi * (rx * 32) * (rz * KZ + rx * 16) * 1.25
        count = max(6, round(area / (leaf[0] * leaf[1] * 0.42) * density))
        made = 0
        while made < count:
            th = rng.uniform(-math.pi, math.pi)
            phi = math.asin(rng.uniform(-0.62, 1.0))
            ring = math.cos(phi)
            dx, dy = math.cos(th), math.sin(th)
            facing = (dx + dy) / SQ2 * ring * 0.866 + math.sin(phi) * 0.5
            if facing < -0.25:
                continue
            made += 1
            bump = 1 + bumps * (2 * vnoise(th * 1.7 + ci * 5.3, phi * 2.1, salt + 11) - 1)
            p = (cx + rx * ring * dx * bump, cy + ry * ring * dy * bump, cz + rz * math.sin(phi) * bump)
            n = _normalize((ring * dx / rx, ring * dy / ry, math.sin(phi) / rz))
            b = lit(n) + 1.4 * (bump - 1)  # outer lumps catch light, hollows fall dark
            level = 1 if b > 0.55 else 2 if b > 0.25 else 3 if b > -0.05 else 4
            if n[2] < -0.35:
                level += 1
            if n[2] > 0.8 and b > 0.4:
                level = 1 if rng.random() < 0.8 else 0
            if rng.random() < 0.12:
                level += rng.choice((-1, 1))
            level = max(0 if n[2] > 0.6 else 1, min(5, level))
            sx, sy = cv.project(*p)
            tufts.append((dot(VIEW, p) + 0.3 + lift, sx, sy, leaf[0] * rng.uniform(0.75, 1.2),
                          leaf[1] * rng.uniform(0.75, 1.2), level, rng.random() < pointed))
        # Hanging wisps under the rim and sprays out of the crown.
        for _ in range(round(wisps * (rx + ry) * 6)):
            th = rng.uniform(-0.2, 1.75) + math.pi / 4 - 0.75
            p = (cx + rx * 0.9 * math.cos(th), cy + ry * 0.9 * math.sin(th), cz - rz * rng.uniform(0.25, 0.55))
            sx, sy = cv.project(*p)
            depth = dot(VIEW, p) + 0.35
            length = rng.randint(2, 4)
            for s in range(length):
                cv.put(math.floor(sx), math.floor(sy) + s, depth, ramp[3] if s < length - 1 else ramp[4], oid, ROUND, None)
            cv.put(math.floor(sx) + rng.choice((-1, 1)), math.floor(sy) + length - 1, depth, ramp[2], oid, ROUND, None)
        for _ in range(round(sprays * (rx + ry) * 5)):
            th = rng.uniform(0, math.tau)
            phi = rng.uniform(0.35, 1.2)
            p = (cx + rx * math.cos(phi) * math.cos(th), cy + ry * math.cos(phi) * math.sin(th), cz + rz * math.sin(phi))
            n = _normalize((math.cos(phi) * math.cos(th), math.cos(phi) * math.sin(th), math.sin(phi)))
            if dot(n, VIEW) < -0.1:
                continue
            sx, sy = cv.project(*p)
            depth = dot(VIEW, p) + 0.45
            lean = -1 if math.cos(th) - math.sin(th) > 0 else 1
            tone = ramp[1] if lit(n) > 0.4 else ramp[2]
            for s in range(rng.randint(2, 3)):
                cv.put(math.floor(sx) + lean * (s // 2), math.floor(sy) - s - 1, depth, tone, oid, ROUND, None)
    for depth, sx, sy, w, h, tone, sharp in sorted(tufts):
        tuft(cv, sx, sy, w, h, tone, ramp, depth, oid, sharp)
    return oid


def olive_bark(salt, dead=False):
    """Olive bark: silver-grey where lit, violet-brown in the grooves; dead wood bleached grey."""
    tones = ("Q_T1", "Q_T2", "Q_L1", "Q_L2", "Q_M", "Q_S1") if dead else ("Q_T2", "Q_T3", "T1", "T2", "T3", "T3")

    def shade(n, p):
        b = lit(n)
        grain = vnoise(p[0] * 9 + p[2] * 3.0, p[1] * 9 - p[2] * 3.0, salt) * 0.6 + vnoise(p[2] * 13, p[0] * 6, salt + 1) * 0.4
        level = 0 if b > 0.72 else 1 if b > 0.45 else 2 if b > 0.16 else 3 if b > -0.12 else 4
        if grain > 0.68:
            level += 1
        if not dead and p[2] < 0.3 and grain < 0.32 and b > 0.1:
            return "M2"
        return tones[min(5, level)]
    return shade


def smooth_bark(salt):
    """Fig bark: smooth pale grey."""
    def shade(n, p):
        b = lit(n)
        g = vnoise(p[0] * 12, p[2] * 4 + p[1] * 12, salt)
        level = 0 if b > 0.6 else 1 if b > 0.25 else 2 if b > -0.1 else 3
        if g > 0.8:
            level += 1
        return ("Q_T2", "Q_L1", "Q_L2", "Q_M", "Q_S1")[min(4, level)]
    return shade


def chain(cv, pts, r0, r1, shade, style, oid=None, twig=("T2", "T2", "T2")):
    """A bark limb: ellipsoids along a polyline, radius r0 -> r1; under 0.035u it becomes a 1 px twig."""
    oid = oid or cv.new_oid()
    total = sum(math.dist(a, b) for a, b in zip(pts, pts[1:])) or 1.0
    walked = 0.0
    for a, b in zip(pts, pts[1:]):
        seg = math.dist(a, b)
        t = 0.0
        while t < seg:
            r = r0 + (r1 - r0) * (walked + t) / total
            p = tuple(a[k] + (b[k] - a[k]) * t / seg for k in range(3))
            if r >= 0.035:
                cv.ellipsoid(p, (r, r, r), shade, style, oid=oid)
                t += max(0.018, r * 0.35)
            else:
                q = tuple(a[k] + (b[k] - a[k]) * min(seg, t + 0.03) / seg for k in range(3))
                cv.rod(p, q, 1, twig, {"seam": "T3", "seamGap": 0.12}, oid=oid)
                t += 0.03
        walked += seg
    return oid


def bend(rng, a, b, lift=0.25, jitter=0.06, steps=7):
    """A gently bent limb from a to b (quadratic curve with an upward bow and small kinks)."""
    mid = ((a[0] + b[0]) / 2 + rng.uniform(-0.12, 0.12), (a[1] + b[1]) / 2 + rng.uniform(-0.12, 0.12),
           (a[2] + b[2]) / 2 + lift)
    pts = []
    for s in range(steps + 1):
        t = s / steps
        p = tuple((1 - t) ** 2 * a[k] + 2 * (1 - t) * t * mid[k] + t * t * b[k] for k in range(3))
        if 0 < s < steps:
            p = (p[0] + rng.uniform(-jitter, jitter), p[1] + rng.uniform(-jitter, jitter), p[2] + rng.uniform(-jitter, jitter) * 0.5)
        pts.append(p)
    return pts


def twisted_strands(rng, base, height, lean, count, spread, radius, twist, flare=1.6, steps=12, phase=0.0, taper=0.72):
    """Cords of an olive trunk: strands spiralling round a leaning axis, splayed at the foot."""
    strands = []
    for k in range(count):
        phi = phase + k * math.tau / count + rng.uniform(-0.25, 0.25)
        wob = rng.uniform(0, math.tau)
        pts = []
        for s in range(steps + 1):
            f = s / steps
            z = height * f
            ax = base[0] + lean[0] * f * f * height + 0.025 * math.sin(f * 6 + wob)
            ay = base[1] + lean[1] * f * f * height + 0.025 * math.cos(f * 5 + wob)
            a = phi + twist * f
            off = spread * (flare - (flare - 1) * min(1.0, f * 2.4)) * (1 - 0.3 * f)
            pts.append((ax + math.cos(a) * off, ay + math.sin(a) * off, z))
        strands.append((pts, radius * rng.uniform(1.0, 1.15), radius * taper))
    return strands


def roots(cv, rng, centre, radius, count, shade, reach=(1.2, 1.8), lift=0.1):
    oid = cv.new_oid()
    for k in range(count):
        a = k * math.tau / count + rng.uniform(-0.35, 0.35)
        far = radius * rng.uniform(*reach)
        for s in range(10):
            f = s / 9
            p = (centre[0] + math.cos(a) * far * f, centre[1] + math.sin(a) * far * f, lift * (1 - f))
            r = radius * 0.55 * (1 - f) + 0.035
            cv.ellipsoid(p, (r, r, r * 0.7), shade, {"seam": "T3", "seamGap": 0.12}, oid=oid, floor=0.0)


def ground_patch(cv, centre, rx, ry, salt, colors=("M3", "B3", "T2"), rough=0.35):
    """Flat shade and litter under a plant (no outline)."""
    oid = cv.new_oid()
    px, py = cv.project(centre[0], centre[1], 0)
    for row in range(math.floor(py - 16 * ry) - 2, math.ceil(py + 16 * ry) + 2):
        for col in range(math.floor(px - 32 * rx) - 2, math.ceil(px + 32 * rx) + 2):
            dx, dy = (col + 0.5 - px) / (32 * rx), (row + 0.5 - py) / (16 * ry)
            edge = 1.0 + (ihash(col // 2, row, salt) - 0.5) * rough
            d = dx * dx + dy * dy
            if d <= edge:
                tone = colors[1] if d < 0.3 else colors[2] if ihash(col, row, salt + 1) < 0.1 else colors[0]
                cv.put(col, row, -9.0, tone, oid, TOP, {"flat": True})


def bark_style():
    return {"seam": "T3", "seamGap": 0.12}


def olive_crown(cv, rng, top, clumps, limb_r, shade, salt, leaf=(3.8, 3.0), wisps=0.7, sprays=2.2, ramp=OLIVE,
                twigs=3):
    """Limbs from the trunk head into every clump, twigs inside, then the leaf clumps."""
    style = bark_style()
    for n, (cx, cy, cz, rx, ry, rz) in enumerate(clumps):
        start = top[n % len(top)]
        end = (cx + rng.uniform(-0.1, 0.1), cy + rng.uniform(-0.1, 0.1), cz - rz * 0.35)
        chain(cv, bend(rng, start, end, lift=0.12), limb_r, limb_r * 0.5, shade, style)
        for _ in range(twigs):
            tip = (cx + rng.uniform(-rx, rx) * 0.7, cy + rng.uniform(-ry, ry) * 0.7, cz + rng.uniform(-0.1, 0.3) * rz)
            chain(cv, bend(rng, end, tip, lift=0.05, steps=4), limb_r * 0.45, 0.02, shade, style)
    # Small tufts: the olive's narrow leaves give a finer texture than the camp bushes.
    return foliage(cv, clumps, ramp, salt, leaf=leaf, wisps=wisps, sprays=sprays, pointed=0.45, bumps=0.3)


def fruit(cv, rng, clumps, count, colors, salt):
    """Olives hanging in the canopy: two-pixel dark drops under the leaves."""
    oid = cv.new_oid()
    for _ in range(count):
        cx, cy, cz, rx, ry, rz = clumps[rng.randrange(len(clumps))]
        th = rng.uniform(-0.5, 2.0)
        p = (cx + rx * 0.95 * math.cos(th), cy + ry * 0.95 * math.sin(th), cz - rz * rng.uniform(0.0, 0.45))
        n = _normalize((math.cos(th), math.sin(th), -0.2))
        if dot(n, VIEW) < 0.1:
            continue
        sx, sy = cv.project(*p)
        depth = dot(VIEW, p) + 0.8
        cv.put(math.floor(sx), math.floor(sy), depth, colors[0], oid, ROUND, None)
        cv.put(math.floor(sx), math.floor(sy) + 1, depth, colors[1], oid, ROUND, None)


# ------------------------------ olive trees ---------------------------------

def draw_olive(cv, salt, height, lean, strands, spread, radius, twist, clumps, limb_r=0.075, root_r=0.24, root_n=5,
               patch=(0.55, 0.42), heads=None, olives=10, leaf=(3.8, 3.0)):
    rng = random.Random(salt)
    shade = olive_bark(salt + 1)
    ground_patch(cv, (0.0, 0.0), patch[0], patch[1], salt + 2)
    roots(cv, rng, (0.0, 0.0), root_r, root_n, shade)
    trunk = twisted_strands(rng, (0.0, 0.0), height, lean, strands, spread, radius, twist)
    for pts, r0, r1 in trunk:
        chain(cv, pts, r0, r1, shade, bark_style())
    head = heads or [pts[-1] for pts, _, _ in trunk]
    olive_crown(cv, rng, head, clumps, limb_r, shade, salt + 5, leaf=leaf)
    fruit(cv, rng, clumps, olives, ("T3", "T2"), salt + 7)


def draw_olive_a(cv):
    """Three cords twisting into one trunk, a rounded, gappy crown of separate masses."""
    draw_olive(cv, 2101, 1.35, (0.12, -0.08), 3, 0.13, 0.12, 2.6,
               [(0.72, -0.38, 2.3, 0.5, 0.5, 0.34), (-0.5, 0.62, 2.2, 0.5, 0.5, 0.33), (0.08, 0.06, 2.9, 0.56, 0.56, 0.34),
                (0.78, 0.48, 1.95, 0.4, 0.4, 0.27), (-0.5, -0.45, 2.7, 0.44, 0.44, 0.3), (0.2, 0.8, 2.55, 0.38, 0.38, 0.27),
                (0.55, 0.1, 2.55, 0.36, 0.36, 0.26)])


def draw_olive_b(cv):
    """One stout trunk leaning toward the light, a wide, low, lopsided crown."""
    draw_olive(cv, 2201, 1.25, (0.42, 0.14), 3, 0.12, 0.13, 1.9,
               [(1.1, 0.0, 2.05, 0.5, 0.5, 0.31), (0.4, 0.62, 2.15, 0.5, 0.5, 0.31), (0.62, -0.62, 2.45, 0.46, 0.46, 0.3),
                (0.15, -0.1, 2.75, 0.52, 0.52, 0.32), (-0.42, 0.6, 2.4, 0.4, 0.4, 0.27), (1.25, 0.65, 1.72, 0.34, 0.34, 0.23),
                (0.75, 0.25, 2.6, 0.4, 0.4, 0.26)],
               patch=(0.6, 0.45), root_n=4)


def draw_olive_c(cv):
    """Two trunks split from the foot in a V, each with its own crown."""
    rng = random.Random(2301)
    shade = olive_bark(2302)
    ground_patch(cv, (0.0, 0.0), 0.6, 0.45, 2303)
    roots(cv, rng, (0.0, 0.0), 0.28, 6, shade)
    heads = []
    for base, lean, h, twist in (((0.06, -0.08), (0.42, -0.3), 1.45, 2.2), ((-0.07, 0.08), (-0.3, 0.42), 1.22, -2.0)):
        trunk = twisted_strands(rng, (base[0], base[1]), h, lean, 2, 0.08, 0.095, twist, flare=1.3)
        for pts, r0, r1 in trunk:
            chain(cv, pts, r0, r1, shade, bark_style())
        heads.append(trunk[0][0][-1])
    clumps = [(0.82, -0.68, 2.65, 0.5, 0.5, 0.33), (0.28, -0.28, 3.12, 0.52, 0.52, 0.33), (1.02, -0.05, 2.2, 0.42, 0.42, 0.28),
              (-0.68, 0.78, 2.4, 0.48, 0.48, 0.32), (-0.22, 0.32, 2.78, 0.46, 0.46, 0.3), (-0.28, 1.1, 2.0, 0.38, 0.38, 0.25),
              (0.45, 0.48, 2.35, 0.36, 0.36, 0.25)]
    olive_crown(cv, rng, [heads[0], heads[0], heads[0], heads[1], heads[1], heads[1], heads[0]], clumps, 0.07, shade, 2305)
    fruit(cv, rng, clumps, 12, ("T3", "T2"), 2307)


def draw_olive_old(cv):
    """A centuries-old olive: a ring of massive cords round a hollow that opens
    toward the viewer, buttress roots, three heavy limbs, a broad crown."""
    rng = random.Random(2401)
    shade = olive_bark(2402)
    ground_patch(cv, (0.0, 0.0), 0.95, 0.75, 2403)
    roots(cv, rng, (0.0, 0.0), 0.42, 7, shade, reach=(1.15, 1.55), lift=0.16)
    # The hollow: a dark core the front cords leave open.
    core = cv.new_oid()
    for s in range(11):
        z = 0.05 + s * 0.1
        cv.ellipsoid((0.02, 0.02, z), (0.24, 0.24, 0.12), lambda n, p: "DEEP" if p[2] < 0.75 else "T3", None, oid=core)
    cords = []
    gap_mid = math.pi / 4  # toward the camera
    for k in range(6):
        phi = gap_mid + 1.05 + k * (math.tau - 2.1) / 5 + rng.uniform(-0.08, 0.08)
        wob = rng.uniform(0, math.tau)
        pts = []
        for s in range(13):
            f = s / 12
            z = 1.5 * f
            a = phi + 0.45 * f
            off = 0.36 * (1.45 - 0.45 * min(1.0, f * 2.2)) * (1 - 0.25 * f)
            pts.append((math.cos(a) * off + 0.03 * math.sin(f * 6 + wob), math.sin(a) * off + 0.03 * math.cos(f * 5 + wob), z))
        cords.append((pts, rng.uniform(0.17, 0.2), 0.13))
    for pts, r0, r1 in cords:
        chain(cv, pts, r0, r1, shade, bark_style())
    # Lips of the hollow: a darker rim pixel line follows from the seams.
    limbs = [((0.05, -0.05, 1.45), (0.85, -0.6, 2.3)), ((-0.05, 0.05, 1.45), (-0.65, 0.75, 2.25)), ((0.0, 0.0, 1.5), (-0.2, -0.35, 2.55))]
    heads = []
    for a, b in limbs:
        pts = bend(rng, a, b, lift=0.1, jitter=0.05)
        chain(cv, pts, 0.2, 0.11, shade, bark_style())
        heads.append(b)
    clumps = [(1.15, -0.8, 2.75, 0.56, 0.56, 0.36), (0.55, -0.2, 3.45, 0.6, 0.6, 0.36), (-0.1, -0.9, 3.25, 0.56, 0.56, 0.35),
              (-0.85, 1.0, 2.7, 0.56, 0.56, 0.35), (-0.4, 0.38, 3.55, 0.58, 0.58, 0.36), (1.0, 0.32, 2.55, 0.46, 0.46, 0.3),
              (0.28, 1.05, 2.45, 0.46, 0.46, 0.3), (-1.0, -0.22, 2.95, 0.44, 0.44, 0.3), (1.45, -0.05, 2.15, 0.36, 0.36, 0.24),
              (0.15, 0.4, 2.9, 0.4, 0.4, 0.27)]
    head_of = [heads[0], heads[0], heads[2], heads[1], heads[2], heads[0], heads[1], heads[2], heads[0], heads[1]]
    olive_crown(cv, rng, head_of, clumps, 0.09, shade, 2405, twigs=4)
    fruit(cv, rng, clumps, 16, ("T3", "T2"), 2407)
    base_grass(cv, [(0.62, 0.15), (0.2, 0.62), (0.55, -0.4)], 2409)


def draw_olive_dead(cv):
    """A dead olive: bleached, split cords, bare forked limbs snapped short, a few dry leaves still hanging."""
    rng = random.Random(2501)
    shade = olive_bark(2502, dead=True)
    ground_patch(cv, (0.0, 0.0), 0.45, 0.35, 2503, colors=("M3", "SOIL3", "T2"))
    roots(cv, rng, (0.0, 0.0), 0.24, 5, shade)
    trunk = twisted_strands(rng, (0.0, 0.0), 1.25, (-0.14, 0.12), 3, 0.11, 0.1, 2.6, flare=1.5)
    for pts, r0, r1 in trunk:
        chain(cv, pts, r0, r1, shade, bark_style())
    heads = [pts[-1] for pts, _, _ in trunk]
    style = bark_style()
    tips = [(0.72, -0.38, 2.15), (-0.6, 0.48, 2.3), (0.1, -0.2, 2.6), (0.6, 0.5, 1.75), (-0.35, -0.5, 2.05)]
    for n, tip in enumerate(tips):
        pts = bend(rng, heads[n % len(heads)], tip, lift=0.14)
        chain(cv, pts, 0.085, 0.035, shade, style)
        for _ in range(2 if n != 2 else 0):
            twig = (tip[0] + rng.uniform(-0.3, 0.3), tip[1] + rng.uniform(-0.3, 0.3), tip[2] + rng.uniform(0.12, 0.4))
            chain(cv, bend(rng, tip, twig, lift=0.04, steps=4), 0.035, 0.02, shade, style, twig=("Q_L2", "Q_L2", "Q_L2"))
    # The top limb snapped: a pale splintered end over dark heartwood.
    hx, hy = cv.project(0.1, -0.2, 2.6)
    hole = cv.new_oid()
    for dx, dy, tone in ((0, 0, "Q_HI"), (1, 0, "Q_T1"), (-1, 1, "Q_T1"), (0, 1, "DEEP"), (1, 1, "DEEP"), (0, 2, "T3")):
        cv.put(math.floor(hx) + dx, math.floor(hy) + dy - 1, 60.0, tone, hole, ROUND, None)
    oid = cv.new_oid()
    for tip in tips[:2] + tips[3:]:
        for _ in range(5):
            p = (tip[0] + rng.uniform(-0.18, 0.18), tip[1] + rng.uniform(-0.18, 0.18), tip[2] + rng.uniform(-0.05, 0.2))
            sx, sy = cv.project(*p)
            depth = dot(VIEW, p) + 0.5
            for st in range(rng.randint(2, 3)):
                cv.put(math.floor(sx), math.floor(sy) + st, depth, ("Y1", "Y2", "T1")[st], oid, ROUND, None)
    base_grass(cv, [(0.3, 0.1), (0.05, 0.3)], 2509)


def draw_fig_young(cv):
    """A young fig: smooth grey stems, broad fresh leaves in a low round crown."""
    rng = random.Random(2601)
    shade = smooth_bark(2602)
    ground_patch(cv, (0.0, 0.0), 0.38, 0.3, 2603)
    style = bark_style()
    heads = []
    for k, (tip, r0) in enumerate((((0.22, -0.12, 0.85), 0.065), ((-0.15, 0.2, 0.78), 0.055), ((0.05, 0.05, 1.0), 0.05))):
        pts = bend(rng, (0.03 * k - 0.03, 0.02 - 0.02 * k, 0.0), tip, lift=0.05, jitter=0.03, steps=6)
        chain(cv, pts, r0, r0 * 0.7, shade, style)
        heads.append(tip)
    clumps = [(0.42, -0.25, 1.3, 0.4, 0.4, 0.3), (-0.3, 0.4, 1.25, 0.38, 0.38, 0.28), (0.05, 0.05, 1.58, 0.45, 0.45, 0.3),
              (0.4, 0.38, 1.15, 0.3, 0.3, 0.22)]
    for n, (cx, cy, cz, rx, ry, rz) in enumerate(clumps):
        chain(cv, bend(rng, heads[n % 3], (cx, cy, cz - rz * 0.4), lift=0.05, steps=4), 0.04, 0.025, shade, style)
    foliage(cv, clumps, FRESH, 2605, leaf=(8.0, 6.0), wisps=0.3, sprays=0.3, pointed=0.5)
    fruit(cv, rng, clumps, 5, ("T2", "T3"), 2607)
    base_grass(cv, [(0.25, 0.05), (0.0, 0.26)], 2609)


# ------------------------------ well and press ------------------------------

def bucket_shade(n, p, h, part, u, height=0.2):
    b = lit(n)
    if part == "cap":
        return "DEEP" if math.hypot(*u[:2]) < 2 else "DEEP"
    if h < 0.035 or abs(h - height * 0.62) < 0.022:
        return "Q_L2" if b > 0.3 else "Q_M" if b > 0.0 else "Q_S1"
    stave = math.atan2(u[1], u[0]) * 6 / math.pi
    if abs(stave - round(stave)) < 0.12:
        return "W3"
    return "W_HI" if b > 0.55 else "W1" if b > 0.2 else "W2" if b > -0.15 else "W3"


def draw_well(cv):
    """A round well head of two courses (r 0.8u), a dark shaft, a wooden frame
    with a little gable roof, a windlass and a hanging bucket."""
    levels = [0.0, 0.36, 0.72]
    ring = ring_course((0.0, 0.0), 0.52, 0.8, levels, (7, 7), 2701, moss=0.55,
                       hook=inner_dark((0.0, 0.0), 0.52, 0.72, 2702))
    f = mass_field(ring)
    draw_mass(cv, ring, f)
    draw_mass(cv, [Block(-0.53, 0.53, -0.53, 0.53, 0.0, 0.02, 2703, round_plan=True, bevel=0.0, wobble=0.0,
                         material="dark")])
    ivy_top(cv, f, [(0.55, 0.42), (-0.62, -0.3)], 2705, radius=0.14)
    # Frame: two posts on the ring along world y, a crossbeam, a gable roof.
    posts = [wood(-0.065, 0.065, y - 0.065, y + 0.065, 0.0, 2.02, 2710 + k, axis="z", chips=1) for k, y in enumerate((-0.66, 0.66))]
    draw_mass(cv, posts)
    floating_pass(cv, [wood(-0.075, 0.075, -0.86, 0.86, 1.92, 2.04, 2713, axis="y", chips=2)])
    roof = [tilt_wood(0.0, 0.36, -0.92, 0.92, 2.3, 0.05, (-0.62, 0.0), 2714, axis="x", cuts=(-0.56, -0.2, 0.18, 0.55),
                      chips=2),
            tilt_wood(-0.36, 0.0, -0.92, 0.92, 2.3, 0.05, (0.62, 0.0), 2715, axis="x", cuts=(-0.5, -0.12, 0.25, 0.6),
                      chips=1)]
    for board in roof:
        floating_pass(cv, [board])
    # Windlass drum with rope, and its crank outside the +y post.
    drum = Cylinder("y", -0.58, 0.58, 0.0, 1.45, 0.075, 2716, bevel=0.015, rough=0.004, moss=0.05, material="wood",
                    pattern=Grain(9.0, 2717))
    floating_pass(cv, [drum])
    rope = cv.new_oid()
    for k in range(9):
        y = -0.18 + k * 0.045
        cv.rod((0.07, y, 1.45 - 0.05), (0.0, y + 0.02, 1.53), 1, ("Y3", "Y1", "Y1"), None, oid=rope, depth_bias=0.05)
    cv.rod((0.0, 0.73, 1.45), (0.0, 0.84, 1.45), 2, ("T1", "T2", "T2"), None)
    cv.rod((0.0, 0.84, 1.45), (0.12, 0.84, 1.3), 2, ("T1", "T2", "T2"), None)
    # The bucket hangs over the shaft from the drum.
    cv.rod((0.06, 0.0, 1.39), (0.06, 0.0, 1.1), 1, ("Y1", "Y1", "Y1"), None, depth_bias=0.02)
    cv.rod((0.06, -0.11, 1.0), (0.06, 0.0, 1.1), 1, ("Q_M", "Q_M", "Q_M"), None)
    cv.rod((0.06, 0.11, 1.0), (0.06, 0.0, 1.1), 1, ("Q_M", "Q_M", "Q_M"), None)
    cv.lathe((0.06, 0.0, 0.8), (0, 0, 1), 0.2, lambda h: 0.1 + 0.025 * h / 0.2, bucket_shade, {"seam": "W4", "seamGap": 0.05})
    base_grass(cv, [(0.72, 0.3), (0.3, 0.72), (0.78, -0.12)], 2719)


def draw_olive_press(cv):
    """An olive mill: a round stone basin, a central stone pivot with a timber
    post, a millstone on edge in the trough and a wooden axle beam through it."""
    rim = ring_course((0.0, 0.0), 0.6, 0.85, [0.0, 0.25, 0.5], (6, 6), 2801, moss=0.5,
                      hook=inner_dark((0.0, 0.0), 0.6, 0.5, 2802))
    f = mass_field(rim)
    draw_mass(cv, rim, f)
    floor_blocks = [Block(-0.61, 0.61, -0.61, 0.61, 0.0, 0.28, 2803, round_plan=True, bevel=0.02, moss=0.25, rough=0.02,
                          pattern=Beds([0.0, 0.28], 2804))]
    draw_mass(cv, floor_blocks)
    pivot = [Block(-0.19, 0.19, -0.19, 0.19, 0.0, 0.62, 2805, round_plan=True, bevel=0.05, chips=2, moss=0.5,
                   pattern=Beds([0.0, 0.28, 0.45, 0.62], 2806))]
    draw_mass(cv, pivot)
    draw_mass(cv, [wood(-0.07, 0.07, -0.07, 0.07, 0.6, 1.42, 2807, axis="z", chips=1)])
    wheel = Cylinder("x", 0.2, 0.46, 0.0, 0.28 + 0.4, 0.4, 2808, bevel=0.035, chips=3, chip=(0.08, 0.14),
                     chip_depth=(0.03, 0.06), moss=0.3, warm=True)
    wheel.pattern = CapRings(wheel, 2809, socket=0.075)
    floating_pass(cv, [wheel])
    beam = wood(-0.42, 0.78, -0.055, 0.055, 0.63, 0.74, 2810, axis="x", chips=2)
    floating_pass(cv, [beam])
    # Dry olives and leaves left in the trough.
    oid = cv.new_oid()
    rng = random.Random(2811)
    for _ in range(26):
        a, r = rng.uniform(0, math.tau), rng.uniform(0.25, 0.55)
        x, y = math.cos(a) * r, math.sin(a) * r
        sx, sy = cv.project(x, y, 0.29)
        depth = dot(VIEW, (x, y, 0.29)) + 0.01
        tone = ("T3", "T2") if rng.random() < 0.7 else ("Y2", "Y1")
        cv.put(math.floor(sx), math.floor(sy), depth, tone[0], oid, TOP, None)
        cv.put(math.floor(sx) + 1, math.floor(sy), depth, tone[1], oid, TOP, None)
    top_grass(cv, f, [(0.0, 0.72), (-0.7, -0.1)], 2813)
    base_grass(cv, [(0.78, 0.2), (0.25, 0.8), (0.7, -0.45)], 2815)


# ------------------------------ pergolas ------------------------------------

def swapper(axis):
    if axis == "x":
        return (lambda x, y: (x, y)), (lambda x0, x1, y0, y1: (x0, x1, y0, y1)), (lambda a, b: (a, b))
    return (lambda x, y: (y, x)), (lambda x0, x1, y0, y1: (y0, y1, x0, x1)), (lambda a, b: (b, a))


POST_X, POST_Y, POST_HALF, POST_TOP = 1.25, 0.62, 0.19, 2.62
BEAM_TOP, RAFTER_TOP = 2.8, 2.92


def grape_leaves(cv, rng, path, salt, density=1.0, size=(6.5, 5.0), oid=None, bunches=0, hang=0.0, spread=0.12):
    """Grape leaves along a world-space polyline (a cane on a beam), with
    festoons hanging under it and a few dark bunches."""
    oid = oid or cv.new_oid()
    tufts = []
    total = sum(math.dist(a, b) for a, b in zip(path, path[1:]))
    count = max(2, round(total * 14 * density))
    for _ in range(count):
        s = rng.uniform(0, total)
        for a, b in zip(path, path[1:]):
            seg = math.dist(a, b)
            if s <= seg:
                f = s / seg
                p = tuple(a[k] + (b[k] - a[k]) * f for k in range(3))
                break
            s -= seg
        p = (p[0] + rng.uniform(-spread, spread), p[1] + rng.uniform(-spread, spread), p[2] + rng.uniform(-0.02, 0.1))
        if hang and rng.random() < 0.35:
            p = (p[0], p[1], p[2] - rng.uniform(0.05, hang))
        sx, sy = cv.project(*p)
        up = p[2] - min(q[2] for q in path)
        level = 1 if rng.random() < 0.45 else 2 if rng.random() < 0.6 else 3
        if up < -0.05:
            level += 1
        tufts.append((dot(VIEW, p) + 0.3, sx, sy, size[0] * rng.uniform(0.8, 1.2), size[1] * rng.uniform(0.8, 1.2), level))
    for depth, sx, sy, w, h, tone in sorted(tufts):
        tuft(cv, sx, sy, w, h, tone, FRESH, depth, oid, False)
    for _ in range(bunches):
        a, b = path[rng.randrange(len(path) - 1)], path[-1]
        p = tuple(a[k] + (b[k] - a[k]) * rng.uniform(0.1, 0.9) for k in range(3))
        sx, sy = cv.project(p[0], p[1], p[2] - 0.08)
        depth = dot(VIEW, p) + 0.5
        for dy, row in enumerate(("##", "###", "##", "#")):
            for dx, _ in enumerate(row):
                tone = "Q_M" if dx == 0 and dy < 2 else "Q_S2" if (dx + dy) % 2 else "DEEP2"
                cv.put(math.floor(sx) + dx - 1, math.floor(sy) + dy, depth, tone, oid, ROUND, None)
    return oid


def vine_stem(cv, rng, foot, up_to, salt, wraps=1.2, radius=0.045):
    """A woody grapevine stem spiralling up a post."""
    shade = olive_bark(salt)
    pts = []
    for s in range(14):
        f = s / 13
        a = wraps * math.tau * f + rng.uniform(-0.2, 0.2)
        pts.append((foot[0] + math.cos(a) * 0.16, foot[1] + math.sin(a) * 0.16, up_to * f))
    chain(cv, pts, radius, radius * 0.7, shade, bark_style())


def draw_pergola(cv, axis):
    """Four stone posts, two timber beams along the long axis, rafters across them, grapevines over the top."""
    p, b, s = swapper(axis)
    salt = 2901 if axis == "x" else 3001
    rng = random.Random(salt)
    for k, (px, py) in enumerate(((POST_X, POST_Y), (POST_X, -POST_Y), (-POST_X, POST_Y), (-POST_X, -POST_Y))):
        cx, cy = p(px, py)
        draw_mass(cv, post_stack(cx, cy, POST_HALF - 0.04, POST_TOP, salt + 10 * k, base_half=POST_HALF))
    beam_axis = "x" if axis == "x" else "y"
    for k, side in enumerate((POST_Y, -POST_Y)):
        floating_pass(cv, [wood(*b(-1.58, 1.58, side - 0.075, side + 0.075), POST_TOP, BEAM_TOP, salt + 50 + k, axis=beam_axis,
                                chips=3)])
    rafter_axis = "y" if axis == "x" else "x"
    for k, a in enumerate((-1.38, -0.82, -0.27, 0.28, 0.83, 1.38)):
        drop = 0.0 if k != 2 else 0.0
        floating_pass(cv, [wood(*b(a - 0.045, a + 0.045, -0.9, 0.9), BEAM_TOP - drop, RAFTER_TOP - drop, salt + 60 + k,
                                axis=rafter_axis, chips=2)])
    # Grapevines: stems up two posts, canes along the beams, leaves over the rafters.
    for (px, py) in ((POST_X, -POST_Y), (-POST_X, POST_Y)):
        fx, fy = p(px + 0.18 * math.copysign(1, px), py)
        vine_stem(cv, rng, (fx, fy), BEAM_TOP, salt + 70)
    oid = cv.new_oid()
    for side, a0, a1 in ((-POST_Y, -1.5, 1.1), (POST_Y, -1.1, 1.5)):
        path = [(*p(a, side), BEAM_TOP + 0.04) for a in (a0, (a0 + a1) / 2, a1)]
        grape_leaves(cv, rng, path, salt + 80, density=1.3, oid=oid, bunches=2, hang=0.35)
    for a in (-1.1, -0.55, 0.0, 0.55, 1.1):
        path = [(*p(a + rng.uniform(-0.1, 0.1), y), RAFTER_TOP + 0.02) for y in (-0.6, 0.0, 0.6)]
        grape_leaves(cv, rng, path, salt + 90, density=0.55, oid=oid, spread=0.16)
    base_grass(cv, [p(POST_X + 0.15, POST_Y + 0.1), p(-POST_X, POST_Y + 0.16), p(POST_X + 0.16, -POST_Y)], salt + 95)


def draw_pergola_broken(cv, axis):
    """The front post snapped to a stump; its beam slants down onto it, rafters
    fell or hang from the back beam; the vines overgrow what still stands."""
    p, b, s = swapper(axis)
    salt = 3101 if axis == "x" else 3201
    rng = random.Random(salt)
    for k, (px, py) in enumerate(((POST_X, -POST_Y), (-POST_X, POST_Y), (-POST_X, -POST_Y))):
        cx, cy = p(px, py)
        draw_mass(cv, post_stack(cx, cy, POST_HALF - 0.04, POST_TOP, salt + 10 * k, base_half=POST_HALF))
    cx, cy = p(POST_X, POST_Y)
    draw_mass(cv, post_stack(cx, cy, POST_HALF - 0.04, 0.62, salt + 40, base_half=POST_HALF, broken=True))
    beam_axis = "x" if axis == "x" else "y"
    rafter_axis = "y" if axis == "x" else "x"
    # Back beam still on its posts.
    floating_pass(cv, [wood(*b(-1.58, 1.58, -POST_Y - 0.075, -POST_Y + 0.075), POST_TOP, BEAM_TOP, salt + 50,
                            axis=beam_axis, chips=3)])
    # Front beam: from the standing post top down onto the stump.
    slope = (0.6 - POST_TOP) / (2 * POST_X)
    floating_pass(cv, [tilt_wood(*b(-1.58, 1.4, POST_Y - 0.075, POST_Y + 0.075), POST_TOP, BEAM_TOP - POST_TOP,
                                 s(slope, 0.0), salt + 51, axis=beam_axis, pivot=p(-POST_X, 0.0), chips=3)])
    # Two rafters still bridge, tilted onto the slanting beam.
    for k, a in enumerate((-1.38, -0.82)):
        front = POST_TOP + slope * (a + POST_X) + (BEAM_TOP - POST_TOP)
        rs = (front - BEAM_TOP) / (2 * POST_Y)
        floating_pass(cv, [tilt_wood(*b(a - 0.045, a + 0.045, -0.9, 0.9), BEAM_TOP, 0.12, s(0.0, rs), salt + 60 + k,
                                     axis=rafter_axis, pivot=p(0.0, -POST_Y), chips=2)])
    # One rafter hangs from the back beam to the ground; two lie in the grass.
    floating_pass(cv, [tilt_wood(*b(0.25, 0.34, -0.9, 0.62), BEAM_TOP, 0.1, s(0.0, -BEAM_TOP / 1.45), salt + 64,
                                 axis=rafter_axis, pivot=p(0.0, -0.83), chips=2)])
    draw_mass(cv, [wood(*b(-0.35, 1.15, 0.12, 0.21), 0.0, 0.09, salt + 65, axis=beam_axis, chips=2, moss=0.3),
                   wood(*b(0.75, 0.84, -0.55, 0.62), 0.0, 0.09, salt + 66, axis=rafter_axis, chips=2, moss=0.3)])
    # Fallen drums of the snapped post.
    draw_mass(cv, [Block(*b(0.82, 1.08, 0.2, 0.44), 0.0, 0.22, salt + 67, corner=0.03, bevel=0.04, chips=2,
                         tilt=s(0.12, -0.1), moss=0.6, pattern=Beds([0.0, 0.22], salt + 68))])
    oid = cv.new_oid()
    for (px, py) in ((POST_X, -POST_Y), (-POST_X, POST_Y), (-POST_X, -POST_Y)):
        fx, fy = p(px + 0.18 * math.copysign(1, px), py)
        vine_stem(cv, rng, (fx, fy), BEAM_TOP, salt + 70)
    path = [(*p(a, -POST_Y), BEAM_TOP + 0.04) for a in (-1.5, -0.2, 1.4)]
    grape_leaves(cv, rng, path, salt + 80, density=1.6, oid=oid, bunches=2, hang=0.6)
    slant = [(*p(a, POST_Y), POST_TOP + slope * (a + POST_X) + 0.24) for a in (-1.4, -0.4, 0.6, 1.2)]
    grape_leaves(cv, rng, slant, salt + 81, density=1.5, oid=oid, bunches=1, hang=0.3)
    for a in (-1.38, -0.82):
        path = [(*p(a, y), BEAM_TOP + 0.02 - 0.1 * (y + POST_Y)) for y in (-0.6, 0.0, 0.5)]
        grape_leaves(cv, rng, path, salt + 90, density=0.8, oid=oid, spread=0.15)
    ground = [(*p(a, POST_Y + 0.1), 0.06) for a in (0.2, 0.8, 1.3)]
    grape_leaves(cv, rng, ground, salt + 91, density=1.4, oid=oid, spread=0.2)
    base_grass(cv, [p(POST_X + 0.15, POST_Y + 0.1), p(-POST_X, POST_Y + 0.16), p(0.5, 0.75)], salt + 95)


# ------------------------------ trellises and herbs --------------------------

def draw_trellis(cv, axis):
    """A low vine fence: three posts, two laths and a grapevine trained along it."""
    p, b, s = swapper(axis)
    salt = 3301 if axis == "x" else 3401
    rng = random.Random(salt)
    long_axis = "x" if axis == "x" else "y"
    for k, a in enumerate((-1.14, 0.0, 1.14)):
        draw_mass(cv, [wood(*b(a - 0.06, a + 0.06, -0.06, 0.06), 0.0, 1.0 - 0.04 * (k == 1), salt + k, axis="z", chips=1)])
    for k, z in enumerate((0.46, 0.84)):
        floating_pass(cv, [wood(*b(-1.2, 1.2, -0.03 + 0.01 * k, 0.03 + 0.01 * k), z, z + 0.07, salt + 10 + k,
                                axis=long_axis, chips=2)])
    shade = olive_bark(salt + 20)
    trunk = [(*p(0.1, 0.06), 0.0), (*p(0.16, 0.08), 0.3), (*p(0.05, 0.08), 0.6), (*p(0.12, 0.07), 0.9)]
    chain(cv, trunk, 0.05, 0.035, shade, bark_style())
    oid = cv.new_oid()
    for side in (-1, 1):
        cane = [(*p(0.1 + side * t, 0.08), 0.92 + 0.04 * math.sin(t * 5)) for t in (0.0, 0.4, 0.8, 1.15)]
        chain(cv, cane, 0.03, 0.02, shade, bark_style())
        grape_leaves(cv, rng, cane, salt + 30 + side, density=1.5, oid=oid, bunches=1, hang=0.3, spread=0.08)
    low = [(*p(t, 0.06), 0.5) for t in (-0.9, -0.3, 0.4, 0.95)]
    grape_leaves(cv, rng, low, salt + 40, density=0.55, oid=oid, spread=0.06, size=(5.5, 4.5))
    base_grass(cv, [p(-1.0, 0.1), p(0.4, 0.12), p(1.15, 0.1)], salt + 50)


def herb_plant(cv, rng, centre, z, kind, radius, height, oid):
    """A small herb mound on soil: lavender (silver leaves, violet spikes), sage (silver), green herbs."""
    ramp = FRESH if kind == "green" else OLIVE
    tufts = []
    for _ in range(int(radius * 70) + 3):
        a, r = rng.uniform(0, math.tau), radius * math.sqrt(rng.random())
        x, y = centre[0] + math.cos(a) * r, centre[1] + math.sin(a) * r
        zz = z + height * (1 - (r / radius) ** 2) ** 0.7 * rng.uniform(0.6, 1.0)
        sx, sy = cv.project(x, y, zz)
        side = math.cos(a) - math.sin(a)
        level = 1 if side > 0.4 else 2 if side > -0.4 else 3
        if zz - z > height * 0.6:
            level -= 1
        if kind == "green":
            level += 1
        tufts.append((dot(VIEW, (x, y, zz)) + 0.2, sx, sy, rng.uniform(3.0, 4.5), rng.uniform(2.5, 3.5), max(1, level)))
    for depth, sx, sy, w, h, tone in sorted(tufts):
        tuft(cv, sx, sy, w, h, tone, ramp, depth, oid, kind == "green")
    if kind == "lavender":
        for _ in range(int(radius * 45) + 4):
            a, r = rng.uniform(0, math.tau), radius * 0.8 * math.sqrt(rng.random())
            x, y = centre[0] + math.cos(a) * r, centre[1] + math.sin(a) * r
            zz = z + height * 0.75
            sx, sy = cv.project(x, y, zz)
            lean = rng.choice((-1, 0, 0, 1))
            length = rng.randint(5, 7)
            depth = dot(VIEW, (x, y, zz)) + 0.4
            for st in range(length):
                tone = "LV" if st >= length - 3 else "B1"
                cv.put(math.floor(sx) + (lean if st >= length - 2 else 0), math.floor(sy) - st, depth, tone, oid, ROUND, None)


def kerb_stones(rng, hw, hd, height, salt, size=(0.24, 0.42), thick=0.13, skip=()):
    """Rounded kerb stones round a hw x hd bed (outer edge on the box), corners first."""
    blocks = []
    n = 0
    for side in ("+x", "-x", "+y", "-y"):
        along = hd if side in ("+x", "-x") else hw
        a = -along
        while a < along - 0.02:
            length = min(rng.uniform(*size), along - a)
            if along - a - length < 0.12:
                length = along - a
            lo, hi = a, a + length
            h = height * rng.uniform(0.85, 1.0)
            if side == "+x":
                box = (hw - thick, hw, lo, hi)
            elif side == "-x":
                box = (-hw, -hw + thick, lo, hi)
            elif side == "+y":
                box = (lo, hi, hd - thick, hd)
            else:
                box = (lo, hi, -hd, -hd + thick)
            if n not in skip:
                blocks.append(Block(*box, 0.0, h, salt + n * 7, corner=0.035, bevel=0.04, chips=1, chip=(0.05, 0.1),
                                    chip_depth=(0.03, 0.06), tilt=(rng.uniform(-0.06, 0.06), rng.uniform(-0.06, 0.06)),
                                    moss=0.55, warm=n % 3 == 0))
            n += 1
            a = hi
    return blocks


def bed_soil(hw, hd, z, salt):
    return Block(-hw, hw, -hd, hd, 0.0, z, salt, corner=0.02, bevel=0.03, rough=0.05, wobble=0.0, moss=0.15,
                 material="soil")


def draw_herb_bed(cv, axis):
    """A raised bed: a kerb of rounded stones, dark soil and three rows of herbs."""
    p, b, s = swapper(axis)
    salt = 3501 if axis == "x" else 3601
    rng = random.Random(salt)
    hw, hd = s(1.1, 0.45)
    kerb = kerb_stones(rng, hw, hd, 0.3, salt)
    draw_mass(cv, [bed_soil(hw - 0.1, hd - 0.1, 0.24, salt + 1)])
    f = mass_field(kerb)
    draw_mass(cv, kerb, f)
    oid = cv.new_oid()
    rows = (("lavender", -0.2), ("sage", 0.0), ("green", 0.2))
    for kind, across in rows:
        for k in range(5):
            a = -0.82 + k * 0.41 + rng.uniform(-0.05, 0.05)
            centre = p(a, across + rng.uniform(-0.03, 0.03))
            herb_plant(cv, rng, centre, 0.24, kind, 0.13 if kind != "green" else 0.11, 0.24 if kind == "lavender" else 0.17, oid)
    base_grass(cv, [p(1.12, 0.3), p(-0.4, 0.47), p(0.6, 0.47)], salt + 9)


def draw_herb_bed_overgrown(cv):
    """The same bed run wild: two kerb stones tumbled, weeds and grass spilling over the kerb."""
    rng = random.Random(3701)
    hw, hd = 0.8, 0.6
    kerb = kerb_stones(rng, hw, hd, 0.3, 3701, skip=(1, 9))
    draw_mass(cv, [bed_soil(hw - 0.1, hd - 0.1, 0.22, 3702)])
    f = mass_field(kerb)
    draw_mass(cv, kerb, f)
    draw_mass(cv, [Block(0.55, 0.8, 0.62, 0.84, 0.0, 0.14, 3703, corner=0.04, bevel=0.04, chips=1, tilt=(0.2, 0.1), moss=0.6)])
    oid = cv.new_oid()
    for kind, centre, r, h in (("lavender", (-0.35, -0.2), 0.2, 0.32), ("sage", (0.25, -0.25), 0.18, 0.22),
                               ("green", (-0.2, 0.25), 0.26, 0.34), ("green", (0.4, 0.2), 0.24, 0.3),
                               ("sage", (0.05, 0.0), 0.15, 0.2), ("green", (0.6, -0.45), 0.16, 0.24)):
        herb_plant(cv, rng, centre, 0.22, kind, r, h, oid)
    # Wild grass spilling over the front kerb.
    wild = cv.new_oid()
    for x, y in ((0.82, 0.1), (0.5, 0.62), (-0.2, 0.62), (0.82, -0.35), (0.15, 0.4)):
        bx, by = cv.project(x, y, 0.28)
        for _ in range(9):
            ox, length, lean = rng.uniform(-6, 6), rng.randint(6, 11), rng.uniform(-0.6, 0.6)
            for step in range(length):
                t = step / length
                cv.put(math.floor(bx + ox + lean * step), math.floor(by - step), dot(VIEW, (x, y, 0.3)) + 0.6,
                       "V_HI" if t > 0.65 else "V1" if t > 0.25 else "B2", wild, ROD, None)
    base_grass(cv, [(0.82, 0.4), (-0.5, 0.62), (0.3, 0.64)], 3709)


def draw_vine_clump(cv):
    """A grapevine stump sprawling into a low mound of leaves."""
    rng = random.Random(3801)
    shade = olive_bark(3802)
    ground_patch(cv, (0.0, 0.0), 0.36, 0.28, 3803)
    trunk = [(0.0, 0.0, 0.0), (0.05, -0.03, 0.18), (-0.02, 0.02, 0.36), (0.06, 0.04, 0.5)]
    chain(cv, trunk, 0.075, 0.05, shade, bark_style())
    for tip in ((0.3, -0.2, 0.45), (-0.25, 0.25, 0.4), (0.2, 0.3, 0.35)):
        chain(cv, bend(rng, trunk[-1], tip, lift=0.06, steps=5), 0.04, 0.025, shade, bark_style())
    foliage(cv, [(0.18, -0.12, 0.42, 0.28, 0.28, 0.2), (-0.15, 0.2, 0.38, 0.27, 0.27, 0.18), (0.15, 0.22, 0.28, 0.22, 0.22, 0.16),
                 (-0.05, -0.05, 0.55, 0.22, 0.22, 0.14)], FRESH, 3805, leaf=(6.5, 5.0), wisps=0.6, sprays=0.5, pointed=0.25)
    oid = cv.new_oid()
    for x, y, z in ((0.3, 0.05, 0.3), (-0.05, 0.3, 0.25)):
        sx, sy = cv.project(x, y, z)
        for dy, row in enumerate(("##", "###", "##", "#")):
            for dx, _ in enumerate(row):
                tone = "Q_M" if dx == 0 and dy < 2 else "Q_S2" if (dx + dy) % 2 else "DEEP2"
                cv.put(math.floor(sx) + dx - 1, math.floor(sy) + dy, 9.0, tone, oid, ROUND, None)
    base_grass(cv, [(0.35, 0.1), (0.05, 0.38)], 3809)


# ------------------------------ beehives, basin, benches ---------------------

def skep_shade(front):
    """Coiled straw: a lit ridge and a dark groove per coil; a dark arched entrance toward `front`."""
    fx, fy = front

    def shade(n, p, h, part, u):
        b = lit(n)
        if part == "base":
            return "DEEP" if ihash(round(p[0] * 40), round(p[1] * 40), 5) < 0.85 else "Y2"
        if h < 0.075 and u[0] * fx + u[1] * fy > 0.93:
            return "DEEP"
        level = 0 if b > 0.6 else 1 if b > 0.25 else 2 if b > -0.1 else 3
        coil = (h / 0.062) % 1.0
        if coil > 0.72:
            level -= 1
        elif coil < 0.22:
            level += 1
        stitch = math.atan2(u[1], u[0]) * 5 / math.pi + math.floor(h / 0.062) * 0.5
        if abs(stitch - round(stitch)) < 0.05 and 0.3 < coil < 0.6:
            level += 1
        return ("Y3", "Y1", "Y2", "W2", "W3")[max(0, min(4, level))]
    return shade


def skep_profile(height, radius):
    return lambda h: radius * max(0.0, 1 - (h / height) ** 2.4) ** 0.5 * (1.0 if h > 0.02 else 0.94)


def bench_slab(x0, x1, y0, y1, z0, z1, salt):
    return Block(x0, x1, y0, y1, z0, z1, salt, corner=0.04, bevel=0.04, chips=3, chip_depth=(0.03, 0.06), moss=0.5,
                 warm=True, pattern=Beds([z0, z1], salt + 1))


def draw_beehive_pair(cv):
    """Two straw skeps on a stone bench (a slab on two stone feet)."""
    feet = [stone(0.42, 0.7, -0.3, 0.3, 0.0, 0.3, 3901, corner=0.03, bevel=0.035, moss=0.55, pattern=Beds([0.0, 0.3], 3902)),
            stone(-0.7, -0.42, -0.3, 0.3, 0.0, 0.3, 3903, corner=0.03, bevel=0.035, moss=0.55, pattern=Beds([0.0, 0.3], 3904))]
    draw_mass(cv, feet)
    floating_pass(cv, [bench_slab(-0.7, 0.7, -0.3, 0.3, 0.3, 0.4, 3905)])
    front = (SQ2 / 2, SQ2 / 2)
    for (x, y), height, radius in (((0.32, 0.0), 0.52, 0.24), ((-0.33, 0.02), 0.46, 0.22)):
        cv.lathe((x, y, 0.4), (0, 0, 1), height, skep_profile(height, radius), skep_shade(front),
                 {"seam": "W3", "seamGap": 0.05})
    # A straw hackle cap on the bigger skep.
    cap = cv.new_oid()
    for k in range(10):
        a = k * math.tau / 10
        cv.rod((0.32 + math.cos(a) * 0.12, math.sin(a) * 0.12, 0.84), (0.32, 0.0, 1.0), 1,
               ("Y3" if math.cos(a) - math.sin(a) > 0 else "Y2",) * 3, None, oid=cap)
    base_grass(cv, [(0.72, 0.1), (0.0, 0.32), (-0.72, 0.32)], 3909)


def draw_beehive_fallen(cv):
    """The bench gave way at one foot: the slab slopes to the ground, one skep
    rolled off and lies on its side, a shard of comb in the grass."""
    feet = [stone(-0.7, -0.42, -0.3, 0.3, 0.0, 0.3, 4001, corner=0.03, bevel=0.035, moss=0.55, pattern=Beds([0.0, 0.3], 4002))]
    draw_mass(cv, feet)
    draw_mass(cv, [stone(0.42, 0.74, 0.02, 0.32, 0.0, 0.2, 4003, corner=0.03, bevel=0.04, tilt=(0.15, 0.08), moss=0.6,
                         pattern=Beds([0.0, 0.2], 4004))])
    slope = -0.3 / 1.1
    floating_pass(cv, [TiltBlock(-0.72, 0.62, -0.3, 0.3, 0.3, 0.1, (slope, 0.0), 4005, pivot=(-0.45, 0.0), corner=0.04,
                                 bevel=0.04, chips=3, chip_depth=(0.03, 0.06), moss=0.5, warm=True,
                                 pattern=Beds([-9.0, 9.0], 4006))])
    cv.lathe((-0.42, 0.0, 0.4 + slope * 0.03), _normalize((-slope, 0.0, 1.0)), 0.48, skep_profile(0.48, 0.23),
             skep_shade((SQ2 / 2, SQ2 / 2)), {"seam": "W3", "seamGap": 0.05})
    axis = _normalize((0.25, -1.0, 0.18))
    cv.lathe((0.42, 0.42, 0.21), axis, 0.48, skep_profile(0.48, 0.22), skep_shade((-1.0, 0.0)),
             {"seam": "W3", "seamGap": 0.05}, floor=0.0)
    comb = cv.new_oid()
    sx, sy = cv.project(0.75, 0.48, 0.0)
    for dx, dy, tone in ((0, 0, "Y3"), (1, 0, "Y1"), (2, 0, "Y3"), (0, 1, "Y1"), (1, 1, "Y2"), (2, 1, "Y1"), (1, -1, "Y3")):
        cv.put(math.floor(sx) + dx, math.floor(sy) + dy - 1, 9.0, tone, comb, TOP, None)
    base_grass(cv, [(0.78, 0.0), (-0.72, 0.32), (0.1, 0.55)], 4009)


def draw_stone_basin(cv):
    """A dry stone trough hollowed from one block, with leaves and moss on its floor."""
    hook_box = (0.58, 0.27)

    def hook(f, i, j, x, y, z, zt):
        if abs(x) < hook_box[0] + 0.03 and abs(y) < hook_box[1] + 0.03 and zt - z > 0.04 and z > 0.17:
            return ("DEEP2" if zt - z > 0.2 else "Q_S1"), RIGHT_FACE
        return None
    block = Block(-0.75, 0.75, -0.42, 0.42, 0.0, 0.55, 4101, corner=0.06, bevel=0.06, chips=4, chip_depth=(0.05, 0.12),
                  moss=0.55, warm=True, pattern=Beds([0.0, 0.08, 0.55], 4102))
    block.tone_hook = hook
    f = mass_field([block])
    hollow = carve(f, lambda x, y, top, fl: (fl, min(top, 0.18)) if abs(x) < hook_box[0] and abs(y) < hook_box[1] else (fl, top))
    draw_mass(cv, [block], hollow)
    rng = random.Random(4103)
    oid = cv.new_oid()
    for _ in range(30):
        x, y = rng.uniform(-0.5, 0.5), rng.uniform(-0.2, 0.22)
        sx, sy = cv.project(x, y, 0.19)
        tone = rng.choice(("Y2", "Y1", "T1", "M2", "M1", "O1"))
        depth = dot(VIEW, (x, y, 0.19)) + 0.01
        cv.put(math.floor(sx), math.floor(sy), depth, tone, oid, TOP, None)
        cv.put(math.floor(sx) + 1, math.floor(sy), depth, tone if rng.random() < 0.5 else "M3", oid, TOP, None)
    # The drain hole in the front end.
    hx, hy = cv.project(0.76, 0.0, 0.12)
    hole = cv.new_oid()
    for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
        cv.put(math.floor(hx) + dx - 1, math.floor(hy) + dy, 40.0, "DEEP", hole, ROUND, None)
    base_grass(cv, [(0.76, 0.2), (0.2, 0.44), (-0.5, 0.44)], 4109)


def draw_garden_bench(cv, axis):
    """Timber seat and backrest on two stone feet; one back board is gone."""
    p, b, s = swapper(axis)
    salt = 4201 if axis == "x" else 4301
    long_axis = "x" if axis == "x" else "y"
    feet = [stone(*b(0.56, 0.8, -0.25, 0.25), 0.0, 0.36, salt + 1, corner=0.03, bevel=0.035, moss=0.55,
                  pattern=Beds([0.0, 0.18, 0.36], salt + 2)),
            stone(*b(-0.8, -0.56, -0.25, 0.25), 0.0, 0.36, salt + 3, corner=0.03, bevel=0.035, moss=0.55,
                  pattern=Beds([0.0, 0.18, 0.36], salt + 4))]
    draw_mass(cv, feet)
    floating_pass(cv, [wood(*b(-0.8, 0.8, -0.24, 0.24), 0.36, 0.44, salt + 5, axis=long_axis, cuts=(-0.08, 0.08), chips=3)])
    for k, a in enumerate((-0.62, 0.62)):
        draw_mass(cv, [wood(*b(a - 0.05, a + 0.05, -0.24, -0.15), 0.0, 0.92, salt + 10 + k, axis="z", chips=1)])
    floating_pass(cv, [wood(*b(-0.78, 0.78, -0.235, -0.175), 0.74, 0.84, salt + 13, axis=long_axis, chips=2)])
    floating_pass(cv, [wood(*b(-0.78, -0.05, -0.235, -0.175), 0.56, 0.64, salt + 14, axis=long_axis, chips=2)])
    rng = random.Random(salt + 20)
    oid = cv.new_oid()
    for _ in range(8):
        x, y = p(rng.uniform(-0.6, 0.6), rng.uniform(-0.1, 0.2))
        sx, sy = cv.project(x, y, 0.445)
        tone = rng.choice(("Y2", "Y1", "O1", "T1"))
        cv.put(math.floor(sx), math.floor(sy), dot(VIEW, (x, y, 0.45)), tone, oid, TOP, None)
        cv.put(math.floor(sx) + 1, math.floor(sy), dot(VIEW, (x, y, 0.45)), tone, oid, TOP, None)
    base_grass(cv, [p(0.8, 0.2), p(-0.3, 0.27), p(0.3, 0.27)], salt + 30)


# ------------------------------ cart, baskets, jars --------------------------

def spoked_wheel(cv, centre, axis, radius, salt, flat=False, spokes=8):
    """A spoked wooden wheel in the plane normal to world `axis`; lying flat when `flat`."""
    oid = cv.new_oid()
    style = {"seam": "W4", "seamGap": 0.04}

    def point(a, r, off=0.0):
        cx, cy, cz = centre
        if flat:
            return (cx + math.cos(a) * r, cy + math.sin(a) * r, cz + off)
        if axis == "y":
            return (cx + math.cos(a) * r, cy + off, cz + math.sin(a) * r)
        return (cx + off, cy + math.cos(a) * r, cz + math.sin(a) * r)
    for off, colors in ((-0.05, ("W3", "W3", "W4")), (0.0, ("W_HI", "W1", "W2"))):
        for k in range(36):
            a0, a1 = k * math.tau / 36, (k + 1) * math.tau / 36
            top = math.sin((a0 + a1) / 2) > 0.2 and not flat
            cols = colors if not top or off else ("W_HI", "W_HI", "W1")
            cv.rod(point(a0, radius, off), point(a1, radius, off), 2, cols, style, oid=oid)
    for k in range(spokes):
        a = k * math.tau / spokes + 0.2
        cv.rod(point(a, 0.06), point(a, radius - 0.02), 1, ("W1", "W1", "W1"), style, oid=oid)
    hub = point(0.0, 0.0, 0.02)
    cv.ellipsoid(hub, (0.06, 0.06, 0.06), lambda n, p: "W1" if lit(n) > 0.3 else "W2" if lit(n) > -0.1 else "W3", style, oid=oid)
    return oid


def draw_cart_broken(cv, axis):
    """A handcart down on one corner: its far wheel lies flat in the grass, the
    near wheel still on its axle, the shafts resting on the ground."""
    p, b, s = swapper(axis)
    salt = 4401 if axis == "x" else 4501
    rng = random.Random(salt)
    long_axis, cross_axis = ("x", "y") if axis == "x" else ("y", "x")
    # Bed plane: the near (+cross) side rests on the wheel, the far side on the ground.
    base_near, base_far, half_cross = 0.4, 0.04, 0.38
    sc = (base_near - base_far) / (2 * half_cross)
    slope = s(-0.06, sc)
    pivot = p(0.0, half_cross)
    floor = tilt_wood(*b(-0.55, 0.5, -half_cross, half_cross), base_near, 0.06, slope, salt + 1, axis=long_axis,
                      pivot=pivot, cuts=(-0.13, 0.13), chips=2)
    floating_pass(cv, [floor])
    sides = [tilt_wood(*b(-0.55, 0.5, half_cross - 0.05, half_cross), base_near, 0.3, slope, salt + 2, axis=long_axis, pivot=pivot, chips=2),
             tilt_wood(*b(-0.55, 0.5, -half_cross, -half_cross + 0.05), base_near, 0.3, slope, salt + 3, axis=long_axis, pivot=pivot, chips=3),
             tilt_wood(*b(-0.55, -0.5, -half_cross, half_cross), base_near, 0.3, slope, salt + 4, axis=long_axis, pivot=pivot, chips=2),
             tilt_wood(*b(0.45, 0.5, 0.0, half_cross), base_near, 0.18, slope, salt + 5, axis=long_axis, pivot=pivot, chips=3)]
    for board in sides:
        floating_pass(cv, [board])
    spoked_wheel(cv, (*p(-0.05, half_cross + 0.07), 0.36), cross_axis, 0.34, salt + 6)
    spoked_wheel(cv, (*p(0.32, -0.62), 0.02), cross_axis, 0.3, salt + 7, flat=True)
    for k, side in enumerate((-0.3, 0.3)):
        start = (*p(0.5, side), max(0.05, base_near + slope[0] * (p(0.5, side)[0] - pivot[0]) + slope[1] * (p(0.5, side)[1] - pivot[1]) + 0.12))
        cv.rod(start, (*p(0.95, side * 1.05), 0.04), 2, ("W_HI", "W1", "W2"), {"seam": "W4"})
    oid = cv.new_oid()
    for _ in range(14):
        x, y = p(rng.uniform(-0.45, 0.4), rng.uniform(-0.3, 0.3))
        z = base_near + slope[0] * (x - pivot[0]) + slope[1] * (y - pivot[1]) + 0.065
        sx, sy = cv.project(x, y, z)
        cv.put(math.floor(sx), math.floor(sy), dot(VIEW, (x, y, z)) + 0.01, rng.choice(("T3", "T2", "M2")), oid, TOP, None)
    base_grass(cv, [p(0.6, 0.45), p(-0.5, 0.5), p(0.95, 0.0)], salt + 9)


def wicker_shade(height):
    def shade(n, p, h, part, u):
        b = lit(n)
        level = 0 if b > 0.55 else 1 if b > 0.2 else 2 if b > -0.12 else 3
        if part == "cap":
            return "T3"
        if height - h < 0.045:
            return ("Y3", "Y1", "Y2", "W2", "W3")[max(0, min(4, level - (1 if height - h > 0.02 else 0)))]
        a = math.atan2(u[1], u[0])
        cell = (math.floor(a * 0.24 / 0.035), math.floor(h / 0.042))
        if (cell[0] + cell[1]) % 2:
            level += 1
        return ("Y3", "Y1", "Y2", "W2", "W3")[max(0, min(4, level))]
    return shade


def olive_shade(salt):
    """A heap of black and green olives: dark fruit, a glint on some, a few green ones."""
    def shade(n, p):
        b = lit(n)
        cell = ihash(math.floor(p[0] * 36 + p[1] * 9), math.floor(p[1] * 36 - p[2] * 20), salt)
        if cell < 0.13:
            return "M1" if b > 0.3 else "M2"
        if cell > 0.74 and b > 0.2:
            return "Q_T3" if b > 0.5 else "Q_L2"
        return "T2" if b > 0.45 else "T3"
    return shade


def draw_olive_baskets(cv):
    """Two wicker baskets heaped with olives and a third tipped over, spilling."""
    rng = random.Random(4601)
    style = {"seam": "W3", "seamGap": 0.05}
    for (x, y), h, r in (((-0.28, 0.02), 0.4, 0.25), ((0.06, -0.3), 0.34, 0.22)):
        cv.lathe((x, y, 0.0), (0, 0, 1), h, lambda hh, r=r, h=h: r * (0.86 + 0.14 * hh / h), wicker_shade(h), style)
        cv.ellipsoid((x, y, h + 0.01), (r * 0.84, r * 0.84, 0.11), olive_shade(4603), {"seam": "T3", "seamGap": 0.04})
    axis = _normalize((-0.15, 1.0, 0.1))
    cv.lathe((0.24, 0.0, 0.2), axis, 0.34, lambda hh: 0.2 * (0.86 + 0.14 * (1 - hh / 0.34)), wicker_shade(0.34), style)
    oid = cv.new_oid()
    for _ in range(16):
        x, y = rng.uniform(0.0, 0.32), rng.uniform(0.36, 0.56)
        sx, sy = cv.project(x, y, 0.0)
        green = rng.random() < 0.25
        cv.put(math.floor(sx), math.floor(sy), -9.0, "M1" if green else "Q_L2", oid, TOP, {"flat": True})
        cv.put(math.floor(sx) + 1, math.floor(sy), -9.0, "M2" if green else "T3", oid, TOP, {"flat": True})
    base_grass(cv, [(0.5, 0.1), (-0.1, 0.5)], 4609)


def terracotta_shade(height, bands=(), mouth=0.0, broken=None):
    def shade(n, p, h, part, u):
        b = lit(n)
        if part == "cap":
            rho = math.hypot(p[0] - shade.cx, p[1] - shade.cy) if hasattr(shade, "cx") else 0.0
            return "DEEP" if rho < mouth else "TC_HI"
        level = 0 if b > 0.6 else 1 if b > 0.25 else 2 if b > -0.08 else 3 if b > -0.35 else 4
        if any(abs(h - band) < 0.012 for band in bands):
            level += 1
        if h < 0.05 and ihash(round(p[0] * 50), round(p[1] * 50), 3) < 0.5:
            level = max(level, 3)
        return ("TC_HI", "TC1", "W1", "W2", "W3")[min(4, level)]
    return shade


def jar(cv, base, profile, height, bands, mouth, style, axis=(0, 0, 1)):
    shade = terracotta_shade(height, bands, mouth)
    shade.cx, shade.cy = base[0], base[1]
    radius = lambda h: lerp_points(profile, h)
    return cv.lathe(base, axis, height, radius, shade, style)


def draw_terracotta_jars(cv):
    """A tall storage jar, a two-handled jar, a small jar on its side and the
    broken foot of a fourth with its shards."""
    style = {"seam": "W4", "seamGap": 0.05}
    jar(cv, (-0.22, -0.22, 0.0), [(0.0, 0.17), (0.12, 0.28), (0.45, 0.36), (0.7, 0.32), (0.88, 0.2), (0.94, 0.15),
                                 (0.97, 0.19), (1.05, 0.2)], 1.05, (0.62, 0.66, 0.94), 0.13, style)
    jar(cv, (0.32, -0.12, 0.0), [(0.0, 0.11), (0.1, 0.19), (0.32, 0.24), (0.5, 0.2), (0.6, 0.12), (0.66, 0.1), (0.7, 0.13),
                                (0.72, 0.13)], 0.72, (0.44,), 0.08, style)
    for side in (-1, 1):
        cv.rod((0.32 + side * 0.16, -0.12 - side * 0.16, 0.48), (0.32 + side * 0.13, -0.12 - side * 0.13, 0.64), 2,
               ("TC1", "W1", "W2"), style)
        cv.rod((0.32 + side * 0.13, -0.12 - side * 0.13, 0.64), (0.32 + side * 0.08, -0.12 - side * 0.08, 0.65), 2,
               ("TC1", "W1", "W2"), style)
    jar(cv, (0.36, 0.3, 0.12), [(0.0, 0.07), (0.08, 0.12), (0.22, 0.14), (0.32, 0.09), (0.38, 0.06), (0.4, 0.07)], 0.4,
        (0.22,), 0.04, style, axis=_normalize((-0.6, 1.0, 0.02)))
    # The broken foot: a low bowl with a jagged lip and its dark inside.
    broken = (-0.08, 0.42)
    shade = terracotta_shade(0.3, (), 0.0)

    def foot(n, p, h, part, u):
        if part == "cap":
            return "W3" if math.hypot(p[0] - broken[0], p[1] - broken[1]) < 0.17 else "TC_HI"
        return shade(n, p, h, part, u)
    cv.lathe((*broken, 0.0), (0, 0, 1), 0.26, lambda h: lerp_points([(0.0, 0.13), (0.1, 0.2), (0.26, 0.22)], h), foot, style)
    rng = random.Random(4701)
    oid = cv.new_oid()
    for _ in range(9):
        x, y = broken[0] + rng.uniform(-0.1, 0.3), broken[1] + rng.uniform(-0.05, 0.12)
        sx, sy = cv.project(x, y, 0.0)
        w = rng.randint(2, 4)
        for dx in range(w):
            cv.put(math.floor(sx) + dx, math.floor(sy), 9.0, "TC_HI" if dx == 0 else "TC1", oid, TOP, None)
            cv.put(math.floor(sx) + dx, math.floor(sy) + 1, 9.0, "W2", oid, TOP, None)
    base_grass(cv, [(0.5, 0.1), (0.05, 0.55), (-0.5, 0.0)], 4709)


# ------------------------------ statue --------------------------------------

def statue_stone(salt, moss=0.45, face=None):
    """Weathered carved stone on curved parts: four light steps, pits, moss on what faces up."""
    def shade(n, p):
        b = lit(n)
        if face and face(n, p):
            return "Q_S2"
        if n[2] > 0.5 and moss_at(p[0] * 1.3, p[1] * 1.3 + p[2] * 0.7, salt, moss) > 0.12:
            return "M1" if lit(n) > 0.55 else "M2"
        pit = vnoise(p[0] * 15 + p[2] * 9, p[1] * 15 - p[2] * 6, salt + 3)
        level = 0 if b > 0.76 else 1 if b > 0.52 else 2 if b > 0.28 else 3 if b > 0.06 else 4 if b > -0.2 else 5
        if pit > 0.8:
            level += 1
        if level >= 4 and p[2] < 0.9 and vnoise(p[0] * 5, p[2] * 5, salt + 4) > 0.55:
            return "Q_AMB"
        return ("Q_T1", "Q_T2", "Q_L1", "Q_L2", "Q_M", "Q_S1", "Q_S2")[min(6, level)]
    return shade


def draw_monk_statue(cv):
    """A seated, hooded stone monk on a coursed plinth: crossed legs, hands
    in the lap, worn by weather, moss on the shoulders and hood."""
    plinth = [Block(-0.55, 0.55, -0.55, 0.55, 0.0, 0.12, 4801, corner=0.03, bevel=0.035, chips=3, moss=0.55,
                    pattern=Beds([0.0, 0.12], 4802)),
              Block(-0.43, 0.43, -0.43, 0.43, 0.12, 0.46, 4803, corner=0.03, bevel=0.035, chips=2, moss=0.4, warm=True,
                    pattern=Beds([0.12, 0.3, 0.46], 4804))]
    draw_mass(cv, plinth)
    floating_pass(cv, [Block(-0.48, 0.48, -0.48, 0.48, 0.46, 0.54, 4805, corner=0.03, bevel=0.03, chips=3, moss=0.6,
                             pattern=Beds([0.46, 0.54], 4806))])
    zp = 0.54
    F = (SQ2 / 2, SQ2 / 2)
    L = (-SQ2 / 2, SQ2 / 2)

    def at(f, l, z):
        return (F[0] * f + L[0] * l, F[1] * f + L[1] * l, zp + z)
    style = {"seam": "Q_S2", "seamGap": 0.05}
    stone_ = statue_stone(4807)
    turn = math.pi / 4
    cv.ellipsoid(at(0.04, 0.0, 0.12), (0.3, 0.44, 0.14), stone_, style, angle=turn)                      # crossed legs
    for side in (-1, 1):
        cv.ellipsoid(at(0.14, side * 0.32, 0.12), (0.15, 0.15, 0.11), stone_, style, angle=turn)        # knees
    cv.ellipsoid(at(-0.05, 0.0, 0.5), (0.22, 0.3, 0.42), stone_, style, angle=turn)                      # robed torso
    for side in (-1, 1):
        cv.ellipsoid(at(-0.03, side * 0.29, 0.62), (0.1, 0.09, 0.22), stone_, style, angle=turn)        # upper arms
        cv.ellipsoid(at(0.12, side * 0.18, 0.4), (0.17, 0.075, 0.07), stone_, style, angle=turn - side * 0.6)  # forearms
    cv.ellipsoid(at(0.22, 0.0, 0.36), (0.08, 0.12, 0.065), stone_, style, angle=turn)                    # hands
    hood_c = at(-0.03, 0.0, 1.03)

    def face(n, p):
        rel = (p[0] - hood_c[0], p[1] - hood_c[1], p[2] - hood_c[2])
        f = rel[0] * F[0] + rel[1] * F[1]
        l = rel[0] * L[0] + rel[1] * L[1]
        return f > 0.05 and abs(l) < 0.08 and -0.13 < rel[2] < 0.05
    cv.ellipsoid(hood_c, (0.165, 0.17, 0.19), statue_stone(4808, face=face), style, angle=turn)         # hood
    # A small clay offering bowl at the plinth foot.
    shade = terracotta_shade(0.06, (), 0.06)
    shade.cx, shade.cy = 0.64, 0.18
    cv.lathe((0.64, 0.18, 0.0), (0, 0, 1), 0.08, lambda h: 0.06 + 0.04 * h / 0.08, shade, {"seam": "W4", "seamGap": 0.05})
    f = mass_field(plinth)
    ivy_top(cv, f, [(0.38, -0.38)], 4811, radius=0.1)
    base_grass(cv, [(0.56, -0.3), (-0.3, 0.56), (0.56, 0.5)], 4813)


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


def put_flat(cv, colors, oid, depth=-9.0):
    for (px, py), color in colors.items():
        cv.put(px, py, depth, color, oid, TOP, {"flat": True})


def blob(x, y, hw, hd, salt, rough=0.35):
    d = (x / hw) ** 2 + (y / hd) ** 2
    return d < 1 - rough * vnoise(x * 3.2 + 5, y * 3.2, salt) - 0.15 * vnoise(x * 9, y * 9, salt + 1)


def scatter(rng, hw, hd, salt, count, rough=0.4, tries=40):
    """Points inside a ragged blob, denser toward its middle."""
    points = []
    while len(points) < count and tries * count > 0:
        tries -= 1 / count
        x, y = rng.gauss(0, hw * 0.42), rng.gauss(0, hd * 0.42)
        if abs(x) < hw - 0.08 and abs(y) < hd - 0.08 and blob(x, y, hw, hd, salt, rough):
            points.append((x, y))
    return points


def leaf_mark(colors, sx, sy, angle, length, tone, edge):
    """A narrow leaf lying on the ground: a 1 px stroke with a darker underside pixel."""
    dx, dy = math.cos(angle), math.sin(angle) * 0.5
    for s in range(length):
        px, py = math.floor(sx + dx * s), math.floor(sy + dy * s)
        colors[(px, py)] = tone
        if 0 < s < length - 1:
            colors.setdefault((px, py + 1), edge)


def draw_fallen_olives(cv):
    rng = random.Random(4901)
    colors = {}
    for x, y in scatter(rng, 0.9, 0.7, 4903, 26):
        sx, sy = cv.project(x, y, 0)
        leaf_mark(colors, sx, sy, rng.uniform(-0.6, 0.6) + (math.pi if rng.random() < 0.5 else 0), rng.randint(3, 4),
                  rng.choice(("O1", "O1", "B_HI", "Y2")), "B1")
    for x, y in scatter(rng, 0.9, 0.7, 4905, 70):
        sx, sy = cv.project(x, y, 0)
        px, py = math.floor(sx), math.floor(sy)
        green = rng.random() < 0.25
        colors[(px, py)] = "M1" if green else "T3"
        colors[(px + 1, py)] = "M2" if green else "T2"
        if rng.random() < 0.45:
            colors[(px, py - 1)] = "M_HI" if green else "Q_L2"
    put_flat(cv, colors, cv.new_oid())


def draw_leaf_litter(cv):
    rng = random.Random(5001)
    colors = {}
    for x, y in scatter(rng, 1.0, 0.8, 5003, 95, rough=0.5):
        sx, sy = cv.project(x, y, 0)
        tone, edge = rng.choice((("Y1", "Y2"), ("Y1", "Y2"), ("Y3", "Y1"), ("O1", "B_HI"), ("T1", "T2"), ("Y2", "T1")))
        leaf_mark(colors, sx, sy, rng.uniform(-0.8, 0.8) + (math.pi if rng.random() < 0.5 else 0), rng.randint(3, 5), tone, edge)
    put_flat(cv, colors, cv.new_oid())


def draw_gravel_path(cv):
    """Packed earth with gravel, ragged grassy edges. Pebbles are lit from above
    only, so the decal may be mirrored."""
    rng = random.Random(5101)
    hw, hd = 1.4, 1.0
    colors = {}
    for px, py, x, y in ground_pixels(cv, hw, hd):
        if not blob(x, y, hw, hd, 5103, rough=0.3):
            continue
        g = vnoise(x * 5, y * 5, 5105) * 0.7 + ihash(px, py, 5106) * 0.3
        edge = (x / hw) ** 2 + (y / hd) ** 2
        if edge > 0.62 and ihash(px, py, 5107) < (edge - 0.62) * 2.2:
            continue
        colors[(px, py)] = "SOIL1" if g > 0.6 else "SOIL2" if g > 0.26 else "SOIL3"
    pebbles = scatter(rng, hw, hd, 5103, 90, rough=0.45)
    for x, y in pebbles:
        sx, sy = cv.project(x, y, 0)
        px, py = math.floor(sx), math.floor(sy)
        w = rng.choice((2, 2, 3, 3, 4))
        tone = rng.choice(("Q_T1", "Q_T2", "Q_W1", "Q_T3", "Q_L1"))
        for dx in range(w):
            colors[(px + dx, py)] = tone
            if 0 < dx < w - 1 or w == 2:
                colors[(px + dx, py - 1)] = "Q_HI" if tone in ("Q_T1", "Q_W1") else "Q_T1"
            colors[(px + dx, py + 1)] = "Q_M" if dx else "Q_L2"
    oid = cv.new_oid()
    put_flat(cv, colors, oid)
    grass = cv.new_oid()
    for _ in range(14):
        a = rng.uniform(0, math.tau)
        x, y = math.cos(a) * hw * 0.78, math.sin(a) * hd * 0.78
        bx, by = cv.project(x, y, 0)
        for _ in range(rng.randint(2, 4)):
            ox, length, lean = rng.randint(-2, 2), rng.randint(3, 5), rng.uniform(-0.4, 0.4)
            for step in range(length):
                t = step / length
                cv.put(math.floor(bx + ox + lean * step), math.floor(by) - step, -8.0,
                       "V_HI" if t > 0.6 else "V1" if t > 0.25 else "B2", grass, ROD, {"flat": True})


def draw_pruned_branches(cv):
    """Cut olive boughs lying in a loose pile: pale cut ends, silver leaf sprays."""
    rng = random.Random(5201)
    style = {"flat": True, "seam": "T3", "seamGap": 0.03}
    flat = {"flat": True}
    shade = olive_bark(5202)
    leaves = cv.new_oid()
    boughs = [((0.72, -0.3), (-0.68, 0.2)), ((0.6, 0.32), (-0.55, -0.3)), ((0.12, -0.45), (-0.2, 0.45)),
              ((0.78, 0.05), (-0.3, 0.4))]
    for n, ((x0, y0), (x1, y1)) in enumerate(boughs):
        z = 0.04 + 0.03 * n
        a, b = (x0, y0, z), (x1, y1, z)
        chain(cv, [a, (0.5 * (x0 + x1) + rng.uniform(-0.08, 0.08), 0.5 * (y0 + y1) + rng.uniform(-0.08, 0.08), z), b],
              0.045, 0.028, shade, style)
        sx, sy = cv.project(*a)
        for dx, dy, tone in ((0, 0, "Y3"), (-1, 0, "Y1"), (0, 1, "Y1")):
            cv.put(math.floor(sx) + dx, math.floor(sy) + dy - 1, 60.0, tone, leaves, TOP, flat)
        for _ in range(6):
            f = rng.uniform(0.3, 1.0)
            p = tuple(a[k] + (b[k] - a[k]) * f for k in range(3))
            side = (p[0] + rng.uniform(-0.2, 0.2), p[1] + rng.uniform(-0.2, 0.2), p[2] + 0.02)
            cv.rod(p, side, 1, ("T2", "T2", "T2"), flat, depth_bias=0.05)
            for _ in range(3):
                q = (side[0] + rng.uniform(-0.08, 0.08), side[1] + rng.uniform(-0.08, 0.08), side[2] + 0.03)
                qx, qy = cv.project(*q)
                tone = rng.choice((1, 1, 2, 3))
                tuft(cv, qx, qy, rng.uniform(3.5, 5.0), rng.uniform(2.5, 3.5), tone, OLIVE, dot(VIEW, q) + 0.1, leaves, False, flat)


DRAW = {
    "olive-tree-a": draw_olive_a, "olive-tree-b": draw_olive_b, "olive-tree-c": draw_olive_c,
    "olive-tree-old": draw_olive_old, "olive-dead": draw_olive_dead, "fig-young": draw_fig_young,
    "well": draw_well, "olive-press": draw_olive_press,
    "pergola-x": lambda cv: draw_pergola(cv, "x"), "pergola-y": lambda cv: draw_pergola(cv, "y"),
    "pergola-broken-x": lambda cv: draw_pergola_broken(cv, "x"), "pergola-broken-y": lambda cv: draw_pergola_broken(cv, "y"),
    "trellis-x": lambda cv: draw_trellis(cv, "x"), "trellis-y": lambda cv: draw_trellis(cv, "y"),
    "beehive-pair": draw_beehive_pair, "beehive-fallen": draw_beehive_fallen, "stone-basin": draw_stone_basin,
    "garden-bench-x": lambda cv: draw_garden_bench(cv, "x"), "garden-bench-y": lambda cv: draw_garden_bench(cv, "y"),
    "cart-broken-x": lambda cv: draw_cart_broken(cv, "x"), "cart-broken-y": lambda cv: draw_cart_broken(cv, "y"),
    "olive-baskets": draw_olive_baskets, "terracotta-jars": draw_terracotta_jars, "monk-statue": draw_monk_statue,
    "herb-bed-x": lambda cv: draw_herb_bed(cv, "x"), "herb-bed-y": lambda cv: draw_herb_bed(cv, "y"),
    "herb-bed-overgrown": draw_herb_bed_overgrown, "vine-clump": draw_vine_clump,
    "fallen-olives": draw_fallen_olives, "leaf-litter": draw_leaf_litter, "gravel-path": draw_gravel_path,
    "pruned-branches": draw_pruned_branches,
}


# --------------------------------------------------------------------------
# Footprint contract, pixel-v9 rule: contactCenter = [128, 231 - front ground
# extent] rounded down to 0.25 px, so the front-most footprint point sits on
# row 231. Roles: solid (collider, may hide the hero), low (collider, at most
# 1.1u high, never hides the hero), flat (ground layer, no collider). Tall
# frames (`tall`: true) collide only at their trunks or posts (`colliders`).
# --------------------------------------------------------------------------

def _box(hw, hd, height, role="solid", **extra):
    return {"shape": "box", "role": role, "height": height, "halfWidth": hw, "halfDepth": hd, **extra}


def _rect(hw, hd):
    return {"shape": "rect", "role": "flat", "height": 0, "halfWidth": hw, "halfDepth": hd, "contact": "none"}


def _circle(radius, height, role="solid", **extra):
    return {"shape": "circle", "role": role, "height": height, "radius": radius, **extra}


def _part(x, y, hw, hd):
    return {"x": x, "y": y, "halfWidth": hw, "halfDepth": hd}


def pergola_posts(axis, broken=False):
    posts = [(POST_X, POST_Y), (POST_X, -POST_Y), (-POST_X, POST_Y), (-POST_X, -POST_Y)]
    return [_part(*((x, y) if axis == "x" else (y, x)), POST_HALF, POST_HALF) for x, y in posts]


SPECS = {
    "olive-tree-a": _circle(0.3, 3.15, contact="loose", tall=True, canopy=1.25),
    "olive-tree-b": _circle(0.28, 2.95, contact="loose", tall=True, canopy=1.35),
    "olive-tree-c": _circle(0.34, 3.35, contact="loose", tall=True, canopy=1.35),
    "olive-tree-old": _circle(0.62, 3.85, contact="loose", tall=True, canopy=1.75, landmark=True),
    "olive-dead": _circle(0.26, 2.75, contact="loose", tall=True),
    "fig-young": _circle(0.22, 1.9, contact="loose", tall=True, canopy=0.75),
    "well": _circle(0.8, 2.35, contact="loose", landmark=True),
    "olive-press": _circle(0.85, 1.42, contact="loose", landmark=True),
    "pergola-x": _box(1.44, 0.81, 2.95, axis="x", contact="corners", tall=True, colliders=pergola_posts("x")),
    "pergola-y": _box(0.81, 1.44, 2.95, axis="y", contact="corners", tall=True, colliders=pergola_posts("y")),
    "pergola-broken-x": _box(1.44, 0.81, 2.95, axis="x", contact="corners", tall=True, colliders=pergola_posts("x")),
    "pergola-broken-y": _box(0.81, 1.44, 2.95, axis="y", contact="corners", tall=True, colliders=pergola_posts("y")),
    "trellis-x": _box(1.2, 0.06, 1.05, role="low", axis="x", contact="corners"),
    "trellis-y": _box(0.06, 1.2, 1.05, role="low", axis="y", contact="corners"),
    "beehive-pair": _box(0.7, 0.3, 1.0, role="low", contact="corners"),
    "beehive-fallen": _box(0.74, 0.5, 0.72, role="low", contact="loose"),
    "stone-basin": _box(0.75, 0.42, 0.55, role="low", contact="corners"),
    "garden-bench-x": _box(0.8, 0.25, 0.92, role="low", axis="x", contact="corners"),
    "garden-bench-y": _box(0.25, 0.8, 0.92, role="low", axis="y", contact="corners"),
    "cart-broken-x": _box(0.95, 0.72, 0.8, role="low", axis="x", contact="loose"),
    "cart-broken-y": _box(0.72, 0.95, 0.8, role="low", axis="y", contact="loose"),
    "olive-baskets": _circle(0.55, 0.5, role="low", contact="loose"),
    "terracotta-jars": _box(0.6, 0.6, 1.05, role="low", contact="loose"),
    "monk-statue": _box(0.55, 0.55, 1.8, contact="corners", landmark=True),
    "herb-bed-x": _box(1.1, 0.45, 0.62, role="low", axis="x", contact="corners"),
    "herb-bed-y": _box(0.45, 1.1, 0.62, role="low", axis="y", contact="corners"),
    "herb-bed-overgrown": _box(0.8, 0.6, 0.7, role="low", contact="loose"),
    "vine-clump": _circle(0.4, 0.72, role="low", contact="loose"),
    "fallen-olives": _rect(0.9, 0.7),
    "leaf-litter": _rect(1.0, 0.8),
    "gravel-path": {**_rect(1.4, 1.0), "mirror": True},
    "pruned-branches": _rect(1.0, 0.6),
}
SPECS["pergola-broken-x"]["colliders"][0]["note"] = SPECS["pergola-broken-y"]["colliders"][0]["note"] = "stump"


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
        "owner": "scripts/build-orchard-assets.py (SPECS); the orchard layout reads manifest.footprints",
        "coordinateSpace": "cell-local pixels, origin top-left, x right, y down; world units at scale 1",
        "cell": CELL,
        "anchor": list(ANCHOR),
        "worldAxes": {"xPixelsPerUnit": [-22.627417, 11.313708], "yPixelsPerUnit": [22.627417, 11.313708],
                      "inverse": "x=(2*dv-du)/(32*sqrt2), y=(2*dv+du)/(32*sqrt2) for a pixel offset (du,dv) from contactCenter"},
        "rule": "contactCenter y = 231 - front ground extent (box/rect: (halfWidth+halfDepth)*8*sqrt2, circle: 16*radius), "
                "rounded down to .25 px; x = 128. colliders are boxes in world units relative to the footprint centre; a "
                "mirrored placement swaps x<->y and halfWidth<->halfDepth. role: solid (collider; may cover the hero), low "
                "(collider; at most 1.1u high, never hides the hero), flat (ground layer, walkable, no collider). tall: "
                "the drawing rises far above a small trunk or post collider (the renderer fades it over the hero); "
                "canopy: the crown's ground radius in world units. contact: corners (drawn ground corners within 1.6 px "
                "of every collider corner), loose (organic edge on the footprint), none. mirror: the frame has no lit "
                "side and may be mirrored.",
        "frames": {name: contract_record(SPECS[name]) for name in FRAMES},
    }


def draw_frame(name, records):
    record = records[name]
    cv = Canvas(record["contactCenter"])
    DRAW[name](cv)
    colors = cv.finish(outline=record["role"] != "flat")
    return to_image(colors)


# --------------------------------------------------------------------------
# Ground surface: a clover meadow. The camp meadow's patch structure and blade
# clusters, a little greener, with clover trefoil mats and a few white heads.
# --------------------------------------------------------------------------

SURFACE = 128
SURFACE_PALETTE = {
    "G_SH": "#454a34", "OG_D2": "#525b3d", "OG_D1": "#5f6843", "OG_B": "#6b7349", "OG_L": "#7a8150",
    "OG_H1": "#8d9256", "G_H2": "#a89f5d", "CL1": "#58703f", "CL_HI": "#73904c", "FL": "#cfcbb0",
}
CAMP_GRASS_SHARED = ("G_SH", "G_H2")  # the camp meadow's shade and blade tip, same hex


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


TREFOIL = ((0, -1, "CL_HI"), (-1, 0, "CL_HI"), (0, 0, "CL1"), (1, 0, "CL1"), (0, 1, "CL1"), (1, 1, "G_SH"))
CLOVER_HEAD = ((0, -1, "FL"), (-1, 0, "FL"), (0, 0, "FL"), (1, 0, "CL1"), (0, 1, "G_SH"))


def orchard_grass():
    rng = random.Random(5301)
    names = []
    for y in range(SURFACE):
        for x in range(SURFACE):
            v = patch_value(x, y, 5310)
            tone = "OG_L" if v > 0.64 else "OG_B" if v > 0.4 else "OG_D1" if v > 0.28 else "OG_D2"
            if ihash(x, y, 5317) < 0.03:
                tone = "OG_D1" if tone in ("OG_L", "OG_B") else "G_SH"
            names.append(tone)

    def at(x, y):
        return (y % SURFACE) * SURFACE + x % SURFACE

    def clover(x, y):
        return 0.6 * tile_noise(x + 0.5, y + 0.5, 8, 5320) + 0.4 * tile_noise(x + 0.5, y + 0.5, 16, 5321)

    trefoils = heads = 0
    for _ in range(900):
        x, y = rng.randrange(SURFACE), rng.randrange(SURFACE)
        if clover(x, y) < 0.52:
            continue
        for dx, dy, tone in TREFOIL:
            names[at(x + dx, y + dy)] = tone
        trefoils += 1
    for _ in range(400):
        x, y = rng.randrange(SURFACE), rng.randrange(SURFACE)
        if clover(x, y) < 0.6 or heads >= 14:
            continue
        for dx, dy, tone in CLOVER_HEAD:
            names[at(x + dx, y + dy)] = tone
        heads += 1
    # Short blade clusters point screen-up: one texel -col, +row per step (the camp meadow's rule).
    for _ in range(130):
        cx, cy = rng.randrange(SURFACE), rng.randrange(SURFACE)
        if clover(cx, cy) > 0.56:
            continue
        for _ in range(rng.randint(2, 5)):
            bx, by = cx + rng.randint(-3, 3), cy + rng.randint(-3, 3)
            length = rng.choice((2, 2, 3))
            names[at(bx + 1, by - 1)] = "G_SH" if rng.random() < 0.5 else "OG_D2"
            for k in range(length):
                names[at(bx - k, by + k)] = "G_H2" if k == length - 1 and rng.random() < 0.5 else "OG_H1"
    return surface_image(names, SURFACE_PALETTE), {"trefoils": trefoils, "cloverHeads": heads}


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


def flat_outside(cell, record):
    """Decal pixels beyond their rectangle plus a 0.1u margin (they are the walkable area)."""
    if record["role"] != "flat":
        return 0
    cx, cy = record["contactCenter"]
    count = 0
    for i, a in enumerate(pixels(cell.getchannel("A"))):
        if not a:
            continue
        du, dv = i % CELL + 0.5 - cx, i // CELL + 0.5 - cy
        x, y = (2 * dv - du) / (32 * SQ2), (2 * dv + du) / (32 * SQ2)
        if abs(x) > record["halfWidth"] + 0.1 or abs(y) > record["halfDepth"] + 0.1:
            count += 1
    return count


def frame_report(name, cell, record):
    alpha = pixels(cell.getchannel("A"))
    opaque = [(i % CELL, i // CELL) for i, a in enumerate(alpha) if a]
    colors = {p[:3] for p in pixels(cell) if p[3]}
    polygon = footprint_polygon(record)
    on_footprint = sum(1 for x, y in opaque if inside(polygon, x + 0.5, y + 0.5))
    box = cell.getchannel("A").getbbox()
    if record["shape"] == "circle":
        ground = [round(2 * record["radius"], 2)] * 2
    else:
        ground = [round(2 * record["halfWidth"], 2), round(2 * record["halfDepth"], 2)]
    report = {"frame": name, "bbox": list(box), "size": [box[2] - box[0], box[3] - box[1]],
              "groundSizeU": ground, "drawnHeightU": round((record["contactCenter"][1] - box[1]) / KZ, 2),
              "opaquePixels": len(opaque), "colors": len(colors), "maxOpaqueRow": max(y for _, y in opaque),
              "opaqueOnFootprint": on_footprint, "contactCenter": record["contactCenter"], "role": record["role"]}
    gaps = contact_gaps(cell, record)
    if gaps:
        report["contactGaps"] = gaps
        report["maxContactGap"] = max(g["gap"] for g in gaps)
    if record["role"] == "flat":
        report["pixelsOutsideRect"] = flat_outside(cell, record)
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
            if record.get("canopy"):
                r = record["canopy"]
                draw.ellipse((x + cx - 32 * r, y + cy - 16 * r, x + cx + 32 * r, y + cy + 16 * r), outline="#9be15d")
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
    """Orchard frames, camp and ruins props and the monk, placed by footprint on one ground image."""

    def __init__(self, image, origin, cells, records, images):
        self.image, self.origin, self.cells, self.records = image, origin, cells, records
        self.items, self.flat = [], []
        camp, ruins = read_json(ROOT / INPUTS["campManifest"]), read_json(ROOT / INPUTS["ruinsManifest"])
        self.others = {"camp": (images["campAtlas"], camp["campPanorama"], camp["footprints"]),
                       "ruins": (images["ruinsAtlas"], ruins["monasteryRuins"], ruins["footprints"])}
        monk = read_json(ROOT / INPUTS["monkManifest"])["monk"]
        self.monk = sprite_cell(images["monkAtlas"], monk["clips"]["idle"]["front"][0], monk["cell"], monk["columns"])
        self.monk_anchor = tuple(monk["anchor"])

    def add(self, sprite, contact, x, y, extent, actor=None):
        hw, hd = extent
        self.items.append({"sprite": sprite, "contact": contact, "x": x, "y": y, "actor": actor,
                           "x0": x - hw, "x1": x + hw, "y0": y - hd, "y1": y + hd, "key": x + y})

    def place(self, cell, record, x, y):
        if record["role"] == "flat":
            self.flat.append((cell, record["contactCenter"], x, y))
            return
        extent = (record["radius"],) * 2 if record["shape"] == "circle" else (record["halfWidth"], record["halfDepth"])
        self.add(cell, record["contactCenter"], x, y, extent)

    def prop(self, name, x, y):
        self.place(self.cells[FRAMES.index(name)], self.records[name], x, y)

    def other(self, kind, name, x, y):
        atlas, meta, prints = self.others[kind]
        cell = sprite_cell(atlas, meta["frames"].index(name), meta["cell"], meta["columns"])
        self.place(cell, prints[name], x, y)

    def hero(self, x, y):
        self.add(self.monk, self.monk_anchor, x, y, (0.3, 0.3), actor=0.42)

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


def orchard_mock(cells, records, images, grass):
    """A 16 x 10u corner of the walled orchard on the camp meadow, ruins walls behind, camp cypress and bush."""
    size = (800, 520)
    origin = (404, 300)
    meadow = images["campGrass"]

    def pick(x, y):
        edge = min(x + 7.4, 7.6 - x, y + 4.4, 4.8 - y)
        jitter = vnoise(x * 1.7, y * 1.7, 5401) * 0.9 - 0.45 + (ihash(math.floor(x * 32), math.floor(y * 32), 5402) - 0.5) * 0.3
        return grass if edge + jitter > 0.4 else meadow

    image = ground_image(size, origin, pick)
    stage = Stage(image, origin, cells, records, images)
    for name, x, y in (("gravel-path", 3.2, 3.4), ("gravel-path", 1.4, 1.6), ("fallen-olives", -0.6, -3.0),
                       ("leaf-litter", -3.6, -1.4), ("pruned-branches", 5.8, 4.0), ("fallen-olives", 4.6, -2.6)):
        stage.prop(name, x, y)
    for kind, name, x, y in (("ruins", "wall-run-x", -5.4, -5.1), ("ruins", "wall-end-x", -1.9, -5.1),
                             ("ruins", "parapet-x", 4.2, 5.4), ("camp", "cypress-medium", -8.6, -4.6),
                             ("camp", "bush-round", 1.6, -5.4), ("camp", "bush-round", 8.6, 3.4),
                             ("camp", "cypress-medium", 8.4, -4.0)):
        stage.other(kind, name, x, y)
    for name, x, y in (("vine-clump", -6.4, -4.0), ("olive-tree-old", -4.4, -2.8), ("olive-tree-a", -1.0, -4.2),
                       ("pergola-x", 2.6, -3.2), ("olive-tree-c", 5.4, -4.0), ("olive-press", 5.6, -1.6),
                       ("terracotta-jars", 6.9, -2.9), ("olive-baskets", 4.4, -0.4),
                       ("trellis-y", -7.0, 3.4), ("monk-statue", -6.4, -1.2), ("olive-tree-b", -6.6, 1.6),
                       ("beehive-pair", -0.4, 4.6), ("fig-young", -3.0, 3.6),
                       ("well", 0.0, 0.2), ("stone-basin", 1.6, -1.2), ("garden-bench-y", -2.6, -0.6),
                       ("herb-bed-x", 4.4, 2.0), ("herb-bed-y", 1.4, 3.6), ("olive-dead", 7.0, 2.6),
                       ("cart-broken-x", 6.4, 0.4)):
        stage.prop(name, x, y)
    stage.hero(1.8, 2.0)
    stage.render()
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, size[0], 16), fill="#20282e")
    draw.text((6, 3), "orchard mock 16x10u at 1:1: orchard props on orchard-grass; ruins wall and parapet, camp cypress "
                      "and bush on the camp meadow; monk for scale", fill="#e3e4d8")
    return image.convert("RGB")


def style_match(cells, records, images):
    size = (1280, 340)
    origin = (600, 200)
    image = ground_image(size, origin, lambda x, y: images["campGrass"])
    stage = Stage(image, origin, cells, records, images)
    row = [("camp", "cypress-medium", -10.0), ("orchard", "olive-tree-a", -8.4), ("ruins", "column-broken", -6.6),
           ("orchard", "monk-statue", -5.4), ("ruins", "wall-end-y", -4.0), ("orchard", "pergola-y", -1.7),
           ("camp", "bush-round", 0.4), ("orchard", "vine-clump", 1.5), ("ruins", "parapet-x", 3.6),
           ("orchard", "well", 6.0), ("orchard", "terracotta-jars", 7.6), ("orchard", "beehive-pair", 9.0)]
    for kind, name, s in row:
        if kind == "orchard":
            stage.prop(name, 1.5 - s, 1.5 + s)
        else:
            stage.other(kind, name, 1.5 - s, 1.5 + s)
    stage.hero(1.5 - 11.2, 1.5 + 11.2)
    stage.render()
    draw = ImageDraw.Draw(image)
    for n, (kind, name, s) in enumerate(row):
        sx, sy = to_screen(origin, 1.5 - s, 1.5 + s)
        draw.text((round(sx) - 3 * len(name), round(sy) + 30 + 14 * (n % 2)), name, fill="#e3e4d8" if kind == "orchard" else "#b9c2b0")
    draw.rectangle((0, 0, size[0], 16), fill="#20282e")
    draw.text((6, 3), "style match at 1:1 on the camp meadow: camp-panorama and monastery-ruins props beside orchard frames; monk for scale",
              fill="#e3e4d8")
    return image.convert("RGB")


README = """# Orchard package («Сад обители»)

Programmatic pixel art for the monastery's walled orchard and kitchen garden, abandoned since the ritual began:
gnarled olive trees, a well, an olive press, pergolas and trellises, beehives, benches, a broken handcart, baskets,
terracotta jars, a worn statue of a seated monk, herb beds and ground litter. It is drawn in the camp panorama and
monastery ruins language (rounded chipped stone with moss and blue-green shade, the camp's warm crate wood) so the
orchard reads as the same world. Every pixel is drawn by `scripts/build-orchard-assets.py` from fixed geometry, fixed
seeds and one explicit palette. No image generation, network access or new dependency is involved.

## Runtime use

- Not wired yet: no file in `src/` loads this package. The zone layout (west of the monastery courtyard) will
  register the atlas key `orchard` and place frames by `manifest.footprints`, exactly like the pixel-v9 props in
  `src/camp-layout.js` and the pixel-v11 ruins in `src/courtyard-layout.js` (`put()`).
- Roles follow the ruins package: `solid` blocks walking, `low` blocks walking but stays at most 1.1u high so it
  never hides the hero, `flat` is a ground decal without a collider.
- `tall` frames (trees, pergolas) collide only at their trunk or posts; the renderer fades them over the hero.
- Ground: `orchard-grass.png` follows the pixel-v6 surface contract (sample at `worldXZ / 4` with repeat).

Frame names and footprints are therefore part of the runtime contract.

## Contents

| File | Contents |
| --- | --- |
| `orchard.png` | Atlas, cell 256 px, 4 columns × 8 rows, registration anchor `[128,232]`, binary alpha, {prop_colors} opaque colours. |
| `orchard-grass.png` | Opaque 128 × 128 clover meadow (4u, 32 px/u), seamless on both axes, {surface_colors} colours. |
| `hit-masks.json` | Little-bit-first mask of the atlas alpha, keyed by `orchard.png`. |
| `manifest.json` | Runtime contract: atlas slicing, frame keys, surface, footprints, `opaqueBounds` (opaque `[x0,y0,x1,y1]` box of each cell, exclusive end, as in pixel-v9). |
| `frames/*.png` | One 256 px cell per frame. |
| `previews/` | Contact sheets (native, 2×), footprint overlay (footprint yellow, colliders teal, canopy green), a 16 × 10u mock orchard on the camp meadow with ruins and camp props and the monk, a style match row, 3×3 surface repeats (native, 2×). |
| `source/footprints.json` | Geometry contract the art was drawn to (written by the script from `SPECS`). |
| `source/palette.json`, `source/provenance.json`, `qa-report.json` | Palette with the source package of every colour, input hashes, per-frame checks. |

Frames, in atlas order: {frame_list}.

## Frames

- Olive trees (silver-green crowns, gnarled twisted trunks, trunk collider only): `olive-tree-a` (≈3.1u, three
  cords twisting into one trunk), `olive-tree-b` (≈2.9u, one stout leaning trunk, a wide lopsided crown),
  `olive-tree-c` (≈3.3u, two trunks split in a V), `olive-tree-old` (landmark, ≈3.8u, a ring of massive cords round
  a hollow that opens toward the viewer, buttress roots), `olive-dead` (bleached split cords, bare limbs snapped
  short, a few dry leaves), `fig-young` (≈1.9u, smooth grey stems, broad fresh leaves). `canopy` gives each
  crown's ground radius.
- `well`: a round well head of two stone courses 1.6u across, a dark shaft, a wooden frame with a little gable roof,
  a windlass and a hanging bucket (landmark).
- `olive-press`: a round stone basin, a central pivot with a timber post, a millstone on edge in the trough and a
  wooden axle beam through it (landmark).
- `pergola-x/-y`: four stone posts, two timber beams, rafters and grapevines over the top; `pergola-broken-x/-y`:
  the front post snapped to a stump (collider note `stump`), its beam slanting down onto it, fallen rafters.
  Colliders on the posts only.
- `trellis-x/-y`: a low vine fence of three posts and two laths (role `low`).
- `beehive-pair`: two straw skeps on a stone bench; `beehive-fallen`: the bench slab slopes to the ground, one
  skep lies on its side.
- `stone-basin`: a dry trough hollowed from one block. `garden-bench-x/-y`: a timber seat and backrest on two stone
  feet, one back board gone.
- `cart-broken-x/-y`: a wooden handcart down on one corner, its far wheel flat in the grass, the shafts on the ground.
- `olive-baskets` (two heaped wicker baskets and a third tipped over, spilling), `terracotta-jars` (a tall jar, a
  two-handled jar, a small jar on its side and a broken foot with shards).
- `monk-statue`: a worn, hooded stone monk seated on a coursed, mossy plinth with an offering bowl (≈1.8u, landmark).
- `herb-bed-x/-y`: raised beds with a kerb of rounded stones, dark soil and rows of herbs with lavender;
  `herb-bed-overgrown` (kerb stones tumbled, weeds spilling over); `vine-clump` (a vine stump in a low leaf mound).
- Flat ground decals (role `flat`, ground layer, no outline): `fallen-olives`, `leaf-litter`, `gravel-path`
  (lit from above only, may be mirrored), `pruned-branches`.

Both orientations of every lit, asymmetric prop are drawn (`-x` and `-y`): a mirror would put the shade-side colours
on the lit face. No magenta, turquoise or amber glow appears in this package.

## Registration

`[128,232]` is a fixed registration point, not a footprint centre. Each frame's ground footprint is
`footprints.<frame>`: `contactCenter` in cell pixels plus a world-space shape (`box`/`rect`: `halfWidth` along
world x = screen down-left, `halfDepth` along world y = screen down-right; `circle`: `radius`). The front-most
footprint point sits on row 231. Pixel offset `(du,dv)` from `contactCenter` maps to world `x=(2dv-du)/(32√2)`,
`y=(2dv+du)/(32√2)`; mirrored placements swap the roles of x and y. Placement works exactly like the pixel-v9
props in `src/camp-layout.js` (`put()`): sprite position = footprint centre − `toWorld(contactCenter − anchor)`.

Extensions over pixel-v9 (as in pixel-v11): `colliders` (the pergola posts, world units relative to the footprint
centre), `axis`, `tall`, `canopy`, `landmark`, `mirror` and `contact` (`corners`: every collider's front,
screen-left and screen-right ground corner lies within 1.6 px of the drawing; `loose`: organic edge; `none`).

## Ground surface

`manifest.surfaces.orchardGrass` follows the pixel-v6 surface contract: sample at `worldXZ / 4` with repeat. Image
columns run along world +x and rows along world −y (textures load with `invertY`). The structure is the camp
meadow's (three octaves of wrapping patch noise, short blade clusters pointing screen-up), a little greener, with
mats of clover trefoils and a few white clover heads. `G_SH` and `G_H2` are the camp meadow's own shade and blade
tip, so the two meadows meet without a visible change of light.

## Rebuild and verify

From the repository root (tested with Python {python}, Pillow {pillow}):

```sh
python3 -B scripts/build-orchard-assets.py
python3 -B scripts/build-orchard-assets.py --verify-only
node --test tests/orchard-assets.test.js
```

`--verify-only` redraws every delivered file in memory, compares bytes and input hashes, writes nothing and exits
non-zero on any difference. Byte identity is guaranteed only with the recorded Pillow version. The provenance
records the input hashes of the camp, ruins and monk files, so a change to those inputs makes verify fail until the
package is rebuilt.

## Limits

- Programmatic drawing: masonry and wood are a heightfield of rounded, chipped blocks with patterned faces; jars,
  skeps, baskets and the bucket are ray-marched solids of revolution; bark, the statue and foliage are ray-cast
  ellipsoids and hand-placed pixel tufts. Faces are flat planes; individual face blocks do not protrude.
- No animation (no swaying leaves, no bees).
- Crowns are wide and opaque. The tree colliders are small, so the hero walks under a crown; the runtime has to fade
  `tall` frames over the hero, as it does for the camp cypresses.
- The statue is small at native scale (1.8u); its face is a dark hood opening, not a carved face.
- Colliders and placement are the zone layout's decision; footprints are the drawing contract.
"""


def palette_sources():
    camp = read_json(ROOT / INPUTS["campPalette"])["props"]
    ruins = read_json(ROOT / INPUTS["ruinsPalette"])["props"]
    shared_camp = sorted(name for name, value in PALETTE.items() if name in camp and camp[name]["hex"] == value)
    shared_ruins = sorted(name for name, value in PALETTE.items() if name in ruins and ruins[name]["hex"] == value)
    return shared_camp, shared_ruins


NEW_COLOR_NOTES = {
    "O_HI": "olive leaf, lit silver side", "O1": "olive leaf, silver-green", "V_HI": "vine and fig leaf, lit",
    "V1": "vine and fig leaf", "TC_HI": "terracotta, lit", "TC1": "terracotta", "LV": "lavender spikes",
}


def glow_kind(rgb):
    r, g, b = rgb
    if r - g > 50 and b - g > 50:
        return "magenta"
    if g - r > 50 and b - r > 50:
        return "cyan"
    return None


def build_outputs():
    records = contract()["frames"]
    assert list(records) == FRAMES and len(FRAMES) == COLUMNS * ROWS
    assert len(set(PALETTE.values())) == len(PALETTE), "palette hex values must be unique"
    images = {key: load_rgba(ROOT / path) for key, path in INPUTS.items() if path.endswith(".png")}
    cells = [draw_frame(name, records) for name in FRAMES]
    atlas = Image.new("RGBA", (CELL * COLUMNS, CELL * ROWS), (0, 0, 0, 0))
    for i, cell in enumerate(cells):
        atlas.alpha_composite(cell, ((i % COLUMNS) * CELL, (i // COLUMNS) * CELL))
    atlas_colors = sorted({p[:3] for p in pixels(atlas) if p[3]})
    assert len(atlas_colors) <= PALETTE_BUDGET, f"palette budget exceeded: {len(atlas_colors)}"
    by_rgb = {hexrgb(value): name for name, value in PALETTE.items()}
    unused = sorted(set(PALETTE) - {by_rgb[c] for c in atlas_colors})
    assert not unused, f"unused palette entries: {unused}"
    assert not [c for c in atlas_colors if glow_kind(c)], "glow colour in the orchard atlas"
    shared_camp, shared_ruins = palette_sources()
    shared = sorted(set(shared_camp) | set(shared_ruins))
    assert len(shared) >= SHARED_MINIMUM, f"only {len(shared)} shared colours"
    reports = [frame_report(name, cell, records[name]) for name, cell in zip(FRAMES, cells)]
    for report in reports:
        assert report["maxOpaqueRow"] <= LAST_ROW, f"{report['frame']} draws below the anchor"
        assert report["opaqueOnFootprint"] > 0, f"{report['frame']} does not touch its footprint"
        assert report.get("maxContactGap", 0) <= 1.6, f"{report['frame']} contact gap {report.get('maxContactGap')}"
        assert report.get("pixelsOutsideRect", 0) <= 4, f"{report['frame']} decal spills outside its rectangle"
    grass, grass_stats = orchard_grass()
    surface_colors = len(set(pixels(grass)))
    assert 8 <= surface_colors <= 12, f"surface colours {surface_colors}"
    grass_report = surface_report(grass)
    camp_grass = surface_report(images["campGrass"].convert("RGB"))
    assert grass_report["mean"][1] - grass_report["mean"][0] > camp_grass["mean"][1] - camp_grass["mean"][0] + 4, "not greener"
    outputs = {}
    outputs["orchard.png"] = png_bytes(atlas)
    outputs["orchard-grass.png"] = png_bytes(grass)
    for name, cell in zip(FRAMES, cells):
        outputs[f"frames/{name}.png"] = png_bytes(cell)
    outputs["hit-masks.json"] = json_bytes({ATLAS_PATH: pack_mask(atlas)})
    outputs["previews/contact-native.png"] = png_bytes(contact_sheet(cells, 1))
    outputs["previews/contact-2x.png"] = png_bytes(contact_sheet(cells, 2))
    outputs["previews/footprints-native.png"] = png_bytes(contact_sheet(cells, 1, records))
    outputs["previews/orchard-grass-repeat-native.png"] = png_bytes(repeat_preview(grass, 1))
    outputs["previews/orchard-grass-repeat-2x.png"] = png_bytes(repeat_preview(grass, 2))
    grass_rgba = grass.convert("RGBA")
    outputs["previews/orchard-mock.png"] = png_bytes(orchard_mock(cells, records, images, grass_rgba))
    outputs["previews/style-match.png"] = png_bytes(style_match(cells, records, images))
    outputs["source/footprints.json"] = json_bytes(contract())

    def source(name):
        if name in shared_camp:
            return "campPanorama"
        return "monasteryRuins" if name in shared_ruins else "new"

    outputs["source/palette.json"] = json_bytes({
        "schemaVersion": 1,
        "method": "Camp panorama and monastery ruins ramps reused by name and hex (stone, moss, bush foliage, bark, crate "
                  "wood, rope straw, soil); seven additions for the olive leaf, fresh leaf, terracotta and lavender.",
        "props": {name: {"hex": value, "source": source(name), **({"note": NEW_COLOR_NOTES[name]} if name in NEW_COLOR_NOTES else {})}
                  for name, value in PALETTE.items()},
        "surfaces": {"orchardGrass": {name: {"hex": value, "source": "campPanorama campGrass" if name in CAMP_GRASS_SHARED else "new"}
                                      for name, value in SURFACE_PALETTE.items()}},
        "sharedWithCampPanorama": shared_camp,
        "sharedWithMonasteryRuins": shared_ruins,
        "sharedColors": len(shared),
    })
    input_hashes = {key: {"path": path, "sha256": digest((ROOT / path).read_bytes())} for key, path in INPUTS.items()}
    outputs["source/provenance.json"] = json_bytes({
        "schemaVersion": 1,
        "method": "programmatic drawing: heightfield masonry and wood (rounded, chipped blocks; coursed, ring and plank "
                  "face patterns) splatted into a z-buffer with grounded and floating passes, ray-marched solids of "
                  "revolution for jars, skeps, baskets and the bucket, ray-cast ellipsoids for bark, the statue and "
                  "foliage shells with hand-pixel tufts, screen-space flat decals, and a wrapping clover meadow surface",
        "generator": "scripts/build-orchard-assets.py",
        "rendererOrigin": "Canvas, ellipsoid, rod, tuft, base_grass, the heightfield masses and the rock tone rules are "
                          "adapted copies of scripts/build-camp-panorama-assets.py and scripts/build-monastery-ruins-assets.py "
                          "(copied, not imported, so their edits never change these bytes)",
        "imageGeneration": None,
        "tools": {"python": sys.version.split()[0], "pillow": PILLOW_VERSION},
        "inputs": input_hashes,
        "inputRoles": {
            "campAtlas": "camp props in the mock and the style match", "campManifest": "camp frame order and footprints",
            "campPalette": "shared colour names and values", "campGrass": "preview meadow; greener-than check",
            "ruinsAtlas": "ruins wall and parapet in the mock and the style match", "ruinsManifest": "ruins frame order and footprints",
            "ruinsPalette": "shared colour names and values", "monkAtlas": "unchanged hero for scale", "monkManifest": "idle frame index",
        },
        "seeds": "fixed integer salts in the script; random.Random only",
        "license": "project art; no external assets",
    })
    outputs["qa-report.json"] = json_bytes({
        "schemaVersion": 1,
        "atlas": {"size": list(atlas.size), "opaqueColors": len(atlas_colors), "sharedColors": len(shared),
                  "binaryAlpha": True, "glowColors": []},
        "frames": reports,
        "surfaces": {"orchardGrass": {**grass_report, **grass_stats, "campGrassMean": camp_grass["mean"]}},
    })
    manifest = {
        "schemaVersion": 1, "status": "ready", "nativePixelsPerUnit": 32,
        ATLAS_KEY: {"path": ATLAS_PATH, "cell": CELL, "columns": COLUMNS, "rows": ROWS,
                    "anchor": list(ANCHOR), "frames": FRAMES, "filter": "nearest", "mipmaps": False},
        "surfaces": {"orchardGrass": {"path": "orchard-grass.png", "size": [SURFACE, SURFACE],
                                      "filter": "nearest", "mipmaps": False}},
        "footprints": records,
        "opaqueBounds": {report["frame"]: report["bbox"] for report in reports},
        "hitMasks": "hit-masks.json", "provenance": "source/provenance.json", "palette": "source/palette.json",
        "previews": "previews/contact-native.png",
    }
    outputs["manifest.json"] = json_bytes(manifest)
    outputs["README.md"] = README.format(
        prop_colors=len(atlas_colors), surface_colors=surface_colors, frame_list=", ".join(f"`{n}`" for n in FRAMES),
        python=sys.version.split()[0], pillow=PILLOW_VERSION).encode()
    return outputs, {"atlasColors": len(atlas_colors), "sharedColors": len(shared), "surfaceColors": surface_colors,
                     "surfaceMean": grass_report["mean"], "files": len(outputs),
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
