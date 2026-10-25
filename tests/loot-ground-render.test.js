import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Texture, Material } from '@babylonjs/core';
import { Renderer } from '../src/render.js';
import * as pixels from '../src/pixel-scene.js';
import { PresentationState } from '../src/pixel-animation.js';
import { createGame } from '../src/game.js';
import { LOCATIONS, CAMP_SUPPLIES } from '../src/campaign.js';
import { RARITIES, RELICS, WEAPON_BASES, createItem, createStarterWeapons, rollRunLoot } from '../src/items.js';

const { LOOT_GROUND, LOOT_STACK, lootGroundFrames } = pixels;
const frameCount = LOOT_GROUND.lootGround.frames.length;
const nameOf = index => LOOT_GROUND.lootGround.frames[index];

function harness(t, location = LOCATIONS.road, { loot = true } = {}) {
  const engine = new NullEngine({ renderWidth: 720, renderHeight: 450 });
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() {},
  }) });
  const scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const camera = new ArcRotateCamera('loot-camera', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -720 / 64, orthoRight: 720 / 64, orthoTop: 450 / 64, orthoBottom: -450 / 64 });
  const atlases = { ...pixels.pixelAtlases, ...(loot ? pixels.lootAtlases : {}) };
  const assets = Object.fromEntries(Object.entries(atlases).map(([name, atlas]) => [name, { ...atlas, texture: new Texture(null, scene) }]));
  const game = createGame();
  Object.assign(game, { world: location, locationId: location.id, locationRevision: 0, enemies: [], projectiles: [],
    adventure: { quest: 'outbound', secretFound: false, rewardCollected: false, visited: [location.id] } });
  Object.assign(game.player, location.spawn);
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    engine, scene, camera, assets, game, width: 720, height: 450, locationRevision: 0,
    followTarget: camera.target.clone(), shake: 0, reducedMotion: false,
    presentation: new PresentationState(game), fxSprites: new Map(),
    world: pixels.buildPixelWorld(scene, assets, location),
    monk: pixels.createSprite(scene, 'monk', assets.monk), monkShadow: pixels.createShadow(scene, 'monk-shadow'),
    hounds: [], drawOverlay() {}, drawMap() {},
  });
  return { renderer, game, scene, assets };
}
const counts = scene => [scene.meshes.length, scene.materials.length, scene.textures.length];
const drop = (game, item, right = 1) => ({ id: item.id, item, x: game.player.x + right, y: game.player.y, source: 'test', rearm: false });

test('every item the run can hold resolves a ground drawing, its shadow and its rarity frames', () => {
  const items = [...createStarterWeapons()];
  for (const base of Object.values(WEAPON_BASES)) {
    for (const rarity of ['common', 'rare']) {
      items.push(createItem({ id: `${base.id}-${rarity}`, family: base.family, ilvl: base.ilvl, rarity,
        affixes: rarity === 'rare' ? ['maxHp', 'comboDamage'] : [] }));
    }
  }
  for (const relic of Object.values(RELICS)) {
    items.push(createItem({ id: relic.id, family: relic.family, ilvl: 2, rarity: 'relic', relic: relic.id, affixes: ['maxHp', 'hpPerKill'] }));
  }
  for (let seed = 1; seed <= 25; seed++) {
    for (const drops of Object.values(rollRunLoot(seed).drops)) items.push(...(Array.isArray(drops) ? drops : Object.values(drops.byFamily)));
  }
  for (const item of items) {
    const frames = lootGroundFrames(item);
    assert.ok(frames, `${item.id} has a drawing`);
    const drawing = LOOT_GROUND.frames[nameOf(frames.item)];
    assert.equal(drawing.kind, 'item');
    if (item.relic) assert.equal(drawing.relic, item.relic, `${item.id}: a relic draws its relic`);
    else assert.equal(drawing.weapon, item.base, `${item.id}: other items draw their base`);
    assert.equal(drawing.family, item.family);
    assert.equal(nameOf(frames.shadow), drawing.shadow);
    assert.deepEqual(frames.ring.map(nameOf), LOOT_GROUND.rarity[item.rarity].ring);
    assert.deepEqual(frames.beam.map(nameOf), LOOT_GROUND.rarity[item.rarity].beam);
    for (const index of [frames.item, frames.shadow, ...frames.ring, ...frames.beam, ...frames.glint]) {
      assert.ok(Number.isInteger(index) && index >= 0 && index < frameCount, `${item.id}: frame ${index}`);
    }
  }
  assert.deepEqual(Object.keys(LOOT_GROUND.rarity).sort(), Object.keys(RARITIES).sort());
  assert.equal(lootGroundFrames({ base: 'unknown', rarity: 'common' }), null);
});

test('a ground item is the package stack: ring, shadow, beam, item, glint, flat and in that order', t => {
  const { renderer: r, game } = harness(t);
  const item = createItem({ id: 'drop-rare', family: 'staff', ilvl: 2, rarity: 'rare', affixes: ['maxHp', 'comboDamage'] });
  game.groundItems = [drop(game, item)];
  r.render(game, 0);
  const view = r.groundItems.get(item.id), frames = lootGroundFrames(item);
  assert.deepEqual(Object.keys(view.layers), [...LOOT_STACK]);
  assert.deepEqual(LOOT_STACK, ['ring', 'shadow', 'beam', 'item', 'glint']);
  const layers = LOOT_STACK.map(name => view.layers[name]);
  // Far to near: blend order rises and the depth bias pulls each layer nearer. No layer is
  // biased away from the camera, which would sink it under the floor .025u below.
  assert.deepEqual(layers.map(s => s.mesh.alphaIndex), [0, 1, 2, 3, 4]);
  assert.deepEqual(layers.map(s => s.material.zOffset || 0), [0, -1, -2, -3, -4]);
  assert.ok(layers.every(s => s.material.zOffset <= 0 && s.material.zOffsetUnits <= 0));
  assert.deepEqual(layers.map(s => s.material.transparencyMode),
    [Material.MATERIAL_ALPHABLEND, Material.MATERIAL_ALPHABLEND, Material.MATERIAL_ALPHABLEND, Material.MATERIAL_ALPHATEST, Material.MATERIAL_ALPHABLEND]);
  assert.equal(view.layers.shadow.material.alpha, LOOT_GROUND.shadow.drawAlpha);
  // Flat ground drawings below every actor, all at the item's anchor.
  const at = r.groundAnchor(game.groundItems[0].x, game.groundItems[0].y);
  for (const name of ['ring', 'shadow', 'beam', 'item']) {
    const { mesh } = view.layers[name];
    assert.equal(mesh.renderingGroupId, 0, name);
    assert.ok(Math.abs(mesh.position.x - at.x) < 1e-9 && Math.abs(mesh.position.z - at.y) < 1e-9, name);
  }
  assert.equal(view.layers.item.frame, frames.item);
  assert.equal(view.layers.shadow.frame, frames.shadow);
  assert.equal(r.groundItems.get(item.id).layers.item.atlas, r.assets.lootGround);
});

test('loot timings: the ring pulses, the beam is the 1.2 s drop column, then a glint every 2 s; items never bob', t => {
  const { renderer: r, game } = harness(t);
  const item = createItem({ id: 'drop-relic', family: 'knuckles', ilvl: 2, rarity: 'relic', relic: 'quiet-thunder', affixes: ['maxHp', 'hpPerKill'] });
  game.groundItems = [drop(game, item)];
  const timing = LOOT_GROUND.timing, frames = lootGroundFrames(item);
  const states = [];
  let age = 0;
  r.render(game, 0);
  const view = r.groundItems.get(item.id), heights = new Set();
  const sample = () => {
    const { ring, beam, glint, item: drawing } = view.layers;
    heights.add(drawing.mesh.position.y);
    return { age, ring: ring.frame, beam: beam.mesh.isVisible ? beam.frame : null, glint: glint.mesh.isVisible ? glint.frame : null };
  };
  for (const to of [.1, .35, .65, 1.1, 1.25, 1.3, 1.5, 2.9, 3.25, 3.3]) {
    r.render(game, to - age); age = to; states.push(sample());
  }
  const at = to => states.find(s => s.age === to);
  assert.deepEqual([.1, .35, .65].map(to => at(to).ring), [frames.ring[0], frames.ring[0], frames.ring[1]]);
  assert.deepEqual([.1, .35, .65, 1.1].map(to => at(to).beam), [frames.beam[0], frames.beam[1], frames.beam[0], frames.beam[1]]);
  assert.equal(at(1.25).beam, null, 'the column ends after 1.2 s');
  assert.equal(at(1.25).glint, frames.glint[0]);
  assert.equal(at(1.3).glint, frames.glint[1]);
  assert.equal(at(1.5).glint, null);
  assert.equal(at(2.9).glint, null);
  assert.equal(at(3.25).glint, frames.glint[0], 'the glint returns 2 s later');
  assert.deepEqual([...heights], [.025], 'flat on the ground, no bob');
  assert.ok(timing.glintSeconds < .3);
  // The glint sits on the item's glint pixel: a whole-pixel ground offset from the anchor.
  const shift = pixels.groundDrawingOffset(...frames.glintOffset), base = view.layers.item.mesh.position;
  assert.ok(Math.abs(view.layers.glint.mesh.position.x - base.x - shift.x) < 1e-9);
  assert.ok(Math.abs(view.layers.glint.mesh.position.z - base.z - shift.y) < 1e-9);
  // Reduced motion: frame 0 of ring and beam, and no glint.
  r.reducedMotion = true;
  for (const to of [3.6, 3.8, 5.25]) {
    r.render(game, to - age); age = to;
    assert.equal(view.layers.ring.frame, frames.ring[0]);
    assert.equal(view.layers.glint.mesh.isVisible, false);
  }
  game.groundItems = [drop(game, createItem({ id: 'drop-new', family: 'staff' }))];
  r.render(game, .35); r.render(game, .35);
  const fresh = r.groundItems.get('drop-new').layers.beam;
  assert.equal(fresh.mesh.isVisible, true); assert.equal(fresh.frame, lootGroundFrames(game.groundItems[0].item).beam[0]);
});

test('picking an item up releases its whole stack; a failed atlas falls back to procedural icons without leaks', t => {
  const { renderer: r, game, scene } = harness(t);
  r.render(game, 0);
  const before = counts(scene);
  const items = ['knuckles', 'staff'].map(family => createItem({ id: `drop-${family}`, family }));
  game.groundItems = items.map((item, i) => drop(game, item, i + 1));
  r.render(game, .1);
  assert.equal(counts(scene)[0], before[0] + 2 * LOOT_STACK.length);
  game.groundItems = game.groundItems.slice(1);
  r.render(game, .1);
  assert.equal(counts(scene)[0], before[0] + LOOT_STACK.length);
  game.groundItems = [];
  r.render(game, .1);
  assert.deepEqual(counts(scene), before);
  // The atlas failing later rebuilds a live stack as the procedural icon.
  game.groundItems = [drop(game, items[0])];
  r.render(game, .1);
  r.assets.lootGround.failed = true;
  r.render(game, .1);
  const view = r.groundItems.get(items[0].id);
  assert.equal(view.layers, undefined);
  assert.ok(view.mesh && view.shadow, 'a procedural icon and its contact shadow');
  game.groundItems = [];
  r.render(game, .1);
  assert.deepEqual(counts(scene), before);
});

test('without the loot atlas, items keep the procedural icon path', t => {
  const { renderer: r, game } = harness(t, LOCATIONS.road, { loot: false });
  game.groundItems = [drop(game, createItem({ id: 'drop-k', family: 'knuckles' }))];
  r.render(game, 0);
  const view = r.groundItems.get('drop-k');
  assert.equal(view.layers, undefined);
  assert.equal(view.mesh.material.diffuseTexture.name, 'pixel-item-knuckles-common');
});

test('the camp supplies cloth lies in front of the cache on the E point, and empties once taken', t => {
  const { renderer: r, game } = harness(t, LOCATIONS.camp);
  const cloth = r.world.supplies, atlas = r.assets.campSupplies;
  assert.ok(cloth, 'the camp builds its supplies cloth');
  const cache = LOCATIONS.camp.setDressing.find(p => p.id === 'supplies').collider, { halfX, halfY } = LOOT_GROUND.frames[atlas.full].cloth;
  const at = cloth.mesh.position;
  assert.ok(Math.abs(CAMP_SUPPLIES.x - at.x) <= halfX - .1 && Math.abs(CAMP_SUPPLIES.y - at.z) <= halfY - .1, 'the E point is on the cloth');
  // In front of the cache (screen-down is world +x +y on the fixed camera) and out of its collider.
  assert.ok(at.x > cache.x && at.z > cache.y, 'the cloth lies screen-down of the cache');
  assert.ok(at.x - halfX >= cache.x + cache.halfWidth, 'the cloth stays out of the cache collider (+x face)');
  assert.deepEqual(pixels.suppliesClothCenter(), { x: at.x, y: at.z });
  assert.equal(cloth.mesh.renderingGroupId, 0);
  r.render(game, 0);
  assert.equal(cloth.frame, atlas.frames.indexOf(atlas.full));
  game.lootClaimed = ['camp-supplies'];
  r.render(game, 0);
  assert.equal(cloth.frame, atlas.frames.indexOf(atlas.empty));
  // Other areas and a failed atlas have no cloth.
  assert.equal(harness(t, LOCATIONS.road).renderer.world.supplies, null);
  const failed = harness(t, LOCATIONS.camp, { loot: false });
  assert.equal(failed.renderer.world.supplies, null);
});

test('loading: a failed loot atlas is marked, and the world still becomes ready', async t => {
  const engine = new NullEngine(), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const transport = engine.createTexture.bind(engine);
  t.mock.method(engine, 'createTexture', (...args) => {
    if (!String(args[0]).includes('loot-ground.png')) return transport(...args);
    const texture = transport(...args.slice(0, 5));
    setTimeout(() => args[6]?.('blocked'));
    return texture;
  });
  t.mock.method(globalThis, 'fetch', async url => new Response(readFileSync(new URL(url))));
  const assets = pixels.loadPixelAssets(scene);
  await assert.doesNotReject(assets.ready);
  assert.equal(assets.lootGround.failed, true);
  assert.equal(assets.campSupplies.failed, false);
  assert.equal(assets.monk.failed, undefined);
});
