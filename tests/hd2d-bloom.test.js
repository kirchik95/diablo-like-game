import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess.js';
import '@babylonjs/core/Shaders/pass.fragment.js';
import { createHD2D, effects } from '../src/hd2d/index.js';
import { install } from '../src/hd2d/bloom.js';

function fixture(t) {
  const engine = new NullEngine({ renderWidth: 600, renderHeight: 280 });
  const scene = new Scene(engine), camera = new FreeCamera('camera', Vector3.Zero(), scene);
  t.after(() => engine.dispose());
  const foreign = new PostProcess('foreign', 'pass', [], [], 1, camera);
  const bloom = install({ scene, engine, camera, renderer: {}, tier: 'off' });
  return { engine, scene, camera, foreign, bloom };
}

test('off installs no passes and repeated disposal preserves another camera effect', t => {
  const { engine, scene, camera, foreign, bloom } = fixture(t);
  bloom.update(1 / 60, 1);
  assert.deepEqual(camera._postProcesses.filter(Boolean), [foreign]);
  assert.equal(scene.postProcesses.length, 1);
  bloom.dispose(); bloom.dispose();
  assert.deepEqual(camera._postProcesses.filter(Boolean), [foreign]);
});

test('tier transitions dispose bloom resources and preserve foreign camera effects', t => {
  const { engine, scene, camera, foreign, bloom } = fixture(t);
  for (const tier of ['low', 'high', 'low']) {
    bloom.setTier(tier); bloom.update(1 / 60, 1);
    assert.equal(engine.postProcesses.length, 4);
    bloom.setTier('off');
    assert.equal(engine.postProcesses.length, 0);
    assert.equal(scene.postProcesses.length, 1);
    assert.deepEqual(camera._postProcesses.filter(Boolean), [foreign]);
  }
  bloom.setTier('high'); bloom.dispose(); bloom.setTier('low');
  assert.equal(scene.postProcesses.length, 1);
});

test('ready bloom precedes a later DOF pass after toggles and releases rendered targets', async t => {
  const { engine, scene, camera, foreign, bloom } = fixture(t);
  foreign.name = 'zone-grade';
  const later = new PostProcess('hd2d-dof', 'pass', [], [], 1, camera);
  const warm = async () => {
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
      bloom.update();
      if (camera._postProcesses.filter(Boolean).length === 6) break;
    }
    const chain = camera._postProcesses.filter(Boolean);
    assert.equal(chain.length, 6, 'the real bloom shaders must attach');
    assert.equal(chain[0], foreign);
    assert.ok(chain.at(-1) === later, 'DOF must follow bloom');
    scene.render();
    assert.ok(chain.slice(1,5).every(pass => pass.inputTexture?.texture && pass.width > 0), 'attached passes must have allocated targets');
    return chain.slice(1,5).map(pass => pass.inputTexture.texture);
  };
  for (let i = 0; i < 3; i++) {
    bloom.setTier('low'); const targets = await warm();
    bloom.setTier('off');
    assert.deepEqual(camera._postProcesses.filter(Boolean), [foreign, later]);
    assert.ok(camera._postProcesses.length <= 6, 'toggles must not accumulate empty slots');
    assert.equal(engine.postProcesses.length, 0);
    // NullEngine._releaseTexture is a no-op: dead handles stay in its cache.
    // Real GPU cache removal is checked separately in the browser fixture.
    assert.ok(targets.every(texture => texture._references === 0), 'all four allocated bloom targets must be released');
  }
});

// Real production registry; no test host or renderer hook.
test('production registry registers bloom; real host honors overrides and releases it', async t => {
  const { engine, scene, camera, foreign } = fixture(t);
  const registered = effects.filter(module => module.id === 'bloom');
  assert.equal(registered.length, 1);
  const host = createHD2D({ engine, scene, camera, renderer: {} }, 'off', registered);
  assert.equal(host.active, false);
  host.setTier('low');
  for (let i = 0; i < 20 && camera._postProcesses.filter(Boolean).length < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    host.update(1 / 60, 1);
  }
  assert.equal(host.active, true);
  assert.equal(camera._postProcesses.filter(Boolean).length, 5);
  scene.render();
  host.setTier({ tier: 'high', overrides: { bloom: 'off' } });
  assert.equal(host.active, false);
  assert.deepEqual(camera._postProcesses.filter(Boolean), [foreign]);
  host.onWorld(); host.dispose();
  assert.equal(engine.postProcesses.length, 0);
});
