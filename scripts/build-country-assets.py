#!/usr/bin/env python3
"""Normalize saved built-in ImageGen art; verification never writes files.

No network, generation, dependency installation or runtime code is involved.
All generated output is confined to assets/game/pixel-v6/country.
"""

import argparse
import base64
import hashlib
import io
import json
import math
from pathlib import Path
import sys

from PIL import Image, ImageDraw, __version__ as PILLOW_VERSION

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/game/pixel-v6/country"
FRAMES = ["grass-low", "grass-wide", "fern-low", "flowers-white",
          "flowers-ochre", "leaves", "twigs", "pebbles-flat"]
SURFACES = ["grass", "soil", "stone"]


def data(image):
    return list(image.get_flattened_data())


def read_json(path):
    return json.loads(path.read_text())


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def sha(content):
    return hashlib.sha256(content).hexdigest()


def png_bytes(image):
    buffer = io.BytesIO()
    image.convert("RGBA").save(buffer, "PNG", optimize=False, compress_level=9)
    return buffer.getvalue()


def load_image(path):
    with Image.open(path) as original:
        return original.convert("RGBA")


def normalize_surface(spec, recipe):
    source = load_image(OUT / "source/originals" / f"{spec['id']}.png")
    assert source.getchannel("A").getextrema() == (255, 255), "ground must be opaque"
    image = source.convert("RGB").resize((128, 128), Image.Resampling.NEAREST)
    original = data(image)
    mean = [sum(pixel[c] for pixel in original) / len(original) for c in range(3)]
    image.putdata([tuple(round(spec["meanRgb"][c] + spec["contrast"] * (pixel[c] - mean[c]))
                         for c in range(3)) for pixel in original])
    # Symmetric crossfade only touches the narrow seam band; the rest remains
    # authored image structure. Equal outer pixels survive palette reduction.
    radius = recipe["seamWidth"]
    for axis in (0, 1):
        before = image.copy()
        for distance in range(radius):
            weight = 0.5 * (1 - distance / radius)
            for along in range(128):
                a = (distance, along) if axis == 0 else (along, distance)
                b = (127 - distance, along) if axis == 0 else (along, 127 - distance)
                pa, pb = before.getpixel(a), before.getpixel(b)
                image.putpixel(a, tuple(round(x * (1 - weight) + y * weight) for x, y in zip(pa, pb)))
                image.putpixel(b, tuple(round(y * (1 - weight) + x * weight) for x, y in zip(pa, pb)))
    return image.quantize(colors=recipe["surfaceColors"], method=Image.Quantize.MEDIANCUT,
                          dither=Image.Dither.NONE).convert("RGBA")


def normalize_detail(spec, recipe):
    source = load_image(OUT / "source/originals" / f"{spec['id']}.png")
    assert source.getchannel("A").getextrema() == (0, 255), f"{spec['id']}: missing source alpha"
    source.putalpha(source.getchannel("A").point(lambda a: 255 if a >= recipe["alphaThreshold"] else 0))
    box = source.getchannel("A").getbbox()
    assert box, f"{spec['id']}: empty source"
    sprite = source.crop(box)
    scale = min(spec["fit"][0] / sprite.width, spec["fit"][1] / sprite.height)
    size = tuple(max(1, round(value * scale)) for value in sprite.size)
    sprite = sprite.resize(size, Image.Resampling.NEAREST)
    sprite.putdata([pixel if pixel[3] else (0, 0, 0, 0) for pixel in data(sprite)])
    sprite = sprite.crop(sprite.getchannel("A").getbbox())
    offset = (32 - sprite.width // 2, 56 - sprite.height)
    cell = Image.new("RGBA", (64, 64))
    cell.alpha_composite(sprite, offset)
    return cell, {"id": spec["id"], "sourceAlphaBox": list(box), "nativeSize": list(sprite.size),
                  "offset": list(offset), "anchor": [32, 56], "collision": "none"}


def apply_shared_palette(cells, colors):
    pixels = [pixel[:3] for cell in cells for pixel in data(cell) if pixel[3]]
    sample = Image.new("RGB", (len(pixels), 1))
    sample.putdata(pixels)
    palette = sample.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    result = []
    for cell in cells:
        mapped = cell.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE).convert("RGBA")
        mapped.putdata([color if original[3] else (0, 0, 0, 0)
                        for color, original in zip(data(mapped), data(cell))])
        result.append(mapped)
    return result


def repeat(tile, columns=3, rows=3):
    image = Image.new("RGBA", (tile.width * columns, tile.height * rows))
    for y in range(rows):
        for x in range(columns):
            image.paste(tile, (x * tile.width, y * tile.height))
    return image


def ground_context(surfaces, cells, width=800, height=224):
    image = Image.new("RGBA", (width, height))
    colors = []
    for y in range(height):
        for x in range(width):
            # Art QA only: a 2:1 projection, never a replacement runtime map.
            u, v = (x + 2 * y) // 2, (2 * y - x) // 2
            center = width * 0.49 + 34 * math.sin(y / 53)
            edge = 48 + 5 * math.sin(x * .09 + y * .19) + 4 * math.sin(y * .33)
            name = "soil" if abs(x - center) < edge else "grass"
            colors.append(surfaces[name].getpixel((u % 128, v % 128)))
    image.putdata(colors)
    for i, cell in enumerate(cells):
        x, y = 75 + (i % 4) * 205, 86 + (i // 4) * 90
        if abs(x - width / 2) < 68:
            x += 75
        image.alpha_composite(cell, (x - 32, y - 56))
    monk = load_image(OUT / "source/references/monk-idle.png")
    image.alpha_composite(monk, (width // 2 - 48, height // 2 - 44))
    return image


def target_preview(recipe):
    surfaces = {spec["id"]: normalize_surface(spec, recipe) for spec in recipe["surfaces"][:2]}
    cell, registration = normalize_detail(recipe["details"][0], recipe)
    cell = apply_shared_palette([cell], recipe["detailColors"])[0]
    image = Image.new("RGBA", (800, 688), "#303b37")
    draw = ImageDraw.Draw(image)
    draw.text((16, 10), "COUNTRY TARGET / actual 128px tiles repeated 3x3 / native pixels", fill="#e4e3cf")
    for i, (name, tile) in enumerate(surfaces.items()):
        image.paste(repeat(tile), (8 + 400 * i, 48))
        draw.text((16 + 400 * i, 31), name.upper(), fill="#e4e3cf")
    context = ground_context(surfaces, [cell] * 8)
    image.paste(context, (0, 456))
    draw.text((16, 438), "Native-scale art composition / existing monk / generated grass-low / not an engine capture", fill="#e4e3cf")
    return {"previews/representative-target.png": png_bytes(image),
            "previews/target-grass.png": png_bytes(surfaces["grass"]),
            "previews/target-soil.png": png_bytes(surfaces["soil"]),
            "previews/target-grass-low.png": png_bytes(cell)}, registration


def pack_mask(atlas):
    bits = bytearray(atlas.width * atlas.height // 8)
    for i, alpha in enumerate(data(atlas.getchannel("A"))):
        if alpha:
            bits[i >> 3] |= 1 << (i & 7)
    return {"width": atlas.width, "height": atlas.height,
            "bits": base64.b64encode(bits).decode("ascii")}


def make_previews(surfaces, cells, registrations):
    outputs = {}
    board = Image.new("RGBA", (1200, 420), "#303b37")
    draw = ImageDraw.Draw(board)
    for i, (name, tile) in enumerate(surfaces.items()):
        repeated = repeat(tile)
        outputs[f"previews/{name}-repeat-native.png"] = png_bytes(repeated)
        outputs[f"previews/{name}-repeat-2x.png"] = png_bytes(repeated.resize((768, 768), Image.Resampling.NEAREST))
        board.paste(repeated, (8 + i * 400, 28))
        draw.text((12 + i * 400, 9), f"{name.upper()} / 128px / actual 3x3 repeat", fill="#e4e3cf")
    outputs["previews/surfaces-repeat-native.png"] = png_bytes(board)
    outputs["previews/surfaces-repeat-2x.png"] = png_bytes(board.resize((2400, 840), Image.Resampling.NEAREST))

    monk = load_image(OUT / "source/references/monk-idle.png")
    contact = Image.new("RGBA", (800, 352), "#303b37")
    draw = ImageDraw.Draw(contact)
    for i, (cell, registration) in enumerate(zip(cells, registrations)):
        x, y = i % 4 * 200, i // 4 * 168
        name = ["grass", "soil", "stone"][i % 3]
        background = repeat(surfaces[name], 2, 1).crop((0, 0, 192, 112))
        contact.paste(background, (x + 4, y + 28))
        contact.alpha_composite(cell, (x + 20, y + 72))
        contact.alpha_composite(monk, (x + 98, y + 44))
        draw.text((x + 9, y + 9), f"{i:02d} {registration['id']}", fill="#e4e3cf")
        width, height = registration["nativeSize"]
        draw.text((x + 9, y + 147), f"{width}x{height}px / monk at 1:1", fill="#e4e3cf")
    draw.text((12, 336), "64px cells / anchor [32,56] / native 32px per world unit / no collision", fill="#e4e3cf")
    outputs["previews/contact-native.png"] = png_bytes(contact)
    outputs["previews/contact-2x.png"] = png_bytes(contact.resize((1600, 704), Image.Resampling.NEAREST))
    context = ground_context(surfaces, cells)
    outputs["previews/native-context.png"] = png_bytes(context)
    outputs["previews/native-context-2x.png"] = png_bytes(context.resize((1600, 448), Image.Resampling.NEAREST))
    return outputs


def validate(surfaces, atlas, mask):
    assert atlas.size == (256, 128), "atlas dimensions"
    pixels = data(atlas)
    assert {pixel[3] for pixel in pixels} == {0, 255}, "binary alpha"
    assert all(pixel == (0, 0, 0, 0) for pixel in pixels if not pixel[3]), "transparent RGB must be zero"
    palette = {pixel[:3] for pixel in pixels if pixel[3]}
    assert 12 <= len(palette) <= 32, "bounded shared palette"
    bits = base64.b64decode(mask["bits"], validate=True)
    assert len(bits) == 4096, "packed mask length"
    assert all(bool(bits[i >> 3] & (1 << (i & 7))) == bool(pixel[3])
               for i, pixel in enumerate(pixels)), "mask and PNG mismatch"
    frames = []
    unique = set()
    for i, name in enumerate(FRAMES):
        x, y = i % 4 * 64, i // 4 * 64
        cell = atlas.crop((x, y, x + 64, y + 64))
        box = cell.getchannel("A").getbbox()
        assert box and box[0] >= 4 and box[2] <= 60 and box[3] == 56, f"{name}: anchor/gutter"
        assert box[0] < 32 < box[2] and 10 <= box[3] - box[1] <= 28, f"{name}: low silhouette"
        count = sum(bool(pixel[3]) for pixel in data(cell))
        assert count >= 35, f"{name}: empty/sparse silhouette"
        unique.add(sha(cell.tobytes()))
        frames.append({"id": name, "alphaBox": list(box), "height": box[3] - box[1], "opaquePixels": count})
    assert len(unique) == 8, "duplicate detail frames"
    surface_reports = []
    for name, image in surfaces.items():
        assert image.size == (128, 128), "surface dimensions"
        pixels = data(image)
        assert all(pixel[3] == 255 for pixel in pixels), f"{name}: opaque ground"
        colors = len(set(pixels))
        assert 4 <= colors <= 24, f"{name}: palette"
        luma = [.2126 * p[0] + .7152 * p[1] + .0722 * p[2] for p in pixels]
        spread = max(luma) - min(luma)
        assert spread <= 55, f"{name}: high contrast"
        mean = [sum(p[c] for p in pixels) / len(pixels) for c in range(3)]
        assert all(75 <= value <= 150 for value in mean), f"{name}: outdoor material value"
        if name == "grass":
            assert mean[1] > mean[0] + 7 and mean[1] > mean[2] + 12, "sage/olive green"
        if name == "soil":
            assert mean[0] > mean[1] + 10 and mean[1] > mean[2] + 10, "brown soil"
        if name == "stone":
            assert max(mean) - min(mean) < 12, "neutral gray stone"
        assert all(image.getpixel((0, i)) == image.getpixel((127, i)) for i in range(128)), f"{name}: horizontal seam"
        assert all(image.getpixel((i, 0)) == image.getpixel((i, 127)) for i in range(128)), f"{name}: vertical seam"
        surface_reports.append({"id": name, "size": [128, 128], "colors": colors,
                                "luminanceRange": round(spread, 3), "meanRgb": [round(v, 3) for v in mean],
                                "horizontalSeamEqual": True, "verticalSeamEqual": True})
    return {"status": "passed", "details": {"frames": 8, "colors": len(palette),
            "binaryAlpha": True, "transparentRgbZero": True, "maskMatches": True, "cells": frames},
            "surfaces": surface_reports}


def build_provenance():
    records = read_json(OUT / "source/generation-records.json")["records"]
    by_id = {record["id"]: record for record in records}
    assets = []
    for name in SURFACES + FRAMES:
        record = by_id[name]
        original = f"source/originals/{name}.png"
        prompt = f"source/prompts/{name}.txt"
        assets.append({**record, "original": original, "originalSha256": sha((OUT / original).read_bytes()),
                       "prompt": prompt, "promptSha256": sha((OUT / prompt).read_bytes()),
                       "references": [{"path": path, "sha256": sha((OUT / path).read_bytes()), "role": "imagegen input"}
                                      for path in record["inputReferences"]]})
    guidance = [{"path": f"source/references/{name}", "sha256": sha((OUT / "source/references" / name).read_bytes()),
                 "role": "inspected project guidance/scale comparison; not passed as imagegen input"}
                for name in ["camp-scene.png", "landscape-contact.png", "monk-idle.png"]]
    return {"schemaVersion": 1, "assets": assets, "visualGuidance": guidance,
            "origin": "New drafts generated with built-in image_gen.imagegen; existing project references copied only for guidance and reproducible previews.",
            "normalization": "Deterministic crop, nearest resize, palette reduction, registration, seam repair and QA. No procedural replacement of source art.",
            "terms": "Generated content provided in the user's existing tool session; no third-party stock acquisition. No claim of exclusivity or independent rights clearance.",
            "approval": "source/representative-selection.json", "browserAcceptance": "coordinator-owned"}


def build(recipe):
    surfaces = {spec["id"]: normalize_surface(spec, recipe) for spec in recipe["surfaces"]}
    assert list(surfaces) == SURFACES, "surface order"
    assert [spec["id"] for spec in recipe["details"]] == FRAMES, "detail order"
    pairs = [normalize_detail(spec, recipe) for spec in recipe["details"]]
    cells = apply_shared_palette([pair[0] for pair in pairs], recipe["detailColors"])
    registrations = [pair[1] for pair in pairs]
    atlas = Image.new("RGBA", (256, 128))
    for i, cell in enumerate(cells):
        atlas.alpha_composite(cell, (i % 4 * 64, i // 4 * 64))
    mask = pack_mask(atlas)
    report = validate(surfaces, atlas, mask)
    manifest = {"schemaVersion": 1, "status": "ready", "nativePixelsPerUnit": 32,
                "countryDetails": {"path": "details.png", "cell": 64, "columns": 4, "rows": 2,
                                   "anchor": [32, 56], "frames": FRAMES, "filter": "nearest", "mipmaps": False},
                "surfaces": {f"country{name.title()}": {"path": f"{name}.png", "size": [128, 128],
                                                     "filter": "nearest", "mipmaps": False} for name in SURFACES},
                "hitMasks": "hit-masks.json", "provenance": "source/provenance.json",
                "normalization": "source/normalization.json", "previews": "previews/contact-native.png"}
    outputs = {f"{name}.png": png_bytes(image) for name, image in surfaces.items()}
    outputs.update({"details.png": png_bytes(atlas), "manifest.json": json_bytes(manifest),
                    "hit-masks.json": json_bytes({"details.png": mask}),
                    "source/registration.json": json_bytes({"frames": registrations}),
                    "source/provenance.json": json_bytes(build_provenance()),
                    "source/palette.json": json_bytes({"details": sorted({p[:3] for p in data(atlas) if p[3]}),
                                                      "surfaces": {name: sorted({p[:3] for p in data(im)}) for name, im in surfaces.items()}}),
                    "qa-report.json": json_bytes(report)})
    outputs.update(make_previews(surfaces, cells, registrations))
    targets, _ = target_preview(recipe)
    outputs.update(targets)
    inputs = ["source/normalization.json", "source/generation-records.json", "source/representative-selection.json"]
    inputs += [f"source/{kind}/{name}.{extension}" for name in SURFACES + FRAMES
               for kind, extension in [("originals", "png"), ("prompts", "txt")]]
    inputs += [f"source/references/{name}" for name in ["camp-scene.png", "landscape-contact.png", "monk-idle.png"]]
    reproducibility = {"schemaVersion": 1, "pillowVersion": PILLOW_VERSION, "builderSha256": sha(Path(__file__).read_bytes()),
                       "inputs": {path: sha((OUT / path).read_bytes()) for path in inputs},
                       "outputs": {path: sha(content) for path, content in sorted(outputs.items())}}
    outputs["reproducibility.json"] = json_bytes(reproducibility)
    return outputs, report


def verify_sources():
    record = read_json(OUT / "reproducibility.json")
    assert record["builderSha256"] == sha(Path(__file__).read_bytes()), "builder differs from recorded version"
    for path, expected in record["inputs"].items():
        assert sha((OUT / path).read_bytes()) == expected, f"source hash mismatch: {path}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target-only", action="store_true", help="build the initial coordinator review board")
    parser.add_argument("--verify-only", action="store_true", help="rebuild in memory and compare without writes")
    args = parser.parse_args()
    recipe = read_json(OUT / "source/normalization.json")
    if args.target_only:
        assert not args.verify_only, "target-only and verify-only are mutually exclusive"
        outputs, registration = target_preview(recipe)
        for path, content in outputs.items():
            (OUT / path).parent.mkdir(parents=True, exist_ok=True)
            (OUT / path).write_bytes(content)
        print(json.dumps({"status": "target-created", "outputs": list(outputs), "detail": registration}))
    else:
        assert read_json(OUT / "source/representative-selection.json")["status"] == "approved", "coordinator target selection required"
        if args.verify_only:
            verify_sources()
        outputs, report = build(recipe)
        if args.verify_only:
            for path, expected in outputs.items():
                assert (OUT / path).read_bytes() == expected, f"rebuild mismatch: {path}"
        else:
            for path, content in outputs.items():
                (OUT / path).parent.mkdir(parents=True, exist_ok=True)
                (OUT / path).write_bytes(content)
        print(json.dumps({**report, "mode": "verify-only" if args.verify_only else "build",
                          "rebuildMatches": bool(args.verify_only), "sourceHashesMatch": bool(args.verify_only),
                          "managedArtifacts": len(outputs)}))


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError, ValueError, KeyError) as error:
        print(json.dumps({"status": "failed", "error": str(error)}), file=sys.stderr)
        sys.exit(1)
