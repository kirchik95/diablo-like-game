import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix } from '@babylonjs/core';
import { Renderer } from '../src/render.js';
import { Input } from '../src/input.js';

test('pointer CSS coordinates aim at the same world point on a high-DPI display', () => {
  // NullEngine hardcodes scale=1; represent the real Engine's Retina contract.
  class RetinaEngine extends NullEngine { getHardwareScalingLevel() { return 2 / 3; } }
  const engine = new RetinaEngine({ renderWidth: 2160, renderHeight: 1350, textureSize: 512 });
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('test', Math.PI / 4, .85, 28, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoTop = 6.8; camera.orthoBottom = -6.8; camera.orthoLeft = -10.88; camera.orthoRight = 10.88;
  scene.render();
  const renderer = { scene, camera, engine, width: 1440, height: 900 };
  for (const point of [new Vector3(0, 0, 0), new Vector3(2, 0, -3)]) {
    const screen = Vector3.Project(point, Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(1440, 900));
    const actual = Renderer.prototype.screenToWorld.call(renderer, screen.x, screen.y);
    assert.ok(Math.abs(actual.x - point.x) < .001, `${actual.x} should equal ${point.x}`);
    assert.ok(Math.abs(actual.y - point.z) < .001, `${actual.y} should equal ${point.z}`);
  }
  scene.dispose(); engine.dispose();
});

test('D and A move right and left on the fixed Babylon camera', () => {
  const engine = new NullEngine({ renderWidth: 1440, renderHeight: 900 });
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('test', Math.PI / 4, .85, 28, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoTop = 6.8; camera.orthoBottom = -6.8; camera.orthoLeft = -10.88; camera.orthoRight = 10.88;
  scene.render();
  for (const [code, direction] of [['KeyD', 1], ['KeyA', -1]]) {
    const sample = Input.prototype.sample.call({ keys: new Set([code]), pointer: null, actions: [] }, { x: 0, y: 0, dx: 0, dy: -1 });
    const actual = Vector3.Project(new Vector3(sample.moveX, 0, sample.moveY), Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(1440, 900));
    assert.ok((actual.x - 720) * direction > 1, `${code} moved to screen x=${actual.x}`);
    assert.ok(Math.abs(actual.y - 450) < .001);
  }
  scene.dispose(); engine.dispose();
});

test('movement-facing preserves a zero world component before pointer input', () => {
  const sample = Input.prototype.sample.call({ keys: new Set(['KeyW', 'KeyA']), pointer: null, actions: [] }, { x: 0, y: 0, dx: 1, dy: 0 });
  assert.equal(sample.aimX, 0);
  assert.ok(sample.aimY < -1);
});
