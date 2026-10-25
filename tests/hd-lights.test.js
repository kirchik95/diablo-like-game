import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import * as lights from '../src/hd2d/lights.js';

// A missing ritual source leaves the focal point dark; doubled fire entries over-light camp.
test('collects fire, magic, lantern and ritual sources without duplicating camp brazier', () => {
  const result = lights.sourcesFor({ zones: [{
    setDressing: [{ kind: 'campfire-base', x: 1, y: 2, collider: { x: 3, y: 4 } },
      { kind: 'stone-lantern', x: 5, y: 6 }],
    braziers: [{ x: 1, y: 2, color: 'amber' }, { x: 7, y: 8, color: 'pink' }],
    shrines: [{ x: 9, y: 10 }], ritual: { x: 11, y: 12 },
  }] });
  assert.equal(result.length, 5);
  assert.deepEqual(result.map(p => [p.x, p.y, p.ink]), [[3,4,'amber'],[7,8,'pink'],[9,10,'spirit'],[5,6,'lantern'],[11,12,'ritual']]);
  assert.ok(result.every(p => p.height > 0 && p.radius > 0));
});

// Selecting authored order instead of distance would darken actors near late-listed lanterns.
test('packs nearest lights within tier budget, reuses buffers and holds whole flicker steps', () => {
  const source = Array.from({length:10}, (_,i)=>({x:i*10,y:0,height:1,radius:6,power:1,ink:'amber',seed:i}));
  const field = new lights.PointField(source);
  const positions = field.positions;
  field.update(90,0,0,4,false);
  assert.equal(field.count,4);
  assert.deepEqual(Array.from(field.positions).filter((_,i)=>i%4===0).slice(0,4),[90,80,70,60]);
  const first = Array.from(field.colors);
  field.update(90,0,.12,4,false);
  assert.deepEqual(Array.from(field.colors),first);
  field.update(90,0,.13,4,false);
  assert.notDeepEqual(Array.from(field.colors),first);
  field.update(90,0,2,8,true);
  const still = Array.from(field.colors);
  field.update(90,0,99,8,true);
  assert.deepEqual(Array.from(field.colors),still);
  assert.equal(field.count,8);
  assert.equal(field.positions,positions);
  field.update(90,0,99,0,false);
  assert.equal(field.count,0);
  assert.ok(field.colors.every(v=>v===0));
});

// Frozen, cloned batch materials must follow the same tier and restore all stage-0 switches.
test('host lifecycle lights cloned materials, restores pools and releases scene state', () => {
  const engine=new NullEngine(),scene=new Scene(engine),material=new StandardMaterial('prop',scene);
  material.disableLighting=true;
  lights.registerMaterial(material);
  const renderer={world:{data:{zones:[]}},camera:{target:new Vector3()},reducedMotion:false,
    polish:{options:{lightPools:true},set(o){Object.assign(this.options,o);this.dirty=true;}}};
  const effect=lights.install({scene,engine,camera:renderer.camera,renderer,tier:'off'});
  assert.equal(material.pluginManager?.getPlugin('HdPointLighting') ?? null,null);
  const preexistingBatch=material.clone('static-batch-existing');preexistingBatch.freeze();
  effect.setTier('low');
  assert.ok(preexistingBatch.pluginManager?.getPlugin('HdPointLighting'));
  const plugin=material.pluginManager.getPlugin('HdPointLighting');
  assert.ok(plugin);
  assert.equal(renderer.polish.options.lightPools,true);
  const clone=material.clone('static-batch-prop'); clone.freeze();
  const cloned=clone.pluginManager.getPlugin('HdPointLighting');
  const defines={}; cloned.prepareDefines(defines,scene);
  assert.equal(defines.HD_LIGHT_COUNT,4);
  effect.setTier('high'); cloned.prepareDefines(defines,scene);
  assert.equal(defines.HD_LIGHT_COUNT,8);
  effect.setTier('off'); cloned.prepareDefines(defines,scene);
  assert.equal(defines.HD_LIGHT_COUNT,0);
  assert.equal(renderer.polish.options.lightPools,true);
  assert.equal(material.disableLighting,true);
  assert.equal(clone.isFrozen,true);
  effect.dispose();
  const later=new StandardMaterial('later',scene);later.disableLighting=true;lights.registerMaterial(later);
  assert.equal(later.pluginManager?.getPlugin('HdPointLighting') ?? null,null);
  scene.dispose();engine.dispose();
});

// markAsDirty alone does not invalidate Babylon's frozen-material ready shortcut.
test('frozen compiled batch returns to the off shader after a live tier switch', async () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  const camera=new FreeCamera('qa',new Vector3(0,0,-10),scene);
  const material=new StandardMaterial('static-batch-rendered',scene);material.disableLighting=true;
  lights.registerMaterial(material);
  const mesh=MeshBuilder.CreatePlane('prop',{},scene);mesh.material=material;
  const renderer={world:{data:{zones:[]}},camera,reducedMotion:false};
  const effect=lights.install({scene,engine,camera,renderer,tier:'high'});effect.update(0,0);
  await material.forceCompilationAsync(mesh);material.freeze();scene.render();
  assert.equal(mesh.subMeshes[0].materialDefines.HD_LIGHT_COUNT,8);
  effect.setTier('off');scene.render();
  assert.equal(mesh.subMeshes[0].materialDefines.HD_LIGHT_COUNT,0);
  effect.dispose();scene.dispose();engine.dispose();
});

// A rebuilt run must not keep the old world's sources or leave the new ground unlit.
test('world replacement rebuilds the light field and supplies vector uniforms to the new ground', () => {
  const engine=new NullEngine(),scene=new Scene(engine),camera={target:new Vector3(2,0,3)};
  const writes={};
  const ground={setFloat(k,v){writes[k]=v;},setVector3(k,v){writes[k]=v.asArray();},setVector4(k,v){writes[k]=v.asArray();},setArray4(k,v){writes[k]=Array.from(v);}};
  const renderer={camera,reducedMotion:false,world:{data:{setDressing:[{kind:'campfire-base',x:2,y:3}]},landscape:{groundMaterial:ground}}};
  const fx=lights.install({scene,engine,camera,renderer,tier:'low'});fx.update(0,0);
  assert.deepEqual(writes.hdLightPosition.slice(0,3),[2,.85,3].map(Math.fround));
  assert.equal(writes.hdLightParams[0],1);
  assert.ok(writes.hdMoon.every(v=>v>0));
  renderer.world={data:{setDressing:[{kind:'stone-lantern',x:20,y:30}]},landscape:{groundMaterial:ground}};
  fx.update(0,0);
  assert.deepEqual(writes.hdLightPosition.slice(0,3),[20,1.25,30]);
  fx.setTier('off');assert.equal(writes.hdLightEnabled,0);
  fx.dispose();scene.dispose();engine.dispose();
});

for (const initial of [false,true]) test(`HD preserves the stage-0 pools preference from ${initial}`,()=>{
  const engine=new NullEngine(),scene=new Scene(engine),polish={options:{lightPools:initial},set(o){Object.assign(this.options,o);}};
  const renderer={polish,world:{data:{}}};
  const effect=lights.install({scene,engine,renderer,camera:{target:new Vector3()},tier:'low'});
  assert.equal(polish.options.lightPools,initial);
  polish.set({lightPools:!initial});
  assert.equal(polish.options.lightPools,!initial);
  effect.setTier('off');
  assert.equal(polish.options.lightPools,!initial);
  effect.dispose();scene.dispose();engine.dispose();
});
