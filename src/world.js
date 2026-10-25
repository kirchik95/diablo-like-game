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
function tileRows(tiles) {
  const rows = new Map();
  for (const p of tiles) {
    if (!rows.has(p.x)) rows.set(p.x, new Set());
    rows.get(p.x).add(p.y);
  }
  return rows;
}
const defaultTileRows = tileRows(TILES);

// Integer tile keys become one byte each. Math.round only ever asks for integers,
// so a non-integer tile falls back to the map and stays unreachable, as before.
const tileBits = new WeakMap();
let defaultBits;
function integerTileBits(tiles) {
  if (!tiles.length) return { minX: 0, minY: 0, maxX: -1, maxY: -1, width: 0, height: 0, bits: new Uint8Array(0) };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of tiles) {
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) return null;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const width = maxX - minX + 1, height = maxY - minY + 1;
  if (width > 10000 || height > 10000 || width * height > 2_000_000) return null;
  const bits = new Uint8Array(width * height);
  for (const p of tiles) bits[(p.y - minY) * width + (p.x - minX)] = 1;
  return { minX, minY, maxX, maxY, width, height, bits };
}
function bitsFor(world) {
  if (!world) {
    if (defaultBits === undefined) defaultBits = integerTileBits(TILES);
    return defaultBits;
  }
  let bits = tileBits.get(world);
  if (bits === undefined) {
    bits = world.tiles ? integerTileBits(world.tiles) : null;
    tileBits.set(world, bits);
  }
  return bits;
}
function bitHas(bits, ix, iy) {
  if (ix < bits.minX || iy < bits.minY || ix > bits.maxX || iy > bits.maxY) return false;
  return bits.bits[(iy - bits.minY) * bits.width + (ix - bits.minX)] === 1;
}

export function hasTile(x, y, world) {
  const bits = bitsFor(world);
  if (bits) return bitHas(bits, Math.round(x), Math.round(y));
  let cells = defaultTileRows;
  if (world) {
    if (!locationTiles.has(world)) locationTiles.set(world, tileRows(world.tiles));
    cells = locationTiles.get(world);
  }
  return cells.get(Math.round(x))?.has(Math.round(y)) ?? false;
}

const bodySamples = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [.707, .707], [-.707, .707], [.707, -.707], [-.707, -.707]];
const obstacleGrids = new WeakMap(), OBSTACLE_CELL = 2;

// Only immutable scenery can be indexed. Test arenas and other mutable worlds
// still read their current colliders on every query, including in-place edits.
function obstacleGrid(obstacles) {
  if (!Object.isFrozen(obstacles)) return null;
  if (obstacleGrids.has(obstacles)) return obstacleGrids.get(obstacles);
  let grid = null;
  if (obstacles.every(Object.isFrozen)) grid = buildObstacleGrid(obstacles);
  obstacleGrids.set(obstacles, grid);
  return grid;
}

function buildObstacleGrid(obstacles) {
  const cell = OBSTACLE_CELL, spans = [];
  let minCX = Infinity, minCY = Infinity, maxCX = -Infinity, maxCY = -Infinity;
  for (const o of obstacles) {
    const halfWidth = o.halfWidth ?? o.halfSize, halfDepth = o.halfDepth ?? o.halfSize;
    const rectangle = halfWidth !== undefined && halfDepth !== undefined;
    const hw = rectangle ? halfWidth : o.radius, hd = rectangle ? halfDepth : o.radius;
    const x0 = Math.floor((o.x - hw) / cell), x1 = Math.floor((o.x + hw) / cell);
    const y0 = Math.floor((o.y - hd) / cell), y1 = Math.floor((o.y + hd) / cell);
    if (![x0, x1, y0, y1].every(Number.isSafeInteger) || hw < 0 || hd < 0 || (x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return null;
    if (x0 < minCX) minCX = x0;
    if (y0 < minCY) minCY = y0;
    if (x1 > maxCX) maxCX = x1;
    if (y1 > maxCY) maxCY = y1;
    spans.push(x0, x1, y0, y1);
  }
  if (!spans.length) {
    return { cell, minCX: 0, minCY: 0, width: 0, height: 0, starts: new Int32Array(0), counts: new Int32Array(0), packed: new Int32Array(0), obstacles };
  }
  const width = maxCX - minCX + 1, height = maxCY - minCY + 1;
  if (width > 20000 || height > 20000 || width * height > 2_000_000) return null;
  const counts = new Int32Array(width * height);
  for (let s = 0; s < spans.length; s += 4) {
    for (let x = spans[s]; x <= spans[s + 1]; x++) for (let y = spans[s + 2]; y <= spans[s + 3]; y++) {
      counts[(y - minCY) * width + (x - minCX)]++;
    }
  }
  const starts = new Int32Array(width * height);
  let total = 0;
  for (let i = 0; i < counts.length; i++) { starts[i] = total; total += counts[i]; }
  const packed = new Int32Array(total), cursor = starts.slice();
  for (let i = 0; i < obstacles.length; i++) {
    const s = i * 4;
    for (let x = spans[s]; x <= spans[s + 1]; x++) for (let y = spans[s + 2]; y <= spans[s + 3]; y++) {
      const index = (y - minCY) * width + (x - minCX);
      packed[cursor[index]++] = i;
    }
  }
  return { cell, minCX, minCY, width, height, starts, counts, packed, obstacles };
}

function overlapsObstacle(x, y, radius, o) {
  const halfWidth = o.halfWidth ?? o.halfSize;
  const halfDepth = o.halfDepth ?? o.halfSize;
  if (halfWidth !== undefined && halfDepth !== undefined) {
    const dx = Math.abs(x - o.x) - halfWidth;
    const dy = Math.abs(y - o.y) - halfDepth;
    // hypot is at least each axis, so a separated axis cannot overlap.
    if (dx >= radius || dy >= radius) return false;
    return Math.max(dx, dy) < 0 || Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) < radius;
  }
  const limit = radius + o.radius, dx = x - o.x, dy = y - o.y;
  if (Math.abs(dx) >= limit || Math.abs(dy) >= limit) return false;
  return Math.hypot(dx, dy) < limit;
}

// A body whose samples cannot leave the centre tile only needs that one bit.
// The margin is strict, so a point near a rounding boundary still takes all nine samples.
function samplesInside(bits, x, y, radius) {
  if (radius >= 0 && radius < 0.5) {
    const ix = Math.round(x), iy = Math.round(y), eps = 1e-9;
    if (x - radius >= ix - 0.5 + eps && x + radius < ix + 0.5 - eps
      && y - radius >= iy - 0.5 + eps && y + radius < iy + 0.5 - eps) return bitHas(bits, ix, iy);
  }
  for (let i = 0; i < bodySamples.length; i++) {
    const ix = Math.round(x + bodySamples[i][0] * radius), iy = Math.round(y + bodySamples[i][1] * radius);
    if (!bitHas(bits, ix, iy)) return false;
  }
  return true;
}

function cellBlocked(x, y, radius, obstacles, grid, cx, cy) {
  const { minCX, minCY, width, height, starts, counts, packed } = grid;
  if (cx < minCX || cy < minCY || cx >= minCX + width || cy >= minCY + height) return false;
  const cell = (cy - minCY) * width + (cx - minCX), count = counts[cell];
  if (!count) return false;
  const start = starts[cell];
  for (let i = 0; i < count; i++) if (overlapsObstacle(x, y, radius, obstacles[packed[start + i]])) return true;
  return false;
}

function gridBlocked(x, y, radius, obstacles, grid) {
  if (!grid.width) return false;
  const padding = Math.max(0, radius) + 1e-9;
  const x0 = Math.floor((x - padding) / grid.cell), x1 = Math.floor((x + padding) / grid.cell);
  const y0 = Math.floor((y - padding) / grid.cell), y1 = Math.floor((y + padding) / grid.cell);
  if (!Number.isSafeInteger(x0) || !Number.isSafeInteger(x1) || !Number.isSafeInteger(y0) || !Number.isSafeInteger(y1)
    || (x1 - x0 + 1) * (y1 - y0 + 1) > 4096) {
    for (const o of obstacles) if (overlapsObstacle(x, y, radius, o)) return true;
    return false;
  }
  if (x0 === x1 && y0 === y1) return cellBlocked(x, y, radius, obstacles, grid, x0, y0);
  for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
    if (cellBlocked(x, y, radius, obstacles, grid, cx, cy)) return true;
  }
  return false;
}

function tilesAt(x, y, radius, world, bits) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (bits) return samplesInside(bits, x, y, radius);
  for (let i = 0; i < bodySamples.length; i++) {
    if (!hasTile(x + bodySamples[i][0] * radius, y + bodySamples[i][1] * radius, world)) return false;
  }
  return true;
}

function pointBlocked(x, y, radius, obstacles, grid) {
  if (!grid) {
    for (const o of obstacles) if (overlapsObstacle(x, y, radius, o)) return true;
    return false;
  }
  return gridBlocked(x, y, radius, obstacles, grid);
}

// bits and grid are resolved once per line or step, then reused for every sample.
function walkableParts(x, y, radius, world, bits, obstacles, grid) {
  return tilesAt(x, y, radius, world, bits) && !pointBlocked(x, y, radius, obstacles, grid);
}

// Every sample disc of a short segment sits in one tile, or null when that is not proven.
function tilesOfSegment(bits, from, to, radius) {
  if (!bits || !(radius >= 0 && radius < 0.5)) return null;
  if (!Number.isFinite(from.x) || !Number.isFinite(from.y) || !Number.isFinite(to.x) || !Number.isFinite(to.y)) return null;
  const ix = Math.round(from.x), iy = Math.round(from.y);
  if (Math.round(to.x) !== ix || Math.round(to.y) !== iy) return null;
  const eps = 1e-9;
  const minX = Math.min(from.x, to.x) - radius, maxX = Math.max(from.x, to.x) + radius;
  const minY = Math.min(from.y, to.y) - radius, maxY = Math.max(from.y, to.y) + radius;
  if (minX >= ix - 0.5 + eps && maxX < ix + 0.5 - eps && minY >= iy - 0.5 + eps && maxY < iy + 0.5 - eps)
    return bitHas(bits, ix, iy);
  return null;
}

// True only when every sample on the segment is outside every obstacle.
function obstaclesClear(from, to, radius, grid) {
  if (!grid) return false;
  if (!grid.width) return true;
  const padding = Math.max(0, radius) + 1e-9;
  const x0 = Math.floor((Math.min(from.x, to.x) - padding) / grid.cell);
  const x1 = Math.floor((Math.max(from.x, to.x) + padding) / grid.cell);
  const y0 = Math.floor((Math.min(from.y, to.y) - padding) / grid.cell);
  const y1 = Math.floor((Math.max(from.y, to.y) + padding) / grid.cell);
  if (!Number.isSafeInteger(x0) || !Number.isSafeInteger(x1) || !Number.isSafeInteger(y0) || !Number.isSafeInteger(y1)
    || (x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return false;
  const { minCX, minCY, width, height, counts } = grid;
  for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
    if (cx < minCX || cy < minCY || cx >= minCX + width || cy >= minCY + height) continue;
    if (counts[(cy - minCY) * width + (cx - minCX)]) return false;
  }
  return true;
}

function walkableAt(x, y, radius, world) {
  const obstacles = world?.obstacles ?? OBSTACLES;
  return walkableParts(x, y, radius, world, bitsFor(world), obstacles, obstacleGrid(obstacles));
}

export function isWalkable(x, y, radius = 0.24, world) {
  return walkableAt(x, y, radius, world);
}

export function moveBody(body, dx, dy, world) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.12));
  const sx = dx / steps, sy = dy / steps;
  const obstacles = world?.obstacles ?? OBSTACLES;
  const bits = bitsFor(world), grid = obstacleGrid(obstacles), radius = body.radius;
  for (let i = 0; i < steps; i++) {
    if (walkableParts(body.x + sx, body.y + sy, radius, world, bits, obstacles, grid)) { body.x += sx; body.y += sy; }
    else {
      if (walkableParts(body.x + sx, body.y, radius, world, bits, obstacles, grid)) body.x += sx;
      if (walkableParts(body.x, body.y + sy, radius, world, bits, obstacles, grid)) body.y += sy;
    }
  }
}

const pathTileCaches = new WeakMap();
const navGraphs = new WeakMap();
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function staticWorld(world) {
  return !!world && Object.isFrozen(world) && Object.isFrozen(world.tiles) && world.tiles.every(Object.isFrozen)
    && !!obstacleGrid(world.obstacles ?? OBSTACLES);
}

function pathTiles(radius, world) {
  let cache = null;
  if (world && Object.isFrozen(world)) {
    if (!pathTileCaches.has(world)) pathTileCaches.set(world, staticWorld(world) ? new Map() : null);
    cache = pathTileCaches.get(world);
  }
  if (cache?.has(radius)) return cache.get(radius);
  const tiles = (world?.tiles ?? TILES).filter(p => walkableAt(p.x, p.y, radius, world));
  cache?.set(radius, tiles);
  return tiles;
}

// Neighbours of a frozen navmesh. Built once per radius; each link is the same
// east/north/west/south test the search used to repeat on every path.
function navOf(radius, world, tiles) {
  if (!world || !pathTileCaches.get(world)) return null;
  let graphs = navGraphs.get(world);
  if (!graphs) { graphs = new Map(); navGraphs.set(world, graphs); }
  let graph = graphs.get(radius);
  if (graph) return graph;
  const at = new Map(tiles.map(p => [`${p.x},${p.y}`, p]));
  graph = new Map();
  for (const p of tiles) {
    const list = [];
    for (const [dx, dy] of DIRS) {
      const n = at.get(`${p.x + dx},${p.y + dy}`);
      if (n && clearLine(p, n, radius, world)) list.push(n);
    }
    graph.set(p, list);
  }
  graphs.set(radius, graph);
  return graph;
}

// The same tile index, obstacle grid and neighbour links the first query would build.
// Calling it earlier does not change those links: each cache returns the existing one.
export function warmNavigation(world, radii = []) {
  if (!world) return;
  bitsFor(world);
  obstacleGrid(world.obstacles ?? OBSTACLES);
  for (let i = 0; i < radii.length; i++) navOf(radii[i], world, pathTiles(radii[i], world));
}

function closestTile(tiles, point) {
  let best = 0, bestD = Math.hypot(tiles[0].x - point.x, tiles[0].y - point.y);
  for (let i = 1; i < tiles.length; i++) {
    const d = Math.hypot(tiles[i].x - point.x, tiles[i].y - point.y);
    if (d < bestD) { best = i; bestD = d; }
  }
  return tiles[best];
}

function firstReachable(tiles, from, radius, world) {
  const nearest = closestTile(tiles, from);
  if (clearLine(from, nearest, radius, world)) return nearest;
  return [...tiles].sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))
    .find(p => clearLine(from, p, radius, world));
}

export function findPath(from, to, radius = .29, world) {
  const validTiles = pathTiles(radius, world);
  if (!validTiles.length) return [];
  const start = firstReachable(validTiles, from, radius, world);
  const target = closestTile(validTiles, to);
  if (!start || !target) return [];
  const key = p => `${p.x},${p.y}`;
  const queue = [start], visited = new Map([[key(start), null]]);
  const graph = navOf(radius, world, validTiles);
  let found = null;
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (key(p) === key(target)) { found = p; break; }
    const links = graph?.get(p);
    if (links) {
      for (const n of links) {
        const id = key(n);
        if (!visited.has(id)) { visited.set(id, p); queue.push(n); }
      }
    } else {
      for (const [dx, dy] of DIRS) {
        const n = { x: p.x + dx, y: p.y + dy };
        if (!visited.has(key(n)) && walkableAt(n.x, n.y, radius, world) && clearLine(p, n, radius, world)) {
          visited.set(key(n), p);
          queue.push(n);
        }
      }
    }
  }
  if (!found) return [];
  const path = [];
  while (found) { path.unshift(found); found = visited.get(key(found)); }
  return [{ x: from.x, y: from.y }, ...path];
}

export function clearLine(from, to, radius = 0.25, world) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const steps = Math.ceil(Math.hypot(dx, dy) / 0.15);
  if (!(steps >= 1)) return true;
  const obstacles = world?.obstacles ?? OBSTACLES;
  const bits = bitsFor(world), grid = obstacleGrid(obstacles);
  const tiles = tilesOfSegment(bits, from, to, radius);
  if (tiles === false) return false;
  const clear = obstaclesClear(from, to, radius, grid);
  if (tiles === true && clear) return true;
  for (let i = 1; i <= steps; i++) {
    const x = from.x + dx * i / steps, y = from.y + dy * i / steps;
    if (tiles !== true && !tilesAt(x, y, radius, world, bits)) return false;
    if (!clear && pointBlocked(x, y, radius, obstacles, grid)) return false;
  }
  return true;
}
