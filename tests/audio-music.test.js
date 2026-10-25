import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GameAudio } from '../src/audio.js';
import { MUSIC, Music, TRACKS, TRACK_NAMES, ZONE_TRACKS, equalPower, zoneTrack } from '../src/music.js';
import { gameFiles } from '../src/boot-splash.js';
import { normalizeAppearance } from '../src/appearance.js';
import { FakeContext } from './helpers/fake-audio-context.js';

// Music with a fake network and a fake decoder. A file's bytes carry its track index, so the
// decoder knows which track it got. `fail` rejects a fetch, `missing` answers 404, `broken`
// fails the decode; `held` fetches wait until release(name).
function setup({ coarse = false, fail = [], missing = [], broken = [], held = [] } = {}) {
  let context;
  const fetched = [], decoded = [], waiting = new Map(), cues = [];
  const fetchFile = async url => {
    const name = /music-([a-z]+)\.m4a$/.exec(url)[1];
    fetched.push(name);
    if (held.includes(name)) await new Promise(resolve => waiting.set(name, resolve));
    if (fail.includes(name)) throw new TypeError('Failed to fetch');
    return { ok: !missing.includes(name), status: missing.includes(name) ? 404 : 200,
      arrayBuffer: async () => new Uint8Array([TRACK_NAMES.indexOf(name), 0, 0, 0]).buffer };
  };
  const decode = async (bytes, rate) => {
    const name = TRACK_NAMES[new Uint8Array(bytes)[0]];
    decoded.push({ name, rate });
    if (broken.includes(name)) throw new DOMException('Unable to decode audio data', 'EncodingError');
    return { name, sampleRate: rate ?? context.sampleRate, duration: TRACKS[name].loopSeconds + .2, numberOfChannels: 2 };
  };
  class TestMusic extends Music { constructor(c, options) { super(c, { ...options, fetchFile, decode }); } }
  const audio = new GameAudio({ AudioContext: class { constructor() { context = new FakeContext(); return context; } },
    random: () => .5, music: TestMusic, matchMedia: () => ({ matches: coarse }) });
  audio.unlock();
  const cue = audio.cue;
  audio.cue = function(name, options) { cues.push(name); return cue.call(this, name, options); };
  return { audio, music: audio.music, context, fetched, decoded, cues, release: name => waiting.get(name)?.() };
}
const gameAt = (extra = {}) => ({ phase: 'playing', events: [], enemies: [], adventure: {}, locationId: 'camp',
  player: { x: 0, y: 0, hp: 100, distance: 0, dashTime: 0, attack: null }, ...extra });
// Lets fetches and decodes settle between frames, as the browser would.
const tick = () => new Promise(resolve => setImmediate(resolve));
// Renders frames at 60 per second; `each` may change the game first.
async function play(h, game, seconds, { mode = 'playing', fps = 60, each } = {}) {
  for (let i = 0, frames = Math.round(seconds * fps); i < frames; i++) {
    h.context.advance(1 / fps);
    each?.(game, h.context.currentTime);
    h.audio.frame(game, undefined, mode);
    game.events = [];
    await tick();
  }
}
const track = (h, name) => h.music.tracks[name];
const sounding = h => TRACK_NAMES.filter(name => track(h, name).source);
const decodedNow = h => TRACK_NAMES.filter(name => track(h, name).buffer);
const lastGainCall = (h, name) => track(h, name).node.gain.calls.at(-1);

test('music starts only after unlock, under the shared limiter, and fetches nothing before the first frame', async () => {
  const silent = new GameAudio({ AudioContext: null });
  silent.frame(gameAt(), undefined, 'playing');
  assert.equal(silent.music, undefined);
  const h = setup();
  assert.deepEqual(h.music.bus.outputs, [h.audio.bus]);
  for (const name of TRACK_NAMES) assert.deepEqual(track(h, name).node.outputs, [h.music.bus]);
  assert.deepEqual(h.fetched, []);
  assert.equal(h.context.started.length, 0, 'no source before a file is decoded');
  await play(h, gameAt(), 1 / 60);
  assert.deepEqual(h.fetched, ['camp']);
});

test('every zone has its own track: a looping AAC file in assets/game/music under 1.6 MB', () => {
  assert.deepEqual(TRACK_NAMES, ['camp', 'road', 'courtyard', 'cemetery', 'orchard', 'combat']);
  assert.deepEqual(ZONE_TRACKS, { camp: 'camp', road: 'road', courtyard: 'courtyard', cemetery: 'cemetery', orchard: 'orchard' });
  assert.equal(zoneTrack('cemetery'), 'cemetery');
  assert.equal(zoneTrack('orchard'), 'orchard');
  assert.equal(zoneTrack('somewhere-new'), null);
  for (const [name, spec] of Object.entries(TRACKS)) {
    assert.match(spec.url, new RegExp(`/assets/game/music/music-${name}\\.m4a$`));
    const size = statSync(fileURLToPath(spec.url)).size;
    assert.ok(size > 500e3 && size <= 1.6e6, `${name} ${size} bytes`);
    assert.ok(spec.loopSeconds >= 60 && spec.loopSeconds <= 100, `${name} loops ${spec.loopSeconds} s`);
    assert.equal(spec.loopStart, .1);
  }
});

test('the boot preloader never fetches music: the files load after the world starts', () => {
  const files = gameFiles({ appearance: normalizeAppearance(), unit: 2, pixelRatio: 2 });
  assert.ok(files.length > 10);
  assert.ok(!files.some(url => /music/.test(url)), files.filter(url => /music/.test(url)).join());
  const splash = readFileSync(new URL('../src/boot-splash.js', import.meta.url), 'utf8');
  assert.ok(!/music/.test(splash.replace(/^\s*\/\/.*$/gm, '')), 'boot-splash.js does not import the music');
});

test('files load lazily: the zone track first, then combat, then the rest, one fetch at a time', async () => {
  const h = setup({ held: ['orchard'] }), game = gameAt({ locationId: 'orchard' });
  await play(h, game, .5);
  assert.deepEqual(h.fetched, ['orchard'], 'one fetch at a time');
  h.release('orchard');
  await play(h, game, 1);
  assert.deepEqual(h.fetched, ['orchard', 'combat', 'camp', 'road', 'courtyard', 'cemetery']);
  // Only the zone track and combat are decoded; the rest stay as bytes.
  assert.deepEqual(h.decoded.map(d => d.name), ['orchard', 'combat']);
  assert.deepEqual(decodedNow(h), ['orchard', 'combat']);
  assert.deepEqual(sounding(h), ['orchard']);
  // Desktop decodes at the context's own rate.
  assert.ok(h.decoded.every(d => d.rate === null));
});

test('a zone change is a 2.5 s equal-power crossfade; the left track stops', async () => {
  const h = setup(), game = gameAt();
  await play(h, game, 4);
  assert.equal(track(h, 'camp').gain, 1);
  assert.deepEqual(lastGainCall(h, 'camp').slice(0, 2), ['target', 1]);
  assert.equal(lastGainCall(h, 'camp')[3], MUSIC.fade.smooth);
  const camp = track(h, 'camp').source;
  assert.deepEqual([camp.buffer.name, camp.loop, camp.loopStart, camp.loopEnd, camp.offset],
    ['camp', true, .1, .1 + TRACKS.camp.loopSeconds, .1]);
  game.locationId = 'road';
  await play(h, game, 1 / 60);
  assert.deepEqual(h.music.mix, { camp: 0, road: 1, courtyard: 0, cemetery: 0, orchard: 0, combat: 0 });
  // Halfway and at every frame: the two gains keep constant power (one frame of decode latency allowed).
  let checked = 0;
  await play(h, game, 2.4, { each: () => {
    const a = track(h, 'camp').gain, b = track(h, 'road').gain;
    if (b > 0) { assert.ok(Math.abs(a * a + b * b - 1) < .06, `camp ${a.toFixed(3)} road ${b.toFixed(3)}`); checked++; }
  } });
  assert.ok(checked > 120);
  await play(h, game, .3);
  assert.deepEqual([track(h, 'camp').gain, track(h, 'road').gain], [0, 1]);
  assert.equal(track(h, 'camp').source, null);
  assert.ok(camp.stoppedAt > 0 && camp.stoppedAt <= h.context.currentTime + .2);
  assert.deepEqual(sounding(h), ['road']);
  // The cemetery and the orchard have their own tracks, not the road's or the courtyard's.
  for (const zone of ['cemetery', 'orchard', 'courtyard']) {
    game.locationId = zone;
    await play(h, game, 3);
    assert.deepEqual(sounding(h), [zone]);
    assert.equal(track(h, zone).gain, 1);
    assert.equal(h.music.mix[zone], 1);
  }
});

test('a late file fades in from silence', async () => {
  const h = setup({ held: ['camp'] }), game = gameAt();
  await play(h, game, 3);
  assert.equal(track(h, 'camp').gain, 0);
  assert.equal(h.context.started.length, 0);
  h.release('camp');
  await play(h, game, .1);
  assert.deepEqual(sounding(h), ['camp']);
  assert.ok(track(h, 'camp').gain > 0 && track(h, 'camp').gain < .15, `gain ${track(h, 'camp').gain}`);
  await play(h, game, 2.5);
  assert.equal(track(h, 'camp').gain, 1);
});

test('combat rises over the ducked zone track and falls after a 3 s hold', async () => {
  const h = setup(), game = gameAt({ locationId: 'road' });
  await play(h, game, 3);
  const hound = { id: 1, kind: 'hound', hp: 64, x: 5, y: 0, state: 'chase' };
  game.enemies = [hound, { id: 2, kind: 'beetle', hp: 160, x: 30, y: 0, state: 'chase' }];
  await play(h, game, 1 / 60);
  assert.equal(h.music.mix.combat, MUSIC.combatLevel);
  // The road track steps back while the fight plays over it; combat starts from its top.
  assert.equal(h.music.mix.road, MUSIC.areaInCombat);
  assert.equal(track(h, 'combat').source.offset, .1);
  await play(h, game, MUSIC.fade.combatIn + .1);
  assert.ok(Math.abs(track(h, 'combat').gain - MUSIC.combatLevel) < 1e-9);
  await play(h, game, 3);
  assert.ok(Math.abs(track(h, 'road').gain - MUSIC.areaInCombat) < .01, `road ${track(h, 'road').gain}`);
  // The fight ends: combat holds for 3 s, then fades out over 3 s and stops; the road comes back.
  hound.hp = 0;
  await play(h, game, 2.9);
  assert.equal(h.music.mix.combat, MUSIC.combatLevel);
  await play(h, game, .2);
  assert.deepEqual([h.music.mix.combat, h.music.mix.road], [0, 1]);
  await play(h, game, MUSIC.fade.combatOut / 2);
  const halfway = track(h, 'combat').gain;
  assert.ok(halfway > .3 && halfway < MUSIC.combatLevel, `combat ${halfway}`);
  await play(h, game, MUSIC.fade.combatOut / 2 + .2);
  assert.equal(track(h, 'combat').gain, 0);
  assert.deepEqual(sounding(h), ['road']);
  assert.ok(track(h, 'road').gain > .99);
  // Combat stays decoded for the next fight, which starts again from the top.
  assert.ok(track(h, 'combat').buffer);
  // A far pack, a returning pack and a sleeping pack are not a fight; a hit is.
  for (const enemy of [{ x: 20, y: 0, state: 'chase' }, { x: 4, y: 0, state: 'chase', returning: true }, { x: 4, y: 0, state: 'idle' }]) {
    game.enemies = [{ id: 3, kind: 'hound', hp: 64, ...enemy }];
    await play(h, game, 1);
    assert.equal(h.music.mix.combat, 0, JSON.stringify(enemy));
  }
  game.events = [{ type: 'hurt' }];
  await play(h, game, 1 / 60);
  assert.equal(h.music.mix.combat, MUSIC.combatLevel);
  assert.equal(track(h, 'combat').source.offset, .1);
});

test('pause ducks the bus and drops the fight; the keep-alive fades a stalled loop; mute keeps the music state', async () => {
  const h = setup();
  const game = gameAt({ locationId: 'road', enemies: [{ id: 1, kind: 'hound', hp: 64, x: 3, y: 0, state: 'chase' }] });
  await play(h, game, 1);
  const bus = h.music.bus.gain;
  assert.equal(h.music.level, MUSIC.level);
  await play(h, game, 1, { mode: 'paused' });
  assert.equal(h.music.level, MUSIC.level * MUSIC.pauseDuck);
  assert.equal(h.music.mix.combat, 0);
  assert.equal(h.music.mix.road, 1);
  assert.ok(bus.calls.some(call => call[0] === 'target' && call[1] === MUSIC.level * MUSIC.pauseDuck && call[3] === MUSIC.fade.duck));
  await play(h, game, 1);
  assert.equal(h.music.level, MUSIC.level);
  assert.equal(h.music.mix.combat, MUSIC.combatLevel);
  // Every re-arm ends in a fade to silence just past the next expected pump.
  const now = h.context.currentTime, [cancel, level, silence] = bus.calls.slice(-3);
  assert.equal(cancel[0], 'cancel');
  assert.deepEqual(level.slice(0, 2), ['target', MUSIC.level]);
  assert.deepEqual(silence.slice(0, 2), ['target', 0]);
  assert.ok(silence[2] > now && silence[2] <= now + MUSIC.keepAlive);
  // Mute silences the master; the music keeps its place and comes back with unmute.
  h.audio.setMuted(true);
  assert.equal(h.music.muted, true);
  assert.deepEqual(h.audio.master.gain.calls.at(-1).slice(0, 2), ['target', 0]);
  game.enemies = [];
  game.locationId = 'camp';
  // The camp starts ducked under the 3 s combat hold, then eases back to full.
  await play(h, game, 10);
  assert.deepEqual(sounding(h), ['camp']);
  h.audio.setMuted(false);
  assert.equal(h.music.muted, false);
  assert.equal(track(h, 'camp').gain, 1);
});

test('a lost, missing or broken file stays silent; the other tracks still play', async () => {
  const h = setup({ fail: ['camp'], missing: ['road'], broken: ['courtyard'] }), game = gameAt();
  await play(h, game, 2);
  assert.equal(track(h, 'camp').state, 'failed');
  assert.deepEqual(sounding(h), []);
  for (const zone of ['road', 'courtyard', 'orchard', 'camp']) {
    game.locationId = zone;
    await play(h, game, 3);
  }
  assert.deepEqual(TRACK_NAMES.filter(name => track(h, name).state === 'failed'), ['camp', 'road', 'courtyard']);
  // Each file is asked for once: a failure is not retried every frame.
  assert.deepEqual(h.fetched.filter(name => name === 'camp'), ['camp']);
  assert.equal(h.fetched.length, TRACK_NAMES.length);
  assert.deepEqual(['camp', 'road', 'courtyard'].map(name => track(h, name).gain), [0, 0, 0]);
  game.locationId = 'orchard';
  await play(h, game, 3);
  assert.deepEqual(sounding(h), ['orchard']);
  assert.equal(track(h, 'orchard').gain, 1);
});

test('zone tracks resume where they stopped; a phone decodes at 32 kHz and frees a left track sooner', async () => {
  const desk = setup(), game = gameAt();
  await play(desk, game, 10);
  game.locationId = 'road';
  await play(desk, game, 10);
  assert.ok(track(desk, 'camp').buffer, 'a desktop keeps a left track decoded for a while');
  game.locationId = 'camp';
  await play(desk, game, 1 / 60);
  // About 10 s in, plus the 2.5 s fade out: the camp continues instead of starting over.
  const resumed = track(desk, 'camp').source.offset - .1;
  assert.ok(resumed > 12 && resumed < 13, `resumed at ${resumed}`);
  await play(desk, game, 40);
  assert.equal(track(desk, 'road').buffer, null, 'freed after MUSIC.keepDecoded.desktop');
  const phone = setup({ coarse: true }), walk = gameAt();
  await play(phone, walk, 4);
  assert.ok(phone.decoded.every(d => d.rate === MUSIC.phoneRate));
  walk.locationId = 'road';
  await play(phone, walk, MUSIC.fade.zone + MUSIC.keepDecoded.phone + .5);
  assert.deepEqual(decodedNow(phone), ['road', 'combat']);
});

test('hopping through every zone keeps at most two zone tracks decoded', async () => {
  const h = setup(), game = gameAt();
  let most = 0;
  for (const zone of ['road', 'courtyard', 'cemetery', 'orchard', 'camp', 'road']) {
    game.locationId = zone;
    for (let i = 0; i < 4 * 60; i++) {
      h.context.advance(1 / 60);
      h.audio.frame(game, undefined, 'playing');
      most = Math.max(most, decodedNow(h).filter(name => name !== 'combat').length);
      await tick();
    }
    assert.deepEqual(sounding(h), [zone]);
  }
  assert.equal(most, MUSIC.zoneBuffers);
  assert.ok(track(h, 'combat').buffer, 'combat stays decoded');
});

test('three zone changes inside one fade keep two zone buffers: the quietest fading track gives way', async () => {
  const h = setup({ coarse: true }), game = gameAt();
  await play(h, game, 4);
  let most = 0;
  const zoneBuffers = () => decodedNow(h).filter(name => name !== 'combat').length;
  // Each zone lasts 0.9 s, well inside the 2.5 s crossfade: camp and road are both still fading
  // when the courtyard, then the cemetery, need a buffer.
  for (const [zone, seconds] of [['road', .9], ['courtyard', .9], ['cemetery', 4]]) {
    game.locationId = zone;
    await play(h, game, seconds, { each: () => { most = Math.max(most, zoneBuffers()); } });
    most = Math.max(most, zoneBuffers());
  }
  assert.equal(most, MUSIC.zoneBuffers);
  // The courtyard took the road's buffer (road was quieter), the cemetery took the camp's.
  for (const name of ['road', 'camp']) {
    assert.equal(track(h, name).buffer, null, name);
    assert.ok(track(h, name).node.gain.calls.some(call => call[0] === 'cancel'), `${name} was cut with a short fade`);
  }
  assert.deepEqual(sounding(h), ['cemetery']);
  assert.equal(track(h, 'cemetery').p, 1);
  assert.ok(track(h, 'combat').buffer, 'combat stays decoded on top');
});

test('victory and defeat settle on the camp track; victory plays the chime', async () => {
  const h = setup(), game = gameAt({ locationId: 'courtyard' });
  await play(h, game, 3);
  game.phase = 'victory';
  game.events = [{ type: 'victory' }];
  await play(h, game, 1 / 60);
  assert.ok(h.cues.includes('chime'));
  await play(h, game, 4, { mode: 'victory' });
  assert.deepEqual(h.music.mix, { camp: 1, road: 0, courtyard: 0, cemetery: 0, orchard: 0, combat: 0 });
  assert.deepEqual(sounding(h), ['camp']);
  assert.equal(h.music.level, MUSIC.level);
  const next = gameAt({ locationId: 'road', phase: 'defeat', events: [{ type: 'defeat' }] });
  await play(h, next, 4, { mode: 'defeat' });
  assert.equal(h.music.mix.camp, .4);
  assert.ok(Math.abs(track(h, 'camp').gain - .4) < .01);
  // A fresh run returns to the area's music.
  const fresh = gameAt({ locationId: 'road' });
  await play(h, fresh, 1 / 60);
  assert.deepEqual(h.music.mix, { camp: 0, road: 1, courtyard: 0, cemetery: 0, orchard: 0, combat: 0 });
});

test('a place without a track is silent, and a game without the adventure plays the road', async () => {
  const h = setup(), game = gameAt();
  await play(h, game, 3);
  game.locationId = 'none';
  await play(h, game, 3);
  assert.deepEqual(Object.values(h.music.mix), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(sounding(h), []);
  game.adventure = null;
  await play(h, game, 3);
  assert.deepEqual(sounding(h), ['road']);
});

test('equal power: two tracks crossing keep their summed power', () => {
  for (let p = 0; p <= 1; p += .05) assert.ok(Math.abs(equalPower(p) ** 2 + equalPower(1 - p) ** 2 - 1) < 1e-9);
  assert.deepEqual([equalPower(-1), equalPower(0), equalPower(1), equalPower(2)], [0, 0, 1, 1]);
});

test('ten minutes of zone changes and fights keep at most three sources and three buffers', async () => {
  for (const coarse of [false, true]) {
    const h = setup({ coarse });
    const hound = { id: 1, kind: 'hound', hp: 64, x: 4, y: 0, state: 'idle' };
    const game = gameAt({ enemies: [hound] });
    const zones = ['camp', 'road', 'courtyard', 'cemetery', 'orchard'];
    let mostSources = 0, mostBuffers = 0;
    const held = h.context.connected(), samples = [];
    await play(h, game, 600, { fps: 30, each: (g, now) => {
      g.locationId = zones[Math.floor(now / 40) % zones.length];
      hound.state = Math.floor(now / 25) % 2 ? 'chase' : 'idle';
      mostSources = Math.max(mostSources, sounding(h).length);
      mostBuffers = Math.max(mostBuffers, decodedNow(h).length);
      if (Math.abs(now % 60) < 1 / 30) samples.push(h.context.connected());
    } });
    assert.ok(mostSources <= 3, `${coarse ? 'phone' : 'desktop'}: ${mostSources} sources`);
    assert.ok(mostBuffers <= 3, `${coarse ? 'phone' : 'desktop'}: ${mostBuffers} buffers`);
    // Connected nodes: the held graph plus at most the sounding sources, never growing.
    for (const count of samples) assert.ok(count - held <= 3, `${count - held} extra connected nodes`);
  }
});
