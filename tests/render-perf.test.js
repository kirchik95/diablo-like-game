import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix } from '@babylonjs/core';
import { Renderer } from '../src/render.js';
import * as pixels from '../src/pixel-scene.js';
import { PresentationState } from '../src/pixel-animation.js';
import { obscuresSprite } from '../src/pixel-picking.js';
import { createAdventure } from '../src/game.js';

// The real loader, so props and actors carry their hit masks.
async function harness(t) {
  const engine = new NullEngine({ renderWidth: 633, renderHeight: 292 });
  engine.createCanvas = (width, height) => ({ width, height, getContext: () => ({
    clearRect() {}, beginPath() {}, arc() {}, stroke() {}, moveTo() {}, lineTo() {}, closePath() {}, fillRect() {},
  }) });
  const scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  const camera = new ArcRotateCamera('perf-camera', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  const half = [633 * 1.2 / 64, 292 * 1.2 / 64];
  Object.assign(camera, { orthoLeft: -half[0], orthoRight: half[0], orthoTop: half[1], orthoBottom: -half[1] });
  t.mock.method(globalThis, 'fetch', async url => new Response(readFileSync(new URL(url))));
  const assets = pixels.loadPixelAssets(scene);
  await assets.ready;
  const game = createAdventure({}, { seed: 7 });
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    engine, scene, camera, assets, game, width: 633, height: 292, locationRevision: game.locationRevision,
    followTarget: camera.target.clone(), shake: 0, reducedMotion: false,
    presentation: new PresentationState(game), fxSprites: new Map(),
    world: pixels.buildPixelWorld(scene, assets, game.world),
    monk: pixels.createSprite(scene, 'monk', assets.monk), monkShadow: pixels.createShadow(scene, 'monk-shadow'),
    hounds: [], drawOverlay() {}, drawMap() {},
  });
  renderer.hounds = game.enemies.map(e => renderer.createEnemy(e));
  return { renderer, game, scene };
}

// The previous occlusion pass, kept as the reference: every standing prop against every living actor.
function referenceOcclusion(r, game) {
  r.camera.getViewMatrix(true);
  r.scene.updateTransformMatrix(true);
  const transform = r.scene.getTransformMatrix(), viewport = r.camera.viewport.toGlobal(r.width, r.height);
  const spriteScale = r.height * r.camera.viewport.height / ((r.camera.orthoTop - r.camera.orthoBottom) * 32);
  const forward = r.camera.getForwardRay().direction;
  const actors = [r.monk, ...r.hounds.filter((_, i) => game.enemies[i].hp > 0).map(h => h.sprite)]
    .map(sprite => ({ sprite, origin: Vector3.Project(sprite.mesh.position, Matrix.Identity(), transform, viewport), depth: Vector3.Dot(sprite.mesh.position, forward) }));
  const result = new Map();
  for (const sprite of r.world.props.filter(Boolean)) {
    if (sprite.mesh.renderingGroupId === 0) continue;
    const origin = Vector3.Project(sprite.mesh.position, Matrix.Identity(), transform, viewport);
    const depth = Vector3.Dot(sprite.mesh.position, forward);
    const covered = actors.some(actor => depth < actor.depth && obscuresSprite(sprite, origin, actor.sprite, actor.origin, spriteScale));
    // Only what the screen shows has to match: off-screen props wait until they come into view.
    const { anchor, cell } = sprite.atlas, scale = spriteScale * Math.abs(sprite.mesh.scaling.x);
    const onScreen = origin.x + cell * scale > 0 && origin.x - cell * scale < r.width && origin.y + cell * scale > 0 && origin.y - anchor[1] * scale < r.height;
    if (onScreen) result.set(sprite, covered);
  }
  return result;
}

test('the fast occlusion pass fades exactly the on-screen props the full pass fades, wherever the camera and actors stand', async t => {
  const { renderer: r, game } = await harness(t);
  let checked = 0, faded = 0;
  // The monk walks behind props across all three areas; the camera follows as in the game.
  const spots = r.world.props.filter(p => p.placement?.collider && p.mesh.renderingGroupId !== 0).slice(0, 40)
    .flatMap(p => {
      const c = p.placement.collider, w = c.halfWidth ?? c.radius, d = c.halfDepth ?? c.radius;
      // Behind the prop (deeper from the camera) and in front of it.
      return [{ x: c.x - w - .4, y: c.y - d - .4 }, { x: c.x - w - .45, y: c.y - d + .7 }, { x: c.x + w + .5, y: c.y + d + .5 }];
    });
  spots.push(...game.enemies.slice(0, 10).map(e => ({ x: e.x + .4, y: e.y - .6 })));
  for (const spot of spots) {
    r.monk.mesh.position.set(spot.x, .025, spot.y);
    r.camera.target.set(spot.x, .1, spot.y - .7);
    game.enemies.forEach((e, i) => r.hounds[i].sprite.mesh.position.set(e.x, .025, e.y));
    const expected = referenceOcclusion(r, game);
    r.updateOcclusion(game);
    for (const [sprite, covered] of expected) {
      assert.equal(sprite.material.alpha, covered ? .25 : 1, `${sprite.mesh.name} with the monk at ${spot.x.toFixed(1)},${spot.y.toFixed(1)}`);
      checked++; if (covered) faded++;
    }
  }
  assert.ok(checked > 1000 && faded >= 10, `${checked} prop checks, ${faded} fades`);
});

test('static scenery is frozen once with its camera-facing matrices; moving pieces stay live', async t => {
  const { renderer: r, game, scene } = await harness(t);
  const billboard = r.world.props.find(p => p.mesh.billboardMode);
  const live = billboard.mesh.computeWorldMatrix(true).clone();
  r.render(game, 0);
  assert.ok(r.world.frozen);
  assert.ok(billboard.mesh.isWorldMatrixFrozen);
  assert.ok(billboard.mesh.getWorldMatrix().equalsWithEpsilon(live, 1e-6), 'the frozen billboard faces the camera as before');
  // The camera only translates, so a moved view keeps every frozen matrix right.
  r.camera.target.addInPlace(new Vector3(7, 0, -5));
  billboard.mesh.unfreezeWorldMatrix();
  const moved = billboard.mesh.computeWorldMatrix(true).clone();
  billboard.mesh.freezeWorldMatrix();
  assert.ok(moved.equalsWithEpsilon(live, 1e-6));
  const moving = [...r.world.fires.flatMap(f => f.flames ?? []), r.world.reward?.bead, r.world.secret?.lid].filter(Boolean);
  assert.ok(moving.every(mesh => !mesh.isWorldMatrixFrozen), 'flames, bead and lid keep animating');
  assert.ok(scene.meshes.filter(mesh => mesh.isWorldMatrixFrozen).length > 500);
});

test('a hidden map is not drawn; a shown one is drawn every frame', async t => {
  const { renderer: r, game } = await harness(t);
  let drawn = 0;
  r.drawMap = () => { drawn++; };
  r.render(game, 1 / 60);
  assert.equal(drawn, 1, 'without an observer the map is drawn as before');
  r.mapShown = false;
  r.render(game, 1 / 60);
  assert.equal(drawn, 1);
  r.mapShown = true;
  r.render(game, 1 / 60);
  assert.equal(drawn, 2);
});
