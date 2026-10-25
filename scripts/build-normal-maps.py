#!/usr/bin/env python3
"""Deterministic, cell-local pixel normals from the *active* albedo packages.

Run: python3 -B scripts/build-normal-maps.py [--output DIR] [--verify-only]
Requires Python 3.10+ and Pillow 10..12; no numpy, RNG, network or art mutation.
RGB is linear tangent-space +X right, +Y up, +Z toward the viewer. Five fixed
unit directions avoid smooth shading over pixel clusters. Alpha is unsigned
height (0 = outside silhouette), NOT coverage. Always use the albedo alpha.

Four 1px eroded silhouette bands make a bevel. A median/box-filtered, 8-level
luminance cue adds shallow inner folds/block edges, never alters the albedo.
Every frame is processed alone with a transparent border. Full-surface tiles
wrap instead. Emissive/VFX/backdrop maps are flat and marked relight=false.
Appearance recolours share the matching hair geometry's canonical height cue:
colour choice must not change geometry. The original alpha is checked first.
"""
import argparse
import hashlib
import io
import json
import re
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
NORMALS = ((128, 128, 255), (51, 128, 230), (204, 128, 230), (128, 204, 230), (128, 51, 230))
FLAT_KEYS = {'effects', 'campFlame', 'lootGround', 'campBackdrop'}


def normal_cell(source, flat=False, tile=False):
    """Return an equally sized RGBA data texture; there is no atlas-wide filter."""
    source = source.convert('RGBA')
    mask = source.getchannel('A').point(lambda a: 255 if a else 0)
    if not mask.getbbox():
        return Image.new('RGBA', source.size, (*NORMALS[0], 0))
    if flat:
        result = Image.new('RGBA', source.size, (*NORMALS[0], 0))
        result.putalpha(mask.point(lambda a: 1 if a else 0))
        return result
    # Transparent padding makes even a frame touching the cell border bevel inward.
    if tile:
        w, h = source.size
        padded = Image.new('RGBA', (w * 3, h * 3))
        for j in range(3):
            for i in range(3):
                padded.paste(source, (i * w, j * h))
        offset = (w, h)
    else:
        padded = ImageOps.expand(source, border=5, fill=(0, 0, 0, 0))
        offset = (5, 5)
    coverage = padded.getchannel('A').point(lambda a: 255 if a else 0)
    height = coverage.point(lambda a: 56 if a else 0)
    eroded = coverage
    if not tile:
        for _ in range(4):
            eroded = eroded.filter(ImageFilter.MinFilter(3))
            height = ImageChops.add(height, eroded.point(lambda a: 28 if a else 0))
    else:
        height = coverage.point(lambda a: 140 if a else 0)
    luma = ImageOps.grayscale(padded).filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.BoxBlur(1))
    cue = ImageChops.multiply(luma.point(lambda v: (v // 32) * 3), coverage)
    height = ImageChops.add(height, cue)
    hp = height.load()
    ox, oy = offset
    result = Image.new('RGBA', source.size, (*NORMALS[0], 0))
    out = result.load()
    box = mask.getbbox()
    for y in range(box[1], box[3]):
        for x in range(box[0], box[2]):
            px, py = x + ox, y + oy
            value = hp[px, py]
            if not value:
                continue
            nx = hp[px - 1, py] - hp[px + 1, py]
            ny = hp[px, py + 1] - hp[px, py - 1]
            if max(abs(nx), abs(ny)) < 5:
                direction = 0
            elif abs(nx) >= abs(ny):
                direction = 1 if nx < 0 else 2
            else:
                direction = 3 if ny > 0 else 4
            out[x, y] = (*NORMALS[direction], value)
    return result


def normal_atlas(source, cell, flat=False, tile=False):
    source = source.convert('RGBA')
    cw, ch = cell
    if source.width % cw or source.height % ch:
        raise ValueError('Atlas dimensions must be exact multiples of its cell')
    result = Image.new('RGBA', source.size, (*NORMALS[0], 0))
    for y in range(0, source.height, ch):
        for x in range(0, source.width, cw):
            frame = source.crop((x, y, x + cw, y + ch))
            result.paste(normal_cell(frame, flat=flat, tile=tile), (x, y))
    return result


def discover(root):
    """Read the renderer URL registry rather than generating obsolete packages."""
    text = (root / 'src/pixel-assets.js').read_text()
    layouts = {}
    manifests = re.findall(r"import \w+ from '([^']+\.json)'", text)
    manifests += [re.search(r"monkWeaponsManifestUrl = new URL\('([^']+)'", text)[1]]
    def scan(value, directory):
        if isinstance(value, dict):
            if 'path' in value and ('cell' in value or 'columns' in value or 'size' in value):
                layouts[str((directory / value['path']).resolve())] = value
            else:
                for item in value.values():
                    scan(item, directory)
    for relative in dict.fromkeys(manifests):
        path = (root / 'src' / relative).resolve()
        scan(json.loads(path.read_text()), path.parent)
    entries = {}
    pattern = r"(\w+): new URL\('\.\./(assets/game/[^']+\.png)'"
    for key, source in re.findall(pattern, text):
        entries.setdefault(source, {'source': source, 'keys': []})['keys'].append(key)
    # This is the same active appearance folder used by appearance.js.
    appearance_text = (root / 'src/appearance.js').read_text()
    appearance_dir = re.search(r'\.\./(assets/game/[^`]+?)/\$\{variant.id\}\.png', appearance_text)[1]
    appearance = json.loads((root / 'assets/game/pixel-v3/appearance/manifest.json').read_text())
    canonical = {}
    for variant in appearance['variants']:
        source = f"{appearance_dir}/{variant['id']}.png"
        hair = variant['hair']
        canonical.setdefault(hair, source)
        entries[source] = {'source': source, 'keys': [], 'appearanceId': variant['id'], 'geometrySource': canonical[hair]}
    monk = next(e for e in entries.values() if 'monk' in e['keys'])
    monk_layout = layouts[str((root / monk['source']).resolve())]
    for source, entry in sorted(entries.items()):
        path = root / source
        with Image.open(path) as image:
            w, h = image.size
        layout = monk_layout if 'appearanceId' in entry else layouts[str(path.resolve())]
        columns, rows = layout.get('columns', 1), layout.get('rows', 1)
        cell = [w // columns, h // rows]
        if cell[0] * columns != w or cell[1] * rows != h:
            raise ValueError(f'Non-integral cells: {source}')
        entry.update(id=source.removeprefix('assets/game/').removesuffix('.png').replace('/', '-'),
                     keys=sorted(set(entry['keys'])), width=w, height=h, cell=cell,
                     columns=columns, rows=rows, tiled='size' in layout,
                     relight=not bool(set(entry['keys']) & FLAT_KEYS))
        yield entry


def build(root, output, verify=False):
    atlases = []
    geometry_cache = {}
    for entry in discover(root):
        source_path = root / entry['source']
        source = Image.open(source_path).convert('RGBA')
        geometry = entry.get('geometrySource', entry['source'])
        if geometry not in geometry_cache:
            reference = Image.open(root / geometry).convert('RGBA')
            geometry_cache[geometry] = normal_atlas(reference, entry['cell'], flat=not entry['relight'], tile=entry['tiled'])
        normal = geometry_cache[geometry]
        if entry.get('appearanceId'):
            reference = Image.open(root / geometry).convert('RGBA')
            if source.getchannel('A').tobytes() != reference.getchannel('A').tobytes():
                raise ValueError(f'Appearance silhouette differs: {entry["source"]}')
        data = io.BytesIO()
        normal.save(data, format='PNG', optimize=False, compress_level=9)
        data = data.getvalue()
        entry.update(sourceSha256=hashlib.sha256(source_path.read_bytes()).hexdigest(),
                     sha256=hashlib.sha256(data).hexdigest(), downloadBytes=len(data), gpuBytes=source.width * source.height * 4)
        target = output / f'{entry["id"]}.png'
        if verify:
            if target.read_bytes() != data:
                raise ValueError(f'Generated map differs: {target}')
        else:
            output.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        atlases.append(entry)
    manifest = {'schemaVersion': 1, 'generator': 'scripts/build-normal-maps.py', 'algorithmVersion': 1,
                'encoding': {'rgb': 'linear tangent normal; +X right, +Y up, +Z toward viewer',
                             'alpha': 'height; 0 outside silhouette; use albedo alpha for coverage',
                             'directions': NORMALS, 'filter': 'nearest', 'mipmaps': False},
                'atlases': atlases}
    text = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
    if verify:
        if (output / 'manifest.json').read_text() != text:
            raise ValueError('Manifest differs')
    else:
        (output / 'manifest.json').write_text(text)
    print(json.dumps({'atlases': len(atlases), 'downloadBytes': sum(e['downloadBytes'] for e in atlases),
                      'allGpuBytes': sum(e['gpuBytes'] for e in atlases), 'verified': verify}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/game/hd2d-normals')
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    output = args.output.resolve()
    art_root = (ROOT / 'assets/game').resolve()
    if output.is_relative_to(art_root) and output != art_root / 'hd2d-normals':
        parser.error('Output may not overwrite any original art package')
    build(ROOT, output, args.verify_only)
