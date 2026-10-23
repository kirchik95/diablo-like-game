// One shared placement contract for the courtyard's gameplay, rendering and
// tests, in the courtyard's local coordinates (OVERWORLD moves the zone by
// y -85). Like CAMP_LAYOUT: x/y register the sprite's lower anchor;
// collider(s) are absolute ground centres whose sizes already include scale.
import panoramaPackage from '../assets/game/pixel-v9/camp-panorama/manifest.json' with { type: 'json' };
import ruinsPackage from '../assets/game/pixel-v11/monastery-ruins/manifest.json' with { type: 'json' };
import { isWalkable, clearLine } from './world.js';

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const diagonalPixels = 32 * Math.SQRT2;
const key = (x, y) => `${x},${y}`;
const hash = (x, y, salt) => {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
const toWorld = (du, dv) => ({ x: (2 * dv - du) / diagonalPixels, y: (2 * dv + du) / diagonalPixels });

// Atlases and their footprint contracts. A kind is looked up in order. The
// ruins add `colliders`: one box per arm of an L corner and per arch pier.
const ATLASES = [
  { id: 'monasteryRuins', anchor: ruinsPackage.monasteryRuins.anchor, footprints: ruinsPackage.footprints },
  { id: 'campPanorama', anchor: panoramaPackage.campPanorama.anchor, footprints: panoramaPackage.footprints },
];
const footprintOf = kind => {
  for (const atlas of ATLASES) if (atlas.footprints[kind]) return { atlas, f: atlas.footprints[kind] };
  throw new Error(`Unknown courtyard prop: ${kind}`);
};
// Two organic ('loose') ruin frames draw a smaller heap than their footprint
// box. Colliders measured on the drawing: every front and side approach stops
// within 1.6 px of an opaque pixel, and on the front no stone reaches past
// the stop point (tests/courtyard-layout.test.js).
const DRAWN_BASE = {
  'column-drums': { x: 0, y: -.2, halfWidth: 1.5, halfDepth: .3 },
  'fallen-blocks': { x: 0, y: 0, halfWidth: .62, halfDepth: .8 },
};
// The authored footprint contract of a frame kind, or null (braziers).
export const courtyardFootprint = kind => ATLASES.find(atlas => atlas.footprints[kind])?.footprints[kind] ?? null;

// The road seam (world y -70.5). Road-area props own everything beyond it.
export const COURTYARD_SEAM = 14.5;
// The cloister, a 17×20 rectangle inside its walls, and the road mouth.
const regionsIn = [[-8, 8, -11, 8], [-3, 3, 9, 14]];
const tiles = new Map();
for (const [x0, x1, y0, y1] of regionsIn) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.set(key(x, y), { x, y });
// The road mouth stays open between its verges up to the seam.
const corridor = (x, y) => y > 8.6 && Math.abs(x) < 3.7;

const setDressing = [];
const ids = new Map();
// The pink pair flanks the dais on screen (at the source's screen depth, 3u
// to each side): behind it, the tall v11 obelisk would seem to carry a bowl.
const braziers = [{ x: 2.12, y: -8.12, color: 'pink' }, { x: -2.12, y: -3.88, color: 'pink' },
  { x: -6, y: 1, color: 'cyan' }, { x: 6, y: 1, color: 'cyan' }];
const pick = (n, table) => {
  let total = 0;
  for (const [kind, weight] of table) if ((total += weight) > n) return kind;
  return table.at(-1)[0];
};
function put(kind, cx, cy, { scale = 1, flip = false, id, radius, layer } = {}) {
  const { atlas, f } = footprintOf(kind), mirror = flip ? -1 : 1;
  const offset = toWorld((f.contactCenter[0] - atlas.anchor[0]) * scale * mirror, (f.contactCenter[1] - atlas.anchor[1]) * scale);
  const flat = layer === 'ground' || f.role === 'flat' || f.role === 'overlay';
  // A mirrored isometric drawing exchanges the world x and y extents.
  const swap = (w, d) => ({ halfWidth: (flip ? d : w) * scale, halfDepth: (flip ? w : d) * scale });
  const area = f.shape === 'circle' ? null : swap(f.halfWidth, f.halfDepth);
  const count = (ids.get(kind) ?? 0) + 1;
  ids.set(kind, count);
  const p = { id: id ?? `${kind}-${count}`, kind, x: cx - offset.x, y: cy - offset.y, scale, flip,
    ...(f.standOn ? { standOn: f.standOn * scale } : {}),
    // A dais publishes its rim (top height, inner socket and outer half size),
    // where the ritual bindings lie.
    ...(f.socket ? { rim: { height: f.height * scale, inner: f.socket.halfWidth * scale, outer: f.halfWidth * scale } } : {}) };
  if (flat) Object.assign(p, { layer: 'ground', contact: { x: cx, y: cy }, ...(area ? { area } : {}) });
  else if (DRAWN_BASE[kind] && !flip) {
    const b = DRAWN_BASE[kind];
    p.contact = { x: cx, y: cy };
    p.collider = { x: cx + b.x * scale, y: cy + b.y * scale, halfWidth: b.halfWidth * scale, halfDepth: b.halfDepth * scale };
  } else if (f.colliders) {
    // One collider per arm or pier: the arch's opening stays walkable.
    p.contact = { x: cx, y: cy };
    p.colliders = f.colliders.map(b => ({ x: cx + (flip ? b.y : b.x) * scale, y: cy + (flip ? b.x : b.y) * scale,
      ...swap(b.halfWidth, b.halfDepth) }));
  } else p.collider = { x: cx, y: cy, ...(area ?? { radius: (radius ?? f.radius) * scale }) };
  setDressing.push(p);
  return p;
}
// Ground extents of a prop: its colliders, or its drawn footprint.
const extentsOf = p => {
  if (p.colliders) return p.colliders.map(c => ({ x: c.x, y: c.y, rx: c.halfWidth, ry: c.halfDepth }));
  const c = p.collider ?? (p.area && { ...p.contact, ...p.area }) ?? p.contact;
  if (c.halfWidth !== undefined) return [{ x: c.x, y: c.y, rx: c.halfWidth, ry: c.halfDepth }];
  const r = c.radius ?? sizeOf(p);
  return [{ x: c.x, y: c.y, rx: r, ry: r }];
};
function sizeOf(p) {
  const { f } = footprintOf(p.kind);
  return (f.shape === 'circle' ? f.radius : Math.max(f.halfWidth, f.halfDepth)) * p.scale;
}
const gap = (p, x, y) => Math.min(...extentsOf(p).map(e => Math.hypot(Math.max(0, Math.abs(x - e.x) - e.rx),
  Math.max(0, Math.abs(y - e.y) - e.ry))));

// Ruined walls stand just outside the cloister. Back walls (min x and min y,
// the top of the screen) show their inner face and stand tall; the front
// walls (max x and max y) would hide the hero, so they are low parapets.
// `line` is the inner face; pieces run from `from` along +x or +y.
function wallRun(side, along, line, normal, from, pieces) {
  let at = from, index = 0;
  for (const step of pieces) {
    if (typeof step === 'number') { at += step; continue; }
    const [kind, scale = 1] = step, { f } = footprintOf(kind);
    const half = (along === 'x' ? f.halfWidth : f.halfDepth) * scale, depth = (along === 'x' ? f.halfDepth : f.halfWidth) * scale;
    const centre = at + half, off = line + normal * depth;
    put(kind, along === 'x' ? centre : off, along === 'x' ? off : centre, { scale, id: `wall-${side}-${index++}` });
    at = centre + half;
  }
}
// Corners: the inner back corner L at the top of the screen, the outer front
// corner L at the bottom, a broken stump on the right; the north wall's
// crumbling head turns the left corner.
put('wall-corner', -7.8, -10.8, { id: 'corner-back' });
put('parapet-corner', 7.6, 7.6, { id: 'corner-front' });
put('corner-stump', -9.25, 9.25, { id: 'corner-right' });
// North (min y): behind the arch, a breach and a broken end at the left corner.
wallRun('north', 'x', -11.5, -1, -6.3, [['wall-run-x'], .3, ['wall-breach-x'], .4, ['wall-window-x'], .3, ['wall-end-x']]);
// The long back wall (min x) steps down toward the road side.
wallRun('back', 'y', -8.5, -1, -9.3, [['wall-run-y'], .3, ['wall-window-y'], .9, ['wall-run-y'], .6, ['wall-end-y']]);
// Front (max x) and south (max y): low parapets, some broken in two, with
// gaps of rubble.
wallRun('front', 'y', 8.5, 1, -11.3, [['parapet-y'], .8, ['parapet-broken-y'], 1.1, ['parapet-y'], .5, ['parapet-broken-y']]);
wallRun('south-left', 'x', 8.5, 1, -8.5, [['parapet-broken-x']]);
put('rubble-small', -5, 8.95, { id: 'wall-south-left-rubble' });
// A broken parapet's bare middle opens onto the meadow; a shrub closes it.
for (const p of setDressing.filter(p => p.kind.startsWith('parapet-broken-'))) {
  const [a, b] = p.colliders, alongX = p.kind.endsWith('-x');
  const mid = alongX ? (a.x + a.halfWidth + b.x - b.halfWidth) / 2 : (a.y + a.halfDepth + b.y - b.halfDepth) / 2;
  const out = (alongX ? a.y + a.halfDepth : a.x + a.halfWidth) + .55;
  put('bush-round', alongX ? mid : out, alongX ? out : mid, { scale: .8, id: `${p.id}-shrub` });
}
put('rubble-pile', 5.35, 9.3, { id: 'wall-south-right-0' });
// Broken gate posts frame the road mouth.
for (const [i, x] of [[0, -4], [1, 4]]) put('column-broken', x, 9, { id: `gate-post-${i}` });
// The open arch stands free behind the source, the last of a lost facade.
put('arch-gate', 0, -9.6, { id: 'arch' });
// The source stands in the socket of its low octagonal dais. No collider:
// melee needs a clear line to the source's own body. The renderer swaps the
// rune frame in while the guards hold the seal.
put('ritual-plinth', 0, -6, { id: 'ritual-plinth', layer: 'ground' });

// The colonnade keeps its four columns. Only the one behind the source stands
// whole; the others are broken, so none of them covers the source on screen.
const columns = [[-5, -3, 3.27], [5, -3, 1.9], [-5, 4, 1.9], [5, 4, 1.9]];
for (const [i, [x, y, height]] of columns.entries()) {
  put(height > 2 ? 'column-intact' : 'column-broken', x, y, { id: `column-${i}` });
}
// Fallen masonry by the walls, outside the guards' gathering areas, and
// toppled drums in the grass behind the breach.
for (const [kind, x, y] of [['fallen-lintel', 5.8, -10.35], ['fallen-blocks', -6.9, 6.9], ['fallen-block', 7.4, -1.2],
  ['rubble-pile', -7.3, -6.8], ['column-drums', .4, -13.9], ['fallen-block', -2.6, -13.4]]) put(kind, x, y);
// Flat ruin decals break the 4u repeat of the flagstone surface: cracks,
// moss, loose slabs and grit on a jittered grid. They lie under every actor
// and combat tell and keep off the dais and the brazier feet.
const decalAreas = [];
for (let row = 0, gy = -10.2; gy <= 7.6; row++, gy += 2.55) for (let gx = -7 + (row % 2) * 1.3; gx <= 7.2; gx += 2.6) {
  const ix = Math.round(gx * 10), iy = Math.round(gy * 10);
  if (hash(ix, iy, 71) < .32) continue;
  const x = gx + (hash(ix, iy, 72) - .5) * 1.4, y = gy + (hash(ix, iy, 73) - .5) * 1.4;
  const kind = pick(hash(ix, iy, 74), [['flagstone-cracks', .38], ['moss-patch', .26], ['flagstones-broken', .22], ['rubble-scatter', .14]]);
  const { f } = footprintOf(kind);
  const clearOf = (cx, cy, r) => Math.hypot(Math.max(0, Math.abs(cx - x) - f.halfWidth), Math.max(0, Math.abs(cy - y) - f.halfDepth)) > r;
  if (!clearOf(0, -6, 1.7) || !braziers.every(b => clearOf(b.x, b.y, .5))) continue;
  if (decalAreas.some(a => Math.abs(a.x - x) < a.w + f.halfWidth - .4 && Math.abs(a.y - y) < a.d + f.halfDepth - .4)) continue;
  decalAreas.push({ x, y, w: f.halfWidth, d: f.halfDepth });
  put(kind, x, y);
}

// A visible blocker stands near every edge of the walk mask. Fill only
// uncovered edges, just outside the mask, with rubble and shrubs.
const edges = [];
for (const p of tiles.values()) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
  if (!tiles.has(key(p.x + dx, p.y + dy)) && !(p.y + dy > COURTYARD_SEAM)) edges.push({ x: p.x, y: p.y, dx, dy });
}
edges.sort((a, b) => a.y - b.y || a.x - b.x || a.dy - b.dy || a.dx - b.dx);
for (const e of edges) {
  const x = e.x + e.dx * .5, y = e.y + e.dy * .5;
  if (setDressing.some(p => gap(p, x, y) < 1.15)) continue;
  const n = hash(e.x * 2 + e.dx, e.y * 2 + e.dy, 11), tangent = (hash(e.x, e.y, 12) - .5) * .5;
  // Wall gaps fill with rubble and shrubs; the road verges with shrubs and stone.
  const kind = e.y > 8 ? (n < .55 ? 'bush-round' : n < .8 ? 'boulder-round' : 'bush-large')
    : n < .3 ? 'rubble-pile' : n < .42 ? 'rubble-small' : n < .55 ? 'fallen-block' : n < .85 ? 'bush-round' : 'bush-large';
  // Ruin art keeps its native pixels; only the v9 country varies in size.
  const scale = ruinsPackage.footprints[kind] ? 1 : (kind === 'bush-large' ? .75 : .85) + hash(e.x, e.y, 13) * .25;
  const reach = { 'bush-round': .7, 'boulder-round': .62, 'rubble-pile': .8, 'rubble-small': .45, 'fallen-block': .5,
    'bush-large': 1.1 }[kind] * scale;
  put(kind, x + e.dx * (reach + .05) - e.dy * tangent, y + e.dy * (reach + .05) + e.dx * tangent,
    { scale, flip: !ruinsPackage.footprints[kind] && hash(e.x, e.y, 14) > .5, id: `boundary-${e.x},${e.y},${e.dx},${e.dy}` });
}

// Grass and ferns grow from the joints at the wall feet and around the
// columns, never on the processional path or by the ritual and braziers.
const edgeDistance = (x, y) => {
  for (let r = 1; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (!tiles.has(key(Math.round(x + dx), Math.round(y + dy)))) return Math.hypot(dx, dy);
  }
  return 4;
};
for (let y = -11; y <= 8; y++) for (let x = -8; x <= 8; x++) {
  if (hash(x, y, 21) < .45) continue;
  const px = x + (hash(x, y, 22) - .5) * .9, py = y + (hash(x, y, 23) - .5) * .9;
  if (!tiles.has(key(Math.round(px), Math.round(py))) || Math.abs(px) < 1.9 && py > -8) continue;
  const nearColumn = columns.some(([cx, cy]) => Math.hypot(px - cx, py - cy) < 1.6);
  if (edgeDistance(px, py) > 1.5 && !nearColumn) continue;
  if (Math.hypot(px, py + 6) < 2.8 || braziers.some(b => Math.hypot(px - b.x, py - b.y) < 1)) continue;
  if (setDressing.some(p => gap(p, px, py) < .35)) continue;
  put(hash(x, y, 24) < .65 ? 'grass-tuft' : 'fern-tuft', px, py, { scale: .75 + hash(x, y, 25) * .35, flip: hash(x, y, 26) > .5 });
}

// Distance from the walk mask over the surrounding grid, for the outer country.
const reachGrid = new Map([...tiles.values()].map(p => [key(p.x, p.y), 0]));
const reachQueue = [...tiles.values()];
for (let i = 0; i < reachQueue.length; i++) {
  const p = reachQueue[i], d = reachGrid.get(key(p.x, p.y)) + 1;
  if (d > 26) continue;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const id = key(p.x + dx, p.y + dy);
    if (!reachGrid.has(id)) { reachGrid.set(id, d); reachQueue.push({ x: p.x + dx, y: p.y + dy }); }
  }
}
const contactOf = p => p.collider ?? p.contact;
const clear = (x, y, radius, own) => setDressing.every(p => {
  if (own?.includes(p)) return true;
  const c = contactOf(p);
  return !c || Math.hypot(c.x - x, c.y - y) >= radius + sizeOf(p) + .25;
});
const shapes = {
  'cypress-tall': .5, 'cypress-medium': .42, 'cypress-pair': .8, 'bush-large': 1.1, 'bush-round': .7,
  'outcrop-cluster': 1.3, 'outcrop-pair': 1.1, 'outcrop-cliff': 1.6, 'outcrop-slab': 1.4,
  'boulder-round': .6, 'outcrop-crag': 1.2, 'outcrop-ledge-x': 1.6,
  'dead-tree': .5, 'dead-tree-snag': .4, 'fallen-block': .7, 'ivy-clump': .5, 'rubble-pile': .9, 'rubble-small': .5,
};
const grow = (kind, x, y, scale, flip, id, own) => {
  if (!clear(x, y, shapes[kind] * scale, own) || corridor(x, y) || y > COURTYARD_SEAM - .9) return null;
  if ((reachGrid.get(key(Math.round(x), Math.round(y))) ?? 99) < 2) return null;
  return put(kind, x, y, { scale, flip, id });
};
// Screen depth to playable ground straight behind a point (up the screen).
// Tall props there would hide the hero, so the near side stays low.
const groundBehind = (x, y) => {
  for (let k = 1; k <= 18; k++) if (tiles.has(key(Math.round(x - k * Math.SQRT1_2), Math.round(y - k * Math.SQRT1_2)))) return k;
  return Infinity;
};

// Stone masses continue as short runs along the walk mask's contour, as in
// the camp, so the country reads as outcrops instead of scattered blocks.
const stoneKinds = ['outcrop-cluster', 'outcrop-pair', 'outcrop-ledge-x', 'outcrop-crag', 'outcrop-cliff', 'outcrop-slab'];
const runTable = behind => behind < 6 ? [['outcrop-ledge-x', .55], ['outcrop-pair', .25], ['outcrop-slab', .2]]
  : behind < 17 ? [['outcrop-ledge-x', .35], ['outcrop-pair', .25], ['outcrop-cluster', .25], ['outcrop-crag', .15]]
  : [['outcrop-ledge-x', .25], ['outcrop-cluster', .25], ['outcrop-crag', .2], ['outcrop-cliff', .15], ['outcrop-pair', .15]];
// Half-length of a piece along world x or y; a mirror exchanges the axes.
const halfAlong = (kind, flip, alongX) => {
  const { f } = footprintOf(kind);
  return alongX !== flip ? f.halfWidth : f.halfDepth;
};
function stoneRun(first, ix, iy) {
  const c = first.collider ?? first.contact, distance = (x, y) => reachGrid.get(key(Math.round(x), Math.round(y))) ?? 30;
  const gx = distance(c.x + 1, c.y) - distance(c.x - 1, c.y), gy = distance(c.x, c.y + 1) - distance(c.x, c.y - 1);
  const alongX = gx || gy ? Math.abs(gy) >= Math.abs(gx) : hash(ix, iy, 51) < .5;
  const sign = hash(ix, iy, 52) < .5 ? -1 : 1, run = [first];
  let prev = first, at = { x: c.x, y: c.y };
  for (let k = 1, count = 1 + Math.floor(hash(ix, iy, 53) * 3); k <= count; k++) {
    const kind = pick(hash(ix + k, iy, 54), runTable(groundBehind(at.x, at.y)));
    // Long pieces lie along the run: ledges mirror onto world y for a y run.
    const flip = kind === 'outcrop-ledge-x' ? !alongX : hash(ix, iy + k, 55) > .5;
    const scale = .85 + hash(ix, iy, 56 + k) * .25;
    const step = (halfAlong(prev.kind, prev.flip, alongX) * prev.scale + halfAlong(kind, flip, alongX) * scale) * .78;
    const side = (hash(ix - k, iy, 57) - .5) * .6;
    const x = at.x + (alongX ? sign * step : side), y = at.y + (alongX ? side : sign * step);
    if (/cliff|crag|cluster/.test(kind) && groundBehind(x, y) < (kind === 'outcrop-cluster' ? 6 : 17)) break;
    const piece = grow(kind, x, y, scale, flip, `grove-${ix},${iy}-run${k}`, run);
    if (!piece) break;
    run.push(piece);
    prev = piece; at = { x, y };
  }
}

// The monastery spills into the meadow: fallen masonry, ivy and the old
// courtyard's dead trees, a few cells beyond the walls. Native size only.
for (let row = 0, gy = -18; gy <= COURTYARD_SEAM; row++, gy += 3.1) for (let gx = -15 + (row % 2) * 1.5; gx <= 15; gx += 3.1) {
  const ix = Math.round(gx * 10), iy = Math.round(gy * 10);
  const x = gx + (hash(ix, iy, 61) - .5) * 2.4, y = gy + (hash(ix, iy, 62) - .5) * 2.4;
  const d = reachGrid.get(key(Math.round(x), Math.round(y)));
  if (d === undefined || d < 2 || d > 6 || hash(ix, iy, 63) > .34) continue;
  const kind = pick(hash(ix, iy, 64), groundBehind(x, y) < 6 ? [['fallen-block', .35], ['rubble-pile', .25], ['rubble-small', .15], ['ivy-clump', .25]]
    : [['dead-tree', .25], ['dead-tree-snag', .2], ['fallen-block', .2], ['ivy-clump', .2], ['rubble-pile', .15]]);
  grow(kind, x, y, 1, false, `spill-${ix},${iy}`);
}

// Outer country: the camp's stone masses, cypress groves and shrubs. Rows
// are staggered and jittered by most of a cell, so no grid lines show.
for (let row = 0, gy = -38; gy <= COURTYARD_SEAM; row++, gy += 2.4) for (let gx = -34 + (row % 2) * 1.2; gx <= 34; gx += 2.4) {
  const ix = Math.round(gx * 10), iy = Math.round(gy * 10);
  const x = gx + (hash(ix, iy, 41) - .5) * 2.2, y = gy + (hash(ix, iy, 42) - .5) * 2.2;
  const d = reachGrid.get(key(Math.round(x), Math.round(y)));
  if (d === undefined || d < 2 || hash(ix, iy, 43) > (d < 6 ? .8 : d < 12 ? .62 : .4)) continue;
  const behind = groundBehind(x, y);
  const table = behind < 6 ? [['bush-round', .5], ['bush-large', .3], ['outcrop-slab', .07], ['boulder-round', .05],
    ['outcrop-ledge-x', .08]]
    : behind < 17 ? [['bush-round', .34], ['bush-large', .34], ['outcrop-pair', .07], ['outcrop-ledge-x', .1],
      ['outcrop-cluster', .09], ['boulder-round', .03], ['outcrop-crag', .03]]
    : [['cypress-tall', .22], ['cypress-medium', .2], ['cypress-pair', .1], ['bush-large', .18], ['bush-round', .14],
      ['outcrop-cliff', .06], ['outcrop-crag', .06], ['outcrop-cluster', .04]];
  const kind = pick(hash(ix, iy, 44), table);
  const placed = grow(kind, x, y, .8 + hash(ix, iy, 45) * .35, hash(ix, iy, 46) > .5, `grove-${ix},${iy}`);
  // Runs grow only away from the walk mask, where a wall of rock reads as country.
  if (placed && stoneKinds.includes(kind) && d >= 4 && hash(ix, iy, 50) < .75) stoneRun(placed, ix, iy);
}

// Only blockers that can touch the walk mask take part in collision; distant
// scenery stays visual and keeps per-step collision checks short.
for (const p of setDressing) {
  const c = p.collider;
  if (!c || /^column-\d+$/.test(p.id)) continue;
  const rx = c.radius ?? c.halfWidth, ry = c.radius ?? c.halfDepth;
  let near = false;
  for (let y = Math.floor(c.y - ry - 1.5); y <= Math.ceil(c.y + ry + 1.5) && !near; y++) {
    for (let x = Math.floor(c.x - rx - 1.5); x <= Math.ceil(c.x + rx + 1.5); x++) {
      if (tiles.has(key(x, y)) && Math.hypot(Math.max(0, Math.abs(x - c.x) - rx), Math.max(0, Math.abs(y - c.y) - ry)) < 1.2) { near = true; break; }
    }
  }
  // A measured collider may sit off the footprint centre; keep that centre.
  if (!near) { p.contact ??= { x: c.x, y: c.y }; delete p.collider; }
}

// The renderer draws the braziers from `braziers` with the pixel-v11 world
// frames; the entries here only carry their colliders, sized to that drawn
// stone foot (footprint radius .28; the road keeps the v2 radius .22).
for (const [i, b] of braziers.entries()) {
  const { radius } = ruinsPackage.monasteryWorld.footprints[b.color === 'cyan' ? 'brazier-cyan' : 'brazier-magenta'];
  setDressing.push({ id: `brazier-${i}`, kind: 'brazier', x: b.x, y: b.y, scale: 1, flip: false,
    collider: { x: b.x, y: b.y, radius } });
}

// Drop cells that the props have sealed off, so the walk mask has no
// unreachable pockets behind walls or columns.
const spawn = { x: 0, y: 10 };
for (const radius of [.23, .29]) {
  const probe = { tiles: [...tiles.values()], obstacles: setDressing.flatMap(p => p.colliders ?? (p.collider ? [p.collider] : [])) };
  const usable = new Map(probe.tiles.filter(p => isWalkable(p.x, p.y, radius, probe)).map(p => [key(p.x, p.y), p]));
  const seen = new Set([key(spawn.x, spawn.y)]), queue = [usable.get(key(spawn.x, spawn.y))];
  for (let i = 0; i < queue.length; i++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const next = usable.get(key(queue[i].x + dx, queue[i].y + dy));
    if (next && !seen.has(key(next.x, next.y)) && clearLine(queue[i], next, radius, probe)) { seen.add(key(next.x, next.y)); queue.push(next); }
  }
  for (const id of usable.keys()) if (!seen.has(id)) tiles.delete(id);
}
// Rows of consecutive cells; campaign.js expands them back into tiles.
const regions = [];
for (const p of [...tiles.values()].sort((a, b) => a.y - b.y || a.x - b.x)) {
  const last = regions.at(-1);
  if (last && last[3] === p.y && last[1] === p.x - 1) last[1] = p.x;
  else regions.push([p.x, p.x, p.y, p.y]);
}

export const COURTYARD_LAYOUT = freeze({
  regions,
  pavingRoutes: [{ width: 2.4, points: [[0, 12.5], [0, -6]] }],
  spawn, entries: { road: { x: 0, y: 10 } },
  exit: { x: 0, y: -9 }, ritual: { x: 0, y: -6 },
  pillars: columns.map(([x, y, height]) => ({ x, y, height })),
  braziers,
  // Flagstone floor inside the walls, for the ground surface.
  flagstones: [[-8.5, -11.5], [8.5, -11.5], [8.5, 8.5], [-8.5, 8.5]],
  setDressing,
});
