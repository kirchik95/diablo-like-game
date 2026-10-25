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
  for (const id of ['health-orb', 'health-level', 'health-surface', 'health-text', 'spirit-orb', 'spirit-level', 'spirit-surface',
    'spirit-text', 'breath-warning', 'level-value', 'point-mark', 'point-count', 'xp-bar', 'xp-fill', 'slot-lmb', 'slot-space',
    'slot-rmb', 'slot-q', 'slot-f', 'combo-pips', 'charge-pips', 'loot-lines', 'quest-title', 'quest-copy', 'encounter-label',
    'kill-count', 'kill-dots', 'total-kills', 'location-title', 'minimap', 'zone-camp', 'zone-road', 'zone-courtyard', 'sound',
    'pause', 'notice', 'interaction-prompt', 'interaction-copy', 'overlay', 'play', 'restart', 'appearance-picker', 'run-summary',
    'run-trophy', 'pause-settings', 'pause-controls']) {
    assert.match(html, new RegExp(`\\bid="${id}"`), id);
  }
  // The orbs replace the health panel: no portrait and no «дыхание ровное» line in the HUD.
  for (const gone of ['hero-portrait', 'combat-state', 'health-fill', 'spirit-fill', 'vital-bars']) assert.doesNotMatch(html, new RegExp(gone));
  assert.match(html, /<p id="breath-warning" class="breath-warning" role="status" hidden>дыши\. и продолжай\.<\/p>/);
  assert.deepEqual([...html.matchAll(/<span class="keycap">([^<]+)<\/span>/g)].map(match => match[1]), ['ЛКМ', 'Пробел', 'ПКМ', 'Q', 'F']);
  assert.deepEqual([...html.matchAll(/<span class="skill-name">([^<]+)<\/span>/g)].map(match => match[1]),
    ['Серия ударов', 'Пробивающий шаг', 'Волна духа', 'Ладонь духа', 'Прыжок журавля']);
  // Q and F start locked at levels 2 and 4 (§2.7).
  assert.match(html, /<div class="skill locked" id="slot-q">[\s\S]*?<span class="skill-unlock">ур\. 2<\/span>/);
  assert.match(html, /<div class="skill locked" id="slot-f">[\s\S]*?<span class="skill-unlock">ур\. 4<\/span>/);
  assert.match(html, /class="combo-pips" id="combo-pips"[^>]*><i><\/i><i><\/i><i><\/i><\/div>/);
  assert.equal(html.match(/class="cooldown"/g).length, 5);
  assert.match(html, /id="slot-rmb">[\s\S]*?<span class="skill-cost">40<\/span>/);
  // Every technique the loadout can slot has an icon.
  for (const icon of ['combo', 'dash', 'wave', 'palm', 'crane', 'deflect', 'bell', 'mantra', 'sevenStrikes', 'lock']) {
    assert.match(html, new RegExp(`<g id="icon-${icon}">`), icon);
  }
  // Movement and shortcut hints left the in-game HUD; the pause legend still lists them.
  const legend = html.match(/<div id="pause-controls"[\s\S]*?<\/div>/)[0];
  // RMB, Q and F rows follow the loadout (§5.9); C / I / K open the «Монах» panel.
  for (const words of ['WASD', 'стрелки', 'ЛКМ', 'серия ударов', 'ПРОБЕЛ', 'пробивающий шаг', '<kbd>ПКМ</kbd>', 'волна духа',
    '40 духа', '<kbd>Q</kbd>', 'откроется на ур. 2', '<kbd>F</kbd>', 'откроется на ур. 4', '<kbd>C / I / K</kbd>',
    '<kbd>E</kbd>', 'взаимодействие', '<kbd>M</kbd>', 'звук', '<kbd>Esc</kbd>', 'пауза']) {
    assert.ok(legend.includes(words), words);
  }
});

test('orb HUD geometry follows §5.2 in --u', () => {
  const rule = selector => {
    const match = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`));
    assert.ok(match, selector);
    return match[1];
  };
  const u = n => `calc(var(--u) * ${n})`;
  // 44u above the 4u window margin: orb and key tops line up at 48u.
  assert.match(rule('.hud'), new RegExp(`height: ${u(44).replace(/[()*]/g, '\\$&')};`));
  assert.match(rule('.orb'), /width: calc\(var\(--u\) \* 37\);\s*height: calc\(var\(--u\) \* 44\);/);
  assert.match(rule('.orb-plate'), /left: var\(--u\);\s*width: calc\(var\(--u\) \* 35\);\s*height: calc\(var\(--u\) \* 9\);/);
  // One group at the bottom centre: health 4u left of the slot row, spirit 4u right of it.
  assert.match(rule('.health-orb'), /left: calc\(50% - var\(--u\) \* 117\);/);
  assert.match(rule('.spirit-orb'), /left: calc\(50% \+ var\(--u\) \* 80\);/);
  assert.match(rule('.level-badge'), /left: calc\(50% - var\(--u\) \* 78\);\s*bottom: calc\(var\(--u\) \* 45\);/);
  assert.match(rule('.level-points-button'), /bottom: calc\(var\(--u\) \* 49\);/);
  assert.match(rule('.level-points-button'), /width: calc\(var\(--u\) \* 24\);\s*height: calc\(var\(--u\) \* 24\);/);
  // Experience: ten 12u cells (131u) above the slot row, bottom at 51u.
  assert.match(rule('.hud'), /--xp-cell: calc\(var\(--u\) \* 12\);/);
  assert.match(rule('.xp-track'), /left: calc\(50% - var\(--u\) \* 66\);\s*bottom: calc\(var\(--u\) \* 47\);\s*width: calc\(var\(--xp-cell\) \* 10 \+ var\(--u\) \* 11\);\s*height: calc\(var\(--u\) \* 5\);/);
  assert.match(rule('.xp-cells'), /background: #3b3127;/);
  // Five 28u slots with 3u gaps (152u), centred, bottom at 16u.
  assert.match(rule('.skills'), /bottom: calc\(var\(--u\) \* 12\);\s*left: 50%;[^}]*gap: calc\(var\(--u\) \* 3\);[^}]*transform: translateX\(-50%\);/);
  // Neighbours: the loot lines end at 52u (104 px) and the prompt at 62u (124 px), above the experience bar.
  assert.match(rule('.loot-lines'), /right: 0;\s*bottom: calc\(var\(--u\) \* 48\);/);
  assert.match(rule('.interaction-prompt'), /bottom: calc\(var\(--edge\) \+ var\(--u\) \* 58\);/);
  // Health blinks every 0.5 s; the points pulse takes 1.4 s. Reduced motion stops both.
  assert.match(css, /\.orb\.low \.orb-empty \{ animation: orb-blink 1s steps\(1, end\) infinite; \}/);
  assert.match(css, /@keyframes orb-blink \{ 50%, to \{ fill: var\(--coral-dark\); \} \}/);
  assert.match(rule('.level-points-button'), /animation: point-pulse 1\.4s steps\(2, end\) infinite;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{ animation: none !important;/);
});

test('the phone XP cell rounding absorbs the 100dvw float error and lifts no other cell', () => {
  // Chrome measures the viewport a hair short: at some widths the bare rounding lost one u.
  // The phone measures the visible width, 100dvw (iPhone Safari's 100vw can be wider).
  const guard = (units, width = '100vw') => new RegExp(`--xp-cell: round\\(down, \\(${width} - [^;]*?var\\(--u\\) \\* ${units}\\) \\/ 10 \\+ 1px \\/ 64, var\\(--u\\)\\);`);
  assert.match(text('../src/mobile.css'), guard(165, '100dvw'), 'phone: ten cells in the top bar');
  // W − n·u is a whole pixel, so a cell that is not exact sits at least 0.1 px below the next u: 1/64 px never lifts it.
  const cell = (width, units, u, shortBy) => Math.floor(((width - shortBy - units * u) / 10 + 1 / 64) / u) * u;
  for (const [units, scales] of [[165, [2]]]) {
    for (const u of scales) {
      for (let width = units * u; width <= 3000; width++) {
        const exact = Math.floor((width - units * u) / (10 * u)) * u;
        assert.equal(cell(width, units, u, 1e-4), exact, `${width} px, u = ${u}: a short 100vw keeps the exact cell`);
        assert.equal(cell(width, units, u, 0), exact, `${width} px, u = ${u}: a true 100vw is not lifted`);
      }
    }
  }
});

test('orb glass is a 29-row pixel circle and the plates keep the system font', () => {
  const glass = html.match(/<path id="orb-glass" d="([^"]+)"/)[1];
  const rows = new Map();
  for (const [, x, y, w, h] of glass.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)[hH]-?\d+z/g)) {
    for (let row = Number(y); row < Number(y) + Number(h); row++) rows.set(row, [Number(x), Number(x) + Number(w)]);
  }
  assert.deepEqual([...rows.keys()].sort((a, b) => a - b), Array.from({ length: 29 }, (_, i) => i + 4));
  for (const [row, [left, right]] of rows) {
    const mirror = rows.get(36 - row);
    assert.deepEqual([left, right], mirror, `row ${row} mirrors row ${36 - row}`);
    assert.equal(left + right, 37, `row ${row} is centred`);
  }
  assert.doesNotMatch(css, /\.orb-plate[^}]*font-family/);
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

test('a notice shows over the «Монах» sheet but stays under the start, pause and end panels and the map', () => {
  const rule = selector => {
    const match = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`));
    assert.ok(match, selector);
    return match[1];
  };
  const z = selector => Number(rule(selector).match(/z-index: (\d+);/)[1]);
  assert.ok(z('.notice') > z('.monk-backdrop'), '«Сумка полна» reads over the «Монах» backdrop');
  // The overlay closes with .closed; while it is open the notice drops under it and under the raised map.
  const under = z('body:has(#overlay:not(.closed)) .notice');
  assert.ok(under < z('.overlay'));
  assert.ok(under < z('body.menu-open .world-info'));
});

test('the map strip lists five zones in route order, the side zones hidden until entered; the summary counts caches', () => {
  const strip = html.match(/<ol class="map-zones"[^>]*>([\s\S]*?)<\/ol>/)[1];
  assert.deepEqual([...strip.matchAll(/<li id="zone-(\w+)"( hidden)?>([^<]+)<\/li>/g)].map(match => [match[1], !!match[2], match[3]]), [
    ['camp', false, 'Лагерь'], ['road', false, 'Дорога'], ['cemetery', true, 'Кладбище'],
    ['courtyard', false, 'Монастырь'], ['orchard', true, 'Сад'],
  ]);
  // Five names are wider than the 100u map: the strip wraps instead of overflowing.
  assert.match(css, /\n\.map-zones \{[^}]*flex-wrap: wrap;/);
  assert.match(html, /<div><dt>Тайники<\/dt><dd id="summary-secret"><\/dd><\/div>/);
});

test('«Настройки» in the pause menu: a titled block of rows, the sound switch first, M still its key', () => {
  const overlay = html.slice(html.indexOf('<div id="overlay"'), html.indexOf('<div id="pause-controls"'));
  const [section, attributes, body] = overlay.match(/<section id="pause-settings"([^>]*)>([\s\S]*?)<\/section>/);
  assert.ok(section, 'the settings stand in the overlay, before the pause legend');
  assert.match(attributes, /class="settings" aria-labelledby="settings-title" hidden/);
  assert.match(body, /<h2 id="settings-title">Настройки<\/h2>/);
  // Each row: a name and a switch that the name labels. A later setting adds one more row.
  const rows = [...body.matchAll(/<div class="setting">\s*<span id="([^"]+)">([^<]+)<\/span>\s*<button ([^>]*)>([^<]+)<\/button>\s*<\/div>/g)];
  assert.deepEqual(rows.map(row => [row[1], row[2], row[4]]), [['sound-label', 'Звук', 'Вкл'], ['graphics-label', 'Графика', 'Вкл'], ['perf-label', 'FPS', 'Выкл'], ['minimap-label', 'Миникарта', 'Вкл']]);
  for (const [, label, , button] of rows) {
    assert.match(button, /class="setting-switch" type="button" role="switch" aria-checked="(true|false)"/);
    assert.match(button, new RegExp(`aria-labelledby="${label}"`));
  }
  assert.match(rows[0][3], /id="sound"[^>]*aria-keyshortcuts="m"/);
  // An on switch lights its square; a phone gets a finger-size switch.
  assert.match(css, /\n\.setting-switch\[aria-checked="true"\]::before \{[^}]*background: var\(--amber\);/);
  assert.match(text('../src/mobile.css'), /\nhtml\.touch-ui \.setting-switch \{ height: calc\(var\(--u\) \* 22\);/);
});
