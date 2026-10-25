import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAdventure, updateGame } from '../src/game.js';
import { crowdFixture, crowdControls } from '../scripts/crowd-fixture.js';
import { isWalkable, clearLine, findPath, hasTile } from '../src/world.js';

// Full-state hashes of seeded replays, captured from the live simulation
// before the cost refactor. A mismatch means the step is no longer bit-identical.
const EXPECTED = {
  'road-fight-5': 'e330c6e3da8017a0b392d5eb19f9300f926d0ec1ad66bcf3e549b08727965133',
  'road-fight-777': '10e8716ea8e312dedd5fe21de0df872c7e0fb1a386aee73660af8da3deedb32c',
  'road-fight-20261023': '5db3d75a5c106ef364aff970b2f702923c109edbd5fb199ba4297b10e7bfc885',
  'road-walk-5': '18df3951d23769e3a9fb87d3186b4cfedec1de8e3dd975fdf8d63daec4b19bea',
  'road-walk-777': 'c08ad78c41f086b81684885001b785dd85080c26683c92486ef28b0f87027388',
  'crowd40-road-7': 'b58c8439916549384cb599872c8851d07e86ab4776e006f21ea3f9b6133d0acf',
};

const DT = 1 / 60;
const STEPS = 720;
const SAMPLES = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [.707, .707], [-.707, .707], [.707, -.707], [-.707, -.707]];

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (value instanceof Set) return canonicalize([...value].sort((a, b) => canonicalize(a) < canonicalize(b) ? -1 : canonicalize(a) > canonicalize(b) ? 1 : 0));
  if (value instanceof Map) return canonicalize([...value.entries()].sort((a, b) => canonicalize(a[0]) < canonicalize(b[0]) ? -1 : 1));
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).filter(key => value[key] !== undefined && typeof value[key] !== 'function').sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function snapshot(game) {
  return canonicalize({
    time: game.time, phase: game.phase, kills: game.kills,
    shrineUsed: game.shrineUsed ?? null, shrinesUsed: game.shrinesUsed ?? null,
    player: game.player, enemies: game.enemies, projectiles: game.projectiles,
    monkShots: game.monkShots, effects: game.effects, pickups: game.pickups,
    groundItems: game.groundItems, progression: game.progression, inventory: game.inventory,
    adventure: game.adventure, nextProjectileId: game._nextProjectileId, nextShotId: game._nextShotId ?? null,
  });
}

function replayHash(game, input) {
  const hash = createHash('sha256');
  for (let i = 0; i < STEPS; i++) {
    updateGame(game, input(game, i), DT);
    hash.update(canonicalize(game.events));
    game.events.length = 0;
    if ((i + 1) % 60 === 0) hash.update(snapshot(game));
  }
  return hash.digest('hex');
}

function placeCrowd(game) {
  const centre = { x: 0, y: -72 };
  Object.assign(game.player, centre, { invulnerable: 1e6 });
  game.enemies.forEach((enemy, i) => {
    const angle = i * 2.399963229728653, radius = 1.5 + 3 * Math.sqrt((i + .5) / game.enemies.length);
    let x = Math.cos(angle) * radius, y = -72 + Math.sin(angle) * radius;
    if (!isWalkable(x, y, enemy.radius, game.world) || !clearLine(centre, { x, y }, enemy.radius, game.world)) {
      x = 0; y = -72;
    }
    Object.assign(enemy, {
      x, y, homeX: x, homeY: y, active: true, returning: false, state: 'chase', timer: 0,
      attackCooldown: i * .07, path: [], repath: 0, hp: 1e6, maxHp: 1e6,
    });
  });
  return game;
}

function roadFight(seed) {
  const game = createAdventure({}, { seed });
  const members = game.enemies.filter(enemy => enemy.packId === 'road-crossing' && enemy.hp > 0);
  if (!members.length) throw new Error(`no road-crossing pack for seed ${seed}`);
  Object.assign(game.player, { x: members[0].homeX + 1.2, y: members[0].homeY, invulnerable: 1e6 });
  return game;
}

function fightInput(_game, i) {
  const angle = i * 0.07;
  return {
    moveX: Math.cos(angle), moveY: Math.sin(angle) * 0.35,
    aimX: Math.cos(angle * 0.5), aimY: Math.sin(angle * 0.5), attack: i % 18 < 10, actions: [],
  };
}

function walkInput(_game, i) {
  return { moveX: Math.sin(i * 0.02) * 0.25, moveY: -1, aimX: 0, aimY: -1, attack: i % 24 < 6, actions: [] };
}

function roadWalk(seed) {
  const game = createAdventure({}, { seed });
  Object.assign(game.player, { x: 0, y: -45, invulnerable: 1e6 });
  return game;
}

function referenceWalkable(x, y, radius, tiles, obstacles) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  for (const [dx, dy] of SAMPLES) {
    if (!tiles.has(`${Math.round(x + dx * radius)},${Math.round(y + dy * radius)}`)) return false;
  }
  for (const o of obstacles) {
    const halfWidth = o.halfWidth ?? o.halfSize, halfDepth = o.halfDepth ?? o.halfSize;
    if (halfWidth !== undefined && halfDepth !== undefined) {
      const dx = Math.abs(x - o.x) - halfWidth, dy = Math.abs(y - o.y) - halfDepth;
      if (Math.max(dx, dy) < 0 || Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) < radius) return false;
    } else if (Math.hypot(x - o.x, y - o.y) < radius + o.radius) return false;
  }
  return true;
}

function referencePath(from, to, radius, world) {
  const tiles = (world?.tiles ?? []).filter(p => isWalkable(p.x, p.y, radius, world));
  const nearest = point => [...tiles].sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y));
  const start = nearest(from).find(p => clearLine(from, p, radius, world));
  const target = nearest(to)[0];
  if (!start || !target) return [];
  const key = p => `${p.x},${p.y}`;
  const queue = [start], visited = new Map([[key(start), null]]);
  let found = null;
  for (let i = 0; i < queue.length && !found; i++) {
    const p = queue[i];
    if (key(p) === key(target)) { found = p; break; }
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (!visited.has(key(n)) && isWalkable(n.x, n.y, radius, world) && clearLine(p, n, radius, world)) {
        visited.set(key(n), p); queue.push(n);
      }
    }
  }
  if (!found) return [];
  const path = [];
  while (found) { path.unshift({ x: found.x, y: found.y }); found = visited.get(key(found)); }
  return [{ x: from.x, y: from.y }, ...path];
}

test('walk queries match an independent tile and obstacle scan', () => {
  const world = createAdventure({}, { seed: 7 }).world;
  const tiles = new Set(world.tiles.map(p => `${p.x},${p.y}`));
  let seed = 0x51A11;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const radii = [0, .05, .13, .23, .24, .29, .38, .45];
  for (let i = 0; i < 400; i++) {
    const point = world.tiles[(random() * world.tiles.length) | 0];
    const x = point.x + random() - .5, y = point.y + random() - .5, radius = radii[i % radii.length];
    assert.equal(isWalkable(x, y, radius, world), referenceWalkable(x, y, radius, tiles, world.obstacles), `${x},${y},${radius}`);
    assert.equal(hasTile(x, y, world), tiles.has(`${Math.round(x)},${Math.round(y)}`));
  }
  for (let i = 0; i < world.obstacles.length; i += 3) {
    const o = world.obstacles[i];
    for (const radius of radii) {
      assert.equal(isWalkable(o.x, o.y, radius, world), referenceWalkable(o.x, o.y, radius, tiles, world.obstacles), `obstacle ${i}`);
      assert.equal(isWalkable(o.x + radius, o.y - radius * .5, radius, world),
        referenceWalkable(o.x + radius, o.y - radius * .5, radius, tiles, world.obstacles), `edge ${i}`);
    }
  }
  assert.equal(isWalkable(Number.NaN, 0, .2, world), false);
  assert.equal(hasTile(10_000, 10_000, world), false);
});

test('cached paths keep the straight search coordinates', () => {
  const world = createAdventure({}, { seed: 7 }).world;
  const pairs = [[world.spawn, world.shrine], [world.spawn, { x: 0, y: -72 }], [{ x: 0, y: -72 }, { x: 1, y: -90 }]];
  for (const radius of [.23, .29, .38]) for (const [from, to] of pairs) {
    const got = findPath(from, to, radius, world).map(p => [p.x, p.y]);
    const expected = referencePath(from, to, radius, world).map(p => [p.x, p.y]);
    assert.deepEqual(got, expected, `r${radius} ${from.x},${from.y}`);
  }
});

test('seeded replays keep the live full-state hash', () => {
  const runs = {
    'road-fight-5': replayHash(roadFight(5), fightInput),
    'road-fight-777': replayHash(roadFight(777), fightInput),
    'road-fight-20261023': replayHash(roadFight(20261023), fightInput),
    'road-walk-5': replayHash(roadWalk(5), walkInput),
    'road-walk-777': replayHash(roadWalk(777), walkInput),
    'crowd40-road-7': replayHash(placeCrowd(crowdFixture(40)), game => crowdControls(game)),
  };
  assert.deepEqual(runs, EXPECTED);
});
