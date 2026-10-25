import { clearLine } from './world.js';
import { WRAITH_STATS } from './campaign.js';

// Stable identity-derived choices, never random samples during simulation.
function fraction(key) {
  let value = 2166136261;
  for (const char of String(key)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  value ^= value >>> 16; value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15; value = Math.imul(value, 0x846ca68b);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
}

// Math.hypot is at least each absolute component, so a far axis skips the call.
function hypotLess(x, y, limit) {
  if (Math.abs(x) >= limit || Math.abs(y) >= limit) return false;
  return Math.hypot(x, y) < limit;
}

const aimPoint = { x: 0, y: 0 };

export function approachTarget(enemy, player, world) {
  const x = player.x - enemy.x, y = player.y - enemy.y, distance = Math.hypot(x, y);
  if (distance < 2.15) return player;
  const choice = fraction(enemy.id), side = choice < .5 ? -1 : 1;
  const offset = side * (.7 + fraction(`${enemy.id}:width`) * .65)
    * Math.min(1, (distance - 2.15) / 2.5);
  // Only ranged actors stop short; hounds close fully once inside contact range.
  const stop = enemy.kind === 'wraith' ? Math.min(4.2, distance) : 0;
  aimPoint.x = player.x - x / distance * stop - y / distance * offset;
  aimPoint.y = player.y - y / distance * stop + x / distance * offset;
  return clearLine(enemy, aimPoint, enemy.radius, world)
    && clearLine(aimPoint, player, WRAITH_STATS.shotRadius, world) ? aimPoint : player;
}

// Scratch belongs to the caller's actor array; results remain independent Maps.
// Rows and buckets grow only to the largest observed crowd and are reused.
const separationScratch = new WeakMap();
const byId = (a, b) => String(a.id).localeCompare(String(b.id));
const byIndex = (a, b) => a - b;

export function crowdSeparation(enemies) {
  let scratch = separationScratch.get(enemies);
  if (!scratch) {
    scratch = {
      bodies: [], raw: [], prev: [], grid: new Map(), rows: [], buckets: [],
      candidates: [], forces: new Map(), pool: [], flat: new Map(), xs: [], ys: [],
      ids: new Set(), unique: false,
    };
    separationScratch.set(enemies, scratch);
  }
  const { bodies, raw, prev, grid, rows, buckets, candidates, forces, pool, flat, xs, ys, ids } = scratch;
  raw.length = 0;
  for (const e of enemies) if (e.hp > 0 && e.kind !== 'ritual') raw.push(e);
  // The id order does not change until a body joins or leaves the living set.
  let same = raw.length === prev.length;
  for (let i = 0; same && i < raw.length; i++) if (raw[i] !== prev[i]) same = false;
  if (!same) {
    bodies.length = 0;
    for (const e of raw) bodies.push(e);
    bodies.sort(byId);
    prev.length = 0;
    for (const e of raw) prev.push(e);
    ids.clear();
    scratch.unique = true;
    for (const body of bodies) {
      if (ids.has(body.id)) scratch.unique = false;
      ids.add(body.id);
    }
  }
  forces.clear();
  for (let i = 0; i < bodies.length; i++) {
    const force = pool[i] ??= { x: 0, y: 0 };
    force.x = 0; force.y = 0;
    forces.set(bodies[i].id, force);
  }
  // A cell spans the largest possible pair reach. Only its eight neighbours
  // can overlap it. Restore candidates to ID order before accumulating forces,
  // so even coincident bodies keep the old loop's exact floating-point sums.
  let maxRadius = 0;
  for (const body of bodies) maxRadius = Math.max(maxRadius, body.radius);
  const cell = 2 * maxRadius + .45 + 1e-9;
  // One numeric key per cell. Cells outside this span keep the nested map, so a
  // huge test coordinate cannot alias onto a neighbour.
  flat.clear();
  xs.length = bodies.length; ys.length = bodies.length;
  let flatOk = true, bucketCount = 0;
  for (let i = 0; i < bodies.length; i++) {
    const x = Math.floor(bodies[i].x / cell), y = Math.floor(bodies[i].y / cell);
    xs[i] = x; ys[i] = y;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000) flatOk = false;
  }
  if (flatOk) {
    for (let i = 0; i < bodies.length; i++) {
      const key = xs[i] * 67108864 + ys[i];
      let bucket = flat.get(key);
      if (!bucket) {
        bucket = buckets[bucketCount++] ??= [];
        bucket.length = 0; flat.set(key, bucket);
      }
      bucket.push(i);
    }
  } else {
    grid.clear();
    let rowCount = 0;
    bucketCount = 0;
    for (let i = 0; i < bodies.length; i++) {
      const x = xs[i], y = ys[i];
      let row = grid.get(x);
      if (!row) {
        row = rows[rowCount++] ??= new Map();
        row.clear(); grid.set(x, row);
      }
      let bucket = row.get(y);
      if (!bucket) {
        bucket = buckets[bucketCount++] ??= [];
        bucket.length = 0; row.set(y, bucket);
      }
      bucket.push(i);
    }
  }
  const unique = scratch.unique;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i], cx = xs[i], cy = ys[i];
    candidates.length = 0;
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        const bucket = flatOk ? flat.get(x * 67108864 + y) : grid.get(x)?.get(y);
        if (bucket) for (const j of bucket) if (j > i) candidates.push(j);
      }
    }
    if (candidates.length > 1) candidates.sort(byIndex);
    for (const j of candidates) {
      const b = bodies[j], reach = a.radius + b.radius + .45;
      let x = a.x - b.x, y = a.y - b.y;
      // Reject distant pairs without changing the normalization or accumulation
      // order of any pair that can actually overlap.
      if (Math.abs(x) > reach || Math.abs(y) > reach) continue;
      const distance = Math.hypot(x, y);
      if (distance >= reach) continue;
      if (distance > 1e-8) { x /= distance; y /= distance; }
      else {
        const angle = fraction(`${a.id}:${b.id}`) * Math.PI * 2;
        x = Math.cos(angle); y = Math.sin(angle);
      }
      const strength = 2 * (1 - distance / reach);
      const fa = unique ? pool[i] : forces.get(a.id), fb = unique ? pool[j] : forces.get(b.id);
      fa.x += x * strength; fa.y += y * strength;
      fb.x -= x * strength; fb.y -= y * strength;
    }
  }
  for (const force of forces.values()) {
    if (force.x === 0 && force.y === 0) continue;
    const length = Math.hypot(force.x, force.y);
    if (length > 1.75) { force.x *= 1.75 / length; force.y *= 1.75 / length; }
  }
  return forces;
}

function hypotAtMost(x, y, limit) {
  if (Math.abs(x) > limit || Math.abs(y) > limit) return false;
  return Math.hypot(x, y) <= limit;
}

export function firingAdjustment(enemy, player, force, world) {
  if (!force || hypotLess(force.x, force.y, .02) || hypotLess(enemy.x - player.x, enemy.y - player.y, 2.15)) return enemy;
  aimPoint.x = enemy.x + force.x * .5;
  aimPoint.y = enemy.y + force.y * .5;
  return hypotAtMost(aimPoint.x - player.x, aimPoint.y - player.y, WRAITH_STATS.attackRange)
    && clearLine(enemy, aimPoint, enemy.radius, world)
    && clearLine(aimPoint, player, WRAITH_STATS.shotRadius, world) ? aimPoint : enemy;
}
