import { Material } from '@babylonjs/core/Materials/material.js';
import { MaterialDefines } from '@babylonjs/core/Materials/materialDefines.js';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { Scene } from '@babylonjs/core/scene.js';

const dirty = Material.prototype._markAllSubMeshesAsDirty, markDirty = Material.prototype.markAsDirty;
const materialScene = Material.prototype.getScene;
const blockScene = Object.getOwnPropertyDescriptor(Scene.prototype, 'blockMaterialDirtyMechanism');
const arrayIterator = Array.prototype[Symbol.iterator];
const dirtyFields = ['_isDirty', '_areTexturesDirty', '_areAttributesDirty', '_areLightsDirty', '_areLightsDisposed', '_areFresnelDirty', '_areMiscDirty', '_arePrePassDirty', '_areImageProcessingDirty'];
const markScene = Scene.prototype.markAllMaterialsAsDirty, resetScene = Scene.prototype.resetCachedMaterial;
const getMaterial = SubMesh.prototype.getMaterial, maySub = SubMesh.prototype._mayRenderWithMaterial, isMulti = SubMesh.prototype._isMultiMaterial;
const mayMesh = AbstractMesh.prototype._mayRenderWithMaterial, getPass = AbstractMesh.prototype.getMaterialForRenderPass;
const defineMethods = ['markAllAsDirty', 'markAsImageProcessingDirty', 'markAsTexturesDirty', 'markAsFresnelDirty', 'markAsMiscDirty', 'markAsPrePassDirty', 'markAsLightDirty', 'markAsAttributesDirty'];
const defineFunctions = new Map(defineMethods.map(key => [key, MaterialDefines.prototype[key]]));
const callbacks = ['_ImageProcessingDirtyCallBack', '_TextureDirtyCallBack', '_FresnelDirtyCallBack', '_MiscDirtyCallBack', '_PrePassDirtyCallBack', '_LightsDirtyCallBack', '_AttributeDirtyCallBack'];
const runDirty = Material._RunDirtyCallBacks;
const callbackFunctions = callbacks.map(key => Material[key]);
const callbackMethods = ['markAsImageProcessingDirty', 'markAsTexturesDirty', 'markAsFresnelDirty', 'markAsMiscDirty', 'markAsPrePassDirty', 'markAsLightDirty', 'markAsAttributesDirty'];
const nativeCallbacks = typeof runDirty === 'function' && Function.prototype.toString.call(runDirty).includes('_DirtyCallbackArray') && callbackFunctions.every((fn, i) => typeof fn === 'function' && new RegExp('^\\(?([\\w$]+)\\)?=>\\1\\.' + callbackMethods[i] + '\\(\\)$').test(Function.prototype.toString.call(fn).replace(/\s/g, '')));
const meshGetter = Object.getOwnPropertyDescriptor(Mesh.prototype, 'material').get;
const abstractGetter = Object.getOwnPropertyDescriptor(AbstractMesh.prototype, 'material').get;
function descriptor(object, key) {
  for (let p = object; p; p = Object.getPrototypeOf(p)) { const d = Object.getOwnPropertyDescriptor(p, key); if (d) return d; }
}
function nativeArray(object, key) {
  const d = Object.getOwnPropertyDescriptor(object, key), value = d?.value;
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && !Object.hasOwn(value, Symbol.iterator) && Array.prototype[Symbol.iterator] === arrayIterator;
}
function data(object, key) { const d = Object.getOwnPropertyDescriptor(object, key); return d && 'value' in d && d.writable; }
function callbacksNative() {
  return nativeCallbacks && Material._RunDirtyCallBacks === runDirty && callbacks.every((key, i) => Material[key] === callbackFunctions[i]);
}
function sceneNative(scene) {
  const block = descriptor(scene, 'blockMaterialDirtyMechanism');
  return block?.get === blockScene.get && block.set === blockScene.set
    && descriptor(scene, 'markAllMaterialsAsDirty')?.value === markScene && descriptor(scene, 'resetCachedMaterial')?.value === resetScene
    && nativeArray(scene, 'materials') && nativeArray(scene, 'meshes');
}
function materialNative(m, scene) {
  return descriptor(m, 'getScene')?.value === materialScene && data(m, '_scene') && m._scene === scene && data(m, '_blockDirtyMechanism')
    && descriptor(m, 'markAsDirty')?.value === markDirty
    && [dirty, staticMaterialDirty].includes(descriptor(m, '_markAllSubMeshesAsDirty')?.value);
}
function definesNative(defines) {
  return defineMethods.every(key => descriptor(defines, key)?.value === defineFunctions.get(key)) && dirtyFields.every(key => data(defines, key));
}
function resolutionNative(sub) {
  const rendering = sub._renderingMesh, get = descriptor(rendering, 'material')?.get;
  return sub.getMaterial === getMaterial && sub._mayRenderWithMaterial === maySub && sub._isMultiMaterial === isMulti
    && rendering._mayRenderWithMaterial === mayMesh && rendering.getMaterialForRenderPass === getPass
    && (get === meshGetter || get === abstractGetter) && !rendering._internalAbstractMeshDataInfo._materialForRenderPass?.length;
}
function liveMaterials(scene) {
  // A custom resolver/dirty callback can mutate draw wrappers while flushing.
  // Keep Babylon's complete traversal for those scenes and unknown engine code.
  if (Material.prototype._markAllSubMeshesAsDirty !== dirty || !callbacksNative() || !sceneNative(scene)
    || !Function.prototype.toString.call(markDirty).includes('_DirtyCallbackArray')
    || !Function.prototype.toString.call(dirty).includes('_mayRenderWithMaterial(this)')
    || scene.markAllMaterialsAsDirty !== markScene
    || scene.resetCachedMaterial !== resetScene) return null;
  for (const m of scene.materials) if (!materialNative(m, scene)) return null;
  const materials = new Set();
  for (const mesh of scene.meshes) for (const sub of mesh.subMeshes ?? []) {
    if (!resolutionNative(sub)) return null;
    const rendering = sub._renderingMesh;
    const root = rendering.material;
    if (root && 'getSubMaterial' in root) return null;
    for (const wrapper of sub._drawWrappers) {
      const defines = wrapper?.defines;
      if (!defines?.markAllAsDirty) continue;
      if (!definesNative(defines)) return null;
      // With native resolution and no pass/multi-material overrides, every
      // pass resolves to this root. Null/default roots keep the native scan.
      if (!root) return null;
      materials.add(root);
    }
  }
  return materials;
}
// Routing lives on the existing scenery prototype. Adding then deleting an own
// method on every Material normalizes its properties in V8, slowing later frames.
let skipped = null;
export function staticMaterialDirty(...args) {
  if (skipped?.has(this)) return;
  return Material.prototype._markAllSubMeshesAsDirty.apply(this, args);
}
function withSkipped(next, flush) {
  const previous = skipped; skipped = next;
  try { return flush(); } finally { skipped = previous; }
}
// Native traversal cannot affect a material absent from all live native bindings.
// Unknown providers suspend routing and retain the complete native traversal.
export function flushStaticMaterialDirty(scene, staticMaterials, flush) {
  if (!staticMaterials.length) return withSkipped(null, flush);
  let bound;
  try { bound = liveMaterials(scene); } catch { return withSkipped(null, flush); }
  if (!bound) return withSkipped(null, flush);
  return withSkipped(new Set(staticMaterials.filter(m => !bound.has(m))), flush);
}
