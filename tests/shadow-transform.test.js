import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';
import * as rendering from '../src/render.js';
import { createShadow } from '../src/pixel-scene.js';

const set = (vector, x, y, z) => {
  assert.equal(typeof rendering.setVectorIfChanged, 'function');
  return rendering.setVectorIfChanged(vector, x, y, z);
};
function fixture(t) {
  const engine = new NullEngine(), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  return { scene, renderer: { pixelsPerUnit: () => 64 } };
}

test('identical vector writes preserve dirty state; real changes preserve numeric bits', () => {
  const vector = new Vector3(0, .2, -72);
  vector._isDirty = false;
  assert.equal(set(vector, 0, .2, -72), vector);
  assert.equal(vector._isDirty, false);
  set(vector, -0, .2, -72);
  assert.ok(Object.is(vector.x, -0));
  assert.equal(vector._isDirty, true);
  set(vector, -0, .2, -72);
  assert.equal(vector._isDirty, true, 'existing dirty state must survive a no-op');
  vector._isDirty = false;
  set(vector, -0, .20000000000000004, -72);
  assert.equal(vector.y, .20000000000000004);
  assert.equal(vector._isDirty, true);
});

test('unchanged contact shadows retain world matrices and skip bounding updates', t => {
  const { scene, renderer } = fixture(t), shadow = createShadow(scene, 'shadow');
  const anchor = { x: 3, y: -72 }, style = { offset: 3 };
  rendering.Renderer.prototype.placeShadow.call(renderer, shadow, anchor, style, false, .024);
  shadow.computeWorldMatrix(true);
  const version = shadow.worldMatrixFromCache.updateFlag;
  let bounds = 0;
  const original = shadow._updateBoundingInfo;
  shadow._updateBoundingInfo = function (...args) { bounds++; return original.apply(this, args); };
  for (let i = 0; i < 30; i++) {
    scene.incrementRenderId();
    rendering.Renderer.prototype.placeShadow.call(renderer, shadow, anchor, style, false, .024);
    shadow.computeWorldMatrix();
  }
  assert.equal(shadow.worldMatrixFromCache.updateFlag, version);
  assert.equal(bounds, 0);
});

test('movement, mirroring and leap scales match the always-written Babylon reference exactly', t => {
  const { scene, renderer } = fixture(t), shadow = createShadow(scene, 'shadow'), reference = createShadow(scene, 'reference');
  const style = { offset: 3 };
  const poses = [[0, 0, false, 1], [0, -72, true, 1], [0, -72, true, .8], [0, -72, true, .8], [3, -70, false, 1], [-0, -0, false, 1]];
  for (const [x, y, flip, scale] of poses) {
    const shift = Math.round(style.offset * 64 / 32) * (flip ? -1 : 1) / 64 * Math.SQRT1_2;
    reference.position.set(x - shift, .024, y + shift);
    reference.scaling.setAll(scale);
    rendering.Renderer.prototype.placeShadow.call(renderer, shadow, { x, y }, style, flip, .024);
    set(shadow.scaling, scale, scale, scale);
    scene.incrementRenderId();
    assert.deepEqual(shadow.computeWorldMatrix().asArray().slice(), reference.computeWorldMatrix().asArray().slice());
    for (const key of ['minimumWorld', 'maximumWorld']) {
      assert.deepEqual(shadow.getBoundingInfo().boundingBox[key].asArray(), reference.getBoundingInfo().boundingBox[key].asArray());
    }
  }
});
