import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Texture } from '@babylonjs/core';
import { Renderer, SHADOWS } from '../src/render.js';
import * as pixels from '../src/pixel-scene.js';
import { PresentationState, touchAimMarker, AUTO_AIM_CONE } from '../src/pixel-animation.js';
import { createGame } from '../src/game.js';
import { LOCATIONS } from '../src/campaign.js';
import { skillParams } from '../src/run-progress.js';
import { TOUCH_RULES, techniqueReach } from '../src/touch.js';

const SPIRIT = '#6dd6cb', NIGHT = '#0d0a14', IVORY = '#eee0ce', MUTED = '#b4aaba';
const preview = (game, skill, extra = {}) => ({ slot: 'q', skill, mode: 'manual', aimX: 0, aimY: 1, target: null, cancel: false,
  ...techniqueReach(skill, skillParams(game, skill)), ...extra });

test('the aim marker: the palm draws a line to its full reach, crane and bell a landing zone kept within min..max', () => {
  const game = createGame();
  Object.assign(game.player, { x: 2, y: 3, dx: 1, dy: 0 });
  assert.equal(AUTO_AIM_CONE, TOUCH_RULES.cone);
  const palm = touchAimMarker(game, preview(game, 'palm', { aimX: 3, aimY: 4 }));
  assert.equal(palm.kind, 'line'); assert.equal(palm.cone, 0, 'a dragged palm has no cone');
  assert.ok(Math.abs(palm.end.x - (2 + .6 * 7)) < 1e-9 && Math.abs(palm.end.y - (3 + .8 * 7)) < 1e-9, 'the line runs the whole 7u');
  assert.equal(touchAimMarker(game, preview(game, 'palm', { mode: 'auto' })).cone, 60, 'rule A shows its ±60° cone');
  for (const [length, reach] of [[3, 3], [.4, 1.5], [12, 5]]) {
    const crane = touchAimMarker(game, preview(game, 'crane', { aimX: 0, aimY: length }));
    assert.equal(crane.kind, 'point');
    assert.ok(Math.abs(crane.end.y - (3 + reach)) < 1e-9, `aim ${length} lands at ${reach}`);
    assert.equal(crane.zone, skillParams(game, 'crane').radius);
    assert.deepEqual([crane.min, crane.max], [1.5, 5]);
  }
  const bell = touchAimMarker(game, preview(game, 'bell', { aimX: 0, aimY: 0 }));
  assert.deepEqual([bell.min, bell.zone, bell.dx, bell.dy], [0, skillParams(game, 'bell').radius, 1, 0], 'no aim: the monk faces it');
  assert.equal(touchAimMarker(game, preview(game, 'crane', { cancel: true })).cancel, true);
  // A drawn origin moves the whole marker with the blended monk.
  const drawn = touchAimMarker(game, preview(game, 'palm'), { x: 2.5, y: 3 });
  assert.deepEqual([drawn.x, drawn.end.x], [2.5, 2.5]);
});

function harness(t) {
  const engine = new NullEngine({ renderWidth: 720, renderHeight: 450 });
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() {},
  }) });
  const scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const camera = new ArcRotateCamera('touch-camera', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -720 / 64, orthoRight: 720 / 64, orthoTop: 450 / 64, orthoBottom: -450 / 64 });
  const assets = Object.fromEntries(Object.entries(pixels.pixelAtlases).map(([name, a]) => [name, { ...a, texture: new Texture(null, scene) }]));
  const location = LOCATIONS.road, game = createGame();
  Object.assign(game, { world: location, locationId: location.id, locationRevision: 0, projectiles: [],
    adventure: { quest: 'outbound', secretFound: false, rewardCollected: false, visited: [location.id] } });
  Object.assign(game.player, location.spawn);
  game.enemies = [{ ...game.enemies[0], id: 'h1', x: game.player.x + 3, y: game.player.y, hp: 64 }];
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    engine, scene, camera, assets, game, width: 720, height: 450, locationRevision: 0,
    followTarget: camera.target.clone(), shake: 0, reducedMotion: false,
    presentation: new PresentationState(game), fxSprites: new Map(),
    world: pixels.buildPixelWorld(scene, assets, location),
    monk: pixels.createSprite(scene, 'monk', assets.monk), monkShadow: pixels.createShadow(scene, 'monk-shadow'),
    hounds: game.enemies.map(e => ({ id: e.id, kind: 'hound', body: e, sprite: pixels.createSprite(scene, `h-${e.id}`, assets.hound),
      shadow: pixels.createShadow(scene, `s-${e.id}`), warning: null })),
    drawMap() {},
  });
  // A 2D context that records every pixel mark with its colour and alpha.
  const marks = [], calls = [];
  const state = { fillStyle: '', globalAlpha: 1 };
  renderer.ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
      return (...args) => {
        assert.ok(args.every(value => typeof value !== 'number' || Number.isFinite(value)), `${String(key)} got a non-finite value`);
        calls.push(key);
        if (key === 'fillRect') marks.push({ x: args[0], y: args[1], w: args[2], h: args[3], color: target.fillStyle, alpha: target.globalAlpha });
      };
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  r0(renderer, game);
  return { renderer, game, marks, calls, draw() { marks.length = 0; calls.length = 0; Renderer.prototype.drawOverlay.call(renderer, game, 0, 'playing'); } };
}
const r0 = (renderer, game) => renderer.render(game, 0);
const colored = (marks, color) => marks.filter(mark => mark.color === color);

test('null hides everything; the palm draws whole-pixel --spirit dashes on a --night outline to its full reach', t => {
  const h = harness(t), { renderer: r, game } = h;
  r.setTouchView(null);
  h.draw();
  assert.equal(colored(h.marks, SPIRIT).length + colored(h.marks, IVORY).length, 0);
  r.setTouchView({ preview: preview(game, 'palm', { aimX: 1, aimY: 1 }), markedTarget: null });
  h.draw();
  const line = colored(h.marks, SPIRIT).filter(mark => mark.alpha === 1);
  assert.ok(line.length > 40, 'the dashed line');
  assert.ok(line.every(mark => mark.w === 1 && mark.h === 1 && Number.isInteger(mark.x) && Number.isInteger(mark.y)), '1 px marks on whole pixels');
  assert.ok(colored(h.marks, NIGHT).every(mark => mark.w === 3 && mark.h === 3) && colored(h.marks, NIGHT).length >= line.length, 'every dash pixel has its outline');
  // The far end of the line sits where the 7u reach projects.
  const at = r.groundAnchor(game.player.x, game.player.y), tip = r.project(at.x + 7 * Math.SQRT1_2, at.y + 7 * Math.SQRT1_2, .03);
  const far = line.reduce((best, mark) => Math.hypot(mark.x - tip.x, mark.y - tip.y) < Math.hypot(best.x - tip.x, best.y - tip.y) ? mark : best);
  assert.ok(Math.hypot(far.x - tip.x, far.y - tip.y) <= 2, `line tip ${far.x},${far.y} vs ${tip.x},${tip.y}`);
  // The dashed reach ring sits at 7u too, fainter.
  assert.ok(colored(h.marks, SPIRIT).some(mark => mark.alpha < 1));
  r.setTouchView(null);
  h.draw();
  assert.equal(colored(h.marks, SPIRIT).length, 0, 'null hides it again');
});

test('ground offsets match the camera projection, so rings and lines land on the real ground points', t => {
  const { renderer: r, game } = harness(t);
  const at = r.groundAnchor(game.player.x, game.player.y), origin = r.project(at.x, at.y, .03);
  for (const [wx, wy] of [[1, 0], [0, 1], [-2, 3], [4, -4], [5, 5]]) {
    const offset = r.groundOffset(origin, wx, wy), real = r.project(at.x + wx, at.y + wy, .03);
    assert.ok(Math.hypot(offset.x - real.x, offset.y - real.y) <= 1, `${wx},${wy}`);
  }
});

test('crane: a landing zone at the aimed distance, a min ring, and the grey cancel state', t => {
  const h = harness(t), { renderer: r, game } = h;
  r.setTouchView({ preview: preview(game, 'crane', { aimX: 3, aimY: 0 }), markedTarget: null });
  h.draw();
  assert.ok(h.calls.includes('ellipse') && h.calls.includes('fill'), 'the zone is filled');
  const zone = colored(h.marks, SPIRIT).filter(mark => mark.alpha === 1);
  const at = r.groundAnchor(game.player.x, game.player.y), landing = r.project(at.x + 3, at.y, .03);
  const radius = skillParams(game, 'crane').radius * r.pixelsPerUnit();
  assert.ok(zone.some(mark => Math.abs(Math.hypot(mark.x - landing.x, (mark.y - landing.y) * 2) - radius) < 2), 'the 1u zone edge');
  assert.ok(colored(h.marks, SPIRIT).some(mark => Math.abs(mark.alpha - .35) < 1e-9), 'the 1.5u minimum ring');
  r.setTouchView({ preview: preview(game, 'crane', { aimX: 3, aimY: 0, cancel: true }), markedTarget: null });
  h.draw();
  assert.equal(colored(h.marks, SPIRIT).length, 0, 'over «Отмена» nothing stays --spirit');
  assert.ok(colored(h.marks, MUTED).length > 0 && colored(h.marks, MUTED).every(mark => mark.alpha <= .45 + 1e-9), 'grey and faded');
});

test('rule A target: 1u --ivory corners around the shadow of the marked or previewed enemy, never a dead one', t => {
  const h = harness(t), { renderer: r, game } = h, enemy = game.enemies[0];
  r.setTouchView({ preview: null, markedTarget: enemy.id });
  h.draw();
  const corners = colored(h.marks, IVORY);
  assert.ok(corners.length >= 20 && corners.every(mark => mark.w === 1 && mark.h === 1));
  const at = r.groundAnchor(enemy.x, enemy.y), s = r.project(at.x, at.y, .024), unit = r.pixelsPerUnit();
  const w = Math.round(SHADOWS.hound.radius * unit) + 2, h2 = Math.round(SHADOWS.hound.radius * unit / 2) + 2;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    assert.ok(corners.some(mark => mark.x === Math.round(s.x + sx * w) && mark.y === Math.round(s.y + sy * h2)), `corner ${sx},${sy}`);
  }
  r.setTouchView({ preview: preview(game, 'palm', { mode: 'auto', target: enemy, aimX: 3, aimY: 0 }), markedTarget: null });
  h.draw();
  assert.ok(colored(h.marks, IVORY).length >= 20, 'the preview target is marked too');
  assert.ok(colored(h.marks, SPIRIT).filter(mark => Math.abs(mark.alpha - .35) < 1e-9).length > 20, 'with rule A cone');
  enemy.hp = 0;
  r.setTouchView({ preview: null, markedTarget: enemy.id });
  h.draw();
  assert.equal(colored(h.marks, IVORY).length, 0);
});
