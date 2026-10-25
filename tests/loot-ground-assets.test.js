import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { WEAPON_BASES, RELICS, RARITIES } from '../src/items.js';
import { readPng } from './helpers/png.js';

const dir = new URL('../assets/game/pixel-v12/loot-ground/', import.meta.url);
const file = name => new URL(name, dir);
const manifest = JSON.parse(readFileSync(file('manifest.json'), 'utf8'));
const atlases = { lootGround: manifest.lootGround, campSupplies: manifest.campSupplies };
const inside = ([x, y], [x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1;

test('loot files match the manifest hashes and nothing else sits in the folder', () => {
  for (const [name, sha] of Object.entries(manifest.files)) {
    assert.equal(createHash('sha256').update(readFileSync(file(name))).digest('hex'), sha, name);
  }
  const present = readdirSync(dir, { recursive: true }).filter(name => name !== 'frames').sort();
  assert.deepEqual(present, [...Object.keys(manifest.files), 'manifest.json', 'README.md'].sort());
  assert.ok(manifest.contactSheet in manifest.files);
});

test('every weapon base and relic has a ground sprite of its family with a shadow', () => {
  const expectItem = (name, key, id, family) => {
    const frame = manifest.frames[name];
    assert.ok(frame, `${key} ${id} has a sprite`);
    assert.equal(frame.kind, 'item', name);
    assert.equal(frame[key], id, name);
    assert.equal(frame.family, family, name);
    assert.equal(manifest.lootGround.frames[frame.index], name);
    assert.equal(manifest.frames[frame.shadow]?.kind, 'shadow', `${name} shadow`);
    assert.equal(manifest.frames[frame.shadow].item, name);
  };
  assert.deepEqual(Object.keys(manifest.weapons).sort(), Object.keys(WEAPON_BASES).sort());
  for (const [id, name] of Object.entries(manifest.weapons)) expectItem(name, 'weapon', id, WEAPON_BASES[id].family);
  assert.deepEqual(Object.keys(manifest.relics).sort(), Object.keys(RELICS).sort());
  for (const [id, name] of Object.entries(manifest.relics)) expectItem(name, 'relic', id, RELICS[id].family);
});

test('every rarity has a two-frame ring and beam in its token colour', () => {
  assert.deepEqual(Object.keys(manifest.rarity).sort(), Object.keys(RARITIES).sort());
  for (const [id, rarity] of Object.entries(manifest.rarity)) {
    assert.equal(rarity.token, RARITIES[id].color, id);
    for (const kind of ['ring', 'beam']) {
      assert.equal(rarity[kind].length, 2, `${id} ${kind}`);
      rarity[kind].forEach((name, i) => assert.deepEqual(
        [manifest.frames[name]?.kind, manifest.frames[name].rarity, manifest.frames[name].frame], [kind, id, i], name));
    }
  }
  assert.deepEqual(manifest.glint.map(name => manifest.frames[name]?.kind), ['glint', 'glint']);
  assert.deepEqual(manifest.stack, ['ring', 'shadow', 'beam', 'item', 'glint']);
});

test('frames match their atlas cells and keep anchors inside their bounds', () => {
  const sheets = Object.fromEntries(Object.entries(atlases).map(([key, atlas]) => {
    const png = readPng(file(atlas.path));
    assert.deepEqual([png.width, png.height], [atlas.columns * atlas.frameSize[0], atlas.rows * atlas.frameSize[1]], key);
    return [key, png];
  }));
  const listed = Object.values(atlases).flatMap(atlas => atlas.frames);
  assert.deepEqual(Object.keys(manifest.frames).sort(), [...listed].sort());
  for (const [name, frame] of Object.entries(manifest.frames)) {
    const atlas = atlases[frame.atlas], [w, h] = frame.size, sheet = sheets[frame.atlas];
    assert.deepEqual(frame.size, atlas.frameSize, name);
    assert.deepEqual(frame.anchor, atlas.anchor, name);
    assert.equal(atlas.frames[frame.index], name);
    assert.ok(inside(frame.anchor, [0, 0, w, h]), `${name} anchor inside the frame`);
    const [x0, y0, x1, y1] = frame.opaqueBounds;
    assert.ok(x0 >= 0 && x0 < x1 && x1 <= w && y0 >= 0 && y0 < y1 && y1 <= h, `${name} bounds inside the frame`);
    // The beam rises from the anchor: its bottom row sits right above it and straddles its column.
    if (frame.kind === 'beam') assert.ok(y1 === frame.anchor[1] && inside(frame.anchor, [x0, y0, x1, y1 + 1]), name);
    else assert.ok(inside(frame.anchor, frame.opaqueBounds), `${name} lies over its anchor`);
    if (frame.glint) assert.ok(inside(frame.glint, frame.opaqueBounds), `${name} glint`);

    const png = readPng(file(frame.file)), ox = (frame.index % atlas.columns) * w, oy = Math.floor(frame.index / atlas.columns) * h;
    assert.deepEqual([png.width, png.height], frame.size, name);
    let box = [w, h, 0, 0];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const alpha = png.alpha(x, y);
      assert.equal(sheet.alpha(ox + x, oy + y), alpha, `${name} ${x},${y} in the atlas`);
      if (frame.alpha === 'binary') assert.ok(alpha === 0 || alpha === 255, `${name} ${x},${y} binary alpha`);
      if (alpha) box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x + 1), Math.max(box[3], y + 1)];
    }
    assert.deepEqual(box, frame.opaqueBounds, `${name} opaque bounds`);
  }
});

test('camp supplies show both starter weapons, then the empty cloth', () => {
  const { full, empty } = manifest.campSupplies;
  assert.deepEqual(manifest.frames[full].weapons.sort(), ['novice-knuckles', 'novice-staff']);
  assert.deepEqual(manifest.frames[empty].weapons, []);
  for (const id of manifest.frames[full].weapons) assert.equal(WEAPON_BASES[id].ilvl, 1, id);
});
