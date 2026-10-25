import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readPng } from './helpers/png.js';

const root = new URL('../', import.meta.url);
const pkg = new URL('assets/game/pixel-v13/cemetery/', root);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', pkg)));
const contract = JSON.parse(readFileSync(new URL('source/footprints.json', pkg)));
const palette = JSON.parse(readFileSync(new URL('source/palette.json', pkg)));
const campPalette = JSON.parse(readFileSync(new URL('assets/game/pixel-v9/camp-panorama/source/palette.json', root)));
const ruinsPalette = JSON.parse(readFileSync(new URL('assets/game/pixel-v11/monastery-ruins/source/palette.json', root)));
const FRAMES = ['stele-tall-x', 'stele-tall-y', 'stele-low-x', 'stele-low-y', 'stele-leaning-x', 'stele-leaning-y',
  'stele-fallen-x', 'stele-fallen-y', 'cairn-small', 'cairn-large', 'grave-mound-x', 'grave-mound-y', 'grave-plot-x',
  'grave-plot-y', 'obelisk', 'obelisk-broken', 'stone-lantern', 'stone-lantern-toppled', 'fence-x', 'fence-y',
  'fence-broken-x', 'fence-broken-y', 'cemetery-gate-x', 'cemetery-gate-y', 'urn-pair', 'urn-broken', 'offering-stone',
  'yew-round', 'yew-small', 'grave-ash', 'stepping-slabs', 'moss-graves'];
const TWINS = ['stele-tall', 'stele-low', 'stele-leaning', 'stele-fallen', 'grave-mound', 'grave-plot', 'fence', 'fence-broken',
  'cemetery-gate'];
const KX = 16 * Math.SQRT2, KY = 8 * Math.SQRT2, KZ = 32 * Math.sin(Math.PI / 3);

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
const atlas = decode(new URL('cemetery.png', pkg));
const hex = p => '#' + p.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
const cellOrigin = name => { const i = FRAMES.indexOf(name); return [(i % 4) * 256, Math.floor(i / 4) * 256]; };
const at = (name, x, y) => { const [ox, oy] = cellOrigin(name); return atlas.pixel(ox + x, oy + y); };
const opaqueOf = name => {
  const result = [];
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (at(name, x, y)[3]) result.push([x, y]);
  return result;
};
const boxesOf = record => record.colliders ?? [{ x: 0, y: 0, halfWidth: record.halfWidth, halfDepth: record.halfDepth }];
const toScreen = (record, wx, wy) => [record.contactCenter[0] + KX * (wy - wx), record.contactCenter[1] + KY * (wx + wy)];
const hexes = names => new Set(names.map(name => palette.props[name].hex));
const count = (name, set) => opaqueOf(name).filter(([x, y]) => set.has(hex(at(name, x, y)))).length;

test('cemetery manifest publishes the atlas, the earth surface and the footprint contract', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.nativePixelsPerUnit, 32);
  assert.deepEqual(manifest.cemetery, { path: 'cemetery.png', cell: 256, columns: 4, rows: 8,
    anchor: [128, 232], frames: FRAMES, filter: 'nearest', mipmaps: false });
  assert.deepEqual(manifest.surfaces, { cemeteryEarth: { path: 'cemetery-earth.png', size: [128, 128],
    filter: 'nearest', mipmaps: false } });
  assert.deepEqual(manifest.footprints, contract.frames, 'manifest must carry the drawing contract unchanged');
  assert.deepEqual(Object.keys(contract.frames), FRAMES);
  assert.deepEqual(contract.anchor, manifest.cemetery.anchor);
  assert.equal(manifest.hitMasks, 'hit-masks.json');
  assert.equal(atlas.width, 1024); assert.equal(atlas.height, 2048);
  // Screen-space reservations use the exact opaque box of every cell (exclusive end, as in pixel-v9).
  assert.deepEqual(Object.keys(manifest.opaqueBounds), FRAMES);
  for (const name of FRAMES) {
    const pixels = opaqueOf(name), xs = pixels.map(p => p[0]), ys = pixels.map(p => p[1]);
    assert.deepEqual(manifest.opaqueBounds[name], [Math.min(...xs), Math.min(...ys), Math.max(...xs) + 1, Math.max(...ys) + 1], name);
  }
});

test('every footprint follows the pixel-v9 contact rule, uses a ruins role and keeps its parts inside the box', () => {
  for (const name of FRAMES) {
    const record = contract.frames[name];
    assert.ok(['solid', 'low', 'flat'].includes(record.role), name);
    const front = record.shape === 'circle' ? 16 * record.radius : (record.halfWidth + record.halfDepth) * 8 * Math.SQRT2;
    assert.deepEqual(record.contactCenter, [128, Math.floor((231 - front) * 4) / 4], `${name} contact centre`);
    if (record.shape === 'circle') { assert.ok(record.radius > 0, name); continue; }
    const { halfWidth: hw, halfDepth: hd } = record;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => toScreen(record, x, y));
    record.polygon.forEach((p, i) => p.forEach((v, c) => assert.ok(Math.abs(v - corners[i][c]) < .006, `${name} polygon`)));
    for (const part of [...(record.colliders ?? []), ...[record.passage].filter(Boolean)]) {
      assert.ok(Math.abs(part.x) + part.halfWidth <= hw + 1e-9 && Math.abs(part.y) + part.halfDepth <= hd + 1e-9, `${name} part`);
    }
  }
  // The brief's roles: lying and low pieces are low, ground art is flat.
  const role = name => contract.frames[name].role;
  for (const name of ['stele-fallen-x', 'stele-fallen-y', 'grave-mound-x', 'grave-mound-y', 'fence-x', 'fence-y',
    'fence-broken-x', 'fence-broken-y']) assert.equal(role(name), 'low', name);
  for (const name of ['grave-plot-x', 'grave-plot-y', 'grave-ash', 'stepping-slabs', 'moss-graves']) assert.equal(role(name), 'flat', name);
  for (const name of ['grave-mound-x', 'grave-mound-y']) assert.ok(contract.frames[name].height <= .35, name);
  // -x / -y twins are the same footprint turned by a quarter.
  for (const base of TWINS) {
    const a = contract.frames[`${base}-x`], b = contract.frames[`${base}-y`];
    assert.equal(a.axis, 'x'); assert.equal(b.axis, 'y');
    assert.deepEqual([b.halfWidth, b.halfDepth], [a.halfDepth, a.halfWidth], base);
  }
});

test('tall props keep small colliders: trunks, the obelisk plinth and the gate posts only', () => {
  for (const name of ['yew-round', 'yew-small']) {
    const record = contract.frames[name];
    assert.equal(record.shape, 'circle');
    assert.ok(record.radius <= .3 && record.canopy > 2 * record.radius, name);
  }
  assert.ok(contract.frames['yew-round'].height >= 2.7 && contract.frames['yew-round'].height <= 3.3);
  const obelisk = contract.frames.obelisk;
  assert.ok(obelisk.landmark && obelisk.height >= 2.4 && obelisk.height <= 2.8);
  assert.ok(obelisk.halfWidth <= .5 && obelisk.halfDepth <= .5);
  for (const name of ['cemetery-gate-x', 'cemetery-gate-y']) {
    const record = contract.frames[name], [a, b] = record.colliders, axis = record.axis;
    assert.equal(record.colliders.length, 2, name);
    for (const post of record.colliders) assert.ok(post.halfWidth <= .3 && post.halfDepth <= .3, `${name} post`);
    // The walkable gap between the posts is 2.5u, and the passage fills it.
    const gap = axis === 'x' ? (b.x - b.halfWidth) - (a.x + a.halfWidth) : (b.y - b.halfDepth) - (a.y + a.halfDepth);
    assert.ok(Math.abs(gap - 2.5) < 1e-9, `${name}: gap ${gap}`);
    const span = axis === 'x' ? 2 * record.passage.halfWidth : 2 * record.passage.halfDepth;
    assert.ok(Math.abs(span - 2.5) < 1e-9, `${name}: passage ${span}`);
  }
  // Broken fences stand in two chunks; the gap between them stays walkable.
  for (const name of ['fence-broken-x', 'fence-broken-y']) {
    const record = contract.frames[name], [a, b] = record.colliders, axis = record.axis;
    assert.equal(record.colliders.length, 2, name);
    const end = axis === 'x' ? a.x + a.halfWidth : a.y + a.halfDepth, start = axis === 'x' ? b.x - b.halfWidth : b.y - b.halfDepth;
    assert.ok(start - end >= .6, `${name}: gap ${(start - end).toFixed(2)}u`);
  }
  // The broken obelisk keeps one collider for its plinth and one for the fallen top.
  assert.equal(contract.frames['obelisk-broken'].colliders.length, 2);
});

test('atlas alpha is binary with zero transparent RGB and one bounded palette shared with the camp and the ruins', () => {
  const colors = new Set(), declared = new Set(Object.values(palette.props).map(entry => entry.hex));
  for (let y = 0; y < atlas.height; y++) for (let x = 0; x < atlas.width; x++) {
    const p = atlas.pixel(x, y);
    assert.ok(p[3] === 0 || p[3] === 255, `partial alpha at ${x},${y}`);
    if (p[3]) colors.add(hex(p));
    else assert.equal(p[0] | p[1] | p[2], 0, `transparent RGB at ${x},${y}`);
  }
  assert.ok(colors.size >= 24 && colors.size <= 48, `${colors.size} prop colours`);
  for (const color of colors) assert.ok(declared.has(color), `undeclared colour ${color}`);
  // The zone reads as the same world: at least 24 atlas colours are camp or ruins colours, by value.
  const world = new Set([...Object.values(campPalette.props), ...Object.values(ruinsPalette.props)].map(entry => entry.hex));
  const shared = [...colors].filter(color => world.has(color));
  assert.ok(shared.length >= 24, `${shared.length} shared colours`);
  for (const name of palette.sharedWithCampPanorama) assert.equal(palette.props[name].hex, campPalette.props[name].hex, name);
  for (const name of palette.sharedWithMonasteryRuins) assert.equal(palette.props[name].hex, ruinsPalette.props[name].hex, name);
});

test('magenta lies only in the faint grave-ash cracks and turquoise only in the stone lantern', () => {
  const magenta = hexes(['RUNE1', 'RUNE2', 'RUNE3']), cyan = hexes(['C0', 'C1', 'C2', 'C3', 'C4']);
  for (const name of FRAMES) {
    const m = count(name, magenta), c = count(name, cyan);
    if (name === 'grave-ash') {
      assert.ok(m > 30, `${m} crack pixels`);
      // Faint: most of the crack length is the dark ember tone.
      assert.ok(count(name, hexes(['RUNE3'])) >= .6 * m, 'grave-ash cracks are too bright');
    } else assert.equal(m, 0, `${name} must not carry magenta`);
    if (name === 'stone-lantern') assert.ok(c > 12, `${c} glow pixels`);
    else assert.equal(c, 0, `${name} must not carry turquoise`);
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
      // A raised rim or a grass blade reads further back when it is projected onto the ground.
      const margin = .1 + record.height * 32 * Math.sin(Math.PI / 3) / (16 * Math.SQRT2);
      if (!inside && record.role === 'flat' && (Math.abs(wx) > record.halfWidth + margin || Math.abs(wy) > record.halfDepth + margin)) outside++;
    }
    assert.ok(onFootprint > 0, `${name} does not stand on its footprint`);
    // Ground decals lie inside their rectangle: they are the walkable area.
    if (record.role === 'flat') assert.ok(outside <= 4, `${name}: ${outside} decal pixels outside its area`);
  }
});

test('drawn heights match the footprints and stay in scale with the 62 px monk', () => {
  // Centred props: the top pixel sits where the declared height projects above the contact centre.
  for (const name of ['stele-tall-x', 'stele-tall-y', 'obelisk', 'stone-lantern', 'yew-round', 'yew-small']) {
    const record = contract.frames[name], top = Math.min(...opaqueOf(name).map(p => p[1]));
    const expected = record.contactCenter[1] - KZ * record.height;
    assert.ok(Math.abs(top - expected) <= 7, `${name}: top row ${top}, height projects to ${expected.toFixed(1)}`);
  }
  const tall = contract.frames['stele-tall-x'];
  assert.ok(tall.height >= 1.35 && tall.height <= 1.65 && 2 * tall.halfWidth >= .6 && 2 * tall.halfWidth <= .8);
  assert.ok(tall.contactCenter[1] - Math.min(...opaqueOf('stele-tall-x').map(p => p[1])) < 62, 'a gravestone outgrows the monk');
  const low = contract.frames['stele-low-x'];
  assert.ok(low.height >= .7 && low.height <= .9 && 2 * low.halfWidth >= 1 && 2 * low.halfWidth <= 1.2);
  const lantern = contract.frames['stone-lantern'];
  assert.ok(lantern.height >= 1.2 && lantern.height <= 1.4);
});

test('-x and -y twins are drawn separately, not mirrored', () => {
  // A mirror would repeat the colours at mirrored positions; separate drawings keep the lit face lit.
  for (const base of TWINS) {
    let both = 0, same = 0;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const a = at(`${base}-x`, x, y), b = at(`${base}-y`, 255 - x, y);
      if (a[3] && b[3]) { both++; if (hex(a) === hex(b)) same++; }
    }
    assert.ok(both > 300, base);
    assert.ok(same / both < .6, `${base}: ${(100 * same / both).toFixed(0)}% of the -y frame mirrors the -x frame`);
  }
  // The carved face of a -x stele is in shade, of a -y stele lit: the -y frame is the lighter one.
  const luminance = name => {
    const pixels = opaqueOf(name).map(([x, y]) => at(name, x, y));
    return pixels.reduce((sum, p) => sum + p[0] * .3 + p[1] * .59 + p[2] * .11, 0) / pixels.length;
  };
  for (const base of ['stele-tall', 'stele-low']) assert.ok(luminance(`${base}-y`) > luminance(`${base}-x`) + 4, base);
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

test('both gate passages stay see-through down to the ground', () => {
  for (const name of ['cemetery-gate-x', 'cemetery-gate-y']) {
    const record = contract.frames[name], { passage } = record, axis = record.axis;
    // Sample 0.08u inside the post faces: the plinths' one-pixel outline may touch the passage edge.
    const [ix, iy] = axis === 'x' ? [.08, .03] : [.03, .08];
    let checked = 0;
    for (let wx = -passage.halfWidth + ix; wx <= passage.halfWidth - ix + 1e-9; wx += .05) {
      for (let wy = -passage.halfDepth + iy; wy <= passage.halfDepth - iy + 1e-9; wy += .05) {
        // Ground the near post hides: the view ray towards the camera runs into it.
        if ((axis === 'x' ? wx - wy : wy - wx) > .85) continue;
        const [px, py] = toScreen(record, wx, wy);
        assert.equal(at(name, Math.floor(px), Math.floor(py))[3], 0, `${name}: passage ground ${wx.toFixed(2)},${wy.toFixed(2)} is covered`);
        checked++;
      }
    }
    assert.ok(checked > 400, `${name}: ${checked} points`);
  }
});

test('flat decals carry no silhouette outline', () => {
  for (const name of FRAMES.filter(n => contract.frames[n].role === 'flat')) {
    assert.ok(opaqueOf(name).every(([x, y]) => hex(at(name, x, y)) !== palette.props.OUT.hex), name);
  }
});

test('hit mask bits equal the actual atlas alpha for every pixel', () => {
  const masks = JSON.parse(readFileSync(new URL('hit-masks.json', pkg)));
  assert.deepEqual(Object.keys(masks), ['cemetery.png']);
  const { width, height, bits } = masks['cemetery.png'];
  assert.equal(width, 1024); assert.equal(height, 2048);
  const bytes = Buffer.from(bits, 'base64'), png = readPng(new URL('cemetery.png', pkg));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    assert.equal((bytes[i >> 3] >> (i & 7)) & 1, png.alpha(x, y) ? 1 : 0, `mask ${x},${y}`);
  }
});

test('cemetery earth is an opaque meadow surface, darker than the camp grass, seamless on both axes', () => {
  const image = decode(new URL('cemetery-earth.png', pkg));
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
  assert.ok(colors.size >= 8 && colors.size <= 12, `${colors.size} colours`);
  // The camp meadow averages (115, 111, 75); under the grove it is one step darker, same hue.
  const camp = [115, 111, 75];
  sum.forEach((total, c) => {
    const darker = camp[c] - total / 16384;
    assert.ok(darker >= 5 && darker <= 25, `mean channel ${c} is ${darker.toFixed(1)} below the camp`);
  });
  assert.ok(seamX / 128 <= interiorX / (127 * 128) * 1.5, 'visible vertical tile seam');
  assert.ok(seamY / 128 <= interiorY / (127 * 128) * 1.5, 'visible horizontal tile seam');
  // Its meadow hues are the camp grass's own colours.
  const grass = decode(new URL('assets/game/pixel-v9/camp-panorama/camp-grass.png', root)), campColors = new Set();
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) campColors.add(hex(grass.pixel(x, y)));
  assert.ok([...colors].filter(color => campColors.has(color)).length >= 5);
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
  const script = fileURLToPath(new URL('scripts/build-cemetery-assets.py', root));
  const result = spawnSync('python3', ['-B', script, '--verify-only'], { encoding: 'utf8', timeout: 300000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).mismatched, []);
  assert.deepEqual(snapshot(), before);
});
