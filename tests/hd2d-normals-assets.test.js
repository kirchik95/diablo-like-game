import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pixelAssetUrls, lootAssetUrls, monkWeaponUrls } from '../src/pixel-assets.js';
import { appearanceOptions, appearanceVariant } from '../src/appearance.js';

const root = new URL('../', import.meta.url);
const manifestUrl = new URL('../assets/game/hd2d-normals/manifest.json', import.meta.url);
const size = path => { const b = readFileSync(path); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('every active atlas and all 18 appearances have equal-size normal/height maps', () => {
  assert.ok(existsSync(manifestUrl), 'normal package has not been generated');
  const manifest = JSON.parse(readFileSync(manifestUrl));
  const urls = Object.values({ ...pixelAssetUrls, ...lootAssetUrls, ...monkWeaponUrls });
  for (const skin of appearanceOptions.skins) for (const hair of appearanceOptions.hair) for (const sash of appearanceOptions.sashes) {
    urls.push(appearanceVariant({skin: skin.id, hair: hair.id, sash: sash.id}).url);
  }
  for (const url of urls) {
    const source = new URL(url).pathname.split('/assets/game/')[1];
    const entry = manifest.atlases.find(e => e.source === `assets/game/${source}`);
    assert.ok(entry, source);
    assert.deepEqual(size(new URL(`../assets/game/hd2d-normals/${entry.id}.png`, import.meta.url)), size(new URL(url)), source);
    assert.equal(entry.gpuBytes, entry.width * entry.height * 4);
  }
});

test('normal generation is byte-deterministic and agrees with shipped hashes', {timeout: 180000}, () => {
  const output = mkdtempSync(join(tmpdir(), 'ritual-normals-'));
  try {
    execFileSync('python3', ['-B', 'scripts/build-normal-maps.py', '--output', output], {cwd: root, timeout: 150000, stdio: 'pipe'});
    const generated = JSON.parse(readFileSync(join(output, 'manifest.json')));
    const shipped = JSON.parse(readFileSync(manifestUrl));
    assert.deepEqual(generated, shipped);
    for (const entry of shipped.atlases) {
      assert.deepEqual(readFileSync(join(output, `${entry.id}.png`)), readFileSync(new URL(`../assets/game/hd2d-normals/${entry.id}.png`, import.meta.url)), entry.id);
    }
  } finally { rmSync(output, {recursive: true, force: true}); }
});

test('bevels point outward, leave cells isolated, and encode height separately from coverage', () => {
  execFileSync('python3', ['-B', '-c', `
import importlib.util
from PIL import Image, ImageDraw
spec=importlib.util.spec_from_file_location('normal_builder','scripts/build-normal-maps.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
im=Image.new('RGBA',(32,16));d=ImageDraw.Draw(im)
d.rectangle((2,2,13,13),fill=(180,170,160,255))
d.rectangle((16,3,28,12),fill=(180,170,160,255))
n=b.normal_atlas(im,(16,16))
assert n.getpixel((3,7))[0]<128, n.getpixel((3,7))
assert n.getpixel((12,7))[0]>128, n.getpixel((12,7))
assert n.getpixel((7,3))[1]>128, n.getpixel((7,3))
assert n.getpixel((7,12))[1]<128, n.getpixel((7,12))
assert n.getpixel((7,7))[:3]==(128,128,255)
assert 0<n.getpixel((3,7))[3]<n.getpixel((7,7))[3]<255
assert n.getpixel((15,7))==(128,128,255,0)
assert n.getpixel((16,7))[0]<128, 'cell boundary must bevel against its own transparent border'
assert set(n.getdata(0)) <= {51,128,204}
assert set(p[:3] for p in n.getdata()) <= set(b.NORMALS)
`], {cwd: root, stdio: 'pipe'});
});
