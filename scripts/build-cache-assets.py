#!/usr/bin/env python3
"""Draw the monastery cache at 32 px/u. No downloads or generated-image inputs.
Closed keys vary only the turquoise seal. Opening keys rotate one iron-bound lid.
--verify-only rebuilds in memory and compares bytes without writing.
"""
import argparse
import base64
import hashlib
import io
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, __version__ as PILLOW_VERSION

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/game/pixel-v15/cache'
CELL, COLS, ROWS, ANCHOR = 128, 8, 6, (64, 96)
VISUAL_SCALE = 1.32
BAYER4 = ((0,8,2,10),(12,4,14,6),(3,11,1,9),(15,7,13,5))
KX, KY, KZ = 16 * math.sqrt(2), 8 * math.sqrt(2), 32 * math.sin(math.pi / 3)
# Camp/ruins wood, charcoal, iron and brass; turquoise is the friendly spiritual seal.
PAL = {
    'ink': '#0e121d', 'deep': '#1f2737', 'wood': '#6e4f45', 'woodHi': '#9f7960',
    'woodLight': '#b09c82', 'woodShade': '#4a3438', 'grain': '#2f2230',
    'iron': '#5c5258', 'ironHi': '#9f9280', 'ironLight': '#c9b79b', 'ironShade': '#30344a',
    'brass': '#b8935c', 'brassHi': '#d3bb8f', 'runeDeep': '#14707e',
    'rune': '#24ced5', 'runeHi': '#92faf1', 'white': '#e6fffb',
}
NAMES = ([f'closed-{i}' for i in range(4)] + [f'opening-{i}' for i in range(3)] + ['open-empty']
         + [f'beacon-{i}' for i in range(24)] + [f'burst-{i}' for i in range(8)] + ['steady', 'ground-pool'])


def project(x, y, z):
    return (round(ANCHOR[0] + (y - x) * KX * VISUAL_SCALE), round(ANCHOR[1] + ((x + y) * KY - z * KZ * .8) * VISUAL_SCALE))


def polygon(draw, points, fill, outline='ink'):
    draw.polygon([project(*p) for p in points], fill=PAL.get(fill, fill), outline=PAL.get(outline, outline) if outline else None)


def line(draw, points, fill, width=1):
    draw.line([project(*p) for p in points], fill=PAL.get(fill, fill), width=width)


def cuboid(draw, x0, y0, x1, y1, low, high, colors):
    top, left, right = colors
    polygon(draw, [(x0,y0,high),(x0,y1,high),(x1,y1,high),(x1,y0,high)], top)
    polygon(draw, [(x1,y0,low),(x1,y1,low),(x1,y1,high),(x1,y0,high)], left)
    polygon(draw, [(x0,y1,low),(x1,y1,low),(x1,y1,high),(x0,y1,high)], right)


def chest(stage=0, strength=0):
    img = Image.new('RGBA', (CELL, CELL))
    d = ImageDraw.Draw(img)
    # Exactly the old .68 x .44 body footprint and .73 x .49 lid overhang.
    for x in [-.30, .30]:
        for y in [-.18, .18]:
            cuboid(d,x-.04,y-.04,x+.04,y+.04,0,.12,('ironHi','iron','ironShade'))
    cuboid(d,-.34,-.22,.34,.22,.07,.56,('woodShade','wood','woodShade'))
    # Horizontal stave seams with broad wood clusters, never random texture.
    for z in [.18,.36]:
        line(d,[(.34,-.21,z),(.34,.22,z),(-.34,.22,z)],'grain')
        line(d,[(.34,-.20,z+.035),(.34,.2,z+.035)],'woodHi')
    # Riveted iron bands across both visible faces.
    for x in [-.28,.19]:
        polygon(d,[(x,.224,.08),(x+.075,.224,.08),(x+.075,.224,.56),(x,.224,.56)],'ironShade')
        line(d,[(x,.228,.10),(x,.228,.54)],'ironHi')
        for z in [.14,.46]:
            p=project(x+.035,.23,z); d.point(p,fill=PAL['brassHi'])
    for y in [-.17,.13]:
        polygon(d,[(.345,y,.08),(.345,y+.075,.08),(.345,y+.075,.56),(.345,y,.56)],'iron')
        line(d,[(.35,y,.10),(.35,y,.54)],'ironLight')
        for z in [.14,.46]:
            d.point(project(.35,y+.035,z),fill=PAL['brassHi'])
    line(d,[(.345,-.22,.09),(.345,.22,.09),(-.34,.22,.09)],'ironShade',2)
    # The rim and the empty, dark interior become visible as the lid lifts.
    polygon(d,[(-.34,-.22,.56),(-.34,.22,.56),(.34,.22,.56),(.34,-.22,.56)],'ironHi')
    polygon(d,[(-.28,-.16,.56),(-.28,.16,.56),(.28,.16,.56),(.28,-.16,.56)],'ink',None)
    line(d,[(.29,-.16,.55),(.29,.16,.55),(-.27,.16,.55)],'woodShade')
    angles=[0,.25,.64,1.0,1.35]
    angle=angles[stage]
    # Hinge on the back (-x) edge; lid coordinates always have the same pivot.
    def lid(x,y,z=.0):
        length=x+.365
        return (-.365+length*math.cos(angle)-z*math.sin(angle),y,.585+length*math.sin(angle)+z*math.cos(angle))
    polygon(d,[lid(-.365,-.245,.075),lid(-.365,.245,.075),lid(.365,.245,.075),lid(.365,-.245,.075)],'woodHi')
    polygon(d,[lid(.365,-.245),lid(.365,.245),lid(.365,.245,.075),lid(.365,-.245,.075)],'iron')
    polygon(d,[lid(-.365,.245),lid(.365,.245),lid(.365,.245,.075),lid(-.365,.245,.075)],'ironShade')
    # Three oak lid planks, bevel, iron straps and four brass rivets.
    for x in [-.12,.12]:
        line(d,[lid(x,-.21,.08),lid(x,.21,.08)],'woodShade')
    line(d,[lid(-.36,-.24,.08),lid(.36,-.24,.08),lid(.36,.24,.08)],'ironLight')
    for y in [-.20,.13]:
        polygon(d,[lid(-.35,y,.09),lid(.35,y,.09),lid(.35,y+.065,.09),lid(-.35,y+.065,.09)],'iron',None)
        line(d,[lid(-.35,y,.10),lid(.35,y,.10)],'ironHi')
        for x in [-.27,.26]:
            d.point(project(*lid(x,y+.03,.11)),fill=PAL['brassHi'])
    # Carved diamond with a vertical key; strength changes only these pixels.
    if stage < 4:
        ramp=['runeDeep','rune','runeHi','white']
        outer=ramp[min(strength,3)]
        points=[lid(-.14,0,.11),lid(0,-.095,.11),lid(.14,0,.11),lid(0,.095,.11),lid(-.14,0,.11)]
        line(d,points,'runeDeep',4 if strength >= 2 else 3)
        line(d,points,outer,2)
        line(d,[lid(-.2,0,.115),lid(.2,0,.115)],'runeHi' if strength >= 2 else 'rune')
    # Front latch, worn brass corners and dark keyhole remain after opening.
    cuboid(d,.345,-.06,.37,.065,.30,.47,('brassHi','brass','ironShade'))
    d.point(project(.375,0,.37),fill=PAL['ink'])
    if stage < 4:
        # The seal runs from the lid down the latch, making the rune readable at phone scale.
        ink=['runeDeep','rune','runeHi','white'][max(0,strength-stage//2)]
        line(d,[(.385,0,.55),(.385,0,.31)],'rune',5 if strength >= 2 else 4)
        line(d,[(.385,0,.55),(.385,0,.31)],ink,3 if strength >= 2 else 2)
        line(d,[(.385,-.065,.44),(.385,.065,.44)],ink)

    if stage == 4:
        # The inner lip confirms that this chest has been emptied.
        line(d,[(.24,-.13,.565),(.24,.13,.565),(-.22,.13,.565)],'wood')
    return img


def beacon(key=0, burst=False, steady=False):
    """Eight motes and one shaft in a single transparent sprite, rooted at the seal."""
    img = Image.new('RGBA', (CELL, CELL))
    d = ImageDraw.Draw(img)
    root_x, root_y = 64, 76
    if burst:
        # Ease outward quickly; per-pixel alpha returns to rest with CacheGlow's half-second fade.
        t = key / 7
        reach = 5 + 26 * (1 - (1-t)**2)
        for i in range(8):
            angle = i * math.tau / 8 - math.pi / 2
            x = round(root_x + math.cos(angle) * reach)
            y = round(root_y + math.sin(angle) * reach * .7 - t * 14)
            d.line((root_x + math.cos(angle)*(reach-5), root_y+math.sin(angle)*(reach-5)*.7-t*14,x,y),
                   fill=(36,206,213,180),width=2)
            d.rectangle((x-1,y-1,x+1,y+2),fill=PAL['runeHi'])
            d.point((x,y),fill=PAL['white'])
        height = 55 + round(5 * (1-t))
        strength = .95 - t * .35
    else:
        # All eight flecks remain visible; their staggered cycle avoids an empty resting frame.
        for i in range(8):
            age = (key * 2 + i * 6) % 48
            x = root_x + [-23,-15,-6,7,20,15,-19,3][i] + (1 if age>22 else 0)
            y = root_y + 9 - age
            alpha = round(150 + 105 * math.sin(math.pi * (age+1)/50))
            d.rectangle((x-1,y-1,x+1,y+2),fill=(36,206,213,alpha))
            d.rectangle((x,y-1,x+1,y+1),fill=(146,250,241,alpha))
            d.point((x,y-1),fill=(*bytes.fromhex('e6fffb'),alpha))
        # Six 100 ms shaft keys: a fast eased rise, then a soft fade. No shaft in the 1.8 s rest.
        t = key / 10
        if steady:
            height, strength = 48, .42
        elif t < .6:
            u = min(1,t/.25)
            height = round(12 + 43 * (1-(1-u)**3))
            rise = min(1,(t+.05)/.2)
            tail = min(1,max(0,(.6-t)/.4))
            strength = rise*rise*(3-2*rise) * tail*tail*(3-2*tail)
        else:
            height, strength = 0, 0
    if height:
        for y in range(root_y-height,root_y+2):
            along = (root_y-y)/max(1,height)
            # A narrow white-cyan axis with an ordered, broken fringe. It never becomes a wide fog.
            alpha = round(230*strength*(1-.25*along))
            d.rectangle((root_x-1,y,root_x+1,y),fill=(146,250,241,alpha))
            if strength>.55:
                d.point((root_x,y),fill=(230,255,251,min(255,round(alpha*1.25))))
            for x in (root_x-3,root_x+3):
                if BAYER4[y%4][x%4]/16 < strength*.55:
                    d.point((x,y),fill=(36,206,213,round(alpha*.48)))
        d.rectangle((root_x-3,root_y-1,root_x+3,root_y+1),fill=(146,250,241,round(255*strength)))
    return img


def pool():
    img = Image.new('RGBA',(CELL,CELL))
    # A real 1.5u radius (48 source pixels); the 2:1 projection halves the screen-down radius.
    # Bayer coverage blends adjacent alpha levels. No ring, contour or hard concentric steps.
    for y in range(CELL):
        for x in range(CELL):
            radius = math.hypot((x-64)/48,(y-96)/24)
            if radius >= 1:
                continue
            edge = max(0,min(1,(1-radius)/.3))
            falloff = math.exp(-3*radius*radius) * edge*edge*(3-2*edge)
            value = falloff*4
            level = math.floor(value)
            if value-level > (BAYER4[y%4][x%4]+.5)/16:
                level += 1
            alpha = min(192,48*level)
            if alpha:
                img.putpixel((x,y),(36,206,213,alpha))
    return img


def png(img):
    b=io.BytesIO(); img.save(b,format='PNG',optimize=False); return b.getvalue()


def build():
    frames=[chest(strength=i) for i in range(4)]+[chest(stage=i+1,strength=max(0,2-i)) for i in range(3)]+[chest(stage=4)]+[beacon(i) for i in range(24)]+[beacon(i,burst=True) for i in range(8)]+[beacon(0,steady=True)]+[pool()]
    atlas=Image.new('RGBA',(CELL*COLS,CELL*ROWS))
    bounds=[]
    for i,img in enumerate(frames):
        atlas.paste(img,((i%COLS)*CELL,(i//COLS)*CELL))
        bounds.append(list(img.getbbox()))
    # Alpha masks are per pixel, LSB first, like the other prop packages.
    bits=bytearray((atlas.width*atlas.height+7)//8)
    for i,a in enumerate(atlas.getchannel('A').tobytes()):
        if a>=128: bits[i>>3] |= 1 << (i&7)
    masks={'cache.png':{'width':atlas.width,'height':atlas.height,'encoding':'base64-lsb','bits':base64.b64encode(bits).decode()}}
    files={'cache.png':png(atlas),'hit-masks.json':(json.dumps(masks,separators=(',',':'))+'\n').encode()}
    sheet=Image.new('RGBA',(CELL*8,CELL*8),(42,38,49,255))
    for i,img in enumerate(frames[:8]+[frames[k] for k in [8,9,10,11,12,13,32,41]]):
        shown=img.resize((CELL*2,CELL*2),Image.Resampling.NEAREST)
        sheet.alpha_composite(shown,((i%4)*CELL*2,(i//4)*CELL*2))
    files['contact-sheet.png']=png(sheet)
    manifest={
        'schemaVersion':1,'nativePixelsPerUnit':32,'visualScale':VISUAL_SCALE,
        'cache':{'path':'cache.png','cell':CELL,'columns':COLS,'rows':ROWS,'anchor':list(ANCHOR),
                 'frames':NAMES,'filter':'nearest','mipmaps':False,'opaqueBounds':bounds},
        'footprint':{'width':.68,'depth':.44,'lidWidth':.73,'lidDepth':.49,'collision':'unchanged; owned by world layout','pickable':False},
        'timing':{'pulseSeconds':1.6,'callSeconds':2.4,'shaftSeconds':.6,'openingStepSeconds':.1,'fadeSeconds':.5},
        'beacon':{'motes':8,'shaftHeight':2,'poolRadius':1.5,'dither':'4x4 Bayer; alpha coverage','effectFrame':8,'burstFrame':32,'steadyFrame':40,'poolFrame':41},
        'alpha':{'chest':'binary','motes':'translucent','pool':'ordered dither between alpha levels 0/48/96/144/192; no hard rim'},
        'palette':PAL,
        'provenance':{'script':'scripts/build-cache-assets.py','method':'Original deterministic pixel geometry; no image generation or external inputs','pillow':PILLOW_VERSION},
        'files':{name:hashlib.sha256(data).hexdigest() for name,data in files.items()},
    }
    files['manifest.json']=(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n').encode()
    return files


def main():
    p=argparse.ArgumentParser(); p.add_argument('--verify-only',action='store_true'); args=p.parse_args()
    files=build()
    if args.verify_only:
        stale=[name for name,data in files.items() if not (OUT/name).exists() or (OUT/name).read_bytes()!=data]
        if stale: raise SystemExit('stale: '+', '.join(stale))
        print(f'ok: {len(files)} cache files match'); return
    OUT.mkdir(parents=True,exist_ok=True)
    for name,data in files.items(): (OUT/name).write_bytes(data)
    print(f'wrote {len(files)} files to {OUT.relative_to(ROOT)}')


if __name__=='__main__': main()
