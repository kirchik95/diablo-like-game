import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, Texture } from '@babylonjs/core';
import { loadPixelAssets, createSprite, setSpriteFrame, disposeSprite, pixelAssetUrls } from '../src/pixel-scene.js';
import { opaqueSpritePixel } from '../src/pixel-picking.js';
import { readPng } from './helpers/png.js';

const masksUrl = new URL('../assets/game/pixel-v5/camp/hit-masks.json', import.meta.url).href;
const contract = {
  camp: { path: 'camp.png', cell: 256, columns: 3, rows: 2, anchor: [128, 232] },
  campFlame: { path: 'camp-flame.png', cell: 128, columns: 4, rows: 1, anchor: [64, 112] },
};

function packedMasks() {
  return Object.fromEntries(Object.values(contract).map(({ path, cell, columns, rows }) => {
    const width = cell * columns, height = cell * rows, bytes = Buffer.alloc(width * height / 8);
    // One independent marker per frame proves the loader uses both filename
    // keys and each atlas's actual row/column dimensions.
    for (let frame = 0; frame < columns * rows; frame++) {
      const pixel = (Math.floor(frame / columns) * cell + 21 + frame) * width
        + frame % columns * cell + 11 + frame;
      bytes[pixel >> 3] |= 1 << (pixel & 7);
    }
    return [path, { width, height, bits: bytes.toString('base64') }];
  }));
}

function harness(t, campMasks = async () => new Response(JSON.stringify(packedMasks()))) {
  const engine = new NullEngine(), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  // The transport fixture isolates common-loader behavior from ongoing art
  // production. Published PNG/mask agreement is checked with the final assets.
  t.mock.method(globalThis, 'fetch', url => url === masksUrl
    ? campMasks() : Promise.resolve(new Response(readFileSync(new URL(url)))));
  return { engine, scene };
}

test('camp atlases load both filename-keyed masks with native slicing and nearest sampling', async t => {
  const { scene } = harness(t), assets = loadPixelAssets(scene);
  await assets.ready;
  for (const [name, expected] of Object.entries(contract)) {
    const atlas = assets[name];
    assert.ok(atlas, `${name} is absent from the common loader`);
    assert.equal(pixelAssetUrls[name], new URL(`../assets/game/pixel-v5/camp/${expected.path}`, import.meta.url).href);
    assert.equal(atlas.texture.samplingMode, Texture.NEAREST_SAMPLINGMODE);
    assert.equal(atlas.texture.noMipmap, true);
    assert.equal(atlas.texture.hasAlpha, true);
    assert.equal(atlas.texture.wrapU, Texture.CLAMP_ADDRESSMODE);
    assert.equal(atlas.texture.wrapV, Texture.CLAMP_ADDRESSMODE);
    const sprite = createSprite(scene, `camp-loader-${name}`, atlas);
    const bounds = sprite.mesh.getBoundingInfo().boundingBox;
    assert.equal(bounds.maximum.x - bounds.minimum.x, expected.cell / 32);
    assert.equal(bounds.maximum.y, expected.anchor[1] / 32);
    for (let frame = 0; frame < expected.columns * expected.rows; frame++) {
      for (const flip of [false, true]) {
        setSpriteFrame(sprite, { frame, flip });
        const x = flip ? expected.cell - 1 - (11 + frame) : 11 + frame;
        assert.equal(opaqueSpritePixel(sprite, { x: expected.anchor[0], y: expected.anchor[1] }, x + .5, 21 + frame + .5), true);
        assert.equal(opaqueSpritePixel(sprite, { x: expected.anchor[0], y: expected.anchor[1] }, expected.cell / 2, expected.cell / 2), false);
      }
    }
    disposeSprite(sprite);
    assert.ok(scene.textures.includes(atlas.texture), 'sprite disposal must preserve the shared atlas');
  }
});

test('published camp masks follow actual PNG pixels through frames, scale and mirror', async t => {
  const { scene } = harness(t, async () => new Response(readFileSync(new URL(masksUrl))));
  const assets = loadPixelAssets(scene);
  await assets.ready;
  for (const name of Object.keys(contract)) {
    const atlas = assets[name], png = readPng(new URL(pixelAssetUrls[name]));
    const sprite = createSprite(scene, `published-${name}`, atlas);
    for (const scale of [1, 2]) for (const flip of [false, true]) {
      sprite.mesh.scaling.setAll(scale);
      for (let frame = 0; frame < atlas.frames.length; frame++) {
        setSpriteFrame(sprite, { frame, flip });
        for (let y = 0; y < atlas.cell; y += 3) for (let x = 0; x < atlas.cell; x += 3) {
          const actual = opaqueSpritePixel(sprite, { x: 0, y: 0 },
            (x + .5 - atlas.anchor[0]) * scale, (y + .5 - atlas.anchor[1]) * scale);
          const expected = png.alpha(frame % atlas.columns * atlas.cell + (flip ? atlas.cell - 1 - x : x),
            Math.floor(frame / atlas.columns) * atlas.cell + y) === 255;
          assert.equal(actual, expected, `${name} frame ${frame}, scale ${scale}, flip ${flip}, ${x},${y}`);
        }
      }
    }
    disposeSprite(sprite);
  }
});

for (const [name, { path }] of Object.entries(contract)) {
  test(`common readiness waits for the ${name} image transport`, async t => {
    const { engine, scene } = harness(t), transport = engine.createTexture.bind(engine);
    const url = new URL(`../assets/game/pixel-v5/camp/${path}`, import.meta.url).href;
    let finish;
    t.mock.method(engine, 'createTexture', (...args) => {
      if (args[0] !== url) return transport(...args);
      const internal = transport(...args.slice(0, 5));
      internal.isReady = false;
      finish = () => { internal.isReady = true; internal.onLoadedObservable.notifyObservers(internal); args[5]?.(); };
      return internal;
    });
    const assets = loadPixelAssets(scene);
    let ready = false;
    const completion = assets.ready.then(() => { ready = true; });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(ready, false, `${name} was not included in common readiness`);
    finish(); await completion;
    assert.equal(ready, true);
  });

  test(`a failed ${name} image rejects common readiness`, async t => {
    const { engine, scene } = harness(t), transport = engine.createTexture.bind(engine);
    const url = new URL(`../assets/game/pixel-v5/camp/${path}`, import.meta.url).href;
    let fail;
    t.mock.method(engine, 'createTexture', (...args) => {
      if (args[0] !== url) return transport(...args);
      const internal = transport(...args.slice(0, 5));
      internal.isReady = false;
      fail = () => { internal._setError('camp image unavailable'); args[6]?.('camp image unavailable'); };
      return internal;
    });
    const assets = loadPixelAssets(scene);
    assert.equal(typeof fail, 'function', `${name} image was never requested`);
    const rejection = assert.rejects(assets.ready, new RegExp(`Не загружен ${name}`));
    fail(); await rejection;
  });
}

test('common readiness waits for the camp mask transport', async t => {
  let finish;
  const { scene } = harness(t, () => new Promise(resolve => { finish = resolve; }));
  const assets = loadPixelAssets(scene);
  let ready = false;
  const completion = assets.ready.then(() => { ready = true; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(ready, false, 'camp masks were not included in common readiness');
  finish(new Response(JSON.stringify(packedMasks()))); await completion;
  assert.equal(ready, true);
});

for (const path of ['camp.png', 'camp-flame.png']) {
  for (const invalid of ['missing', 'short', 'width']) {
    test(`common readiness rejects ${invalid} ${path} masks`, async t => {
      const packed = packedMasks();
      if (invalid === 'missing') delete packed[path];
      if (invalid === 'short') packed[path].bits = 'AA==';
      if (invalid === 'width') packed[path].width = 1;
      const { scene } = harness(t, async () => new Response(JSON.stringify(packed)));
      await assert.rejects(loadPixelAssets(scene).ready, /hit mask/);
    });
  }
}

test('a failed camp mask response rejects common readiness', async t => {
  const { scene } = harness(t, async () => new Response('', { status: 404 }));
  await assert.rejects(loadPixelAssets(scene).ready, /Не загружены hit masks/);
});
