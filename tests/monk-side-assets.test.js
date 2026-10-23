import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const file = path => new URL(path, root);
const json = path => JSON.parse(readFileSync(file(path), 'utf8'));
const pkg = 'assets/game/pixel-v10/monk-side/';
const hash = data => createHash('sha256').update(data).digest('hex');
const meta = json(pkg + 'manifest.json'), monk = meta.monk;
const v2 = json('assets/game/pixel-v2/monk/manifest.json').monk;
const looks = json('assets/game/pixel-v3/appearance/manifest.json');
const SOLE = 83, TRACK = 18;

// Independent RGBA decoder for the delivered, non-interlaced 8-bit PNGs.
function rgba(path) {
  const png = readFileSync(file(path)), chunks = [];
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let width, height;
  for (let p = 8; p < png.length;) {
    const n = png.readUInt32BE(p), kind = png.toString('ascii', p + 4, p + 8), data = png.subarray(p + 8, p + 8 + n);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.equal(data[8], 8); assert.equal(data[9], 6, 'RGBA PNG'); assert.equal(data[12], 0, 'noninterlaced');
    }
    if (kind === 'IDAT') chunks.push(data);
    p += n + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * 4, data = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= 4 ? data[i - 4] : 0, b = y > 0 ? data[i - stride] : 0;
      const c = y > 0 && x >= 4 ? data[i - stride - 4] : 0;
      data[i] = (raw[y * (stride + 1) + x + 1] + [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter]) & 255;
    }
  }
  return { width, height, data };
}
const alphaAt = (png, x, y) => png.data[(y * png.width + x) * 4 + 3];
const cellOrigin = index => [index % monk.columns * monk.cell, Math.floor(index / monk.columns) * monk.cell];
const atlas = rgba(pkg + monk.path);

test('the side package extends the v2 monk contract with ten side keys in row 10', () => {
  assert.equal(meta.schemaVersion, 2); assert.equal(meta.nativePixelsPerUnit, 32);
  for (const key of ['cell', 'columns', 'anchor', 'filter', 'mipmaps', 'timing']) assert.deepEqual(monk[key], v2[key], key);
  assert.equal(monk.rows, 11);
  assert.deepEqual(monk.frames.slice(0, 100), v2.frames);
  assert.deepEqual(monk.frames.slice(100), ['idle-side-01', 'idle-side-02', 'idle-side-03', 'idle-side-04',
    'run-side-01', 'run-side-02', 'run-side-03', 'run-side-04', 'run-side-05', 'run-side-06']);
  for (const [name, facings] of Object.entries(v2.clips)) {
    assert.deepEqual(monk.clips[name].front, facings.front); assert.deepEqual(monk.clips[name].back, facings.back);
  }
  assert.deepEqual(monk.clips.idle.side, [100, 101, 102, 103]);
  assert.deepEqual(monk.clips.run.side, [104, 105, 106, 107, 108, 109]);
  assert.deepEqual(meta.logicalFacings.E, { authored: 'side', flipX: false });
  assert.deepEqual(meta.logicalFacings.W, { authored: 'side', flipX: true });
  assert.equal(atlas.width, 960); assert.equal(atlas.height, 1056);
});

test('rows 0-9 are the shipped atlases; every appearance shares one alpha and hit mask', () => {
  const original = rgba('assets/game/pixel-v2/monk/monk-v2.png');
  assert.ok(atlas.data.subarray(0, original.data.length).equals(original.data), 'default rows 0-9 differ from v2');
  const alpha = Buffer.alloc(atlas.width * atlas.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = atlas.data[i * 4 + 3];
  assert.deepEqual(meta.appearance.variants.map(v => v.id), looks.variants.map(v => v.id));
  for (const variant of meta.appearance.variants) {
    assert.equal(variant.path, `appearance/${variant.id}.png`);
    const image = rgba(pkg + variant.path), shipped = rgba('assets/game/pixel-v3/appearance/' + variant.id + '.png');
    assert.equal(image.height, 1056);
    assert.ok(image.data.subarray(0, shipped.data.length).equals(shipped.data), `${variant.id} rows 0-9`);
    for (let i = 0; i < alpha.length; i++) assert.equal(image.data[i * 4 + 3], alpha[i], `${variant.id} alpha ${i}`);
  }
  const masks = json(pkg + 'hit-masks.json');
  assert.deepEqual(Object.keys(masks), [monk.path]);
  const mask = masks[monk.path], bits = Buffer.from(mask.bits, 'base64');
  assert.equal(mask.width, 960); assert.equal(mask.height, 1056);
  for (let i = 0; i < alpha.length; i++) assert.equal(Boolean(bits[i >> 3] & (1 << (i & 7))), alpha[i] > 0, `mask ${i}`);
  assert.ok([...alpha].every(a => a === 0 || a === 255), 'binary alpha');
});

test('side keys are whole figures standing on the v2 ground row inside their cells', () => {
  for (const index of [...monk.clips.idle.side, ...monk.clips.run.side]) {
    const [ox, oy] = cellOrigin(index);
    let left = 96, top = 96, right = -1, bottom = -1;
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
      if (alphaAt(atlas, ox + x, oy + y)) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
    assert.ok(left > 0 && top > 0 && right < 95, `${monk.frames[index]} clipped`);
    assert.equal(bottom, SOLE, `${monk.frames[index]} feet on the anchor row`);
    assert.ok(bottom - top + 1 >= 52 && bottom - top + 1 <= 64, `${monk.frames[index]} height ${bottom - top + 1}`);
  }
});

test('planted soles do not slide: ground contacts hold for 18 px of travel per key', () => {
  // Opaque runs on the sole row, moved into ground space by the travel of each key.
  const contacts = monk.clips.run.side.map((index, key) => {
    const [ox, oy] = cellOrigin(index), runs = [];
    for (let x = 0, start = -1; x <= 96; x++) {
      const on = x < 96 && alphaAt(atlas, ox + x, oy + SOLE) > 0;
      if (on && start < 0) start = x;
      if (!on && start >= 0) { runs.push([start + key * TRACK, x - 1 + key * TRACK]); start = -1; }
    }
    return runs;
  });
  assert.ok(contacts.every(runs => runs.length === 1), `one foot on the ground per key: ${JSON.stringify(contacts)}`);
  // Keys 1-2 (near foot) and 4-5 (far foot) stand flat on identical ground pixels.
  assert.deepEqual(contacts[1], contacts[0]); assert.deepEqual(contacts[4], contacts[3]);
  // Keys 3 and 6 push off on the toe tip of that same footprint.
  for (const [flat, toe] of [[0, 2], [3, 5]]) {
    assert.ok(contacts[toe][0][1] - contacts[toe][0][0] <= 1, 'toe only');
    assert.ok(Math.abs(contacts[toe][0][1] - contacts[flat][0][1]) <= 1, 'toe pivots in the footprint');
  }
  // One step is three keys of travel; the cycle repeats every 108 px.
  assert.equal(contacts[3][0][0] - contacts[0][0][0], 3 * TRACK);
  assert.equal(meta.sideRun.plantedFootPixelsPerKey, TRACK);
  assert.equal(Math.round(32 * meta.sideRun.keyDistance), TRACK);
  // The idle stands on both feet.
  for (const index of monk.clips.idle.side) {
    const [ox, oy] = cellOrigin(index);
    let runs = 0;
    for (let x = 0, on = false; x < 96; x++) {
      const now = alphaAt(atlas, ox + x, oy + SOLE) > 0;
      if (now && !on) runs++;
      on = now;
    }
    assert.equal(runs, 2, monk.frames[index]);
  }
});

test('provenance hashes every delivered output and the builder verifies read-only', () => {
  const provenance = json(pkg + 'provenance.json');
  for (const output of provenance.outputs) assert.equal(hash(readFileSync(file(output.path))), output.sha256, output.path);
  for (const input of provenance.inputs) assert.equal(hash(readFileSync(file(input.path))), input.sha256, input.path);
  for (const required of ['README.md', 'qa-report.json', 'previews/index.html', 'previews/compare-run.gif',
    'previews/compare-3x.png', 'previews/foot-track-3x.png', 'source/rig.json']) assert.ok(existsSync(file(pkg + required)), required);
  const snapshot = () => JSON.stringify(readdirSync(file(pkg), { recursive: true }).sort()
    .filter(name => statSync(file(pkg + name)).isFile())
    .map(name => [name, statSync(file(pkg + name)).mtimeMs, hash(readFileSync(file(pkg + name)))]));
  const before = snapshot();
  const result = spawnSync('python3', [file('scripts/build-monk-side-animation.py').pathname, '--verify-only'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'passed'); assert.equal(report.mode, 'read-only');
  assert.equal(report.rebuildMatches, true); assert.equal(report.footLock.flatSoleSlidePixels, 0);
  assert.equal(snapshot(), before, 'read-only verification changed files or timestamps');
});
