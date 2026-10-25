import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OVERWORLD, getOverworldZone } from '../src/overworld.js';
import { Renderer, adventureMapLayout, pixelCircleRows, MAP_CELLS } from '../src/render.js';

const text = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = text('../index.html');
const css = text('../src/styles.css');
const mobile = text('../src/mobile.css');
const rule = (source, selector) => {
  const match = source.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`));
  assert.ok(match, selector);
  return match[1];
};
const token = name => css.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))[1];

test('the phone map fits 568px and keeps its enlarged view whenever 648px fits', () => {
  const selector = 'html.touch-ui body.menu-open.touch-map .world-info';
  const base = rule(mobile, selector);
  const columns = [...base.matchAll(/calc\(var\(--u\) \* (\d+)\)/g)].map(match => Number(match[1]));
  const gap = Number(rule(css, '.world-info').match(/gap: var\(--u\) calc\(var\(--u\) \* (\d+)\)/)[1]);
  const normalScale = Number(base.match(/scale\((\d+)\)/)[1]);
  const narrow = mobile.match(/@media \(width < (\d+)px\) \{\s*html\.touch-ui body\.menu-open\.touch-map \.world-info \{([^}]*)\}/);
  const smallScale = narrow ? Number(narrow[2].match(/scale\((\d+)\)/)?.[1] ?? 1) : normalScale;
  const naturalWidth = (columns[0] + columns[1] + gap) * 2;
  for (const [width, wantedScale] of [[568, 1], [647, 1], [648, 2], [667, 2], [812, 2], [844, 2], [932, 2]]) {
    const scale = narrow && width < Number(narrow[1]) ? smallScale : normalScale;
    assert.ok(naturalWidth * scale <= width, `${width}px viewport clips a ${naturalWidth * scale}px map`);
    assert.equal(scale, wantedScale, `${width}px keeps the largest supported whole-pixel scale`);
  }
});

// A 2D context that records every call and the fill style in force at each fill.
function recorder(size) {
  const calls = [];
  let rects = [];
  const context = { canvas: { width: size, height: size }, fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, shadowBlur: 0, shadowColor: '' };
  for (const name of ['clearRect', 'save', 'restore', 'clip', 'moveTo', 'lineTo', 'closePath', 'arc', 'stroke', 'strokeRect', 'fillRect', 'fillText']) {
    context[name] = (...args) => calls.push({ name, args });
  }
  context.beginPath = () => { rects = []; calls.push({ name: 'beginPath' }); };
  context.rect = (...args) => { rects.push(args); calls.push({ name: 'rect', args }); };
  context.fill = () => calls.push({ name: 'fill', style: context.fillStyle, rects });
  return { context, calls };
}

test('a pixel circle: symmetric whole-cell rows within half a cell of the true circle, widest in the middle', () => {
  for (const cells of [MAP_CELLS, MAP_CELLS - 2, MAP_CELLS - 4]) {
    const rows = pixelCircleRows(cells), r = cells / 2;
    assert.equal(rows.length, cells);
    rows.forEach((half, row) => {
      assert.ok(Number.isInteger(half), `${cells}: row ${row}`);
      assert.equal(half, rows[cells - 1 - row], `${cells}: rows mirror top to bottom`);
      assert.ok(Math.abs(half - Math.sqrt(r * r - (row + .5 - r) ** 2)) <= .5, `${cells}: row ${row} follows the circle`);
      if (row > 0 && row < cells / 2) assert.ok(half >= rows[row - 1], `${cells}: rows widen to the middle`);
    });
    assert.equal(rows[cells / 2], r);
    assert.ok(rows[0] > 0 && rows[0] < r / 2, 'a round top, not a square');
  }
});

test('the minimap draws a ring of whole pixels in the HUD palette, clips the map to the disc and writes no text', () => {
  const size = 2 * MAP_CELLS * 2, { context, calls } = recorder(size);
  const player = { x: 0, y: -50 };
  const game = { world: OVERWORLD, player, enemies: [{ kind: 'wraith', hp: 5, x: 3, y: -52 }, { kind: 'beetle', hp: 5, x: -4, y: -47 }],
    adventure: {} };
  Renderer.prototype.drawMap.call({ map: context }, game);
  const clip = calls.findIndex(call => call.name === 'clip');
  const save = calls.findIndex(call => call.name === 'save'), restore = calls.findLastIndex(call => call.name === 'restore');
  assert.ok(save >= 0 && save < clip && clip < restore, 'the map is drawn inside save / clip / restore');
  // The ring: every fill before the clip is a stack of whole-pixel rows in the --night, --stone and --stone-dark colours.
  const ring = calls.slice(0, clip).filter(call => call.name === 'fill');
  assert.deepEqual(ring.map(call => call.style), [token('night'), token('stone'), token('stone-dark'), '#120e1a']);
  for (const { rects } of ring) for (const values of rects) assert.ok(values.every(Number.isInteger), `whole pixels: ${values}`);
  const outer = ring[0].rects;
  assert.equal(outer.length, MAP_CELLS, 'one rect per cell row');
  assert.deepEqual([Math.min(...outer.map(([x]) => x)), Math.max(...outer.map(([x, , w]) => x + w))], [0, size], 'the ring spans the canvas');
  assert.deepEqual([outer[0][1], outer.at(-1)[1] + outer.at(-1)[3]], [0, size]);
  // The upper bevel is light and the lower face dark: the light rows sit above the canvas middle.
  assert.ok(ring[1].rects.every(([, y]) => y < size / 2) && ring[2].rects.every(([, y]) => y >= size / 2));
  // Enemies, markers and the monk are drawn after the clip, before the restore.
  const arcs = calls.map((call, index) => [call.name, index]).filter(([name]) => name === 'arc').map(([, index]) => index);
  assert.ok(arcs.length >= 3 && arcs.every(index => index > clip && index < restore));
  assert.equal(calls.filter(call => call.name === 'fillText').length, 0, 'the plate under the circle names the zone');
});

test('the open-world map keeps the monk in the centre and every drawn marker inside the disc', () => {
  const size = 2 * MAP_CELLS * 2;
  const places = [OVERWORLD.spawn, { x: 0, y: -50 }, ...OVERWORLD.caches, ...OVERWORLD.shrines];
  for (const place of places) {
    const game = { world: OVERWORLD, player: { x: place.x, y: place.y }, adventure: {} };
    const map = adventureMapLayout(game, size, size);
    assert.deepEqual(map.center, { x: size / 2, y: size / 2 });
    assert.equal(map.radius, size / 2 * (MAP_CELLS - 4) / MAP_CELLS, 'the disc ends inside the 2-cell ring');
    assert.deepEqual(map.project(place.x, place.y), map.center, 'the map scrolls under the monk');
    assert.equal(map.title, getOverworldZone(place.x, place.y).title);
    for (const marker of map.markers) {
      const p = map.project(marker.x, marker.y);
      assert.ok(Math.hypot(p.x - map.center.x, p.y - map.center.y) <= map.radius - 4, `${marker.kind} ${marker.id ?? ''} inside the disc`);
    }
    assert.ok(map.markers.some(marker => marker.id === place.id) || !place.id, `${place.id}: its own marker shows`);
  }
});

test('the round map block: a MAP_CELLS --u square frame, the pause button beside it, the name and strip on a plate under it', () => {
  const frame = rule(css, '.map-frame');
  assert.match(frame, new RegExp(`width: calc\\(var\\(--u\\) \\* ${MAP_CELLS}\\); height: calc\\(var\\(--u\\) \\* ${MAP_CELLS}\\);`));
  assert.match(rule(css, '#minimap'), /display: block; width: 100%; height: 100%;/);
  // The canvas starts square; main.js keeps its backing store at 2× the CSS size.
  const [, width, height] = html.match(/<canvas id="minimap" width="(\d+)" height="(\d+)"/);
  assert.equal(width, height);
  const block = rule(css, '.world-info');
  assert.match(block, /display: grid;/);
  assert.match(block, new RegExp(`grid-template-columns: minmax\\(0, 1fr\\) calc\\(var\\(--u\\) \\* ${MAP_CELLS}\\);`));
  assert.match(block, /grid-template-areas: "pause map" "plate plate";/);
  assert.match(block, /top: var\(--edge\);\s*right: var\(--edge\);/);
  const header = html.match(/<header class="world-info"[\s\S]*?<\/header>/)[0];
  assert.deepEqual([...header.matchAll(/^ {6}<(\w+)[^>]*?(?:id|class)="([^"]+)"/gm)].map(match => match[2]), ['pause', 'map-frame', 'map-plate']);
  for (const id of ['location-title', 'minimap']) assert.match(header, new RegExp(`id="${id}"`));
  assert.match(header, /<ol class="map-zones"/);
  // No sound button and no tool row on the map any more.
  assert.doesNotMatch(header, /id="sound"|class="tools"|map-head/);
  // The stone frame moved from the whole block to the plate: the circle keeps its own pixel ring.
  assert.match(css, /\n\.quest::before, \.map-plate::before,/);
  assert.doesNotMatch(css, /\.world-info::before/);
});

test('«N» sits on the rim where north (−y) points on the map projection', () => {
  const map = adventureMapLayout({ world: OVERWORLD, player: { x: 0, y: 0 }, adventure: {} }, MAP_CELLS, MAP_CELLS);
  const a = map.project(0, 0), b = map.project(0, -1);
  const north = Math.atan2(b.y - a.y, b.x - a.x);
  const label = rule(css, '.map-north');
  const top = Number(label.match(/top: calc\(var\(--u\) \* (\d+)\);/)[1]), left = Number(label.match(/left: calc\(var\(--u\) \* (\d+)\);/)[1]);
  // The label is about 5 × 6.5 cells (one capital at --fs, line-height 1); its centre in cells from the circle centre:
  const dx = left + 2.5 - MAP_CELLS / 2, dy = top + 3.25 - MAP_CELLS / 2;
  const off = Math.abs(Math.atan2(dy, dx) - north);
  assert.ok(Math.min(off, 2 * Math.PI - off) < Math.PI / 18, `«N» within 10° of north: ${(off * 180 / Math.PI).toFixed(1)}°`);
  const reach = Math.hypot(dx, dy);
  assert.ok(reach > MAP_CELLS / 2 - 12 && reach < MAP_CELLS / 2 - 4, 'near the rim, inside the ring');
});

test('the phone map view: circle and plate side by side at 2×, so the circle fits 390 px; the pause button hides', () => {
  const view = rule(mobile, 'html.touch-ui body.menu-open.touch-map .world-info');
  const [, mapCells, plateCells] = view.match(/grid-template-columns: calc\(var\(--u\) \* (\d+)\) calc\(var\(--u\) \* (\d+)\);/).map(Number);
  assert.equal(mapCells, MAP_CELLS);
  assert.match(view, /grid-template-areas: "map plate";/);
  assert.match(view, /transform: translate\(-50%, -50%\) scale\(2\);/);
  const u = 2;
  assert.ok(MAP_CELLS * u * 2 <= 390 - 2 * 44, 'the circle at 2× fits under the phone safe areas');
  assert.ok((mapCells + 2 + plateCells) * u * 2 <= 844 - 2 * 47, 'circle, gap and plate fit beside the notch');
  assert.match(mobile, /\nhtml\.touch-ui body\.touch-map \.world-info #pause \{ display: none; \}/);
});

test('the compact phone disc clears the top HUD, thumb controls and the monk at the three phone sizes', async () => {
  const { touchLayout } = await import('../src/touch.js');
  const view = rule(mobile, 'html.touch-ui body:not(.menu-open):not(.minimap-off) .world-info');
  const sizeRule = rule(mobile, 'html.touch-ui body:not(.menu-open) .map-frame');
  const size = Number(sizeRule.match(/width: calc\(var\(--u\) \* (\d+)\)/)[1]) * 2;
  const top = Number(view.match(/top: calc\(var\(--safe-top\) \+ var\(--u\) \* (\d+)\)/)[1]) * 2;
  const left = Number(view.match(/left: calc\(var\(--safe-left\) \+ var\(--u\) \* (\d+)\)/)[1]) * 2;
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  for (const [width, height] of [[844, 390], [932, 430], [667, 375]]) for (const safe of [{ top: 0, right: 0, bottom: 0, left: 0 }, { top: 0, right: 47, bottom: 21, left: 47 }]) {
    const map = { x: safe.left + left, y: safe.top + top, width: size, height: size };
    assert.ok(map.x >= safe.left && map.x + size <= width - safe.right);
    assert.ok(map.y >= 106, 'below the HP plate and the low-health line');
    assert.ok(map.x + size < width / 2 - 80, 'leaves the monk and nearby enemies clear');
    const layout = touchLayout({ width, height, safe, u: 2 });
    for (const button of Object.values(layout.buttons)) {
      assert.equal(overlaps(map, { x: button.x - button.size / 2, y: button.y - button.size / 2, width: button.size, height: button.size }), false);
    }
    assert.ok(map.y + size <= height - safe.bottom - 136, 'above the resting joystick');
  }
});
