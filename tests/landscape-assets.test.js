import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../assets/game/pixel-v4/landscape/', import.meta.url);
const file = name => new URL(name, root);
const json = name => JSON.parse(readFileSync(file(name), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const frames = ['cypress', 'dead-tree', 'rock-large', 'rock-small', 'shrub', 'grass', 'ruin-pile', 'supplies'];

// Read the delivered PNG pixels independently of the Python producer/QA report.
function rgba(name) {
  assert.ok(existsSync(file(name)), `missing delivered image: ${name}`);
  const bytes = readFileSync(file(name)), chunks = [];
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let width, height;
  for (let p = 8; p < bytes.length;) {
    const length = bytes.readUInt32BE(p), kind = bytes.toString('ascii', p + 4, p + 8);
    const data = bytes.subarray(p + 8, p + 8 + length);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.equal(data[8], 8); assert.equal(data[9], 6, 'normalized RGBA PNG');
      assert.equal(data[12], 0, 'non-interlaced PNG');
    }
    if (kind === 'IDAT') chunks.push(data);
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
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= 4 ? data[i - 4] : 0;
      const b = y > 0 ? data[i - stride] : 0, c = y > 0 && x >= 4 ? data[i - stride - 4] : 0;
      data[i] = (raw[y * (stride + 1) + x + 1] + [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter]) & 255;
    }
  }
  return { width, height, data, pixel(x, y) { return data.subarray((y * width + x) * 4, (y * width + x + 1) * 4); } };
}

function crop(png, index) {
  const data = Buffer.alloc(160 * 160 * 4), left = index % 4 * 160, top = Math.floor(index / 4) * 160;
  for (let y = 0; y < 160; y++) png.data.copy(data, y * 160 * 4, ((top + y) * png.width + left) * 4, ((top + y) * png.width + left + 160) * 4);
  return data;
}

function components(pixels) {
  const unvisited = new Set();
  for (let i = 0; i < 160 * 160; i++) if (pixels[i * 4 + 3]) unvisited.add(i);
  const sizes = [];
  while (unvisited.size) {
    const first = unvisited.values().next().value, queue = [first]; unvisited.delete(first);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const i = queue[cursor], x = i % 160, y = Math.floor(i / 160);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * 160 + nx;
        if (nx >= 0 && nx < 160 && ny >= 0 && ny < 160 && unvisited.delete(next)) queue.push(next);
      }
    }
    sizes.push(queue.length);
  }
  return sizes.sort((a, b) => b - a);
}

test('landscape publishes the exact renderer contract at 32 native pixels per unit', () => {
  const manifest = json('manifest.json');
  assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.nativePixelsPerUnit, 32);
  assert.equal(manifest.status, 'ready');
  assert.deepEqual(manifest.landscape, {
    path: 'landscape.png', cell: 160, columns: 4, rows: 2, anchor: [80, 144],
    frames, filter: 'nearest', mipmaps: false,
  });
  assert.deepEqual(Object.keys(manifest.surfaces), ['earth', 'moss', 'cliff']);
  for (const key of Object.keys(manifest.surfaces)) assert.deepEqual(manifest.surfaces[key], {
    path: `${key}.png`, size: [32, 32], filter: 'nearest', mipmaps: false,
  });
  assert.equal(manifest.hitMasks, 'hit-masks.json');
});

test('eight real prop cells have binary alpha, one shared palette, connected silhouettes and native scale', () => {
  const png = rgba('landscape.png'), colors = new Set(), unique = new Set();
  assert.equal(png.width, 640); assert.equal(png.height, 320);
  for (let p = 0; p < png.data.length; p += 4) {
    const a = png.data[p + 3];
    assert.ok(a === 0 || a === 255, 'binary alpha');
    if (a) colors.add(png.data.readUInt32BE(p));
    else assert.equal(png.data.readUInt32BE(p), 0, 'zero RGB under transparent pixels');
  }
  assert.ok(colors.size >= 12 && colors.size <= 48, `shared palette has ${colors.size} colors`);
  // Broad physical ranges protect against auto-fitting every object to the full cell.
  const ranges = [[110, 136], [95, 125], [32, 56], [12, 28], [20, 42], [10, 24], [34, 64], [36, 64]];
  for (let index = 0; index < frames.length; index++) {
    const data = crop(png, index), coords = []; unique.add(hash(data));
    for (let i = 0; i < 160 * 160; i++) if (data[i * 4 + 3]) coords.push([i % 160, Math.floor(i / 160)]);
    assert.ok(coords.length > 70, `${frames[index]} is a drawing, not an empty placeholder`);
    const xs = coords.map(p => p[0]), ys = coords.map(p => p[1]);
    const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    assert.ok(x0 >= 4 && x1 <= 155 && y0 >= 4 && y1 <= 147, `${frames[index]} has a clear cell gutter`);
    assert.equal(y1, 143, `${frames[index]} rests at the shared ground anchor`);
    assert.ok(x0 < 80 && x1 >= 80, `${frames[index]} straddles its anchor`);
    const height = y1 - y0 + 1, [min, max] = ranges[index];
    assert.ok(height >= min && height <= max, `${frames[index]} native height ${height} outside ${min}–${max}`);
    assert.ok(components(data)[0] / coords.length >= 0.97, `${frames[index]} fragmented silhouette`);
    assert.ok(new Set(coords.map(([x, y]) => data.readUInt32BE((y * 160 + x) * 4))).size >= 4, 'modeled material planes');
  }
  assert.equal(unique.size, 8, 'eight independently drawn cells');
});

test('packed little-bit-first hit mask matches every actual PNG alpha pixel', () => {
  const png = rgba('landscape.png'), masks = json('hit-masks.json');
  assert.deepEqual(Object.keys(masks), ['landscape.png']);
  const mask = masks['landscape.png'], bits = Buffer.from(mask.bits, 'base64');
  assert.equal(mask.width, png.width); assert.equal(mask.height, png.height);
  assert.equal(bits.length, Math.ceil(png.width * png.height / 8));
  for (let i = 0; i < png.width * png.height; i++) assert.equal(Boolean(bits[i >> 3] & (1 << (i & 7))), png.data[i * 4 + 3] === 255, `mask pixel ${i}`);
});

test('three surfaces are opaque, low-contrast, palette-bounded and seamless on both axes', () => {
  const unique = new Set();
  for (const name of ['earth', 'moss', 'cliff']) {
    const png = rgba(`${name}.png`), colors = new Set(), luminance = [];
    assert.equal(png.width, 32); assert.equal(png.height, 32); unique.add(hash(png.data));
    for (let p = 0; p < png.data.length; p += 4) {
      assert.equal(png.data[p + 3], 255, `${name}: no holes`);
      colors.add(png.data.readUInt32BE(p));
      luminance.push(0.2126 * png.data[p] + 0.7152 * png.data[p + 1] + 0.0722 * png.data[p + 2]);
    }
    assert.ok(colors.size >= 4 && colors.size <= 24, `${name}: ${colors.size} colors`);
    assert.ok(Math.max(...luminance) - Math.min(...luminance) <= 70, `${name}: excessive terrain contrast`);
    const mean = [0, 1, 2].map(c => {
      let total = 0;
      for (let p = c; p < png.data.length; p += 4) total += png.data[p];
      return total / (32 * 32);
    });
    assert.ok(mean.every(c => c >= 85 && c <= 145), `${name}: outdoor material values, no cave-black ground`);
    if (name === 'earth') assert.ok(mean[0] > mean[1] && mean[1] > mean[2], 'natural warm soil');
    if (name === 'moss') assert.ok(mean[1] > mean[0] + 8 && mean[1] > mean[2] + 8, 'grey-green groundcover');
    if (name === 'cliff') assert.ok(Math.max(...mean) - Math.min(...mean) < 20, 'neutral outdoor stone');
    for (let i = 0; i < 32; i++) {
      assert.deepEqual(png.pixel(0, i), png.pixel(31, i), `${name}: horizontal seam at ${i}`);
      assert.deepEqual(png.pixel(i, 0), png.pixel(i, 31), `${name}: vertical seam at ${i}`);
    }
    const preview = rgba(`previews/${name}-repeat-native.png`);
    assert.equal(preview.width, 96); assert.equal(preview.height, 96);
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) assert.deepEqual(preview.pixel(x, y), png.pixel(x % 32, y % 32), `${name}: preview must repeat final pixels`);
  }
  assert.equal(unique.size, 3, 'different material surfaces');
});

test('source drafts, exact prompts and native/2x visual proof are delivered with recorded hashes', () => {
  const provenance = json('source/provenance.json');
  assert.equal(provenance.assets.length, 11);
  assert.deepEqual(provenance.assets.map(a => a.id), [...frames, 'earth', 'moss', 'cliff']);
  const originals = new Set();
  for (const asset of provenance.assets) {
    assert.equal(asset.tool, 'image_gen.imagegen');
    assert.ok(asset.references.length >= 1);
    assert.equal(hash(readFileSync(file(asset.original))), asset.originalSha256);
    assert.equal(hash(readFileSync(file(asset.prompt))), asset.promptSha256);
    assert.ok(readFileSync(file(asset.prompt), 'utf8').length > 300, `${asset.id}: full prompt`);
    originals.add(asset.originalSha256);
  }
  assert.equal(originals.size, 11, 'one distinct source draft per asset');
  const native = rgba('previews/contact-native.png'), enlarged = rgba('previews/contact-2x.png');
  assert.equal(enlarged.width, native.width * 2); assert.equal(enlarged.height, native.height * 2);
  for (let y = 0; y < enlarged.height; y++) for (let x = 0; x < enlarged.width; x++) assert.deepEqual(enlarged.pixel(x, y), native.pixel(x >> 1, y >> 1), 'nearest-neighbor 2x proof');
  assert.ok(existsSync(file('previews/native-context.png')));
});

test('verify-only reconstructs the package and validates sources without writing any files', () => {
  const snapshot = () => readdirSync(root, { recursive: true }).filter(name => statSync(file(name)).isFile())
    .sort().map(name => [name, statSync(file(name)).mtimeMs, hash(readFileSync(file(name)))]);
  const before = snapshot();
  const script = new URL('../scripts/build-landscape-assets.py', import.meta.url);
  assert.ok(existsSync(script), 'reproducible landscape producer is delivered');
  const result = spawnSync('python3', ['-B', fileURLToPath(script), '--verify-only'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'passed'); assert.equal(report.props.frames, 8);
  assert.equal(report.surfaces.length, 3); assert.equal(report.rebuildMatches, true);
  assert.equal(report.sourceHashesMatch, true);
  assert.deepEqual(snapshot(), before, 'read-only verification changed package content or timestamps');
});

test('relocated verification uses the copied references and never writes to the independent checkout', t => {
  const project = fileURLToPath(new URL('../', import.meta.url));
  const relocated = realpathSync(mkdtempSync(join(tmpdir(), 'landscape relocated-')));
  t.after(() => rmSync(relocated, { recursive: true, force: true }));
  const copy = name => {
    const destination = join(relocated, name);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(project, name), destination, { recursive: true });
  };
  copy('scripts/build-landscape-assets.py');
  copy('assets/game/pixel-v4/landscape');
  // Provenance already publishes canonical repo-relative dependencies. Copy the
  // real files without rewriting generation records or the builder's ROOT.
  const references = [...new Set(json('source/provenance.json').assets.flatMap(asset => asset.references.map(ref => ref.path)))];
  for (const reference of references) copy(reference);
  const snapshot = () => readdirSync(relocated, { recursive: true })
    .filter(name => statSync(join(relocated, name)).isFile()).sort()
    .map(name => [name, statSync(join(relocated, name), { bigint: true }).mtimeNs, hash(readFileSync(join(relocated, name)))]);
  const verify = () => spawnSync('python3', ['-B', join(relocated, 'scripts/build-landscape-assets.py'), '--verify-only'],
    { cwd: tmpdir(), encoding: 'utf8' });
  const before = snapshot(), result = verify();
  assert.deepEqual(snapshot(), before, 'relocated verification wrote files or changed timestamps');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'passed'); assert.equal(report.rebuildMatches, true);
  assert.equal(report.sourceHashesMatch, true); assert.equal(report.managedArtifacts, 23);

  // The original file remains available: silently falling back to the old
  // checkout would make this negative control pass when it must fail.
  const missing = references.find(name => name.startsWith('assets/concepts/'));
  assert.ok(missing && existsSync(join(project, missing)));
  rmSync(join(relocated, missing));
  const beforeMissing = snapshot(), rejected = verify();
  assert.notEqual(rejected.status, 0, 'missing copied reference must not fall back to the original checkout');
  assert.equal(JSON.parse(rejected.stderr).status, 'failed');
  assert.ok(rejected.stderr.includes(join(relocated, missing)), rejected.stderr);
  assert.deepEqual(snapshot(), beforeMissing, 'failed verification wrote files or changed timestamps');
});
