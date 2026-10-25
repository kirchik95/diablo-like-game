import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { install } from '../src/hd2d/particles.js';

function fixture(t, tier = 'off') {
  const engine = new NullEngine({ renderWidth: 633, renderHeight: 292 });
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('camera', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  const data = { id: 'camp', spawn: { x: 0, y: 0 }, setDressing: [{ kind: 'campfire-base', x: -4, y: -3 }] };
  const renderer = { world: { data }, camera, reducedMotion: false, game: { player: { x: 0, y: 0 } } };
  const effect = install({ engine, scene, camera, renderer, tier });
  t.after(() => { effect.dispose(); scene.dispose(); engine.dispose(); });
  return { engine, scene, camera, renderer, effect };
}

test('off installation and update leave scene resources untouched', t => {
  const { scene, effect } = fixture(t);
  effect.update(1 / 60, 10);
  assert.equal(scene.meshes.length, 0);
  assert.equal(scene.materials.length, 0);
  assert.equal(scene.textures.length, 0);
});

test('one nonpickable pool halves its submitted geometry at low and disables at off', t => {
  const { scene, effect } = fixture(t, 'high');
  effect.update(1 / 60, 10);
  assert.equal(scene.meshes.length, 1);
  const mesh = scene.meshes[0];
  assert.equal(mesh.isPickable, false);
  assert.equal(mesh.subMeshes.length, 1);
  const full = mesh.subMeshes[0].indexCount;
  assert.ok(full > 0);
  effect.setTier('low');
  effect.update(1 / 60, 11);
  assert.equal(mesh.subMeshes[0].indexCount, full / 2);
  effect.setTier('off');
  assert.equal(mesh.isEnabled(), false);
  effect.setTier('high');
  effect.update(1 / 60, 12);
  assert.equal(scene.meshes.length, 1);
  assert.equal(mesh.subMeshes[0].indexCount, full);
});

test('world replacement and missing emitters reuse the pool; disposal releases all owned resources', t => {
  const { scene, renderer, effect } = fixture(t, 'low');
  effect.update(1 / 60, 2);
  const mesh = scene.meshes[0];
  renderer.world = { data: { id: 'road', spawn: { x: 2, y: -70 } } };
  renderer.game.player.y = -70;
  effect.onWorld(renderer);
  effect.update(1, 3);
  assert.equal(scene.meshes[0], mesh);
  assert.equal(scene.meshes.length, 1);
  assert.equal(scene.materials.length, 1);
  effect.dispose(); effect.dispose();
  assert.equal(scene.meshes.length, 0);
  assert.equal(scene.materials.length, 0);
  assert.equal(scene.textures.length, 0);
  effect.update(1, 4); effect.setTier('high');
  assert.equal(scene.meshes.length, 0);
});

test('low submesh keeps bounds required by Babylon transparent sorting', t => {
  const { scene, effect } = fixture(t, 'low');
  effect.update(1 / 60, 1);
  const submesh = scene.meshes[0].subMeshes[0];
  assert.ok(submesh.getBoundingInfo()?.boundingSphere, 'low must keep sorting bounds after halving indices');
  assert.doesNotThrow(() => scene.render());
});

test('air draws after opaque actor geometry so sprite depth can occlude it', async t => {
  const { MeshBuilder } = await import('@babylonjs/core/Meshes/meshBuilder.js');
  const { StandardMaterial } = await import('@babylonjs/core/Materials/standardMaterial.js');
  const { scene, effect } = fixture(t, 'high');
  effect.update(1, 1);
  const actor = MeshBuilder.CreateBox('actor', { size: 1 }, scene);
  actor.renderingGroupId = 1;
  actor.material = new StandardMaterial('actor-ink', scene);
  actor.material.disableLighting = true;
  await actor.material.forceCompilationAsync(actor);
  const order = [];
  actor.material.onBindObservable.add(() => order.push('actor'));
  scene.meshes[0].material.onBindObservable.add(() => order.push('air'));
  scene.render();
  assert.deepEqual(order, ['actor', 'air']);
});

test('air respects exclusive side-zone edges when selecting its palette', async t => {
  const { OVERWORLD } = await import('../src/overworld.js');
  const { scene, camera, renderer, effect } = fixture(t, 'low');
  renderer.world = { data: OVERWORLD };
  effect.onWorld(renderer);
  camera.target.set(15, 0, -41.5);
  effect.update(1, 2);
  assert.equal(scene.meshes[0].material._floats.zone, 0, 'cemetery north edge belongs to the camp spine band');
  effect.onWorld(renderer);
  camera.target.set(-13.5, 0, -120);
  effect.update(1, 2);
  assert.equal(scene.meshes[0].material._floats.zone, 2, 'orchard east edge belongs to courtyard');
});

test('real HD host forwards tiers, overrides, world changes and disposal to particles', async t => {
  const { createHD2D } = await import('../src/hd2d/index.js');
  const particles = await import('../src/hd2d/particles.js');
  const { engine, scene, camera, renderer } = fixture(t);
  const host = createHD2D({ engine, scene, camera, renderer }, 'off', [particles]);
  t.after(() => host.dispose());
  assert.equal(host.active, false);
  assert.equal(scene.meshes.length, 0);
  host.setTier({ tier: 'off', overrides: { particles: 'low' } });
  host.update(1 / 60, 3);
  assert.equal(host.active, true);
  assert.equal(scene.meshes.length, 1);
  renderer.world = { data: { id: 'orchard', spawn: { x: -20, y: -120 } } };
  host.onWorld(renderer);
  host.update(1 / 60, 4);
  assert.equal(scene.meshes[0].material._floats.zone, 4);
  host.setTier({ tier: 'high', overrides: { particles: 'off' } });
  assert.equal(host.active, false);
  assert.equal(scene.meshes[0].isEnabled(), false);
  host.dispose();
  assert.equal(scene.meshes.length, 0);
  assert.equal(scene.materials.length, 0);
});
