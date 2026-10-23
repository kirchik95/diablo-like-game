import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, Texture, ArcRotateCamera, Camera, Vector3, VertexBuffer } from '@babylonjs/core';
import { OVERWORLD, getOverworldZone } from '../src/overworld.js';
import { MONK_RULES } from '../src/monk-combat.js';
import { layoutLandscape } from '../src/landscape.js';
import { countrySurfaceMap } from '../src/country-terrain.js';
import { buildPixelWorld, pixelAtlases, createSprite, createShadow } from '../src/pixel-scene.js';
import { Renderer, adventureMapLayout } from '../src/render.js';
import { PresentationState, monkPose } from '../src/pixel-animation.js';
import { createAdventure } from '../src/game.js';
import { isWalkable } from '../src/world.js';

const key = (x, y) => `${x},${y}`;
const counts = scene => [scene.meshes.length, scene.materials.length, scene.multiMaterials.length, scene.textures.length];
function harness(t, withRenderer = false) {
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
  const baseline = counts(scene), world = buildPixelWorld(scene, assets, OVERWORLD);
  if (!withRenderer) return { scene, assets, world, baseline };
  const game = createAdventure();
  Object.assign(game, { world: OVERWORLD, locationId: 'camp', locationRevision: 0, projectiles: [], pickups: [],
    adventure: { quest: 'outbound', secretFound: false, rewardCollected: false } });
  Object.assign(game.player, OVERWORLD.spawn);
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    engine, scene, camera, assets, game, world, width: 720, height: 450, locationRevision: 0,
    followTarget: camera.target.clone(), shake: 0, reducedMotion: false,
    presentation: new PresentationState(game), fxSprites: new Map(), hounds: [],
    monk: createSprite(scene, 'monk', assets.monk), monkShadow: createShadow(scene, 'monk-shadow'),
    drawOverlay() {}, drawMap() {},
  });
  return { renderer, game, scene, world };
}

test('union has one flat landscape, one surface mask and all translated scenery without portal art', t => {
  const { scene, assets, world, baseline } = harness(t);
  assert.equal(scene.textures.filter(t => t.name === 'country-surface-mask').length, 1);
  assert.equal(scene.materials.filter(m => m.name === 'country-ground').length, 1);
  assert.equal(scene.meshes.filter(m => m.name === 'country-details').length, 1);
  assert.equal(scene.meshes.filter(m => m.metadata?.landscapeSurface).length, 2);
  for (const mesh of world.landscape.meshes) {
    assert.equal(mesh.material, world.landscape.groundMaterial, 'inside and outside have no separate edge tint');
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    for (let i = 1; i < positions.length; i += 3) assert.equal(positions[i], 0);
  }
  // Camp stone sprites may be named outcrop-cliff; terrain itself has no such geometry.
  assert.ok(!scene.meshes.some(m => !m.name.startsWith('camp-') && /cliff|perimeter|portal|threshold|cut-stone-edge/.test(m.name)));
  assert.deepEqual(world.portals, []);
  const camp = OVERWORLD.zones.find(z => z.id === 'camp');
  const authored = world.props.filter(p => p.placement);
  assert.equal(authored.length, camp.setDressing.length);
  for (const sprite of authored) {
    const p = sprite.placement;
    assert.deepEqual([sprite.mesh.position.x, sprite.mesh.position.y, sprite.mesh.position.z], [p.x, p.layer === 'ground' ? .012 : .03, p.y]);
    assert.equal(sprite.mesh.scaling.x, p.scale); assert.equal(sprite.flip, p.flip);
  }
  assert.ok(world.fires.some(f => f.sprite?.atlas === assets.campFlame));
  assert.equal(world.fires.length, OVERWORLD.braziers.length);
  assert.equal(world.shrine.mesh.position.z, OVERWORLD.shrine.y - .5);
  assert.equal(world.secret.chest.position.z, OVERWORLD.secret.y);
  assert.equal(world.reward.bead.position.z, OVERWORLD.reward.y);
  assert.equal(world.ritual.seal.position.z, OVERWORLD.ritual.y);
  assert.equal(world.columns.length, OVERWORLD.pillars.length);
  world.dispose(); world.dispose();
  assert.deepEqual(counts(scene), baseline, 'the complete persistent world must release all owned resources');
  assert.ok(Object.values(assets).every(a => scene.textures.includes(a.texture)), 'shared atlas textures survive');
});

test('walk mask has no painted height edge or cliff shading in the continuous surface field', () => {
  const extent = { minX: -25, maxX: 25, minY: -96, maxY: 24 };
  const original = countrySurfaceMap(OVERWORLD, extent);
  const withoutBoundary = countrySurfaceMap({ ...OVERWORLD, tiles: [{ x: 0, y: 0 }] }, extent);
  assert.deepEqual(withoutBoundary.data, original.data,
    'the visible field depends on paving, clearings and biomes, never a shaded walk-mask rim');
});

test('union borders only its exterior and keeps both continuous route seams clear', () => {
  const before = JSON.stringify(OVERWORLD), layout = layoutLandscape(OVERWORLD);
  const walk = new Set(OVERWORLD.tiles.map(p => key(p.x, p.y)));
  for (const edge of layout.boundary) assert.ok(!walk.has(key(edge.x + edge.dx, edge.y + edge.dy)));
  for (const p of [...layout.border, ...layout.scenery]) {
    assert.equal(p.height, 0);
    assert.ok(!walk.has(key(Math.round(p.contact.x), Math.round(p.contact.y))));
    assert.ok(getOverworldZone(p.contact.x, p.contact.y).id !== 'camp' || !p.border, 'camp retains its authored belt');
  }
  assert.ok(layout.border.some(p => p.frame === 'ruin-pile' && p.contact.y < -70.5));
  assert.ok(layout.border.some(p => p.frame === 'cypress' && p.contact.y > -70.5));
  const weights = (x, y) => {
    const map = layout.surfaceMap, offset = (Math.floor((y - map.origin.y) * 8) * map.width + Math.floor((x - map.origin.x) * 8)) * 4;
    return [...map.data.subarray(offset, offset + 3)];
  };
  for (const seam of [-29.5, -70.5]) for (let y = seam - 2; y <= seam + 2; y += .5) {
    assert.ok(isWalkable(0, y, .29, OVERWORLD));
    assert.ok(weights(0, y)[0] < 128, `worn route interrupted at ${y}`);
    assert.ok(layout.border.every(p => Math.hypot(p.contact.x, p.contact.y - y) > 1.5));
  }
  assert.ok(weights(0, -90)[2] > 128, 'court gets stone from its zone instead of the world id');
  assert.equal(JSON.stringify(OVERWORLD), before);
  for (const p of layout.groundCover) {
    assert.ok(OVERWORLD.encounters.every(e => Math.hypot(e.x - p.x, e.y - p.y) >= 2.2));
    if (p.category === 'vegetation') assert.ok(OVERWORLD.paving.every(q => Math.hypot(p.x - q.x, p.y - q.y) >= 1.65));
  }
});

test('area label changes preserve world, actors, effects and GPU resources at native camera scale', t => {
  const { renderer: r, game, scene } = harness(t, true);
  game.events = [{ type: 'impact', x: 0, y: -30, strength: 'light' }];
  game.projectiles = [{ id: 'shot', x: 0, y: -30, radius: .13, dx: 0, dy: -1 }];
  game.pickups = [{ id: 'drop', x: 1, y: -31, amount: 18 }];
  r.render(game, 0);
  const built = r.world, floor = built.floor, mask = built.landscape.groundMaterial;
  const actors = [...r.hounds], effects = [...r.fxSprites.values()], shot = r.projectiles.get('shot');
  const initial = counts(scene), time = r.presentation.time;
  for (const y of [-29.6, -70.6, -70.4, -29.4]) {
    game.locationId = getOverworldZone(0, y).id; game.player.y = y;
    r.render(game, 0);
    assert.equal(r.world, built); assert.equal(r.world.floor, floor); assert.equal(built.landscape.groundMaterial, mask);
    assert.deepEqual(r.hounds, actors); assert.deepEqual([...r.fxSprites.values()], effects);
    assert.equal(r.projectiles.get('shot'), shot); assert.deepEqual(counts(scene), initial);
    assert.equal(r.presentation.time, time);
    assert.equal(r.width / (r.camera.orthoRight - r.camera.orthoLeft), 32);
  }
});

test('health drops stay anchored, freeze when paused and release meshes/materials on collection or restart', t => {
  const { renderer: r, game, scene } = harness(t, true);
  r.render(game, 0); const baseline = counts(scene);
  game.pickups = [{ id: 'drop', x: -2, y: -40, amount: MONK_RULES.pickup.amount }];
  r.render(game, .1);
  const view = r.pickups.get('drop');
  assert.equal(view.mesh.position.x, -2); assert.equal(view.mesh.position.z, -40);
  const position = view.mesh.position.asArray(); r.render(game, 3, 'paused');
  assert.deepEqual(view.mesh.position.asArray(), position);
  game.pickups = []; r.render(game, 0);
  assert.ok(view.mesh.isDisposed()); assert.deepEqual(counts(scene), baseline);
  game.pickups = [{ id: 'drop-2', x: 0, y: -42, amount: 18 }]; r.render(game, 0);
  const next = r.pickups.get('drop-2');
  const fresh = { ...game, player: { ...game.player }, pickups: [], events: [] };
  r.render(fresh, 0);
  assert.ok(next.mesh.isDisposed()); assert.deepEqual(counts(scene), baseline);
});

test('map keeps a legible local scale and names the current area across both seams', () => {
  let scale;
  for (const y of [10, -29.6, -60, -70.6, -90]) {
    const game = { world: OVERWORLD, player: { x: 0, y }, locationId: getOverworldZone(0, y).id };
    const map = adventureMapLayout(game);
    assert.ok(map.scale >= 5, 'do not squeeze the long region into unreadable pixels');
    scale ??= map.scale; assert.equal(map.scale, scale);
    assert.equal(map.title, getOverworldZone(0, y).title);
    assert.ok(map.tiles.length < OVERWORLD.tiles.length);
    const p = map.project(0, y); assert.ok(p.x > 20 && p.x < 340 && p.y > 50 && p.y < 230);
    for (const point of [...map.tiles, ...map.markers]) assert.ok(map.visible(point.x, point.y));
    assert.ok(!map.markers.some(m => m.kind === 'portal'));
  }
});

test('combo keyframes fit shared timings including the final recovery drawing', () => {
  const body = { hp: 100, dx: 0, dy: 1, dashTime: 0 };
  MONK_RULES.combo.duration.forEach((duration, index) => {
    const frames = pixelAtlases.monk.clips[`attack${index + 1}`].front;
    const pose = age => monkPose({ ...body, attack: { index, age } }).frame;
    assert.equal(pose(MONK_RULES.combo.hitTime[index]), frames[2]);
    assert.equal(pose(duration - 1 / 120), frames.at(-1));
  });
});

test('heavy feedback is stronger, bounded for crowds and disabled by reduced motion', t => {
  const { renderer: r, game } = harness(t, true);
  const impact = strength => ({ type: 'impact', x: 0, y: 10, strength });
  game.events = [impact('light')]; r.render(game, 0); const light = r.shake;
  const lightSize = [...r.fxSprites.values()].at(-1).mesh.scaling.x;
  assert.ok(light > 0 && light < .06);
  r.presentation.effects = []; r.shake = 0;
  game.events = [impact('heavy')]; r.render(game, 0); const heavy = r.shake;
  assert.ok([...r.fxSprites.values()].at(-1).mesh.scaling.x > lightSize);
  assert.ok(heavy > light && heavy <= .1);
  r.presentation.effects = []; r.shake = 0;
  game.events = Array.from({ length: 12 }, () => impact('heavy')); r.render(game, 0);
  assert.equal(r.shake, heavy, 'one hit across a pack must not stack twelve camera impulses');
  game.events = []; r.render(game, .2); assert.equal(r.shake, 0);
  r.reducedMotion = true; game.events = [impact('heavy')]; r.render(game, 0); assert.equal(r.shake, 0);
});

test('wave rings and sparks reach the real 3.4u radius without overshooting it', () => {
  const operations = [], rings = [], points = [];
  const context = new Proxy({}, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      assert.ok(args.every(value => typeof value !== 'number' || Number.isFinite(value)));
      operations.push([key, ...args]);
    };
  } });
  const p = { x: 0, y: -50 }, game = { world: OVERWORLD, player: p, enemies: [], pickups: [] };
  const renderer = { ctx: context, width: 720, height: 450, camera: { orthoTop: 450 / 64 },
    world: { fires: [], portals: [], bounds: {} }, presentation: { effects: [], player: { flash: 0 }, hounds: [] },
    project(x, y, height) { points.push({ x, y, height }); return { x, y }; },
    drawRing(x, y, radius) { rings.push(radius); },
  };
  for (const age of [0, .1, .25, .49]) {
    rings.length = points.length = 0;
    renderer.presentation.effects = [{ type: 'wave', ...p, age, life: .5 }];
    Renderer.prototype.drawOverlay.call(renderer, game, age, 'playing');
    assert.equal(rings.length, 2); assert.ok(rings.every(r => r <= MONK_RULES.wave.radius));
    for (const spark of points.slice(-18)) assert.ok(Math.hypot(spark.x - p.x, spark.y - p.y) <= MONK_RULES.wave.radius + 1e-8);
    if (age > .2) assert.equal(rings[0], MONK_RULES.wave.radius);
  }
  renderer.map = context;
  assert.doesNotThrow(() => Renderer.prototype.drawMap.call(renderer, game));
  assert.ok(operations.some(([name, title]) => name === 'fillText' && title === getOverworldZone(p.x, p.y).title));
});
