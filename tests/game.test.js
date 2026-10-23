import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, updateGame, startAttack, startDash, startWave } from '../src/game.js';
import { isWalkable, moveBody, findPath, SPAWN, EXIT, SHRINE, HOUND_SPAWNS } from '../src/world.js';

const idle = { moveX: 0, moveY: 0, aimX: 1, aimY: 0, attack: false };
function advance(game, seconds, input = idle) {
  for (let t = 0; t < seconds - 1e-8; t += 1 / 120) updateGame(game, input, 1 / 120);
}
function encounter() {
  const game = createGame();
  game.player.x = 0;
  game.player.y = 0;
  game.enemies = [game.enemies[0]];
  Object.assign(game.enemies[0], { x: 1, y: 0, hp: 200, maxHp: 200, state: 'stunned', timer: 10 });
  return game;
}

test('a swing damages each target only once, and not behind the monk', () => {
  const game = encounter();
  const behind = { ...game.enemies[0], id: 99, x: -1 };
  game.enemies.push(behind);
  assert.equal(startAttack(game, 1, 0), true);
  advance(game, 0.3);
  assert.equal(game.enemies[0].hp, 176);
  assert.equal(behind.hp, 200);
});

test('three consecutive strikes finish stronger and an idle gap resets the combo', () => {
  const game = encounter();
  for (let i = 0; i < 3; i++) {
    game.enemies[0].x = 1;
    game.enemies[0].y = 0;
    startAttack(game, 1, 0);
    advance(game, 0.36);
  }
  assert.equal(game.enemies[0].hp, 98);
  advance(game, 0.9);
  startAttack(game, 1, 0);
  assert.equal(game.player.attack.index, 0);
});

test('a dash grants immunity, moves, and cannot be retriggered during its cooldown', () => {
  const game = encounter();
  assert.equal(startDash(game, 1, 0), true);
  assert.equal(startDash(game, 1, 0), false);
  Object.assign(game.enemies[0], { x: 0.2, state: 'leap', timer: 0.2, dx: -1, dy: 0, hit: false });
  advance(game, 0.1);
  assert.equal(game.player.hp, 100);
  assert.ok(game.player.x > 0.7);
  advance(game, 1.5);
  assert.equal(startDash(game, -1, 0), true);
});

test('wave damages nearby monsters, interrupts attacks, and respects cooldown', () => {
  const game = encounter();
  game.enemies[0].state = 'windup';
  game.enemies.push({ ...game.enemies[0], id: 99, x: 4 });
  assert.equal(startWave(game), true);
  assert.equal(game.enemies[0].hp, 128);
  assert.equal(game.enemies[0].state, 'stunned');
  assert.equal(game.enemies[1].hp, 200);
  assert.equal(startWave(game), false);
});

test('a hound telegraphs its leap, then recovers and damages once', () => {
  const game = encounter();
  Object.assign(game.enemies[0], { state: 'chase', timer: 0, attackCooldown: 0, x: 1.5 });
  advance(game, 0.05);
  assert.equal(game.enemies[0].state, 'windup');
  assert.equal(game.player.hp, 100);
  advance(game, 0.8);
  assert.equal(game.enemies[0].state, 'recover');
  assert.equal(game.player.hp, 84);
});

test('lethal damage ends the run and a fresh run fully restores state', () => {
  const game = encounter();
  game.player.hp = 10;
  Object.assign(game.enemies[0], { x: 0.2, state: 'leap', timer: 0.2, dx: -1, dy: 0, hit: false });
  advance(game, 0.05);
  assert.equal(game.phase, 'defeat');
  assert.equal(game.player.hp, 0);
  const fresh = createGame();
  assert.equal(fresh.player.hp, 100);
  assert.equal(fresh.kills, 0);
  assert.equal(fresh.player.waveCooldown, 0);
  assert.equal(fresh.enemies.length, HOUND_SPAWNS.length);
});

test('all encounters, shrine and exit are connected to the entrance', () => {
  for (const target of [EXIT, SHRINE, ...HOUND_SPAWNS]) {
    const path = findPath(SPAWN, target);
    assert.ok(path.length > 0, JSON.stringify(target));
    assert.ok(path.every(p => isWalkable(p.x, p.y, 0.2)));
  }
});

test('fast motion cannot tunnel through the edge of a platform', () => {
  const body = { x: 0, y: 0, radius: 0.25 };
  moveBody(body, 100, 100);
  assert.ok(isWalkable(body.x, body.y, body.radius));
  assert.ok(body.x < 6 && body.y < 6);
});

test('clearing the monsters opens the exit but victory requires reaching it', () => {
  const game = createGame();
  game.enemies.forEach(e => { e.hp = 0; });
  game.kills = game.enemies.length;
  advance(game, 0.1);
  assert.equal(game.phase, 'playing');
  Object.assign(game.player, EXIT);
  advance(game, 0.05);
  assert.equal(game.phase, 'victory');
});

test('the shrine heals once and cannot be farmed', () => {
  const game = createGame();
  Object.assign(game.player, SHRINE, { hp: 25 });
  advance(game, 0.05);
  assert.equal(game.player.hp, 65);
  game.player.hp = 30;
  advance(game, 0.05);
  assert.equal(game.player.hp, 30);
});

test('a chasing hound routes around the brazier on the path to the gate', () => {
  const game = createGame();
  Object.assign(game.player, { x: 3, y: -3, invulnerable: 100 });
  game.enemies = [game.enemies[0]];
  Object.assign(game.enemies[0], { x: 3, y: 1, state: 'chase' });
  let attacked = false;
  for (let i = 0; i < 1200; i++) {
    updateGame(game, idle, 1 / 120);
    if (game.enemies[0].state === 'windup') { attacked = true; break; }
  }
  assert.equal(attacked, true, 'hound got stuck before the brazier');
});

test('a hound uses its full body radius when approaching the side shrine', () => {
  const game = createGame();
  Object.assign(game.player, { x: -5.5, y: 0, invulnerable: 100 });
  game.enemies = [game.enemies[0]];
  game.enemies[0].state = 'chase';
  let attacked = false;
  for (let i = 0; i < 2400; i++) {
    updateGame(game, idle, 1 / 120);
    if (game.enemies[0].state === 'windup') { attacked = true; break; }
  }
  assert.equal(attacked, true, 'hound should route around the brazier rather than squeeze through it');
});
