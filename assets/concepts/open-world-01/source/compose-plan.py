"""Build the exact top-down plan layers (SVG) from overworld-snapshot.json.

Scale 10 px per world unit, -Y (north, toward the monastery) up.
Run: python3 assets/concepts/open-world-01/source/compose-plan.py
"""
import json, math, pathlib

HERE = pathlib.Path(__file__).parent
D = json.loads((HERE / 'overworld-snapshot.json').read_text())
S, X0, X1, Y0, Y1 = 10, -26, 28, -101, 28
W, H = (X1 - X0) * S, (Y1 - Y0) * S
px = lambda x: round((x - X0) * S, 1)
py = lambda y: round((y - Y0) * S, 1)
f = lambda v: ('%.1f' % v).rstrip('0').rstrip('.')


def merge(runs):
    """Merge per-row runs [x0,x1,y] into rectangles spanning consecutive rows."""
    open_, rects = {}, []
    for x0, x1, y in sorted(runs, key=lambda r: (r[2], r[0])):
        k = (x0, x1)
        if k in open_ and open_[k][1] == y - 1:
            open_[k][1] = y
        else:
            if k in open_: rects.append((x0, x1, *open_[k]))
            open_[k] = [y, y]
    rects += [(k[0], k[1], *v) for k, v in open_.items()]
    return rects


def rect_path(rects):
    return ''.join(f'M{f(px(x0 - .5))} {f(py(y0 - .5))}h{f((x1 - x0 + 1) * S)}v{f((y1 - y0 + 1) * S)}h{f(-(x1 - x0 + 1) * S)}z'
                   for x0, x1, y0, y1 in rects)


def svg(name, body):
    text = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">{body}</svg>'
    (HERE / 'paper-input' / f'{name}.svg').write_text(text)
    return len(text)


walk = {(x, y) for x0, x1, y in D['tileRuns'] for x in range(x0, x1 + 1)}
# Outline: unit edges between walkable and non-walkable cells, chained into horizontal/vertical segments.
edges = []
for x, y in walk:
    if (x, y - 1) not in walk: edges.append(('h', y - .5, x - .5, x + .5))
    if (x, y + 1) not in walk: edges.append(('h', y + .5, x - .5, x + .5))
    if (x - 1, y) not in walk: edges.append(('v', x - .5, y - .5, y + .5))
    if (x + 1, y) not in walk: edges.append(('v', x + .5, y - .5, y + .5))
segs = []
for kind in 'hv':
    rows = {}
    for k, c, a, b in edges:
        if k == kind: rows.setdefault(c, []).append((a, b))
    for c, list_ in rows.items():
        list_.sort(); a0, b0 = list_[0]
        for a, b in list_[1:] + [(None, None)]:
            if a == b0: b0 = b; continue
            segs.append((kind, c, a0, b0)); a0, b0 = a, b
outline = ''.join(f'M{f(px(a))} {f(py(c))}H{f(px(b))}' if k == 'h' else f'M{f(px(c))} {f(py(a))}V{f(py(b))}' for k, c, a, b in segs)

sizes = {}
safe = D['safeArea']
sizes['ground'] = svg('01-ground', f'<path d="{rect_path(merge(D["tileRuns"]))}" fill="#DAD8C1"/>'
                      f'<path d="{outline}" stroke="#7F8468" stroke-width="1.25" fill="none" stroke-linecap="square"/>')
sizes['paving'] = svg('02-paving', f'<path d="{rect_path(merge(D["pavingRuns"]))}" fill="#BCA57C"/>')

# Renderer snapshot (natural boundary + outer groves). Contact points, radius ~ .45*scale u.
tone = {'cypress': '#55654F', 'dead-tree': '#6D6355', 'rock-large': '#9C9C93', 'rock-small': '#A6A69D', 'shrub': '#8B9670', 'ruin-pile': '#8C8496', 'grass': None}
def natural(items, opacity):
    out = []
    for p in items:
        c = tone.get(p['frame'])
        if not c: continue
        x, y = p['contact']['x'], p['contact']['y']
        if not (X0 + .5 < x < X1 - .5 and Y0 + .5 < y < Y1 - .5): continue
        r = (.62 if p['frame'] in ('cypress', 'dead-tree') else .42) * p['scale'] * S
        out.append(f'<circle cx="{f(px(x))}" cy="{f(py(y))}" r="{f(r)}" fill="{c}"/>')
    return f'<g opacity="{opacity}">' + ''.join(out) + '</g>'
# Outer groves: only the large silhouettes; small accents would read as noise at 10 px/u.
big = [p for p in D['renderer']['scenery'] if p['frame'] in ('cypress', 'dead-tree', 'rock-large', 'ruin-pile')]
sizes['renderer'] = svg('03-renderer-snapshot-v3', natural(big, .5) + natural(D['renderer']['border'], .85))

# Exact gameplay colliders (camp set dressing, road/courtyard pillars and braziers).
obs = []
for o in D['obstacles']:
    if 'radius' in o:
        obs.append(f'<circle cx="{f(px(o["x"]))}" cy="{f(py(o["y"]))}" r="{f(o["radius"] * S)}"/>')
    else:
        hw, hd = o.get('halfWidth', o.get('halfSize')), o.get('halfDepth', o.get('halfSize'))
        obs.append(f'<rect x="{f(px(o["x"] - hw))}" y="{f(py(o["y"] - hd))}" width="{f(2 * hw * S)}" height="{f(2 * hd * S)}"/>')
braz = {'cyan': '#4F9C9A', 'pink': '#B5577A', 'amber': '#C98A2E'}
lights = ''.join(f'<circle cx="{f(px(b["x"]))}" cy="{f(py(b["y"]))}" r="3.2" fill="{braz[b["color"]]}"/>' for z in D['zones'] for b in z['braziers'])
sizes['colliders'] = svg('04-colliders', f'<g fill="#6F7D63" fill-opacity=".82" stroke="#3E4A3A" stroke-width=".75">{"".join(obs)}</g>{lights}')

# Routes: main axis, side loop (road paving route 2 at offset -51), return to reward.
side = [(0, 10), (-4, 8), (-6, 8), (-14, 8), (-16, 6), (-16, 1), (-14, -2), (-11, -2), (-6, -2), (0, -2)]
side = ' '.join(f'{f(px(x))},{f(py(y - 51))}' for x, y in side)
sp, ri, rw = D['points']['spawn'], D['points']['ritual'], D['points']['reward']
routes = (f'<line x1="{px(sp["x"]) - 3}" y1="{py(sp["y"])}" x2="{px(ri["x"]) - 3}" y2="{py(ri["y"]) + 4}" stroke="#27302A" stroke-width="2" stroke-dasharray="10 6"/>'
          f'<polyline points="{side}" fill="none" stroke="#3F8583" stroke-width="2" stroke-dasharray="2 5" stroke-linecap="round"/>'
          f'<polyline points="{px(ri["x"]) + 4},{py(ri["y"]) + 4} {px(4) + 4},{py(-24)} {px(rw["x"])},{py(rw["y"]) - 6}" fill="none" stroke="#C98A2E" stroke-width="2" stroke-dasharray="10 6"/>')
sizes['routes'] = svg('05-routes', routes)

# Packs: padded convex hull + members (hound circle, wraith diamond).
def hull(pts):
    pts = sorted(set(pts))
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) > 1 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) > 1 and cross(hi[-2], hi[-1], p) <= 0: hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]
packs, keys = [], {}
for i, pk in enumerate(D['packs']):
    members = [e for e in D['encounters'] if e['packId'] == pk['id']]
    ring = []
    for e in members:
        for a in range(0, 360, 30):
            ring.append((round(px(e['x']) + 14 * math.cos(math.radians(a)), 1), round(py(e['y']) + 14 * math.sin(math.radians(a)), 1)))
    h = hull(ring)
    packs.append(f'<polygon points="{" ".join(f"{f(x)},{f(y)}" for x, y in h)}" fill="#B5577A" fill-opacity=".1" stroke="#7A3B4F" stroke-width="1.25" stroke-dasharray="4 3"/>')
    for e in members:
        x, y = px(e['x']), py(e['y'])
        packs.append(f'<circle cx="{f(x)}" cy="{f(y)}" r="5" fill="#4A2E2A" stroke="#F3F1E6" stroke-width="1.25"/>' if e['kind'] == 'hound' else
                     f'<path d="M{f(x)} {f(y - 7)}L{f(x + 6)} {f(y)}L{f(x)} {f(y + 7)}L{f(x - 6)} {f(y)}z" fill="#B5577A" stroke="#F3F1E6" stroke-width="1.25"/>')
    keys[pk['id']] = {'letter': 'ABCDEF'[i], 'labelX': round(max(x for x, _ in h) + 6), 'labelY': round((min(y for _, y in h) + max(y for _, y in h)) / 2)}
sizes['packs'] = svg('06-packs', ''.join(packs))

pts = {k: {'x': px(v['x']), 'y': py(v['y'])} for k, v in D['points'].items()}
meta = {'scale': S, 'frame': {'x0': X0, 'x1': X1, 'y0': Y0, 'y1': Y1, 'width': W, 'height': H}, 'svgBytes': sizes,
        'packKeys': keys, 'points': pts,
        'seams': {str(s): py(s) for s in D['seams']}, 'safeArea': {'top': py(safe['minY']), 'bottom': py(safe['maxY'])},
        'zoneLabels': {z['id']: py((z['minY'] + z['maxY']) / 2) for z in D['zones']}}
(HERE / 'plan-projection.json').write_text(json.dumps(meta, indent=2) + '\n')
print(json.dumps(meta, indent=1))
