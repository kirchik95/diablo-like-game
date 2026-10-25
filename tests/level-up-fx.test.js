import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Texture } from '@babylonjs/core';
import { Renderer } from '../src/render.js';
import * as pixels from '../src/pixel-scene.js';
import { PresentationState } from '../src/pixel-animation.js';
import { createGame } from '../src/game.js';
import { LOCATIONS } from '../src/campaign.js';
import { LevelUpLight, LEVEL_UP_LIGHT } from '../src/level-up-fx.js';

const levelUp = level => ({ type: 'level-up', level, hp: 8, spirit: 5, points: 1, pathRow: null });
// A recording 2D context: every call with its arguments and the fill style it used.
function recorder() {
  const calls = [];
  const context = new Proxy({ globalAlpha: 1, fillStyle: '', globalCompositeOperation: 'source-over' }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return text => ({ width: text.length * 5 });
      if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
      return (...args) => {
        assert.ok(args.every(value => typeof value !== 'number' || Number.isFinite(value)), `${String(key)} got non-finite`);
        calls.push({ name: key, args, style: target.fillStyle, alpha: target.globalAlpha });
      };
    },
  });
  return { context, calls };
}
const view = (reducedMotion = false) => ({ x: 316, y: 200, unit: 26.67, rise: 23.1, reducedMotion });

test('level-up events start one burst each; a repeated event object or a quick second level joins, never doubles', () => {
  const light = new LevelUpLight(), first = levelUp(2);
  light.observe([first, { type: 'impact' }]);
  assert.equal(light.active, 1);
  light.observe([first]);
  assert.equal(light.active, 1, 'an event still in the list next frame starts nothing');
  light.update(.1);
  light.observe([levelUp(3)]);
  assert.equal(light.active, 1, 'a level gained within the join window joins the burst');
  assert.equal(light.bursts.find(burst => burst.live).text, 'Новый уровень 3');
  light.update(.3);
  light.observe([levelUp(4)]);
  assert.equal(light.active, 2);
});

test('the burst pool and the mote buffer are fixed; every burst ends after its life', () => {
  const light = new LevelUpLight(), motes = light.motes;
  for (let level = 2; level < 9; level++) { light.observe([levelUp(level)]); light.update(.3); }
  assert.equal(light.bursts.length, LEVEL_UP_LIGHT.bursts);
  assert.ok(light.active <= LEVEL_UP_LIGHT.bursts);
  assert.equal(light.motes, motes, 'the mote buffer is reused');
  assert.equal(motes.length, LEVEL_UP_LIGHT.bursts * LEVEL_UP_LIGHT.motes * 8);
  for (let t = 0; t < LEVEL_UP_LIGHT.life; t += .1) light.update(.1);
  assert.equal(light.active, 0);
  const { context, calls } = recorder();
  light.draw(context, view());
  assert.equal(calls.length, 0, 'nothing draws once the light is out');
});

test('drawing uses a fixed palette and a bounded number of pixel rows; reduced motion has no ring and no motes', () => {
  const palette = new Set(['#ffc35a', '#ffd27a', '#ffe9a8', '#fff6e0', '#ffb347', '#120e18', '#e5b66e', '#f6e7c4']);
  const frames = full => {
    const light = new LevelUpLight();
    light.start(3);
    const counts = [];
    for (let t = 0; t < LEVEL_UP_LIGHT.life; t += 1 / 30) {
      const { context, calls } = recorder();
      light.draw(context, view(!full));
      for (const call of calls) if (call.name === 'fill' || call.name === 'fillRect' || call.name === 'fillText') assert.ok(palette.has(call.style), call.style);
      counts.push({
        rows: calls.filter(call => call.name === 'rect' || call.name === 'fillRect').length,
        fills: calls.filter(call => call.name === 'fill').length,
        // A mote is one pixel or the two strokes of a pixel cross.
        motes: calls.filter(call => call.name === 'fillRect' && ['1,1', '3,1', '1,3'].includes(`${call.args[2]},${call.args[3]}`)).length,
        text: calls.filter(call => call.name === 'fillText').map(call => call.args[0]),
      });
      light.update(1 / 30);
    }
    return counts;
  };
  const full = frames(true), calm = frames(false);
  assert.ok(Math.max(...full.map(frame => frame.rows)) < 1500, 'the busiest frame stays a few hundred pixel rows');
  assert.ok(full.some(frame => frame.fills > 3), 'the ring adds its rows');
  assert.ok(full.some(frame => frame.motes > 10), 'motes rise');
  assert.ok(calm.every(frame => frame.fills <= 3), 'reduced motion: the pool only, no ring');
  assert.ok(calm.every(frame => frame.motes === 0), 'reduced motion: no motes');
  for (const counts of [full, calm]) {
    assert.ok(counts.some(frame => frame.text.includes('Новый уровень 3')));
    assert.ok(counts.at(-1).rows < counts[5].rows, 'it fades out');
  }
});

function harness(t) {
  const engine = new NullEngine({ renderWidth: 633, renderHeight: 292 });
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({}) });
  const scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const camera = new ArcRotateCamera('level-up-camera', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -633 / 64, orthoRight: 633 / 64, orthoTop: 292 / 64, orthoBottom: -292 / 64 });
  const assets = Object.fromEntries(Object.entries(pixels.pixelAtlases)
    .map(([name, atlas]) => [name, { ...atlas, texture: new Texture(null, scene) }]));
  const location = LOCATIONS.road, game = createGame();
  Object.assign(game, { world: location, locationId: location.id, locationRevision: 0, enemies: [], projectiles: [],
    adventure: { quest: 'outbound', secretFound: false, rewardCollected: false, visited: [location.id] } });
  Object.assign(game.player, location.spawn);
  const recording = recorder();
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    engine, scene, camera, assets, game, width: 633, height: 292, ctx: recording.context,
    followTarget: camera.target.clone(), shake: 0, reducedMotion: false,
    presentation: new PresentationState(game), fxSprites: new Map(),
    world: pixels.buildPixelWorld(scene, assets, location),
    monk: pixels.createSprite(scene, 'monk', assets.monk), monkShadow: pixels.createShadow(scene, 'monk-shadow'),
    hounds: [], drawMap() {},
  });
  return { renderer, game, recording };
}

test('the renderer starts the light on the game\'s level-up event, holds it while paused and draws it at the monk', t => {
  const { renderer: r, game, recording } = harness(t);
  const before = JSON.stringify({ player: game.player, phase: game.phase, time: game.time });
  game.events = [levelUp(2)];
  r.render(game, 1 / 60);
  assert.equal(r.levelUpLight.active, 1);
  game.events.length = 0;
  for (let i = 0; i < 30; i++) r.render(game, 1 / 60, 'paused');
  const age = r.levelUpLight.bursts.find(burst => burst.live).age;
  assert.ok(age < .05, `paused frames do not age it (${age})`);
  for (let i = 0; i < 30; i++) r.render(game, 1 / 60);
  assert.ok(recording.calls.some(call => call.name === 'fillText' && call.args[0] === 'Новый уровень 2'));
  // The column stands on the monk's drawn feet.
  const p = r.monk.mesh.position, foot = r.project(p.x, p.z, 0);
  const column = recording.calls.findLast(call => call.name === 'fillRect' && call.args[3] > 40);
  assert.ok(Math.abs(column.args[0] + column.args[2] / 2 - foot.x) <= 1 && Math.abs(column.args[1] + column.args[3] - foot.y) <= 1,
    `column at ${column.args} for feet ${foot.x},${foot.y}`);
  for (let i = 0; i < 120; i++) r.render(game, 1 / 60);
  assert.equal(r.levelUpLight.active, 0);
  const drawn = recording.calls.length;
  r.render(game, 1 / 60);
  assert.ok(!recording.calls.slice(drawn).some(call => call.name === 'fillText' && call.args[0].startsWith('Новый уровень')));
  // Render-only: the game state is what it was.
  assert.equal(JSON.stringify({ player: game.player, phase: game.phase, time: game.time }), before);
});

test('a restarted run starts dark: the last run\'s light goes out, while a pause of the same run keeps it', t => {
  const { renderer: r, game, recording } = harness(t);
  game.events = [levelUp(2)];
  r.render(game, 1 / 60);
  game.events.length = 0;
  for (let i = 0; i < 20; i++) r.render(game, 1 / 60);
  for (let i = 0; i < 10; i++) r.render(game, 1 / 60, 'paused');
  assert.equal(r.levelUpLight.active, 1, 'pause and resume of the same run keep the light');
  // main.js begin(true): a new game object, the same renderer.
  const next = createGame();
  Object.assign(next, { world: game.world, locationId: game.locationId, locationRevision: 0, enemies: [], projectiles: [],
    adventure: { quest: 'outbound', secretFound: false, rewardCollected: false, visited: [game.locationId] } });
  Object.assign(next.player, game.world.spawn);
  const drawn = recording.calls.length;
  r.render(next, 1 / 60);
  assert.equal(r.levelUpLight.active, 0);
  assert.ok(!recording.calls.slice(drawn).some(call => call.name === 'fillText' && call.args[0] === 'Новый уровень 2'));
  next.events = [levelUp(2)];
  r.render(next, 1 / 60);
  assert.equal(r.levelUpLight.active, 1, 'the new run lights up on its own level-up');
});

test('the banner leaves the shared canvas as it found it: baseline, alpha and blending', () => {
  const state = { textBaseline: 'alphabetic', textAlign: 'start', globalAlpha: 1, globalCompositeOperation: 'source-over', font: '10px monospace' };
  const saved = [];
  const context = new Proxy({ ...state, fillStyle: '' }, {
    get(target, key) {
      if (key === 'save') return () => saved.push({ ...target });
      if (key === 'restore') return () => Object.assign(target, saved.pop());
      if (key in target) return target[key];
      if (key === 'measureText') return text => ({ width: text.length * 5 });
      return () => {};
    },
  });
  const light = new LevelUpLight();
  light.start(4);
  for (let t = 0; t < LEVEL_UP_LIGHT.life; t += .1) {
    light.draw(context, view());
    for (const [key, value] of Object.entries(state)) assert.equal(context[key], value, `${key} at ${t.toFixed(1)} s`);
    light.update(.1);
  }
  // Without save/restore (a bare context) the baseline still comes back by hand.
  const bare = { textBaseline: 'alphabetic', globalAlpha: 1, fillStyle: '', beginPath() {}, rect() {}, fill() {}, fillRect() {}, fillText() {},
    measureText: text => ({ width: text.length * 5 }) };
  const again = new LevelUpLight();
  again.start(5); again.update(.6);
  again.draw(bare, view());
  assert.equal(bare.textBaseline, 'alphabetic');
});
