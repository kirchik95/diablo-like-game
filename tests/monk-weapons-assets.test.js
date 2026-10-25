import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const file = path => new URL(path, root);
const json = path => JSON.parse(readFileSync(file(path), 'utf8'));
const pkg = 'assets/game/pixel-v12/monk-weapons/';
const hash = data => createHash('sha256').update(data).digest('hex');
const meta = json(pkg + 'manifest.json');
const monk = json('assets/game/pixel-v10/monk-side/manifest.json').monk;
const skin = new Set(json('assets/game/pixel-v2/monk/palette.json').skin);
const palette = new Set(Object.values(meta.palette).flat());

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
const pixel = (png, x, y) => png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4);
const hex = px => [...px.subarray(0, 3)].map(v => v.toString(16).padStart(2, '0')).join('');
// Opaque pixels of one cell: [x, y, rgb hex] in cell coordinates.
function cellPixels(png, index, [w, h], columns) {
  const x0 = index % columns * w, y0 = Math.floor(index / columns) * h, out = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = pixel(png, x0 + x, y0 + y);
      if (px[3]) out.push([x, y, hex(px)]);
    }
  }
  return out;
}

const knuckles = rgba(pkg + meta.knuckles.path), staff = rgba(pkg + meta.staff.path);
const swings = rgba(pkg + meta.staffAttacks.path), body = rgba('assets/game/pixel-v10/monk-side/' + monk.path);
const CELL = [meta.monkAtlas.cell, meta.monkAtlas.cell], SWING = meta.staffAttacks.cell;

test('the weapon package follows the 110-key monk atlas geometry', () => {
  assert.equal(meta.schemaVersion, 1); assert.equal(meta.status, 'ready'); assert.equal(meta.nativePixelsPerUnit, 32);
  assert.equal(meta.appearanceIndependent, true);
  for (const key of ['cell', 'columns', 'anchor']) assert.deepEqual(meta.monkAtlas[key], monk[key], key);
  assert.equal(meta.monkAtlas.rows, monk.rows); assert.equal(meta.monkAtlas.keys, monk.frames.length);
  for (const layer of [meta.knuckles, meta.staff]) {
    assert.equal(layer.cell, monk.cell); assert.equal(layer.columns, monk.columns);
    assert.deepEqual(layer.anchor, monk.anchor); assert.equal(layer.filter, 'nearest'); assert.equal(layer.mipmaps, false);
  }
  assert.deepEqual([knuckles.width, knuckles.height], [960, meta.knuckles.rows * 96]);
  assert.deepEqual([staff.width, staff.height], [960, 1056]);
  assert.deepEqual([swings.width, swings.height], [meta.staffAttacks.columns * SWING[0], meta.staffAttacks.rows * SWING[1]]);
  // The monk cell sits inside a swing cell so both share the ground anchor.
  assert.deepEqual(meta.staffAttacks.monkCellOffset.map((v, i) => v + monk.anchor[i]), meta.staffAttacks.anchor);
});

test('manifest and provenance hashes match the delivered files', () => {
  assert.deepEqual(meta.files.map(f => f.path).sort(), ['knuckles.png', 'staff-attacks.png', 'staff.png']);
  for (const entry of meta.files) {
    const data = readFileSync(file(pkg + entry.path)), png = rgba(pkg + entry.path);
    assert.equal(data.length, entry.bytes, entry.path); assert.equal(hash(data), entry.sha256, entry.path);
    assert.deepEqual([png.width, png.height], entry.size, entry.path);
  }
  const record = json(pkg + 'provenance.json');
  assert.equal(record.builder, 'scripts/build-monk-weapons.py');
  assert.match(record.generationMode, /No image generation/);
  for (const output of record.outputs) {
    const data = readFileSync(file(output.path));
    assert.equal(hash(data), output.sha256, output.path); assert.equal(data.length, output.bytes, output.path);
  }
  for (const input of record.inputs) assert.equal(hash(readFileSync(file(input.path))), input.sha256, input.path);
  const delivered = readdirSync(file(pkg), { recursive: true }).filter(name => statSync(file(pkg + name)).isFile());
  const recorded = new Set(record.outputs.map(o => o.path.slice(pkg.length)));
  for (const name of delivered) {
    if (!['provenance.json', 'qa-report.json', 'README.md'].includes(name)) assert.ok(recorded.has(name), `${name} is not recorded`);
  }
});

test('every monk key has knuckle and staff data with grips inside its cell', () => {
  assert.equal(meta.keys.length, 110);
  meta.keys.forEach((key, i) => {
    assert.equal(key.index, i); assert.equal(key.name, monk.frames[i]);
    assert.equal(key.knuckles.cell, i); assert.equal(key.staff.cell, i);
    for (const hand of key.hands) {
      const [x, y] = hand.centre;
      assert.ok(x >= 0 && x < 96 && y >= 0 && y < 96, `${key.name} hand ${hand.centre}`);
      assert.ok(Math.abs(Math.hypot(...hand.axis) - 1) < .02, `${key.name} hand axis`);
    }
    const s = key.staff;
    assert.ok(['two-hand', 'one-hand', 'free'].includes(s.mode), key.name);
    assert.equal(s.grips.length, { 'two-hand': 2, 'one-hand': 1, free: 0 }[s.mode], key.name);
    for (const [x, y] of [...s.grips, s.butt, s.tip]) assert.ok(x >= 1 && x <= 94 && y >= 1 && y <= 95, `${key.name} staff ${x},${y}`);
    // A grip is a drawn hand (or, for a hidden pair, the authored chest point).
    for (const grip of s.grips) {
      const near = key.hands.some(h => Math.hypot(h.centre[0] - grip[0], h.centre[1] - grip[1]) < 6)
        || (key.hands.length >= 2 && Math.hypot((key.hands[0].centre[0] + key.hands[1].centre[0]) / 2 - grip[0],
          (key.hands[0].centre[1] + key.hands[1].centre[1]) / 2 - grip[1]) < 1) || key.hands.length === 0;
      assert.ok(near, `${key.name} grip ${grip} is not on a hand`);
    }
    assert.ok(Math.abs(Math.atan2(s.tip[1] - s.butt[1], s.tip[0] - s.butt[0]) * 180 / Math.PI - s.angle) < .2, key.name);
  });
  // Visible fists carry knuckles on idle, run and the strike drawings in both facings.
  for (const clip of ['idle', 'run', 'attack1', 'attack2', 'attack3']) {
    for (const facing of ['front', 'back']) {
      for (const i of monk.clips[clip][facing]) {
        if (meta.keys[i].hands.length) assert.ok(meta.keys[i].knuckles.pixels > 0, `${monk.frames[i]} has no band`);
      }
    }
  }
});

test('knuckle bands sit on the monk skin only; weapon layers use the weapon palette and no skin', () => {
  for (let i = 0; i < 110; i++) {
    const band = cellPixels(knuckles, i, CELL, 10);
    assert.equal(band.length, meta.keys[i].knuckles.pixels, monk.frames[i]);
    for (const [x, y] of band) {
      const under = pixel(body, i % 10 * 96 + x, Math.floor(i / 10) * 96 + y);
      assert.ok(under[3] && skin.has(hex(under)), `${monk.frames[i]} band pixel ${x},${y} is off the skin`);
    }
    assert.ok(cellPixels(staff, i, CELL, 10).length >= 24, `${monk.frames[i]} staff cell is empty`);
  }
  for (const png of [knuckles, staff, swings]) {
    for (let i = 0; i < png.width * png.height; i++) {
      const a = png.data[i * 4 + 3];
      if (!a) { assert.equal(png.data.readUIntBE(i * 4, 3), 0, 'transparent RGB is zero'); continue; }
      assert.equal(a, 255, 'binary alpha');
      const c = hex(png.data.subarray(i * 4, i * 4 + 4));
      assert.ok(palette.has(c), `colour ${c} outside the weapon palette`); assert.ok(!skin.has(c), 'skin in a weapon layer');
    }
  }
});

test('four knuckle strikes and three staff swings cover the facings the monk uses', () => {
  const strikes = meta.knuckles.clips;
  assert.deepEqual(Object.keys(strikes), ['knuckleStrike1', 'knuckleStrike2', 'knuckleStrike3', 'knuckleStrike4']);
  const overlays = new Set();
  for (const [id, clip] of Object.entries(strikes)) {
    assert.equal(clip.contactKey, 2); assert.equal(clip.keyTimesMs.length, 6);
    for (const facing of ['front', 'back']) {
      assert.equal(clip[facing].length, 6, id);
      clip[facing].forEach((key, k) => {
        assert.ok(key.frame >= 0 && key.frame < 100, id); overlays.add(key.overlay);
        assert.ok(key.overlay >= 110 && key.overlay < meta.knuckles.rows * 10, id);
        // Empty only where the body drawing hides both hands (back attack3 key 02) and there is no accent.
        if (meta.keys[key.frame].hands.length || clip.accent[k]) {
          assert.ok(cellPixels(knuckles, key.overlay, CELL, 10).length > 0, `${id} overlay ${key.overlay} is empty`);
        }
      });
      // The contact key adds an accent to the band of its body frame.
      const hit = clip[facing][2];
      assert.ok(cellPixels(knuckles, hit.overlay, CELL, 10).length > meta.keys[hit.frame].knuckles.pixels, `${id} ${facing} contact`);
    }
  }
  assert.equal(overlays.size, 48);
  // The 4th strike reuses attack3 key 02, attack2 keys 02/04/05 and attack3 key 06 (README).
  assert.deepEqual(strikes.knuckleStrike4.front.map(k => k.frame), [23, 17, 19, 19, 20, 27]);
  assert.deepEqual(strikes.knuckleStrike4.back.map(k => k.frame), [73, 67, 69, 69, 70, 77]);

  const clips = meta.staffAttacks.clips, cells = new Set();
  assert.deepEqual(Object.keys(clips), ['staffAttack1', 'staffAttack2', 'staffAttack3']);
  for (const [id, clip] of Object.entries(clips)) {
    assert.equal(clip.contactKey, 2); assert.equal(clip.keyTimesMs.length, 6);
    for (const facing of ['front', 'back', 'side']) {
      assert.equal(clip[facing].length, 6, `${id} ${facing}`);
      for (const key of clip[facing]) {
        assert.ok(Number.isInteger(key.frame) && key.frame >= 0 && key.frame < 110, id);
        assert.equal(typeof key.mirrorBody, 'boolean'); cells.add(key.staff);
        for (const [x, y] of [key.grip, key.butt, key.tip]) assert.ok(x >= 0 && x < SWING[0] && y >= 0 && y < SWING[1], `${id} ${x},${y}`);
        assert.ok(cellPixels(swings, key.staff, SWING, 10).length >= 30, `${id} ${facing} staff cell ${key.staff}`);
      }
    }
  }
  assert.equal(cells.size, 54);
  // The 360-degree spin turns the body through four authored facings (SE, SW, NW, NE).
  const spin = clips.staffAttack3.front.slice(1, 5).map(k => `${k.frame >= 50 ? 'back' : 'front'}/${k.mirrorBody}`);
  assert.equal(new Set(spin).size, 4);
});

test('read-only verification rebuilds the package without writing', () => {
  const snapshot = () => JSON.stringify(readdirSync(file(pkg), { recursive: true }).sort()
    .filter(name => statSync(file(pkg + name)).isFile())
    .map(name => [name, statSync(file(pkg + name)).mtimeMs, hash(readFileSync(file(pkg + name)))]));
  const before = snapshot();
  const result = spawnSync('python3', [file('scripts/build-monk-weapons.py').pathname, '--verify-only'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'passed'); assert.equal(report.mode, 'read-only'); assert.equal(report.rebuildMatches, true);
  assert.equal(report.keys, 110); assert.equal(report.swingCells, 54); assert.equal(report.knuckleStrikeCells, 48);
  assert.equal(snapshot(), before, 'read-only verification changed files or timestamps');
});
