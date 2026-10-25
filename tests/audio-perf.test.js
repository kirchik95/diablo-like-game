import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio, VOICE_LIMITS, MOBILE_VOICE_LIMITS, noiseBuildCount } from '../src/audio.js';
import { MUSIC } from '../src/music.js';
import { FakeContext } from './helpers/fake-audio-context.js';
import { LoadedSamples } from './helpers/fake-samples.js';

const coarseMedia = () => ({ matches: true });
function open({ coarse = false, music, samples } = {}) {
  let context;
  const audio = new GameAudio({
    AudioContext: class { constructor() { context = new FakeContext(); return context; } },
    random: () => .5,
    matchMedia: coarse ? coarseMedia : () => ({ matches: false }),
    ...(music === null ? { music: null } : {}),
    ...(samples !== undefined ? { samples } : {}),
  });
  audio.unlock();
  return { audio, context, music: audio.music };
}

test('one noise buffer is built once and shared', () => {
  const before = noiseBuildCount();
  const a = open({ music: null });
  const built = noiseBuildCount();
  const b = open({ music: null });
  assert.equal(noiseBuildCount(), built);
  assert.ok(built - before <= 1);
  assert.deepEqual(a.audio.noise.getChannelData(0), b.audio.noise.getChannelData(0));
});

test('a coarse pointer lowers the voice cap and decodes music at the phone rate', () => {
  const desk = open();
  assert.deepEqual(desk.audio.limits, VOICE_LIMITS);
  assert.equal(desk.music.rate, null);
  assert.equal(desk.music.keepDecoded, MUSIC.keepDecoded.desktop);
  const phone = open({ coarse: true });
  assert.deepEqual(phone.audio.limits, MOBILE_VOICE_LIMITS);
  assert.equal(phone.music.rate, MUSIC.phoneRate);
  assert.ok(phone.music.keepDecoded < desk.music.keepDecoded);
});

test('a phone drops layers past its cap and retriggers the same nodes', () => {
  const { audio, context } = open({ coarse: true, music: null });
  let played = 0;
  for (let i = 0; i < 20; i++) played += audio.cue('impact:shell');
  assert.equal(played, MOBILE_VOICE_LIMITS.combat);
  const nodes = context.nodes.length;
  context.currentTime += 1;
  const again = audio.cue('impact:shell');
  assert.equal(again, 4);
  assert.equal(context.nodes.length, nodes);
});

test('a desktop replays a cue with new sources and the same gains and filters', () => {
  const { audio, context } = open({ music: null });
  audio.cue('impact:shell');
  const nodes = context.nodes.length;
  context.currentTime += 1;
  audio.cue('impact:shell');
  // Shell is two noises and two oscillators. The gains and filters come back from the pool.
  assert.equal(context.nodes.length - nodes, 4);
});

function fight(coarse, samples) {
  const { audio, context } = open({ coarse, samples });
  const enemies = Array.from({ length: 8 }, (_, i) => ({
    id: i, kind: i % 2 ? 'beetle' : 'hound', hp: 80,
    x: 4.4 + (i % 4) * .35, y: 4.3, distance: 0, state: 'chase', active: true,
  }));
  const game = {
    phase: 'playing', adventure: {}, locationId: 'road', events: [],
    world: { paving: [{ x: 0, y: 0 }] },
    player: { x: 4, y: 4, dx: 0, dy: 1, hp: 100, distance: 0, dashTime: 0, attack: null },
    enemies,
  };
  let mark = 0;
  for (let frame = 0; frame < 120; frame++) {
    if (frame === 60) mark = context.nodes.length;
    game.player.distance += 5.4 / 60;
    game.player.attack = frame % 24 < 10 ? { index: Math.floor(frame / 8) % 4, age: 0 } : null;
    for (const enemy of enemies) enemy.distance += .16;
    const events = [];
    if (frame % 8 === 0) {
      const index = (frame / 8) % 4;
      events.push({ type: 'swing', index, weapon: 'staff', strength: index >= 2 ? 'heavy' : 'light' });
      for (const enemy of enemies) events.push({ type: 'impact', id: enemy.id, x: enemy.x, y: enemy.y, source: 'combo', strength: index >= 2 ? 'heavy' : 'light' });
    }
    // Monsters wind up in turn; a hound's windup carries only its place.
    if (frame % 10 === 5) {
      const enemy = enemies[(frame / 10 | 0) % enemies.length];
      events.push({ type: 'windup', x: enemy.x, y: enemy.y, ...(enemy.kind === 'beetle' ? { id: enemy.id, kind: 'beetle' } : {}) });
    }
    if (frame % 45 === 20) {
      events.push({ type: 'wave', source: 'wave', strength: 'heavy' });
      for (const enemy of enemies) {
        events.push({ type: 'impact', id: enemy.id, source: 'wave', strength: 'heavy' });
        if (enemy.kind === 'beetle') events.push({ type: 'guard-break', id: enemy.id, source: 'wave' });
      }
    }
    game.events = events;
    context.currentTime += 1 / 60;
    audio.frame(game);
    game.events = [];
  }
  return context.nodes.length - mark;
}

test('a busy second builds fewer nodes, and a phone almost stops allocating', () => {
  const desk = fight(false, null), phone = fight(true, null);
  // Before the pools: about 465 nodes in this same second.
  assert.ok(desk < 220, `desktop ${desk}`);
  assert.ok(phone < 40, `phone ${phone}`);
  assert.ok(phone < desk / 4, `phone ${phone} desktop ${desk}`);
});

test('recorded steps and cries keep the same busy second inside the node budget', () => {
  // Each recorded sound builds one buffer source; its gain comes from the pool.
  const desk = fight(false, LoadedSamples), phone = fight(true, LoadedSamples);
  assert.ok(desk < 220, `desktop ${desk}`);
  assert.ok(phone < 40, `phone ${phone}`);
});

test('unlock resumes before the noise buffer is filled', () => {
  const order = [];
  class Recording extends FakeContext {
    resume() { order.push('resume'); return super.resume(); }
    createBuffer(channels, length) {
      order.push('createBuffer');
      const buffer = super.createBuffer(channels, length);
      const read = buffer.getChannelData;
      buffer.getChannelData = channel => {
        const data = read(channel);
        const write = data.set.bind(data);
        data.set = (...args) => { order.push('getChannelData'); return write(...args); };
        return data;
      };
      return buffer;
    }
  }
  const audio = new GameAudio({
    AudioContext: class { constructor() { return new Recording(); } },
    random: () => .5,
  });
  audio.unlock();
  const resumeAt = order.indexOf('resume');
  const fillAt = order.findIndex(name => name === 'createBuffer' || name === 'getChannelData');
  assert.ok(resumeAt >= 0 && fillAt > resumeAt, order.join(','));
  order.length = 0;
  audio.unlock();
  assert.deepEqual(order, ['resume']);
});

test('phone and desktop pick the same tracks and levels on the same frames', () => {
  const mixes = coarse => {
    const { audio, context, music } = open({ coarse });
    const game = {
      phase: 'playing', adventure: {}, locationId: 'road', events: [],
      player: { x: 0, y: 0, hp: 100, distance: 0, dashTime: 0, attack: null },
      enemies: [{ id: 1, kind: 'hound', hp: 64, x: 5, y: 0, state: 'chase', active: true }],
    };
    const seen = [];
    for (let i = 0; i < 180; i++) {
      context.currentTime += 1 / 60;
      if (i === 90) game.locationId = 'cemetery';
      audio.frame(game);
      seen.push(JSON.stringify(music.mix));
    }
    return seen;
  };
  assert.deepEqual(mixes(true), mixes(false));
});
