import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bytes = path => readFileSync(new URL(path, import.meta.url));
const text = path => bytes(path).toString('utf8');
const html = text('../index.html');
const css = text('../src/styles.css');

test('HUD text uses a readable system font on the pixel grid', () => {
  // The user rejected the hand-drawn pixel font as unreadable; frames and bars stay pixel art.
  assert.doesNotMatch(css, /@font-face|Ritual Pixel|font-smoothing: none/);
  assert.match(css, /font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;/);
  assert.match(css, /--fs: calc\(var\(--u\) \* 6\.5\);/);
});

test('the HUD unit equals the integer world scale chosen by the renderer', () => {
  const [, perWidth, perHeight] = text('../src/render.js')
    .match(/Math\.max\(2, Math\.floor\(Math\.min\(viewportWidth \/ (\d+), viewportHeight \/ (\d+)\)\)\)/).map(Number);
  const base = Number(css.match(/:root \{[^}]*?--u: (\d+)px;/)[1]);
  const steps = [...css.matchAll(/@media \(min-width: (\d+)px\) and \(min-height: (\d+)px\) \{ :root \{ --u: (\d+)px; \} \}/g)]
    .map(match => match.slice(1).map(Number));
  const unitAt = (width, height) => steps.reduce((unit, [minWidth, minHeight, value]) =>
    width >= minWidth && height >= minHeight ? Math.max(unit, value) : unit, base);
  for (const [width, height] of [[800, 600], [1174, 813], [1440, 900], [1919, 1080], [1920, 1079], [1920, 1080],
    [2560, 1080], [2560, 1440], [3440, 1440], [3840, 2160], [5120, 2880]]) {
    assert.equal(unitAt(width, height), Math.max(2, Math.floor(Math.min(width / perWidth, height / perHeight))), `${width}×${height}`);
  }
});

test('the compact HUD keeps every status, objective and control', () => {
  for (const id of ['health-bar', 'health-fill', 'health-text', 'spirit-bar', 'spirit-fill', 'spirit-text', 'combat-state',
    'hero-portrait', 'skill-attack', 'skill-dash', 'skill-wave', 'wave-cost', 'quest-title', 'quest-copy', 'encounter-label',
    'kill-count', 'kill-dots', 'total-kills', 'location-title', 'minimap', 'zone-camp', 'zone-road', 'zone-courtyard', 'sound',
    'pause', 'notice', 'interaction-prompt', 'interaction-copy', 'overlay', 'play', 'restart', 'appearance-picker', 'run-summary',
    'run-trophy', 'pause-controls']) {
    assert.match(html, new RegExp(`\\bid="${id}"`), id);
  }
  assert.deepEqual([...html.matchAll(/<span class="keycap">([^<]+)<\/span>/g)].map(match => match[1]), ['ЛКМ', 'Пробел', 'ПКМ/Q']);
  assert.deepEqual([...html.matchAll(/<span class="skill-name">([^<]+)<\/span>/g)].map(match => match[1]),
    ['Серия ударов', 'Пробивающий шаг', 'Волна духа']);
  assert.match(html, /class="combo-pips"[^>]*><i><\/i><i><\/i><i><\/i><\/div>/);
  assert.equal(html.match(/class="cooldown"/g).length, 2);
  assert.match(html, /<span id="wave-cost">40<\/span><span class="sr-only"> духа<\/span>/);
  // Movement and shortcut hints left the in-game HUD; the pause legend still lists them.
  const legend = html.match(/<div id="pause-controls"[\s\S]*?<\/div>/)[0];
  for (const words of ['WASD', 'стрелки', 'ЛКМ', 'серия ударов', 'ПРОБЕЛ', 'пробивающий шаг', 'ПКМ / Q', 'волна духа',
    '40 духа', '<kbd>E</kbd>', 'взаимодействие', '<kbd>M</kbd>', 'звук', '<kbd>Esc</kbd>', 'пауза']) {
    assert.ok(legend.includes(words), words);
  }
});

test('HUD styles stay on whole pixels without rounded corners or blur', () => {
  assert.doesNotMatch(css, /border-radius|blur\(|drop-shadow/);
  const lengths = [...css.matchAll(/(-?\d*\.\d+|-?\d+)px\b/g)].map(match => Number(match[1]));
  assert.ok(lengths.length > 0);
  assert.ok(lengths.every(Number.isInteger), 'every literal pixel length is a whole number');
  // Hard shadows only: offsets, an optional zero blur and a colour.
  const splitTop = (value, separator) => {
    const parts = []; let depth = 0, current = '';
    for (const char of value) {
      depth += char === '(' ? 1 : char === ')' ? -1 : 0;
      if (depth === 0 && separator.test(char)) { if (current.trim()) parts.push(current.trim()); current = ''; }
      else current += char;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  };
  const shadows = [...css.matchAll(/(?:box-shadow|text-shadow|--outline): ([^;]+);/g)].flatMap(match => splitTop(match[1], /,/));
  assert.ok(shadows.length > 10);
  for (const shadow of shadows) {
    const tokens = splitTop(shadow, /\s/).filter(token => token !== 'inset');
    if (/^(#|var\(|rgb)/.test(tokens.at(-1))) tokens.pop();
    assert.ok(tokens.length < 3 || tokens[2] === '0', `hard shadow: ${shadow}`);
  }
});

test('pixel cursors exist with matching hashes and the stylesheet uses them', async () => {
  const { createHash } = await import('node:crypto');
  const manifest = JSON.parse(text('../assets/ui/pixel-v4/cursor/manifest.json'));
  for (const [file, sha] of Object.entries(manifest.files)) {
    assert.equal(createHash('sha256').update(bytes(`../assets/ui/pixel-v4/cursor/${file}`)).digest('hex'), sha, file);
  }
  const escapeReg = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const imageSet = (file, hx, hy, keyword) =>
    `cursor: ${keyword}; cursor: image-set\\(url\\("\\.\\./assets/ui/pixel-v4/cursor/${escapeReg(file)}\\.png"\\) 1x, url\\("\\.\\./assets/ui/pixel-v4/cursor/${escapeReg(file)}@2x\\.png"\\) 2x\\) ${escapeReg(hx)} ${escapeReg(hy)}, ${keyword}`;
  const reticle = manifest.cursors.reticle;
  const [hx, hy] = reticle.hotspot;
  // The aim point is the reticle centre, and every cursor keeps a system fallback.
  assert.deepEqual(reticle.scales['2'].hotspot, [hx, hy]);
  assert.match(css, new RegExp(`#game \\{ ${imageSet('reticle', hx, hy, 'crosshair')};`));
  assert.match(css, new RegExp(`html \\{ ${imageSet('arrow', 0, 0, 'default')}; \\}`));
  assert.deepEqual(manifest.cursors.arrow.hotspot, [0, 0]);
  assert.deepEqual(manifest.cursors['arrow-active'].hotspot, [0, 0]);
  assert.doesNotMatch(css, /cursor: pointer;(?! cursor: image-set)/, 'interactive controls use the amber pixel arrow');

  const expectedFiles = [];
  for (const name of ['arrow', 'arrow-active', 'reticle']) {
    for (const suffix of ['', '-u3', '-u4']) expectedFiles.push(`${name}${suffix}.png`, `${name}${suffix}@2x.png`);
  }
  assert.deepEqual(Object.keys(manifest.files).sort(), expectedFiles.sort());
  for (const cursor of Object.values(manifest.cursors)) {
    assert.deepEqual(Object.keys(cursor.scales), ['2', '3', '4']);
    const art = cursor.scales['2'].size.map(px => px / 2);
    for (const scale of Object.values(cursor.scales)) {
      assert.deepEqual(scale.size, art.map(px => px * scale.cssPixelsPerArtPixel));
    }
  }
  for (const scale of Object.values(reticle.scales)) {
    assert.deepEqual(scale.hotspot, [scale.size[0] / 2, scale.size[1] / 2]);
  }
  for (const name of ['arrow', 'arrow-active']) {
    for (const scale of Object.values(manifest.cursors[name].scales)) assert.deepEqual(scale.hotspot, [0, 0]);
  }

  function cursorMediaBlocks(source) {
    const blocks = [];
    for (const match of source.matchAll(/@media \(min-width: (\d+)px\) and \(min-height: (\d+)px\) \{/g)) {
      const open = match.index + match[0].length - 1;
      let depth = 0;
      let end = open;
      for (let i = open; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        else if (source[i] === '}') {
          depth -= 1;
          if (depth === 0) { end = i; break; }
        }
      }
      const body = source.slice(open + 1, end);
      if (body.includes('cursor:')) blocks.push({ minWidth: Number(match[1]), minHeight: Number(match[2]), body });
    }
    return blocks;
  }

  const bands = [
    { minWidth: 1920, minHeight: 1080, scale: '3', suffix: '-u3' },
    { minWidth: 2560, minHeight: 1440, scale: '4', suffix: '-u4' },
  ];
  const blocks = cursorMediaBlocks(css);
  assert.deepEqual(blocks.map(block => [block.minWidth, block.minHeight]), bands.map(band => [band.minWidth, band.minHeight]));
  const pointers = ['.icon-button', '.appearance-choice', '.appearance-retry', '.primary-button', '.text-button'];
  for (const [band, block] of bands.map((band, index) => [band, blocks[index]])) {
    const [pointX, pointY] = manifest.cursors.reticle.scales[band.scale].hotspot;
    assert.match(block.body, new RegExp(`html \\{ ${imageSet(`arrow${band.suffix}`, 0, 0, 'default')}; \\}`), band.suffix);
    assert.match(block.body, new RegExp(`#game \\{ ${imageSet(`reticle${band.suffix}`, pointX, pointY, 'crosshair')};`), band.suffix);
    for (const selector of pointers) {
      assert.match(block.body, new RegExp(`${escapeReg(selector)}[^{]*\\{ ${imageSet(`arrow-active${band.suffix}`, 0, 0, 'pointer')};`), `${band.suffix} ${selector}`);
    }
  }
  // --u of 5px and above still matches the 2560×1440 query, so those screens keep the u4 cursor.
  const unitSteps = [...css.matchAll(/@media \(min-width: (\d+)px\) and \(min-height: (\d+)px\) \{ :root \{ --u: (\d+)px; \} \}/g)]
    .map(match => match.slice(1).map(Number));
  for (const [minWidth, minHeight, unit] of unitSteps) {
    if (unit >= 5) assert.ok(minWidth >= 2560 && minHeight >= 1440, `--u ${unit}px keeps the u4 cursor`);
  }
});
