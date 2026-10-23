"""Normalize the selected source sheets. Requires Python 3.10+ and Pillow.

Source boundaries/feet were inspected rather than inferred from the generated grid.
No AI calls: this is a repeatable atlas build with nearest sampling and fixed palettes.
"""
from pathlib import Path
import json
import base64
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/game/pixel-v1'
SOURCE = OUT / 'source'
NEAREST = Image.Resampling.NEAREST


def source(name):
    image = Image.open(SOURCE / f'{name}-sheet.png').convert('RGBA')
    image.putalpha(image.getchannel('A').point(lambda alpha: 255 if alpha >= 220 else 0))
    return image


def normalize(image, bounds, foot, scale, cell=96, anchor=(48, 84)):
    crop = image.crop(bounds)
    size = tuple(round(v * scale) for v in crop.size)
    crop = crop.resize(size, NEAREST)
    position = (round(anchor[0] - (foot[0] - bounds[0]) * scale),
                round(anchor[1] - (foot[1] - bounds[1]) * scale))
    result = Image.new('RGBA', (cell, cell))
    result.paste(crop, position)
    return result


def save_atlas(name, frames, columns, cell, anchor, frame_names):
    rows = (len(frames) + columns - 1) // columns
    atlas = Image.new('RGBA', (columns * cell, rows * cell))
    for index, frame in enumerate(frames):
        atlas.paste(frame, (index % columns * cell, index // columns * cell))
    alpha = atlas.getchannel('A')
    # Remove invisible RGB from the palette calculation and avoid dithering noise.
    opaque = Image.new('RGB', atlas.size, '#171321')
    opaque.paste(atlas.convert('RGB'), mask=alpha)
    if name == 'environment':
        # Reserve accents: area-weighted quantization erases small vivid flames.
        colors = ['141124', '272238', '393249', '51475f', '6c6179', '8e8193', 'b1a3ae', 'dac6bd',
                  '392835', '604334', '906344', 'bc8b57', 'edbe75', 'ffe3a2',
                  '3d1241', '71124f', 'ad176d', 'ef329e', 'ff78cd', 'ffd4f4',
                  '113440', '14545d', '188d9d', '2ac9d3', '7ef3ec', 'e0ffff',
                  '211c2f', '41394f', '5f566f', '847689', 'b5adb7', 'eee0ce']
        palette = Image.new('P', (1, 1))
        rgb = [int(color[i:i + 2], 16) for color in colors for i in (0, 2, 4)]
        palette.putpalette(rgb + rgb[-3:] * (256 - len(colors)))
        atlas = opaque.quantize(palette=palette, dither=Image.Dither.NONE).convert('RGBA')
    else:
        atlas = opaque.quantize(colors=32, method=Image.Quantize.MEDIANCUT,
                                dither=Image.Dither.NONE).convert('RGBA')
    atlas.putalpha(alpha)
    atlas.save(OUT / f'{name}.png', optimize=True)
    metadata = {'path': f'{name}.png', 'cell': cell, 'columns': columns, 'rows': rows,
                'anchor': list(anchor), 'frames': frame_names, 'filter': 'nearest',
                'mipmaps': False, 'colors': len(atlas.convert('RGB').getcolors(atlas.width * atlas.height))}
    for index in range(len(frames)):
        frame = atlas.crop((index % columns * cell, index // columns * cell,
                            (index % columns + 1) * cell, (index // columns + 1) * cell))
        box = frame.getbbox()
        assert box and box[0] > 0 and box[1] > 0 and box[2] < cell and box[3] < cell, (name, index, box)
    assert set(alpha.tobytes()) == {0, 255}
    assert metadata['colors'] <= 32
    print(f'{name}: {atlas.width}x{atlas.height}, {len(frames)} frames, {metadata["colors"]} colors, binary alpha')
    return atlas, metadata


monk = source('monk')
monk_frames = []
foot_rows = [
    [(161, 306), (491, 303), (784, 303), (1116, 306)],
    [(161, 602), (477, 606), (806, 606), (1118, 595)],
    [(167, 914), (487, 918), (799, 918), (1123, 918)],
    [(158, 1210), (473, 1205), (801, 1212), (1114, 1214)],
]
for row in range(4):
    edges = [0, 313, 625, 982 if row in (1, 3) else 938, 1254]
    for column in range(4):
        bounds = (edges[column], round(row * 1254 / 4), edges[column + 1], round((row + 1) * 1254 / 4))
        monk_frames.append(normalize(monk, bounds, foot_rows[row][column], .25))
pose_names = ['idle', 'run-contact-left', 'run-pass-right', 'run-contact-right', 'run-pass-left', 'anticipate', 'strike', 'dash']
monk_atlas, monk_meta = save_atlas('monk', monk_frames, 4, 96, (48, 84),
                                  [f'{view}-{pose}' for view in ['front', 'back'] for pose in pose_names])

hound = source('hound')
hound_bounds = [(0, 0, 470, 444), (475, 0, 895, 444), (900, 0, 1312, 444), (1318, 0, 1774, 444),
                (0, 444, 514, 887), (514, 444, 948, 887), (948, 444, 1330, 887), (1330, 444, 1774, 887)]
hound_feet = [(286, 424), (703, 425), (1134, 420), (1573, 415),
              (310, 766), (759, 802), (1158, 803), (1566, 803)]
hound_atlas, hound_meta = save_atlas('hound',
    [normalize(hound, bounds, foot, .155) for bounds, foot in zip(hound_bounds, hound_feet)],
    4, 96, (48, 84), ['idle', 'run-contact', 'run-pass', 'windup', 'leap', 'recover', 'hurt', 'dead'])

environment = source('environment')
prop_bounds = [(0, 0, 632, 520), (650, 0, 1030, 520), (1135, 0, 1536, 520),
               (80, 530, 490, 1010), (610, 520, 990, 1010), (1070, 540, 1536, 1024)]
prop_feet = [(325, 471), (827, 474), (1325, 492), (290, 945), (802, 945), (1297, 970)]
prop_scales = [.25, .27, .23, .17, .17, .20]
environment_atlas, environment_meta = save_atlas('environment',
    [normalize(environment, bounds, foot, scale, 160, (80, 144))
     for bounds, foot, scale in zip(prop_bounds, prop_feet, prop_scales)],
    3, 160, (80, 144), ['wall-corner', 'arch', 'column', 'brazier-cyan', 'brazier-magenta', 'shrine'])

# A code-authored repeatable paving tile. Its edges are shared by every rotated variant.
floor = Image.new('RGB', (32, 32), '#666071')
d = ImageDraw.Draw(floor)
d.rectangle((0, 0, 31, 31), outline='#302e40', width=1)
d.line([(1, 29), (1, 1), (29, 1)], fill='#96909a', width=1)
d.line([(2, 30), (30, 30), (30, 2)], fill='#4b465a', width=1)
for box, color in [((4, 5, 10, 6), '#716b7c'), ((20, 8, 25, 10), '#5e596b'),
                   ((7, 21, 12, 23), '#5e596b'), ((17, 26, 24, 27), '#716b7c')]:
    d.rectangle(box, fill=color)
d.line([(24, 1), (24, 4), (22, 4), (22, 7)], fill='#4b465a', width=1)
floor.save(OUT / 'floor.png', optimize=True)

manifest = {'schemaVersion': 1, 'nativePixelsPerUnit': 32,
            'monk': monk_meta, 'hound': hound_meta, 'environment': environment_meta,
            'source': {'tool': 'built-in imagegen', 'date': '2026-10-22',
                       'references': 'assets/concepts/pixel-art-01/raw/',
                       'prompts': ['source/monk-prompt.txt', 'source/hound-prompt.txt', 'source/environment-prompt.txt'],
                       'license': 'Generated for this project; no external stock assets.'},
            'floor': {'path': 'floor.png', 'size': [32, 32], 'source': 'code-authored', 'filter': 'nearest'}}
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')

# Packed opaque pixels let pointer picking ignore transparent padding without a GPU readback.
hit_masks = {}
for name, atlas in [('monk', monk_atlas), ('hound', hound_atlas), ('environment', environment_atlas)]:
    packed = bytearray((atlas.width * atlas.height + 7) // 8)
    for index, alpha in enumerate(atlas.getchannel('A').tobytes()):
        if alpha:
            packed[index // 8] |= 1 << (index % 8)
    hit_masks[f'{name}.png'] = {'width': atlas.width, 'bits': base64.b64encode(packed).decode('ascii')}
(OUT / 'hit-masks.json').write_text(json.dumps(hit_masks, separators=(',', ':')) + '\n')

# Individual atlas files are the authoritative previews; the contact sheet stays readable at 1x.
preview = Image.new('RGB', (864, 576), '#494455')
preview.paste(monk_atlas, (0, 0), monk_atlas)
preview.paste(hound_atlas, (0, 384), hound_atlas)
preview.paste(environment_atlas, (384, 0), environment_atlas)
preview.save(OUT / 'contact-sheet.png')
