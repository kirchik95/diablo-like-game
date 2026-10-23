import { isWalkable } from './world.js';
import { BEETLE_STATS } from './campaign.js';

export const DEFAULT_WORLD_SEED = 20261023;

// Authored encounter areas preserve the route's pacing, not individual rows.
// Member indices in `ranged` become wraiths, in `armored` beetles, the rest hounds.
const areas = [
  { id: 'road-approach', zoneId: 'road', x: 0, y: -41.8, rx: 3.1, ry: 2.8, count: 5, ranged: [4], armored: [] },
  { id: 'road-crossing', zoneId: 'road', x: .5, y: -53, rx: 3.2, ry: 2.8, count: 6, ranged: [4, 5], armored: [0] },
  { id: 'road-gate', zoneId: 'road', x: 0, y: -63.8, rx: 3.1, ry: 2.7, count: 5, ranged: [2], armored: [0] },
  { id: 'road-thicket', zoneId: 'road', x: -15.4, y: -47.5, rx: 3, ry: 4.7, count: 6, ranged: [1, 4], armored: [2] },
  { id: 'court-entrance', zoneId: 'courtyard', x: 0, y: -80.6, rx: 5.5, ry: 2.9, count: 6, ranged: [3, 4], armored: [1] },
  { id: 'court-source', zoneId: 'courtyard', x: 0, y: -89.3, rx: 4.7, ry: 3.5, count: 6, ranged: [3, 4], armored: [0] },
];
// Spawn clearance keeps the same .25 margin around the wider beetle body.
const SPAWN_CLEARANCE = { hound: .54, wraith: .54, beetle: BEETLE_STATS.radius + .25 };

export function normalizeWorldSeed(seed = DEFAULT_WORLD_SEED) {
  return Number.isFinite(seed) ? seed >>> 0 : DEFAULT_WORLD_SEED;
}

function randomFor(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(state ^ (state >>> 15), state | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export function createEncounterLayout(world, seed = DEFAULT_WORLD_SEED) {
  const placed = [], reserved = [world.shrine, world.secret, world.ritual].filter(Boolean);
  for (const [areaIndex, area] of areas.entries()) {
    const random = randomFor(normalizeWorldSeed(seed) ^ Math.imul(areaIndex + 1, 0x9e3779b1));
    const members = [];
    const accept = point => {
      const index = members.length;
      const kind = area.ranged.includes(index) ? 'wraith' : area.armored.includes(index) ? 'beetle' : 'hound';
      if (!isWalkable(point.x, point.y, SPAWN_CLEARANCE[kind], world) || point.y >= world.safeArea.minY - 7
        || Math.abs(point.y + 70.5) < 3) return false;
      if (reserved.some(p => Math.hypot(point.x - p.x, point.y - p.y) < 2.2)) return false;
      if (placed.some(p => Math.hypot(point.x - p.x, point.y - p.y) < 1.35)) return false;
      // Avoid three almost-aligned members on either world or isometric axis.
      for (const project of [p => p.x, p => p.y, p => p.x + p.y, p => p.y - p.x]) {
        if (members.filter(p => Math.abs(project(p) - project(point)) < .18).length >= 2) return false;
      }
      const enemy = { id: `${area.id}-${index + 1}`, kind, zoneId: area.zoneId, packId: area.id, ...point };
      members.push(enemy); placed.push(enemy);
      return true;
    };
    for (let attempt = 0; attempt < 768 && members.length < area.count; attempt++) {
      const angle = random() * Math.PI * 2, radius = Math.sqrt(random());
      accept({ x: area.x + Math.cos(angle) * radius * area.rx, y: area.y + Math.sin(angle) * radius * area.ry });
    }
    // A finite, deterministic fallback covers unlucky rejection sequences.
    // It follows a rotated spiral rather than putting actors back on grid rows.
    const rotation = random() * Math.PI * 2;
    for (let i = 1; i <= 1024 && members.length < area.count; i++) {
      const angle = rotation + i * Math.PI * (3 - Math.sqrt(5)), radius = Math.sqrt(i / 1024);
      accept({ x: area.x + Math.cos(angle) * radius * area.rx, y: area.y + Math.sin(angle) * radius * area.ry });
    }
    if (members.length !== area.count) throw new Error(`Cannot place encounter ${area.id} for seed ${seed}`);
  }
  return placed;
}
