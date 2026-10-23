import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdventure, startAttack, startDash, updateGame, interact } from '../src/game.js';
import { OVERWORLD, getOverworldZone } from '../src/overworld.js';
import { isWalkable } from '../src/world.js';

test('one persistent adventure contains every pack and the source from the start', () => {
  const game = createAdventure();
  assert.equal(game.world, OVERWORLD);
  assert.equal(game.enemies.length, 35);
  assert.equal(game.enemies.filter(e => e.zoneId === 'road').length, 22);
  assert.equal(game.enemies.filter(e => e.zoneId === 'courtyard' && e.kind !== 'ritual').length, 12);
  assert.equal(game.enemies.find(e => e.kind === 'hound').hp, 64);
  assert.equal(game.enemies.find(e => e.kind === 'wraith').hp, 76);
  for (const zone of OVERWORLD.zones) for (const enemy of game._locations[zone.id].enemies) {
    assert.ok(game.enemies.includes(enemy), 'compatibility views must share the same bodies');
  }
  assert.equal(game.locationId, 'camp'); assert.equal(game.locationRevision, 0);
  assert.equal(game.enemies.filter(e => e.zoneId === 'camp').length, 0);
  assert.equal(interact(game), false);
});

test('walking or dashing across either seam in both directions never resets shared state', () => {
  for (const seam of [-29.5, -70.5]) for (const direction of [-1, 1]) for (const dash of [false, true]) {
    const game = createAdventure();
    Object.assign(game.player, { x: 0, y: seam - direction * .04, hp: 77, spirit: 54 });
    updateGame(game, {}, 0);
    const from = game.locationId, world = game.world, bodies = game.enemies;
    const wounded = bodies.find(e => e.zoneId === 'road');
    wounded.hp = 23;
    const effect = { type: 'wave', age: 0, life: 2 };
    const shot = { id: 'seam-shot', x: 0, y: seam - 3, dx: 1, dy: 0, radius: .13, life: 2 };
    game.effects.push(effect); game.events.push({ type: 'retained-event' }); game.projectiles.push(shot);
    if (dash) startDash(game, 0, direction); else startAttack(game, 0, direction);
    const attack = game.player.attack;
    const beforeY = game.player.y;
    updateGame(game, { moveY: direction }, .05);
    assert.notEqual(game.locationId, from);
    assert.equal(game.locationId, getOverworldZone(game.player.x, game.player.y).id);
    assert.ok(Math.abs(game.player.y - beforeY) < .81, 'no teleport at the seam');
    assert.equal(game.world, world); assert.equal(game.enemies, bodies); assert.equal(game.locationRevision, 0);
    assert.equal(wounded.hp, 23); assert.equal(game.player.hp, 77); assert.equal(game.player.spirit, 54);
    assert.ok(game.effects.includes(effect)); assert.ok(game.projectiles.includes(shot));
    assert.ok(game.events.some(e => e.type === 'retained-event'));
    assert.ok(game.events.some(e => e.type === 'area-enter' && e.from === from && e.to === game.locationId));
    if (dash) assert.ok(game.player.dashTime > 0); else assert.equal(game.player.attack, attack);
    const position = [game.player.x, game.player.y];
    assert.equal(interact(game), false, 'E must not travel');
    assert.deepEqual([game.player.x, game.player.y], position);
  }
});

test('nearby visible pack wakes together while distant packs remain dormant', () => {
  const game = createAdventure();
  Object.assign(game.player, { x: -2, y: -35 });
  assert.ok(isWalkable(game.player.x, game.player.y, game.player.radius, game.world));
  updateGame(game, {}, .01);
  const pack = game.enemies.filter(e => e.packId === 'road-approach');
  assert.equal(pack.length, 5);
  assert.ok(pack.every(e => e.state !== 'idle'));
  assert.ok(game.enemies.filter(e => e.packId && e.packId !== 'road-approach').every(e => e.state === 'idle'));
  assert.equal(game.events.filter(e => e.type === 'alert').length, 5);
});

test('pack activation needs line of sight and does not advance distant AI', () => {
  const game = createAdventure();
  const far = game.enemies.filter(e => e.zoneId === 'courtyard');
  const before = JSON.stringify(far);
  for (let i = 0; i < 300; i++) updateGame(game, {}, .05);
  assert.equal(JSON.stringify(far), before);
  Object.assign(game.player, { x: 0, y: -40 });
  const pack = game.enemies.filter(e => e.packId === 'road-approach');
  pack.forEach((e, i) => Object.assign(e, { x: i - 2, y: -44, homeX: i - 2, homeY: -44 }));
  const wall = { x: 0, y: -42, halfWidth: 5, halfDepth: .15 };
  game.world = { ...OVERWORLD, obstacles: [...OVERWORLD.obstacles, wall] };
  updateGame(game, {}, .01);
  assert.ok(pack.every(e => e.state === 'idle'));
  game.world.obstacles.pop(); updateGame(game, {}, .01);
  assert.ok(pack.every(e => e.state !== 'idle'));
});

test('hostile projectiles cannot enter the safe camp', () => {
  const game = createAdventure();
  Object.assign(game.player, { x: 0, y: -29.3 });
  game.projectiles.push({ id: 'border-shot', x: 0, y: -29.6, dx: 0, dy: 1, radius: .13, life: 1 });
  updateGame(game, {}, .05);
  assert.equal(game.player.hp, 100); assert.equal(game.projectiles.length, 0);
});

test('pack leashes home by movement without entering safe camp or restoring wounded HP', () => {
  const game = createAdventure();
  Object.assign(game.player, { x: -2, y: -35 });
  const pack = game.enemies.filter(e => e.packId === 'road-approach');
  pack[0].hp = 31;
  updateGame(game, {}, .01);
  for (let tick = 0; tick < 350; tick++) {
    const previous = pack.map(e => [e.x, e.y]);
    updateGame(game, game.player.y < -28 ? { moveY: 1 } : {}, .05);
    pack.forEach((e, i) => {
      assert.ok(e.y + e.radius < OVERWORLD.safeArea.minY, 'enemy entered the safe camp');
      assert.ok(Math.hypot(e.x - previous[i][0], e.y - previous[i][1]) < .5, 'leash teleported an enemy');
    });
  }
  assert.equal(game.player.hp, 100); assert.equal(pack[0].hp, 31);
  assert.ok(pack.every(e => e.state === 'idle' && Math.hypot(e.x - e.homeX, e.y - e.homeY) < .2));
});

test('only courtyard guardians seal the source even when the player is elsewhere', () => {
  const game = createAdventure(), source = game.enemies.find(e => e.kind === 'ritual');
  assert.ok(source, 'persistent source is present while player is in camp');
  const guards = game.enemies.filter(e => e.zoneId === 'courtyard' && e.kind !== 'ritual');
  for (const e of guards.slice(1)) e.hp = 0;
  updateGame(game, {}, .01); assert.equal(source.sealed, true);
  guards[0].hp = 0; updateGame(game, {}, .01);
  assert.equal(source.sealed, false);
  assert.ok(game.enemies.filter(e => e.zoneId === 'road').every(e => e.hp > 0));
  updateGame(game, {}, .01);
  assert.equal(game.events.filter(e => e.type === 'ritual-open').length, 1);
});
