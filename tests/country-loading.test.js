import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, Texture } from '@babylonjs/core';
import { loadPixelAssets, pixelAssetUrls, createSprite, setSpriteFrame, disposeSprite } from '../src/pixel-scene.js';
import { opaqueSpritePixel } from '../src/pixel-picking.js';
import { readPng } from './helpers/png.js';

const root = new URL('../assets/game/pixel-v6/country/', import.meta.url);
const maskUrl = new URL('hit-masks.json', root).href;
const names = ['countryGrass', 'countrySoil', 'countryStone', 'countryDetails'];
const files = ['grass.png', 'soil.png', 'stone.png', 'details.png'];
function masks() {
  const bits = Buffer.alloc(256 * 128 / 8);
  for (let frame = 0; frame < 8; frame++) {
    const pixel = (Math.floor(frame / 4) * 64 + 14 + frame) * 256 + frame % 4 * 64 + 10 + frame;
    bits[pixel >> 3] |= 1 << (pixel & 7);
  }
  return { 'details.png': { width: 256, height: 128, bits: bits.toString('base64') } };
}
function harness(t, loadMasks = async () => new Response(JSON.stringify(masks()))) {
  const engine = new NullEngine(), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  t.mock.method(globalThis, 'fetch', url => url === maskUrl ? loadMasks()
    : Promise.resolve(new Response(readFileSync(new URL(url)))));
  return { engine, scene };
}

test('the four country keys load their own files, repeat opaque surfaces and clamp the masked atlas', async t => {
  const { scene } = harness(t), assets = loadPixelAssets(scene);
  await assets.ready;
  for (const [i, name] of names.entries()) {
    const atlas = assets[name];
    assert.ok(atlas, `${name} must participate in common asset loading`);
    assert.equal(pixelAssetUrls[name], new URL(files[i], root).href);
    assert.equal(atlas.texture.noMipmap, true);
    assert.equal(atlas.texture.samplingMode, Texture.NEAREST_SAMPLINGMODE);
    assert.equal(atlas.texture.hasAlpha, i === 3);
    assert.equal(atlas.texture.wrapU, i === 3 ? Texture.CLAMP_ADDRESSMODE : Texture.WRAP_ADDRESSMODE);
    assert.equal(atlas.texture.wrapV, atlas.texture.wrapU);
    if (i < 3) assert.deepEqual(atlas.size, [128, 128]);
  }
  const atlas = assets.countryDetails;
  const sprite = createSprite(scene, 'country-loader', atlas);
  for (let frame = 0; frame < 8; frame++) for (const flip of [false, true]) {
    setSpriteFrame(sprite, { frame, flip });
    const x = flip ? 63 - (10 + frame) : 10 + frame;
    assert.equal(opaqueSpritePixel(sprite, { x: 32, y: 56 }, x + .5, 14 + frame + .5), true);
    assert.equal(opaqueSpritePixel(sprite, { x: 32, y: 56 }, 32, 32), false);
  }
  disposeSprite(sprite);
  assert.ok(scene.textures.includes(atlas.texture));
});

test('published country masks match actual PNG pixels through the runtime frame and mirror transforms', async t => {
  const { scene } = harness(t, async () => new Response(readFileSync(new URL(maskUrl))));
  const assets = loadPixelAssets(scene);
  await assets.ready;
  const atlas = assets.countryDetails, png = readPng(new URL(pixelAssetUrls.countryDetails));
  const sprite = createSprite(scene, 'published-country-detail', atlas);
  for (let frame = 0; frame < 8; frame++) for (const flip of [false, true]) {
    setSpriteFrame(sprite, { frame, flip });
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      assert.equal(opaqueSpritePixel(sprite, { x: 32, y: 56 }, x + .5, y + .5),
        png.alpha(frame % 4 * 64 + (flip ? 63 - x : x), Math.floor(frame / 4) * 64 + y) === 255,
        `frame ${frame}, mirror ${flip}, ${x},${y}`);
    }
  }
  disposeSprite(sprite);
});

for (const [i, name] of names.entries()) {
  test(`common readiness waits for ${name} and reports its transport failure`, async t => {
    const { engine, scene } = harness(t), transport = engine.createTexture.bind(engine);
    let fail;
    t.mock.method(engine, 'createTexture', (...args) => {
      if (args[0] !== new URL(files[i], root).href) return transport(...args);
      const internal = transport(...args.slice(0, 5));
      internal.isReady = false;
      fail = () => { internal._setError('country unavailable'); args[6]?.('country unavailable'); };
      return internal;
    });
    const assets = loadPixelAssets(scene);
    assert.equal(typeof fail, 'function', `${name} was not requested`);
    let ready = false;
    const completion = assets.ready.then(() => { ready = true; });
    const rejection = assert.rejects(completion, new RegExp(`Не загружен ${name}`));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(ready, false);
    fail(); await rejection;
  });
}

test('country masks join common readiness and finish only when the new mask arrives', async t => {
  let finish;
  const { scene } = harness(t, () => new Promise(resolve => { finish = resolve; }));
  const assets = loadPixelAssets(scene);
  assert.equal(typeof finish, 'function', 'country masks were not requested');
  let ready = false;
  const completion = assets.ready.then(() => { ready = true; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(ready, false);
  finish(new Response(JSON.stringify(masks()))); await completion;
  assert.equal(ready, true);
});

for (const invalid of ['missing', 'short', 'width', 'height', 'response']) {
  test(`country readiness rejects ${invalid} hit masks`, async t => {
    const packed = masks();
    if (invalid === 'missing') delete packed['details.png'];
    if (invalid === 'short') packed['details.png'].bits = 'AA==';
    if (invalid === 'width') packed['details.png'].width = 1;
    if (invalid === 'height') packed['details.png'].height = 1;
    const { scene } = harness(t, async () => invalid === 'response' ? new Response('', { status: 404 })
      : new Response(JSON.stringify(packed)));
    await assert.rejects(loadPixelAssets(scene).ready, /hit mask/);
  });
}
