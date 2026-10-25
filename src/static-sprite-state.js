export { scheduleStaticObservation } from './static-observation.js';
import { watchSharedState, watchExistingSharedProperty, setSharedWithoutNotice, retainSharedState } from './static-sprite-shape.js';
// Shared static-shape subscriptions, with conservative per-property fallback
// for unmanaged/custom objects. Actor sprites are never subscribed.
const properties = new WeakMap();
const setters = new Map(), callbackGetters = new Map();
// Shared setter functions let native engine accessors retain a common layout.
// Native reads never need a registry lookup or a per-instance forwarding getter.
function setterFor(key, descriptor) {
  let bySetter = setters.get(key);
  if (!bySetter) setters.set(key, bySetter = { accessors: new WeakMap(), data: null });
  const original = descriptor?.set;
  const cached = original ? bySetter.accessors.get(original) : bySetter.data;
  if (cached) return cached;
  const setter = function(value) {
    const state = properties.get(this)?.get(key);
    if (!state || state.set !== setter) {
      if (original) original.call(this, value);
      else Object.defineProperty(this, key, { value, writable: true, configurable: true, enumerable: true });
      return;
    }
    const before = state.read();
    try {
      if (state.data) { state.value = value; state.assigned = true; }
      else state.descriptor.set.call(this, value);
    } finally {
      const after = state.read();
      if (!Object.is(before, after)) state.emit(before, after);
    }
  };
  if (original) bySetter.accessors.set(original, setter); else bySetter.data = setter;
  return setter;
}
function callbackGetterFor(key) {
  if (!callbackGetters.has(key)) callbackGetters.set(key, function() { return properties.get(this)?.get(key)?.dispatch; });
  return callbackGetters.get(key);
}
function descriptorOf(object, key) {
  for (let at = object; at; at = Object.getPrototypeOf(at)) {
    const descriptor = Object.getOwnPropertyDescriptor(at, key);
    if (descriptor) return descriptor;
  }
}
function observe(object, key, listener, callback) {
  let fields = properties.get(object), state = fields?.get(key);
  if (state) {
    const current = Object.getOwnPropertyDescriptor(object, key);
    if (state.callback !== callback || current?.get !== state.get || current?.set !== state.set) return null;
  } else {
    const own = Object.getOwnPropertyDescriptor(object, key), descriptor = descriptorOf(object, key);
    if (own?.configurable === false || (!own && !Object.isExtensible(object))) return null;
    const data = !descriptor || 'value' in descriptor;
    if ((data && descriptor?.writable === false) || (!data && (!descriptor.get || !descriptor.set))) return null;
    state = { releaseShared: retainSharedState(object), own, descriptor, data, value: data ? object[key] : undefined, callback, listeners: new Map(), silent: 0, assigned: false };
    const read = data ? () => state.value : () => descriptor.get.call(object);
    const emit = (before, after, args) => {
      if (!state.silent) for (const notify of state.listeners.keys()) notify(object, key, before, after, args);
    };
    state.read = read; state.emit = emit;
    if (callback) state.dispatch = function(...args) {
      try { const fn = read(); return fn == null ? undefined : Reflect.apply(fn, this, args); }
      finally { emit(undefined, undefined, args); }
    };
    state.get = callback ? callbackGetterFor(key) : data ? read : descriptor.get;
    state.set = setterFor(key, descriptor);
    Object.defineProperty(object, key, { configurable: true, enumerable: descriptor?.enumerable ?? true, get: state.get, set: state.set });
    if (!fields) properties.set(object, fields = new Map());
    fields.set(key, state);
  }
  state.listeners.set(listener, (state.listeners.get(listener) ?? 0) + 1);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const count = state.listeners.get(listener);
    if (count > 1) state.listeners.set(listener, count - 1); else state.listeners.delete(listener);
    if (state.listeners.size) return;
    const current = Object.getOwnPropertyDescriptor(object, key);
    if (current?.get === state.get && current?.set === state.set) {
      if (state.own) Object.defineProperty(object, key, state.data ? { ...state.own, value: state.value } : state.own);
      else if (state.data && state.assigned) Object.defineProperty(object, key, { value: state.value, writable: true, configurable: true, enumerable: true });
      else delete object[key];
    }
    state.releaseShared?.();
    fields.delete(key);
    if (!fields.size) properties.delete(object);
  };
}
export const watchProperty = (object, key, listener) => watchExistingSharedProperty(object, key, listener) ?? observe(object, key, listener, false);
export const watchCallback = (object, key, listener) => observe(object, key, listener, true);
export function setWithoutNotice(object, key, value) {
  const state = properties.get(object)?.get(key);
  if (state) state.silent++;
  try { if (!setSharedWithoutNotice(object, key, value)) object[key] = value; }
  finally { if (state) state.silent--; }
}
const FRAME_KEYS = ['frame', 'flip'];
const OCCLUSION_KEYS = ['frame', 'flip', 'material'];
const OPACITY_KEYS = ['alpha', 'transparencyMode'];
export function watchMaterialOpacity(material, listener) {
  const shared = watchSharedState(material, 'material', listener, OPACITY_KEYS);
  if (shared) return shared;
  const alpha = watchProperty(material, 'alpha', listener), mode = watchProperty(material, 'transparencyMode', listener);
  if (!alpha || !mode) { alpha?.(); mode?.(); return null; }
  return () => { alpha(); mode(); };
}
export function watchSpriteFrame(sprite, listener) {
  return watchSpriteKeys(sprite, listener, FRAME_KEYS);
}
export function watchSpriteOcclusion(sprite, listener) {
  return watchSpriteKeys(sprite, listener, OCCLUSION_KEYS);
}
function watchSpriteKeys(sprite, listener, keys) {
  const shared = watchSharedState(sprite, 'sprite', listener, keys);
  if (shared) return shared;
  const stops = [];
  for (const key of keys) {
    const stop = watchProperty(sprite, key, listener);
    if (!stop) { for (const undo of stops) undo(); return null; }
    stops.push(stop);
  }
  return () => { for (const stop of stops) stop(); };
}
const geometryReleases = new WeakMap();
function watchGeometryRelease(geometry, mesh, listener) {
  let state = geometryReleases.get(geometry);
  if (!state) {
    const meshes = new Map();
    const stop = watchCallback(geometry, 'releaseForMesh', (_object, _key, _before, _after, args) => {
      const target = args?.[0];
      for (const notify of meshes.get(target)?.keys() ?? []) notify(target, 'geometry');
    });
    if (!stop) return null;
    state = { meshes, stop }; geometryReleases.set(geometry, state);
  }
  let listeners = state.meshes.get(mesh);
  if (!listeners) state.meshes.set(mesh, listeners = new Map());
  listeners.set(listener, (listeners.get(listener) ?? 0) + 1);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const count = listeners.get(listener);
    if (count > 1) listeners.set(listener, count - 1); else listeners.delete(listener);
    if (!listeners.size) state.meshes.delete(mesh);
    if (!state.meshes.size) { state.stop(); geometryReleases.delete(geometry); }
  };
}
// Shared geometry can change before the deferred per-slot observers exist.
export function watchStaticGeometry(slots, listener) {
  const stops = [], geometries = new Map();
  for (const slot of slots) {
    let members = geometries.get(slot.geometry);
    if (!members) geometries.set(slot.geometry, members = new Map());
    members.set(slot.mesh, slot);
  }
  for (const [geometry, members] of geometries) {
    const changed = watchCallback(geometry, 'onGeometryUpdated', () => { for (const slot of members.values()) listener(slot); });
    const indices = watchCallback(geometry, 'updateIndices', () => { for (const slot of members.values()) listener(slot); });
    const release = watchCallback(geometry, 'releaseForMesh', (_o, _k, _b, _a, args) => { const slot = members.get(args?.[0]); if (slot) listener(slot); });
    if (!changed || !indices || !release) { changed?.(); indices?.(); release?.(); for (const stop of stops) stop(); return null; }
    stops.push(changed, indices, release);
  }
  return () => { for (const stop of stops) stop(); };
}
export function watchStaticSprite(sprite, listener, { watchGeometry = true } = {}) {
  const stops = [], mesh = sprite.mesh, material = sprite.material, texture = sprite.texture;
  const stop = () => { for (const undo of stops) undo(); stops.length = 0; };
  const add = (object, keys, kind) => {
    const shared = watchSharedState(object, kind, listener);
    if (shared) { stops.push(shared); return true; }
    for (const key of keys) {
      const undo = watchProperty(object, key, listener);
      if (!undo) return false;
      stops.push(undo);
    }
    return true;
  };
  if (!add(sprite, ['mesh', 'material', 'texture', 'atlas', 'frame', 'flip'], 'sprite')
    || !add(mesh, ['isVisible', 'visibility', 'billboardMode', 'parent', 'renderingGroupId', 'layerMask', 'material'], 'mesh')
    || !add(material, ['alpha', 'transparencyMode', 'disableLighting', 'useAlphaFromDiffuseTexture', 'backFaceCulling', 'diffuseTexture', 'alphaCutOff', 'zOffset', 'zOffsetUnits', 'diffuseColor', 'emissiveColor', 'disableDepthWrite', 'fillMode'], 'material')
    || !add(material.diffuseColor, ['r', 'g', 'b'], 'color') || !add(material.emissiveColor, ['r', 'g', 'b'], 'color')
    || !add(texture, ['uScale', 'vScale', 'uOffset', 'vOffset', 'uAng', 'vAng', 'wAng', 'uRotationCenter', 'vRotationCenter', 'wRotationCenter', 'homogeneousRotationInUVTransform', 'coordinatesIndex', 'optimizeUVAllocation'], 'texture')
    || !add(mesh.worldMatrixFromCache, ['updateFlag'], 'matrix')
    || !add(texture.getTextureMatrix(), ['updateFlag'], 'matrix')) { stop(); return null; }
  // Public mutation routes preserve the hot Mesh backing fields as data.
  for (const key of Object.hasOwn(mesh, 'isVisible') ? ['freezeWorldMatrix', 'unfreezeWorldMatrix'] : []) {
    const undo = watchCallback(mesh, key, listener);
    if (!undo) { stop(); return null; }
    stops.push(undo);
  }
  if (watchGeometry) {
  const geometry = watchCallback(mesh.geometry, 'onGeometryUpdated', listener);
  if (!geometry) { stop(); return null; }
  stops.push(geometry);
  const release = watchGeometryRelease(mesh.geometry, mesh, listener);
  if (!release) { stop(); return null; }
  stops.push(release);
  }
  for (const [observable, key] of [[mesh.onEnabledStateChangedObservable, 'enabled'], [mesh.onAfterWorldMatrixUpdateObservable, 'matrix'], [mesh.onDisposeObservable, 'disposed']]) {
    const observer = observable.add(() => listener(mesh, key));
    stops.push(() => observable.remove(observer));
  }
  return stop;
}

// Keep Babylon's setter and callback order. Occlusion caching already skips
// unchanged values; no scene-wide validation belongs on the fade hot path.
export function setMaterialOpacity(material, alpha, mode, _Material) {
  if (material.alpha !== alpha) material.alpha = alpha;
  if (material.transparencyMode !== mode) material.transparencyMode = mode;
}
