import { captureStaticSpriteState } from '../src/static-sprite-shape.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder, StandardMaterial, Material, MaterialDefines, Texture, Observable } from '@babylonjs/core/index.js';
let flushStaticMaterialDirty;
try { ({flushStaticMaterialDirty}=await import('../src/static-material-dirty.js')); } catch(e) { if(e.code!=='ERR_MODULE_NOT_FOUND')throw e; }
function setup(t){const engine=new NullEngine(),scene=new Scene(engine);t.after(()=>{scene.dispose();engine.dispose()});const [bound,unused]=captureStaticSpriteState(StandardMaterial,Texture,Observable,()=>[new StandardMaterial('bound',scene),new StandardMaterial('unused',scene)]),mesh=MeshBuilder.CreatePlane('p',{},scene);mesh.material=bound;const wrapper=mesh.subMeshes[0]._drawWrappers[0];wrapper.defines=new MaterialDefines();wrapper.defines.markAsProcessed();wrapper.materialContext=bound._materialContext;return {scene,bound,unused,mesh,defines:wrapper.defines};}
test('unbound static material dirty flush skips the mesh scan and still resets cached state',t=>{
 assert.equal(typeof flushStaticMaterialDirty,'function');const {scene,bound,unused,defines}=setup(t);
 scene._cachedMaterial=bound;
 flushStaticMaterialDirty(scene,[unused],()=>{assert.equal(Object.hasOwn(unused,'_markAllSubMeshesAsDirty'),false);unused.markAsDirty(Material.AllDirtyFlag);assert.equal(scene._cachedMaterial,null);assert.equal(defines.isDirty,false);});
 bound.markAsDirty(Material.AllDirtyFlag);assert.equal(defines.isDirty,true);
 assert.equal(Object.hasOwn(unused,'_markAllSubMeshesAsDirty'),false);
});
test('bound contexts and custom resolution keep native dirty behavior, including throws',t=>{
 assert.equal(typeof flushStaticMaterialDirty,'function');const {scene,bound,unused,mesh,defines}=setup(t),original=bound._markAllSubMeshesAsDirty;
 flushStaticMaterialDirty(scene,[bound,unused],()=>{assert.equal(bound._markAllSubMeshesAsDirty,original);bound.markAsDirty(Material.AllDirtyFlag);});assert.equal(defines.isDirty,true);
 const fn=mesh.subMeshes[0].getMaterial;mesh.subMeshes[0].getMaterial=function(...args){return fn.apply(this,args)};
 assert.throws(()=>flushStaticMaterialDirty(scene,[unused],()=>{assert.equal(unused._markAllSubMeshesAsDirty,original);throw Error('stop')}),/stop/);
 assert.equal(unused._markAllSubMeshesAsDirty,original);
});
test('temporary bypass restores on an exception in the flush',t=>{
 const {scene,unused}=setup(t),original=unused._markAllSubMeshesAsDirty;
 assert.throws(()=>flushStaticMaterialDirty(scene,[unused],()=>{assert.equal(Object.hasOwn(unused,'_markAllSubMeshesAsDirty'),false);assert.equal(unused._markAllSubMeshesAsDirty,original);throw Error('flush failed')}),/flush failed/);
 assert.equal(unused._markAllSubMeshesAsDirty,original);assert.equal(Object.hasOwn(unused,'_markAllSubMeshesAsDirty'),false);
});
test('mutating custom dirty callbacks retain native resolution for later materials',t=>{
 const {scene,bound,unused,mesh,defines}=setup(t),original=Material._TextureDirtyCallBack;
 t.after(()=>{Material._TextureDirtyCallBack=original;});
 Material._TextureDirtyCallBack=d=>{mesh.material=unused;original(d);};
 flushStaticMaterialDirty(scene,[unused],()=>{
  bound.markAsDirty(Material.TextureDirtyFlag);
  const wrapper=mesh.subMeshes[0]._getDrawWrapper(0,true);wrapper.defines=defines;wrapper.materialContext=unused._materialContext;defines.markAsProcessed();
  unused.markAsDirty(Material.TextureDirtyFlag);assert.equal(defines._areTexturesDirty,true);
 });
});
for(const kind of ['getScene','define accessor'])test(`custom ${kind} rebinding during unblock keeps native invalidation`,t=>{
 const {scene,bound,unused,mesh,defines}=setup(t);let next,once=false;
 const rebind=()=>{if(once)return;once=true;mesh.material=unused;next=new MaterialDefines();next.markAsProcessed();const w=mesh.subMeshes[0]._getDrawWrapper(0,true);w.defines=next;w.materialContext=unused._materialContext;};
 if(kind==='getScene')bound.getScene=()=>{rebind();return scene;};
 else Object.defineProperty(defines,'_areTexturesDirty',{configurable:true,get(){return false;},set(v){if(v)rebind();}});
 scene.blockMaterialDirtyMechanism=true;
 flushStaticMaterialDirty(scene,[unused],()=>{scene.blockMaterialDirtyMechanism=false;});
 assert.ok(next);assert.equal(next.isDirty,true);
});
test('opacity helper preserves a custom native-dirty dispatcher',async t=>{
 const {setMaterialOpacity}=await import('../src/static-sprite-state.js');const {bound,defines}=setup(t);bound.transparencyMode=Material.MATERIAL_ALPHATEST;defines.markAsProcessed();
 const original=Material._RunDirtyCallBacks;let calls=0;
 Material._RunDirtyCallBacks=function(...args){calls++;return original.apply(this,args);};t.after(()=>{Material._RunDirtyCallBacks=original;});
 setMaterialOpacity(bound,.25,Material.MATERIAL_ALPHABLEND,Material);assert.equal(calls,1);
});
