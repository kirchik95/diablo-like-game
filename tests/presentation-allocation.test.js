import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionHistory } from '../src/render-interpolation.js';
import { PresentationState, stableFacing, clipPose, monkPose } from '../src/pixel-animation.js';
import { obscuresSprite } from '../src/pixel-picking.js';
import { LightPack } from '../src/scene-light.js';
import { lootLightState, lootDropPose } from '../src/loot-glow.js';
import { writeCampNpcUvs } from '../src/camp-npcs.js';

function gameFixture() {
  return { player: { x: 0, y: 0, dx: 1, dy: 0, hp: 100, moving: false, distance: 0, dashTime: 0, hitFlash: 0 },
    enemies: [], projectiles: [], monkShots: [], events: [], world: {}, locationRevision: 0, shrineUsed: false };
}

test('interpolation retains one output per body without aliasing another body or changing snap identity', () => {
  const game = gameFixture(), enemy = { x: 2, y: 4 }; game.enemies.push(enemy);
  const motion = new MotionHistory(); motion.capture(game);
  game.player.x = .5; enemy.y = 4.5; motion.blend(game, .5);
  const a = motion.at(game.player), b = motion.at(enemy);
  assert.notEqual(a, b); assert.deepEqual(a, { x: .25, y: 0 }); assert.deepEqual(b, { x: 2, y: 4.25 });
  assert.equal(motion.at(game.player), a, 'steady render queries reuse the body output');
  motion.blend(game, 1); assert.equal(motion.at(game.player), a); assert.deepEqual(a, { x: .5, y: 0 });
  assert.deepEqual(b, { x: 2, y: 4.25 }, 'another body query cannot overwrite this result');
  game.player.x = 5; assert.equal(motion.at(game.player), game.player);
  assert.equal(motion.at({ x: 8, y: 9 }).x, 8);
});

test('steady presentation updates retain their effect list and expire entries in original order', () => {
  const game = gameFixture(), state = new PresentationState(game), list = state.effects;
  const first = { type: 'impact', x: 1, y: 2 }, second = { type: 'damage', amount: 9, x: 2, y: 3 };
  game.events.push(first, second); state.update(game, 0);
  const held = state.effects[1]; assert.equal(state.effects.length, 2);
  state.update(game, .31);
  assert.equal(state.effects, list, 'aging does not allocate a replacement list');
  assert.deepEqual(state.effects.map(e => e.type), ['damage']); assert.equal(state.effects[0], held);
  state.update(game, 1); assert.equal(state.effects.length, 0);
  state.update(game, 0); assert.equal(state.effects.length, 0, 'the same event cannot restart after its effect expired');
});

test('repeated facing queries reuse read-only values while boundary changes preserve older headings', () => {
  const a = stableFacing(null, 1, 0), b = stableFacing(null, 1, 0);
  assert.deepEqual(a, { back: false, flip: true, side: false });
  assert.equal(a, b, 'a finite facing variant is shared rather than allocated per actor');
  const next = stableFacing(a, -1, 0);
  assert.deepEqual(next, { back: true, flip: false, side: false });
  assert.deepEqual(a, { back: false, flip: true, side: false });
  assert.throws(() => { a.back = true; }, TypeError, 'shared variants cannot corrupt the next actor');
});

test('warmed opaque picking avoids transient array iterators for ordinary and mirrored bounds', () => {
  const mask = { width: 6, bytes: new Uint8Array(5).fill(255) }, atlas = { cell: 6, columns: 1, anchor: [3, 6], mask };
  const front = { atlas, frame: 0, flip: false, mesh: { scaling: { x: 1, y: 1 } } };
  const back = { ...front, flip: true }, origin = { x: 0, y: 0 };
  assert.equal(obscuresSprite(front, origin, back, origin), true);
  const iterate = Array.prototype[Symbol.iterator]; let calls = 0, value;
  Array.prototype[Symbol.iterator] = function () { calls++; return iterate.call(this); };
  try { value = obscuresSprite(front, origin, back, origin); }
  finally { Array.prototype[Symbol.iterator] = iterate; }
  assert.equal(value, true); assert.equal(calls, 0, 'hot bounds do not destructure temporary arrays');
  front.mesh.scaling.x = -1; assert.equal(obscuresSprite(front, origin, back, origin), true);
});

test('moving light selection retains its buffers and restores authored order at equal distance', () => {
  const a = { x: -1, y: 0, ink: 'amber', seed: 0 }, b = { x: 1, y: 0, ink: 'cyan', seed: 1 };
  const pack = new LightPack([a, b]); pack.update(0, 0, 0, true);
  const chosen = pack.chosen, pos = pack.pos;
  pack.update(4, 0, 0, true); assert.equal(pack.chosen[0], b);
  assert.equal(pack.chosen, chosen, 'a changed view reuses the chosen list'); assert.equal(pack.pos, pos);
  pack.update(0, 0, 0, true); assert.deepEqual(pack.chosen, [a, b], 'ties use authored order, not the previous sorted order');
});

test('loot steady states reuse finite values without overwriting a previously returned phase', () => {
  const a = lootLightState('rare', .1), b = lootLightState('rare', 2.1), snapshot = { ...a };
  assert.equal(a, b); lootLightState('rare', 1.1); assert.deepEqual(a, snapshot);
  assert.equal(lootDropPose(.6), lootDropPose(1), 'settled drops reuse their zero pose');
  assert.deepEqual(lootDropPose(.16), { height: .8, shift: -3, flash: 0 });
});

test('NPC UV updates reuse double-precision source storage and preserve TypedArray bounds checks', () => {
  const atlas = { columns: 3, rows: 7 }, uvs = new Float64Array(16), set = uvs.set;
  const sources = [];
  uvs.set = function (source, offset) { sources.push(source); return set.call(this, source, offset); };
  writeCampNpcUvs(uvs, 0, atlas, 5, false); const first = uvs.slice(0, 8);
  writeCampNpcUvs(uvs, 1, atlas, 5, true);
  assert.equal(sources[0], sources[1], 'updating each NPC does not allocate an eight-number literal');
  assert.equal(first[0], uvs[10]); assert.equal(first[2], uvs[8]); assert.equal(first[1], uvs[9]);
  const before = uvs.slice(); assert.throws(() => writeCampNpcUvs(uvs, 2, atlas, 5), RangeError);
  assert.deepEqual(Array.from(uvs), Array.from(before), 'a failed write changes no earlier quad');
});


test('finite animation poses are reused without changing an older frame or its weapon overlay', () => {
  const atlas = { clips: { idle: { front: [0, 1], back: [2, 3] } } };
  const a = clipPose(atlas, 'idle', 0);
  assert.equal(clipPose(atlas, 'idle', 0), a);
  const b = clipPose(atlas, 'idle', 1, { flip: true });
  assert.deepEqual(a, { frame: 0, flip: false }); assert.deepEqual(b, { frame: 1, flip: true });
  const player = { hp: 100, dx: 1, dy: 0, moving: false, dashTime: 0, distance: 0 };
  const first = monkPose(player, atlas);
  assert.equal(monkPose(player, atlas), first);
  const weapons = { knuckles: { clips: { knuckleStrike1: { front: [{ frame: 5, overlay: 2 }], back: [{ frame: 6, overlay: 3 }] } } } };
  player.attack = { index: 0, age: 0, weapon: 'knuckles' };
  const strike = monkPose(player, atlas, {}, weapons);
  assert.equal(monkPose(player, atlas, {}, weapons), strike);
  assert.deepEqual(strike, { frame: 5, flip: true, weapon: { layer: 'knuckles', cell: 2, flip: true } });
  assert.deepEqual(first, { frame: 0, flip: true });
});

test('editing a weapon clip invalidates its cached pose without changing the prior value', () => {
  const atlas = { clips: { idle: { front: [0], back: [0] } } };
  const step = { frame: 5, overlay: 2 };
  const weapons = { knuckles: { clips: { knuckleStrike1: { front: [step], back: [step] } } } };
  const player = { hp: 100, dx: 1, dy: 0, moving: false, dashTime: 0, distance: 0, attack: { weapon: 'knuckles', index: 0, age: 0 } };
  const before = monkPose(player, atlas, {}, weapons); step.frame = 7; step.overlay = 4;
  const after = monkPose(player, atlas, {}, weapons);
  assert.deepEqual(after, { frame: 7, flip: true, weapon: { layer: 'knuckles', cell: 4, flip: true } });
  assert.deepEqual(before, { frame: 5, flip: true, weapon: { layer: 'knuckles', cell: 2, flip: true } });
});

test('replacing a staff tip updates the cached trail and leaves a retained trail independent', () => {
  const atlas = { clips: { idle: { front: [0], back: [0] } } }, step = { frame: 5, staff: 2, mirrorBody: false, tip: [1, 2] };
  const weapons = { staffAttacks: { clips: { staffAttack1: { front: [step], back: [step] } } } };
  const player = { hp: 100, dx: 1, dy: 0, moving: false, dashTime: 0, distance: 0, attack: { weapon: 'staff', index: 0, age: 0 } };
  const before = monkPose(player, atlas, {}, weapons); step.tip = [3, 4];
  const after = monkPose(player, atlas, {}, weapons);
  assert.deepEqual(after.weapon.trail, [[3, 4]]); assert.deepEqual(before.weapon.trail, [[1, 2]]);
});

test('mirrored cached bounds use the current cell width when atlas views share a mask', () => {
  const mask = { width: 8, bytes: new Uint8Array(8).fill(255) }, atlas = { cell: 4, columns: 1, anchor: [0, 0], mask };
  const front = { atlas, frame: 0, flip: false }, back = { atlas, frame: 0, flip: false }, origin = { x: 0, y: 0 };
  assert.equal(obscuresSprite(front, origin, back, origin), true);
  front.atlas = { ...atlas, cell: 8 }; front.flip = true;
  assert.equal(obscuresSprite(front, origin, back, origin), false, 'the mirrored four-pixel cached box moves to x4..8');
});
