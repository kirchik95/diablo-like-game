import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pixelAtlases, pixelAssetUrls } from '../src/pixel-scene.js';
import { decodeHitMask, opaqueSpritePixel } from '../src/pixel-picking.js';
import { readPng } from './helpers/png.js';

// The monk is either the 100-key v2 atlas or the 110-key side package (v2 + idle/run side keys).
const sideMonk = pixelAtlases.monk.path === 'monk-side.png';
const packages = {
  monk: new URL(sideMonk ? '../assets/game/pixel-v10/monk-side/' : '../assets/game/pixel-v2/monk/', import.meta.url),
  hound: new URL('../assets/game/pixel-v2/hound-world/', import.meta.url),
  world: new URL('../assets/game/pixel-v2/hound-world/', import.meta.url),
  effects: new URL('../assets/game/pixel-v2/hound-world/', import.meta.url),
};

for (const [name, count, size] of [['monk', sideMonk ? 110 : 100, 96], ['hound', 52, 96], ['world', 24, 160], ['effects', 18, 192]]) {
  test(`v2 delivery: ${name} runtime atlas and current-frame masks match the real PNG in both mirrors`, () => {
    const atlas = pixelAtlases[name], root = packages[name];
    assert.equal(atlas.cell, size);
    assert.equal(atlas.frames.length, count);
    assert.equal(atlas.filter, 'nearest'); assert.equal(atlas.mipmaps, false);
    assert.equal(new URL(pixelAssetUrls[name]).href, new URL(atlas.path, root).href);
    const png = readPng(new URL(pixelAssetUrls[name]));
    assert.equal(png.width, atlas.columns * size); assert.equal(png.height, atlas.rows * size);
    const packed = JSON.parse(readFileSync(new URL('hit-masks.json', root)));
    const mask = decodeHitMask(packed[atlas.path]);
    assert.equal(mask.width, png.width);
    const sprite = { atlas: { ...atlas, mask }, frame: 0, flip: false };
    const origin = { x: 17.25, y: 83.75 }, referenced = new Set();
    for (const clip of Object.values(atlas.clips)) for (const frames of Object.values(clip)) {
      for (const frame of frames) { assert.ok(frame >= 0 && frame < count); referenced.add(frame); }
    }
    assert.equal(referenced.size, count, 'every delivered frame must be reachable through named clips');
    for (let frame = 0; frame < count; frame++) {
      sprite.frame = frame;
      let content = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const alpha = png.alpha(frame % atlas.columns * size + x, Math.floor(frame / atlas.columns) * size + y);
        if (alpha !== 0 && alpha !== 255) assert.fail(`${name} frame ${frame} has nonbinary alpha at ${x},${y}`);
        const opaque = alpha === 255; content += opaque ? 1 : 0;
        for (const flip of [false, true]) {
          sprite.flip = flip;
          const screenX = origin.x + (flip ? size - 1 - x : x) - atlas.anchor[0] + .5;
          const screenY = origin.y + y - atlas.anchor[1] + .5;
          if (opaqueSpritePixel(sprite, origin, screenX, screenY) !== opaque) {
            assert.fail(`${name} frame ${frame}, pixel ${x},${y}, flip=${flip}: displayed PNG and targeting mask differ`);
          }
        }
      }
      assert.ok(content > 0, `${name} frame ${frame} is empty`);
    }
  });
}
