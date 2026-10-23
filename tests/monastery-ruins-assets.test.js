import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readPng } from './helpers/png.js';

const root = new URL('../', import.meta.url);
const pkg = new URL('assets/game/pixel-v11/monastery-ruins/', root);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', pkg)));
const contract = JSON.parse(readFileSync(new URL('source/footprints.json', pkg)));
const palette = JSON.parse(readFileSync(new URL('source/palette.json', pkg)));
const campPalette = JSON.parse(readFileSync(new URL('assets/game/pixel-v9/camp-panorama/source/palette.json', root)));
const FRAMES = ['wall-run-x', 'wall-run-y', 'wall-window-x', 'wall-window-y', 'wall-end-x', 'wall-end-y', 'wall-breach-x',
  'wall-corner', 'arch-gate', 'parapet-x', 'parapet-y', 'parapet-corner', 'column-intact', 'column-broken', 'column-drums',
  'ritual-plinth', 'ritual-plinth-runes', 'fallen-block', 'fallen-lintel', 'fallen-blocks', 'rubble-pile', 'rubble-scatter',
  'flagstones-broken', 'flagstone-cracks', 'moss-patch', 'ivy-clump', 'dead-tree', 'dead-tree-snag',
  'parapet-broken-x', 'parapet-broken-y', 'corner-stump', 'rubble-small'];
const KX = 16 * Math.SQRT2, KY = 8 * Math.SQRT2;

// Independent RGB(A) decoder for the delivered 8-bit truecolour PNGs.
function decode(url) {
  const data = readFileSync(url), parts = [];
  let width, height, channels;
  for (let offset = 8; offset < data.length;) {
    const length = data.readUInt32BE(offset), name = data.toString('ascii', offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (name === 'IHDR') {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      assert.equal(chunk[8], 8);
      channels = { 2: 3, 6: 4 }[chunk[9]];
      assert.ok(channels, 'truecolour PNG');
    } else if (name === 'IDAT') parts.push(chunk);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(parts)), stride = width * channels, out = new Uint8Array(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, left = x >= channels ? out[i - channels] : 0, up = y ? out[i - stride] : 0;
      const corner = x >= channels && y ? out[i - stride - channels] : 0;
      out[i] = (raw[y * (stride + 1) + x + 1] + [0, left, up, (left + up) >> 1, paeth(left, up, corner)][filter]) & 255;
    }
  }
  const pixel = (x, y) => {
    const i = (y * width + x) * channels;
    return [out[i], out[i + 1], out[i + 2], channels === 4 ? out[i + 3] : 255];
  };
  return { width, height, pixel };
}
const atlas = decode(new URL('monastery-ruins.png', pkg));
const world = decode(new URL('monastery-world.png', pkg));
const WORLD_CLIPS = ['brazier-cyan', 'brazier-magenta', 'ritual-source', 'healing-shrine'];
const WORLD_FRAMES = WORLD_CLIPS.flatMap(clip => [1, 2, 3, 4, 5, 6].map(k => `${clip}-0${k}`));
const hex = p => '#' + p.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
const cellOrigin = name => { const i = FRAMES.indexOf(name); return [(i % 4) * 256, Math.floor(i / 4) * 256]; };
const opaqueOf = name => {
  const [ox, oy] = cellOrigin(name), result = [];
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (atlas.pixel(ox + x, oy + y)[3]) result.push([x, y]);
  return result;
};
const boxesOf = record => record.colliders ?? [{ x: 0, y: 0, halfWidth: record.halfWidth, halfDepth: record.halfDepth }];
const toScreen = (record, wx, wy) => [record.contactCenter[0] + KX * (wy - wx), record.contactCenter[1] + KY * (wx + wy)];

test('monastery ruins manifest publishes the atlas, the flagstone surface and the footprint contract', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.nativePixelsPerUnit, 32);
  assert.deepEqual(manifest.monasteryRuins, { path: 'monastery-ruins.png', cell: 256, columns: 4, rows: 8,
    anchor: [128, 232], frames: FRAMES, filter: 'nearest', mipmaps: false });
  assert.deepEqual(manifest.surfaces, { courtyardFlagstone: { path: 'courtyard-flagstone.png', size: [128, 128],
    filter: 'nearest', mipmaps: false } });
  assert.deepEqual(manifest.footprints, contract.frames, 'manifest must carry the drawing contract unchanged');
  assert.deepEqual(contract.anchor, manifest.monasteryRuins.anchor);
  assert.equal(atlas.width, 1024); assert.equal(atlas.height, 2048);
  // Screen-space reservations use the exact opaque box of every cell (exclusive end, as in pixel-v9).
  assert.deepEqual(Object.keys(manifest.opaqueBounds), FRAMES);
  for (const name of FRAMES) {
    const pixels = opaqueOf(name), xs = pixels.map(p => p[0]), ys = pixels.map(p => p[1]);
    assert.deepEqual(manifest.opaqueBounds[name], [Math.min(...xs), Math.min(...ys), Math.max(...xs) + 1, Math.max(...ys) + 1], name);
  }
});

test('every footprint follows the pixel-v9 contact rule and its parts stay inside the frame box', () => {
  for (const name of FRAMES) {
    const record = contract.frames[name];
    assert.ok(['solid', 'flat'].includes(record.role), name);
    const front = record.shape === 'circle' ? 16 * record.radius : (record.halfWidth + record.halfDepth) * 8 * Math.SQRT2;
    assert.deepEqual(record.contactCenter, [128, Math.floor((231 - front) * 4) / 4], `${name} contact centre`);
    if (record.shape === 'circle') { assert.ok(record.radius > 0, name); continue; }
    const { halfWidth: hw, halfDepth: hd } = record;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => toScreen(record, x, y));
    record.polygon.forEach((p, i) => p.forEach((v, c) => assert.ok(Math.abs(v - corners[i][c]) < .006, `${name} polygon`)));
    for (const part of [...(record.colliders ?? []), ...[record.passage, record.socket].filter(Boolean)]) {
      assert.ok(Math.abs(part.x) + part.halfWidth <= hw + 1e-9 && Math.abs(part.y) + part.halfDepth <= hd + 1e-9, `${name} part`);
    }
  }
  // The dais is ground art without a collider: melee needs a clear line to the source centre.
  for (const name of ['ritual-plinth', 'ritual-plinth-runes']) {
    const record = contract.frames[name];
    assert.equal(record.role, 'flat', name);
    assert.ok(!record.colliders, name);
    // The v2 shrine pedestal (about 0.92u half size) stands in the ground-level socket.
    assert.ok(record.socket.halfWidth >= .95 && record.socket.halfDepth >= .95, name);
  }
  assert.equal(contract.frames['ritual-plinth-runes'].variantOf, 'ritual-plinth');
  // Broken parapets stand in two chunks; their bare middle stays walkable.
  for (const name of ['parapet-broken-x', 'parapet-broken-y']) {
    const [a, b] = contract.frames[name].colliders, axis = contract.frames[name].axis;
    assert.equal(contract.frames[name].colliders.length, 2, name);
    const end = axis === 'x' ? a.x + a.halfWidth : a.y + a.halfDepth, start = axis === 'x' ? b.x - b.halfWidth : b.y - b.halfDepth;
    assert.ok(start - end >= .6, `${name}: gap ${(start - end).toFixed(2)}u`);
  }
});

test('atlas alpha is binary with zero transparent RGB, one bounded palette shared with the camp stone', () => {
  const colors = new Set(), declared = new Set(Object.values(palette.props).map(entry => entry.hex));
  for (let y = 0; y < atlas.height; y++) for (let x = 0; x < atlas.width; x++) {
    const p = atlas.pixel(x, y);
    assert.ok(p[3] === 0 || p[3] === 255, `partial alpha at ${x},${y}`);
    if (p[3]) colors.add(hex(p));
    else assert.equal(p[0] | p[1] | p[2], 0, `transparent RGB at ${x},${y}`);
  }
  assert.ok(colors.size >= 32 && colors.size <= 64, `${colors.size} prop colours`);
  for (const color of colors) assert.ok(declared.has(color), `undeclared colour ${color}`);
  // The stone, moss, foliage and bark ramps are the camp panorama's, by name and value.
  assert.ok(palette.sharedWithCampPanorama.length >= 25);
  for (const name of palette.sharedWithCampPanorama) assert.equal(palette.props[name].hex, campPalette.props[name].hex, name);
});

test('magenta ritual energy appears only in the sealed dais frame', () => {
  const magenta = new Set(['RUNE_HI', 'RUNE1', 'RUNE2', 'RUNE3'].map(name => palette.props[name].hex));
  for (const name of FRAMES) {
    const [ox, oy] = cellOrigin(name);
    const count = opaqueOf(name).filter(([x, y]) => magenta.has(hex(atlas.pixel(ox + x, oy + y)))).length;
    if (name === 'ritual-plinth-runes') assert.ok(count > 120, `${count} rune pixels`);
    else assert.equal(count, 0, `${name} must not carry magenta`);
  }
  // The two dais states swap in place: identical alpha, and only rune pixels differ.
  const [px, py] = cellOrigin('ritual-plinth'), [rx, ry] = cellOrigin('ritual-plinth-runes');
  let changed = 0;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const plain = atlas.pixel(px + x, py + y), lit = atlas.pixel(rx + x, ry + y);
    assert.equal(plain[3], lit[3], `alpha differs at ${x},${y}`);
    if (hex(plain) !== hex(lit)) {
      changed++;
      assert.ok(magenta.has(hex(lit)), `non-rune change at ${x},${y}`);
    }
  }
  assert.ok(changed > 120, `${changed} rune pixels`);
});

test('every frame stands above its registration row and on its footprint', () => {
  for (const name of FRAMES) {
    const record = contract.frames[name], pixels = opaqueOf(name), [cx, cy] = record.contactCenter;
    assert.ok(pixels.length > 60, `${name} is empty`);
    assert.ok(pixels.every(([, y]) => y < 232), `${name} draws below the anchor row`);
    let onFootprint = 0, outside = 0;
    for (const [x, y] of pixels) {
      const du = x + .5 - cx, dv = y + .5 - cy;
      const wx = (2 * dv - du) / (32 * Math.SQRT2), wy = (2 * dv + du) / (32 * Math.SQRT2);
      const inside = record.shape === 'circle' ? Math.hypot(wx, wy) <= record.radius
        : Math.abs(wx) <= record.halfWidth && Math.abs(wy) <= record.halfDepth;
      if (inside) onFootprint++;
      // A raised rim reads further back when it is projected onto the ground.
      const margin = .1 + record.height * 32 * Math.sin(Math.PI / 3) / (16 * Math.SQRT2);
      if (!inside && record.role === 'flat' && (Math.abs(wx) > record.halfWidth + margin || Math.abs(wy) > record.halfDepth + margin)) outside++;
    }
    assert.ok(onFootprint > 0, `${name} does not stand on its footprint`);
    // Ground decals lie inside their rectangle: they are the walkable area.
    if (record.role === 'flat') assert.ok(outside <= 4, `${name}: ${outside} decal pixels outside its area`);
  }
});

test('cut-stone drawings reach every collider ground corner within 1.6 native px', () => {
  for (const name of FRAMES) {
    const record = contract.frames[name];
    if (record.contact !== 'corners') continue;
    const pixels = opaqueOf(name).map(([x, y]) => [x + .5, y + .5]), boxes = boxesOf(record);
    boxes.forEach((box, n) => {
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1]]) {
        const wx = box.x + sx * box.halfWidth, wy = box.y + sy * box.halfDepth;
        // A corner buried inside another collider has no visible ground contact.
        if (boxes.some((o, m) => m !== n && Math.abs(wx - o.x) < o.halfWidth - .01 && Math.abs(wy - o.y) < o.halfDepth - .01)) continue;
        const [px, py] = toScreen(record, wx, wy);
        const gap = Math.min(...pixels.map(([x, y]) => Math.hypot(x - px, y - py)));
        assert.ok(gap <= 1.6, `${name}: corner ${wx},${wy} is ${gap.toFixed(2)} px from the drawing`);
      }
    });
  }
});

test('the gate passage stays see-through down to the ground', () => {
  const record = contract.frames['arch-gate'], [ox, oy] = cellOrigin('arch-gate'), { passage } = record;
  let checked = 0;
  for (let wx = -1.1; wx <= 1.1; wx += .05) for (let wy = -passage.halfDepth + .05; wy <= passage.halfDepth; wy += .05) {
    // Ground the near pier cannot hide: the view ray leaves the front before reaching it.
    if (wx - wy > .6) continue;
    const [px, py] = toScreen(record, wx, wy);
    assert.equal(atlas.pixel(ox + Math.floor(px), oy + Math.floor(py))[3], 0, `passage ground ${wx.toFixed(2)},${wy.toFixed(2)} is covered`);
    checked++;
  }
  assert.ok(checked > 300);
});

test('flat decals carry no silhouette outline', () => {
  for (const name of FRAMES.filter(n => contract.frames[n].role === 'flat' && n !== 'rubble-scatter')) {
    const [ox, oy] = cellOrigin(name);
    assert.ok(opaqueOf(name).every(([x, y]) => hex(atlas.pixel(ox + x, oy + y)) !== palette.props.OUT.hex), name);
  }
});

test('hit mask bits equal the actual atlas alpha for every pixel', () => {
  const masks = JSON.parse(readFileSync(new URL('hit-masks.json', pkg)));
  assert.deepEqual(Object.keys(masks), ['monastery-ruins.png', 'monastery-world.png']);
  for (const [file, w, h] of [['monastery-ruins.png', 1024, 2048], ['monastery-world.png', 960, 640]]) {
    const { width, height, bits } = masks[file];
    assert.equal(width, w); assert.equal(height, h);
    const bytes = Buffer.from(bits, 'base64'), png = readPng(new URL(file, pkg));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      assert.equal((bytes[i >> 3] >> (i & 7)) & 1, png.alpha(x, y) ? 1 : 0, `${file} mask ${x},${y}`);
    }
  }
});

test('courtyard flagstone is an opaque bounded surface that repeats seamlessly on both axes', () => {
  const image = decode(new URL('courtyard-flagstone.png', pkg));
  assert.equal(image.width, 128); assert.equal(image.height, 128);
  const colors = new Set(), sum = [0, 0, 0];
  const step = (a, b) => a.slice(0, 3).reduce((total, value, c) => total + Math.abs(value - b[c]), 0);
  let interiorX = 0, interiorY = 0, seamX = 0, seamY = 0;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const p = image.pixel(x, y);
    assert.equal(p[3], 255);
    colors.add(hex(p));
    for (let c = 0; c < 3; c++) sum[c] += p[c];
    if (x < 127) interiorX += step(p, image.pixel(x + 1, y));
    if (y < 127) interiorY += step(p, image.pixel(x, y + 1));
  }
  for (let i = 0; i < 128; i++) {
    seamX += step(image.pixel(127, i), image.pixel(0, i));
    seamY += step(image.pixel(i, 127), image.pixel(i, 0));
  }
  assert.ok(colors.size >= 6 && colors.size <= 24, `${colors.size} colours`);
  // Warm grey slabs with a few violet ones, a little darker than the camp's lit rock tops.
  const target = [147, 137, 125];
  sum.forEach((total, c) => assert.ok(Math.abs(total / 16384 - target[c]) <= 10, `mean channel ${c}`));
  assert.ok(seamX / 128 <= interiorX / (127 * 128) * 1.5, 'visible vertical tile seam');
  assert.ok(seamY / 128 <= interiorY / (127 * 128) * 1.5, 'visible horizontal tile seam');
  // The decal slab tones are the surface's own, so decals sit on it.
  const surface = palette.surfaces.courtyardFlagstone;
  for (const name of ['S_HI', 'S1', 'S2', 'S3', 'S4', 'S_SH']) assert.equal(surface[name].hex, palette.props[name].hex, name);
});

const worldCell = name => {
  const i = WORLD_FRAMES.indexOf(name), ox = (i % 6) * 160, oy = Math.floor(i / 6) * 160;
  return { pixel: (x, y) => world.pixel(ox + x, oy + y), opaque: () => {
    const result = [];
    for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) if (world.pixel(ox + x, oy + y)[3]) result.push([x, y]);
    return result;
  } };
};
const glow = names => new Set(names.map(name => palette.props[name].hex));
const MAGENTA = glow(['RUNE_HI', 'RUNE1', 'RUNE2', 'RUNE3']), CYAN = glow(['C0', 'C1', 'C2', 'C3', 'C4']);
const AMBER = glow(['A0', 'A1', 'A2', 'A3']);
const count = (name, set) => worldCell(name).opaque().filter(([x, y]) => set.has(hex(worldCell(name).pixel(x, y)))).length;

test('the world atlas reproduces the pixel-v2 world layout, so the runtime swaps atlas and clip names only', () => {
  const v2 = JSON.parse(readFileSync(new URL('assets/game/pixel-v2/hound-world/manifest.json', root))).world;
  const record = manifest.monasteryWorld;
  assert.equal(record.path, 'monastery-world.png');
  for (const key of ['cell', 'columns', 'rows', 'anchor', 'filter', 'mipmaps']) assert.deepEqual(record[key], v2[key], key);
  assert.deepEqual(record.frames, WORLD_FRAMES);
  WORLD_CLIPS.forEach((clip, n) => assert.deepEqual(record.clips[clip].front, [0, 1, 2, 3, 4, 5].map(k => n * 6 + k), clip));
  // worldPose('shrine') and the brazier loops find the same six-key clips.
  assert.deepEqual(record.clips.shrine, record.clips['healing-shrine']);
  for (const clip of ['brazier-cyan', 'brazier-magenta', 'shrine']) assert.equal(record.clips[clip].front.length, v2.clips[clip].front.length);
  assert.equal(world.width, 960); assert.equal(world.height, 640);
  // render.js registers the shrine pedestal contact at pixel 124 of the shared 144 anchor.
  for (const clip of ['ritual-source', 'healing-shrine']) assert.deepEqual(record.footprints[clip].contactCenter, [80, 124]);
  for (const clip of ['brazier-cyan', 'brazier-magenta']) assert.deepEqual(record.footprints[clip].contactCenter, [80, 144]);
  assert.deepEqual(record.footprints['ritual-source'].keys, { sealed: [0, 1], open: [2, 3, 4], destroyed: [5] });
  assert.deepEqual(record.footprints['healing-shrine'].keyTimes, [0, .1, .24, .4, .62, .9]);
  // The pedestal fits the courtyard dais socket.
  assert.ok(record.footprints['ritual-source'].halfWidth <= contract.frames['ritual-plinth'].socket.halfWidth - .1);
});

test('world frames are binary-alpha, palette-bound and keep their glow colours in their own states', () => {
  const colors = new Set(), declared = new Set(Object.values(palette.props).map(entry => entry.hex));
  for (let y = 0; y < 640; y++) for (let x = 0; x < 960; x++) {
    const p = world.pixel(x, y);
    assert.ok(p[3] === 0 || p[3] === 255, `partial alpha at ${x},${y}`);
    if (p[3]) colors.add(hex(p)); else assert.equal(p[0] | p[1] | p[2], 0);
  }
  assert.ok(colors.size >= 24 && colors.size <= 64, `${colors.size} world colours`);
  for (const color of colors) assert.ok(declared.has(color), `undeclared colour ${color}`);
  for (const name of WORLD_FRAMES) {
    const [clip, key] = [name.slice(0, -3), Number(name.slice(-2)) - 1];
    const m = count(name, MAGENTA), c = count(name, CYAN), a = count(name, AMBER);
    if (clip === 'brazier-cyan') assert.ok(c > 150 && !m && !a, `${name}: cyan ${c}, magenta ${m}, amber ${a}`);
    if (clip === 'brazier-magenta') assert.ok(m > 150 && !c && !a, `${name}: magenta ${m}, cyan ${c}, amber ${a}`);
    if (clip === 'ritual-source' && key < 2) assert.ok(m > 40 && !c && !a, `${name} is sealed: magenta`);
    if (clip === 'ritual-source' && key >= 2 && key <= 4) assert.ok(c > 40 && !m && !a, `${name} is open: turquoise`);
    if (clip === 'ritual-source' && key === 5) assert.ok(!m && !c && !a, `${name} is destroyed: no light`);
    if (clip === 'healing-shrine') assert.ok(a > 0 && !m && !c, `${name} heals: amber only`);
  }
});

test('stone parts never move between keys; only flames, crystals, glyphs and motes animate', () => {
  for (const clip of WORLD_CLIPS) {
    const keys = [1, 2, 3, 4, 5, 6].map(k => worldCell(`${clip}-0${k}`));
    // Below the bowl or the crystal, every key draws the same stone pixel for pixel.
    const from = clip.startsWith('brazier') ? 124 : 128;
    for (let y = from; y < 160; y++) for (let x = 0; x < 160; x++) {
      const first = hex(keys[0].pixel(x, y)) + keys[0].pixel(x, y)[3];
      for (const key of keys.slice(1)) assert.equal(hex(key.pixel(x, y)) + key.pixel(x, y)[3], first, `${clip} moves at ${x},${y}`);
    }
  }
  for (const clip of ['brazier-cyan', 'brazier-magenta']) {
    const set = clip === 'brazier-cyan' ? CYAN : MAGENTA, flame = [1, 2, 3, 4, 5, 6].map(k => count(`${clip}-0${k}`, set));
    const mean = flame.reduce((a, b) => a + b) / 6;
    // A readable silhouette in every key, and a loop that really moves, including key 6 into key 1.
    flame.forEach((n, k) => assert.ok(Math.abs(n - mean) / mean < .3, `${clip} key ${k + 1}: ${n} flame pixels`));
    for (let k = 0; k < 6; k++) {
      const a = worldCell(`${clip}-0${k + 1}`), b = worldCell(`${clip}-0${(k + 1) % 6 + 1}`);
      let changed = 0;
      for (let y = 0; y < 124; y++) for (let x = 0; x < 160; x++) if (hex(a.pixel(x, y)) !== hex(b.pixel(x, y))) changed++;
      assert.ok(changed > 30, `${clip}: keys ${k + 1} and ${(k + 1) % 6 + 1} are the same`);
    }
  }
});

test('brazier fire flickers: tongue height and lean change per key, sparks move, the core is small', () => {
  for (const clip of ['brazier-cyan', 'brazier-magenta']) {
    const set = clip === 'brazier-cyan' ? CYAN : MAGENTA, core = clip === 'brazier-cyan' ? palette.props.C0.hex : palette.props.RUNE_HI.hex;
    const heights = [], centres = [], sparks = [];
    for (let k = 1; k <= 6; k++) {
      const cell = worldCell(`${clip}-0${k}`), fire = new Set();
      for (const [x, y] of cell.opaque()) if (y < 112 && set.has(hex(cell.pixel(x, y)))) fire.add(`${x},${y}`);
      const points = [...fire].map(p => p.split(',').map(Number));
      // Body pixels touch another flame pixel; lone pixels are sparks.
      const body = points.filter(([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => fire.has(`${x + dx},${y + dy}`)));
      heights.push(112 - Math.min(...body.map(p => p[1])));
      centres.push(body.reduce((sum, p) => sum + p[0], 0) / body.length);
      const lone = points.filter(p => !body.includes(p)).map(p => p.join(','));
      assert.ok(lone.length >= 2, `${clip}-0${k}: ${lone.length} sparks`);
      sparks.push(new Set(lone));
      const bright = points.filter(([x, y]) => hex(cell.pixel(x, y)) === core).length;
      assert.ok(bright > 10 && bright < body.length * .3, `${clip}-0${k}: core ${bright} of ${body.length} pixels`);
    }
    assert.ok(Math.max(...heights) / Math.min(...heights) >= 1.15, `${clip}: tongue heights ${heights}`);
    assert.ok(Math.max(...centres) - Math.min(...centres) >= 3, `${clip}: the fire does not lean (${centres.map(c => c.toFixed(1))})`);
    sparks.forEach((set, k) => {
      const next = sparks[(k + 1) % 6];
      assert.ok([...set].some(p => !next.has(p)), `${clip}: sparks stand still between keys ${k + 1} and ${(k + 1) % 6 + 1}`);
    });
  }
});

test('world bases sit on the runtime contacts: shrine pedestal corners and brazier foot', () => {
  const near = (cell, px, py) => Math.min(...cell.opaque().map(([x, y]) => Math.hypot(x + .5 - px, y + .5 - py)));
  for (const clip of ['ritual-source', 'healing-shrine']) {
    const h = manifest.monasteryWorld.footprints[clip].halfWidth;
    for (const key of [1, 6]) {
      const cell = worldCell(`${clip}-0${key}`);
      for (const [wx, wy] of [[h, h], [h, -h], [-h, h]]) {
        const gap = near(cell, 80 + KX * (wy - wx), 124 + KY * (wx + wy));
        assert.ok(gap <= 1.6, `${clip}-0${key}: pedestal corner ${wx},${wy} is ${gap.toFixed(2)} px away`);
      }
    }
  }
  for (const clip of ['brazier-cyan', 'brazier-magenta']) {
    const r = manifest.monasteryWorld.footprints[clip].radius, cell = worldCell(`${clip}-01`);
    for (const [px, py] of [[80, 144 + 16 * r], [80 - 32 * r, 144], [80 + 32 * r, 144]]) {
      const gap = near(cell, px, py);
      assert.ok(gap <= 1.6, `${clip}: foot point ${px.toFixed(1)},${py.toFixed(1)} is ${gap.toFixed(2)} px away`);
    }
    assert.ok(cell.pixel(80, 143)[3], `${clip}: the anchor stands on the stone foot`);
  }
});

test('verify-only redraws the package in memory and writes nothing', () => {
  const files = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) walk(url); else files.push(url);
    }
  };
  walk(pkg);
  const snapshot = () => files.map(url => [url.href, statSync(url).mtimeMs, readFileSync(url).toString('base64')]);
  const before = snapshot();
  const script = fileURLToPath(new URL('scripts/build-monastery-ruins-assets.py', root));
  const result = spawnSync('python3', ['-B', script, '--verify-only'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).mismatched, []);
  assert.deepEqual(snapshot(), before);
});
