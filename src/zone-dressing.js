// Set dressing of a side zone in the courtyard's placement contract (courtyard-layout.js): x/y
// register the sprite's lower anchor; contact and collider(s) are ground centres. The zone file
// authors its landmarks and edges; this module adds a low blocker at every bare edge of the walk
// mask, then the courtyard's spill and outer lattice, inside the zone's area box only.
// Rows and results are in the zone's local coordinates; placement works in world coordinates.
import cemeteryPackage from '../assets/game/pixel-v13/cemetery/manifest.json' with { type: 'json' };
import orchardPackage from '../assets/game/pixel-v13/orchard/manifest.json' with { type: 'json' };
import ruinsPackage from '../assets/game/pixel-v11/monastery-ruins/manifest.json' with { type: 'json' };
import panoramaPackage from '../assets/game/pixel-v9/camp-panorama/manifest.json' with { type: 'json' };
import { SIDE_ZONES, SPINE_WALK, inSideArea } from './side-zones.js';

const diagonalPixels = 32 * Math.SQRT2;
const key = (x, y) => `${x},${y}`;
const hash = (x, y, salt) => {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
const pick = (n, table) => {
  let total = 0;
  for (const [kind, weight] of table) if ((total += weight) > n) return kind;
  return table.at(-1)[0];
};
const toWorld = (du, dv) => ({ x: (2 * dv - du) / diagonalPixels, y: (2 * dv + du) / diagonalPixels });
const cellsOf = regions => {
  const cells = new Map();
  for (const [x0, x1, y0, y1] of regions) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.set(key(x, y), { x, y });
  return cells;
};

// A kind is looked up in the zone's own pixel-v13 atlas, then the v11 ruins, then the v9 camp.
// All three share the 256 px cell and the [128,232] anchor.
const ATLASES = {
  cemetery: { anchor: cemeteryPackage.cemetery.anchor, footprints: cemeteryPackage.footprints },
  orchard: { anchor: orchardPackage.orchard.anchor, footprints: orchardPackage.footprints },
  monasteryRuins: { anchor: ruinsPackage.monasteryRuins.anchor, footprints: ruinsPackage.footprints },
  campPanorama: { anchor: panoramaPackage.campPanorama.anchor, footprints: panoramaPackage.footprints },
};
export function sideFootprint(zoneId, kind) {
  for (const atlas of [ATLASES[zoneId], ATLASES.monasteryRuins, ATLASES.campPanorama]) {
    if (atlas.footprints[kind]) return { atlas, f: atlas.footprints[kind] };
  }
  throw new Error(`Unknown ${zoneId} prop: ${kind}`);
}
// Drawn base of a frame at a contact centre: one box per collider, a circle or a box.
const extentsOf = (f, x, y) => f.colliders ? f.colliders.map(c => ({ x: x + c.x, y: y + c.y, rx: c.halfWidth, ry: c.halfDepth }))
  : f.shape === 'circle' ? [{ x, y, rx: f.radius, ry: f.radius, round: true }] : [{ x, y, rx: f.halfWidth, ry: f.halfDepth }];
// Spacing radius around the contact centre.
const sizeOf = f => f.shape === 'circle' ? f.radius : f.colliders
  ? Math.max(...f.colliders.map(c => Math.hypot(c.x, c.y) + Math.max(c.halfWidth, c.halfDepth))) : Math.max(f.halfWidth, f.halfDepth);
const flat = f => f.role === 'flat' || f.role === 'overlay';

// zoneId: a SIDE_ZONES id. regions: the zone's local walk regions. rows: authored props
// [id, kind, x, y] by contact centre. tables: weighted kinds for the edge filler (`edge`, then
// `edgeSmall`), the spill and the outer bands (`near`, `mid`, `far` by empty ground behind).
// salt: the zone's hash salt. outerDensity thins only non-colliding outer groves, after placement.
// No prop is mirrored: v13 frames draw each orientation themselves.
export function dressSideZone(zoneId, { regions, rows, tables, salt, outerDensity = 1 }) {
  const { offset, area } = SIDE_ZONES[zoneId];
  const own = [...cellsOf(regions.map(([x0, x1, y0, y1]) => [x0 + offset.x, x1 + offset.x, y0 + offset.y, y1 + offset.y])).values()];
  // The zone's cells and the spine's: no prop touches either, and tall props keep off both.
  const walk = new Set([...own.map(p => key(p.x, p.y)), ...cellsOf(SPINE_WALK).keys()]);
  const setDressing = [], standing = [];

  function put(kind, cx, cy, id) {
    const { atlas, f } = sideFootprint(zoneId, kind);
    const shift = toWorld(f.contactCenter[0] - atlas.anchor[0], f.contactCenter[1] - atlas.anchor[1]);
    const p = { id, kind, x: cx - shift.x - offset.x, y: cy - shift.y - offset.y, scale: 1, flip: false };
    const contact = { x: cx - offset.x, y: cy - offset.y };
    if (flat(f)) Object.assign(p, { layer: 'ground', contact, ...(f.shape === 'circle' ? {} : { area: { halfWidth: f.halfWidth, halfDepth: f.halfDepth } }) });
    else if (f.colliders) Object.assign(p, { contact, colliders: f.colliders.map(c => ({ x: contact.x + c.x, y: contact.y + c.y, halfWidth: c.halfWidth, halfDepth: c.halfDepth })) });
    else p.collider = { ...contact, ...(f.shape === 'circle' ? { radius: f.radius } : { halfWidth: f.halfWidth, halfDepth: f.halfDepth }) };
    setDressing.push(p);
    if (!flat(f)) standing.push({ x: cx, y: cy, f, size: sizeOf(f) });
    return p;
  }
  for (const [id, kind, x, y] of rows) put(kind, x + offset.x, y + offset.y, id);

  // Screen depth to walkable ground straight up the screen from a point.
  const behind = (x, y) => {
    for (let k = 1; k <= 30; k++) if (walk.has(key(Math.round(x - k * Math.SQRT1_2), Math.round(y - k * Math.SQRT1_2)))) return k;
    return Infinity;
  };
  const touchesWalk = (f, x, y) => extentsOf(f, x, y).some(e => {
    for (let cy = Math.floor(e.y - e.ry - 1); cy <= Math.ceil(e.y + e.ry + 1); cy++) {
      for (let cx = Math.floor(e.x - e.rx - 1); cx <= Math.ceil(e.x + e.rx + 1); cx++) {
        if (walk.has(key(cx, cy)) && Math.hypot(Math.max(0, Math.abs(e.x - cx) - .5 - e.rx), Math.max(0, Math.abs(e.y - cy) - .5 - e.ry)) < .02) return true;
      }
    }
    return false;
  });
  const gapTo = (q, x, y) => Math.min(...extentsOf(q.f, q.x, q.y).map(e =>
    Math.hypot(Math.max(0, Math.abs(x - e.x) - e.rx), Math.max(0, Math.abs(y - e.y) - e.ry))));

  // 1. Every edge of the walk mask without a prop within 1.15 of its midpoint gets a low blocker
  // just outside. A side entrance is not an edge: the spine's walk continues there.
  const edges = [];
  for (const p of own) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (!walk.has(key(p.x + dx, p.y + dy))) edges.push({ x: p.x, y: p.y, dx, dy });
  }
  edges.sort((a, b) => a.y - b.y || a.x - b.x || a.dy - b.dy || a.dx - b.dx);
  for (const e of edges) {
    const mx = e.x + e.dx * .5, my = e.y + e.dy * .5;
    if (standing.some(q => gapTo(q, mx, my) < 1.15)) continue;
    const n = hash(e.x * 2 + e.dx, e.y * 2 + e.dy, salt + 11), tangent = (hash(e.x, e.y, salt + 12) - .5) * .5;
    // The picked kind, else the smallest one; a blocker that would touch another cell is skipped.
    for (const kind of [pick(n, tables.edge), tables.edgeSmall]) {
      const { f } = sideFootprint(zoneId, kind);
      const reach = (f.shape === 'circle' ? f.radius : e.dx ? f.halfWidth : f.halfDepth) + .05;
      const x = mx + e.dx * reach - e.dy * tangent, y = my + e.dy * reach + e.dx * tangent;
      if (touchesWalk(f, x, y)) continue;
      put(kind, x, y, `edge-${e.x - offset.x},${e.y - offset.y},${e.dx},${e.dy}`);
      break;
    }
  }

  // Grid steps from the zone's walk mask, for the spill and the outer country.
  const reach = new Map(own.map(p => [key(p.x, p.y), 0])), queue = [...own];
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i], d = reach.get(key(p.x, p.y)) + 1;
    if (d > 22) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const id = key(p.x + dx, p.y + dy);
      if (!reach.has(id)) { reach.set(id, d); queue.push({ x: p.x + dx, y: p.y + dy }); }
    }
  }
  const walkNear = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (walk.has(key(Math.round(x) + dx, Math.round(y) + dy))) return true;
    return false;
  };
  // Inside the box, a cell or more from any walk cell, clear of other props, and low wherever
  // walkable ground lies close behind: a prop taller than 1.1 needs 2h + 1 of it.
  const grow = (kind, x, y, id) => {
    const { f } = sideFootprint(zoneId, kind), size = sizeOf(f);
    if (!inSideArea(area, x, y) || walkNear(x, y) || (reach.get(key(Math.round(x), Math.round(y))) ?? 99) < 2) return;
    if (f.height > 1.1 && behind(x, y) < 2 * f.height + 1) return;
    if (standing.some(q => Math.hypot(q.x - x, q.y - y) < size + q.size + .25)) return;
    put(kind, x, y, id);
  };
  const xs = own.map(p => p.x), ys = own.map(p => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs) - 22, Math.max(...xs) + 22, Math.min(...ys) - 22, Math.max(...ys) + 22];
  const lattice = (gx, gy) => `${Math.round((gx - offset.x) * 10)},${Math.round((gy - offset.y) * 10)}`;
  // 2. The spill: a sparse ring 2..6 cells out.
  for (let row = 0, gy = y0; gy <= y1; row++, gy += 3.1) for (let gx = x0 + (row % 2) * 1.5; gx <= x1; gx += 3.1) {
    const ix = Math.round(gx * 10), iy = Math.round(gy * 10);
    const x = gx + (hash(ix, iy, salt + 61) - .5) * 2.4, y = gy + (hash(ix, iy, salt + 62) - .5) * 2.4;
    const d = reach.get(key(Math.round(x), Math.round(y)));
    if (d === undefined || d < 2 || d > 6 || hash(ix, iy, salt + 63) > .34) continue;
    grow(pick(hash(ix, iy, salt + 64), tables.spill), x, y, `spill-${lattice(gx, gy)}`);
  }
  // 3. The outer country: staggered, jittered rows that thin out with distance.
  for (let row = 0, gy = y0; gy <= y1; row++, gy += 2.4) for (let gx = x0 + (row % 2) * 1.2; gx <= x1; gx += 2.4) {
    const ix = Math.round(gx * 10), iy = Math.round(gy * 10);
    const x = gx + (hash(ix, iy, salt + 41) - .5) * 2.2, y = gy + (hash(ix, iy, salt + 42) - .5) * 2.2;
    const d = reach.get(key(Math.round(x), Math.round(y)));
    if (d === undefined || d < 2 || hash(ix, iy, salt + 43) > (d < 6 ? .8 : d < 12 ? .62 : .4)) continue;
    const depth = behind(x, y);
    grow(pick(hash(ix, iy, salt + 44), depth < 6 ? tables.near : depth < 17 ? tables.mid : tables.far), x, y, `grove-${lattice(gx, gy)}`);
  }

  // At an inward corner both jittered candidates can clip the perpendicular walk cell.
  // Fill only edges still bare after the outer country, so a centred fallback does not
  // displace any successful edge or grove. Existing layouts keep their placements.
  for (const e of edges) {
    const mx = e.x + e.dx * .5, my = e.y + e.dy * .5;
    if (standing.some(q => gapTo(q, mx, my) < 1.15)) continue;
    const { f } = sideFootprint(zoneId, tables.edgeSmall);
    const reach = (f.shape === 'circle' ? f.radius : e.dx ? f.halfWidth : f.halfDepth) + .05;
    const x = mx + e.dx * reach, y = my + e.dy * reach;
    if (!touchesWalk(f, x, y)) put(tables.edgeSmall, x, y, `edge-centred-${e.x - offset.x},${e.y - offset.y},${e.dx},${e.dy}`);
  }

  // Only blockers within 1.2 of a walk cell take part in collision, as in the courtyard.
  for (const p of setDressing) {
    const c = p.collider;
    if (!c) continue;
    const rx = c.radius ?? c.halfWidth, ry = c.radius ?? c.halfDepth, wx = c.x + offset.x, wy = c.y + offset.y;
    let near = false;
    for (let y = Math.floor(wy - ry - 1.5); y <= Math.ceil(wy + ry + 1.5) && !near; y++) {
      for (let x = Math.floor(wx - rx - 1.5); x <= Math.ceil(wx + rx + 1.5); x++) {
        if (walk.has(key(x, y)) && Math.hypot(Math.max(0, Math.abs(x - wx) - rx), Math.max(0, Math.abs(y - wy) - ry)) < 1.2) { near = true; break; }
      }
    }
    if (!near) { p.contact = { x: c.x, y: c.y }; delete p.collider; }
  }
  // The expanded frame has a longer perimeter. Keep the authored clusters, every collider,
  // and every prop that marks an edge; thin only distant procedural grove sprites. Doing this
  // after all placement keeps navigation, random encounters and neighbouring props identical.
  if (outerDensity >= 1) return setDressing;
  return setDressing.filter(p => {
    if (!p.id.startsWith('grove-') || p.collider || p.colliders || p.layer) return true;
    const x = p.contact.x + offset.x, y = p.contact.y + offset.y;
    if (hash(Math.round(x * 10), Math.round(y * 10), salt + 73) <= outerDensity) return true;
    const q = { x, y, f: sideFootprint(zoneId, p.kind).f };
    return edges.some(e => gapTo(q, e.x + e.dx * .5, e.y + e.dy * .5) < 1.15);
  });
}
