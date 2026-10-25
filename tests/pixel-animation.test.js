import test from 'node:test';
import assert from 'node:assert/strict';
import { monkPose, houndPose, stableFacing, FACING_HYSTERESIS, MONK_RUN_KEY_DISTANCE, PresentationState } from '../src/pixel-animation.js';
import { createGame } from '../src/game.js';
import { MONK_RULES } from '../src/monk-combat.js';
import monkPackage from '../assets/game/pixel-v17/monk-side/manifest.json' with { type: 'json' };

const clips = monkPackage.monk.clips;

const monk = { dx: 0, dy: 1, moving: false, distance: 0, dashTime: 0, attack: null };

test('monk front/back and mirror directions agree with the isometric camera', () => {
  for (const [dx, dy, view, flip] of [[0, 1, 'front', false], [1, 0, 'front', true], [-1, 0, 'back', false], [0, -1, 'back', true]]) {
    assert.deepEqual(monkPose({ ...monk, dx, dy }), { frame: clips.idle[view][0], flip });
  }
});

test('run keyframes alternate both legs with distance and stop in a neutral pose', () => {
  const run = clips.run;
  const phases = [...run.sourceKeys, run.sourceCount];
  assert.deepEqual(phases.map(phase => monkPose({ ...monk, moving: true, distance: phase * .56 }).frame),
    [...run.front, run.front[0]]);
  assert.equal(monkPose({ ...monk, distance: 1.35 }).frame, clips.idle.front[0]);
});

test('the palm strike is visible at the actual damage instant, and dash wins over attack', () => {
  for (const [index, hitAt] of MONK_RULES.combo.hitTime.entries()) {
    const clip = clips[`attack${index + 1}`];
    assert.equal(clip.contactKey, clip.sourceKeys.indexOf(2));
    assert.equal(monkPose({ ...monk, attack: { index, age: hitAt - 1e-6 } }).frame, clip.front[clip.contactKey - 1]);
    assert.equal(monkPose({ ...monk, attack: { index, age: hitAt } }).frame, clip.front[clip.contactKey]);
  }
  assert.equal(monkPose({ ...monk, dashTime: .1, attack: { index: 0, age: .09 } }).frame,
    clips.dash.front[clips.dash.sourceKeys.indexOf(3)]);
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

test('the monk keeps .56u per source run key in every authored view', () => {
  assert.equal(MONK_RUN_KEY_DISTANCE, .56);
  assert.equal(monkPackage.monk.runCycleDistance, 3.36);
  const clip = clips.run;
  for (const [dx, dy, view] of [[0, 1, 'front'], [-1, 0, 'back'], [-1, 1, 'side']]) {
    const frames = clip[view];
    for (let key = 0; key < frames.length; key++) {
      const start = clip.sourceKeys[key] * MONK_RUN_KEY_DISTANCE;
      const end = (clip.sourceKeys[key + 1] ?? clip.sourceCount) * MONK_RUN_KEY_DISTANCE;
      for (const distance of [start, (start + end) / 2, end - 1e-6]) {
        assert.equal(monkPose({ ...monk, dx, dy, moving: true, distance }).frame, frames[key], `${view} key ${key} at ${distance}`);
      }
    }
    assert.equal(monkPose({ ...monk, dx, dy, moving: true, distance: 3.36 }).frame, frames[0]);
  }
});
