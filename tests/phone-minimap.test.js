import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../src/render.js';

function fixture() {
  const surfaces = [];
  const make = () => {
    const calls = [];
    const canvas = { width: 192, height: 192, ownerDocument: { createElement: make } };
    const c = { canvas, calls, globalAlpha: 1 };
    for (const name of ['beginPath','rect','fill','clearRect','drawImage','save','restore','clip','moveTo','lineTo','closePath','stroke','arc','strokeRect','fillRect']) {
      c[name] = (...args) => calls.push({ name, args, fill: c.fillStyle, stroke: c.strokeStyle, alpha: c.globalAlpha });
    }
    canvas.getContext = () => c;
    surfaces.push(c);
    return canvas;
  };
  const canvas = make(), renderer = Object.assign(Object.create(Renderer.prototype), { map: canvas.getContext('2d'), coarsePointer: true });
  const game = { world: { id: 'road', title: 'Road', tiles: [{ x: 0, y: 0 }, { x: 2, y: 0 }], portals: [],
    caches: [{ id: 'cache', x: 1, y: 0 }], shrines: [] }, player: { x: 0, y: 0 },
    enemies: [{ x: 1, y: 1, hp: 5, kind: 'wraith' }], adventure: { cachesFound: [] },
    groundItems: [{ x: 0, y: 1, item: { rarity: 'common' } }] };
  return { renderer, game, surfaces };
}

test('phone frames reuse static terrain and ring across motion, invalidate on resize and world replacement', () => {
  const { renderer: r, game: g, surfaces } = fixture();
  r.drawMap(g);
  assert.equal(surfaces.length, 3, 'one terrain atlas and one rim surface');
  const staticCalls = surfaces.slice(1).map(c => c.calls.length);
  g.player.x = .1;
  r.drawMap(g);
  assert.deepEqual(surfaces.slice(1).map(c => c.calls.length), staticCalls, 'no static drawing on a later frame');
  assert.equal(surfaces.length, 3, 'no new canvases during motion');
  r.map.canvas.width = r.map.canvas.height = 288;
  r.drawMap(g);
  assert.equal(surfaces.length, 5, 'resized map rebuilds its two surfaces');
  g.world = { ...g.world };
  r.drawMap(g);
  assert.equal(surfaces.length, 7, 'a different run rebuilds its surfaces');
});

test('phone markers follow live deaths, loot removal and cache use without rebuilding the terrain', () => {
  const { renderer: r, game: g, surfaces } = fixture();
  r.drawMap(g);
  assert.ok(r.map.calls.some(call => call.name === 'arc' && call.fill === '#a5e8e0'), 'living spirit dot');
  assert.ok(r.map.calls.some(call => call.name === 'fillRect' && call.args[2] === 3), 'loot dot');
  r.map.calls.length = 0;
  g.enemies[0].hp = 0; g.groundItems.length = 0; g.adventure.cachesFound.push('cache');
  r.drawMap(g);
  assert.ok(!r.map.calls.some(call => call.name === 'arc' && call.fill === '#a5e8e0'), 'dead spirit disappears');
  assert.ok(!r.map.calls.some(call => call.name === 'fillRect' && call.args[2] === 3), 'picked-up loot disappears');
  assert.ok(r.map.calls.some(call => call.name === 'strokeRect' && call.stroke === '#8a9b91' && call.alpha === .3), 'used cache updates immediately');
  assert.equal(surfaces.length, 3);
});
