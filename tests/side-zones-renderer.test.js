import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, Texture, ArcRotateCamera, Camera, Vector3 } from '@babylonjs/core';
import { OVERWORLD } from '../src/overworld.js';
import { LOCATIONS } from '../src/campaign.js';
import { layoutLandscape } from '../src/landscape.js';
import { countryGroundCover } from '../src/country-terrain.js';
import { buildPixelWorld, pixelAtlases, createSprite, createShadow, cachesOf, shrinesOf } from '../src/pixel-scene.js';
import { Renderer, adventureMapLayout } from '../src/render.js';
import { PresentationState, worldPose } from '../src/pixel-animation.js';
import { createAdventure } from '../src/game.js';

// The side zones of world-expansion §6–§8 on today's spine, with the data contract of slice (а):
// each side zone dresses itself (setDressing) and carries its caches and shrines by id, and the
// union lists them all. Each side zone shows every frame of its atlas and the v11/v9 frames its
// dressing tables name (§4.2–§4.4).
const TABLE_FRAMES = {
  cemetery: ['bush-round', 'boulder-round', 'bush-large', 'cypress-medium', 'cypress-tall', 'cypress-pair'],
  orchard: ['bush-round', 'bush-large', 'cypress-medium', 'fallen-block', 'rubble-small', 'rubble-pile', 'ivy-clump', 'wall-run-x', 'parapet-broken-y'],
};
const SEARCH = { cemetery: ['cemetery', 'monasteryRuins', 'campPanorama'], orchard: ['orchard', 'monasteryRuins', 'campPanorama'] };
function sideZone(id, ox, oy, sites) {
  const tiles = [];
  for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) tiles.push({ x: ox + x, y: oy + y });
  const setDressing = [...pixelAtlases[id].frames, ...TABLE_FRAMES[id]].map((kind, i) => ({
    id: `${kind}-${i}`, kind, x: ox - 6 + i % 8 * 1.6, y: oy - 6 + Math.floor(i / 8) * 1.6, scale: 1, flip: i % 2 === 1,
    ...pixelAtlases[id].footprints[kind]?.role === 'flat' ? { layer: 'ground' } : {},
  }));
  return { id, title: id, tiles, regions: [], obstacles: [], paving: [], braziers: [], portals: [], pillars: [], encounters: [],
    setDressing, ...sites };
}
const spine = OVERWORLD.zones.filter(zone => ['camp', 'road', 'courtyard'].includes(zone.id));
const zones = [...spine,
  sideZone('cemetery', 20, -48, { caches: [{ id: 'cemetery-cache', x: 13, y: -59.2 }] }),
  sideZone('orchard', -20, -85, { caches: [{ id: 'orchard-cache', x: -28, y: -84.5 }], shrines: [{ id: 'orchard-shrine', x: -20, y: -90 }] })];
const WORLD = { ...OVERWORLD, zones, caches: zones.flatMap(cachesOf), shrines: zones.flatMap(shrinesOf) };

function harness(t) {
  const engine = new NullEngine({ renderWidth: 720, renderHeight: 450 }), scene = new Scene(engine);
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() {},
  }) });
  t.after(() => { scene.dispose(); engine.dispose(); });
  const camera = new ArcRotateCamera('test-camera', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -720 / 64, orthoRight: 720 / 64, orthoTop: 450 / 64, orthoBottom: -450 / 64 });
  const assets = Object.fromEntries(Object.entries(pixelAtlases).map(([name, atlas]) =>
    [name, { ...atlas, texture: new Texture(null, scene) }]));
  const world = buildPixelWorld(scene, assets, WORLD);
  const game = createAdventure();
  Object.assign(game, { world: WORLD, locationId: 'road', locationRevision: 0, projectiles: [], pickups: [],
    adventure: { quest: 'outbound', secretFound: false, rewardCollected: false } });
  Object.assign(game.player, { x: 0, y: -40 });
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    engine, scene, camera, assets, game, world, width: 720, height: 450, locationRevision: 0,
    followTarget: camera.target.clone(), shake: 0, reducedMotion: false,
    presentation: new PresentationState(game), fxSprites: new Map(), hounds: [],
    monk: createSprite(scene, 'monk', assets.monk), monkShadow: createShadow(scene, 'monk-shadow'),
    drawOverlay() {}, drawMap() {},
  });
  return { renderer, game, scene, assets, world };
}

test('every side-zone frame finds its atlas: the zone\'s own pixel-v13 atlas, then v11, then v9', t => {
  const { renderer, game, assets, world } = harness(t);
  for (const id of ['cemetery', 'orchard']) {
    const placed = world.props.filter(sprite => sprite.placement && zones.find(zone => zone.id === id).setDressing.includes(sprite.placement));
    assert.equal(placed.length, pixelAtlases[id].frames.length + TABLE_FRAMES[id].length);
    for (const sprite of placed) {
      const { kind } = sprite.placement, expected = SEARCH[id].find(name => pixelAtlases[name].frames.includes(kind));
      assert.equal(sprite.atlas, assets[expected], `${id} ${kind}`);
      assert.equal(sprite.frame, assets[expected].frames.indexOf(kind));
      assert.ok(sprite.mesh.name.startsWith(`${id}-`), sprite.mesh.name);
      // A low prop never fades over an actor; flat ones lie on the ground.
      const role = pixelAtlases[expected].footprints?.[kind]?.role;
      assert.equal(!!sprite.noFade, role === 'low', `${kind} fades unless low`);
      if (role === 'flat') assert.equal(sprite.mesh.renderingGroupId, 0);
    }
    assert.ok(placed.some(sprite => sprite.noFade) && placed.some(sprite => !sprite.noFade));
  }
  // The occlusion pass never tests a low prop.
  renderer.updateOcclusion(game);
  const tested = new Set(renderer.occlusionScratch.props.map(prop => prop.sprite));
  assert.ok(world.props.filter(sprite => sprite.noFade).every(sprite => !tested.has(sprite)));
  assert.ok(world.props.some(sprite => sprite.atlas === assets.cemetery && !sprite.noFade && tested.has(sprite)));
  // The spine keeps its own atlases and names.
  assert.ok(world.props.some(sprite => sprite.mesh.name.startsWith('court-')));
  assert.ok(!world.props.some(sprite => sprite.atlas === assets.cemetery && !sprite.mesh.name.startsWith('cemetery-')));
});

test('the union has three caches and two shrines; the road\'s keep world.secret and world.shrine', t => {
  const { world } = harness(t);
  assert.deepEqual(world.caches.map(cache => cache.id), ['secret', 'cemetery-cache', 'orchard-cache']);
  assert.deepEqual(world.shrines.map(shrine => shrine.id), ['road-shrine', 'orchard-shrine']);
  assert.equal(world.secret, world.caches[0]);
  assert.equal(world.shrine, world.shrines[0].sprite);
  for (const cache of world.caches) {
    const site = WORLD.caches.find(p => p.id === cache.id);
    assert.deepEqual([cache.chest.position.x, cache.chest.position.z], [site.x, site.y]);
    for (const sprite of [cache.sprite, cache.motes, cache.pool]) {
      assert.deepEqual([sprite.mesh.position.x, sprite.mesh.position.z], [site.x, site.y]);
    }
  }
  for (const { id, sprite } of world.shrines) {
    const site = WORLD.shrines.find(p => p.id === id);
    assert.deepEqual([sprite.mesh.position.x, sprite.mesh.position.z], [site.x - .5, site.y - .5]);
    assert.ok(world.props.includes(sprite), 'a shrine still fades over the monk');
  }
});

test('an opened cemetery cache animates only its own sprite; before the arrays only the road cache opens', t => {
  const { renderer, game, world } = harness(t);
  const frames = () => world.caches.map(cache => cache.sprite.frame);
  renderer.updateLocationState(game, 0);
  game.adventure.cachesFound = ['cemetery-cache'];
  renderer.updateLocationState(game, 0);
  assert.deepEqual(frames(), [0, 4, 0], 'only the cemetery begins the lid-opening clip');
  renderer.updateLocationState(game, .6);
  assert.equal(world.caches[1].sprite.frame, 7);
  assert.equal(world.caches[1].motes.mesh.isEnabled(), false);
  assert.equal(world.caches[1].pool.mesh.isEnabled(), false);
  assert.ok(world.caches.filter(cache => cache.id !== 'cemetery-cache').every(cache => cache.sprite.frame < 4));
  delete game.adventure.cachesFound;
  game.adventure.secretFound = true;
  renderer.updateLocationState(game, .6);
  assert.equal(world.caches[0].sprite.frame, 4, 'the old road flag still starts the opening');
  assert.ok(world.caches.slice(1).every(cache => cache.sprite.frame < 4 && cache.glow.found === false));
  // UV animation needs no moving world matrices, including the opening lid.
  renderer.freezeWorld();
  for (const cache of world.caches) {
    for (const sprite of [cache.sprite, cache.motes, cache.pool]) {
      assert.equal(sprite.mesh.isWorldMatrixFrozen, true);
    }
  }
});

test('each shrine shows its own age; without shrinesUsed the road shrine follows shrineUsed', t => {
  const { renderer, game, world } = harness(t);
  const [road, orchard] = world.shrines, clip = road.sprite.atlas.clips.shrine;
  game.shrinesUsed = ['orchard-shrine'];
  renderer.render(game, 0);
  renderer.render(game, .5);
  assert.equal(renderer.presentation.shrineAges['orchard-shrine'], .5);
  assert.equal(orchard.sprite.frame, worldPose('shrine', orchard.sprite.atlas, { shrineAges: { 'orchard-shrine': .5 } }, 0, 'orchard-shrine').frame);
  assert.notEqual(orchard.sprite.frame, clip.front[0]);
  assert.equal(road.sprite.frame, clip.front[0]);
  // The old flag alone: the road shrine and the single shrineAge animate together.
  delete game.shrinesUsed;
  const old = new PresentationState(game);
  game.shrineUsed = true;
  for (const dt of [0, .1, .2, .3]) {
    old.update(game, dt);
    assert.equal(old.shrineAges['road-shrine'], old.shrineAge);
    assert.equal(old.shrineAges['orchard-shrine'], undefined);
    assert.deepEqual(worldPose('shrine', road.sprite.atlas, old, 0, 'road-shrine'), worldPose('shrine', road.sprite.atlas, old));
  }
});

test('the minimap marks every cache and shrine by its own state', t => {
  const { game } = harness(t);
  const near = p => Object.assign(game.player, { x: p.x, y: p.y });
  game.adventure.cachesFound = ['orchard-cache'];
  game.shrinesUsed = ['road-shrine'];
  const marks = id => {
    const site = [...WORLD.caches, ...WORLD.shrines].find(p => p.id === id);
    near(site);
    return adventureMapLayout(game).markers.filter(marker => marker.id === id).map(marker => [marker.kind, marker.used]);
  };
  assert.deepEqual(marks('secret'), [['secret', false]]);
  assert.deepEqual(marks('cemetery-cache'), [['secret', false]]);
  assert.deepEqual(marks('orchard-cache'), [['secret', true]]);
  assert.deepEqual(marks('road-shrine'), [['shrine', true]]);
  assert.deepEqual(marks('orchard-shrine'), [['shrine', false]]);
  // Before the arrays, the old flags mark the road's cache and shrine.
  delete game.adventure.cachesFound; delete game.shrinesUsed;
  Object.assign(game, { shrineUsed: true, world: OVERWORLD });
  game.adventure.secretFound = true;
  near(OVERWORLD.secret);
  assert.deepEqual(adventureMapLayout(game).markers.filter(m => m.kind !== 'reward').map(m => [m.kind, m.id, m.used]),
    [['shrine', 'road-shrine', true], ['secret', 'secret', true]]);
});

test('grass tufts keep clear of every cache and shrine in world.caches and world.shrines', () => {
  const road = LOCATIONS.road, layout = layoutLandscape(road);
  const before = countryGroundCover(road, layout.bounds, layout.surfaceMap);
  // Sites on open ground where tufts grow today.
  const [a, b] = [before[0], before.at(-1)];
  const sites = { caches: [{ id: 'secret', ...road.secret }, { id: 'extra-cache', x: a.x, y: a.y }],
    shrines: [{ id: 'road-shrine', ...road.shrine }, { id: 'extra-shrine', x: b.x, y: b.y }] };
  const after = countryGroundCover({ ...road, ...sites }, layout.bounds, layout.surfaceMap);
  for (const site of [...sites.caches, ...sites.shrines]) {
    assert.ok(after.every(p => Math.hypot(p.x - site.x, p.y - site.y) >= 2.2), site.id);
  }
  assert.ok(before.some(p => Math.hypot(p.x - a.x, p.y - a.y) < 2.2) && after.length < before.length);
  // Without the arrays nothing changes.
  assert.deepEqual(countryGroundCover({ ...road }, layout.bounds, layout.surfaceMap), before);
});

// The real five-zone overworld (world-expansion slice (а)).
test('the real overworld draws three caches, two shrines and every side prop from its own atlas order', t => {
  const { renderer, game, assets, scene } = harness(t);
  const world = buildPixelWorld(scene, assets, OVERWORLD);
  t.after(() => world.dispose());
  assert.deepEqual(world.caches.map(cache => cache.id), OVERWORLD.caches.map(cache => cache.id));
  assert.deepEqual(world.caches.map(cache => cache.id), ['secret', 'cemetery-cache', 'orchard-cache']);
  assert.deepEqual(world.shrines.map(shrine => shrine.id), ['road-shrine', 'orchard-shrine']);
  for (const id of ['cemetery', 'orchard']) {
    const dressing = OVERWORLD.zones.find(zone => zone.id === id).setDressing;
    const placed = world.props.filter(sprite => dressing.includes(sprite.placement));
    assert.equal(placed.length, dressing.filter(p => p.kind !== 'brazier').length);
    for (const sprite of placed) {
      const expected = SEARCH[id].find(name => pixelAtlases[name].frames.includes(sprite.placement.kind));
      assert.equal(sprite.atlas, assets[expected], `${id} ${sprite.placement.kind}`);
    }
  }
  Object.assign(renderer, { world });
  game.world = OVERWORLD;
  game.adventure.cachesFound = ['cemetery-cache'];
  renderer.updateLocationState(game, 0);
  assert.deepEqual(world.caches.map(cache => cache.sprite.frame), [0, 7, 0], 'restored found caches show the empty frame');
});

test('the minimap colours side tiles by zone and marks every real cache and shrine', t => {
  const { renderer, game } = harness(t);
  game.world = OVERWORLD;
  const fills = [];
  const context = new Proxy({ canvas: { width: 360, height: 280 } }, {
    get: (target, key) => key in target ? target[key] : key === 'fill' ? () => fills.push(target.fillStyle) : () => {},
    set: (target, key, value) => { target[key] = value; return true; },
  });
  Object.assign(renderer, { map: context });
  for (const [id, colour] of [['cemetery-cache', '#8fa39a35'], ['orchard-cache', '#a7b07a35']]) {
    const site = OVERWORLD.caches.find(cache => cache.id === id);
    Object.assign(game.player, { x: site.x, y: site.y });
    fills.length = 0;
    Renderer.prototype.drawMap.call(renderer, game);
    assert.ok(fills.includes(colour), `${id} tiles take ${colour}`);
    assert.ok(adventureMapLayout(game).markers.some(marker => marker.id === id && marker.kind === 'secret'));
  }
  const shrine = OVERWORLD.shrines.find(p => p.id === 'orchard-shrine');
  Object.assign(game.player, { x: shrine.x, y: shrine.y });
  assert.ok(adventureMapLayout(game).markers.some(marker => marker.id === 'orchard-shrine' && marker.kind === 'shrine'));
});
