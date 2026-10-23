import contacts from '../assets/concepts/camp-plan-01/source/natural-contacts.json' with { type: 'json' };
import { countryZoneLookup } from './country-zones.js';
import { campBackdrop } from './country-terrain.js';
import { inBackdrop } from './camp-layout.js';

const key = (x, y) => `${x},${y}`;
const noise = (x, y, salt) => {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
// Native opaque bounds of the unchanged v4 atlas. Ruin support uses the same
// lower-arc circle fit as natural-contacts.json, columns 51..109, rows 123..143.
const bounds = {
  cypress: [60, 16, 101, 144], 'dead-tree': [35, 32, 125, 144],
  'rock-large': [52, 100, 109, 144], 'rock-small': [67, 124, 94, 144],
  shrub: [64, 114, 96, 144], grass: [72, 126, 88, 144],
  'ruin-pile': [51, 94, 110, 144], supplies: [54, 94, 107, 144],
};
const project = (x, y) => [(y - x) * 32 / Math.SQRT2, (x + y) * 16 / Math.SQRT2];

// Extrema of (2 * pixelY - pixelX, 2 * pixelY + pixelX) over the
// opaque pixel corners of the unchanged atlas. These bound the entire stone
// drawing in the ground plane, including a top face projecting over a foot.
const stoneFootprints = {
  'ruin-pile': [118, 206, 254, 379],
  'rock-large': [123, 214, 272, 381],
  'rock-small': [164, 215, 329, 370],
};

function stoneOverlapsGround(p, walk) {
  const shape = stoneFootprints[p.frame];
  const [cx, cy] = contacts.frames[p.frame]?.contactCenter ?? [84.75, 127.75];
  const scale = p.scale / (32 * Math.SQRT2);
  let x0 = (shape[0] - 2 * cy + cx) * scale, x1 = (shape[1] - 2 * cy + cx) * scale;
  let y0 = (shape[2] - 2 * cy - cx) * scale, y1 = (shape[3] - 2 * cy - cx) * scale;
  if (p.flip) [x0, x1, y0, y1] = [y0, y1, x0, x1];
  // A small bare-ground gap covers the .03u drawing offset and spread feet.
  const gap = .22;
  for (let y = Math.ceil(p.contact.y + y0 - gap - .5); y <= Math.floor(p.contact.y + y1 + gap + .5); y++) {
    for (let x = Math.ceil(p.contact.x + x0 - gap - .5); x <= Math.floor(p.contact.x + x1 + gap + .5); x++) {
      if (walk.has(key(x, y))) return true;
    }
  }
  return false;
}

function register(frame, x, y, scale = 1, flip = false) {
  const center = contacts.frames[frame]?.contactCenter ?? (frame === 'ruin-pile' ? [84.75, 127.75] : [80, 144]);
  const u = (center[0] - 80) * scale * (flip ? -1 : 1), v = (center[1] - 144) * scale;
  return { frame, x: x - (2 * v - u) / (32 * Math.SQRT2), y: y - (2 * v + u) / (32 * Math.SQRT2),
    height: 0, scale, flip, contact: { x, y } };
}

export function createCountryBorder(world, boundary, walk) {
  const zoneAt = countryZoneLookup(world);
  const reserved = [...(world.portals ?? []), world.shrine, world.secret, world.ritual, world.reward,
    world.spawn, ...Object.values(world.entries ?? {})].filter(Boolean);
  const corridors = (world.portals ?? []).map(portal => {
    const edge = [...boundary].sort((a, b) => Math.hypot(a.x + a.dx * .5 - portal.x, a.y + a.dy * .5 - portal.y)
      - Math.hypot(b.x + b.dx * .5 - portal.x, b.y + b.dy * .5 - portal.y))[0];
    return { ...portal, dx: edge?.dx ?? 0, dy: edge?.dy ?? 1 };
  });
  const backdrop = campBackdrop(world);
  const allowScenery = p => {
    const { x, y } = p.contact;
    if (walk.has(key(Math.round(x), Math.round(y))) || inBackdrop(backdrop, x, y, .3)) return false;
    if (reserved.some(q => Math.hypot(q.x - x, q.y - y) < 2.2)) return false;
    const scale = p.scale ?? 1, radius = .45 * scale;
    for (const q of corridors) {
      const dx = x - q.x, dy = y - q.y, along = dx * q.dx + dy * q.dy, across = dx * q.dy - dy * q.dx;
      if (along > -3 && along < 10 && Math.abs(across) < 1.6 + radius) return false;
      // A distant tree may stand outside the ground corridor but project over
      // the portal. Reserve the actual opaque rectangle in the fixed view too.
      const box = bounds[p.frame], [u, v] = project(p.x, p.y), [pu, pv] = project(q.x, q.y);
      const left = u + ((p.flip ? 160 - box[2] : box[0]) - 80) * scale;
      const right = u + ((p.flip ? 160 - box[0] : box[2]) - 80) * scale;
      const top = v + (box[1] - 144) * scale, bottom = v + (box[3] - 144) * scale;
      if (left < pu + 22 && right > pu - 22 && top < pv + 18 && bottom > pv - 18) return false;
    }
    return true;
  };
  const placements = [];
  if (!world.zones && world.id !== 'road' && world.id !== 'courtyard') return { placements, register, allowScenery };

  const outer = new Map();
  for (const edge of boundary) {
    const x = edge.x + edge.dx, y = edge.y + edge.dy, id = key(x, y);
    if (!outer.has(id)) outer.set(id, { x, y, nx: 0, ny: 0 });
    const p = outer.get(id); p.nx += edge.dx; p.ny += edge.dy;
  }
  const candidates = [...outer.values()].sort((a, b) => noise(a.x, a.y, 81) - noise(b.x, b.y, 81) || a.y - b.y || a.x - b.x);
  const add = (frame, x, y, scale, seed, group) => {
    if (world.zones && zoneAt(x, y).id === 'camp') return null;
    const p = register(frame, x, y, scale, noise(seed.x, seed.y, 85) > .5);
    if (!allowScenery(p)) return null;
    p.border = true; p.cluster = group;
    placements.push(p); return p;
  };
  const primary = [];
  for (const q of candidates) {
    const zone = zoneAt(q.x, q.y).id;
    if (zone === 'camp') continue;
    const length = Math.hypot(q.nx, q.ny) || 1, nx = q.nx / length, ny = q.ny / length;
    const outward = noise(q.x, q.y, 82) * .4, tangent = (noise(q.x, q.y, 83) - .5) * .65;
    const x = q.x + nx * outward - ny * tangent, y = q.y + ny * outward + nx * tangent;
    if (primary.some(p => Math.hypot(p.contact.x - x, p.contact.y - y) < 1.6 + noise(q.x, q.y, 84) * .6)) continue;
    const gx = Math.floor(q.x / 5), gy = Math.floor(q.y / 5), sector = noise(gx, gy, 86);
    const frame = zone === 'courtyard' && sector < .56 ? 'ruin-pile'
      : sector < .4 ? 'shrub' : 'rock-large';
    const scale = (frame === 'shrub' ? 1.7 : 1.15) + noise(q.x, q.y, 87) * .45;
    const group = key(gx, gy), p = add(frame, x, y, scale, q, group);
    if (!p) continue;
    primary.push(p);
    // Trees grow in pockets behind the low boundary, never as a picket line.
    if (noise(q.x, q.y, 88) < (zone === 'road' ? .48 : .16)) {
      add(noise(q.x, q.y, 89) < .6 ? 'cypress' : 'dead-tree', x + nx * 2.4, y + ny * 2.4,
        1.1 + noise(q.x, q.y, 90) * .45, q, group);
    }
  }
  // Close only unreadable gaps with low, varied accents. Their spacing and
  // outward/tangent offsets remain independent of a uniform tile outline.
  for (const q of boundary) {
    if (zoneAt(q.x, q.y).id === 'camp') continue;
    const x = q.x + q.dx * .5, y = q.y + q.dy * .5;
    if (placements.some(p => Math.hypot(p.contact.x - x, p.contact.y - y) < 1.65)) continue;
    const tangent = (noise(q.x, q.y, 91) - .5) * .5;
    add(noise(q.x, q.y, 92) < .5 ? 'shrub' : 'rock-small', q.x + q.dx * .9 - q.dy * tangent,
      q.y + q.dy * .9 + q.dx * tangent, 1.3 + noise(q.x, q.y, 93) * .5, q, key(Math.floor(x / 5), Math.floor(y / 5)));
  }
  // Preserve the chosen groups, frames, sizes and fitted registration. Only
  // slide hard border objects outward until their visible footprint is clear;
  // checking just the contact point lets group-0 stone appear under the hero.
  for (const p of placements) {
    if (!stoneFootprints[p.frame] || !stoneOverlapsGround(p, walk)) continue;
    const distance = edge => Math.hypot(p.contact.x - edge.x - edge.dx * .5, p.contact.y - edge.y - edge.dy * .5);
    const edge = boundary.reduce((nearest, q) => distance(q) < distance(nearest) ? q : nearest);
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
      .map(([dx, dy]) => ({ dx: dx / Math.hypot(dx, dy), dy: dy / Math.hypot(dx, dy) }))
      .filter(d => d.dx * edge.dx + d.dy * edge.dy >= 0)
      .sort((a, b) => b.dx * edge.dx + b.dy * edge.dy - a.dx * edge.dx - a.dy * edge.dy);
    let placed = false;
    // A stair-shaped/concave outline may need a diagonal setback. Choose the
    // shortest nearby clear position, never march a prop along the whole map.
    for (let step = 1; step <= 48 && !placed; step++) for (const d of directions) {
      const dx = d.dx * step / 8, dy = d.dy * step / 8;
      const candidate = { ...p, x: p.x + dx, y: p.y + dy, contact: { x: p.contact.x + dx, y: p.contact.y + dy } };
      if ((world.zones && zoneAt(candidate.contact.x, candidate.contact.y).id === 'camp') ||
        !allowScenery(candidate) || stoneOverlapsGround(candidate, walk)) continue;
      Object.assign(p, candidate); placed = true; break;
    }
    if (!placed) p.omit = true;
  }
  const clearPlacements = placements.filter(p => !p.omit);
  clearPlacements.sort((a, b) => a.contact.y - b.contact.y || a.contact.x - b.contact.x || a.frame.localeCompare(b.frame));
  return { placements: clearPlacements, register, allowScenery };
}
