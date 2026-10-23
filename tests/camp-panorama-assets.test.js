import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readPng } from './helpers/png.js';

const root = new URL('../', import.meta.url);
const pkg = new URL('assets/game/pixel-v9/camp-panorama/', root);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', pkg)));
const contract = JSON.parse(readFileSync(new URL('source/footprints.json', pkg)));
const FRAMES = ['tripod-kettle', 'woven-carpet', 'outcrop-block', 'outcrop-pair', 'outcrop-cluster', 'outcrop-cliff',
  'outcrop-wall-x', 'outcrop-wall-y', 'outcrop-slab', 'ruin-pillar', 'cypress-tall', 'cypress-medium', 'cypress-pair',
  'bush-round', 'bush-large', 'crate', 'sack-pair', 'grass-tuft', 'fern-tuft', 'boulder-round', 'outcrop-crag', 'outcrop-ledge-x'];

// Independent RGB(A) decoder for the two delivered 8-bit truecolour PNGs.
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
const atlas = decode(new URL('camp-panorama.png', pkg));
const mountains = decode(new URL('mountains.png', pkg));

test('camp panorama manifest publishes the atlas, backdrop and the layout-owned footprint contract', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.nativePixelsPerUnit, 32);
  assert.deepEqual(manifest.campPanorama, { path: 'camp-panorama.png', cell: 256, columns: 4, rows: 6,
    anchor: [128, 232], frames: FRAMES, filter: 'nearest', mipmaps: false });
  assert.deepEqual(manifest.campBackdrop, { path: 'mountains.png', size: [2048, 1280],
    screenFrame: { u0: -20, v0: -40, width: 64, height: 40 }, wrapU: true, filter: 'nearest', mipmaps: false });
  assert.deepEqual(manifest.footprints, contract.frames, 'manifest must carry the unchanged geometry contract');
  assert.deepEqual(Object.keys(contract.frames), FRAMES);
  assert.deepEqual(contract.anchor, manifest.campPanorama.anchor);
  assert.equal(atlas.width, 1024); assert.equal(atlas.height, 1536);
  for (const name of FRAMES) {
    const record = contract.frames[name];
    assert.ok(['solid', 'flat'].includes(record.role), name);
    assert.ok(record.shape === 'circle' ? record.radius > 0 : record.halfWidth > 0 && record.halfDepth > 0, name);
  }
});

test('atlas alpha is binary with zero transparent RGB and one bounded shared palette', () => {
  const colors = new Set();
  for (let y = 0; y < atlas.height; y++) for (let x = 0; x < atlas.width; x++) {
    const [r, g, b, a] = atlas.pixel(x, y);
    assert.ok(a === 0 || a === 255, `partial alpha at ${x},${y}`);
    if (a) colors.add((r << 16) | (g << 8) | b);
    else assert.equal(r | g | b, 0, `transparent RGB at ${x},${y}`);
  }
  assert.ok(colors.size >= 32 && colors.size <= 64, `${colors.size} prop colours`);
});

test('every frame is drawn above its registration row and on its own footprint', () => {
  const half = 8 * Math.SQRT2 * 2;
  for (const [index, name] of FRAMES.entries()) {
    const record = contract.frames[name], ox = (index % 4) * 256, oy = Math.floor(index / 4) * 256;
    const [cx, cy] = record.contactCenter;
    let opaque = 0, below = 0, onFootprint = 0, frontTouch = Infinity;
    const front = record.shape === 'circle' ? [cx, cy + 16 * record.radius]
      : [cx + half * (record.halfDepth - record.halfWidth), cy + 8 * Math.SQRT2 * (record.halfWidth + record.halfDepth)];
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      if (!atlas.pixel(ox + x, oy + y)[3]) continue;
      opaque++;
      if (y >= 232) below++;
      const du = x + .5 - cx, dv = y + .5 - cy;
      // Inverse 2:1 projection of the pixel centre onto the ground plane.
      const wx = (2 * dv - du) / (32 * Math.SQRT2), wy = (2 * dv + du) / (32 * Math.SQRT2);
      const inside = record.shape === 'circle' ? Math.hypot(wx, wy) <= record.radius
        : Math.abs(wx) <= record.halfWidth && Math.abs(wy) <= record.halfDepth;
      if (inside) onFootprint++;
      frontTouch = Math.min(frontTouch, Math.hypot(x + .5 - front[0], y + .5 - front[1]));
    }
    assert.ok(opaque > 60, `${name} is empty`);
    assert.equal(below, 0, `${name} draws below the anchor row`);
    assert.ok(onFootprint > 0, `${name} does not stand on its footprint`);
    if (record.role === 'solid' && record.shape === 'box') assert.ok(frontTouch <= 3, `${name}: front corner ${frontTouch.toFixed(1)} px away`);
  }
  for (const ox of [512, 768]) {
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) assert.equal(atlas.pixel(ox + x, 1280 + y)[3], 0, 'unused cells must stay empty');
  }
});

test('rock drawings reach their footprint ground corners within 1.6 native px', () => {
  for (const [index, name] of FRAMES.entries()) {
    if (!/^(outcrop-|boulder-)/.test(name)) continue;
    const record = contract.frames[name], ox = (index % 4) * 256, oy = Math.floor(index / 4) * 256, [cx, cy] = record.contactCenter;
    const opaque = [];
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (atlas.pixel(ox + x, oy + y)[3]) opaque.push([x + .5, y + .5]);
    const r = record.radius, corners = record.shape === 'circle' ? [[r * Math.SQRT1_2, r * Math.SQRT1_2], [r, 0], [0, r]]
      : [[record.halfWidth, record.halfDepth], [record.halfWidth, -record.halfDepth], [-record.halfWidth, record.halfDepth]];
    for (const [wx, wy] of corners) {
      // Front, screen-left and screen-right ground corners carry the contact.
      const sx = cx + 16 * Math.SQRT2 * (wy - wx), sy = cy + 8 * Math.SQRT2 * (wx + wy);
      const gap = Math.min(...opaque.map(([x, y]) => Math.hypot(x - sx, y - sy)));
      assert.ok(gap <= 1.6, `${name}: ground corner ${wx},${wy} is ${gap.toFixed(2)} px from the drawing`);
    }
  }
});

test('hit mask bits equal the actual atlas alpha for every pixel', () => {
  const masks = JSON.parse(readFileSync(new URL('hit-masks.json', pkg)));
  assert.deepEqual(Object.keys(masks), ['camp-panorama.png']);
  const { width, height, bits } = masks['camp-panorama.png'];
  assert.equal(width, 1024); assert.equal(height, 1536);
  const bytes = Buffer.from(bits, 'base64'), png = readPng(new URL('camp-panorama.png', pkg));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    assert.equal((bytes[i >> 3] >> (i & 7)) & 1, png.alpha(x, y) ? 1 : 0, `mask ${x},${y}`);
  }
});

test('mountain backdrop is opaque, bounded, clamp-safe and wraps horizontally', () => {
  assert.equal(mountains.width, 2048); assert.equal(mountains.height, 1280);
  const colors = new Set(), key = p => (p[0] << 16) | (p[1] << 8) | p[2];
  for (let y = 0; y < 1280; y++) for (let x = 0; x < 2048; x++) {
    const p = mountains.pixel(x, y);
    assert.equal(p[3], 255);
    colors.add(key(p));
  }
  assert.ok(colors.size >= 16 && colors.size <= 40, `${colors.size} backdrop colours`);
  let same = 0;
  for (let y = 0; y < 1280; y++) if (key(mountains.pixel(0, y)) === key(mountains.pixel(2047, y))) same++;
  assert.ok(same / 1280 > .9, 'the left edge must continue the right edge');
  for (const rows of [[0, 40], [1256, 1280]]) {
    const first = key(mountains.pixel(0, rows[0]));
    for (let y = rows[0]; y < rows[1]; y++) for (let x = 0; x < 2048; x += 7) assert.equal(key(mountains.pixel(x, y)), first, `clamp band row ${y}`);
  }
  const sky = key(mountains.pixel(0, 0)), haze = key(mountains.pixel(0, 1279));
  // The artboard window (u -7..18, v -13.1..-6) holds terrain, not sky or haze.
  let terrain = 0, total = 0;
  for (let y = Math.round((-13.1 + 40) * 32); y < (-6 + 40) * 32; y += 4) for (let x = 13 * 32; x < 38 * 32; x += 4) {
    total++;
    const k = key(mountains.pixel(x, y));
    if (k !== sky && k !== haze) terrain++;
  }
  assert.ok(terrain / total > .85);
  // Layered ridges and horizontal haze, not a curtain of vertical streaks:
  // colour changes along a row are no more frequent than along a column.
  let across = 0, down = 0;
  for (let y = (-16 + 40) * 32; y < (-6 + 40) * 32; y++) for (let x = 23 * 32; x < 50 * 32; x++) {
    const p = key(mountains.pixel(x, y));
    if (p !== key(mountains.pixel(x + 1, y))) across++;
    if (p !== key(mountains.pixel(x, y + 1))) down++;
  }
  assert.ok(across < down * 1.4, `vertical streaks: ${across} changes across rows, ${down} down columns`);
});

test('camp earth and grass are opaque bounded surfaces that repeat seamlessly on both axes', () => {
  const targets = { campEarth: [190, 155, 115], campGrass: [115, 111, 75] };
  for (const [key, file] of [['campEarth', 'camp-earth.png'], ['campGrass', 'camp-grass.png']]) {
    assert.deepEqual(manifest.surfaces[key], { path: file, size: [128, 128], filter: 'nearest', mipmaps: false });
    const image = decode(new URL(file, pkg));
    assert.equal(image.width, 128); assert.equal(image.height, 128);
    const colors = new Set(), sum = [0, 0, 0];
    const step = (a, b) => a.slice(0, 3).reduce((total, value, c) => total + Math.abs(value - b[c]), 0);
    let interior = 0, seamX = 0, seamY = 0;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const p = image.pixel(x, y);
      assert.equal(p[3], 255);
      colors.add((p[0] << 16) | (p[1] << 8) | p[2]);
      for (let c = 0; c < 3; c++) sum[c] += p[c];
      if (x < 127) interior += step(p, image.pixel(x + 1, y));
    }
    for (let i = 0; i < 128; i++) {
      seamX += step(image.pixel(127, i), image.pixel(0, i));
      seamY += step(image.pixel(i, 127), image.pixel(i, 0));
    }
    assert.ok(colors.size >= 6 && colors.size <= 24, `${key}: ${colors.size} colours`);
    sum.forEach((total, c) => assert.ok(Math.abs(total / 16384 - targets[key][c]) <= 10, `${key}: mean channel ${c}`));
    // A wrapped edge must look like any interior neighbour pair, not a seam.
    const average = interior / (127 * 128);
    assert.ok(seamX / 128 <= average * 1.5 && seamY / 128 <= average * 1.5, `${key}: visible tile seam`);
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
  const script = fileURLToPath(new URL('scripts/build-camp-panorama-assets.py', root));
  const result = spawnSync('python3', ['-B', script, '--verify-only'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).mismatched, []);
  assert.deepEqual(snapshot(), before);
});
