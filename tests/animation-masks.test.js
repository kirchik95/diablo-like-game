import test from 'node:test';
import assert from 'node:assert/strict';
import * as picking from '../src/pixel-picking.js';

test('v2 masks: sprite-local masks use current atlas row, frame and mirror with no v1 fallback', () => {
  // An 8x8 atlas of four 4x4 cells: frame 0 pixel (0,1), frame 3 pixel (3,2).
  const mask = { width: 8, bytes: Uint8Array.from([0, 1, 0, 0, 0, 0, 128, 0]) };
  const sprite = { atlas: { path: 'test-v2.png', cell: 4, anchor: [2, 3], columns: 2, rows: 2, mask }, frame: 0, flip: false };
  const origin = { x: 10, y: 10 };
  assert.equal(picking.opaqueSpritePixel(sprite, origin, 8.5, 8.5), true);
  assert.equal(picking.opaqueSpritePixel(sprite, origin, 11.5, 8.5), false);
  sprite.flip = true;
  assert.equal(picking.opaqueSpritePixel(sprite, origin, 11.5, 8.5), true);
  assert.equal(picking.opaqueSpritePixel(sprite, origin, 8.5, 8.5), false);
  sprite.frame = 3; sprite.flip = false;
  assert.equal(picking.opaqueSpritePixel(sprite, origin, 11.5, 9.5), true);
  assert.equal(picking.opaqueSpritePixel(sprite, origin, 8.5, 8.5), false);
  assert.equal(picking.opaqueSpritePixel(sprite, origin, 12, 9.5), false);
});

test('v2 masks: packed little-bit-first data decodes without altering opaque pixels', () => {
  assert.equal(typeof picking.decodeHitMask, 'function');
  const result = picking.decodeHitMask({ width: 8, bits: 'AAEAAAAAgAA=' });
  assert.equal(result.width, 8);
  assert.deepEqual([...result.bytes], [0, 1, 0, 0, 0, 0, 128, 0]);
});
