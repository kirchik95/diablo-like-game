#!/usr/bin/env python3
"""Build/verify First Connected Adventure artwork. Python 3.10+, Pillow 10–12.

No generation, network, credentials, browser or runtime modification occurs here.
Built-in ImageGen originals and recipes are retained in the two v3 packages.
--verify-only rebuilds all deliverables IN MEMORY, compares bytes and validates
provenance. It never writes files. Run from any working directory.
"""

import argparse
import base64
from collections import deque
import hashlib
from io import BytesIO
import json
from pathlib import Path
import platform

from PIL import Image, ImageDraw, __version__ as PILLOW_VERSION


ROOT = Path(__file__).resolve().parents[1]
WRAITH = Path("assets/game/pixel-v3/wraith")
LOOK = Path("assets/game/pixel-v3/appearance")
MONK = Path("assets/game/pixel-v2/monk")
NEAREST = Image.Resampling.NEAREST
CLIPS = {"idle": 4, "run": 6, "attack": 6, "hurt": 4, "death": 6}
DURATIONS = {"idle": [180] * 4, "run": [90] * 6,
             "attack": [400, 400, 90, 150, 180, 180],
             "hurt": [70, 70, 80, 100], "death": [120, 150, 150, 220, 180, 240]}


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


def frame(atlas, index, meta):
    cell = meta["cell"]
    x, y = index % meta["columns"] * cell, index // meta["columns"] * cell
    return atlas.crop((x, y, x + cell, y + cell))


def largest_component(im):
    """Remove detached storyboard bolts/particles without painting body pixels."""
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
    mask = bytearray(width * height)
    for pos in best:
        mask[pos] = 255
    result = im.copy()
    result.putalpha(Image.frombytes("L", im.size, bytes(mask)))
    return result


def clean(im, threshold):
    data = bytearray(im.convert("RGBA").tobytes())
    for i in range(0, len(data), 4):
        r, g, b, a = data[i:i + 4]
        # Source RGB contains blue ground shadows and cyan passive particles.
        # Threshold removes the original soft glow while retaining dark outlines.
        if a < threshold or (g > r + 4 and b > r + 8):
            data[i:i + 4] = bytes(4)
        else:
            data[i + 3] = 255
    return Image.frombytes("RGBA", im.size, bytes(data))


def quantize(im, colors):
    rgb = [tuple(bytes.fromhex(value)) for value in colors]
    palette = Image.new("P", (1, 1))
    palette.putpalette([c for color in rgb for c in color] + list(rgb[0]) * (256 - len(rgb)))
    out = im.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE).convert("RGBA")
    out.putalpha(im.getchannel("A"))
    # Canonical fully transparent black is needed for reproducible bytes.
    data, alpha = bytearray(out.tobytes()), im.getchannel("A").tobytes()
    for i, a in enumerate(alpha):
        if not a:
            data[i * 4:i * 4 + 4] = bytes(4)
    return Image.frombytes("RGBA", im.size, bytes(data))


def make_wraith(recipe, meta):
    atlas = Image.new("RGBA", (meta["columns"] * 96, meta["rows"] * 96))
    registrations, inputs = [], set()
    index = 0
    for facing in ("front", "back"):
        for clip, count in CLIPS.items():
            config = recipe["facings"][facing][clip]
            inputs.add(config["source"])
            source = clean(Image.open(ROOT / config["source"]), recipe["alphaThreshold"])
            assert len(config["crops"]) == count
            for key, crop in enumerate(config["crops"]):
                body = source.crop(crop)
                if config["removeDetached"]:
                    body = largest_component(body)
                box, scale = body.getbbox(), config["scale"]
                assert box, (facing, clip, key, "empty source")
                if "absoluteRoots" in config:
                    absolute_root = config["absoluteRoots"][key]
                    source_root = (absolute_root[0] - crop[0], absolute_root[1] - crop[1])
                else:
                    source_root = ((box[0] + box[2]) / 2,
                                   box[1] + (84 - config["nativeTop"][key]) / scale)
                resized = body.resize(tuple(round(v * scale) for v in body.size), NEAREST)
                offset = (round(48 - source_root[0] * scale), round(84 - source_root[1] * scale))
                rb = resized.getbbox()
                assert rb, (facing, clip, key, "source lost at native scale")
                target = [rb[0] + offset[0], rb[1] + offset[1], rb[2] + offset[0], rb[3] + offset[1]]
                assert 0 < target[0] < target[2] < 96 and 0 < target[1] < target[3] < 96, (facing, clip, key, target)
                cell = Image.new("RGBA", (96, 96))
                cell.paste(resized, offset)
                cell = quantize(cell, recipe["palette"])
                atlas.paste(cell, (index % 13 * 96, index // 13 * 96))
                registrations.append({"index": index, "frame": meta["frames"][index],
                                      "source": config["source"], "crop": crop,
                                      "scale": scale, "rootInCrop": list(source_root),
                                      "offset": list(offset), "nativeBounds": list(cell.getbbox()),
                                      "pixelsSha256": sha(cell.tobytes())})
                index += 1
    return atlas, registrations, inputs


def make_mask(im):
    alpha = im.getchannel("A").tobytes()
    packed = bytearray((len(alpha) + 7) // 8)
    for i, value in enumerate(alpha):
        if value:
            packed[i >> 3] |= 1 << (i & 7)
    return {"width": im.width, "height": im.height,
            "bits": base64.b64encode(packed).decode()}


def make_looks(manifest, base, palette, ramps, heads):
    skin = [tuple(bytes.fromhex(c)) for c in palette["skin"]]
    sash = [tuple(bytes.fromhex(c)) for c in palette["sash"]]
    skin_set = set(skin)
    hair = [tuple(bytes.fromhex(c)) for c in ramps["hair"]]
    head_mask = Image.new("RGBA", base.size)
    mask_data = head_mask.load()
    pixels = base.load()
    for head in heads["heads"]:
        i = head["index"]
        x0, y0, x1, y1 = head["box"]
        width, height = x1 - x0, y1 - y0
        for y in range(y0, y1):
            for x in range(x0, x1):
                xx, yy = i % 10 * 96 + x, i // 10 * 96 + y
                if pixels[xx, yy][:3] not in skin_set or not pixels[xx, yy][3]:
                    continue
                # A cropped hairline within the accepted head; ears/face are left
                # alone. Slightly longer at the left temple, matching SE/NE view.
                depth = round(height * head["coverage"]) + (1 if x - x0 < width * .28 else 0)
                if y - y0 >= depth:
                    continue
                shade = 0 if y - y0 < height * .25 and x - x0 < width * .65 else 1
                if x - x0 > width * .72 or y - y0 >= depth - 1:
                    shade = 2
                mask_data[xx, yy] = (*hair[shade], 255)
    result = {}
    base_data = list(base.get_flattened_data()) if hasattr(base, "get_flattened_data") else list(base.getdata())
    mask_pixels = list(head_mask.get_flattened_data()) if hasattr(head_mask, "get_flattened_data") else list(head_mask.getdata())
    for look in manifest["variants"]:
        skin_map = dict(zip(skin, [tuple(bytes.fromhex(c)) for c in ramps["skin"][look["skin"]]]))
        sash_map = dict(zip(sash, [tuple(bytes.fromhex(c)) for c in ramps["sash"][look["sash"]]]))
        mapped = []
        for original, hair_pixel in zip(base_data, mask_pixels):
            r, g, b, a = original
            if hair_pixel[3] and look["hair"] == "short":
                mapped.append(hair_pixel)
            elif (r, g, b) in skin_map and a:
                mapped.append((*skin_map[(r, g, b)], a))
            elif (r, g, b) in sash_map and a:
                mapped.append((*sash_map[(r, g, b)], a))
            else:
                mapped.append(original)
        out = Image.new("RGBA", base.size)
        out.putdata(mapped)
        result[look["id"]] = out
    return result, head_mask


def checker(width, height):
    im = Image.new("RGB", (width, height), "#292532")
    draw = ImageDraw.Draw(im)
    for y in range(0, height, 8):
        for x in range(0, width, 8):
            if (x // 8 + y // 8) % 2:
                draw.rectangle((x, y, x + 7, y + 7), fill="#24212c")
    return im


def contact(atlas, meta, facing):
    sheet = checker(576, len(meta["clips"]) * 114)
    draw = ImageDraw.Draw(sheet)
    for row, (clip, facings) in enumerate(meta["clips"].items()):
        draw.text((4, row * 114 + 2), f"{clip} / {facing}", fill="#e6dfcf")
        for col, index in enumerate(facings[facing]):
            key = frame(atlas, index, meta)
            sheet.paste(key, (col * 96, row * 114 + 16), key)
    return sheet


def context_preview(wraith, wraith_meta, monk, monk_meta):
    """Native pixels against the existing floor texture, not an engine screenshot."""
    floor = Image.open(ROOT / "assets/game/pixel-v1/floor.png").convert("RGB")
    sheet = Image.new("RGB", (576, 232), "#211d29")
    for y in range(0, sheet.height, floor.height):
        for x in range(0, sheet.width, floor.width):
            sheet.paste(floor, (x, y))
    hound_meta = read_json(Path("assets/game/pixel-v2/hound-world/manifest.json"))["hound"]
    hound = Image.open(ROOT / "assets/game/pixel-v2/hound-world/hound-v2.png").convert("RGBA")
    draw = ImageDraw.Draw(sheet)
    for row, facing in enumerate(("front", "back")):
        samples = [(monk, monk_meta, monk_meta["clips"]["idle"][facing][0], "monk"),
                   (hound, hound_meta, hound_meta["clips"]["idle"][facing][0], "hound"),
                   *[(wraith, wraith_meta, wraith_meta["clips"][clip][facing][index], clip)
                     for clip, index in (("idle", 0), ("run", 2), ("attack", 1), ("death", 3))]]
        for col, (atlas, meta, index, label) in enumerate(samples):
            sprite = frame(atlas, index, meta)
            sheet.paste(sprite, (col * 96, row * 116), sprite)
            draw.text((col * 96 + 4, row * 116 + 100), f"{label} {facing}", fill="#f1e7d4")
    return sheet


def clip_durations(meta):
    if meta["path"] == "wraith.png":
        return DURATIONS
    durations = {}
    for clip, timing in meta["timing"].items():
        keys = timing["keyTimesMs"]
        gaps = [b - a for a, b in zip(keys, keys[1:])]
        durations[clip] = gaps + [gaps[-1]]
    return durations


def animated_gif(atlas, meta, clip, four_views=False):
    keys = meta["clips"][clip]
    views = [("SE", "front", False), ("SW", "front", True),
             ("NE", "back", False), ("NW", "back", True)] if four_views else [("front", "front", False), ("back", "back", False)]
    images = []
    for step in range(len(keys["front"])):
        board = checker(len(views) * 96, 114)
        draw = ImageDraw.Draw(board)
        for col, (label, facing, flip) in enumerate(views):
            key = frame(atlas, keys[facing][step], meta)
            if flip:
                key = key.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            board.paste(key, (col * 96, 0), key)
            draw.text((col * 96 + 4, 99), f"{label} {step + 1}", fill="#e6dfcf")
        images.append(board)
    ms = clip_durations(meta)[clip].copy()
    if len(ms) != len(images):
        ms = [100] * len(images)
    if clip not in ("idle", "run"):
        ms[-1] += 1000
    stream = BytesIO()
    images[0].save(stream, format="GIF", save_all=True, append_images=images[1:],
                   duration=ms, loop=0, disposal=2, optimize=False)
    return stream.getvalue()


def html_preview(title, meta, variants):
    # Self-contained metadata: only local image files are loaded. No server or
    # package dependencies, no network, no application/runtime imports.
    body = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>__TITLE__</title><style>body{background:#19161f;color:#e6dfcf;font:16px system-ui;margin:24px}select,button,input{font:inherit;margin:8px;padding:6px}canvas,img{image-rendering:pixelated;background:repeating-conic-gradient(#292532 0 25%,#24212c 0 50%) 0/16px 16px}canvas{width:288px;height:288px}figure{display:inline-block;margin:12px}figcaption{max-width:288px}.gallery img{width:192px;height:192px}.gallery figure{margin:6px}a{color:#b4caca}</style>
<h1>__TITLE__</h1><p>Exact delivered atlas pixels. Native cell 96×96, anchor [48,84]. Nearest filtering. The four views use authored front/back plus horizontal mirrors.</p>
<label>Appearance <select id="look"></select></label><label>Clip <select id="clip"></select></label><button id="pause">Pause</button><label>Frame <input id="frame" type="range" min="0" value="0"></label><span id="key"></span><div id="views"></div><div class="gallery" id="gallery"></div>
<script>const meta=__META__,variants=__VARIANTS__,durations=__DURATIONS__;const look=document.querySelector('#look'),clip=document.querySelector('#clip'),range=document.querySelector('#frame');let image=null,time=0,last=0,paused=false,revision=0;for(const v of variants)look.add(new Option(v.id,v.path));for(const c of Object.keys(meta.clips))clip.add(new Option(c,c));const views=[['SE','front',false],['SW','front',true],['NE','back',false],['NW','back',true]].map(([label,facing,flip])=>{const figure=document.createElement('figure'),canvas=document.createElement('canvas');canvas.width=canvas.height=96;figure.append(canvas);const caption=document.createElement('figcaption');caption.textContent=label;figure.append(caption);document.querySelector('#views').append(figure);return {ctx:canvas.getContext('2d'),facing,flip}});async function load(){const own=++revision;const next=new Image;next.src='../'+look.value;await next.decode();if(own===revision)image=next;}look.onchange=load;clip.onchange=()=>{time=0;range.value=0;range.max=meta.clips[clip.value].front.length-1};range.oninput=()=>{paused=true;document.querySelector('#pause').textContent='Play'};document.querySelector('#pause').onclick=()=>{paused=!paused;document.querySelector('#pause').textContent=paused?'Play':'Pause'};function draw(now){if(last&&!paused)time+=Math.min(now-last,100);last=now;const ids=meta.clips[clip.value].front,ms=durations[clip.value]||ids.map(()=>100);let step=Number(range.value);if(!paused){const total=ms.reduce((a,b)=>a+b,0),hold=['idle','run'].includes(clip.value)?0:1000;let cursor=time%(total+hold);step=ms.length-1;for(let i=0;i<ms.length;i++){if(cursor<ms[i]){step=i;break}cursor-=ms[i]}range.value=step;}if(image)for(const v of views){const idx=meta.clips[clip.value][v.facing][step],x=idx%meta.columns*96,y=Math.floor(idx/meta.columns)*96;v.ctx.clearRect(0,0,96,96);v.ctx.save();v.ctx.imageSmoothingEnabled=false;if(v.flip){v.ctx.translate(96,0);v.ctx.scale(-1,1)}v.ctx.drawImage(image,x,y,96,96,0,0,96,96);v.ctx.restore()}document.querySelector('#key').textContent=meta.frames[ids[step]];requestAnimationFrame(draw)}for(const v of variants)if(v.previewPath){const f=document.createElement('figure'),im=new Image,cap=document.createElement('figcaption');im.src='../'+v.previewPath;im.width=im.height=96;cap.textContent=v.id;f.append(im,cap);document.querySelector('#gallery').append(f)}clip.onchange();load();requestAnimationFrame(draw);</script></html>'''
    return body.replace("__TITLE__", title).replace("__META__", json.dumps(meta)).replace("__VARIANTS__", json.dumps(variants)).replace("__DURATIONS__", json.dumps(clip_durations(meta))).encode()


def construct():
    artifacts = {}
    wm = read_json(WRAITH / "source/manifest-contract.json")
    am = read_json(LOOK / "source/manifest-contract.json")
    monk = read_json(MONK / "manifest.json")["monk"]
    recipe = read_json(WRAITH / "source/normalization.json")
    wraith, registrations, inputs = make_wraith(recipe, wm["wraith"])
    base = Image.open(ROOT / MONK / "monk-v2.png").convert("RGBA")
    looks, hair = make_looks(am, base, read_json(MONK / "palette.json"),
                            read_json(LOOK / "source/palette-ramps.json"),
                            read_json(LOOK / "source/head-regions.json"))
    artifacts[WRAITH / "manifest.json"] = json_bytes(wm)
    artifacts[WRAITH / "wraith.png"] = png_bytes(wraith)
    artifacts[WRAITH / "hit-masks.json"] = json_bytes({"wraith.png": make_mask(wraith)})
    artifacts[WRAITH / "source/registration.json"] = json_bytes(registrations)
    artifacts[LOOK / "manifest.json"] = json_bytes(am)
    artifacts[LOOK / "metadata.json"] = json_bytes({"inheritedFrom": str(MONK / "manifest.json"),
                                                    "monk": monk, "previewFrame": 0})
    artifacts[LOOK / "source/hair-mask.png"] = png_bytes(hair)
    for facing in ("front", "back"):
        sheet = contact(wraith, wm["wraith"], facing)
        artifacts[WRAITH / f"previews/contact-{facing}-native.png"] = png_bytes(sheet)
        artifacts[WRAITH / f"previews/contact-{facing}-2x.png"] = png_bytes(sheet.resize((sheet.width * 2, sheet.height * 2), NEAREST))
    for clip in CLIPS:
        artifacts[WRAITH / f"previews/{clip}-four-views.gif"] = animated_gif(wraith, wm["wraith"], clip, True)
    artifacts[WRAITH / "previews/index.html"] = html_preview("Wraith — 52 authored keys", wm["wraith"], [{"id": "wraith", "path": "wraith.png"}])
    context = context_preview(wraith, wm["wraith"], looks["deep-short-teal"], monk)
    artifacts[WRAITH / "previews/floor-context-native.png"] = png_bytes(context)
    artifacts[WRAITH / "previews/floor-context-2x.png"] = png_bytes(context.resize((1152, 464), NEAREST))
    gallery = checker(6 * 192, 3 * 116)
    draw = ImageDraw.Draw(gallery)
    for i, look in enumerate(am["variants"]):
        atlas = looks[look["id"]]
        preview = frame(atlas, 0, monk)
        artifacts[LOOK / look["path"]] = png_bytes(atlas)
        artifacts[LOOK / look["previewPath"]] = png_bytes(preview)
        x, y = i % 6 * 192, i // 6 * 116
        gallery.paste(preview, (x, y), preview)
        back = frame(atlas, 50, monk)
        gallery.paste(back, (x + 96, y), back)
        draw.text((x + 4, y + 99), look["id"], fill="#e6dfcf")
    artifacts[LOOK / "previews/all-looks-native.png"] = png_bytes(gallery)
    artifacts[LOOK / "previews/all-looks-2x.png"] = png_bytes(gallery.resize((gallery.width * 2, gallery.height * 2), NEAREST))
    sample = looks["deep-short-teal"]
    for facing in ("front", "back"):
        sheet = contact(sample, monk, facing)
        artifacts[LOOK / f"previews/deep-short-teal-{facing}-native.png"] = png_bytes(sheet)
        artifacts[LOOK / f"previews/deep-short-teal-{facing}-2x.png"] = png_bytes(sheet.resize((sheet.width * 2, sheet.height * 2), NEAREST))
    for clip in monk["clips"]:
        artifacts[LOOK / f"previews/deep-short-teal-{clip}.gif"] = animated_gif(sample, monk, clip)
    artifacts[LOOK / "previews/index.html"] = html_preview("Monk — 18 appearances / 100 keys each", monk, am["variants"])
    inputs.update(str(p) for p in [WRAITH / "source/normalization.json", WRAITH / "source/manifest-contract.json",
                                  LOOK / "source/manifest-contract.json", LOOK / "source/head-regions.json",
                                  LOOK / "source/palette-ramps.json", MONK / "monk-v2.png", MONK / "manifest.json", MONK / "palette.json",
                                  Path("scripts/build-adventure-assets.py")])
    for package in (WRAITH, LOOK):
        for p in (ROOT / package / "source").rglob("*"):
            if p.is_file() and (p.parent.name in ("prompts", "originals") or p.name in ("generation-records.json", "concept-records.json", "monk-hair-reference.png")):
                inputs.add(str(p.relative_to(ROOT)))
    inputs.add("assets/concepts/animation-bible-01/monsters/manifest.json")
    inputs.add("assets/concepts/animation-bible-01/monsters/originals/wraith-facing.png")
    inputs.update(["assets/game/pixel-v1/floor.png", "assets/game/pixel-v2/hound-world/manifest.json",
                   "assets/game/pixel-v2/hound-world/hound-v2.png"])
    return artifacts, inputs, wm, am, monk, wraith, looks, base, hair


def validate(built):
    artifacts, inputs, wm, am, monk, wraith, looks, base, hair = built
    meta = wm["wraith"]
    assert meta["cell"] == 96 and meta["anchor"] == [48, 84]
    assert meta["filter"] == "nearest" and meta["mipmaps"] is False
    assert wraith.size == (1248, 384) and wm["nativePixelsPerUnit"] == 32
    expected, offset = [], 0
    for facing in ("front", "back"):
        for clip, count in CLIPS.items():
            assert meta["clips"][clip][facing] == list(range(offset, offset + count))
            expected += [f"{facing}-{clip}-{i + 1:02}" for i in range(count)]
            offset += count
    assert meta["frames"] == expected
    assert [r["frame"] for r in read_json(LOOK / "source/head-regions.json")["heads"]] == monk["frames"]
    for record in read_json(WRAITH / "source/concept-records.json")["images"]:
        original = ROOT / "assets/concepts/animation-bible-01/monsters" / record["originalPath"]
        assert sha(original.read_bytes()) == record["sha256"], ("accepted original changed", record["originalPath"])
    colors = lambda im: {color for count, color in im.getcolors(im.width * im.height) if color[3]}
    frames = [frame(wraith, i, meta) for i in range(52)]
    assert len({sha(im.tobytes()) for im in frames}) == 52
    for facing in ("front", "back"):
        for clip in CLIPS:
            keys = [frames[i] for i in meta["clips"][clip][facing]]
            # Cropping removes translations so repeated static art cannot pass.
            signatures = {(im.crop(im.getbbox()).size, sha(im.crop(im.getbbox()).tobytes())) for im in keys}
            assert len(signatures) == len(keys), (facing, clip, "translated duplicate")
    for index, im in enumerate(frames):
        box = im.getbbox()
        assert box and 0 < box[0] < box[2] < 96 and 0 < box[1] < box[3] < 96, index
    assert len(colors(wraith)) <= 48
    assert set(wraith.getchannel("A").tobytes()) == {0, 255}
    for facing in ("front", "back"):
        death = meta["clips"]["death"][facing]
        matter = [sum(frames[i].getchannel("A").tobytes()) // 255 for i in death]
        assert all(a > b for a, b in zip(matter, matter[1:])), (facing, "death does not dissolve", matter)
    assert len(looks) == 18
    assert len({sha(im.tobytes()) for im in looks.values()}) == 18
    assert looks["warm-shaved-wine"].tobytes() == base.tobytes()
    alpha_hash = sha(base.getchannel("A").tobytes())
    material = read_json(MONK / "palette.json")
    target = {tuple(bytes.fromhex(c)) for c in material["skin"] + material["sash"]}
    data = base.tobytes()
    max_colors = 0
    for name, atlas in looks.items():
        assert atlas.size == (960, 960)
        assert sha(atlas.getchannel("A").tobytes()) == alpha_hash, name
        count = len(colors(atlas))
        assert count <= 48
        max_colors = max(max_colors, count)
        altered = atlas.tobytes()
        for i in range(0, len(data), 4):
            if tuple(data[i:i + 3]) not in target:
                assert altered[i:i + 4] == data[i:i + 4], (name, "non-target material", i)
        for i in range(100):
            assert frame(atlas, i, monk).getbbox(), (name, i)
    for i in range(100):
        assert frame(hair, i, monk).getbbox(), (i, "no hair")
        assert frame(looks["warm-short-wine"], i, monk).tobytes() != frame(base, i, monk).tobytes()
    report = {"status": "passed", "toolchain": {"python": platform.python_version(), "pillow": PILLOW_VERSION},
              "wraith": {"frames": 52, "size": [1248, 384], "cell": 96, "anchor": [48, 84],
                          "opaqueColors": len(colors(wraith)), "binaryAlpha": True,
                          "distinctFrames": 52, "boundsUnclipped": True, "deathMatterStrictlyDecreases": True},
              "appearance": {"variants": 18, "framesPerVariant": 100, "size": [960, 960],
                             "maxOpaqueColors": max_colors, "alphaSha256": alpha_hash,
                             "defaultPixelsEqualV2": True, "nonTargetMaterialsPreserved": True,
                             "hairPresentAllFrames": True, "previewFrame": 0},
              "artifactCount": len(artifacts), "sourceCount": len(inputs)}
    return report


def provenance(package, inputs, artifacts):
    is_wraith = package == WRAITH
    return {"schemaVersion": 1, "date": "2026-10-22",
            "generationMode": "Built-in image_gen only; exact requests and unchanged originals retained. Model not exposed by tool.",
            "rightsNote": "Project references and generated derivatives. Inherited source provenance retained; this record is not a new license grant.",
            "acceptance": {"status": "worker-inspected-awaiting-coordinator",
                           "authority": "Coordinator accepts under user delegation. No personal user approval is claimed.",
                           "boundary": "Asset owner inspects native contact sheets and exported pixels; live game/browser acceptance belongs to the coordinator."},
            "normalization": ("Original authored front keys + 26 separately generated rear keys, fixed per-sheet scalar, root translation, alpha>=220, no dithering, explicit 22-color family palette. Detached storyboard shots and particles removed; death debris preserved." if is_wraith else "Original 100-frame v2 monk geometry/alpha; explicit seven-step skin and five-step sash maps. Short hair uses generated two-view master as art reference and per-frame registered scalp regions. All non-target materials unchanged."),
            "builder": "scripts/build-adventure-assets.py",
            "toolchain": {"python": platform.python_version(), "pillow": PILLOW_VERSION},
            "generationRecords": "source/generation-records.json",
            "inputs": [{"path": p, "sha256": sha((ROOT / p).read_bytes())} for p in sorted(inputs)],
            "outputs": [{"path": str(p), "sha256": sha(data), "bytes": len(data)}
                        for p, data in sorted(artifacts.items()) if p.is_relative_to(package)]}


def run(verify_only):
    built = construct()
    artifacts, inputs = built[0:2]
    report = validate(built)
    if verify_only:
        for package in (WRAITH, LOOK):
            record = read_json(package / "provenance.json")
            for source in record["inputs"]:
                assert sha((ROOT / source["path"]).read_bytes()) == source["sha256"], ("source changed", source["path"])
            for output in record["outputs"]:
                assert sha((ROOT / output["path"]).read_bytes()) == output["sha256"], ("output changed", output["path"])
        for path, data in artifacts.items():
            assert (ROOT / path).read_bytes() == data, ("rebuild differs", str(path))
        report.update(rebuildMatches=True, sourceHashesMatch=True, mode="read-only")
    else:
        for path, data in artifacts.items():
            (ROOT / path).parent.mkdir(parents=True, exist_ok=True)
            (ROOT / path).write_bytes(data)
        for package in (WRAITH, LOOK):
            (ROOT / package / "provenance.json").write_bytes(json_bytes(provenance(package, inputs, artifacts)))
        report.update(rebuildMatches=True, sourceHashesMatch=True, mode="build")
        for package in (WRAITH, LOOK):
            (ROOT / package / "qa-report.json").write_bytes(json_bytes(report))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true", help="Reconstruct and validate in memory; no filesystem writes")
    run(parser.parse_args().verify_only)
