import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio, GAITS, CROWD_STEPS, VOICE_LIMITS, contactIndex, surfaceAt } from '../src/audio.js';
import { monkPose, houndPose, beetlePose } from '../src/pixel-animation.js';
import { createAdventure, updateGame, startDash, startWave } from '../src/game.js';
import monkPackage from '../assets/game/pixel-v2/monk/manifest.json' with { type: 'json' };
import houndPackage from '../assets/game/pixel-v2/hound-world/manifest.json' with { type: 'json' };
import beetlePackage from '../assets/game/pixel-v7/beetle/manifest.json' with { type: 'json' };
import { FakeContext } from './helpers/fake-audio-context.js';

function setup() {
  let context;
  // Sound effects alone: tests/audio-music.test.js covers the music.
  const audio = new GameAudio({ AudioContext: class { constructor() { context = new FakeContext(); return context; } }, random: () => .5, music: null });
  audio.unlock();
  const cues = [];
  const cue = audio.cue;
  audio.cue = function(name, options = {}) { cues.push({ name, ...options }); return cue.call(this, name, options); };
  return { audio, context, cues, named: prefix => cues.filter(c => c.name.startsWith(prefix)) };
}

// One full step: three run keys of the monk's drawing.
const STRIDE = GAITS.monk.key * 3;
const monk = (extra = {}) => ({ x: 4, y: 4, dx: 0, dy: 1, hp: 100, distance: 0, dashTime: 0, moving: true, attack: null, ...extra });
const gameAt = (extra = {}) => ({ phase: 'playing', events: [], enemies: [], locationId: 'road',
  world: { paving: [{ x: 0, y: 0 }] }, player: monk(), ...extra });

// Moves the monk along at running speed: 5.4 u/s at 60 frames per second.
function run(h, game, distance, { stride = 5.4 / 60, ground } = {}) {
  const goal = game.player.distance + distance;
  while (game.player.distance < goal - 1e-9) {
    game.player.distance = Math.min(goal, game.player.distance + stride);
    h.context.currentTime += 1 / 60;
    h.audio.frame(game, ground);
  }
}

test('GameAudio stays silent and safe without an AudioContext', () => {
  const audio = new GameAudio({ AudioContext: null });
  audio.unlock();
  audio.setMuted(true); audio.setMuted(false);
  const game = gameAt({ events: [{ type: 'impact', id: 1, source: 'combo', strength: 'heavy' }, { type: 'swing', index: 2 }] });
  audio.play(game.events[0], { game });
  for (let i = 0; i < 30; i++) { game.player.distance += .1; audio.frame(game); }
  assert.equal(audio.context, null);
  assert.equal(audio.cue('impact:flesh'), 0);
});

test('every layer goes through one bus, a limiter and the muteable master', () => {
  const { context, audio } = setup();
  const [bus, limiter, master] = [audio.bus, audio.limiter, audio.master];
  assert.deepEqual(bus.outputs, [limiter]);
  assert.deepEqual(limiter.outputs, [master]);
  assert.deepEqual(master.outputs, [context.destination]);
  assert.equal(master.gain.value, .2);
  assert.equal(limiter.threshold.value, -4);
  assert.equal(limiter.ratio.value, 12);
  audio.cue('impact:shell');
  const envelopes = context.nodes.filter(n => n.kind === 'gain' && n !== bus && n !== master);
  assert.equal(envelopes.length, 4);
  for (const envelope of envelopes) assert.deepEqual(envelope.outputs, [bus]);
  // Every envelope starts near silence, peaks and decays back toward silence before its source stops.
  for (const envelope of envelopes) {
    assert.deepEqual(envelope.gain.calls.map(call => call[0]), ['set', 'linear', 'exponential']);
    assert.equal(envelope.gain.calls[2][1], .0001);
  }
  for (const source of context.started) assert.ok(source.stoppedAt > source.startedAt);
});

test('mute ramps the master to zero and plays nothing until unmuted', () => {
  const h = setup();
  h.audio.setMuted(true);
  assert.deepEqual(h.audio.master.gain.calls.at(-1).slice(0, 2), ['target', 0]);
  const game = gameAt({ events: [{ type: 'swing', index: 0 }] });
  h.audio.frame(game);
  game.events = [];
  run(h, game, 3);
  assert.equal(h.context.started.length, 0);
  h.audio.setMuted(false);
  assert.deepEqual(h.audio.master.gain.calls.at(-1).slice(0, 2), ['target', .2]);
  // The stride kept counting while muted, so unmuting replays no steps.
  const silent = h.named('step:').length;
  h.audio.frame(game);
  assert.equal(h.named('step:').length, silent);
  run(h, game, STRIDE);
  assert.equal(h.named('step:').length, silent + 1);
  assert.ok(h.context.started.length > 0);
});

test('the monk steps once per contact key over a known distance', () => {
  const h = setup(), game = gameAt();
  h.audio.frame(game);
  const distance = STRIDE * 10 + GAITS.monk.key / 2;
  run(h, game, distance);
  // The distance covers run keys 0..30; the contact keys 03, 06 … 30 make ten feet.
  assert.equal(h.named('step:').length, 10);
  assert.equal(contactIndex(distance, GAITS.monk) - contactIndex(0, GAITS.monk), 10);
  // Feet alternate in pitch and weight.
  assert.deepEqual(h.named('step:').slice(0, 2).map(c => c.pitch), [1.03, .97]);
});

test('footfalls land exactly on the run drawings that plant a foot', () => {
  const runFrames = monkPackage.monk.clips.run.front;
  const h = setup(), game = gameAt(), keys = [];
  h.audio.frame(game);
  // Record the drawn key whenever a step fires.
  for (let distance = .037; distance < STRIDE * 5 + GAITS.monk.key / 2; distance += .037) {
    game.player.distance = distance; h.context.currentTime += 1 / 60;
    const before = h.named('step:').length;
    h.audio.frame(game);
    if (h.named('step:').length > before) keys.push(runFrames.indexOf(monkPose(game.player).frame));
  }
  assert.equal(keys.length, 5);
  // Run keys 01 and 04 (indices 0 and 3) are the right and left foot contacts.
  for (const key of keys) assert.ok(key === 0 || key === 3, `step on run key ${key}`);
  // Monster contact keys follow their own drawings too.
  for (const [pose, atlas, clip, kind] of [[houndPose, houndPackage.hound, 'run', 'hound'], [beetlePose, beetlePackage.beetle, 'walk', 'beetle']]) {
    const frames = atlas.clips[clip].front;
    let previous = contactIndex(0, GAITS[kind]);
    for (let distance = 0; distance < 4; distance += .013) {
      const index = contactIndex(distance, GAITS[kind]);
      if (index > previous) {
        const key = frames.indexOf(pose({ state: 'chase', hp: 10, distance, dx: 0, dy: 1 }, atlas).frame);
        assert.ok(key === 2 || key === 5, `${kind} step on key ${key}`);
      }
      previous = index;
    }
  }
});

test('surfaces come from the ground mask, or from the area and worn path', () => {
  // One row of three cells: grass, soil, stone weights in R, G, B.
  const map = { origin: { x: -.5, y: -.5 }, pixelsPerUnit: 1, width: 3, height: 1,
    data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 64, 64, 127, 255]) };
  const game = gameAt();
  assert.equal(surfaceAt(game, 0, 0, map), 'grass');
  assert.equal(surfaceAt(game, 1, 0, map), 'earth');
  assert.equal(surfaceAt(game, 2, 0, map), 'stone');
  assert.equal(surfaceAt(game, 0, 0), 'earth');
  assert.equal(surfaceAt(game, 3, 0), 'grass');
  assert.equal(surfaceAt({ ...game, locationId: 'courtyard' }, 0, 0), 'stone');
  assert.equal(surfaceAt({ ...game, locationId: 'courtyard' }, 3, 0), 'grass');
  assert.equal(surfaceAt({ ...game, world: undefined }, 3, 0), 'stone');
  // The frame hook samples the monk's feet through the ground getter.
  const h = setup(), walk = gameAt({ player: monk({ x: 1, y: 0 }) });
  h.audio.frame(walk, () => map);
  run(h, walk, STRIDE + GAITS.monk.key / 2, { ground: () => map });
  walk.player.x = 2;
  run(h, walk, STRIDE, { ground: () => map });
  assert.deepEqual(h.named('step:').map(c => c.name), ['step:earth', 'step:stone']);
});

test('dash, defeat and a new run never step; a strike keeps steps quiet', () => {
  const h = setup(), game = gameAt();
  h.audio.frame(game);
  game.player.dashTime = .2;
  run(h, game, 2.6, { stride: 13 / 60 });
  // The frame the dash ends still covers dash distance: no landing step.
  game.player.dashTime = 0;
  game.player.distance += STRIDE * 1.1;
  h.audio.frame(game);
  assert.equal(h.named('step:').length, 0);
  run(h, game, STRIDE);
  assert.equal(h.named('step:').length, 1);
  game.player.attack = { index: 0, age: 0 };
  run(h, game, STRIDE);
  assert.equal(h.named('step:').at(-1).gain, .55 * .88);
  game.player.attack = null;
  game.phase = 'defeat';
  run(h, game, 3);
  assert.equal(h.named('step:').length, 2);
  // A fresh run starts its own stride: a long distance is no backlog of steps.
  const next = gameAt({ player: monk({ distance: 40 }) });
  h.audio.frame(next);
  assert.equal(h.named('step:').length, 2);
});

test('monster steps are near, distance-scaled and rate limited for a full crowd', () => {
  const h = setup();
  const enemies = Array.from({ length: 34 }, (_, i) => ({ id: i, kind: ['hound', 'beetle', 'wraith'][i % 3],
    x: 4 + (i % 6) * .5, y: 4 + Math.floor(i / 6) * .5, hp: 10, distance: 0, state: 'chase' }));
  enemies.push({ id: 'far', kind: 'beetle', x: 40, y: 40, hp: 10, distance: 0 });
  const game = gameAt({ enemies, player: monk({ distance: 0 }) });
  h.audio.frame(game);
  let worstFrame = 0;
  for (let frame = 0; frame < 120; frame++) {
    for (const enemy of enemies) enemy.distance += .2;
    h.context.currentTime += 1 / 60;
    const before = h.cues.length;
    h.audio.frame(game);
    worstFrame = Math.max(worstFrame, h.cues.length - before);
  }
  const crowd = h.cues.filter(c => c.priority === 'crowd');
  // Two seconds: the burst of three plus five per second, never more than two a frame.
  assert.ok(crowd.length <= CROWD_STEPS.burst + CROWD_STEPS.perSecond * 2, `${crowd.length} monster steps`);
  assert.ok(crowd.length >= 8);
  assert.ok(worstFrame <= CROWD_STEPS.perFrame);
  assert.ok(crowd.every(c => c.name === 'step:hound' || c.name === 'step:beetle'));
  assert.ok(crowd.every(c => c.gain > 0 && c.gain <= 1));
  // Only the far beetle moved now: it is out of range.
  const count = crowd.length;
  for (const enemy of enemies) if (enemy.id !== 'far') enemy.hp = 0;
  for (let frame = 0; frame < 60; frame++) { enemies.at(-1).distance += .2; h.context.currentTime += 1 / 60; h.audio.frame(game); }
  assert.equal(h.cues.filter(c => c.priority === 'crowd').length, count);
});

test('the three combo swings and hits sound distinct; heavy hits kick once', () => {
  const h = setup();
  const hound = { id: 7, kind: 'hound', hp: 10 };
  const game = gameAt({ enemies: [hound] });
  for (const index of [0, 1, 2]) {
    game.player.attack = { index, age: 0 };
    game.events = [{ type: 'swing', index }, { type: 'impact', id: 7, source: 'combo', strength: index === 2 ? 'heavy' : 'light' }];
    h.audio.frame(game);
  }
  assert.deepEqual(h.named('swing').map(c => c.name), ['swing:0', 'swing:1', 'swing:2']);
  assert.deepEqual(h.named('impact').map(c => [c.pitch, c.gain]), [[1, .9], [1.08, 1], [.86, 1.15]]);
  assert.deepEqual(h.named('punch').map(c => c.gain), [1]);
});

test('impact layers follow the target: flesh, spirit, shell, crystal, stone guard', () => {
  const h = setup();
  const enemies = [{ id: 'h', kind: 'hound' }, { id: 'w', kind: 'wraith' }, { id: 'b', kind: 'beetle' }, { id: 'r', kind: 'ritual' }];
  const game = gameAt({ enemies });
  for (const id of ['h', 'w', 'b', 'r']) {
    game.events = [{ type: 'impact', id, source: 'combo', strength: 'light' }];
    h.audio.frame(game);
  }
  game.events = [{ type: 'block', id: 'b', source: 'combo', strength: 'light' }];
  h.audio.frame(game);
  game.events = [{ type: 'impact', id: 'b', source: 'dash', strength: 'heavy' }, { type: 'guard-break', id: 'b', source: 'dash' }];
  h.audio.frame(game);
  assert.deepEqual(h.cues.map(c => c.name), ['impact:flesh', 'impact:spirit', 'impact:shell', 'impact:crystal', 'block',
    'impact:shell', 'guard-break', 'punch']);
  // The guard break outranks the dash kick.
  assert.equal(h.named('punch')[0].gain, .9);
});

test('a wave across many bodies merges into one layer per kind and respects the voice cap', () => {
  const h = setup();
  const enemies = [...Array.from({ length: 6 }, (_, i) => ({ id: i, kind: 'hound' })), { id: 'b1', kind: 'beetle' }, { id: 'b2', kind: 'beetle' }];
  const game = gameAt({ enemies });
  game.events = [{ type: 'wave', source: 'wave', strength: 'heavy' },
    ...enemies.flatMap(e => [{ type: 'damage', id: e.id }, { type: 'impact', id: e.id, source: 'wave', strength: 'heavy' },
      ...(e.kind === 'beetle' ? [{ type: 'guard-break', id: e.id, source: 'wave' }] : []), { type: 'death', id: e.id }])];
  h.audio.frame(game);
  const names = h.cues.map(c => c.name);
  assert.equal(names.filter(n => n === 'impact:flesh').length, 2);
  assert.equal(names.filter(n => n === 'impact:shell').length, 2);
  assert.equal(names.filter(n => n === 'guard-break').length, 1);
  assert.equal(names.filter(n => n === 'death').length, 2);
  assert.equal(names.filter(n => n === 'punch').length, 1);
  const flesh = h.cues.find(c => c.name === 'impact:flesh');
  assert.ok(flesh.gain <= .9 * 1.6 + 1e-9 && flesh.gain > .9);
  assert.ok(h.context.started.length <= VOICE_LIMITS.combat);
  // Unmerged calls from elsewhere still stop at the cap while the layers ring.
  for (let i = 0; i < 40; i++) h.audio.play({ type: 'impact', id: 0, source: 'combo', strength: 'heavy' }, { game });
  assert.equal(h.context.started.length, VOICE_LIMITS.combat);
  // Footsteps give way first: the step class is already full.
  game.events = [];
  run(h, game, STRIDE, { stride: STRIDE });
  assert.equal(h.context.started.length, VOICE_LIMITS.combat);
  // Once the layers end, voices free up again.
  h.context.currentTime += 2;
  h.audio.cue('impact:flesh');
  assert.ok(h.context.started.length > VOICE_LIMITS.combat);
});

test('the real simulation steps only while running on foot', () => {
  const h = setup(), game = createAdventure({}, { seed: 7 });
  const controls = { moveX: 0, moveY: -1, aimX: 0, aimY: -1, actions: [] };
  const frame = () => {
    for (let i = 0; i < 2; i++) updateGame(game, controls, 1 / 120);
    h.context.currentTime += 1 / 60;
    h.audio.frame(game);
    game.events.length = 0;
  };
  h.audio.frame(game);
  const start = game.player.distance;
  for (let i = 0; i < 60; i++) frame();
  const steps = h.named('step:').length;
  assert.equal(steps, contactIndex(game.player.distance, GAITS.monk) - contactIndex(start, GAITS.monk));
  assert.ok(steps >= 3);
  startDash(game, 0, -1);
  h.audio.frame(game);
  // The loop's last frame is the one the dash ends in.
  while (game.player.dashTime > 0) frame();
  assert.equal(h.named('step:').length, steps);
  assert.ok(h.named('step:').every(c => ['step:grass', 'step:earth', 'step:stone'].includes(c.name)));
});

test('real combat events pick the right layers: combo on each kind, guarded front, wave', () => {
  const h = setup(), game = createAdventure({}, { seed: 7 });
  const frame = controls => {
    updateGame(game, { moveX: 0, moveY: 0, aimX: 0, aimY: 0, actions: [], ...controls }, 1 / 120);
    h.context.currentTime += 1 / 120;
    h.audio.frame(game);
    game.events.length = 0;
  };
  // Stand the monk 1 u from one body, alone, and land the first combo strike on it.
  const strike = (kind, side) => {
    const target = game.enemies.find(e => e.kind === kind && e.hp > 0);
    // Other bodies sit out this strike, then come back.
    const others = game.enemies.filter(e => e !== target && e.hp > 0);
    const health = others.map(e => e.hp);
    for (const e of others) e.hp = 0;
    Object.assign(target, { dx: 0, dy: 1, state: 'idle', exposed: false });
    Object.assign(game.player, { x: target.x, y: target.y + side, attack: null, comboTimer: 0, dashTime: 0 });
    const before = h.cues.length;
    for (let i = 0; i < 30; i++) frame({ attack: i === 0, aimX: 0, aimY: -side });
    others.forEach((e, i) => { e.hp = health[i]; });
    return h.cues.slice(before).map(c => c.name);
  };
  assert.ok(strike('hound', 1).includes('impact:flesh'));
  assert.ok(strike('wraith', 1).includes('impact:spirit'));
  // A beetle faces +y: its front blocks, its back cracks.
  assert.ok(strike('beetle', 1).includes('block'));
  assert.ok(strike('beetle', -1).includes('impact:shell'));
  const beetle = game.enemies.find(e => e.kind === 'beetle' && e.hp > 0);
  Object.assign(game.player, { x: beetle.x, y: beetle.y + 1.5, waveCooldown: 0, spirit: 100 });
  beetle.exposed = false;
  game.player.attack = null;
  const before = h.cues.length;
  startWave(game);
  frame({});
  const names = h.cues.slice(before).map(c => c.name);
  for (const name of ['wave', 'impact:shell', 'guard-break', 'punch']) assert.ok(names.includes(name), `${name} in ${names}`);
});
