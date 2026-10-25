import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { bakeStaticShadows, projectPoint, install } from '../src/hd2d/shadows.js';

// Breaks if the projection translates the foot along with the top.
test('moon and fire projections pin the foot and send the top away from the light', () => {
  const foot = { x: 2, y: 3 };
  const out = {};
  projectPoint(out, foot, 0, 0, .8, -.4);
  assert.deepEqual(out, { x: 2, y: 3 });
  projectPoint(out, foot, 0, 2, .8, -.4);
  assert.deepEqual(out, { x: 3.6, y: 2.2 });
  projectPoint(out, foot, 0, 2, -1, 0);
  assert.deepEqual(out, { x: 0, y: 3 });
});

function caster() {
  // 8x8: only a one-pixel trunk; a transparent cell must never cast a solid quad.
  const bytes = new Uint8Array(8); bytes.fill(0x18);
  return { atlas: { cell: 8, columns: 1, rows: 1, anchor: [4, 8], mask: { width: 8, bytes } },
    frame: 0, flip: false, mesh: { position: { x: 0, y: .03, z: 0 }, scaling: { x: 8, y: 8 } } };
}
const sample = (b, x, y) => b.data[Math.floor((y-b.bounds[1])*b.ppu)*b.width+Math.floor((x-b.bounds[0])*b.ppu)];
// Breaks if masks are ignored, projection is reversed, or the bake accumulates between worlds.
test('static bake follows alpha and moon direction and is deterministic', () => {
  const a = bakeStaticShadows([caster()], { minX: -4, minY: -4, maxX: 6, maxY: 6 }, 8);
  const b = bakeStaticShadows([caster()], { minX: -4, minY: -4, maxX: 6, maxY: 6 }, 8);
  assert.deepEqual(a.data, b.data);
  assert.ok(sample(a, .5, .2) > 0, 'trunk shadow must exist');
  assert.equal(sample(a, -2.5, 2.5), 0, 'transparent quad margin must remain clear');
  assert.equal(sample(a, -3, -3), 0, 'no shadow towards moon');
  assert.equal(bakeStaticShadows([], { minX: 0, minY: 0, maxX: 1, maxY: 1 }), null);
});
// Breaks if off installs a render pass, texture, mesh, observer, or alters original scene state.
test('off is lazy and dispose leaves the original scene untouched', () => {
  const engine = new NullEngine(); const scene = new Scene(engine);
  const camera = new FreeCamera('test', new Vector3(0, 10, 0), scene);
  const renderer = { world: null, hounds: [], game: {}, monk: null };
  const before = [scene.meshes.length, scene.materials.length, scene.textures.length, scene.customRenderTargets.length, scene.cameras.length];
  const effect = install({ scene, engine, camera, renderer, tier: 'off' });
  effect.update(1/60, 0); effect.setTier('off'); effect.onWorld(renderer); effect.dispose();
  assert.deepEqual([scene.meshes.length, scene.materials.length, scene.textures.length, scene.customRenderTargets.length, scene.cameras.length], before);
  scene.dispose(); engine.dispose();
});

// Breaks if switching off leaves a custom target or references disposed world materials.
test('low/high/off and world replacement release every owned GPU resource', async () => {
  const { ShaderMaterial } = await import('@babylonjs/core/Materials/shaderMaterial.js');
  const { RawTexture } = await import('@babylonjs/core/Materials/Textures/rawTexture.js');
  const engine = new NullEngine(); const scene = new Scene(engine);
  const camera = new FreeCamera('test', new Vector3(0, 10, 0), scene);
  const ground = new ShaderMaterial('ground', scene, '', {});
  const fallback = RawTexture.CreateRGBATexture(new Uint8Array([0,0,0,255]),1,1,scene);
  fallback.name = 'country-surface-mask'; ground.setTexture('surfaceMask',fallback);
  const renderer = { world: { landscape: { groundMaterial: ground }, props: [caster()], bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 }, data: { zones: [] } },
    hounds: [], game: { world: { zones: [] }, player: { hp: 10 } }, monk: null, assets: { monk: { mask: {} } } };
  const before = [scene.meshes.length,scene.materials.length,scene.textures.length,scene.cameras.length];
  const effect = install({ scene,engine,camera,renderer,tier:'low' });
  effect.update(); effect.setTier('high'); effect.update();
  assert.equal(scene.customRenderTargets.length, 1);
  effect.setTier('low'); assert.equal(scene.customRenderTargets.length, 0);
  assert.ok(ground.getActiveTextures().every(t=>t===fallback || t.name==='hd-static-moon-shadow'), 'receiver must not retain a disposed render target');
  effect.setTier('high'); effect.setTier('off');
  assert.ok(ground.getActiveTextures().every(t=>t===fallback), 'off receiver must not retain disposed baked textures');
  ground.dispose(); renderer.world = null; effect.onWorld(renderer);
  effect.setTier('off'); effect.dispose();
  assert.deepEqual([scene.meshes.length,scene.materials.length,scene.textures.length,scene.cameras.length], [before[0],before[1]-1,before[2],before[3]]);
  scene.dispose(); engine.dispose();
});

// Real host calls onWorld before Renderer.game changes: lights must follow the newly built world.
test('world rebuild takes fire sources from built world, not the previous game', async () => {
  const { ShaderMaterial } = await import('@babylonjs/core/Materials/shaderMaterial.js');
  const { RawTexture } = await import('@babylonjs/core/Materials/Textures/rawTexture.js');
  const { createSprite } = await import('../src/pixel-scene.js');
  const engine = new NullEngine(); const scene = new Scene(engine);
  const camera = new FreeCamera('test', new Vector3(0,10,0), scene);
  const texture = RawTexture.CreateRGBATexture(new Uint8Array(8*8*4).fill(255),8,8,scene);
  const atlas = {...caster().atlas,texture};
  const monk = createSprite(scene,'test-monk',atlas);monk.mesh.position.x=1;
  const ground = new ShaderMaterial('ground',scene,'',{});
  texture.name='country-surface-mask';ground.setTexture('surfaceMask',texture);
  const renderer = {world:{landscape:{groundMaterial:ground},props:[],bounds:{minX:-2,maxX:2,minY:-2,maxY:2},
    data:{zones:[{braziers:[{x:0,y:0,color:'amber'}]}]}},hounds:[],monk,assets:{monk:atlas},game:{player:{hp:10},world:{zones:[]}}};
  const effect=install({scene,engine,camera,renderer,tier:'low'});effect.update();
  assert.equal(effect.costs.fireDraws,1);
  effect.dispose();scene.dispose();engine.dispose();
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function loadingFixture(t) {
  const { ShaderMaterial } = await import('@babylonjs/core/Materials/shaderMaterial.js');
  const { RawTexture } = await import('@babylonjs/core/Materials/Textures/rawTexture.js');
  const engine = new NullEngine(), scene = new Scene(engine);
  const camera = new FreeCamera('loading-camera', new Vector3(0,10,0), scene);
  const ground = new ShaderMaterial('loading-ground', scene, '', {});
  const fallback = RawTexture.CreateRGBATexture(new Uint8Array([0,0,0,255]),1,1,scene);
  fallback.name = 'country-surface-mask';
  ground.setTexture('surfaceMask',fallback); ground.setTexture('hdStaticShadow',fallback); ground.setTexture('hdActorShadow',fallback);
  const prop = caster(), propMask = prop.atlas.mask;
  delete prop.atlas.mask;
  const monkLoad = deferred(), propLoad = deferred(), monk = {};
  const monkReady = monkLoad.promise.then(() => { monk.mask = {width:8,bytes:new Uint8Array(8).fill(255)}; });
  const propReady = propLoad.promise.then(() => { prop.atlas.mask = propMask; });
  const assets = {monk,ready:Promise.all([monkReady,propReady])};
  const world = {landscape:{groundMaterial:ground}, props:[prop], bounds:{minX:-4,maxX:6,minY:-4,maxY:6}, data:{zones:[]}};
  const renderer = {world,assets,hounds:[],monk:null,game:{player:{hp:10}}};
  let effect;
  t.after(() => { try { effect?.dispose(); } finally { try { scene.dispose(); } finally { engine.dispose(); } } });
  return {scene,engine,camera,renderer,ground,fallback,prop,monkLoad,propLoad,monkReady,assets,
    start(tier='low') { return effect = install({scene,engine,camera,renderer,tier}); }};
}

// Breaks if monk.mask alone permits a partial bake or late prop masks require an explicit onWorld.
test('separate monk-mask and prop-mask completion automatically creates the complete shadow field', async t => {
  const f = await loadingFixture(t), effect = f.start();
  assert.equal(effect.costs.staticBytes,0);
  f.monkLoad.resolve(); await f.monkReady;
  effect.update();
  assert.ok(f.ground._textures.hdStaticShadow===f.fallback);
  f.propLoad.resolve(); await f.assets.ready;
  const shadow = f.ground._textures.hdStaticShadow;
  assert.equal(shadow.name,'hd-static-moon-shadow', 'late prop shadow must appear without onWorld or another frame');
  assert.ok(shadow.getInternalTexture()._bufferView.some(byte=>byte>0), 'the loaded prop must write real shadow pixels');
  effect.update();effect.update();
  assert.ok(f.ground._textures.hdStaticShadow===shadow,'completed loading must not rebake every frame');
});

// Breaks if a queued completion resurrects effects after off/dispose.
for (const action of ['off','dispose']) test(`late masks cannot recreate resources after ${action}`, async t => {
  const f = await loadingFixture(t), effect=f.start();
  f.monkLoad.resolve(); await f.monkReady; effect.update();
  if(action==='off')effect.setTier('off');else effect.dispose();
  const counts=[f.scene.meshes.length,f.scene.textures.length,f.scene.materials.length,f.scene.customRenderTargets.length];
  f.propLoad.resolve();await f.assets.ready;effect.update();
  assert.deepEqual([f.scene.meshes.length,f.scene.textures.length,f.scene.materials.length,f.scene.customRenderTargets.length],counts);
  assert.ok(f.ground._textures.hdStaticShadow===f.fallback);
  if(action==='off'){effect.setTier('low');assert.equal(f.ground._textures.hdStaticShadow.name,'hd-static-moon-shadow');}
});

// Breaks if the readiness callback captures the obsolete world/material.
test('mask completion builds only the current world after a pending world replacement', async t => {
  const f=await loadingFixture(t),effect=f.start();
  f.monkLoad.resolve();await f.monkReady;effect.update();
  const nextGround=f.ground.clone('new-world-ground');
  f.renderer.world={...f.renderer.world,landscape:{groundMaterial:nextGround}};
  effect.onWorld(f.renderer);
  f.propLoad.resolve();await f.assets.ready;
  assert.ok(f.ground._textures.hdStaticShadow===f.fallback);
  assert.equal(nextGround._textures.hdStaticShadow.name,'hd-static-moon-shadow');
  assert.equal(f.scene.textures.filter(x=>x.name==='hd-static-moon-shadow').length,1);
});

// Real ShaderMaterial.clone models receivers created by terrain after shadows has been enabled.
// Checks run from the texture's dispose notification, so replacing references afterwards is too late.
test('every cloned receiver releases the actor map before high to low disposes it', async t => {
  const f=await loadingFixture(t);f.monkLoad.resolve();f.propLoad.resolve();await f.assets.ready;
  const effect=f.start('high');await Promise.resolve();effect.update();
  const map=f.scene.customRenderTargets[0],baked=f.ground._textures.hdStaticShadow;
  const receiver1=f.ground.clone('relief-high'),receiver2=f.ground.clone('relief-next-low');
  assert.ok(receiver1._textures.hdActorShadow===map);assert.ok(receiver2._textures.hdActorShadow===map);
  map.onDisposeObservable.addOnce(()=>{
    for(const receiver of [f.ground,receiver1,receiver2])assert.ok(receiver._textures.hdActorShadow===baked,'all borrowers must be rebound before RTT disposal');
  });
  effect.setTier('low');
  for(const receiver of [f.ground,receiver1,receiver2])assert.ok(receiver._textures.hdActorShadow===baked);
});

// Breaks if only the original ground is unbound before a baked texture is released.
for(const action of ['off','onWorld','dispose'])test(`all cloned receivers release baked shadow bindings before ${action}`,async t=>{
  const f=await loadingFixture(t);f.monkLoad.resolve();f.propLoad.resolve();await f.assets.ready;
  const effect=f.start('low');await Promise.resolve();effect.update();
  const baked=f.ground._textures.hdStaticShadow,receiver=f.ground.clone('relief');
  const {RawTexture}=await import('@babylonjs/core/Materials/Textures/rawTexture.js');
  const receiverFallback=RawTexture.CreateRGBATexture(new Uint8Array([0,0,0,255]),1,1,f.scene);
  receiver.setTexture('surfaceMask',receiverFallback);
  baked.onDisposeObservable.addOnce(()=>{
    assert.ok(receiver._textures.hdStaticShadow===receiverFallback,'use the receiver own borrowed fallback');
    assert.ok(receiver._textures.hdActorShadow===receiverFallback);
    assert.ok(f.ground._textures.hdStaticShadow===f.fallback);
  });
  if(action==='off')effect.setTier('off');
  else if(action==='dispose')effect.dispose();
  else {f.renderer.world=null;effect.onWorld(f.renderer);}
  assert.equal(baked.getInternalTexture(),null);
  assert.ok(receiver._textures.hdStaticShadow===receiverFallback);
});

// Breaks the pending retry path used by small callers without loadPixelAssets.ready.
test('without an aggregate promise, missing prop masks keep the world pending', async t => {
  const f=await loadingFixture(t);
  delete f.assets.ready;
  f.monkLoad.resolve();await f.monkReady;
  const effect=f.start();effect.update();
  assert.equal(effect.costs.staticBytes,0);
  f.propLoad.resolve();await f.propLoad.promise;
  effect.update();
  assert.equal(f.ground._textures.hdStaticShadow.name,'hd-static-moon-shadow');
  assert.ok(f.ground._textures.hdStaticShadow.getInternalTexture()._bufferView.some(byte=>byte>0));
});
