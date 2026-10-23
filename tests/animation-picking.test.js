import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix, Texture } from '@babylonjs/core';
import { Renderer } from '../src/render.js';
import { createSprite, setSpriteFrame, pixelAtlases, pixelAssetUrls } from '../src/pixel-scene.js';
import { createGame } from '../src/game.js';
import { houndPose } from '../src/pixel-animation.js';
import { decodeHitMask } from '../src/pixel-picking.js';
import { readPng } from './helpers/png.js';

test('v2 picking: real airborne front/back/mirrored bodies target the hound at an odd offset viewport', t => {
  const png = readPng(new URL(pixelAssetUrls.hound));
  const masks = JSON.parse(readFileSync(new URL('../assets/game/pixel-v2/hound-world/hit-masks.json', import.meta.url)));
  class ScaledEngine extends NullEngine { getHardwareScalingLevel() { return 2; } }
  const engine = new ScaledEngine({ renderWidth: 720, renderHeight: 450 });
  const scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const camera = new ArcRotateCamera('v2-picking', Math.PI / 4, Math.PI / 3, 30, new Vector3(0, .1, 0), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -720 / 64, orthoRight: 720 / 64, orthoTop: 450 / 64, orthoBottom: -450 / 64,
    minZ: .1, maxZ: 100 });
  const atlas = { ...pixelAtlases.hound, mask: decodeHitMask(masks['hound-v2.png']), texture: new Texture(null, scene) };
  const sprite = createSprite(scene, 'v2-hound', atlas);
  const game = createGame(), enemy = game.enemies[0];
  Object.assign(enemy, { x: 1.25, y: -1.5, state: 'leap', timer: .2, hit: false });
  sprite.mesh.position.set(enemy.x, .225, enemy.y);
  const rect = { width: 1441, height: 901, left: 137.25, top: 61.5 };
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    game, engine, scene, camera, hounds: [{ sprite }], canvas: { getBoundingClientRect: () => rect },
  });
  scene.render();

  function probe(x, y) {
    const world = Vector3.TransformCoordinates(new Vector3(
      (x + .5 - 48) / 32, (84 - y - .5) / 32, 0,
    ), sprite.mesh.computeWorldMatrix(true));
    const screen = Vector3.Project(world, Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(720, 450));
    const actual = renderer.screenToWorld(rect.left + screen.x * rect.width / 720, rect.top + screen.y * rect.height / 450);
    const direction = camera.target.subtract(camera.position);
    const floor = { x: world.x - world.y * direction.x / direction.y, y: world.z - world.y * direction.z / direction.y };
    return { actual, floor };
  }
  function assertPoint(actual, expected) {
    assert.ok(actual && Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-4,
      `got ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`);
  }
  function bodyPixel(frame) {
    let best, score = Infinity;
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
      if (png.alpha(frame % atlas.columns * 96 + x, Math.floor(frame / atlas.columns) * 96 + y) !== 255) continue;
      const distance = (x - 48) ** 2 + (y - 54) ** 2;
      if (distance < score) { best = [x, y]; score = distance; }
    }
    assert.ok(best, 'real frame must contain a body');
    return best;
  }
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
    Object.assign(enemy, { dx, dy });
    const pose = houndPose(enemy, atlas);
    setSpriteFrame(sprite, pose);
    const [x, y] = bodyPixel(pose.frame);
    assertPoint(probe(pose.flip ? 95 - x : x, y).actual, enemy);
    assert.equal(png.alpha(pose.frame % atlas.columns * 96, Math.floor(pose.frame / atlas.columns) * 96), 0);
    const padding = probe(pose.flip ? 95 : 0, 0);
    assertPoint(padding.actual, padding.floor);
  }
  enemy.hp = 0; enemy.state = 'dead';
  const corpse = houndPose(enemy, atlas, { deathAge: 1 });
  setSpriteFrame(sprite, corpse);
  const [x, y] = bodyPixel(corpse.frame), dead = probe(corpse.flip ? 95 - x : x, y);
  assertPoint(dead.actual, dead.floor);
});
