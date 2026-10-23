#!/usr/bin/env python3
"""Rebuild the camp package from saved ImageGen originals, without network calls.

Uses the existing Python 3 / Pillow environment. --verify-only never writes.
Paths are resolved relative to this script's checkout, never a machine location.
"""

import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import sys

from PIL import Image, ImageDraw, __version__ as PILLOW_VERSION


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/game/pixel-v5/camp"
STATIC_NAMES = ["tent-left", "tent-right", "road-marker", "campfire-base", "supply-cache", "fallen-log"]
FLAME_NAMES = [f"flame-{i}" for i in range(4)]


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
    image.convert("RGBA").save(buffer, "PNG", optimize=False, compress_level=9)
    return buffer.getvalue()


def components(image):
    width, height = image.size
    remaining = {i for i, a in enumerate(pixels(image.getchannel("A"))) if a}
    groups = []
    while remaining:
        seed = min(remaining)
        remaining.remove(seed)
        group = [seed]
        for i in group:
            x, y = i % width, i // width
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    candidate = ny * width + nx
                    if 0 <= nx < width and 0 <= ny < height and candidate in remaining:
                        remaining.remove(candidate)
                        group.append(candidate)
        groups.append(group)
    return sorted(groups, key=len, reverse=True)


def clean_largest(image, limit):
    groups = components(image)
    assert groups, "empty normalized source"
    keep = set(groups[0])
    removed = sum(map(len, groups[1:]))
    assert removed / (len(keep) + removed) <= limit, "substantial disconnected source art"
    image.putdata([p if i in keep else (0, 0, 0, 0) for i, p in enumerate(pixels(image))])
    return image, removed


def normalize_static(spec, threshold=128):
    image = load_rgba(OUT / spec["source"])
    alpha = image.getchannel("A")
    assert alpha.getextrema() == (0, 255), f"{spec['id']}: source must have real transparency"
    alpha = alpha.point(lambda a: 255 if a >= threshold else 0)
    box = alpha.getbbox()
    assert box, "empty source alpha"
    image.putalpha(alpha)
    image = image.crop(box)
    scale = min(spec["fit"][0] / image.width, spec["fit"][1] / image.height)
    image = image.resize(tuple(max(1, round(d * scale)) for d in image.size), Image.Resampling.NEAREST)
    image, removed = clean_largest(image, 0.03)
    image = image.crop(image.getchannel("A").getbbox())
    offset = (128 - image.width // 2, 232 - image.height)
    cell = Image.new("RGBA", (256, 256))
    cell.alpha_composite(image, offset)
    return cell, {"id": spec["id"], "sourceAlphaBox": list(box), "nativeSize": list(image.size),
                  "offset": list(offset), "removedIsolatedPixels": removed, "anchor": [128, 232]}


def make_palette(cells, count):
    colors = [p[:3] for cell in cells for p in pixels(cell) if p[3]]
    sample = Image.new("RGB", (len(colors), 1))
    sample.putdata(colors)
    return sample.quantize(colors=count, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)


def apply_palette(cell, palette):
    image = cell.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE).convert("RGBA")
    image.putdata([p if original[3] else (0, 0, 0, 0) for p, original in zip(pixels(image), pixels(cell))])
    return image


def tiled_ground(size):
    earth = load_rgba(ROOT / "assets/game/pixel-v4/landscape/earth.png")
    moss = load_rgba(ROOT / "assets/game/pixel-v4/landscape/moss.png")
    image = Image.new("RGBA", size)
    image.putdata([(earth if abs(x - size[0] // 2) < 80 else moss).getpixel(
        (((x + 2 * y) // 2) % 32, ((2 * y - x) // 2) % 32)) for y in range(size[1]) for x in range(size[0])])
    return image


def tent_preview(cell):
    image = Image.new("RGBA", (560, 288), "#a4aaa3")
    draw = ImageDraw.Draw(image)
    for y in range(32, 272, 16):
        for x in range(8, 264, 16):
            draw.rectangle((x, y, x + 15, y + 15), fill="#c0c3b4" if ((x - 8) // 16 + y // 16) % 2 else "#a4aaa3")
    image.alpha_composite(cell, (8, 16))
    image.alpha_composite(tiled_ground((280, 240)), (280, 32))
    image.alpha_composite(cell, (280, 16))
    monk = load_rgba(ROOT / "assets/game/pixel-v4/landscape/source/references/monk-idle.png")
    image.alpha_composite(monk, (480, 160))
    draw.text((10, 8), "tent-left / 1:1 native / 32 px per unit", fill="#20282e")
    draw.text((285, 8), "existing ground + unchanged hero / art preview", fill="#20282e")
    draw.line((132, 243, 140, 243), fill="#bb332f")
    draw.line((136, 239, 136, 247), fill="#bb332f")
    draw.text((10, 275), "cell 256x256 / ground anchor 128,232", fill="#20282e")
    return image


def save_outputs(outputs):
    for name, data in outputs.items():
        path = OUT / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def atlas(cells, cell_size, columns, rows):
    image = Image.new("RGBA", (cell_size * columns, cell_size * rows))
    for i, cell in enumerate(cells):
        image.alpha_composite(cell, ((i % columns) * cell_size, (i // columns) * cell_size))
    return image


def pack_mask(image):
    bits = bytearray((image.width * image.height + 7) // 8)
    for i, alpha in enumerate(pixels(image.getchannel("A"))):
        if alpha:
            bits[i >> 3] |= 1 << (i & 7)
    return {"width": image.width, "height": image.height, "bits": base64.b64encode(bits).decode("ascii")}


def normalize_flames(recipe):
    spec = recipe["flame"]
    source = load_rgba(OUT / spec["source"])
    alpha = source.getchannel("A")
    assert alpha.getextrema() == (0, 255), "flame source lacks real alpha"
    source.putalpha(alpha.point(lambda a: 255 if a >= recipe["alphaThreshold"] else 0))
    drafts = []
    for crop in spec["sourceCrops"]:
        draft = source.crop(tuple(crop))
        # Small source alpha residue must not influence fitting the actual fire.
        draft, removed = clean_largest(draft, 0.03)
        box = draft.getchannel("A").getbbox()
        drafts.append((draft.crop(box), box, removed))
    scale = min(spec["fit"][0] / max(d[0].width for d in drafts),
                spec["fit"][1] / max(d[0].height for d in drafts))
    frames, registration = [], []
    for i, (draft, box, removed) in enumerate(drafts):
        size = tuple(max(1, round(d * scale)) for d in draft.size)
        sprite = draft.resize(size, Image.Resampling.NEAREST)
        sprite, native_removed = clean_largest(sprite, 0.03)
        root_x = spec["sourceRootX"][i] - spec["sourceCrops"][i][0] - box[0]
        offset = (64 - round(root_x * scale), spec["baseline"] - size[1])
        cell = Image.new("RGBA", (128, 128))
        cell.alpha_composite(sprite, offset)
        frames.append(cell)
        registration.append({"id": FLAME_NAMES[i], "sourceCrop": spec["sourceCrops"][i],
                             "sourceAlphaBoxInCrop": list(box), "sharedScale": scale,
                             "offset": list(offset), "nativeSize": list(size),
                             "removedSourceResidue": removed, "removedNativeResidue": native_removed,
                             "anchor": [64, 112], "flameRoot": [64, spec["baseline"] - 1]})
    # Preserve the first generated root exactly to eliminate foot sliding. All
    # changing tongues remain generated source pixels, not procedural drawings.
    root_top = spec["baseline"] - spec["stableRootRows"]
    shared_root = frames[0].crop((0, root_top, 128, 128))
    for cell in frames[1:]:
        cell.paste(shared_root, (0, root_top))
    return frames, registration


def mark_cross(draw, point, color):
    x, y = point
    draw.line((x - 4, y, x + 4, y), fill=color)
    draw.line((x, y - 4, x, y + 4), fill=color)


def make_previews(cells, flames, footprints):
    previews = {"tent-left": tent_preview(cells[0])}
    contact = Image.new("RGBA", (768, 576), "#a4aaa3")
    draw = ImageDraw.Draw(contact)
    for i, (name, cell) in enumerate(zip(STATIC_NAMES, cells)):
        x, y = i % 3 * 256, i // 3 * 288
        contact.alpha_composite(cell, (x, y + 16))
        draw.text((x + 8, y + 5), f"{i}: {name}", fill="#20282e")
        box = cell.getchannel("A").getbbox()
        draw.text((x + 8, y + 270), f"{box[2]-box[0]}x{box[3]-box[1]}px / anchor 128,232", fill="#20282e")
    previews["contact"] = contact
    outlined = contact.copy()
    draw = ImageDraw.Draw(outlined)
    contacts = {**footprints["tents"], **footprints["props"]}
    for i, name in enumerate(STATIC_NAMES):
        x, y = i % 3 * 256, i // 3 * 288 + 16
        spec = contacts[name]
        polygon = [(px + x, py + y) for px, py in spec["polygon"]]
        draw.line([*polygon, polygon[0]], fill="#12647d", width=1)
        mark_cross(draw, (spec["center"][0] + x, spec["center"][1] + y), "#12647d")
        mark_cross(draw, (128 + x, 232 + y), "#bb332f")
    previews["footprints"] = outlined

    loop = Image.new("RGBA", (512, 176), "#a4aaa3")
    draw = ImageDraw.Draw(loop)
    for i, flame in enumerate(flames):
        loop.alpha_composite(cells[3], (i * 128 - 64, 148 - 232))
        loop.alpha_composite(flame, (i * 128, 148 - 112))
        draw.text((i * 128 + 8, 8), f"{FLAME_NAMES[i]} / 120ms", fill="#20282e")
        mark_cross(draw, (i * 128 + 64, 148), "#bb332f")
    previews["fire-loop"] = loop

    ground = Image.new("RGBA", (768, 296), "#a4aaa3")
    draw = ImageDraw.Draw(ground)
    for i, name in enumerate(STATIC_NAMES[:2]):
        ground.alpha_composite(cells[i], (256 * i, 16))
        polygon = [(x + 256 * i, y + 16) for x, y in footprints["tents"][name]["polygon"]]
        draw.line([*polygon, polygon[0]], fill="#206d8f", width=1)
        for j, (x, y) in enumerate(polygon):
            draw.rectangle((x-1, y-1, x+1, y+1), fill="#12647d")
            draw.text((x + 2, y - 12), str(j), fill="#12647d")
        center = footprints["tents"][name]["center"]
        mark_cross(draw, (center[0] + 256 * i, center[1] + 16), "#12647d")
        mark_cross(draw, (128 + 256 * i, 248), "#bb332f")
        draw.text((256 * i + 8, 6), f"{name} / cloth-base corners", fill="#20282e")
    ground.alpha_composite(cells[3], (512, 16))
    ground.alpha_composite(flames[0], (576, 136))
    mark_cross(draw, (640, 248), "#bb332f")
    mark_cross(draw, (640, 235), "#12647d")
    draw.text((520, 6), "base + flame / shared ground anchor", fill="#20282e")
    draw.text((520, 36), "flame root: anchor + [0,-13]", fill="#20282e")
    draw.text((8, 276), "BLUE: approximate cloth floor / fire root. RED: render anchor. Native pixels; not collision geometry.", fill="#20282e")
    previews["ground-contact"] = ground

    context = tiled_ground((880, 528))
    landscape = load_rgba(ROOT / "assets/game/pixel-v4/landscape/landscape.png")
    def landscape_prop(index, x, y):
        a, b = index % 4 * 160, index // 4 * 160
        context.alpha_composite(landscape.crop((a, b, a + 160, b + 160)), (x - 80, y - 144))
    for index, x, y in [(0, 70, 235), (2, 120, 285), (0, 807, 210), (4, 735, 230), (4, 140, 370), (2, 760, 400)]:
        landscape_prop(index, x, y)
    for index, x, y in [(2, 450, 145), (0, 236, 280), (1, 653, 282), (3, 452, 354), (4, 257, 434), (5, 606, 409)]:
        context.alpha_composite(cells[index], (x - 128, y - 232))
    context.alpha_composite(flames[0], (452 - 64, 354 - 112))
    monk = load_rgba(ROOT / "assets/game/pixel-v4/landscape/source/references/monk-idle.png")
    context.alpha_composite(monk, (365 - 48, 376 - 84))
    draw = ImageDraw.Draw(context)
    draw.rectangle((0, 0, 879, 31), fill="#a4aaa3")
    draw.text((10, 10), "CAMP FAMILY / native 32px per unit / art composition, not runtime or approved layout", fill="#20282e")
    draw.rectangle((0, 496, 879, 527), fill="#a4aaa3")
    draw.text((10, 506), "Existing landscape + unchanged hero. All new props scale 1. Tent entrances face the clearing.", fill="#20282e")
    previews["native-context"] = context

    outputs = {}
    for name, image in previews.items():
        outputs[f"previews/{name}-native.png"] = png_bytes(image)
        outputs[f"previews/{name}-2x.png"] = png_bytes(image.resize((image.width * 2, image.height * 2), Image.Resampling.NEAREST))
    # Lossless animated preview, using the same frames and common anchor as the
    # strip. APNG avoids GIF palette/transparency remapping.
    animation = []
    for flame in flames:
        image = Image.new("RGBA", (128, 144), "#a4aaa3")
        image.alpha_composite(cells[3], (-64, 128 - 232))
        image.alpha_composite(flame, (0, 128 - 112))
        animation.append(image)
    buffer = io.BytesIO()
    animation[0].save(buffer, format="PNG", save_all=True, append_images=animation[1:], duration=120, loop=0, disposal=0, blend=0, compress_level=9)
    outputs["previews/fire-loop.apng"] = buffer.getvalue()
    return outputs


def image_metrics(image):
    data = pixels(image)
    box = image.getchannel("A").getbbox()
    return {"bounds": list(box) if box else None,
            "opaquePixels": sum(bool(p[3]) for p in data),
            "opaqueColors": len({p[:3] for p in data if p[3]})}


def validate(cells, flames, atlases, masks):
    for name, image in atlases.items():
        data = pixels(image)
        assert {p[3] for p in data} == {0, 255}, f"{name}: alpha must be binary"
        assert all(p == (0, 0, 0, 0) for p in data if not p[3]), f"{name}: transparent RGB"
        maximum = 64 if name == "camp.png" else 24
        assert 8 <= len({p[:3] for p in data if p[3]}) <= maximum, f"{name}: shared palette"
        packed = masks[name]
        bits = base64.b64decode(packed["bits"], validate=True)
        assert packed["width"] == image.width and packed["height"] == image.height, "mask dimensions"
        assert len(bits) == (image.width * image.height + 7) // 8, "mask byte length"
        assert all(bool(bits[i >> 3] & (1 << (i & 7))) == bool(p[3]) for i, p in enumerate(data)), "mask mismatch"
    assert atlases["camp.png"].size == (768, 512) and atlases["camp-flame.png"].size == (512, 128), "atlas geometry"
    ranges = [(190, 220, 140, 170), (190, 220, 140, 170), (32, 80, 50, 100),
              (64, 108, 30, 65), (95, 150, 60, 110), (75, 130, 30, 65)]
    for name, cell, bounds in zip(STATIC_NAMES, cells, ranges):
        metrics = image_metrics(cell)
        x0, y0, x1, y1 = metrics["bounds"]
        assert 8 <= x0 < 128 < x1 <= 248 and y0 >= 8 and y1 == 232, f"{name}: gutter or ground anchor"
        assert bounds[0] <= x1-x0 <= bounds[1] and bounds[2] <= y1-y0 <= bounds[3], f"{name}: physical size"
        assert metrics["opaquePixels"] > 500 and metrics["opaqueColors"] >= 8, f"{name}: drawing too sparse"
        assert len(components(cell)[0]) / metrics["opaquePixels"] > 0.97, f"{name}: fragmented drawing"
    assert len({digest(cell.tobytes()) for cell in cells}) == 6, "duplicate static drawing"
    changes = []
    for i, cell in enumerate(flames):
        metrics = image_metrics(cell)
        x0, y0, x1, y1 = metrics["bounds"]
        assert 28 <= x1-x0 <= 68 and 48 <= y1-y0 <= 90 and y1 == 100, "flame size or root"
        assert metrics["opaquePixels"] > 600 and len(components(cell)[0]) / metrics["opaquePixels"] > 0.98, "flame fragments"
        assert cell.crop((0, 94, 128, 128)).tobytes() == flames[0].crop((0, 94, 128, 128)).tobytes(), "unstable flame root"
        a, b = pixels(cell.getchannel("A")), pixels(flames[(i + 1) % 4].getchannel("A"))
        union = sum(bool(x or y) for x, y in zip(a, b))
        changed = sum(x != y for x, y in zip(a, b))
        assert 0.08 <= changed / union <= 0.6, f"flame {i}: insignificant or excessive silhouette change"
        changes.append({"from": FLAME_NAMES[i], "to": FLAME_NAMES[(i + 1) % 4], "changedAlphaPixels": changed,
                        "unionPixels": union, "silhouetteDeltaRatio": round(changed / union, 6)})
    counts = [image_metrics(f)["opaquePixels"] for f in flames]
    assert max(counts) / min(counts) < 1.65, "flame volume drift"
    assert cells[3].getpixel((128, 219))[3] == 255 and flames[0].getpixel((64, 99))[3] == 255, "root misses base"
    return {"status": "passed", "static": [dict(id=n, **image_metrics(c)) for n, c in zip(STATIC_NAMES, cells)],
            "flame": [dict(id=n, **image_metrics(c)) for n, c in zip(FLAME_NAMES, flames)],
            "palettes": {n: image_metrics(a)["opaqueColors"] for n, a in atlases.items()},
            "flameTransitions": changes, "masksMatchAllPixels": True, "stableFlameRootRows": [94, 100],
            "flameRootOffsetFromGroundAnchor": [0, -13], "visualAcceptance": "Coordinator owns final family and runtime review."}


def input_records(recipe, generations):
    paths = {"scripts/build-camp-assets.py"}
    prefix = OUT.relative_to(ROOT).as_posix()
    for name in ["source/generation-records.json", "source/normalization.json", "source/footprints.json"]:
        paths.add(f"{prefix}/{name}")
    for record in generations:
        paths.update([f"{prefix}/{record['original']}", f"{prefix}/{record['prompt']}", *record["referencePaths"]])
    paths.update(recipe["previewReferences"].values())
    assert all(not Path(name).is_absolute() and ".." not in Path(name).parts for name in paths), "non-portable input path"
    return {name: digest((ROOT / name).read_bytes()) for name in sorted(paths)}


def provenance_records(generations):
    records = []
    for generation in generations:
        record = {k: v for k, v in generation.items() if k != "referencePaths"}
        record["originalSha256"] = digest((OUT / record["original"]).read_bytes())
        record["promptSha256"] = digest((OUT / record["prompt"]).read_bytes())
        record["references"] = [{"path": path, "sha256": digest((ROOT / path).read_bytes())} for path in generation["referencePaths"]]
        records.append(record)
    return {"schemaVersion": 1, "assets": records,
            "rightsNote": "Generated with built-in ImageGen for this user-directed project using existing workspace art as reference. No external stock downloads. No separate third-party asset license asserted; review service terms for distribution.",
            "approval": {"authority": "coordinator under user delegation", "date": "2026-10-23",
                         "scope": "tent-left source direction and normalized seed", "family": "awaiting final coordinator review"},
            "edits": "See source/normalization.json and source/registration.json. Originals are preserved byte-for-byte, including any embedded provenance."}


def build_family(recipe, generations):
    assert [s["id"] for s in recipe["static"]] == STATIC_NAMES, "static frame order"
    results = [normalize_static(spec, recipe["alphaThreshold"]) for spec in recipe["static"]]
    cells = [result[0] for result in results]
    flames, flame_registration = normalize_flames(recipe)
    static_palette = make_palette(cells, recipe["staticPaletteColors"])
    flame_palette = make_palette(flames, recipe["flamePaletteColors"])
    cells = [apply_palette(cell, static_palette) for cell in cells]
    flames = [apply_palette(cell, flame_palette) for cell in flames]
    atlases = {"camp.png": atlas(cells, 256, 3, 2), "camp-flame.png": atlas(flames, 128, 4, 1)}
    masks = {name: pack_mask(image) for name, image in atlases.items()}
    qa = validate(cells, flames, atlases, masks)
    footprints = read_json(OUT / "source/footprints.json")
    manifest = {"schemaVersion": 1, "status": "ready", "nativePixelsPerUnit": 32,
                "camp": {"path": "camp.png", "cell": 256, "columns": 3, "rows": 2, "anchor": [128, 232],
                         "frames": STATIC_NAMES, "filter": "nearest", "mipmaps": False},
                "campFlame": {"path": "camp-flame.png", "cell": 128, "columns": 4, "rows": 1, "anchor": [64, 112],
                              "frames": FLAME_NAMES, "filter": "nearest", "mipmaps": False},
                "animations": {"campfire": {"atlas": "campFlame", "frames": FLAME_NAMES, "frameDurationMs": 120, "loop": True}},
                "campfireAssembly": {"baseFrame": "campfire-base", "flameAtlas": "campFlame", "placement": "same world ground anchor",
                                     "flameRootInFlameCell": [64, 99], "flameRootOffsetFromAnchor": [0, -13],
                                     "flameRootInBaseCell": [128, 219]},
                "hitMasks": "hit-masks.json", "provenance": "source/provenance.json", "normalization": "source/normalization.json",
                "previews": "previews/contact-native.png", "footprints": footprints}
    outputs = {name: png_bytes(image) for name, image in atlases.items()}
    outputs.update({f"frames/{name}.png": png_bytes(cell) for name, cell in zip(STATIC_NAMES + FLAME_NAMES, cells + flames)})
    outputs.update({"manifest.json": json_bytes(manifest), "hit-masks.json": json_bytes(masks),
                    "qa-report.json": json_bytes(qa), "source/provenance.json": json_bytes(provenance_records(generations)),
                    "source/registration.json": json_bytes({"static": [r[1] for r in results], "flame": flame_registration}),
                    "source/palettes.json": json_bytes({name: [list(c) for c in sorted({p[:3] for p in pixels(image) if p[3]})] for name, image in atlases.items()})})
    outputs.update(make_previews(cells, flames, footprints))
    return outputs, qa


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    recipe = read_json(OUT / "source/normalization.json")
    generations = read_json(OUT / "source/generation-records.json")
    inputs = input_records(recipe, generations)
    if args.verify_only:
        recorded = read_json(OUT / "reproducibility.json")
        assert recorded["inputs"] == inputs, "source/reference/recipe/script hash mismatch"
    outputs, qa = build_family(recipe, generations)
    record = {"schemaVersion": 1, "pillowVersion": PILLOW_VERSION,
              "encoding": "8-bit RGBA PNG, compress_level=9; sorted deterministic JSON; source paths relative to checkout",
              "inputs": inputs, "outputs": {name: digest(data) for name, data in sorted(outputs.items())}}
    outputs["reproducibility.json"] = json_bytes(record)
    if args.verify_only:
        for name, data in outputs.items():
            assert (OUT / name).read_bytes() == data, f"rebuild differs: {name}"
    else:
        save_outputs(outputs)
    print(json.dumps({"status": "passed", "mode": "verify-only" if args.verify_only else "build",
                      "staticFrames": 6, "flameFrames": 4, "palettes": qa["palettes"],
                      "sourceHashesMatch": True, "rebuildMatches": args.verify_only, "managedArtifacts": len(outputs)}))


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, FileNotFoundError, ValueError, OSError, KeyError) as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}), file=sys.stderr)
        sys.exit(1)
