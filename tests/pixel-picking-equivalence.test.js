import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeHitMask, opaqueSpritePixel, obscuresSprite } from '../src/pixel-picking.js';
import { pixelAtlases } from '../src/pixel-assets.js';

// The picking and occlusion code before the mobile performance pass, kept verbatim as the reference.
const reference = (() => {
  function opaqueSpritePixel(sprite, origin, x, y, projectedScale = 1) {
    const { cell, anchor, columns, mask } = sprite.atlas;
    const scaleX = (sprite.mesh?.scaling?.x ?? 1) * projectedScale;
    const scaleY = (sprite.mesh?.scaling?.y ?? 1) * projectedScale;
    if (!scaleX || !scaleY) return false;
    let localX = Math.floor((x - origin.x) / scaleX + anchor[0]);
    const localY = Math.floor((y - origin.y) / scaleY + anchor[1]);
    if (!mask || localX < 0 || localX >= cell || localY < 0 || localY >= cell) return false;
    if (sprite.flip) localX = cell - 1 - localX;
    const pixel = (Math.floor(sprite.frame / columns) * cell + localY) * mask.width
      + (sprite.frame % columns) * cell + localX;
    return (mask.bytes[pixel >> 3] & (1 << (pixel & 7))) !== 0;
  }
  const opaqueBoxes = new WeakMap();
  function opaqueBox(sprite) {
    const { cell, columns, mask } = sprite.atlas;
    if (!mask) return [0, 0, cell, cell];
    if (!opaqueBoxes.has(mask)) opaqueBoxes.set(mask, new Map());
    const boxes = opaqueBoxes.get(mask);
    if (!boxes.has(sprite.frame)) {
      const box = [cell, cell, 0, 0];
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
        const pixel = (Math.floor(sprite.frame / columns) * cell + y) * mask.width + (sprite.frame % columns) * cell + x;
        if (!(mask.bytes[pixel >> 3] & (1 << (pixel & 7)))) continue;
        box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x + 1); box[3] = Math.max(box[3], y + 1);
      }
      boxes.set(sprite.frame, box);
    }
    const [x0, y0, x1, y1] = boxes.get(sprite.frame);
    return sprite.flip ? [cell - x1, y0, cell - x0, y1] : [x0, y0, x1, y1];
  }
  function screenBounds(sprite, origin, projectedScale = 1) {
    const { anchor } = sprite.atlas, [bx0, by0, bx1, by1] = opaqueBox(sprite);
    const scaleX = (sprite.mesh?.scaling?.x ?? 1) * projectedScale;
    const scaleY = (sprite.mesh?.scaling?.y ?? 1) * projectedScale;
    const x0 = origin.x + (bx0 - anchor[0]) * scaleX, x1 = origin.x + (bx1 - anchor[0]) * scaleX;
    const y0 = origin.y + (by0 - anchor[1]) * scaleY, y1 = origin.y + (by1 - anchor[1]) * scaleY;
    return { left: Math.min(x0, x1), right: Math.max(x0, x1), top: Math.min(y0, y1), bottom: Math.max(y0, y1) };
  }
  function obscuresSprite(front, frontOrigin, back, backOrigin, projectedScale = 1) {
    const a = screenBounds(front, frontOrigin, projectedScale), b = screenBounds(back, backOrigin, projectedScale);
    if (a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top) return false;
    const { cell, anchor } = back.atlas;
    const scaleX = (back.mesh?.scaling?.x ?? 1) * projectedScale;
    const scaleY = (back.mesh?.scaling?.y ?? 1) * projectedScale;
    const box = opaqueBox(back), first = n => 1 + 3 * Math.max(0, Math.ceil((n - 1) / 3));
    let covered = 0, opaque = 0;
    for (let y = first(box[1]); y < box[3]; y += 3) {
      for (let x = first(box[0]); x < box[2]; x += 3) {
        const screenX = backOrigin.x + (x - anchor[0] + .5) * scaleX;
        const screenY = backOrigin.y + (y - anchor[1] + .5) * scaleY;
        if (!opaqueSpritePixel(back, backOrigin, screenX, screenY, projectedScale)) continue;
        opaque++;
        if (opaqueSpritePixel(front, frontOrigin, screenX, screenY, projectedScale)) covered++;
      }
    }
    return opaque > 0 && covered / opaque > .15;
  }
  return { opaqueSpritePixel, obscuresSprite };
})();

// Real atlases with their shipped hit masks, as loadPixelAssets attaches them.
const packages = [
  ['../assets/game/pixel-v17/monk-side/hit-masks.json', ['monk']],
  ['../assets/game/pixel-v2/hound-world/hit-masks.json', ['hound', 'world']],
  ['../assets/game/pixel-v1/hit-masks.json', ['environment']],
  ['../assets/game/pixel-v3/wraith/hit-masks.json', ['wraith']],
  ['../assets/game/pixel-v7/beetle/hit-masks.json', ['beetle']],
  ['../assets/game/pixel-v4/landscape/hit-masks.json', ['landscape']],
  ['../assets/game/pixel-v5/camp/hit-masks.json', ['camp']],
  ['../assets/game/pixel-v9/camp-panorama/hit-masks.json', ['campPanorama']],
  ['../assets/game/pixel-v11/monastery-ruins/hit-masks.json', ['monasteryRuins', 'monasteryWorld']],
];
const atlases = {};
for (const [path, names] of packages) {
  const packed = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  for (const name of names) atlases[name] = { ...pixelAtlases[name], mask: decodeHitMask(packed[pixelAtlases[name].path]) };
}
const frames = atlas => atlas.columns * atlas.rows;

// mulberry32: the same draws every run.
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let n = Math.imul(seed ^ (seed >>> 15), seed | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const sprite = (rand, names, scales) => {
  const atlas = atlases[pick(rand, names)], scale = pick(rand, scales);
  // Some sprites are drawn larger or smaller than their cell, some with a different height.
  return { atlas, frame: Math.floor(rand() * frames(atlas)), flip: rand() < .5,
    mesh: { scaling: { x: scale, y: rand() < .2 ? scale * 1.25 : scale } } };
};
const ACTORS = ['monk', 'hound', 'wraith', 'beetle'], PROPS = ['camp', 'campPanorama', 'monasteryRuins', 'monasteryWorld', 'landscape', 'environment', 'world'];
const SCREEN_SCALES = [.8333333333333334, 1, 1.2, 1.6, 2.4];

test('obscuresSprite gives the reference result for random real prop and actor pairs', () => {
  const rand = random(20261024);
  let covered = 0, overlapped = 0;
  for (let i = 0; i < 6000; i++) {
    const back = sprite(rand, ACTORS, [1, 1, 1.2]), front = sprite(rand, PROPS, [1, 1, .8, 1.3, 1.6]);
    const scale = pick(rand, SCREEN_SCALES);
    const backOrigin = { x: 40 + rand() * 560 + rand(), y: 40 + rand() * 280 + rand() };
    const frontOrigin = { x: backOrigin.x + (rand() - .5) * 220, y: backOrigin.y + (rand() - .3) * 160 };
    const expected = reference.obscuresSprite(front, frontOrigin, back, backOrigin, scale);
    assert.equal(obscuresSprite(front, frontOrigin, back, backOrigin, scale), expected,
      `pair ${i}: ${front.atlas.path}#${front.frame}${front.flip ? 'f' : ''} over ${back.atlas.path}#${back.frame}${back.flip ? 'f' : ''} at ×${scale}`);
    if (expected) covered++;
    if (Math.abs(frontOrigin.x - backOrigin.x) < 80) overlapped++;
  }
  assert.ok(covered > 300 && covered < 5000, `a real mix of covered (${covered}) and clear pairs`);
  assert.ok(overlapped > 1000);
});

test('obscuresSprite keeps the reference result at its edges: no mask, zero scale, a front exactly at the 15% threshold', () => {
  const rand = random(7);
  for (let i = 0; i < 400; i++) {
    const back = sprite(rand, ACTORS, [1]), front = sprite(rand, PROPS, [1]);
    const origin = { x: 300, y: 200 };
    for (const variant of [
      [{ ...front, atlas: { ...front.atlas, mask: null } }, back],
      [front, { ...back, atlas: { ...back.atlas, mask: null } }],
      [{ ...front, mesh: { scaling: { x: 0, y: 1 } } }, back],
      [front, back],
    ]) {
      assert.equal(obscuresSprite(variant[0], origin, variant[1], origin, 1), reference.obscuresSprite(variant[0], origin, variant[1], origin, 1));
    }
  }
  // A sprite over itself covers every one of its opaque samples.
  const monk = { atlas: atlases.monk, frame: 0, flip: false };
  assert.equal(obscuresSprite(monk, { x: 10, y: 90 }, monk, { x: 10, y: 90 }), true);
});

test('opaqueSpritePixel gives the reference answer for random screen points around real sprites', () => {
  const rand = random(99);
  let opaque = 0;
  for (let i = 0; i < 3000; i++) {
    const target = sprite(rand, [...ACTORS, ...PROPS], [1, 1.2, .8, -1]), scale = pick(rand, SCREEN_SCALES);
    const origin = { x: 200 + rand() * 10, y: 220 + rand() * 10 };
    for (let k = 0; k < 20; k++) {
      const x = origin.x + (rand() - .5) * target.atlas.cell * scale * 1.2, y = origin.y - rand() * target.atlas.cell * scale;
      const expected = reference.opaqueSpritePixel(target, origin, x, y, scale);
      assert.equal(opaqueSpritePixel(target, origin, x, y, scale), expected);
      if (expected) opaque++;
    }
  }
  assert.ok(opaque > 3000, `${opaque} opaque samples`);
});
