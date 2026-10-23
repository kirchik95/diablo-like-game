import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/game.js';
import { LOCATIONS } from '../src/campaign.js';
import { OVERWORLD } from '../src/overworld.js';
import { isWalkable, clearLine } from '../src/world.js';

const adventure = appearance => api.createAdventure(appearance);
function kill(game, enemy) {
  if (enemy.hp <= 0) return;
  // A real lethal contact isolates progression; the no-cheat route verifies actual balance.
  const point = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([x, y]) => ({ x: enemy.x + x, y: enemy.y + y }))
    .find(p => isWalkable(p.x, p.y, .23, game.world) && clearLine(p, enemy, .05, game.world));
  assert.ok(point);
  Object.assign(game.player, point, { attack: null, dashTime: 0, invulnerable: 100 });
  enemy.hp = 1;
  if (enemy.kind !== 'ritual') { enemy.state = 'stunned'; enemy.timer = 10; }
  assert.equal(api.startAttack(game, enemy.x - point.x, enemy.y - point.y), true);
  for (let i = 0; i < 4; i++) api.updateGame(game, {}, .05);
  assert.equal(enemy.hp, 0, `lethal contact failed for ${enemy.id}`);
}
function clearGuardians(game) {
  for (const e of game.enemies.filter(e => e.zoneId === 'courtyard' && e.kind !== 'ritual')) kill(game, e);
}

test('adventure: independent runs preserve appearance and the separate playable legacy fixture', () => {
  const old = api.createGame();
  assert.equal(old.world, undefined); assert.equal(old.enemies.length, 1);
  const look = { skin: 'deep', hair: 'short', sash: 'teal' }, game = adventure(look), fresh = adventure(look);
  assert.equal(game.world, OVERWORLD); assert.equal(game.enemies.length, 35);
  assert.deepEqual(game.appearance, look); assert.notEqual(game.appearance, look);
  game.enemies[0].hp = 1; game.player.spirit = 0;
  assert.equal(fresh.enemies[0].hp, fresh.enemies[0].maxHp); assert.equal(fresh.player.spirit, 60);
  assert.deepEqual(game.adventure.visited, ['camp']); assert.equal(game.adventure.quest, 'outbound');
  assert.ok(api.getObjective(game).title && api.getObjective(game).copy);
  assert.equal(api.getInteractionPrompt(game), '');
});

test('adventure: E has no travel action and requires proximity to the optional cache', () => {
  const game = adventure();
  Object.assign(game.player, { x: 0, y: -29.4 });
  const world = game.world, bodies = game.enemies, location = game.locationId;
  assert.equal(api.getInteractionPrompt(game), ''); assert.equal(api.interact(game), false);
  assert.equal(game.world, world); assert.equal(game.enemies, bodies); assert.equal(game.locationId, location);
  Object.assign(game.player, { x: game.world.secret.x + 2, y: game.world.secret.y, hp: 50 });
  assert.equal(api.interact(game), false);
  Object.assign(game.player, game.world.secret);
  assert.ok(api.getInteractionPrompt(game).includes('тайник')); assert.equal(api.interact(game), true);
  assert.equal(game.adventure.secretFound, true); assert.equal(game.player.hp, 75);
  assert.equal(api.interact(game), false); assert.equal(game.player.hp, 75);
});

test('adventure: source requires exactly the courtyard guardians and is destroyed once without an ordinary kill', () => {
  const game = adventure(), source = game.enemies.find(e => e.kind === 'ritual');
  Object.assign(game.player, { x: source.x, y: source.y + 1 });
  const hp = source.hp, position = { x: source.x, y: source.y };
  api.startWave(game); assert.equal(source.hp, hp); assert.equal(source.sealed, true);
  clearGuardians(game);
  assert.equal(source.sealed, false); assert.equal(game.kills, 12); assert.equal(game.adventure.totalKills, 12);
  assert.ok(game.enemies.filter(e => e.zoneId === 'road').every(e => e.hp > 0));
  assert.equal(game.events.filter(e => e.type === 'ritual-open').length, 1);
  Object.assign(game.player, { x: source.x, y: source.y + 1, spirit: 100, waveCooldown: 0 });
  api.startWave(game); assert.equal(source.hp, hp - 72);
  assert.deepEqual({ x: source.x, y: source.y }, position);
  const wounded = source.hp;
  // Cross the real court/road seam both ways; the wounded source remains the same body.
  Object.assign(game.player, { x: 0, y: -70.55, attack: null });
  api.updateGame(game, { moveY: 1 }, .05);
  assert.equal(game.locationId, 'road'); assert.equal(source.hp, wounded);
  api.updateGame(game, { moveY: -1 }, .05);
  assert.equal(game.locationId, 'courtyard'); assert.equal(source.hp, wounded);
  assert.equal(source.sealed, false); assert.equal(game.locationRevision, 0);
  kill(game, source);
  assert.equal(game.kills, 12); assert.equal(game.adventure.totalKills, 12);
  assert.equal(game.adventure.quest, 'return'); assert.equal(game.phase, 'playing');
  game.player.waveCooldown = 0; game.player.spirit = 100; api.startWave(game);
  assert.equal(game.events.filter(e => e.type === 'ritual-destroyed').length, 1);
});

test('adventure: shrine and cache retain one-use state when walking out and back across their area seam', () => {
  const game = adventure();
  Object.assign(game.player, game.world.secret, { hp: 50 }); api.interact(game);
  Object.assign(game.player, game.world.shrine, { hp: 20 }); api.updateGame(game, {}, .01);
  assert.equal(game.shrineUsed, true); assert.equal(game.player.hp, 60);
  Object.assign(game.player, { x: 0, y: -29.6 });
  api.updateGame(game, { moveY: 1 }, .05); assert.equal(game.locationId, 'camp');
  api.updateGame(game, { moveY: -1 }, .05); assert.equal(game.locationId, 'road');
  Object.assign(game.player, game.world.shrine, { hp: 20 }); api.updateGame(game, {}, .01);
  assert.equal(game.player.hp, 20);
  Object.assign(game.player, game.world.secret); assert.equal(api.interact(game), false);
  assert.equal(game._locations.road.shrineUsed, true);
});

test('adventure: only a destroyed source awards the return bead, and the cache stays optional', () => {
  const game = adventure(); Object.assign(game.player, game.world.reward);
  assert.equal(api.interact(game), false);
  clearGuardians(game); kill(game, game.enemies.find(e => e.kind === 'ritual'));
  assert.equal(game.adventure.secretFound, false);
  Object.assign(game.player, { x: game.world.reward.x + 2, y: game.world.reward.y });
  assert.equal(api.interact(game), false);
  Object.assign(game.player, game.world.reward);
  assert.equal(api.interact(game), true); assert.equal(game.adventure.rewardCollected, true);
  assert.equal(game.adventure.quest, 'complete'); assert.equal(game.phase, 'victory');
  assert.equal(game.events.filter(e => e.type === 'reward').length, 1); assert.equal(api.interact(game), false);
});

test('adventure: defeat freezes the whole world and restart restores all packs, pickups and spirit', () => {
  const game = adventure({ skin: 'pale', hair: 'short', sash: 'ochre' });
  const hound = game.enemies.find(e => e.kind === 'hound');
  Object.assign(game.player, { x: 0, y: -42, hp: 10, invulnerable: 0 });
  Object.assign(hound, { x: .2, y: -42, state: 'leap', timer: .2, dx: -1, dy: 0, hit: false, active: true });
  game.player.spirit = 0; game.pickups.push({ id: 'old', x: 0, y: -50, amount: 18 });
  api.updateGame(game, {}, .01); assert.equal(game.phase, 'defeat');
  const frozen = structuredClone(game);
  api.updateGame(game, { attack: true, moveY: 1 }, .05);
  assert.equal(api.interact(game), false); assert.deepEqual(game, frozen);
  const fresh = adventure(game.appearance);
  assert.deepEqual(fresh.appearance, game.appearance); assert.notEqual(fresh.appearance, game.appearance);
  assert.ok(fresh.enemies.every(e => e.hp === e.maxHp)); assert.equal(fresh.shrineUsed, false);
  assert.equal(fresh.player.spirit, 60); assert.deepEqual(fresh.pickups, []);
  assert.equal(fresh.adventure.totalKills, 0); assert.equal(fresh.adventure.elapsed, 0); assert.equal(fresh.locationId, 'camp');
});

test('adventure: a paused world cannot use cache or reward or advance movement and enemies', () => {
  for (const point of ['secret', 'reward']) {
    const game = adventure(); game.adventure.quest = 'return';
    Object.assign(game.player, game.world[point], { hp: 30 }); game.phase = 'paused';
    const before = structuredClone(game);
    assert.equal(api.getInteractionPrompt(game), ''); assert.equal(api.interact(game), false);
    assert.equal(api.startDash(game, 1, 0), false); assert.equal(api.startWave(game), false);
    api.updateGame(game, { moveX: 1, attack: true }, .05);
    assert.deepEqual(game, before);
  }
});

function rangedEncounter() {
  const game = adventure();
  // Local authored geometry isolates projectile/LOS behavior; persistent travel is tested separately.
  game.world = LOCATIONS.road; game.locationId = 'road';
  const wraith = game.enemies.find(e => e.kind === 'wraith');
  game.enemies = [wraith];
  Object.assign(wraith, { x: -2, y: 6, state: 'chase', timer: 0, attackCooldown: 0 });
  Object.assign(game.player, { x: 2, y: 6, invulnerable: 0 });
  game.events = [];
  return { game, wraith };
}
function advance(game, duration, step = .01) {
  for (let t = 0; t < duration - 1e-9; t += step) api.updateGame(game, {}, Math.min(step, duration - t));
}

test('adventure wraith: aim locks for 0.8 seconds and releases one non-homing shot before recovery', () => {
  const { game, wraith } = rangedEncounter();
  api.updateGame(game, {}, .01);
  assert.equal(wraith.state, 'windup'); assert.equal(wraith.timer, .8);
  const direction = { dx: wraith.dx, dy: wraith.dy };
  Object.assign(game.player, { x: 0, y: 4 });
  advance(game, .79);
  assert.equal(wraith.state, 'windup'); assert.equal(game.projectiles.length, 0);
  assert.deepEqual({ dx: wraith.dx, dy: wraith.dy }, direction);
  advance(game, .01);
  assert.equal(wraith.state, 'recover'); assert.equal(wraith.timer, .6);
  assert.equal(game.projectiles.length, 1);
  const shot = game.projectiles[0], start = { x: shot.x, y: shot.y };
  assert.deepEqual({ dx: shot.dx, dy: shot.dy }, { dx: 1, dy: 0 });
  advance(game, .3);
  assert.equal(game.events.filter(e => e.type === 'shot').length, 1);
  assert.equal(shot.y, start.y); assert.ok(shot.x > start.x);
  assert.equal(wraith.state, 'recover');
  advance(game, .29); assert.equal(wraith.state, 'recover');
  advance(game, .01); assert.equal(wraith.state, 'chase');
  assert.equal(game.events.filter(e => e.type === 'shot').length, 1);
});

test('adventure wraith: stun or lethal damage cancels an unfinished shot', () => {
  for (const hp of [76, 1]) {
    const { game, wraith } = rangedEncounter();
    Object.assign(game.player, { x: 0, y: 6 }); wraith.hp = hp;
    api.updateGame(game, {}, .01); assert.equal(wraith.state, 'windup');
    advance(game, .3); assert.equal(api.startWave(game), true);
    assert.equal(wraith.state, hp === 1 ? 'dead' : 'stunned');
    advance(game, .5);
    assert.equal(game.projectiles.length, 0);
    assert.equal(game.events.filter(e => e.type === 'shot').length, 0);
  }
});

test('adventure wraith: a solid pillar blocks projectiles, including coarse updates', () => {
  for (const step of [1 / 120, .05]) {
    const { game, wraith } = rangedEncounter();
    const pillar = game.world.pillars[0];
    Object.assign(game.player, { x: pillar.x + 2, y: pillar.y });
    Object.assign(wraith, { x: pillar.x - 2, y: pillar.y, state: 'windup', timer: .01, dx: 1, dy: 0 });
    assert.ok(isWalkable(game.player.x, game.player.y, game.player.radius, game.world));
    assert.ok(isWalkable(wraith.x, wraith.y, wraith.radius, game.world));
    api.updateGame(game, {}, .01);
    assert.equal(game.projectiles.length, 1);
    wraith.state = 'stunned'; wraith.timer = 10;
    advance(game, 1, step);
    assert.equal(game.projectiles.length, 0);
    assert.equal(game.player.hp, 100);
  }
});

test('adventure wraith: a shot damages once at fine and coarse update sizes', () => {
  for (const step of [1 / 120, .05]) {
    const { game, wraith } = rangedEncounter();
    Object.assign(wraith, { state: 'windup', timer: .01, dx: 1, dy: 0 });
    api.updateGame(game, {}, .01); wraith.state = 'stunned'; wraith.timer = 10;
    advance(game, 1, step);
    assert.equal(game.player.hp, 88);
    assert.equal(game.projectiles.length, 0);
    assert.equal(game.events.filter(e => e.type === 'hurt').length, 1);
  }
});

test('adventure wraith: dash and damage immunity absorb overlapping shots without damage', () => {
  for (const dash of [false, true]) {
    const { game } = rangedEncounter(); game.enemies = [];
    game.projectiles = [{ id: 'overlap', x: dash ? 1.3 : 1.8, y: 6, dx: 1, dy: 0, radius: .13, life: 1 }];
    if (dash) assert.equal(api.startDash(game, -1, 0), true);
    else game.player.invulnerable = .4;
    api.updateGame(game, {}, .05);
    assert.equal(game.player.hp, 100);
    assert.equal(game.projectiles.length, 0, 'the test must actually intersect the immune body');
  }
});

test('adventure wraith: pause freezes shot, windup, action and elapsed time, then resumes', () => {
  const { game, wraith } = rangedEncounter();
  api.updateGame(game, {}, .01);
  game.projectiles.push({ id: 'paused', x: -3, y: 5, dx: 1, dy: 0, radius: .13, life: 1 });
  api.startAttack(game, 1, 0); game.phase = 'paused';
  const before = structuredClone(game);
  api.updateGame(game, { moveX: 1 }, .05);
  assert.equal(api.interact(game), false);
  assert.equal(api.startDash(game, 1, 0), false);
  assert.deepEqual(game, before);
  game.phase = 'playing'; api.updateGame(game, {}, .05);
  assert.ok(wraith.timer < .8);
  assert.ok(game.projectiles[0].x > -3);
  assert.ok(game.adventure.elapsed > before.adventure.elapsed);
});

test('adventure wraith: it routes around scenery to a firing line instead of shooting through a pillar', () => {
  const { game, wraith } = rangedEncounter();
  const pillar = game.world.pillars[0];
  Object.assign(wraith, { x: pillar.x - 2, y: pillar.y });
  Object.assign(game.player, { x: pillar.x + 2, y: pillar.y, invulnerable: 100 });
  assert.ok(isWalkable(game.player.x, game.player.y, game.player.radius, game.world));
  assert.ok(isWalkable(wraith.x, wraith.y, wraith.radius, game.world));
  api.updateGame(game, {}, .01);
  assert.notEqual(wraith.state, 'windup');
  for (let i = 0; i < 1500 && !game.events.some(e => e.type === 'shot'); i++) api.updateGame(game, {}, 1 / 120);
  const shot = game.events.find(e => e.type === 'shot');
  assert.ok(shot, 'blocked wraith must eventually find a firing line');
  assert.equal(clearLine(shot, game.player, .13, game.world), true);
});

