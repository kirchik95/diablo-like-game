import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, updateGame } from '../src/game.js';
import { gainXp, spendPathPoint } from '../src/run-progress.js';

const idle = { moveX: 0, moveY: 0, aimX: 1, aimY: 0, attack: false };
const BODY = ['tempering', 'second-wind', 'stone-skin', 'last-breath'];

// Level 8 opens row 4. A hound hit is 16, ×0.9 with «Каменная кожа» = 14.
function monk({ lastBreath = true } = {}) {
  const game = createGame(), tiles = [];
  for (let x = -10; x <= 10; x++) for (let y = -10; y <= 10; y++) tiles.push({ x, y });
  game.world = { tiles, obstacles: [], shrine: null };
  Object.assign(game.player, { x: 0, y: 0 });
  game.enemies = [];
  gainXp(game, 4580);
  for (const id of lastBreath ? BODY : BODY.slice(0, 3)) assert.equal(spendPathPoint(game, id).ok, true, id);
  assert.equal(game.player.maxHp, 156 + 15);
  game.events.length = 0;
  return game;
}
// One hound leap from beside the monk; returns the damage the monk took.
function leap(game) {
  const before = game.player.hp;
  game.enemies = [{ ...createGame().enemies[0], id: 'leaper', x: .2, y: 0, homeX: .2, homeY: 0,
    hp: 500, maxHp: 500, state: 'leap', timer: .2, dx: -1, dy: 0, hit: false }];
  updateGame(game, idle, .01);
  game.enemies = [];
  return before - game.player.hp;
}
const advance = (game, seconds) => { for (let i = 0; i < Math.round(seconds / .05); i++) updateGame(game, idle, .05); };
const breaths = game => game.events.filter(event => event.type === 'last-breath');

test('«Последний вздох»: a hit below 25% health gives 1.5 s of invulnerability once per 60 s', () => {
  const game = monk(), p = game.player;
  p.hp = 50;
  assert.equal(leap(game), 14);
  assert.ok(p.hp < p.maxHp * .25);
  assert.equal(p.invulnerable, 1.5);
  assert.equal(p.lastBreathCooldown, 60);
  assert.equal(breaths(game).length, 1);
  assert.deepEqual([breaths(game)[0].invulnerable, breaths(game)[0].cooldown], [1.5, 60]);
  advance(game, 1);
  assert.equal(leap(game), 0, 'a hit inside the 1.5 s is ignored');
  advance(game, .55);
  assert.equal(leap(game), 14, 'the invulnerability ends after 1.5 s');
  assert.equal(p.invulnerable, .55, 'the cooldown leaves the usual hit grace');
  assert.equal(breaths(game).length, 1);
  advance(game, 60);
  assert.equal(p.lastBreathCooldown, 0);
  assert.equal(leap(game), 14);
  assert.equal(p.invulnerable, 1.5, 'it triggers again after 60 s');
  assert.equal(breaths(game).length, 2);
});

test('«Последний вздох» waits for health below 25% and never saves a lethal hit', () => {
  const game = monk(), p = game.player;
  p.hp = Math.ceil(p.maxHp * .25) + 14;
  assert.equal(leap(game), 14);
  assert.ok(p.hp >= p.maxHp * .25);
  assert.equal(p.invulnerable, .55);
  assert.equal(breaths(game).length, 0);
  advance(game, .6);
  p.hp = 10;
  leap(game);
  assert.equal(game.phase, 'defeat');
  assert.equal(breaths(game).length, 0);
});

test('without the node a hit below 25% keeps the usual 0.55 s grace', () => {
  const game = monk({ lastBreath: false }), p = game.player;
  p.hp = 50;
  assert.equal(leap(game), 14);
  assert.equal(p.invulnerable, .55);
  assert.equal(p.lastBreathCooldown, 0);
  assert.equal(breaths(game).length, 0);
});
