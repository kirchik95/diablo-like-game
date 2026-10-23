export const SPAWN = { x: 0, y: 4.8 };
export const EXIT = { x: 0, y: -5.5 };
export const SHRINE = { x: -5.5, y: 0 };
export const HOUND_SPAWNS = [{ x: 0, y: -.6 }];

const regions = [
  [-4, 4, -4, 4], [-1, 1, 5, 6], [-1, 1, -6, -5], [-6, -5, -1, 1],
];
export const TILES = [];
const tileSet = new Set();
for (const [x0, x1, y0, y1] of regions) {
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const key = `${x},${y}`;
    if (!tileSet.has(key)) {
      tileSet.add(key);
      TILES.push({ x, y });
    }
  }
}

// Ground centers of the column plinths; pixel props offset their bottom anchors.
export const PILLARS = [
  { x: -3.7, y: -3.5, height: 2.8 }, { x: 3.7, y: -3.5, height: 2.8 },
  { x: -3.7, y: 3.5, height: 1.5 },
];
export const BRAZIERS = [
  { x: -3, y: -1.4, color: 'cyan' }, { x: 3, y: -1.4, color: 'pink' },
  { x: -.95, y: 5.3, color: 'cyan' }, { x: .95, y: -5.1, color: 'pink' },
];
export const OBSTACLES = [
  // The 64x32 px contact diamond at 32 px/unit is a square of side sqrt(2).
  ...PILLARS.map(p => ({ x: p.x, y: p.y, halfSize: Math.SQRT1_2 })),
  ...BRAZIERS.map(p => ({ x: p.x, y: p.y, radius: 0.22 })),
];

const locationTiles = new WeakMap();
export function hasTile(x, y, world) {
  let cells = tileSet;
  if (world) {
    if (!locationTiles.has(world)) locationTiles.set(world, new Set(world.tiles.map(p => `${p.x},${p.y}`)));
    cells = locationTiles.get(world);
  }
  return cells.has(`${Math.round(x)},${Math.round(y)}`);
}

export function isWalkable(x, y, radius = 0.24, world) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [.707, .707], [-.707, .707], [.707, -.707], [-.707, -.707]]) {
    if (!hasTile(x + dx * radius, y + dy * radius, world)) return false;
  }
  return !(world?.obstacles ?? OBSTACLES).some(o => {
    const halfWidth = o.halfWidth ?? o.halfSize;
    const halfDepth = o.halfDepth ?? o.halfSize;
    if (halfWidth !== undefined && halfDepth !== undefined) {
      const dx = Math.abs(x - o.x) - halfWidth;
      const dy = Math.abs(y - o.y) - halfDepth;
      return Math.max(dx, dy) < 0 || Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) < radius;
    }
    return Math.hypot(x - o.x, y - o.y) < radius + o.radius;
  });
}

export function moveBody(body, dx, dy, world) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.12));
  const sx = dx / steps, sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (isWalkable(body.x + sx, body.y + sy, body.radius, world)) { body.x += sx; body.y += sy; }
    else {
      if (isWalkable(body.x + sx, body.y, body.radius, world)) body.x += sx;
      if (isWalkable(body.x, body.y + sy, body.radius, world)) body.y += sy;
    }
  }
}

export function findPath(from, to, radius = .29, world) {
  const validTiles = (world?.tiles ?? TILES).filter(p => isWalkable(p.x, p.y, radius, world));
  const nearest = point => [...validTiles].sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y));
  const start = nearest(from).find(p => clearLine(from, p, radius, world));
  const target = nearest(to)[0];
  if (!start || !target) return [];
  const key = p => `${p.x},${p.y}`;
  const queue = [start], visited = new Map([[key(start), null]]);
  let found = null;
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (key(p) === key(target)) { found = p; break; }
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (!visited.has(key(n)) && isWalkable(n.x, n.y, radius, world) && clearLine(p, n, radius, world)) {
        visited.set(key(n), p);
        queue.push(n);
      }
    }
  }
  if (!found) return [];
  const path = [];
  while (found) { path.unshift(found); found = visited.get(key(found)); }
  return [{ x: from.x, y: from.y }, ...path];
}

export function clearLine(from, to, radius = 0.25, world) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.ceil(distance / 0.15);
  for (let i = 1; i <= steps; i++) {
    if (!isWalkable(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps, radius, world)) return false;
  }
  return true;
}
