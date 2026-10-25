import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, Texture, StandardMaterial, Observable, ArcRotateCamera, Vector3, Matrix } from '@babylonjs/core/index.js';
import { createSprite, pixelAtlases } from '../src/pixel-scene.js';
import { StaticSpriteBatch } from '../src/static-batch.js';
import { captureStaticSpriteState } from '../src/static-sprite-shape.js';
import { watchSpriteFrame, watchProperty, setWithoutNotice } from '../src/static-sprite-state.js';

function setup(t) {
  const engine = new NullEngine(), scene = new Scene(engine);
  engine.getCaps().instancedArrays = true;
  new ArcRotateCamera('camera', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  const atlas = { ...pixelAtlases.campPanorama, texture: new Texture(null, scene) };
  t.after(() => { scene.dispose(); engine.dispose(); });
  return { scene, atlas };
}

function capture(build) {
  return captureStaticSpriteState(StandardMaterial, Texture, Observable, build);
}

function props(t) {
  const fixture = setup(t);
  const sprites = capture(() => [0, 1, 2].map(i => {
    const sprite = createSprite(fixture.scene, `sprite-${i}`, fixture.atlas);
    sprite.mesh.position.set(i * 20, .03, i * 20);
    sprite.mesh.freezeWorldMatrix();
    return sprite;
  }));
  return { ...fixture, sprites };
}

test('captured static materials and textures share shapes and preserve clone values', t => {
  const { sprites } = props(t);
  assert.equal(Object.getPrototypeOf(sprites[0].material), Object.getPrototypeOf(sprites[1].material));
  assert.equal(Object.getPrototypeOf(sprites[0].texture), Object.getPrototypeOf(sprites[1].texture));
  assert.equal(Object.hasOwn(sprites[0].material, 'alphaCutOff'), false);
  assert.equal(Object.hasOwn(sprites[0].texture, 'uOffset'), false);
  assert.equal(sprites[0].material.constructor, StandardMaterial);
  sprites[0].texture.uOffset = .125;
  sprites[0].material.zOffset = 2;
  const texture = sprites[0].texture.clone(), material = sprites[0].material.clone('copy');
  assert.equal(texture.uOffset, .125);
  assert.equal(material.zOffset, 2);
  assert.equal(material.alphaCutOff, .5);
  assert.equal(Object.getPrototypeOf(material), StandardMaterial.prototype);
  material.dispose(); texture.dispose();
});

test('native prototypes restore after nested throws and observer-created actors stay native', t => {
  const { scene } = setup(t), keys = ['alphaCutOff', 'zOffset', 'disableDepthWrite'];
  const before = keys.map(key => Object.getOwnPropertyDescriptor(StandardMaterial.prototype, key));
  const notify = Observable.prototype.notifyObservers;
  let actorMaterial, actorTexture;
  scene.onNewTextureAddedObservable.addOnce(() => {
    actorTexture = new Texture(null, scene);
    actorMaterial = new StandardMaterial('actor', scene);
  });
  assert.throws(() => capture(() => capture(() => {
    new Texture(null, scene);
    throw Error('stop');
  })), /stop/);
  assert.deepEqual(keys.map(key => Object.getOwnPropertyDescriptor(StandardMaterial.prototype, key)), before);
  assert.equal(Observable.prototype.notifyObservers, notify);
  assert.equal(Object.getPrototypeOf(actorMaterial), StandardMaterial.prototype);
  assert.equal(Object.getPrototypeOf(actorTexture), Texture.prototype);
  assert.equal(Object.hasOwn(actorMaterial, 'zOffset'), true);
  assert.equal(Object.hasOwn(actorTexture, 'uOffset'), true);
});

test('shared subscriptions immediately retain material, UV, geometry and matrix fallback', t => {
  const { scene, sprites } = props(t), batch = new StaticSpriteBatch(scene, { props: sprites });
  assert.equal(Object.hasOwn(sprites[0].mesh, 'isVisible'), false);
  assert.equal(Object.hasOwn(sprites[0].material, 'alphaCutOff'), false);
  assert.equal(Object.getOwnPropertyDescriptor(sprites[0].mesh.worldMatrixFromCache, 'updateFlag').get, undefined);
  sprites[0].material.zOffset = .1;
  batch.update();
  assert.notEqual(sprites[0].mesh.layerMask, 0);
  sprites[0].material.zOffset = 0;
  batch.update();
  assert.equal(sprites[0].mesh.layerMask, 0);
  sprites[0].texture.uOffset = .2;
  batch.update();
  assert.notEqual(sprites[0].mesh.layerMask, 0);
  sprites[1].mesh.getWorldMatrix().copyFrom(Matrix.Translation(1, 0, 0));
  batch.update();
  assert.notEqual(sprites[1].mesh.layerMask, 0);
  sprites[2].mesh.geometry.releaseForMesh(sprites[2].mesh);
  batch.update();
  assert.notEqual(sprites[2].mesh.layerMask, 0);
  batch.dispose();
  assert.equal(sprites[0].material.alphaCutOff, .5);
  assert.equal(sprites[0].texture.uOffset, .2);
});

test('scalar notifications enqueue without repeated native reference reads', t => {
  const { scene, sprites } = props(t), batch = new StaticSpriteBatch(scene, { props: sprites });
  const mesh = sprites[0].mesh, geometry = mesh.geometry;
  let reads = 0;
  Object.defineProperty(mesh, 'geometry', { configurable: true, get() { reads++; return geometry; } });
  sprites[0].material.emissiveColor.set(.9, .8, .7);
  assert.equal(reads, 0);
  batch.update();
  assert.ok(reads <= 2);
  assert.notEqual(mesh.layerMask, 0);
  delete mesh.geometry;
  batch.dispose();
});

test('fallback forwarding retains shared values until its final unsubscribe', t => {
  const { sprites } = props(t), sprite = sprites[0], mesh = sprite.mesh;
  let changes = 0;
  const offShared = watchSpriteFrame(sprite, () => {});
  Object.defineProperty(sprite, 'frame', { value: 2, configurable: true, writable: true });
  const offFallback = watchProperty(sprite, 'mesh', () => changes++);
  offShared();
  assert.equal(sprite.mesh, mesh);
  const replacement = {};
  sprite.mesh = replacement;
  assert.equal(changes, 1);
  offFallback();
  assert.equal(sprite.mesh, replacement);
  sprite.mesh = mesh;
});

test('silent writes suppress shared and forwarding fallback listeners', t => {
  const { sprites } = props(t), sprite = sprites[0];
  let changes = 0;
  const offShared = watchSpriteFrame(sprite, () => {});
  Object.defineProperty(sprite, 'frame', { value: 2, configurable: true, writable: true });
  const offFallback = watchProperty(sprite, 'mesh', () => changes++);
  setWithoutNotice(sprite, 'mesh', sprites[1].mesh);
  assert.equal(changes, 0);
  offFallback(); offShared();
});

test('a self-unsubscribing listener does not skip the next listener', t => {
  const { sprites } = props(t), calls = [];
  let offFirst;
  offFirst = watchSpriteFrame(sprites[0], () => { calls.push('first'); offFirst(); });
  const offSecond = watchSpriteFrame(sprites[0], () => calls.push('second'));
  sprites[0].frame = 3;
  assert.deepEqual(calls, ['first', 'second']);
  offSecond();
});


test('hot captured scalar reads do not query WeakMap', t => {
  const { scene, sprites } = props(t), batch = new StaticSpriteBatch(scene, { props: sprites });
  const material = sprites[0].material, texture = sprites[0].texture, color = material.emissiveColor;
  const get = WeakMap.prototype.get;
  let reads = 0, sum = 0;
  t.mock.method(WeakMap.prototype, 'get', function(key) { reads++; return get.call(this, key); });
  for (let i = 0; i < 100; i++) sum += color.r + color.g + color.b + material.alphaCutOff + texture.uOffset;
  assert.ok(Number.isFinite(sum));
  assert.equal(reads, 0, 'engine scalar reads stay on the object data path');
  batch.dispose();
});

test('shared accessors do not borrow a parent instance state', t => {
  const { sprites } = props(t), material = sprites[0].material;
  const child = Object.create(material), getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(material), 'alphaCutOff').get;
  assert.equal(getter.call(child), undefined);
  assert.equal(material.alphaCutOff, .5);
});


test('a released shared object can be subscribed again with its current values', t => {
  const { sprites } = props(t), sprite = sprites[0];
  const offFirst = watchSpriteFrame(sprite, () => {});
  sprite.frame = 2; offFirst();
  let calls = 0;
  const offSecond = watchSpriteFrame(sprite, () => calls++);
  assert.equal(sprite.frame, 2);
  sprite.frame = 3;
  assert.equal(calls, 1);
  offSecond();
  assert.equal(Object.getOwnPropertyDescriptor(sprite, 'frame').value, 3);
});
