import test from 'node:test';
import assert from 'node:assert/strict';
import * as loot from '../src/loot-glow.js';

const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test('near labels include the six-unit boundary; desktop Alt reveals distant items', () => {
  assert.equal(typeof loot.lootLabelVisible, 'function');
  const hero = { x: 0, y: 0 };
  assert.equal(loot.lootLabelVisible({ x: 6, y: 0 }, hero), true);
  assert.equal(loot.lootLabelVisible({ x: 6.01, y: 0 }, hero), false);
  assert.equal(loot.lootLabelVisible({ x: 20, y: 0 }, hero, { alt: true }), true);
  assert.equal(loot.lootLabelVisible({ x: 6.01, y: 0 }, hero, { touch: true, alt: true }), false);
  assert.equal(loot.lootLabelVisible({ x: 3, y: 4 }, hero, { touch: true }), true);
});

test('a pile of labels stays on screen without covering another label or the monk', () => {
  assert.equal(typeof loot.placeLootLabels, 'function');
  const monk = { x: 140, y: 95, width: 40, height: 70 };
  const labels = Array.from({ length: 6 }, (_, id) => ({ id: String(id), x: 160, y: 145, width: 120, height: 16 }));
  const placed = loot.placeLootLabels(labels, { width: 330, height: 230, blockers: [monk] });
  assert.equal(placed.length, 6);
  for (const [i, label] of placed.entries()) {
    assert.ok(label.x >= 2 && label.y >= 2 && label.x + label.width <= 328 && label.y + label.height <= 228);
    assert.equal(intersects(label, monk), false, 'the monk keeps his silhouette');
    for (const other of placed.slice(i + 1)) assert.equal(intersects(label, other), false, 'labels do not overlap');
  }
  assert.deepEqual(loot.placeLootLabels([...labels].reverse(), { width: 330, height: 230, blockers: [monk] }), placed);
});

test('labels at viewport edges fit the frame and a crowded viewport never overlaps', () => {
  assert.equal(typeof loot.placeLootLabels, 'function');
  const labels = [{ id: 'left', x: 0, y: 0, width: 90, height: 15 }, { id: 'right', x: 99, y: 99, width: 140, height: 15 }];
  const placed = loot.placeLootLabels(labels, { width: 100, height: 100 });
  assert.equal(placed.length, 2);
  assert.equal(intersects(placed[0], placed[1]), false);
  for (const label of placed) assert.ok(label.x >= 2 && label.x + label.width <= 98 && label.y >= 2 && label.y + label.height <= 98);
});

test('rarity light uses the HUD colours and common drops have no pillar', () => {
  assert.equal(typeof loot.lootLightState, 'function');
  assert.equal(loot.lootLightState('common', 0).color, '#eee0ce');
  assert.equal(loot.lootLightState('rare', 0).color, '#6dd6cb');
  assert.equal(loot.lootLightState('relic', 0).color, '#e5b66e');
  assert.equal(loot.lootLightState('unknown', 0).color, '#eee0ce');
  assert.equal(loot.lootLightState('common', 0).pillarHeight, 0);
  assert.ok(loot.lootLightState('rare', 0).pillarHeight >= 1.5);
  assert.ok(loot.lootLightState('relic', 0).pillarHeight <= 2);
  assert.ok(loot.lootLightState('common', 0).glowAlpha < loot.lootLightState('rare', 0).glowAlpha);
});

test('the light pulses every two seconds and reduced motion stays steady', () => {
  assert.equal(typeof loot.lootLightState, 'function');
  assert.deepEqual(loot.lootLightState('rare', .1), loot.lootLightState('rare', 2.1));
  assert.notEqual(loot.lootLightState('rare', .1).glowAlpha, loot.lootLightState('rare', 1.1).glowAlpha);
  assert.deepEqual(loot.lootLightState('relic', 0, true), loot.lootLightState('relic', 1.1, true));
});

test('a drop rises in an arc, lands after .32 seconds and then settles', () => {
  assert.equal(typeof loot.lootDropPose, 'function');
  assert.equal(loot.lootDropPose(0).height, 0);
  assert.ok(loot.lootDropPose(.16).height >= .7);
  assert.equal(loot.lootDropPose(.32).height, 0);
  assert.equal(loot.lootDropPose(.32).shift, 0);
  assert.ok(loot.lootDropPose(.32).flash > 0);
  assert.equal(loot.lootDropPose(1).flash, 0);
  assert.deepEqual(loot.lootDropPose(.1, true), { height: 0, shift: 0, flash: 0 });
});

test('Alt uses the scene keyboard events, clears on blur, and detaches with the scene', async () => {
  const { NullEngine, Scene } = await import('@babylonjs/core');
  const { Renderer } = await import('../src/render.js');
  const engine = new NullEngine(), scene = new Scene(engine), view = { engine, scene };
  assert.equal(typeof Renderer.prototype.bindLootAlt, 'function');
  Renderer.prototype.bindLootAlt.call(view);
  const key = (type, code) => scene.onKeyboardObservable.notifyObservers({ event: { type, code } });
  key('keydown', 'AltLeft'); key('keydown', 'AltRight'); key('keyup', 'AltLeft');
  assert.equal(view.lootAlt.held, true);
  engine.onCanvasBlurObservable.notifyObservers(engine);
  assert.equal(view.lootAlt.held, false);
  key('keydown', 'AltLeft'); scene.dispose();
  assert.equal(view.lootAlt.held, false);
  key('keydown', 'AltRight');
  assert.equal(view.lootAlt.held, false);
  engine.dispose();
});

test('light draws whole-pixel marks and leaves actor silhouettes clear', () => {
  const marks = [], blocker = { x: 45, y: 30, width: 10, height: 24 };
  const context = { fillRect(x, y, width, height) { marks.push({ x, y, width, height }); } };
  loot.drawLootLight(context, { x: 50, y: 80, tipY: 20, unit: 32, rarity: 'rare', time: .5, blockers: [blocker] });
  assert.ok(marks.some(mark => mark.y < 30), 'the upright marker has a visible tip');
  assert.ok(marks.some(mark => mark.y >= 75 && mark.width >= 20), 'the item has a small ground pool');
  for (const mark of marks) {
    assert.ok(Object.values(mark).every(Number.isInteger));
    assert.equal(intersects(mark, blocker), false);
  }
  assert.equal(context.globalAlpha, 1);
});

test('a real loot-drop moves only its drawing and leaves pickup state and position untouched', async t => {
  const { NullEngine, Scene, ArcRotateCamera, Camera, Vector3 } = await import('@babylonjs/core');
  const { Renderer } = await import('../src/render.js');
  const { createItem } = await import('../src/items.js');
  const engine = new NullEngine({ renderWidth: 640, renderHeight: 400 }), scene = new Scene(engine);
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({ clearRect() {}, beginPath() {}, arc() {}, fill() {}, fillRect() {} }) });
  t.after(() => { scene.dispose(); engine.dispose(); });
  const camera = new ArcRotateCamera('test', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  Object.assign(camera, { mode: Camera.ORTHOGRAPHIC_CAMERA, orthoTop: 6.25, orthoBottom: -6.25, orthoLeft: -10, orthoRight: 10 });
  const ground = { id: 'arc', item: createItem({ id: 'arc', family: 'staff', rarity: 'common' }), x: 2, y: 3, source: 'bag', rearm: true };
  const game = { groundItems: [ground] }, original = JSON.stringify(game);
  const r = Object.assign(Object.create(Renderer.prototype), { scene, camera, width: 640, height: 400, assets: {},
    presentation: { effects: [] }, reducedMotion: false });
  r.updateGroundItems(game, 0);
  const rest = r.groundItems.get('arc').mesh.position.y;
  r.presentation.effects = [{ type: 'loot-drop', id: 'arc', age: .16 }];
  r.updateGroundItems(game, .16);
  assert.ok(r.groundItems.get('arc').mesh.position.y > rest + .7);
  r.presentation.effects[0].age = .32; r.updateGroundItems(game, .32);
  assert.equal(r.groundItems.get('arc').mesh.position.y, rest);
  assert.equal(JSON.stringify(game), original);
  game.groundItems = []; r.updateGroundItems(game, .4);
  assert.equal(r.groundItems.size, 0);
  assert.equal(scene.meshes.length, 0);
});

test('the minimap paints every visible drop in its rarity colour', async () => {
  const { Renderer } = await import('../src/render.js');
  const { createGame } = await import('../src/game.js');
  const game = createGame(), fills = [];
  game.enemies = [];
  game.groundItems = ['common', 'rare', 'relic'].map((rarity, i) => ({ id: `map-${i}`, x: game.player.x + i, y: game.player.y + 2, item: { rarity } }));
  const c = new Proxy({ canvas: { width: 360, height: 280 }, fillRect(x, y, width, height) { fills.push({ color: this.fillStyle, x, y, width, height }); } },
    { get(target, key) { return key in target ? target[key] : () => {}; } });
  Renderer.prototype.drawMap.call({ map: c }, game);
  assert.deepEqual(fills.filter(mark => mark.width === 3 && mark.height === 3).map(mark => mark.color), ['#eee0ce', '#6dd6cb', '#e5b66e']);
});

test('a blocked name uses a nearby side column instead of jumping to the top HUD', () => {
  const [label] = loot.placeLootLabels([{ id: 'near', x: 160, y: 170, width: 120, height: 16 }],
    { width: 330, height: 230, blockers: [{ x: 150, y: 40, width: 40, height: 145 }] });
  assert.ok(label.y > 100, `the nearby free column is closer than y=${label.y}`);
});

test('a pillar keeps a dark edge so its rarity colour stays visible on bright ground', () => {
  const marks = [], c = { fillRect(x, y, width, height) { marks.push({ x, y, width, height, ink: this.fillStyle, alpha: this.globalAlpha }); } };
  loot.drawLootLight(c, { x: 50, y: 80, tipY: 20, unit: 32, rarity: 'relic', time: 0 });
  assert.ok(marks.some(mark => mark.y < 60 && mark.ink === '#0d0a14' && mark.alpha >= .4));
  assert.ok(marks.some(mark => mark.y < 60 && mark.ink === '#e5b66e' && mark.alpha >= .5));
});

test('pile labels stay above their items even when a lower row would be closer', () => {
  const placed = loot.placeLootLabels([{ id: 'a', x: 80, y: 60, width: 100, height: 15 }, { id: 'b', x: 80, y: 60, width: 100, height: 15 }],
    { width: 200, height: 100, blockers: [{ x: 28, y: 2, width: 20, height: 30 }] });
  assert.equal(placed.length, 2);
  for (const label of placed) assert.ok(label.y + label.height < 60, 'the plate stays above the item');
});

test('the monk exclusion follows his drawn height during the crane leap', async () => {
  const { Renderer } = await import('../src/render.js');
  const game = { player: { x: 0, y: 0 }, enemies: [] };
  const view = { width: 640, height: 400, monk: { mesh: { position: { y: 0 } } }, pixelsPerUnit: () => 32,
    project: (x, y, height = 0) => ({ x: 320, y: 200 - height * 32 }) };
  const [rest] = Renderer.prototype.lootActorBoxes.call(view, game);
  view.monk.mesh.position.y = 1.1;
  const [jump] = Renderer.prototype.lootActorBoxes.call(view, game);
  assert.ok(Math.abs(rest.y - jump.y - 35.2) < 1e-9, 'name plates clear the airborne monk too');
});
