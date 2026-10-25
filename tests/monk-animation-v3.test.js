import test from 'node:test';
import assert from 'node:assert/strict';
import { monkPose, PresentationState } from '../src/pixel-animation.js';
import { MONK_RULES } from '../src/monk-combat.js';
import { createGame } from '../src/game.js';

const phases = [0, .5, 1, 2, 2.5, 3, 4, 5];
let next = 0;
const atlas = { animationVersion: 3, runCycleDistance: 3.36, clips: Object.fromEntries([
  ['idle', [0, .5, 1, 1.5, 2, 2.5, 3, 3.5], 4], ['run', [0, .5, 1, 2, 3, 3.5, 4, 5], 6],
  ...['attack1', 'attack2', 'attack3', 'dash', 'wave', 'death'].map(name => [name, phases, 6]),
  ['hurt', [0, .5, 1, 1.5, 2, 3], 4],
].map(([name, sourceKeys, sourceCount]) => [name, { sourceKeys, sourceCount,
  contactKey: name.startsWith('attack') ? sourceKeys.indexOf(2) : undefined,
  front: sourceKeys.map(() => next++), back: sourceKeys.map(() => next++), side: sourceKeys.map(() => next++),
}])) };
const player = { hp: 100, dx: 0, dy: 1, moving: false, distance: 0, dashTime: 0 };

test('inserted run frames subdivide the old distance windows without shifting key contacts', () => {
  const clip = atlas.clips.run;
  assert.deepEqual(clip.sourceKeys.map(phase => monkPose({ ...player, moving: true, distance: phase * .56 + 1e-6 }, atlas).frame), clip.front);
  assert.equal(monkPose({ ...player, moving: true, distance: 3.36 }, atlas).frame, clip.front[0]);
});

test('inserted strike frames subdivide the original windup/recovery boundaries', () => {
  for (let index = 0; index < 3; index++) {
    const clip = atlas.clips[`attack${index + 1}`], hit = MONK_RULES.combo.hitTime[index], end = MONK_RULES.combo.duration[index];
    const old = [0, hit / 2, hit, hit + (end - hit) * .25, hit + (end - hit) * .6, end - 1 / 60];
    const times = clip.sourceKeys.map(p => old[Math.floor(p)] + (old[Math.min(5, Math.floor(p) + 1)] - old[Math.floor(p)]) * (p % 1));
    assert.deepEqual(times.map(age => monkPose({ ...player, attack: { index, age } }, atlas).frame), clip.front);
    assert.equal(monkPose({ ...player, attack: { index, age: hit } }, atlas).frame, clip.front[clip.contactKey]);
  }
});

test('one-shot source phases retain the old key times and total duration', () => {
  for (const [name, duration, field] of [['wave', .5, 'waveAge'], ['hurt', .22, 'hurtAge'], ['death', .9, 'deathAge']]) {
    const clip = atlas.clips[name];
    assert.deepEqual(clip.sourceKeys.map(p => monkPose({ ...player, hp: name === 'death' ? 0 : 100 }, atlas,
      { [field]: p / clip.sourceCount * duration + 1e-7 }).frame), clip.front);
  }
});

test('stop, pause, resume and combat leave simulation unchanged and preserve visual phase', () => {
  const game = createGame(), state = new PresentationState(game);
  Object.assign(game.player, { moving: true, distance: .7, dx: -1, dy: 1 }); state.update(game, .1);
  game.player.moving = false; state.update(game, 0); state.update(game, .08);
  const frame = monkPose(game.player, atlas, state.player).frame;
  const frozen = structuredClone(game), before = JSON.stringify(state.player);
  state.update(game, 10, 'paused'); assert.equal(JSON.stringify(state.player), before); assert.deepEqual(game, frozen);
  Object.assign(game.player, { moving: true, distance: .71 }); state.update(game, .01);
  assert.equal(monkPose(game.player, atlas, state.player).frame, frame);
  game.player.attack = { index: 0, age: 0 }; state.update(game, 0); assert.equal(state.player.runSettle, null);
});

test('stop/resume returns visual phase to the actual next footfall distance', () => {
  const game = createGame(), state = new PresentationState(game), clip = atlas.clips.run;
  Object.assign(game.player, { moving: true, distance: .7, dx: 0, dy: 1 }); state.update(game, .1);
  game.player.moving = false; state.update(game, .16);
  Object.assign(game.player, { moving: true, distance: .71 }); state.update(game, .01);
  game.player.distance = 1.68; state.update(game, .18);
  assert.equal(monkPose(game.player, atlas, state.player).frame, clip.front[clip.sourceKeys.indexOf(3)]);
  assert.equal(state.player.runPosition, game.player.distance);
  game.player.distance = 3.36; state.update(game, .31);
  assert.equal(monkPose(game.player, atlas, state.player).frame, clip.front[0]);
});
