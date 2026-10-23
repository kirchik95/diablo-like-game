import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const packagePath = 'assets/game/pixel-v5/camp';
const root = join(project, packagePath);
const file = name => join(root, name);
const json = name => JSON.parse(readFileSync(file(name), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const staticNames = ['tent-left', 'tent-right', 'road-marker', 'campfire-base', 'supply-cache', 'fallen-log'];
const flameNames = ['flame-0', 'flame-1', 'flame-2', 'flame-3'];

// Independent PNG decoder: do not trust the producer's report or its mask code.
function rgba(name) {
  assert.ok(existsSync(file(name)), `missing delivered image: ${name}`);
  const bytes = readFileSync(file(name)), chunks = [];
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let width, height, ended = false;
  for (let p = 8; p < bytes.length;) {
    const length = bytes.readUInt32BE(p), kind = bytes.toString('ascii', p + 4, p + 8);
    assert.ok(p + length + 12 <= bytes.length, 'truncated PNG chunk');
    const data = bytes.subarray(p + 8, p + 8 + length);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(p + 4, p + 8 + length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    assert.equal((crc ^ 0xffffffff) >>> 0, bytes.readUInt32BE(p + 8 + length), `${name}: ${kind} CRC`);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.deepEqual([...data.subarray(8)], [8, 6, 0, 0, 0], '8-bit non-interlaced RGBA');
    }
    if (kind === 'IDAT') chunks.push(data);
    if (kind === 'IEND') ended = true;
    p += length + 12;
  }
  assert.ok(ended, 'IEND chunk');
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
  return { width, height, data };
}

function frame(png, index, cell, columns) {
  const data = Buffer.alloc(cell * cell * 4), left = index % columns * cell, top = Math.floor(index / columns) * cell;
  for (let y = 0; y < cell; y++) png.data.copy(data, y * cell * 4, ((top + y) * png.width + left) * 4, ((top + y) * png.width + left + cell) * 4);
  return data;
}

function measure(data, cell) {
  let x0 = cell, y0 = cell, x1 = -1, y1 = -1;
  const colors = new Set(), opaque = new Set();
  for (let i = 0; i < cell * cell; i++) if (data[i * 4 + 3]) {
    const x = i % cell, y = Math.floor(i / cell);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    colors.add(data.readUInt32BE(i * 4)); opaque.add(i);
  }
  const count = opaque.size, groups = [];
  while (opaque.size) {
    const first = opaque.values().next().value, queue = [first]; opaque.delete(first);
    for (let n = 0; n < queue.length; n++) {
      const i = queue[n], x = i % cell, y = Math.floor(i / cell);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < cell && ny >= 0 && ny < cell && opaque.delete(ny * cell + nx)) queue.push(ny * cell + nx);
      }
    }
    groups.push(queue.length);
  }
  return { x0, y0, x1, y1, width: x1 - x0 + 1, height: y1 - y0 + 1, count, colors: colors.size, largest: Math.max(0, ...groups) };
}

test('camp manifest supplies exact slicing, frame keys and sampling contract', () => {
  const m = json('manifest.json');
  assert.equal(m.schemaVersion, 1); assert.equal(m.nativePixelsPerUnit, 32);
  assert.deepEqual(m.camp, { path: 'camp.png', cell: 256, columns: 3, rows: 2, anchor: [128, 232], frames: staticNames, filter: 'nearest', mipmaps: false });
  assert.deepEqual(m.campFlame, { path: 'camp-flame.png', cell: 128, columns: 4, rows: 1, anchor: [64, 112], frames: flameNames, filter: 'nearest', mipmaps: false });
  assert.equal(m.hitMasks, 'hit-masks.json');
  assert.equal(m.animations.campfire.atlas, 'campFlame');
  assert.deepEqual(m.animations.campfire.frames, flameNames);
  assert.equal(m.animations.campfire.loop, true);
  assert.ok(m.animations.campfire.frameDurationMs >= 80 && m.animations.campfire.frameDurationMs <= 160);
});

test('actual atlases have binary clean alpha and family-wide palette limits', () => {
  for (const [name, width, height, max] of [['camp.png', 768, 512, 64], ['camp-flame.png', 512, 128, 24]]) {
    const png = rgba(name), colors = new Set();
    assert.equal(png.width, width); assert.equal(png.height, height);
    for (let i = 0; i < png.data.length; i += 4) {
      const alpha = png.data[i + 3];
      assert.ok(alpha === 0 || alpha === 255, `${name}: blended alpha at ${i / 4}`);
      if (alpha) colors.add(png.data.readUInt32BE(i));
      else assert.equal(png.data.readUInt32BE(i), 0, `${name}: RGB under transparent pixel`);
    }
    assert.ok(colors.size >= 8 && colors.size <= max, `${name}: palette ${colors.size}/${max}`);
  }
});

test('six static drawings fit distinct physical sizes and rest at their ground anchors', () => {
  const png = rgba('camp.png'), unique = new Set();
  const ranges = [[190, 220, 140, 170], [190, 220, 140, 170], [32, 80, 50, 100], [64, 108, 30, 65], [95, 150, 60, 110], [75, 130, 30, 65]];
  staticNames.forEach((name, i) => {
    const data = frame(png, i, 256, 3), m = measure(data, 256), [minW, maxW, minH, maxH] = ranges[i];
    unique.add(hash(data));
    assert.ok(m.width >= minW && m.width <= maxW && m.height >= minH && m.height <= maxH, `${name}: ${m.width}x${m.height}`);
    assert.equal(m.y1, 231, `${name}: baseline must match anchor 232`);
    assert.ok(m.x0 >= 8 && m.x1 < 248 && m.y0 >= 8 && m.x0 < 128 && m.x1 >= 128, `${name}: clipped or off-center`);
    assert.ok(m.count > 500 && m.largest / m.count > 0.97, `${name}: fragmented silhouette`);
    assert.ok(m.colors >= 8, `${name}: material modeling`);
    assert.deepEqual(rgba(`frames/${name}.png`).data, data, `${name}: preview cell must match atlas`);
  });
  assert.equal(unique.size, 6, 'each cell contains its own drawing');
});

test('four flame poses change substantial silhouette area while their roots remain fixed', () => {
  const png = rgba('camp-flame.png'), frames = flameNames.map((_, i) => frame(png, i, 128, 4));
  const measures = frames.map(data => measure(data, 128));
  assert.equal(new Set(frames.map(hash)).size, 4);
  frames.forEach((data, i) => {
    const m = measures[i];
    assert.ok(m.height >= 48 && m.height <= 90 && m.width >= 28 && m.width <= 68, `flame-${i}: physical size`);
    assert.equal(m.y1, 99, 'root is 13 pixels above shared ground anchor, within the stone ring');
    assert.ok(m.count > 600 && m.largest / m.count > 0.98, 'no detached sparks, letters or ghost fragments');
    assert.deepEqual(data.subarray(94 * 128 * 4), frames[0].subarray(94 * 128 * 4), 'fixed lower six rows');
    let changed = 0, union = 0;
    const next = frames[(i + 1) % 4];
    for (let p = 0; p < data.length; p += 4) {
      if (data[p + 3] || next[p + 3]) union++;
      if (data[p + 3] !== next[p + 3]) changed++;
    }
    assert.ok(changed / union >= 0.08 && changed / union <= 0.6, `flame ${i} to ${(i + 1) % 4}: silhouette delta ${changed}/${union}`);
    assert.deepEqual(rgba(`frames/${flameNames[i]}.png`).data, data);
  });
  assert.ok(Math.max(...measures.map(m => m.count)) / Math.min(...measures.map(m => m.count)) < 1.65, 'stable apparent flame volume');
  // Flame root and the center of the base use the same world anchor.
  const base = frame(rgba('camp.png'), 3, 256, 3);
  assert.equal(base[(219 * 256 + 128) * 4 + 3], 255, 'fire root falls inside the actual base drawing');
  assert.equal(frames[0][(99 * 128 + 64) * 4 + 3], 255, 'flame root intersects shared center');
});

test('little-bit-first hit masks match every pixel of both actual atlases', () => {
  const masks = json('hit-masks.json');
  assert.deepEqual(Object.keys(masks).sort(), ['camp-flame.png', 'camp.png']);
  for (const name of Object.keys(masks)) {
    const png = rgba(name), mask = masks[name], bits = Buffer.from(mask.bits, 'base64');
    assert.equal(mask.width, png.width); assert.equal(mask.height, png.height);
    assert.equal(bits.length, Math.ceil(png.width * png.height / 8));
    for (let i = 0; i < png.width * png.height; i++) assert.equal(Boolean(bits[i >> 3] & (1 << (i & 7))), png.data[i * 4 + 3] === 255, `${name}: mask pixel ${i}`);
  }
});

test('all six props publish measured ground registration without confusing it with the render anchor', () => {
  const m = json('manifest.json'), f = json('source/footprints.json'), png = rgba('camp.png');
  assert.deepEqual(m.footprints, f, 'renderer metadata and artist source agree');
  const contacts = { ...f.tents, ...f.props };
  assert.deepEqual(Object.keys(contacts), staticNames);
  staticNames.forEach((name, i) => {
    const spec = contacts[name], actual = measure(frame(png, i, 256, 3), 256);
    assert.deepEqual(spec.measuredSilhouetteSize, [actual.width, actual.height]);
    assert.ok(spec.approximate && spec.polygon.length >= 4);
    for (const [x, y] of spec.polygon) assert.ok(x >= actual.x0 && x <= actual.x1 + 1 && y >= actual.y0 && y <= 232, `${name}: outline outside prop bounds`);
    assert.ok(spec.center[0] > actual.x0 && spec.center[0] < actual.x1 && spec.center[1] < 232);
    for (let axis = 0; axis < 2; axis++) assert.ok(Math.abs(spec.centerOffsetFromAnchor[axis] - (spec.center[axis] - [128, 232][axis])) < 0.000001);
  });
  assert.deepEqual(m.campfireAssembly.flameRootOffsetFromAnchor, [0, -13]);
  assert.deepEqual(m.campfireAssembly.flameRootInBaseCell, [128, 219]);
  assert.deepEqual(f.fireAssembly.flameRoot, [64, 99]);
  assert.deepEqual(f.props['campfire-base'].contactSize, [92, 36]);
});

test('saved originals, exact prompts and relative references have valid provenance hashes', () => {
  const provenance = json('source/provenance.json');
  assert.deepEqual(provenance.assets.map(a => a.id), [...staticNames, 'camp-flame']);
  const unique = new Set();
  for (const a of provenance.assets) {
    assert.equal(a.tool, 'image_gen.imagegen');
    assert.ok(!isAbsolute(a.original) && !isAbsolute(a.prompt));
    assert.equal(hash(readFileSync(file(a.original))), a.originalSha256);
    assert.equal(hash(readFileSync(file(a.prompt))), a.promptSha256);
    assert.ok(readFileSync(file(a.prompt), 'utf8').length > 400);
    assert.ok(a.references.length >= 1);
    for (const ref of a.references) {
      assert.ok(!isAbsolute(ref.path) && !ref.path.split('/').includes('..'), 'canonical repository-relative reference');
      assert.equal(hash(readFileSync(join(project, ref.path))), ref.sha256);
    }
    unique.add(a.originalSha256);
  }
  assert.equal(unique.size, 7, 'new source drawing per static object, one coherent flame strip');
});

test('native previews preserve final pixels and enlarge only by nearest neighbor', () => {
  const contact = rgba('previews/contact-native.png'), atlas = rgba('camp.png');
  staticNames.forEach((name, i) => {
    const data = frame(atlas, i, 256, 3), left = i % 3 * 256, top = Math.floor(i / 3) * 288 + 16;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const p = (y * 256 + x) * 4;
      if (data[p + 3]) assert.equal(contact.data.readUInt32BE(((top + y) * contact.width + left + x) * 4), data.readUInt32BE(p), `${name}: contact sheet changed actual pixels`);
    }
  });
  for (const prefix of ['contact', 'tent-left', 'native-context', 'fire-loop', 'ground-contact', 'footprints']) {
    const native = rgba(`previews/${prefix}-native.png`), large = rgba(`previews/${prefix}-2x.png`);
    assert.equal(large.width, native.width * 2); assert.equal(large.height, native.height * 2);
    for (let y = 0; y < large.height; y++) for (let x = 0; x < large.width; x++) {
      const p = (y * large.width + x) * 4, q = ((y >> 1) * native.width + (x >> 1)) * 4;
      assert.equal(large.data.readUInt32BE(p), native.data.readUInt32BE(q), `${prefix}: non-nearest scale`);
    }
  }
});

function snapshot(directory) {
  return readdirSync(directory, { recursive: true }).filter(name => statSync(join(directory, name)).isFile()).sort()
    .map(name => [name, statSync(join(directory, name), { bigint: true }).mtimeNs, hash(readFileSync(join(directory, name)))]);
}

function verify(directory) {
  return spawnSync('python3', ['-B', join(directory, 'scripts/build-camp-assets.py'), '--verify-only'], { cwd: tmpdir(), encoding: 'utf8', timeout: 60000 });
}

test('verify-only reconstructs every delivered artifact without changing package bytes or timestamps', () => {
  const before = snapshot(root), result = verify(project);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'passed'); assert.equal(report.rebuildMatches, true); assert.equal(report.sourceHashesMatch, true);
  assert.equal(report.staticFrames, 6); assert.equal(report.flameFrames, 4);
  assert.ok(report.managedArtifacts >= 25);
  assert.deepEqual(snapshot(root), before);
});

test('a relocated checkout verifies read-only and rejects missing references, altered sources and damaged outputs', t => {
  const relocated = mkdtempSync(join(tmpdir(), 'camp relocated-'));
  t.after(() => rmSync(relocated, { recursive: true, force: true }));
  const copy = name => {
    const destination = join(relocated, name);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(project, name), destination, { recursive: true });
  };
  copy('scripts/build-camp-assets.py'); copy(packagePath);
  const references = [...new Set(json('source/provenance.json').assets.flatMap(a => a.references.map(r => r.path)))];
  const dependencies = json('source/normalization.json').previewReferences;
  for (const name of [...new Set([...references, ...Object.values(dependencies)])]) copy(name);
  const before = snapshot(relocated), result = verify(relocated);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(snapshot(relocated), before, 'relocation changed bytes or timestamps');
  assert.equal(JSON.parse(result.stdout).rebuildMatches, true);

  for (const [name, mutate] of [
    [references.find(name => name.startsWith('assets/concepts/')), path => rmSync(path)],
    [`${packagePath}/source/tent-left-original.png`, path => writeFileSync(path, Buffer.from('damaged source'))],
    [`${packagePath}/camp.png`, path => writeFileSync(path, Buffer.from('damaged atlas'))],
  ]) {
    assert.ok(name); const target = join(relocated, name), saved = readFileSync(target);
    mutate(target);
    const damaged = snapshot(relocated), rejected = verify(relocated);
    assert.notEqual(rejected.status, 0, `${name}: verify must reject damage, never fall back to original checkout`);
    assert.equal(JSON.parse(rejected.stderr).status, 'failed');
    assert.deepEqual(snapshot(relocated), damaged, 'failure must not repair or write files');
    writeFileSync(target, saved);
  }
});
