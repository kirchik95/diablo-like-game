#!/usr/bin/env python3
"""Read-only checks for the camp illustration, genuine Paper export and references."""
from datetime import datetime, timezone
from io import BytesIO
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageCms, ImageStat

ROOT = Path(__file__).resolve().parents[4]
FOLDER = Path(__file__).resolve().parent.parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


scene_path = FOLDER / 'camp-scene.png'
board_path = FOLDER / 'camp-paper-final.png'
scene = Image.open(scene_path)
board = Image.open(board_path)
assert scene.size == (1512, 852) and scene.mode == 'RGBA'
assert board.size == (1600, 1232) and board.mode == 'RGBA'
assert scene.getchannel('A').getextrema() == (255, 255)
assert len(scene.getcolors(scene.width * scene.height)) == 128
assert scene.resize((756, 426), Image.Resampling.NEAREST).resize(
    scene.size, Image.Resampling.NEAREST).tobytes() == scene.tobytes()

normalization = json.loads((FOLDER / 'source/normalization.json').read_text())
assert sha(scene_path) == normalization['outputSha256']
assert sha(FOLDER / normalization['source']) == normalization['sourceSha256']

# Coordinates derive from Paper CSS: 44 px padding, 146 px header, 24 px gap.
# Paper exports Display P3 and antialiases a one-pixel outer edge. Compare
# color-managed interior pixels; do not mistake an ICC transform for blur.
assert board.info.get('icc_profile')
profile = ImageCms.ImageCmsProfile(BytesIO(board.info['icc_profile']))
profile_name = ImageCms.getProfileName(profile).strip()
assert profile_name == 'Display P3 Gamut with sRGB Transfer'
converted = ImageCms.profileToProfile(board, profile, ImageCms.createProfile('sRGB'),
                                     outputMode='RGB')
scene_box = (44, 214, 1556, 1066)
inner_box = (2, 2, 1510, 850)
export_inner = converted.crop(scene_box).crop(inner_box)
source_inner = scene.convert('RGB').crop(inner_box)
difference = ImageChops.difference(source_inner, export_inner)
max_difference = [hi for lo, hi in difference.getextrema()]
assert max(max_difference) <= 1
assert export_inner.resize((754, 424), Image.Resampling.NEAREST).resize(
    export_inner.size, Image.Resampling.NEAREST).tobytes() == export_inner.tobytes()
assert board.getchannel('A').crop((1, 1, 1599, 1231)).getextrema() == (255, 255)

baseline = json.loads((FOLDER / 'source/runtime-before.json').read_text())
changes = []
for relative, before in baseline.items():
    path = ROOT / relative
    after = sha(path) if path.exists() else None
    if after != before:
        changes.append({'path': relative, 'beforeSha256': before, 'afterSha256': after})
current = {str(p.relative_to(ROOT)) for p in (ROOT / 'assets/game/pixel-v4/landscape').rglob('*') if p.is_file()}
added = sorted(current - baseline.keys())
art_drift = [item for item in changes if item['path'].endswith('.png') or
             Path(item['path']).name in {'manifest.json', 'landscape.json', 'hit-masks.json'}]
assert not art_drift, art_drift

reference_pairs = [
    ('assets/concepts/pixel-art-01/raw/p4-pixel-monastery.png', 'accepted-pixel-world.png'),
    ('assets/game/pixel-v4/landscape/previews/contact-native.png', 'landscape-contact-native.png'),
    ('artifacts/adventure-camp-1440x900.jpg', 'runtime-camp-layout.jpg'),
]
for original, local in reference_pairs:
    assert sha(ROOT / original) == sha(FOLDER / 'source/references' / local)

result = {
    'checkedAtUtc': datetime.now(timezone.utc).isoformat(),
    'status': 'pass',
    'scene': {'size': list(scene.size), 'mode': scene.mode, 'colors': 128,
              'alphaRange': [255, 255], 'logicalSize': [756, 426],
              'pixelScale': 2, 'sha256': sha(scene_path)},
    'paperExport': {'size': list(board.size), 'mode': board.mode,
                    'sha256': sha(board_path), 'iccProfile': profile_name,
                    'sceneBoxFromCss': list(scene_box),
                    'innerSceneSrgbMaximumChannelDifference': max_difference,
                    'innerSceneSrgbMeanAbsoluteChannelDifference': ImageStat.Stat(difference).mean,
                    'innerSceneExact2PixelGrid': True,
                    'interiorAlphaRange': [255, 255],
                    'outerOnePixelAlphaCounts': dict(sorted(
                        (value, count) for count, value in board.getchannel('A').getcolors()
                        if value < 255))},
    'referenceCopiesMatch': True,
    'runtimeAudit': {'baselineFileCount': len(baseline),
                     'unchangedBaselineFileCount': len(baseline) - len(changes),
                     'changedSinceBaseline': changes, 'addedSinceBaseline': added,
                     'pngManifestAndMaskDrift': art_drift,
                     'note': 'This task did not write runtime files. Metadata drift is recorded, not reverted or attributed to an author.'},
}
print(json.dumps(result, ensure_ascii=False, indent=2))
