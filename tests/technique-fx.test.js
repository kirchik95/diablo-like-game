import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Texture } from '@babylonjs/core';
import { Renderer, SHADOWS, WRAITH_WARNING_TINT } from '../src/render.js';
import * as pixels from '../src/pixel-scene.js';
import {
  monkPose, PresentationState, attackCombo, craneProgress, CRANE_PEAK, TECHNIQUE_POSES,
} from '../src/pixel-animation.js';
import { GameAudio, CUES, VOICE_LIMITS } from '../src/audio.js';
import { createGame, updateGame, startAttack, useSlot } from '../src/game.js';
import { LOCATIONS, WRAITH_TIMINGS } from '../src/campaign.js';
import { MONK_RULES } from '../src/monk-combat.js';
import { RARITIES, WEAPON_FAMILIES, createItem, pickUpItem } from '../src/items.js';
import { gainXp } from '../src/run-progress.js';
import { MotionHistory } from '../src/render-interpolation.js';
import { equipItem } from '../src/inventory-actions.js';
import monkPackage from '../assets/game/pixel-v10/monk-side/manifest.json' with { type: 'json' };
import { FakeContext } from './helpers/fake-audio-context.js';

const atlas = monkPackage.monk;
const monk = (extra = {}) => ({ hp: 100, dx: 0, dy: 1, moving: false, distance: 0, dashTime: 0, attack: null, technique: null, ...extra });
const idle = { moveX: 0, moveY: 0, aimX: 0, aimY: 1, attack: false };
const SERIES = [[null, MONK_RULES.combo], ...Object.entries(WEAPON_FAMILIES).map(([id, family]) => [id, family.combo])];

// A flat open floor with tough targets that hold still.
function arena() {
  const game = createGame(), template = game.enemies[0], tiles = [];
  for (let x = -10; x <= 10; x++) for (let y = -10; y <= 10; y++) tiles.push({ x, y });
  game.world = { tiles, obstacles: [], shrine: null };
  game.projectiles = []; game._nextProjectileId = 0;
  Object.assign(game.player, { x: 0, y: 0 });
  game.enemies = [];
  const enemy = (x, y, extra = {}) => {
    const e = { ...template, id: `e${game.enemies.length}`, x, y, homeX: x, homeY: y,
      hp: 5000, maxHp: 5000, state: 'stunned', timer: 100, path: [], ...extra };
    game.enemies.push(e); return e;
  };
  return { game, enemy };
}
function equip(game, family) {
  const { slot } = pickUpItem(game.inventory, createItem({ id: `test-${family}`, family }));
  assert.equal(equipItem(game, slot).ok, true);
}

test('every strike of every series poses at every age; knuckles\' fourth strike no longer throws', () => {
  for (const [weapon, combo] of SERIES) {
    const strikes = combo.duration.length;
    for (let index = 0; index < strikes; index++) {
      for (let age = 0; age <= combo.duration[index] + .05; age += .005) {
        const attack = { index, age, ...(weapon ? { weapon, strikes } : {}) };
        assert.doesNotThrow(() => monkPose(monk({ attack }), atlas), `${weapon ?? 'unarmed'} strike ${index} at ${age}`);
      }
    }
  }
  // An index past the series (or an attack without its weapon field) still finds a drawing.
  assert.doesNotThrow(() => monkPose(monk({ attack: { index: 3, age: .1 } }), atlas));
  assert.doesNotThrow(() => monkPose(monk({ attack: { index: 7, age: .1, weapon: 'staff', strikes: 3 } }), atlas));
});

// Without the weapon package an armed series reuses the bare-hand drawings: 1, 2, 1, 3 for knuckles.
const bareStrike = (index, strikes) => index >= strikes - 1 ? 'attack3' : index % 2 ? 'attack2' : 'attack1';

test('strike timings follow the weapon series; without the weapon package the bare drawings stand in', () => {
  for (const [weapon, combo] of SERIES) {
    const strikes = combo.duration.length;
    for (let index = 0; index < strikes; index++) {
      const attack = age => ({ index, age, ...(weapon ? { weapon, strikes } : {}) });
      const clip = atlas.clips[bareStrike(index, strikes)].front;
      // Key 03 (index 2) is contact, exactly at the series' hit time.
      assert.equal(monkPose(monk({ attack: attack(combo.hitTime[index] - 1e-6) }), atlas).frame, clip[1], `${weapon} ${index}`);
      assert.equal(monkPose(monk({ attack: attack(combo.hitTime[index]) }), atlas).frame, clip[2], `${weapon} ${index}`);
      assert.equal(monkPose(monk({ attack: attack(combo.duration[index] - 1e-3) }), atlas).frame, clip[5], `${weapon} ${index}`);
    }
  }
  assert.equal(attackCombo({ weapon: 'knuckles' }), WEAPON_FAMILIES.knuckles.combo);
  assert.equal(attackCombo({}), MONK_RULES.combo);
});

test('a real knuckles series reaches its fourth strike through the simulation, presentation and audio', () => {
  const { game, enemy } = arena();
  enemy(0, 1);
  equip(game, 'knuckles');
  const presentation = new PresentationState(game);
  let context;
  const audio = new GameAudio({ AudioContext: class { constructor() { context = new FakeContext(); return context; } }, random: () => .5, music: null });
  audio.unlock();
  const seen = new Set(), swingLives = [];
  for (let frame = 0; frame < 120; frame++) {
    for (let i = 0; i < 2; i++) updateGame(game, { ...idle, attack: true }, 1 / 120);
    if (game.player.attack) seen.add(game.player.attack.index);
    assert.doesNotThrow(() => presentation.update(game, 1 / 60));
    assert.doesNotThrow(() => monkPose(game.player, atlas, presentation.player));
    assert.doesNotThrow(() => audio.frame(game));
    for (const effect of presentation.effects) if (effect.type === 'swing' && effect.age === 0) swingLives.push([effect.index, effect.life]);
    context.currentTime += 1 / 60;
    game.events.length = 0;
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
  // Each swing effect lasts its own knuckle strike.
  for (const [index, life] of swingLives) assert.equal(life, WEAPON_FAMILIES.knuckles.combo.duration[index]);
  assert.ok(swingLives.some(([index]) => index === 3));
});

test('audio: the fourth strike swings and hits with its own heavier shape and makes a sound', () => {
  let context;
  const audio = new GameAudio({ AudioContext: class { constructor() { context = new FakeContext(); return context; } }, random: () => .5, music: null });
  audio.unlock();
  const cues = [], cue = audio.cue;
  audio.cue = function(name, options = {}) { cues.push({ name, ...options }); return cue.call(this, name, options); };
  const game = { phase: 'playing', events: [], enemies: [{ id: 7, kind: 'hound' }],
    player: { x: 0, y: 0, hp: 100, distance: 0, dashTime: 0, attack: { index: 3, age: .13, weapon: 'knuckles', strikes: 4 } } };
  game.events = [{ type: 'swing', index: 3, strength: 'heavy', weapon: 'knuckles', dx: 0, dy: 1 },
    { type: 'impact', id: 7, source: 'combo', strength: 'heavy' }];
  const before = context.started.length;
  assert.doesNotThrow(() => audio.frame(game));
  assert.ok(context.started.length > before, 'the fourth strike is audible');
  assert.deepEqual(cues.map(c => c.name), ['swing:3', 'impact:flesh', 'punch']);
  const [, impact] = cues;
  assert.ok(impact.pitch < .86 && impact.gain > 1.15, 'heavier than the third strike');
  // The knuckles' third strike is light: it alternates back to the first shapes.
  cues.length = 0;
  game.player.attack = { index: 2, age: .08, weapon: 'knuckles', strikes: 4 };
  game.events = [{ type: 'swing', index: 2, strength: 'light', weapon: 'knuckles' }, { type: 'impact', id: 7, source: 'combo', strength: 'light' }];
  audio.frame(game);
  assert.deepEqual(cues.map(c => [c.name, c.pitch ?? 1]), [['swing:0', 1.1], ['impact:flesh', 1]]);
  // The relic chain during a fourth strike falls back safely as well.
  cues.length = 0;
  game.player.attack = { index: 3, age: .13, weapon: 'knuckles', strikes: 4 };
  game.events = [{ type: 'impact', id: 7, source: 'relic', strength: 'light' }, { type: 'relic-chain', from: 1, to: 7 }];
  assert.doesNotThrow(() => audio.frame(game));
  assert.deepEqual(cues.map(c => c.name), ['impact:flesh', 'relic-chain']);
});

test('audio: palm, crane, deflect, loot and level-up events each play their cue within the voice cap', () => {
  let context;
  const audio = new GameAudio({ AudioContext: class { constructor() { context = new FakeContext(); return context; } }, random: () => .5, music: null });
  audio.unlock();
  const cues = [], cue = audio.cue;
  audio.cue = function(name, options = {}) { cues.push({ name, ...options }); return cue.call(this, name, options); };
  const game = { phase: 'playing', events: [], enemies: [{ id: 1, kind: 'wraith' }], player: { x: 0, y: 0, hp: 100, distance: 0, dashTime: 0 } };
  const item = rarity => ({ rarity, family: 'staff' });
  for (const [event, expected] of [
    [{ type: 'palm' }, ['palm']],
    [{ type: 'impact', id: 1, source: 'palm', strength: 'light' }, ['impact:spirit', 'palm:hit']],
    [{ type: 'crane' }, ['crane']],
    [{ type: 'crane-land', radius: 1.6 }, ['crane-land']],
    [{ type: 'deflect' }, ['deflect']],
    [{ type: 'deflect-success', kind: 'hound' }, ['deflect-success']],
    [{ type: 'deflect-whiff' }, ['deflect-whiff']],
    [{ type: 'loot-drop', item: item('common') }, ['loot-drop', 'loot-drop:common']],
    [{ type: 'loot-drop', item: item('rare') }, ['loot-drop', 'loot-drop:rare']],
    [{ type: 'loot-drop', item: item('relic') }, ['loot-drop', 'loot-drop:relic']],
    [{ type: 'loot-pickup', item: item('rare') }, ['loot-pickup']],
    [{ type: 'level-up', level: 2 }, ['level-up']],
    [{ type: 'shot-destroyed' }, ['shot-destroyed']],
    [{ type: 'palm-burst', radius: 2 }, ['palm-burst']],
    [{ type: 'relic-wave', radius: 3 }, ['wave']],
  ]) {
    cues.length = 0;
    const before = context.started.length;
    game.events = [event];
    audio.frame(game);
    assert.deepEqual(cues.map(c => c.name), expected, event.type);
    assert.ok(context.started.length > before, `${event.type} is audible`);
    context.currentTime += 2; context.advance(0);
  }
  assert.equal(CUES['loot-drop:common'], undefined, 'a common drop is only the clink');
  // Two drops of one rarity in one frame merge; the voice cap holds under a burst of everything.
  cues.length = 0;
  game.events = [{ type: 'loot-drop', item: item('rare') }, { type: 'loot-drop', item: item('rare') }, { type: 'loot-drop', item: item('relic') }];
  audio.frame(game);
  assert.deepEqual(cues.map(c => c.name), ['loot-drop', 'loot-drop:rare', 'loot-drop', 'loot-drop:relic']);
  for (let i = 0; i < 20; i++) {
    for (const type of ['palm', 'crane-land', 'deflect-success', 'level-up', 'palm-burst']) audio.play({ type }, { game });
  }
  assert.ok(audio.voiceEnds.length <= VOICE_LIMITS.combat);
});

test('technique poses: crane flight on the dash leap, deflect guard, riposte, palm cast and landing', () => {
  const flight = { id: 'crane', t: 0, duration: .4, fromX: 0, fromY: 0, toX: 0, toY: 4, params: { radius: 1.6 } };
  const dash = atlas.clips.dash.front, guard = atlas.clips.attack3.front;
  const keys = [0, .05, .1, .2, .3, .37, .4].map(t => monkPose(monk({ technique: { ...flight, t }, moving: true }), atlas).frame);
  assert.deepEqual(keys, [dash[0], dash[0], dash[1], dash[2], dash[3], dash[4], dash[4]]);
  assert.equal(craneProgress(flight, { x: 0, y: 1 }), .25, 'the arc follows the drawn body');
  assert.equal(craneProgress({ ...flight, toY: 0, t: .1 }, { x: 0, y: 0 }), .25, 'a blocked jump runs on its clock');
  const stance = { id: 'deflect', t: 0, duration: .4 };
  assert.equal(monkPose(monk({ technique: stance }), atlas).frame, guard[0]);
  assert.equal(monkPose(monk({ technique: { ...stance, t: .2 } }), atlas).frame, guard[1]);
  assert.equal(monkPose(monk({ technique: { ...stance, t: .2 } }), atlas, { riposteAge: 0 }).frame, guard[2]);
  assert.equal(monkPose(monk(), atlas, { castAge: 0 }).frame, atlas.clips.attack1.front[2]);
  assert.notEqual(monkPose(monk({ moving: true }), atlas, { castAge: 0 }).frame, atlas.clips.attack1.front[2], 'a running cast keeps the run');
  assert.equal(monkPose(monk({ moving: true }), atlas, { landAge: 0 }).frame, dash[4], 'the landing frame shows even though it moved');
  assert.equal(monkPose(monk(), atlas, { landAge: TECHNIQUE_POSES.landing - .01 }).frame, dash[5]);
});

test('presentation: technique gestures start on their events and end once the monk travels on', () => {
  const game = createGame(), state = new PresentationState(game), p = game.player;
  game.events = [{ type: 'crane-land', x: 0, y: 0, radius: 1.6 }];
  p.moving = true; p.distance = 3;
  state.update(game, 1 / 60);
  assert.equal(state.player.landAge, 0, 'the landing frame keeps its gesture');
  game.events = [];
  p.moving = false;
  state.update(game, 1 / 60);
  assert.ok(state.player.landAge > 0);
  p.moving = true; p.distance += .05;
  state.update(game, 1 / 60);
  assert.equal(state.player.landAge, null, 'running on cancels it');
  game.events = [{ type: 'deflect', x: 0, y: 0, window: .4 }, { type: 'deflect-success', x: 0, y: 0 }];
  p.moving = false;
  state.update(game, 1 / 60);
  assert.equal(state.player.riposteAge, 0);
  assert.equal(state.effects.find(e => e.type === 'deflect').life, .4);
  game.events = [{ type: 'crane', x: 0, y: 0, duration: .5 }, { type: 'level-up', x: 0, y: 0, level: 3 }];
  state.update(game, 1 / 60);
  assert.equal(state.player.riposteAge, null, 'a new technique ends the riposte');
  assert.equal(state.effects.find(e => e.type === 'crane').life, .5);
  assert.equal(state.effects.find(e => e.type === 'level-up').life, .6);
});

test('placeholder pixel art: 16 px weapon icons carry their rarity inlay, 8 px shots their colours', () => {
  const hex = ([r, g, b]) => `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  const colours = art => new Set(Array.from({ length: art.width * art.height }, (_, i) => art.data.slice(i * 4, i * 4 + 4))
    .filter(px => px[3] === 255).map(hex));
  for (const family of Object.keys(WEAPON_FAMILIES)) {
    const shapes = new Set();
    for (const rarity of Object.keys(RARITIES)) {
      const art = pixels.itemIconPixels(family, rarity);
      assert.deepEqual([art.width, art.height], [16, 16]);
      assert.ok(art.anchor > 12 && art.anchor <= 16);
      assert.ok(colours(art).has(pixels.rarityInk(rarity)), `${family} ${rarity} inlay`);
      shapes.add(Array.from(art.data).filter((_, i) => i % 4 === 3).join(''));
    }
    assert.equal(shapes.size, 1, 'rarity changes colour, not the silhouette');
  }
  assert.deepEqual(Object.keys(RARITIES).map(pixels.rarityInk), ['#eee0ce', '#6dd6cb', '#e5b66e']);
  const palm = pixels.monkShotPixels('palm'), orb = pixels.monkShotPixels('reflected');
  assert.deepEqual([palm.width, palm.height, orb.width, orb.height], [8, 8, 8, 8]);
  assert.ok(colours(palm).has('#6dd6cb') && colours(palm).has('#ef8e83'), 'a turquoise palm with a coral heart');
  assert.ok(!colours(orb).has('#ef8e83'));
});

function harness(t) {
  const engine = new NullEngine({ renderWidth: 720, renderHeight: 450 });
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() {},
  }) });
  const scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const camera = new ArcRotateCamera('fx-camera', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -720 / 64, orthoRight: 720 / 64, orthoTop: 450 / 64, orthoBottom: -450 / 64 });
  const assets = Object.fromEntries(Object.entries(pixels.pixelAtlases)
    .map(([name, atlas]) => [name, { ...atlas, texture: new Texture(null, scene) }]));
  const location = LOCATIONS.road, game = createGame();
  Object.assign(game, { world: location, locationId: location.id, locationRevision: 0, enemies: [],
    adventure: { quest: 'outbound', secretFound: false, rewardCollected: false, visited: [location.id] }, projectiles: [] });
  Object.assign(game.player, location.spawn);
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    engine, scene, camera, assets, game, width: 720, height: 450,
    followTarget: camera.target.clone(), shake: 0, reducedMotion: false,
    presentation: new PresentationState(game), fxSprites: new Map(),
    world: pixels.buildPixelWorld(scene, assets, location),
    monk: pixels.createSprite(scene, 'monk', assets.monk), monkShadow: pixels.createShadow(scene, 'monk-shadow'),
    hounds: [], drawOverlay() {}, drawMap() {},
  });
  return { renderer, game, scene };
}

test('renderer: ground items and monk shots get pixel billboards with contact shadows and release them', t => {
  const { renderer: r, game, scene } = harness(t);
  r.render(game, 0);
  const counts = () => [scene.meshes.length, scene.materials.length, scene.textures.length];
  const before = counts();
  const p = game.player;
  game.groundItems = ['common', 'rare', 'relic'].map((rarity, i) => {
    const item = createItem({ id: `drop-${i}`, family: i % 2 ? 'staff' : 'knuckles', rarity,
      affixes: rarity === 'common' ? [] : ['maxHp', 'comboDamage'], relic: rarity === 'relic' ? 'quiet-thunder' : null });
    return { id: item.id, item, x: p.x + 1 + i, y: p.y, source: 'test', rearm: false };
  });
  game.monkShots = [{ id: 'palm-0', kind: 'palm', x: p.x, y: p.y + 1, dx: 0, dy: 1, radius: .15, travelled: 1 },
    { id: 'reflected-1', kind: 'reflected', x: p.x, y: p.y - 1, dx: 0, dy: -1, radius: .15, travelled: .2 }];
  r.render(game, 1 / 60);
  assert.equal(r.groundItems.size, 3); assert.equal(r.monkShots.size, 2);
  const lift = Math.sin(Math.PI / 3) * r.pixelsPerUnit();
  const view = r.groundItems.get('drop-0'), y0 = view.mesh.position.y;
  assert.ok(Number.isInteger(Math.round((y0 - .025) * lift * 1e6) / 1e6), 'items rest on whole screen pixels');
  assert.equal(view.shadow.material.alpha, SHADOWS.item.alpha);
  // The bob is two steps of one screen pixel, held while paused.
  const heights = new Set();
  for (let i = 0; i < 90; i++) { r.render(game, 1 / 60); heights.add(Math.round((view.mesh.position.y - .025) * lift)); }
  assert.deepEqual([...heights].sort(), [2, 3]);
  const paused = view.mesh.position.y;
  for (let i = 0; i < 60; i++) r.render(game, 1 / 60, 'paused');
  assert.equal(view.mesh.position.y, paused);
  // Shots fly at chest height on the lattice and follow the body.
  const shot = r.monkShots.get('palm-0');
  assert.ok(shot.mesh.position.y > .4 && shot.mesh.position.y < .7);
  game.monkShots[0].y += 1;
  r.render(game, 1 / 60);
  assert.ok(Math.abs(shot.mesh.position.z - (p.y + 2)) < .1);
  // Collected items and spent shots release every mesh, material and shared texture.
  game.groundItems = []; game.monkShots = [];
  r.render(game, 1 / 60);
  assert.deepEqual([r.groundItems.size, r.monkShots.size], [0, 0]);
  assert.deepEqual(counts(), before);
});

test('renderer: the crane flight lifts the monk on a whole-pixel arc while his shadow stays on the ground and shrinks', t => {
  const { renderer: r, game } = harness(t);
  const p = game.player;
  r.render(game, 0);
  const ground = r.monk.mesh.position.y, shadowY = r.monkShadow.position.y;
  p.technique = { id: 'crane', t: .2, duration: .4, fromX: p.x, fromY: p.y - 2, toX: p.x, toY: p.y + 2, params: { radius: 1.6 } };
  r.render(game, 1 / 60);
  const lift = Math.sin(Math.PI / 3) * r.pixelsPerUnit(), height = r.monk.mesh.position.y - ground;
  assert.ok(Math.abs(height - CRANE_PEAK) < 1 / lift + 1e-9, 'the top of the arc at mid-flight');
  assert.ok(Math.abs(height * lift - Math.round(height * lift)) < 1e-6);
  assert.equal(r.monkShadow.position.y, shadowY);
  assert.ok(r.monkShadow.scaling.x < .6 && r.monkShadow.visibility < .7);
  p.technique = null;
  r.render(game, 1 / 60);
  assert.equal(r.monk.mesh.position.y, ground);
  assert.deepEqual([r.monkShadow.scaling.x, r.monkShadow.visibility], [1, 1]);
});

test('overlay: technique states, new effects, shot trails and item columns draw with finite coordinates', t => {
  const { renderer: r, game } = harness(t);
  const operations = [];
  r.ctx = new Proxy({}, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
    return (...args) => {
      assert.ok(args.every(value => typeof value !== 'number' || Number.isFinite(value)), `${String(key)} received non-finite coordinates`);
      operations.push([key, ...args]);
    };
  } });
  r.drawOverlay = Renderer.prototype.drawOverlay;
  const p = game.player, item = createItem({ id: 'drop-r', family: 'staff', rarity: 'rare', affixes: ['maxHp', 'comboDamage'] });
  const target = { ...createGame().enemies[0], id: 'e1', x: p.x + 2, y: p.y };
  game.enemies = [target];
  r.hounds = [];
  game.groundItems = [{ id: item.id, item, x: p.x + 1, y: p.y, source: 'test', rearm: false }];
  game.monkShots = [{ id: 'palm-0', kind: 'palm', x: p.x, y: p.y + 1, dx: 0, dy: 1, radius: .15, travelled: .3 }];
  game.projectiles = [{ id: 'shot-w', x: p.x - 1, y: p.y, dx: 1, dy: 0, radius: .13, life: 1.2 }];
  const events = [
    { type: 'swing', index: 3, strength: 'heavy', weapon: 'knuckles', dx: 0, dy: 1 },
    { type: 'swing', index: 2, strength: 'heavy', weapon: 'staff', dx: 1, dy: 0 },
    { type: 'palm', dx: 0, dy: 1 }, { type: 'crane', duration: .4 }, { type: 'crane-land', radius: 1.6 },
    { type: 'deflect', window: .4 }, { type: 'deflect-success' }, { type: 'deflect-whiff' },
    { type: 'shot-fade', kind: 'palm' }, { type: 'shot-destroyed' }, { type: 'palm-burst', radius: 2 },
    { type: 'relic-wave', radius: 3 }, { type: 'relic-chain', from: 'e0', to: 'e1' }, { type: 'loot-drop', item },
    { type: 'loot-pickup', item }, { type: 'level-up', level: 2 },
  ].map(event => ({ x: p.x, y: p.y, ...event }));
  game.events = events;
  for (const technique of [
    { id: 'crane', t: .1, duration: .4, fromX: p.x, fromY: p.y, toX: p.x + 3, toY: p.y, params: { radius: 1.6 } },
    { id: 'deflect', t: .1, duration: .4, params: {} }, null]) {
    p.technique = technique;
    for (const dt of [0, .1, .25, 1, 1.5]) {
      r.render(game, dt);
      game.events = [];
      assert.doesNotThrow(() => r.drawOverlay(game, r.presentation.time, 'playing'));
    }
    game.events = events.map(event => ({ ...event }));
  }
  const fills = operations.filter(([name]) => name === 'fillRect').length;
  assert.ok(fills > 100, `expected many pixel marks, got ${fills}`);
});

test('a real palm cast and deflect reach the renderer state without errors', () => {
  const { game, enemy } = arena();
  enemy(4, 0);
  gainXp(game, 80);
  game.player.spirit = 100;
  const state = new PresentationState(game);
  assert.equal(useSlot(game, 'q', 1, 0).ok, true);
  state.update(game, 1 / 60);
  assert.equal(state.player.castAge, 0);
  assert.equal(state.effects.some(e => e.type === 'palm'), true);
  assert.equal(game.monkShots.length, 1);
  for (let i = 0; i < 60 && game.monkShots.length; i++) { game.events.length = 0; updateGame(game, idle, 1 / 120); state.update(game, 1 / 120); }
  assert.equal(game.monkShots.length, 0);
  // A strike after the cast poses with its own series.
  game.events.length = 0;
  assert.equal(startAttack(game, 1, 0), true);
  state.update(game, 1 / 60);
  assert.deepEqual(monkPose(game.player, atlas, state.player), { frame: atlas.clips.attack1.front[0], flip: true });
});

test('renderer: monk shots draw at their blended position; wraith shots are magenta 8 px orbs', t => {
  const { renderer: r, game, scene } = harness(t);
  const p = game.player, motion = new MotionHistory();
  game.monkShots = [{ id: 'palm-0', kind: 'palm', x: p.x, y: p.y + 1, dx: 0, dy: 1, radius: .15, travelled: .2 }];
  game.projectiles = [{ id: 'shot-0', x: p.x + 1, y: p.y, dx: -1, dy: 0, radius: .13, life: 1 }];
  r.render(game, 0);
  motion.capture(game);
  game.monkShots[0].y += .1; game.projectiles[0].x -= .05;
  r.render(game, 0, 'playing', motion.blend(game, .5));
  const palm = r.monkShots.get('palm-0').mesh.position, mid = r.groundAnchor(p.x, p.y + 1.05);
  assert.ok(Math.abs(palm.x - mid.x) < 1e-9 && Math.abs(palm.z - mid.y) < 1e-9, 'the palm draws between its steps');
  const shot = r.projectiles.get('shot-0'), at = r.groundAnchor(p.x + .975, p.y);
  assert.ok(Math.abs(shot.mesh.position.x - at.x) < 1e-9 && Math.abs(shot.mesh.position.z - at.y) < 1e-9);
  // The wraith's own cast magenta, never the monk's turquoise.
  const art = pixels.wraithShotPixels(), colours = new Set();
  for (let i = 0; i < art.data.length; i += 4) if (art.data[i + 3]) colours.add(`#${[0, 1, 2].map(k => art.data[i + k].toString(16).padStart(2, '0')).join('')}`);
  assert.deepEqual([art.width, art.height], [8, 8]);
  assert.deepEqual([...colours].sort(), ['#b11ab1', '#f254f2', '#ff81f4']);
  assert.equal(shot.mesh.material.diffuseTexture.name, 'pixel-shot-wraith');
  // Spent shots release their billboards and shadows.
  const before = scene.meshes.length;
  game.projectiles = []; game.monkShots = [];
  r.render(game, 0);
  assert.equal(scene.meshes.length, before - 4);
});

test('the wraith windup telegraph wears the wraith magenta: strip, countdown ring and warning tint', t => {
  const { renderer: r, game } = harness(t);
  const p = game.player;
  const wraith = { ...createGame().enemies[0], id: 'w', kind: 'wraith', x: p.x + 2, y: p.y, dx: -1, dy: 0,
    hp: 76, maxHp: 76, state: 'windup', timer: WRAITH_TIMINGS.windup / 2, radius: .29 };
  game.enemies = [wraith];
  r.hounds = [r.createEnemy(wraith)];
  r.render(game, 0);
  const warning = r.hounds[0].warning;
  assert.equal(warning.mesh.isVisible, true);
  const tint = warning.material.emissiveColor;
  assert.deepEqual([tint.r, tint.g, tint.b], [...WRAITH_WARNING_TINT]);
  // The pink-magenta warning art (#e72a91, hue 327°) turns toward the wraith's #f254f2 (hue 300°).
  const hue = (r, g, b) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const h = max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d;
    return (h * 60 + 360) % 360;
  };
  const tinted = hue(0xe7 * tint.r, 0x2a * tint.g, 0x91 * tint.b);
  assert.ok(tinted >= 295 && tinted < hue(0xe7, 0x2a, 0x91) - 10, `warning hue ${tinted.toFixed(0)}° is not the wraith magenta`);
  const styles = [];
  r.ctx = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => {};
    },
    set(target, key, value) { if (key === 'fillStyle' || key === 'strokeStyle') styles.push(value); target[key] = value; return true; },
  });
  Renderer.prototype.drawOverlay.call(r, game, 0, 'playing');
  assert.ok(styles.some(style => String(style).startsWith('rgba(242,84,242,')), 'the strip fills in magenta');
  assert.ok(styles.includes('#ff81f4'), 'the countdown ring is magenta');
  assert.ok(!styles.some(style => /a4f8e9|111,229,218/.test(String(style))), 'no turquoise left on an enemy telegraph');
  r.disposeEnemy(r.hounds[0]);
});

test('«Последний вздох»: a breath of light, a shield ring and a cool shimmer while the 1.5 s shield holds, with its own sound', async t => {
  const { gainXp, spendPathPoint } = await import('../src/run-progress.js');
  const { renderer: r, game } = harness(t);
  game.enemies = [];
  gainXp(game, 4580);
  for (const id of ['tempering', 'second-wind', 'stone-skin', 'last-breath']) assert.equal(spendPathPoint(game, id).ok, true, id);
  const p = game.player;
  p.hp = 30;
  game.events.length = 0;
  game.enemies = [{ ...createGame().enemies[0], id: 'leaper', x: p.x + .2, y: p.y, homeX: p.x + .2, homeY: p.y,
    hp: 500, maxHp: 500, state: 'leap', timer: .2, dx: -1, dy: 0, hit: false }];
  updateGame(game, idle, .01);
  game.enemies = [];
  const breath = game.events.find(event => event.type === 'last-breath');
  assert.ok(breath, 'the hit triggers «Последний вздох»');
  r.render(game, 0);
  assert.equal(r.presentation.player.breathAge, 0);
  assert.equal(r.presentation.effects.find(e => e.type === 'last-breath').life, 1.5);
  // The overlay draws the burst and the shield ring; the monk shimmers on alternate .1 s steps.
  const rings = [];
  r.drawRing = (x, y, radius, height, hex) => rings.push([radius, height, hex]);
  r.ctx = new Proxy({}, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
    return () => {};
  } });
  const tints = new Set();
  for (let i = 0; i < 30; i++) {
    game.events.length = 0;
    updateGame(game, idle, 1 / 60);
    r.render(game, 1 / 60);
    if (r.presentation.player.flash <= 0) tints.add(r.monk.material.emissiveColor.r);
    rings.length = 0;
    Renderer.prototype.drawOverlay.call(r, game, r.presentation.time, 'playing');
    if (i === 2) assert.ok(rings.some(([radius]) => radius > .3 && radius < 1.25), 'the breath ring spreads');
  }
  assert.ok(rings.some(([radius, height]) => radius === .5 && height === .05), 'the shield ring holds');
  assert.deepEqual([...tints].sort(), [.82, 1]);
  // When the invulnerability ends, so does the shield; the effect never outlives it.
  for (let i = 0; i < 90; i++) { game.events.length = 0; updateGame(game, idle, 1 / 60); r.render(game, 1 / 60); }
  assert.equal(p.invulnerable, 0);
  assert.equal(r.presentation.player.breathAge, null);
  assert.equal(r.breathShield(p), false);
  assert.equal(r.monk.material.emissiveColor.r, 1);
  // Its cue plays under the combat voice cap.
  let context;
  const audio = new GameAudio({ AudioContext: class { constructor() { context = new FakeContext(); return context; } }, random: () => .5, music: null });
  audio.unlock();
  const before = context.started.length;
  audio.frame({ phase: 'playing', events: [breath], enemies: [], player: { x: 0, y: 0, hp: 30, distance: 0, dashTime: 0 } });
  assert.equal(context.started.length - before, CUES['last-breath'].length);
});
