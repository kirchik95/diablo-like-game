import test from 'node:test';
import assert from 'node:assert/strict';
import { monkPose, houndPose, stableFacing, SIDE_BAND, FACING_HYSTERESIS, MONK_RUN_KEY_DISTANCE, PresentationState } from '../src/pixel-animation.js';
import { createAdventure, createGame, updateGame } from '../src/game.js';
import { MONK_RULES } from '../src/monk-combat.js';
import sidePackage from '../assets/game/pixel-v10/monk-side/manifest.json' with { type: 'json' };
import v2Package from '../assets/game/pixel-v2/monk/manifest.json' with { type: 'json' };
import houndPackage from '../assets/game/pixel-v2/hound-world/manifest.json' with { type: 'json' };

const atlas = sidePackage.monk, clips = atlas.clips;
const degrees = value => value * Math.PI / 180;
// A world heading at a screen angle (degrees, counter-clockwise from screen right).
const screenHeading = angle => {
  // Screen right is dy - dx and screen down is (dx + dy) / 2 in the 2:1 projection.
  const right = Math.cos(degrees(angle)), down = -Math.sin(degrees(angle));
  const dx = down - right / 2, dy = down + right / 2;
  return [dx / Math.hypot(dx, dy), dy / Math.hypot(dx, dy)];
};
const monk = { hp: 100, dx: 0, dy: 1, moving: false, distance: 0, dashTime: 0, attack: null };
const at = (angle, extra = {}) => { const [dx, dy] = screenHeading(angle); return { ...monk, dx, dy, ...extra }; };
const sideFrames = new Set([...clips.idle.side, ...clips.run.side]);

test('the side band is 20 degrees wide, entered inside 15 and left beyond 25 degrees', () => {
  assert.ok(Math.abs(SIDE_BAND.nominal - Math.sin(degrees(20))) < 1e-12);
  assert.ok(Math.abs(SIDE_BAND.enter - Math.sin(degrees(15))) < 1e-12);
  assert.ok(Math.abs(SIDE_BAND.leave - Math.sin(degrees(25))) < 1e-12);
  // Keyboard diagonals (world axes) sit at atan(1/2) = 26.57 degrees: outside even the exit.
  assert.ok(Math.atan(.5) > degrees(25) + degrees(1.5));
  assert.equal(FACING_HYSTERESIS, Math.sin(degrees(15)));
});

test('screen-left/right idle and run show the side keys, mirrored for the left', () => {
  for (const angle of [0, 12, -19, 180, 168, -161]) {
    const flip = Math.cos(degrees(angle)) < 0;
    for (let key = 0; key < 4; key++) {
      assert.deepEqual(monkPose(at(angle), atlas, { idleAge: key * .2 }), { frame: clips.idle.side[key], flip }, `idle ${angle}`);
    }
    const run = [0, 1, 2, 3, 4, 5, 6].map(k => monkPose(at(angle, { moving: true, distance: k * MONK_RUN_KEY_DISTANCE }), atlas));
    assert.deepEqual(run.map(pose => pose.frame), [...clips.run.side, clips.run.side[0]], `run ${angle}`);
    assert.ok(run.every(pose => pose.flip === flip));
  }
});

test('keyboard diagonals and vertical headings keep the authored front/back drawings', () => {
  for (const [dx, dy, facing, flip] of [[0, 1, 'front', false], [1, 0, 'front', true], [-1, 0, 'back', false], [0, -1, 'back', true]]) {
    assert.deepEqual(monkPose({ ...monk, dx, dy }, atlas), { frame: clips.idle[facing][0], flip });
    assert.deepEqual(monkPose({ ...monk, dx, dy, moving: true, distance: .56 }, atlas), { frame: clips.run[facing][1], flip });
  }
  for (const angle of [90, -90, 30, 150, -30, -150]) {
    assert.ok(!sideFrames.has(monkPose(at(angle), atlas).frame), `no side drawing at ${angle}`);
  }
});

test('only idle and run have side drawings; combat, dash, wave, hurt and death keep four directions', () => {
  assert.deepEqual(Object.entries(clips).filter(([, facings]) => facings.side).map(([name]) => name), ['idle', 'run']);
  const right = at(0);
  for (let index = 0; index < 3; index++) {
    const pose = monkPose({ ...right, attack: { index, age: MONK_RULES.combo.hitTime[index] } }, atlas);
    assert.ok(clips[`attack${index + 1}`].front.concat(clips[`attack${index + 1}`].back).includes(pose.frame));
  }
  const others = [
    monkPose({ ...right, dashTime: .1 }, atlas),
    monkPose(right, atlas, { waveAge: .1 }),
    monkPose(right, atlas, { hurtAge: .1 }),
    monkPose({ ...right, hp: 0 }, atlas, { deathAge: .5 }),
  ];
  for (const pose of others) assert.ok(pose.frame < 100 && !sideFrames.has(pose.frame), JSON.stringify(pose));
});

test('the side band holds against the cursor near its edge and does not flicker', () => {
  const plain = { back: false, flip: false, side: false }, side = { back: false, flip: false, side: true };
  // Front/back keeps its own 15 degree band; only the side flag is checked here.
  for (const [previous, angle, expected] of [[plain, 14, true], [plain, -14, true], [plain, 16, false], [plain, -16, false],
    [side, 24, true], [side, -24, true], [side, 26, false], [side, -26, false]]) {
    assert.equal(stableFacing(previous, ...screenHeading(angle)).side, expected, `${previous.side} at ${angle}`);
  }
  assert.equal(stableFacing(plain, ...screenHeading(-16)), plain);
  // Mirror flips never happen inside the band.
  for (const angle of [-24, -10, 0, 10, 24]) assert.equal(stableFacing(side, ...screenHeading(angle)).flip, false);
  const game = createGame(), view = new PresentationState(game);
  for (const [start, wobble] of [[0, [18, 22, -22, 18]], [40, [22, 18, 16, 24]]]) {
    [game.player.dx, game.player.dy] = screenHeading(start);
    view.update(game, 1 / 60);
    const first = monkPose(game.player, atlas, view.player);
    for (let i = 0; i < 24; i++) {
      [game.player.dx, game.player.dy] = screenHeading(wobble[i % wobble.length]);
      view.update(game, 1 / 60);
      assert.equal(sideFrames.has(monkPose(game.player, atlas, view.player).frame), sideFrames.has(first.frame), `flicker ${start}/${i}`);
    }
  }
});

test('running straight right in the game plays the side run; a diagonal returns to SE/NE at once', () => {
  // The real adventure on open ground: movement, facing and presentation, no scenery.
  const game = createAdventure(), tiles = [];
  for (let x = -10; x <= 10; x++) for (let y = -10; y <= 10; y++) tiles.push({ x, y });
  game.world = { ...game.world, tiles, obstacles: [] };
  Object.assign(game.player, { x: 0, y: 0 });
  const view = new PresentationState(game);
  // World (-1, 1) is pure screen-right: dy - dx > 0 and dx + dy = 0.
  const input = { moveX: -1, moveY: 1, aimX: 0, aimY: 0, attack: false };
  const keys = [];
  for (let tick = 0; tick < 30; tick++) {
    updateGame(game, input, 1 / 60);
    view.update(game, 1 / 60);
    keys.push(monkPose(game.player, atlas, view.player));
  }
  assert.ok(keys.every(pose => clips.run.side.includes(pose.frame) && !pose.flip), JSON.stringify(keys.slice(-3)));
  updateGame(game, { ...input, moveX: -1, moveY: 0 }, 1 / 60);   // world -x: the NE diagonal
  view.update(game, 1 / 60);
  assert.ok(clips.run.back.includes(monkPose(game.player, atlas, view.player).frame));
});

test('atlases without side keys (the v2 monk, monsters) keep their exact previous poses', () => {
  for (const angle of [0, 180, 10, -12]) {
    const [dx, dy] = screenHeading(angle), facing = dx + dy < 0 ? 'back' : 'front', flip = dy - dx < 0;
    // Two keys of travel: the v2 renderer geometry never receives a side index.
    assert.deepEqual(monkPose(at(angle, { moving: true, distance: 1.2 }), v2Package.monk),
      { frame: v2Package.monk.clips.run[facing][2], flip });
    assert.deepEqual(houndPose({ hp: 92, state: 'chase', distance: 0, dx, dy }, houndPackage.hound),
      { frame: houndPackage.hound.clips.run[facing][0], flip });
  }
});

test('the renderer atlas from pixel-assets.js is the 110-key side package', async () => {
  const { pixelAtlases } = await import('../src/pixel-assets.js');
  assert.deepEqual(pixelAtlases.monk.clips, clips);
  assert.equal(pixelAtlases.monk.rows, atlas.rows);
  // render.js passes { ...pixelAtlases.monk, texture }: a horizontal run reaches the side keys.
  const frame = monkPose(at(0, { moving: true, distance: 0 }), pixelAtlases.monk).frame;
  assert.equal(frame, clips.run.side[0]);
  assert.ok(frame < pixelAtlases.monk.columns * pixelAtlases.monk.rows);
});
