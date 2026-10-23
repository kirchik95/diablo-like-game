// One shared placement contract for gameplay, rendering and the Paper plans.
// x/y register the sprite's lower anchor. collider.x/y are absolute ground
// centers; collider dimensions already include scale and are never re-scaled.
import campPackage from '../assets/game/pixel-v5/camp/manifest.json' with { type: 'json' };
import panoramaPackage from '../assets/game/pixel-v9/camp-panorama/manifest.json' with { type: 'json' };
import naturalContacts from '../assets/concepts/camp-plan-01/source/natural-contacts.json' with { type: 'json' };
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

// Paper artboard "Панорама лагеря" (file 01M5JE4QF1S7K7921DAQTPSHYY, node 17I-0):
// a 1512×852 image drawn at 35.2 px per screen unit, 1.1× the 32 px/u game art,
// with the monk at game size. Its fire ring centre (915,400) is the world fire.
// Ground points below are traced from that image; the game keeps its own scale.
export const ARTBOARD = freeze({ size: [1512, 852], pixelsPerUnit: 35.2, origin: [915, 400], world: [-3, -2] });
export function fromArtboard(ix, iy) {
  const u = (ix - ARTBOARD.origin[0]) / ARTBOARD.pixelsPerUnit, v = (iy - ARTBOARD.origin[1]) / ARTBOARD.pixelsPerUnit;
  return { x: ARTBOARD.world[0] + Math.SQRT2 * v - u * Math.SQRT1_2, y: ARTBOARD.world[1] + Math.SQRT2 * v + u * Math.SQRT1_2 };
}
export function toArtboard(x, y) {
  const dx = x - ARTBOARD.world[0], dy = y - ARTBOARD.world[1];
  return { x: ARTBOARD.origin[0] + (dy - dx) * Math.SQRT1_2 * ARTBOARD.pixelsPerUnit,
    y: ARTBOARD.origin[1] + (dx + dy) / (2 * Math.SQRT2) * ARTBOARD.pixelsPerUnit };
}

// Playable ground: the clearing, its grass ring, both tents, the carpet and
// the road up to the shared seam. Traced clockwise in artboard pixels.
const walkOutline = [
  [330, 25], [470, 100], [560, 140], [650, 175], [700, 235], [780, 262], [880, 262], [960, 285],
  [1030, 285], [1130, 240], [1250, 290], [1330, 330], [1300, 380], [1240, 410], [1220, 470],
  [1150, 520], [1050, 560], [930, 590], [850, 620], [760, 650], [640, 690], [520, 700], [420, 690],
  [330, 680], [230, 660], [170, 600], [170, 530], [250, 480], [330, 450], [420, 420], [430, 360],
  [360, 330], [280, 300], [230, 250], [160, 170], [100, 120], [60, 60],
].map(([x, y]) => fromArtboard(x, y));
const SEAM_ROW = -29;
const inside = (polygon, x, y) => {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
};
const tiles = new Map();
for (let y = SEAM_ROW; y <= 12; y++) for (let x = -20; x <= 26; x++) {
  // The road mouth keeps the accepted 5-cell join to the road area.
  if (inside(walkOutline, x, y) || (y <= -24 && Math.abs(x) <= 2)) tiles.set(key(x, y), { x, y });
}
const walkable = (x, y) => tiles.has(key(Math.round(x), Math.round(y)));
// Keep the road mouth readable toward the shared seam; beyond it the road
// area owns its own border.
const corridor = (x, y) => y < -22 && Math.abs(x) < 5.5;

// Contact registration. Every kind is placed by its ground centre: measured
// cloth/stone outlines for pixel-v5, fitted support arcs for pixel-v4 and the
// authored footprint contract for pixel-v9. The sprite anchor is derived.
const campFootprints = { ...campPackage.footprints.tents, ...campPackage.footprints.props };
const panorama = panoramaPackage.footprints;
const landscapeRadius = { cypress: .25, 'dead-tree': .22, 'rock-large': .6, 'rock-small': .3, shrub: .35 };
const toWorld = (du, dv) => ({ x: (2 * dv - du) / diagonalPixels, y: (2 * dv + du) / diagonalPixels });
const setDressing = [];
const ids = new Map();
function put(kind, cx, cy, { scale = 1, flip = false, id, radius } = {}) {
  const mirror = flip ? -1 : 1;
  let offset, collider = null, flat = false, area = null;
  if (campFootprints[kind]) {
    // Use each polygon's world AABB, excluding ropes and pegs.
    const anchor = campPackage.camp.anchor;
    const points = campFootprints[kind].polygon.map(([px, py]) => toWorld((px - anchor[0]) * scale * mirror, (py - anchor[1]) * scale));
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    offset = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    collider = kind === 'campfire-base'
      ? { radius: Math.max(...points.map(p => Math.hypot(p.x - offset.x, p.y - offset.y))) }
      : { halfWidth: (Math.max(...xs) - Math.min(...xs)) / 2, halfDepth: (Math.max(...ys) - Math.min(...ys)) / 2 };
  } else if (panorama[kind]) {
    const f = panorama[kind], anchor = panoramaPackage.campPanorama.anchor;
    offset = toWorld((f.contactCenter[0] - anchor[0]) * scale * mirror, (f.contactCenter[1] - anchor[1]) * scale);
    flat = f.role === 'flat';
    // A mirrored isometric drawing exchanges the world x and y extents.
    const box = f.shape === 'circle' ? null
      : { halfWidth: (flip ? f.halfDepth : f.halfWidth) * scale, halfDepth: (flip ? f.halfWidth : f.halfDepth) * scale };
    if (!flat) collider = box ?? { radius: (radius ?? f.radius) * scale };
    else area = box;
  } else {
    const contact = naturalContacts.frames[kind]?.contactCenter;
    if (!contact) throw new Error(`Unknown camp prop: ${kind}`);
    offset = toWorld((contact[0] - 80) * scale * mirror, (contact[1] - 144) * scale);
    collider = { radius: landscapeRadius[kind] * scale };
  }
  const count = (ids.get(kind) ?? 0) + 1;
  ids.set(kind, count);
  const p = { id: id ?? `${kind}-${count}`, kind, x: cx - offset.x, y: cy - offset.y, scale, flip,
    ...(flat ? { layer: 'ground', contact: { x: cx, y: cy }, ...(area ? { area } : {}) } : {}),
    ...(collider ? { collider: { x: cx, y: cy, ...collider } } : {}) };
  setDressing.push(p);
  return p;
}
const art = (kind, ix, iy, scale = 1, flip = false) => {
  const { x, y } = fromArtboard(ix, iy);
  // The artboard's road bends further west; its verge props would block ours.
  if (y < SEAM_ROW - .4 || (corridor(x, y) && Math.abs(x) < 3.6)) return null;
  return put(kind, x, y, { scale, flip });
};

// Core camp. The fire keeps its accepted ring and approach; everything else
// follows the artboard: tent doors face the fire and the carpet, the kettle
// stands at the ring's east side, the log lies along x before it.
put('campfire-base', -3, -2, { id: 'fire' });
// The splayed legs stand on a smaller circle than the footprint contract.
put('tripod-kettle', -4.6, -.65, { id: 'tripod', radius: .32 });
put('fallen-log', -2.8, 1.4, { id: 'log' });
put('tent-right', -11.5, -1.5, { id: 'tent-right' });
put('tent-left', 16, -8, { id: 'tent-left' });
put('woven-carpet', 8.2, -.6, { id: 'carpet' });
put('supply-cache', 8.85, -1.95, { id: 'supplies' });
put('crate', 8.45, .95, { id: 'carpet-crate' });
put('crate', -10.5, 1.1, { id: 'tent-right-crate', flip: true });
put('sack-pair', -11.85, 2.45, { id: 'tent-right-sacks' });
put('crate', 19.1, -6.8, { id: 'tent-left-crate' });
put('sack-pair', 18.9, -5.2, { id: 'tent-left-sacks', flip: true });
put('ruin-pillar', -4.2, -16.1, { id: 'pillar-east' });
put('ruin-pillar', 3.2, -18.5, { id: 'pillar-west', flip: true });

// Outcrops, groves and bushes traced from the artboard (ground contacts).
// Stone gathers in a few large masses and wall runs; lone stones are rare,
// rounded boulders.
for (const [kind, ix, iy, scale = 1, flip = false] of [
  // North-west: road side, two pillars, the western stone mass.
  ['outcrop-cluster', 375, 45, 1.15], ['outcrop-crag', 515, 85, 1], ['outcrop-cluster', 600, 62, 1.1, true], ['outcrop-pair', 668, 108],
  ['bush-large', 50, 108], ['bush-round', 155, 100, .8], ['boulder-round', 200, 195, .85],
  ['cypress-tall', 115, 305], ['cypress-medium', 230, 332], ['cypress-medium', 288, 270, .8, true], ['cypress-pair', 22, 332],
  ['outcrop-cliff', 28, 298, 1, true], ['outcrop-cluster', 300, 302], ['outcrop-pair', 410, 336, 1, true], ['outcrop-pair', 490, 392, .9],
  ['bush-large', 345, 385], ['boulder-round', 660, 258, .8],
  ['outcrop-cliff', 168, 470, 1.12], ['outcrop-crag', 258, 486, 1.05, true], ['outcrop-wall-y', 95, 430, 1.1], ['bush-round', 268, 452, .9],
  ['bush-round', 560, 162, .8], ['bush-round', 625, 146, .7, true],
  ['bush-large', 728, 216], ['bush-large', 800, 224, 1, true], ['bush-large', 872, 214], ['bush-round', 722, 182, .9],
  // North-east: stone shelf and dead tree on the horizon, the tent's grove.
  ['outcrop-cluster', 885, 162], ['outcrop-crag', 958, 150, .85, true], ['outcrop-ledge-x', 832, 146, .8],
  ['dead-tree', 1002, 146, 1.1], ['cypress-tall', 1076, 182], ['cypress-medium', 780, 112, .8], ['cypress-medium', 812, 104, .65, true],
  ['boulder-round', 812, 246, .9, true], ['outcrop-cluster', 1012, 284, .85], ['boulder-round', 1062, 262, .85],
  ['cypress-tall', 1186, 202], ['cypress-pair', 1242, 260, 1, true], ['cypress-medium', 1150, 232, .9],
  ['outcrop-cluster', 1296, 264, .9], ['cypress-medium', 1380, 242, .7], ['cypress-medium', 1352, 232, .6, true],
  ['outcrop-crag', 1392, 350, .9, true], ['cypress-tall', 1482, 428], ['cypress-pair', 1352, 522],
  ['outcrop-cluster', 1287, 494, .85],
  // South-east: two rounded stones, the tall terrace mass and its cypress group.
  ['boulder-round', 845, 506, .7], ['boulder-round', 1112, 524, .9, true],
  ['bush-large', 1330, 562], ['bush-large', 1402, 602, 1, true], ['bush-round', 1292, 472],
  ['outcrop-cliff', 1150, 742, 1.15], ['outcrop-cliff', 1262, 762, 1.12, true], ['outcrop-wall-x', 1352, 722, 1.1], ['outcrop-cliff', 1060, 770, 1],
  ['outcrop-cluster', 942, 716], ['outcrop-wall-y', 1002, 726, .9], ['outcrop-ledge-x', 1196, 660, .9, true],
  ['outcrop-crag', 1420, 676, .85],
  ['cypress-pair', 1040, 822], ['cypress-tall', 1088, 834], ['cypress-medium', 1000, 802, .9],
  ['bush-large', 852, 812], ['bush-round', 1342, 832], ['outcrop-pair', 1452, 702], ['outcrop-cluster', 1472, 762, .9, true],
  // South-west: the second tent's flank, low rounded stones and dark shrubs.
  ['cypress-tall', 110, 696], ['cypress-medium', 60, 562], ['boulder-round', 160, 542, .95], ['outcrop-pair', 456, 502, 1, true],
  ['bush-round', 210, 622], ['bush-round', 385, 662, .8], ['bush-round', 500, 682, .8, true], ['outcrop-pair', 626, 702],
  ['bush-large', 690, 682, .8], ['outcrop-cluster', 262, 766], ['outcrop-crag', 516, 836, .9, true], ['bush-large', 432, 762],
  ['bush-large', 122, 802], ['cypress-pair', 32, 762], ['bush-round', 340, 842],
]) art(kind, ix, iy, scale, flip);

// A visible blocker must stand near every edge of the walk mask. Fill only
// uncovered edges, outside the mask, with low stones and shrubs.
const extent = p => {
  // A walkable rug still reserves its own surface from tufts and blockers.
  const c = p.collider ?? (p.area && { ...p.contact, ...p.area });
  if (!c) return null;
  return c.radius !== undefined ? { x: c.x, y: c.y, rx: c.radius, ry: c.radius } : { x: c.x, y: c.y, rx: c.halfWidth, ry: c.halfDepth };
};
const gap = (p, x, y) => {
  const e = extent(p);
  return e ? Math.hypot(Math.max(0, Math.abs(x - e.x) - e.rx), Math.max(0, Math.abs(y - e.y) - e.ry)) : Infinity;
};
const edges = [];
for (const p of tiles.values()) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
  if (!tiles.has(key(p.x + dx, p.y + dy)) && !(p.y + dy < SEAM_ROW)) edges.push({ x: p.x, y: p.y, dx, dy });
}
edges.sort((a, b) => a.y - b.y || a.x - b.x || a.dy - b.dy || a.dx - b.dx);
for (const e of edges) {
  const x = e.x + e.dx * .5, y = e.y + e.dy * .5;
  if (setDressing.some(p => gap(p, x, y) < 1.15)) continue;
  const n = hash(e.x * 2 + e.dx, e.y * 2 + e.dy, 11), tangent = (hash(e.x, e.y, 12) - .5) * .5;
  // Shrubs carry the edge; a rounded stone or a stone pair only now and then.
  const kind = n < .45 || (n >= .58 && n < .75) ? 'bush-round' : n < .58 ? 'boulder-round' : n >= .8 && n < .9 ? 'outcrop-pair' : 'bush-large';
  const scale = (kind === 'bush-large' ? .75 : .85) + hash(e.x, e.y, 13) * .25;
  const reach = { 'bush-round': .7, 'boulder-round': .62, 'outcrop-pair': 1.3, 'bush-large': 1.1 }[kind] * scale;
  put(kind, x + e.dx * (reach + .05) - e.dy * tangent, y + e.dy * (reach + .05) + e.dx * tangent,
    { scale, flip: hash(e.x, e.y, 14) > .5, id: `boundary-${e.x},${e.y},${e.dx},${e.dy}` });
}

// Inner grass: ankle-height tufts, never on the worn clearing or the road.
const clearing = [[600, 410], [900, 305], [1255, 395], [1000, 545]].map(([x, y]) => fromArtboard(x, y));
for (let y = SEAM_ROW; y <= 12; y += 2) for (let x = -20; x <= 26; x += 2) {
  if (hash(x, y, 21) < .35) continue;
  const px = x + (hash(x, y, 22) - .5) * 1.6, py = y + (hash(x, y, 23) - .5) * 1.6;
  if (!walkable(px, py) || inside(clearing, px, py) || Math.abs(px) < 3 && py < -6) continue;
  if (setDressing.some(p => gap(p, px, py) < .5)) continue;
  put(hash(x, y, 24) < .7 ? 'grass-tuft' : 'fern-tuft', px, py, { scale: .8 + hash(x, y, 25) * .4, flip: hash(x, y, 26) > .5 });
}

// World-fixed horizon of the north-east backdrop in screen units:
// u = (y - x) / √2 right, v = (x + y) / (2√2) down. Ground with v < H(u) shows
// the distant mountains; both ends climb out of every reachable view.
// It begins at the artboard's dead tree: further left, the widest road-loop
// view (1919×1080) would look past the rim's end.
const horizon = [[3, -20], [3.3, -9.98], [11.67, -8.45],
  [15.34, -6.19], [17.68, -5.87], [26, -4.6], [33, -4], [37, -16]];
// Beyond the authored points the rim climbs steeply out of every view.
const HORIZON_CLIMB = 30;
export function horizonAt(points, u) {
  if (u <= points[0][0]) return points[0][1] - (points[0][0] - u) * HORIZON_CLIMB;
  for (let i = 1; i < points.length; i++) {
    const [u0, v0] = points[i - 1], [u1, v1] = points[i];
    if (u <= u1) return v0 + (v1 - v0) * (u - u0) / (u1 - u0);
  }
  return points.at(-1)[1] - (u - points.at(-1)[0]) * HORIZON_CLIMB;
}
// True beyond the rim. A positive margin (screen units) also reserves the
// ground just in front of it.
export function inBackdrop(backdrop, x, y, margin = 0) {
  return !!backdrop && (x + y) / (2 * Math.SQRT2) < horizonAt(backdrop.horizon, (y - x) * Math.SQRT1_2) + margin;
}
const backdrop = { horizon, parallax: .25, reference: [-4.74, -.95] };

// Distance from the walk mask over the surrounding grid, for the outer groves.
const reachGrid = new Map([...tiles.values()].map(p => [key(p.x, p.y), 0]));
const reachQueue = [...tiles.values()];
for (let i = 0; i < reachQueue.length; i++) {
  const p = reachQueue[i], d = reachGrid.get(key(p.x, p.y)) + 1;
  if (d > 22) continue;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const id = key(p.x + dx, p.y + dy);
    if (!reachGrid.has(id)) { reachGrid.set(id, d); reachQueue.push({ x: p.x + dx, y: p.y + dy }); }
  }
}
const radiusOf = p => {
  const f = panorama[p.kind];
  if (f) return (f.shape === 'circle' ? f.radius : Math.max(f.halfWidth, f.halfDepth)) * p.scale;
  return p.collider ? Math.max(p.collider.radius ?? 0, p.collider.halfWidth ?? 0, p.collider.halfDepth ?? 0) : .3;
};
const contactOf = p => p.collider ?? p.contact;
const clear = (x, y, radius, own) => setDressing.every(p => {
  if (own?.includes(p)) return true;
  const c = contactOf(p);
  return !c || Math.hypot(c.x - x, c.y - y) >= radius + radiusOf(p) + .25;
});
const pick = (n, table) => {
  let total = 0;
  for (const [kind, weight] of table) if ((total += weight) > n) return kind;
  return table.at(-1)[0];
};
const shapes = {
  'cypress-tall': .5, 'cypress-medium': .42, 'cypress-pair': .8, 'bush-large': 1.1, 'bush-round': .7,
  'outcrop-cluster': 1.3, 'outcrop-pair': 1.1, 'outcrop-block': .55, 'outcrop-cliff': 1.6, 'outcrop-slab': 1.4,
  'boulder-round': .6, 'outcrop-crag': 1.2, 'outcrop-ledge-x': 1.6,
};
// `own` lists the earlier pieces of the same stone run, which may overlap.
const grow = (kind, x, y, scale, flip, id, own) => {
  if (!clear(x, y, shapes[kind] * scale, own) || inBackdrop(backdrop, x, y, .15) || corridor(x, y)) return null;
  if ((reachGrid.get(key(Math.round(x), Math.round(y))) ?? 99) < 2) return null;
  return put(kind, x, y, { scale, flip, id });
};

// Screen depth to playable ground straight behind a point (up the screen).
// Tall props there would hide the hero, so the near side stays low.
const groundBehind = (x, y) => {
  for (let k = 1; k <= 18; k++) if (tiles.has(key(Math.round(x - k * Math.SQRT1_2), Math.round(y - k * Math.SQRT1_2)))) return k;
  return Infinity;
};
const belowHorizon = (x, y) => (x + y) / (2 * Math.SQRT2) - horizonAt(horizon, (y - x) * Math.SQRT1_2);

// A stacked grove hides the rim's steep west end from every camp view.
for (const [i, kind, u, v] of [[1, 'cypress-tall', 3.1, -10.9], [2, 'cypress-tall', 2.95, -12.6], [3, 'cypress-medium', 2.62, -15.15]]) {
  put(kind, Math.SQRT2 * v - u * Math.SQRT1_2, Math.SQRT2 * v + u * Math.SQRT1_2, { id: `rim-end-${i}`, flip: i === 2 });
}
// Rim: shrubs, stone shelves and a few trees on the ground side of the
// horizon, their crowns against the mountains. Sampled by screen arc length.
for (let s = 0, u = 3.6; u < 34.5; s++) {
  const v = horizonAt(horizon, u), next = u + .02;
  const slope = (horizonAt(horizon, next) - v) / .02;
  if (hash(s, 7, 31) < .5) {
    const n = hash(s, 7, 32), down = .25 + hash(s, 7, 33) * .9;
    const kind = pick(n, [['cypress-medium', .1], ['cypress-tall', .05], ['bush-large', .24], ['bush-round', .23],
      ['outcrop-cluster', .12], ['outcrop-crag', .08], ['outcrop-ledge-x', .1], ['boulder-round', .08]]);
    const x = Math.SQRT2 * (v + down) - u * Math.SQRT1_2, y = Math.SQRT2 * (v + down) + u * Math.SQRT1_2;
    grow(kind, x, y, .75 + hash(s, 7, 34) * .35, hash(s, 7, 35) > .5, `rim-${s}`);
  }
  u += .95 / Math.hypot(1, slope);
}

// Stone masses continue as short runs along the walk mask's contour, so the
// country reads as walls and outcrops instead of scattered blocks.
const stoneKinds = ['outcrop-cluster', 'outcrop-pair', 'outcrop-ledge-x', 'outcrop-crag', 'outcrop-cliff', 'outcrop-slab'];
const runTable = behind => behind < 6 ? [['outcrop-ledge-x', .55], ['outcrop-pair', .25], ['outcrop-slab', .2]]
  : behind < 17 ? [['outcrop-ledge-x', .35], ['outcrop-pair', .25], ['outcrop-cluster', .25], ['outcrop-crag', .15]]
  : [['outcrop-ledge-x', .25], ['outcrop-cluster', .25], ['outcrop-crag', .2], ['outcrop-cliff', .15], ['outcrop-pair', .15]];
// Half-length of a piece along world x or y; a mirror exchanges the axes.
const halfAlong = (kind, flip, alongX) => {
  const f = panorama[kind];
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

// Outer groves fill the rest of the visible country of the camp area. Rows
// are staggered and jittered by most of a cell, so no grid lines show.
for (let row = 0, gy = -29; gy <= 34; row++, gy += 2.4) for (let gx = -40 + (row % 2) * 1.2; gx <= 46; gx += 2.4) {
  const ix = Math.round(gx * 10), iy = Math.round(gy * 10);
  const x = gx + (hash(ix, iy, 41) - .5) * 2.2, y = gy + (hash(ix, iy, 42) - .5) * 2.2;
  if (y < SEAM_ROW) continue;
  const d = reachGrid.get(key(Math.round(x), Math.round(y)));
  if (d === undefined || d < 2 || hash(ix, iy, 43) > (d < 6 ? .8 : d < 12 ? .62 : .38)) continue;
  const behind = groundBehind(x, y), horizonGap = belowHorizon(x, y);
  const table = behind < 6 ? [['bush-round', .5], ['bush-large', .3], ['outcrop-slab', .07], ['boulder-round', .05],
    ['outcrop-ledge-x', .08]]
    : behind < 17 ? [['bush-round', .34], ['bush-large', .34], ['outcrop-pair', .07], ['outcrop-ledge-x', .1],
      ['outcrop-cluster', .09], ['boulder-round', .03], ['outcrop-crag', .03]]
    : horizonGap < 5 ? [['bush-large', .32], ['bush-round', .28], ['outcrop-cluster', .14], ['outcrop-ledge-x', .1],
      ['cypress-medium', .12], ['outcrop-crag', .04]]
    : [['cypress-tall', .22], ['cypress-medium', .2], ['cypress-pair', .1], ['bush-large', .18], ['bush-round', .14],
      ['outcrop-cliff', .06], ['outcrop-crag', .06], ['outcrop-cluster', .04]];
  const kind = pick(hash(ix, iy, 44), table);
  const placed = grow(kind, x, y, .8 + hash(ix, iy, 45) * .35, hash(ix, iy, 46) > .5, `grove-${ix},${iy}`);
  // Runs grow only away from the walk mask, where a wall reads as country.
  if (placed && stoneKinds.includes(kind) && d >= 4 && hash(ix, iy, 50) < .75) stoneRun(placed, ix, iy);
}

// Only blockers that can touch the walk mask take part in collision; distant
// scenery stays visual and keeps per-step collision checks short.
for (const p of setDressing) {
  const c = p.collider;
  if (!c || ['fire', 'log', 'tripod', 'tent-left', 'tent-right', 'supplies', 'pillar-east', 'pillar-west'].includes(p.id)) continue;
  const rx = c.radius ?? c.halfWidth, ry = c.radius ?? c.halfDepth;
  let near = false;
  for (let y = Math.floor(c.y - ry - 1.5); y <= Math.ceil(c.y + ry + 1.5) && !near; y++) {
    for (let x = Math.floor(c.x - rx - 1.5); x <= Math.ceil(c.x + rx + 1.5); x++) {
      if (tiles.has(key(x, y)) && Math.hypot(Math.max(0, Math.abs(x - c.x) - rx), Math.max(0, Math.abs(y - c.y) - ry)) < 1.2) { near = true; break; }
    }
  }
  if (!near) { p.contact = { x: c.x, y: c.y }; delete p.collider; }
}

// Drop cells that the props have sealed off, so the walk mask has no
// unreachable pockets behind tents or stone masses.
const spawn = { x: 2, y: -4 };
for (const radius of [.23, .29]) {
  const probe = { tiles: [...tiles.values()], obstacles: setDressing.filter(p => p.collider).map(p => p.collider) };
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
const prop = id => setDressing.find(p => p.id === id);

export const CAMP_LAYOUT = freeze({
  regions,
  pavingRoutes: [
    { width: 2.6, points: [[0, -28], [-1, -24], [-1.3, -19], [-.8, -14], [.3, -10], [1.4, -6.5], [2, -4]] },
    { width: 1.5, points: [[2, -4], [4.6, -1.4], [6.9, .6]] },
  ],
  spawn, entries: { road: { x: 0, y: -22 } },
  exit: { x: 0, y: -27 }, reward: { x: 6.9, y: .6 },
  pillars: ['pillar-east', 'pillar-west'].map(id => ({ x: prop(id).x, y: prop(id).y, height: 3.2 })),
  braziers: [{ x: prop('fire').x, y: prop('fire').y, color: 'amber' }],
  clearing: clearing.map(p => [p.x, p.y]),
  backdrop,
  setDressing,
});
