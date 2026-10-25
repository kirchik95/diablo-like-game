import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readPng } from './helpers/png.js';

const root = new URL('../', import.meta.url);
const pkg = new URL('assets/game/pixel-v13/orchard/', root);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', pkg)));
const contract = JSON.parse(readFileSync(new URL('source/footprints.json', pkg)));
const palette = JSON.parse(readFileSync(new URL('source/palette.json', pkg)));
const campPalette = JSON.parse(readFileSync(new URL('assets/game/pixel-v9/camp-panorama/source/palette.json', root)));
const ruinsPalette = JSON.parse(readFileSync(new URL('assets/game/pixel-v11/monastery-ruins/source/palette.json', root)));
const FRAMES = ['olive-tree-a', 'olive-tree-b', 'olive-tree-c', 'olive-tree-old', 'olive-dead', 'fig-young', 'well',
  'olive-press', 'pergola-x', 'pergola-y', 'pergola-broken-x', 'pergola-broken-y', 'trellis-x', 'trellis-y',
  'beehive-pair', 'beehive-fallen', 'stone-basin', 'garden-bench-x', 'garden-bench-y', 'cart-broken-x', 'cart-broken-y',
  'olive-baskets', 'terracotta-jars', 'monk-statue', 'herb-bed-x', 'herb-bed-y', 'herb-bed-overgrown', 'vine-clump',
  'fallen-olives', 'leaf-litter', 'gravel-path', 'pruned-branches'];
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
const atlas = decode(new URL('orchard.png', pkg));
const hex = p => '#' + p.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
const cellOrigin = name => { const i = FRAMES.indexOf(name); return [(i % 4) * 256, Math.floor(i / 4) * 256]; };
const opaqueOf = name => {
  const [ox, oy] = cellOrigin(name), result = [];
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (atlas.pixel(ox + x, oy + y)[3]) result.push([x, y]);
  return result;
};
const boxesOf = record => record.colliders ?? [{ x: 0, y: 0, halfWidth: record.halfWidth, halfDepth: record.halfDepth }];
const toScreen = (record, wx, wy) => [record.contactCenter[0] + KX * (wy - wx), record.contactCenter[1] + KY * (wx + wy)];

test('orchard manifest publishes the atlas, the clover surface and the footprint contract', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.nativePixelsPerUnit, 32);
  assert.deepEqual(manifest.orchard, { path: 'orchard.png', cell: 256, columns: 4, rows: 8,
    anchor: [128, 232], frames: FRAMES, filter: 'nearest', mipmaps: false });
  assert.deepEqual(manifest.surfaces, { orchardGrass: { path: 'orchard-grass.png', size: [128, 128],
    filter: 'nearest', mipmaps: false } });
  assert.deepEqual(manifest.footprints, contract.frames, 'manifest must carry the drawing contract unchanged');
  assert.deepEqual(Object.keys(contract.frames), FRAMES);
  assert.deepEqual(contract.anchor, manifest.orchard.anchor);
  assert.equal(atlas.width, 1024); assert.equal(atlas.height, 2048);
  // Screen-space reservations use the exact opaque box of every cell (exclusive end, as in pixel-v9).
  assert.deepEqual(Object.keys(manifest.opaqueBounds), FRAMES);
  for (const name of FRAMES) {
    const pixels = opaqueOf(name), xs = pixels.map(p => p[0]), ys = pixels.map(p => p[1]);
    assert.deepEqual(manifest.opaqueBounds[name], [Math.min(...xs), Math.min(...ys), Math.max(...xs) + 1, Math.max(...ys) + 1], name);
  }
});

test('every footprint follows the pixel-v9 contact rule, the ruins roles and stays inside its box', () => {
  for (const name of FRAMES) {
    const record = contract.frames[name];
    assert.ok(['solid', 'low', 'flat'].includes(record.role), name);
    const front = record.shape === 'circle' ? 16 * record.radius : (record.halfWidth + record.halfDepth) * 8 * Math.SQRT2;
    assert.deepEqual(record.contactCenter, [128, Math.floor((231 - front) * 4) / 4], `${name} contact centre`);
    // A low prop blocks walking but never hides the hero; a flat decal has no collider at all.
    if (record.role === 'low') assert.ok(record.height <= 1.1, `${name} is too high for role low`);
    if (record.role === 'flat') {
      assert.equal(record.height, 0, name);
      assert.ok(!record.colliders, name);
      assert.equal(record.contact, 'none', name);
    }
    if (record.shape === 'circle') { assert.ok(record.radius > 0, name); continue; }
    const { halfWidth: hw, halfDepth: hd } = record;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => toScreen(record, x, y));
    record.polygon.forEach((p, i) => p.forEach((v, c) => assert.ok(Math.abs(v - corners[i][c]) < .006, `${name} polygon`)));
    for (const part of record.colliders ?? []) {
      assert.ok(Math.abs(part.x) + part.halfWidth <= hw + 1e-9 && Math.abs(part.y) + part.halfDepth <= hd + 1e-9, `${name} part`);
    }
  }
});

test('tall frames collide only at a small trunk or at their posts', () => {
  const tall = FRAMES.filter(name => contract.frames[name].tall);
  assert.deepEqual(tall, ['olive-tree-a', 'olive-tree-b', 'olive-tree-c', 'olive-tree-old', 'olive-dead', 'fig-young',
    'pergola-x', 'pergola-y', 'pergola-broken-x', 'pergola-broken-y']);
  for (const name of tall) {
    const record = contract.frames[name];
    if (record.shape === 'circle') {
      // The trunk collider is far smaller than the crown the hero walks under.
      assert.ok(record.radius <= .65, `${name} trunk radius ${record.radius}`);
      if (record.canopy) assert.ok(record.canopy >= record.radius * 2.5, `${name} canopy`);
      continue;
    }
    assert.equal(record.colliders.length, 4, name);
    for (const post of record.colliders) assert.ok(post.halfWidth <= .25 && post.halfDepth <= .25, `${name} post size`);
    // The walkable middle stays open between the posts.
    const xs = record.colliders.map(p => p.x), ys = record.colliders.map(p => p.y);
    assert.ok(Math.max(...xs) - Math.min(...xs) >= 1 && Math.max(...ys) - Math.min(...ys) >= 1, name);
  }
  for (const name of ['pergola-broken-x', 'pergola-broken-y']) assert.equal(contract.frames[name].colliders[0].note, 'stump');
  // Landmarks for the zone design.
  for (const name of ['olive-tree-old', 'well', 'olive-press', 'monk-statue']) assert.equal(contract.frames[name].landmark, true, name);
});

test('atlas alpha is binary with zero transparent RGB, one bounded palette shared with the camp and the ruins', () => {
  const colors = new Set(), declared = new Set(Object.values(palette.props).map(entry => entry.hex));
  for (let y = 0; y < atlas.height; y++) for (let x = 0; x < atlas.width; x++) {
    const p = atlas.pixel(x, y);
    assert.ok(p[3] === 0 || p[3] === 255, `partial alpha at ${x},${y}`);
    if (p[3]) colors.add(hex(p));
    else assert.equal(p[0] | p[1] | p[2], 0, `transparent RGB at ${x},${y}`);
  }
  assert.ok(colors.size >= 24 && colors.size <= 48, `${colors.size} prop colours`);
  for (const color of colors) assert.ok(declared.has(color), `undeclared colour ${color}`);
  assert.equal(declared.size, Object.keys(palette.props).length, 'palette hex values are unique');
  // Stone, moss, foliage, bark, wood, straw and soil are the camp and ruins ramps, by name and value.
  for (const name of palette.sharedWithCampPanorama) assert.equal(palette.props[name].hex, campPalette.props[name].hex, name);
  for (const name of palette.sharedWithMonasteryRuins) assert.equal(palette.props[name].hex, ruinsPalette.props[name].hex, name);
  const shared = new Set([...palette.sharedWithCampPanorama, ...palette.sharedWithMonasteryRuins]);
  assert.ok(shared.size >= 24, `${shared.size} shared colours`);
  const used = [...shared].filter(name => colors.has(palette.props[name].hex));
  assert.ok(used.length >= 24, `${used.length} shared colours drawn`);
});

test('the orchard carries no ritual magenta and no spirit turquoise', () => {
  const ritual = new Set(Object.entries(ruinsPalette.props).filter(([name]) => /^(RUNE|C\d|A\d)/.test(name)).map(([, e]) => e.hex));
  for (let y = 0; y < atlas.height; y++) for (let x = 0; x < atlas.width; x++) {
    const p = atlas.pixel(x, y);
    if (!p[3]) continue;
    const [r, g, b] = p;
    assert.ok(!(r - g > 50 && b - g > 50), `magenta at ${x},${y}`);
    assert.ok(!(g - r > 50 && b - r > 50), `turquoise at ${x},${y}`);
    assert.ok(!ritual.has(hex(p)), `ruins glow colour at ${x},${y}`);
  }
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
      const margin = .1 + record.height * 32 * Math.sin(Math.PI / 3) / (16 * Math.SQRT2);
      if (!inside && record.role === 'flat' && (Math.abs(wx) > record.halfWidth + margin || Math.abs(wy) > record.halfDepth + margin)) outside++;
    }
    assert.ok(onFootprint > 0, `${name} does not stand on its footprint`);
    // Ground decals lie inside their rectangle: they are the walkable area.
    if (record.role === 'flat') assert.ok(outside <= 4, `${name}: ${outside} decal pixels outside its area`);
  }
});

test('cut-stone and timber drawings reach every collider ground corner within 1.6 native px', () => {
  const checked = [];
  for (const name of FRAMES) {
    const record = contract.frames[name];
    if (record.contact !== 'corners') continue;
    checked.push(name);
    const pixels = opaqueOf(name).map(([x, y]) => [x + .5, y + .5]), boxes = boxesOf(record);
    boxes.forEach((box, n) => {
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1]]) {
        const wx = box.x + sx * box.halfWidth, wy = box.y + sy * box.halfDepth;
        if (boxes.some((o, m) => m !== n && Math.abs(wx - o.x) < o.halfWidth - .01 && Math.abs(wy - o.y) < o.halfDepth - .01)) continue;
        const [px, py] = toScreen(record, wx, wy);
        const gap = Math.min(...pixels.map(([x, y]) => Math.hypot(x - px, y - py)));
        assert.ok(gap <= 1.6, `${name}: corner ${wx},${wy} is ${gap.toFixed(2)} px from the drawing`);
      }
    });
  }
  assert.ok(checked.length >= 12, `${checked.length} corner-contact frames`);
});

test('lit props are drawn in both orientations, not mirrored', () => {
  for (const base of ['pergola', 'pergola-broken', 'trellis', 'garden-bench', 'cart-broken', 'herb-bed']) {
    const [ax, ay] = cellOrigin(`${base}-x`), [bx, by] = cellOrigin(`${base}-y`);
    let same = 0, total = 0;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const a = atlas.pixel(ax + x, ay + y), b = atlas.pixel(bx + 255 - x, by + y);
      if (!a[3] && !b[3]) continue;
      total++;
      if (a[3] && b[3] && hex(a) === hex(b)) same++;
    }
    // A mirror would match almost every pixel; a separate drawing lights the other face.
    assert.ok(same / total < .6, `${base}-y looks like a mirror of ${base}-x (${(same / total).toFixed(2)})`);
  }
  assert.equal(contract.frames['gravel-path'].mirror, true);
  for (const name of FRAMES.filter(n => n !== 'gravel-path')) assert.ok(!contract.frames[name].mirror, name);
});

test('props keep the monk scale: trees tower over him, low props stay below his head', () => {
  const monk = 62;
  const top = name => contract.frames[name].contactCenter[1] - manifest.opaqueBounds[name][1];
  for (const name of ['olive-tree-a', 'olive-tree-b', 'olive-tree-c']) assert.ok(top(name) > monk * 1.3 && top(name) < monk * 2.2, `${name}: ${top(name)} px`);
  assert.ok(top('olive-tree-old') > top('olive-tree-a'), 'the old olive is the largest tree');
  assert.ok(top('fig-young') < top('olive-tree-b'), 'the fig is small');
  for (const name of FRAMES.filter(n => contract.frames[n].role === 'low')) assert.ok(top(name) < monk, `${name}: ${top(name)} px`);
  const statue = top('monk-statue');
  assert.ok(statue > 45 && statue < 70, `statue ${statue} px`);
});

test('flat decals carry no silhouette outline', () => {
  for (const name of FRAMES.filter(n => contract.frames[n].role === 'flat')) {
    const [ox, oy] = cellOrigin(name);
    assert.ok(opaqueOf(name).every(([x, y]) => hex(atlas.pixel(ox + x, oy + y)) !== palette.props.OUT.hex), name);
  }
});

test('hit mask bits equal the actual atlas alpha for every pixel', () => {
  const masks = JSON.parse(readFileSync(new URL('hit-masks.json', pkg)));
  assert.deepEqual(Object.keys(masks), ['orchard.png']);
  const { width, height, bits } = masks['orchard.png'];
  assert.equal(width, 1024); assert.equal(height, 2048);
  const bytes = Buffer.from(bits, 'base64'), png = readPng(new URL('orchard.png', pkg));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    assert.equal((bytes[i >> 3] >> (i & 7)) & 1, png.alpha(x, y) ? 1 : 0, `mask ${x},${y}`);
  }
});

const surfaceStats = url => {
  const image = decode(url), colors = new Set(), sum = [0, 0, 0];
  const step = (a, b) => a.slice(0, 3).reduce((total, value, c) => total + Math.abs(value - b[c]), 0);
  let interiorX = 0, interiorY = 0, seamX = 0, seamY = 0, opaque = true;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const p = image.pixel(x, y);
    opaque &&= p[3] === 255;
    colors.add(hex(p));
    for (let c = 0; c < 3; c++) sum[c] += p[c];
    if (x < image.width - 1) interiorX += step(p, image.pixel(x + 1, y));
    if (y < image.height - 1) interiorY += step(p, image.pixel(x, y + 1));
  }
  for (let i = 0; i < 128; i++) {
    seamX += step(image.pixel(127, i), image.pixel(0, i));
    seamY += step(image.pixel(i, 127), image.pixel(i, 0));
  }
  const n = image.width * image.height;
  return { image, colors, opaque, mean: sum.map(v => v / n), interiorX: interiorX / (127 * 128), interiorY: interiorY / (127 * 128),
    seamX: seamX / 128, seamY: seamY / 128 };
};

test('orchard grass is an opaque, seamless clover meadow a little greener than the camp meadow', () => {
  const grass = surfaceStats(new URL('orchard-grass.png', pkg));
  const camp = surfaceStats(new URL('assets/game/pixel-v9/camp-panorama/camp-grass.png', root));
  assert.equal(grass.image.width, 128); assert.equal(grass.image.height, 128);
  assert.ok(grass.opaque, 'surface must be opaque');
  assert.ok(grass.colors.size >= 8 && grass.colors.size <= 12, `${grass.colors.size} colours`);
  assert.ok(grass.seamX <= grass.interiorX * 1.5, 'visible vertical tile seam');
  assert.ok(grass.seamY <= grass.interiorY * 1.5, 'visible horizontal tile seam');
  // Greener, not brighter: the green lead over red grows, the overall value stays near the camp meadow.
  const lead = s => s.mean[1] - s.mean[0];
  assert.ok(lead(grass) >= lead(camp) + 6, `green lead ${lead(grass).toFixed(1)} vs camp ${lead(camp).toFixed(1)}`);
  const value = s => s.mean.reduce((a, b) => a + b) / 3;
  assert.ok(Math.abs(value(grass) - value(camp)) <= 10, 'brightness drifts from the camp meadow');
  // The camp meadow's shade and blade tip are shared, so the two meadows meet without a change of light.
  const surface = palette.surfaces.orchardGrass;
  for (const name of ['G_SH', 'G_H2']) assert.equal(surface[name].hex, campPalette.surfaces.campGrass[name].hex, name);
  for (const color of grass.colors) assert.ok(Object.values(surface).some(entry => entry.hex === color), `undeclared ${color}`);
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
  const script = fileURLToPath(new URL('scripts/build-orchard-assets.py', root));
  const result = spawnSync('python3', ['-B', script, '--verify-only'], { encoding: 'utf8', timeout: 180000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).mismatched, []);
  assert.deepEqual(snapshot(), before);
});
