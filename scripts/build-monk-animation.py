#!/usr/bin/env python3
"""Deterministically build the Night Ritual monk v2 from retained authored art.

Python 3.10+, Pillow >=10,<13. No network, generation, numpy, or runtime writes.
    python3 scripts/build-monk-animation.py --inspect-sources
    python3 scripts/build-monk-animation.py
    python3 scripts/build-monk-animation.py --check
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/game/pixel-v2/monk"
SOURCE = OUT / "source"
CELL = 96
ANCHOR = (48, 84)
COUNTS = dict(idle=4, run=6, attack1=6, attack2=6, attack3=6,
              dash=6, wave=6, hurt=4, death=6)
TIMES = {
    "idle": [0, 200, 400, 600], "run": [0, 80, 160, 240, 320, 400],
    "attack1": [0, 45, 90, 140, 210, 290],
    "attack2": [0, 55, 110, 170, 250, 320],
    "attack3": [0, 80, 160, 240, 330, 420],
    "dash": [0, 25, 65, 110, 155, 200],
    "wave": [0, 40, 90, 160, 280, 500],
    "hurt": [0, 65, 140, 220], "death": [0, 100, 240, 420, 650, 900],
}

# Source batches have one pixel scale each. A crop is never stretched to its bbox.
# Bounds isolate rows, not individual grid cells: hands crossing a concept cell
# boundary survive intact. Connected components determine complete silhouettes.
BATCHES = {
    "front-idle": ("strips/01-monk-locomotion-v1-row-1.png", None, 4, "rgb"),
    "front-run": ("strips/01-run-final.png", None, 6, "rgb"),
    "front-attack1": ("strips/02-monk-combo-row-1.png", None, 6, "rgb"),
    "front-attack2": ("strips/02-monk-combo-row-2.png", None, 6, "rgb"),
    "front-attack3": ("strips/02-monk-combo-row-3.png", None, 6, "rgb"),
    "front-dash": ("strips/03-monk-abilities-row-1.png", None, 6, "rgb"),
    "front-wave": ("strips/03-monk-abilities-row-2.png", None, 6, "rgb"),
    "front-hurt": ("strips/03-monk-abilities-row-3.png", None, 4, "rgb"),
    "front-death": ("strips/04-monk-lifecycle-row-1.png", None, 6, "rgb"),
    "back-idle": ("originals/back-locomotion-v1.png", [0, 443], 4, "alpha"),
    "back-run-first": ("originals/back-locomotion-v1.png", [443, 887], 6, "alpha"),
    "back-run-last": ("originals/back-run-proportions-v4.png", None, 3, "alpha"),
    "back-attack1": ("originals/back-combo-v1.png", [0, 341], 6, "alpha"),
    "back-attack2": ("originals/back-combo-v1.png", [341, 683], 6, "alpha"),
    "back-attack3": ("originals/back-combo-v1.png", [683, 1024], 6, "alpha"),
    "back-heavy-fix": ("originals/back-heavy-occlusion-v2.png", None, 2, "alpha"),
    "back-dash": ("originals/back-abilities-v1.png", [0, 341], 6, "alpha"),
    "back-wave": ("originals/back-abilities-v1.png", [341, 683], 6, "alpha"),
    "back-hurt": ("originals/back-abilities-v1.png", [683, 1024], 4, "alpha"),
    "back-death-first": ("originals/back-death-v1.png", [0, 610], 3, "alpha"),
    "back-death-last": ("originals/back-death-v1.png", [610, 1024], 3, "alpha"),
}

# Authored source pages have different drawing resolutions. Calibrate once per
# batch against neutral height/head size, then preserve every pose's aspect and
# size variation. Replacement strips use their own source-resolution conversion.
SCALES = {
    "front-idle": 0.24, "front-run": 0.25,
    "front-attack1": 0.273, "front-attack2": 0.265, "front-attack3": 0.262,
    "front-dash": 0.328, "front-wave": 0.318, "front-hurt": 0.270,
    "front-death": 0.273,
    "back-idle": 0.214, "back-run-first": 0.214, "back-run-last": 0.095,
    "back-attack1": 0.247, "back-attack2": 0.247, "back-attack3": 0.247,
    "back-heavy-fix": 0.087, "back-dash": 0.296, "back-wave": 0.291,
    "back-hurt": 0.283, "back-death-first": 0.137, "back-death-last": 0.137,
}

PALETTE = {
    "ink": ["15121f", "24202d"],
    "trousers": ["302c3b", "403c48", "504956", "605868"],
    "cloth": ["fff2d6", "f2e4c6", "dfd1b4", "c7b99e", "a99b86", "8c8173"],
    "skin": ["ffd18b", "ffc074", "efa052", "dc8640", "bf6932", "984b2b", "703325"],
    "sash": ["bc3860", "a02451", "821c45", "641734", "45152d"],
    "bronze": ["dfad4f", "be8b35", "9b6c28", "79501e", "56391e"],
    "beads": ["a18259", "7e5e40", "61432f", "463023", "34241f"],
}


def palette_image():
    colors = [tuple(bytes.fromhex(c)) for ramp in PALETTE.values() for c in ramp]
    image = Image.new("P", (1, 1))
    image.putpalette([v for color in colors + [colors[0]] * (256 - len(colors)) for v in color])
    return image


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def flat_pixels(image):
    """Pillow 10/11 compatibility without 12.3's getdata deprecation noise."""
    method = getattr(image, "get_flattened_data", None)
    return method() if method is not None else image.getdata()


def components(mask):
    """Return 8-connected pixel sets, largest first, using only stdlib/Pillow."""
    w, h = mask.size
    data = bytearray(mask.tobytes())
    groups = []
    for seed in range(w * h):
        if not data[seed]:
            continue
        todo = [seed]
        data[seed] = 0
        pixels = []
        while todo:
            pos = todo.pop()
            pixels.append(pos)
            y, x = divmod(pos, w)
            for dy in (-1, 0, 1):
                ny = y + dy
                if not 0 <= ny < h:
                    continue
                for dx in (-1, 0, 1):
                    nx = x + dx
                    other = ny * w + nx
                    if 0 <= nx < w and data[other]:
                        data[other] = 0
                        todo.append(other)
        groups.append(pixels)
    return sorted(groups, key=len, reverse=True)


def mask_from_pixels(size, pixels):
    data = bytearray(size[0] * size[1])
    for pos in pixels:
        data[pos] = 255
    return Image.frombytes("L", size, bytes(data))


def foreground(image, mode):
    values = bytearray()
    for r, g, b, a in flat_pixels(image.convert("RGBA")):
        keep = a >= 200
        if mode == "rgb":
            # Blue concept paper, blue-grey ground shadows and cyan spell art.
            blue = b > r + 10 and g > r + 5
            # Coral impact flashes are VFX, not pickable body pixels.
            coral = r > 195 and b > 90 and 0 < g - b < 60 and r - g > 55
            keep = keep and not blue and not coral
        values.append(255 if keep else 0)
    return Image.frombytes("L", image.size, bytes(values))


def extract_batches():
    result = {}
    for name, (filename, yrange, count, mode) in BATCHES.items():
        image = Image.open(SOURCE / filename).convert("RGBA")
        y0, y1 = yrange or (0, image.height)
        row = image.crop((0, y0, image.width, y1))
        fg = foreground(row, mode)
        if name == "front-wave":
            pix, keep = row.load(), fg.load()
            for y in range(row.height):
                for x in range(row.width):
                    r, g, b, _ = pix[x, y]
                    if min(r, g, b) > 190 and max(r, g, b) - min(r, g, b) < 22:
                        keep[x, y] = 0
        if name == "front-dash":
            # Ivory dust at takeoff/landing shares cloth colors. Remove only
            # the recorded ground patches, preserving tan skin and dark ink.
            pix, keep = row.load(), fg.load()
            for left, top, right, bottom in ((250, 245, 352, 315), (1030, 246, 1114, 325)):
                for y in range(top, min(bottom, row.height)):
                    for x in range(left, min(right, row.width)):
                        r, g, b, _ = pix[x, y]
                        if r > 150 and g > 145 and r - b < 85:
                            keep[x, y] = 0
        groups = components(fg)
        bodies = [mask_from_pixels(row.size, p) for p in groups[:count]]
        if len(bodies) != count or min(len(p) for p in groups[:count]) < 1000:
            raise ValueError(f"{name}: expected {count} complete large silhouettes")
        bodies.sort(key=lambda m: m.getbbox()[0])
        frames = []
        for i, mask in enumerate(bodies):
            bbox = mask.getbbox()
            clean = row.copy()
            clean.putalpha(mask)
            crop = clean.crop(bbox)
            frames.append({"image": crop, "bbox": [bbox[0], bbox[1] + y0,
                           bbox[2], bbox[3] + y0], "file": filename,
                           "pixels": sum(mask.histogram()[1:]), "sourceKey": i})
        result[name] = frames
    return result


def planned_manifest():
    names, clips, offset = [], {}, 0
    for clip, n in COUNTS.items():
        clips[clip] = {"front": list(range(offset, offset + n)),
                       "back": list(range(offset + 50, offset + 50 + n))}
        offset += n
    for facing in ("front", "back"):
        for clip, n in COUNTS.items():
            names.extend(f"{clip}-{facing}-{i + 1:02d}" for i in range(n))
    return {
        "schemaVersion": 2, "status": "planned", "nativePixelsPerUnit": 32,
        "monk": {"path": "monk-v2.png", "cell": CELL, "columns": 10, "rows": 10,
                 "anchor": list(ANCHOR), "frames": names, "clips": clips,
                 "filter": "nearest", "mipmaps": False},
        "hitMasks": "hit-masks.json", "authoredFacings": {"front": "SE", "back": "NE"},
        "logicalFacings": {
            "SE": {"authored": "front", "flipX": False},
            "SW": {"authored": "front", "flipX": True},
            "NE": {"authored": "back", "flipX": False},
            "NW": {"authored": "back", "flipX": True},
        },
    }


def inspect_sources(batches):
    directory = OUT / "qa" / "source-extraction"
    directory.mkdir(parents=True, exist_ok=True)
    report = {}
    for name, frames in batches.items():
        # A display-only shared scale; originals stay byte-for-byte intact.
        scale = min(1, 220 / max(f["image"].height for f in frames))
        w = max(math.ceil(f["image"].width * scale) for f in frames) + 16
        sheet = Image.new("RGB", (w * len(frames), 250), "#24202e")
        draw = ImageDraw.Draw(sheet)
        for i, f in enumerate(frames):
            im = f["image"]
            small = im.resize((round(im.width * scale), round(im.height * scale)),
                              Image.Resampling.NEAREST)
            sheet.paste(small, (i * w + (w - small.width) // 2, 232 - small.height), small)
            draw.text((i * w + 4, 235), f"{i + 1}: {im.width}x{im.height}", fill="#ffffff")
        sheet.save(directory / f"{name}.png")
        report[name] = [{k: v for k, v in f.items() if k != "image"} for f in frames]
        print(name, [(f["image"].size, f["bbox"]) for f in frames])
    write_json(directory / "extraction.json", report)


def recipe(facing, clip, key):
    batch, index = f"{facing}-{clip}", key
    if facing == "back":
        if clip == "run":
            batch = "back-run-first" if key < 3 else "back-run-last"
            index = key if key < 3 else key - 3
        elif clip == "attack3" and key in (1, 4):
            batch, index = "back-heavy-fix", (0 if key == 1 else 1)
        elif clip == "death":
            batch = "back-death-first" if key < 3 else "back-death-last"
            index = key if key < 3 else key - 3
    return batch, index


def normalize(batches):
    frames, metadata = [], []
    palette = palette_image()
    for facing in ("front", "back"):
        for clip, count in COUNTS.items():
            for key in range(count):
                batch, index = recipe(facing, clip, key)
                source = batches[batch][index]
                im = source["image"]
                scale = SCALES[batch]
                size = (round(im.width * scale), round(im.height * scale))
                small = im.resize(size, Image.Resampling.NEAREST)
                alpha = small.getchannel("A")
                groups = components(alpha)
                alpha = mask_from_pixels(size, groups[0])
                small = small.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE).convert("RGBA")
                small.putalpha(alpha)
                lift = 0
                if clip == "dash":
                    lift = ([0, 0, 10, 18, 0, 0] if facing == "front" else [0, 0, 8, 12, 0, 0])[key]
                # Translation only. Actor origin is the same ground anchor in
                # every 96px cell; airborne feet retain their authored lift.
                dx = 0
                x = ANCHOR[0] - size[0] // 2 + dx
                y = ANCHOR[1] - size[1] - lift
                if x <= 0 or y <= 0 or x + size[0] >= CELL or y + size[1] >= CELL:
                    raise ValueError(f"Clipped authored pose: {facing}-{clip}-{key + 1}")
                cell = Image.new("RGBA", (CELL, CELL))
                cell.paste(small, (x, y), alpha)
                name = f"{clip}-{facing}-{key + 1:02d}"
                frames.append(cell)
                bbox = source["bbox"]
                metadata.append({"index": len(frames) - 1, "name": name,
                    "source": source["file"], "sourceKey": index + 1,
                    "sourceBatch": batch, "sourceBbox": bbox,
                    "uniformScale": scale, "resampling": "nearest",
                    "targetSize": list(size), "targetOffset": [x, y],
                    "airborneLiftPixels": lift, "anchor": list(ANCHOR),
                    "outputBbox": list(cell.getbbox()),
                    "detachedNativePixelsRemoved": sum(map(len, groups[1:])),
                    "mirrored": False})
    return frames, metadata


def background(size, kind="floor"):
    bg = Image.new("RGB", size, "#211c2b")
    if kind == "floor":
        tile = Image.open(SOURCE / "references/qa-floor.png").convert("RGB")
        for y in range(0, size[1], tile.height):
            for x in range(0, size[0], tile.width):
                bg.paste(tile, (x, y))
    else:
        draw = ImageDraw.Draw(bg)
        for y in range(0, size[1], 8):
            for x in range(0, size[0], 8):
                if (x // 8 + y // 8) % 2:
                    draw.rectangle((x, y, x + 7, y + 7), fill="#292331")
    return bg


def presentation_durations(clip):
    times = TIMES[clip]
    last = 200 if clip == "idle" else 80 if clip == "run" else 1000 if clip == "death" else 500
    return [b - a for a, b in zip(times, times[1:])] + [last]


def preview_assets(frames, manifest):
    preview, qa = OUT / "previews", OUT / "qa"
    preview.mkdir(exist_ok=True)
    qa.mkdir(exist_ok=True)
    (OUT / "frames").mkdir(exist_ok=True)
    for name, cell in zip(manifest["monk"]["frames"], frames):
        cell.save(OUT / "frames" / (name + ".png"))
    for facing in ("front", "back"):
        contact = background((6 * CELL, len(COUNTS) * (CELL + 20)), "checker")
        draw = ImageDraw.Draw(contact)
        for row, (clip, pair) in enumerate(manifest["monk"]["clips"].items()):
            y = row * (CELL + 20)
            draw.text((4, y + 3), f"{clip} / {facing} / " + ",".join(map(str, pair[facing])), fill="#eee0ce")
            sequence = [frames[i] for i in pair[facing]]
            strip = Image.new("RGBA", (CELL * len(sequence), CELL))
            for col, cell in enumerate(sequence):
                contact.paste(cell, (col * CELL, y + 20), cell)
                strip.paste(cell, (col * CELL, 0), cell)
            strip.save(preview / f"{clip}-{facing}-strip.png")
            sequence[0].save(preview / f"{clip}-{facing}.png", save_all=True,
                             append_images=sequence[1:], duration=presentation_durations(clip),
                             loop=0, disposal=0, blend=0)
        contact.save(qa / f"contact-{facing}-native.png")
        contact.resize((contact.width * 2, contact.height * 2), Image.Resampling.NEAREST).save(
            qa / f"contact-{facing}-2x.png")
    for clip, pair in manifest["monk"]["clips"].items():
        sequence = []
        for front, back in zip(pair["front"], pair["back"]):
            bg = background((CELL * 2, CELL))
            bg.paste(frames[front], (0, 0), frames[front])
            bg.paste(frames[back], (CELL, 0), frames[back])
            sequence.append(bg)
        sequence[0].save(preview / f"{clip}-native.gif", save_all=True,
                         append_images=sequence[1:], duration=presentation_durations(clip),
                         loop=0, disposal=2, optimize=False)
    # All nine actions at once, native scale, on the shipped floor texture.
    mosaic = []
    for t in range(0, 2400, 40):
        canvas = background((CELL * 6, 3 * (CELL + 20)))
        draw = ImageDraw.Draw(canvas)
        for j, (clip, pair) in enumerate(manifest["monk"]["clips"].items()):
            x, y = (j % 3) * CELL * 2, (j // 3) * (CELL + 20)
            durations = presentation_durations(clip)
            elapsed = t % sum(durations)
            key = 0
            while key < len(durations) - 1 and elapsed >= durations[key]:
                elapsed -= durations[key]
                key += 1
            draw.rectangle((x, y, x + CELL * 2 - 1, y + 19), fill="#171321")
            draw.text((x + 4, y + 3), f"{clip}  SE / NE", fill="#eee0ce")
            for i, facing in enumerate(("front", "back")):
                cell = frames[pair[facing][key]]
                canvas.paste(cell, (x + i * CELL, y + 20), cell)
        mosaic.append(canvas)
    mosaic[0].save(preview / "all-clips-native.gif", save_all=True,
                   append_images=mosaic[1:], duration=40, loop=0, disposal=2, optimize=False)
    html = '''<!doctype html><html lang="en"><meta charset="utf-8">
<title>Night Ritual — Monk v2 QA</title><style>
body{background:#171321;color:#eee0ce;font:15px system-ui;margin:24px}button,select{font:inherit;padding:6px;background:#312b3b;color:inherit;border:1px solid #6c6179}header{position:sticky;top:0;background:#171321;padding:12px 0}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:20px}article{padding:12px;border:1px solid #514657}canvas{image-rendering:pixelated;display:block}p{color:#b9adbf}label{margin-right:12px}h2{font-size:16px}</style>
<header><h1>Monk v2 — native animation QA</h1><button id="play">Pause</button>
<label>Scale <select id="scale"><option value="1">1x</option><option value="2" selected>2x</option><option value="4">4x</option></select></label>
<label>Speed <select id="speed"><option value="1">1x</option><option value="0.25">0.25x</option><option value="0.1">0.1x</option></select></label>
<label><input type="checkbox" id="mirror"> Mirror: SW / NW</label>
<label><input type="checkbox" id="origin"> Show origin</label><button id="reset">Restart</button>
<p>Front SE left, authored back NE right. 96px cells, [48,84] origin, 32ppu. QA repeats one-shots with a final-pose hold. APNGs and GIFs are beside this file. No game code is imported.</p></header><main id="grid"></main>
<script>
const manifest=__MANIFEST__, timings=__TIMES__, durations=__DURATIONS__;
const grid=document.getElementById('grid'), play=document.getElementById('play'), reset=document.getElementById('reset'), scale=document.getElementById('scale'), speed=document.getElementById('speed'), mirror=document.getElementById('mirror'), originControl=document.getElementById('origin');
const atlas=new Image(), floor=new Image();atlas.src='../monk-v2.png';floor.src='../source/references/qa-floor.png';
const cards=Object.entries(manifest.monk.clips).map(([name,clip])=>{let card=document.createElement('article');card.innerHTML='<h2>'+name+'</h2><canvas width="192" height="96"></canvas><p></p>';grid.append(card);return{name,clip,canvas:card.querySelector('canvas'),label:card.querySelector('p')};});
let paused=false, clock=0, last;
play.onclick=()=>{paused=!paused;play.textContent=paused?'Play':'Pause';};reset.onclick=()=>clock=0;
function draw(now){if(last!==undefined&&!paused)clock+=(now-last)*Number(speed.value);last=now;
 for(const c of cards){const ctx=c.canvas.getContext('2d');ctx.imageSmoothingEnabled=false;c.canvas.style.width=192*Number(scale.value)+'px';c.canvas.style.height=96*Number(scale.value)+'px';ctx.fillStyle='#211c2b';ctx.fillRect(0,0,192,96);if(floor.complete&&floor.naturalWidth){ctx.fillStyle=ctx.createPattern(floor,'repeat');ctx.fillRect(0,0,192,96);}
 let t=clock%durations[c.name].reduce((a,b)=>a+b,0), key=0;while(key<durations[c.name].length-1&&t>=durations[c.name][key])t-=durations[c.name][key++];
 ['front','back'].forEach((f,j)=>{let i=c.clip[f][key];ctx.save();ctx.translate(j*96,0);if(mirror.checked){ctx.translate(96,0);ctx.scale(-1,1);}if(atlas.complete&&atlas.naturalWidth)ctx.drawImage(atlas,(i%10)*96,Math.floor(i/10)*96,96,96,0,0,96,96);ctx.restore();if(originControl.checked){ctx.fillStyle='#7ef3ec';ctx.fillRect(j*96+44,84,9,1);ctx.fillRect(j*96+48,80,1,9);}});c.label.textContent='key '+(key+1)+' / '+c.clip.front.length+' | frames '+c.clip.front[key]+' / '+c.clip.back[key];}
 requestAnimationFrame(draw);}requestAnimationFrame(draw);
</script></html>'''
    html = html.replace("__MANIFEST__", json.dumps(manifest)).replace("__TIMES__", json.dumps(TIMES))
    html = html.replace("__DURATIONS__", json.dumps({c: presentation_durations(c) for c in COUNTS}))
    (preview / "index.html").write_text(html)


def atlas_from_frames(frames):
    atlas = Image.new("RGBA", (CELL * 10, CELL * 10))
    for i, cell in enumerate(frames):
        atlas.paste(cell, ((i % 10) * CELL, (i // 10) * CELL), cell)
    return atlas


def packed_alpha(atlas):
    packed = bytearray((atlas.width * atlas.height + 7) // 8)
    for i, value in enumerate(flat_pixels(atlas.getchannel("A"))):
        if value:
            packed[i // 8] |= 1 << (i % 8)
    return bytes(packed)


def provenance_record():
    records = json.loads((SOURCE / "generation-records.json").read_text())
    files = []
    for path in sorted(SOURCE.rglob("*")):
        if not path.is_file() or path.name == "normalization.json":
            continue
        record = {"path": str(path.relative_to(OUT)), "sha256": sha256(path)}
        if path.suffix == ".png":
            with Image.open(path) as im:
                record.update(dimensions=list(im.size), mode=im.mode)
        files.append(record)
    return {
        "schemaVersion": 2, "date": "2026-10-22",
        "sourceAuthority": "assets/concepts/animation-bible-01/hero/manifest.json and provenance.json; retained byte-for-byte as source/hero-*.json",
        "generationMode": "Built-in image_gen.imagegen only. No API key, CLI generation, external stock, Paper writes or browser automation.",
        "rightsNote": "Project artwork generated from supplied project references; inherited source provenance retained. This is provenance documentation, not a new license grant.",
        "builder": {"path": "scripts/build-monk-animation.py", "sha256": sha256(Path(__file__)),
                    "requirements": "Python >=3.10 and Pillow >=10,<13; no additional dependencies"},
        "selection": {
            "front": "50 approved SE keys from copied hero strips; run is exactly 01-run-final.png (original 1–3 plus v4 4–6).",
            "back": "50 separately drawn NE keys; no front or mirrored-front pixels used for back artwork.",
            "runBack": "keys 1–3: back-locomotion-v1.png lower row 1–3; keys 4–6: back-run-proportions-v4.png, all three.",
            "heavyBack": "back-combo-v1.png bottom row, replacing anticipation/recovery keys 2/5 with back-heavy-occlusion-v2.png.",
            "bodyOnly": "Blue concept paper, source ground shadows, detached particles, cyan wave/ghost and coral impacts removed. Runtime owns world-space wave and hit effects.",
        },
        "normalization": "source/normalization.json has source crop, source key, batch scale, output placement and anchor for every absolute atlas index.",
        "acceptance": json.loads((SOURCE / "visual-acceptance.json").read_text()),
        "generationRecords": records, "retainedSourceFiles": files,
    }


def build():
    batches = extract_batches()
    frames, metadata = normalize(batches)
    atlas = atlas_from_frames(frames)
    atlas.save(OUT / "monk-v2.png")
    packed = packed_alpha(atlas)
    write_json(OUT / "hit-masks.json", {"monk-v2.png": {"width": atlas.width,
               "bits": base64.b64encode(packed).decode("ascii")}})
    manifest = planned_manifest()
    acceptance = json.loads((SOURCE / "visual-acceptance.json").read_text())
    manifest["status"] = "ready" if acceptance["atlasSha256"] == sha256(OUT / "monk-v2.png") else "qa-pending"
    manifest["provenance"] = "provenance.json"
    manifest["normalization"] = "source/normalization.json"
    manifest["previews"] = "previews/index.html"
    manifest["monk"]["timing"] = {c: {"keyTimesMs": t, "playback": "loop" if c in ("idle", "run") else "one-shot-hold"}
                                      for c, t in TIMES.items()}
    write_json(OUT / "manifest.json", manifest)
    write_json(SOURCE / "normalization.json", {"schemaVersion": 2,
        "policy": "One uniform scale per source batch; nearest sampling; translation to registered ground anchor; no bbox stretching; no front-to-back mirroring.",
        "alphaThreshold": 200, "palette": PALETTE, "batchScales": SCALES, "frames": metadata})
    write_json(OUT / "palette.json", PALETTE)
    write_json(OUT / "provenance.json", provenance_record())
    preview_assets(frames, manifest)
    check(write_report=True)
    print("Built monk-v2.png, manifest, masks, 100 cells, 18 APNGs, 9 paired GIFs and native contact sheets")


def check(write_report=False):
    manifest = json.loads((OUT / "manifest.json").read_text())
    expected = planned_manifest()
    assert "atlases" not in manifest
    assert manifest["schemaVersion"] == 2 and manifest["nativePixelsPerUnit"] == 32
    for key in ("path", "cell", "columns", "rows", "anchor", "frames", "clips", "filter", "mipmaps"):
        assert manifest["monk"][key] == expected["monk"][key], key
    atlas = Image.open(OUT / "monk-v2.png").convert("RGBA")
    assert atlas.size == (960, 960)
    assert set(flat_pixels(atlas.getchannel("A"))) == {0, 255}
    assert all(p[:3] == (0, 0, 0) for p in flat_pixels(atlas) if p[3] == 0), "hidden background RGB"
    colors = {p[:3] for p in flat_pixels(atlas) if p[3]}
    assert len(colors) <= 48
    masks = json.loads((OUT / "hit-masks.json").read_text())
    assert set(masks) == {"monk-v2.png"}
    assert masks["monk-v2.png"]["width"] == atlas.width
    bits = base64.b64decode(masks["monk-v2.png"]["bits"], validate=True)
    assert len(bits) == (atlas.width * atlas.height + 7) // 8
    assert all(bool(bits[i // 8] & (1 << (i % 8))) == bool(a)
               for i, a in enumerate(flat_pixels(atlas.getchannel("A"))))
    frame_report = []
    hashes = []
    for i, name in enumerate(manifest["monk"]["frames"]):
        x, y = (i % 10) * CELL, (i // 10) * CELL
        im = atlas.crop((x, y, x + CELL, y + CELL))
        alpha = im.getchannel("A")
        bbox = alpha.getbbox()
        assert bbox and bbox[0] > 0 and bbox[1] > 0 and bbox[2] < CELL and bbox[3] < CELL, name
        groups = components(alpha)
        assert len(groups) == 1, (name, "detached silhouette", [len(g) for g in groups])
        hashes.append(hashlib.sha256(im.tobytes()).hexdigest())
        frame_report.append({"index": i, "name": name, "bbox": list(bbox),
                             "opaquePixels": len(groups[0]), "components": len(groups)})
    assert len(set(hashes)) == 100, "duplicate keys"
    provenance = json.loads((OUT / "provenance.json").read_text())
    for retained in provenance["retainedSourceFiles"]:
        assert sha256(OUT / retained["path"]) == retained["sha256"], retained["path"]
    assert provenance["builder"]["sha256"] == sha256(Path(__file__)), "builder provenance stale"
    if manifest["status"] == "ready":
        assert provenance["acceptance"]["atlasSha256"] == sha256(OUT / "monk-v2.png"), "accepted pixels changed"
    for i in range(50):
        front = atlas.crop(((i % 10) * CELL, (i // 10) * CELL,
                            (i % 10 + 1) * CELL, (i // 10 + 1) * CELL))
        back_i = i + 50
        back = atlas.crop(((back_i % 10) * CELL, (back_i // 10) * CELL,
                           (back_i % 10 + 1) * CELL, (back_i // 10 + 1) * CELL))
        assert front.transpose(Image.Transpose.FLIP_LEFT_RIGHT).tobytes() != back.tobytes(), "mirrored front used as back"
    for neutral in (0, 50):
        box = frame_report[neutral]["bbox"]
        assert 60 <= box[3] - box[1] <= 64, "neutral hero height"
    apng_count = 0
    for clip, pair in manifest["monk"]["clips"].items():
        for facing, indices in pair.items():
            with Image.open(OUT / "previews" / f"{clip}-{facing}.png") as animation:
                assert animation.n_frames == len(indices), (clip, facing, "APNG frame count")
                for key, index in enumerate(indices):
                    animation.seek(key)
                    assert animation.info["duration"] == presentation_durations(clip)[key]
                    x, y = (index % 10) * CELL, (index // 10) * CELL
                    expected_frame = atlas.crop((x, y, x + CELL, y + CELL))
                    assert animation.convert("RGBA").tobytes() == expected_frame.tobytes(), "APNG differs from atlas"
            apng_count += 1
        with Image.open(OUT / "previews" / f"{clip}-native.gif") as animation:
            assert animation.n_frames == COUNTS[clip]
    result = {"status": "passed", "frames": 100, "opaqueColors": len(colors),
              "size": list(atlas.size), "binaryAlpha": True, "connectedBodies": 100,
              "noClippedEdges": True, "maskPixelsVerified": atlas.width * atlas.height,
              "uniqueFrames": len(set(hashes)), "backIsNeverMirroredFront": True,
              "apngsVerifiedAgainstAtlas": apng_count, "pairedGifsVerified": 9,
              "atlasSha256": sha256(OUT / "monk-v2.png"), "frameReports": frame_report}
    if write_report:
        write_json(OUT / "qa" / "validation.json", result)
    print(json.dumps({k: v for k, v in result.items() if k != "frameReports"}))
    return result


def verify_rebuild():
    """Rebuild engine pixels/masks twice in memory; never touch watched assets."""
    accepted = json.loads((SOURCE / "visual-acceptance.json").read_text())["atlasSha256"]
    on_disk = (OUT / "monk-v2.png").read_bytes()
    masks = json.loads((OUT / "hit-masks.json").read_text())["monk-v2.png"]
    for _ in range(2):
        frames, _metadata = normalize(extract_batches())
        atlas = atlas_from_frames(frames)
        memory = io.BytesIO()
        atlas.save(memory, format="PNG")
        assert memory.getvalue() == on_disk, "rebuild pixels/PNG differ"
        assert base64.b64encode(packed_alpha(atlas)).decode("ascii") == masks["bits"], "rebuild masks differ"
    assert hashlib.sha256(on_disk).hexdigest() == accepted, "accepted art changed"
    print(json.dumps({"rebuilds": 2, "byteIdenticalPng": True, "byteIdenticalMasks": True,
                      "acceptedAtlasUnchanged": True, "atlasSha256": accepted}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--planned", action="store_true")
    parser.add_argument("--inspect-sources", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--verify-rebuild", action="store_true")
    args = parser.parse_args()
    if args.planned:
        write_json(OUT / "manifest.json", planned_manifest())
    elif args.check:
        check()
    elif args.verify_rebuild:
        verify_rebuild()
    elif args.inspect_sources:
        inspect_sources(extract_batches())
    else:
        build()


if __name__ == "__main__":
    main()
