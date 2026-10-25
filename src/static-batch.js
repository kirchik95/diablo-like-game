import { watchStaticSprite, watchStaticGeometry, setWithoutNotice } from './static-sprite-state.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { RenderingGroup } from '@babylonjs/core/Rendering/renderingGroup.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';

// Babylon evaluates readiness, LOD and world matrices before testing layerMask.
// Batched originals remain scene-owned for masks, picking and disposal, but need
// none of that render work until their independent draw returns. Preserve the
// scene's candidate provider and share one filter across overlapping world builds.
const candidateFilters = new WeakMap();
function filterCandidates(scene) {
  let state = candidateFilters.get(scene);
  if (state) { state.users++; return state; }
  state = { original: scene.getActiveMeshCandidates, hidden: new Set(), data: [], length: 0, users: 1, dirty: true };
  // A changed/unknown provider keeps the original conservative filtering path.
  state.cacheable = Function.prototype.toString.call(state.original).replace(/\s/g, '') === '()=>this._getDefaultMeshCandidates()';
  const changed = () => { state.dirty = true; };
  state.added = scene.onNewMeshAddedObservable.add(changed);
  state.removed = scene.onMeshRemovedObservable.add(changed);
  state.provider = () => {
    const candidates = state.original.call(scene);
    if (!state.hidden.size) return candidates;
    const cacheable = state.cacheable && candidates.data === scene.meshes && candidates.length === scene.meshes.length;
    if (cacheable && !state.dirty && state.inputLength === candidates.length) return state;
    state.inputLength = candidates.length; state.dirty = false;
    let count = 0;
    for (let i = 0; i < candidates.length; i++) {
      const mesh = candidates.data[i];
      if (!state.hidden.has(mesh)) state.data[count++] = mesh;
    }
    state.data.length = state.length = count;
    return state;
  };
  state.clear = () => {
    if (scene.getActiveMeshCandidates === state.provider) scene.getActiveMeshCandidates = state.original;
    scene.onNewMeshAddedObservable.remove(state.added); scene.onMeshRemovedObservable.remove(state.removed);
    state.hidden.clear(); state.data.length = state.length = 0;
    candidateFilters.delete(scene);
  };
  state.observer = scene.onDisposeObservable.addOnce(state.clear);
  scene.getActiveMeshCandidates = state.provider;
  candidateFilters.set(scene, state);
  return state;
}
function releaseCandidates(scene, state) {
  if (--state.users) return;
  scene.onDisposeObservable.remove(state.observer);
  state.clear();
}

const WORLD_SPACE_FRAMES = new Set(['cypress-medium', 'bush-round', 'outcrop-cluster']);

// The source is frozen at identity and instance matrices already are world
// matrices. For these atlas frames the extra identity multiplication changes
// Metal's nearest-texel choice. Preserve the original world * position expression.
// Other frames keep their existing shader variant, whose texels are already exact.
class WorldSpaceInstances extends MaterialPluginBase {
  constructor(material) {
    super(material, 'StaticWorldSpaceInstances', 200, { STATIC_WORLD_SPACE_INSTANCES: true }, true, true);
  }

  getClassName() { return 'StaticWorldSpaceInstances'; }

  getCustomCode(shaderType) {
    return shaderType === 'vertex' ? {
      '!finalWorld=world\\*finalWorld;': '// Instance matrix already is world-space.',
    } : null;
  }
}

// Per-instance atlas matrices retain the original mat4 * UV expression, including
// float32 rounding. Different cells/flips can therefore use one material/draw.
class AtlasInstances extends MaterialPluginBase {
  constructor(material) { super(material, 'StaticAtlasInstances', 210, { STATIC_ATLAS_INSTANCES: true }, true, true); }
  getClassName() { return 'StaticAtlasInstances'; }
  getAttributes(attributes) { attributes.push('staticUV0', 'staticUV1', 'staticUV2', 'staticUV3'); }
  getCustomCode(shaderType) {
    return shaderType === 'vertex' ? {
      CUSTOM_VERTEX_DEFINITIONS: 'attribute vec4 staticUV0; attribute vec4 staticUV1; attribute vec4 staticUV2; attribute vec4 staticUV3;',
      '!vDiffuseUV=vec2\\(diffuseMatrix\\*vec4\\(uvUpdated,1.0,0.0\\)\\);':
        'vDiffuseUV=vec2(mat4(staticUV0,staticUV1,staticUV2,staticUV3)*vec4(uvUpdated,1.0,0.0));',
    } : null;
  }
}

const worldSpace = sprite => sprite.mesh.billboardMode === Mesh.BILLBOARDMODE_NONE || WORLD_SPACE_FRAMES.has(sprite.atlas.frames?.[sprite.frame]);

const compatible = sprite => {
  const { mesh, material } = sprite;
  return !mesh.isDisposed() && mesh.isWorldMatrixFrozen && (mesh.billboardMode === Mesh.BILLBOARDMODE_ALL || mesh.billboardMode === Mesh.BILLBOARDMODE_NONE) && !mesh.parent
    && material.disableLighting && material.useAlphaFromDiffuseTexture && !material.backFaceCulling
    && mesh.material === material && material.diffuseTexture === sprite.texture && mesh.visibility === 1 && material.alpha === 1 && material.transparencyMode === Material.MATERIAL_ALPHATEST
    && material.alphaCutOff === .5 && !material.zOffset && !material.zOffsetUnits;
};

// A depth-tested billboard is one plane. Coplanar overlapping quads depend on the
// original material/draw order (including depth rounding). Never regroup either
// member of such a pair. Project full cells, including transparent texels, so the
// decision is conservative across viewport sizes and camera translations.
function orderedOverlaps(scene, sprites) {
  const view = scene.activeCamera.getViewMatrix(), boxes = [], unsafe = new Set();
  for (const sprite of sprites) {
    const mesh = sprite.mesh;
    if (mesh.billboardMode !== Mesh.BILLBOARDMODE_ALL || !mesh.isWorldMatrixFrozen) continue;
    const matrix = mesh.getWorldMatrix().multiply(view), data = mesh.getVerticesData('position');
    let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
    for (let i = 0; i < data.length; i += 3) {
      const p = Vector3.TransformCoordinates(Vector3.FromArray(data, i), matrix);
      left = Math.min(left, p.x); right = Math.max(right, p.x);
      bottom = Math.min(bottom, p.y); top = Math.max(top, p.y);
    }
    boxes.push({ sprite, left, right, bottom, top, depth: matrix.m[14] });
  }
  boxes.sort((a, b) => a.depth - b.depth);
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length && boxes[j].depth - a.depth < .001; j++) {
      const b = boxes[j];
      if (a.sprite.mesh.renderingGroupId === b.sprite.mesh.renderingGroupId
        && a.left < b.right && b.left < a.right && a.bottom < b.top && b.bottom < a.top) {
        unsafe.add(a.sprite); unsafe.add(b.sprite);
      }
    }
  }
  return unsafe;
}

// A flat coplanar run may overlap itself, provided both its primitive order
// and its position among all other alpha-test draws stay unchanged. Ground runs
// use the first original material's sort key. Never override a custom comparator.
const groundOrders = new WeakMap();
function orderGround(scene) {
  let state = groundOrders.get(scene);
  if (state) {
    if (state.group._alphaTestSortCompareFn !== state.compare) return null;
    state.users++; return state;
  }
  const group = scene.renderingManager.getRenderingGroup(0), original = group._alphaTestSortCompareFn;
  if (original !== RenderingGroup.PainterSortCompare) return null;
  const compare = (a, b) => {
    const x = a.getMesh(), y = b.getMesh();
    return (x.metadata?.staticGroundOrder ?? x.material?.uniqueId ?? x.uniqueId)
      - (y.metadata?.staticGroundOrder ?? y.material?.uniqueId ?? y.uniqueId);
  };
  state = { group, original, compare, users: 1 };
  group.alphaTestSortCompareFn = compare;
  groundOrders.set(scene, state);
  return state;
}
function releaseGround(scene, state) {
  if (--state.users) return;
  if (state.group._alphaTestSortCompareFn === state.compare) state.group.alphaTestSortCompareFn = state.original;
  groundOrders.delete(scene);
}

// Retain the original sprites for exact hit masks and occlusion. Only their opaque drawing is
// instanced, with the very same geometry, atlas texture matrix and frozen world matrices. A
// faded/animated/hidden prop immediately returns to its original draw, including alpha sorting.
export class StaticSpriteBatch {
  constructor(scene, world, { scheduleObservation = null } = {}) {
    this.world = world;
    this.scene = scene;
    this.unobserved = new Set(); this.groups = []; this.pendingSlots = new Set(); this.pendingGround = new Set(); this.uploads = new Set(); this.orderedGroups = []; this.disposed = false;
    const caps = scene.getEngine().getCaps();
    if (!caps.instancedArrays || caps.maxVertexAttribs < 11) return;
    const unsafe = orderedOverlaps(scene, world.props ?? []);
    const atlases = new Map(), geometryKeys = new Map();
    const spritesInOrder = (world.props ?? []).slice().sort((a, b) => a.material.uniqueId - b.material.uniqueId);
    this.groundOrder = spritesInOrder.some(p => p.mesh.billboardMode === Mesh.BILLBOARDMODE_NONE) ? orderGround(scene) : null;
    const ranks = new Map(scene.meshes.filter(m => m.renderingGroupId === 0 && m.material?.needAlphaTesting())
      .sort((a, b) => a.material.uniqueId - b.material.uniqueId).map((mesh, i) => [mesh, i]));
    let run = 0, lastRank = -2, lastKey, lastAtlas;
    for (const sprite of spritesInOrder) {
      const ground = sprite.mesh.billboardMode === Mesh.BILLBOARDMODE_NONE;
      if (!compatible(sprite) || unsafe.has(sprite) || (ground && (!this.groundOrder || sprite.mesh.renderingGroupId !== 0))) continue;
      let frames = atlases.get(sprite.atlas);
      if (!frames) atlases.set(sprite.atlas, frames = new Map());
      let geometry = geometryKeys.get(sprite.mesh.geometry);
      if (geometry === undefined) {
        geometry = sprite.mesh.getVerticesDataKinds().map(kind => `${kind}:${Array.from(Float32Array.from(sprite.mesh.getVerticesData(kind)))}`).join('|')
          + `|indices:${Array.from(sprite.mesh.getIndices())}`;
        geometryKeys.set(sprite.mesh.geometry, geometry);
      }
      let key = `${worldSpace(sprite)}:${sprite.mesh.billboardMode}:${geometry}:${sprite.mesh.renderingGroupId}:${sprite.mesh.layerMask}`
        + `:${sprite.material.diffuseColor.asArray()}:${sprite.material.emissiveColor.asArray()}`;
      if (ground) {
        const rank = ranks.get(sprite.mesh);
        if (rank !== lastRank + 1 || key !== lastKey || sprite.atlas !== lastAtlas) run++;
        lastRank = rank; lastKey = key; lastAtlas = sprite.atlas; key += `:run${run}`;
      }
      let sprites = frames.get(key);
      if (!sprites) frames.set(key, sprites = []);
      sprites.push(sprite);
    }
    for (const frames of atlases.values()) for (const sprites of frames.values()) {
      if (sprites.length < 2) continue;
      const first = sprites[0], source = new Mesh(`static-batch-${first.mesh.name}`, scene);
      first.mesh.geometry.applyToMesh(source);
      // Thin-instance attributes live on the geometry; each frame group owns its matrix buffer.
      source.makeGeometryUnique();
      const material = first.material.clone(`${source.name}-ink`), texture = material.diffuseTexture;
      texture.optimizeUVAllocation = false;
      if (worldSpace(first)) new WorldSpaceInstances(material);
      new AtlasInstances(material);
      material.freeze();
      source.material = material;
      source.isPickable = false;
      const ordered = first.mesh.billboardMode === Mesh.BILLBOARDMODE_NONE;
      if (ordered) source.metadata = { staticGroundOrder: first.material.uniqueId };
      source.renderingGroupId = first.mesh.renderingGroupId;
      source.layerMask = first.mesh.layerMask;
      source.freezeWorldMatrix(Matrix.Identity());
      source.doNotSyncBoundingInfo = true;
      const matrices = new Float32Array(sprites.length * 16);
      const slots = sprites.map((sprite, i) => ({ sprite, frame: sprite.frame, flip: sprite.flip,
        mesh: sprite.mesh, material: sprite.material, texture: sprite.texture, atlas: sprite.atlas, diffuse: sprite.material.diffuseColor, emissive: sprite.material.emissiveColor, geometryRef: sprite.mesh.geometry, world: sprite.mesh.worldMatrixFromCache, uv: sprite.texture.getTextureMatrix().clone(), retired: false, layerMask: sprite.mesh.layerMask, billboardMode: sprite.mesh.billboardMode, geometry: sprite.mesh.geometry, matrix: sprite.mesh.getWorldMatrix().clone(),
        matrixVersion: sprite.mesh.getWorldMatrix().updateFlag, active: null, offset: i * 16 }));
      for (const slot of slots) slot.matrix.copyToArray(matrices, slot.offset);
      source.thinInstanceSetBuffer('matrix', matrices, 16, false);
      for (let column = 0; column < 4; column++) {
        const values = new Float32Array(sprites.length * 4);
        for (let i = 0; i < sprites.length; i++) values.set(sprites[i].texture.getTextureMatrix().m.slice(column * 4, column * 4 + 4), i * 4);
        source.thinInstanceSetBuffer(`staticUV${column}`, values, 4, true);
      }
      // Conservative fixed bounds include every slot, also while a faded slot draws separately.
      source.thinInstanceRefreshBoundingInfo();
      // The batch owns these clones; the original sprites continue to own theirs.
      source.onDisposeObservable.addOnce(() => { material.dispose(); texture.dispose(); });
      const group = { source, matrices, slots, ordered, count: 0 };
      this.groups.push(group);
      if (ordered) this.orderedGroups.push(group);
      for (const slot of slots) {
        slot.group = group;
        const notify = (object, key, _before, after) => {
          if (this.disposed) return;
          if (key === 'onGeometryUpdated' || key === 'geometry' || key === 'disposed') slot.retired = true;
          if (object === slot.mesh && key === 'layerMask') { slot.layerMask = after; slot.retired = true; }
          this.invalidate(slot);
        };
        slot.notify = notify; this.unobserved.add(slot); this.invalidate(slot);
      }
    }
    const slots = [...this.unobserved];
    this.stopGeometry = watchStaticGeometry(slots, slot => { slot.retired = true; this.invalidate(slot); });
    if (!this.stopGeometry) for (const slot of slots) slot.retired = true;
    let index = 0;
    const install = () => {
      if (this.disposed || index === slots.length) return false;
      const slot = slots[index++];
      if (!slot.retired) { slot.stop = watchStaticSprite(slot.sprite, slot.notify, { watchGeometry: false }); }
      return index < slots.length;
    };
    if (scheduleObservation && slots.length) this.cancelObservation = scheduleObservation(install); else while (install()) {}
    this.candidates = this.groups.length ? filterCandidates(scene) : null;
    this.disposeObserver = scene.onDisposeObservable.addOnce(() => this.dispose());
    this.sortCompare = this.groundOrder?.group._alphaTestSortCompareFn;
    this.update();
  }

  invalidate(slot) { (slot.group.ordered ? this.pendingGround : this.pendingSlots).add(slot.group.ordered ? slot.group : slot); }

  active(slot, source) {
    if (slot.retired) return false;
    const p = slot.sprite;
    if (p.mesh !== slot.mesh || p.material !== slot.material || p.texture !== slot.texture || p.atlas !== slot.atlas
      || slot.material.diffuseColor !== slot.diffuse || slot.material.emissiveColor !== slot.emissive
      || slot.mesh.geometry !== slot.geometryRef || slot.mesh.worldMatrixFromCache !== slot.world) {
      slot.retired = true; return false;
    }
    const { sprite } = slot, mesh = sprite.mesh;
    return !slot.retired && compatible(sprite) && mesh.isEnabled() && mesh.isVisible
          && sprite.frame === slot.frame && sprite.flip === slot.flip
          && mesh.billboardMode === slot.billboardMode && mesh.geometry === slot.geometry
          && mesh.renderingGroupId === source.renderingGroupId && mesh.worldMatrixFromCache.updateFlag === slot.matrixVersion
          && sprite.material.diffuseColor.equals(source.material.diffuseColor)
          && sprite.material.emissiveColor.equals(source.material.emissiveColor)
          && sprite.material.disableDepthWrite === source.material.disableDepthWrite && sprite.material.fillMode === source.material.fillMode
          && sprite.texture.optimizeUVAllocation === false && sprite.texture.getTextureMatrix().equals(slot.uv);
  }

  apply(slot, active) {
    if (active === slot.active) return;
    const { group, offset, mesh } = slot, { matrices } = group;
    if (slot.active) group.count--;
    slot.active = active;
    if (active) { group.count++; this.candidates.hidden.add(mesh); }
    else this.candidates.hidden.delete(mesh);
    this.candidates.dirty = true;
    const layerMask = active ? 0 : slot.layerMask;
    if (!mesh.isDisposed() && mesh.layerMask !== layerMask) setWithoutNotice(mesh, 'layerMask', layerMask);
    if (active) slot.matrix.copyToArray(matrices, offset);
    else { matrices.fill(0, offset, offset + 16); matrices[offset + 15] = 1; }
    this.uploads.add(group);
  }

  update() {
    if (this.disposed) return;
    for (const slot of this.unobserved) {
      if (slot.mesh.layerMask !== (slot.active ? 0 : slot.layerMask)) { slot.layerMask = slot.mesh.layerMask; slot.retired = true; }
      this.invalidate(slot);
      // One final legacy check closes the mutation window before installation,
      // including external layer-mask edits that must survive disposal.
      if (slot.stop || slot.retired) this.unobserved.delete(slot);
    }
    const compare = this.groundOrder?.group._alphaTestSortCompareFn;
    if (compare !== this.sortCompare) { this.sortCompare = compare; for (const group of this.orderedGroups) this.pendingGround.add(group); }
    for (const slot of this.pendingSlots) this.apply(slot, this.active(slot, slot.group.source));
    this.pendingSlots.clear();
    for (const group of this.pendingGround) {
      let active = this.groundOrder.group._alphaTestSortCompareFn === this.groundOrder.compare;
      if (active) for (const slot of group.slots) if (!this.active(slot, group.source)) { active = false; break; }
      for (const slot of group.slots) this.apply(slot, active);
    }
    this.pendingGround.clear();
    for (const group of this.uploads) { group.source.thinInstanceBufferUpdated('matrix'); group.source.setEnabled(group.count > 0); }
    this.uploads.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelObservation?.(); this.stopGeometry?.(); this.unobserved.clear();
    this.scene.onDisposeObservable.remove(this.disposeObserver);
    for (const { source, slots } of this.groups) {
      for (const slot of slots) {
        const { mesh, layerMask } = slot; slot.stop?.();
        this.candidates.hidden.delete(mesh); this.candidates.dirty = true;
        if (!mesh.isDisposed() && mesh.layerMask !== layerMask) setWithoutNotice(mesh, 'layerMask', layerMask);
      }
      source.dispose();
    }
    this.groups.length = this.orderedGroups.length = 0; this.pendingSlots.clear(); this.pendingGround.clear(); this.uploads.clear();
    if (this.groundOrder) { releaseGround(this.scene, this.groundOrder); this.groundOrder = null; }
    if (this.candidates) { releaseCandidates(this.scene, this.candidates); this.candidates = null; }
  }
}
