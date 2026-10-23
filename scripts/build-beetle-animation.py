#!/usr/bin/env python3
"""Build/verify the armored beetle (панцирник) pixel package. Python 3.10+, Pillow 10–12.

No image generation, network, credentials, browser or runtime modification occurs here.
Inputs are the read-only Paper artbook beetle originals plus the recipe in
assets/game/pixel-v7/beetle/source/normalization.json (crops, scales, polygons,
part offsets and per-frame pixel accents). Every key is rebuilt from those files.
--verify-only rebuilds all deliverables IN MEMORY, compares bytes, validates
provenance and never writes files. Run from any working directory.
"""

import argparse
import base64
from collections import Counter, deque
import colorsys
import hashlib
from io import BytesIO
import json
from pathlib import Path
import platform

from PIL import Image, ImageDraw, __version__ as PILLOW_VERSION


ROOT = Path(__file__).resolve().parents[1]
PKG = Path("assets/game/pixel-v7/beetle")
SOURCE = PKG / "source"
CONCEPTS = Path("assets/concepts/animation-bible-01/monsters")
NEAREST = Image.Resampling.NEAREST
ATLAS = "beetle.png"
CELL, ANCHOR, COLUMNS = 128, (64, 112), 10
CLIPS = {"idle": 4, "walk": 6, "windup": 5, "slam": 3, "recover": 3,
         "hurt": 4, "stunned": 4, "death": 6, "block": 2}
FACINGS = ("front", "back")
FRAME_COUNT = 2 * sum(CLIPS.values())
CONTEXT = (PKG / "previews/floor-context-native.png", PKG / "previews/floor-context-2x.png")
ROWS = -(-FRAME_COUNT // COLUMNS)
LOOPS = {"idle", "walk", "stunned"}
# Label roles. 0 is transparent; the recipe palette assigns RGB to each label.
OUTLINE, DEEP, SHADOW, MID, LIT, HIGH = 1, 2, 3, 4, 5, 6
BELLY = (7, 8, 9)
MAGENTA = (10, 11, 12, 13)
CORAL = (14, 15, 16)
CHITIN = {SHADOW, MID, LIT, HIGH}
FAMILIES = {"magenta": set(MAGENTA), "coral": set(CORAL)}


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


# ---------------------------------------------------------------- labels ---

def classify(r, g, b, steps):
    """Source RGB -> material label. The originals already use ~5 olive tones;
    each maps to one gray-violet chitin step. Magenta is kept as its own family."""
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    if .72 < h < .95 and s > .45 and v > .35:
        return MAGENTA[0] if v < .55 else MAGENTA[1] if v < .8 else MAGENTA[2]
    luma = .299 * r + .587 * g + .114 * b
    if luma > 60 and r > g + 12 and b > g + 12:
        # Pale pink halo of a baked magenta effect; the olive body never has b > g.
        return MAGENTA[0]
    if (h < .08 or h > .97) and s > .4 and v > .6:
        return CORAL[1]
    for limit, label in zip(steps, (OUTLINE, DEEP, SHADOW, MID, LIT)):
        if luma < limit:
            return label
    return HIGH


def source_labels(image, box, recipe):
    """Crop -> label plane. Soft glow (alpha < threshold) and the blue-gray or
    blue-violet painted floor shadow are dropped; nothing else is repainted."""
    crop = image.crop(box)
    w, h = crop.size
    data = crop.tobytes()
    out = bytearray(w * h)
    threshold, steps = recipe["alphaThreshold"], recipe["lumaSteps"]
    cache = {}
    for i in range(w * h):
        r, g, b, a = data[i * 4:i * 4 + 4]
        if a < threshold or (g > r + 4 and b > r + 8) or (b > r + 20 and b > g + 20):
            continue
        key = (r, g, b)
        if key not in cache:
            cache[key] = classify(r, g, b, steps)
        out[i] = cache[key]
    return Image.frombytes("L", (w, h), bytes(out))


def largest_component(plane):
    """Keep the creature; drop detached storyboard effects (rings, sparks, dust)."""
    w, h = plane.size
    src = plane.tobytes()
    active = bytearray(1 if v else 0 for v in src)
    best = []
    for start in range(len(active)):
        if not active[start]:
            continue
        queue, component = deque([start]), []
        active[start] = 0
        while queue:
            pos = queue.popleft()
            component.append(pos)
            x, y = pos % w, pos // w
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and active[ny * w + nx]:
                        active[ny * w + nx] = 0
                        queue.append(ny * w + nx)
        if len(component) > len(best):
            best = component
    out = bytearray(w * h)
    for pos in best:
        out[pos] = src[pos]
    return Image.frombytes("L", (w, h), bytes(out))


def drop_accent(plane, family, keep=None):
    """Remove baked storyboard effects (ground ring, hit spark) that touch the
    body. Effect pixels on a limb take the surrounding limb label; effect
    pixels on empty floor vanish. Pixels inside the keep box (the eye) stay."""
    w, h = plane.size
    px = bytearray(plane.tobytes())
    x0, y0, x1, y1 = keep or (0, 0, 0, 0)
    todo = {i for i, v in enumerate(px) if v in family and not (x0 <= i % w < x1 and y0 <= i // w < y1)}
    while todo:
        decided = {}
        for i in todo:
            x, y = i % w, i // w
            near = [px[(y + dy) * w + x + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                    if (dx or dy) and 0 <= x + dx < w and 0 <= y + dy < h and (y + dy) * w + x + dx not in todo]
            if near:
                solid = [v for v in near if v]
                decided[i] = max((n, k) for k, n in Counter(solid).items())[1] if len(solid) * 2 > len(near) else 0
        if not decided:
            break
        for i, v in decided.items():
            px[i] = v
        todo -= set(decided)
    return Image.frombytes("L", (w, h), bytes(px))


def polygon_mask(size, points):
    mask = Image.new("L", size)
    ImageDraw.Draw(mask).polygon([tuple(p) for p in points], fill=255)
    return mask


def remap(plane, mapping, mask=None):
    lut = list(range(256))
    for a, b in mapping.items():
        lut[int(a)] = b
    mapped = plane.point(lut)
    if mask is None:
        return mapped
    out = plane.copy()
    out.paste(mapped, (0, 0), mask)
    return out


def bbox_fraction(plane, fx, fy):
    box = plane.getbbox()
    return (box[0] + fx * (box[2] - box[0]), box[1] + fy * (box[3] - box[1]))


# ------------------------------------------------------------ resampling ---

def downsample(plane, scale):
    """Majority vote per native pixel footprint. Thin coal lines and magenta
    accents win at lower shares so outlines and eyes survive the reduction."""
    w, h = plane.size
    src = plane.tobytes()
    tw, th = int(w * scale) + 1, int(h * scale) + 1
    out = bytearray(tw * th)
    for ty in range(th):
        y0 = int(ty / scale)
        y1 = min(h, max(y0 + 1, int((ty + 1) / scale)))
        for tx in range(tw):
            x0 = int(tx / scale)
            x1 = min(w, max(x0 + 1, int((tx + 1) / scale)))
            if x0 >= w or y0 >= h:
                continue
            votes = Counter()
            for y in range(y0, y1):
                votes.update(src[y * w + x0:y * w + x1])
            total = sum(votes.values())
            empty = votes.pop(0, 0)
            if empty * 2 >= total:
                continue
            opaque = total - empty
            accent = sum(n for k, n in votes.items() if k in MAGENTA or k in CORAL)
            if votes.get(OUTLINE, 0) >= opaque * .34:
                label = OUTLINE
            elif accent >= opaque * .25:
                label = max((n, k) for k, n in votes.items() if k in MAGENTA or k in CORAL)[1]
            else:
                label = max((n, k) for k, n in votes.items())[1]
            out[ty * tw + tx] = label
    return Image.frombytes("L", (tw, th), bytes(out))


def cleanup(plane):
    """Native-pixel hygiene: no lonely pixels or pinholes, a closed one-pixel
    coal rim and no single-pixel tone speckles inside chitin clusters."""
    w, h = plane.size
    px = bytearray(plane.tobytes())

    def at(buf, x, y):
        return buf[y * w + x] if 0 <= x < w and 0 <= y < h else 0

    for _ in range(2):
        nxt = bytearray(px)
        for y in range(h):
            for x in range(w):
                n4 = (at(px, x + 1, y), at(px, x - 1, y), at(px, x, y + 1), at(px, x, y - 1))
                v = px[y * w + x]
                if v and sum(1 for q in n4 if q) <= 1:
                    nxt[y * w + x] = 0
                elif not v and all(n4):
                    nxt[y * w + x] = OUTLINE
        px = nxt
    nxt = bytearray(px)
    for y in range(h):
        for x in range(w):
            if px[y * w + x] and 0 in (at(px, x + 1, y), at(px, x - 1, y), at(px, x, y + 1), at(px, x, y - 1)):
                nxt[y * w + x] = OUTLINE
    px = nxt
    nxt = bytearray(px)
    for y in range(h):
        for x in range(w):
            v = px[y * w + x]
            if v not in CHITIN:
                continue
            n4 = [at(px, x + 1, y), at(px, x - 1, y), at(px, x, y + 1), at(px, x, y - 1)]
            if v not in n4:
                votes = Counter(q for q in n4 if q in CHITIN)
                if votes:
                    nxt[y * w + x] = max((n, k) for k, n in votes.items())[1]
    return Image.frombytes("L", (w, h), bytes(nxt))


# ------------------------------------------------------------- keyframes ---

class Keys:
    """Padded, labelled source crops, one fixed downsampling grid per key."""

    def __init__(self, recipe, inputs):
        self.recipe, self.inputs = recipe, inputs
        self.sheets, self.cache = {}, {}

    def sheet(self, name):
        if name not in self.sheets:
            config = self.recipe["sheets"][name]
            self.inputs.add(config["source"])
            self.sheets[name] = Image.open(ROOT / config["source"]).convert("RGBA")
        return self.sheets[name]

    def get(self, key):
        if key not in self.cache:
            config = self.recipe["keys"][key]
            sheet_config = self.recipe["sheets"][config["sheet"]]
            columns, rows = sheet_config["grid"]
            image = self.sheet(config["sheet"])
            index = config["cell"]
            col, row = index % columns, index // columns
            box = (round(col * image.width / columns), round(row * image.height / rows),
                   round((col + 1) * image.width / columns), round((row + 1) * image.height / rows))
            plane = source_labels(image, box, self.recipe)
            for drop in config.get("drop", []):
                plane = drop_accent(plane, FAMILIES[drop["family"]], drop.get("keep"))
            for erase in config.get("erase", []):
                plane.paste(0, (0, 0), polygon_mask(plane.size, erase))
            plane = largest_component(plane)
            for region in config.get("recolor", []):
                plane = remap(plane, region["map"], polygon_mask(plane.size, region["polygon"]))
            pad = self.recipe["padding"]
            padded = Image.new("L", (plane.width + 2 * pad, plane.height + 2 * pad))
            padded.paste(plane, (pad, pad))
            self.cache[key] = (padded, sheet_config["scale"], box)
        return self.cache[key]


def shifted(plane, dx, dy):
    out = Image.new("L", plane.size)
    out.paste(plane, (dx, dy))
    return out


def over(base, top):
    out = base.copy()
    out.paste(top, (0, 0), top.point(lambda v: 255 if v else 0))
    return out


def compose_rig(keys, rig_name, parts):
    """Cut-out rig on the authored rear view: belly fill, legs, then shell.
    Offsets are whole native pixels so unmoved plates keep identical clusters."""
    rig = keys.recipe["rigs"][rig_name]
    plane, scale, _ = keys.get(rig["key"])
    pad = keys.recipe["padding"]
    lift = lambda points: [(x + pad, y + pad) for x, y in points]
    src = lambda value: round(value / scale)
    body = plane.copy()
    legs = {}
    for name, leg in rig["legs"].items():
        mask = polygon_mask(plane.size, lift(leg["polygon"]))
        piece = Image.new("L", plane.size)
        piece.paste(plane, (0, 0), mask)
        legs[name] = piece
        body.paste(0, (0, 0), mask)
    bdx, bdy = parts.get("body", [0, 0])
    belly = Image.new("L", plane.size)
    belly.paste(DEEP, (0, 0), polygon_mask(plane.size, lift(rig["belly"])))
    canvas = shifted(belly, src(bdx), src(bdy))
    order = rig.get("drawOrder", list(rig["legs"]))
    for name in order:
        dx, dy = parts.get(name, [0, 0])[:2]
        canvas = over(canvas, shifted(legs[name], src(dx), src(dy)))
    return over(canvas, shifted(body, src(bdx), src(bdy))), scale


def motion(plane, spec):
    """Whole-body pose changes at source resolution before the native grid."""
    if spec.get("flipY"):
        box = plane.getbbox()
        flipped = plane.crop(box).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        plane = Image.new("L", plane.size)
        plane.paste(flipped, box[:2])
    if "rotate" in spec:
        pivot = bbox_fraction(plane, *spec.get("pivot", [.5, 1]))
        plane = plane.rotate(spec["rotate"], resample=NEAREST, center=pivot)
    if "squash" in spec:
        sx, sy = spec["squash"]
        cx, cy = bbox_fraction(plane, *spec.get("squashPivot", [.5, 1]))
        plane = plane.transform(plane.size, Image.Transform.AFFINE,
                                (1 / sx, 0, cx - cx / sx, 0, 1 / sy, cy - cy / sy), resample=NEAREST)
    return plane


def registration(native):
    """Ground root: bottom support row and the shell-mass centroid column."""
    box = native.getbbox()
    w = native.width
    data = native.tobytes()
    limit = box[1] + .55 * (box[3] - box[1])
    xs = [i % w for i, v in enumerate(data) if v and i // w < limit]
    return (round(sum(xs) / len(xs)), box[3])


def eye(px, w, h, state):
    eyes = [i for i, v in enumerate(px) if v in MAGENTA]
    if state == "off":
        for i in eyes:
            px[i] = DEEP
    elif state == "dim":
        for i in eyes:
            px[i] = MAGENTA[0]
    else:
        for i in eyes:
            px[i] = MAGENTA[2]
        if state == "bright":
            for i in eyes:
                px[i] = MAGENTA[3]
                for j in (i - 1, i + 1, i - w):
                    if 0 <= j < len(px) and px[j] not in MAGENTA and px[j] != 0 and not rim(px, w, h, j):
                        px[j] = MAGENTA[2]


def rim(px, w, h, i):
    x, y = i % w, i // w
    return any(not (0 <= x + dx < w and 0 <= y + dy < h) or px[(y + dy) * w + x + dx] == 0
               for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))


def seams(px, w, h, level, top_fraction):
    """Telegraph: interior coal seams between chitin plates heat to magenta."""
    if not level:
        return
    ys = [i // w for i, v in enumerate(px) if v]
    limit = min(ys) + top_fraction * (max(ys) - min(ys))
    glow = MAGENTA[level - 1]
    hits = []
    for i, v in enumerate(px):
        x, y = i % w, i // w
        if v != OUTLINE or y > limit or rim(px, w, h, i) or not (0 < x < w - 1 and 0 < y < h - 1):
            continue
        lr = px[i - 1] in CHITIN and px[i + 1] in CHITIN
        ud = px[i - w] in CHITIN and px[i + w] in CHITIN
        if lr or ud:
            hits.append(i)
    for i in hits:
        px[i] = glow


def ellipse(px, w, h, center, radius, label, only=None, grow=False):
    cx, cy = center
    rx, ry = radius
    hits = []
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            if 0 <= x < w and 0 <= y < h and ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1:
                i = y * w + x
                if grow and not px[i]:
                    hits.append(i)
                elif px[i] and not rim(px, w, h, i) and (only is None or px[i] in only):
                    hits.append(i)
    for i in hits:
        px[i] = label
    if grow:
        # The soft mound may rise between the legs; close its new edge in coal.
        for i in [i for i in hits if rim(px, w, h, i)]:
            px[i] = OUTLINE


def accents(native, spec):
    w, h = native.size
    px = bytearray(native.tobytes())
    eye(px, w, h, spec.get("eye", "lit"))
    seams(px, w, h, spec.get("seams", 0), spec.get("seamTop", .62))
    belly = spec.get("belly")
    if belly:
        cx, cy = belly["at"]
        rx, ry = belly["r"]
        ellipse(px, w, h, (cx, cy), (rx + 1, ry + 1), OUTLINE, only=CHITIN | {DEEP}, grow=True)
        ellipse(px, w, h, (cx, cy), (rx, ry), BELLY[0], only={OUTLINE})
        ellipse(px, w, h, (cx - .5, cy - .6), (rx - 1.2, ry - 1.1), BELLY[1], only=set(BELLY))
        ellipse(px, w, h, (cx - 1.4, cy - 1.2), (max(1, rx - 3.4), max(1, ry - 2.6)), BELLY[2], only=set(BELLY))
        # Soft segment folds keep the exposed underside insect-like, not a disc.
        for k in range(1, belly.get("segments", 0) + 1):
            sx = round(cx - rx + 2 * rx * k / (belly["segments"] + 1))
            for y in range(int(cy - ry), int(cy + ry) + 1):
                i = y * w + sx
                if 0 <= i < len(px) and px[i] in BELLY[1:]:
                    px[i] = BELLY[0]
    spot = spec.get("weakSpot")
    if spot:
        cx, cy = spot["at"]
        level = spot["level"]
        ellipse(px, w, h, (cx, cy), (3.4 + .6 * level, 2.4 + .5 * level), MAGENTA[1], only=set(BELLY) | CHITIN | {DEEP})
        ellipse(px, w, h, (cx, cy), (2.3 + .6 * level, 1.5 + .5 * level), CORAL[1])
        ellipse(px, w, h, (cx - .3, cy - .3), (1 + .5 * level, .8 + .4 * level), CORAL[2])
    for x, y, label in spec.get("pixels", []):
        px[y * w + x] = label
    return Image.frombytes("L", (w, h), bytes(px))


def make_frame(keys, spec):
    if "rig" in spec:
        neutral, scale = compose_rig(keys, spec["rig"], {})
        posed, _ = compose_rig(keys, spec["rig"], spec.get("parts", {}))
    else:
        neutral, scale, _ = keys.get(spec["key"])
        posed = neutral
    if spec.get("flipY"):
        neutral = motion(neutral, {"flipY": True})
    posed = motion(posed, spec)
    if "tone" in spec:
        posed = remap(posed, spec["tone"])
    reference = cleanup(downsample(neutral, scale))
    native = cleanup(downsample(posed, scale))
    if spec.get("register") == "self":
        reference = native
    root = registration(reference)
    nudge = spec.get("nudge", [0, 0])
    offset = (ANCHOR[0] - root[0] + nudge[0], ANCHOR[1] - root[1] + nudge[1])
    cell = Image.new("L", (CELL, CELL))
    cell.paste(native, offset)
    cell = accents(cell, spec)
    return cell, {"root": list(root), "offset": list(offset), "scale": scale}


# --------------------------------------------------------------- package ---

def frame_names():
    return [f"{facing}-{clip}-{i + 1:02}" for facing in FACINGS for clip, count in CLIPS.items() for i in range(count)]


def manifest(recipe):
    clips, index = {name: {} for name in CLIPS}, 0
    for facing in FACINGS:
        for clip, count in CLIPS.items():
            clips[clip][facing] = list(range(index, index + count))
            index += count
    timing = {clip: {"keyTimesMs": recipe["timing"][clip], "playback": "loop" if clip in LOOPS else "one-shot-hold"}
              for clip in CLIPS}
    return {
        "schemaVersion": 2,
        "status": "ready-for-coordinator-review",
        "nativePixelsPerUnit": 32,
        "beetle": {"path": ATLAS, "cell": CELL, "columns": COLUMNS, "rows": ROWS, "anchor": list(ANCHOR),
                   "frames": frame_names(), "clips": clips, "filter": "nearest", "mipmaps": False,
                   "timing": timing},
        "hitMasks": "hit-masks.json",
        "authoredFacings": {"front": "SE", "back": "NE"},
        "logicalFacings": {"SE": {"authored": "front", "flipX": False}, "SW": {"authored": "front", "flipX": True},
                           "NE": {"authored": "back", "flipX": False}, "NW": {"authored": "back", "flipX": True}},
        "gameplayNotes": recipe["gameplayNotes"],
        "provenance": "provenance.json",
        "normalization": "source/normalization.json",
        "registration": "source/registration.json",
        "previews": "previews/index.html",
    }


def palette_rgb(recipe):
    table = [(0, 0, 0)] * 256
    for label, value in recipe["palette"].items():
        table[int(label)] = tuple(bytes.fromhex(value["hex"]))
    return table


def to_rgba(plane, table):
    out = Image.new("RGBA", plane.size)
    data = bytearray(plane.width * plane.height * 4)
    for i, v in enumerate(plane.tobytes()):
        if v:
            data[i * 4:i * 4 + 4] = bytes((*table[v], 255))
    out.frombytes(bytes(data))
    return out


def make_atlas(recipe, inputs):
    keys = Keys(recipe, inputs)
    table = palette_rgb(recipe)
    atlas = Image.new("RGBA", (COLUMNS * CELL, ROWS * CELL))
    registrations, names, index = [], frame_names(), 0
    for facing in FACINGS:
        for clip, count in CLIPS.items():
            specs = recipe["frames"][facing][clip]
            assert len(specs) == count, (facing, clip, len(specs))
            for spec in specs:
                plane, record = make_frame(keys, spec)
                box = plane.getbbox()
                assert box and 0 < box[0] < box[2] < CELL and 0 < box[1] < box[3] < CELL, (names[index], box)
                rgba = to_rgba(plane, table)
                atlas.paste(rgba, (index % COLUMNS * CELL, index // COLUMNS * CELL))
                base = spec.get("key") or recipe["rigs"][spec["rig"]]["key"]
                registrations.append({"index": index, "frame": names[index], "base": base,
                                      "source": recipe["sheets"][recipe["keys"][base]["sheet"]]["source"],
                                      "recipe": spec, **record, "nativeBounds": list(box),
                                      "pixelsSha256": sha(rgba.tobytes())})
                index += 1
    return atlas, registrations


def make_mask(im):
    alpha = im.getchannel("A").tobytes()
    packed = bytearray((len(alpha) + 7) // 8)
    for i, value in enumerate(alpha):
        if value:
            packed[i >> 3] |= 1 << (i & 7)
    return {"width": im.width, "height": im.height, "bits": base64.b64encode(packed).decode()}


def frame(atlas, index, cell=CELL, columns=COLUMNS):
    x, y = index % columns * cell, index // columns * cell
    return atlas.crop((x, y, x + cell, y + cell))


# -------------------------------------------------------------- previews ---

def checker(width, height):
    im = Image.new("RGB", (width, height), "#292532")
    draw = ImageDraw.Draw(im)
    for y in range(0, height, 8):
        for x in range(0, width, 8):
            if (x // 8 + y // 8) % 2:
                draw.rectangle((x, y, x + 7, y + 7), fill="#24212c")
    return im


def contact(atlas, meta, facing):
    lane = CELL + 18
    sheet = checker(6 * CELL, len(meta["clips"]) * lane)
    draw = ImageDraw.Draw(sheet)
    for row, (clip, facings) in enumerate(meta["clips"].items()):
        for col, index in enumerate(facings[facing]):
            key = frame(atlas, index)
            x, y = col * CELL, row * lane + 16
            sheet.paste(key, (x, y), key)
            draw.line((x + ANCHOR[0] - 3, y + ANCHOR[1], x + ANCHOR[0] + 3, y + ANCHOR[1]), fill="#70a49b")
            draw.text((x + 4, row * lane + 2), f"{index:02} {clip} {col + 1}" if col else f"{index:02} {clip} / {facing}",
                      fill="#e6dfcf")
    return sheet


def strip(atlas, meta, clip):
    """Both authored facings of one clip, native cells, then integer 2x."""
    keys = meta["clips"][clip]
    board = checker(len(keys["front"]) * CELL, 2 * CELL + 28)
    draw = ImageDraw.Draw(board)
    for row, facing in enumerate(FACINGS):
        for col, index in enumerate(keys[facing]):
            key = frame(atlas, index)
            board.paste(key, (col * CELL, row * (CELL + 14)), key)
            draw.text((col * CELL + 4, row * (CELL + 14) + CELL), f"{facing} {col + 1}", fill="#e6dfcf")
    return board.resize((board.width * 2, board.height * 2), NEAREST)


def durations(meta):
    out = {}
    for clip, timing in meta["timing"].items():
        keys = timing["keyTimesMs"]
        gaps = [b - a for a, b in zip(keys, keys[1:])]
        out[clip] = gaps + [gaps[-1] if gaps else 200]
    return out


def animated_gif(atlas, meta, clip):
    views = [("SE", "front", False), ("SW", "front", True), ("NE", "back", False), ("NW", "back", True)]
    keys, images = meta["clips"][clip], []
    for step in range(len(keys["front"])):
        board = checker(len(views) * CELL, CELL + 16)
        draw = ImageDraw.Draw(board)
        for col, (label, facing, flip) in enumerate(views):
            key = frame(atlas, keys[facing][step])
            if flip:
                key = key.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            board.paste(key, (col * CELL, 0), key)
            draw.text((col * CELL + 4, CELL + 2), f"{label} {clip} {step + 1}", fill="#e6dfcf")
        images.append(board)
    ms = durations(meta)[clip].copy()
    if clip not in LOOPS:
        ms[-1] += 1000
    stream = BytesIO()
    images[0].save(stream, format="GIF", save_all=True, append_images=images[1:],
                   duration=ms, loop=0, disposal=2, optimize=False)
    return stream.getvalue()


def context_preview(atlas, meta, inputs):
    """Native pixels on the courtyard stone (top rows) and a flat grass tone
    (bottom rows, the mean of the country grass) beside monk, hound and wraith
    keys. Not an engine capture. The grass is a constant so that rebuilding the
    country package cannot invalidate this package's byte check."""
    lane = CELL + 16
    sheet = Image.new("RGB", (6 * CELL, 4 * lane), "#211d29")
    inputs.add("assets/game/pixel-v1/floor.png")
    floor = Image.open(ROOT / "assets/game/pixel-v1/floor.png").convert("RGB")
    for y in range(0, 2 * lane, floor.height):
        for x in range(0, sheet.width, floor.width):
            sheet.paste(floor, (x, y))
    draw = ImageDraw.Draw(sheet)
    for y in range(2 * lane, 4 * lane, 8):
        for x in range(0, sheet.width, 8):
            draw.rectangle((x, y, x + 7, y + 7), fill="#707e5f" if (x // 8 + y // 8) % 2 else "#687659")
    others = []
    for package, name, path in (("assets/game/pixel-v2/monk", "monk", "monk-v2.png"),
                                ("assets/game/pixel-v2/hound-world", "hound", "hound-v2.png"),
                                ("assets/game/pixel-v3/wraith", "wraith", "wraith.png")):
        inputs.update([f"{package}/manifest.json", f"{package}/{path}"])
        other_meta = read_json(Path(package) / "manifest.json")[name]
        others.append((name, other_meta, Image.open(ROOT / package / path).convert("RGBA")))
    for row, facing in enumerate(FACINGS + FACINGS):
        y = row * lane
        for col, (name, other_meta, image) in enumerate(others):
            sprite = frame(image, other_meta["clips"]["idle"][facing][0], other_meta["cell"], other_meta["columns"])
            # Foot anchors share one ground line with the beetle's anchor.
            x0 = col * CELL + ANCHOR[0] - other_meta["anchor"][0]
            sheet.paste(sprite, (x0, y + ANCHOR[1] - other_meta["anchor"][1]), sprite)
            draw.text((col * CELL + 4, y + CELL + 2), f"{name} {facing}", fill="#f1e7d4")
        for col, clip in enumerate(("idle", "windup", "stunned")):
            index = meta["clips"][clip][facing][-1 if clip == "windup" else 0]
            sprite = frame(atlas, index)
            sheet.paste(sprite, ((3 + col) * CELL, y), sprite)
            draw.text(((3 + col) * CELL + 4, y + CELL + 2), f"beetle {clip} {facing}", fill="#f1e7d4")
    return sheet


def html_preview(meta):
    # Self-contained metadata: only the local atlas is loaded. No server,
    # package dependencies, network or application/runtime imports.
    body = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Beetle — 74 keys</title><style>body{background:#19161f;color:#e6dfcf;font:16px system-ui;margin:24px}select,button,input{font:inherit;margin:8px;padding:6px}canvas,img{image-rendering:pixelated;background:repeating-conic-gradient(#292532 0 25%,#24212c 0 50%) 0/16px 16px}canvas{width:256px;height:256px}figure{display:inline-block;margin:12px}figcaption{max-width:256px}.strips img{display:block;margin:8px 0;max-width:100%}</style>
<h1>Armored beetle (панцирник) — 74 keys</h1><p>Exact delivered atlas pixels. Native cell __CELL__×__CELL__, anchor [__AX__,__AY__] (teal tick). Nearest filtering. The four views use authored front (SE) / back (NE) plus horizontal mirrors.</p>
<label>Clip <select id="clip"></select></label><button id="pause">Pause</button><label>Frame <input id="frame" type="range" min="0" value="0"></label><span id="key"></span><div id="views"></div><h2>Strips (2x)</h2><div class="strips" id="strips"></div>
<script>const meta=__META__,durations=__DURATIONS__,loops=__LOOPS__,C=meta.cell;const clip=document.querySelector('#clip'),range=document.querySelector('#frame');let image=null,time=0,last=0,paused=false;for(const c of Object.keys(meta.clips))clip.add(new Option(c,c));const views=[['SE','front',false],['SW','front',true],['NE','back',false],['NW','back',true]].map(([label,facing,flip])=>{const figure=document.createElement('figure'),canvas=document.createElement('canvas');canvas.width=canvas.height=C;figure.append(canvas);const caption=document.createElement('figcaption');caption.textContent=label;figure.append(caption);document.querySelector('#views').append(figure);return {ctx:canvas.getContext('2d'),facing,flip}});const next=new Image;next.src='../'+meta.path;next.decode().then(()=>{image=next});clip.onchange=()=>{time=0;range.value=0;range.max=meta.clips[clip.value].front.length-1};range.oninput=()=>{paused=true;document.querySelector('#pause').textContent='Play'};document.querySelector('#pause').onclick=()=>{paused=!paused;document.querySelector('#pause').textContent=paused?'Play':'Pause'};function draw(now){if(last&&!paused)time+=Math.min(now-last,100);last=now;const ids=meta.clips[clip.value].front,ms=durations[clip.value];let step=Number(range.value);if(!paused){const total=ms.reduce((a,b)=>a+b,0),hold=loops.includes(clip.value)?0:1000;let cursor=time%(total+hold);step=ms.length-1;for(let i=0;i<ms.length;i++){if(cursor<ms[i]){step=i;break}cursor-=ms[i]}range.value=step;}if(image)for(const v of views){const idx=meta.clips[clip.value][v.facing][step],x=idx%meta.columns*C,y=Math.floor(idx/meta.columns)*C;v.ctx.clearRect(0,0,C,C);v.ctx.save();v.ctx.imageSmoothingEnabled=false;if(v.flip){v.ctx.translate(C,0);v.ctx.scale(-1,1)}v.ctx.drawImage(image,x,y,C,C,0,0,C,C);v.ctx.restore();v.ctx.fillStyle='#70a49b';v.ctx.fillRect(meta.anchor[0]-3,meta.anchor[1],7,1)}document.querySelector('#key').textContent=meta.frames[ids[step]];requestAnimationFrame(draw)}for(const c of Object.keys(meta.clips)){const im=new Image;im.src='strip-'+c+'-2x.png';im.alt=c;document.querySelector('#strips').append(im)}clip.onchange();requestAnimationFrame(draw);</script></html>'''
    return (body.replace("__CELL__", str(CELL)).replace("__AX__", str(ANCHOR[0])).replace("__AY__", str(ANCHOR[1]))
            .replace("__META__", json.dumps(meta)).replace("__DURATIONS__", json.dumps(durations(meta)))
            .replace("__LOOPS__", json.dumps(sorted(LOOPS))).encode())


# ------------------------------------------------------------ build/check ---

def construct():
    recipe = read_json(SOURCE / "normalization.json")
    inputs = {str(SOURCE / "normalization.json"), "scripts/build-beetle-animation.py"}
    for path in sorted((ROOT / SOURCE).rglob("*")):
        if path.is_file() and (path.parent.name == "prompts" or path.name == "concept-records.json"):
            inputs.add(str(path.relative_to(ROOT)))
    for record in read_json(SOURCE / "concept-records.json")["images"]:
        inputs.add(str(CONCEPTS / record["originalPath"]))
    inputs.add(str(CONCEPTS / "manifest.json"))
    meta = manifest(recipe)
    atlas, registrations = make_atlas(recipe, inputs)
    artifacts = {PKG / "manifest.json": json_bytes(meta), PKG / ATLAS: png_bytes(atlas),
                 PKG / "hit-masks.json": json_bytes({ATLAS: make_mask(atlas)}),
                 SOURCE / "registration.json": json_bytes(registrations)}
    beetle = meta["beetle"]
    for facing in FACINGS:
        sheet = contact(atlas, beetle, facing)
        artifacts[PKG / f"previews/contact-{facing}-native.png"] = png_bytes(sheet)
        artifacts[PKG / f"previews/contact-{facing}-2x.png"] = png_bytes(sheet.resize((sheet.width * 2, sheet.height * 2), NEAREST))
    for clip in CLIPS:
        artifacts[PKG / f"previews/strip-{clip}-2x.png"] = png_bytes(strip(atlas, beetle, clip))
        artifacts[PKG / f"previews/{clip}-four-views.gif"] = animated_gif(atlas, beetle, clip)
    references = set()
    context = context_preview(atlas, beetle, references)
    native, double = CONTEXT
    artifacts[native] = png_bytes(context)
    artifacts[double] = png_bytes(context.resize((context.width * 2, context.height * 2), NEAREST))
    artifacts[PKG / "previews/index.html"] = html_preview(beetle)
    return artifacts, inputs, references, meta, atlas, recipe


def validate(artifacts, inputs, references, meta, atlas, recipe):
    beetle = meta["beetle"]
    registrations = json.loads(artifacts[SOURCE / "registration.json"])
    assert meta["schemaVersion"] == 2 and meta["nativePixelsPerUnit"] == 32
    assert beetle["cell"] == CELL and beetle["anchor"] == list(ANCHOR)
    assert beetle["filter"] == "nearest" and beetle["mipmaps"] is False
    assert atlas.size == (beetle["columns"] * CELL, beetle["rows"] * CELL) and max(atlas.size) <= 2048
    names = beetle["frames"]
    assert len(names) == FRAME_COUNT == len(set(names))
    indices = sorted(i for clip in beetle["clips"].values() for lane in clip.values() for i in lane)
    assert indices == list(range(FRAME_COUNT)), "every key reachable exactly once"
    for record in read_json(SOURCE / "concept-records.json")["images"]:
        original = ROOT / CONCEPTS / record["originalPath"]
        assert sha(original.read_bytes()) == record["sha256"], ("concept original changed", record["originalPath"])
    alpha = atlas.getchannel("A").tobytes()
    assert set(alpha) == {0, 255}, "binary alpha"
    colors = {c for _, c in atlas.getcolors(atlas.width * atlas.height) if c[3]}
    assert all(c == (0, 0, 0, 0) for _, c in atlas.getcolors(atlas.width * atlas.height) if not c[3])
    allowed = {tuple(bytes.fromhex(v["hex"])) + (255,) for v in recipe["palette"].values()}
    assert colors <= allowed and len(colors) <= 48, ("palette", len(colors))
    frames = [frame(atlas, i) for i in range(FRAME_COUNT)]
    assert len({sha(im.tobytes()) for im in frames}) == FRAME_COUNT, "duplicate key"
    bounds, widths = [], {}
    for index, im in enumerate(frames):
        box = im.getbbox()
        assert box and 0 < box[0] < box[2] < CELL and 0 < box[1] < box[3] < CELL, (index, box)
        bounds.append(box)
    for facing in FACINGS:
        for clip in CLIPS:
            keys = [frames[i] for i in beetle["clips"][clip][facing]]
            signatures = {sha(im.crop(im.getbbox()).tobytes()) for im in keys}
            assert len(signatures) == len(keys), (facing, clip, "translated duplicate")
        for clip in ("idle", "walk"):
            lanes = beetle["clips"][clip][facing]
            bottoms = [bounds[i][3] for i in lanes]
            # Front keys stand on their lowest support. The rear rig keeps one
            # root for every key; only a lifted near leg may leave the anchor row.
            if facing == "front":
                assert all(b == ANCHOR[1] for b in bottoms), (facing, clip, bottoms)
            else:
                assert len({tuple(registrations[i]["offset"]) for i in lanes}) == 1, (facing, clip, "rig root moved")
                assert all(ANCHOR[1] - 3 <= b <= ANCHOR[1] for b in bottoms) and ANCHOR[1] in bottoms, (facing, clip, bottoms)
            widths[f"{facing}-{clip}"] = [bounds[i][2] - bounds[i][0] for i in lanes]
    hound_mass = 1458
    idle_mass = [sum(1 for a in frames[i].getchannel("A").tobytes() if a) for i in beetle["clips"]["idle"]["front"]]
    assert min(idle_mass) > 1.4 * hound_mass, ("beetle must read bulkier than the hound", idle_mass)
    for front, back in zip(beetle["clips"]["idle"]["front"], beetle["clips"]["idle"]["back"]):
        a, b = frames[front], frames[back]
        assert a.tobytes() != b.tobytes() and a.transpose(Image.Transpose.FLIP_LEFT_RIGHT).tobytes() != b.tobytes()
    table = palette_rgb(recipe)
    weak = {table[CORAL[1]] + (255,), table[CORAL[2]] + (255,)}
    for facing in FACINGS:
        for clip in CLIPS:
            for i in beetle["clips"][clip][facing]:
                has_weak = any(c in weak for _, c in frames[i].getcolors(CELL * CELL))
                assert has_weak == (clip == "stunned"), (facing, clip, i, "weak spot only while stunned")
    masks = json.loads(artifacts[PKG / "hit-masks.json"])
    assert list(masks) == [ATLAS] and masks[ATLAS] == make_mask(atlas)
    return {"status": "passed", "toolchain": {"python": platform.python_version(), "pillow": PILLOW_VERSION},
            "beetle": {"frames": FRAME_COUNT, "size": list(atlas.size), "cell": CELL, "anchor": list(ANCHOR),
                       "columns": COLUMNS, "rows": ROWS, "opaqueColors": len(colors), "binaryAlpha": True,
                       "transparentRGBZero": True, "distinctFrames": FRAME_COUNT, "boundsUnclipped": True,
                       "groundedLocomotion": True, "weakSpotOnlyInStunned": True,
                       "frontIdleMassPx": idle_mass, "houndIdleMassPx": hound_mass,
                       "locomotionWidthsPx": widths,
                       "clips": {clip: {facing: beetle["clips"][clip][facing] for facing in FACINGS} for clip in CLIPS}},
            "artifactCount": len(artifacts), "sourceCount": len(inputs), "referenceCount": len(references)}


def provenance(inputs, references, artifacts):
    return {"schemaVersion": 1, "date": "2026-10-23",
            "generationMode": "No new image generation. All keys are deterministic Pillow derivations of the existing Paper artbook beetle originals (openai-gpt-image-edit-2-5, recorded in the concept manifest).",
            "rightsNote": "Project references and derivatives. Inherited source provenance retained; this record is not a new license grant.",
            "acceptance": {"status": "worker-inspected-awaiting-coordinator",
                           "authority": "Coordinator accepts under user delegation. No personal user approval is claimed.",
                           "boundary": "Asset owner inspects native contact sheets and exported pixels; live game/browser acceptance belongs to the coordinator."},
            "normalization": "Per-sheet fixed scalar, majority-vote native resampling, explicit 15-color gray-violet/soft-underside/magenta/coral palette, closed coal rim, no dithering. Front keys come from the authored SE sheets; rear keys come from a cut-out rig of the single authored NE view. Detached storyboard rings, sparks and dust removed.",
            "builder": "scripts/build-beetle-animation.py",
            "toolchain": {"python": platform.python_version(), "pillow": PILLOW_VERSION},
            "inputs": [{"path": p, "sha256": sha((ROOT / p).read_bytes())} for p in sorted(inputs)],
            "referenceInputs": [{"path": p, "sha256": sha((ROOT / p).read_bytes())} for p in sorted(references)],
            "referenceNote": "Reference inputs feed only the floor-context previews. If a sibling package changes them, --verify-only reports the context previews as stale instead of failing the beetle package.",
            "outputs": [{"path": str(p), "sha256": sha(data), "bytes": len(data)} for p, data in sorted(artifacts.items())]}


def run(verify_only):
    artifacts, inputs, references, meta, atlas, recipe = construct()
    report = validate(artifacts, inputs, references, meta, atlas, recipe)
    if verify_only:
        record = read_json(PKG / "provenance.json")
        for source in record["inputs"]:
            assert sha((ROOT / source["path"]).read_bytes()) == source["sha256"], ("source changed", source["path"])
        stale = [r["path"] for r in record["referenceInputs"] if sha((ROOT / r["path"]).read_bytes()) != r["sha256"]]
        skip = {str(p) for p in CONTEXT} if stale else set()
        for output in record["outputs"]:
            if output["path"] not in skip:
                assert sha((ROOT / output["path"]).read_bytes()) == output["sha256"], ("output changed", output["path"])
        assert sorted(o["path"] for o in record["outputs"]) == sorted(str(p) for p in artifacts), "artifact set drift"
        for path, data in artifacts.items():
            if str(path) not in skip:
                assert (ROOT / path).read_bytes() == data, ("rebuild differs", str(path))
        report.update(rebuildMatches=True, sourceHashesMatch=True, mode="read-only",
                      contextPreview={"status": "stale-reference", "changed": stale} if stale else {"status": "matches"})
    else:
        for path, data in artifacts.items():
            (ROOT / path).parent.mkdir(parents=True, exist_ok=True)
            (ROOT / path).write_bytes(data)
        (ROOT / PKG / "provenance.json").write_bytes(json_bytes(provenance(inputs, references, artifacts)))
        report.update(rebuildMatches=True, sourceHashesMatch=True, mode="build", contextPreview={"status": "matches"})
        (ROOT / PKG / "qa-report.json").write_bytes(json_bytes(report))
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true", help="Reconstruct and validate in memory; no filesystem writes")
    run(parser.parse_args().verify_only)
