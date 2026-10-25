#!/usr/bin/env python3
"""Original local pixel art. Pillow only, binary alpha, no resizing or external inputs."""
import argparse
import io
import math
from pathlib import Path
from PIL import Image, ImageDraw

CELL, FRAMES, DIRS = 96, 6, 8
CENTER = CELL // 2
ROOT = Path(__file__).resolve().parent
DUST = ['#6c665e', '#999183', '#c0b8a8']
METAL = ['#b88b55', '#e5b66e', '#ffe2a3', '#fff6df']
WOOD = ['#88613f', '#bf8d52', '#edbd78', '#ffe8b4']

def world(a, r):
    return ((math.sin(a) - math.cos(a)) * math.sqrt(.5) * r,
            (math.sin(a) + math.cos(a)) * math.sqrt(.5) * r * .5)

def cell(family, heavy, direction, frame):
    im = Image.new('RGBA', (CELL, CELL))
    d = ImageDraw.Draw(im)
    aim, t = direction * math.pi / 4, frame / 5
    scale = 1.28 if heavy else 1
    if family == 0:
        # Three/five independent, ragged puffs. The central gap keeps the target readable.
        puffs = [(-7,-1,3),(0,-4,2),(7,-1,2),(-4,5,2),(4,5,2)] if heavy else [(-6,-1,2),(5,-2,2),(0,3,2)]
        spread = 1 + .8 * t
        for i, (px, py, base_radius) in enumerate(puffs):
            radius = max(1, base_radius - frame // 3)
            x, y = round(CENTER + px * spread), round(CENTER + py * spread)
            rows = [(-1,0,0),(0,-1,1),(1,0,0)] if radius == 1 else ([(-2,-1,1),(-1,-2,1),(0,-1,2),(1,-2,1),(2,0,0)] if radius == 2 else [(-3,-1,0),(-2,-2,2),(-1,-3,2),(0,-2,3),(1,-3,2),(2,-1,2),(3,0,0)])
            for dy, left, right in rows:
                tone = DUST[2] if dy <= -max(1, radius-1) else DUST[0] if dy >= 1 else DUST[1]
                if (i + direction) % 2: left, right = -right, -left
                d.rectangle((x+left,y+dy,x+right,y+dy), fill=tone)
    elif family == 1:
        # Compact, needle-sharp spokes; bright core in the first three keys.
        for i in range(12 if heavy else 8):
            a = aim + i * math.tau / (12 if heavy else 8) + .17
            inner, outer = (1 + t * 8) * scale, (7 + t * 7 + i % 3) * scale
            if frame >= 4 and i % 3: continue
            x0, y0 = world(a, inner)
            x1, y1 = world(a, outer)
            d.line((round(CENTER+x0), round(CENTER+y0), round(CENTER+x1), round(CENTER+y1)), fill=METAL[min(3, i % 3 + (frame < 3))], width=2 if heavy or frame < 2 else 1)
        if frame < 3:
            k = (5 if heavy else 4) - (1 if frame == 2 else 0)
            d.polygon([(CENTER,CENTER-k-1),(CENTER+k,CENTER),(CENTER,CENTER+k+1),(CENTER-k,CENTER)], fill=METAL[2])
            d.rectangle((CENTER-k-2,CENTER-1,CENTER+k+2,CENTER+1), fill=METAL[3])
            d.rectangle((CENTER-1,CENTER-k-2,CENTER+1,CENTER+k+2), fill=METAL[3])
            d.rectangle((CENTER-2,CENTER-2,CENTER+2,CENTER+2), fill='#fffdf1')
    else:
        # A thin crescent sweeps across the incoming heading. Ochre wood, no magic hue.
        radius = (19 + heavy * 5 + t * 3)
        half = 1.05 + heavy * .2
        centre_x, centre_y = world(aim, -radius)
        if frame < 4:
            for band in range(4 if heavy else 3):
                start = aim - half + t * half * 1.4 + band * .09
                end = aim + half + t * .22
                pts = []
                for step in range(41):
                    a = start + (end-start) * step / 40
                    x, y = world(a, radius-band*1.3)
                    pts.append((round(CENTER+centre_x+x), round(CENTER+centre_y+y)))
                d.line(pts, fill=WOOD[min(3, band+1)], width=3 if heavy and band == 0 else 2)
        for i in range(7 if heavy else 4):
            if frame >= 4 and i % 2: continue
            a = aim - half + i * 2 * half / (6 if heavy else 3) + t * .15
            r = radius + 1 + t * 5
            x, y = world(a, r)
            x1, y1 = world(a + .14, r + 2 + heavy)
            d.line((round(CENTER+centre_x+x), round(CENTER+centre_y+y-t*2),
                    round(CENTER+centre_x+x1), round(CENTER+centre_y+y1-t*2)), fill=WOOD[2+i%2], width=1)
    bounds = im.getbbox()
    assert bounds and bounds[0] > 0 and bounds[1] > 0 and bounds[2] < CELL and bounds[3] < CELL, (family, heavy, direction, frame, bounds)
    return im

def check_dust_gaps(im, heavy):
    # Eight-connected components: even diagonal contact would merge two puffs on a phone.
    points = {(x,y) for y in range(CELL) for x in range(CELL) if im.getpixel((x,y))[3]}
    count = 0
    while points:
        count += 1
        todo = [points.pop()]
        while todo:
            x,y = todo.pop()
            for dy in [-1,0,1]:
                for dx in [-1,0,1]:
                    p = (x+dx,y+dy)
                    if p in points:
                        points.remove(p)
                        todo.append(p)
    assert count == (5 if heavy else 3), ('dust puffs must be separate', heavy, count)
    assert im.getpixel((CENTER,CENTER))[3] == 0, 'keep the silhouette visible at contact centre'

def build():
    atlas = Image.new('RGBA', (CELL * FRAMES * 2, CELL * 3 * DIRS))
    for family in range(3):
        for heavy in range(2):
            for direction in range(DIRS):
                row = (family * 2 + heavy) * DIRS + direction
                for frame in range(FRAMES):
                    drawing = cell(family, heavy, direction, frame)
                    if family == 0: check_dust_gaps(drawing, heavy)
                    if family == 1 and frame < 3:
                        assert drawing.getpixel((CENTER,CENTER)) == (255,253,241,255), 'knuckle core must meet the contact anchor'
                    atlas.paste(drawing, (CELL*((row//24)*FRAMES+frame), CELL*(row%24)))
    result = io.BytesIO()
    atlas.save(result, format='PNG', optimize=True)
    return result.getvalue()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    data, path = build(), ROOT / 'contacts.png'
    if args.verify_only:
        assert path.read_bytes() == data, 'atlas differs from generator'
        print('contacts.png: identical')
    else:
        path.write_bytes(data)
        print(f'{path}: {len(data)} bytes')
