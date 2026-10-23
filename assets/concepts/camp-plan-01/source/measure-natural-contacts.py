"""Measure visible support arcs in immutable reused art, excluding foliage/long roots."""
import hashlib
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
ATLAS = REPO / 'assets/game/pixel-v4/landscape/landscape.png'
image = Image.open(ATLAS).convert('RGBA')
# These reviewed column ranges select the ground-facing base, not canopy extents.
SELECTIONS = [('cypress', 0, 72, 89, 'Trunk root collar; excludes hanging canopy.'),
              ('dead-tree', 1, 59, 80, 'Dense trunk/root collar; thin spreading roots are overhang, not new blockers.'),
              ('rock-large', 2, 52, 108, 'Ground-facing lower stone arc, full base width.'),
              ('rock-small', 3, 67, 93, 'Ground-facing lower stone arc, full base width.'),
              ('shrub', 4, 64, 95, 'Lower crown/root support arc; excludes raised foliage.')]

def solve(a, b):
    a = [list(r) + [v] for r, v in zip(a, b)]
    for col in range(3):
        row = max(range(col, 3), key=lambda r: abs(a[r][col]))
        a[col], a[row] = a[row], a[col]
        divisor = a[col][col]
        a[col] = [v / divisor for v in a[col]]
        for row in range(3):
            if row != col:
                factor = a[row][col]
                a[row] = [v - factor * w for v, w in zip(a[row], a[col])]
    return [r[-1] for r in a]

records = {}
preview = Image.new('RGB', (160 * len(SELECTIONS), 196), '#d6d9c9')
for index, (kind, frame, low, high, note) in enumerate(SELECTIONS):
    x0, y0 = frame % 4 * 160, frame // 4 * 160
    cell = image.crop((x0, y0, x0 + 160, y0 + 160))
    samples = []
    for x in range(low, high + 1):
        ys = [y for y in range(128, 144) if cell.getpixel((x, y))[3]]
        if ys:
            samples.append([x + .5, max(ys) + .5])
    rows = [([u, 2*v, 1], -(u*u + 4*v*v)) for u, v in samples]
    a, b, c = solve([[sum(row[i]*row[j] for row, _ in rows) for j in range(3)] for i in range(3)],
                     [sum(row[i]*value for row, value in rows) for i in range(3)])
    cx, cy = -a/2, -b/4
    radius = math.sqrt(cx*cx + 4*cy*cy - c)
    center = [round(cx*4)/4, round(cy*4)/4]
    rms = math.sqrt(sum((math.hypot(u-cx, 2*(v-cy))-radius)**2 for u,v in samples)/len(samples))
    records[kind] = {'frame': frame, 'selectedColumns': [low, high], 'selectedRows': [128, 143],
                     'selectionReason': note, 'frontEdgePixelCenters': samples,
                     'fittedCenter': [cx,cy], 'contactCenter': center, 'screenRadiusX': radius,
                     'screenRadiusY': radius/2, 'fitRmsPixels': rms,
                     'approximate': True, 'rearEdge': 'inferred; lower front arc only'}
    preview.paste(cell, (index*160, 20), cell)
    draw = ImageDraw.Draw(preview)
    draw.text((index*160+4, 3),kind, fill='#242f2b')
    for u,v in samples: draw.point((index*160+u,20+v),fill='#c76628')
    u,v=index*160+center[0],20+center[1]
    draw.ellipse((u-radius,v-radius/2,u+radius,v+radius/2),outline='#2d858b',width=1)
    draw.line((u-4,v,u+4,v),fill='#cd3322',width=1); draw.line((u,v-4,u,v+4),fill='#cd3322',width=1)
    draw.text((index*160+4,182),f'{center[0]:g}, {center[1]:g}',fill='#242f2b')
result = {'schemaVersion':1, 'pathBase':'repository-root', 'atlas':'assets/game/pixel-v4/landscape/landscape.png',
          'atlasSha256':hashlib.sha256(ATLAS.read_bytes()).hexdigest(), 'cell':160, 'columns':4,
          'anchor':[80,144], 'coordinateSpace':'cell-local pixel centers, x right/y down',
          'method':'Least-squares ground-circle fit in (pixelX, 2*pixelY) to the selected lower opaque arc; contact center rounded to quarter-pixel. Rear arc is inferred. Radius is diagnostic, not collision authority.',
          'collisionPolicy':'Preserve existing world centers/radii. Broad stone/crown silhouettes can overhang the existing solid core; do not enlarge invisible blockers. Flip native x around 80 and apply actual scale before inverse projection.',
          'frames':records}
(HERE/'natural-contacts.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
preview.resize((2400,588),Image.Resampling.NEAREST).save(HERE/'natural-contacts-3x.png')
print(json.dumps({k:{'center':v['contactCenter'],'radius':v['screenRadiusX'],'rms':v['fitRmsPixels']} for k,v in records.items()},indent=2))
