#!/usr/bin/env python3
"""Normalize the chosen camp concept onto an explicit 2 px display grid.

No crop, painting, or content synthesis: content edits live in the saved
ImageGen v2 original and its exact edit prompt. Writes only this concept folder.
"""
import hashlib
import json
from pathlib import Path

from PIL import Image, __version__ as pillow_version

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'source/scene-original-v2.png'
DESTINATION = ROOT / 'camp-scene.png'

with Image.open(SOURCE) as original:
    source_size = list(original.size)
    assert original.convert('RGBA').getchannel('A').getextrema() == (255, 255)
    logical = original.convert('RGB').resize((756, 426), Image.Resampling.NEAREST)
# Reserve palette entries for the small warm focal points. A whole-scene
# histogram alone lets acres of green erase the fire and the monk's wine sash.
palette_regions = [
    ('landscape', None, 88),
    ('campfire', (429, 145, 495, 222), 16),
    ('monk', (353, 180, 386, 220), 8),
    ('wine-mat', (282, 246, 404, 310), 8),
]
accent_colors = ['481f34', '67243e', '882d50', 'b2465a',
                 'ffedba', 'ffc34e', 'e87e2d', 'ba4c20']
palette_colors = [channel for color in accent_colors for channel in bytes.fromhex(color)]
for name, box, count in palette_regions:
    sample = logical.crop(box) if box else logical
    reduced = sample.quantize(colors=count, method=Image.Quantize.MEDIANCUT,
                              dither=Image.Dither.NONE)
    palette_colors.extend(reduced.getpalette()[:count * 3])
palette_image = Image.new('P', (1, 1))
palette_image.putpalette(palette_colors + palette_colors[:3] * ((768 - len(palette_colors)) // 3))
logical = logical.quantize(palette=palette_image, dither=Image.Dither.NONE).convert('RGBA')
final = logical.resize((1512, 852), Image.Resampling.NEAREST)
final.save(DESTINATION, compress_level=9)
report = {
    'source': str(SOURCE.relative_to(ROOT)),
    'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    'sourceSize': source_size,
    'logicalSize': [756, 426],
    'displaySize': [1512, 852],
    'displayPixelsPerLogicalPixel': 2,
    'resampling': 'nearest',
    'quantization': 'median-cut',
    'paletteRegions': [{'name': name, 'logicalBox': box, 'reservedColors': count}
                       for name, box, count in palette_regions],
    'protectedWineAndFireColors': accent_colors,
    'dithering': False,
    'opaqueColors': len(final.getcolors(1512 * 852)),
    'alphaRange': list(final.getchannel('A').getextrema()),
    'crop': None,
    'aspectRatioAdjustmentPercent': round((1512 / 852) / (source_size[0] / source_size[1]) * 100 - 100, 5),
    'pillow': pillow_version,
    'output': DESTINATION.name,
    'outputSha256': hashlib.sha256(DESTINATION.read_bytes()).hexdigest(),
}
assert report['opaqueColors'] <= 128
assert final.resize((756, 426), Image.Resampling.NEAREST).resize((1512, 852), Image.Resampling.NEAREST).tobytes() == final.tobytes()
(ROOT / 'source/normalization.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
