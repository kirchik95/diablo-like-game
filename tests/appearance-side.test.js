import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { appearanceOptions, appearanceVariant } from '../src/appearance.js';
import { pixelAtlases } from '../src/pixel-assets.js';
import sidePackage from '../assets/game/pixel-v10/monk-side/manifest.json' with { type: 'json' };

const pngSize = url => {
  const data = readFileSync(new URL(url));
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
};

test('each appearance texture is a side-package atlas matching the renderer monk geometry', () => {
  // render.js applies these textures to the sprite built from pixel-assets.js.
  assert.equal(pixelAtlases.monk.path, sidePackage.monk.path);
  assert.equal(pixelAtlases.monk.rows, sidePackage.monk.rows);
  const { columns, rows, cell } = pixelAtlases.monk;
  for (const skin of appearanceOptions.skins) for (const hair of appearanceOptions.hair) for (const sash of appearanceOptions.sashes) {
    const variant = appearanceVariant({ skin: skin.id, hair: hair.id, sash: sash.id }), id = `${skin.id}-${hair.id}-${sash.id}`;
    assert.ok(new URL(variant.url).pathname.endsWith(`/assets/game/pixel-v10/monk-side/appearance/${id}.png`), variant.url);
    assert.ok(new URL(variant.previewUrl).pathname.endsWith(`/assets/game/pixel-v3/appearance/${id}-preview.png`));
    assert.equal(variant.previewPath, `${id}-preview.png`, 'previewUrl names the manifest preview file');
    assert.deepEqual(pngSize(variant.url), [columns * cell, rows * cell], id);
    assert.ok(existsSync(new URL(variant.previewUrl)), `${id} preview`);
  }
});

test('the side package ships one 960x1056 atlas per appearance at the path the URL uses', () => {
  for (const variant of sidePackage.appearance.variants) {
    const url = new URL(`../assets/game/pixel-v10/monk-side/appearance/${variant.id}.png`, import.meta.url);
    assert.equal(variant.path, `appearance/${variant.id}.png`);
    assert.ok(existsSync(url), variant.id);
    assert.deepEqual(pngSize(url), [960, 1056]);
  }
  assert.deepEqual(sidePackage.appearance.variants.map(v => v.id), appearanceOptions.skins.flatMap(skin =>
    appearanceOptions.hair.flatMap(hair => appearanceOptions.sashes.map(sash => `${skin.id}-${hair.id}-${sash.id}`))));
  assert.deepEqual(sidePackage.appearance.default, appearanceOptions.default);
});
