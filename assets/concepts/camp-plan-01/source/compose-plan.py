"""Exact top-down Paper drawing from the frozen export; no raster art changes."""
import json
from pathlib import Path
ROOT = Path(__file__).parent
layout = json.loads((ROOT / 'layout.json').read_text())
nav = json.loads((ROOT / 'navigation.json').read_text())
metrics = json.loads((ROOT / 'metrics.json').read_text())
S = 20
X = lambda x: (x + 25.8) * S
Y = lambda y: (y + 32) * S
palette = dict(ground='#D5D2B3', outside='#C1CDB6', route='#BEA674', solid='#75876A', ink='#354B3D', anchor='#956B38', camera='#547B80')
svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="1032" height="1224" viewBox="0 0 1032 1224">', '<rect width="1032" height="1224" fill="#D7DDCB"/>']
for x0,x1,y0,y1 in layout['regions']:
 svg.append(f'<rect x="{X(x0-.5)}" y="{Y(y0-.5)}" width="{(x1-x0+1)*S}" height="{(y1-y0+1)*S}" fill="{palette["ground"]}"/>')
for p in nav['paving']:
 svg.append(f'<rect x="{X(p["x"]-.5)}" y="{Y(p["y"]-.5)}" width="20" height="20" fill="{palette["route"]}"/>')
# A subtle five-unit measuring grid, not an invented navigation topology.
for x in range(-20,21,5): svg.append(f'<path d="M{X(x)},80 V1140" stroke="#73806B" stroke-opacity=".13" stroke-width="1"/>')
for y in range(-25,26,5): svg.append(f'<path d="M76,{Y(y)} H956" stroke="#73806B" stroke-opacity=".13" stroke-width="1"/>')
tiles={(p['x'],p['y']) for p in nav['tiles']}; edges=[]
for x,y in tiles:
 for nx,ny,a,b in [(x-1,y,(x-.5,y-.5),(x-.5,y+.5)),(x+1,y,(x+.5,y-.5),(x+.5,y+.5)),(x,y-1,(x-.5,y-.5),(x+.5,y-.5)),(x,y+1,(x-.5,y+.5),(x+.5,y+.5))]:
  if (nx,ny) not in tiles: edges.append(f'M{X(a[0])},{Y(a[1])} L{X(b[0])},{Y(b[1])}')
svg.append(f'<path d="{" ".join(edges)}" fill="none" stroke="#79876A" stroke-width="1.5"/>')
for p in layout['setDressing']:
 c=p.get('collider')
 if c:
  border=p['id'].startswith('boundary-'); col='#65775E' if border else palette['solid']
  if 'radius' in c: shape=f'<circle cx="{X(c["x"])}" cy="{Y(c["y"])}" r="{c["radius"]*S}"'
  else:
   hw=c.get('halfWidth',c.get('halfSize')); hd=c.get('halfDepth',c.get('halfSize'))
   shape=f'<rect x="{X(c["x"]-hw)}" y="{Y(c["y"]-hd)}" width="{2*hw*S}" height="{2*hd*S}"'
  svg.append(shape+f' fill="{col}" stroke="#354B3D" stroke-width="1.3"/>')
 else:
  svg.append(f'<circle cx="{X(p["x"])}" cy="{Y(p["y"])}" r="10" fill="#A9BE97"/>')
 # All 198 sprite anchors are visible, including the materialized boundary.
 a,b=X(p['x']),Y(p['y']); length=3 if p['id'].startswith('boundary-') else 5
 svg.append(f'<path d="M{a-length},{b} h{2*length} M{a},{b-length} v{2*length}" stroke="{palette["anchor"]}" stroke-width="1.5"/>')
poly=' '.join(f'{X(p["x"])},{Y(p["y"])}' for p in metrics['camera']['groundViewport'])
svg.append(f'<polygon points="{poly}" fill="#547B80" fill-opacity=".045" stroke="#547B80" stroke-width="2.5" stroke-dasharray="10 7"/>')
for p in metrics['approaches'].values():
 svg.append(f'<circle cx="{X(p["x"])}" cy="{Y(p["y"])}" r="4" fill="#E3E4D8" stroke="#354B3D" stroke-width="1.5"/>')
# The labelled keys are native Paper text; SVG carries only precise geometry.
keys=[('01',5,-5,8.5,-7.5),('02',-6,4,-10,5),('03',-3,-2,-6,-4),('04',6,5,9,6.5),('05',0,3,1.5,.5),('06',4,5,4.5,8.5),('07',0,-22,3,-19.5),('08',0,-27,3,-28.5),('09',-3,2,-6.5,0),('10',-3.5,-22,-7,-23.5),('10',3.5,-22,7,-23.5)]
for n,x,y,lx,ly in keys:
 svg.append(f'<path d="M{X(x)},{Y(y)} L{X(lx)},{Y(ly)}" stroke="#354B3D" stroke-opacity=".6" stroke-width="1.2"/>')
 if n in ['05','06','07','08']: svg.append(f'<circle cx="{X(x)}" cy="{Y(y)}" r="5" fill="#354B3D"/>')
svg.append('<path d="M76 86 V36 l-8 13 M76 36 l8 13" stroke="#354B3D" stroke-width="2" fill="none"/>')
svg.append('<path d="M76 1164 v-12 m0 8 h100 m0 -8 v12 M126 1160 v-7" stroke="#354B3D" stroke-width="2" fill="none"/>')
svg.append('</svg>');(ROOT/'plan-map.svg').write_text('\n'.join(svg))
labels=[]
for n,x,y,lx,ly in keys:
 labels.append(f'<div layer-name="Ключ {n}" style="position:absolute;left:{X(lx)-14}px;top:{Y(ly)-14}px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:1.5px solid #354B3D;border-radius:50%;background-color:#E3E4D8;color:#242F2B;font-family:Golos Text;font-size:14px;line-height:18px;font-weight:600">{n}</div>')
(ROOT/'plan-keys.html').write_text('\n'.join(labels))
(ROOT/'plan-projection.json').write_text(json.dumps({'kind':'top-down','width':1032,'height':1224,'pixelsPerWorldUnit':20,'worldOriginPixel':[X(0),Y(0)],'orientation':'world -Y up; world +X right','sourceLayoutSha256':metrics['layoutSha256'],'keys':[dict(label=n,target=[x,y],labelWorld=[lx,ly]) for n,x,y,lx,ly in keys]},indent=2)+'\n')
print('Exact plan SVG, native keys and projection metadata generated.')
