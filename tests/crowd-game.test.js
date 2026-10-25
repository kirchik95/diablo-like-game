import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, createAdventure, updateGame } from '../src/game.js';
import { clearLine, isWalkable, moveBody } from '../src/world.js';
import { OVERWORLD, DEFAULT_WORLD_SEED } from '../src/overworld.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function arena(definitions, obstacles = []) {
  const game = createGame(), template = game.enemies[0];
  const tiles = [];
  for (let x = -12; x <= 12; x++) for (let y = -12; y <= 12; y++) tiles.push({ x, y });
  game.world = { tiles, obstacles, shrine: null };
  game.projectiles = []; game._nextProjectileId = 0;
  Object.assign(game.player, { x: 0, y: 0, invulnerable: 100 });
  game.enemies = definitions.map((d, i) => ({ ...template,
    id: `actor-${i}`, kind: 'hound', x: 0, y: 5, homeX: 0, homeY: 5,
    state: 'chase', attackCooldown: 10, path: [], ...d }));
  return game;
}
function advance(game, seconds, dt = .01, check = () => {}) {
  for (let tick = 0; tick < Math.round(seconds / dt); tick++) {
    const before = game.enemies.map(e => ({ x: e.x, y: e.y }));
    updateGame(game, {}, dt);
    check(before);
  }
}

test('adventure consumes the seeded world factory and records its normalized seed without sharing actors', () => {
  const normal = createAdventure();
  assert.equal(normal.seed, DEFAULT_WORLD_SEED); assert.equal(normal.world, OVERWORLD);
  const look = { skin: 'deep', hair: 'short', sash: 'teal' };
  const a = createAdventure(look, { seed: -1 }), b = createAdventure(look, { seed: 4294967295 });
  const zero = createAdventure(look, { seed: 4294967296 });
  assert.equal(a.seed, 4294967295); assert.equal(zero.seed, 0);
  assert.equal(a.seed, a.world.seed); assert.equal(a.world.tiles, OVERWORLD.tiles);
  assert.notEqual(a.world, OVERWORLD); assert.deepEqual(a.appearance, look);
  assert.deepEqual(a.enemies, b.enemies); assert.notDeepEqual(a.world.encounters, zero.world.encounters);
  assert.deepEqual(a.enemies.filter(e => e.packId).map(e => [e.id, e.x, e.y]),
    a.world.encounters.map(e => [e.id, e.x, e.y]));
  a.enemies[0].hp = 1; assert.equal(b.enemies[0].hp, b.enemies[0].maxHp);
  assert.equal(a._locations.road.enemies[0], a.enemies.find(e => e.zoneId === 'road'));
});

test('stable individual hound approaches bend to different sides and close on the target', () => {
  const samples = [];
  for (let i = 0; i < 8; i++) {
    const game = arena([{ id: `approach-${i}`, y: 6 }]);
    advance(game, .6);
    samples.push({ ...game.enemies[0] });
    assert.ok(distance(game.enemies[0], game.player) < 5.1, 'bias must still close the distance');
    const replay = arena([{ id: `approach-${i}`, y: 6 }]);
    advance(replay, .6);
    assert.deepEqual([replay.enemies[0].x, replay.enemies[0].y], [samples[i].x, samples[i].y]);
  }
  assert.ok(samples.some(e => e.x > .08) && samples.some(e => e.x < -.08),
    'all IDs use the same straight path to the player');
});

test('aligned hounds spread without abandoning forward progress or forming a waiting ring', () => {
  const game = arena(Array.from({ length: 6 }, (_, i) => ({ y: 4 + i * .8, attackCooldown: 0 })));
  advance(game, 1);
  const xs = game.enemies.map(e => e.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > .25, 'approaching pack remains a regimented column');
  game.enemies.forEach((e, i) => assert.ok(e.y < 4 + i * .8 - .8));
  advance(game, 6);
  assert.ok(game.events.filter(e => e.type === 'leap').length >= 6, 'pack must actually attack, not orbit');
});

test('coincident hound and wraith separate deterministically, including the ranged actor', () => {
  const definitions = [{ kind: 'hound', y: 4 }, { kind: 'wraith', y: 4 }];
  const game = arena(definitions), replay = arena(definitions);
  advance(game, .7); advance(replay, .7);
  assert.ok(distance(game.enemies[0], game.enemies[1]) > .6);
  assert.ok(distance(game.enemies[1], { x: 0, y: 4 }) > .15, 'wraith must participate in separation');
  assert.deepEqual(game.enemies.map(e => [e.x, e.y]), replay.enemies.map(e => [e.x, e.y]));
});

test('crowded wraiths find spacing with clear firing lines while remaining within range', () => {
  const game = arena([{ kind: 'wraith', x: -.1, y: 4 }, { kind: 'wraith', x: .1, y: 4 }]);
  advance(game, .7);
  assert.ok(distance(...game.enemies) > .65, 'ranged actors keep overlapping between attacks');
  for (const e of game.enemies) {
    assert.ok(distance(e, game.player) < 5.5);
    assert.ok(clearLine(e, game.player, .13, game.world));
    e.attackCooldown = 0;
  }
  updateGame(game, {}, .01);
  assert.ok(game.enemies.every(e => e.state === 'windup' && e.timer === .8));
});

for (const dt of [.01, .05]) test(`dense mixed crowd respects species speeds and separates at dt=${dt}`, () => {
  const game = arena(Array.from({ length: 7 }, (_, i) => ({ kind: i % 2 ? 'wraith' : 'hound', y: 5 })));
  advance(game, 1, dt, before => game.enemies.forEach((e, i) => {
    assert.ok(distance(e, before[i]) <= (e.kind === 'wraith' ? 1.15 : 1.75) * dt + 1e-8, 'separation adds a speed buff');
    assert.ok(isWalkable(e.x, e.y, e.radius, game.world));
  }));
  for (let i = 0; i < game.enemies.length; i++) for (let j = i + 1; j < game.enemies.length; j++) {
    assert.ok(distance(game.enemies[i], game.enemies[j]) > .25, 'coincident actors failed to disperse');
  }
});

test('crowd displacement obeys static walls and does not consume additional path requests', () => {
  const wall = { x: 0, y: 4, halfWidth: .2, halfDepth: 2 };
  const game = arena([{ x: .5, y: 4 }, { kind: 'wraith', x: .5, y: 4.05 }], [wall]);
  Object.assign(game.player, { x: -3, y: 4 });
  advance(game, 1, .05, () => {
    for (const e of game.enemies) assert.ok(isWalkable(e.x, e.y, e.radius, game.world));
    assert.ok(game._pathBudget >= 0 && game._pathBudget <= 3);
  });
});

test('neighbours never displace committed windup, recovery, stun, leap or dead actors', () => {
  for (const kind of ['hound', 'wraith']) for (const state of ['windup', 'recover', 'stunned', 'dead', ...(kind === 'hound' ? ['leap'] : [])]) {
    const actor = { kind, state, x: 0, y: 5, dx: 1, dy: 0, timer: .4, hp: state === 'dead' ? 0 : 64 };
    const crowded = arena([actor, { x: .1, y: 5 }]), alone = arena([actor]);
    advance(crowded, .1); advance(alone, .1);
    const a = crowded.enemies[0], b = alone.enemies[0];
    assert.deepEqual([a.x, a.y, a.dx, a.dy, a.state, a.timer], [b.x, b.y, b.dx, b.dy, b.state, b.timer], `${kind}/${state}`);
  }
});

test('safe-camp retreat waits for a committed state instead of sliding or cancelling it', () => {
  for (const kind of ['hound', 'wraith']) for (const state of ['windup', 'recover', 'stunned']) {
    const game = arena([{ kind, state, timer: .4, packId: 'local', active: true, x: 0, y: 4, homeY: 5 }]);
    game.world.safeArea = { minY: 8, maxY: 12 };
    Object.assign(game.player, { x: 0, y: 9 });
    updateGame(game, {}, .05);
    const e = game.enemies[0];
    assert.deepEqual([e.x, e.y, e.state], [0, 4, state]);
    assert.ok(Math.abs(e.timer - .35) < 1e-8);
    assert.equal(e.returning, true);
  }
});

for (const dt of [.01, .05]) test(`all ten packs return to their actual spawn homes without healing at dt=${dt}`, () => {
  const game = createAdventure(), members = game.enemies.filter(e => e.packId);
  // Six on the road and in the courtyard, two in each side zone.
  assert.equal(new Set(members.filter(e => !e.wander).map(e => e.packId)).size, 10);
  for (const [i, e] of members.entries()) {
    e.hp -= 7; e.active = true; e.state = 'chase';
    const start = { x: e.x, y: e.y };
    for (const [dx, dy] of [[1.1, 0], [0, 1.1], [-1.1, 0], [0, -1.1]]) {
      if (clearLine(start, { x: start.x + dx, y: start.y + dy }, e.radius, game.world)) {
        moveBody(e, dx, dy, game.world); break;
      }
    }
    assert.ok(distance(e, start) > .5, `unable to displace return fixture ${i}`);
  }
  advance(game, 8, dt, before => members.forEach((e, i) => {
    assert.ok(distance(e, before[i]) <= 2.2 * dt + 1e-8, 'return must be physical and bounded');
    assert.ok(isWalkable(e.x, e.y, e.radius, game.world));
    assert.ok(e.y + e.radius < game.world.safeArea.minY);
  }));
  for (const e of members) {
    assert.ok(distance(e, { x: e.homeX, y: e.homeY }) < 1e-6, `did not settle at home: ${e.id}`);
    assert.equal(e.active, false); assert.equal(e.returning, false); assert.equal(e.state, 'idle');
    assert.equal(e.hp, e.maxHp - 7);
  }
});
