import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const file = path => new URL(path, root);
const json = path => JSON.parse(readFileSync(file(path), 'utf8'));
const wraithRoot = 'assets/game/pixel-v3/wraith/';
const lookRoot = 'assets/game/pixel-v3/appearance/';
const monk = json('assets/game/pixel-v2/monk/manifest.json').monk;
const hash = data => createHash('sha256').update(data).digest('hex');

// Decode the actual RGBA bytes independently of the producer and its QA report.
function rgba(path) {
  assert.ok(existsSync(file(path)), `missing delivered file: ${path}`);
  const png = readFileSync(file(path)), chunks = [];
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let width, height;
  for (let p = 8; p < png.length;) {
    const n = png.readUInt32BE(p), kind = png.toString('ascii', p + 4, p + 8);
    const data = png.subarray(p + 8, p + 8 + n);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.equal(data[8], 8); assert.equal(data[9], 6, 'RGBA PNG');
      assert.equal(data[12], 0, 'noninterlaced PNG');
    }
    if (kind === 'IDAT') chunks.push(data);
    p += n + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * 4;
  const data = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  assert.equal(raw.length, height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= 4 ? data[i - 4] : 0;
      const b = y > 0 ? data[i - stride] : 0, c = y > 0 && x >= 4 ? data[i - stride - 4] : 0;
      data[i] = (raw[y * (stride + 1) + x + 1] + [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter]) & 255;
    }
  }
  return { width, height, data };
}

function frame(png, index, meta) {
  const data = Buffer.alloc(meta.cell * meta.cell * 4);
  const x = index % meta.columns * meta.cell, y = Math.floor(index / meta.columns) * meta.cell;
  for (let row = 0; row < meta.cell; row++) {
    const offset = ((y + row) * png.width + x) * 4;
    png.data.copy(data, row * meta.cell * 4, offset, offset + meta.cell * 4);
  }
  return data;
}

function colorsAndAlpha(png) {
  const colors = new Set();
  for (let p = 0; p < png.data.length; p += 4) {
    const a = png.data[p + 3];
    if (a !== 0 && a !== 255) assert.fail('actor alpha must be binary');
    if (a) colors.add(png.data.readUInt32BE(p));
    else if (png.data.readUInt32BE(p) !== 0) assert.fail('transparent RGB must be zero');
  }
  assert.ok(colors.size <= 48, `${colors.size} opaque colors exceeds 48`);
}

test('wraith exports the exact v2-compatible 52-key contract', () => {
  const manifest = json(wraithRoot + 'manifest.json'), meta = manifest.wraith;
  assert.equal(manifest.nativePixelsPerUnit, 32);
  assert.equal(meta.path, 'wraith.png');
  assert.equal(meta.cell, 96); assert.equal(meta.columns, 13); assert.equal(meta.rows, 4);
  assert.deepEqual(meta.anchor, [48, 84]);
  assert.equal(meta.filter, 'nearest'); assert.equal(meta.mipmaps, false);
  const names = [];
  for (const facing of ['front', 'back']) for (const [clip, count] of Object.entries({ idle: 4, run: 6, attack: 6, hurt: 4, death: 6 })) {
    const indices = Array.from({ length: count }, (_, i) => names.length + i);
    assert.deepEqual(meta.clips[clip][facing], indices);
    names.push(...indices.map((_, i) => `${facing}-${clip}-${String(i + 1).padStart(2, '0')}`));
  }
  assert.deepEqual(meta.frames, names);
  assert.deepEqual(manifest.authoredFacings, { front: 'SE', back: 'NE' });
  assert.deepEqual(manifest.logicalFacings.NW, { authored: 'back', flipX: true });
});

test('all delivered wraith cells are distinct, nonempty, unclipped and match the packed alpha mask', () => {
  const meta = json(wraithRoot + 'manifest.json').wraith, png = rgba(wraithRoot + meta.path);
  assert.equal(png.width, 1248); assert.equal(png.height, 384); colorsAndAlpha(png);
  const masks = json(wraithRoot + 'hit-masks.json');
  assert.deepEqual(Object.keys(masks), ['wraith.png']);
  const packed = masks['wraith.png'], bytes = Buffer.from(packed.bits, 'base64');
  assert.equal(packed.width, png.width); assert.equal(packed.height, png.height);
  for (let i = 0; i < png.width * png.height; i++) {
    assert.equal(Boolean(bytes[i >> 3] & (1 << (i & 7))), png.data[i * 4 + 3] === 255, `mask pixel ${i}`);
  }
  const unique = new Set();
  for (let i = 0; i < 52; i++) {
    const pixels = frame(png, i, meta); unique.add(hash(pixels));
    assert.ok(pixels.some((a, p) => p % 4 === 3 && a), `empty key ${i}`);
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
      if (x === 0 || y === 0 || x === 95 || y === 95) assert.equal(pixels[(y * 96 + x) * 4 + 3], 0, `clipped key ${i}`);
    }
  }
  assert.equal(unique.size, 52, 'authored keys must not be duplicate files');
});

test('appearance offers all 18 combinations, exact v2 alpha and matching frame-zero previews', () => {
  const manifest = json(lookRoot + 'manifest.json');
  assert.deepEqual(manifest.skins.map(x => x.id), ['warm', 'deep', 'pale']);
  assert.deepEqual(manifest.hair.map(x => x.id), ['shaved', 'short']);
  assert.deepEqual(manifest.sashes.map(x => x.id), ['wine', 'teal', 'ochre']);
  assert.deepEqual(manifest.default, { skin: 'warm', hair: 'shaved', sash: 'wine' });
  assert.equal(manifest.variants.length, 18);
  const original = rgba('assets/game/pixel-v2/monk/monk-v2.png'), unique = new Set(), previews = new Set();
  for (const look of manifest.variants) {
    assert.equal(look.id, `${look.skin}-${look.hair}-${look.sash}`);
    assert.equal(look.path, `${look.id}.png`);
    assert.equal(look.previewPath, `${look.id}-preview.png`);
    const png = rgba(lookRoot + look.path), preview = rgba(lookRoot + look.previewPath);
    assert.equal(png.width, 960); assert.equal(png.height, 960); colorsAndAlpha(png);
    assert.equal(preview.width, 96); assert.equal(preview.height, 96);
    assert.deepEqual(preview.data, frame(png, 0, monk));
    unique.add(hash(png.data)); previews.add(hash(preview.data));
    for (let p = 3; p < png.data.length; p += 4) if (png.data[p] !== original.data[p]) {
      assert.fail(`${look.id}: alpha mask changed at pixel ${(p - 3) / 4}`);
    }
    if (look.id === 'warm-shaved-wine') assert.deepEqual(png.data, original.data, 'default appearance must be unchanged');
  }
  assert.equal(unique.size, 18); assert.equal(previews.size, 18);
});

test('hair remains on the head and every pose preserves all non-target materials', () => {
  const manifest = json(lookRoot + 'manifest.json'), palette = json('assets/game/pixel-v2/monk/palette.json');
  const original = rgba('assets/game/pixel-v2/monk/monk-v2.png');
  const hair = rgba(lookRoot + 'source/hair-mask.png');
  const target = new Set([...palette.skin, ...palette.sash].map(c => parseInt(c + 'ff', 16)));
  assert.equal(hair.width, original.width); assert.equal(hair.height, original.height);
  for (const look of manifest.variants) {
    const png = rgba(lookRoot + look.path);
    for (let p = 0; p < png.data.length; p += 4) {
      const base = original.data.readUInt32BE(p);
      if (hair.data[p + 3]) assert.ok(palette.skin.includes(original.data.subarray(p, p + 3).toString('hex')), 'hair mask outside original scalp/skin');
      if (!target.has(base)) assert.equal(png.data.readUInt32BE(p), base, `non-target material changed for ${look.id}`);
    }
  }
  const shaved = rgba(lookRoot + 'warm-shaved-wine.png'), short = rgba(lookRoot + 'warm-short-wine.png');
  for (let p = 0; p < short.data.length; p += 4) if (!hair.data[p + 3]) {
    assert.equal(short.data.readUInt32BE(p), shaved.data.readUInt32BE(p), 'hair edit escaped the scalp mask');
  }
  const heads = json(lookRoot + 'source/head-regions.json').heads;
  assert.deepEqual(heads.map(h => h.frame), monk.frames);
  for (let i = 0; i < 100; i++) {
    assert.notEqual(hash(frame(short, i, monk)), hash(frame(shaved, i, monk)), `hair missing in frame ${i}`);
    const h = frame(hair, i, monk);
    assert.ok(h.some((a, p) => p % 4 === 3 && a), `empty head mask ${i}`);
    const [x0, y0, x1, y1] = heads[i].box;
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
      if (h[(y * 96 + x) * 4 + 3]) assert.ok(x >= x0 && x < x1 && y >= y0 && y < y1, `scalp region ${i}`);
    }
  }
});

test('read-only verifier validates provenance and deterministic reconstruction without writes', () => {
  const snapshot = () => [wraithRoot, lookRoot].flatMap(prefix => readdirSync(file(prefix), { recursive: true })
    .map(name => prefix + name).filter(path => statSync(file(path)).isFile())
    .sort().map(path => [path, statSync(file(path)).mtimeMs, hash(readFileSync(file(path)))]));
  const before = snapshot();
  const result = spawnSync('python3', [file('scripts/build-adventure-assets.py').pathname, '--verify-only'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'passed'); assert.equal(report.wraith.frames, 52);
  assert.equal(report.appearance.variants, 18); assert.equal(report.appearance.framesPerVariant, 100);
  assert.equal(report.rebuildMatches, true); assert.equal(report.sourceHashesMatch, true);
  assert.deepEqual(snapshot(), before, 'read-only verification changed files or timestamps');
});
