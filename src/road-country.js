// The road area in the style of "Лагерь странников": the camp's pixel-v9
// stone masses and wall runs, cypress groves, round bushes, tufts and ruined
// pillars around the unchanged road walk mask. Nothing here collides: every
// standing footprint stays outside the walkable cells, so movement, paths and
// encounter placement are exactly those of the road regions.
import panorama from '../assets/game/pixel-v9/camp-panorama/manifest.json' with { type: 'json' };
import ruins from '../assets/game/pixel-v11/monastery-ruins/manifest.json' with { type: 'json' };
import { inBackdrop } from './camp-layout.js';

// The camp package first, then the monastery ruins (read-only here); both
// atlases share the 256 px cell and the [128,232] registration anchor.
const footprints = { ...ruins.footprints, ...panorama.footprints }, anchor = panorama.campPanorama.anchor;
const key = (x, y) => `${x},${y}`;
const hash = (x, y, salt) => {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
const toWorld = (du, dv) => ({ x: (2 * dv - du) / (32 * Math.SQRT2), y: (2 * dv + du) / (32 * Math.SQRT2) });
const pick = (n, table) => {
  let total = 0;
  for (const [kind, weight] of table) if ((total += weight) > n) return kind;
  return table.at(-1)[0];
};
// Bare grass between a standing footprint and the nearest walkable cell.
const GAP = .05;

// Ground extent of a frame at a contact centre. A mirrored isometric drawing
// exchanges the world x and y extents.
export function panoramaFootprint(frame, x, y, scale = 1, flip = false) {
  const f = footprints[frame];
  // Other atlases' props (the camp's dead tree) only need a spacing circle.
  if (!f) return { x, y, radius: .5 * scale };
  return f.shape === 'circle' ? { x, y, radius: f.radius * scale }
    : { x, y, halfWidth: (flip ? f.halfDepth : f.halfWidth) * scale, halfDepth: (flip ? f.halfWidth : f.halfDepth) * scale };
}

// Sprite anchor from the ground contact, exactly as CAMP_LAYOUT registers it.
export function registerPanorama(frame, x, y, scale = 1, flip = false) {
  const f = footprints[frame];
  const offset = toWorld((f.contactCenter[0] - anchor[0]) * scale * (flip ? -1 : 1), (f.contactCenter[1] - anchor[1]) * scale);
  return { frame, x: x - offset.x, y: y - offset.y, height: 0, scale, flip, contact: { x, y },
    footprint: panoramaFootprint(frame, x, y, scale, flip), ...(f.role === 'flat' ? { layer: 'ground' } : {}) };
}

// Gameplay pillars keep their √2 square collider (halfSize √½). The camp's
// ruined pillar is scaled so that its plinth is exactly that square.
export function roadPillar(p) {
  return registerPanorama('ruin-pillar', p.x, p.y, Math.SQRT1_2 / footprints['ruin-pillar'].halfWidth,
    hash(Math.round(p.x * 4), Math.round(p.y * 4), 7) > .5);
}

const extentOf = fp => fp.radius !== undefined ? [fp.radius, fp.radius] : [fp.halfWidth, fp.halfDepth];
const radiusOf = fp => Math.max(...extentOf(fp));
// Plan distance between a footprint and a point (zero inside).
const gapTo = (fp, x, y) => {
  const [rx, ry] = extentOf(fp), dx = Math.abs(x - fp.x), dy = Math.abs(y - fp.y);
  return fp.radius !== undefined ? Math.max(0, Math.hypot(dx, dy) - fp.radius)
    : Math.hypot(Math.max(0, dx - rx), Math.max(0, dy - ry));
};

// Features drawn for this road, in road-local coordinates (LOCATIONS.road).
// Tall stone and trees stand on the up-screen side (smaller x or y), where
// they cannot hide the hero; the near side keeps low ledges, slabs and ruins.
export const ROAD_FEATURES = [
  // Entry from the camp: a broken marker and a fallen column.
  ['ruin-stump', -4.7, 19.4, .95], ['outcrop-wall-y', -5.4, 17.2, .95], ['cypress-pair', -7.6, 18.6],
  ['ruin-fallen', 5.1, 17.6, 1, true], ['bush-large', 4.9, 20.6, .85],
  // First braziers: a stone mass behind, low stone in front.
  ['outcrop-cliff', -9, 13.1, 1.05], ['cypress-tall', -11.4, 14.6], ['cypress-medium', -10.2, 16.4, .9, true],
  ['outcrop-ledge-x', 7.9, 8.6, .95, true], ['boulder-round', 7.6, 12.7, .9],
  // The island between the side trail and the road: a low wall and two bushes.
  ['outcrop-ledge-x', -7.3, 2.5, .9], ['bush-round', -4.4, 2.5, .8], ['bush-round', -9.9, 2.6, .72, true],
  // Side trail: a ruined gate of the monastery ruins west of the shrine, its
  // fallen lintel, drums and rubble; cypresses behind it. The ruins package
  // draws its own orientations and is never mirrored.
  ['arch-gate', -22, 6.2], ['fallen-lintel', -21.4, 2.9], ['rubble-pile', -20.6, 9.1, .9],
  ['column-drums', -22.8, 10.9], ['cypress-tall', -25, 4.6], ['cypress-medium', -24.6, 8.2, .9, true],
  ['cypress-pair', -21.4, -1.4], ['ruin-stump', -20.7, -3.6, .9, true],
  ['outcrop-ledge-x', -12.6, 11.6, .9], ['bush-large', -16.6, 11.9, .9, true],
  ['outcrop-cliff', -15.6, -6.6, 1], ['outcrop-wall-x', -11.6, -5.9, .9], ['cypress-tall', -18.8, -6.3, 1, true],
  // Crossing: stone and cypresses behind, a fallen column at the near side.
  ['outcrop-crag', -8.8, -8.4, 1], ['cypress-tall', -11.4, -9.6], ['cypress-medium', -9.4, -11.6, .95, true],
  ['ruin-fallen', 8.2, -2.6, .95, true], ['outcrop-slab', 8.4, -8.2, .9],
  // Gate toward the monastery: a ruined pillar and a stump flank the road.
  ['ruin-pillar', -4.6, -15.2, .95], ['ruin-stump', 4.6, -14.4, .95, true],
  ['cypress-tall', -5.1, -12], ['cypress-medium', -5.5, -18, .9], ['outcrop-crag', -7.2, -16.4, .95],
  ['ruin-fallen', 6.3, -17.6, .9, true], ['bush-round', 4.5, -11.6, .85],
];

// Weighted kinds by screen depth to playable ground straight behind a point:
// tall props there would hide the hero, so the near side stays low.
const groveTable = (behind, d) => behind < 6
  ? [['bush-round', .44], ['bush-large', .28], ['outcrop-slab', .08], ['boulder-round', .08], ['outcrop-ledge-x', .1],
    ['ruin-fallen', d < 8 ? .04 : 0]]
  : behind < 17
    ? [['bush-round', .3], ['bush-large', .32], ['outcrop-pair', .08], ['outcrop-ledge-x', .1], ['outcrop-cluster', .1],
      ['boulder-round', .04], ['outcrop-crag', .03], ['ruin-stump', d < 8 ? .04 : 0]]
    : [['cypress-tall', .22], ['cypress-medium', .2], ['cypress-pair', .1], ['bush-large', .16], ['bush-round', .12],
      ['outcrop-cliff', .06], ['outcrop-crag', .06], ['outcrop-cluster', .05], ['ruin-pillar', d < 10 ? .03 : 0]];
const runTable = behind => behind < 6 ? [['outcrop-ledge-x', .55], ['outcrop-pair', .25], ['outcrop-slab', .2]]
  : behind < 17 ? [['outcrop-ledge-x', .35], ['outcrop-pair', .25], ['outcrop-cluster', .25], ['outcrop-crag', .15]]
    : [['outcrop-ledge-x', .25], ['outcrop-cluster', .25], ['outcrop-crag', .2], ['outcrop-cliff', .15], ['outcrop-pair', .15]];
const stoneKinds = ['outcrop-cluster', 'outcrop-pair', 'outcrop-ledge-x', 'outcrop-crag', 'outcrop-cliff', 'outcrop-slab'];

// world: OVERWORLD or LOCATIONS.road. walk: walkable cell keys. distance: grid
// steps from the walk mask over the landscape extent. keep(p): portal views
// and reserved approaches (country-border's allowScenery). others: footprints
// of neighbouring areas' props, which only space this layout.
export function layoutRoadCountry({ world, walk, distance, extent, zoneAt, backdrop, keep, others = [] }) {
  const road = world.zones?.find(zone => zone.id === 'road') ?? (world.id === 'road' ? world : null);
  if (!road) return { border: [], scenery: [] };
  const offset = road.offset ?? { x: 0, y: 0 };
  const inRoad = (x, y) => (world.zones ? zoneAt(x, y) : world).id === 'road';
  const reserved = [...[road.shrine, road.secret].filter(Boolean).map(p => ({ ...p, radius: 2.2 })),
    ...road.pillars.map(p => ({ ...p, radius: 1.3 })), ...road.braziers.map(p => ({ ...p, radius: 1.1 }))];
  const buckets = new Map();
  const add = p => {
    const id = key(Math.floor(p.footprint.x / 4), Math.floor(p.footprint.y / 4));
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push(p);
  };
  const near = (x, y) => {
    const result = [], bx = Math.floor(x / 4), by = Math.floor(y / 4);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) result.push(...buckets.get(key(bx + dx, by + dy)) ?? []);
    return result;
  };
  for (const footprint of others) add({ footprint });
  const touchesWalk = fp => {
    const [rx, ry] = extentOf(fp), reach = GAP + .5;
    for (let y = Math.ceil(fp.y - ry - reach); y <= Math.floor(fp.y + ry + reach); y++) {
      for (let x = Math.ceil(fp.x - rx - reach); x <= Math.floor(fp.x + rx + reach); x++) {
        if (!walk.has(key(x, y))) continue;
        const dx = Math.max(0, Math.abs(fp.x - x) - .5), dy = Math.max(0, Math.abs(fp.y - y) - .5);
        if (fp.radius !== undefined ? Math.hypot(dx, dy) < fp.radius + GAP : dx < rx + GAP && dy < ry + GAP) return true;
      }
    }
    return false;
  };
  const crowded = (fp, margin, own = []) => near(fp.x, fp.y).some(q => !own.includes(q) &&
    Math.hypot(q.footprint.x - fp.x, q.footprint.y - fp.y) < radiusOf(fp) + radiusOf(q.footprint) + margin);
  const allowed = p => {
    const { x, y } = p.contact;
    return inRoad(x, y) && !inBackdrop(backdrop, x, y, .3) && !touchesWalk(p.footprint) && keep(p)
      && reserved.every(q => gapTo(p.footprint, q.x, q.y) >= q.radius);
  };
  const border = [], scenery = [];
  const commit = (p, list, extra) => {
    Object.assign(p, extra);
    add(p); list.push(p);
    return p;
  };

  // Screen depth to playable ground straight up the screen from a point.
  const behind = (x, y) => {
    for (let k = 1; k <= 18; k++) if (walk.has(key(Math.round(x - k * Math.SQRT1_2), Math.round(y - k * Math.SQRT1_2)))) return k;
    return Infinity;
  };
  // Shortest nearby setback that clears the walk mask; never a long march.
  const settle = (frame, x, y, scale, flip) => {
    for (let step = 0; step <= 12; step++) {
      for (const [dx, dy] of step ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[0, 0]]) {
        const length = Math.hypot(dx, dy) || 1;
        const p = registerPanorama(frame, x + dx / length * step * .12, y + dy / length * step * .12, scale, flip);
        if (!touchesWalk(p.footprint)) return p;
      }
    }
    return null;
  };

  // 1. Authored features; they may touch each other, never the walk mask.
  for (const [i, [frame, lx, ly, scale = 1, flip = false]] of ROAD_FEATURES.entries()) {
    const p = settle(frame, lx + offset.x, ly + offset.y, scale, flip);
    if (p && allowed(p)) commit(p, border, { border: true, cluster: `road-feature-${i}` });
  }

  // 2. A natural belt: every walk-mask edge of the road gets a visible
  // blocker nearby. Sectors of about five units share a theme (stone, bushes
  // or a mix), so the straight region edges read as country, not a fence.
  // Their rhythm varies too: dense hedges, open stretches with tufts in the
  // gaps, and staggered setbacks of mixed sizes.
  const tufts = [];
  const edges = [];
  for (const id of walk) {
    const [x, y] = id.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!walk.has(key(x + dx, y + dy)) && inRoad(x + dx * .5, y + dy * .5)) edges.push({ x, y, dx, dy });
    }
  }
  edges.sort((a, b) => a.y - b.y || a.x - b.x || a.dy - b.dy || a.dx - b.dx);
  for (const e of edges) {
    const mx = e.x + e.dx * .5, my = e.y + e.dy * .5;
    const rhythm = hash(Math.floor((mx + 2) / 4), Math.floor((my + 1) / 4), 87);
    const spacing = rhythm < .35 ? 2 : 1.15, stagger = rhythm > .7 ? 1.1 : .55;
    const covered = near(mx, my).filter(p => gapTo(p.footprint, mx, my) < spacing);
    if (covered.length) {
      // An open stretch keeps a tuft or two on the meadow inside the edge.
      if (spacing > 1.5 && !covered.some(p => gapTo(p.footprint, mx, my) < 1.15) && hash(e.x, e.y, 16) < .6) {
        tufts.push({ x: mx - e.dx * (.3 + hash(e.x, e.y, 17) * .3), y: my - e.dy * (.3 + hash(e.x, e.y, 17) * .3), seed: [e.x * 3 + e.dx, e.y * 3 + e.dy] });
      }
      continue;
    }
    const sector = hash(Math.floor(mx / 5), Math.floor(my / 5), 86), n = hash(e.x * 2 + e.dx, e.y * 2 + e.dy, 11);
    const front = behind(mx + e.dx, my + e.dy) < 6;
    let kind = sector < .25 ? pick(n, [['outcrop-ledge-x', front ? .3 : .25], ['outcrop-pair', .25], ['boulder-round', .25],
      ['bush-round', .2], [front ? 'outcrop-slab' : 'outcrop-cluster', .1]])
      : sector < .8 ? pick(n, [['bush-round', .5], ['bush-large', .34], ['boulder-round', .1], ['outcrop-pair', .06]])
        : pick(n, [['bush-round', .36], ['boulder-round', .24], ['bush-large', .2], ['ruin-stump', .08], ['outcrop-slab', .12]]);
    // Long low stone never repeats along a straight edge: one piece per run of it.
    if (/ledge|slab|wall|fallen/.test(kind) && near(mx, my).some(p => /ledge|slab|wall|fallen/.test(p.frame ?? '') &&
      Math.hypot(p.footprint.x - mx, p.footprint.y - my) < 5)) kind = n < .5 ? 'bush-round' : 'outcrop-pair';
    // A wide piece that does not fit an inner corner gives way to a bush.
    for (const [k, choice] of [kind, 'bush-round', 'boulder-round'].entries()) {
      // Long stone lies along the edge: a mirrored ledge runs along world y.
      const flip = choice === 'outcrop-ledge-x' ? e.dx !== 0 : hash(e.x, e.y, 14) > .5;
      const scale = (choice === 'bush-large' ? .72 : .78) + hash(e.x, e.y, 13) * .4 - k * .1;
      const fp = panoramaFootprint(choice, 0, 0, scale, flip), reach = e.dx ? fp.halfWidth ?? fp.radius : fp.halfDepth ?? fp.radius;
      const out = reach + GAP + hash(e.x, e.y, 15) * stagger, tangent = (hash(e.x, e.y, 12) - .5) * .9;
      let p = null;
      for (let push = 0; push < 8 && !p; push++) {
        const q = registerPanorama(choice, mx + e.dx * (out + push * .15) - e.dy * tangent, my + e.dy * (out + push * .15) + e.dx * tangent, scale, flip);
        if (!touchesWalk(q.footprint)) p = q;
      }
      if (p && allowed(p)) { commit(p, border, { border: true, cluster: `road-belt-${Math.floor(mx / 5)},${Math.floor(my / 5)}` }); break; }
    }
  }

  // 3. Outer groves fill the visible country. Rows are staggered and jittered
  // by most of a cell, so no grid lines show; density falls off with distance.
  const grow = (kind, x, y, scale, flip, cluster, own) => {
    const p = registerPanorama(kind, x, y, scale, flip);
    if (crowded(p.footprint, .25, own) || !allowed(p)) return null;
    if ((distance.get(key(Math.round(x), Math.round(y))) ?? 99) < 2) return null;
    return commit(p, scenery, { cluster });
  };
  const halfAlong = (kind, flip, alongX) => {
    const f = footprints[kind];
    return alongX !== flip ? f.halfWidth : f.halfDepth;
  };
  // Stone continues as short runs, so the country reads as walls and
  // outcrops instead of scattered blocks. Along the road's straight edges a
  // run follows the contour only half of the time; the others reach outward
  // as spurs, so no long wall parallels the road.
  const stoneRun = (first, ix, iy) => {
    const c = first.contact, d = (x, y) => distance.get(key(Math.round(x), Math.round(y))) ?? 40;
    const gx = d(c.x + 1, c.y) - d(c.x - 1, c.y), gy = d(c.x, c.y + 1) - d(c.x, c.y - 1);
    const contour = gx || gy ? Math.abs(gy) >= Math.abs(gx) : hash(ix, iy, 51) < .5;
    const alongX = hash(ix, iy, 58) < .5 ? !contour : contour;
    const sign = hash(ix, iy, 52) < .5 ? -1 : 1, run = [first];
    let prev = first, at = { ...c };
    for (let k = 1, count = 1 + Math.floor(hash(ix, iy, 53) * 3); k <= count; k++) {
      const kind = pick(hash(ix + k, iy, 54), runTable(behind(at.x, at.y)));
      const flip = kind === 'outcrop-ledge-x' ? !alongX : hash(ix, iy + k, 55) > .5;
      const scale = .85 + hash(ix, iy, 56 + k) * .25;
      const step = (halfAlong(prev.frame, prev.flip, alongX) * prev.scale + halfAlong(kind, flip, alongX) * scale) * .78;
      const side = (hash(ix - k, iy, 57) - .5) * 1.1;
      const x = at.x + (alongX ? sign * step : side), y = at.y + (alongX ? side : sign * step);
      if (/cliff|crag|cluster/.test(kind) && behind(x, y) < (kind === 'outcrop-cluster' ? 6 : 17)) break;
      const piece = grow(kind, x, y, scale, flip, prev.cluster, run);
      if (!piece) break;
      run.push(piece); prev = piece; at = { x, y };
    }
  };
  const ys = road.tiles.map(p => p.y), top = Math.max(...ys) + .5, bottom = Math.min(...ys) - .5;
  const left = extent.minX, right = extent.maxX;
  for (let row = 0, gy = top + (world.zones ? 0 : 26); gy >= bottom - (world.zones ? 0 : 26); row++, gy -= 2.4) {
    for (let gx = left + (row % 2) * 1.2; gx <= right; gx += 2.4) {
      const ix = Math.round(gx * 10), iy = Math.round(gy * 10);
      const x = gx + (hash(ix, iy, 41) - .5) * 2.2, y = gy + (hash(ix, iy, 42) - .5) * 2.2;
      const d = distance.get(key(Math.round(x), Math.round(y)));
      if (d === undefined || d < 2 || d > 26 || hash(ix, iy, 43) > (d < 6 ? .8 : d < 12 ? .62 : d < 20 ? .42 : .3)) continue;
      const kind = pick(hash(ix, iy, 44), groveTable(behind(x, y), d));
      const placedGrove = grow(kind, x, y, .8 + hash(ix, iy, 45) * .35, hash(ix, iy, 46) > .5, `road-grove-${ix},${iy}`);
      if (placedGrove && stoneKinds.includes(kind) && d >= 4 && hash(ix, iy, 50) < .75) stoneRun(placedGrove, ix, iy);
    }
  }

  // 4. Ankle-high tufts on the walkable meadow, never on the worn road or
  // at a landmark. They lie on the ground like the camp's.
  const paving = new Set((road.paving ?? []).map(p => key(p.x, p.y)));
  const nearPaving = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (paving.has(key(Math.round(x) + dx, Math.round(y) + dy)) && Math.hypot(Math.round(x) + dx - x, Math.round(y) + dy - y) < 1.6) return true;
    }
    return false;
  };
  const spots = [...road.tiles].sort((a, b) => a.y - b.y || a.x - b.x)
    .filter(p => !((p.x + p.y) % 2 || hash(p.x, p.y, 21) < .5))
    .map(p => ({ x: p.x + (hash(p.x, p.y, 22) - .5) * 1.6, y: p.y + (hash(p.x, p.y, 23) - .5) * 1.6, seed: [p.x, p.y] }));
  for (const { x, y, seed: [i, j] } of [...spots, ...tufts]) {
    if (!walk.has(key(Math.round(x), Math.round(y))) || !inRoad(x, y) || nearPaving(x, y)) continue;
    if (reserved.some(q => Math.hypot(q.x - x, q.y - y) < q.radius)) continue;
    const tuft = registerPanorama(hash(i, j, 24) < .7 ? 'grass-tuft' : 'fern-tuft', x, y, .8 + hash(i, j, 25) * .4, hash(i, j, 26) > .5);
    scenery.push({ ...tuft, cluster: `road-tuft-${i},${j}` });
  }
  const order = (a, b) => a.contact.y - b.contact.y || a.contact.x - b.contact.x || a.frame.localeCompare(b.frame);
  return { border: border.sort(order), scenery: scenery.sort(order) };
}
