import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix } from '@babylonjs/core';
import { Renderer } from '../src/render.js';
import { loadPixelAssets, createSprite, buildPixelWorld } from '../src/pixel-scene.js';
import { LOCATIONS } from '../src/campaign.js';
import { isWalkable } from '../src/world.js';
import campPackage from '../assets/game/pixel-v5/camp/manifest.json' with { type: 'json' };

async function harness(t) {
  const engine = new NullEngine({ renderWidth: 640, renderHeight: 360 }), scene = new Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  t.mock.method(globalThis, 'fetch', async url => new Response(readFileSync(new URL(url))));
  const assets = loadPixelAssets(scene);
  await assets.ready;
  const camera = new ArcRotateCamera('camp-acceptance', Math.PI / 4, Math.PI / 3, 30, Vector3.Zero(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  Object.assign(camera, { orthoLeft: -10, orthoRight: 10, orthoTop: 360 / 64, orthoBottom: -360 / 64 });
  const world = buildPixelWorld(scene, assets, LOCATIONS.camp);
  const monk = createSprite(scene, 'monk', assets.monk);
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    scene, camera, assets, world, monk, hounds: [], width: 640, height: 360,
  });
  return { scene, camera, world, renderer, monk };
}

test('tent, pillar and tall stone masks reveal the hero at reachable rear approaches', async t => {
  const { renderer: r, world, monk } = await harness(t);
  // Reachable points deeper than the prop: straight behind it, or beside its far end.
  const rear = p => {
    const c = p.collider, w = c.halfWidth ?? c.radius, d = c.halfDepth ?? c.radius;
    return [{ x: c.x - w - .4, y: c.y - d - .4 }, { x: c.x - w - .45, y: c.y - d + .7 }, { x: c.x - w + .7, y: c.y - d - .45 }]
      .find(q => isWalkable(q.x, q.y, .23, LOCATIONS.camp)) ?? { x: NaN, y: NaN };
  };
  const tall = world.props.filter(p => p.placement?.collider && /^(tent-|ruin-pillar|outcrop-(cliff|cluster|wall)|cypress)/.test(p.placement.kind)
    && isWalkable(rear(p.placement).x, rear(p.placement).y, .23, LOCATIONS.camp));
  const kinds = new Set(tall.map(p => p.placement.kind));
  // Both tents back onto trees and stone as on the artboard; the pillars stand free.
  assert.ok(kinds.has('ruin-pillar'), 'exercise a reachable approach behind a ruined pillar');
  assert.ok([...kinds].some(kind => kind.startsWith('outcrop-') || kind.startsWith('cypress')), 'exercise a tall stone mass or tree');
  let faded = 0;
  for (const prop of tall) {
    const p = prop.placement, behind = rear(p);
    monk.mesh.position.set(behind.x, .025, behind.y);
    r.updateOcclusion({ enemies: [] });
    if (p.kind === 'ruin-pillar' || p.kind.startsWith('tent-')) assert.equal(prop.material.alpha, .25, `${p.id}: opaque artwork hides the hero`);
    if (prop.material.alpha === .25) faded++;
    monk.mesh.position.set(p.collider.x + 3, .025, p.collider.y + 3);
    r.updateOcclusion({ enemies: [] });
    assert.equal(prop.material.alpha, 1, `${p.id}: restore artwork once the hero is in front`);
  }
  assert.ok(faded >= 4);
});

test('authored flame root meets the base at their shared ground anchor', async t => {
  const { scene, camera, world } = await harness(t);
  scene.render();
  const fire = world.fires[0], assembly = campPackage.campfireAssembly;
  const projectPixel = (sprite, [x, y]) => {
    const local = new Vector3((x - sprite.atlas.anchor[0]) / 32, (sprite.atlas.anchor[1] - y) / 32, 0);
    return Vector3.Project(Vector3.TransformCoordinates(local, sprite.mesh.computeWorldMatrix(true)),
      Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(640, 360));
  };
  const flame = projectPixel(fire.sprite, assembly.flameRootInFlameCell);
  const base = projectPixel(fire.base, assembly.flameRootInBaseCell);
  assert.ok(Vector3.Distance(flame, base) < .01, 'base and flame must meet without an invented placement offset');
});
