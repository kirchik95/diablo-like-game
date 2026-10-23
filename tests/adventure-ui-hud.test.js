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
  const [hx, hy] = manifest.cursors.reticle.hotspot;
  // The aim point is the reticle centre, and every cursor keeps a system fallback.
  assert.match(css, new RegExp(`#game \\{ cursor: crosshair; cursor: image-set\\(url\\("\\.\\./assets/ui/pixel-v4/cursor/reticle\\.png"\\) 1x, url\\("\\.\\./assets/ui/pixel-v4/cursor/reticle@2x\\.png"\\) 2x\\) ${hx} ${hy}, crosshair;`));
  assert.match(css, /html \{ cursor: default; cursor: image-set\(url\("\.\.\/assets\/ui\/pixel-v4\/cursor\/arrow\.png"\) 1x, url\("\.\.\/assets\/ui\/pixel-v4\/cursor\/arrow@2x\.png"\) 2x\) 0 0, default; \}/);
  assert.doesNotMatch(css, /cursor: pointer;(?! cursor: image-set)/, 'interactive controls use the amber pixel arrow');
});
