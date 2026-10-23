import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/audio.js';
import { MUSIC, STEP, LOOP_STEPS, LAYERS, THEMES, composeScore, midiOf } from '../src/music.js';
import { FakeContext } from './helpers/fake-audio-context.js';

function setup() {
  let context;
  const audio = new GameAudio({ AudioContext: class { constructor() { context = new FakeContext(); return context; } }, random: () => .5 });
  audio.unlock();
  const music = audio.music, names = new Map(LAYERS.map(name => [music.layers[name], name])), notes = [], cues = [];
  const note = music.note;
  music.note = function(spec, t, layer) { notes.push({ ...spec, t, layer: names.get(layer) ?? 'sting' }); return note.call(this, spec, t, layer); };
  const cue = audio.cue;
  audio.cue = function(name, options) { cues.push(name); return cue.call(this, name, options); };
  return { audio, music, context, notes, cues };
}
const gameAt = (extra = {}) => ({ phase: 'playing', events: [], enemies: [], adventure: {}, locationId: 'camp',
  player: { x: 0, y: 0, hp: 100, distance: 0, dashTime: 0, attack: null }, ...extra });
// Renders frames at 60 per second; `each` may change the game first.
function play(h, game, seconds, { mode = 'playing', fps = 60, each } = {}) {
  for (let i = 0, frames = Math.round(seconds * fps); i < frames; i++) {
    h.context.advance(1 / fps);
    each?.(game, h.context.currentTime);
    h.audio.frame(game, undefined, mode);
    game.events = [];
  }
}
const targets = h => Object.fromEntries(LAYERS.map(name => [name, h.music.layers[name].target]));
const layersBetween = (h, from, to) => new Set(h.notes.filter(n => n.t >= from && n.t < to).map(n => n.layer));

test('music starts only after unlock and plays under the shared limiter', () => {
  const silent = new GameAudio({ AudioContext: null });
  silent.frame(gameAt(), undefined, 'playing');
  assert.equal(silent.music, undefined);
  const h = setup();
  assert.deepEqual(h.music.bus.outputs, [h.audio.bus]);
  // One held oscillator: the shared vibrato. Everything else is a short note.
  assert.equal(h.context.started.length, 1);
  assert.ok(h.music.persistent.every(o => o.stoppedAt === undefined));
});

test('each area picks its layers and crossfades', () => {
  const h = setup(), game = gameAt();
  play(h, game, 1);
  assert.deepEqual(targets(h), { camp: 1, road: 0, court: 0, combat: 0 });
  assert.deepEqual(h.music.layers.camp.node.gain.calls.at(-1).slice(0, 2), ['target', 1]);
  assert.equal(h.music.layers.camp.node.gain.calls.at(-1)[3], MUSIC.fade.zone);
  play(h, game, 9);
  assert.deepEqual([...layersBetween(h, 0, 10)], ['camp']);
  const switchedAt = h.context.currentTime;
  game.locationId = 'road';
  play(h, game, 20);
  assert.deepEqual(targets(h), { camp: 0, road: 1, court: 0, combat: 0 });
  // The camp lullaby rings on while it fades, then stops booking notes.
  const fadeEnd = switchedAt + MUSIC.fade.zone * 7;
  assert.ok(layersBetween(h, switchedAt, fadeEnd).has('camp'));
  assert.deepEqual([...layersBetween(h, fadeEnd + .5, switchedAt + 20)], ['road']);
  assert.ok(h.notes.some(n => n.layer === 'road' && n.voice === 'lead'));
  game.locationId = 'courtyard';
  play(h, game, 20);
  assert.deepEqual(targets(h), { camp: 0, road: 0, court: 1, combat: 0 });
  assert.ok(h.notes.some(n => n.layer === 'court' && n.voice === 'square'));
  assert.ok(h.notes.some(n => n.layer === 'court' && n.voice === 'bell'));
});

test('combat fades in near an awake pack and out after a 3 s hold', () => {
  const h = setup();
  const hound = { id: 1, kind: 'hound', hp: 64, x: 5, y: 0, state: 'chase' };
  const game = gameAt({ locationId: 'road', enemies: [hound, { id: 2, kind: 'beetle', hp: 160, x: 30, y: 0, state: 'chase' }] });
  play(h, game, .1);
  assert.equal(h.music.layers.combat.target, MUSIC.combatLevel);
  // The road theme steps back while the fight plays over it.
  assert.equal(h.music.layers.road.target, MUSIC.areaInCombat);
  assert.deepEqual(h.music.layers.combat.node.gain.calls.at(-1).slice(0, 2), ['target', MUSIC.combatLevel]);
  assert.equal(h.music.layers.combat.node.gain.calls.at(-1)[3], MUSIC.fade.combatIn);
  play(h, game, 4);
  for (const voice of ['pulse', 'bass', 'kick', 'snare', 'hat']) assert.ok(h.notes.some(n => n.layer === 'combat' && n.voice === voice), voice);
  // The fight ends: the layer holds for 3 s, then fades with a 1 s time constant.
  hound.hp = 0;
  const endedAt = h.context.currentTime;
  play(h, game, 2.9);
  assert.equal(h.music.layers.combat.target, MUSIC.combatLevel);
  play(h, game, .2);
  assert.equal(h.music.layers.combat.target, 0);
  assert.equal(h.music.layers.road.target, 1);
  assert.deepEqual(h.music.layers.combat.node.gain.calls.at(-1).slice(0, 2), ['target', 0]);
  assert.equal(h.music.layers.combat.node.gain.calls.at(-1)[3], MUSIC.fade.combatOut);
  play(h, game, 10);
  assert.ok(!layersBetween(h, endedAt + 3.1 + 7 * MUSIC.fade.combatOut + .5, h.context.currentTime).has('combat'));
  // A far pack, a returning pack and a sleeping pack are not a fight; a hit is.
  for (const enemy of [{ x: 20, y: 0, state: 'chase' }, { x: 4, y: 0, state: 'chase', returning: true }, { x: 4, y: 0, state: 'idle' }]) {
    game.enemies = [{ id: 3, kind: 'hound', hp: 64, ...enemy }];
    play(h, game, 1);
    assert.equal(h.music.layers.combat.target, 0, JSON.stringify(enemy));
  }
  game.events = [{ type: 'hurt' }];
  h.audio.frame(game, undefined, 'playing');
  assert.equal(h.music.layers.combat.target, MUSIC.combatLevel);
});

test('pause ducks the music and drops the fight; the keep-alive fades a stalled loop', () => {
  const h = setup();
  const game = gameAt({ locationId: 'road', enemies: [{ id: 1, kind: 'hound', hp: 64, x: 3, y: 0, state: 'chase' }] });
  play(h, game, 1);
  const bus = h.music.bus.gain;
  assert.equal(h.music.level, MUSIC.level);
  play(h, game, 1, { mode: 'paused' });
  assert.equal(h.music.level, MUSIC.level * MUSIC.pauseDuck);
  assert.equal(h.music.layers.combat.target, 0);
  assert.ok(bus.calls.some(call => call[0] === 'target' && call[1] === MUSIC.level * MUSIC.pauseDuck && call[3] === MUSIC.fade.duck));
  play(h, game, 1);
  assert.equal(h.music.level, MUSIC.level);
  assert.equal(h.music.layers.combat.target, MUSIC.combatLevel);
  // Every re-arm ends in a fade to silence just past the next expected pump.
  const now = h.context.currentTime, [cancel, level, silence] = bus.calls.slice(-3);
  assert.equal(cancel[0], 'cancel');
  assert.deepEqual(level.slice(0, 2), ['target', MUSIC.level]);
  assert.deepEqual(silence.slice(0, 2), ['target', 0]);
  assert.ok(silence[2] > now && silence[2] <= now + MUSIC.keepAlive);
});

test('mute books no notes and unmute resumes in phase', () => {
  const h = setup(), game = gameAt({ locationId: 'road' });
  play(h, game, 2);
  h.audio.setMuted(true);
  const started = h.context.started.length, booked = h.notes.length;
  play(h, game, 20);
  assert.equal(h.context.started.length, started);
  assert.equal(h.notes.length, booked);
  h.audio.setMuted(false);
  play(h, game, 2);
  assert.ok(h.notes.length > booked);
  // The step clock kept running while muted: the score stays on the beat.
  assert.ok(Math.abs(h.music.step * STEP - (h.context.currentTime + MUSIC.lookahead)) < STEP * 2);
});

test('the themes are modal, phrase-shaped and close on their tonic', () => {
  const pc = midi => ((midi % 12) + 12) % 12;
  const score = composeScore();
  const pitched = layer => score[layer].flat().filter(n => n.midi != null);
  for (const [layer, theme] of Object.entries(THEMES)) {
    for (const note of pitched(layer)) assert.ok(theme.scale.includes(pc(note.midi)), `${layer} ${theme.key}: ${note.voice} ${note.midi}`);
    assert.equal(theme.melody.length, MUSIC.bars);
    assert.equal(theme.chords.length, MUSIC.bars);
  }
  // Combat stays on the notes both D modes share: D, E, G, A, C.
  for (const note of pitched('combat')) assert.ok([2, 4, 7, 9, 0].includes(pc(note.midi)), `combat ${note.midi}`);
  // Each line ends on its tonic: G for the camp, D for the road and the courtyard.
  const lastNote = layer => THEMES[layer].melody.at(-1).at(-1).midi;
  assert.equal(pc(lastNote('camp')), 7);
  assert.equal(pc(lastNote('road')), 2);
  assert.equal(pc(lastNote('court')), 2);
  // Forms: the camp is A B A B; the road and the courtyard are A A' B A.
  const bars = (layer, from, to) => THEMES[layer].melody.slice(from, to);
  assert.deepEqual(bars('camp', 16, 32), bars('camp', 0, 16));
  for (const layer of ['road', 'court']) {
    assert.deepEqual(bars(layer, 24, 32), bars(layer, 0, 8));
    assert.deepEqual(bars(layer, 8, 12), bars(layer, 0, 4));
    assert.notDeepEqual(bars(layer, 12, 16), bars(layer, 4, 8));
  }
  // The road theme opens on A4 and leaps to D5; the lead stays inside E4–A5.
  assert.deepEqual(THEMES.road.melody[0].slice(0, 2).map(n => n.midi), [midiOf('A4'), midiOf('D5')]);
  for (const note of THEMES.road.melody.flat()) assert.ok(note.midi >= midiOf('E4') && note.midi <= midiOf('A5'));
});

test('the score is seeded and loops seamlessly', () => {
  assert.deepEqual(composeScore(7), composeScore(7));
  assert.notDeepEqual(composeScore(7), composeScore(8));
  // Seeds vary only ornaments: the road lead is the authored theme for every seed.
  const lead = seed => composeScore(seed).road.flat().filter(n => n.voice === 'lead').map(n => n.midi);
  assert.deepEqual(lead(7), lead(8));
  // Two loops in the camp: the second books the same notes one loop later.
  const h = setup(), game = gameAt();
  const loop = LOOP_STEPS * STEP;
  play(h, game, loop * 2 + 1, { fps: 30 });
  const start = h.music.nextTime - h.music.step * STEP;
  const inLoop = k => h.notes.filter(n => n.t >= start + k * loop - 1e-6 && n.t < start + (k + 1) * loop - 1e-6)
    .map(n => [n.voice, n.midi, Math.round((n.t - start - k * loop) * 1000)]);
  assert.ok(inLoop(0).length > 200);
  assert.deepEqual(inLoop(1), inLoop(0));
});

test('victory and defeat play a sting and settle the layers', () => {
  const h = setup(), game = gameAt({ locationId: 'courtyard' });
  play(h, game, 1);
  game.phase = 'victory';
  game.events = [{ type: 'victory' }];
  h.audio.frame(game, undefined, 'playing');
  game.events = [];
  const sting = h.notes.filter(n => n.layer === 'sting');
  assert.deepEqual(sting.filter(n => n.voice === 'lead').map(n => n.midi), ['D5', 'F#5', 'A5', 'D6'].map(midiOf));
  assert.ok(sting.some(n => n.voice === 'harp') && sting.some(n => n.voice === 'bass'));
  assert.ok(!h.cues.includes('chime'));
  play(h, game, 1, { mode: 'victory' });
  assert.deepEqual(targets(h), { camp: 1, road: 0, court: 0, combat: 0 });
  assert.equal(h.music.level, MUSIC.level);
  const next = gameAt({ locationId: 'road', phase: 'defeat', events: [{ type: 'defeat' }] });
  h.audio.frame(next, undefined, 'playing');
  next.events = [];
  const fall = h.notes.filter(n => n.layer === 'sting').slice(sting.length);
  assert.deepEqual(fall.filter(n => n.voice === 'square').map(n => n.midi), ['A4', 'F4', 'D4', 'C#4', 'D4'].map(midiOf));
  play(h, next, 1, { mode: 'defeat' });
  assert.deepEqual(targets(h), { camp: .4, road: 0, court: 0, combat: 0 });
  // A fresh run returns to the area's music.
  const fresh = gameAt({ locationId: 'road' });
  play(h, fresh, .1);
  assert.deepEqual(targets(h), { camp: 0, road: 1, court: 0, combat: 0 });
});

test('a stall skips the missed steps instead of bursting', () => {
  const h = setup(), game = gameAt({ locationId: 'road' });
  play(h, game, 2);
  const booked = h.notes.length, step = h.music.step;
  h.context.advance(5);
  h.audio.frame(game, undefined, 'playing');
  // Only the lookahead window is booked: at most three steps of the score.
  const late = h.notes.slice(booked), now = h.context.currentTime;
  assert.ok(late.every(n => n.t >= now - 1e-9 && n.t < now + MUSIC.lookahead));
  assert.ok(new Set(late.map(n => n.t)).size <= Math.ceil(MUSIC.lookahead / STEP));
  assert.ok(h.music.step - step >= Math.floor(5 / STEP));
});

test('ten minutes of adaptive music leave no nodes behind', () => {
  const h = setup();
  const hound = { id: 1, kind: 'hound', hp: 64, x: 4, y: 0, state: 'idle' };
  const game = gameAt({ enemies: [hound] });
  const held = h.context.connected();
  const zones = ['camp', 'road', 'courtyard'];
  const samples = [];
  play(h, game, 600, { fps: 30, each: (g, now) => {
    g.locationId = zones[Math.floor(now / 40) % 3];
    hound.state = Math.floor(now / 25) % 2 ? 'chase' : 'idle';
    if (Math.abs(now % 60) < 1 / 30) samples.push(h.context.connected());
  } });
  assert.ok(h.notes.length > 2000, `${h.notes.length} notes`);
  // Connected nodes: the held graph plus whatever is still ringing, never growing.
  for (const count of samples) assert.ok(count - held < 120, `${count - held} live note nodes`);
  assert.ok(Math.max(...samples.slice(-3)) <= Math.max(...samples.slice(0, 4)) + 40);
});
