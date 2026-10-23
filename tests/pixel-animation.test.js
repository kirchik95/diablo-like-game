import test from 'node:test';
import assert from 'node:assert/strict';
import { monkPose, houndPose, stableFacing, FACING_HYSTERESIS, MONK_RUN_KEY_DISTANCE, PresentationState } from '../src/pixel-animation.js';
import { createGame } from '../src/game.js';

const monk = { dx: 0, dy: 1, moving: false, distance: 0, dashTime: 0, attack: null };

test('monk front/back and mirror directions agree with the isometric camera', () => {
  for (const [dx, dy, frame, flip] of [[0, 1, 0, false], [1, 0, 0, true], [-1, 0, 50, false], [0, -1, 50, true]]) {
    assert.deepEqual(monkPose({ ...monk, dx, dy }), { frame, flip });
  }
});

test('run keyframes alternate both legs with distance and stop in a neutral pose', () => {
  assert.deepEqual([0, .56, 1.12, 1.68, 2.24, 2.8, 3.36].map(distance => monkPose({ ...monk, moving: true, distance }).frame), [4, 5, 6, 7, 8, 9, 4]);
  assert.equal(monkPose({ ...monk, distance: 1.35 }).frame, 0);
});

test('the palm strike is visible at the actual damage instant, and dash wins over attack', () => {
  for (const [index, hitAt, before, contact] of [[0, .09, 11, 12], [1, .11, 17, 18], [2, .16, 23, 24]]) {
    assert.equal(monkPose({ ...monk, attack: { index, age: hitAt - .01 } }).frame, before);
    assert.equal(monkPose({ ...monk, attack: { index, age: hitAt } }).frame, contact);
  }
  assert.equal(monkPose({ ...monk, dashTime: .1, attack: { index: 0, age: .09 } }).frame, 31);
});

test('hound warning, pounce, recovery and death each have a readable distinct pose', () => {
  const hound = { dx: 0, dy: 1, hp: 92, distance: 0 };
  for (const [state, timer, frame] of [['idle', 0, 0], ['windup', .55, 10], ['leap', .27, 12], ['recover', .7, 14], ['stunned', .38, 16]]) {
    assert.deepEqual(houndPose({ ...hound, state, timer }), { frame, flip: false });
  }
  assert.deepEqual(houndPose({ ...hound, hp: 0, dx: 1, dy: 0, state: 'dead' }), { frame: 20, flip: true });
});

// A world heading at a screen angle (degrees, counter-clockwise from screen right).
const screenHeading = degrees => {
  // Screen right is dy - dx and screen down is (dx + dy) / 2 in the 2:1 projection.
  const a = degrees * Math.PI / 180, right = Math.cos(a), down = -Math.sin(a);
  const dx = down - right / 2, dy = down + right / 2;
  return [dx / Math.hypot(dx, dy), dy / Math.hypot(dx, dy)];
};

test('facing hysteresis holds a drawing until the heading is clearly past a screen axis', () => {
  // Near screen-horizontal the side band is active as well; front/back is still tracked
  // for the clips that have no side drawing.
  const front = { back: false, flip: false, side: true }, back = { back: true, flip: false, side: true };
  assert.ok(Math.abs(FACING_HYSTERESIS - Math.sin(Math.PI / 12)) < 1e-12);
  // Pure screen-right lies on the front/back boundary: either drawing persists.
  assert.equal(stableFacing(front, ...screenHeading(0)), front);
  assert.equal(stableFacing(back, ...screenHeading(0)), back);
  for (const degrees of [-14, -5, 5, 14]) {
    assert.equal(stableFacing(front, ...screenHeading(degrees)), front, `front at ${degrees}`);
    assert.equal(stableFacing(back, ...screenHeading(degrees)), back, `back at ${degrees}`);
  }
  assert.deepEqual(stableFacing(front, ...screenHeading(16)), back);
  assert.deepEqual(stableFacing(back, ...screenHeading(-16)), front);
  // The mirror boundary is screen-vertical and has the same band.
  const up = { back: true, flip: false, side: false };
  assert.equal(stableFacing(up, ...screenHeading(100)), up);
  assert.deepEqual(stableFacing(up, ...screenHeading(106)), { back: true, flip: true, side: false });
  // Keyboard diagonals are 26.6 degrees off horizontal and always switch at once.
  assert.deepEqual(stableFacing(back, 0, 1), { back: false, flip: false, side: false });
  assert.deepEqual(stableFacing(null, 1, 0), { back: false, flip: true, side: false });
  assert.equal(stableFacing(back, 0, 0), back);
});

test('presentation keeps a horizontally chasing hound on one drawing; committed actions show their true quadrant', () => {
  const game = createGame(), hound = game.enemies[0], view = new PresentationState(game);
  hound.state = 'chase'; [hound.dx, hound.dy] = screenHeading(10);
  view.update(game, 1 / 60);
  const first = houndPose(hound, undefined, view.hounds[0]);
  for (let i = 0; i < 40; i++) {
    [hound.dx, hound.dy] = screenHeading(i % 2 ? -8 : 8);
    view.update(game, 1 / 60);
    assert.deepEqual(houndPose(hound, undefined, view.hounds[0]), first, `flicker at step ${i}`);
  }
  // The pose function never applies a facing computed for a different heading.
  assert.deepEqual(houndPose({ ...hound, dx: 0, dy: -1 }, undefined, view.hounds[0]), houndPose({ ...hound, dx: 0, dy: -1 }));
  // A windup locks its heading, so its drawing is the plain quadrant of that heading.
  Object.assign(hound, { state: 'windup', timer: .55 });
  view.update(game, 1 / 60);
  assert.deepEqual(houndPose(hound, undefined, view.hounds[0]), houndPose(hound));
  // Death keeps the drawing that was shown, not a recomputed one.
  Object.assign(hound, { state: 'chase' }); [hound.dx, hound.dy] = screenHeading(8); view.update(game, 1 / 60);
  const shown = houndPose(hound, undefined, view.hounds[0]).flip;
  hound.hp = 0; hound.state = 'dead'; view.update(game, 1 / 60);
  assert.equal(houndPose(hound, undefined, view.hounds[0]).flip, shown);
});

test('the monk shows the run cycle at .56u per key in both front and back drawings', () => {
  // .56u locks the planted foot for screen-left/right travel at 32 px/u (~17.75 px per key).
  assert.equal(MONK_RUN_KEY_DISTANCE, .56);
  for (const [dx, dy, facing] of [[0, 1, 'front'], [-1, 0, 'back']]) {
    const keys = [0, .55, .56, 2.79, 2.8, 3.36].map(distance => monkPose({ ...monk, dx, dy, moving: true, distance }).frame);
    const base = facing === 'front' ? 4 : 54;
    assert.deepEqual(keys, [base, base, base + 1, base + 4, base + 5, base]);
  }
});
