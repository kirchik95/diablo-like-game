import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { install as particles } from '../src/hd2d/particles.js';
import { install as bloom } from '../src/hd2d/bloom.js';

async function fixture(t, zone = 'courtyard', tier = 'high') {
  const engine = new NullEngine({ renderWidth: 600, renderHeight: 280 });
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('camera', Math.PI / 4, Math.PI / 3, 30, new Vector3(40, 0, -80), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.orthoLeft = -12; camera.orthoRight = 12; camera.orthoBottom = -5.6; camera.orthoTop = 5.6;
  const data = { id: zone, spawn: { x: 40, y: -80 }, ritual: { x: 40, y: -80 }, setDressing: [{ kind: 'campfire-base', x: 40, y: -80 }] };
  const renderer = { world: { data }, camera, reducedMotion: false };
  const ctx = { engine, scene, camera, renderer };
  const air = particles({ ...ctx, tier });
  const halo = bloom({ ...ctx, tier: 'low' });
  t.after(() => { halo.dispose(); air.dispose(); scene.dispose(); engine.dispose(); });
  const mask = engine.postProcesses.find(p => p.name === 'hd-bloom-mask');
  for (let i = 0; i < 50 && !mask.isReady(); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(mask.isReady(), 'real bloom mask shader must be ready');
  const uniforms = () => {
    const values = {};
    mask.onApplyObservable.notifyObservers({
      setFloat2() {},
      setArray4(name, data) { values[name] = Array.from(data); },
      setFloat(name, value) { values[name] = value; },
    });
    return values;
  };
  const frame = (time = 3) => { for (let i = 0; i < 20; i++) air.update(1 / 60, time); halo.update(); return uniforms(); };
  return { engine, scene, camera, renderer, air, halo, frame, uniforms };
}
const covered = (uniforms, x, y) => {
  for (let i = 0; i < uniforms.count; i++) {
    const at = i * 4, r = uniforms.emitters;
    if (x >= r[at] - 1e-6 && y >= r[at+1] - 1e-6 && x <= r[at+2] + 1e-6 && y <= r[at+3] + 1e-6) return true;
  }
  return false;
};

test('real bloom mask uniforms include luminous particles far from their CPU quad bounds', async t => {
  const { frame, renderer, scene } = await fixture(t);
  const values = frame();
  assert.ok(values.count > 0, 'R3: particles must reach hd-bloom-mask count');
  assert.equal(covered(values, .02, .02), false, 'a remote corner must not become a whole-screen emission mask');
  const mesh = scene.meshes.find(m => m.name === 'hd2d-particles');
  assert.ok(mesh.getBoundingInfo().boundingBox.maximumWorld.x <= 1, 'fixture keeps the original CPU unit quads');
  const emission = renderer.hd2dParticleBloom;
  assert.ok(emission.count > 0);
  for (let i = 0; i < emission.count; i++) {
    const at = i * 4, r = emission.rects;
    assert.ok(covered(values, r[at], r[at+1]));
    assert.ok(covered(values, r[at+2], r[at+3]));
  }
});

test('existing emitters and particle bounds survive the existing 24-rectangle uniform budget', async t => {
  const { frame, scene, camera, renderer, halo, air, uniforms } = await fixture(t);
  for (let i = 0; i < 24; i++) {
    const source = MeshBuilder.CreateBox(`flame-peer-${i}`, { size: .08 }, scene);
    source.position.set(35 + i % 6 * 1.6, .5, -83 + Math.floor(i / 6) * 1.5);
    source.computeWorldMatrix(true);
  }
  halo.onWorld();
  const values = frame();
  assert.equal(values.count, 24);
  for (const source of scene.meshes.filter(m => m.name.startsWith('flame-peer-'))) {
    for (const corner of source.getBoundingInfo().boundingBox.vectorsWorld) {
      const p = Vector3.Project(corner, Matrix.Identity(), camera.getTransformationMatrix(), { x: 0, y: 0, width: 1, height: 1 });
      assert.ok(covered(values, p.x, 1 - p.y), source.name);
    }
  }
  const emission = renderer.hd2dParticleBloom;
  assert.ok(emission.count > 0);
  for (let i = 0; i < emission.count; i++) {
    const at = i * 4;
    assert.ok(covered(values, emission.rects[at], emission.rects[at+1]));
    assert.ok(covered(values, emission.rects[at+2], emission.rects[at+3]));
  }
  air.setTier('off'); halo.update();
  const withoutParticles = uniforms();
  assert.equal(withoutParticles.count, 24, 'particle off must preserve the named sources');
  for (const source of scene.meshes.filter(m => m.name.startsWith('flame-peer-'))) {
    const p = Vector3.Project(source.position, Matrix.Identity(), camera.getTransformationMatrix(), { x: 0, y: 0, width: 1, height: 1 });
    assert.ok(covered(withoutParticles, p.x, 1 - p.y));
  }
});

test('particle off removes only particle coverage while bloom remains enabled', async t => {
  const { frame, air, halo, renderer, uniforms } = await fixture(t);
  assert.ok(frame().count > 0);
  air.setTier('off'); halo.update();
  assert.equal(uniforms().count, 0);
  assert.equal(renderer.hd2dParticleBloom.count, 0);
  air.dispose();
  assert.equal(renderer.hd2dParticleBloom, undefined);
});

test('luminous zones publish low/high bounds from the submitted prefix, while road publishes none', async t => {
  for (const zone of ['camp', 'road', 'courtyard', 'cemetery', 'orchard']) {
    const { frame, renderer, air } = await fixture(t, zone, 'low');
    frame(4);
    const service = renderer.hd2dParticleBloom, lowCount = service.count;
    const low = service.rects.slice(0, lowCount * 4);
    if (zone === 'road') assert.equal(lowCount, 0);
    else assert.ok(lowCount > 0, zone);
    air.setTier('high'); frame(4);
    assert.equal(renderer.hd2dParticleBloom, service, 'pooled service must be reused');
    assert.ok(service.count >= lowCount);
    assert.deepEqual(service.rects.slice(0, lowCount * 4), low);
    for (const value of service.rects.slice(0, service.count * 4)) assert.ok(value >= 0 && value <= 1);
  }
});

test('already-enabled bloom sees a later particle install, and world changes clear obsolete coverage', async t => {
  const { frame, air, halo, renderer, uniforms } = await fixture(t, 'camp', 'off');
  assert.equal(frame().count, 0);
  assert.equal(renderer.hd2dParticleBloom, undefined);
  air.setTier('high');
  assert.ok(frame().count > 0, 'no source-name scan or observer delay is required');
  renderer.world = { data: { id: 'road' } };
  air.onWorld(renderer); halo.update();
  assert.equal(uniforms().count, 0);
  assert.equal(frame().count, 0);
  renderer.world = { data: { id: 'camp' } }; // No fire: do not publish a false mask at the camera.
  air.onWorld(renderer);
  assert.equal(frame().count, 0);
});

test('reduced-motion bounds hold shader time, and projected bounds follow the camera', async t => {
  const { frame, renderer, camera } = await fixture(t, 'camp');
  renderer.reducedMotion = true;
  frame(10);
  const service = renderer.hd2dParticleBloom;
  const still = service.rects.slice(0, service.count * 4);
  frame(100);
  assert.deepEqual(service.rects.slice(0, service.count * 4), still);
  camera.target.set(140, 0, -180);
  assert.equal(frame(100).count, 0, 'a distant fire must leave the mask');
  camera.target.set(40, 0, -80);
  assert.ok(frame(100).count > 0);
});

test('particles clipped by the camera depth range do not publish a false emission mask', async t => {
  const { frame, camera } = await fixture(t);
  assert.ok(frame().count > 0);
  camera.maxZ = 5; // Camera radius is 30; all particle quads are beyond the far plane.
  assert.equal(frame().count, 0);
  camera.maxZ = 100;
  assert.ok(frame().count > 0);
});
