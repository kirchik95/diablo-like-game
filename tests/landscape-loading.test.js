import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, Texture } from '@babylonjs/core';
import { loadPixelAssets, pixelAssetUrls, createSprite } from '../src/pixel-scene.js';
import { opaqueSpritePixel } from '../src/pixel-picking.js';
import { readPng } from './helpers/png.js';

function harness(t) {
  const engine = new NullEngine(), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  // Node has no file:// fetch transport; everything else is the real loader.
  t.mock.method(globalThis, 'fetch', async url => new Response(readFileSync(new URL(url))));
  return { engine, scene };
}

test('the landscape package loads through common readiness with repeated opaque surfaces and matching sprite masks', async t => {
  const { scene } = harness(t), assets = loadPixelAssets(scene);
  await assets.ready;
  for (const name of ['earth', 'moss', 'cliff']) {
    const { texture } = assets[name];
    assert.equal(texture.samplingMode, Texture.NEAREST_SAMPLINGMODE);
    assert.equal(texture.noMipmap, true);
    assert.equal(texture.hasAlpha, false);
    assert.equal(texture.wrapU, Texture.WRAP_ADDRESSMODE);
    assert.equal(texture.wrapV, Texture.WRAP_ADDRESSMODE);
  }
  const atlas = assets.landscape, png = readPng(new URL(pixelAssetUrls.landscape));
  assert.equal(atlas.texture.hasAlpha, true);
  assert.equal(atlas.texture.samplingMode, Texture.NEAREST_SAMPLINGMODE);
  assert.equal(atlas.texture.noMipmap, true);
  assert.equal(atlas.texture.wrapU, Texture.CLAMP_ADDRESSMODE);
  const origin = { x: 80, y: 144 };
  for (let frame = 0; frame < atlas.frames.length; frame++) {
    const sprite = createSprite(scene, `landscape-${frame}`, atlas, frame);
    for (let y = 0; y < 160; y += 3) for (let x = 0; x < 160; x += 3) {
      assert.equal(opaqueSpritePixel(sprite, origin, x + .5, y + .5),
        png.alpha(frame % 4 * 160 + x, Math.floor(frame / 4) * 160 + y) === 255);
    }
  }
});

test('common readiness waits for the landscape texture transport', async t => {
  const { engine, scene } = harness(t), transport = engine.createTexture.bind(engine);
  let finish;
  t.mock.method(engine, 'createTexture', (...args) => {
    if (args[0] !== pixelAssetUrls.landscape) return transport(...args);
    const internal = transport(...args.slice(0, 5));
    internal.isReady = false;
    finish = () => {
      internal.isReady = true;
      internal.onLoadedObservable.notifyObservers(internal);
      args[5]?.();
    };
    return internal;
  });
  const assets = loadPixelAssets(scene);
  let ready = false, failure;
  const completion = assets.ready.then(() => { ready = true; }, error => { failure = error; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ifError(failure);
  assert.equal(ready, false, 'common assets became ready before the new atlas arrived');
  finish(); await completion;
  assert.ifError(failure);
  assert.equal(ready, true);
});
