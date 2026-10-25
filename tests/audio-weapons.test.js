import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GameAudio } from '../src/audio.js';
import { SOUNDS, Samples, soundUrl } from '../src/sfx.js';
import { FakeContext } from './helpers/fake-audio-context.js';
import { LoadedSamples, fakeBuffer, recordSounds } from './helpers/fake-samples.js';

const families = ['bare', 'knuckles', 'staff'];
const names = families.flatMap(family => ['swing', 'hit'].map(action => `weapon:${family}:${action}`));
function setup({ loaded = true, coarse = false } = {}) {
  let context, draws = 0;
  class WeaponSamples extends LoadedSamples {
    constructor(c, options) {
      super(c, options);
      if (loaded) for (const name of names) if (this.buffers[name]) {
        this.buffers[name] = Array.from({ length: 3 }, (_, i) => fakeBuffer(name, i + 1, .2));
      }
    }
  }
  const audio = new GameAudio({ AudioContext: class { constructor() { context = new FakeContext(); return context; } },
    music: null, samples: WeaponSamples, matchMedia: () => ({ matches: coarse }),
    random: () => { draws++; return ((draws * 37) % 97) / 97; } });
  audio.unlock();
  return { audio, context, calls: recordSounds(audio), get draws() { return draws; } };
}
const game = family => ({ player: { attack: family === 'bare' ? {} : { weapon: family } },
  inventory: { equipped: { weapon: family === 'bare' ? null : { family } } }, enemies: [] });
const weapons = h => h.context.started.filter(source => source.buffer?.name?.startsWith('weapon:'));

test('each weapon replaces a loaded swing and adds its own contact over the enemy material', () => {
  for (const family of families) {
    const h = setup(), g = game(family);
    h.audio.play({ type: 'swing', index: 0, ...(family === 'bare' ? {} : { weapon: family }) }, { game: g });
    assert.equal(weapons(h)[0]?.buffer.name, `weapon:${family}:swing`);
    assert.ok(!h.calls.some(c => c.name === 'swing:0'), 'synth swing is only a fallback');
    h.context.advance(1);
    h.audio.play({ type: 'impact', source: 'combo', strength: 'light' }, { game: g, kind: 'beetle' });
    assert.equal(weapons(h).at(-1)?.buffer.name, `weapon:${family}:hit`);
    assert.ok(h.calls.some(c => c.name === 'impact:shell'));
  }
});

test('contact follows the attack snapshot and includes a blocked combo, but not techniques', () => {
  const h = setup(), g = game('staff');
  g.inventory.equipped.weapon.family = 'knuckles';
  h.audio.play({ type: 'block', source: 'combo' }, { game: g });
  assert.equal(weapons(h).at(-1)?.buffer.name, 'weapon:staff:hit');
  h.context.advance(1);
  g.player.attack = {};
  h.audio.play({ type: 'impact', source: 'combo' }, { game: g });
  assert.equal(weapons(h).at(-1)?.buffer.name, 'weapon:bare:hit');
  const before = weapons(h).length;
  for (const source of ['dash', 'wave', 'palm', 'crane', 'deflect', 'relic']) {
    h.context.advance(1);
    h.audio.play({ type: 'impact', source }, { game: g });
  }
  assert.equal(weapons(h).length, before);
});

test('missing weapon files retain the synth fallback without retries or shared RNG draws', async () => {
  const h = setup({ loaded: false });
  const missing = new Samples(h.context, { sounds: { 'weapon:staff:swing': SOUNDS['weapon:staff:swing'] },
    fetchFile: async () => ({ ok: false, status: 404 }) });
  await Promise.all(missing.files.map(file => missing.loadFile(file)));
  h.audio.samples = missing;
  h.audio.play({ type: 'swing', weapon: 'staff', index: 2 });
  assert.ok(h.calls.some(c => c.name === 'swing:2'));
  assert.equal(weapons(h).length, 0);
  assert.equal(missing.files.filter(file => file.state === 'failed').length, 3);
  const before = missing.next;
  missing.next = missing.files.length;
  missing.load();
  assert.equal(missing.next, 3);
  assert.equal(before, 0);
});

test('loading a weapon does not shift variation of other cues on desktop or phone', () => {
  for (const coarse of [false, true]) for (const family of families) for (const index of [0, 1, 2, 3]) {
    const traces = [];
    for (const loaded of [false, true]) {
      const h = setup({ loaded, coarse }), trace = [], layer = h.audio.layer;
      h.audio.layer = function(spec, tune) {
        trace.push([spec.from, tune.pitch, tune.gain]);
        return layer.call(this, spec, tune);
      };
      h.audio.play({ type: 'swing', index, weapon: family });
      h.context.advance(1); trace.length = 0;
      h.audio.play({ type: 'impact', source: 'combo', strength: 'light' }, { game: game(family) });
      h.context.advance(1); h.audio.cue('palm');
      traces.push({ draws: h.draws, trace });
    }
    assert.deepEqual(traces[1], traces[0], `${coarse ? 'phone' : 'desktop'} ${family} ${index}`);
  }
});

test('weapon samples obey phone voice limits and muting', () => {
  const h = setup({ coarse: true });
  h.audio.voiceEnds = Array(h.audio.limits.combat).fill(10);
  const before = h.context.started.length;
  h.audio.play({ type: 'swing', weapon: 'staff', index: 0 });
  h.audio.play({ type: 'impact', source: 'combo' }, { game: game('staff') });
  assert.equal(h.context.started.length, before);
  assert.equal(h.audio.voiceEnds.length, h.audio.limits.combat);
  h.context.advance(11); h.audio.setMuted(true);
  h.audio.play({ type: 'swing', weapon: 'knuckles' });
  assert.equal(h.context.started.length, before);
});

test('overlapping optional contacts do not shift legacy RNG at the voice cap', () => {
  for (const coarse of [false, true]) {
    const traces = [];
    for (const loaded of [false, true]) {
      const h = setup({ loaded, coarse }), trace = [], g = game('staff');
      for (let i = 0; i < (h.audio.limits.combat - 4) / 4; i++) h.audio.cue('impact:shell');
      assert.equal(h.audio.voiceEnds.length, h.audio.limits.combat - 4);
      const before = h.draws;
      h.audio.play({ type: 'block', source: 'combo' }, { game: g });
      h.audio.cue('swing:0');
      trace.push(h.draws - before);
      for (const seconds of [.01, .05, .1, .3]) {
        h.context.advance(seconds);
        h.audio.voice(g, 'hound', 'hurt', {});
        h.audio.cue('impact:shell');
        trace.push(h.draws - before);
      }
      traces.push(trace);
    }
    assert.equal(traces[0][0], coarse ? 4 : 6);
    assert.deepEqual(traces[1], traces[0]);
  }
});

test('weapon bank has three optional variants per sound and filename-stable URLs', () => {
  for (const name of names) {
    assert.equal(SOUNDS[name]?.count, 3, name);
    assert.equal(SOUNDS[name].optional, true);
    for (let n = 1; n <= 3; n++) assert.ok(soundUrl(name, n).endsWith(`/sfx/${name.replaceAll(':', '-')}-${n}.m4a`));
  }
});

test('optional voice pressure preserves the crowd-footstep token budget', () => {
  for (const loaded of [false, true]) {
    const h = setup({ loaded }), g = game('staff');
    Object.assign(g, { phase: 'playing', locationId: 'road', world: { paving: [] },
      enemies: [{ kind: 'hound', x: 1, y: 0, hp: 100, distance: 0 }] });
    Object.assign(g.player, { x: 0, y: 0, hp: 100, distance: 0, dashTime: 0, attack: null });
    h.audio.footsteps(g, null);
    h.audio.cue('impact:shell'); h.audio.cue('impact:shell');
    h.audio.play({ type: 'block', source: 'combo' }, { game: g });
    g.enemies[0].distance = .6;
    h.audio.footsteps(g, null);
    assert.equal(h.audio.crowdTokens, 2, `loaded=${loaded}`);
  }
});

test('a partially loaded weapon uses available variants without immediate repeats', async () => {
  const h = setup({ loaded: false }), name = 'weapon:staff:swing';
  const samples = h.audio.samples = new Samples(h.context, { sounds: { [name]: SOUNDS[name] },
    fetchFile: async url => ({ ok: !url.endsWith('-2.m4a'), status: 404,
      arrayBuffer: async () => Number(/-(\d)\.m4a$/.exec(url)[1]) }),
    decode: async variant => fakeBuffer(name, variant, .2) });
  await samples.loadFile(samples.files[0]);
  h.audio.play({ type: 'swing', weapon: 'staff' });
  assert.equal(weapons(h).at(-1).buffer.variant, 1);
  await Promise.all(samples.files.slice(1).map(file => samples.loadFile(file)));
  h.context.advance(1);
  h.audio.play({ type: 'swing', weapon: 'staff' });
  assert.equal(weapons(h).at(-1).buffer.variant, 3);
  h.context.advance(1);
  h.audio.play({ type: 'swing', weapon: 'staff' });
  assert.equal(weapons(h).at(-1).buffer.variant, 1);
  assert.equal(samples.files[1].state, 'failed');
});

test('a virtually selected but capped sample cannot cause an audible repeat', () => {
  const h = setup({ coarse: true });
  h.audio.random = () => 0;
  h.audio.sound('step:grass', { vary: 0 });
  assert.equal(h.audio.live.at(-1).source.buffer.variant, 1);
  h.context.advance(1);
  for (let i = 0; i < h.audio.limits.combat; i++) h.audio.weaponSound('weapon:staff:hit');
  assert.equal(h.audio.sound('step:grass', { vary: 0 }), 0);
  h.context.advance(1);
  assert.equal(h.audio.sound('step:grass', { vary: 0 }), 1);
  assert.equal(h.audio.live.at(-1).source.buffer.variant, 2);
});

test('the six generation definitions request at most twenty seconds without contacting an API', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ritual-weapon-definitions-'));
  const script = new URL('../scripts/build-sfx.mjs', import.meta.url);
  const selected = names.map(name => name.replaceAll(':', '-'));
  // Only the offline process command runs; empty raw/ means no ffmpeg or generated audio.
  const code = `process.argv = ['node', ${JSON.stringify(fileURLToPath(script))}, 'process', ${JSON.stringify(dir)}, ...${JSON.stringify(selected)}];
    const { SOUNDS, validatePrompts } = await import(${JSON.stringify(script.href)});
    const assert = (await import('node:assert/strict')).default;
    assert.throws(() => validatePrompts([{name:'fixture', prompt:'a'.repeat(451)}]), /450/);
    assert.doesNotThrow(() => validatePrompts([{name:'fixture', prompt:'a'.repeat(450)}]));
    console.log('DEFINITIONS ' + JSON.stringify(SOUNDS.filter(s => ${JSON.stringify(selected)}.includes(s.name))));`;
  try {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const definitions = JSON.parse(/^DEFINITIONS (.*)$/m.exec(run.stdout)[1]);
    assert.equal(definitions.length, 6);
    assert.ok(definitions.every(s => s.variants === 3 && s.seconds >= .5 && s.max <= s.seconds && s.rms <= -14));
    assert.ok(definitions.reduce((sum, s) => sum + s.seconds * s.variants, 0) <= 20);
    assert.ok(definitions.every(s => /one-shot/i.test(s.prompt) && /dry/i.test(s.prompt) && /no music/i.test(s.prompt) && /no voice/i.test(s.prompt)));
    assert.ok(definitions.every(s => s.prompt.length <= 450), 'complete prompt includes the shared suffix');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
