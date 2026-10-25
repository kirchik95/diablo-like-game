"""24x24 pixel icons for the six new monk techniques, in the style of index.html skill icons.
Each icon is a list of (color, ops); later layers paint over earlier ones.
Outputs merged-rect SVG paths and an 8x preview sheet."""
import json, math, sys
from PIL import Image

C = {
  'd': '#397C85', 's': '#6DD6CB', 'l': '#C2F0DD',
  'w': '#A74D58', 'c': '#EF8E83', 'p': '#F8C4AB',
  'b': '#8F734F', 'a': '#E5B66E', 'i': '#EEE0CE', 'n': '#171321',
}

def grid():
  return [[None] * 24 for _ in range(24)]

def rect(g, k, x, y, w, h):
  for yy in range(y, y + h):
    for xx in range(x, x + w):
      if 0 <= xx < 24 and 0 <= yy < 24: g[yy][xx] = k

def px(g, k, pts):
  for x, y in pts:
    if 0 <= x < 24 and 0 <= y < 24: g[y][x] = k

def rows(g, k, spec):
  """spec: {y: [(x0, x1), ...]} inclusive spans"""
  for y, spans in spec.items():
    for x0, x1 in spans: rect(g, k, x0, y, x1 - x0 + 1, 1)

def circle(g, k, cx, cy, r, step=1):
  pts = set()
  for t in range(0, 360 * 4, step):
    a = math.radians(t / 4)
    pts.add((int(round(cx + r * math.cos(a))), int(round(cy + r * math.sin(a)))))
  px(g, k, pts)

def ellipse(g, k, cx, cy, rx, ry, dash=None, arc=None):
  pts = []
  for t in range(0, 1440):
    a = math.radians(t / 4)
    if arc and not (arc[0] <= t / 4 <= arc[1]): continue
    pts.append((int(round(cx + rx * math.cos(a))), int(round(cy + ry * math.sin(a))), t / 4))
  seen = []
  for x, y, deg in pts:
    if (x, y) in [(p[0], p[1]) for p in seen[-3:]]: continue
    seen.append((x, y, deg))
  uniq = []
  for x, y, deg in seen:
    if (x, y) not in [(u[0], u[1]) for u in uniq]: uniq.append((x, y, deg))
  if dash:
    on, off = dash
    uniq.sort(key=lambda u: u[2])
    uniq = [u for i, u in enumerate(uniq) if i % (on + off) < on]
  px(g, k, [(x, y) for x, y, _ in uniq])

def line(g, k, x0, y0, x1, y1, w=1):
  n = max(abs(x1 - x0), abs(y1 - y0))
  for i in range(n + 1):
    x = round(x0 + (x1 - x0) * i / n); y = round(y0 + (y1 - y0) * i / n)
    rect(g, k, x - (w - 1) // 2, y - (w - 1) // 2, w, w)

icons = {}

# 1. Ладонь духа: turquoise palm flying right, coral core, speed streaks behind.
g = grid()
rows(g, 'd', {9: [(1, 6)], 12: [(0, 5)], 15: [(2, 6)]})              # streaks (as dash icon)
# palm block with fingers to the right, thumb up
rect(g, 'd', 8, 8, 1, 10); rect(g, 'd', 9, 18, 7, 1)                   # left and lower shadow
rows(g, 'd', {6: [(16, 20)], 9: [(16, 22)], 12: [(16, 22)], 15: [(16, 20)], 3: [(10, 12)], 4: [(9, 13)], 5: [(10, 14)]})
rect(g, 's', 9, 7, 7, 11)                                           # palm
rows(g, 's', {7: [(16, 20)], 10: [(16, 22)], 13: [(16, 21)], 16: [(16, 19)], 4: [(10, 12)], 5: [(11, 13)], 6: [(12, 14)]})
rows(g, 's', {8: [(16, 21)], 11: [(16, 22)], 14: [(16, 21)]})
rows(g, 'n', {9: [(16, 21)], 12: [(16, 22)], 15: [(16, 19)]})       # finger gaps
rows(g, 'l', {7: [(9, 15), (16, 19)], 10: [(16, 21)], 13: [(16, 20)], 4: [(10, 11)]})
rect(g, 'c', 10, 10, 4, 4)                                          # coral heart of the palm
rect(g, 'p', 11, 11, 2, 2)
px(g, None, [(9, 7)]); px(g, 'd', [(9, 17), (15, 17)])               # rounded palm corners
icons['palm'] = g

# 2. Прыжок журавля: crane wings at the apex, dotted arc, empty landing ring.
g = grid()
ellipse(g, 'd', 15, 20, 7, 2.6)                                     # ring shadow
ellipse(g, 's', 15, 19, 7, 2.6)                                     # landing ring (empty)
px(g, 'l', [(3, 20), (3, 17), (4, 14), (5, 11), (13, 13), (14, 16)])  # dotted trajectory
# wings: a shallow M
rows(g, 'd', {9: [(2, 4), (19, 21)], 8: [(4, 6), (17, 19)], 7: [(6, 8), (15, 17)], 6: [(8, 10), (13, 15)]})
rows(g, 's', {8: [(1, 3), (20, 22)], 7: [(3, 5), (18, 20)], 6: [(5, 7), (16, 18)], 5: [(7, 10), (13, 16)]})
rows(g, 'l', {7: [(1, 2), (21, 22)], 6: [(3, 4), (19, 20)], 5: [(5, 6), (17, 18)], 4: [(8, 9), (14, 15)]})
rect(g, 's', 10, 4, 4, 5)                                           # body
rect(g, 'l', 11, 3, 2, 2)                                           # head
rect(g, 'c', 11, 2, 2, 1)                                           # crane's red crown
rows(g, 'd', {9: [(10, 13)], 10: [(10, 11)], 11: [(9, 10)], 12: [(8, 9)]})  # tucked legs
icons['crane'] = g

# 3. Отражение: crossed forearms inside a thin turquoise ring, coral flash.
g = grid()
circle(g, 'd', 11.5, 12.5, 10.3)
circle(g, 's', 11.5, 11.5, 10.3)
line(g, 'w', 5, 19, 17, 7, 3)                                       # back forearm shadow
line(g, 'c', 5, 18, 17, 6, 3)
line(g, 'w', 18, 19, 6, 7, 3)
line(g, 'c', 18, 18, 6, 6, 3)                                       # front forearm
line(g, 'p', 17, 17, 8, 8, 1)
rect(g, 'b', 9, 11, 6, 2)                                           # wrist wraps (bronze)
rect(g, 'a', 9, 11, 6, 1)
rect(g, 'w', 3, 4, 4, 4); rect(g, 'c', 3, 3, 4, 4); rect(g, 'p', 4, 3, 2, 1)       # fists
rect(g, 'w', 17, 4, 4, 4); rect(g, 'c', 17, 3, 4, 4); rect(g, 'p', 18, 3, 2, 1)
px(g, 'i', [(11, 0), (12, 0), (11, 1), (12, 1), (10, 2), (13, 2)])  # flash spark
px(g, 'p', [(9, 1), (14, 1)])
icons['deflect'] = g

# 4. Колокол тишины: bronze bell over a dashed turquoise circle.
g = grid()
ellipse(g, 's', 11.5, 20.5, 10, 2.4, dash=(2, 1))
rect(g, 'b', 11, 1, 2, 2)                                           # hanging loop
rows(g, 'b', {3: [(9, 14)], 4: [(8, 15)], 5: [(7, 16)], 6: [(7, 16)], 7: [(7, 16)], 8: [(6, 17)], 9: [(6, 17)], 10: [(6, 17)],
              11: [(6, 17)], 12: [(5, 18)], 13: [(5, 18)], 14: [(4, 19)], 15: [(3, 20)], 16: [(3, 20)]})
rows(g, 'a', {3: [(10, 13)], 4: [(9, 14)], 5: [(9, 15)], 6: [(9, 15)], 7: [(9, 15)], 8: [(8, 16)], 9: [(8, 16)], 10: [(8, 16)],
              11: [(8, 16)], 12: [(7, 17)], 13: [(7, 17)], 14: [(6, 18)], 15: [(4, 19)]})
rows(g, 'i', {4: [(10, 11)], 5: [(10, 10)], 6: [(10, 10)], 7: [(10, 10)], 8: [(9, 9)], 9: [(9, 9)], 10: [(9, 9)]})
rows(g, 'b', {11: [(8, 16)]})                                       # waist band
rows(g, 'n', {17: [(4, 19)]})
rect(g, 'b', 11, 17, 2, 2)                                          # clapper
rect(g, 'a', 11, 17, 2, 1)
# sound marks
px(g, 'l', [(2, 7), (1, 8), (1, 9), (2, 10), (21, 7), (22, 8), (22, 9), (21, 10)])
icons['bell'] = g

# 5. Мантра стойкости: a ring of prayer beads with a tassel and a spirit mark inside.
g = grid()
beads = []
for k in range(10):
  a = math.radians(-90 + k * 36)
  beads.append((round(11.5 + 8 * math.cos(a)), round(10.5 + 8 * math.sin(a))))
for (x, y) in beads:
  if (x, y) == beads[5]: continue
  rect(g, 'b', x - 1, y, 3, 2); rect(g, 'a', x - 1, y - 1, 3, 2); px(g, 'i', [(x - 1, y - 1)])
gx, gy = beads[5]
rect(g, 'b', gx - 2, gy - 1, 5, 4); rect(g, 'a', gx - 2, gy - 2, 5, 4); px(g, 'i', [(gx - 1, gy - 2)])   # guru bead
rect(g, 'd', gx - 1, gy + 2, 3, 4); rect(g, 's', gx, gy + 2, 1, 5); px(g, 'l', [(gx - 1, gy + 5), (gx + 1, gy + 5)])  # tassel
# spirit diamond in the middle (vital spirit icon, x2)
rows(g, 'd', {7: [(11, 12)], 8: [(10, 13)], 9: [(9, 14)], 10: [(8, 15)], 11: [(8, 15)], 12: [(9, 14)], 13: [(10, 13)], 14: [(11, 12)]})
rows(g, 's', {7: [(11, 12)], 8: [(10, 13)], 9: [(9, 14)], 10: [(9, 14)], 11: [(9, 14)], 12: [(10, 13)], 13: [(11, 12)]})
rect(g, 'l', 10, 9, 2, 2)
icons['mantra'] = g

# 6. Семь ударов: seven turquoise afterimage strikes around a coral impact.
g = grid()
for k in range(7):
  a = math.radians(-90 + k * 360 / 7)
  x0, y0 = 11.5 + 10 * math.cos(a), 11.5 + 10 * math.sin(a)
  x1, y1 = 11.5 + 5.5 * math.cos(a), 11.5 + 5.5 * math.sin(a)
  line(g, 'd', round(x0), round(y0) + 1, round(x1), round(y1) + 1, 2)
  line(g, 's', round(x0), round(y0), round(x1), round(y1), 1)
  rect(g, 's', round(x0) - 1, round(y0) - 1, 2, 2)
  px(g, 'l', [(round(x0) - 1, round(y0) - 1)])
rows(g, 'w', {9: [(11, 12)], 10: [(10, 13)], 11: [(9, 14)], 12: [(9, 14)], 13: [(10, 13)], 14: [(11, 12)]})
rows(g, 'c', {9: [(11, 12)], 10: [(10, 13)], 11: [(9, 14)], 12: [(10, 13)], 13: [(11, 12)]})
rect(g, 'p', 11, 10, 2, 2)
icons['seven'] = g


def to_paths(g):
  out = {}
  for k in C:
    parts = []
    for y in range(24):
      x = 0
      while x < 24:
        if g[y][x] == k:
          x0 = x
          while x < 24 and g[y][x] == k: x += 1
          parts.append(f'M{x0} {y}h{x - x0}v1H{x0}z')
        else: x += 1
    if parts: out[k] = ''.join(parts)
  return out

order = ['d', 'w', 'b', 'n', 's', 'c', 'a', 'l', 'p', 'i']
svgs = {}
for name, g in icons.items():
  paths = to_paths(g)
  body = ''.join(f'<path fill="{C[k]}" d="{paths[k]}"/>' for k in order if k in paths)
  svgs[name] = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" shape-rendering="crispEdges">{body}</svg>'

json.dump(svgs, open(sys.argv[1], 'w'), ensure_ascii=False, indent=1)

S = 8
sheet = Image.new('RGB', (len(icons) * (24 * S + 16) + 16, 24 * S + 32), (26, 21, 35))
for i, (name, g) in enumerate(icons.items()):
  ox = 16 + i * (24 * S + 16)
  for y in range(24):
    for x in range(24):
      k = g[y][x]
      if k:
        col = tuple(int(C[k][j:j + 2], 16) for j in (1, 3, 5))
        for yy in range(S):
          for xx in range(S): sheet.putpixel((ox + x * S + xx, 16 + y * S + yy), col)
sheet.save(sys.argv[2])
