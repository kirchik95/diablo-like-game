import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix, Texture } from '@babylonjs/core';
import { Renderer } from '../src/render.js';
import { createSprite, createShadow, buildPixelWorld, pixelAtlases } from '../src/pixel-scene.js';
import { PresentationState } from '../src/pixel-animation.js';
import { createGame, updateGame } from '../src/game.js';
import { SHRINE } from '../src/world.js';
import v1 from '../assets/game/pixel-v1/manifest.json' with { type: 'json' };
import monkPackage from '../assets/game/pixel-v2/monk/manifest.json' with { type: 'json' };
import package2 from '../assets/game/pixel-v2/hound-world/manifest.json' with { type: 'json' };

function harness(t) {
  const engine = new NullEngine({ renderWidth: 800, renderHeight: 450 });
  // Only the ritual-seal 2D canvas and the network texture pixels are external here.
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() {},
  }) });
  const scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const camera = new ArcRotateCamera('animation-camera', Math.PI / 4, Math.PI / 3, 30, new Vector3(0, .1, 1.2), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -12.5, orthoRight: 12.5, orthoTop: 450 / 64, orthoBottom: -450 / 64 });
  const assets = {};
  for (const [name, atlas] of Object.entries({ monk: monkPackage.monk,
    hound: package2.hound, world: package2.world, effects: package2.effects, environment: v1.environment, floor: v1.floor })) {
    assets[name] = { ...atlas, texture: new Texture(null, scene) };
  }
  const game = createGame();
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    engine, scene, camera, assets, game, width: 800, height: 450,
    followTarget: camera.target.clone(), shake: 0, reducedMotion: false,
    presentation: new PresentationState(game), fxSprites: new Map(),
    world: buildPixelWorld(scene, assets),
    monk: createSprite(scene, 'monk', assets.monk),
    monkShadow: createShadow(scene, 'monk-shadow'),
    hounds: game.enemies.map((e, i) => ({ sprite: createSprite(scene, `hound-${i}`, assets.hound),
      shadow: createShadow(scene, `hound-shadow-${i}`), warning: createSprite(scene, `warning-${i}`, assets.effects) })),
    // Overlay typography and minimap drawing are reviewed in Chrome, not Node.
    drawOverlay() {}, drawMap() {},
  });
  for (const hound of renderer.hounds) hound.warning.mesh.isVisible = false;
  return { game, renderer, assets };
}

test('v2 renderer: dynamic scenery uses world clips while the existing column atlas remains intact', t => {
  const { renderer: r, assets } = harness(t);
  assert.equal(r.world.gate.atlas, assets.world);
  assert.equal(r.world.gate.frame, 18);
  assert.equal(r.world.shrine.atlas, assets.world);
  assert.equal(r.world.shrine.frame, 12);
  assert.ok(r.world.fires.every(f => f.sprite.atlas === assets.world));
  assert.ok(r.world.columns.every(c => c.atlas === assets.environment && c.frame === 2));
});

test('camp flame follows its four authored frames and freezes on pause without animating the base', t => {
  const { renderer: r, game } = harness(t);
  r.assets.campFlame = { ...pixelAtlases.campFlame, texture: new Texture(null, r.scene) };
  const flame = createSprite(r.scene, 'camp-flame', r.assets.campFlame);
  const base = createSprite(r.scene, 'campfire-base', { ...pixelAtlases.camp, texture: new Texture(null, r.scene) }, 3);
  r.world.fires.push({ sprite: flame, base });
  assert.doesNotThrow(() => r.render(game, 0), 'camp flame must not look up a legacy world clip');
  assert.equal(flame.frame, 0);
  for (const expected of [1, 2, 3, 0]) {
    r.render(game, .13);
    assert.equal(flame.frame, expected);
    assert.equal(base.frame, 3);
    const position = flame.mesh.position.asArray();
    r.render(game, 1, 'paused');
    assert.equal(flame.frame, expected);
    assert.deepEqual(flame.mesh.position.asArray(), position);
  }
});

test('v2 renderer: paused camera, pose and scenery freeze; death keeps rendering after defeat', t => {
  const { game, renderer: r } = harness(t);
  r.render(game, .1);
  const camera = r.camera.target.clone(), frame = r.monk.frame, fire = r.world.fires[0].sprite.frame;
  r.render(game, 1, 'paused');
  assert.deepEqual(r.camera.target.asArray(), camera.asArray());
  assert.equal(r.monk.frame, frame);
  assert.equal(r.world.fires[0].sprite.frame, fire);
  game.player.hp = 0; game.phase = 'defeat';
  r.render(game, 0);
  assert.equal(r.monk.frame, 94);
  r.render(game, 1, 'defeat');
  assert.equal(r.monk.frame, 99);
  r.render(createGame(), 0);
  assert.equal(r.monk.frame, 50);
});

test('v2 renderer: event FX expire and warning keys follow windup rather than a free-running loop', t => {
  const { game, renderer: r } = harness(t);
  game.events.push({ type: 'impact', x: 1, y: 2 }, { type: 'heal', x: 0, y: 1 });
  Object.assign(game.enemies[0], { state: 'windup', timer: .55 });
  r.render(game, 0);
  assert.equal(r.fxSprites.size, 2);
  assert.equal(r.hounds[0].warning.mesh.isVisible, true);
  assert.equal(r.hounds[0].warning.frame, 6);
  game.enemies[0].timer = .03;
  r.render(game, .1);
  assert.equal(r.hounds[0].warning.frame, 11);
  game.enemies[0].state = 'stunned';
  r.render(game, 1);
  assert.equal(r.hounds[0].warning.mesh.isVisible, false);
  assert.equal(r.fxSprites.size, 0);
});

test('v2 renderer: pausing on an impact preserves its exact camera displacement', t => {
  const { game, renderer: r } = harness(t);
  r.render(game, .1);
  game.events.push({ type: 'impact', x: 0, y: 0 });
  r.render(game, .016);
  const camera = r.camera.target.asArray(), shake = r.shake;
  r.render(game, 1, 'paused');
  assert.equal(r.shake, shake);
  assert.deepEqual(r.camera.target.asArray(), camera);
});

test('v2 renderer: hurt retains one camera impulse while reduced motion suppresses it', t => {
  const { game, renderer: r } = harness(t);
  game.events.push({ type: 'hurt', x: 0, y: 0 });
  r.render(game, .016);
  assert.ok(r.shake > 0);
  const reduced = harness(t);
  reduced.renderer.reducedMotion = true;
  reduced.game.events.push({ type: 'hurt', x: 0, y: 0 });
  reduced.renderer.render(reduced.game, .016);
  assert.equal(reduced.renderer.shake, 0);
});

test('v2 renderer: authored warning arrow follows eight actual windup headings on the isometric floor', t => {
  const { game, renderer: r } = harness(t);
  const project = point => Vector3.Project(point, Matrix.Identity(), r.scene.getTransformMatrix(), r.camera.viewport.toGlobal(800, 450));
  for (let heading = 0; heading < 8; heading++) {
    const angle = heading * Math.PI / 4, dx = Math.cos(angle), dy = Math.sin(angle);
    Object.assign(game.player, { x: dx, y: dy });
    Object.assign(game.enemies[0], { x: 0, y: 0, state: 'chase', attackCooldown: 0 });
    updateGame(game, {}, 1 / 120);
    assert.equal(game.enemies[0].state, 'windup');
    for (let i = 0; i < 44; i++) updateGame(game, {}, 1 / 120);
    r.render(game, 0);
    const warning = r.hounds[0].warning;
    assert.equal(warning.frame, 10, 'key 05 contains the clearly rightward authored chevron');
    const matrix = warning.mesh.computeWorldMatrix(true);
    const world = point => Vector3.TransformCoordinates(point, matrix);
    const origin = world(Vector3.Zero());
    const arrow = project(world(new Vector3(1, 0, 0))).subtract(project(origin));
    const attack = project(origin.add(new Vector3(dx, 0, dy))).subtract(project(origin));
    const agreement = (arrow.x * attack.x + arrow.y * attack.y) / (Math.hypot(arrow.x, arrow.y) * Math.hypot(attack.x, attack.y));
    assert.ok(agreement > .99999, `heading ${heading}: arrow contradicts the locked leap vector (${agreement})`);

    // The source ring is drawn as a 2:1 ellipse. Its ground projection must keep
    // that shape for every heading, rather than rotating an ellipse on screen.
    const ring = Array.from({ length: 64 }, (_, i) => {
      const a = i * Math.PI / 32;
      const point = world(new Vector3(Math.cos(a), Math.sin(a) / 2, 0));
      assert.ok(Math.abs(point.y - origin.y) < 1e-6, 'warning ink must stay on the ground plane');
      return project(point);
    });
    const width = Math.max(...ring.map(p => p.x)) - Math.min(...ring.map(p => p.x));
    const height = Math.max(...ring.map(p => p.y)) - Math.min(...ring.map(p => p.y));
    assert.ok(Math.abs(width - 64) < .001 && Math.abs(height - 32) < .001,
      `heading ${heading}: expected fixed isometric ellipse, got ${width} x ${height}`);
  }
});

test('v2 renderer: the healing halo is within one native pixel of the floor while impact keeps its height', t => {
  const { game, renderer: r } = harness(t);
  Object.assign(game.player, { x: SHRINE.x, y: SHRINE.y, hp: 60 });
  updateGame(game, {}, 1 / 120);
  assert.ok(game.events.some(event => event.type === 'heal'));
  assert.equal(game.player.hp, 100, 'healing still happens immediately in simulation');
  game.events.push({ type: 'impact', x: SHRINE.x, y: SHRINE.y });
  r.render(game, 0);
  r.render(game, .25);
  const healing = [...r.fxSprites].find(([event]) => event.type === 'heal')[1];
  const impact = [...r.fxSprites].find(([event]) => event.type === 'impact')[1];
  assert.equal(healing.frame, 15, 'key 04 contains the ground halo');
  const project = point => Vector3.Project(point, Matrix.Identity(), r.scene.getTransformMatrix(), r.camera.viewport.toGlobal(800, 450));
  const floor = project(new Vector3(SHRINE.x, 0, SHRINE.y));
  const halo = project(healing.mesh.position);
  assert.ok(Math.hypot(halo.x - floor.x, halo.y - floor.y) <= 1,
    `healing halo floats ${floor.y - halo.y} native pixels above the floor`);
  assert.equal(impact.mesh.position.y, .65, 'impact registration must remain separate from healing');
});
