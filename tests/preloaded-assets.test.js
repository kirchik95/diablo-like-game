import test from 'node:test';
import assert from 'node:assert/strict';
import { retainPreloadedAsset, takePreloadedTexture, takePreloadedResponse, clearPreloadedAssets } from '../src/preloaded-assets.js';

test('PNG bytes are handed to the asynchronous texture transport once and released once', async () => {
  const calls = [], blob = new Blob(['png']);
  const urls = { createObjectURL(value) { assert.equal(value, blob); calls.push('create'); return 'blob:atlas'; }, revokeObjectURL(url) { calls.push(url); } };
  await retainPreloadedAsset('atlas.png', blob, { urls });
  assert.deepEqual(calls, ['create'], 'keep compressed bytes; no eager image decode');
  const entry = takePreloadedTexture('atlas.png');
  assert.equal(entry.url, 'blob:atlas');
  assert.equal(takePreloadedTexture('atlas.png'), undefined, 'the loader owns the transport now');
  entry.release(); entry.release();
  assert.deepEqual(calls, ['create', 'blob:atlas']);
});

test('JSON bytes are consumed once as a real response, without parsing during preload', async () => {
  await retainPreloadedAsset('mask.json', new Blob(['{"width":128}']));
  const response = takePreloadedResponse('mask.json');
  assert.ok(response instanceof Response);
  assert.deepEqual(await response.json(), { width: 128 });
  assert.equal(takePreloadedResponse('mask.json'), undefined);
});

test('the real atlas loader consumes PNG bytes and mask responses, preserving original texture URLs', async t => {
  const { NullEngine, Scene } = await import('@babylonjs/core');
  const pixels = await import('../src/pixel-scene.js');
  const { readFileSync } = await import('node:fs');
  const engine = new NullEngine(), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const released = [];
  await retainPreloadedAsset(pixels.pixelAssetUrls.hound, new Blob(['png']), {
    urls: { createObjectURL: () => 'blob:hound', revokeObjectURL: url => released.push(url) },
  });
  for (const url of pixels.hitMaskUrls) await retainPreloadedAsset(url, new Blob([readFileSync(new URL(url))]));
  const requests = [], textureCalls = [], transport = engine.createTexture.bind(engine);
  t.mock.method(globalThis, 'fetch', async url => { requests.push(url); return new Response(readFileSync(new URL(url))); });
  t.mock.method(engine, 'createTexture', (...args) => { textureCalls.push(args); return transport(...args); });
  const assets = pixels.loadPixelAssets(scene); await assets.ready;
  assert.ok(textureCalls.some(args => args[0] === 'blob:hound'), 'the image transport stays asynchronous');
  assert.ok(!textureCalls.some(args => args[0] === pixels.pixelAssetUrls.hound), 'no original PNG requested again');
  assert.equal(assets.hound.texture.url, pixels.pixelAssetUrls.hound);
  assert.deepEqual(released, ['blob:hound']);
  assert.ok(assets.hound.mask.bytes.length > 0);
  assert.ok(pixels.hitMaskUrls.every(url => !requests.includes(url)), 'no hit-mask request twice');
  assert.equal(takePreloadedTexture(pixels.pixelAssetUrls.hound), undefined);
  for (const url of pixels.hitMaskUrls) assert.equal(takePreloadedResponse(url), undefined);
});

test('fatal boot cleanup revokes unconsumed URLs and drops JSON bodies', async () => {
  const released = [];
  await retainPreloadedAsset('unused.png', new Blob(), {
    urls: { createObjectURL: () => 'blob:unused', revokeObjectURL: url => released.push(url) },
  });
  await retainPreloadedAsset('unused.json', new Blob(['{}']));
  clearPreloadedAssets(); clearPreloadedAssets();
  assert.deepEqual(released, ['blob:unused']);
  assert.equal(takePreloadedTexture('unused.png'), undefined);
  assert.equal(takePreloadedResponse('unused.json'), undefined);
});
