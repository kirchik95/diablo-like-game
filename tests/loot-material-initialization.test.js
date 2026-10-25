import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder, Texture, Material } from '@babylonjs/core';
import { Renderer } from '../src/render.js';
import { createSprite, lootAtlases, lootGroundFrames, LOOT_GROUND, LOOT_STACK } from '../src/pixel-scene.js';
import { createStarterWeapons } from '../src/items.js';

function fixture(t) {
  const engine = new NullEngine(), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  for (let i = 0; i < 20; i++) MeshBuilder.CreatePlane(`existing-${i}`, {}, scene);
  const atlas = { ...lootAtlases.lootGround, texture: new Texture(null, scene) };
  return { scene, atlas };
}

test('loot layer materials do not scan existing scenery while being initialized', t => {
  const { scene, atlas } = fixture(t);
  const original = Material.prototype._markAllSubMeshesAsDirty;
  let scans = 0;
  Material.prototype._markAllSubMeshesAsDirty = function (...args) {
    if (this.getScene() === scene && this.name.startsWith('loot-') && !this.blockDirtyMechanism && !scene.blockMaterialDirtyMechanism) scans++;
    return original.apply(this, args);
  };
  t.after(() => { Material.prototype._markAllSubMeshesAsDirty = original; });
  const item = createStarterWeapons()[0], frames = lootGroundFrames(item);
  const renderer = Object.assign(Object.create(Renderer.prototype), { scene, assets: { lootGround: atlas } });
  const view = renderer.createLootStack({ id: item.id, item }, frames, 7);
  assert.equal(scans, 0, 'new, never-rendered loot materials need no scenery dirty scans');
  assert.deepEqual(Object.keys(view.layers), [...LOOT_STACK]);
  assert.equal(view.layers.shadow.material.alpha, LOOT_GROUND.shadow.drawAlpha);
  assert.equal(view.layers.item.material.transparencyMode, Material.MATERIAL_ALPHATEST);
  assert.ok(Object.values(view.layers).every(s => !s.material.blockDirtyMechanism && !s.material.isFrozen));
  view.layers.shadow.material.alpha = 1;
  assert.ok(scans > 0, 'normal native invalidation remains active after initialization');
});

test('sprite initial ink options preserve native materials and default behavior', t => {
  const { scene, atlas } = fixture(t);
  const standard = createSprite(scene, 'default', atlas);
  const blended = createSprite(scene, 'blended', atlas, 0, { transparencyMode: Material.MATERIAL_ALPHABLEND, alpha: .4 });
  assert.equal(standard.material.alpha, 1);
  assert.equal(standard.material.transparencyMode, Material.MATERIAL_ALPHATEST);
  assert.equal(blended.material.getClassName(), 'StandardMaterial');
  assert.equal(blended.material.alpha, .4);
  assert.equal(blended.material.transparencyMode, Material.MATERIAL_ALPHABLEND);
  assert.equal(blended.material.blockDirtyMechanism, false);
  assert.equal(blended.material.isFrozen, false);
  assert.equal(blended.texture.uScale, standard.texture.uScale);
  assert.equal(blended.texture.vScale, standard.texture.vScale);
});
