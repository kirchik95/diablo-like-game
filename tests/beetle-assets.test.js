import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { decodeHitMask, opaqueSpritePixel } from '../src/pixel-picking.js';
import { readPng } from './helpers/png.js';

const root = new URL('../assets/game/pixel-v7/beetle/', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
const CLIPS = { idle: 4, walk: 6, windup: 5, slam: 3, recover: 3, hurt: 4, stunned: 4, death: 6, block: 2 };

test('beetle exports a wraith-compatible schema 2 contract with front/back clips', () => {
  const manifest = json('manifest.json'), meta = manifest.beetle;
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.nativePixelsPerUnit, 32);
  assert.equal(manifest.hitMasks, 'hit-masks.json');
  assert.equal(meta.path, 'beetle.png');
  assert.equal(meta.cell, 128); assert.deepEqual(meta.anchor, [64, 112]);
  assert.equal(meta.columns, 10); assert.equal(meta.rows, 8);
  assert.equal(meta.filter, 'nearest'); assert.equal(meta.mipmaps, false);
  const names = [];
  for (const facing of ['front', 'back']) for (const [clip, count] of Object.entries(CLIPS)) {
    const indices = Array.from({ length: count }, (_, i) => names.length + i);
    assert.deepEqual(meta.clips[clip][facing], indices, `${clip}/${facing}`);
    names.push(...indices.map((_, i) => `${facing}-${clip}-${String(i + 1).padStart(2, '0')}`));
  }
  assert.deepEqual(meta.frames, names);
  assert.deepEqual(Object.keys(meta.clips), Object.keys(CLIPS));
  for (const clip of Object.keys(CLIPS)) assert.equal(meta.timing[clip].keyTimesMs.length, CLIPS[clip]);
  assert.deepEqual(manifest.authoredFacings, { front: 'SE', back: 'NE' });
  assert.deepEqual(manifest.logicalFacings.SW, { authored: 'front', flipX: true });
  assert.deepEqual(manifest.logicalFacings.NW, { authored: 'back', flipX: true });
});

test('beetle atlas: binary alpha, unclipped distinct keys and an exact packed hit mask', () => {
  const meta = json('manifest.json').beetle, png = readPng(new URL(meta.path, root));
  assert.equal(png.width, meta.columns * meta.cell); assert.equal(png.height, meta.rows * meta.cell);
  const packed = json('hit-masks.json');
  assert.deepEqual(Object.keys(packed), ['beetle.png']);
  assert.equal(packed['beetle.png'].height, png.height);
  const mask = decodeHitMask(packed['beetle.png']);
  assert.equal(mask.width, png.width);
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const alpha = png.alpha(x, y), i = y * png.width + x;
    if (alpha !== 0 && alpha !== 255) assert.fail(`nonbinary alpha at ${x},${y}`);
    if (Boolean(mask.bytes[i >> 3] & (1 << (i & 7))) !== (alpha === 255)) assert.fail(`mask differs at ${x},${y}`);
  }
  const cell = meta.cell, keys = new Map(), shared = [];
  for (let frame = 0; frame < meta.frames.length; frame++) {
    const ox = frame % meta.columns * cell, oy = Math.floor(frame / meta.columns) * cell, bits = [];
    let content = 0;
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const opaque = png.alpha(ox + x, oy + y) === 255;
      bits.push(opaque ? 1 : 0); content += opaque;
      if (opaque && (x === 0 || y === 0 || x === cell - 1 || y === cell - 1)) assert.fail(`frame ${frame} touches its cell edge`);
    }
    assert.ok(content > 0, `frame ${frame} is empty`);
    const key = hash(Buffer.from(bits));
    if (keys.has(key)) shared.push([meta.frames[keys.get(key)], meta.frames[frame]]);
    else keys.set(key, frame);
  }
  // Only the telegraph hold (seam glow brightens) and the centre poses of the
  // stunned pendulum (weak-spot pulse) reuse a silhouette with new colours.
  assert.deepEqual(shared, [['front-windup-03', 'front-windup-04'], ['front-stunned-01', 'front-stunned-03'],
    ['back-stunned-01', 'back-stunned-03']]);
});

test('beetle masks follow the displayed frame and horizontal mirror at the 128 px anchor', () => {
  const meta = json('manifest.json').beetle, png = readPng(new URL(meta.path, root));
  const mask = decodeHitMask(json('hit-masks.json')['beetle.png']);
  const sprite = { atlas: { ...meta, mask }, frame: 0, flip: false }, origin = { x: 40.25, y: 120.75 };
  // One key per clip and facing keeps this fast; the full-atlas mask equality
  // above already covers every pixel.
  for (const clip of Object.values(meta.clips)) for (const [frame] of Object.values(clip)) {
    sprite.frame = frame;
    for (let y = 0; y < meta.cell; y += 2) for (let x = 0; x < meta.cell; x += 2) {
      const opaque = png.alpha(frame % meta.columns * meta.cell + x, Math.floor(frame / meta.columns) * meta.cell + y) === 255;
      for (const flip of [false, true]) {
        sprite.flip = flip;
        const sx = origin.x + (flip ? meta.cell - 1 - x : x) - meta.anchor[0] + .5, sy = origin.y + y - meta.anchor[1] + .5;
        if (opaqueSpritePixel(sprite, origin, sx, sy) !== opaque) assert.fail(`frame ${frame} ${x},${y} flip=${flip}`);
      }
    }
  }
});

test('beetle read-only verifier rebuilds byte-identical deliverables without writing', () => {
  const snapshot = () => readdirSync(root, { recursive: true }).map(name => new URL(name, root))
    .filter(url => statSync(url).isFile()).map(url => [url.pathname, statSync(url).mtimeMs, hash(readFileSync(url))]).sort();
  const before = snapshot();
  const script = new URL('../scripts/build-beetle-animation.py', import.meta.url).pathname;
  const result = spawnSync('python3', [script, '--verify-only'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'passed'); assert.equal(report.mode, 'read-only');
  assert.equal(report.beetle.frames, 74); assert.ok(report.beetle.opaqueColors <= 48);
  assert.equal(report.rebuildMatches, true); assert.equal(report.sourceHashesMatch, true);
  assert.deepEqual(snapshot(), before, 'verification changed files or timestamps');
});
