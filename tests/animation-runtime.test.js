import test from 'node:test';
import assert from 'node:assert/strict';
import * as animation from '../src/pixel-animation.js';
import { createGame, startAttack, startDash, startWave, updateGame } from '../src/game.js';
import { MONK_RULES } from '../src/monk-combat.js';

// Deliberately noncontiguous absolute indices catch fixed-offset atlas selection.
const actorAtlas = {
  clips: {
    idle: { front: [8, 2, 17, 4], back: [71, 65, 80, 67] },
    run: { front: [11, 3, 21, 14, 7, 19], back: [74, 66, 84, 77, 70, 82] },
    attack1: { front: [23, 9, 35, 6, 13, 26], back: [86, 72, 98, 69, 76, 89] },
    attack2: { front: [1, 16, 24, 10, 29, 12], back: [64, 79, 87, 73, 92, 75] },
    attack3: { front: [15, 28, 31, 25, 30, 22], back: [78, 91, 94, 88, 93, 85] },
    attack: { front: [23, 9, 35, 6, 13, 26], back: [86, 72, 98, 69, 76, 89] },
    dash: { front: [18, 33, 5, 20, 32, 27], back: [81, 96, 68, 83, 95, 90] },
    wave: { front: [36, 38, 40, 42, 44, 46], back: [99, 101, 103, 105, 107, 109] },
    hurt: { front: [37, 39, 41, 43], back: [100, 102, 104, 106] },
    death: { front: [45, 47, 49, 51, 53, 55], back: [108, 110, 112, 114, 116, 118] },
  },
};
const worldAtlas = { clips: {
  'brazier-cyan': { front: [13, 2, 7, 16, 9, 4] },
  'brazier-magenta': { front: [12, 8, 3, 0, 21, 5] },
  shrine: { front: [23, 1, 14, 19, 6, 11] },
  gate: { front: [10, 18, 15, 22, 20, 17] },
} };
const input = { moveX: 0, moveY: 0, aimX: 0, aimY: 1, attack: false };
const player = { hp: 100, dx: 0, dy: 1, moving: false, distance: 0, dashTime: 0, attack: null };
const enemy = { hp: 92, dx: 0, dy: 1, state: 'idle', timer: 0, distance: 0 };
const pose = (body, visual) => animation.monkPose(body, actorAtlas, visual);
const hound = (body, visual) => animation.houndPose(body, actorAtlas, visual);
function presentation(game) {
  assert.equal(typeof animation.PresentationState, 'function', 'presentation state must outlive stopped simulation');
  return new animation.PresentationState(game);
}

test('v2: each palm uses its six authored keys, with contact at the simulation boundary', () => {
  const times = [[.02, .05, .09, .13, .18, .215], [.02, .06, .11, .15, .195, .235], [.02, .09, .16, .21, .26, .305]];
  for (let index = 0; index < 3; index++) {
    assert.deepEqual(times[index].map(age => pose({ ...player, attack: { index, age } }).frame),
      actorAtlas.clips[`attack${index + 1}`].front);
    const contact = MONK_RULES.combo.hitTime[index];
    assert.equal(pose({ ...player, attack: { index, age: contact - .000001 } }).frame,
      actorAtlas.clips[`attack${index + 1}`].front[1]);
    assert.equal(pose({ ...player, attack: { index, age: contact } }).frame,
      actorAtlas.clips[`attack${index + 1}`].front[2]);
  }
});

test('v2: six-key locomotion follows traveled distance rather than elapsed time', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(key => key * animation.MONK_RUN_KEY_DISTANCE).map(distance =>
    pose({ ...player, moving: true, distance }, { idleAge: 100 }).frame), [11, 3, 21, 14, 7, 19, 11]);
  assert.deepEqual([0, .2, .4, .6, .8, 1, 1.2].map(distance =>
    hound({ ...enemy, state: 'chase', distance }).frame), [11, 3, 21, 14, 7, 19, 11]);
  assert.equal(pose({ ...player, distance: 1.4 }, { idleAge: 0 }).frame, 8);
});

test('v2: both species use authored back clips and independent horizontal mirrors', () => {
  for (const [dx, dy, frame, flip] of [[0, 1, 8, false], [1, 0, 8, true], [-1, 0, 71, false], [0, -1, 71, true]]) {
    assert.deepEqual(pose({ ...player, dx, dy }), { frame, flip });
    assert.deepEqual(hound({ ...enemy, dx, dy }), { frame, flip });
  }
  assert.deepEqual(pose({ ...player, dx: -1, dy: 0, attack: { index: 1, age: .11 } }), { frame: 87, flip: false });
});

test('v2: all six dash drawings play within 200 ms; death and dash beat hurt or a pending palm', () => {
  assert.deepEqual([.2, .16, .12, .08, .04, .001].map(dashTime => pose({ ...player, dashTime }).frame),
    [18, 33, 5, 20, 32, 27]);
  assert.equal(pose({ ...player, dashTime: .12, attack: { index: 1, age: .11 } }, { hurtAge: .1 }).frame, 5);
  assert.equal(pose({ ...player, hp: 0, dashTime: .12 }, { deathAge: .9 }).frame, 55);
});

test('v2: hound anticipation, actual contact and recovery select distinct attack keys', () => {
  const states = [
    { state: 'windup', timer: .55 }, { state: 'windup', timer: .1 },
    { state: 'leap', timer: .26, hit: false }, { state: 'leap', timer: .26, hit: true },
    { state: 'recover', timer: .7 }, { state: 'recover', timer: .05 },
  ];
  assert.deepEqual(states.map(state => hound({ ...enemy, ...state }).frame), [23, 9, 35, 6, 13, 26]);
  assert.deepEqual([.38, .28, .18, .01].map(timer => hound({ ...enemy, state: 'stunned', timer }).frame), [37, 39, 41, 43]);
});

test('v2: death finishes after simulation stops, holds once, and locks the last facing', () => {
  const game = createGame(), view = presentation(game);
  Object.assign(game.player, { hp: 0, dx: -1, dy: 0 });
  Object.assign(game.enemies[0], { hp: 0, state: 'dead', dx: 0, dy: 1 });
  game.phase = 'defeat';
  view.update(game, 0, 'playing');
  const frozen = structuredClone(game);
  assert.equal(pose(game.player, view.player).frame, 108);
  assert.equal(hound(game.enemies[0], view.hounds[0]).frame, 45);
  view.update(game, .4, 'defeat');
  assert.notEqual(pose(game.player, view.player).frame, 108);
  view.update(game, 2, 'defeat');
  assert.equal(pose(game.player, view.player).frame, 118);
  assert.equal(hound(game.enemies[0], view.hounds[0]).frame, 55);
  view.update(game, 20, 'defeat');
  assert.equal(pose(game.player, view.player).frame, 118);
  assert.deepEqual(game, frozen, 'presentation must never advance simulation or mutate game state');
  game.player.dx = 1;
  assert.deepEqual(pose(game.player, view.player), { frame: 118, flip: false });
});

test('v2: pause freezes the full presentation, including death, effects and scenery', () => {
  const game = createGame(), view = presentation(game);
  game.player.hp = 0; game.phase = 'defeat'; game.shrineUsed = true;
  game.enemies[0].hp = 0; game.kills = 1;
  game.events.push({ type: 'heal', x: 0, y: 0 });
  view.update(game, 0, 'playing'); view.update(game, .1, 'defeat');
  const before = JSON.stringify(view);
  view.update(game, 10, 'paused');
  assert.equal(JSON.stringify(view), before);
  view.update(game, .1, 'defeat');
  assert.ok(view.time > .1);
});

test('v2: replayed event objects do not retrigger; a new game resets deaths, one-shots and effects', () => {
  const game = createGame(), view = presentation(game);
  game.shrineUsed = true; game.kills = 1; game.enemies[0].hp = 0;
  game.events.push({ type: 'heal', x: 1, y: 2 });
  view.update(game, 0); view.update(game, .3);
  assert.equal(view.effects.length, 1);
  assert.ok(view.effects[0].age >= .3);
  view.update(game, 2);
  assert.equal(view.effects.length, 0);
  assert.equal(animation.worldPose('shrine', worldAtlas, view).frame, 11);
  assert.equal(animation.worldPose('gate', worldAtlas, view).frame, 17);
  const fresh = createGame();
  view.update(fresh, 0);
  assert.equal(view.player.deathAge, null);
  assert.equal(view.hounds[0].deathAge, null);
  assert.equal(view.effects.length, 0);
  assert.equal(view.time, 0);
  assert.equal(animation.worldPose('shrine', worldAtlas, view).frame, 23);
  assert.equal(animation.worldPose('gate', worldAtlas, view).frame, 10);
});

test('v2: shrine and gate start on the event edge, show all keys, then hold endpoints', () => {
  const game = createGame(), view = presentation(game);
  view.update(game, 4);
  game.shrineUsed = true; game.kills = game.enemies.length;
  view.update(game, 0);
  const shrine = [], gate = [];
  for (let i = 0; i <= 100; i++) {
    shrine.push(animation.worldPose('shrine', worldAtlas, view).frame);
    gate.push(animation.worldPose('gate', worldAtlas, view).frame);
    view.update(game, .01);
  }
  assert.deepEqual([...new Set(shrine)], [23, 1, 14, 19, 6, 11]);
  assert.deepEqual([...new Set(gate)], [10, 18, 15, 22, 20, 17]);
  view.update(game, 10);
  assert.equal(animation.worldPose('shrine', worldAtlas, view).frame, 11);
  assert.equal(animation.worldPose('gate', worldAtlas, view).frame, 17);
});

test('v2: braziers cycle all authored keys at independent cyan and magenta rates', () => {
  assert.equal(typeof animation.worldPose, 'function');
  assert.deepEqual([0, .1, .2, .3, .4, .5, .6].map(time => animation.worldPose('brazier-cyan', worldAtlas, { time }).frame),
    [13, 2, 7, 16, 9, 4, 13]);
  assert.deepEqual([0, .12, .24, .36, .48, .6, .72].map(time => animation.worldPose('brazier-magenta', worldAtlas, { time }).frame),
    [12, 8, 3, 0, 21, 5, 12]);
});

test('v2: wave appears immediately without delaying damage; movement and dash cancel its gesture', () => {
  const game = createGame(), view = presentation(game);
  Object.assign(game.player, { x: 0, y: 0, dx: 0, dy: 1 });
  Object.assign(game.enemies[0], { x: 0, y: 1 });
  const hp = game.enemies[0].hp;
  startWave(game); view.update(game, 0);
  assert.equal(game.enemies[0].hp, Math.max(0, hp - MONK_RULES.wave.damage));
  assert.equal(pose(game.player, view.player).frame, 36);
  assert.ok(view.effects.some(effect => effect.type === 'wave' && effect.age === 0));
  updateGame(game, { ...input, moveX: 1 }, .05); view.update(game, .05);
  assert.ok(actorAtlas.clips.run.front.includes(pose(game.player, view.player).frame));
  startDash(game, 1, 0); view.update(game, 0);
  assert.equal(pose(game.player, view.player).frame, 18);
  assert.equal(view.player.waveAge, null);
});

test('v2: stale hit tint expires after defeat and hurt never delays control', () => {
  const game = createGame(), view = presentation(game);
  game.player.hitFlash = .22;
  game.events.push({ type: 'hurt', x: 0, y: 0 }); view.update(game, 0);
  assert.equal(pose({ ...game.player, dx: 0, dy: 1 }, view.player).frame, 37);
  game.phase = 'defeat'; game.player.hp = 0;
  view.update(game, 0); view.update(game, 1, 'defeat');
  assert.equal(view.player.flash, 0);
  const fresh = createGame(); view.update(fresh, 0);
  fresh.events.push({ type: 'hurt', x: 0, y: 0 }); view.update(fresh, 0);
  startAttack(fresh, 0, 1); view.update(fresh, 0);
  assert.equal(pose(fresh.player, view.player).frame, 23);
});

test('v2: authored impact, warning and healing FX expose six keys and expire at their endpoint', () => {
  assert.equal(typeof animation.effectPose, 'function');
  const atlas = { clips: {
    impact: { front: [11, 8, 4, 13, 5, 6] },
    warning: { front: [2, 10, 3, 17, 15, 7] },
    healing: { front: [16, 0, 12, 9, 1, 14] },
  } };
  for (const [name, duration] of [['impact', .3], ['warning', .55], ['healing', .5]]) {
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(key =>
      animation.effectPose(name, atlas, duration * (key + .1) / 6).frame), atlas.clips[name].front);
    assert.equal(animation.effectPose(name, atlas, duration), null);
  }
});
