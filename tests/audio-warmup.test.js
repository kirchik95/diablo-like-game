import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio, CUES } from '../src/audio.js';
import { FakeContext } from './helpers/fake-audio-context.js';

test('phone unlock silently prepares all cue waveforms and reuses the prepared slot', () => {
  const types = [], order = [];
  let starts = 0, randomCalls = 0, context;
  class Recording extends FakeContext {
    resume() { order.push('resume'); return super.resume(); }
    createOscillator() {
      const node = super.createOscillator();
      let type = node.type;
      Object.defineProperty(node, 'type', { get: () => type, set(value) { type = value; types.push(value); order.push('type'); } });
      const start = node.start.bind(node);
      node.start = (...args) => { starts++; return start(...args); };
      return node;
    }
  }
  const audio = new GameAudio({ AudioContext: class { constructor() { context = new Recording(); return context; } },
    music: null, samples: null, matchMedia: () => ({ matches: true }), random: () => { randomCalls++; return .5; } });
  audio.unlock();
  const required = [...new Set(Object.values(CUES).flat().map(cue => cue.osc).filter(Boolean))].sort();
  assert.deepEqual([...new Set(types)].sort(), required);
  assert.equal(starts, 0, 'warmup must not start an audible oscillator');
  assert.equal(context.started.length, 0, 'noise sources remain silent too');
  assert.equal(randomCalls, 0, 'sound variation sequence stays unchanged');
  assert.ok(order.indexOf('resume') < order.indexOf('type'), 'preserve the iOS user-gesture resume order');
  assert.equal(audio.slots.length, 1);
  const prepared = audio.slots[0];
  assert.equal(prepared.mode, '');
  assert.equal(prepared.oscOn, false);
  assert.equal(prepared.noiseOn, false);
  assert.equal(prepared.busyUntil, -Infinity);
  assert.equal(prepared.osc.type, 'sine');
  const warmed = types.length;
  audio.unlock();
  assert.equal(types.length, warmed, 'resume does not rebuild the waveforms');
  audio.cue('impact:flesh');
  assert.equal(audio.slots[0], prepared);
  assert.equal(prepared.oscOn, true);
  assert.ok(context.started.includes(prepared.osc));
});

test('desktop unlock retains lazy one-shot source creation', () => {
  let created = 0;
  class Recording extends FakeContext { createOscillator() { created++; return super.createOscillator(); } }
  const audio = new GameAudio({ AudioContext: Recording, music: null, samples: null, matchMedia: () => ({ matches: false }) });
  audio.unlock();
  assert.equal(created, 0);
  assert.equal(audio.slots, null);
});
