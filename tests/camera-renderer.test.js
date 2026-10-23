import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix, Material } from '@babylonjs/core';
import { Renderer, warningShape } from '../src/render.js';
import { createGame } from '../src/game.js';
import { loadPixelAssets, createSprite, createShadow, buildPixelWorld, setSpriteFrame, pixelAssetUrls } from '../src/pixel-scene.js';
import { PresentationState } from '../src/pixel-animation.js';
import { opaqueSpritePixel, obscuresSprite } from '../src/pixel-picking.js';
import { MotionHistory } from '../src/render-interpolation.js';
import { readPng } from './helpers/png.js';

const pngs = Object.fromEntries(['hound', 'wraith', 'monk', 'camp'].map(name => [name, readPng(new URL(pixelAssetUrls[name]))]));
const close = (actual, expected, message, tolerance = 1e-4) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${message}: ${actual} instead of ${expected}`);
const pointClose = (actual, expected, message) => {
  assert.ok(actual, message);
  close(actual.x, expected.x, `${message} x`); close(actual.y, expected.y, `${message} y`);
};

function context(operations = []) {
  return new Proxy({}, { get(target, name) {
    if (name in target) return target[name];
    return (...args) => {
      operations.push([name, ...args]);
      if (name === 'createRadialGradient') return { addColorStop() {} };
    };
  } });
}

async function harness(t, viewportWidth = 1441, viewportHeight = 901) {
  const viewport = { clientWidth: viewportWidth, clientHeight: viewportHeight };
  const oldDocument = globalThis.document;
  globalThis.document = { documentElement: viewport };
  t.after(() => { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; });
  const operations = [], ctx = context(operations);
  const canvas = { style: {}, getBoundingClientRect: () => ({
    left: 137.25 + Number.parseFloat(canvas.style.left), top: 61.5 + Number.parseFloat(canvas.style.top),
    width: Number.parseFloat(canvas.style.width), height: Number.parseFloat(canvas.style.height),
  }) };
  const overlay = { style: {} };
  const engine = new NullEngine({ renderWidth: 720, renderHeight: 450 }), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  // NullEngine has no browser canvas. Model only its external resize/HiDPI contract;
  // all camera matrices, billboards, materials and projection remain real Babylon.
  let width = 720, height = 450, hardwareScale = 1;
  engine.setHardwareScalingLevel = value => { hardwareScale = value; };
  engine.getHardwareScalingLevel = () => hardwareScale;
  engine.resize = () => {
    width = Math.floor(Number.parseFloat(canvas.style.width) / hardwareScale);
    height = Math.floor(Number.parseFloat(canvas.style.height) / hardwareScale);
    canvas.width = width; canvas.height = height;
  };
  engine.getRenderWidth = () => width; engine.getRenderHeight = () => height;
  engine.createCanvas = (w, h) => ({ width: w, height: h, getContext: () => context() });
  t.mock.method(globalThis, 'fetch', async url => new Response(readFileSync(new URL(url))));
  const assets = loadPixelAssets(scene); await assets.ready;
  const camera = new ArcRotateCamera('wider-camera', Math.PI / 4, Math.PI / 3, 30, new Vector3(0, .1, 0), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA; camera.minZ = .1; camera.maxZ = 100;
  const game = createGame(); game.enemies = [game.enemies[0]];
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    engine, scene, camera, assets, game, canvas, overlay, ctx, width, height,
    world: buildPixelWorld(scene, assets), locationRevision: game.locationRevision,
    monk: createSprite(scene, 'camera-monk', assets.monk), monkShadow: createShadow(scene, 'camera-shadow'),
    presentation: new PresentationState(game), fxSprites: new Map(),
    followTarget: camera.target.clone(), shake: 0, reducedMotion: true,
    drawOverlay() {}, drawMap() {},
  });
  renderer.hounds = game.enemies.map(enemy => renderer.createEnemy(enemy));
  renderer.resize(); scene.render();
  return { renderer, game, viewport, operations };
}

function widerView(r) {
  // Independent camera fixture: picking must work even without Renderer.resize.
  Object.assign(r.camera, { orthoLeft: -r.width * 1.2 / 64, orthoRight: r.width * 1.2 / 64,
    orthoTop: r.height * 1.2 / 64, orthoBottom: -r.height * 1.2 / 64 });
  r.scene.render();
}

function project(r, world) {
  return Vector3.Project(world, Matrix.Identity(), r.scene.getTransformMatrix(), r.camera.viewport.toGlobal(r.width, r.height));
}

function pixelPoint(r, sprite, x, y) {
  const { cell, anchor } = sprite.atlas;
  const world = Vector3.TransformCoordinates(new Vector3((x + .5 - cell / 2) / 32, (anchor[1] - y - .5) / 32, 0),
    sprite.mesh.computeWorldMatrix(true));
  return { world, screen: project(r, world) };
}

function sourceOpaque(sprite, png, x, y) {
  const { cell, columns } = sprite.atlas;
  if (x < 0 || y < 0 || x >= cell || y >= cell) return false;
  if (sprite.flip) x = cell - 1 - x;
  return png.alpha(sprite.frame % columns * cell + x, Math.floor(sprite.frame / columns) * cell + y) >= 128;
}

function edgePixels(sprite, png) {
  const result = [[0, 0]], { cell } = sprite.atlas;
  for (let y = 1; y < cell; y += 7) {
    for (let x = 1; x < cell; x++) {
      if (sourceOpaque(sprite, png, x - 1, y) !== sourceOpaque(sprite, png, x, y)) {
        result.push([x - 1, y], [x, y]);
      }
    }
  }
  assert.ok(result.length > 10, 'probe both sides of real silhouette edges');
  return result;
}

for (const [width, height, framebufferWidth, framebufferHeight] of [
  [801, 601, 400, 300], [1441, 901, 720, 450], [2561, 1081, 853, 360],
]) {
  test(`camera resize: ${width}x${height} shows 20% more world with integer canvas scaling`, async t => {
    const { renderer: r } = await harness(t, width, height);
    assert.equal(r.width, framebufferWidth); assert.equal(r.height, framebufferHeight);
    close(r.camera.orthoRight - r.camera.orthoLeft, framebufferWidth * .0375, 'horizontal world span');
    close(r.camera.orthoTop - r.camera.orthoBottom, framebufferHeight * .0375, 'vertical world span');
    assert.equal(r.camera.alpha, Math.PI / 4); assert.equal(r.camera.beta, Math.PI / 3); assert.equal(r.camera.radius, 30);
    const scale = r.engine.getHardwareScalingLevel(), rect = r.canvas.getBoundingClientRect();
    assert.ok(Number.isInteger(scale)); assert.equal(rect.width / r.width, scale); assert.equal(rect.height / r.height, scale);
    assert.deepEqual(r.overlay.style, r.canvas.style); assert.equal(r.overlay.width, r.width); assert.equal(r.overlay.height, r.height);
    assert.equal(r.ctx.imageSmoothingEnabled, false);
    const center = project(r, new Vector3(0, 0, 0)), right = project(r, new Vector3(-Math.SQRT1_2, 0, Math.SQRT1_2));
    close(right.x - center.x, 80 / 3, 'one world unit in framebuffer pixels');
    for (const p of [new Vector3(0, 0, 0), new Vector3(2.25, 0, -3.75)]) {
      const s = project(r, p);
      pointClose(r.screenToWorld(rect.left + s.x * scale, rect.top + s.y * scale), { x: p.x, y: p.z }, 'floor aim');
    }
  });
}

for (const name of ['hound', 'wraith']) {
  test(`wider camera: real ${name} alpha edges pick correctly after mirroring, scaling and HiDPI conversion`, async t => {
    const { renderer: r, game } = await harness(t); widerView(r);
    const sprite = createSprite(r.scene, `edge-${name}`, r.assets[name]);
    r.hounds = [{ sprite }];
    const enemy = game.enemies[0]; Object.assign(enemy, { x: 1.25, y: -1.5 });
    sprite.mesh.position.set(enemy.x, .225, enemy.y);
    // Deliberately disagree with nominal hardware scale, as on a CSS-scaled HiDPI canvas.
    const rect = { left: 137.25, top: 61.5, width: 1441, height: 901 };
    r.canvas.getBoundingClientRect = () => rect;
    r.engine.getHardwareScalingLevel = () => 2 / 3;
    for (const frame of [0, r.assets[name].columns + 2]) for (const flip of [false, true]) {
      setSpriteFrame(sprite, { frame, flip });
      for (const [sx, sy] of [[1, 1], [.5, .75], [1.5, 2]]) {
        sprite.mesh.scaling.set(sx, sy, 1); r.scene.render();
        const origin = project(r, sprite.mesh.position);
        const displayed = raster(r, sprite, pngs[name]);
        for (const [x, y] of edgePixels(sprite, pngs[name])) {
          const { screen, world } = pixelPoint(r, sprite, x, y), opaque = sourceOpaque(sprite, pngs[name], x, y);
          const message = `${name} frame ${frame} flip ${flip} scale ${sx},${sy} pixel ${x},${y}`;
          assert.equal(opaqueSpritePixel(sprite, origin, screen.x, screen.y, 1 / 1.2), opaque, message);
          // The helper stays continuous; renderer picking follows the displayed framebuffer cell.
          const displayedOpaque = displayed.opaque(Math.floor(screen.x) + .5, Math.floor(screen.y) + .5);
          const direction = r.camera.target.subtract(r.camera.position);
          const expected = displayedOpaque ? enemy : { x: world.x - world.y * direction.x / direction.y,
            y: world.z - world.y * direction.z / direction.y };
          pointClose(r.screenToWorld(rect.left + screen.x * rect.width / r.width, rect.top + screen.y * rect.height / r.height),
            expected, message);
        }
      }
    }
  });
}

// Build a screen-space raster from the independently decoded PNG and three
// projected mesh points. This does not use the picking helper's anchor/scale math.
function raster(r, sprite, png) {
  const p = pixelPoint(r, sprite, -.5, -.5).screen;
  const px = pixelPoint(r, sprite, .5, -.5).screen.subtract(p);
  const py = pixelPoint(r, sprite, -.5, .5).screen.subtract(p);
  const determinant = px.x * py.y - px.y * py.x;
  return { point(x, y) { return { x: p.x + px.x * (x + .5) + py.x * (y + .5), y: p.y + px.y * (x + .5) + py.y * (y + .5) }; },
    opaque(x, y) {
      const dx = x - p.x, dy = y - p.y;
      return sourceOpaque(sprite, png, Math.floor((dx * py.y - dy * py.x) / determinant), Math.floor((dy * px.x - dx * px.y) / determinant));
    } };
}

function coverage(r, front, back) {
  const a = raster(r, front, pngs.camp), b = raster(r, back, pngs.monk);
  let opaque = 0, covered = 0;
  for (let y = 0; y < back.atlas.cell; y++) for (let x = 0; x < back.atlas.cell; x++) {
    if (!sourceOpaque(back, pngs.monk, x, y)) continue;
    opaque++; const p = b.point(x, y); if (a.opaque(p.x, p.y)) covered++;
  }
  assert.ok(opaque > 0); return covered / opaque;
}

test('wider camera: real scaled camp art fades only where its projected opaque pixels cover the hero', async t => {
  const { renderer: r } = await harness(t); widerView(r);
  const prop = createSprite(r.scene, 'occluding-tent', r.assets.camp, r.assets.camp.frames.indexOf('tent-left'));
  assert.ok(prop.frame >= 0, 'real camp tent frame');
  prop.mesh.position.set(0, .03, 0); prop.mesh.scaling.set(1.5, 2, 1);
  r.world = { props: [prop] }; r.hounds = [];
  let clear = 0, covered = 0;
  for (const flip of [false, true]) {
    setSpriteFrame(prop, { frame: prop.frame, flip });
    for (const x of [-4, -3.5, -3, -2.5, -2, -1.5, -1, 0, 1, 1.5, 2, 2.5, 3, 3.5, 4]) {
      r.monk.mesh.position.set(-.7 - x, .025, -.7 + x); r.monk.mesh.scaling.set(.75, 1.25, 1);
      r.scene.render();
      const ratio = coverage(r, prop, r.monk);
      // Sampling at every third source pixel is deliberately approximate; test
      // only unambiguous overlaps, well away from the 15% fading threshold.
      if (ratio > .05 && ratio < .3) continue;
      const expected = ratio >= .3; if (expected) covered++; else clear++;
      const front = project(r, prop.mesh.position), back = project(r, r.monk.mesh.position);
      assert.equal(obscuresSprite(prop, front, r.monk, back, 1 / 1.2), expected, `flip ${flip}, x ${x}, PNG coverage ${ratio}`);
      r.updateOcclusion({ enemies: [] });
      assert.equal(prop.material.alpha, expected ? .25 : 1, `fade at flip ${flip}, x ${x}, PNG coverage ${ratio}`);
      assert.equal(prop.material.transparencyMode, expected ? Material.MATERIAL_ALPHABLEND : Material.MATERIAL_ALPHATEST);
    }
  }
  assert.ok(clear >= 2 && covered >= 2, `exercise both exposed and obscured hero: ${clear}/${covered}`);
});

test('wider camera: follow steps move the world by whole framebuffer pixels and resize preserves scene identity', async t => {
  const { renderer: r, game, viewport } = await harness(t);
  widerView(r); game.events = [{ type: 'impact', x: 0, y: 0 }];
  r.render(game, 0);
  const world = r.world, actors = [...r.hounds], effects = [...r.fxSprites.values()];
  const resources = [r.scene.meshes.length, r.scene.materials.length, r.scene.textures.length];
  let previous = project(r, Vector3.Zero());
  for (const [x, y] of [[.013, -.021], [.042, -.035], [.081, -.056], [.12, -.09]]) {
    Object.assign(game.player, { x, y }); r.render(game, .016);
    const current = project(r, Vector3.Zero());
    close(current.x - previous.x, Math.round(current.x - previous.x), 'camera horizontal pixel step');
    close(current.y - previous.y, Math.round(current.y - previous.y), 'camera vertical pixel step');
    previous = current;
  }
  for (const [width, height] of [[801, 601], [2561, 1081], [1441, 901]]) {
    viewport.clientWidth = width; viewport.clientHeight = height; r.resize(); r.render(game, 0);
    assert.equal(r.world, world); assert.deepEqual(r.hounds, actors); assert.deepEqual([...r.fxSprites.values()], effects);
    assert.deepEqual([r.scene.meshes.length, r.scene.materials.length, r.scene.textures.length], resources);
    close(r.width / (r.camera.orthoRight - r.camera.orthoLeft), 80 / 3, 'projection after resize');
  }
});

test('wider camera: ground rings, warning anchors and overlay light radius use the same projected units', async t => {
  const { renderer: r, game, operations } = await harness(t); r.render(game, 0);
  const fire = r.world.fires[0];
  Renderer.prototype.drawOverlay.call(r, game, 0, 'playing');
  const glow = operations.find(([name]) => name === 'createRadialGradient');
  assert.ok(glow); close(glow[6], 32, '1.2u glow radius at 26.6667 px/u');
  const center = r.project(fire.x, fire.y, .2); assert.deepEqual(glow.slice(1, 3), [center.x, center.y]);
  operations.length = 0;
  r.drawRing(0, 0, 1, .03, '#ffffff', 1);
  const vertices = operations.filter(([name]) => name === 'moveTo' || name === 'lineTo');
  const xs = vertices.map(([, x]) => x), ys = vertices.map(([, , y]) => y);
  close((Math.max(...xs) - Math.min(...xs)) / 2, 80 / 3, 'one-unit ground ring horizontal radius', 1);
  close((Math.max(...ys) - Math.min(...ys)) / 2, 40 / 3, 'one-unit ground ring vertical radius', 1);
  const enemy = game.enemies[0]; Object.assign(enemy, { state: 'windup', timer: .3, dx: 1, dy: 0 });
  r.updateEffects(game);
  const warning = r.hounds[0].warning;
  assert.equal(warning.mesh.isVisible, true);
  // The ground warning registers to the drawn (pixel-snapped) hound, not a sub-pixel body.
  const sprite = r.hounds[0].sprite.mesh.position;
  assert.deepEqual(warning.mesh.position.asArray(), [sprite.x, .035, sprite.z]);
  assert.ok(Math.hypot(sprite.x - enemy.x, sprite.z - enemy.y) < .05, 'snapping moves an anchor by under one pixel');
  assert.equal(warning.mesh.billboardMode, 0, 'warning stays on the ground');
});

test('pixel lattice: moving actors keep one sub-pixel phase, the followed monk holds still, simulation stays continuous', async t => {
  const { renderer: r, game } = await harness(t);
  const hound = game.enemies[0], view = r.hounds[0];
  // The open-world follow rule; the legacy courtyard camera only half-follows by design.
  r.cameraDestination = g => new Vector3(g.player.x, .1, g.player.y - .7);
  Object.assign(game.player, { x: 0, y: 0, dx: -Math.SQRT1_2, dy: Math.SQRT1_2 });
  Object.assign(hound, { x: 1.3, y: -2.1, state: 'chase', dx: 1, dy: 0 });
  r.snapCamera(game); r.render(game, 0);
  const phase = point => { const s = project(r, point); return [s.x - Math.floor(s.x), s.y - Math.floor(s.y)]; };
  const first = [r.monk.mesh.position, view.sprite.mesh.position, r.monkShadow.position, view.shadow.position].map(m => phase(m.clone()));
  const screens = [];
  for (let frame = 1; frame <= 120; frame++) {
    // Screen-right running at 5.4u/s and an awkward diagonal chase, both sub-pixel per frame.
    game.player.x -= 5.4 * Math.SQRT1_2 / 60; game.player.y += 5.4 * Math.SQRT1_2 / 60;
    game.player.moving = true; game.player.distance += 5.4 / 60;
    hound.x += .0173; hound.y -= .0291;
    r.render(game, 1 / 60);
    const phases = [r.monk.mesh.position, view.sprite.mesh.position, r.monkShadow.position, view.shadow.position].map(m => phase(m.clone()));
    // Phases compare on the unit circle: .9999 and 0 are the same pixel phase.
    const wrapped = (a, b) => a - b - Math.round(a - b);
    phases.forEach((value, i) => {
      close(wrapped(value[0], first[i][0]), 0, `frame ${frame} actor ${i} x phase`, 1e-3);
      close(wrapped(value[1], first[i][1]), 0, `frame ${frame} actor ${i} y phase`, 1e-3);
    });
    screens.push(project(r, r.monk.mesh.position.clone()));
    // Only the drawing is snapped: the simulated body keeps its exact position.
    close(Math.hypot(r.monk.mesh.position.x - game.player.x, r.monk.mesh.position.z - game.player.y), 0, 'monk anchor', .05);
  }
  close(game.player.x, -5.4 * 2 * Math.SQRT1_2, 'simulation x unchanged by rendering', 1e-9);
  // Drawn anchors keep a quarter-pixel bias from the camera lattice (the world origin's phase).
  const bias = phase(r.monk.mesh.position.clone())[0] - phase(Vector3.Zero())[0];
  close(bias - Math.round(bias - .25), .25, 'sampling bias away from texel edges', 1e-3);
  const settled = screens.slice(-40);
  assert.ok(settled.every(s => Math.abs(s.x - settled[0].x) < 1e-3 && Math.abs(s.y - settled[0].y) < 1e-3),
    'a steady follow must not wobble the monk by a pixel');
  // Real frames run a varying whole number of 1/120 s steps (here 1 or 3, two on average).
  const uneven = [];
  for (let frame = 0; frame < 80; frame++) {
    const travel = 5.4 / 120 * (frame % 2 ? 3 : 1);
    game.player.x -= travel * Math.SQRT1_2; game.player.y += travel * Math.SQRT1_2;
    r.render(game, 1 / 60);
    uneven.push(project(r, r.monk.mesh.position.clone()).x);
  }
  assert.ok(uneven.slice(-40).every(x => Math.abs(x - uneven.at(-1)) < 1e-3), 'uneven simulation steps must not wobble the monk');
  // The monk's shadow centre is under his anchor; the hound's follows its drawn body (x 44 of 48).
  const monkShadow = project(r, r.monkShadow.position.clone()), monk = project(r, r.monk.mesh.position.clone());
  close(monkShadow.x, monk.x, 'monk shadow under the feet', 1e-3);
  for (const flip of [false, true]) {
    hound.dx = flip ? 1 : 0; hound.dy = flip ? 0 : 1; r.render(game, 0);
    assert.equal(view.sprite.flip, flip);
    const offset = project(r, view.shadow.position.clone()).x - project(r, view.sprite.mesh.position.clone()).x;
    close(offset, (flip ? 1 : -1) * Math.round(4 * 80 / 3 / 32), `hound shadow registration, flip ${flip}`, 1e-3);
  }
});

test('a leaping hound rises by whole pixels while its contact shadow shrinks and fades, then lands', async t => {
  const { renderer: r, game } = await harness(t);
  const hound = game.enemies[0], view = r.hounds[0];
  Object.assign(hound, { x: .6, y: -.4, state: 'leap', timer: .135, dx: 1, dy: 0 });
  r.render(game, 0);
  const lift = (view.sprite.mesh.position.y - .025) * Math.sin(Math.PI / 3) * r.pixelsPerUnit();
  close(lift, Math.round(lift), 'jump height on the pixel lattice', 1e-6);
  assert.ok(lift > 5, `mid-leap height ${lift}px`);
  assert.ok(view.shadow.scaling.x < .85 && view.shadow.scaling.x === view.shadow.scaling.z, 'uniform shrink');
  assert.ok(view.shadow.visibility < .7 && view.shadow.visibility > .5);
  assert.equal(view.shadow.position.y, .024, 'the shadow stays on the floor');
  Object.assign(hound, { state: 'recover', timer: .7 }); r.render(game, 0);
  assert.deepEqual([view.sprite.mesh.position.y, view.shadow.scaling.x, view.shadow.visibility], [.025, 1, 1]);
});

// Render interpolation: main.js captures every body before each 1/120 s step and
// blends at accumulator / step; the renderer then snaps the blend to the lattice.
const STEP = 1 / 120;
const openWorldFollow = r => { r.cameraDestination = (g, p = g.player) => new Vector3(p.x, .1, p.y - .7); };
const screenPhase = (r, point) => { const s = project(r, point); return [s.x - Math.floor(s.x), s.y - Math.floor(s.y)]; };
const wrappedPhase = (a, b) => a - b - Math.round(a - b);

test('interpolation: actors, shadows, warnings, bars and the camera follow draw between steps, then snap to the lattice', async t => {
  const { renderer: r, game, operations } = await harness(t);
  const hound = game.enemies[0], view = r.hounds[0], followed = [];
  r.cameraDestination = (g, p = g.player) => { followed.push({ x: p.x, y: p.y }); return new Vector3(p.x, .1, p.y - .7); };
  Object.assign(game.player, { x: 0, y: 0 });
  Object.assign(hound, { x: 1.3, y: -2.1, state: 'windup', timer: .3, dx: 1, dy: 0, hp: hound.maxHp - 5 });
  r.snapCamera(game); r.render(game, 0);
  const motion = new MotionHistory(); motion.capture(game);
  // One long step each, so the blends land on many different pixels.
  game.player.x -= .29; game.player.y += .31; hound.x += .23; hound.y -= .17;
  let first, registration;
  for (const alpha of [0, .1, .25, .5, .62, .75, .9, 1]) {
    followed.length = 0; operations.length = 0;
    r.render(game, 1 / 60, 'playing', motion.blend(game, alpha));
    const monk = r.groundAnchor(-.29 * alpha, .31 * alpha), beast = r.groundAnchor(1.3 + .23 * alpha, -2.1 - .17 * alpha);
    close(r.monk.mesh.position.x, monk.x, `alpha ${alpha} monk x`, 1e-9); close(r.monk.mesh.position.z, monk.y, `alpha ${alpha} monk z`, 1e-9);
    close(r.monkShadow.position.x, monk.x, `alpha ${alpha} monk shadow x`, 1e-9); close(r.monkShadow.position.z, monk.y, `alpha ${alpha} monk shadow z`, 1e-9);
    close(view.sprite.mesh.position.x, beast.x, `alpha ${alpha} hound x`, 1e-9); close(view.sprite.mesh.position.z, beast.y, `alpha ${alpha} hound z`, 1e-9);
    assert.deepEqual(view.warning.mesh.position.asArray(), [view.sprite.mesh.position.x, .035, view.sprite.mesh.position.z]);
    const offset = view.shadow.position.subtract(view.sprite.mesh.position).asArray().map(v => +v.toFixed(9));
    registration ??= offset; assert.deepEqual(offset, registration, `alpha ${alpha}: shadow keeps its registration`);
    pointClose(followed[0], { x: -.29 * alpha, y: .31 * alpha }, `alpha ${alpha}: camera follows the blended monk`);
    // The enemy bar sits over the drawn sprite.
    Renderer.prototype.drawOverlay.call(r, game, 0, 'playing');
    const bar = operations.find(([name, , , width, height]) => name === 'fillRect' && width === 34 && height === 3);
    const top = r.project(beast.x, beast.y, 1.55);
    assert.deepEqual(bar.slice(1, 3), [top.x - 17, top.y], `alpha ${alpha}: HP bar over the drawn hound`);
    // Lattice snapping after the blend keeps one sub-pixel phase: same run key, same pixels.
    const phases = [r.monk.mesh.position, view.sprite.mesh.position, r.monkShadow.position].map(m => screenPhase(r, m.clone()));
    first ??= phases;
    phases.forEach((value, i) => value.forEach((v, j) => close(wrappedPhase(v, first[i][j]), 0, `alpha ${alpha} actor ${i} phase`, 1e-3)));
  }
  assert.equal(game.player.x, -.29, 'rendering never moves the simulated body');
});

test('interpolation: the beetle sector telegraph and windup ring follow the blended shell', async t => {
  const { renderer: r, game, operations } = await harness(t);
  const shell = game.enemies[0];
  Object.assign(shell, { kind: 'beetle', radius: .38, x: 1, y: -1, dx: 0, dy: 1, state: 'windup', timer: .2 });
  const motion = new MotionHistory(); motion.capture(game);
  shell.x += .3;
  r.motion = motion.blend(game, .5);
  operations.length = 0;
  Renderer.prototype.drawOverlay.call(r, game, 0, 'playing');
  const end = operations.findIndex(([name]) => name === 'closePath');
  const begin = operations.slice(0, end).map(([name]) => name).lastIndexOf('beginPath');
  const path = operations.slice(begin + 1, end).map(([, x, y]) => ({ x, y }));
  const blended = { ...shell, x: 1.15 };
  // warningShape itself is covered by beetle-renderer.test.js; here only its origin moves.
  assert.deepEqual(path, warningShape(blended, game.world).map(p => r.project(p.x, p.y, .03)));
});

test('interpolation: teleports, spawns, shots, restarts, area resets and deaths never smear', async t => {
  const { renderer: r, game } = await harness(t);
  const motion = new MotionHistory();
  const drawnAt = (mesh, x, y, message) => {
    const at = r.groundAnchor(x, y);
    close(mesh.position.x, at.x, `${message} x`, 1e-9); close(mesh.position.z, at.y, `${message} z`, 1e-9);
  };
  Object.assign(game.player, { x: 0, y: 0 }); r.render(game, 0);
  motion.capture(game);
  Object.assign(game.player, { x: -4, y: 3 });
  r.render(game, 0, 'playing', motion.blend(game, .5));
  drawnAt(r.monk.mesh, -4, 3, 'a 5u jump draws at its destination');
  // A spawn and a new spirit shot have no previous step yet.
  const spawned = { ...game.enemies[0], id: 'late', x: 2, y: -1 };
  game.enemies.push(spawned); game.projectiles = [{ id: 'shot-a', x: 1, y: 1, dx: 1, dy: 0, radius: .13 }];
  r.render(game, 0, 'playing', motion.blend(game, .5));
  drawnAt(r.hounds[1].sprite.mesh, 2, -1, 'a spawn draws where it is');
  drawnAt(r.projectiles.get('shot-a').mesh, 1, 1, 'a new shot draws where it is');
  // One normal step later they blend like everything else.
  motion.capture(game); game.projectiles[0].x += .05; spawned.x += .02;
  r.render(game, 0, 'playing', motion.blend(game, .5));
  drawnAt(r.projectiles.get('shot-a').mesh, 1.025, 1, 'the shot blends');
  drawnAt(r.hounds[1].sprite.mesh, 2.01, -1, 'the spawn blends');
  // A body that dies mid-step settles on its final spot and holds it.
  motion.capture(game); spawned.x += .02; spawned.hp = 0; spawned.state = 'dead';
  motion.capture(game);
  for (const alpha of [0, .5, 1]) {
    r.render(game, 0, 'playing', motion.blend(game, alpha));
    drawnAt(r.hounds[1].sprite.mesh, 2.03, -1, `alpha ${alpha}: the corpse holds its spot`);
  }
  // An area reset and a restarted run never blend from the old history.
  motion.capture(game); game.player.x += .4; game.locationRevision++;
  r.render(game, 0, 'playing', motion.blend(game, 0));
  drawnAt(r.monk.mesh, -3.6, 3, 'an area reset draws the current position');
  const fresh = createGame(); fresh.enemies = [fresh.enemies[0]]; Object.assign(fresh.player, { x: .7, y: -.4 });
  r.render(fresh, 0, 'playing', motion.blend(fresh, 0));
  drawnAt(r.monk.mesh, .7, -.4, 'a restart draws the new run');
});

test('interpolation: picking and occlusion use the drawn sprite, not the simulated body ahead of it', async t => {
  const { renderer: r, game } = await harness(t);
  const hound = game.enemies[0], view = r.hounds[0];
  Object.assign(game.player, { x: 0, y: 0 });
  Object.assign(hound, { x: 1.3, y: -2.1, state: 'chase', dx: 1, dy: 0 });
  r.snapCamera(game); r.render(game, 0);
  const motion = new MotionHistory(); motion.capture(game);
  hound.x -= .45; hound.y -= .55;
  r.render(game, 0, 'playing', motion.blend(game, 0));
  const rect = r.canvas.getBoundingClientRect(), spriteScale = r.pixelsPerUnit() / 32;
  const origin = project(r, view.sprite.mesh.position.clone());
  const body = r.groundAnchor(hound.x, hound.y);
  const ahead = project(r, new Vector3(body.x, view.sprite.mesh.position.y, body.y));
  let picked = 0, ghost = 0;
  for (let y = Math.floor(Math.min(origin.y, ahead.y)) - 44; y < Math.max(origin.y, ahead.y) + 6; y += 2) {
    for (let x = Math.floor(Math.min(origin.x, ahead.x)) - 30; x < Math.max(origin.x, ahead.x) + 30; x += 2) {
      const expected = opaqueSpritePixel(view.sprite, origin, x + .5, y + .5, spriteScale);
      const aim = r.screenToWorld(rect.left + (x + .5) * rect.width / r.width, rect.top + (y + .5) * rect.height / r.height);
      assert.equal(aim.x === hound.x && aim.y === hound.y, expected, `pixel ${x},${y}`);
      if (expected) picked++;
      else if (opaqueSpritePixel(view.sprite, ahead, x + .5, y + .5, spriteScale)) ghost++;
    }
  }
  assert.ok(picked > 30 && ghost > 30, `exercise drawn (${picked}) and undrawn body (${ghost}) pixels`);

  // Occlusion: the body sits at B in both frames; only the drawn monk moves from A to B.
  const prop = createSprite(r.scene, 'blended-tent', r.assets.camp, r.assets.camp.frames.indexOf('tent-left'));
  prop.mesh.position.set(0, .03, 0); prop.mesh.scaling.set(1.5, 2, 1);
  r.world.props = [prop]; hound.x = 30;
  const at = x => ({ x: -.7 - x, y: -.7 + x });
  let changed = 0;
  for (const x of [-3, -2.2, -1.5, 0, 1.5, 2.8, 3.5]) {
    Object.assign(game.player, at(x)); r.snapCamera(game); r.render(game, 0);
    const history = new MotionHistory(); history.capture(game);
    // .7 along x is a .99u step: still a blend, not a snap.
    Object.assign(game.player, at(x + .7));
    const outcomes = [];
    for (const alpha of [0, 1]) {
      r.render(game, 0, 'playing', history.blend(game, alpha));
      const ratio = coverage(r, prop, r.monk);
      if (ratio > .05 && ratio < .3) { outcomes.push(null); continue; }
      assert.equal(prop.material.alpha, ratio >= .3 ? .25 : 1, `x ${x} alpha ${alpha}: fade follows the drawn monk (coverage ${ratio})`);
      outcomes.push(ratio >= .3);
    }
    if (outcomes[0] !== null && outcomes[1] !== null && outcomes[0] !== outcomes[1]) changed++;
  }
  assert.ok(changed >= 1, 'a step crosses the fade edge between the two drawn positions');
});

test('interpolation: uneven 60 Hz and 144 Hz frames scroll the world and move a chasing hound evenly', async t => {
  const { renderer: r, game } = await harness(t);
  const hound = game.enemies[0], view = r.hounds[0];
  openWorldFollow(r);
  const run = (frame, jitter, blended) => {
    Object.assign(game.player, { x: 0, y: 0, dx: -Math.SQRT1_2, dy: Math.SQRT1_2, moving: true, distance: 0 });
    Object.assign(hound, { x: 1.3, y: -2.1, state: 'chase', dx: -.6, dy: .8 });
    r.snapCamera(game); r.render(game, 0);
    const motion = new MotionHistory();
    let accumulator = 0, time = 0, seed = 11;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const frames = [];
    while (time < 4) {
      const dt = frame * (1 + (random() * 2 - 1) * jitter);
      time += dt; accumulator += dt;
      while (accumulator >= STEP) {
        motion.capture(game);
        // The monk runs screen-right at 5.4 u/s; the hound chases at 1.75 u/s.
        game.player.x -= 5.4 * Math.SQRT1_2 * STEP; game.player.y += 5.4 * Math.SQRT1_2 * STEP; game.player.distance += 5.4 * STEP;
        hound.x += -.6 * 1.75 * STEP; hound.y += .8 * 1.75 * STEP;
        accumulator -= STEP;
      }
      r.render(game, dt, 'playing', blended ? motion.blend(game, accumulator / STEP) : undefined);
      const world = project(r, Vector3.Zero()), drawn = project(r, view.sprite.mesh.position.clone());
      frames.push({ time, dt, world, ground: drawn.subtract(world), screen: drawn, monk: project(r, r.monk.mesh.position.clone()) });
    }
    // After the follow's last hysteresis step (2.5 s), compare each series with exact even motion:
    // world = the scrolling ground, ground = the hound over that ground, screen = their sum.
    // `spread` is the peak-to-peak of x - v t (one whole-pixel rounding allows 1 px);
    // `rms` is the frame-to-frame displacement noise around v dt.
    const velocity = (x, y) => project(r, new Vector3(x, 0, y)).x - project(r, Vector3.Zero()).x;
    const speeds = { world: -velocity(-5.4 * Math.SQRT1_2, 5.4 * Math.SQRT1_2), ground: velocity(-.6 * 1.75, .8 * 1.75) };
    speeds.screen = speeds.world + speeds.ground;
    const settled = frames.filter(f => f.time > 2.5), result = {};
    for (const key of ['world', 'ground', 'screen']) {
      const residual = settled.map(f => f[key].x - speeds[key] * f.time);
      const moves = settled.slice(1).map((f, i) => f[key].x - settled[i][key].x - speeds[key] * f.dt);
      result[key] = { spread: +(Math.max(...residual) - Math.min(...residual)).toFixed(3),
        rms: +Math.sqrt(moves.reduce((sum, d) => sum + d * d, 0) / moves.length).toFixed(3),
        steps: [...new Set(settled.slice(1).map((f, i) => Math.round(f[key].x - settled[i][key].x)))].sort((a, b) => a - b) };
    }
    result.monk = Math.max(...settled.map(f => Math.hypot(f.monk.x - settled[0].monk.x, f.monk.y - settled[0].monk.y)));
    return result;
  };
  const numbers = {};
  for (const [name, frame, jitter] of [['60 Hz ±3%', 1 / 60, .03], ['144 Hz ±7%', 1 / 144, .07], ['60 Hz ±20%', 1 / 60, .2]]) {
    const before = run(frame, jitter, false), after = run(frame, jitter, true);
    numbers[name] = { before, after };
    assert.ok(after.monk < 1e-3, `${name}: the followed monk holds still (${after.monk} px)`);
    // Blended motion is exact, so only the whole-pixel rounding remains: 1 px, 2 px for the sum.
    assert.ok(after.world.spread <= 1.001 && after.ground.spread <= 1.001, `${name}: blended ${JSON.stringify(after)}`);
    assert.ok(after.screen.spread <= 2.001, `${name}: blended hound on screen ${JSON.stringify(after.screen)}`);
    // Without the blend, whole steps add up to 1.2 px (5.4 u/s for 1/120 s) of judder to the scroll.
    assert.ok(before.world.spread > 1.2 && before.world.rms > after.world.rms, `${name}: unblended ${JSON.stringify(before.world)}`);
  }
  t.diagnostic(`per-frame horizontal displacement, px: ${JSON.stringify(numbers)}`);
});
