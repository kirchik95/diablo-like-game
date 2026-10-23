import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, updateGame } from '../src/game.js';
import { BEETLE_STATS } from '../src/campaign.js';

function leashedPack(kind) {
  const game = createGame(), tiles = [];
  for (let x = -12; x <= 12; x++) for (let y = -12; y <= 12; y++) tiles.push({ x, y });
  game.world = { tiles, obstacles: [], shrine: null, safeArea: { minY: 8, maxY: 12 } };
  game.projectiles = [];
  // The monk rests in the safe camp, so the active pack walks home facing away from it.
  Object.assign(game.player, { x: 0, y: 10 });
  game.enemies = [{ ...game.enemies[0], id: kind, kind, radius: kind === 'beetle' ? BEETLE_STATS.radius : .29,
    packId: 'p', active: true, state: 'chase', x: 0, y: 0, homeX: 0, homeY: -4, dx: 0, dy: 1, path: [] }];
  return game;
}

test('a returning beetle turns home at its usual rate, never in one frame', () => {
  const game = leashedPack('beetle'), e = game.enemies[0];
  let previous = Math.atan2(e.dy, e.dx), turned = 0;
  // Half a turn at 2.5 rad/s takes 1.26 s; home is 1.8 s away at the pack's return speed.
  for (let tick = 0; tick < 150; tick++) {
    updateGame(game, {}, .01);
    const heading = Math.atan2(e.dy, e.dx);
    const step = Math.abs(Math.atan2(Math.sin(heading - previous), Math.cos(heading - previous)));
    assert.ok(step <= BEETLE_STATS.turnRate * .01 + 1e-9, `tick ${tick}: turned ${step} rad`);
    turned += step; previous = heading;
  }
  assert.equal(e.returning, true);
  assert.ok(Math.abs(turned - Math.PI) < 1e-6, `faces home after a gradual half turn (${turned})`);
  assert.ok(Math.abs(e.dx) < 1e-6 && e.dy < -.999999);
});

test('other returning monsters still face home at once', () => {
  const game = leashedPack('hound'), e = game.enemies[0];
  updateGame(game, {}, .01);
  assert.equal(e.returning, true);
  assert.ok(Math.abs(e.dx) < 1e-9 && Math.abs(e.dy + 1) < 1e-9);
});

// Matches PACK_RULES.returnSpeed in src/game.js.
const RETURN_SPEED = 2.2;

for (const dt of [.01, .05]) test(`a returning beetle shuffles while it turns and never walks backwards fast at dt=${dt}`, () => {
  const game = leashedPack('beetle'), e = game.enemies[0];
  let backwards = 0, ticks = 0;
  while (e.state !== 'idle') {
    assert.ok(++ticks < 12 / dt, 'never reached home');
    const before = { x: e.x, y: e.y };
    const home = Math.hypot(e.homeX - e.x, e.homeY - e.y);
    updateGame(game, {}, dt);
    if (e.state === 'idle') break;
    // Speed follows the facing after this tick's turn, as in chase, with the same floor.
    const alignment = ((e.homeX - before.x) * e.dx + (e.homeY - before.y) * e.dy) / home;
    const step = Math.hypot(e.x - before.x, e.y - before.y);
    assert.ok(step <= RETURN_SPEED * Math.max(BEETLE_STATS.minTurnSpeed, alignment) * dt + 1e-9,
      `tick ${ticks}: ${step / dt} u/s at alignment ${alignment}`);
    if ((e.x - before.x) * e.dx + (e.y - before.y) * e.dy < 0) backwards += step;
  }
  // The old full-speed return slid backwards for about 1.4u; the floor caps it near 0.4u.
  assert.ok(backwards < .45, `slid backwards ${backwards}u`);
  assert.ok(Math.hypot(e.x - e.homeX, e.y - e.homeY) < 1e-6);
});

test('a returning beetle that already faces home walks at the full return speed', () => {
  const game = leashedPack('beetle'), e = game.enemies[0];
  Object.assign(e, { dx: 0, dy: -1 });
  updateGame(game, {}, .01);
  assert.ok(Math.abs(e.y + RETURN_SPEED * .01) < 1e-9, `moved to ${e.y}`);
  const hound = leashedPack('hound');
  updateGame(hound, {}, .01);
  assert.ok(Math.abs(hound.enemies[0].y + RETURN_SPEED * .01) < 1e-9, 'other monsters keep the full return speed');
});
