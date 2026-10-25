import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, Texture } from '@babylonjs/core';
import * as pixels from '../src/pixel-scene.js';

test('loadPixelAssets reports progress: the total first, then every atlas, mask package and optional package once', async t => {
  const engine = new NullEngine(), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  t.mock.method(globalThis, 'fetch', async url => {
    // One optional package fails: it still counts as settled.
    if (String(url).includes('monk-weapons')) return new Response('missing', { status: 404 });
    return new Response(readFileSync(new URL(url)));
  });
  const calls = [];
  const assets = pixels.loadPixelAssets(scene, { onProgress: (loaded, total, label) => calls.push({ loaded, total, label }) });
  assert.deepEqual(calls[0], { loaded: 0, total: calls[0].total, label: null }, 'the total is known before any file arrives');
  await assets.ready;
  await new Promise(resolve => setTimeout(resolve, 0));
  const total = calls[0].total;
  const expected = Object.keys(pixels.pixelAssetUrls).length + Object.keys(pixels.lootAssetUrls).length + 1;
  assert.ok(total > expected, 'atlases, loot, weapons and the hit-mask packages');
  assert.equal(calls.length, total + 1);
  assert.deepEqual(calls.map(call => call.loaded), [...Array(total + 1).keys()], 'loaded counts up by one');
  assert.ok(calls.every(call => call.total === total));
  const labels = calls.slice(1).map(call => call.label);
  assert.equal(new Set(labels).size, total, 'each item reports once');
  for (const name of [...Object.keys(pixels.pixelAssetUrls), ...Object.keys(pixels.lootAssetUrls), 'monkWeapons']) {
    assert.ok(labels.includes(name), name);
  }
  assert.ok(labels.some(label => label.startsWith('masks:')));
  assert.equal(assets.monkWeapons.failed, true);
});

test('loadPixelAssets without onProgress loads exactly as before', async t => {
  const engine = new NullEngine(), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  t.mock.method(globalThis, 'fetch', async url => new Response(readFileSync(new URL(url))));
  const assets = pixels.loadPixelAssets(scene);
  await assert.doesNotReject(assets.ready);
  assert.ok(assets.monk.texture && assets.monk.mask);
});

test('WebGL1 clamps the one non-power-of-two surface (the mountain backdrop); WebGL2 keeps every surface repeating', async t => {
  t.mock.method(globalThis, 'fetch', async url => new Response(readFileSync(new URL(url))));
  for (const version of [1, 2]) {
    const engine = new NullEngine(), scene = new Scene(engine);
    t.after(() => { scene.dispose(); engine.dispose(); });
    engine._webGLVersion = version;
    assert.equal(engine.webGLVersion, version);
    const assets = pixels.loadPixelAssets(scene);
    await assets.ready;
    const [width, height] = pixels.pixelAtlases.campBackdrop.size;
    assert.ok(width & (width - 1) || height & (height - 1), 'the backdrop is not a power of two');
    assert.equal(assets.campBackdrop.texture.wrapU, version > 1 ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE, `WebGL${version}`);
    assert.equal(assets.campBackdrop.texture.wrapV, assets.campBackdrop.texture.wrapU);
    // Power-of-two surfaces repeat on both.
    for (const name of ['campGrass', 'campEarth']) assert.equal(assets[name].texture.wrapU, Texture.WRAP_ADDRESSMODE, `${name} WebGL${version}`);
    // Sprite atlases always clamp.
    assert.equal(assets.monk.texture.wrapU, Texture.CLAMP_ADDRESSMODE);
  }
});

test('hitMaskUrls lists every hit-mask package loadPixelAssets fetches', async t => {
  const fetched = [];
  t.mock.method(globalThis, 'fetch', async url => { fetched.push(String(url)); return new Response(readFileSync(new URL(url))); });
  const engine = new NullEngine(), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  await pixels.loadPixelAssets(scene).ready;
  const masks = fetched.filter(url => url.endsWith('hit-masks.json'));
  assert.deepEqual([...pixels.hitMaskUrls].sort(), [...masks].sort());
  assert.ok(Object.isFrozen(pixels.hitMaskUrls));
  assert.ok(pixels.hitMaskUrls.length >= 10);
});
