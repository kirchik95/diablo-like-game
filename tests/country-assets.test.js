import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../assets/game/pixel-v6/country/', import.meta.url);
const file = name => new URL(name, root);
const json = name => JSON.parse(readFileSync(file(name), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const frames = ['grass-low', 'grass-wide', 'fern-low', 'flowers-white', 'flowers-ochre', 'leaves', 'twigs', 'pebbles-flat'];

// Read actual delivered RGBA pixels independently of the Python build/QA code.
function rgba(name) {
  assert.ok(existsSync(file(name)), `${name} is delivered`);
  const bytes = readFileSync(file(name)), chunks = [];
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let width, height;
  for (let p = 8; p < bytes.length;) {
    const length = bytes.readUInt32BE(p), kind = bytes.toString('ascii', p + 4, p + 8);
    const chunk = bytes.subarray(p + 8, p + 8 + length);
    if (kind === 'IHDR') {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      assert.equal(chunk[8], 8); assert.equal(chunk[9], 6); assert.equal(chunk[12], 0);
    }
    if (kind === 'IDAT') chunks.push(chunk);
    p += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * 4;
  assert.equal(raw.length, height * (stride + 1));
  const data = Buffer.alloc(width * height * 4);
  const paeth = (a, b, c) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]; assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= 4 ? data[i - 4] : 0;
      const b = y ? data[i - stride] : 0, c = y && x >= 4 ? data[i - stride - 4] : 0;
      data[i] = (raw[y * (stride + 1) + x + 1] + [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter]) & 255;
    }
  }
  return { width, height, data, pixel(x, y) { return data.subarray((y * width + x) * 4, (y * width + x + 1) * 4); } };
}

test('country art publishes the exact ground and ankle-height decoration contract', () => {
  assert.ok(existsSync(file('manifest.json')), 'country manifest is delivered');
  const manifest = JSON.parse(readFileSync(file('manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.nativePixelsPerUnit, 32);
  assert.deepEqual(manifest.countryDetails, {
    path: 'details.png', cell: 64, columns: 4, rows: 2, anchor: [32, 56],
    frames, filter: 'nearest', mipmaps: false,
  });
  assert.deepEqual(Object.keys(manifest.surfaces), ['countryGrass', 'countrySoil', 'countryStone']);
  for (const [key, name] of [['countryGrass', 'grass'], ['countrySoil', 'soil'], ['countryStone', 'stone']]) {
    assert.deepEqual(manifest.surfaces[key], {
      path: `${name}.png`, size: [128, 128], filter: 'nearest', mipmaps: false,
    });
  }
  assert.equal(manifest.hitMasks, 'hit-masks.json');
});

test('grass, soil and stone remain quiet distinct opaque materials without repeat seams', () => {
  const hashes = new Set();
  for (const name of ['grass', 'soil', 'stone']) {
    const png = rgba(`${name}.png`), colors = new Set(), luma = [], totals = [0, 0, 0];
    assert.equal(png.width, 128); assert.equal(png.height, 128); hashes.add(hash(png.data));
    for (let p = 0; p < png.data.length; p += 4) {
      assert.equal(png.data[p + 3], 255);
      colors.add(png.data.readUInt32BE(p));
      luma.push(.2126 * png.data[p] + .7152 * png.data[p + 1] + .0722 * png.data[p + 2]);
      totals.forEach((_, c) => totals[c] += png.data[p + c]);
    }
    assert.ok(colors.size >= 4 && colors.size <= 24, `${name} palette ${colors.size}`);
    assert.ok(Math.max(...luma) - Math.min(...luma) <= 55, `${name} excessive contrast`);
    const mean = totals.map(value => value / (128 * 128));
    assert.ok(mean.every(value => value >= 75 && value <= 150));
    if (name === 'grass') assert.ok(mean[1] > mean[0] + 7 && mean[1] > mean[2] + 12, 'sage/olive grass');
    if (name === 'soil') assert.ok(mean[0] > mean[1] + 10 && mean[1] > mean[2] + 10, 'brown, not yellow sand');
    if (name === 'stone') assert.ok(Math.max(...mean) - Math.min(...mean) < 12, 'neutral gray stone');
    for (let i = 0; i < 128; i++) {
      assert.deepEqual(png.pixel(0, i), png.pixel(127, i), `${name} horizontal seam ${i}`);
      assert.deepEqual(png.pixel(i, 0), png.pixel(i, 127), `${name} vertical seam ${i}`);
    }
    const repeat = rgba(`previews/${name}-repeat-native.png`);
    assert.equal(repeat.width, 384); assert.equal(repeat.height, 384);
    for (let y = 0; y < 384; y++) for (let x = 0; x < 384; x++) {
      assert.deepEqual(repeat.pixel(x, y), png.pixel(x % 128, y % 128), '3x3 preview uses final pixels');
    }
  }
  assert.equal(hashes.size, 3);
});

test('eight distinct low sprites share binary alpha, zero transparent RGB and a bounded palette', () => {
  const png = rgba('details.png'), colors = new Set(), unique = new Set();
  assert.equal(png.width, 256); assert.equal(png.height, 128);
  for (let i = 0; i < png.data.length; i += 4) {
    const alpha = png.data[i + 3]; assert.ok(alpha === 0 || alpha === 255);
    if (alpha) colors.add(png.data.readUInt32BE(i));
    else assert.equal(png.data.readUInt32BE(i), 0);
  }
  assert.ok(colors.size >= 12 && colors.size <= 32);
  for (let i = 0; i < 8; i++) {
    const left = i % 4 * 64, top = Math.floor(i / 4) * 64, xs = [], ys = [], pixels = [];
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const pixel = png.pixel(left + x, top + y); pixels.push(...pixel);
      if (pixel[3]) { xs.push(x); ys.push(y); }
    }
    assert.ok(xs.length >= 35, `${frames[i]} has a readable silhouette`);
    assert.ok(Math.min(...xs) >= 4 && Math.max(...xs) <= 59);
    assert.ok(Math.min(...xs) < 32 && Math.max(...xs) >= 32);
    assert.equal(Math.max(...ys), 55, `${frames[i]} rests at anchor [32,56]`);
    const height = Math.max(...ys) - Math.min(...ys) + 1;
    assert.ok(height >= 10 && height <= 28, `${frames[i]} height ${height}`);
    unique.add(hash(Buffer.from(pixels)));
  }
  assert.equal(unique.size, 8);
});

test('hit masks encode every actual detail alpha pixel in the existing little-bit-first convention', () => {
  const png = rgba('details.png'), masks = json('hit-masks.json');
  assert.deepEqual(Object.keys(masks), ['details.png']);
  const mask = masks['details.png'], bits = Buffer.from(mask.bits, 'base64');
  assert.equal(mask.width, 256); assert.equal(mask.height, 128); assert.equal(bits.length, 4096);
  for (let i = 0; i < 32768; i++) assert.equal(Boolean(bits[i >> 3] & (1 << (i & 7))), png.data[i * 4 + 3] === 255);
});

test('originals, exact built-in prompts and native previews retain provenance and pixel scale', () => {
  const provenance = json('source/provenance.json'), unique = new Set();
  assert.deepEqual(provenance.assets.map(asset => asset.id), ['grass', 'soil', 'stone', ...frames]);
  for (const asset of provenance.assets) {
    assert.equal(asset.tool, 'image_gen.imagegen');
    assert.equal(hash(readFileSync(file(asset.original))), asset.originalSha256);
    assert.equal(hash(readFileSync(file(asset.prompt))), asset.promptSha256);
    assert.ok(readFileSync(file(asset.prompt), 'utf8').length >= 300);
    unique.add(asset.originalSha256);
    for (const ref of asset.references) assert.equal(hash(readFileSync(file(ref.path))), ref.sha256);
  }
  assert.equal(unique.size, 11);
  const native = rgba('previews/contact-native.png'), zoom = rgba('previews/contact-2x.png');
  assert.equal(zoom.width, native.width * 2); assert.equal(zoom.height, native.height * 2);
  for (let y = 0; y < zoom.height; y++) for (let x = 0; x < zoom.width; x++) assert.deepEqual(zoom.pixel(x, y), native.pixel(x >> 1, y >> 1));
});

function snapshot(path) {
  return readdirSync(path, { recursive: true }).filter(name => statSync(join(path, name)).isFile()).sort()
    .map(name => [name, String(statSync(join(path, name), { bigint: true }).mtimeNs), hash(readFileSync(join(path, name)))]);
}

test('verify-only rebuilds in memory and leaves package bytes and timestamps untouched', () => {
  const path = fileURLToPath(root), before = snapshot(path);
  const script = fileURLToPath(new URL('../scripts/build-country-assets.py', import.meta.url));
  const result = spawnSync('python3', ['-B', script, '--verify-only'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'passed'); assert.equal(report.rebuildMatches, true);
  assert.equal(report.sourceHashesMatch, true); assert.equal(report.details.frames, 8);
  assert.equal(report.surfaces.length, 3); assert.deepEqual(snapshot(path), before);
});

test('verification is portable and rejects corrupted source or output without writing', t => {
  const relocated = mkdtempSync(join(tmpdir(), 'country-art-'));
  t.after(() => rmSync(relocated, { recursive: true, force: true }));
  const copy = (source, destination) => { mkdirSync(dirname(destination), { recursive: true }); cpSync(source, destination, { recursive: true }); };
  copy(fileURLToPath(root), join(relocated, 'assets/game/pixel-v6/country'));
  const script = join(relocated, 'scripts/build-country-assets.py');
  copy(fileURLToPath(new URL('../scripts/build-country-assets.py', import.meta.url)), script);
  const verify = () => spawnSync('python3', ['-B', script, '--verify-only'], { cwd: tmpdir(), encoding: 'utf8' });
  const before = snapshot(relocated), result = verify();
  assert.equal(result.status, 0, result.stdout + result.stderr); assert.deepEqual(snapshot(relocated), before);
  for (const name of ['grass.png', 'source/prompts/grass.txt']) {
    const path = join(relocated, 'assets/game/pixel-v6/country', name), original = readFileSync(path);
    writeFileSync(path, Buffer.concat([original, Buffer.from('corruption')]));
    const corrupted = snapshot(relocated), rejected = verify();
    assert.notEqual(rejected.status, 0); assert.equal(JSON.parse(rejected.stderr).status, 'failed');
    assert.deepEqual(snapshot(relocated), corrupted, 'failed verification also never writes');
    writeFileSync(path, original);
  }
});
