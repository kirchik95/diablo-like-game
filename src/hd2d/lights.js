// Point lighting at world-pixel resolution. No lights, meshes or render targets are added.
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import { RegisterClass } from '@babylonjs/core/Misc/typeStore.js';
import { Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector.js';
import { sceneLights } from '../scene-light.js';

export const id = 'lights';
export const order = 30;
const states = new WeakMap();
const INKS = {
  amber: [1.5, .91, .40], cyan: [.38, 1.22, 1.15], spirit: [.43, 1.18, 1.10],
  lantern: [.40, 1.17, 1.12], pink: [1.12, .68, .98], ritual: [1.10, .66, .96],
};
const BUDGET = { off: 0, low: 4, high: 8 };
// Midway between the original art and the first night-lighting pass.
const AMBIENT = [.75, .79, .87];
const MOON_VECTOR = new Vector3(...AMBIENT);

export function sourcesFor(world) {
  const result = sceneLights(world).map(light => ({ ...light, height: light.ink === 'amber' ? .85 : 1.25,
    radius: light.ink === 'amber' ? 6.5 : light.ink === 'lantern' ? 4.8 : light.ink === 'pink' ? 4.06 : 5.8, power: .9, enabled: true }));
  for (const zone of world.zones ?? [world]) if (zone.ritual) {
    result.push({ x: zone.ritual.x, y: zone.ritual.y, ink: 'ritual', seed: result.length,
      height: 1.6, radius: 4.9, power: 1.05, ritual: true, enabled: true });
  }
  return result;
}

// Fixed buffers, stable nearest selection, whole-step flicker at 8 Hz. Point positions use
// Babylon coordinates (x,height,y). RGB and strength are separate from position/radius.
export class PointField {
  constructor(sources) {
    this.sources = sources;
    this.positions = new Float32Array(32); this.colors = new Float32Array(32);
    this.chosen = new Array(8).fill(null); this.distances = new Float64Array(8);
    this.count = 0; this.step = NaN; this.cellX = NaN; this.cellY = NaN; this.budget = -1;
    this.dirty = true; this.revision = 0;
  }
  update(x, y, time, budget, still) {
    const cellX = Math.floor(x), cellY = Math.floor(y), step = still ? -1 : Math.floor(time * 8);
    const moved = cellX !== this.cellX || cellY !== this.cellY || budget !== this.budget || this.dirty;
    if (!moved && step === this.step) return false;
    if (moved) {
      this.cellX = cellX; this.cellY = cellY; this.budget = budget; this.dirty = false;
      this.chosen.fill(null); this.distances.fill(Infinity); this.count = 0;
      for (const light of this.sources) {
        if (light.enabled === false) continue;
        const d = (light.x - x) ** 2 + (light.y - y) ** 2;
        for (let i = 0; i < budget; i++) if (d < this.distances[i]) {
          for (let j = budget - 1; j > i; j--) { this.distances[j] = this.distances[j - 1]; this.chosen[j] = this.chosen[j - 1]; }
          this.distances[i] = d; this.chosen[i] = light; break;
        }
      }
    }
    this.step = step; this.positions.fill(0); this.colors.fill(0); this.count = 0;
    for (let i = 0; i < budget && this.chosen[i]; i++) {
      const light = this.chosen[i], k = i * 4, rgb = INKS[light.ink] ?? INKS.spirit;
      const n = Math.sin(step * 12.9898 + light.seed * 78.233) * 43758.5453;
      // Four authored-looking fire intensities; spirit/ritual remain steady.
      const flicker = still || light.ink !== 'amber' ? 1 : .91 + Math.floor((n - Math.floor(n)) * 4) * .06;
      this.positions[k] = light.x; this.positions[k + 1] = light.height;
      this.positions[k + 2] = light.y; this.positions[k + 3] = light.radius;
      this.colors[k] = rgb[0]; this.colors[k + 1] = rgb[1]; this.colors[k + 2] = rgb[2];
      this.colors[k + 3] = light.power * flicker; this.count++;
    }
    this.revision++;
    return true;
  }
}

// Shared by the ground shader and the material plugin. The sprite low variant runs this
// once per vertex at its per-instance origin; high runs per texel with an optional normal.
export const pointDeclarations = `
  uniform vec4 hdLightPosition[8];
  uniform vec4 hdLightColor[8];
  uniform vec4 hdLightParams;
  uniform vec3 hdMoon;
`;
export const pointFunction = `
  vec3 hdPointLight(vec3 point, vec3 normal) {
    vec3 illumination = hdMoon;
    for (int i = 0; i < HD_LIGHT_COUNT; i++) {
      if (float(i) >= hdLightParams.x) break;
      vec3 delta = hdLightPosition[i].xyz - point;
      float distanceToLight = length(delta);
      float t = max(0.0, 1.0 - distanceToLight / hdLightPosition[i].w);
      float energy = t * t * (3.0 - 2.0 * t) * hdLightColor[i].w;
      float facing = .65 + .35 * max(0.0, dot(normal, delta / max(distanceToLight, .001)));
      #ifdef HD_LIGHT_SMOOTH_GROUND
      illumination += hdLightColor[i].rgb * energy * facing;
      #else
      illumination += hdLightColor[i].rgb * floor(energy * facing * 3.0 + .5) / 3.0;
      #endif
    }
    return min(illumination, vec3(1.8));
  }
`;

function stateFor(scene) {
  let state = states.get(scene);
  if (!state) {
    state = { tier: 'off', materials: new Set(), plugins: new Set(), atlases: new WeakMap(), normalRequests: new WeakMap(), revision: 0 };
    states.set(scene, state);
  }
  return state;
}

// Demand the host normal service only on a new albedo binding/tier. The service owns
// transport and disposal. One completion record is shared by every clone of an atlas.
function requestNormal(material, state) {
  const loader = state.renderer?.hd2dNormals, source = material.diffuseTexture, key = source?._texture;
  if (state.tier !== 'high' || loader?.tier !== 'high' || !key || state.normalRequests.has(key)) return;
  const record = { texture: null };
  state.normalRequests.set(key, record);
  loader.load(source).then(texture => { record.texture = texture; });
}

// Called only by the existing flat/sprite material path. Unlit FX retain their art.
// Atlas.normalTexture (or material.metadata.hd2dNormalTexture) is the optional loader handoff.
export function registerMaterial(material, atlas = null) {
  if (material.metadata?.hd2dUnlit) return;
  const state = stateFor(material.getScene());
  if (!state.materials.has(material)) {
    state.materials.add(material);
    material.onDisposeObservable.addOnce(() => state.materials.delete(material));
  }
  if (atlas && material.diffuseTexture?._texture) state.atlases.set(material.diffuseTexture._texture, atlas);
  if (state.tier !== 'off' && !material.pluginManager?.getPlugin('HdPointLighting')) new HdPointLighting(material);
  requestNormal(material, state);
}

class HdPointLighting extends MaterialPluginBase {
  constructor(material) {
    super(material, 'HdPointLighting', 300, { HD_LIGHT_COUNT: 0, HD_LIGHT_NORMAL: false }, true, false);
    this.state = stateFor(material.getScene());
    this.registerForExtraEvents = true;
    this._enable(true);
    this.state.materials.add(material); this.state.plugins.add(this);
    this.normal = null; this.lastNormal = null;
  }
  getClassName() { return 'HdPointLighting'; }
  normalTexture() {
    const material = this._material;
    return material.metadata?.hd2dNormalTexture
      ?? this.state.atlases.get(material.diffuseTexture?._texture)?.normalTexture
      ?? this.state.normalRequests.get(material.diffuseTexture?._texture)?.texture ?? null;
  }
  prepareDefines(defines) {
    defines.HD_LIGHT_COUNT = BUDGET[this.state.tier];
    this.normal = this.state.tier === 'high' ? this.normalTexture() : null;
    defines.HD_LIGHT_NORMAL = !!this.normal?.isReady() && !!this._material.diffuseTexture;
  }
  getUniforms() { return { externalUniforms: ['hdLightPosition', 'hdLightColor', 'hdLightParams', 'hdMoon'] }; }
  getSamplers(samplers) { samplers.push('hdNormalSampler'); }
  hardBindForSubMesh(_buffer, _scene, _engine, subMesh) {
    if (this.state.tier === 'off') return;
    const effect = subMesh.effect, state = this.state, field = state.field;
    if (!effect || !field) return;
    // An Effect is shared by all compatible props/actors: upload the shared arrays once per
    // field revision, even when a frozen thin-instance material skips its normal bind path.
    if (state.uploaded.get(effect) !== state.revision) {
      effect.setArray4('hdLightPosition', field.positions); effect.setArray4('hdLightColor', field.colors);
      effect.setFloat4('hdLightParams', field.count, 1, 0, 0);
      effect.setFloat3('hdMoon', ...AMBIENT);
      state.uploaded.set(effect, state.revision);
    }
    if (this.normal?.isReady()) effect.setTexture('hdNormalSampler', this.normal);
  }
  getCustomCode(type) {
    if (type === 'vertex') return {
      CUSTOM_VERTEX_DEFINITIONS: `
        #if HD_LIGHT_COUNT > 0
        varying vec3 vHdLight;
        varying float vHdFlip;
        ${pointDeclarations}
        ${pointFunction}
        #endif`,
      CUSTOM_VERTEX_UPDATE_WORLDPOS: `
        #if HD_LIGHT_COUNT > 0
        vHdLight = hdPointLight(finalWorld[3].xyz + vec3(0.0, .55, 0.0), vec3(.612372, .5, .612372));
        #ifdef STATIC_ATLAS_INSTANCES
        vHdFlip = sign(staticUV0.x);
        #else
        #ifdef DIFFUSE
        vHdFlip = sign(diffuseMatrix[0].x);
        #else
        vHdFlip = 1.0;
        #endif
        #endif
        #endif`,
    };
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
        #if HD_LIGHT_COUNT > 0
        varying vec3 vHdLight;
        varying float vHdFlip;
        #if HD_LIGHT_COUNT > 4
        ${pointDeclarations}
        ${pointFunction}
        #ifdef HD_LIGHT_NORMAL
        uniform sampler2D hdNormalSampler;
        #endif
        #endif
        #endif`,
      CUSTOM_FRAGMENT_BEFORE_FOG: `
        #if HD_LIGHT_COUNT > 0
        vec3 hdMultiplier = vHdLight;
        #if HD_LIGHT_COUNT > 4
        vec3 hdNormal = vec3(.612372, .5, .612372);
        #ifdef HD_LIGHT_NORMAL
        vec3 hdTangent = texture2D(hdNormalSampler, vDiffuseUV).rgb * 2.0 - 1.0;
        hdTangent.x *= vHdFlip;
        hdNormal = normalize(vec3(-.707107, 0.0, .707107) * hdTangent.x
          + vec3(-.353553, .866025, -.353553) * hdTangent.y + hdNormal * hdTangent.z);
        #endif
        hdMultiplier = hdPointLight(vPositionW, hdNormal);
        #endif
        // Keep the hottest fire/magic pixels emissive; outlines and alpha are untouched.
        float hdHot = step(.82, max(baseColor.r, max(baseColor.g, baseColor.b)))
          * step(.40, max(baseColor.r, max(baseColor.g, baseColor.b)) - min(baseColor.r, min(baseColor.g, baseColor.b)));
        color.rgb *= max(hdMultiplier, vec3(hdHot));
        #endif`,
    };
  }
  dispose() { this.state.plugins.delete(this); this.state.materials.delete(this._material); }
}
RegisterClass('BABYLON.HdPointLighting', HdPointLighting);

export function install({ scene, renderer, camera, tier = 'off' }) {
  const state = stateFor(scene);
  state.renderer = renderer; state.uploaded = new WeakMap();
  const params = new Vector4(0, 1, 0, 0);
  let world = null, ground = null, disposed = false;
  function setTier(next) {
    next = next in BUDGET ? next : 'off';
    if (next === state.tier) return;
    state.tier = next; state.revision++;
    if (next === 'high') {
      state.normalLoader = renderer.hd2dNormals; state.normalTier = renderer.hd2dNormals?.tier;
      state.normalRequests = new WeakMap();
    }
    // Preserve stage-0 actor/prop tint and its authored batch keys. Only the ground shader
    // replaces the old pools. Mutating polish here would strand cold-start props outside
    // their original batch when the player returned to off.
    // Batches built while off have never cloned our plugin. Discover them once at enable.
    if (next !== 'off') for (const material of scene.materials) {
      if (material.name.startsWith('static-batch-') && material.disableLighting) registerMaterial(material);
    }
    for (const material of state.materials) {
      if (next !== 'off') registerMaterial(material);
      material.markDirty(true);
    }
    if (ground) ground.setFloat('hdLightEnabled', Number(next !== 'off'));
  }
  function onWorld() {
    if (disposed) return;
    world = renderer.world; ground = world?.landscape?.groundMaterial ?? null;
    state.field = new PointField(sourcesFor(world?.data ?? {}));
    state.revision++;
    ground?.setFloat('hdLightEnabled', Number(state.tier !== 'off'));
  }
  function update(_dt, time) {
    if (disposed || state.tier === 'off') return;
    if (world !== renderer.world) onWorld();
    const field = state.field;
    let actor = null;
    for (const enemy of renderer.game?.enemies ?? []) if (enemy.kind === 'ritual') { actor = enemy; break; }
    if (actor) for (const light of field.sources) if (light.ritual && light.enabled !== (actor.hp > 0)) {
      light.enabled = actor.hp > 0; field.dirty = true;
    }
    const p = camera?.target ?? renderer.camera?.target;
    if (field.update(p?.x ?? 0, p?.z ?? 0, time, BUDGET[state.tier], renderer.reducedMotion)) {
      state.revision++;
      if (ground) {
        ground.setArray4('hdLightPosition', field.positions); ground.setArray4('hdLightColor', field.colors);
        params.x = field.count;
        ground.setVector3('hdMoon', MOON_VECTOR); ground.setVector4('hdLightParams', params);
      }
    }
    // The normal service can be toggled independently of lights. Reset demand records once
    // when its tier/identity changes, never resolve URLs once per sprite per frame.
    const loader = renderer.hd2dNormals;
    if (state.tier === 'high' && (loader !== state.normalLoader || loader?.tier !== state.normalTier)) {
      state.normalLoader = loader; state.normalTier = loader?.tier;
      state.normalRequests = new WeakMap();
      for (const material of state.materials) requestNormal(material, state);
    }
    // A high-tier normal can arrive after first compilation. Recompile that material once.
    if (state.tier === 'high') for (const plugin of state.plugins) {
      const normal = plugin.normalTexture(), ready = normal?.isReady() ? normal : null;
      if (ready !== plugin.lastNormal) { plugin.lastNormal = ready; plugin._material.markDirty(true); }
    }
  }
  onWorld(); setTier(tier);
  return { setTier, update, onWorld, dispose() {
    if (disposed) return;
    setTier('off'); disposed = true;
    state.field = null; state.renderer = null;
    // Existing inactive plugins may still be owned by a material. Keep their off state;
    // a new world/material registers into a fresh scene state after disposal.
    states.delete(scene);
  } };
}
