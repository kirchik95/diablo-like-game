import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,Texture,ArcRotateCamera,Vector3,StandardMaterial,Matrix,Mesh,Observable} from '@babylonjs/core/index.js';
import {createSprite,pixelAtlases} from '../src/pixel-scene.js';
import {captureStaticSpriteState} from '../src/static-sprite-shape.js';
import {scheduleStaticObservation} from '../src/static-observation.js';
import {StaticSpriteBatch} from '../src/static-batch.js';
function setup(t){const engine=new NullEngine(),scene=new Scene(engine);engine.getCaps().instancedArrays=true;new ArcRotateCamera('c',Math.PI/4,Math.PI/3,30,Vector3.Zero(),scene);const atlas={...pixelAtlases.campPanorama,texture:new Texture(null,scene)};const props=captureStaticSpriteState(StandardMaterial,Texture,Observable,()=>[0,1,2].map(i=>{const p=createSprite(scene,'p'+i,atlas);p.mesh.position.set(i*20,.03,i*20);p.mesh.freezeWorldMatrix();return p}),scene);t.after(()=>{scene.dispose();engine.dispose()});return {scene,props}}
test('deferred slot checks material UV and geometry before subscription',t=>{const {scene,props}=setup(t),jobs=[];const batch=new StaticSpriteBatch(scene,{props},{scheduleObservation:step=>{jobs.push(step);return ()=>{jobs.length=0}}});assert.equal(jobs.length,1);assert.equal(Object.getPrototypeOf(props[0].mesh),Object.getPrototypeOf(props[1].mesh));props[0].texture.uOffset=.2;batch.update();assert.notEqual(props[0].mesh.layerMask,0);props[1].mesh.geometry.releaseForMesh(props[1].mesh);batch.update();assert.notEqual(props[1].mesh.layerMask,0);while(jobs[0]?.()){}props[2].material.emissiveColor.r=.3;batch.update();assert.notEqual(props[2].mesh.layerMask,0);batch.dispose();assert.equal(jobs.length,0)});

test('installation progresses without idle time and cancels with the scene', t => {
  const {scene} = setup(t), scheduled = new Map(); let next = 0, calls = 0;
  const keys = ['requestIdleCallback', 'cancelIdleCallback', 'setTimeout', 'clearTimeout'];
  const before = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => { for (const [key, descriptor] of before) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  globalThis.requestIdleCallback = () => 123;
  globalThis.cancelIdleCallback = () => {};
  globalThis.setTimeout = fn => { scheduled.set(++next, fn); return next; };
  globalThis.clearTimeout = id => scheduled.delete(id);
  const cancel = scheduleStaticObservation(scene, () => { calls++; return true; });
  assert.equal(scheduled.size, 0);
  scene.onAfterRenderObservable.notifyObservers(scene);
  for (const [id, run] of [...scheduled]) { scheduled.delete(id); run(); }
  assert.ok(calls > 0);
  cancel(); scene.dispose();
  const stoppedAt = calls;
  for (const [id, run] of [...scheduled]) { scheduled.delete(id); run(); }
  assert.equal(calls, stoppedAt);
});

test('pending observers preserve visibility matrix layer and UV changes on every update', t => {
  const {scene, props} = setup(t), jobs = [];
  const batch = new StaticSpriteBatch(scene, {props}, {scheduleObservation: step => { jobs.push(step); return () => {jobs.length = 0;}; }});
  const p = props[0];
  p.mesh.isVisible = false; batch.update(); assert.notEqual(p.mesh.layerMask, 0);
  p.mesh.isVisible = true; batch.update(); assert.equal(p.mesh.layerMask, 0);
  jobs[0]();
  p.material.zOffset = .2; batch.update(); assert.notEqual(p.mesh.layerMask, 0);
  p.material.zOffset = 0; batch.update(); assert.equal(p.mesh.layerMask, 0);
  props[1].mesh.layerMask = 123; batch.update(); assert.equal(props[1].mesh.layerMask, 123);
  props[2].mesh.getWorldMatrix().copyFrom(Matrix.Translation(1, 2, 3));
  batch.update(); assert.notEqual(props[2].mesh.layerMask, 0);
  batch.dispose(); assert.equal(jobs.length, 0);
});

test('public UV matrix edits invalidate before and after observer installation', t => {
  for (const install of [false, true]) {
    const {scene, props} = setup(t), jobs = [];
    const batch = new StaticSpriteBatch(scene, {props}, {scheduleObservation: step => {jobs.push(step); return () => {};}});
    if (install) while(jobs[0]()) {}
    const slot = batch.groups.flatMap(group => group.slots).find(slot => slot.sprite === props[0]);
    props[0].texture.getTextureMatrix().setTranslationFromFloats(.4, .3, .2);
    batch.update(); assert.equal(slot.active, false); assert.notEqual(props[0].mesh.layerMask, 0);
    batch.dispose();
  }
});

test('updatable original indices retire their slots throughout deferred installation', t => {
  for (const install of [false, true]) {
    const {scene, props} = setup(t), jobs = [];
    const geometry = props[0].mesh.geometry;
    geometry.setIndices(geometry.getIndices(), null, true);
    const batch = new StaticSpriteBatch(scene, {props}, {scheduleObservation: step => {jobs.push(step); return () => {};}});
    if (install) while(jobs[0]()) {}
    const slot = batch.groups.flatMap(group => group.slots).find(slot => slot.sprite === props[0]);
    geometry.updateIndices([0,0,0,0,0,0], 0);
    batch.update(); assert.equal(slot.active, false); assert.equal(slot.retired, true);
    batch.dispose();
  }
});

test('subscribed unchanged slots read captured native resources without sprite forwarding', t => {
  const {scene, props} = setup(t), batch = new StaticSpriteBatch(scene, {props});
  const p = props[0], material = p.material, texture = p.texture;
  let reads = 0;
  Object.defineProperty(p, 'material', {configurable:true,get(){reads++;return material;}});
  Object.defineProperty(p, 'texture', {configurable:true,get(){reads++;return texture;}});
  batch.update(); batch.update();
  assert.equal(reads, 0);
  batch.dispose();
});


test('owned meshes have their final observation prototype before their first render', t => {
 const {scene,props}=setup(t),proto=Object.getPrototypeOf(props[0].mesh),jobs=[];
 const batch=new StaticSpriteBatch(scene,{props},{scheduleObservation:step=>{jobs.push(step);return()=>{}}});
 while(jobs[0]()){}
 assert.equal(Object.getPrototypeOf(props[0].mesh),proto);
 batch.dispose();
});

test('the last legacy update reconciles edits made before observer installation', t => {
 const {scene,props}=setup(t),jobs=[];
 const batch=new StaticSpriteBatch(scene,{props},{scheduleObservation:step=>{jobs.push(step);return()=>{}}});
 props[0].material.zOffset=.2;props[1].mesh.layerMask=123;
 props[2].texture.getTextureMatrix().setTranslationFromFloats(.4,.3,.2);
 while(jobs[0]()){}
 batch.update();
 assert.notEqual(props[0].mesh.layerMask,0);assert.equal(props[1].mesh.layerMask,123);assert.notEqual(props[2].mesh.layerMask,0);
 batch.dispose();assert.equal(props[1].mesh.layerMask,123);
});

test('adding a mesh after installation does not rerun slot eligibility', async t => {
 const {scene,props}=setup(t),batch=new StaticSpriteBatch(scene,{props});let calls=0;
 const active=batch.active;batch.active=function(...args){calls++;return active.apply(this,args);};
 const loot=new Mesh('loot',scene);loot.material=new StandardMaterial('loot-ink',scene);
 await new Promise(ok=>setTimeout(ok,0));
 batch.update();scene.getActiveMeshCandidates();
 assert.equal(calls,0);assert.ok(scene.getActiveMeshCandidates().data.includes(loot));batch.dispose();
});

test('browser message tasks install without the nested timer clamp and close their ports', t => {
 const scene={onAfterRenderObservable:new Observable(),onDisposeObservable:new Observable()},messages=[];let closed=0,calls=0;
 const before=Object.getOwnPropertyDescriptor(globalThis,'window');
 class Channel {
  constructor(){this.port1={onmessage:null,close(){closed++;}};this.port2={postMessage:()=>messages.push(()=>this.port1.onmessage?.({data:0})),close(){closed++;}};}
 }
 globalThis.window={MessageChannel:Channel};
 t.after(()=>{scene.onDisposeObservable.notifyObservers(scene);if(before)Object.defineProperty(globalThis,'window',before);else delete globalThis.window;});
 scheduleStaticObservation(scene,()=>{calls++;return calls<3;});scene.onAfterRenderObservable.notifyObservers(scene);
 assert.equal(messages.length,1);
 while(messages.length)messages.shift()();
 assert.equal(calls,3);assert.equal(closed,2);
});
