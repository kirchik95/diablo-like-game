"""Gameplay diagrams for the three region-1 techniques.
Drawn at half resolution (1 px = 1u) and scaled x2, so lines and sprites keep the HUD pixel grid.
S = 32 half-res px per world unit, as nativePixelsPerUnit. World circle r -> ellipse (r*S, r*S/2).
Prints label anchors in full-resolution pixels."""
import json, math, sys
from PIL import Image, ImageDraw

ROOT = sys.argv[1]
OUT = sys.argv[2]
S = 32
W, H = 440, 230

NIGHT = (13, 10, 20); GROUND = (27, 22, 35); GRID = (40, 33, 51)
SPIRIT = (109, 214, 203); SPIRIT_L = (194, 240, 221); SPIRIT_D = (57, 124, 133)
CORAL = (239, 142, 131); CORAL_L = (248, 196, 171); AMBER = (229, 182, 110); AMBER_D = (143, 115, 79)
IVORY = (238, 224, 206); DIM = (133, 121, 143); MAG = (226, 84, 152); MAG_D = (120, 44, 86); STONE = (108, 97, 121)

ATLAS = {
  'monk': ('assets/game/pixel-v2/monk/manifest.json', 'monk', 'assets/game/pixel-v3/appearance/warm-shaved-wine.png'),
  'hound': ('assets/game/pixel-v2/hound-world/manifest.json', 'hound', 'assets/game/pixel-v2/hound-world/hound-v2.png'),
  'wraith': ('assets/game/pixel-v3/wraith/manifest.json', 'wraith', 'assets/game/pixel-v3/wraith/wraith.png'),
  'beetle': ('assets/game/pixel-v7/beetle/manifest.json', 'beetle', 'assets/game/pixel-v7/beetle/beetle.png'),
}
_cache = {}
def frame(kind, name, alpha=1.0, tint=None):
  if kind not in _cache:
    mf, key, png = ATLAS[kind]
    m = json.load(open(f'{ROOT}/{mf}'))[key]
    _cache[kind] = (m, Image.open(f'{ROOT}/{png}').convert('RGBA'))
  m, im = _cache[kind]
  i = m['frames'].index(name); c = m['cell']; cols = m['columns']
  fr = im.crop(((i % cols) * c, (i // cols) * c, (i % cols) * c + c, (i // cols) * c + c))
  if tint is not None:
    px = fr.load()
    for y in range(fr.height):
      for x in range(fr.width):
        r, g, b, a = px[x, y]
        if a: px[x, y] = tint + (a,)
  if alpha < 1:
    a = fr.getchannel('A').point(lambda v: int(v * alpha)); fr.putalpha(a)
  return fr, m['anchor']

def iso(o, dx, dy):
  """world offset (dx, dy) in units from screen origin o -> screen point"""
  return (o[0] + (dx - dy) * S / math.sqrt(2), o[1] + (dx + dy) * S / (2 * math.sqrt(2)))

def new():
  img = Image.new('RGBA', (W, H), GROUND + (255,))
  d = ImageDraw.Draw(img)
  # iso grid: lines of constant world x and y every 1 unit, through the canvas centre
  o = (W / 2, H / 2)
  for k in range(-14, 15):
    a = iso(o, k, -14); b = iso(o, k, 14); d.line([a, b], fill=GRID, width=1)
    a = iso(o, -14, k); b = iso(o, 14, k); d.line([a, b], fill=GRID, width=1)
  return img

def overlay(img):
  return Image.new('RGBA', img.size, (0, 0, 0, 0))

def ellipse_pts(c, r, a0=0, a1=360, step=1):
  pts = []
  for t in range(int(a0 * 4), int(a1 * 4) + 1, step):
    a = math.radians(t / 4)
    pts.append((round(c[0] + r * S * math.cos(a)), round(c[1] + r * S / 2 * math.sin(a))))
  out = []
  for p in pts:
    if not out or out[-1] != p: out.append(p)
  return out

def ring(d, c, r, col, dash=None, a0=0, a1=360):
  pts = ellipse_pts(c, r, a0, a1)
  for i, p in enumerate(pts):
    if dash and (i // dash[0]) % 2: continue
    d.point(p, fill=col)

def disc(img, c, r, col, alpha):
  lay = overlay(img); d = ImageDraw.Draw(lay)
  d.ellipse([c[0] - r * S, c[1] - r * S / 2, c[0] + r * S, c[1] + r * S / 2], fill=col + (alpha,))
  img.alpha_composite(lay)

def sector(img, c, r, ang, half, col, alpha):
  """ground sector around world angle ang (deg, screen-space ellipse param), +-half"""
  lay = overlay(img); d = ImageDraw.Draw(lay)
  pts = [c] + ellipse_pts(c, r, ang - half, ang + half)
  d.polygon(pts, fill=col + (alpha,))
  img.alpha_composite(lay)
  d2 = ImageDraw.Draw(img)
  for p in ellipse_pts(c, r, ang - half, ang + half): d2.point(p, fill=col)
  for a in (ang - half, ang + half):
    e = (c[0] + r * S * math.cos(math.radians(a)), c[1] + r * S / 2 * math.sin(math.radians(a)))
    d2.line([c, e], fill=col)

def dotted(d, a, b, col, on=2, off=2):
  n = int(max(abs(b[0] - a[0]), abs(b[1] - a[1])))
  for i in range(n + 1):
    if (i % (on + off)) < on:
      d.point((round(a[0] + (b[0] - a[0]) * i / n), round(a[1] + (b[1] - a[1]) * i / n)), fill=col)

def arrow(d, a, b, col, head=4, dots=False):
  if dots: dotted(d, a, b, col)
  else: d.line([a, b], fill=col)
  ang = math.atan2(b[1] - a[1], b[0] - a[0])
  for s in (-1, 1):
    e = (b[0] - head * math.cos(ang + s * .5), b[1] - head * math.sin(ang + s * .5))
    d.line([b, e], fill=col)

def shadow(img, c, rx, ry, alpha=150):
  lay = overlay(img); d = ImageDraw.Draw(lay)
  d.ellipse([c[0] - rx, c[1] - ry, c[0] + rx, c[1] + ry], fill=NIGHT + (alpha,))
  img.alpha_composite(lay)

def put(img, kind, name, feet, alpha=1.0, lift=0, tint=None, flip=False):
  fr, (ax, ay) = frame(kind, name, alpha, tint)
  if flip:
    fr = fr.transpose(Image.FLIP_LEFT_RIGHT); ax = fr.width - ax
  img.alpha_composite(fr, (round(feet[0] - ax), round(feet[1] - ay - lift)))

def palm(d, c, col=SPIRIT, core=CORAL):
  x, y = round(c[0]), round(c[1])
  d.rectangle([x - 3, y - 3, x + 1, y + 2], fill=col)
  for k, ln in enumerate((3, 4, 4, 3)):
    d.line([(x + 2, y - 3 + k * 1.6), (x + 2 + ln, y - 3 + k * 1.6)], fill=col)
  d.rectangle([x - 2, y - 1, x - 1, y], fill=core)

def tick(d, a, b, col, label_pos=None):
  d.line([a, b], fill=col)
  for p in (a, b): d.line([(p[0], p[1] - 3), (p[0], p[1] + 3)], fill=col)

labels = {}
def lab(name, key, p): labels.setdefault(name, {})[key] = [round(p[0] * 2), round(p[1] * 2)]

def save(img, name):
  img.resize((W * 2, H * 2), Image.NEAREST).save(f'{OUT}/{name}.png')

# ---------------- A. Ладонь духа ----------------
img = new(); d = ImageDraw.Draw(img)
M = (58, 118)
WR = (M[0] + 6 * S, M[1])                       # wraith 6 units along the screen-horizontal line
disc(img, WR, 5.5, MAG, 18); ring(d, WR, 5.5, MAG, dash=(3, 3))
BE = iso(M, 4.0, 1.6)                           # beetle on a lower lane, facing the monk
ang_to_monk = math.degrees(math.atan2((M[1] - BE[1]) * 2, M[0] - BE[0]))
sector(img, BE, 1.2, ang_to_monk, 60, MAG, 46)
# palm lane A: ghost palms, impact at the wraith
end7 = (M[0] + 7 * S, M[1])
dotted(d, (M[0] + 10, M[1] - 10), (WR[0] - 8, WR[1] - 10), SPIRIT)
for t in (0.25, 0.5, 0.75):
  palm(d, (M[0] + 12 + (WR[0] - 22 - M[0]) * t, M[1] - 10), col=SPIRIT_D if t < .7 else SPIRIT)
palm(d, (WR[0] - 16, WR[1] - 10))
# wraith orb flying toward the monk, falling short
orb = (WR[0] - 70, WR[1] - 26)
d.ellipse([orb[0] - 3, orb[1] - 3, orb[0] + 3, orb[1] + 3], fill=MAG); d.point(orb, fill=(255, 190, 220))
arrow(d, (orb[0] - 6, orb[1]), (orb[0] - 26, orb[1]), MAG)
# range ticks under the lane
TY = 204
for x in (M[0], end7[0]): dotted(d, (x, M[1] + 8), (x, TY - 4), AMBER_D, 1, 3)
for x in (WR[0] - 5.5 * S, WR[0]): dotted(d, (x, M[1] + 8), (x, TY + 8), MAG_D, 1, 3)
tick(d, (M[0], TY), (end7[0], TY), AMBER)
tick(d, (WR[0] - 5.5 * S, TY + 12), (WR[0], TY + 12), MAG)
# palm lane B toward the beetle front: blocked
pB0 = (M[0] + 10, M[1] - 6); pB1 = (BE[0] - 16, BE[1] - 16)
dotted(d, pB0, pB1, SPIRIT_D)
palm(d, (pB1[0] - 2, pB1[1]), col=DIM, core=DIM)
for k in range(5):
  a = math.radians(k * 72); d.point((round(pB1[0] + 6 + 5 * math.cos(a)), round(pB1[1] + 5 * math.sin(a))), fill=STONE)
shadow(img, M, 10, 4); shadow(img, WR, 7, 3); shadow(img, BE, 18, 7)
put(img, 'beetle', 'front-block-01', BE, flip=True)
put(img, 'wraith', 'front-idle-01', WR, lift=4)
put(img, 'monk', 'attack1-front-03', M, flip=True)
d = ImageDraw.Draw(img)
hx, hy = WR[0] - 10, WR[1] - 12
for a in range(0, 360, 45):
  r = 7 if a % 90 == 0 else 4
  d.line([(hx, hy), (hx + r * math.cos(math.radians(a)), hy + r * math.sin(math.radians(a)))], fill=CORAL)
d.point((hx, hy), fill=IVORY)
lab('palm', 'monk', (M[0], M[1] + 6)); lab('palm', 'wraith', WR); lab('palm', 'beetle', BE)
lab('palm', 'range7', ((M[0] + end7[0]) / 2, TY)); lab('palm', 'range55', (WR[0] - 2.75 * S, TY + 12))
lab('palm', 'end7', end7); lab('palm', 'orb', orb); lab('palm', 'blocked', pB1); lab('palm', 'hit', (WR[0] - 10, WR[1] - 12))
save(img, 'diagram-spirit-palm')

# ---------------- B. Прыжок журавля ----------------
img = new(); d = ImageDraw.Draw(img)
M = (70, 140)
L = (M[0] + 5 * S, M[1])                        # landing 5 units away, behind the beetle
BE = (M[0] + 3.3 * S, M[1] - 16)                # beetle faces the monk (front sector to the left)
ring(d, M, 5, AMBER_D, dash=(2, 3)); ring(d, M, 1.5, AMBER_D, dash=(2, 3))
sector(img, BE, 1.2, 180, 60, MAG, 46)
disc(img, L, 1.6, SPIRIT, 30); ring(d, L, 1.6, SPIRIT); ring(d, (L[0], L[1] + 1), 1.6, SPIRIT_D, a0=20, a1=160)
# trajectory: parabola, sprite offset only (ground is flat)
pts = []
for i in range(41):
  t = i / 40; x = M[0] + (L[0] - M[0]) * t; y = M[1] - 4 * 44 * t * (1 - t) - 18
  pts.append((x, y))
for i, p in enumerate(pts):
  if i % 3 == 0: d.point((round(p[0]), round(p[1])), fill=SPIRIT_L)
# contact shadow runs along the ground and shrinks at the apex
for t in (0.2, 0.35, 0.5, 0.65, 0.8):
  s = 1 - 0.55 * (1 - abs(t - .5) * 2)
  shadow(img, (M[0] + (L[0] - M[0]) * t, M[1]), 9 * s, 3.5 * s, 170)
# hounds around the landing point, knockback arrows
H1 = iso(L, 1.9, -0.5); H3 = iso(L, 3.2, 0.9)
for h in (H1,):
  v = (h[0] - L[0], h[1] - L[1]); n = math.hypot(*v)
  arrow(d, (h[0] + v[0] / n * 14, h[1] + v[1] / n * 6), (h[0] + v[0] / n * 30, h[1] + v[1] / n * 12), CORAL)
shadow(img, M, 10, 4, 120); shadow(img, BE, 18, 7)
for h in (H1, H3): shadow(img, h, 12, 4)
put(img, 'monk', 'idle-front-01', M, alpha=.38)
put(img, 'beetle', 'front-idle-01', BE, flip=True)
put(img, 'hound', 'front-idle-01', H3, alpha=.45, flip=True); put(img, 'hound', 'front-run-02', H1, flip=True)
apex = pts[20]
put(img, 'monk', 'dash-front-03', (apex[0], apex[1] + 26))
put(img, 'monk', 'attack3-front-03', L, flip=True)
d = ImageDraw.Draw(img)
arrow(d, (L[0] - 14, L[1] - 30), (BE[0] + 26, BE[1] - 26), CORAL)
d = ImageDraw.Draw(img)
lab('crane', 'start', M); lab('crane', 'land', L); lab('crane', 'beetle', BE); lab('crane', 'apex', apex)
lab('crane', 'r5', iso(M, 3.5, 3.5)); lab('crane', 'r15', (M[0], M[1] + 24)); lab('crane', 'hounds', H1); lab('crane', 'h3', H3)
save(img, 'diagram-crane-leap')

# ---------------- C. Отражение ----------------
img = new(); d = ImageDraw.Draw(img)
M = (214, 132)
disc(img, M, 1.2, SPIRIT, 34); ring(d, M, 1.2, SPIRIT)
# 1: hound leap from the left -> deflected
HD = (M[0] - 2.6 * S, M[1] + 6)
d.rectangle([HD[0] + 14, HD[1] - 3, M[0] - 34, HD[1] - 1], fill=MAG_D)
arrow(d, (HD[0] + 14, HD[1] - 2), (M[0] - 32, M[1] - 2), MAG)
# 2: wraith shot from the right -> returns as a turquoise orb
WR = (M[0] + 5 * S, M[1] - 8)
inc_y = WR[1] - 22; ret_y = WR[1] - 12
arrow(d, (WR[0] - 12, inc_y), (M[0] + 30, inc_y + 6), MAG, dots=True)
d.ellipse([M[0] + 40, inc_y + 1, M[0] + 46, inc_y + 7], fill=MAG)
arrow(d, (M[0] + 30, ret_y + 10), (WR[0] - 14, ret_y), SPIRIT)
d.ellipse([WR[0] - 40, ret_y - 1, WR[0] - 34, ret_y + 5], fill=SPIRIT); d.point((WR[0] - 37, ret_y + 2), fill=SPIRIT_L)
# 3: beetle swing from above-left -> раскол
BE = iso(M, -1.6, -0.9)
disc(img, BE, 1.3, MAG, 22)
shadow(img, M, 10, 4); shadow(img, HD, 12, 4); shadow(img, WR, 7, 3); shadow(img, BE, 18, 7)
put(img, 'beetle', 'front-windup-03', BE)
put(img, 'hound', 'front-attack-03', HD, flip=True)
put(img, 'wraith', 'front-attack-03', WR, lift=4)
put(img, 'monk', 'idle-front-01', M)
d = ImageDraw.Draw(img)
# coral flashes at the three contact points
for p in ((M[0] - 30, M[1] - 18), (M[0] + 24, inc_y + 8), (M[0] - 10, M[1] - 44)):
  x, y = p
  d.line([(x - 4, y), (x + 4, y)], fill=CORAL); d.line([(x, y - 4), (x, y + 4)], fill=CORAL); d.point((x, y), fill=IVORY)
lab('deflect', 'monk', M); lab('deflect', 'hound', HD); lab('deflect', 'wraith', WR); lab('deflect', 'beetle', BE)
lab('deflect', 'ring', (M[0] + 1.2 * S, M[1])); lab('deflect', 'flash1', (M[0] - 30, M[1] - 18)); lab('deflect', 'ret', (WR[0] - 37, ret_y)); lab('deflect', 'flash3', (M[0] - 10, M[1] - 44))
save(img, 'diagram-deflect')

print(json.dumps(labels, ensure_ascii=False))
