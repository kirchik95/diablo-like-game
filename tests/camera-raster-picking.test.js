import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix } from '@babylonjs/core';
import { Renderer } from '../src/render.js';
import { loadPixelAssets, createSprite, setSpriteFrame, pixelAssetUrls } from '../src/pixel-scene.js';
import { readPng } from './helpers/png.js';

const pngs = Object.fromEntries(['hound', 'wraith'].map(kind => [kind, readPng(new URL(pixelAssetUrls[kind]))]));
const cursors = [[.1, .1], [.25, .25], [.5, .5], [.9, .9], [.1, .9], [.9, .1]];
const pointClose = (actual, expected, label) => assert.ok(actual
  && Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-4,
`${label}: ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`);

async function harness(t) {
  const engine = new NullEngine({ renderWidth: 720, renderHeight: 450 }), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  engine.getHardwareScalingLevel = () => 2;
  t.mock.method(globalThis, 'fetch', async url => new Response(readFileSync(new URL(url))));
  const assets = loadPixelAssets(scene); await assets.ready;
  const camera = new ArcRotateCamera('raster-camera', Math.PI / 4, Math.PI / 3, 30, new Vector3(0, .1, 0), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -720 * 1.2 / 64, orthoRight: 720 * 1.2 / 64,
    orthoTop: 450 * 1.2 / 64, orthoBottom: -450 * 1.2 / 64, minZ: .1, maxZ: 100 });
  const rect = { left: 137.25, top: 61.5, width: 1440, height: 900 };
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    engine, scene, camera, assets, width: 720, height: 450,
    game: { enemies: [] }, hounds: [], canvas: { getBoundingClientRect: () => rect },
  });
  scene.render();
  return { r: renderer, rect,
    actor(kind, x = 0, y = 0) {
      const sprite = createSprite(scene, `raster-${kind}-${renderer.hounds.length}`, assets[kind]);
      sprite.mesh.position.set(x, .025, y);
      const enemy = { x, y, hp: 64 };
      renderer.hounds.push({ sprite }); renderer.game.enemies.push(enemy);
      return { sprite, enemy };
    },
    pick(x, y) { return renderer.screenToWorld(rect.left + x * rect.width / 720, rect.top + y * rect.height / 450); },
  };
}

// Independent reference: invert three transformed mesh points and sample actual
// PNG alpha, not the hit mask or the production anchor/projection helper.
function raster(r, sprite, png) {
  const { cell, anchor, columns } = sprite.atlas, matrix = sprite.mesh.computeWorldMatrix(true);
  const project = (x, y) => Vector3.Project(Vector3.TransformCoordinates(
    new Vector3((x - cell / 2) / 32, (anchor[1] - y) / 32, 0), matrix),
  Matrix.Identity(), r.scene.getTransformMatrix(), r.camera.viewport.toGlobal(720, 450));
  const start = project(0, 0), end = project(cell, cell);
  const dx = project(1, 0).subtract(start), dy = project(0, 1).subtract(start);
  const det = dx.x * dy.y - dy.x * dx.y;
  return { left: Math.floor(start.x), top: Math.floor(start.y), right: Math.ceil(end.x), bottom: Math.ceil(end.y),
    sample(x, y) {
      const px = x - start.x, py = y - start.y;
      const u = (px * dy.y - py * dy.x) / det, v = (py * dx.x - px * dx.y) / det;
      let sx = Math.floor(u); const sy = Math.floor(v);
      const inside = sx >= 0 && sy >= 0 && sx < cell && sy < cell;
      if (sprite.flip) sx = cell - 1 - sx;
      const opaque = inside && png.alpha(sprite.frame % columns * cell + sx,
        Math.floor(sprite.frame / columns) * cell + sy) >= 128;
      const margin = Math.min(Math.abs(u - Math.round(u)), Math.abs(v - Math.round(v)));
      return { opaque, margin };
    } };
}

function ground(r, x, y) {
  const p = Vector3.Unproject(new Vector3(x, y, 0), 720, 450, Matrix.Identity(),
    r.scene.getViewMatrix(), r.scene.getProjectionMatrix());
  const direction = r.camera.target.subtract(r.camera.position);
  return { x: p.x - p.y * direction.x / direction.y, y: p.z - p.y * direction.z / direction.y };
}

for (const kind of ['hound', 'wraith']) test(`camera raster picking: ${kind} silhouette is stable within each displayed pixel`, async t => {
  const h = await harness(t), { r } = h, { sprite, enemy } = h.actor(kind);
  let misses = 0, ghosts = 0;
  for (const frame of [0, r.assets[kind].columns + 2]) for (const flip of [false, true]) {
    setSpriteFrame(sprite, { frame, flip });
    for (const [sx, sy, cssWidth, cssHeight, hardware] of [
      [1, 1, 1440, 900, 2], [.5, .75, 1441, 901, 2 / 3], [1.5, 2, 2160, 1350, 3],
    ]) {
      sprite.mesh.scaling.set(sx, sy, 1);
      Object.assign(h.rect, { width: cssWidth, height: cssHeight });
      r.engine.getHardwareScalingLevel = () => hardware;
      r.scene.render();
      const reference = raster(r, sprite, pngs[kind]), cases = [[], []];
      for (let y = reference.top; y < reference.bottom; y++) for (let x = reference.left; x < reference.right; x++) {
        const shown = reference.sample(x + .5, y + .5), corner = reference.sample(x + .25, y + .25);
        if (shown.margin < .05 || corner.margin < .05 || shown.opaque === corner.opaque) continue;
        const bucket = cases[Number(shown.opaque)];
        if (bucket.length < 12) bucket.push({ x, y, opaque: shown.opaque });
      }
      assert.ok(cases[0].length && cases[1].length, 'exercise transparent and opaque raster edges');
      ghosts += cases[0].length; misses += cases[1].length;
      for (const cell of cases.flat()) for (const [cx, cy] of cursors) {
        const x = cell.x + cx, y = cell.y + cy;
        pointClose(h.pick(x, y), cell.opaque ? enemy : ground(r, x, y),
          `${kind} frame ${frame} flip ${flip} scale ${sx},${sy} cell ${cell.x},${cell.y} cursor ${cx},${cy}`);
      }
    }
  }
  assert.ok(misses >= 12 && ghosts >= 12);
});

test('camera raster picking: transparent cells retain continuous ground aim at an offset CSS rectangle', async t => {
  const h = await harness(t);
  Object.assign(h.rect, { width: 1441, height: 901 });
  h.r.engine.getHardwareScalingLevel = () => 2 / 3;
  const results = [];
  for (const [cx, cy] of cursors) {
    const x = 368 + cx, y = 188 + cy, actual = h.pick(x, y);
    pointClose(actual, ground(h.r, x, y), 'continuous floor ray'); results.push(actual);
  }
  assert.ok(Math.hypot(results[0].x - results[3].x, results[0].y - results[3].y) > .03,
    'ground intersections must not snap together inside one displayed pixel');
});

test('camera raster picking: front opaque actor wins regardless of order, transparent or hidden front falls through', async t => {
  const h = await harness(t), { r } = h;
  const back = h.actor('hound', -.1, -.1), front = h.actor('hound', .1, .1);
  front.sprite.mesh.scaling.set(.85, .85, 1); setSpriteFrame(front.sprite, { frame: 0, flip: true });
  r.scene.render();
  assert.ok(Vector3.DistanceSquared(r.camera.position, front.sprite.mesh.position)
    < Vector3.DistanceSquared(r.camera.position, back.sprite.mesh.position));
  const a = raster(r, front.sprite, pngs.hound), b = raster(r, back.sprite, pngs.hound);
  let both, onlyBack;
  for (let y = b.top; y < b.bottom; y++) for (let x = b.left; x < b.right; x++) {
    const fa = a.sample(x + .5, y + .5), ba = b.sample(x + .5, y + .5);
    if (!ba.opaque || fa.margin < .05 || ba.margin < .05) continue;
    if (fa.opaque) both ??= { x, y }; else onlyBack ??= { x, y };
  }
  assert.ok(both, 'real silhouettes must provide an opaque overlap');
  assert.ok(onlyBack, 'real silhouettes must provide a transparent front gap');
  for (const order of [[front, back], [back, front]]) {
    r.game.enemies = order.map(a => a.enemy); r.hounds = order.map(a => ({ sprite: a.sprite }));
    for (const [cx, cy] of cursors) {
      pointClose(h.pick(both.x + cx, both.y + cy), front.enemy, 'nearest visible actor');
      pointClose(h.pick(onlyBack.x + cx, onlyBack.y + cy), back.enemy, 'transparent front');
      front.sprite.mesh.isVisible = false;
      pointClose(h.pick(both.x + cx, both.y + cy), back.enemy, 'hidden front');
      front.sprite.mesh.isVisible = true; front.enemy.hp = 0;
      pointClose(h.pick(both.x + cx, both.y + cy), back.enemy, 'dead front');
      front.enemy.hp = 64;
    }
  }
});
