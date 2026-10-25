import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { pixelAssetUrls, lootAssetUrls, monkWeaponUrls } from '../src/pixel-assets.js';
import { appearanceOptions, appearanceVariant } from '../src/appearance.js';

const moduleUrl = new URL('../src/hd2d/normals.js', import.meta.url);
const loadModule = () => import(moduleUrl);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const texture = () => ({ disposed: false, dispose() { this.disposed = true; } });

test('normal source mapping handles active URLs, atlas textures, weapons and every appearance', async () => {
  const { normalMapFor } = await loadModule();
  for (const [key, url] of Object.entries({...pixelAssetUrls, ...lootAssetUrls, ...monkWeaponUrls})) {
    const entry = normalMapFor({texture: {url}});
    assert.ok(entry, key);
    assert.equal(normalMapFor(url), entry);
    assert.ok(existsSync(new URL(entry.url)), 'mapped normal texture exists');
  }
  for (const skin of appearanceOptions.skins) for (const hair of appearanceOptions.hair) for (const sash of appearanceOptions.sashes) {
    const variant = appearanceVariant({skin:skin.id, hair:hair.id, sash:sash.id});
    assert.equal(normalMapFor(variant.url).appearanceId, variant.id);
  }
  assert.equal(normalMapFor('missing-atlas.png'), null);
});

test('off/low never transport; high loads on demand, deduplicates and releases on downgrade', async () => {
  const { createNormalLoader } = await loadModule();
  let calls = 0;
  const job = deferred(), t = texture();
  const loader = createNormalLoader(() => { calls++; return job.promise; });
  assert.equal(await loader.load(pixelAssetUrls.monk), null);
  loader.setTier('low');
  assert.equal(await loader.load(pixelAssetUrls.monk), null);
  assert.equal(calls, 0);
  loader.setTier('high');
  const first = loader.load(pixelAssetUrls.monk), duplicate = loader.load({url:pixelAssetUrls.monk});
  assert.equal(first, duplicate);
  assert.equal(calls, 1);
  assert.equal(loader.get(pixelAssetUrls.monk), null);
  job.resolve(t);
  assert.equal(await first, t);
  assert.equal(loader.get(pixelAssetUrls.monk), t);
  assert.equal(loader.stats.textures, 1);
  assert.equal(loader.stats.gpuBytes, 1536 * 2496 * 4);
  loader.setTier('off');
  assert.equal(loader.get(pixelAssetUrls.monk), null);
  assert.equal(t.disposed, true);
  assert.equal(loader.stats.gpuBytes, 0);
});

test('loads are serial, canceled work cannot repopulate a disabled loader, and errors degrade to null', async () => {
  const { createNormalLoader } = await loadModule();
  const jobs = [], loader = createNormalLoader(() => { const job = deferred(); jobs.push(job); return job.promise; });
  loader.setTier('high');
  const a = loader.load(pixelAssetUrls.monk), b = loader.load(pixelAssetUrls.hound);
  assert.equal(jobs.length, 1);
  loader.setTier('low');
  assert.equal(await a, null);
  assert.equal(await b, null);
  const late = texture(); jobs[0].resolve(late); await new Promise(resolve => setImmediate(resolve));
  assert.equal(late.disposed, true);
  assert.equal(jobs.length, 1, 'canceled queued atlas must never start');
  loader.setTier('high');
  const failed = loader.load(pixelAssetUrls.monk);
  jobs[1].reject(Error('404'));
  assert.equal(await failed, null);
  assert.equal(await loader.load(pixelAssetUrls.monk), null);
  assert.equal(jobs.length, 2, 'failure is cached until a tier cycle');
  assert.equal(loader.stats.failed, 1);
  loader.dispose();
  loader.setTier('high');
  assert.equal(await loader.load(pixelAssetUrls.hound), null);
});

test('appearance palette swaps share geometry and pure emission never requests a normal', async () => {
  const { createNormalLoader } = await loadModule();
  const pick = (skin, sash) => appearanceVariant({skin:appearanceOptions.skins[skin].id, hair:appearanceOptions.hair[0].id, sash:appearanceOptions.sashes[sash].id}).url;
  let calls = 0;
  const job = deferred(), t = texture();
  const loader = createNormalLoader(() => { calls++; return job.promise; });
  loader.setTier('high');
  const a = loader.load(pick(0,0)), b = loader.load(pick(1,1));
  assert.equal(a, b, 'colour choices must not duplicate GPU geometry');
  assert.equal(await loader.load(pixelAssetUrls.effects), null);
  assert.equal(await loader.load(pixelAssetUrls.campFlame), null);
  assert.equal(calls, 1);
  job.resolve(t);
  await a;
  assert.equal(loader.stats.textures, 1);
  loader.dispose();
});

test('the real host installs the lazy service and scene disposal removes it', async () => {
  const [{createHD2D, effects}, {NullEngine}, {Scene}] = await Promise.all([
    import('../src/hd2d/index.js'),
    import('@babylonjs/core/Engines/nullEngine.js'),
    import('@babylonjs/core/scene.js'),
  ]);
  const engine = new NullEngine(), scene = new Scene(engine), renderer = {};
  try {
    const normals = await loadModule();
    assert.ok(effects.includes(normals), 'production registry includes normals');
    const host = createHD2D({scene, engine, renderer}, 'low', [normals]);
    const loader = renderer.hd2dNormals;
    assert.ok(loader);
    assert.equal(await loader.load('monk'), null);
    host.setTier('high');
    assert.equal(loader.tier, 'high');
    assert.equal(scene.textures.length, 0, 'high must not eagerly allocate any normal texture');
    host.onWorld(renderer);
    assert.equal(renderer.hd2dNormals, loader);
    host.setTier('off');
    assert.equal(host.active, false);
    assert.equal(scene.textures.length, 0);
    scene.dispose();
    assert.equal(renderer.hd2dNormals, undefined);
    assert.equal(await loader.load('monk'), null);
  } finally { scene.dispose(); engine.dispose(); }
});
