import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GameAudio, MONSTER_VOICES, MOBILE_VOICE_LIMITS, DECAL_SURFACES, GAITS, surfaceAt } from '../src/audio.js';
import { MUSIC } from '../src/music.js';
import { SFX, SOUNDS, SURFACES, Samples, soundUrl } from '../src/sfx.js';
import { createAdventure } from '../src/game.js';
import { gameFiles } from '../src/boot-splash.js';
import { normalizeAppearance } from '../src/appearance.js';
import { FakeContext } from './helpers/fake-audio-context.js';
import { LoadedSamples, fakeBuffer, recordSounds } from './helpers/fake-samples.js';

const SFX_DIR = new URL('../assets/game/sfx/', import.meta.url);
const fileOf = url => /sfx\/([a-z]+-[a-z]+-\d)\.m4a$/.exec(url)[1];

// Recorded sounds with a fake network and decoder. `fail` rejects a fetch, `missing` answers 404,
// `broken` fails the decode; `held` fetches wait until release().
function setup({ coarse = false, fail = [], missing = [], broken = [], held = false, samples } = {}) {
  let context;
  const fetched = [], decoded = [], waiting = [];
  const fetchFile = async url => {
    const file = fileOf(url);
    fetched.push(file);
    if (held) await new Promise(resolve => waiting.push(resolve));
    if (fail.includes(file)) throw new TypeError('Failed to fetch');
    return { ok: !missing.includes(file), status: missing.includes(file) ? 404 : 200, arrayBuffer: async () => ({ file }) };
  };
  const decode = async (bytes, rate) => {
    decoded.push({ file: bytes.file, rate });
    if (broken.includes(bytes.file)) throw new DOMException('Unable to decode audio data', 'EncodingError');
    const [, kind, action, n] = /^([a-z]+)-([a-z]+)-(\d)$/.exec(bytes.file);
    return fakeBuffer(`${kind}:${action}`, +n, .3, rate ?? context.sampleRate);
  };
  const required = Object.fromEntries(Object.entries(SOUNDS).filter(([, spec]) => !spec.optional));
  class TestSamples extends Samples { constructor(c, options) { super(c, { ...options, sounds: required, fetchFile, decode }); } }
  const audio = new GameAudio({ AudioContext: class { constructor() { context = new FakeContext(); return context; } },
    random: () => .5, music: null, samples: samples === undefined ? TestSamples : samples, matchMedia: () => ({ matches: coarse }) });
  const sounds = recordSounds(audio);
  return { audio, get context() { return context; }, fetched, decoded, sounds,
    release: () => { for (const resolve of waiting.splice(0)) resolve(); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('a step correction follows its file when variants finish decoding out of order', async () => {
  const h = setup({ samples: null });
  h.audio.unlock();
  const pending = new Map();
  const samples = h.audio.samples = new Samples(h.context, {
    sounds: { 'step:stone': SOUNDS['step:stone'] },
    fetchFile: async url => ({ ok: true, arrayBuffer: async () => ({ file: fileOf(url) }) }),
    decode: bytes => new Promise(resolve => pending.set(bytes.file,
      () => resolve(fakeBuffer('step:stone', Number(bytes.file.at(-1)))))),
  });
  const loading = samples.files.map(file => samples.loadFile(file));
  await tick();
  for (const variant of [5, 3, 1, 4, 2]) { pending.get(`step-stone-${variant}`)(); await tick(); }
  await Promise.all(loading);
  // Expectations use filename order, while the decoded list uses completion order.
  const corrections = [0, .4, -3, -3, .6];
  for (let i = 0; i < 5; i++) {
    h.audio.random = () => (i + .1) / 5;
    h.audio.sound('step:stone', { vary: 0 });
    const voice = h.audio.live.at(-1), variant = voice.source.buffer.variant;
    const expected = 10 ** ((-18 + corrections[variant - 1]) / 20);
    assert.ok(Math.abs(voice.env.gain.value - expected) < 1e-12, `stone variant ${variant}`);
  }
});

test('a missing step variant does not shift the correction onto another file', async () => {
  const h = setup({ missing: ['step-leaves-2'] });
  h.audio.unlock();
  await frames(h, gameAt(), 40);
  for (const [name, random, variant, db] of [
    ['step:leaves', .26, 3, -16], ['step:leaves', .01, 1, -19],
    ['step:rug', .61, 4, -18], ['step:rug', .01, 1, -21],
    ['beetle:notice', .01, 1, -8],
  ]) {
    h.audio.random = () => random;
    h.audio.sound(name, { vary: 0 });
    const voice = h.audio.live.at(-1);
    assert.equal(voice.source.buffer.variant, variant, name);
    assert.ok(Math.abs(voice.env.gain.value - 10 ** (db / 20)) < 1e-12, `${name} variant ${variant}`);
  }
});
const monk = (extra = {}) => ({ x: 0, y: 0, dx: 0, dy: 1, hp: 100, distance: 0, dashTime: 0, attack: null, ...extra });
const gameAt = (extra = {}) => ({ phase: 'playing', events: [], enemies: [], locationId: 'road',
  world: { paving: [] }, player: monk(), ...extra });
async function frames(h, game, count) {
  for (let i = 0; i < count; i++) { h.context.advance(1 / 60); h.audio.frame(game); game.events = []; await tick(); }
}

test('60 required recorded files and optional weapons have lowercase hyphenated asset names', () => {
  const names = Object.keys(SOUNDS).filter(name => !SOUNDS[name].optional);
  assert.deepEqual(names.filter(n => n.startsWith('step:')), SURFACES.map(s => `step:${s}`));
  for (const kind of ['hound', 'wraith', 'beetle']) {
    for (const action of ['notice', 'attack', 'hurt', 'death']) assert.ok(SOUNDS[`${kind}:${action}`], `${kind}:${action}`);
    // The frequent cries have three variants, the rare ones two.
    assert.equal(SOUNDS[`${kind}:attack`].count, 3);
    assert.equal(SOUNDS[`${kind}:hurt`].count, 3);
  }
  for (const surface of SURFACES) assert.ok(SOUNDS[`step:${surface}`].count >= 4 && SOUNDS[`step:${surface}`].count <= 6);
  const urls = names.flatMap(name => Array.from({ length: SOUNDS[name].count }, (_, i) => soundUrl(name, i + 1)));
  assert.equal(urls.length, 60);
  let total = 0;
  for (const url of urls) {
    assert.match(url, /\/assets\/game\/sfx\/[a-z]+-[a-z]+-\d\.m4a$/);
    const size = statSync(fileURLToPath(url)).size;
    assert.ok(size > 2000 && size < 40000, `${url}: ${size} bytes`);
    total += size;
  }
  assert.ok(total < 1e6, `${total} bytes`);
  // No stray file: the directory holds exactly the table's files.
  const optional = Object.keys(SOUNDS).filter(name => SOUNDS[name].optional)
    .flatMap(name => Array.from({ length: SOUNDS[name].count }, (_, i) => soundUrl(name, i + 1))).filter(url => existsSync(fileURLToPath(url)));
  assert.deepEqual(readdirSync(SFX_DIR).filter(f => !f.startsWith('.')).sort(), [...urls, ...optional].map(u => u.split('/').at(-1)).sort());
});

test('the boot preloader never fetches the recorded sounds', () => {
  const files = gameFiles({ appearance: normalizeAppearance(), unit: 2, pixelRatio: 2 });
  assert.ok(!files.some(url => /sfx/.test(url)), files.filter(url => /sfx/.test(url)).join());
  const splash = readFileSync(new URL('../src/boot-splash.js', import.meta.url), 'utf8');
  assert.ok(!/sfx/.test(splash.replace(/^\s*\/\/.*$/gm, '')), 'boot-splash.js does not import the sound effects');
});

test('files load after the first frame: steps first, three at a time, every file once', async () => {
  const h = setup({ held: true }), game = gameAt();
  h.audio.frame(game);
  assert.equal(h.audio.context, null);
  assert.deepEqual(h.fetched, [], 'nothing before the unlock');
  h.audio.unlock();
  assert.deepEqual(h.fetched, [], 'nothing before the first frame');
  await frames(h, game, 5);
  assert.deepEqual(h.fetched, ['step-grass-1', 'step-grass-2', 'step-grass-3']);
  assert.equal(SFX.parallel, 3);
  for (let i = 0; i < 100 && h.fetched.length < 60; i++) { h.release(); await frames(h, game, 1); }
  h.release(); await frames(h, game, 3);
  assert.equal(h.fetched.length, 60);
  assert.equal(new Set(h.fetched).size, 60);
  // All steps load before the first monster voice.
  assert.ok(h.fetched.slice(0, 30).every(f => f.startsWith('step-')));
  assert.ok(h.audio.samples.files.every(f => f.state === 'ready'));
  // Memory: 60 mono buffers of 0.3 s at the fake context's 8 kHz, four bytes a sample.
  assert.equal(h.audio.samples.bytes, 60 * 2400 * 4);
  await frames(h, game, 10);
  assert.equal(h.fetched.length, 60, 'nothing is fetched twice');
});

test('a phone decodes the recorded sounds at 32 kHz, a desktop at the context rate', async () => {
  for (const [coarse, rate] of [[true, MUSIC.phoneRate], [false, null]]) {
    const h = setup({ coarse }), game = gameAt();
    h.audio.unlock();
    await frames(h, game, 30);
    assert.equal(h.decoded.length, 60);
    assert.ok(h.decoded.every(d => d.rate === rate), `coarse ${coarse}`);
  }
});

test('a missing, failed or broken file leaves only that variant silent, with no error and no retry', async () => {
  const grass = Array.from({ length: 5 }, (_, i) => `step-grass-${i + 1}`);
  const h = setup({ fail: grass, missing: ['step-earth-2'], broken: ['hound-hurt-1', 'hound-hurt-2', 'hound-hurt-3'] });
  const game = gameAt();
  h.audio.unlock();
  await frames(h, game, 30);
  const samples = h.audio.samples;
  assert.equal(samples.files.filter(f => f.state === 'failed').length, 9);
  assert.equal(samples.buffers['step:earth'].length, 4);
  // Every grass file failed: grass steps are silent; earth plays its other variants.
  const before = h.context.started.length;
  assert.equal(h.audio.sound('step:grass', { priority: 'step' }), 0);
  assert.equal(h.audio.voice(game, 'hound', 'hurt', { x: 1, y: 0 }), 0);
  assert.equal(h.context.started.length, before);
  assert.equal(h.audio.sound('step:earth', { priority: 'step' }), 1);
  assert.equal(h.context.started.length, before + 1);
  await frames(h, game, 30);
  assert.equal(h.fetched.length, 60, 'a failed file is never fetched again');
  // A sound that is not in the table, or a missing bank, is silent too.
  assert.equal(h.audio.sound('step:lava'), 0);
  const bare = setup({ samples: null });
  bare.audio.unlock();
  assert.equal(bare.audio.sound('step:grass'), 0);
  assert.doesNotThrow(() => bare.audio.frame(gameAt()));
});

test('ground art sets the surface over the mask: rug, gravel, leaves, slabs, moss and grave earth', () => {
  const game = createAdventure({}, { seed: 7 });
  // A mask that says stone everywhere: only ground art can change the answer.
  const stone = { origin: { x: -200, y: -200 }, pixelsPerUnit: .01, width: 4, height: 4, data: new Uint8Array(64).map((_, i) => i % 4 === 2 ? 255 : 0) };
  const seen = new Set();
  for (const zone of game.world.zones) for (const p of zone.setDressing ?? []) {
    if (p.layer !== 'ground' || !p.area) continue;
    // Every walkable ground drawing with an area has a surface.
    assert.ok(DECAL_SURFACES[p.kind], `${p.kind} in ${zone.id} has no surface`);
    assert.equal(surfaceAt(game, p.contact.x, p.contact.y, stone), DECAL_SURFACES[p.kind], p.id);
    seen.add(`${zone.id}:${DECAL_SURFACES[p.kind]}`);
  }
  for (const place of ['camp:rug', 'orchard:gravel', 'orchard:leaves', 'courtyard:gravel', 'cemetery:stone', 'cemetery:earth']) {
    assert.ok(seen.has(place), place);
  }
  // The camp rug covers 2.2 × 3 u around its contact; just past its edge the mask answers again.
  const rug = game.world.zones.find(z => z.id === 'camp').setDressing.find(p => p.kind === 'woven-carpet').contact;
  assert.equal(surfaceAt(game, rug.x + 2.1, rug.y - 2.9, stone), 'rug');
  assert.equal(surfaceAt(game, rug.x + 2.3, rug.y, stone), 'stone');
});

test('footsteps follow the ground under the monk: grass, then the rug, then gravel', () => {
  const h = setup({ samples: LoadedSamples });
  h.audio.unlock();
  const decal = (kind, x) => ({ kind, layer: 'ground', contact: { x, y: 0 }, area: { halfWidth: .5, halfDepth: .5 } });
  const game = gameAt({ world: { paving: [], zones: [{ id: 'test', setDressing: [decal('woven-carpet', 10), decal('gravel-path', 20)] }] } });
  const grass = { origin: { x: -1, y: -1 }, pixelsPerUnit: 1, width: 40, height: 2, data: new Uint8Array(320).map((_, i) => i % 4 === 0 ? 255 : 0) };
  h.audio.frame(game, grass);
  const stride = GAITS.monk.key * 3;
  for (const x of [0, 10, 20]) {
    game.player.x = x;
    game.player.distance += stride;
    h.context.advance(1 / 60);
    h.audio.frame(game, () => grass);
  }
  const steps = h.sounds.filter(s => s.name.startsWith('step:'));
  assert.deepEqual(steps.map(s => s.name), ['step:grass', 'step:rug', 'step:gravel']);
  assert.ok(steps.every(s => s.method === 'sound' && s.priority === 'step'));
  // Each step is one recorded buffer at the foot's pitch.
  const sources = h.context.started.filter(s => s.buffer);
  assert.deepEqual(sources.map(s => s.buffer.name), ['step:grass', 'step:rug', 'step:gravel']);
  assert.ok(Math.abs(sources[0].playbackRate.value - 1.03) < .06 && Math.abs(sources[1].playbackRate.value - .97) < .06);
});

test('each monster kind cries in the game\'s own events: notice, attack, hurt and death', () => {
  const h = setup({ samples: LoadedSamples });
  h.audio.unlock();
  const hound = { id: 'h', kind: 'hound', hp: 30, x: 2, y: 0 }, wraith = { id: 'w', kind: 'wraith', hp: 30, x: 0, y: 3 },
    beetle = { id: 'b', kind: 'beetle', hp: 30, x: -2, y: 0 }, ritual = { id: 'r', kind: 'ritual', hp: 30, x: 0, y: -3 };
  const game = gameAt({ enemies: [hound, wraith, beetle, ritual] });
  const step = events => {
    h.context.advance(2);
    game.events = events;
    const before = h.sounds.length;
    h.audio.frame(game);
    return h.sounds.slice(before).map(s => s.name);
  };
  // As src/game.js emits them: a wanderer's alert and a hound's windup carry no id, only a place.
  assert.deepEqual(step([{ type: 'alert', x: 2, y: 0 }, { type: 'alert', x: 0, y: 3 }, { type: 'alert', x: -2, y: 0 }]),
    ['hound:notice', 'wraith:notice', 'beetle:notice']);
  assert.deepEqual(step([{ type: 'alert', x: 2, y: 0, id: 'h', packId: 'p' }]), ['hound:notice']);
  assert.deepEqual(step([{ type: 'windup', x: 2, y: 0, dx: -1, dy: 0 }, { type: 'windup', x: 0, y: 3, id: 'w', kind: 'wraith' },
    { type: 'windup', x: -2, y: 0, id: 'b', kind: 'beetle' }]), ['hound:attack', 'wraith:attack', 'beetle:attack']);
  // The strike itself keeps its synthesized layer; the shot is silent as before.
  assert.deepEqual(step([{ type: 'leap', x: 2, y: 0 }, { type: 'shot', x: 0, y: 3, id: 'shot-1' }, { type: 'slam', x: -2, y: 0, id: 'b' }]),
    ['leap', 'slam']);
  assert.deepEqual(step(['h', 'w', 'b'].map(id => ({ type: 'impact', id, x: 0, y: 0, source: 'combo', strength: 'light' }))),
    ['impact:flesh', 'hound:hurt', 'impact:spirit', 'wraith:hurt', 'impact:shell', 'beetle:hurt']);
  // A killing blow: the death cry, no hurt cry. The ritual source keeps its synthesized death.
  assert.deepEqual(step(['h', 'w', 'b', 'r'].flatMap(id => [{ type: 'impact', id, x: 0, y: 0, source: 'combo', strength: 'light' },
    { type: 'death', id, x: 0, y: 0 }])), ['impact:flesh', 'hound:death', 'impact:spirit', 'wraith:death',
    'impact:shell', 'beetle:death', 'impact:crystal', 'death']);
  const cries = h.sounds.filter(s => s.method === 'sound');
  assert.ok(cries.every(s => s.priority === 'monster'));
  // The hurt cry trails its hit.
  assert.ok(cries.filter(s => s.name.endsWith(':hurt')).every(s => s.delay === MONSTER_VOICES.delay.hurt));
});

test('a cry fades with distance, waits its cooldown and changes its variant', () => {
  const h = setup({ samples: LoadedSamples });
  h.audio.unlock();
  const game = gameAt();
  const gains = [2, 8, 15.9].map(x => {
    h.context.advance(2);
    h.audio.voice(game, 'hound', 'notice', { x, y: 0 });
    return h.sounds.at(-1).gain;
  });
  assert.ok(gains[0] > gains[1] && gains[1] > gains[2] && gains[2] > 0, gains.join());
  assert.equal(gains[0], (1 - 2 / MONSTER_VOICES.range) ** 1.5);
  h.context.advance(2);
  assert.equal(h.audio.voice(game, 'hound', 'notice', { x: MONSTER_VOICES.range, y: 0 }), 0, 'silent past the range');
  // Hurt cries of one kind: one per cooldown, a different file each time.
  h.context.advance(2);
  const sources = () => h.context.started.filter(s => s.buffer?.name === 'beetle:hurt');
  assert.equal(h.audio.voice(game, 'beetle', 'hurt', { x: 1, y: 0 }), 1);
  assert.equal(h.audio.voice(game, 'beetle', 'hurt', { x: 1, y: 0 }), 0);
  h.context.advance(MONSTER_VOICES.cooldown.hurt / 2);
  assert.equal(h.audio.voice(game, 'beetle', 'hurt', { x: 1, y: 0 }), 0);
  assert.equal(h.audio.voice(game, 'hound', 'hurt', { x: 1, y: 0 }), 1, 'each kind has its own cooldown');
  h.context.advance(MONSTER_VOICES.cooldown.hurt);
  assert.equal(h.audio.voice(game, 'beetle', 'hurt', { x: 1, y: 0 }), 1);
  const [first, second] = sources();
  assert.notEqual(first.buffer.variant, second.buffer.variant);
  // Muted: no cry, and the cooldown does not start.
  h.audio.setMuted(true);
  h.context.advance(2);
  assert.equal(h.audio.voice(game, 'wraith', 'death', { x: 1, y: 0 }), 0);
  h.audio.setMuted(false);
  assert.equal(h.audio.voice(game, 'wraith', 'death', { x: 1, y: 0 }), 1);
});

test('a phone caps the cries below the hits, and a finished cry hands its gain back', () => {
  const h = setup({ coarse: true, samples: LoadedSamples });
  h.audio.unlock();
  let played = 0;
  for (let i = 0; i < 20; i++) played += h.audio.sound('wraith:death', { priority: 'monster' });
  assert.equal(played, MOBILE_VOICE_LIMITS.monster);
  // The hits still have room above the cries.
  assert.ok(h.audio.cue('impact:flesh') > 0);
  const gains = h.context.nodes.filter(n => n.kind === 'gain').length;
  h.context.advance(1);
  assert.equal(h.audio.sound('wraith:death', { priority: 'monster' }), 1);
  // The new cry reuses a pooled gain: one new node, its buffer source.
  assert.equal(h.context.nodes.filter(n => n.kind === 'gain').length, gains);
});
