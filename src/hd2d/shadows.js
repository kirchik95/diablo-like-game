// Directional cast shadows. Original sprite textures/materials and hit masks are read only.
// Static silhouettes are rasterised once from the existing alpha-test masks. Actors share
// atlas batches; high renders their projected alpha into a camera-local planar shadow map.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Vector2, Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import { sceneLights, LIGHT_INKS } from '../scene-light.js';
import { PIXELS_PER_UNIT } from '../pixel-assets.js';
import panorama from '../../assets/game/pixel-v9/camp-panorama/manifest.json' with { type: 'json' };
import ruins from '../../assets/game/pixel-v11/monastery-ruins/manifest.json' with { type: 'json' };
import cemetery from '../../assets/game/pixel-v13/cemetery/manifest.json' with { type: 'json' };
import orchard from '../../assets/game/pixel-v13/orchard/manifest.json' with { type: 'json' };
const packages = [panorama, ruins, cemetery, orchard];
const footprints = Object.assign({}, ...packages.map(p=>p.footprints));
const opaqueBounds = Object.assign({}, ...packages.map(p=>p.opaqueBounds));

export const id = 'shadows';
export const order = 40;
const Q = Math.SQRT1_2, ELEVATION = Math.sqrt(3) / 2;
const MOON_X = 1.4, MOON_Y = .35;
const MAP_SIZE = 512, MAP_SPAN = 40, MAP_LAYER = 0x10000000;
const MAX_ACTORS = 64;
const SOURCE_KINDS = new Set(['campfire-base', 'brazier', 'stone-lantern']);

// Width follows the camera's screen-right axis; height follows a fixed world light ray.
export function projectPoint(out, foot, u, height, dx = MOON_X, dy = MOON_Y) {
  out.x = foot.x - Q * u + dx * height;
  out.y = foot.y + Q * u + dy * height;
  return out;
}

function frameOf(sprite) {
  const a = sprite.atlas, name = a.frames?.[sprite.frame], print = a.footprints?.[name] ?? footprints[name];
  const [width, height] = a.frameSize ?? [a.cell, a.cell];
  const [cx, cy] = print?.contactCenter ?? a.anchor;
  const sx = sprite.mesh.scaling.x, sy = sprite.mesh.scaling.y;
  const u = (cx - a.anchor[0]) * sx / PIXELS_PER_UNIT;
  const back = (a.anchor[1] - cy) * sy / PIXELS_PER_UNIT * 2;
  return { a, width, height, cx, cy, sx, sy, box: opaqueBounds[name] ?? [0, 0, width, height], role: print?.role,
    x: sprite.mesh.position.x - Q * ((sprite.flip ? -u : u) + back),
    y: sprite.mesh.position.z + Q * ((sprite.flip ? -u : u) - back) };
}

export function bakeStaticShadows(sprites, bounds, requestedPpu = 4, lights = []) {
  if (!sprites.length) return null;
  const ppu = Math.min(requestedPpu, 2048 / Math.max(bounds.maxX - bounds.minX + 16, bounds.maxY - bounds.minY + 16));
  const x0 = Math.floor((bounds.minX - 8) * ppu) / ppu, y0 = Math.floor((bounds.minY - 8) * ppu) / ppu;
  const width = Math.ceil((bounds.maxX + 8 - x0) * ppu), height = Math.ceil((bounds.maxY + 8 - y0) * ppu);
  const data = new Uint8Array(width * height);
  const raster = (s, f, dx, dy, strength) => {
    const det = -Q * (dy + dx);
    if (Math.abs(det) < .08) return; // A ray parallel to the art plane has no useful silhouette.
    const box = f.box;
    let u0 = (box[0] - f.cx) * f.sx / PIXELS_PER_UNIT, u1 = (box[2] - f.cx) * f.sx / PIXELS_PER_UNIT;
    if (s.flip) { const old = u0; u0 = -u1; u1 = -old; }
    const h0 = Math.max(0, (f.cy - box[3]) * f.sy / (PIXELS_PER_UNIT * ELEVATION));
    const h1 = Math.max(0, (f.cy - box[1]) * f.sy / (PIXELS_PER_UNIT * ELEVATION));
    const minX = f.x + Math.min(-Q*u0, -Q*u1) + Math.min(dx*h0, dx*h1);
    const maxX = f.x + Math.max(-Q*u0, -Q*u1) + Math.max(dx*h0, dx*h1);
    const minY = f.y + Math.min(Q*u0, Q*u1) + Math.min(dy*h0, dy*h1);
    const maxY = f.y + Math.max(Q*u0, Q*u1) + Math.max(dy*h0, dy*h1);
    const col0 = Math.max(0, Math.floor((minX - x0) * ppu)), col1 = Math.min(width - 1, Math.ceil((maxX - x0) * ppu));
    const row0 = Math.max(0, Math.floor((minY - y0) * ppu)), row1 = Math.min(height - 1, Math.ceil((maxY - y0) * ppu));
    const scaleX = PIXELS_PER_UNIT / f.sx * (s.flip ? -1 : 1), scaleY = PIXELS_PER_UNIT * ELEVATION / f.sy;
    const pixelStepX = dy / det / ppu * scaleX, pixelStepY = Q / det / ppu * scaleY;
    const cell = f.a.cell, mask = f.a.mask, bytes = mask.bytes, stride = mask.width;
    const maxPy = Math.min(cell, f.cy + .001);
    const frameX = s.frame % f.a.columns * cell, frameY = Math.floor(s.frame / f.a.columns) * cell;
    const wx = x0 + (col0 + .5) / ppu - f.x;
    for (let row = row0; row <= row1; row++) {
      const wy = y0 + (row + .5) / ppu - f.y;
      let px = f.cx + (wx * dy - wy * dx) / det * scaleX;
      let py = f.cy + Q * (wy + wx) / det * scaleY;
      let i = row * width + col0;
      for (let col = col0; col <= col1; col++, i++, px += pixelStepX, py += pixelStepY) {
        if (px < 0 || py < 0 || px >= cell || py >= maxPy) continue;
        const bit = (frameY + (py | 0)) * stride + frameX + (px | 0);
        if ((bytes[bit >> 3] & (1 << (bit & 7))) && data[i] < strength) data[i] = strength;
      }
    }
  };
  for (const s of sprites) {
    if (!s.atlas.mask || s.mesh.scaling.x <= 0 || s.mesh.scaling.y <= 0) continue;
    const f = frameOf(s);
    if (f.role === 'flat') continue;
    raster(s, f, MOON_X, MOON_Y, 255);
    for (const light of lights) {
      const dx = f.x - light.x, dy = f.y - light.y, squared = dx*dx + dy*dy;
      const radius = LIGHT_INKS[light.ink].radius;
      if (squared < .09 || squared > radius*radius) continue;
      const distance = Math.sqrt(squared);
      // Short local shadows share the one bake; no extra point-light shadow passes.
      const length = .5 / distance;
      raster(s, f, dx * length, dy * length, 140);
    }
  }
  return { data, width, height, ppu, bounds: [x0, y0, width / ppu, height / ppu] };
}

const vertexSource = `precision highp float;
  attribute vec3 position; attribute vec2 uv; attribute vec4 color;
  uniform mat4 worldViewProjection; varying vec2 vUV; varying float opacity;
  void main() { vUV = uv; opacity = color.a; gl_Position = worldViewProjection * vec4(position, 1.0); }`;
const fragmentSource = `precision highp float;
  varying vec2 vUV; varying float opacity;
  uniform sampler2D atlas; uniform vec2 texel; uniform float mapMode;
  void main() {
    float a = step(.5, texture2D(atlas, vUV).a);
    float edge = step(.5, texture2D(atlas, vUV + vec2(texel.x, 0.0)).a)
      + step(.5, texture2D(atlas, vUV - vec2(texel.x, 0.0)).a)
      + step(.5, texture2D(atlas, vUV + vec2(0.0, texel.y)).a)
      + step(.5, texture2D(atlas, vUV - vec2(0.0, texel.y)).a);
    float coverage = a * .7 + edge * .075;
    if (opacity < .001 || coverage < .01) discard;
    gl_FragColor = vec4(mix(vec3(.075, .06, .14), vec3(1.0), mapMode), coverage * opacity);
  }`;

class ActorBatch {
  constructor(scene, atlas, capacity, moon) {
    this.width = atlas.frameSize?.[0] ?? atlas.cell; this.height = atlas.frameSize?.[1] ?? atlas.cell;
    this.atlas = atlas; this.capacity = capacity; this.used = 0; this.moon = moon;
    const mesh = this.mesh = new Mesh(`hd-shadow-${moon ? 'moon' : 'fire'}`, scene);
    mesh.isPickable = false; mesh.renderingGroupId = 0; mesh.alwaysSelectAsActiveMesh = true;
    this.positions = new Float32Array(capacity * 12); this.uvs = new Float32Array(capacity * 8); this.colors = new Float32Array(capacity * 16);
    mesh.setVerticesData(VertexBuffer.PositionKind, this.positions, true);
    mesh.setVerticesData(VertexBuffer.UVKind, this.uvs, true);
    mesh.setVerticesData(VertexBuffer.ColorKind, this.colors, true);
    const indices = new Uint16Array(capacity * 6);
    for (let i = 0; i < capacity; i++) indices.set([i*4,i*4+1,i*4+2,i*4,i*4+2,i*4+3], i*6);
    mesh.setIndices(indices);
    const material = this.material = new ShaderMaterial('hd-actor-shadow', scene, { vertexSource, fragmentSource }, {
      attributes: ['position', 'uv', 'color'], uniforms: ['worldViewProjection', 'texel', 'mapMode'], samplers: ['atlas'], needAlphaBlending: true,
    });
    material.backFaceCulling = false; material.disableDepthWrite = true;
    material.setTexture('atlas', atlas.texture);
    material.setVector2('texel', new Vector2(1/(atlas.columns*atlas.cell),1/(atlas.rows*atlas.cell)));
    mesh.material = material;
    mesh.freezeWorldMatrix();
  }
  append(sprite, dx, dy, power) {
    if (this.used >= this.capacity) return;
    const a = sprite.atlas, width = this.width, height = this.height, ax = a.anchor[0], ay = a.anchor[1];
    const sx = sprite.mesh.scaling.x, sy = sprite.mesh.scaling.y, pos = sprite.mesh.position;
    const frame = sprite.frame, col = frame % a.columns, row = Math.floor(frame / a.columns);
    // Crop the plane at its foot. Pixels below the foot are contact art, never a caster.
    const bottom = Math.min(ay, height), top = 0, slot = this.used++;
    for (let k = 0; k < 4; k++) {
      const px = k === 0 || k === 3 ? 0 : width, py = k < 2 ? bottom : top;
      const u = (px - ax) * sx / PIXELS_PER_UNIT;
      const h = (ay - py) * sy / (PIXELS_PER_UNIT * ELEVATION);
      const i = slot * 12 + k * 3;
      this.positions[i] = pos.x - Q * u + dx * h;
      this.positions[i + 1] = .012;
      this.positions[i + 2] = pos.z + Q * u + dy * h;
      this.uvs[slot * 8 + k * 2] = (col + (sprite.flip ? width - px : px) / a.cell) / a.columns;
      this.uvs[slot * 8 + k * 2 + 1] = 1 - (row + py / a.cell) / a.rows;
      this.colors[slot * 16 + k * 4 + 3] = power;
    }
  }
  flush(high) {
    this.mesh.setEnabled(this.used > 0);
    if (!this.used) return;
    this.colors.fill(0, this.used * 16);
    this.mesh.layerMask = high && this.moon ? MAP_LAYER : 0x0fffffff;
    this.material.setFloat('mapMode', high && this.moon ? 1 : 0);
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.positions, false, false);
    this.mesh.updateVerticesData(VertexBuffer.UVKind, this.uvs, false, false);
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.colors, false, false);
  }
  dispose() { this.mesh.dispose(); this.material.dispose(); }
}

export function install(ctx) {
  const { scene, renderer } = ctx;
  const assetLoad = renderer.assets?.ready;
  let assetsReady = !assetLoad, assetsFailed = false;
  let tier = 'off', world = null, ground = null, fallback = null, baked = null, map = null, mapCamera = null, lights = [], actors = null;
  let groups = new Map(), pairs = [], dead = false, pending = false;
  const flags = new Vector4(0,0,0,0), mapBounds = new Vector4(0,0,MAP_SPAN,MAP_SPAN);
  const costs = { bakeMs: 0, staticWidth: 0, staticHeight: 0, staticBytes: 0, actorDraws: 0, fireDraws: 0, mapSize: MAP_SIZE };
  // Terrain may clone a receiver after this effect binds its textures. Resource
  // release must unbind every borrower, including clones absent from our world.
  // ShaderMaterial exposes active textures but no public sampler-name getter;
  // read its sampler dictionary, then use the public setter to update bindings.
  // Only tier/world/dispose transitions scan materials, never steady update().
  function rebindBorrowers(texture, replacement) {
    if (!texture) return;
    for (let i = 0; i < scene.materials.length; i++) {
      const receiver = scene.materials[i], bindings = receiver._textures;
      if (!bindings || typeof receiver.setTexture !== 'function') continue;
      if (bindings.hdStaticShadow !== texture && bindings.hdActorShadow !== texture) continue;
      const safe = replacement ?? bindings.surfaceMask ?? fallback;
      if (bindings.hdStaticShadow === texture) receiver.setTexture('hdStaticShadow', safe);
      if (bindings.hdActorShadow === texture) receiver.setTexture('hdActorShadow', safe);
    }
  }
  function disableGround() { if (ground && scene.materials.includes(ground)) { flags.x = 0; flags.y = 0; ground.setVector4('hdShadowFlags', flags);
      ground.setTexture('hdStaticShadow', fallback); ground.setTexture('hdActorShadow', fallback); } }
  function dropMap() {
    if (map) { rebindBorrowers(map, baked ?? fallback); const i = scene.customRenderTargets.indexOf(map); if (i >= 0) scene.customRenderTargets.splice(i, 1); map.dispose(); map = null; }
    mapCamera?.dispose(); mapCamera = null;
  }
  function clear() {
    dropMap(); disableGround(); rebindBorrowers(baked); baked?.dispose(); baked = null;
    for (const pair of groups.values()) { pair.moon.dispose(); pair.fire.dispose(); }
    groups.clear(); pairs.length = 0; world = ground = actors = null;
  }
  function makeMap() {
    if (map || tier !== 'high' || !ground) return;
    mapCamera = new FreeCamera('hd-moon-shadow-camera', new Vector3(0,50,0), scene);
    mapCamera.upVector.set(0,0,1); mapCamera.setTarget(Vector3.Zero()); mapCamera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    mapCamera.orthoLeft = mapCamera.orthoBottom = -MAP_SPAN/2;
    mapCamera.orthoRight = mapCamera.orthoTop = MAP_SPAN/2;
    mapCamera.minZ = .1; mapCamera.maxZ = 100; mapCamera.layerMask = MAP_LAYER;
    map = new RenderTargetTexture('hd-moon-actor-map', MAP_SIZE, scene, { generateMipMaps: false, generateDepthBuffer: false, generateStencilBuffer: false, doNotChangeAspectRatio: true, samplingMode: Texture.NEAREST_SAMPLINGMODE });
    map.activeCamera = mapCamera; map.renderList = []; map.clearColor = new Color4(0,0,0,0);
    map.ignoreCameraViewport = true; map.gammaSpace = false; map.updateSamplingMode(Texture.NEAREST_SAMPLINGMODE);
    scene.customRenderTargets.push(map); ground.setTexture('hdActorShadow', map);
  }
  function rebuildActors() {
    for (const pair of groups.values()) { pair.moon.dispose(); pair.fire.dispose(); }
    groups.clear(); pairs.length = 0; actors = renderer.hounds;
    const counts = new Map();
    if (renderer.monk) counts.set(renderer.monk.atlas, 1);
    for (const view of actors ?? []) counts.set(view.sprite.atlas, (counts.get(view.sprite.atlas) ?? 0) + 1);
    for (const [atlas, count] of counts) groups.set(atlas, {
      moon: new ActorBatch(scene, atlas, Math.min(MAX_ACTORS, count), true), fire: new ActorBatch(scene, atlas, Math.min(MAX_ACTORS, count), false),
    });
    for (const pair of groups.values()) pairs.push(pair);
    if (map) { map.renderList.length = 0; for (const pair of pairs) map.renderList.push(pair.moon.mesh); }
  }
  function build() {
    if (tier === 'off' || dead) return;
    const next = renderer.world;
    if (!next?.landscape?.groundMaterial) return;
    // Each mask package completes independently. The monk is not a readiness
    // signal for scenery: wait for the loader's aggregate completion.
    if (assetsFailed) { pending = false; return; }
    if (!assetsReady || !renderer.assets?.monk?.mask) { pending = true; return; }
    // Small embedders without the aggregate promise can signal readiness by
    // populating every required mask; keep retrying until that set is complete.
    if (!assetLoad) {
      for (const sprite of next.props ?? []) {
        if (sprite.mesh.billboardMode !== 0 && sprite.placement?.layer !== 'ground'
          && !SOURCE_KINDS.has(sprite.placement?.kind) && !sprite.atlas.mask) { pending = true; return; }
      }
      for (const shrine of next.shrines ?? []) {
        if (shrine.sprite && !shrine.sprite.atlas.mask) { pending = true; return; }
      }
    }
    clear(); pending = false; world = next; ground = next.landscape.groundMaterial;
    fallback = ground.getActiveTextures().find(t=>t.name === 'country-surface-mask');
    lights = sceneLights(next.data).filter(l => ['amber','cyan','pink'].includes(l.ink));
    const casters = (next.props ?? []).filter(s => s.atlas.mask && s.mesh.billboardMode !== 0
      && s.placement?.layer !== 'ground' && !SOURCE_KINDS.has(s.placement?.kind));
    for (const shrine of next.shrines ?? []) if (shrine.sprite?.atlas.mask) casters.push(shrine.sprite);
    const start = performance.now(), field = bakeStaticShadows(casters, next.bounds, 3, lights);
    costs.bakeMs = performance.now() - start;
    if (field) {
      baked = RawTexture.CreateLuminanceTexture(field.data, field.width, field.height, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
      baked.name = 'hd-static-moon-shadow'; baked.wrapU = baked.wrapV = Texture.CLAMP_ADDRESSMODE;
      ground.setTexture('hdStaticShadow', baked); ground.setVector4('hdShadowBounds', new Vector4(...field.bounds));
      flags.z = 1/field.width; flags.w = 1/field.height;
      costs.staticWidth = field.width; costs.staticHeight = field.height; costs.staticBytes = field.data.byteLength;
    }
    ground.setTexture('hdActorShadow', baked ?? fallback);
    flags.x = field ? 1 : 0; flags.y = tier === 'high' ? 1 : 0;
    ground.setVector4('hdShadowFlags', flags); makeMap(); rebuildActors();
  }
  function append(sprite, alive) {
    if (!sprite || !alive || !sprite.mesh.isEnabled() || !sprite.mesh.isVisible) return;
    const pos = sprite.mesh.position, centre = ctx.camera.target ?? ctx.camera.position;
    if (Math.abs(pos.x - centre.x) > 25 || Math.abs(pos.z - centre.z) > 25) return;
    const pair = groups.get(sprite.atlas); if (!pair) return;
    pair.moon.append(sprite, MOON_X, MOON_Y, tier === 'high' ? 1 : .22);
    let nearest = null, distance = Infinity;
    for (const light of lights) {
      const d = Math.hypot(pos.x - light.x, pos.z - light.y);
      if (d > .3 && d < LIGHT_INKS[light.ink].radius && d < distance) { nearest = light; distance = d; }
    }
    if (nearest) {
      const k = .5 / distance;
      pair.fire.append(sprite, (pos.x - nearest.x) * k, (pos.z - nearest.y) * k, .2 * (1 - distance / LIGHT_INKS[nearest.ink].radius));
    }
  }
  const api = {
    costs,
    setTier(value) {
      const next = value === 'high' ? 'high' : value === 'low' ? 'low' : 'off';
      if (next === tier || dead) return;
      tier = next;
      if (tier === 'off') { clear(); pending = false; return; }
      if (!world) { build(); return; }
      if (tier === 'high') makeMap(); else dropMap();
      flags.y = tier === 'high' ? 1 : 0; ground.setVector4('hdShadowFlags', flags);
      if (map) { for (const pair of groups.values()) map.renderList.push(pair.moon.mesh); }
    },
    update() {
      if (tier === 'off' || dead) return;
      if (world !== renderer.world || pending) build();
      if (!world) return;
      if (actors !== renderer.hounds) rebuildActors();
      for (let i = 0; i < pairs.length; i++) { const pair = pairs[i]; pair.moon.used = 0; pair.fire.used = 0; }
      append(renderer.monk, renderer.game?.player?.hp > 0);
      for (const view of renderer.hounds ?? []) append(view.sprite, view.body?.hp > 0);
      costs.actorDraws = 0; costs.fireDraws = 0;
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i]; pair.moon.flush(tier === 'high'); pair.fire.flush(false);
        if (pair.moon.used) costs.actorDraws++; if (pair.fire.used) costs.fireDraws++;
      }
      if (mapCamera) {
        // Snap the light-space map to texels, so a following camera cannot swim the shadow.
        const p = ctx.camera.target ?? ctx.camera.position, texel = MAP_SPAN/MAP_SIZE;
        const x = Math.round(p.x/texel)*texel, z = Math.round(p.z/texel)*texel;
        mapCamera.position.set(x,50,z);
        mapBounds.x = x-MAP_SPAN/2; mapBounds.y = z-MAP_SPAN/2;
        ground.setVector4('hdShadowMapBounds', mapBounds);
      }
    },
    onWorld() { clear(); if (tier !== 'off') build(); },
    dispose() { if (!dead) { clear(); dead = true; } },
  };
  if (assetLoad) Promise.resolve(assetLoad).then(() => {
    assetsReady = true;
    // Loading must not resurrect an off/disposed effect or a replaced world.
    // build() reads the current renderer.world instead of a captured old one.
    if (!dead && tier !== 'off' && pending && renderer.world?.landscape?.groundMaterial) build();
  }, () => { assetsFailed = true; pending = false; });
  api.setTier(ctx.tier); return api;
}
