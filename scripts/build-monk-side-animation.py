#!/usr/bin/env python3
"""Build/verify the monk's side-view (screen-right) idle and run. Python 3.10+, Pillow >=10,<13.

    python3 scripts/build-monk-side-animation.py                # write the package
    python3 scripts/build-monk-side-animation.py --verify-only  # rebuild in memory and compare; no writes

No generation, network, numpy, browser or runtime modification occurs here. Run from
any working directory. The ten side keys are a cut-out rig:
  * the upper body (head, torso, arms, beads, sash) is the exact v2 monk drawing of a
    source key: run keys 1-6 for run, the attack1 recovery guard for idle;
  * the lower body (pelvis, legs, feet) is drawn here in profile from joint positions:
    tapered capsules, upper-left light, the v2 trouser/skin ramps and a 1 px ink rim.
    Planted feet sit on a ground track that moves 18 px (32 px/u * .56u) per key.
Appearance variants apply the v3 material maps (seven-step skin, five-step sash) and the
v3 hair ramp to the v3 per-pose scalp regions of the reused heads. Rows 0-9 of every
variant atlas are the shipped v3 atlas byte for byte; row 10 holds the ten side keys.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
from io import BytesIO
import json
import math
from pathlib import Path
import platform

from PIL import Image, ImageDraw, __version__ as PILLOW_VERSION

ROOT = Path(__file__).resolve().parents[1]
PKG = Path("assets/game/pixel-v10/monk-side")
MONK = Path("assets/game/pixel-v2/monk")
LOOK = Path("assets/game/pixel-v3/appearance")
NEAREST = Image.Resampling.NEAREST
CELL, ANCHOR, COLUMNS, BASE_ROWS = 96, (48, 84), 10, 10
SOLE = 83                       # lowest opaque row of a planted foot (v2 bbox bottom is 84)
KEY_DISTANCE = .56              # src/pixel-animation.js MONK_RUN_KEY_DISTANCE
TRACK = 18                      # round(32 px/u * .56u): a planted foot moves back this far per key
SIDE = [("idle", 4), ("run", 6)]
SIDE_NAMES = [f"{clip}-side-{k + 1:02d}" for clip, n in SIDE for k in range(n)]
SIDE_FIRST = COLUMNS * BASE_ROWS  # absolute index of idle-side-01
# Cells of each atlas row 10, in SIDE_NAMES order: idle 100-103, run 104-109.

# ---------------------------------------------------------------------------
# Upper bodies reused from the v2 atlas
# ---------------------------------------------------------------------------
# frame: v2 index; cut: trousers at or below this row belong to the old legs; waist:
# x-range and row of the old trouser top edge, where the profile pelvis attaches.
UPPER = {
    "run-1": {"frame": 4, "cut": 52, "waist": (42, 57, 53)},
    "run-2": {"frame": 5, "cut": 56, "waist": (44, 60, 57)},
    "run-3": {"frame": 6, "cut": 48, "waist": (44, 60, 48)},
    "run-4": {"frame": 7, "cut": 51, "waist": (46, 60, 52)},
    "run-5": {"frame": 8, "cut": 51, "waist": (47, 60, 52)},
    "run-6": {"frame": 9, "cut": 46, "waist": (47, 60, 50)},
    "guard": {"frame": 14, "cut": 49, "waist": (43, 60, 49)},
}

# ---------------------------------------------------------------------------
# Profile lower-body rig (cell pixels; x forward = screen right, y down)
# ---------------------------------------------------------------------------
THIGH, SHIN = 14.0, 14.5
FOOT = [(-2.6, -3.4), (2.2, -3.4), (3.4, -.6), (6.6, .6), (9.6, 1.6), (10.4, 2.9), (10.0, 3.6), (-3.2, 3.6), (-3.8, 1.2)]  # ankle frame
TOE = (9.2, 3.6)
LIGHT = (-.52, -.68, .52)

# Per key: hip joint (x, y), the reused upper body, and each leg's foot. "flat" feet
# stand on the sole row at hip x + dx; a "toe" foot pivots on the toe tip of the
# previous key's flat foot, moved one TRACK back; "swing" feet give ankle (dx, y) and
# pitch (degrees, + = toes down). "near" is the monk's right leg, nearest the camera.
# Keys 1-3 plant the near foot, keys 4-6 the far foot (v2: right/left support).
RUN = [
    # key 1: right (near) heel/flat contact ahead; left trails just after toe-off
    {"upper": "run-1", "hip": (48, 57), "near": ("flat", 10), "far": ("swing", (-21, 69), 55)},
    # key 2: right foot under the body, deepest knee bend; left passes behind
    {"upper": "run-2", "hip": (48, 59), "near": ("flat", -8), "far": ("swing", (-7, 70), 40)},
    # key 3: right toes push off, heel high; left knee drives forward
    {"upper": "run-3", "hip": (48, 55), "near": ("toe", -8 - TRACK), "far": ("swing", (9, 74), -8)},
    {"upper": "run-4", "hip": (48, 57), "far": ("flat", 10), "near": ("swing", (-21, 69), 55)},
    {"upper": "run-5", "hip": (48, 59), "far": ("flat", -8), "near": ("swing", (-7, 70), 40)},
    {"upper": "run-6", "hip": (48, 55), "far": ("toe", -8 - TRACK), "near": ("swing", (9, 74), -8)},
]
IDLE = [
    {"upper": "guard", "hip": (48, 56 + bob), "near": ("flat", 11), "far": ("flat", -14), "tails": sway}
    for bob, sway in ((0, 0), (-1, 0), (0, 1), (1, 1))
]


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def read_json(path):
    return json.loads((ROOT / path).read_text())


def sha(data):
    return hashlib.sha256(data).hexdigest()


def png_bytes(im):
    stream = BytesIO()
    im.save(stream, format="PNG", optimize=False, compress_level=9)
    return stream.getvalue()


def flat(image):
    method = getattr(image, "get_flattened_data", None)
    return list(method() if method is not None else image.getdata())


def ramps():
    palette = read_json(MONK / "palette.json")
    return {name: [tuple(bytes.fromhex(c)) for c in colors] for name, colors in palette.items()}


def cell(atlas, index, columns=COLUMNS):
    x, y = index % columns * CELL, index // columns * CELL
    return atlas.crop((x, y, x + CELL, y + CELL))


# A plane maps (x, y) -> (material, ramp step) in cell space.
def plane_of(image, reference):
    lookup = {c: (m, i) for m, ramp in reference.items() for i, c in enumerate(ramp)}
    px = image.load()
    return {(x, y): lookup[px[x, y][:3]] for y in range(image.height) for x in range(image.width) if px[x, y][3]}


def connected(seeds, allowed):
    """4-connected closure of seeds within the allowed pixel set."""
    found, todo = set(), [p for p in seeds if p in allowed]
    while todo:
        p = todo.pop()
        if p in found:
            continue
        found.add(p)
        todo += [q for q in ((p[0] + 1, p[1]), (p[0] - 1, p[1]), (p[0], p[1] + 1), (p[0], p[1] - 1)) if q in allowed]
    return found


def upper_body(base, reference, spec):
    """The v2 drawing above its old legs.

    Old trousers at or below the cut go. Below the waist row, a coloured pixel survives
    only if it connects to the drawing above the waist (hands, cuffs, hanging sash);
    old feet and knees are islands in the ink and disappear. Ink stays where it still
    outlines a surviving pixel."""
    plane = plane_of(cell(base, spec["frame"]), reference)
    waist = spec["waist"][2]
    color = {p for p, v in plane.items() if v[0] != "ink" and not (v[0] == "trousers" and p[1] >= spec["cut"])}
    sash = {p for p in color if plane[p][0] == "sash"}
    # Sash ends may hang from the belt behind one ink line; let ink beside sash bridge.
    bridges = {(x, y) for (x, y), v in plane.items() if v[0] == "ink"
               and any(n in sash for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))}
    hanging = connected({p for p in color if p[1] < waist}, color | bridges) & color
    kept = {p: plane[p] for p in hanging}
    for (x, y), v in plane.items():
        if v[0] == "ink" and any((x + dx, y + dy) in kept for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            kept[(x, y)] = v
    return kept


def over(base, top):
    result = dict(base)
    result.update(top)
    return result


def outline_of(mask):
    return {(x, y) for x, y in mask
            if any((x + dx, y + dy) not in mask for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}


def capsule(p0, p1, r0, r1):
    """{pixel: (t, s)} inside a tapered capsule; s is the signed offset across it in [-1, 1]."""
    (x0, y0), (x1, y1) = p0, p1
    length = math.hypot(x1 - x0, y1 - y0) or 1e-9
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    r = max(r0, r1)
    result = {}
    for y in range(math.floor(min(y0, y1) - r) - 1, math.ceil(max(y0, y1) + r) + 2):
        for x in range(math.floor(min(x0, x1) - r) - 1, math.ceil(max(x0, x1) + r) + 2):
            cx, cy = x + .5 - x0, y + .5 - y0
            t = max(0., min(1., (cx * ux + cy * uy) / length))
            dx, dy = cx - ux * t * length, cy - uy * t * length
            radius = r0 + (r1 - r0) * t
            d = math.hypot(dx, dy)
            if d <= radius:
                result[(x, y)] = (t, max(-1., min(1., (ux * dy - uy * dx) / radius)), (ux, uy))
    return result


def lit(s, axis):
    """Lambert term of a cylinder pixel at cross offset s around a bone axis."""
    ux, uy = axis
    nx, ny = -uy, ux                       # left normal in screen space
    z = math.sqrt(max(0., 1 - s * s))
    lx, ly, lz = LIGHT
    norm = math.sqrt(lx * lx + ly * ly + lz * lz)
    return (nx * s * lx + ny * s * ly + z * lz) / norm


def two_bone(hip, ankle, upper, lower):
    """Knee position with the knee bent forward (+x); targets must be reachable."""
    (hx, hy), (ax, ay) = hip, ankle
    d = math.hypot(ax - hx, ay - hy)
    if not abs(upper - lower) < d < upper + lower:
        raise ValueError(f"unreachable ankle {ankle} from hip {hip} (distance {d:.2f})")
    base = math.atan2(ay - hy, ax - hx)
    bend = math.acos((upper * upper + d * d - lower * lower) / (2 * upper * d))
    return hx + upper * math.cos(base - bend), hy + upper * math.sin(base - bend)


def rotate(point, degrees):
    a = math.radians(degrees)
    x, y = point
    return x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)


def foot_mask(ankle, pitch):
    """{pixel: (local x, height)} of the foot polygon; height 0 = instep, 1 = sole."""
    poly = [(ankle[0] + x, ankle[1] + y) for x, y in (rotate(p, pitch) for p in FOOT)]
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    inside = {}
    for y in range(math.floor(min(ys)) - 1, math.ceil(max(ys)) + 1):
        for x in range(math.floor(min(xs)) - 1, math.ceil(max(xs)) + 1):
            px, py, hit = x + .5, y + .5, False
            for (ax, ay), (bx, by) in zip(poly, poly[1:] + poly[:1]):
                if (ay > py) != (by > py) and px < ax + (py - ay) * (bx - ax) / (by - ay):
                    hit = not hit
            if hit:
                lx, ly = rotate((px - ankle[0], py - ankle[1]), -pitch)
                inside[(x, y)] = (lx, max(0., min(1., (ly + 3.4) / 7.0)))
    return inside


def draw_foot(ankle, pitch, far):
    mask = foot_mask(ankle, pitch)
    rim = outline_of(set(mask))
    plane = {}
    for p, (lx, h) in mask.items():
        if p in rim:
            plane[p] = ("ink", 0)
            continue
        step = 1 if h < .34 and lx > -1 else 2 if h < .7 else 3
        if lx < -1.4 and h > .45 or h > .86:
            step = 4                      # heel and sole turn away from the light
        if 6.6 < lx < 7.8 and h > .55:
            step = 5                      # toe crease
        plane[p] = ("skin", min(6, step + (1 if far else 0)))
    return plane


def draw_leg(hip, ankle, far, pelvis=None):
    knee = two_bone(hip, ankle, THIGH, SHIN)
    at = lambda t: (knee[0] + (ankle[0] - knee[0]) * t, knee[1] + (ankle[1] - knee[1]) * t)
    # Baggy trousers: the shin balloons, then gathers into a cuff above the ankle.
    parts = [capsule(hip, knee, 5.8, 4.8), capsule(knee, at(.45), 4.8, 5.6), capsule(at(.42), at(.6), 5.6, 4.3)]
    if pelvis:
        parts.insert(0, pelvis)
    shape = {}
    for part in parts:
        for p, v in part.items():
            shape.setdefault(p, v)
    rim = outline_of(set(shape))
    plane = {}
    for p, (t, s, axis) in shape.items():
        light = lit(s, axis)
        if far:
            step = 2 if light > .8 else 1 if light > .3 else 0
        else:
            step = 3 if light > .9 else 2 if light > .52 else 1 if light > .05 else 0
        plane[p] = ("ink", 0) if p in rim else ("trousers", step)
    return plane, knee


def pelvis_shape(hip, waist_width):
    """Seat under the belt: a short wide capsule both thighs grow from."""
    half = max(4., waist_width / 2 - 1)
    return capsule((hip[0] - half + 4, hip[1] - 2), (hip[0] + half - 4, hip[1] - 2), 5.2, 5.2)


def resolve_feet(pose):
    """Ankle + pitch for each leg; planted feet follow the ground track."""
    feet = {}
    for leg in ("near", "far"):
        kind, *args = pose[leg]
        if kind == "flat":
            feet[leg] = ((pose["hip"][0] + args[0], SOLE - 3.0), 0.)
        elif kind == "toe":
            pitch = 60.
            tx, ty = rotate(TOE, pitch)
            # The toe tip stays where the flat foot's toe tip stood one key earlier.
            toe_x = pose["hip"][0] + args[0] + TOE[0]
            feet[leg] = ((toe_x - tx, SOLE + .6 - ty), pitch)
        else:
            (dx, y), pitch = args
            feet[leg] = ((pose["hip"][0] + dx, y), float(pitch))
    return feet


def compose(base, reference, pose):
    """One side key: {pixel: source pixel in the v2 cell} for the reused upper body and
    {pixel: (material, step)} for the drawn lower body, plus its rig record."""
    spec = UPPER[pose["upper"]]
    xa, xb, yb = spec["waist"]
    hx, hy = pose["hip"]
    # The old trouser top lands 3 px above the hip joint, centred on it.
    dx, dy = round(hx - (xa + xb) / 2), hy - 3 - yb
    upper = {(x + dx, y + dy): (x, y) for x, y in upper_body(base, reference, spec)}
    if pose.get("tails"):
        # Idle breath: the hanging sash ends sway one pixel back.
        plane = plane_of(cell(base, spec["frame"]), reference)
        tails = {p for p, q in upper.items() if plane[q][0] != "skin" and p[1] > hy + 2 and p[0] < hx - 4}
        upper = over({p: q for p, q in upper.items() if p not in tails},
                     {(x - pose["tails"], y): upper[(x, y)] for x, y in tails})
    feet = resolve_feet(pose)
    near_hip, far_hip = (hx + 1, hy + 1), (hx - 1, hy)
    far_leg, far_knee = draw_leg(far_hip, feet["far"][0], True)
    near_leg, near_knee = draw_leg(near_hip, feet["near"][0], False, pelvis_shape((hx, hy), xb - xa))
    drawn = {}
    for layer in (draw_foot(*feet["far"], True), far_leg, draw_foot(*feet["near"], False), near_leg):
        drawn.update(layer)                       # back to front; the upper body covers all
    drawn = {p: v for p, v in drawn.items() if p not in upper}
    for p in list(upper) + list(drawn):
        if not (0 < p[0] < CELL - 1 and 0 < p[1] < CELL - 1):
            raise ValueError(f"side key clipped by its cell at {p}")
    rig = {"upperFrame": spec["frame"], "upperOffset": [dx, dy], "hip": [hx, hy]}
    for leg, knee in (("near", near_knee), ("far", far_knee)):
        rig[leg] = {"mode": pose[leg][0], "ankle": [round(v, 2) for v in feet[leg][0]],
                    "pitch": feet[leg][1], "knee": [round(v, 2) for v in knee]}
    return {"frame": spec["frame"], "upper": upper, "drawn": drawn}, rig


def side_keys(base, reference):
    keys, rigs = [], []
    for pose in IDLE + RUN:
        key, rig = compose(base, reference, pose)
        keys.append(key)
        rigs.append(rig)
    return keys, rigs


def render_key(key, source_atlas, table):
    """RGBA side key: drawn materials through the variant's table, upper body copied from
    the variant's own (already recoloured, hair-registered) source cell."""
    im = Image.new("RGBA", (CELL, CELL))
    px, src = im.load(), cell(source_atlas, key["frame"]).load()
    for p, (m, i) in key["drawn"].items():
        px[p] = (*table[m][i], 255)
    for p, q in key["upper"].items():
        px[p] = src[q]
    return im


# ---------------------------------------------------------------------------
# Appearance variants and atlases
# ---------------------------------------------------------------------------

def variant_tables(reference, look_manifest, look_ramps):
    """Material tables per appearance: v2 ramps with the v3 skin and sash ramps swapped in."""
    tables = {}
    for look in look_manifest["variants"]:
        table = dict(reference)
        table["skin"] = [tuple(bytes.fromhex(c)) for c in look_ramps["skin"][look["skin"]]]
        table["sash"] = [tuple(bytes.fromhex(c)) for c in look_ramps["sash"][look["sash"]]]
        tables[look["id"]] = table
    return tables


def assemble(top, keys, table):
    """960x1056 atlas: the 100-key v3 atlas unchanged plus the side row."""
    atlas = Image.new("RGBA", (COLUMNS * CELL, (BASE_ROWS + 1) * CELL))
    atlas.paste(top, (0, 0))
    for i, key in enumerate(keys):
        im = render_key(key, top, table)
        atlas.paste(im, (i * CELL, BASE_ROWS * CELL))
    return atlas


def make_mask(im):
    packed = bytearray((im.width * im.height + 7) // 8)
    for i, value in enumerate(im.getchannel("A").tobytes()):
        if value:
            packed[i >> 3] |= 1 << (i & 7)
    return {"width": im.width, "height": im.height, "bits": base64.b64encode(packed).decode()}


def manifest(v2, look_manifest):
    monk = {k: v for k, v in v2["monk"].items()}
    monk["path"] = "monk-side.png"
    monk["rows"] = BASE_ROWS + 1
    monk["frames"] = v2["monk"]["frames"] + SIDE_NAMES
    clips = json.loads(json.dumps(v2["monk"]["clips"]))
    offset = SIDE_FIRST
    for clip, count in SIDE:
        clips[clip]["side"] = list(range(offset, offset + count))
        offset += count
    monk["clips"] = clips
    monk["timing"] = v2["monk"]["timing"]
    return {
        "schemaVersion": 2, "status": "ready", "nativePixelsPerUnit": 32,
        "monk": monk,
        "hitMasks": "hit-masks.json",
        "authoredFacings": {**v2["authoredFacings"], "side": "E"},
        "logicalFacings": {**v2["logicalFacings"],
                           "E": {"authored": "side", "flipX": False}, "W": {"authored": "side", "flipX": True}},
        "sideClips": [clip for clip, _ in SIDE],
        "sideRun": {"keyDistance": KEY_DISTANCE, "plantedFootPixelsPerKey": TRACK,
                    "plantedKeys": {"near": [1, 2, 3], "far": [4, 5, 6]}, "contactKeys": [1, 4]},
        "inheritedFrom": {"atlas": str(MONK / "manifest.json"), "appearance": str(LOOK / "manifest.json")},
        "appearance": {"default": look_manifest["default"],
                       "variants": [{"id": v["id"], "skin": v["skin"], "hair": v["hair"], "sash": v["sash"],
                                     "path": f"appearance/{v['id']}.png"} for v in look_manifest["variants"]]},
        "rig": "source/rig.json", "provenance": "provenance.json", "previews": "previews/index.html",
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


def contact_sheet(atlas, meta):
    rows = [("idle / side (E)", meta["clips"]["idle"]["side"]), ("run / side (E)", meta["clips"]["run"]["side"]),
            ("run / side mirrored (W)", meta["clips"]["run"]["side"])]
    sheet = checker(6 * CELL, len(rows) * (CELL + 16))
    draw = ImageDraw.Draw(sheet)
    for row, (label, indices) in enumerate(rows):
        draw.text((4, row * (CELL + 16) + 2), label + " / " + ",".join(map(str, indices)), fill="#e6dfcf")
        for col, index in enumerate(indices):
            key = cell(atlas, index)
            if "W" in label:
                key = key.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            sheet.paste(key, (col * CELL, row * (CELL + 16) + 16), key)
    return sheet


def compare_sheet(atlas, meta):
    """Existing SE run (v2 keys) above the new side run, on the shipped floor tile."""
    rows = [("existing run / front (SE)", meta["clips"]["run"]["front"]),
            ("new run / side (E)", meta["clips"]["run"]["side"]),
            ("existing idle / front (SE)", meta["clips"]["idle"]["front"]),
            ("new idle / side (E)", meta["clips"]["idle"]["side"])]
    sheet = floor(6 * CELL, len(rows) * (CELL + 14))
    draw = ImageDraw.Draw(sheet)
    for row, (label, indices) in enumerate(rows):
        y = row * (CELL + 14)
        draw.rectangle((0, y, 6 * CELL - 1, y + 13), fill="#171321")
        draw.text((4, y + 1), label, fill="#eee0ce")
        for col, index in enumerate(indices):
            key = cell(atlas, index)
            sheet.paste(key, (col * CELL, y + 14), key)
    return sheet


def gif_bytes(images, durations):
    stream = BytesIO()
    images[0].save(stream, format="GIF", save_all=True, append_images=images[1:],
                   duration=durations, loop=0, disposal=2, optimize=False)
    return stream.getvalue()


def compare_gif(atlas, meta):
    """SE run, side run E and side run W in step, 3x. Keys hold 100 ms: 5.4 u/s at .56u per key
    is 104 ms, and GIF time has 10 ms steps."""
    views = [("SE (existing)", "front", False), ("E (new)", "side", False), ("W (new, mirror)", "side", True)]
    images = []
    for step in range(6):
        board = floor(len(views) * CELL, CELL + 14)
        draw = ImageDraw.Draw(board)
        for col, (label, facing, flip) in enumerate(views):
            key = cell(atlas, meta["clips"]["run"][facing][step])
            if flip:
                key = key.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            board.paste(key, (col * CELL, 0), key)
            draw.rectangle((col * CELL, CELL, col * CELL + CELL - 1, CELL + 13), fill="#171321")
            draw.text((col * CELL + 3, CELL + 1), f"{label} {step + 1}", fill="#eee0ce")
        images.append(scaled(board, 3))
    return gif_bytes(images, [100] * 6)


def clip_gif(atlas, meta, clip, ms):
    images = []
    for index in meta["clips"][clip]["side"]:
        board = checker(2 * CELL, CELL)
        key = cell(atlas, index)
        board.paste(key, (0, 0), key)
        mirror = key.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        board.paste(mirror, (CELL, 0), mirror)
        images.append(scaled(board, 3))
    return gif_bytes(images, [ms] * len(images))


def track_gif(atlas, meta):
    """The side run crossing the floor at 18 px per key: planted feet must not slide."""
    width, keys = 7 * CELL, meta["clips"]["run"]["side"]
    images = []
    for n in range(18):
        board = floor(width, CELL)
        draw = ImageDraw.Draw(board)
        for x in range(0, width, TRACK):
            draw.line((x, ANCHOR[1], x, ANCHOR[1] + 2), fill="#7ef3ec")
        key = cell(atlas, keys[n % 6])
        board.paste(key, (n * TRACK, 0), key)
        images.append(scaled(board, 2))
    return gif_bytes(images, [100] * len(images))


def track_sheet(atlas, meta, lock):
    """Ground-space strip: key k drawn 18 px further right per key. Guides mark the
    planted soles (cyan: near foot, keys 1-3; amber: far foot, keys 4-6)."""
    keys, top, height = meta["clips"]["run"]["side"], 22, CELL - 22 + 2
    sheet = Image.new("RGB", (CELL + 6 * TRACK + 2, 7 * height), "#211c2b")
    draw = ImageDraw.Draw(sheet)
    for k, color in ((0, "#7ef3ec"), (3, "#edbe75")):
        for x in lock[k]["ground"][0]:
            draw.line((x, 0, x, sheet.height), fill=color)
    for n in range(7):
        y = n * height
        key = cell(atlas, keys[n % 6]).crop((0, top, CELL, CELL))
        draw.line((0, y + ANCHOR[1] - top, sheet.width, y + ANCHOR[1] - top), fill="#4a4157")
        sheet.paste(key, (n * TRACK, y), key)
        draw.text((2, y + 2), f"key {n % 6 + 1}", fill="#eee0ce")
    return sheet


def looks_sheet(atlases, meta, look_manifest):
    sheet = checker(6 * 2 * CELL, 3 * (CELL + 14))
    draw = ImageDraw.Draw(sheet)
    for i, look in enumerate(look_manifest["variants"]):
        x, y = i % 6 * 2 * CELL, i // 6 * (CELL + 14)
        for j, index in enumerate((meta["clips"]["idle"]["side"][0], meta["clips"]["run"]["side"][0])):
            key = cell(atlases[look["id"]], index)
            sheet.paste(key, (x + j * CELL, y), key)
        draw.text((x + 4, y + CELL + 1), look["id"], fill="#e6dfcf")
    return sheet


def html_preview(meta):
    variants = [{"id": v["id"], "path": v["path"]} for v in meta["appearance"]["variants"]]
    body = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Monk Side View</title><style>body{background:#19161f;color:#e6dfcf;font:15px system-ui;margin:24px}select,button,input{font:inherit;margin:6px;padding:4px}canvas{image-rendering:pixelated;background:repeating-conic-gradient(#292532 0 25%,#24212c 0 50%) 0/16px 16px;width:288px;height:288px}figure{display:inline-block;margin:10px}p{color:#b9adbf;max-width:70ch}</style>
<h1>Monk side view: idle and run</h1><p>Exact delivered atlas pixels, 96 px cells, anchor [48,84], nearest filtering. Left to right: existing SE drawing, new E side drawing, W (horizontal mirror). Run keys advance with travel: .56u per key; held 104 ms here (5.4 u/s). Open from disk; it loads only ../appearance/*.png.</p>
<label>Appearance <select id="look"></select></label><label>Clip <select id="clip"><option>run</option><option>idle</option></select></label><button id="pause">Pause</button><label>Key <input id="key" type="range" min="0" max="5" value="0"></label><span id="name"></span><div id="views"></div>
<script>const meta=__META__,variants=__VARIANTS__;const look=document.querySelector('#look'),clip=document.querySelector('#clip'),range=document.querySelector('#key');let image=null,time=0,last=0,paused=false,rev=0;for(const v of variants)look.add(new Option(v.id,v.path));const views=[['SE existing','front',false],['E side','side',false],['W side (mirror)','side',true]].map(([label,facing,flip])=>{const f=document.createElement('figure'),c=document.createElement('canvas');c.width=c.height=96;const cap=document.createElement('figcaption');cap.textContent=label;f.append(c,cap);document.querySelector('#views').append(f);return{ctx:c.getContext('2d'),facing,flip}});async function load(){const own=++rev,next=new Image;next.src='../'+look.value;await next.decode();if(own===rev)image=next}look.onchange=load;clip.onchange=()=>{range.max=meta.monk.clips[clip.value].side.length-1;range.value=0;time=0};range.oninput=()=>{paused=true;document.querySelector('#pause').textContent='Play'};document.querySelector('#pause').onclick=()=>{paused=!paused;document.querySelector('#pause').textContent=paused?'Play':'Pause'};function draw(now){if(last&&!paused)time+=Math.min(now-last,100);last=now;const ms=clip.value==='run'?104:200,ids=meta.monk.clips[clip.value].side;let k=Number(range.value);if(!paused){k=Math.floor(time/ms)%ids.length;range.value=k}if(image)for(const v of views){const idx=meta.monk.clips[clip.value][v.facing][k],x=idx%meta.monk.columns*96,y=Math.floor(idx/meta.monk.columns)*96;v.ctx.clearRect(0,0,96,96);v.ctx.save();v.ctx.imageSmoothingEnabled=false;if(v.flip){v.ctx.translate(96,0);v.ctx.scale(-1,1)}v.ctx.drawImage(image,x,y,96,96,0,0,96,96);v.ctx.restore()}document.querySelector('#name').textContent=meta.monk.frames[ids[k]];requestAnimationFrame(draw)}clip.onchange();load();requestAnimationFrame(draw);</script></html>'''
    return body.replace("__META__", json.dumps({"monk": {k: meta["monk"][k] for k in ("columns", "clips", "frames")}})) \
               .replace("__VARIANTS__", json.dumps(variants)).encode()


# ---------------------------------------------------------------------------
# Build, validate, verify
# ---------------------------------------------------------------------------

def sole_contacts(im):
    """Opaque x-range of each run on the sole row."""
    px, runs, start = im.load(), [], None
    for x in range(CELL + 1):
        on = x < CELL and px[x, SOLE][3] > 0
        if on and start is None:
            start = x
        if not on and start is not None:
            runs.append((start, x - 1))
            start = None
    return runs


def foot_lock(atlas, meta):
    """Ground-space sole contacts per run key (cell x + 18 px per key of travel)."""
    rows = []
    for k, index in enumerate(meta["monk"]["clips"]["run"]["side"]):
        runs = sole_contacts(cell(atlas, index))
        rows.append({"key": k + 1, "cell": [list(r) for r in runs],
                     "ground": [[a + TRACK * k, b + TRACK * k] for a, b in runs]})
    return rows


def construct():
    reference = ramps()
    v2 = read_json(MONK / "manifest.json")
    base = Image.open(ROOT / MONK / "monk-v2.png").convert("RGBA")
    look_manifest = read_json(LOOK / "manifest.json")
    look_ramps = read_json(LOOK / "source/palette-ramps.json")
    keys, rigs = side_keys(base, reference)
    tables = variant_tables(reference, look_manifest, look_ramps)
    meta = manifest(v2, look_manifest)
    atlases = {}
    for look in look_manifest["variants"]:
        top = Image.open(ROOT / LOOK / look["path"]).convert("RGBA")
        atlases[look["id"]] = assemble(top, keys, tables[look["id"]])
    default = "-".join(look_manifest["default"][k] for k in ("skin", "hair", "sash"))
    atlas = atlases[default]
    artifacts = {PKG / "manifest.json": json_bytes(meta), PKG / "monk-side.png": png_bytes(atlas),
                 PKG / "hit-masks.json": json_bytes({"monk-side.png": make_mask(atlas)})}
    for look in meta["appearance"]["variants"]:
        artifacts[PKG / look["path"]] = png_bytes(atlases[look["id"]])
    lock = foot_lock(atlas, meta)
    artifacts[PKG / "source/rig.json"] = json_bytes({
        "schemaVersion": 1,
        "note": "Generated by the builder. Upper bodies are v2 cells moved by upperOffset; lower bodies are drawn from these joints (cell pixels).",
        "frames": SIDE_NAMES, "sole": SOLE, "trackPixelsPerKey": TRACK, "keyDistance": KEY_DISTANCE,
        "segments": {"thigh": THIGH, "shin": SHIN}, "foot": FOOT, "light": LIGHT,
        "upper": UPPER, "keys": [{"name": n, **r} for n, r in zip(SIDE_NAMES, rigs)], "footLock": lock})
    sheet = contact_sheet(atlas, meta["monk"])
    artifacts[PKG / "previews/side-native.png"] = png_bytes(sheet)
    artifacts[PKG / "previews/side-4x.png"] = png_bytes(scaled(sheet, 4))
    compare = compare_sheet(atlas, meta["monk"])
    artifacts[PKG / "previews/compare-native.png"] = png_bytes(compare)
    artifacts[PKG / "previews/compare-3x.png"] = png_bytes(scaled(compare, 3))
    artifacts[PKG / "previews/compare-run.gif"] = compare_gif(atlas, meta["monk"])
    artifacts[PKG / "previews/run-side.gif"] = clip_gif(atlas, meta["monk"], "run", 100)
    artifacts[PKG / "previews/idle-side.gif"] = clip_gif(atlas, meta["monk"], "idle", 200)
    artifacts[PKG / "previews/run-track.gif"] = track_gif(atlas, meta["monk"])
    track = track_sheet(atlas, meta["monk"], lock)
    artifacts[PKG / "previews/foot-track-3x.png"] = png_bytes(scaled(track, 3))
    looks = looks_sheet(atlases, meta["monk"], look_manifest)
    artifacts[PKG / "previews/all-looks-native.png"] = png_bytes(looks)
    artifacts[PKG / "previews/all-looks-2x.png"] = png_bytes(scaled(looks, 2))
    artifacts[PKG / "previews/index.html"] = html_preview(meta)
    inputs = {str(MONK / "manifest.json"), str(MONK / "monk-v2.png"), str(MONK / "palette.json"),
              str(LOOK / "manifest.json"), str(LOOK / "source/palette-ramps.json"),
              str(LOOK / "source/head-regions.json"), "assets/game/pixel-v1/floor.png",
              "scripts/build-monk-side-animation.py",
              *(str(LOOK / v["path"]) for v in look_manifest["variants"])}
    return {"artifacts": artifacts, "inputs": inputs, "meta": meta, "atlases": atlases, "atlas": atlas,
            "base": base, "keys": keys, "rigs": rigs, "lock": lock, "reference": reference,
            "tables": tables, "look_manifest": look_manifest, "default": default}


def components(alpha_image):
    w, h = alpha_image.size
    alpha = alpha_image.tobytes()
    seen, groups = bytearray(w * h), 0
    for start in range(w * h):
        if not alpha[start] or seen[start]:
            continue
        groups += 1
        todo = [start]
        seen[start] = 1
        while todo:
            i = todo.pop()
            y, x = divmod(i, w)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    j = ny * w + nx
                    if 0 <= nx < w and 0 <= ny < h and alpha[j] and not seen[j]:
                        seen[j] = 1
                        todo.append(j)
    return groups


def validate(built):
    meta, atlases, atlas, base = built["meta"], built["atlases"], built["atlas"], built["base"]
    monk, reference = meta["monk"], built["reference"]
    assert monk["cell"] == CELL and monk["anchor"] == list(ANCHOR) and monk["columns"] == COLUMNS
    assert monk["rows"] == BASE_ROWS + 1 and len(monk["frames"]) == 110
    assert monk["filter"] == "nearest" and monk["mipmaps"] is False
    assert monk["clips"]["idle"]["side"] == [100, 101, 102, 103]
    assert monk["clips"]["run"]["side"] == [104, 105, 106, 107, 108, 109]
    assert [c for c, f in monk["clips"].items() if "side" in f] == ["idle", "run"]
    assert monk["frames"][100:] == SIDE_NAMES
    v2 = read_json(MONK / "manifest.json")["monk"]
    for clip, facings in v2["clips"].items():
        assert all(monk["clips"][clip][f] == facings[f] for f in ("front", "back")), clip
    assert monk["frames"][:100] == v2["frames"]
    look_manifest = built["look_manifest"]
    assert len(atlases) == 18
    # Rows 0-9 are the shipped atlases; the default appearance is v2 itself.
    for look in look_manifest["variants"]:
        top = Image.open(ROOT / LOOK / look["path"]).convert("RGBA")
        assert atlases[look["id"]].crop((0, 0, 960, 960)).tobytes() == top.tobytes(), look["id"]
    assert atlas.crop((0, 0, 960, 960)).tobytes() == base.tobytes(), "default rows 0-9 differ from v2"
    alpha = atlas.getchannel("A").tobytes()
    assert set(alpha) == {0, 255}, "binary alpha"
    side_colors = set()
    allowed_any = {c for ramp in reference.values() for c in ramp}
    for name, im in atlases.items():
        assert im.size == (960, 1056)
        assert im.getchannel("A").tobytes() == alpha, (name, "alpha differs between appearances")
        data = im.tobytes()
        assert all(data[i:i + 3] == b"\0\0\0" for i in range(0, len(data), 4) if not data[i + 3]), "hidden RGB"
        colors = {c[:3] for _, c in im.getcolors(im.width * im.height) if c[3]}
        assert len(colors) <= 48, (name, len(colors))
        side = im.crop((0, 960, 960, 1056))
        side_colors |= {c[:3] for _, c in side.getcolors(960 * 96) if c[3]}
        table = built["tables"][name]
        allowed = {c for ramp in table.values() for c in ramp} | {tuple(bytes.fromhex(c)) for c in read_json(LOOK / "source/palette-ramps.json")["hair"]}
        assert {c[:3] for _, c in side.getcolors(960 * 96) if c[3]} <= allowed, (name, "side colour outside the material ramps")
    # Non-target materials are identical across appearances (v3 rule) in the side row too.
    targets = {c for c in reference["skin"] + reference["sash"]}
    default_side = atlas.crop((0, 960, 960, 1056)).tobytes()
    for name, im in atlases.items():
        other = im.crop((0, 960, 960, 1056)).tobytes()
        for i in range(0, len(default_side), 4):
            if default_side[i + 3] and tuple(default_side[i:i + 3]) not in targets:
                assert other[i:i + 4] == default_side[i:i + 4], (name, "non-target material changed", i)
    # Short hair appears on every side key of every short-hair look; shaved keeps the scalp.
    for look in look_manifest["variants"]:
        for k in range(10):
            mine = cell(atlases[look["id"]], SIDE_FIRST + k).tobytes()
            shaved = cell(atlases[f"{look['skin']}-shaved-{look['sash']}"], SIDE_FIRST + k).tobytes()
            assert (mine != shaved) == (look["hair"] == "short"), (look["id"], k, "hair registration")
    frames, reports = [cell(atlas, SIDE_FIRST + k) for k in range(10)], []
    assert len({im.tobytes() for im in frames}) == 10, "duplicate side keys"
    for k, im in enumerate(frames):
        box = im.getbbox()
        assert box and 0 < box[0] and 0 < box[1] and box[2] < CELL and box[3] <= ANCHOR[1], (k, box)
        assert box[3] == SOLE + 1, (SIDE_NAMES[k], "feet must reach the sole row")
        assert components(im.getchannel("A")) == 1, (SIDE_NAMES[k], "detached pixels")
        reports.append({"name": SIDE_NAMES[k], "bbox": list(box), "height": box[3] - box[1]})
    assert 60 <= reports[0]["height"] <= 64, ("neutral side idle height", reports[0]["height"])
    for r in reports:
        assert 50 <= r["height"] <= 64, r          # v2 run keys span 52-63
    # Planted feet: in ground space (cell x + 18 px per key) the support sole does not slide.
    lock = built["lock"]
    contacts = [row["ground"] for row in lock]
    assert all(len(c) == 1 for c in contacts), ("exactly one foot on the ground per run key", contacts)
    for a, b in ((0, 1), (3, 4)):
        assert contacts[a] == contacts[b], ("flat sole slid between keys", a + 1, b + 1, contacts[a], contacts[b])
    for flat_key, toe_key in ((1, 2), (4, 5)):
        toe = contacts[toe_key][0]
        assert toe[1] - toe[0] <= 1, ("push-off touches with the toe only", toe)
        assert abs(toe[1] - contacts[flat_key][0][1]) <= 1, ("toe pivot left the sole's toe", toe, contacts[flat_key])
    step = contacts[3][0][0] - contacts[0][0][0]
    assert step == 3 * TRACK, ("step length", step)
    for idle in frames[:4]:
        runs = sole_contacts(idle)
        assert len(runs) == 2, ("idle stands on both feet", runs)
    hit = base64.b64decode(json.loads(built["artifacts"][PKG / "hit-masks.json"])["monk-side.png"]["bits"])
    assert all(bool(hit[i >> 3] & (1 << (i & 7))) == bool(a) for i, a in enumerate(alpha)), "hit mask"
    return {"status": "passed", "toolchain": {"python": platform.python_version(), "pillow": PILLOW_VERSION},
            "atlas": {"size": [960, 1056], "cell": CELL, "columns": COLUMNS, "rows": BASE_ROWS + 1,
                      "anchor": list(ANCHOR), "frames": 110, "sideFrames": SIDE_NAMES,
                      "binaryAlpha": True, "transparentRgbZero": True,
                      "rows0to9EqualShippedV3": True, "defaultRows0to9EqualV2": True,
                      "maxOpaqueColorsPerAtlas": max(len({c[:3] for _, c in im.getcolors(im.width * im.height) if c[3]}) for im in atlases.values()),
                      "sideRowColors": len(side_colors)},
            "appearance": {"variants": 18, "alphaIdentical": True, "nonTargetMaterialsPreserved": True,
                           "shortHairOnEverySideKey": True},
            "sideKeys": reports,
            "footLock": {"trackPixelsPerKey": TRACK, "keyDistance": KEY_DISTANCE,
                         "flatSoleSlidePixels": 0, "toePivotWithinPixels": 1, "stepPixels": step,
                         "groundContacts": lock},
            "hitMaskVerified": True, "artifactCount": len(built["artifacts"]), "sourceCount": len(built["inputs"])}


def provenance(built):
    return {"schemaVersion": 1, "date": "2026-10-23",
            "generationMode": "No image generation. Deterministic cut-out rig: reused v2/v3 upper-body pixels plus a programmatic profile lower body.",
            "rightsNote": "Derived from project artwork; inherited provenance of pixel-v2/monk and pixel-v3/appearance applies. Not a new license grant.",
            "acceptance": {"status": "worker-inspected-awaiting-coordinator",
                           "authority": "Coordinator accepts under user delegation. No personal user approval is claimed.",
                           "boundary": "Asset owner inspected native contact sheets, the foot-track onion sheet and exported pixels; in-game acceptance belongs to the coordinator."},
            "method": {"upperBodies": {k: v["frame"] for k, v in UPPER.items()},
                       "lowerBody": "Two-bone legs (thigh 14, shin 14.5 px), baggy capsules, upper-left light, v2 trouser/skin ramps, 1 px ink rim.",
                       "appearance": "Upper bodies copied from each v3 variant atlas (its own skin/sash/hair pixels); drawn skin uses the same v3 seven-step map.",
                       "poseReference": "assets/concepts/pixel-art-01/raw/p8-pixel-run-and-hit.png (profile run phases; not sampled)"},
            "builder": "scripts/build-monk-side-animation.py",
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
    summary = {k: v for k, v in report.items() if k not in ("sideKeys", "footLock")}
    summary["footLock"] = {k: v for k, v in report["footLock"].items() if k != "groundContacts"}
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--verify-only", action="store_true", help="Reconstruct and validate in memory; no filesystem writes")
    run(parser.parse_args().verify_only)
