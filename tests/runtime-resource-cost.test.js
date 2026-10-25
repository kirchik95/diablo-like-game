import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, Mesh, Material, StandardMaterial, Texture, RawTexture, ArcRotateCamera, Vector3 } from '@babylonjs/core';
import { Renderer } from '../src/render.js';
import { createPixelBillboard, createSprite, disposeSprite, wraithShotPixels } from '../src/pixel-scene.js';

function sceneWithExistingArt(t) {
  const engine = new NullEngine(), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const existing = new StandardMaterial('existing', scene);
  for (let i = 0; i < 32; i++) new Mesh(`existing-${i}`, scene).material = existing;
  return scene;
}
function trackWalks(scene) {
  const counts = { meshes: 0, materials: 0 }, restore = [];
  for (const key of Object.keys(counts)) {
    const list = scene[key], iterate = list[Symbol.iterator];
    list[Symbol.iterator] = function () { counts[key]++; return iterate.call(this); };
    restore.push(() => { delete list[Symbol.iterator]; });
  }
  return { counts, stop: () => restore.forEach(call => call()) };
}

test('new procedural art does not scan existing scene resources to invalidate an unbound texture or material', t => {
  const scene = sceneWithExistingArt(t), before = [scene.meshes.length, scene.materials.length, scene.textures.length];
  const walks = trackWalks(scene);
  let view;
  try { view = createPixelBillboard(scene, 'runtime-shot', 'shot-test', wraithShotPixels); }
  finally { walks.stop(); }
  assert.deepEqual(walks.counts, { meshes: 0, materials: 0 });
  assert.equal(view.material.diffuseTexture.hasAlpha, true);
  assert.equal(view.material.blockDirtyMechanism, false, 'future edits retain normal dirty tracking');
  assert.equal(view.material.getAlphaTestTexture(), view.material.diffuseTexture);
  view.mesh.dispose();
  assert.deepEqual([scene.meshes.length, scene.materials.length, scene.textures.length], before, 'ordinary last-user disposal is preserved');
});

test('new atlas material resumes dirty tracking without a full mesh walk before its first use', t => {
  const scene = sceneWithExistingArt(t), texture = new Texture(null, scene);
  texture.hasAlpha = true;
  const atlas = { texture, cell: 16, anchor: [8, 12], columns: 1, rows: 1 };
  const walks = trackWalks(scene);
  let sprite;
  try { sprite = createSprite(scene, 'runtime-impact', atlas); }
  finally { walks.stop(); }
  assert.equal(walks.counts.meshes, 0);
  assert.equal(sprite.material.blockDirtyMechanism, false);
  assert.equal(sprite.material.useAlphaFromDiffuseTexture, true);
  disposeSprite(sprite);
  assert.ok(scene.textures.includes(texture), 'disposing a clone does not release its source atlas');
});


test('shader warmup is invisible, bounded and keeps common shot textures ready for later bursts', async t => {
  const scene = sceneWithExistingArt(t);
  // NullEngine allocates raw storage but never marks it GPU-ready; emulate that one backend signal.
  const engine = scene.getEngine(), createRaw = engine.createRawTexture;
  t.mock.method(engine, 'createRawTexture', function (...args) {
    const texture = createRaw.apply(this, args); texture.isReady = true; return texture;
  });
  new ArcRotateCamera('warm-camera', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  const texture = RawTexture.CreateRGBATexture(new Uint8Array(8 * 8 * 4).fill(255), 8, 8, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
  texture.hasAlpha = true;
  const effects = { texture, cell: 8, anchor: [4, 4], columns: 1, rows: 1 };
  const renderer = Object.assign(Object.create(Renderer.prototype), { scene, assets: { effects } });
  const existing = scene.materials[0], before = [existing.alpha, existing.transparencyMode, existing.blockDirtyMechanism];
  assert.equal(typeof renderer.warmPrograms, 'function');
  await renderer.warmPrograms();
  assert.deepEqual([existing.alpha, existing.transparencyMode, existing.blockDirtyMechanism], before);
  const pins = scene.meshes.filter(mesh => mesh.name.startsWith('warm-'));
  assert.ok(pins.length > 0 && pins.every(mesh => !mesh.isEnabled()), 'warm resources cannot enter a rendered frame');
  const counts = [scene.meshes.length, scene.materials.length, scene.textures.length];
  await renderer.warmPrograms();
  assert.deepEqual([scene.meshes.length, scene.materials.length, scene.textures.length], counts, 'warmup runs once');
  const effectsBeforePickup = Object.keys(engine._compiledEffects).sort();
  renderer.updatePickups({ pickups: [{ id: 'later-health', x: 0, y: 0 }] }, 0);
  const pickup = renderer.pickups.get('later-health');
  pickup.mesh.computeWorldMatrix(true);
  await pickup.mesh.material.forceCompilationAsync(pickup.mesh);
  assert.deepEqual(Object.keys(engine._compiledEffects).sort(), effectsBeforePickup, 'first health drop uses a warmed program');
  renderer.updatePickups({ pickups: [] }, 0);
  const scaled = createSprite(scene, 'later-scaled-effect', effects);
  scaled.mesh.scaling.set(1, 2, 1); scaled.mesh.computeWorldMatrix(true);
  await scaled.material.forceCompilationAsync(scaled.mesh);
  scaled.material.alpha = .25; scaled.material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  await scaled.material.forceCompilationAsync(scaled.mesh);
  assert.deepEqual(Object.keys(engine._compiledEffects).sort(), effectsBeforePickup, 'scaled effects use warmed test/blend programs');
  disposeSprite(scaled);

  const shotTexture = scene.textures.find(item => item.name === 'pixel-shot-wraith');
  assert.ok(shotTexture);
  const shot = createPixelBillboard(scene, 'later-shot', 'shot-wraith', wraithShotPixels);
  assert.equal(shot.material.diffuseTexture, shotTexture);
  shot.mesh.dispose();
  assert.ok(scene.textures.includes(shotTexture), 'a later burst reuses the warm texture after the last live shot');
  scene.dispose();
  assert.equal(scene.textures.length, 0);
});
