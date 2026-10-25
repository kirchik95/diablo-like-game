import { staticMaterialDirty } from './static-material-dirty.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
// Static-only observation shapes. Babylon's native prototypes are restored before
// construction returns; actors and callback-created objects keep their own data.
const states = new WeakMap(), specs = new WeakMap(), STATE = Symbol('static-sprite-state');
// Scalar getters run inside Babylon's loops. Keep their state lookup on the
// object's normal data path; WeakMap remains the registry for unknown receivers.
function stateOf(object) {
  const state = object?.[STATE];
  return state?.object === object ? state : states.get(object);
}
const groups = {
  sprite: { data: ['mesh', 'material', 'texture', 'atlas', 'frame', 'flip'] },
  color: { data: ['r', 'g', 'b'] },
  mesh: { access: ['isVisible', 'visibility', 'billboardMode', 'parent', 'renderingGroupId', 'layerMask', 'material'], methods: ['freezeWorldMatrix', 'unfreezeWorldMatrix'] },
  matrix: { methods: ['markAsUpdated', 'copyFrom'] },
  material: { data: ['alphaCutOff', 'zOffset', 'zOffsetUnits', 'diffuseColor', 'emissiveColor', 'disableDepthWrite'], access: ['alpha', 'transparencyMode', 'disableLighting', 'useAlphaFromDiffuseTexture', 'backFaceCulling', 'diffuseTexture', 'fillMode'] },
  texture: { data: ['uScale', 'vScale', 'uOffset', 'vOffset', 'uAng', 'vAng', 'wAng', 'uRotationCenter', 'vRotationCenter', 'wRotationCenter', 'homogeneousRotationInUVTransform', 'optimizeUVAllocation'], access: ['coordinatesIndex'] },
};
function descriptor(proto, key) {
  for (let p = proto; p; p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, key);
    if (d) return d;
  }
}
function sweep(object, state) {
  if (state.emitting) return;
  const list = state.listeners;
  if (list) {
    let count = 0;
    for (const entry of list) if (entry.registrations.length) list[count++] = entry;
    list.length = count;
    if (!count) state.listeners = null;
  }
  if (!state.listeners && !state.holds) release(object, state);
}
function emit(object, state, index, before, after, args) {
  if (state.silent || !state.listeners) return;
  const bit = 1 << index;
  state.emitting++;
  try { for (const entry of state.listeners) if (entry.mask & bit) entry.fn(object, state.spec.keys[index], before, after, args); }
  finally { state.emitting--; sweep(object, state); }
}
function stateFor(object, spec, born) {
  const state = { object, spec, born, values: new Array(spec.keys.length), methodValues: [], methodAssigned: 0, listeners: null, silent: 0, emitting: 0, holds: 0, snapshots: null };
  states.set(object, state);
  Object.defineProperty(object, STATE, { value: state, writable: true, configurable: true });
  Object.setPrototypeOf(object, spec.prototype);
  return state;
}
function shapeFor(proto, kind) {
  let kinds = specs.get(proto);
  if (!kinds) specs.set(proto, kinds = new Map());
  if (kinds.has(kind)) return kinds.get(kind);
  const group = groups[kind], fields = [...(group.data ?? []), ...(group.access ?? []), ...(group.methods ?? [])];
  const spec = { kind, original: proto, prototype: Object.create(proto), keys: fields, indexes: new Map(fields.map((key, i) => [key, i])), masks: new WeakMap(), dataCount: group.data?.length ?? 0 };
  for (let i = 0; i < fields.length; i++) {
    const key = fields[i], original = descriptor(proto, key);
    if (group.methods?.includes(key)) {
      if (typeof original?.value !== 'function' || original.writable === false) return null;
      const invoke = function(...args) {
        const state = stateOf(this), fn = state?.methodAssigned & (1 << i) ? state.methodValues[i] : original.value;
        try { return Reflect.apply(fn, this, args); }
        finally { if (state) emit(this, state, i, undefined, undefined, args); }
      };
      Object.defineProperty(spec.prototype, key, { configurable: true, enumerable: original.enumerable, get() { return invoke; }, set(value) { const state = stateOf(this); state.methodValues[i] = value; state.methodAssigned |= 1 << i; emit(this, state, i); } });
    } else if (i < spec.dataCount) {
      Object.defineProperty(spec.prototype, key, { configurable: true, enumerable: true,
        get() { return stateOf(this)?.values[i]; },
        set(value) { const state = stateOf(this), before = state.values[i]; state.values[i] = value; if (state.listeners && !state.silent && !Object.is(before, value)) emit(this, state, i, before, value); },
      });
    } else {
      if (!original?.get || !original.set) return null;
      Object.defineProperty(spec.prototype, key, { configurable: true, enumerable: original.enumerable, get: original.get,
        set(value) { const state = stateOf(this); if (!state?.listeners || state.silent) { original.set.call(this, value); return; } const before = original.get.call(this); try { original.set.call(this, value); } finally { const after = original.get.call(this); if (state && !Object.is(before, after)) emit(this, state, i, before, after); } },
      });
    }
  }
  if (kind === 'material') Object.defineProperty(spec.prototype, '_markAllSubMeshesAsDirty', { configurable: true, writable: true, value: staticMaterialDirty });
  kinds.set(kind, spec);
  return spec;
}
const meshCaptures = new WeakMap();
function beginMeshCapture(scene, context) {
  let holder = meshCaptures.get(scene);
  if (!holder) {
    const original = scene.addMesh, spec = shapeFor(Mesh.prototype, 'mesh');
    holder = { context: null };
    scene.addMesh = function(mesh, ...args) {
      const current = this === scene && holder.context;
      const adopt = current && !current.paused && !scene._blockEntityCollection && spec
        && Object.getPrototypeOf(mesh) === Mesh.prototype && !Object.hasOwn(mesh, '_internalMeshDataInfo');
      if (current) current.paused++;
      try {
        const result = original.call(this, mesh, ...args);
        if (adopt && Object.getPrototypeOf(mesh) === Mesh.prototype && !Object.hasOwn(mesh, '_internalMeshDataInfo')) stateFor(mesh, spec, true);
        return result;
      } finally { if (current) current.paused--; }
    };
    meshCaptures.set(scene, holder);
  }
  holder.context = context;
  return () => { holder.context = null; };
}
let capture = null;
export function captureStaticSpriteState(StandardMaterial, Texture, Observable, build, scene = null) {
  if (capture) return build();
  const restore = [], context = { paused: 0 }; capture = context;
  try {
    if (scene) restore.push(beginMeshCapture(scene, context));
    for (const [type, kind] of [[StandardMaterial, 'material'], [Texture, 'texture']]) {
      const proto = type.prototype, spec = shapeFor(proto, kind);
      if (!spec) continue;
      const originals = groups[kind].data.map(key => [key, Object.getOwnPropertyDescriptor(proto, key)]);
      if (originals.some(([, own]) => own?.configurable === false)) continue;
      for (let i = 0; i < spec.dataCount; i++) {
        const [key, own] = originals[i];
        Object.defineProperty(proto, key, { configurable: true, enumerable: true,
          get() { return stateOf(this)?.values[i]; },
          set(value) {
            let state = stateOf(this);
            if (!state && !context.paused && Object.getPrototypeOf(this) === proto) state = stateFor(this, spec, true);
            if (state) { const before = state.values[i]; state.values[i] = value; if (state.listeners && !state.silent && !Object.is(before, value)) emit(this, state, i, before, value); }
            else Object.defineProperty(this, key, { value, writable: true, configurable: true, enumerable: true });
          },
        });
        restore.push(() => { if (own) Object.defineProperty(proto, key, own); else delete proto[key]; });
      }
    }
    // Observers may synchronously construct actors. Pause only adoption; existing
    // scenery keeps its side-state getters/setters while the callback runs.
    for (const key of ['notifyObservers', 'notifyObserver']) {
      const own = Object.getOwnPropertyDescriptor(Observable.prototype, key);
      if (!own || own.configurable === false) continue;
      Object.defineProperty(Observable.prototype, key, { ...own, value: function(...args) { context.paused++; try { return own.value.apply(this, args); } finally { context.paused--; } } });
      restore.push(() => Object.defineProperty(Observable.prototype, key, own));
    }
    return build();
  } finally { for (let i = restore.length - 1; i >= 0; i--) restore[i](); capture = null; }
}
function promote(object, kind) {
  let state = stateOf(object);
  if (state) return state.spec.kind === kind ? state : null;
  if ((kind === 'material' || kind === 'texture') || !Object.isExtensible(object)) return null;
  const proto = Object.getPrototypeOf(object), spec = shapeFor(proto, kind);
  if (!spec) return null;
  const snapshots = [];
  for (let i = 0; i < spec.keys.length; i++) {
    const own = Object.getOwnPropertyDescriptor(object, spec.keys[i]);
    if (i < spec.dataCount) { if (!own || !('value' in own) || !own.configurable || !own.writable) return null; }
    else if (own) return null;
    snapshots.push(own);
  }
  state = stateFor(object, spec, false); state.snapshots = snapshots;
  for (let i = 0; i < spec.dataCount; i++) { state.values[i] = snapshots[i].value; delete object[spec.keys[i]]; }
  return state;
}
function release(object, state) {
  if (state.born || state.holds || state.emitting) return;
  for (let i = 0; i < state.spec.dataCount; i++) {
    const own = Object.getOwnPropertyDescriptor(object, state.spec.keys[i]);
    const shared = Object.getOwnPropertyDescriptor(state.spec.prototype, state.spec.keys[i]);
    if (own && (own.get === shared.get || own.set === shared.set)) return;
  }
  for (let i = 0; i < state.spec.dataCount; i++) if (!Object.hasOwn(object, state.spec.keys[i])) Object.defineProperty(object, state.spec.keys[i], { ...state.snapshots[i], value: state.values[i] });
  for (let i = 0; i < state.spec.keys.length; i++) if (state.methodAssigned & (1 << i)) Object.defineProperty(object, state.spec.keys[i], { value: state.methodValues[i], configurable: true, writable: true, enumerable: true });
  if (Object.getPrototypeOf(object) === state.spec.prototype) Object.setPrototypeOf(object, state.spec.original);
  // Clearing the data slot avoids deleting a non-last native field, which can
  // normalize a Mesh. It retains no listener/state after the final unsubscribe.
  object[STATE] = undefined;
  states.delete(object);
}
export function watchSharedState(object, kind, listener, keys = null) {
  const state = promote(object, kind);
  if (!state) return null;
  const spec = state.spec;
  // Class-field DefineField or external own overrides shadow inherited hooks.
  for (const key of spec.keys) if (Object.hasOwn(object, key)) return null;
  let mask;
  if (!keys) mask = (1 << spec.keys.length) - 1;
  else {
    mask = spec.masks.get(keys);
    if (mask === undefined) {
      mask = 0;
      for (const key of keys) { const index = spec.indexes.get(key); if (index === undefined) return null; mask |= 1 << index; }
      spec.masks.set(keys, mask);
    }
  }
  const listeners = state.listeners ??= [];
  let entry = listeners.find(e => e.fn === listener && e.registrations.length);
  if (!entry) { entry = { fn: listener, mask: 0, registrations: [] }; listeners.push(entry); }
  entry.registrations.push(mask); entry.mask |= mask;
  let stopped = false;
  return () => {
    if (stopped) return; stopped = true;
    entry.registrations.splice(entry.registrations.indexOf(mask), 1); entry.mask = 0;
    for (const registered of entry.registrations) entry.mask |= registered;
    sweep(object, state);
  };
}
export function watchExistingSharedProperty(object, key, listener) {
  const state = stateOf(object);
  if (!state || !state.spec.indexes.has(key)) return null;
  return watchSharedState(object, state.spec.kind, listener, [key]);
}
export function setSharedWithoutNotice(object, key, value) {
  const state = stateOf(object);
  if (!state) return false;
  state.silent++;
  try { object[key] = value; } finally { state.silent--; }
  return true;
}

export function retainSharedState(object) {
  const state = stateOf(object);
  if (!state) return null;
  state.holds++;
  return () => { state.holds--; sweep(object, state); };
}

export function isCapturedStaticMaterial(material) {
  const state = stateOf(material);
  return state?.born === true && state.spec.kind === 'material';
}
