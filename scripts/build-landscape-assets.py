#!/usr/bin/env python3
"""Normalize saved ImageGen drafts; --verify-only reconstructs without writes.

Requires the workspace's existing Python/Pillow. No network or generation calls.
Only assets/game/pixel-v4/landscape is written by a normal build.
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
OUT = ROOT / "assets/game/pixel-v4/landscape"
FRAME_NAMES = ["cypress", "dead-tree", "rock-large", "rock-small", "shrub",
               "grass", "ruin-pile", "supplies"]
SURFACE_NAMES = ["earth", "moss", "cliff"]


def read_json(path):
    return json.loads(path.read_text())


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def png_bytes(image):
    buffer = io.BytesIO()
    image.convert("RGBA").save(buffer, "PNG", optimize=False, compress_level=9)
    return buffer.getvalue()


def pixels(image):
    return list(image.get_flattened_data())


def load_rgba(path):
    with Image.open(path) as image:
        return image.convert("RGBA")


def connected_components(image):
    width, height = image.size
    remaining = {i for i, alpha in enumerate(pixels(image.getchannel("A"))) if alpha}
    groups = []
    while remaining:
        seed = min(remaining)
        remaining.remove(seed)
        group = [seed]
        for index in group:
            x, y = index % width, index // width
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    candidate = ny * width + nx
                    if 0 <= nx < width and 0 <= ny < height and candidate in remaining:
                        remaining.remove(candidate)
                        group.append(candidate)
        groups.append(group)
    return sorted(groups, key=len, reverse=True)


def normalize_prop(spec, recipe):
    original = load_rgba(OUT / "source/originals" / f"{spec['id']}.png")
    alpha = original.getchannel("A")
    assert alpha.getextrema() == (0, 255), f"{spec['id']}: missing transparent draft"
    alpha = alpha.point(lambda a: 255 if a >= recipe["alphaThreshold"] else 0)
    original.putalpha(alpha)
    source_box = alpha.getbbox()
    assert source_box, f"{spec['id']}: empty draft"
    sprite = original.crop(source_box)
    scale = min(spec["fit"][0] / sprite.width, spec["fit"][1] / sprite.height)
    size = tuple(max(1, round(d * scale)) for d in sprite.size)
    sprite = sprite.resize(size, Image.Resampling.NEAREST)
    groups = connected_components(sprite)
    assert groups, f"{spec['id']}: empty normalized draft"
    keep = set(groups[0])
    removed = sum(map(len, groups[1:]))
    assert removed / (len(keep) + removed) < 0.03, f"{spec['id']}: substantial detached art"
    sprite.putdata([rgba if i in keep else (0, 0, 0, 0)
                    for i, rgba in enumerate(pixels(sprite))])
    sprite = sprite.crop(sprite.getchannel("A").getbbox())
    cell = Image.new("RGBA", (160, 160))
    offset = (80 - sprite.width // 2, 144 - sprite.height)
    cell.alpha_composite(sprite, offset)
    return cell, {"id": spec["id"], "sourceAlphaBox": list(source_box),
                  "nativeSize": list(sprite.size), "offset": list(offset),
                  "removedIsolatedPixels": removed, "role": spec["role"],
                  "collision": "none", "anchor": [80, 144]}


def shared_palette(cells, count):
    opaque = [rgba[:3] for cell in cells for rgba in pixels(cell) if rgba[3]]
    sample = Image.new("RGB", (len(opaque), 1))
    sample.putdata(opaque)
    return sample.quantize(colors=count, method=Image.Quantize.MEDIANCUT,
                           dither=Image.Dither.NONE)


def apply_palette(image, palette):
    rgb = image.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE).convert("RGBA")
    rgb.putdata([color if source[3] else (0, 0, 0, 0)
                 for color, source in zip(pixels(rgb), pixels(image))])
    return rgb


def normalize_surface(spec, recipe):
    original = load_rgba(OUT / "source/originals" / f"{spec['id']}.png")
    assert original.getchannel("A").getextrema() == (255, 255), "surface draft must be opaque"
    image = original.convert("RGB").resize(tuple(spec["size"]), Image.Resampling.NEAREST)
    data = pixels(image)
    mean = [sum(p[c] for p in data) / len(data) for c in range(3)]
    # Explicit outdoor grade: preserve authored texture, move its material mean,
    # and soften contrast so ground cannot compete with actors and warnings.
    image.putdata([tuple(max(0, min(255, round(spec["meanRgb"][c]
                         + spec["contrast"] * (p[c] - mean[c])))) for c in range(3))
                   for p in data])
    radius = recipe["seams"]["width"]
    for axis in (0, 1):
        before = image.copy()
        for edge_distance in range(radius):
            weight = 0.5 * (1 - edge_distance / radius)
            for along in range(32):
                a = (edge_distance, along) if axis == 0 else (along, edge_distance)
                b = (31 - edge_distance, along) if axis == 0 else (along, 31 - edge_distance)
                pa, pb = before.getpixel(a), before.getpixel(b)
                image.putpixel(a, tuple(round(x * (1 - weight) + y * weight) for x, y in zip(pa, pb)))
                image.putpixel(b, tuple(round(y * (1 - weight) + x * weight) for x, y in zip(pa, pb)))
    return image.quantize(colors=recipe["surfacePalette"]["colors"],
                          method=Image.Quantize.MEDIANCUT,
                          dither=Image.Dither.NONE).convert("RGBA")


def pack_mask(atlas):
    packed = bytearray((atlas.width * atlas.height + 7) // 8)
    for index, alpha in enumerate(pixels(atlas.getchannel("A"))):
        if alpha:
            packed[index >> 3] |= 1 << (index & 7)
    return {"width": atlas.width, "height": atlas.height,
            "bits": base64.b64encode(packed).decode("ascii")}


def repeat_surface(tile, width, height):
    result = Image.new("RGBA", (width, height))
    for y in range(0, height, tile.height):
        for x in range(0, width, tile.width):
            result.paste(tile, (x, y))
    return result


def make_previews(cells, surfaces, registrations, recipe):
    previews = {}
    monk = load_rgba(OUT / recipe["preview"]["monk"])
    world = load_rgba(OUT / recipe["preview"]["world"])
    contact = Image.new("RGBA", (960, 400), "#89918b")
    draw = ImageDraw.Draw(contact)
    for i, (cell, registration) in enumerate(zip(cells, registrations)):
        x, y = (i % 4) * 240, (i // 4) * 200
        material = surfaces["moss" if i in (0, 1, 4, 5) else "earth"]
        contact.paste(repeat_surface(material, 236, 62), (x + 2, y + 116))
        contact.alpha_composite(cell, (x, y + 14))
        contact.alpha_composite(monk, (x + 126, y + 74))
        draw.text((x + 8, y + 5), f"{i:02d} {registration['id']}", fill="#182828")
        w, h = registration["nativeSize"]
        draw.text((x + 8, y + 180), f"{w}x{h}px | 32px/u | monk 1:1", fill="#182828")
    previews["contact-native.png"] = contact
    previews["contact-2x.png"] = contact.resize((1920, 800), Image.Resampling.NEAREST)

    surface_board = Image.new("RGBA", (336, 120), "#89918b")
    surface_draw = ImageDraw.Draw(surface_board)
    for i, (name, tile) in enumerate(surfaces.items()):
        repeated = repeat_surface(tile, 96, 96)
        previews[f"{name}-repeat-native.png"] = repeated
        previews[f"{name}-repeat-4x.png"] = repeated.resize((384, 384), Image.Resampling.NEAREST)
        surface_board.paste(repeated, (i * 112 + 8, 4))
        surface_draw.text((i * 112 + 8, 104), name, fill="#182828")
    previews["surfaces-repeat-native.png"] = surface_board
    previews["surfaces-repeat-4x.png"] = surface_board.resize((1344, 480), Image.Resampling.NEAREST)

    # A native-pixel art review composition, explicitly not an in-engine capture.
    # 2:1 mapping gives the textures the same projected density as ground planes.
    context = Image.new("RGBA", (800, 432))
    ground = []
    for y in range(context.height):
        for x in range(context.width):
            u, v = (x + 2 * y) // 2, (2 * y - x) // 2
            path_center = 490 - y // 2
            material = "earth" if abs(x - path_center) < 72 else "moss"
            ground.append(surfaces[material].getpixel((u % 32, v % 32)))
    context.putdata(ground)
    placements = [(0, 112, 202), (1, 678, 202), (4, 182, 255), (6, 618, 284),
                  (2, 214, 320), (7, 535, 330), (3, 650, 355), (5, 102, 363)]
    for index, x, baseline in placements:
        context.alpha_composite(cells[index], (x - 80, baseline - 144))
    context.alpha_composite(monk, (382 - 48, 292 - 84))
    context.alpha_composite(world, (456 - 80, 210 - 144))
    context_draw = ImageDraw.Draw(context)
    context_draw.rectangle((0, 0, 799, 35), fill="#89918b")
    context_draw.text((12, 10), "OUTDOOR / native 32px per unit / authored art composition, not engine capture", fill="#182828")
    context_draw.rectangle((0, 398, 799, 431), fill="#89918b")
    context_draw.text((12, 408), "Existing monk and brazier shown at unchanged native size; every landscape prop at scale 1.", fill="#182828")
    previews["native-context.png"] = context
    previews["native-context-2x.png"] = context.resize((1600, 864), Image.Resampling.NEAREST)
    return {f"previews/{name}": png_bytes(image) for name, image in previews.items()}


def validate(atlas, surfaces, packed):
    assert atlas.size == (640, 320), "atlas size"
    data = pixels(atlas)
    assert {p[3] for p in data} == {0, 255}, "binary prop alpha"
    assert all(p == (0, 0, 0, 0) for p in data if not p[3]), "transparent RGB"
    colors = {p[:3] for p in data if p[3]}
    assert 12 <= len(colors) <= 48, "prop family palette"
    assert packed["width"] == 640 and packed["height"] == 320, "mask dimensions"
    bits = base64.b64decode(packed["bits"], validate=True)
    assert len(bits) == 640 * 320 // 8, "packed mask length"
    assert all(bool(bits[i >> 3] & (1 << (i & 7))) == bool(p[3])
               for i, p in enumerate(data)), "mask pixel mismatch"
    frames = []
    unique = set()
    height_ranges = [(110, 136), (95, 125), (32, 56), (12, 28),
                     (20, 42), (10, 24), (34, 64), (36, 64)]
    for i, name in enumerate(FRAME_NAMES):
        x, y = (i % 4) * 160, (i // 4) * 160
        cell = atlas.crop((x, y, x + 160, y + 160))
        box = cell.getchannel("A").getbbox()
        assert box and box[0] >= 4 and box[1] >= 4 and box[2] <= 156, f"{name}: cell gutter"
        assert box[3] == 144 and box[0] < 80 < box[2], f"{name}: anchor"
        height = box[3] - box[1]
        assert height_ranges[i][0] <= height <= height_ranges[i][1], f"{name}: native size"
        groups = connected_components(cell)
        opaque_count = sum(map(len, groups))
        assert opaque_count > 70 and len(groups[0]) / opaque_count >= 0.97, f"{name}: silhouette"
        unique.add(digest(cell.tobytes()))
        frames.append({"id": name, "box": list(box), "opaquePixels": opaque_count,
                       "components": len(groups), "nativeSize": [box[2] - box[0], height]})
    assert len(unique) == 8, "duplicate prop art"
    surface_report = []
    for name, image in surfaces.items():
        assert image.size == (32, 32), f"{name}: size"
        p = pixels(image)
        assert all(rgba[3] == 255 for rgba in p), f"{name}: alpha holes"
        color_count = len({rgba[:3] for rgba in p})
        assert 4 <= color_count <= 24, f"{name}: palette"
        for index in range(32):
            assert image.getpixel((0, index)) == image.getpixel((31, index)), f"{name}: x seam"
            assert image.getpixel((index, 0)) == image.getpixel((index, 31)), f"{name}: y seam"
        luminance = [0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b, _ in p]
        span = max(luminance) - min(luminance)
        assert span <= 70, f"{name}: excessive contrast"
        surface_report.append({"id": name, "size": [32, 32], "opaqueColors": color_count,
                               "seamMismatchPixels": 0, "luminanceRange": round(span, 3),
                               "meanRgb": [round(sum(rgba[c] for rgba in p) / len(p), 2) for c in range(3)]})
    return {"props": {"frames": 8, "size": [640, 320], "opaqueColors": len(colors),
                       "maskPixelChecks": 640 * 320, "cells": frames}, "surfaces": surface_report}


def build_artifacts():
    recipe = read_json(OUT / "source/normalization.json")
    assert recipe["nativePixelsPerUnit"] == 32
    assert recipe["cell"] == 160 and recipe["anchor"] == [80, 144]
    assert [p["id"] for p in recipe["props"]] == FRAME_NAMES
    assert [p["id"] for p in recipe["surfaces"]] == SURFACE_NAMES
    normalized = [normalize_prop(spec, recipe) for spec in recipe["props"]]
    raw_cells, registrations = zip(*normalized)
    palette = shared_palette(raw_cells, recipe["propPalette"]["colors"])
    cells = [apply_palette(cell, palette) for cell in raw_cells]
    atlas = Image.new("RGBA", (640, 320))
    for i, cell in enumerate(cells):
        atlas.paste(cell, ((i % 4) * 160, (i // 4) * 160))
    surfaces = {spec["id"]: normalize_surface(spec, recipe) for spec in recipe["surfaces"]}
    packed = pack_mask(atlas)
    report = validate(atlas, surfaces, packed)
    report["status"] = "passed"
    artifacts = {"landscape.png": png_bytes(atlas), "hit-masks.json": json_bytes({"landscape.png": packed})}
    artifacts.update({f"{name}.png": png_bytes(image) for name, image in surfaces.items()})
    artifacts.update(make_previews(cells, surfaces, registrations, recipe))
    artifacts["source/registration.json"] = json_bytes({"frames": registrations})
    artifacts["source/palette.json"] = json_bytes({"landscape": sorted({"#%02x%02x%02x" % p[:3] for p in pixels(atlas) if p[3]}),
        "surfaces": {name: sorted({"#%02x%02x%02x" % p[:3] for p in pixels(image)}) for name, image in surfaces.items()}})
    records = read_json(OUT / "source/generation-records.json")["records"]
    assert [r["id"] for r in records] == FRAME_NAMES + SURFACE_NAMES
    provenance_assets = []
    for record in records:
        name = record["id"]
        original, prompt = f"source/originals/{name}.png", f"source/prompts/{name}.txt"
        refs = []
        for reference in record["references"]:
            reference_path = Path(reference)
            assert not reference_path.is_absolute(), f"working reference must be repo-relative: {reference}"
            reference_path = (ROOT / reference_path).resolve()
            refs.append({"path": reference_path.relative_to(ROOT).as_posix(),
                         "sha256": digest(reference_path.read_bytes()), "role": "style/palette reference"})
        provenance_assets.append({"id": name, "tool": "image_gen.imagegen", "mode": "built-in",
            "model": "not exposed by tool", "generatedOn": "2026-10-22",
            "original": original, "originalSha256": digest((OUT / original).read_bytes()),
            "prompt": prompt, "promptSha256": digest((OUT / prompt).read_bytes()),
            "references": refs, "requestedTransparentBackground": record["transparent_background"],
            "output": "landscape.png" if name in FRAME_NAMES else f"{name}.png",
            "frame": FRAME_NAMES.index(name) if name in FRAME_NAMES else None,
            "sourceNote": "Generated for this project. No third-party asset download or new license asserted; reference rights inherited from project.",
            "edits": "Deterministic crop, native resize, alpha cleanup, joint palette and packing" if name in FRAME_NAMES
                     else "Deterministic native resize, outdoor material grade, periodic edge repair and palette reduction"})
    inputs = ["source/normalization.json", "source/generation-records.json",
              recipe["preview"]["monk"], recipe["preview"]["world"]]
    inputs += [item[key] for item in provenance_assets for key in ("original", "prompt")]
    provenance = {"schemaVersion": 1, "assets": provenance_assets,
        "sourceHashes": {name: digest((OUT / name).read_bytes()) for name in inputs},
        "builder": {"path": "scripts/build-landscape-assets.py", "sha256": digest(Path(__file__).read_bytes()),
                    "python": sys.version.split()[0], "pillow": PILLOW_VERSION},
        "previewReferences": [
            {"path": recipe["preview"]["monk"], "source": "assets/game/pixel-v2/monk/monk-v2.png", "box": [0, 0, 96, 96]},
            {"path": recipe["preview"]["world"], "source": "assets/game/pixel-v2/hound-world/world-v2.png", "box": [0, 0, 160, 160]}],
        "contentCredentials": "Original PNG bytes retained unmodified; normalized outputs use sidecar provenance and do not claim retained embedded credentials.",
        "approval": {"technical": "automated checks", "nativeVisual": "see artifacts/landscape-art.md", "inEngine": "coordinator-owned, not claimed"}}
    artifacts["source/provenance.json"] = json_bytes(provenance)
    manifest = {"schemaVersion": 1, "status": "ready", "nativePixelsPerUnit": 32,
        "landscape": {"path": "landscape.png", "cell": 160, "columns": 4, "rows": 2,
                      "anchor": [80, 144], "frames": FRAME_NAMES, "filter": "nearest", "mipmaps": False},
        "surfaces": {name: {"path": f"{name}.png", "size": [32, 32], "filter": "nearest", "mipmaps": False}
                     for name in SURFACE_NAMES},
        "hitMasks": "hit-masks.json", "provenance": "source/provenance.json",
        "normalization": "source/normalization.json", "previews": "previews/contact-native.png"}
    artifacts["manifest.json"] = json_bytes(manifest)
    report["runtimeBytes"] = sum(len(artifacts[name]) for name in ["manifest.json", "landscape.png", "hit-masks.json", "earth.png", "moss.png", "cliff.png"])
    report["textureMemoryRgbaBytes"] = (640 * 320 + 3 * 32 * 32) * 4
    artifacts["qa-report.json"] = json_bytes(report)
    artifacts["reproducibility.json"] = json_bytes({"algorithm": "SHA-256",
        "artifacts": {name: digest(data) for name, data in sorted(artifacts.items())},
        "verify": "python3 scripts/build-landscape-assets.py --verify-only"})
    return artifacts, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true", help="read, reconstruct, compare; never write")
    args = parser.parse_args()
    artifacts, report = build_artifacts()
    if args.verify_only:
        provenance = read_json(OUT / "source/provenance.json")
        changed_sources = [name for name, expected in provenance["sourceHashes"].items()
                           if digest((OUT / name).read_bytes()) != expected]
        assert not changed_sources, f"source hash mismatch: {changed_sources}"
        mismatches = [name for name, expected in artifacts.items()
                      if not (OUT / name).exists() or (OUT / name).read_bytes() != expected]
        assert not mismatches, f"deterministic reconstruction mismatch: {mismatches}"
        validate(load_rgba(OUT / "landscape.png"),
                 {name: load_rgba(OUT / f"{name}.png") for name in SURFACE_NAMES},
                 read_json(OUT / "hit-masks.json")["landscape.png"])
    else:
        # All content is generated and validated before the ready manifest is published.
        for name, data in sorted(artifacts.items(), key=lambda item: item[0] == "manifest.json"):
            destination = OUT / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
    report.update({"mode": "verify-only" if args.verify_only else "build",
                   "managedArtifacts": len(artifacts)})
    if args.verify_only:
        report.update({"rebuildMatches": True, "sourceHashesMatch": True})
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError, ValueError, KeyError) as error:
        print(json.dumps({"status": "failed", "error": str(error)}), file=sys.stderr)
        sys.exit(1)
