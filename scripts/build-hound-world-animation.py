#!/usr/bin/env python3
"""Deterministic Task 2 atlas production. Python 3.10+ / Pillow 12.3.0.

No image generation, networking, credentials, or runtime writes occur here.
Authored sources, fixed clip scales and registration recipes live in the package.
Run from any directory. --verify-only validates delivered files without rebuilding.
"""

import argparse
import base64
from collections import deque
import hashlib
import json
import platform
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, __version__ as PILLOW_VERSION


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/game/pixel-v2/hound-world"
SOURCE = OUT / "source"
PREVIEW = OUT / "previews"
NEAREST = Image.Resampling.NEAREST
REGISTRATIONS = []
INPUTS = set()

# Fixed family palettes keep the actor's hide and the scenery's stone invariant.
# No dithering: each native pixel is one intentional opaque palette color.
PALETTES = {
    "hound": "0d0916 151020 1d1729 261f32 30283c 393046 43384f 4c4058 "
             "55485f 605167 6b5a72 77647d 847088 938097 a492a6 "
             "27152f 3d2246 55325e 704476 8b5792 a76bad c784cd e8a5e9 "
             "381335 60164d 8d1967 c52298 f132cf ff80e9 ffc7f4 "
             "4e4147 75636a a08a86 c3af9e e3cfb2 f9e9c7 fff5dd "
             "6c2944 a74151 db5b62 ff8a7b ffc3a5",
    "world": "100d1d 191426 211b2e 292337 322b40 3d354a 473e54 53495f "
             "60546b 6d6077 7d6f86 8c7d92 9d8fa3 b1a1b2 c6b4c2 ddc9cf f0dfda "
             "2d202a 402a2c 553632 6c4739 85563e 9d6b49 b88051 d09b65 "
             "eab775 f7d091 ffe6b1 fff2ce "
             "12323e 174b54 196573 1b8490 1cabb8 24ced5 56e5e9 92faf1 d3fff8 "
             "35102f 571243 7e1456 a5166b cf1b87 ed2b9d ff4bb7 ff82d2 ffb9e8 ffe1fa "
             "6f371c a65523 cd772f ed9e43 ffc75c ffde89 fff0b5 fffff0",
    "effects": "62243e 933747 b94850 e05c5b ff796c ff9d86 ffc3a3 ffe6c8 fffff0 "
               "4f103c 771047 9f145c c51a76 e72a91 ff45b0 ff79ce ffa7e3 ffe0f6 "
               "513020 7a4724 a5662b cc8a39 eeb14f ffd376 ffe59f fff1c5 fffff2",
}

TIMINGS = {
    "hound": {
        "idle": {"ms": [180, 180, 180, 180], "loop": True},
        "run": {"ms": [85] * 6, "loop": True, "note": "Preview only; runtime follows distance."},
        "attack": {"ms": [275, 275, 120, 150, 350, 350], "loop": False,
                   "note": "Windup 550 / leap 270 / recovery 700 ms."},
        "hurt": {"ms": [65, 65, 90, 100], "loop": False},
        "death": {"ms": [100, 110, 130, 140, 160, 260], "loop": False},
    },
    "world": {
        "brazier-cyan": {"ms": [100] * 6, "loop": True},
        "brazier-magenta": {"ms": [120] * 6, "loop": True},
        "shrine": {"ms": [100, 140, 160, 220, 280, 200], "loop": False,
                   "note": "Keys at 0/100/240/400/620/900 ms; healing remains immediate."},
        "gate": {"ms": [80, 140, 160, 160, 160, 200], "loop": False,
                 "note": "Keys at 0/80/220/380/540/700 ms; hold open."},
    },
    "effects": {name: {"ms": [65, 65, 85, 90, 100, 120], "loop": False}
                for name in ("impact", "warning", "healing")},
}


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_source(path):
    INPUTS.add(path)
    return Image.open(ROOT / path).convert("RGBA")


def rgba_map(im, predicate):
    data = bytearray(im.tobytes())
    for i in range(0, len(data), 4):
        r, g, b, a = data[i:i + 4]
        if not predicate(r, g, b, a):
            data[i:i + 4] = b"\x00\x00\x00\x00"
        else:
            data[i + 3] = 255
    return Image.frombytes("RGBA", im.size, bytes(data))


def largest_component(im):
    """Remove disconnected baked telegraph/dust; never repaint body pixels."""
    width, height = im.size
    active = bytearray(im.getchannel("A").tobytes())
    best = []
    for start in range(len(active)):
        if not active[start]:
            continue
        queue, component = deque([start]), []
        active[start] = 0
        while queue:
            pos = queue.popleft()
            component.append(pos)
            x, y = pos % width, pos // width
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1),
                           (1, 1), (-1, 1), (1, -1), (-1, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < width and 0 <= ny < height:
                    nxt = ny * width + nx
                    if active[nxt]:
                        active[nxt] = 0
                        queue.append(nxt)
        if len(component) > len(best):
            best = component
    alpha = bytearray(width * height)
    for pos in best:
        alpha[pos] = 255
    result = im.copy()
    result.putalpha(Image.frombytes("L", im.size, bytes(alpha)))
    return result


def clean_hound(im, threshold):
    return rgba_map(im, lambda r, g, b, a: a >= threshold
                    and not (g > r + 4 and b > r + 8))


def clean_world(im):
    # Background and false cast-shadow ramps were measured on both RGB boards.
    # Dark ink is below these bands and remains intact.
    def keep(r, g, b, a):
        background = 33 <= r <= 51 and 28 <= g <= 46 and 41 <= b <= 62
        shadow = 23 <= r <= 35 and 17 <= g <= 31 and 31 <= b <= 51
        return not (background or shadow)
    return rgba_map(im, keep)


def cyan(r, g, b, a):
    return a > 0 and g > 90 and b > 90 and (g > r + 20 or (g > 215 and b > 215))


def magenta(r, g, b, a):
    return a > 0 and r > 95 and b > 65 and r > g + 30 and b > g + 20


def amber(r, g, b, a):
    return a > 0 and r > 120 and g > 65 and r > b + 35 and g > b + 15


def place(im, root, scale, cell, anchor, label):
    """One uniform scalar for the entire clip; root translation only per key."""
    resized = im.resize(tuple(round(v * scale) for v in im.size), NEAREST)
    offset = (round(anchor[0] - root[0] * scale),
              round(anchor[1] - root[1] * scale))
    box = resized.getbbox()
    if box:
        target = (box[0] + offset[0], box[1] + offset[1],
                  box[2] + offset[0], box[3] + offset[1])
        assert 0 < target[0] < target[2] < cell, (label, target)
        assert 0 < target[1] < target[3] < cell, (label, target)
    result = Image.new("RGBA", (cell, cell))
    result.paste(resized, offset)
    return result


def hound_frames(recipe):
    frames = []
    for facing, actions in recipe["hound"].items():
        for clip, config in actions.items():
            sheet = clean_hound(read_source(config["source"]), recipe["alphaThreshold"])
            xs, ys = config["xs"], config["ys"]
            index = 0
            for y0, y1 in zip(ys, ys[1:]):
                for x0, x1 in zip(xs, xs[1:]):
                    key = sheet.crop((x0, y0, x1, y1))
                    source_path = config["source"]
                    bounds = [x0, y0, x1, y1]
                    calibration = 1
                    override = config.get("overrides", {}).get(str(index))
                    if override:
                        source_path = override["source"]
                        bounds = override["bounds"]
                        key = clean_hound(read_source(source_path), recipe["alphaThreshold"]).crop(bounds)
                        calibration = override["sourceCalibration"]
                    if config.get("largestComponent"):
                        key = largest_component(key)
                    box = key.getbbox()
                    assert box, (facing, clip, index)
                    # Tail-aware horizontal registration; padding/bbox affects
                    # translation, NEVER scale, aspect or anatomical dimensions.
                    root = (box[0] + .55 * (box[2] - box[0]), box[3])
                    label = f"{facing}-{clip}-{index + 1:02}"
                    frames.append(place(key, root, config["scale"] * calibration, 96,
                                        (48, 84 - config["lift"][index]), label))
                    REGISTRATIONS.append(dict(atlas="hound", frame=label,
                                              source=source_path, crop=bounds,
                                              root=list(root), scale=config["scale"],
                                              sourceCalibration=calibration,
                                              lift=config["lift"][index]))
                    index += 1
            assert index == len(config["lift"])
    return frames


def world_frames(recipe):
    config = recipe["world"]
    fire = read_source(config["fireSource"])
    interactions = read_source(config["interactionSource"])
    frames = []
    for clip, y0, y1, ground, predicate in (
            ("brazier-cyan", 0, 274, 254, cyan),
            ("brazier-magenta", 276, 511, 493, magenta)):
        keys = []
        for center in config["fireCenters"]:
            bounds = (center - 110, y0, center + 110, y1)
            key = clean_world(fire.crop(bounds))
            keys.append(key)
        base = rgba_map(keys[0], lambda r, g, b, a: a and not predicate(r, g, b, a))
        base = largest_component(base)
        for index, key in enumerate(keys):
            flame = rgba_map(key, predicate)
            assembled = Image.alpha_composite(base, flame)
            frames.append(place(assembled, (110, ground - y0), config["brazierScale"],
                                160, (80, 144), f"{clip}-{index}"))
            REGISTRATIONS.append(dict(atlas="world", frame=f"front-{clip}-{index + 1:02}",
                                      source=config["fireSource"],
                                      center=config["fireCenters"][index], ground=ground,
                                      scale=config["brazierScale"], staticBaseKey=0))
    shrine_keys = []
    for center in config["interactionCenters"]:
        shrine_keys.append(clean_world(interactions.crop((center - 110, 275, center + 110, 500))))
    base = largest_component(shrine_keys[0])
    for index, key in enumerate(shrine_keys):
        glow = rgba_map(key, amber)
        assembled = Image.alpha_composite(base, glow)
        frames.append(place(assembled, (110, 475 - 275), config["shrineScale"],
                            160, (80, 144), f"shrine-{index}"))
        REGISTRATIONS.append(dict(atlas="world", frame=f"front-shrine-{index + 1:02}",
                                  source=config["interactionSource"], center=config["interactionCenters"][index],
                                  ground=475, scale=config["shrineScale"], staticBaseKey=0))
    gate_keys = []
    for center in config["interactionCenters"]:
        gate_keys.append(clean_world(interactions.crop((center - 110, 20, center + 110, 265))))
    # A stationary arch/threshold overlays animated leaves inside a fixed portal.
    opening = Image.new("L", gate_keys[0].size)
    ImageDraw.Draw(opening).polygon([(66, 77), (108, 64), (151, 91),
                                    (154, 207), (62, 191)], fill=255)
    static = gate_keys[0].copy()
    static.putalpha(ImageChops.subtract(static.getchannel("A"), opening))
    static = largest_component(static)
    for index, key in enumerate(gate_keys):
        leaves = key.copy()
        leaves.putalpha(ImageChops.multiply(leaves.getchannel("A"), opening))
        assembled = Image.alpha_composite(leaves, static)
        frames.append(place(assembled, (110, 245 - 20), config["gateScale"],
                            160, (80, 144), f"gate-{index}"))
        REGISTRATIONS.append(dict(atlas="world", frame=f"front-gate-{index + 1:02}",
                                  source=config["interactionSource"], center=config["interactionCenters"][index],
                                  ground=245, scale=config["gateScale"], staticArchKey=0))
    return frames


def effect_frames(recipe):
    config = recipe["effects"]
    sheet = read_source(config["source"])
    frames = []
    for clip, y0, y1 in (("impact", 70, 325), ("warning", 395, 602), ("healing", 635, 935)):
        for index, center in enumerate(config["centers"]):
            bounds = (center - 126, y0, center + 126, y1)
            key = sheet.crop(bounds)
            # The row crops contain only the requested effect family. A common
            # intensity cutoff keeps neutral-white cores that hue keys perforate.
            key = rgba_map(key, lambda r, g, b, a: max(r, g, b) >= 110)
            offset = config.get(clip + "Offset", [0, 0])
            root = (126 - offset[0] / config["scale"],
                    config["rootY"][clip] - y0 - offset[1] / config["scale"])
            frame = place(key, root, config["scale"], 192, (96, 96), f"{clip}-{index}")
            # A ten-pixel aperture protects the target at the effect origin.
            # Spark/slash registration already puts initial impact to the side.
            ImageDraw.Draw(frame).rectangle(config["clearCenter"], fill=(0, 0, 0, 0))
            frames.append(frame)
            REGISTRATIONS.append(dict(atlas="effects", frame=f"front-{clip}-{index + 1:02}",
                                      source=config["source"], crop=list(bounds), root=list(root),
                                      scale=config["scale"], centerAperture=config["clearCenter"]))
    return frames


def quantize(im, family):
    colors = [tuple(bytes.fromhex(c)) for c in PALETTES[family].split()]
    palette = Image.new("P", (1, 1))
    flattened = [channel for rgb in colors for channel in rgb]
    palette.putpalette(flattened + list(colors[-1]) * (256 - len(colors)))
    alpha = im.getchannel("A")
    result = im.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE).convert("RGBA")
    result.putalpha(alpha)
    return rgba_map(result, lambda r, g, b, a: a > 0)


def frame_from_atlas(atlas, meta, index):
    cell = meta["cell"]
    x, y = (index % meta["columns"]) * cell, (index // meta["columns"]) * cell
    return atlas.crop((x, y, x + cell, y + cell))


def pack_mask(atlas):
    packed = bytearray((atlas.width * atlas.height + 7) // 8)
    for index, alpha in enumerate(atlas.getchannel("A").tobytes()):
        if alpha:
            packed[index // 8] |= 1 << (index % 8)
    return {"width": atlas.width, "bits": base64.b64encode(packed).decode("ascii")}


def backdrop(width, height):
    result = Image.new("RGB", (width, height), "#292537")
    draw = ImageDraw.Draw(result)
    for y in range(0, height, 8):
        for x in range(0, width, 8):
            if (x // 8 + y // 8) % 2:
                draw.rectangle((x, y, x + 7, y + 7), fill="#302b3e")
    return result


def previews(atlases, manifest):
    for family, atlas in atlases.items():
        meta = manifest[family]
        cell = meta["cell"]
        lanes = [(clip, facing, indices) for clip, facings in meta["clips"].items()
                 for facing, indices in facings.items()]
        sheet = backdrop(6 * cell, len(lanes) * (cell + 22))
        draw = ImageDraw.Draw(sheet)
        for row, (clip, facing, indices) in enumerate(lanes):
            for col, index in enumerate(indices):
                key = frame_from_atlas(atlas, meta, index)
                x, y = col * cell, row * (cell + 22)
                sheet.paste(key, (x, y), key)
                ax, ay = meta["anchor"]
                draw.line((x + ax - 3, y + ay, x + ax + 3, y + ay), fill="#70a49b")
                label = f"{index:02} {facing} {clip}" if family == "hound" else f"{index:02} {clip}"
                draw.text((x + 4, y + cell + 3), label, fill="#ded3df")
        sheet.save(PREVIEW / f"{family}-contact-native.png")
        for clip, facings in meta["clips"].items():
            count = len(facings["front"])
            animation = []
            for frame_index in range(count):
                board = backdrop(cell * len(facings), cell + 24)
                draw = ImageDraw.Draw(board)
                for column, (facing, indices) in enumerate(facings.items()):
                    key = frame_from_atlas(atlas, meta, indices[frame_index])
                    board.paste(key, (column * cell, 0), key)
                    draw.text((column * cell + 4, cell + 4), f"{facing} {frame_index + 1}/{count}", fill="#e6dbe8")
                animation.append(board)
            durations = TIMINGS[family][clip]["ms"].copy()
            if not TIMINGS[family][clip]["loop"]:
                durations[-1] += 1200
            animation[0].save(PREVIEW / f"{family}-{clip}-native.gif", save_all=True,
                              append_images=animation[1:], duration=durations, loop=0,
                              disposal=2, optimize=False)
    html = (SOURCE / "preview-template.html").read_text()
    html = html.replace("__MANIFEST__", json.dumps(manifest)).replace("__TIMINGS__", json.dumps(TIMINGS))
    (PREVIEW / "index.html").write_text(html)
    # Targeted review evidence: actual four delivered back-idle frames at 2x.
    meta, atlas = manifest["hound"], atlases["hound"]
    idle = meta["clips"]["idle"]["back"]
    strip = backdrop(384, 118)
    animation = []
    for column, index in enumerate(idle):
        frame = frame_from_atlas(atlas, meta, index)
        strip.paste(frame, (column * 96, 0), frame)
        ImageDraw.Draw(strip).text((column * 96 + 5, 99), str(index), fill="#ebdaeb")
        board = backdrop(96, 96)
        board.paste(frame, (0, 0), frame)
        animation.append(board.resize((192, 192), NEAREST))
    strip.resize((768, 236), NEAREST).save(PREVIEW / "back-idle-after-2x.png")
    animation[0].save(PREVIEW / "back-idle-cycle-2x.gif", save_all=True,
                      append_images=animation[1:], duration=[180] * 4,
                      loop=0, disposal=2, optimize=False)


def verify():
    manifest = json.loads((OUT / "manifest.json").read_text())
    planned = json.loads((SOURCE / "planned-manifest.json").read_text())
    masks = json.loads((OUT / "hit-masks.json").read_text())
    report = {"status": "passed", "python": platform.python_version(),
              "pillow": PILLOW_VERSION, "checks": [], "atlases": {}}
    assert manifest["schemaVersion"] == 2 and manifest["nativePixelsPerUnit"] == 32
    assert set(masks) == {"hound-v2.png", "world-v2.png", "effects-v2.png"}
    for family, count, limit in (("hound", 52, 48), ("world", 24, 64), ("effects", 18, 64)):
        meta = manifest[family]
        for field in ("path", "cell", "columns", "rows", "anchor", "frames", "clips", "filter", "mipmaps"):
            assert meta[field] == planned[family][field], (family, field, "index contract drift")
        atlas = Image.open(OUT / meta["path"]).convert("RGBA")
        assert atlas.size == (meta["columns"] * meta["cell"], meta["rows"] * meta["cell"])
        assert max(atlas.size) < 2048
        assert len(meta["frames"]) == count and len(set(meta["frames"])) == count
        assert meta["filter"] == "nearest" and meta["mipmaps"] is False
        indices = [i for facings in meta["clips"].values() for lane in facings.values() for i in lane]
        assert sorted(indices) == list(range(count))
        alpha = atlas.getchannel("A")
        assert set(alpha.tobytes()) == {0, 255}
        pixels = list(atlas.get_flattened_data())
        colors = {p[:3] for p in pixels if p[3]}
        assert len(colors) <= limit
        assert all(p[:3] == (0, 0, 0) for p in pixels if not p[3]), family
        assert masks[meta["path"]] == pack_mask(atlas), (family, "mask mismatch")
        boxes, widths, hashes = [], [], []
        for index in range(count):
            frame = frame_from_atlas(atlas, meta, index)
            box = frame.getbbox()
            assert box and 0 < box[0] < box[2] < meta["cell"] and 0 < box[1] < box[3] < meta["cell"], (family, index, box)
            boxes.append(list(box))
            widths.append(box[2] - box[0])
            hashes.append(hashlib.sha256(frame.tobytes()).hexdigest())
            if family == "effects":
                assert not frame.getchannel("A").crop((92, 92, 102, 102)).getbbox(), (family, index, "center not clear")
        assert len(set(hashes)) == count, (family, "duplicate keys")
        if family == "hound":
            for clip, facings in meta["clips"].items():
                for front, back in zip(facings["front"], facings["back"]):
                    a = frame_from_atlas(atlas, meta, front)
                    b = frame_from_atlas(atlas, meta, back)
                    assert a.tobytes() != b.tobytes()
                    assert a.transpose(Image.Transpose.FLIP_LEFT_RIGHT).tobytes() != b.tobytes()
            assert all(65 <= widths[i] <= 80 for i in meta["clips"]["idle"]["front"] + meta["clips"]["idle"]["back"])
            baseline = json.loads((SOURCE / "back-idle-before-frame-hashes.json").read_text())
            changed = [i for i, digest in enumerate(hashes) if digest != baseline[str(i)]]
            assert changed == [28, 29], ("Targeted idle correction changed other keys", changed)
            report["backIdleCorrection"] = {"changedIndices": changed, "unchangedHoundFrames": 50,
                                           "sourceCalibration": 0.744,
                                           "preview": "previews/back-idle-cycle-2x.gif"}
        if family == "world":
            for clip, facings in meta["clips"].items():
                # The shrine's bowl may light up above y=138; its stone foot
                # and every other prop's bottom support must be pixel-identical.
                band = [frame_from_atlas(atlas, meta, index).crop((0, 138, 160, 160)).tobytes()
                        for index in facings["front"]]
                assert len(set(band)) == 1, (clip, "base moves")
        report["atlases"][family] = dict(path=meta["path"], size=list(atlas.size), frames=count,
                                         opaqueColors=len(colors), binaryAlpha=True, transparentRGBZero=True,
                                         uniqueKeys=len(set(hashes)), noClipping=True, maskExact=True,
                                         sha256=sha256(OUT / meta["path"]), frameBounds=boxes)
        print(f"{family}: {atlas.width}x{atlas.height}, {count} unique keys, {len(colors)}/{limit} opaque colors, alpha/masks/bounds OK")
    report["checks"] = ["Frozen indices and clip coverage", "All 94 frames nonempty and unique",
                        "Binary alpha; transparent RGB zero", "Exact little-bit-first masks",
                        "No content touches cell edges", "Hound idle width 65–80 px",
                        "Back keys differ from front and horizontal mirrors",
                        "All four scenery base bands are bit-identical across six keys",
                        "All eighteen effects have a clear 10x10 center"]
    provenance = json.loads((SOURCE / "provenance.json").read_text())
    for source in provenance["inputs"]:
        assert sha256(ROOT / source["path"]) == source["sha256"], (source["path"], "source changed")
    report["checks"].append("Source hashes verified")
    preview_count = 0
    for family in ("hound", "world", "effects"):
        for clip, facings in manifest[family]["clips"].items():
            with Image.open(PREVIEW / f"{family}-{clip}-native.gif") as gif:
                assert gif.n_frames == len(facings["front"]), (family, clip, "preview frame count")
                for i in range(gif.n_frames):
                    gif.seek(i)
                    gif.load()
                    assert gif.info["duration"] > 0
            preview_count += 1
        with Image.open(PREVIEW / f"{family}-contact-native.png") as sheet:
            assert sheet.width == 6 * manifest[family]["cell"]
            sheet.verify()
    with Image.open(PREVIEW / "back-idle-cycle-2x.gif") as gif:
        assert gif.n_frames == 4 and gif.size == (192, 192)
    html = (PREVIEW / "index.html").read_text()
    assert "__MANIFEST__" not in html and "__TIMINGS__" not in html
    report["previews"] = {"nativeClipGifs": preview_count, "nativeContactSheets": 3,
                          "backIdle2x": True, "player": "previews/index.html"}
    report["checks"].append("All 12 native clip GIFs, three contact sheets and 2x back-idle cycle decode")
    return report


def build():
    PREVIEW.mkdir(parents=True, exist_ok=True)
    recipe = json.loads((SOURCE / "normalization.json").read_text())
    manifest = json.loads((SOURCE / "planned-manifest.json").read_text())
    manifest["status"] = "complete"
    groups = {"hound": hound_frames(recipe), "world": world_frames(recipe), "effects": effect_frames(recipe)}
    atlases, masks = {}, {}
    for family, frames in groups.items():
        meta = manifest[family]
        assert len(frames) == len(meta["frames"])
        cell = meta["cell"]
        atlas = Image.new("RGBA", (meta["columns"] * cell, meta["rows"] * cell))
        for index, key in enumerate(frames):
            atlas.paste(key, (index % meta["columns"] * cell, index // meta["columns"] * cell))
        atlas = quantize(atlas, family)
        atlas.save(OUT / meta["path"], optimize=True)
        atlases[family], masks[meta["path"]] = atlas, pack_mask(atlas)
    manifest["source"] = {"provenance": "source/provenance.json", "registration": "source/registration.json",
                          "timings": "source/preview-timings.json", "preview": "previews/index.html",
                          "note": "Authored artbook fronts and built-in ImageGen backs; deterministic Pillow normalization."}
    write_json(OUT / "manifest.json", manifest)
    write_json(OUT / "hit-masks.json", masks)
    write_json(SOURCE / "registration.json", REGISTRATIONS)
    write_json(SOURCE / "preview-timings.json", TIMINGS)
    records = json.loads((SOURCE / "generation-records.json").read_text())
    for entry in records:
        INPUTS.add(str((OUT / entry["localPath"]).relative_to(ROOT)))
        INPUTS.add(str((OUT / entry["promptPath"]).relative_to(ROOT)))
        for ref in entry["referencePaths"]:
            INPUTS.add(ref)
    for path in (SOURCE / "prompts").glob("*.txt"):
        INPUTS.add(str(path.relative_to(ROOT)))
    for path in (SOURCE / "normalization.json", SOURCE / "planned-manifest.json", SOURCE / "preview-template.html",
                 SOURCE / "back-idle-before-frame-hashes.json", SOURCE / "generation-records.json", Path(__file__)):
        INPUTS.add(str(path.relative_to(ROOT)))
    write_json(SOURCE / "provenance.json", {
        "date": "2026-10-22", "license": "Project-generated assets; no external stock assets.",
        "toolchain": {"python": platform.python_version(), "pillow": PILLOW_VERSION},
        "generation": "Only built-in image_gen. Exact requests and all generated originals retained; no CLI/API fallback.",
        "sourceArt": "Existing approved Paper artbook originals are read-only inputs; their original provenance stays beside them.",
        "selection": "Back death v2 accepted for persistent rear view; v1 retained as rejected. Back-idle 28/29 corrected by a separate two-key source; 26/27 and the other 48 hound keys are byte-identical. All original generations retained.",
        "normalization": "Nearest sampling at one fixed scalar per action sheet; root translation only per pose. Alpha >=220, blue false shadows removed. World structures held from one key, flames/glows/door interiors isolated. Explicit family palettes, no dithering. No pose bbox stretching.",
        "inputs": [{"path": p, "sha256": sha256(ROOT / p)} for p in sorted(INPUTS)],
        "generationRecords": records,
        "qaBoundary": "Native sheets and exact-atlas GIF/HTML previews provided. Live Chrome/gameplay acceptance belongs to the runtime/main owner; no browser was operated by this task."
    })
    previews(atlases, manifest)
    report = verify()
    write_json(OUT / "qa-report.json", report)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true", help="Read-only check of the delivered atlases and sources")
    args = parser.parse_args()
    if args.verify_only:
        verify()
    else:
        build()
