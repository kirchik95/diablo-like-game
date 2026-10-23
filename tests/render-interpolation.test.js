import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionHistory, SNAP_DISTANCE } from '../src/render-interpolation.js';

const STEP = 1 / 120;
const body = (x, y) => ({ x, y });
const fixture = () => ({ player: body(0, 0), enemies: [body(3, 4)], projectiles: [body(-1, 2)], locationRevision: 0, world: {} });
const near = (actual, expected, message, tolerance = 1e-12) => {
  assert.ok(Math.abs(actual.x - expected.x) <= tolerance && Math.abs(actual.y - expected.y) <= tolerance,
    `${message}: ${actual.x},${actual.y} instead of ${expected.x},${expected.y}`);
};

test('alpha 0, .5 and 1 draw the previous step, the midpoint and the current step exactly', () => {
  const game = fixture(), motion = new MotionHistory();
  motion.capture(game);
  game.player.x = .09; game.player.y = -.03;
  game.enemies[0].x = 3.02; game.projectiles[0].y = 2.05;
  motion.blend(game, 0);
  assert.deepEqual(motion.at(game.player), { x: 0, y: 0 });
  assert.deepEqual(motion.at(game.enemies[0]), { x: 3, y: 4 });
  assert.deepEqual(motion.at(game.projectiles[0]), { x: -1, y: 2 });
  motion.blend(game, .5);
  near(motion.at(game.player), { x: .045, y: -.015 }, 'monk midpoint');
  near(motion.at(game.enemies[0]), { x: 3.01, y: 4 }, 'enemy midpoint');
  near(motion.at(game.projectiles[0]), { x: -1, y: 2.025 }, 'shot midpoint');
  motion.blend(game, 1);
  assert.deepEqual(motion.at(game.player), { x: .09, y: -.03 });
  // Out-of-range blends clamp instead of extrapolating.
  motion.blend(game, 1.7); assert.deepEqual(motion.at(game.player), { x: .09, y: -.03 });
  motion.blend(game, -.2); assert.deepEqual(motion.at(game.player), { x: 0, y: 0 });
});

test('new bodies, jumps past the snap distance, restarts and area resets draw where the body is', () => {
  const game = fixture(), motion = new MotionHistory();
  // Nothing captured yet: the welcome screen draws the bodies themselves.
  assert.equal(motion.blend(game, .5).at(game.player), game.player);
  motion.capture(game);
  const spawned = body(8, 8); game.enemies.push(spawned);
  const shot = body(3, 4); game.projectiles.push(shot);
  assert.equal(motion.blend(game, .5).at(spawned), spawned, 'a spawn has no previous step');
  assert.equal(motion.at(shot), shot, 'a new projectile has no previous step');
  // A step longer than SNAP_DISTANCE is a teleport, not motion.
  game.player.x = SNAP_DISTANCE + .01;
  assert.equal(motion.at(game.player), game.player);
  game.player.x = SNAP_DISTANCE - .01;
  near(motion.at(game.player), { x: (SNAP_DISTANCE - .01) / 2, y: 0 }, 'a long dash step still blends');
  // Another run, area revision or world never inherits this history.
  const restart = fixture();
  assert.equal(motion.blend(restart, .5).at(restart.player), restart.player);
  game.locationRevision++;
  assert.equal(motion.blend(game, .5).at(game.player), game.player);
  game.locationRevision--; game.world = {};
  assert.equal(motion.blend(game, .5).at(game.player), game.player);
});

test('only the start of the latest step is kept, and removed bodies are forgotten', () => {
  const game = fixture(), motion = new MotionHistory();
  for (let i = 1; i <= 3; i++) { motion.capture(game); game.player.x = i * .05; }
  near(motion.blend(game, .5).at(game.player), { x: .125, y: 0 }, 'blend within the last step only');
  game.projectiles = []; game.enemies = [];
  motion.capture(game);
  assert.equal(motion.previous.size, 1, 'only the monk remains in the history');
});

test('a fixed-step loop with uneven frames draws linear motion exactly one step behind real time', () => {
  // Emulate main.js: capture before every step, then blend at accumulator / STEP.
  for (const [name, frame, jitter] of [['60 Hz', 1 / 60, .25], ['144 Hz', 1 / 144, .3], ['50 Hz', 1 / 50, 0]]) {
    const game = fixture(), motion = new MotionHistory(), speed = { x: 5.4 * Math.SQRT1_2, y: -1.75 };
    let accumulator = 0, time = 0, seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      const dt = frame * (1 + (random() * 2 - 1) * jitter);
      time += dt; accumulator += dt;
      while (accumulator >= STEP) {
        motion.capture(game);
        game.player.x += speed.x * STEP; game.player.y += speed.y * STEP;
        accumulator -= STEP;
      }
      if (time < STEP * 2) continue;
      const drawn = motion.blend(game, accumulator / STEP).at(game.player);
      worst = Math.max(worst, Math.hypot(drawn.x - speed.x * (time - STEP), drawn.y - speed.y * (time - STEP)));
    }
    assert.ok(worst < 1e-9, `${name}: drawn monk is ${worst}u off the one-step-late continuous path`);
  }
});

test('a held blend (pause, menu or hit stop) draws the same frame every time', () => {
  const game = fixture(), motion = new MotionHistory();
  motion.capture(game); game.player.x = .04; game.enemies[0].y = 4.01;
  const frames = Array.from({ length: 5 }, () => {
    motion.blend(game, .375);
    return [motion.at(game.player), motion.at(game.enemies[0])];
  });
  for (const frame of frames) assert.deepEqual(frame, frames[0]);
});
