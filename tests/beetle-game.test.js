import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, createAdventure, updateGame, startAttack, startDash, startWave } from '../src/game.js';
import { BEETLE_STATS, BEETLE_TIMINGS } from '../src/campaign.js';
import { MONK_RULES } from '../src/monk-combat.js';
import { createOverworld, OVERWORLD, DEFAULT_WORLD_SEED, getOverworldZone } from '../src/overworld.js';
import { clearLine, findPath, isWalkable, moveBody } from '../src/world.js';

const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angleToPlayer = (game, e) => {
  const x = game.player.x - e.x, y = game.player.y - e.y;
  return Math.acos(Math.max(-1, Math.min(1, (x * e.dx + y * e.dy) / Math.hypot(x, y))));
};
const beetleHp = MONK_RULES.enemyHp.beetle;

// Seeded randomness for sweeps: the same seeds and offsets in every run.
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(state ^ (state >>> 15), state | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function arena(definitions, obstacles = []) {
  const game = createGame(), template = game.enemies[0], tiles = [];
  for (let x = -12; x <= 12; x++) for (let y = -12; y <= 12; y++) tiles.push({ x, y });
  game.world = { tiles, obstacles, shrine: null };
  game.projectiles = []; game._nextProjectileId = 0;
  Object.assign(game.player, { x: 0, y: 0 });
  game.enemies = definitions.map((d, i) => ({ ...template,
    id: `beetle-${i}`, kind: 'beetle', radius: BEETLE_STATS.radius, hp: beetleHp, maxHp: beetleHp, exposed: false,
    x: 0, y: 1, homeX: 0, homeY: 1, dx: 0, dy: -1, state: 'chase', timer: 0, attackCooldown: 10, path: [], ...d }));
  return game;
}
function advance(game, seconds, input = {}, dt = .01, check = () => {}) {
  for (let tick = 0; tick < Math.round(seconds / dt); tick++) {
    const before = game.enemies.map(e => ({ x: e.x, y: e.y, dx: e.dx, dy: e.dy, state: e.state }));
    updateGame(game, input, dt);
    check(before);
  }
}
// One combo strike at the given aim; returns the events of that strike only.
function strike(game, dx, dy) {
  const start = game.events.length;
  assert.equal(startAttack(game, dx, dy), true);
  const index = game.player.attack.index;
  advance(game, MONK_RULES.combo.duration[index], { aimX: dx, aimY: dy });
  return game.events.slice(start);
}

test('a front combo hit is blocked: 25% damage, almost no knockback and a block event', () => {
  // The beetle at (0,1) faces the monk at the origin. Recovery holds it in place.
  const game = arena([{ state: 'recover', timer: 100 }]), e = game.enemies[0];
  const events = strike(game, 0, 1);
  assert.equal(e.hp, beetleHp - 6);
  close(e.y, 1 + MONK_RULES.combo.knockback[0] * BEETLE_STATS.blockKnockback);
  const block = events.find(event => event.type === 'block');
  assert.ok(block, 'blocked hit must emit a block event');
  assert.deepEqual([block.id, block.dx, block.dy, block.x, block.y], [e.id, 0, 1, e.x, e.y]);
  assert.equal(events.filter(event => event.type === 'impact').length, 0, 'a block replaces the impact');
  assert.deepEqual(events.filter(event => event.type === 'damage').map(event => [event.amount, event.blocked]), [[6, true]]);
  assert.deepEqual([e.state, e.exposed], ['recover', false], 'a block keeps the guard and the current action');
  // The full blocked combo deals 6 + 8 + 12 instead of 24 + 30 + 48.
  strike(game, 0, 1); strike(game, 0, 1);
  assert.equal(e.hp, beetleHp - 26);
  assert.equal(game.events.filter(event => event.type === 'guard-break').length, 0);
});

test('side and back hits deal full damage and full knockback, but do not stagger', () => {
  for (const [label, dx, dy] of [['back', 0, 1], ['side', 1, 0], ['side', -1, 0], ['outside 60°', Math.sin(1.1), -Math.cos(1.1)]]) {
    const game = arena([{ dx, dy, state: 'windup', timer: 100 }]), e = game.enemies[0];
    const events = strike(game, 0, 1);
    assert.equal(e.hp, beetleHp - 24, label);
    close(e.y, 1 + MONK_RULES.combo.knockback[0]);
    assert.ok(events.some(event => event.type === 'impact' && event.id === e.id), label);
    assert.ok(!events.some(event => event.type === 'block'), label);
    assert.deepEqual([e.state, e.exposed], ['windup', false], `${label}: combo must not stagger or expose`);
  }
  // Just inside the 60° front arc the guard still holds.
  const game = arena([{ dx: Math.sin(.95), dy: -Math.cos(.95), state: 'recover', timer: 100 }]);
  strike(game, 0, 1);
  assert.equal(game.enemies[0].hp, beetleHp - 6);
});

test('combo never breaks the guard, even the heavy third strike from the front or the back', () => {
  for (const facing of [[0, -1], [0, 1]]) {
    const game = arena([{ dx: facing[0], dy: facing[1], state: 'recover', timer: 100 }]), e = game.enemies[0];
    for (let i = 0; i < 3; i++) strike(game, 0, 1);
    assert.equal(e.exposed, false);
    assert.equal(e.state, 'recover');
    assert.equal(game.events.filter(event => event.type === 'guard-break').length, 0);
  }
});

for (const dt of [.01, .05]) test(`a frontal dash breaks the guard with full damage and a 1.6s exposed stun at dt=${dt}`, () => {
  const game = arena([{ x: 1.5, y: 0, dx: -1, dy: 0 }]), e = game.enemies[0];
  assert.equal(startDash(game, 1, 0), true);
  for (let tick = 0; !e.exposed; tick++) {
    assert.ok(tick < 20, 'the dash never reached the beetle');
    updateGame(game, {}, dt);
  }
  assert.equal(e.hp, beetleHp - MONK_RULES.dash.damage, 'the breaking dash deals full damage');
  assert.deepEqual([e.state, e.exposed], ['stunned', true]);
  close(e.timer, BEETLE_TIMINGS.exposed - dt, 1e-6);
  advance(game, game.player.dashTime, {}, dt);
  const breaks = game.events.filter(event => event.type === 'guard-break');
  assert.equal(breaks.length, 1);
  assert.deepEqual([breaks[0].id, breaks[0].source, breaks[0].dx, breaks[0].dy], [e.id, 'dash', 1, 0]);
  // Exposed: a combo hit from the front now deals full damage and keeps the long stun.
  Object.assign(game.player, { x: e.x - 1, y: e.y });
  const timer = e.timer, hp = e.hp;
  strike(game, 1, 0);
  assert.equal(e.hp, hp - 24);
  assert.ok(e.timer > timer - .3 && e.exposed, 'a combo hit cannot shorten the exposed stun');
  const facing = [e.dx, e.dy];
  advance(game, e.timer - dt * 1.5, {}, dt);
  assert.deepEqual([e.state, e.exposed], ['stunned', true]);
  assert.deepEqual([e.dx, e.dy], facing, 'a stunned beetle does not turn');
  advance(game, dt * 2, {}, dt);
  assert.deepEqual([e.state, e.exposed], ['chase', false]);
});

test('a wave breaks the guard from any side with full damage', () => {
  for (const facing of [[0, -1], [0, 1], [1, 0]]) {
    const game = arena([{ dx: facing[0], dy: facing[1], y: 2 }]), e = game.enemies[0];
    assert.equal(startWave(game), true);
    assert.equal(e.hp, beetleHp - MONK_RULES.wave.damage);
    assert.deepEqual([e.state, e.exposed, e.timer], ['stunned', true, BEETLE_TIMINGS.exposed]);
    assert.equal(game.events.filter(event => event.type === 'guard-break' && event.source === 'wave').length, 1);
  }
});

test('dash and wave on an exposed beetle deal full damage but never extend the stun', () => {
  const game = arena([{ y: 2, hp: 1000, maxHp: 1000 }]), e = game.enemies[0];
  game.player.spirit = 100;
  startWave(game);
  advance(game, 1.2);
  assert.equal(e.exposed, true);
  const timer = e.timer, hp = e.hp;
  assert.equal(startWave(game), true);
  assert.equal(e.hp, hp - MONK_RULES.wave.damage);
  assert.equal(e.timer, timer, 'a second wave must not reset the stun');
  Object.assign(game.player, { x: e.x, y: e.y - 1.2 });
  startDash(game, 0, 1);
  advance(game, .05);
  assert.equal(e.hp, hp - MONK_RULES.wave.damage - MONK_RULES.dash.damage);
  close(e.timer, timer - .05, 1e-6);
  assert.equal(game.events.filter(event => event.type === 'guard-break').length, 1);
  advance(game, e.timer + .01);
  assert.deepEqual([e.state, e.exposed], ['chase', false]);
  close(e.breakImmunity, BEETLE_TIMINGS.breakImmunity, .011);
});

// A beetle whose exposed stun has just ended, held still in a guarded recovery.
function recoveredBeetle() {
  const game = arena([{ y: 2 }]), e = game.enemies[0];
  game.player.spirit = 100;
  startWave(game);
  while (e.state === 'stunned') updateGame(game, {}, .01);
  assert.deepEqual([e.state, e.exposed, e.breakImmunity], ['chase', false, BEETLE_TIMINGS.breakImmunity]);
  Object.assign(e, { state: 'recover', timer: 100, dx: 0, dy: -1 });
  Object.assign(game.player, { x: 0, y: 0, dashCooldown: 0, waveCooldown: 0, spirit: 100 });
  game.events.length = 0;
  return { game, e };
}

test('after the stun ends the shell resists a new break for 1s: front dash and wave are blocked', () => {
  {
    const { game, e } = recoveredBeetle(), hp = e.hp;
    assert.equal(startWave(game), true);
    assert.equal(e.hp, hp - Math.round(MONK_RULES.wave.damage * BEETLE_STATS.blockDamage));
    assert.ok(game.events.some(event => event.type === 'block' && event.source === 'wave'));
    assert.deepEqual([e.state, e.exposed], ['recover', false]);
  }
  {
    const { game, e } = recoveredBeetle(), hp = e.hp;
    Object.assign(game.player, { x: 0, y: .2 });
    startDash(game, 0, 1); advance(game, MONK_RULES.dash.duration);
    assert.equal(e.hp, hp - Math.round(MONK_RULES.dash.damage * BEETLE_STATS.blockDamage));
    assert.ok(game.events.some(event => event.type === 'block' && event.source === 'dash'));
    assert.equal(e.exposed, false);
  }
  {
    // A dash from behind lands in full during the window, yet still cannot break the shell.
    const { game, e } = recoveredBeetle(), hp = e.hp;
    Object.assign(game.player, { x: 0, y: 3.8 });
    startDash(game, 0, -1); advance(game, MONK_RULES.dash.duration);
    assert.equal(e.hp, hp - MONK_RULES.dash.damage);
    assert.equal(e.exposed, false);
    assert.equal(game.events.filter(event => event.type === 'guard-break').length, 0);
  }
  {
    // Once the window has passed, the same frontal wave breaks the shell again.
    const { game, e } = recoveredBeetle();
    advance(game, BEETLE_TIMINGS.breakImmunity);
    assert.equal(e.breakImmunity, 0);
    game.player.waveCooldown = 0;
    assert.equal(startWave(game), true);
    assert.deepEqual([e.state, e.exposed], ['stunned', true]);
    assert.equal(game.events.filter(event => event.type === 'guard-break').length, 1);
  }
});

for (const dt of [.01, .05]) test(`dash spam can no longer hold a beetle in a permanent stun at dt=${dt}`, () => {
  // Extra HP keeps the beetle alive, so the test measures the stun pattern, not the kill.
  const game = arena([{ y: 1.3, attackCooldown: 0, hp: 5000, maxHp: 5000 }]), e = game.enemies[0];
  game.player.invulnerable = 1000;
  let stunned = 0, longest = 0, free = 0;
  for (let tick = 0; tick < Math.round(10 / dt); tick++) {
    const p = game.player;
    if (p.dashCooldown === 0 && p.dashTime === 0) startDash(game, e.x - p.x, e.y - p.y);
    updateGame(game, {}, dt);
    if (e.state === 'stunned') { stunned += dt; longest = Math.max(longest, stunned); } else { stunned = 0; free += dt; }
  }
  assert.ok(longest <= BEETLE_TIMINGS.exposed + 1e-6, `stun lasted ${longest}s`);
  assert.ok(free >= 3, `the beetle acted for only ${free}s of 10s`);
  const breaks = game.events.filter(event => event.type === 'guard-break').length;
  assert.ok(breaks >= 2 && breaks <= 4, `${breaks} breaks`);
});

for (const dt of [.01, .05]) test(`telegraphed slam runs windup→slam→recover on time and damages once at dt=${dt}`, () => {
  const game = arena([{ attackCooldown: 0 }]), e = game.enemies[0];
  const changes = [];
  let previous = e.state;
  advance(game, 2.2, {}, dt, () => {
    if (e.state !== previous) { changes.push([e.state, game.time]); previous = e.state; }
  });
  assert.deepEqual(changes.slice(0, 4).map(([state]) => state), ['windup', 'slam', 'recover', 'chase']);
  const [[, windup], [, slam], [, recover], [, chase]] = changes;
  close(slam - windup, BEETLE_TIMINGS.windup, 1e-6);
  close(recover - slam, BEETLE_TIMINGS.slam, 1e-6);
  close(chase - recover, BEETLE_TIMINGS.recover, 1e-6);
  const windupEvent = game.events.find(event => event.type === 'windup');
  assert.deepEqual([windupEvent.id, windupEvent.kind, windupEvent.dx, windupEvent.dy], [e.id, 'beetle', 0, -1]);
  assert.equal(game.events.filter(event => event.type === 'slam').length, 1);
  assert.equal(game.player.hp, 100 - BEETLE_STATS.slamDamage, 'one slam deals its damage exactly once');
  assert.equal(game.events.filter(event => event.type === 'hurt').length, 1);
});

test('slam misses a monk who stepped behind it or out of reach during the windup', () => {
  for (const position of [{ x: 0, y: 2 }, { x: 1.4, y: 1 }, { x: 0, y: 1 - BEETLE_STATS.slamRange - .05 }]) {
    const game = arena([{ attackCooldown: 0 }]), e = game.enemies[0];
    updateGame(game, {}, .01);
    assert.equal(e.state, 'windup');
    Object.assign(game.player, position);
    advance(game, BEETLE_TIMINGS.windup + BEETLE_TIMINGS.slam + .02);
    assert.equal(e.state, 'recover');
    assert.equal(game.player.hp, 100, JSON.stringify(position));
  }
  // A monk who stays in the front arc at the edge of reach is still hit.
  const game = arena([{ attackCooldown: 0 }]);
  updateGame(game, {}, .01);
  Object.assign(game.player, { x: .5, y: 1 - 1.1 });
  advance(game, BEETLE_TIMINGS.windup + BEETLE_TIMINGS.slam + .02);
  assert.equal(game.player.hp, 100 - BEETLE_STATS.slamDamage);
});

test('a dash through the windup breaks the guard and cancels the slam', () => {
  const game = arena([{ attackCooldown: 0, x: 0, y: 1 }]), e = game.enemies[0];
  updateGame(game, {}, .01);
  assert.equal(e.state, 'windup');
  startDash(game, 0, 1);
  advance(game, BEETLE_TIMINGS.windup + BEETLE_TIMINGS.slam);
  assert.deepEqual([e.state, e.exposed], ['stunned', true]);
  assert.equal(game.events.filter(event => event.type === 'slam').length, 0);
  assert.equal(game.player.hp, 100);
});

test('facing stays locked through windup, slam and recover while the monk circles', () => {
  const game = arena([{ attackCooldown: 0 }]), e = game.enemies[0];
  game.player.invulnerable = 100;
  updateGame(game, {}, .01);
  assert.equal(e.state, 'windup');
  const facing = [e.dx, e.dy], states = new Set();
  for (let tick = 0; e.state !== 'chase'; tick++) {
    assert.ok(tick < 300, 'committed attack never finished');
    const angle = tick * .07;
    Object.assign(game.player, { x: e.x + Math.sin(angle) * 1.1, y: e.y - Math.cos(angle) * 1.1 });
    states.add(e.state);
    updateGame(game, {}, .01);
    if (e.state !== 'chase') assert.deepEqual([e.dx, e.dy], facing, `${e.state} must not turn`);
  }
  assert.deepEqual([...states], ['windup', 'slam', 'recover']);
  updateGame(game, {}, .01);
  assert.notDeepEqual([e.dx, e.dy], facing, 'chase turns again');
});

for (const dt of [.01, .05]) test(`slow turning lets a circling monk reach the open back at dt=${dt}`, () => {
  // The monk starts beside the beetle and runs around it, away from its facing.
  const game = arena([{ x: 0, y: 0, dx: 0, dy: 1, attackCooldown: 0 }]), e = game.enemies[0];
  Object.assign(game.player, { x: 1.1, y: 0 });
  const tangent = () => {
    const x = game.player.x - e.x, y = game.player.y - e.y, d = Math.hypot(x, y);
    const tx = -y / d, ty = x / d;
    return tx * e.dx + ty * e.dy < 0 ? { moveX: tx, moveY: ty } : { moveX: -tx, moveY: -ty };
  };
  for (let tick = 0; tick < Math.round(.5 / dt); tick++) {
    const before = [e.dx, e.dy];
    updateGame(game, tangent(), dt);
    const turned = Math.acos(Math.max(-1, Math.min(1, before[0] * e.dx + before[1] * e.dy)));
    assert.ok(turned <= BEETLE_STATS.turnRate * dt + 1e-6, `turned ${turned} in one tick`);
    assert.equal(e.state, 'chase', 'the beetle must not commit a slam at a monk outside its front');
  }
  assert.ok(angleToPlayer(game, e) > Math.PI * 2 / 3, `monk is not behind: ${angleToPlayer(game, e)}`);
  const x = e.x - game.player.x, y = e.y - game.player.y;
  const hp = e.hp;
  strike(game, x, y);
  assert.equal(e.hp, hp - 24, 'a strike at the back lands in full');
});

test('a hound-speed snap is impossible: the beetle needs over a second to face a monk behind it', () => {
  const game = arena([{ x: 0, y: 0, dx: 0, dy: 1 }]), e = game.enemies[0];
  Object.assign(game.player, { x: .02, y: -1.5 });
  advance(game, 1);
  assert.ok(angleToPlayer(game, e) > .3, 'turned faster than its turn rate');
  advance(game, .4);
  assert.ok(angleToPlayer(game, e) < .05);
});

test('chasing beetles stay at or below their speed, stay walkable and separate in a crowd', () => {
  for (const dt of [.01, .05]) {
    const game = arena(Array.from({ length: 5 }, (_, i) => ({ x: (i - 2) * .05, y: 6, dx: 0, dy: -1 })));
    game.player.invulnerable = 100;
    advance(game, 2, {}, dt, before => game.enemies.forEach((e, i) => {
      if (before[i].state === 'chase' && e.state === 'chase') {
        assert.ok(distance(e, before[i]) <= BEETLE_STATS.speed * dt + 1e-8, 'separation adds a speed buff');
      }
      assert.ok(isWalkable(e.x, e.y, e.radius, game.world));
    }));
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) assert.ok(distance(game.enemies[i], game.enemies[j]) > .3);
    assert.ok(game.enemies.every(e => e.y < 5.5), 'every member must still advance');
    assert.ok(game.enemies.some(e => e.y < 4.2), 'the front of the crowd keeps walking');
  }
});

test('neighbours never displace committed windup, slam, recover, stun or dead beetles', () => {
  for (const state of ['windup', 'slam', 'recover', 'stunned', 'dead']) {
    const actor = { state, x: 0, y: 5, dx: 1, dy: 0, timer: .4, exposed: state === 'stunned', hp: state === 'dead' ? 0 : beetleHp };
    const crowded = arena([actor, { x: .1, y: 5 }]), alone = arena([actor]);
    crowded.player.invulnerable = alone.player.invulnerable = 100;
    advance(crowded, .1); advance(alone, .1);
    const a = crowded.enemies[0], b = alone.enemies[0];
    assert.deepEqual([a.x, a.y, a.dx, a.dy, a.state, a.timer, a.exposed], [b.x, b.y, b.dx, b.dy, b.state, b.timer, b.exposed], state);
  }
});

test('safe-camp retreat waits for a committed beetle state instead of sliding or cancelling it', () => {
  for (const state of ['windup', 'slam', 'recover', 'stunned']) {
    const game = arena([{ state, timer: .4, packId: 'local', active: true, x: 0, y: 4, homeY: 5, exposed: state === 'stunned' }]);
    game.world.safeArea = { minY: 8, maxY: 12 };
    Object.assign(game.player, { x: 0, y: 9 });
    updateGame(game, {}, .05);
    const e = game.enemies[0];
    assert.deepEqual([e.x, e.y, e.state], [0, 4, state]);
    close(e.timer, .35);
    assert.equal(e.returning, true);
  }
});

for (const dt of [.01, .05]) test(`displaced beetles walk home at pack speed without healing at dt=${dt}`, () => {
  const game = createAdventure(), beetles = game.enemies.filter(e => e.kind === 'beetle');
  assert.equal(beetles.length, 5);
  for (const e of beetles) {
    e.hp -= 9; e.active = true; e.state = 'chase';
    const start = { x: e.x, y: e.y };
    for (const [dx, dy] of [[1.2, 0], [0, 1.2], [-1.2, 0], [0, -1.2]]) {
      if (clearLine(start, { x: start.x + dx, y: start.y + dy }, e.radius, game.world)) { moveBody(e, dx, dy, game.world); break; }
    }
    assert.ok(distance(e, start) > .5, `unable to displace ${e.id}`);
  }
  advance(game, 8, {}, dt, before => game.enemies.forEach((e, i) => {
    if (e.kind !== 'beetle') return;
    assert.ok(distance(e, before[i]) <= 2.2 * dt + 1e-8, 'return must be physical and bounded');
    assert.ok(isWalkable(e.x, e.y, e.radius, game.world));
  }));
  for (const e of beetles) {
    assert.ok(distance(e, { x: e.homeX, y: e.homeY }) < 1e-6, `did not settle at home: ${e.id}`);
    assert.deepEqual([e.active, e.returning, e.state, e.exposed], [false, false, 'idle', false]);
    assert.equal(e.hp, e.maxHp - 9);
  }
});

test('adventure beetles start idle with their own HP, radius and closed guard; kills follow the usual rules', () => {
  const game = createAdventure(), beetles = game.enemies.filter(e => e.kind === 'beetle');
  assert.equal(beetleHp, 160);
  for (const e of beetles) {
    assert.deepEqual([e.hp, e.maxHp, e.radius, e.state, e.exposed], [160, 160, BEETLE_STATS.radius, 'idle', false]);
    assert.ok(isWalkable(e.x, e.y, e.radius, game.world));
  }
  assert.equal(game.enemies.find(e => e.kind === 'hound').radius, .29);
  // A beetle kill counts like any ordinary kill and can drop a pickup.
  const e = beetles[0];
  game.enemies = [e];
  Object.assign(game.player, { x: e.x, y: e.y + 1.5 });
  game.kills = 3; e.hp = 10; game.player.spirit = 100;
  assert.equal(startWave(game), true);
  assert.deepEqual([e.hp, e.state, e.exposed], [0, 'dead', false]);
  assert.equal(game.kills, 4); assert.equal(game.adventure.totalKills, 1);
  assert.equal(game.pickups.length, 1);
  assert.ok(game.events.some(event => event.type === 'death' && event.id === e.id));
});

test('placement: 34 ordinary monsters with 5 beetles, 10 wraiths and 12 courtyard guards', () => {
  const world = createOverworld(DEFAULT_WORLD_SEED), enemies = world.encounters;
  assert.equal(enemies.length, 34);
  const count = kind => enemies.filter(e => e.kind === kind).length;
  assert.deepEqual([count('hound'), count('wraith'), count('beetle')], [19, 10, 5]);
  assert.equal(new Set(enemies.map(e => e.packId)).size, 6);
  assert.deepEqual(enemies.filter(e => e.kind === 'beetle').map(e => e.packId),
    ['road-crossing', 'road-gate', 'road-thicket', 'court-entrance', 'court-source']);
  assert.equal(enemies.filter(e => e.zoneId === 'courtyard').length, 12);
  assert.equal(enemies.filter(e => e.zoneId === 'courtyard' && e.kind === 'beetle').length, 2);
  const game = createAdventure();
  assert.equal(game.enemies.filter(e => e.kind !== 'ritual').length, 34);
  assert.equal(game.enemies.filter(e => e.zoneId === 'courtyard' && e.kind !== 'ritual').length, 12);
});

test('placement is deterministic per seed, including the monster kinds', () => {
  const fingerprint = world => world.encounters.map(e => [e.id, e.kind, e.packId, e.x, e.y]);
  const next = random(9001);
  for (let i = 0; i < 20; i++) {
    const seed = Math.floor(next() * 4294967296);
    assert.deepEqual(fingerprint(createOverworld(seed)), fingerprint(createOverworld(seed)), `seed ${seed}`);
  }
  assert.notDeepEqual(fingerprint(createOverworld(1)), fingerprint(createOverworld(2)));
  assert.deepEqual(createAdventure({}, { seed: 77 }).enemies, createAdventure({}, { seed: 77 }).enemies);
});

test('placement respects spacing, beetle clearance and reachability across 200 seeds', () => {
  const next = random(20261023);
  const seeds = [0, 1, 4294967295, DEFAULT_WORLD_SEED, ...Array.from({ length: 196 }, () => Math.floor(next() * 4294967296))];
  for (const seed of seeds) {
    const world = createOverworld(seed), enemies = world.encounters;
    assert.equal(enemies.length, 34, `${seed}`);
    assert.equal(enemies.filter(e => e.kind === 'beetle').length, 5, `${seed}`);
    assert.equal(enemies.filter(e => e.kind === 'wraith').length, 10, `${seed}`);
    assert.equal(enemies.filter(e => e.zoneId === 'courtyard').length, 12, `${seed}`);
    for (const [i, e] of enemies.entries()) {
      const clearance = e.kind === 'beetle' ? BEETLE_STATS.radius + .25 : .54;
      assert.ok(isWalkable(e.x, e.y, clearance, world), `${seed}:${e.id}: collision margin`);
      assert.equal(getOverworldZone(e.x, e.y).id, e.zoneId);
      assert.ok(e.y < world.safeArea.minY - 7, `${seed}:${e.id}: camp buffer`);
      assert.ok(Math.abs(e.y + 70.5) >= 3, `${seed}:${e.id}: courtyard seam buffer`);
      for (const point of [world.shrine, world.secret, world.ritual]) assert.ok(distance(e, point) >= 2.2, `${seed}:${e.id}: reserved`);
      for (const other of enemies.slice(i + 1)) assert.ok(distance(e, other) >= 1.35 - 1e-8, `${seed}: spacing`);
    }
  }
  // Each full-map search is slow, so only the route-smoke seeds check beetle-radius routes.
  for (const seed of [DEFAULT_WORLD_SEED, 1, 4294967295]) for (const e of createOverworld(seed).encounters.filter(e => e.kind === 'beetle')) {
    const path = findPath(OVERWORLD.spawn, e, BEETLE_STATS.radius, OVERWORLD);
    assert.ok(path.length && distance(path.at(-1), e) < 1.1, `${seed}:${e.id}: beetle-radius route`);
  }
});

test('courtyard beetles are guards: the source stays sealed until they fall', () => {
  const game = createAdventure(), source = game.enemies.find(e => e.kind === 'ritual');
  const guards = game.enemies.filter(e => e.zoneId === 'courtyard' && e.kind !== 'ritual');
  for (const e of guards) if (e.kind !== 'beetle') e.hp = 0;
  updateGame(game, {}, .01);
  assert.equal(source.sealed, true);
  for (const e of guards) e.hp = 0;
  updateGame(game, {}, .01);
  assert.equal(source.sealed, false);
});

test('a strike that only meets a blocking shell earns 4 spirit instead of 12', () => {
  const game = arena([{ state: 'recover', timer: 100 }]);
  strike(game, 0, 1);
  assert.equal(game.player.spirit, MONK_RULES.spirit.initial + MONK_RULES.spirit.perBlockedStrike);
  assert.equal(MONK_RULES.spirit.perBlockedStrike, 4);
  // Four blocked strikes no longer pay for a wave that would break the shell.
  for (let i = 0; i < 3; i++) strike(game, 0, 1);
  assert.equal(game.player.spirit, MONK_RULES.spirit.initial + 4 * MONK_RULES.spirit.perBlockedStrike);
});

test('one unblocked victim in the same strike still earns the full 12 spirit, once', () => {
  for (const [label, other] of [
    ['hound beside the shell', { kind: 'hound', radius: .29, x: .45, y: .9, hp: 500, maxHp: 500, state: 'stunned', timer: 100 }],
    ['second beetle from behind', { x: -.45, y: .9, dx: 0, dy: 1, state: 'recover', timer: 100 }],
  ]) {
    const game = arena([{ state: 'recover', timer: 100 }, other]);
    const events = strike(game, 0, 1);
    assert.deepEqual(events.filter(event => event.type === 'damage').map(event => !!event.blocked).sort(), [false, true], label);
    assert.equal(game.player.spirit, MONK_RULES.spirit.initial + MONK_RULES.spirit.perStrike, label);
  }
  for (const beetle of [{ dx: 0, dy: 1 }, { exposed: true, state: 'stunned', timer: 100 }]) {
    const game = arena([{ state: 'recover', timer: 100, ...beetle }]);
    strike(game, 0, 1);
    assert.equal(game.player.spirit, MONK_RULES.spirit.initial + MONK_RULES.spirit.perStrike, JSON.stringify(beetle));
  }
});

const contact = game => game.player.radius + BEETLE_STATS.radius;
function walk(game, input, seconds, dt = .01) {
  advance(game, seconds, input, dt, () => {
    for (const e of game.enemies) {
      if (e.kind !== 'beetle' || e.hp <= 0) continue;
      assert.ok(distance(e, game.player) >= contact(game) - 1e-9, `monk entered the shell: ${distance(e, game.player)}`);
    }
    assert.ok(isWalkable(game.player.x, game.player.y, game.player.radius, game.world));
  });
}

for (const dt of [.01, .05]) test(`the monk cannot walk through a living beetle at dt=${dt}`, () => {
  const game = arena([{ y: 2, state: 'recover', timer: 100 }]), e = game.enemies[0];
  walk(game, { moveY: 1 }, 1, dt);
  assert.ok(game.player.y < e.y && game.player.y > e.y - contact(game) - .14, `stopped at ${game.player.y}`);
  close(game.player.x, 0);
});

for (const dt of [.01, .05]) test(`an angled walk slides along the shell and gets past at dt=${dt}`, () => {
  const game = arena([{ y: 2, state: 'recover', timer: 100 }]), e = game.enemies[0];
  game.player.x = -.3;
  walk(game, { moveY: 1 }, 1.2, dt);
  assert.ok(game.player.y > e.y + 1, `did not slide past: ${game.player.x},${game.player.y}`);
  assert.ok(game.player.x < -.3, 'the slide goes around the near side');
});

test('the dash still passes through the shell and breaks the guard', () => {
  const game = arena([{ y: 1.5 }]), e = game.enemies[0];
  startDash(game, 0, 1);
  advance(game, MONK_RULES.dash.duration);
  assert.ok(game.player.y > e.y + contact(game), `dash stopped at ${game.player.y}`);
  assert.deepEqual([e.state, e.exposed], ['stunned', true]);
});

test('hounds, wraiths and dead beetles stay non-blocking', () => {
  for (const blocker of [
    { kind: 'hound', radius: .29 }, { kind: 'wraith', radius: .29 }, { hp: 0, state: 'dead' },
  ]) {
    const game = arena([{ y: 2, state: 'stunned', timer: 100, ...blocker }]);
    advance(game, 1, { moveY: 1 });
    assert.ok(game.player.y > 3, `${JSON.stringify(blocker)} blocked the monk at ${game.player.y}`);
  }
});

test('beetles never push the monk: a pressing crowd cannot move him into a wall, the camp or off the ground', () => {
  const wall = { x: .6, y: 7, halfWidth: .1, halfDepth: 3 };
  const game = arena(Array.from({ length: 5 }, (_, i) => ({ x: (i - 2) * .5, y: 3, dx: 0, dy: 1, state: 'chase' })), [wall]);
  game.world.safeArea = { minY: 8, maxY: 12 };
  game.enemies.forEach(e => { e.packId = 'crowd'; e.active = true; });
  Object.assign(game.player, { x: 0, y: 7.6, invulnerable: 1000 });
  const start = { x: game.player.x, y: game.player.y };
  advance(game, 5, {}, .05, () => {
    assert.deepEqual([game.player.x, game.player.y], [start.x, start.y], 'a beetle moved the monk');
    for (const e of game.enemies) {
      assert.ok(distance(e, game.player) >= contact(game) - 1e-9, 'a beetle walked into the monk');
      assert.ok(e.y + e.radius < game.world.safeArea.minY, 'a beetle entered the camp');
    }
  });
  // The pinned monk can still walk away along the open side.
  walk(game, { moveX: -1 }, .5, .05);
  assert.ok(game.player.x < start.x - .3, `trapped at ${game.player.x}`);
});

test('a monk overlapped by a shell can always walk out and never deeper', () => {
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4, input = { moveX: Math.cos(angle), moveY: Math.sin(angle) };
    const game = arena([{ x: .15, y: 0, state: 'recover', timer: 100 }]), e = game.enemies[0];
    let previous = distance(e, game.player);
    advance(game, .5, input, .01, () => {
      const now = distance(e, game.player);
      assert.ok(now >= previous - 1e-9, `direction ${i} pushed the monk deeper`);
      previous = now;
    });
    // Only a walk straight into the shell's center stays inside; every other heading escapes.
    if (i !== 0) assert.ok(previous >= contact(game) - 1e-9, `direction ${i} stayed inside: ${previous}`);
  }
});

test('a returning beetle slides around a monk who stands in its way', () => {
  const game = arena([{ x: 0, y: -8, homeX: 0, homeY: 7, dx: 0, dy: 1, packId: 'p', active: true }]), e = game.enemies[0];
  game.world.safeArea = { minY: 30, maxY: 32 };
  Object.assign(game.player, { x: .3, y: 0, invulnerable: 1000 });
  advance(game, 12, {}, .05, () => assert.ok(distance(e, game.player) >= contact(game) - 1e-6, 'walked through the monk'));
  assert.ok(distance(e, { x: e.homeX, y: e.homeY }) < 1e-6, `stuck at ${e.x},${e.y}`);
  assert.equal(e.state, 'idle');
});

test('knockback never pushes a beetle into the monk, even when a wall stops one axis', () => {
  // A wall right of the beetle stops the x part of the heavy knockback; the y part points at the monk.
  const wall = { x: .83, y: .56, halfWidth: .1, halfDepth: 2 };
  for (const exposed of [false, true]) {
    const game = arena([{ x: .3, y: .56, dx: .47, dy: .88, exposed, state: exposed ? 'stunned' : 'recover', timer: 100 }], [wall]);
    const e = game.enemies[0];
    Object.assign(game.player, { combo: 2, comboTimer: .5 });
    strike(game, 1, -.3);
    assert.equal(e.hp, beetleHp - MONK_RULES.combo.damage[2], 'the strike must land in full');
    assert.ok(distance(e, game.player) >= contact(game) - 1e-9, `knocked into the monk: ${distance(e, game.player)}`);
    assert.ok(isWalkable(e.x, e.y, e.radius, game.world));
  }
});

test('seeded knockback sweep beside walls never ends a beetle inside the monk', () => {
  const next = random(77);
  let hits = 0;
  for (let i = 0; i < 600; i++) {
    const angle = next() * Math.PI * 2, range = .62 + next() * .5;
    const at = { x: Math.cos(angle) * range, y: Math.sin(angle) * range };
    const side = next() * Math.PI * 2, gap = .49 + next() * .05;
    const wall = Math.abs(Math.cos(side)) > Math.abs(Math.sin(side))
      ? { x: at.x + Math.sign(Math.cos(side)) * gap, y: at.y, halfWidth: .1, halfDepth: 2 }
      : { x: at.x, y: at.y + Math.sign(Math.sin(side)) * gap, halfWidth: 2, halfDepth: .1 };
    const exposed = next() < .5, aim = angle + (next() * 2 - 1) * 1.7;
    const game = arena([{ ...at, dx: at.x / range, dy: at.y / range, exposed,
      state: exposed ? 'stunned' : 'recover', timer: 100, hp: 5000, maxHp: 5000 }], [wall]);
    const e = game.enemies[0];
    Object.assign(game.player, { combo: Math.floor(next() * 3), comboTimer: .5 });
    strike(game, Math.cos(aim), Math.sin(aim));
    if (e.hp < 5000) hits++;
    assert.ok(distance(e, game.player) >= contact(game) - 1e-9, `case ${i}: ${distance(e, game.player)}`);
  }
  assert.ok(hits > 300, `only ${hits} strikes landed`);
});
