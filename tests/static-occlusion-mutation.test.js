import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene, ArcRotateCamera, Camera, Vector3, Matrix, Material } from '@babylonjs/core/index.js';
import { Renderer } from '../src/render.js';
import * as pixels from '../src/pixel-scene.js';
import { PresentationState } from '../src/pixel-animation.js';
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

test('stationary occlusion follows a replaced material and its subsequent alpha writes',async t=>{
 const {renderer:r,game}=await harness(t);let p;
 for(const candidate of r.world.props.filter(s=>s.mesh.renderingGroupId===1&&!s.noFade)){
  r.monk.mesh.position.set(candidate.mesh.position.x-.8,.025,candidate.mesh.position.z-.8);r.camera.target.set(candidate.mesh.position.x,.1,candidate.mesh.position.z-.7);r.updateOcclusion(game);
  p=r.world.props.find(s=>s.material.alpha===.25);if(p)break;
 }
 assert.ok(p,'fixture needs an actually faded prop');const old=p.material,replacement=old.clone('replacement');replacement.alpha=1;replacement.transparencyMode=1;p.material=replacement;p.mesh.material=replacement;
 r.updateOcclusion(game);assert.equal(replacement.alpha,.25,'replacement receives cached fade without actor movement');assert.equal(replacement.transparencyMode,Material.MATERIAL_ALPHABLEND);
 replacement.alpha=1;r.updateOcclusion(game);assert.equal(replacement.alpha,.25,'replacement has its own active opacity subscription');
});

test('occlusion reconciles opacity frame and material edits at subscription handoff',async t=>{
 const {renderer:r,game,scene}=await harness(t);let sprite;
 for(const candidate of r.world.props.filter(s=>s.mesh.renderingGroupId===1&&!s.noFade)){
  r.monk.mesh.position.set(candidate.mesh.position.x-.8,.025,candidate.mesh.position.z-.8);r.camera.target.set(candidate.mesh.position.x,.1,candidate.mesh.position.z-.7);r.updateOcclusion(game);
  sprite=r.world.props.find(s=>s.material.alpha===.25);if(sprite)break;
 }
 assert.ok(sprite);
 const replacement=sprite.material.clone('handoff');replacement.alpha=1;replacement.transparencyMode=Material.MATERIAL_ALPHATEST;
 sprite.material=replacement;sprite.mesh.material=replacement;
 const other=r.occlusionScratch.props.find(p=>p.sprite!==sprite&&p.sprite.atlas.frames?.length>1);
 other.sprite.frame=(other.frame+1)%other.sprite.atlas.frames.length;
 scene.onAfterRenderObservable.notifyObservers(scene);
 const until=Date.now()+3000;
 while(r.occlusionScratch.poll.size&&Date.now()<until)await new Promise(ok=>setTimeout(ok,5));
 assert.equal(r.occlusionScratch.poll.size,0);
 r.updateOcclusion(game);
 assert.equal(replacement.alpha,.25);assert.equal(other.frame,other.sprite.frame);
});
