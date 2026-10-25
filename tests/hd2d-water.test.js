import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3 } from '@babylonjs/core';
import { OVERWORLD } from '../src/overworld.js';
import { isWalkable } from '../src/world.js';
import { MeshBuilder, Texture } from '@babylonjs/core';
import { install as installBloom } from '../src/hd2d/bloom.js';

// Missing tier cleanup would leave draws/RTs in the off frame. All resources here are real Babylon objects.
const module = await import('../src/hd2d/water.js').catch(() => null);
test('water effect exposes the HD lifecycle', () => {
  assert.equal(typeof module?.install, 'function');
});
function harness(t, tier = 'off') {
  const engine = new NullEngine({ renderWidth: 506, renderHeight: 234 });
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('qa', Math.PI / 4, Math.PI / 3, 30, new Vector3(0, 0, -72), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoLeft = -8; camera.orthoRight = 8; camera.orthoTop = 4; camera.orthoBottom = -4;
  const renderer = { world: { data: OVERWORLD, props: [] }, reducedMotion: false };
  t.after(() => { scene.dispose(); engine.dispose(); });
  return { engine, scene, camera, renderer, tier };
}
test('off installs no scene resources and high to off restores resource counts', t => {
  assert.ok(module);
  const ctx = harness(t), before = [ctx.scene.meshes.length, ctx.scene.materials.length, ctx.scene.textures.length];
  const effect = module.install(ctx);
  effect.update(1 / 60, 1);
  assert.deepEqual([ctx.scene.meshes.length, ctx.scene.materials.length, ctx.scene.textures.length], before);
  effect.setTier('low'); effect.update(1 / 60, 2);
  assert.ok(ctx.scene.meshes.length > before[0]);
  assert.equal(ctx.scene.customRenderTargets.length, 0);
  effect.setTier('high'); effect.update(1 / 60, 3);
  assert.equal(ctx.scene.customRenderTargets.length, 1);
  const mirror = ctx.scene.customRenderTargets[0];
  assert.ok(mirror.getSize().width <= 506 / 4 && mirror.getSize().height <= 234 / 4);
  assert.ok(mirror.renderList.length <= 12);
  effect.setTier('off');
  assert.equal(ctx.scene.customRenderTargets.length, 0);
  assert.deepEqual([ctx.scene.meshes.length, ctx.scene.materials.length, ctx.scene.textures.length], before);
  effect.dispose(); effect.dispose();
});
test('high removes the reflection pass while water is offscreen and survives a new world', t => {
  assert.ok(module);
  const ctx = harness(t, 'high'), effect = module.install(ctx);
  effect.update(1 / 60, 1);
  assert.equal(ctx.scene.customRenderTargets.length, 1);
  ctx.camera.target.set(500, 0, 500); effect.update(1 / 60, 2);
  assert.equal(ctx.scene.customRenderTargets.length, 0);
  ctx.renderer.world = { data: { id: 'camp', offset: { x: 0, y: 0 } }, props: [] };
  effect.onWorld(ctx.renderer); effect.update(1 / 60, 3);
  assert.equal(ctx.scene.meshes.filter(m => m.name.startsWith('hd-water')).length, 0);
  effect.dispose();
});
test('the cemetery ditch is wholly outside the playable mask', () => {
  assert.ok(module);
  const ditch = module.waterSites(OVERWORLD).find(p => p.id === 'cemetery-ditch');
  assert.ok(ditch);
  for (let x = ditch.x - ditch.width / 2; x <= ditch.x + ditch.width / 2; x += .2)
    for (let y = ditch.y - ditch.depth / 2; y <= ditch.y + ditch.depth / 2; y += .2)
      assert.equal(isWalkable(x, y, 0, OVERWORLD), false, `${x},${y}`);
});
test('container water keeps a strict depth bias through a new run and never owns the art texture', t => {
  assert.ok(module);
  const ctx = harness(t, 'low');
  const texture = new Texture(null, ctx.scene);
  const mesh = MeshBuilder.CreatePlane('original-basin', {}, ctx.scene);
  const prop = { mesh, atlas: { texture, columns: 4, rows: 8 }, frame: 16, placement: { id: 'basin', kind: 'stone-basin' } };
  ctx.renderer.world.props.push(prop);
  const effect = module.install(ctx);
  const water = ctx.scene.meshes.find(m => m.id === 'hd-water-basin');
  assert.ok(water.material.zOffsetUnits < 0, 'coplanar water must beat either original/batched prop draw order');
  prop.material = { alpha: .18 }; effect.update(0, 0);
  assert.equal(water.material.needAlphaBlending(), true, 'water follows the existing prop fade instead of leaving a floating opaque disc');
  assert.equal(water.material._floats.opacity, .18);
  effect.dispose();
  assert.ok(ctx.scene.textures.includes(texture), 'atlas is borrowed');
  assert.equal(mesh.isDisposed(), false);
});
test('offscreen containers do not add a high reflection pass', t => {
  assert.ok(module);
  const ctx = harness(t, 'high');
  ctx.camera.target.set(-12, 0, -120);
  const texture = new Texture(null, ctx.scene), mesh = MeshBuilder.CreatePlane('distant-well', {}, ctx.scene);
  mesh.position.set(-30, 0, -129);
  ctx.renderer.world = { data: { id: 'orchard' }, props: [{ mesh, atlas: { texture, columns: 4, rows: 8 }, frame: 6, placement: { id: 'well', kind: 'well' } }] };
  const effect = module.install(ctx); effect.update(1 / 60, 1);
  assert.equal(ctx.scene.customRenderTargets.length, 0);
  assert.equal(ctx.scene.meshes.find(m => m.id === 'hd-water-well').isEnabled(), false);
  effect.dispose();
});
test('well water stays visible when the mouth is in-frame but the ground anchor is below it', t => {
  assert.ok(module);
  const ctx = harness(t, 'low'); ctx.camera.target.set(-6.6, 0, -6.6);
  const texture = new Texture(null, ctx.scene), mesh = MeshBuilder.CreatePlane('well', {}, ctx.scene);
  ctx.renderer.world = { data: { id: 'orchard' }, props: [{ mesh, atlas: { texture, columns: 4, rows: 8 }, frame: 6, placement: { id: 'well', kind: 'well' } }] };
  const effect = module.install(ctx); effect.update(1 / 60, 1);
  assert.equal(ctx.scene.meshes.find(m => m.id === 'hd-water-well').isEnabled(), true);
  effect.dispose();
});
test('moving the camera reuses reflection meshes as candidates change', t => {
  assert.ok(module);
  const ctx = harness(t, 'high'), texture = new Texture(null, ctx.scene);
  for (let i = 0; i < 13; i++) {
    const mesh = MeshBuilder.CreatePlane(`prop-${i}`, {}, ctx.scene);
    mesh.billboardMode = 7; mesh.position.set(i === 0 ? -9.9 : 0, 0, -72);
    ctx.renderer.world.props.push({ mesh, atlas: { texture, columns: 4, rows: 8 }, frame: 0 });
  }
  const effect = module.install(ctx); effect.update(1 / 60, 1);
  const pool = ctx.scene.meshes.filter(m => m.name === 'hd-water-reflected-prop');
  assert.equal(pool.length, 12);
  ctx.camera.target.x = 1; effect.update(1 / 60, 2);
  assert.ok(pool.every(m => !m.isDisposed() && ctx.scene.meshes.includes(m)));
  assert.equal(ctx.scene.meshes.filter(m => m.name === 'hd-water-reflected-prop').length, 12);
  effect.dispose();
});
test('water glints enter the real selective bloom emitter mask', async t => {
  assert.ok(module);
  const ctx = harness(t, 'low'), effect = module.install(ctx);
  effect.update(0, 0);
  const bloom = installBloom(ctx);
  t.after(() => { bloom.dispose(); effect.dispose(); });
  for (let i = 0; i < 25; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    bloom.update(0, 0); ctx.scene.render();
  }
  const extract = ctx.engine.postProcesses.find(p => p.name === 'hd-bloom-mask');
  let count = -1;
  // Observe the real uniform boundary: NullEngine has no GPU uniform storage.
  extract.onApplyObservable.notifyObservers({ setFloat2() {}, setArray4() {}, setFloat(name, value) { if (name === 'count') count = value; } });
  assert.ok(count > 0, 'visible ripple highlights must be admitted as bloom emitters');
});
