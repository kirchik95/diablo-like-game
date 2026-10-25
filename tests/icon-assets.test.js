import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { SKILLS } from '../src/skills.js';
import { WEAPON_BASES, WEAPON_FAMILIES, RELICS } from '../src/items.js';
import { readPng } from './helpers/png.js';

const dir = new URL('../assets/ui/pixel-v5/icons/', import.meta.url);
const file = name => new URL(name, dir);
const manifest = JSON.parse(readFileSync(file('manifest.json'), 'utf8'));

test('icon files match the manifest hashes and nothing else sits in the folder', () => {
  for (const [name, sha] of Object.entries(manifest.files)) {
    assert.equal(createHash('sha256').update(readFileSync(file(name))).digest('hex'), sha, name);
  }
  assert.deepEqual(readdirSync(dir).sort(), [...Object.keys(manifest.files), 'manifest.json', 'README.md'].sort());
});

test('every skill, weapon base and relic has an icon of the right kind', () => {
  const expectIcon = (name, kind, id) => {
    const icon = manifest.icons[name];
    assert.ok(icon, `${kind} ${id} has an icon`);
    assert.equal(icon.kind, kind, name);
    assert.equal(icon.id, id, name);
  };
  assert.deepEqual(Object.keys(manifest.skills).sort(), Object.keys(SKILLS).sort());
  for (const [id, name] of Object.entries(manifest.skills)) expectIcon(name, 'skill', id);
  // The series icon follows the weapon family; `bare` is the series without a weapon.
  assert.deepEqual(Object.keys(manifest.combo).sort(), ['bare', ...Object.keys(WEAPON_FAMILIES)].sort());
  for (const name of Object.values(manifest.combo)) expectIcon(name, 'skill', 'combo');
  assert.deepEqual(Object.keys(manifest.weapons).sort(), Object.keys(WEAPON_BASES).sort());
  for (const [id, name] of Object.entries(manifest.weapons)) expectIcon(name, 'weapon', id);
  assert.deepEqual(Object.keys(manifest.relics).sort(), Object.keys(RELICS).sort());
  for (const [id, name] of Object.entries(manifest.relics)) expectIcon(name, 'relic', id);
  expectIcon(manifest.lock, 'ui', 'lock');
});

test('each icon is 14×14 art scaled 1× to 4× by nearest neighbour', () => {
  assert.deepEqual(manifest.artSize, [14, 14]);
  assert.deepEqual(manifest.scales, [1, 2, 3, 4]);
  for (const [name, icon] of Object.entries(manifest.icons)) {
    const base = readPng(file(icon.files['1']));
    let filled = 0;
    for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) if (base.alpha(x, y)) filled++;
    assert.ok(filled > 20, `${name} has a silhouette`);
    for (const scale of manifest.scales) {
      const filename = icon.files[scale];
      assert.equal(filename, `${name}@${scale}x.png`);
      assert.ok(filename in manifest.files, filename);
      assert.deepEqual(icon.sizes[scale], [14 * scale, 14 * scale], filename);
      const png = readPng(file(filename));
      assert.deepEqual([png.width, png.height], icon.sizes[scale], filename);
      for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) {
        for (const [dx, dy] of [[0, 0], [scale - 1, scale - 1]]) {
          assert.equal(png.alpha(x * scale + dx, y * scale + dy), base.alpha(x, y), `${filename} ${x},${y}`);
        }
      }
    }
  }
});

test('the contact sheet shows every icon once', () => {
  assert.ok(manifest.contactSheet.file in manifest.files);
  assert.deepEqual(manifest.contactSheet.rows.flat().sort(), Object.keys(manifest.icons).sort());
});
