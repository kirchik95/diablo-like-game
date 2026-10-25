#!/usr/bin/env python3
"""Offline, authored pixel-cluster camp inhabitants. Python3 + Pillow; no API.

New output only: pixel-v18/camp-npcs. --check regenerates in memory and compares
all bytes; --metrics-only reads the delivered PNG rather than the source rig.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
from pathlib import Path
from PIL import Image, ImageDraw, __version__ as PILLOW_VERSION

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/game/pixel-v18/camp-npcs'
CELL, COLS, ROWS, ANCHOR = 96, 4, 4, (48, 84)
# Camp ink/wood/skin are shared with the established art. Garments use three
# new muted ramps, without the player's ivory top, bright sash or fighting pose.
INK = '#211a28'
SKIN = ['#694739', '#a97150', '#d99a66', '#edb97f']
WOOD = ['#483329', '#78553a', '#ad8150', '#ceb47a']
BOOT = ['#30272e', '#51403b', '#806149']
PILGRIM = ['#453430', '#735238', '#a87e46', '#ceaa66']
TRAVELLER = ['#233a3d', '#3d5756', '#607771', '#8e9a80']
SENTRY = ['#2c303d', '#465365', '#6a7b89', '#9daaa6']
HAIR = ['#4c4849', '#81827d', '#c4c1a5']
CLOTH = ['#3d3032', '#655049', '#937563']
KINDS = ['pilgrim', 'wanderer', 'sentry']
TIMINGS = [600, 780, 700]


def rgba(hex):
    return (*[int(hex[i:i + 2], 16) for i in (1, 3, 5)], 255)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(obj):
    return (json.dumps(obj, ensure_ascii=False, indent=2) + '\n').encode()


def png_bytes(im):
    result = io.BytesIO(); im.save(result, format='PNG', compress_level=9)
    return result.getvalue()


class Painter:
    def __init__(self, image):
        self.d = ImageDraw.Draw(image)

    def poly(self, points, color, outline=True):
        self.d.polygon(points, fill=color, outline=INK if outline else color, width=1)

    def box(self, box, color):
        self.d.rectangle(box, fill=color)

    def line(self, points, color, width=1):
        self.d.line(points, fill=color, width=width)


def face(p, x, y, turn=False, beard=False):
    # Side-biased three-quarter face, relaxed gaze; head is 12×14 px like v17.
    p.poly([(x+2,y),(x+8,y),(x+11,y+3),(x+11,y+7),(x+13,y+8),
            (x+11,y+10),(x+10,y+13),(x+5,y+14),(x+1,y+10),(x,y+4)], SKIN[1])
    p.poly([(x+3,y+1),(x+8,y+1),(x+10,y+4),(x+9,y+8),(x+11,y+9),
            (x+9,y+12),(x+5,y+11),(x+3,y+7)], SKIN[2], False)
    p.line([(x+3,y+2),(x+7,y+2),(x+9,y+4)], SKIN[3])
    p.box((x+8-(1 if turn else 0),y+6,x+10-(1 if turn else 0),y+7), INK)
    p.box((x+7,y+11,x+9,y+11), SKIN[0])
    if beard:
        p.poly([(x+2,y+8),(x+5,y+11),(x+10,y+10),(x+10,y+14),
                (x+6,y+18),(x+3,y+16)], HAIR[1])
        p.line([(x+4,y+11),(x+5,y+15),(x+7,y+14)], HAIR[2], 2)


def pilgrim(frame):
    im = Image.new('RGBA', (CELL,CELL)); p = Painter(im)
    breathe = [0,-1,0,0][frame]; hand = [0,0,-1,0][frame]
    # Fixed folded legs and boots. A broad lap and tucked heels read seated.
    p.poly([(35,67),(54,66),(65,70),(71,78),(68,82),(54,81),(48,77),
            (39,81),(27,80),(25,76),(30,71)], CLOTH[0])
    p.poly([(34,69),(44,69),(47,74),(40,77),(29,78),(29,75)], CLOTH[1], False)
    p.poly([(52,69),(60,70),(66,76),(64,78),(55,77),(49,74)], CLOTH[2], False)
    p.line([(32,73),(39,73),(42,74)], CLOTH[2])
    p.poly([(30,78),(37,79),(40,82),(37,83),(28,83),(26,81)], BOOT[1])
    p.poly([(59,78),(66,79),(69,82),(67,83),(57,83),(56,81)], BOOT[1])
    p.line([(29,80),(35,81)], BOOT[2]); p.line([(59,80),(65,81)], BOOT[2])
    # Heavy ochre coat, round shoulders and ragged hem instead of the hero's sash.
    p.poly([(37,50+breathe),(48,47+breathe),(58,51+breathe),(61,60),
            (58,69),(50,71),(40,69),(32,66),(32,58)], PILGRIM[1])
    p.poly([(38,52+breathe),(47,51+breathe),(52,55+breathe),(50,63),
            (42,66),(35,64),(36,57)], PILGRIM[2], False)
    p.line([(38,53+breathe),(42,51+breathe),(46,52+breathe)], PILGRIM[3], 2)
    p.poly([(52,52+breathe),(57,55+breathe),(58,64),(54,67),(51,64)], PILGRIM[0], False)
    p.line([(35,64),(43,66),(50,65)], PILGRIM[0])
    p.line([(45,56+breathe),(44,61)], PILGRIM[1])
    face(p, 43, 35+breathe, frame == 3)
    # Wool cap: a soft round silhouette, no bare monk head.
    p.poly([(43,38+breathe),(45,34+breathe),(50,33+breathe),(55,35+breathe),
            (56,39+breathe),(53,40+breathe),(46,39+breathe)], PILGRIM[0])
    p.line([(46,35+breathe),(51,35+breathe),(54,37+breathe)], PILGRIM[2], 2)
    p.box((43,39+breathe,49,40+breathe), PILGRIM[1])
    # Arms cup both hands toward the fire. Hands stay well clear of shoulders.
    p.poly([(54,53+breathe),(59,55+breathe),(61,60+hand),(66,59+hand),
            (68,62+hand),(60,65+hand),(56,62),(53,58+breathe)], PILGRIM[2])
    p.line([(56,55+breathe),(59,59+hand)], PILGRIM[3], 2)
    p.poly([(39,55+breathe),(43,56+breathe),(46,62+hand),(58,63+hand),
            (58,67+hand),(44,67),(39,63)], PILGRIM[1])
    p.line([(41,57+breathe),(44,63+hand),(54,65+hand)], PILGRIM[2], 2)
    p.poly([(62,59+hand),(66,57+hand),(69,58+hand),(69,60+hand),
            (66,63+hand),(63,63+hand)], SKIN[2])
    p.line([(64,59+hand),(67,58+hand)], SKIN[3])
    p.poly([(56,62+hand),(60,60+hand),(64,60+hand),(65,62+hand),
            (61,65+hand),(57,65+hand)], SKIN[2])
    p.box((59,61+hand,62,62+hand), SKIN[3])
    return im


def wanderer(frame):
    im = Image.new('RGBA',(CELL,CELL)); p = Painter(im)
    breathe = [0,-1,0,0][frame]; hand = [0,0,-1,0][frame]
    # Fixed boots protrude from the long cloak, a narrow standing stance.
    p.poly([(39,75),(46,75),(47,81),(44,83),(36,83),(35,81)], BOOT[1])
    p.poly([(53,76),(59,75),(62,80),(67,81),(67,83),(54,83)], BOOT[1])
    p.line([(38,80),(43,80)], BOOT[2]); p.line([(56,80),(62,81)], BOOT[2])
    p.poly([(35,36+breathe),(43,31+breathe),(54,32+breathe),(60,38+breathe),
            (62,52),(65,75),(59,78),(51,76),(44,79),(33,76),(31,69),(33,52)], TRAVELLER[0])
    p.poly([(37,38+breathe),(45,35+breathe),(51,39+breathe),(49,54),
            (46,74),(36,75),(34,68),(35,52)], TRAVELLER[1], False)
    p.poly([(38,39+breathe),(44,36+breathe),(46,40+breathe),(43,53),
            (40,70),(36,71),(37,53)], TRAVELLER[2], False)
    p.line([(39,40+breathe),(43,38+breathe)], TRAVELLER[3], 2)
    p.poly([(51,37+breathe),(57,40+breathe),(58,54),(62,73),(56,75),
            (51,69),(49,58)], TRAVELLER[1], False)
    p.line([(52,50),(54,64),(57,71)], TRAVELLER[2], 2)
    p.line([(47,52),(46,64),(44,72)], TRAVELLER[0])
    # Deep hood with a pointed top, inset dark face and a plain throat clasp.
    p.poly([(37,32+breathe),(38,23+breathe),(43,17+breathe),(47,15+breathe),
            (53,19+breathe),(58,27+breathe),(58,36+breathe),(52,41+breathe),
            (43,38+breathe)], TRAVELLER[1])
    p.poly([(41,28+breathe),(44,22+breathe),(50,21+breathe),(54,26+breathe),
            (55,34+breathe),(51,37+breathe),(45,34+breathe)], INK, False)
    p.poly([(47,25+breathe),(51,25+breathe),(53,29+breathe),(55,30+breathe),
            (52,32+breathe),(51,35+breathe),(47,33+breathe)], SKIN[1], False)
    p.box((51-(1 if frame == 3 else 0),28+breathe,52-(1 if frame == 3 else 0),28+breathe), INK)
    p.line([(41,23+breathe),(44,19+breathe),(47,18+breathe)], TRAVELLER[2], 2)
    p.line([(38,29+breathe),(40,34+breathe),(44,36+breathe)], TRAVELLER[2], 2)
    p.box((49,39+breathe,51,40+breathe), WOOD[3])
    # Tied bedroll and worn satchel replace combat equipment.
    p.line([(51,40+breathe),(42,52),(36,59)], WOOD[0], 3)
    p.line([(51,40+breathe),(42,52),(36,59)], WOOD[2])
    p.poly([(29,47),(32,44),(37,45),(40,50),(38,61),(32,63),(27,59),(27,51)], PILGRIM[0])
    p.poly([(30,48),(34,47),(37,50),(35,58),(30,59)], PILGRIM[1], False)
    p.line([(28,51),(37,53)], PILGRIM[3], 2)
    p.line([(29,56),(36,57)], WOOD[0], 2)
    p.poly([(57,43+breathe),(61,46+breathe),(62,53+hand),(58,57+hand),
            (54,54+hand),(56,49)], TRAVELLER[2])
    p.poly([(55,51+hand),(59,50+hand),(61,52+hand),(59,56+hand),
            (55,56+hand),(53,54+hand)], SKIN[1])
    p.line([(55,52+hand),(58,52+hand)], SKIN[2], 2)
    return im


def sentry(frame):
    im = Image.new('RGBA',(CELL,CELL)); p = Painter(im)
    breathe = [0,-1,0,0][frame]; hand = [0,0,-1,0][frame]
    # An elder in a blue-grey coat, close feet and long crooked walking staff.
    p.poly([(38,68),(48,67),(50,79),(46,82),(37,81)], CLOTH[0])
    p.poly([(50,67),(58,68),(60,79),(57,82),(51,81)], CLOTH[1])
    p.poly([(38,78),(45,78),(47,81),(46,83),(35,83),(34,81)], BOOT[1])
    p.poly([(53,78),(59,79),(63,81),(63,83),(52,83)], BOOT[1])
    p.line([(37,80),(42,80)], BOOT[2]); p.line([(55,80),(59,81)], BOOT[2])
    p.poly([(36,36+breathe),(43,31+breathe),(52,32+breathe),(59,38+breathe),
            (59,54),(62,69),(57,73),(49,71),(42,74),(32,70),(33,52)], SENTRY[0])
    p.poly([(36,39+breathe),(44,35+breathe),(49,40+breathe),(47,57),
            (43,70),(35,69),(35,53)], SENTRY[1], False)
    p.poly([(37,40+breathe),(42,38+breathe),(45,40+breathe),(42,52),
            (38,64),(36,64)], SENTRY[2], False)
    p.line([(37,39+breathe),(41,37+breathe)], SENTRY[3], 2)
    p.poly([(51,39+breathe),(55,39+breathe),(57,53),(59,67),(54,69),
            (49,63)], SENTRY[1], False)
    p.line([(49,50),(48,60),(46,68)], SENTRY[0])
    p.poly([(36,54),(56,53),(57,57),(36,59)], WOOD[0])
    p.line([(38,55),(53,54)], WOOD[1])
    p.box((47,54,50,57), WOOD[3]); p.box((48,55,49,56), WOOD[0])
    face(p, 43, 18+breathe, frame == 3, beard=True)
    p.poly([(43,22+breathe),(43,18+breathe),(46,15+breathe),(51,15+breathe),
            (54,17+breathe),(54,20+breathe),(48,19+breathe),(46,24+breathe)], HAIR[1])
    p.line([(46,17+breathe),(51,17+breathe)], HAIR[2], 2)
    p.poly([(34,37+breathe),(41,33+breathe),(43,36+breathe),(42,44+breathe),
            (36,47+breathe),(31,44+breathe)], SENTRY[2])
    p.line([(34,37+breathe),(40,35+breathe)], SENTRY[3], 2)
    # The shaft is fixed; only the gripping hand changes by one pixel.
    p.line([(69,83),(68,56),(67,29),(64,20),(65,16),(69,15)], INK, 4)
    p.line([(69,82),(68,56),(67,29),(64,20),(65,17),(68,16)], WOOD[1], 2)
    p.line([(68,78),(68,58),(67,31)], WOOD[2])
    p.box((68,79,70,82), WOOD[0])
    p.line([(66,36),(68,36)], WOOD[3], 2)
    p.poly([(54,39+breathe),(59,40+breathe),(61,47+hand),(67,45+hand),
            (69,49+hand),(60,53),(56,49)], SENTRY[1])
    p.line([(57,41+breathe),(60,48+hand),(65,47+hand)], SENTRY[2], 2)
    p.poly([(65,44+hand),(69,43+hand),(71,45+hand),(71,49+hand),
            (68,50+hand),(65,48+hand)], SKIN[1])
    p.line([(67,45+hand),(69,45+hand)], SKIN[2], 2)
    # Other hand rests at the belt, no combat stance.
    p.poly([(34,46+breathe),(39,48+breathe),(41,55),(47,56),
            (47,60),(39,60),(34,54)], SENTRY[1])
    p.box((43,56,47,59), SKIN[1]); p.line([(44,56),(47,56)], SKIN[2])
    return im


# Hip proxies: seated lap, waist hidden by cloak, lower coat below the belt.
HIP = {'pilgrim': 68, 'wanderer': 58, 'sentry': 62}
HEAD_BOX = {'pilgrim': (40,30,60,51), 'wanderer': (36,12,59,40), 'sentry': (40,12,58,37)}
FOOT_BOXES = {'pilgrim': [(25,78,41,84),(55,78,71,84)],
              'wanderer': [(34,79,48,84),(52,79,68,84)],
              'sentry': [(33,80,48,84),(51,80,64,84)]}


def measure(atlas):
    characters = {}; failed = 0
    for k, kind in enumerate(KINDS):
        frames = []
        for i in range(4):
            frame = k*4+i
            im = atlas.crop((frame%COLS*CELL, frame//COLS*CELL, (frame%COLS+1)*CELL, (frame//COLS+1)*CELL))
            bounds = list(im.getbbox()); head = im.crop(HEAD_BOX[kind]).getbbox()
            # Published pixels, not authored limb coordinates, define every bound.
            foot = [list(im.crop(box).getbbox()) for box in FOOT_BOXES[kind]]
            hip = im.crop((24,HIP[kind],72,HIP[kind]+1)).getbbox()
            item = dict(frame=frame, rgbaHash=sha(im.tobytes()), bounds=bounds,
                        height=bounds[3]-bounds[1], headTop=HEAD_BOX[kind][1]+head[1],
                        hipBounds=list(hip), footBounds=foot,
                        lowerBodyHash=sha(im.crop((0,HIP[kind],CELL,CELL)).tobytes()))
            frames.append(item)
        ref = frames[0]
        for item in frames:
            item['heightDelta'] = abs(item['height']-ref['height'])
            item['headTopDelta'] = abs(item['headTop']-ref['headTop'])
            item['hipDelta'] = max(abs(a-b) for a,b in zip(item['hipBounds'],ref['hipBounds']))
            item['footDelta'] = max(abs(a-b) for aa,bb in zip(item['footBounds'],ref['footBounds']) for a,b in zip(aa,bb))
            item['lowerBodyStable'] = item['lowerBodyHash'] == ref['lowerBodyHash']
            item['passes'] = item['heightDelta'] <= 1 and item['headTopDelta'] <= 1 and item['hipDelta'] == item['footDelta'] == 0 and item['lowerBodyStable']
            failed += not item['passes']
        characters[kind] = dict(frames=frames)
    return dict(schema=1, source='actual delivered RGBA atlas pixels', pixelDensity=32,
                gate='height/head ±1px; hip and soles 0px; lower-body RGBA byte-identical to key0',
                characters=characters, failed=failed)


def generate():
    atlas = Image.new('RGBA',(CELL*COLS,CELL*ROWS)); frames = []
    for k, builder in enumerate([pilgrim,wanderer,sentry]):
        for i in range(4):
            im = builder(i); frames.append(im)
            atlas.paste(im, (i*CELL,k*CELL))
    # One contact shadow cell, with the established hard two-level ellipse.
    shadow = Image.new('RGBA',(CELL,CELL))
    for y in range(80,88):
        for x in range(32,64):
            d=((x+.5-48)/16)**2+((y+.5-84)/4)**2
            if d<=1: shadow.putpixel((x,y), (20,18,35,255 if d<=.36 else 160))
    atlas.paste(shadow,(0,3*CELL))
    palette = sorted({im.getpixel((x,y))[:3] for im in frames for y in range(CELL) for x in range(CELL) if im.getpixel((x,y))[3]})
    manifest = dict(schema=1, nativePixelsPerUnit=32,
        campNpcs=dict(path='camp-npcs.png',cell=CELL,columns=COLS,rows=ROWS,anchor=list(ANCHOR),
            frames=[f'{kind}-idle-{i}' for kind in KINDS for i in range(4)]+['contact-shadow'],
            shadowFrame=12,clips={kind:dict(frames=list(range(k*4,k*4+4)),frameDurationMs=TIMINGS[k]) for k,kind in enumerate(KINDS)}),
        palette=['#%02x%02x%02x'%c for c in palette],
        technical=dict(filter='nearest',mipmaps=False,bodyAlpha='binary',shadowAlpha=[0,160,255],drawCalls=2),
        provenance=dict(origin='Original offline pixel-cluster drawings, authored in scripts/build-camp-npc-assets.py.',
            reference='Project camp pixel-v9 palette and pixel-v17 monk proportions. No source pixels copied.',
            tool='Python3/Pillow '+PILLOW_VERSION, externalServices=False,
            rights='Original project art; same project terms as the authored builder. No external assets.',
            changes='Three original silhouettes and muted garment ramps; four anchored idle poses each.'))
    outputs={'camp-npcs.png':png_bytes(atlas),'manifest.json':json_bytes(manifest),'metrics.json':json_bytes(measure(atlas))}
    for k,kind in enumerate(KINDS):
        strip=Image.new('RGBA',(CELL*4,CELL))
        for i in range(4): strip.paste(frames[k*4+i],(i*CELL,0))
        outputs[f'{kind}-idle.png']=png_bytes(strip)
    return outputs


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true'); parser.add_argument('--metrics-only',action='store_true')
    args=parser.parse_args()
    if args.metrics_only:
        metrics=measure(Image.open(OUT/'camp-npcs.png').convert('RGBA'))
        print(json.dumps(metrics,ensure_ascii=False,indent=2)); return int(metrics['failed']>0)
    outputs=generate()
    if args.check:
        errors=[name for name,data in outputs.items() if not (OUT/name).exists() or (OUT/name).read_bytes()!=data]
        if errors: raise SystemExit('Mismatched generated files: '+', '.join(errors))
        metrics=measure(Image.open(OUT/'camp-npcs.png').convert('RGBA'))
        if metrics['failed']: raise SystemExit('Delivered PNG metric gate failed')
        print(f'CHECK OK: {len(outputs)} files; 12 idle frames; actual PNG metric failures=0')
    else:
        OUT.mkdir(parents=True,exist_ok=True)
        for name,data in outputs.items(): (OUT/name).write_bytes(data)
        if json.loads(outputs['metrics.json'])['failed']: raise SystemExit('Metric gate failed')
        print(f'Built {len(outputs)} files in {OUT}')
    return 0


if __name__=='__main__': raise SystemExit(main())
