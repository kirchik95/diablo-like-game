import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, ArcRotateCamera, Vector3, RawTexture, Texture } from '@babylonjs/core';
import * as rendering from '../src/render.js';
import { createSprite } from '../src/pixel-scene.js';

function fixture(t) {
  const engine = new NullEngine(), scene = new Scene(engine);
  const camera = new ArcRotateCamera('isometric', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const texture = RawTexture.CreateRGBATexture(new Uint8Array(16).fill(255), 2, 2, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
  const atlas = { texture, columns: 2, rows: 2, cell: 1, anchor: [.5, 1] };
  return { scene, camera, mesh: createSprite(scene, 'actor', atlas).mesh, reference: createSprite(scene, 'reference', atlas).mesh };
}

test('an unchanged actor pose retains its native matrix and skips redundant bounds updates', t => {
  const { scene, mesh } = fixture(t);
  assert.equal(typeof rendering.setActorPosition, 'function');
  rendering.setActorPosition(mesh, 1, .025, -72);
  mesh.getBoundingInfo(); // Flush the first pose's lazy bounds update.
  const version = mesh.worldMatrixFromCache.updateFlag;
  let bounds = 0;
  const update = mesh._updateBoundingInfo;
  mesh._updateBoundingInfo = function (...args) { bounds++; return update.apply(this, args); };
  for (let i = 0; i < 30; i++) {
    scene.incrementRenderId();
    rendering.setActorPosition(mesh, 1, .025, -72);
    mesh.computeWorldMatrix();
    mesh.getBoundingInfo();
  }
  assert.equal(mesh.worldMatrixFromCache.updateFlag, version);
  assert.equal(bounds, 0);
});

test('moving/jumping actors and a translating fixed camera match the always-computed native matrix and bounds', t => {
  const { scene, camera, mesh, reference } = fixture(t);
  assert.equal(typeof rendering.setActorPosition, 'function');
  const poses = [[0, .025, 0], [0, .025, -72], [0, .275, -72], [0, .275, -72], [3, .025, -70], [-0, .025, -0]];
  for (const [x, y, z] of poses) {
    camera.target.set(x + .025, .1, z - .7);
    camera.getViewMatrix();
    reference.position.set(x, y, z);
    reference.computeWorldMatrix(true);
    rendering.setActorPosition(mesh, x, y, z);
    scene.incrementRenderId();
    assert.deepEqual(mesh.computeWorldMatrix().asArray().slice(), reference.worldMatrixFromCache.asArray().slice());
    for (const key of ['minimumWorld', 'maximumWorld']) {
      assert.deepEqual(mesh.getBoundingInfo().boundingBox[key].asArray(), reference.getBoundingInfo().boundingBox[key].asArray());
    }
  }
});

test('camera-only translation preserves the exact billboard matrix of an unchanged actor', t => {
  const { scene, camera, mesh, reference } = fixture(t);
  assert.equal(typeof rendering.setActorPosition, 'function');
  for (const [x, z] of [[0, 0], [0, -72], [.625, -73], [17, -104], [-28, -89]]) {
    camera.target.set(x, .1, z);
    camera.getViewMatrix();
    reference.position.set(3, .025, -72);
    reference.computeWorldMatrix(true);
    rendering.setActorPosition(mesh, 3, .025, -72);
    scene.incrementRenderId();
    assert.deepEqual(mesh.computeWorldMatrix().asArray().slice(), reference.worldMatrixFromCache.asArray().slice());
    assert.deepEqual(mesh.getBoundingInfo().boundingBox.minimumWorld.asArray(), reference.getBoundingInfo().boundingBox.minimumWorld.asArray());
    assert.deepEqual(mesh.getBoundingInfo().boundingBox.maximumWorld.asArray(), reference.getBoundingInfo().boundingBox.maximumWorld.asArray());
  }
});

test('active actors use native updates and leave the cache when activation or movement begins', t => {
  const { scene, mesh, reference } = fixture(t);
  rendering.setActorPosition(mesh, 1, .025, -72, false);
  assert.equal(mesh.isWorldMatrixFrozen, false);
  rendering.setActorPosition(mesh, 1, .025, -72, true);
  assert.equal(mesh.isWorldMatrixFrozen, true);
  for (const [x, y, z] of [[1, .025, -72], [2, .275, -71]]) {
    rendering.setActorPosition(mesh, x, y, z, false);
    assert.equal(mesh.isWorldMatrixFrozen, false);
    reference.position.set(x, y, z);
    scene.incrementRenderId();
    assert.deepEqual(mesh.computeWorldMatrix().asArray().slice(), reference.computeWorldMatrix().asArray().slice());
  }
  rendering.setActorPosition(mesh, 2, .275, -71, true);
  assert.equal(mesh.isWorldMatrixFrozen, true);
});
