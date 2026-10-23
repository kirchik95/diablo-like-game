import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, updateGame, startAttack, startDash, startWave } from '../src/game.js';
import { isWalkable } from '../src/world.js';

const idle = { moveX: 0, moveY: 0, aimX: 1, aimY: 0, attack: false };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function arena() {
  const game = createGame(), template = game.enemies[0], tiles = [];
  for (let x = -8; x <= 8; x++) for (let y = -8; y <= 8; y++) tiles.push({ x, y });
  game.world = { tiles, obstacles: [], shrine: null };
  Object.assign(game.player, { x: 0, y: 0 });
  game.enemies = [];
  const enemy = (x, y, hp = 500) => {
    const e = { ...template, id: game.enemies.length, x, y, homeX: x, homeY: y,
      hp, maxHp: hp, state: 'stunned', timer: 100, path: [] };
    game.enemies.push(e); return e;
  };
  return { game, enemy };
}
function advance(game, duration, input = idle, dt = .01) {
  for (let i = 0; i < Math.round(duration / dt); i++) updateGame(game, input, dt);
}

test('cleaving combo deals 24/30/48 once per victim and generates spirit once per connected strike', () => {
  const { game, enemy } = arena(), a = enemy(.7, .2), b = enemy(.7, -.2), rear = enemy(-1, 0);
  assert.equal(game.player.spirit, 60);
  for (const [index, duration, damage, spirit] of [[0, .22, 24, 72], [1, .24, 30, 84], [2, .31, 48, 96]]) {
    Object.assign(a, { x: .7, y: .2 }); Object.assign(b, { x: .7, y: -.2 });
    const hp = a.hp;
    assert.equal(startAttack(game, 1, 0), true);
    assert.equal(game.player.attack.index, index);
    advance(game, duration);
    assert.equal(game.player.attack, null, 'recovery must finish at the new duration');
    assert.equal(a.hp, hp - damage); assert.equal(b.hp, a.hp); assert.equal(rear.hp, 500);
    assert.equal(game.player.spirit, spirit, 'two victims must not double resource gain');
  }
  assert.equal(game.events.filter(e => e.type === 'impact' && e.strength === 'heavy').length, 2);
});

test('a miss or blocked hit gains no spirit; a connected strike caps it at 100', () => {
  const { game, enemy } = arena();
  startAttack(game, 1, 0); advance(game, .3);
  assert.equal(game.player.spirit, 60);
  const target = enemy(1, 0);
  game.world.obstacles.push({ x: .5, y: 0, halfWidth: .1, halfDepth: 2 });
  startAttack(game, 1, 0); advance(game, .3);
  assert.equal(target.hp, 500); assert.equal(game.player.spirit, 60);
  game.world.obstacles.length = 0; game.player.spirit = 95;
  startAttack(game, 1, 0); advance(game, .32);
  assert.equal(game.player.spirit, 100);
});

test('wave spends 40 spirit on a valid cast, deals 72 within 3.4u and rejects cooldown/resource failures atomically', () => {
  const { game, enemy } = arena(), near = enemy(3.2, 0), outside = enemy(3.6, 0);
  assert.equal(startWave(game), true);
  assert.equal(near.hp, 428); assert.equal(outside.hp, 500); assert.equal(game.player.spirit, 20);
  const events = game.events.length;
  assert.equal(startWave(game), false); assert.equal(game.events.length, events);
  advance(game, 1.2);
  startAttack(game, -1, 0);
  const attack = game.player.attack;
  assert.equal(startWave(game), false, 'insufficient spirit after cooldown');
  assert.equal(game.player.attack, attack); assert.equal(game.player.spirit, 20);
  close(game.player.waveCooldown, 0);
  game.player.spirit = 40;
  assert.equal(startWave(game), true); assert.equal(game.player.spirit, 0);
  close(game.player.waveCooldown, 1.2);
});

test('attack movement is 65 percent of run speed while its clock stays real time', () => {
  const { game } = arena();
  startAttack(game, 1, 0); advance(game, .2, { ...idle, moveX: 1 });
  close(game.player.x, .702); close(game.player.attack.age, .2);
});

test('holding attack continues the faster combo without multiplying spirit gain', () => {
  const { game, enemy } = arena(), target = enemy(.3, 0);
  advance(game, 1, { ...idle, attack: true });
  assert.equal(target.hp, 374, 'four connected strikes: 24 + 30 + 48 + 24');
  assert.equal(game.events.filter(e => e.type === 'swing').length, 5);
  assert.equal(game.events.filter(e => e.type === 'damage').length, 4);
  assert.equal(game.player.spirit, 100);
});

test('one dash can hit several victims, but its hit set never repeats a victim', () => {
  const { game, enemy } = arena();
  const victims = [enemy(.3, 0), enemy(1.2, .1), enemy(2.1, -.1)], offPath = enemy(1.2, 1);
  startDash(game, 1, 0); advance(game, .2, idle, .05);
  assert.deepEqual(victims.map(e => e.hp), [468, 468, 468]); assert.equal(offPath.hp, 500);
  assert.equal(game.player.spirit, 60, 'dash does not generate combo spirit');
});

for (const dt of [.01, .05]) test(`dash sweeps the full path and damages a target once per dash at dt=${dt}`, () => {
  const { game, enemy } = arena(), target = enemy(.25, 0);
  target.radius = .01; // Lies strictly between both .05s frame endpoints, outside their contact disks.
  assert.equal(startDash(game, 1, 0), true);
  advance(game, .2, idle, dt);
  close(game.player.x, 3.2); assert.equal(target.hp, 468);
  assert.equal(game.events.filter(e => e.type === 'damage' && e.source === 'dash').length, 1);
  advance(game, 1.2);
  assert.equal(startDash(game, -1, 0), true);
  advance(game, .2, idle, dt);
  assert.equal(target.hp, 436, 'a new dash has a fresh hit set');
});

test('damaging dash cannot strike through a solid wall or tunnel across it', () => {
  const { game, enemy } = arena(), target = enemy(.8, 0);
  game.world.obstacles.push({ x: .5, y: 0, halfWidth: .1, halfDepth: 2 });
  startDash(game, 1, 0); advance(game, .2, idle, .05);
  assert.ok(game.player.x < .18); assert.equal(target.hp, 500);
  assert.ok(isWalkable(game.player.x, game.player.y, game.player.radius, game.world));
});

for (const initialHp of [70, 95]) test(`fourth ordinary kill drops one proximity pickup with capped healing from ${initialHp}HP`, () => {
  const { game, enemy } = arena();
  for (let i = 0; i < 4; i++) enemy(1.5, (i - 1.5) * .3, 24);
  game.player.hp = initialHp;
  startWave(game);
  assert.equal(game.kills, 4); assert.ok(Array.isArray(game.pickups), 'kills must expose proximity pickups');
  assert.equal(game.pickups.length, 1);
  const pickup = game.pickups[0]; assert.equal(pickup.amount, 18);
  for (let i = 0; i < 100 && game.pickups.length; i++) {
    const dx = pickup.x - game.player.x, dy = pickup.y - game.player.y, length = Math.hypot(dx, dy);
    updateGame(game, { ...idle, moveX: dx / length, moveY: dy / length }, .01);
  }
  assert.equal(game.pickups.length, 0); assert.equal(game.player.hp, Math.min(100, initialHp + 18));
  assert.equal(game.events.filter(e => e.type === 'pickup').length, 1);
  assert.equal(game.events.filter(e => e.type === 'heal').length, 1);
  assert.equal(game.events.find(e => e.type === 'heal').source, 'pickup');
  advance(game, .5); assert.equal(game.player.hp, Math.min(100, initialHp + 18));
});
