import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const file = path => new URL(path, import.meta.url);
const html = readFileSync(file('../index.html'), 'utf8');
const css = readFileSync(file('../src/styles.css'), 'utf8');
const manifest = JSON.parse(readFileSync(file('../public/manifest.webmanifest'), 'utf8'));
const token = name => css.match(new RegExp(`${name}: (#[0-9a-f]{6});`))[1];
// Width and height from the IHDR chunk of a PNG.
const pngSize = path => {
  const bytes = readFileSync(file(`../public${path}`));
  assert.equal(bytes.toString('latin1', 1, 4), 'PNG', path);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
};

test('the home-screen manifest opens «Ночной ритуал» full screen in landscape (mobile-touch, question 10)', () => {
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
  assert.equal(manifest.name, 'Ночной ритуал');
  assert.equal(manifest.short_name, 'Ночной ритуал');
  assert.deepEqual([manifest.display, manifest.orientation, manifest.start_url, manifest.scope], ['fullscreen', 'landscape', '/', '/']);
  // Colours from the palette: the ink of the page, the same as the theme-color meta, so the splash meets the page.
  assert.equal(manifest.theme_color, token('--ink'));
  assert.equal(manifest.background_color, token('--ink'));
  assert.equal(html.match(/<meta name="theme-color" content="(#[0-9a-f]{6})"/i)[1].toLowerCase(), token('--ink'));
});

test('the app icons are new files in public/icons at their stated sizes; the iPhone gets its own 180 px icon', () => {
  const icons = manifest.icons.map(icon => [icon.src, icon.sizes, icon.type, icon.purpose]);
  assert.deepEqual(icons, [
    ['/icons/night-ritual-monk-v2-192.png', '192x192', 'image/png', 'any'],
    ['/icons/night-ritual-monk-v2-512.png', '512x512', 'image/png', 'any'],
    ['/icons/night-ritual-monk-v2-maskable-512.png', '512x512', 'image/png', 'maskable'],
  ]);
  assert.equal(new Set(manifest.icons.map(icon => icon.src)).size, 3, 'maskable needs a separate safe-zone composition');
  for (const icon of manifest.icons) assert.equal(pngSize(icon.src), icon.sizes, icon.src);
  assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/night-ritual-monk-v2-180\.png" \/>/);
  assert.equal(pngSize('/icons/night-ritual-monk-v2-180.png'), '180x180');
  // The app portrait has its own pixel grid; keep the small inline favicon for browser tabs.
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,/);
  assert.ok(existsSync(file('../scripts/build-app-icons.py')));
});

// Read the delivered pixels independently of the builder; a mask must never cut the motif.
test('the maskable portrait is opaque and all artwork fits the central 80% safe circle', () => {
  const mask = manifest.icons.find(icon => icon.purpose === 'maskable');
  const result = spawnSync('python3', ['-B', '-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGBA')
assert im.size == (512, 512)
ink = (23, 19, 33)
art = 0
for y in range(512):
    for x in range(512):
        r, g, b, a = im.getpixel((x, y))
        assert a == 255, ('transparent pixel', x, y)
        if (r, g, b) != ink:
            art += 1
            # Check the whole pixel, including its furthest corner.
            dx, dy = max(abs(x - 256), abs(x + 1 - 256)), max(abs(y - 256), abs(y + 1 - 256))
            assert dx * dx + dy * dy <= 204.8 ** 2, ('outside safe circle', x, y)
assert art > 10000, 'empty or invisible motif'
`, file(`../public${mask.src}`).pathname], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
